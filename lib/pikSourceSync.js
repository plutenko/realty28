/**
 * Парсер ПИК (www.pik.ru) — использует страницу /chessplan, которая в __NEXT_DATA__
 * несёт полную шахматку всех корпусов блока: все секции, все этажи, все квартиры
 * со статусами (free / reserve / unavailable).
 *
 * URL источника: {city}/{slug}|{bulkId}, пример: "blagoveshchensk/zeyapark|9262"
 *
 * Почему chessplan, а не /search и не flat.pik-service.ru:
 *  - /search отдаёт максимум 20 кв/страница, SSR не поддерживает пагинацию через query params
 *    (currentPage=2 игнорируется), и в выдаче только status="free" — reserve теряются
 *  - API flat.pik-service.ru игнорирует фильтр bulk и тоже отдаёт только первые 20 free
 *  - /chessplan даёт ВСЁ одним запросом, включая забронированные (с замком на шахматке ПИК)
 *
 * Поле `flat.number` в chessplan — overall номер квартиры по всей секции (тот же, что в ДДУ).
 * Порядок элементов в `floors[n].flats` — визуальная раскладка слева направо (= локальная позиция).
 */

const HEADERS = { 'User-Agent': 'Mozilla/5.0' }

function normalizeRooms(r) {
  if (r === 'studio' || r === 'Studio') return 0
  const n = Number(r)
  if (!Number.isFinite(n)) return null
  return n === -1 ? 0 : n
}

function normalizeStatus(s) {
  const st = String(s || '').toLowerCase()
  if (st === 'free') return 'available'
  if (st === 'reserve' || st === 'reserved' || st === 'booked') return 'reserved'
  if (st === 'unavailable' || st === 'sold' || st === 'closed') return 'sold'
  return null
}

export async function collectUnitsFromPikSource(source, existingUnitsPerEntrance = null) {
  const raw = String(source.url || '').trim()
  const [pathPart, bulkIdStr] = raw.split('|').map(s => s.trim())
  const bulkIdNum = Number(bulkIdStr)

  if (!pathPart || !Number.isFinite(bulkIdNum)) {
    return { units: [], error: 'Формат: {city}/{slug}|{bulkId}, пример: blagoveshchensk/zeyapark|9262', meta: null }
  }

  const url = `https://www.pik.ru/${pathPart}/chessplan`
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

  const bulks = json?.props?.pageProps?.initialState?.chessplanService?.chessplan?.bulks
  if (!Array.isArray(bulks)) {
    return { units: [], error: 'PIK: нет chessplan.bulks', meta: null }
  }

  const bulk = bulks.find(b => Number(b.id) === bulkIdNum)
  if (!bulk) {
    return { units: [], error: `PIK: bulk ${bulkIdNum} не найден на ${pathPart}`, meta: null }
  }

  const sections = (bulk.sections || []).slice().sort((a, b) => Number(a.number) - Number(b.number))
  const maxPerSection = sections.map(s => Number(s.max_flats_on_floor) || 0)

  // Секции ПИК объединяются в один визуальный подъезд (entrance=1 для всех юнитов).
  const hasExisting = Array.isArray(existingUnitsPerEntrance) && existingUnitsPerEntrance.length > 0
  const unitsPerEntrance = hasExisting
    ? existingUnitsPerEntrance.map(Number).filter(n => Number.isFinite(n) && n > 0)
    : maxPerSection.slice()

  const units = []
  let maxFloor = 0

  for (let secIdx = 0; secIdx < sections.length; secIdx += 1) {
    const sec = sections[secIdx]
    let offset = 0
    for (let i = 0; i < secIdx; i += 1) offset += (unitsPerEntrance[i] || 0)

    const floors = sec.floors || {}
    for (const [floorKey, floorData] of Object.entries(floors)) {
      const floorNum = Number(floorKey)
      if (!Number.isFinite(floorNum) || floorNum < 1) continue
      maxFloor = Math.max(maxFloor, floorNum)

      const flatsOnFloor = Array.isArray(floorData?.flats) ? floorData.flats : []
      // Порядок элементов в массиве = визуальная раскладка слева направо (local 1..N)
      for (let localIdx = 0; localIdx < flatsOnFloor.length; localIdx += 1) {
        const f = flatsOnFloor[localIdx]
        const status = normalizeStatus(f.status)
        if (status !== 'available' && status !== 'reserved') continue // проданные/недоступные не показываем

        const layout = f.layout || {}
        const layoutUrl = layout.planSvg || layout.render || layout.preview || null

        units.push({
          source_id: source.id,
          building_id: source.building_id,
          external_id: String(f.id),
          number: String(f.number ?? f.id),
          floor: floorNum,
          position: offset + localIdx + 1,
          entrance: 1,
          rooms: normalizeRooms(f.rooms),
          area: f.area ?? null,
          price: f.price ?? 0,
          status,
          layout_image_url: layoutUrl,
        })
      }
    }
  }

  const unitsPerFloor = unitsPerEntrance.reduce((a, b) => a + b, 0) || null

  return {
    units,
    error: null,
    meta: {
      floorsCount: maxFloor || null,
      unitsPerFloor,
      unitsPerEntrance: unitsPerFloor ? [unitsPerFloor] : null,
    },
  }
}
