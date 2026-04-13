import crypto from 'crypto'
import { getSupabaseAdmin } from '../../../lib/supabaseServer'

/**
 * POST /api/auth/generate-telegram-link
 * Генерирует одноразовый код и возвращает ссылку для привязки Telegram.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authToken = req.headers.authorization?.replace('Bearer ', '')
  if (!authToken) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Server error' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authToken)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' && profile?.role !== 'manager') {
    return res.status(403).json({ error: 'Доступно только админам и менеджерам' })
  }

  const code = crypto.randomBytes(8).toString('hex')
  const { error: updErr } = await supabase
    .from('profiles')
    .update({ telegram_link_code: code })
    .eq('id', user.id)

  if (updErr) return res.status(500).json({ error: updErr.message })

  // Пытаемся получить username через Telegram API если переменная не задана
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
  // Финальный fallback — known bot username
  if (!botUsername) botUsername = 'domovoy_login_bot'

  const link = botUsername ? `https://t.me/${botUsername}?start=${code}` : null

  return res.status(200).json({
    ok: true,
    code,
    link,
    botUsername,
  })
}
