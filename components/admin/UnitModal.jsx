import { useState } from 'react'
import CropImageModal from './CropImageModal'

export default function UnitModal({
  activeCell,
  form,
  setForm,
  onSaveUnit,
  onDeleteUnit,
  onSplitUnit,
  closeEditor,
  uploadUnitMedia,
  removeUnitMedia,
  mediaBusy,
  mediaError,
  floorPlanUrl,
}) {
  const [pasteTarget, setPasteTarget] = useState('unit_layout')
  const [cropOpen, setCropOpen] = useState(false)

  if (!activeCell) return null

  async function handlePaste(e) {
    if (!activeCell.unit?.id) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          await uploadUnitMedia(pasteTarget, file, activeCell.unit.id)
          return
        }
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <form
        onSubmit={onSaveUnit}
        onPaste={handlePaste}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <h2 className="text-lg font-semibold text-white">
          {activeCell.unit ? 'Редактирование квартиры' : 'Новая квартира'}
        </h2>
        <p className="text-xs text-slate-400">
          Этаж ячейки в сетке: <strong>{activeCell.floor}</strong> · левая
          позиция: <strong>{activeCell.position}</strong>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-slate-400">Номер</label>
            <input
              type={form.is_commercial ? 'text' : 'number'}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={form.number}
              onChange={(e) => setForm((prev) => ({ ...prev, number: e.target.value }))}
              placeholder={form.is_commercial ? 'например: 1.1' : ''}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400">Комнат</label>
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={form.rooms}
              onChange={(e) => setForm((prev) => ({ ...prev, rooms: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400">Колонок (ширина на этаже)</label>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={form.span_columns}
              onChange={(e) => setForm((prev) => ({ ...prev, span_columns: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400">Этажей (вниз от якоря)</label>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={form.span_floors}
              onChange={(e) => setForm((prev) => ({ ...prev, span_floors: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400">Площадь</label>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={form.area}
              onChange={(e) => setForm((prev) => ({ ...prev, area: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400">Цена</label>
            <input
              type="text"
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={form.price ? Number(form.price).toLocaleString('ru-RU') : ''}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '')
                setForm((prev) => ({ ...prev, price: raw }))
              }}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400">Статус</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={form.status}
              onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
            >
              <option value="available">В продаже</option>
              <option value="booked">Бронь</option>
              <option value="sold">Продано</option>
              <option value="closed">Продажи закрыты</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.is_commercial || false}
                onChange={(e) => setForm((prev) => ({ ...prev, is_commercial: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              Коммерческое помещение
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={Number(form.span_floors) >= 2}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    span_floors: e.target.checked ? 2 : 1,
                  }))
                }
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              Двухуровневая (занимает 2 этажа)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(form.has_renovation)}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, has_renovation: e.target.checked }))
                }
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              Квартира с ремонтом
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-200">Медиа квартиры</div>
            {activeCell.unit?.id && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Ctrl+V в:</span>
                <select
                  value={pasteTarget}
                  onChange={(e) => setPasteTarget(e.target.value)}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                >
                  <option value="unit_layout">Планировка</option>
                  <option value="unit_finish">Ремонт</option>
                </select>
              </div>
            )}
          </div>
          {!activeCell.unit?.id ? (
            <p className="text-xs text-slate-500">
              Сначала сохраните квартиру, затем можно загрузить изображения.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs text-slate-400">Планировка</div>
                {activeCell.unit?.layout_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeCell.unit.layout_image_url}
                    alt=""
                    className="h-28 w-full rounded-lg border border-slate-700 bg-white object-contain"
                  />
                ) : (
                  <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-slate-700 text-xs text-slate-600">
                    нет файла
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600">
                    Загрузить
                    <input
                      type="file"
                      accept="image/*"
                      disabled={mediaBusy}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        await uploadUnitMedia('unit_layout', file, activeCell.unit.id)
                      }}
                    />
                  </label>
                  {activeCell.unit?.layout_image_url && (
                    <>
                      <button
                        type="button"
                        className="rounded border border-blue-500 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                        onClick={() => setCropOpen(true)}
                        disabled={mediaBusy}
                      >
                        Обрезать
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                        onClick={() => removeUnitMedia('unit_layout', activeCell.unit.id)}
                      >
                        Удалить
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs text-slate-400">Внутренний визуал / ремонт</div>
                {activeCell.unit?.finish_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeCell.unit.finish_image_url}
                    alt=""
                    className="h-28 w-full rounded-lg border border-slate-700 bg-white object-contain"
                  />
                ) : (
                  <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-slate-700 text-xs text-slate-600">
                    нет файла
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600">
                    Загрузить
                    <input
                      type="file"
                      accept="image/*"
                      disabled={mediaBusy}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        await uploadUnitMedia('unit_finish', file, activeCell.unit.id)
                      }}
                    />
                  </label>
                  {activeCell.unit?.finish_image_url && (
                    <button
                      type="button"
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                      onClick={() => removeUnitMedia('unit_finish', activeCell.unit.id)}
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {activeCell.unit?.floor != null && floorPlanUrl ? (
            <div className="mt-4 space-y-2">
              <div className="text-xs text-slate-400">
                Поэтажный план — этаж {activeCell.unit.floor}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={floorPlanUrl}
                alt=""
                className="w-full rounded-lg border border-slate-700 bg-white object-contain"
              />
            </div>
          ) : null}
          {mediaBusy ? <p className="mt-2 text-xs text-slate-500">Загрузка…</p> : null}
          {mediaError ? (
            <p className="mt-2 rounded bg-rose-900/40 px-2 py-1 text-xs text-rose-200">
              Ошибка: {mediaError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {activeCell.unit ? 'Сохранить' : 'Создать'}
          </button>
          {activeCell.unit ? (
            <button
              type="button"
              onClick={onDeleteUnit}
              className="rounded-xl border border-rose-700 bg-rose-900/40 px-5 py-2 text-sm font-medium text-rose-100 hover:bg-rose-800/50"
            >
              Удалить квартиру
            </button>
          ) : null}
          {activeCell.unit &&
          (Number(activeCell.unit.span_columns) > 1 ||
            Number(activeCell.unit.span_floors) > 1) ? (
            <button
              type="button"
              onClick={onSplitUnit}
              className="rounded-xl border border-blue-700 bg-blue-900/30 px-5 py-2 text-sm font-medium text-blue-100 hover:bg-blue-800/40"
            >
              Разделить
            </button>
          ) : null}
          <button
            type="button"
            onClick={closeEditor}
            className="rounded-xl border border-slate-600 px-5 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Закрыть
          </button>
        </div>
      </form>

      {cropOpen && activeCell.unit?.layout_image_url ? (
        <CropImageModal
          imageUrl={activeCell.unit.layout_image_url}
          busy={mediaBusy}
          onClose={() => setCropOpen(false)}
          onSave={async (blob) => {
            const file = new File([blob], `cropped-${Date.now()}.jpg`, { type: 'image/jpeg' })
            await uploadUnitMedia('unit_layout', file, activeCell.unit.id)
            setCropOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

