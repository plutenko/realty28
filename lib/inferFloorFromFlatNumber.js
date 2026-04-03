/**
 * Маркетинговый этаж из номера квартиры (РФ): 201 → 2, 2401 → 24, 25001 → 25.
 * — Profitbase: этаж строки smallGrid часто не совпадает с номером.
 * — Google Sheets **только для пост-обработки парсера Содружество** (`isGoogleSheetsSodruzhestvoParserType`);
 *   у другого застройщика своя таблица — эвристику не подключать.
 *
 * @param {unknown} num
 * @returns {number | null}
 */
export function inferFloorFromFlatNumber(num) {
  if (num == null || num === '') return null
  const raw = String(num).trim().replace(/\u00a0/g, '').replace(/\s/g, '')
  if (!/^\d+$/.test(raw)) return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 101) return null
  const len = raw.length
  let floor = null
  if (len <= 4) {
    floor = Math.floor(n / 100)
  } else {
    floor = Math.floor(n / 1000)
  }
  if (!Number.isFinite(floor) || floor < 1 || floor > 60) return null
  return floor
}
