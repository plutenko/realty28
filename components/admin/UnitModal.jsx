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
}) {
  if (!activeCell) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <form
        onSubmit={onSaveUnit}
        className="w-full max-w-xl space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
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
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={form.number}
              onChange={(e) => setForm((prev) => ({ ...prev, number: e.target.value }))}
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
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={form.price}
              onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400">Статус</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              value={form.status}
              onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
            >
              <option value="available">available</option>
              <option value="booked">booked (на брони)</option>
              <option value="sold">sold</option>
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="mb-2 text-sm font-semibold text-slate-200">Медиа квартиры</div>
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
                <input
                  type="file"
                  accept="image/*"
                  disabled={mediaBusy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    await uploadUnitMedia('unit_layout', file, activeCell.unit.id)
                  }}
                  className="block w-full text-sm text-slate-200 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1.5"
                />
                <button
                  type="button"
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  onClick={() => removeUnitMedia('unit_layout', activeCell.unit.id)}
                >
                  Удалить фото
                </button>
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
                <input
                  type="file"
                  accept="image/*"
                  disabled={mediaBusy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    await uploadUnitMedia('unit_finish', file, activeCell.unit.id)
                  }}
                  className="block w-full text-sm text-slate-200 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1.5"
                />
                <button
                  type="button"
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  onClick={() => removeUnitMedia('unit_finish', activeCell.unit.id)}
                >
                  Удалить фото
                </button>
              </div>
            </div>
          )}
          {mediaBusy ? <p className="mt-2 text-xs text-slate-500">Загрузка…</p> : null}
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
    </div>
  )
}

