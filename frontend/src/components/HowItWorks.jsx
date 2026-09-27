import { useEffect, useState } from 'react'
import { BellRing, Calculator, Grid2x2, Mic, ShieldAlert, Undo2, Volume2, VolumeX, X } from 'lucide-react'
import { LANGS } from '../i18n'
import { speak, stopSpeaking } from '../hooks'

const ICONS = [Mic, Grid2x2, Calculator, BellRing, ShieldAlert, Undo2]

/** A short guide to the app's features, one per step, each with read-aloud. */
export default function HowItWorks({ s, language, open, onClose }) {
  const [i, setI] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const steps = s.features
  const [title, text] = steps[i]
  const Icon = ICONS[i]
  const last = i === steps.length - 1
  const tag = LANGS.find((l) => l.code === language)?.speech || 'en-IN'

  useEffect(() => { if (open) setI(0) }, [open])
  useEffect(() => { stopSpeaking(); setSpeaking(false) }, [i, open])
  useEffect(() => {
    if (!open) return
    const key = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, steps.length - 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0))
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open, onClose, steps.length])

  if (!open) return null
  const close = () => { stopSpeaking(); onClose() }
  const listen = async () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    setSpeaking(true)
    const r = await speak(`${title}. ${text}`, tag, language, { onEnd: () => setSpeaking(false) })
    if (r !== 'ok') setSpeaking(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md animate-fade sm:items-center sm:p-4" onClick={close} role="dialog" aria-modal="true" aria-label={s.howItWorks} lang={language}>
      <div className="w-full max-w-lg rounded-t-[28px] border border-line bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.45)] animate-sheet sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5">
          <p className="eyebrow">{s.howItWorks}</p>
          <button onClick={close} aria-label={s.close} className="rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-white"><X className="size-5" /></button>
        </div>

        <div key={i} className="px-6 pb-6 pt-4 animate-rise">
          <div className="flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-black"><Icon className="size-6" strokeWidth={1.8} /></span>
            <span className="font-display text-5xl leading-none tabular-nums text-white/25">{String(i + 1).padStart(2, '0')}</span>
          </div>
          <h3 className="mt-5 text-2xl font-semibold tracking-[-0.01em] text-white">{title}</h3>
          <p className="mt-2 text-[16.5px] leading-relaxed text-fg2/80">{text}</p>
          <button onClick={listen} className="btn-ghost -ml-3 mt-3">
            {speaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />} {speaking ? s.stopReading : s.listen}
          </button>
        </div>

        <div className="flex items-center gap-3 border-t border-line px-6 py-4">
          <div className="flex flex-1 items-center gap-1.5">
            {steps.map((_, k) => (
              <button key={k} onClick={() => setI(k)} aria-label={`${k + 1}`}
                className={`h-1 flex-1 rounded-full transition ${k <= i ? 'bg-white' : 'bg-white/15'}`} />
            ))}
          </div>
          <span className="text-[12px] tabular-nums text-muted">{s.stepOf(i + 1, steps.length)}</span>
          <button onClick={() => setI(i - 1)} disabled={i === 0} className="btn-dark px-4 py-2 disabled:invisible">{s.back}</button>
          <button onClick={() => (last ? close() : setI(i + 1))} className="btn-white px-5 py-2">{last ? s.done : s.next}</button>
        </div>
      </div>
    </div>
  )
}
