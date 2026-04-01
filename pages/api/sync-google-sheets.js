/**
 * POST JSON body: { sourceId }
 *
 * Google Sheets (шахматка) по ссылке с вкладкой:
 * - spreadsheetId: фрагмент URL между `/d/` и следующим `/`
 * - gid: число после `#gid=` или `?gid=` в том же URL
 *
 * После выгрузки xlsx через Drive API:
 * - `XLSX.read(buffer, { type: 'buffer', bookSheets: false })`
 * - `sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' })` —
 *   ищем лист, где `properties.sheetId === gid`, берём его индекс в массиве `sheets`
 * - имя вкладки для парсера: `workbook.SheetNames[index]` (порядок экспорта совпадает)
 *
 * Реализация: `lib/syncGoogleSheetsFromSource.js` → `syncGoogleSheetsFromSource`
 * (общая с `POST /api/sync?id=…`).
 */
import { getSupabaseAdmin } from '../../lib/supabaseServer'
import {
  syncGoogleSheetsFromSource,
  shouldUseGoogleSheetsChessboardSync,
} from '../../lib/syncGoogleSheetsFromSource'

export { syncGoogleSheetsFromSource, shouldUseGoogleSheetsChessboardSync }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    res.status(500).json({ ok: false, error: 'Supabase admin is not configured' })
    return
  }

  let body = {}
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  } catch {
    body = {}
  }

  const sourceId = body.sourceId ? String(body.sourceId) : ''
  if (!sourceId) {
    res.status(400).json({ ok: false, error: 'sourceId is required' })
    return
  }

  const { data: source, error: sourceErr } = await supabase
    .from('sources')
    .select('id, url, building_id, parser_type, type')
    .eq('id', sourceId)
    .maybeSingle()

  if (sourceErr) {
    res.status(500).json({ ok: false, error: sourceErr.message })
    return
  }
  if (!source) {
    res.status(404).json({ ok: false, error: 'Source not found' })
    return
  }

  const result = await syncGoogleSheetsFromSource(supabase, source)
  if (result.ok) {
    res.status(200).json({ ok: true, count: result.count })
  } else {
    res.status(500).json({ ok: false, error: result.error })
  }
}
