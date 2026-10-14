/**
 * Inicio: answers the operator's three questions. Is my ISP data up to date? (status strip)
 * How much and whom do I collect first? What needs my attention? Plus the totals, the provider,
 * the automatic sync and the recent activity the assignment asks for (§3.8).
 */

import { ArrowRight, CalendarClock, PlugZap, Server } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader, Section } from '@/components/layout'
import { LiveRun, RunStatusBadge, runSummary, SyncActions, useRuns } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { api, type CustomerRow, type Summary } from '@/lib/api'
import { date, dateTime, daysBetween, money, periodLong, plural } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { KIND_LABEL, SITUATION, situationOf } from '@/lib/vocabulary'

const AGING_COLORS: Record<string, string> = { '0-30': 'bg-sky-500', '31-60': 'bg-amber-400', '61-90': 'bg-orange-500', '90+': 'bg-rose-600' }

function Money({ summary }: { summary: Summary }) {
	return (
		<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
			<div className="col-span-2 rounded-2xl bg-[#1e1b4b] p-5 text-white">
				<p className="text-sm text-indigo-200">Por cobrar</p>
				<p className="tabular mt-1 text-4xl font-semibold tracking-tight">{money(summary.openAmountCents)}</p>
				<p className="mt-1 text-sm text-indigo-200">{plural(summary.openInvoices, 'factura abierta', 'facturas abiertas')} de {plural(summary.customers, 'cliente', 'clientes')}</p>
			</div>
			<Card className="p-4 sm:p-5">
				<p className="text-xs text-muted sm:text-sm">Vencido +30 días</p>
				<p className="tabular mt-1 text-lg font-semibold text-amber-700 sm:text-2xl">{money(summary.overdue30.amountCents)}</p>
				<p className="mt-1 text-xs text-muted">{plural(summary.overdue30.invoices, 'factura', 'facturas')} · {plural(summary.overdue30.customers, 'cliente', 'clientes')}</p>
			</Card>
			<Card className="p-4 sm:p-5">
				<p className="text-xs text-muted sm:text-sm">Cobrado por el ISP</p>
				<p className="tabular mt-1 text-lg font-semibold text-emerald-700 sm:text-2xl">{money(summary.paidAmountCents)}</p>
				<p className="mt-1 text-xs text-muted">{plural(summary.paidInvoices, 'factura pagada', 'facturas pagadas')} en caja</p>
			</Card>
		</div>
	)
}

function Totals({ summary }: { summary: Summary }) {
	const items = [
		['Clientes', summary.customers], ['Contratos', summary.contracts],
		['Facturas abiertas', summary.openInvoices], ['Facturas pagadas', summary.paidInvoices],
	] as const
	return (
		<dl className="grid grid-cols-2 divide-line rounded-2xl border border-line bg-surface sm:grid-cols-4 sm:divide-x">
			{items.map(([label, value]) => (
				<div key={label} className="px-5 py-3">
					<dt className="text-xs text-muted">{label}</dt>
					<dd className="tabular text-lg font-semibold">{value.toLocaleString('es-VE')}</dd>
				</div>
			))}
		</dl>
	)
}

function Priority({ customers, today }: { customers: CustomerRow[]; today: string }) {
	const withDebt = customers
		.filter(customer => customer.debtCents > 0 && customer.oldestDueDate)
		.sort((a, b) => (a.oldestDueDate as string).localeCompare(b.oldestDueDate as string) || b.debtCents - a.debtCents)
		.slice(0, 5)
	if (!withDebt.length) return <p className="px-5 py-8 text-center text-sm text-muted">Nadie debe: no hay facturas abiertas.</p>
	return (
		<ul className="divide-y divide-line/70">
			{withDebt.map(customer => {
				const age = daysBetween(customer.oldestDueDate as string, today)
				const situation = SITUATION[situationOf(customer.debtCents, age)]
				return (
					<li key={customer.id}>
						<Link to={`/clientes/${encodeURIComponent(customer.id)}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-canvas/60">
							<span className="min-w-0 flex-[1_1_200px]">
								<span className="block font-medium">{customer.name}</span>
								<span className="block text-xs text-muted">
									{plural(customer.openInvoices, 'factura', 'facturas')} · desde {date(customer.oldestDueDate)}{customer.partialInvoices > 0 && ' · abono parcial'}
								</span>
							</span>
							<Badge tone={situation.tone}>{age > 0 ? `${age} días vencido` : 'Vence hoy'}</Badge>
							<span className="tabular w-28 text-right font-medium">{money(customer.debtCents)}</span>
						</Link>
					</li>
				)
			})}
		</ul>
	)
}

function Notice({ tone = 'neutral', title, children, action }: { tone?: 'warning' | 'danger' | 'neutral'; title: string; children: ReactNode; action?: ReactNode }) {
	return (
		<div className={cn('rounded-2xl border px-5 py-4 text-sm',
			tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-950',
			tone === 'danger' && 'border-rose-200 bg-rose-50 text-rose-950',
			tone === 'neutral' && 'border-line bg-surface')}>
			<p className="font-semibold">{title}</p>
			<div className={cn('mt-1', tone === 'neutral' && 'text-muted')}>{children}</div>
			{action && <div className="mt-2 font-medium">{action}</div>}
		</div>
	)
}

function Attention({ summary }: { summary: Summary }) {
	const notices: ReactNode[] = []
	const lastReal = summary.lastRuns.find(run => !run.dryRun)
	if (lastReal?.status === 'failed') {
		notices.push(
			<Notice key="failed" tone="danger" title={`${KIND_LABEL[lastReal.kind]}: la última sincronización falló`} action={<Link to={`/sincronizacion/${lastReal.id}`} className="text-rose-800 underline">Ver qué pasó</Link>}>
				{lastReal.error}
			</Notice>,
		)
	}
	for (const partial of summary.partials) {
		notices.push(
			<Notice key={`p${partial.invoiceId}`} tone="warning" title={`Abono parcial · ${partial.customerName}`} action={<Link to={`/clientes/${encodeURIComponent(partial.customerId)}`} className="text-amber-900 underline">Ver cliente</Link>}>
				En el ISP quedan {money(partial.ispBalanceCents)} por cobrar de la cuota de {periodLong(partial.period)} ({money(partial.balanceCents)}). La factura sigue abierta hasta que se salde.
			</Notice>,
		)
	}
	const imported = summary.lastApplied.import
	if (imported) {
		const c = (key: string) => imported.counters[key] ?? 0
		const parts = [
			c('installmentsExcludedByStatus') && `${c('installmentsExcludedByStatus')} de contratos inactivos`,
			c('installmentsExcludedByCurrency') && `${c('installmentsExcludedByCurrency')} con montos que no cuadran con el plan`,
			c('installmentsZeroAmount') && `${c('installmentsZeroAmount')} con saldo menor a un centavo`,
			c('installmentsIndeterminate') && `${c('installmentsIndeterminate')} con datos inconsistentes del ISP`,
			c('installmentsExcludedByWindow') + c('installmentsExcludedByRecentLimit') + c('installmentsExcludedByIdentifierType') && 'otras por la configuración',
		].filter(Boolean)
		const total = c('installmentsExcludedByStatus') + c('installmentsExcludedByCurrency') + c('installmentsZeroAmount') + c('installmentsIndeterminate')
			+ c('installmentsExcludedByWindow') + c('installmentsExcludedByRecentLimit') + c('installmentsExcludedByIdentifierType')
		if (total) {
			notices.push(
				<Notice key="excluded" title={`${plural(total, 'cuota no se trajo', 'cuotas no se trajeron')} del ISP`} action={<Link to={`/sincronizacion/${imported.id}`} className="text-primary hover:underline">Ver por qué</Link>}>
					{parts.join(', ')}.
				</Notice>,
			)
		}
	}
	if (summary.provider.configured && !summary.provider.autoEnabled) {
		notices.push(
			<Notice key="auto" title="Sincronización automática apagada" action={<Link to="/configuracion" className="text-primary hover:underline">Activar</Link>}>
				Actívala para traer las novedades del ISP cada día sin intervenir.
			</Notice>,
		)
	}
	if (!notices.length) return <Notice title="Nada pendiente">Todo lo que trajo el ISP quedó claro.</Notice>
	return <div className="space-y-3">{notices}</div>
}

function Aging({ summary }: { summary: Summary }) {
	const max = Math.max(...summary.aging.map(slot => slot.amountCents), 1)
	return (
		<Card className="p-5">
			<ul className="space-y-4">
				{summary.aging.map(slot => (
					<li key={slot.bucket}>
						<div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
							<span className="font-medium">{slot.label}</span>
							<span className="text-muted"><span className="tabular text-text">{money(slot.amountCents)}</span> · {plural(slot.invoices, 'factura', 'facturas')}</span>
						</div>
						<div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-canvas">
							<div className={cn('h-full rounded-full', AGING_COLORS[slot.bucket])} style={{ width: `${slot.amountCents === 0 ? 0 : Math.max((slot.amountCents / max) * 100, 2)}%` }} />
						</div>
					</li>
				))}
			</ul>
		</Card>
	)
}

function IspCard({ summary }: { summary: Summary }) {
	const { provider } = summary
	return (
		<Card className="p-5">
			<div className="space-y-3 text-sm">
				<div className="flex items-start gap-3">
					<Server className="mt-0.5 size-4 shrink-0 text-muted" />
					<div className="min-w-0"><p className="font-medium">{provider.name}</p><p className="truncate font-mono text-xs text-muted">{provider.baseUrl}</p></div>
				</div>
				<div className="flex items-start gap-3">
					<CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" />
					<p className="text-muted">
						{provider.autoEnabled && provider.autoTime
							? <>Sincronización automática todos los días a las {provider.autoTime} (Caracas){provider.autoLastDate && <> · última: {date(provider.autoLastDate)}</>}</>
							: 'Sincronización automática apagada'}
					</p>
				</div>
			</div>
			<div className="mt-4 border-t border-line pt-4"><SyncActions layout="stack" /></div>
		</Card>
	)
}

export function InicioPage() {
	const { version } = useRuns()
	const { data, error, loading, reload } = useAsync(async () => {
		const [summary, list] = await Promise.all([api.summary(), api.customers('')])
		return { summary, customers: list.customers }
	}, [version])

	if (error && !data) return <ErrorNotice message={error.message} action={<button className="font-medium underline" onClick={reload}>Reintentar</button>} />
	if (loading && !data) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-36" /><Skeleton className="h-72" /></div>
	if (!data) return null
	const { summary } = data
	const applied = summary.lastRuns.filter(run => !run.dryRun)

	// Nothing connected and nothing brought yet: the only useful thing to show is how to start.
	if (!summary.provider.configured && summary.customers === 0) {
		return (
			<>
				<PageHeader title="Inicio" description={<>{summary.company.name || 'Tu empresa'} · datos al {date(summary.today)}</>} />
				<Card>
					<EmptyState icon={PlugZap} title="Conecta el sistema de facturación de tu ISP"
						description="Cuatro pasos guiados: tu empresa, la conexión, qué se cobra y una vista previa. Nada se trae hasta que la confirmes."
						action={<Link to="/bienvenida" className={buttonVariants({ size: 'lg' })}>Empezar <ArrowRight /></Link>} />
				</Card>
			</>
		)
	}

	return (
		<>
			<PageHeader title="Inicio" description={<>{summary.company.name || 'Tu empresa'} · datos al {date(summary.today)}</>} />

			{!summary.provider.configured && (
				<Card className="mb-8">
					<EmptyState icon={PlugZap} title="Conecta el sistema de facturación de tu ISP"
						description="Cuatro pasos guiados. Nada se trae hasta que veas la vista previa y la confirmes."
						action={<Link to="/bienvenida" className={buttonVariants({ size: 'lg' })}>Empezar <ArrowRight /></Link>} />
				</Card>
			)}
			<LiveRun className="mb-8" />

			<section aria-label="Por cobrar"><Money summary={summary} /></section>

			<div className="mt-8 grid gap-x-6 gap-y-8 lg:grid-cols-3">
				<Section title="A quién cobrar primero" description="Ordenados por la deuda vencida más antigua." className="mt-0 lg:col-span-2"
					actions={<Link to="/clientes" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver todos <ArrowRight className="size-3.5" /></Link>}>
					<Card><Priority customers={data.customers} today={summary.today} /></Card>
				</Section>
				<Section title="Necesita atención" className="mt-0"><Attention summary={summary} /></Section>
			</div>

			<div className="mt-8 grid gap-x-6 gap-y-8 lg:grid-cols-3">
				<Section title="Antigüedad de la deuda" description="Saldo abierto según los días desde el vencimiento." className="mt-0 lg:col-span-2"><Aging summary={summary} /></Section>
				{summary.provider.configured && <Section title="Sistema del ISP" className="mt-0"><IspCard summary={summary} /></Section>}
			</div>

			<Section title="Totales"><Totals summary={summary} /></Section>

			<Section title="Actividad reciente" description="Sincronizaciones aplicadas; las vistas previas están en el historial." actions={<Link to="/sincronizacion" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Historial <ArrowRight className="size-3.5" /></Link>}>
				<Card>
					{applied.length === 0 ? (
						<p className="px-5 py-8 text-center text-sm text-muted">Todavía no se aplicó ninguna sincronización.</p>
					) : (
						<ul className="divide-y divide-line/70">
							{applied.map(run => (
								<li key={run.id}>
									<Link to={`/sincronizacion/${run.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-canvas/60">
										<span className="w-36 font-medium">{KIND_LABEL[run.kind]}</span>
										<RunStatusBadge run={run} />
										<span className={cn('min-w-0 flex-[1_1_240px]', run.status === 'failed' ? 'text-rose-700' : 'text-muted')}>{runSummary(run)}</span>
										<span className="text-xs text-muted">{dateTime(run.startedAt)}</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</Card>
			</Section>
		</>
	)
}
