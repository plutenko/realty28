import { X } from 'lucide-react'

export default function ActiveFilterChips({ chips, onResetAll }) {
  if (!Array.isArray(chips) || chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
          title="Убрать этот фильтр"
        >
          <span>{chip.label}</span>
          <X className="h-3 w-3" />
        </button>
      ))}
      {chips.length >= 2 && typeof onResetAll === 'function' ? (
        <button
          type="button"
          onClick={onResetAll}
          className="text-xs text-gray-500 underline hover:text-gray-700"
        >
          Сбросить все
        </button>
      ) : null}
    </div>
  )
}
