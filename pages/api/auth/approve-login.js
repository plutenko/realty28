import { getSupabaseAdmin } from '../../../lib/supabaseServer'

/**
 * POST /api/auth/approve-login
 * Body: { token, action: 'approve' | 'reject' }
 * Headers: Authorization: Bearer <access_token> (токен админа/менеджера)
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { token, action } = req.body || {}
  if (!token || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid request' })
  }

  const authToken = req.headers.authorization?.replace('Bearer ', '')
  if (!authToken) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Server error' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authToken)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  // Проверяем что approver — админ или менеджер
  const { data: approverProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (approverProfile?.role !== 'admin' && approverProfile?.role !== 'manager') {
    return res.status(403).json({ error: 'Только админ или менеджер может подтверждать вход' })
  }

  // Находим pending_login
  const { data: pending } = await supabase
    .from('pending_logins')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (!pending) return res.status(404).json({ error: 'Запрос не найден' })
  if (pending.status !== 'pending') {
    return res.status(400).json({ error: `Запрос уже ${pending.status}` })
  }
  if (new Date(pending.expires_at) < new Date()) {
    await supabase.from('pending_logins').update({ status: 'expired' }).eq('id', pending.id)
    return res.status(400).json({ error: 'Срок действия запроса истёк' })
  }

  if (action === 'approve') {
    const nowIso = new Date().toISOString()
    const { error: devErr } = await supabase.from('user_devices').upsert(
      {
        user_id: pending.user_id,
        device_hash: pending.device_hash,
        label: pending.device_label,
        last_approved_at: nowIso,
        last_used_at: nowIso,
      },
      { onConflict: 'user_id,device_hash' }
    )
    if (devErr) {
      console.error('[approve-login] device upsert error', devErr)
      return res.status(500).json({ error: 'Не удалось зарегистрировать устройство' })
    }

    await supabase
      .from('pending_logins')
      .update({
        status: 'approved',
        approved_by: user.id,
        approved_at: nowIso,
      })
      .eq('id', pending.id)

    return res.status(200).json({ ok: true, status: 'approved' })
  } else {
    await supabase
      .from('pending_logins')
      .update({
        status: 'rejected',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', pending.id)

    return res.status(200).json({ ok: true, status: 'rejected' })
  }
}
