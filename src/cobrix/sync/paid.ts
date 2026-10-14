/**
 * «Actualizar pagadas» (ENUNCIADO §3.3): checks every open Cobrix invoice against the
 * installment ledger (`pago_informacion`) and marks paid the ones the ISP fully collected.
 *
 * Per contract: one ledger read over the configured window (up to today). Installments the
 * ledger does not show (the current month may be missing until month end) are looked up in the
 * contract endpoint; if they are not there either, there is no evidence and nothing changes.
 */

import { addMonths } from '../../shared/dates.ts'
import { readContract } from '../domain/contract.ts'
import { readLedger, type LedgerRow } from '../domain/ledger.ts'
import { formatAmount, toCents, type Cents } from '../domain/money.ts'
import { classifyPayment, type PaymentVerdict } from '../domain/payment-rules.ts'
import { connect, describeError, failRun, finishRun, insertItems, mapLimit, startRun, type Counters, type RunItem, type RunOptions, type RunOutcome, type SyncDeps } from './runs.ts'

/** Counter names as in Cobrix. */
export const PAID_COUNTERS = [
	'invoicesChecked', 'invoicesMarkedPaid', 'invoicesWouldMarkPaid', 'invoicesStillOpen', 'invoicesPartiallyPaidAtIsp',
	'invoicesUnderReview', 'invoicesUnknown', 'lookupsFailed', 'contractsRead', 'amountMarkedPaidCents', 'amountWouldMarkPaidCents',
] as const

interface OpenInvoiceRow {
	id: number
	number: string
	external_id: string
	contract_id: number
	customer_id: string
	customer_name: string
	label: string
	balance: string
}

interface Decision {
	readonly invoice: OpenInvoiceRow
	readonly balanceCents: Cents
	readonly verdict: PaymentVerdict | { readonly kind: 'lookup_failed'; readonly reason: string }
	/** Where the evidence came from: the ledger or the contract endpoint. */
	readonly source: 'ledger' | 'contract' | 'none'
}

const CONCURRENCY = 4
const usd = (cents: Cents) => `USD ${formatAmount(cents)}`

export async function runPaid(deps: SyncDeps, options: RunOptions): Promise<RunOutcome> {
	const { db } = deps
	const runId = await startRun(db, 'paid', options.dryRun, options.trigger ?? 'manual')
	const counters: Counters = Object.fromEntries(PAID_COUNTERS.map(name => [name, 0]))
	const count = (name: (typeof PAID_COUNTERS)[number], by = 1) => { counters[name] = (counters[name] ?? 0) + by }
	const items: RunItem[] = []
	const progress = (done: number, total: number, stage: string) =>
		options.onProgress?.({ runId, kind: 'paid', dryRun: options.dryRun, done, total, stage })

	try {
		progress(0, 0, 'Conectando con el administrador de facturas')
		const open = await db.query<OpenInvoiceRow>(
			`SELECT i.id, i.number, i.external_id, i.contract_id, i.customer_id, c.name AS customer_name, i.label, i.balance::text
			 FROM invoice i JOIN customer c ON c.id = i.customer_id WHERE i.status = 'open' ORDER BY i.contract_id, i.period, i.id`,
		)
		const byContract = new Map<number, OpenInvoiceRow[]>()
		for (const invoice of open) byContract.set(invoice.contract_id, [...(byContract.get(invoice.contract_id) ?? []), invoice])
		const contracts = [...byContract.keys()]

		const { client, provider } = await connect(deps)
		await client.login()
		const today = deps.today()
		const from = `${addMonths(today.slice(0, 7), -provider.ledgerMonths)}-01`
		progress(0, contracts.length, 'Revisando el libro de cuotas')

		let done = 0
		const decisions = (await mapLimit(contracts, CONCURRENCY, async contractId => {
			const invoices = byContract.get(contractId) as OpenInvoiceRow[]
			const decide = (invoice: OpenInvoiceRow, verdict: Decision['verdict'], source: Decision['source']): Decision =>
				({ invoice, balanceCents: toCents(invoice.balance) ?? 0, verdict, source })
			try {
				const ledger = readLedger(contractId, await client.getLedger(contractId, from, today))
				if (ledger.kind === 'contradictory') {
					return invoices.map(invoice => decide(invoice, { kind: 'contradictory', reason: ledger.reason }, 'ledger'))
				}
				const missing = invoices.filter(invoice => !ledger.byInstallment.has(invoice.external_id) && !ledger.invalid.has(invoice.external_id))
				let pending: Map<string, Cents> | { reason: string } | undefined
				if (missing.length) {
					count('contractsRead')
					const reading = readContract(contractId, await client.getContract(contractId))
					pending = reading.kind === 'ok'
						? new Map(reading.installments.map(item => [item.externalId, item.amountCents]))
						: { reason: `el contrato se contradice: ${reading.reason}` }
				}
				return invoices.map(invoice => {
					const unreadable = ledger.invalid.get(invoice.external_id)
					if (unreadable) return decide(invoice, { kind: 'contradictory', reason: unreadable }, 'ledger')
					const rows: readonly LedgerRow[] = ledger.byInstallment.get(invoice.external_id) ?? []
					if (rows.length) return decide(invoice, classifyPayment({ externalId: invoice.external_id, balanceCents: toCents(invoice.balance) ?? 0 }, rows), 'ledger')
					if (pending && !(pending instanceof Map)) return decide(invoice, { kind: 'contradictory', reason: pending.reason }, 'contract')
					const inContract = pending instanceof Map ? pending.get(invoice.external_id) : undefined
					return decide(invoice, classifyPayment({ externalId: invoice.external_id, balanceCents: toCents(invoice.balance) ?? 0 }, [], inContract),
						inContract === undefined ? 'none' : 'contract')
				})
			} catch (error) {
				count('lookupsFailed')
				return invoices.map(invoice => decide(invoice, { kind: 'lookup_failed', reason: describeError(error) }, 'none'))
			} finally {
				progress(++done, contracts.length, 'Revisando el libro de cuotas')
			}
		})).flat()

		const paid: Array<Decision & { verdict: Extract<PaymentVerdict, { kind: 'paid' }> }> = []
		const partial: Array<{ id: number; ispBalanceCents: Cents }> = []
		for (const decision of decisions) {
			const { invoice, verdict, balanceCents, source } = decision
			count('invoicesChecked')
			const base = {
				contractId: invoice.contract_id, externalId: invoice.external_id, customerId: invoice.customer_id,
				customerName: invoice.customer_name, label: invoice.label, amountCents: balanceCents,
			}
			const where = source === 'contract' ? 'el contrato (el libro aún no la muestra)' : 'el libro'
			switch (verdict.kind) {
				case 'paid':
					paid.push({ ...decision, verdict })
					count(options.dryRun ? 'invoicesWouldMarkPaid' : 'invoicesMarkedPaid')
					count(options.dryRun ? 'amountWouldMarkPaidCents' : 'amountMarkedPaidCents', balanceCents)
					items.push({ ...base, result: options.dryRun ? 'would_mark_paid' : 'marked_paid',
						detail: `${invoice.number} · factura del administrador ${verdict.paidBy.invoiceNumber || verdict.paidBy.invoiceId} del ${verdict.paidOn}` })
					break
				case 'partial':
					partial.push({ id: invoice.id, ispBalanceCents: verdict.ispBalanceCents })
					count('invoicesPartiallyPaidAtIsp')
					items.push({ ...base, result: 'partial',
						detail: `abono parcial: el administrador debe ${usd(verdict.ispBalanceCents)} y Cobrix ${usd(balanceCents)}. Sigue abierta: solo se aplican cuotas saldadas.` })
					break
				case 'still_open':
					count('invoicesStillOpen')
					items.push({ ...base, result: 'still_open', detail: `sigue pendiente según ${where}` })
					break
				case 'balance_increased':
					count('invoicesUnderReview')
					items.push({ ...base, result: 'under_review',
						detail: `el administrador ahora debe ${usd(verdict.ispBalanceCents)}, más que en Cobrix (${usd(balanceCents)}): revisar, quizá se anuló un cobro` })
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

		if (options.dryRun) {
			await insertItems(db, runId, items)
			await finishRun(db, runId, counters, counters.lookupsFailed ?? 0)
			return { runId, status: 'completed', counters }
		}

		progress(contracts.length, contracts.length, 'Guardando')
		await db.transaction(async tx => {
			for (const { invoice, verdict } of paid) {
				const updated = await tx.query(
					`UPDATE invoice SET status = 'paid', balance = 0, paid_on = $2, paid_by_invoice = $3, isp_balance = NULL, paid_run_id = $4
					 WHERE id = $1 AND status = 'open' RETURNING id`,
					[invoice.id, verdict.paidOn, verdict.paidBy.invoiceNumber || String(verdict.paidBy.invoiceId), runId],
				)
				if (!updated.length) continue
				await tx.query('INSERT INTO event (customer_id, invoice_id, kind, run_id, detail) VALUES ($1, $2, $3, $4, $5)', [
					invoice.customer_id, invoice.id, 'invoice_paid', runId,
					`Pagada en el administrador (factura del administrador ${verdict.paidBy.invoiceNumber || verdict.paidBy.invoiceId} del ${verdict.paidOn})`,
				])
			}
			// The ISP balance is kept for display only; Cobrix's balance does not change on a partial payment.
			const settled = decisions.filter(d => d.verdict.kind !== 'lookup_failed' && d.verdict.kind !== 'partial').map(d => d.invoice.id)
			if (settled.length) await tx.query(`UPDATE invoice SET isp_balance = NULL WHERE id = ANY($1::int[])`, [settled])
			for (const { id, ispBalanceCents } of partial) {
				await tx.query('UPDATE invoice SET isp_balance = $2 WHERE id = $1', [id, ispBalanceCents / 100])
			}
			await insertItems(tx, runId, items)
			await finishRun(tx, runId, counters, counters.lookupsFailed ?? 0)
		})
		return { runId, status: 'completed', counters }
	} catch (error) {
		await insertItems(db, runId, items).catch(() => undefined)
		const message = await failRun(db, runId, counters, error)
		return { runId, status: 'failed', counters, error: message }
	}
}
