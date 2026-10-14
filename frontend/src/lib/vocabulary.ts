/**
 * Operator-facing names for run results and counters. The counter keys are Cobrix's own
 * names; the panel shows both so support and operators speak the same language.
 */

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'review' | 'muted'

export interface ResultInfo {
	label: string
	tone: Tone
	/** Group for the filter chips of a run detail. */
	group: 'done' | 'pending' | 'excluded' | 'attention'
}

export const RESULTS: Record<string, ResultInfo> = {
	imported: { label: 'Importada', tone: 'success', group: 'done' },
	would_import: { label: 'Se importaría', tone: 'info', group: 'done' },
	already_imported: { label: 'Ya importada', tone: 'muted', group: 'pending' },
	blocked_by_limit: { label: 'Frenada por tope', tone: 'warning', group: 'attention' },
	status_not_importable: { label: 'Excluida por estado', tone: 'neutral', group: 'excluded' },
	status_unrecognized: { label: 'Estado desconocido', tone: 'review', group: 'attention' },
	currency_incoherent: { label: 'Moneda incoherente', tone: 'review', group: 'excluded' },
	currency_not_supported: { label: 'Moneda no soportada', tone: 'neutral', group: 'excluded' },
	invalid_identification: { label: 'Identificación inválida', tone: 'review', group: 'attention' },
	document_type_excluded: { label: 'Excluida por documento', tone: 'neutral', group: 'excluded' },
	contradictory: { label: 'Respuesta contradictoria', tone: 'review', group: 'attention' },
	zero_amount: { label: 'Saldo residual', tone: 'neutral', group: 'excluded' },
	outside_window: { label: 'Fuera de ventana', tone: 'neutral', group: 'excluded' },
	outside_recent: { label: 'Fuera de recientes', tone: 'neutral', group: 'excluded' },
	no_debt: { label: 'Sin deuda', tone: 'muted', group: 'excluded' },
	no_longer_pending: { label: 'Ya no pendiente', tone: 'warning', group: 'attention' },
	lookup_failed: { label: 'Consulta fallida', tone: 'danger', group: 'attention' },
	marked_paid: { label: 'Marcada pagada', tone: 'success', group: 'done' },
	would_mark_paid: { label: 'Se marcaría pagada', tone: 'info', group: 'done' },
	partial: { label: 'Abono parcial', tone: 'warning', group: 'attention' },
	still_open: { label: 'Sigue pendiente', tone: 'muted', group: 'pending' },
	under_review: { label: 'En revisión', tone: 'review', group: 'attention' },
	no_evidence: { label: 'Sin evidencia', tone: 'review', group: 'attention' },
}

export function resultInfo(code: string): ResultInfo {
	return RESULTS[code] ?? { label: code, tone: 'neutral', group: 'attention' }
}

export interface CounterInfo {
	key: string
	label: string
	money?: boolean
}

export const IMPORT_COUNTERS: CounterInfo[] = [
	{ key: 'contractsObserved', label: 'Contratos leídos' },
	{ key: 'contractsWithDebt', label: 'Contratos con deuda' },
	{ key: 'contractsIndeterminate', label: 'Contratos indeterminados' },
	{ key: 'contractsStatusUnrecognized', label: 'Estado desconocido' },
	{ key: 'contractsCurrencyIncoherent', label: 'Moneda incoherente' },
	{ key: 'contractsCurrencyUnsupported', label: 'Moneda no soportada' },
	{ key: 'contractsInvalidIdentifier', label: 'Identificación inválida' },
	{ key: 'contractsExcludedByIdentifierType', label: 'Contratos excluidos por documento' },
	{ key: 'contractsFailed', label: 'Consultas fallidas' },
	{ key: 'installmentsPending', label: 'Cuotas pendientes' },
	{ key: 'installmentsImported', label: 'Importadas' },
	{ key: 'installmentsWouldImport', label: 'Se importarían' },
	{ key: 'installmentsAlreadyImported', label: 'Ya importadas' },
	{ key: 'installmentsExcludedByStatus', label: 'Excluidas por estado' },
	{ key: 'installmentsExcludedByCurrency', label: 'Excluidas por moneda' },
	{ key: 'installmentsIndeterminate', label: 'Cuotas indeterminadas' },
	{ key: 'installmentsBlockedByLimit', label: 'Frenadas por tope' },
	{ key: 'installmentsZeroAmount', label: 'Saldo residual' },
	{ key: 'installmentsNoLongerPending', label: 'Ya no pendientes' },
	{ key: 'installmentsExcludedByWindow', label: 'Fuera de ventana' },
	{ key: 'installmentsExcludedByRecentLimit', label: 'Fuera de recientes' },
	{ key: 'installmentsExcludedByIdentifierType', label: 'Cuotas excluidas por documento' },
	{ key: 'customersCreated', label: 'Clientes creados' },
	{ key: 'customersWouldCreate', label: 'Clientes que se crearían' },
	{ key: 'amountImportedCents', label: 'Monto importado', money: true },
	{ key: 'amountWouldImportCents', label: 'Monto que se importaría', money: true },
]

export const PAID_COUNTERS: CounterInfo[] = [
	{ key: 'invoicesChecked', label: 'Facturas consultadas' },
	{ key: 'invoicesMarkedPaid', label: 'Marcadas pagadas' },
	{ key: 'invoicesWouldMarkPaid', label: 'Se marcarían pagadas' },
	{ key: 'invoicesStillOpen', label: 'Siguen pendientes' },
	{ key: 'invoicesPartiallyPaidAtIsp', label: 'Abono parcial' },
	{ key: 'invoicesUnderReview', label: 'En revisión' },
	{ key: 'invoicesUnknown', label: 'Sin evidencia' },
	{ key: 'lookupsFailed', label: 'Consultas fallidas' },
	{ key: 'contractsRead', label: 'Contratos releídos' },
	{ key: 'amountMarkedPaidCents', label: 'Monto marcado pagado', money: true },
	{ key: 'amountWouldMarkPaidCents', label: 'Monto que se marcaría pagado', money: true },
]

export const KIND_LABEL = { import: 'Importación', paid: 'Actualización de pagadas' } as const

export const CONTRACT_STATUS_TONE: Record<string, Tone> = {
	ACTIVO: 'success', CORTADO: 'danger', CORTESIA: 'info', RETIRADO: 'muted', RECHAZADO: 'muted', ANULADO: 'muted',
}
