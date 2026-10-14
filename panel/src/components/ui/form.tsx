import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const control =
	'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15 disabled:bg-canvas aria-[invalid=true]:border-rose-400 aria-[invalid=true]:ring-rose-100'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
	<input ref={ref} className={cn(control, className)} {...props} />
))
Input.displayName = 'Input'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
	<select ref={ref} className={cn(control, 'pr-8', className)} {...props} />
))
Select.displayName = 'Select'

/** Label, hint and error around one control. The control receives the ids it needs for accessibility. */
export function Field({ label, hint, error, children, className }: {
	label: ReactNode
	hint?: ReactNode
	error?: string
	children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
	className?: string
}) {
	const id = useId()
	const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
	return (
		<div className={cn('flex flex-col gap-1.5', className)}>
			<label htmlFor={id} className="text-sm font-medium">{label}</label>
			{children({ id, 'aria-invalid': Boolean(error), ...(describedBy ? { 'aria-describedby': describedBy } : {}) })}
			{hint && !error && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
			{error && <p id={`${id}-error`} className="text-xs font-medium text-rose-600">{error}</p>}
		</div>
	)
}

export function CheckboxPill({ checked, onChange, children, disabled }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; disabled?: boolean }) {
	return (
		<label className={cn(
			'inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
			checked ? 'border-primary/40 bg-primary-soft text-primary' : 'border-line bg-surface text-text hover:bg-canvas',
			disabled && 'cursor-not-allowed opacity-50',
		)}>
			<input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
			{children}
		</label>
	)
}
