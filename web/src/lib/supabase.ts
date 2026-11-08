import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { env, isConfigured } from './env'

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]

export const supabase = createClient<Database>(
  isConfigured ? env.supabaseUrl : 'http://localhost:54321',
  isConfigured ? env.supabaseAnonKey : 'missing-key',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'fitcheckin.auth' },
    realtime: { params: { eventsPerSecond: 5 } },
  },
)
