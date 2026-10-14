/**
 * Import rules (ENUNCIADO §4): which pending installments of a contract become Cobrix invoices.
 *
 * This is pure classification. What depends on Cobrix's own state (already imported, limits per
 * run) is decided afterwards by the sync, over the installments marked `eligible` here.
 */

import { readContract, KNOWN_STATUSES, type ContractSnapshot, type PendingInstallment } from './contract.ts'
import { normalizeIdentification, type DocumentType, type Identification } from './identification.ts'
import { windowStart } from './period.ts'

export interface ImportRules {
	/** Contract statuses that are imported. Default ACTIVO and CORTADO. */
	readonly importableStatuses: readonly string[]
	/** Only installments from the current month minus N months; `null` = no window. */
	readonly windowMonths: number | null
	/** Keep only the N most recent installments per contract; `null` = all. */
	readonly maxRecentPerContract: number | null
	readonly excludedDocumentTypes: readonly DocumentType[]
}

/** A contract reported in USD whose installments are below 1 % of its plan price is incoherent. */
export const INCOHERENT_CURRENCY_RATIO = 0.01
export const IMPORT_CURRENCY = 'USD'

/** Why a contract as a whole is left out. */
export type ContractExclusion =
	| 'contradictory'
	| 'status_unrecognized'
	| 'status_not_importable'
	| 'invalid_identification'
	| 'document_type_excluded'
	| 'currency_not_supported'
	| 'currency_incoherent'

/** What happens to one pending installment before looking at Cobrix's state. */
export type InstallmentVerdict =
	| { readonly kind: 'eligible' }
	| { readonly kind: 'excluded'; readonly reason: ContractExclusion | 'zero_amount' | 'outside_window' | 'outside_recent'; readonly detail: string }

export interface ClassifiedInstallment {
	readonly installment: PendingInstallment | { readonly externalId: string }
	readonly verdict: InstallmentVerdict
}

export interface ContractClassification {
	readonly contractId: number
	readonly contract?: ContractSnapshot
	readonly identification?: Identification
	/** `null` when the contract itself passes; its installments may still be excluded one by one. */
	readonly exclusion: { readonly reason: ContractExclusion; readonly detail: string } | null
	readonly hasDebt: boolean
	readonly installments: readonly ClassifiedInstallment[]
}

const STATUS_LABEL: Record<string, string> = {
	CORTESIA: 'contrato de cortesía', RETIRADO: 'contrato retirado', RECHAZADO: 'contrato rechazado',
	ANULADO: 'contrato anulado', ACTIVO: 'contrato activo', CORTADO: 'contrato cortado',
}

export function classifyContract(contractId: number, body: unknown, rules: ImportRules, currentPeriod: string): ContractClassification {
	const reading = readContract(contractId, body)
	if (reading.kind === 'contradictory') {
		const verdict: InstallmentVerdict = { kind: 'excluded', reason: 'contradictory', detail: reading.reason }
		return {
			contractId,
			...(reading.contract ? { contract: reading.contract } : {}),
			exclusion: { reason: 'contradictory', detail: reading.reason },
			hasDebt: reading.externalIds.length > 0,
			installments: reading.externalIds.map(externalId => ({ installment: { externalId }, verdict })),
		}
	}

	const { contract, installments } = reading
	const identification = normalizeIdentification(contract.rawIdentification)
	const base = { contractId, contract, ...(identification ? { identification } : {}), hasDebt: installments.length > 0 }
	const excludeAll = (reason: ContractExclusion, detail: string): ContractClassification => ({
		...base,
		exclusion: { reason, detail },
		installments: installments.map(installment => ({ installment, verdict: { kind: 'excluded', reason, detail } })),
	})

	// The order matters only for which reason is reported first; every check excludes the whole contract.
	if (!(KNOWN_STATUSES as readonly string[]).includes(contract.status)) {
		return excludeAll('status_unrecognized', `estado «${contract.status}» desconocido: no se adivina si se cobra`)
	}
	if (!rules.importableStatuses.includes(contract.status)) {
		return excludeAll('status_not_importable', `${STATUS_LABEL[contract.status] ?? contract.status}: estado no importable`)
	}
	if (!identification) {
		return excludeAll('invalid_identification', `identificación «${contract.rawIdentification}» no válida`)
	}
	if (identification.documentType && rules.excludedDocumentTypes.includes(identification.documentType)) {
		return excludeAll('document_type_excluded', `documento tipo ${identification.documentType} excluido en la configuración`)
	}
	if (contract.currency !== IMPORT_CURRENCY) {
		return excludeAll('currency_not_supported', `moneda ${contract.currency}: solo se importa ${IMPORT_CURRENCY}`)
	}
	const positive = installments.filter(item => item.amountCents > 0)
	if (positive.length > 0 && positive.every(item => item.amountCents < contract.planPriceCents * INCOHERENT_CURRENCY_RATIO)) {
		return excludeAll('currency_incoherent', `cuotas por debajo del 1 % del precio del plan (${contract.planPriceCents / 100} USD): moneda incoherente`)
	}

	const from = rules.windowMonths === null ? null : windowStart(currentPeriod, rules.windowMonths)
	const verdicts = new Map<string, InstallmentVerdict>()
	const candidates: PendingInstallment[] = []
	for (const item of installments) {
		if (item.amountCents === 0) {
			verdicts.set(item.externalId, { kind: 'excluded', reason: 'zero_amount', detail: 'saldo residual de menos de un centavo' })
		} else if (from !== null && item.period < from) {
			verdicts.set(item.externalId, { kind: 'excluded', reason: 'outside_window', detail: `periodo ${item.period} anterior a la ventana (desde ${from})` })
		} else {
			candidates.push(item)
		}
	}
	// `installments` is sorted oldest first: the most recent are at the end.
	const keep = rules.maxRecentPerContract === null ? candidates.length : rules.maxRecentPerContract
	candidates.forEach((item, index) => {
		verdicts.set(item.externalId, index >= candidates.length - keep
			? { kind: 'eligible' }
			: { kind: 'excluded', reason: 'outside_recent', detail: `se conservan las ${keep} cuotas más recientes` })
	})

	return {
		...base,
		exclusion: null,
		installments: installments.map(installment => ({ installment, verdict: verdicts.get(installment.externalId) as InstallmentVerdict })),
	}
}
