/**
 * Runs across the panel: one Server-Sent Events connection shared by every screen, the launch
 * flow with its confirmation, and the live progress of the run in flight.
 */

import { CheckCircle2, CircleAlert, FlaskConical, Loader2, RefreshCcw, Download } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { api, ApiError, type Progress, type Run, type RunKind } from '@/lib/api'
import { money, plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { KIND_LABEL } from '@/lib/vocabulary'
import { Badge } from './ui/badge'
import { ConfirmDialog } from './ui/alert-dialog'
import { Button } from './ui/button'

interface Finished {
	runId: number
	kind: RunKind
	dryRun: boolean
	status: 'completed' | 'failed'
	counters: Record<string, number>
	error?: string
}

interface RunsContextValue {
	progress: Progress | null
	/** Increments after every finished run: screens use it to reload. */
	version: number
	lastFinished: Finished | null
	connected: boolean
	launch: (kind: RunKind, dryRun: boolean) => Promise<void>
}

const RunsContext = createContext<RunsContextValue | null>(null)

export function useRuns(): RunsContextValue {
	const value = useContext(RunsContext)
	if (!value) throw new Error('useRuns fuera de RunsProvider')
	return value
}

/** One-line result for a toast or a list. */
export function runSummary(kind: RunKind, dryRun: boolean, counters: Record<string, number>): string {
	const c = (key: string) => counters[key] ?? 0
	if (kind === 'import') {
		const created = dryRun ? c('installmentsWouldImport') : c('installmentsImported')
		const amount = dryRun ? c('amountWouldImportCents') : c('amountImportedCents')
		const parts = [`${plural(created, dryRun ? 'factura se importaría' : 'factura importada', dryRun ? 'facturas se importarían' : 'facturas importadas')}${created ? ` por ${money(amount)}` : ''}`]
		if (c('installmentsAlreadyImported')) parts.push(`${c('installmentsAlreadyImported')} ya importadas`)
		const excluded = c('installmentsExcludedByStatus') + c('installmentsExcludedByCurrency') + c('installmentsZeroAmount') + c('installmentsExcludedByWindow') + c('installmentsExcludedByRecentLimit') + c('installmentsExcludedByIdentifierType') + c('installmentsIndeterminate')
		if (excluded) parts.push(`${excluded} excluidas`)
		if (c('installmentsBlockedByLimit')) parts.push(`${c('installmentsBlockedByLimit')} frenadas por tope`)
		if (c('contractsFailed')) parts.push(`${plural(c('contractsFailed'), 'contrato sin respuesta', 'contratos sin respuesta')}`)
		return parts.join(' · ')
	}
	const paid = dryRun ? c('invoicesWouldMarkPaid') : c('invoicesMarkedPaid')
	const parts = [plural(paid, dryRun ? 'se marcaría pagada' : 'marcada pagada', dryRun ? 'se marcarían pagadas' : 'marcadas pagadas')]
	if (c('invoicesPartiallyPaidAtIsp')) parts.push(plural(c('invoicesPartiallyPaidAtIsp'), 'abono parcial', 'abonos parciales'))
	parts.push(`${c('invoicesStillOpen')} siguen pendientes`)
	if (c('invoicesUnderReview')) parts.push(`${c('invoicesUnderReview')} en revisión`)
	if (c('invoicesUnknown')) parts.push(`${c('invoicesUnknown')} sin evidencia`)
	if (c('lookupsFailed')) parts.push(`${plural(c('lookupsFailed'), 'consulta fallida', 'consultas fallidas')}`)
	return parts.join(' · ')
}

export function RunsProvider({ children }: { children: ReactNode }) {
	const [progress, setProgress] = useState<Progress | null>(null)
	const [version, setVersion] = useState(0)
	const [lastFinished, setLastFinished] = useState<Finished | null>(null)
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
			const outcome = JSON.parse((event as MessageEvent).data) as Finished
			setProgress(null)
			setLastFinished(outcome)
			setVersion(value => value + 1)
			const title = `${KIND_LABEL[outcome.kind]}${outcome.dryRun ? ' (simulación)' : ''} #${outcome.runId}`
			const open = { label: 'Ver detalle', onClick: () => navigateRef.current(`/sincronizacion/${outcome.runId}`) }
			if (outcome.status === 'failed') {
				toast.error(`${title} falló`, { description: outcome.error, action: open, duration: 12_000 })
			} else {
				toast.success(`${title} completada`, { description: runSummary(outcome.kind, outcome.dryRun, outcome.counters), action: open, duration: 8_000 })
			}
		})
		return () => source.close()
	}, [])

	const launch = useCallback(async (kind: RunKind, dryRun: boolean) => {
		try {
			const { runId } = await api.launch(kind, dryRun)
			setProgress(current => current ?? { runId, kind, dryRun, done: 0, total: 0, stage: 'Iniciando' })
		} catch (error) {
			const message = error instanceof ApiError ? error.message : 'No se pudo iniciar la corrida.'
			toast.error('No se inició la corrida', { description: message })
		}
	}, [])

	const value = useMemo(() => ({ progress, version, lastFinished, connected, launch }), [progress, version, lastFinished, connected, launch])
	return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>
}

const ACTIONS: Record<RunKind, { title: string; confirm: string; describe: string; icon: typeof Download }> = {
	import: {
		title: 'Importar clientes y facturas',
		confirm: 'Importar',
		describe: 'Se leerán todos los contratos del administrador y se crearán en Cobrix las facturas abiertas y los clientes que correspondan según la configuración. Las cuotas ya importadas no se duplican.',
		icon: Download,
	},
	paid: {
		title: 'Actualizar pagadas',
		confirm: 'Actualizar pagadas',
		describe: 'Se revisará cada factura abierta contra el libro de cuotas del administrador. Solo se marcan pagadas las cuotas saldadas por completo; un abono parcial se informa y la factura sigue abierta.',
		icon: RefreshCcw,
	},
}

/** «Importar» / «Actualizar pagadas» with confirmation, plus its «Simular» companion. */
export function RunActions({ kind, compact = false }: { kind: RunKind; compact?: boolean }) {
	const { progress, launch } = useRuns()
	const [confirming, setConfirming] = useState(false)
	const busy = progress !== null
	const action = ACTIONS[kind]
	const Icon = action.icon
	return (
		<div className={cn('flex flex-wrap gap-2', compact && 'gap-1.5')}>
			<Button size={compact ? 'sm' : 'md'} disabled={busy} onClick={() => setConfirming(true)}>
				<Icon /> {action.confirm}
			</Button>
			<Button size={compact ? 'sm' : 'md'} variant="secondary" disabled={busy} onClick={() => void launch(kind, true)}
				aria-label={kind === 'import' ? 'Simular importación (no escribe nada)' : 'Simular actualización de pagadas (no escribe nada)'}>
				<FlaskConical /> Simular
			</Button>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={`¿${action.title}?`}
				description={<>{action.describe}<p className="mt-2">Si tienes dudas, usa primero <strong>Simular</strong>: muestra el mismo resultado sin modificar nada.</p></>}
				confirmLabel={action.confirm}
				onConfirm={() => void launch(kind, false)}
			/>
		</div>
	)
}

/** Live progress of the run in flight (shared through SSE, also visible from another tab). */
export function LiveRun({ className }: { className?: string }) {
	const { progress, lastFinished } = useRuns()
	if (!progress && !lastFinished) return null
	if (progress) {
		const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
		return (
			<div role="status" aria-live="polite" className={cn('rounded-xl border border-primary/25 bg-primary-soft/60 p-4', className)}>
				<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
					<span className="flex items-center gap-2 font-medium text-primary">
						<Loader2 className="size-4 animate-spin" />
						{KIND_LABEL[progress.kind]} #{progress.runId}
						{progress.dryRun && <Badge tone="info">Simulación</Badge>}
					</span>
					<span className="tabular text-muted">
						{progress.stage}{progress.total > 0 && ` · ${progress.done} de ${progress.total} contratos`}
					</span>
				</div>
				<div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
					<div className={cn('progress-live h-full rounded-full bg-primary transition-[width] duration-300', progress.total === 0 && 'w-1/12')} style={progress.total > 0 ? { width: `${Math.max(percent, 3)}%` } : undefined} />
				</div>
			</div>
		)
	}
	const finished = lastFinished as Finished
	const failed = finished.status === 'failed'
	return (
		<div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm', failed ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50', className)}>
			<div className="flex min-w-0 items-start gap-2">
				{failed ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-600" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
				<div className="min-w-0">
					<p className="font-medium">
						{KIND_LABEL[finished.kind]}{finished.dryRun && ' (simulación)'} #{finished.runId} {failed ? 'falló' : 'completada'}
					</p>
					<p className={cn('mt-0.5 break-words', failed ? 'text-rose-800' : 'text-emerald-900/80')}>
						{failed ? finished.error : runSummary(finished.kind, finished.dryRun, finished.counters)}
					</p>
				</div>
			</div>
			<Link to={`/sincronizacion/${finished.runId}`} className="text-sm font-medium text-primary hover:underline">Ver detalle</Link>
		</div>
	)
}

export function RunStatusBadge({ run }: { run: Pick<Run, 'status' | 'warnings'> }) {
	if (run.status === 'running') return <Badge tone="info">En curso</Badge>
	if (run.status === 'failed') return <Badge tone="danger">Fallida</Badge>
	if (run.warnings > 0) return <Badge tone="warning">Completada con avisos</Badge>
	return <Badge tone="success">Completada</Badge>
}
