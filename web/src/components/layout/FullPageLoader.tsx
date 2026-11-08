import { useTranslation } from 'react-i18next'
import { Logo } from './Logo'

export function FullPageLoader() {
  const { t } = useTranslation()
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <Logo className="size-12 animate-pulse" />
        <span className="text-sm text-ink-3">{t('common.loading')}</span>
      </div>
    </div>
  )
}
