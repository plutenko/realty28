/**
 * Парсер ПИК (flat.pik-service.ru) — собственный API застройщика.
 * URL источника: blockId|bulkName, пример: "1888|Корпус 1"
 * blockId = id ЖК в PIK (из __NEXT_DATA__ на www.pik.ru/search/...)
 * bulkName = название корпуса (берётся из названия дома в админке)
 */

const PIK_API_BASE = 'https://flat.pik-service.ru/api/v1/filter/flat-by-block'
const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://www.pik.ru/',
}

export async function collectUnitsFromPikSource(source) {
  const raw = String(source.url || '').trim()
  const [blockId, bulkName] = raw.split('|').map(s => s.trim())

  if (!blockId) {
    return { units: [], error: 'Не указан blockId (пример: 1888|Корпус 1)', meta: null }
  }

  const all = []
  let page = 1
  let lastPage = 1
  try {
    do {
      const res = await fetch(`${PIK_API_BASE}/${encodeURIComponent(blockId)}?currentPage=${page}`, { headers: HEADERS })
      if (!res.ok) return { units: [], error: `PIK API HTTP ${res.status}`, meta: null }
      const json = await res.json()
      const items = json?.data?.items ?? []
      all.push(...items)
      lastPage = Number(json?.data?.stats?.lastPage) || 1
      page += 1
    } while (page <= lastPage)
  } catch (e) {
    return { units: [], error: `Ошибка запроса PIK: ${e.message}`, meta: null }
  }

  const filtered = bulkName
    ? all.filter(f => String(f.bulkName || '').trim() === bulkName)
    : all

  const units = filtered.map(f => {
    const rooms = Number(f.rooms)
    const roomsNorm = rooms === -1 ? 0 : rooms
    return {
      source_id: source.id,
      building_id: source.building_id,
      external_id: String(f.id),
      number: null,
      floor: f.floor ?? null,
      position: null,
      entrance: f.sectionNumber ? Number(f.sectionNumber) : null,
      rooms: Number.isFinite(roomsNorm) ? roomsNorm : null,
      area: f.area ?? null,
      price: f.price ?? 0,
      status: 'available',
      layout_image_url: f.planUrl || f.planUrlPng || f.flatPlanRender || null,
    }
  })

  const floors = filtered.map(f => f.floor).filter(Number.isFinite)
  const maxFromApi = filtered.map(f => f.maxFloor).filter(Number.isFinite)
  const floorsCount = maxFromApi.length ? Math.max(...maxFromApi) : (floors.length ? Math.max(...floors) : null)

  const positionsPerFloor = {}
  for (const f of filtered) {
    const fl = f.floor
    if (!Number.isFinite(fl)) continue
    positionsPerFloor[fl] = (positionsPerFloor[fl] || 0) + 1
  }
  const perFloorCounts = Object.values(positionsPerFloor)
  const unitsPerFloor = perFloorCounts.length ? Math.max(...perFloorCounts) : null

  return {
    units,
    error: null,
    meta: {
      floorsCount,
      unitsPerFloor,
    },
  }
}
