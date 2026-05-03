import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../lib/authContext'

/**
 * Корень сайта /:
 *   - Админ → сразу /admin
 *   - Менеджер → /manager
 *   - Риелтор / гость → /apartments
 */
export default function Home() {
  const router = useRouter()
  const { profile, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    const role = profile?.role
    if (role === 'admin') router.replace('/admin')
    else if (role === 'manager') router.replace('/manager')
    else router.replace('/apartments')
  }, [loading, profile, router])

  return null
}
