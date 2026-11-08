import { clsx } from 'clsx'
import type { HTMLAttributes, ReactNode } from 'react'

import { useSpotlight } from '@/hooks/useSpotlight'

/** `interactive` adds hover lift + a pointer-following spotlight (for clickable / rich cards). */
export function Card({ className, interactive, ...rest }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  const spot = useSpotlight<HTMLDivElement>()
  return <div className={clsx('card p-5 sm:p-6', interactive && 'lift spotlight', className)} {...(interactive ? spot : {})} {...rest} />
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-md text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}
