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
      .from('profiles')
      .select('id, name, email, role, crm_enabled, telegram_chat_id, is_active')
      .eq('role', 'realtor')
      .eq('is_active', true)
      .order('name')
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(
      (data || []).map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        crm_enabled: r.crm_enabled === true,
        has_telegram: Boolean(r.telegram_chat_id),
      }))
    )
  }

  if (req.method === 'PATCH') {
    const { id, crm_enabled } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id обязателен' })
    if (typeof crm_enabled !== 'boolean') return res.status(400).json({ error: 'crm_enabled обязателен (boolean)' })

    // Разрешаем менять CRM только у риелторов
    const { data: target } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', id)
      .single()
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' })
    if (target.role !== 'realtor') return res.status(403).json({ error: 'CRM включается только риелторам' })

    const { error } = await supabase.from('profiles').update({ crm_enabled }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
