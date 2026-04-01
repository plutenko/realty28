import { useMemo, useState } from 'react'

function formatPriceRub(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('ru-RU')
}

/** DB-строка или объект шахматки: коммерция не попадает в жилую сетку. */
export function isCommercialUnitRow(u) {
  if (!u || typeof u !== 'object') return false
  if (u.is_commercial === true) return true
  return String(u.layout_title ?? '').toLowerCase().includes('коммерц')
}

function commercialCardStatusClass(status, variant) {
  const st = String(status || '').toLowerCase()
  const sold = st === 'sold' || st === 'продана' || st === 'продано'
  const booked =
    st === 'booked' ||
    st === 'reserved' ||
    st === 'бронь' ||
    st === 'на брони'
  if (sold) return 'bg-red-200 text-red-900 border-red-300'
  if (booked) return 'bg-amber-200 text-amber-900 border-amber-300'
  return variant === 'admin'
    ? 'bg-white text-slate-900 border border-slate-300'
    : 'bg-white text-gray-900 border border-gray-200'
}

/**
 * Горизонтальные карточки коммерции; ширина ~ доля площади в группе этажа.
 */
export function CommercialPremisesSection({ units, variant = 'public' }) {
  const [open, setOpen] = useState(false)
  const list = units ?? []
  if (!list.length) return null

  const byFloor = new Map()
  for (const u of list) {
    const f = Number(u.floor) || 1
    if (!byFloor.has(f)) byFloor.set(f, [])
    byFloor.get(f).push(u)
  }
  const floors = [...byFloor.keys()].sort((a, b) => a - b)

  const title =
    floors.length === 1 && floors[0] === 1
      ? 'Коммерческие помещения (1 этаж)'
      : 'Коммерческие помещения'

  const borderTop =
    variant === 'admin' ? 'border-slate-800' : 'border-gray-200'
  const btnHover =
    variant === 'admin'
      ? 'hover:bg-slate-800 text-slate-100'
      : 'hover:bg-gray-50 text-gray-900'

  return (
    <div className={`mt-6 border-t pt-4 ${borderTop}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold transition-colors ${btnHover}`}
      >
        <span>{title}</span>
        <span className="text-xs opacity-70" aria-hidden>
          {open ? '▼' : '▶'}
        </span>
      </button>
      {open ? (
        <div className="mt-3 space-y-4">
          {floors.map((f) => {
            const row = [...(byFloor.get(f) || [])].sort((a, b) =>
              String(a.layout_title ?? '').localeCompare(
                String(b.layout_title ?? ''),
                'ru'
              )
            )
            const areas = row.map((u) => {
              const a = Number(u.area)
              return Number.isFinite(a) && a > 0 ? a : 0
            })
            const sumA = areas.reduce((x, y) => x + y, 0) || 1
            const maxA = Math.max(...areas, 1)

            return (
              <div key={f}>
                {floors.length > 1 ? (
                  <div
                    className={`mb-2 text-xs font-medium ${
                      variant === 'admin' ? 'text-slate-400' : 'text-gray-600'
                    }`}
                  >
                    {f} этаж
                  </div>
                ) : null}
                <div className="flex flex-row flex-wrap gap-2">
                  {row.map((u) => {
                    const a = Number(u.area)
                    const hasA = Number.isFinite(a) && a > 0
                    const flexGrow = hasA ? a / sumA : 1 / row.length
                    const basisPct = hasA
                      ? `${Math.max(8, (a / maxA) * 100)}%`
                      : `${100 / Math.max(row.length, 1)}%`
                    const areaStr = hasA ? `${a} м²` : '—'
                    return (
                      <div
                        key={u.id ?? u.external_id ?? String(u.layout_title)}
                        className={`min-w-[6rem] rounded-lg border p-3 text-xs shadow-sm ${commercialCardStatusClass(
                          u.status,
                          variant
                        )}`}
                        style={{
                          flexGrow,
                          flexBasis: basisPct,
                          minWidth: '6.5rem',
                          maxWidth: '100%',
                        }}
                      >
                        <div className="font-semibold leading-tight">
                          {u.layout_title ?? 'Коммерция'}
                        </div>
                        <div className="mt-1 opacity-90">{areaStr}</div>
                        <div className="mt-1 font-medium">
                          {formatPriceRub(u.price)} ₽
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function sortByNumber(a, b) {
  const aVal = Number(a.number ?? a.position ?? 0)
  const bVal = Number(b.number ?? b.position ?? 0)
  return aVal - bVal
}

export function spanCols(apt) {
  const n = Number(apt?.span_columns)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

export function spanFloors(apt) {
  const n = Number(apt?.span_floors)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

/** Этажи сверху вниз: от верхнего к нижнему; учитывает span_floors (нижняя граница квартиры). */
function getFloorsDescending(floorsCount, apartments) {
  let maxFromData = 0
  let minFromData = 1
  let lowestOccupied = 1

  for (const a of apartments || []) {
    const f = Number(a?.floor)
    if (!Number.isFinite(f)) continue
    const sf = spanFloors(a)
    const fTop = f + sf - 1
    maxFromData = Math.max(maxFromData, fTop)
    minFromData = Math.min(minFromData, f)
    lowestOccupied = Math.min(lowestOccupied, f)
  }

  const top = Math.max(Number(floorsCount) || 0, maxFromData)

  if (top < 1) {
    if (apartments.length > 0 && maxFromData === 0) return [0]
    return []
  }

  const bottom = apartments.length
    ? Math.min(1, lowestOccupied, minFromData)
    : Math.min(1, minFromData)

  const out = []
  for (let f = top; f >= bottom; f -= 1) {
    out.push(f)
  }
  return out
}

function groupByFloor(apartments) {
  const map = new Map()
  for (const a of apartments) {
    const f = a.floor ?? 0
    if (!map.has(f)) map.set(f, [])
    map.get(f).push(a)
  }
  for (const arr of map.values()) {
    arr.sort(sortByNumber)
  }
  return map
}

function getPosition(apt, maxPositions) {
  const p = Number(apt?.position)
  if (Number.isFinite(p) && p > 0) return p
  const n = Number(apt?.number)
  if (Number.isFinite(n) && n > 0)
    return (n % maxPositions) || maxPositions
  return null
}

function getMaxPositions(unitsPerFloor) {
  const val = Number(unitsPerFloor)
  if (!Number.isFinite(val) || val <= 0) return 4
  return Math.floor(val)
}

function findCoveringAt(apartments, f, p, maxPos) {
  for (const a of apartments || []) {
    const p0 = getPosition(a, maxPos)
    const f0 = Number(a.floor)
    if (!Number.isFinite(p0) || !Number.isFinite(f0)) continue
    const sc = spanCols(a)
    const sf = spanFloors(a)
    const pMin = p0
    const pMax = p0 + sc - 1
    const fMin = f0
    const fMax = f0 + sf - 1
    if (f >= fMin && f <= fMax && p >= pMin && p <= pMax) return a
  }
  return null
}

function isAnchorCell(apt, f, p, maxPos) {
  const p0 = getPosition(apt, maxPos)
  const f0 = Number(apt.floor)
  const sf = spanFloors(apt)
  if (!Number.isFinite(p0) || !Number.isFinite(f0)) return false
  const fTop = f0 + sf - 1
  return sf <= 1 ? f0 === f && p0 === p : fTop === f && p0 === p
}

function ApartmentCard({ apt, className = '' }) {
  const sold = apt.status === 'sold'
  const booked = apt.status === 'booked'
  const ap = apt
  const sf = spanFloors(apt)

  const areaStr =
    apt.area != null && !Number.isNaN(Number(apt.area))
      ? Number(apt.area)
      : '—'
  const ppmStr =
    apt.pricePerMeter != null && !Number.isNaN(Number(apt.pricePerMeter))
      ? formatPriceRub(apt.pricePerMeter)
      : '—'

  return (
    <div
      className={`flex h-full min-h-0 flex-col justify-between overflow-hidden rounded p-2 text-xs transition hover:scale-[1.02] ${
        sf > 1 ? 'min-h-[calc(12rem+0.5rem)] py-2' : 'min-h-[6rem]'
      } ${
        sold
          ? 'bg-rose-200 text-rose-900'
          : booked
          ? 'bg-amber-200 text-amber-900'
          : 'bg-green-400 text-white'
      } ${className}`}
      title={`№${ap.number ?? '—'} · ${areaStr} м² · ${formatPriceRub(apt.price)} ₽`}
    >
      <div className="flex justify-between text-[10px]">
        <span>{ap.rooms}К</span>
        <span>
          {ap.number != null && ap.number !== ''
            ? `№${ap.number}`
            : `${ap.position ?? ''}`}
        </span>
      </div>
      <div className="text-center font-bold">{formatPriceRub(apt.price)} ₽</div>
      <div className="leading-tight">
        {areaStr} м² – {ppmStr} ₽/м²
      </div>
    </div>
  )
}

function EmptyCell() {
  return (
    <div className="h-full min-h-[6rem] rounded border border-dashed border-gray-200 bg-gray-50/80" />
  )
}

function planUrlForFloor(floorPlanByFloor, f) {
  if (!floorPlanByFloor || typeof floorPlanByFloor !== 'object') return null
  const k1 = floorPlanByFloor[f]
  const k2 = floorPlanByFloor[String(f)]
  if (k1) return k1
  if (k2) return k2
  const n = Number(f)
  return Number.isFinite(n) ? floorPlanByFloor[n] ?? null : null
}

/** Глобальный индекс колонки (1-based всю сетку) для слота позиции p и ширин подъездов. */
function gridColForSlot(p, entranceWidths, colFirstApt) {
  const widths = entranceWidths
  const total = widths.reduce((a, b) => a + b, 0)
  const pc = Math.min(Math.max(1, p), Math.max(1, total))
  let col = colFirstApt
  let pAcc = 0
  for (let i = 0; i < widths.length; i += 1) {
    if (i > 0) col += 1
    for (let j = 0; j < widths[i]; j += 1) {
      pAcc += 1
      if (pAcc === pc) return col
      col += 1
    }
  }
  return colFirstApt
}

/** По этажу с макс. числом квартир: сколько ячеек в подъезде 1, 2, … */
function inferEntranceWidthsFromApartments(apartments) {
  const byFloor = new Map()
  for (const a of apartments || []) {
    const f = Number(a?.floor)
    const e = Number(a?.entrance)
    if (!Number.isFinite(f) || f < 1) continue
    if (!Number.isFinite(e) || e < 1) continue
    if (!byFloor.has(f)) byFloor.set(f, new Map())
    const m = byFloor.get(f)
    m.set(e, (m.get(e) || 0) + 1)
  }
  let best = null
  let bestSum = 0
  for (const m of byFloor.values()) {
    const keys = [...m.keys()].sort((a, b) => a - b)
    const arr = keys.map((k) => m.get(k))
    const sum = arr.reduce((acc, x) => acc + x, 0)
    if (sum > bestSum) {
      bestSum = sum
      best = arr
    }
  }
  return best && best.length >= 2 ? best : null
}

/**
 * Шахматка квартир по этажам (поддержка span_columns / span_floors).
 * @param {number[]|null} [unitsPerEntrance] — ширина подъездов [4,5]; между блоками визуальный зазор.
 * @param {Record<number, string>} [floorPlanByFloor] — URL плана по номеру этажа (колонка слева от квартир).
 */
export default function BuildingChessboard({
  apartments = [],
  floorsCount,
  unitsPerFloor = 4,
  unitsPerEntrance = null,
  floorPlanByFloor = null,
}) {
  const { gridApartments, commercialUnits } = useMemo(() => {
    const grid = []
    const comm = []
    for (const a of apartments || []) {
      if (isCommercialUnitRow(a)) comm.push(a)
      else grid.push(a)
    }
    return { gridApartments: grid, commercialUnits: comm }
  }, [apartments])

  const byFloor = useMemo(() => groupByFloor(gridApartments), [gridApartments])

  const maxSlotFromPositions = useMemo(() => {
    let m = 0
    for (const a of gridApartments || []) {
      const p = Number(a?.position)
      const sc = spanCols(a)
      if (Number.isFinite(p) && p > 0) m = Math.max(m, p + sc - 1)
    }
    return m
  }, [gridApartments])

  const entranceWidths = useMemo(() => {
    const parse = (arr) => {
      if (!Array.isArray(arr)) return null
      const w = arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      return w.length >= 2 ? w : null
    }
    const fromProps = parse(unitsPerEntrance)
    const inferred = inferEntranceWidthsFromApartments(gridApartments)
    const sumProps = fromProps?.reduce((a, b) => a + b, 0) ?? 0
    const sumInf = inferred?.reduce((a, b) => a + b, 0) ?? 0

    if (fromProps && sumProps >= maxSlotFromPositions && maxSlotFromPositions > 0) {
      return fromProps
    }
    if (
      inferred &&
      (!fromProps ||
        (maxSlotFromPositions > 0 && sumProps < maxSlotFromPositions) ||
        (sumInf === maxSlotFromPositions && sumProps !== maxSlotFromPositions))
    ) {
      return inferred
    }
    return fromProps ?? inferred
  }, [unitsPerEntrance, gridApartments, maxSlotFromPositions])

  const maxUnitsOnAnyFloor = useMemo(() => {
    let m = 0
    for (const [, list] of byFloor.entries()) {
      m = Math.max(m, list?.length || 0)
    }
    return m
  }, [byFloor])

  const slotCountFromEntrances = useMemo(() => {
    if (!entranceWidths) return 0
    return entranceWidths.reduce((a, b) => a + b, 0)
  }, [entranceWidths])

  const maxPositions = useMemo(() => {
    const fromSettings = getMaxPositions(unitsPerFloor)
    const fromCountFallback = Math.max(0, maxUnitsOnAnyFloor)
    let fromData = 0
    for (const a of gridApartments || []) {
      const p = Number(a?.position)
      const sc = spanCols(a)
      if (Number.isFinite(p) && p > 0) {
        fromData = Math.max(fromData, p + sc - 1)
      }
    }
    if (fromData === 0) {
      const widthBasis = Math.max(1, fromSettings, fromCountFallback)
      for (const a of gridApartments || []) {
        const p = getPosition(a, widthBasis)
        const sc = spanCols(a)
        if (p != null && p > 0) fromData = Math.max(fromData, p + sc - 1)
      }
    }
    const linear = Math.max(fromSettings, fromData || 0, fromCountFallback)
    if (slotCountFromEntrances > 0) {
      return Math.max(linear, slotCountFromEntrances)
    }
    return linear
  }, [
    gridApartments,
    unitsPerFloor,
    maxUnitsOnAnyFloor,
    slotCountFromEntrances,
  ])

  const floorsOrder = useMemo(
    () => getFloorsDescending(floorsCount, gridApartments),
    [floorsCount, gridApartments]
  )

  /** Этажи, где есть хотя бы одна жилая квартира (с учётом span_floors). */
  const residentialFloors = useMemo(() => {
    const s = new Set()
    for (const a of gridApartments || []) {
      const f0 = Number(a?.floor)
      if (!Number.isFinite(f0)) continue
      const sf = spanFloors(a)
      for (let ff = f0; ff <= f0 + sf - 1; ff += 1) s.add(ff)
    }
    return s
  }, [gridApartments])

  /** Этажи, на которых есть коммерция (по данным карточек внизу). */
  const commercialFloors = useMemo(() => {
    const s = new Set()
    for (const u of commercialUnits || []) {
      const f = Number(u?.floor)
      if (Number.isFinite(f)) s.add(f)
    }
    return s
  }, [commercialUnits])

  /** Скрыть этаж в сетке, если на нём только коммерция и ни одной жилой квартиры. */
  const floorsToRender = useMemo(() => {
    const base =
      floorsOrder.length > 0
        ? floorsOrder
        : [...byFloor.keys()].sort((a, b) => b - a)
    return base.filter(
      (f) => !commercialFloors.has(f) || residentialFloors.has(f)
    )
  }, [floorsOrder, byFloor, commercialFloors, residentialFloors])

  const planColActive = useMemo(() => {
    if (!floorPlanByFloor || typeof floorPlanByFloor !== 'object') return false
    for (const f of floorsToRender) {
      if (planUrlForFloor(floorPlanByFloor, f)) return true
    }
    return false
  }, [floorPlanByFloor, floorsToRender])

  const colFirstApt = planColActive ? 3 : 2
  const colPlan = 2

  const gridTemplateColumns = useMemo(() => {
    if (entranceWidths?.length) {
      const inner = entranceWidths
        .map((w, i) => {
          const chunk = `repeat(${w}, minmax(0, 1fr))`
          if (i === 0) return chunk
          return `0.625rem ${chunk}`
        })
        .join(' ')
      return planColActive
        ? `2.5rem minmax(4.5rem, 7rem) ${inner}`
        : `2.5rem ${inner}`
    }
    return planColActive
      ? `2.5rem minmax(4.5rem, 7rem) repeat(${maxPositions}, minmax(0, 1fr))`
      : `2.5rem repeat(${maxPositions}, minmax(0, 1fr))`
  }, [entranceWidths, maxPositions, planColActive])

  if (!gridApartments?.length && commercialUnits.length > 0) {
    return (
      <CommercialPremisesSection units={commercialUnits} variant="public" />
    )
  }

  if (!floorsOrder.length && (!gridApartments || gridApartments.length === 0)) {
    return (
      <p className="text-sm text-gray-500">Нет квартир для отображения</p>
    )
  }

  const nRows = floorsToRender.length

  const gridItems = []
  for (let fi = 0; fi < nRows; fi += 1) {
    const f = floorsToRender[fi]
    const row = fi + 1
    gridItems.push(
      <div
        key={`lab-${f}`}
        className="flex items-center justify-center text-sm font-medium text-gray-700"
        style={{ gridColumn: 1, gridRow: row }}
      >
        {f}
      </div>
    )

    if (planColActive) {
      const u = planUrlForFloor(floorPlanByFloor, f)
      gridItems.push(
        <div
          key={`plan-${f}`}
          className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-white p-1"
          style={{ gridColumn: colPlan, gridRow: row }}
        >
          {u ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={u}
              alt={`План этажа ${f}`}
              className="max-h-[5.5rem] w-full max-w-full object-contain"
            />
          ) : (
            <span className="px-1 text-center text-[10px] text-gray-300">—</span>
          )}
        </div>
      )
    }

    for (let p = 1; p <= maxPositions; p += 1) {
      const apt = findCoveringAt(gridApartments, f, p, maxPositions)
      /* Ячейка входит в вертикальный охват квартиры, якорь — на другом этаже: не ставим пустой слот */
      if (apt && !isAnchorCell(apt, f, p, maxPositions)) continue

      const aptCol = entranceWidths?.length
        ? gridColForSlot(p, entranceWidths, colFirstApt)
        : p + colFirstApt - 1

      if (apt && isAnchorCell(apt, f, p, maxPositions)) {
        const sc = spanCols(apt)
        const sf = spanFloors(apt)
        gridItems.push(
          <div
            key={apt.id}
            style={{
              gridColumn: `${aptCol} / span ${sc}`,
              gridRow: `${row} / span ${sf}`,
            }}
            className="min-h-0 min-w-0"
          >
            <ApartmentCard apt={apt} />
          </div>
        )
      } else {
        gridItems.push(
          <div
            key={`e-${f}-${p}`}
            style={{ gridColumn: aptCol, gridRow: row }}
            className="min-h-0 min-w-0"
          >
            <EmptyCell />
          </div>
        )
      }
    }
  }

  return (
    <>
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns,
          gridTemplateRows: `repeat(${nRows}, minmax(6rem, auto))`,
        }}
      >
        {gridItems}
      </div>
      {commercialUnits.length > 0 ? (
        <CommercialPremisesSection units={commercialUnits} variant="public" />
      ) : null}
    </>
  )
}

/** Маппинг юнитов из БД в формат шахматки (схема: units.price, units.status, …) */
export function mapUnitsToChessboardApartments(units) {
  return (units ?? []).map((u) => {
    const price = u.price != null ? Number(u.price) : 0
    const area = Number(u.area ?? 0)
    let pricePerMeter = null
    if (u.price_per_meter != null && !Number.isNaN(Number(u.price_per_meter))) {
      pricePerMeter = Number(u.price_per_meter)
    } else if (area > 0 && price) {
      pricePerMeter = Math.round(price / area)
    }
    const st = String(u.status ?? 'available').toLowerCase()
    const status =
      st === 'sold' || st === 'продана' || st === 'продано'
        ? 'sold'
        : st === 'booked' || st === 'reserved' || st === 'бронь' || st === 'на брони'
        ? 'booked'
        : 'available'
    const numRaw = u.number
    const posRaw = u.position
    const number =
      numRaw != null && numRaw !== '' ? Number(numRaw) : null
    const position =
      posRaw != null && posRaw !== '' ? Number(posRaw) : null
    const sc = Number(u.span_columns)
    const sf = Number(u.span_floors)
    const isCommercial =
      Boolean(u.is_commercial) ||
      String(u.layout_title ?? '').toLowerCase().includes('коммерц')
    return {
      id: u.id,
      number: Number.isFinite(number) ? number : null,
      position: Number.isFinite(position) ? position : null,
      floor: u.floor ?? 0,
      entrance: u.entrance != null ? Number(u.entrance) : null,
      rooms: u.rooms ?? 0,
      area,
      price,
      pricePerMeter,
      status,
      is_commercial: isCommercial,
      layout_title: u.layout_title ?? null,
      layout_image_url: u.layout_image_url ?? null,
      finish_image_url: u.finish_image_url ?? null,
      span_columns: Number.isFinite(sc) && sc >= 1 ? sc : 1,
      span_floors: Number.isFinite(sf) && sf >= 1 ? sf : 1,
      is_combined: Boolean(u.is_combined),
      combined_unit_ids: Array.isArray(u.combined_unit_ids)
        ? u.combined_unit_ids
        : [],
    }
  })
}
