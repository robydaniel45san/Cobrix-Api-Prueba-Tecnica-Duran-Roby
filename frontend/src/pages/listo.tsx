/** After applying a sync: what changed, in one sentence, and the same breakdown as the preview. */

import { CheckCircle2, CircleAlert } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { ChangeSections, ChangeTiles, NoChanges } from '@/components/changes'
import { buttonVariants } from '@/components/ui/button'
import { ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { api, type RunKind } from '@/lib/api'
import { changesOf, type Changes } from '@/lib/changes'
import { money, plural } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { KIND_LABEL } from '@/lib/vocabulary'

function headline(changes: Changes): string {
	if (changes.paidCount && changes.newCount) return `Listo: ${plural(changes.newCount, 'factura nueva', 'facturas nuevas')} y ${plural(changes.paidCount, 'pagada', 'pagadas')}`
	if (changes.paidCount) return `Listo: ${plural(changes.paidCount, 'factura pasó', 'facturas pasaron')} a pagadas`
	if (changes.newCount) return `Listo: ${plural(changes.newCount, 'factura nueva', 'facturas nuevas')} de ${plural(changes.newCustomers, 'cliente', 'clientes')}`
	return 'Listo: no hubo cambios'
}

export function ListoPage() {
	const [params] = useSearchParams()
	const ids = (params.get('corridas') ?? '').split(',').map(Number).filter(Number.isInteger).filter(id => id > 0)
	const { data, error, loading } = useAsync(async () => {
		const [runs, summary] = await Promise.all([Promise.all(ids.map(id => api.run(id))), api.summary()])
		return { runs, summary }
	}, [params.get('corridas')])

	if (error) return <ErrorNotice message={error.message} action={<Link to="/sincronizacion" className="font-medium underline">Ir a Sincronización</Link>} />
	if (loading || !data) return <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-48" /></div>

	const failed = data.runs.find(run => run.status === 'failed')
	const changes = changesOf(data.runs.filter(run => run.status === 'completed'))
	const kinds = data.runs.map(run => run.kind) as RunKind[]

	return (
		<>
			<section className={cn('mb-6 flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center', failed ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50')}>
				{failed ? <CircleAlert className="size-10 shrink-0 text-rose-600" /> : <CheckCircle2 className="size-10 shrink-0 text-emerald-600" />}
				<div className="min-w-0 flex-1">
					<h1 className={cn('text-xl font-semibold', failed ? 'text-rose-900' : 'text-emerald-950')}>
						{failed ? `${KIND_LABEL[failed.kind]}: no se pudo completar` : headline(changes)}
					</h1>
					<p className={cn('mt-1 text-sm', failed ? 'text-rose-800' : 'text-emerald-900/80')}>
						{failed
							? `${failed.error ?? 'Error desconocido.'} No se modificó ningún dato de esta sincronización.`
							: `Quedan ${plural(data.summary.openInvoices, 'factura abierta', 'facturas abiertas')} por ${money(data.summary.openAmountCents)}.${changes.partial.length ? ' Hay abonos parciales con aviso.' : ''}`}
					</p>
				</div>
				<Link to="/" className={buttonVariants({ size: 'lg' })}>Volver al inicio</Link>
			</section>

			<ChangeTiles changes={changes} mode="applied" kinds={kinds} />
			<div className="mt-6">{changes.newCount === 0 && changes.paidCount === 0 && changes.partial.length === 0 ? <NoChanges preview={false} /> : <ChangeSections changes={changes} mode="applied" />}</div>
			<p className="mt-4 text-sm text-muted">
				Detalle completo:{' '}
				{data.runs.map((run, index) => (
					<span key={run.id}>{index > 0 && ' · '}<Link to={`/sincronizacion/${run.id}`} className="text-primary hover:underline">{KIND_LABEL[run.kind]} #{run.id}</Link></span>
				))}
			</p>
		</>
	)
}
