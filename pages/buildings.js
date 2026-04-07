import { useEffect, useMemo, useState } from 'react'
import { LayoutGrid, List } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import AccordionSection from '../components/AccordionSection'
import CatalogTabs from '../components/CatalogTabs'
import BuildingChessboard, {
  mapUnitsToChessboardApartments,
} from '../components/BuildingChessboard'
import { getComplexesWithNestedUnits } from '../lib/supabaseQueries'

const normalize = (str) =>
  (str || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const formatName = (str) =>
  (str || '')
    .replace(/\s+/g, ' ')
    .trim()

const formatComplexName = (name) => {
  if (!name) return ''

  let cleaned = name.replace(/\s+/g, ' ').trim()

  cleaned = cleaned.replace(/^жк\s+жк/i, 'ЖК ')

  if (/^жк/i.test(cleaned)) return cleaned

  return 'ЖК ' + cleaned
}

/** Собирает плоский список units с вложенностью building.complex.developer (как в getUnits) */
function getComplexDeveloper(c) {
  const raw = c.developers ?? c.developer
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

/**
 * Дедуп корпусов: сначала по id, затем по нормализованному имени (склейка квартир).
 */
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
    const nk = normalize(b.name || '')
    const key = nk || `__id_${b.id}`
    if (!byName.has(key)) {
      byName.set(key, {
        ...b,
        units: [...(b.units ?? [])],
      })
    } else {
      const ex = byName.get(key)
      mergeUnitsInto(ex, b)
      mergeBuildingPlans(ex, b)
      if (ex.floors == null && b.floors != null) ex.floors = b.floors
    }
  }
  return [...byName.values()]
}

/**
 * Склейка строк complexes с одним id (если API/дубли в ответе).
 */
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
  return [...m.values()].map((c) => ({
    ...c,
    buildings: dedupeBuildings(c.buildings),
  }))
}

/**
 * Один ЖК на экране: одинаковое название (после normalize) → один блок, корпуса объединены.
 */
function mergeComplexesByNameKey(complexes) {
  const byName = new Map()
  for (const c of complexes ?? []) {
    const nameKey = normalize(c.name || '')
    if (!nameKey) {
      byName.set(`__empty_${c.id}`, {
        ...c,
        buildings: dedupeBuildings(c.buildings),
      })
      continue
    }
    if (!byName.has(nameKey)) {
      byName.set(nameKey, {
        ...c,
        buildings: dedupeBuildings([...(c.buildings ?? [])]),
      })
    } else {
      const ex = byName.get(nameKey)
      const merged = [...(ex.buildings ?? []), ...(c.buildings ?? [])]
      ex.buildings = dedupeBuildings(merged)
    }
  }
  return [...byName.values()]
}

/**
 * Убирает дубли ЖК и корпусов из ответа API (повторы в БД / разные id при одном имени).
 */
function sanitizeComplexesPayload(complexes) {
  return mergeComplexesByNameKey(dedupeComplexRowsById(complexes ?? []))
}

function flattenUnitsFromComplexes(complexes) {
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

function isLiterName(name) {
  return /литер/i.test(String(name ?? ''))
}

function isDomName(name) {
  return /дом|корпус/i.test(String(name ?? '')) && !isLiterName(name)
}

/** Сортировка корпусов по названию (Дом / Литер / прочее) */
function sortBuildingsByName(a, b) {
  const rank = (name) => {
    const n = String(name ?? '')
    if (isLiterName(n)) return 1
    if (isDomName(n)) return 0
    return 2
  }
  const ra = rank(a.name)
  const rb = rank(b.name)
  if (ra !== rb) return ra - rb
  return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ru', {
    numeric: true,
  })
}

export default function BuildingsPage() {
  const [isDeveloperOpen, setIsDeveloperOpen] = useState(true)
  const [selectedDeveloperKeys, setSelectedDeveloperKeys] = useState([])
  const [complexes, setComplexes] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedBuilding, setSelectedBuilding] = useState(null)
  const [viewMode, setViewMode] = useState('grid')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem('buildingsViewMode')
    if (saved === 'grid' || saved === 'list') setViewMode(saved)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('buildingsViewMode', viewMode)
  }, [viewMode])

  useEffect(() => {
    async function load() {
      if (!supabase) return
      setBusy(true)
      setError('')
      const { data, error: err } = await getComplexesWithNestedUnits(supabase)
      if (err) {
        setError(err.message || 'Ошибка загрузки')
        setComplexes([])
      } else {
        setComplexes(sanitizeComplexesPayload(data ?? []))
      }
      setBusy(false)
    }
    load()
  }, [])

  const normalized = useMemo(() => {
    return (flattenUnitsFromComplexes(complexes) ?? []).map((u) => {
      const developerName = u.building?.complex?.developer?.name || ''
      const complexName = u.building?.complex?.name || ''

      return {
        ...u,
        developer: formatName(developerName),
        developerKey: normalize(developerName),
        complexName: formatComplexName(complexName),
        complexKey: normalize(complexName),
        complexId: u.building?.complex?.id,
      }
    })
  }, [complexes])

  const developers = useMemo(() => {
    const m = new Map(
      normalized.map((u) => [u.developerKey, u.developer])
    )
    if (m.size === 0) {
      for (const c of complexes) {
        const d = getComplexDeveloper(c)
        const raw = d?.name || ''
        const key = normalize(raw)
        if (!key) continue
        if (!m.has(key)) m.set(key, formatName(raw))
      }
    }
    return [...m.entries()]
      .filter(([k]) => k)
      .sort((a, b) => a[1].localeCompare(b[1], 'ru'))
      .map(([key, name]) => ({ key, name }))
  }, [normalized, complexes])

  const filteredUnits = useMemo(
    () =>
      normalized.filter(
        (u) =>
          selectedDeveloperKeys.length === 0 ||
          selectedDeveloperKeys.includes(u.developerKey)
      ),
    [normalized, selectedDeveloperKeys]
  )

  const visibleComplexIds = useMemo(
    () => new Set(filteredUnits.map((u) => u.complexId).filter(Boolean)),
    [filteredUnits]
  )

  const visibleComplexes = useMemo(
    () => [
      ...new Map(
        filteredUnits.map((u) => [u.complexKey, u.complexName])
      ).values(),
    ],
    [filteredUnits]
  )

  const filteredComplexes = useMemo(() => {
    return complexes.filter((c) => {
      const d = getComplexDeveloper(c)
      const key = normalize(d?.name || '')
      if (selectedDeveloperKeys.length > 0 && !selectedDeveloperKeys.includes(key)) {
        return false
      }
      const hasUnits = (c.buildings ?? []).some((b) => (b.units?.length ?? 0) > 0)
      if (!hasUnits) return true
      if (selectedDeveloperKeys.length === 0) return true
      return visibleComplexIds.has(c.id)
    })
  }, [complexes, selectedDeveloperKeys, visibleComplexIds])

  /** Отдельная карточка на каждый корпус/литер, а не одна на весь ЖК. */
  const buildingCatalogItems = useMemo(() => {
    const items = []
    for (const c of filteredComplexes) {
      const builds = [...(c.buildings ?? [])].sort(sortBuildingsByName)
      for (const b of builds) {
        const allUnits = b.units || []
        const st = (u) => String(u?.status ?? '').toLowerCase()
        const availableUnits = allUnits.filter((u) => st(u) !== 'sold' && st(u) !== 'booked')
        const prices = availableUnits
          .map((u) => Number(u.price))
          .filter((p) => !Number.isNaN(p) && p > 0)
        const minPrice = prices.length ? Math.min(...prices) : null
        items.push({
          complex: c,
          building: b,
          unitsCount: availableUnits.length,
          minPrice,
        })
      }
    }
    return items
  }, [filteredComplexes])

  function toggleDeveloper(key) {
    setSelectedDeveloperKeys((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    )
  }

  function openChessboard(c, building) {
    const buildings = [...(c.buildings ?? [])].sort(sortBuildingsByName)
    const b =
      building ||
      buildings.find((b0) =>
        (b0.units ?? []).some((u) => u.status === 'available')
      ) ||
      buildings.find((b0) => (b0.units ?? []).length > 0) ||
      buildings[0]
    if (!b) return
    setSelectedBuilding({
      id: b.id,
      buildingName: b.name ?? '',
      complexName: formatComplexName(c.name ?? ''),
      floors: b.floors ?? null,
      unitsPerFloor: b.units_per_floor ?? 4,
      unitsPerEntrance: Array.isArray(b.units_per_entrance)
        ? b.units_per_entrance
        : null,
      apartments: b.units ?? [],
      floorPlanUrl: b.floorPlanUrl ?? null,
      floorPlanByFloor: b.floorPlanByFloor ?? {},
    })
  }

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      <CatalogTabs />

      {selectedBuilding ? (
        <div className="flex min-h-0 flex-1 flex-col bg-gray-100">
          <div className="flex shrink-0 items-center gap-3 border-b bg-white px-4 py-3 shadow-sm">
            <button
              type="button"
              onClick={() => setSelectedBuilding(null)}
              className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-300"
            >
              ← Назад
            </button>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {selectedBuilding.buildingName}
              </h2>
              <p className="text-sm text-gray-500">
                {selectedBuilding.complexName}
              </p>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedBuilding.floorPlanUrl &&
            (!selectedBuilding.floorPlanByFloor ||
              Object.keys(selectedBuilding.floorPlanByFloor).length === 0) ? (
              <div className="mb-4 rounded-xl border border-slate-800 bg-white p-3">
                <div className="mb-2 text-sm font-semibold text-slate-900">
                  Поэтажный план
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedBuilding.floorPlanUrl}
                  alt="Поэтажный план"
                  className="w-full rounded-lg border border-slate-200 object-contain"
                />
              </div>
            ) : null}
            <BuildingChessboard
              apartments={mapUnitsToChessboardApartments(
                selectedBuilding.apartments
              )}
              floorsCount={selectedBuilding.floors ?? 0}
              unitsPerFloor={selectedBuilding.unitsPerFloor ?? 4}
              unitsPerEntrance={selectedBuilding.unitsPerEntrance ?? null}
              floorPlanByFloor={selectedBuilding.floorPlanByFloor ?? {}}
            />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-64 shrink-0 overflow-y-auto border-r bg-gray-100 p-4">
            <h2 className="mb-3 text-lg font-bold text-gray-900">Фильтр</h2>

            <AccordionSection
              title="Застройщики"
              isOpen={isDeveloperOpen}
              onToggle={() => setIsDeveloperOpen(!isDeveloperOpen)}
            >
              <div className="space-y-2">
                {developers.length ? (
                  developers.map((d) => (
                    <label
                      key={d.key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDeveloperKeys.includes(d.key)}
                        onChange={() => toggleDeveloper(d.key)}
                        className="accent-orange-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="truncate text-gray-800">{d.name}</span>
                    </label>
                  ))
                ) : (
                  <p className="text-xs text-gray-400">Нет данных</p>
                )}
              </div>
            </AccordionSection>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {busy ? (
              <p className="text-sm text-gray-500">Загрузка...</p>
            ) : error ? (
              <p className="text-sm text-rose-600">{error}</p>
            ) : filteredComplexes.length === 0 ? (
              <p className="text-sm text-gray-500">
                {complexes.length === 0
                  ? 'Нет ЖК в базе. Выполните миграцию и добавьте данные в админке.'
                  : 'Ничего не найдено по выбранным застройщикам'}
              </p>
            ) : (
              <div>
                <p className="sr-only">
                  {visibleComplexes.length > 0
                    ? `Список ЖК: ${visibleComplexes.join(', ')}`
                    : 'Нет ЖК по фильтру'}
                </p>

                <div className="mb-4 flex items-center justify-between gap-4">
                  <h1 className="text-xl font-bold text-gray-900">
                    Дома / ЖК
                  </h1>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setViewMode('grid')}
                      className={`rounded-lg border p-2 transition ${
                        viewMode === 'grid'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                      aria-label="Плитка"
                    >
                      <LayoutGrid size={20} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      className={`rounded-lg border p-2 transition ${
                        viewMode === 'list'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                      aria-label="Список"
                    >
                      <List size={20} />
                    </button>
                  </div>
                </div>

                {viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {buildingCatalogItems.map(({ complex: c, building: b, unitsCount, minPrice }) => (
                      <BuildingCatalogCard
                        key={b.id}
                        complex={c}
                        building={b}
                        unitsCount={unitsCount}
                        minPrice={minPrice}
                        view="grid"
                        onOpenChessboard={() => openChessboard(c, b)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {buildingCatalogItems.map(({ complex: c, building: b, unitsCount, minPrice }) => (
                      <BuildingCatalogCard
                        key={b.id}
                        complex={c}
                        building={b}
                        unitsCount={unitsCount}
                        minPrice={minPrice}
                        view="list"
                        onOpenChessboard={() => openChessboard(c, b)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function BuildingCatalogCard({
  complex: c,
  building: b,
  unitsCount,
  minPrice,
  view,
  onOpenChessboard,
}) {
  const complexTitle = formatComplexName(c.name ?? '')
  const buildingTitle = formatName(b.name ?? '')
  const dev = getComplexDeveloper(c)
  const developerLabel = formatName(dev?.name || '')
  const imageUrl = c.image || null

  const priceLine =
    minPrice != null && !Number.isNaN(minPrice) ? (
      <span>от {Math.round(minPrice).toLocaleString('ru-RU')} ₽</span>
    ) : (
      'Нет в продаже'
    )

  if (view === 'list') {
    return (
      <div className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow transition-shadow duration-300 hover:shadow-lg sm:flex-row sm:items-center sm:gap-4">
        <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-xl bg-gray-200 sm:h-28 sm:w-40">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full object-cover transition duration-300 hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
              Нет фото
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-gray-900">{complexTitle}</h3>
          <p className="text-sm font-medium text-gray-700">{buildingTitle}</p>
          <p className="text-xs text-gray-500">{developerLabel || '—'}</p>
          <div className="mt-2 text-lg font-semibold text-blue-600">
            {priceLine}
          </div>
          <div className="mt-2 text-sm text-gray-500">
            {unitsCount} в продаже
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenChessboard}
          className="shrink-0 rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 sm:self-center"
        >
          Шахматка
        </button>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow transition-shadow duration-300 hover:shadow-xl">
      <div className="relative h-40 bg-gray-200">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover transition duration-300 hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
            Нет фото
          </div>
        )}
        {unitsCount > 0 ? (
          <div className="absolute left-2 top-2 rounded bg-white/95 px-2 py-1 text-xs font-medium text-gray-800 shadow">
            {unitsCount} квартир
          </div>
        ) : null}
      </div>

      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-900">{complexTitle}</h3>
        <p className="mt-0.5 text-sm font-medium text-gray-700">{buildingTitle}</p>
        <p className="mt-1 text-xs text-gray-500">{developerLabel || '—'}</p>

        <div className="mt-3 text-lg font-semibold text-blue-600">
          {priceLine}
        </div>

        <button
          type="button"
          onClick={onOpenChessboard}
          className="mt-4 w-full rounded-xl bg-blue-500 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600"
        >
          Смотреть шахматку
        </button>
      </div>
    </div>
  )
}
