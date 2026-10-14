/**
 * A contract of the invoice manager as Cobrix understands it, and its pending installments.
 * How these are read from the ISP's JSON lives in the invoice-manager adapter.
 */

import type { Cents } from './money.ts'

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
