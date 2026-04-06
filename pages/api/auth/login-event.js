import { getSupabaseAdmin } from '../../../lib/supabaseServer'

function parseBrowser(ua) {
  if (/YaBrowser/.test(ua))          return 'Яндекс Браузер'
  if (/Edg\//.test(ua))              return 'Edge'
  if (/OPR\/|Opera/.test(ua))        return 'Opera'
  if (/Chrome\//.test(ua))           return 'Chrome'
  if (/Firefox\//.test(ua))          return 'Firefox'
  if (/Safari\//.test(ua))           return 'Safari'
  return 'Браузер'
}

function parseOS(ua) {
  if (/Windows NT 10\.0/.test(ua))   return 'Windows 10/11'
  if (/Windows NT 6\.[23]/.test(ua)) return 'Windows 8'
  if (/Windows NT 6\.1/.test(ua))    return 'Windows 7'
  if (/Windows/.test(ua))            return 'Windows'
  if (/iPhone/.test(ua))             return 'iPhone'
  if (/iPad/.test(ua))               return 'iPad'
  if (/Android/.test(ua))            return 'Android'
  if (/Mac OS X/.test(ua))           return 'macOS'
  if (/Linux/.test(ua))              return 'Linux'
  return 'ОС'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Server error' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const sessionId = crypto.randomUUID()
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown'
  const ua = req.headers['user-agent'] || ''

  // Обновляем активную сессию (предыдущая становится недействительной)
  await supabase
    .from('profiles')
    .update({ active_session_id: sessionId })
    .eq('id', user.id)

  // Пишем в журнал
  await supabase.from('login_logs').insert({
    user_id:    user.id,
    session_id: sessionId,
    ip_address: ip,
    browser:    parseBrowser(ua),
    os_name:    parseOS(ua),
  })

  return res.status(200).json({ sessionId })
}
