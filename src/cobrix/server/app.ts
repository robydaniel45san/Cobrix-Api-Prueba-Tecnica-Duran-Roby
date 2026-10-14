/**
 * Cobrix HTTP server: the JSON API of the panel, the live progress stream (SSE) and the built
 * panel (`panel/dist`) as static files.
 *
 *   GET  /api/summary                      totals, debt aging, provider and last runs
 *   GET  /api/settings                     company and provider (never the password)
 *   PUT  /api/settings/company
 *   PUT  /api/settings/provider
 *   POST /api/settings/provider/test       log in with the form values, count contracts
 *   GET  /api/runs  ·  GET /api/runs/:id
 *   POST /api/runs                         { kind: 'import' | 'paid', dryRun } → 202 { runId }
 *   GET  /api/events                       Server-Sent Events: run progress and results
 *   GET  /api/customers?q=  ·  GET /api/customers/:id
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

import type { Database } from '../db/database.ts'
import type { SecretBox } from '../db/secret.ts'
import { IspClient, IspError, type IspClientOptions } from '../isp/client.ts'
import { getCustomerFile, getRun, getSummary, listCustomers, listRuns } from '../queries.ts'
import { getCompany, getProvider, getProviderPassword, saveCompany, saveProvider, ValidationError } from '../settings.ts'
import type { Runner } from '../sync/runner.ts'
import { RunInProgressError } from '../sync/runs.ts'

export interface ServerDeps {
	readonly db: Database
	readonly secrets: SecretBox
	readonly runner: Runner
	readonly today: () => string
	/** Folder with the built panel. Missing = API only. */
	readonly staticDir?: string
	readonly clientOptions?: IspClientOptions
	/** Values offered by «Usar el sandbox local» in Configuración. */
	readonly sandbox?: { readonly baseUrl: string; readonly username: string; readonly password: string }
}

type Row = Record<string, unknown>

class HttpError extends Error {
	readonly status: number
	readonly body: Row
	constructor(status: number, message: string, extra: Row = {}) {
		super(message)
		this.status = status
		this.body = { error: message, ...extra }
	}
}

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
}

async function readBody(req: IncomingMessage): Promise<Row> {
	const chunks: Buffer[] = []
	let size = 0
	for await (const chunk of req) {
		size += (chunk as Buffer).length
		if (size > 1_000_000) throw new HttpError(413, 'La solicitud es demasiado grande.')
		chunks.push(chunk as Buffer)
	}
	if (!chunks.length) return {}
	try {
		const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
		if (value && typeof value === 'object' && !Array.isArray(value)) return value as Row
	} catch {
		// fall through
	}
	throw new HttpError(400, 'El cuerpo de la solicitud no es un JSON válido.')
}

function send(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
	res.end(JSON.stringify(body))
}

export function createCobrixServer(deps: ServerDeps): Server {
	const { db, runner } = deps

	async function settings(): Promise<Row> {
		return { company: await getCompany(db), provider: await getProvider(db), sandbox: deps.sandbox ?? null }
	}

	async function testConnection(body: Row): Promise<Row> {
		const saved = await getProvider(db)
		const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v1$/i, '') : saved.baseUrl
		const username = typeof body.username === 'string' && body.username.trim() ? body.username.trim() : saved.username
		const typed = typeof body.password === 'string' ? body.password : ''
		const password = typed || (await getProviderPassword(db, deps.secrets)) || ''
		const started = Date.now()
		try {
			const client = new IspClient({ baseUrl, username, password }, { ...deps.clientOptions, retries: 0 })
			await client.login()
			const ids = await client.listContractIds()
			return { ok: true, contracts: ids.length, elapsedMs: Date.now() - started, message: `Conexión correcta: el administrador tiene ${ids.length} contratos.` }
		} catch (error) {
			if (error instanceof IspError) return { ok: false, kind: error.kind, message: error.message }
			throw error
		}
	}

	async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
		const method = req.method ?? 'GET'
		const path = url.pathname.replace(/\/+$/, '') || '/'

		if (method === 'GET' && path === '/api/events') return events(req, res)
		if (method === 'GET' && path === '/api/summary') {
			const provider = await getProvider(db)
			return send(res, 200, {
				...(await getSummary(db, deps.today())),
				company: await getCompany(db),
				provider: { name: provider.name, baseUrl: provider.baseUrl, configured: provider.baseUrl !== '' && provider.hasPassword,
					autoEnabled: provider.autoEnabled, autoTime: provider.autoTime, autoLastDate: provider.autoLastDate },
				lastRuns: await listRuns(db, 5),
				inProgress: runner.inProgress ?? null,
				today: deps.today(),
			})
		}
		if (method === 'GET' && path === '/api/settings') return send(res, 200, await settings())
		if (method === 'PUT' && path === '/api/settings/company') {
			await saveCompany(db, await readBody(req))
			return send(res, 200, await settings())
		}
		if (method === 'PUT' && path === '/api/settings/provider') {
			await saveProvider(db, deps.secrets, await readBody(req))
			return send(res, 200, await settings())
		}
		if (method === 'POST' && path === '/api/settings/provider/test') return send(res, 200, await testConnection(await readBody(req)))

		if (method === 'GET' && path === '/api/runs') {
			const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 500)
			return send(res, 200, { runs: await listRuns(db, limit), inProgress: runner.inProgress ?? null })
		}
		if (method === 'POST' && path === '/api/runs') {
			const body = await readBody(req)
			if (body.kind !== 'import' && body.kind !== 'paid') throw new HttpError(400, 'Indica el tipo de corrida: «import» o «paid».')
			const launched = await runner.launch(body.kind, body.dryRun === true)
			return send(res, 202, { runId: launched.runId })
		}
		const runMatch = /^\/api\/runs\/(\d+)$/.exec(path)
		if (method === 'GET' && runMatch) {
			const run = await getRun(db, Number(runMatch[1]))
			if (!run) throw new HttpError(404, `No existe la corrida #${runMatch[1]}.`)
			return send(res, 200, run)
		}

		if (method === 'GET' && path === '/api/customers') return send(res, 200, { customers: await listCustomers(db, url.searchParams.get('q') ?? '') })
		const customerMatch = /^\/api\/customers\/([^/]+)$/.exec(path)
		if (method === 'GET' && customerMatch) {
			const file = await getCustomerFile(db, decodeURIComponent(customerMatch[1] as string))
			if (!file) throw new HttpError(404, 'No existe ese cliente en Cobrix.')
			return send(res, 200, file)
		}
		if (path.startsWith('/api/')) throw new HttpError(404, `Ruta desconocida: ${method} ${path}`)
		return serveStatic(res, path)
	}

	function events(req: IncomingMessage, res: ServerResponse): void {
		res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
		const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
		write('hello', { inProgress: runner.inProgress ?? null })
		const unsubscribe = runner.subscribe(event => write(event.type, event.type === 'progress' ? event.progress : event.outcome))
		const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000)
		req.on('close', () => { clearInterval(keepAlive); unsubscribe() })
	}

	function serveStatic(res: ServerResponse, path: string): void {
		const root = deps.staticDir ? resolve(deps.staticDir) : undefined
		if (!root || !existsSync(join(root, 'index.html'))) {
			res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
			res.end('El panel no está compilado. Ejecuta «npm run build» o usa «npm start», que lo compila.')
			return
		}
		const candidate = normalize(join(root, decodeURIComponent(path)))
		const file = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, 'index.html')
		const assets = file.includes(`${join(root, 'assets')}`)
		res.writeHead(200, {
			'content-type': MIME[extname(file)] ?? 'application/octet-stream',
			'cache-control': assets ? 'public, max-age=31536000, immutable' : 'no-cache',
		})
		res.end(readFileSync(file))
	}

	return createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://cobrix.local')
		route(req, res, url).catch(error => {
			if (res.headersSent) return res.end()
			if (error instanceof ValidationError) return send(res, 422, { error: error.message, fields: error.fields })
			if (error instanceof RunInProgressError) return send(res, 409, { error: error.message })
			if (error instanceof IspError) return send(res, 502, { error: error.message })
			if (error instanceof HttpError) return send(res, error.status, error.body)
			console.error(error)
			return send(res, 500, { error: 'Error interno de Cobrix. Revisa el registro del servidor.' })
		})
	})
}
