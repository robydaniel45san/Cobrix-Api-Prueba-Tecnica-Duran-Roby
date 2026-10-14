/**
 * Persistence port: the repositories the use cases need, and a unit of work to write a whole
 * run atomically. Implemented over PostgreSQL in infrastructure/persistence.
 */

import type { ContractSnapshot } from '../../domain/contract.ts'
import type { DocumentType, PersonType } from '../../domain/identification.ts'
import type { Cents } from '../../domain/money.ts'

export type RunKind = 'import' | 'paid'
export type RunTrigger = 'manual' | 'auto'
export type Counters = Record<string, number>

export interface RunItem {
	readonly contractId: number | null
	readonly externalId: string | null
	readonly customerId: string | null
	readonly customerName: string | null
	readonly result: string
	readonly detail: string
	readonly label: string | null
	readonly amountCents: number | null
}

/** Thrown by `RunRepository.start` when another run holds the lock. */
export class RunInProgressError extends Error {
	constructor() {
		super('Ya hay una corrida en curso. Espera a que termine y vuelve a intentarlo.')
		this.name = 'RunInProgressError'
	}
}

export interface RunRepository {
	/** Registers a run «in progress». Rejects with RunInProgressError if one is already running. */
	start(kind: RunKind, dryRun: boolean, trigger: RunTrigger): Promise<number>
	addItems(runId: number, items: readonly RunItem[]): Promise<void>
	complete(runId: number, counters: Counters, warnings: number): Promise<void>
	fail(runId: number, counters: Counters, message: string): Promise<void>
}

export interface NewCustomer {
	readonly id: string
	readonly document: string
	readonly documentType: DocumentType | null
	readonly personType: PersonType
	readonly name: string
	readonly email: string | null
	readonly phone: string | null
	readonly sourceContractId: number
}

export interface CustomerRepository {
	existingIds(): Promise<Set<string>>
	/** false if it already existed. */
	create(customer: NewCustomer, runId: number): Promise<boolean>
}

export interface ContractRepository {
	upsert(contract: ContractSnapshot, customerId: string): Promise<void>
}

export interface ExistingInvoice {
	readonly externalId: string
	readonly number: string
	readonly status: 'open' | 'paid'
	readonly contractId: number
}

export interface NewInvoice {
	readonly number: string
	readonly externalId: string
	readonly customerId: string
	readonly contractId: number
	readonly label: string
	readonly period: string
	readonly dueDate: string
	readonly cutoffDate: string
	readonly amountCents: Cents
	readonly currency: string
}

export interface OpenInvoice {
	readonly id: number
	readonly number: string
	readonly externalId: string
	readonly contractId: number
	readonly customerId: string
	readonly customerName: string
	readonly label: string
	readonly balanceCents: Cents
}

export interface InvoiceRepository {
	existing(): Promise<ExistingInvoice[]>
	/** Last consecutive number used (`FAC-000042` → 42). */
	lastNumber(): Promise<number>
	/** The new id, or undefined if the installment was already imported. */
	create(invoice: NewInvoice, runId: number): Promise<number | undefined>
	open(): Promise<OpenInvoice[]>
	/** false if it was no longer open. */
	markPaid(invoiceId: number, paidOn: string, paidBy: string, runId: number): Promise<boolean>
	/** The balance the ISP reports on a partial payment (null clears it). Cobrix's balance does not change. */
	setIspBalance(invoiceId: number, ispBalanceCents: Cents | null): Promise<void>
}

export type EventKind = 'customer_created' | 'invoice_imported' | 'invoice_paid'

export interface EventRepository {
	add(event: { customerId: string; invoiceId: number | null; kind: EventKind; runId: number; detail: string }): Promise<void>
}

export interface Repositories {
	readonly runs: RunRepository
	readonly customers: CustomerRepository
	readonly contracts: ContractRepository
	readonly invoices: InvoiceRepository
	readonly events: EventRepository
	readonly settings: SettingsRepository
}

export interface Store extends Repositories {
	/** Runs `work` in one transaction: everything is written or nothing is. */
	transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>
}

// ---------------------------------------------------------------- settings

export interface CompanyRecord {
	readonly name: string
	readonly rif: string
	readonly collectionsEmail: string
}

export interface ProviderRecord {
	readonly name: string
	readonly baseUrl: string
	readonly username: string
	/** Encrypted; empty when none was saved. */
	readonly passwordSealed: string
	readonly importableStatuses: readonly string[]
	readonly windowMonths: number | null
	readonly maxRecentPerContract: number | null
	readonly excludedDocumentTypes: readonly DocumentType[]
	readonly graceDays: number
	readonly ledgerMonths: number
	readonly maxNewInvoices: number | null
	readonly maxNewAmountCents: Cents | null
	readonly autoEnabled: boolean
	readonly autoTime: string | null
	readonly autoLastDate: string | null
	readonly updatedAt: string
}

export type ProviderUpdate = Omit<ProviderRecord, 'passwordSealed' | 'autoLastDate' | 'updatedAt'> & {
	/** undefined keeps the saved password. */
	readonly passwordSealed?: string
}

export interface SettingsRepository {
	getCompany(): Promise<CompanyRecord>
	saveCompany(company: CompanyRecord): Promise<void>
	getProvider(): Promise<ProviderRecord>
	saveProvider(provider: ProviderUpdate): Promise<void>
	/** Claims today's automatic run; false if this or another process already claimed it. */
	claimAutoRun(day: string): Promise<boolean>
	releaseAutoRun(day: string): Promise<void>
}

/** Encrypts the API password at rest. */
export interface SecretCipher {
	seal(plain: string): string
	/** undefined when it cannot be decrypted (e.g. the key changed). */
	open(sealed: string): string | undefined
}
