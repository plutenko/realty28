import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import AdminLayout from '../../components/admin/AdminLayout'
import { supabase } from '../../lib/supabaseClient'

/** Значение sources.type в БД */
const SOURCE_TYPES = [
  { value: 'google_sheets', label: 'Google Таблица' },
  { value: 'profitbase',    label: 'Profitbase' },
  { value: 'macrocrm',      label: 'MacroCRM' },
  { value: 'csv',           label: 'CSV файл' },
]

const SOURCE_TYPE_VALUES = new Set(SOURCE_TYPES.map((x) => x.value))

/** Парсер застройщика (sources.parser_type) только для type === google_sheets */
const DEVELOPER_PARSER_OPTIONS = [
  { value: 'sodruzhestvo', label: 'Содружество' },
  { value: 'default', label: 'Стандартный' },
]

function resolvedParserType(sourceType, developerParser) {
  const t = String(sourceType || '').toLowerCase()
  if (t === 'profitbase') return 'profitbase'
  if (t === 'macrocrm') return 'macrocrm'
  if (t === 'google_sheets') {
    const p = String(developerParser || 'default').toLowerCase()
    return p === 'sodruzhestvo' ? 'sodruzhestvo' : 'default'
  }
  return 'csv'
}

/** Нормализация type из БД для формы (старые google / api; неизвестные и устаревшие → csv). */
function sourceTypeForForm(rowType, parserTypeRaw) {
  const t = String(rowType || '').toLowerCase()
  const pt = String(parserTypeRaw || '').toLowerCase()
  if (t === 'google') {
    const knownSheetParser = [
      'google_sheets',
      'google_sheets_oauth',
      'sodruzhestvo',
      'default',
    ].includes(pt)
    const otherSheetLike = Boolean(pt) && pt !== 'profitbase' && pt !== 'csv'
    if (knownSheetParser || otherSheetLike) return 'google_sheets'
    return 'csv'
  }
  if (t === 'api') return 'csv'
  if (SOURCE_TYPE_VALUES.has(t)) return t
  return 'csv'
}

/** Восстановить «Парсер застройщика» из строки источника. */
function developerParserFromRow(rowType, parserTypeRaw) {
  const t = sourceTypeForForm(rowType, parserTypeRaw)
  if (t !== 'google_sheets') return 'default'
  const pt = String(parserTypeRaw || '').toLowerCase()
  if (pt === 'sodruzhestvo') return 'sodruzhestvo'
  if (['google_sheets', 'google_sheets_oauth'].includes(pt)) return 'sodruzhestvo'
  if (pt === 'default') return 'default'
  if (pt && pt !== 'csv' && pt !== 'profitbase') return 'sodruzhestvo'
  return 'default'
}

function sourceNeedsChessboardGidInUrl(source) {
  const t = String(source?.type || '').toLowerCase()
  if (t === 'google_sheets') return true
  const pt = String(source?.parser_type || '').toLowerCase()
  return t === 'google' && pt && pt !== 'profitbase' && pt !== 'csv'
}

/** Для синка: #gid=… или &sync_sheet=… (внешний Excel с несколькими листами). */
function googleSheetsUrlHasTabSelector(rawUrl) {
  const u = String(rawUrl || '')
  if (/[#&?]gid=\d+/i.test(u)) return true
  try {
    const parsed = new URL(u)
    if (
      parsed.searchParams.get('sync_sheet') ||
      parsed.searchParams.get('sync_tab') ||
      parsed.searchParams.get('sheet')
    ) {
      return true
    }
  } catch {
    if (/\bsync_sheet=/.test(u) || /\bsync_tab=/.test(u) || /[?&]sheet=/.test(u)) return true
  }
  return false
}

function profitbaseAccountId() {
  return process.env.NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID || '20366'
}

function profitbasePbApiKey() {
  return (
    process.env.NEXT_PUBLIC_PROFITBASE_PB_API_KEY ||
    'eea9e12b6f1c86bd226ebf30761e3cd9'
  )
}

const DEFAULT_PB_DOMAIN = 'profitbase.ru'

function parseProfitbaseHouseInput(rawValue) {
  const raw = String(rawValue || '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return raw
  try {
    const u = new URL(raw)
    const q = u.searchParams.get('house_id')
    if (q) return q.trim()
    const parts = u.pathname.split('/').filter(Boolean)
    const hi = parts.indexOf('house')
    if (hi >= 0 && parts[hi + 1]) return parts[hi + 1]
    return raw
  } catch {
    return raw
  }
}

function collectPropertyIdsFromJsonTree(val, seen, out) {
  if (val == null) return
  if (Array.isArray(val)) {
    for (const x of val) collectPropertyIdsFromJsonTree(x, seen, out)
    return
  }
  if (typeof val !== 'object') return
  for (const [k, v] of Object.entries(val)) {
    if (
      (k === 'propertyId' || k === 'property_id') &&
      v != null &&
      /^\d+$/.test(String(v))
    ) {
      const id = String(v)
      if (!seen.has(id)) {
        seen.add(id)
        out.push(id)
      }
    } else {
      collectPropertyIdsFromJsonTree(v, seen, out)
    }
  }
}

function extractPropertyIdsFromSmallGridHtml(html) {
  const raw = String(html || '').trim()
  const ids = []
  const seen = new Set()

  if (
    raw.startsWith('{') ||
    raw.startsWith('[') ||
    raw.includes('"propertyId"') ||
    raw.includes('"property_id"')
  ) {
    try {
      const j = JSON.parse(raw)
      collectPropertyIdsFromJsonTree(j, seen, ids)
      if (ids.length) return ids
    } catch {
      /* не JSON целиком — парсим регэкспами ниже */
    }
  }

  const patterns = [
    /"propertyId"\s*:\s*"?(\d+)"?/gi,
    /"property_id"\s*:\s*"?(\d+)"?/gi,
    /propertyId\s*=\s*["']?(\d+)/gi,
    /data-property-id\s*=\s*["']?(\d+)/gi,
  ]
  for (const re of patterns) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(raw)) !== null) {
      const id = m[1]
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
  }
  return ids
}

function extractPropertiesArrayFromCrmJson(json) {
  if (Array.isArray(json)) return json
  if (
    json?.data &&
    typeof json.data === 'object' &&
    !Array.isArray(json.data) &&
    (json.data.id != null || json.data.propertyId != null)
  ) {
    return [json.data]
  }
  const candidates = [
    json?.data,
    json?.items,
    json?.properties,
    json?.result,
    json?.content,
    json?.list,
    json?.rows,
    json?.data?.properties,
    json?.data?.items,
    json?.data?.data,
  ]
  for (const c of candidates) {
    if (Array.isArray(c)) return c
    if (c && typeof c === 'object') {
      if (Array.isArray(c.items)) return c.items
      if (Array.isArray(c.data)) return c.data
      if (Array.isArray(c.properties)) return c.properties
    }
  }
  return []
}

function getCrmRowExternalId(item) {
  const id =
    item?.id ?? item?.propertyId ?? item?.property_id ?? item?.property?.id ?? null
  return id != null ? String(id) : ''
}

function mapProfitbasePropertyDetail(json, externalId, source) {
  let d =
    json?.data?.property ??
    json?.data ??
    json?.property ??
    json?.result ??
    json
  if (Array.isArray(d)) d = d[0]
  if (!d || typeof d !== 'object') return null

  const number =
    d.number ?? d.flatNumber ?? d.apartmentNumber ?? d.apartment_no ?? null
  const floor =
    d.floor ??
    d.floorNumber ??
    d.storey ??
    d.storeyNumber ??
    d.level ??
    d.floor_number ??
    d.floorNo ??
    null
  const rooms =
    d.rooms_amount ??
    d.roomsAmount ??
    d.roomCount ??
    d.rooms ??
    d.roomsCount ??
    null
  const area =
    d.area?.area_total ??
    d.areaTotal ??
    d.area_total ??
    (typeof d.area === 'number' ? d.area : null) ??
    d.square ??
    null
  const priceRaw =
    d.price?.value ?? d.price?.amount ?? d.cost ?? d.price ?? null
  const price = priceRaw != null ? Number(priceRaw) : 0

  const st = String(d.status ?? d.availability ?? '').toUpperCase()
  let status = 'available'
  if (st === 'SOLD' || st === 'ПРОДАНА' || st === 'РЕАЛИЗОВАНО') status = 'sold'
  else if (st === 'RESERVED' || st === 'BOOKED' || st === 'БРОНЬ')
    status = 'reserved'

  return {
    source_id: source.id,
    building_id: source.building_id,
    external_id: String(externalId),
    number,
    floor,
    rooms,
    area: area != null ? Number(area) : null,
    price,
    status,
  }
}

function formatDate(dt) {
  if (!dt) return '—'
  const t = new Date(dt)
  if (Number.isNaN(t.getTime())) return '—'
  return t.toLocaleString('ru-RU')
}

function formatSyncSummaryLine(r) {
  const datePart = formatDate(r?.last_sync_at)
  const n = r?.last_sync_count
  const hasCount = n != null && Number.isFinite(Number(n))
  const line = hasCount ? `${datePart} · ${Number(n)} кв.` : datePart
  return line
}

function sourceTypeBadgeClass(t) {
  const v = String(t || '').toLowerCase()
  if (v === 'google_sheets' || v === 'google') return 'bg-teal-600/25 text-teal-200 ring-1 ring-teal-500/40'
  if (v === 'profitbase') return 'bg-blue-600/25 text-blue-200 ring-1 ring-blue-500/40'
  return 'bg-slate-700/80 text-slate-300 ring-1 ring-slate-600/50'
}

function sourceTypeLabel(t) {
  const v = String(t || '').toLowerCase()
  const hit = SOURCE_TYPES.find((x) => x.value === v)
  if (hit) return hit.label
  if (v === 'google') return 'Google Таблица'
  if (v === 'api') return 'CSV файл'
  if (!v) return '—'
  return t
}

function developerParserBadgeClass(pt) {
  const v = String(pt || '').toLowerCase()
  if (v === 'sodruzhestvo') return 'bg-violet-600/25 text-violet-200 ring-1 ring-violet-500/40'
  if (v === 'default') return 'bg-slate-700/80 text-slate-300 ring-1 ring-slate-600/50'
  return 'bg-slate-700/80 text-slate-300 ring-1 ring-slate-600/50'
}

function developerParserLabel(pt) {
  const v = String(pt || '').toLowerCase()
  const hit = DEVELOPER_PARSER_OPTIONS.find((x) => x.value === v)
  if (hit) return hit.label
  if (['google_sheets', 'google_sheets_oauth'].includes(v)) return 'Содружество'
  if (v && v !== 'csv' && v !== 'profitbase') return 'Содружество'
  if (!v) return '—'
  return pt
}

/** Сообщение после редиректа с /api/auth/google-sheets/callback (?google_oauth=…) */
function messageForGoogleOAuthParam(code) {
  const c = String(code || '')
  switch (c) {
    case 'denied':
      return 'Доступ отменён в окне Google.'
    case 'no_code':
      return 'Google не вернул код авторизации. Нажмите «Подключить Google» ещё раз.'
    case 'config':
      return 'На сервере не заданы GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET или GOOGLE_OAUTH_REDIRECT_URI. Добавьте в .env.local и перезапустите dev-сервер (npm run dev).'
    case 'no_supabase':
      return 'Нет доступа к Supabase с service role: проверьте SUPABASE_SERVICE_ROLE_KEY и NEXT_PUBLIC_SUPABASE_URL в .env.local.'
    case 'db':
      return 'Не удалось сохранить токены: таблица google_sheets_oauth отсутствует или недоступна. Выполните миграцию 025_google_sheets_oauth.sql в Supabase.'
    case 'redirect_mismatch':
      return 'Redirect URI не совпадает с настройками Google Cloud. В консоли (OAuth client → Authorized redirect URIs) добавьте значение из GOOGLE_OAUTH_REDIRECT_URI посимвольно: тот же протокол, хост, порт и путь /api/auth/google-sheets/callback.'
    case 'invalid_grant':
      return 'Токен Google устарел или отозван. Нажмите «Переподключить» рядом со статусом Google и пройдите авторизацию заново.'
    case 'token':
      return 'Обмен кода на токен не удался. Проверьте GOOGLE_OAUTH_CLIENT_SECRET, совпадение GOOGLE_OAUTH_REDIRECT_URI с Google Cloud и перезапустите dev-сервер после правок .env.'
    case 'no_refresh':
      return 'Google не выдал долгосрочный refresh_token. Откройте myaccount.google.com → Безопасность → доступ сторонних приложений, удалите это приложение и снова нажмите «Подключить Google».'
    default:
      return `Подключение Google не завершено (код: ${c || 'unknown'}). Смотрите сообщение в терминале, где запущен npm run dev.`
  }
}

export default function AdminSourcesPage() {
  const router = useRouter()
  const [rows, setRows] = useState([])
  const [complexes, setComplexes] = useState([])
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncingSourceId, setSyncingSourceId] = useState('')
  const [msg, setMsg] = useState('')
  const [syncResult, setSyncResult] = useState(null)
  /** null = loading; whether personal Google OAuth has refresh_token in DB (via /api/auth/google-sheets/status). */
  const [googleSheetsConnected, setGoogleSheetsConnected] = useState(null)
  const [pbSettings, setPbSettings] = useState({
    account_id: '',
    site_widget_referer: '',
    pb_api_key: '',
    pb_domain: DEFAULT_PB_DOMAIN,
  })
  const [pbSettingsLoaded, setPbSettingsLoaded] = useState(false)
  const [pbDetecting, setPbDetecting] = useState(false)
  const [pbDetectMsg, setPbDetectMsg] = useState('')

  const [editId, setEditId] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState('csv')
  const [url, setUrl] = useState('')
  const [complexId, setComplexId] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [developerParser, setDeveloperParser] = useState('default')
  const [sheetName, setSheetName] = useState('')
  const [sheetList, setSheetList] = useState([])
  const [sheetsLoading, setSheetsLoading] = useState(false)

  async function load() {
    if (!supabase) return
    setBusy(true)
    // Не сбрасываем setMsg здесь: load() вызывается после синка (finally) и
    // иначе мгновенно стирается текст «Успешно» / ошибка — для пользователя «ничего не происходит».
    const c = await supabase
      .from('complexes')
      .select(
        `
        id,
        name,
        developer_id,
        developers ( id, name ),
        buildings (
          id,
          name
        )
      `
      )
      .order('name', { ascending: true })
    let s = await supabase
      .from('sources')
      .select(
        'id, name, type, url, building_id, last_sync_at, parser_type, last_sync_count, last_sync_error, pb_account_id, pb_referer, pb_api_key, pb_domain'
      )
      .order('name', { ascending: true })

    if (s.error && /parser_type|last_sync_count|last_sync_error/i.test(String(s.error.message || ''))) {
      s = await supabase
        .from('sources')
        .select('id, name, type, url, building_id, last_sync_at')
        .order('name', { ascending: true })
      if (!s.error) {
        setMsg(
          'Таблица sources без колонок parser_type / last_sync_*. Выполните миграцию 020_sources_parser_sheet_sync_meta.sql.'
        )
      }
    }

    if (s.error && /building_id/i.test(String(s.error.message || ''))) {
      s = await supabase
        .from('sources')
        .select('id, name, type, url, last_sync_at')
        .order('name', { ascending: true })
      if (!s.error) {
        setMsg(
          'Таблица sources без building_id. Выполните миграцию 008_sources_building_id.sql.'
        )
      }
    }
    setBusy(false)
    if (s.error) setMsg(s.error.message)
    if (c.error) setMsg(c.error.message)
    setRows(s.error ? [] : s.data ?? [])
    setComplexes(c.data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadGoogleOAuthStatus() {
      try {
        const r = await fetch('/api/auth/google-sheets/status')
        const j = await r.json()
        if (!cancelled) setGoogleSheetsConnected(Boolean(j.connected))
      } catch {
        if (!cancelled) setGoogleSheetsConnected(false)
      }
    }
    loadGoogleOAuthStatus()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!router.isReady) return
    const raw = router.query.google_oauth
    const o = Array.isArray(raw) ? raw[0] : raw
    if (o == null || o === '') return

    if (o === 'ok') {
      setMsg('Google аккаунт подключён для чтения таблиц (ссылка с доступом).')
      fetch('/api/auth/google-sheets/status')
        .then((r) => r.json())
        .then((j) => setGoogleSheetsConnected(Boolean(j.connected)))
        .catch(() => setGoogleSheetsConnected(false))
    } else {
      setMsg(messageForGoogleOAuthParam(o))
    }
    router.replace('/admin/sources', undefined, { shallow: true }).catch(() => {})
  }, [router.isReady, router.query.google_oauth, router])

  useEffect(() => {
    async function loadProfitbaseSettings() {
      if (!supabase) return
      const { data, error } = await supabase
        .from('profitbase_settings')
        .select('account_id, site_widget_referer, pb_api_key, pb_domain')
        .eq('id', 1)
        .maybeSingle()
      if (error) {
        // Если миграция не применена — просто показываем поля пустыми
        setPbSettingsLoaded(true)
        return
      }
      setPbSettings({
        account_id: data?.account_id ?? '',
        site_widget_referer: data?.site_widget_referer ?? '',
        pb_api_key: data?.pb_api_key ?? '',
        pb_domain: data?.pb_domain ?? DEFAULT_PB_DOMAIN,
      })
      setPbSettingsLoaded(true)
    }
    loadProfitbaseSettings()
  }, [])

  useEffect(() => {
    const row = rows.find((r) => r.id === editId)
    if (!row) {
      setName('')
      setType('csv')
      setUrl('')
      setDeveloperParser('default')
      setSheetName('')
      setSheetList([])
      const firstComplexId = complexes[0]?.id || ''
      setComplexId(firstComplexId)
      const firstBuildingId =
        complexes.find((c) => c.id === firstComplexId)?.buildings?.[0]?.id || ''
      setBuildingId(firstBuildingId)
      return
    }
    setName(row.name ?? '')
    setType(sourceTypeForForm(row.type, row.parser_type))
    setUrl(row.url ?? '')
    setDeveloperParser(developerParserFromRow(row.type, row.parser_type))
    setSheetName(row.sheet_name ?? '')
    setSheetList([])
    // Per-source Profitbase settings (fallback to global)
    if (row.pb_account_id || row.pb_referer) {
      setPbSettings({
        account_id: row.pb_account_id ?? '',
        site_widget_referer: row.pb_referer ?? '',
        pb_api_key: row.pb_api_key ?? '',
        pb_domain: row.pb_domain ?? DEFAULT_PB_DOMAIN,
      })
    }
    const bId = row.building_id ?? ''
    setBuildingId(bId)
    const ownerComplex =
      complexes.find((cx) => (cx.buildings ?? []).some((b) => b.id === bId)) || null
    setComplexId(ownerComplex?.id ?? '')
  }, [editId, rows, complexes])

  async function fetchSheetList() {
    const trimmed = url.trim()
    if (!trimmed) return
    setSheetsLoading(true)
    setSheetList([])
    try {
      const res = await fetch('/api/list-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setSheetList(data.sheets || [])
      if (!sheetName && data.sheets?.length) {
        setSheetName(data.sheets[0].name)
      }
    } catch (e) {
      setMsg(e?.message || 'Не удалось загрузить листы')
    } finally {
      setSheetsLoading(false)
    }
  }

  const buildingsBySelectedComplex = useMemo(() => {
    const c = complexes.find((x) => x.id === complexId)
    return c?.buildings ?? []
  }, [complexes, complexId])

  const canSubmit = useMemo(
    () => Boolean(buildingId) && Boolean(url.trim()),
    [url, buildingId]
  )

  async function onSubmit(e) {
    e.preventDefault()
    if (!supabase || !canSubmit) return
    setBusy(true)
    setMsg('')
    const typeNorm = String(type || 'csv').toLowerCase()
    const typeToSave = SOURCE_TYPE_VALUES.has(typeNorm) ? typeNorm : 'csv'
    const payload = {
      name: name.trim() || null,
      type: typeToSave,
      url: url.trim(),
      building_id: buildingId || null,
      parser_type: resolvedParserType(typeToSave, developerParser),
      sheet_name: typeToSave === 'google_sheets' && sheetName ? sheetName.trim() : null,
    }
    // Per-source Profitbase settings
    if (typeToSave === 'profitbase') {
      payload.pb_account_id = String(pbSettings.account_id || '').trim() || null
      payload.pb_referer = String(pbSettings.site_widget_referer || '').trim() || null
      payload.pb_api_key = String(pbSettings.pb_api_key || '').trim() || null
      payload.pb_domain = String(pbSettings.pb_domain || DEFAULT_PB_DOMAIN).replace(/^\.+/, '').trim() || DEFAULT_PB_DOMAIN
    }
    const q = editId
      ? supabase.from('sources').update(payload).eq('id', editId)
      : supabase.from('sources').insert(payload)
    const { error } = await q
    setBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    setEditId('')
    await load()
  }

  async function onDelete(id) {
    if (!supabase) return
    const okFirst = confirm('Удалить источник синхронизации?')
    if (!okFirst) return
    const okSecond = confirm(
      'Подтвердите удаление: источник будет удален, но ранее загруженные квартиры останутся в базе.'
    )
    if (!okSecond) return
    const { error } = await supabase.from('sources').delete().eq('id', id)
    if (error) {
      setMsg(error.message)
      return
    }
    if (editId === id) setEditId('')
    await load()
  }

  const runProfitbaseSync = async (source) => {
    const showSyncError = (text) => {
      setMsg(text)
      alert(`Ошибка синхронизации\n\n${text}`)
    }

    try {
      const houseId = parseProfitbaseHouseInput(source?.url)
      if (!houseId) {
        showSyncError('Укажите house_id (дом) в поле источника.')
        return
      }

      /* Запросы к Profitbase идут через /api/profitbase/* (сервер), иначе браузер даёт CORS: Failed to fetch */
      const crmProxyUrl = `/api/profitbase/crm-properties?houseId=${encodeURIComponent(houseId)}`

      let crmRes = { ok: false, status: 0 }
      let crmText = ''
      let units = []

      crmRes = await fetch(crmProxyUrl, { method: 'GET' })
      crmText = await crmRes.text()
      console.log('PROFITBASE RESPONSE (proxy):', crmRes.status, crmText.slice(0, 600))

      if (crmRes.ok && crmText.trim()) {
        try {
          const crmJson = JSON.parse(crmText)
          const rows = extractPropertiesArrayFromCrmJson(crmJson)
          units = rows
            .map((item) => {
              const ext = getCrmRowExternalId(item)
              if (!ext) return null
              return mapProfitbasePropertyDetail({ data: item }, ext, source)
            })
            .filter(
              (u) =>
                u &&
                u.building_id &&
                u.source_id &&
                (Number.isFinite(Number(u.floor)) || u.external_id)
            )
        } catch (parseErr) {
          console.warn('PROFITBASE CRM list JSON.parse', parseErr?.message, crmText.slice(0, 400))
        }
      } else if (!crmRes.ok && crmText) {
        try {
          const ej = JSON.parse(crmText)
          if (ej?.error) crmText = typeof ej.error === 'string' ? ej.error : JSON.stringify(ej.error)
          if (ej?.detail) crmText = `${crmText} ${ej.detail}`.trim()
        } catch {
          /* keep text */
        }
      }

      if (!units.length) {
        const baseGrid = {
          houseId,
          accountId:
            String(pbSettings.account_id || '').trim() || profitbaseAccountId(),
          pbApiKey:
            String(pbSettings.pb_api_key || '').trim() || profitbasePbApiKey(),
        }
        let gridHtml = ''
        let gridRes = await fetch(
          `/api/profitbase/small-grid?${new URLSearchParams({
            ...baseGrid,
            filter: 'property.status:AVAILABLE',
          })}`,
          { method: 'GET' }
        )
        gridHtml = await gridRes.text()
        console.log('PROFITBASE GRID (fallback):', gridHtml.slice(0, 800))

        let ids = extractPropertyIdsFromSmallGridHtml(gridHtml)
        if (!ids.length) {
          gridRes = await fetch(
            `/api/profitbase/small-grid?${new URLSearchParams({
              ...baseGrid,
              filter: '__none__',
            })}`,
            { method: 'GET' }
          )
          gridHtml = await gridRes.text()
          console.log('PROFITBASE GRID (no filter):', gridHtml.slice(0, 800))
          ids = extractPropertyIdsFromSmallGridHtml(gridHtml)
        }
        console.log('PROFITBASE IDS:', ids.length)

        if (!ids.length) {
          const snippet = (crmText || '').replace(/\s+/g, ' ').slice(0, 220)
          throw new Error(
            `Не получили список квартир. HTTP ${crmRes.status || '—'}${snippet ? `: ${snippet}` : ''}. В .env.local: NEXT_PUBLIC_PROFITBASE_ACCOUNT_ID и PROFITBASE_SITE_WIDGET_REFERER (URL родительского сайта со виджетом, как в коде Tilda) для авто-JWT через SSO; опционально PROFITBASE_CRM_TOKEN; pbApiKey в NEXT_PUBLIC_PROFITBASE_PB_API_KEY. Проверьте House ID.`
          )
        }

        const BATCH = 5
        for (let i = 0; i < ids.length; i += BATCH) {
          const slice = ids.slice(i, i + BATCH)
          const batch = await Promise.all(
            slice.map(async (propertyId) => {
              const pr = await fetch(
                `/api/profitbase/crm-property?propertyId=${encodeURIComponent(propertyId)}`,
                { method: 'GET' }
              )
              const pt = await pr.text()
              if (!pr.ok) {
                console.warn('PROFITBASE crm/property', propertyId, pr.status, pt.slice(0, 200))
                return null
              }
              let pj = null
              try {
                pj = JSON.parse(pt)
              } catch {
                console.warn('PROFITBASE crm/property not JSON', propertyId)
                return null
              }
              return mapProfitbasePropertyDetail(pj, propertyId, source)
            })
          )
          for (const u of batch) {
            if (
              u &&
              u.building_id &&
              u.source_id &&
              (Number.isFinite(Number(u.floor)) || u.external_id)
            ) {
              units.push(u)
            }
          }
        }
      }

      if (!units.length) {
        const snippet = (crmText || '').replace(/\s+/g, ' ').slice(0, 220)
        throw new Error(
          `Нет строк для импорта (CRM и fallback). Последний ответ CRM: ${crmRes.status || '—'}${snippet ? ` — ${snippet}` : ''}`
        )
      }

      const saveRes = await fetch('/api/import-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(units),
      })

      let saveBody = {}
      try {
        saveBody = await saveRes.json()
      } catch {
        saveBody = {}
      }
      if (!saveRes.ok) {
        throw new Error(
          typeof saveBody?.error === 'string'
            ? saveBody.error
            : `import-units ${saveRes.status}: ${JSON.stringify(saveBody).slice(0, 300)}`
        )
      }

      alert('Синхронизация успешна')
      setMsg(
        `${source.name || source.id}: импортировано квартир — ${Number(saveBody?.count ?? units.length)}`
      )
    } catch (e) {
      console.error(e)
      const detail =
        e?.message ||
        (typeof e === 'string' ? e : 'Неизвестная ошибка (см. консоль браузера)')
      showSyncError(detail)
    }
  }

  async function runSyncNow() {
    setSyncing(true)
    setMsg('')
    setSyncResult(null)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setMsg(body?.error || 'Ошибка синхронизации')
      } else {
        setSyncResult(body)
        setMsg(
          body.failed > 0
            ? `Синхронизация завершена с ошибками: ${body.failed} из ${body.total}.`
            : `Синхронизация завершена успешно: ${body.total} источников (в т.ч. Profitbase — JWT и v4 обновляются на сервере).`
        )
      }
    } catch (e) {
      setMsg(e?.message || 'Ошибка сети')
    } finally {
      setSyncing(false)
      await load()
    }
  }

  async function runSyncOne(source) {
    if (!source?.building_id) {
      const t = 'У этого источника не выбран дом (building). Откройте «Изм.», укажите ЖК и корпус, сохраните — затем снова «Синк».'
      setMsg(t)
      alert(t)
      return
    }
    if (String(source?.type || '').toLowerCase() === 'profitbase') {
      const hid = parseProfitbaseHouseInput(source?.url)
      if (!hid) {
        const t =
          'Для Profitbase в поле House ID должно быть число дома (house_id). Откройте «Изм.» и проверьте поле.'
        setMsg(t)
        alert(t)
        return
      }
    }
    if (
      sourceNeedsChessboardGidInUrl(source) &&
      !googleSheetsUrlHasTabSelector(String(source?.url || ''))
    ) {
      console.warn('[sources] URL без #gid / sync_sheet — синк возьмёт первый лист по умолчанию.')
    }
    setSyncing(true)
    setSyncingSourceId(source.id)
    setMsg('')
    try {
      const res = await fetch(`/api/sync?id=${encodeURIComponent(source.id)}`, {
        method: 'POST',
      })
      const text = await res.text()
      let body = {}
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        setMsg(`Ответ сервера не JSON (HTTP ${res.status}). ${text.slice(0, 200)}`)
        alert(String(text).slice(0, 400))
        return
      }
      if (!res.ok) {
        const errText = body?.error || body?.message || `Ошибка синхронизации (${res.status})`
        setMsg(errText)
        alert(errText)
        return
      }
      const inserted = Number(body?.results?.[0]?.inserted ?? 0)
      const okRow = body?.results?.[0]
      const rowErr = okRow && okRow.ok === false ? okRow.error : null
      if (rowErr) {
        setMsg(rowErr)
        alert(rowErr)
        return
      }
      const dbg = okRow?.debug
      const dbgStr = dbg ? ` | Статусы: ${JSON.stringify(dbg.statusCounts)} из ${dbg.total}` : ` | (no debug in response, keys: ${JSON.stringify(Object.keys(okRow || {}))})`
      setMsg(`Успешно: ${source.name || source.id}, записано квартир (upsert): ${inserted}${dbgStr}`)
      setSyncResult(body)
    } catch (e) {
      const t = e?.message || 'Ошибка сети'
      setMsg(t)
      alert(t)
    } finally {
      setSyncing(false)
      setSyncingSourceId('')
      await load()
    }
  }

  return (
    <AdminLayout title="Источники синхронизации">
      {msg ? (
        <p className="mb-4 rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-200">{msg}</p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
        {googleSheetsConnected === null ? (
          <span className="text-xs text-slate-500">Проверка Google…</span>
        ) : googleSheetsConnected ? (
          <>
            <span className="text-sm font-medium text-emerald-400">Google подключён ✓</span>
            <a
              href="/api/auth/google-sheets/start"
              className="inline-flex rounded-xl border border-slate-600 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              Переподключить
            </a>
          </>
        ) : (
          <>
            <span className="text-xs text-slate-500">
              Личный Google — чтение таблиц, доступных по ссылке вашему аккаунту
            </span>
            <a
              href="/api/auth/google-sheets/start"
              className="inline-flex rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-100"
            >
              Подключить Google
            </a>
          </>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runSyncNow}
          disabled={syncing}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {syncing ? 'Синхронизация...' : 'Синхронизировать сейчас'}
        </button>
        <span className="text-xs text-slate-400">
          Cron Vercel: каждый день в 06:00 UTC. Кнопка «Синк» в строке — синхронизация только этого источника;
          «Синхронизировать сейчас» — все источники, включая Profitbase.
        </span>
      </div>

      {syncResult?.results?.length ? (
        <div className="mb-6 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-900/80">
              <tr>
                <th className="p-2">Источник</th>
                <th className="p-2">Тип</th>
                <th className="p-2">Статус</th>
                <th className="p-2">Добавлено</th>
                <th className="p-2">Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {syncResult.results.map((r, idx) => (
                <tr key={`${r.sourceId}-${idx}`} className="border-b border-slate-800/70">
                  <td className="p-2">{r.name || r.sourceId}</td>
                  <td className="p-2">{r.type || '—'}</td>
                  <td className="p-2">
                    {r.skipped ? (
                      <span className="text-amber-300">Пропуск</span>
                    ) : r.ok ? (
                      'OK'
                    ) : (
                      'Ошибка'
                    )}
                  </td>
                  <td className="p-2">{r.skipped ? '—' : r.inserted ?? 0}</td>
                  <td
                    className={`p-2 ${r.skipped ? 'text-amber-200' : r.error ? 'text-rose-300' : 'text-slate-400'}`}
                  >
                    {r.skipped
                      ? r.skipNote || 'Используйте «Синк» в строке источника.'
                      : r.error || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="mb-8 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <h2 className="text-lg font-semibold">
          {editId ? 'Редактирование источника' : 'Новый источник'}
        </h2>
        {editId ? (
          <button
            type="button"
            onClick={() => setEditId('')}
            className="text-sm text-slate-400 hover:text-white"
          >
            Создать новый
          </button>
        ) : null}

        <div>
          <label className="block text-xs text-slate-400">ЖК</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={complexId}
            onChange={(e) => {
              const id = e.target.value
              setComplexId(id)
              const next = complexes.find((x) => x.id === id)?.buildings?.[0]?.id || ''
              setBuildingId(next)
            }}
          >
            <option value="">— не выбрано —</option>
            {complexes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400">Дом</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
            required
          >
            <option value="">— не выбрано —</option>
            {buildingsBySelectedComplex.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400">Тип источника</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {type === 'google_sheets' ? (
          <div>
            <label className="block text-xs text-slate-400">Парсер застройщика</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={developerParser}
              onChange={(e) => setDeveloperParser(e.target.value)}
            >
              {DEVELOPER_PARSER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {type === 'profitbase' ? (
          <div>
            <label className="block text-xs text-slate-400">URL шахматки (с сайта застройщика)</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                placeholder="Вставьте ссылку на шахматку, например: https://сайт.рф/#/catalog/house/103325/smallGrid"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
              <button
                type="button"
                disabled={!url || pbDetecting}
                onClick={async () => {
                  setPbDetecting(true)
                  setPbDetectMsg('')
                  try {
                    const resp = await fetch(`/api/profitbase/detect?url=${encodeURIComponent(url)}`)
                    const data = await resp.json()
                    const found = []
                    if (data.houseId) {
                      setUrl(data.houseId)
                      found.push(`House ID: ${data.houseId}`)
                    }
                    if (data.referer && !pbSettings.site_widget_referer) {
                      setPbSettings((p) => ({ ...p, site_widget_referer: data.referer }))
                      found.push(`Referer: ${data.referer}`)
                    }
                    if (data.account_id && !pbSettings.account_id) {
                      setPbSettings((p) => ({ ...p, account_id: data.account_id }))
                      found.push(`Account ID: ${data.account_id}`)
                    }
                    if (data.pb_api_key && !pbSettings.pb_api_key) {
                      setPbSettings((p) => ({ ...p, pb_api_key: data.pb_api_key }))
                      found.push(`API Key: найден`)
                    }
                    const debugStr = data.debug?.length ? ` | ${data.debug.join('; ')}` : ''
                    setPbDetectMsg(found.length ? `Найдено: ${found.join(', ')}${debugStr}` : `Не удалось определить параметры автоматически${debugStr}`)
                  } catch (e) {
                    setPbDetectMsg(`Ошибка при определении параметров: ${e.message}`)
                  }
                  setPbDetecting(false)
                }}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
              >
                {pbDetecting ? 'Определяю...' : 'Определить'}
              </button>
            </div>
            {pbDetectMsg && (
              <p className={`mt-2 text-xs ${pbDetectMsg.startsWith('Найдено') ? 'text-green-400' : 'text-amber-400'}`}>
                {pbDetectMsg}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Вставьте полную ссылку на шахматку — House ID, Referer и Account ID определятся автоматически. Или введите только House ID (число).
            </p>

            <details className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-200 hover:text-white">
                Настройки Profitbase (дополнительно)
              </summary>
              <div className="px-4 pb-4 pt-2">
                <p className="mb-3 text-xs text-slate-500">
                  Эти поля обычно определяются автоматически. Измените только если синхронизация не работает.
                </p>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs text-slate-400">Account ID</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                      value={pbSettings.account_id}
                      onChange={(e) =>
                        setPbSettings((p) => ({ ...p, account_id: e.target.value }))
                      }
                      placeholder="например: 20366"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400">pbDomain</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                      value={pbSettings.pb_domain}
                      onChange={(e) =>
                        setPbSettings((p) => ({ ...p, pb_domain: e.target.value }))
                      }
                      placeholder="profitbase.ru"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-slate-400">
                      Site widget referer (URL сайта застройщика)
                    </label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                      value={pbSettings.site_widget_referer}
                      onChange={(e) =>
                        setPbSettings((p) => ({
                          ...p,
                          site_widget_referer: e.target.value,
                        }))
                      }
                      placeholder="например: http://megatek-sz.ru"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-slate-400">pbApiKey (опционально)</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                      value={pbSettings.pb_api_key}
                      onChange={(e) =>
                        setPbSettings((p) => ({ ...p, pb_api_key: e.target.value }))
                      }
                      placeholder="например: eea9e12..."
                    />
                  </div>
                </div>

                {!pbSettingsLoaded ? (
                  <p className="mt-3 text-xs text-slate-500">Загрузка настроек…</p>
                ) : null}
              </div>
            </details>
          </div>
        ) : type === 'macrocrm' ? (
          (() => {
            const [macroDomain, macroHouseId] = (() => {
              const raw = String(url || '').trim()
              if (!raw) return ['', '']
              if (raw.includes('|')) {
                const [d, h] = raw.split('|', 2).map((s) => s.trim())
                return [d, h]
              }
              if (/^\d+$/.test(raw)) return ['', raw]
              return [raw, '']
            })()
            const joinUrl = (d, h) => {
              const dd = (d || '').trim()
              const hh = (h || '').trim()
              if (!dd && !hh) return ''
              if (!dd) return hh
              return `${dd}|${hh}`
            }
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400">Домен виджета</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                    value={macroDomain}
                    onChange={(e) => setUrl(joinUrl(e.target.value, macroHouseId))}
                    placeholder="ленинград28.рф"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Если пусто — используется <code className="text-slate-200">ленинград28.рф</code>.
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-slate-400">House ID</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                    value={macroHouseId}
                    onChange={(e) => setUrl(joinUrl(macroDomain, e.target.value.replace(/\D+/g, '')))}
                    required
                    placeholder="8730378"
                    inputMode="numeric"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Число дома из виджета MacroCRM (api.macroserver.ru).
                  </p>
                </div>
              </div>
            )
          })()
        ) : (
          <div>
            <label className="block text-xs text-slate-400">URL</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              placeholder={
                type === 'google_sheets'
                  ? 'Откройте нужный лист в таблице и скопируйте URL (с #gid=…)'
                  : 'https://...'
              }
            />
            {type === 'google_sheets' ? (
              /[#&?]gid=\d+/i.test(url) ? (
                <p className="mt-2 text-xs text-emerald-400">
                  Лист определён по #gid из URL
                </p>
              ) : (
                <div className="mt-2 flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-slate-400">Лист (нет #gid в URL)</label>
                    {sheetList.length > 0 ? (
                      <select
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                        value={sheetName}
                        onChange={(e) => setSheetName(e.target.value)}
                      >
                        <option value="">— авто (первый лист) —</option>
                        {sheetList.map((s) => (
                          <option key={s.index} value={s.name}>
                            {s.index}: {s.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                        value={sheetName}
                        onChange={(e) => setSheetName(e.target.value)}
                        placeholder={sheetsLoading ? 'Загрузка…' : 'Нажмите «Загрузить листы»'}
                        readOnly={sheetsLoading}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={sheetsLoading || !url.trim()}
                    onClick={fetchSheetList}
                    className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                  >
                    {sheetsLoading ? 'Загрузка…' : 'Загрузить листы'}
                  </button>
                </div>
              )
            ) : null}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !canSubmit}
          className="rounded-xl bg-blue-600 px-6 py-2 font-medium text-white disabled:opacity-50"
        >
          {editId ? 'Сохранить' : 'Создать'}
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900/80">
            <tr>
              <th className="p-3">ЖК / Дом</th>
              <th className="p-3">Источник</th>
              <th className="p-3">URL</th>
              <th className="p-3">Парсер</th>
              <th className="p-3">Последняя синхронизация</th>
              <th className="w-28 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td className="p-3 text-slate-400" colSpan={6}>
                  Загрузка...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-400" colSpan={6}>
                  Источников пока нет
                </td>
              </tr>
            ) : (
              (() => {
                const enriched = rows.map((r) => {
                  const ownerComplex =
                    complexes.find((cx) =>
                      (cx.buildings ?? []).some((b) => b.id === r.building_id)
                    ) || null
                  const ownerBuilding =
                    ownerComplex?.buildings?.find((b) => b.id === r.building_id) || null
                  const devName = ownerComplex?.developers?.name || '— без застройщика —'
                  return { r, ownerComplex, ownerBuilding, devName }
                })
                const byDev = new Map()
                for (const e of enriched) {
                  if (!byDev.has(e.devName)) byDev.set(e.devName, [])
                  byDev.get(e.devName).push(e)
                }
                const devNames = [...byDev.keys()].sort((a, b) =>
                  a.localeCompare(b, 'ru')
                )
                const flat = []
                for (const dev of devNames) {
                  flat.push({ __group: dev, count: byDev.get(dev).length })
                  const items = byDev
                    .get(dev)
                    .slice()
                    .sort((x, y) => {
                      const an = `${x.ownerComplex?.name || ''} · ${x.ownerBuilding?.name || ''}`
                      const bn = `${y.ownerComplex?.name || ''} · ${y.ownerBuilding?.name || ''}`
                      return an.localeCompare(bn, 'ru')
                    })
                  for (const it of items) flat.push(it)
                }
                return flat.map((entry) => {
                  if (entry.__group) {
                    return (
                      <tr key={`g-${entry.__group}`} className="bg-slate-900/60">
                        <td
                          colSpan={6}
                          className="px-3 py-2 text-sm font-semibold text-amber-400"
                        >
                          {entry.__group}
                          <span className="ml-2 text-amber-400/60">
                            · {entry.count}
                          </span>
                        </td>
                      </tr>
                    )
                  }
                  const { r, ownerComplex, ownerBuilding } = entry
                  const displaySourceType = sourceTypeForForm(r.type, r.parser_type)
                  const showDeveloperParserCol = displaySourceType === 'google_sheets'
                  return (
                <tr key={r.id} className="border-b border-slate-800/80">
                  <td className="p-3 font-medium">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={syncing}
                        onClick={() => runSyncOne(r)}
                        title="Синхронизировать"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40 disabled:cursor-not-allowed disabled:opacity-40 transition"
                      >
                        {syncingSourceId === r.id ? (
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
                        ) : (
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
                        )}
                      </button>
                      <span>{ownerComplex?.name || '—'} · {ownerBuilding?.name || '—'}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${sourceTypeBadgeClass(displaySourceType)}`}
                    >
                      {sourceTypeLabel(displaySourceType)}
                    </span>
                  </td>
                  <td className="max-w-xs truncate p-3 text-xs text-slate-300">
                    {r.type === 'profitbase'
                      ? `house_id: ${r.url || '—'}`
                      : r.url}
                  </td>
                  <td className="p-3">
                    {showDeveloperParserCol ? (
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${developerParserBadgeClass(r.parser_type)}`}
                      >
                        {developerParserLabel(r.parser_type)}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="p-3 text-xs text-slate-400">
                    <div>{formatSyncSummaryLine(r)}</div>
                    {r.last_sync_error ? (
                      <div className="mt-1 text-[11px] text-rose-400">{String(r.last_sync_error)}</div>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => setEditId(r.id)}
                      className="mr-2 text-blue-400 hover:underline"
                    >
                      Изм.
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(r.id)}
                      className="text-rose-400 hover:underline"
                    >
                      Уд.
                    </button>
                  </td>
                </tr>
                  )
                })
              })()
            )}
          </tbody>
        </table>
      </div>

    </AdminLayout>
  )
}

