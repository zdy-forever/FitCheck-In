/**
 * `VITE_SUPABASE_URL=same-origin` (local testing on a phone): talk to Supabase through the dev
 * server's `/sb` proxy, so a phone on the same Wi-Fi only needs to reach this computer.
 */
const rawUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
export const env = {
  supabaseUrl: rawUrl === 'same-origin' && typeof window !== 'undefined' ? `${window.location.origin}/sb` : rawUrl,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  demoMode: import.meta.env.VITE_DEMO_MODE === 'true',
}

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)

// Guard against the most dangerous misconfiguration: a secret key shipped to the browser.
if (/^sb_secret_/.test(env.supabaseAnonKey) || /"role"\s*:\s*"service_role"/.test(safeDecodeJwt(env.supabaseAnonKey))) {
  throw new Error('Refusing to start: VITE_SUPABASE_ANON_KEY is a secret/service-role key. Use the anon or publishable key.')
}

function safeDecodeJwt(token: string): string {
  try {
    const part = token.split('.')[1]
    return part ? atob(part.replace(/-/g, '+').replace(/_/g, '/')) : ''
  } catch {
    return ''
  }
}
