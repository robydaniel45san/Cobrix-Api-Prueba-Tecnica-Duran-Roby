/**
 * The logger adapter: levels, formats, child fields and secrets that never reach the log.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createLogger } from '../../src/infrastructure/logging/logger.ts'

const fixed = () => new Date('2026-10-13T12:00:00.000Z')

describe('logger', () => {
	it('formato legible: hora, nivel, evento y campos', () => {
		const lines: string[] = []
		createLogger({ write: line => lines.push(line), now: fixed }).child({ runId: 7 }).info('run.finished', { ms: 143, note: 'con espacios' })
		assert.deepEqual(lines, ['12:00:00.000 INFO  run.finished runId=7 ms=143 note="con espacios"'])
	})

	it('formato JSON para recolectores de logs', () => {
		const lines: string[] = []
		createLogger({ format: 'json', write: line => lines.push(line), now: fixed }).warn('isp.retry', { status: 502 })
		assert.deepEqual(JSON.parse(lines[0] as string), { time: '2026-10-13T12:00:00.000Z', level: 'warn', event: 'isp.retry', status: 502 })
	})

	it('respeta el nivel mínimo', () => {
		const lines: string[] = []
		const logger = createLogger({ level: 'warn', write: line => lines.push(line) })
		logger.debug('a'); logger.info('b'); logger.warn('c'); logger.error('d')
		assert.equal(lines.length, 2)
		createLogger({ level: 'silent', write: line => lines.push(line) }).error('e')
		assert.equal(lines.length, 2)
	})

	it('nunca escribe contraseñas ni tokens', () => {
		const lines: string[] = []
		createLogger({ write: line => lines.push(line) }).info('x', { password: 'cobrix-sandbox', accessToken: 'eyJ…', authorization: 'Bearer eyJ…', user: 'cobrix' })
		assert.doesNotMatch(lines[0] as string, /cobrix-sandbox|eyJ/)
		assert.match(lines[0] as string, /user=cobrix/)
	})
})
