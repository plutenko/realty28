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

  // public — даём кешировать на CF-edge и любых промежуточных кешах.
  // s-maxage=300: edge держит 5 мин (соответствует серверному кешу)
  // stale-while-revalidate=86400: пока ETag не изменится, edge может отдавать
  //   старую версию ещё сутки и обновлять в фоне
  // ETag + browser If-None-Match → 304 продолжают работать как раньше.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400')

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

    // Только список ID корпусов нужен для запроса /units. Сами объекты building/complex/
    // developer на клиенте подтягиваются из /api/complexes, чтобы не дублировать их в
    // каждой квартире (раньше payload /api/units был ~3 МБ из-за вложенного building).
    // Поэтажные планы (~130 КБ URL'ов) тоже не таскаем — модалка дёргает /api/unit-floor-plan/[id] лениво.
    const buildingIds = []
    for (const c of complexes ?? []) {
      for (const b of c.buildings ?? []) buildingIds.push(b.id)
    }

    const flat = []
    const PAGE = 1000
    let from = 0
    while (true) {
      // Поля external_id/source_id/finish_image_url/floor_plan_url нужны только
      // в админке или для модалки (lazy через /api/unit-floor-plan/[id]).
      const { data: units, error: uErr } = await supabase
        .from('units')
        .select('id, building_id, floor, number, position, entrance, rooms, area, layout_title, layout_image_url, price, price_per_meter, status, span_columns, span_floors, is_commercial, has_renovation')
        .in('building_id', buildingIds)
        .not('status', 'in', '("sold","booked","reserved","closed")')
        .order('id')
        .range(from, from + PAGE - 1)

      if (uErr) throw uErr
      for (const u of units ?? []) flat.push(u)
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
