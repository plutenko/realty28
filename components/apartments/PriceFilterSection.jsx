import { useCallback, useEffect, useRef, useState } from 'react'

const SLIDER_STEP = 100000

/** Пузырь над ползунком и подсказки */
export const formatPrice = (n) =>
  new Intl.NumberFormat('ru-RU').format(n) + ' ₽'

function formatDigits(n) {
  if (n === '' || n === null || Number.isNaN(n)) return ''
  return Math.round(Number(n)).toLocaleString('ru-RU')
}

function parseDigitsToNumber(s) {
  const digits = String(s).replace(/\D/g, '')
  if (digits === '') return 0
  return Number(digits)
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

/** Позиция пузыря цены: не вылезает за края при translateX(-50%) */
function getBubbleStyle(value, absMax) {
  if (!absMax) {
    return { left: '0%', transform: 'translateX(0)' }
  }
  const percent = (value / absMax) * 100
  let left = percent
  let transform = 'translateX(-50%)'

  if (percent < 10) {
    left = 0
    transform = 'translateX(0)'
  }

  if (percent > 90) {
    left = 100
    transform = 'translateX(-100%)'
  }

  return {
    left: `${left}%`,
    transform,
  }
}

/**
 * Двойной range + поля «От / До».
 * Слайдер обновляет родителя сразу; ввод в полях — с debounce 200мс.
 */
export default function PriceFilterSection({
  priceMin,
  priceMax,
  onPriceMinChange,
  onPriceMaxChange,
  absMin = 0,
  absMax = 15000000,
}) {
  const [minStr, setMinStr] = useState(() => formatDigits(priceMin))
  const [maxStr, setMaxStr] = useState(() => formatDigits(priceMax))
  const [minFocused, setMinFocused] = useState(false)
  const [maxFocused, setMaxFocused] = useState(false)

  const debounceMinRef = useRef(null)
  const debounceMaxRef = useRef(null)

  const flushDebounced = useCallback(() => {
    if (debounceMinRef.current) {
      clearTimeout(debounceMinRef.current)
      debounceMinRef.current = null
    }
    if (debounceMaxRef.current) {
      clearTimeout(debounceMaxRef.current)
      debounceMaxRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!minFocused) setMinStr(formatDigits(priceMin))
  }, [priceMin, minFocused])

  useEffect(() => {
    if (!maxFocused) setMaxStr(formatDigits(priceMax))
  }, [priceMax, maxFocused])

  useEffect(() => () => flushDebounced(), [flushDebounced])

  const leftPct = (priceMin / absMax) * 100
  const widthPctRaw = ((priceMax - priceMin) / absMax) * 100
  const widthPct = priceMin === priceMax ? Math.max(widthPctRaw, 0.35) : widthPctRaw

  const scheduleMinCommit = useCallback(
    (rawStr) => {
      if (debounceMinRef.current) clearTimeout(debounceMinRef.current)
      debounceMinRef.current = setTimeout(() => {
        let val = parseDigitsToNumber(rawStr)
        val = clamp(val, absMin, absMax)
        if (val > priceMax) val = priceMax
        onPriceMinChange(val)
        debounceMinRef.current = null
      }, 200)
    },
    [onPriceMinChange, priceMax, absMin, absMax]
  )

  const scheduleMaxCommit = useCallback(
    (rawStr) => {
      if (debounceMaxRef.current) clearTimeout(debounceMaxRef.current)
      debounceMaxRef.current = setTimeout(() => {
        let val = parseDigitsToNumber(rawStr)
        val = clamp(val, absMin, absMax)
        if (val < priceMin) val = priceMin
        onPriceMaxChange(val)
        debounceMaxRef.current = null
      }, 200)
    },
    [onPriceMaxChange, priceMin, absMin, absMax]
  )

  const onMinInputChange = (e) => {
    const v = e.target.value
    setMinStr(v)
    scheduleMinCommit(v)
  }

  const onMaxInputChange = (e) => {
    const v = e.target.value
    setMaxStr(v)
    scheduleMaxCommit(v)
  }

  const commitMinNow = () => {
    if (debounceMinRef.current) {
      clearTimeout(debounceMinRef.current)
      debounceMinRef.current = null
    }
    let val = parseDigitsToNumber(minStr)
    val = clamp(val, absMin, absMax)
    if (val > priceMax) val = priceMax
    onPriceMinChange(val)
    setMinStr(formatDigits(val))
  }

  const commitMaxNow = () => {
    if (debounceMaxRef.current) {
      clearTimeout(debounceMaxRef.current)
      debounceMaxRef.current = null
    }
    let val = parseDigitsToNumber(maxStr)
    val = clamp(val, absMin, absMax)
    if (val < priceMin) val = priceMin
    onPriceMaxChange(val)
    setMaxStr(formatDigits(val))
  }

  return (
    <div className="w-full pt-2">
      {/* overflow-hidden + пузыри внутри строки — ничего не вылезает по горизонтали */}
      <div className="relative mt-0 w-full overflow-hidden">
        <div className="relative mb-1 h-7 w-full">
          <div
            className="pointer-events-none absolute top-0 z-20 whitespace-nowrap rounded bg-black px-2 py-1 text-xs text-white"
            style={getBubbleStyle(priceMin, absMax)}
          >
            {formatPrice(priceMin)}
          </div>
          <div
            className="pointer-events-none absolute top-0 z-[21] whitespace-nowrap rounded bg-black px-2 py-1 text-xs text-white"
            style={getBubbleStyle(priceMax, absMax)}
          >
            {formatPrice(priceMax)}
          </div>
        </div>

        <div className="apartments-price-slider relative h-10">
          <div
            className="pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gray-200"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-blue-500"
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
            }}
            aria-hidden
          />

          <input
            type="range"
            min={absMin}
            max={absMax}
            step={SLIDER_STEP}
            value={priceMin}
            onChange={(e) => {
              const val = Number(e.target.value)
              if (val <= priceMax) {
                onPriceMinChange(val)
                setMinStr(formatDigits(val))
              }
            }}
            className="apartments-range-min absolute inset-0 z-[1] h-10 w-full appearance-none"
          />
          <input
            type="range"
            min={absMin}
            max={absMax}
            step={SLIDER_STEP}
            value={priceMax}
            onChange={(e) => {
              const val = Number(e.target.value)
              if (val >= priceMin) {
                onPriceMaxChange(val)
                setMaxStr(formatDigits(val))
              }
            }}
            className="absolute inset-0 z-[2] h-10 w-full appearance-none"
          />
        </div>
      </div>

      <div className="mt-3 flex gap-3">
        <input
          type="text"
          inputMode="numeric"
          placeholder="От"
          value={minStr}
          onFocus={() => setMinFocused(true)}
          onBlur={() => {
            setMinFocused(false)
            commitMinNow()
          }}
          onChange={onMinInputChange}
          className="w-full rounded-xl bg-gray-100 p-3 text-left text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="text"
          inputMode="numeric"
          placeholder="До"
          value={maxStr}
          onFocus={() => setMaxFocused(true)}
          onBlur={() => {
            setMaxFocused(false)
            commitMaxNow()
          }}
          onChange={onMaxInputChange}
          className="w-full rounded-xl bg-gray-100 p-3 text-left text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  )
}
