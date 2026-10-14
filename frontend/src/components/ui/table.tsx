import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/** `wrapperClassName` controls the scroll container (e.g. `hidden md:block` when a mobile list replaces it). */
export function Table({ className, wrapperClassName, ...props }: HTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }) {
	return (
		<div className={cn('overflow-x-auto', wrapperClassName)}>
			<table className={cn('w-full border-collapse text-sm', className)} {...props} />
		</div>
	)
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
	return <th className={cn('whitespace-nowrap border-b border-line bg-canvas/70 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted', className)} {...props} />
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
	return <td className={cn('border-b border-line/70 px-4 py-3 align-top', className)} {...props} />
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
	return <tr className={cn('transition-colors last:[&>td]:border-b-0', className)} {...props} />
}
