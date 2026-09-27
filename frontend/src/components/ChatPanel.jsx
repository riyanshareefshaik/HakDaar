import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CircleAlert, MessageCircleHeart, Mic, RefreshCw, SendHorizontal, ShieldCheck, Square, X } from 'lucide-react'
import { inr } from '../api'
import { LANGS } from '../i18n'

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

export default function ChatPanel({ s, worker, language, messages, sending, onSend, onRetry, banner, onDismissBanner, suggestions, loading }) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const endRef = useRef(null)
  const recRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  // Stop listening if the worker or language changes mid-dictation.
  useEffect(() => () => recRef.current?.abort(), [worker?.id, language])

  const send = (msg = text) => {
    const m = msg.trim()
    if (!m || sending) return
    recRef.current?.stop()
    onSend(m)
    setText('')
  }

  const toggleMic = () => {
    if (listening) { recRef.current?.stop(); return }
    const rec = new SpeechRecognition()
    rec.lang = LANGS.find((l) => l.code === language)?.speech || 'en-IN'
    rec.interimResults = true
    rec.continuous = false
    const base = text ? text.trim() + ' ' : ''
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0].transcript).join('')
      setText(base + said)
    }
    rec.onend = () => { setListening(false); inputRef.current?.focus() }
    rec.onerror = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  if (!worker) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <ShieldCheck className="mx-auto mb-3 size-14 text-brand/40" />
          <p className="text-lg font-semibold">{s.noWorkers}</p>
          <p className="text-muted">{s.noWorkersBody}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {banner && (
        <div className="px-4 pt-3">
          <div role="alert" className="animate-slide-down animate-pulse-ring flex items-center gap-3 rounded-2xl bg-danger px-4 py-3 text-white shadow-soft">
            <AlertTriangle className="size-6 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold leading-tight">{s.owesYou(banner.employer_name, inr(banner.amount_owed))}</p>
              <p className="hidden text-sm leading-snug text-white/85 sm:block">{banner.message}</p>
            </div>
            <button onClick={onDismissBanner} className="rounded-full p-1 hover:bg-white/15" aria-label="Dismiss">
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scroll-thin px-4 py-4" lang={language}>
        {loading ? (
          <div className="space-y-3">
            {[60, 40, 70].map((w, i) => (
              <div key={i} className={`h-14 animate-pulse rounded-2xl bg-sand ${i % 2 ? 'ml-auto' : ''}`} style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto mt-8 max-w-md text-center">
            <div className="mx-auto mb-3 grid size-16 place-items-center rounded-full bg-brand-soft">
              <MessageCircleHeart className="size-8 text-brand" />
            </div>
            <p className="text-xl font-bold">{s.emptyChatTitle}</p>
            <p className="mt-1 text-muted">{s.emptyChatBody}</p>
          </div>
        ) : (
          <ul className="mx-auto max-w-3xl space-y-3">
            {messages.map((m, i) => <Bubble key={m.id ?? `local-${i}`} m={m} s={s} onRetry={onRetry} />)}
            {sending && (
              <li className="flex items-center gap-2 text-muted animate-fade-up">
                <span className="flex gap-1 rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-soft">
                  <span className="typing-dot size-2 rounded-full bg-brand" />
                  <span className="typing-dot size-2 rounded-full bg-brand" />
                  <span className="typing-dot size-2 rounded-full bg-brand" />
                </span>
                <span className="text-sm">{s.typing}</span>
              </li>
            )}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-black/5 bg-cream/95 px-4 pb-3 pt-2 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto" lang={language}>
            {suggestions.map((q) => (
              <button key={q} onClick={() => send(q)} disabled={sending}
                className="shrink-0 rounded-full border border-brand/25 bg-white px-3 py-1.5 text-sm text-brand hover:bg-brand-soft disabled:opacity-50">
                {q}
              </button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex items-end gap-2">
            <div className={`flex flex-1 items-end rounded-2xl border bg-white shadow-soft transition ${listening ? 'border-danger ring-2 ring-danger/20' : 'border-black/10 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20'}`}>
              <textarea
                ref={inputRef} rows={1} value={text} lang={language}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={listening ? s.listening : s.placeholder}
                className="max-h-36 min-h-[3.25rem] flex-1 resize-none bg-transparent px-4 py-3 text-lg outline-none placeholder:text-muted/70"
                style={{ fieldSizing: 'content' }}
              />
              {SpeechRecognition && (
                <button type="button" onClick={toggleMic} aria-label={s.mic} title={s.mic}
                  className={`m-1.5 grid size-11 shrink-0 place-items-center rounded-xl transition ${listening ? 'bg-danger text-white animate-pulse-ring' : 'text-brand hover:bg-brand-soft'}`}>
                  {listening ? <Square className="size-5 fill-current" /> : <Mic className="size-6" />}
                </button>
              )}
            </div>
            <button type="submit" disabled={!text.trim() || sending} aria-label={s.send}
              className="grid size-[3.25rem] shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-soft transition hover:bg-brand-dark disabled:opacity-40">
              <SendHorizontal className="size-6" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Bubble({ m, s, onRetry }) {
  if (m.role === 'error') {
    return (
      <li className="flex animate-fade-up items-start gap-2 rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3 text-danger">
        <CircleAlert className="mt-0.5 size-5 shrink-0" />
        <div className="flex-1">
          <p className="font-medium">{m.content}</p>
          {m.retry && (
            <button onClick={() => onRetry(m.retry)} className="mt-1 flex items-center gap-1 text-sm font-semibold underline">
              <RefreshCw className="size-3.5" /> {s.retry}
            </button>
          )}
        </div>
      </li>
    )
  }
  const mine = m.role === 'user'
  return (
    <li className={`flex animate-fade-up flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-[85%] whitespace-pre-wrap px-4 py-3 text-[1.05rem] shadow-soft ${mine
        ? 'rounded-2xl rounded-br-md bg-brand text-white'
        : 'rounded-2xl rounded-bl-md bg-white text-ink'}`}>
        {m.content}
      </div>
      {mine && m.events?.length > 0 && (
        <div className="mt-1 flex max-w-[85%] flex-wrap justify-end gap-1">
          {m.events.map((e, i) => <EventChip key={i} e={e} s={s} />)}
        </div>
      )}
      {m.warnings?.map((w) => (
        <p key={w} className="mt-1 flex items-center gap-1 text-xs text-warn"><AlertTriangle className="size-3.5" /> {w}</p>
      ))}
      {m.created_at && (
        <span className="mt-0.5 px-1 text-xs text-muted">
          {new Date(m.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </li>
  )
}

function EventChip({ e, s }) {
  let label
  if (e.type === 'promise') label = `${e.employer_name}: ${inr(e.amount)}${s.perDay}`
  else if (e.type === 'work_day') label = `+${e.days} ${s.days.toLowerCase()} · ${e.employer_name}`
  else if (e.type === 'payment') label = `${s.paid} ${inr(e.amount)} · ${e.employer_name}`
  else return null
  return (
    <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
      ✓ {s.noted}: {label}
    </span>
  )
}
