/**
 * Use case «Importar clientes y facturas» (ENUNCIADO §3.2): walks every contract of the invoice
 * manager and creates an open invoice per eligible pending installment, plus its customer.
 *
 * Two phases: first everything is read and decided (no writes), then everything is written in
 * one transaction. A simulation stops after the first phase, so it reports exactly what the
 * real run would do. A run that fails while reading writes no data, only its own record.
 */

import type { ContractSnapshot, PendingInstallment } from '../domain/contract.ts'
import { classifyContract, type ContractClassification, type ContractExclusion } from '../domain/import-rules.ts'
import { cutoffDate } from '../domain/period.ts'
import type { Counters, ExistingInvoice, NewCustomer, RunItem } from './ports/store.ts'
import { connect, describeError, elapsed, mapLimit, type RunOptions, type RunOutcome, type SyncDeps } from './runs.ts'

/** Counter names as in Cobrix. */
export const IMPORT_COUNTERS = [
	'contractsObserved', 'contractsWithDebt', 'contractsIndeterminate', 'contractsStatusUnrecognized',
	'contractsCurrencyIncoherent', 'contractsCurrencyUnsupported', 'contractsInvalidIdentifier',
	'contractsExcludedByIdentifierType', 'contractsFailed',
	'installmentsPending', 'installmentsImported', 'installmentsWouldImport', 'installmentsAlreadyImported',
	'installmentsExcludedByStatus', 'installmentsBlockedByLimit', 'installmentsFailed', 'installmentsZeroAmount',
	'installmentsNoLongerPending', 'installmentsExcludedByWindow', 'installmentsExcludedByRecentLimit',
	'installmentsExcludedByIdentifierType', 'installmentsExcludedByCurrency', 'installmentsIndeterminate',
	'customersCreated', 'customersWouldCreate', 'amountImportedCents', 'amountWouldImportCents',
] as const
type ImportCounter = (typeof IMPORT_COUNTERS)[number]

/** Exclusion reason of an installment → the counter it adds to. */
const EXCLUSION_COUNTER: Record<ContractExclusion | 'zero_amount' | 'outside_window' | 'outside_recent', ImportCounter> = {
	contradictory: 'installmentsIndeterminate',
	status_unrecognized: 'installmentsExcludedByStatus',
	status_not_importable: 'installmentsExcludedByStatus',
	invalid_identification: 'installmentsIndeterminate',
	document_type_excluded: 'installmentsExcludedByIdentifierType',
	currency_not_supported: 'installmentsExcludedByCurrency',
	currency_incoherent: 'installmentsExcludedByCurrency',
	zero_amount: 'installmentsZeroAmount',
	outside_window: 'installmentsExcludedByWindow',
	outside_recent: 'installmentsExcludedByRecentLimit',
}

/** Exclusion reason of a whole contract → its contract counter. */
const CONTRACT_COUNTER: Partial<Record<ContractExclusion, ImportCounter>> = {
	contradictory: 'contractsIndeterminate',
	status_unrecognized: 'contractsStatusUnrecognized',
	currency_incoherent: 'contractsCurrencyIncoherent',
	currency_not_supported: 'contractsCurrencyUnsupported',
	invalid_identification: 'contractsInvalidIdentifier',
	document_type_excluded: 'contractsExcludedByIdentifierType',
}

interface PlannedInvoice {
	readonly contract: ContractSnapshot
	readonly customerId: string
	readonly installment: PendingInstallment
}

type Reading = ContractClassification | { readonly failed: number; readonly error: string }

const CONCURRENCY = 4

export async function runImport(deps: SyncDeps, options: RunOptions): Promise<RunOutcome> {
	const { store } = deps
	const started = performance.now()
	const runId = await store.runs.start('import', options.dryRun, options.trigger ?? 'manual')
	const log = deps.logger.child({ runId, kind: 'import', dryRun: options.dryRun })
	log.info('run.started', { trigger: options.trigger ?? 'manual' })
	const counters: Counters = Object.fromEntries(IMPORT_COUNTERS.map(name => [name, 0]))
	const count = (name: ImportCounter, by = 1) => { counters[name] = (counters[name] ?? 0) + by }
	const items: RunItem[] = []
	const progress = (done: number, total: number, stage: string) =>
		options.onProgress?.({ runId, kind: 'import', dryRun: options.dryRun, done, total, stage })

	try {
		progress(0, 0, 'Conectando con el administrador de facturas')
		const { gateway, provider } = await connect(deps)
		await gateway.login()
		const ids = await gateway.listContractIds()
		const currentPeriod = deps.today().slice(0, 7)
		log.info('run.contracts_listed', { contracts: ids.length })
		progress(0, ids.length, 'Leyendo contratos')

		// Phase 1: read and classify. A contract that cannot be read is recorded and skipped.
		let done = 0
		const readings: Reading[] = await mapLimit(ids, CONCURRENCY, async id => {
			try {
				return classifyContract(id, await gateway.getContract(id), provider, currentPeriod)
			} catch (error) {
				log.warn('run.contract_failed', { contractId: id, error: describeError(error) })
				return { failed: id, error: describeError(error) }
			} finally {
				progress(++done, ids.length, 'Leyendo contratos')
			}
		})

		const existingInvoices = new Map((await store.invoices.existing()).map(invoice => [invoice.externalId, invoice]))
		const existingCustomers = await store.customers.existingIds()
		const planned: PlannedInvoice[] = []
		const newCustomers = new Map<string, NewCustomer>()
		const knownContracts: Array<{ contract: ContractSnapshot; customerId: string }> = []
		let newAmountCents = 0
		let blocked = false

		for (const reading of readings) {
			count('contractsObserved')
			if ('failed' in reading) {
				count('contractsFailed')
				items.push(item({ contractId: reading.failed, result: 'lookup_failed', detail: reading.error }))
				continue
			}
			const { contract, identification, exclusion } = reading
			const customerName = contract?.holderName ?? null
			const customerId = identification?.id ?? null
			if (reading.hasDebt) count('contractsWithDebt')
			if (exclusion) {
				const counter = CONTRACT_COUNTER[exclusion.reason]
				if (counter) count(counter)
				if (exclusion.reason === 'contradictory' || exclusion.reason === 'status_unrecognized') {
					log.warn('run.contract_excluded', { contractId: reading.contractId, reason: exclusion.reason, detail: exclusion.detail })
				}
			}
			if (contract && customerId && exclusion?.reason !== 'contradictory') knownContracts.push({ contract, customerId })
			if (exclusion && reading.installments.length === 0) {
				// Nothing to list per installment (no debt, or the response could not even be read): one row for the contract.
				items.push(item({ contractId: reading.contractId, customerId, customerName, result: exclusion.reason, detail: exclusion.detail }))
			}
			if (!reading.hasDebt && !exclusion) {
				items.push(item({ contractId: reading.contractId, customerId, customerName, result: 'no_debt', detail: 'el contrato no tiene cuotas pendientes' }))
			}

			const pendingIds = new Set<string>()
			for (const { installment, verdict } of reading.installments) {
				pendingIds.add(installment.externalId)
				const full = 'period' in installment ? installment : undefined
				const amountCents = full?.amountCents ?? null
				if (amountCents !== null && amountCents > 0) count('installmentsPending')
				const base = { contractId: reading.contractId, externalId: installment.externalId, customerId, customerName, label: full?.label ?? null, amountCents }

				if (verdict.kind === 'excluded') {
					count(EXCLUSION_COUNTER[verdict.reason])
					items.push(item({ ...base, result: verdict.reason, detail: verdict.detail }))
					continue
				}
				// Eligible: what is left depends on Cobrix's own state.
				const existing = existingInvoices.get(installment.externalId)
				if (existing) {
					count('installmentsAlreadyImported')
					items.push(item({ ...base, result: 'already_imported', detail: `ya existe como ${existing.number}${existing.status === 'paid' ? ' (pagada)' : ''}` }))
					continue
				}
				const amount = amountCents as number
				const overCount = provider.maxNewInvoices !== null && planned.length + 1 > provider.maxNewInvoices
				const overAmount = provider.maxNewAmountCents !== null && newAmountCents + amount > provider.maxNewAmountCents
				if (blocked || overCount || overAmount) {
					// Once a limit is reached the run stops importing: what follows waits for the next run.
					if (!blocked) log.warn('run.limit_reached', { maxNewInvoices: provider.maxNewInvoices, maxNewAmountCents: provider.maxNewAmountCents })
					blocked = true
					count('installmentsBlockedByLimit')
					items.push(item({ ...base, result: 'blocked_by_limit', detail: overAmount
						? `tope de monto nuevo por corrida (USD ${(provider.maxNewAmountCents as number) / 100})`
						: `tope de facturas nuevas por corrida (${provider.maxNewInvoices ?? '—'})` }))
					continue
				}
				newAmountCents += amount
				planned.push({ contract: contract as ContractSnapshot, customerId: customerId as string, installment: full as PendingInstallment })
				if (!existingCustomers.has(customerId as string) && !newCustomers.has(customerId as string)) {
					newCustomers.set(customerId as string, toNewCustomer(reading))
				}
				items.push(item({ ...base, result: options.dryRun ? 'would_import' : 'imported', detail: full?.label ?? '' }))
			}

			if (contract && !exclusion) noLongerPending(contract, pendingIds, existingInvoices, customerId, customerName, items, count)
		}

		if (options.dryRun) {
			count('installmentsWouldImport', planned.length)
			count('customersWouldCreate', newCustomers.size)
			count('amountWouldImportCents', newAmountCents)
			await store.runs.addItems(runId, items)
			await store.runs.complete(runId, counters, counters.contractsFailed ?? 0)
			log.info('run.finished', { status: 'completed', ms: elapsed(started), ...summary(counters) })
			return { runId, status: 'completed', counters }
		}

		// Phase 2: write everything or nothing.
		progress(ids.length, ids.length, 'Guardando')
		await store.transaction(async repositories => {
			for (const customer of newCustomers.values()) {
				if (await repositories.customers.create(customer, runId)) {
					count('customersCreated')
					await repositories.events.add({ customerId: customer.id, invoiceId: null, kind: 'customer_created', runId,
						detail: `Cliente creado desde el contrato ${customer.sourceContractId} del administrador` })
				}
			}
			// Contracts of every known customer, importable or not: the customer file shows them all.
			for (const { contract, customerId } of knownContracts) {
				if (existingCustomers.has(customerId) || newCustomers.has(customerId)) await repositories.contracts.upsert(contract, customerId)
			}
			// Consecutive numbers without gaps; safe because only one run writes at a time.
			let nextNumber = (await repositories.invoices.lastNumber()) + 1
			for (const { contract, customerId, installment } of planned) {
				const invoiceId = await repositories.invoices.create({
					number: `FAC-${String(nextNumber).padStart(6, '0')}`,
					externalId: installment.externalId, customerId, contractId: contract.id, label: installment.label,
					period: installment.period, dueDate: installment.dueDate, cutoffDate: cutoffDate(installment.dueDate, provider.graceDays),
					amountCents: installment.amountCents, currency: contract.currency,
				}, runId)
				if (invoiceId === undefined) continue
				nextNumber++
				count('installmentsImported')
				count('amountImportedCents', installment.amountCents)
				await repositories.events.add({ customerId, invoiceId, kind: 'invoice_imported', runId, detail: `Cuota ${installment.externalId} · ${installment.label}` })
			}
			await repositories.runs.addItems(runId, items)
			await repositories.runs.complete(runId, counters, counters.contractsFailed ?? 0)
		})
		log.info('run.finished', { status: 'completed', ms: elapsed(started), ...summary(counters) })
		return { runId, status: 'completed', counters }
	} catch (error) {
		const message = describeError(error)
		await store.runs.addItems(runId, items).catch(() => undefined)
		await store.runs.fail(runId, counters, message)
		log.error('run.failed', { ms: elapsed(started), error: message })
		return { runId, status: 'failed', counters, error: message }
	}
}

/** Open invoices of this contract that the ISP no longer lists as pending: «Actualizar pagadas» decides. */
function noLongerPending(
	contract: ContractSnapshot, pendingIds: ReadonlySet<string>, existing: ReadonlyMap<string, ExistingInvoice>,
	customerId: string | null, customerName: string | null, items: RunItem[], count: (name: ImportCounter) => void,
): void {
	for (const [externalId, invoice] of existing) {
		if (invoice.contractId !== contract.id || invoice.status !== 'open' || pendingIds.has(externalId)) continue
		count('installmentsNoLongerPending')
		items.push(item({ contractId: contract.id, externalId, customerId, customerName, result: 'no_longer_pending',
			detail: `${invoice.number} ya no figura como pendiente en el administrador: corre «Actualizar pagadas»` }))
	}
}

function toNewCustomer(reading: ContractClassification): NewCustomer {
	const contract = reading.contract as ContractSnapshot
	const identification = reading.identification
	return {
		id: identification?.id as string,
		document: contract.rawIdentification,
		documentType: identification?.documentType ?? null,
		personType: identification?.personType ?? 'natural',
		name: contract.holderName,
		email: contract.email,
		phone: contract.phone,
		sourceContractId: contract.id,
	}
}

function item(fields: Partial<RunItem> & Pick<RunItem, 'result' | 'detail'>): RunItem {
	return { contractId: null, externalId: null, customerId: null, customerName: null, label: null, amountCents: null, ...fields }
}

/** The non-zero counters, for one log line. */
function summary(counters: Counters): Counters {
	return Object.fromEntries(Object.entries(counters).filter(([, value]) => value !== 0))
}
