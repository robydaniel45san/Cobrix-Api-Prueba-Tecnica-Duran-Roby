/**
 * What both runs share: the run record, its items, the in-progress lock and the connection
 * to the invoice manager built from the saved settings.
 */

import type { Database, Queryable } from '../db/database.ts'
import type { SecretBox } from '../db/secret.ts'
import { IspClient, IspError, type IspClientOptions } from '../isp/client.ts'
import { getProvider, getProviderPassword, type ProviderSettings } from '../settings.ts'

export type RunKind = 'import' | 'paid'
export type Counters = Record<string, number>

export interface SyncDeps {
	readonly db: Database
	readonly secrets: SecretBox
	/** `YYYY-MM-DD` in America/Caracas. */
	readonly today: () => string
	readonly clientOptions?: IspClientOptions
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
	readonly trigger?: 'manual' | 'auto'
	readonly onProgress?: (progress: Progress) => void
}

export interface RunOutcome {
	readonly runId: number
	readonly status: 'completed' | 'failed'
	readonly counters: Counters
	readonly error?: string
}

export interface RunItem {
	readonly contractId: number | null
	readonly externalId: string | null
	readonly customerId: string | null
	readonly customerName: string | null
	readonly result: string
	readonly detail: string
	readonly label: string | null
	readonly amountCents: number | null
}

export class RunInProgressError extends Error {
	constructor() {
		super('Ya hay una corrida en curso. Espera a que termine y vuelve a intentarlo.')
		this.name = 'RunInProgressError'
	}
}

export async function startRun(db: Queryable, kind: RunKind, dryRun: boolean, trigger: 'manual' | 'auto'): Promise<number> {
	try {
		// Consecutive ids (see the invoice numbering in import.ts); a concurrent insert fails on the lock or the key.
		const [row] = await db.query<{ id: number }>(
			'INSERT INTO run (id, kind, dry_run, trigger) VALUES ((SELECT COALESCE(max(id), 0) + 1 FROM run), $1, $2, $3) RETURNING id',
			[kind, dryRun, trigger],
		)
		return (row as { id: number }).id
	} catch (error) {
		// run_one_in_progress: the database is the lock, so it also holds across processes.
		if (error instanceof Error && /run_one_in_progress|duplicate key/.test(error.message)) throw new RunInProgressError()
		throw error
	}
}

export async function insertItems(db: Queryable, runId: number, items: readonly RunItem[]): Promise<void> {
	const CHUNK = 400
	for (let start = 0; start < items.length; start += CHUNK) {
		const chunk = items.slice(start, start + CHUNK)
		const params: unknown[] = []
		const values = chunk.map((item, i) => {
			params.push(runId, start + i, item.contractId, item.externalId, item.customerId, item.customerName,
				item.result, item.detail, item.label, item.amountCents === null ? null : item.amountCents / 100)
			const base = i * 10
			return `(${Array.from({ length: 10 }, (_, k) => `$${base + k + 1}`).join(', ')})`
		})
		await db.query(
			`INSERT INTO run_item (run_id, position, contract_id, external_id, customer_id, customer_name, result, detail, label, amount) VALUES ${values.join(', ')}`,
			params,
		)
	}
}

export async function finishRun(db: Queryable, runId: number, counters: Counters, warnings: number): Promise<void> {
	await db.query(`UPDATE run SET status = 'completed', finished_at = now(), counters = $2, warnings = $3 WHERE id = $1`, [runId, JSON.stringify(counters), warnings])
}

export async function failRun(db: Queryable, runId: number, counters: Counters, error: unknown): Promise<string> {
	const message = describeError(error)
	await db.query(`UPDATE run SET status = 'failed', finished_at = now(), counters = $2, error = $3 WHERE id = $1`, [runId, JSON.stringify(counters), message])
	return message
}

export function describeError(error: unknown): string {
	if (error instanceof IspError) return error.message
	if (error instanceof Error) return `Error inesperado: ${error.message}`
	return 'Error inesperado.'
}

/** Builds the client from the saved settings. Throws IspError('config') with what is missing. */
export async function connect(deps: SyncDeps): Promise<{ client: IspClient; provider: ProviderSettings }> {
	const provider = await getProvider(deps.db)
	if (!provider.baseUrl) throw new IspError('config', 'Todavía no hay un administrador de facturas configurado. Completa la sección Proveedor en Configuración.')
	const password = await getProviderPassword(deps.db, deps.secrets)
	if (password === undefined) throw new IspError('config', 'No se pudo leer la contraseña guardada (cambió la clave de cifrado). Escríbela de nuevo en Configuración.')
	const client = new IspClient({ baseUrl: provider.baseUrl, username: provider.username, password }, deps.clientOptions)
	return { client, provider }
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
