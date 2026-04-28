import { ArrowDownUp, Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export const SORT_OPTIONS = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'price-asc', label: 'Цена ↑' },
  { value: 'price-desc', label: 'Цена ↓' },
  { value: 'area-asc', label: 'Площадь ↑' },
  { value: 'area-desc', label: 'Площадь ↓' },
  { value: 'handover-asc', label: 'Срок сдачи ближайший' },
  { value: 'handover-desc', label: 'Срок сдачи поздний' },
]

export default function SortDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (!ref.current) return
      if (!ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const current = SORT_OPTIONS.find((o) => o.value === value) ?? SORT_OPTIONS[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        title="Сортировка"
      >
        <ArrowDownUp className="h-4 w-4 text-gray-500" />
        <span className="hidden sm:inline">Сорт:</span>
        <span className="font-medium">{current.label}</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          {SORT_OPTIONS.map((opt) => {
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange?.(opt.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
                  active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span>{opt.label}</span>
                {active ? <Check className="h-4 w-4" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function applySort(items, sortValue) {
  if (!Array.isArray(items) || items.length === 0) return items
  if (!sortValue || sortValue === 'default') return items

  const arr = items.slice()

  const handoverScore = (u) => {
    const status = String(u?.building?.handover_status || '').toLowerCase()
    if (status === 'completed' || status === 'delivered' || status === 'сдан') {
      return 0 // сданные = ближе всего
    }
    const y = Number(u?.building?.handover_year)
    const q = Number(u?.building?.handover_quarter)
    if (!Number.isFinite(y) || y <= 0) return Number.POSITIVE_INFINITY
    return y * 4 + (Number.isFinite(q) ? q : 0)
  }

  switch (sortValue) {
    case 'price-asc':
      return arr.sort((a, b) => (Number(a?.price) || 0) - (Number(b?.price) || 0))
    case 'price-desc':
      return arr.sort((a, b) => (Number(b?.price) || 0) - (Number(a?.price) || 0))
    case 'area-asc':
      return arr.sort((a, b) => (Number(a?.area) || 0) - (Number(b?.area) || 0))
    case 'area-desc':
      return arr.sort((a, b) => (Number(b?.area) || 0) - (Number(a?.area) || 0))
    case 'handover-asc':
      return arr.sort((a, b) => handoverScore(a) - handoverScore(b))
    case 'handover-desc':
      return arr.sort((a, b) => handoverScore(b) - handoverScore(a))
    default:
      return arr
  }
}
