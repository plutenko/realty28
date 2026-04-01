import Link from 'next/link'
import AdminLayout from '../../components/admin/AdminLayout'

const cards = [
  {
    href: '/admin/developers',
    title: 'Застройщики',
    desc: 'Создание и редактирование застройщиков',
  },
  {
    href: '/admin/complexes',
    title: 'ЖК',
    desc: 'ЖК, застройщик, обложка для каталога /buildings',
  },
  {
    href: '/admin/buildings',
    title: 'Дома / корпуса',
    desc: 'Корпуса в составе ЖК',
  },
  {
    href: '/admin/units',
    title: 'Квартиры',
    desc: 'Юниты, цены, статусы',
  },
  {
    href: '/admin/collections',
    title: 'Подборки',
    desc: 'Ссылки для клиентов, просмотры, аналитика',
  },
  {
    href: '/admin/sources',
    title: 'Источники синхронизации',
    desc: 'Google/CSV/API источники шахматок + ручной запуск',
  },
]

export default function AdminHomePage() {
  return (
    <AdminLayout title="Админка новостроек">
      <p className="mb-6 text-slate-400">
        Управление данными через Supabase. Перед работой выполните миграцию{' '}
        <code className="rounded bg-slate-800 px-1">supabase/migrations/001_newbuildings.sql</code>{' '}
        и создайте bucket <code className="rounded bg-slate-800 px-1">images</code> в Storage.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition hover:border-blue-500/50"
          >
            <h2 className="text-lg font-semibold text-white">{c.title}</h2>
            <p className="mt-2 text-sm text-slate-400">{c.desc}</p>
          </Link>
        ))}
      </div>
    </AdminLayout>
  )
}
