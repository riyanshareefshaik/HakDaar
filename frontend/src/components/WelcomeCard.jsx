import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, HelpCircle, Loader2, Volume2, VolumeX, XCircle } from 'lucide-react'
import { inr } from '../api'
import { speak, stopSpeaking } from '../hooks'
import Logo from './Logo'

/**
 * HakDaar speaks first: a welcome-back line written from Hindsight memory + exact follow-up nudges
 * ("Suresh still owes you ₹1,200 · 5 days") with big one-tap answers.
 */
export default function WelcomeCard({ s, worker, language, speechTag, welcome, loading, autoRead, onReply, onTellRate }) {
  const [speaking, setSpeaking] = useState(false)
  const spokenFor = useRef(null)

  const text = welcome?.greeting || (welcome?.has_history ? s.welcomeBack(worker.name) : s.welcomeNew(worker.name))
  const nudges = welcome?.nudges || []

  const readAloud = async () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    setSpeaking(true)
    const extra = nudges.map(nudgeSentence).join(' ')
    const r = await speak(`${text} ${welcome?.greeting ? '' : extra}`, speechTag, language, { onEnd: () => setSpeaking(false) })
    if (r !== 'ok') setSpeaking(false)
  }

  // Speak once per login when auto-read is on (browsers may block this until the first tap).
  useEffect(() => {
    if (!loading && welcome && autoRead && spokenFor.current !== worker.id) {
      spokenFor.current = worker.id
      readAloud()
    }
  }, [loading, welcome, autoRead, worker.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function nudgeSentence(n) {
    if (n.type === 'missing_rate') return s.nudgeRate(n.employer_name)
    return `${s.nudgeOwed(n.employer_name, inr(n.amount_owed))}. ${s.nudgeAskPaid}`
  }

  return (
    <li className="animate-fade-up">
      <div className="overflow-hidden rounded-3xl border border-brand/15 bg-gradient-to-br from-brand-soft via-white to-white shadow-soft">
        <div className="flex gap-3 p-4">
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
                      <BigChoice icon={CheckCircle2} tone="yes" label={s.yesPaid} onClick={() => onReply(s.replyYesPaid(n.employer_name))} />
                      <BigChoice icon={XCircle} tone="no" label={s.notYet} onClick={() => onReply(s.replyNotYet(n.employer_name))} />
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
