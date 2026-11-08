import { AlertTriangle, CheckCircle2, QrCode, RefreshCw, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { encode } from 'uqr'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { useToast } from '@/components/ui/Toast'
import { errorKey } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** QR code as crisp SVG (always dark-on-white so phone cameras read it in dark mode too). */
function Qr({ text }: { text: string }) {
  const { data, size } = useMemo(() => {
    const r = encode(text, { ecc: 'M', border: 2 })
    return { data: r.data, size: r.size }
  }, [text])
  const path = useMemo(() => {
    let d = ''
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y]![x]) d += `M${x} ${y}h1v1h-1z`
    return d
  }, [data, size])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="size-full rounded-xl bg-white" shapeRendering="crispEdges" role="img" aria-label="QR code" data-testid="import-qr">
      <path d={path} fill="#0b0d12" />
    </svg>
  )
}

/**
 * Settings card (clients): shows a one-time QR code that opens the import page on the iPhone.
 * Polls until the phone has paired (or the code expires).
 */
export function ImportQrCard({ onPaired }: { onPaired?: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [paired, setPaired] = useState(false)
  const [now, setNow] = useState(Date.now())

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const localOnly = /\/\/(localhost|127\.|\[::1\])/.test(origin)
  const link = pairing ? `${origin}/import/${pairing.code}` : ''
  const expired = pairing ? Date.parse(pairing.expiresAt) <= now : false

  const create = async () => {
    setBusy(true)
    setPaired(false)
    try {
      const { data, error } = await supabase.rpc('create_health_import_pairing')
      if (error) throw error
      setPairing(data as { code: string; expiresAt: string })
    } catch (e) {
      toast.error(t(errorKey(e)))
    } finally {
      setBusy(false)
    }
  }

  // Poll pairing status while a code is showing.
  useEffect(() => {
    if (!pairing || paired) return
    const tick = window.setInterval(async () => {
      setNow(Date.now())
      const { data } = await supabase.rpc('health_import_pairing_status')
      const s = data as { pending: boolean; lastPairedAt: string | null } | null
      if (s && !s.pending && s.lastPairedAt && Date.parse(s.lastPairedAt) >= Date.parse(pairing.expiresAt) - 10 * 60_000) {
        setPaired(true)
        onPaired?.()
      }
    }, 2000)
    return () => window.clearInterval(tick)
  }, [pairing, paired, onPaired])

  const secondsLeft = pairing ? Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 1000)) : 0

  return (
    <Card data-testid="import-qr-card">
      <CardHeader title={t('healthImport.cardTitle')} subtitle={t('healthImport.cardSubtitle')} icon={<Smartphone className="size-5" />} />
      {!pairing ? (
        <Button onClick={() => void create()} loading={busy} icon={<QrCode className="size-4" aria-hidden />} data-testid="create-import-qr">
          {t('healthImport.showQr')}
        </Button>
      ) : paired ? (
        <div className="flex flex-col gap-3" data-testid="import-paired">
          <p className="flex items-center gap-2 font-medium text-good">
            <CheckCircle2 className="size-5" aria-hidden />
            {t('healthImport.pairedOnComputer')}
          </p>
          <p className="text-sm text-ink-2">{t('healthImport.pairedOnComputerBody')}</p>
          <Button variant="secondary" size="sm" className="self-start" onClick={() => setPairing(null)}>
            {t('common.close')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4 sm:flex-row">
          <div className={`relative size-48 shrink-0 ${expired ? 'opacity-25' : ''}`}>
            <Qr text={link} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm text-ink-2">
            <ol className="list-decimal space-y-1 pl-5">
              {(t('healthImport.qrSteps', { returnObjects: true }) as string[]).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="text-xs text-ink-3" aria-live="polite">
              {expired ? t('healthImport.qrExpired') : t('healthImport.qrExpires', { time: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` })}
            </p>
            <a href={link} className="break-all text-xs text-accent underline-offset-2 hover:underline" data-testid="import-link">
              {link}
            </a>
            {localOnly && (
              <p className="flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-xs text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('healthImport.localhostWarning')}
              </p>
            )}
            <Button variant="secondary" size="sm" className="self-start" onClick={() => void create()} loading={busy} icon={<RefreshCw className="size-4" aria-hidden />}>
              {t('healthImport.newQr')}
            </Button>
            <p className="text-xs text-ink-3">{t('healthImport.qrSecurity')}</p>
          </div>
        </div>
      )}
    </Card>
  )
}
