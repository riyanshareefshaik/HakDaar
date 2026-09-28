import { useEffect, useState } from 'react'
import { Banknote, BriefcaseBusiness, CalendarCheck, Check, Delete, Minus, Plus, X } from 'lucide-react'

const TITLES = { worked: 'qeWorkedTitle', paid: 'qePaidTitle', promise: 'qePromiseTitle' }
const ICONS = { worked: CalendarCheck, paid: Banknote, promise: BriefcaseBusiness }

/**
 * No-typing entry for people who can't read or write easily: pick the employer, then tap numbers.
 * It produces a plain sentence in the worker's language and sends it like a chat message, so
 * memory, the ledger and the reply all work exactly as for typed messages.
 */
export default function QuickEntrySheet({ s, mode, employers, defaultEmployer, onClose, onSubmit }) {
  const [employer, setEmployer] = useState(defaultEmployer || employers[0] || '')
  const [typing, setTyping] = useState(!employers.length)
  const [days, setDays] = useState(1)
  const [amount, setAmount] = useState('')
  const [basis, setBasis] = useState('day')

  useEffect(() => {
    setEmployer(defaultEmployer || employers[0] || '')
    setTyping(!employers.length && !defaultEmployer)
    setDays(1); setAmount(''); setBasis('day')
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!mode) return null
  const Icon = ICONS[mode]
  const e = employer.trim()
  const valid = e && (mode === 'worked' ? days > 0 : Number(amount) > 0)

  const submit = () => {
    if (!valid) return
    const a = Number(amount).toLocaleString('en-IN')
    const text = mode === 'worked' ? s.qeWorked(e, days)
      : mode === 'paid' ? s.qePaid(e, a)
      : basis === 'day' ? s.qePromiseDay(e, a) : s.qePromiseTotal(e, a)
    onSubmit(text)
  }

  const press = (k) => {
    if (k === 'del') return setAmount((v) => v.slice(0, -1))
    setAmount((v) => (v + k).replace(/^0+/, '').slice(0, 8))
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center animate-fade" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-[28px] border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_20px_60px_rgba(0,0,0,0.45)] animate-sheet sm:rounded-[28px]"
        onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-label={s[TITLES[mode]]}>
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-white text-black"><Icon className="size-5" /></span>
          <h3 className="flex-1 text-lg font-semibold leading-tight text-white">{s[TITLES[mode]]}</h3>
          <button onClick={onClose} aria-label={s.close} className="rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-white"><X className="size-5" /></button>
        </div>

        {/* employer */}
        <p className="eyebrow mb-2">{s.qeEmployer}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {employers.map((name) => (
            <button key={name} onClick={() => { setEmployer(name); setTyping(false) }}
              className={`rounded-full px-4 py-2 text-[14.5px] font-medium transition ${!typing && employer === name ? 'bg-white text-black' : 'border border-line-strong bg-pill text-fg2 hover:text-white'}`}>
              {name}
            </button>
          ))}
          <button onClick={() => { setTyping(true); setEmployer('') }} aria-label={s.qeEmployerPh}
            className={`grid size-10 place-items-center rounded-full transition ${typing ? 'bg-white text-black' : 'border border-line-strong bg-pill text-fg2 hover:text-white'}`}>
            <Plus className="size-5" />
          </button>
        </div>
        {typing && (
          <input autoFocus value={employer} onChange={(ev) => setEmployer(ev.target.value)} placeholder={s.qeEmployerPh} className="field mb-3" />
        )}

        {mode === 'worked' ? (
          <div className="my-6 flex items-center justify-center gap-6">
            <button onClick={() => setDays((d) => Math.max(0.5, d - (d > 1 ? 1 : 0.5)))} aria-label="-"
              className="grid size-14 place-items-center rounded-full border border-line-strong bg-pill text-white active:scale-95"><Minus className="size-6" /></button>
            <div className="w-28 text-center">
              <div className="font-display text-6xl tabular-nums text-white">{days}</div>
              <div className="mt-1 text-sm text-muted">{days === 1 ? s.day1 : s.days}</div>
            </div>
            <button onClick={() => setDays((d) => Math.min(60, d < 1 ? 1 : d + 1))} aria-label="+"
              className="grid size-14 place-items-center rounded-full bg-white text-black active:scale-95"><Plus className="size-6" /></button>
          </div>
        ) : (
          <>
            {mode === 'promise' && (
              <div className="mb-3 grid grid-cols-2 rounded-full bg-white p-1">
                {[['day', s.qePerDay], ['fixed', s.qeTotal]].map(([k, label]) => (
                  <button key={k} onClick={() => setBasis(k)}
                    className={`rounded-full py-2 text-[14.5px] font-medium transition ${basis === k ? 'bg-black text-white' : 'text-ink opacity-60'}`}>{label}</button>
                ))}
              </div>
            )}
            <div className="mb-3 rounded-2xl border border-line bg-card px-5 py-3 text-right font-display text-4xl tabular-nums text-white">
              ₹{amount ? Number(amount).toLocaleString('en-IN') : <span className="text-muted/50">0</span>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'].map((k) => (
                <button key={k} onClick={() => press(k)} aria-label={k === 'del' ? 'delete' : k}
                  className="grid h-14 place-items-center rounded-2xl border border-line bg-card text-2xl font-medium text-white transition hover:bg-raised active:scale-95">
                  {k === 'del' ? <Delete className="size-6" /> : k}
                </button>
              ))}
            </div>
          </>
        )}

        <button onClick={submit} disabled={!valid} className="btn-white mt-5 w-full py-3.5 text-base">
          <Check className="size-5" /> {s.qeSave}
        </button>
      </div>
    </div>
  )
}
