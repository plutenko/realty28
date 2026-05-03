import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/authContext'

function getBrowserId() {
  const key = 'domovoy_browser_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}

const WORKER_BASE =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_WORKER_BASE) || ''

// Прогрев данных /apartments пока риелтор ждёт подтверждения руководителя.
// Браузер возьмёт их из cache (Cache-Control: public, max-age=300) когда
// /apartments после редиректа дёрнет fetchUnitsFromApi/fetchComplexesFromApi/etc.
function prefetchApartmentsData() {
  if (typeof window === 'undefined') return
  if (window.__apartmentsPrefetched) return
  window.__apartmentsPrefetched = true
  const urls = WORKER_BASE
    ? [`${WORKER_BASE}/units`, `${WORKER_BASE}/complexes`, `${WORKER_BASE}/buildings-summary`]
    : ['/api/units', '/api/complexes', '/api/buildings-summary']
  for (const u of urls) {
    fetch(u, { credentials: 'omit', mode: 'cors' }).catch(() => {})
  }
}

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
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState('')
  const pollingRef = useRef(null)

  useEffect(() => {
    if (!loading && user && profile && !pendingToken && !deviceChecking && !submitting) {
      const dest =
        profile.role === 'admin' ? '/admin'
        : profile.role === 'manager' ? '/manager'
        : '/apartments'
      router.replace(dest)
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
    pollingRef.current = setInterval(poll, 2000)
    return () => {
      stopped = true
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingToken])

  async function finalizeLogin() {
    const dest =
      pendingRole === 'admin'
        ? '/admin'
        : pendingRole === 'manager'
        ? '/manager'
        : '/apartments'

    // Логируем событие входа в фоне — не блокируем редирект
    ;(async () => {
      try {
        const { data: { session: s } } = await supabase.auth.getSession()
        if (!s) return
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
      } catch {}
    })()

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
          browserId: getBrowserId(),
        }),
      })
      const deviceData = await deviceRes.json()
      // 503 + status='send_failed' — pending_login создан, но Telegram недоступен.
      // Даём пользователю внятную ошибку и сохраняем токен чтобы кнопка "повторить" могла
      // переиспользовать тот же pending (resend без плодения дубликатов).
      if (!deviceRes.ok) {
        if (deviceData?.status === 'send_failed' && deviceData?.token) {
          setPendingToken(deviceData.token)
          setPendingLabel(deviceData.label || '')
          setResendError(deviceData.error || 'Не удалось уведомить руководителя')
        }
        throw new Error(deviceData?.error || 'Ошибка проверки устройства')
      }

      if (deviceData.status === 'approved') {
        setPendingRole(profileData.role)
        setDeviceChecking(false)
        await finalizeLogin()
        return
      }

      if (deviceData.status === 'pending') {
        setPendingToken(deviceData.token)
        setPendingLabel(deviceData.label || '')
        setResendError('')
        setDeviceChecking(false)
        // Не логаутим — нужна активная сессия для finalizeLogin
        // Пока риелтор ждёт подтверждения руководителя — прогреваем данные /apartments
        // (для admin/manager не зовём — они идут не на /apartments)
        if (profileData.role !== 'admin' && profileData.role !== 'manager') {
          prefetchApartmentsData()
        }
      }
    } catch (err) {
      setError(err.message || 'Ошибка входа')
      setSubmitting(false)
      setDeviceChecking(false)
    }
  }

  async function handleResend() {
    setResendError('')
    setResending(true)
    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      if (!s) throw new Error('Сессия истекла, войдите заново')
      const res = await fetch('/api/auth/check-device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s.access_token}`,
        },
        body: JSON.stringify({
          screen: screen.width && screen.height ? `${screen.width}x${screen.height}` : '',
          platform: navigator.platform || '',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          browserId: getBrowserId(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResendError(data?.error || 'Не удалось отправить повторно')
      } else {
        // Endpoint переиспользует активный pending, так что token прежний; просто ресет баннера
        setResendError('')
      }
    } catch (e) {
      setResendError(e.message || 'Ошибка сети')
    } finally {
      setResending(false)
    }
  }

  async function handleCancel() {
    setPendingToken(null)
    setPendingLabel('')
    setSubmitting(false)
    setDeviceChecking(false)
    await supabase.auth.signOut()
  }

  // Preconnect к Worker'у выносим из основного JSX — useAuth() стартует с loading=true,
  // и `if (loading) return null` иначе скрывает Head во время SSR.
  const preconnectHead = WORKER_BASE ? (
    <Head>
      <link rel="preconnect" href={WORKER_BASE} crossOrigin="anonymous" />
      <link rel="dns-prefetch" href={WORKER_BASE} />
    </Head>
  ) : null

  if (loading) return preconnectHead

  return (
    <>
      {preconnectHead}
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/logo.png" alt="СОБР" className="mx-auto mb-4 h-44 w-auto" />
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
            {resendError && (
              <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 border border-red-500/20">
                {resendError}
              </div>
            )}
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {resending ? 'Отправляем…' : 'Отправить повторно'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="text-sm text-slate-400 hover:text-white"
              >
                Отменить
              </button>
            </div>
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
    </>
  )
}
