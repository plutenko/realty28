import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { mapMarquizPayload } from '../../../../lib/leadsCore'

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

  res.status(200).json({ ok: true, id: lead.id })

  // Рассылку в Telegram добавим отдельным шагом.
  // Пока источник → БД, чтобы проверить сквозное попадание Марквиза.
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
