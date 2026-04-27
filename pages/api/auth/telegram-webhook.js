import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import { sendTelegramMessage, editTelegramMessage, answerCallbackQuery } from '../../../lib/telegram'
import {
  formatLeadForWinner,
  formatLeadTakenBy,
  editOtherRecipientsAfterTake,
  notifyManagersLeadTaken,
} from '../../../lib/leadsTelegram'

/**
 * Webhook для Telegram бота.
 * Обрабатывает:
 * - /start <code> — привязывает chat_id к аккаунту по одноразовому коду
 * - /start — показывает инструкцию
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).end()

  // Проверка секретного токена (опционально, для защиты webhook)
  const secret = req.headers['x-telegram-bot-api-secret-token']
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).end()
  }

  const update = req.body || {}
  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(200).json({ ok: true })

  // Обрабатываем синхронно. setImmediate после res.send обрезалось Next.js,
  // из-за чего часть действий (edit сообщений у других получателей после захвата лида)
  // не успевала выполниться. Telegram webhook таймаут ~60 сек — запас есть.
  try {
    await processAuthUpdate(supabase, update)
  } catch (e) {
    console.error('[auth-webhook] handler error', e)
  }
  return res.status(200).json({ ok: true })
}

async function processAuthUpdate(supabase, update) {
  if (update.callback_query) {
    await handleCallbackQuery(supabase, update.callback_query)
    return
  }

  const message = update.message || update.edited_message
  if (!message?.chat?.id) return

  const chatId = message.chat.id
  const text = String(message.text || '').trim()

  const startMatch = text.match(/^\/start(?:\s+(\S+))?$/)
  if (!startMatch) return

  const code = startMatch[1]
  if (!code) {
    await sendTelegramMessage(
      chatId,
      `👋 Привет! Это бот для подтверждения входа в систему.\n\n` +
        `Чтобы привязать этот Telegram к вашему аккаунту:\n` +
        `1. Откройте админку на сайте\n` +
        `2. Перейдите в раздел "Профиль" → "Telegram"\n` +
        `3. Скопируйте уникальную ссылку и откройте её в Telegram`
    )
    return
  }

  // Атомарный consume кода: только один параллельный запрос заберёт его и получит profile,
  // остальные увидят нулевой результат и скажут «уже привязан».
  const { data: consumed, error: updErr } = await supabase
    .from('profiles')
    .update({ telegram_chat_id: String(chatId), telegram_link_code: null })
    .eq('telegram_link_code', code)
    .select('id, name, email, role, crm_enabled')
    .maybeSingle()

  if (updErr) {
    await sendTelegramMessage(chatId, `❌ Ошибка привязки: ${updErr.message}`)
    return
  }

  if (!consumed) {
    // Код уже был использован (или не существовал). Тихо выходим — не спамим.
    return
  }

  const profile = consumed
  const isRealtor = profile.role === 'realtor'
  const welcomeText = isRealtor
    ? `✅ Telegram привязан к аккаунту <b>${escapeHtml(profile.name || profile.email)}</b>.\n\n` +
      (profile.crm_enabled
        ? `🎯 <b>CRM активна</b> — сюда будут приходить заявки клиентов.\nУвидишь карточку — жми «🔥 Беру в работу», контакты покажутся только победителю.`
        : `Когда руководитель включит тебе CRM, сюда будут приходить заявки клиентов.`)
    : `✅ Telegram успешно привязан к аккаунту <b>${escapeHtml(profile.name || profile.email)}</b>.\n\n` +
      `Теперь вам будут приходить запросы на подтверждение входа риелторов.`

  await sendTelegramMessage(chatId, welcomeText)
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function handleCallbackQuery(supabase, cq) {
  const cqId = cq.id
  const data = String(cq.data || '')
  const fromChatId = String(cq.from?.id || '')
  const messageChatId = cq.message?.chat?.id
  const messageId = cq.message?.message_id
  const originalText = cq.message?.text || cq.message?.caption || ''

  // CRM: первый-беру
  const leadMatch = data.match(/^lead_(take|skip):(.+)$/)
  if (leadMatch) {
    await handleLeadCallback(supabase, cq, leadMatch[1], leadMatch[2])
    return
  }

  // CRM: руководитель назначает риелтора через эскалацию
  const assignMatch = data.match(/^assignlead:(.+)$/)
  if (assignMatch) {
    await handleAssignLeadStart(supabase, cq, assignMatch[1])
    return
  }
  const pickMatch = data.match(/^pick:([a-f0-9]+):([a-f0-9]+)$/)
  if (pickMatch) {
    await handleAssignLeadPick(supabase, cq, pickMatch[1], pickMatch[2])
    return
  }
  const cancelMatch = data.match(/^assigncancel:(.+)$/)
  if (cancelMatch) {
    // Просто убираем клавиатуру и оставляем оригинальный текст эскалации
    if (cq.message?.chat?.id && cq.message?.message_id) {
      const orig = (cq.message?.text || '').replace(/\n*<i>Кому назначить\?<\/i>\s*$/, '').replace(/\n*Кому назначить\?\s*$/, '')
      await editTelegramMessage(cq.message.chat.id, cq.message.message_id, orig, {
        replyMarkup: {
          inline_keyboard: [[{ text: '👥 Назначить риелтора', callback_data: `assignlead:${cancelMatch[1]}` }]],
        },
      })
    }
    await answerCallbackQuery(cq.id)
    return
  }

  const m = data.match(/^(approve|reject):(.+)$/)
  if (!m) {
    await answerCallbackQuery(cqId, 'Неверные данные')
    return
  }
  const action = m[1]
  const token = m[2]

  // Параллельный lookup approver + pending — экономит 1 round-trip
  const [approverRes, pendingRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, email, role, telegram_chat_id')
      .eq('telegram_chat_id', fromChatId)
      .maybeSingle(),
    supabase
      .from('pending_logins')
      .select('*')
      .eq('token', token)
      .maybeSingle(),
  ])
  const approver = approverRes.data
  const pending = pendingRes.data

  if (!approver) {
    await answerCallbackQuery(cqId, 'Ваш Telegram не привязан к аккаунту')
    return
  }
  if (approver.role !== 'admin' && approver.role !== 'manager') {
    await answerCallbackQuery(cqId, 'Подтверждать могут только админ или руководитель')
    return
  }

  if (!pending) {
    await answerCallbackQuery(cqId, 'Запрос не найден')
    if (messageChatId && messageId) {
      await editTelegramMessage(
        messageChatId,
        messageId,
        `${originalText}\n\n<b>⚠ Запрос не найден</b>`
      )
    }
    return
  }

  if (pending.status !== 'pending') {
    await answerCallbackQuery(cqId, `Уже ${pending.status}`)
    if (messageChatId && messageId) {
      await editTelegramMessage(
        messageChatId,
        messageId,
        `${originalText}\n\n<b>⚠ Запрос уже обработан (${pending.status})</b>`
      )
    }
    return
  }

  if (new Date(pending.expires_at) < new Date()) {
    await supabase.from('pending_logins').update({ status: 'expired' }).eq('id', pending.id)
    await answerCallbackQuery(cqId, 'Срок действия истёк')
    if (messageChatId && messageId) {
      await editTelegramMessage(
        messageChatId,
        messageId,
        `${originalText}\n\n<b>⚠ Срок действия истёк</b>`
      )
    }
    return
  }

  const approverName = approver.name || approver.email || 'руководитель'

  if (action === 'approve') {
    // Критично: первым делом ставим 'approved' — чтобы polling клиента разблокировал логин.
    // Остальное (user_devices insert, Telegram UI) в параллели.
    await supabase
      .from('pending_logins')
      .update({
        status: 'approved',
        approved_by: approver.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', pending.id)

    const nowIso = new Date().toISOString()
    await Promise.all([
      // upsert, а не insert — иначе повторный approve того же устройства не обновит
      // last_approved_at и приведёт к бесконечному циклу подтверждений (check-device видит
      // last_approved_at=null через approveStillValid → снова создаёт pending).
      supabase.from('user_devices').upsert(
        {
          user_id: pending.user_id,
          device_hash: pending.device_hash,
          label: pending.device_label,
          last_approved_at: nowIso,
          last_used_at: nowIso,
        },
        { onConflict: 'user_id,device_hash' }
      ).then(({ error }) => { if (error) console.error('[telegram-webhook] user_devices upsert error:', error) }),
      answerCallbackQuery(cqId, '✅ Вход разрешён'),
      messageChatId && messageId
        ? editTelegramMessage(
            messageChatId,
            messageId,
            `${originalText}\n\n✅ <b>Разрешено</b> — ${escapeHtml(approverName)}`
          )
        : Promise.resolve(),
    ])
  } else {
    await supabase
      .from('pending_logins')
      .update({
        status: 'rejected',
        approved_by: approver.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', pending.id)

    await Promise.all([
      answerCallbackQuery(cqId, '⛔ Вход отклонён'),
      messageChatId && messageId
        ? editTelegramMessage(
            messageChatId,
            messageId,
            `${originalText}\n\n⛔ <b>Отклонено</b> — ${escapeHtml(approverName)}`
          )
        : Promise.resolve(),
    ])
  }
}

async function handleLeadCallback(supabase, cq, action, leadId) {
  const cqId = cq.id
  const fromChatId = String(cq.from?.id || '')
  const messageChatId = cq.message?.chat?.id
  const messageId = cq.message?.message_id

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, email, crm_enabled, is_active, telegram_chat_id')
    .eq('telegram_chat_id', fromChatId)
    .maybeSingle()

  if (!profile) {
    await answerCallbackQuery(cqId, 'Ваш Telegram не привязан к аккаунту')
    return
  }
  if (profile.is_active === false) {
    await answerCallbackQuery(cqId, 'Ваш аккаунт деактивирован')
    return
  }
  if (!profile.crm_enabled) {
    await answerCallbackQuery(cqId, 'CRM не включен для вашего профиля')
    return
  }

  if (action === 'skip') {
    try {
      if (messageChatId && messageId) {
        await editTelegramMessage(
          messageChatId,
          messageId,
          '⏭ Вы пропустили эту заявку.',
          { replyMarkup: { inline_keyboard: [] } }
        )
      }
      await supabase
        .from('lead_notifications')
        .delete()
        .eq('lead_id', leadId)
        .eq('user_id', profile.id)
      await supabase.from('lead_events').insert({
        lead_id: leadId,
        actor_user_id: profile.id,
        event_type: 'skipped',
      })
      await answerCallbackQuery(cqId, 'Пропущено')
    } catch (e) {
      console.error('[lead-skip] error', e)
      await answerCallbackQuery(cqId, 'Ошибка')
    }
    return
  }

  if (action === 'take') {
    // First-wins: атомарный UPDATE
    const { data: updated, error: updErr } = await supabase
      .from('leads')
      .update({
        assigned_user_id: profile.id,
        assigned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId)
      .is('assigned_user_id', null)
      .eq('status', 'new')
      .select('id, name, phone, email, rooms, budget, messenger, answers, created_at, assigned_at, source_id')
      .maybeSingle()

    if (updErr) {
      console.error('[lead-take] update error', updErr)
      await answerCallbackQuery(cqId, 'Ошибка базы данных')
      return
    }

    if (!updated) {
      // Лид уже взят — пытаемся показать кем именно (как в background-эдите).
      try {
        const { data: takenLead } = await supabase
          .from('leads')
          .select('id, name, assigned_user_id, reaction_seconds, source_id, lead_sources(name, kind), profiles:assigned_user_id(name, email)')
          .eq('id', leadId)
          .maybeSingle()

        // Защита от double-webhook от Telegram: если лид уже принадлежит
        // самому caller'у, значит это ретрай того же callback'а — первый вызов
        // выиграл UPDATE, второй идёт по `!updated`. Нельзя затирать
        // winner-card: молча отвечаем в callback и оставляем сообщение как есть.
        if (takenLead && String(takenLead.assigned_user_id || '') === String(profile.id)) {
          await answerCallbackQuery(cqId, '✅ Это уже ваша заявка')
          return
        }

        if (takenLead) {
          const winnerName = takenLead.profiles?.name || takenLead.profiles?.email || 'другой риелтор'
          const sec = takenLead.reaction_seconds
          const text = formatLeadTakenBy(
            takenLead,
            takenLead.lead_sources,
            winnerName,
            typeof sec === 'number' ? sec : null
          )
          await answerCallbackQuery(cqId, `🔒 Уже взял ${winnerName}`)
          if (messageChatId && messageId) {
            await editTelegramMessage(messageChatId, messageId, text, {
              replyMarkup: { inline_keyboard: [] },
            })
          }
          return
        }
      } catch (e) {
        console.warn('[lead-take] late-race lookup failed', e?.message || e)
      }
      // Фолбэк, если не смогли подтянуть инфу: только ack callback,
      // сообщение НЕ редактируем — иначе ретрай может затереть валидное состояние.
      await answerCallbackQuery(cqId, '🔒 Эту заявку уже взял другой риелтор')
      return
    }

    const reactionSec = Math.max(
      0,
      Math.round((new Date(updated.assigned_at).getTime() - new Date(updated.created_at).getTime()) / 1000)
    )

    // КРИТИЧНО: записываем 'taken' и reaction_seconds сразу после атомарного UPDATE,
    // ДО любых TG-вызовов. Если Telegram-эдиты упадут — у нас в БД останется
    // консистентное состояние (lead.assigned + событие taken), запасной cleanup
    // сможет разобрать ситуацию. Раньше handler терял события при таймаутах TG.
    await supabase.from('leads').update({ reaction_seconds: reactionSec }).eq('id', leadId).then(
      () => null,
      e => console.error('[lead-take] reaction update', e?.message || e)
    )
    await supabase.from('lead_events').insert({
      lead_id: leadId,
      actor_user_id: profile.id,
      event_type: 'taken',
      to_status: 'new',
      meta: { reaction_seconds: reactionSec },
    }).then(
      () => null,
      e => console.error('[lead-take] event insert', e?.message || e)
    )

    // Мгновенный ack
    try { await answerCallbackQuery(cqId, '✅ Вы взяли заявку') } catch (e) { console.error('[lead-take] ack', e?.message || e) }

    // Источник для карточек
    let source = null
    if (updated.source_id) {
      try {
        const { data: s } = await supabase
          .from('lead_sources')
          .select('id, kind, name')
          .eq('id', updated.source_id)
          .maybeSingle()
        source = s
      } catch (e) { console.error('[lead-take] source fetch', e?.message || e) }
    }

    // Карточка победителю с контактами — каждый шаг защищён try/catch
    try {
      const winnerText = formatLeadForWinner(updated, source)
      if (messageChatId && messageId) {
        await editTelegramMessage(messageChatId, messageId, winnerText, {
          replyMarkup: { inline_keyboard: [] },
        })
      }
    } catch (e) { console.error('[lead-take] edit winner', e?.message || e) }

    const winnerName = profile.name || profile.email || 'Риелтор'
    try { await editOtherRecipientsAfterTake(supabase, updated, source, profile.id, winnerName, reactionSec) }
    catch (e) { console.error('[lead-take] edit others', e?.message || e) }

    try { await notifyManagersLeadTaken(supabase, updated, source, winnerName, reactionSec) }
    catch (e) { console.error('[lead-take] notify managers', e?.message || e) }
  }
}

// Шаг 1 — руководитель нажал «👥 Назначить риелтора» в эскалации.
// Подгружаем список CRM-риелторов и эдитим то же сообщение, добавляя
// клавиатуру с кнопками «Имя риелтора» (callback pick:<leadShort>:<userShort>).
async function handleAssignLeadStart(supabase, cq, leadId) {
  const cqId = cq.id
  const fromChatId = String(cq.from?.id || '')
  const messageChatId = cq.message?.chat?.id
  const messageId = cq.message?.message_id
  const originalText = cq.message?.text || ''

  const { data: caller } = await supabase
    .from('profiles')
    .select('role')
    .eq('telegram_chat_id', fromChatId)
    .maybeSingle()
  if (!caller || !['admin', 'manager'].includes(caller.role)) {
    await answerCallbackQuery(cqId, 'Только админ/руководитель')
    return
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, status, assigned_user_id')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) {
    await answerCallbackQuery(cqId, 'Лид не найден')
    return
  }
  if (lead.assigned_user_id) {
    await answerCallbackQuery(cqId, 'Этот лид уже взят')
    if (messageChatId && messageId) {
      await editTelegramMessage(messageChatId, messageId, originalText, { replyMarkup: { inline_keyboard: [] } })
    }
    return
  }

  const { data: realtors } = await supabase
    .from('profiles')
    .select('id, name, email, telegram_chat_id')
    .eq('crm_enabled', true)
    .eq('is_active', true)
    .not('telegram_chat_id', 'is', null)
    .order('name')

  if (!realtors || realtors.length === 0) {
    await answerCallbackQuery(cqId, 'Нет CRM-риелторов с привязанным Домовой', true)
    return
  }

  const leadShort = String(leadId).split('-')[0]
  const rows = []
  let row = []
  for (const r of realtors) {
    const userShort = String(r.id).split('-')[0]
    row.push({
      text: r.name || r.email || '—',
      callback_data: `pick:${leadShort}:${userShort}`,
    })
    if (row.length === 2) { rows.push(row); row = [] }
  }
  if (row.length) rows.push(row)
  rows.push([{ text: '✕ Отмена', callback_data: `assigncancel:${leadId}` }])

  if (messageChatId && messageId) {
    await editTelegramMessage(messageChatId, messageId, originalText + '\n\n<i>Кому назначить?</i>', {
      replyMarkup: { inline_keyboard: rows },
    })
  }
  await answerCallbackQuery(cqId)
}

async function handleAssignLeadPick(supabase, cq, leadShort, userShort) {
  const cqId = cq.id
  const fromChatId = String(cq.from?.id || '')

  const { data: caller } = await supabase
    .from('profiles')
    .select('id, role, name')
    .eq('telegram_chat_id', fromChatId)
    .maybeSingle()
  if (!caller || !['admin', 'manager'].includes(caller.role)) {
    await answerCallbackQuery(cqId, 'Только админ/руководитель')
    return
  }

  // По коротким префиксам ищем lead и риелтора (UUID начинается с этих 8 hex).
  const { data: leadCandidates } = await supabase
    .from('leads')
    .select('id, status, assigned_user_id, name, phone, email, rooms, budget, messenger, created_at, source_id, lead_sources(name, kind)')
    .in('status', ['new'])
    .is('assigned_user_id', null)
  const lead = (leadCandidates || []).find(l => String(l.id).startsWith(leadShort))
  if (!lead) {
    await answerCallbackQuery(cqId, 'Лид уже не доступен (взят или закрыт)', true)
    return
  }

  const { data: realtors } = await supabase
    .from('profiles')
    .select('id, name, email, telegram_chat_id')
    .eq('crm_enabled', true)
    .eq('is_active', true)
    .not('telegram_chat_id', 'is', null)
  const realtor = (realtors || []).find(r => String(r.id).startsWith(userShort))
  if (!realtor) {
    await answerCallbackQuery(cqId, 'Риелтор не найден', true)
    return
  }

  const now = new Date()
  const reactionSec = Math.max(0, Math.round((now.getTime() - new Date(lead.created_at).getTime()) / 1000))

  // Атомарное назначение
  const { data: updated, error: updErr } = await supabase
    .from('leads')
    .update({
      assigned_user_id: realtor.id,
      assigned_at: now.toISOString(),
      reaction_seconds: reactionSec,
      updated_at: now.toISOString(),
    })
    .eq('id', lead.id)
    .is('assigned_user_id', null)
    .eq('status', 'new')
    .select('id')
    .maybeSingle()

  if (updErr || !updated) {
    await answerCallbackQuery(cqId, 'Лид уже взят кем-то другим', true)
    return
  }

  await supabase.from('lead_events').insert({
    lead_id: lead.id,
    actor_user_id: caller.id,
    event_type: 'taken',
    to_status: 'new',
    meta: { reaction_seconds: reactionSec, assigned_by_manager: true, assigner_id: caller.id },
  })

  await answerCallbackQuery(cqId, `✅ Назначено: ${realtor.name || realtor.email}`)

  // Карточка риелтору в Домовой
  const sourceName = lead.lead_sources?.name || lead.lead_sources?.kind || 'источник'
  const realtorText =
    `📂 <b>Вам назначен лид руководителем</b>\n\n` +
    (lead.name ? `Клиент: ${escapeHtml(lead.name)} ` : '') +
    (lead.phone ? `(<code>${escapeHtml(lead.phone)}</code>)\n` : '\n') +
    (lead.email ? `Email: ${escapeHtml(lead.email)}\n` : '') +
    (lead.rooms ? `Комнат: ${escapeHtml(lead.rooms)}\n` : '') +
    (lead.budget ? `Бюджет: ${escapeHtml(lead.budget)}\n` : '') +
    `Источник: ${escapeHtml(sourceName)}\n\n` +
    `Свяжитесь с клиентом в ближайшие 5 минут.`
  if (realtor.telegram_chat_id) {
    try { await sendTelegramMessage(realtor.telegram_chat_id, realtorText) } catch {}
  }

  // Эдит блайнд-карточек у других CRM-риелторов
  const winnerName = realtor.name || realtor.email || 'Риелтор'
  let source = null
  if (lead.source_id) {
    const { data: s } = await supabase.from('lead_sources').select('id, kind, name').eq('id', lead.source_id).maybeSingle()
    source = s
  }
  await editOtherRecipientsAfterTake(supabase, lead, source, realtor.id, winnerName, reactionSec)

  // Уведомить других руководителей (notifyManagersLeadTaken)
  await notifyManagersLeadTaken(supabase, lead, source, winnerName, reactionSec)
}
