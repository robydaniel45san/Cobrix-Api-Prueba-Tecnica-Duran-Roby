/**
 * HTTP transport of the invoice manager API: session, retries and timeouts. It returns response
 * bodies as `unknown`; the mappers in this folder translate them into domain terms.
 *
 * - The token lasts 2 h and cannot be refreshed: it is renewed by logging in again a minute
 *   before it expires (the expiry comes as naive UTC) or after a 401. Concurrent requests share
 *   a single login.
 * - `/usuario/me` always answers 500, so it is never used.
 * - Passwords and tokens are never logged.
 */

import { InvoiceManagerError, type InvoiceManagerCredentials } from '../../application/ports/invoice-manager.ts'
import { silentLogger, type Logger } from '../../application/ports/logger.ts'

export interface HttpClientOptions {
	readonly fetch?: typeof fetch
	readonly timeoutMs?: number
	/** Retries for network errors and 5xx. 4xx are never retried. */
	readonly retries?: number
	readonly now?: () => number
	readonly logger?: Logger
}

const RENEW_MARGIN_MS = 60_000

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const route = (path: string) => path.split('?')[0] as string

/** The human message of the API's error bodies (`detail.mensaje`, `detail`, list of field errors). */
function apiMessage(body: unknown): string | undefined {
	if (Array.isArray(body)) {
		const messages = body.filter(isRow).map(item => [item.field, item.message].filter(Boolean).join(': '))
		return messages.length ? messages.join('; ') : undefined
	}
	if (!isRow(body)) return undefined
	if (isRow(body.detail) && typeof body.detail.mensaje === 'string') return body.detail.mensaje
	if (typeof body.detail === 'string') return body.detail
	return undefined
}

export class InvoiceManagerHttpClient {
	private readonly base: string
	private readonly credentials: InvoiceManagerCredentials
	private readonly fetch: typeof fetch
	private readonly timeoutMs: number
	private readonly retries: number
	private readonly now: () => number
	private readonly log: Logger
	private token: { value: string; expiresAt: number } | undefined
	/** Single flight: concurrent requests that need a token wait for the same login. */
	private loggingIn: Promise<void> | undefined

	constructor(credentials: InvoiceManagerCredentials, options: HttpClientOptions = {}) {
		let url: URL
		try {
			url = new URL(credentials.baseUrl)
		} catch {
			throw new InvoiceManagerError('config', `La URL de la API «${credentials.baseUrl}» no es válida. Revísala en Configuración.`)
		}
		if (!credentials.username || !credentials.password) {
			throw new InvoiceManagerError('config', 'Falta el usuario o la contraseña de la API. Complétalos en Configuración.')
		}
		this.base = url.toString().replace(/\/+$/, '')
		this.credentials = credentials
		this.fetch = options.fetch ?? globalThis.fetch
		this.timeoutMs = options.timeoutMs ?? 15_000
		this.retries = options.retries ?? 2
		this.now = options.now ?? Date.now
		this.log = (options.logger ?? silentLogger).child({ component: 'invoice-manager', baseUrl: this.base })
	}

	async login(): Promise<void> {
		const body = await this.request('POST', '/usuario/login', {
			body: { user_name: this.credentials.username, password: this.credentials.password },
			authenticated: false,
		})
		if (!isRow(body) || typeof body.access_token !== 'string' || body.access_token === '') {
			throw new InvoiceManagerError('invalid_response', 'La API respondió al inicio de sesión sin token.')
		}
		// Naive UTC without zone: read it as UTC. If it cannot be read, assume the documented 2 h.
		const raw = typeof body.access_token_expires_in === 'string' ? body.access_token_expires_in : ''
		const parsed = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`)
		this.token = { value: body.access_token, expiresAt: Number.isFinite(parsed) ? parsed : this.now() + 7_200_000 }
		this.log.info('isp.login', { user: this.credentials.username, expiresAt: new Date(this.token.expiresAt).toISOString() })
	}

	get(path: string): Promise<unknown> {
		return this.request('GET', path)
	}

	private async authorization(): Promise<string> {
		while (!this.token || this.token.expiresAt - RENEW_MARGIN_MS <= this.now()) {
			this.loggingIn ??= this.login().finally(() => { this.loggingIn = undefined })
			await this.loggingIn
		}
		return `Bearer ${this.token.value}`
	}

	private async request(method: 'GET' | 'POST', path: string, options: { body?: unknown; authenticated?: boolean } = {}): Promise<unknown> {
		const authenticated = options.authenticated ?? true
		let renewed = false
		for (let attempt = 1; ; attempt++) {
			const headers: Record<string, string> = { accept: 'application/json' }
			if (options.body !== undefined) headers['content-type'] = 'application/json'
			if (authenticated) headers.authorization = await this.authorization()
			const sentToken = headers.authorization
			const started = performance.now()

			let response: Response
			try {
				response = await this.fetch(`${this.base}/api/v1${path}`, {
					method,
					headers,
					...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
					signal: AbortSignal.timeout(this.timeoutMs),
				})
			} catch (error) {
				const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
				this.log.warn('isp.request_error', { method, path: route(path), attempt, error: timeout ? 'timeout' : 'network' })
				if (attempt <= this.retries) { await pause(attempt); continue }
				throw timeout
					? new InvoiceManagerError('timeout', `La API no respondió en ${this.timeoutMs / 1000} s (${route(path)}). Intenta de nuevo más tarde.`)
					: new InvoiceManagerError('network', `No se pudo conectar con la API en ${this.base}. Verifica la URL y que el servicio esté en línea.`)
			}

			const text = await response.text()
			const ms = Math.round(performance.now() - started)
			this.log.debug('isp.response', { method, path, status: response.status, ms, attempt })
			let body: unknown
			try {
				body = text === '' ? undefined : JSON.parse(text)
			} catch {
				if (response.ok) throw new InvoiceManagerError('invalid_response', `La API respondió algo que no es JSON en ${route(path)}.`, response.status)
				body = undefined
			}
			if (response.ok) return body

			const detail = apiMessage(body)
			if (response.status === 401 && authenticated && !renewed) {
				// Expired or revoked token: log in again once. Only drop it if nobody renewed it meanwhile.
				this.log.info('isp.token_rejected', { path: route(path) })
				if (this.token && `Bearer ${this.token.value}` === sentToken) this.token = undefined
				renewed = true
				continue
			}
			if (response.status >= 500 && attempt <= this.retries) {
				this.log.warn('isp.retry', { method, path: route(path), status: response.status, attempt })
				await pause(attempt)
				continue
			}
			this.log.warn('isp.request_failed', { method, path: route(path), status: response.status, detail })
			if (!authenticated || response.status === 401) {
				throw new InvoiceManagerError('auth', `La API rechazó las credenciales${detail ? `: «${detail}»` : ''}. Revisa el usuario y la contraseña en Configuración.`, response.status)
			}
			throw new InvoiceManagerError('http', `La API respondió ${response.status} en ${route(path)}${detail ? `: «${detail}»` : ''}.`, response.status)
		}
	}
}

function pause(attempt: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 200 * 2 ** (attempt - 1)))
}
