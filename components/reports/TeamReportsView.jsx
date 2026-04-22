import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient'
import RealtorReportsModal from './RealtorReportsModal'

async function apiFetch(method, path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(path, opts)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

const PERIOD_LABELS = { day: 'День', week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' }

function todayIsoYakutsk() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yakutsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

const METRIC_COLS = [
  { key: 'cold_calls', label: 'Хз' },
  { key: 'leaflet', label: 'Раскл' },
  { key: 'activations', label: 'Актив' },
  { key: 'meetings', label: 'Встр' },
  { key: 'consultations', label: 'Конс' },
  { key: 'repeat_touch', label: 'Повт' },
  { key: 'shows_objects_count', label: 'Пок(об)' },
  { key: 'shows_clients_count', label: 'Пок(пок)' },
  { key: 'ad_exclusive', label: 'АД экс' },
  { key: 'ad_search', label: 'АД пск' },
  { key: 'new_buildings_presentations', label: 'През' },
  { key: 'deposits', label: 'Авансы ₽', money: true },
  { key: 'revenue', label: 'Вал ₽', money: true },
  { key: 'selection', label: 'Подбор' },
]

const ABSENCE_LABEL = { day_off: 'выходной', vacation: 'отпуск', sick_leave: 'больничный' }

function fmt(v, money) {
  if (v === 0 || v == null) return money ? '—' : '0'
  if (money) return Number(v).toLocaleString('ru-RU').replace(/,/g, ' ')
  return String(v)
}

function formatRu(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

export default function TeamReportsView() {
  const [period, setPeriod] = useState('week')
  const [offset, setOffset] = useState(0)
  const [dayDate, setDayDate] = useState(todayIsoYakutsk())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [textModal, setTextModal] = useState(null)
  const [copied, setCopied] = useState(false)
  const [editRealtor, setEditRealtor] = useState(null)
  const [unlocked, setUnlocked] = useState(false)
  const [unlockingBusy, setUnlockingBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const path = period === 'day'
        ? `/api/admin/reports/data?period=day&date=${dayDate}`
        : `/api/admin/reports/data?period=${period}&offset=${offset}`
      const d = await apiFetch('GET', path)
      setData(d)
      // Параллельно — проверим, разблокирован ли текущий день (для режима «День»)
      if (period === 'day') {
        try {
          const ov = await apiFetch('GET', `/api/admin/reports/unlock-day?from=${dayDate}&to=${dayDate}`)
          setUnlocked((ov.overrides || []).length > 0)
        } catch { setUnlocked(false) }
      } else {
        setUnlocked(false)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [period, offset, dayDate])

  useEffect(() => { load() }, [load])

  async function toggleUnlock() {
    if (period !== 'day') return
    setUnlockingBusy(true)
    try {
      if (unlocked) {
        await apiFetch('DELETE', `/api/admin/reports/unlock-day?date=${dayDate}`)
        setUnlocked(false)
      } else {
        await apiFetch('POST', `/api/admin/reports/unlock-day?date=${dayDate}`)
        setUnlocked(true)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setUnlockingBusy(false)
    }
  }

  async function handlePeriodText() {
    if (!data) return
    try {
      const d = await apiFetch(
        'GET',
        `/api/admin/reports/period-text?from=${data.range.from}&to=${data.range.to}`
      )
      setTextModal(d)
      setCopied(false)
    } catch (e) {
      alert(e.message)
    }
  }

  async function copyText() {
    if (!textModal) return
    try {
      await navigator.clipboard.writeText(textModal.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('Не удалось скопировать')
    }
  }

  const absent = (data?.realtors || []).filter((r) => r.absence)
  const notSubmitted = (data?.realtors || []).filter((r) => !r.absence && r.reports_count === 0)
  const active = (data?.realtors || []).filter((r) => !r.absence && r.reports_count > 0)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {Object.entries(PERIOD_LABELS).map(([k, v]) => (
            <button
              key={k}
              onClick={() => { setPeriod(k); setOffset(0) }}
              className={`rounded-md px-4 py-1.5 text-sm transition ${
                period === k ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {period === 'day' ? (
          <div className="inline-flex items-center gap-2">
            <input
              type="date"
              value={dayDate}
              onChange={(e) => setDayDate(e.target.value || todayIsoYakutsk())}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
            />
            <button
              onClick={() => setDayDate(todayIsoYakutsk())}
              className="rounded-md bg-gray-200 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-300"
              title="Сегодня"
            >Сегодня</button>
            <button
              onClick={toggleUnlock}
              disabled={unlockingBusy}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                unlocked
                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              } disabled:opacity-50`}
              title={unlocked
                ? 'Разблокировано — риелторы могут прислать/отредактировать отчёт. Клик — снять'
                : 'Разрешить риелторам прислать/отредактировать отчёт за этот день'
              }
            >
              {unlocked ? '🔓 Разблокировано' : '🔒 Заблокировать/разблокировать'}
            </button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1">
            <button
              onClick={() => setOffset((o) => o - 1)}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              title="Предыдущий период"
            >←</button>
            <div className="min-w-[220px] rounded-md border border-gray-200 bg-white px-3 py-1.5 text-center text-sm text-gray-700">
              {data?.range?.label || '—'}
            </div>
            <button
              onClick={() => setOffset((o) => o + 1)}
              disabled={offset >= 0}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white"
              title="Следующий период"
            >→</button>
            {offset !== 0 && (
              <button
                onClick={() => setOffset(0)}
                className="ml-2 rounded-md bg-gray-200 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-300"
              >
                Текущий
              </button>
            )}
          </div>
        )}

        <div className="grow" />
        <button
          onClick={handlePeriodText}
          disabled={!data}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Отчёт за период
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {loading && <p className="text-sm text-gray-400">Загрузка...</p>}

      {data && !loading && (
        <>
          <div className="mb-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left font-medium">Риелтор</th>
                  {METRIC_COLS.map((c) => (
                    <th key={c.key} className="px-2 py-3 text-right font-medium whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-gray-100 hover:bg-blue-50"
                    onClick={() => setEditRealtor(r)}
                    title="Открыть отчёты по дням для редактирования"
                  >
                    <td className="sticky left-0 bg-white px-4 py-2 text-gray-900 whitespace-nowrap group-hover:bg-blue-50">
                      <span className="text-blue-700 hover:underline">{r.name || '—'}</span>
                      {r.is_active === false && (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">уволен</span>
                      )}
                      {r.reports_count > 1 && (
                        <span className="ml-2 text-xs text-gray-400">({r.reports_count} отчётов)</span>
                      )}
                    </td>
                    {METRIC_COLS.map((c) => (
                      <td key={c.key} className="px-2 py-2 text-right font-mono text-gray-700">
                        {fmt(r.metrics[c.key], c.money)}
                      </td>
                    ))}
                  </tr>
                ))}
                {active.length === 0 && (
                  <tr>
                    <td colSpan={METRIC_COLS.length + 1} className="px-4 py-6 text-center text-gray-400">
                      За этот период никто не отчитался
                    </td>
                  </tr>
                )}
              </tbody>
              {active.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-amber-50">
                    <td className="sticky left-0 bg-amber-50 px-4 py-3 font-semibold text-amber-700">
                      Итого по отделу
                    </td>
                    {METRIC_COLS.map((c) => (
                      <td key={c.key} className="px-2 py-3 text-right font-mono font-semibold text-amber-700">
                        {fmt(data.totals[c.key], c.money)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {absent.length > 0 && (
            <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">Отсутствуют</div>
              <ul className="text-sm text-gray-700 space-y-1">
                {absent.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setEditRealtor(r)}
                      className="text-blue-700 font-medium hover:underline"
                      title="Открыть отчёты по дням"
                    >
                      {r.name}
                    </button>
                    {' — '}
                    <span className="text-amber-700">{ABSENCE_LABEL[r.absence.type] || r.absence.type}</span>
                    {' '}
                    <span className="text-gray-500">
                      ({formatRu(r.absence.from)}{r.absence.from !== r.absence.to && ` – ${formatRu(r.absence.to)}`})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {notSubmitted.length > 0 && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">Не прислали отчёт</div>
              <div className="text-sm text-gray-700">
                {notSubmitted.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ', '}
                    <span className="text-gray-900 font-medium">{r.name}</span>
                    {!r.bound && <span className="ml-1 text-xs text-red-600" title="Telegram не привязан">⚠</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {editRealtor && data?.range && (
        <RealtorReportsModal
          realtor={editRealtor}
          range={data.range}
          onClose={() => setEditRealtor(null)}
          onReportChanged={load}
        />
      )}

      {textModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setTextModal(null)}
        >
          <div
            className="relative w-full max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Отчёт за {formatRu(textModal.range.from)} – {formatRu(textModal.range.to)}
              </h2>
              <button
                onClick={() => setTextModal(null)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-gray-500">
              Поля <code className="text-gray-600">_____</code> — заполни вручную из CRM (обращения, звонки, веб, план).
              Остальное посчитано из отчётов риелторов.
            </p>
            <textarea
              readOnly
              value={textModal.text}
              className="h-[480px] w-full rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-sm text-gray-800 outline-none"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={copyText}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                {copied ? '✓ Скопировано' : 'Скопировать весь текст'}
              </button>
              <button
                onClick={() => setTextModal(null)}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
