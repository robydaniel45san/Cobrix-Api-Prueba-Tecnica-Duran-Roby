/**
 * Test harness: a fresh copy of the invoice manager API (seeded, on a random port) and an
 * in-memory Cobrix database already pointing at it.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SANDBOX_API_USER, seedBillingApi } from '../src/billing-api/seed.ts'
import { createBillingApiServer, type BillingApiServer } from '../src/billing-api/server.ts'
import { openDatabase, type Database } from '../src/cobrix/db/database.ts'
import { SecretBox } from '../src/cobrix/db/secret.ts'
import { saveCompany, saveProvider } from '../src/cobrix/settings.ts'
import type { SyncDeps } from '../src/cobrix/sync/runs.ts'
import { today } from '../src/shared/dates.ts'

process.env.SANDBOX_TODAY = '2026-10-13'

export interface Sandbox {
	readonly api: BillingApiServer
	readonly apiUrl: string
	readonly db: Database
	readonly deps: SyncDeps
	sim(path: 'pagar' | 'anular' | 'reiniciar', body?: unknown): Promise<Record<string, unknown>>
	close(): Promise<void>
}

export async function startSandbox(): Promise<Sandbox> {
	const dir = mkdtempSync(join(tmpdir(), 'cobrix-test-'))
	seedBillingApi(join(dir, 'billing-api.sqlite'))
	const api = createBillingApiServer(join(dir, 'billing-api.sqlite'))
	const apiUrl = `http://127.0.0.1:${await api.listen(0)}`
	const db = await openDatabase()
	const secrets = new SecretBox(Buffer.alloc(32, 7))
	await saveCompany(db, { name: 'ISP de Prueba', rif: 'J-00000000-0', collectionsEmail: 'cobranza@example.com' })
	await saveProvider(db, secrets, { baseUrl: apiUrl, username: SANDBOX_API_USER.user_name, password: SANDBOX_API_USER.password, importableStatuses: ['ACTIVO', 'CORTADO'] })
	return {
		api, apiUrl, db,
		deps: { db, secrets, today, clientOptions: { retries: 0, timeoutMs: 5_000 } },
		async sim(path, body = {}) {
			const response = await fetch(`${apiUrl}/__sim/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
			const json = await response.json() as Record<string, unknown>
			if (!response.ok) throw new Error(`/__sim/${path} → ${response.status} ${JSON.stringify(json)}`)
			return json
		},
		async close() {
			await db.close()
			await api.close()
			rmSync(dir, { recursive: true, force: true })
		},
	}
}
