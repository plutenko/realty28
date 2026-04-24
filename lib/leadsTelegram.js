import { sendTelegramMessage, editTelegramMessage } from './telegram'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function fmtTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const hh = String(d.getUTCHours() + 9).padStart(2, '0') // UTC+9 Asia/Yakutsk приближённо
    const mm = String(d.getUTCMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return ''
  }
}

/**
 * Карточка для показа получателям ДО того, как кто-то взял (без контактов).
 */
export function formatLeadBlind(lead, source) {
  const lines = ['📥 <b>Новая заявка</b>', '']
  if (source) lines.push(`Источник: ${escapeHtml(source.name || source.kind)}`)
  if (lead.name) lines.push(`Имя: ${escapeHtml(lead.name)}`)
  if (lead.budget) lines.push(`Бюджет: ${escapeHtml(lead.budget)}`)
  if (lead.rooms) lines.push(`Комнат: ${escapeHtml(lead.rooms)}`)
  const t = fmtTime(lead.created_at)
  if (t) lines.push(`Время: ${t}`)

  const answers = Array.isArray(lead.answers) ? lead.answers : []
  if (answers.length > 0) {
    lines.push('')
    lines.push('<i>Ответы квиза:</i>')
    for (const a of answers.slice(0, 6)) {
      const q = a?.question || a?.q
      const v = a?.answer || a?.a
      if (!q || v === undefined || v === null) continue
      const vs = Array.isArray(v) ? v.join(', ') : String(v)
      lines.push(`• ${escapeHtml(q)}: ${escapeHtml(vs)}`)
    }
    if (answers.length > 6) lines.push(`• …и ещё ${answers.length - 6}`)
  }
  return lines.join('\n')
}

/**
 * Карточка для победителя — с контактами.
 */
export function formatLeadForWinner(lead, source) {
  const lines = ['✅ <b>Вы взяли заявку</b>', '']
  if (lead.phone) lines.push(`📞 <code>${escapeHtml(lead.phone)}</code>`)
  if (lead.email) lines.push(`📧 ${escapeHtml(lead.email)}`)
  lines.push('')
  if (source) lines.push(`Источник: ${escapeHtml(source.name || source.kind)}`)
  if (lead.name) lines.push(`Имя: ${escapeHtml(lead.name)}`)
  if (lead.budget) lines.push(`Бюджет: ${escapeHtml(lead.budget)}`)
  if (lead.rooms) lines.push(`Комнат: ${escapeHtml(lead.rooms)}`)

  const answers = Array.isArray(lead.answers) ? lead.answers : []
  if (answers.length > 0) {
    lines.push('')
    lines.push('<i>Ответы квиза:</i>')
    for (const a of answers.slice(0, 10)) {
      const q = a?.question || a?.q
      const v = a?.answer || a?.a
      if (!q || v === undefined || v === null) continue
      const vs = Array.isArray(v) ? v.join(', ') : String(v)
      lines.push(`• ${escapeHtml(q)}: ${escapeHtml(vs)}`)
    }
  }
  lines.push('')
  lines.push('Позвоните клиенту в ближайшие 5 минут.')
  return lines.join('\n')
}

/**
 * Карточка для «опоздавших» — остальных риелторов после того, как кто-то взял.
 */
export function formatLeadTakenBy(lead, source, winnerName, reactionSec) {
  const lines = [`🔒 <b>Заявку взял ${escapeHtml(winnerName)}</b>`]
  if (typeof reactionSec === 'number') lines.push(`за ${reactionSec} сек`)
  lines.push('')
  if (source) lines.push(`Источник: ${escapeHtml(source.name || source.kind)}`)
  if (lead.name) lines.push(`Имя: ${escapeHtml(lead.name)}`)
  return lines.join('\n')
}

/**
 * Уведомление руководителю о захвате.
 */
export function formatLeadTakenForManager(lead, source, winnerName, reactionSec) {
  const lines = [`✅ <b>${escapeHtml(winnerName)} взял заявку</b>`, '']
  if (lead.name) lines.push(`Клиент: ${escapeHtml(lead.name)}`)
  if (source) lines.push(`Источник: ${escapeHtml(source.name || source.kind)}`)
  if (typeof reactionSec === 'number') lines.push(`Время реакции: ${reactionSec} сек`)
  return lines.join('\n')
}

/**
 * Inline-кнопки для карточки лида (до захвата).
 */
export function leadInlineKeyboard(leadId) {
  return {
    inline_keyboard: [[
      { text: '🔥 Беру в работу', callback_data: `lead_take:${leadId}` },
      { text: '⏭ Пропустить',    callback_data: `lead_skip:${leadId}` },
    ]],
  }
}

/**
 * Рассылка нового лида всем активным CRM-риелторам.
 * - Берём profiles.crm_enabled=true, is_active=true, telegram_chat_id IS NOT NULL
 * - Шлём каждому, запоминаем chat_id/message_id в lead_notifications
 *   (понадобятся чтобы заэдитить сообщения остальным после захвата).
 */
export async function broadcastLead(supabase, lead, source) {
  const { data: recipients, error } = await supabase
    .from('profiles')
    .select('id, name, telegram_chat_id, is_active, crm_enabled')
    .eq('crm_enabled', true)
    .not('telegram_chat_id', 'is', null)

  if (error) {
    console.error('[leads-tg] fetch recipients error', error)
    return { sent: 0, total: 0 }
  }

  const active = (recipients || []).filter(r => r.is_active !== false && r.telegram_chat_id)
  if (active.length === 0) {
    console.warn('[leads-tg] no CRM recipients with Telegram — skipping rasśilka')
    return { sent: 0, total: 0 }
  }

  const text = formatLeadBlind(lead, source)
  const replyMarkup = leadInlineKeyboard(lead.id)

  let sent = 0
  for (const r of active) {
    try {
      const resp = await sendTelegramMessage(r.telegram_chat_id, text, { replyMarkup })
      if (resp?.ok && resp?.result?.message_id) {
        await supabase.from('lead_notifications').insert({
          lead_id: lead.id,
          user_id: r.id,
          chat_id: Number(r.telegram_chat_id),
          message_id: Number(resp.result.message_id),
        })
        sent++
      }
    } catch (e) {
      console.error('[leads-tg] send error to', r.telegram_chat_id, e?.message || e)
    }
  }
  return { sent, total: active.length }
}

/**
 * После того как лид захвачен — заэдитить сообщения всем, кроме победителя,
 * превратив их в «Заявку взял Иван (47 сек)» без кнопок.
 */
export async function editOtherRecipientsAfterTake(supabase, lead, source, winnerUserId, winnerName, reactionSec) {
  const { data: notifs } = await supabase
    .from('lead_notifications')
    .select('user_id, chat_id, message_id')
    .eq('lead_id', lead.id)

  const text = formatLeadTakenBy(lead, source, winnerName, reactionSec)
  for (const n of notifs || []) {
    if (n.user_id === winnerUserId) continue
    try {
      await editTelegramMessage(n.chat_id, n.message_id, text, { replyMarkup: { inline_keyboard: [] } })
    } catch (e) {
      console.warn('[leads-tg] edit failed', n.chat_id, n.message_id, e?.message || e)
    }
  }
}

/**
 * Уведомление руководителям (role='manager' и 'admin') о захвате лида.
 */
export async function notifyManagersLeadTaken(supabase, lead, source, winnerName, reactionSec) {
  const { data: managers } = await supabase
    .from('profiles')
    .select('telegram_chat_id, role')
    .in('role', ['manager', 'admin'])
    .not('telegram_chat_id', 'is', null)
  const text = formatLeadTakenForManager(lead, source, winnerName, reactionSec)
  for (const m of managers || []) {
    if (!m.telegram_chat_id) continue
    try { await sendTelegramMessage(m.telegram_chat_id, text) } catch {}
  }
}
