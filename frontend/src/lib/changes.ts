/**
 * From runs to changes the operator understands. A run stores one technical row per installment
 * or invoice; here they become groups: what arrives, what gets paid, what stays open with a
 * warning, what does not arrive and why. Used by the review (preview) screen, the result screen
 * and the run detail, so all three tell the same story.
 */

import { api, type Run, type RunItem, type RunKind } from './api'
import { resultInfo, type ResultGroup } from './vocabulary'

export type RunWithItems = Run & { items: RunItem[] }

/** Launches a run and waits until it ends. The live progress keeps arriving through SSE meanwhile. */
export async function runAndWait(kind: RunKind, dryRun: boolean): Promise<RunWithItems> {
	const { runId } = await api.launch(kind, dryRun)
	for (;;) {
		const run = await api.run(runId)
		if (run.status !== 'running') return run
		await new Promise(resolve => setTimeout(resolve, 350))
	}
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «PLAN3MB20 - 2026 Agosto» → «agosto 2026». */
export function monthOf(label: string | null): string {
	if (!label) return ''
	const match = /(\d{4})\s+(\p{L}+)$/u.exec(label.trim())
	return match ? `${(match[2] as string).toLowerCase()} ${match[1]}` : label
}

/** «… factura del administrador 008800118 del 2026-10-13» → «recibo 008800118 del 13 oct». */
export function receiptOf(detail: string): string | null {
	const match = /administrador (\S+) del (\d{4})-(\d{2})-(\d{2})/.exec(detail)
	if (!match) return null
	return `recibo ${match[1]} del ${Number(match[4])} ${MONTHS[Number(match[3]) - 1]?.slice(0, 3)}`
}

export interface CustomerChange {
	readonly customerId: string | null
	readonly customerName: string
	readonly items: readonly RunItem[]
	readonly months: string
	readonly amountCents: number
	readonly note: string | null
}

export interface ReasonGroup {
	readonly result: string
	readonly label: string
	readonly why: string
	readonly count: number
	readonly who: string
}

export interface Changes {
	readonly newInvoices: readonly CustomerChange[]
	readonly newCount: number
	readonly newAmountCents: number
	readonly newCustomers: number
	readonly paid: readonly CustomerChange[]
	readonly paidCount: number
	readonly paidAmountCents: number
	readonly partial: readonly CustomerChange[]
	readonly unchanged: number
	readonly excluded: readonly ReasonGroup[]
	readonly excludedCount: number
	readonly attention: readonly ReasonGroup[]
	readonly attentionCount: number
}

function byCustomer(items: readonly RunItem[], note: (item: RunItem) => string | null = () => null): CustomerChange[] {
	const groups = new Map<string, RunItem[]>()
	for (const item of items) {
		const key = item.customerName ?? `Contrato ${item.contractId ?? '—'}`
		groups.set(key, [...(groups.get(key) ?? []), item])
	}
	return [...groups.entries()].map(([customerName, rows]) => ({
		customerId: rows[0]?.customerId ?? null,
		customerName,
		items: rows,
		months: rows.map(row => monthOf(row.label)).filter(Boolean).join(', '),
		amountCents: rows.reduce((sum, row) => sum + (row.amountCents ?? 0), 0),
		note: note(rows[0] as RunItem),
	}))
}

function byReason(items: readonly RunItem[]): ReasonGroup[] {
	const groups = new Map<string, RunItem[]>()
	for (const item of items) groups.set(item.result, [...(groups.get(item.result) ?? []), item])
	return [...groups.entries()]
		.map(([result, rows]) => {
			const info = resultInfo(result)
			const names = [...new Set(rows.map(row => row.customerName ?? `contrato ${row.contractId}`))]
			return { result, label: info.label, why: info.why, count: rows.length, who: names.join(' · ') }
		})
		.sort((a, b) => b.count - a.count)
}

/** Builds the changes of one or more runs (e.g. the import and the paid preview of one sync). */
export function changesOf(runs: readonly RunWithItems[]): Changes {
	// When both runs are reviewed together, the collections run explains what the import run can
	// only flag («no longer pending»), and «unchanged» means the invoices still open: counting the
	// import's «already there» too would count the same invoices twice.
	const combined = runs.some(run => run.kind === 'import') && runs.some(run => run.kind === 'paid')
	const items = runs.flatMap(run => run.items.filter(item =>
		!(combined && run.kind === 'import' && (item.result === 'no_longer_pending' || item.result === 'already_imported'))))
	const of = (group: ResultGroup) => items.filter(item => resultInfo(item.result).group === group)
	const newItems = of('new')
	const paidItems = of('paid')
	const excluded = byReason(of('excluded'))
	const attention = byReason(of('attention'))
	const newCustomers = runs.reduce((sum, run) => sum + (run.counters.customersCreated ?? 0) + (run.counters.customersWouldCreate ?? 0), 0)
	return {
		newInvoices: byCustomer(newItems),
		newCount: newItems.length,
		newAmountCents: newItems.reduce((sum, item) => sum + (item.amountCents ?? 0), 0),
		newCustomers,
		paid: byCustomer(paidItems, item => receiptOf(item.detail)),
		paidCount: paidItems.length,
		paidAmountCents: paidItems.reduce((sum, item) => sum + (item.amountCents ?? 0), 0),
		partial: byCustomer(of('partial'), item => item.detail.replace(/^abono parcial: /, '').replace(/\. Sigue abierta.*$/, '.')),
		unchanged: of('unchanged').filter(item => item.result !== 'no_debt').length,
		excluded,
		excludedCount: excluded.reduce((sum, group) => sum + group.count, 0),
		attention,
		attentionCount: attention.reduce((sum, group) => sum + group.count, 0),
	}
}
