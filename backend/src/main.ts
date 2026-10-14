/**
 * Composition root of the Cobrix backend: the only place that knows every concrete piece and
 * wires them (database → repositories, HTTP adapter → invoice-manager port, use cases, HTTP
 * server, scheduler, logger). Everything else depends on ports, not on implementations.
 */

import type { Server } from 'node:http'

import type { Logger } from './application/ports/logger.ts'
import type { SecretCipher } from './application/ports/store.ts'
import { RunLauncher } from './application/run-launcher.ts'
import type { SyncDeps } from './application/runs.ts'
import { startScheduler } from './application/scheduler.ts'
import { createHttpServer } from './infrastructure/http/server.ts'
import { httpInvoiceManager } from './infrastructure/invoice-manager/gateway.ts'
import type { HttpClientOptions } from './infrastructure/invoice-manager/http-client.ts'
import { loggerFromEnvironment } from './infrastructure/logging/logger.ts'
import { openDatabase, type Database } from './infrastructure/persistence/database.ts'
import { SecretBox } from './infrastructure/persistence/secret.ts'
import { createStore } from './infrastructure/persistence/store.ts'
import { today as caracasToday } from './shared/dates.ts'

export interface CobrixOptions {
	/** Where PostgreSQL (PGlite) keeps its files. Undefined = in memory. */
	readonly dataDir?: string
	readonly today?: () => string
	readonly logger?: Logger
	readonly cipher?: SecretCipher
	/** Transport options of the invoice-manager adapter (timeouts, retries, a custom fetch in tests). */
	readonly invoiceManager?: HttpClientOptions
}

export interface Cobrix {
	readonly db: Database
	readonly deps: SyncDeps
	readonly launcher: RunLauncher
	close(): Promise<void>
}

export async function createCobrix(options: CobrixOptions = {}): Promise<Cobrix> {
	const logger = options.logger ?? loggerFromEnvironment()
	const db = await openDatabase(options.dataDir)
	const deps: SyncDeps = {
		store: createStore(db),
		invoiceManager: httpInvoiceManager({ ...options.invoiceManager, logger }),
		cipher: options.cipher ?? SecretBox.fromEnvironment(options.dataDir),
		today: options.today ?? caracasToday,
		logger,
	}
	return { db, deps, launcher: new RunLauncher(deps), close: () => db.close() }
}

export interface StartOptions extends CobrixOptions {
	readonly port: number
	readonly host: string
	/** Built frontend (frontend/dist). */
	readonly staticDir?: string
	readonly sandbox?: { readonly baseUrl: string; readonly username: string; readonly password: string }
}

/** Starts the HTTP server and the daily scheduler. */
export async function startCobrix(options: StartOptions): Promise<{ readonly url: string; readonly server: Server; close(): Promise<void> }> {
	const cobrix = await createCobrix(options)
	const { deps, launcher } = cobrix
	const server = createHttpServer({
		store: deps.store, readDb: cobrix.db, cipher: deps.cipher, invoiceManager: deps.invoiceManager, launcher,
		today: deps.today, logger: deps.logger, ...(options.staticDir ? { staticDir: options.staticDir } : {}),
		...(options.sandbox ? { sandbox: options.sandbox } : {}),
	})
	await new Promise<void>(resolve => server.listen(options.port, options.host, resolve))
	const stopScheduler = startScheduler({ settings: deps.store.settings, launcher, today: deps.today, logger: deps.logger.child({ component: 'scheduler' }) })
	const url = `http://${options.host}:${options.port}`
	deps.logger.info('cobrix.started', { url, dataDir: options.dataDir ?? 'memoria', today: deps.today() })
	return {
		url,
		server,
		async close() {
			stopScheduler()
			server.closeAllConnections()
			await new Promise(resolve => server.close(resolve))
			await cobrix.close()
		},
	}
}
