/**
 * Парсер ПИК (www.pik.ru) — парсинг SSR страницы из __NEXT_DATA__.
 * URL источника: {город}/{slug}|{bulkId}, пример: "blagoveshchensk/zeyapark|9357"
 *
 * Почему SSR, а не API: flat.pik-service.ru API имеет сломанную пагинацию
 * (currentPage игнорируется, возвращает те же 20 юнитов для всех страниц).
 * SSR страница www.pik.ru/search/{city}/{slug}?bulk={id} корректно фильтрует
 * по bulk и отдаёт все квартиры корпуса (free + reserve) сразу.
 */

const PIK_SSR_BASE = 'https://www.pik.ru/search'
const HEADERS = { 'User-Agent': 'Mozilla/5.0' }

export async function collectUnitsFromPikSource(source) {
  const raw = String(source.url || '').trim()
  const [pathPart, bulkId] = raw.split('|').map(s => s.trim())

  if (!pathPart || !bulkId) {
    return { units: [], error: 'Формат: {city}/{slug}|{bulkId}, пример: blagoveshchensk/zeyapark|9357', meta: null }
  }

  const url = `${PIK_SSR_BASE}/${pathPart}?bulk=${encodeURIComponent(bulkId)}`
  let res
  try {
    res = await fetch(url, { headers: HEADERS })
  } catch (e) {
    return { units: [], error: `Ошибка запроса PIK: ${e.message}`, meta: null }
  }

  if (!res.ok) {
    return { units: [], error: `PIK HTTP ${res.status}`, meta: null }
  }

  const html = await res.text()
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)
  if (!m) {
    return { units: [], error: 'PIK: не найден __NEXT_DATA__', meta: null }
  }

  let json
  try {
    json = JSON.parse(m[1])
  } catch {
    return { units: [], error: 'PIK: __NEXT_DATA__ не JSON', meta: null }
  }

  const flats = json?.props?.pageProps?.initialState?.searchService?.filteredFlats?.data?.flats
  if (!Array.isArray(flats)) {
    return { units: [], error: null, meta: null }
  }

  const units = flats.map(f => {
    const st = String(f.status || '').toLowerCase()
    let status = 'available'
    if (st === 'reserve' || st === 'reserved' || st === 'booked') status = 'reserved'
    if (st === 'sold' || st === 'closed') status = 'sold'

    const rooms = Number(f.rooms)
    const roomsNorm = rooms === -1 ? 0 : rooms

    return {
      source_id: source.id,
      building_id: source.building_id,
      external_id: String(f.id),
      number: null,
      floor: f.floor ?? null,
      position: f.numberOnFloor ?? null,
      entrance: f.sectionNumber ? Number(f.sectionNumber) : null,
      rooms: Number.isFinite(roomsNorm) ? roomsNorm : null,
      area: f.area ?? null,
      price: f.price ?? 0,
      status,
      layout_image_url: f.planUrl || f.planUrlPng || f.flatPlanRender || null,
    }
  })

  const floors = flats.map(f => f.floor).filter(Number.isFinite)
  const maxFromApi = flats.map(f => f.maxFloor).filter(Number.isFinite)
  const floorsCount = maxFromApi.length ? Math.max(...maxFromApi) : (floors.length ? Math.max(...floors) : null)

  const positionsPerFloor = {}
  for (const f of flats) {
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
