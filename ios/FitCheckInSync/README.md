# FitCheck-In Sync (iOS bridge)

Independent module that uploads selected Apple Health data to a FitCheck-In account.
It does **not** change how health+ reads, scores or displays data.

```
Apple Watch → Apple Health → HealthKit → FitCheckInHealthReader → FitCheckInAPIClient
            → HTTPS (user JWT) → Supabase Edge Function `health-ingest` → Postgres (RLS) → Web app
```

| File | Purpose |
|---|---|
| `FitCheckInModels.swift` | Wire format (mirrors `supabase/functions/_shared/metrics/health-schema.ts`), errors, sync state |
| `FitCheckInAPIClient.swift` | Supabase Auth (email+password → JWT, refresh), Keychain session storage, HTTPS upload |
| `FitCheckInHealthReader.swift` | HealthKit authorization + anchored sample reads (UUID dedupe), daily buckets, background delivery |
| `FitCheckInSyncManager.swift` | Orchestration: batching (≤1000), retry with backoff, persisted status, device unlink |
| `FitCheckInSyncView.swift` | SwiftUI sheet opened from the **Today** toolbar (“FitCheck-In” button) |

Integration footprint in existing files: 2 lines in `HealthMonitorApp.swift` (inject manager),
1 toolbar item + 1 sheet in `TodayDashboardView.swift`, Info.plist keys + background-delivery
entitlement + xcconfig in `project.yml`.

## Reused from health+

* `HealthPermissionState`, `WorkoutKind` (DomainModels.swift)
* HealthKit units, sleep-stage semantics and `HKWorkoutActivityType` mapping from `HealthKitService.swift`
* Scoring: the server runs a test-verified TypeScript port of `DerivedMetricsEngine.swift` (see the FitCheck-In repo).

## Configure

1. `cp Config/FitCheckIn.local.xcconfig.example Config/FitCheckIn.local.xcconfig`
2. Set `FITCHECKIN_SUPABASE_URL` and `FITCHECKIN_SUPABASE_ANON_KEY` (the **public** anon/publishable key).
   Never use the service-role / `sb_secret_` key — the app refuses to start sync with it.
3. `xcodegen generate` (project.yml is the source of truth), open in Xcode, select your team, run on an iPhone.
   HealthKit is not available in the iOS Simulator for real Apple Watch data.

## Privacy behaviour

* HealthKit read permission (system) and FitCheck-In trainer sharing (web Settings) are separate.
* Only enabled categories are read and uploaded; the server rejects samples outside them.
* Anchors are committed only after a successful upload → failed uploads are retried, nothing is skipped.
* “Unlink device” signs out, clears anchors and stops background delivery. Server-side data is deleted from the web app.
