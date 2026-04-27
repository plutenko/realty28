// Утилиты для работы со списком ЖК из /api/complexes:
// нормализация имён, дедуп ЖК/корпусов (на случай дубликатов в БД и в ответе API),
// flatten в плоский список квартир и сортировка корпусов.

export const normalizeName = (str) =>
  (str || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

export const formatName = (str) =>
  (str || '')
    .replace(/\s+/g, ' ')
    .trim()

export const formatComplexName = (name) => {
  if (!name) return ''
  let cleaned = name.replace(/\s+/g, ' ').trim()
  cleaned = cleaned.replace(/^жк\s+жк/i, 'ЖК ')
  if (/^жк/i.test(cleaned)) return cleaned
  return 'ЖК ' + cleaned
}

export function getComplexDeveloper(c) {
  const raw = c?.developers ?? c?.developer
  return Array.isArray(raw) ? raw[0] : raw
}

function mergeUnitsInto(target, source) {
  if (!target.units) target.units = []
  const seen = new Set(target.units.map((u) => u.id).filter(Boolean))
  for (const u of source.units ?? []) {
    if (u?.id) {
      if (seen.has(u.id)) continue
      seen.add(u.id)
    }
    target.units.push(u)
  }
}

function mergeBuildingPlans(target, source) {
  if (source?.floorPlanUrl && !target.floorPlanUrl) {
    target.floorPlanUrl = source.floorPlanUrl
  }
  if (source?.floorPlanByFloor && typeof source.floorPlanByFloor === 'object') {
    target.floorPlanByFloor = {
      ...(target.floorPlanByFloor || {}),
      ...source.floorPlanByFloor,
    }
  }
}

function dedupeBuildings(buildings) {
  const byId = new Map()
  for (const b of buildings ?? []) {
    if (!b?.id) continue
    if (!byId.has(b.id)) {
      byId.set(b.id, b)
    } else {
      const t = byId.get(b.id)
      mergeUnitsInto(t, b)
      mergeBuildingPlans(t, b)
    }
  }
  const byName = new Map()
  for (const b of byId.values()) {
    const nk = normalizeName(b.name || '')
    const key = nk || `__id_${b.id}`
    if (!byName.has(key)) {
      byName.set(key, { ...b, units: [...(b.units ?? [])] })
    } else {
      const ex = byName.get(key)
      mergeUnitsInto(ex, b)
      mergeBuildingPlans(ex, b)
      if (ex.floors == null && b.floors != null) ex.floors = b.floors
    }
  }
  return [...byName.values()]
}

function dedupeComplexRowsById(complexes) {
  const m = new Map()
  for (const c of complexes ?? []) {
    if (!c?.id) continue
    if (!m.has(c.id)) {
      m.set(c.id, { ...c, buildings: [...(c.buildings ?? [])] })
    } else {
      const ex = m.get(c.id)
      ex.buildings = [...(ex.buildings ?? []), ...(c.buildings ?? [])]
    }
  }
  return [...m.values()].map((c) => ({ ...c, buildings: dedupeBuildings(c.buildings) }))
}

function mergeComplexesByNameKey(complexes) {
  const byName = new Map()
  for (const c of complexes ?? []) {
    const nameKey = normalizeName(c.name || '')
    if (!nameKey) {
      byName.set(`__empty_${c.id}`, { ...c, buildings: dedupeBuildings(c.buildings) })
      continue
    }
    if (!byName.has(nameKey)) {
      byName.set(nameKey, { ...c, buildings: dedupeBuildings([...(c.buildings ?? [])]) })
    } else {
      const ex = byName.get(nameKey)
      const merged = [...(ex.buildings ?? []), ...(c.buildings ?? [])]
      ex.buildings = dedupeBuildings(merged)
    }
  }
  return [...byName.values()]
}

export function sanitizeComplexesPayload(complexes) {
  return mergeComplexesByNameKey(dedupeComplexRowsById(complexes ?? []))
}

export function flattenUnitsFromComplexes(complexes) {
  const rows = []
  for (const c of complexes ?? []) {
    const developer = getComplexDeveloper(c)
    for (const b of c.buildings ?? []) {
      for (const u of b.units ?? []) {
        rows.push({
          ...u,
          building: {
            id: b.id,
            name: b.name,
            floors: b.floors,
            complex: {
              id: c.id,
              name: c.name,
              developer_id: c.developer_id,
              developer,
            },
          },
        })
      }
    }
  }
  return rows
}

export function isLiterName(name) {
  return /литер/i.test(String(name ?? ''))
}

export function isDomName(name) {
  return /дом|корпус/i.test(String(name ?? '')) && !isLiterName(name)
}

export function sortBuildingsByName(a, b) {
  const rank = (name) => {
    const n = String(name ?? '')
    if (isLiterName(n)) return 1
    if (isDomName(n)) return 0
    return 2
  }
  const ra = rank(a.name)
  const rb = rank(b.name)
  if (ra !== rb) return ra - rb
  return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ru', { numeric: true })
}
