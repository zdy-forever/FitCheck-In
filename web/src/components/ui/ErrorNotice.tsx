import { AlertTriangle, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { errorKey } from '@/lib/errors'
import { Button } from './Button'

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-bad/30 bg-bad-soft p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm font-medium text-bad">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {t(errorKey(error))}
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} icon={<RotateCw className="size-3.5" />}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
