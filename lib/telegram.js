/**
 * Простая обёртка для Telegram Bot API.
 * Токен берётся из TELEGRAM_BOT_TOKEN.
 */

export function hasTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN)
}

function telegramApiBase() {
  // Позволяет маршрутизировать вызовы через Cloudflare Worker (обход РКН-фильтров Timeweb).
  return (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '')
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

  // Network timeouts to api.telegram.org регулярно ловятся из контейнера Timeweb
  // (UND_ERR_CONNECT_TIMEOUT). Ретраим с экспоненциальным backoff.
  const delays = [0, 1500, 3500] // ms
  let lastErr = null
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]))
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(`${telegramApiBase()}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await res.json()
      if (data.ok) return data
      // Telegram-level failures (403 bot blocked, 400 bad chat_id) — не ретраим, просто возвращаем
      const code = data.error_code
      if (code && code >= 400 && code < 500 && code !== 429) {
        console.error('[telegram] sendMessage rejected', data)
        return data
      }
      lastErr = data
      console.warn(`[telegram] attempt ${i+1}/${delays.length} failed:`, data)
    } catch (e) {
      lastErr = { ok: false, error: String(e?.message || e) }
      console.warn(`[telegram] attempt ${i+1}/${delays.length} network error:`, e?.message || e)
    }
  }
  console.error('[telegram] sendMessage gave up after retries', lastErr)
  return lastErr || { ok: false, error: 'unknown' }
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
    const res = await fetch(`${telegramApiBase()}/bot${token}/editMessageText`, {
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
    const res = await fetch(`${telegramApiBase()}/bot${token}/answerCallbackQuery`, {
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
