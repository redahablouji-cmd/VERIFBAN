import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  Boolean(import.meta.env.VITE_ANTHROPIC_API_KEY)

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
