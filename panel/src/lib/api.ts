/** Typed client of the Cobrix API (src/cobrix/server/app.ts). */

export type RunKind = 'import' | 'paid'
export type RunStatus = 'running' | 'completed' | 'failed'

export interface Run {
	id: number
	kind: RunKind
	dryRun: boolean
	trigger: 'manual' | 'auto'
	status: RunStatus
	startedAt: string
	finishedAt: string | null
	counters: Record<string, number>
	warnings: number
	error: string | null
}

export interface RunItem {
	position: number
	contractId: number | null
	externalId: string | null
	customerId: string | null
	customerName: string | null
	result: string
	detail: string
	label: string | null
	amountCents: number | null
}

export interface Progress {
	runId: number
	kind: RunKind
	dryRun: boolean
	done: number
	total: number
	stage: string
}

export interface Company {
	name: string
	rif: string
	collectionsEmail: string
}

export interface Provider {
	name: string
	baseUrl: string
	username: string
	hasPassword: boolean
	importableStatuses: string[]
	windowMonths: number | null
	maxRecentPerContract: number | null
	excludedDocumentTypes: string[]
	graceDays: number
	ledgerMonths: number
	maxNewInvoices: number | null
	maxNewAmountCents: number | null
	autoEnabled: boolean
	autoTime: string | null
	autoLastDate: string | null
	updatedAt: string
}

export interface Settings {
	company: Company
	provider: Provider
	sandbox: { baseUrl: string; username: string; password: string } | null
}

export interface Summary {
	customers: number
	contracts: number
	openInvoices: number
	paidInvoices: number
	openAmountCents: number
	paidAmountCents: number
	aging: Array<{ bucket: string; label: string; invoices: number; amountCents: number }>
	overdueCustomers: number
	company: Company
	provider: { name: string; baseUrl: string; configured: boolean; autoEnabled: boolean; autoTime: string | null; autoLastDate: string | null }
	lastRuns: Run[]
	inProgress: Progress | null
	today: string
}

export interface CustomerRow {
	id: string
	document: string
	name: string
	personType: 'natural' | 'juridica'
	contracts: number
	openInvoices: number
	paidInvoices: number
	debtCents: number
	oldestDueDate: string | null
}

export interface CustomerFile {
	customer: {
		id: string
		document: string
		documentType: string | null
		personType: 'natural' | 'juridica'
		name: string
		email: string | null
		phone: string | null
		sourceContractId: number
		createdAt: string
	}
	contracts: Array<{ id: number; code: string; status: string; plan: string; planPriceCents: number; currency: string; branch: string; address: string | null }>
	invoices: Array<{
		id: number
		number: string
		externalId: string
		contractId: number
		label: string
		period: string
		dueDate: string
		cutoffDate: string
		totalCents: number
		balanceCents: number
		currency: string
		status: 'open' | 'paid'
		paidOn: string | null
		paidByInvoice: string | null
		ispBalanceCents: number | null
	}>
	events: Array<{ id: number; kind: string; detail: string; at: string; runId: number; invoiceNumber: string | null }>
}

export class ApiError extends Error {
	readonly status: number
	readonly fields: Record<string, string>
	constructor(status: number, message: string, fields: Record<string, string> = {}) {
		super(message)
		this.status = status
		this.fields = fields
	}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	let response: Response
	try {
		response = await fetch(path, {
			method,
			headers: body === undefined ? {} : { 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		})
	} catch {
		throw new ApiError(0, 'No hay conexión con el servidor de Cobrix. Verifica que siga en ejecución (npm start).')
	}
	const json = await response.json().catch(() => ({})) as Record<string, unknown>
	if (!response.ok) {
		throw new ApiError(response.status, typeof json.error === 'string' ? json.error : `Error ${response.status}`, (json.fields ?? {}) as Record<string, string>)
	}
	return json as T
}

export const api = {
	summary: () => request<Summary>('GET', '/api/summary'),
	settings: () => request<Settings>('GET', '/api/settings'),
	saveCompany: (company: Company) => request<Settings>('PUT', '/api/settings/company', company),
	saveProvider: (provider: Record<string, unknown>) => request<Settings>('PUT', '/api/settings/provider', provider),
	testConnection: (values: Record<string, unknown>) =>
		request<{ ok: boolean; contracts?: number; message: string; kind?: string }>('POST', '/api/settings/provider/test', values),
	runs: (limit = 50) => request<{ runs: Run[]; inProgress: Progress | null }>('GET', `/api/runs?limit=${limit}`),
	run: (id: number) => request<Run & { items: RunItem[] }>('GET', `/api/runs/${id}`),
	launch: (kind: RunKind, dryRun: boolean) => request<{ runId: number }>('POST', '/api/runs', { kind, dryRun }),
	customers: (q: string) => request<{ customers: CustomerRow[] }>('GET', `/api/customers?q=${encodeURIComponent(q)}`),
	customer: (id: string) => request<CustomerFile>('GET', `/api/customers/${encodeURIComponent(id)}`),
}
