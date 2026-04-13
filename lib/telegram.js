/**
 * Простая обёртка для Telegram Bot API.
 * Токен берётся из TELEGRAM_BOT_TOKEN.
 */

export function hasTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN)
}

export async function sendTelegramMessage(chatId, text, { replyMarkup } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN not set, skipping message')
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }
  }

  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }
  if (replyMarkup) body.reply_markup = replyMarkup

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) {
      console.error('[telegram] sendMessage failed', data)
    }
    return data
  } catch (e) {
    console.error('[telegram] network error', e)
    return { ok: false, error: String(e?.message || e) }
  }
}

export async function editTelegramMessage(chatId, messageId, text, { replyMarkup } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false }
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }
  if (replyMarkup) body.reply_markup = replyMarkup
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

export async function answerCallbackQuery(callbackQueryId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text || '' }),
    })
    return await res.json()
  } catch {
    return { ok: false }
  }
}

/**
 * Отправляет сообщение всем пользователям с указанной ролью у которых есть telegram_chat_id
 */
export async function broadcastToRoles(supabaseAdmin, roles, text, opts) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, telegram_chat_id, role, name, email')
    .in('role', roles)
    .not('telegram_chat_id', 'is', null)

  const sent = []
  for (const p of data ?? []) {
    if (!p.telegram_chat_id) continue
    const res = await sendTelegramMessage(p.telegram_chat_id, text, opts)
    sent.push({ userId: p.id, ok: res?.ok === true })
  }
  return sent
}
