import { ArrowRight, CalendarClock, PlugZap, Server } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PageHeader, Section, StatCard } from '@/components/layout'
import { LiveRun, RunActions, RunStatusBadge, runSummary, useRuns } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState, ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { api, type Summary } from '@/lib/api'
import { date, dateTime, money, plural } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { KIND_LABEL } from '@/lib/vocabulary'

const AGING_COLORS: Record<string, string> = {
	'0-30': 'bg-sky-500', '31-60': 'bg-amber-400', '61-90': 'bg-orange-500', '90+': 'bg-rose-600',
}

/** Open debt: the total and how old it is. Helps decide whom to collect first. */
function Portfolio({ summary }: { summary: Summary }) {
	const max = Math.max(...summary.aging.map(slot => slot.amountCents), 1)
	return (
		<Card className="h-full">
			<CardBody className="flex h-full flex-col gap-6">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<p className="text-sm text-muted">Monto por cobrar</p>
						<p className="tabular text-3xl font-semibold tracking-tight text-primary">{money(summary.openAmountCents)}</p>
					</div>
					<p className="text-sm text-muted">{plural(summary.openInvoices, 'factura abierta', 'facturas abiertas')}</p>
				</div>
				{summary.openInvoices === 0 ? (
					<p className="py-4 text-center text-sm text-muted">No hay deuda abierta.</p>
				) : (
					<div>
						<p className="mb-3 text-sm font-medium">Antigüedad desde el vencimiento</p>
						<ul className="space-y-4">
							{summary.aging.map(slot => (
								<li key={slot.bucket}>
									<div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
										<span className="font-medium">{slot.label}</span>
										<span className="tabular text-muted">
											<span className="font-semibold text-text">{money(slot.amountCents)}</span> · {plural(slot.invoices, 'factura', 'facturas')}
										</span>
									</div>
									<div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-canvas">
										<div className={cn('h-full rounded-full', AGING_COLORS[slot.bucket])} style={{ width: `${slot.amountCents === 0 ? 0 : Math.max((slot.amountCents / max) * 100, 2)}%` }} />
									</div>
								</li>
							))}
						</ul>
					</div>
				)}
				{summary.overdueCustomers > 0 && (
					<p className="mt-auto rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
						<strong>{summary.overdueCustomers}</strong> {summary.overdueCustomers === 1 ? 'cliente tiene' : 'clientes tienen'} facturas con la fecha de corte vencida.{' '}
						<Link to="/clientes" className="font-medium underline-offset-2 hover:underline">Ver clientes</Link>
					</p>
				)}
			</CardBody>
		</Card>
	)
}

/** The configured provider and the two runs, one under the other so nothing gets cramped. */
function Integration({ summary }: { summary: Summary }) {
	const { provider } = summary
	return (
		<Card className="flex h-full flex-col">
			<CardBody className="space-y-3 text-sm">
				<div className="flex items-start gap-3">
					<Server className="mt-0.5 size-4 shrink-0 text-muted" />
					<div className="min-w-0">
						<p className="font-medium">{provider.name}</p>
						<p className="truncate font-mono text-xs text-muted">{provider.baseUrl || 'Sin URL configurada'}</p>
					</div>
				</div>
				<div className="flex items-start gap-3">
					<CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" />
					<div className="min-w-0">
						<p className="font-medium">Corrida automática</p>
						<p className="text-muted">
							{provider.autoEnabled && provider.autoTime
								? <>Todos los días a las {provider.autoTime} (Caracas){provider.autoLastDate && <> · última: {date(provider.autoLastDate)}</>}</>
								: 'Desactivada'}
						</p>
					</div>
				</div>
			</CardBody>
			<div className="mt-auto divide-y divide-line border-t border-line">
				<div className="px-5 py-4">
					<p className="mb-2.5 text-sm font-medium">Importar clientes y facturas</p>
					<RunActions kind="import" compact />
				</div>
				<div className="px-5 py-4">
					<p className="mb-2.5 text-sm font-medium">Actualizar pagadas</p>
					<RunActions kind="paid" compact />
				</div>
			</div>
		</Card>
	)
}

export function ResumenPage() {
	const { version } = useRuns()
	const { data, error, loading, reload } = useAsync(() => api.summary(), [version])

	if (error && !data) return <ErrorNotice message={error.message} action={<button className="text-sm font-medium underline" onClick={reload}>Reintentar</button>} />

	return (
		<>
			<PageHeader
				title="Resumen"
				description={data ? <>Cartera de {data.company.name || 'tu empresa'} importada desde el administrador de facturas · datos al {date(data.today)}</> : 'Vista general de la integración.'}
			/>
			{data && !data.provider.configured && (
				<Card className="mb-8">
					<EmptyState
						icon={PlugZap}
						title="Conecta el administrador de facturas"
						description="Para importar clientes y facturas primero configura la URL de la API y sus credenciales. Después puedes simular la importación antes de crear nada."
						action={<Link to="/configuracion" className={buttonVariants()}>Ir a Configuración <ArrowRight /></Link>}
					/>
				</Card>
			)}
			<LiveRun className="mb-8" />

			<Section title="Indicadores">
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					{loading && !data ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />) : data && (
						<>
							<StatCard label="Clientes" value={data.customers.toLocaleString('es-VE')} />
							<StatCard label="Contratos" value={data.contracts.toLocaleString('es-VE')} />
							<StatCard label="Facturas abiertas" value={data.openInvoices.toLocaleString('es-VE')} tone="warning" />
							<StatCard label="Facturas pagadas" value={data.paidInvoices.toLocaleString('es-VE')} tone="success" hint={data.paidInvoices ? `${money(data.paidAmountCents)} cobrados en el ISP` : undefined} />
						</>
					)}
				</div>
			</Section>

			{data && (
				<div className="mt-10 grid gap-x-6 gap-y-10 lg:grid-cols-3">
					<Section title="Cartera por cobrar" description="Ayuda a decidir a quién cobrar primero." className="mt-0 lg:col-span-2">
						<Portfolio summary={data} />
					</Section>
					<Section title="Integración" actions={<Link to="/configuracion" className="text-sm font-medium text-primary hover:underline">Configurar</Link>} className="mt-0">
						<Integration summary={data} />
					</Section>
				</div>
			)}

			{data && (
				<Section title="Actividad reciente" actions={<Link to="/sincronizacion" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver historial <ArrowRight className="size-3.5" /></Link>}>
					<Card>
						{data.lastRuns.length === 0 ? (
							<p className="px-5 py-8 text-center text-sm text-muted">Todavía no hay corridas. Empieza con «Simular» en la importación: no modifica nada.</p>
						) : (
							<ul className="divide-y divide-line">
								{data.lastRuns.map(run => (
									<li key={run.id}>
										<Link to={`/sincronizacion/${run.id}`} className="grid gap-1 px-5 py-3 text-sm hover:bg-canvas/60 md:grid-cols-[220px_150px_1fr_auto] md:items-center md:gap-4">
											<span className="flex items-center gap-2 font-medium">
												<span className="font-mono text-xs text-muted">#{run.id}</span>{KIND_LABEL[run.kind]}
											</span>
											<span className="flex flex-wrap gap-1.5">
												<RunStatusBadge run={run} />
												{run.dryRun && <Badge tone="info">Simulación</Badge>}
												{run.trigger === 'auto' && <Badge tone="neutral" dot={false}>Automática</Badge>}
											</span>
											<span className="min-w-0 truncate text-muted">{run.status === 'failed' ? run.error : runSummary(run.kind, run.dryRun, run.counters)}</span>
											<span className="text-xs text-muted md:text-right">{dateTime(run.startedAt)}</span>
										</Link>
									</li>
								))}
							</ul>
						)}
					</Card>
				</Section>
			)}
		</>
	)
}
