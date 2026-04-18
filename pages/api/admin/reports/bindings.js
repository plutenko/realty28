import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

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
    const [realtorsRes, membersRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, name, email, role, submits_reports, telegram_user_id, is_active')
        .in('role', ['realtor', 'manager'])
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('telegram_chat_members')
        .select('telegram_user_id, username, first_name, last_name, is_ignored, last_seen_at')
        .order('first_name', { nullsFirst: false }),
    ])
    if (realtorsRes.error) return res.status(500).json({ error: realtorsRes.error.message })
    if (membersRes.error) return res.status(500).json({ error: membersRes.error.message })

    const memberById = Object.fromEntries((membersRes.data || []).map((m) => [m.telegram_user_id, m]))
    const realtors = (realtorsRes.data || []).map((p) => ({
      ...p,
      telegram_member: p.telegram_user_id ? memberById[p.telegram_user_id] || null : null,
    }))
    const boundIds = new Set(
      (realtorsRes.data || []).map((p) => p.telegram_user_id).filter(Boolean)
    )
    const unboundMembers = (membersRes.data || []).filter((m) => !boundIds.has(m.telegram_user_id))

    return res.status(200).json({
      realtors,
      unboundMembers,
      allMembers: membersRes.data || [],
    })
  }

  if (req.method === 'PATCH') {
    const { action, user_id, telegram_user_id, value } = req.body || {}

    if (action === 'bind') {
      if (!user_id || !telegram_user_id) return res.status(400).json({ error: 'user_id и telegram_user_id обязательны' })
      // Снять привязку у других пользователей с таким же telegram_user_id
      await supabase.from('profiles').update({ telegram_user_id: null }).eq('telegram_user_id', telegram_user_id)
      const { error } = await supabase.from('profiles').update({ telegram_user_id }).eq('id', user_id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'unbind') {
      if (!user_id) return res.status(400).json({ error: 'user_id обязателен' })
      const { error } = await supabase.from('profiles').update({ telegram_user_id: null }).eq('id', user_id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'toggle_submits') {
      if (!user_id || typeof value !== 'boolean') return res.status(400).json({ error: 'user_id и value (bool) обязательны' })
      const { error } = await supabase.from('profiles').update({ submits_reports: value }).eq('id', user_id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (action === 'ignore_member') {
      if (!telegram_user_id || typeof value !== 'boolean') return res.status(400).json({ error: 'telegram_user_id и value (bool) обязательны' })
      const { error } = await supabase.from('telegram_chat_members').update({ is_ignored: value }).eq('telegram_user_id', telegram_user_id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Неизвестный action' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
