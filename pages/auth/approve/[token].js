import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/authContext'

export default function ApproveLoginPage() {
  const router = useRouter()
  const { token } = router.query
  const { user, profile, loading } = useAuth()
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token || !supabase || loading) return
    if (!user) return
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          setError('Нет активной сессии')
          return
        }
        const res = await fetch(
          `/api/auth/pending-login?token=${encodeURIComponent(String(token))}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        )
        const body = await res.json()
        if (!res.ok) {
          setError(body?.error || 'Запрос не найден')
          return
        }
        setPending(body.pending)
      } catch (e) {
        setError(e.message || 'Ошибка загрузки')
      }
    })()
  }, [token, loading, user])

  async function handleAction(action) {
    if (!supabase || !token) return
    setBusy(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Войдите в систему как админ или менеджер, чтобы подтвердить вход.')
        setBusy(false)
        return
      }
      const res = await fetch('/api/auth/approve-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token, action }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Ошибка')
      setDone(action)
    } catch (e) {
      setError(e.message || 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
          <h1 className="text-lg font-semibold text-white">Подтверждение входа</h1>
          <p className="mt-3 text-sm text-slate-400">
            Для подтверждения нужно войти как админ или менеджер.
          </p>
          <button
            type="button"
            onClick={() => router.push(`/login?redirect=${encodeURIComponent(router.asPath)}`)}
            className="mt-4 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Войти
          </button>
        </div>
      </div>
    )
  }

  if (profile?.role !== 'admin' && profile?.role !== 'manager') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="max-w-md rounded-2xl border border-rose-900 bg-slate-900 p-6 text-center">
          <h1 className="text-lg font-semibold text-rose-300">Доступ запрещён</h1>
          <p className="mt-3 text-sm text-slate-400">
            Подтверждать вход могут только админ или менеджер.
          </p>
        </div>
      </div>
    )
  }

  if (done === 'approve') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="max-w-md rounded-2xl border border-green-800 bg-slate-900 p-6 text-center">
          <div className="text-4xl">✅</div>
          <h1 className="mt-3 text-lg font-semibold text-green-300">Вход разрешён</h1>
          <p className="mt-2 text-sm text-slate-400">
            Риелтор сейчас автоматически войдёт в систему.
          </p>
        </div>
      </div>
    )
  }

  if (done === 'reject') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="max-w-md rounded-2xl border border-rose-800 bg-slate-900 p-6 text-center">
          <div className="text-4xl">⛔</div>
          <h1 className="mt-3 text-lg font-semibold text-rose-300">Вход отклонён</h1>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-lg font-semibold text-white">Подтверждение входа</h1>
        {error && (
          <p className="mt-3 rounded bg-rose-950/50 px-3 py-2 text-sm text-rose-200">{error}</p>
        )}
        {!pending ? (
          <p className="mt-4 text-sm text-slate-400">Загрузка...</p>
        ) : pending.status !== 'pending' ? (
          <p className="mt-4 text-sm text-slate-400">
            Этот запрос уже обработан (статус: {pending.status}).
          </p>
        ) : new Date(pending.expires_at) < new Date() ? (
          <p className="mt-4 text-sm text-slate-400">Срок действия запроса истёк.</p>
        ) : (
          <>
            <div className="mt-4 space-y-2 rounded-xl border border-slate-700 bg-slate-950/50 p-4 text-sm">
              <div>
                <span className="text-slate-400">Риелтор: </span>
                <span className="font-semibold text-white">
                  {pending.realtor?.name || pending.realtor?.email || '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Устройство: </span>
                <span className="text-slate-200">{pending.device_label || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400">Время: </span>
                <span className="text-slate-200">
                  {new Date(pending.created_at).toLocaleString('ru-RU')}
                </span>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => handleAction('approve')}
                disabled={busy}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 font-semibold text-white hover:bg-green-500 disabled:opacity-50"
              >
                ✓ Разрешить
              </button>
              <button
                type="button"
                onClick={() => handleAction('reject')}
                disabled={busy}
                className="flex-1 rounded-lg bg-rose-700 px-4 py-2.5 font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
              >
                ✕ Отклонить
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
