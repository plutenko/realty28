import { getSupabaseAdmin } from '../../lib/supabaseServer'

function normalizeStatus(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
  if (s === 'SOLD') return 'sold'
  if (s === 'RESERVED') return 'booked'
  return 'available'
}

function toNumberOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { units, sourceId } = req.body || {}
  if (!sourceId) {
    return res.status(400).json({ error: 'sourceId is required' })
  }
  if (!Array.isArray(units)) {
    return res.status(400).json({ error: 'No data' })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase admin is not configured' })
  }

  const { data: source, error: sourceErr } = await supabase
    .from('sources')
    .select('id, building_id')
    .eq('id', sourceId)
    .maybeSingle()
  if (sourceErr) {
    return res.status(500).json({ error: sourceErr.message })
  }
  if (!source?.building_id) {
    return res.status(400).json({ error: 'Source building_id is required' })
  }

  const now = new Date().toISOString()
  const payload = units.map((p) => ({
    source_id: source.id,
    building_id: source.building_id,
    number: toNumberOrNull(p?.number),
    floor: toNumberOrNull(p?.floor),
    rooms: toNumberOrNull(p?.rooms_amount),
    area: toNumberOrNull(p?.area?.area_total),
    price: toNumberOrNull(p?.price?.value),
    price_per_meter: toNumberOrNull(p?.price?.pricePerMeter),
    status: normalizeStatus(p?.status),
    position: toNumberOrNull(p?.attributes?.position_on_floor),
    external_id: p?.id != null ? String(p.id) : null,
    last_seen_at: now,
  }))

  let inserted = 0
  if (payload.length > 0) {
    const withExternal = payload.filter((u) => u.external_id)
    const withoutExternal = payload.filter((u) => !u.external_id)

    if (withExternal.length > 0) {
      const { error } = await supabase
        .from('units')
        .upsert(withExternal, { onConflict: 'external_id' })
      if (error) return res.status(500).json({ error: error.message })
      inserted += withExternal.length
    }

    if (withoutExternal.length > 0) {
      const { error } = await supabase
        .from('units')
        .upsert(withoutExternal, { onConflict: 'building_id,number' })
      if (error) return res.status(500).json({ error: error.message })
      inserted += withoutExternal.length
    }
  }

  const { error: staleErr } = await supabase
    .from('units')
    .update({ status: 'sold' })
    .eq('source_id', source.id)
    .eq('building_id', source.building_id)
    .lt('last_seen_at', now)
  if (staleErr) {
    return res.status(500).json({ error: staleErr.message })
  }

  return res.status(200).json({ success: true, count: inserted })
}
