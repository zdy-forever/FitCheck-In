import { clsx } from 'clsx'
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />
}
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card p-6" aria-busy="true">
      <Skeleton className="mb-4 h-5 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={clsx('mb-2 h-4', i % 2 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}
