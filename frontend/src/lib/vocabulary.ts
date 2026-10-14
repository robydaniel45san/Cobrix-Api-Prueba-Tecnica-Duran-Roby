/**
 * The operator's language. Runs, results and counters are named for what they mean to a
 * collections operator; the internal names (counter keys, result codes) appear only in the
 * «Detalle técnico» section, so support and operations still speak the same language.
 */

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'review' | 'muted'

/** What each sync does, in the operator's words. */
export const KIND_LABEL = { import: 'Facturas nuevas', paid: 'Cobros del ISP' } as const
export const KIND_ACTION = { import: 'Traer facturas nuevas', paid: 'Revisar cobros del ISP' } as const
export const KIND_DESCRIPTION = {
	import: 'Trae del ISP las cuotas pendientes como facturas abiertas, con sus clientes. Nunca duplica.',
	paid: 'Revisa en el ISP qué facturas abiertas ya se cobraron en su caja y las marca pagadas.',
} as const

export type ResultGroup = 'new' | 'paid' | 'partial' | 'unchanged' | 'excluded' | 'attention'

export interface ResultInfo {
	/** Short label for a badge. */
	readonly label: string
	/** One sentence: why this happened, in plain words. */
	readonly why: string
	readonly tone: Tone
	readonly group: ResultGroup
}

export const RESULTS: Record<string, ResultInfo> = {
	imported: { label: 'Nueva', why: 'Llegó del ISP como factura abierta.', tone: 'success', group: 'new' },
	would_import: { label: 'Llegaría', why: 'Llegaría del ISP como factura abierta.', tone: 'info', group: 'new' },
	already_imported: { label: 'Ya estaba', why: 'Ya estaba en Cobrix; no se duplica.', tone: 'muted', group: 'unchanged' },
	blocked_by_limit: { label: 'Frenada por tope', why: 'Se alcanzó el tope de esta sincronización; entra en la próxima.', tone: 'warning', group: 'attention' },
	status_not_importable: { label: 'Contrato inactivo', why: 'El contrato no está activo ni cortado, así que no se cobra.', tone: 'neutral', group: 'excluded' },
	status_unrecognized: { label: 'Estado desconocido', why: 'El ISP informa un estado de contrato que no conocemos; no adivinamos si se cobra.', tone: 'review', group: 'attention' },
	currency_incoherent: { label: 'Monto que no cuadra', why: 'Las cuotas son demasiado bajas para el precio del plan; no adivinamos la moneda.', tone: 'review', group: 'excluded' },
	currency_not_supported: { label: 'Otra moneda', why: 'Solo se cobran contratos en dólares.', tone: 'neutral', group: 'excluded' },
	invalid_identification: { label: 'Documento inválido', why: 'La cédula o el RIF del titular no tiene un formato válido.', tone: 'review', group: 'attention' },
	document_type_excluded: { label: 'Tipo de documento excluido', why: 'La configuración excluye este tipo de documento.', tone: 'neutral', group: 'excluded' },
	contradictory: { label: 'Respuesta inconsistente', why: 'El ISP respondió datos que se contradicen; no adivinamos cuál es el correcto.', tone: 'review', group: 'attention' },
	zero_amount: { label: 'Menos de un centavo', why: 'Quedó un residuo de redondeo que no se puede cobrar.', tone: 'neutral', group: 'excluded' },
	outside_window: { label: 'Muy antigua', why: 'Es anterior a la antigüedad máxima configurada.', tone: 'neutral', group: 'excluded' },
	outside_recent: { label: 'Fuera de las recientes', why: 'Solo se traen las cuotas más recientes de cada contrato, según la configuración.', tone: 'neutral', group: 'excluded' },
	no_debt: { label: 'Sin deuda', why: 'El contrato no tiene cuotas pendientes.', tone: 'muted', group: 'unchanged' },
	no_longer_pending: { label: 'Ya no pendiente en el ISP', why: 'Revisa los cobros del ISP para saber si se pagó.', tone: 'warning', group: 'attention' },
	lookup_failed: { label: 'Sin respuesta del ISP', why: 'El ISP no respondió por este contrato; la próxima sincronización lo reintenta.', tone: 'danger', group: 'attention' },
	marked_paid: { label: 'Pagada', why: 'El ISP registró el cobro completo en su caja.', tone: 'success', group: 'paid' },
	would_mark_paid: { label: 'Se pagaría', why: 'El ISP registró el cobro completo en su caja.', tone: 'info', group: 'paid' },
	partial: { label: 'Abono parcial', why: 'El cliente abonó una parte; la factura sigue abierta hasta que se salde.', tone: 'warning', group: 'partial' },
	still_open: { label: 'Sin cambios', why: 'Sigue pendiente en el ISP.', tone: 'muted', group: 'unchanged' },
	under_review: { label: 'Necesita revisión', why: 'El ISP muestra algo que no es un pago claro; no se marca pagada.', tone: 'review', group: 'attention' },
	no_evidence: { label: 'No figura en el ISP', why: 'No aparece en el ISP ni como pagada ni como pendiente; nunca se marca pagada sin evidencia.', tone: 'review', group: 'attention' },
}

export function resultInfo(code: string): ResultInfo {
	return RESULTS[code] ?? { label: code, why: '', tone: 'neutral', group: 'attention' }
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

export const CONTRACT_STATUS: Record<string, { label: string; tone: Tone }> = {
	ACTIVO: { label: 'Activo', tone: 'success' },
	CORTADO: { label: 'Cortado', tone: 'danger' },
	CORTESIA: { label: 'Cortesía', tone: 'info' },
	RETIRADO: { label: 'Retirado', tone: 'muted' },
	RECHAZADO: { label: 'Rechazado', tone: 'muted' },
	ANULADO: { label: 'Anulado', tone: 'muted' },
}

/** Where a customer stands, for the list filters and badges. */
export type Situation = 'late90' | 'late' | 'current' | 'settled'

export const SITUATION: Record<Situation, { label: string; tone: Tone }> = {
	late90: { label: 'Vencido +90 días', tone: 'danger' },
	late: { label: 'Vencido +30 días', tone: 'warning' },
	current: { label: 'Al corriente', tone: 'info' },
	settled: { label: 'Al día', tone: 'success' },
}

export function situationOf(debtCents: number, ageDays: number | null): Situation {
	if (debtCents === 0 || ageDays === null) return 'settled'
	if (ageDays > 90) return 'late90'
	if (ageDays > 30) return 'late'
	return 'current'
}
