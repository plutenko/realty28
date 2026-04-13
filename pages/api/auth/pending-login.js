import { getSupabaseAdmin } from '../../../lib/supabaseServer'

/**
 * GET /api/auth/pending-login?token=xxx
 * Headers: Authorization: Bearer <access_token> (админ или менеджер)
 * Возвращает данные pending_login + инфу о риелторе.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const token = String(req.query.token || '').trim()
  if (!token) return res.status(400).json({ error: 'Token required' })

  const authToken = req.headers.authorization?.replace('Bearer ', '')
  if (!authToken) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Server error' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authToken)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { data: approverProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (approverProfile?.role !== 'admin' && approverProfile?.role !== 'manager') {
    return res.status(403).json({ error: 'Только админ или менеджер' })
  }

  const { data: pending } = await supabase
    .from('pending_logins')
    .select('id, status, device_label, created_at, expires_at, user_id')
    .eq('token', token)
    .maybeSingle()

  if (!pending) return res.status(404).json({ error: 'Запрос не найден' })

  const { data: realtor } = await supabase
    .from('profiles')
    .select('name, email')
    .eq('id', pending.user_id)
    .maybeSingle()

  return res.status(200).json({
    ok: true,
    pending: {
      id: pending.id,
      status: pending.status,
      device_label: pending.device_label,
      created_at: pending.created_at,
      expires_at: pending.expires_at,
      realtor: realtor || null,
    },
  })
}
