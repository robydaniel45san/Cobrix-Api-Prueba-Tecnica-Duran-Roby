/**
 * The panel's HTTP API over the real sandbox: settings, test connection, launching runs with
 * live progress (SSE), customers, customer file and summary.
 */

import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

import { tick } from '../../src/application/scheduler.ts'
import { createHttpServer } from '../../src/infrastructure/http/server.ts'
import { startSandbox, type Sandbox } from '../helpers.ts'

type Json = Record<string, any>

describe('API del panel', () => {
	let sandbox: Sandbox
	let base: string
	let server: ReturnType<typeof createHttpServer>

	const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> => {
		const response = await fetch(`${base}${path}`, {
			method,
			headers: { 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		})
		return { status: response.status, json: await response.json() as Json }
	}
	/** Launches a run and waits for its «finished» event on the SSE stream. */
	const runAndWait = async (kind: 'import' | 'paid', dryRun: boolean): Promise<{ runId: number; progress: number; outcome: Json }> => {
		const controller = new AbortController()
		const stream = await fetch(`${base}/api/events`, { signal: controller.signal })
		const reader = (stream.body as ReadableStream<Uint8Array>).getReader()
		const launched = await api('POST', '/api/runs', { kind, dryRun })
		assert.equal(launched.status, 202, JSON.stringify(launched.json))
		let buffer = ''
		let progress = 0
		for (;;) {
			const { value, done } = await reader.read()
			if (done) throw new Error('el stream terminó antes de la corrida')
			buffer += new TextDecoder().decode(value)
			for (const block of buffer.split('\n\n').slice(0, -1)) {
				const event = /^event: (\w+)/m.exec(block)?.[1]
				const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null')
				if (event === 'progress') progress++
				if (event === 'finished' && data.runId === launched.json.runId) {
					controller.abort()
					return { runId: launched.json.runId, progress, outcome: data }
				}
			}
			buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2)
		}
	}

	before(async () => {
		sandbox = await startSandbox()
		const { deps, launcher, db } = sandbox.cobrix
		server = createHttpServer({ store: deps.store, readDb: db, cipher: deps.cipher, invoiceManager: deps.invoiceManager, launcher, today: deps.today, logger: deps.logger })
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})
	after(async () => {
		server.closeAllConnections()
		await new Promise(resolve => server.close(resolve))
		await sandbox.close()
	})

	it('la configuración nunca devuelve la contraseña', async () => {
		const { json } = await api('GET', '/api/settings')
		assert.equal(json.provider.hasPassword, true)
		assert.doesNotMatch(JSON.stringify(json), /cobrix-sandbox|password_encrypted/)
	})

	it('valida la configuración campo por campo', async () => {
		const { status, json } = await api('PUT', '/api/settings/provider', { baseUrl: 'no-es-url', username: '', importableStatuses: [], graceDays: 90, windowMonths: 5 })
		assert.equal(status, 422)
		assert.deepEqual(Object.keys(json.error.fields).sort(), ['baseUrl', 'graceDays', 'importableStatuses', 'username', 'windowMonths'])
		const company = await api('PUT', '/api/settings/company', { name: '', rif: '123', collectionsEmail: 'x' })
		assert.deepEqual(Object.keys(company.json.error.fields).sort(), ['collectionsEmail', 'name', 'rif'])
	})

	it('probar conexión: cuenta contratos o explica el error', async () => {
		const ok = await api('POST', '/api/settings/provider/test', {})
		assert.deepEqual([ok.json.ok, ok.json.contracts], [true, 27])
		const bad = await api('POST', '/api/settings/provider/test', { password: 'mala' })
		assert.equal(bad.json.ok, false)
		assert.match(bad.json.message, /Contraseña Incorrecta/)
	})

	it('importar desde el panel, con progreso en vivo', async () => {
		const simulated = await runAndWait('import', true)
		assert.equal(simulated.outcome.counters.installmentsWouldImport, 42)
		const real = await runAndWait('import', false)
		assert.equal(real.outcome.status, 'completed')
		assert.ok(real.progress >= 27, `hubo ${real.progress} eventos de progreso`)
		const run = await api('GET', `/api/runs/${real.runId}`)
		assert.equal(run.json.items.filter((item: Json) => item.result === 'imported').length, 42)
	})

	it('una segunda corrida simultánea responde 409', async () => {
		const first = api('POST', '/api/runs', { kind: 'paid', dryRun: true })
		const second = api('POST', '/api/runs', { kind: 'paid', dryRun: true })
		const responses = await Promise.all([first, second])
		assert.deepEqual(responses.map(response => response.status).sort(), [202, 409])
		assert.equal(responses.find(response => response.status === 409)?.json.error.code, 'run_in_progress')
		await new Promise(resolve => setTimeout(resolve, 500))
	})

	it('todos los errores usan el mismo formato { error: { code, message } }', async () => {
		const cases: Array<[string, string, unknown, number, string]> = [
			['GET', '/api/no-existe', undefined, 404, 'not_found'],
			['GET', '/api/runs/999', undefined, 404, 'not_found'],
			['POST', '/api/runs', { kind: 'otro' }, 400, 'bad_request'],
			['PUT', '/api/settings/company', {}, 422, 'validation_failed'],
		]
		for (const [method, path, body, status, code] of cases) {
			const response = await api(method, path, body)
			assert.equal(response.status, status, path)
			assert.equal(response.json.error.code, code, path)
			assert.equal(typeof response.json.error.message, 'string', path)
		}
		const raw = await fetch(`${base}/api/runs`, { method: 'POST', body: '{no es json' })
		assert.deepEqual([raw.status, (await raw.json() as Json).error.code], [400, 'bad_request'])
	})

	it('clientes: búsqueda por nombre, cédula con separadores o RIF', async () => {
		assert.equal((await api('GET', '/api/customers')).json.customers.length, 20)
		const byName = (await api('GET', '/api/customers?q=gomez')).json.customers
		assert.deepEqual(byName.map((c: Json) => [c.name, c.contracts, c.openInvoices, c.debtCents]), [['LUIS GOMEZ', 2, 5, 11500]])
		assert.equal((await api('GET', '/api/customers?q=V-9.876.543')).json.customers[0]?.id, 'V9876543')
		assert.equal((await api('GET', '/api/customers?q=09000123')).json.customers[0]?.name, 'ELENA RUIZ')
		assert.equal((await api('GET', '/api/customers?q=J-40123456')).json.customers[0]?.personType, 'juridica')
	})

	it('expediente: datos, contratos, facturas e historial', async () => {
		const { json } = await api('GET', '/api/customers/V9876543')
		assert.equal(json.customer.name, 'LUIS GOMEZ')
		assert.deepEqual(json.contracts.map((c: Json) => c.status), ['ACTIVO', 'CORTADO'])
		assert.equal(json.invoices.length, 5)
		assert.match(json.invoices[0].number, /^FAC-\d{6}$/)
		assert.deepEqual(json.events.map((e: Json) => e.kind).sort(), ['customer_created', ...Array(5).fill('invoice_imported')])
		assert.equal((await api('GET', '/api/customers/NOEXISTE')).status, 404)
	})

	it('resumen: totales y antigüedad de la deuda', async () => {
		const { json } = await api('GET', '/api/summary')
		assert.deepEqual([json.customers, json.openInvoices, json.openAmountCents], [20, 42, 123_500])
		const aging = Object.fromEntries(json.aging.map((a: Json) => [a.bucket, a.amountCents]))
		assert.equal(Object.values(aging).reduce((a: number, b) => a + (b as number), 0), 123_500)
		assert.equal(json.lastRuns.length, 3, "simulación, importación y la simulación de pagadas")
	})

	it('corrida automática: corre una vez al día a la hora configurada', async () => {
		await api('PUT', '/api/settings/provider', { baseUrl: sandbox.apiUrl, username: 'cobrix', importableStatuses: ['ACTIVO', 'CORTADO'], autoEnabled: true, autoTime: '06:00' })
		const options = { settings: sandbox.deps.store.settings, launcher: sandbox.cobrix.launcher, today: sandbox.deps.today, logger: sandbox.deps.logger }
		assert.equal(await tick({ ...options, now: () => new Date('2026-10-13T09:59:00Z') }), false, '05:59 en Caracas')
		assert.equal(await tick({ ...options, now: () => new Date('2026-10-13T10:01:00Z') }), true, '06:01 en Caracas')
		assert.equal(await tick({ ...options, now: () => new Date('2026-10-13T15:00:00Z') }), false, 'ya corrió hoy')
		const runs = (await api('GET', '/api/runs')).json.runs.filter((run: Json) => run.trigger === 'auto')
		assert.deepEqual(runs.map((run: Json) => run.kind), ['paid', 'import'])
	})
})
