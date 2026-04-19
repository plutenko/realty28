import { getSupabaseAdmin } from '../../lib/supabaseServer'

let cache = { data: null, ts: 0 }
const TTL = 5 * 60 * 1000 // 5 минут

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
        id, name, website_url, realtor_commission_type, realtor_commission_value,
        developer:developer_id (
          id, name,
          developer_managers ( id, name, phone, short_description, messenger, messenger_contact, created_at )
        ),
        buildings ( id, name, address, floors, units_per_floor, units_per_entrance, handover_status, handover_quarter, handover_year )
      `)
      .order('name')

    if (cErr) throw cErr

    const buildingCtx = new Map()
    for (const c of complexes ?? []) {
      const dev = Array.isArray(c.developer) ? c.developer[0] : c.developer
      for (const b of c.buildings ?? []) {
        buildingCtx.set(b.id, {
          building: b,
          complex: { id: c.id, name: c.name, website_url: c.website_url, realtor_commission_type: c.realtor_commission_type, realtor_commission_value: c.realtor_commission_value },
          developer: dev ? { ...dev, developer_managers: dev.developer_managers ?? [] } : null,
        })
      }
    }

    const buildingIds = [...buildingCtx.keys()]

    // Поэтажные планы — ключ (building_id, floor_level) -> url.
    // Один запрос на все здания, группируем в Map для O(1) лукапа.
    const floorPlanMap = new Map()
    if (buildingIds.length > 0) {
      const { data: plRows, error: plErr } = await supabase
        .from('images')
        .select('entity_id, floor_level, url, id')
        .eq('entity_type', 'building_floor_level_plan')
        .in('entity_id', buildingIds)
        .order('id', { ascending: false })
      if (plErr && !/floor_level|column|schema cache/i.test(String(plErr.message || ''))) {
        throw plErr
      }
      for (const r of plRows ?? []) {
        if (r.floor_level == null) continue
        const key = `${r.entity_id}::${r.floor_level}`
        if (!floorPlanMap.has(key)) floorPlanMap.set(key, r.url)
      }
    }

    const flat = []
    const PAGE = 1000
    let from = 0
    while (true) {
      const { data: units, error: uErr } = await supabase
        .from('units')
        .select('id, building_id, floor, number, position, entrance, rooms, area, layout_title, layout_image_url, finish_image_url, price, price_per_meter, status, span_columns, span_floors, is_commercial, external_id, source_id')
        .in('building_id', buildingIds)
        .not('status', 'in', '("sold","booked","reserved","closed")')
        .order('id')
        .range(from, from + PAGE - 1)

      if (uErr) throw uErr
      for (const u of units ?? []) {
        const ctx = buildingCtx.get(u.building_id)
        if (!ctx) continue
        const floor_plan_url =
          u.floor != null ? floorPlanMap.get(`${u.building_id}::${u.floor}`) ?? null : null
        flat.push({
          ...u,
          floor_plan_url,
          building: {
            ...ctx.building,
            complex: { ...ctx.complex, developer: ctx.developer },
          },
        })
      }
      if (!units || units.length < PAGE) break
      from += PAGE
    }

    cache = { data: flat, ts: now }
    res.setHeader('X-Cache', 'MISS')
    return res.status(200).json(flat)
  } catch (e) {
    console.error('[api/units] error:', e)
    return res.status(500).json({ error: 'Failed to fetch units' })
  }
}
