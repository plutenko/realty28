import { useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import Link from 'next/link'
import { supabase } from '../../lib/supabaseClient'

const groupedCards = [
  {
    label: 'Каталог',
    desc: 'Что мы продаём',
    items: [
      { href: '/admin/developers', label: 'Застройщики', icon: '🏢', desc: 'Управление застройщиками' },
      { href: '/admin/complexes', label: 'ЖК', icon: '🏘️', desc: 'Жилые комплексы' },
      { href: '/admin/buildings', label: 'Дома', icon: '🏗️', desc: 'Корпуса и литеры' },
      { href: '/admin/units', label: 'Квартиры', icon: '🚪', desc: 'Все объекты, шахматка' },
      { href: '/admin/sources', label: 'Источники импорта', icon: '🔗', desc: 'Google Sheets, Profitbase' },
    ],
  },
  {
    label: 'Продажи и маркетинг',
    desc: 'Лиды, рекламные расходы, подборки',
    items: [
      { href: '/admin/leads', label: 'Лиды', icon: '📥', desc: 'Воронка заявок и распределение' },
      { href: '/admin/lead-sources', label: 'CRM-источники', icon: '🎯', desc: 'Marquiz / Tilda webhooks' },
      { href: '/admin/marketing', label: 'Маркетинг', icon: '📈', desc: 'Расходы по каналам, CPL, ROAS' },
      { href: '/admin/collections', label: 'Подборки', icon: '📋', desc: 'Подборки для клиентов риелторами' },
    ],
  },
  {
    label: 'Команда',
    desc: 'Сотрудники, отчёты, безопасность',
    items: [
      { href: '/admin/users', label: 'Пользователи', icon: '👥', desc: 'Риелторы и менеджеры' },
      { href: '/admin/reports', label: 'Отчёты', icon: '📝', desc: 'Сводка по риелторам, экспорт за период' },
      { href: '/admin/security', label: 'Безопасность', icon: '🔒', desc: 'Устройства и Telegram' },
    ],
  },
]

const PURGE_PATHS = ['/api/units', '/api/complexes', '/api/buildings-summary']

export default function AdminHomePage() {
  const [purgeState, setPurgeState] = useState('idle') // idle | loading | ok | err
  const [purgeMsg, setPurgeMsg] = useState('')

  async function handlePurge() {
    if (purgeState === 'loading') return
    setPurgeState('loading')
    setPurgeMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Сессия истекла, войдите заново')
      const res = await fetch('/api/cf-purge', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paths: PURGE_PATHS }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      // Параллельно дёргаем in-memory invalidate на origin (чтобы Next.js process тоже пере-собрал кеш)
      try {
        await fetch('/api/units?invalidate=1')
      } catch {}
      setPurgeState('ok')
      const wp = Array.isArray(body?.worker_purged) ? body.worker_purged.length : '?'
      setPurgeMsg(`Очищено: Worker (${wp} ключей), origin in-memory`)
      setTimeout(() => setPurgeState('idle'), 4000)
    } catch (e) {
      setPurgeState('err')
      setPurgeMsg(e?.message || 'Ошибка')
      setTimeout(() => setPurgeState('idle'), 5000)
    }
  }

  return (
    <AdminLayout title="Панель управления">
      <div className="space-y-8">
        {groupedCards.map((group) => (
          <section key={group.label}>
            <div className="mb-3">
              <h2 className="text-base font-semibold text-slate-200">{group.label}</h2>
              <p className="text-xs text-slate-500">{group.desc}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {group.items.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 transition hover:border-slate-600 hover:bg-slate-900"
                >
                  <div className="text-2xl mb-2">{c.icon}</div>
                  <div className="text-sm font-semibold text-slate-200">{c.label}</div>
                  <div className="mt-1 text-xs text-slate-500">{c.desc}</div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-200">Кеш каталога</div>
            <div className="mt-1 text-xs text-slate-500">
              Сбросить edge-кеш (CF Worker) и серверный кеш квартир/ЖК. После
              нажатия следующий пользователь увидит свежие данные. Используется,
              когда правки делались в обход админки (импорт, прямой SQL и т.п.).
            </div>
          </div>
          <button
            type="button"
            onClick={handlePurge}
            disabled={purgeState === 'loading'}
            className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {purgeState === 'loading' ? 'Чистим…' : 'Сбросить кеш'}
          </button>
        </div>
        {purgeState === 'ok' && (
          <div className="mt-3 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2 text-xs text-green-300">
            ✅ {purgeMsg}
          </div>
        )}
        {purgeState === 'err' && (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-300">
            ⚠ {purgeMsg}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
