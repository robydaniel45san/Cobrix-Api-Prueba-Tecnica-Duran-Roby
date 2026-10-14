import type { ReactNode } from 'react'

import type { Tone } from '@/lib/vocabulary'
import { cn } from '@/lib/utils'

const TONES: Record<Tone, string> = {
	neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
	muted: 'bg-slate-50 text-slate-500 ring-slate-200',
	success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
	warning: 'bg-amber-50 text-amber-800 ring-amber-200',
	danger: 'bg-rose-50 text-rose-700 ring-rose-200',
	info: 'bg-sky-50 text-sky-700 ring-sky-200',
	review: 'bg-orange-50 text-orange-700 ring-orange-200',
}

const DOTS: Record<Tone, string> = {
	neutral: 'bg-slate-400', muted: 'bg-slate-300', success: 'bg-emerald-500', warning: 'bg-amber-500',
	danger: 'bg-rose-500', info: 'bg-sky-500', review: 'bg-orange-500',
}

export function Badge({ tone = 'neutral', children, dot = true, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
	return (
		<span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
			{dot && <span aria-hidden className={cn('size-1.5 rounded-full', DOTS[tone])} />}
			{children}
		</span>
	)
}
