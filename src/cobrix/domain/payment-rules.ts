/**
 * Payment rules (ENUNCIADO §4): is an open Cobrix invoice already collected by the ISP?
 *
 * Paid only with full evidence: every ledger row of the installment agrees, the balance is 0
 * and something was paid. Everything else keeps the invoice open, each case with its reason.
 */

import type { Cents } from './money.ts'
import type { LedgerRow } from './ledger.ts'

export interface OpenInvoice {
	readonly externalId: string
	readonly balanceCents: Cents
}

export type PaymentVerdict =
	| { readonly kind: 'paid'; readonly paidOn: string; readonly paidBy: { readonly invoiceId: number; readonly invoiceNumber: string } }
	/** The ISP balance is lower than Cobrix's but not 0: informed, the invoice stays open. */
	| { readonly kind: 'partial'; readonly ispBalanceCents: Cents; readonly paidBy?: { readonly invoiceId: number; readonly invoiceNumber: string } }
	/** Same balance as Cobrix: nothing was paid. */
	| { readonly kind: 'still_open'; readonly ispBalanceCents: Cents }
	/** The ISP balance went up (e.g. a collection was annulled). Stays open, informed. */
	| { readonly kind: 'balance_increased'; readonly ispBalanceCents: Cents }
	/** Balance 0 with nothing paid: forgiven, not a payment. */
	| { readonly kind: 'exonerated' }
	/** Not in the ledger nor pending in the contract: never marked paid. */
	| { readonly kind: 'no_evidence' }
	| { readonly kind: 'contradictory'; readonly reason: string }

/**
 * @param rows ledger rows of this installment (may be empty).
 * @param pendingInContract balance the contract endpoint still reports for the installment;
 *   only used when the ledger does not show it (the current month may be missing until month end).
 *   `undefined` = not pending there, or the contract was not consulted. Absence is never a payment.
 */
export function classifyPayment(invoice: OpenInvoice, rows: readonly LedgerRow[], pendingInContract?: Cents): PaymentVerdict {
	if (rows.length === 0) {
		if (pendingInContract === undefined) return { kind: 'no_evidence' }
		return compareBalance(invoice, pendingInContract)
	}

	const first = rows[0] as LedgerRow
	const agree = rows.every(row =>
		row.balanceCents === first.balanceCents && row.paidCents === first.paidCents
		&& row.feeCents === first.feeCents && row.discountCents === first.discountCents)
	if (!agree) return { kind: 'contradictory', reason: 'las filas de la cuota en el libro no coinciden entre sí' }

	// The collection invoice that touched it last is the one that paid it.
	const collections = rows.filter(row => row.invoiceId !== 0)
		.sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.invoiceId - b.invoiceId)
	const last = collections.at(-1)
	const paidBy = last ? { invoiceId: last.invoiceId, invoiceNumber: last.invoiceNumber } : undefined

	if (first.balanceCents === 0) {
		if (first.paidCents === 0) return { kind: 'exonerated' }
		if (!last || !paidBy) return { kind: 'contradictory', reason: 'saldo 0 y pagado, pero ninguna factura de cobro la tocó' }
		return { kind: 'paid', paidOn: last.issuedOn, paidBy }
	}
	return compareBalance(invoice, first.balanceCents, paidBy)
}

function compareBalance(invoice: OpenInvoice, ispBalanceCents: Cents, paidBy?: { readonly invoiceId: number; readonly invoiceNumber: string }): PaymentVerdict {
	if (ispBalanceCents === 0) return { kind: 'no_evidence' }
	if (ispBalanceCents < invoice.balanceCents) return { kind: 'partial', ispBalanceCents, ...(paidBy ? { paidBy } : {}) }
	if (ispBalanceCents > invoice.balanceCents) return { kind: 'balance_increased', ispBalanceCents }
	return { kind: 'still_open', ispBalanceCents }
}
