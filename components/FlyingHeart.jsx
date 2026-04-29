import { useEffect, useState } from 'react'
import { Heart } from 'lucide-react'

/**
 * Анимированное сердце для подборки:
 * 1. Появляется с overshoot-эффектом (scale 0 → 1.3 → 1)
 * 2. Пульсирует с розовым ореолом
 * 3. Улетает в [data-target="my-collections-link"], уменьшаясь
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

    requestAnimationFrame(() => setPhase('appear'))
    const t1 = setTimeout(() => setPhase('pulse'), 550)
    const t2 = setTimeout(() => setPhase('fly'), 850)
    const t3 = setTimeout(() => {
      setPhase('end')
      onComplete?.()
    }, 1700)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [onComplete])

  if (!targetRect) return null

  let style = {}
  if (phase === 'start') {
    style = { transform: 'translate(-50%, -50%) scale(0)', opacity: 0 }
  } else if (phase === 'appear') {
    style = { animation: 'fh-appear 550ms cubic-bezier(0.34, 1.56, 0.64, 1) both' }
  } else if (phase === 'pulse') {
    style = { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }
  } else if (phase === 'fly') {
    const offsetX = targetRect.x - window.innerWidth / 2
    const offsetY = targetRect.y - window.innerHeight / 2
    style = {
      transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(0.15)`,
      opacity: 0.6,
      transition: 'transform 850ms ease-out, opacity 850ms ease-out',
    }
  } else {
    style = { transform: 'translate(-50%, -50%) scale(0)', opacity: 0, transition: 'all 200ms ease-out' }
  }

  const haloPulsing = phase === 'appear' || phase === 'pulse'

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]">
      <div className="absolute left-1/2 top-1/2" style={style}>
        <div className="relative">
          {/* Размытое розовое сияние сзади */}
          <div
            className="absolute inset-0 -m-6 rounded-full bg-rose-400/60 blur-2xl"
            style={{ animation: haloPulsing ? 'fh-pulse 900ms ease-in-out infinite alternate' : 'none' }}
            aria-hidden
          />
          {/* Внутреннее свечение */}
          <div
            className="absolute inset-0 -m-2 rounded-full bg-rose-300/70 blur-md"
            style={{ animation: haloPulsing ? 'fh-pulse 900ms ease-in-out infinite alternate' : 'none' }}
            aria-hidden
          />
          <Heart
            className="relative h-28 w-28 text-rose-500"
            fill="currentColor"
            strokeWidth={0}
            style={{
              animation: haloPulsing ? 'fh-beat 900ms ease-in-out infinite alternate' : 'none',
              filter: 'drop-shadow(0 0 12px rgba(244,63,94,0.55))',
            }}
          />
        </div>
      </div>
      <style jsx>{`
        @keyframes fh-appear {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
          55% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
          75% { transform: translate(-50%, -50%) scale(0.92); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
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
