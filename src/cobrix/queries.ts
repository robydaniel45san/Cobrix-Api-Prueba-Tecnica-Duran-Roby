/**
 * Read models for the panel: summary, customers, customer file and runs.
 * Amounts leave the database as text (`numeric`) and are turned into cents here.
 */

import type { Queryable } from './db/database.ts'
import { toCents, type Cents } from './domain/money.ts'

type Row = Record<string, unknown>
const cents = (value: unknown): Cents => toCents(value) ?? 0

export interface Summary {
	readonly customers: number
	readonly contracts: number
	readonly openInvoices: number
	readonly paidInvoices: number
	readonly openAmountCents: Cents
	readonly paidAmountCents: Cents
	/** Open debt by days past due, as of `today`. */
	readonly aging: ReadonlyArray<{ readonly bucket: string; readonly label: string; readonly invoices: number; readonly amountCents: Cents }>
	readonly overdueCustomers: number
}

const AGING = [
	{ bucket: 'current', label: 'Del mes', max: 30 },
	{ bucket: '31-60', label: '31 a 60 días', max: 60 },
	{ bucket: '61-90', label: '61 a 90 días', max: 90 },
	{ bucket: '90+', label: 'Más de 90 días', max: Number.POSITIVE_INFINITY },
] as const

export async function getSummary(db: Queryable, today: string): Promise<Summary> {
	const [totals] = await db.query<Row>(
		`SELECT (SELECT count(*) FROM customer)::int AS customers, (SELECT count(*) FROM contract)::int AS contracts,
			count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'paid')::int AS paid,
			COALESCE(sum(balance) FILTER (WHERE status = 'open'), 0)::text AS open_amount,
			COALESCE(sum(total) FILTER (WHERE status = 'paid'), 0)::text AS paid_amount,
			count(DISTINCT customer_id) FILTER (WHERE status = 'open' AND cutoff_date < $1::date)::int AS overdue_customers
		 FROM invoice`,
		[today],
	)
	const open = await db.query<{ age: number; balance: string }>(
		`SELECT ($1::date - due_date)::int AS age, balance::text FROM invoice WHERE status = 'open'`,
		[today],
	)
	const aging = AGING.map(({ bucket, label }) => ({ bucket, label, invoices: 0, amountCents: 0 }))
	for (const row of open) {
		const index = AGING.findIndex(range => row.age <= range.max)
		const slot = aging[index] as { invoices: number; amountCents: number }
		slot.invoices++
		slot.amountCents += cents(row.balance)
	}
	const t = totals ?? {}
	return {
		customers: Number(t.customers ?? 0),
		contracts: Number(t.contracts ?? 0),
		openInvoices: Number(t.open ?? 0),
		paidInvoices: Number(t.paid ?? 0),
		openAmountCents: cents(t.open_amount),
		paidAmountCents: cents(t.paid_amount),
		aging,
		overdueCustomers: Number(t.overdue_customers ?? 0),
	}
}

export interface CustomerListItem {
	readonly id: string
	readonly document: string
	readonly name: string
	readonly personType: 'natural' | 'juridica'
	readonly contracts: number
	readonly openInvoices: number
	readonly paidInvoices: number
	readonly debtCents: Cents
	readonly oldestDueDate: string | null
}

export async function listCustomers(db: Queryable, search: string): Promise<CustomerListItem[]> {
	const text = search.trim()
	// A document is searched without separators or leading zeros, like the stored id.
	const compact = text.toUpperCase().replace(/[\s.\-_/]/g, '').replace(/^([VEJGP]?)0+/, '$1')
	const rows = await db.query<Row>(
		`SELECT c.id, c.document, c.name, c.person_type,
			(SELECT count(*) FROM contract k WHERE k.customer_id = c.id)::int AS contracts,
			count(i.id) FILTER (WHERE i.status = 'open')::int AS open,
			count(i.id) FILTER (WHERE i.status = 'paid')::int AS paid,
			COALESCE(sum(i.balance) FILTER (WHERE i.status = 'open'), 0)::text AS debt,
			to_char(min(i.due_date) FILTER (WHERE i.status = 'open'), 'YYYY-MM-DD') AS oldest_due
		 FROM customer c LEFT JOIN invoice i ON i.customer_id = c.id
		 WHERE $1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.document ILIKE '%' || $1 || '%'
			OR ($2 <> '' AND c.id ILIKE '%' || $2 || '%')
		 GROUP BY c.id
		 ORDER BY COALESCE(sum(i.balance) FILTER (WHERE i.status = 'open'), 0) DESC, c.name`,
		[text, compact],
	)
	return rows.map(row => ({
		id: String(row.id),
		document: String(row.document),
		name: String(row.name),
		personType: row.person_type as 'natural' | 'juridica',
		contracts: Number(row.contracts),
		openInvoices: Number(row.open),
		paidInvoices: Number(row.paid),
		debtCents: cents(row.debt),
		oldestDueDate: (row.oldest_due as string | null) ?? null,
	}))
}

export async function getCustomerFile(db: Queryable, id: string) {
	const [customer] = await db.query<Row>(
		`SELECT id, document, document_type, person_type, name, email, phone, source_contract_id, created_at::text AS created_at
		 FROM customer WHERE id = $1`,
		[id],
	)
	if (!customer) return undefined
	const contracts = await db.query<Row>(
		`SELECT id, code, status, plan, plan_price::text, currency, branch, address FROM contract WHERE customer_id = $1 ORDER BY id`,
		[id],
	)
	const invoices = await db.query<Row>(
		`SELECT id, number, external_id, contract_id, label, period, to_char(due_date, 'YYYY-MM-DD') AS due_date,
			to_char(cutoff_date, 'YYYY-MM-DD') AS cutoff_date, total::text, balance::text, currency, status,
			to_char(paid_on, 'YYYY-MM-DD') AS paid_on, paid_by_invoice, isp_balance::text
		 FROM invoice WHERE customer_id = $1 ORDER BY period DESC, contract_id, id`,
		[id],
	)
	const events = await db.query<Row>(
		`SELECT e.id, e.kind, e.detail, e.at::text AS at, e.run_id, i.number AS invoice_number
		 FROM event e LEFT JOIN invoice i ON i.id = e.invoice_id WHERE e.customer_id = $1 ORDER BY e.at DESC, e.id DESC`,
		[id],
	)
	return {
		customer: {
			id: String(customer.id),
			document: String(customer.document),
			documentType: (customer.document_type as string | null) ?? null,
			personType: customer.person_type as 'natural' | 'juridica',
			name: String(customer.name),
			email: (customer.email as string | null) ?? null,
			phone: (customer.phone as string | null) ?? null,
			sourceContractId: Number(customer.source_contract_id),
			createdAt: String(customer.created_at),
		},
		contracts: contracts.map(row => ({
			id: Number(row.id), code: String(row.code), status: String(row.status), plan: String(row.plan),
			planPriceCents: cents(row.plan_price), currency: String(row.currency), branch: String(row.branch),
			address: (row.address as string | null) ?? null,
		})),
		invoices: invoices.map(row => ({
			id: Number(row.id), number: String(row.number), externalId: String(row.external_id), contractId: Number(row.contract_id),
			label: String(row.label), period: String(row.period), dueDate: String(row.due_date), cutoffDate: String(row.cutoff_date),
			totalCents: cents(row.total), balanceCents: cents(row.balance), currency: String(row.currency),
			status: row.status as 'open' | 'paid', paidOn: (row.paid_on as string | null) ?? null,
			paidByInvoice: (row.paid_by_invoice as string | null) ?? null,
			ispBalanceCents: row.isp_balance === null ? null : cents(row.isp_balance),
		})),
		events: events.map(row => ({
			id: Number(row.id), kind: String(row.kind), detail: String(row.detail), at: String(row.at),
			runId: Number(row.run_id), invoiceNumber: (row.invoice_number as string | null) ?? null,
		})),
	}
}

function runRow(row: Row) {
	return {
		id: Number(row.id),
		kind: row.kind as 'import' | 'paid',
		dryRun: Boolean(row.dry_run),
		trigger: row.trigger as 'manual' | 'auto',
		status: row.status as 'running' | 'completed' | 'failed',
		startedAt: String(row.started_at),
		finishedAt: (row.finished_at as string | null) ?? null,
		counters: (row.counters ?? {}) as Record<string, number>,
		warnings: Number(row.warnings ?? 0),
		error: (row.error as string | null) ?? null,
	}
}

const RUN_COLUMNS = `id, kind, dry_run, trigger, status, started_at::text AS started_at, finished_at::text AS finished_at, counters, warnings, error`

export async function listRuns(db: Queryable, limit: number) {
	const rows = await db.query<Row>(`SELECT ${RUN_COLUMNS} FROM run ORDER BY id DESC LIMIT $1`, [limit])
	return rows.map(runRow)
}

export async function getRun(db: Queryable, id: number) {
	const [row] = await db.query<Row>(`SELECT ${RUN_COLUMNS} FROM run WHERE id = $1`, [id])
	if (!row) return undefined
	const items = await db.query<Row>(
		`SELECT position, contract_id, external_id, r.customer_id, customer_name, result, detail, label, amount::text,
			EXISTS (SELECT 1 FROM customer c WHERE c.id = r.customer_id) AS customer_exists
		 FROM run_item r WHERE run_id = $1 ORDER BY position`,
		[id],
	)
	return {
		...runRow(row),
		items: items.map(item => ({
			position: Number(item.position),
			contractId: (item.contract_id as number | null) ?? null,
			externalId: (item.external_id as string | null) ?? null,
			customerId: item.customer_exists ? String(item.customer_id) : null,
			customerName: (item.customer_name as string | null) ?? null,
			result: String(item.result),
			detail: String(item.detail),
			label: (item.label as string | null) ?? null,
			amountCents: item.amount === null ? null : cents(item.amount),
		})),
	}
}
