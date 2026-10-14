/**
 * Civil dates (`YYYY-MM-DD`, `YYYY-MM`) in America/Caracas, Cobrix's business time zone.
 * `SANDBOX_TODAY` pins "today" so the test environment is repeatable (see docs/ENUNCIADO.md §5).
 */

export const TIME_ZONE = 'America/Caracas'

export function today(): string {
	const pinned = process.env.SANDBOX_TODAY
	if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned
	return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** Current `HH:MM` in Caracas. */
export function timeOfDay(now: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
}

/** `2026-10` + 3 → `2027-01`. */
export function addMonths(period: string, months: number): string {
	const [year, month] = period.split('-').map(Number) as [number, number]
	const index = year * 12 + (month - 1) + months
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function addCivilDays(date: string, days: number): string {
	const value = new Date(`${date}T00:00:00Z`)
	value.setUTCDate(value.getUTCDate() + days)
	return value.toISOString().slice(0, 10)
}
