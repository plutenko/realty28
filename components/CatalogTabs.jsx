import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuth } from '../lib/authContext'

export default function CatalogTabs() {
  const router = useRouter()
  const path = router.pathname
  const { user } = useAuth()

  const tabClass = (href) =>
    `rounded-lg px-4 py-2 text-sm font-medium transition ${
      path === href
        ? 'bg-blue-500 text-white'
        : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
    }`

  return (
    <div className="flex shrink-0 gap-2 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
      <Link href="/apartments" className={tabClass('/apartments')}>
        Квартиры
      </Link>
      <Link href="/buildings" className={tabClass('/buildings')}>
        Дома / ЖК
      </Link>
      {user && (
        <Link href="/my-collections" className={tabClass('/my-collections')}>
          Мои подборки
        </Link>
      )}
    </div>
  )
}
