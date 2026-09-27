import { useRef, useState } from 'react'
import { ArrowRight, Brain, CircleAlert, Loader2, MessagesSquare, Phone, ShieldCheck } from 'lucide-react'
import { LANGS, t } from '../i18n'

const STEP_ICONS = [MessagesSquare, Brain, ShieldCheck]

/** Log in / create account with phone number + 4-digit PIN. Simple for any phone user. */
export default function Login({ onLogin, onRegister, lang = 'te', onLang }) {
  const [mode, setMode] = useState('login')
  const setLang = onLang
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const s = t(lang)

  const phoneOk = phone.replace(/\D/g, '').length >= 10
  const valid = phoneOk && pin.length === 4 && (mode === 'login' || name.trim())

  const submit = async (e) => {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') await onLogin({ phone, pin })
      else await onRegister({ name: name.trim(), phone, pin, language: lang })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const switchMode = (m) => { setMode(m); setError(null) }

  return (
    <div className="grid min-h-full place-items-center p-4" lang={lang}>
      <div className="card w-full max-w-md overflow-hidden animate-fade-up">
        <div className="relative overflow-hidden bg-brand px-6 pb-6 pt-6 text-white">
          <div className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10" />
          <div className="absolute -bottom-14 right-20 size-28 rounded-full bg-white/5" />
          <ShieldCheck className="mb-2 size-10" />
          <h2 className="text-2xl font-extrabold leading-tight">{s.welcome}</h2>
          <p className="mt-1 text-white/85">{s.welcomeBody}</p>
        </div>

        {/* Language first: everything below switches instantly */}
        <div className="grid grid-cols-3 gap-2 px-6 pt-5">
          {LANGS.map((l) => (
            <button type="button" key={l.code} onClick={() => setLang(l.code)} aria-pressed={lang === l.code}
              className={`rounded-2xl border-2 px-2 py-2.5 text-center transition ${lang === l.code
                ? 'border-brand bg-brand-soft text-brand shadow-soft'
                : 'border-black/10 bg-white hover:border-brand/40'}`}>
              <span className="block text-lg font-bold leading-tight">{l.label}</span>
              <span className="block text-[11px] text-muted">{l.native}</span>
            </button>
          ))}
        </div>

        <div className="mx-6 mt-5 grid grid-cols-2 gap-1 rounded-xl bg-sand p-1">
          {[['login', s.login], ['register', s.createAccount]].map(([m, label]) => (
            <button key={m} type="button" onClick={() => switchMode(m)}
              className={`rounded-lg py-2 font-semibold transition ${mode === m ? 'bg-white text-brand shadow-soft' : 'text-muted hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4 p-6">
          {mode === 'register' && (
            <Field label={s.whatName}>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name"
                placeholder={s.name} className={inputCls} />
            </Field>
          )}
          <Field label={s.phone}>
            <div className="flex items-center rounded-2xl border border-black/10 bg-cream focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
              <span className="flex items-center gap-1.5 border-r border-black/10 px-3 text-muted"><Phone className="size-4" /> +91</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ''))} inputMode="tel"
                autoComplete="tel-national" maxLength={14} placeholder="98765 43210"
                className="min-w-0 flex-1 bg-transparent px-3 py-3 text-lg tracking-wide outline-none" />
            </div>
          </Field>
          <Field label={s.pin} hint={mode === 'register' ? s.pinHint : null}>
            <PinInput value={pin} onChange={setPin} />
          </Field>

          {error && (
            <p className="flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-sm text-danger animate-fade-up">
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}

          <button type="submit" disabled={!valid || busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 text-lg font-bold text-white shadow-soft transition hover:bg-brand-dark active:scale-[.99] disabled:opacity-40">
            {busy && <Loader2 className="size-5 animate-spin" />}
            {mode === 'login' ? s.login : s.createAccount} <ArrowRight className="size-5" />
          </button>

          <p className="text-center text-sm text-muted">
            {mode === 'login' ? s.newHere : s.haveAccount}{' '}
            <button type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
              className="font-semibold text-brand hover:underline">
              {mode === 'login' ? s.createAccount : s.login}
            </button>
          </p>

          {mode === 'register' && (
            <ol className="grid gap-3 border-t border-black/5 pt-4">
              {s.how.map(([title, body], i) => {
                const Icon = STEP_ICONS[i]
                return (
                  <li key={title} className="flex gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-4.5" /></span>
                    <span className="text-sm leading-snug"><b>{title}.</b> <span className="text-muted">{body}</span></span>
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

const inputCls = 'w-full rounded-2xl border border-black/10 bg-cream px-4 py-3 text-lg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20'

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

/** Four big boxes, like a bank app. Typing, deleting and pasting all work. */
function PinInput({ value, onChange }) {
  const refs = useRef([])
  const set = (i, ch) => {
    const digits = value.split('')
    digits[i] = ch
    const next = digits.join('').slice(0, 4)
    onChange(next)
    if (ch && i < 3) refs.current[i + 1]?.focus()
  }
  return (
    <div className="flex gap-2" onPaste={(e) => {
      const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
      if (d) { e.preventDefault(); onChange(d); refs.current[Math.min(d.length, 3)]?.focus() }
    }}>
      {[0, 1, 2, 3].map((i) => (
        <input key={i} ref={(el) => (refs.current[i] = el)} value={value[i] || ''} inputMode="numeric" type="password"
          maxLength={1} aria-label={`PIN digit ${i + 1}`} autoComplete="off"
          onChange={(e) => { const ch = e.target.value.replace(/\D/g, '').slice(-1); if (ch || !e.target.value) set(i, ch) }}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !value[i] && i > 0) { refs.current[i - 1]?.focus(); set(i - 1, '') } }}
          className="size-14 rounded-2xl border border-black/10 bg-cream text-center text-2xl font-bold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
      ))}
    </div>
  )
}
