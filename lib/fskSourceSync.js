/**
 * Парсер FSK (fsk.ru) — собственный API застройщика.
 * URL источника: slug ЖК, опционально через | номер корпуса.
 * Примеры: "flabellum" или "flabellum|2.3"
 */

const FSK_API = 'https://fsk.ru/api/v3/flats/all'

export async function collectUnitsFromFskSource(source) {
  const raw = String(source.url || '').trim()
  const [slug, corpusFilter] = raw.split('|').map(s => s.trim())

  if (!slug) {
    return { units: [], error: 'Не указан slug ЖК (например: flabellum)', meta: null }
  }

  const url = `${FSK_API}?complex_slug=${encodeURIComponent(slug)}&limit=5000`
  let res
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch (e) {
    return { units: [], error: `Ошибка запроса FSK: ${e.message}`, meta: null }
  }

  if (!res.ok) {
    return { units: [], error: `FSK API HTTP ${res.status}`, meta: null }
  }

  let json
  try {
    json = await res.json()
  } catch {
    return { units: [], error: 'FSK API: невалидный JSON', meta: null }
  }

  const flats = json.data ?? json.items ?? json
  if (!Array.isArray(flats) || flats.length === 0) {
    return { units: [], error: null, meta: null }
  }

  const filtered = corpusFilter
    ? flats.filter(f => String(f.corpus?.number || '') === corpusFilter)
    : flats

  const units = filtered.map(f => {
    const st = Number(f.status)
    let status = 'available'
    if (st === 1 || st === 3) status = 'reserved'
    if (st === 2 || st === 4) status = 'sold'

    return {
      source_id: source.id,
      building_id: source.building_id,
      external_id: f.externalId || f._id,
      number: f.number != null ? String(f.number) : null,
      floor: f.floorNumber ?? null,
      position: f.numberOnFloor ?? null,
      entrance: f.section?.number ? Number(f.section.number) : null,
      rooms: f.rooms ?? null,
      area: f.areaTotal ?? null,
      price: f.price ?? 0,
      price_per_meter: f.pricePerMeter ?? null,
      status,
      layout_image_url: f.plan || null,
    }
  })

  const floors = filtered.map(f => f.floorNumber).filter(Number.isFinite)
  const maxFloor = floors.length ? Math.max(...floors) : null
  const positionsPerFloor = {}
  for (const f of filtered) {
    const fl = f.floorNumber
    if (!Number.isFinite(fl)) continue
    positionsPerFloor[fl] = (positionsPerFloor[fl] || 0) + 1
  }
  const perFloorCounts = Object.values(positionsPerFloor)
  const unitsPerFloor = perFloorCounts.length ? Math.max(...perFloorCounts) : null

  return {
    units,
    error: null,
    meta: {
      floorsCount: maxFloor,
      unitsPerFloor,
    },
  }
}
