import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/authContext'
import { computeAccessGroups, fmtDate } from '../../lib/securityAccess'
import CatalogTabs from '../../components/CatalogTabs'
import TeamReportsView from '../../components/reports/TeamReportsView'
import TelegramBindingsView from '../../components/reports/TelegramBindingsView'
import LeadsDashboard from '../../components/leads/LeadsDashboard'

async function apiFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session?.access_token}` } })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка')
  return json
}

const TABS = [
  { id: 'reports', label: '📝 Отчёты команды' },
  { id: 'crm', label: '🎯 CRM' },
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
        {tab === 'crm' && <CrmTab />}
        {tab === 'bindings' && <TelegramBindingsView />}
        {tab === 'login_logs' && (
          <LoginLogsView logs={logs} loading={logsFetching} />
        )}
        {tab === 'security' && <SecurityTab />}
      </div>
    </div>
  )
}

function CrmTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Лиды</h2>
          <p className="mt-1 text-sm text-gray-600">
            Все заявки от клиентов. Можешь переназначить, открыть заново закрытый, посмотреть контакты и историю.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/manager/crm-analytics" className="rounded-xl bg-white border border-gray-200 hover:bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700">
            📊 Аналитика
          </Link>
          <Link href="/manager/crm-users" className="rounded-xl bg-white border border-gray-200 hover:bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700">
            👥 Риелторы CRM
          </Link>
        </div>
      </div>
      <LeadsDashboard theme="light" isAdmin={false} />
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
  const [pendingLogins, setPendingLogins] = useState([])
  const [realtors, setRealtors] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [tgLink, setTgLink] = useState(null)
  const [myTgChatId, setMyTgChatId] = useState(null)

  async function load() {
    if (!supabase || !user) return
    // Свой telegram_chat_id берём напрямую (RLS пускает к собственному профилю)
    const { data: me } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', user.id)
      .maybeSingle()
    setMyTgChatId(me?.telegram_chat_id || null)
    // Все остальные данные — через серверный endpoint (service_role в обход RLS)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const res = await fetch('/api/auth/devices', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = await res.json()
        if (res.ok) {
          setDevices(data.devices ?? [])
          setPendingLogins(data.pendingLogins ?? [])
          setRealtors(data.profiles ?? [])
        }
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

  const access = useMemo(
    () => computeAccessGroups({ realtors, devices, pendingLogins }),
    [realtors, devices, pendingLogins]
  )

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
        <h2 className="text-lg font-semibold text-gray-900">Все риелторы — статус доступа</h2>
        <p className="mt-2 text-sm text-gray-600">
          Все риелторы из базы, разбитые по статусу входа. Удалите устройство, чтобы потребовать
          повторное подтверждение.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <ManagerStatCard color="emerald" title="Активный доступ" count={access.active.length} hint="approve свежий (< 7 дн)" />
          <ManagerStatCard color="amber" title="Approve просрочен" count={access.expired.length} hint="заходил, но > 7 дн" />
          <ManagerStatCard color="rose" title="Пытался войти, не одобрен" count={access.triedNotIn.length} hint="pending без устройства" />
          <ManagerStatCard color="slate" title="Никогда не пытался" count={access.never.length} hint="нет ни одной попытки" />
        </div>

        <div className="mt-5 space-y-5">
          <ManagerAccessTable
            color="emerald"
            title="Активный доступ"
            hint="Заходил, approve действителен (< 7 дней)"
            rows={access.active}
            getKey={(row) => row.device.id}
            columns={[
              { label: 'Риелтор', cell: (row) => row.realtor.name || row.realtor.email },
              { label: 'Устройство', cell: (row) => row.device.label || '—' },
              { label: 'Добавлено', cell: (row) => fmtDate(row.device.created_at), muted: true },
              { label: 'Последний вход', cell: (row) => fmtDate(row.device.last_used_at), muted: true },
              { label: 'Approve', cell: (row) => fmtDate(row.device.last_approved_at), muted: true },
              {
                label: '',
                w: 'w-24',
                cell: (row) => (
                  <button
                    type="button"
                    onClick={() => handleDeleteDevice(row.device.id)}
                    className="text-rose-600 hover:underline"
                  >
                    Удалить
                  </button>
                ),
              },
            ]}
          />
          <ManagerAccessTable
            color="amber"
            title="Approve просрочен / устройство не одобрено"
            hint="Прошло > 7 дней или approve ещё не давался — при следующем входе придёт новый запрос"
            rows={access.expired}
            getKey={(row) => row.device.id}
            columns={[
              { label: 'Риелтор', cell: (row) => row.realtor.name || row.realtor.email },
              { label: 'Устройство', cell: (row) => row.device.label || '—' },
              { label: 'Добавлено', cell: (row) => fmtDate(row.device.created_at), muted: true },
              { label: 'Последний вход', cell: (row) => fmtDate(row.device.last_used_at), muted: true },
              { label: 'Approve', cell: (row) => fmtDate(row.device.last_approved_at), muted: true },
              {
                label: '',
                w: 'w-24',
                cell: (row) => (
                  <button
                    type="button"
                    onClick={() => handleDeleteDevice(row.device.id)}
                    className="text-rose-600 hover:underline"
                  >
                    Удалить
                  </button>
                ),
              },
            ]}
          />
          <ManagerAccessTable
            color="rose"
            title="Пытался войти, не одобрен"
            hint="Был pending, но устройство так и не подтвердили — войти не может"
            rows={access.triedNotIn}
            getKey={(row) => row.realtor.id}
            columns={[
              { label: 'Риелтор', cell: (row) => row.realtor.name || row.realtor.email },
              { label: 'Устройство (попытка)', cell: (row) => row.pending.device_label || '—' },
              { label: 'Последняя попытка', cell: (row) => fmtDate(row.pending.created_at), muted: true },
              { label: 'Статус', cell: (row) => row.pending.status, muted: true },
            ]}
          />
          <ManagerAccessTable
            color="slate"
            title="Никогда не пытался войти"
            hint="Аккаунт создан, но ни одной попытки входа в систему"
            rows={access.never}
            getKey={(row) => row.realtor.id}
            columns={[
              { label: 'Риелтор', cell: (row) => row.realtor.name || row.realtor.email },
              { label: 'Email', cell: (row) => row.realtor.email, muted: true },
              { label: 'Аккаунт создан', cell: (row) => fmtDate(row.realtor.created_at), muted: true },
            ]}
          />
        </div>
      </section>
    </div>
  )
}

const MANAGER_THEME = {
  emerald: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    cardBorder: 'border-emerald-300',
    cardBg: 'bg-emerald-50',
    cardLabel: 'text-emerald-700',
    cardCount: 'text-emerald-700',
    cardHint: 'text-emerald-600/80',
  },
  amber: {
    dot: 'bg-amber-500',
    text: 'text-amber-700',
    border: 'border-amber-200',
    cardBorder: 'border-amber-300',
    cardBg: 'bg-amber-50',
    cardLabel: 'text-amber-700',
    cardCount: 'text-amber-700',
    cardHint: 'text-amber-600/80',
  },
  rose: {
    dot: 'bg-rose-500',
    text: 'text-rose-700',
    border: 'border-rose-200',
    cardBorder: 'border-rose-300',
    cardBg: 'bg-rose-50',
    cardLabel: 'text-rose-700',
    cardCount: 'text-rose-700',
    cardHint: 'text-rose-600/80',
  },
  slate: {
    dot: 'bg-gray-400',
    text: 'text-gray-700',
    border: 'border-gray-200',
    cardBorder: 'border-gray-300',
    cardBg: 'bg-gray-50',
    cardLabel: 'text-gray-600',
    cardCount: 'text-gray-700',
    cardHint: 'text-gray-500',
  },
}

function ManagerStatCard({ color, title, count, hint }) {
  const c = MANAGER_THEME[color] || MANAGER_THEME.slate
  return (
    <div className={`rounded-xl border ${c.cardBorder} ${c.cardBg} p-3`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${c.cardLabel}`}>{title}</div>
      <div className={`mt-1 text-2xl font-semibold ${c.cardCount}`}>{count}</div>
      <div className={c.cardHint}>{hint}</div>
    </div>
  )
}

function ManagerAccessTable({ color, title, hint, rows, columns, getKey }) {
  const c = MANAGER_THEME[color] || MANAGER_THEME.slate
  return (
    <div className={`rounded-xl border ${c.border} bg-white p-4`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${c.dot}`} />
        <h3 className={`text-sm font-semibold ${c.text}`}>{title}</h3>
        <span className="text-xs text-gray-500">· {rows.length}</span>
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">никого</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                {columns.map((col, i) => (
                  <th
                    key={i}
                    className={`p-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 ${col.w || ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={getKey(row)} className="border-b border-gray-100 last:border-b-0">
                  {columns.map((col, i) => (
                    <td
                      key={i}
                      className={`p-2.5 ${col.muted ? 'text-xs text-gray-500' : 'text-gray-800'}`}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
