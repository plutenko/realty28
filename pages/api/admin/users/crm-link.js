import crypto from 'crypto'
import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

/**
 * POST /api/admin/users/crm-link  { user_id }
 * Генерирует одноразовый код и ссылку для привязки Домовой-бота указанному
 * риелтору. После того как он откроет ссылку и отправит /start <code>,
 * profiles.telegram_chat_id у него заполнится, и он начнёт получать лиды.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authToken = req.headers.authorization?.replace('Bearer ', '')
  if (!authToken) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Server error' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authToken)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { data: actor } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!['admin', 'manager'].includes(actor?.role)) {
    return res.status(403).json({ error: 'Только admin/manager' })
  }

  const { user_id } = req.body || {}
  if (!user_id) return res.status(400).json({ error: 'user_id обязателен' })

  const { data: target } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .eq('id', user_id)
    .single()
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' })

  const code = crypto.randomBytes(8).toString('hex')
  const { error: updErr } = await supabase
    .from('profiles')
    .update({ telegram_link_code: code })
    .eq('id', user_id)
  if (updErr) return res.status(500).json({ error: updErr.message })

  let botUsername = process.env.TELEGRAM_BOT_USERNAME || ''
  if (!botUsername && process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const meRes = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`
      )
      const me = await meRes.json()
      if (me?.ok && me?.result?.username) botUsername = me.result.username
    } catch {}
  }

  const link = botUsername ? `https://t.me/${botUsername}?start=${code}` : null

  return res.status(200).json({
    ok: true,
    code,
    link,
    botUsername,
    target: { id: target.id, name: target.name, email: target.email, role: target.role },
  })
}
