/**
 * Парсер FSK (fsk.ru) — собственный API застройщика.
 * URL источника: slug ЖК, опционально через | номер корпуса.
 * Примеры: "flabellum" или "flabellum|2.3"
 *
 * Поэтажные планы: FSK отдаёт уникальный SVG на каждую квартиру (с подсветкой
 * именно её). План лежит только в detail-эндпоинте `/flats/{externalId}` в поле
 * `planFloor` — в списке `/flats/all` его нет. Чтобы не бить по 1 запросу на
 * квартиру при каждом синке, используется кэш: если в units уже есть
 * floor_plan_url для этого external_id — detail не дёргаем.
 */

const FSK_API = 'https://fsk.ru/api/v3/flats/all'
const FSK_DETAIL = 'https://fsk.ru/api/v3/flats'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const DETAIL_CONCURRENCY = 3
const DETAIL_BATCH_DELAY_MS = 150

async function mapConcurrent(items, concurrency, fn) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = i++
      if (idx >= items.length) return
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

async function fetchFlatDetail(externalId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res
    try {
      res = await fetch(`${FSK_DETAIL}/${encodeURIComponent(externalId)}`, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      })
    } catch {
      await sleep(400 * (attempt + 1))
      continue
    }
    if (res.status === 429 || res.status === 503) {
      // Back off и пробуем ещё раз — если не полегчало, возвращаем маркер «стоп».
      const retryAfter = Number(res.headers.get('retry-after')) || 0
      await sleep(Math.max(800, retryAfter * 1000) * (attempt + 1))
      continue
    }
    if (!res.ok) return { ok: false, planFloor: null, status: res.status }
    try {
      const json = await res.json()
      const obj = Array.isArray(json) ? json[0] : json
      return { ok: true, planFloor: obj?.planFloor || null }
    } catch {
      return { ok: false, planFloor: null }
    }
  }
  return { ok: false, throttled: true, planFloor: null }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function collectUnitsFromFskSource(source, { supabase = null, skipImages = false } = {}) {
  const raw = String(source.url || '').trim()
  const [slug, corpusFilter] = raw.split('|').map((s) => s.trim())

  if (!slug) {
    return { units: [], error: 'Не указан slug ЖК (например: flabellum)', meta: null }
  }

  const url = `${FSK_API}?complex_slug=${encodeURIComponent(slug)}&limit=5000`
  let res
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } })
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
    ? flats.filter((f) => String(f.corpus?.number || '') === corpusFilter)
    : flats

  // Кэш floor_plan_url по external_id: пропустим detail-запросы для квартир,
  // которые уже хранят план в БД.
  const cachedPlan = new Map() // external_id(string) -> floor_plan_url
  if (supabase && source.id) {
    const { data: existing } = await supabase
      .from('units')
      .select('external_id, floor_plan_url')
      .eq('source_id', source.id)
      .not('floor_plan_url', 'is', null)
    for (const row of existing ?? []) {
      if (row.external_id && row.floor_plan_url) {
        cachedPlan.set(String(row.external_id), row.floor_plan_url)
      }
    }
  }

  const missing = filtered.filter((f) => {
    const eid = f.externalId || f._id
    return eid && !cachedPlan.has(String(eid))
  })

  // Тянем detail для квартир без кэша — concurrency=3 + пауза между батчами.
  // skipImages=true — пропускаем все detail-запросы; новые квартиры получат floor_plan_url=null,
  // существующие сохранят старый URL через upsert-fallback.
  const planByExt = new Map(cachedPlan)
  let throttled = false
  if (!skipImages) {
    for (let i = 0; i < missing.length; i += DETAIL_CONCURRENCY) {
      const batch = missing.slice(i, i + DETAIL_CONCURRENCY)
      const results = await mapConcurrent(batch, DETAIL_CONCURRENCY, (f) =>
        fetchFlatDetail(f.externalId || f._id)
      )
      for (let j = 0; j < batch.length; j++) {
        const eid = String(batch[j].externalId || batch[j]._id)
        const r = results[j]
        if (r?.throttled) throttled = true
        if (r?.planFloor) planByExt.set(eid, r.planFloor)
      }
      if (throttled) break // FSK явно тормозит — не давим дальше, сохраним что есть
      if (i + DETAIL_CONCURRENCY < missing.length) await sleep(DETAIL_BATCH_DELAY_MS)
    }
  }

  const units = filtered.map((f) => {
    const st = Number(f.status)
    let status = 'available'
    if (st === 1 || st === 3) status = 'reserved'
    if (st === 2 || st === 4) status = 'sold'

    const eid = f.externalId || f._id
    const floor_plan_url = eid ? planByExt.get(String(eid)) || null : null

    return {
      source_id: source.id,
      building_id: source.building_id,
      external_id: eid,
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
      floor_plan_url,
    }
  })

  const floors = filtered.map((f) => f.floorNumber).filter(Number.isFinite)
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
      floorPlansFetched: missing.length - (throttled ? missing.length - planByExt.size : 0),
      throttled,
    },
  }
}
