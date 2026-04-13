import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState(false)
  const [ready, setReady]       = useState(false)

  // Supabase передаёт токен в хэше URL — нужно дождаться onAuthStateChange с type=PASSWORD_RECOVERY
  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Пароли не совпадают')
      return
    }
    if (password.length < 6) {
      setError('Пароль минимум 6 символов')
      return
    }
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
      return
    }
    setSuccess(true)
    setTimeout(() => router.replace('/login'), 2000)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Новый пароль</h1>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          {success ? (
            <div className="text-center text-green-400">
              Пароль изменён. Перенаправление...
            </div>
          ) : !ready ? (
            <div className="text-center text-slate-400 text-sm">
              Проверка ссылки...
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {error && (
                <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
                  {error}
                </div>
              )}
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Новый пароль
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="Минимум 6 символов"
                />
              </div>
              <div className="mb-6">
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Повторите пароль
                </label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white transition hover:bg-blue-500"
              >
                Сохранить пароль
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
