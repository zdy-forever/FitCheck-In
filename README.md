# FitCheck-In

**Know your body. Train smarter. · 了解身体状态，让每次训练更合理。**

A trilingual (English / 简体中文 / 繁體中文) personal-trainer platform: clients check in before
training, optionally import Apple Health data from their iPhone (in the browser — no app),
and trainers see it all
on a real-time dashboard alongside session logs, notes and feedback.

| Layer | Tech |
|---|---|
| Web | React 19, TypeScript (strict), Vite 8, Tailwind CSS 4, React Router 8, i18next, Motion, Lucide, Recharts |
| Backend | Supabase Auth, Postgres 17 + Row Level Security, Realtime, Edge Functions (Deno) |
| Apple Health | iPhone-browser import of the Health export (QR pairing, parsed on the phone). Optional native module in `health_monitor_ios` |
| Deploy | Vercel (web) + Supabase (everything else) |

---

## Contents

1. [Repository layout](#1-repository-layout)
2. [Run locally](#2-run-locally)
3. [Tests](#3-tests)
4. [Supabase setup (hosted)](#4-supabase-setup-hosted)
5. [Deploy the web app (Vercel)](#5-deploy-the-web-app-vercel)
6. [Apple Health integration](#6-apple-health-integration)
7. [Demo mode for the course video](#7-demo-mode-for-the-course-video)
8. [Security & privacy model](#8-security--privacy-model)
9. [Feature status](#9-feature-status)

Further docs: [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) (what was ported from health+, how
it was verified, what v2 changed and why, limitations) · [`docs/TESTING.md`](docs/TESTING.md) (manual test script
for the core flow).

---

## 1. Repository layout

```
FitCheck-In/
├─ web/                         React app
│  ├─ src/
│  │  ├─ components/{ui,layout} Reusable UI (Button, Field, Scale, Modal, Toast, Skeleton…), app shell
│  │  ├─ features/              auth, checkins, sessions, health (domain components)
│  │  ├─ pages/                 landing, auth, trainer, client, shared
│  │  ├─ i18n/locales/          en.ts, zh-CN.ts, zh-TW.ts (typed; each must have every en key)
│  │  ├─ lib/                   supabase client, typed API layer, generated DB types, formatting, theme
│  │  └─ styles/index.css       design tokens (light/dark), glass materials, reduced-motion/transparency
│  └─ tests/                    unit (vitest), integration (live stack), e2e (Playwright), fixtures
├─ supabase/
│  ├─ migrations/               schema, RLS + RPCs, demo housekeeping, grants
│  ├─ tests/database/           pgTAP RLS tests
│  └─ functions/
│     ├─ health-ingest/         Apple Health upload (native iOS module, user JWT)
│     ├─ health-import/         Apple Health import from the iPhone browser (QR pairing + upload-only token)
│     ├─ demo-session/          creates an isolated demo workspace (simulated data)
│     ├─ refresh-snapshot/      recomputes a client's snapshot after check-in / feedback / session save
│     └─ _shared/metrics/       TS port of DerivedMetricsEngine + sufficiency layer (shared with web)
├─ ios/                         copy of the iOS FitCheckInSync module + git patch for health_monitor_ios
├─ tools/swift-golden/          compiles the ORIGINAL Swift engine to produce golden test vectors
└─ docs/
```

## 2. Run locally

Prerequisites: Node ≥ 20, Docker Desktop running.

```bash
npm install                 # installs the Supabase CLI (root)
npm --prefix web install

npx supabase start          # Postgres, Auth, Realtime, Edge runtime (first run pulls images)
npx supabase db reset       # applies supabase/migrations
cp supabase/functions/.env.example supabase/functions/.env.local
npx supabase functions serve --env-file supabase/functions/.env.local   # keep running

# web env — copy the anon key printed by `npx supabase status`
cp web/.env.example web/.env.local     # set VITE_SUPABASE_ANON_KEY
npm run dev                            # http://localhost:5173
```

Local email confirmation is off (see `supabase/config.toml`), so sign-up logs you in
directly. Emails sent by Auth are visible in Mailpit at http://127.0.0.1:54324.

**Two devices on your LAN:** run `npx vite --host` and open `http://<your-ip>:5173` on the
phone. Set `VITE_SUPABASE_URL=http://<your-ip>:54321` in `web/.env.local` so the phone can
reach the API.

## 3. Tests

| Command | What it runs | Needs |
|---|---|---|
| `npm --prefix web run typecheck` | `tsc -b` strict, app + tests + shared engine | — |
| `npm --prefix web test` | 207 unit tests: **128 Swift golden-vector equivalence tests**, sufficiency rules, DST calendar, HealthKit aggregation semantics, ingest validation, Swift↔server wire contract, demo data | — |
| `npx supabase test db` | 80 pgTAP assertions: RLS isolation, role immutability, cross-trainer privacy, per-category sharing, revocation, anti-spoofing, anon lockout | local stack |
| `npm --prefix web run test:integration` | 20 tests against the live Edge Function + Auth: JWT rejection, roles, idempotent dedupe, per-sample rejection, insufficient-data withholding, sharing & revocation, deletion, demo isolation, **exact Swift-encoded payload** | local stack + functions serve, `SUPABASE_ANON_KEY` env |
| `npm --prefix web run test:e2e` | 16 Playwright tests: full trainer↔client flow on **two browser contexts** (laptop + phone viewport), live realtime update, validation errors, reload persistence, sharing revocation, language & theme switching, sign-out, demo mode on desktop + mobile | local stack + functions serve, `web/.env.local` |
| `tools/swift-golden/generate.sh` | Recompiles the original Swift engine and regenerates fixtures | Swift toolchain |

All of the above were run and passed during development; see the final report for exact counts.

## 4. Supabase setup (hosted)

1. Create a project at https://supabase.com (region near your users).
2. Link and push the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
3. Deploy the functions and set secrets:
   ```bash
   npx supabase functions deploy health-ingest
   npx supabase functions deploy health-import
   npx supabase functions deploy demo-session
   npx supabase functions deploy refresh-snapshot
   npx supabase secrets set DEMO_MODE_ENABLED=true     # false to disable the public demo
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase — never put
   them anywhere else.
4. **Auth → URL Configuration**: Site URL = your Vercel URL; add it to Redirect URLs.
   For production, enable email confirmation (`Auth → Providers → Email`).
5. **Realtime**: the migration adds the tables to the `supabase_realtime` publication; no
   dashboard step needed.
6. **Demo cleanup** (optional): enable the `pg_cron` extension, then
   ```sql
   select cron.schedule('purge-demo', '17 * * * *', $$select public.purge_expired_demo_accounts()$$);
   ```
7. Copy **Project URL** and the **anon / publishable key** (Settings → API) for the web and iOS apps.

## 5. Deploy the web app (Vercel)

1. Import the repo in Vercel, set **Root Directory = `web`** (framework: Vite; `web/vercel.json`
   provides SPA rewrites and security headers).
2. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DEMO_MODE`.
   The app refuses to start if a service-role/secret key is supplied by mistake.
3. Deploy, then add the Vercel URL to Supabase Auth redirect URLs (step 4.4).

## 6. Apple Health integration

Apple offers no web or cloud API for Health data; only on-device apps can read HealthKit.
FitCheck-In is web-only, so the primary path uses the iPhone's built-in export:

```
Computer (signed-in client): Health or Settings → "Show QR code"   (one-time code, 10 min, single use)
iPhone camera → /import/<code> in Safari → code exchanged for an upload-only import token
iPhone: Health app → profile → "Export All Health Data" → Save to Files      (the one manual step)
iPhone browser: choose export.zip → parsed ON THE PHONE (streamed, Web Worker)
  → only used metrics, last 90 days → Edge Function health-import (validate, dedupe, score)
  → Postgres (RLS) → computer updates via Realtime
```

* The export never leaves the phone; only the derived samples are uploaded.
* The phone never holds a login session. The import token can only upload for that client,
  is stored hashed, shows up under **Connected devices**, and is revoked with **Unlink device**.
* Same samples as the native module (metric names, units, sleep stages, workout kinds, daily
  bucket ids) and the same server validation. Cumulative metrics take the best single source
  per day so iPhone + Watch are never double-counted. Parser: `web/src/features/health-import/`.
* Not automatic: clients re-export to update (the page can be added to the home screen).
* Local test on a real iPhone (same Wi-Fi): `npm --prefix web run dev:lan`, open
  `http://<your-mac-ip>:5173` on the computer, create the QR there and scan it. `dev:lan`
  serves the app on the LAN and proxies the local Supabase under `/sb`.

What was verified without a device: parser unit tests on a real-format export (zip and
xml, multi-source steps, unit conversions, sleep stages, workouts), a 128 MB / 422k-record
export parsed in about 1 s within a 256 MB heap, integration tests of pairing/upload/
revocation, and an E2E run with a separate "phone" browser context. What still needs a real
iPhone: Safari's file picker with a real export, and speed/memory on the device.

### Optional: native iOS module

Browsers cannot read HealthKit directly. A native path also exists:

```
Apple Watch → Apple Health → HealthKit → FitCheckInSync (iPhone) → HTTPS + user JWT
  → Edge Function health-ingest (validate, dedupe, score) → Postgres (RLS) → web (Realtime)
```

The module lives on branch **`fitcheckin-sync`** of `health_monitor_ios` (local commit
`2fbae0a`, not pushed). A copy and a `git format-patch` file are in [`ios/`](ios/). See
[`ios/FitCheckInSync/README.md`](ios/FitCheckInSync/README.md).

Steps (need a Mac with Xcode, an Apple Developer account with the HealthKit capability,
and a physical iPhone; the Simulator has no Apple Watch data):

1. In `health_monitor_ios`: `git checkout fitcheckin-sync` (or `git am ios/0001-*.patch`).
2. `cp Config/FitCheckIn.local.xcconfig.example Config/FitCheckIn.local.xcconfig` and set
   `FITCHECKIN_SUPABASE_URL` + `FITCHECKIN_SUPABASE_ANON_KEY` (public key only).
3. `xcodegen generate`, open the project, select your team, run on the iPhone.
4. In the app: Today → **FitCheck-In** (top left) → sign in with a **client** account →
   choose data types → **Sync now** → accept the Apple Health prompt.
5. Open the web app as that client → Health shows the data with its source and timestamps.

What was verified without a device: the module type-checks against the HealthKit SDK
together with the original `DomainModels`/`DerivedMetricsEngine` (macOS slice — only three
iOS-only SwiftUI modifiers could not be checked there), and the **exact JSON produced by
the Swift encoder** is accepted by the live `health-ingest` function. What still needs a
real iPhone: HealthKit authorization UI, reading real samples, background delivery.

## 7. Demo mode for the course video

`/auth?demo=1` → **Create demo workspace** creates a private sandbox (demo trainer + demo
client) filled with **simulated** data: 30 days of HRV/RHR/sleep/steps/workouts, 3 past
sessions with check-ins/feedback/notes, and one upcoming session. Everything is labelled
"Demo data" in the UI. Demo accounts can never be linked with real accounts and demo
samples can never be attached to a real user (database constraints); demo accounts cannot
upload HealthKit data and are purged after 24 h.

Suggested recording script: client on phone fills the check-in (show a validation error
first) → trainer on laptop sees it appear live → trainer marks it reviewed, logs the
session and a shared note → refresh both → client opens History and leaves feedback →
switch language and theme. Full script: [`docs/TESTING.md`](docs/TESTING.md).

## 8. Security & privacy model

* **Roles are server-side.** `profiles.role` is set once by a trigger from sign-up metadata
  and is not updatable (column grants). Every write policy re-checks the role in SQL.
* **Isolation by RLS on every table**, deny-by-default grants, column-level insert/update
  grants (owner ids, role, `is_demo`, `origin`, `reviewed_at` cannot be written by users).
* **Check-ins are addressed to one trainer.** A client with several trainers shares a
  check-in only with the trainer it was sent to; notes are private unless marked shared.
* **Health data:** written only by `health-ingest` after JWT verification; trainers read
  it per category only while the relationship is active and the client granted that
  category; ending a relationship revokes all grants. Clients can delete all synced data.
* **HealthKit permission and trainer sharing are separate** (iPhone prompt vs. web toggles).
* **Secrets:** only the public anon/publishable key is shipped to browser and iPhone. The
  iOS session lives in the Keychain (`AfterFirstUnlockThisDeviceOnly`). Health values are
  never logged.

## 9. Feature status

### Implemented and tested end-to-end (local Supabase stack)

- [x] Sign-up / sign-in / sign-out for trainer and client portals; DB-enforced role routing
- [x] Profiles (name, bio, time zone, language synced to account)
- [x] Invitations (code + link, optional email binding, expiry, revoke); client accepts with per-category health sharing
- [x] Multiple trainers per client with private, per-trainer check-ins and notes
- [x] Pre-session check-in with validation, pain-area chips and pain warning
- [x] **Real-time** trainer dashboard (stats, needs-attention, latest check-ins, recent sessions)
- [x] Client list with search, filter, sort; client detail with tabs
- [x] Sessions with exercises (sets/reps/weight), intensity, status; edit & persistence
- [x] Trainer notes (private/shared, rating, recommendations), edit/delete
- [x] Post-session feedback (RPE, enjoyment, pain, comments)
- [x] Client history timeline; health trend charts with baseline + table view
- [x] Sharing revocation, device unlink, delete-all-health-data, delete account
- [x] Apple Health ingest API (auth, validation, dedupe, snapshot scoring)
- [x] Ported health+ engine (golden-verified) + readiness v2 (personal-baseline model, fixes stress bias, check-in aware)
- [x] Session-RPE training load: strength counted correctly, coach sessions count without a watch, Apple Workout Effort (iOS 18+)
- [x] Extra Apple Health data (SpO₂, respiratory rate, wrist temperature, VO₂ max, heart-rate recovery, running/cycling dynamics, distances, flights, mobility, body) with 8 fitness & health score cards
- [x] Per-category redaction of health snapshots for trainers (server-side)
- [x] Demo mode with simulated, labelled, isolated data
- [x] EN / 简体中文 / 繁體中文 (Taiwan wording) everywhere; browser default (zh-TW/HK/MO/Hant → Traditional), instant switch, saved to the account
- [x] Light / dark / system theme; reduced motion & reduced transparency fallbacks
- [x] Responsive desktop / tablet / phone (floating tab bar on mobile)

### Implemented, needs real-device / account verification

- [x] Apple Health import from the iPhone browser (QR pairing, on-phone parsing, upload-only token)
- [ ] Health import with a real iPhone export in Safari (file picker, device speed/memory)
- [ ] iOS FitCheckInSync on a physical iPhone (HealthKit prompt, real samples, background delivery)
- [ ] Hosted Supabase project + Vercel deployment (instructions above; requires your credentials)
- [ ] Email confirmation flow with a real SMTP provider (disabled locally)

### Not implemented (out of scope for this iteration)

- Automatic push notifications to trainers (realtime works while the dashboard is open)
- Password reset UI (Supabase supports it; page not built)
- Exporting data (CSV/PDF)
- Native iOS client UI beyond the sync sheet (clients use the web app)
