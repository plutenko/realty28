import * as XLSX from 'xlsx'
import {
  extractGoogleSpreadsheetId,
  resolveGoogleAuthForSheetsSync,
  downloadSpreadsheetXlsxBuffer,
} from '../../lib/syncGoogleSheetsFromSource'
import { createClient } from '@supabase/supabase-js'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url } = req.body || {}
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url' })
  }

  const spreadsheetId = extractGoogleSpreadsheetId(url)
  if (!spreadsheetId) {
    return res
      .status(400)
      .json({ error: 'Не удалось извлечь spreadsheet ID из URL' })
  }

  try {
    const supabase = getSupabaseAdmin()
    const { auth } = await resolveGoogleAuthForSheetsSync(supabase)
    const { buffer } = await downloadSpreadsheetXlsxBuffer(
      spreadsheetId,
      auth
    )
    const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: true })
    const sheets = (wb.SheetNames || []).map((name, index) => ({
      index,
      name,
    }))
    return res.status(200).json({ sheets })
  } catch (e) {
    console.error('[list-sheets]', e)
    return res
      .status(500)
      .json({ error: e?.message || 'Ошибка загрузки листов' })
  }
}
