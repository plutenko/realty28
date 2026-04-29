import { useCallback, useEffect, useState } from 'react'
import Cropper from 'react-easy-crop'
import { X } from 'lucide-react'

/**
 * Модалка обрезки картинки. Принимает url исходника, отдаёт через onSave Blob
 * с обрезанной png. Используется в админке для подрезки планировок (убрать
 * белые поля, лишние подписи застройщика и т.п.).
 */
export default function CropImageModal({ imageUrl, onSave, onClose, busy }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [error, setError] = useState('')
  const [localUrl, setLocalUrl] = useState(null)
  const [loading, setLoading] = useState(true)

  // Грузим картинку как blob → objectURL, чтобы canvas не был tainted
  // и react-easy-crop корректно работал с CORS-картинками из Supabase Storage.
  // Для SVG предварительно растеризуем в высоком разрешении (3000px по
  // длинной стороне), чтобы кроп получился чётким, а не мутным.
  useEffect(() => {
    let cancelled = false
    let createdUrl = null
    setLoading(true)
    setError('')
    fetch(imageUrl, { mode: 'cors' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        let blob = await r.blob()
        const isSvg =
          blob.type === 'image/svg+xml' ||
          /\.svg(?:\?|#|$)/i.test(imageUrl)
        if (isSvg) {
          blob = await rasterizeSvgBlob(blob, 3000)
        }
        if (cancelled) return
        createdUrl = URL.createObjectURL(blob)
        setLocalUrl(createdUrl)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message || 'Не удалось загрузить картинку')
        setLoading(false)
      })
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [imageUrl])

  const onCropComplete = useCallback((_, areaPixels) => {
    setCroppedAreaPixels(areaPixels)
  }, [])

  async function handleSave() {
    if (!croppedAreaPixels || !localUrl) return
    try {
      setError('')
      const blob = await getCroppedBlob(localUrl, croppedAreaPixels)
      await onSave(blob)
    } catch (e) {
      setError(e?.message || 'Ошибка обрезки')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="flex w-full max-w-3xl flex-col gap-4 rounded-2xl bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Обрезать планировку</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 hover:text-slate-100 disabled:opacity-50"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative h-[55vh] min-h-[300px] w-full overflow-hidden rounded-lg bg-slate-800">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Загружаем картинку…
            </div>
          ) : localUrl ? (
            <Cropper
              image={localUrl}
              crop={crop}
              zoom={zoom}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              objectFit="contain"
              restrictPosition={false}
              showGrid={true}
            />
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">Масштаб</span>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="w-10 text-right text-xs text-slate-400">{zoom.toFixed(2)}×</span>
        </div>

        {error ? <div className="text-xs text-rose-400">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || !croppedAreaPixels}
            className="rounded-lg border border-blue-500 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
          >
            {busy ? 'Сохраняем…' : 'Сохранить обрезку'}
          </button>
        </div>
      </div>
    </div>
  )
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(new Error('Не удалось загрузить изображение для обрезки'))
    img.src = url
  })
}

/**
 * Растеризует SVG-blob в PNG-blob с заданным длинным размером.
 * Браузер при drawImage(svgImg, 0,0, w, h) перерендеривает SVG
 * во вновь указанном разрешении — линии остаются чёткими,
 * получаем raster без потери качества.
 */
async function rasterizeSvgBlob(svgBlob, longSide = 3000) {
  const url = URL.createObjectURL(svgBlob)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Не удалось распарсить SVG'))
      i.src = url
    })
    const w0 = img.naturalWidth || img.width || longSide
    const h0 = img.naturalHeight || img.height || longSide
    const ratio = longSide / Math.max(w0, h0, 1)
    const w = Math.max(1, Math.round(w0 * ratio))
    const h = Math.max(1, Math.round(h0 * ratio))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Не удалось растеризовать SVG'))),
        'image/png'
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function getCroppedBlob(imageUrl, area) {
  const img = await loadImage(imageUrl)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(area.width))
  canvas.height = Math.max(1, Math.round(area.height))
  const ctx = canvas.getContext('2d')
  // JPEG не поддерживает прозрачность — заливаем фон белым,
  // иначе прозрачные области (если есть) станут чёрными.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height
  )
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Не удалось создать изображение'))
      },
      'image/webp',
      0.9
    )
  })
}
