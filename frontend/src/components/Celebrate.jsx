import { useMemo } from 'react'
import { PartyPopper } from 'lucide-react'

const COLORS = ['#1F6F4A', '#D97706', '#F59E0B', '#10B981', '#DC2626', '#0EA5E9']

/** Confetti + a big "All paid!" badge when an employer has paid everything owed. */
export default function Celebrate({ text }) {
  const pieces = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100,
    dx: `${(Math.random() - 0.5) * 40}vw`,
    rot: `${Math.random() * 720 - 360}deg`,
    dur: `${2.2 + Math.random() * 1.6}s`,
    delay: `${Math.random() * 0.5}s`,
    color: COLORS[i % COLORS.length],
  })), [])
  return (
    <>
      {pieces.map((p, i) => (
        <span key={i} className="confetti" style={{ left: `${p.left}vw`, background: p.color, animationDelay: p.delay, '--dx': p.dx, '--rot': p.rot, '--dur': p.dur }} />
      ))}
      <div className="pointer-events-none fixed inset-0 z-[61] grid place-items-center">
        <div className="flex items-center gap-3 rounded-3xl bg-white px-6 py-4 text-2xl font-extrabold text-brand shadow-lift animate-pop">
          <PartyPopper className="size-8 text-warn" /> {text}
        </div>
      </div>
    </>
  )
}
