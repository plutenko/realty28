import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, List } from 'lucide-react'
import { useAuth } from '../lib/authContext'
import CatalogTabs from '../components/CatalogTabs'
import { fetchUnitsFromApi } from '../lib/fetchUnitsFromApi'
import FiltersSidebar from '../components/apartments/FiltersSidebar'
import ApartmentCard, { calcCommission } from '../components/apartments/ApartmentCard'
import ApartmentModal from '../components/apartments/ApartmentModal'

const ABS_MIN = 0
const ABS_MAX = 50000000

const priceRanges = [
  { label: 'До 7 млн ₽', min: 0, max: 7000000 },
  { label: '7 – 9 млн ₽', min: 7000000, max: 9000000 },
  { label: '9 – 12 млн ₽', min: 9000000, max: 12000000 },
  { label: '12 – 20 млн ₽', min: 12000000, max: 20000000 },
  { label: '20+ млн ₽', min: 20000000, max: Infinity },
]

const areaRanges = [
  { label: 'До 30 м²', min: 0, max: 30 },
  { label: '30 – 50 м²', min: 30, max: 50 },
  { label: '50 – 70 м²', min: 50, max: 70 },
  { label: '70+ м²', min: 70, max: Infinity },
]

const ppmRanges = [
  { label: 'До 150 000 ₽/м²', min: 0, max: 150000 },
  { label: '150 – 180 тыс ₽/м²', min: 150000, max: 180000 },
  { label: '180 – 220 тыс ₽/м²', min: 180000, max: 220000 },
  { label: '220 – 260 тыс ₽/м²', min: 220000, max: 260000 },
  { label: '260+ тыс ₽/м²', min: 260000, max: Infinity },
]

function unitPpm(u) {
  const price = Number(u?.price)
  const area = Number(u?.area)
  if (Number.isFinite(price) && Number.isFinite(area) && area > 0) return price / area
  return null
}

function unitMatchesPpmRanges(u, selectedIdx) {
  if (!selectedIdx?.length) return true
  const ppm = unitPpm(u)
  if (ppm == null) return false
  return selectedIdx.some((i) => {
    const r = ppmRanges[i]
    return r && ppm >= r.min && ppm < r.max
  })
}

/** area в БД может быть строкой — ручной ввод «От / До» */
function unitAreaMatches(u, areaFrom, areaTo) {
  const a = Number(u.area)
  return (
    (!areaFrom || a >= Number(areaFrom)) &&
    (!areaTo || a <= Number(areaTo))
  )
}

/** Быстрые диапазоны площади (чекбоксы) */
function unitAreaQuickRangesMatch(u, selectedAreaRanges) {
  if (!selectedAreaRanges.length) return true
  const area = Number(u.area)
  return selectedAreaRanges.some((r) => area >= r.min && area <= r.max)
}

function unitMatchesComplexBuildingFilter(u, selectedComplexes, selectedBuildingIds) {
  if (!selectedComplexes.length && !selectedBuildingIds.length) return true
  const cn = u?.building?.complex?.name
  const bid = u?.building?.id
  if (cn && selectedComplexes.includes(cn)) return true
  if (bid && selectedBuildingIds.includes(bid)) return true
  return false
}

function getHandoverKeyForUnit(u) {
  const st = String(u?.building?.handover_status || '').toLowerCase()
  if (st === 'delivered') return 'delivered'
  const q = Number(u?.building?.handover_quarter)
  const y = Number(u?.building?.handover_year)
  if (Number.isFinite(q) && q >= 1 && q <= 4 && Number.isFinite(y) && y > 0) {
    return `planned:${q}:${y}`
  }
  return 'planned:unknown'
}

function handoverLabelByKey(key) {
  if (key === 'delivered') return 'Сдан'
  if (key === 'planned:unknown') return 'Срок не указан'
  const m = /^planned:(\d):(\d{4})$/.exec(String(key))
  if (!m) return 'Срок сдачи'
  return `${m[1]} кв. ${m[2]}`
}

export default function ApartmentsPage() {
  const { user } = useAuth()
  const [units, setUnits] = useState([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const [viewMode, setViewMode] = useState('grid')

  const [selectedDevelopers, setSelectedDevelopers] = useState([])
  const [selectedComplexes, setSelectedComplexes] = useState([])
  /** UUID корпусов (литер); OR с выбранным целиком ЖК */
  const [selectedBuildingIds, setSelectedBuildingIds] = useState([])
  const [selectedHandoverKeys, setSelectedHandoverKeys] = useState([])
  const [selectedPpmRanges, setSelectedPpmRanges] = useState([])
  const selectedComplexesRef = useRef(selectedComplexes)
  const selectedBuildingIdsRef = useRef(selectedBuildingIds)
  useEffect(() => {
    selectedComplexesRef.current = selectedComplexes
  }, [selectedComplexes])
  useEffect(() => {
    selectedBuildingIdsRef.current = selectedBuildingIds
  }, [selectedBuildingIds])
  const [priceMin, setPriceMin] = useState(ABS_MIN)
  const [priceMax, setPriceMax] = useState(ABS_MAX)
  // Быстрый фильтр цен (диапазоны как в DNS)
  const [selectedPriceRanges, setSelectedPriceRanges] = useState([])
  const [selectedRooms, setSelectedRooms] = useState([])
  const [twoLevelOnly, setTwoLevelOnly] = useState(false)
  const [floorFrom, setFloorFrom] = useState(null)
  const [floorTo, setFloorTo] = useState(null)
  const [areaFrom, setAreaFrom] = useState('')
  const [areaTo, setAreaTo] = useState('')
  const [selectedAreaRanges, setSelectedAreaRanges] = useState([])
  const [selectedUnits, setSelectedUnits] = useState([])
  const [modalUnit, setModalUnit] = useState(null)
  const [creatingCollection, setCreatingCollection] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem('apartmentsViewMode')
    if (saved === 'grid' || saved === 'list') setViewMode(saved)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('apartmentsViewMode', viewMode)
  }, [viewMode])

  useEffect(() => {
    async function load() {
      setBusy(true)
      setError('')

      try {
        const { data, error: err } = await fetchUnitsFromApi()
        if (err) {
          setError(err.message || 'Ошибка загрузки')
          setUnits([])
        } else {
          const units = data ?? []
          console.log('[apartments] loaded units:', units.length,
            'by building:', Object.entries(
              units.reduce((acc, u) => {
                const key = `${u.building?.complex?.name} / ${u.building?.name}`
                acc[key] = (acc[key] || 0) + 1
                return acc
              }, {})
            ).sort((a, b) => b[1] - a[1])
          )
          setUnits(units)
        }
      } catch (e) {
        setError(e?.message || 'Ошибка загрузки')
        setUnits([])
      } finally {
        setBusy(false)
      }
    }

    load()
  }, [])

  const uniqueDevelopers = useMemo(() => {
    return Array.from(
      new Set(
        (units ?? [])
          .map((u) => u?.building?.complex?.developer?.name)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'ru'))
  }, [units])

  const uniqueComplexes = useMemo(() => {
    return Array.from(
      new Set((units ?? []).map((u) => u?.building?.complex?.name).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'ru'))
  }, [units])

  /** ЖК → литеры (корпуса) для вложенного фильтра */
  const complexBuildingsTree = useMemo(() => {
    const byComplex = new Map()
    for (const u of units ?? []) {
      const cn = u?.building?.complex?.name
      const bid = u?.building?.id
      const bn = u?.building?.name
      const addr = u?.building?.address
      if (!cn || !bid) continue
      if (!byComplex.has(cn)) byComplex.set(cn, new Map())
      const m = byComplex.get(cn)
      if (!m.has(bid)) m.set(bid, { name: bn ? String(bn).trim() : 'Корпус', address: addr || null })
    }
    return uniqueComplexes
      .filter((cn) => byComplex.has(cn))
      .map((complexName) => {
        const m = byComplex.get(complexName)
        const buildings = [...m.entries()]
          .map(([id, v]) => ({ id, name: v.name, address: v.address }))
          .sort((a, b) =>
            String(a.name).localeCompare(String(b.name), 'ru', { numeric: true })
          )
        return { complexName, buildings }
      })
  }, [units, uniqueComplexes])

  const roomsValues = [0, 1, 2, 3, 4]

  const handoverOptions = useMemo(() => {
    const map = new Map()
    for (const u of units ?? []) {
      const key = getHandoverKeyForUnit(u)
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: handoverLabelByKey(key),
        })
      }
    }
    const rank = (k) => {
      if (k === 'delivered') return 0
      if (k === 'planned:unknown') return 2
      return 1
    }
    return [...map.values()].sort((a, b) => {
      const ra = rank(a.key)
      const rb = rank(b.key)
      if (ra !== rb) return ra - rb
      const ma = /^planned:(\d):(\d{4})$/.exec(a.key)
      const mb = /^planned:(\d):(\d{4})$/.exec(b.key)
      if (ma && mb) {
        const ya = Number(ma[2])
        const yb = Number(mb[2])
        if (ya !== yb) return ya - yb
        return Number(ma[1]) - Number(mb[1])
      }
      return a.label.localeCompare(b.label, 'ru')
    })
  }, [units])

  const baseFiltered = useMemo(() => {
    return (units ?? []).filter((u) => {
      const devName = u?.building?.complex?.developer?.name
      const complexName = u?.building?.complex?.name
      const floorVal = u?.floor ?? 0
      const st = String(u?.status ?? '').toLowerCase()
      const notSold = st !== 'sold' && st !== 'booked' && st !== 'reserved' && st !== 'closed'
      const handoverKey = getHandoverKeyForUnit(u)

      return (
        notSold &&
        (selectedDevelopers.length === 0 || selectedDevelopers.includes(devName)) &&
        unitMatchesComplexBuildingFilter(u, selectedComplexes, selectedBuildingIds) &&
        (selectedHandoverKeys.length === 0 || selectedHandoverKeys.includes(handoverKey)) &&
        unitMatchesPpmRanges(u, selectedPpmRanges) &&
        (floorFrom == null || floorVal >= floorFrom) &&
        (floorTo == null || floorVal <= floorTo) &&
        unitAreaMatches(u, areaFrom, areaTo)
      )
    })
  }, [
    units,
    selectedDevelopers,
    selectedComplexes,
    selectedBuildingIds,
    selectedHandoverKeys,
    selectedPpmRanges,
    floorFrom,
    floorTo,
    areaFrom,
    areaTo,
  ])

  const baseFilteredNoHandover = useMemo(() => {
    return (units ?? []).filter((u) => {
      const devName = u?.building?.complex?.developer?.name
      const floorVal = u?.floor ?? 0
      const st = String(u?.status ?? '').toLowerCase()
      const notSold = st !== 'sold' && st !== 'booked' && st !== 'reserved' && st !== 'closed'
      return (
        notSold &&
        (selectedDevelopers.length === 0 || selectedDevelopers.includes(devName)) &&
        unitMatchesComplexBuildingFilter(u, selectedComplexes, selectedBuildingIds) &&
        unitMatchesPpmRanges(u, selectedPpmRanges) &&
        (floorFrom == null || floorVal >= floorFrom) &&
        (floorTo == null || floorVal <= floorTo) &&
        unitAreaMatches(u, areaFrom, areaTo)
      )
    })
  }, [
    units,
    selectedDevelopers,
    selectedComplexes,
    selectedBuildingIds,
    selectedPpmRanges,
    floorFrom,
    floorTo,
    areaFrom,
    areaTo,
  ])

  const baseFilteredNoComplex = useMemo(() => {
    return (units ?? []).filter((u) => {
      const devName = u?.building?.complex?.developer?.name
      const floorVal = u?.floor ?? 0
      const st = String(u?.status ?? '').toLowerCase()
      const notSold = st !== 'sold' && st !== 'booked' && st !== 'reserved' && st !== 'closed'
      const handoverKey = getHandoverKeyForUnit(u)

      return (
        notSold &&
        (selectedDevelopers.length === 0 || selectedDevelopers.includes(devName)) &&
        (selectedHandoverKeys.length === 0 || selectedHandoverKeys.includes(handoverKey)) &&
        unitMatchesPpmRanges(u, selectedPpmRanges) &&
        (floorFrom == null || floorVal >= floorFrom) &&
        (floorTo == null || floorVal <= floorTo) &&
        unitAreaMatches(u, areaFrom, areaTo)
      )
    })
  }, [
    units,
    selectedDevelopers,
    selectedHandoverKeys,
    selectedPpmRanges,
    floorFrom,
    floorTo,
    areaFrom,
    areaTo,
  ])

  const roomsOk = (u, roomsSelection) => {
    if (roomsSelection.length === 0) return true
    const roomsVal = u?.rooms ?? 0
    return roomsSelection.some((v) =>
      v === 4 ? roomsVal >= 4 : roomsVal === v
    )
  }

  const priceOkForIndex = (u, priceIndex) => {
    const p = Number(u?.price ?? 0)
    const r = priceRanges[priceIndex]
    if (!r) return false
    return p >= r.min && p <= r.max
  }

  const priceCounts = useMemo(() => {
    return priceRanges.map((r) => {
      return baseFiltered.filter((u) => {
        const p = Number(u?.price ?? 0)
        const matchRoom = roomsOk(u, selectedRooms)
        const matchSlider = p >= priceMin && p <= priceMax
        const matchRange = p >= r.min && p <= r.max
        const matchAreaQuick = unitAreaQuickRangesMatch(u, selectedAreaRanges)
        return matchRoom && matchSlider && matchRange && matchAreaQuick
      }).length
    })
  }, [
    baseFiltered,
    priceRanges,
    selectedRooms,
    priceMin,
    priceMax,
    selectedAreaRanges,
  ])

  const roomCountsByValue = useMemo(() => {
    const out = {}
    for (const v of roomsValues) {
      out[v] = baseFiltered.filter((u) => {
        const p = Number(u?.price ?? 0)
        const matchSlider = p >= priceMin && p <= priceMax
        const priceMatches =
          matchSlider &&
          (selectedPriceRanges.length === 0 ||
            selectedPriceRanges.some((idx) => priceOkForIndex(u, idx)))
        const roomsVal = u?.rooms ?? 0
        const matchRoom = v === 4 ? roomsVal >= 4 : roomsVal === v
        const matchAreaQuick = unitAreaQuickRangesMatch(u, selectedAreaRanges)
        return priceMatches && matchRoom && matchAreaQuick
      }).length
    }
    return out
  }, [
    baseFiltered,
    selectedPriceRanges,
    priceRanges,
    priceMin,
    priceMax,
    selectedAreaRanges,
  ])

  const twoLevelCount = useMemo(() => {
    return baseFiltered.filter((u) => {
      const p = Number(u?.price ?? 0)
      const matchSlider = p >= priceMin && p <= priceMax
      const priceMatches =
        matchSlider &&
        (selectedPriceRanges.length === 0 ||
          selectedPriceRanges.some((idx) => priceOkForIndex(u, idx)))
      const matchAreaQuick = unitAreaQuickRangesMatch(u, selectedAreaRanges)
      const isTwoLevel = Number(u?.span_floors ?? 1) >= 2
      return priceMatches && matchAreaQuick && isTwoLevel
    }).length
  }, [baseFiltered, selectedPriceRanges, priceMin, priceMax, selectedAreaRanges])

  /** Счётчики по корзинам площади: все прочие фильтры, без учёта выбранных чекбоксов площади */
  const areaCounts = useMemo(() => {
    return areaRanges.map((range) => {
      return baseFiltered.filter((u) => {
        const area = Number(u.area)
        const p = Number(u?.price ?? 0)
        const matchSlider = p >= priceMin && p <= priceMax
        const priceMatches =
          selectedPriceRanges.length === 0 ||
          selectedPriceRanges.some((idx) => priceOkForIndex(u, idx))
        const matchRoom = roomsOk(u, selectedRooms)
        const inBucket = area >= range.min && area <= range.max
        return matchSlider && priceMatches && matchRoom && inBucket
      }).length
    })
  }, [
    baseFiltered,
    areaRanges,
    priceMin,
    priceMax,
    selectedPriceRanges,
    selectedRooms,
    priceRanges,
  ])

  const complexCountsByName = useMemo(() => {
    const out = {}
    for (const name of uniqueComplexes) {
      out[name] = baseFilteredNoComplex.filter((u) => {
        const p = Number(u?.price ?? 0)
        const matchSlider = p >= priceMin && p <= priceMax
        const pMatches =
          matchSlider &&
          (selectedPriceRanges.length === 0 ||
            selectedPriceRanges.some((idx) => priceOkForIndex(u, idx)))
        const matchRoom = roomsOk(u, selectedRooms)
        const matchAreaQuick = unitAreaQuickRangesMatch(u, selectedAreaRanges)
        const complexName = u?.building?.complex?.name
        return pMatches && matchRoom && matchAreaQuick && complexName === name
      }).length
    }
    return out
  }, [
    baseFilteredNoComplex,
    selectedPriceRanges,
    selectedRooms,
    uniqueComplexes,
    priceRanges,
    priceMin,
    priceMax,
    selectedAreaRanges,
  ])

  const buildingCountsById = useMemo(() => {
    const ids = new Set()
    for (const u of units ?? []) {
      const bid = u?.building?.id
      if (bid) ids.add(bid)
    }
    const out = {}
    for (const bid of ids) {
      out[bid] = baseFilteredNoComplex.filter((u) => {
        const p = Number(u?.price ?? 0)
        const matchSlider = p >= priceMin && p <= priceMax
        const pMatches =
          matchSlider &&
          (selectedPriceRanges.length === 0 ||
            selectedPriceRanges.some((idx) => priceOkForIndex(u, idx)))
        const matchRoom = roomsOk(u, selectedRooms)
        const matchAreaQuick = unitAreaQuickRangesMatch(u, selectedAreaRanges)
        return pMatches && matchRoom && matchAreaQuick && u?.building?.id === bid
      }).length
    }
    return out
  }, [
    units,
    baseFilteredNoComplex,
    selectedPriceRanges,
    selectedRooms,
    priceRanges,
    priceMin,
    priceMax,
    selectedAreaRanges,
  ])

  const handoverCountsByKey = useMemo(() => {
    const out = {}
    for (const opt of handoverOptions) {
      out[opt.key] = baseFilteredNoHandover.filter((u) => {
        const p = Number(u?.price ?? 0)
        const matchSlider = p >= priceMin && p <= priceMax
        const pMatches =
          matchSlider &&
          (selectedPriceRanges.length === 0 ||
            selectedPriceRanges.some((idx) => priceOkForIndex(u, idx)))
        const matchRoom = roomsOk(u, selectedRooms)
        const matchAreaQuick = unitAreaQuickRangesMatch(u, selectedAreaRanges)
        return (
          pMatches &&
          matchRoom &&
          matchAreaQuick &&
          getHandoverKeyForUnit(u) === opt.key
        )
      }).length
    }
    return out
  }, [
    handoverOptions,
    baseFilteredNoHandover,
    priceMin,
    priceMax,
    selectedPriceRanges,
    selectedRooms,
    selectedAreaRanges,
  ])

  const baseFilteredNoPpm = useMemo(() => {
    return (units ?? []).filter((u) => {
      const devName = u?.building?.complex?.developer?.name
      const floorVal = u?.floor ?? 0
      const st = String(u?.status ?? '').toLowerCase()
      const notSold = st !== 'sold' && st !== 'booked' && st !== 'reserved' && st !== 'closed'
      const handoverKey = getHandoverKeyForUnit(u)
      return (
        notSold &&
        (selectedDevelopers.length === 0 || selectedDevelopers.includes(devName)) &&
        unitMatchesComplexBuildingFilter(u, selectedComplexes, selectedBuildingIds) &&
        (selectedHandoverKeys.length === 0 || selectedHandoverKeys.includes(handoverKey)) &&
        (floorFrom == null || floorVal >= floorFrom) &&
        (floorTo == null || floorVal <= floorTo) &&
        unitAreaMatches(u, areaFrom, areaTo)
      )
    })
  }, [
    units,
    selectedDevelopers,
    selectedComplexes,
    selectedBuildingIds,
    selectedHandoverKeys,
    floorFrom,
    floorTo,
    areaFrom,
    areaTo,
  ])

  const ppmCounts = useMemo(() => {
    return ppmRanges.map((r) =>
      baseFilteredNoPpm.filter((u) => {
        const ppm = unitPpm(u)
        if (ppm == null) return false
        const p = Number(u?.price ?? 0)
        const pMatches =
          p >= priceMin &&
          p <= priceMax &&
          (selectedPriceRanges.length === 0 ||
            selectedPriceRanges.some((idx) => priceOkForIndex(u, idx)))
        const matchRoom = roomsOk(u, selectedRooms)
        const matchAreaQuick = unitAreaQuickRangesMatch(u, selectedAreaRanges)
        return pMatches && matchRoom && matchAreaQuick && ppm >= r.min && ppm < r.max
      }).length
    )
  }, [
    baseFilteredNoPpm,
    priceMin,
    priceMax,
    selectedPriceRanges,
    selectedRooms,
    selectedAreaRanges,
  ])

  const togglePpmRange = (idx) => {
    setSelectedPpmRanges((prev) =>
      prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]
    )
  }

  const totalCommission = useMemo(() => {
    return (units ?? []).reduce((sum, u) => {
      const st = String(u?.status ?? '').toLowerCase()
      const notSold = st !== 'sold' && st !== 'booked' && st !== 'reserved' && st !== 'closed'
      if (!notSold) return sum
      const c = calcCommission(u)
      return sum + (Number(c.amount) || 0)
    }, 0)
  }, [units])

  const filtered = useMemo(() => {
    return (units ?? []).filter((u) => {
      const devName = u?.building?.complex?.developer?.name
      const complexName = u?.building?.complex?.name
      const price = Number(u?.price ?? 0)
      const st = String(u?.status ?? '').toLowerCase()
      const notSold = st !== 'sold' && st !== 'booked' && st !== 'reserved' && st !== 'closed'
      const handoverKey = getHandoverKeyForUnit(u)

      const matchPriceSlider = price >= priceMin && price <= priceMax
      const matchPriceRanges =
        selectedPriceRanges.length === 0 ||
        selectedPriceRanges.some((idx) => {
          const r = priceRanges[idx]
          return price >= r.min && price <= r.max
        })

      const matchRooms =
        selectedRooms.length === 0 ||
        selectedRooms.some((v) => {
          if (v === 4) return (u?.rooms ?? 0) >= 4
          return (u?.rooms ?? null) === v
        })

      const matchTwoLevel = !twoLevelOnly || Number(u?.span_floors ?? 1) >= 2

      return (
        notSold &&
        (selectedDevelopers.length === 0 ||
          selectedDevelopers.includes(devName)) &&
        unitMatchesComplexBuildingFilter(u, selectedComplexes, selectedBuildingIds) &&
        (selectedHandoverKeys.length === 0 || selectedHandoverKeys.includes(handoverKey)) &&
        matchPriceSlider &&
        matchPriceRanges &&
        matchRooms &&
        matchTwoLevel &&
        unitMatchesPpmRanges(u, selectedPpmRanges) &&
        (floorFrom == null || (u?.floor ?? 0) >= floorFrom) &&
        (floorTo == null || (u?.floor ?? 0) <= floorTo) &&
        unitAreaMatches(u, areaFrom, areaTo) &&
        unitAreaQuickRangesMatch(u, selectedAreaRanges)
      )
    })
  }, [
    units,
    selectedDevelopers,
    selectedComplexes,
    selectedBuildingIds,
    selectedHandoverKeys,
    selectedPpmRanges,
    priceMin,
    priceMax,
    selectedPriceRanges,
    selectedRooms,
    twoLevelOnly,
    floorFrom,
    floorTo,
    areaFrom,
    areaTo,
    selectedAreaRanges,
  ])

  function toggleDeveloper(name) {
    setSelectedDevelopers((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
    )
  }

  /** Весь ЖК: при включении снимаем отдельные литеры этого ЖК; при выключении — тоже. */
  function toggleComplexWhole(complexName, buildingIdsInComplex, turnOn) {
    const idSet = new Set(buildingIdsInComplex)
    if (turnOn) {
      setSelectedComplexes((p) => (p.includes(complexName) ? p : [...p, complexName]))
      setSelectedBuildingIds((p) => p.filter((id) => !idSet.has(id)))
    } else {
      setSelectedComplexes((p) => p.filter((x) => x !== complexName))
      setSelectedBuildingIds((p) => p.filter((id) => !idSet.has(id)))
    }
  }

  function toggleBuildingUnderComplex(complexName, buildingId, allIdsInComplex) {
    const idSet = new Set(allIdsInComplex)
    if (selectedComplexesRef.current.includes(complexName)) {
      setSelectedComplexes((c) => c.filter((x) => x !== complexName))
      setSelectedBuildingIds((b) => {
        const without = b.filter((id) => !idSet.has(id))
        const add = allIdsInComplex.filter((id) => id !== buildingId)
        return [...new Set([...without, ...add])]
      })
      return
    }
    setSelectedBuildingIds((b) =>
      b.includes(buildingId) ? b.filter((x) => x !== buildingId) : [...b, buildingId]
    )
  }

  function toggleRoom(room) {
    setSelectedRooms((prev) =>
      prev.includes(room) ? prev.filter((x) => x !== room) : [...prev, room]
    )
  }

  function togglePriceRange(idx) {
    setSelectedPriceRanges((prev) =>
      prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]
    )
  }

  function toggleAreaRange(range) {
    setSelectedAreaRanges((prev) => {
      const exists = prev.find((r) => r.label === range.label)
      if (exists) {
        return prev.filter((r) => r.label !== range.label)
      }
      return [...prev, range]
    })
  }

  function toggleHandover(key) {
    setSelectedHandoverKeys((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    )
  }

  function toggleSelectedUnit(unitId) {
    setSelectedUnits((prev) =>
      prev.includes(unitId) ? prev.filter((x) => x !== unitId) : [...prev, unitId]
    )
  }

  function selectAllFiltered() {
    setSelectedUnits((prev) => {
      const set = new Set(prev)
      for (const u of filtered) set.add(u.id)
      return Array.from(set)
    })
  }

  function unselectAllFiltered() {
    const filteredIds = new Set(filtered.map((u) => u.id))
    setSelectedUnits((prev) => prev.filter((id) => !filteredIds.has(id)))
  }

  async function createSelection() {
    if (!selectedUnits.length) {
      alert('Сначала выберите квартиры в карточках')
      return
    }

    const title = window.prompt('Название подборки')?.trim()
    if (!title) return
    const clientName = window.prompt('Имя клиента')?.trim()

    try {
      setCreatingCollection(true)
      const res = await fetch('/api/collections/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          clientName: clientName || null,
          selectedUnits,
          createdBy: user?.id ?? null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body?.error || 'Не удалось создать подборку')
      }

      const link = `${window.location.origin}/collections/${body.token}`
      await navigator.clipboard.writeText(link)
      alert(`Ссылка скопирована: ${link}`)
      setSelectedUnits([])
    } catch (e) {
      alert(e?.message || 'Ошибка создания подборки')
    } finally {
      setCreatingCollection(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <CatalogTabs />

      <div className="px-4 py-4">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-gray-900">Квартиры</h1>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`rounded-lg border p-2 transition ${
                viewMode === 'grid'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
              aria-label="Grid"
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
              aria-label="List"
            >
              <List size={20} />
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
          <div className="text-sm text-gray-700">
            Выбрано квартир: <span className="font-semibold">{selectedUnits.length}</span>
          </div>
          <button
            type="button"
            onClick={selectAllFiltered}
            disabled={filtered.length === 0}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Выбрать все по фильтрам ({filtered.length})
          </button>
          <button
            type="button"
            onClick={unselectAllFiltered}
            disabled={filtered.length === 0}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Снять все по фильтрам
          </button>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            disabled={selectedUnits.length === 0}
            className="rounded-xl border border-blue-600 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            🛒 Корзина ({selectedUnits.length})
          </button>
          <button
            type="button"
            onClick={createSelection}
            disabled={creatingCollection || selectedUnits.length === 0}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {creatingCollection ? 'Создаём…' : 'Создать подборку'}
          </button>
          {selectedUnits.length > 0 ? (
            <button
              type="button"
              onClick={() => setSelectedUnits([])}
              className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Сбросить выбор
            </button>
          ) : null}
        </div>

        <div className="flex gap-6">
          <div className="w-[300px] shrink-0 space-y-4">
            <div className="flex items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
              </span>
              <div className="min-w-0">
                <div className="text-sm text-gray-600">Общее вознаграждение сейчас</div>
                <div className="text-xl font-bold text-emerald-700">
                  {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(totalCommission)} ₽
                </div>
              </div>
            </div>
            <FiltersSidebar
            uniqueDevelopers={uniqueDevelopers}
            complexBuildingsTree={complexBuildingsTree}
            selectedDevelopers={selectedDevelopers}
            selectedComplexes={selectedComplexes}
            selectedBuildingIds={selectedBuildingIds}
            onToggleDeveloper={toggleDeveloper}
            onToggleComplexWhole={toggleComplexWhole}
            onToggleBuilding={toggleBuildingUnderComplex}
            priceMin={priceMin}
            priceMax={priceMax}
            onPriceMinChange={setPriceMin}
            onPriceMaxChange={setPriceMax}
            absMin={ABS_MIN}
            absMax={ABS_MAX}
            priceRanges={priceRanges}
            selectedPriceRanges={selectedPriceRanges}
            onTogglePriceRange={togglePriceRange}
            priceCounts={priceCounts}
            selectedRooms={selectedRooms}
            onToggleRoom={toggleRoom}
            roomCountsByValue={roomCountsByValue}
            twoLevelOnly={twoLevelOnly}
            onToggleTwoLevel={() => setTwoLevelOnly((v) => !v)}
            twoLevelCount={twoLevelCount}
            complexCountsByName={complexCountsByName}
            buildingCountsById={buildingCountsById}
            handoverOptions={handoverOptions}
            selectedHandoverKeys={selectedHandoverKeys}
            handoverCountsByKey={handoverCountsByKey}
            onToggleHandover={toggleHandover}
            ppmRanges={ppmRanges}
            selectedPpmRanges={selectedPpmRanges}
            ppmCounts={ppmCounts}
            onTogglePpmRange={togglePpmRange}
            floorFrom={floorFrom}
            floorTo={floorTo}
            onFloorFromChange={setFloorFrom}
            onFloorToChange={setFloorTo}
            areaFrom={areaFrom}
            areaTo={areaTo}
            onAreaFromChange={setAreaFrom}
            onAreaToChange={setAreaTo}
            areaRanges={areaRanges}
            areaCounts={areaCounts}
            selectedAreaRanges={selectedAreaRanges}
            onToggleAreaRange={toggleAreaRange}
          />
          </div>

          <div className="flex-1">
            {busy ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-500"></div>
                <span className="ml-3 text-sm text-gray-500">Загрузка квартир...</span>
              </div>
            ) : error ? (
              <p className="text-sm text-rose-600">{error}</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-gray-500">
                Ничего не найдено по фильтрам
              </p>
            ) : (
              <div
                className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-3 gap-4'
                    : 'flex flex-col gap-4'
                }
              >
                {filtered.map((u) => (
                  <div
                    key={u.id}
                    className={`rounded-2xl p-1 ${
                      selectedUnits.includes(u.id)
                        ? 'ring-2 ring-blue-500 ring-offset-1'
                        : 'ring-1 ring-transparent'
                    }`}
                  >
                    <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg bg-white px-2 py-1 text-sm text-gray-700 shadow-sm">
                      <input
                        type="checkbox"
                        checked={selectedUnits.includes(u.id)}
                        onChange={() => toggleSelectedUnit(u.id)}
                      />
                      В подборку
                    </label>
                    <div onClick={() => setModalUnit(u)} className="cursor-pointer">
                      <ApartmentCard unit={u} listView={viewMode === 'list'} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {modalUnit && (
        <ApartmentModal
          unit={modalUnit}
          onClose={() => setModalUnit(null)}
          onAddToCollection={toggleSelectedUnit}
          isSelected={selectedUnits.includes(modalUnit.id)}
        />
      )}

      {cartOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setCartOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-bold text-gray-900">
                Корзина подборки ({selectedUnits.length})
              </h2>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
              {selectedUnits.length === 0 ? (
                <p className="py-8 text-center text-gray-500">
                  Корзина пуста. Добавьте квартиры галочками.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {units
                    .filter((u) => selectedUnits.includes(u.id))
                    .map((u) => {
                      const c = calcCommission(u)
                      return (
                      <li key={u.id} className="flex items-center gap-3 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900">
                            {u.building?.complex?.name} · {u.building?.name} · №{u.number ?? '—'}
                          </div>
                          <div className="text-xs text-gray-500">
                            {u.is_commercial ? 'Коммерция' : `${u.rooms ?? '?'}к`}
                            {u.area ? ` · ${u.area} м²` : ''}
                            {u.floor ? ` · ${u.floor} эт.` : ''}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-gray-900">
                            {u.price ? `${Number(u.price).toLocaleString('ru-RU')} ₽` : '—'}
                          </div>
                          {c.amount != null && (
                            <div className="text-xs text-blue-700">
                              Вознаграждение: {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(c.amount)} ₽
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleSelectedUnit(u.id)}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
                          title="Убрать"
                        >
                          ✕
                        </button>
                      </li>
                      )
                    })}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4">
              <div className="text-sm text-gray-700">
                Всего:{' '}
                <span className="font-semibold">
                  {units
                    .filter((u) => selectedUnits.includes(u.id))
                    .reduce((sum, u) => sum + (Number(u.price) || 0), 0)
                    .toLocaleString('ru-RU')} ₽
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedUnits([])}
                  disabled={selectedUnits.length === 0}
                  className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Очистить
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCartOpen(false)
                    createSelection()
                  }}
                  disabled={creatingCollection || selectedUnits.length === 0}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {creatingCollection ? 'Создаём…' : 'Создать подборку'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
