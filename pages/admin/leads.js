import AdminLayout from '../../components/admin/AdminLayout'
import LeadsDashboard from '../../components/leads/LeadsDashboard'
import { useAuth } from '../../lib/authContext'

export default function AdminLeadsPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  return (
    <AdminLayout title="Лиды">
      <LeadsDashboard theme="dark" isAdmin={isAdmin} />
    </AdminLayout>
  )
}
