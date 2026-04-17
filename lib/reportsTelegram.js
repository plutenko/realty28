/**
 * Обёртка для Telegram Bot API — бот отчётов @sobr_reports_bot.
 * Отдельно от lib/telegram.js (который работает с логин-ботом).
 * Токен: TELEGRAM_REPORTS_BOT_TOKEN.
 */

const API = 'https://api.telegram.org/bot'

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
  try {
    const res = await fetch(`${API}${t}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) console.warn('[reports-tg]', method, 'failed', data)
    return data
  } catch (e) {
    console.error('[reports-tg] network error', method, e)
    return { ok: false, error: String(e?.message || e) }
  }
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
