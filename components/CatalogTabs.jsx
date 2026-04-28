import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../lib/authContext'

export default function CatalogTabs({ children }) {
  const router = useRouter()
  const path = router.pathname
  const { user, profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Закрывать дропдаун при клике вне
  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const tabClass = (href) =>
    `relative px-1 py-1 text-sm transition ${
      path === href
        ? 'font-semibold text-gray-900 after:absolute after:inset-x-0 after:-bottom-[14px] after:h-0.5 after:bg-blue-600 after:content-[""]'
        : 'text-gray-500 hover:text-gray-800'
    }`

  const role = profile?.role
  const cabinetHref = role === 'admin' ? '/admin' : role === 'manager' ? '/manager' : null

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
      {/* Табы */}
      <div className="flex gap-5">
        <Link href="/apartments" className={tabClass('/apartments')}>
          Квартиры
        </Link>
        <Link href="/commercial" className={tabClass('/commercial')}>
          Коммерция
        </Link>
        {user && (
          <Link href="/my-collections" className={tabClass('/my-collections')}>
            Мои подборки
          </Link>
        )}
        {user && (
          <Link href="/summary" className={tabClass('/summary')}>
            Сводка
          </Link>
        )}
        {user && profile?.crm_enabled && (
          <Link href="/crm" className={tabClass('/crm')}>
            CRM
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3">
      {children}
      {/* Кнопка личного кабинета */}
      {user && (
        <div className="relative" ref={ref}>
          {cabinetHref ? (
            // Admin и Manager — кнопка с переходом + дропдаун выхода
            <button
              onClick={() => setOpen(v => !v)}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition"
            >
              <span className="h-6 w-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
                {(profile?.name || profile?.email || '?')[0].toUpperCase()}
              </span>
              <span className="hidden sm:inline">{profile?.name || profile?.email}</span>
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          ) : (
            // Риелтор — показываем имя, дропдаун с выходом
            <button
              onClick={() => setOpen(v => !v)}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition"
            >
              <span className="h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold">
                {(profile?.name || profile?.email || '?')[0].toUpperCase()}
              </span>
              <span className="hidden sm:inline">{profile?.name || 'Риелтор'}</span>
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}

          {/* Дропдаун */}
          {open && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg z-50">
              <div className="border-b border-gray-100 px-4 py-2">
                <div className="text-sm font-medium text-gray-900">{profile?.name || '—'}</div>
                {profile?.email && !profile.email.endsWith('@app.local') && (
                  <div className="text-xs text-gray-400">{profile.email}</div>
                )}
              </div>
              {cabinetHref && (
                <Link
                  href={cabinetHref}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {role === 'admin' ? 'Админка' : 'Кабинет руководителя'}
                </Link>
              )}
              <button
                onClick={handleSignOut}
                className="block w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-gray-50"
              >
                Выйти
              </button>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
