import { useState } from 'react'
import { BadgeCheck, Banknote, Building2, CalendarCheck, Check, HeartHandshake, Loader2, X } from 'lucide-react'
import { inr } from '../api'

/**
 * The worker's inbox from organizations: invites to answer, and entries an employer recorded that
 * wait for "Yes, correct" / "Not correct". Nothing an employer records counts until the worker says yes.
 */
export default function OrgInbox({ s, inbox, onAnswer, onConfirm, onDispute }) {
  if (!inbox || (!inbox.invites.length && !inbox.pending.length)) return null
  return (
    <section className="mb-6 space-y-3">
      <h2 className="eyebrow">{s.waitingOk}</h2>
      {inbox.invites.map((inv) => <Invite key={inv.id} s={s} inv={inv} employers={inbox.my_employers} onAnswer={onAnswer} />)}
      {inbox.pending.map((e) => <Pending key={e.id} s={s} e={e} onConfirm={onConfirm} onDispute={onDispute} />)}
    </section>
  )
}

export function OrgBadge({ s, verified }) {
  return verified
    ? <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ok"><BadgeCheck className="size-3.5" /> {s.verifiedOrg}</span>
    : <span className="text-[12px] text-muted">{s.unverifiedOrg}</span>
}

function Invite({ s, inv, employers, onAnswer }) {
  const employer = inv.kind === 'employer'
  const [alias, setAlias] = useState(inv.suggested_alias || '')
  const [busy, setBusy] = useState(null)
  const Icon = employer ? Building2 : HeartHandshake
  const answer = async (accept) => {
    setBusy(accept ? 'yes' : 'no')
    try { await onAnswer(inv.id, accept, employer && accept ? alias || null : null) } finally { setBusy(null) }
  }
  return (
    <article className="card border-white/25 p-4 animate-rise">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-black"><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug text-white">{s.orgInviteFrom(inv.org_name)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
            {employer ? s.employerKind : s.supportKind} · <OrgBadge s={s} verified={inv.verified} />
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm text-fg2">{employer ? s.orgInviteEmployer : s.orgInviteSupport}</p>
      {employer && employers.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[13px] text-fg2">{s.orgWhich}</p>
          <div className="flex flex-wrap gap-2">
            {[...employers, ''].map((n) => (
              <button key={n || 'none'} onClick={() => setAlias(n)}
                className={`rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition ${alias === n ? 'bg-white text-black' : 'border border-line-strong bg-pill text-fg2 hover:text-white'}`}>
                {n || s.orgNone}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={() => answer(false)} disabled={!!busy} className="btn-dark py-2.5">
          {busy === 'no' ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} {s.decline}
        </button>
        <button onClick={() => answer(true)} disabled={!!busy} className="btn-white py-2.5">
          {busy === 'yes' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {s.accept}
        </button>
      </div>
    </article>
  )
}

function Pending({ s, e, onConfirm, onDispute }) {
  const [busy, setBusy] = useState(null)
  const paid = e.type === 'payment'
  const Icon = paid ? Banknote : CalendarCheck
  const when = e.date ? new Date(e.date + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''
  const act = async (fn, which) => { setBusy(which); try { await fn(e.id) } finally { setBusy(null) } }
  return (
    <article className="card p-4 animate-rise">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-fg2" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug text-white">
            {paid ? s.orgRecordedPaid(e.org_name, inr(e.amount)) : s.orgRecordedDays(e.org_name, e.days)}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
            {when}{e.notes ? ` · ${e.notes}` : ''} · <OrgBadge s={s} verified={!!e.org_verified} />
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => act(onDispute, 'no')} disabled={!!busy} className="btn-dark whitespace-nowrap px-3 py-2.5 hover:border-owed/60 hover:text-owed">
          {busy === 'no' ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} {s.notCorrect}
        </button>
        <button onClick={() => act(onConfirm, 'yes')} disabled={!!busy} className="btn-white whitespace-nowrap px-3 py-2.5">
          {busy === 'yes' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {s.confirmIt}
        </button>
      </div>
    </article>
  )
}
