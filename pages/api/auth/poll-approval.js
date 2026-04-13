import { getSupabaseAdmin } from '../../../lib/supabaseServer'

/**
 * GET /api/auth/poll-approval?token=xxx
 * Возвращает статус pending_login по токену. Риелтор вызывает периодически.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const token = String(req.query.token || '').trim()
  if (!token) return res.status(400).json({ error: 'Token required' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Server error' })

  const { data, error } = await supabase
    .from('pending_logins')
    .select('id, status, expires_at, device_hash, user_id, device_label')
    .eq('token', token)
    .maybeSingle()

  if (error || !data) return res.status(404).json({ status: 'not_found' })

  // Проверяем expiry
  if (data.status === 'pending' && new Date(data.expires_at) < new Date()) {
    await supabase.from('pending_logins').update({ status: 'expired' }).eq('id', data.id)
    return res.status(200).json({ status: 'expired' })
  }

  return res.status(200).json({ status: data.status })
}
