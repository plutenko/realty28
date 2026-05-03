import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState } from 'react'
import { useAuth } from '../../lib/authContext'

const groups = [
  {
    label: 'Главное',
    items: [
      { href: '/admin', label: 'Главная', icon: '🏠' },
    ],
  },
  {
    label: 'Каталог',
    items: [
      { href: '/admin/developers', label: 'Застройщики', icon: '🏢' },
      { href: '/admin/complexes', label: 'ЖК', icon: '🏘️' },
      { href: '/admin/buildings', label: 'Дома', icon: '🏗️' },
      { href: '/admin/units', label: 'Квартиры', icon: '🚪' },
      { href: '/admin/sources', label: 'Источники импорта', icon: '🔗' },
    ],
  },
  {
    label: 'Продажи и маркетинг',
    items: [
      { href: '/admin/leads', label: 'Лиды', icon: '📥' },
      { href: '/admin/lead-sources', label: 'CRM-источники', icon: '🎯' },
      { href: '/admin/marketing', label: 'Маркетинг', icon: '📈' },
      { href: '/admin/collections', label: 'Подборки', icon: '📋' },
    ],
  },
  {
    label: 'Команда',
    items: [
      { href: '/admin/users', label: 'Пользователи', icon: '👥' },
      { href: '/admin/reports', label: 'Отчёты', icon: '📝' },
      { href: '/admin/security', label: 'Безопасность', icon: '🔒' },
    ],
  },
]

export default function AdminLayout({ children, title }) {
  const router = useRouter()
  const { profile, signOut } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Sidebar */}
      <aside
        className={`flex flex-col shrink-0 bg-slate-900 border-r border-slate-800 transition-all duration-200 ${
          collapsed ? 'w-14' : 'w-56'
        }`}
      >
        {/* «На сайт» / collapse toggle */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800">
          {!collapsed && (
            <Link
              href="/apartments"
              className="flex items-center gap-1 text-sm font-medium text-slate-300 hover:text-white truncate"
              title="Открыть публичную часть"
            >
              <span>↗</span>
              <span>На сайт</span>
            </Link>
          )}
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {collapsed ? '→' : '←'}
          </button>
        </div>

        {/* Nav links — grouped */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {groups.map((g, gi) => (
            <div key={gi} className={gi > 0 ? 'mt-3' : ''}>
              {!collapsed && (
                <div className="px-4 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {g.label}
                </div>
              )}
              {collapsed && gi > 0 && (
                <div className="mx-3 my-1.5 border-t border-slate-800" />
              )}
              <div className="flex flex-col gap-0.5">
                {g.items.map((l) => {
                  const active = router.pathname === l.href
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      title={collapsed ? l.label : undefined}
                      className={`flex items-center gap-3 px-3 py-2 mx-1 rounded-lg text-sm transition ${
                        active
                          ? 'bg-blue-600 text-white font-medium'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <span className="text-base shrink-0">{l.icon}</span>
                      {!collapsed && <span className="truncate">{l.label}</span>}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User / sign out */}
        <div className="border-t border-slate-800 px-3 py-3 flex flex-col gap-1">
          {!collapsed && (
            <div className="text-xs text-slate-500">
              {profile?.role === 'admin' ? 'Администратор' : profile?.role === 'manager' ? 'Руководитель' : 'Сотрудник'}
            </div>
          )}
          {!collapsed && profile?.name && (
            <span className="text-xs text-slate-400 truncate">{profile.name}</span>
          )}
          <button
            onClick={handleSignOut}
            title={collapsed ? 'Выйти' : undefined}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <span className="text-base shrink-0">🚪</span>
            {!collapsed && <span>Выйти</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 px-6 py-6 overflow-auto">
          {title ? (
            <h1 className="mb-6 text-2xl font-bold text-white">{title}</h1>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  )
}
