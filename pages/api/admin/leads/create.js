import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { normalizePhone } from '../../../../lib/leadsCore'
import { broadcastLead } from '../../../../lib/leadsTelegram'
import { sendTelegramMessage } from '../../../../lib/telegram'
import { requireAdminOrManager } from './index'

/**
 * POST /api/admin/leads/create
 * Создание лида вручную админом/руководителем (со звонка, встречи и т.п.).
 * Поля: { source_id, name, phone, email, rooms, budget, comment, assigned_user_id? }
 *
 * Если assigned_user_id задан — лид сразу у указанного риелтора (без Беру),
 * ему шлётся карточка с контактами в Домовой. Иначе — обычная рассылка всем
 * CRM-риелторам.
 */
export default async function handler(req, res) {
  const caller = await requireAdminOrManager(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { source_id, name, phone, email, rooms, budget, comment, assigned_user_id } = req.body || {}
  if (!source_id) return res.status(400).json({ error: 'source_id обязателен' })
  if (!name && !phone) return res.status(400).json({ error: 'Нужно хотя бы имя или телефон' })

  const supabase = getSupabaseAdmin()

  const { data: source } = await supabase
    .from('lead_sources')
    .select('id, kind, name, is_active')
    .eq('id', source_id)
    .maybeSingle()
  if (!source) return res.status(404).json({ error: 'Источник не найден' })
  if (!source.is_active) return res.status(410).json({ error: 'Источник отключен' })

  const phone_normalized = normalizePhone(phone)

  // Дедупликация
  if (phone_normalized) {
    const { data: existing } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone_normalized', phone_normalized)
      .in('status', ['new', 'add_to_base', 'in_work'])
      .maybeSingle()
    if (existing) {
      return res.status(409).json({ error: 'У клиента уже есть активный лид', existing_id: existing.id })
    }
  }

  const now = new Date().toISOString()
  const insert = {
    source_id: source.id,
    status: 'new',
    name: name || null,
    phone: phone || null,
    phone_normalized,
    email: email || null,
    rooms: rooms || null,
    budget: budget || null,
    answers: [],
    utm: {},
    raw: { manual: true, created_by: caller.user.id, comment: comment || null },
  }

  // Если сразу назначаем риелтору — пропускаем «Беру», проставляем assignee
  if (assigned_user_id) {
    const { data: target } = await supabase
      .from('profiles')
      .select('id, telegram_chat_id, crm_enabled, name')
      .eq('id', assigned_user_id)
      .maybeSingle()
    if (!target) return res.status(404).json({ error: 'Риелтор не найден' })
    insert.assigned_user_id = assigned_user_id
    insert.assigned_at = now
    insert.reaction_seconds = 0
  }

  const { data: lead, error } = await supabase
    .from('leads')
    .insert(insert)
    .select('id, name, phone, email, rooms, budget, messenger, answers, created_at, source_id, assigned_user_id')
    .single()
  if (error) return res.status(500).json({ error: error.message })

  // События
  await supabase.from('lead_events').insert({
    lead_id: lead.id,
    actor_user_id: caller.user.id,
    event_type: 'created',
    to_status: 'new',
    comment: comment || null,
    meta: { source_kind: source.kind, source_name: source.name, manual: true },
  })

  if (assigned_user_id) {
    await supabase.from('lead_events').insert({
      lead_id: lead.id,
      actor_user_id: caller.user.id,
      event_type: 'taken',
      to_status: 'new',
      meta: { manual_assignment: true },
    })

    const { data: target } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', assigned_user_id)
      .single()
    if (target?.telegram_chat_id) {
      const text =
        `📂 <b>Вам назначен лид</b>\n\n` +
        `Клиент: ${escapeHtml(lead.name || '—')} (${escapeHtml(lead.phone || '—')})\n` +
        `Источник: ${escapeHtml(source.name)}\n` +
        (lead.email ? `Email: ${escapeHtml(lead.email)}\n` : '') +
        (lead.rooms ? `Комнат: ${escapeHtml(lead.rooms)}\n` : '') +
        (lead.budget ? `Бюджет: ${escapeHtml(lead.budget)}\n` : '') +
        (comment ? `\nКомментарий: ${escapeHtml(comment)}\n` : '') +
        `\nСвяжитесь с клиентом в ближайшие 5 минут.`
      try { await sendTelegramMessage(target.telegram_chat_id, text) } catch {}
    }
  } else {
    // Обычная рассылка (как webhook)
    try { await broadcastLead(supabase, lead, source) } catch {}
  }

  return res.status(201).json({ ok: true, id: lead.id })
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
