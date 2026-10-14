import { ArrowRight, CalendarClock, PlugZap, Server } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PageHeader, StatCard } from '@/components/layout'
import { LiveRun, RunActions, RunStatusBadge, runSummary, useRuns } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { api, type Summary } from '@/lib/api'
import { date, dateTime, money } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { KIND_LABEL } from '@/lib/vocabulary'

const AGING_COLORS: Record<string, string> = {
	'0-30': 'bg-sky-500', '31-60': 'bg-amber-400', '61-90': 'bg-orange-500', '90+': 'bg-rose-600',
}

function Aging({ summary }: { summary: Summary }) {
	const max = Math.max(...summary.aging.map(slot => slot.amountCents), 1)
	return (
		<Card>
			<CardHeader
				title="Antigüedad de la deuda"
				description="Saldo abierto según los días transcurridos desde el vencimiento. Ayuda a decidir a quién cobrar primero."
			/>
			<CardBody>
				{summary.openInvoices === 0 ? (
					<p className="py-6 text-center text-sm text-muted">No hay deuda abierta.</p>
				) : (
					<ul className="space-y-4">
						{summary.aging.map(slot => (
							<li key={slot.bucket}>
								<div className="flex items-baseline justify-between gap-3 text-sm">
									<span className="font-medium">{slot.label}</span>
									<span className="tabular text-muted">
										<span className="font-semibold text-text">{money(slot.amountCents)}</span> · {slot.invoices} {slot.invoices === 1 ? 'factura' : 'facturas'}
									</span>
								</div>
								<div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-canvas">
									<div className={cn('h-full rounded-full', AGING_COLORS[slot.bucket])} style={{ width: `${slot.amountCents === 0 ? 0 : Math.max((slot.amountCents / max) * 100, 2)}%` }} />
								</div>
							</li>
						))}
					</ul>
				)}
				{summary.overdueCustomers > 0 && (
					<p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
						<strong>{summary.overdueCustomers}</strong> {summary.overdueCustomers === 1 ? 'cliente tiene' : 'clientes tienen'} facturas con la fecha de corte vencida.{' '}
						<Link to="/clientes" className="font-medium underline-offset-2 hover:underline">Ver clientes</Link>
					</p>
				)}
			</CardBody>
		</Card>
	)
}

function ProviderCard({ summary }: { summary: Summary }) {
	const { provider } = summary
	return (
		<Card>
			<CardHeader title="Administrador de facturas" actions={<Link to="/configuracion" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Configurar</Link>} />
			<CardBody className="space-y-3 text-sm">
				<div className="flex items-start gap-3">
					<Server className="mt-0.5 size-4 text-muted" />
					<div className="min-w-0">
						<p className="font-medium">{provider.name}</p>
						<p className="truncate font-mono text-xs text-muted">{provider.baseUrl || 'Sin URL configurada'}</p>
					</div>
				</div>
				<div className="flex items-start gap-3">
					<CalendarClock className="mt-0.5 size-4 text-muted" />
					<div>
						<p className="font-medium">Corrida automática</p>
						<p className="text-muted">
							{provider.autoEnabled && provider.autoTime
								? <>Activa, todos los días a las {provider.autoTime} (Caracas){provider.autoLastDate && <> · última: {date(provider.autoLastDate)}</>}</>
								: 'Desactivada'}
						</p>
					</div>
				</div>
			</CardBody>
			<div className="space-y-4 border-t border-line px-5 py-4">
				<div>
					<p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Importar clientes y facturas</p>
					<RunActions kind="import" compact />
				</div>
				<div>
					<p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Actualizar pagadas</p>
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
				<Card className="mb-6">
					<EmptyState
						icon={PlugZap}
						title="Conecta el administrador de facturas"
						description="Para importar clientes y facturas primero configura la URL de la API y sus credenciales. Después puedes simular la importación antes de crear nada."
						action={<Link to="/configuracion" className={buttonVariants()}>Ir a Configuración <ArrowRight /></Link>}
					/>
				</Card>
			)}
			<LiveRun className="mb-6" />

			<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
				{loading && !data ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[86px] rounded-xl" />) : data && (
					<>
						<StatCard label="Clientes" value={data.customers.toLocaleString('es-VE')} />
						<StatCard label="Contratos" value={data.contracts.toLocaleString('es-VE')} />
						<StatCard label="Facturas abiertas" value={data.openInvoices.toLocaleString('es-VE')} tone="warning" />
						<StatCard label="Facturas pagadas" value={data.paidInvoices.toLocaleString('es-VE')} tone="success" hint={data.paidInvoices ? `${money(data.paidAmountCents)} cobrados en el ISP` : undefined} />
						<StatCard label="Monto por cobrar" value={money(data.openAmountCents)} tone="primary" className="col-span-2 md:col-span-1" />
					</>
				)}
			</div>

			{data && (
				<div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
					<Aging summary={data} />
					<ProviderCard summary={data} />
				</div>
			)}

			{data && (
				<Card className="mt-6">
					<CardHeader title="Últimas corridas" actions={<Link to="/sincronizacion" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Ver historial <ArrowRight /></Link>} />
					{data.lastRuns.length === 0 ? (
						<p className="px-5 py-8 text-center text-sm text-muted">Todavía no hay corridas. Empieza con «Simular» en la importación: no modifica nada.</p>
					) : (
						<ul className="divide-y divide-line">
							{data.lastRuns.map(run => (
								<li key={run.id}>
									<Link to={`/sincronizacion/${run.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-canvas/60">
										<span className="w-12 font-mono text-xs text-muted">#{run.id}</span>
										<span className="min-w-44 font-medium">{KIND_LABEL[run.kind]}</span>
										{run.dryRun && <Badge tone="info">Simulación</Badge>}
										{run.trigger === 'auto' && <Badge tone="neutral" dot={false}>Automática</Badge>}
										<RunStatusBadge run={run} />
										<span className="min-w-0 flex-1 truncate text-muted">{run.status === 'failed' ? run.error : runSummary(run.kind, run.dryRun, run.counters)}</span>
										<span className="text-xs text-muted">{dateTime(run.startedAt)}</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</Card>
			)}
		</>
	)
}
