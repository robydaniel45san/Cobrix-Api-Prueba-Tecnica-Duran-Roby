/**
 * Robustness: API errors, odd responses, limits and concurrency. A fetch interceptor sits in
 * front of the real sandbox API and rewrites the responses each test needs.
 */

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { IspClient } from '../src/cobrix/isp/client.ts'
import { saveProvider } from '../src/cobrix/settings.ts'
import { runImport } from '../src/cobrix/sync/import.ts'
import { runPaid } from '../src/cobrix/sync/paid.ts'
import { RunInProgressError, type SyncDeps } from '../src/cobrix/sync/runs.ts'
import { startSandbox, type Sandbox } from './helpers.ts'

type Interceptor = (url: URL, forward: () => Promise<Response>) => Promise<Response | undefined> | Response | undefined

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('robustez', () => {
	let sandbox: Sandbox
	let interceptor: Interceptor | undefined
	let deps: SyncDeps
	const calls: string[] = []

	beforeEach(async () => {
		sandbox = await startSandbox()
		interceptor = undefined
		calls.length = 0
		const intercepted: typeof fetch = async (input, init) => {
			const url = new URL(String(input))
			calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`)
			const forward = () => fetch(input, init)
			return (await interceptor?.(url, forward)) ?? forward()
		}
		deps = { ...sandbox.deps, clientOptions: { retries: 1, timeoutMs: 2_000, fetch: intercepted } }
	})
	afterEach(async () => { await sandbox.close() })

	const count = async (table: string) => Number((await sandbox.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0]?.n)
	const lastRun = async () => (await sandbox.db.query<Record<string, unknown>>('SELECT status, error, warnings FROM run ORDER BY id DESC LIMIT 1'))[0]

	it('credenciales malas: la corrida queda fallida, con el error, y no escribe nada', async () => {
		await saveProvider(sandbox.db, deps.secrets, { baseUrl: sandbox.apiUrl, username: 'cobrix', password: 'mala', importableStatuses: ['ACTIVO'] })
		const outcome = await runImport(deps, { dryRun: false })
		assert.equal(outcome.status, 'failed')
		assert.match(outcome.error ?? '', /credenciales.*Contraseña Incorrecta/s)
		assert.deepEqual(await lastRun(), { status: 'failed', error: outcome.error, warnings: 0 })
		assert.equal(await count('invoice'), 0)
	})

	it('API caída: dice a qué URL no pudo conectar', async () => {
		await saveProvider(sandbox.db, deps.secrets, { baseUrl: 'http://127.0.0.1:9', username: 'cobrix', importableStatuses: ['ACTIVO'] })
		const outcome = await runImport({ ...deps, clientOptions: { retries: 0, timeoutMs: 1_000 } }, { dryRun: true })
		assert.equal(outcome.status, 'failed')
		assert.match(outcome.error ?? '', /No se pudo conectar con la API en http:\/\/127\.0\.0\.1:9/)
	})

	it('token vencido a mitad de la corrida: vuelve a iniciar sesión y sigue', async () => {
		let expired = false
		interceptor = url => {
			if (url.pathname.endsWith('/contrato/individual') && url.searchParams.get('id_contrato') === '900110' && !expired) {
				expired = true
				return json({ detail: { type: 'auth_api', mensaje: 'InvalidHeaderError, Token invalido' } }, 401)
			}
			return undefined
		}
		const outcome = await runImport(deps, { dryRun: false })
		assert.equal(outcome.status, 'completed', outcome.error)
		assert.equal(outcome.counters.installmentsImported, 42)
		assert.equal(calls.filter(call => call.endsWith('/usuario/login')).length, 2)
	})

	it('un contrato que siempre falla (500) no tumba la corrida: se registra y se importa el resto', async () => {
		interceptor = url => url.searchParams.get('id_contrato') === '900101' ? json({ title: 'Internal Server Error' }, 500) : undefined
		const first = await runImport(deps, { dryRun: false })
		assert.equal(first.status, 'completed')
		assert.equal(first.counters.contractsFailed, 1)
		assert.equal(first.counters.installmentsImported, 39)
		assert.equal((await lastRun())?.warnings, 1)
		// Retried once (retries: 1), then given up.
		assert.equal(calls.filter(call => call.includes('id_contrato=900101')).length, 2)

		interceptor = undefined
		const second = await runImport(deps, { dryRun: false })
		assert.equal(second.counters.installmentsImported, 3, 'la siguiente corrida trae lo que faltó')
		assert.equal(await count('invoice'), 42)
	})

	it('respuestas que se contradicen dejan el contrato fuera, sin adivinar', async () => {
		interceptor = async (url, forward) => {
			const id = url.searchParams.get('id_contrato')
			if (!url.pathname.endsWith('/contrato/individual')) return undefined
			const rows = await (await forward()).json() as Array<Record<string, unknown>>
			if (id === '900101') return json(rows.map(row => ({ ...row, contrato_id: 900102 })))
			if (id === '900104') return json([...rows, rows[0]])
			if (id === '900105') return json(rows.map(row => ({ ...row, estado: 'SUSPENDIDO' })))
			if (id === '900113') return json({ success: false, data: rows })
			return json(rows)
		}
		const outcome = await runImport(deps, { dryRun: false })
		assert.equal(outcome.status, 'completed')
		assert.equal(outcome.counters.contractsIndeterminate, 3, '900101, 900104 y 900113')
		assert.equal(outcome.counters.contractsStatusUnrecognized, 1)
		assert.equal(outcome.counters.installmentsImported, 42 - 3 - 2 - 1 - 2)
		const reasons = await sandbox.db.query<{ contract_id: number; detail: string }>(
			`SELECT DISTINCT contract_id, detail FROM run_item WHERE result IN ('contradictory', 'status_unrecognized') ORDER BY contract_id`)
		assert.deepEqual(reasons.map(row => row.contract_id), [900101, 900104, 900105, 900113])
		assert.match(reasons[0]?.detail ?? '', /se pidió el contrato 900101 y llegaron filas del 900102/)
		assert.match(reasons[1]?.detail ?? '', /duplicada/)
		assert.match(reasons[2]?.detail ?? '', /SUSPENDIDO/)
		assert.match(reasons[3]?.detail ?? '', /no es una lista/)
	})

	it('lista de contratos incompleta frente a su paginación: la corrida falla en vez de importar a medias', async () => {
		interceptor = async (url, forward) => {
			if (!url.pathname.endsWith('/lista_ids_contratos')) return undefined
			const body = await (await forward()).json() as { data: number[] }
			return json({ ...body, data: body.data.slice(0, 10) })
		}
		const outcome = await runImport(deps, { dryRun: false })
		assert.equal(outcome.status, 'failed')
		assert.match(outcome.error ?? '', /27 contratos pero envió 10/)
		assert.equal(await count('invoice'), 0)
	})

	it('topes por corrida: lo que excede queda frenado y entra en la siguiente', async () => {
		await saveProvider(sandbox.db, deps.secrets, { baseUrl: sandbox.apiUrl, username: 'cobrix', importableStatuses: ['ACTIVO', 'CORTADO'], maxNewInvoices: 10 })
		const first = await runImport(deps, { dryRun: false })
		assert.equal(first.counters.installmentsImported, 10)
		assert.equal(first.counters.installmentsBlockedByLimit, 32)
		const second = await runImport(deps, { dryRun: false })
		assert.equal(second.counters.installmentsImported, 10)
		assert.equal(second.counters.installmentsAlreadyImported, 10)

		await saveProvider(sandbox.db, deps.secrets, { baseUrl: sandbox.apiUrl, username: 'cobrix', importableStatuses: ['ACTIVO', 'CORTADO'], maxNewAmount: 100 })
		const third = await runImport(deps, { dryRun: true })
		assert.ok(third.counters.amountWouldImportCents! <= 10_000)
		assert.ok(third.counters.installmentsBlockedByLimit! > 0)
	})

	it('dos corridas a la vez: la segunda se rechaza', async () => {
		let release!: () => void
		const gate = new Promise<void>(resolve => { release = resolve })
		interceptor = async url => { if (url.pathname.endsWith('/lista_ids_contratos')) await gate; return undefined }
		const first = runImport(deps, { dryRun: false })
		await new Promise(resolve => setTimeout(resolve, 50))
		await assert.rejects(runPaid(deps, { dryRun: false }), RunInProgressError)
		release()
		assert.equal((await first).status, 'completed')
	})

	it('libro con filas de otro contrato: sus facturas quedan en revisión, ninguna se marca pagada', async () => {
		await runImport(deps, { dryRun: false })
		await sandbox.sim('pagar', { id_contrato: 900101 })
		interceptor = async (url, forward) => {
			if (!url.pathname.endsWith('/pago_informacion') || url.searchParams.get('id_contrato') !== '900101') return undefined
			const body = await (await forward()).json() as { data: Array<Record<string, unknown>> }
			return json({ ...body, data: body.data.map((row, i) => i === 0 ? { ...row, id_contrato: 900999 } : row) })
		}
		const outcome = await runPaid(deps, { dryRun: false })
		assert.equal(outcome.counters.invoicesMarkedPaid, 0)
		assert.equal(outcome.counters.invoicesUnderReview, 3)
	})

	it('sin evidencia: ni en el libro ni pendiente en el contrato → nunca se marca pagada', async () => {
		await runImport(deps, { dryRun: false })
		interceptor = async (url, forward) => {
			if (url.searchParams.get('id_contrato') !== '900105') return undefined
			if (url.pathname.endsWith('/pago_informacion')) return json({ success: false, data: [] })
			const rows = await (await forward()).json() as Array<Record<string, unknown>>
			return json([{ ...rows[0], deuda_id: '0', deuda: 0, detalle_deuda: [] }])
		}
		const outcome = await runPaid(deps, { dryRun: false })
		assert.equal(outcome.counters.invoicesUnknown, 1)
		const [invoice] = await sandbox.db.query<{ status: string }>(`SELECT status FROM invoice WHERE contract_id = 900105`)
		assert.equal(invoice?.status, 'open')
	})

	it('el cliente HTTP renueva el token un minuto antes de que venza', async () => {
		let now = Date.parse('2026-10-13T12:00:00Z')
		const logins: number[] = []
		const client = new IspClient({ baseUrl: 'http://isp.test', username: 'u', password: 'p' }, {
			now: () => now,
			fetch: async input => {
				if (String(input).endsWith('/usuario/login')) {
					logins.push(now)
					return json({ access_token: `t${logins.length}`, access_token_expires_in: new Date(now + 7_200_000).toISOString().slice(0, 19) })
				}
				return json({ success: true, pagination: { total: 1 }, data: [1] })
			},
		})
		await client.listContractIds()
		now += 7_200_000 - 120_000
		await client.listContractIds()
		now += 90_000
		await client.listContractIds()
		assert.equal(logins.length, 2)
	})
})
