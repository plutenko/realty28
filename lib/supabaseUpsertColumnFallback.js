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
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>[]} rows
 * @param {{ onConflict: string }} upsertOptions
 */
export async function upsertUnitsStrippingUnknownColumns(supabase, rows, upsertOptions) {
  if (!rows.length) return
  let batch = rows.map((r) => ({ ...r }))
  for (let attempt = 0; attempt < 30; attempt++) {
    const { error } = await supabase.from('units').upsert(batch, upsertOptions)
    if (!error) return
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
