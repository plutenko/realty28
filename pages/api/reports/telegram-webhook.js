import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import {
  sendMessage,
  deleteMessage,
  setMessageReaction,
  sendToGroup,
  formatMention,
} from '../../../lib/reportsTelegram'
import { looksLikeReport, parseReport } from '../../../lib/reportsParser'
import {
  getReportsSettings,
  fillTemplate,
  pickDailyReportColumns,
} from '../../../lib/reportsSettings'

/**
 * Webhook бота @sobr_reports_bot.
 * Видит сообщения в общем чате агентства, парсит отчёты формата "Отчёт DD.MM".
 *
 * Обрабатывает:
 * - message / edited_message — парсит отчёт, ставит реакцию, шлёт реплай при ошибке
 * - my_chat_member — лог-строка при добавлении/удалении бота из чата
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end()

  const secret = req.headers['x-telegram-bot-api-secret-token']
  const expected = process.env.TELEGRAM_REPORTS_WEBHOOK_SECRET
  if (expected && secret !== expected) {
    return res.status(401).end()
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(200).json({ ok: true })

  const update = req.body || {}

  try {
    const message = update.message || update.edited_message
    if (message?.chat && message?.from && !message.from.is_bot) {
      await rememberChatMember(supabase, message.from)
      await handleMessage(supabase, message, { edited: Boolean(update.edited_message) })
    }
  } catch (e) {
    console.error('[reports-webhook] error', e)
  }

  return res.status(200).json({ ok: true })
}

async function rememberChatMember(supabase, from) {
  await supabase
    .from('telegram_chat_members')
    .upsert(
      {
        telegram_user_id: String(from.id),
        username: from.username || null,
        first_name: from.first_name || null,
        last_name: from.last_name || null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_user_id' }
    )
}

async function handleMessage(supabase, message, { edited }) {
  const text = String(message.text || message.caption || '').trim()
  if (!text) return

  const settings = await getReportsSettings(supabase)
  if (!settings) return

  if (!looksLikeReport(text, settings)) return

  const fromId = String(message.from.id)
  const chatId = message.chat.id
  const messageId = message.message_id

  // Ищем риелтора по telegram_user_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, email, role, telegram_user_id, submits_reports')
    .eq('telegram_user_id', fromId)
    .maybeSingle()

  if (!profile) {
    // Автор не привязан — молча запоминаем в chat_members, оповещаем админа (1 раз при первом сообщении)
    await notifyAdminUnknownUser(supabase, settings, message.from)
    return
  }

  if (!profile.submits_reports) {
    // В профиле сказано не принимать отчёты (директор/менеджер/сам не шлёт)
    return
  }

  // Парсим
  const now = new Date()
  const parsed = parseReport(text, settings, now)

  const displayName = profile.name || message.from.first_name || 'участник'
  const mention = formatMention(
    {
      telegram_user_id: fromId,
      username: message.from.username,
      first_name: message.from.first_name,
      last_name: message.from.last_name,
    },
    settings.mention_mode
  )

  if (!parsed.ok) {
    await applyInvalidReport(supabase, {
      chatId,
      messageId,
      profile,
      parsed,
      settings,
      displayName,
      mention,
      edited,
      rawText: text,
    })
    return
  }

  // Всё ок — апсёрт + реакция 👌 + удалить предыдущий error-reply если был
  await applyValidReport(supabase, {
    chatId,
    messageId,
    profile,
    parsed,
    settings,
    edited,
    rawText: text,
  })
}

async function applyValidReport(supabase, ctx) {
  const { chatId, messageId, profile, parsed, settings, rawText } = ctx

  const metricCols = pickDailyReportColumns(parsed.metrics)

  // Если уже был отчёт на тот же диапазон — найдём его error_reply_message_id для удаления
  const { data: existing } = await supabase
    .from('daily_reports')
    .select('id, error_reply_message_id, chat_message_id')
    .eq('user_id', profile.id)
    .eq('date_from', parsed.dateFrom)
    .eq('date_to', parsed.dateTo)
    .maybeSingle()

  const row = {
    user_id: profile.id,
    date_from: parsed.dateFrom,
    date_to: parsed.dateTo,
    chat_id: chatId,
    chat_message_id: messageId,
    error_reply_message_id: null,
    is_valid: true,
    raw_text: rawText,
    extra: parsed.extra || {},
    updated_at: new Date().toISOString(),
    ...metricCols,
  }

  const { error } = await supabase
    .from('daily_reports')
    .upsert(row, { onConflict: 'user_id,date_from,date_to' })
  if (error) {
    console.error('[reports-webhook] upsert error', error)
    return
  }

  // Удалить старый реплай-ошибку (если был)
  if (existing?.error_reply_message_id) {
    await deleteMessage(chatId, existing.error_reply_message_id).catch(() => {})
  }

  // Поставить реакцию "принят"
  await setMessageReaction(chatId, messageId, settings.reaction_accepted || '👌').catch(() => {})
}

async function applyInvalidReport(supabase, ctx) {
  const { chatId, messageId, profile, parsed, settings, displayName, mention, rawText } = ctx

  const errorText = buildErrorText(parsed.errors, settings, { name: mention })
  if (!errorText) return

  // Проверим есть ли уже запись: для невалидного отчёта диапазон неизвестен, поэтому ищем по chat_message_id
  const { data: existingByMsg } = await supabase
    .from('daily_reports')
    .select('id, error_reply_message_id, date_from, date_to')
    .eq('chat_message_id', messageId)
    .eq('chat_id', chatId)
    .maybeSingle()

  if (existingByMsg?.error_reply_message_id) {
    await deleteMessage(chatId, existingByMsg.error_reply_message_id).catch(() => {})
  }

  // Отправим новый реплай с причиной
  const reply = await sendMessage(chatId, errorText, {
    replyToMessageId: messageId,
    parseMode: 'HTML',
  })
  const replyId = reply?.result?.message_id || null

  // Реакция "не принят"
  await setMessageReaction(chatId, messageId, settings.reaction_rejected || '🤔').catch(() => {})

  // Если была прошлая запись под этим сообщением — обновим её error_reply_message_id
  if (existingByMsg) {
    await supabase
      .from('daily_reports')
      .update({
        is_valid: false,
        error_reply_message_id: replyId,
        raw_text: rawText,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingByMsg.id)
  }
  // Если не было — не создаём запись с null в date_from/date_to (NOT NULL constraint). Просто оставляем реплай в чате.
}

function buildErrorText(errors, settings, vars) {
  if (!errors || !errors.length) return null
  const msgs = settings.messages || {}
  const e = errors[0]
  switch (e.type) {
    case 'no_date':
      return fillTemplate(msgs.error_no_date, vars)
    case 'bad_date':
      return fillTemplate(msgs.error_bad_date, { ...vars, value: e.value })
    case 'future':
      return fillTemplate(msgs.error_future, { ...vars, value: e.value })
    case 'too_old':
      return fillTemplate(msgs.error_too_old, {
        ...vars,
        value: e.value,
        days: e.days,
      })
    case 'range_inverted':
      return fillTemplate(msgs.error_range_inverted, { ...vars, value: e.value })
    default:
      return null
  }
}

async function notifyAdminUnknownUser(supabase, settings, from) {
  // Ищем админа с telegram_chat_id
  const { data: admins } = await supabase
    .from('profiles')
    .select('telegram_chat_id')
    .eq('role', 'admin')
    .not('telegram_chat_id', 'is', null)

  if (!admins?.length) return

  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'участник'
  const text = fillTemplate(settings.messages?.admin_unknown_user || '', {
    name,
    id: from.id,
  })
  if (!text) return

  for (const a of admins) {
    await sendMessage(a.telegram_chat_id, text).catch(() => {})
  }
}
