import { getSupabaseAdmin } from '../../../lib/supabaseServer'
import { sendTelegramMessage, editTelegramMessage, answerCallbackQuery } from '../../../lib/telegram'

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

  // Обработка нажатий inline-кнопок
  if (update.callback_query) {
    await handleCallbackQuery(supabase, update.callback_query)
    return res.status(200).json({ ok: true })
  }

  const message = update.message || update.edited_message
  if (!message?.chat?.id) return res.status(200).json({ ok: true })

  const chatId = message.chat.id
  const text = String(message.text || '').trim()

  // /start <code>
  const startMatch = text.match(/^\/start(?:\s+(\S+))?$/)
  if (startMatch) {
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
      return res.status(200).json({ ok: true })
    }

    // Ищем профиль с этим кодом привязки
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, name, email, telegram_link_code')
      .eq('telegram_link_code', code)
      .maybeSingle()

    if (!profile) {
      await sendTelegramMessage(
        chatId,
        `❌ Код не найден или истёк. Сгенерируйте новый в админке.`
      )
      return res.status(200).json({ ok: true })
    }

    // Привязываем
    const { error: updErr } = await supabase
      .from('profiles')
      .update({
        telegram_chat_id: String(chatId),
        telegram_link_code: null,
      })
      .eq('id', profile.id)

    if (updErr) {
      await sendTelegramMessage(chatId, `❌ Ошибка привязки: ${updErr.message}`)
      return res.status(200).json({ ok: true })
    }

    await sendTelegramMessage(
      chatId,
      `✅ Telegram успешно привязан к аккаунту <b>${escapeHtml(profile.name || profile.email)}</b>.\n\n` +
        `Теперь вам будут приходить запросы на подтверждение входа риелторов.`
    )
    return res.status(200).json({ ok: true })
  }

  // Игнорируем остальное
  return res.status(200).json({ ok: true })
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

  const m = data.match(/^(approve|reject):(.+)$/)
  if (!m) {
    await answerCallbackQuery(cqId, 'Неверные данные')
    return
  }
  const action = m[1]
  const token = m[2]

  // Кто нажал?
  const { data: approver } = await supabase
    .from('profiles')
    .select('id, name, email, role, telegram_chat_id')
    .eq('telegram_chat_id', fromChatId)
    .maybeSingle()

  if (!approver) {
    await answerCallbackQuery(cqId, 'Ваш Telegram не привязан к аккаунту')
    return
  }
  if (approver.role !== 'admin' && approver.role !== 'manager') {
    await answerCallbackQuery(cqId, 'Подтверждать могут только админ или руководитель')
    return
  }

  // Находим запрос
  const { data: pending } = await supabase
    .from('pending_logins')
    .select('*')
    .eq('token', token)
    .maybeSingle()

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
    const { error: devErr } = await supabase.from('user_devices').insert({
      user_id: pending.user_id,
      device_hash: pending.device_hash,
      label: pending.device_label,
    })
    if (devErr && !/unique/i.test(devErr.message)) {
      await answerCallbackQuery(cqId, 'Ошибка: ' + devErr.message)
      return
    }
    await supabase
      .from('pending_logins')
      .update({
        status: 'approved',
        approved_by: approver.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', pending.id)

    await answerCallbackQuery(cqId, '✅ Вход разрешён')
    if (messageChatId && messageId) {
      await editTelegramMessage(
        messageChatId,
        messageId,
        `${originalText}\n\n✅ <b>Разрешено</b> — ${escapeHtml(approverName)}`
      )
    }
  } else {
    await supabase
      .from('pending_logins')
      .update({
        status: 'rejected',
        approved_by: approver.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', pending.id)

    await answerCallbackQuery(cqId, '⛔ Вход отклонён')
    if (messageChatId && messageId) {
      await editTelegramMessage(
        messageChatId,
        messageId,
        `${originalText}\n\n⛔ <b>Отклонено</b> — ${escapeHtml(approverName)}`
      )
    }
  }
}
