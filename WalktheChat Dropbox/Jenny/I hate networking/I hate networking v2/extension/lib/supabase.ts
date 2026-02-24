import { createClient } from '@supabase/supabase-js'

// These are public/anon keys — safe to embed in extension
export const SUPABASE_URL      = 'https://urgibxjxbcyvprdejplp.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZ2lieGp4YmN5dnByZGVqcGxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4ODQzNDIsImV4cCI6MjA4NzQ2MDM0Mn0.TC_WK5oMbvwpiH4WdSvTtTTzENTObiJqp_akPanVj9g'

export function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}
