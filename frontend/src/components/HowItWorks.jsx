import { useEffect, useState } from 'react'
import { BellRing, Calculator, Grid2x2, Mic, ShieldAlert, Undo2, Volume2, VolumeX, X } from 'lucide-react'
import { LANGS } from '../i18n'
import { speak, stopSpeaking } from '../hooks'

const ICONS = [
  [Mic, 'bg-amber-50 text-amber-700'],
  [Grid2x2, 'bg-sky-50 text-sky-700'],
  [Calculator, 'bg-emerald-50 text-emerald-700'],
  [BellRing, 'bg-violet-50 text-violet-700'],
  [ShieldAlert, 'bg-red-50 text-red-700'],
  [Undo2, 'bg-stone-100 text-stone-700'],
]

/** A short guide to the app's features, one per step, each with read-aloud. */
export default function HowItWorks({ s, language, open, onClose }) {
  const [i, setI] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const steps = s.features
  const [title, text] = steps[i]
  const [Icon, tint] = ICONS[i]
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={close} role="dialog" aria-modal="true" aria-label={s.howItWorks} lang={language}>
      <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
          <p className="font-semibold">{s.howItWorks}</p>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{s.stepOf(i + 1, steps.length)}</span>
            <button onClick={close} aria-label={s.close} className="rounded-md p-1 text-muted hover:bg-sand hover:text-ink"><X className="size-5" /></button>
          </div>
        </div>

        <div key={i} className="flex gap-4 px-5 py-6 animate-fade-up">
          <span className={`grid size-16 shrink-0 place-items-center rounded-xl ${tint}`}><Icon className="size-8" strokeWidth={1.8} /></span>
          <div className="min-w-0">
            <h3 className="text-xl font-bold">{title}</h3>
            <p className="mt-1.5 text-[1.05rem] leading-relaxed text-ink/80">{text}</p>
            <button onClick={listen}
              className={`mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold transition ${speaking ? 'border-brand bg-brand text-white' : 'border-black/15 text-ink hover:bg-sand'}`}>
              {speaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />} {speaking ? s.stopReading : s.listen}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-black/10 px-5 py-3">
          <div className="flex flex-1 gap-1">
            {steps.map((_, k) => (
              <button key={k} onClick={() => setI(k)} aria-label={`${k + 1}`}
                className={`h-1.5 flex-1 rounded-full transition ${k <= i ? 'bg-brand' : 'bg-black/10'}`} />
            ))}
          </div>
          <button onClick={() => setI(i - 1)} disabled={i === 0}
            className="rounded-lg px-3 py-2 font-semibold text-muted hover:bg-sand disabled:invisible">{s.back}</button>
          <button onClick={() => (last ? close() : setI(i + 1))}
            className="rounded-lg bg-brand px-5 py-2 font-semibold text-white hover:bg-brand-dark">{last ? s.done : s.next}</button>
        </div>
      </div>
    </div>
  )
}
