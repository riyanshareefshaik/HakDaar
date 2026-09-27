import { useEffect, useRef, useState } from 'react'

/** Animates a number from its previous value to the new one (ease-out). */
export function useCountUp(value, ms = 700) {
  const [shown, setShown] = useState(value ?? 0)
  const prev = useRef(value ?? 0)
  useEffect(() => {
    const from = prev.current
    const to = value ?? 0
    prev.current = to
    if (from === to) { setShown(to); return }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setShown(to); return }
    const t0 = performance.now()
    let raf
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms)
      setShown(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

/** Read a reply aloud in the worker's language (helps workers who can't read easily). */
export function speak(text, langTag) {
  if (!('speechSynthesis' in window)) return false
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = langTag
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(langTag.slice(0, 2)))
  if (voice) u.voice = voice
  u.rate = 0.95
  window.speechSynthesis.speak(u)
  return true
}

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window
