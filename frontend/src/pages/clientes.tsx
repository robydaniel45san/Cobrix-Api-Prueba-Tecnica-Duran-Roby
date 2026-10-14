import { Search, UserSearch, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/layout'
import { useRuns } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { Input } from '@/components/ui/form'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { api } from '@/lib/api'
import { date, daysBetween, money } from '@/lib/format'
import { useAsync, useDebounced } from '@/lib/hooks'
import { cn } from '@/lib/utils'

export function ClientesPage() {
	const [params, setParams] = useSearchParams()
	const [query, setQuery] = useState(params.get('q') ?? '')
	const debounced = useDebounced(query, 250)
	const { version } = useRuns()
	const navigate = useNavigate()
	const { data, error, loading } = useAsync(async () => {
		const [list, summary] = await Promise.all([api.customers(debounced), api.summary()])
		return { customers: list.customers, today: summary.today }
	}, [debounced, version])

	const onSearch = (value: string) => {
		setQuery(value)
		setParams(value ? { q: value } : {}, { replace: true })
	}

	return (
		<>
			<PageHeader title="Clientes" description="Titulares importados desde el administrador de facturas. Un cliente por cédula o RIF: si tiene varios contratos, quedan agrupados." />
			<Card>
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
					<div className="relative w-full max-w-sm">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
						<Input type="search" value={query} onChange={event => onSearch(event.target.value)} placeholder="Buscar por nombre, cédula o RIF" aria-label="Buscar clientes" className="pl-9" />
					</div>
					{data && <p className="text-sm text-muted">{data.customers.length} {data.customers.length === 1 ? 'cliente' : 'clientes'} · ordenados por deuda</p>}
				</div>

				{error && <div className="p-5"><ErrorNotice message={error.message} /></div>}
				{loading && !data && <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>}
				{data && data.customers.length === 0 && (debounced
					? <EmptyState icon={UserSearch} title="Sin resultados" description={<>No hay clientes que coincidan con «{debounced}». La cédula o el RIF se pueden escribir con o sin guiones ni puntos.</>} />
					: <EmptyState icon={Users} title="Todavía no hay clientes" description="Los clientes aparecen al importar desde el administrador de facturas. Simula la importación para ver cuántos se crearían." action={<Link to="/sincronizacion" className={buttonVariants()}>Ir a Sincronización</Link>} />)}

				{data && data.customers.length > 0 && (
					<ul className="divide-y divide-line lg:hidden">
						{data.customers.map(customer => {
							const age = customer.oldestDueDate ? daysBetween(customer.oldestDueDate, data.today) : null
							return (
								<li key={customer.id}>
									<Link to={`/clientes/${encodeURIComponent(customer.id)}`} className="flex items-start justify-between gap-3 px-4 py-3 active:bg-canvas">
										<div className="min-w-0">
											<p className="truncate font-medium">{customer.name}</p>
											<p className="font-mono text-xs text-muted">{customer.document} · {customer.personType === 'juridica' ? 'Jurídica' : 'Natural'}</p>
											<p className="mt-1 text-xs text-muted">
												{customer.openInvoices} abiertas · {customer.paidInvoices} pagadas · {customer.contracts} {customer.contracts === 1 ? 'contrato' : 'contratos'}
											</p>
										</div>
										<div className="shrink-0 text-right">
											<p className={cn('tabular font-semibold', customer.debtCents === 0 && 'font-normal text-muted')}>{money(customer.debtCents)}</p>
											{customer.oldestDueDate && <p className={cn('text-xs', age !== null && age > 90 ? 'text-rose-600' : age !== null && age > 30 ? 'text-amber-700' : 'text-muted')}>desde {date(customer.oldestDueDate)}</p>}
										</div>
									</Link>
								</li>
							)
						})}
					</ul>
				)}
				{data && data.customers.length > 0 && (
					<Table wrapperClassName="hidden lg:block">
						<thead>
							<tr>
								<Th>Cliente</Th><Th>Tipo</Th><Th className="text-right">Contratos</Th><Th className="text-right">Abiertas</Th>
								<Th className="text-right">Pagadas</Th><Th className="text-right">Deuda</Th><Th>Vencimiento más antiguo</Th>
							</tr>
						</thead>
						<tbody>
							{data.customers.map(customer => {
								const age = customer.oldestDueDate ? daysBetween(customer.oldestDueDate, data.today) : null
								return (
									<Tr key={customer.id} className="cursor-pointer hover:bg-canvas/60" onClick={() => navigate(`/clientes/${encodeURIComponent(customer.id)}`)}>
										<Td className="min-w-52">
											<Link to={`/clientes/${encodeURIComponent(customer.id)}`} className="font-medium text-text hover:text-primary" onClick={event => event.stopPropagation()}>{customer.name}</Link>
											<div className="font-mono text-xs text-muted">{customer.document}</div>
										</Td>
										<Td><Badge tone={customer.personType === 'juridica' ? 'info' : 'neutral'} dot={false}>{customer.personType === 'juridica' ? 'Jurídica' : 'Natural'}</Badge></Td>
										<Td className="tabular text-right">{customer.contracts}</Td>
										<Td className="tabular text-right">{customer.openInvoices}</Td>
										<Td className="tabular text-right">{customer.paidInvoices}</Td>
										<Td className={cn('tabular whitespace-nowrap text-right font-semibold', customer.debtCents === 0 && 'font-normal text-muted')}>{money(customer.debtCents)}</Td>
										<Td className="whitespace-nowrap">
											{customer.oldestDueDate ? (
												<>
													{date(customer.oldestDueDate)}
													{age !== null && age > 30 && <span className={cn('ml-2 text-xs font-medium', age > 90 ? 'text-rose-600' : 'text-amber-700')}>{age} días</span>}
												</>
											) : <span className="text-muted">Al día</span>}
										</Td>
									</Tr>
								)
							})}
						</tbody>
					</Table>
				)}
			</Card>
		</>
	)
}
