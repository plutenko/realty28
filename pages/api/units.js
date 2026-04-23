import { getSupabaseAdmin } from '../../lib/supabaseServer'

let cache = { data: null, ts: 0 }
const TTL = 5 * 60 * 1000 // 5 минут

export default async function handler(req, res) {
  if (req.method === 'DELETE' || req.query?.invalidate === '1') {
    cache = { data: null, ts: 0 }
    res.setHeader('X-Cache', 'INVALIDATED')
    if (req.method === 'DELETE') return res.status(204).end()
  }
  if (req.method !== 'GET') return res.status(405).end()

  const now = Date.now()
  const fresh = req.query?.fresh === '1' || req.query?.invalidate === '1'
  if (!fresh && cache.data && now - cache.ts < TTL) {
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

    // Поэтажные планы — может быть несколько на этаж (если дом с разными
    // планировками по подъездам). Ключи: (building_id, floor_level, entrance)
    // и (building_id, floor_level, null). В лукапе сначала entrance-specific,
    // иначе fallback на план «на весь дом» (entrance=null).
    const floorPlanByEntranceMap = new Map()
    const floorPlanAllMap = new Map()
    if (buildingIds.length > 0) {
      const { data: plRows, error: plErr } = await supabase
        .from('images')
        .select('entity_id, floor_level, entrance, url, id')
        .eq('entity_type', 'building_floor_level_plan')
        .in('entity_id', buildingIds)
        .order('id', { ascending: false })
      if (
        plErr &&
        !/floor_level|entrance|column|schema cache/i.test(String(plErr.message || ''))
      ) {
        throw plErr
      }
      for (const r of plRows ?? []) {
        if (r.floor_level == null) continue
        if (r.entrance == null) {
          const key = `${r.entity_id}::${r.floor_level}`
          if (!floorPlanAllMap.has(key)) floorPlanAllMap.set(key, r.url)
        } else {
          const key = `${r.entity_id}::${r.floor_level}::${r.entrance}`
          if (!floorPlanByEntranceMap.has(key)) floorPlanByEntranceMap.set(key, r.url)
        }
      }
    }

    const flat = []
    const PAGE = 1000
    let from = 0
    while (true) {
      const { data: units, error: uErr } = await supabase
        .from('units')
        .select('id, building_id, floor, number, position, entrance, rooms, area, layout_title, layout_image_url, finish_image_url, floor_plan_url, price, price_per_meter, status, span_columns, span_floors, is_commercial, has_renovation, external_id, source_id')
        .in('building_id', buildingIds)
        .not('status', 'in', '("sold","booked","reserved","closed")')
        .order('id')
        .range(from, from + PAGE - 1)

      if (uErr) throw uErr
      for (const u of units ?? []) {
        const ctx = buildingCtx.get(u.building_id)
        if (!ctx) continue
        // Приоритет: персональный план квартиры (FSK: SVG этажа с подсветкой
        // этой квартиры) > общий план этажа из images (MacroCRM/Amurstroy).
        let plan = null
        if (u.floor != null) {
          if (u.entrance != null) {
            plan = floorPlanByEntranceMap.get(`${u.building_id}::${u.floor}::${u.entrance}`) ?? null
          }
          if (!plan) plan = floorPlanAllMap.get(`${u.building_id}::${u.floor}`) ?? null
        }
        const floor_plan_url = u.floor_plan_url || plan
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
