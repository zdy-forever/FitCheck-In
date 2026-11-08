# Testing the core flows

## Automated

```bash
# once
npx supabase start
cp supabase/functions/.env.example supabase/functions/.env.local
npx supabase functions serve --env-file supabase/functions/.env.local &   # keep running
export SUPABASE_ANON_KEY=$(npx supabase status -o env | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '"')

npm --prefix web run typecheck
npm --prefix web test                  # unit + golden vectors (no services needed)
npx supabase test db                   # RLS (pgTAP)
npm --prefix web run test:integration  # live Edge Function + Auth
npm --prefix web run test:e2e          # Playwright, two browser contexts
```

The E2E suite (`web/tests/e2e/core-flow.spec.ts`) uses one desktop context ("laptop",
trainer) and one 390×844 touch context ("phone", client) that never share state, so the
realtime step proves cross-device sync through Supabase rather than local state.

## Manual two-device script (also the demo-video script)

Use two different browsers/devices (e.g. laptop Chrome + phone Safari).

| # | Device | Action | Expected |
|---|---|---|---|
| 1 | Laptop | `/auth/trainer?mode=signup` → create trainer | Lands on trainer dashboard |
| 2 | Laptop | Invitations → Create invitation | 8-char code + link shown |
| 3 | Phone | Open link (or `/auth/client?mode=signup`, then Join a trainer) | Client account created, invite preview shows trainer name |
| 4 | Phone | Tick HRV, Sleep, Readiness estimates → Accept | Trainer appears under "My trainers" |
| 5 | Phone | Visit `/trainer` | Redirected back to `/client` (role from DB) |
| 6 | Phone | Check-in → Submit empty form | Inline errors + "Please fix the highlighted fields." |
| 7 | Phone | Fill sleep 4, energy 2, mental 3, soreness 6, pain 5 (Left knee), goal → Submit | Success screen; pain warning shown while pain ≥ 5 |
| 8 | Laptop | (do not reload) | Check-in appears in "Latest check-ins"; "Needs attention: Reported pain 5/10"; review counter +1 |
| 9 | Laptop | Mark as reviewed → open client → New session with exercises, status Completed → Save | "Session saved."; entering "five" in Reps shows "Enter a whole number." |
| 10 | Laptop | Add a note, set "Shared with client" → Save note | "Note saved." |
| 11 | Phone | History | Shared note + session with exercises (private notes never shown) |
| 12 | Phone | Give feedback → Send | "Feedback sent." |
| 13 | Both | Reload | Everything is still there |
| 14 | Phone | Settings → Health data sharing → turn HRV off | Laptop: client Health tab no longer shows HRV |
| 15 | Either | Language switch EN ↔ 中 | Whole UI changes instantly; persists after reload |
| 16 | Either | Theme switch Light / Dark / System | Applies instantly; persists after reload |

## Apple Health (real device)

1. Run the iOS app on an iPhone that has Apple Watch data (see README §6).
2. Today → FitCheck-In → sign in as the client from step 3 → Sync now.
3. Web (client) → Health: HRV / resting HR / sleep tiles show values with "Measured: …"
   timestamps and "Synced: …"; Algorithm estimates show a status badge
   (Full data / Limited data / Not enough data).
4. Web (trainer) → client → Health: only the categories granted in step 4 are visible.
5. Tap Sync now again → iOS shows "新增 / 已存在 0 / N" (idempotent, no duplicates).
6. Web (client) → Settings → Delete all my Apple Health data → Health page shows "No Apple Health data yet".
