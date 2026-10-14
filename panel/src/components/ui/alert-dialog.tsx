import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import type { ReactNode } from 'react'

import { Button } from './button'

/** Confirmation before an action that writes data. Built on Radix: focus trap, Escape, screen readers. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, tone = 'primary', children }: {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: string
	description: ReactNode
	confirmLabel: string
	onConfirm: () => void
	tone?: 'primary' | 'danger'
	children?: ReactNode
}) {
	return (
		<AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<AlertDialogPrimitive.Portal>
				<AlertDialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink-950/40 backdrop-blur-[2px]" />
				<AlertDialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-6 shadow-xl">
					<AlertDialogPrimitive.Title className="text-base font-semibold">{title}</AlertDialogPrimitive.Title>
					<AlertDialogPrimitive.Description asChild>
						<div className="mt-2 text-sm leading-relaxed text-muted">{description}</div>
					</AlertDialogPrimitive.Description>
					{children}
					<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<AlertDialogPrimitive.Cancel asChild>
							<Button variant="secondary">Cancelar</Button>
						</AlertDialogPrimitive.Cancel>
						<AlertDialogPrimitive.Action asChild>
							<Button variant={tone} onClick={onConfirm}>{confirmLabel}</Button>
						</AlertDialogPrimitive.Action>
					</div>
				</AlertDialogPrimitive.Content>
			</AlertDialogPrimitive.Portal>
		</AlertDialogPrimitive.Root>
	)
}
