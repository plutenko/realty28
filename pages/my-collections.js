import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/authContext'
import CatalogTabs from '../components/CatalogTabs'
import CollectionMetaModal from '../components/apartments/CollectionMetaModal'

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

export default function MyCollectionsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [collections, setCollections] = useState([])
  const [fetching, setFetching] = useState(true)
  const [origin, setOrigin] = useState('')
  const [editingCollection, setEditingCollection] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    const publicHost = process.env.NEXT_PUBLIC_COLLECTION_HOST
    setOrigin(publicHost ? `https://${publicHost}` : window.location.origin)
  }, [])

  useEffect(() => {
    if (loading || !user || !supabase) return
    supabase
      .from('collections')
      .select('id, token, title, client_name, views_count, created_at, show_complex_name, show_developer_name, show_address')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setCollections(data ?? [])
        setFetching(false)
      })
  }, [loading, user])

  async function copyLink(token) {
    const link = `${origin}/collections/${token}`
    await navigator.clipboard.writeText(link)
    alert('Ссылка скопирована!')
  }

  async function handleDelete(id) {
    if (!confirm('Удалить подборку? Ссылка перестанет работать.')) return
    const res = await fetch('/api/collections/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) setCollections(c => c.filter(x => x.id !== id))
  }

  async function submitEdit(values) {
    if (!editingCollection) return
    try {
      setSavingEdit(true)
      const res = await fetch('/api/collections/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingCollection.id,
          title: values.title,
          clientName: values.clientName,
          showComplexName: values.showComplexName,
          showDeveloperName: values.showDeveloperName,
          showAddress: values.showAddress,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Не удалось сохранить')
      setCollections(list =>
        list.map(c => (c.id === body.collection.id ? { ...c, ...body.collection } : c)),
      )
      setEditingCollection(null)
    } catch (e) {
      alert(e?.message || 'Ошибка сохранения')
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <CatalogTabs />
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Мои подборки</h1>

        {fetching ? (
          <p className="text-sm text-gray-500">Загрузка...</p>
        ) : collections.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-400">
            Подборок пока нет. Создайте первую во вкладке «Квартиры».
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Подборка</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Клиент</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Просмотры</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Дата</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Действия</th>
                </tr>
              </thead>
              <tbody>
                {collections.map(c => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.title || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{c.client_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{c.views_count ?? 0}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => copyLink(c.token)}
                          className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100 transition"
                        >
                          Скопировать ссылку
                        </button>
                        <a
                          href={`${origin}/collections/${c.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition"
                        >
                          Открыть
                        </a>
                        <button
                          onClick={() => setEditingCollection(c)}
                          className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition"
                          title="Редактировать"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition"
                          title="Удалить"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingCollection && (
        <CollectionMetaModal
          mode="edit"
          initialValues={editingCollection}
          onClose={() => setEditingCollection(null)}
          onSubmit={submitEdit}
          submitting={savingEdit}
        />
      )}
    </div>
  )
}
