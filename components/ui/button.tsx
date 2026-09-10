import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg hover:opacity-90 disabled:opacity-40 border border-transparent',
  secondary:
    'bg-background text-foreground border border-border-strong hover:bg-surface-2 disabled:opacity-40',
  ghost:
    'bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-foreground',
  danger:
    'bg-bad text-white hover:opacity-90 disabled:opacity-40 border border-transparent',
}

export function Button({
  variant = 'secondary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-3 h-8 text-sm font-medium',
        'transition-[background-color,opacity] cursor-pointer disabled:cursor-not-allowed',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        VARIANTS[variant],
        className,
      )}
    />
  )
}
