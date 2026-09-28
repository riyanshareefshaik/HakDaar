import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, BadgeCheck, Banknote, Building2, CalendarCheck, Check, ChevronRight, HeartHandshake, Loader2, LogOut,
  MessageSquareQuote, Plus, RefreshCw, Send, Trash2, UserPlus, Users, X,
} from 'lucide-react'
import { api, inr } from '../api'
import Logo from './Logo'

/**
 * The organization side of HakDaar: employer companies and worker-support groups.
 * Separate logins from workers. English only (it's used by office staff, supervisors and caseworkers).
 */

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', supervisor: 'Supervisor', caseworker: 'Caseworker' }
const digits = (v, n) => v.replace(/\D/g, '').slice(0, n)

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[14px] font-medium text-fg2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  )
}

function ErrorLine({ error }) {
  return error ? <p className="rounded-xl border border-owed/40 bg-owed/10 px-3 py-2 text-sm text-owed">{error}</p> : null
}

// ================================================================= sign in / sign up

// Same format rules as the server (backend/app/validators.py), so mistakes show while typing.
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const gstinCheck = (g) => {
  let total = 0
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2)
    total += Math.floor(v / 36) + (v % 36)
  }
  return GST_CHARS[(36 - (total % 36)) % 36]
}
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const ID_RULES = {
  gstin: { label: 'GSTIN', ph: '36ABCDE1234F1Z5', max: 15,
    check: (v) => (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v) ? '15 characters: state code, PAN, entity number, Z, check'
      : !PAN.test(v.slice(2, 12)) ? 'Characters 3–12 must be a PAN' : gstinCheck(v) !== v[14] ? 'Last character doesn’t match. Check for typing mistakes' : null) },
  udyam: { label: 'Udyam (MSME)', ph: 'UDYAM-TS-02-0012345', max: 19,
    check: (v) => (/^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/.test(v) ? null : 'Looks like UDYAM-TS-02-0012345') },
  pan: { label: 'PAN', ph: 'ABCPE1234F', max: 10,
    check: (v) => (PAN.test(v) && 'PCFHATBLJG'.includes(v[3]) ? null : '10 characters: 5 letters, 4 digits, 1 letter') },
}
const SUPPORT_REG = {
  ngo: { label: 'NGO Darpan ID', ph: 'TS/2019/0123456', check: (v) => (/^[A-Z]{2}\/[0-9]{4}\/[0-9]{7}$/.test(v) ? null : 'Looks like TS/2019/0123456') },
  union: { label: 'Trade union registration number', ph: 'e.g. TU/HYD/1234' },
  labour_office: { label: 'Office code / order number', ph: 'e.g. ALC/HYD/05' },
  legal_aid: { label: 'Registration number', ph: 'e.g. DLSA/HYD/102' },
  other: { label: 'Registration number', ph: 'Society / trust registration number' },
}
const otherReg = (v) => (/^[A-Z0-9][A-Z0-9/\-. ]{2,39}$/.test(v) ? null : '3 to 40 letters, digits, / or -')

export function OrgLogin({ onLogin, onBack, onOpenLegal }) {
  const [mode, setMode] = useState('login')
  const blank = { org_name: '', kind: 'employer', category: '', reg_type: 'gstin', reg_number: '', email: '', area: '', city: 'Hyderabad',
    pincode: '', phone: '', pin: '', pin_confirm: '', accept_terms: false }
  const [f, setF] = useState(blank)
  const [options, setOptions] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  useEffect(() => { api.orgOptions().then(setOptions).catch(() => {}) }, [])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const employer = f.kind === 'employer'
  const regRule = employer ? ID_RULES[f.reg_type] : SUPPORT_REG[f.category] || SUPPORT_REG.other
  const regValue = f.reg_number.trim().toUpperCase()
  const regProblem = regValue && (regRule.check ? regRule.check(regValue) : otherReg(regValue))

  const pickKind = (kind) => setF({ ...f, kind, category: '', reg_type: kind === 'employer' ? 'gstin' : 'registration', reg_number: '' })
  const pickSupportType = (category) => setF({ ...f, category, reg_type: category === 'ngo' ? 'darpan' : 'registration', reg_number: '' })

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (mode === 'register' && regProblem) return setError(`${regRule.label}: ${regProblem}.`)
    setBusy(true)
    try {
      if (mode === 'login') {
        await onLogin({ phone: f.phone, pin: f.pin })
      } else {
        await api.orgRegister({ ...f, reg_number: regValue })
        setNotice('Organization registered. Log in with your mobile number and PIN. HakDaar will verify your details.')
        setMode('login'); setF({ ...f, pin: '', pin_confirm: '' })
      }
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const types = options?.[f.kind] || {}
  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-8">
      <button onClick={onBack} className="btn-ghost -ml-3 mb-4"><ArrowLeft className="size-4" /> Worker login</button>
      <h1 className="font-display text-4xl leading-tight text-white">HakDaar for organizations</h1>
      <p className="mt-2 text-fg2">For employers who record work and payments, and for groups that help workers get paid.</p>

      <div className="glass mt-6 p-5 sm:p-6">
        <div className="mb-5 grid grid-cols-2 rounded-full bg-white p-1">
          {[['login', 'Log in'], ['register', 'Register organization']].map(([k, label]) => (
            <button key={k} onClick={() => { setMode(k); setError(null); setNotice(null) }}
              className={`rounded-full py-2 text-[14.5px] font-medium transition ${mode === k ? 'bg-black text-white' : 'text-ink opacity-60 hover:opacity-90'}`}>{label}</button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-4">
          {notice && <p className="rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</p>}
          <ErrorLine error={error} />
          {mode === 'register' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {[['employer', Building2, 'Employer', 'Record work & payments'], ['support', HeartHandshake, 'Support group', 'NGO, union, labour office']].map(([k, Icon, t, d]) => (
                  <button type="button" key={k} onClick={() => pickKind(k)}
                    className={`rounded-2xl border p-3 text-left transition ${f.kind === k ? 'border-white bg-white text-black' : 'border-line bg-card text-fg2 hover:text-white'}`}>
                    <Icon className="mb-1.5 size-5" />
                    <span className="block font-semibold">{t}</span>
                    <span className={`block text-[12px] ${f.kind === k ? 'text-black/60' : 'text-muted'}`}>{d}</span>
                  </button>
                ))}
              </div>

              <p className="eyebrow pt-1">{employer ? 'Business details' : 'Organization details'}</p>
              <Field label={employer ? 'Registered business name (as workers know it)' : 'Registered organization name'}
                hint={employer ? 'e.g. "Rakesh Builders". Workers link their records to this name.' : null}>
                <input className="field" value={f.org_name} onChange={set('org_name')} minLength={3} maxLength={80} required />
              </Field>
              <Field label={employer ? 'Type of business' : 'Type of organization'}>
                <select className="field" value={f.category} required
                  onChange={(e) => (employer ? setF({ ...f, category: e.target.value }) : pickSupportType(e.target.value))}>
                  <option value="" disabled>Choose…</option>
                  {Object.entries(types).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>

              {employer ? (
                <div>
                  <span className="mb-1.5 block text-[14px] font-medium text-fg2">Government business ID</span>
                  <div className="mb-2 grid grid-cols-3 gap-1 rounded-full bg-white p-1">
                    {Object.entries(ID_RULES).map(([k, r]) => (
                      <button type="button" key={k} onClick={() => setF({ ...f, reg_type: k, reg_number: '' })}
                        className={`rounded-full py-1.5 text-[13.5px] font-medium transition ${f.reg_type === k ? 'bg-black text-white' : 'text-ink opacity-60 hover:opacity-90'}`}>{r.label}</button>
                    ))}
                  </div>
                  <input className={`field font-mono uppercase tracking-wide ${regProblem ? 'field-error' : ''}`} value={f.reg_number}
                    onChange={(e) => setF({ ...f, reg_number: e.target.value.toUpperCase() })} maxLength={regRule.max + 2}
                    placeholder={regRule.ph} autoComplete="off" required />
                  <span className={`mt-1 block text-[12px] ${regProblem ? 'text-owed' : 'text-muted'}`}>
                    {regProblem || 'GSTIN if registered for GST; otherwise your Udyam (MSME) number or the business PAN. One organization per ID.'}
                  </span>
                </div>
              ) : f.category && (
                <Field label={regRule.label}>
                  <input className={`field font-mono uppercase tracking-wide ${regProblem ? 'field-error' : ''}`} value={f.reg_number}
                    onChange={(e) => setF({ ...f, reg_number: e.target.value.toUpperCase() })} maxLength={40}
                    placeholder={regRule.ph} autoComplete="off" required />
                  {regProblem && <span className="mt-1 block text-[12px] text-owed">{regProblem}</span>}
                </Field>
              )}

              <Field label="Official email" hint="Used by HakDaar to verify your organization. One organization per email.">
                <input className="field" type="email" value={f.email} onChange={set('email')} maxLength={120} placeholder="office@company.in" required />
              </Field>
              {employer && (
                <Field label="Work-site area"><input className="field" value={f.area} onChange={set('area')} maxLength={80} placeholder="e.g. Kukatpally" required /></Field>
              )}
              <div className="grid grid-cols-[1fr_130px] gap-3">
                <Field label="City"><input className="field" value={f.city} onChange={set('city')} maxLength={60} required /></Field>
                <Field label="PIN code">
                  <input className="field" inputMode="numeric" value={f.pincode} onChange={(e) => setF({ ...f, pincode: digits(e.target.value, 6) })} placeholder="500072" required />
                </Field>
              </div>
              <p className="eyebrow pt-1">Login</p>
            </>
          )}
          <Field label="Mobile number" hint={mode === 'register' ? 'You log in with this number. Add your team later from the Team tab.' : null}>
            <input className="field" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: digits(e.target.value, 10) })} placeholder="98765 43210" required />
          </Field>
          <Field label="4-digit PIN">
            <input className="field tracking-[0.5em]" type="password" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: digits(e.target.value, 4) })} required />
          </Field>
          {mode === 'register' && (
            <>
              <Field label="Enter the PIN again">
                <input className="field tracking-[0.5em]" type="password" inputMode="numeric" value={f.pin_confirm} onChange={(e) => setF({ ...f, pin_confirm: digits(e.target.value, 4) })} required />
              </Field>
              <label className="flex items-start gap-2.5 text-sm text-fg2">
                <input type="checkbox" checked={f.accept_terms} onChange={set('accept_terms')} className="mt-1 size-4 accent-white" />
                <span>I confirm these details are true, and I accept the <button type="button" onClick={() => onOpenLegal('terms')} className="underline">Terms of Use</button> and{' '}
                  <button type="button" onClick={() => onOpenLegal('privacy')} className="underline">Privacy Policy</button>.</span>
              </label>
            </>
          )}
          <button type="submit" disabled={busy} className="btn-white w-full py-3">
            {busy && <Loader2 className="size-4 animate-spin" />} {mode === 'login' ? 'Log in' : 'Register organization'}
          </button>
        </form>
      </div>
      <p className="mt-4 text-center text-[12.5px] text-muted">
        Workers always stay in control: they accept your invite, and nothing you record counts until they confirm it.
      </p>
    </div>
  )
}

// ================================================================= dashboard

export function OrgApp({ session, onLogout, showToast }) {
  const { member, org } = session
  const employer = org.kind === 'employer'
  const tabs = employer
    ? [['dues', 'Dues'], ['workers', 'Workers'], ['reputation', 'Reputation'], ['team', 'Team']]
    : [['cases', 'Cases'], ['workers', 'Workers'], ['team', 'Team']]
  const [tab, setTab] = useState(tabs[0][0])

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong bg-black"><Logo size={34} /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-lg font-semibold text-white">
            {org.name}
            {org.verified && <BadgeCheck className="size-4 shrink-0 text-ok" title="Verified by HakDaar" />}
          </p>
          <p className="truncate text-[12.5px] text-muted">
            {employer ? 'Employer' : 'Support group'}{org.city ? ` · ${org.city}` : ''} · {member.role === 'owner' ? 'Owner' : `${member.name} (${ROLE_LABEL[member.role]})`}{!org.verified && ' · not verified yet'}
          </p>
        </div>
        <button onClick={onLogout} className="btn-dark px-4 py-2 text-sm"><LogOut className="size-4" /> <span className="hidden sm:inline">Log out</span></button>
      </header>
      <nav className="no-scrollbar flex gap-2 overflow-x-auto border-b border-line px-4 py-2.5 sm:px-6">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`shrink-0 rounded-full px-4 py-2 text-[14px] font-medium transition ${tab === k ? 'bg-white text-black' : 'border border-line-strong bg-pill text-fg2 hover:text-white'}`}>{label}</button>
        ))}
      </nav>
      <main className="scroll-thin flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-5xl">
          {tab === 'dues' && <Dues member={member} showToast={showToast} />}
          {tab === 'cases' && <Cases showToast={showToast} />}
          {tab === 'workers' && <Workers member={member} org={org} showToast={showToast} />}
          {tab === 'reputation' && <Reputation member={member} org={org} showToast={showToast} />}
          {tab === 'team' && <Team member={member} org={org} showToast={showToast} />}
        </div>
      </main>
    </div>
  )
}

function useLoad(fn) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await fn()) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [fn])
  useEffect(() => { load() }, [load])
  return { data, error, loading, load }
}

function Tile({ label, value, tone = 'text-white', hint }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className={`mt-1 font-display text-3xl tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  )
}

function Toolbar({ title, onRefresh, loading, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <h2 className="flex-1 font-display text-2xl text-white">{title}</h2>
      {children}
      <button onClick={onRefresh} className="btn-ghost" title="Refresh">
        {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      </button>
    </div>
  )
}

const Empty = ({ children }) => <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>

// ----------------------------------------------------------------- employer: dues

function Dues({ member, showToast }) {
  const { data, error, loading, load } = useLoad(api.orgDues)
  const [recording, setRecording] = useState(null)   // { worker, type }
  const [open, setOpen] = useState(null)             // worker_id whose entries are shown
  const t = data?.totals
  return (
    <div>
      <Toolbar title="Dues" onRefresh={load} loading={loading} />
      <ErrorLine error={error} />
      {t && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="Still owed" value={inr(t.owed)} tone={t.owed > 0 ? 'text-owed' : 'text-ok'} />
          <Tile label="Paid" value={inr(t.paid)} />
          <Tile label="Earned" value={inr(t.earned)} />
          <Tile label="Waiting for OK" value={t.pending} hint="entries workers haven't confirmed" />
          <Tile label="Disputed" value={t.disputed} tone={t.disputed ? 'text-warn' : 'text-white'} hint="workers said not correct" />
        </div>
      )}
      <p className="mb-3 text-sm text-muted">
        Amounts come from entries workers have confirmed. What you record shows as "waiting" until the worker says it's correct.
      </p>
      {data && data.workers.length === 0 && <Empty>No workers yet. Invite them from the Workers tab.</Empty>}
      <ul className="space-y-2">
        {data?.workers.map((w) => (
          <li key={w.worker_id} className="card p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{w.worker_name}</p>
                <p className="text-[13px] text-muted">+91 {w.worker_phone} · {w.rate_per_day ? `${inr(w.rate_per_day)}/day · ` : ''}{w.days_worked} days</p>
              </div>
              <div className="flex gap-4 text-[13px] text-fg2">
                <span>earned <b className="text-white">{inr(w.earned)}</b></span>
                <span>paid <b className="text-white">{inr(w.paid)}</b></span>
                {w.advance > 0
                  ? <span className="text-warn">paid extra <b>{inr(w.advance)}</b></span>
                  : <span className={w.owed > 0 ? 'text-owed' : 'text-ok'}>owed <b>{inr(w.owed)}</b></span>}
                {w.pending > 0 && <span className="text-muted">{w.pending} waiting</span>}
                {w.disputed > 0 && <span className="text-warn">{w.disputed} disputed</span>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setRecording({ worker: w, type: 'work_day' })} className="btn-dark px-3.5 py-1.5 text-sm"><CalendarCheck className="size-4" /> Record days</button>
              <button onClick={() => setRecording({ worker: w, type: 'payment' })} className="btn-dark px-3.5 py-1.5 text-sm"><Banknote className="size-4" /> Record payment</button>
              <button onClick={() => setOpen(open === w.worker_id ? null : w.worker_id)} className="btn-ghost text-sm">
                <ChevronRight className={`size-4 transition ${open === w.worker_id ? 'rotate-90' : ''}`} /> Your entries
              </button>
            </div>
            {open === w.worker_id && <Entries workerId={w.worker_id} />}
          </li>
        ))}
      </ul>
      {recording && <RecordSheet {...recording} onClose={() => setRecording(null)}
        onSaved={() => { setRecording(null); showToast('Recorded. It will count once the worker confirms it.'); load() }} />}
    </div>
  )
}

const STATUS = { pending: ['Waiting for worker', 'text-muted'], confirmed: ['Confirmed', 'text-ok'], merged: ['Confirmed (matched their entry)', 'text-ok'], disputed: ['Disputed', 'text-warn'] }

function Entries({ workerId }) {
  const fn = useCallback(() => api.orgWorkerEntries(workerId), [workerId])
  const { data, loading } = useLoad(fn)
  if (loading) return <Loader2 className="mt-3 size-4 animate-spin text-muted" />
  if (!data?.length) return <p className="mt-3 text-sm text-muted">You haven't recorded anything for this worker yet.</p>
  return (
    <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
      {data.map((e) => {
        const [label, tone] = STATUS[e.status] || [e.status, 'text-fg2']
        return (
          <li key={e.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-sm">
            <span className="flex-1 text-fg2">{e.type === 'payment' ? `Paid ${inr(e.amount)}` : `Worked ${e.days} day(s)`} · {e.date}</span>
            <span className={`text-[12.5px] font-medium ${tone}`}>{label}{e.dispute_reason ? `: "${e.dispute_reason}"` : ''}</span>
          </li>
        )
      })}
    </ul>
  )
}

function RecordSheet({ worker, type, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10)
  const [v, setV] = useState({ days: '1', amount: '', date: today, note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      await api.orgRecord(worker.worker_id, type === 'payment'
        ? { type, amount: Number(v.amount), date: v.date, note: v.note || null }
        : { type, days: Number(v.days), date: v.date, note: v.note || null })
      onSaved()
    } catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <Sheet title={`${type === 'payment' ? 'Record a payment to' : 'Record days worked by'} ${worker.worker_name}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <ErrorLine error={error} />
        {type === 'payment'
          ? <Field label="Amount paid (₹)"><input className="field" inputMode="numeric" autoFocus value={v.amount} onChange={(e) => setV({ ...v, amount: digits(e.target.value, 8) })} required /></Field>
          : <Field label="Days worked"><input className="field" type="number" min="0.5" max="60" step="0.5" value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })} required /></Field>}
        <Field label="Date"><input className="field" type="date" max={today} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} required /></Field>
        <Field label="Note (optional)"><input className="field" maxLength={200} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="e.g. cash, site 2" /></Field>
        <p className="text-[12.5px] text-muted">The worker will see this and confirm it. If they already noted the same thing, it's counted once.</p>
        <button disabled={busy} className="btn-white w-full py-3">{busy && <Loader2 className="size-4 animate-spin" />} Save</button>
      </form>
    </Sheet>
  )
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center animate-fade" onClick={onClose}>
      <div className="scroll-thin max-h-[calc(100dvh-0.5rem)] w-full max-w-md overflow-y-auto rounded-t-[28px] border border-line bg-surface p-5 animate-sheet sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-4 flex items-start gap-3">
          <h3 className="flex-1 text-lg font-semibold leading-snug text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-white"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- workers (both kinds)

function Workers({ member, org, showToast }) {
  const { data, error, loading, load } = useLoad(api.orgWorkers)
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const canInvite = ['owner', 'manager', 'caseworker'].includes(member.role)
  const invite = async (e) => {
    e.preventDefault(); setBusy(true)
    try {
      const r = await api.orgInvite(phone)
      showToast(r.status === 'active' ? `${r.worker_name} is already connected.` : `Invite sent to ${r.worker_name}.`)
      setPhone(''); load()
    } catch (err) { showToast(err.message, 'error') } finally { setBusy(false) }
  }
  const remove = async (w) => {
    if (!window.confirm(`Remove ${w.worker_name} from ${org.name}?`)) return
    try { await api.orgRemoveWorker(w.worker_id); load() } catch (err) { showToast(err.message, 'error') }
  }
  return (
    <div>
      <Toolbar title="Workers" onRefresh={load} loading={loading} />
      {canInvite && (
        <form onSubmit={invite} className="card mb-5 flex flex-wrap items-end gap-3 p-4">
          <label className="min-w-[220px] flex-1">
            <span className="mb-1.5 block text-[14px] font-medium text-fg2">Invite a worker by their HakDaar phone number</span>
            <input className="field" inputMode="tel" value={phone} onChange={(e) => setPhone(digits(e.target.value, 10))} placeholder="98765 43210" required />
          </label>
          <button disabled={busy || phone.length !== 10} className="btn-white py-2.5">{busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} Invite</button>
          <p className="basis-full text-[12.5px] text-muted">
            {org.kind === 'employer'
              ? 'The worker accepts in their app and chooses which of their employers you are, so their past records join yours without duplicates.'
              : 'The worker accepts in their app. Only then can you see their record, and they can leave at any time.'}
          </p>
        </form>
      )}
      <ErrorLine error={error} />
      {data && data.length === 0 && <Empty>No workers yet.</Empty>}
      <ul className="space-y-2">
        {data?.map((w) => (
          <li key={w.id} className="card flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">{w.worker_name}</p>
              <p className="text-[13px] text-muted">+91 {w.worker_phone}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-[12.5px] font-medium ${w.status === 'active' ? 'bg-ok/15 text-ok' : 'bg-pill text-fg2'}`}>
              {w.status === 'active' ? 'Connected' : 'Invite sent'}
            </span>
            {canInvite && <button onClick={() => remove(w)} className="btn-ghost text-sm hover:text-owed"><Trash2 className="size-4" /> Remove</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ----------------------------------------------------------------- employer: reputation

function Reputation({ member, org, showToast }) {
  const { data, error, loading, load } = useLoad(api.orgReputation)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const canReply = ['owner', 'manager'].includes(member.role)
  const reply = async (e) => {
    e.preventDefault(); setBusy(true)
    try { await api.orgReply(text); setText(''); showToast('Reply published.'); load() } catch (err) { showToast(err.message, 'error') } finally { setBusy(false) }
  }
  const st = data?.stats
  return (
    <div>
      <Toolbar title="Reputation" onRefresh={load} loading={loading} />
      <ErrorLine error={error} />
      <p className="mb-4 text-sm text-muted">What workers have reported about "{org.name}". You never see who reported. One report alone is shown to workers as unverified.</p>
      {st && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          <Tile label="Short payment" value={st.short_payment} tone={st.short_payment ? 'text-owed' : 'text-white'} />
          <Tile label="Late payment" value={st.late_payment} tone={st.late_payment ? 'text-warn' : 'text-white'} />
          <Tile label="Paid in full" value={st.paid_ok} tone="text-ok" />
        </div>
      )}
      {data?.summary && (
        <div className="card mb-5 p-4">
          <p className="eyebrow mb-2 flex items-center gap-1.5"><MessageSquareQuote className="size-3.5" /> Summary from HakDaar's memory</p>
          <p className="text-fg2">{data.summary}</p>
        </div>
      )}
      <section className="card p-4">
        <h3 className="mb-2 font-semibold text-white">Your public reply</h3>
        {!data?.verified ? (
          <p className="text-sm text-muted">Replies are shown to workers once HakDaar has verified your organization. This stops anyone posing as you.</p>
        ) : canReply ? (
          <form onSubmit={reply} className="space-y-3">
            <textarea className="field min-h-24" maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="e.g. We pay every Saturday at the site office. Any worker with a problem can call our manager." required />
            <button disabled={busy || text.trim().length < 3} className="btn-white py-2.5">{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Publish reply</button>
          </form>
        ) : <p className="text-sm text-muted">Only the owner or a manager can reply.</p>}
        {data?.replies?.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-line pt-3">
            {data.replies.map((r) => <li key={r.id} className="text-sm text-fg2">"{r.text}" <span className="text-[12px] text-muted">· {new Date(r.created_at).toLocaleDateString()}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  )
}

// ----------------------------------------------------------------- support: cases

function Cases({ showToast }) {
  const { data, error, loading, load } = useLoad(api.orgCases)
  const [openId, setOpenId] = useState(null)
  if (openId) return <CaseDetail workerId={openId} onBack={() => { setOpenId(null); load() }} showToast={showToast} />
  const open = data?.filter((c) => c.case_status === 'open') || []
  return (
    <div>
      <Toolbar title="Cases" onRefresh={load} loading={loading} />
      <ErrorLine error={error} />
      {data && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <Tile label="Open cases" value={open.length} />
          <Tile label="Owed to them" value={inr(open.reduce((n, c) => n + c.owed, 0))} tone="text-owed" hint="open cases" />
          <Tile label="Disputed entries" value={data.reduce((n, c) => n + c.disputed, 0)} tone="text-warn" />
        </div>
      )}
      {data && data.length === 0 && <Empty>No workers have joined yet. Invite them from the Workers tab.</Empty>}
      <ul className="space-y-2">
        {data?.map((c) => (
          <li key={c.worker_id}>
            <button onClick={() => setOpenId(c.worker_id)} className="card flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-4 text-left transition hover:bg-raised">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{c.worker_name}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[11.5px] ${c.case_status === 'open' ? 'bg-owed/15 text-owed' : 'bg-ok/15 text-ok'}`}>{c.case_status}</span>
                </p>
                <p className="text-[13px] text-muted">{c.employers_owing.length ? `Owed by ${c.employers_owing.join(', ')}` : 'Nothing owed'} · {c.notes} note(s)</p>
              </div>
              <span className={`font-display text-2xl tabular-nums ${c.owed > 0 ? 'text-owed' : 'text-ok'}`}>{inr(c.owed)}</span>
              <ChevronRight className="size-5 text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CaseDetail({ workerId, onBack, showToast }) {
  const fn = useCallback(() => api.orgCase(workerId), [workerId])
  const { data, error, loading, load } = useLoad(fn)
  const [note, setNote] = useState('')
  const addNote = async (e) => {
    e.preventDefault()
    try { await api.orgAddNote(workerId, note); setNote(''); load() } catch (err) { showToast(err.message, 'error') }
  }
  const toggle = async () => {
    try { await api.orgCaseStatus(workerId, data.case_status === 'open' ? 'resolved' : 'open'); load() } catch (err) { showToast(err.message, 'error') }
  }
  return (
    <div>
      <button onClick={onBack} className="btn-ghost -ml-3 mb-3"><ArrowLeft className="size-4" /> All cases</button>
      <ErrorLine error={error} />
      {loading && !data && <Loader2 className="size-5 animate-spin text-muted" />}
      {data && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <h2 className="font-display text-2xl text-white">{data.worker.name}</h2>
              <p className="text-[13px] text-muted">+91 {data.worker.phone}</p>
            </div>
            <button onClick={toggle} className={data.case_status === 'open' ? 'btn-white py-2' : 'btn-dark py-2'}>
              <Check className="size-4" /> {data.case_status === 'open' ? 'Mark resolved' : 'Reopen case'}
            </button>
          </div>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Tile label="Earned" value={inr(data.totals.amount_earned)} />
            <Tile label="Paid" value={inr(data.totals.amount_paid)} />
            <Tile label="Still owed" value={inr(data.totals.amount_owed)} tone={data.totals.amount_owed > 0 ? 'text-owed' : 'text-ok'} />
          </div>
          <h3 className="eyebrow mb-2">By employer</h3>
          <ul className="mb-5 space-y-2">
            {data.ledger.map((r) => (
              <li key={r.employer_name} className="card flex flex-wrap items-center gap-x-4 gap-y-1 p-3.5 text-sm">
                <span className="flex-1 font-semibold text-white">{r.employer_name}</span>
                <span className="text-fg2">{r.rate_per_day ? `${inr(r.rate_per_day)}/day · ` : ''}{r.days_worked} days</span>
                <span className="text-fg2">paid {inr(r.amount_paid)}</span>
                <span className={(r.amount_owed || 0) > 0 ? 'font-semibold text-owed' : 'text-ok'}>owed {inr(r.amount_owed || 0)}</span>
              </li>
            ))}
            {data.ledger.length === 0 && <Empty>Nothing recorded yet.</Empty>}
          </ul>
          {data.disputes.length > 0 && (
            <>
              <h3 className="eyebrow mb-2">Disputed by the worker</h3>
              <ul className="mb-5 space-y-2">
                {data.disputes.map((d) => (
                  <li key={d.id} className="card p-3.5 text-sm text-fg2">
                    <b className="text-white">{d.org_name}</b> says {d.type === 'payment' ? `they paid ${inr(d.amount)}` : `${d.days} day(s) worked`} on {d.date}
                    {d.dispute_reason && <span className="text-warn">: worker says "{d.dispute_reason}"</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className="eyebrow mb-2">Case notes</h3>
          <form onSubmit={addNote} className="mb-3 flex gap-2">
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Called the employer; promised to pay on Friday." />
            <button disabled={!note.trim()} className="btn-white shrink-0 px-4"><Plus className="size-4" /> Add</button>
          </form>
          <ul className="space-y-2">
            {data.notes.map((n) => (
              <li key={n.id} className="card p-3.5 text-sm">
                <p className="text-fg2">{n.text}</p>
                <p className="mt-1 text-[12px] text-muted">{n.member_name || 'Team member'} · {new Date(n.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- team

function Team({ member, org, showToast }) {
  const { data, error, loading, load } = useLoad(api.orgMembers)
  const roles = org.kind === 'employer' ? ['manager', 'supervisor'] : ['caseworker']
  const [f, setF] = useState({ name: '', phone: '', pin: '', role: roles[0] })
  const [busy, setBusy] = useState(false)
  const owner = member.role === 'owner'
  const add = async (e) => {
    e.preventDefault(); setBusy(true)
    try { await api.orgAddMember(f); showToast(`${f.name} can now log in.`); setF({ name: '', phone: '', pin: '', role: roles[0] }); load() }
    catch (err) { showToast(err.message, 'error') } finally { setBusy(false) }
  }
  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.name}'s login?`)) return
    try { await api.orgRemoveMember(m.id); load() } catch (err) { showToast(err.message, 'error') }
  }
  return (
    <div>
      <Toolbar title="Team" onRefresh={load} loading={loading} />
      <ErrorLine error={error} />
      <p className="mb-4 text-sm text-muted">
        {org.kind === 'employer'
          ? 'Managers can invite workers, record entries and reply to reports. Supervisors can record days and payments.'
          : 'Caseworkers can invite workers, see cases and add notes.'} Only the owner manages the team.
      </p>
      {owner && (
        <form onSubmit={add} className="card mb-5 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_110px_150px_auto] sm:items-end">
          <Field label="Name"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} required /></Field>
          <Field label="Mobile"><input className="field" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: digits(e.target.value, 10) })} required /></Field>
          <Field label="PIN"><input className="field" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: digits(e.target.value, 4) })} required /></Field>
          <Field label="Role">
            <select className="field" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
          <button disabled={busy || f.phone.length !== 10 || f.pin.length !== 4} className="btn-white py-2.5">{busy ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />} Add</button>
        </form>
      )}
      <ul className="space-y-2">
        {data?.map((m) => (
          <li key={m.id} className="card flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">{m.name}{m.id === member.id && <span className="ml-2 text-[12px] font-normal text-muted">(you)</span>}</p>
              <p className="text-[13px] text-muted">+91 {m.phone}</p>
            </div>
            <span className="rounded-full bg-pill px-3 py-1 text-[12.5px] font-medium text-fg2">{ROLE_LABEL[m.role]}</span>
            {owner && m.id !== member.id && <button onClick={() => remove(m)} className="btn-ghost text-sm hover:text-owed"><Trash2 className="size-4" /> Remove</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}
