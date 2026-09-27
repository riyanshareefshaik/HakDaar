import { useState } from 'react'
import { ArrowRight, Brain, Loader2, MessagesSquare, ShieldCheck } from 'lucide-react'
import { LANGS, t } from '../i18n'

const STEP_ICONS = [MessagesSquare, Brain, ShieldCheck]

/** First-run screen: pick a language, say your name, start chatting. No demo data. */
export default function Onboarding({ onCreate, busy, compact = false, onCancel }) {
  const [lang, setLang] = useState('te')
  const [name, setName] = useState('')
  const s = t(lang)

  const submit = (e) => {
    e.preventDefault()
    if (name.trim()) onCreate({ name: name.trim(), language: lang })
  }

  return (
    <div className={`${compact ? '' : 'min-h-full'} grid place-items-center p-4`} lang={lang}>
      <div className="card w-full max-w-xl overflow-hidden animate-fade-up">
        <div className="relative overflow-hidden bg-brand px-6 pb-8 pt-7 text-white">
          <div className="absolute -right-10 -top-10 size-44 rounded-full bg-white/10" />
          <div className="absolute -bottom-16 right-16 size-32 rounded-full bg-white/5" />
          <ShieldCheck className="mb-3 size-11" />
          <h2 className="text-2xl font-extrabold leading-tight">{s.welcome}</h2>
          <p className="mt-1 text-white/85">{s.welcomeBody}</p>
        </div>

        <form onSubmit={submit} className="space-y-5 p-6">
          <div>
            <p className="mb-2 font-semibold">{s.chooseLang}</p>
            <div className="grid grid-cols-3 gap-2">
              {LANGS.map((l) => (
                <button type="button" key={l.code} onClick={() => setLang(l.code)}
                  className={`rounded-2xl border-2 px-2 py-3 text-center transition ${lang === l.code
                    ? 'border-brand bg-brand-soft text-brand shadow-soft'
                    : 'border-black/10 bg-white hover:border-brand/40'}`}>
                  <span className="block text-xl font-bold">{l.label}</span>
                  <span className="block text-xs text-muted">{l.native}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="ob-name" className="mb-2 block font-semibold">{s.whatName}</label>
            <input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off"
              placeholder={s.name}
              className="w-full rounded-2xl border border-black/10 bg-cream px-4 py-3 text-lg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </div>

          <div className="flex gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel} className="rounded-2xl px-4 py-3 font-semibold text-muted hover:bg-sand">
                {s.cancel}
              </button>
            )}
            <button type="submit" disabled={!name.trim() || busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 text-lg font-bold text-white shadow-soft transition hover:bg-brand-dark disabled:opacity-40">
              {busy ? <Loader2 className="size-5 animate-spin" /> : null} {s.start} <ArrowRight className="size-5" />
            </button>
          </div>

          {!compact && (
            <ol className="grid gap-3 border-t border-black/5 pt-5 sm:grid-cols-3">
              {s.how.map(([title, body], i) => {
                const Icon = STEP_ICONS[i]
                return (
                  <li key={title} className="flex gap-3 sm:flex-col sm:gap-2">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-5" /></span>
                    <span>
                      <span className="block font-bold">{i + 1}. {title}</span>
                      <span className="block text-sm leading-snug text-muted">{body}</span>
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </form>
      </div>
    </div>
  )
}
