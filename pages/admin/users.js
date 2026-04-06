import { useState, useEffect, useCallback } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'

const ROLE_LABEL = { admin: 'Администратор', realtor: 'Риелтор' }
const ROLE_COLOR = {
  admin:   'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  realtor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
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
  const res = await fetch(path, opts)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка')
  return json
}

export default function UsersPage() {
  const [users, setUsers]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')

  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState({ email: '', password: '', name: '', role: 'realtor' })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const [editPwd, setEditPwd]     = useState(null) // { id, value }
  const [deleting, setDeleting]   = useState(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch('GET', '/api/admin/users')
      setUsers(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      await apiFetch('POST', '/api/admin/users', form)
      setForm({ email: '', password: '', name: '', role: 'realtor' })
      setShowForm(false)
      await loadUsers()
    } catch (e) {
      setFormError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Удалить пользователя?')) return
    setDeleting(id)
    try {
      await apiFetch('DELETE', `/api/admin/users?id=${id}`)
      await loadUsers()
    } catch (e) {
      alert(e.message)
    } finally {
      setDeleting(null)
    }
  }

  async function handleSavePwd(id) {
    if (!editPwd?.value || editPwd.value.length < 6) {
      alert('Пароль минимум 6 символов')
      return
    }
    try {
      await apiFetch('PATCH', '/api/admin/users', { id, password: editPwd.value })
      setEditPwd(null)
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <AdminLayout title="Пользователи">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Управление доступом риелторов и администраторов
        </p>
        <button
          onClick={() => { setShowForm(v => !v); setFormError('') }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition"
        >
          + Добавить пользователя
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 rounded-2xl border border-slate-700 bg-slate-900 p-5"
        >
          <h2 className="mb-4 text-base font-semibold text-white">Новый пользователь</h2>
          {formError && (
            <div className="mb-3 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400 border border-red-500/20">
              {formError}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Имя</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Иван Иванов"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Email *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="ivan@example.com"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Пароль *</label>
              <input
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Минимум 6 символов"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Роль *</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              >
                <option value="realtor">Риелтор</option>
                <option value="admin">Администратор</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition"
            >
              {submitting ? 'Создание...' : 'Создать'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 transition"
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Загрузка...</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60">
                <th className="px-4 py-3 text-left font-medium text-slate-400">Пользователь</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Роль</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Последний вход</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    Пользователей нет
                  </td>
                </tr>
              )}
              {users.map(u => (
                <tr key={u.id} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{u.name || '—'}</div>
                    <div className="text-xs text-slate-500">{u.email ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    {u.role ? (
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ROLE_COLOR[u.role]}`}>
                        {ROLE_LABEL[u.role]}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">без профиля</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {u.last_sign_in_at
                      ? new Date(u.last_sign_in_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
                      : 'никогда'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {editPwd?.id === u.id ? (
                        <>
                          <input
                            type="password"
                            autoFocus
                            placeholder="Новый пароль"
                            value={editPwd.value}
                            onChange={e => setEditPwd(p => ({ ...p, value: e.target.value }))}
                            className="w-36 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
                          />
                          <button
                            onClick={() => handleSavePwd(u.id)}
                            className="rounded-lg bg-blue-600/20 px-2 py-1 text-xs text-blue-400 hover:bg-blue-600/30 transition"
                          >
                            Сохранить
                          </button>
                          <button
                            onClick={() => setEditPwd(null)}
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 transition"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setEditPwd({ id: u.id, value: '' })}
                          className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 transition"
                        >
                          Сменить пароль
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(u.id)}
                        disabled={deleting === u.id}
                        className="rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition"
                      >
                        {deleting === u.id ? '...' : 'Удалить'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  )
}
