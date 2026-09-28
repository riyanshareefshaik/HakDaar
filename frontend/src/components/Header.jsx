import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, Globe } from 'lucide-react'
import { LANGS } from '../i18n'
import Logo from './Logo'

export function Avatar({ name, size = 'size-8' }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  return (
    <span className={`${size} grid shrink-0 place-items-center rounded-full bg-white text-[13px] font-semibold text-black`}>
      {initials}
    </span>
  )
}

/**
 * Same header as the landing page: round white logo and wordmark, dark pills for language and account.
 * (Chat and ledger are both on screen, and Memories / Alerts live in the account panel, so no nav is needed.)
 */
export default function Header({ s, language, onLanguage, worker, alertCount = 0, onAccount, showHome = false }) {
  return (
    <header className="relative z-20 shrink-0 px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 sm:gap-5">
        {/* Signed in, the logo is just the logo: it must not drop the worker out to the public homepage. */}
        {worker ? (
          <span className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong bg-black">
            <Logo size={34} />
          </span>
        ) : (
          <a href="/landing/" title="HakDaar home"
            className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong bg-black shadow-[0_4px_14px_rgba(0,0,0,0.16)] transition hover:scale-[1.04]">
            <Logo size={34} />
          </a>
        )}

        <span className="font-display text-xl text-white">HakDaar</span>

        <div className="ml-auto flex items-center gap-2">
          {/* A visible way back to the landing page on the sign-in screens (the logo links there too) */}
          {showHome && <a href="/landing/" title={s.home}
            className="flex h-11 items-center gap-1.5 rounded-full border border-line-strong bg-pill px-3.5 text-[14.5px] font-medium text-fg2 transition hover:bg-pill-hover hover:text-white">
            <ArrowLeft className="size-4" />
            <span className="hidden min-[480px]:inline">{s.home}</span>
          </a>}
          {onLanguage && <LanguageMenu language={language} onChange={onLanguage} />}
          {worker && (
            <button onClick={onAccount} title={s.account}
              className="relative flex h-11 items-center gap-2 rounded-full border border-line-strong bg-pill pl-1.5 pr-3 text-fg2 transition hover:bg-pill-hover hover:text-white">
              <Avatar name={worker.name} />
              <span className="hidden max-w-32 truncate text-[14.5px] font-medium sm:block">{worker.name}</span>
              <ChevronDown className="hidden size-4 opacity-70 sm:block" />
              {alertCount > 0 && (
                <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-owed text-[11px] font-bold text-white">{alertCount}</span>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

/** Globe pill with a dropdown of languages in their own script. */
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
        className="flex h-11 items-center gap-1.5 rounded-full border border-line-strong bg-pill px-3.5 text-[14.5px] font-medium text-fg2 transition hover:bg-pill-hover hover:text-white">
        <Globe className="size-4" />
        <span className="hidden min-[420px]:inline">{current.label}</span>
        <ChevronDown className={`size-4 opacity-70 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl bg-white p-1.5 text-ink shadow-[0_20px_60px_rgba(0,0,0,0.45)] animate-fade">
          {LANGS.map((l) => {
            const active = l.code === language
            return (
              <li key={l.code}>
                <button role="option" aria-selected={active} onClick={() => { onChange(l.code); setOpen(false) }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-black/5' : 'hover:bg-black/5'}`}>
                  <span className="flex-1">
                    <span className="block font-semibold leading-tight">{l.label}</span>
                    <span className="block text-xs opacity-60">{l.native}</span>
                  </span>
                  {active && <Check className="size-4" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
