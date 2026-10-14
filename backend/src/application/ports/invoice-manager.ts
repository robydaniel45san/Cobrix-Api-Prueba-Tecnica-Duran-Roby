/**
 * Port to the ISP's invoice manager. The application asks for contracts and the ledger already
 * read into domain terms; the adapter (infrastructure/invoice-manager) owns the HTTP transport
 * and the translation of the ISP's JSON.
 */

import type { ContractReading } from '../../domain/contract.ts'
import type { LedgerReading } from '../../domain/ledger.ts'

export interface InvoiceManagerCredentials {
	readonly baseUrl: string
	readonly username: string
	readonly password: string
}

export interface InvoiceManagerGateway {
	login(): Promise<void>
	/** Every contract id, whatever its status. */
	listContractIds(): Promise<number[]>
	getContract(contractId: number): Promise<ContractReading>
	/** Installment ledger between two civil dates (inclusive). */
	getLedger(contractId: number, from: string, to: string): Promise<LedgerReading>
}

export type InvoiceManagerFactory = (credentials: InvoiceManagerCredentials) => InvoiceManagerGateway

export type InvoiceManagerErrorKind = 'config' | 'network' | 'timeout' | 'auth' | 'http' | 'invalid_response'

/** A failure talking to the invoice manager, with a message meant for the collections operator. */
export class InvoiceManagerError extends Error {
	readonly kind: InvoiceManagerErrorKind
	readonly status: number | undefined
	constructor(kind: InvoiceManagerErrorKind, message: string, status?: number) {
		super(message)
		this.name = 'InvoiceManagerError'
		this.kind = kind
		this.status = status
	}
}
