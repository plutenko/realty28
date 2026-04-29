import { useEffect, useState } from 'react'

export default function CollectionMetaModal({
  mode = 'create',
  initialValues = null,
  onSubmit,
  onClose,
  submitting = false,
}) {
  const [title, setTitle] = useState(initialValues?.title ?? '')
  const [clientName, setClientName] = useState(initialValues?.client_name ?? initialValues?.clientName ?? '')
  const [showComplexName, setShowComplexName] = useState(
    initialValues?.show_complex_name ?? initialValues?.showComplexName ?? true,
  )
  const [showDeveloperName, setShowDeveloperName] = useState(
    initialValues?.show_developer_name ?? initialValues?.showDeveloperName ?? true,
  )
  const [showAddress, setShowAddress] = useState(
    initialValues?.show_address ?? initialValues?.showAddress ?? true,
  )

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  function handleSubmit(e) {
    e.preventDefault()
    const t = title.trim()
    if (!t) {
      alert('Укажите название подборки')
      return
    }
    onSubmit({
      title: t,
      clientName: clientName.trim() || null,
      showComplexName,
      showDeveloperName,
      showAddress,
    })
  }

  const isEdit = mode === 'edit'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Редактировать подборку' : 'Новая подборка'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Название подборки <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              maxLength={200}
              placeholder="Например, 1-комнатные до 5 млн"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Имя клиента
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              maxLength={200}
              placeholder="Необязательно"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 text-sm font-medium text-gray-700">
              Что показывать клиенту
            </div>
            <ToggleRow
              label="Название ЖК"
              checked={showComplexName}
              onChange={setShowComplexName}
            />
            <ToggleRow
              label="Застройщик"
              checked={showDeveloperName}
              onChange={setShowDeveloperName}
            />
            <ToggleRow
              label="Адрес дома"
              checked={showAddress}
              onChange={setShowAddress}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg border border-blue-500 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {submitting ? (isEdit ? 'Сохраняем…' : 'Создаём…') : (isEdit ? 'Сохранить' : 'Создать подборку')}
          </button>
        </div>
      </form>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1.5">
      <span className="text-sm text-gray-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
          checked ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}
