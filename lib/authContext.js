import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const AuthContext = createContext(null)

const SESSION_KEY = 'domovoy_sid'

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)

  async function loadProfile(supabaseUser) {
    if (!supabaseUser || !supabase) {
      setProfile(null)
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('id, role, name, email, crm_enabled')
      .eq('id', supabaseUser.id)
      .single()
    setProfile(data ?? null)
  }

  useEffect(() => {
    if (!supabase) {
      setUser(null)
      return
    }

    // Текущая сессия при монтировании
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      loadProfile(session?.user ?? null)
    })

    // Подписка на изменения сессии
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        loadProfile(session?.user ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // Периодическая проверка: не вошёл ли кто-то ещё под этим аккаунтом
  // Применяется только к риелторам — менеджеры и админы не ограничены
  useEffect(() => {
    if (!user || !profile || !supabase) return
    if (profile.role !== 'realtor') return

    async function checkSession() {
      const storedId = typeof localStorage !== 'undefined'
        ? localStorage.getItem(SESSION_KEY)
        : null
      if (!storedId) return

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const res = await fetch(
          `/api/auth/check-session?sessionId=${encodeURIComponent(storedId)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        )
        if (!res.ok) return
        const { valid } = await res.json()
        if (!valid) {
          localStorage.removeItem(SESSION_KEY)
          await supabase.auth.signOut()
        }
      } catch {
        // Сетевая ошибка — не выкидываем пользователя
      }
    }

    // Проверяем сразу при загрузке, затем каждые 60 секунд и при возврате на вкладку
    checkSession()
    const interval = setInterval(checkSession, 60_000)
    window.addEventListener('focus', checkSession)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', checkSession)
    }
  }, [user, profile])

  async function signOut() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SESSION_KEY)
    if (supabase) await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading: user === undefined, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
