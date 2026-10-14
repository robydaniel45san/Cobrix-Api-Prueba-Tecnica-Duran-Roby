import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <section className={cn('rounded-2xl border border-line bg-surface', className)} {...props} />
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
	return (
		<header className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
			<div className="min-w-0">
				<h2 className="text-[15px] font-semibold">{title}</h2>
				{description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
			</div>
			{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
		</header>
	)
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn('px-5 py-4', className)} {...props} />
}
