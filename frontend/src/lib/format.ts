/** Display formats: amounts with currency, civil dates and timestamps in America/Caracas. */

const TIME_ZONE = 'America/Caracas'

const amount = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `123500` → `USD 1.235,00`. */
export function money(cents: number | null | undefined, currency = 'USD'): string {
	if (cents === null || cents === undefined) return '—'
	return `${currency} ${amount.format(cents / 100)}`
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Civil date `2026-10-01` → `1 oct 2026` (no time zone shift). */
export function date(value: string | null | undefined): string {
	if (!value) return '—'
	const [year, month, day] = value.slice(0, 10).split('-').map(Number)
	if (!year || !month || !day) return value
	return `${day} ${MONTHS[month - 1]} ${year}`
}

/** Period `2026-08` → `ago 2026`. */
export function period(value: string): string {
	const [year, month] = value.split('-').map(Number)
	return year && month ? `${MONTHS[month - 1]} ${year}` : value
}

/** First letter in capitals only («agosto de 2026» → «Agosto de 2026»). */
export function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1)
}

export function periodLong(value: string): string {
	const [year, month] = value.split('-').map(Number)
	return year && month ? `${MONTHS_LONG[month - 1]} de ${year}` : value
}

/** Timestamp from Postgres (`2026-10-13 22:41:05.12+00`) → `13 oct 2026, 6:41 p. m.` in Caracas. */
export function dateTime(value: string | null | undefined): string {
	if (!value) return '—'
	const parsed = parseTimestamp(value)
	if (Number.isNaN(parsed.getTime())) return value
	return new Intl.DateTimeFormat('es-VE', {
		timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
	}).format(parsed).replace('.', '')
}

/** Postgres timestamp text (`2026-10-13 22:41:05.12+00`, any offset) → Date. */
export function parseTimestamp(value: string): Date {
	return new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
}

export function duration(start: string, end: string | null): string {
	if (!end) return ''
	const ms = parseTimestamp(end).getTime() - parseTimestamp(start).getTime()
	if (!Number.isFinite(ms) || ms < 0) return ''
	return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}

/** Days between two civil dates (`to - from`). */
export function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
}

export function plural(count: number, one: string, many: string): string {
	return `${count.toLocaleString('es-VE')} ${count === 1 ? one : many}`
}
