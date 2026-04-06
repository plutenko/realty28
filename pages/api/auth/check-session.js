import { getSupabaseAdmin } from '../../../lib/supabaseServer'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const token = req.headers.authorization?.replace('Bearer ', '')
  const { sessionId } = req.query

  if (!token || !sessionId) return res.status(200).json({ valid: false })

  const supabase = getSupabaseAdmin()
  // При ошибке сервера не выкидываем пользователя
  if (!supabase) return res.status(200).json({ valid: true })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(200).json({ valid: false })

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_session_id')
    .eq('id', user.id)
    .single()

  // Если в БД нет active_session_id — фича ещё не активирована для этого юзера, пропускаем
  if (!profile?.active_session_id) return res.status(200).json({ valid: true })

  return res.status(200).json({ valid: profile.active_session_id === sessionId })
}
