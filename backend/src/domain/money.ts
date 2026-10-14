/**
 * Money is handled as integer cents inside Cobrix. The invoice manager sends floats with up to
 * six decimals (24.998683), so every amount is rounded to cents once, at the boundary.
 */

export type Cents = number

/** A finite, non-negative amount in currency units → cents. Anything else is `undefined`. */
export function toCents(value: unknown): Cents | undefined {
	const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
	if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) return undefined
	return Math.round(number * 100)
}

/** Like toCents but the sign is allowed (discounts come negative). */
export function toSignedCents(value: unknown): Cents | undefined {
	const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
	if (typeof number !== 'number' || !Number.isFinite(number)) return undefined
	return Math.round(number * 100)
}

/** `123500` → `1.235,00`, the Venezuelan way. The currency code is added by the caller. */
export function formatAmount(cents: Cents): string {
	return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
}
