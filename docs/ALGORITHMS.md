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

## 4. FitCheck-In readiness v2 (primary since `fitcheck-readiness@2.0.0`)

The faithful port above is kept (and still golden-tested) for reference, and its numbers
are shown in the UI as a small "original health+ composite" line. The **displayed**
Readiness / Recovery / Stress come from `supabase/functions/_shared/metrics/readiness-v2.ts`,
which fixes problems found in the original composite:

| # | Problem in health+ composite | Measured effect | v2 fix |
|---|---|---|---|
| 1 | Stress has a `+34` constant | A normal day scores stress **56** ("elevated") | Stress is centred on the person's own normal: normal day ≈ **35**, floor 10 |
| 2 | Absolute HRV/RHR thresholds compare people with each other | Two people exactly at their own normal: readiness **65** (HRV 25 ms) vs **72** (HRV 85 ms) — penalises age/genetics | Only within-person z-scores → both **65** |
| 3 | 7-day baseline includes today | Every deviation is shrunk | Baseline = previous days only (up to 28), ≥ 4 days required |
| 4 | Missing inputs replaced by constants; missing food intake assumed = 82 % of expenditure | Scores move with data that was never measured | Only measured signals; weights re-normalised over what exists |
| 5 | VO₂ "cardio score" can reach 125 | One long-term marker dominates a daily score | VO₂ max not used for daily readiness |
| 6 | Sleep debt vs fixed 8 h for everyone | A 7 h sleeper is always "in debt" | Compared with own typical sleep (bounded 7–9 h); extra sleep helps a little, short sleep hurts more |
| 7 | Readiness ⊃ Body Battery ⊃ Recovery ⊃ sleep/HRV | Same signals counted 3–4 times | Readiness = Recovery (each signal once) − load penalty + check-in adjustment |
| 8 | The client's own check-in was not used | Subjective state ignored | Energy, sleep quality, soreness and pain adjust readiness and appear as drivers |

### Formulas

For each signal (HRV, resting HR, sleep): `z = (today − personal mean) / max(personal SD, floor)`
over the previous ≤ 28 days (robust: one extreme value trimmed each side when ≥ 7 days).
Floors: HRV 7 % of mean, RHR 2 bpm, sleep 0.5 h. Signed so positive = better; clamped ±3.

* **Recovery** = `65 + 12 × Σ wᵢzᵢ / Σ wᵢ` (weights HRV 0.45, RHR 0.30, sleep 0.25, over
  available signals). 65 = "your normal day".
* **Stress** (physiological strain) = `35 − 15 × z_autonomic`, HRV and RHR only, floor 10.
* **Training load**: acute = last 7 days of workout load, chronic = previous 21 days ÷ 3.
  No penalty up to a ratio of 1.3; then 25 points per +1.0, capped at 15.
* **Check-in** (same local day): energy `(e−3)×3`, sleep quality `(q−3)×2`,
  soreness `−max(0,s−3)×1.2`, pain `−max(0,p−1)×1.5`.
* **Readiness** = Recovery − load penalty + check-in adjustment, clamped 0–100. With no
  wearable data but a check-in, a `limited` readiness is computed from the check-in alone.
* Status: `ok` with all 3 signals, `limited` with 2 (or check-in only), `insufficient`
  otherwise (value `null`). Every result lists its **drivers** in points.

### Same scenarios, before and after

| Scenario | health+ readiness / stress | v2 readiness / stress |
|---|---|---|
| Normal day (person with HRV ≈ 50) | 68 / **56** | 65 / **35** |
| Normal day, low-HRV person (25 ms) | **65** / 60 | **65** / 35 |
| Normal day, high-HRV person (85 ms) | **72** / 50 | **65** / 35 |
| Bad day: HRV −30 %, RHR +6, sleep 5.5 h | 45 / 83 | 29 / 80 |
| Great day: HRV +20 %, RHR −3, sleep 8.2 h | 77 / 44 | 88 / 10 |
| Normal day + check-in (energy 2, soreness 7, pain 5) | unchanged | 65 → 51 |
| Normal day + load spike (ratio 1.8) | small change | 65 → 52 |

Tests: `web/tests/metrics/readiness-v2.test.ts` (13 cases) and the live integration test
"readiness v2 end-to-end" (a real check-in lowers readiness through `refresh-snapshot`).

### v2 limitations

* Needs ≥ 4 days of history per signal; new users see "Not enough data" for the first days.
* Weights and point scales are reasoned defaults, not clinically validated. They are
  constants at the top of `readiness-v2.ts` so they can be tuned with real coaching data.
* Workout load still uses the health+ `estimateWorkoutLoad` (heart-rate based); strength
  sessions without heart rate are under-counted.

## 5. The sufficiency layer

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

Every stored snapshot carries `algorithmVersion = fitcheck-readiness@2.0.0`, the original
composite under `legacy` (`fitcheck-readiness@1.0.0+healthplus.668b85d`), `computedAt`, `engineSource` and its
completeness.

## 6. Inputs and time windows

| Input | Window | Source metric |
|---|---|---|
| Sleep last night (+ stages) | previous local noon → local noon | `sleep_analysis` (asleepCore/Deep/REM/Unspecified count; inBed/awake don't) |
| HRV / RHR "current" | most recent sample (must be ≤ 36 h for scoring) | `hrv_sdnn`, `resting_heart_rate` |
| HRV / RHR / sleep baselines | trailing 7 days (mean) | same |
| Steps / active energy targets | 7-day sum / 7 and 28-day trimmed mean | daily buckets |
| Training load | workouts in the last 28 days; acute = ≤ 7 calendar days | `workout` (duration, avg/max HR, kcal) |

## 7. Known limitations of the original health+ composite

* **Nutrition, mobility, body composition and VO₂max are not synced by default**, so the
  engine uses its neutral defaults for them. These carry small weights in readiness
  (≤ 6 % each) and are always listed under "used a neutral default".
* The original composite (still computed as `legacy`) keeps its +34 stress constant and
  absolute thresholds by design, so the port stays verifiably equivalent. v2 fixes both
  for everything that is displayed (section 4).
* Workout load uses the average/max heart rate of the workout. When max HR is missing the
  original fallback (`avg × 1.12`, then `208 − 0.7 × age`, then 185) is used.
* Age and biological sex are not uploaded (privacy minimisation), so the engine uses its
  default age 35 for the VO₂ and health-age parts. FitCheck-In does not display Health Age.
* HRV (SDNN) from Apple Watch is measured opportunistically. A single low reading moves
  the score; compare trends, not single days.
* The weights come from health+ and are heuristic. They have not been clinically validated.
