import { useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, Phone } from 'lucide-react'
import { api } from '../api'
import { t } from '../i18n'

const digits = (v) => v.replace(/\D/g, '')

/**
 * Sign in / sign up / reset PIN.
 * - every empty or invalid field gets a red outline and a message
 * - sign-up does not log in: it returns to "Log in" with a confirmation
 * - PIN can be shown, is entered twice at sign-up, and can be reset with a security question (no paid SMS)
 */
export default function Login({ onLogin, lang = 'en', onOpenLegal, onHowItWorks, initialMode = 'login' }) {
  const s = t(lang)
  const [mode, setMode] = useState(initialMode) // login | register | reset
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [agree, setAgree] = useState(false)
  const [resetQuestion, setResetQuestion] = useState(null) // step 2 of reset once known

  const go = (m, keepNotice = false) => {
    setMode(m); setErrors({}); setError(null); setPin(''); setPin2(''); setAnswer(''); setResetQuestion(null)
    if (!keepNotice) setNotice(null)
  }
  const clear = (k) => setErrors((e) => (e[k] ? { ...e, [k]: null } : e))

  const validate = () => {
    const e = {}
    const need = (k, v) => { if (!String(v).trim()) e[k] = s.required }
    need('phone', phone)
    if (!e.phone && digits(phone).length !== 10) e.phone = s.phoneInvalid
    if (mode === 'login') {
      need('pin', pin); if (!e.pin && pin.length !== 4) e.pin = s.pinInvalid
    }
    if (mode === 'register') {
      need('name', name)
      need('pin', pin); if (!e.pin && pin.length !== 4) e.pin = s.pinInvalid
      need('pin2', pin2); if (!e.pin2 && pin2.length !== 4) e.pin2 = s.pinInvalid
      if (!e.pin && !e.pin2 && pin !== pin2) e.pin2 = s.pinMismatch
      need('question', question)
      need('answer', answer)
      if (!agree) e.agree = s.mustAgree
    }
    if (mode === 'reset' && resetQuestion) {
      need('answer', answer)
      need('pin', pin); if (!e.pin && pin.length !== 4) e.pin = s.pinInvalid
      need('pin2', pin2); if (!e.pin2 && pin2.length !== 4) e.pin2 = s.pinInvalid
      if (!e.pin && !e.pin2 && pin !== pin2) e.pin2 = s.pinMismatch
    }
    setErrors(e)
    return Object.values(e).every((v) => !v)
  }

  const submit = async (ev) => {
    ev.preventDefault()
    setError(null)
    if (!validate()) return
    setBusy(true)
    try {
      if (mode === 'login') {
        await onLogin({ phone, pin })
        return
      }
      if (mode === 'register') {
        await api.register({
          name: name.trim(), phone, pin, pin_confirm: pin2, language: lang,
          recovery_question: Number(question), recovery_answer: answer.trim(), accept_terms: true,
        })
        setName(''); setQuestion(''); setAgree(false)
        setNotice(s.accountCreated)
        go('login', true) // do not log in automatically; the phone number stays filled in
      } else if (!resetQuestion) {
        const r = await api.recoveryQuestion(phone)
        setResetQuestion(r.question)
      } else {
        await api.resetPin({ phone, answer: answer.trim(), new_pin: pin })
        setNotice(s.resetDone)
        go('login', true)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'login' ? s.loginTitle : mode === 'register' ? s.registerTitle : s.resetTitle
  const sub = mode === 'login' ? s.loginSub : mode === 'register' ? s.registerSub : s.resetStep1
  const submitLabel = mode === 'login' ? s.login : mode === 'register' ? s.createAccount
    : resetQuestion ? s.resetTitle : s.continueBtn

  return (
    <div className="mx-auto w-full max-w-[460px] px-4 pb-10 pt-6 sm:pt-10" lang={lang}>
      {/* Title in the same dot-matrix face as the landing headline */}
      <div className="mb-6 text-center animate-rise">
        <h1 className="font-display text-[clamp(30px,6vw,44px)] leading-[1.05] text-white">{title}</h1>
        <p className="mx-auto mt-2 max-w-[36ch] text-[15.5px] text-fg2/80">{sub}</p>
      </div>

      <section className="rounded-[28px] border border-line bg-black/55 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-7 animate-rise" style={{ animationDelay: '.08s' }}>
        {mode === 'reset' ? (
          <button onClick={() => go('login')} className="btn-ghost -ml-2 mb-3">
            <ArrowLeft className="size-4" /> {s.backToLogin}
          </button>
        ) : (
          <div className="mb-6 grid grid-cols-2 rounded-full bg-white p-1">
            {[['login', s.login], ['register', s.createAccount]].map(([m, label]) => (
              <button key={m} onClick={() => go(m)}
                className={`rounded-full py-2 text-[14.5px] font-medium transition ${mode === m ? 'bg-black text-white' : 'text-ink opacity-60 hover:opacity-90'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {notice && (
          <p className="mb-4 flex items-start gap-2 rounded-2xl border border-ok/40 bg-ok/10 p-3 text-sm text-ok" role="status">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {notice}
          </p>
        )}
        {error && (
          <p className="mb-4 flex items-start gap-2 rounded-2xl border border-owed/40 bg-owed/10 p-3 text-sm text-owed" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}

        <form onSubmit={submit} noValidate className="space-y-5">
          {mode === 'register' && (
            <Field id="f-name" label={s.name} error={errors.name}>
              <input id="f-name" value={name} maxLength={60} autoComplete="name"
                onChange={(e) => { setName(e.target.value); clear('name') }}
                className={`field ${errors.name ? 'field-error' : ''}`} aria-invalid={!!errors.name} />
            </Field>
          )}

          {(mode !== 'reset' || !resetQuestion) && (
            <Field id="f-phone" label={s.phone} error={errors.phone}>
              <div className={`field flex items-center gap-0 p-0 ${errors.phone ? 'field-error' : ''}`}>
                <span className="flex items-center gap-1.5 border-r border-line px-3.5 text-muted"><Phone className="size-4" /> +91</span>
                <input id="f-phone" value={phone} inputMode="tel" autoComplete="tel-national" maxLength={14} placeholder="98765 43210"
                  onChange={(e) => { setPhone(e.target.value.replace(/[^\d ]/g, '')); clear('phone') }}
                  className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 tracking-wide text-white outline-none placeholder:text-muted/60" aria-invalid={!!errors.phone} />
              </div>
            </Field>
          )}

          {mode === 'reset' && resetQuestion && (
            <>
              <p className="rounded-2xl border border-line bg-card p-3 text-sm text-fg2"><span className="font-semibold text-white">{s.securityQ}:</span> {s.questions[resetQuestion - 1]}</p>
              <Field id="f-answer" label={s.answer} error={errors.answer}>
                <input id="f-answer" value={answer} maxLength={80} autoComplete="off"
                  onChange={(e) => { setAnswer(e.target.value); clear('answer') }} className={`field ${errors.answer ? 'field-error' : ''}`} />
              </Field>
            </>
          )}

          {(mode === 'login' || mode === 'register' || (mode === 'reset' && resetQuestion)) && (
            <Field id="f-pin" label={mode === 'reset' ? s.newPin : s.pin} error={errors.pin}
              right={<ShowToggle show={showPin} onToggle={() => setShowPin(!showPin)} s={s} />}
              extra={mode === 'login' && (
                <button type="button" onClick={() => go('reset')} className="text-sm font-medium text-fg2 underline-offset-4 hover:text-white hover:underline">{s.forgotPin}</button>
              )}>
              <PinInput id="f-pin" value={pin} onChange={(v) => { setPin(v); clear('pin') }} show={showPin} invalid={!!errors.pin} />
            </Field>
          )}

          {(mode === 'register' || (mode === 'reset' && resetQuestion)) && (
            <Field id="f-pin2" label={s.confirmPin} error={errors.pin2}>
              <PinInput id="f-pin2" value={pin2} onChange={(v) => { setPin2(v); clear('pin2') }} show={showPin} invalid={!!errors.pin2} />
            </Field>
          )}

          {mode === 'register' && (
            <fieldset className="space-y-4 rounded-2xl border border-line p-4">
              <legend className="eyebrow px-1.5">{s.securityQ}</legend>
              <p className="-mt-1 text-sm text-muted">{s.securityHint}</p>
              <Field id="f-q" label={s.chooseQuestion} error={errors.question}>
                <select id="f-q" value={question} onChange={(e) => { setQuestion(e.target.value); clear('question') }}
                  className={`field appearance-none bg-[length:16px] bg-[right_14px_center] bg-no-repeat pr-10 ${errors.question ? 'field-error' : ''}`}
                  style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238e8e8e' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>
                  <option value="">—</option>
                  {s.questions.map((q, i) => <option key={q} value={i + 1}>{q}</option>)}
                </select>
              </Field>
              <Field id="f-ans" label={s.answer} error={errors.answer}>
                <input id="f-ans" value={answer} maxLength={80} autoComplete="off"
                  onChange={(e) => { setAnswer(e.target.value); clear('answer') }} className={`field ${errors.answer ? 'field-error' : ''}`} />
              </Field>
            </fieldset>
          )}

          {mode === 'register' && (
            <div>
              <label className={`flex items-start gap-3 rounded-2xl p-2.5 text-sm text-fg2 ${errors.agree ? 'bg-owed/10 ring-1 ring-owed/60' : ''}`}>
                <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); clear('agree') }}
                  className="mt-0.5 size-5 shrink-0 accent-white" aria-invalid={!!errors.agree} />
                <span>
                  {s.agreePrefix}{' '}
                  <button type="button" onClick={() => onOpenLegal('terms')} className="font-medium text-white underline underline-offset-2">{s.terms}</button>
                  {' '}{s.and}{' '}
                  <button type="button" onClick={() => onOpenLegal('privacy')} className="font-medium text-white underline underline-offset-2">{s.privacy}</button>
                </span>
              </label>
              {errors.agree && <FieldError text={errors.agree} />}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-white w-full py-3 text-[15px]">
            {busy && <Loader2 className="size-5 animate-spin" />} {submitLabel}
          </button>
        </form>
      </section>

      <p className="mt-5 text-center">
        <button onClick={onHowItWorks} className="btn-ghost">{s.howItWorks} →</button>
      </p>
    </div>
  )
}

function Field({ id, label, error, children, right, extra }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[14.5px] font-medium text-fg2">{label}</label>
        {right}
      </div>
      {children}
      <div className="flex items-start justify-between gap-2">
        {error ? <FieldError text={error} /> : <span />}
        {extra && <span className="mt-1.5">{extra}</span>}
      </div>
    </div>
  )
}

function FieldError({ text }) {
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-owed" role="alert">
      <AlertCircle className="size-4 shrink-0" /> {text}
    </p>
  )
}

function ShowToggle({ show, onToggle, s }) {
  return (
    <button type="button" onClick={onToggle} className="flex items-center gap-1 text-sm font-medium text-muted hover:text-white">
      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {show ? s.hidePin : s.showPin}
    </button>
  )
}

/** Four boxes like a bank app. Typing, backspace and paste all work; digits can be shown or hidden. */
function PinInput({ id, value, onChange, show, invalid }) {
  const refs = useRef([])
  const setAt = (i, ch) => {
    const arr = value.padEnd(4, ' ').split('')
    arr[i] = ch || ' '
    onChange(arr.join('').replace(/\s+$/, '').replace(/\s/g, ''))
    if (ch && i < 3) refs.current[i + 1]?.focus()
  }
  return (
    <div className="flex gap-2" onPaste={(e) => {
      const d = digits(e.clipboardData.getData('text')).slice(0, 4)
      if (d) { e.preventDefault(); onChange(d); refs.current[Math.min(d.length, 3)]?.focus() }
    }}>
      {[0, 1, 2, 3].map((i) => (
        <input key={i} id={i === 0 ? id : undefined} ref={(el) => (refs.current[i] = el)} value={value[i] || ''}
          inputMode="numeric" type={show ? 'text' : 'password'} maxLength={1} autoComplete="off" aria-label={`PIN digit ${i + 1}`}
          onChange={(e) => { const ch = digits(e.target.value).slice(-1); if (ch || !e.target.value) setAt(i, ch) }}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !value[i] && i > 0) { refs.current[i - 1]?.focus(); setAt(i - 1, '') } }}
          className={`field size-14 p-0 text-center font-display text-2xl ${invalid ? 'field-error' : ''}`} />
      ))}
    </div>
  )
}
