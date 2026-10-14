/**
 * Anti-corruption layer for `GET /isp/pago_informacion?tipo_busqueda=CUOTA`: the installment ledger.
 *
 * - One row per installment and per collection invoice that touched it; `id_factura: 0` means
 *   the installment has no collection at all.
 * - Every row shows the CURRENT state of the installment, so rows of the same installment
 *   must agree with each other.
 * - `success` comes as `false` even with data: it is ignored, the shape is what is checked.
 * - It also lists future (and phantom) installments: callers look up the ones they need.
 * - The discount comes signed: an exonerated month shows `descuento: -tarifa`.
 *
 * Rows of another contract invalidate the whole ledger (the response is wrong). A row with
 * unreadable amounts only invalidates its own installment.
 */

import type { LedgerReading, LedgerRow } from '../../domain/ledger.ts'
import { toCents, toSignedCents } from '../../domain/money.ts'

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function readLedger(contractId: number, body: unknown): LedgerReading {
	const contradictory = (reason: string): LedgerReading => ({ kind: 'contradictory', reason })
	if (!isRow(body) || !Array.isArray(body.data)) return contradictory('el libro no trae la lista «data»')

	const byInstallment = new Map<string, LedgerRow[]>()
	const invalid = new Map<string, string>()
	for (const raw of body.data as unknown[]) {
		if (!isRow(raw) || !isRow(raw.detalle_pago)) return contradictory('hay filas del libro sin detalle_pago')
		const detail = raw.detalle_pago
		// In CUOTA mode the contract comes both at the top and inside the detail: both must match.
		if (raw.id_contrato !== contractId || detail.id_contrato !== contractId) {
			return contradictory(`el libro del contrato ${contractId} trae filas de otro contrato`)
		}
		const invoiceId = raw.id_factura
		const installmentId = detail.id_cuota
		if (typeof invoiceId !== 'number' || !Number.isInteger(invoiceId) || invoiceId < 0) return contradictory('id_factura no es un entero')
		if (typeof installmentId !== 'number' || !Number.isInteger(installmentId)) return contradictory('id_cuota no es un entero')
		const issuedOn = typeof raw.fecha_emision === 'string' && DATE.test(raw.fecha_emision) ? raw.fecha_emision : undefined
		const feeCents = toCents(detail.tarifa)
		const paidCents = toCents(detail.valor_pago)
		const discountCents = toSignedCents(detail.descuento ?? 0)
		const balanceCents = toCents(detail.saldo_cuota)
		if (!issuedOn || feeCents === undefined || paidCents === undefined || discountCents === undefined || balanceCents === undefined) {
			invalid.set(String(installmentId), `el libro trae la cuota ${installmentId} con ${issuedOn ? 'montos no válidos' : 'fecha no válida'}`)
			continue
		}
		const row: LedgerRow = {
			invoiceId,
			invoiceNumber: typeof raw.num_factura === 'string' ? raw.num_factura : '',
			issuedOn,
			installmentId: String(installmentId),
			period: typeof detail.periodo_cuota === 'string' ? detail.periodo_cuota : '',
			feeCents, paidCents, discountCents, balanceCents,
		}
		const list = byInstallment.get(row.installmentId) ?? []
		list.push(row)
		byInstallment.set(row.installmentId, list)
	}
	return { kind: 'ok', byInstallment, invalid }
}
