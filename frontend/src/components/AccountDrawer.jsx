import { useEffect, useState } from 'react'
import { Brain, LogOut, Phone, Trash2, Users, X } from 'lucide-react'
import { Avatar } from './Header'
import { AlertsCard, MemoriesCard } from './LedgerPanel'

/** Slide-over "My account": profile, what HakDaar has learned, employer warnings, log out. */
export default function AccountDrawer({ s, open, onClose, worker, section, memoryProps, alerts, onLogout, onDelete, onResetAll }) {
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
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-fade-up" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-cream shadow-2xl animate-drawer">
        <div className="flex items-center gap-3 bg-brand px-4 py-4 text-white">
          <Avatar name={worker.name} size="size-12" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold leading-tight">{worker.name}</p>
            {worker.phone && <p className="flex items-center gap-1 text-sm text-white/80"><Phone className="size-3.5" /> +91 {worker.phone}</p>}
            <p className="truncate text-xs text-white/70">{s.memoryBank}: worker-{worker.id}</p>
          </div>
          <button onClick={onClose} aria-label={s.close} className="rounded-full p-1.5 hover:bg-white/15"><X className="size-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-1 border-b border-black/5 bg-white p-2">
          {[['memories', s.memories, Brain, memoryProps.learned.total], ['alerts', s.alerts, Users, repCount]].map(([k, label, Icon, n]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition ${tab === k ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-sand'}`}>
              <Icon className="size-4" /> {label}
              {n > 0 && <span className={`rounded-full px-1.5 text-xs ${k === 'alerts' ? 'bg-warn text-white' : 'bg-brand text-white'}`}>{n}</span>}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-4">
          {tab === 'memories' ? <MemoriesCard s={s} {...memoryProps} /> : <AlertsCard s={s} alerts={alerts} loading={false} />}
        </div>

        <div className="space-y-1 border-t border-black/5 bg-white p-3">
          <button onClick={onLogout}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 font-semibold text-ink transition hover:bg-sand">
            <LogOut className="size-5" /> {s.logout}
          </button>
          <button onClick={onDelete}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted transition hover:bg-danger-soft hover:text-danger">
            <Trash2 className="size-4" /> {s.deleteAccount}
          </button>
          <button onClick={onResetAll}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-xs text-muted/80 transition hover:text-danger">
            <Trash2 className="size-3.5" /> {s.resetAll} (demo)
          </button>
        </div>
      </aside>
    </div>
  )
}
