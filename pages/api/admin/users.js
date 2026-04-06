import { getSupabaseAdmin } from '../../../lib/supabaseServer'

async function requireAdmin(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const supabase = getSupabaseAdmin()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return profile?.role === 'admin' ? user : null
}

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin()

  const caller = await requireAdmin(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  // GET — список пользователей
  if (req.method === 'GET') {
    const { data: { users }, error } = await supabase.auth.admin.listUsers()
    if (error) return res.status(500).json({ error: error.message })

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, role, name, email')

    const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))

    const result = users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      role: profileMap[u.id]?.role ?? null,
      name: profileMap[u.id]?.name ?? null,
    }))

    return res.status(200).json(result)
  }

  // POST — создать пользователя
  if (req.method === 'POST') {
    const { email, password, role, name } = req.body
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password и role обязательны' })
    }
    if (!['admin', 'realtor'].includes(role)) {
      return res.status(400).json({ error: 'role должен быть admin или realtor' })
    }

    const { data: { user }, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError) return res.status(400).json({ error: createError.message })

    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: user.id, role, name: name || null, email })

    if (profileError) {
      await supabase.auth.admin.deleteUser(user.id)
      return res.status(500).json({ error: profileError.message })
    }

    return res.status(201).json({ id: user.id, email, role, name })
  }

  // PATCH — изменить имя/роль/пароль
  if (req.method === 'PATCH') {
    const { id, role, name, password } = req.body
    if (!id) return res.status(400).json({ error: 'id обязателен' })

    if (role || name !== undefined) {
      const updates = {}
      if (role) updates.role = role
      if (name !== undefined) updates.name = name
      const { error } = await supabase.from('profiles').update(updates).eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
    }

    if (password) {
      const { error } = await supabase.auth.admin.updateUserById(id, { password })
      if (error) return res.status(500).json({ error: error.message })
    }

    return res.status(200).json({ ok: true })
  }

  // DELETE — удалить пользователя
  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id обязателен' })

    if (id === caller.id) {
      return res.status(400).json({ error: 'Нельзя удалить свой аккаунт' })
    }

    const { error } = await supabase.auth.admin.deleteUser(id)
    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
