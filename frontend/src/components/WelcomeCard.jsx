import { useEffect, useRef, useState } from 'react'
import { Check, Clock, HelpCircle, Loader2, Volume2, VolumeX, X } from 'lucide-react'
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
    <li className={closing ? 'animate-collapse' : 'animate-rise'}
      onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      <div className="relative overflow-hidden rounded-[24px] border border-line-strong/60 bg-card">
        <button onClick={close} aria-label={s.close} title={s.close}
          className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-muted transition hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
        <div className="flex gap-3.5 p-5 pr-12">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white"><Logo size={26} tone="dark" /></span>
          <div className="min-w-0 flex-1">
            {loading ? (
              <p className="flex items-center gap-2 text-muted"><Loader2 className="size-4 animate-spin" /> {s.typing}</p>
            ) : (
              <p className="text-[17px] leading-relaxed text-white">{text}</p>
            )}
            <button onClick={readAloud} disabled={loading} className="btn-ghost -ml-3 mt-1.5">
              {speaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />} {speaking ? s.stopReading : s.listen}
            </button>
          </div>
        </div>

        {nudges.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {nudges.map((n) => (
              <li key={n.type + n.employer_name} className="px-5 py-4">
                {n.type === 'owed' ? (
                  <>
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="text-fg2">{n.employer_name}</span>
                      <span className="font-display text-2xl tabular-nums text-owed">{inr(n.amount_owed)}</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                      {n.days_since > 0 && <span className="flex items-center gap-1"><Clock className="size-3.5" /> {s.nudgeDays(n.days_since)}</span>}
                      {n.promised_later && <span>· {s.nudgeLater}</span>}
                    </p>
                    <p className="mt-3 font-medium text-white">{s.nudgeAskPaid}</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button onClick={() => { onReply(s.replyYesPaid(n.employer_name)); close() }} className="btn-white px-5"><Check className="size-4" /> {s.yesPaid}</button>
                      <button onClick={() => { onReply(s.replyNotYet(n.employer_name)); close() }} className="btn-dark px-5"><X className="size-4" /> {s.notYet}</button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="flex flex-1 items-center gap-2 text-white"><HelpCircle className="size-4 shrink-0 text-warn" /> {s.nudgeRate(n.employer_name)}</p>
                    <button onClick={() => onTellRate(n.employer_name)} className="btn-white px-5">{s.tellRate}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!loading && (
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/5" aria-hidden>
            <div className="h-full bg-white/40 transition-[width] duration-100 ease-linear" style={{ width: `${(left / AUTO_CLOSE_MS) * 100}%` }} />
          </div>
        )}
      </div>
    </li>
  )
}
