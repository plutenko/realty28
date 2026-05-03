import { getSupabaseAdmin } from '../../../../lib/supabaseServer'

/**
 * POST /api/admin/marketing/sync
 * body: { channel: 'yandex_direct' | 'vk_ads' | ..., date_from?, date_to? }
 *
 * Триггер ручной синхронизации расходов с API канала. Также вызывается из
 * cron-job.org ежедневно для актуализации данных за последние 7 дней.
 *
 * Phase A: возвращает no_config если для канала не настроены credentials.
 * Phase B: реальные API-вызовы (Я.Директ Reports API через OAuth и т.д.).
 *
 * Auth: admin only.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Cron mode — авторизация через CRON_SECRET header (без Bearer пользователя)
  const cronSecret = req.headers['x-cron-secret']
  const userToken = req.headers.authorization?.replace('Bearer ', '')

  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'DB not configured' })

  if (!cronSecret && !userToken) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (cronSecret) {
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Invalid cron secret' })
    }
  } else {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(userToken)
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' })
    }
  }

  const channel = String(req.body?.channel || 'yandex_direct')

  if (channel === 'yandex_direct') {
    return syncYandexDirect(supabase, req, res)
  }

  return res.status(400).json({ error: `Unknown channel: ${channel}`, supported: ['yandex_direct'] })
}

async function syncYandexDirect(supabase, req, res) {
  const oauth = process.env.YANDEX_DIRECT_OAUTH_TOKEN
  if (!oauth) {
    return res.status(200).json({
      ok: false,
      reason: 'no_config',
      message:
        'YANDEX_DIRECT_OAUTH_TOKEN не задан в env. Получи токен в https://oauth.yandex.ru/ и добавь в Timeweb env. ' +
        'См. docs/marketing-yandex-direct.md.',
    })
  }

  // Phase B placeholder: здесь будет реальный код по Я.Директ Reports API.
  // Пока — отметка о попытке в ad_sync_runs.
  const startedAt = new Date()
  const dateFrom = req.body?.date_from || new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
  const dateTo = req.body?.date_to || new Date().toISOString().slice(0, 10)

  const { data: run } = await supabase
    .from('ad_sync_runs')
    .insert({
      channel: 'yandex_direct',
      started_at: startedAt.toISOString(),
      status: 'partial',
      date_from: dateFrom,
      date_to: dateTo,
      meta: { phase: 'A', message: 'connector not yet implemented' },
    })
    .select('id')
    .single()

  return res.status(200).json({
    ok: false,
    reason: 'not_implemented',
    message: 'Я.Директ коннектор будет реализован в Phase B. Токен есть — нужна реализация.',
    sync_run_id: run?.id,
  })
}
