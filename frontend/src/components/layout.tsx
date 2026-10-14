/**
 * Application shell, responsive at every width:
 *   - phone (< 768 px): top bar with the current section and a slide-in drawer (Radix Dialog:
 *     overlay, Escape, focus trap, scroll lock);
 *   - tablet (768–1279 px): icon rail, always visible, expandable;
 *   - desktop (≥ 1280 px): full sidebar, collapsible to the icon rail (remembered per browser).
 * Navigation is grouped by the operator's tasks: Cobranza and Sistema del ISP. A status strip on
 * every screen tells whether the ISP data is up to date and offers «Sincronizar ahora».
 */

import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, LayoutDashboard, Menu, PanelLeftClose, PanelLeftOpen, RefreshCw, Settings, Users, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { api, type Company, type Summary } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useAsync, useSettingsVersion } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useRuns } from './runs'
import { buttonVariants } from './ui/button'

interface NavItem {
	readonly to: string
	readonly label: string
	readonly icon: LucideIcon
	readonly end: boolean
}

const NAV_GROUPS: ReadonlyArray<{ readonly label: string; readonly items: readonly NavItem[] }> = [
	{
		label: 'Cobranza',
		items: [
			{ to: '/', label: 'Inicio', icon: LayoutDashboard, end: true },
			{ to: '/clientes', label: 'Clientes', icon: Users, end: false },
		],
	},
	{
		label: 'Sistema del ISP',
		items: [
			{ to: '/sincronizacion', label: 'Sincronización', icon: RefreshCw, end: false },
			{ to: '/configuracion', label: 'Configuración', icon: Settings, end: false },
		],
	},
]

const ALL_ITEMS = NAV_GROUPS.flatMap(group => group.items)

function currentSection(pathname: string): string {
	const match = [...ALL_ITEMS].reverse().find(item => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
	return match?.label ?? 'Cobrix'
}

const COLLAPSED_KEY = 'cobrix:sidebar-collapsed'

function readCollapsed(): boolean {
	try {
		const saved = localStorage.getItem(COLLAPSED_KEY)
		if (saved !== null) return saved === '1'
	} catch {
		// Storage unavailable: fall back to the width.
	}
	return window.innerWidth < 1280
}

function Brand({ compact = false }: { compact?: boolean }) {
	return (
		<Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label="Cobrix, ir al resumen">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">c</span>
			{!compact && (
				<span className="min-w-0 leading-tight">
					<span className="block text-[15px] font-semibold tracking-tight text-white">cobrix</span>
					<span className="block truncate text-xs text-slate-400">Administrador de facturas</span>
				</span>
			)}
		</Link>
	)
}

function Navigation({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
	const { progress } = useRuns()
	return (
		<nav aria-label="Principal" className="flex flex-col gap-5">
			{NAV_GROUPS.map(group => (
				<div key={group.label}>
					{compact
						? <div aria-hidden className="mx-auto mb-2 h-px w-6 bg-white/10" />
						: <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group.label}</p>}
					<ul className="flex flex-col gap-1">
						{group.items.map(({ to, label, icon: Icon, end }) => (
							<li key={to}>
								<NavLink
									to={to}
									end={end}
									onClick={onNavigate}
									aria-label={compact ? label : undefined}
									className={({ isActive }) => cn(
										'group relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
										compact ? 'justify-center px-0' : 'px-3',
										isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white',
									)}
								>
									<Icon className="size-[18px] shrink-0" />
									{!compact && <span className="flex-1">{label}</span>}
									{to === '/sincronizacion' && progress && (
										<span className={cn('size-2 animate-pulse rounded-full bg-sky-400', compact && 'absolute right-3 top-2')} aria-label="Corrida en curso" />
									)}
									{compact && (
										// Visual tooltip for the icon rail; the accessible name comes from aria-label.
										<span aria-hidden className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-md bg-ink-800 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
											{label}
										</span>
									)}
								</NavLink>
							</li>
						))}
					</ul>
				</div>
			))}
		</nav>
	)
}

function CompanyFooter({ company, compact = false }: { company: Company | undefined; compact?: boolean }) {
	const { connected } = useRuns()
	const status = connected ? 'Conectado al servidor' : 'Reconectando…'
	if (compact) {
		return (
			<div className="flex justify-center border-t border-white/10 pt-4" title={status}>
				<span role="status" aria-label={status} className={cn('size-2 rounded-full', connected ? 'bg-emerald-400' : 'bg-slate-500')} />
			</div>
		)
	}
	return (
		<div className="border-t border-white/10 pt-4 text-xs text-slate-400">
			<p className="truncate font-medium text-slate-200">{company?.name || 'Empresa sin configurar'}</p>
			{company?.rif && <p className="mt-0.5">{company.rif}</p>}
			<p role="status" className="mt-2 flex items-center gap-1.5">
				<span className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-slate-500')} />
				{status}
			</p>
		</div>
	)
}

export function Layout() {
	const location = useLocation()
	const { version } = useRuns()
	const settingsVersion = useSettingsVersion()
	const settings = useAsync(() => api.settings(), [version, settingsVersion])
	const company = settings.data?.company
	const summary = useAsync(() => api.summary(), [version, settingsVersion])
	const [collapsed, setCollapsed] = useState(readCollapsed)
	const [drawerOpen, setDrawerOpen] = useState(false)

	useEffect(() => setDrawerOpen(false), [location.pathname])
	useEffect(() => {
		try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0') } catch { /* storage unavailable */ }
	}, [collapsed])

	return (
		<div className="min-h-dvh md:flex">
			{/* Tablet and desktop: sidebar or icon rail, always visible. */}
			<aside
				className={cn(
					'sticky top-0 hidden h-dvh shrink-0 flex-col bg-ink-950 py-5 transition-[width] duration-200 md:flex',
					collapsed ? 'w-[72px] px-3' : 'w-[248px] px-4',
				)}
			>
				<div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between gap-2')}>
					<Brand compact={collapsed} />
				</div>
				{/* No scroll container on the rail: it would clip the labels that pop out to the right. */}
				<div className={cn('mt-8 flex-1', !collapsed && 'no-scrollbar overflow-y-auto')}><Navigation compact={collapsed} /></div>
				<button
					type="button"
					onClick={() => setCollapsed(value => !value)}
					aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
					aria-expanded={!collapsed}
					className={cn('mb-4 flex items-center gap-2 rounded-lg py-2 text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-white', collapsed ? 'justify-center' : 'px-3')}
				>
					{collapsed ? <PanelLeftOpen className="size-[18px]" /> : <><PanelLeftClose className="size-[18px]" /> Contraer menú</>}
				</button>
				<CompanyFooter company={company} compact={collapsed} />
			</aside>

			{/* Phone: top bar with the current section and a drawer. */}
			<Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
				<header className="sticky top-0 z-30 flex items-center gap-3 bg-ink-950 px-4 py-3 md:hidden">
					<Dialog.Trigger asChild>
						<button type="button" aria-label="Abrir menú" className="-ml-1 rounded-lg p-2 text-slate-300 hover:bg-white/10">
							<Menu className="size-5" />
						</button>
					</Dialog.Trigger>
					<Brand compact />
					<span className="truncate text-sm font-semibold text-white">{currentSection(location.pathname)}</span>
				</header>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 z-40 bg-ink-950/50 backdrop-blur-[2px] md:hidden" />
					<Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(288px,85vw)] flex-col bg-ink-950 px-4 py-5 shadow-2xl md:hidden">
						<div className="flex items-center justify-between gap-2">
							<Brand />
							<Dialog.Close asChild>
								<button type="button" aria-label="Cerrar menú" className="rounded-lg p-2 text-slate-300 hover:bg-white/10"><X className="size-5" /></button>
							</Dialog.Close>
						</div>
						<Dialog.Title className="sr-only">Menú principal</Dialog.Title>
						<Dialog.Description className="sr-only">Secciones del panel de Cobrix</Dialog.Description>
						<div className="no-scrollbar mt-8 flex-1 overflow-y-auto"><Navigation onNavigate={() => setDrawerOpen(false)} /></div>
						<CompanyFooter company={company} />
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>

			<div className="min-w-0 flex-1">
				<StatusStrip summary={summary.data} />
				<main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-12">
					<div className="mx-auto w-full max-w-[1200px]"><Outlet /></div>
				</main>
			</div>
		</div>
	)
}

/** Whether the ISP data is up to date, on every screen, with the way to fix it. */
function StatusStrip({ summary }: { summary: Summary | undefined }) {
	const { progress } = useRuns()
	const location = useLocation()
	if (!summary || location.pathname.startsWith('/bienvenida')) return null
	const lastFailed = summary.lastRuns.find(run => !run.dryRun)?.status === 'failed'
	const lastApplied = [summary.lastApplied.import, summary.lastApplied.paid]
		.filter((run): run is NonNullable<typeof run> => run !== null)
		.sort((a, b) => b.id - a.id)[0]
	const state = !summary.provider.configured
		? { dot: 'bg-slate-400', text: <><strong>Sistema del ISP sin conectar</strong> · conéctalo para traer clientes y facturas</>, action: { to: '/bienvenida', label: 'Conectar el ISP' } }
		: progress
			? { dot: 'bg-sky-500 animate-pulse', text: <><strong>Sincronizando…</strong> {progress.stage.toLowerCase()}</>, action: null }
			: lastFailed
				? { dot: 'bg-rose-500', text: <><strong>La última sincronización falló</strong> · revisa el detalle</>, action: { to: '/sincronizacion', label: 'Ver qué pasó' } }
				: lastApplied
					? { dot: 'bg-emerald-500', text: <><strong>Datos del ISP al día</strong> · última sincronización {dateTime(lastApplied.finishedAt ?? lastApplied.startedAt)}</>, action: { to: '/sincronizacion/revisar?que=todo', label: 'Sincronizar ahora' } }
					: { dot: 'bg-amber-500', text: <><strong>Todavía no se trajo nada del ISP</strong> · empieza con una vista previa</>, action: { to: '/sincronizacion/revisar?que=facturas', label: 'Ver vista previa' } }
	return (
		<div className="flex flex-col gap-2 border-b border-line bg-surface px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8 2xl:px-12">
			<p role="status" className="flex min-w-0 items-center gap-2 text-text/80">
				<span aria-hidden className={cn('size-2 shrink-0 rounded-full', state.dot)} />
				<span className="min-w-0">{state.text}</span>
			</p>
			{state.action && !location.pathname.startsWith('/sincronizacion/revisar') && (
				<Link to={state.action.to} className={cn(buttonVariants({ size: 'sm' }), 'shrink-0 self-start sm:self-auto')}>{state.action.label}</Link>
			)}
		</div>
	)
}

export function PageHeader({ title, description, back, actions, meta }: { title: ReactNode; description?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode; meta?: ReactNode }) {
	return (
		<div className="mb-6">
			{back && (
				<Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-primary">
					<ArrowLeft className="size-3.5" /> {back.label}
				</Link>
			)}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div className="min-w-0">
					<h1 className="text-[28px] font-bold leading-tight">{title}</h1>
					{description && <p className="mt-1 max-w-3xl text-[15px] text-muted">{description}</p>}
					{meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">{meta}</div>}
				</div>
				{actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
			</div>
		</div>
	)
}

/** A titled group of content inside a page: the unit that categorizes each screen. */
export function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
	return (
		<section className={cn('mt-8 first:mt-0', className)} aria-label={title}>
			<div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
				<div>
					<h2 className="text-[17px] font-semibold">{title}</h2>
					{description && <p className="text-[13px] text-muted">{description}</p>}
				</div>
				{actions && <div className="flex items-center gap-2">{actions}</div>}
			</div>
			{children}
		</section>
	)
}
