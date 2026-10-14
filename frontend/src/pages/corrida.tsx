/**
 * One sync in detail (ENUNCIADO §3.4): first the story in plain words (the same groups as the
 * preview), then one row per installment with its result and reason, then the technical
 * counters with Cobrix's internal names, folded.
 */

import { ChevronDown, Search, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ChangeSections, ChangeTiles, NoChanges } from '@/components/changes'
import { PageHeader, Section } from '@/components/layout'
import { RunStatusBadge, runSummary, useRuns } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { Input } from '@/components/ui/form'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { api, type Run } from '@/lib/api'
import { changesOf } from '@/lib/changes'
import { dateTime, duration, money } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { IMPORT_COUNTERS, KIND_LABEL, PAID_COUNTERS, resultInfo } from '@/lib/vocabulary'

function TechnicalDetail({ run }: { run: Run }) {
	const [open, setOpen] = useState(false)
	const all = run.kind === 'import' ? IMPORT_COUNTERS : PAID_COUNTERS
	return (
		<Card>
			<button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
				<span>
					<span className="block text-[15px] font-semibold">Detalle técnico</span>
					<span className="block text-sm text-muted">Contadores con su nombre interno en Cobrix, para soporte.</span>
				</span>
				<ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
			</button>
			{open && (
				<dl className="grid border-t border-line sm:grid-cols-2">
					{all.map(counter => (
						<div key={counter.key} className="flex items-center justify-between gap-3 border-b border-line/70 px-5 py-2.5 text-sm sm:odd:border-r">
							<dt>{counter.label}<span className="block font-mono text-[11px] text-muted">{counter.key}</span></dt>
							<dd className="tabular font-semibold">{counter.money ? money(run.counters[counter.key] ?? 0) : (run.counters[counter.key] ?? 0)}</dd>
						</div>
					))}
				</dl>
			)}
		</Card>
	)
}

export function CorridaPage() {
	const { id } = useParams()
	const { version } = useRuns()
	const { data: run, error, loading } = useAsync(() => api.run(Number(id)), [id, version])
	const [filter, setFilter] = useState('all')
	const [search, setSearch] = useState('')

	const groups = useMemo(() => {
		const counts = new Map<string, number>()
		for (const item of run?.items ?? []) counts.set(item.result, (counts.get(item.result) ?? 0) + 1)
		return [...counts.entries()].sort((a, b) => b[1] - a[1])
	}, [run])
	const items = useMemo(() => {
		const text = search.trim().toLowerCase()
		return (run?.items ?? []).filter(item =>
			(filter === 'all' || item.result === filter)
			&& (!text || [item.customerName, item.externalId, String(item.contractId ?? ''), item.detail, item.label].some(value => value?.toLowerCase().includes(text))))
	}, [run, filter, search])

	if (error) return <ErrorNotice title={`No se pudo abrir la sincronización #${id}`} message={error.message} action={<Link to="/sincronizacion" className="font-medium underline">Volver al historial</Link>} />
	if (loading && !run) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-24" /><Skeleton className="h-96" /></div>
	if (!run) return null
	const changes = changesOf([run])

	return (
		<>
			<PageHeader
				back={{ to: '/sincronizacion', label: 'Sincronización' }}
				title={`${KIND_LABEL[run.kind]}${run.dryRun ? ' · vista previa' : ''}`}
				description={run.status === 'completed' ? runSummary(run) : undefined}
				meta={<><RunStatusBadge run={run} />{run.trigger === 'auto' && <Badge tone="neutral" dot={false}>Automática</Badge>}<span>#{run.id} · {dateTime(run.startedAt)}</span>{run.finishedAt && <span>· {duration(run.startedAt, run.finishedAt)}</span>}</>}
			/>

			{run.status === 'failed' && (
				<div className="mb-8"><ErrorNotice title="No se pudo completar y no se modificó ningún dato" message={run.error ?? 'Error desconocido.'} action={<Link to="/configuracion" className="font-medium underline">Revisar la configuración</Link>} /></div>
			)}
			{run.status === 'completed' && run.warnings > 0 && (
				<div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
					<strong>{run.warnings} {run.warnings === 1 ? 'contrato no respondió' : 'contratos no respondieron'}</strong> después de reintentar. El resto se procesó con normalidad y la próxima sincronización los vuelve a intentar.
				</div>
			)}

			{run.status === 'completed' && (
				<Section title="Qué cambió">
					<ChangeTiles changes={changes} mode={run.dryRun ? 'preview' : 'applied'} kinds={[run.kind]} />
					<div className="mt-4">{changes.newCount + changes.paidCount + changes.partial.length + changes.excludedCount + changes.attentionCount === 0 ? <NoChanges preview={run.dryRun} /> : <ChangeSections changes={changes} mode={run.dryRun ? 'preview' : 'applied'} />}</div>
				</Section>
			)}

			<Section
				title={run.kind === 'import' ? 'Cuota por cuota' : 'Factura por factura'}
				description="Cada fila con su resultado y el motivo."
				actions={
					<div className="relative">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
						<Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cliente, cuota o contrato" aria-label="Buscar en el detalle" className="h-9 w-60 pl-8" />
					</div>
				}
			>
				<Card>
					{groups.length > 0 && (
						<div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3" role="group" aria-label="Filtrar por resultado">
							<button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'}
								className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', filter === 'all' ? 'border-primary bg-primary text-white' : 'border-line text-muted hover:text-text')}>
								Todas · {run.items.length}
							</button>
							{groups.map(([result, count]) => (
								<button key={result} type="button" onClick={() => setFilter(result)} aria-pressed={filter === result}
									className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', filter === result ? 'border-primary bg-primary text-white' : 'border-line text-muted hover:text-text')}>
									{resultInfo(result).label} · {count}
								</button>
							))}
						</div>
					)}
					{items.length === 0 ? (
						<EmptyState icon={SearchX} title={run.items.length ? 'Ninguna fila coincide' : 'Sin filas'}
							description={run.items.length ? 'Prueba con otro filtro o búsqueda.' : run.status === 'failed' ? 'Falló antes de revisar cuotas: el motivo está arriba.' : 'No había nada que revisar.'} />
					) : (
						<>
							<ul className="divide-y divide-line lg:hidden">
								{items.map(item => {
									const info = resultInfo(item.result)
									return (
										<li key={item.position} className="px-4 py-3 text-sm">
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													{item.customerId ? <Link to={`/clientes/${encodeURIComponent(item.customerId)}`} className="font-medium text-primary">{item.customerName}</Link> : <span className="font-medium">{item.customerName ?? '—'}</span>}
													<p className="font-mono text-xs text-muted">contrato {item.contractId ?? '—'}{item.externalId && ` · cuota ${item.externalId}`}</p>
												</div>
												<span className="tabular shrink-0 font-medium">{money(item.amountCents)}</span>
											</div>
											<div className="mt-2"><Badge tone={info.tone}>{info.label}</Badge></div>
											<p className="mt-1 text-muted">{item.detail}</p>
										</li>
									)
								})}
							</ul>
							<Table wrapperClassName="hidden lg:block">
								<thead><tr><Th>Contrato · cuota</Th><Th>Cliente</Th><Th className="w-full">Resultado y motivo</Th><Th className="text-right">Monto</Th></tr></thead>
								<tbody>
									{items.map(item => {
										const info = resultInfo(item.result)
										return (
											<Tr key={item.position} className="hover:bg-canvas/60">
												<Td className="whitespace-nowrap font-mono text-xs">{item.contractId ?? '—'}{item.externalId && <div className="text-muted">{item.externalId}</div>}</Td>
												<Td className="min-w-40">{item.customerId ? <Link to={`/clientes/${encodeURIComponent(item.customerId)}`} className="font-medium text-primary hover:underline">{item.customerName}</Link> : <span>{item.customerName ?? '—'}</span>}</Td>
												<Td className="min-w-72"><Badge tone={info.tone}>{info.label}</Badge><p className="mt-1 text-muted">{item.detail}</p></Td>
												<Td className="tabular whitespace-nowrap text-right">{money(item.amountCents)}</Td>
											</Tr>
										)
									})}
								</tbody>
							</Table>
						</>
					)}
				</Card>
			</Section>

			<Section title="Para soporte"><TechnicalDetail run={run} /></Section>
		</>
	)
}
