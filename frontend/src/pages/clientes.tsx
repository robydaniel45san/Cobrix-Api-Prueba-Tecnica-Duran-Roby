/**
 * Clientes (ENUNCIADO §3.5): search by name, cédula or RIF, filters by situation (overdue,
 * partial payment, current, settled) and every column the assignment lists.
 */

import { Search, UserSearch, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/layout'
import { useRuns } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { Input } from '@/components/ui/form'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { api, type CustomerRow } from '@/lib/api'
import { date, daysBetween, money } from '@/lib/format'
import { useAsync, useDebounced } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { SITUATION, situationOf, type Situation } from '@/lib/vocabulary'

interface Row extends CustomerRow {
	age: number | null
	situation: Situation
}

const FILTERS: Array<{ id: string; label: string; test: (row: Row) => boolean }> = [
	{ id: 'all', label: 'Todos', test: () => true },
	{ id: 'late', label: 'Vencidos +30 días', test: row => row.situation === 'late' || row.situation === 'late90' },
	{ id: 'partial', label: 'Abono parcial', test: row => row.partialInvoices > 0 },
	{ id: 'current', label: 'Al corriente', test: row => row.situation === 'current' },
	{ id: 'settled', label: 'Al día', test: row => row.situation === 'settled' },
]

export function ClientesPage() {
	const [params, setParams] = useSearchParams()
	const [query, setQuery] = useState(params.get('q') ?? '')
	const filter = params.get('situacion') ?? 'all'
	const debounced = useDebounced(query, 250)
	const { version } = useRuns()
	const navigate = useNavigate()
	const { data, error, loading } = useAsync(async () => {
		const [list, summary] = await Promise.all([api.customers(debounced), api.summary()])
		return { customers: list.customers, today: summary.today, totalDebt: summary.openAmountCents }
	}, [debounced, version])

	const rows = useMemo<Row[]>(() => (data?.customers ?? []).map(customer => {
		const age = customer.oldestDueDate && data ? daysBetween(customer.oldestDueDate, data.today) : null
		return { ...customer, age, situation: situationOf(customer.debtCents, age) }
	}), [data])
	const active = FILTERS.find(f => f.id === filter) ?? (FILTERS[0] as (typeof FILTERS)[number])
	const visible = rows.filter(active.test)

	const update = (next: { q?: string; situacion?: string }) => {
		const merged = { q: next.q ?? query, situacion: next.situacion ?? filter }
		setParams(Object.fromEntries(Object.entries(merged).filter(([key, value]) => value && !(key === 'situacion' && value === 'all'))), { replace: true })
	}

	return (
		<>
			<PageHeader
				title="Clientes"
				description={data ? `${rows.length} titulares traídos del ISP · ${money(data.totalDebt)} por cobrar. Un cliente por cédula o RIF: sus contratos quedan agrupados.` : 'Titulares traídos del ISP.'}
			/>

			<div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
				<label className="flex w-full max-w-md flex-col gap-1.5 text-sm font-medium">
					Buscar
					<span className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
						<Input type="search" value={query} onChange={event => { setQuery(event.target.value); update({ q: event.target.value }) }}
							placeholder="Nombre, cédula o RIF (con o sin guiones)" className="h-11 pl-9" />
					</span>
				</label>
				<div role="group" aria-label="Situación" className="flex flex-wrap gap-2">
					{FILTERS.map(f => (
						<button key={f.id} type="button" onClick={() => update({ situacion: f.id })} aria-pressed={active.id === f.id}
							className={cn('min-h-10 rounded-full border px-3.5 text-sm font-medium', active.id === f.id ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-text hover:bg-canvas')}>
							{f.label} · {rows.filter(f.test).length}
						</button>
					))}
				</div>
			</div>

			<Card>
				{error && <div className="p-5"><ErrorNotice message={error.message} /></div>}
				{loading && !data && <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>}
				{data && rows.length === 0 && (debounced
					? <EmptyState icon={UserSearch} title="Sin resultados" description={<>No hay clientes que coincidan con «{debounced}». La cédula o el RIF se pueden escribir con o sin guiones ni puntos.</>} />
					: <EmptyState icon={Users} title="Todavía no hay clientes" description="Los clientes llegan al traer las facturas del ISP. Empieza con una vista previa: no cambia nada." action={<Link to="/sincronizacion/revisar?que=facturas" className={buttonVariants()}>Ver vista previa</Link>} />)}
				{data && rows.length > 0 && visible.length === 0 && <EmptyState icon={Users} title="Nadie en esta situación" description="Prueba con otro filtro." />}

				{visible.length > 0 && (
					<>
						<ul className="divide-y divide-line lg:hidden">
							{visible.map(row => (
								<li key={row.id}>
									<Link to={`/clientes/${encodeURIComponent(row.id)}`} className="flex items-start justify-between gap-3 px-4 py-3 active:bg-canvas">
										<div className="min-w-0">
											<p className="truncate font-medium">{row.name}</p>
											<p className="font-mono text-xs text-muted">{row.document} · {row.personType === 'juridica' ? 'Jurídica' : 'Natural'}</p>
											<div className="mt-1.5 flex flex-wrap gap-1.5">
												<Badge tone={SITUATION[row.situation].tone}>{SITUATION[row.situation].label}</Badge>
												{row.partialInvoices > 0 && <Badge tone="warning">Abono parcial</Badge>}
											</div>
											<p className="mt-1 text-xs text-muted">{row.openInvoices} abiertas · {row.paidInvoices} pagadas · {row.contracts} {row.contracts === 1 ? 'contrato' : 'contratos'}</p>
										</div>
										<div className="shrink-0 text-right">
											<p className={cn('tabular font-semibold', row.debtCents === 0 && 'font-normal text-muted')}>{money(row.debtCents)}</p>
											{row.oldestDueDate && <p className="text-xs text-muted">desde {date(row.oldestDueDate)}</p>}
										</div>
									</Link>
								</li>
							))}
						</ul>
						<Table wrapperClassName="hidden lg:block">
							<thead>
								<tr>
									<Th>Cliente</Th><Th>Tipo</Th><Th>Situación</Th><Th className="text-right">Contratos</Th><Th className="text-right">Abiertas</Th>
									<Th className="text-right">Pagadas</Th><Th className="text-right">Deuda</Th><Th>Vencimiento más antiguo</Th>
								</tr>
							</thead>
							<tbody>
								{visible.map(row => (
									<Tr key={row.id} className="cursor-pointer hover:bg-canvas/60" onClick={() => navigate(`/clientes/${encodeURIComponent(row.id)}`)}>
										<Td className="min-w-52">
											<Link to={`/clientes/${encodeURIComponent(row.id)}`} className="font-medium hover:text-primary" onClick={event => event.stopPropagation()}>{row.name}</Link>
											<div className="font-mono text-xs text-muted">{row.document}</div>
										</Td>
										<Td>{row.personType === 'juridica' ? 'Jurídica' : 'Natural'}</Td>
										<Td><div className="flex flex-col items-start gap-1"><Badge tone={SITUATION[row.situation].tone}>{SITUATION[row.situation].label}</Badge>{row.partialInvoices > 0 && <Badge tone="warning">Abono parcial</Badge>}</div></Td>
										<Td className="tabular text-right">{row.contracts}</Td>
										<Td className="tabular text-right">{row.openInvoices}</Td>
										<Td className="tabular text-right">{row.paidInvoices}</Td>
										<Td className={cn('tabular whitespace-nowrap text-right font-semibold', row.debtCents === 0 && 'font-normal text-muted')}>{money(row.debtCents)}</Td>
										<Td className="whitespace-nowrap">{row.oldestDueDate ? <>{date(row.oldestDueDate)}{row.age !== null && row.age > 0 && <span className="block text-xs text-muted">hace {row.age} días</span>}</> : <span className="text-muted">Sin deuda</span>}</Td>
									</Tr>
								))}
							</tbody>
						</Table>
					</>
				)}
			</Card>
		</>
	)
}
