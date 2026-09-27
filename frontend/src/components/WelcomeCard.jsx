import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, HelpCircle, Loader2, Volume2, VolumeX, X, XCircle } from 'lucide-react'
import { inr } from '../api'
import { speak, stopSpeaking } from '../hooks'
import Logo from './Logo'

/**
 * HakDaar speaks first: a welcome-back line written from Hindsight memory + exact follow-up nudges
 * ("Suresh still owes you ₹1,200 · 5 days") with big one-tap answers.
 */
const AUTO_CLOSE_MS = 20000

export default function WelcomeCard({ s, worker, language, speechTag, welcome, loading, onReply, onTellRate, onClose }) {
  const [speaking, setSpeaking] = useState(false)
  const [held, setHeld] = useState(false) // pointer over / touching the card pauses the countdown
  const [left, setLeft] = useState(AUTO_CLOSE_MS)
  const [closing, setClosing] = useState(false)
  const last = useRef(null)

  const close = () => { setClosing(true); setTimeout(onClose, 280) }

  // Closes by itself: a visible countdown that pauses while reading aloud or while the worker is touching it.
  useEffect(() => {
    if (loading || closing) return
    const id = setInterval(() => {
      const now = performance.now()
      const dt = last.current ? now - last.current : 0
      last.current = now
      if (speaking || held) return
      setLeft((l) => {
        const next = l - dt
        if (next <= 0) { clearInterval(id); close() }
        return Math.max(0, next)
      })
    }, 100)
    return () => { clearInterval(id); last.current = null }
  }, [loading, speaking, held, closing]) // eslint-disable-line react-hooks/exhaustive-deps

  const text = welcome?.greeting || (welcome?.has_history ? s.welcomeBack(worker.name) : s.welcomeNew(worker.name))
  const nudges = welcome?.nudges || []

  const readAloud = async () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    setLeft(AUTO_CLOSE_MS)
    setSpeaking(true)
    const extra = nudges.map(nudgeSentence).join(' ')
    // After it has been read aloud, the card closes by itself.
    const r = await speak(`${text} ${welcome?.greeting ? '' : extra}`, speechTag, language, {
      onEnd: () => { setSpeaking(false); setTimeout(close, 1200) },
    })
    if (r !== 'ok') setSpeaking(false)
  }

  function nudgeSentence(n) {
    if (n.type === 'missing_rate') return s.nudgeRate(n.employer_name)
    return `${s.nudgeOwed(n.employer_name, inr(n.amount_owed))}. ${s.nudgeAskPaid}`
  }

  return (
    <li className={closing ? 'animate-collapse' : 'animate-pop'}
      onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      <div className="relative overflow-hidden rounded-3xl border border-brand/15 bg-gradient-to-br from-brand-soft via-white to-amber-50/60 shadow-lift">
        <button onClick={close} aria-label={s.close} title={s.close}
          className="absolute right-2.5 top-2.5 z-10 rounded-full bg-white/80 p-1.5 text-muted shadow-sm transition hover:bg-white hover:text-ink"><X className="size-4" /></button>
        <div className="flex gap-3 p-4 pr-11">
          <Logo size={44} tone="dark" className="shrink-0" />
          <div className="min-w-0 flex-1">
            {loading ? (
              <p className="flex items-center gap-2 text-muted"><Loader2 className="size-4 animate-spin" /> {s.typing}</p>
            ) : (
              <p className="text-lg leading-relaxed">{text}</p>
            )}
            <button onClick={readAloud} disabled={loading}
              className={`mt-2 flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold transition ${speaking ? 'bg-brand text-white' : 'bg-white text-brand ring-1 ring-brand/20 hover:bg-brand-soft'}`}>
              {speaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />} {speaking ? s.stopReading : s.listen}
            </button>
          </div>
        </div>

        {nudges.length > 0 && (
          <ul className="space-y-2 border-t border-brand/10 bg-white/70 p-3">
            {nudges.map((n) => (
              <li key={n.type + n.employer_name} className={`rounded-2xl p-3 ${n.type === 'owed' ? 'bg-danger-soft' : 'bg-warn-soft'}`}>
                {n.type === 'owed' ? (
                  <>
                    <p className="flex items-start gap-2 font-bold text-danger">
                      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-danger text-sm text-white">₹</span>
                      {s.nudgeOwed(n.employer_name, inr(n.amount_owed))}
                    </p>
                    <p className="ml-9 mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink/70">
                      {n.days_since > 0 && <span className="flex items-center gap-1"><Clock className="size-3.5" /> {s.nudgeDays(n.days_since)}</span>}
                      {n.promised_later && <span>· {s.nudgeLater}</span>}
                    </p>
                    <p className="ml-9 mt-2 font-semibold">{s.nudgeAskPaid}</p>
                    <div className="ml-9 mt-2 grid grid-cols-2 gap-2">
                      <BigChoice icon={CheckCircle2} tone="yes" label={s.yesPaid} onClick={() => { onReply(s.replyYesPaid(n.employer_name)); close() }} />
                      <BigChoice icon={XCircle} tone="no" label={s.notYet} onClick={() => { onReply(s.replyNotYet(n.employer_name)); close() }} />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex flex-1 items-center gap-2 font-bold text-warn"><HelpCircle className="size-5 shrink-0" /> {s.nudgeRate(n.employer_name)}</p>
                    <button onClick={() => onTellRate(n.employer_name)}
                      className="rounded-xl bg-warn px-4 py-2 font-bold text-white shadow-soft">{s.tellRate}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!loading && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-brand/10" aria-hidden>
            <div className="h-full bg-brand/60 transition-[width] duration-100 ease-linear" style={{ width: `${(left / AUTO_CLOSE_MS) * 100}%` }} />
          </div>
        )}
      </div>
    </li>
  )
}

function BigChoice({ icon: Icon, label, tone, onClick }) {
  return (
    <button onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-base font-bold shadow-sm transition active:scale-95 ${tone === 'yes' ? 'bg-brand text-white hover:bg-brand-dark' : 'bg-white text-danger ring-1 ring-danger/30 hover:bg-danger-soft'}`}>
      <Icon className="size-5" /> {label}
    </button>
  )
}
