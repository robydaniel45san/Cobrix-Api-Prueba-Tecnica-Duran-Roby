/**
 * Test harness: a fresh copy of the invoice manager API (seeded, on a random port) and an
 * in-memory Cobrix already configured to talk to it.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SANDBOX_API_USER, seedBillingApi } from '../../src/billing-api/seed.ts'
import { createBillingApiServer, type BillingApiServer } from '../../src/billing-api/server.ts'
import { silentLogger } from '../src/application/ports/logger.ts'
import type { SyncDeps } from '../src/application/runs.ts'
import { saveCompany, saveProvider } from '../src/application/settings.ts'
import type { HttpClientOptions } from '../src/infrastructure/invoice-manager/http-client.ts'
import type { Database } from '../src/infrastructure/persistence/database.ts'
import { SecretBox } from '../src/infrastructure/persistence/secret.ts'
import { createCobrix, type Cobrix } from '../src/main.ts'

process.env.SANDBOX_TODAY = '2026-10-13'

export interface Sandbox {
	readonly api: BillingApiServer
	readonly apiUrl: string
	readonly cobrix: Cobrix
	readonly db: Database
	readonly deps: SyncDeps
	/** Saves provider settings over the sandbox defaults. */
	configure(overrides?: Record<string, unknown>): Promise<void>
	sim(path: 'pagar' | 'anular' | 'reiniciar', body?: unknown): Promise<Record<string, unknown>>
	close(): Promise<void>
}

export async function startSandbox(invoiceManager: HttpClientOptions = { retries: 0, timeoutMs: 5_000 }): Promise<Sandbox> {
	const dir = mkdtempSync(join(tmpdir(), 'cobrix-test-'))
	seedBillingApi(join(dir, 'billing-api.sqlite'))
	const api = createBillingApiServer(join(dir, 'billing-api.sqlite'))
	const apiUrl = `http://127.0.0.1:${await api.listen(0)}`
	const cobrix = await createCobrix({ logger: silentLogger, cipher: new SecretBox(Buffer.alloc(32, 7)), invoiceManager })
	const { deps } = cobrix
	const configure = async (overrides: Record<string, unknown> = {}) => {
		await saveProvider(deps.store.settings, deps.cipher, {
			baseUrl: apiUrl, username: SANDBOX_API_USER.user_name, password: SANDBOX_API_USER.password,
			importableStatuses: ['ACTIVO', 'CORTADO'], ...overrides,
		}, silentLogger)
	}
	await saveCompany(deps.store.settings, { name: 'ISP de Prueba', rif: 'J-00000000-0', collectionsEmail: 'cobranza@example.com' }, silentLogger)
	await configure()
	return {
		api, apiUrl, cobrix, db: cobrix.db, deps, configure,
		async sim(path, body = {}) {
			const response = await fetch(`${apiUrl}/__sim/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
			const json = await response.json() as Record<string, unknown>
			if (!response.ok) throw new Error(`/__sim/${path} → ${response.status} ${JSON.stringify(json)}`)
			return json
		},
		async close() {
			await cobrix.close()
			await api.close()
			rmSync(dir, { recursive: true, force: true })
		},
	}
}
