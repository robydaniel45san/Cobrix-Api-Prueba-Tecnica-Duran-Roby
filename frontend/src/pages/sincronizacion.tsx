/**
 * Sincronización: how ISP data reaches Cobrix. Three entry points (everything, only new invoices,
 * only collections), each starting with a preview, and the history of every sync in plain words.
 */

import { Download, History, RefreshCcw, RefreshCw, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader, Section } from '@/components/layout'
import { LiveRun, RunStatusBadge, runSummary, useRuns } from '@/components/runs'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { api, type Run } from '@/lib/api'
import { dateTime, duration } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { KIND_ACTION, KIND_DESCRIPTION, KIND_LABEL } from '@/lib/vocabulary'

const ENTRIES: Array<{ que: string; icon: LucideIcon; title: string; description: string; primary?: boolean }> = [
	{ que: 'todo', icon: RefreshCw, title: 'Sincronizar todo', description: 'Lo de cada día: trae las facturas nuevas y revisa los cobros del ISP, en una sola revisión.', primary: true },
	{ que: 'facturas', icon: Download, title: KIND_ACTION.import, description: KIND_DESCRIPTION.import },
	{ que: 'cobros', icon: RefreshCcw, title: KIND_ACTION.paid, description: KIND_DESCRIPTION.paid },
]

const FILTERS: Array<{ id: string; label: string; test: (run: Run) => boolean }> = [
	{ id: 'all', label: 'Todas', test: () => true },
	{ id: 'applied', label: 'Aplicadas', test: run => !run.dryRun && run.status !== 'failed' },
	{ id: 'preview', label: 'Vistas previas', test: run => run.dryRun && run.status !== 'failed' },
	{ id: 'failed', label: 'Fallidas', test: run => run.status === 'failed' },
]

export function SincronizacionPage() {
	const { version, progress } = useRuns()
	const { data, error, loading } = useAsync(() => api.runs(200), [version])
	const [filter, setFilter] = useState('all')
	const runs = useMemo(() => (data?.runs ?? []).filter((FILTERS.find(f => f.id === filter) ?? FILTERS[0] as (typeof FILTERS)[number]).test), [data, filter])

	return (
		<>
			<PageHeader title="Sincronización" description="Cómo llegan a Cobrix los datos del sistema de facturación del ISP. Cada sincronización empieza con una vista previa: nada cambia hasta que la apliques." />
			<LiveRun className="mb-8" />

			<Section title="Sincronizar">
				<div className="grid gap-4 lg:grid-cols-3">
					{ENTRIES.map(entry => (
						<Card key={entry.que} className={cn('flex h-full flex-col p-5', entry.primary && 'border-primary/30 bg-primary-soft/30')}>
							<div className="flex flex-1 items-start gap-3">
								<span className={cn('shrink-0 rounded-lg p-2', entry.primary ? 'bg-primary text-white' : 'bg-primary-soft text-primary')}><entry.icon className="size-5" /></span>
								<div className="min-w-0">
									<h3 className="font-semibold">{entry.title}</h3>
									<p className="mt-1 text-sm text-muted">{entry.description}</p>
								</div>
							</div>
							<Link
								to={`/sincronizacion/revisar?que=${entry.que}`}
								aria-disabled={progress !== null}
								className={cn(buttonVariants({ variant: entry.primary ? 'primary' : 'secondary', size: 'lg' }), 'mt-5', progress && 'pointer-events-none opacity-50')}
							>
								Ver vista previa
							</Link>
						</Card>
					))}
				</div>
			</Section>

			<Section
				title="Historial"
				description="Cada sincronización en una línea; las vistas previas también quedan registradas."
				actions={
					<div role="group" aria-label="Filtrar el historial" className="flex flex-wrap gap-1.5">
						{FILTERS.map(f => (
							<button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
								className={cn('min-h-8 rounded-full border px-3 text-xs font-medium', filter === f.id ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-muted hover:text-text')}>
								{f.label}
							</button>
						))}
					</div>
				}
			>
				<Card>
					{error && <div className="p-5"><ErrorNotice message={error.message} /></div>}
					{loading && !data && <div className="space-y-2 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>}
					{data && runs.length === 0 && (
						<EmptyState icon={History} title={data.runs.length ? 'Nada con ese filtro' : 'Todavía no hay sincronizaciones'}
							description={data.runs.length ? 'Prueba con otro filtro.' : 'Empieza con «Ver vista previa»: muestra lo que llegaría sin cambiar nada.'} />
					)}
					<ul className="divide-y divide-line/70">
						{runs.map(run => (
							<li key={run.id}>
								<Link to={`/sincronizacion/${run.id}`} className="grid gap-1 px-5 py-3 text-sm hover:bg-canvas/60 md:grid-cols-[150px_170px_1fr_auto] md:items-center md:gap-4">
									<span className="font-medium">{KIND_LABEL[run.kind]} <span className="font-mono text-xs font-normal text-muted">#{run.id}</span></span>
									<span className="flex flex-wrap gap-1.5"><RunStatusBadge run={run} />{run.trigger === 'auto' && <span className="text-xs text-muted">automática</span>}</span>
									<span className={cn('min-w-0', run.status === 'failed' ? 'text-rose-700' : 'text-muted')}>{runSummary(run)}</span>
									<span className="text-xs text-muted md:text-right">{dateTime(run.startedAt)}<span className="block">{duration(run.startedAt, run.finishedAt)}</span></span>
								</Link>
							</li>
						))}
					</ul>
				</Card>
			</Section>
		</>
	)
}
