import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/authContext'

function loginToEmail(login) {
  return `${login.trim().toLowerCase()}@app.local`
}

export default function AdminLoginPage() {
  const router = useRouter()
  const { user, profile, loading } = useAuth()
  const [login, setLogin]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && user && profile?.role === 'admin') {
      router.replace('/admin')
    }
  }, [loading, user, profile])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabase) return
    setError('')
    setSubmitting(true)
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: loginToEmail(login),
        password,
      })
      if (authError) throw new Error('Неверный логин или пароль')

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single()

      if (profileError || !profileData) {
        await supabase.auth.signOut()
        throw new Error('Профиль не найден.')
      }

      if (profileData.role !== 'admin') {
        await supabase.auth.signOut()
        throw new Error('Нет доступа администратора.')
      }

      router.replace('/admin')
    } catch (err) {
      setError(err.message || 'Ошибка входа')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return null

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Администратор</h1>
          <p className="mt-2 text-sm text-slate-400">Управление новостройками</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          {error && (
            <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Логин
            </label>
            <input
              type="text"
              required
              autoComplete="username"
              value={login}
              onChange={e => setLogin(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="admin"
            />
          </div>

          <div className="mb-6">
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Пароль
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-600">
          <a href="/login" className="text-slate-500 hover:text-slate-400 underline">
            Вход для риелтора
          </a>
        </p>
      </div>
    </div>
  )
}
