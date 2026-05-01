// При наличии NEXT_PUBLIC_API_WORKER_BASE (например https://api-units.plutenko.workers.dev)
// фронт идёт за тяжёлыми публичными API на CF Worker, который кеширует на edge.
// Если Worker по какой-то причине не отвечает — фолбэк на origin /api/*.
const WORKER_BASE = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_WORKER_BASE) || ''

const URLS = WORKER_BASE
  ? {
      units: `${WORKER_BASE}/units`,
      complexes: `${WORKER_BASE}/complexes`,
      buildingsSummary: `${WORKER_BASE}/buildings-summary`,
    }
  : {
      units: '/api/units',
      complexes: '/api/complexes',
      buildingsSummary: '/api/buildings-summary',
    }

const FALLBACK_URLS = {
  units: '/api/units',
  complexes: '/api/complexes',
  buildingsSummary: '/api/buildings-summary',
}

async function fetchWithFallback(key) {
  const primary = URLS[key]
  const fallback = FALLBACK_URLS[key]
  try {
    const res = await fetch(primary)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { data: await res.json(), error: null }
  } catch (e) {
    if (primary === fallback) {
      return { data: [], error: e }
    }
    try {
      const res = await fetch(fallback)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { data: await res.json(), error: null }
    } catch (e2) {
      return { data: [], error: e2 }
    }
  }
}

export async function fetchUnitsFromApi() {
  return fetchWithFallback('units')
}

export async function fetchComplexesFromApi() {
  return fetchWithFallback('complexes')
}

export async function fetchBuildingsSummaryFromApi() {
  return fetchWithFallback('buildingsSummary')
}

/**
 * Денормализация: /api/units теперь возвращает только building_id (без вложенного
 * building/complex/developer, чтобы не раздувать payload). Эта функция строит lookup
 * по complexes и склеивает каждый юнит с его building+complex+developer как было раньше.
 *
 * Старый код продолжает работать с u.building.complex.name и т.п.
 */
export function attachBuildingsToUnits(units, complexes) {
  if (!units?.length) return units ?? []
  if (!complexes?.length) return units
  const byId = new Map()
  for (const c of complexes) {
    const dev = Array.isArray(c.developer) ? c.developer[0]
      : Array.isArray(c.developers) ? c.developers[0]
      : (c.developer || c.developers || null)
    const complexLite = {
      id: c.id,
      name: c.name,
      website_url: c.website_url,
      realtor_commission_type: c.realtor_commission_type,
      realtor_commission_value: c.realtor_commission_value,
      developer: dev || null,
      developers: dev ? [dev] : [],
    }
    for (const b of c.buildings ?? []) {
      if (!b?.id) continue
      // Не тащим в лукап b.units — на /apartments они не нужны квартирной карточке.
      const { units: _omit, ...bSlim } = b
      byId.set(b.id, { ...bSlim, complex: complexLite })
    }
  }
  return units.map((u) => {
    if (!u || u.building) return u
    const b = byId.get(u.building_id)
    return b ? { ...u, building: b } : u
  })
}
