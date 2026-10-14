/**
 * What both runs share: their dependencies, options and outcome, the connection to the invoice
 * manager built from the saved settings, and error messages for the operator.
 */

import { InvoiceManagerError, type InvoiceManagerFactory, type InvoiceManagerGateway } from './ports/invoice-manager.ts'
import type { Logger } from './ports/logger.ts'
import { RunInProgressError, type Counters, type RunKind, type RunTrigger, type SecretCipher, type Store } from './ports/store.ts'
import { getProvider, type ProviderSettings } from './settings.ts'

export { RunInProgressError }

export interface SyncDeps {
	readonly store: Store
	readonly invoiceManager: InvoiceManagerFactory
	readonly cipher: SecretCipher
	/** `YYYY-MM-DD` in America/Caracas. */
	readonly today: () => string
	readonly logger: Logger
}

export interface Progress {
	readonly runId: number
	readonly kind: RunKind
	readonly dryRun: boolean
	readonly done: number
	readonly total: number
	readonly stage: string
}

export interface RunOptions {
	readonly dryRun: boolean
	readonly trigger?: RunTrigger
	readonly onProgress?: (progress: Progress) => void
}

export interface RunOutcome {
	readonly runId: number
	readonly status: 'completed' | 'failed'
	readonly counters: Counters
	readonly error?: string
}

export function describeError(error: unknown): string {
	if (error instanceof InvoiceManagerError) return error.message
	if (error instanceof Error) return `Error inesperado: ${error.message}`
	return 'Error inesperado.'
}

/** Builds the gateway from the saved settings. Throws InvoiceManagerError('config') with what is missing. */
export async function connect(deps: SyncDeps): Promise<{ gateway: InvoiceManagerGateway; provider: ProviderSettings }> {
	const record = await deps.store.settings.getProvider()
	const provider = await getProvider(deps.store.settings)
	if (!provider.baseUrl) {
		throw new InvoiceManagerError('config', 'Todavía no hay un administrador de facturas configurado. Completa la sección Proveedor en Configuración.')
	}
	const password = deps.cipher.open(record.passwordSealed)
	if (password === undefined) {
		throw new InvoiceManagerError('config', 'No se pudo leer la contraseña guardada (cambió la clave de cifrado). Escríbela de nuevo en Configuración.')
	}
	return { gateway: deps.invoiceManager({ baseUrl: provider.baseUrl, username: provider.username, password }), provider }
}

/** Calls `fn` on each item with at most `limit` in flight, keeping the input order in the result. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length)
	let next = 0
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++
			results[index] = await fn(items[index] as T, index)
		}
	})
	await Promise.all(workers)
	return results
}

/** Wall-clock milliseconds since `start`, for logs. */
export function elapsed(start: number): number {
	return Math.round(performance.now() - start)
}
