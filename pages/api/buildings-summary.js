import { getSupabaseAdmin } from '../../lib/supabaseServer'

let cache = { data: null, ts: 0 }
const TTL = 5 * 60 * 1000

export default async function handler(req, res) {
  if (req.method === 'DELETE' || req.query?.invalidate === '1') {
    cache = { data: null, ts: 0 }
    res.setHeader('X-Cache', 'INVALIDATED')
    if (req.method === 'DELETE') return res.status(204).end()
  }
  if (req.method !== 'GET') return res.status(405).end()

  res.setHeader('Cache-Control', 'private, must-revalidate, max-age=0')

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
        id, name,
        developer:developer_id ( id, name ),
        buildings ( id, name, address, lat, lng, handover_status, handover_quarter, handover_year )
      `)
      .order('name')
    if (cErr) throw cErr

    const buildingIds = []
    for (const c of complexes ?? [])
      for (const b of c.buildings ?? []) if (b?.id) buildingIds.push(b.id)

    const counts = new Map()
    if (buildingIds.length > 0) {
      const PAGE = 1000
      let from = 0
      while (true) {
        const { data: rows, error: uErr } = await supabase
          .from('units')
          .select('building_id')
          .in('building_id', buildingIds)
          .not('status', 'in', '("sold","booked","reserved","closed")')
          .range(from, from + PAGE - 1)
        if (uErr) throw uErr
        for (const r of rows ?? []) {
          counts.set(r.building_id, (counts.get(r.building_id) ?? 0) + 1)
        }
        if (!rows || rows.length < PAGE) break
        from += PAGE
      }
    }

    const buildings = []
    for (const c of complexes ?? []) {
      const dev = Array.isArray(c.developer) ? c.developer[0] : c.developer
      for (const b of c.buildings ?? []) {
        if (!b?.id) continue
        buildings.push({
          id: b.id,
          name: b.name,
          address: b.address,
          lat: b.lat,
          lng: b.lng,
          handover_status: b.handover_status,
          handover_quarter: b.handover_quarter,
          handover_year: b.handover_year,
          complex: {
            id: c.id,
            name: c.name,
            developer: dev ? { id: dev.id, name: dev.name } : null,
          },
          available_count: counts.get(b.id) ?? 0,
        })
      }
    }

    cache = { data: buildings, ts: now }
    res.setHeader('X-Cache', 'MISS')
    return res.status(200).json(buildings)
  } catch (e) {
    console.error('[api/buildings-summary] error:', e)
    return res.status(500).json({ error: 'Failed to fetch buildings summary' })
  }
}
