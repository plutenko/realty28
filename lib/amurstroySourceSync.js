/**
 * Парсер Амурстрой (as-dv.ru) — Bitrix-компонент project-layouts.
 * URL источника: project-slug|building-code, пример: "zeyskiy-bulvar|1.1"
 *
 * Особенности данных:
 *  - endpoint отдаёт "layout types", а не отдельные квартиры: один item = одна
 *    планировка на диапазоне этажей ("3–7 этажи"). Разворачиваем в N юнитов по
 *    числу этажей в тире.
 *  - Позиция на этаже определяется по min-X bounding box от floorSvg (одна SVG
 *    на квартиру на типовом плане этажа). В пределах тира сортировка по x
 *    даёт визуальный порядок слева направо.
 *  - Цены есть не у всех литеров: по готовым литерам застройщик сознательно
 *    скрывает прайс (поле price пустое). В таком случае пишем price=null.
 *  - Статус "В продаже" применяется ко всем юнитам тира (per-flat статусов нет).
 */

const HEADERS = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }

function parseTier(s) {
  const m = String(s || '').match(/(\d+)(?:\s*[–-]\s*(\d+))?/)
  if (!m) return null
  const lo = Number(m[1])
  const hi = m[2] ? Number(m[2]) : lo
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 1 || hi < lo) return null
  return [lo, hi]
}

function parseRub(s) {
  const digits = String(s || '').replace(/\D/g, '')
  return digits ? Number(digits) : null
}

function parseArea(s) {
  const m = String(s || '').match(/[\d.]+/)
  return m ? Number(m[0]) : null
}

function normalizeRooms(r) {
  if (r === 0 || r === '0' || r === 'studio') return 0
  const n = Number(r)
  return Number.isFinite(n) ? n : null
}

function normalizeStatus(statusText, inSale) {
  if (inSale === true) return 'available'
  const t = String(statusText || '').toLowerCase()
  if (t.includes('продан')) return 'sold'
  if (t.includes('брон') || t.includes('резерв')) return 'reserved'
  if (t.includes('продаж')) return 'available'
  return 'available'
}

function extractMinXFromSvgPath(d) {
  if (!d) return null
  // Path use M/L/H with absolute coords (and lowercase relative — сайт не использует)
  const tokens = String(d).match(/[MLHVZmlhvz]|-?\d*\.?\d+/g) || []
  let minX = Infinity
  let cmd = null
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t
      i += 1
      continue
    }
    const num = Number(t)
    if (!Number.isFinite(num)) { i += 1; continue }
    // Upper-case commands (absolute). Lower-case не ожидаем, но пропустим.
    if (cmd === 'M' || cmd === 'L') {
      if (num < minX) minX = num
      i += 2 // pair (x, y)
    } else if (cmd === 'H') {
      if (num < minX) minX = num
      i += 1
    } else if (cmd === 'V') {
      i += 1
    } else {
      i += 1
    }
  }
  return minX === Infinity ? null : minX
}

async function fetchSvgMinX(realSrc) {
  if (!realSrc) return null
  const url = realSrc.startsWith('http') ? realSrc : `https://as-dv.ru${realSrc}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const text = await res.text()
    const match = text.match(/<path[^>]+\sd="([^"]+)"/)
    return match ? extractMinXFromSvgPath(match[1]) : null
  } catch {
    return null
  }
}

export async function collectUnitsFromAmurstroySource(source) {
  const raw = String(source.url || '').trim()
  const [slug, buildingFilter] = raw.split('|').map((s) => s.trim())

  if (!slug) {
    return {
      units: [],
      error: 'Формат URL: project-slug|building-code, пример: zeyskiy-bulvar|1.1',
      meta: null,
    }
  }
  if (!buildingFilter) {
    return {
      units: [],
      error: 'Не указан код литера после "|", пример: zeyskiy-bulvar|1.1',
      meta: null,
    }
  }

  const endpoint = `https://as-dv.ru/projects/${encodeURIComponent(slug)}/?action=get&compId=project-layouts&is_ajax=y`

  let res
  try {
    res = await fetch(endpoint, { headers: HEADERS })
  } catch (e) {
    return { units: [], error: `Amurstroy fetch: ${e.message}`, meta: null }
  }
  if (!res.ok) return { units: [], error: `Amurstroy HTTP ${res.status}`, meta: null }

  let json
  try {
    json = await res.json()
  } catch {
    return { units: [], error: 'Amurstroy: ответ не JSON', meta: null }
  }

  const allItems = Array.isArray(json?.items) ? json.items : []
  const items = allItems.filter((i) => String(i.building) === buildingFilter)
  if (items.length === 0) {
    return {
      units: [],
      error: `Amurstroy: нет items для building=${buildingFilter} в проекте ${slug}`,
      meta: null,
    }
  }

  // Разбираем диапазон этажей каждого item, чтобы собрать unique список этажей
  const itemsWithRange = []
  let maxFloor = 0
  let minFloor = Infinity
  for (const i of items) {
    const range = parseTier(i.floor)
    if (!range) continue
    const [lo, hi] = range
    if (hi > maxFloor) maxFloor = hi
    if (lo < minFloor) minFloor = lo
    itemsWithRange.push({ item: i, lo, hi })
  }
  if (itemsWithRange.length === 0) {
    return { units: [], error: 'Amurstroy: не удалось распарсить поле floor ни у одного item', meta: null }
  }

  // SVG min-X каждого item (для сортировки позиций слева направо)
  const xs = await Promise.all(itemsWithRange.map(({ item }) => fetchSvgMinX(item.floorSvg?.realSrc)))
  itemsWithRange.forEach((e, idx) => {
    e.minX = Number.isFinite(xs[idx]) ? xs[idx] : Number.MAX_SAFE_INTEGER
  })

  // Для каждого этажа берём items, чьи тиры его покрывают, сортируем по min-X
  // и назначаем позицию. Этажи могут отличаться по кол-ву квартир (на 2-м этаже
  // часть помещений коммерческие — там тирs короче).
  const units = []
  let maxPerFloor = 0

  for (let floor = minFloor; floor <= maxFloor; floor += 1) {
    const onFloor = itemsWithRange.filter((e) => floor >= e.lo && floor <= e.hi)
    if (onFloor.length === 0) continue
    onFloor.sort((a, b) => {
      if (a.minX !== b.minX) return a.minX - b.minX
      return Number(b.item.id) - Number(a.item.id)
    })
    if (onFloor.length > maxPerFloor) maxPerFloor = onFloor.length

    onFloor.forEach(({ item }, idx) => {
      const position = idx + 1
      const area = parseArea(item.area)
      const price = parseRub(item.price)
      const ppmFromField = parseRub(item.priceForSquare)
      const pricePerMeter =
        ppmFromField ?? (area && price ? Math.round(price / area) : null)

      units.push({
        source_id: source.id,
        building_id: source.building_id,
        external_id: `amur-${buildingFilter}-f${floor}-p${position}`,
        number: null,
        floor,
        position,
        entrance: 1,
        rooms: normalizeRooms(item.roomsCount),
        area,
        price: price ?? 0,
        price_per_meter: pricePerMeter,
        status: normalizeStatus(item.status, item.inSale),
        layout_image_url: item.floorPlan?.realSrc
          ? `https://as-dv.ru${item.floorPlan.realSrc}`
          : null,
      })
    })
  }

  return {
    units,
    error: null,
    meta: {
      floorsCount: maxFloor || null,
      unitsPerFloor: maxPerFloor || null,
      unitsPerEntrance: maxPerFloor ? [maxPerFloor] : null,
    },
  }
}
