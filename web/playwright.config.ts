import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests run against a REAL local Supabase stack (auth, Postgres+RLS, realtime,
 * edge functions). Start it first:
 *   npx supabase start && npx supabase functions serve --env-file supabase/functions/.env.local
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' }, grep: /@mobile/ },
  ],
})
