import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/authContext'
import CatalogTabs from '../components/CatalogTabs'
import PriceFilterSection from '../components/apartments/PriceFilterSection'

function formatPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('ru-RU')
}

function statusInfo(st) {
  const s = String(st || '').toLowerCase()
  if (s === 'sold') return { text: 'Продано', cls: 'bg-rose-100 text-rose-700', border: 'border-rose-200' }
  if (s === 'booked' || s === 'reserved') return { text: 'Бронь', cls: 'bg-amber-100 text-amber-700', border: 'border-amber-200' }
  if (s === 'closed') return { text: 'Закрыто', cls: 'bg-gray-200 text-gray-600', border: 'border-gray-300' }
  return { text: 'В продаже', cls: 'bg-green-100 text-green-700', border: 'border-green-200' }
}

export default function CommercialPage() {
  const { user } = useAuth()
  const [units, setUnits] = useState([])
  const [busy, setBusy] = useState(true)
  const [selectedDevelopers, setSelectedDevelopers] = useState([])
  const [selectedComplexes, setSelectedComplexes] = useState([])
  const [selectedBuildingIds, setSelectedBuildingIds] = useState([])
  const [priceMin, setPriceMin] = useState(0)
  const [priceMax, setPriceMax] = useState(100000000)
  const [areaMin, setAreaMin] = useState(0)
  const [areaMax, setAreaMax] = useState(500)

  const PRICE_ABS_MIN = 0
  const PRICE_ABS_MAX = 100000000
  const AREA_ABS_MIN = 0
  const AREA_ABS_MAX = 500

  useEffect(() => {
    if (!supabase) return
    ;(async () => {
      const { data } = await supabase
        .from('units')
        .select(`
          id, number, floor, area, price, price_per_meter, status, layout_title,
          building:building_id (
            id, name,
            complex:complex_id (
              id, name,
              developer:developer_id ( id, name )
            )
          )
        `)
        .eq('is_commercial', true)
        .not('status', 'in', '("sold","booked","reserved","closed")')
        .order('price', { ascending: false })

      setUnits(data ?? [])
      setBusy(false)
    })()
  }, [])

  const developers = useMemo(() =>
    [...new Set(units.map(u => u.building?.complex?.developer?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
    [units]
  )

  const complexBuildingsTree = useMemo(() => {
    const byComplex = new Map()
    for (const u of units) {
      const cn = u.building?.complex?.name
      const bid = u.building?.id
      const bn = u.building?.name
      if (!cn || !bid) continue
      if (!byComplex.has(cn)) byComplex.set(cn, { developer: u.building?.complex?.developer?.name, buildings: new Map() })
      byComplex.get(cn).buildings.set(bid, bn || 'Корпус')
    }
    return [...byComplex.entries()]
      .map(([complexName, { developer, buildings }]) => ({
        complexName,
        developer,
        buildings: [...buildings.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru', { numeric: true })),
      }))
      .sort((a, b) => a.complexName.localeCompare(b.complexName, 'ru'))
  }, [units])

  const filtered = useMemo(() => {
    return units.filter(u => {
      const devName = u.building?.complex?.developer?.name
      const complexName = u.building?.complex?.name
      const bid = u.building?.id
      if (selectedDevelopers.length && !selectedDevelopers.includes(devName)) return false
      if (selectedComplexes.length || selectedBuildingIds.length) {
        const matchComplex = selectedComplexes.includes(complexName)
        const matchBuilding = selectedBuildingIds.includes(bid)
        if (!matchComplex && !matchBuilding) return false
      }
      const area = Number(u.area) || 0
      if (area < areaMin || area > areaMax) return false
      const price = Number(u.price) || 0
      if (price < priceMin || price > priceMax) return false
      return true
    })
  }, [units, selectedDevelopers, selectedComplexes, selectedBuildingIds, areaMin, areaMax, priceMin, priceMax])

  // Count units per complex/building (unfiltered by complex)
  const complexCounts = useMemo(() => {
    const out = {}
    for (const u of units) {
      const cn = u.building?.complex?.name
      if (cn) out[cn] = (out[cn] || 0) + 1
    }
    return out
  }, [units])

  const buildingCounts = useMemo(() => {
    const out = {}
    for (const u of units) {
      const bid = u.building?.id
      if (bid) out[bid] = (out[bid] || 0) + 1
    }
    return out
  }, [units])

  function toggleDeveloper(name) {
    setSelectedDevelopers(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])
  }

  function toggleComplex(complexName, buildingIds) {
    if (selectedComplexes.includes(complexName)) {
      setSelectedComplexes(prev => prev.filter(x => x !== complexName))
      setSelectedBuildingIds(prev => prev.filter(id => !buildingIds.includes(id)))
    } else {
      setSelectedComplexes(prev => [...prev, complexName])
      setSelectedBuildingIds(prev => prev.filter(id => !buildingIds.includes(id)))
    }
  }

  function toggleBuilding(complexName, buildingId, allBuildingIds) {
    if (selectedComplexes.includes(complexName)) {
      setSelectedComplexes(prev => prev.filter(x => x !== complexName))
      setSelectedBuildingIds(prev => [...prev.filter(id => !allBuildingIds.includes(id)), ...allBuildingIds.filter(id => id !== buildingId)])
    } else {
      setSelectedBuildingIds(prev => prev.includes(buildingId) ? prev.filter(x => x !== buildingId) : [...prev, buildingId])
    }
  }

  const [openSections, setOpenSections] = useState({ developers: true, complexes: true })
  const toggle = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <CatalogTabs />

      <div className="px-4 py-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Коммерческие помещения</h1>
          <span className="text-sm text-gray-500">Найдено: {filtered.length}</span>
        </div>

        <div className="flex gap-6">
          {/* Фильтры */}
          <div className="w-64 shrink-0 space-y-4">
            {/* Цена */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <h3 className="mb-1 font-semibold text-gray-900">Цена</h3>
              <PriceFilterSection
                priceMin={priceMin}
                priceMax={priceMax}
                onPriceMinChange={setPriceMin}
                onPriceMaxChange={setPriceMax}
                absMin={PRICE_ABS_MIN}
                absMax={PRICE_ABS_MAX}
              />
            </div>

            {/* Площадь */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <h3 className="mb-1 font-semibold text-gray-900">Площадь, м²</h3>
              <PriceFilterSection
                priceMin={areaMin}
                priceMax={areaMax}
                onPriceMinChange={setAreaMin}
                onPriceMaxChange={setAreaMax}
                absMin={AREA_ABS_MIN}
                absMax={AREA_ABS_MAX}
                step={1}
                formatLabel={(n) => `${n} м²`}
              />
            </div>

            {/* Застройщики */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <button onClick={() => toggle('developers')} className="flex w-full items-center justify-between text-base font-bold text-gray-900">
                Застройщики
                <span className="text-gray-400">{openSections.developers ? '▲' : '▼'}</span>
              </button>
              {openSections.developers && (
                <div className="mt-3 space-y-2">
                  {developers.map(d => (
                    <label key={d} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={selectedDevelopers.includes(d)} onChange={() => toggleDeveloper(d)} className="h-4 w-4 rounded border-gray-300" />
                      {d}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* ЖК */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <button onClick={() => toggle('complexes')} className="flex w-full items-center justify-between text-base font-bold text-gray-900">
                ЖК
                <span className="text-gray-400">{openSections.complexes ? '▲' : '▼'}</span>
              </button>
              {openSections.complexes && (
                <div className="mt-3 space-y-3">
                  {complexBuildingsTree.map(({ complexName, buildings }) => {
                    const allIds = buildings.map(b => b.id)
                    const isComplexChecked = selectedComplexes.includes(complexName)
                    return (
                      <div key={complexName} className="rounded-xl border border-gray-100 p-3">
                        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-800">
                          <span className="text-gray-400 text-xs">▼</span>
                          <input type="checkbox" checked={isComplexChecked} onChange={() => toggleComplex(complexName, allIds)} className="h-4 w-4 rounded border-gray-300" />
                          <span className="flex-1 truncate">{complexName}</span>
                          <span className="text-xs text-gray-400">({complexCounts[complexName] || 0})</span>
                        </label>
                        {buildings.length > 1 && (
                          <div className="mt-2 ml-6 space-y-1 border-l-2 border-amber-200 pl-3">
                            <div className="text-[10px] font-semibold uppercase text-gray-400">Литеры</div>
                            {buildings.map(b => (
                              <label key={b.id} className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                                <input type="checkbox" checked={isComplexChecked || selectedBuildingIds.includes(b.id)} onChange={() => toggleBuilding(complexName, b.id, allIds)} className="h-3.5 w-3.5 rounded border-gray-300" />
                                <span className="flex-1">{b.name}</span>
                                <span className="text-xs text-gray-400">({buildingCounts[b.id] || 0})</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Карточки */}
          <div className="flex-1">
            {busy ? (
              <p className="text-sm text-gray-500">Загрузка...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-gray-500">Ничего не найдено</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filtered.map(u => {
                  const st = statusInfo(u.status)
                  return (
                    <div key={u.id} className={`rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md ${st.border}`}>
                      <div className="mb-2 flex items-start justify-between">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">
                            {u.layout_title || 'Помещение'}
                          </div>
                          <div className="text-xs text-gray-500">
                            {u.building?.complex?.name || '—'} · {u.building?.name || '—'}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>
                          {st.text}
                        </span>
                      </div>

                      <div className="mb-3 text-center">
                        <div className="text-2xl font-bold text-gray-900">
                          {formatPrice(u.price)} ₽
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                        <div>
                          <span className="text-gray-400">Площадь:</span>{' '}
                          <span className="font-medium">{u.area ? `${u.area} м²` : '—'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">₽/м²:</span>{' '}
                          <span className="font-medium">{u.price_per_meter ? formatPrice(u.price_per_meter) : '—'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">Этаж:</span>{' '}
                          <span className="font-medium">{u.floor ?? '—'}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">Застройщик:</span>{' '}
                          <span className="font-medium">{u.building?.complex?.developer?.name || '—'}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
