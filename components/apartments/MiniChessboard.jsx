import { useMemo } from 'react'

const CELL = 6
const GAP = 1

function statusKey(u) {
  const s = String(u?.status ?? '').toLowerCase()
  if (s === 'sold' || s === 'closed' || s === 'продана' || s === 'продано') return 'sold'
  if (s === 'booked' || s === 'reserved' || s === 'бронь' || s === 'на брони') return 'booked'
  return 'available'
}

const COLOR = {
  available: '#10b981',
  available_muted: '#bbf7d0',
  booked: '#f59e0b',
  booked_muted: '#fde68a',
  sold: '#9ca3af',
  commercial: '#3b82f6',
  commercial_muted: '#bfdbfe',
}

function colorFor(unit, isMatched, hasFilters) {
  const key = statusKey(unit)
  const isCommercial = Boolean(unit?.is_commercial)
  if (key === 'sold') return COLOR.sold
  if (isCommercial) {
    return hasFilters && !isMatched ? COLOR.commercial_muted : COLOR.commercial
  }
  if (key === 'booked') {
    return hasFilters && !isMatched ? COLOR.booked_muted : COLOR.booked
  }
  return hasFilters && !isMatched ? COLOR.available_muted : COLOR.available
}

/** Извлекаем геометрию здания: maxFloor, maxPosition, сетка квартир */
function useGeometry(units) {
  return useMemo(() => {
    let maxFloor = 0
    let maxPos = 0
    const cells = []
    for (const u of units ?? []) {
      const floor = Number(u?.floor ?? 0)
      const pos = Number(u?.position ?? 0)
      if (!Number.isFinite(floor) || floor <= 0) continue
      if (!Number.isFinite(pos) || pos <= 0) continue
      if (floor > maxFloor) maxFloor = floor
      if (pos > maxPos) maxPos = pos
      cells.push({ id: u.id, floor, position: pos, unit: u })
    }
    return { maxFloor, maxPos, cells }
  }, [units])
}

export default function MiniChessboard({
  units,
  matchedIds,
  hasFilters,
  className = '',
}) {
  const { maxFloor, maxPos, cells } = useGeometry(units)
  if (maxFloor === 0 || maxPos === 0 || !cells.length) {
    return null
  }
  const width = maxPos * CELL + (maxPos - 1) * GAP
  const height = maxFloor * CELL + (maxFloor - 1) * GAP

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`block w-full max-w-[180px] ${className}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {cells.map(({ id, floor, position, unit }) => {
        const x = (position - 1) * (CELL + GAP)
        const y = (maxFloor - floor) * (CELL + GAP)
        const isMatched = matchedIds ? matchedIds.has(id) : true
        const fill = colorFor(unit, isMatched, hasFilters)
        return (
          <rect
            key={id}
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            rx={1}
            fill={fill}
          />
        )
      })}
    </svg>
  )
}
