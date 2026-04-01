import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ТВОЙ_PROJECT_ID.supabase.co'
const supabaseKey = 'ТВОЙ_ANON_KEY'

export const supabase = createClient(supabaseUrl, supabaseKey)