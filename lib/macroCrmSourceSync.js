/**
 * Парсер шахматки MacroCRM (api.macroserver.ru).
 *
 * Источник хранит в `url` строку вида "ленинград28.рф|8730378", где:
 *   ленинград28.рф — домен виджета (может быть punycode xn--...)
 *   8730378        — macro house_id (одна секция/литер)
 *
 * Дополнительно source может хранить complex_id в pb_account_id (переиспользуем поле,
 * чтобы не плодить колонок), но обычно он читается из виджета автоматически.
 */

const API_HOST = 'https://api.macroserver.ru'

const DEFAULT_DOMAIN = 'ленинград28.рф'

export function parseMacroCrmSourceUrl(rawValue) {
  const raw = String(rawValue || '').trim()
  if (!raw) return { domain: '', houseId: '' }
  if (/^\d+$/.test(raw)) {
    return { domain: DEFAULT_DOMAIN, houseId: raw }
  }
  if (raw.includes('|')) {
    const [d, h] = raw.split('|', 2).map((s) => s.trim())
    return { domain: d || DEFAULT_DOMAIN, houseId: h }
  }
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    const parts = u.pathname.split('/').filter(Boolean)
    const hi = parts.indexOf('house')
    if (hi >= 0 && parts[hi + 1]) return { domain: u.hostname, houseId: parts[hi + 1] }
  } catch {}
  return { domain: raw, houseId: '' }
}

function toPunycode(domain) {
  try {
    return new URL(`https://${domain}`).hostname
  } catch {
    return domain
  }
}

async function fetchEmbedCheck(domain) {
  const res = await fetch(`${API_HOST}/estate/embedjs/?domain=${encodeURIComponent(domain)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`embedjs HTTP ${res.status}`)
  const text = await res.text()
  const m = text.match(/check=([A-Za-z0-9_-]+)/)
  if (!m) throw new Error('check token not found in embed.js')
  return m[1]
}

async function fetchCatalogUrl(domain, check) {
  const uuid = crypto.randomUUID()
  const u = `${API_HOST}/estate/request/get_request_url/?domain=${encodeURIComponent(domain)}&check=${check}&type=catalog&inline=true&issetJQuery=1&uuid=${uuid}`
  const res = await fetch(u, {
    headers: {
      'Origin': `https://${domain}`,
      'Referer': `https://${domain}/`,
    },
  })
  if (!res.ok) throw new Error(`get_request_url HTTP ${res.status}`)
  const data = await res.json()
  if (!data?.url) throw new Error(`get_request_url: ${data?.message || 'no url in response'}`)
  return data.url
}

async function callCatalog(catalogUrl, domain, body) {
  const res = await fetch(catalogUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': `https://${domain}`,
      'Referer': `https://${domain}/`,
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`catalog HTTP ${res.status}`)
  const data = await res.json()
  if (data?.error) throw new Error(`catalog: ${data.message}`)
  return data
}

const EMPTY_FILTERS = {
  studio: null, rooms: [], restorations: [], promos: [], tags: [], riser_side: [],
  geo_city: null, floors: [], geoLines: [], houses_ids: [], type: null,
  areaFrom: null, areaTo: null, priceFrom: null, priceTo: null,
  priceM2From: null, priceM2To: null, priceRentFrom: null, priceRentTo: null,
  priceRentM2From: null, priceRentM2To: null, status: null,
  isHot: false, isExclusive: false,
}

/** Получить список квартир одного дома MacroCRM. */
async function fetchHouseObjects(domain, houseId) {
  const check = await fetchEmbedCheck(domain)
  const catalogUrl = await fetchCatalogUrl(domain, check)
  const data = await callCatalog(catalogUrl, domain, {
    action: 'objects_list',
    data: {
      category: 'flat',
      house_id: Number(houseId),
      activity: 'sell',
      filters: EMPTY_FILTERS,
      cabinetMode: false,
    },
    auth_token: null,
    locale: null,
  })
  return Array.isArray(data?.objects) ? data.objects : []
}

/** MacroCRM status → наши status. */
function mapStatus(raw) {
  const s = String(raw || '').toLowerCase()
  if (s === 'free' || s === 'available' || s === 'active') return 'available'
  if (s === 'booked' || s === 'reserve' || s === 'reserved') return 'reserved'
  if (s === 'done' || s === 'sold' || s === 'closed') return 'sold'
  return s || 'available'
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pickPlanUrl(plans) {
  if (!plans || typeof plans !== 'object') return null
  const primary = plans.primary
  if (primary?.plan_url) return primary.plan_url
  if (primary?.plan_thumb_url) return primary.plan_thumb_url
  for (const v of Object.values(plans)) {
    if (v?.plan_url) return v.plan_url
    if (v?.plan_thumb_url) return v.plan_thumb_url
  }
  return null
}

/** MacroCRM object → наш unit payload. */
function mapObjectToUnit(obj, sourceId, buildingId) {
  const e = obj?.estate || {}
  const rooms = toNumber(e.estate_rooms) ?? (e.estate_studia ? 0 : null)
  const area = toNumber(e.estate_area)
  const price = toNumber(e.estate_price)
  const pricePerM2 = toNumber(e.estate_price_m2) ??
    (area && price && area > 0 ? Math.round(price / area) : null)
  const floor = toNumber(e.estate_floor)
  const number = toNumber(e.geo_flatnum)
  const entrance = toNumber(e.geo_house_entrance)
  const layoutUrl = pickPlanUrl(obj?.plans)

  return {
    source_id: sourceId,
    building_id: buildingId,
    external_id: obj?.id != null ? String(obj.id) : null,
    floor,
    number,
    position: null, // MacroCRM не даёт явной позиции в ряду этажа
    entrance: entrance != null && entrance > 0 ? entrance : null,
    rooms,
    area: area ?? null,
    price: price ?? null,
    price_per_meter: pricePerM2,
    status: mapStatus(obj?.status),
    layout_image_url: layoutUrl,
    finish_image_url: null,
  }
}

/**
 * @returns {Promise<{ units: object[], meta?: object, error?: string }>}
 */
export async function collectUnitsFromMacroCrmSource(source) {
  const { domain: rawDomain, houseId } = parseMacroCrmSourceUrl(source?.url)
  if (!rawDomain || !houseId) {
    return {
      units: [],
      error:
        'Укажите в URL источника строку вида "домен|house_id", например "ленинград28.рф|8730378".',
    }
  }
  const domain = toPunycode(rawDomain)

  let objects
  try {
    objects = await fetchHouseObjects(domain, houseId)
  } catch (e) {
    return { units: [], error: `MacroCRM fetch failed: ${e?.message || e}` }
  }

  const buildingId = source?.building_id || null
  const units = objects.map((o) => mapObjectToUnit(o, source.id, buildingId))

  // MacroCRM API не отдаёт position. Вычисляем для каждого этажа:
  //   1. position внутри этажа = number - minOnFloor + 1 (внутренние пропуски как у застройщика)
  //   2. если между соседними этажами есть разрыв в нумерации (пример: floor 19 max=273,
  //      floor 20 min=275 — пропущен 274), сдвигаем весь верхний этаж вправо на размер
  //      разрыва, чтобы edge-пропуск стал пустой клеткой слева (под ручное добавление).
  const groupsByEntrance = new Map()
  for (const u of units) {
    const key = `${u.entrance ?? 0}`
    if (!groupsByEntrance.has(key)) groupsByEntrance.set(key, new Map())
    const byFloor = groupsByEntrance.get(key)
    const f = u.floor ?? 0
    if (!byFloor.has(f)) byFloor.set(f, [])
    byFloor.get(f).push(u)
  }
  for (const byFloor of groupsByEntrance.values()) {
    const floors = [...byFloor.keys()].sort((a, b) => a - b)
    let prevMax = null
    const offsetByFloor = new Map()
    for (const f of floors) {
      const arr = byFloor.get(f)
      const nums = arr.map((u) => Number(u.number)).filter((n) => Number.isFinite(n))
      if (!nums.length) { offsetByFloor.set(f, 0); continue }
      const minN = Math.min(...nums)
      const maxN = Math.max(...nums)
      const gap = prevMax != null ? minN - prevMax - 1 : 0
      offsetByFloor.set(f, gap > 0 ? gap : 0)
      prevMax = maxN
    }
    for (const [f, arr] of byFloor) {
      const nums = arr.map((u) => Number(u.number)).filter((n) => Number.isFinite(n))
      if (!nums.length) continue
      const minN = Math.min(...nums)
      const offset = offsetByFloor.get(f) || 0
      for (const u of arr) {
        const n = Number(u.number)
        u.position = Number.isFinite(n) ? n - minN + 1 + offset : null
      }
    }
  }

  // meta: этажей и макс. позиции на этаже (ширина сетки с учётом пропусков)
  let floorsCount = 0
  let unitsPerFloor = 0
  for (const u of units) {
    if (u.floor && u.floor > floorsCount) floorsCount = u.floor
    const p = Number(u.position)
    if (Number.isFinite(p) && p > unitsPerFloor) unitsPerFloor = p
  }

  return {
    units,
    meta: {
      floorsCount: floorsCount || null,
      unitsPerFloor: unitsPerFloor || null,
      count: units.length,
    },
  }
}
