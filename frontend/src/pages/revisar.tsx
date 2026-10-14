/**
 * «Revisa los cambios antes de aplicarlos». The simulation is the first step of every sync:
 * this screen runs the preview (the «Simular» of the assignment), explains the changes, and only
 * then lets the operator apply them. `?que=` chooses what to sync:
 *   todo     new invoices, then the ISP's collections (the daily sync)
 *   facturas only new invoices   (Importar + Simular importación)
 *   cobros   only collections    (Actualizar pagadas + Simular)
 */

import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { ChangeSections, ChangeTiles, NoChanges } from '@/components/changes'
import { PageHeader } from '@/components/layout'
import { LiveRun } from '@/components/runs'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { ErrorNotice, Skeleton } from '@/components/ui/feedback'
import type { RunKind } from '@/lib/api'
import { changesOf, runAndWait, type RunWithItems } from '@/lib/changes'
import { money, plural } from '@/lib/format'
import { KIND_ACTION } from '@/lib/vocabulary'

const SCOPES: Record<string, { title: string; kinds: RunKind[] }> = {
	todo: { title: 'Sincronizar todo', kinds: ['import', 'paid'] },
	facturas: { title: KIND_ACTION.import, kinds: ['import'] },
	cobros: { title: KIND_ACTION.paid, kinds: ['paid'] },
}

type Phase = { name: 'previewing' } | { name: 'ready'; runs: RunWithItems[] } | { name: 'applying'; runs: RunWithItems[] } | { name: 'error'; message: string; runId?: number }

export function RevisarPage() {
	const [params] = useSearchParams()
	const scope = SCOPES[params.get('que') ?? 'todo'] ?? (SCOPES.todo as (typeof SCOPES)[string])
	const navigate = useNavigate()
	const [phase, setPhase] = useState<Phase>({ name: 'previewing' })
	const started = useRef(false)

	useEffect(() => {
		// Strict mode mounts twice in development: the preview must run once.
		if (started.current) return
		started.current = true
		void (async () => {
			try {
				const runs: RunWithItems[] = []
				for (const kind of scope.kinds) {
					const run = await runAndWait(kind, true)
					if (run.status === 'failed') {
						setPhase({ name: 'error', message: run.error ?? 'La vista previa falló.', runId: run.id })
						return
					}
					runs.push(run)
				}
				setPhase({ name: 'ready', runs })
			} catch (error) {
				setPhase({ name: 'error', message: error instanceof Error ? error.message : 'No se pudo preparar la vista previa.' })
			}
		})()
	}, [scope])

	const apply = async (previews: RunWithItems[]) => {
		setPhase({ name: 'applying', runs: previews })
		try {
			const ids: number[] = []
			for (const kind of scope.kinds) {
				const run = await runAndWait(kind, false)
				ids.push(run.id)
				if (run.status === 'failed') break
			}
			navigate(`/sincronizacion/listo?corridas=${ids.join(',')}`)
		} catch (error) {
			setPhase({ name: 'error', message: error instanceof Error ? error.message : 'No se pudieron aplicar los cambios.' })
		}
	}

	const header = (
		<PageHeader
			back={{ to: '/sincronizacion', label: 'Sincronización' }}
			title="Revisa los cambios antes de aplicarlos"
			description={`${scope.title}. Esto es una vista previa: Cobrix todavía no cambió nada.`}
			meta={<Badge tone="info">Vista previa</Badge>}
		/>
	)

	if (phase.name === 'error') {
		return (
			<>
				{header}
				<ErrorNotice
					title="No se pudo completar la vista previa"
					message={phase.message}
					action={<div className="flex flex-wrap gap-3">
						<Link to="/configuracion" className="font-medium underline">Revisar la configuración</Link>
						{phase.runId && <Link to={`/sincronizacion/${phase.runId}`} className="font-medium underline">Ver el detalle</Link>}
					</div>}
				/>
			</>
		)
	}

	if (phase.name === 'previewing') {
		return (
			<>
				{header}
				<LiveRun className="mb-6" />
				<div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-48" /></div>
			</>
		)
	}

	const changes = changesOf(phase.runs)
	const nothing = changes.newCount === 0 && changes.paidCount === 0
	const applying = phase.name === 'applying'
	const effects = [
		changes.newCount ? `${plural(changes.newCount, 'factura nueva', 'facturas nuevas')} por ${money(changes.newAmountCents)}` : '',
		changes.paidCount ? `${plural(changes.paidCount, 'factura pasa', 'facturas pasan')} a pagadas` : '',
	].filter(Boolean)

	return (
		<>
			{header}
			{applying && <LiveRun className="mb-6" />}
			<ChangeTiles changes={changes} mode="preview" kinds={scope.kinds} />
			<div className="mt-6">{nothing && changes.partial.length === 0 ? <NoChanges preview /> : <ChangeSections changes={changes} mode="preview" />}</div>
			<p className="mt-4 text-sm text-muted">
				Detalle técnico de la vista previa:{' '}
				{phase.runs.map((run, index) => (
					<span key={run.id}>{index > 0 && ' · '}<Link to={`/sincronizacion/${run.id}`} className="text-primary hover:underline">#{run.id}</Link></span>
				))}
			</p>

			{/* The decision, always at hand. */}
			<div className="sticky bottom-0 z-10 -mx-4 mt-8 flex flex-col gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:flex-row sm:items-center sm:px-6 lg:-mx-8 lg:px-8">
				<p className="text-sm text-muted sm:mr-auto">
					{nothing ? 'No hay cambios para aplicar.' : <>Al aplicar: {effects.join(' y ')}. Nada más cambia.</>}
				</p>
				<Link to="/sincronizacion" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>{nothing ? 'Volver' : 'Cancelar'}</Link>
				{!nothing && (
					<Button size="lg" disabled={applying} onClick={() => void apply(phase.runs)}>
						{applying && <Loader2 className="animate-spin" />}{applying ? 'Aplicando…' : 'Aplicar cambios'}
					</Button>
				)}
			</div>
		</>
	)
}
