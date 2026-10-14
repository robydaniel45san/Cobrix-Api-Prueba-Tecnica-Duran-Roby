/**
 * Cobrix's own storage: PostgreSQL. By default it runs embedded through PGlite (Postgres compiled
 * to WebAssembly, in process), so `npm start` needs no database server. Data lives in
 * `COBRIX_DATA_DIR` (default `data/cobrix`); tests use an in-memory instance.
 */

import { mkdirSync } from 'node:fs'

import { PGlite, type Transaction } from '@electric-sql/pglite'

import { SCHEMA } from './schema.ts'

export interface Queryable {
	query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
}

export interface Database extends Queryable {
	transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
	close(): Promise<void>
}

function wrap(target: PGlite | Transaction): Queryable {
	return {
		async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
			const result = await target.query<T>(sql, params as unknown[])
			return result.rows
		},
	}
}

/** Opens (and migrates) the database. `dataDir` undefined = in memory. */
export async function openDatabase(dataDir?: string): Promise<Database> {
	if (dataDir) mkdirSync(dataDir, { recursive: true })
	const pg = await PGlite.create(dataDir ? { dataDir } : {})
	// Timestamps leave the database in UTC, whatever the host's time zone.
	await pg.exec("SET TIME ZONE 'UTC'")
	await pg.exec(SCHEMA)
	// A process that died mid-run leaves it «running» forever: close it as failed.
	await pg.query(`UPDATE run SET status = 'failed', finished_at = now(), error = 'La corrida se interrumpió (el servicio se detuvo antes de terminar).' WHERE status = 'running'`)
	const root = wrap(pg)
	return {
		query: root.query,
		transaction: fn => pg.transaction(tx => fn(wrap(tx))),
		close: () => pg.close(),
	}
}
