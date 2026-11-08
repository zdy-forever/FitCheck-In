import { clsx } from 'clsx'
import type { ReactNode } from 'react'

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'demo'
const tones: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2 border-line',
  accent: 'bg-accent-soft text-accent border-transparent',
  good: 'bg-good-soft text-good border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  bad: 'bg-bad-soft text-bad border-transparent',
  demo: 'bg-demo-soft text-demo border-transparent',
}

export function Badge({ tone = 'neutral', icon, children, className, title }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium', tones[tone], className)}>
      {icon}
      {children}
    </span>
  )
}
