import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Globe } from 'lucide-react'
import Logo from './Logo'
import { LANGS } from '../i18n'

const AVATAR_COLORS = ['bg-emerald-600', 'bg-amber-600', 'bg-sky-700', 'bg-rose-600', 'bg-violet-600', 'bg-teal-700']

export function Avatar({ name, size = 'size-10' }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  const color = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]
  return (
    <span className={`${size} ${color} grid shrink-0 place-items-center rounded-full font-bold text-white ring-2 ring-white/30`}>
      {initials}
    </span>
  )
}

export default function Header({ s, health, language, onLanguage, worker, alertCount = 0, onAccount }) {
  return (
    <header className="bg-brand text-white">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-2.5 lg:px-6">
        <Logo size={42} className="shrink-0 drop-shadow-sm" />
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold leading-tight tracking-tight">Hak<span className="text-amber-300">Daar</span></h1>
          <p className="hidden truncate text-sm leading-tight text-white/80 sm:block">{s.tagline}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {health && (
            <div className="hidden items-center gap-2 text-xs xl:flex">
              <StatusPill ok={health.hindsight?.ok} label="Hindsight memory" />
              <StatusPill ok={health.groq?.ok} label="Groq AI" />
            </div>
          )}
          {onLanguage && <LanguageMenu language={language} onChange={onLanguage} />}
          {worker && (
            <button onClick={onAccount} title={s.account}
              className="relative flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3 transition hover:bg-white/20">
              <Avatar name={worker.name} size="size-8" />
              <span className="hidden max-w-32 truncate font-semibold sm:block">{worker.name}</span>
              <ChevronDown className="size-4 opacity-80" />
              {alertCount > 0 && (
                <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-warn text-[11px] font-bold ring-2 ring-brand">
                  {alertCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

function StatusPill({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1">
      <span className={`size-2 rounded-full ${ok ? 'bg-emerald-300' : 'bg-amber-300'}`} />
      {label}
    </span>
  )
}

/** Globe button with a dropdown of languages in their own script. */
export function LanguageMenu({ language, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = LANGS.find((l) => l.code === language) || LANGS[0]

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 font-semibold transition hover:bg-white/20">
        <Globe className="size-4.5" />
        <span>{current.label}</span>
        <ChevronDown className={`size-4 opacity-80 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-black/5 bg-white p-1.5 text-ink shadow-soft animate-fade-up">
          {LANGS.map((l) => {
            const active = l.code === language
            return (
              <li key={l.code}>
                <button role="option" aria-selected={active} onClick={() => { onChange(l.code); setOpen(false) }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-brand-soft' : 'hover:bg-sand'}`}>
                  <span className={`grid size-9 place-items-center rounded-lg text-sm font-bold ${active ? 'bg-brand text-white' : 'bg-sand text-muted'}`}>
                    {l.code === 'en' ? 'En' : l.label.slice(0, 1)}
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold leading-tight">{l.label}</span>
                    <span className="block text-xs text-muted">{l.native}</span>
                  </span>
                  {active && <Check className="size-4.5 text-brand" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
