import { useEffect, useState, useCallback } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { useAuth } from '../../lib/authContext'
import { supabase } from '../../lib/supabaseClient'

const CHANNEL_LABELS = {
  yandex_direct: 'Яндекс.Директ',
  vk_ads: 'VK Ads',
  telegram_ads: 'Telegram Ads',
  google_ads: 'Google Ads',
  avito: 'Avito',
  organic: 'Органика',
  manual: 'Ручной ввод',
  unknown: 'Неизвестно',
}

const PERIOD_LABELS = [
  { v: 'today', t: 'Сегодня' },
  { v: 'week', t: 'Неделя' },
  { v: 'month', t: 'Месяц' },
  { v: 'quarter', t: 'Квартал' },
  { v: 'year', t: 'Год' },
]

const fmtRub = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('ru-RU')} ₽`)
const fmtNum = (n) => (n == null || n === 0 ? '—' : n.toLocaleString('ru-RU'))

export default function AdminMarketingPage() {
  const { profile } = useAuth()
  const [period, setPeriod] = useState('month')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncState, setSyncState] = useState('idle') // idle/running/done/err
  const [syncMsg, setSyncMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Нет сессии')
      const res = await fetch(`/api/admin/marketing/summary?period=${period}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setData(body)
    } catch (e) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  async function handleSync(channel) {
    setSyncState('running')
    setSyncMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Нет сессии')
      const res = await fetch('/api/admin/marketing/sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel }),
      })
      const body = await res.json()
      if (body.ok) {
        setSyncState('done')
        setSyncMsg(`Синхронизировано ${body.rows_upserted ?? '?'} строк`)
        load()
      } else {
        setSyncState('err')
        setSyncMsg(body.message || body.reason || `HTTP ${res.status}`)
      }
    } catch (e) {
      setSyncState('err')
      setSyncMsg(e?.message || 'Ошибка')
    } finally {
      setTimeout(() => setSyncState('idle'), 6000)
    }
  }

  const isAdmin = profile?.role === 'admin'
  const channels = data?.channels ?? []
  const totals = data?.totals ?? {}
  const recentSyncs = data?.recent_syncs ?? []

  return (
    <AdminLayout title="Маркетинг — каналы и расходы">
      {/* Период */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PERIOD_LABELS.map((p) => (
          <button
            key={p.v}
            type="button"
            onClick={() => setPeriod(p.v)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              period === p.v
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {p.t}
          </button>
        ))}
        <button
          type="button"
          onClick={load}
          className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
        >
          ↻ Обновить
        </button>
      </div>

      {/* Сводка */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Лидов" value={fmtNum(totals.leads || 0)} />
        <SummaryCard label="Сделок" value={fmtNum(totals.deals || 0)} />
        <SummaryCard label="Расход" value={fmtRub(totals.spent_rub || 0)} />
        <SummaryCard label="Кликов" value={fmtNum(totals.clicks || 0)} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Таблица каналов */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">Канал</th>
              <th className="px-4 py-3 text-right">Показы</th>
              <th className="px-4 py-3 text-right">Клики</th>
              <th className="px-4 py-3 text-right">CTR</th>
              <th className="px-4 py-3 text-right">Расход</th>
              <th className="px-4 py-3 text-right">Лидов</th>
              <th className="px-4 py-3 text-right">Сделок</th>
              <th className="px-4 py-3 text-right">CPL</th>
              <th className="px-4 py-3 text-right">CPD</th>
              <th className="px-4 py-3 text-right">Конверсия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">Загрузка…</td></tr>
            ) : channels.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">Нет данных за период</td></tr>
            ) : channels.map((c) => (
              <tr key={c.channel} className="text-slate-200 hover:bg-slate-900/80">
                <td className="px-4 py-3 font-medium">
                  {CHANNEL_LABELS[c.channel] || c.channel}
                </td>
                <td className="px-4 py-3 text-right">{fmtNum(c.impressions)}</td>
                <td className="px-4 py-3 text-right">{fmtNum(c.clicks)}</td>
                <td className="px-4 py-3 text-right">{c.ctr_pct == null ? '—' : `${c.ctr_pct}%`}</td>
                <td className="px-4 py-3 text-right">{c.spent_rub ? fmtRub(c.spent_rub) : '—'}</td>
                <td className="px-4 py-3 text-right">{fmtNum(c.leads)}</td>
                <td className="px-4 py-3 text-right">{fmtNum(c.deals)}</td>
                <td className="px-4 py-3 text-right">{fmtRub(c.cpl_rub)}</td>
                <td className="px-4 py-3 text-right">{fmtRub(c.cpd_rub)}</td>
                <td className="px-4 py-3 text-right">{c.conv_pct ? `${c.conv_pct}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sync controls */}
      {isAdmin && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-200">Синхронизация расходов</div>
              <div className="mt-1 text-xs text-slate-500">
                Тянет расходы и метрики кликов из API канала. Cron ежедневно в 06:00 — этой кнопкой можно вручную.
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSync('yandex_direct')}
              disabled={syncState === 'running'}
              className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {syncState === 'running' ? 'Синхронизируем…' : 'Тянуть Я.Директ'}
            </button>
          </div>
          {syncState === 'done' && (
            <div className="mt-3 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-300">
              ✅ {syncMsg}
            </div>
          )}
          {syncState === 'err' && (
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              ⚠ {syncMsg}
            </div>
          )}

          {recentSyncs.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-xs uppercase text-slate-500">Последние запуски</div>
              <ul className="space-y-1 text-xs text-slate-400">
                {recentSyncs.map((s, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="font-mono text-slate-500">{new Date(s.started_at).toLocaleString('ru-RU')}</span>
                    <span>{CHANNEL_LABELS[s.channel] || s.channel}</span>
                    <span className={
                      s.status === 'success' ? 'text-green-400'
                      : s.status === 'partial' ? 'text-amber-400'
                      : 'text-red-400'
                    }>
                      {s.status || 'running'}
                    </span>
                    {s.rows_upserted ? <span>{s.rows_upserted} строк</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  )
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  )
}
