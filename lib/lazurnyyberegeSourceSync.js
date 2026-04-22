/**
 * Парсер ЖК «Лазурный берег» (lazurnyybereg.com).
 * Источник данных — Tilda Store API (`store.tildaapi.com/api/getproductslist/`),
 * сайт застройщика поднят на Tilda и каждый литер = один «store part» в каталоге.
 *
 * URL источника — slug литера ("l9" / "l9oc2" / "l10").
 * Маппинг slug → storepart/recid/building_id лежит в lib/lazurLayouts.json,
 * туда же скомпилирована раскладка шахматки из Excel застройщика (нужна для
 * расчёта глобальной позиции и span трёшек, которые занимают 2 колонки).
 */

import layouts from './lazurLayouts.json' with { type: 'json' }

const TILDA_API = 'https://store.tildaapi.com/api/getproductslist/'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
const HEADERS = {
  'User-Agent': UA,
  Accept: '*/*',
  'Accept-Language': 'ru,en;q=0.9',
  Origin: 'https://lazurnyybereg.com',
  Referer: 'https://lazurnyybereg.com/',
}
const FETCH_TIMEOUT_MS = 30000
const PAGE_SIZE = 500

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJsonWithRetry(url, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, { headers: HEADERS })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (!text.startsWith('{')) throw new Error('non-JSON response')
      return JSON.parse(text)
    } catch (e) {
      lastErr = e
      if (i + 1 < attempts) await sleep(600 * (i + 1))
    }
  }
  throw lastErr
}

function parseRub(s) {
  const digits = String(s || '').replace(/\D/g, '')
  return digits ? Number(digits) : null
}

function parseArea(s) {
  const m = String(s || '').replace(',', '.').match(/\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

function parseRooms(v) {
  const s = String(v || '').toLowerCase()
  if (!s) return null
  if (s.includes('студ')) return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function charc(product, title) {
  const arr = product?.characteristics || []
  const hit = arr.find((c) => String(c?.title || '').trim() === title)
  return hit?.value ?? null
}

function firstImage(product) {
  const gr = product?.gallery
  if (!gr) return null
  try {
    const arr = typeof gr === 'string' ? JSON.parse(gr) : gr
    if (Array.isArray(arr) && arr[0]?.img) return String(arr[0].img)
  } catch {
    /* ignore */
  }
  return null
}

function parseSourceUrl(rawUrl) {
  // Поддерживаем два формата:
  //   "l9" — slug из lib/lazurLayouts.json
  //   "storepart|recid" — сырое переопределение (для проверок/новых литеров)
  const raw = String(rawUrl || '').trim()
  if (!raw) return null
  if (raw.includes('|')) {
    const [storepart, recid] = raw.split('|').map((s) => s.trim())
    return { storepart, recid, layout: null }
  }
  const layout = layouts[raw]
  if (!layout) return null
  return { storepart: layout.storepart, recid: layout.recid, layout, slug: raw }
}

export async function collectUnitsFromLazurnyyberegeSource(source) {
  const parsed = parseSourceUrl(source?.url)
  if (!parsed?.storepart || !parsed?.recid) {
    return {
      units: [],
      error:
        'Источник Лазурного берега требует url вида "l9" / "l9oc2" / "l10" или "<storepart>|<recid>".',
      meta: null,
    }
  }

  const layout = parsed.layout
  // Для Л9оч2 и Л10 у квартир нет характеристики "Подъезд" на карточке — дом
  // однопотъездный, форсим entrance=1.
  const forceEntrance =
    layout && layout.entrances === 1 ? 1 : null

  // Забираем все товары одним запросом (size=500 хватает — у самого большого
  // Л10 total=107). На случай если Tilda когда-нибудь ограничит отдачу —
  // добираем остаток через slice.
  const c = Date.now()
  const urlBase = `${TILDA_API}?storepartuid=${parsed.storepart}&recid=${parsed.recid}&c=${c}&getparts=true&getoptions=true&flag_root=withroot`

  let total = null
  const products = []
  for (let slice = 1; slice < 30; slice++) {
    const url = `${urlBase}&slice=${slice}&size=${PAGE_SIZE}`
    let json
    try {
      json = await fetchJsonWithRetry(url)
    } catch (e) {
      return { units: [], error: `Tilda API ${e.message || e}`, meta: null }
    }
    if (total == null) total = Number(json?.total) || 0
    const batch = Array.isArray(json?.products) ? json.products : []
    products.push(...batch)
    if (batch.length === 0 || products.length >= total) break
  }

  const positions = layout?.positions || {}
  const upe = Array.isArray(layout?.units_per_entrance) ? layout.units_per_entrance : null

  const units = []
  for (const p of products) {
    const uid = p?.uid != null ? String(p.uid) : null
    if (!uid) continue
    const title = String(p?.title || '')
    const numMatch = title.match(/№\s*(\d+)/)
    const number = numMatch ? Number(numMatch[1]) : null

    const floor = Number(charc(p, 'Этаж')) || null
    const entranceRaw = Number(charc(p, 'Подъезд')) || null
    const entrance = entranceRaw || forceEntrance || 1
    const area = parseArea(charc(p, 'Площадь'))
    const rooms = parseRooms(charc(p, 'Количество комнат'))
    const pricePerMeter = parseRub(charc(p, 'Цена за м²'))
    const price = Number(p?.price)

    // Глобальная позиция в шахматке: offset предыдущих подъездов + col подъезда.
    let position = null
    let spanColumns = 1
    if (number != null && floor != null && positions && upe) {
      const key = `${entrance}-${floor}-${number}`
      const hit = positions[key]
      if (hit?.col) {
        const offset = upe.slice(0, Math.max(0, entrance - 1)).reduce((s, v) => s + v, 0)
        position = offset + hit.col
        spanColumns = Math.max(1, Number(hit.span_columns) || 1)
      }
    }

    units.push({
      source_id: source.id,
      building_id: source.building_id,
      external_id: uid,
      number: number != null ? String(number) : null,
      floor,
      entrance,
      position,
      span_columns: spanColumns,
      rooms,
      area,
      price: Number.isFinite(price) ? price : null,
      price_per_meter: pricePerMeter,
      status: 'available',
      layout_image_url: firstImage(p),
    })
  }

  return {
    units,
    error: null,
    meta: layout
      ? {
          floorsCount: layout.floors,
          unitsPerFloor: layout.units_per_floor,
          unitsPerEntrance: layout.units_per_entrance,
          entrancesCount: layout.entrances,
        }
      : null,
  }
}
