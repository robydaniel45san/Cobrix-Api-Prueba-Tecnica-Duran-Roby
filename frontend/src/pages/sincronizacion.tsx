import { Download, History, RefreshCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/layout'
import { LiveRun, RunActions, RunStatusBadge, runSummary, useRuns } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { api, type RunKind } from '@/lib/api'
import { dateTime, duration } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { KIND_LABEL } from '@/lib/vocabulary'

const FILTERS: Array<{ value: 'all' | RunKind; label: string }> = [
	{ value: 'all', label: 'Todas' },
	{ value: 'import', label: 'Importación' },
	{ value: 'paid', label: 'Pagadas' },
]

export function SincronizacionPage() {
	const { version } = useRuns()
	const { data, error, loading } = useAsync(() => api.runs(200), [version])
	const [kind, setKind] = useState<'all' | RunKind>('all')
	const [hideSimulations, setHideSimulations] = useState(false)
	const runs = useMemo(
		() => (data?.runs ?? []).filter(run => (kind === 'all' || run.kind === kind) && !(hideSimulations && run.dryRun)),
		[data, kind, hideSimulations],
	)

	return (
		<>
			<PageHeader title="Sincronización" description="Las dos corridas que traen los datos del administrador de facturas a Cobrix. Cada una tiene su versión «Simular», que muestra el resultado sin escribir nada." />
			<LiveRun className="mb-6" />

			<div className="grid gap-4 md:grid-cols-2">
				<Card className="p-5">
					<div className="flex items-start gap-3">
						<div className="rounded-lg bg-primary-soft p-2 text-primary"><Download className="size-5" /></div>
						<div className="min-w-0 flex-1">
							<h2 className="font-semibold">Importar clientes y facturas</h2>
							<p className="mt-1 text-sm text-muted">Recorre todos los contratos y crea una factura abierta por cada cuota pendiente que cumpla las reglas, con su cliente. Nunca duplica.</p>
							<div className="mt-4"><RunActions kind="import" /></div>
						</div>
					</div>
				</Card>
				<Card className="p-5">
					<div className="flex items-start gap-3">
						<div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><RefreshCcw className="size-5" /></div>
						<div className="min-w-0 flex-1">
							<h2 className="font-semibold">Actualizar pagadas</h2>
							<p className="mt-1 text-sm text-muted">Revisa cada factura abierta contra el libro de cuotas y marca pagadas las que el ISP ya cobró por completo.</p>
							<div className="mt-4"><RunActions kind="paid" /></div>
						</div>
					</div>
				</Card>
			</div>

			<Card className="mt-6">
				<CardHeader
					title="Historial de corridas"
					actions={
						<>
							<div role="group" aria-label="Tipo de corrida" className="flex rounded-lg border border-line p-0.5">
								{FILTERS.map(filter => (
									<button key={filter.value} type="button" onClick={() => setKind(filter.value)} aria-pressed={kind === filter.value}
										className={cn('rounded-md px-2.5 py-1 text-xs font-medium', kind === filter.value ? 'bg-primary-soft text-primary' : 'text-muted hover:text-text')}>
										{filter.label}
									</button>
								))}
							</div>
							<label className="flex items-center gap-2 text-xs text-muted">
								<input type="checkbox" className="accent-[var(--color-primary)]" checked={hideSimulations} onChange={event => setHideSimulations(event.target.checked)} />
								Ocultar simulaciones
							</label>
						</>
					}
				/>
				{error && <div className="p-5"><ErrorNotice message={error.message} /></div>}
				{loading && !data && <div className="space-y-2 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>}
				{data && runs.length === 0 && (
					<EmptyState icon={History} title={data.runs.length ? 'Ninguna corrida con ese filtro' : 'Todavía no hay corridas'}
						description={data.runs.length ? 'Cambia el filtro para ver las demás.' : 'Empieza con «Simular» en la importación: verás qué se importaría sin crear nada.'} />
				)}
				{runs.length > 0 && (
					<Table>
						<thead>
							<tr><Th>Corrida</Th><Th>Fecha</Th><Th>Estado</Th><Th className="w-full">Resultado</Th></tr>
						</thead>
						<tbody>
							{runs.map(run => (
								<Tr key={run.id} className="hover:bg-canvas/60">
									<Td>
										<Link to={`/sincronizacion/${run.id}`} className="font-medium text-primary hover:underline">{KIND_LABEL[run.kind]} #{run.id}</Link>
										<div className="mt-1 flex gap-1.5">
											{run.dryRun && <Badge tone="info">Simulación</Badge>}
											{run.trigger === 'auto' && <Badge tone="neutral" dot={false}>Automática</Badge>}
										</div>
									</Td>
									<Td className="whitespace-nowrap text-muted">{dateTime(run.startedAt)}<div className="text-xs">{duration(run.startedAt, run.finishedAt)}</div></Td>
									<Td><RunStatusBadge run={run} /></Td>
									<Td className={cn('min-w-64', run.status === 'failed' ? 'text-rose-700' : 'text-muted')}>
										{run.status === 'failed' ? run.error : run.status === 'running' ? 'En curso…' : runSummary(run.kind, run.dryRun, run.counters)}
									</Td>
								</Tr>
							))}
						</tbody>
					</Table>
				)}
			</Card>
		</>
	)
}
