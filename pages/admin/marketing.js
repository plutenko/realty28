import { useEffect, useState, useCallback } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import PeriodPicker, { presetRange } from '../../components/admin/PeriodPicker'
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

const STATUS_LABELS = {
  new: { t: 'Новый', cls: 'bg-blue-500/20 text-blue-300' },
  add_to_base: { t: 'В базу', cls: 'bg-purple-500/20 text-purple-300' },
  in_work: { t: 'В работе', cls: 'bg-amber-500/20 text-amber-300' },
  deal_done: { t: 'Сделка', cls: 'bg-green-500/20 text-green-300' },
  not_lead: { t: 'Не лид', cls: 'bg-slate-500/20 text-slate-300' },
  failed: { t: 'Срыв', cls: 'bg-red-500/20 text-red-300' },
}

const fmtRub = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('ru-RU')} ₽`)
const fmtNum = (n) => (n == null || n === 0 ? '—' : n.toLocaleString('ru-RU'))
const fmtDate = (s) => {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return s }
}
const fmtDateOnly = (s) => {
  if (!s) return ''
  try {
    return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch { return s }
}

export default function AdminMarketingPage() {
  const { profile } = useAuth()
  const [periodRange, setPeriodRange] = useState(() => presetRange('last_30d'))
  const [data, setData] = useState(null)
  const [bySource, setBySource] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncState, setSyncState] = useState('idle')
  const [syncMsg, setSyncMsg] = useState('')
  const [expandedChannels, setExpandedChannels] = useState(new Set())
  const [leadsModal, setLeadsModal] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Нет сессии')
      const params = new URLSearchParams({ date_from: periodRange.from, date_to: periodRange.to })
      const [resSummary, resBySource] = await Promise.all([
        fetch(`/api/admin/marketing/summary?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch(`/api/admin/marketing/by-source?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ])
      const body = await resSummary.json()
      if (!resSummary.ok) throw new Error(body?.error || `HTTP ${resSummary.status}`)
      setData(body)
      const bs = await resBySource.json()
      if (resBySource.ok) setBySource(bs?.sources ?? [])
    } catch (e) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [periodRange])

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
        setSyncMsg(
          `Синхронизировано: кампаний ${body.campaigns_upserted ?? '?'}, ` +
          `строк расходов ${body.spend_rows_upserted ?? '?'}`,
        )
        load()
      } else {
        setSyncState('err')
        setSyncMsg(body.message || body.error || `HTTP ${res.status}`)
      }
    } catch (e) {
      setSyncState('err')
      setSyncMsg(e?.message || 'Ошибка')
    } finally {
      setTimeout(() => setSyncState('idle'), 6000)
    }
  }

  function toggleChannel(name) {
    const next = new Set(expandedChannels)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setExpandedChannels(next)
  }

  const isAdmin = profile?.role === 'admin'
  const channels = data?.channels ?? []
  const totals = data?.totals ?? {}
  const recentSyncs = data?.recent_syncs ?? []
  const periodLabel = data
    ? `${data.days_count} дн. (${fmtDateOnly(data.since_date)} — ${fmtDateOnly(data.until_date)})`
    : ''

  return (
    <AdminLayout title="Маркетинг — каналы и расходы">
      {/* Период */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PeriodPicker value={periodRange} onChange={setPeriodRange} />
        {periodLabel && (
          <span className="text-xs text-slate-500">{periodLabel}</span>
        )}
        <button
          type="button"
          onClick={load}
          className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
        >
          ↻ Обновить
        </button>
      </div>

      {/* Сводка */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Лидов" value={fmtNum(totals.leads || 0)} />
        <SummaryCard label="Сделок" value={fmtNum(totals.deals || 0)} />
        <SummaryCard label="Расход с НДС" value={fmtRub(totals.spent_rub || 0)} />
        <SummaryCard label="Вал" value={fmtRub(totals.revenue_rub || 0)} />
        <SummaryCard
          label="ROAS"
          value={
            totals.spent_rub > 0
              ? `×${(totals.revenue_rub / totals.spent_rub).toFixed(2)}`
              : '—'
          }
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Таблица каналов с drill-down */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900 text-xs uppercase text-slate-400">
            <tr>
              <th className="w-8 px-2 py-3"></th>
              <th className="px-4 py-3 text-left">Канал / Кампания</th>
              <th className="px-4 py-3 text-right">Показы</th>
              <th className="px-4 py-3 text-right">Клики</th>
              <th className="px-4 py-3 text-right">CTR</th>
              <th className="px-4 py-3 text-right" title="Расход с НДС, тянем через Я.Директ Reports API">Расход с НДС</th>
              <th className="px-4 py-3 text-right">Лидов</th>
              <th className="px-4 py-3 text-right">Сделок</th>
              <th className="px-4 py-3 text-right" title="Вал — суммарная комиссия риелторов с закрытых сделок">Вал</th>
              <th className="px-4 py-3 text-right" title="ROAS = Вал / Расход. Окупаемость рекламы.">ROAS</th>
              <th className="px-4 py-3 text-right">CPL</th>
              <th className="px-4 py-3 text-right">CPD</th>
              <th className="px-4 py-3 text-right">Конв.</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-slate-500">Загрузка…</td></tr>
            ) : channels.length === 0 ? (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-slate-500">Нет данных за период</td></tr>
            ) : channels.map((c) => {
              const isExpanded = expandedChannels.has(c.channel)
              const hasCampaigns = (c.campaigns?.length ?? 0) > 0
              return (
                <>
                  <tr key={c.channel} className={`text-slate-200 ${hasCampaigns ? 'cursor-pointer hover:bg-slate-900/80' : ''}`} onClick={() => hasCampaigns && toggleChannel(c.channel)}>
                    <td className="px-2 py-3 text-center text-slate-500">
                      {hasCampaigns ? (isExpanded ? '▾' : '▸') : ''}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {CHANNEL_LABELS[c.channel] || c.channel}
                    </td>
                    <td className="px-4 py-3 text-right">{fmtNum(c.impressions)}</td>
                    <td className="px-4 py-3 text-right">{fmtNum(c.clicks)}</td>
                    <td className="px-4 py-3 text-right">{c.ctr_pct == null ? '—' : `${c.ctr_pct}%`}</td>
                    <td className="px-4 py-3 text-right">{c.spent_rub ? fmtRub(c.spent_rub) : '—'}</td>
                    <td className="px-4 py-3 text-right">{fmtNum(c.leads)}</td>
                    <td className="px-4 py-3 text-right">{fmtNum(c.deals)}</td>
                    <td className="px-4 py-3 text-right">{c.revenue_rub ? fmtRub(c.revenue_rub) : '—'}</td>
                    <td className={`px-4 py-3 text-right ${c.roas == null ? '' : c.roas >= 1 ? 'text-green-400' : 'text-amber-400'}`}>
                      {c.roas == null ? '—' : `×${c.roas}`}
                    </td>
                    <td className="px-4 py-3 text-right">{fmtRub(c.cpl_rub)}</td>
                    <td className="px-4 py-3 text-right">{fmtRub(c.cpd_rub)}</td>
                    <td className="px-4 py-3 text-right">{c.conv_pct ? `${c.conv_pct}%` : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {c.leads > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setLeadsModal({
                              channel: c.channel,
                              campaign_ext_id: null,
                              campaign_name: null,
                            })
                          }}
                          className="rounded bg-slate-800 px-2 py-1 text-xs text-blue-300 hover:bg-slate-700"
                        >
                          Лиды
                        </button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && hasCampaigns && c.campaigns.map((cp) => (
                    <tr key={`${c.channel}-${cp.campaign_id || 'unattr'}-${cp.ext_id || 'none'}`} className="bg-slate-950/50 text-slate-300">
                      <td className="px-2 py-2"></td>
                      <td className="px-4 py-2 pl-10 text-xs">
                        <div className="flex items-center gap-2">
                          <CampaignStatusBadge status={cp.status} />
                          <span className="truncate">{cp.name}</span>
                        </div>
                        {cp.ext_id && <div className="text-[10px] text-slate-600">id {cp.ext_id}</div>}
                      </td>
                      <td className="px-4 py-2 text-right text-xs">{fmtNum(cp.impressions)}</td>
                      <td className="px-4 py-2 text-right text-xs">{fmtNum(cp.clicks)}</td>
                      <td className="px-4 py-2 text-right text-xs">{cp.ctr_pct == null ? '—' : `${cp.ctr_pct}%`}</td>
                      <td className="px-4 py-2 text-right text-xs">{cp.spent_rub ? fmtRub(cp.spent_rub) : '—'}</td>
                      <td className="px-4 py-2 text-right text-xs">{fmtNum(cp.leads)}</td>
                      <td className="px-4 py-2 text-right text-xs">{fmtNum(cp.deals)}</td>
                      <td className="px-4 py-2 text-right text-xs">{cp.revenue_rub ? fmtRub(cp.revenue_rub) : '—'}</td>
                      <td className={`px-4 py-2 text-right text-xs ${cp.roas == null ? '' : cp.roas >= 1 ? 'text-green-400' : 'text-amber-400'}`}>
                        {cp.roas == null ? '—' : `×${cp.roas}`}
                      </td>
                      <td className="px-4 py-2 text-right text-xs">{fmtRub(cp.cpl_rub)}</td>
                      <td className="px-4 py-2 text-right text-xs">{fmtRub(cp.cpd_rub)}</td>
                      <td className="px-4 py-2 text-right text-xs">{cp.conv_pct ? `${cp.conv_pct}%` : '—'}</td>
                      <td className="px-4 py-2 text-right">
                        {cp.leads > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setLeadsModal({
                                channel: c.channel,
                                campaign_ext_id: cp.status === 'unattributed' ? 'unattributed' : cp.ext_id,
                                campaign_name: cp.name,
                              })
                            }}
                            className="rounded bg-slate-800 px-2 py-1 text-[10px] text-blue-300 hover:bg-slate-700"
                          >
                            Лиды
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* По источникам приёма (Marquiz / Тильда / Ручной ввод) */}
      {bySource && bySource.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-slate-200">По источникам приёма заявок</div>
            <div className="mt-0.5 text-xs text-slate-500">
              Откуда пришла заявка — конкретный квиз/форма/ручной ввод. Управление в{' '}
              <a href="/admin/lead-sources" className="text-blue-400 hover:underline">CRM-источниках</a>.
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">Источник</th>
                  <th className="px-4 py-2 text-left">Тип</th>
                  <th className="px-4 py-2 text-right">Лидов</th>
                  <th className="px-4 py-2 text-right">Взято</th>
                  <th className="px-4 py-2 text-right">Сделок</th>
                  <th className="px-4 py-2 text-right">Срыв</th>
                  <th className="px-4 py-2 text-right">% взятия</th>
                  <th className="px-4 py-2 text-right">% сделок</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {bySource.map((s) => (
                  <tr key={s.source_id || 'unknown'}>
                    <td className="px-4 py-2 font-medium">{s.source_name}</td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {s.source_kind === 'marquiz' ? 'Марквиз' :
                       s.source_kind === 'tilda' ? 'Тильда' :
                       s.source_kind === 'manual' ? 'Ручной ввод' : s.source_kind}
                    </td>
                    <td className="px-4 py-2 text-right">{fmtNum(s.leads)}</td>
                    <td className="px-4 py-2 text-right">{fmtNum(s.taken)}</td>
                    <td className="px-4 py-2 text-right">{fmtNum(s.deals)}</td>
                    <td className="px-4 py-2 text-right">{fmtNum(s.lost)}</td>
                    <td className="px-4 py-2 text-right">{s.take_rate_pct ? `${s.take_rate_pct}%` : '—'}</td>
                    <td className="px-4 py-2 text-right">{s.conv_pct ? `${s.conv_pct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sync controls */}
      {isAdmin && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-200">Синхронизация расходов</div>
              <div className="mt-1 text-xs text-slate-500">
                Тянет расходы и метрики кликов из API канала. Cron ежедневно в 12:00 Yakutsk —
                этой кнопкой можно вручную.
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
                    <span className="font-mono text-slate-500">{fmtDate(s.started_at)}</span>
                    <span>{CHANNEL_LABELS[s.channel] || s.channel}</span>
                    <span className={
                      s.status === 'success' ? 'text-green-400'
                      : s.status === 'partial' ? 'text-amber-400'
                      : s.status === 'running' ? 'text-blue-400'
                      : 'text-red-400'
                    }>
                      {s.status || 'running'}
                    </span>
                    {s.rows_upserted ? <span>{s.rows_upserted} строк</span> : null}
                    {s.error && <span className="truncate text-red-400">— {s.error}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {leadsModal && (
        <LeadsModal
          channel={leadsModal.channel}
          campaignExtId={leadsModal.campaign_ext_id}
          campaignName={leadsModal.campaign_name}
          dateFrom={periodRange.from}
          dateTo={periodRange.to}
          onClose={() => setLeadsModal(null)}
        />
      )}
    </AdminLayout>
  )
}

function CampaignStatusBadge({ status }) {
  const cfg = {
    active: { t: '●', cls: 'text-green-400' },
    paused: { t: '●', cls: 'text-amber-400' },
    archived: { t: '●', cls: 'text-slate-500' },
    unattributed: { t: '◌', cls: 'text-slate-600' },
    unknown: { t: '●', cls: 'text-slate-500' },
  }[status] || { t: '●', cls: 'text-slate-500' }
  return <span className={cfg.cls} title={status}>{cfg.t}</span>
}

function LeadsModal({ channel, campaignExtId, campaignName, dateFrom, dateTo, onClose }) {
  const [leads, setLeads] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error('Нет сессии')
        const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, channel })
        if (campaignExtId) params.set('campaign_ext_id', campaignExtId)
        const res = await fetch(`/api/admin/marketing/leads?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
        setLeads(body.leads ?? [])
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Ошибка')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [channel, campaignExtId, dateFrom, dateTo])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">
              Лиды — {CHANNEL_LABELS[channel] || channel}
            </h3>
            {campaignName && <div className="mt-1 text-sm text-slate-400">Кампания: {campaignName}</div>}
            {!campaignName && <div className="mt-1 text-sm text-slate-400">Все кампании канала за период</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg bg-slate-800 px-3 py-1 text-sm text-slate-300 hover:bg-slate-700">
            Закрыть
          </button>
        </div>
        <div className="max-h-[calc(85vh-100px)] overflow-auto">
          {loading ? (
            <div className="px-6 py-8 text-center text-slate-500">Загрузка…</div>
          ) : error ? (
            <div className="px-6 py-8 text-center text-red-400">{error}</div>
          ) : leads.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-500">Лидов нет</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-900 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Дата</th>
                  <th className="px-4 py-3 text-left">Имя</th>
                  <th className="px-4 py-3 text-left">Телефон</th>
                  <th className="px-4 py-3 text-left">Статус CRM</th>
                  <th className="px-4 py-3 text-left">Риелтор</th>
                  <th className="px-4 py-3 text-left">Источник</th>
                  <th className="px-4 py-3 text-left">Кампания</th>
                  <th className="px-4 py-3 text-right">Вал</th>
                  <th className="px-4 py-3 text-left">yclid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {leads.map((l) => {
                  const st = STATUS_LABELS[l.status] || { t: l.status, cls: 'bg-slate-700/50 text-slate-300' }
                  return (
                    <tr key={l.id}>
                      <td className="px-4 py-2 text-xs text-slate-400 whitespace-nowrap">{fmtDate(l.created_at)}</td>
                      <td className="px-4 py-2">{l.name}</td>
                      <td className="px-4 py-2 font-mono text-xs">{l.phone}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs ${st.cls}`}>{st.t}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-400">{l.assigned_user || '—'}</td>
                      <td className="px-4 py-2 text-xs">{l.source_name || '—'}</td>
                      <td className="px-4 py-2 text-xs">
                        {l.campaign_name || (l.utm_campaign ? <span className="text-slate-500">id {l.utm_campaign}</span> : '—')}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-violet-300">
                        {l.deal_revenue_rub ? fmtRub(l.deal_revenue_rub) : '—'}
                      </td>
                      <td className="px-4 py-2 font-mono text-[10px] text-slate-500" title={l.yclid || ''}>
                        {l.yclid ? l.yclid.slice(0, 12) + '…' : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
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
