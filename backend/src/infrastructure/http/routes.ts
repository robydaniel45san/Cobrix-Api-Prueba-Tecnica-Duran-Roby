/**
 * Routes of the panel API. Each handler receives the parsed request and returns `{ status, body }`;
 * the server serializes it. Contracts are documented in docs/DISENO.md §7.
 *
 *   GET  /api/summary                     200 Summary
 *   GET  /api/settings                    200 Settings (never the password)
 *   PUT  /api/settings/company            200 Settings · 422 validation_failed
 *   PUT  /api/settings/provider           200 Settings · 422 validation_failed
 *   POST /api/settings/provider/test      200 ConnectionTest (ok true/false)
 *   POST /api/settings/provider/sandbox   200 Settings · 404 when no local sandbox runs here
 *   GET  /api/runs?limit=               200 { runs, inProgress }
 *   POST /api/runs { kind, dryRun }       202 { runId } · 400 · 409 run_in_progress
 *   GET  /api/runs/:id                    200 RunDetail · 404
 *   GET  /api/customers?q=                200 { customers }
 *   GET  /api/customers/:id               200 CustomerFile · 404
 *   GET  /api/events                      text/event-stream (see server.ts)
 */

import type { InvoiceManagerFactory } from '../../application/ports/invoice-manager.ts'
import { InvoiceManagerError } from '../../application/ports/invoice-manager.ts'
import type { Logger } from '../../application/ports/logger.ts'
import type { SecretCipher, Store } from '../../application/ports/store.ts'
import type { RunLauncher } from '../../application/run-launcher.ts'
import { getProvider, normalizeBaseUrl, saveCompany, saveProvider } from '../../application/settings.ts'
import type { Queryable } from '../persistence/database.ts'
import { getCustomerFile, getRun, getSummary, lastAppliedRun, listCustomers, listRuns } from '../persistence/read-models.ts'
import { badRequest, notFound } from './errors.ts'

export interface RouteDeps {
	readonly store: Store
	readonly readDb: Queryable
	readonly cipher: SecretCipher
	readonly invoiceManager: InvoiceManagerFactory
	readonly launcher: RunLauncher
	readonly today: () => string
	readonly logger: Logger
	/** Local sandbox for «Conectar al sandbox local». Its password stays on the server. */
	readonly sandbox?: { readonly baseUrl: string; readonly username: string; readonly password: string }
}

export interface Request {
	readonly method: string
	readonly path: string
	readonly params: readonly string[]
	readonly query: URLSearchParams
	body(): Promise<Record<string, unknown>>
}

export interface Response {
	readonly status: number
	readonly body: unknown
}

type Handler = (request: Request, deps: RouteDeps) => Promise<Response>

const ok = (body: unknown): Response => ({ status: 200, body })

async function settingsView(deps: RouteDeps) {
	const sandbox = deps.sandbox ? { baseUrl: deps.sandbox.baseUrl, username: deps.sandbox.username } : null
	return { company: await deps.store.settings.getCompany(), provider: await getProvider(deps.store.settings), sandbox }
}

const summary: Handler = async (_request, deps) => {
	const provider = await getProvider(deps.store.settings)
	return ok({
		...(await getSummary(deps.readDb, deps.today())),
		company: await deps.store.settings.getCompany(),
		provider: {
			name: provider.name, baseUrl: provider.baseUrl, configured: provider.baseUrl !== '' && provider.hasPassword,
			autoEnabled: provider.autoEnabled, autoTime: provider.autoTime, autoLastDate: provider.autoLastDate,
		},
		lastRuns: await listRuns(deps.readDb, 10),
		lastApplied: { import: await lastAppliedRun(deps.readDb, 'import'), paid: await lastAppliedRun(deps.readDb, 'paid') },
		inProgress: deps.launcher.inProgress ?? null,
		today: deps.today(),
	})
}

/** Logs in with the form values (falling back to the saved ones) and counts the contracts. */
const testConnection: Handler = async (request, deps) => {
	const body = await request.body()
	const saved = await deps.store.settings.getProvider()
	const typedUrl = typeof body.baseUrl === 'string' ? normalizeBaseUrl(body.baseUrl) : ''
	const typedUser = typeof body.username === 'string' ? body.username.trim() : ''
	const typedPassword = typeof body.password === 'string' ? body.password : ''
	const credentials = {
		baseUrl: typedUrl || saved.baseUrl,
		username: typedUser || saved.username,
		password: typedPassword || deps.cipher.open(saved.passwordSealed) || '',
	}
	const started = performance.now()
	try {
		const gateway = deps.invoiceManager(credentials)
		await gateway.login()
		const contracts = (await gateway.listContractIds()).length
		const elapsedMs = Math.round(performance.now() - started)
		deps.logger.info('settings.connection_tested', { baseUrl: credentials.baseUrl, ok: true, contracts, ms: elapsedMs })
		return ok({ ok: true, contracts, elapsedMs, message: `Conexión correcta: el administrador tiene ${contracts} contratos.` })
	} catch (error) {
		if (!(error instanceof InvoiceManagerError)) throw error
		deps.logger.warn('settings.connection_tested', { baseUrl: credentials.baseUrl, ok: false, kind: error.kind })
		return ok({ ok: false, kind: error.kind, message: error.message })
	}
}

/** Points the provider at the local sandbox, keeping the import rules. The password never reaches the browser. */
const connectSandbox: Handler = async (_request, deps) => {
	if (!deps.sandbox) throw notFound('No hay un sandbox local en este entorno.')
	const current = await getProvider(deps.store.settings)
	await saveProvider(deps.store.settings, deps.cipher, {
		...current,
		baseUrl: deps.sandbox.baseUrl,
		username: deps.sandbox.username,
		password: deps.sandbox.password,
		maxNewAmount: current.maxNewAmountCents === null ? null : current.maxNewAmountCents / 100,
	}, deps.logger)
	return ok(await settingsView(deps))
}

const launchRun: Handler = async (request, deps) => {
	const body = await request.body()
	if (body.kind !== 'import' && body.kind !== 'paid') throw badRequest('Indica el tipo de corrida: «import» o «paid».')
	if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') throw badRequest('«dryRun» debe ser true o false.')
	const launched = await deps.launcher.launch(body.kind, body.dryRun === true)
	return { status: 202, body: { runId: launched.runId } }
}

export const ROUTES: ReadonlyArray<{ method: string; pattern: RegExp; handler: Handler }> = [
	{ method: 'GET', pattern: /^\/api\/summary$/, handler: summary },
	{ method: 'GET', pattern: /^\/api\/settings$/, handler: async (_r, deps) => ok(await settingsView(deps)) },
	{
		method: 'PUT', pattern: /^\/api\/settings\/company$/,
		handler: async (request, deps) => { await saveCompany(deps.store.settings, await request.body(), deps.logger); return ok(await settingsView(deps)) },
	},
	{
		method: 'PUT', pattern: /^\/api\/settings\/provider$/,
		handler: async (request, deps) => { await saveProvider(deps.store.settings, deps.cipher, await request.body(), deps.logger); return ok(await settingsView(deps)) },
	},
	{ method: 'POST', pattern: /^\/api\/settings\/provider\/test$/, handler: testConnection },
	{ method: 'POST', pattern: /^\/api\/settings\/provider\/sandbox$/, handler: connectSandbox },
	{
		method: 'GET', pattern: /^\/api\/runs$/,
		handler: async (request, deps) => {
			const limit = Math.min(Math.max(Number(request.query.get('limit') ?? 50) || 50, 1), 500)
			return ok({ runs: await listRuns(deps.readDb, limit), inProgress: deps.launcher.inProgress ?? null })
		},
	},
	{ method: 'POST', pattern: /^\/api\/runs$/, handler: launchRun },
	{
		method: 'GET', pattern: /^\/api\/runs\/(\d+)$/,
		handler: async (request, deps) => {
			const run = await getRun(deps.readDb, Number(request.params[0]))
			if (!run) throw notFound(`No existe la corrida #${request.params[0]}.`)
			return ok(run)
		},
	},
	{ method: 'GET', pattern: /^\/api\/customers$/, handler: async (request, deps) => ok({ customers: await listCustomers(deps.readDb, request.query.get('q') ?? '') }) },
	{
		method: 'GET', pattern: /^\/api\/customers\/([^/]+)$/,
		handler: async (request, deps) => {
			const file = await getCustomerFile(deps.readDb, decodeURIComponent(request.params[0] as string))
			if (!file) throw notFound('No existe ese cliente en Cobrix.')
			return ok(file)
		},
	},
]
