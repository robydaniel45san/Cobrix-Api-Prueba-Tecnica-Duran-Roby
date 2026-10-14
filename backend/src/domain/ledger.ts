/** The installment ledger as Cobrix understands it. Read from the ISP by the invoice-manager adapter. */

import type { Cents } from './money.ts'

export interface LedgerRow {
	/** Collection invoice in the invoice manager; 0 = none. */
	readonly invoiceId: number
	readonly invoiceNumber: string
	readonly issuedOn: string
	readonly installmentId: string
	readonly period: string
	readonly feeCents: Cents
	readonly paidCents: Cents
	readonly discountCents: Cents
	readonly balanceCents: Cents
}

export type LedgerReading =
	| {
		readonly kind: 'ok'
		readonly byInstallment: ReadonlyMap<string, readonly LedgerRow[]>
		/** Installments with at least one unreadable row, and why. */
		readonly invalid: ReadonlyMap<string, string>
	}
	| { readonly kind: 'contradictory'; readonly reason: string }
