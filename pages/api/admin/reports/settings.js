import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { invalidateReportsSettingsCache } from '../../../../lib/reportsSettings'

async function requireAdmin(req, supabase) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  const caller = await requireAdmin(req, supabase)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('reports_settings')
      .select('settings, updated_at')
      .eq('id', 1)
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data || { settings: null, updated_at: null })
  }

  if (req.method === 'PUT') {
    const { settings } = req.body || {}
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings (object) обязателен' })
    }
    const { error } = await supabase
      .from('reports_settings')
      .update({ settings, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (error) return res.status(500).json({ error: error.message })
    invalidateReportsSettingsCache()
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
