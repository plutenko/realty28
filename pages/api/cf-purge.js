import { getSupabaseAdmin } from '../../lib/supabaseServer'

const CF_TOKEN = process.env.CF_API_TOKEN
const CF_ZONE = process.env.CF_ZONE_ID
const CF_HOST = process.env.CF_PURGE_HOST || 'https://domovoy28.ru'

/**
 * POST /api/cf-purge { paths: ["/api/units", "/api/complexes", ...] }
 *
 * Сбрасывает edge-кеш Cloudflare для перечисленных путей. Вызывается из админки
 * после правок (изменение цен, статусов, has_renovation и т.п.), сразу после
 * локального ?invalidate=1 на /api/units и /api/complexes.
 *
 * Без CF_API_TOKEN/CF_ZONE_ID ручка просто отвечает {ok:true,skipped:'no-cf'}
 * чтобы не падать на dev/локалке.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Auth: только admin/manager (как у /api/auth/devices, тот же паттерн)
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Server error' })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!['admin', 'manager'].includes(profile?.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  if (!CF_TOKEN || !CF_ZONE) {
    return res.status(200).json({ ok: true, skipped: 'no-cf-config' })
  }

  const paths = Array.isArray(req.body?.paths) ? req.body.paths : []
  if (paths.length === 0) return res.status(400).json({ error: 'paths required' })

  const files = paths.map((p) => `${CF_HOST}${p.startsWith('/') ? '' : '/'}${p}`)

  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files }),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok || body.success === false) {
      return res.status(502).json({
        ok: false,
        cf_status: r.status,
        cf_errors: body.errors,
      })
    }
    return res.status(200).json({ ok: true, purged: files })
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e?.message || e) })
  }
}
