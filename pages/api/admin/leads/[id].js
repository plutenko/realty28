import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { sendTelegramMessage, editTelegramMessage } from '../../../../lib/telegram'
import { requireAdminOrManager } from './index'

const TERMINAL = new Set(['not_lead', 'deal_done', 'failed'])
const ALLOWED_STATUS_SET = new Set(['new', 'not_lead', 'add_to_base', 'in_work', 'deal_done', 'failed'])

export default async function handler(req, res) {
  const caller = await requireAdminOrManager(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id обязателен' })

  const supabase = getSupabaseAdmin()

  if (req.method === 'DELETE') {
    if (caller.role !== 'admin') return res.status(403).json({ error: 'Только admin может удалять лидов' })
    const { error } = await supabase.from('leads').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'POST') {
    const { action } = req.body || {}
    if (!action) return res.status(400).json({ error: 'action обязателен' })

    const { data: lead } = await supabase
      .from('leads')
      .select(`
        id, status, name, phone, email, assigned_user_id,
        lead_sources(name, kind),
        profiles:assigned_user_id(id, name, email, telegram_chat_id)
      `)
      .eq('id', id)
      .single()

    if (!lead) return res.status(404).json({ error: 'Лид не найден' })

    if (action === 'change_status') {
      return changeStatus(supabase, caller, lead, req.body, res)
    }
    if (action === 'reassign') {
      return reassign(supabase, caller, lead, req.body, res)
    }
    if (action === 'reopen') {
      return reopen(supabase, caller, lead, req.body, res)
    }
    if (action === 'confirm_in_work') {
      return confirmInWork(supabase, caller, lead, req.body, res)
    }

    return res.status(400).json({ error: 'Неизвестный action' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

async function changeStatus(supabase, caller, lead, body, res) {
  const { status, comment } = body
  if (!ALLOWED_STATUS_SET.has(status)) return res.status(400).json({ error: 'Недопустимый статус' })
  if ((status === 'not_lead' || status === 'failed') && !String(comment || '').trim()) {
    return res.status(400).json({ error: 'Для этого статуса обязательна причина' })
  }

  // Идемпотентность: если текущий статус совпадает — не пишем событие и не шлём уведомления.
  // Защита от двойного клика в UI.
  if (lead.status === status) {
    return res.status(200).json({ ok: true, noop: true })
  }

  const updates = { status, updated_at: new Date().toISOString() }
  if (TERMINAL.has(status)) {
    updates.closed_at = new Date().toISOString()
    updates.close_reason = String(comment || '').trim() || null
  }

  const { error } = await supabase.from('leads').update(updates).eq('id', lead.id)
  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('lead_events').insert({
    lead_id: lead.id,
    actor_user_id: caller.user.id,
    event_type: 'status_changed',
    from_status: lead.status,
    to_status: status,
    comment: comment || null,
  })

  // Уведомление руководителю при not_lead/failed
  if (status === 'not_lead' || status === 'failed') {
    await notifyManagersClosed(supabase, lead, status, comment, caller.user.id).catch(() => {})
  }
  // Уведомление админу при add_to_base
  if (status === 'add_to_base') {
    await notifyAdminsAddToBase(supabase, lead).catch(() => {})
  }

  return res.status(200).json({ ok: true })
}

async function resolveEscalationMessages(supabase, leadId, statusText) {
  try {
    const { data: escEvents } = await supabase
      .from('lead_events')
      .select('meta')
      .eq('lead_id', leadId)
      .eq('event_type', 'escalated_unclaimed')
    for (const ev of escEvents || []) {
      const list = Array.isArray(ev?.meta?.sent_to) ? ev.meta.sent_to : []
      for (const sent of list) {
        if (!sent?.chat_id || !sent?.message_id) continue
        try { await editTelegramMessage(sent.chat_id, sent.message_id, statusText) } catch {}
      }
    }
  } catch {}
}

async function reassign(supabase, caller, lead, body, res) {
  const { new_user_id, comment } = body
  if (!new_user_id) return res.status(400).json({ error: 'new_user_id обязателен' })
  if (TERMINAL.has(lead.status)) return res.status(400).json({ error: 'Для закрытого лида используй reopen' })

  const { data: newProfile } = await supabase
    .from('profiles')
    .select('id, name, email, crm_enabled, telegram_chat_id')
    .eq('id', new_user_id)
    .single()
  if (!newProfile) return res.status(404).json({ error: 'Риелтор не найден' })

  const oldUserId = lead.assigned_user_id
  const { error } = await supabase
    .from('leads')
    .update({ assigned_user_id: new_user_id, assigned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', lead.id)
  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('lead_events').insert({
    lead_id: lead.id,
    actor_user_id: caller.user.id,
    event_type: 'reassigned',
    comment: comment || null,
    meta: { from_user_id: oldUserId, to_user_id: new_user_id },
  })

  // Уведомления
  const sourceName = lead.lead_sources?.name || lead.lead_sources?.kind || 'источник'
  const phone = lead.phone || '—'
  const clientName = lead.name || '—'

  if (newProfile.telegram_chat_id) {
    await sendTelegramMessage(
      newProfile.telegram_chat_id,
      `📂 <b>Вам переведён лид</b>\n\n` +
      `Клиент: ${escapeHtml(clientName)} (${escapeHtml(phone)})\n` +
      `Источник: ${escapeHtml(sourceName)}\n` +
      (comment ? `Комментарий: ${escapeHtml(comment)}\n` : '') +
      `\nСтатус: ${escapeHtml(lead.status)}`
    ).catch(() => {})
  }

  if (oldUserId && oldUserId !== new_user_id) {
    const { data: oldProfile } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', oldUserId)
      .single()
    if (oldProfile?.telegram_chat_id) {
      await sendTelegramMessage(
        oldProfile.telegram_chat_id,
        `⚠ <b>Лид ${escapeHtml(clientName)}</b> переведён руководителем на другого риелтора.`
      ).catch(() => {})
    }
  }

  // Если по этому лиду была эскалация «никто не взял» — поправляем
  // сообщения у руководителя, чтобы не было путаницы.
  await resolveEscalationMessages(
    supabase,
    lead.id,
    `✅ <b>Лид назначен: ${escapeHtml(newProfile.name || newProfile.email || 'риелтор')}</b>\n` +
    `Клиент: ${escapeHtml(clientName)} (${escapeHtml(phone)})\n` +
    `Назначил: руководитель`
  )

  return res.status(200).json({ ok: true })
}

async function reopen(supabase, caller, lead, body, res) {
  const { new_user_id, comment } = body
  if (!TERMINAL.has(lead.status)) return res.status(400).json({ error: 'Лид не закрыт' })
  if (lead.status === 'deal_done') return res.status(400).json({ error: 'Завершённую сделку нельзя открыть заново' })
  if (!new_user_id) return res.status(400).json({ error: 'Укажи риелтора' })

  const { data: newProfile } = await supabase
    .from('profiles')
    .select('id, name, email, crm_enabled, telegram_chat_id')
    .eq('id', new_user_id)
    .single()
  if (!newProfile) return res.status(404).json({ error: 'Риелтор не найден' })

  const prevStatus = lead.status
  const prevAssignee = lead.assigned_user_id

  const { error } = await supabase
    .from('leads')
    .update({
      status: 'in_work',
      assigned_user_id: new_user_id,
      assigned_at: new Date().toISOString(),
      close_reason: null,
      closed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lead.id)
  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('lead_events').insert({
    lead_id: lead.id,
    actor_user_id: caller.user.id,
    event_type: 'reopened',
    from_status: prevStatus,
    to_status: 'in_work',
    comment: comment || null,
    meta: { prev_assignee: prevAssignee, new_assignee: new_user_id },
  })

  const sourceName = lead.lead_sources?.name || lead.lead_sources?.kind || 'источник'
  const clientName = lead.name || '—'
  const phone = lead.phone || '—'

  if (newProfile.telegram_chat_id) {
    await sendTelegramMessage(
      newProfile.telegram_chat_id,
      `📂 <b>Лид возвращён в работу</b>\n\n` +
      `Клиент: ${escapeHtml(clientName)} (${escapeHtml(phone)})\n` +
      `Источник: ${escapeHtml(sourceName)}\n` +
      `Был закрыт как «${escapeHtml(prevStatus)}», руководитель вернул и передал вам.\n` +
      (comment ? `Комментарий: ${escapeHtml(comment)}` : '')
    ).catch(() => {})
  }

  if (prevAssignee && prevAssignee !== new_user_id) {
    const { data: oldProfile } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', prevAssignee)
      .single()
    if (oldProfile?.telegram_chat_id) {
      await sendTelegramMessage(
        oldProfile.telegram_chat_id,
        `⚠ Лид ${escapeHtml(clientName)}, который вы закрыли как «${escapeHtml(prevStatus)}», руководитель вернул в работу и передал другому риелтору.`
      ).catch(() => {})
    }
  }

  return res.status(200).json({ ok: true })
}

async function confirmInWork(supabase, caller, lead, body, res) {
  const { external_base_id } = body
  if (!String(external_base_id || '').trim()) {
    return res.status(400).json({ error: 'external_base_id обязателен — ID в базе агентства' })
  }
  if (lead.status !== 'add_to_base') {
    return res.status(400).json({ error: 'Лид не в статусе add_to_base' })
  }

  const { error } = await supabase
    .from('leads')
    .update({
      status: 'in_work',
      external_base_id: String(external_base_id).trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', lead.id)
  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('lead_events').insert({
    lead_id: lead.id,
    actor_user_id: caller.user.id,
    event_type: 'admin_confirmed',
    from_status: 'add_to_base',
    to_status: 'in_work',
    meta: { external_base_id: String(external_base_id).trim() },
  })

  // Уведомление риелтору
  if (lead.profiles?.telegram_chat_id) {
    await sendTelegramMessage(
      lead.profiles.telegram_chat_id,
      `✅ <b>Лид ${escapeHtml(lead.name || '—')} внесён в базу</b>\n\n` +
      `ID в базе агентства: <code>${escapeHtml(external_base_id)}</code>\n` +
      `Веди клиента до сделки.`
    ).catch(() => {})
  }

  return res.status(200).json({ ok: true })
}

async function notifyManagersClosed(supabase, lead, status, comment, closerId) {
  const { data: closer } = await supabase
    .from('profiles')
    .select('name, email')
    .eq('id', closerId)
    .single()
  const closerName = closer?.name || closer?.email || 'риелтор'
  const statusLabel = status === 'not_lead' ? 'Не лид' : 'Срыв сделки'
  const sourceName = lead.lead_sources?.name || lead.lead_sources?.kind || 'источник'

  const text =
    `⚠ <b>Лид закрыт: ${escapeHtml(statusLabel)}</b>\n\n` +
    `Клиент: ${escapeHtml(lead.name || '—')} (${escapeHtml(lead.phone || '—')})\n` +
    `Источник: ${escapeHtml(sourceName)}\n` +
    `Риелтор: ${escapeHtml(closerName)}\n` +
    (comment ? `Причина: ${escapeHtml(comment)}` : '')

  const { data: managers } = await supabase
    .from('profiles')
    .select('telegram_chat_id')
    .in('role', ['admin', 'manager'])
    .not('telegram_chat_id', 'is', null)

  for (const m of managers || []) {
    if (!m.telegram_chat_id) continue
    try { await sendTelegramMessage(m.telegram_chat_id, text) } catch {}
  }
}

async function notifyAdminsAddToBase(supabase, lead) {
  const sourceName = lead.lead_sources?.name || lead.lead_sources?.kind || 'источник'
  const realtorName = lead.profiles?.name || lead.profiles?.email || '—'
  const text =
    `📋 <b>Внести в базу агентства</b>\n\n` +
    `Клиент: ${escapeHtml(lead.name || '—')} (${escapeHtml(lead.phone || '—')})\n` +
    `Источник: ${escapeHtml(sourceName)}\n` +
    `Риелтор: ${escapeHtml(realtorName)}\n\n` +
    `Открой лид в админке и подтверди «Внесено в базу» с ID.`

  const { data: admins } = await supabase
    .from('profiles')
    .select('telegram_chat_id')
    .in('role', ['admin', 'manager'])
    .not('telegram_chat_id', 'is', null)

  for (const a of admins || []) {
    if (!a.telegram_chat_id) continue
    try { await sendTelegramMessage(a.telegram_chat_id, text) } catch {}
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
