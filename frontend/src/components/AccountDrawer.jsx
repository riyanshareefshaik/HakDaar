import { useEffect, useState } from 'react'
import { Loader2, LogOut, Moon, Phone, RefreshCw, ShieldCheck, Sun, Trash2, X } from 'lucide-react'
import { Avatar } from './Header'
import { AlertsCard, HowCalculated, MemoriesCard } from './LedgerPanel'

/** Slide-over "My account": profile, what HakDaar has learned, employer warnings, connections, log out. */
export default function AccountDrawer({ s, open, onClose, worker, section, memoryProps, alerts, onLogout, onDelete, onOpenAdmin, health, onRecheck, onOpenLegal, theme, onTheme }) {
  const [tab, setTab] = useState(section || 'memories')
  useEffect(() => { if (open && section) setTab(section) }, [open, section])
  useEffect(() => {
    if (!open) return
    const esc = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open, onClose])

  if (!open || !worker) return null
  const repCount = alerts.filter((a) => a.type === 'employer_reputation').length

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={s.account}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md animate-fade" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface animate-drawer">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <Avatar name={worker.name} size="size-12" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold leading-tight text-white">{worker.name}</p>
            {worker.phone && <p className="flex items-center gap-1.5 text-sm text-fg2/80"><Phone className="size-3.5" /> +91 {worker.phone}</p>}
            <p className="truncate text-[12px] text-muted">{s.memoryBank}: worker-{worker.id}</p>
          </div>
          <button onClick={onClose} aria-label={s.close} className="rounded-full p-2 text-muted hover:bg-white/10 hover:text-white"><X className="size-5" /></button>
        </div>

        {/* Section switch: the same white pill + three-dot marker as the landing nav */}
        <nav className="mx-5 mb-2 grid h-11 grid-cols-2 items-center rounded-full bg-white px-2" aria-label={s.account}>
          {[['memories', s.memories, memoryProps.learned.total], ['alerts', s.alerts, repCount]].map(([k, label, n]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`relative pb-2.5 pt-2 text-[14.5px] font-medium text-ink transition ${tab === k ? 'dot-active opacity-100' : 'opacity-50 hover:opacity-75'}`}>
              {label}{n > 0 && <span className="ml-1 tabular-nums opacity-60">{n}</span>}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto scroll-thin px-5 py-4">
          {tab === 'memories' ? <MemoriesCard s={s} {...memoryProps} /> : <AlertsCard s={s} alerts={alerts} loading={false} />}
        </div>

        <Appearance s={s} theme={theme} onTheme={onTheme} />
        <HowCalculated s={s} />
        <Connections s={s} health={health} onRecheck={onRecheck} />

        <div className="space-y-2 border-t border-line p-5">
          {worker.is_admin && (
            <button onClick={onOpenAdmin} className="btn-dark w-full"><ShieldCheck className="size-4" /> Admin dashboard</button>
          )}
          <button onClick={onLogout} className="btn-white w-full"><LogOut className="size-4" /> {s.logout}</button>
          <button onClick={onDelete} className="btn-dark w-full hover:border-owed/60 hover:text-owed"><Trash2 className="size-4" /> {s.deleteAccount}</button>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[12px] text-muted">
            <span className="flex gap-4">
              <button onClick={() => onOpenLegal('terms')} className="hover:text-white">{s.terms}</button>
              <button onClick={() => onOpenLegal('privacy')} className="hover:text-white">{s.privacy}</button>
            </span>
          </div>
        </div>
      </aside>
    </div>
  )
}

/** Dark / light switch. Lives only here, in the signed-in account (the public landing page stays dark). */
function Appearance({ s, theme, onTheme }) {
  return (
    <section className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
      <h3 className="eyebrow">{s.appearance}</h3>
      <div className="grid grid-cols-2 rounded-full bg-white p-1" role="radiogroup" aria-label={s.appearance}>
        {[['dark', s.themeDark, Moon], ['light', s.themeLight, Sun]].map(([k, label, Icon]) => (
          <button key={k} role="radio" aria-checked={theme === k} onClick={() => onTheme(k)}
            className={`flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition ${theme === k ? 'bg-black text-white' : 'text-ink opacity-60 hover:opacity-90'}`}>
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>
    </section>
  )
}

/** Settings: are the memory server and the AI reachable? */
function Connections({ s, health, onRecheck }) {
  const [busy, setBusy] = useState(false)
  if (!health) return null
  // On the live site workers only need online / offline; addresses and model names are for developers.
  const techDetails = !health.public_mode
  const rows = [
    { name: s.memoryService, ok: health.hindsight?.ok,
      detail: !techDetails ? null : health.hindsight?.ok ? `v${health.hindsight.version ?? '?'} · ${health.hindsight.url}` : health.hindsight?.error },
    { name: s.aiService, ok: health.groq?.ok, detail: !techDetails ? null : health.groq?.ok ? health.groq.model : health.groq?.error },
  ]
  return (
    <section className="border-t border-line px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="eyebrow">{s.connections}</h3>
        <button onClick={async () => { setBusy(true); await onRecheck(); setBusy(false) }} disabled={busy} className="btn-ghost -mr-3 py-1 text-[12px]">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} {s.recheck}
        </button>
      </div>
      <ul className="space-y-2">
        {rows.map(({ name, ok, detail }) => (
          <li key={name} className="flex items-center gap-3">
            <span className={`size-2 shrink-0 rounded-full ${ok ? 'bg-ok' : 'bg-warn'}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-white">{name}</span>
              {detail && <span className="block truncate text-[12px] text-muted" title={detail}>{detail}</span>}
            </span>
            <span className={`text-[12px] font-medium ${ok ? 'text-ok' : 'text-warn'}`}>{ok ? s.online : s.offline}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
