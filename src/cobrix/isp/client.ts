/**
 * HTTP client of the invoice manager API. It knows the transport (login, token, retries,
 * timeouts) and returns response bodies as `unknown`: the domain reads them strictly.
 *
 * - The token lasts 2 h and cannot be refreshed: it is renewed by logging in again a minute
 *   before it expires (the expiry comes as naive UTC) or after a 401.
 * - `lista_ids_contratos` is called WITHOUT `estado`: any value returns only active contracts.
 * - `/usuario/me` always answers 500, so it is never used.
 */

export interface IspCredentials {
	readonly baseUrl: string
	readonly username: string
	readonly password: string
}

export interface IspClientOptions {
	readonly fetch?: typeof fetch
	readonly timeoutMs?: number
	/** Retries for network errors and 5xx. 4xx are never retried. */
	readonly retries?: number
	readonly now?: () => number
}

export type IspErrorKind = 'config' | 'network' | 'timeout' | 'auth' | 'http' | 'invalid_response'

/** An error with a message meant for the collections operator: what happened and what to do. */
export class IspError extends Error {
	readonly kind: IspErrorKind
	readonly status: number | undefined
	constructor(kind: IspErrorKind, message: string, status?: number) {
		super(message)
		this.name = 'IspError'
		this.kind = kind
		this.status = status
	}
}

const RENEW_MARGIN_MS = 60_000

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Pulls the human message out of the API's error bodies (`detail.mensaje`, `detail`, list of errors). */
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

export class IspClient {
	private readonly base: string
	private readonly credentials: IspCredentials
	private readonly fetch: typeof fetch
	private readonly timeoutMs: number
	private readonly retries: number
	private readonly now: () => number
	private token: { value: string; expiresAt: number } | undefined
	/** Single flight: concurrent requests that need a token wait for the same login. */
	private loggingIn: Promise<void> | undefined

	constructor(credentials: IspCredentials, options: IspClientOptions = {}) {
		let url: URL
		try {
			url = new URL(credentials.baseUrl)
		} catch {
			throw new IspError('config', `La URL de la API «${credentials.baseUrl}» no es válida. Revísala en Configuración.`)
		}
		if (!credentials.username || !credentials.password) {
			throw new IspError('config', 'Falta el usuario o la contraseña de la API. Complétalos en Configuración.')
		}
		this.base = url.toString().replace(/\/+$/, '')
		this.credentials = credentials
		this.fetch = options.fetch ?? globalThis.fetch
		this.timeoutMs = options.timeoutMs ?? 15_000
		this.retries = options.retries ?? 2
		this.now = options.now ?? Date.now
	}

	async login(): Promise<void> {
		const body = await this.request('POST', '/usuario/login', {
			body: { user_name: this.credentials.username, password: this.credentials.password },
			authenticated: false,
		})
		if (!isRow(body) || typeof body.access_token !== 'string' || body.access_token === '') {
			throw new IspError('invalid_response', 'La API respondió al inicio de sesión sin token.')
		}
		// Naive UTC without zone: read it as UTC. If it cannot be read, assume the documented 2 h.
		const raw = typeof body.access_token_expires_in === 'string' ? body.access_token_expires_in : ''
		const parsed = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`)
		this.token = { value: body.access_token, expiresAt: Number.isFinite(parsed) ? parsed : this.now() + 7_200_000 }
	}

	/** Contract IDs, all statuses. Fails if the list does not match its own pagination. */
	async listContractIds(): Promise<number[]> {
		const body = await this.request('GET', '/isp/lista_ids_contratos')
		if (!isRow(body) || !Array.isArray(body.data) || !body.data.every(id => typeof id === 'number' && Number.isInteger(id))) {
			throw new IspError('invalid_response', 'La lista de contratos no tiene la forma esperada.')
		}
		const ids = body.data as number[]
		const total = isRow(body.pagination) ? body.pagination.total : undefined
		if (typeof total === 'number' && total !== ids.length) {
			throw new IspError('invalid_response', `La API dice que hay ${total} contratos pero envió ${ids.length}. No se sigue con una lista incompleta.`)
		}
		return [...new Set(ids)].sort((a, b) => a - b)
	}

	getContract(contractId: number): Promise<unknown> {
		return this.request('GET', `/isp/contrato/individual?id_contrato=${contractId}`)
	}

	getLedger(contractId: number, from: string, to: string): Promise<unknown> {
		const query = new URLSearchParams({ id_contrato: String(contractId), tipo_busqueda: 'CUOTA', fecha_inicio: from, fecha_fin: to })
		return this.request('GET', `/isp/pago_informacion?${query}`)
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
		for (let attempt = 0; ; attempt++) {
			const headers: Record<string, string> = { accept: 'application/json' }
			if (options.body !== undefined) headers['content-type'] = 'application/json'
			if (authenticated) headers.authorization = await this.authorization()
			const sentToken = headers.authorization

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
				if (attempt < this.retries) { await pause(attempt); continue }
				throw timeout
					? new IspError('timeout', `La API no respondió en ${this.timeoutMs / 1000} s (${path.split('?')[0]}). Intenta de nuevo más tarde.`)
					: new IspError('network', `No se pudo conectar con la API en ${this.base}. Verifica la URL y que el servicio esté en línea.`)
			}

			const text = await response.text()
			let body: unknown
			try {
				body = text === '' ? undefined : JSON.parse(text)
			} catch {
				if (response.ok) throw new IspError('invalid_response', `La API respondió algo que no es JSON en ${path.split('?')[0]}.`, response.status)
				body = undefined
			}
			if (response.ok) return body

			const detail = apiMessage(body)
			if (response.status === 401 && authenticated && !renewed) {
				// Expired or revoked token: log in again once. Only drop it if nobody renewed it meanwhile.
				if (this.token && `Bearer ${this.token.value}` === sentToken) this.token = undefined
				renewed = true
				continue
			}
			if (response.status >= 500 && attempt < this.retries) { await pause(attempt); continue }
			if (!authenticated || response.status === 401) {
				throw new IspError('auth', `La API rechazó las credenciales${detail ? `: «${detail}»` : ''}. Revisa el usuario y la contraseña en Configuración.`, response.status)
			}
			throw new IspError('http', `La API respondió ${response.status} en ${path.split('?')[0]}${detail ? `: «${detail}»` : ''}.`, response.status)
		}
	}
}

function pause(attempt: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 200 * 2 ** attempt))
}
