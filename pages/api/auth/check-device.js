import crypto from 'crypto'
import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import { computeDeviceHash, deviceLabelFromRequest } from '../../../lib/deviceFingerprint'
import { broadcastToRoles } from '../../../lib/telegram'
import { approveStillValid } from '../../../lib/workingDay'

/**
 * POST /api/auth/check-device
 * Body: { screen, platform, timezone }
 * Headers: Authorization: Bearer <access_token>
 *
 * Проверяет, зарегистрировано ли устройство риелтора.
 * Если нет — создаёт pending_login, шлёт уведомление в Telegram, возвращает token для polling.
 * Админы и менеджеры — всегда получают ok: true (без проверки устройства).
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Server error' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, name, email')
    .eq('id', user.id)
    .single()

  // Только для риелторов — остальным пропускаем
  if (profile?.role !== 'realtor') {
    return res.status(200).json({ ok: true, status: 'approved', role: profile?.role })
  }

  const userAgent = req.headers['user-agent'] || ''
  const clientHints = req.body || {}
  const deviceHash = computeDeviceHash({ userAgent, clientHints })
  const label = deviceLabelFromRequest({ userAgent, clientHints })

  // Проверяем, зарегистрировано ли уже и свеж ли approve (до 03:00 Asia/Yakutsk следующего дня)
  const { data: existing } = await supabase
    .from('user_devices')
    .select('id, last_approved_at')
    .eq('user_id', user.id)
    .eq('device_hash', deviceHash)
    .maybeSingle()

  if (existing && approveStillValid(existing.last_approved_at)) {
    await supabase
      .from('user_devices')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', existing.id)
    return res.status(200).json({ ok: true, status: 'approved' })
  }

  // Новое устройство — создаём pending_login
  const pendingToken = crypto.randomBytes(24).toString('hex')
  const { error: insErr } = await supabase.from('pending_logins').insert({
    user_id: user.id,
    device_hash: deviceHash,
    device_label: label,
    token: pendingToken,
    status: 'pending',
  })
  if (insErr) {
    console.error('[check-device] insert error', insErr)
    return res.status(500).json({ error: 'Не удалось создать запрос на подтверждение' })
  }

  // Отправляем уведомление в Telegram админам и менеджерам
  const realtorName = profile?.name || profile?.email || 'Риелтор'
  const message =
    `🔐 <b>Запрос на вход</b>\n\n` +
    `Риелтор: <b>${escapeHtml(realtorName)}</b>\n` +
    `Устройство: ${escapeHtml(label)}\n` +
    `Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yakutsk' })}`

  const replyMarkup = {
    inline_keyboard: [[
      { text: '✅ Разрешить', callback_data: `approve:${pendingToken}` },
      { text: '⛔ Отклонить', callback_data: `reject:${pendingToken}` },
    ]],
  }

  const sent = await broadcastToRoles(supabase, ['admin', 'manager'], message, { replyMarkup })
  const sentCount = sent.filter((s) => s.ok).length

  return res.status(200).json({
    ok: true,
    status: 'pending',
    token: pendingToken,
    label,
    sentToCount: sentCount,
  })
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
