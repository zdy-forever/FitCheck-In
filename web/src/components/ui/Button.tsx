import { clsx } from 'clsx'
import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'glass' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

const variants: Record<Variant, string> = {
  primary:
    'sheen bg-accent text-accent-contrast shadow-[0_8px_24px_-10px_var(--accent)] hover:-translate-y-px hover:bg-accent-strong hover:shadow-[0_14px_30px_-10px_var(--accent)]',
  glass: 'sheen glass text-ink hover:-translate-y-px hover:brightness-[1.04]',
  secondary: 'bg-sunken text-ink border border-line hover:-translate-y-px hover:border-accent-ring hover:shadow-md',
  ghost: 'text-ink-2 hover:text-ink hover:bg-sunken',
  danger: 'bg-bad text-white hover:brightness-110',
}
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5 rounded-xl',
  md: 'h-11 px-5 text-md gap-2 rounded-2xl',
  lg: 'h-14 px-7 text-base gap-2.5 rounded-[20px]',
}

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra?: string) =>
  clsx(
    'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[transform,background-color,box-shadow,filter,color] duration-200 ease-out',
    'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
    variants[variant],
    sizes[size],
    extra,
  )

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})
