import MiniChessboard from './MiniChessboard'
import {
  formatComplexName,
  formatName,
  getComplexDeveloper,
  sortBuildingsByName,
} from '../../lib/complexes'

const fmtPrice = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Math.round(Number(n)).toLocaleString('ru-RU')} ₽`
}

export default function ComplexCard({
  complex,
  filteredIds,
  availableByBuilding,
  matchedByBuilding,
  hasFilters,
  onOpen,
}) {
  const title = formatComplexName(complex?.name ?? '')
  const dev = getComplexDeveloper(complex)
  const developerLabel = formatName(dev?.name || '')
  const buildings = [...(complex?.buildings ?? [])].sort(sortBuildingsByName)

  const matchedTotal = buildings.reduce(
    (s, b) => s + (matchedByBuilding[b.id] ?? 0),
    0
  )
  const availableTotal = buildings.reduce(
    (s, b) => s + (availableByBuilding[b.id] ?? 0),
    0
  )

  // Минимальная цена среди отфильтрованных квартир этого ЖК (или среди всех доступных, если фильтра нет)
  let minPrice = null
  for (const b of buildings) {
    for (const u of b?.units ?? []) {
      if (hasFilters && !filteredIds.has(u.id)) continue
      if (!hasFilters) {
        const s = String(u?.status ?? '').toLowerCase()
        if (s === 'booked' || s === 'reserved' || s === 'sold' || s === 'closed') continue
      }
      const p = Number(u?.price)
      if (Number.isFinite(p) && p > 0 && (minPrice == null || p < minPrice)) {
        minPrice = p
      }
    }
  }

  const imageUrl = complex?.image || null
  const counterLabel = hasFilters
    ? `${matchedTotal} из ${availableTotal}`
    : `${availableTotal}`

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="group flex w-full flex-col overflow-hidden rounded-2xl bg-white text-left shadow transition-shadow duration-200 hover:shadow-lg disabled:cursor-default disabled:hover:shadow"
    >
      <div className="relative h-32 bg-gray-200">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
            Нет фото
          </div>
        )}
        <div className="absolute left-2 top-2 rounded-md bg-white/95 px-2 py-1 text-xs font-medium text-gray-800 shadow-sm">
          {counterLabel} {hasFilters ? 'подходящих' : 'квартир'}
        </div>
      </div>

      <div className="flex flex-col gap-2 p-4">
        <div>
          <h3 className="truncate text-base font-semibold text-gray-900">{title}</h3>
          {developerLabel ? (
            <p className="truncate text-xs text-gray-500">{developerLabel}</p>
          ) : null}
        </div>

        <div className="text-sm font-semibold text-blue-600">
          {minPrice != null ? `от ${fmtPrice(minPrice)}` : 'Нет в продаже'}
        </div>

        <div className="mt-1 space-y-2 border-t border-gray-100 pt-2">
          {buildings.map((b) => {
            const matched = matchedByBuilding[b.id] ?? 0
            const available = availableByBuilding[b.id] ?? 0
            const buildingLabel = formatName(b.name) || 'Корпус'
            return (
              <div key={b.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-gray-700">
                    {buildingLabel}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {hasFilters ? `${matched} из ${available}` : `${available} квартир`}
                  </div>
                </div>
                <MiniChessboard
                  units={b.units}
                  matchedIds={filteredIds}
                  hasFilters={hasFilters}
                  className="shrink-0"
                />
              </div>
            )
          })}
        </div>
      </div>
    </button>
  )
}
