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
 * Карточка одного корпуса (литера). Стиль 1:1 с тем что был на /buildings,
 * поддерживает list/grid через listView.
 */
export default function ComplexCard({
  complex,
  building,
  matched,
  available,
  hasFilters,
  minPrice = null,
  listView = false,
  onOpen,
}) {
  const complexTitle = formatComplexName(complex?.name ?? '')
  const buildingTitle = formatName(building?.name ?? '')
  const dev = getComplexDeveloper(complex)
  const developerLabel = formatName(dev?.name || '')
  const imageUrl = complex?.image || null

  // minPrice считается в pages/apartments.js (родителе) — у нас тут нет building.units
  // после рефактора /api/complexes (units[] больше не возвращается).
  const priceLine = minPrice != null ? `от ${fmtPrice(minPrice)}` : 'Нет в продаже'
  const counterLabel = hasFilters
    ? `${matched} из ${available} подходящих`
    : `${available} квартир`

  if (listView) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow transition-shadow duration-200 hover:shadow-lg sm:flex-row sm:items-center sm:gap-4">
        <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-xl bg-gray-200 sm:h-28 sm:w-40">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full object-cover transition duration-200 hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
              Нет фото
            </div>
          )}
          {available > 0 ? (
            <div className="absolute left-2 top-2 rounded bg-white/95 px-2 py-1 text-xs font-medium text-gray-800 shadow">
              {counterLabel}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-gray-900">{complexTitle}</h3>
          <p className="text-sm font-medium text-gray-700">{buildingTitle}</p>
          <p className="text-xs text-gray-500">{developerLabel || '—'}</p>
          {building?.floors ? (
            <p className="text-xs text-gray-500">{building.floors} этажей</p>
          ) : null}
          <div className="mt-2 text-lg font-semibold text-blue-600">{priceLine}</div>
        </div>

        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded-xl border border-blue-500 bg-blue-50 px-5 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100 sm:self-center"
        >
          Шахматка
        </button>
      </div>
    )
  }

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
          className="mt-4 w-full rounded-xl border border-blue-500 bg-blue-50 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
        >
          Смотреть шахматку
        </button>
      </div>
    </div>
  )
}
