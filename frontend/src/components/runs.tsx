/**
 * Syncs across the panel: one Server-Sent Events connection shared by every screen, the entry
 * points to the review flow, the live progress of the sync in flight and one-line summaries.
 */

import { Download, Loader2, RefreshCcw, RefreshCw } from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import type { Progress, Run, RunKind } from '@/lib/api'
import { money, plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { KIND_ACTION, KIND_LABEL } from '@/lib/vocabulary'
import { Badge } from './ui/badge'
import { buttonVariants } from './ui/button'

interface RunsContextValue {
	progress: Progress | null
	/** Increments after every finished sync: screens use it to reload. */
	version: number
	connected: boolean
}

const RunsContext = createContext<RunsContextValue | null>(null)

export function useRuns(): RunsContextValue {
	const value = useContext(RunsContext)
	if (!value) throw new Error('useRuns fuera de RunsProvider')
	return value
}

/** One line for a sync, in the operator's words. */
export function runSummary(run: Pick<Run, 'kind' | 'dryRun' | 'counters' | 'status' | 'error'>): string {
	if (run.status === 'failed') return run.error ?? 'Falló.'
	if (run.status === 'running') return 'En curso…'
	const c = (key: string) => run.counters[key] ?? 0
	if (run.kind === 'import') {
		const count = run.dryRun ? c('installmentsWouldImport') : c('installmentsImported')
		const amount = run.dryRun ? c('amountWouldImportCents') : c('amountImportedCents')
		const customers = run.dryRun ? c('customersWouldCreate') : c('customersCreated')
		const excluded = c('installmentsExcludedByStatus') + c('installmentsExcludedByCurrency') + c('installmentsZeroAmount') + c('installmentsExcludedByWindow')
			+ c('installmentsExcludedByRecentLimit') + c('installmentsExcludedByIdentifierType') + c('installmentsIndeterminate')
		const parts = [count
			? `${run.dryRun ? 'Llegarían' : 'Llegaron'} ${plural(count, 'factura', 'facturas')} por ${money(amount)}${customers ? ` (${plural(customers, 'cliente nuevo', 'clientes nuevos')})` : ''}`
			: 'Sin facturas nuevas']
		if (excluded) parts.push(`${plural(excluded, 'cuota no se trae', 'cuotas no se traen')}`)
		if (c('installmentsBlockedByLimit')) parts.push(`${c('installmentsBlockedByLimit')} frenadas por tope`)
		if (c('contractsFailed')) parts.push(plural(c('contractsFailed'), 'contrato sin respuesta', 'contratos sin respuesta'))
		return parts.join(' · ')
	}
	const paid = run.dryRun ? c('invoicesWouldMarkPaid') : c('invoicesMarkedPaid')
	const amount = run.dryRun ? c('amountWouldMarkPaidCents') : c('amountMarkedPaidCents')
	const parts = [paid ? `${run.dryRun ? 'Se pagarían' : 'Pagadas'} ${plural(paid, 'factura', 'facturas')} por ${money(amount)}` : 'Sin cobros nuevos']
	if (c('invoicesPartiallyPaidAtIsp')) parts.push(plural(c('invoicesPartiallyPaidAtIsp'), 'abono parcial', 'abonos parciales'))
	if (c('invoicesUnderReview') + c('invoicesUnknown')) parts.push(`${c('invoicesUnderReview') + c('invoicesUnknown')} para revisar`)
	if (c('lookupsFailed')) parts.push(plural(c('lookupsFailed'), 'consulta fallida', 'consultas fallidas'))
	return parts.join(' · ')
}

export function RunsProvider({ children }: { children: ReactNode }) {
	const [progress, setProgress] = useState<Progress | null>(null)
	const [version, setVersion] = useState(0)
	const [connected, setConnected] = useState(false)
	const navigate = useNavigate()
	const navigateRef = useRef(navigate)
	navigateRef.current = navigate

	useEffect(() => {
		const source = new EventSource('/api/events')
		source.addEventListener('open', () => setConnected(true))
		source.addEventListener('error', () => setConnected(false))
		source.addEventListener('hello', event => setProgress(JSON.parse((event as MessageEvent).data).inProgress))
		source.addEventListener('progress', event => setProgress(JSON.parse((event as MessageEvent).data)))
		source.addEventListener('finished', event => {
			const outcome = JSON.parse((event as MessageEvent).data) as { runId: number; kind: RunKind; dryRun: boolean; status: string; error?: string }
			setProgress(null)
			setVersion(value => value + 1)
			// Results are shown on screen by the review flow; a toast is only for failures.
			if (outcome.status === 'failed') {
				toast.error(`${KIND_LABEL[outcome.kind]}${outcome.dryRun ? ' (vista previa)' : ''}: no se pudo completar`, {
					description: outcome.error,
					action: { label: 'Ver detalle', onClick: () => navigateRef.current(`/sincronizacion/${outcome.runId}`) },
					duration: 12_000,
				})
			}
		})
		return () => source.close()
	}, [])

	const value = useMemo(() => ({ progress, version, connected }), [progress, version, connected])
	return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>
}

/** Entry points to the review flow. Every one starts with a preview; nothing is applied without review. */
export function SyncActions({ layout = 'row' }: { layout?: 'row' | 'stack' }) {
	const { progress } = useRuns()
	const busy = progress !== null
	const disabled = busy ? 'pointer-events-none opacity-50' : ''
	return (
		<div className={cn('flex gap-2', layout === 'stack' ? 'flex-col' : 'flex-wrap')} aria-disabled={busy}>
			<Link to="/sincronizacion/revisar?que=todo" className={cn(buttonVariants({ size: 'lg' }), disabled)}><RefreshCw /> Sincronizar todo</Link>
			<Link to="/sincronizacion/revisar?que=facturas" className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), disabled)}><Download /> {KIND_ACTION.import}</Link>
			<Link to="/sincronizacion/revisar?que=cobros" className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), disabled)}><RefreshCcw /> {KIND_ACTION.paid}</Link>
		</div>
	)
}

/** Live progress of the sync in flight (shared through SSE, also visible from another tab). */
export function LiveRun({ className }: { className?: string }) {
	const { progress } = useRuns()
	if (!progress) return null
	const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
	return (
		<div role="status" aria-live="polite" className={cn('rounded-xl border border-primary/25 bg-primary-soft/60 p-4', className)}>
			<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
				<span className="flex items-center gap-2 font-medium text-primary">
					<Loader2 className="size-4 animate-spin" />
					{KIND_LABEL[progress.kind]}{progress.dryRun && ' · vista previa'}
				</span>
				<span className="tabular text-muted">{progress.stage}{progress.total > 0 && ` · ${progress.done} de ${progress.total} contratos`}</span>
			</div>
			<div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
				<div className={cn('progress-live h-full rounded-full bg-primary transition-[width] duration-300', progress.total === 0 && 'w-1/12')} style={progress.total > 0 ? { width: `${Math.max(percent, 3)}%` } : undefined} />
			</div>
		</div>
	)
}

export function RunStatusBadge({ run }: { run: Pick<Run, 'status' | 'warnings' | 'dryRun'> }) {
	if (run.status === 'running') return <Badge tone="info">En curso</Badge>
	if (run.status === 'failed') return <Badge tone="danger">Falló</Badge>
	if (run.warnings > 0) return <Badge tone="warning">{run.dryRun ? 'Vista previa con avisos' : 'Aplicada con avisos'}</Badge>
	return run.dryRun ? <Badge tone="info">Vista previa</Badge> : <Badge tone="success">Aplicada</Badge>
}
