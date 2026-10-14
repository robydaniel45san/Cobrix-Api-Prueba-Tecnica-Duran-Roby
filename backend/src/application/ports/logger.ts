/** Structured logging port: an event name plus fields. The adapter decides format and output. */

export type LogFields = Record<string, unknown>

export interface Logger {
	debug(event: string, fields?: LogFields): void
	info(event: string, fields?: LogFields): void
	warn(event: string, fields?: LogFields): void
	error(event: string, fields?: LogFields): void
	/** A logger that adds `fields` to every entry (e.g. the run id). */
	child(fields: LogFields): Logger
}

export const silentLogger: Logger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
	child: () => silentLogger,
}
