import { useEffect, useState } from 'react'
import { Heart } from 'lucide-react'

/**
 * Анимированное сердце — появляется в центре, пульсирует, улетает в
 * элемент с data-target="my-collections-link" с уменьшением.
 * После завершения вызывает onComplete.
 */
export default function FlyingHeart({ onComplete }) {
  const [targetRect, setTargetRect] = useState(null)
  const [phase, setPhase] = useState('start')

  useEffect(() => {
    const el = document.querySelector('[data-target="my-collections-link"]')
    if (!el) {
      onComplete?.()
      return
    }
    const r = el.getBoundingClientRect()
    setTargetRect({ x: r.x + r.width / 2, y: r.y + r.height / 2 })

    requestAnimationFrame(() => setPhase('grow'))
    const t1 = setTimeout(() => setPhase('fly'), 450)
    const t2 = setTimeout(() => {
      setPhase('end')
      onComplete?.()
    }, 1300)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [onComplete])

  if (!targetRect) return null

  let style = {}
  if (phase === 'start') {
    style = { transform: 'translate(-50%, -50%) scale(0)', opacity: 0 }
  } else if (phase === 'grow') {
    style = { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }
  } else if (phase === 'fly') {
    const offsetX = targetRect.x - window.innerWidth / 2
    const offsetY = targetRect.y - window.innerHeight / 2
    style = {
      transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(0.15)`,
      opacity: 0.6,
    }
  } else {
    style = { transform: 'translate(-50%, -50%) scale(0)', opacity: 0 }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]">
      <div
        className="absolute left-1/2 top-1/2 transition-all duration-[850ms] ease-out"
        style={style}
      >
        <Heart
          className="h-28 w-28 text-rose-500 drop-shadow-2xl"
          fill="currentColor"
          strokeWidth={0}
        />
      </div>
    </div>
  )
}
