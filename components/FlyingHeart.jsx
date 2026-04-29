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
        <div className="relative">
          {/* Размытое розовое сияние сзади */}
          <div
            className="absolute inset-0 -m-6 rounded-full bg-rose-400/60 blur-2xl"
            style={{ animation: phase === 'grow' ? 'fh-pulse 900ms ease-in-out infinite alternate' : 'none' }}
            aria-hidden
          />
          {/* Внутреннее свечение */}
          <div
            className="absolute inset-0 -m-2 rounded-full bg-rose-300/70 blur-md"
            style={{ animation: phase === 'grow' ? 'fh-pulse 900ms ease-in-out infinite alternate' : 'none' }}
            aria-hidden
          />
          <Heart
            className="relative h-28 w-28 text-rose-500"
            fill="currentColor"
            strokeWidth={0}
            style={{
              animation: phase === 'grow' ? 'fh-beat 900ms ease-in-out infinite alternate' : 'none',
              filter: 'drop-shadow(0 0 12px rgba(244,63,94,0.55))',
            }}
          />
        </div>
      </div>
      <style jsx>{`
        @keyframes fh-pulse {
          0% { transform: scale(0.9); opacity: 0.55; }
          100% { transform: scale(1.25); opacity: 0.95; }
        }
        @keyframes fh-beat {
          0% { transform: scale(0.96); }
          100% { transform: scale(1.08); }
        }
      `}</style>
    </div>
  )
}
