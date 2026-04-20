import { useEffect } from 'react'
import { useRouter } from 'next/router'
import "../styles/globals.css"
import { AuthProvider, useAuth } from '../lib/authContext'

const PUBLIC_PATHS = ['/login', '/auth/reset-password']
const ADMIN_PREFIX   = '/admin'
const MANAGER_PREFIX = '/manager'
const REALTOR_PREFIXES = ['/buildings', '/apartments', '/my-collections']

function AuthGuard({ children }) {
  const router = useRouter()
  const { user, profile, loading } = useAuth()
  const path = router.pathname

  // Перехватываем токен восстановления пароля из хэша URL
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    if (hash && hash.includes('type=recovery')) {
      router.replace('/auth/reset-password' + hash)
    }
  }, [])

  useEffect(() => {
    if (loading) return

    const isPublic = PUBLIC_PATHS.includes(path) || path.startsWith('/collections/')
    if (isPublic) return

    if (!user) {
      router.replace('/login')
      return
    }

    const role = profile?.role

    // Только admin в /admin/*, кроме /admin/reports — туда пускаем и manager
    if (path.startsWith(ADMIN_PREFIX) && role !== 'admin') {
      const managerReports =
        role === 'manager' &&
        (path === '/admin/reports' || path.startsWith('/admin/reports/'))
      if (!managerReports) {
        router.replace('/login')
        return
      }
    }

    // Только manager и admin в /manager/*
    if (path.startsWith(MANAGER_PREFIX) && role !== 'manager' && role !== 'admin') {
      router.replace('/login')
      return
    }
  }, [loading, user, profile, path])

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
