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

export async function collectUnitsFromPikSource(source, existingUnitsPerEntrance = null) {
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

  // Группировка квартир по (section, floor) → массив
  const bySecFloor = new Map()
  for (const f of flats) {
    const key = `${f.sectionNumber || 1}:${f.floor || 0}`
    if (!bySecFloor.has(key)) bySecFloor.set(key, [])
    bySecFloor.get(key).push(f)
  }

  // Максимум квартир в секции на любом этаже
  const maxPerSection = {}
  for (const [key, arr] of bySecFloor) {
    const sec = Number(key.split(':')[0])
    maxPerSection[sec] = Math.max(maxPerSection[sec] || 0, arr.length)
  }
  const sections = Object.keys(maxPerSection).map(Number).sort((a,b)=>a-b)

  // Если админ задал units_per_entrance — используем его для вычисления offset,
  // иначе считаем от фактического max (получится компактная шахматка).
  const hasExisting = Array.isArray(existingUnitsPerEntrance) && existingUnitsPerEntrance.length > 0
  const unitsPerEntrance = hasExisting
    ? existingUnitsPerEntrance.map(Number).filter(n => Number.isFinite(n) && n > 0)
    : sections.map(s => maxPerSection[s])

  // Position = оффсет секции + порядковый номер внутри секции на данном этаже
  const positionByFlatId = new Map()
  for (const [key, arr] of bySecFloor) {
    const sec = Number(key.split(':')[0])
    const secIdx = sections.indexOf(sec)
    let offset = 0
    for (let i = 0; i < secIdx; i++) offset += (unitsPerEntrance[i] || 0)
    arr.sort((a, b) => Number(a.id) - Number(b.id))
    arr.forEach((flat, idx) => {
      positionByFlatId.set(flat.id, offset + idx + 1)
    })
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
      number: String(f.id),
      floor: f.floor ?? null,
      position: positionByFlatId.get(f.id) ?? null,
      entrance: f.sectionNumber ? Number(f.sectionNumber) : 1,
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

  const unitsPerFloor = unitsPerEntrance.reduce((a, b) => a + b, 0) || null

  return {
    units,
    error: null,
    meta: {
      floorsCount,
      unitsPerFloor,
      unitsPerEntrance,
    },
  }
}
