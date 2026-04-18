import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import AdminLayout from '../../../components/admin/AdminLayout'
import { supabase } from '../../../lib/supabaseClient'

async function apiFetch(method, path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(path, opts)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка')
  return json
}

const PERIOD_LABELS = {
  week: 'Неделя',
  month: 'Месяц',
  quarter: 'Квартал',
  year: 'Год',
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

const ABSENCE_LABEL = {
  day_off: 'выходной',
  vacation: 'отпуск',
  sick_leave: 'больничный',
}

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

export default function ReportsIndex() {
  const [period, setPeriod] = useState('week')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [textModal, setTextModal] = useState(null) // {text, range}
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await apiFetch('GET', `/api/admin/reports/data?period=${period}&offset=${offset}`)
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [period, offset])

  useEffect(() => { load() }, [load])

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
    <AdminLayout title="Отчёты риелторов">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Вкладки периодов */}
        <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-1">
          {Object.entries(PERIOD_LABELS).map(([k, v]) => (
            <button
              key={k}
              onClick={() => { setPeriod(k); setOffset(0) }}
              className={`rounded-md px-4 py-1.5 text-sm transition ${
                period === k ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Навигация по периодам */}
        <div className="inline-flex items-center gap-1">
          <button
            onClick={() => setOffset((o) => o - 1)}
            className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            title="Предыдущий период"
          >←</button>
          <div className="min-w-[220px] rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-center text-sm text-slate-200">
            {data?.range?.label || '—'}
          </div>
          <button
            onClick={() => setOffset((o) => o + 1)}
            disabled={offset >= 0}
            className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-slate-900"
            title="Следующий период"
          >→</button>
          {offset !== 0 && (
            <button
              onClick={() => setOffset(0)}
              className="ml-2 rounded-md bg-slate-800 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              Текущий
            </button>
          )}
        </div>

        <div className="grow" />
        <Link
          href="/admin/reports/bindings"
          className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Связки
        </Link>
        <Link
          href="/admin/reports/settings"
          className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Настройки
        </Link>
        <button
          onClick={handlePeriodText}
          disabled={!data}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Отчёт за период
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-slate-500">Загрузка...</p>}

      {data && !loading && (
        <>
          {/* Таблица */}
          <div className="mb-6 overflow-x-auto rounded-2xl border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                  <th className="sticky left-0 z-10 bg-slate-900/90 px-4 py-3 text-left font-medium">Риелтор</th>
                  {METRIC_COLS.map((c) => (
                    <th key={c.key} className="px-2 py-3 text-right font-medium whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                    <td className="sticky left-0 bg-slate-950/80 px-4 py-2 text-white whitespace-nowrap">
                      {r.name || '—'}
                      {r.is_active === false && (
                        <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">уволен</span>
                      )}
                      {r.reports_count > 1 && (
                        <span className="ml-2 text-xs text-slate-500">({r.reports_count} отчётов)</span>
                      )}
                    </td>
                    {METRIC_COLS.map((c) => (
                      <td key={c.key} className="px-2 py-2 text-right font-mono text-slate-200">
                        {fmt(r.metrics[c.key], c.money)}
                      </td>
                    ))}
                  </tr>
                ))}
                {active.length === 0 && (
                  <tr>
                    <td colSpan={METRIC_COLS.length + 1} className="px-4 py-6 text-center text-slate-500">
                      За этот период никто не отчитался
                    </td>
                  </tr>
                )}
              </tbody>
              {active.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-700 bg-slate-900/40">
                    <td className="sticky left-0 bg-slate-900/90 px-4 py-3 font-semibold text-amber-300">
                      Итого по отделу
                    </td>
                    {METRIC_COLS.map((c) => (
                      <td key={c.key} className="px-2 py-3 text-right font-mono font-semibold text-amber-200">
                        {fmt(data.totals[c.key], c.money)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Отсутствуют */}
          {absent.length > 0 && (
            <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-400">Отсутствуют</div>
              <ul className="text-sm text-slate-300 space-y-1">
                {absent.map((r) => (
                  <li key={r.id}>
                    <span className="text-white">{r.name}</span>
                    {' — '}
                    <span className="text-amber-300">{ABSENCE_LABEL[r.absence.type] || r.absence.type}</span>
                    {' '}
                    <span className="text-slate-500">
                      ({formatRu(r.absence.from)}{r.absence.from !== r.absence.to && ` – ${formatRu(r.absence.to)}`})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Не прислали */}
          {notSubmitted.length > 0 && (
            <div className="mb-4 rounded-xl border border-red-900/50 bg-red-500/5 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-400">Не прислали отчёт</div>
              <div className="text-sm text-slate-300">
                {notSubmitted.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ', '}
                    <span className="text-white">{r.name}</span>
                    {!r.bound && <span className="ml-1 text-xs text-red-400" title="Telegram не привязан">⚠</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Модалка "Отчёт за период" */}
      {textModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setTextModal(null)}
        >
          <div
            className="relative w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Отчёт за {formatRu(textModal.range.from)} – {formatRu(textModal.range.to)}
              </h2>
              <button
                onClick={() => setTextModal(null)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Поля <code className="text-slate-400">_____</code> — заполни вручную из CRM (обращения, звонки, веб, план).
              Остальное посчитано из отчётов риелторов.
            </p>
            <textarea
              readOnly
              value={textModal.text}
              className="h-[480px] w-full rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-sm text-slate-200 outline-none"
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
                className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-800"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
