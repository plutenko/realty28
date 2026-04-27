import { useEffect, useRef } from 'react'

// Благовещенск — центр и стартовый зум для всех карт.
export const BLAGO_CENTER = [50.2671, 127.5273]
export const BLAGO_ZOOM = 12

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

let leafletPromise = null

/** Лениво грузит leaflet (только клиент). Возвращает модуль L. */
function loadLeaflet() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!leafletPromise) {
    leafletPromise = Promise.all([
      import('leaflet'),
      import('leaflet/dist/leaflet.css'),
    ]).then(([mod]) => {
      const L = mod.default || mod
      // Фикс дефолтных иконок Leaflet (по умолчанию пути ломаются в бандлере)
      delete L.Icon.Default.prototype._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:
          'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })
      return L
    })
  }
  return leafletPromise
}

/**
 * Базовый Leaflet-маппер.
 *
 * Режим pickerSingle (admin/complexes):
 *   - один передвигаемый пин
 *   - клик по карте перемещает пин и вызывает onPick(lat, lng)
 *   - value = [lat, lng] | null
 *
 * Режим markers (apartments?view=map):
 *   - набор пинов из markers={ id, lat, lng, popup: () => JSX, onClick? }[]
 *   - кликбельные, popup в Leaflet popup
 */
export default function LeafletMap({
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
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef({ pickerMarker: null, markerLayer: null })
  const LRef = useRef(null)
  const callbackRef = useRef({ onPick, onMarkerClick })

  // Держим колбэки в ref, чтобы не пересоздавать карту на каждый ререндер
  useEffect(() => {
    callbackRef.current = { onPick, onMarkerClick }
  }, [onPick, onMarkerClick])

  // Инициализация карты — один раз
  useEffect(() => {
    let cancelled = false
    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return
      LRef.current = L
      const map = L.map(containerRef.current).setView(center, zoom)
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map)
      mapRef.current = map

      if (pickerSingle) {
        map.on('click', (e) => {
          const { lat, lng } = e.latlng
          callbackRef.current.onPick?.(lat, lng)
        })
      }
    })
    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        layersRef.current = { pickerMarker: null, markerLayer: null }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Пин в режиме picker — синхронизируется со значением value
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map || !pickerSingle) return
    const layers = layersRef.current
    if (!value || !Array.isArray(value) || value.length !== 2) {
      if (layers.pickerMarker) {
        map.removeLayer(layers.pickerMarker)
        layers.pickerMarker = null
      }
      return
    }
    const [lat, lng] = value
    if (layers.pickerMarker) {
      layers.pickerMarker.setLatLng([lat, lng])
    } else {
      const m = L.marker([lat, lng], { draggable: true }).addTo(map)
      m.on('dragend', () => {
        const ll = m.getLatLng()
        callbackRef.current.onPick?.(ll.lat, ll.lng)
      })
      layers.pickerMarker = m
    }
  }, [value, pickerSingle])

  // Пины из markers
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map || pickerSingle) return
    const layers = layersRef.current
    if (layers.markerLayer) {
      map.removeLayer(layers.markerLayer)
      layers.markerLayer = null
    }
    if (!markers?.length) return
    const group = L.featureGroup()
    for (const m of markers) {
      const lat = Number(m?.lat)
      const lng = Number(m?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const marker = L.marker([lat, lng])
      if (typeof m.popup === 'string') {
        marker.bindPopup(m.popup)
      } else if (typeof m.popup === 'function') {
        marker.bindPopup(m.popup())
      }
      if (typeof m.onClick === 'function') {
        marker.on('click', () => m.onClick(m))
      } else if (callbackRef.current.onMarkerClick) {
        marker.on('click', () => callbackRef.current.onMarkerClick(m))
      }
      group.addLayer(marker)
    }
    group.addTo(map)
    layers.markerLayer = group
  }, [markers, pickerSingle])

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-xl border border-slate-700 ${className}`}
      style={{ height }}
    />
  )
}
