/**
 * Strict reading of `GET /isp/contrato/individual`: an unwrapped list with one row per pending
 * installment (unordered), or a single `deuda_id: "0"` row when the contract owes nothing.
 *
 * Every row repeats the contract header. If the rows contradict each other or the request
 * (another contract, duplicated installments, a header that changes, a label that cannot be
 * read) the whole contract is `contradictory`: Cobrix never guesses which row is right.
 */

import { toCents, type Cents } from './money.ts'
import { parseDebtDetail } from './period.ts'

export const KNOWN_STATUSES = ['ACTIVO', 'CORTADO', 'CORTESIA', 'RETIRADO', 'RECHAZADO', 'ANULADO'] as const
export type ContractStatus = (typeof KNOWN_STATUSES)[number]

export interface ContractSnapshot {
	readonly id: number
	readonly code: string
	/** Raw `identificacion_contrato`, before normalization. */
	readonly rawIdentification: string
	readonly holderName: string
	readonly email: string | null
	readonly phone: string | null
	readonly address: string | null
	/** As reported. May be a status Cobrix does not know. */
	readonly status: string
	readonly plan: string
	readonly planPriceCents: Cents
	readonly currency: string
	readonly branch: string
}

export interface PendingInstallment {
	/** `deuda_id`, the external id of the Cobrix invoice. */
	readonly externalId: string
	/** `deuda`: the installment balance. */
	readonly amountCents: Cents
	readonly label: string
	readonly period: string
	readonly dueDate: string
}

export type ContractReading =
	| { readonly kind: 'ok'; readonly contract: ContractSnapshot; readonly installments: readonly PendingInstallment[] }
	| { readonly kind: 'contradictory'; readonly reason: string; readonly contract?: ContractSnapshot; readonly externalIds: readonly string[] }

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

/** Header fields that must be identical in every row of the same contract. */
const HEADER_FIELDS = ['contrato_id', 'identificacion_contrato', 'nombre_contrato', 'estado', 'moneda_sigla', 'precio_servicio', 'nombre_plan'] as const

function snapshot(row: Row): ContractSnapshot | string {
	const id = row.contrato_id
	if (typeof id !== 'number' || !Number.isInteger(id)) return 'contrato_id no es un entero'
	const rawIdentification = typeof row.identificacion_contrato === 'string' ? row.identificacion_contrato : ''
	const holderName = text(row.nombre_contrato)
	if (!holderName) return 'el contrato no trae nombre del titular'
	const status = text(row.estado)
	if (!status) return 'el contrato no trae estado'
	const currency = text(row.moneda_sigla)
	if (!currency) return 'el contrato no trae moneda'
	const planPriceCents = toCents(row.precio_servicio)
	if (planPriceCents === undefined) return 'precio_servicio no es un monto'
	return {
		id,
		code: text(row.codigo) ?? String(id),
		rawIdentification,
		holderName,
		email: text(row.email)?.toLowerCase() ?? null,
		phone: text(row.telefono),
		address: text(row.direccion),
		status: status.toUpperCase(),
		plan: text(row.nombre_plan) ?? '',
		planPriceCents,
		currency: currency.toUpperCase(),
		branch: text(row.nombre_sucursal) ?? text(row.sigla_sucursal) ?? '',
	}
}

export function readContract(requestedId: number, body: unknown): ContractReading {
	const contradictory = (reason: string, contract?: ContractSnapshot, rows: readonly unknown[] = []): ContractReading => ({
		kind: 'contradictory',
		reason,
		...(contract ? { contract } : {}),
		externalIds: rows.filter(isRow).map(row => row.deuda_id).filter((id): id is string => typeof id === 'string' && id !== '0'),
	})

	if (!Array.isArray(body)) return contradictory('la respuesta no es una lista de cuotas')
	if (body.length === 0) return contradictory('la respuesta llegó vacía: ni cuotas ni la fila «sin deuda»')
	if (!body.every(isRow)) return contradictory('hay filas que no son objetos', undefined, body)
	const rows = body as Row[]

	const first = rows[0] as Row
	const contract = snapshot(first)
	if (typeof contract === 'string') return contradictory(contract, undefined, rows)
	if (contract.id !== requestedId) return contradictory(`se pidió el contrato ${requestedId} y llegaron filas del ${contract.id}`, undefined, rows)
	for (const row of rows) {
		for (const field of HEADER_FIELDS) {
			if (JSON.stringify(row[field]) !== JSON.stringify(first[field])) {
				return contradictory(`las filas no coinciden en «${field}»`, contract, rows)
			}
		}
	}

	const noDebt = rows.filter(row => row.deuda_id === '0')
	if (noDebt.length > 0) {
		if (rows.length > 1) return contradictory('la fila «sin deuda» llegó junto con cuotas', contract, rows)
		if (toCents((noDebt[0] as Row).deuda) !== 0) return contradictory('la fila «sin deuda» trae un monto', contract, rows)
		return { kind: 'ok', contract, installments: [] }
	}

	const installments: PendingInstallment[] = []
	const seen = new Set<string>()
	for (const row of rows) {
		const externalId = row.deuda_id
		if (typeof externalId !== 'string' || !/^\d+$/.test(externalId)) return contradictory('hay una cuota sin deuda_id válido', contract, rows)
		if (seen.has(externalId)) return contradictory(`la cuota ${externalId} llegó duplicada`, contract, rows)
		seen.add(externalId)
		const amountCents = toCents(row.deuda)
		if (amountCents === undefined) return contradictory(`la cuota ${externalId} no trae un monto válido`, contract, rows)
		const label = parseDebtDetail(row.detalle_deuda)
		if (!label) return contradictory(`no se puede leer el periodo de la cuota ${externalId}`, contract, rows)
		installments.push({
			externalId,
			amountCents,
			label: (row.detalle_deuda as string[])[0] as string,
			period: label.period,
			dueDate: label.dueDate,
		})
	}
	// The API does not sort them; Cobrix does, oldest first.
	installments.sort((a, b) => a.period.localeCompare(b.period) || a.externalId.localeCompare(b.externalId))
	for (let i = 1; i < installments.length; i++) {
		const previous = installments[i - 1] as PendingInstallment
		const current = installments[i] as PendingInstallment
		if (previous.period === current.period) return contradictory(`dos cuotas del mismo periodo ${current.period}`, contract, rows)
	}
	return { kind: 'ok', contract, installments }
}
