import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { mapMarquizPayload } from '../../../../lib/leadsCore'
import { broadcastLead } from '../../../../lib/leadsTelegram'
import { sendTelegramMessage } from '../../../../lib/telegram'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { source_key } = req.query
  if (!source_key || typeof source_key !== 'string') {
    return res.status(400).json({ error: 'source_key missing' })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'supabase not configured' })

  const { data: source } = await supabase
    .from('lead_sources')
    .select('id, kind, name, is_active')
    .eq('source_key', source_key)
    .maybeSingle()

  if (!source) return res.status(404).json({ error: 'source not found' })
  if (!source.is_active) return res.status(410).json({ error: 'source disabled' })

  const payload = req.body || {}

  let mapped
  try {
    mapped = source.kind === 'marquiz' ? mapMarquizPayload(payload) : defaultMap(payload)
  } catch (e) {
    console.error('[leads-webhook] mapping error', e)
    return res.status(200).json({ ok: true, warn: 'mapping_failed' })
  }

  // Дедупликация: если по нормализованному телефону есть АКТИВНЫЙ лид
  // (new / add_to_base / in_work) — не плодим новый, отмечаем repeat_submission
  // на существующем и пингуем риелтора/руководителя.
  if (mapped.phone_normalized) {
    const { data: existing } = await supabase
      .from('leads')
      .select('id, status, assigned_user_id, name, phone, profiles:assigned_user_id(name, telegram_chat_id)')
      .eq('phone_normalized', mapped.phone_normalized)
      .in('status', ['new', 'add_to_base', 'in_work'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      await supabase.from('lead_events').insert({
        lead_id: existing.id,
        event_type: 'repeat_submission',
        meta: { source_kind: source.kind, source_name: source.name, payload: payload },
      })

      await notifyRepeatSubmission(supabase, existing, source).catch(() => {})

      return res.status(200).json({
        ok: true,
        id: existing.id,
        deduplicated: true,
      })
    }
  }

  const insert = {
    source_id: source.id,
    status: 'new',
    name: mapped.name,
    phone: mapped.phone,
    phone_normalized: mapped.phone_normalized,
    email: mapped.email,
    budget: mapped.budget,
    rooms: mapped.rooms,
    answers: mapped.answers || [],
    utm: mapped.utm || {},
    raw: payload,
  }

  const { data: lead, error } = await supabase
    .from('leads')
    .insert(insert)
    .select('id')
    .single()

  if (error) {
    console.error('[leads-webhook] insert error', error)
    return res.status(500).json({ error: error.message })
  }

  await supabase.from('lead_events').insert({
    lead_id: lead.id,
    event_type: 'created',
    to_status: 'new',
    meta: { source_kind: source.kind, source_name: source.name },
  })

  // Рассылка до ответа (setImmediate обрезалось Next.js после res.send).
  // Таймаут 8 сек, чтобы Марквиз не посчитал webhook провалившимся.
  try {
    const { data: full } = await supabase
      .from('leads')
      .select('id, name, phone, email, rooms, budget, answers, created_at')
      .eq('id', lead.id)
      .single()
    if (full) {
      const broadcastPromise = broadcastLead(supabase, full, source)
      const timeout = new Promise(r => setTimeout(() => r({ sent: 0, timeout: true }), 8000))
      const result = await Promise.race([broadcastPromise, timeout])
      console.log('[leads-webhook] broadcast result', result)
    }
  } catch (e) {
    console.error('[leads-webhook] broadcast error', e?.message || e)
  }

  return res.status(200).json({ ok: true, id: lead.id })
}

async function notifyRepeatSubmission(supabase, existing, source) {
  const sourceName = source?.name || source?.kind || 'источник'
  const name = existing.name || '—'
  const phone = existing.phone || '—'

  // Если лид уже у риелтора — пингуем его
  const realtorChat = existing.profiles?.telegram_chat_id
  const realtorName = existing.profiles?.name || ''

  if (realtorChat) {
    const text =
      `🔁 <b>Повторная заявка от клиента</b>\n\n` +
      `${escapeHtml(name)} (${escapeHtml(phone)})\n` +
      `Источник: ${escapeHtml(sourceName)}\n\n` +
      `Это ваш текущий лид, клиент снова оставил заявку. Свяжитесь с ним, если ещё не сделали.`
    try { await sendTelegramMessage(realtorChat, text) } catch {}
  }

  // Руководителям — тоже ставим в известность
  const { data: managers } = await supabase
    .from('profiles')
    .select('telegram_chat_id')
    .in('role', ['admin', 'manager'])
    .not('telegram_chat_id', 'is', null)

  const managerText =
    `🔁 <b>Повторная заявка от клиента</b>\n\n` +
    `${escapeHtml(name)} (${escapeHtml(phone)})\n` +
    `Источник: ${escapeHtml(sourceName)}\n` +
    (realtorName ? `Уже у риелтора: ${escapeHtml(realtorName)}` : `Пока никем не взято.`)

  for (const m of managers || []) {
    if (!m.telegram_chat_id) continue
    try { await sendTelegramMessage(m.telegram_chat_id, managerText) } catch {}
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function defaultMap(payload) {
  const p = payload || {}
  return {
    name: p.name || null,
    phone: p.phone || null,
    phone_normalized: null,
    email: p.email || null,
    budget: null,
    rooms: null,
    answers: [],
    utm: {},
  }
}
