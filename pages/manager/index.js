import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/authContext'
import CatalogTabs from '../../components/CatalogTabs'
import TeamReportsView from '../../components/reports/TeamReportsView'
import TelegramBindingsView from '../../components/reports/TelegramBindingsView'

async function apiFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session?.access_token}` } })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка')
  return json
}

const TABS = [
  { id: 'reports', label: '📝 Отчёты команды' },
  { id: 'bindings', label: '🔗 Привязки Telegram' },
  { id: 'login_logs', label: '📋 Журнал входов' },
  { id: 'security', label: '🔒 Безопасность' },
]

const tabBtn = (active) =>
  `rounded-xl border px-4 py-2 text-sm font-medium transition ${
    active
      ? 'border-blue-600 bg-blue-600 text-white'
      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
  }`

export default function ManagerPage() {
  const { profile, loading } = useAuth()
  const [tab, setTab] = useState('reports')
  const [logs, setLogs] = useState([])
  const [logsFetched, setLogsFetched] = useState(false)
  const [logsFetching, setLogsFetching] = useState(false)

  useEffect(() => {
    if (tab !== 'login_logs' || logsFetched) return
    setLogsFetching(true)
    apiFetch('/api/manager/login-logs')
      .then(d => { setLogs(d.logs ?? []); setLogsFetched(true) })
      .catch(() => {})
      .finally(() => setLogsFetching(false))
  }, [tab, logsFetched])

  if (loading) return null

  const isAdmin = profile?.role === 'admin'

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <CatalogTabs />

      <div className="px-4 py-4">
        <h1 className="mb-4 text-xl font-bold text-gray-900">
          {isAdmin ? 'Обзор команды' : 'Кабинет руководителя'}
        </h1>

        {/* Вкладки */}
        <div className="mb-5 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={tabBtn(tab === t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Контент вкладки */}
        {tab === 'reports' && <TeamReportsView />}
        {tab === 'bindings' && <TelegramBindingsView />}
        {tab === 'login_logs' && (
          <LoginLogsView logs={logs} loading={logsFetching} />
        )}
        {tab === 'security' && <SecurityTab />}
      </div>
    </div>
  )
}

function LoginLogsView({ logs, loading }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Пользователь</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Устройство</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">IP-адрес</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Дата и время</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Загрузка...</td></tr>
          ) : logs.length === 0 ? (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Нет данных</td></tr>
          ) : logs.map(l => (
            <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="font-medium text-gray-900">{l.userName}</div>
                <div className="text-xs text-gray-400">{l.userEmail}</div>
              </td>
              <td className="px-4 py-3 text-gray-600">
                <div>{l.browser} · {l.os_name}</div>
                {l.device_label && (
                  <div className="text-xs text-gray-400">{l.device_label}</div>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-gray-500">{l.ip_address}</td>
              <td className="px-4 py-3 text-xs text-gray-400">
                {new Date(l.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SecurityTab() {
  const { user } = useAuth()
  const [devices, setDevices] = useState([])
  const [realtors, setRealtors] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [tgLink, setTgLink] = useState(null)
  const [myTgChatId, setMyTgChatId] = useState(null)

  async function load() {
    if (!supabase || !user) return
    const { data: rs } = await supabase
      .from('profiles')
      .select('id, email, name, role, telegram_chat_id')
      .order('name')
    setRealtors(rs ?? [])
    const me = (rs ?? []).find((r) => r.id === user.id)
    setMyTgChatId(me?.telegram_chat_id || null)
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
    if (user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function handleGenerateTelegramLink() {
    setBusy(true); setMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/auth/generate-telegram-link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Ошибка')
      setTgLink(data)
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
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

  async function handleUnlinkTelegram() {
    if (!confirm('Отвязать Telegram?')) return
    const { error } = await supabase
      .from('profiles').update({ telegram_chat_id: null }).eq('id', user.id)
    if (error) setMsg(error.message)
    else { setMyTgChatId(null); setTgLink(null); load() }
  }

  const realtorById = new Map(realtors.map((r) => [r.id, r]))

  return (
    <div className="space-y-6">
      {msg && (
        <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{msg}</p>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Telegram для уведомлений</h2>
        <p className="mt-2 text-sm text-gray-600">
          Привяжите ваш Telegram, чтобы получать запросы на подтверждение входа риелторов с новых устройств.
        </p>
        {myTgChatId ? (
          <div className="mt-4 flex items-center gap-3">
            <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              ✓ Telegram привязан (chat_id: {myTgChatId})
            </div>
            <button type="button" onClick={handleUnlinkTelegram} className="text-sm text-rose-600 hover:underline">
              Отвязать
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <button type="button" onClick={handleGenerateTelegramLink} disabled={busy}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
              Получить ссылку для привязки
            </button>
            {tgLink && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                {tgLink.link ? (
                  <div>
                    <p className="text-sm text-gray-700">Откройте ссылку в Telegram и нажмите «Start»:</p>
                    <a href={tgLink.link} target="_blank" rel="noreferrer"
                      className="mt-2 block break-all text-blue-600 hover:underline">{tgLink.link}</a>
                    <p className="mt-3 text-xs text-gray-500">После подтверждения бота обновите страницу.</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-amber-700">TELEGRAM_BOT_USERNAME не задан. Используйте команду:</p>
                    <code className="mt-2 block rounded bg-white px-3 py-2 text-sm text-gray-900">/start {tgLink.code}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Зарегистрированные устройства</h2>
        <p className="mt-2 text-sm text-gray-600">
          Устройства с которых разрешён вход риелторам. Удалите, чтобы потребовать повторное подтверждение.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
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
                <tr><td colSpan={6} className="p-4 text-center text-gray-400">Устройств пока нет</td></tr>
              ) : devices.map((d) => {
                const r = realtorById.get(d.user_id)
                const name = d.user_name || r?.name || d.user_email || r?.email || '—'
                const role = d.user_role || r?.role || '—'
                return (
                  <tr key={d.id} className="border-b border-gray-100">
                    <td className="p-3">
                      <div className="font-medium text-gray-900">{name}</div>
                      <div className="text-xs text-gray-500">{role}</div>
                    </td>
                    <td className="p-3 text-gray-700">{d.label || '—'}</td>
                    <td className="p-3 text-xs text-gray-500">{new Date(d.created_at).toLocaleString('ru-RU')}</td>
                    <td className="p-3 text-xs text-gray-500">{new Date(d.last_used_at).toLocaleString('ru-RU')}</td>
                    <td className="p-3 text-xs text-gray-500">
                      {d.last_approved_at ? new Date(d.last_approved_at).toLocaleString('ru-RU') : '—'}
                    </td>
                    <td className="p-3">
                      <button type="button" onClick={() => handleDeleteDevice(d.id)}
                        className="text-rose-600 hover:underline">Удалить</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
