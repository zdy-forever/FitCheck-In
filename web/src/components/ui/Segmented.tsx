import { clsx } from 'clsx'
import { motion } from 'motion/react'
import { useId, type ReactNode } from 'react'

export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; size?: 'sm' | 'md' }) {
  const id = useId()
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-2xl bg-sunken p-1">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={clsx('relative shrink-0 rounded-xl font-medium transition-colors', size === 'sm' ? 'h-8 px-3 text-sm' : 'h-9 px-4 text-sm', active ? 'text-ink' : 'text-ink-3 hover:text-ink')}
          >
            {active && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-xl bg-surface-strong shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
