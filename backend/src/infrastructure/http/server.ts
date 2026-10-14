/**
 * Cobrix HTTP server: the panel API (routes.ts), the live run stream (Server-Sent Events) and the
 * built frontend as static files. Every API request is logged with its status and duration.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

import { badRequest, HttpError, notFound, toErrorResponse } from './errors.ts'
import { ROUTES, type RouteDeps } from './routes.ts'

export interface ServerDeps extends RouteDeps {
	/** Folder with the built frontend. Missing = API only. */
	readonly staticDir?: string
}

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
}
const MAX_BODY = 1_000_000

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = []
	let size = 0
	for await (const chunk of req) {
		size += (chunk as Buffer).length
		if (size > MAX_BODY) throw new HttpError(413, 'payload_too_large', 'La solicitud es demasiado grande.')
		chunks.push(chunk as Buffer)
	}
	if (!chunks.length) return {}
	try {
		const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
		if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
	} catch {
		// fall through
	}
	throw badRequest('El cuerpo de la solicitud no es un JSON válido.')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
	res.end(JSON.stringify(body))
}

/** `GET /api/events`: `hello` on connect, then `progress` and `finished` for every run. */
function streamEvents(req: IncomingMessage, res: ServerResponse, deps: ServerDeps): void {
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
	const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
	write('hello', { inProgress: deps.launcher.inProgress ?? null })
	const unsubscribe = deps.launcher.subscribe(event => write(event.type, event.type === 'progress' ? event.progress : event.outcome))
	const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000)
	deps.logger.debug('http.events_connected')
	req.on('close', () => { clearInterval(keepAlive); unsubscribe() })
}

function serveStatic(res: ServerResponse, path: string, staticDir: string | undefined): void {
	const root = staticDir ? resolve(staticDir) : undefined
	if (!root || !existsSync(join(root, 'index.html'))) {
		res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
		res.end('El panel no está compilado. Ejecuta «npm run build» o usa «npm start», que lo compila.')
		return
	}
	const candidate = normalize(join(root, decodeURIComponent(path)))
	// Unknown paths fall back to index.html (client-side routing); nothing outside `root` is served.
	const file = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, 'index.html')
	res.writeHead(200, {
		'content-type': MIME[extname(file)] ?? 'application/octet-stream',
		'cache-control': file.startsWith(join(root, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache',
	})
	res.end(readFileSync(file))
}

export function createHttpServer(deps: ServerDeps): Server {
	const log = deps.logger.child({ component: 'http' })

	async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<number> {
		const method = req.method ?? 'GET'
		for (const route of ROUTES) {
			if (route.method !== method) continue
			const match = route.pattern.exec(path)
			if (!match) continue
			const response = await route.handler({ method, path, params: match.slice(1), query: url.searchParams, body: () => readBody(req) }, deps)
			sendJson(res, response.status, response.body)
			return response.status
		}
		throw notFound(`Ruta desconocida: ${method} ${path}`)
	}

	return createServer((req, res) => {
		const started = performance.now()
		const url = new URL(req.url ?? '/', 'http://cobrix.local')
		const path = url.pathname.replace(/\/+$/, '') || '/'
		const method = req.method ?? 'GET'

		if (method === 'GET' && path === '/api/events') return streamEvents(req, res, deps)
		if (!path.startsWith('/api/')) return serveStatic(res, path, deps.staticDir)

		handleApi(req, res, url, path).then(
			status => log.info('http.request', { method, path, status, ms: Math.round(performance.now() - started) }),
			error => {
				const { status, body, expected } = toErrorResponse(error)
				if (!res.headersSent) sendJson(res, status, body)
				else res.end()
				const fields = { method, path, status, code: body.error.code, ms: Math.round(performance.now() - started) }
				if (expected) log.warn('http.request', { ...fields, message: body.error.message })
				else log.error('http.request', { ...fields, error: error instanceof Error ? error.stack ?? error.message : String(error) })
			},
		)
	})
}
