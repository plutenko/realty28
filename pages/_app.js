import { useEffect } from 'react'
import { useRouter } from 'next/router'
import "../styles/globals.css"
import { AuthProvider, useAuth } from '../lib/authContext'

// Маршруты, доступные без авторизации
const PUBLIC_PATHS = ['/', '/login', '/admin/login', '/auth/reset-password']
// Маршруты только для admin
const ADMIN_PREFIX = '/admin'
// Маршруты для риелторов (и admin тоже)
const REALTOR_PREFIXES = ['/buildings', '/apartments', '/collections']

function AuthGuard({ children }) {
  const router = useRouter()
  const { user, profile, loading } = useAuth()
  const path = router.pathname

  useEffect(() => {
    if (loading) return

    const isPublic = PUBLIC_PATHS.includes(path) || path.startsWith('/collections/')
    if (isPublic) return

    const isAdminRoute   = path.startsWith(ADMIN_PREFIX)
    const isRealtorRoute = REALTOR_PREFIXES.some(p => path.startsWith(p))

    if (!user) {
      router.replace(isAdminRoute ? '/admin/login' : '/login')
      return
    }

    if (isAdminRoute && profile?.role !== 'admin') {
      router.replace('/admin/login')
      return
    }
  }, [loading, user, profile, path])

  // Пока грузим сессию — показываем заглушку на защищённых страницах
  if (loading && !PUBLIC_PATHS.includes(path) && !path.startsWith('/collections/')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="text-slate-500 text-sm">Загрузка...</div>
      </div>
    )
  }

  return children
}

export default function App({ Component, pageProps }) {
  return (
    <AuthProvider>
      <AuthGuard>
        <Component {...pageProps} />
      </AuthGuard>
    </AuthProvider>
  )
}
