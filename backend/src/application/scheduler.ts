/**
 * Daily automatic run (ENUNCIADO §3.1): at the configured time in America/Caracas, import and
 * then update paid invoices. The day is claimed in the database before running, so a restart or
 * a second process does not run it twice the same day.
 */

import { timeOfDay } from '../shared/dates.ts'
import type { Logger } from './ports/logger.ts'
import type { SettingsRepository } from './ports/store.ts'
import type { RunLauncher } from './run-launcher.ts'
import { RunInProgressError } from './runs.ts'

export interface SchedulerOptions {
	readonly settings: SettingsRepository
	readonly launcher: RunLauncher
	readonly today: () => string
	readonly logger: Logger
	readonly now?: () => Date
	readonly intervalMs?: number
}

/** One check: runs the automatic cycle if it is due. Returns true if it ran. */
export async function tick(options: SchedulerOptions): Promise<boolean> {
	const provider = await options.settings.getProvider()
	if (!provider.autoEnabled || !provider.autoTime || !provider.baseUrl) return false
	const today = options.today()
	if (provider.autoLastDate === today) return false
	if (timeOfDay(options.now?.() ?? new Date()) < provider.autoTime) return false
	if (!(await options.settings.claimAutoRun(today))) return false

	options.logger.info('scheduler.cycle_started', { day: today, at: provider.autoTime })
	try {
		const imported = await (await options.launcher.launch('import', false, 'auto')).done
		const paid = await (await options.launcher.launch('paid', false, 'auto')).done
		options.logger.info('scheduler.cycle_finished', { importRunId: imported.runId, importStatus: imported.status, paidRunId: paid.runId, paidStatus: paid.status })
	} catch (error) {
		if (error instanceof RunInProgressError) {
			// A manual run was in progress: release the day so the next check retries.
			await options.settings.releaseAutoRun(today)
			options.logger.info('scheduler.postponed', { reason: 'run_in_progress' })
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
			.catch(error => options.logger.error('scheduler.failed', { error: error instanceof Error ? error.message : String(error) }))
			.finally(() => { busy = false })
	}, options.intervalMs ?? 30_000)
	timer.unref()
	options.logger.info('scheduler.started', { everyMs: options.intervalMs ?? 30_000 })
	return () => clearInterval(timer)
}
