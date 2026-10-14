/**
 * ENUNCIADO §4, rule by rule, over the pure domain (no network, no database).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { readContract } from '../../src/infrastructure/invoice-manager/contract-mapper.ts'
import { normalizeIdentification } from '../../src/domain/identification.ts'
import { classifyContract, type ImportRules } from '../../src/domain/import-rules.ts'
import type { LedgerRow } from '../../src/domain/ledger.ts'
import { readLedger } from '../../src/infrastructure/invoice-manager/ledger-mapper.ts'
import { toCents } from '../../src/domain/money.ts'
import { classifyPayment } from '../../src/domain/payment-rules.ts'
import { cutoffDate, parseDebtDetail } from '../../src/domain/period.ts'

const RULES: ImportRules = { importableStatuses: ['ACTIVO', 'CORTADO'], windowMonths: null, maxRecentPerContract: null, excludedDocumentTypes: [] }
const PERIOD = '2026-10'

/** A `contrato/individual` row shaped like the real one, with only the fields Cobrix reads. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		contrato_id: 900101, codigo: 'C-900101', identificacion_contrato: 'V-12345678', nombre_contrato: 'ANA PEREZ',
		telefono: '0414-0000000', email: 'ANA@EXAMPLE.COM', estado: 'ACTIVO', deuda: 25, deuda_id: '7000009',
		detalle_deuda: ['PLAN15MB25 - 2026 Septiembre'], precio_servicio: '25.000000', nombre_plan: 'PLAN15MB25',
		nombre_sucursal: 'Valencia', sigla_sucursal: 'VLN', moneda_sigla: 'USD',
		...overrides,
	}
}

const verdicts = (body: unknown, rules = RULES, id = 900101) =>
	classifyContract(id, readContract(id, body), rules, PERIOD).installments.map(item => item.verdict.kind === 'eligible' ? 'eligible' : item.verdict.reason)

describe('clientes: identificación del titular', () => {
	it('quita separadores y ceros a la izquierda', () => {
		assert.equal(normalizeIdentification('V-12345678')?.id, 'V12345678')
		assert.equal(normalizeIdentification('09000123')?.id, '9000123')
		assert.equal(normalizeIdentification('J-40123456-7')?.id, 'J401234567')
		assert.equal(normalizeIdentification(' e.81.234.567 ')?.id, 'E81234567')
		assert.equal(normalizeIdentification('V-0012345678')?.id, 'V12345678')
	})

	it('J y G son jurídicas; V, E, P y sin letra, naturales', () => {
		assert.equal(normalizeIdentification('J-40123456-7')?.personType, 'juridica')
		assert.equal(normalizeIdentification('G200000001')?.personType, 'juridica')
		assert.equal(normalizeIdentification('V12345678')?.personType, 'natural')
		assert.equal(normalizeIdentification('P1234567')?.personType, 'natural')
		assert.equal(normalizeIdentification('09000123')?.personType, 'natural')
		assert.equal(normalizeIdentification('09000123')?.documentType, null)
	})

	it('rechaza lo que no es letra opcional + 6 a 12 dígitos', () => {
		for (const bad of ['', 'V-12345', 'X-12345678', 'V-1234567890123', 'V-12A45678', '000012345', 'VV12345678', null, 12345678]) {
			assert.equal(normalizeIdentification(bad), undefined, String(bad))
		}
	})

	it('un contrato sin identificación válida no se importa', () => {
		assert.deepEqual(verdicts([row({ identificacion_contrato: 'S/N' })]), ['invalid_identification'])
	})
})

describe('facturas: periodo, vencimiento y corte', () => {
	it('salen de detalle_deuda', () => {
		assert.deepEqual(parseDebtDetail(['PLAN - 2026 Agosto']), { plan: 'PLAN', period: '2026-08', dueDate: '2026-08-01' })
		assert.equal(parseDebtDetail(['PLAN30MB35 - 2026 septiembre'])?.period, '2026-09')
		assert.equal(cutoffDate('2026-08-01', 5), '2026-08-06')
		assert.equal(cutoffDate('2026-12-01', 60), '2027-01-30')
	})

	it('un detalle ilegible, vacío o con dos etiquetas deja el contrato fuera', () => {
		for (const detail of [[], ['PLAN - Agosto 2026'], ['PLAN - 2026 Agosto', 'PLAN - 2026 Septiembre'], 'PLAN - 2026 Agosto']) {
			assert.deepEqual(verdicts([row({ detalle_deuda: detail })]), ['contradictory'], JSON.stringify(detail))
		}
	})
})

describe('importación: qué cuotas se importan', () => {
	it('una factura por cuota pendiente, ordenadas aunque la API no las ordene', () => {
		const result = classifyContract(900101, readContract(900101, [
			row({ deuda_id: '7000010', deuda: 25, detalle_deuda: ['PLAN15MB25 - 2026 Octubre'] }),
			row({ deuda_id: '7000008', deuda: 20, detalle_deuda: ['PLAN15MB25 - 2026 Agosto'] }),
			row(),
		]), RULES, PERIOD)
		assert.equal(result.exclusion, null)
		assert.deepEqual(result.installments.map(item => 'period' in item.installment && item.installment.period), ['2026-08', '2026-09', '2026-10'])
		assert.deepEqual(result.installments.map(item => 'amountCents' in item.installment && item.installment.amountCents), [2000, 2500, 2500])
	})

	it('la fila deuda_id "0" es «sin deuda», no una cuota', () => {
		const result = classifyContract(900109, readContract(900109, [row({ contrato_id: 900109, deuda_id: '0', deuda: 0, detalle_deuda: [] })]), RULES, PERIOD)
		assert.equal(result.hasDebt, false)
		assert.deepEqual(result.installments, [])
	})

	it('una cuota con deuda 0 (residual) no se importa', () => {
		assert.deepEqual(verdicts([row({ deuda: 0 }), row({ deuda_id: '7000010', detalle_deuda: ['PLAN15MB25 - 2026 Octubre'] })]), ['zero_amount', 'eligible'])
	})

	it('solo estados importables; los demás quedan fuera con su motivo', () => {
		for (const estado of ['CORTESIA', 'RETIRADO', 'RECHAZADO', 'ANULADO']) {
			assert.deepEqual(verdicts([row({ estado })]), ['status_not_importable'], estado)
		}
		assert.deepEqual(verdicts([row({ estado: 'CORTADO' })]), ['eligible'])
		assert.deepEqual(verdicts([row({ estado: 'CORTESIA' })], { ...RULES, importableStatuses: ['CORTESIA'] }), ['eligible'])
	})

	it('un estado desconocido no se adivina, aunque esté marcado como importable', () => {
		assert.deepEqual(verdicts([row({ estado: 'SUSPENDIDO' })], { ...RULES, importableStatuses: ['SUSPENDIDO'] }), ['status_unrecognized'])
	})

	it('solo USD; USD con cuotas por debajo del 1 % del plan es moneda incoherente', () => {
		assert.deepEqual(verdicts([row({ moneda_sigla: 'VES' })]), ['currency_not_supported'])
		assert.deepEqual(verdicts([row({ deuda: 0.05, precio_servicio: '20.000000' })]), ['currency_incoherent'])
		assert.deepEqual(verdicts([row({ deuda: 0.2, precio_servicio: '20.000000' })]), ['eligible'])
	})

	it('excluye por tipo de documento; sin letra no se asume ningún tipo', () => {
		const rules = { ...RULES, excludedDocumentTypes: ['J' as const, 'V' as const] }
		assert.deepEqual(verdicts([row({ identificacion_contrato: 'J-40123456-7' })], rules), ['document_type_excluded'])
		assert.deepEqual(verdicts([row({ identificacion_contrato: '09000123' })], rules), ['eligible'])
	})

	it('ventana de importación y máximo de cuotas recientes', () => {
		const body = ['Marzo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre'].map((month, i) =>
			row({ deuda_id: String(7000090 + i), detalle_deuda: [`PLAN15MB25 - 2026 ${month}`] }))
		assert.deepEqual(verdicts(body, { ...RULES, windowMonths: 3 }),
			['outside_window', 'outside_window', 'eligible', 'eligible', 'eligible', 'eligible'])
		assert.deepEqual(verdicts(body, { ...RULES, maxRecentPerContract: 2 }),
			['outside_recent', 'outside_recent', 'outside_recent', 'outside_recent', 'eligible', 'eligible'])
		assert.deepEqual(verdicts(body, { ...RULES, windowMonths: 3, maxRecentPerContract: 10 }),
			['outside_window', 'outside_window', 'eligible', 'eligible', 'eligible', 'eligible'])
	})
})

describe('importación: respuestas que se contradicen', () => {
	it('filas de otro contrato', () => {
		assert.deepEqual(verdicts([row(), row({ contrato_id: 900102, deuda_id: '7000022' })]), ['contradictory', 'contradictory'])
		assert.deepEqual(verdicts([row({ contrato_id: 900102 })]), ['contradictory'])
	})

	it('cuotas duplicadas o dos cuotas del mismo periodo', () => {
		assert.deepEqual(verdicts([row(), row()]), ['contradictory', 'contradictory'])
		assert.deepEqual(verdicts([row(), row({ deuda_id: '7000099' })]), ['contradictory', 'contradictory'])
	})

	it('cabecera que cambia entre filas, «sin deuda» mezclada con cuotas, montos raros', () => {
		const second = { deuda_id: '7000010', detalle_deuda: ['PLAN15MB25 - 2026 Octubre'] }
		assert.deepEqual(verdicts([row(), row({ ...second, estado: 'CORTADO' })]), ['contradictory', 'contradictory'])
		assert.deepEqual(verdicts([row(), row({ ...second, identificacion_contrato: 'V-1' })]), ['contradictory', 'contradictory'])
		assert.deepEqual(verdicts([row(), row({ deuda_id: '0', deuda: 0 })]), ['contradictory'])
		assert.deepEqual(verdicts([row({ deuda: -5 })]), ['contradictory'])
		assert.deepEqual(verdicts([row({ deuda: '25' })]), ['eligible'], 'un número en texto sí se acepta')
		assert.deepEqual(verdicts([row({ deuda: 'veinte' })]), ['contradictory'])
	})

	it('lista vacía, objeto o nulo', () => {
		for (const body of [[], {}, null, 'error', [null]]) {
			const result = classifyContract(900101, readContract(900101, body), RULES, PERIOD)
			assert.equal(result.exclusion?.reason, 'contradictory', JSON.stringify(body))
		}
	})

	it('readContract explica el motivo', () => {
		const reading = readContract(900101, [row(), row({ contrato_id: 900102 })])
		assert.equal(reading.kind, 'contradictory')
		assert.match(reading.kind === 'contradictory' ? reading.reason : '', /contrato_id/)
	})
})

describe('pagos: libro de cuotas', () => {
	const ledgerRow = (overrides: Partial<LedgerRow> = {}): LedgerRow => ({
		invoiceId: 0, invoiceNumber: '', issuedOn: '2026-09-30', installmentId: '7000009', period: '2026-09',
		feeCents: 2500, paidCents: 0, discountCents: 0, balanceCents: 2500, ...overrides,
	})
	const invoice = { externalId: '7000009', balanceCents: 2500 }

	it('pagada: saldo 0, algo pagado y todas las filas coinciden', () => {
		const rows = [
			ledgerRow({ invoiceId: 8800007, invoiceNumber: '008800007', issuedOn: '2026-09-06', paidCents: 2500, balanceCents: 0 }),
			ledgerRow({ invoiceId: 8800120, invoiceNumber: '008800120', issuedOn: '2026-10-13', paidCents: 2500, balanceCents: 0 }),
		]
		assert.deepEqual(classifyPayment(invoice, rows), { kind: 'paid', paidOn: '2026-10-13', paidBy: { invoiceId: 8800120, invoiceNumber: '008800120' } })
	})

	it('abono parcial: saldo menor al de Cobrix, sigue abierta', () => {
		const verdict = classifyPayment({ externalId: '7000032', balanceCents: 2000 }, [ledgerRow({ invoiceId: 8800120, paidCents: 500, balanceCents: 1500 })])
		assert.equal(verdict.kind, 'partial')
		assert.equal(verdict.kind === 'partial' && verdict.ispBalanceCents, 1500)
	})

	it('exonerada (saldo 0 sin nada pagado) no es un pago', () => {
		assert.deepEqual(classifyPayment(invoice, [ledgerRow({ balanceCents: 0, discountCents: 2500 })]), { kind: 'exonerated' })
	})

	it('filas que no coinciden: no se decide', () => {
		const rows = [ledgerRow({ invoiceId: 1, balanceCents: 0, paidCents: 2500 }), ledgerRow({ invoiceId: 2, balanceCents: 500, paidCents: 2000 })]
		assert.equal(classifyPayment(invoice, rows).kind, 'contradictory')
	})

	it('sin evidencia: ni en el libro ni pendiente en el contrato → nunca pagada', () => {
		assert.deepEqual(classifyPayment(invoice, []), { kind: 'no_evidence' })
	})

	it('mes en curso fuera del libro: se consulta el contrato', () => {
		assert.deepEqual(classifyPayment(invoice, [], 2500), { kind: 'still_open', ispBalanceCents: 2500 })
		assert.equal(classifyPayment(invoice, [], 1000).kind, 'partial')
	})

	it('pago anulado: el saldo vuelve y la factura sigue abierta', () => {
		const rows = [ledgerRow({ invoiceId: 8800120, issuedOn: '2026-10-13', paidCents: 0, balanceCents: 2500 })]
		assert.equal(classifyPayment(invoice, rows).kind, 'still_open')
	})

	it('saldo que sube respecto de Cobrix: se informa, sigue abierta', () => {
		assert.equal(classifyPayment({ externalId: '7000009', balanceCents: 2000 }, [ledgerRow()]).kind, 'balance_increased')
	})
})

describe('pagos: lectura estricta del libro', () => {
	const entry = (overrides: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) => ({
		id_factura: 0, num_factura: '', fecha_emision: '2026-09-30', id_contrato: 900101,
		detalle_pago: { id_contrato: 900101, id_cuota: 7000009, periodo_cuota: '2026-09', tarifa: 25, valor_pago: 0, descuento: 0, saldo_cuota: 25, ...detail },
		...overrides,
	})

	it('ignora success:false si los datos tienen forma', () => {
		const reading = readLedger(900101, { success: false, data: [entry()] })
		assert.equal(reading.kind, 'ok')
		assert.equal(reading.kind === 'ok' && reading.byInstallment.get('7000009')?.length, 1)
	})

	it('saldos con seis decimales se redondean a centavos', () => {
		const reading = readLedger(900101, { data: [entry({}, { valor_pago: 24.998683, saldo_cuota: 0.001317 })] })
		assert.equal(reading.kind === 'ok' && reading.byInstallment.get('7000009')?.[0]?.balanceCents, 0)
		assert.equal(toCents(0.005), 1)
	})

	it('filas de otro contrato o sin forma: el libro entero no se usa', () => {
		assert.equal(readLedger(900101, { data: [entry({ id_contrato: 900102 })] }).kind, 'contradictory')
		assert.equal(readLedger(900101, { data: [entry({}, { id_contrato: 900102 })] }).kind, 'contradictory')
		assert.equal(readLedger(900101, { message: 'error' }).kind, 'contradictory')
	})

	it('una fila con montos ilegibles invalida solo su cuota, no las demás', () => {
		const reading = readLedger(900101, { data: [entry({}, { id_cuota: 7000008, saldo_cuota: null }), entry()] })
		assert.equal(reading.kind, 'ok')
		if (reading.kind !== 'ok') return
		assert.match(reading.invalid.get('7000008') ?? '', /montos no válidos/)
		assert.equal(reading.byInstallment.get('7000009')?.length, 1)
	})

	it('el descuento llega con signo: una cuota exonerada trae descuento = -tarifa', () => {
		const reading = readLedger(900115, { data: [entry({ id_contrato: 900115 }, { id_contrato: 900115, descuento: -25, saldo_cuota: 0 })] })
		assert.equal(reading.kind, 'ok')
		const rows = reading.kind === 'ok' ? reading.byInstallment.get('7000009') ?? [] : []
		assert.equal(rows[0]?.discountCents, -2500)
		assert.deepEqual(classifyPayment({ externalId: '7000009', balanceCents: 2500 }, rows), { kind: 'exonerated' })
	})
})
