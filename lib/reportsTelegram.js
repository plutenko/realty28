/**
 * Обёртка для Telegram Bot API — бот отчётов @sobr_reports_bot.
 * Отдельно от lib/telegram.js (который работает с логин-ботом).
 * Токен: TELEGRAM_REPORTS_BOT_TOKEN.
 */

/**
 * Base Telegram API. Можно переопределить TELEGRAM_REPORTS_API_BASE
 * (или глобальным TELEGRAM_API_BASE), чтобы отправлять через CF-Worker-прокси,
 * когда Timeweb теряет коннект к api.telegram.org (РКН-фильтры российского
 * NAT'а). Формат: `https://<host>` без завершающего `/` — дальше код
 * дописывает `/bot<TOKEN>/<method>`.
 */
function apiBase() {
  const raw = (process.env.TELEGRAM_REPORTS_API_BASE || process.env.TELEGRAM_API_BASE || '').trim()
  if (raw) return raw.replace(/\/+$/, '')
  return 'https://api.telegram.org'
}
const API = `${apiBase()}/bot`

function token() {
  return process.env.TELEGRAM_REPORTS_BOT_TOKEN
}

function groupChatId() {
  return process.env.TELEGRAM_REPORTS_GROUP_CHAT_ID
}

export function hasReportsBotConfigured() {
  return Boolean(token())
}

async function call(method, body) {
  const t = token()
  if (!t) {
    console.warn('[reports-tg] TELEGRAM_REPORTS_BOT_TOKEN not set')
    return { ok: false, error: 'no_token' }
  }
  // Ретраи на Connect Timeout'ы от Timeweb к api.telegram.org (тот же паттерн
  // что в lib/telegram.js). Без них реакции на отчёты молча не ставились.
  // Таймауты Timeweb → api.telegram.org в плохие дни бывают длинные.
  // Даём одиночному запросу 20s, общий бюджет 3*20 + задержки ≈ 65s,
  // что вписывается в cron-job.org requestTimeout=120 и в webhook'овый лимит.
  const delays = [0, 2000, 5000]
  let lastErr = null
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]))
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)
      const res = await fetch(`${API}${t}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await res.json()
      if (data.ok) return data
      // 4xx кроме 429 — бизнес-ошибка, не ретраим
      const code = data.error_code
      if (code && code >= 400 && code < 500 && code !== 429) {
        console.warn('[reports-tg]', method, 'rejected', data)
        return data
      }
      lastErr = data
      console.warn(`[reports-tg] ${method} attempt ${i+1}/${delays.length} failed:`, data)
    } catch (e) {
      lastErr = { ok: false, error: String(e?.message || e) }
      console.warn(`[reports-tg] ${method} attempt ${i+1}/${delays.length} network error:`, e?.message || e)
    }
  }
  console.error(`[reports-tg] ${method} gave up after retries`, lastErr)
  return lastErr || { ok: false, error: 'unknown' }
}

export function sendMessage(chatId, text, { replyToMessageId, disableWebPagePreview = true, parseMode } = {}) {
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: disableWebPagePreview,
  }
  if (parseMode) body.parse_mode = parseMode
  if (replyToMessageId) {
    body.reply_parameters = { message_id: replyToMessageId, allow_sending_without_reply: true }
  }
  return call('sendMessage', body)
}

export function deleteMessage(chatId, messageId) {
  return call('deleteMessage', { chat_id: chatId, message_id: messageId })
}

/**
 * Ставит или снимает одну реакцию от бота на сообщение.
 * Реакции только из дефолтного набора (без Premium): 👍 👎 ❤️ 🔥 👌 🤔 и т.п.
 * Пустой emoji — снять реакцию.
 */
export function setMessageReaction(chatId, messageId, emoji) {
  const reaction = emoji ? [{ type: 'emoji', emoji }] : []
  return call('setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction,
    is_big: false,
  })
}

/**
 * Inline-попытка setMessageReaction, при неудаче — запись в pending_reactions.
 * Воркер /api/reports/retry-reactions дожмёт позже (крон-job.org раз в минуту).
 * Нужен из-за Timeweb Connect Timeout'ов к api.telegram.org (см. feedback_timeweb_network_retries).
 */
export async function setMessageReactionWithQueue(supabase, chatId, messageId, emoji) {
  if (!emoji) return { ok: true, queued: false }
  try {
    const data = await setMessageReaction(chatId, messageId, emoji)
    if (data?.ok) return { ok: true, queued: false }
    // Бизнес-ошибка Telegram (например, reaction_big и т.д.) — не ретраим, просто лог.
    const errCode = data?.error_code
    if (errCode && errCode >= 400 && errCode < 500 && errCode !== 429) {
      console.warn('[reactions] business-error, not queuing', data)
      return { ok: false, queued: false, reason: data?.description || 'business_error' }
    }
    return await enqueueReaction(supabase, chatId, messageId, emoji, data?.description || data?.error || 'unknown')
  } catch (e) {
    return await enqueueReaction(supabase, chatId, messageId, emoji, String(e?.message || e))
  }
}

async function enqueueReaction(supabase, chatId, messageId, emoji, reason) {
  if (!supabase) return { ok: false, queued: false, reason }
  try {
    await supabase.from('pending_reactions').upsert(
      {
        chat_id: chatId,
        message_id: messageId,
        emoji,
        attempts: 0,
        next_try_at: new Date(Date.now() + 30_000).toISOString(),
        last_error: String(reason || '').slice(0, 500),
      },
      { onConflict: 'chat_id,message_id' }
    )
    return { ok: false, queued: true, reason }
  } catch (e) {
    console.error('[reactions] enqueue failed', e)
    return { ok: false, queued: false, reason }
  }
}

export function setWebhook(url, secretToken) {
  const body = {
    url,
    allowed_updates: ['message', 'edited_message', 'my_chat_member'],
    drop_pending_updates: true,
  }
  if (secretToken) body.secret_token = secretToken
  return call('setWebhook', body)
}

export function deleteWebhook() {
  return call('deleteWebhook', { drop_pending_updates: true })
}

export function getWebhookInfo() {
  return call('getWebhookInfo', {})
}

export function getMe() {
  return call('getMe', {})
}

export function sendToGroup(text, opts = {}) {
  const gid = groupChatId()
  if (!gid) return Promise.resolve({ ok: false, error: 'no_group_chat_id' })
  return sendMessage(gid, text, opts)
}

/**
 * Формирует упоминание пользователя для Telegram:
 * - если есть username — @username
 * - иначе — HTML-ссылка tg://user?id=... (требует parse_mode: HTML)
 */
export function formatMention(user, mode = 'username_with_fallback') {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'участник'
  if (mode === 'plain') return name
  if (mode === 'link_only') {
    return `<a href="tg://user?id=${user.telegram_user_id}">${escapeHtml(name)}</a>`
  }
  // username_with_fallback
  if (user.username) return `@${user.username}`
  return `<a href="tg://user?id=${user.telegram_user_id}">${escapeHtml(name)}</a>`
}

export function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
