/**
 * Company and provider settings (ENUNCIADO §3.1): reading, validation and saving.
 * The password is write-only: it is never sent back, and an empty value keeps the current one.
 */

import type { Database, Queryable } from './db/database.ts'
import type { SecretBox } from './db/secret.ts'
import { KNOWN_STATUSES } from './domain/contract.ts'
import { DOCUMENT_TYPES, type DocumentType } from './domain/identification.ts'
import type { ImportRules } from './domain/import-rules.ts'
import { toCents, type Cents } from './domain/money.ts'

export interface Company {
	readonly name: string
	readonly rif: string
	readonly collectionsEmail: string
}

export interface ProviderSettings extends ImportRules {
	readonly name: string
	readonly baseUrl: string
	readonly username: string
	readonly hasPassword: boolean
	readonly graceDays: number
	/** Months of the ledger read by «Actualizar pagadas». */
	readonly ledgerMonths: number
	readonly maxNewInvoices: number | null
	readonly maxNewAmountCents: Cents | null
	readonly autoEnabled: boolean
	/** `HH:MM`, America/Caracas. */
	readonly autoTime: string | null
	readonly autoLastDate: string | null
	readonly updatedAt: string
}

export const WINDOW_OPTIONS = [3, 6, 9, 12] as const

export type FieldErrors = Record<string, string>

export class ValidationError extends Error {
	readonly fields: FieldErrors
	constructor(fields: FieldErrors) {
		super('Revisa los campos marcados.')
		this.fields = fields
	}
}

type Row = Record<string, unknown>

export async function getCompany(db: Queryable): Promise<Company> {
	const [row] = await db.query<Row>('SELECT name, rif, collections_email FROM company WHERE id = 1')
	return { name: String(row?.name ?? ''), rif: String(row?.rif ?? ''), collectionsEmail: String(row?.collections_email ?? '') }
}

export async function getProvider(db: Queryable): Promise<ProviderSettings> {
	const [row] = await db.query<Row>(`SELECT *, to_char(auto_last_date, 'YYYY-MM-DD') AS auto_last, updated_at::text AS updated FROM provider WHERE id = 1`)
	const r = row ?? {}
	return {
		name: String(r.name ?? ''),
		baseUrl: String(r.base_url ?? ''),
		username: String(r.username ?? ''),
		hasPassword: String(r.password_encrypted ?? '') !== '',
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
}

/** The decrypted password, only for the sync. `undefined` if it cannot be decrypted. */
export async function getProviderPassword(db: Queryable, secrets: SecretBox): Promise<string | undefined> {
	const [row] = await db.query<{ password_encrypted: string }>('SELECT password_encrypted FROM provider WHERE id = 1')
	return secrets.open(row?.password_encrypted ?? '')
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export async function saveCompany(db: Queryable, input: Row): Promise<Company> {
	const errors: FieldErrors = {}
	const name = str(input.name)
	const rif = str(input.rif).toUpperCase()
	const collectionsEmail = str(input.collectionsEmail).toLowerCase()
	if (!name) errors.name = 'Escribe el nombre de la empresa.'
	if (!/^[VEJGP]-?\d{6,9}-?\d$/.test(rif)) errors.rif = 'El RIF debe verse así: J-12345678-9.'
	if (!EMAIL.test(collectionsEmail)) errors.collectionsEmail = 'Escribe un correo válido, p. ej. cobranza@tuempresa.com.'
	if (Object.keys(errors).length) throw new ValidationError(errors)
	await db.query('UPDATE company SET name = $1, rif = $2, collections_email = $3, updated_at = now() WHERE id = 1', [name, rif, collectionsEmail])
	return { name, rif, collectionsEmail }
}

/** Optional integer in [min, max]; '' / null = no value. */
function optionalInt(value: unknown, min: number, max: number): number | null | 'invalid' {
	if (value === null || value === undefined || value === '') return null
	const number = typeof value === 'number' ? value : Number(value)
	return Number.isInteger(number) && number >= min && number <= max ? number : 'invalid'
}

export async function saveProvider(db: Database, secrets: SecretBox, input: Row): Promise<ProviderSettings> {
	const errors: FieldErrors = {}
	const name = str(input.name) || 'Administrador de facturas'
	// Accepted with or without /api/v1: Cobrix adds it.
	const baseUrl = str(input.baseUrl).replace(/\/+$/, '').replace(/\/api\/v1$/i, '')
	try {
		const url = new URL(baseUrl)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') errors.baseUrl = 'La URL debe empezar con http:// o https://.'
	} catch {
		errors.baseUrl = 'Escribe la URL de la API, p. ej. http://127.0.0.1:4310.'
	}
	const username = str(input.username)
	if (!username) errors.username = 'Escribe el usuario o correo de la API.'
	const password = typeof input.password === 'string' ? input.password : ''
	const current = await getProvider(db)
	if (!password && !current.hasPassword) errors.password = 'Escribe la contraseña de la API.'

	const statuses = Array.isArray(input.importableStatuses) ? input.importableStatuses.map(String) : []
	if (statuses.length === 0) errors.importableStatuses = 'Elige al menos un estado; si no, nada se importa.'
	if (statuses.some(status => !(KNOWN_STATUSES as readonly string[]).includes(status))) errors.importableStatuses = 'Hay un estado que no existe.'

	const windowMonths = optionalInt(input.windowMonths, 3, 12)
	if (windowMonths === 'invalid' || (windowMonths !== null && !(WINDOW_OPTIONS as readonly number[]).includes(windowMonths))) {
		errors.windowMonths = 'La ventana es de 3, 6, 9 o 12 meses, o sin ventana.'
	}
	const maxRecent = optionalInt(input.maxRecentPerContract, 1, 60)
	if (maxRecent === 'invalid') errors.maxRecentPerContract = 'Entre 1 y 60, o vacío para todas.'
	const graceDays = optionalInt(input.graceDays ?? 0, 0, 60)
	if (graceDays === 'invalid' || graceDays === null) errors.graceDays = 'Entre 0 y 60 días.'
	// 0 means 12 months, as in Cobrix.
	const ledgerRaw = optionalInt(input.ledgerMonths ?? 7, 0, 12)
	if (ledgerRaw === 'invalid' || ledgerRaw === null) errors.ledgerMonths = 'Entre 0 y 12 meses (0 = 12).'
	const maxNewInvoices = optionalInt(input.maxNewInvoices, 1, 1_000_000)
	if (maxNewInvoices === 'invalid') errors.maxNewInvoices = 'Un número entero mayor que 0, o vacío para no limitar.'
	let maxNewAmountCents: number | null = null
	if (input.maxNewAmount !== null && input.maxNewAmount !== undefined && input.maxNewAmount !== '') {
		const cents = toCents(input.maxNewAmount)
		if (cents === undefined || cents === 0) errors.maxNewAmount = 'Un monto mayor que 0, o vacío para no limitar.'
		else maxNewAmountCents = cents
	}
	const excluded = Array.isArray(input.excludedDocumentTypes) ? input.excludedDocumentTypes.map(String) : []
	if (excluded.some(type => !(DOCUMENT_TYPES as readonly string[]).includes(type))) errors.excludedDocumentTypes = 'Tipo de documento desconocido.'
	const autoEnabled = input.autoEnabled === true
	const autoTime = str(input.autoTime) || null
	if (autoTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(autoTime)) errors.autoTime = 'Hora no válida (HH:MM).'
	if (autoEnabled && autoTime === null) errors.autoTime = 'Elige la hora de la corrida automática.'

	if (Object.keys(errors).length) throw new ValidationError(errors)

	await db.query(
		`UPDATE provider SET name = $1, base_url = $2, username = $3,
			password_encrypted = CASE WHEN $4 = '' THEN password_encrypted ELSE $4 END,
			importable_statuses = $5, window_months = $6, max_recent_per_contract = $7, grace_days = $8,
			ledger_months = $9, max_new_invoices = $10, max_new_amount = $11, excluded_document_types = $12,
			auto_enabled = $13, auto_time = $14, updated_at = now()
		WHERE id = 1`,
		[
			name, baseUrl, username, password ? secrets.seal(password) : '',
			KNOWN_STATUSES.filter(status => statuses.includes(status)), windowMonths, maxRecent, graceDays,
			ledgerRaw === 0 ? 12 : ledgerRaw, maxNewInvoices, maxNewAmountCents === null ? null : maxNewAmountCents / 100,
			DOCUMENT_TYPES.filter(type => excluded.includes(type)), autoEnabled, autoTime,
		],
	)
	return getProvider(db)
}
