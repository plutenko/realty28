/**
 * Парсер шахматки MacroCRM / SberCRM (одинаковый API, разные хосты).
 *
 * Форматы source.url:
 *   "ленинград28.рф|8730378"                        — default host api.macroserver.ru
 *   "api.macro.sbercrm.com|amurcom.ru|7000977"      — явный host (для Клевера и других
 *                                                      ЖК на новом SberCRM-кластере)
 * Разделитель "|", части: [host|]domain|house_id.
 *
 * Доп. возможность: парсер дёргает `get_floor_plans` и возвращает поэтажные планы в
 * meta.floorPlans (Map<floorNumber, imgUrl>) — syncSources кладёт их в images.
 */

const DEFAULT_API_HOST = 'https://api.macroserver.ru'
const DEFAULT_DOMAIN = 'ленинград28.рф'

function normalizeHost(h) {
  const v = String(h || '').trim().replace(/\/$/, '')
  if (!v) return DEFAULT_API_HOST
  return v.startsWith('http') ? v : `https://${v}`
}

export function parseMacroCrmSourceUrl(rawValue) {
  const raw = String(rawValue || '').trim()
  if (!raw) return { apiHost: DEFAULT_API_HOST, domain: '', houseId: '' }
  if (/^\d+$/.test(raw)) {
    return { apiHost: DEFAULT_API_HOST, domain: DEFAULT_DOMAIN, houseId: raw }
  }
  if (raw.includes('|')) {
    const parts = raw.split('|').map((s) => s.trim())
    if (parts.length >= 3) {
      // host|domain|house_id
      return { apiHost: normalizeHost(parts[0]), domain: parts[1] || DEFAULT_DOMAIN, houseId: parts[2] }
    }
    // domain|house_id (default host)
    return { apiHost: DEFAULT_API_HOST, domain: parts[0] || DEFAULT_DOMAIN, houseId: parts[1] || '' }
  }
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    const parts = u.pathname.split('/').filter(Boolean)
    const hi = parts.indexOf('house')
    if (hi >= 0 && parts[hi + 1]) {
      return { apiHost: DEFAULT_API_HOST, domain: u.hostname, houseId: parts[hi + 1] }
    }
  } catch {}
  return { apiHost: DEFAULT_API_HOST, domain: raw, houseId: '' }
}

function toPunycode(domain) {
  try {
    return new URL(`https://${domain}`).hostname
  } catch {
    return domain
  }
}

async function fetchEmbedCheck(apiHost, domain) {
  const res = await fetch(`${apiHost}/estate/embedjs/?domain=${encodeURIComponent(domain)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`embedjs HTTP ${res.status}`)
  const text = await res.text()
  const m = text.match(/check=([A-Za-z0-9_-]+)/)
  if (!m) throw new Error('check token not found in embed.js')
  return m[1]
}

async function fetchCatalogUrl(apiHost, domain, check) {
  const uuid = crypto.randomUUID()
  const u = `${apiHost}/estate/request/get_request_url/?domain=${encodeURIComponent(domain)}&check=${check}&type=catalog&inline=true&issetJQuery=1&uuid=${uuid}`
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

/** Получить catalog_url (один раз на синхронизацию). */
async function openCatalog(apiHost, domain) {
  const check = await fetchEmbedCheck(apiHost, domain)
  return fetchCatalogUrl(apiHost, domain, check)
}

/** Получить список квартир одного дома MacroCRM. */
async function fetchHouseObjects(catalogUrl, domain, houseId) {
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

/** Поэтажные планы: получаем массив {floor_level, url} для записи в images. */
async function fetchFloorPlans(catalogUrl, domain, houseId) {
  try {
    const data = await callCatalog(catalogUrl, domain, {
      action: 'get_floor_plans',
      data: { house_id: Number(houseId) },
      auth_token: null,
      locale: null,
    })
    if (!data?.floorPlans || typeof data.floorPlans !== 'object') return []
    // Структура MacroCRM: floorPlans[floor][entrance] = { img, svg }.
    // В нашей БД поэтажный план привязан к (building_id, floor_level), без подъезда.
    // Берём первый доступный подъезд на каждом этаже (обычно он один).
    const rows = []
    for (const [floor, byEntrance] of Object.entries(data.floorPlans)) {
      const fNum = Number(floor)
      if (!Number.isFinite(fNum)) continue
      if (!byEntrance || typeof byEntrance !== 'object') continue
      const keys = Object.keys(byEntrance).sort()
      if (!keys.length) continue
      const first = byEntrance[keys[0]]
      const img = first?.img
      if (img) rows.push({ floor_level: fNum, url: String(img) })
    }
    return rows
  } catch (e) {
    // Не все аккаунты MacroCRM возвращают планы — для старых версий это нормально.
    return []
  }
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
  const { apiHost, domain: rawDomain, houseId } = parseMacroCrmSourceUrl(source?.url)
  if (!rawDomain || !houseId) {
    return {
      units: [],
      error:
        'Укажите в URL источника строку "домен|house_id" (default host api.macroserver.ru) ' +
        'или "host|домен|house_id" (для SberCRM — api.macro.sbercrm.com|amurcom.ru|7000977).',
    }
  }
  const domain = toPunycode(rawDomain)

  let objects
  let floorPlans = {}
  try {
    const catalogUrl = await openCatalog(apiHost, domain)
    objects = await fetchHouseObjects(catalogUrl, domain, houseId)
    floorPlans = await fetchFloorPlans(catalogUrl, domain, houseId)
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
      floorPlans, // Map<floor, imgUrl> — для syncSources → images (building_floor_level_plan)
    },
  }
}
