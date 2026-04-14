import { cn } from '@/lib/utils'

export function Card({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				'rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50',
				className,
			)}
			{...props}
		/>
	)
}

export function Button({
	className,
	variant = 'default',
	size = 'default',
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: 'default' | 'outline' | 'ghost' | 'destructive'
	size?: 'default' | 'sm' | 'lg'
}) {
	const variants = {
		default:
			'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200',
		outline:
			'border border-zinc-200 bg-white hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:hover:text-zinc-50',
		ghost: 'hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50',
		destructive:
			'bg-red-500 text-zinc-50 hover:bg-red-600 dark:bg-red-900 dark:text-zinc-50 dark:hover:bg-red-800',
	}
	const sizes = {
		default: 'h-10 px-4 py-2',
		sm: 'h-9 rounded-md px-3',
		lg: 'h-11 rounded-md px-8',
	}

	return (
		<button
			className={cn(
				'inline-flex items-center justify-center rounded-md font-medium text-sm transition-all transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-zinc-300',
				variants[variant],
				sizes[size],
				className,
			)}
			{...props}
		/>
	)
}

export function Skeleton({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				'animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800',
				className,
			)}
			{...props}
		/>
	)
}
