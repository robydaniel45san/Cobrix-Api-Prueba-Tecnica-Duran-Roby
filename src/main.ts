/**
 * Starts the test environment in one process:
 *   - the invoice manager API over data/billing-api.sqlite   (BILLING_API_PORT, default 4310)
 *   - Cobrix (backend/): panel, its API and the daily scheduler (PORT, default 4300)
 *
 * The provided database was generated for 2026-10-13. That date is pinned by default so
 * the acceptance numbers in docs/ENUNCIADO.md hold; set SANDBOX_TODAY to change it.
 * Cobrix keeps its own data in COBRIX_DATA_DIR (default data/cobrix).
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.SANDBOX_TODAY ??= '2026-10-13'

const { DEFAULT_BILLING_API_DB, SANDBOX_API_USER, seedBillingApi } = await import('./billing-api/seed.ts')
const { createBillingApiServer } = await import('./billing-api/server.ts')
const { startCobrix } = await import('../backend/src/main.ts')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const billingApiDb = process.env.BILLING_API_DB ?? DEFAULT_BILLING_API_DB
const host = process.env.HOST ?? '127.0.0.1'
const billingApiPort = Number(process.env.BILLING_API_PORT ?? 4310)

if (!existsSync(billingApiDb)) seedBillingApi(billingApiDb)
const billingApi = createBillingApiServer(billingApiDb)
await billingApi.listen(billingApiPort, host)
const billingApiUrl = `http://${host}:${billingApiPort}`

const cobrix = await startCobrix({
	port: Number(process.env.PORT ?? 4300),
	host,
	dataDir: resolve(root, process.env.COBRIX_DATA_DIR ?? 'data/cobrix'),
	staticDir: resolve(root, 'frontend/dist'),
	sandbox: { baseUrl: billingApiUrl, username: SANDBOX_API_USER.user_name, password: SANDBOX_API_USER.password },
})

console.log(`Panel de Cobrix:          ${cobrix.url}`)
console.log(`API del administrador:    ${billingApiUrl}/api/v1`)
console.log(`Swagger:                  ${billingApiUrl}/docs`)
console.log(`Fecha de la prueba:       ${process.env.SANDBOX_TODAY}`)

const shutdown = (): void => {
	void Promise.all([cobrix.close(), billingApi.close()]).then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
