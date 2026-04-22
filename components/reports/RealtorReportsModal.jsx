import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient'

const METRIC_FIELDS = [
  { key: 'cold_calls', label: 'Хз' },
  { key: 'leaflet', label: 'Расклейка' },
  { key: 'activations', label: 'Активации' },
  { key: 'meetings', label: 'Встречи' },
  { key: 'consultations', label: 'Консультации' },
  { key: 'repeat_touch', label: 'Повт. касание' },
  { key: 'shows_objects_count', label: 'Показы (об) — клиентов' },
  { key: 'shows_objects_objects', label: 'Показы (об) — объектов' },
  { key: 'shows_clients_count', label: 'Показы (пок)' },
  { key: 'ad_exclusive', label: 'АД (экс)' },
  { key: 'ad_search', label: 'АД (поиск)' },
  { key: 'new_buildings_presentations', label: 'През.новостроек' },
  { key: 'deposits', label: 'Авансы ₽', money: true },
  { key: 'revenue', label: 'Вал ₽', money: true },
  { key: 'selection', label: 'Подбор' },
]

const ABSENCE_OPTS = [
  { value: '', label: '— работал —' },
  { value: 'day_off', label: 'Выходной' },
  { value: 'vacation', label: 'Отпуск' },
  { value: 'sick_leave', label: 'Больничный' },
]

const ABSENCE_LABEL = { day_off: 'выходной', vacation: 'отпуск', sick_leave: 'больничный' }

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

function formatRu(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

function formatDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

export default function RealtorReportsModal({ realtor, range, onClose, onReportChanged }) {
  const [reports, setReports] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await apiFetch(
        'GET',
        `/api/admin/reports/report?user_id=${realtor.id}&from=${range.from}&to=${range.to}`
      )
      setReports(d.reports || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [realtor.id, range.from, range.to])

  useEffect(() => { load() }, [load])

  function startEdit(r) {
    setEditingId(r.id)
    const metrics = {}
    for (const f of METRIC_FIELDS) {
      metrics[f.key] = r[f.key] ?? ''
    }
    setForm({
      metrics,
      absence_type: r.absence_type || '',
      is_valid: r.is_valid !== false,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm({})
  }

  async function save() {
    if (!editingId) return
    setSaving(true)
    setError('')
    try {
      const body = {
        metrics: form.absence_type ? undefined : form.metrics,
        absence_type: form.absence_type || null,
        is_valid: form.is_valid,
      }
      const d = await apiFetch('PATCH', `/api/admin/reports/report?id=${editingId}`, body)
      // Оптимистичное обновление локального состояния
      setReports((prev) =>
        (prev || []).map((r) =>
          r.id === editingId
            ? {
                ...r,
                ...(form.absence_type
                  ? Object.fromEntries(METRIC_FIELDS.map((f) => [f.key, null]))
                  : form.metrics),
                absence_type: form.absence_type || null,
                is_valid: form.is_valid,
                edited_by: d.report.edited_by,
                edited_at: d.report.edited_at,
                edited_by_name: d.edited_by_name,
              }
            : r
        )
      )
      setEditingId(null)
      setForm({})
      if (onReportChanged) onReportChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{realtor.name}</h2>
            <p className="text-sm text-gray-500">
              Отчёты за {formatRu(range.from)}{range.from !== range.to && ` – ${formatRu(range.to)}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >✕</button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        )}

        {loading && <p className="text-sm text-gray-400">Загрузка...</p>}

        {!loading && reports && reports.length === 0 && (
          <p className="text-sm text-gray-400">За этот период отчётов от риелтора нет.</p>
        )}

        {!loading && reports && reports.length > 0 && (
          <div className="space-y-3">
            {reports.map((r) => {
              const isEditing = editingId === r.id
              const isRange = r.date_from !== r.date_to
              return (
                <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-semibold text-gray-900">
                        {formatRu(r.date_from)}{isRange && ` – ${formatRu(r.date_to)}`}
                      </div>
                      {r.absence_type && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                          {ABSENCE_LABEL[r.absence_type] || r.absence_type}
                        </span>
                      )}
                      {r.is_valid === false && (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">невалиден</span>
                      )}
                      {r.edited_by && (
                        <span
                          className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                          title={`${r.edited_by_name || 'Руководитель'}, ${formatDateTime(r.edited_at)}`}
                        >
                          ✎ отредактировано {r.edited_by_name ? `(${r.edited_by_name})` : ''}
                        </span>
                      )}
                    </div>
                    {!isEditing && (
                      <button
                        onClick={() => startEdit(r)}
                        className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Изменить
                      </button>
                    )}
                  </div>

                  {!isEditing ? (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                      {METRIC_FIELDS.map((f) => (
                        <div key={f.key} className="flex justify-between text-gray-700">
                          <span className="text-gray-500">{f.label}</span>
                          <span className="font-mono">
                            {r[f.key] == null
                              ? '—'
                              : f.money
                                ? Number(r[f.key]).toLocaleString('ru-RU').replace(/,/g, ' ')
                                : r[f.key]}
                          </span>
                        </div>
                      ))}
                      {r.raw_text && (
                        <details className="col-span-full mt-2 text-xs text-gray-500">
                          <summary className="cursor-pointer">Исходный текст</summary>
                          <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2">{r.raw_text}</pre>
                        </details>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <label className="text-sm text-gray-600">Статус:</label>
                        <select
                          value={form.absence_type}
                          onChange={(e) => setForm((f) => ({ ...f, absence_type: e.target.value }))}
                          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm"
                        >
                          {ABSENCE_OPTS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
                          <input
                            type="checkbox"
                            checked={form.is_valid}
                            onChange={(e) => setForm((f) => ({ ...f, is_valid: e.target.checked }))}
                          />
                          валидный
                        </label>
                      </div>

                      {!form.absence_type && (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {METRIC_FIELDS.map((f) => (
                            <label key={f.key} className="flex flex-col text-xs text-gray-500">
                              {f.label}
                              <input
                                type="number"
                                value={form.metrics[f.key] ?? ''}
                                onChange={(e) =>
                                  setForm((s) => ({
                                    ...s,
                                    metrics: { ...s.metrics, [f.key]: e.target.value },
                                  }))
                                }
                                className="mt-1 rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-sm text-gray-800"
                              />
                            </label>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={save}
                          disabled={saving}
                          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                        >
                          {saving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="rounded-md px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
