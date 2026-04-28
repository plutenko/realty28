import { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'

/**
 * Кнопка-сердечко «В подборку» в стиле Циан:
 * - пустое (белый контур на полупрозрачном тёмном фоне) — не выбрано
 * - заполненное красное на белом — выбрано
 * - анимация пульса при клике
 */
export default function FavoriteHeart({ selected, onToggle, className = '', size = 'md' }) {
  const [pulse, setPulse] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  function handleClick(e) {
    if (typeof onToggle === 'function') onToggle(e)
    setPulse(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setPulse(false), 350)
  }

  const dimensions = size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'
  const iconSize = size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'

  return (
    <button
      type="button"
      onClick={handleClick}
      title={selected ? 'Убрать из подборки' : 'Добавить в подборку'}
      aria-label={selected ? 'Убрать из подборки' : 'Добавить в подборку'}
      aria-pressed={selected}
      className={`flex items-center justify-center rounded-full shadow-md backdrop-blur-sm transition-colors duration-200 ${dimensions} ${
        selected
          ? 'bg-white text-rose-500 hover:bg-rose-50'
          : 'bg-black/40 text-white hover:bg-black/55'
      } ${className}`}
    >
      <Heart
        className={`${iconSize} transition-transform duration-300 ease-out ${
          pulse ? 'scale-125' : 'scale-100'
        }`}
        fill={selected ? 'currentColor' : 'none'}
        strokeWidth={selected ? 0 : 2}
      />
    </button>
  )
}
