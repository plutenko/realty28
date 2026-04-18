import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import {
  sendMessage,
  deleteMessage,
  setMessageReaction,
  sendToGroup,
  formatMention,
} from '../../../lib/reportsTelegram'
import { classifyMessage, parseReport, parseAbsence } from '../../../lib/reportsParser'
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

  const kind = classifyMessage(text, settings)
  if (kind === 'none') return

  const fromId = String(message.from.id)
  const chatId = message.chat.id
  const messageId = message.message_id

  // Ищем риелтора по telegram_user_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, email, role, telegram_user_id, submits_reports, is_active')
    .eq('telegram_user_id', fromId)
    .maybeSingle()

  if (!profile) {
    await notifyAdminUnknownUser(supabase, settings, message.from)
    return
  }

  if (profile.is_active === false) {
    // Уволенный — не принимаем отчёты молча
    return
  }

  if (!profile.submits_reports) {
    return
  }

  // Момент отправки сообщения (unix timestamp от Telegram). Для edited_message — edit_date.
  const ts = message.edit_date || message.date
  const now = ts ? new Date(ts * 1000) : new Date()

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

  // Предыдущий реплай-ошибка/hint на это же сообщение
  const { data: priorError } = await supabase
    .from('report_error_replies')
    .select('error_reply_message_id')
    .eq('chat_id', chatId)
    .eq('chat_message_id', messageId)
    .maybeSingle()
  const priorErrorReplyId = priorError?.error_reply_message_id || null

  if (kind === 'template') {
    // Шаблон с метриками, но без маркера "Отчёт" — мягкий реплай-подсказка без реакции
    await applyTemplateHint(supabase, {
      chatId,
      messageId,
      settings,
      mention,
      priorErrorReplyId,
    })
    return
  }

  if (kind === 'absence') {
    const abs = parseAbsence(text, settings, now)
    if (!abs.ok) {
      await applyInvalidReport(supabase, {
        chatId,
        messageId,
        profile,
        parsed: abs,
        settings,
        displayName,
        mention,
        edited,
        rawText: text,
        priorErrorReplyId,
      })
      return
    }
    await applyAbsence(supabase, {
      chatId,
      messageId,
      profile,
      abs,
      settings,
      rawText: text,
      priorErrorReplyId,
    })
    return
  }

  // kind === 'report'
  const parsed = parseReport(text, settings, now)

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
      priorErrorReplyId,
    })
    return
  }

  await applyValidReport(supabase, {
    chatId,
    messageId,
    profile,
    parsed,
    settings,
    edited,
    rawText: text,
    priorErrorReplyId,
  })
}

async function applyTemplateHint(supabase, ctx) {
  const { chatId, messageId, settings, mention, priorErrorReplyId } = ctx
  const msgs = settings.messages || {}
  const hint = fillTemplate(
    msgs.hint_template_no_marker ||
      '💡 {name}, похоже на отчёт. Добавь первой строкой «Отчёт DD.MM» чтобы я записал.',
    { name: mention }
  )
  if (priorErrorReplyId) {
    await deleteMessage(chatId, priorErrorReplyId).catch(() => {})
  }
  const reply = await sendMessage(chatId, hint, {
    replyToMessageId: messageId,
    parseMode: 'HTML',
  })
  const replyId = reply?.result?.message_id || null
  if (replyId) {
    await supabase.from('report_error_replies').upsert(
      { chat_id: chatId, chat_message_id: messageId, error_reply_message_id: replyId },
      { onConflict: 'chat_id,chat_message_id' }
    )
  }
  // Реакция НЕ ставим — это просто подсказка, не принятый/отклонённый отчёт
}

async function applyAbsence(supabase, ctx) {
  const { chatId, messageId, profile, abs, settings, rawText, priorErrorReplyId } = ctx

  const row = {
    user_id: profile.id,
    date_from: abs.dateFrom,
    date_to: abs.dateTo,
    chat_id: chatId,
    chat_message_id: messageId,
    error_reply_message_id: null,
    is_valid: true,
    absence_type: abs.absenceType,
    raw_text: rawText,
    extra: {},
    updated_at: new Date().toISOString(),
    // метрики не заполняем — человек не работал
  }

  const { error } = await supabase
    .from('daily_reports')
    .upsert(row, { onConflict: 'user_id,date_from,date_to' })
  if (error) {
    console.error('[reports-webhook] absence upsert error', error)
    return
  }

  if (priorErrorReplyId) {
    await deleteMessage(chatId, priorErrorReplyId).catch(() => {})
    await supabase
      .from('report_error_replies')
      .delete()
      .eq('chat_id', chatId)
      .eq('chat_message_id', messageId)
  }

  await setMessageReaction(chatId, messageId, settings.reaction_accepted || '👌').catch(() => {})
}

async function applyValidReport(supabase, ctx) {
  const { chatId, messageId, profile, parsed, settings, rawText, priorErrorReplyId } = ctx

  const metricCols = pickDailyReportColumns(parsed.metrics)

  const row = {
    user_id: profile.id,
    date_from: parsed.dateFrom,
    date_to: parsed.dateTo,
    chat_id: chatId,
    chat_message_id: messageId,
    error_reply_message_id: null,
    is_valid: true,
    absence_type: null,
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

  // Удалить предыдущий реплай-ошибку (если был) и запись о нём
  if (priorErrorReplyId) {
    await deleteMessage(chatId, priorErrorReplyId).catch(() => {})
    await supabase
      .from('report_error_replies')
      .delete()
      .eq('chat_id', chatId)
      .eq('chat_message_id', messageId)
  }

  // Поставить реакцию "принят"
  await setMessageReaction(chatId, messageId, settings.reaction_accepted || '👌').catch(() => {})
}

async function applyInvalidReport(supabase, ctx) {
  const { chatId, messageId, settings, mention, priorErrorReplyId } = ctx

  const errorText = buildErrorText(ctx.parsed.errors, settings, { name: mention })
  if (!errorText) return

  // Снять предыдущий реплай-ошибку, если был
  if (priorErrorReplyId) {
    await deleteMessage(chatId, priorErrorReplyId).catch(() => {})
  }

  // Отправить новый реплай и запомнить его id
  const reply = await sendMessage(chatId, errorText, {
    replyToMessageId: messageId,
    parseMode: 'HTML',
  })
  const replyId = reply?.result?.message_id || null

  if (replyId) {
    await supabase.from('report_error_replies').upsert(
      {
        chat_id: chatId,
        chat_message_id: messageId,
        error_reply_message_id: replyId,
      },
      { onConflict: 'chat_id,chat_message_id' }
    )
  }

  // Если для этого же сообщения был валидный отчёт раньше (редко, но возможно при edit валид → невалид),
  // помечаем как невалидный в daily_reports
  await supabase
    .from('daily_reports')
    .update({ is_valid: false, updated_at: new Date().toISOString() })
    .eq('chat_id', chatId)
    .eq('chat_message_id', messageId)

  // Реакция "не принят"
  await setMessageReaction(chatId, messageId, settings.reaction_rejected || '🤔').catch(() => {})
}

function buildErrorText(errors, settings, vars) {
  if (!errors || !errors.length) return null
  const msgs = settings.messages || {}
  const e = errors[0]
  const base = { ...vars, value: e.value }
  switch (e.type) {
    case 'no_date':
      return fillTemplate(msgs.error_no_date, vars)
    case 'bad_date':
      return fillTemplate(msgs.error_bad_date, base)
    case 'future':
      return fillTemplate(msgs.error_future, base)
    case 'too_early':
      return fillTemplate(msgs.error_too_early, { ...base, open_at: e.open_at })
    case 'too_old':
      return fillTemplate(msgs.error_too_old, { ...base, close_at: e.close_at })
    case 'range_inverted':
      return fillTemplate(msgs.error_range_inverted, base)
    case 'range_too_wide':
      return fillTemplate(msgs.error_range_too_wide, {
        ...base,
        max_days: e.max_days,
        actual_days: e.actual_days,
      })
    case 'range_not_weekend_only':
      return fillTemplate(msgs.error_range_not_weekend, base)
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
