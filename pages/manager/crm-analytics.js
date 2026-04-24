import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import CatalogTabs from '../../components/CatalogTabs'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../lib/authContext'

async function apiFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session?.access_token}` } })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Ошибка')
  return json
}

function fmtSec(s) {
  if (s == null) return '—'
  if (s < 60) return `${s} сек`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m} мин ${rem} сек` : `${m} мин`
}

export default function CrmAnalyticsPage() {
  const router = useRouter()
  const { user, profile, loading } = useAuth()
  const [period, setPeriod] = useState('week')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loadingData, setLoadingData] = useState(true)

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace('/login'); return }
    if (profile && !['admin', 'manager'].includes(profile.role)) {
      router.replace('/apartments')
    }
  }, [loading, user, profile, router])

  async function load() {
    setLoadingData(true)
    setErr('')
    try {
      const d = await apiFetch(`/api/manager/crm-analytics?period=${period}`)
      setData(d)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => { if (user) load() }, [period, user])

  if (loading || !user) return <div className="p-6 text-sm text-gray-500">Загрузка…</div>

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <CatalogTabs />
      <div className="px-4 py-4 md:px-6 md:py-6">
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
          <Link href="/manager" className="text-sm text-blue-600 hover:underline">← Назад в кабинет</Link>
          <div className="flex gap-2 flex-wrap">
            {[
              ['today','Сегодня'],
              ['week','Неделя'],
              ['month','Месяц'],
              ['quarter','Квартал'],
              ['year','Год'],
              ['all','Всё время'],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setPeriod(v)}
                className={`px-3 py-1.5 text-sm rounded-lg ${period === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'}`}
              >
                {label}
              </button>
            ))}
            <button
              onClick={async () => {
                try {
                  const { data: { session } } = await supabase.auth.getSession()
                  const resp = await fetch(`/api/manager/crm-leads-export?period=${period}`, {
                    headers: { Authorization: `Bearer ${session?.access_token}` },
                  })
                  if (!resp.ok) throw new Error((await resp.json()).error || 'Ошибка')
                  const blob = await resp.blob()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `leads_${period}_${new Date().toISOString().slice(0,10)}.csv`
                  a.click()
                  URL.revokeObjectURL(url)
                } catch (e) { alert(e.message || e) }
              }}
              className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              📥 Экспорт CSV
            </button>
          </div>
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Аналитика CRM</h1>

        {err && <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700 mb-3">{err}</p>}

        {loadingData || !data ? (
          <p className="text-sm text-gray-500">Загрузка…</p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card title="Всего заявок" value={data.totals.leads} />
              <Card title="Взято в работу" value={data.totals.taken} hint={`${data.totals.take_rate}%`} />
              <Card title="Не взято" value={data.totals.unclaimed} danger={data.totals.unclaimed > 0} />
              <Card title="Среднее время реакции" value={fmtSec(data.totals.avg_reaction_sec)} />
              <Card title="Сделки" value={data.totals.deal_done} hint={`конверсия ${data.totals.close_rate}%`} success />
              <Card title="В работе" value={data.totals.in_work} />
              <Card title="Не лид" value={data.totals.not_lead} />
              <Card title="Срыв" value={data.totals.failed} />
            </div>

            {data.timeseries && data.timeseries.length > 0 && (
              <section className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="font-semibold text-gray-900">Динамика</h2>
                  <div className="flex gap-3 text-xs">
                    <LegendDot color="bg-gray-400" label="Заявок" />
                    <LegendDot color="bg-blue-500" label="Взято" />
                    <LegendDot color="bg-violet-600" label="Сделок" />
                  </div>
                </div>
                <BarChart series={data.timeseries} />
              </section>
            )}

            <section className="rounded-2xl border border-gray-200 bg-white">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900">По источникам</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <th className="text-left px-4 py-2">Источник</th>
                    <th className="text-center px-4 py-2">Заявок</th>
                    <th className="text-center px-4 py-2">Взято</th>
                    <th className="text-center px-4 py-2">Сделок</th>
                    <th className="text-center px-4 py-2">Не лид / Срыв</th>
                    <th className="text-center px-4 py-2">Конверсия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.by_source.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-4 text-center text-gray-400">Данных нет</td></tr>
                  )}
                  {data.by_source.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900">{s.name}</td>
                      <td className="px-4 py-2 text-center text-gray-700">{s.leads}</td>
                      <td className="px-4 py-2 text-center text-gray-700">{s.taken}</td>
                      <td className="px-4 py-2 text-center text-violet-700 font-medium">{s.deal_done}</td>
                      <td className="px-4 py-2 text-center text-gray-500">{s.not_lead} / {s.failed}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`rounded px-2 py-0.5 text-xs ${s.conversion_pct >= 20 ? 'bg-emerald-100 text-emerald-700' : s.conversion_pct >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                          {s.conversion_pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900">По риелторам</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <th className="text-left px-4 py-2">Риелтор</th>
                    <th className="text-center px-4 py-2">Взято</th>
                    <th className="text-center px-4 py-2">В работе</th>
                    <th className="text-center px-4 py-2">Сделок</th>
                    <th className="text-center px-4 py-2">Срыв / Не лид</th>
                    <th className="text-center px-4 py-2">Ср. реакция</th>
                    <th className="text-center px-4 py-2">Конверсия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.by_realtor.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-4 text-center text-gray-400">Данных нет</td></tr>
                  )}
                  {data.by_realtor.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900">{r.name}</td>
                      <td className="px-4 py-2 text-center text-gray-700">{r.taken}</td>
                      <td className="px-4 py-2 text-center text-emerald-700">{r.in_work}</td>
                      <td className="px-4 py-2 text-center text-violet-700 font-medium">{r.deal_done}</td>
                      <td className="px-4 py-2 text-center text-gray-500">{r.failed} / {r.not_lead}</td>
                      <td className="px-4 py-2 text-center text-gray-700">{fmtSec(r.avg_reaction_sec)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`rounded px-2 py-0.5 text-xs ${r.conversion_pct >= 20 ? 'bg-emerald-100 text-emerald-700' : r.conversion_pct >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                          {r.conversion_pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function LegendDot({ color, label }) {
  return (
    <span className="flex items-center gap-1 text-gray-600">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}

function BarChart({ series }) {
  const max = Math.max(1, ...series.map(s => Math.max(s.leads, s.taken, s.deal_done)))
  const n = series.length
  // Ширина группы, отступ между группами
  const groupWidth = 36
  const gap = 6
  const total = n * (groupWidth + gap)
  const h = 180
  const padY = 20
  const innerH = h - padY * 2
  const barW = (groupWidth - 4) / 3

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(total, 600)} height={h + 30} className="block">
        {/* сетка Y */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <line key={i} x1={0} x2={total} y1={padY + innerH - innerH * p} y2={padY + innerH - innerH * p} stroke="#f1f5f9" strokeWidth={1} />
        ))}

        {/* столбцы */}
        {series.map((s, i) => {
          const x = i * (groupWidth + gap)
          const yBase = padY + innerH
          const hLeads = (s.leads / max) * innerH
          const hTaken = (s.taken / max) * innerH
          const hDeals = (s.deal_done / max) * innerH
          return (
            <g key={i}>
              <rect x={x + 2} y={yBase - hLeads} width={barW} height={hLeads} fill="#94a3b8" rx={1}>
                <title>{`${s.label}: ${s.leads} заявок`}</title>
              </rect>
              <rect x={x + 2 + barW + 1} y={yBase - hTaken} width={barW} height={hTaken} fill="#3b82f6" rx={1}>
                <title>{`${s.label}: ${s.taken} взято`}</title>
              </rect>
              <rect x={x + 2 + (barW + 1) * 2} y={yBase - hDeals} width={barW} height={hDeals} fill="#7c3aed" rx={1}>
                <title>{`${s.label}: ${s.deal_done} сделок`}</title>
              </rect>
              <text
                x={x + groupWidth / 2}
                y={h + 14}
                textAnchor="middle"
                fontSize="10"
                fill="#64748b"
                transform={series.length > 14 ? `rotate(-45 ${x + groupWidth / 2} ${h + 14})` : ''}
              >
                {s.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Card({ title, value, hint, success, danger }) {
  const color = success ? 'text-emerald-700' : danger ? 'text-rose-700' : 'text-gray-900'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{title}</div>
      <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  )
}
