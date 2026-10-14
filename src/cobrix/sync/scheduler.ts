/**
 * Daily automatic run (ENUNCIADO §3.1): at the configured time in America/Caracas, import and
 * then update paid invoices. The date of the last automatic run is claimed in the database
 * before running, so a restart or a second process does not run it twice the same day.
 */

import type { Database } from '../db/database.ts'
import { getProvider } from '../settings.ts'
import type { Runner } from './runner.ts'
import { RunInProgressError } from './runs.ts'

const TIME_ZONE = 'America/Caracas'

/** Current `HH:MM` in Caracas. */
export function caracasTime(now: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
}

export interface SchedulerOptions {
	readonly db: Database
	readonly runner: Runner
	readonly today: () => string
	readonly now?: () => Date
	readonly intervalMs?: number
	readonly log?: (message: string) => void
}

/** One check: runs the automatic cycle if it is due. Returns true if it ran. */
export async function tick(options: SchedulerOptions): Promise<boolean> {
	const provider = await getProvider(options.db)
	if (!provider.autoEnabled || !provider.autoTime || !provider.baseUrl) return false
	const today = options.today()
	if (provider.autoLastDate === today) return false
	if (caracasTime(options.now?.() ?? new Date()) < provider.autoTime) return false

	// Claim the day first: only one process wins.
	const claimed = await options.db.query(
		`UPDATE provider SET auto_last_date = $1 WHERE id = 1 AND (auto_last_date IS NULL OR auto_last_date < $1::date) RETURNING id`,
		[today],
	)
	if (!claimed.length) return false
	try {
		const imported = await options.runner.launch('import', false, 'auto')
		const outcome = await imported.done
		options.log?.(`Corrida automática: importación #${outcome.runId} ${outcome.status}`)
		const paid = await options.runner.launch('paid', false, 'auto')
		options.log?.(`Corrida automática: pagadas #${(await paid.done).runId}`)
	} catch (error) {
		if (error instanceof RunInProgressError) {
			// A manual run was in progress: release the day so the next check retries.
			await options.db.query('UPDATE provider SET auto_last_date = NULL WHERE id = 1 AND auto_last_date = $1::date', [today])
			return false
		}
		throw error
	}
	return true
}

export function startScheduler(options: SchedulerOptions): () => void {
	let busy = false
	const timer = setInterval(() => {
		if (busy) return
		busy = true
		tick(options)
			.catch(error => options.log?.(`Corrida automática: ${error instanceof Error ? error.message : String(error)}`))
			.finally(() => { busy = false })
	}, options.intervalMs ?? 30_000)
	timer.unref()
	return () => clearInterval(timer)
}
