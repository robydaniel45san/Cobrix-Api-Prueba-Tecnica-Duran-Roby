import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
	{
		variants: {
			variant: {
				primary: 'bg-primary text-white shadow-sm hover:bg-primary-hover',
				secondary: 'border border-line bg-surface text-text shadow-sm hover:bg-canvas',
				ghost: 'text-muted hover:bg-canvas hover:text-text',
				danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700',
				link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
			},
			size: {
				sm: 'h-8 px-3',
				md: 'h-9 px-4',
				lg: 'h-10 px-5',
				icon: 'size-9',
			},
		},
		defaultVariants: { variant: 'primary', size: 'md' },
	},
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = 'button', ...props }, ref) => (
	<button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
))
Button.displayName = 'Button'
