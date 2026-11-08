import { clsx } from 'clsx'
import { useId, type ReactNode } from 'react'

/**
 * Accessible segmented rating control (radio group). Works with arrow keys,
 * 44px touch targets, optional per-option labels.
 */
export function Scale({
  label,
  min,
  max,
  value,
  onChange,
  labels,
  hint,
  error,
  name,
  tone = 'accent',
}: {
  label: ReactNode
  min: number
  max: number
  value: number | null
  onChange: (v: number) => void
  labels?: readonly string[]
  hint?: ReactNode
  error?: string | null
  name: string
  tone?: 'accent' | 'severity'
}) {
  const id = useId()
  const options = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const selectedLabel = value !== null && labels ? labels[value - min] : null
  const severityColor = (v: number) => {
    const ratio = (v - min) / (max - min)
    return ratio >= 0.7 ? 'bg-bad text-white' : ratio >= 0.4 ? 'bg-warn text-white' : 'bg-accent text-accent-contrast'
  }
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}>
      <legend className="mb-2 flex w-full items-baseline justify-between gap-2 text-sm font-medium text-ink">
        <span>{label}</span>
        <span className="text-sm font-semibold text-accent tabular" aria-live="polite">
          {value !== null ? (selectedLabel ? `${value} · ${selectedLabel}` : value) : ''}
        </span>
      </legend>
      <div role="radiogroup" className={clsx('grid gap-1.5', options.length > 6 ? 'grid-cols-6 sm:grid-cols-11' : 'grid-cols-5')}>
        {options.map((v) => {
          const checked = value === v
          return (
            <label
              key={v}
              className={clsx(
                'relative grid h-11 cursor-pointer place-items-center rounded-xl border text-md font-medium tabular transition-all duration-200 ease-out select-none',
                'has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent-soft',
                checked
                  ? clsx('scale-[1.04] border-transparent shadow-md', tone === 'severity' ? severityColor(v) : 'bg-accent text-accent-contrast')
                  : 'border-line bg-surface-strong text-ink-2 hover:-translate-y-0.5 hover:border-accent-ring hover:text-ink hover:shadow-md active:scale-95',
              )}
              title={labels?.[v - min]}
              data-testid={`${name}-${v}`}
            >
              <input type="radio" className="sr-only" name={name} value={v} checked={checked} onChange={() => onChange(v)} aria-label={labels?.[v - min] ? `${v} ${labels[v - min]}` : String(v)} />
              {v}
            </label>
          )
        })}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs font-medium text-bad">
          {error}
        </p>
      )}
    </fieldset>
  )
}
