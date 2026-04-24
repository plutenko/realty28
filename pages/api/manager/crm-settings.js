import { getSupabaseAdmin } from '../../../lib/supabaseServer'

async function requireAdminOrManager(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const supabase = getSupabaseAdmin()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!['admin', 'manager'].includes(profile?.role)) return null
  return { user, role: profile.role }
}

export default async function handler(req, res) {
  const caller = await requireAdminOrManager(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })
  const supabase = getSupabaseAdmin()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('crm_settings')
      .select('limits_enabled, limit_threshold')
      .eq('id', 1)
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data || { limits_enabled: false, limit_threshold: 10 })
  }

  if (req.method === 'PATCH') {
    const { limits_enabled, limit_threshold } = req.body || {}
    const updates = { updated_at: new Date().toISOString() }
    if (typeof limits_enabled === 'boolean') updates.limits_enabled = limits_enabled
    if (Number.isInteger(limit_threshold) && limit_threshold > 0) updates.limit_threshold = limit_threshold
    const { error } = await supabase.from('crm_settings').update(updates).eq('id', 1)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
