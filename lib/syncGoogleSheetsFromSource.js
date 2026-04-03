import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import * as XLSX from 'xlsx'
import { inferFloorFromFlatNumber } from './inferFloorFromFlatNumber'
import { parseGoogleSheetsChessboard } from './parsers/googleSheets'
import { upsertImportedUnits } from './upsertImportedUnits'

export function extractGoogleSpreadsheetId(url) {
  const s = String(url || '')
  const m1 = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (m1) return m1[1]
  const m2 = s.match(/[?&]id=([a-zA-Z0-9-_]+)/)
  if (m2) return m2[1]
  return null
}

/**
 * @param {string} url
 * @returns {string | null} gid digits as string
 */
export function extractGidFromUrl(url) {
  const s = String(url || '')
  const m = s.match(/[#&?]gid=(\d+)/i)
  return m ? m[1] : null
}

/**
 * Явное имя или индекс листа для внешнего Excel (несколько вкладок, API Google недоступен).
 * Добавьте к URL: &sync_sheet=ИмяВкладки или &sync_sheet=0 (первый лист, 1 — второй…).
 * Google параметр не использует — он только для нашего синка.
 */
export function extractSheetSyncHint(url) {
  const raw = String(url || '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    const v =
      u.searchParams.get('sync_sheet') ||
      u.searchParams.get('sync_tab') ||
      u.searchParams.get('sheet')
    if (v == null || String(v).trim() === '') return null
    return decodeURIComponent(String(v).trim())
  } catch {
    const qm = raw.indexOf('?')
    if (qm < 0) return null
    const q = raw.slice(qm + 1).split('#')[0]
    try {
      const params = new URLSearchParams(q)
      const v =
        params.get('sync_sheet') ||
        params.get('sync_tab') ||
        params.get('sheet')
      if (v == null || String(v).trim() === '') return null
      return decodeURIComponent(String(v).trim())
    } catch {
      return null
    }
  }
}

/**
 * @param {string[]} names - SheetNames из xlsx
 * @param {string} hint - имя листа или целое "0","1",… как индекс
 * @returns {string | null}
 */
export function pickSheetNameFromHint(names, hint) {
  const list = Array.isArray(names) ? names : []
  const h = String(hint || '').trim()
  if (!h) return null
  if (/^\d+$/.test(h)) {
    const i = Number(h)
    if (i >= 0 && i < list.length) return list[i]
    return null
  }
  if (list.includes(h)) return h
  const low = h.toLowerCase()
  const hit = list.find((n) => String(n).toLowerCase() === low)
  return hit || null
}

/**
 * #gid в URL = sheetId из Sheets API. Имя листа для XLSX: сначала совпадение с properties.title
 * (для .xlsx с Диска порядок листов в файле может не совпадать с индексом в API).
 */
async function resolveSheetTabNameForGid(buffer, spreadsheetId, gid, auth) {
  const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: false })
  const names = wb.SheetNames || []
  const sheetsApi = google.sheets({ version: 'v4', auth })
  const { data } = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  })
  const list = data.sheets || []
  const gidNum = Number(gid)
  const entry = list.find(
    (s) => s.properties != null && Number(s.properties.sheetId) === gidNum
  )
  if (!entry?.properties) {
    throw new Error(`No sheet with gid ${gid} in spreadsheet metadata`)
  }
  const title = String(entry.properties.title || '').trim()
  if (!title) {
    throw new Error(`Sheet gid ${gid} has no title in API`)
  }

  if (names.includes(title)) return title

  const lower = title.toLowerCase()
  const byInsensitive = names.find((n) => String(n).toLowerCase() === lower)
  if (byInsensitive) return byInsensitive

  const sheetIndex = list.indexOf(entry)
  if (sheetIndex >= 0 && sheetIndex < names.length) {
    return names[sheetIndex]
  }

  throw new Error(
    `Вкладка «${title}» (gid ${gid}) не найдена среди листов в xlsx: ${names.join(', ')}`
  )
}

const MIME_GOOGLE_SPREADSHEET = 'application/vnd.google-apps.spreadsheet'

/** Текст из Gaxios / тела ответа Google (для эвристик). */
function flattenGoogleApiErrorMessage(e) {
  const ex = e && typeof e === 'object' ? e : {}
  const res = 'response' in ex && ex.response ? ex.response : null
  const data =
    res && typeof res === 'object' && 'data' in res ? res.data : null
  if (data && typeof data === 'object') {
    const err = data.error
    if (typeof err === 'string') return err
    if (err && typeof err === 'object' && typeof err.message === 'string') {
      return err.message
    }
  }
  if ('message' in ex && typeof ex.message === 'string') return ex.message
  return String(e)
}

/** Внешний .xlsx в интерфейсе Sheets — spreadsheets.get часто недоступен. */
function isSpreadsheetMetadataUnsupportedError(e) {
  const msg = flattenGoogleApiErrorMessage(e)
  return /not supported for this document/i.test(msg)
}

function isOfficeSpreadsheetMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (!m) return false
  if (m === MIME_GOOGLE_SPREADSHEET) return false
  return m.includes('spreadsheetml') || m.includes('ms-excel')
}

/**
 * @param {string | null | undefined} sheetHint - из &sync_sheet= в URL источника (после ошибки API)
 */
async function resolveSheetTabNameWithFallback(
  buffer,
  spreadsheetId,
  gid,
  auth,
  sheetHint
) {
  const hint = sheetHint ? String(sheetHint).trim() : ''

  try {
    return await resolveSheetTabNameForGid(buffer, spreadsheetId, gid, auth)
  } catch (err) {
    const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: false })
    const names = wb.SheetNames || []
    if (!names.length) {
      throw err
    }

    if (hint) {
      const picked2 = pickSheetNameFromHint(names, hint)
      if (picked2) return picked2
      throw new Error(
        `Параметр sync_sheet=«${hint}» не совпал ни с одним листом. Листы в файле: ${names.map((n) => `«${n}»`).join(', ')}. Либо укажите точное имя вкладки (как внизу в Google), либо индекс: sync_sheet=0 — первый лист.`
      )
    }

    if (isSpreadsheetMetadataUnsupportedError(err)) {
      if (names.length === 1) {
        return names[0]
      }
      throw new Error(
        `Внешний Excel, несколько листов (${names.length}) — Google не отдаёт вкладки по ссылке. Добавьте в конец URL параметр &sync_sheet= и имя нужной вкладки (как внизу окна), например: …edit?usp=sharing&sync_sheet=${encodeURIComponent(names[0] || 'Лист1')}. Либо индекс листа: &sync_sheet=0 (первый), &sync_sheet=1 (второй). Либо «Файл» → «Сохранить как Google Таблицы» и обычная ссылка с #gid=.`
      )
    }

    const n = Number(gid)
    if (Number.isFinite(n) && n >= 0 && n < names.length && n < 500) {
      return names[n]
    }
    if (names.length === 1) {
      return names[0]
    }
    throw err
  }
}

function parseServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw || !String(raw).trim()) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  }
  try {
    return JSON.parse(String(raw))
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON')
  }
}

function serviceAccountClientEmailFromEnv() {
  try {
    const j = parseServiceAccountCredentials()
    return typeof j.client_email === 'string' ? j.client_email : null
  } catch {
    return null
  }
}

function createGoogleAuthFromEnv() {
  const credentials = parseServiceAccountCredentials()
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  })
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient | null} supabase
 */
async function fetchGoogleSheetsOAuthRow(supabase) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('google_sheets_oauth')
    .select('access_token, refresh_token, token_expiry')
    .eq('id', 1)
    .maybeSingle()
  if (error || !data) return null
  return data
}

/**
 * OAuth user refresh_token in DB → fresh access_token for Drive/Sheets.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<OAuth2Client>}
 */
async function getOAuth2ClientForSheetsSync(supabase) {
  const row = await fetchGoogleSheetsOAuthRow(supabase)
  const refresh = String(row?.refresh_token || '').trim()
  if (!refresh) {
    throw new Error('OAuth refresh_token missing')
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'В БД сохранён Google OAuth, но не заданы GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET и GOOGLE_OAUTH_REDIRECT_URI'
    )
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri)
  const expiryMs = row?.token_expiry ? new Date(row.token_expiry).getTime() : 0
  const access = String(row?.access_token || '').trim()

  oauth2Client.setCredentials({
    refresh_token: refresh,
    access_token: access || undefined,
    expiry_date: Number.isFinite(expiryMs) && expiryMs > 0 ? expiryMs : undefined,
  })

  const now = Date.now()
  const needsRefresh = !access || !expiryMs || expiryMs < now + 60_000

  if (needsRefresh) {
    const r = await oauth2Client.refreshAccessToken()
    const credentials = r.credentials
    const mergedRefresh = credentials.refresh_token || refresh
    const newExpiry =
      credentials.expiry_date != null
        ? new Date(credentials.expiry_date).toISOString()
        : null

    await supabase
      .from('google_sheets_oauth')
      .update({
        access_token: credentials.access_token ?? null,
        refresh_token: mergedRefresh,
        token_expiry: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)

    oauth2Client.setCredentials({
      ...credentials,
      refresh_token: mergedRefresh,
    })
  }

  return oauth2Client
}

/**
 * Personal OAuth (if refresh_token in DB) first; else service account JSON.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{ auth: OAuth2Client | import('google-auth-library').GoogleAuth; usedOAuth: boolean }>}
 */
async function resolveGoogleAuthForSheetsSync(supabase) {
  const row = await fetchGoogleSheetsOAuthRow(supabase)
  const hasOauth = Boolean(String(row?.refresh_token || '').trim())

  if (hasOauth) {
    const auth = await getOAuth2ClientForSheetsSync(supabase)
    return { auth, usedOAuth: true }
  }

  try {
    const auth = createGoogleAuthFromEnv()
    return { auth, usedOAuth: false }
  } catch (e) {
    const msg =
      e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
        ? e.message
        : 'GOOGLE_SERVICE_ACCOUNT_JSON'
    throw new Error(
      `${msg}. Либо подключите Google в /admin/sources (OAuth), либо задайте сервисный аккаунт.`
    )
  }
}

/**
 * @param {unknown} data - Google API JSON error body
 */
function googleApiMessageFromBody(data) {
  if (!data || typeof data !== 'object') return null
  const err = data.error
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && typeof err.message === 'string') {
    return err.message
  }
  return null
}

/**
 * Gaxios / googleapis often surface 403 as "Request failed with status code 403".
 * @param {unknown} e
 * @param {{ usedOAuth?: boolean }} [opts]
 */
export function formatGoogleSheetsSyncError(e, opts = {}) {
  const ex = e && typeof e === 'object' ? e : {}
  const res = 'response' in ex && ex.response ? ex.response : null
  const status =
    (res && typeof res === 'object' && 'status' in res ? res.status : null) ??
    ('status' in ex ? ex.status : null)

  const data =
    res && typeof res === 'object' && 'data' in res ? res.data : null
  const apiMsg = googleApiMessageFromBody(data)

  if (status === 403) {
    if (opts.usedOAuth) {
      const tail = apiMsg ? ` Ответ Google: ${apiMsg}` : ''
      return (
        'Нет доступа к таблице (403) под вашим Google-аккаунтом. Сделайте так: 1) Откройте эту же таблицу в браузере, будучи залогинены тем же аккаунтом, что и при «Подключить Google». 2) «Настройки доступа» / «Поделиться»: либо «Все, у кого есть ссылка» — читатель, либо явно добавьте свой email с ролью читатель. 3) Если таблица на корпоративном Google Workspace — админ мог запретить доступ по ссылке для API; тогда попросите владельца выдать вам доступ напрямую. 4) Файл на общем диске (Shared drive) — убедитесь, что у вас есть право просмотра на диске.' +
        tail
      )
    }
    const email = serviceAccountClientEmailFromEnv()
    return (
      'Нет доступа к таблице (403). В Google Sheets: «Настройки доступа» / «Поделиться» — добавьте сервисный аккаунт как «Читатель» (Viewer).' +
      (email
        ? ` Email: ${email}`
        : ' Укажите email из поля client_email в ключе сервисного аккаунта.')
    )
  }
  if (status === 404) {
    return 'Таблица не найдена (404). Проверьте ссылку и id в URL.'
  }

  const flat = flattenGoogleApiErrorMessage(e)
  if (/not supported for this document/i.test(`${apiMsg || ''} ${flat}`)) {
    return (
      'Файл открыт как внешний Excel — Google не выполняет для него нужные операции API («This operation is not supported for this document»). В Google Таблицах: «Файл» → «Сохранить как Google Таблицы», затем замените URL в источнике на новый и снова скопируйте ссылку с нужной вкладкой (#gid=…).'
    )
  }

  const msg =
    'message' in ex && typeof ex.message === 'string'
      ? ex.message
      : 'Google Sheets sync failed'
  if (apiMsg && apiMsg !== msg) return `${msg} — ${apiMsg}`
  return msg
}

/**
 * @param {Record<string, unknown>|null|undefined} source
 */
export function shouldUseGoogleSheetsChessboardSync(source) {
  const typ = String(source?.type || '').toLowerCase()
  if (typ === 'google_sheets') return true
  const pt = String(source?.parser_type || '').toLowerCase()
  if (typ === 'google' && pt && pt !== 'profitbase' && pt !== 'csv') return true
  return false
}

/**
 * Пост-обработка синка (этаж из номера и т.п.) завязана на формат **Содружество**.
 * Для нового `parser_type` задайте false и реализуйте свою логику при сборке units.
 *
 * @param {Record<string, unknown>|null|undefined} source
 */
export function isGoogleSheetsSodruzhestvoParserType(source) {
  const pt = String(source?.parser_type || '').toLowerCase()
  return !pt || pt === 'sodruzhestvo' || pt === 'default'
}

/**
 * Разбор xlsx вкладки по `sources.parser_type`.
 * Сейчас `sodruzhestvo`, `default` и пустой тип → {@link parseGoogleSheetsChessboard} (Содружество).
 * Другой застройщик: добавить `import { parse… } from './parsers/…'` и ветку `if (pt === '…')`.
 *
 * @param {Record<string, unknown>} source
 * @param {Buffer} buffer
 * @param {string} sheetName
 * @returns {ReturnType<typeof parseGoogleSheetsChessboard>}
 */
function parseGoogleSheetRowsByParserType(source, buffer, sheetName) {
  const pt = String(source?.parser_type || '').toLowerCase()
  if (pt === 'sodruzhestvo' || pt === 'default' || !pt) {
    return parseGoogleSheetsChessboard(buffer, sheetName)
  }
  // Неизвестный тип: пока fallback на Содружество (обратная совместимость). Замените на throw или свой парсер.
  return parseGoogleSheetsChessboard(buffer, sheetName)
}

async function resolveBuildingForSource(supabase, buildingId) {
  if (!buildingId) return null
  let { data, error } = await supabase
    .from('buildings')
    .select('id, units_per_floor')
    .eq('id', buildingId)
    .maybeSingle()
  if (error && /units_per_floor/i.test(String(error.message || ''))) {
    const fallback = await supabase
      .from('buildings')
      .select('id')
      .eq('id', buildingId)
      .maybeSingle()
    data = fallback.data
    error = fallback.error
  }
  if (error) throw error
  return data ?? null
}

/**
 * Позиция на этаже из номера квартиры: последние 2 цифры (24**01** → 1, 24**05** → 5).
 * При % 100 === 0 — запасной вариант unitsPerFloor (например 2400).
 */
function computePosition(number, unitsPerFloor) {
  const n = Number(number)
  const per = Math.max(1, Number(unitsPerFloor) || 4)
  if (!Number.isFinite(n) || n <= 0) return null
  const idx = n % 100
  if (idx !== 0) return idx
  return per
}

/**
 * Скачать таблицу как xlsx в память.
 * Нативная Google Таблица → Drive files.export; загруженный Excel на Диске → files.get alt=media
 * (иначе Google отвечает: «Export only supports Docs Editors files»).
 *
 * @param {string} spreadsheetId
 * @param {OAuth2Client | import('google-auth-library').GoogleAuth} auth
 * @returns {Promise<{ buffer: Buffer; isNativeGoogleSheet: boolean }>}
 */
async function downloadSpreadsheetXlsxBuffer(spreadsheetId, auth) {
  const drive = google.drive({ version: 'v3', auth })
  const { data: meta } = await drive.files.get({
    fileId: spreadsheetId,
    fields: 'mimeType',
    supportsAllDrives: true,
  })
  const mime = meta?.mimeType || ''

  if (mime === MIME_GOOGLE_SPREADSHEET) {
    const res = await drive.files.export(
      {
        fileId: spreadsheetId,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        supportsAllDrives: true,
      },
      { responseType: 'arraybuffer' }
    )
    return { buffer: Buffer.from(res.data), isNativeGoogleSheet: true }
  }

  if (isOfficeSpreadsheetMime(mime)) {
    const res = await drive.files.get(
      {
        fileId: spreadsheetId,
        alt: 'media',
        supportsAllDrives: true,
      },
      { responseType: 'arraybuffer' }
    )
    return { buffer: Buffer.from(res.data), isNativeGoogleSheet: false }
  }

  throw new Error(
    `Тип файла в Drive не поддержан для синка: ${mime || '(пусто)'}. Нужна Google Таблица или .xlsx/.xls на Диске.`
  )
}

/**
 * Gid → вкладка: `XLSX.read` + `spreadsheets.get` + индекс в `workbook.SheetNames`.
 * (Тот же поток вызывается из `/api/sync` и `/api/sync-google-sheets`.)
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} source - row from public.sources
 * @returns {Promise<{ ok: true, count: number } | { ok: false, error: string }>}
 */
export async function syncGoogleSheetsFromSource(supabase, source) {
  const syncNow = new Date().toISOString()
  const sourceId = source?.id
  let usedOAuth = false

  const fail = async (message) => {
    if (supabase && sourceId) {
      await supabase
        .from('sources')
        .update({
          last_sync_at: syncNow,
          last_sync_error: message,
          last_sync_count: 0,
        })
        .eq('id', sourceId)
    }
    return { ok: false, error: message }
  }

  try {
    if (!supabase) return await fail('Supabase admin is not configured')
    if (!source?.building_id) {
      return await fail('Source has no building_id')
    }

    const spreadsheetId = extractGoogleSpreadsheetId(source.url)
    if (!spreadsheetId) {
      return await fail(
        'Could not extract spreadsheet id from url (expected /d/{id}/ in Google Sheets URL)'
      )
    }

    const gid = extractGidFromUrl(source.url)
    const sheetHint = extractSheetSyncHint(source.url)
    if (!gid && !sheetHint) {
      return await fail(
        'В URL нужен #gid=… (или ?gid=…) либо параметр &sync_sheet=… — имя вкладки или номер: 0 = первый лист, 1 = второй.'
      )
    }

    const { auth: googleAuth, usedOAuth: oauth } =
      await resolveGoogleAuthForSheetsSync(supabase)
    usedOAuth = oauth

    const { buffer } = await downloadSpreadsheetXlsxBuffer(spreadsheetId, googleAuth)

    let sheetName
    if (!gid && sheetHint) {
      const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: false })
      const names = wb.SheetNames || []
      const picked = pickSheetNameFromHint(names, sheetHint)
      if (!picked) {
        return await fail(
          `sync_sheet=«${sheetHint}» не найден среди листов: ${names.length ? names.map((n) => `«${n}»`).join(', ') : '(нет листов)'}.`
        )
      }
      sheetName = picked
    } else {
      sheetName = await resolveSheetTabNameWithFallback(
        buffer,
        spreadsheetId,
        gid,
        googleAuth,
        sheetHint || undefined
      )
    }
    const parsed = parseGoogleSheetRowsByParserType(source, buffer, sheetName)

    const dbgFloors24_25 = parsed.filter((u) => {
      const f = Number(u.floor)
      return (
        !u.is_commercial &&
        Number.isFinite(f) &&
        (f === 24 || f === 25) &&
        Number(u.number) >= 2400 &&
        Number(u.number) <= 2499
      )
    })
    if (dbgFloors24_25.length) {
      console.log(
        '[syncGoogleSheets] span_floors debug floors 24–25 (numbers 2400–2499):',
        dbgFloors24_25
          .map((u) => ({
            number: u.number,
            floor: u.floor,
            span_floors: u.span_floors ?? 1,
            area: u.area,
          }))
          .sort((a, b) => Number(a.number) - Number(b.number))
      )
    }

    if (!parsed.length) {
      return await fail(
        'Файл скачан, но парсер не нашёл ни одной квартиры: в столбце A — номера этажей 1–60, под каждый этаж три строки (квартиры / ₽·м² / цена). Проверьте нужный лист (sync_sheet в URL или #gid) и формат; шапки «Этаж»/«Ось» сверху допускаются.'
      )
    }

    const building = await resolveBuildingForSource(supabase, source.building_id)
    if (!building) {
      return await fail('Building not found for source')
    }

    const unitsPerFloor = Math.max(1, Number(building.units_per_floor) || 4)
    const sodruzhestvoSheet = isGoogleSheetsSodruzhestvoParserType(source)

    const apartments = parsed
      .filter((row) => !row.is_commercial)
      .map((row) => {
        const sf =
          typeof row.span_floors === 'number' ? row.span_floors : 1
        // Только Содружество: этаж из номера при сбое колонки A в xlsx. Другой parser_type — без этой эвристики.
        const inferredFloor =
          sodruzhestvoSheet && sf <= 1
            ? inferFloorFromFlatNumber(row.number)
            : null
        const floor =
          inferredFloor != null ? inferredFloor : row.floor
        return {
        source_id: source.id,
        building_id: source.building_id,
        external_id: row.external_id,
        number: row.number,
        floor,
        rooms: row.rooms,
        area: row.area,
        price: row.price != null ? Number(row.price) : 0,
        price_per_meter:
          row.price_per_meter != null ? Number(row.price_per_meter) : 0,
        position:
          row.position != null
            ? row.position
            : computePosition(row.number, unitsPerFloor),
        status: row.status || 'available',
        layout_title: row.layout_title ?? null,
        span_floors: typeof row.span_floors === 'number' ? row.span_floors : 1,
        is_commercial: false,
      }
      })

    const commercial = parsed
      .filter((row) => row.is_commercial)
      .map((row) => {
        const label =
          String(row.commercial_label || '').trim() || 'Помещение'
        return {
          source_id: source.id,
          building_id: source.building_id,
          external_id: row.external_id,
          number: row.number,
          floor: 1,
          rooms: null,
          area: row.area,
          price: row.price != null ? Number(row.price) : 0,
          price_per_meter:
            row.price_per_meter != null ? Number(row.price_per_meter) : 0,
          position: null,
          status: row.status || 'available',
          layout_title: `Коммерция · ${label}`,
          span_floors: 1,
          is_commercial: true,
        }
      })

    const units = [...apartments, ...commercial]

    const { count } = await upsertImportedUnits(supabase, units)

    const { error: updErr } = await supabase
      .from('sources')
      .update({
        last_sync_at: syncNow,
        last_sync_count: count,
        last_sync_error: null,
      })
      .eq('id', source.id)

    if (updErr) {
      return await fail(updErr.message)
    }

    return { ok: true, count }
  } catch (e) {
    let oauthErrorContext = usedOAuth
    if (!oauthErrorContext && supabase) {
      const row = await fetchGoogleSheetsOAuthRow(supabase)
      oauthErrorContext = Boolean(String(row?.refresh_token || '').trim())
    }
    const msg = formatGoogleSheetsSyncError(e, { usedOAuth: oauthErrorContext })
    await fail(msg)
    return { ok: false, error: msg }
  }
}
