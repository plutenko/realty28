import Link from 'next/link'
import { useRouter } from 'next/router'

const links = [
  { href: '/admin', label: 'Главная' },
  { href: '/admin/developers', label: 'Застройщики' },
  { href: '/admin/complexes', label: 'ЖК' },
  { href: '/admin/buildings', label: 'Дома' },
  { href: '/admin/units', label: 'Квартиры' },
  { href: '/admin/collections', label: 'Подборки' },
  { href: '/admin/sources', label: 'Источники' },
]

export default function AdminLayout({ children, title }) {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/" className="text-sm font-semibold text-white">
            ← На сайт
          </Link>
          <span className="text-slate-500">|</span>
          <nav className="flex flex-wrap gap-2">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  router.pathname === l.href
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {title ? (
          <h1 className="mb-6 text-2xl font-bold text-white">{title}</h1>
        ) : null}
        {children}
      </main>
    </div>
  )
}
