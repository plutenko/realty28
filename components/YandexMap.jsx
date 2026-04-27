import { useEffect, useRef, useState } from 'react'

// Благовещенск
export const BLAGO_CENTER = [127.5273, 50.2671] // [lng, lat] — Yandex order
export const BLAGO_ZOOM = 12

let yandexPromise = null

/** Лениво грузит Yandex Maps JS API v3 (только клиент). */
function loadYandex(apiKey) {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.ymaps3) return window.ymaps3.ready.then(() => window.ymaps3)
  if (!apiKey) {
    return Promise.reject(
      new Error('NEXT_PUBLIC_YANDEX_MAPS_KEY не задан. Получи ключ на developer.tech.yandex.ru')
    )
  }
  if (!yandexPromise) {
    yandexPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`
      script.async = true
      script.onload = async () => {
        try {
          await window.ymaps3.ready
          resolve(window.ymaps3)
        } catch (e) {
          reject(e)
        }
      }
      script.onerror = () => reject(new Error('Не удалось загрузить Яндекс.Карты'))
      document.head.appendChild(script)
    })
  }
  return yandexPromise
}

/**
 * Yandex-карта с тем же API, что был у LeafletMap:
 *
 * pickerSingle (admin):
 *   - один передвигаемый пин
 *   - клик по карте перемещает пин и зовёт onPick(lat, lng)
 *
 * markers (apartments?view=map):
 *   - набор пинов { id, lat, lng, onClick }
 */
export default function YandexMap({
  className = '',
  height = 400,
  center = BLAGO_CENTER, // [lng, lat]
  zoom = BLAGO_ZOOM,
  pickerSingle = false,
  value = null, // [lat, lng]
  onPick = null,
  markers = [],
  onMarkerClick = null,
}) {
  const apiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_KEY
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const refs = useRef({ pickerMarker: null, markerObjs: [] })
  const ymapsRef = useRef(null)
  const cbRef = useRef({ onPick, onMarkerClick })
  const [error, setError] = useState(null)

  useEffect(() => {
    cbRef.current = { onPick, onMarkerClick }
  }, [onPick, onMarkerClick])

  // Инициализация карты — один раз
  useEffect(() => {
    if (!apiKey) {
      setError(
        'Яндекс.Карты не подключены: добавьте NEXT_PUBLIC_YANDEX_MAPS_KEY в env (developer.tech.yandex.ru)'
      )
      return
    }
    let cancelled = false
    loadYandex(apiKey)
      .then((ymaps3) => {
        if (cancelled || !containerRef.current || mapRef.current) return
        ymapsRef.current = ymaps3
        const map = new ymaps3.YMap(containerRef.current, {
          location: { center, zoom },
        })
        map.addChild(new ymaps3.YMapDefaultSchemeLayer())
        map.addChild(new ymaps3.YMapDefaultFeaturesLayer())
        if (pickerSingle) {
          map.addChild(
            new ymaps3.YMapListener({
              onClick: (_obj, event) => {
                const c = event?.coordinates
                if (!Array.isArray(c) || c.length !== 2) return
                const [lng, lat] = c
                cbRef.current.onPick?.(lat, lng)
              },
            })
          )
        }
        mapRef.current = map
      })
      .catch((e) => {
        setError(e?.message || 'Ошибка инициализации Яндекс.Карт')
      })
    return () => {
      cancelled = true
      if (mapRef.current) {
        try {
          mapRef.current.destroy()
        } catch {}
        mapRef.current = null
      }
      refs.current = { pickerMarker: null, markerObjs: [] }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  // Picker marker (синхронизация по value)
  useEffect(() => {
    const ymaps3 = ymapsRef.current
    const map = mapRef.current
    if (!ymaps3 || !map || !pickerSingle) return
    const cur = refs.current
    if (!value || !Array.isArray(value) || value.length !== 2) {
      if (cur.pickerMarker) {
        map.removeChild(cur.pickerMarker)
        cur.pickerMarker = null
      }
      return
    }
    const [lat, lng] = value
    const coords = [lng, lat]
    if (cur.pickerMarker) {
      cur.pickerMarker.update({ coordinates: coords })
      return
    }
    const el = document.createElement('div')
    el.style.cssText =
      'width:24px;height:24px;background:#2563eb;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.4);transform:translate(-12px,-12px);'
    const marker = new ymaps3.YMapMarker(
      { coordinates: coords, draggable: true, onDragEnd: (c) => {
          const [ln, la] = c
          cbRef.current.onPick?.(la, ln)
        } },
      el
    )
    map.addChild(marker)
    cur.pickerMarker = marker
  }, [value, pickerSingle])

  // Markers (для общей карты)
  useEffect(() => {
    const ymaps3 = ymapsRef.current
    const map = mapRef.current
    if (!ymaps3 || !map || pickerSingle) return
    const cur = refs.current
    for (const m of cur.markerObjs) {
      try {
        map.removeChild(m)
      } catch {}
    }
    cur.markerObjs = []
    if (!markers?.length) return
    for (const m of markers) {
      const lat = Number(m?.lat)
      const lng = Number(m?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const el = document.createElement('div')
      el.style.cssText =
        'width:24px;height:24px;background:#2563eb;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer;transform:translate(-12px,-12px);'
      el.addEventListener('click', () => {
        if (typeof m.onClick === 'function') m.onClick(m)
        else cbRef.current.onMarkerClick?.(m)
      })
      const marker = new ymaps3.YMapMarker({ coordinates: [lng, lat] }, el)
      map.addChild(marker)
      cur.markerObjs.push(marker)
    }
  }, [markers, pickerSingle])

  if (error) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 ${className}`}
        style={{ height }}
      >
        {error}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-xl border border-slate-300 ${className}`}
      style={{ height }}
    />
  )
}
