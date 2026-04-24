import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import CatalogTabs from '../../components/CatalogTabs'
import CrmRealtorsView from '../../components/manager/CrmRealtorsView'
import { useAuth } from '../../lib/authContext'

export default function CrmUsersPage() {
  const router = useRouter()
  const { user, profile, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace('/login'); return }
    if (profile && !['admin', 'manager'].includes(profile.role)) {
      router.replace('/apartments')
    }
  }, [loading, user, profile, router])

  if (loading || !user) return <div className="p-6 text-sm text-gray-500">Загрузка…</div>

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <CatalogTabs />
      <div className="px-4 py-4 md:px-6 md:py-6">
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
          <Link href="/manager" className="text-sm text-blue-600 hover:underline">← Назад в кабинет</Link>
          <Link href="/manager/crm-analytics" className="rounded-xl bg-white border border-gray-200 hover:bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700">
            📊 Аналитика CRM
          </Link>
        </div>
        <CrmRealtorsView />
      </div>
    </div>
  )
}
