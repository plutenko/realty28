import { getSupabaseAdmin } from '../../lib/supabaseServer'

// data — массив для невидимых клиентов; serialized — готовая JSON-строка для send()
let cache = { data: null, serialized: null, ts: 0 }
const TTL = 5 * 60 * 1000 // 5 минут

export default async function handler(req, res) {
  if (req.method === 'DELETE' || req.query?.invalidate === '1') {
    cache = { data: null, serialized: null, ts: 0 }
    res.setHeader('X-Cache', 'INVALIDATED')
    if (req.method === 'DELETE') return res.status(204).end()
  }
  if (req.method !== 'GET') return res.status(405).end()

  // s-maxage=24h для Worker edge / shared cache, max-age=5min для браузера.
  // Инвалидация: ручной `Сбросить кеш` в /admin (cf-purge → Worker /purge), а также
  // автоматический /api/cf-purge при saveUnit в admin.
  res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=300, stale-while-revalidate=86400')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  const now = Date.now()
  const fresh = req.query?.fresh === '1' || req.query?.invalidate === '1'

  // Cache HIT — Next.js сам вешает ETag на res.send() и отдаёт 304 при If-None-Match.
  if (!fresh && cache.serialized && now - cache.ts < TTL) {
    res.setHeader('X-Cache', 'HIT')
    return res.status(200).send(cache.serialized)
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'DB not configured' })

  // Префетч buildingIds — маленький запрос; если упадёт, ещё не начали стримить.
  let buildingIds
  try {
    const { data: complexes, error: cErr } = await supabase
      .from('complexes')
      .select(`
        id,
        buildings ( id )
      `)
      .order('name')
    if (cErr) throw cErr
    buildingIds = []
    for (const c of complexes ?? []) {
      for (const b of c.buildings ?? []) buildingIds.push(b.id)
    }
  } catch (e) {
    console.error('[api/units] complexes fetch error:', e)
    return res.status(500).json({ error: 'Failed to fetch units' })
  }

  // Cache MISS — стримим chunked, чтобы CF edge не буферил весь ответ.
  // Формат — обычный JSON-массив, совместимый с res.json() на клиенте.
  res.setHeader('X-Cache', 'MISS')
  res.setHeader('X-Streaming', '1')
  res.status(200)
  res.write('[')

  const flat = []
  const parts = []
  const PAGE = 1000
  let from = 0
  let first = true
  let streamFailed = false

  try {
    while (true) {
      const { data: units, error: uErr } = await supabase
        .from('units')
        .select('id, building_id, floor, number, rooms, area, layout_title, layout_image_url, price, price_per_meter, status, span_floors, is_commercial, has_renovation')
        .in('building_id', buildingIds)
        .not('status', 'in', '("sold","booked","reserved","closed")')
        .order('id')
        .range(from, from + PAGE - 1)
      if (uErr) throw uErr
      for (const u of units ?? []) {
        flat.push(u)
        const json = JSON.stringify(u)
        parts.push(json)
        res.write(first ? json : ',' + json)
        first = false
      }
      if (!units || units.length < PAGE) break
      from += PAGE
    }
  } catch (e) {
    console.error('[api/units] units stream error:', e)
    streamFailed = true
  }

  res.write(']')
  res.end()

  if (!streamFailed) {
    cache = { data: flat, serialized: '[' + parts.join(',') + ']', ts: now }
  }
}
