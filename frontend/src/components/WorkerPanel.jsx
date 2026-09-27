import { Languages, Plus, Trash2 } from 'lucide-react'
import { LANGS } from '../i18n'
import { inr } from '../api'

const AVATAR_COLORS = ['bg-emerald-600', 'bg-amber-600', 'bg-sky-700', 'bg-rose-600', 'bg-violet-600', 'bg-teal-700']

export function Avatar({ name, index = 0, size = 'size-11' }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  return (
    <span className={`${size} ${AVATAR_COLORS[index % AVATAR_COLORS.length]} grid shrink-0 place-items-center rounded-full font-bold text-white`}>
      {initials}
    </span>
  )
}

export default function WorkerPanel({ s, workers, activeId, activeOwed, onSelect, language, onLanguage, onAdd, onDelete, onReset, busy }) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto scroll-thin p-4">
      <section className="card p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{s.workers}</h2>
          <button onClick={onAdd} title={s.addWorker} aria-label={s.addWorker}
            className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand transition hover:bg-brand hover:text-white">
            <Plus className="size-5" />
          </button>
        </div>
        <ul className="space-y-1">
          {workers.map((w, i) => {
            const active = w.id === activeId
            return (
              <li key={w.id} className="group relative">
                <button onClick={() => onSelect(w.id)}
                  className={`flex w-full items-center gap-3 rounded-xl p-2 pr-10 text-left transition ${active ? 'bg-brand-soft ring-1 ring-brand/30' : 'hover:bg-sand'}`}>
                  <Avatar name={w.name} index={i} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{w.name}</span>
                    <span className="block text-sm text-muted">{LANGS.find((l) => l.code === w.language)?.label}</span>
                  </span>
                  {active && activeOwed > 0 && (
                    <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">{inr(activeOwed)}</span>
                  )}
                </button>
                <button onClick={() => onDelete(w)} disabled={busy} title={s.deleteWorker} aria-label={s.deleteWorker}
                  className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted opacity-100 transition hover:bg-danger-soft hover:text-danger lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100">
                  <Trash2 className="size-4" />
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="card p-3">
        <h2 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold uppercase tracking-wide text-muted">
          <Languages className="size-4" /> {s.language}
        </h2>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-sand p-1">
          {LANGS.map((l) => (
            <button key={l.code} onClick={() => onLanguage(l.code)}
              className={`rounded-lg py-2 text-base font-semibold transition ${language === l.code ? 'bg-white text-brand shadow-soft' : 'text-muted hover:text-ink'}`}>
              {l.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-auto space-y-2">
        <button onClick={onReset} disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm text-muted transition hover:text-danger disabled:opacity-50">
          <Trash2 className="size-4" /> {s.resetAll}
        </button>
        <p className="px-2 text-center text-xs text-muted lg:hidden">{s.footer}</p>
      </section>
    </div>
  )
}
