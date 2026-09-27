import { useState } from 'react'
import {
  AlertTriangle, BadgeCheck, Banknote, Brain, BriefcaseBusiness, Building2, CalendarCheck, ChevronDown, CircleAlert, CircleHelp, Gift,
  Loader2, MessageSquareQuote, Sparkles, Undo2, Users, Wallet,
} from 'lucide-react'
import { api, inr } from '../api'
import { useCountUp } from '../hooks'

/** Right column: the wage ledger (the numbers) and how they are calculated. */
export default function LedgerPanel({ s, ledger, loading, onUndo }) {
  return (
    <div className="h-full space-y-4 overflow-y-auto scroll-thin p-4">
      <LedgerCard s={s} ledger={ledger} loading={loading} onUndo={onUndo} />
      <HowCalculated s={s} />
    </div>
  )
}

function HowCalculated({ s }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 p-4 text-left font-semibold">
        <CircleHelp className="size-5 text-brand" />
        <span className="flex-1">{s.howCalc}</span>
        <ChevronDown className={`size-4 text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-4 animate-fade-up">
          {s.howCalcLines.map(([k, v], i) => (
            <p key={k} className={`rounded-xl p-2.5 text-sm ${i === 2 ? 'bg-danger-soft' : 'bg-sand/70'}`}>
              <b className={i === 2 ? 'text-danger' : ''}>{k}</b> = {v}
            </p>
          ))}
          <p className="flex items-center gap-1.5 text-xs text-muted"><BadgeCheck className="size-3.5 text-brand" /> {s.exactNote}</p>
        </div>
      )}
    </section>
  )
}

function CardTitle({ icon: Icon, children, right }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand"><Icon className="size-4.5" /></span>
      <h3 className="flex-1 font-bold">{children}</h3>
      {right}
    </div>
  )
}

function Skeleton({ rows = 2 }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-sand" />)}</div>
}

// ---------------------------------------------------------------- ledger

export function LedgerCard({ s, ledger, loading, onUndo }) {
  const employers = ledger?.employers || []
  return (
    <section className="card p-4">
      <CardTitle icon={Wallet}>{s.ledger}</CardTitle>
      {loading ? <Skeleton /> : employers.length === 0 ? (
        <p className="rounded-xl bg-sand/70 p-3 text-sm text-muted">{s.noLedger}</p>
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

  return (
    <div className={`rounded-xl border p-3 transition ${isOwed ? 'border-danger/25 bg-danger-soft/50' : 'border-black/5 bg-sand/60'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 font-semibold"><Building2 className="size-4 shrink-0 text-muted" /> <span className="truncate">{r.employer_name}</span></p>
        {!unknown && (
          isOwed ? (
            <span className="text-right">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-danger">{s.owed}</span>
              <span className="text-3xl font-extrabold leading-none tabular-nums text-danger">{inr(owed)}</span>
            </span>
          ) : (
            <span className="text-right">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-brand">{r.advance ? `${s.advance} ${inr(r.advance)}` : s.allPaid}</span>
              <span className="text-3xl font-extrabold leading-none text-brand">₹0</span>
            </span>
          )
        )}
      </div>

      <dl className={`mt-2 grid gap-2 text-sm ${r.fixed_amount ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <Stat label={s.promised} value={r.rate_per_day == null ? '—' : `${inr(r.rate_per_day)}${s.perDay}`} />
        <Stat label={s.days} value={r.days_worked} />
        {r.fixed_amount > 0 && <Stat label={s.fixed} value={inr(r.fixed_amount)} />}
        <Stat label={s.paid} value={inr(r.amount_paid)} />
      </dl>

      {unknown ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-warn"><CircleAlert className="size-4" /> {s.rateUnknown}</p>
      ) : (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-white">
            <div className={`h-full rounded-full transition-all duration-700 ${isOwed ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 flex justify-between text-xs text-muted">
            <span>{s.paid} {inr(r.amount_paid)}</span>
            <span>{s.earned} {inr(r.amount_earned)} <span className="opacity-70">({[
              r.rate_per_day != null && r.days_worked ? `${r.days_worked} × ${inr(r.rate_per_day)}` : null,
              r.fixed_amount ? inr(r.fixed_amount) : null,
            ].filter(Boolean).join(' + ') || '0'})</span></span>
          </p>
        </div>
      )}

      {r.entries?.length > 0 && (
        <>
          <button onClick={() => setOpen(!open)}
            className="mt-2 flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            <ChevronDown className={`size-4 transition ${open ? 'rotate-180' : ''}`} />
            {open ? s.hideEntries : `${s.showEntries} (${r.entries.length})`}
          </button>
          {open && (
            <ol className="mt-2 space-y-1.5 border-l-2 border-brand/20 pl-3 animate-fade-up">
              {r.entries.map((e) => <EntryRow key={e.id} e={e} s={s} onUndo={onUndo} />)}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

function EntryRow({ e, s, onUndo }) {
  const [busy, setBusy] = useState(false)
  const conf = {
    promise: e.basis === 'fixed'
      ? { icon: Gift, label: s.entryFixed, value: inr(e.amount) }
      : { icon: BriefcaseBusiness, label: s.entryPromise, value: `${inr(e.amount)}${s.perDay}` },
    work_day: { icon: CalendarCheck, label: s.entryWork, value: `${e.days} ${s.days}` },
    payment: { icon: Banknote, label: s.entryPay, value: inr(e.amount) },
  }[e.type]
  const Icon = conf.icon
  const date = e.date ? new Date(e.date + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''
  return (
    <li className="group flex items-center gap-2 text-sm">
      <Icon className="size-4 shrink-0 text-muted" />
      <span className="flex-1">{conf.label} <b>{conf.value}</b></span>
      <span className="text-xs text-muted">{date}</span>
      <button onClick={async () => { setBusy(true); await onUndo(e); setBusy(false) }} disabled={busy} title={s.undo} aria-label={s.undo}
        className="grid size-7 place-items-center rounded-lg text-muted transition hover:bg-white hover:text-danger lg:opacity-0 lg:group-hover:opacity-100">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
      </button>
    </li>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------- memories

export function MemoriesCard({ s, recalled, learned, newIds, error, loading, learning }) {
  const [view, setView] = useState('learned')
  const items = view === 'recalled' ? recalled : learned.items
  return (
    <section className="card p-4">
      <CardTitle icon={Brain}
        right={learning === 'pending'
          ? <span className="flex items-center gap-1 text-xs font-semibold text-brand"><Loader2 className="size-3.5 animate-spin" /> Hindsight</span>
          : <span className="rounded-full bg-sand px-2 py-0.5 text-[11px] font-semibold text-muted">Hindsight</span>}>
        {s.memories}
      </CardTitle>

      <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-sand p-1 text-sm">
        {[['learned', `${s.allLearned} (${learned.total})`], ['recalled', s.usedLastReply]].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`rounded-lg px-2 py-1.5 font-semibold transition ${view === k ? 'bg-white text-brand shadow-soft' : 'text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-muted">{view === 'recalled' ? s.usedHint : s.learnedHint}</p>

      {typeof learning === 'number' && learning > 0 && view === 'learned' && (
        <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-brand-soft px-2.5 py-1.5 text-sm font-semibold text-brand animate-slide-down">
          <Sparkles className="size-4" /> {s.learnedNew(learning)}
        </p>
      )}

      {loading ? <Skeleton rows={1} /> : error ? (
        <p className="flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn"><CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl bg-sand/70 p-3 text-sm text-muted">{view === 'recalled' ? s.noRecall : s.noMemories}</p>
      ) : (
        <ul className="max-h-[22rem] space-y-1.5 overflow-y-auto scroll-thin pr-1">
          {items.map((m, i) => {
            const community = m.bank === 'employer-reputation'
            const fresh = newIds.has(m.id)
            return (
              <li key={`${m.bank}-${m.id ?? i}`} title={m.text}
                className={`animate-fade-up rounded-xl border px-3 py-2 text-sm leading-snug transition ${fresh ? 'border-brand bg-brand-soft ring-2 ring-brand/20' : community ? 'border-warn/25 bg-warn-soft' : 'border-black/5 bg-sand/50'}`}
                style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}>
                <span className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
                  <span className={community ? 'text-warn' : 'text-brand'}>{community ? s.community : s.personal}</span>
                  {fresh && <span className="rounded bg-brand px-1 text-white">new</span>}
                  {m.date && <span className="font-medium normal-case text-muted">{new Date(m.date).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>}
                </span>
                {m.text.length > 180 ? m.text.slice(0, 180) + '…' : m.text}
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
    <section className="card p-4">
      <CardTitle icon={Users}>{s.alerts}</CardTitle>
      {loading ? <Skeleton rows={1} /> : rep.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-brand"><BadgeCheck className="size-4" /> {s.noAlerts}</p>
      ) : (
        <ul className="space-y-2">
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
    <li className="rounded-xl border border-warn/30 bg-warn-soft p-3 animate-fade-up">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" /> <span>{a.message}</span>
      </p>
      {!state.summary && (
        <button onClick={ask} disabled={state.loading}
          className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-warn hover:underline disabled:opacity-60">
          {state.loading ? <Loader2 className="size-4 animate-spin" /> : <MessageSquareQuote className="size-4" />} {s.askReputation}
        </button>
      )}
      {state.summary && (
        <p className="mt-2 rounded-lg bg-white/70 p-2 text-sm leading-relaxed animate-fade-up">
          <span className="mr-1 text-[10px] font-bold uppercase text-warn">Hindsight reflect</span>{state.summary}
        </p>
      )}
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
    </li>
  )
}
