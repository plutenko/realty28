import { getSupabaseAdmin } from '../../../lib/supabaseServer'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Supabase admin is not configured' })

  const { data, error } = await supabase
    .from('sources')
    .select('id, name, type, url, building_id')
    .order('id', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ items: data || [] })
}

