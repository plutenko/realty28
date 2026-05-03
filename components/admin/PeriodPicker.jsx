import { useEffect, useRef, useState } from 'react'

/**
 * Дропдаун для выбора периода в стиле Я.Метрики/Я.Директа.
 *
 * value: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', label: string }
 * onChange(value)
 */
export default function PeriodPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [customFrom, setCustomFrom] = useState(value?.from || '')
  const [customTo, setCustomTo] = useState(value?.to || '')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setCustomMode(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function pick(presetKey) {
    const r = presetRange(presetKey)
    onChange?.(r)
    setOpen(false)
    setCustomMode(false)
  }

  function applyCustom() {
    if (!customFrom || !customTo) return
    if (customFrom > customTo) {
      // swap
      onChange?.({ from: customTo, to: customFrom, label: `${formatRu(customTo)} — ${formatRu(customFrom)}` })
    } else {
      onChange?.({ from: customFrom, to: customTo, label: `${formatRu(customFrom)} — ${formatRu(customTo)}` })
    }
    setOpen(false)
    setCustomMode(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(!open); setCustomMode(false) }}
        className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
      >
        <span>{value?.label || 'Выбрать период'}</span>
        <span className="text-slate-500">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
          {!customMode ? (
            <ul className="py-2 text-sm text-slate-200">
              <li>
                <button
                  type="button"
                  onClick={() => { setCustomMode(true); setCustomFrom(value?.from || ''); setCustomTo(value?.to || '') }}
                  className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-slate-800"
                >
                  <span className="font-medium">Указать период</span>
                  <span className="text-slate-500">▸</span>
                </button>
              </li>
              <li className="my-1 mx-3 border-t border-slate-800" />
              {PRESETS_TOP.map((p) => (
                <PresetRow key={p.key} preset={p} active={value?.preset === p.key} onPick={pick} />
              ))}
              <li className="my-1 mx-3 border-t border-slate-800" />
              {PRESETS_RANGE.map((p) => (
                <PresetRow key={p.key} preset={p} active={value?.preset === p.key} onPick={pick} />
              ))}
            </ul>
          ) : (
            <div className="p-4 text-sm text-slate-200">
              <div className="mb-3 text-xs uppercase text-slate-400">Произвольный период</div>
              <div className="mb-3 flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  С
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  По
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={applyCustom}
                  disabled={!customFrom || !customTo}
                  className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Применить
                </button>
                <button
                  type="button"
                  onClick={() => setCustomMode(false)}
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
                >
                  Назад
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PresetRow({ preset, active, onPick }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(preset.key)}
        className={`flex w-full items-center justify-between px-4 py-2 text-left hover:bg-slate-800 ${
          active ? 'text-blue-300' : ''
        }`}
      >
        <span>{preset.label}</span>
        {active && <span>✓</span>}
      </button>
    </li>
  )
}

const PRESETS_TOP = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'last_week', label: 'Прошлая неделя' },
  { key: 'last_month', label: 'Прошлый месяц' },
]

const PRESETS_RANGE = [
  { key: 'this_week', label: 'Эта неделя' },
  { key: 'this_month', label: 'Этот месяц' },
  { key: 'last_7d', label: 'Последние 7 дней' },
  { key: 'last_30d', label: 'Последние 30 дней' },
  { key: 'last_90d', label: 'Последние 90 дней' },
  { key: 'last_365d', label: 'Последние 365 дней' },
]

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function ymd(d) {
  // Локальная дата в формате YYYY-MM-DD (без UTC-сдвига)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
function formatRu(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

export function presetRange(presetKey) {
  const today = startOfDay(new Date())
  switch (presetKey) {
    case 'today':
      return { preset: 'today', from: ymd(today), to: ymd(today), label: 'Сегодня' }
    case 'yesterday': {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      return { preset: 'yesterday', from: ymd(y), to: ymd(y), label: 'Вчера' }
    }
    case 'last_week': {
      const dow = today.getDay() || 7
      const lastSun = new Date(today)
      lastSun.setDate(lastSun.getDate() - dow)
      const lastMon = new Date(lastSun)
      lastMon.setDate(lastMon.getDate() - 6)
      return { preset: 'last_week', from: ymd(lastMon), to: ymd(lastSun), label: 'Прошлая неделя' }
    }
    case 'last_month': {
      const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0)
      return { preset: 'last_month', from: ymd(firstDay), to: ymd(lastDay), label: 'Прошлый месяц' }
    }
    case 'this_week': {
      const dow = today.getDay() || 7
      const monday = new Date(today)
      monday.setDate(monday.getDate() - dow + 1)
      return { preset: 'this_week', from: ymd(monday), to: ymd(today), label: 'Эта неделя' }
    }
    case 'this_month': {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
      return { preset: 'this_month', from: ymd(firstDay), to: ymd(today), label: 'Этот месяц' }
    }
    case 'last_7d': {
      const from = new Date(today)
      from.setDate(from.getDate() - 6)
      return { preset: 'last_7d', from: ymd(from), to: ymd(today), label: 'Последние 7 дней' }
    }
    case 'last_30d': {
      const from = new Date(today)
      from.setDate(from.getDate() - 29)
      return { preset: 'last_30d', from: ymd(from), to: ymd(today), label: 'Последние 30 дней' }
    }
    case 'last_90d': {
      const from = new Date(today)
      from.setDate(from.getDate() - 89)
      return { preset: 'last_90d', from: ymd(from), to: ymd(today), label: 'Последние 90 дней' }
    }
    case 'last_365d':
    default: {
      const from = new Date(today)
      from.setDate(from.getDate() - 364)
      return { preset: 'last_365d', from: ymd(from), to: ymd(today), label: 'Последние 365 дней' }
    }
  }
}
