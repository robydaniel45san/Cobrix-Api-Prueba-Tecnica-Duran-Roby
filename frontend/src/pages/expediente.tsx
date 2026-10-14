import { CheckCircle2, FileDown, UserPlus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PageHeader, StatCard } from '@/components/layout'
import { useRuns } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { api, type CustomerFile } from '@/lib/api'
import { date, dateTime, money, period } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import { CONTRACT_STATUS_TONE } from '@/lib/vocabulary'

const EVENT = {
	customer_created: { label: 'Cliente creado', icon: UserPlus, color: 'bg-primary-soft text-primary' },
	invoice_imported: { label: 'Factura importada', icon: FileDown, color: 'bg-slate-100 text-slate-600' },
	invoice_paid: { label: 'Pagada en el ISP', icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-700' },
} as const

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 text-sm">
			<dt className="text-muted">{label}</dt>
			<dd className="min-w-0 break-words">{children}</dd>
		</div>
	)
}

function Invoices({ file }: { file: CustomerFile }) {
	return (
		<Card className="mt-6">
			<CardHeader title="Facturas" description="Una factura por cuota del administrador. El vencimiento es el primer día del periodo; el corte suma los días de gracia." />
			<ul className="divide-y divide-line lg:hidden">
				{file.invoices.map(invoice => (
					<li key={invoice.id} className="px-4 py-3 text-sm">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="font-mono text-xs font-medium">{invoice.number}</p>
								<p className="font-medium">{period(invoice.period)}</p>
								<p className="text-xs text-muted">Cuota {invoice.externalId} · contrato {invoice.contractId}</p>
							</div>
							<div className="shrink-0 text-right">
								<p className="tabular font-semibold">{money(invoice.balanceCents, invoice.currency)}</p>
								<p className="tabular text-xs text-muted">de {money(invoice.totalCents, invoice.currency)}</p>
							</div>
						</div>
						<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
							{invoice.status === 'paid' ? <Badge tone="success">Pagada el {date(invoice.paidOn)}</Badge> : <Badge tone="warning">Abierta</Badge>}
							<span>Vence {date(invoice.dueDate)} · corte {date(invoice.cutoffDate)}</span>
						</div>
						{invoice.status === 'open' && invoice.ispBalanceCents !== null && (
							<p className="mt-1 text-xs text-amber-800">Abono parcial: el ISP informa saldo {money(invoice.ispBalanceCents, invoice.currency)}</p>
						)}
					</li>
				))}
			</ul>
			<Table wrapperClassName="hidden lg:block">
				<thead>
					<tr>
						<Th>Factura</Th><Th>Cuota · contrato</Th><Th>Periodo</Th><Th>Vence</Th><Th>Corte</Th>
						<Th className="text-right">Total</Th><Th className="text-right">Saldo</Th><Th>Estado</Th>
					</tr>
				</thead>
				<tbody>
					{file.invoices.map(invoice => (
						<Tr key={invoice.id}>
							<Td className="whitespace-nowrap font-mono text-xs font-medium">{invoice.number}</Td>
							<Td className="whitespace-nowrap font-mono text-xs">{invoice.externalId}<div className="text-muted">contrato {invoice.contractId}</div></Td>
							<Td className="min-w-40">{period(invoice.period)}<div className="text-xs text-muted">{invoice.label}</div></Td>
							<Td className="whitespace-nowrap">{date(invoice.dueDate)}</Td>
							<Td className="whitespace-nowrap">{date(invoice.cutoffDate)}</Td>
							<Td className="tabular whitespace-nowrap text-right">{money(invoice.totalCents, invoice.currency)}</Td>
							<Td className="tabular whitespace-nowrap text-right font-medium">{money(invoice.balanceCents, invoice.currency)}</Td>
							<Td className="whitespace-nowrap">
								{invoice.status === 'paid' ? (
									<>
										<Badge tone="success">Pagada</Badge>
										<div className="mt-1 text-xs text-muted">{date(invoice.paidOn)}</div>
									</>
								) : (
									<>
										<Badge tone="warning">Abierta</Badge>
										{invoice.ispBalanceCents !== null && (
											<div className="mt-1 max-w-48 whitespace-normal text-xs text-amber-800">Abono parcial: el ISP informa saldo {money(invoice.ispBalanceCents, invoice.currency)}</div>
										)}
									</>
								)}
							</Td>
						</Tr>
					))}
				</tbody>
			</Table>
		</Card>
	)
}

export function ExpedientePage() {
	const { id = '' } = useParams()
	const { version } = useRuns()
	const { data: file, error, loading } = useAsync(() => api.customer(id), [id, version])

	if (error) return <ErrorNotice title="No se pudo abrir el expediente" message={error.message} action={<Link to="/clientes" className="font-medium underline">Volver a Clientes</Link>} />
	if (loading && !file) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-24" /><Skeleton className="h-72" /></div>
	if (!file) return null

	const { customer } = file
	const open = file.invoices.filter(invoice => invoice.status === 'open')
	const debt = open.reduce((sum, invoice) => sum + invoice.balanceCents, 0)

	return (
		<>
			<PageHeader
				back={{ to: '/clientes', label: 'Clientes' }}
				title={customer.name}
				meta={<><span>{customer.personType === 'juridica' ? 'Persona jurídica' : 'Persona natural'}</span><span className="font-mono">· {customer.document}</span></>}
			/>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Deuda abierta" value={money(debt)} tone="primary" />
				<StatCard label="Facturas abiertas" value={open.length} tone={open.length ? 'warning' : undefined} />
				<StatCard label="Facturas pagadas" value={file.invoices.length - open.length} tone="success" />
				<StatCard label="Contratos" value={file.contracts.length} />
			</div>

			<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
				<Card>
					<CardHeader title="Datos del cliente" />
					<CardBody>
						<dl>
							<Row label="ID en Cobrix"><span className="font-mono">{customer.id}</span></Row>
							<Row label="Documento"><span className="font-mono">{customer.document}</span></Row>
							<Row label="Correo">{customer.email ? <a href={`mailto:${customer.email}`} className="text-primary hover:underline">{customer.email}</a> : <span className="text-muted">Sin correo</span>}</Row>
							<Row label="Teléfono">{customer.phone ?? <span className="text-muted">Sin teléfono</span>}</Row>
							<Row label="Origen">Administrador de facturas · contrato {customer.sourceContractId}</Row>
							<Row label="Creado">{dateTime(customer.createdAt)}</Row>
						</dl>
					</CardBody>
				</Card>
				<Card>
					<CardHeader title="Contratos en el administrador" />
					<ul className="divide-y divide-line">
						{file.contracts.map(contract => (
							<li key={contract.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5 text-sm">
								<div className="min-w-0">
									<p className="font-mono font-medium">{contract.id}</p>
									{contract.address && <p className="mt-0.5 text-muted">{contract.address}</p>}
									<p className="mt-0.5 text-muted">Sucursal {contract.branch}</p>
								</div>
								<div className="text-right">
									<Badge tone={CONTRACT_STATUS_TONE[contract.status] ?? 'neutral'}>{contract.status}</Badge>
									<p className="mt-1 font-medium">{contract.plan}</p>
									<p className="tabular text-muted">{money(contract.planPriceCents, contract.currency)} al mes</p>
								</div>
							</li>
						))}
					</ul>
				</Card>
			</div>

			<Invoices file={file} />

			<Card className="mt-6">
				<CardHeader title="Historial" />
				<ol className="px-5 py-4">
					{file.events.map((event, index) => {
						const info = EVENT[event.kind as keyof typeof EVENT] ?? EVENT.invoice_imported
						const Icon = info.icon
						return (
							<li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
								{index < file.events.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-line" />}
								<span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${info.color}`}><Icon className="size-4" /></span>
								<div className="min-w-0 pt-1 text-sm">
									<p>
										<span className="font-medium">{info.label}</span>
										{event.invoiceNumber && <span className="ml-1.5 font-mono text-xs text-muted">{event.invoiceNumber}</span>}
									</p>
									<p className="text-muted">{event.detail}</p>
									<p className="mt-0.5 text-xs text-muted">
										{dateTime(event.at)} · <Link to={`/sincronizacion/${event.runId}`} className="hover:text-primary hover:underline">corrida #{event.runId}</Link>
									</p>
								</div>
							</li>
						)
					})}
				</ol>
			</Card>
		</>
	)
}
