import { clsx } from 'clsx'
import { AlertTriangle, CheckCircle2, ChevronRight, FileArchive, HeartPulse, Loader2, LogOut, Share, Smartphone, Upload } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Wordmark } from '@/components/layout/Logo'
import { LanguageSwitcher } from '@/components/layout/Preferences'
import { forgetImport, ImportError, pair, parseInWorker, savedImport, status, upload, type UploadResult } from '@/features/health-import/importApi'
import { browserTimeZone, useFormatters } from '@/lib/format'

type Phase =
  | { k: 'pairing' }
  | { k: 'ready' }
  | { k: 'parsing'; pct: number; records: number }
  | { k: 'uploading'; done: number; total: number }
  | { k: 'done'; result: UploadResult; used: number; days: number }
  | { k: 'error'; code: string }

/**
 * /import/:code (from the QR code) and /import (saved on the home screen).
 * Runs without a login session: the QR code is exchanged for an upload-only import token.
 */
export function HealthImportPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const [phase, setPhase] = useState<Phase>({ k: 'pairing' })
  const [who, setWho] = useState<{ token: string; name: string; lastSyncAt: string | null } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const tz = browserTimeZone()

  // Pair with the QR code (once), or resume with the token saved on this phone.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (code) {
          const r = await pair(code)
          if (cancelled) return
          setWho({ token: r.token, name: r.clientName, lastSyncAt: null })
          navigate('/import', { replace: true }) // drop the one-time code from the URL
        } else {
          const saved = savedImport()
          if (!saved) throw new ImportError('not_paired')
          const s = await status(saved.token)
          if (cancelled) return
          setWho({ token: saved.token, name: s.clientName, lastSyncAt: s.lastSyncAt })
        }
        setPhase({ k: 'ready' })
      } catch (e) {
        if (cancelled) return
        const c = e instanceof ImportError ? e.code : 'generic'
        if (c === 'invalid_import_token') forgetImport()
        // A used code after a successful pairing on this phone: fall back to the saved token.
        if (code && c === 'code_expired_or_used' && savedImport()) {
          navigate('/import', { replace: true })
          return
        }
        setPhase({ k: 'error', code: c })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, navigate])

  const run = async (file: File) => {
    if (!who) return
    setPhase({ k: 'parsing', pct: 0, records: 0 })
    try {
      const { samples, stats } = await parseInWorker(file, tz, 90, (p) =>
        setPhase({ k: 'parsing', pct: p.totalBytes ? Math.round((p.bytesRead / p.totalBytes) * 100) : 0, records: p.records }),
      )
      setPhase({ k: 'uploading', done: 0, total: samples.length })
      const result = await upload(who.token, samples, tz, (done, total) => setPhase({ k: 'uploading', done, total }))
      const days = stats.oldest && stats.newest ? Math.max(1, Math.round((Date.parse(stats.newest) - Date.parse(stats.oldest)) / 86_400_000)) : 0
      setPhase({ k: 'done', result, used: samples.length, days })
      setWho((w) => (w ? { ...w, lastSyncAt: new Date().toISOString() } : w))
    } catch (e) {
      setPhase({ k: 'error', code: e instanceof ImportError ? e.code : 'generic' })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const steps = t('healthImport.steps', { returnObjects: true }) as string[]

  return (
    <div className="min-h-dvh bg-[var(--bg)] px-4 pb-16 pt-5" data-testid="health-import-page">
      <header className="mx-auto mb-6 flex max-w-lg items-center justify-between">
        <Wordmark />
        <LanguageSwitcher />
      </header>
      <main className="mx-auto flex max-w-lg flex-col gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{t('healthImport.title')}</h1>
          {who && <p className="mt-1 text-ink-2">{t('healthImport.for', { name: who.name })}</p>}
        </div>

        {phase.k === 'pairing' && (
          <div className="card flex items-center gap-3 p-5 text-ink-2">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            {t('healthImport.connecting')}
          </div>
        )}

        {phase.k === 'error' && (
          <div className="card flex flex-col gap-3 p-5" role="alert" data-testid="import-error">
            <div className="flex items-start gap-3 text-bad">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
              <p className="font-medium">{t(`healthImport.errors.${phase.code}`, { defaultValue: t('healthImport.errors.generic') })}</p>
            </div>
            {who && (
              <Button variant="secondary" onClick={() => setPhase({ k: 'ready' })}>
                {t('common.retry')}
              </Button>
            )}
          </div>
        )}

        {who && (phase.k === 'ready' || phase.k === 'done') && (
          <>
            {who.lastSyncAt && phase.k === 'ready' && (
              <p className="text-sm text-ink-3">{t('healthImport.lastImport', { time: f.relative(who.lastSyncAt) })}</p>
            )}
            {phase.k === 'done' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card flex flex-col gap-2 p-5" data-testid="import-done">
                <div className="flex items-center gap-2 font-semibold text-good">
                  <CheckCircle2 className="size-5" aria-hidden />
                  {t('healthImport.done')}
                </div>
                <p className="text-sm text-ink-2">{t('healthImport.doneBody', { count: phase.used, days: phase.days, added: phase.result.accepted, updated: phase.result.duplicates })}</p>
                {phase.result.rejected > 0 && <p className="text-xs text-ink-3">{t('healthImport.rejected', { count: phase.result.rejected })}</p>}
                <p className="text-sm text-ink-2">{t('healthImport.doneNext')}</p>
              </motion.div>
            )}

            <section className="card p-5">
              <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink">
                <HeartPulse className="size-5 text-accent" aria-hidden />
                {t('healthImport.step1')}
              </h2>
              <ol className="flex flex-col gap-2.5">
                {steps.map((s, i) => (
                  <li key={s} className="flex items-start gap-3 text-sm text-ink-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
                    <span className="pt-0.5">{s}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 rounded-xl bg-sunken p-3 text-xs text-ink-3">{t('healthImport.exportNote')}</p>
            </section>

            <section className="card p-5">
              <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink">
                <FileArchive className="size-5 text-accent" aria-hidden />
                {t('healthImport.step2')}
              </h2>
              <input
                ref={fileRef}
                type="file"
                accept=".zip,.xml,application/zip,text/xml"
                className="sr-only"
                id="health-export-file"
                data-testid="import-file"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void run(file)
                }}
              />
              <label htmlFor="health-export-file" className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-accent text-base font-semibold text-accent-contrast shadow-[var(--shadow-lg)] transition active:scale-[0.98]">
                <Upload className="size-5" aria-hidden />
                {t('healthImport.choose')}
              </label>
              <p className="mt-3 text-xs text-ink-3">{t('healthImport.privacy')}</p>
            </section>

            <section className="flex items-start gap-3 rounded-2xl border border-line p-4 text-sm text-ink-2">
              <Share className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <p>{t('healthImport.homeScreen')}</p>
            </section>

            <button
              type="button"
              className="flex items-center justify-center gap-1.5 self-center text-xs text-ink-3 hover:text-ink"
              onClick={() => {
                forgetImport()
                setWho(null)
                setPhase({ k: 'error', code: 'not_paired' })
              }}
            >
              <LogOut className="size-3.5" aria-hidden />
              {t('healthImport.forget')}
            </button>
          </>
        )}

        {(phase.k === 'parsing' || phase.k === 'uploading') && (
          <div className="card flex flex-col gap-3 p-5" aria-live="polite" data-testid="import-progress">
            <div className="flex items-center gap-2 font-medium text-ink">
              <Loader2 className="size-5 animate-spin text-accent" aria-hidden />
              {phase.k === 'parsing' ? t('healthImport.reading') : t('healthImport.uploading')}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sunken">
              <div
                className={clsx('h-full rounded-full bg-accent transition-[width] duration-300')}
                style={{ width: `${phase.k === 'parsing' ? phase.pct : phase.total ? Math.round((phase.done / phase.total) * 100) : 100}%` }}
              />
            </div>
            <p className="text-xs text-ink-3">
              {phase.k === 'parsing' ? t('healthImport.readingDetail', { pct: phase.pct, records: f.num(phase.records) }) : t('healthImport.uploadingDetail', { done: phase.done, total: phase.total })}
            </p>
            <p className="text-xs text-ink-3">{t('healthImport.keepOpen')}</p>
          </div>
        )}

        {!who && phase.k === 'error' && (
          <div className="flex items-start gap-3 rounded-2xl border border-line p-4 text-sm text-ink-2">
            <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              {t('healthImport.howToPair')} <ChevronRight className="inline size-3.5" aria-hidden />
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
