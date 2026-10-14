/**
 * Installment period and dates, read from `detalle_deuda` («PLAN15MB25 - 2026 Agosto»).
 * The due date is the first day of the period; the cutoff adds the configured grace days.
 */

import { addCivilDays, addMonths } from '../../shared/dates.ts'

const MONTHS: Record<string, number> = {
	enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
	agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

const LABEL = /^(.+?)\s+-\s+(\d{4})\s+(\p{L}+)$/u

export interface InstallmentLabel {
	readonly plan: string
	/** `YYYY-MM`. */
	readonly period: string
	/** `YYYY-MM-DD`. */
	readonly dueDate: string
}

/** Parses one label. Returns `undefined` for anything that is not exactly «PLAN - YYYY Mes». */
export function parseInstallmentLabel(label: unknown): InstallmentLabel | undefined {
	if (typeof label !== 'string') return undefined
	const match = LABEL.exec(label.trim())
	if (!match) return undefined
	const [, plan, year, monthName] = match as unknown as [string, string, string, string]
	const month = MONTHS[monthName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()]
	if (month === undefined) return undefined
	const period = `${year}-${String(month).padStart(2, '0')}`
	return { plan: plan.trim(), period, dueDate: `${period}-01` }
}

/** `detalle_deuda` is a list; an installment must carry exactly one label. */
export function parseDebtDetail(detail: unknown): InstallmentLabel | undefined {
	if (!Array.isArray(detail) || detail.length !== 1) return undefined
	return parseInstallmentLabel(detail[0])
}

export function cutoffDate(dueDate: string, graceDays: number): string {
	return addCivilDays(dueDate, graceDays)
}

/** First period inside an import window of `months` months back from `currentPeriod`. */
export function windowStart(currentPeriod: string, months: number): string {
	return addMonths(currentPeriod, -months)
}
