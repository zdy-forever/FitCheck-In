import { clsx } from 'clsx'
import { AlertCircle } from 'lucide-react'
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

const control =
  'w-full rounded-xl border bg-surface-strong px-3.5 text-[15px] text-ink placeholder:text-ink-3 transition-colors outline-none focus:border-accent focus:ring-4 focus:ring-accent-soft disabled:opacity-60'

interface FieldShellProps {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  optionalLabel?: string
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
  className?: string
}

export function FieldShell({ label, hint, error, optionalLabel, children, className }: FieldShellProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-sm font-medium text-ink">
        <span>{label}</span>
        {optionalLabel && <span className="text-xs font-normal text-ink-3">{optionalLabel}</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="flex items-center gap-1 text-xs font-medium text-bad">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: string | null; optionalLabel?: string }
export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField({ label, hint, error, optionalLabel, className, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} optionalLabel={optionalLabel} className={className}>
      {({ id, describedBy, invalid }) => (
        <input ref={ref} id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={clsx(control, 'h-11', invalid ? 'border-bad' : 'border-line')} {...rest} />
      )}
    </FieldShell>
  )
})

type AreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; hint?: ReactNode; error?: string | null; optionalLabel?: string }
export const TextArea = forwardRef<HTMLTextAreaElement, AreaProps>(function TextArea({ label, hint, error, optionalLabel, className, rows = 3, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} optionalLabel={optionalLabel} className={className}>
      {({ id, describedBy, invalid }) => (
        <textarea ref={ref} id={id} rows={rows} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={clsx(control, 'py-2.5 leading-relaxed', invalid ? 'border-bad' : 'border-line')} {...rest} />
      )}
    </FieldShell>
  )
})

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; hint?: ReactNode; error?: string | null; optionalLabel?: string }
export const SelectField = forwardRef<HTMLSelectElement, SelectProps>(function SelectField({ label, hint, error, optionalLabel, className, children, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} optionalLabel={optionalLabel} className={className}>
      {({ id, describedBy, invalid }) => (
        <select ref={ref} id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={clsx(control, 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', invalid ? 'border-bad' : 'border-line')} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
          {children}
        </select>
      )}
    </FieldShell>
  )
})
