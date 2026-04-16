import { getSupabaseAdmin } from '../../lib/supabaseServer'

let cache = { data: null, ts: 0 }
const TTL = 5 * 60 * 1000

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const now = Date.now()
  if (cache.data && now - cache.ts < TTL) {
    res.setHeader('X-Cache', 'HIT')
    return res.status(200).json(cache.data)
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'DB not configured' })

  try {
    const { data: complexes, error: cErr } = await supabase
      .from('complexes')
      .select(`
        id, name, city, realtor_commission_type, realtor_commission_value, developer_id,
        developers ( id, name ),
        buildings (
          id, name, floors, units_per_floor, units_per_entrance,
          units ( id, floor, number, position, entrance, rooms, area, layout_title, layout_image_url, finish_image_url, price, price_per_meter, status, span_columns, span_floors, is_commercial )
        )
      `)
      .order('name')

    if (cErr) throw cErr
    const rows = complexes ?? []
    const ids = rows.map(c => c.id)

    // Complex images
    const { data: imgRows } = ids.length
      ? await supabase.from('images').select('entity_id, url').eq('entity_type', 'complex').in('entity_id', ids)
      : { data: [] }

    const urlByComplex = new Map()
    for (const r of imgRows ?? []) {
      if (r?.entity_id && !urlByComplex.has(r.entity_id)) urlByComplex.set(r.entity_id, r.url)
    }

    const data = rows.map(c => ({ ...c, image: urlByComplex.get(c.id) ?? null }))

    // Floor plans
    const buildingIds = []
    for (const c of rows) for (const b of c.buildings ?? []) if (b?.id) buildingIds.push(b.id)
    const uniqBids = [...new Set(buildingIds)]

    if (uniqBids.length > 0) {
      const { data: fpRows } = await supabase.from('images').select('entity_id, url').eq('entity_type', 'building_floor_plan').in('entity_id', uniqBids)
      const fpMap = new Map()
      for (const r of fpRows ?? []) if (r?.entity_id && !fpMap.has(r.entity_id)) fpMap.set(r.entity_id, r.url)

      const { data: plRows } = await supabase.from('images').select('entity_id, floor_level, url, id').eq('entity_type', 'building_floor_level_plan').in('entity_id', uniqBids).order('id', { ascending: false })
      const plMap = new Map()
      for (const r of plRows ?? []) {
        if (!r?.entity_id || r.floor_level == null) continue
        const key = `${r.entity_id}/${r.floor_level}`
        if (!plMap.has(key)) plMap.set(key, r.url)
      }

      for (const c of data) {
        c.buildings = (c.buildings ?? []).map(b => {
          const byFloor = {}
          for (const [key, url] of plMap) {
            const idx = key.lastIndexOf('/')
            if (idx === -1) continue
            if (key.slice(0, idx) !== b.id) continue
            const n = Number(key.slice(idx + 1))
            if (Number.isFinite(n) && !byFloor[n]) byFloor[n] = url
          }
          return { ...b, floorPlanUrl: fpMap.get(b.id) ?? null, floorPlanByFloor: byFloor }
        })
      }
    }

    cache = { data, ts: now }
    res.setHeader('X-Cache', 'MISS')
    return res.status(200).json(data)
  } catch (e) {
    console.error('[api/complexes] error:', e)
    return res.status(500).json({ error: 'Failed to fetch complexes' })
  }
}
