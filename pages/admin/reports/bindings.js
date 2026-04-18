import { useState, useEffect, useCallback } from 'react'
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

function memberLabel(m) {
  if (!m) return '—'
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ') || '—'
  const uname = m.username ? `@${m.username}` : ''
  return `${name}${uname ? ` (${uname})` : ''}`
}

export default function BindingsPage() {
  const [data, setData] = useState({ realtors: [], unboundMembers: [], allMembers: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await apiFetch('GET', '/api/admin/reports/bindings')
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAction(key, body) {
    setSaving(key)
    try {
      await apiFetch('PATCH', '/api/admin/reports/bindings', body)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(null)
    }
  }

  // Для выпадашки "привязать" — показываем и непривязанных, и уже привязанных к другим (с пометкой)
  const boundToOther = (r, tg) =>
    data.realtors.find((x) => x.telegram_user_id === tg && x.id !== r.id)

  return (
    <AdminLayout title="Отчёты — связка с Telegram">
      <div className="mb-4 text-sm text-slate-400">
        Свяжи риелторов с участниками общего чата. Бот принимает отчёты только от привязанных.
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Загрузка...</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* --- Левая колонка: риелторы --- */}
          <section className="overflow-hidden rounded-2xl border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60">
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Риелтор</th>
                  <th className="px-2 py-3 text-center font-medium text-slate-400">Отчёты</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-400">Telegram</th>
                </tr>
              </thead>
              <tbody>
                {data.realtors.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{r.name || '—'}</div>
                      <div className="text-xs text-slate-500">
                        {r.email} · {r.role === 'manager' ? 'руководитель' : 'риелтор'}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={!!r.submits_reports}
                        disabled={saving === `submits:${r.id}`}
                        onChange={(e) =>
                          handleAction(`submits:${r.id}`, {
                            action: 'toggle_submits',
                            user_id: r.id,
                            value: e.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-slate-700 bg-slate-800"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={r.telegram_user_id || ''}
                          disabled={saving === `bind:${r.id}`}
                          onChange={(e) => {
                            const tg = e.target.value
                            if (!tg) {
                              handleAction(`bind:${r.id}`, { action: 'unbind', user_id: r.id })
                            } else {
                              const conflict = boundToOther(r, tg)
                              if (conflict && !confirm(`Этот Telegram уже привязан к "${conflict.name}". Переназначить?`)) return
                              handleAction(`bind:${r.id}`, {
                                action: 'bind',
                                user_id: r.id,
                                telegram_user_id: tg,
                              })
                            }
                          }}
                          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500"
                        >
                          <option value="">— не привязан —</option>
                          {data.allMembers.map((m) => {
                            const other = boundToOther(r, m.telegram_user_id)
                            return (
                              <option key={m.telegram_user_id} value={m.telegram_user_id}>
                                {memberLabel(m)}{other ? ` [занят: ${other.name}]` : ''}
                              </option>
                            )
                          })}
                        </select>
                        {r.telegram_user_id && (
                          <button
                            onClick={() => handleAction(`bind:${r.id}`, { action: 'unbind', user_id: r.id })}
                            className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                            title="Отвязать"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {data.realtors.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                      Нет риелторов
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {/* --- Правая колонка: участники чата --- */}
          <aside className="overflow-hidden rounded-2xl border border-slate-800">
            <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-3 text-sm font-medium text-slate-400">
              Участники чата ({data.allMembers.length})
            </div>
            <ul className="divide-y divide-slate-800">
              {data.allMembers.length === 0 && (
                <li className="px-4 py-4 text-xs text-slate-500">
                  Ещё никто не писал в чат — бот запомнит всех, кто напишет хоть что-то
                </li>
              )}
              {data.allMembers.map((m) => {
                const bound = data.realtors.find((r) => r.telegram_user_id === m.telegram_user_id)
                return (
                  <li key={m.telegram_user_id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm ${m.is_ignored ? 'text-slate-500 line-through' : 'text-white'}`}>
                        {memberLabel(m)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {bound ? `→ ${bound.name}` : m.is_ignored ? 'игнорируется' : 'не привязан'}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        handleAction(`ignore:${m.telegram_user_id}`, {
                          action: 'ignore_member',
                          telegram_user_id: m.telegram_user_id,
                          value: !m.is_ignored,
                        })
                      }
                      disabled={saving === `ignore:${m.telegram_user_id}`}
                      className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 whitespace-nowrap"
                      title={m.is_ignored ? 'Вернуть в список' : 'Игнорировать (директор, посторонние)'}
                    >
                      {m.is_ignored ? 'вернуть' : 'игнор'}
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>
        </div>
      )}
    </AdminLayout>
  )
}
