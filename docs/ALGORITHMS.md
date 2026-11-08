# Health metrics: what was reused, how it was verified, and its limits

> Readiness, Recovery, Stress, Fatigue and Body Battery are **algorithmic estimates for
> coaching conversations**. They are not medical assessments, they do not diagnose
> anything, they do not predict injury, and FitCheck-In never uses them to decide
> automatically whether someone may train.

## 1. Source

| | |
|---|---|
| Repository | https://github.com/zdy-forever/health_monitor_ios |
| Commit | `668b85d7b00832bf80e4568aaadd069f875e9f4e` |
| Engine | `HealthMonitor/Sources/Services/DerivedMetricsEngine.swift` |
| Models | `HealthMonitor/Sources/Models/DomainModels.swift` |
| Data access | `HealthMonitor/Sources/Services/HealthKitService.swift` |

## 2. What was reused, and where

| Swift | Reused how | Location |
|---|---|---|
| `DerivedMetricsEngine.build` numeric path (sleep, HRV, RHR, body comp, nutrition, mobility, consistency, energy availability, activity pace, load capacity, fatigue, **recovery, stress, body battery, readiness, physical output, health age**, calibration profile, acute:chronic load, load status, load focus) | **1:1 TypeScript port** | `supabase/functions/_shared/metrics/engine.ts` |
| `estimateWorkoutLoad`, `estimateZoneDistribution` | 1:1 port | same |
| `Calendar.current` day/week arithmetic | DST-aware port with explicit IANA time zone | `.../metrics/calendar.ts` |
| `HealthKitService` aggregation semantics (noon→noon sleep window, asleep stages, latest HRV/RHR, 7-day baselines, 28-day workouts) | Re-implemented over stored samples | `.../metrics/aggregate.ts` |
| HealthKit units, sleep-stage switch, `HKWorkoutActivityType → WorkoutKind`, `HealthPermissionState`, `WorkoutKind` | **Used directly in Swift** | `ios/FitCheckInSync/*` (on branch `fitcheckin-sync` of the iOS repo) |

**Not ported (not relevant to a coach platform):** journal sentiment analysis, supplement
insights, Chinese recommendation strings, intraday battery timeline, health-age factor
texts. Text outputs became language-neutral keys (`underloaded`, `balanced`, …) so the
web app can translate them.

## 3. Equivalence verification

`tools/swift-golden/generate.sh` compiles the **original, unmodified** Swift files with the
command-line Swift toolchain, with exactly two mechanical substitutions applied to a
scratch copy:

1. `private static func` → `static func` (so intermediate sub-scores can be recorded), and
2. `Date()` → `GoldenClock.now` (a fixed clock, so outputs are reproducible).

No numeric code is changed. It records **62 scenarios × 2 time zones** (Australia/Sydney
and America/New_York — the latter has a DST change inside the 28-day window) plus 40
workout-load cases, covering every density from "no data at all" to "everything present".

`web/tests/metrics/engine.golden.test.ts` replays those inputs through the TypeScript
port and requires every derived score, calibration field, load figure and intermediate
sub-score to match within 1e-6.

* Result: **128/128 pass**.
* Mutation check (done during development): changing one weight by 0.0001 → 124 failures;
  shifting the VO₂ age offset by one year → 22 failures; changing the week start → 64
  failures. The suite detects small deviations.

Regenerate after changing the Swift engine: `tools/swift-golden/generate.sh`.

## 4. The FitCheck-In sufficiency layer (`fitcheck-readiness@1.0.0`)

The original engine **always returns a number**: missing inputs are replaced by neutral
constants (HRV score 60, RHR score 60, sleep 55, nutrition 55, mobility 60, cardio 45,
energy availability 60 …). With *no data at all* it reports **Readiness ≈ 57 and
Recovery ≈ 60** (golden case `all-missing`). In a personal app with a "calibrating"
banner that is acceptable; on a coach platform it would be read as a measurement.

`assessment.ts` wraps the unmodified engine and decides what may be shown:

| Rule | Effect |
|---|---|
| Core inputs = last-night sleep, HRV (SDNN), resting HR — each must be ≤ 36 h old | Stale values are removed before scoring and listed as `staleInputs` |
| < 2 of 3 core values present | Readiness / Recovery / Stress / Body Battery = **`null`**, status `insufficient` |
| 2 of 3 present, or any 7-day baseline missing | Score shown with status `limited` |
| 3 of 3 present + 3 baselines | status `ok` |
| No workouts | Fatigue, acute:chronic ratio, load status = `null` |
| Every input that fell back to an engine default | Listed in `defaultedInputs` and shown in the UI ("Not measured — the estimate used a neutral default for: nutrition, mobility, …") |
| `completeness` | share of (3 core values + 3 baselines) present, 0–1 |

Every stored snapshot carries `algorithmVersion =
fitcheck-readiness@1.0.0+healthplus.668b85d`, `computedAt`, `engineSource` and its
completeness.

## 5. Inputs and time windows

| Input | Window | Source metric |
|---|---|---|
| Sleep last night (+ stages) | previous local noon → local noon | `sleep_analysis` (asleepCore/Deep/REM/Unspecified count; inBed/awake don't) |
| HRV / RHR "current" | most recent sample (must be ≤ 36 h for scoring) | `hrv_sdnn`, `resting_heart_rate` |
| HRV / RHR / sleep baselines | trailing 7 days (mean) | same |
| Steps / active energy targets | 7-day sum / 7 and 28-day trimmed mean | daily buckets |
| Training load | workouts in the last 28 days; acute = ≤ 7 calendar days | `workout` (duration, avg/max HR, kcal) |

## 6. Known limitations (stated honestly)

* **Nutrition, mobility, body composition and VO₂max are not synced by default**, so the
  engine uses its neutral defaults for them. These carry small weights in readiness
  (≤ 6 % each) and are always listed under "used a neutral default".
* **Stress has a +34 constant** in the original formula. With baseline-level HRV/RHR and
  average sleep it lands around 55–65. This is health+'s behaviour and was kept for
  equivalence; it is labelled as a physiological-strain estimate, not an emotional state.
* Workout load uses the average/max heart rate of the workout. When max HR is missing the
  original fallback (`avg × 1.12`, then `208 − 0.7 × age`, then 185) is used.
* Age and biological sex are not uploaded (privacy minimisation), so the engine uses its
  default age 35 for the VO₂ and health-age parts. FitCheck-In does not display Health Age.
* HRV (SDNN) from Apple Watch is measured opportunistically. A single low reading moves
  the score; compare trends, not single days.
* The weights come from health+ and are heuristic. They have not been clinically validated.
