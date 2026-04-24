import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import { sendTelegramMessage, editTelegramMessage, answerCallbackQuery } from '../../../lib/telegram'
import {
  formatLeadForWinner,
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

  // Отвечаем Telegram-у мгновенно (Connection timed out от Timeweb → терянные updates).
  // Всё остальное — фоном.
  res.status(200).json({ ok: true })
  setImmediate(() => processAuthUpdate(supabase, update).catch(e => {
    console.error('[auth-webhook] background error', e)
  }))
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, email, telegram_link_code')
    .eq('telegram_link_code', code)
    .maybeSingle()

  if (!profile) {
    await sendTelegramMessage(chatId, `❌ Код не найден или истёк. Сгенерируйте новый в админке.`)
    return
  }

  const { error: updErr } = await supabase
    .from('profiles')
    .update({ telegram_chat_id: String(chatId), telegram_link_code: null })
    .eq('id', profile.id)

  if (updErr) {
    await sendTelegramMessage(chatId, `❌ Ошибка привязки: ${updErr.message}`)
    return
  }

  await sendTelegramMessage(
    chatId,
    `✅ Telegram успешно привязан к аккаунту <b>${escapeHtml(profile.name || profile.email)}</b>.\n\n` +
      `Теперь вам будут приходить запросы на подтверждение входа риелторов.`
  )
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
      .select('id, name, phone, email, rooms, budget, answers, created_at, assigned_at, source_id')
      .maybeSingle()

    if (updErr) {
      console.error('[lead-take] update error', updErr)
      await answerCallbackQuery(cqId, 'Ошибка базы данных')
      return
    }

    if (!updated) {
      await answerCallbackQuery(cqId, '🔒 Эту заявку уже взял другой риелтор')
      if (messageChatId && messageId) {
        await editTelegramMessage(
          messageChatId,
          messageId,
          '🔒 Эту заявку уже взял другой риелтор.',
          { replyMarkup: { inline_keyboard: [] } }
        )
      }
      return
    }

    const reactionSec = Math.max(
      0,
      Math.round((new Date(updated.assigned_at).getTime() - new Date(updated.created_at).getTime()) / 1000)
    )

    // reaction_seconds обновляем отдельно, чтобы не усложнять атомарный UPDATE выше
    await supabase.from('leads').update({ reaction_seconds: reactionSec }).eq('id', leadId)

    // Источник для карточек
    let source = null
    if (updated.source_id) {
      const { data: s } = await supabase
        .from('lead_sources')
        .select('id, kind, name')
        .eq('id', updated.source_id)
        .maybeSingle()
      source = s
    }

    // Ивент захвата
    await supabase.from('lead_events').insert({
      lead_id: leadId,
      actor_user_id: profile.id,
      event_type: 'taken',
      to_status: 'new',
      meta: { reaction_seconds: reactionSec },
    })

    // Карточка победителю с контактами
    const winnerText = formatLeadForWinner(updated, source)
    if (messageChatId && messageId) {
      await editTelegramMessage(messageChatId, messageId, winnerText, {
        replyMarkup: { inline_keyboard: [] },
      })
    }

    await answerCallbackQuery(cqId, '✅ Вы взяли заявку')

    // Остальным — эдит «Взял Иван»
    const winnerName = profile.name || profile.email || 'Риелтор'
    await editOtherRecipientsAfterTake(supabase, updated, source, profile.id, winnerName, reactionSec)

    // Руководителям
    await notifyManagersLeadTaken(supabase, updated, source, winnerName, reactionSec)
  }
}
