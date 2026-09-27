import { useState } from 'react'
import { Check, Languages, Loader2, Plus, RotateCcw, Sparkles, UserPlus, X } from 'lucide-react'
import { LANGS } from '../i18n'

const AVATAR_COLORS = ['bg-emerald-600', 'bg-amber-600', 'bg-sky-700', 'bg-rose-600', 'bg-violet-600', 'bg-teal-700']

export function Avatar({ name, index = 0, size = 'size-11' }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  return (
    <span className={`${size} ${AVATAR_COLORS[index % AVATAR_COLORS.length]} grid shrink-0 place-items-center rounded-full font-bold text-white`}>
      {initials}
    </span>
  )
}

export default function WorkerPanel({ s, workers, activeId, onSelect, language, onLanguage, onCreate, onSeed, onReset, busy }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [lang, setLang] = useState(language)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    await onCreate({ name: name.trim(), language: lang })
    setName('')
    setAdding(false)
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto scroll-thin p-4">
      <section className="card p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{s.workers}</h2>
          {!adding && (
            <button onClick={() => setAdding(true)} title={s.addWorker} aria-label={s.addWorker}
              className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand hover:bg-brand hover:text-white">
              <Plus className="size-5" />
            </button>
          )}
        </div>

        {adding && (
          <form onSubmit={submit} className="mb-3 space-y-2 rounded-xl bg-sand p-3 animate-fade-up">
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={s.name} maxLength={60}
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <div className="flex gap-1">
              {LANGS.map((l) => (
                <button type="button" key={l.code} onClick={() => setLang(l.code)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-medium ${lang === l.code ? 'bg-brand text-white' : 'bg-white text-ink'}`}>
                  {l.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={!name.trim() || busy}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand py-2 font-semibold text-white disabled:opacity-50">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {s.save}
              </button>
              <button type="button" onClick={() => setAdding(false)} className="rounded-lg bg-white px-3 text-muted" aria-label={s.cancel}>
                <X className="size-4" />
              </button>
            </div>
          </form>
        )}

        {workers.length === 0 && !adding ? (
          <div className="px-2 py-6 text-center">
            <UserPlus className="mx-auto mb-2 size-8 text-muted" />
            <p className="font-semibold">{s.noWorkers}</p>
            <p className="text-sm text-muted">{s.noWorkersBody}</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {workers.map((w, i) => (
              <li key={w.id}>
                <button onClick={() => onSelect(w.id)}
                  className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition ${w.id === activeId ? 'bg-brand-soft ring-1 ring-brand/30' : 'hover:bg-sand'}`}>
                  <Avatar name={w.name} index={i} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{w.name}</span>
                    <span className="block text-sm text-muted">{LANGS.find((l) => l.code === w.language)?.label}</span>
                  </span>
                  {w.id === activeId && <span className="size-2.5 rounded-full bg-brand" />}
                </button>
              </li>
            ))}
          </ul>
        )}
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
        <button onClick={onSeed} disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand/30 bg-white py-2.5 font-semibold text-brand hover:bg-brand-soft disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {s.loadDemo}
        </button>
        {workers.length > 0 && (
          <button onClick={onReset} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm text-muted hover:text-danger disabled:opacity-50">
            <RotateCcw className="size-4" /> {s.resetDemo}
          </button>
        )}
        <p className="px-2 pt-2 text-center text-xs text-muted lg:hidden">{s.footer}</p>
      </section>
    </div>
  )
}
