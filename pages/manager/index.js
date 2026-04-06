import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/authContext'
import CatalogTabs from '../../components/CatalogTabs'

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

function RealtorCard({ r, origin }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition text-left"
      >
        <div>
          <div className="font-semibold text-gray-900">{r.name || '—'}</div>
          <div className="text-xs text-gray-400 mt-0.5">{r.email}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {r.collections.length} подборок
          </span>
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          {r.collections.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">Подборок нет</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Подборка</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Клиент</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Просмотры</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Дата</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Ссылка</th>
                  </tr>
                </thead>
                <tbody>
                  {r.collections.map(c => (
                    <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{c.title || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500">{c.client_name || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500">{c.views_count ?? 0}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{formatDate(c.created_at)}</td>
                      <td className="px-4 py-2.5">
                        <a
                          href={`${origin}/collections/${c.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-500 underline text-xs"
                        >
                          Открыть
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ManagerPage() {
  const { profile, loading } = useAuth()
  const [data, setData]       = useState({ realtors: [], managers: [] })
  const [fetching, setFetching] = useState(true)
  const [error, setError]     = useState('')
  const [origin, setOrigin]   = useState('')

  useEffect(() => { setOrigin(window.location.origin) }, [])

  useEffect(() => {
    apiFetch('/api/manager/realtors')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setFetching(false))
  }, [])

  if (loading) return null

  const isAdmin = profile?.role === 'admin'
  const totalCollections = data.realtors.reduce((s, r) => s + r.collections.length, 0)

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <CatalogTabs />

      <div className="px-4 py-4">
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
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {fetching ? (
          <p className="text-sm text-gray-400">Загрузка...</p>
        ) : (
          <>
            {/* Менеджеры — только для admin */}
            {isAdmin && data.managers.length > 0 && (
              <div className="mb-6">
                <h2 className="mb-3 text-base font-semibold text-gray-700">
                  Руководители
                  <span className="ml-2 text-sm font-normal text-gray-400">{data.managers.length}</span>
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

            {/* Риелторы */}
            <div>
              <h2 className="mb-3 text-base font-semibold text-gray-700">
                Риелторы
                <span className="ml-2 text-sm font-normal text-gray-400">{data.realtors.length}</span>
              </h2>
              {data.realtors.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-400">
                  Риелторов пока нет
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.realtors.map(r => (
                    <RealtorCard key={r.id} r={r} origin={origin} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
