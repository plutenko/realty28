import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/authContext'

export default function LoginPage() {
  const router = useRouter()
  const { user, profile, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Шаг 2: ожидание подтверждения устройства
  const [pendingToken, setPendingToken] = useState(null)
  const [pendingLabel, setPendingLabel] = useState('')
  const [pendingRole, setPendingRole] = useState(null)
  const [deviceChecking, setDeviceChecking] = useState(false)
  const pollingRef = useRef(null)

  useEffect(() => {
    if (!loading && user && profile && !pendingToken && !deviceChecking && !submitting) {
      router.replace(profile.role === 'admin' ? '/admin' : '/buildings')
    }
  }, [loading, user, profile, pendingToken, deviceChecking, submitting])

  // Polling pending_login статуса
  useEffect(() => {
    if (!pendingToken) return
    let stopped = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/poll-approval?token=${encodeURIComponent(pendingToken)}`)
        const data = await res.json()
        if (stopped) return
        if (data.status === 'approved') {
          // Успешно подтверждено — регистрируем session и переходим
          await finalizeLogin()
        } else if (data.status === 'rejected' || data.status === 'expired' || data.status === 'not_found') {
          // Неуспех — выходим
          setError(
            data.status === 'rejected'
              ? 'Вход отклонён руководителем'
              : 'Срок действия запроса истёк. Попробуйте снова.'
          )
          setPendingToken(null)
          await supabase.auth.signOut()
        }
      } catch {}
    }
    poll()
    pollingRef.current = setInterval(poll, 3000)
    return () => {
      stopped = true
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingToken])

  async function finalizeLogin() {
    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      if (s) {
        const deviceLabel = [
          navigator.platform || '',
          screen.width && screen.height ? `${screen.width}×${screen.height}` : '',
        ].filter(Boolean).join(' · ')

        const evRes = await fetch('/api/auth/login-event', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${s.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ deviceLabel }),
        })
        if (evRes.ok) {
          const { sessionId } = await evRes.json()
          if (sessionId) localStorage.setItem('domovoy_sid', sessionId)
        }
      }
    } catch {}

    const dest =
      pendingRole === 'admin'
        ? '/admin'
        : pendingRole === 'manager'
        ? '/manager'
        : '/buildings'
    router.replace(dest)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!supabase) return
    setError('')
    setSubmitting(true)
    setDeviceChecking(true)
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) throw new Error('Неверный email или пароль')

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single()

      if (profileError || !profileData) {
        await supabase.auth.signOut()
        throw new Error('Профиль не найден. Обратитесь к администратору.')
      }
      setPendingRole(profileData.role)

      // Проверяем устройство
      const { data: { session: s } } = await supabase.auth.getSession()
      if (!s) throw new Error('Не удалось получить сессию')

      const deviceRes = await fetch('/api/auth/check-device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s.access_token}`,
        },
        body: JSON.stringify({
          screen: screen.width && screen.height ? `${screen.width}x${screen.height}` : '',
          platform: navigator.platform || '',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        }),
      })
      const deviceData = await deviceRes.json()
      if (!deviceRes.ok) throw new Error(deviceData?.error || 'Ошибка проверки устройства')

      if (deviceData.status === 'approved') {
        setPendingRole(profileData.role)
        setDeviceChecking(false)
        await finalizeLogin()
        return
      }

      if (deviceData.status === 'pending') {
        setPendingToken(deviceData.token)
        setPendingLabel(deviceData.label || '')
        setDeviceChecking(false)
        // Не логаутим — нужна активная сессия для finalizeLogin
      }
    } catch (err) {
      setError(err.message || 'Ошибка входа')
      setSubmitting(false)
      setDeviceChecking(false)
    }
  }

  async function handleCancel() {
    setPendingToken(null)
    setPendingLabel('')
    setSubmitting(false)
    setDeviceChecking(false)
    await supabase.auth.signOut()
  }

  if (loading) return null

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/logo.png" alt="СОБР" className="mx-auto mb-4 h-28 w-auto" />
        </div>

        {pendingToken ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-t-blue-500"></div>
            <h2 className="text-lg font-semibold text-white">Ожидаем подтверждение</h2>
            <p className="mt-3 text-sm text-slate-400">
              Вы входите с нового устройства.
              <br />
              Запрос отправлен руководителю в Telegram.
            </p>
            <div className="mt-4 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300">
              Устройство: {pendingLabel}
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="mt-5 text-sm text-slate-400 hover:text-white"
            >
              Отменить
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            {error && (
              <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
                {error}
              </div>
            )}

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="you@example.com"
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
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {submitting ? 'Вход...' : 'Войти'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
