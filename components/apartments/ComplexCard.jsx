import {
  formatComplexName,
  formatName,
  getComplexDeveloper,
} from '../../lib/complexes'

const fmtPrice = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Math.round(Number(n)).toLocaleString('ru-RU')} ₽`
}

/**
 * Карточка одного корпуса (литера) — стиль 1:1 с тем что было на /buildings.
 * Шахматка не превью, а полная — открывается по клику «Смотреть шахматку».
 */
export default function ComplexCard({
  complex,
  building,
  filteredIds,
  matched,
  available,
  hasFilters,
  onOpen,
}) {
  const complexTitle = formatComplexName(complex?.name ?? '')
  const buildingTitle = formatName(building?.name ?? '')
  const dev = getComplexDeveloper(complex)
  const developerLabel = formatName(dev?.name || '')
  const imageUrl = complex?.image || null

  let minPrice = null
  for (const u of building?.units ?? []) {
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

  const priceLine = minPrice != null ? `от ${fmtPrice(minPrice)}` : 'Нет в продаже'

  const counterLabel = hasFilters
    ? `${matched} из ${available} подходящих`
    : `${available} квартир`

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow transition-shadow duration-200 hover:shadow-xl">
      <div className="relative h-40 bg-gray-200">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover transition duration-200 hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
            Нет фото
          </div>
        )}
        {available > 0 ? (
          <div className="absolute left-2 top-2 rounded bg-white/95 px-2 py-1 text-xs font-medium text-gray-800 shadow">
            {counterLabel}
          </div>
        ) : null}
      </div>

      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-900">{complexTitle}</h3>
        <p className="mt-0.5 text-sm font-medium text-gray-700">{buildingTitle}</p>
        <p className="mt-1 text-xs text-gray-500">{developerLabel || '—'}</p>
        {building?.floors ? (
          <p className="mt-1 text-xs text-gray-500">{building.floors} этажей</p>
        ) : null}

        <div className="mt-3 text-lg font-semibold text-blue-600">{priceLine}</div>

        <button
          type="button"
          onClick={onOpen}
          className="mt-4 w-full rounded-xl bg-blue-500 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600"
        >
          Смотреть шахматку
        </button>
      </div>
    </div>
  )
}
