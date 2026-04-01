import { useEffect, useMemo, useState, useCallback } from 'react'
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'
import { getComplexes } from '../../lib/supabaseQueries'
import {
  spanCols,
  spanFloors,
  CommercialPremisesSection,
  isCommercialUnitRow,
} from '../../components/BuildingChessboard'
import ImageUploadField from '../../components/admin/ImageUploadField'
import UnitModal from '../../components/admin/UnitModal'

const ENTITY_BUILDING_FLOOR_LEVEL_PLAN = 'building_floor_level_plan'
const DND_SLOT_PREFIX = 'slot:'

function dndSlotId(floor, position, entrance) {
  return `${DND_SLOT_PREFIX}${floor}:${position}:${entrance}`
}

function parseDndSlotId(id) {
  const raw = String(id || '')
  if (!raw.startsWith(DND_SLOT_PREFIX)) return null
  const body = raw.slice(DND_SLOT_PREFIX.length)
  const [f, p, e] = body.split(':').map((x) => Number(x))
  if (!Number.isFinite(f) || !Number.isFinite(p) || !Number.isFinite(e)) return null
  return { floor: f, position: p, entrance: e }
}

function DraggableUnit({ unitId, children, disabled = false }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(unitId),
    disabled,
  })
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: isDragging ? 50 : undefined,
      }
    : undefined
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-75' : ''}
    >
      {children}
    </div>
  )
}

function DroppableSlot({ slotId, children, className = '', style = undefined }) {
  const { isOver, setNodeRef } = useDroppable({ id: slotId })
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${className} ${isOver ? 'ring-2 ring-cyan-400/70 rounded' : ''}`}
    >
      {children}
    </div>
  )
}

function calcPpm(area, price) {
  const a = Number(area)
  const p = Number(price)
  if (!a || !p) return null
  return Math.round(p / a)
}

function getCellPosition(u, perFloorVal) {
  const direct = Number(u?.position)
  if (Number.isFinite(direct) && direct > 0) return direct
  const n = Number(u?.number)
  if (!Number.isFinite(n) || n <= 0) return null
  return (n % perFloorVal) || perFloorVal
}

function unitFootprint(u, perFloorVal) {
  const p0 = getCellPosition(u, perFloorVal)
  const f0 = Number(u.floor)
  if (!Number.isFinite(p0) || !Number.isFinite(f0)) return null
  const sc = spanCols(u)
  const sf = spanFloors(u)
  return {
    pMin: p0,
    pMax: p0 + sc - 1,
    fMin: f0,
    fMax: f0 + sf - 1,
  }
}

function unitFootprintTouchesFloor(u, floor, perFloorVal) {
  const fp = unitFootprint(u, perFloorVal)
  if (!fp) return false
  return floor >= fp.fMin && floor <= fp.fMax
}

function rectsOverlap(a, b) {
  if (!a || !b) return false
  return !(
    a.pMax < b.pMin ||
    b.pMax < a.pMin ||
    a.fMax < b.fMin ||
    b.fMax < a.fMin
  )
}

function findUnitAt(units, f, p, perFloorVal) {
  for (const u of units || []) {
    if (!isUnitRenderable(u)) continue
    const fp = unitFootprint(u, perFloorVal)
    if (!fp) continue
    if (f >= fp.fMin && f <= fp.fMax && p >= fp.pMin && p <= fp.pMax) return u
  }
  return null
}

const SPAN_MARKER = '__span__'

/**
 * Некоторые записи из Profitbase могут иметь propertyId, но не иметь данных квартиры
 * (нет number/rooms/area/price) — такие ячейки должны выглядеть как пустые слоты.
 */
function isUnitRenderable(u) {
  if (!u || typeof u !== 'object') return false
  const numberRaw = u.number
  const hasNumber =
    numberRaw != null &&
    String(numberRaw).trim() !== '' &&
    String(numberRaw).trim().toLowerCase() !== 'null' &&
    !String(numberRaw).trim().startsWith('#')
  if (hasNumber) return true

  // Для импортных Profitbase-записей без номера считаем слот пустым (иначе появляется #...).
  // Для вручную созданных юнитов (обычно без source/external) оставляем отображение.
  const hasExternal = String(u.external_id ?? '').trim() !== ''
  const hasSource = String(u.source_id ?? '').trim() !== ''
  if (hasExternal || hasSource) return false
  return true
}

/**
 * Раскладка квартир по ячейкам подъезда с учётом поля entrance.
 * Иначе квартира с неверной глобальной position (напр. №72 с position как у 1-го подъезда)
 * визуально попадает в чужой блок.
 */
function assignEntranceSlots(units, floor, r, perFloorVal) {
  const slots = Array(r.size).fill(null)
  const candidates = (units ?? []).filter((u) => {
    if (!isUnitRenderable(u)) return false
    if (!unitFootprintTouchesFloor(u, floor, perFloorVal)) return false
    if (Number(u.entrance) === r.entrance) return true
    if (u.entrance == null || u.entrance === '' || !Number.isFinite(Number(u.entrance))) {
      const p = getCellPosition(u, perFloorVal)
      return Number.isFinite(p) && p >= r.start && p <= r.end
    }
    return false
  })

  const multis = candidates.filter((u) => spanCols(u) > 1 || spanFloors(u) > 1)
  const singles = candidates.filter((u) => spanCols(u) <= 1 && spanFloors(u) <= 1)

  function tryPlaceMulti(u) {
    if (spanFloors(u) > 1) {
      const fTop = Number(u.floor) + spanFloors(u) - 1
      if (fTop !== floor) return
    }
    const p = getCellPosition(u, perFloorVal)
    const sc = Math.max(1, spanCols(u))
    if (!Number.isFinite(p) || p < r.start || p > r.end) return
    const idx = p - r.start
    if (idx < 0 || idx + sc > r.size) return
    for (let k = 0; k < sc; k += 1) {
      if (slots[idx + k]) return
    }
    slots[idx] = u
    for (let k = 1; k < sc; k += 1) slots[idx + k] = SPAN_MARKER
  }

  for (const u of multis) tryPlaceMulti(u)

  // Одноклеточные:
  // 1) сначала раскладываем всё, что имеет корректную уникальную position в блоке
  //    строго в свою ячейку (с сохранением внутренних пустот);
  // 2) остаток (битая/дублированная position) плотно добиваем по номеру квартиры.
  // Это не даёт "уехать" всему этажу из-за 1 проблемной записи.
  const singleBuckets = (() => {
    const byPos = new Map()
    const leftovers = []
    for (const u of singles) {
      const p = Number(u.position)
      if (!Number.isFinite(p) || p < r.start || p > r.end) {
        leftovers.push(u)
        continue
      }
      if (!byPos.has(p)) {
        byPos.set(p, u)
      } else {
        leftovers.push(u)
      }
    }

    const orderedLeftovers = [...leftovers].sort((a, b) => {
      const na = Number(a.number)
      const nb = Number(b.number)
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
      if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1
      return String(a.id ?? '').localeCompare(String(b.id ?? ''))
    })

    return { byPos, leftovers: orderedLeftovers }
  })()

  // 1) Строгое размещение по позиции
  for (const [p, u] of [...singleBuckets.byPos.entries()].sort((a, b) => a[0] - b[0])) {
    const idx = p - r.start
    if (idx < 0 || idx >= r.size) continue
    if (slots[idx] == null) slots[idx] = u
  }

  // 2) Добивка хвоста без корректной позиции
  let si = 0
  for (const u of singleBuckets.leftovers) {
    while (si < r.size && slots[si] != null) si += 1
    if (si >= r.size) break
    slots[si] = u
    si += 1
  }
  return slots
}

function isAnchorCell(u, f, p, perFloorVal) {
  const p0 = getCellPosition(u, perFloorVal)
  const f0 = Number(u.floor)
  const sf = spanFloors(u)
  if (!Number.isFinite(p0) || !Number.isFinite(f0)) return false
  const fTop = f0 + sf - 1
  return sf <= 1 ? f0 === f && p0 === p : fTop === f && p0 === p
}

export default function AdminUnitsPage() {
  const [complexes, setComplexes] = useState([])
  const [selectedComplexId, setSelectedComplexId] = useState('')
  const [selectedBuildingId, setSelectedBuildingId] = useState('')
  const [units, setUnits] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [isEditMode, setIsEditMode] = useState(false)
  const [activeCell, setActiveCell] = useState(null)
  const [selectedForMerge, setSelectedForMerge] = useState([]) // unit ids
  const [selectedEmptyCells, setSelectedEmptyCells] = useState([]) // "floor:position:entrance"
  const [hoveredEntranceHeader, setHoveredEntranceHeader] = useState(null)
  const [contextMenu, setContextMenu] = useState(null) // {x,y,floor,position,entrance,unit}
  const [activeStructureUnitId, setActiveStructureUnitId] = useState(null)
  const [pendingLayout, setPendingLayout] = useState({
    upsertById: {},
    deleteIds: [],
  })
  const [pendingBuildingPatch, setPendingBuildingPatch] = useState({})
  /** @type {Record<number, string>} */
  const [floorPlanUrls, setFloorPlanUrls] = useState({})
  const [mediaBusy, setMediaBusy] = useState(false)
  const [planModal, setPlanModal] = useState(null) // { floor, url } | null
  const [form, setForm] = useState({
    number: '',
    rooms: '',
    area: '',
    price: '',
    status: 'available',
    span_columns: '1',
    span_floors: '1',
  })

  function makeTempUnitId() {
    return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  function queueBuildingPatch(patch) {
    if (!patch || typeof patch !== 'object') return
    setPendingBuildingPatch((prev) => ({ ...prev, ...patch }))
    setComplexes((prev) =>
      (prev || []).map((c) => ({
        ...c,
        buildings: (c.buildings || []).map((b) =>
          b.id === selectedBuildingId ? { ...b, ...patch } : b
        ),
      }))
    )
  }

  function applyLocalLayoutChange({ upsert = [], deleteIds = [] }) {
    const normalizedUpsert = (upsert || []).map((u) => ({
      ...u,
      id: u.id ?? makeTempUnitId(),
    }))
    setUnits((prev) => {
      const byId = new Map((prev || []).map((u) => [String(u.id), u]))
      for (const id of deleteIds || []) byId.delete(String(id))
      for (const row of normalizedUpsert) byId.set(String(row.id), row)
      return [...byId.values()]
    })
    setPendingLayout((prev) => {
      const upsertById = { ...(prev?.upsertById || {}) }
      const deleteSet = new Set(prev?.deleteIds || [])
      for (const id of deleteIds || []) {
        const sid = String(id)
        delete upsertById[sid]
        if (!sid.startsWith('temp_')) deleteSet.add(sid)
      }
      for (const row of normalizedUpsert) {
        const sid = String(row.id)
        upsertById[sid] = row
        deleteSet.delete(sid)
      }
      return { upsertById, deleteIds: [...deleteSet] }
    })
    return normalizedUpsert
  }

  async function loadComplexes(force = false) {
    if (isEditMode && !force) return
    if (!supabase) return
    const { data, error } = await getComplexes(supabase)
    if (error) {
      setMsg(error.message)
      return
    }
    const list = data ?? []
    setComplexes(list)
    if (!selectedComplexId && list[0]?.id) {
      setSelectedComplexId(list[0].id)
      if (list[0]?.buildings?.[0]?.id) {
        setSelectedBuildingId(list[0].buildings[0].id)
      }
    }
  }

  useEffect(() => {
    loadComplexes()
  }, [])

  useEffect(() => {
    setSelectedForMerge([])
    setSelectedEmptyCells([])
    setIsEditMode(false)
    setActiveStructureUnitId(null)
    setActiveCell(null)
  }, [selectedBuildingId])

  useEffect(() => {
    const onClick = (e) => {
      setContextMenu(null)
      if (!isEditMode) return
      if (!selectedForMerge.length && !selectedEmptyCells.length) return
      const el = e?.target
      if (!(el instanceof Element)) return
      // Клик в "пустое место" (вне рабочей зоны выделения) снимает выделение.
      if (!el.closest('[data-merge-keep="1"]')) {
        setSelectedForMerge([])
        setSelectedEmptyCells([])
      }
    }
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [isEditMode, selectedForMerge.length, selectedEmptyCells.length])

  const selectedComplex = useMemo(
    () => complexes.find((c) => c.id === selectedComplexId) || null,
    [complexes, selectedComplexId]
  )

  const buildings = useMemo(
    () => selectedComplex?.buildings ?? [],
    [selectedComplex]
  )

  const selectedBuilding = useMemo(
    () => buildings.find((b) => b.id === selectedBuildingId) || null,
    [buildings, selectedBuildingId]
  )

  useEffect(() => {
    if (!selectedComplex) return
    if (selectedBuildingId) return
    const firstId = selectedComplex?.buildings?.[0]?.id || ''
    setSelectedBuildingId(firstId)
  }, [selectedComplex, selectedBuildingId])

  async function loadUnitsForBuilding(buildingId, force = false) {
    if (isEditMode && !force) return
    if (!supabase || !buildingId) {
      setUnits([])
      return
    }
    const { data, error } = await supabase
      .from('units')
      .select('*')
      .eq('building_id', buildingId)
    if (error) {
      setMsg(error.message)
      return
    }
    setUnits(data ?? [])
  }

  useEffect(() => {
    loadUnitsForBuilding(selectedBuildingId)
  }, [selectedBuildingId])

  const loadFloorPlans = useCallback(async (buildingId) => {
    if (!supabase || !buildingId) {
      setFloorPlanUrls({})
      return
    }
    const { data, error } = await supabase
      .from('images')
      .select('floor_level, url, id')
      .eq('entity_type', ENTITY_BUILDING_FLOOR_LEVEL_PLAN)
      .eq('entity_id', buildingId)
      .order('id', { ascending: false })

    if (error) {
      if (!/floor_level|column|schema cache/i.test(String(error.message || ''))) {
        setMsg(error.message)
      }
      setFloorPlanUrls({})
      return
    }

    const by = {}
    for (const r of data ?? []) {
      if (r.floor_level == null) continue
      if (by[r.floor_level] != null) continue
      by[r.floor_level] = r.url
    }
    setFloorPlanUrls(by)
  }, [])

  useEffect(() => {
    loadFloorPlans(selectedBuildingId)
  }, [selectedBuildingId, loadFloorPlans])

  async function uploadUnitMedia(kind, file, unitId) {
    if (!supabase || !file || !unitId) return
    setMediaBusy(true)
    setMsg('')
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${kind}/${unitId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('images')
        .upload(path, file, { upsert: true })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from('images').getPublicUrl(path)
      const url = pub.publicUrl

      const patch =
        kind === 'unit_layout'
          ? { layout_image_url: url }
          : kind === 'unit_finish'
          ? { finish_image_url: url }
          : null
      if (!patch) throw new Error('Unknown media kind')

      const { error: updErr } = await supabase
        .from('units')
        .update(patch)
        .eq('id', unitId)
      if (updErr) throw updErr

      await loadUnitsForBuilding(selectedBuildingId)
      setActiveCell((prev) =>
        prev?.unit?.id === unitId
          ? { ...prev, unit: { ...prev.unit, ...patch } }
          : prev
      )
    } catch (e) {
      setMsg(e?.message || 'Ошибка загрузки')
    } finally {
      setMediaBusy(false)
    }
  }

  async function removeUnitMedia(kind, unitId) {
    if (!supabase || !unitId) return
    const patch =
      kind === 'unit_layout'
        ? { layout_image_url: null }
        : kind === 'unit_finish'
        ? { finish_image_url: null }
        : null
    if (!patch) return
    setMediaBusy(true)
    setMsg('')
    try {
      const { error } = await supabase.from('units').update(patch).eq('id', unitId)
      if (error) throw error
      await loadUnitsForBuilding(selectedBuildingId)
      setActiveCell((prev) =>
        prev?.unit?.id === unitId ? { ...prev, unit: { ...prev.unit, ...patch } } : prev
      )
    } catch (e) {
      setMsg(e?.message || 'Ошибка удаления фото')
    } finally {
      setMediaBusy(false)
    }
  }

  /** Сумма ячеек по `units_per_entrance` из БД — не даём perFloor быть меньше (иначе [4,5] «режется» до одного подъезда). */
  const sumDbEntrances = useMemo(() => {
    const raw = selectedBuilding?.units_per_entrance
    if (!Array.isArray(raw) || !raw.length) return 0
    return raw
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0)
      .reduce((a, b) => a + b, 0)
  }, [selectedBuilding?.units_per_entrance])

  const gridUnits = useMemo(
    () => (units ?? []).filter((u) => !isCommercialUnitRow(u)),
    [units]
  )
  const commercialUnitsForCards = useMemo(
    () => (units ?? []).filter((u) => isCommercialUnitRow(u)),
    [units]
  )

  const residentialFloorLevels = useMemo(() => {
    const s = new Set()
    for (const u of gridUnits ?? []) {
      const f0 = Number(u.floor)
      if (!Number.isFinite(f0)) continue
      const sf = spanFloors(u)
      for (let ff = f0; ff <= f0 + sf - 1; ff += 1) s.add(ff)
    }
    return s
  }, [gridUnits])

  const commercialFloorsInBuilding = useMemo(() => {
    const s = new Set()
    for (const u of commercialUnitsForCards ?? []) {
      const f = Number(u.floor)
      if (Number.isFinite(f)) s.add(f)
    }
    return s
  }, [commercialUnitsForCards])

  /** Сколько квартир на самом заполненном этаже (если position в БД пустые — всё равно видим ширину). */
  const maxUnitCountOnAnyFloor = useMemo(() => {
    const byFloor = new Map()
    for (const u of gridUnits ?? []) {
      const f = Number(u?.floor)
      if (!Number.isFinite(f) || f < 1) continue
      byFloor.set(f, (byFloor.get(f) || 0) + 1)
    }
    let m = 0
    for (const c of byFloor.values()) m = Math.max(m, c)
    return m
  }, [gridUnits])

  /** Черновая ширина сетки до финального perFloor (только явные position). */
  const draftExtent = useMemo(() => {
    let maxR = 0
    for (const u of gridUnits ?? []) {
      const p = Number(u?.position)
      const sc = spanCols(u)
      if (Number.isFinite(p) && p > 0) maxR = Math.max(maxR, p + sc - 1)
    }
    const hint = Number(selectedBuilding?.units_per_floor)
    const fromHint = Number.isFinite(hint) && hint > 0 ? hint : 0
    const sumEnt = sumDbEntrances || 0
    const defaultFour =
      maxR <= 0 && fromHint <= 0 && sumEnt <= 0 && maxUnitCountOnAnyFloor <= 0 ? 4 : 0
    return Math.max(
      1,
      maxR,
      fromHint,
      sumEnt,
      maxUnitCountOnAnyFloor,
      defaultFour
    )
  }, [gridUnits, selectedBuilding, sumDbEntrances, maxUnitCountOnAnyFloor])

  const perFloor = useMemo(() => {
    let maxR = 0
    for (const u of gridUnits ?? []) {
      const p = Number(u?.position)
      const sc = spanCols(u)
      if (Number.isFinite(p) && p > 0) {
        maxR = Math.max(maxR, p + sc - 1)
        continue
      }
      const n = Number(u?.number)
      if (Number.isFinite(n) && n > 0) {
        const pos = (n % draftExtent) || draftExtent
        maxR = Math.max(maxR, pos + sc - 1)
      }
    }
    const base = Math.max(
      1,
      maxR,
      Number(selectedBuilding?.units_per_floor) || 0,
      draftExtent,
      sumDbEntrances,
      maxUnitCountOnAnyFloor
    )
    return base
  }, [
    gridUnits,
    selectedBuilding,
    draftExtent,
    sumDbEntrances,
    maxUnitCountOnAnyFloor,
  ])

  const floorsDesc = useMemo(() => {
    if (!gridUnits?.length && commercialUnitsForCards.length > 0) {
      return []
    }

    let top = 0
    let low = 1
    for (const u of gridUnits ?? []) {
      const f = Number(u.floor)
      if (!Number.isFinite(f)) continue
      const sf = spanFloors(u)
      top = Math.max(top, f + sf - 1)
      low = Math.min(low, f)
    }
    if (!gridUnits?.length) {
      top = Math.max(1, Number(selectedBuilding?.floors) || 10)
      low = 1
    } else {
      top = Math.max(top, Number(selectedBuilding?.floors) || 0)
    }
    if (top < low) top = low
    const out = []
    for (let f = top; f >= low; f -= 1) out.push(f)
    const base = out.length ? out : [1]
    return base.filter(
      (f) => !commercialFloorsInBuilding.has(f) || residentialFloorLevels.has(f)
    )
  }, [
    gridUnits,
    commercialUnitsForCards,
    selectedBuilding,
    residentialFloorLevels,
    commercialFloorsInBuilding,
  ])

  const entranceSizes = useMemo(() => {
    // Fallback/validation: восстанавливаем ширины подъездов из фактических units.
    // Нужно, когда в buildings.units_per_entrance сохранено старое/битое значение,
    // а квартиры уже синхронизированы с корректными entrance/position.
    const inferFromUnits = () => {
      const byEntrance = new Map()
      for (const u of gridUnits ?? []) {
        const e = Number(u?.entrance)
        const p = Number(u?.position)
        if (!Number.isFinite(e) || e < 1 || !Number.isFinite(p) || p < 1) continue
        const rec = byEntrance.get(e) || { min: p, max: p }
        rec.min = Math.min(rec.min, p)
        rec.max = Math.max(rec.max, p)
        byEntrance.set(e, rec)
      }
      const keys = [...byEntrance.keys()].sort((a, b) => a - b)
      if (!keys.length) return null
      const arr = keys.map((e) => {
        const rec = byEntrance.get(e)
        return Math.max(1, Number(rec.max) - Number(rec.min) + 1)
      })
      const sum = arr.reduce((a, b) => a + b, 0)
      return sum > 0 ? arr : null
    }

    const inferred = inferFromUnits()
    const raw = selectedBuilding?.units_per_entrance
    if (Array.isArray(raw) && raw.length) {
      const arr = raw
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)

      if (arr.length) {
        const sum = arr.reduce((a, b) => a + b, 0)
        // Если из БД пришло устаревшее разбиение (например [6,8,6,5] вместо [7,8,6,4]),
        // но по квартирам видно корректное — приоритет за реальными units.
        if (Array.isArray(inferred) && inferred.length >= 2) {
          const inferredSum = inferred.reduce((a, b) => a + b, 0)
          if (
            inferredSum === perFloor &&
            (sum !== perFloor || inferred.length !== arr.length || inferred.some((v, i) => v !== arr[i]))
          ) {
            return inferred
          }
        }
        if (sum > 0 && sum === perFloor) return arr
        if (sum > 0 && sum < perFloor) {
          // Одно число из БД при «широкой» сетке (например [4] и 9 квартир) — не склеиваем в один подъезд.
          if (arr.length >= 2) {
            const out = [...arr]
            out[out.length - 1] += perFloor - sum
            return out
          }
        }
        if (sum > 0 && sum > perFloor) {
          const out = []
          let remaining = perFloor
          for (const x of arr) {
            if (remaining <= 0) break
            const take = Math.min(x, remaining)
            if (take > 0) out.push(take)
            remaining -= take
          }
          return out.length ? out : [perFloor]
        }
      }
    }

    if (Array.isArray(inferred) && inferred.length >= 2) {
      return inferred
    }

    const GAP_THRESHOLD = 20
    const byFloor = new Map()
    for (const u of gridUnits ?? []) {
      const f = Number(u?.floor)
      if (!Number.isFinite(f) || f < 1) continue
      if (!byFloor.has(f)) byFloor.set(f, [])
      byFloor.get(f).push(u)
    }

    const floorsAsc = [...byFloor.keys()].sort((a, b) => b - a)
    for (const f of floorsAsc) {
      const list = byFloor.get(f) ?? []
      if (list.length < 2) continue
      const sorted = [...list].sort((a, b) => {
        const pa = Number(a?.position)
        const pb = Number(b?.position)
        if (Number.isFinite(pa) && Number.isFinite(pb)) return pa - pb
        const na = Number(a?.number)
        const nb = Number(b?.number)
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
        return 0
      })
      const nums = sorted
        .map((u) => Number(u?.number))
        .filter((n) => Number.isFinite(n) && n > 0)

      if (nums.length < 2) continue

      const splits = []
      for (let i = 0; i < nums.length - 1; i += 1) {
        const gap = nums[i + 1] - nums[i]
        if (Number.isFinite(gap) && gap >= GAP_THRESHOLD) splits.push(i + 1)
      }
      if (!splits.length) continue

      const sizes = []
      let prev = 0
      for (const idx of splits) {
        const size = idx - prev
        if (size > 0) sizes.push(size)
        prev = idx
      }
      const tail = nums.length - prev
      if (tail > 0) sizes.push(tail)

      const sum = sizes.reduce((a, b) => a + b, 0)
      if (sum > 1) {
        if (sum === perFloor) return sizes
        if (sum < perFloor) {
          const out = [...sizes]
          out[out.length - 1] += perFloor - sum
          return out
        }
        if (sum > perFloor) {
          const out = []
          let remaining = perFloor
          for (const x of sizes) {
            if (remaining <= 0) break
            const take = Math.min(x, remaining)
            if (take > 0) out.push(take)
            remaining -= take
          }
          return out.length ? out : [perFloor]
        }
      }
    }

    return [perFloor]
  }, [selectedBuilding, perFloor, gridUnits])

  const entranceRanges = useMemo(() => {
    const out = []
    let start = 1
    for (let i = 0; i < entranceSizes.length; i += 1) {
      const size = entranceSizes[i]
      const end = start + size - 1
      out.push({ entrance: i + 1, start, end, size })
      start = end + 1
    }
    return out
  }, [entranceSizes])

  async function uploadFloorPlanForFloor(floorLevel, file) {
    if (!supabase || !selectedBuildingId || !file) return
    setMediaBusy(true)
    setMsg('')
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const folder = `floor_level_${floorLevel}`
      const path = `${ENTITY_BUILDING_FLOOR_LEVEL_PLAN}/${selectedBuildingId}/${folder}/${Date.now()}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('images')
        .upload(path, file, { upsert: true })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from('images').getPublicUrl(path)
      const url = pub.publicUrl

      // Replace: remove previous plan for this floor, then insert.
      const { error: delErr } = await supabase
        .from('images')
        .delete()
        .eq('entity_type', ENTITY_BUILDING_FLOOR_LEVEL_PLAN)
        .eq('entity_id', selectedBuildingId)
        .eq('floor_level', floorLevel)

      if (delErr && !/floor_level|column|schema cache/i.test(String(delErr.message || ''))) {
        throw delErr
      }

      const { error: insErr } = await supabase.from('images').insert({
        entity_type: ENTITY_BUILDING_FLOOR_LEVEL_PLAN,
        entity_id: selectedBuildingId,
        floor_level: floorLevel,
        url,
      })
      if (insErr) throw insErr

      await loadFloorPlans(selectedBuildingId)
    } catch (e) {
      setMsg(e?.message || 'Ошибка загрузки')
    } finally {
      setMediaBusy(false)
    }
  }

  function openEditor(floor, position) {
    const unit = findUnitAt(gridUnits, floor, position, perFloor) || null
    setActiveCell({ floor, position, unit })
    setForm({
      number: unit?.number != null ? String(unit.number) : '',
      rooms: unit?.rooms != null ? String(unit.rooms) : '',
      area: unit?.area != null ? String(unit.area) : '',
      price: unit?.price != null ? String(unit.price) : '',
      status: unit?.status || 'available',
      span_columns: unit
        ? String(Math.max(1, Number(unit.span_columns) || 1))
        : '1',
      span_floors: unit
        ? String(Math.max(1, Number(unit.span_floors) || 1))
        : '1',
    })
  }

  function closeEditor() {
    setActiveCell(null)
    setForm({
      number: '',
      rooms: '',
      area: '',
      price: '',
      status: 'available',
      span_columns: '1',
      span_floors: '1',
    })
  }

  async function onSaveUnit(e) {
    e.preventDefault()
    if (!supabase || !selectedBuildingId || !activeCell) return
    setBusy(true)
    setMsg('')

    const sc = Math.max(1, parseInt(form.span_columns, 10) || 1)
    const sf = Math.max(1, parseInt(form.span_floors, 10) || 1)

    const fBottom = activeCell.unit
      ? Number(activeCell.unit.floor)
      : activeCell.floor - sf + 1
    if (!Number.isFinite(fBottom)) {
      setBusy(false)
      setMsg('Некорректный этаж квартиры.')
      return
    }

    const proposed = {
      pMin: activeCell.position,
      pMax: activeCell.position + sc - 1,
      fMin: fBottom,
      fMax: fBottom + sf - 1,
    }

    if (proposed.pMax > perFloor) {
      setBusy(false)
      setMsg(
        `Квартира выходит за пределы сетки (макс. позиция ${perFloor}). Добавьте колонки справа или уменьшите ширину.`
      )
      return
    }

    const low = floorsDesc[floorsDesc.length - 1]
    const high = floorsDesc[0]
    if (proposed.fMin < low || proposed.fMax > high) {
      setBusy(false)
      setMsg('Квартира выходит за пределы отображаемых этажей. Добавьте этажи к сетке.')
      return
    }

    for (const o of gridUnits ?? []) {
      if (activeCell.unit?.id && o.id === activeCell.unit.id) continue
      const fp = unitFootprint(o, perFloor)
      if (fp && rectsOverlap(proposed, fp)) {
        setBusy(false)
        setMsg('Пересечение с другой квартирой. Уменьшите объединение или сдвиньте ячейку.')
        return
      }
    }

    const areaN = form.area === '' ? null : Number(form.area)
    const priceN = form.price === '' ? null : Number(form.price)
    const ppm = calcPpm(areaN, priceN)

    const payload = {
      id: activeCell.unit?.id ?? undefined,
      building_id: selectedBuildingId,
      floor: fBottom,
      position: activeCell.position,
      entrance:
        activeCell.unit?.entrance != null
          ? activeCell.unit.entrance
          : entranceRanges.find(
              (r) =>
                activeCell.position >= r.start && activeCell.position <= r.end
            )?.entrance ?? null,
      number: form.number === '' ? null : parseInt(form.number, 10),
      rooms: form.rooms === '' ? null : parseInt(form.rooms, 10),
      area: areaN,
      price: priceN,
      price_per_meter: ppm,
      status: form.status,
      span_columns: sc,
      span_floors: sf,
    }
    try {
      await saveLayout({ upsert: [payload], deleteIds: [] })
      await loadUnitsForBuilding(selectedBuildingId)
      closeEditor()
    } catch (e2) {
      setMsg(e2?.message || 'Ошибка сохранения')
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteUnit() {
    if (!supabase || !activeCell?.unit?.id || !selectedBuildingId) return
    const okFirst = confirm('Удалить квартиру?')
    if (!okFirst) return
    const okSecond = confirm(
      'Подтвердите удаление: действие необратимо и запись квартиры будет удалена окончательно.'
    )
    if (!okSecond) return
    try {
      await saveLayout({ upsert: [], deleteIds: [activeCell.unit.id] })
      await loadUnitsForBuilding(selectedBuildingId)
      closeEditor()
    } catch (e) {
      setMsg(e?.message || 'Ошибка удаления')
    }
  }

  async function onDeleteUnitById(unitId) {
    if (!supabase || !unitId || !selectedBuildingId) return
    const okFirst = confirm('Удалить квартиру?')
    if (!okFirst) return
    const okSecond = confirm(
      'Подтвердите удаление: действие необратимо и запись квартиры будет удалена окончательно.'
    )
    if (!okSecond) return
    try {
      await saveLayout({ upsert: [], deleteIds: [unitId] })
      await loadUnitsForBuilding(selectedBuildingId)
      closeEditor()
    } catch (e) {
      setMsg(e?.message || 'Ошибка удаления')
    }
  }

  async function saveLayoutImmediate({ upsert = [], deleteIds = [] }) {
    const res = await fetch('/api/update-units-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upsert, deleteIds }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || 'Не удалось сохранить')
    return body
  }

  async function saveLayout({ upsert = [], deleteIds = [] }) {
    if (isEditMode) {
      const normalizedUpsert = applyLocalLayoutChange({ upsert, deleteIds })
      return {
        ok: true,
        deferred: true,
        rows: normalizedUpsert,
        upserted: normalizedUpsert.length,
        deleted: deleteIds.length,
      }
    }
    return saveLayoutImmediate({ upsert, deleteIds })
  }

  async function handleEditModeToggle() {
    if (!isEditMode) {
      setPendingLayout({ upsertById: {}, deleteIds: [] })
      setPendingBuildingPatch({})
      setSelectedForMerge([])
      setSelectedEmptyCells([])
      setActiveStructureUnitId(null)
      setActiveCell(null)
      setIsEditMode(true)
      return
    }

    setBusy(true)
    setMsg('')
    try {
      const upsert = Object.values(pendingLayout?.upsertById || {}).map((u) => {
        const sid = String(u?.id || '')
        if (sid.startsWith('temp_')) {
          const { id: _id, ...rest } = u
          return rest
        }
        return u
      })
      const deleteIds = [...(pendingLayout?.deleteIds || [])]
      if (upsert.length || deleteIds.length) {
        await saveLayoutImmediate({ upsert, deleteIds })
      }

      if (Object.keys(pendingBuildingPatch || {}).length > 0) {
        const { error } = await supabase
          .from('buildings')
          .update(pendingBuildingPatch)
          .eq('id', selectedBuildingId)
        if (error) throw error
      }

      setPendingLayout({ upsertById: {}, deleteIds: [] })
      setPendingBuildingPatch({})
      setSelectedForMerge([])
      setSelectedEmptyCells([])
      setActiveStructureUnitId(null)
      setIsEditMode(false)

      await Promise.all([
        loadUnitsForBuilding(selectedBuildingId, true),
        loadComplexes(true),
        loadFloorPlans(selectedBuildingId),
      ])
    } catch (e) {
      setMsg(e?.message || 'Ошибка сохранения изменений шахматки')
    } finally {
      setBusy(false)
    }
  }

  async function cancelEditModeChanges() {
    if (!isEditMode) return
    setBusy(true)
    setMsg('')
    try {
      setPendingLayout({ upsertById: {}, deleteIds: [] })
      setPendingBuildingPatch({})
      setSelectedForMerge([])
      setSelectedEmptyCells([])
      setActiveStructureUnitId(null)
      setActiveCell(null)
      setIsEditMode(false)
      await Promise.all([
        loadUnitsForBuilding(selectedBuildingId, true),
        loadComplexes(true),
        loadFloorPlans(selectedBuildingId),
      ])
    } catch (e) {
      setMsg(e?.message || 'Ошибка отмены изменений')
    } finally {
      setBusy(false)
    }
  }

  async function onDragEnd(event) {
    if (!isEditMode) return
    const activeId = String(event?.active?.id || '')
    const overId = String(event?.over?.id || '')
    if (!activeId || !overId) return
    const target = parseDndSlotId(overId)
    if (!target) return

    const activeUnit = (gridUnits ?? []).find((u) => String(u.id) === activeId)
    if (!activeUnit?.id) return

    const aSfMove = Math.max(1, Number(activeUnit.span_floors) || 1)
    const activeTop =
      Number(activeUnit.floor) + aSfMove - 1

    const occupied = findUnitAt(
      gridUnits,
      target.floor,
      target.position,
      perFloor
    )

    if (
      activeTop === target.floor &&
      Number(activeUnit.position) === target.position &&
      Number(activeUnit.entrance) === target.entrance
    ) {
      return
    }

    setBusy(true)
    setMsg('')
    try {
      // If target occupied by another unit: perform swap for 1x1 units.
      if (occupied?.id && String(occupied.id) !== String(activeUnit.id)) {
        const aSc = spanCols(activeUnit)
        const aSf = spanFloors(activeUnit)
        const bSc = spanCols(occupied)
        const bSf = spanFloors(occupied)
        if (aSc !== 1 || aSf !== 1 || bSc !== 1 || bSf !== 1) {
          setMsg('Swap доступен только для обычных квартир 1x1.')
          setBusy(false)
          return
        }
        const activeFrom = {
          floor: Number(activeUnit.floor),
          position: Number(activeUnit.position),
          entrance: Number(activeUnit.entrance) || 1,
        }
        const overPayload = {
          ...occupied,
          floor: activeFrom.floor,
          position: activeFrom.position,
          entrance: activeFrom.entrance,
        }
        const activePayload = {
          ...activeUnit,
          floor: target.floor,
          position: target.position,
          entrance: target.entrance,
        }
        console.log('PB GRID SWAP', {
          active: { id: activePayload.id, floor: activePayload.floor, position: activePayload.position, entrance: activePayload.entrance, span: 1 },
          over: { id: overPayload.id, floor: overPayload.floor, position: overPayload.position, entrance: overPayload.entrance, span: 1 },
        })
        await saveLayout({ upsert: [activePayload, overPayload], deleteIds: [] })
        await loadUnitsForBuilding(selectedBuildingId)
        setBusy(false)
        return
      }

      const next = {
        ...activeUnit,
        floor: target.floor - aSfMove + 1,
        position: target.position,
        entrance: target.entrance,
      }
      console.log('PB GRID MOVE', {
        id: activeUnit.id,
        floor: next.floor,
        position: next.position,
        entrance: next.entrance,
        span: Number(next.span_columns) || 1,
      })
      await saveLayout({ upsert: [next], deleteIds: [] })
      await loadUnitsForBuilding(selectedBuildingId)
    } catch (e) {
      setMsg(e?.message || 'Ошибка перетаскивания')
    } finally {
      setBusy(false)
    }
  }

  async function addEntrance() {
    if (!supabase || !selectedBuildingId) return
    // Persist entrance sizes in buildings.units_per_entrance if exists.
    const next = [...(entranceSizes ?? []), 1]
    if (isEditMode) {
      queueBuildingPatch({
        units_per_entrance: next,
        units_per_floor: next.reduce((a, b) => a + b, 0),
      })
      return
    }
    const { error } = await supabase
      .from('buildings')
      .update({ units_per_entrance: next, units_per_floor: next.reduce((a, b) => a + b, 0) })
      .eq('id', selectedBuildingId)
    if (error && !/units_per_entrance/i.test(String(error.message || ''))) {
      setMsg(error.message)
    }
    await loadComplexes()
  }

  async function addFloor(direction = 'up') {
    if (!supabase || !selectedBuildingId) return
    const currentTop = floorsDesc?.[0] ?? 1
    const nextFloors = currentTop + 1
    if (direction === 'down') {
      try {
        setBusy(true)
        const shifted = (units ?? []).map((u) => ({
          ...u,
          floor: Number.isFinite(Number(u.floor)) ? Number(u.floor) + 1 : u.floor,
        }))
        await saveLayout({ upsert: shifted, deleteIds: [] })
      } catch (e) {
        setMsg(e?.message || 'Ошибка добавления нижнего этажа')
      } finally {
        setBusy(false)
      }
    }
    if (isEditMode) {
      queueBuildingPatch({ floors: nextFloors })
      return
    }
    const { error } = await supabase
      .from('buildings')
      .update({ floors: nextFloors })
      .eq('id', selectedBuildingId)
    if (error && !/floors/i.test(String(error.message || ''))) setMsg(error.message)
    await loadComplexes()
  }

  async function mergeSelected() {
    if (!selectedBuildingId) return
    if (selectedForMerge.length < 2) return
    const sel = units.filter((u) => selectedForMerge.includes(u.id))
    if (sel.length < 2) return
    if (!mergeValidation.ok || !mergeValidation.rect) {
      setMsg(mergeValidation.reason || 'Нельзя объединить выбранные квартиры')
      return
    }
    const entrance = mergeValidation.rect.entrance

    const floorsSel = sel.map((u) => Number(u.floor)).filter((n) => Number.isFinite(n))
    const posSel = sel.map((u) => Number(u.position)).filter((n) => Number.isFinite(n))
    if (!floorsSel.length || !posSel.length) return

    const minFloor = Math.min(...floorsSel)
    const maxFloor = Math.max(...floorsSel)
    const minPos = Math.min(...posSel)
    const maxPos = Math.max(...posSel)

    // Проверяем, что прямоугольник заполнен целиком выбранными ячейками.
    const selectedKey = new Set(sel.map((u) => `${u.floor}:${u.position}`))
    for (let f = minFloor; f <= maxFloor; f += 1) {
      for (let p = minPos; p <= maxPos; p += 1) {
        if (!selectedKey.has(`${f}:${p}`)) {
          setMsg('Нельзя объединять не соседние ячейки: выберите прямоугольник без пропусков.')
          return
        }
      }
    }

    // Также убеждаемся, что в выбранном прямоугольнике нет чужих квартир.
    for (let f = minFloor; f <= maxFloor; f += 1) {
      for (let p = minPos; p <= maxPos; p += 1) {
        const u = findUnitAt(gridUnits, f, p, perFloor)
        if (!u) {
          setMsg('В выбранной области есть пустые ячейки. Сначала создайте квартиры, затем объединяйте.')
          return
        }
        if (!selectedForMerge.includes(u.id)) {
          setMsg('В выбранной области есть квартиры, которые не выделены для объединения.')
          return
        }
      }
    }

    const span_columns = Math.max(1, maxPos - minPos + 1)
    const span_floors = Math.max(1, maxFloor - minFloor + 1)

    // anchor в БД: нижний этаж + левая позиция (minPos)
    const newUnit = {
      building_id: selectedBuildingId,
      floor: minFloor,
      entrance,
      position: minPos,
      span_columns,
      span_floors,
      is_combined: true,
      combined_unit_ids: sel.map((u) => u.id),
      status: 'available',
    }
    try {
      setBusy(true)
      setMsg('')
      await saveLayout({ upsert: [newUnit], deleteIds: sel.map((u) => u.id) })
      await loadUnitsForBuilding(selectedBuildingId)
      setSelectedForMerge([])
    } catch (e) {
      setMsg(e?.message || 'Ошибка объединения')
    } finally {
      setBusy(false)
    }
  }

  async function splitUnit(unit) {
    if (!unit?.id || !selectedBuildingId) return
    const ok = confirmTwice(
      'Разделить объединенную квартиру на отдельные ячейки?',
      'Подтвердите разделение квартиры.'
    )
    if (!ok) return
    try {
      setBusy(true)
      setMsg('')
      const payload = {
        ...unit,
        span_columns: 1,
        span_floors: 1,
        is_combined: false,
        combined_unit_ids: [],
      }
      const saveRes = await saveLayout({ upsert: [payload], deleteIds: [] })
      const entranceVal = Number(payload.entrance) || 1
      const justSavedCellKey = emptyCellKey(payload.floor, payload.position, entranceVal)
      setSelectedEmptyCells((prev) => prev.filter((k) => k !== justSavedCellKey))
      const createdId = saveRes?.rows?.[0]?.id
      if (createdId) {
        setSelectedForMerge((prev) => (prev.includes(createdId) ? prev : [...prev, createdId]))
      }
      await loadUnitsForBuilding(selectedBuildingId)
      closeEditor()
    } catch (e) {
      setMsg(e?.message || 'Ошибка разделения')
    } finally {
      setBusy(false)
    }
  }

  function confirmTwice(first, second) {
    const ok1 = confirm(first)
    if (!ok1) return false
    const ok2 = confirm(second)
    return ok2
  }

  async function deleteEntrance(entranceNumber) {
    if (!supabase || !selectedBuildingId) return
    const size = entranceRanges.find((r) => r.entrance === entranceNumber)?.size
    if (!size) return

    const ok = confirmTwice(
      `Удалить подъезд П${entranceNumber}? Будут удалены все квартиры этого подъезда.`,
      'Подтвердите удаление: действие необратимо.'
    )
    if (!ok) return

    try {
      setBusy(true)
      setMsg('')

      // 1) delete units in this entrance
      const toDelete = (units ?? [])
        .filter((u) => Number(u.entrance) === entranceNumber)
        .map((u) => u.id)
        .filter(Boolean)

      // 2) shift units after this entrance: entrance-- and position-=size
      const shifted = (units ?? [])
        .filter((u) => Number(u.entrance) > entranceNumber)
        .map((u) => ({
          ...u,
          entrance: Number(u.entrance) - 1,
          position:
            u.position != null && Number.isFinite(Number(u.position))
              ? Number(u.position) - size
              : u.position,
        }))

      await saveLayout({ upsert: shifted, deleteIds: toDelete })

      // 3) update building units_per_entrance
      const next = entranceSizes.filter((_, idx) => idx !== entranceNumber - 1)
      const upd = {
        units_per_floor: next.reduce((a, b) => a + b, 0),
        units_per_entrance: next,
      }
      if (isEditMode) {
        queueBuildingPatch(upd)
      } else {
      const { error } = await supabase
        .from('buildings')
        .update(upd)
        .eq('id', selectedBuildingId)
      if (error && !/units_per_entrance/i.test(String(error.message || ''))) {
        throw error
      }
      }

      await Promise.all([
        loadUnitsForBuilding(selectedBuildingId),
        loadComplexes(),
      ])
    } catch (e) {
      setMsg(e?.message || 'Ошибка удаления подъезда')
    } finally {
      setBusy(false)
    }
  }

  async function deleteFloor(floorLevel) {
    if (!supabase || !selectedBuildingId) return
    const targetFloor = Number(floorLevel)
    if (!Number.isFinite(targetFloor)) return

    const ok = confirmTwice(
      `Удалить этаж ${targetFloor}? Будут удалены все квартиры, которые занимают этот этаж (включая двухуровневые).`,
      'Подтвердите удаление: действие необратимо.'
    )
    if (!ok) return

    try {
      setBusy(true)
      setMsg('')

      // delete units whose footprint includes this floor:
      // fMin = unit.floor, fMax = unit.floor + span_floors - 1
      const deleteIds = []
      for (const u of units ?? []) {
        const f0 = Number(u.floor)
        if (!Number.isFinite(f0)) continue
        const sf = Math.max(1, Number(u.span_floors) || 1)
        const fMin = f0
        const fMax = f0 + sf - 1
        if (targetFloor >= fMin && targetFloor <= fMax) {
          if (u?.id) deleteIds.push(u.id)
        }
      }

      // Сдвигаем этажи выше удалённого вниз на 1, чтобы не терялась "лестница" этажности.
      const upsert = (units ?? [])
        .filter((u) => u?.id && !deleteIds.includes(u.id))
        .filter((u) => Number(u.floor) > targetFloor)
        .map((u) => ({
          ...u,
          floor: Number(u.floor) - 1,
        }))

      await saveLayout({ upsert, deleteIds })

      if (!isEditMode) {
        // delete floor plan image row for this floor (if column exists)
        const { error: delPlanErr } = await supabase
          .from('images')
          .delete()
          .eq('entity_type', ENTITY_BUILDING_FLOOR_LEVEL_PLAN)
          .eq('entity_id', selectedBuildingId)
          .eq('floor_level', targetFloor)
        if (delPlanErr && !/floor_level|column|schema cache/i.test(String(delPlanErr.message || ''))) {
          throw delPlanErr
        }
      }

      // Безопасно уменьшаем этажность ровно на 1.
      const currentFloors = Math.max(
        1,
        Number(selectedBuilding?.floors) || Number(floorsDesc?.[0]) || 1
      )
      const nextMax = Math.max(1, currentFloors - 1)
      if (isEditMode) {
        queueBuildingPatch({ floors: nextMax })
      } else {
        const { error: updErr } = await supabase
          .from('buildings')
          .update({ floors: nextMax })
          .eq('id', selectedBuildingId)
        if (updErr && !/floors/i.test(String(updErr.message || ''))) {
          // ignore
        }
      }

      await Promise.all([
        loadUnitsForBuilding(selectedBuildingId),
        loadFloorPlans(selectedBuildingId),
        loadComplexes(),
      ])
    } catch (e) {
      setMsg(e?.message || 'Ошибка удаления этажа')
    } finally {
      setBusy(false)
    }
  }

  function cellClass(unit, isActive, sf, sc) {
    const base =
      'rounded border text-sm flex items-center justify-center cursor-pointer transition-all duration-300 ease-out box-border'
    const size =
      sf > 1
        ? 'min-h-[calc(8.5rem)] h-full w-full px-1 py-1'
        : sc > 1
        ? 'min-h-[4rem] h-full w-full px-1'
        : 'h-16 w-16 min-h-[4rem]'
    const hover = 'hover:scale-[1.03] hover:shadow'
    const ring = isActive ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-slate-950' : ''
    if (!unit)
      return `${base} ${size} ${hover} ${ring} bg-gray-100 text-slate-500 border-slate-300`
    const st = String(unit.status || '').toLowerCase()
    const sold = st === 'sold'
    const booked = st === 'booked' || st === 'reserved'
    if (sold) return `${base} ${size} ${hover} ${ring} bg-red-200 text-red-900 border-red-300`
    if (booked) return `${base} ${size} ${hover} ${ring} bg-amber-200 text-amber-900 border-amber-300`
    return `${base} ${size} ${hover} ${ring} bg-green-200 text-green-900 border-green-300`
  }

  function toggleMergeSelection(unit) {
    if (!unit?.id) return
    setSelectedForMerge((prev) =>
      prev.includes(unit.id) ? prev.filter((x) => x !== unit.id) : [...prev, unit.id]
    )
  }

  function firstFreePositionInRange(floor, range) {
    const slots = assignEntranceSlots(gridUnits, floor, range, perFloor)
    for (let i = 0; i < range.size; i += 1) {
      if (slots[i] == null) return range.start + i
    }
    return null
  }

  function emptyCellKey(floor, position, entrance) {
    return `${floor}:${position}:${entrance}`
  }

  function toggleEmptyCellSelection(floor, position, entrance) {
    const key = emptyCellKey(floor, position, entrance)
    setSelectedEmptyCells((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    )
  }

  const hasPendingChanges =
    Object.keys(pendingLayout?.upsertById || {}).length > 0 ||
    (pendingLayout?.deleteIds || []).length > 0 ||
    Object.keys(pendingBuildingPatch || {}).length > 0

  const selectedUnitsList = useMemo(
    () => units.filter((u) => selectedForMerge.includes(u.id)),
    [units, selectedForMerge]
  )
  const mergeValidation = useMemo(() => {
    if (selectedUnitsList.length < 2) {
      return { ok: false, reason: 'Выберите минимум 2 квартиры', rect: null }
    }
    const entrance = Number(selectedUnitsList[0]?.entrance)
    if (
      !Number.isFinite(entrance) ||
      selectedUnitsList.some((u) => Number(u.entrance) !== entrance)
    ) {
      return { ok: false, reason: 'Квартиры должны быть в одном подъезде', rect: null }
    }
    if (
      selectedUnitsList.some(
        (u) =>
          Math.max(1, Number(u.span_columns) || 1) !== 1 ||
          Math.max(1, Number(u.span_floors) || 1) !== 1
      )
    ) {
      return {
        ok: false,
        reason: 'Нельзя объединять квартиры, уже занимающие несколько ячеек',
        rect: null,
      }
    }
    const floorsSel = selectedUnitsList
      .map((u) => Number(u.floor))
      .filter((n) => Number.isFinite(n))
    const posSel = selectedUnitsList
      .map((u) => Number(u.position))
      .filter((n) => Number.isFinite(n))
    if (!floorsSel.length || !posSel.length) {
      return { ok: false, reason: 'Не хватает координат для объединения', rect: null }
    }
    const rect = {
      entrance,
      minFloor: Math.min(...floorsSel),
      maxFloor: Math.max(...floorsSel),
      minPos: Math.min(...posSel),
      maxPos: Math.max(...posSel),
    }
    const selectedKey = new Set(
      selectedUnitsList.map((u) => `${Number(u.floor)}:${Number(u.position)}`)
    )
    for (let f = rect.minFloor; f <= rect.maxFloor; f += 1) {
      for (let p = rect.minPos; p <= rect.maxPos; p += 1) {
        const key = `${f}:${p}`
        if (!selectedKey.has(key)) {
          return {
            ok: false,
            reason: 'Область должна быть прямоугольником без пропусков',
            rect,
          }
        }
      }
    }
    return { ok: true, reason: '', rect }
  }, [selectedUnitsList])
  return (
    <AdminLayout title="Квартиры">
      {msg ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
          {msg}
        </p>
      ) : null}

      <div className="mb-4 grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm">ЖК</label>
          <select
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={selectedComplexId}
            onChange={(e) => {
              const id = e.target.value
              setSelectedComplexId(id)
              const next =
                complexes.find((c) => c.id === id)?.buildings?.[0]?.id || ''
              setSelectedBuildingId(next)
            }}
          >
            <option value="">— выберите —</option>
            {complexes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || 'Без названия'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm">Дом</label>
          <select
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={selectedBuildingId}
            onChange={(e) => setSelectedBuildingId(e.target.value)}
          >
            <option value="">— выберите —</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || 'Без названия'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedBuilding ? (
        <p className="text-sm text-slate-400">
          Выберите ЖК и дом для редактирования шахматки.
        </p>
      ) : (
        <div
          className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4"
          data-merge-keep="1"
        >
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <button
              type="button"
              onClick={() => {
                if (!isEditMode) handleEditModeToggle()
              }}
              className={`rounded-lg px-3 py-2 text-sm ${
                isEditMode
                  ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                  : 'bg-slate-700 text-slate-100 hover:bg-slate-600'
              }`}
            >
              {isEditMode ? 'Режим редактирования включен' : 'Редактировать шахматку'}
            </button>
            {/* Действия объединения вынесены в floating-панель ниже (при 2+ выделениях). */}
          </div>

          <DndContext onDragEnd={onDragEnd}>
          <div className="overflow-x-auto pb-2">
            <div className="min-w-[980px] space-y-3">
              <div className="flex items-end gap-3">
                <div className="sticky left-0 z-20 flex w-[13.75rem] shrink-0 items-end gap-3 bg-slate-950/95 pr-3 backdrop-blur-sm">
                  <div className="w-12 shrink-0" />
                  <div className="w-40 shrink-0">
                    <div className="mb-1 text-xs font-semibold text-slate-400">Этаж</div>
                    <button
                      type="button"
                      onClick={() => addFloor('up')}
                      disabled={!isEditMode}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:opacity-40"
                    >
                      + Добавить сверху
                    </button>
                  </div>
                </div>
                <div className="flex gap-6">
                  {entranceRanges.map((r) => (
                    <div
                      key={`h-ent-${r.entrance}`}
                      className="space-y-1"
                      onMouseEnter={() => setHoveredEntranceHeader(r.entrance)}
                      onMouseLeave={() => setHoveredEntranceHeader((prev) => (prev === r.entrance ? null : prev))}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <div className="text-center text-xs font-semibold text-orange-300">
                          П{r.entrance}
                        </div>
                        {hoveredEntranceHeader === r.entrance ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => deleteEntrance(r.entrance)}
                            className="rounded border border-rose-800/70 bg-rose-950/30 px-1.5 py-0.5 text-[10px] text-rose-200 hover:bg-rose-900/40 disabled:opacity-50"
                            title={`Удалить подъезд П${r.entrance}`}
                            aria-label={`Удалить подъезд П${r.entrance}`}
                          >
                            🗑
                          </button>
                        ) : null}
                      </div>
                      <div
                        className="grid gap-2"
                        style={{
                          gridTemplateColumns: `repeat(${r.size + 1}, 4rem)`,
                        }}
                      >
                        {Array.from({ length: r.size }, (_, i) => (
                          <div
                            key={`h-${r.entrance}-${i}`}
                            className="h-1 rounded bg-slate-800"
                          />
                        ))}
                        <div className="h-1" />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addEntrance}
                    disabled={!isEditMode}
                    className="h-8 self-center rounded border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200 disabled:opacity-40"
                    title="Добавить подъезд"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="sticky left-0 z-20 flex w-[13.75rem] shrink-0 flex-col gap-2 bg-slate-950/95 pr-3 backdrop-blur-sm">
                  {floorsDesc.map((f) => {
                    const planUrl = floorPlanUrls?.[f] || null
                    return (
                      <div key={`floor-side-${f}`} className="flex min-h-[4rem] gap-3">
                        <div className="flex w-12 shrink-0 items-center justify-center text-sm font-semibold text-slate-300">
                          {f}
                        </div>

                        <div className="w-40 shrink-0 space-y-2">
                          <div className="flex items-center gap-2">
                            <label className="flex-1 cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-center text-xs text-slate-200 hover:bg-slate-800">
                              <input
                                type="file"
                                accept="image/*"
                                disabled={mediaBusy}
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0]
                                  e.target.value = ''
                                  if (!file) return
                                  await uploadFloorPlanForFloor(f, file)
                                }}
                              />
                              Загрузить план
                            </label>
                            {planUrl ? (
                              <button
                                type="button"
                                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
                                onClick={() => setPlanModal({ floor: f, url: planUrl })}
                              >
                                План
                              </button>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            disabled={busy}
                            className="w-full rounded-lg border border-rose-800/70 bg-rose-950/30 px-3 py-2 text-xs text-rose-200 hover:bg-rose-900/30 disabled:opacity-50"
                            onClick={() => deleteFloor(f)}
                          >
                            Удалить этаж
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex min-w-0 flex-1 gap-6">
                  {entranceRanges.map((r) => {
                    const nFloors = floorsDesc.length
                    return (
                      <div
                        key={`ent-col-${r.entrance}`}
                        className="rounded-xl border border-slate-800 bg-slate-950/30 p-3"
                        style={{ marginRight: 0 }}
                      >
                        <div
                          className="grid gap-2"
                          style={{
                            gridTemplateColumns: `repeat(${r.size + 1}, 4rem)`,
                            gridTemplateRows: `repeat(${nFloors}, minmax(4rem, auto))`,
                          }}
                        >
                          {floorsDesc.flatMap((f, fi) => {
                            const rowIdx = fi + 1
                            const slots = assignEntranceSlots(gridUnits, f, r, perFloor)
                            const chunk = []
                            for (let i = 0; i < r.size; i += 1) {
                              const globalPos = r.start + i
                              if (slots[i] === SPAN_MARKER) continue
                              const inMergePreview =
                                !!mergeValidation.rect &&
                                Number(mergeValidation.rect.entrance) === Number(r.entrance) &&
                                f >= mergeValidation.rect.minFloor &&
                                f <= mergeValidation.rect.maxFloor &&
                                globalPos >= mergeValidation.rect.minPos &&
                                globalPos <= mergeValidation.rect.maxPos
                              let u = slots[i]
                              if (u == null) {
                                const cover = findUnitAt(gridUnits, f, globalPos, perFloor)
                                if (
                                  cover &&
                                  !isAnchorCell(cover, f, globalPos, perFloor)
                                ) {
                                  const ce = Number(cover.entrance)
                                  if (
                                    !Number.isFinite(ce) ||
                                    ce === r.entrance
                                  ) {
                                    continue
                                  }
                                }
                              }

                              if (u) {
                                const sc = spanCols(u)
                                const sf = spanFloors(u)
                                const selected = selectedForMerge.includes(u.id)
                                const slotId = dndSlotId(f, globalPos, r.entrance)
                                chunk.push(
                                  <DroppableSlot
                                    key={`${u.id}-${f}-${r.entrance}-${globalPos}`}
                                    slotId={slotId}
                                    style={{
                                      gridColumn: `${i + 1} / span ${sc}`,
                                      gridRow: `${rowIdx} / span ${sf}`,
                                    }}
                                    className="min-h-0 min-w-0"
                                  >
                                    <div
                                      onClick={(e) => {
                                        if (isEditMode) {
                                          setActiveStructureUnitId(u.id)
                                          toggleMergeSelection(u)
                                          return
                                        }
                                        openEditor(f, globalPos)
                                      }}
                                      onDoubleClick={() => {
                                        if (!isEditMode) return
                                        if (
                                          Number(u?.span_columns) > 1 ||
                                          Number(u?.span_floors) > 1 ||
                                          Boolean(u?.is_combined)
                                        ) {
                                          splitUnit(u)
                                        }
                                      }}
                                      onContextMenu={(e) => {
                                        e.preventDefault()
                                        if (!isEditMode) return
                                        setContextMenu({
                                          x: e.clientX,
                                          y: e.clientY,
                                          floor: f,
                                          position: globalPos,
                                          entrance: r.entrance,
                                          unit: u,
                                        })
                                      }}
                                    >
                                      <DraggableUnit unitId={u.id} disabled={!isEditMode}>
                                        <div
                                          className={`${cellClass(
                                            u,
                                            isEditMode && activeStructureUnitId === u.id,
                                            sf,
                                            sc
                                          )} ${
                                            selected
                                              ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-slate-950'
                                              : inMergePreview
                                              ? 'ring-2 ring-sky-300 ring-offset-1 ring-offset-slate-950'
                                              : ''
                                          }`}
                                          title={`№${u.number ?? '—'} · ${u.rooms ?? '—'}к · ${u.area ?? '—'}м² · ${u.price ?? '—'} ₽`}
                                        >
                                          <span className="flex flex-col items-center justify-center text-center leading-tight">
                                            <span>{u.number ?? `#${globalPos}`}</span>
                                          </span>
                                        </div>
                                      </DraggableUnit>
                                    </div>
                                  </DroppableSlot>
                                )
                              } else {
                                const slotId = dndSlotId(f, globalPos, r.entrance)
                                chunk.push(
                                  <DroppableSlot
                                    key={`e-${f}-${r.entrance}-${globalPos}`}
                                    slotId={slotId}
                                    className="min-h-0 min-w-0"
                                    style={{
                                      gridColumn: i + 1,
                                      gridRow: rowIdx,
                                    }}
                                  >
                                    <div
                                      onClick={() => {
                                        if (isEditMode) return
                                        openEditor(f, globalPos)
                                      }}
                                      onContextMenu={(e) => {
                                        e.preventDefault()
                                        if (!isEditMode) return
                                        setContextMenu({
                                          x: e.clientX,
                                          y: e.clientY,
                                          floor: f,
                                          position: globalPos,
                                          entrance: r.entrance,
                                          unit: null,
                                        })
                                      }}
                                    >
                                      <div
                                        onClick={() => {
                                          if (!isEditMode) return
                                          toggleEmptyCellSelection(f, globalPos, r.entrance)
                                        }}
                                        className={`${cellClass(null, false, 1, 1)} ${
                                          selectedEmptyCells.includes(
                                            emptyCellKey(f, globalPos, r.entrance)
                                          )
                                            ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-slate-950'
                                            : ''
                                        } ${
                                          inMergePreview
                                            ? 'ring-2 ring-sky-300 ring-offset-1 ring-offset-slate-950'
                                            : ''
                                        }`}
                                      >
                                        +
                                      </div>
                                    </div>
                                  </DroppableSlot>
                                )
                              }
                            }

                            chunk.push(
                              <button
                                key={`add-${f}-${r.entrance}`}
                                type="button"
                                className="h-16 w-16 self-center rounded border border-slate-700 bg-slate-900 text-sm text-slate-200 hover:bg-slate-800"
                                style={{ gridColumn: r.size + 1, gridRow: rowIdx }}
                                onClick={() => {
                                  const pos = firstFreePositionInRange(f, r)
                                  if (!pos) return
                                  openEditor(f, pos)
                                }}
                              >
                                +
                              </button>
                            )

                            return chunk
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="sticky left-0 z-20 flex w-[13.75rem] shrink-0 gap-3 bg-slate-950/95 pr-3 backdrop-blur-sm">
                  <div className="w-12 shrink-0" />
                  <div className="w-40 shrink-0">
                    <button
                      type="button"
                      onClick={() => addFloor('down')}
                      disabled={!isEditMode}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 disabled:opacity-40"
                    >
                      + Добавить снизу
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </DndContext>
          {commercialUnitsForCards.length > 0 ? (
            <CommercialPremisesSection
              units={commercialUnitsForCards}
              variant="admin"
            />
          ) : null}
        </div>
      )}

      {contextMenu ? (
        <div
          className="fixed z-[60] min-w-44 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.unit ? (
            <>
              <button
                type="button"
                className="block w-full rounded px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                onClick={() => {
                  openEditor(contextMenu.floor, contextMenu.position)
                  setContextMenu(null)
                }}
              >
                Редактировать
              </button>
              <button
                type="button"
                className="block w-full rounded px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                onClick={() => {
                  toggleMergeSelection(contextMenu.unit)
                  setContextMenu(null)
                }}
              >
                Выбрать для объединения
              </button>
              {(Number(contextMenu.unit.span_columns) > 1 ||
                Number(contextMenu.unit.span_floors) > 1) ? (
                <button
                  type="button"
                  className="block w-full rounded px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                  onClick={() => {
                    splitUnit(contextMenu.unit)
                    setContextMenu(null)
                  }}
                >
                  Разделить
                </button>
              ) : null}
              <button
                type="button"
                className="block w-full rounded px-3 py-2 text-left text-sm text-rose-200 hover:bg-rose-900/40"
                onClick={() => {
                  onDeleteUnitById(contextMenu.unit.id)
                  setContextMenu(null)
                }}
              >
                Удалить
              </button>
            </>
          ) : (
            <button
              type="button"
              className="block w-full rounded px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
              onClick={() => {
                openEditor(contextMenu.floor, contextMenu.position)
                setContextMenu(null)
              }}
            >
              Создать квартиру
            </button>
          )}
          {selectedForMerge.length >= 2 ? (
            <button
              type="button"
              className="mt-1 block w-full rounded bg-blue-600 px-3 py-2 text-left text-sm text-white hover:bg-blue-500"
              onClick={() => {
                mergeSelected()
                setContextMenu(null)
              }}
            >
              Объединить ({selectedForMerge.length})
            </button>
          ) : null}
        </div>
      ) : null}

      {isEditMode && selectedForMerge.length >= 2 ? (
        <div
          className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2 shadow-2xl"
          data-merge-keep="1"
        >
          <button
            type="button"
            disabled={!mergeValidation.ok || busy}
            title={mergeValidation.ok ? '' : mergeValidation.reason}
            onClick={mergeSelected}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Объединить {selectedForMerge.length}
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedForMerge([])
              setSelectedEmptyCells([])
            }}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200"
          >
            Отменить выделение
          </button>
        </div>
      ) : null}

      {isEditMode && hasPendingChanges ? (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2 shadow-2xl">
          <span className="text-xs text-slate-300">Есть несохраненные изменения</span>
          <button
            type="button"
            onClick={handleEditModeToggle}
            disabled={busy}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Сохранить
          </button>
          <button
            type="button"
            onClick={cancelEditModeChanges}
            disabled={busy}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-50"
          >
            Отменить
          </button>
        </div>
      ) : null}

      {planModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPlanModal(null)}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-100">
                План этажа {planModal.floor}
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
                onClick={() => setPlanModal(null)}
              >
                Закрыть
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={planModal.url}
              alt=""
              className="max-h-[75vh] w-full rounded-lg border border-slate-700 bg-white object-contain"
            />
          </div>
        </div>
      ) : null}

      <UnitModal
        activeCell={activeCell}
        form={form}
        setForm={setForm}
        onSaveUnit={onSaveUnit}
        onDeleteUnit={onDeleteUnit}
        onSplitUnit={() => splitUnit(activeCell?.unit)}
        closeEditor={closeEditor}
        uploadUnitMedia={uploadUnitMedia}
        removeUnitMedia={removeUnitMedia}
        mediaBusy={mediaBusy}
      />
    </AdminLayout>
  )
}
