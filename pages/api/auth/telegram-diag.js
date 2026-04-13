import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import { sendTelegramMessage } from '../../../lib/telegram'

/**
 * GET /api/auth/telegram-diag
 * Диагностика Telegram-интеграции. Доступно админу/менеджеру.
 * Возвращает состояние токена, список получателей, инфу по вашему профилю
 * и пытается отправить тестовое сообщение если есть chat_id.
 */
export default async function handler(req, res) {
  const authToken = req.headers.authorization?.replace('Bearer ', '')
  if (!authToken) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Server error' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authToken)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, name, email, telegram_chat_id, telegram_link_code')
    .eq('id', user.id)
    .single()

  if (me?.role !== 'admin' && me?.role !== 'manager') {
    return res.status(403).json({ error: 'Только админ или менеджер' })
  }

  const { data: recipients } = await supabase
    .from('profiles')
    .select('id, name, email, role, telegram_chat_id')
    .in('role', ['admin', 'manager'])

  const withChatId = (recipients ?? []).filter(r => r.telegram_chat_id)
  const withoutChatId = (recipients ?? []).filter(r => !r.telegram_chat_id)

  const { data: allDevices } = await supabase
    .from('user_devices')
    .select('id, user_id, label, created_at, last_used_at')
    .order('last_used_at', { ascending: false })

  const { data: realtorProfiles } = await supabase
    .from('profiles')
    .select('id, name, email, role')

  const profileById = Object.fromEntries((realtorProfiles ?? []).map(p => [p.id, p]))
  const devicesFull = (allDevices ?? []).map(d => ({
    id: d.id,
    user: profileById[d.user_id]
      ? `${profileById[d.user_id].name || profileById[d.user_id].email} (${profileById[d.user_id].role})`
      : `orphan:${d.user_id}`,
    label: d.label,
    created_at: d.created_at,
    last_used_at: d.last_used_at,
  }))

  const { data: recentPending } = await supabase
    .from('pending_logins')
    .select('id, user_id, token, status, device_label, created_at, expires_at')
    .order('created_at', { ascending: false })
    .limit(10)

  const pendingFull = (recentPending ?? []).map(p => ({
    id: p.id,
    user: profileById[p.user_id]
      ? `${profileById[p.user_id].name || profileById[p.user_id].email} (${profileById[p.user_id].role})`
      : `orphan:${p.user_id}`,
    status: p.status,
    device_label: p.device_label,
    created_at: p.created_at,
    expires_at: p.expires_at,
  }))

  // Проверим getMe через Telegram API
  let botInfo = null
  let botError = null
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`)
      const j = await r.json()
      if (j.ok) botInfo = j.result
      else botError = j.description || 'getMe failed'
    } catch (e) {
      botError = String(e?.message || e)
    }
  }

  // Пытаемся отправить тестовое сообщение вам, если у вас есть chat_id
  let testSend = null
  if (me.telegram_chat_id) {
    const result = await sendTelegramMessage(
      me.telegram_chat_id,
      `🧪 <b>Тест</b>\n\nДиагностика Telegram-интеграции. Если вы это видите — всё работает.\nВремя: ${new Date().toLocaleString('ru-RU')}`
    )
    testSend = {
      ok: result?.ok === true,
      error: result?.ok ? null : (result?.description || result?.error || 'unknown'),
    }
  }

  return res.status(200).json({
    env: {
      TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || null,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || null,
    },
    bot: botInfo ? { username: botInfo.username, id: botInfo.id, name: botInfo.first_name } : null,
    botError,
    me: {
      id: me.id,
      role: me.role,
      name: me.name,
      email: me.email,
      telegram_chat_id: me.telegram_chat_id,
      has_pending_link_code: Boolean(me.telegram_link_code),
    },
    recipients: {
      total: recipients?.length || 0,
      with_chat_id: withChatId.map(r => ({ name: r.name, email: r.email, role: r.role })),
      without_chat_id: withoutChatId.map(r => ({ name: r.name, email: r.email, role: r.role })),
    },
    devices: devicesFull,
    recentPending: pendingFull,
    testSend,
  })
}
