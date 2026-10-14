/**
 * Expediente (ENUNCIADO §3.6), built to collect: how much and since when, how to reach the
 * customer, the invoices from oldest to newest (each one unfolds to every field the assignment
 * lists), the paid ones with the ISP receipt, the contracts and the history.
 */

import { CheckCircle2, ChevronDown, FileDown, Mail, Phone, UserPlus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PageHeader, Section } from '@/components/layout'
import { useRuns } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { api, type CustomerFile } from '@/lib/api'
import { capitalize, date, dateTime, daysBetween, money, periodLong, plural } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { CONTRACT_STATUS, SITUATION, situationOf } from '@/lib/vocabulary'

type Invoice = CustomerFile['invoices'][number]

const EVENT = {
	customer_created: { label: 'Cliente creado', icon: UserPlus, color: 'bg-slate-100 text-slate-600' },
	invoice_imported: { label: 'Llegó una factura del ISP', icon: FileDown, color: 'bg-primary-soft text-primary' },
	invoice_paid: { label: 'Pagada en el ISP', icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-700' },
} as const

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="text-xs text-muted">{label}</dt>
			<dd className="break-words text-sm">{children}</dd>
		</div>
	)
}

function OpenInvoice({ invoice, today }: { invoice: Invoice; today: string }) {
	const [open, setOpen] = useState(false)
	const age = daysBetween(invoice.dueDate, today)
	return (
		<li>
			<button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-canvas/60">
				<span className="min-w-0 flex-[1_1_220px]">
					<span className="block font-medium">{capitalize(periodLong(invoice.period))}</span>
					<span className="block text-xs text-muted">{invoice.number} · contrato {invoice.contractId}</span>
					{invoice.ispBalanceCents !== null && (
						<span className="mt-1 block text-xs text-amber-800">Abono parcial: en el ISP quedan {money(invoice.ispBalanceCents, invoice.currency)} por cobrar.</span>
					)}
				</span>
				<span className={cn('text-xs', age > 30 ? 'text-amber-800' : 'text-muted')}>{age > 0 ? `Vencida hace ${age} días` : `Vence el ${date(invoice.dueDate)}`}</span>
				<span className="tabular w-28 text-right font-medium">{money(invoice.balanceCents, invoice.currency)}</span>
				<ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
			</button>
			{open && (
				<dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line/70 bg-canvas/50 px-5 py-4 sm:grid-cols-4">
					<Field label="Factura en Cobrix"><span className="font-mono">{invoice.number}</span></Field>
					<Field label="Cuota del administrador"><span className="font-mono">{invoice.externalId}</span></Field>
					<Field label="Contrato"><span className="font-mono">{invoice.contractId}</span></Field>
					<Field label="Periodo">{invoice.label}</Field>
					<Field label="Vencimiento">{date(invoice.dueDate)}</Field>
					<Field label="Corte">{date(invoice.cutoffDate)}</Field>
					<Field label="Total">{money(invoice.totalCents, invoice.currency)}</Field>
					<Field label="Saldo">{money(invoice.balanceCents, invoice.currency)}</Field>
				</dl>
			)}
		</li>
	)
}

export function ExpedientePage() {
	const { id = '' } = useParams()
	const { version } = useRuns()
	const { data, error, loading } = useAsync(async () => {
		const [file, summary] = await Promise.all([api.customer(id), api.summary()])
		return { file, today: summary.today }
	}, [id, version])

	if (error) return <ErrorNotice title="No se pudo abrir el expediente" message={error.message} action={<Link to="/clientes" className="font-medium underline">Volver a Clientes</Link>} />
	if (loading && !data) return <div className="space-y-4"><Skeleton className="h-36" /><Skeleton className="h-72" /></div>
	if (!data) return null

	const { file, today } = data
	const { customer } = file
	const open = file.invoices.filter(invoice => invoice.status === 'open').sort((a, b) => a.period.localeCompare(b.period) || a.contractId - b.contractId)
	const paid = file.invoices.filter(invoice => invoice.status === 'paid')
	const debt = open.reduce((sum, invoice) => sum + invoice.balanceCents, 0)
	const oldest = open[0]
	const age = oldest ? daysBetween(oldest.dueDate, today) : null
	const situation = SITUATION[situationOf(debt, age)]
	const partial = open.some(invoice => invoice.ispBalanceCents !== null)

	return (
		<>
			<PageHeader back={{ to: '/clientes', label: 'Clientes' }} title={customer.name}
				meta={<><Badge tone={situation.tone}>{situation.label}</Badge>{partial && <Badge tone="warning">Abono parcial</Badge>}<span>{customer.personType === 'juridica' ? 'Persona jurídica' : 'Persona natural'} · <span className="font-mono">{customer.document}</span></span></>} />

			{/* How much, since when, and how to reach them. */}
			<div className="grid gap-4 lg:grid-cols-3">
				<div className="rounded-xl bg-indigo-950 p-5 text-white lg:col-span-1">
					<p className="text-sm text-indigo-200">Debe</p>
					<p className="tabular mt-1 text-4xl font-semibold tracking-tight">{money(debt)}</p>
					<p className="mt-1 text-sm text-indigo-200">
						{open.length ? <>{plural(open.length, 'factura abierta', 'facturas abiertas')}{oldest && age !== null && age > 0 && <> · la más antigua vencida hace {age} días</>}</> : 'No tiene facturas abiertas'}
					</p>
				</div>
				<Card className="flex flex-col justify-between gap-4 p-5 lg:col-span-2">
					<dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
						<Field label="Correo">{customer.email ?? <span className="text-muted">Sin correo</span>}</Field>
						<Field label="Teléfono">{customer.phone ?? <span className="text-muted">Sin teléfono</span>}</Field>
						<Field label="Documento"><span className="font-mono">{customer.document}</span></Field>
						<Field label="ID en Cobrix"><span className="font-mono">{customer.id}</span></Field>
						<Field label="Origen">Sistema del ISP · contrato {customer.sourceContractId}</Field>
						<Field label="Cliente desde">{dateTime(customer.createdAt)}</Field>
					</dl>
					<div className="flex flex-wrap gap-2">
						{customer.email && <a href={`mailto:${customer.email}`} className={buttonVariants({ size: 'lg' })}><Mail /> Enviar correo</a>}
						{customer.phone && <a href={`tel:${customer.phone}`} className={buttonVariants({ variant: 'secondary', size: 'lg' })}><Phone /> Llamar · {customer.phone}</a>}
					</div>
				</Card>
			</div>

			<div className="mt-10 grid gap-x-6 gap-y-10 lg:grid-cols-3">
				<div className="space-y-10 lg:col-span-2">
					<Section title="Por cobrar" description="De la más antigua a la más reciente. Toca una factura para ver su detalle." className="mt-0">
						<Card>
							{open.length === 0
								? <p className="px-5 py-8 text-center text-sm text-muted">No tiene facturas abiertas.</p>
								: <ul className="divide-y divide-line/70">{open.map(invoice => <OpenInvoice key={invoice.id} invoice={invoice} today={today} />)}</ul>}
						</Card>
					</Section>
					{paid.length > 0 && (
						<Section title="Pagadas" className="mt-0">
							<Card>
								<ul className="divide-y divide-line/70">
									{paid.map(invoice => (
										<li key={invoice.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
											<span className="min-w-0 flex-[1_1_240px]">
												<span className="block font-medium">{capitalize(periodLong(invoice.period))}</span>
												<span className="block text-xs text-muted">{invoice.number} · cuota {invoice.externalId} · pagada en el ISP el {date(invoice.paidOn)}{invoice.paidByInvoice && ` con el recibo ${invoice.paidByInvoice}`}</span>
											</span>
											<Badge tone="success">Pagada</Badge>
											<span className="tabular w-28 text-right font-medium text-emerald-700">{money(invoice.totalCents, invoice.currency)}</span>
										</li>
									))}
								</ul>
							</Card>
						</Section>
					)}
				</div>

				<div className="space-y-10">
					<Section title="Contratos en el ISP" className="mt-0">
						<Card>
							<ul className="divide-y divide-line/70">
								{file.contracts.map(contract => {
									const status = CONTRACT_STATUS[contract.status] ?? { label: contract.status, tone: 'neutral' as const }
									return (
										<li key={contract.id} className="px-5 py-3 text-sm">
											<div className="flex items-start justify-between gap-2">
												<p className="font-medium">{contract.plan}</p>
												<Badge tone={status.tone}>{status.label}</Badge>
											</div>
											<p className="tabular text-muted">{money(contract.planPriceCents, contract.currency)} al mes · sucursal {contract.branch}</p>
											<p className="text-xs text-muted">Contrato {contract.id}{contract.address && ` · ${contract.address}`}</p>
										</li>
									)
								})}
							</ul>
						</Card>
					</Section>
					<Section title="Historial" className="mt-0">
						<Card>
							<ol className="px-5 py-4">
								{file.events.map((event, index) => {
									const info = EVENT[event.kind as keyof typeof EVENT] ?? EVENT.invoice_imported
									const Icon = info.icon
									return (
										<li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
											{index < file.events.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-line" />}
											<span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${info.color}`}><Icon className="size-4" /></span>
											<div className="min-w-0 pt-1 text-sm">
												<p className="font-medium">{info.label}{event.invoiceNumber && <span className="ml-1.5 font-mono text-xs font-normal text-muted">{event.invoiceNumber}</span>}</p>
												<p className="text-muted">{event.detail}</p>
												<p className="mt-0.5 text-xs text-muted">{dateTime(event.at)} · <Link to={`/sincronizacion/${event.runId}`} className="hover:text-primary hover:underline">sincronización #{event.runId}</Link></p>
											</div>
										</li>
									)
								})}
							</ol>
						</Card>
					</Section>
				</div>
			</div>
		</>
	)
}
