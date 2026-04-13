import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/authContext'
import CatalogTabs from '../components/CatalogTabs'

export default function SecurityPage() {
  const router = useRouter()
  const { user, profile, loading } = useAuth()
  const [devices, setDevices] = useState([])
  const [realtors, setRealtors] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [tgLink, setTgLink] = useState(null)
  const [myTgChatId, setMyTgChatId] = useState(null)

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/login')
      return
    }
    if (profile?.role !== 'admin' && profile?.role !== 'manager') {
      router.replace('/apartments')
    }
  }, [loading, user, profile, router])

  async function load() {
    if (!supabase || !user) return
    const { data: rs } = await supabase
      .from('profiles')
      .select('id, email, name, role, telegram_chat_id')
      .order('name')
    setRealtors(rs ?? [])

    const me = (rs ?? []).find((r) => r.id === user.id)
    setMyTgChatId(me?.telegram_chat_id || null)

    const { data: devs } = await supabase
      .from('user_devices')
      .select('id, user_id, label, created_at, last_used_at')
      .order('last_used_at', { ascending: false })
    setDevices(devs ?? [])
  }

  useEffect(() => {
    if (user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function handleGenerateTelegramLink() {
    if (!supabase) return
    setBusy(true)
    setMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Нет сессии')
      const res = await fetch('/api/auth/generate-telegram-link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Ошибка')
      setTgLink(data)
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteDevice(id) {
    if (!confirm('Удалить устройство? Пользователю придётся снова подтвердить вход.')) return
    const { error } = await supabase.from('user_devices').delete().eq('id', id)
    if (error) setMsg(error.message)
    else load()
  }

  async function handleUnlinkTelegram() {
    if (!confirm('Отвязать Telegram?')) return
    const { error } = await supabase
      .from('profiles')
      .update({ telegram_chat_id: null })
      .eq('id', user.id)
    if (error) setMsg(error.message)
    else {
      setMyTgChatId(null)
      setTgLink(null)
      load()
    }
  }

  if (loading || !user) return null
  if (profile?.role !== 'admin' && profile?.role !== 'manager') return null

  const realtorById = new Map(realtors.map((r) => [r.id, r]))

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <CatalogTabs />
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-xl font-bold text-gray-900">Безопасность и устройства</h1>

        {msg && (
          <p className="mb-4 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{msg}</p>
        )}

        {/* Telegram */}
        <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">Telegram для уведомлений</h2>
          <p className="mt-2 text-sm text-gray-600">
            Привяжите ваш Telegram, чтобы получать запросы на подтверждение входа риелторов с новых
            устройств.
          </p>

          {myTgChatId ? (
            <div className="mt-4 flex items-center gap-3">
              <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                ✓ Telegram привязан (chat_id: {myTgChatId})
              </div>
              <button
                type="button"
                onClick={handleUnlinkTelegram}
                className="text-sm text-rose-600 hover:underline"
              >
                Отвязать
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <button
                type="button"
                onClick={handleGenerateTelegramLink}
                disabled={busy}
                className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Получить ссылку для привязки
              </button>
              {tgLink && (
                <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  {tgLink.link ? (
                    <div>
                      <p className="text-sm text-gray-700">
                        Откройте ссылку в Telegram и нажмите «Start»:
                      </p>
                      <a
                        href={tgLink.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block break-all text-blue-600 hover:underline"
                      >
                        {tgLink.link}
                      </a>
                      <p className="mt-3 text-xs text-gray-500">
                        После подтверждения бота обновите страницу.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-amber-700">
                        Переменная TELEGRAM_BOT_USERNAME не задана. Используйте команду вручную:
                      </p>
                      <code className="mt-2 block rounded bg-white px-3 py-2 text-sm text-gray-900">
                        /start {tgLink.code}
                      </code>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Устройства риелторов */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">Зарегистрированные устройства</h2>
          <p className="mt-2 text-sm text-gray-600">
            Устройства с которых разрешён вход риелторам. Удалите, чтобы потребовать повторное
            подтверждение.
          </p>

          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
                <tr>
                  <th className="p-3">Пользователь</th>
                  <th className="p-3">Устройство</th>
                  <th className="p-3">Добавлено</th>
                  <th className="p-3">Последний вход</th>
                  <th className="w-28 p-3"></th>
                </tr>
              </thead>
              <tbody>
                {devices.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-gray-400">
                      Устройств пока нет
                    </td>
                  </tr>
                ) : (
                  devices.map((d) => {
                    const r = realtorById.get(d.user_id)
                    return (
                      <tr key={d.id} className="border-b border-gray-100">
                        <td className="p-3">
                          <div className="font-medium text-gray-900">
                            {r?.name || r?.email || '—'}
                          </div>
                          <div className="text-xs text-gray-500">{r?.role || '—'}</div>
                        </td>
                        <td className="p-3 text-gray-700">{d.label || '—'}</td>
                        <td className="p-3 text-xs text-gray-500">
                          {new Date(d.created_at).toLocaleString('ru-RU')}
                        </td>
                        <td className="p-3 text-xs text-gray-500">
                          {new Date(d.last_used_at).toLocaleString('ru-RU')}
                        </td>
                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => handleDeleteDevice(d.id)}
                            className="text-rose-600 hover:underline"
                          >
                            Удалить
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
