import { useEffect } from 'react'
import { useRouter } from 'next/router'
import "../styles/globals.css"
import { AuthProvider, useAuth } from '../lib/authContext'

const PUBLIC_PATHS = ['/', '/login', '/admin/login', '/auth/reset-password']
const ADMIN_PREFIX   = '/admin'
const MANAGER_PREFIX = '/manager'

function AuthGuard({ children }) {
  const router = useRouter()
  const { user, profile, loading } = useAuth()
  const path = router.pathname

  useEffect(() => {
    if (loading) return

    const isPublic = PUBLIC_PATHS.includes(path) || path.startsWith('/collections/')
    if (isPublic) return

    if (!user) {
      router.replace(path.startsWith(ADMIN_PREFIX) ? '/admin/login' : '/login')
      return
    }

    const role = profile?.role

    // Только admin в /admin/*
    if (path.startsWith(ADMIN_PREFIX) && role !== 'admin') {
      router.replace('/admin/login')
      return
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
