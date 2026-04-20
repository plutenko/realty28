import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/authContext'

export default function AdminSecurityPage() {
  const { user, profile } = useAuth()
  const [devices, setDevices] = useState([])
  const [realtors, setRealtors] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [tgLink, setTgLink] = useState(null)
  const [myTgChatId, setMyTgChatId] = useState(null)
  const [diag, setDiag] = useState(null)
  const [diagBusy, setDiagBusy] = useState(false)

  async function load() {
    if (!supabase || !user) return
    // Загрузить список риелторов
    const { data: rs } = await supabase
      .from('profiles')
      .select('id, email, name, role, telegram_chat_id')
      .order('name')
    setRealtors(rs ?? [])

    const me = (rs ?? []).find((r) => r.id === user.id)
    setMyTgChatId(me?.telegram_chat_id || null)

    // Загрузить устройства через серверный endpoint (service_role в обход RLS)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const res = await fetch('/api/auth/devices', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = await res.json()
        if (res.ok) setDevices(data.devices ?? [])
      }
    } catch {}
  }

  useEffect(() => {
    load()
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
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Нет сессии')
      const res = await fetch(`/api/auth/devices?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Ошибка')
      load()
    } catch (e) {
      setMsg(e.message)
    }
  }

  async function handleRunDiag() {
    setDiagBusy(true)
    setDiag(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Нет сессии')
      const res = await fetch('/api/auth/telegram-diag', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      setDiag(data)
    } catch (e) {
      setDiag({ error: e.message })
    } finally {
      setDiagBusy(false)
    }
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

  const realtorById = new Map(realtors.map((r) => [r.id, r]))

  return (
    <AdminLayout title="Безопасность и устройства">
      {msg && (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-200">{msg}</p>
      )}

      {/* Telegram */}
      <section className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold">Telegram для уведомлений</h2>
        <p className="mt-2 text-sm text-slate-400">
          Привяжите ваш Telegram, чтобы получать запросы на подтверждение входа риелторов с новых
          устройств.
        </p>

        {myTgChatId ? (
          <div className="mt-4 flex items-center gap-3">
            <div className="rounded-lg bg-green-900/30 px-3 py-2 text-sm text-green-200">
              ✓ Telegram привязан (chat_id: {myTgChatId})
            </div>
            <button
              type="button"
              onClick={handleUnlinkTelegram}
              className="text-sm text-rose-400 hover:underline"
            >
              Отвязать
            </button>
            <button
              type="button"
              onClick={handleRunDiag}
              disabled={diagBusy}
              className="ml-auto rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              {diagBusy ? 'Проверка…' : 'Диагностика'}
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
              <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                {tgLink.link ? (
                  <div>
                    <p className="text-sm text-slate-300">
                      Откройте ссылку в Telegram и нажмите «Start»:
                    </p>
                    <a
                      href={tgLink.link}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block break-all text-blue-400 hover:underline"
                    >
                      {tgLink.link}
                    </a>
                    <p className="mt-3 text-xs text-slate-500">
                      После подтверждения бота обновите страницу.
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-amber-300">
                      Переменная TELEGRAM_BOT_USERNAME не задана. Используйте команду вручную:
                    </p>
                    <code className="mt-2 block rounded bg-slate-900 px-3 py-2 text-sm text-slate-200">
                      /start {tgLink.code}
                    </code>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {diag && (
          <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm">
            <h3 className="mb-3 font-semibold text-white">Диагностика</h3>
            {diag.error ? (
              <p className="text-rose-300">{diag.error}</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">Переменные окружения</div>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs">
                    <li>
                      TELEGRAM_BOT_TOKEN: {diag.env?.TELEGRAM_BOT_TOKEN
                        ? <span className="text-green-300">задан</span>
                        : <span className="text-rose-300">НЕ ЗАДАН</span>}
                    </li>
                    <li>
                      TELEGRAM_BOT_USERNAME: <span className={diag.env?.TELEGRAM_BOT_USERNAME ? 'text-green-300' : 'text-amber-300'}>
                        {diag.env?.TELEGRAM_BOT_USERNAME || 'не задан'}
                      </span>
                    </li>
                    <li>
                      NEXT_PUBLIC_APP_URL: <span className={diag.env?.NEXT_PUBLIC_APP_URL ? 'text-green-300' : 'text-amber-300'}>
                        {diag.env?.NEXT_PUBLIC_APP_URL || 'не задан'}
                      </span>
                    </li>
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">Бот (getMe)</div>
                  {diag.bot ? (
                    <p className="mt-1 text-xs text-green-300">
                      @{diag.bot.username} ({diag.bot.name}, id {diag.bot.id})
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-rose-300">{diag.botError || 'нет ответа'}</p>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">Ваш профиль</div>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs">
                    <li>role: {diag.me?.role}</li>
                    <li>
                      telegram_chat_id: {diag.me?.telegram_chat_id
                        ? <span className="text-green-300">{diag.me.telegram_chat_id}</span>
                        : <span className="text-rose-300">НЕ ПРИВЯЗАН</span>}
                    </li>
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">
                    Получатели уведомлений ({diag.recipients?.with_chat_id?.length || 0} из {diag.recipients?.total || 0})
                  </div>
                  {diag.recipients?.with_chat_id?.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-xs text-green-300">
                      {diag.recipients.with_chat_id.map((r, i) => (
                        <li key={i}>✓ {r.name || r.email} ({r.role})</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-rose-300">
                      Нет ни одного админа/менеджера с привязанным Telegram — уведомления некому отправлять.
                    </p>
                  )}
                  {diag.recipients?.without_chat_id?.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                      {diag.recipients.without_chat_id.map((r, i) => (
                        <li key={i}>✗ {r.name || r.email} ({r.role}) — без Telegram</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">
                    user_devices в БД ({diag.devices?.length || 0})
                  </div>
                  {diag.devices?.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 font-mono text-xs">
                      {diag.devices.map((d, i) => (
                        <li key={i} className="text-slate-300">
                          • {d.user} · {d.label || '—'} · last {new Date(d.last_used_at).toLocaleString('ru-RU')}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Нет записей</p>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">
                    Последние pending_logins ({diag.recentPending?.length || 0})
                  </div>
                  {diag.recentPending?.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 font-mono text-xs">
                      {diag.recentPending.map((p, i) => (
                        <li key={i} className={
                          p.status === 'approved' ? 'text-green-300'
                          : p.status === 'pending' ? 'text-amber-300'
                          : 'text-slate-500'
                        }>
                          • [{p.status}] {p.user} · {p.device_label || '—'} · {new Date(p.created_at).toLocaleString('ru-RU')}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Нет записей</p>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-400">Тестовая отправка вам</div>
                  {diag.testSend == null ? (
                    <p className="mt-1 text-xs text-slate-500">Не выполнялась (у вас нет chat_id)</p>
                  ) : diag.testSend.ok ? (
                    <p className="mt-1 text-xs text-green-300">✓ Сообщение отправлено — проверьте Telegram</p>
                  ) : (
                    <p className="mt-1 text-xs text-rose-300">✗ Ошибка: {diag.testSend.error}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Устройства риелторов */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-semibold">Зарегистрированные устройства</h2>
        <p className="mt-2 text-sm text-slate-400">
          Устройства с которых разрешён вход риелторам. Удалите, чтобы потребовать повторное
          подтверждение.
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80">
              <tr>
                <th className="p-3">Пользователь</th>
                <th className="p-3">Устройство</th>
                <th className="p-3">Добавлено</th>
                <th className="p-3">Последний вход</th>
                <th className="p-3">Approve</th>
                <th className="w-28 p-3"></th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-slate-500">
                    Устройств пока нет
                  </td>
                </tr>
              ) : (
                devices.map((d) => {
                  const r = realtorById.get(d.user_id)
                  const name = d.user_name || r?.name || d.user_email || r?.email || '—'
                  const role = d.user_role || r?.role || '—'
                  return (
                    <tr key={d.id} className="border-b border-slate-800/80">
                      <td className="p-3">
                        <div className="font-medium">{name}</div>
                        <div className="text-xs text-slate-500">{role}</div>
                      </td>
                      <td className="p-3 text-slate-300">{d.label || '—'}</td>
                      <td className="p-3 text-xs text-slate-500">
                        {new Date(d.created_at).toLocaleString('ru-RU')}
                      </td>
                      <td className="p-3 text-xs text-slate-500">
                        {new Date(d.last_used_at).toLocaleString('ru-RU')}
                      </td>
                      <td className="p-3 text-xs text-slate-500">
                        {d.last_approved_at
                          ? new Date(d.last_approved_at).toLocaleString('ru-RU')
                          : '—'}
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => handleDeleteDevice(d.id)}
                          className="text-rose-400 hover:underline"
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
    </AdminLayout>
  )
}
