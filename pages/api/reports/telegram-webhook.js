import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import {
  sendMessage,
  deleteMessage,
  setMessageReaction,
  setMessageReactionWithQueue,
  sendToGroup,
  formatMention,
} from '../../../lib/reportsTelegram'
import { classifyMessage, parseReport, parseAbsence, parseDateHeader } from '../../../lib/reportsParser'
import {
  getReportsSettings,
  fillTemplate,
  pickDailyReportColumns,
} from '../../../lib/reportsSettings'
import { localParts } from '../../../lib/reportsCron'

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

  // Отвечаем Telegram-у СРАЗУ, пока не начали работу. Timeweb-контейнер регулярно ловит
  // UND_ERR_CONNECT_TIMEOUT к api.telegram.org/supabase.co — полный цикл с ретраями
  // может занять >10с, Telegram считает webhook упавшим ("Connection timed out") и
  // мы теряем update. Работу делаем фоном — app long-running express, не serverless.
  res.status(200).json({ ok: true })

  setImmediate(async () => {
    try {
      const message = update.message || update.edited_message
      if (message?.chat && message?.from && !message.from.is_bot) {
        await rememberChatMember(supabase, message.from)
        await rememberTextMentions(supabase, message)

        // Приватный /start в Старшине: отвечаем ссылкой на Домовой (для CRM-риелторов)
        if (message.chat.type === 'private') {
          const text = String(message.text || '').trim()
          if (/^\/start\b/.test(text)) {
            await handlePrivateStart(supabase, message)
            return
          }
        }

        await handleMessage(supabase, message, { edited: Boolean(update.edited_message) })
      }
    } catch (e) {
      console.error('[reports-webhook] background error', e)
    }
  })
}

async function handlePrivateStart(supabase, message) {
  const crypto = await import('crypto')
  const fromId = String(message.from.id)
  const chatId = message.chat.id

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, email, role, crm_enabled, telegram_chat_id, is_active')
    .eq('telegram_user_id', fromId)
    .maybeSingle()

  // Бот отвечает только риелторам из системы Домовой с подтверждённым Telegram
  // и включенным CRM. В остальных случаях — молча игнорим.
  if (!profile) return
  if (profile.is_active === false) return
  if (!profile.crm_enabled) return

  if (profile.telegram_chat_id) {
    await sendMessage(
      chatId,
      `👍 CRM у вас уже активна — заявки приходят в бот «Домовой».`,
      { parseMode: 'HTML' }
    )
    return
  }

  // Генерируем код для Домовой и шлём ссылку
  const code = crypto.default.randomBytes(8).toString('hex')
  await supabase.from('profiles').update({ telegram_link_code: code }).eq('id', profile.id)

  let botUsername = process.env.TELEGRAM_BOT_USERNAME || ''
  if (!botUsername && process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`)
      const j = await r.json()
      if (j?.ok) botUsername = j.result?.username || ''
    } catch {}
  }
  if (!botUsername) botUsername = 'domovoy_login_bot'
  const link = `https://t.me/${botUsername}?start=${code}`

  await sendMessage(
    chatId,
    `🎯 <b>${escapeHtml(profile.name || 'коллега')}, CRM подключен</b>\n\n` +
      `Чтобы получать заявки клиентов, подключите бот «Домовой»:\n${link}\n\n` +
      `Нажмите ссылку, в боте нажмите «Start» — и заявки начнут приходить.`,
    { parseMode: 'HTML' }
  )
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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

// Пользователи без @username прилетают в message.entities как text_mention —
// это позволяет админу «представить» их боту, упомянув в чате, без их собственного сообщения.
async function rememberTextMentions(supabase, message) {
  const entities = [...(message.entities || []), ...(message.caption_entities || [])]
  const mentions = entities
    .filter((e) => e?.type === 'text_mention' && e.user && !e.user.is_bot)
    .map((e) => e.user)
  if (!mentions.length) return
  const nowIso = new Date().toISOString()
  const rows = mentions.map((u) => ({
    telegram_user_id: String(u.id),
    username: u.username || null,
    first_name: u.first_name || null,
    last_name: u.last_name || null,
    last_seen_at: nowIso,
  }))
  await supabase.from('telegram_chat_members').upsert(rows, { onConflict: 'telegram_user_id' })
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
  // «Weekend hold»: одиночные рапорты за Пт/Сб и батчи нельзя присылать
  // в пятницу после 15:00 и в течение субботы — всё сдаётся в воскресенье
  // вечером одним батчем Пт+Сб+Вс. Информационный 15:00-пост в группу —
  // /api/reports/cron/friday-notice. Исключение — ручной override дня
  // через ЛК руководителя (hasOverride ниже); туда код не доходит, но
  // проверим после override, если нужен будет обход.
  {
    const l = localParts(now, settings.timezone || 'Asia/Yakutsk')
    const afterFri15 = l.dow === 'fri' && l.hour >= 15
    const isSat = l.dow === 'sat'
    if (afterFri15 || isSat) {
      const replyText = fillTemplate(
        settings.messages?.weekend_hold_reply ||
          '✋ Одиночные рапорты за выходные не принимаю. Собери Пт+Сб+Вс и присылай в воскресенье вечером.',
        { name: displayName || mention || 'боец' }
      )
      await sendMessage(chatId, replyText, { replyToMessageId: messageId })
      await setMessageReactionWithQueue(
        supabase,
        chatId,
        messageId,
        settings.reaction_rejected || '🤔'
      )
      return
    }
  }

  // Сначала смотрим, разблокирован ли этот день вручную через ЛК руководителя
  // (report_day_overrides). Если да — парсер пропустит проверку окна приёма.
  const hasOverride = await hasDayOverride(supabase, text, settings, now)
  const parsed = parseReport(text, settings, now, { allowClosedWindow: hasOverride })

  if (!parsed.ok) {
    const tooOld = (parsed.errors || []).some((e) => e?.type === 'too_old')

    // Edit раньше принятого рапорта после 09:30 — молчим, данные заморожены.
    // Если на сообщение висит прежняя ошибка/hint (`priorErrorReplyId`) — значит
    // риелтор ещё пытается починить, показываем актуальный текст ошибки.
    if (tooOld && edited && !priorErrorReplyId) return

    // Если дата глубоко в прошлом (>1 дня), это скорее всего опечатка в месяце,
    // а не реально опоздавший рапорт — подменяем ошибку на «date_in_past» с подсказкой про текущий месяц.
    const gap = gapFromTodayDays(parsed.dateTo, now, settings)
    const parsedForReply = {
      ...parsed,
      errors: (parsed.errors || []).map((e) => {
        if (e?.type !== 'too_old') return e
        if (gap > 1) {
          return {
            ...e,
            type: 'date_in_past',
            current_month_year: formatRuMonthYear(now, settings?.timezone),
          }
        }
        return e
      }),
    }

    await applyInvalidReport(supabase, {
      chatId,
      messageId,
      profile,
      parsed: parsedForReply,
      settings,
      displayName,
      mention,
      edited,
      rawText: text,
      priorErrorReplyId,
    })

    // Рапорт после 09:30 для свежей даты — данные всё равно сохраняем в БД
    // (руководителю не нужно вносить вручную), а риелтору бот ответил «не принят».
    if (tooOld && isWithinLateSaveWindow(parsed.dateTo, now, settings)) {
      const full = parseReport(text, settings, now, { allowClosedWindow: true })
      if (full.ok) {
        await saveLateReport(supabase, {
          chatId,
          messageId,
          profile,
          parsed: full,
          rawText: text,
        })
      }
    }
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

  // Метрики бывают даже при абсентизме: риелтор на больничном написал
  // «Больничный\nВал - 75000» — вал нужно сохранить в daily_reports.revenue
  // для сводки. parseAbsence уже вытащил metrics/extra из текста.
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
    extra: abs.extra || {},
    updated_at: new Date().toISOString(),
    ...(abs.metrics || {}),
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

  await setMessageReactionWithQueue(
    supabase,
    chatId,
    messageId,
    settings.reaction_accepted || '👌'
  )
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

  // Поставить реакцию "принят" (fallback в очередь при сетевой неудаче)
  await setMessageReactionWithQueue(
    supabase,
    chatId,
    messageId,
    settings.reaction_accepted || '👌'
  )
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

  // Реакция "не принят" (fallback в очередь при сетевой неудаче)
  await setMessageReactionWithQueue(
    supabase,
    chatId,
    messageId,
    settings.reaction_rejected || '🤔'
  )
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
    case 'date_in_past':
      return fillTemplate(
        msgs.error_date_in_past ||
          '🤔 {name}, рапорт за {value} — дата в прошлом. Сейчас {current_month_year}, проверь месяц.',
        { ...base, current_month_year: e.current_month_year }
      )
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

/**
 * Проверяет, есть ли у хотя бы одной из дат сообщения разблокировка через ЛК
 * руководителя (report_day_overrides). Если да — разрешаем принять отчёт даже
 * после 09:30 (окно закрыто).
 *
 * Быстро вытаскиваем даты из первой строки через parseDateHeader; если дата не
 * распознана (сообщение с absence-маркером, где parseReport всё равно не вызовется)
 * — возвращаем false.
 */
async function hasDayOverride(supabase, text, settings, now) {
  try {
    const firstLine = String(text || '').split(/\r?\n/)[0] || ''
    const tz = settings.timezone || 'Asia/Yakutsk'
    const nowLocal = localPartsForOverride(now, tz)
    const dateRes = parseDateHeader(firstLine, nowLocal, settings)
    if (!dateRes.ok) return false

    const { data, error } = await supabase
      .from('report_day_overrides')
      .select('date')
      .gte('date', dateRes.dateFrom)
      .lte('date', dateRes.dateTo)
      .limit(1)
      .maybeSingle()
    if (error || !data) return false
    return true
  } catch {
    return false
  }
}

/**
 * После 09:30 рапорт с формально «просроченной» датой всё равно сохраняем в БД,
 * если дата недалеко в прошлом (обычно «вчера», иногда Пт-Вс батчем до понедельника).
 * Так руководитель видит цифры, а риелтор видит «не принят» и в следующий раз сдаёт вовремя.
 *
 * Для очень старой даты (>7 дней назад) — это почти наверняка опечатка (март вместо апреля),
 * не late-рапорт, поэтому не сохраняем.
 */
function gapFromTodayDays(targetIso, now, settings) {
  if (!targetIso) return 0
  const tz = settings?.timezone || 'Asia/Yakutsk'
  const nowLocal = localPartsForOverride(now, tz)
  const [ty, tm, td] = targetIso.split('-').map(Number)
  const [ny, nm, nd] = nowLocal.dateIso.split('-').map(Number)
  return Math.round(
    (Date.UTC(ny, nm - 1, nd) - Date.UTC(ty, tm - 1, td)) / 86400000
  )
}

function formatRuMonthYear(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timeZone || 'Asia/Yakutsk',
    month: 'long',
    year: 'numeric',
  })
  return fmt.format(date).replace(/\s*г\.?$/, '').trim()
}

function isWithinLateSaveWindow(targetIso, now, settings) {
  if (!targetIso) return false
  const tz = settings?.timezone || 'Asia/Yakutsk'
  const nowLocal = localPartsForOverride(now, tz)
  const maxGap = Number.isFinite(settings?.late_save_max_days_back)
    ? settings.late_save_max_days_back
    : 7
  const [ty, tm, td] = targetIso.split('-').map(Number)
  const [ny, nm, nd] = nowLocal.dateIso.split('-').map(Number)
  const gap = Math.round(
    (Date.UTC(ny, nm - 1, nd) - Date.UTC(ty, tm - 1, td)) / 86400000
  )
  return gap >= 0 && gap <= maxGap
}

async function saveLateReport(supabase, ctx) {
  const { chatId, messageId, profile, parsed, rawText } = ctx
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
    extra: {
      ...(parsed.extra || {}),
      late_submission: true,
      late_reason: 'after_summary_window',
    },
    updated_at: new Date().toISOString(),
    ...metricCols,
  }
  const { error } = await supabase
    .from('daily_reports')
    .upsert(row, { onConflict: 'user_id,date_from,date_to' })
  if (error) {
    console.error('[reports-webhook] late report upsert error', error)
  }
}

function localPartsForOverride(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]))
  const y = +p.year, mm = +p.month, dd = +p.day
  return { year: y, month: mm, day: dd, dateIso: `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` }
}
