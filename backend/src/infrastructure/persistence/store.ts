/**
 * PostgreSQL implementation of the application's Store port. Every SQL statement the use cases
 * need lives here; read models for the panel live in read-models.ts.
 */

import {
	RunInProgressError, type CompanyRecord, type ContractRepository, type Counters, type CustomerRepository, type EventRepository,
	type ExistingInvoice, type InvoiceRepository, type OpenInvoice, type ProviderRecord, type ProviderUpdate, type Repositories,
	type RunItem, type RunRepository, type SettingsRepository, type Store,
} from '../../application/ports/store.ts'
import type { DocumentType } from '../../domain/identification.ts'
import { toCents } from '../../domain/money.ts'
import type { Database, Queryable } from './database.ts'

type Row = Record<string, unknown>
const toAmount = (cents: number | null) => (cents === null ? null : cents / 100)

function runRepository(db: Queryable): RunRepository {
	return {
		async start(kind, dryRun, trigger) {
			try {
				// Consecutive ids (a sequence would skip values after an abrupt stop). A concurrent start fails
				// on the run_one_in_progress index or on the key, and both mean «another run is in progress».
				const [row] = await db.query<{ id: number }>(
					'INSERT INTO run (id, kind, dry_run, trigger) VALUES ((SELECT COALESCE(max(id), 0) + 1 FROM run), $1, $2, $3) RETURNING id',
					[kind, dryRun, trigger],
				)
				return (row as { id: number }).id
			} catch (error) {
				if (error instanceof Error && /run_one_in_progress|duplicate key/.test(error.message)) throw new RunInProgressError()
				throw error
			}
		},
		async addItems(runId, items: readonly RunItem[]) {
			const CHUNK = 400
			const [last] = await db.query<{ n: number }>('SELECT COALESCE(max(position) + 1, 0)::int AS n FROM run_item WHERE run_id = $1', [runId])
			const offset = last?.n ?? 0
			for (let start = 0; start < items.length; start += CHUNK) {
				const chunk = items.slice(start, start + CHUNK)
				const params: unknown[] = []
				const values = chunk.map((item, i) => {
					params.push(runId, offset + start + i, item.contractId, item.externalId, item.customerId, item.customerName,
						item.result, item.detail, item.label, toAmount(item.amountCents))
					return `(${Array.from({ length: 10 }, (_, k) => `$${i * 10 + k + 1}`).join(', ')})`
				})
				await db.query(
					`INSERT INTO run_item (run_id, position, contract_id, external_id, customer_id, customer_name, result, detail, label, amount) VALUES ${values.join(', ')}`,
					params,
				)
			}
		},
		async complete(runId, counters: Counters, warnings) {
			await db.query(`UPDATE run SET status = 'completed', finished_at = now(), counters = $2, warnings = $3 WHERE id = $1`, [runId, JSON.stringify(counters), warnings])
		},
		async fail(runId, counters: Counters, message) {
			await db.query(`UPDATE run SET status = 'failed', finished_at = now(), counters = $2, error = $3 WHERE id = $1`, [runId, JSON.stringify(counters), message])
		},
	}
}

function customerRepository(db: Queryable): CustomerRepository {
	return {
		async existingIds() {
			return new Set((await db.query<{ id: string }>('SELECT id FROM customer')).map(row => row.id))
		},
		async create(customer, runId) {
			const rows = await db.query(
				`INSERT INTO customer (id, document, document_type, person_type, name, email, phone, source_contract_id, created_run_id)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING id`,
				[customer.id, customer.document, customer.documentType, customer.personType, customer.name, customer.email, customer.phone, customer.sourceContractId, runId],
			)
			return rows.length > 0
		},
	}
}

function contractRepository(db: Queryable): ContractRepository {
	return {
		async upsert(contract, customerId) {
			await db.query(
				`INSERT INTO contract (id, customer_id, code, status, plan, plan_price, currency, branch, address)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				 ON CONFLICT (id) DO UPDATE SET customer_id = $2, code = $3, status = $4, plan = $5, plan_price = $6,
					currency = $7, branch = $8, address = $9, updated_at = now()`,
				[contract.id, customerId, contract.code, contract.status, contract.plan, contract.planPriceCents / 100, contract.currency, contract.branch, contract.address],
			)
		},
	}
}

function invoiceRepository(db: Queryable): InvoiceRepository {
	return {
		async existing(): Promise<ExistingInvoice[]> {
			const rows = await db.query<Row>('SELECT external_id, number, status, contract_id FROM invoice')
			return rows.map(row => ({ externalId: String(row.external_id), number: String(row.number), status: row.status as 'open' | 'paid', contractId: Number(row.contract_id) }))
		},
		async lastNumber() {
			const [row] = await db.query<{ n: number }>(`SELECT COALESCE(max(substring(number FROM 5)::int), 0)::int AS n FROM invoice`)
			return row?.n ?? 0
		},
		async create(invoice, runId) {
			const [row] = await db.query<{ id: number }>(
				`INSERT INTO invoice (number, external_id, customer_id, contract_id, label, period, due_date, cutoff_date, total, balance, currency, imported_run_id)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)
				 ON CONFLICT (external_id) DO NOTHING RETURNING id`,
				[invoice.number, invoice.externalId, invoice.customerId, invoice.contractId, invoice.label, invoice.period,
					invoice.dueDate, invoice.cutoffDate, invoice.amountCents / 100, invoice.currency, runId],
			)
			return row?.id
		},
		async open(): Promise<OpenInvoice[]> {
			const rows = await db.query<Row>(
				`SELECT i.id, i.number, i.external_id, i.contract_id, i.customer_id, c.name AS customer_name, i.label, i.balance::text
				 FROM invoice i JOIN customer c ON c.id = i.customer_id WHERE i.status = 'open' ORDER BY i.contract_id, i.period, i.id`,
			)
			return rows.map(row => ({
				id: Number(row.id), number: String(row.number), externalId: String(row.external_id), contractId: Number(row.contract_id),
				customerId: String(row.customer_id), customerName: String(row.customer_name), label: String(row.label), balanceCents: toCents(row.balance) ?? 0,
			}))
		},
		async markPaid(invoiceId, paidOn, paidBy, runId) {
			const rows = await db.query(
				`UPDATE invoice SET status = 'paid', balance = 0, paid_on = $2, paid_by_invoice = $3, isp_balance = NULL, paid_run_id = $4
				 WHERE id = $1 AND status = 'open' RETURNING id`,
				[invoiceId, paidOn, paidBy, runId],
			)
			return rows.length > 0
		},
		async setIspBalance(invoiceId, cents) {
			await db.query('UPDATE invoice SET isp_balance = $2 WHERE id = $1', [invoiceId, toAmount(cents)])
		},
	}
}

function eventRepository(db: Queryable): EventRepository {
	return {
		async add(event) {
			await db.query('INSERT INTO event (customer_id, invoice_id, kind, run_id, detail) VALUES ($1, $2, $3, $4, $5)',
				[event.customerId, event.invoiceId, event.kind, event.runId, event.detail])
		},
	}
}

function settingsRepository(db: Queryable): SettingsRepository {
	return {
		async getCompany(): Promise<CompanyRecord> {
			const [row] = await db.query<Row>('SELECT name, rif, collections_email FROM company WHERE id = 1')
			return { name: String(row?.name ?? ''), rif: String(row?.rif ?? ''), collectionsEmail: String(row?.collections_email ?? '') }
		},
		async saveCompany(company) {
			await db.query('UPDATE company SET name = $1, rif = $2, collections_email = $3, updated_at = now() WHERE id = 1', [company.name, company.rif, company.collectionsEmail])
		},
		async getProvider(): Promise<ProviderRecord> {
			const [row] = await db.query<Row>(`SELECT *, to_char(auto_last_date, 'YYYY-MM-DD') AS auto_last, updated_at::text AS updated FROM provider WHERE id = 1`)
			const r = row ?? {}
			return {
				name: String(r.name ?? ''),
				baseUrl: String(r.base_url ?? ''),
				username: String(r.username ?? ''),
				passwordSealed: String(r.password_encrypted ?? ''),
				importableStatuses: (r.importable_statuses as string[] | undefined) ?? [],
				windowMonths: (r.window_months as number | null) ?? null,
				maxRecentPerContract: (r.max_recent_per_contract as number | null) ?? null,
				excludedDocumentTypes: ((r.excluded_document_types as string[] | undefined) ?? []) as DocumentType[],
				graceDays: Number(r.grace_days ?? 0),
				ledgerMonths: Number(r.ledger_months ?? 7),
				maxNewInvoices: (r.max_new_invoices as number | null) ?? null,
				maxNewAmountCents: r.max_new_amount === null || r.max_new_amount === undefined ? null : toCents(r.max_new_amount) ?? null,
				autoEnabled: Boolean(r.auto_enabled),
				autoTime: (r.auto_time as string | null) ?? null,
				autoLastDate: (r.auto_last as string | null) ?? null,
				updatedAt: String(r.updated ?? ''),
			}
		},
		async saveProvider(provider: ProviderUpdate) {
			await db.query(
				`UPDATE provider SET name = $1, base_url = $2, username = $3,
					password_encrypted = COALESCE($4, password_encrypted),
					importable_statuses = $5, window_months = $6, max_recent_per_contract = $7, grace_days = $8,
					ledger_months = $9, max_new_invoices = $10, max_new_amount = $11, excluded_document_types = $12,
					auto_enabled = $13, auto_time = $14, updated_at = now()
				 WHERE id = 1`,
				[
					provider.name, provider.baseUrl, provider.username, provider.passwordSealed ?? null,
					provider.importableStatuses, provider.windowMonths, provider.maxRecentPerContract, provider.graceDays,
					provider.ledgerMonths, provider.maxNewInvoices, toAmount(provider.maxNewAmountCents), provider.excludedDocumentTypes,
					provider.autoEnabled, provider.autoTime,
				],
			)
		},
		async claimAutoRun(day) {
			const rows = await db.query(
				`UPDATE provider SET auto_last_date = $1 WHERE id = 1 AND (auto_last_date IS NULL OR auto_last_date < $1::date) RETURNING id`,
				[day],
			)
			return rows.length > 0
		},
		async releaseAutoRun(day) {
			await db.query('UPDATE provider SET auto_last_date = NULL WHERE id = 1 AND auto_last_date = $1::date', [day])
		},
	}
}

function repositories(db: Queryable): Repositories {
	return {
		runs: runRepository(db),
		customers: customerRepository(db),
		contracts: contractRepository(db),
		invoices: invoiceRepository(db),
		events: eventRepository(db),
		settings: settingsRepository(db),
	}
}

export function createStore(db: Database): Store {
	return {
		...repositories(db),
		transaction: work => db.transaction(tx => work(repositories(tx))),
	}
}
