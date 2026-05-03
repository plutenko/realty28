import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { syncYandexDirect } from '../../../../lib/yandexDirect'

/**
 * POST /api/admin/marketing/sync
 * body: { channel: 'yandex_direct', date_from?, date_to? }
 *
 * Триггер ручной/cron-синхронизации расходов с API канала.
 *
 * Auth:
 *   - admin (Bearer token)
 *   - cron (X-Cron-Secret header)
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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
    return runYandexDirect(supabase, req, res)
  }

  return res.status(400).json({ error: `Unknown channel: ${channel}`, supported: ['yandex_direct'] })
}

async function runYandexDirect(supabase, req, res) {
  if (!process.env.YANDEX_DIRECT_OAUTH_TOKEN) {
    return res.status(200).json({
      ok: false,
      reason: 'no_config',
      message: 'YANDEX_DIRECT_OAUTH_TOKEN не задан в env.',
    })
  }

  const dateFrom = req.body?.date_from
  const dateTo = req.body?.date_to

  // Открываем sync run
  const { data: run } = await supabase
    .from('ad_sync_runs')
    .insert({
      channel: 'yandex_direct',
      status: 'running',
      started_at: new Date().toISOString(),
      date_from: dateFrom || null,
      date_to: dateTo || null,
    })
    .select('id')
    .single()

  const runId = run?.id

  try {
    const result = await syncYandexDirect(supabase, { dateFrom, dateTo })

    if (runId) {
      await supabase
        .from('ad_sync_runs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          rows_upserted: result.spend,
          date_from: result.date_from,
          date_to: result.date_to,
          meta: { campaigns: result.campaigns, spend: result.spend },
        })
        .eq('id', runId)
    }

    return res.status(200).json({
      ok: true,
      campaigns_upserted: result.campaigns,
      spend_rows_upserted: result.spend,
      date_from: result.date_from,
      date_to: result.date_to,
      sync_run_id: runId,
    })
  } catch (e) {
    const msg = String(e?.message || e)
    console.error('[admin/marketing/sync] yandex_direct error:', msg)
    if (runId) {
      await supabase
        .from('ad_sync_runs')
        .update({
          status: 'error',
          finished_at: new Date().toISOString(),
          error: msg,
        })
        .eq('id', runId)
    }
    return res.status(502).json({ ok: false, error: msg, sync_run_id: runId })
  }
}
