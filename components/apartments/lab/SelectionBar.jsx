import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, Plus, X, Trash2, Heart } from 'lucide-react'
import { calcCommission, formatPriceRub, formatRooms } from '../../../lib/format'

const MAX_UNITS = 20

export default function SelectionBar({
  selectedUnits,
  units,
  onCreateCollection,
  onClearAll,
  onRemoveUnit,
  creating = false,
}) {
  const [expanded, setExpanded] = useState(false)

  const selectedList = useMemo(() => {
    if (!Array.isArray(units)) return []
    const idSet = new Set(selectedUnits)
    return units.filter((u) => idSet.has(u.id))
  }, [selectedUnits, units])

  const totalCommission = useMemo(() => {
    return selectedList.reduce((sum, u) => {
      const amt = calcCommission(u).amount
      return sum + (Number.isFinite(amt) ? amt : 0)
    }, 0)
  }, [selectedList])

  if (selectedUnits.length === 0) return null

  const overLimit = selectedUnits.length > MAX_UNITS

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-rose-200 bg-rose-50 shadow-[0_-4px_16px_rgba(244,63,94,0.12)]">
      {/* Раскрываемый список выбранных */}
      {expanded ? (
        <div className="max-h-[40vh] overflow-y-auto border-b border-rose-100 bg-rose-50/60 px-4 py-3">
          <div className="mx-auto max-w-7xl space-y-1.5">
            {selectedList.length === 0 ? (
              <div className="text-sm text-gray-500">Список пуст</div>
            ) : (
              selectedList.map((u) => {
                const c = u?.building?.complex
                const b = u?.building
                const ap = calcCommission(u).amount
                return (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-gray-900">
                        {c?.name ?? '—'} · {b?.name ?? '—'} · №{u?.number ?? '—'}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {formatRooms(u?.rooms)} · {u?.area ?? '—'} м² ·{' '}
                        {formatPriceRub(u?.price)} ₽
                        {ap != null ? (
                          <span className="ml-2 text-emerald-600">
                            💰 {formatPriceRub(ap)} ₽
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveUnit?.(u.id)}
                      className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      title="Убрать из подборки"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      ) : null}

      {/* Главная строка */}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1 text-left transition hover:bg-rose-100/60"
          title={expanded ? 'Свернуть' : 'Раскрыть список'}
        >
          <Heart className="h-6 w-6 shrink-0 text-rose-500" fill="currentColor" strokeWidth={0} aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">
              {selectedUnits.length} {pluralize(selectedUnits.length)}
              {overLimit ? (
                <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                  лимит {MAX_UNITS}
                </span>
              ) : null}
            </div>
            {totalCommission > 0 ? (
              <div className="text-xs text-emerald-600">
                💰 {formatPriceRub(totalCommission)} ₽ комиссии
              </div>
            ) : null}
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0 text-gray-400" />
          )}
        </button>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onClearAll}
            className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            title="Снять выбор со всех"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Очистить</span>
          </button>
          <button
            type="button"
            onClick={onCreateCollection}
            disabled={creating || overLimit || selectedUnits.length === 0}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-300"
            title={
              overLimit
                ? `В подборке максимум ${MAX_UNITS} квартир`
                : 'Создать подборку для клиента'
            }
          >
            <Plus className="h-4 w-4" />
            {creating ? 'Создаём…' : 'Создать подборку'}
          </button>
        </div>
      </div>
    </div>
  )
}

function pluralize(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'квартира'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'квартиры'
  return 'квартир'
}
