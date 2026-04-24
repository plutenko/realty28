import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { sendTelegramMessage } from '../../../../lib/telegram'
import { requireCrmRealtor } from './index'

// Риелтор может менять статус своего лида по воронке:
//   new → add_to_base (уведомляем админа)
//   new → not_lead (обязательный коммент, уведомляем руководителя)
//   in_work → deal_done
//   in_work → failed (обязательный коммент, уведомляем руководителя)
// Подтверждение add_to_base → in_work делает только админ через /api/admin/leads.

const TERMINAL = new Set(['not_lead', 'deal_done', 'failed'])
const ALLOWED_TRANSITIONS = {
  new: ['add_to_base', 'not_lead'],
  add_to_base: [],
  in_work: ['deal_done', 'failed'],
}

export default async function handler(req, res) {
  const caller = await requireCrmRealtor(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id обязателен' })

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action, status, comment } = req.body || {}
  if (action !== 'change_status') return res.status(400).json({ error: 'action должен быть change_status' })

  const supabase = getSupabaseAdmin()

  const { data: lead } = await supabase
    .from('leads')
    .select(`id, status, name, phone, email, assigned_user_id, lead_sources(name, kind)`)
    .eq('id', id)
    .single()

  if (!lead) return res.status(404).json({ error: 'Лид не найден' })
  if (lead.assigned_user_id !== caller.user.id) {
    return res.status(403).json({ error: 'Это не ваш лид' })
  }

  if (lead.status === status) {
    return res.status(200).json({ ok: true, noop: true })
  }

  const allowed = ALLOWED_TRANSITIONS[lead.status] || []
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Нельзя перевести из «${lead.status}» в «${status}»` })
  }

  if ((status === 'not_lead' || status === 'failed') && !String(comment || '').trim()) {
    return res.status(400).json({ error: 'Для этого статуса обязательна причина' })
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

  // Уведомления
  if (status === 'add_to_base') {
    await notifyAdminsAddToBase(supabase, lead, caller).catch(() => {})
  }
  if (status === 'not_lead' || status === 'failed') {
    await notifyManagersClosed(supabase, lead, status, comment, caller).catch(() => {})
  }

  return res.status(200).json({ ok: true })
}

async function notifyAdminsAddToBase(supabase, lead, caller) {
  const sourceName = lead.lead_sources?.name || lead.lead_sources?.kind || 'источник'
  const { data: me } = await supabase.from('profiles').select('name, email').eq('id', caller.user.id).single()
  const realtorName = me?.name || me?.email || '—'
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

async function notifyManagersClosed(supabase, lead, status, comment, caller) {
  const { data: me } = await supabase.from('profiles').select('name, email').eq('id', caller.user.id).single()
  const closerName = me?.name || me?.email || 'риелтор'
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

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
