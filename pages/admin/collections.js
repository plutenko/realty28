import { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'

function isNewCollection(createdAt) {
  if (!createdAt) return false
  const ts = new Date(createdAt).getTime()
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts < 24 * 60 * 60 * 1000
}

export default function AdminCollectionsPage() {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sortMode, setSortMode] = useState('created_at')

  async function load() {
    if (!supabase) return
    setBusy(true)
    setMsg('')
    const { data, error } = await supabase
      .from('collections')
      .select('*')
      .order('created_at', { ascending: false })
    setBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    setRows(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function onDelete(id) {
    const okFirst = confirm('Удалить подборку? Ссылка для клиента перестанет работать.')
    if (!okFirst) return
    const okSecond = confirm(
      'Подтвердите удаление: подборка и связанные записи просмотров будут удалены безвозвратно из базы.'
    )
    if (!okSecond) return
    setMsg('')
    try {
      const resp = await fetch('/api/collections/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setMsg(body?.error || 'Не удалось удалить подборку')
        return
      }
      setMsg('Подборка удалена')
      load()
    } catch (e) {
      setMsg(e?.message || 'Ошибка сети')
    }
  }

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    if (sortMode === 'views') {
      copy.sort((a, b) => {
        const viewsDiff = Number(b.views_count ?? 0) - Number(a.views_count ?? 0)
        if (viewsDiff !== 0) return viewsDiff
        return new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0)
      })
    } else {
      copy.sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0))
    }
    return copy
  }, [rows, sortMode])

  async function copyLink(token) {
    const link = `${window.location.origin}/collections/${token}`
    await navigator.clipboard.writeText(link)
    setMsg('Ссылка скопирована')
  }

  return (
    <AdminLayout title="Подборки квартир">
      {msg ? (
        <p className="mb-4 rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-200">{msg}</p>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-slate-400">Сортировка:</span>
        <button
          type="button"
          onClick={() => setSortMode('created_at')}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            sortMode === 'created_at'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          По дате
        </button>
        <button
          type="button"
          onClick={() => setSortMode('views')}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            sortMode === 'views'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          По просмотрам
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900/80">
            <tr>
              <th className="p-3">Название</th>
              <th className="p-3">Клиент</th>
              <th className="p-3">Квартир</th>
              <th className="p-3">Просмотры</th>
              <th className="p-3">Дата</th>
              <th className="p-3 w-52">Ссылка / действия</th>
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td className="p-3 text-slate-400" colSpan={7}>
                  Загрузка...
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-400" colSpan={7}>
                  Подборок пока нет
                </td>
              </tr>
            ) : (
              sortedRows.map((c) => {
                const hasViews = Object.prototype.hasOwnProperty.call(c, 'views_count')
                const views = Number(c.views_count ?? 0)
                const isNew = isNewCollection(c.created_at)
                return (
                  <tr
                    key={c.id}
                    className={`border-b border-slate-800/70 ${
                      isNew ? 'bg-emerald-950/20' : ''
                    }`}
                  >
                    <td className="p-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span>{c.title || 'Без названия'}</span>
                        {isNew ? (
                          <span className="rounded bg-emerald-700/40 px-2 py-0.5 text-xs text-emerald-200">
                            Новая
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3 text-slate-300">{c.client_name || '—'}</td>
                    <td className="p-3 text-slate-300">{Array.isArray(c.units) ? c.units.length : 0}</td>
                    <td className="p-3">
                      {hasViews ? (
                        <>
                          <span className="font-semibold text-slate-100">{views}</span>
                          {views > 0 ? <span className="ml-2 text-xs text-amber-300">🔥 просмотрено</span> : null}
                        </>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-400">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString('ru-RU') : '—'}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => copyLink(c.token)}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                        >
                          Копировать
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(c.id)}
                          className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-900/50"
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  )
}

