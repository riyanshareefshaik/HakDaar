import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, BadgeCheck, Loader2, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { api, inr } from '../api'

/**
 * Admin dashboard (only for the account set by ADMIN_PHONE on the server; the server checks every call).
 * Overview numbers, every account, every employer report, and the "delete all data" switch.
 * English only: it is a tool for the team running HakDaar, not for workers.
 */
const TABS = [['overview', 'Overview'], ['workers', 'Workers'], ['orgs', 'Organizations'], ['reports', 'Reports'], ['danger', 'Danger zone']]

export default function AdminDashboard({ open, onClose, admin, onResetDone, showToast }) {
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState({ overview: null, workers: [], reports: [], orgs: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [overview, workers, reports, orgs] = await Promise.all([api.adminOverview(), api.adminWorkers(), api.adminReports(), api.adminOrgs()])
      setData({ overview, workers, reports, orgs })
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (open) load() }, [open, load])
  useEffect(() => {
    if (!open) return
    const esc = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-bg animate-fade" role="dialog" aria-modal="true" aria-label="Admin dashboard">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
        <span className="grid size-10 place-items-center rounded-full bg-white text-black"><ShieldCheck className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl leading-none text-white">Admin dashboard</p>
          <p className="mt-1 truncate text-[12.5px] text-muted">Signed in as {admin.name} · +91 {admin.phone}</p>
        </div>
        <button onClick={load} disabled={loading} className="btn-ghost" title="Refresh">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span className="hidden sm:inline">Refresh</span>
        </button>
        <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted hover:bg-white/10 hover:text-white"><X className="size-5" /></button>
      </header>

      <nav className="no-scrollbar flex gap-2 overflow-x-auto border-b border-line px-4 py-2.5 sm:px-6">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`shrink-0 rounded-full px-4 py-2 text-[14px] font-medium transition ${tab === k ? 'bg-white text-black' : 'border border-line-strong bg-pill text-fg2 hover:text-white'}`}>
            {label}
            {k === 'workers' && data.workers.length > 0 && <span className="ml-1.5 opacity-60">{data.workers.length}</span>}
            {k === 'reports' && data.reports.length > 0 && <span className="ml-1.5 opacity-60">{data.reports.length}</span>}
            {k === 'orgs' && data.orgs.length > 0 && <span className="ml-1.5 opacity-60">{data.orgs.length}</span>}
          </button>
        ))}
      </nav>

      <main className="scroll-thin flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-5xl">
          {error && <p className="mb-4 rounded-2xl border border-owed/40 bg-owed/10 p-3 text-sm text-owed">{error}</p>}
          {tab === 'overview' && <Overview o={data.overview} loading={loading} />}
          {tab === 'workers' && <Workers workers={data.workers} onChanged={load} showToast={showToast} />}
          {tab === 'reports' && <Reports reports={data.reports} onChanged={load} showToast={showToast} />}
          {tab === 'orgs' && <Orgs orgs={data.orgs} onChanged={load} showToast={showToast} />}
          {tab === 'danger' && <Danger onResetDone={onResetDone} showToast={showToast} />}
        </div>
      </main>
    </div>,
    document.body,
  )
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

function Overview({ o, loading }) {
  if (!o) return loading ? <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted" /> : null
  return (
    <div className="space-y-6">
      <section>
        <h2 className="eyebrow mb-3">People</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="Accounts" value={o.workers} />
          <Tile label="New today" value={o.new_workers_24h} hint="last 24 hours" />
          <Tile label="New this week" value={o.new_workers_7d} />
          <Tile label="Messages" value={o.messages} hint="sent by workers" />
          <Tile label="Organizations" value={o.organizations ?? 0} hint="employers & support groups" />
        </div>
      </section>
      <section>
        <h2 className="eyebrow mb-3">Money recorded</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Entries" value={o.entries} hint="promises, days, payments" />
          <Tile label="Employers" value={o.employers} />
          <Tile label="Paid to workers" value={inr(o.total_paid)} />
          <Tile label="Still owed" value={inr(o.total_owed)} tone={o.total_owed > 0 ? 'text-owed' : 'text-ok'} />
        </div>
      </section>
      <section>
        <h2 className="eyebrow mb-3">Employer reports</h2>
        <div className="grid grid-cols-3 gap-3">
          <Tile label="Short payment" value={o.reports_short} tone={o.reports_short ? 'text-owed' : 'text-white'} />
          <Tile label="Late payment" value={o.reports_late} tone={o.reports_late ? 'text-warn' : 'text-white'} />
          <Tile label="Paid in full" value={o.reports_ok} tone="text-ok" />
        </div>
      </section>
    </div>
  )
}

const date = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

function Workers({ workers, onChanged, showToast }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? workers.filter((w) => w.name.toLowerCase().includes(t) || (w.phone || '').includes(t)) : workers
  }, [q, workers])

  const remove = async (w) => {
    if (!window.confirm(`Delete ${w.name}${w.phone ? ` (+91 ${w.phone})` : ''}?\n\nTheir chats, ledger, reports and memory are removed. This cannot be undone.`)) return
    setBusy(w.id)
    try {
      const r = await api.adminDeleteWorker(w.id)
      showToast(r.warning || `${w.name} was deleted.`, r.warning ? 'error' : undefined)
      await onChanged()
    } catch (e) { showToast(e.message, 'error') } finally { setBusy(null) }
  }

  return (
    <div>
      <label className="field mb-4 flex items-center gap-2">
        <Search className="size-4 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone"
          className="min-w-0 flex-1 bg-transparent outline-none" />
      </label>
      {shown.length === 0 ? <p className="text-center text-sm text-muted">No accounts found.</p> : (
        <ul className="space-y-2">
          {shown.map((w) => (
            <li key={w.id} className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold text-white">
                  {w.name}
                  {w.is_admin && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-black">Admin</span>}
                </p>
                <p className="text-[13px] text-muted">{w.phone ? `+91 ${w.phone}` : 'no phone'} · joined {date(w.created_at)} · last active {date(w.last_active)}</p>
              </div>
              <div className="flex gap-4 text-[13px] text-fg2">
                <span><b className="text-white">{w.messages}</b> msgs</span>
                <span><b className="text-white">{w.entries}</b> entries</span>
                <span><b className="text-white">{w.reports}</b> reports</span>
                <span className={w.owed > 0 ? 'text-owed' : ''}>owed <b>{inr(w.owed)}</b></span>
              </div>
              {!w.is_admin && (
                <button onClick={() => remove(w)} disabled={busy === w.id} className="btn-dark px-3 py-1.5 text-sm hover:border-owed/60 hover:text-owed">
                  {busy === w.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const KIND = { short_payment: ['Short payment', 'text-owed'], late_payment: ['Late payment', 'text-warn'], paid_ok: ['Paid in full', 'text-ok'] }

function Reports({ reports, onChanged, showToast }) {
  const [busy, setBusy] = useState(null)
  const byEmployer = useMemo(() => {
    const m = new Map()
    for (const r of reports) m.set(r.employer_name, [...(m.get(r.employer_name) || []), r])
    return [...m.entries()]
  }, [reports])

  const remove = async (r) => {
    if (!window.confirm(`Remove this ${KIND[r.kind]?.[0].toLowerCase() || ''} report about ${r.employer_name} by ${r.worker_name || 'a deleted account'}?`)) return
    setBusy(r.id)
    try {
      await api.adminDeleteReport(r.id)
      showToast('Report removed. Warnings are recounted.')
      await onChanged()
    } catch (e) { showToast(e.message, 'error') } finally { setBusy(null) }
  }

  if (!reports.length) return <p className="text-center text-sm text-muted">No employer reports yet.</p>
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Reports are created from workers' ledgers. Remove one only if you believe it is false; a worker with
        a genuine problem will create it again with their next payment.
      </p>
      {byEmployer.map(([employer, rows]) => (
        <section key={employer} className="card p-4">
          <h3 className="mb-3 font-semibold text-white">{employer}
            <span className="ml-2 text-[13px] font-normal text-muted">{rows.length} report{rows.length !== 1 ? 's' : ''}</span>
          </h3>
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const [label, tone] = KIND[r.kind] || [r.kind, 'text-fg2']
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                  <span className={`w-32 shrink-0 text-sm font-medium ${tone}`}>{label}{r.amount_short ? ` · ${inr(r.amount_short)}` : ''}</span>
                  <span className="min-w-0 flex-1 text-[13px] text-fg2">
                    by <b className="text-white">{r.worker_name || 'deleted account'}</b>{r.worker_phone ? ` (+91 ${r.worker_phone})` : ''} · {date(r.created_at)}
                  </span>
                  <button onClick={() => remove(r)} disabled={busy === r.id} className="btn-ghost text-[13px] hover:text-owed">
                    {busy === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Remove
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Danger({ onResetDone, showToast }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const reset = async () => {
    setBusy(true)
    try {
      const r = await api.adminReset()
      if (r.warning) showToast(r.warning, 'error')
      onResetDone()
    } catch (e) { showToast(e.message, 'error'); setBusy(false) }
  }
  return (
    <section className="card border-owed/40 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-owed"><AlertTriangle className="size-5" /> Delete all data</h2>
      <p className="mt-2 text-sm text-fg2">
        Removes every account, chat, ledger entry, employer report and memory bank. Your admin account is
        recreated from the server settings, and you will need to log in again. This cannot be undone.
      </p>
      <label className="mt-4 block text-sm text-fg2">Type <b className="text-white">DELETE</b> to confirm
        <input value={text} onChange={(e) => setText(e.target.value)} className="field mt-2" autoComplete="off" />
      </label>
      <button onClick={reset} disabled={text !== 'DELETE' || busy}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-owed px-5 py-2.5 font-semibold text-white transition disabled:opacity-40">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete everything
      </button>
    </section>
  )
}

const REG_LABEL = { gstin: 'GSTIN', udyam: 'Udyam', pan: 'PAN', darpan: 'NGO Darpan', registration: 'Reg. no.' }

function Orgs({ orgs, onChanged, showToast }) {
  const [busy, setBusy] = useState(null)
  const act = async (id, fn, done) => {
    setBusy(id)
    try { await fn(); showToast(done); await onChanged() } catch (e) { showToast(e.message, 'error') } finally { setBusy(null) }
  }
  if (!orgs.length) return <p className="text-center text-sm text-muted">No organizations yet.</p>
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Formats are checked at sign-up. Before verifying, check the ID really belongs to them (links below) and call the owner's number.
        Verified employers get a badge and can publicly reply to reports.
      </p>
      <ul className="space-y-2">
        {orgs.map((o) => (
          <li key={o.id} className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold text-white">
                {o.name}
                {o.verified
                  ? <span className="flex items-center gap-1 rounded-full bg-ok/15 px-2 py-0.5 text-[11.5px] text-ok"><BadgeCheck className="size-3.5" /> Verified</span>
                  : <span className="rounded-full bg-pill px-2 py-0.5 text-[11.5px] text-fg2">Not verified</span>}
              </p>
              <p className="text-[13px] text-muted">
                {o.kind === 'employer' ? 'Employer' : 'Support group'}{o.category ? ` · ${o.category.replace('_', ' ')}` : ''} · owner +91 {o.owner_phone || '—'} · {o.members} login(s) · {o.workers} worker(s) · since {date(o.created_at)}
              </p>
              {o.reg_number && (
                <p className="mt-1 text-[13px] text-fg2">
                  <span className="font-mono">{REG_LABEL[o.reg_type] || 'Reg.'} {o.reg_number}</span> · {o.email} · {[o.area, o.city, o.pincode].filter(Boolean).join(', ')}
                  {o.reg_type === 'gstin' && <a href="https://services.gst.gov.in/services/searchtp" target="_blank" rel="noreferrer" className="ml-2 underline hover:text-white">check on GST portal</a>}
                  {o.reg_type === 'udyam' && <a href="https://udyamregistration.gov.in/Udyam_Verify.aspx" target="_blank" rel="noreferrer" className="ml-2 underline hover:text-white">check Udyam</a>}
                  {o.reg_type === 'darpan' && <a href="https://ngodarpan.gov.in/" target="_blank" rel="noreferrer" className="ml-2 underline hover:text-white">check NGO Darpan</a>}
                </p>
              )}
            </div>
            <button onClick={() => act(o.id, () => api.adminVerifyOrg(o.id, !o.verified), o.verified ? 'Verification removed.' : `${o.name} is verified.`)}
              disabled={busy === o.id} className={o.verified ? 'btn-dark px-3 py-1.5 text-sm' : 'btn-white px-3 py-1.5 text-sm'}>
              {busy === o.id ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />} {o.verified ? 'Unverify' : 'Verify'}
            </button>
            <button onClick={() => window.confirm(`Delete ${o.name}? Its logins and links are removed; entries workers already confirmed stay in their records.`)
              && act(o.id, () => api.adminDeleteOrg(o.id), `${o.name} was deleted.`)}
              disabled={busy === o.id} className="btn-dark px-3 py-1.5 text-sm hover:border-owed/60 hover:text-owed">
              <Trash2 className="size-4" /> Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
