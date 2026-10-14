/**
 * ENUNCIADO §5, end to end against the real sandbox API over HTTP:
 * simulate → import → import again → pay at the ISP cashier → update paid → update again.
 */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { runImport } from '../src/cobrix/sync/import.ts'
import { runPaid } from '../src/cobrix/sync/paid.ts'
import { startSandbox, type Sandbox } from './helpers.ts'

type Row = Record<string, unknown>

describe('ciclo completo con la API del administrador', () => {
	let sandbox: Sandbox
	const query = (sql: string, params: unknown[] = []) => sandbox.db.query<Row>(sql, params)
	const totals = async () => (await query(
		`SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'paid')::int AS paid,
			COALESCE(sum(balance) FILTER (WHERE status = 'open'), 0)::text AS debt FROM invoice`,
	))[0] as { open: number; paid: number; debt: string }
	const invoicesOf = async (contractId: number) =>
		query(`SELECT external_id, status, balance::text, isp_balance::text, paid_by_invoice FROM invoice WHERE contract_id = $1 ORDER BY period`, [contractId])

	before(async () => { sandbox = await startSandbox() })
	after(async () => { await sandbox.close() })

	it('simular importación: 42 cuotas se importarían y no se crea nada', async () => {
		const outcome = await runImport(sandbox.deps, { dryRun: true })
		assert.equal(outcome.status, 'completed', outcome.error)
		assert.equal(outcome.counters.installmentsWouldImport, 42)
		assert.equal(outcome.counters.customersWouldCreate, 20)
		assert.equal(outcome.counters.amountWouldImportCents, 123_500)
		assert.equal(outcome.counters.installmentsImported, 0)
		assert.deepEqual(await query('SELECT (SELECT count(*) FROM customer)::int AS c, (SELECT count(*) FROM invoice)::int AS i, (SELECT count(*) FROM contract)::int AS k'), [{ c: 0, i: 0, k: 0 }])
		const [run] = await query('SELECT dry_run, status FROM run WHERE id = $1', [outcome.runId])
		assert.deepEqual(run, { dry_run: true, status: 'completed' })
	})

	it('importar: 20 clientes y 42 facturas abiertas por USD 1.235,00', async () => {
		const outcome = await runImport(sandbox.deps, { dryRun: false })
		assert.equal(outcome.status, 'completed', outcome.error)
		const c = outcome.counters
		assert.equal(c.contractsObserved, 27)
		assert.equal(c.installmentsImported, 42)
		assert.equal(c.customersCreated, 20)
		assert.equal(c.amountImportedCents, 123_500)
		// Excluded: 9 by contract status, 1 contract by incoherent currency, 1 residual balance.
		assert.equal(c.installmentsExcludedByStatus, 9)
		assert.equal(c.contractsCurrencyIncoherent, 1)
		assert.equal(c.installmentsZeroAmount, 1)
		assert.equal(c.installmentsPending, 53)
		assert.equal(c.contractsFailed, 0)
		assert.deepEqual(await totals(), { open: 42, paid: 0, debt: '1235.00' })
		const [customers] = await query('SELECT count(*)::int AS n FROM customer')
		assert.equal(customers?.n, 20)
	})

	it('cada cuota queda en el detalle de la corrida con su resultado', async () => {
		const [run] = await query(`SELECT id FROM run WHERE kind = 'import' AND NOT dry_run ORDER BY id DESC LIMIT 1`)
		const rows = await query(`SELECT result, count(*)::int AS n FROM run_item WHERE run_id = $1 GROUP BY result ORDER BY result`, [run?.id])
		assert.deepEqual(Object.fromEntries(rows.map(row => [row.result, row.n])), {
			imported: 42, status_not_importable: 9, currency_incoherent: 2, zero_amount: 1, no_debt: 1,
		})
		const [carlos] = await query(`SELECT detail FROM run_item WHERE run_id = $1 AND customer_name = 'CARLOS ROJAS' LIMIT 1`, [run?.id])
		assert.match(String(carlos?.detail), /cortesía/)
	})

	it('importar otra vez: 0 facturas nuevas', async () => {
		const outcome = await runImport(sandbox.deps, { dryRun: false })
		assert.equal(outcome.counters.installmentsImported, 0)
		assert.equal(outcome.counters.installmentsAlreadyImported, 42)
		assert.equal(outcome.counters.customersCreated, 0)
		assert.deepEqual(await totals(), { open: 42, paid: 0, debt: '1235.00' })
	})

	it('LUIS GOMEZ es 1 cliente con 2 contratos; ELENA RUIZ tiene ID 9000123', async () => {
		const luis = await query(`SELECT c.id, count(k.id)::int AS contracts FROM customer c JOIN contract k ON k.customer_id = c.id WHERE c.name = 'LUIS GOMEZ' GROUP BY c.id`)
		assert.deepEqual(luis, [{ id: 'V9876543', contracts: 2 }])
		const [elena] = await query(`SELECT id, person_type FROM customer WHERE name = 'ELENA RUIZ'`)
		assert.deepEqual(elena, { id: '9000123', person_type: 'natural' })
		const [faro] = await query(`SELECT id, person_type FROM customer WHERE name LIKE 'COMERCIAL EL FARO%'`)
		assert.deepEqual(faro, { id: 'J401234567', person_type: 'juridica' })
	})

	it('no aparecen cortesía, retirado, rechazado, anulado, sin deuda ni moneda incoherente', async () => {
		const names = ['CARLOS ROJAS', 'ROSA DIAZ', 'PEDRO LEON', 'ANDRES VARGAS', 'LAURA MENDEZ', 'JORGE CASTILLO']
		assert.deepEqual(await query('SELECT name FROM customer WHERE name = ANY($1)', [names]), [])
	})

	it('el historial del cliente registra la creación y cada factura importada', async () => {
		const events = await query(`SELECT kind, count(*)::int AS n FROM event WHERE customer_id = 'V9876543' GROUP BY kind ORDER BY kind`)
		assert.deepEqual(events, [{ kind: 'customer_created', n: 1 }, { kind: 'invoice_imported', n: 5 }])
	})

	it('pagos en la caja del ISP → actualizar pagadas: 8 pagadas y 34 abiertas por USD 955,00', async () => {
		await sandbox.sim('pagar', { id_contrato: 900101 })
		await sandbox.sim('pagar', { id_contrato: 900103, monto: 25 })
		await sandbox.sim('pagar', { id_contrato: 900104 })
		await sandbox.sim('pagar', { id_contrato: 900114, monto: 70 })
		const elena = await sandbox.sim('pagar', { id_contrato: 900113 })
		await sandbox.sim('anular', { id_factura: elena.id_factura })

		const simulated = await runPaid(sandbox.deps, { dryRun: true })
		assert.equal(simulated.status, 'completed', simulated.error)
		assert.equal(simulated.counters.invoicesWouldMarkPaid, 8)
		assert.deepEqual(await totals(), { open: 42, paid: 0, debt: '1235.00' }, 'la simulación no escribe')

		const outcome = await runPaid(sandbox.deps, { dryRun: false })
		assert.equal(outcome.status, 'completed', outcome.error)
		assert.equal(outcome.counters.invoicesChecked, 42)
		assert.equal(outcome.counters.invoicesMarkedPaid, 8)
		assert.equal(outcome.counters.invoicesPartiallyPaidAtIsp, 1)
		assert.equal(outcome.counters.invoicesStillOpen, 33)
		assert.equal(outcome.counters.invoicesUnknown, 0)
		assert.equal(outcome.counters.lookupsFailed, 0)
		assert.deepEqual(await totals(), { open: 34, paid: 8, debt: '955.00' })
	})

	it('cada caso de la caja quedó como dice el enunciado', async () => {
		assert.deepEqual((await invoicesOf(900101)).map(row => row.status), ['paid', 'paid', 'paid'])
		assert.deepEqual((await invoicesOf(900104)).map(row => row.status), ['paid', 'paid'])
		// LUIS (900103): July paid; August stays open as a partial payment (ISP owes 15, Cobrix 20).
		const luis = await invoicesOf(900103)
		assert.deepEqual(luis.map(row => row.status), ['paid', 'open', 'open', 'open'])
		assert.deepEqual([luis[1]?.balance, luis[1]?.isp_balance], ['20.00', '15.00'])
		// MIGUEL (900114): 70 pays the two oldest (35 + 35).
		assert.deepEqual((await invoicesOf(900114)).map(row => row.status), ['paid', 'paid', 'open', 'open', 'open', 'open', 'open', 'open'])
		// ELENA (900113): paid and annulled → nothing changes.
		assert.deepEqual((await invoicesOf(900113)).map(row => row.status), ['open', 'open'])
		const [paidEvent] = await query(`SELECT detail FROM event WHERE kind = 'invoice_paid' AND customer_id = 'V12345678' LIMIT 1`)
		assert.match(String(paidEvent?.detail), /factura del administrador 0088\d+ del 2026-10-13/)
	})

	it('repetir la actualización no cambia nada', async () => {
		const outcome = await runPaid(sandbox.deps, { dryRun: false })
		assert.equal(outcome.counters.invoicesChecked, 34)
		assert.equal(outcome.counters.invoicesMarkedPaid, 0)
		assert.deepEqual(await totals(), { open: 34, paid: 8, debt: '955.00' })
		const [events] = await query(`SELECT count(*)::int AS n FROM event WHERE kind = 'invoice_paid'`)
		assert.equal(events?.n, 8)
	})

	it('importar después de los pagos tampoco duplica ni reabre nada', async () => {
		const outcome = await runImport(sandbox.deps, { dryRun: false })
		assert.equal(outcome.counters.installmentsImported, 0)
		assert.deepEqual(await totals(), { open: 34, paid: 8, debt: '955.00' })
	})
})
