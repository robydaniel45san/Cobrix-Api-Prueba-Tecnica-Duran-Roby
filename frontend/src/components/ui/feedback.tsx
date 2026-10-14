import { AlertTriangle, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
	return <div aria-hidden className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />
}

/** An empty state that says what to do next. */
export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description: ReactNode; action?: ReactNode; className?: string }) {
	return (
		<div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
			<div className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary"><Icon className="size-5" /></div>
			<h3 className="mt-4 text-sm font-semibold">{title}</h3>
			<p className="mt-1 max-w-md text-sm text-muted">{description}</p>
			{action && <div className="mt-5">{action}</div>}
		</div>
	)
}

/** An error that says what happened and how to continue. */
export function ErrorNotice({ title = 'No se pudo cargar la información', message, action }: { title?: string; message: string; action?: ReactNode }) {
	return (
		<div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
			<AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" />
			<div className="min-w-0 flex-1">
				<p className="font-medium">{title}</p>
				<p className="mt-0.5 break-words text-rose-800">{message}</p>
				{action && <div className="mt-3">{action}</div>}
			</div>
		</div>
	)
}
