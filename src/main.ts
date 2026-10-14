/**
 * Starts the test environment in one process:
 *   - the invoice manager API over data/billing-api.sqlite  (BILLING_API_PORT, default 4310)
 *   - Cobrix: panel, its API and the daily scheduler          (PORT, default 4300)
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
const { openDatabase } = await import('./cobrix/db/database.ts')
const { SecretBox } = await import('./cobrix/db/secret.ts')
const { createCobrixServer } = await import('./cobrix/server/app.ts')
const { Runner } = await import('./cobrix/sync/runner.ts')
const { startScheduler } = await import('./cobrix/sync/scheduler.ts')
const { today } = await import('./shared/dates.ts')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const billingApiDb = process.env.BILLING_API_DB ?? DEFAULT_BILLING_API_DB
const appPort = Number(process.env.PORT ?? 4300)
const billingApiPort = Number(process.env.BILLING_API_PORT ?? 4310)
const host = process.env.HOST ?? '127.0.0.1'
const dataDir = resolve(root, process.env.COBRIX_DATA_DIR ?? 'data/cobrix')

if (!existsSync(billingApiDb)) seedBillingApi(billingApiDb)

const billingApi = createBillingApiServer(billingApiDb)
await billingApi.listen(billingApiPort, host)
const billingApiUrl = `http://${host}:${billingApiPort}`

const db = await openDatabase(dataDir)
const secrets = SecretBox.fromEnvironment(dataDir)
const deps = { db, secrets, today }
const runner = new Runner(deps)
const app = createCobrixServer({
	...deps,
	runner,
	staticDir: resolve(root, 'panel/dist'),
	sandbox: { baseUrl: billingApiUrl, username: SANDBOX_API_USER.user_name, password: SANDBOX_API_USER.password },
})
app.listen(appPort, host)
const stopScheduler = startScheduler({ db, runner, today, log: message => console.log(message) })

console.log(`Panel de Cobrix:          http://${host}:${appPort}`)
console.log(`API del administrador:    ${billingApiUrl}/api/v1`)
console.log(`Swagger:                  ${billingApiUrl}/docs`)
console.log(`Fecha de la prueba:       ${process.env.SANDBOX_TODAY}`)
console.log(`Datos de Cobrix:          ${dataDir}`)

const shutdown = (): void => {
	stopScheduler()
	app.close()
	void Promise.all([billingApi.close(), db.close()]).then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
