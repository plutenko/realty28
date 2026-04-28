import { useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'

export default function ShareCollectionModal({ link, title, onClose }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const text = title ? `Подборка квартир: ${title}\n${link}` : link
  const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(title ?? 'Подборка квартир')}`
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore — пользователь скопирует руками из инпута
    }
  }

  async function openMax() {
    await copyLink()
    window.open('https://max.ru/', '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Подборка готова</h2>
            <div className="mt-0.5 text-xs text-gray-500">
              Отправьте ссылку клиенту любым удобным способом
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Ссылка</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={link}
                readOnly
                onFocus={(e) => e.target.select()}
                className="flex-1 truncate rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900"
              />
              <button
                type="button"
                onClick={copyLink}
                className={`flex shrink-0 items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  copied
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100'
                }`}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Скопировано</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Копировать</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-gray-600">Открыть в мессенджере</div>
            <div className="grid grid-cols-3 gap-2">
              <a
                href={tgUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-blue-50 hover:text-blue-700"
              >
                <span>✈️</span>
                <span>Telegram</span>
              </a>
              <a
                href={waUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-emerald-50 hover:text-emerald-700"
              >
                <span>🟢</span>
                <span>WhatsApp</span>
              </a>
              <button
                type="button"
                onClick={openMax}
                className="flex items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-amber-50 hover:text-amber-700"
                title="Скопирует ссылку и откроет max.ru"
              >
                <span>🅼</span>
                <span>Max</span>
              </button>
            </div>
            <div className="mt-1 text-[11px] text-gray-500">
              Max откроет веб-версию — ссылка уже будет в буфере, вставьте её в чат.
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  )
}
