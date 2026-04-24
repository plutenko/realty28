import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'

const KIND_LABELS = {
  marquiz: 'Марквиз',
  tilda: 'Тильда',
  manual: 'Ручной ввод',
}

async function apiFetch(method, path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(path, opts)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

export default function AdminLeadSources() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [form, setForm] = useState({ kind: 'marquiz', name: '' })
  const [submitting, setSubmitting] = useState(false)
  const [justCreated, setJustCreated] = useState(null)

  async function load() {
    setLoading(true)
    setErr('')
    try {
      const data = await apiFetch('GET', '/api/admin/lead-sources')
      setRows(data)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSubmitting(true)
    setErr('')
    try {
      const created = await apiFetch('POST', '/api/admin/lead-sources', {
        kind: form.kind,
        name: form.name.trim(),
      })
      setJustCreated(created)
      setForm({ kind: 'marquiz', name: '' })
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(row) {
    try {
      await apiFetch('PATCH', '/api/admin/lead-sources', {
        id: row.id,
        is_active: !row.is_active,
      })
      await load()
    } catch (e) {
      alert(e.message || e)
    }
  }

  async function deleteSource(row) {
    if (!confirm(`Удалить источник «${row.name}»? Лиды, пришедшие с него, останутся, но будут без привязки к источнику.`)) return
    try {
      await apiFetch('DELETE', `/api/admin/lead-sources?id=${row.id}`)
      await load()
    } catch (e) {
      alert(e.message || e)
    }
  }

  function webhookUrl(sourceKey) {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/api/leads/webhook/${sourceKey}`
  }

  async function copyUrl(sourceKey) {
    const url = webhookUrl(sourceKey)
    try {
      await navigator.clipboard.writeText(url)
      alert('URL скопирован')
    } catch {
      prompt('Скопируй вручную:', url)
    }
  }

  return (
    <AdminLayout title="CRM-источники">
      <div className="max-w-5xl">
        <h1 className="text-2xl font-semibold text-white mb-2">CRM-источники</h1>
        <p className="text-sm text-slate-400 mb-6">
          Источники лидов: квизы, лендинги, ручной ввод. После создания — скопируй Webhook URL и вставь в настройки источника (например, Марквиз → Webhooks).
        </p>

        {err && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 px-4 py-3 mb-4 text-sm">
            {err}
          </div>
        )}

        {justCreated && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-100 px-4 py-3 mb-4 text-sm">
            <div className="font-semibold mb-1">✅ Источник создан: {justCreated.name}</div>
            <div className="text-xs text-emerald-200/80">Вставь URL в настройки {KIND_LABELS[justCreated.kind] || justCreated.kind}:</div>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-slate-900/60 px-3 py-2 text-xs text-emerald-100">
                {webhookUrl(justCreated.source_key)}
              </code>
              <button
                onClick={() => copyUrl(justCreated.source_key)}
                className="rounded bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-medium text-white"
              >
                Копировать
              </button>
            </div>
          </div>
        )}

        {/* Форма добавления */}
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 mb-6 flex flex-wrap items-end gap-3"
        >
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-slate-400 mb-1">Тип</label>
            <select
              value={form.kind}
              onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="marquiz">Марквиз</option>
              <option value="tilda">Тильда</option>
              <option value="manual">Ручной ввод</option>
            </select>
          </div>
          <div className="flex-[2] min-w-[240px]">
            <label className="block text-xs text-slate-400 mb-1">Название</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Марквиз — Подбор квартиры"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !form.name.trim()}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white"
          >
            {submitting ? 'Создаю…' : '+ Добавить источник'}
          </button>
        </form>

        {/* Список */}
        {loading ? (
          <div className="text-slate-400 text-sm">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-8 text-center text-slate-400">
            Пока нет источников. Создай первый — он появится здесь.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/70 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Название</th>
                  <th className="text-left px-4 py-2">Тип</th>
                  <th className="text-left px-4 py-2">Webhook URL</th>
                  <th className="text-left px-4 py-2">Активен</th>
                  <th className="text-right px-4 py-2">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-slate-900/40">
                    <td className="px-4 py-3 text-white">{r.name}</td>
                    <td className="px-4 py-3 text-slate-300">{KIND_LABELS[r.kind] || r.kind}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="truncate max-w-[320px] rounded bg-slate-800/80 px-2 py-1 text-xs text-slate-200">
                          {webhookUrl(r.source_key)}
                        </code>
                        <button
                          onClick={() => copyUrl(r.source_key)}
                          className="text-xs rounded bg-slate-700 hover:bg-slate-600 px-2 py-1 text-white"
                        >
                          Копировать
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(r)}
                        className={`text-xs rounded px-2 py-1 font-medium ${
                          r.is_active
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-700 text-slate-400'
                        }`}
                      >
                        {r.is_active ? 'Да' : 'Нет'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteSource(r)}
                        className="text-xs rounded bg-red-500/20 hover:bg-red-500/30 px-2 py-1 text-red-300"
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
