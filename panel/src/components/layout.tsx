import { ArrowLeft, LayoutDashboard, Menu, RefreshCw, Settings, Users, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { api, type Company } from '@/lib/api'
import { useAsync, useSettingsVersion } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useRuns } from './runs'

const NAV = [
	{ to: '/', label: 'Resumen', icon: LayoutDashboard, end: true },
	{ to: '/clientes', label: 'Clientes', icon: Users, end: false },
	{ to: '/sincronizacion', label: 'Sincronización', icon: RefreshCw, end: false },
	{ to: '/configuracion', label: 'Configuración', icon: Settings, end: false },
]

function Brand() {
	return (
		<Link to="/" className="flex items-center gap-2.5">
			<span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">c</span>
			<span className="leading-tight">
				<span className="block text-[15px] font-semibold tracking-tight text-white">cobrix</span>
				<span className="block text-xs text-slate-400">Administrador de facturas</span>
			</span>
		</Link>
	)
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
	const { progress } = useRuns()
	return (
		<nav aria-label="Principal" className="flex flex-col gap-1">
			{NAV.map(({ to, label, icon: Icon, end }) => (
				<NavLink
					key={to}
					to={to}
					end={end}
					onClick={onNavigate}
					className={({ isActive }) => cn(
						'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
						isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white',
					)}
				>
					<Icon className="size-4" />
					<span className="flex-1">{label}</span>
					{to === '/sincronizacion' && progress && <span className="size-2 animate-pulse rounded-full bg-sky-400" aria-label="Corrida en curso" />}
				</NavLink>
			))}
		</nav>
	)
}

function CompanyFooter({ company }: { company: Company | undefined }) {
	const { connected } = useRuns()
	return (
		<div className="border-t border-white/10 pt-4 text-xs text-slate-400">
			<p className="truncate font-medium text-slate-200">{company?.name || 'Empresa sin configurar'}</p>
			{company?.rif && <p className="mt-0.5">{company.rif}</p>}
			<p className="mt-2 flex items-center gap-1.5">
				<span className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-slate-500')} />
				{connected ? 'Conectado al servidor' : 'Reconectando…'}
			</p>
		</div>
	)
}

export function Layout() {
	const [open, setOpen] = useState(false)
	const location = useLocation()
	const { version } = useRuns()
	const settingsVersion = useSettingsVersion()
	const settings = useAsync(() => api.settings(), [version, settingsVersion])
	useEffect(() => setOpen(false), [location.pathname])

	return (
		<div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
			<aside className="hidden flex-col gap-8 bg-ink-950 px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-dvh">
				<Brand />
				<div className="flex-1"><Navigation /></div>
				<CompanyFooter company={settings.data?.company} />
			</aside>

			<header className="sticky top-0 z-30 flex items-center justify-between bg-ink-950 px-4 py-3 lg:hidden">
				<Brand />
				<button type="button" aria-label={open ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={open} onClick={() => setOpen(value => !value)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10">
					{open ? <X className="size-5" /> : <Menu className="size-5" />}
				</button>
			</header>
			{open && (
				<div className="fixed inset-x-0 top-[56px] z-20 border-b border-white/10 bg-ink-950 px-4 pb-4 lg:hidden">
					<Navigation onNavigate={() => setOpen(false)} />
				</div>
			)}

			<main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
				<div className="mx-auto max-w-[1180px]"><Outlet /></div>
			</main>
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
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div className="min-w-0">
					<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
					{description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
					{meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">{meta}</div>}
				</div>
				{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
			</div>
		</div>
	)
}

export function StatCard({ label, value, hint, tone, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'primary' | 'success' | 'warning'; className?: string }) {
	return (
		<div className={cn(
			'rounded-xl border bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgb(16_24_40/0.04)]',
			tone === 'primary' ? 'border-primary/30 bg-primary-soft/40' : 'border-line',
			className,
		)}>
			<p className="text-xs font-medium text-muted">{label}</p>
			<p className={cn('tabular mt-1 text-xl font-semibold tracking-tight sm:text-2xl',
				tone === 'success' && 'text-emerald-700', tone === 'warning' && 'text-amber-700', tone === 'primary' && 'text-primary')}>{value}</p>
			{hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
		</div>
	)
}
