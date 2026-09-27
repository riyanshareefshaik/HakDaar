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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-cream p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl animate-slide-up sm:rounded-3xl"
        onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid size-11 place-items-center rounded-2xl bg-brand text-white"><Icon className="size-6" /></span>
          <h3 className="flex-1 text-lg font-bold leading-tight">{s[TITLES[mode]]}</h3>
          <button onClick={onClose} aria-label={s.close} className="rounded-full p-1.5 text-muted hover:bg-sand"><X className="size-6" /></button>
        </div>

        {/* employer */}
        <p className="mb-1.5 text-sm font-semibold text-muted">{s.qeEmployer}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {employers.map((name) => (
            <button key={name} onClick={() => { setEmployer(name); setTyping(false) }}
              className={`rounded-xl px-3 py-2 font-semibold transition ${!typing && employer === name ? 'bg-brand text-white shadow-soft' : 'bg-white ring-1 ring-black/10'}`}>
              {name}
            </button>
          ))}
          <button onClick={() => { setTyping(true); setEmployer('') }}
            className={`grid size-10 place-items-center rounded-xl transition ${typing ? 'bg-brand text-white' : 'bg-white ring-1 ring-black/10'}`} aria-label={s.qeEmployerPh}>
            <Plus className="size-5" />
          </button>
        </div>
        {typing && (
          <input autoFocus value={employer} onChange={(ev) => setEmployer(ev.target.value)} placeholder={s.qeEmployerPh}
            className="mb-3 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-lg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        )}

        {mode === 'worked' ? (
          <div className="my-4 flex items-center justify-center gap-5">
            <button onClick={() => setDays((d) => Math.max(0.5, d - (d > 1 ? 1 : 0.5)))} aria-label="-"
              className="grid size-16 place-items-center rounded-2xl bg-white text-ink shadow-soft ring-1 ring-black/5 active:scale-95"><Minus className="size-8" /></button>
            <div className="w-28 text-center">
              <div className="text-6xl font-extrabold tabular-nums text-brand">{days}</div>
              <div className="text-sm font-semibold text-muted">{s.days}</div>
            </div>
            <button onClick={() => setDays((d) => Math.min(60, d < 1 ? 1 : d + 1))} aria-label="+"
              className="grid size-16 place-items-center rounded-2xl bg-brand text-white shadow-soft active:scale-95"><Plus className="size-8" /></button>
          </div>
        ) : (
          <>
            {mode === 'promise' && (
              <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-sand p-1">
                {[['day', s.qePerDay], ['fixed', s.qeTotal]].map(([k, label]) => (
                  <button key={k} onClick={() => setBasis(k)}
                    className={`rounded-lg py-2 font-semibold ${basis === k ? 'bg-white text-brand shadow-soft' : 'text-muted'}`}>{label}</button>
                ))}
              </div>
            )}
            <div className="mb-3 rounded-2xl bg-white px-4 py-3 text-right text-4xl font-extrabold tabular-nums shadow-inner ring-1 ring-black/5">
              ₹{amount ? Number(amount).toLocaleString('en-IN') : <span className="text-muted/40">0</span>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'].map((k) => (
                <button key={k} onClick={() => press(k)} aria-label={k === 'del' ? 'delete' : k}
                  className="grid h-14 place-items-center rounded-2xl bg-white text-2xl font-bold shadow-sm ring-1 ring-black/5 transition active:scale-95 active:bg-brand-soft">
                  {k === 'del' ? <Delete className="size-6" /> : k}
                </button>
              ))}
            </div>
          </>
        )}

        <button onClick={submit} disabled={!valid}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-4 text-xl font-bold text-white shadow-soft transition active:scale-[.99] disabled:opacity-40">
          <Check className="size-6" /> {s.qeSave}
        </button>
      </div>
    </div>
  )
}
