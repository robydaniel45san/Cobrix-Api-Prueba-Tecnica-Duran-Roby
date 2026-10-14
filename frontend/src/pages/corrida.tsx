import { ChevronDown, Search, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PageHeader, StatCard } from '@/components/layout'
import { RunStatusBadge, runSummary, useRuns } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { Input } from '@/components/ui/form'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { api, type Run } from '@/lib/api'
import { dateTime, duration, money } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { IMPORT_COUNTERS, KIND_LABEL, PAID_COUNTERS, resultInfo, type CounterInfo } from '@/lib/vocabulary'

/** The counters an operator looks at first, per run kind and mode. */
function highlights(run: Run): CounterInfo[] {
	const pick = (keys: string[], all: CounterInfo[]) => keys.map(key => all.find(counter => counter.key === key) as CounterInfo)
	if (run.kind === 'import') {
		return pick(run.dryRun
			? ['contractsObserved', 'installmentsWouldImport', 'amountWouldImportCents', 'customersWouldCreate', 'installmentsAlreadyImported', 'installmentsExcludedByStatus']
			: ['contractsObserved', 'installmentsImported', 'amountImportedCents', 'customersCreated', 'installmentsAlreadyImported', 'installmentsExcludedByStatus'], IMPORT_COUNTERS)
	}
	return pick(run.dryRun
		? ['invoicesChecked', 'invoicesWouldMarkPaid', 'amountWouldMarkPaidCents', 'invoicesPartiallyPaidAtIsp', 'invoicesStillOpen', 'invoicesUnknown']
		: ['invoicesChecked', 'invoicesMarkedPaid', 'amountMarkedPaidCents', 'invoicesPartiallyPaidAtIsp', 'invoicesStillOpen', 'invoicesUnknown'], PAID_COUNTERS)
}

function Counters({ run }: { run: Run }) {
	const [open, setOpen] = useState(false)
	const all = run.kind === 'import' ? IMPORT_COUNTERS : PAID_COUNTERS
	return (
		<Card className="mt-6">
			<button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full items-center justify-between px-5 py-4 text-left">
				<span>
					<span className="block text-[15px] font-semibold">Todos los contadores</span>
					<span className="block text-sm text-muted">Con el nombre que usa Cobrix internamente, para hablar el mismo idioma con soporte.</span>
				</span>
				<ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
			</button>
			{open && (
				<dl className="grid border-t border-line sm:grid-cols-2">
					{all.map(counter => (
						<div key={counter.key} className="flex items-center justify-between gap-3 border-b border-line/70 px-5 py-2.5 text-sm sm:odd:border-r">
							<dt>
								{counter.label}
								<span className="block font-mono text-[11px] text-muted">{counter.key}</span>
							</dt>
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
	const [filter, setFilter] = useState<string>('all')
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

	if (error) return <ErrorNotice title={`No se pudo abrir la corrida #${id}`} message={error.message} action={<Link to="/sincronizacion" className="font-medium underline">Volver al historial</Link>} />
	if (loading && !run) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-24" /><Skeleton className="h-96" /></div>
	if (!run) return null

	return (
		<>
			<PageHeader
				back={{ to: '/sincronizacion', label: 'Sincronización' }}
				title={`${KIND_LABEL[run.kind]} #${run.id}`}
				meta={
					<>
						<RunStatusBadge run={run} />
						{run.dryRun && <Badge tone="info">Simulación: no se escribió nada</Badge>}
						{run.trigger === 'auto' && <Badge tone="neutral" dot={false}>Automática</Badge>}
						<span>{dateTime(run.startedAt)}</span>
						{run.finishedAt && <span>· {duration(run.startedAt, run.finishedAt)}</span>}
					</>
				}
			/>

			{run.status === 'failed' && (
				<div className="mb-6"><ErrorNotice title="La corrida falló y no modificó datos" message={run.error ?? 'Error desconocido.'} action={<Link to="/configuracion" className="font-medium underline">Revisar la configuración</Link>} /></div>
			)}
			{run.status === 'completed' && run.warnings > 0 && (
				<div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
					<strong>{run.warnings} {run.warnings === 1 ? 'contrato no respondió' : 'contratos no respondieron'}</strong> después de reintentar. El resto se procesó con normalidad; la próxima corrida los vuelve a intentar. Filtra por «Consulta fallida» para ver el error.
				</div>
			)}

			<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
				{highlights(run).map((counter, index) => (
					<StatCard key={counter.key} label={counter.label}
						value={counter.money ? money(run.counters[counter.key] ?? 0) : (run.counters[counter.key] ?? 0).toLocaleString('es-VE')}
						tone={index === 1 ? 'primary' : undefined} />
				))}
			</div>
			{run.status === 'completed' && <p className="mt-3 text-sm text-muted">{runSummary(run.kind, run.dryRun, run.counters)}</p>}

			<Counters run={run} />

			<Card className="mt-6">
				<CardHeader
					title="Detalle"
					description={run.kind === 'import' ? 'Una fila por cuota con su resultado y el motivo.' : 'Una fila por factura abierta con lo que dice el administrador.'}
					actions={
						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
							<Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cliente, cuota o contrato" aria-label="Buscar en el detalle" className="h-8 w-56 pl-8" />
						</div>
					}
				/>
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
					<EmptyState icon={SearchX} title={run.items.length ? 'Ninguna fila coincide' : 'Esta corrida no tiene detalle'}
						description={run.items.length ? 'Prueba con otro filtro o búsqueda.' : run.status === 'failed' ? 'Falló antes de evaluar cuotas: revisa el error de arriba.' : 'No había nada que evaluar.'} />
				) : (
					<>
					<ul className="divide-y divide-line md:hidden">
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
					<Table wrapperClassName="hidden md:block">
						<thead>
							<tr><Th>Contrato · cuota</Th><Th>Cliente</Th><Th className="w-full">Resultado</Th><Th className="text-right">Monto</Th></tr>
						</thead>
						<tbody>
							{items.map(item => {
								const info = resultInfo(item.result)
								return (
									<Tr key={item.position} className="hover:bg-canvas/60">
										<Td className="whitespace-nowrap font-mono text-xs">
											{item.contractId ?? '—'}
											{item.externalId && <div className="text-muted">{item.externalId}</div>}
										</Td>
										<Td className="min-w-40">
											{item.customerId ? <Link to={`/clientes/${encodeURIComponent(item.customerId)}`} className="font-medium text-primary hover:underline">{item.customerName}</Link> : <span>{item.customerName ?? '—'}</span>}
										</Td>
										<Td className="min-w-72">
											<Badge tone={info.tone}>{info.label}</Badge>
											<p className="mt-1 text-muted">{item.detail}</p>
											{item.label && item.detail !== item.label && <p className="text-xs text-muted">{item.label}</p>}
										</Td>
										<Td className="tabular whitespace-nowrap text-right">{money(item.amountCents)}</Td>
									</Tr>
								)
							})}
						</tbody>
					</Table>
					</>
				)}
			</Card>
		</>
	)
}
