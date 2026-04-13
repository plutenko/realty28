import AdminLayout from '../../components/admin/AdminLayout'
import Link from 'next/link'

const cards = [
  { href: '/admin/developers', label: 'Застройщики', icon: '🏢', desc: 'Управление застройщиками' },
  { href: '/admin/buildings', label: 'Дома', icon: '🏗️', desc: 'Корпуса и литеры' },
  { href: '/admin/units', label: 'Квартиры', icon: '🚪', desc: 'Все объекты' },
  { href: '/admin/collections', label: 'Подборки', icon: '📋', desc: 'Подборки для клиентов' },
  { href: '/admin/sources', label: 'Источники', icon: '🔗', desc: 'Google Sheets, Profitbase' },
  { href: '/admin/users', label: 'Пользователи', icon: '👥', desc: 'Риелторы и менеджеры' },
  { href: '/admin/security', label: 'Безопасность', icon: '🔒', desc: 'Устройства и Telegram' },
]

export default function AdminHomePage() {
  return (
    <AdminLayout title="Панель управления">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
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
    </AdminLayout>
  )
}
