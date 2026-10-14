/**
 * Logger adapter: one line per event, either readable (`pretty`, the default in a terminal) or
 * JSON lines (`json`, for log collectors). Level from LOG_LEVEL (debug, info, warn, error, silent).
 *
 *   21:04:12.381 INFO  run.finished runId=1 kind=import ms=143 installmentsImported=42
 *   {"time":"2026-10-14T01:04:12.381Z","level":"info","event":"run.finished","runId":1,…}
 *
 * Fields whose name suggests a secret (password, token, authorization) are always masked.
 */

import type { LogFields, Logger } from '../../application/ports/logger.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'
export type LogFormat = 'pretty' | 'json'

const ORDER: Record<Exclude<LogLevel, 'silent'>, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const SECRET = /password|token|authorization|secret/i

export interface LoggerOptions {
	readonly level?: LogLevel
	readonly format?: LogFormat
	readonly write?: (line: string) => void
	readonly now?: () => Date
}

function mask(fields: LogFields): LogFields {
	return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, SECRET.test(key) ? '[oculto]' : value]))
}

function pretty(value: unknown): string {
	if (typeof value === 'string') return /[\s="]/.test(value) ? JSON.stringify(value) : value
	if (value instanceof Date) return value.toISOString()
	return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
}

export function createLogger(options: LoggerOptions = {}, base: LogFields = {}): Logger {
	const level = options.level ?? 'info'
	const format = options.format ?? 'pretty'
	const write = options.write ?? (line => process.stdout.write(`${line}\n`))
	const now = options.now ?? (() => new Date())

	const emit = (entryLevel: Exclude<LogLevel, 'silent'>, event: string, fields: LogFields = {}) => {
		if (level === 'silent' || ORDER[entryLevel] < ORDER[level]) return
		const all = mask({ ...base, ...fields })
		const time = now()
		if (format === 'json') {
			write(JSON.stringify({ time: time.toISOString(), level: entryLevel, event, ...all }))
			return
		}
		const clock = time.toISOString().slice(11, 23)
		const pairs = Object.entries(all).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${pretty(value)}`)
		write([clock, entryLevel.toUpperCase().padEnd(5), event, ...pairs].join(' '))
	}

	return {
		debug: (event, fields) => emit('debug', event, fields),
		info: (event, fields) => emit('info', event, fields),
		warn: (event, fields) => emit('warn', event, fields),
		error: (event, fields) => emit('error', event, fields),
		child: fields => createLogger(options, { ...base, ...fields }),
	}
}

export function loggerFromEnvironment(env: NodeJS.ProcessEnv = process.env): Logger {
	const level = (env.LOG_LEVEL ?? 'info') as LogLevel
	const format: LogFormat = env.LOG_FORMAT === 'json' ? 'json' : 'pretty'
	return createLogger({ level: ['debug', 'info', 'warn', 'error', 'silent'].includes(level) ? level : 'info', format })
}
