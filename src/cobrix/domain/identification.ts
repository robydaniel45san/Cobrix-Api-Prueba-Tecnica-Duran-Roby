/**
 * Holder identification (`identificacion_contrato`), the key of a Cobrix customer.
 *
 * Accepted: an optional type letter (V, E, J, G, P) and 6 to 12 digits, once separators and
 * leading zeros are removed. `V-12345678` → `V12345678`, `09000123` → `9000123`,
 * `J-40123456-7` → `J401234567`. Anything else is invalid and the contract is not imported.
 */

export const DOCUMENT_TYPES = ['V', 'E', 'J', 'G', 'P'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]
export type PersonType = 'natural' | 'juridica'

export interface Identification {
	/** Normalized value, used as the customer key. */
	readonly id: string
	/** `null` when the document came without a type letter: it is not guessed. */
	readonly documentType: DocumentType | null
	readonly personType: PersonType
}

const SEPARATORS = /[\s.\-_/]/g
const SHAPE = /^([VEJGP])?(\d+)$/

export function normalizeIdentification(raw: unknown): Identification | undefined {
	if (typeof raw !== 'string') return undefined
	const compact = raw.toUpperCase().replace(SEPARATORS, '')
	const match = SHAPE.exec(compact)
	if (!match) return undefined
	const documentType = (match[1] ?? null) as DocumentType | null
	const digits = (match[2] ?? '').replace(/^0+/, '')
	if (digits.length < 6 || digits.length > 12) return undefined
	return {
		id: `${documentType ?? ''}${digits}`,
		documentType,
		// J (companies) and G (government) are legal persons; the rest, natural persons.
		personType: documentType === 'J' || documentType === 'G' ? 'juridica' : 'natural',
	}
}
