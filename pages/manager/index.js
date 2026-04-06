import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/authContext'
import CatalogTabs from '../../components/CatalogTabs'

function fmt(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU')
}
function fmtFull(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}
function fmtMonth(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}

async function apiFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session?.access_token}` } })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка')
  return json
}

const TABS = [
  { id: 'list',        label: 'Все подборки' },
  { id: 'by_day',      label: 'По дням' },
  { id: 'by_month',    label: 'По месяцам' },
  { id: 'by_realtor',  label: 'По риелторам' },
  { id: 'login_logs',  label: 'Журнал входов' },
]

const tabBtn = (active) =>
  `rounded-xl px-4 py-2 text-sm font-medium transition border ${
    active
      ? 'bg-blue-600 text-white border-blue-600'
      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
  }`

const filterBtn = (active) =>
  `rounded-xl px-3 py-1.5 text-sm transition border ${
    active
      ? 'bg-blue-600 text-white border-blue-600'
      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
  }`

export default function ManagerPage() {
  const { profile, loading } = useAuth()
  const [data, setData]         = useState({ realtors: [], managers: [] })
  const [fetching, setFetching] = useState(true)
  const [error, setError]       = useState('')
  const [origin, setOrigin]     = useState('')
  const [tab, setTab]           = useState('list')
  const [filterRealtor, setFilterRealtor] = useState('all')
  const [logs, setLogs]         = useState([])
  const [logsFetched, setLogsFetched] = useState(false)
  const [logsFetching, setLogsFetching] = useState(false)

  useEffect(() => { setOrigin(window.location.origin) }, [])

  useEffect(() => {
    if (tab !== 'login_logs' || logsFetched) return
    setLogsFetching(true)
    apiFetch('/api/manager/login-logs')
      .then(d => { setLogs(d.logs ?? []); setLogsFetched(true) })
      .catch(() => {})
      .finally(() => setLogsFetching(false))
  }, [tab])

  useEffect(() => {
    apiFetch('/api/manager/realtors')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setFetching(false))
  }, [])

  if (loading) return null

  const isAdmin = profile?.role === 'admin'

  // Все подборки всех риелторов плоским списком
  const allCollections = useMemo(() =>
    data.realtors.flatMap(r => r.collections.map(c => ({ ...c, realtorName: r.name, realtorEmail: r.email, realtorId: r.id })))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [data.realtors]
  )

  // Профиль риелтора по id
  const realtorMap = useMemo(() => {
    const m = {}
    for (const r of data.realtors) m[r.id] = r
    return m
  }, [data.realtors])

  // Фильтр
  const filtered = useMemo(() =>
    filterRealtor === 'all' ? allCollections : allCollections.filter(c => c.realtorId === filterRealtor),
    [allCollections, filterRealtor]
  )

  // По дням
  const byDay = useMemo(() => {
    const map = {}
    for (const c of filtered) {
      const day = c.created_at ? c.created_at.slice(0, 10) : 'unknown'
      if (!map[day]) map[day] = { day, count: 0, views: 0 }
      map[day].count++
      map[day].views += Number(c.views_count ?? 0)
    }
    return Object.values(map).sort((a, b) => b.day.localeCompare(a.day))
  }, [filtered])

  // По месяцам
  const byMonth = useMemo(() => {
    const map = {}
    for (const c of filtered) {
      const month = c.created_at ? c.created_at.slice(0, 7) : 'unknown'
      if (!map[month]) map[month] = { month, count: 0, views: 0 }
      map[month].count++
      map[month].views += Number(c.views_count ?? 0)
    }
    return Object.values(map).sort((a, b) => b.month.localeCompare(a.month))
  }, [filtered])

  // По риелторам
  const byRealtor = useMemo(() =>
    data.realtors.map(r => ({
      ...r,
      views: r.collections.reduce((s, c) => s + Number(c.views_count ?? 0), 0),
    })).sort((a, b) => b.collections.length - a.collections.length),
    [data.realtors]
  )

  const totalCollections = allCollections.length

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <CatalogTabs />

      <div className="px-4 py-4">
        {/* Заголовок */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-gray-900">
            {isAdmin ? 'Обзор команды' : 'Кабинет руководителя'}
          </h1>
          <div className="flex gap-3 text-sm text-gray-500">
            <span>Риелторов: <span className="font-semibold text-gray-800">{data.realtors.length}</span></span>
            <span>Подборок: <span className="font-semibold text-gray-800">{totalCollections}</span></span>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {fetching ? (
          <p className="text-sm text-gray-400">Загрузка...</p>
        ) : (
          <>
            {/* Руководители — только для admin */}
            {isAdmin && data.managers.length > 0 && (
              <div className="mb-6">
                <h2 className="mb-3 text-base font-semibold text-gray-700">
                  Руководители <span className="text-sm font-normal text-gray-400">{data.managers.length}</span>
                </h2>
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Имя</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.managers.map(m => (
                        <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{m.name || '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{m.email}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Подборки с фильтрацией */}
            <div>
              <h2 className="mb-3 text-base font-semibold text-gray-700">Подборки риелторов</h2>

              {/* Табы */}
              <div className="mb-3 flex flex-wrap gap-2">
                {TABS.map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)} className={tabBtn(tab === t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Фильтр по риелтору */}
              {tab !== 'by_realtor' && data.realtors.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-500">Риелтор:</span>
                  <button onClick={() => setFilterRealtor('all')} className={filterBtn(filterRealtor === 'all')}>
                    Все
                  </button>
                  {data.realtors.map(r => (
                    <button key={r.id} onClick={() => setFilterRealtor(r.id)} className={filterBtn(filterRealtor === r.id)}>
                      {r.name || r.email}
                    </button>
                  ))}
                </div>
              )}

              {/* Все подборки */}
              {tab === 'list' && (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Название</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Риелтор</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Клиент</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Просмотры</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Дата</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Ссылка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Подборок нет</td></tr>
                      ) : filtered.map(c => (
                        <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{c.title || '—'}</td>
                          <td className="px-4 py-3 text-gray-600">{c.realtorName || '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{c.client_name || '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{c.views_count ?? 0}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{fmt(c.created_at)}</td>
                          <td className="px-4 py-3">
                            <a href={`${origin}/collections/${c.token}`} target="_blank" rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-500 underline text-xs">
                              Открыть
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* По дням */}
              {tab === 'by_day' && (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Дата</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Создано подборок</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Просмотров</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byDay.length === 0 ? (
                        <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">Нет данных</td></tr>
                      ) : byDay.map(d => (
                        <tr key={d.day} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-900">
                            {d.day === 'unknown' ? '—' : new Date(d.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </td>
                          <td className="px-4 py-3 font-semibold text-blue-600">{d.count}</td>
                          <td className="px-4 py-3 font-semibold text-amber-600">{d.views}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* По месяцам */}
              {tab === 'by_month' && (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Месяц</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Создано подборок</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Просмотров</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byMonth.length === 0 ? (
                        <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">Нет данных</td></tr>
                      ) : byMonth.map(m => (
                        <tr key={m.month} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-900 capitalize">
                            {m.month === 'unknown' ? '—' : fmtMonth(m.month + '-01')}
                          </td>
                          <td className="px-4 py-3 font-semibold text-blue-600">{m.count}</td>
                          <td className="px-4 py-3 font-semibold text-amber-600">{m.views}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* По риелторам */}
              {tab === 'by_realtor' && (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Риелтор</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Email</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Подборок</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Просмотров</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byRealtor.length === 0 ? (
                        <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Нет данных</td></tr>
                      ) : byRealtor.map(r => (
                        <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{r.name || '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{r.email}</td>
                          <td className="px-4 py-3 font-semibold text-blue-600">{r.collections.length}</td>
                          <td className="px-4 py-3 font-semibold text-amber-600">{r.views}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Журнал входов */}
              {tab === 'login_logs' && (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Пользователь</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Устройство</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">IP-адрес</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Дата и время</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logsFetching ? (
                        <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Загрузка...</td></tr>
                      ) : logs.length === 0 ? (
                        <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Нет данных</td></tr>
                      ) : logs.map(l => (
                        <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{l.userName}</div>
                            <div className="text-xs text-gray-400">{l.userEmail}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            <div>{l.browser} · {l.os_name}</div>
                            {l.device_label && (
                              <div className="text-xs text-gray-400">{l.device_label}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{l.ip_address}</td>
                          <td className="px-4 py-3 text-xs text-gray-400">
                            {new Date(l.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
