import { AlertTriangle, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useRouteError } from 'react-router'
import { buttonClass } from '@/components/ui/Button'

/** Friendly fallback for render/loader errors (never shows stack traces to users). */
export function RouteError() {
  const { t } = useTranslation()
  const error = useRouteError()
  if (import.meta.env.DEV) console.error(error)
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="ambient" aria-hidden />
      <div role="alert" className="card max-w-md p-8 text-center">
        <AlertTriangle className="mx-auto mb-3 size-10 text-warn" aria-hidden />
        <h1 className="text-xl font-semibold text-ink">{t('errors.generic')}</h1>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" className={buttonClass('primary')} onClick={() => window.location.reload()}>
            <RotateCw className="size-4" aria-hidden />
            {t('common.retry')}
          </button>
          <Link to="/" className={buttonClass('secondary')}>
            {t('errors.goHome')}
          </Link>
        </div>
      </div>
    </div>
  )
}
