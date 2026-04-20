/**
 * PostgREST: "Could not find the 'combined_unit_ids' column of 'units' in the schema cache"
 * — колонка есть в коде, но не применена миграция или не перезагружен кэш схемы.
 * Повторяем upsert без перечисленной колонки.
 */
export function parseMissingTableColumn(error, table = 'units') {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ')
  const re = new RegExp(
    `Could not find the '([^']+)' column of '${table}'`,
    'i'
  )
  const m = text.match(re)
  return m ? m[1] : null
}

/**
 * Распознаёт сетевые сбои (Connect Timeout, fetch failed и т.п.) — их имеет смысл ретраить.
 * Бизнес-ошибки (schema cache, unique constraint, row-level RLS и т.п.) — не ретраим.
 */
function isTransientNetworkError(err) {
  if (!err) return false
  const msg = String(err.message || err || '').toLowerCase()
  const code = String(err.code || err.cause?.code || '').toUpperCase()
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || code === 'ECONNRESET' ||
      code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED' || code === 'ABORT_ERR') return true
  return /fetch failed|network|timeout|timed out|socket hang up|abortederror/.test(msg)
}

/**
 * Вызывает supabase-запрос с ретраями при временных сетевых сбоях (Timeweb↔Supabase
 * периодически ловит Connect Timeout). Ретраим и throw-путь, и returned `{ error }`-путь.
 * Бизнес-ошибки пробрасываем сразу на первой попытке.
 */
async function withNetworkRetries(fn, label = 'supabase') {
  const delays = [0, 1500, 3500] // 3 попытки
  let lastErr = null
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]))
    try {
      const res = await fn()
      if (res?.error && isTransientNetworkError(res.error)) {
        lastErr = res.error
        console.warn(`[${label}] attempt ${i+1}/${delays.length} network error:`, res.error.message)
        continue
      }
      return res
    } catch (e) {
      if (!isTransientNetworkError(e)) throw e
      lastErr = e
      console.warn(`[${label}] attempt ${i+1}/${delays.length} threw:`, e?.message || e)
    }
  }
  console.error(`[${label}] gave up after retries:`, lastErr?.message || lastErr)
  return { error: lastErr || new Error('network failure') }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>[]} rows
 * @param {{ onConflict: string }} upsertOptions
 */
export async function upsertUnitsStrippingUnknownColumns(supabase, rows, upsertOptions) {
  if (!rows.length) return
  let batch = rows.map((r) => ({ ...r }))
  for (let attempt = 0; attempt < 30; attempt++) {
    const { error } = await withNetworkRetries(
      () => supabase.from('units').upsert(batch, upsertOptions),
      'upsert.batch'
    )
    if (!error) return
    // Duplicate key in batch — fallback to one-by-one upsert
    if (/duplicate key|unique constraint/i.test(String(error.message || ''))) {
      console.warn('[upsert] duplicate key in batch, falling back to one-by-one upsert')
      for (const row of batch) {
        const { error: rowErr } = await withNetworkRetries(
          () => supabase.from('units').upsert([row], upsertOptions),
          'upsert.row'
        )
        if (rowErr && !/duplicate key|unique constraint/i.test(String(rowErr.message || ''))) {
          console.error('[upsert] row error:', rowErr.message, row)
        }
      }
      return
    }
    const col = parseMissingTableColumn(error, 'units')
    if (!col) throw error
    batch = batch.map((r) => {
      const next = { ...r }
      delete next[col]
      return next
    })
    if (!batch.length || Object.keys(batch[0]).length === 0) {
      throw error
    }
  }
  throw new Error('upsertUnitsStrippingUnknownColumns: schema fallback limit')
}
