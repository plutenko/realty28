import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { Building2, LayoutGrid, List, Map as MapIcon, SquareStack } from 'lucide-react'
import { useAuth } from '../lib/authContext'
import CatalogTabs from '../components/CatalogTabs'
import { fetchComplexesFromApi, fetchUnitsFromApi } from '../lib/fetchUnitsFromApi'
import { formatComplexName, formatName, getComplexDeveloper, sanitizeComplexesPayload, sortBuildingsByName } from '../lib/complexes'
import FiltersSidebarLab from '../components/apartments/lab/FiltersSidebarLab'
import ApartmentCardLab from '../components/apartments/lab/ApartmentCardLab'
import SelectionBar from '../components/apartments/lab/SelectionBar'
import ActiveFilterChips from '../components/apartments/lab/ActiveFilterChips'
import SortDropdown, { applySort } from '../components/apartments/lab/SortDropdown'
import ShareCollectionModal from '../components/apartments/lab/ShareCollectionModal'
import { calcCommission } from '../lib/format'
import ApartmentModal from '../components/apartments/ApartmentModal'
import CollectionMetaModal from '../components/apartments/CollectionMetaModal'
import ComplexCard from '../components/apartments/ComplexCard'
import BuildingChessboard, { mapUnitsToChessboardApartments } from '../components/BuildingChessboard'

const YandexMap = dynamic(() => import('../components/YandexMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[480px] items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-500">
      Загрузка карты…
    </div>
  ),
})

const ABS_MIN = 0
const ABS_MAX = 50000000

function formatMln(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '0'
  return `${(n / 1_000_000).toFixed(0)} млн ₽`
}

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

export default function ApartmentsLabPage() {
  const router = useRouter()
  const { user, profile, loading: authLoading } = useAuth()
  const [units, setUnits] = useState([])
  const [complexes, setComplexes] = useState([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const [viewMode, setViewMode] = useState('grid')
  const [pageView, setPageView] = useState('units')
  const [selectedComplexId, setSelectedComplexId] = useState(null)
  const [selectedBuildingId, setSelectedBuildingId] = useState(null)
  const [mapPicked, setMapPicked] = useState(null) // { complex, building } | null

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
  const [sortBy, setSortBy] = useState('default')
  const [selectedUnits, setSelectedUnits] = useState([])
  const [modalUnit, setModalUnit] = useState(null)
  const [creatingCollection, setCreatingCollection] = useState(false)
  const [collectionModalOpen, setCollectionModalOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [shareLink, setShareLink] = useState(null)
  const [shareTitle, setShareTitle] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem('apartmentsViewMode')
    if (saved === 'grid' || saved === 'list') setViewMode(saved)
    const savedPage = window.localStorage.getItem('apartmentsPageView')
    if (savedPage === 'units' || savedPage === 'complexes' || savedPage === 'map') setPageView(savedPage)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('apartmentsViewMode', viewMode)
  }, [viewMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('apartmentsPageView', pageView)
  }, [pageView])

  // Сбрасываем раскрытую шахматку при выходе из режима «ЖК»
  useEffect(() => {
    if (pageView !== 'complexes' && (selectedComplexId || selectedBuildingId)) {
      setSelectedComplexId(null)
      setSelectedBuildingId(null)
    }
    if (pageView !== 'map' && mapPicked) {
      setMapPicked(null)
    }
  }, [pageView, selectedComplexId, selectedBuildingId, mapPicked])

  // URL ↔ state: читаем при первом готовом router.isReady, дальше пишем в URL на изменения
  const urlInitialized = useRef(false)
  useEffect(() => {
    if (!router.isReady || urlInitialized.current) return
    const q = router.query
    if (q.view === 'complexes' || q.view === 'units' || q.view === 'map') setPageView(q.view)
    if (typeof q.complex === 'string' && q.complex) setSelectedComplexId(q.complex)
    if (typeof q.building === 'string' && q.building) setSelectedBuildingId(q.building)
    urlInitialized.current = true
  }, [router.isReady, router.query])

  useEffect(() => {
    if (!urlInitialized.current) return
    const next = {}
    if (pageView !== 'units') next.view = pageView
    if (selectedComplexId) next.complex = selectedComplexId
    if (selectedBuildingId) next.building = selectedBuildingId
    const sameView = (router.query.view ?? null) === (next.view ?? null)
    const sameComplex = (router.query.complex ?? null) === (next.complex ?? null)
    const sameBuilding = (router.query.building ?? null) === (next.building ?? null)
    if (sameView && sameComplex && sameBuilding) return
    router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageView, selectedComplexId, selectedBuildingId])

  useEffect(() => {
    async function load() {
      setBusy(true)
      setError('')

      try {
        const [unitsRes, complexesRes] = await Promise.all([
          fetchUnitsFromApi(),
          fetchComplexesFromApi(),
        ])
        if (unitsRes.error) {
          setError(unitsRes.error.message || 'Ошибка загрузки')
          setUnits([])
        } else {
          setUnits(unitsRes.data ?? [])
        }
        if (!complexesRes.error) {
          setComplexes(sanitizeComplexesPayload(complexesRes.data ?? []))
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
    const developerByComplex = new Map()
    for (const u of units ?? []) {
      const cn = u?.building?.complex?.name
      const bid = u?.building?.id
      const bn = u?.building?.name
      const addr = u?.building?.address
      const dev = u?.building?.complex?.developer?.name
      if (!cn || !bid) continue
      if (!byComplex.has(cn)) byComplex.set(cn, new Map())
      if (dev && !developerByComplex.has(cn)) developerByComplex.set(cn, dev)
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
        return {
          complexName,
          developerName: developerByComplex.get(complexName) || null,
          buildings,
        }
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

  const baseFilteredNoDeveloper = useMemo(() => {
    return (units ?? []).filter((u) => {
      const floorVal = u?.floor ?? 0
      const st = String(u?.status ?? '').toLowerCase()
      const notSold = st !== 'sold' && st !== 'booked' && st !== 'reserved' && st !== 'closed'
      const handoverKey = getHandoverKeyForUnit(u)
      return (
        notSold &&
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
    selectedComplexes,
    selectedBuildingIds,
    selectedHandoverKeys,
    selectedPpmRanges,
    floorFrom,
    floorTo,
    areaFrom,
    areaTo,
  ])

  const developerCountsByName = useMemo(() => {
    const out = {}
    for (const name of uniqueDevelopers) {
      out[name] = baseFilteredNoDeveloper.filter((u) => {
        const p = Number(u?.price ?? 0)
        const matchSlider = p >= priceMin && p <= priceMax
        const pMatches =
          matchSlider &&
          (selectedPriceRanges.length === 0 ||
            selectedPriceRanges.some((idx) => priceOkForIndex(u, idx)))
        const matchRoom = roomsOk(u, selectedRooms)
        const matchAreaQuick = unitAreaQuickRangesMatch(u, selectedAreaRanges)
        const matchTwoLevel = !twoLevelOnly || Number(u?.span_floors ?? 1) >= 2
        return (
          pMatches &&
          matchRoom &&
          matchAreaQuick &&
          matchTwoLevel &&
          u?.building?.complex?.developer?.name === name
        )
      }).length
    }
    return out
  }, [
    baseFilteredNoDeveloper,
    uniqueDevelopers,
    priceRanges,
    priceMin,
    priceMax,
    selectedPriceRanges,
    selectedRooms,
    selectedAreaRanges,
    twoLevelOnly,
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

  const sortedFiltered = useMemo(() => applySort(filtered, sortBy), [filtered, sortBy])

  const filteredIds = useMemo(() => new Set(filtered.map((u) => u.id)), [filtered])

  const hasActiveFilters = useMemo(() => {
    return (
      selectedDevelopers.length > 0 ||
      selectedComplexes.length > 0 ||
      selectedBuildingIds.length > 0 ||
      selectedHandoverKeys.length > 0 ||
      selectedPpmRanges.length > 0 ||
      selectedPriceRanges.length > 0 ||
      selectedRooms.length > 0 ||
      selectedAreaRanges.length > 0 ||
      twoLevelOnly ||
      priceMin > ABS_MIN ||
      priceMax < ABS_MAX ||
      floorFrom != null ||
      floorTo != null ||
      Boolean(areaFrom) ||
      Boolean(areaTo)
    )
  }, [
    selectedDevelopers,
    selectedComplexes,
    selectedBuildingIds,
    selectedHandoverKeys,
    selectedPpmRanges,
    selectedPriceRanges,
    selectedRooms,
    selectedAreaRanges,
    twoLevelOnly,
    priceMin,
    priceMax,
    floorFrom,
    floorTo,
    areaFrom,
    areaTo,
  ])

  const activeFilterChips = useMemo(() => {
    const chips = []
    selectedRooms.forEach((v) => {
      const label = v === 0 ? 'Студии' : v === 4 ? '4+ комнаты' : `${v}к`
      chips.push({
        key: `room-${v}`,
        label,
        onRemove: () => setSelectedRooms((prev) => prev.filter((r) => r !== v)),
      })
    })
    if (twoLevelOnly) {
      chips.push({
        key: 'twolevel',
        label: 'Двухуровневые',
        onRemove: () => setTwoLevelOnly(false),
      })
    }
    selectedPriceRanges.forEach((idx) => {
      const r = priceRanges[idx]
      if (!r) return
      chips.push({
        key: `price-${idx}`,
        label: r.label,
        onRemove: () => setSelectedPriceRanges((prev) => prev.filter((i) => i !== idx)),
      })
    })
    selectedHandoverKeys.forEach((key) => {
      const opt = handoverOptions.find((o) => o.key === key)
      chips.push({
        key: `handover-${key}`,
        label: opt?.label ?? key,
        onRemove: () => setSelectedHandoverKeys((prev) => prev.filter((k) => k !== key)),
      })
    })
    selectedPpmRanges.forEach((idx) => {
      const r = ppmRanges[idx]
      if (!r) return
      chips.push({
        key: `ppm-${idx}`,
        label: r.label,
        onRemove: () => setSelectedPpmRanges((prev) => prev.filter((i) => i !== idx)),
      })
    })
    selectedAreaRanges.forEach((r) => {
      chips.push({
        key: `area-${r.label}`,
        label: r.label,
        onRemove: () => setSelectedAreaRanges((prev) => prev.filter((x) => x.label !== r.label)),
      })
    })
    if (priceMin > ABS_MIN || priceMax < ABS_MAX) {
      chips.push({
        key: 'price-range',
        label: `Цена: ${formatMln(priceMin)}–${formatMln(priceMax)}`,
        onRemove: () => {
          setPriceMin(ABS_MIN)
          setPriceMax(ABS_MAX)
        },
      })
    }
    if (floorFrom != null || floorTo != null) {
      chips.push({
        key: 'floor-range',
        label: `Этаж: ${floorFrom ?? '…'}–${floorTo ?? '…'}`,
        onRemove: () => {
          setFloorFrom(null)
          setFloorTo(null)
        },
      })
    }
    if (areaFrom || areaTo) {
      chips.push({
        key: 'area-range',
        label: `Площадь: ${areaFrom || '…'}–${areaTo || '…'} м²`,
        onRemove: () => {
          setAreaFrom('')
          setAreaTo('')
        },
      })
    }
    selectedDevelopers.forEach((name) => {
      chips.push({
        key: `dev-${name}`,
        label: name,
        onRemove: () => setSelectedDevelopers((prev) => prev.filter((d) => d !== name)),
      })
    })
    selectedComplexes.forEach((name) => {
      chips.push({
        key: `complex-${name}`,
        label: name,
        onRemove: () => setSelectedComplexes((prev) => prev.filter((c) => c !== name)),
      })
    })
    selectedBuildingIds.forEach((id) => {
      chips.push({
        key: `bld-${id}`,
        label: 'Корпус',
        onRemove: () => setSelectedBuildingIds((prev) => prev.filter((b) => b !== id)),
      })
    })
    return chips
  }, [
    selectedRooms,
    twoLevelOnly,
    selectedPriceRanges,
    priceRanges,
    selectedHandoverKeys,
    handoverOptions,
    selectedPpmRanges,
    ppmRanges,
    selectedAreaRanges,
    priceMin,
    priceMax,
    floorFrom,
    floorTo,
    areaFrom,
    areaTo,
    selectedDevelopers,
    selectedComplexes,
    selectedBuildingIds,
  ])

  /** Кол-во подходящих под все фильтры квартир в каждом корпусе */
  const matchedByBuilding = useMemo(() => {
    const out = {}
    for (const u of filtered) {
      const bid = u?.building?.id
      if (!bid) continue
      out[bid] = (out[bid] ?? 0) + 1
    }
    return out
  }, [filtered])

  /** Кол-во доступных (не sold/booked/reserved/closed) квартир в корпусе — общее «из 88» */
  const availableByBuilding = useMemo(() => {
    const out = {}
    for (const u of units ?? []) {
      const bid = u?.building?.id
      if (!bid) continue
      out[bid] = (out[bid] ?? 0) + 1
    }
    return out
  }, [units])

  /** ЖК, у которых хотя бы 1 подходящая квартира под фильтр (или все, если фильтра нет) */
  /** Пины корпусов для карты: только корпуса с заполненными координатами и подходящими квартирами */
  const mapMarkers = useMemo(() => {
    if (!complexes?.length) return []
    const out = []
    for (const c of complexes) {
      for (const b of c.buildings ?? []) {
        const lat = Number(b?.lat)
        const lng = Number(b?.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        const matched = matchedByBuilding[b.id] ?? 0
        const available = availableByBuilding[b.id] ?? 0
        if (hasActiveFilters ? matched <= 0 : available <= 0) continue
        out.push({
          id: b.id,
          complex: c,
          building: b,
          lat,
          lng,
          matched,
          available,
        })
      }
    }
    return out
  }, [complexes, hasActiveFilters, matchedByBuilding, availableByBuilding])

  /** Плоский список карточек корпусов: 1 карточка = 1 building. Скрываем те, у которых
   *  при активных фильтрах 0 совпадений, иначе — те, у которых 0 доступных квартир. */
  const visibleBuildingCards = useMemo(() => {
    if (!complexes?.length) return []
    const items = []
    for (const c of complexes) {
      const buildings = [...(c?.buildings ?? [])].sort(sortBuildingsByName)
      for (const b of buildings) {
        const matched = matchedByBuilding[b.id] ?? 0
        const available = availableByBuilding[b.id] ?? 0
        if (hasActiveFilters) {
          if (matched <= 0) continue
        } else if (available <= 0) {
          continue
        }
        items.push({ complex: c, building: b, matched, available })
      }
    }
    return items
  }, [complexes, hasActiveFilters, availableByBuilding, matchedByBuilding])

  const selectedComplex = useMemo(() => {
    if (!selectedComplexId) return null
    return complexes.find((c) => c.id === selectedComplexId) ?? null
  }, [complexes, selectedComplexId])

  /** Корпуса выбранного ЖК с available > 0 (отсортированные) — для табов выбора корпуса в шахматке */
  const selectedComplexBuildings = useMemo(() => {
    if (!selectedComplex) return []
    return [...(selectedComplex.buildings ?? [])]
      .filter((b) => (availableByBuilding[b.id] ?? 0) > 0)
      .sort(sortBuildingsByName)
  }, [selectedComplex, availableByBuilding])

  const selectedBuilding = useMemo(() => {
    if (!selectedComplex || !selectedBuildingId) return null
    return (selectedComplex.buildings ?? []).find((b) => b.id === selectedBuildingId) ?? null
  }, [selectedComplex, selectedBuildingId])

  const chessboardApartments = useMemo(() => {
    if (!selectedBuilding) return []
    const all = selectedBuilding.units ?? []
    if (!hasActiveFilters) return mapUnitsToChessboardApartments(all)
    // При активном фильтре в шахматке остаются sold/booked/reserved/closed
    // (визуальный контекст дома) + available только те, что попали под фильтр.
    const filteredUnits = all.filter((u) => {
      const s = String(u?.status ?? 'available').toLowerCase()
      if (s === 'sold' || s === 'booked' || s === 'reserved' || s === 'closed') return true
      return filteredIds.has(u.id)
    })
    return mapUnitsToChessboardApartments(filteredUnits)
  }, [selectedBuilding, hasActiveFilters, filteredIds])

  function openBuildingChessboard(c, b) {
    if (!c || !b) return
    setSelectedComplexId(c.id)
    setSelectedBuildingId(b.id)
  }

  /** Открыть шахматку конкретного корпуса (с переключением в режим «ЖК») */
  function openChessboardFromMap(c, b) {
    if (!c || !b) return
    setPageView('complexes')
    setSelectedComplexId(c.id)
    setSelectedBuildingId(b.id)
    setMapPicked(null)
  }

  function closeComplexChessboard() {
    setSelectedComplexId(null)
    setSelectedBuildingId(null)
  }

  function openUnitFromChessboard(apt) {
    if (!apt?.id) return
    const fromUnits = (units ?? []).find((u) => u.id === apt.id)
    if (fromUnits) {
      setModalUnit(fromUnits)
      return
    }
    if (!selectedComplex || !selectedBuilding) return
    const dev = getComplexDeveloper(selectedComplex)
    const raw = (selectedBuilding.units ?? []).find((u) => u.id === apt.id) || {}
    setModalUnit({
      ...raw,
      building: {
        id: selectedBuilding.id,
        name: selectedBuilding.name,
        address: selectedBuilding.address,
        floors: selectedBuilding.floors,
        units_per_floor: selectedBuilding.units_per_floor,
        units_per_entrance: selectedBuilding.units_per_entrance,
        handover_status: selectedBuilding.handover_status,
        handover_quarter: selectedBuilding.handover_quarter,
        handover_year: selectedBuilding.handover_year,
        complex: {
          id: selectedComplex.id,
          name: selectedComplex.name,
          website_url: selectedComplex.website_url,
          realtor_commission_type: selectedComplex.realtor_commission_type,
          realtor_commission_value: selectedComplex.realtor_commission_value,
          developer: dev,
        },
      },
    })
  }

  function resetAllFilters() {
    setSelectedDevelopers([])
    setSelectedComplexes([])
    setSelectedBuildingIds([])
    setSelectedHandoverKeys([])
    setSelectedPpmRanges([])
    setSelectedPriceRanges([])
    setSelectedRooms([])
    setSelectedAreaRanges([])
    setTwoLevelOnly(false)
    setPriceMin(ABS_MIN)
    setPriceMax(ABS_MAX)
    setFloorFrom(null)
    setFloorTo(null)
    setAreaFrom('')
    setAreaTo('')
  }

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

  function createSelection() {
    if (!selectedUnits.length) {
      alert('Сначала выберите квартиры в карточках')
      return
    }

    const MAX_UNITS = 20
    if (selectedUnits.length > MAX_UNITS) {
      alert(`В подборке максимум ${MAX_UNITS} квартир, а вы выбрали ${selectedUnits.length}. Снимите лишние и попробуйте снова — клиенту проще смотреть отобранные варианты.`)
      return
    }

    setCollectionModalOpen(true)
  }

  async function submitNewCollection(values) {
    try {
      setCreatingCollection(true)
      const res = await fetch('/api/collections/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: values.title,
          clientName: values.clientName,
          showComplexName: values.showComplexName,
          showDeveloperName: values.showDeveloperName,
          showAddress: values.showAddress,
          selectedUnits,
          createdBy: user?.id ?? null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body?.error || 'Не удалось создать подборку')
      }

      const publicHost = process.env.NEXT_PUBLIC_COLLECTION_HOST
      const baseUrl = publicHost ? `https://${publicHost}` : window.location.origin
      const link = `${baseUrl}/collections/${body.token}`
      try {
        await navigator.clipboard.writeText(link)
      } catch {
        // не критично — модаль покажет ссылку и позволит скопировать
      }
      setShareLink(link)
      setShareTitle(values.title || '')
      setSelectedUnits([])
      setCollectionModalOpen(false)
    } catch (e) {
      alert(e?.message || 'Ошибка создания подборки')
    } finally {
      setCreatingCollection(false)
    }
  }

  if (!authLoading && profile?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 text-center">
        <div className="rounded-xl bg-white p-8 shadow">
          <div className="text-2xl">🔒</div>
          <div className="mt-2 text-base font-semibold text-gray-900">Доступ ограничен</div>
          <div className="mt-1 text-sm text-gray-600">
            Лабораторная страница доступна только администраторам.
          </div>
          <a
            href="/apartments"
            className="mt-4 inline-block rounded-lg border border-blue-500 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            Перейти на /apartments
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
        🧪 Лабораторная версия каталога. Изменения здесь не влияют на боевую страницу{' '}
        <a href="/apartments" className="underline">/apartments</a>.
      </div>
      <CatalogTabs>
        <div className="hidden items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 sm:flex">
          <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-[11px] text-gray-600">Вознаграждение в рынке</div>
            <div className="text-sm font-bold text-emerald-700">
              {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(totalCommission)} ₽
            </div>
          </div>
        </div>
      </CatalogTabs>

      <div className="px-4 py-4 pb-32">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
            <div className="text-sm text-gray-700">
              Найдено: <span className="font-semibold">{filtered.length}</span>
            </div>
            <button
              type="button"
              onClick={selectAllFiltered}
              disabled={filtered.length === 0}
              className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Выбрать все по фильтрам ({filtered.length})
            </button>
            {activeFilterChips.length > 0 ? (
              <button
                type="button"
                onClick={resetAllFilters}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Сбросить все фильтры ({activeFilterChips.length})
              </button>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {pageView === 'units' ? (
              <SortDropdown value={sortBy} onChange={setSortBy} />
            ) : null}
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`rounded-lg border p-2 transition ${
                viewMode === 'grid'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              }`}
              aria-label="Grid"
            >
              <LayoutGrid size={18} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`rounded-lg border p-2 transition ${
                viewMode === 'list'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              }`}
              aria-label="List"
            >
              <List size={18} />
            </button>
          </div>
        </div>


        <div className="flex gap-6">
          <div className="w-[300px] shrink-0 space-y-4">
            <div className="flex rounded-xl border border-gray-200 bg-white p-1">
              <SegBtn
                active={pageView === 'units'}
                onClick={() => setPageView('units')}
                icon={<SquareStack size={16} />}
                label="Квартиры"
              />
              <SegBtn
                active={pageView === 'complexes'}
                onClick={() => setPageView('complexes')}
                icon={<Building2 size={16} />}
                label="ЖК"
              />
              <SegBtn
                active={pageView === 'map'}
                onClick={() => setPageView('map')}
                icon={<MapIcon size={16} />}
                label="Карта"
              />
            </div>
            <FiltersSidebarLab
            uniqueDevelopers={uniqueDevelopers}
            developerCountsByName={developerCountsByName}
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

          <div className="min-w-0 flex-1">
            {pageView === 'units' ? (
              busy ? (
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
                  {sortedFiltered.map((u) => (
                    <ApartmentCardLab
                      key={u.id}
                      unit={u}
                      selected={selectedUnits.includes(u.id)}
                      onToggleSelect={toggleSelectedUnit}
                      onOpenDetails={() => setModalUnit(u)}
                      listView={viewMode === 'list'}
                    />
                  ))}
                </div>
              )
            ) : pageView === 'map' ? (
              <MapView
                busy={busy}
                markers={mapMarkers}
                hasFilters={hasActiveFilters}
                picked={mapPicked}
                onPin={(m) => setMapPicked({ complex: m.complex, building: m.building })}
                onClosePopup={() => setMapPicked(null)}
                onOpenChessboard={openChessboardFromMap}
              />
            ) : busy ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-500"></div>
                <span className="ml-3 text-sm text-gray-500">Загрузка ЖК...</span>
              </div>
            ) : selectedComplex && selectedBuilding ? (
              <div className="rounded-2xl border border-gray-200 bg-white">
                <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3">
                  <button
                    type="button"
                    onClick={closeComplexChessboard}
                    className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-800 transition hover:bg-gray-300"
                  >
                    ← К списку ЖК
                  </button>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-gray-900">
                      {formatComplexName(selectedComplex.name)}
                    </h2>
                    <p className="truncate text-xs text-gray-500">
                      {formatName(getComplexDeveloper(selectedComplex)?.name || '')}
                    </p>
                  </div>
                  {selectedComplexBuildings.length > 1 ? (
                    <div className="ml-auto flex flex-wrap gap-1">
                      {selectedComplexBuildings.map((b) => {
                        const matched = matchedByBuilding[b.id] ?? 0
                        const available = availableByBuilding[b.id] ?? 0
                        const counterTxt = hasActiveFilters
                          ? `${matched}/${available}`
                          : `${available}`
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => setSelectedBuildingId(b.id)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                              b.id === selectedBuildingId
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {formatName(b.name) || 'Корпус'} <span className="opacity-70">({counterTxt})</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>

                <div className="p-4">
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
                    apartments={chessboardApartments}
                    floorsCount={selectedBuilding.floors ?? 0}
                    unitsPerFloor={selectedBuilding.units_per_floor ?? 4}
                    unitsPerEntrance={
                      Array.isArray(selectedBuilding.units_per_entrance)
                        ? selectedBuilding.units_per_entrance
                        : null
                    }
                    floorPlanByFloor={selectedBuilding.floorPlanByFloor ?? {}}
                    onUnitClick={openUnitFromChessboard}
                  />
                </div>
              </div>
            ) : visibleBuildingCards.length === 0 ? (
              <p className="text-sm text-gray-500">
                {hasActiveFilters
                  ? 'Нет домов с подходящими под фильтр квартирами'
                  : 'Нет домов с доступными квартирами'}
              </p>
            ) : (
              <div
                className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'
                    : 'flex flex-col gap-4'
                }
              >
                {visibleBuildingCards.map(({ complex: c, building: b, matched, available }) => (
                  <ComplexCard
                    key={b.id}
                    complex={c}
                    building={b}
                    filteredIds={filteredIds}
                    matched={matched}
                    available={available}
                    hasFilters={hasActiveFilters}
                    listView={viewMode === 'list'}
                    onOpen={() => openBuildingChessboard(c, b)}
                  />
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

      {collectionModalOpen && (
        <CollectionMetaModal
          mode="create"
          onClose={() => setCollectionModalOpen(false)}
          onSubmit={submitNewCollection}
          submitting={creatingCollection}
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
                  disabled={creatingCollection || selectedUnits.length === 0 || selectedUnits.length > 20}
                  className="rounded-xl border border-blue-500 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
                  title={selectedUnits.length > 20 ? `Максимум 20 квартир в подборке, выбрано ${selectedUnits.length}` : 'Создать подборку'}
                >
                  {creatingCollection ? 'Создаём…' : selectedUnits.length > 20 ? `Лимит: 20 (у вас ${selectedUnits.length})` : 'Создать подборку'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <SelectionBar
        selectedUnits={selectedUnits}
        units={units}
        onCreateCollection={createSelection}
        onClearAll={() => setSelectedUnits([])}
        onRemoveUnit={toggleSelectedUnit}
        creating={creatingCollection}
      />

      {shareLink ? (
        <ShareCollectionModal
          link={shareLink}
          title={shareTitle}
          onClose={() => setShareLink(null)}
        />
      ) : null}
    </div>
  )
}

function MapView({ busy, markers, hasFilters, picked, onPin, onClosePopup, onOpenChessboard }) {
  const ymapMarkers = useMemo(
    () =>
      markers.map((m) => ({
        id: m.id,
        lat: m.lat,
        lng: m.lng,
        onClick: () => onPin(m),
      })),
    [markers, onPin]
  )

  if (busy) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-500"></div>
        <span className="ml-3 text-sm text-gray-500">Загрузка карты...</span>
      </div>
    )
  }

  return (
    <div className="relative">
      {markers.length === 0 ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {hasFilters
            ? 'Нет корпусов с подходящими квартирами и проставленными координатами'
            : 'Нет корпусов с координатами. Заполни их в /admin/buildings (карта-пикер на форме корпуса).'}
        </div>
      ) : null}

      <YandexMap height={600} markers={ymapMarkers} />

      {picked ? (
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] w-[280px]">
          <div className="pointer-events-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-gray-900">
                  {formatComplexName(picked.complex?.name ?? '')}
                </h3>
                <p className="truncate text-xs text-gray-700">
                  {formatName(picked.building?.name ?? '') || 'Корпус'}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {formatName(getComplexDeveloper(picked.complex)?.name || '') || '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClosePopup}
                className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            <button
              type="button"
              onClick={() => onOpenChessboard(picked.complex, picked.building)}
              className="mt-3 w-full rounded-xl border border-blue-500 bg-blue-50 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
            >
              Смотреть шахматку
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SegBtn({ active, disabled, onClick, icon, label, title }) {
  const base =
    'flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition'
  const stateClass = disabled
    ? 'cursor-not-allowed text-gray-400'
    : active
    ? 'border border-blue-500 bg-blue-50 text-blue-700'
    : 'text-gray-700 hover:bg-gray-100'
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`${base} ${stateClass}`}
      title={title}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
