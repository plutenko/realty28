import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const AuthContext = createContext(null)

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
      .select('role, name, email')
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

  async function signOut() {
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
