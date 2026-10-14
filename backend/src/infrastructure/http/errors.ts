/**
 * One error format for the whole API:
 *
 *   { "error": { "code": "validation_failed", "message": "Revisa los campos marcados.", "fields": { "rif": "…" } } }
 *
 * | code               | status | when                                                    |
 * |--------------------|--------|---------------------------------------------------------|
 * | bad_request        | 400    | malformed JSON or a missing/invalid parameter           |
 * | not_found          | 404    | unknown route, run or customer                          |
 * | run_in_progress    | 409    | another run holds the lock                              |
 * | payload_too_large  | 413    | body over 1 MB                                          |
 * | validation_failed  | 422    | settings with invalid fields (`fields` says which)      |
 * | upstream_error     | 502    | the invoice manager failed in a synchronous call        |
 * | internal_error     | 500    | anything unexpected (details only in the server log)    |
 */

import { InvoiceManagerError } from '../../application/ports/invoice-manager.ts'
import { RunInProgressError } from '../../application/ports/store.ts'
import { ValidationError } from '../../application/settings.ts'

export type ErrorCode =
	| 'bad_request' | 'not_found' | 'run_in_progress' | 'payload_too_large' | 'validation_failed' | 'upstream_error' | 'internal_error'

export interface ErrorBody {
	readonly error: { readonly code: ErrorCode; readonly message: string; readonly fields?: Record<string, string> }
}

export class HttpError extends Error {
	readonly status: number
	readonly code: ErrorCode
	constructor(status: number, code: ErrorCode, message: string) {
		super(message)
		this.status = status
		this.code = code
	}
}

export const badRequest = (message: string) => new HttpError(400, 'bad_request', message)
export const notFound = (message: string) => new HttpError(404, 'not_found', message)

/** Maps any error to its status and normalized body. `expected` is false for 500s (they get logged with the stack). */
export function toErrorResponse(error: unknown): { status: number; body: ErrorBody; expected: boolean } {
	if (error instanceof ValidationError) {
		return { status: 422, body: { error: { code: 'validation_failed', message: error.message, fields: error.fields } }, expected: true }
	}
	if (error instanceof RunInProgressError) return { status: 409, body: { error: { code: 'run_in_progress', message: error.message } }, expected: true }
	if (error instanceof InvoiceManagerError) return { status: 502, body: { error: { code: 'upstream_error', message: error.message } }, expected: true }
	if (error instanceof HttpError) return { status: error.status, body: { error: { code: error.code, message: error.message } }, expected: true }
	return {
		status: 500,
		body: { error: { code: 'internal_error', message: 'Error interno de Cobrix. Revisa el registro del servidor.' } },
		expected: false,
	}
}
