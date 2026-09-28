import { useState } from 'react'
import {
  AlertTriangle, Banknote, BriefcaseBusiness, CalendarCheck, ChevronDown, CircleAlert, Gift, Loader2,
  MessageSquareQuote, Undo2,
} from 'lucide-react'
import { api, inr } from '../api'
import { useCountUp } from '../hooks'

/** Right column: the wage ledger. (How the numbers are calculated lives in My account.) */
export default function LedgerPanel({ s, ledger, loading, onUndo }) {
  return (
    <div className="h-full overflow-y-auto scroll-thin p-5 sm:p-6">
      <LedgerCard s={s} ledger={ledger} loading={loading} onUndo={onUndo} />
    </div>
  )
}

function SectionTitle({ children, right }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="font-display text-2xl leading-none text-white">{children}</h2>
      {right}
    </div>
  )
}

function Skeleton({ rows = 2 }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-card" />)}</div>
}

function Empty({ children }) {
  return <p className="rounded-2xl border border-dashed border-line px-4 py-5 text-center text-sm text-muted">{children}</p>
}

// ---------------------------------------------------------------- ledger

export function LedgerCard({ s, ledger, loading, onUndo }) {
  const employers = ledger?.employers || []
  return (
    <section>
      <SectionTitle>{s.ledger}</SectionTitle>
      {loading ? <Skeleton /> : employers.length === 0 ? (
        <Empty>{s.noLedger}</Empty>
      ) : (
        <div className="space-y-3">
          {employers.map((r) => <EmployerRow key={r.employer_name} r={r} s={s} onUndo={onUndo} />)}
        </div>
      )}
    </section>
  )
}

function EmployerRow({ r, s, onUndo }) {
  const [open, setOpen] = useState(false)
  const owed = useCountUp(r.amount_owed ?? 0)
  const unknown = r.status === 'unknown_rate'
  const isOwed = (r.amount_owed ?? 0) > 0
  const pct = r.amount_earned ? Math.min(100, Math.round((r.amount_paid / r.amount_earned) * 100)) : 0
  const workings = [
    r.rate_per_day != null && r.days_worked ? `${r.days_worked} × ${inr(r.rate_per_day)}` : null,
    r.fixed_amount ? inr(r.fixed_amount) : null,
  ].filter(Boolean).join(' + ')

  return (
    <article className="card p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">{r.employer_name}</p>
          <p className="eyebrow mt-0.5">{unknown ? s.rateUnknown : isOwed ? s.owed : r.advance ? `${s.advance} ${inr(r.advance)}` : s.allPaid}</p>
        </div>
        {!unknown && (
          <span className={`font-display text-[32px] leading-none tabular-nums ${isOwed ? 'text-owed' : 'text-ok'}`}>{inr(isOwed ? owed : 0)}</span>
        )}
      </header>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
        <Stat label={s.promised} value={r.rate_per_day == null ? '—' : `${inr(r.rate_per_day)}${s.perDay}`} />
        <Stat label={s.days} value={r.days_worked} />
        <Stat label={s.paid} value={inr(r.amount_paid)} />
        {r.fixed_amount > 0 && <Stat label={s.fixed} value={inr(r.fixed_amount)} />}
      </dl>

      {unknown ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-warn"><CircleAlert className="size-4" /> {s.rateUnknown}</p>
      ) : (
        <div className="mt-4">
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-white transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 flex justify-between gap-2 text-[12px] text-muted">
            <span>{s.paid} {inr(r.amount_paid)} · {pct}%</span>
            <span className="text-right">{s.earned} {inr(r.amount_earned)}{workings && <span className="opacity-70"> ({workings})</span>}</span>
          </p>
        </div>
      )}

      {r.entries?.length > 0 && (
        <>
          <button onClick={() => setOpen(!open)} className="btn-ghost -ml-3 mt-2">
            <ChevronDown className={`size-4 transition ${open ? 'rotate-180' : ''}`} />
            {open ? s.hideEntries : `${s.showEntries} (${r.entries.length})`}
          </button>
          {open && (
            <ol className="mt-1 divide-y divide-line rounded-xl border border-line animate-fade">
              {r.entries.map((e) => <EntryRow key={e.id} e={e} s={s} onUndo={onUndo} />)}
            </ol>
          )}
        </>
      )}
    </article>
  )
}

function EntryRow({ e, s, onUndo }) {
  const [busy, setBusy] = useState(false)
  const conf = {
    promise: e.basis === 'fixed'
      ? { icon: Gift, label: s.entryFixed, value: inr(e.amount) }
      : { icon: BriefcaseBusiness, label: s.entryPromise, value: `${inr(e.amount)}${s.perDay}` },
    work_day: { icon: CalendarCheck, label: s.entryWork, value: `${e.days} ${e.days === 1 ? s.day1 : s.days}` },
    payment: { icon: Banknote, label: s.entryPay, value: inr(e.amount) },
  }[e.type]
  const Icon = conf.icon
  const date = e.date ? new Date(e.date + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''
  return (
    <li className="group flex items-center gap-3 px-3 py-2 text-sm">
      <Icon className="size-4 shrink-0 text-muted" />
      <span className="flex-1 text-fg2">{conf.label} <span className="font-semibold tabular-nums text-white">{conf.value}</span></span>
      <span className="text-[12px] tabular-nums text-muted">{date}</span>
      <button onClick={async () => { setBusy(true); await onUndo(e); setBusy(false) }} disabled={busy} title={s.undo} aria-label={s.undo}
        className="grid size-7 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-white lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
      </button>
    </li>
  )
}

function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="truncate font-semibold tabular-nums text-white">{value}</dd>
    </div>
  )
}

export function HowCalculated({ s }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="border-t border-line px-5 py-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 text-left text-[15px] font-medium text-fg2 hover:text-white">
        {s.howCalc}
        <ChevronDown className={`size-4 text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <dl className="mt-3 space-y-3 text-sm animate-fade">
          {s.howCalcLines.map(([k, v], i) => (
            <div key={k}>
              <dt className={`font-semibold ${i === 2 ? 'text-owed' : 'text-white'}`}>{k}</dt>
              <dd className="text-fg2/80">{v}</dd>
            </div>
          ))}
          <p className="text-[12px] text-muted">{s.exactNote}</p>
        </dl>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- memories

export function MemoriesCard({ s, recalled, learned, newIds, error, loading, learning }) {
  const [view, setView] = useState('learned')
  const items = view === 'recalled' ? recalled : learned.items
  return (
    <section>
      <div className="mb-3 grid grid-cols-2 rounded-full bg-white p-1">
        {[['learned', `${s.allLearned} · ${learned.total}`], ['recalled', s.usedLastReply]].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`rounded-full px-2 py-1.5 text-[13.5px] font-medium transition ${view === k ? 'bg-black text-white' : 'text-ink opacity-60 hover:opacity-90'}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="mb-4 flex items-center gap-2 text-[13px] text-muted">
        {learning === 'pending' && <Loader2 className="size-3.5 animate-spin" />}
        {view === 'recalled' ? s.usedHint : s.learnedHint}
      </p>

      {typeof learning === 'number' && learning > 0 && view === 'learned' && (
        <p className="mb-3 text-sm text-white animate-fade">{s.learnedNew(learning)}</p>
      )}

      {loading ? <Skeleton rows={1} /> : error ? (
        <p className="flex items-start gap-2 rounded-2xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn"><CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}</p>
      ) : items.length === 0 ? (
        <Empty>{view === 'recalled' ? s.noRecall : s.noMemories}</Empty>
      ) : (
        <ul className="space-y-2">
          {items.map((m, i) => {
            const community = m.bank === 'employer-reputation'
            const fresh = newIds.has(m.id)
            return (
              <li key={`${m.bank}-${m.id ?? i}`} title={m.text}
                className={`rounded-2xl border px-3.5 py-2.5 text-sm leading-snug animate-rise ${fresh ? 'border-white/50 bg-raised' : 'border-line bg-card'}`}
                style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                <span className="mb-1 flex items-center gap-2 text-[11px] text-muted">
                  <span className={community ? 'text-warn' : 'text-fg2'}>{community ? s.community : s.personal}</span>
                  {m.date && <span className="tabular-nums">{new Date(m.date).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>}
                  {fresh && <span className="rounded-full bg-white px-1.5 text-[10px] font-semibold text-black">new</span>}
                </span>
                <span className="text-fg2">{m.text.length > 180 ? m.text.slice(0, 180) + '…' : m.text}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- alerts

export function AlertsCard({ s, alerts, loading }) {
  const rep = alerts.filter((a) => a.type === 'employer_reputation')
  return (
    <section>
      {loading ? <Skeleton rows={1} /> : rep.length === 0 ? (
        <Empty>{s.noAlerts}</Empty>
      ) : (
        <ul className="space-y-3">
          {rep.map((a) => <ReputationAlert key={a.employer_name} a={a} s={s} />)}
        </ul>
      )}
    </section>
  )
}

function ReputationAlert({ a, s }) {
  const [state, setState] = useState({ loading: false, summary: null, error: null })
  const ask = async () => {
    setState({ loading: true, summary: null, error: null })
    try {
      const r = await api.reputation(a.employer_name)
      setState({ loading: false, summary: r.summary, error: r.error })
    } catch (e) {
      setState({ loading: false, summary: null, error: e.message })
    }
  }
  return (
    <li className="card p-4 animate-rise">
      <p className="flex items-start gap-2.5 text-white">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> <span>{a.message}</span>
      </p>
      {!state.summary && (
        <button onClick={ask} disabled={state.loading} className="btn-dark mt-3 px-4 py-2 text-sm">
          {state.loading ? <Loader2 className="size-4 animate-spin" /> : <MessageSquareQuote className="size-4" />} {s.askReputation}
        </button>
      )}
      {state.summary && (
        <p className="mt-3 border-l-2 border-white/30 pl-3 text-sm leading-relaxed text-fg2 animate-fade">{state.summary}</p>
      )}
      {state.error && <p className="mt-2 text-sm text-owed">{state.error}</p>}
    </li>
  )
}
