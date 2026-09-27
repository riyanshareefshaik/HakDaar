import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Banknote, BellRing, Building2, CalendarDays, HardHat, Mic, ShieldCheck, Users, Volume2, VolumeX, X } from 'lucide-react'
import { LANGS } from '../i18n'
import { speak, stopSpeaking } from '../hooks'

// One picture per slide: big, colourful icons so the story works without reading.
const ART = [
  { icons: [HardHat, Building2], bg: 'bg-amber-100', fg: 'text-amber-700' },
  { icons: [CalendarDays], bg: 'bg-sky-100', fg: 'text-sky-700', badge: '6' },
  { icons: [Banknote], bg: 'bg-orange-100', fg: 'text-orange-700' },
  { icons: [Mic, ShieldCheck], bg: 'bg-emerald-100', fg: 'text-brand' },
  { icons: [Users, BellRing], bg: 'bg-violet-100', fg: 'text-violet-700' },
]

/** "Ravi's story": a 5-step picture story that explains HakDaar, with read-aloud on every step. */
export default function StoryIntro({ s, language, open, onClose }) {
  const [i, setI] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const slides = s.story
  const slide = slides[i]
  const art = ART[i]
  const last = i === slides.length - 1
  const tag = LANGS.find((l) => l.code === language)?.speech || 'en-IN'

  useEffect(() => { if (open) setI(0) }, [open])
  useEffect(() => { stopSpeaking(); setSpeaking(false) }, [i, open])
  useEffect(() => {
    if (!open) return
    const key = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, slides.length - 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0))
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open, onClose, slides.length])

  if (!open) return null

  const listen = async () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    setSpeaking(true)
    const r = await speak(slide.text, tag, language, { onEnd: () => setSpeaking(false) })
    if (r !== 'ok') setSpeaking(false)
  }
  const close = () => { stopSpeaking(); onClose() }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" lang={language}>
      <div className="card relative w-full max-w-md overflow-hidden animate-fade-up">
        <button onClick={close} aria-label={s.skip} className="absolute right-3 top-3 z-10 rounded-full bg-white/80 p-1.5 text-muted hover:text-ink"><X className="size-5" /></button>

        <div key={i} className={`relative grid h-56 place-items-center ${art.bg} animate-fade-up`}>
          <div className="flex items-end gap-3">
            {art.icons.map((Icon, k) => (
              <span key={k} className={`grid place-items-center rounded-3xl bg-white shadow-soft ${k === 0 ? 'size-28' : 'size-20'}`}>
                <Icon className={`${art.fg} ${k === 0 ? 'size-16' : 'size-11'}`} strokeWidth={1.6} />
              </span>
            ))}
          </div>
          {art.badge && <span className="absolute right-[32%] top-10 grid size-12 place-items-center rounded-full bg-sky-600 text-2xl font-extrabold text-white ring-4 ring-white">{art.badge}</span>}
          <span className={`absolute bottom-4 rounded-full px-4 py-1.5 text-lg font-extrabold shadow-soft ${slide.danger ? 'bg-danger text-white animate-pulse-ring' : 'bg-white text-ink'}`}>
            {slide.chip}
          </span>
        </div>

        <div className="space-y-4 p-5">
          <p className="min-h-[5.5rem] text-xl font-semibold leading-relaxed">{slide.text}</p>

          <button onClick={listen}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl border-2 py-3 text-lg font-bold transition ${speaking ? 'border-brand bg-brand text-white' : 'border-brand/30 text-brand hover:bg-brand-soft'}`}>
            {speaking ? <VolumeX className="size-6" /> : <Volume2 className="size-6" />} {speaking ? s.stopReading : s.listen}
          </button>

          <div className="flex items-center gap-2">
            <button onClick={() => setI(i - 1)} disabled={i === 0} aria-label={s.back}
              className="grid size-14 place-items-center rounded-2xl bg-sand text-ink transition disabled:opacity-30"><ArrowLeft className="size-6" /></button>
            <div className="flex flex-1 justify-center gap-1.5">
              {slides.map((_, k) => (
                <button key={k} onClick={() => setI(k)} aria-label={`${k + 1}`}
                  className={`h-2.5 rounded-full transition-all ${k === i ? 'w-7 bg-brand' : 'w-2.5 bg-black/15'}`} />
              ))}
            </div>
            {last ? (
              <button onClick={close} className="flex h-14 items-center gap-2 rounded-2xl bg-brand px-5 text-lg font-bold text-white shadow-soft">
                {s.startNow} <ArrowRight className="size-5" />
              </button>
            ) : (
              <button onClick={() => setI(i + 1)} aria-label={s.next}
                className="grid size-14 place-items-center rounded-2xl bg-brand text-white shadow-soft"><ArrowRight className="size-6" /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
