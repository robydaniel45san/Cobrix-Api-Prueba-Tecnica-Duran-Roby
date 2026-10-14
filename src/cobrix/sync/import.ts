/**
 * Import run (ENUNCIADO §3.2): walks every contract of the invoice manager and creates an open
 * invoice per eligible pending installment, plus its customer if it does not exist.
 *
 * Two phases: first everything is read and decided (no writes), then everything is written in
 * one transaction. A simulation stops after the first phase, so it reports exactly what the
 * real run would do. A run that fails while reading writes no data, only its own record.
 */

import type { Queryable } from '../db/database.ts'
import type { ContractSnapshot, PendingInstallment } from '../domain/contract.ts'
import { classifyContract, type ContractClassification, type ContractExclusion } from '../domain/import-rules.ts'
import { cutoffDate } from '../domain/period.ts'
import { describeError, connect, failRun, finishRun, insertItems, mapLimit, startRun, type Counters, type RunItem, type RunOptions, type RunOutcome, type SyncDeps } from './runs.ts'

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

/** Result code of each item → counter it adds to. */
const EXCLUSION_COUNTER: Record<ContractExclusion | 'zero_amount' | 'outside_window' | 'outside_recent', (typeof IMPORT_COUNTERS)[number]> = {
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

const CONTRACT_COUNTER: Partial<Record<ContractExclusion, (typeof IMPORT_COUNTERS)[number]>> = {
	contradictory: 'contractsIndeterminate',
	status_unrecognized: 'contractsStatusUnrecognized',
	currency_incoherent: 'contractsCurrencyIncoherent',
	currency_not_supported: 'contractsCurrencyUnsupported',
	invalid_identification: 'contractsInvalidIdentifier',
	document_type_excluded: 'contractsExcludedByIdentifierType',
}

interface NewInvoice {
	readonly contract: ContractSnapshot
	readonly customerId: string
	readonly installment: PendingInstallment
}

interface NewCustomer {
	readonly classification: ContractClassification & { contract: ContractSnapshot }
}

const CONCURRENCY = 4

export async function runImport(deps: SyncDeps, options: RunOptions): Promise<RunOutcome> {
	const { db } = deps
	const runId = await startRun(db, 'import', options.dryRun, options.trigger ?? 'manual')
	const counters: Counters = Object.fromEntries(IMPORT_COUNTERS.map(name => [name, 0]))
	const count = (name: (typeof IMPORT_COUNTERS)[number], by = 1) => { counters[name] = (counters[name] ?? 0) + by }
	const items: RunItem[] = []
	const progress = (done: number, total: number, stage: string) =>
		options.onProgress?.({ runId, kind: 'import', dryRun: options.dryRun, done, total, stage })

	try {
		progress(0, 0, 'Conectando con el administrador de facturas')
		const { client, provider } = await connect(deps)
		await client.login()
		const ids = await client.listContractIds()
		const currentPeriod = deps.today().slice(0, 7)
		progress(0, ids.length, 'Leyendo contratos')

		// Phase 1: read and classify. A contract that cannot be read is recorded and skipped.
		let done = 0
		const readings = await mapLimit(ids, CONCURRENCY, async id => {
			try {
				return classifyContract(id, await client.getContract(id), provider, currentPeriod)
			} catch (error) {
				return { failed: id, error: describeError(error) }
			} finally {
				progress(++done, ids.length, 'Leyendo contratos')
			}
		})

		const existingInvoices = new Map((await db.query<{ external_id: string; number: string; status: string; contract_id: number }>(
			'SELECT external_id, number, status, contract_id FROM invoice',
		)).map(row => [row.external_id, row]))
		const existingCustomers = new Set((await db.query<{ id: string }>('SELECT id FROM customer')).map(row => row.id))

		const newInvoices: NewInvoice[] = []
		const newCustomers = new Map<string, NewCustomer>()
		const knownContracts: Array<{ contract: ContractSnapshot; customerId: string }> = []
		let newAmountCents = 0
		let blocked = false

		for (const reading of readings) {
			counters.contractsObserved = (counters.contractsObserved ?? 0) + 1
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
			}
			if (contract && customerId && exclusion?.reason !== 'contradictory') knownContracts.push({ contract, customerId })
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
				const overCount = provider.maxNewInvoices !== null && newInvoices.length + 1 > provider.maxNewInvoices
				const overAmount = provider.maxNewAmountCents !== null && newAmountCents + amount > provider.maxNewAmountCents
				if (blocked || overCount || overAmount) {
					// Once a limit is reached the run stops importing: what follows waits for the next run.
					blocked = true
					count('installmentsBlockedByLimit')
					items.push(item({ ...base, result: 'blocked_by_limit', detail: overAmount
						? `tope de monto nuevo por corrida (USD ${(provider.maxNewAmountCents as number) / 100})`
						: `tope de facturas nuevas por corrida (${provider.maxNewInvoices ?? '—'})` }))
					continue
				}
				newAmountCents += amount
				newInvoices.push({ contract: contract as ContractSnapshot, customerId: customerId as string, installment: full as PendingInstallment })
				if (!existingCustomers.has(customerId as string) && !newCustomers.has(customerId as string)) {
					newCustomers.set(customerId as string, { classification: reading as NewCustomer['classification'] })
				}
				items.push(item({ ...base, result: options.dryRun ? 'would_import' : 'imported', detail: full?.label ?? '' }))
			}

			// Open invoices of this contract that the ISP no longer lists as pending: «Actualizar pagadas» decides.
			if (contract && !exclusion) {
				for (const [externalId, invoice] of existingInvoices) {
					if (invoice.contract_id === contract.id && invoice.status === 'open' && !pendingIds.has(externalId)) {
						count('installmentsNoLongerPending')
						items.push(item({ contractId: contract.id, externalId, customerId, customerName, result: 'no_longer_pending',
							detail: `${invoice.number} ya no figura como pendiente en el administrador: corre «Actualizar pagadas»` }))
					}
				}
			}
		}

		if (options.dryRun) {
			count('installmentsWouldImport', newInvoices.length)
			count('customersWouldCreate', newCustomers.size)
			count('amountWouldImportCents', newAmountCents)
			await insertItems(db, runId, items)
			await finishRun(db, runId, counters, counters.contractsFailed ?? 0)
			return { runId, status: 'completed', counters }
		}

		// Phase 2: write everything or nothing.
		progress(ids.length, ids.length, 'Guardando')
		await db.transaction(async tx => {
			for (const [customerId, { classification }] of newCustomers) {
				const { contract, identification } = classification
				const created = await tx.query(
					`INSERT INTO customer (id, document, document_type, person_type, name, email, phone, source_contract_id, created_run_id)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING id`,
					[customerId, contract.rawIdentification, identification?.documentType ?? null, identification?.personType ?? 'natural',
						contract.holderName, contract.email, contract.phone, contract.id, runId],
				)
				if (created.length) {
					count('customersCreated')
					await event(tx, customerId, null, 'customer_created', runId, `Cliente creado desde el contrato ${contract.id} del administrador`)
				}
			}
			// Contracts of every known customer, importable or not: the expediente shows them all.
			for (const { contract, customerId } of knownContracts) {
				if (!existingCustomers.has(customerId) && !newCustomers.has(customerId)) continue
				await tx.query(
					`INSERT INTO contract (id, customer_id, code, status, plan, plan_price, currency, branch, address)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
					 ON CONFLICT (id) DO UPDATE SET customer_id = $2, code = $3, status = $4, plan = $5, plan_price = $6,
						currency = $7, branch = $8, address = $9, updated_at = now()`,
					[contract.id, customerId, contract.code, contract.status, contract.plan, contract.planPriceCents / 100,
						contract.currency, contract.branch, contract.address],
				)
			}
			for (const { contract, customerId, installment } of newInvoices) {
				const [inserted] = await tx.query<{ id: number; number: string }>(
					`INSERT INTO invoice (number, external_id, customer_id, contract_id, label, period, due_date, cutoff_date, total, balance, currency, imported_run_id)
					 VALUES ('FAC-' || lpad(nextval('invoice_number_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)
					 ON CONFLICT (external_id) DO NOTHING RETURNING id, number`,
					[installment.externalId, customerId, contract.id, installment.label, installment.period, installment.dueDate,
						cutoffDate(installment.dueDate, provider.graceDays), installment.amountCents / 100, contract.currency, runId],
				)
				if (!inserted) continue
				count('installmentsImported')
				count('amountImportedCents', installment.amountCents)
				await event(tx, customerId, inserted.id, 'invoice_imported', runId, `Cuota ${installment.externalId} · ${installment.label}`)
			}
			await insertItems(tx, runId, items)
			await finishRun(tx, runId, counters, counters.contractsFailed ?? 0)
		})
		return { runId, status: 'completed', counters }
	} catch (error) {
		await insertItems(db, runId, items).catch(() => undefined)
		const message = await failRun(db, runId, counters, error)
		return { runId, status: 'failed', counters, error: message }
	}
}

function item(fields: Partial<RunItem> & Pick<RunItem, 'result' | 'detail'>): RunItem {
	return {
		contractId: null, externalId: null, customerId: null, customerName: null, label: null, amountCents: null,
		...fields,
	}
}

async function event(db: Queryable, customerId: string, invoiceId: number | null, kind: string, runId: number, detail: string): Promise<void> {
	await db.query('INSERT INTO event (customer_id, invoice_id, kind, run_id, detail) VALUES ($1, $2, $3, $4, $5)', [customerId, invoiceId, kind, runId, detail])
}
