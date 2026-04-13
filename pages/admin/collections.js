import { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'

function fmt(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU')
}
function fmtMonth(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}
function isNew(createdAt) {
  return createdAt && Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000
}

const TABS = [
  { id: 'list',       label: 'Все подборки' },
  { id: 'by_day',     label: 'По дням' },
  { id: 'by_month',   label: 'По месяцам' },
  { id: 'by_realtor', label: 'По пользователям' },
]

export default function AdminCollectionsPage() {
  const [rows, setRows]         = useState([])
  const [profiles, setProfiles] = useState({})
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState('')
  const [tab, setTab]           = useState('list')
  const [filterRealtor, setFilterRealtor] = useState('all')
  const [origin, setOrigin]     = useState('')

  useEffect(() => { setOrigin(window.location.origin) }, [])

  async function load() {
    if (!supabase) return
    setBusy(true)
    setMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/collections', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Ошибка')
      setRows(body.collections ?? [])
      setProfiles(body.profiles ?? {})
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { load() }, [])

  async function onDelete(id) {
    if (!confirm('Удалить подборку? Ссылка для клиента перестанет работать.')) return
    if (!confirm('Подтвердите удаление.')) return
    setMsg('')
    const resp = await fetch('/api/collections/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok) { setMsg(body?.error || 'Ошибка'); return }
    setMsg('Подборка удалена')
    load()
  }

  async function copyLink(token) {
    await navigator.clipboard.writeText(`${origin}/collections/${token}`)
    setMsg('Ссылка скопирована')
  }

  const ROLE_LABELS = { admin: 'Админ', manager: 'Рук-ль', realtor: 'Риелтор' }

  const userName = (id) => {
    if (!id) return '—'
    const p = profiles[id]
    if (!p) return '—'
    const name = p.name || p.email || '—'
    const badge = p.role && p.role !== 'realtor' ? ` (${ROLE_LABELS[p.role] || p.role})` : ''
    return name + badge
  }

  const filtered = useMemo(() => {
    if (filterRealtor === 'all') return rows
    return rows.filter(r => r.created_by === filterRealtor)
  }, [rows, filterRealtor])

  const realtorsWithCols = useMemo(() => {
    const ids = [...new Set(rows.map(r => r.created_by).filter(Boolean))]
    return ids.map(id => ({ id, ...(profiles[id] ?? { name: null, email: id }) }))
  }, [rows, profiles])

  const byDay = useMemo(() => {
    const map = {}
    for (const r of filtered) {
      const day = r.created_at ? r.created_at.slice(0, 10) : 'unknown'
      if (!map[day]) map[day] = { day, count: 0, views: 0 }
      map[day].count++
      map[day].views += Number(r.views_count ?? 0)
    }
    return Object.values(map).sort((a, b) => b.day.localeCompare(a.day))
  }, [filtered])

  const byMonth = useMemo(() => {
    const map = {}
    for (const r of filtered) {
      const month = r.created_at ? r.created_at.slice(0, 7) : 'unknown'
      if (!map[month]) map[month] = { month, count: 0, views: 0 }
      map[month].count++
      map[month].views += Number(r.views_count ?? 0)
    }
    return Object.values(map).sort((a, b) => b.month.localeCompare(a.month))
  }, [filtered])

  const byRealtor = useMemo(() => {
    const map = {}
    for (const r of rows) {
      const rid = r.created_by || 'unknown'
      if (!map[rid]) map[rid] = { id: rid, count: 0, views: 0 }
      map[rid].count++
      map[rid].views += Number(r.views_count ?? 0)
    }
    return Object.values(map)
      .sort((a, b) => b.count - a.count)
      .map(r => ({
        ...r,
        name: profiles[r.id]?.name || '—',
        email: profiles[r.id]?.email || (r.id === 'unknown' ? 'Без риелтора' : r.id),
      }))
  }, [rows, profiles])

  return (
    <AdminLayout title="Подборки">
      {msg && (
        <p className="mb-4 rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-200">{msg}</p>
      )}

      {/* Табы */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Фильтр по риелтору */}
      {tab !== 'by_realtor' && realtorsWithCols.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">Автор:</span>
          <button onClick={() => setFilterRealtor('all')}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${filterRealtor === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            Все
          </button>
          {realtorsWithCols.map(r => (
            <button key={r.id} onClick={() => setFilterRealtor(r.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${filterRealtor === r.id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {r.name || r.email}
            </button>
          ))}
        </div>
      )}

      {busy && <p className="text-sm text-slate-400">Загрузка...</p>}

      {/* Все подборки */}
      {tab === 'list' && !busy && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80">
              <tr>
                <th className="p-3">Название</th>
                <th className="p-3">Автор</th>
                <th className="p-3">Клиент</th>
                <th className="p-3">Квартир</th>
                <th className="p-3">Просмотры</th>
                <th className="p-3">Дата</th>
                <th className="p-3 w-44">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="p-3 text-slate-500">Подборок нет</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id} className={`border-b border-slate-800/70 ${isNew(c.created_at) ? 'bg-emerald-950/20' : ''}`}>
                  <td className="p-3 font-medium">
                    {c.title || 'Без названия'}
                    {isNew(c.created_at) && (
                      <span className="ml-2 rounded bg-emerald-700/40 px-1.5 py-0.5 text-xs text-emerald-200">Новая</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-300">{userName(c.created_by)}</td>
                  <td className="p-3 text-slate-300">{c.client_name || '—'}</td>
                  <td className="p-3 text-slate-300">{Array.isArray(c.units) ? c.units.length : 0}</td>
                  <td className="p-3 font-semibold text-slate-100">{c.views_count ?? 0}</td>
                  <td className="p-3 text-slate-400">{fmt(c.created_at)}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => copyLink(c.token)} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs text-white hover:bg-blue-500">
                        Копировать
                      </button>
                      <button onClick={() => onDelete(c.id)} className="rounded-lg border border-rose-800 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-200 hover:bg-rose-900/50">
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* По дням */}
      {tab === 'by_day' && !busy && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80">
              <tr>
                <th className="p-3">Дата</th>
                <th className="p-3">Создано подборок</th>
                <th className="p-3">Просмотров</th>
              </tr>
            </thead>
            <tbody>
              {byDay.length === 0 ? (
                <tr><td colSpan={3} className="p-3 text-slate-500">Нет данных</td></tr>
              ) : byDay.map(d => (
                <tr key={d.day} className="border-b border-slate-800/70">
                  <td className="p-3 text-white">
                    {d.day === 'unknown' ? '—' : new Date(d.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </td>
                  <td className="p-3 font-semibold text-blue-300">{d.count}</td>
                  <td className="p-3 font-semibold text-amber-300">{d.views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* По месяцам */}
      {tab === 'by_month' && !busy && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80">
              <tr>
                <th className="p-3">Месяц</th>
                <th className="p-3">Создано подборок</th>
                <th className="p-3">Просмотров</th>
              </tr>
            </thead>
            <tbody>
              {byMonth.length === 0 ? (
                <tr><td colSpan={3} className="p-3 text-slate-500">Нет данных</td></tr>
              ) : byMonth.map(m => (
                <tr key={m.month} className="border-b border-slate-800/70">
                  <td className="p-3 text-white capitalize">
                    {m.month === 'unknown' ? '—' : fmtMonth(m.month + '-01')}
                  </td>
                  <td className="p-3 font-semibold text-blue-300">{m.count}</td>
                  <td className="p-3 font-semibold text-amber-300">{m.views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* По риелторам */}
      {tab === 'by_realtor' && !busy && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80">
              <tr>
                <th className="p-3">Автор</th>
                <th className="p-3">Email</th>
                <th className="p-3">Подборок</th>
                <th className="p-3">Просмотров</th>
              </tr>
            </thead>
            <tbody>
              {byRealtor.length === 0 ? (
                <tr><td colSpan={4} className="p-3 text-slate-500">Нет данных</td></tr>
              ) : byRealtor.map(r => (
                <tr key={r.id} className="border-b border-slate-800/70">
                  <td className="p-3 font-medium text-white">{r.name}</td>
                  <td className="p-3 text-slate-400">{r.email}</td>
                  <td className="p-3 font-semibold text-blue-300">{r.count}</td>
                  <td className="p-3 font-semibold text-amber-300">{r.views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  )
}
