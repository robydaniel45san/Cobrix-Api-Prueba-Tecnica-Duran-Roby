/**
 * Company and provider settings (ENUNCIADO §3.1): validation and the public view of them.
 * The password is write-only: it is never returned, and an empty value keeps the current one.
 */

import { KNOWN_STATUSES } from '../domain/contract.ts'
import { DOCUMENT_TYPES } from '../domain/identification.ts'
import type { ImportRules } from '../domain/import-rules.ts'
import { toCents, type Cents } from '../domain/money.ts'
import type { Logger } from './ports/logger.ts'
import type { CompanyRecord, ProviderRecord, SecretCipher, SettingsRepository } from './ports/store.ts'

export type Company = CompanyRecord

/** The provider as the panel and the use cases see it: everything but the password. */
export interface ProviderSettings extends ImportRules {
	readonly name: string
	readonly baseUrl: string
	readonly username: string
	readonly hasPassword: boolean
	readonly graceDays: number
	readonly ledgerMonths: number
	readonly maxNewInvoices: number | null
	readonly maxNewAmountCents: Cents | null
	readonly autoEnabled: boolean
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
		this.name = 'ValidationError'
		this.fields = fields
	}
}

type Input = Record<string, unknown>

export function toProviderSettings(record: ProviderRecord): ProviderSettings {
	const { passwordSealed, ...rest } = record
	return { ...rest, hasPassword: passwordSealed !== '' }
}

export async function getProvider(settings: SettingsRepository): Promise<ProviderSettings> {
	return toProviderSettings(await settings.getProvider())
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Optional integer in [min, max]; '' / null = no value. */
function optionalInt(value: unknown, min: number, max: number): number | null | 'invalid' {
	if (value === null || value === undefined || value === '') return null
	const number = typeof value === 'number' ? value : Number(value)
	return Number.isInteger(number) && number >= min && number <= max ? number : 'invalid'
}

/** Accepted with or without `/api/v1` and trailing slashes: Cobrix adds the prefix. */
export function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, '').replace(/\/api\/v1$/i, '')
}

export async function saveCompany(settings: SettingsRepository, input: Input, logger: Logger): Promise<Company> {
	const errors: FieldErrors = {}
	const company = {
		name: text(input.name),
		rif: text(input.rif).toUpperCase(),
		collectionsEmail: text(input.collectionsEmail).toLowerCase(),
	}
	if (!company.name) errors.name = 'Escribe el nombre de la empresa.'
	if (!/^[VEJGP]-?\d{6,9}-?\d$/.test(company.rif)) errors.rif = 'El RIF debe verse así: J-12345678-9.'
	if (!EMAIL.test(company.collectionsEmail)) errors.collectionsEmail = 'Escribe un correo válido, p. ej. cobranza@tuempresa.com.'
	if (Object.keys(errors).length) throw new ValidationError(errors)
	await settings.saveCompany(company)
	logger.info('settings.company_saved', { name: company.name, rif: company.rif })
	return company
}

export async function saveProvider(settings: SettingsRepository, cipher: SecretCipher, input: Input, logger: Logger): Promise<ProviderSettings> {
	const errors: FieldErrors = {}
	const name = text(input.name) || 'Administrador de facturas'
	const baseUrl = normalizeBaseUrl(text(input.baseUrl))
	try {
		const url = new URL(baseUrl)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') errors.baseUrl = 'La URL debe empezar con http:// o https://.'
	} catch {
		errors.baseUrl = 'Escribe la URL de la API, p. ej. http://127.0.0.1:4310.'
	}
	const username = text(input.username)
	if (!username) errors.username = 'Escribe el usuario o correo de la API.'
	const password = typeof input.password === 'string' ? input.password : ''
	const current = await settings.getProvider()
	if (!password && current.passwordSealed === '') errors.password = 'Escribe la contraseña de la API.'

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
	const ledgerMonths = optionalInt(input.ledgerMonths ?? 7, 0, 12)
	if (ledgerMonths === 'invalid' || ledgerMonths === null) errors.ledgerMonths = 'Entre 0 y 12 meses (0 = 12).'
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
	const autoTime = text(input.autoTime) || null
	if (autoTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(autoTime)) errors.autoTime = 'Hora no válida (HH:MM).'
	if (autoEnabled && autoTime === null) errors.autoTime = 'Elige la hora de la corrida automática.'

	if (Object.keys(errors).length) throw new ValidationError(errors)

	await settings.saveProvider({
		name, baseUrl, username,
		...(password ? { passwordSealed: cipher.seal(password) } : {}),
		importableStatuses: KNOWN_STATUSES.filter(status => statuses.includes(status)),
		windowMonths: windowMonths as number | null,
		maxRecentPerContract: maxRecent as number | null,
		excludedDocumentTypes: DOCUMENT_TYPES.filter(type => excluded.includes(type)),
		graceDays: graceDays as number,
		ledgerMonths: ledgerMonths === 0 ? 12 : ledgerMonths as number,
		maxNewInvoices: maxNewInvoices as number | null,
		maxNewAmountCents,
		autoEnabled,
		autoTime,
	})
	logger.info('settings.provider_saved', { baseUrl, username, credentialsUpdated: password !== '', autoEnabled, autoTime })
	return getProvider(settings)
}
