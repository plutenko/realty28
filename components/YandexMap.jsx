import { useEffect, useRef, useState } from 'react'

// Благовещенск
export const BLAGO_CENTER = [50.2671, 127.5273] // [lat, lng] в v2.1
export const BLAGO_ZOOM = 12

let yandexPromise = null

/** Лениво грузит Яндекс.Карты JS API v2.1 (только клиент). */
function loadYandex(apiKey) {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.ymaps && window.ymaps.Map) {
    return new Promise((resolve) => window.ymaps.ready(() => resolve(window.ymaps)))
  }
  if (!apiKey) {
    return Promise.reject(
      new Error('NEXT_PUBLIC_YANDEX_MAPS_KEY не задан. Получи ключ на developer.tech.yandex.ru')
    )
  }
  if (!yandexPromise) {
    yandexPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`
      script.async = true
      script.onload = () => {
        window.ymaps.ready(() => resolve(window.ymaps))
      }
      script.onerror = () => reject(new Error('Не удалось загрузить Яндекс.Карты'))
      document.head.appendChild(script)
    })
  }
  return yandexPromise
}

/**
 * Yandex-карта на JS API v2.1.
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
  center = BLAGO_CENTER,
  zoom = BLAGO_ZOOM,
  pickerSingle = false,
  value = null,
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

  useEffect(() => {
    if (!apiKey) {
      setError(
        'Яндекс-карта не подключена: добавьте NEXT_PUBLIC_YANDEX_MAPS_KEY в env (developer.tech.yandex.ru → JavaScript API и HTTP Геокодер).'
      )
      return
    }
    let cancelled = false
    loadYandex(apiKey)
      .then((ymaps) => {
        if (cancelled || !containerRef.current || mapRef.current) return
        ymapsRef.current = ymaps
        const map = new ymaps.Map(containerRef.current, {
          center,
          zoom,
          controls: ['zoomControl', 'geolocationControl'],
        })
        if (pickerSingle) {
          map.events.add('click', (e) => {
            const c = e.get('coords')
            if (!Array.isArray(c) || c.length !== 2) return
            const [lat, lng] = c
            cbRef.current.onPick?.(lat, lng)
          })
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

  // Picker — один драггабл-пин
  useEffect(() => {
    const ymaps = ymapsRef.current
    const map = mapRef.current
    if (!ymaps || !map || !pickerSingle) return
    const cur = refs.current
    if (!value || !Array.isArray(value) || value.length !== 2) {
      if (cur.pickerMarker) {
        map.geoObjects.remove(cur.pickerMarker)
        cur.pickerMarker = null
      }
      return
    }
    const coords = [Number(value[0]), Number(value[1])]
    if (cur.pickerMarker) {
      cur.pickerMarker.geometry.setCoordinates(coords)
      return
    }
    const placemark = new ymaps.Placemark(coords, {}, { draggable: true })
    placemark.events.add('dragend', () => {
      const c = placemark.geometry.getCoordinates()
      cbRef.current.onPick?.(c[0], c[1])
    })
    map.geoObjects.add(placemark)
    cur.pickerMarker = placemark
  }, [value, pickerSingle])

  // Markers — набор пинов
  useEffect(() => {
    const ymaps = ymapsRef.current
    const map = mapRef.current
    if (!ymaps || !map || pickerSingle) return
    const cur = refs.current
    for (const m of cur.markerObjs) {
      try {
        map.geoObjects.remove(m)
      } catch {}
    }
    cur.markerObjs = []
    if (!markers?.length) return
    for (const m of markers) {
      const lat = Number(m?.lat)
      const lng = Number(m?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const placemark = new ymaps.Placemark([lat, lng])
      placemark.events.add('click', () => {
        if (typeof m.onClick === 'function') m.onClick(m)
        else cbRef.current.onMarkerClick?.(m)
      })
      map.geoObjects.add(placemark)
      cur.markerObjs.push(placemark)
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
