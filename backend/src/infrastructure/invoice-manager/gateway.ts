/**
 * Adapter: implements the application's InvoiceManagerGateway over the ISP's HTTP API.
 *
 *   GET /isp/lista_ids_contratos   called WITHOUT `estado` (any value returns only active contracts)
 *   GET /isp/contrato/individual   → contract-mapper
 *   GET /isp/pago_informacion      → ledger-mapper (tipo_busqueda=CUOTA, dates always sent)
 */

import {
	InvoiceManagerError, type InvoiceManagerCredentials, type InvoiceManagerFactory, type InvoiceManagerGateway,
} from '../../application/ports/invoice-manager.ts'
import type { ContractReading } from '../../domain/contract.ts'
import type { LedgerReading } from '../../domain/ledger.ts'
import { readContract } from './contract-mapper.ts'
import { InvoiceManagerHttpClient, type HttpClientOptions } from './http-client.ts'
import { readLedger } from './ledger-mapper.ts'

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)

export class HttpInvoiceManagerGateway implements InvoiceManagerGateway {
	private readonly client: InvoiceManagerHttpClient

	constructor(credentials: InvoiceManagerCredentials, options: HttpClientOptions = {}) {
		this.client = new InvoiceManagerHttpClient(credentials, options)
	}

	login(): Promise<void> {
		return this.client.login()
	}

	/** Every contract id. Fails if the list does not match its own pagination. */
	async listContractIds(): Promise<number[]> {
		const body = await this.client.get('/isp/lista_ids_contratos')
		if (!isRow(body) || !Array.isArray(body.data) || !body.data.every(id => typeof id === 'number' && Number.isInteger(id))) {
			throw new InvoiceManagerError('invalid_response', 'La lista de contratos no tiene la forma esperada.')
		}
		const ids = body.data as number[]
		const total = isRow(body.pagination) ? body.pagination.total : undefined
		if (typeof total === 'number' && total !== ids.length) {
			throw new InvoiceManagerError('invalid_response', `La API dice que hay ${total} contratos pero envió ${ids.length}. No se sigue con una lista incompleta.`)
		}
		return [...new Set(ids)].sort((a, b) => a - b)
	}

	async getContract(contractId: number): Promise<ContractReading> {
		return readContract(contractId, await this.client.get(`/isp/contrato/individual?id_contrato=${contractId}`))
	}

	async getLedger(contractId: number, from: string, to: string): Promise<LedgerReading> {
		const query = new URLSearchParams({ id_contrato: String(contractId), tipo_busqueda: 'CUOTA', fecha_inicio: from, fecha_fin: to })
		return readLedger(contractId, await this.client.get(`/isp/pago_informacion?${query}`))
	}
}

export function httpInvoiceManager(options: HttpClientOptions = {}): InvoiceManagerFactory {
	return credentials => new HttpInvoiceManagerGateway(credentials, options)
}
