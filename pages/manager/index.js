import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/authContext'
import Link from 'next/link'

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

async function apiFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${session?.access_token}` },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка')
  return json
}

function RealtorsList({ realtors, origin }) {
  const [expanded, setExpanded] = useState({})

  if (realtors.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center text-slate-500">
        Риелторов пока нет
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {realtors.map(r => (
        <div key={r.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <button
            onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/40 transition text-left"
          >
            <div>
              <div className="font-medium text-white">{r.name || '—'}</div>
              <div className="text-xs text-slate-500 mt-0.5">{r.email}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-blue-500/20 border border-blue-500/30 px-2.5 py-0.5 text-xs text-blue-300">
                {r.collections.length} подборок
              </span>
              <span className="text-slate-500 text-sm">{expanded[r.id] ? '▲' : '▼'}</span>
            </div>
          </button>

          {expanded[r.id] && (
            <div className="border-t border-slate-800">
              {r.collections.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500">Подборок нет</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-900/80">
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-400">Подборка</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-400">Клиент</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-400">Просмотры</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-400">Дата</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-slate-400">Ссылка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.collections.map(c => (
                      <tr key={c.id} className="border-t border-slate-800/60 hover:bg-slate-800/20">
                        <td className="px-5 py-3 text-white">{c.title || '—'}</td>
                        <td className="px-5 py-3 text-slate-400">{c.client_name || '—'}</td>
                        <td className="px-5 py-3 text-slate-400">{c.views_count ?? 0}</td>
                        <td className="px-5 py-3 text-slate-400">{formatDate(c.created_at)}</td>
                        <td className="px-5 py-3">
                          <a
                            href={`${origin}/collections/${c.token}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 underline text-xs"
                          >
                            Открыть
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function ManagerPage() {
  const { profile, signOut, loading } = useAuth()
  const router = useRouter()
  const [data, setData] = useState({ realtors: [], managers: [] })
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState('')
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    setOrigin(window.location.origin)
    apiFetch('/api/manager/realtors')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setFetching(false))
  }, [])

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  const isAdmin = profile?.role === 'admin'
  const totalCollections = data.realtors.reduce((s, r) => s + r.collections.length, 0)

  if (loading) return null

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Шапка */}
      <div className="border-b border-slate-800 bg-slate-900/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-white">
              {isAdmin ? 'Администратор' : 'Руководитель'}
            </span>
            <span className="text-slate-600">|</span>
            <Link href="/buildings" className="text-sm text-slate-400 hover:text-white transition">Шахматки</Link>
            <Link href="/apartments" className="text-sm text-slate-400 hover:text-white transition">Квартиры</Link>
            {isAdmin && (
              <Link href="/admin" className="text-sm text-slate-400 hover:text-white transition">Админка</Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            {profile?.name && <span className="text-sm text-slate-400">{profile.name}</span>}
            <button
              onClick={handleSignOut}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition"
            >
              Выйти
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-6">

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}

        {fetching ? (
          <p className="text-sm text-slate-500">Загрузка...</p>
        ) : (
          <>
            {/* Блок менеджеров — только для admin */}
            {isAdmin && (
              <div className="mb-8">
                <h2 className="mb-3 text-lg font-semibold text-white">
                  Руководители
                  <span className="ml-2 text-sm font-normal text-slate-400">{data.managers.length}</span>
                </h2>
                {data.managers.length === 0 ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 text-sm text-slate-500">
                    Руководителей пока нет
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-slate-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/60">
                          <th className="px-4 py-3 text-left font-medium text-slate-400">Имя</th>
                          <th className="px-4 py-3 text-left font-medium text-slate-400">Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.managers.map(m => (
                          <tr key={m.id} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                            <td className="px-4 py-3 font-medium text-white">{m.name || '—'}</td>
                            <td className="px-4 py-3 text-slate-400">{m.email}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Блок риелторов */}
            <div>
              <h2 className="mb-3 text-lg font-semibold text-white">
                Риелторы
                <span className="ml-2 text-sm font-normal text-slate-400">
                  {data.realtors.length} · {totalCollections} подборок
                </span>
              </h2>
              <RealtorsList realtors={data.realtors} origin={origin} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
