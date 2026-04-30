export async function fetchUnitsFromApi() {
  try {
    const res = await fetch('/api/units')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return { data, error: null }
  } catch (e) {
    return { data: [], error: e }
  }
}

export async function fetchComplexesFromApi() {
  try {
    const res = await fetch('/api/complexes')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return { data, error: null }
  } catch (e) {
    return { data: [], error: e }
  }
}

export async function fetchBuildingsSummaryFromApi() {
  try {
    const res = await fetch('/api/buildings-summary')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return { data, error: null }
  } catch (e) {
    return { data: [], error: e }
  }
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
