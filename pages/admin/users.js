import { useState, useEffect, useCallback } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'

const ROLE_LABEL = { admin: 'Администратор', realtor: 'Риелтор', manager: 'Руководитель' }

function generatePassword(length = 10) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  const arr = new Uint32Array(length)
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 2 ** 32)
  }
  for (let i = 0; i < length; i++) out += alphabet[arr[i] % alphabet.length]
  return out
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
const ROLE_COLOR = {
  admin:   'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  realtor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  manager: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
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
  const [showPwd, setShowPwd]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [createdCreds, setCreatedCreds] = useState(null) // { email, password, name, role }
  const [copied, setCopied]       = useState(false)

  const [editPwd, setEditPwd]     = useState(null) // { id, value, show }
  const [editPwdSaved, setEditPwdSaved] = useState(null) // { id, value }
  const [deleting, setDeleting]   = useState(null)
  const [showFired, setShowFired] = useState(false)

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
      const snapshot = { ...form }
      await apiFetch('POST', '/api/admin/users', form)
      setCreatedCreds(snapshot)
      setCopied(false)
      setForm({ email: '', password: '', name: '', role: 'realtor' })
      setShowPwd(false)
      setShowForm(false)
      await loadUsers()
    } catch (e) {
      setFormError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopyCreds() {
    if (!createdCreds) return
    const text = `Email: ${createdCreds.email}\nПароль: ${createdCreds.password}`
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function handleFire(id, name) {
    if (!confirm(`Уволить ${name || 'пользователя'}? История отчётов сохранится, вход будет недоступен.`)) return
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

  async function handleReinstate(id) {
    try {
      await apiFetch('PATCH', '/api/admin/users', { id, is_active: true })
      await loadUsers()
    } catch (e) {
      alert(e.message)
    }
  }

  async function handleSavePwd(id) {
    if (!editPwd?.value || editPwd.value.length < 6) {
      alert('Пароль минимум 6 символов')
      return
    }
    try {
      const value = editPwd.value
      await apiFetch('PATCH', '/api/admin/users', { id, password: value })
      setEditPwd(null)
      setEditPwdSaved({ id, value })
    } catch (e) {
      alert(e.message)
    }
  }

  async function handleCopySavedPwd() {
    if (!editPwdSaved) return
    const ok = await copyToClipboard(editPwdSaved.value)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <AdminLayout title="Пользователи">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Управление доступом риелторов и администраторов
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={showFired}
              onChange={(e) => setShowFired(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-800"
            />
            Показывать уволенных
          </label>
          <button
            onClick={() => { setShowForm(v => !v); setFormError('') }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition"
          >
            + Добавить пользователя
          </button>
        </div>
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
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Минимум 6 символов"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 pr-10 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute inset-y-0 right-0 px-3 text-xs text-slate-400 hover:text-white"
                    title={showPwd ? 'Скрыть' : 'Показать'}
                  >
                    {showPwd ? '🙈' : '👁'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => { setForm(f => ({ ...f, password: generatePassword(10) })); setShowPwd(true) }}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700"
                  title="Сгенерировать случайный пароль"
                >
                  Сгенерировать
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Роль *</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              >
                <option value="realtor">Риелтор</option>
                <option value="manager">Руководитель</option>
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

      {createdCreds && (
        <div className="mb-4 rounded-2xl border border-green-500/40 bg-green-500/10 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-green-300">
                ✓ Пользователь создан{createdCreds.name ? `: ${createdCreds.name}` : ''}
              </h3>
              <p className="mt-1 text-xs text-green-400/80">
                Сохраните эти данные и передайте пользователю. После закрытия карточки пароль восстановить нельзя.
              </p>
              <div className="mt-3 space-y-1.5 font-mono text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-20 text-xs text-slate-400">Email:</span>
                  <span className="text-white">{createdCreds.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-20 text-xs text-slate-400">Пароль:</span>
                  <span className="select-all text-white">{createdCreds.password}</span>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleCopyCreds}
                  className="rounded-lg bg-green-600/30 px-3 py-1.5 text-xs font-semibold text-green-200 hover:bg-green-600/50 transition"
                >
                  {copied ? '✓ Скопировано' : 'Скопировать email и пароль'}
                </button>
                <button
                  type="button"
                  onClick={() => setCreatedCreds(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 transition"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editPwdSaved && (
        <div className="mb-4 rounded-2xl border border-blue-500/40 bg-blue-500/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 font-mono text-sm">
              <span className="text-xs text-slate-400 mr-2">Новый пароль:</span>
              <span className="select-all text-white">{editPwdSaved.value}</span>
            </div>
            <button
              type="button"
              onClick={handleCopySavedPwd}
              className="rounded-lg bg-blue-600/30 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-600/50"
            >
              {copied ? '✓ Скопировано' : 'Скопировать'}
            </button>
            <button
              type="button"
              onClick={() => setEditPwdSaved(null)}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
            >
              Закрыть
            </button>
          </div>
        </div>
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
              {users.filter(u => showFired || u.is_active !== false).map(u => (
                <tr key={u.id} className={`border-b border-slate-800/60 hover:bg-slate-900/40 ${u.is_active === false ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">
                      {u.name || '—'}
                      {u.is_active === false && <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">уволен</span>}
                    </div>
                    <div className="text-xs text-slate-500">{u.email ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role || ''}
                      onChange={async e => {
                        const newRole = e.target.value
                        if (!newRole || newRole === u.role) return
                        if (!confirm(`Сменить роль ${u.name || u.email} на «${ROLE_LABEL[newRole]}»?`)) return
                        try {
                          await apiFetch('PATCH', '/api/admin/users', { id: u.id, role: newRole })
                          await loadUsers()
                        } catch (err) {
                          alert(err.message)
                        }
                      }}
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium outline-none ${u.role ? ROLE_COLOR[u.role] : 'border-slate-700 bg-slate-800 text-slate-400'}`}
                    >
                      {!u.role && <option value="">без профиля</option>}
                      <option value="realtor">Риелтор</option>
                      <option value="manager">Руководитель</option>
                      {u.role === 'admin' && <option value="admin">Администратор</option>}
                    </select>
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
                            type={editPwd.show ? 'text' : 'password'}
                            autoFocus
                            placeholder="Новый пароль"
                            value={editPwd.value}
                            onChange={e => setEditPwd(p => ({ ...p, value: e.target.value }))}
                            className="w-40 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => setEditPwd(p => ({ ...p, show: !p.show }))}
                            className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                            title={editPwd.show ? 'Скрыть' : 'Показать'}
                          >
                            {editPwd.show ? '🙈' : '👁'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditPwd(p => ({ ...p, value: generatePassword(10), show: true }))}
                            className="rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                            title="Сгенерировать"
                          >
                            ⚡
                          </button>
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
                          onClick={() => setEditPwd({ id: u.id, value: '', show: false })}
                          className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 transition"
                        >
                          Сменить пароль
                        </button>
                      )}
                      {u.is_active === false ? (
                        <button
                          onClick={() => handleReinstate(u.id)}
                          className="rounded-lg px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10 transition"
                        >
                          Восстановить
                        </button>
                      ) : (
                        <button
                          onClick={() => handleFire(u.id, u.name)}
                          disabled={deleting === u.id}
                          className="rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition"
                        >
                          {deleting === u.id ? '...' : 'Уволить'}
                        </button>
                      )}
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
