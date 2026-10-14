/**
 * The story of a sync, told the same way in the preview, the result and the run detail:
 * tiles with the totals, then what gets paid, what stays open with a warning, what arrives,
 * what does not arrive (each reason in one sentence) and what needs attention.
 */

import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { Changes, CustomerChange, ReasonGroup } from '@/lib/changes'
import { money, plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from './ui/badge'
import { Card } from './ui/card'

type Mode = 'preview' | 'applied'

function Tile({ label, value, hint, tone }: { label: string; value: ReactNode; hint: string; tone: 'success' | 'warning' | 'info' | 'neutral' | 'review' }) {
	const tones = {
		success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
		warning: 'border-amber-200 bg-amber-50 text-amber-900',
		info: 'border-indigo-200 bg-primary-soft text-indigo-950',
		review: 'border-orange-200 bg-orange-50 text-orange-900',
		neutral: 'border-line bg-surface text-text',
	}
	return (
		<div className={cn('rounded-2xl border px-5 py-4', tones[tone])}>
			<p className="text-sm opacity-80">{label}</p>
			<p className="tabular mt-1 text-2xl font-semibold">{value}</p>
			<p className="mt-0.5 text-xs opacity-80">{hint}</p>
		</div>
	)
}

export function ChangeTiles({ changes, mode, kinds }: { changes: Changes; mode: Mode; kinds: ReadonlyArray<'import' | 'paid'> }) {
	const preview = mode === 'preview'
	return (
		<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
			{kinds.includes('paid') && (
				<Tile tone="success" label={preview ? 'Pasarían a pagadas' : 'Pasaron a pagadas'} value={changes.paidCount}
					hint={changes.paidCount ? `${money(changes.paidAmountCents)} cobrados en el ISP` : 'Sin cobros nuevos en el ISP'} />
			)}
			{kinds.includes('paid') && (
				<Tile tone="warning" label="Abono parcial" value={changes.partial.reduce((sum, group) => sum + group.items.length, 0)} hint="Siguen abiertas, con aviso" />
			)}
			{kinds.includes('import') && (
				<Tile tone="info" label={preview ? 'Facturas que llegarían' : 'Facturas nuevas'} value={changes.newCount}
					hint={changes.newCount ? `${money(changes.newAmountCents)}${changes.newCustomers ? ` · ${plural(changes.newCustomers, 'cliente nuevo', 'clientes nuevos')}` : ''}` : 'Todo lo del ISP ya está en Cobrix'} />
			)}
			{kinds.includes('import') && (
				<Tile tone="neutral" label="No se traen" value={changes.excludedCount} hint="Cada motivo, explicado abajo" />
			)}
			{changes.attentionCount > 0 && <Tile tone="review" label="Necesitan atención" value={changes.attentionCount} hint="Revisa los motivos abajo" />}
			<Tile tone="neutral" label="Sin cambios" value={changes.unchanged} hint={kinds.includes('paid') ? 'Siguen pendientes en el ISP' : 'Ya estaban en Cobrix'} />
		</div>
	)
}

function CustomerRows({ groups, amountTone, noteTone = 'text-muted' }: { groups: readonly CustomerChange[]; amountTone?: string; noteTone?: string }) {
	return (
		<ul className="divide-y divide-line/70">
			{groups.map(group => (
				<li key={group.customerName} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
					<div className="min-w-0 flex-[1_1_240px]">
						{group.customerId
							? <Link to={`/clientes/${encodeURIComponent(group.customerId)}`} className="font-medium hover:text-primary hover:underline">{group.customerName}</Link>
							: <span className="font-medium">{group.customerName}</span>}
						<p className="text-muted">{plural(group.items.length, 'factura', 'facturas')}{group.months && ` · ${group.months}`}</p>
						{group.note && <p className={cn('mt-0.5', noteTone)}>{group.note}</p>}
					</div>
					<span className={cn('tabular w-28 text-right font-medium', amountTone)}>{money(group.amountCents)}</span>
				</li>
			))}
		</ul>
	)
}

function ReasonRows({ groups }: { groups: readonly ReasonGroup[] }) {
	return (
		<ul className="divide-y divide-line/70">
			{groups.map(group => (
				<li key={group.result} className="px-5 py-3 text-sm">
					<p className="font-medium">{group.label} <span className="font-normal text-muted">· {plural(group.count, 'cuota', 'cuotas')}</span></p>
					<p className="mt-0.5 text-muted">{group.why}</p>
					<p className="mt-1 text-xs text-muted">{group.who}</p>
				</li>
			))}
		</ul>
	)
}

function Block({ title, description, children, collapsible = false, defaultOpen = true }: { title: string; description?: string; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
	const [open, setOpen] = useState(defaultOpen)
	const header = (
		<span className="min-w-0">
			<span className="block text-[15px] font-semibold">{title}</span>
			{description && <span className="mt-0.5 block text-sm text-muted">{description}</span>}
		</span>
	)
	return (
		<Card>
			{collapsible ? (
				<button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
					{header}
					<ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
				</button>
			) : <div className="px-5 py-4">{header}</div>}
			{open && <div className="border-t border-line">{children}</div>}
		</Card>
	)
}

/** The groups of changes, in the order an operator reads them. Empty groups are left out. */
export function ChangeSections({ changes, mode }: { changes: Changes; mode: Mode }) {
	const preview = mode === 'preview'
	return (
		<div className="space-y-4">
			{changes.paid.length > 0 && (
				<Block title={preview ? 'Pasarían a pagadas' : 'Pasaron a pagadas'} description="El ISP registró el cobro completo en su caja.">
					<CustomerRows groups={changes.paid} amountTone="text-emerald-700" />
				</Block>
			)}
			{changes.partial.length > 0 && (
				<Block title="Siguen abiertas, con aviso" description="Abonos parciales: la factura queda abierta hasta que el ISP la salde.">
					<CustomerRows groups={changes.partial} noteTone="text-amber-800" />
				</Block>
			)}
			{changes.newInvoices.length > 0 && (
				<Block title={preview ? 'Facturas que llegarían' : 'Facturas nuevas'} description="Cuotas pendientes en el ISP que pasan a Cobrix como facturas abiertas." collapsible defaultOpen={changes.newInvoices.length <= 8}>
					<CustomerRows groups={changes.newInvoices} />
				</Block>
			)}
			{changes.attention.length > 0 && (
				<Block title="Necesitan atención" description="No se aplicó nada sobre estas cuotas: hay que revisarlas.">
					<ReasonRows groups={changes.attention} />
				</Block>
			)}
			{changes.excluded.length > 0 && (
				<Block title={`${plural(changes.excludedCount, 'cuota del ISP no se trae', 'cuotas del ISP no se traen')}`} description="Cada motivo, en una frase." collapsible>
					<ReasonRows groups={changes.excluded} />
				</Block>
			)}
		</div>
	)
}

export function NoChanges({ preview }: { preview: boolean }) {
	return (
		<Card className="px-5 py-8 text-center">
			<Badge tone="success">Todo al día</Badge>
			<p className="mt-3 text-sm text-muted">{preview ? 'No hay nada que aplicar: Cobrix ya refleja lo que dice el ISP.' : 'No hubo cambios: Cobrix ya reflejaba lo que dice el ISP.'}</p>
		</Card>
	)
}
