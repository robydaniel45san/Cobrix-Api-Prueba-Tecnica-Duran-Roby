/**
 * Use case «Actualizar pagadas» (ENUNCIADO §3.3): checks every open Cobrix invoice against the
 * installment ledger and marks paid the ones the ISP fully collected.
 *
 * Per contract: one ledger read over the configured window (up to today). Installments the
 * ledger does not show (the current month may be missing until month end) are looked up in the
 * contract; if they are not there either, there is no evidence and nothing changes.
 */

import type { LedgerRow } from '../domain/ledger.ts'
import { formatAmount, type Cents } from '../domain/money.ts'
import { classifyPayment, type PaymentVerdict } from '../domain/payment-rules.ts'
import { addMonths } from '../shared/dates.ts'
import type { InvoiceManagerGateway } from './ports/invoice-manager.ts'
import type { Counters, OpenInvoice, RunItem } from './ports/store.ts'
import { connect, describeError, elapsed, mapLimit, type RunOptions, type RunOutcome, type SyncDeps } from './runs.ts'

/** Counter names as in Cobrix. */
export const PAID_COUNTERS = [
	'invoicesChecked', 'invoicesMarkedPaid', 'invoicesWouldMarkPaid', 'invoicesStillOpen', 'invoicesPartiallyPaidAtIsp',
	'invoicesUnderReview', 'invoicesUnknown', 'lookupsFailed', 'contractsRead', 'amountMarkedPaidCents', 'amountWouldMarkPaidCents',
] as const
type PaidCounter = (typeof PAID_COUNTERS)[number]

interface Decision {
	readonly invoice: OpenInvoice
	readonly verdict: PaymentVerdict | { readonly kind: 'lookup_failed'; readonly reason: string }
	/** Where the evidence came from: the ledger or the contract endpoint. */
	readonly source: 'ledger' | 'contract' | 'none'
}

const CONCURRENCY = 4
const usd = (cents: Cents) => `USD ${formatAmount(cents)}`

export async function runPaid(deps: SyncDeps, options: RunOptions): Promise<RunOutcome> {
	const { store } = deps
	const started = performance.now()
	const runId = await store.runs.start('paid', options.dryRun, options.trigger ?? 'manual')
	const log = deps.logger.child({ runId, kind: 'paid', dryRun: options.dryRun })
	log.info('run.started', { trigger: options.trigger ?? 'manual' })
	const counters: Counters = Object.fromEntries(PAID_COUNTERS.map(name => [name, 0]))
	const count = (name: PaidCounter, by = 1) => { counters[name] = (counters[name] ?? 0) + by }
	const items: RunItem[] = []
	const progress = (done: number, total: number, stage: string) =>
		options.onProgress?.({ runId, kind: 'paid', dryRun: options.dryRun, done, total, stage })

	try {
		progress(0, 0, 'Conectando con el administrador de facturas')
		const byContract = new Map<number, OpenInvoice[]>()
		for (const invoice of await store.invoices.open()) byContract.set(invoice.contractId, [...(byContract.get(invoice.contractId) ?? []), invoice])
		const contracts = [...byContract.keys()]

		const { gateway, provider } = await connect(deps)
		await gateway.login()
		const today = deps.today()
		const from = `${addMonths(today.slice(0, 7), -provider.ledgerMonths)}-01`
		log.info('run.ledger_window', { from, to: today, contracts: contracts.length })
		progress(0, contracts.length, 'Revisando el libro de cuotas')

		let done = 0
		const decisions = (await mapLimit(contracts, CONCURRENCY, async contractId => {
			try {
				return await decideContract(gateway, contractId, byContract.get(contractId) as OpenInvoice[], from, today, () => count('contractsRead'))
			} catch (error) {
				count('lookupsFailed')
				log.warn('run.contract_failed', { contractId, error: describeError(error) })
				return (byContract.get(contractId) as OpenInvoice[]).map(invoice => ({ invoice, verdict: { kind: 'lookup_failed', reason: describeError(error) }, source: 'none' }) as Decision)
			} finally {
				progress(++done, contracts.length, 'Revisando el libro de cuotas')
			}
		})).flat()

		const paid: Array<{ invoice: OpenInvoice; verdict: Extract<PaymentVerdict, { kind: 'paid' }> }> = []
		const ispBalances: Array<{ id: number; cents: Cents | null }> = []
		for (const { invoice, verdict, source } of decisions) {
			count('invoicesChecked')
			const base = {
				contractId: invoice.contractId, externalId: invoice.externalId, customerId: invoice.customerId,
				customerName: invoice.customerName, label: invoice.label, amountCents: invoice.balanceCents,
			}
			const where = source === 'contract' ? 'el contrato (el libro aún no la muestra)' : 'el libro'
			switch (verdict.kind) {
				case 'paid':
					paid.push({ invoice, verdict })
					count(options.dryRun ? 'invoicesWouldMarkPaid' : 'invoicesMarkedPaid')
					count(options.dryRun ? 'amountWouldMarkPaidCents' : 'amountMarkedPaidCents', invoice.balanceCents)
					items.push({ ...base, result: options.dryRun ? 'would_mark_paid' : 'marked_paid',
						detail: `${invoice.number} · factura del administrador ${verdict.paidBy.invoiceNumber || verdict.paidBy.invoiceId} del ${verdict.paidOn}` })
					break
				case 'partial':
					ispBalances.push({ id: invoice.id, cents: verdict.ispBalanceCents })
					count('invoicesPartiallyPaidAtIsp')
					items.push({ ...base, result: 'partial',
						detail: `abono parcial: en el ISP quedan ${usd(verdict.ispBalanceCents)} por cobrar de ${usd(invoice.balanceCents)}. Sigue abierta hasta que se salde.` })
					break
				case 'still_open':
					ispBalances.push({ id: invoice.id, cents: null })
					count('invoicesStillOpen')
					items.push({ ...base, result: 'still_open', detail: `sigue pendiente según ${where}` })
					break
				case 'balance_increased':
					count('invoicesUnderReview')
					items.push({ ...base, result: 'under_review',
						detail: `el administrador ahora debe ${usd(verdict.ispBalanceCents)}, más que en Cobrix (${usd(invoice.balanceCents)}): revisar, quizá se anuló un cobro` })
					break
				case 'exonerated':
					count('invoicesUnderReview')
					items.push({ ...base, result: 'under_review', detail: 'exonerada en el administrador (saldo 0 sin nada pagado): no es un pago, no se marca' })
					break
				case 'contradictory':
					count('invoicesUnderReview')
					items.push({ ...base, result: 'under_review', detail: verdict.reason })
					break
				case 'no_evidence':
					count('invoicesUnknown')
					items.push({ ...base, result: 'no_evidence', detail: 'no aparece en el libro ni como pendiente en el contrato: nunca se marca pagada sin evidencia' })
					break
				case 'lookup_failed':
					items.push({ ...base, result: 'lookup_failed', detail: verdict.reason })
					break
			}
		}
		if (counters.invoicesUnderReview) log.warn('run.invoices_under_review', { invoices: counters.invoicesUnderReview })

		if (options.dryRun) {
			await store.runs.addItems(runId, items)
			await store.runs.complete(runId, counters, counters.lookupsFailed ?? 0)
			log.info('run.finished', { status: 'completed', ms: elapsed(started), ...summary(counters) })
			return { runId, status: 'completed', counters }
		}

		progress(contracts.length, contracts.length, 'Guardando')
		await store.transaction(async repositories => {
			for (const { invoice, verdict } of paid) {
				const paidBy = verdict.paidBy.invoiceNumber || String(verdict.paidBy.invoiceId)
				if (!(await repositories.invoices.markPaid(invoice.id, verdict.paidOn, paidBy, runId))) continue
				await repositories.events.add({ customerId: invoice.customerId, invoiceId: invoice.id, kind: 'invoice_paid', runId,
					detail: `Pagada en el administrador (factura del administrador ${paidBy} del ${verdict.paidOn})` })
			}
			// The ISP balance is kept for display only; Cobrix's balance does not change on a partial payment.
			for (const { id, cents } of ispBalances) await repositories.invoices.setIspBalance(id, cents)
			await repositories.runs.addItems(runId, items)
			await repositories.runs.complete(runId, counters, counters.lookupsFailed ?? 0)
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

/** Reads one contract's ledger (and, if needed, the contract) and classifies its open invoices. */
async function decideContract(
	gateway: InvoiceManagerGateway, contractId: number, invoices: readonly OpenInvoice[], from: string, to: string, onContractRead: () => void,
): Promise<Decision[]> {
	const ledger = await gateway.getLedger(contractId, from, to)
	if (ledger.kind === 'contradictory') {
		return invoices.map(invoice => ({ invoice, verdict: { kind: 'contradictory', reason: ledger.reason }, source: 'ledger' }))
	}
	const missing = invoices.filter(invoice => !ledger.byInstallment.has(invoice.externalId) && !ledger.invalid.has(invoice.externalId))
	let pending: Map<string, Cents> | { reason: string } | undefined
	if (missing.length) {
		onContractRead()
		const reading = await gateway.getContract(contractId)
		pending = reading.kind === 'ok'
			? new Map(reading.installments.map(installment => [installment.externalId, installment.amountCents]))
			: { reason: `el contrato se contradice: ${reading.reason}` }
	}
	return invoices.map((invoice): Decision => {
		const unreadable = ledger.invalid.get(invoice.externalId)
		if (unreadable) return { invoice, verdict: { kind: 'contradictory', reason: unreadable }, source: 'ledger' }
		const rows: readonly LedgerRow[] = ledger.byInstallment.get(invoice.externalId) ?? []
		const open = { externalId: invoice.externalId, balanceCents: invoice.balanceCents }
		if (rows.length) return { invoice, verdict: classifyPayment(open, rows), source: 'ledger' }
		if (pending && !(pending instanceof Map)) return { invoice, verdict: { kind: 'contradictory', reason: pending.reason }, source: 'contract' }
		const inContract = pending instanceof Map ? pending.get(invoice.externalId) : undefined
		return { invoice, verdict: classifyPayment(open, [], inContract), source: inContract === undefined ? 'none' : 'contract' }
	})
}

function summary(counters: Counters): Counters {
	return Object.fromEntries(Object.entries(counters).filter(([, value]) => value !== 0))
}
