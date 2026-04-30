import { getSupabaseAdmin } from '../../../lib/supabaseServer'

const cache = new Map()
const TTL = 5 * 60 * 1000

/**
 * Lazy-fetch URL поэтажного плана конкретной квартиры. Используется ApartmentModal
 * при открытии — не таскаем 130+ КБ floor_plan_url в общем /api/units.
 *
 * Источник:
 *   1. units.floor_plan_url (если уже задан — например, FSK с подсветкой квартиры)
 *   2. images table: общий план этажа дома (entrance-specific → fallback на общий)
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const id = String(req.query?.id || '').trim()
  if (!id) return res.status(400).json({ error: 'id required' })

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400')

  const cached = cache.get(id)
  if (cached && Date.now() - cached.ts < TTL) {
    res.setHeader('X-Cache', 'HIT')
    return res.status(200).json({ url: cached.url })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'DB not configured' })

  const { data: unit, error: uErr } = await supabase
    .from('units')
    .select('id, building_id, floor, entrance, floor_plan_url')
    .eq('id', id)
    .maybeSingle()
  if (uErr) return res.status(500).json({ error: uErr.message })
  if (!unit) return res.status(404).json({ error: 'unit not found' })

  let url = unit.floor_plan_url || null

  if (!url && unit.building_id && unit.floor != null) {
    async function pickPlan(entranceFilter) {
      let q = supabase
        .from('images')
        .select('url')
        .eq('entity_type', 'building_floor_level_plan')
        .eq('entity_id', unit.building_id)
        .eq('floor_level', unit.floor)
      q = entranceFilter == null ? q.is('entrance', null) : q.eq('entrance', entranceFilter)
      const { data } = await q.order('id', { ascending: false }).limit(1).maybeSingle()
      return data?.url ?? null
    }
    if (unit.entrance != null) url = await pickPlan(unit.entrance)
    if (!url) url = await pickPlan(null)
  }

  cache.set(id, { url, ts: Date.now() })
  res.setHeader('X-Cache', 'MISS')
  return res.status(200).json({ url })
}
