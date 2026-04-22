/**
 * GET  /api/admin/reports/report?user_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   — список отчётов риелтора за период, вместе с именем редактора (если был).
 *
 * PATCH /api/admin/reports/report?id=<uuid>
 *   body: { metrics?, absence_type?, is_valid? }
 *   — ручная правка отчёта. Всегда ставит edited_by / edited_at = сейчас + caller.
 */

import { getSupabaseAdmin } from '../../../../lib/supabaseServer'
import { DAILY_REPORT_COLUMNS } from '../../../../lib/reportsSettings'

const ABSENCE_TYPES = new Set([null, 'day_off', 'vacation', 'sick_leave'])

async function requireAdmin(req, supabase) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, role')
    .eq('id', user.id)
    .single()
  if (!profile) return null
  if (profile.role !== 'admin' && profile.role !== 'manager') return null
  return profile
}

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })

  const caller = await requireAdmin(req, supabase)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  if (req.method === 'GET') return handleGet(req, res, supabase)
  if (req.method === 'PATCH') return handlePatch(req, res, supabase, caller)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleGet(req, res, supabase) {
  const userId = String(req.query.user_id || '')
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'user_id + from + to обязательны' })
  }

  const cols = [
    'id', 'user_id', 'date_from', 'date_to', 'absence_type', 'is_valid',
    'submitted_at', 'updated_at', 'edited_by', 'edited_at', 'raw_text',
    ...DAILY_REPORT_COLUMNS,
  ].join(', ')

  const { data: reports, error } = await supabase
    .from('daily_reports')
    .select(cols)
    .eq('user_id', userId)
    .lte('date_from', to)
    .gte('date_to', from)
    .order('date_from', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  // Подтягиваем имена редакторов отдельным запросом (без join в PostgREST-синтаксисе —
  // FK может быть не прописан в schema-cache).
  const editorIds = [...new Set((reports || []).map((r) => r.edited_by).filter(Boolean))]
  const editorById = new Map()
  if (editorIds.length > 0) {
    const { data: editors } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', editorIds)
    for (const e of editors || []) editorById.set(e.id, e.name)
  }

  const enriched = (reports || []).map((r) => ({
    ...r,
    edited_by_name: r.edited_by ? editorById.get(r.edited_by) || null : null,
  }))

  return res.status(200).json({ reports: enriched })
}

async function handlePatch(req, res, supabase, caller) {
  const id = String(req.query.id || '')
  if (!id) return res.status(400).json({ error: 'id обязателен' })

  const body = req.body || {}
  const patch = {}

  if (body.metrics && typeof body.metrics === 'object') {
    for (const k of DAILY_REPORT_COLUMNS) {
      if (body.metrics[k] === undefined) continue
      const raw = body.metrics[k]
      if (raw === null || raw === '') {
        patch[k] = null
      } else {
        const n = Number(raw)
        if (!Number.isFinite(n)) {
          return res.status(400).json({ error: `Не число в поле ${k}: ${raw}` })
        }
        patch[k] = Math.round(n)
      }
    }
  }

  if ('absence_type' in body) {
    const t = body.absence_type === '' ? null : body.absence_type
    if (!ABSENCE_TYPES.has(t)) {
      return res.status(400).json({ error: `Неверный absence_type: ${body.absence_type}` })
    }
    patch.absence_type = t
    // При выставлении отсутствия чистим метрики (nullable), а при снятии — не трогаем.
    if (t) {
      for (const k of DAILY_REPORT_COLUMNS) patch[k] = null
    }
  }

  if ('is_valid' in body) {
    patch.is_valid = Boolean(body.is_valid)
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Пустой patch' })
  }

  patch.edited_by = caller.id
  patch.edited_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('daily_reports')
    .update(patch)
    .eq('id', id)
    .select('id, user_id, date_from, date_to, absence_type, is_valid, edited_by, edited_at')
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Отчёт не найден' })

  return res.status(200).json({ ok: true, report: data, edited_by_name: caller.name })
}
