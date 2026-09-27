import { useState } from 'react'
import { AlertTriangle, BadgeCheck, Brain, Building2, CircleAlert, Loader2, MessageSquareQuote, Users, Wallet } from 'lucide-react'
import { api, inr } from '../api'

export default function MemoryPanel({ s, worker, ledger, memories, memorySource, memoryError, alerts, loading }) {
  return (
    <div className="h-full space-y-4 overflow-y-auto scroll-thin p-4">
      <h2 className="flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted">
        <Brain className="size-4" /> {s.remembers}
      </h2>
      <LedgerCard s={s} ledger={ledger} loading={loading} />
      <MemoriesCard s={s} worker={worker} memories={memories} source={memorySource} error={memoryError} loading={loading} />
      <AlertsCard s={s} alerts={alerts} loading={loading} />
    </div>
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

function LedgerCard({ s, ledger, loading }) {
  const employers = ledger?.employers || []
  return (
    <section className="card p-4">
      <CardTitle icon={Wallet}>{s.ledger}</CardTitle>
      {loading ? <Skeleton /> : employers.length === 0 ? (
        <p className="text-sm text-muted">{s.noLedger}</p>
      ) : (
        <div className="space-y-3">
          {employers.map((r) => {
            const owed = r.amount_owed ?? 0
            const unknown = r.status === 'unknown_rate'
            return (
              <div key={r.employer_name} className={`rounded-xl border p-3 transition ${owed > 0 ? 'border-danger/25 bg-danger-soft/50' : 'border-black/5 bg-sand/60'}`}>
                <p className="flex items-center gap-1.5 font-semibold"><Building2 className="size-4 text-muted" /> {r.employer_name}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <Stat label={s.promised} value={unknown ? '?' : `${inr(r.rate_per_day)}${s.perDay}`} />
                  <Stat label={s.days} value={r.days_worked} />
                  <Stat label={s.paid} value={inr(r.amount_paid)} />
                </dl>
                <div className="mt-3 flex items-end justify-between border-t border-black/5 pt-2">
                  <span className="text-sm text-muted">
                    {unknown ? s.rateUnknown : `${s.earned}: ${inr(r.amount_earned)}`}
                  </span>
                  {unknown ? null : owed > 0 ? (
                    <span className="text-right">
                      <span className="block text-xs font-semibold uppercase tracking-wide text-danger">{s.owed}</span>
                      <span className="text-3xl font-extrabold leading-none text-danger">{inr(owed)}</span>
                    </span>
                  ) : (
                    <span className="text-right">
                      <span className="block text-xs font-semibold uppercase tracking-wide text-brand">{r.advance ? `${s.advance} ${inr(r.advance)}` : s.allPaid}</span>
                      <span className="text-3xl font-extrabold leading-none text-brand">₹0</span>
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          {employers.length > 1 && ledger.totals.amount_owed > 0 && (
            <p className="flex justify-between px-1 font-semibold text-danger">
              <span>{s.owed}</span><span>{inr(ledger.totals.amount_owed)}</span>
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}

function MemoriesCard({ s, worker, memories, source, error, loading }) {
  return (
    <section className="card p-4">
      <CardTitle icon={Brain} right={<span className="rounded-full bg-sand px-2 py-0.5 text-[11px] font-semibold text-muted">Hindsight</span>}>
        {s.memories}
      </CardTitle>
      <p className="-mt-2 mb-3 text-xs text-muted">
        {source === 'latest' ? s.memoriesLatest : `${s.memoriesProfile} ${worker?.name ?? ''}`}
      </p>
      {loading ? <Skeleton rows={1} /> : error ? (
        <p className="flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn"><CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}</p>
      ) : memories.length === 0 ? (
        <p className="text-sm text-muted">{s.noMemories}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {memories.map((m, i) => {
            const community = m.bank === 'employer-reputation'
            return (
              <li key={`${m.bank}-${m.id ?? i}`} title={m.text}
                className={`animate-fade-up rounded-xl border px-2.5 py-1.5 text-sm leading-snug ${community ? 'border-warn/25 bg-warn-soft text-ink' : 'border-brand/15 bg-brand-soft text-ink'}`}
                style={{ animationDelay: `${i * 40}ms` }}>
                <span className={`mr-1 text-[10px] font-bold uppercase ${community ? 'text-warn' : 'text-brand'}`}>
                  {community ? s.community : s.personal}
                </span>
                {m.text.length > 140 ? m.text.slice(0, 140) + '…' : m.text}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function AlertsCard({ s, alerts, loading }) {
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
    <li className="rounded-xl border border-warn/30 bg-warn-soft p-3">
      <p className="flex items-start gap-2 font-semibold text-warn">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" /> <span className="text-ink">{a.message}</span>
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
