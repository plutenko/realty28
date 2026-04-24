import { useEffect } from 'react'
import { useRouter } from 'next/router'
import CatalogTabs from '../../components/CatalogTabs'
import LeadsDashboard from '../../components/leads/LeadsDashboard'
import { useAuth } from '../../lib/authContext'

export default function ManagerLeadsPage() {
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
    <div className="flex h-screen flex-col bg-gray-50">
      <CatalogTabs />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <LeadsDashboard theme="light" isAdmin={false} />
      </div>
    </div>
  )
}
