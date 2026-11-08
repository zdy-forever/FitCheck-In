import { clsx } from 'clsx'
import { KeyRound, ShieldCheck, Smartphone, Trash2, UserRound } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { SelectField, TextArea, TextField } from '@/components/ui/Field'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { useToast } from '@/components/ui/Toast'
import { useAuth, useProfile } from '@/features/auth/AuthProvider'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { chooseLanguage, LANGUAGES, normalizeLanguage, type Language } from '@/i18n'
import { api, type HealthCategory, type RelationshipWithPeer, type SharingPermission } from '@/lib/api'
import { errorKey } from '@/lib/errors'
import { useFormatters } from '@/lib/format'

export const CATEGORIES: HealthCategory[] = ['scores', 'hrv', 'resting_heart_rate', 'sleep', 'heart_rate', 'activity', 'workouts', 'vo2_max', 'vitals', 'mobility', 'body']

function Toggle({ checked, onChange, label, disabled, busy }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => !busy && onChange(!checked)}
      data-testid="toggle"
      className={clsx(
        'relative h-7 w-12 shrink-0 cursor-pointer rounded-full p-0 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        checked ? 'bg-accent' : 'bg-line-strong',
        busy && 'opacity-70',
      )}
    >
      {/* Anchored with explicit top/left (a button centres its content otherwise) and moved with
          `transform`, not Tailwind's `translate-*`: the reduced-motion stylesheet resets the
          `translate` property, which would freeze the knob and hide the on/off state. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ease-out"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  )
}

/**
 * Sharing is set per trainer. With one trainer the list is shown directly; with several, a
 * selector picks whose permissions are being edited (one list at a time instead of 11 × N
 * switches). The selection is kept per tab session and falls back to the first trainer when
 * the selected one is no longer connected.
 */
function SharingTrainerPicker({
  rels,
  perms,
  children,
}: {
  rels: RelationshipWithPeer[]
  perms: SharingPermission[]
  children: (r: RelationshipWithPeer) => ReactNode
}) {
  const { t } = useTranslation()
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('fitcheckin.sharingTrainer')
    } catch {
      return null
    }
  })
  const current = rels.find((r) => r.id === picked) ?? rels[0]!
  if (rels.length === 1) return <>{children(current)}</>
  const grantedCount = (relId: string) => perms.filter((p) => p.relationship_id === relId && p.granted).length
  const total = (relId: string) => perms.filter((p) => p.relationship_id === relId).length
  const pick = (id: string) => {
    setPicked(id)
    try {
      sessionStorage.setItem('fitcheckin.sharingTrainer', id)
    } catch {
      /* storage unavailable: selection just isn't remembered */
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <SelectField label={t('settings.sharingTrainer')} value={current.id} onChange={(e) => pick(e.target.value)} data-testid="sharing-trainer-select" hint={t('settings.sharingTrainerHint', { count: rels.length })}>
        {rels.map((r) => (
          <option key={r.id} value={r.id}>
            {t('settings.sharingTrainerOption', { name: r.peer?.display_name ?? '—', granted: grantedCount(r.id), total: total(r.id) })}
          </option>
        ))}
      </SelectField>
      {children(current)}
    </div>
  )
}

/** /client/join?code=… — preview and accept a trainer invitation. */
export function JoinTrainerPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase())
  const [preview, setPreview] = useState<{ trainer_name: string; is_expired: boolean; status: string } | null>(null)
  const [share, setShare] = useState<Set<HealthCategory>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => sessionStorage.removeItem('fitcheckin.pendingInvite'), [])

  const lookup = async (e?: FormEvent) => {
    e?.preventDefault()
    const c = code.trim().toUpperCase()
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(c)) {
      setError(t('validation.inviteCode'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      const p = await api.previewInvitation(c)
      if (!p) setError(t('errors.invitation_not_found'))
      else if (p.status !== 'pending') setError(t('errors.invitation_not_pending'))
      else if (p.is_expired) setError(t('errors.invitation_expired'))
      else setPreview(p)
    } catch (er) {
      setError(t(errorKey(er)))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (params.get('code')) void lookup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const accept = async () => {
    setBusy(true)
    try {
      await api.acceptInvitation(code.trim().toUpperCase(), [...share])
      toast.success(t('invitations.accepted', { name: preview?.trainer_name }))
      navigate('/client', { replace: true })
    } catch (er) {
      setError(t(errorKey(er)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title={t('invitations.acceptTitle')} subtitle={t('invitations.acceptSubtitle')} />
      <Card>
        {!preview ? (
          <form onSubmit={(e) => void lookup(e)} noValidate className="flex flex-col gap-4">
            <TextField
              label={t('invitations.codeLabel')}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
              error={error}
              maxLength={8}
              autoCapitalize="characters"
              autoComplete="off"
              className="[&_input]:text-center [&_input]:font-mono [&_input]:text-xl [&_input]:tracking-[0.3em]"
              data-testid="invite-code"
            />
            <Button type="submit" loading={busy} size="lg" icon={<KeyRound className="size-5" />}>
              {t('invitations.lookup')}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-2xl bg-accent-soft p-4">
              <UserRound className="size-6 text-accent" aria-hidden />
              <span className="font-semibold text-ink">{t('invitations.from', { name: preview.trainer_name })}</span>
            </div>
            <div>
              <h2 className="font-semibold text-ink">{t('invitations.chooseSharing')}</h2>
              <p className="mt-1 text-sm text-ink-3">{t('invitations.sharingHint')}</p>
              <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
                {CATEGORIES.map((c) => (
                  <li key={c} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm text-ink">{t(`settings.categories.${c}`)}</span>
                    <Toggle
                      checked={share.has(c)}
                      label={t(`settings.categories.${c}`)}
                      onChange={(on) =>
                        setShare((s) => {
                          const n = new Set(s)
                          if (on) n.add(c)
                          else n.delete(c)
                          return n
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
            {error && (
              <p role="alert" className="text-sm font-medium text-bad">
                {error}
              </p>
            )}
            <Button size="lg" loading={busy} onClick={() => void accept()} data-testid="accept-invite">
              {t('invitations.accept')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const me = useProfile()
  const { refreshProfile, signOut } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const f = useFormatters(i18n.language)

  const [name, setName] = useState(me.display_name)
  const [bio, setBio] = useState(me.bio ?? '')
  const [tz, setTz] = useState(me.time_zone)
  const [lang, setLang] = useState<Language>(normalizeLanguage(me.locale))
  const [birthYear, setBirthYear] = useState(me.birth_year ? String(me.birth_year) : '')
  const [sex, setSex] = useState<string>(me.sex ?? '')
  const [birthYearError, setBirthYearError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [me.time_zone]

  const sharingQ = useLiveQuery(
    `sharing:${me.id}`,
    async () => {
      if (me.role !== 'client') return null
      const [rels, perms, devices] = await Promise.all([api.myRelationships('client'), api.sharing({ clientId: me.id }), api.devices()])
      return { rels: rels.filter((r) => r.status === 'active'), perms, devices }
    },
    ['health_sharing_permissions', 'trainer_client_relationships', 'health_sync_devices'],
  )

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || name.trim().length > 80) {
      setNameError(t('validation.nameLength'))
      return
    }
    setNameError(null)
    const thisYear = new Date().getFullYear()
    const by = birthYear.trim() === '' ? null : Number(birthYear)
    if (by !== null && (!Number.isInteger(by) || by < thisYear - 110 || by > thisYear - 10)) {
      setBirthYearError(t('validation.range', { min: thisYear - 110, max: thisYear - 10 }))
      return
    }
    setBirthYearError(null)
    setSaving(true)
    try {
      await api.updateProfile(me.id, { display_name: name.trim(), bio: bio.trim() || null, time_zone: tz, locale: lang, ...(me.role === 'client' ? { birth_year: by, sex: sex === 'female' || sex === 'male' ? sex : null } : {}) })
      await chooseLanguage(lang)
      await refreshProfile()
      toast.success(t('settings.saved'))
    } catch (er) {
      toast.error(t(errorKey(er)))
    } finally {
      setSaving(false)
    }
  }

  const [delHealth, setDelHealth] = useState(false)
  const [delAccount, setDelAccount] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  // Optimistic switch state: flips immediately, locks while the write is in flight, and
  // falls back to the server value (via reload) if the write fails.
  const [pendingShare, setPendingShare] = useState<Record<string, boolean>>({})
  const toggleShare = async (id: string, granted: boolean) => {
    if (id in pendingShare) return
    setPendingShare((p) => ({ ...p, [id]: granted }))
    try {
      await api.setSharing(id, granted)
      await sharingQ.reload()
      toast.success(t('settings.sharingUpdated'))
    } catch (er) {
      toast.error(t(errorKey(er)))
      await sharingQ.reload()
    } finally {
      setPendingShare(({ [id]: _, ...rest }) => rest)
    }
  }

  return (
    <div className={clsx('mx-auto', me.role === 'client' ? 'max-w-none' : 'max-w-3xl')}>
      <PageHeader title={t('settings.title')} />
      {/* Desktop (clients): profile + privacy on the left, the per-trainer sharing list on the
          right (sticky). Mobile and trainers: one column. */}
      <div className={clsx('grid gap-4', me.role === 'client' && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start xl:gap-6')}>
        <Card className="lg:col-start-1">
          <CardHeader title={t('settings.profile')} icon={<UserRound className="size-5" />} />
          <form onSubmit={(e) => void saveProfile(e)} noValidate className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('settings.displayName')} value={name} onChange={(e) => setName(e.target.value)} error={nameError} maxLength={80} />
            <SelectField label={t('settings.language')} value={lang} onChange={(e) => setLang(e.target.value as Language)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('settings.timeZone')} value={tz} onChange={(e) => setTz(e.target.value)} className="sm:col-span-2">
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </SelectField>
            {me.role === 'client' && (
              <>
                <TextField label={t('settings.birthYear')} inputMode="numeric" value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, '').slice(0, 4))} error={birthYearError} optionalLabel={t('common.optional')} />
                <SelectField label={t('settings.sex')} value={sex} onChange={(e) => setSex(e.target.value)} optionalLabel={t('common.optional')}>
                  <option value="">{t('settings.sexUnset')}</option>
                  <option value="female">{t('settings.sexFemale')}</option>
                  <option value="male">{t('settings.sexMale')}</option>
                </SelectField>
                <p className="-mt-2 text-xs text-ink-3 sm:col-span-2">{t('settings.normsHint')}</p>
              </>
            )}
            <TextArea label={t('settings.bio')} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} className="sm:col-span-2" optionalLabel={t('common.optional')} />
            <div className="sm:col-span-2">
              <Button type="submit" loading={saving}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </Card>

        {me.role === 'client' && (
          <Card className="lg:sticky lg:top-28 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <CardHeader title={t('settings.sharing')} subtitle={t('settings.sharingSubtitle')} icon={<ShieldCheck className="size-5" />} />
            {sharingQ.loading ? (
              <CardSkeleton />
            ) : sharingQ.error || !sharingQ.data ? (
              <ErrorNotice error={sharingQ.error} onRetry={() => void sharingQ.reload()} />
            ) : sharingQ.data.rels.length === 0 ? (
              <p className="text-sm text-ink-3">{t('settings.sharingNoTrainers')}</p>
            ) : (
              <SharingTrainerPicker rels={sharingQ.data.rels} perms={sharingQ.data.perms}>
                {(r) => (
                  <div key={r.id} className="rounded-2xl border border-line" data-testid="sharing-trainer">
                    {sharingQ.data!.rels.length === 1 && <div className="border-b border-line px-4 py-3 font-semibold text-ink">{r.peer?.display_name}</div>}
                    <ul className="divide-y divide-line">
                      {CATEGORIES.map((c) => {
                        const perm = sharingQ.data!.perms.find((p) => p.relationship_id === r.id && p.category === c)
                        if (!perm) return null
                        return (
                          <li key={c} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <span className="text-sm text-ink-2">{t(`settings.categories.${c}`)}</span>
                            <Toggle
                              checked={pendingShare[perm.id] ?? perm.granted}
                              busy={perm.id in pendingShare}
                              label={`${r.peer?.display_name}: ${t(`settings.categories.${c}`)}`}
                              onChange={(v) => void toggleShare(perm.id, v)}
                            />
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </SharingTrainerPicker>
            )}
            {sharingQ.data && sharingQ.data.devices.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                  <Smartphone className="size-4" aria-hidden />
                  {t('health.devices')}
                </h3>
                <ul className="divide-y divide-line rounded-2xl border border-line">
                  {sharingQ.data.devices.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <div>
                        <div className="font-medium text-ink">{d.device_name}</div>
                        <div className="text-xs text-ink-3">{d.last_sync_at ? `${t('health.syncedAt')}: ${f.relative(d.last_sync_at)}` : t('common.never')}</div>
                      </div>
                      {d.revoked_at ? (
                        <span className="text-xs text-ink-3">{t('health.deviceRevoked')}</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await api.revokeDevice(d.id)
                              toast.success(t('health.deviceRevoked'))
                              await sharingQ.reload()
                            } catch (er) {
                              toast.error(t(errorKey(er)))
                            }
                          }}
                        >
                          {t('health.deviceRevoke')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        <Card className="border-bad/25 lg:col-start-1">
          <CardHeader title={t('settings.privacy')} icon={<Trash2 className="size-5" />} action={<Link to="/privacy" className="text-sm font-medium text-accent hover:underline">{t('landing.footer.privacy')}</Link>} />
          <div className="flex flex-col gap-4">
            {me.role === 'client' && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-ink">{t('settings.deleteHealth')}</div>
                  <p className="text-sm text-ink-3">{t('settings.deleteHealthBody')}</p>
                </div>
                <Button variant="secondary" className="text-bad" onClick={() => setDelHealth(true)} data-testid="delete-health">
                  {t('common.delete')}
                </Button>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium text-ink">{t('settings.deleteAccount')}</div>
                <p className="text-sm text-ink-3">{t('settings.deleteAccountBody')}</p>
              </div>
              <Button variant="danger" onClick={() => setDelAccount(true)} disabled={me.is_demo}>
                {t('settings.deleteAccount')}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <ConfirmModal
        open={delHealth}
        onClose={() => setDelHealth(false)}
        title={t('settings.deleteHealth')}
        body={t('settings.deleteHealthConfirm')}
        confirmLabel={t('common.delete')}
        loading={busy}
        onConfirm={async () => {
          setBusy(true)
          try {
            const r = await api.deleteMyHealthData()
            toast.success(t('settings.deletedHealth', { samples: r.samples, snapshots: r.snapshots }))
            setDelHealth(false)
            await sharingQ.reload()
          } catch (er) {
            toast.error(t(errorKey(er)))
          } finally {
            setBusy(false)
          }
        }}
      />
      <Modal open={delAccount} onClose={() => setDelAccount(false)} title={t('settings.deleteAccount')}>
        <p className="mb-4 text-sm text-ink-2">{t('settings.deleteAccountBody')}</p>
        <TextField label={t('settings.deleteAccountConfirm')} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDelAccount(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={confirmText !== 'DELETE'}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.deleteMyAccount()
                await signOut()
                toast.success(t('settings.accountDeleted'))
                navigate('/', { replace: true })
              } catch (er) {
                toast.error(t(errorKey(er)))
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('settings.deleteAccount')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

