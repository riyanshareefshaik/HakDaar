import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Banknote, BriefcaseBusiness, CalendarCheck, CircleAlert, CircleHelp, Loader2, MessageCircleHeart,
  Mic, RefreshCw, SendHorizontal, Sparkles, Square, Undo2, Volume2, X,
} from 'lucide-react'
import { inr } from '../api'
import { LANGS } from '../i18n'
import { canSpeak, speak } from '../hooks'

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

const QUICK = [
  { key: 'promise', icon: BriefcaseBusiness },
  { key: 'worked', icon: CalendarCheck },
  { key: 'paid', icon: Banknote },
  { key: 'owed', icon: CircleHelp, sendNow: true },
]

export default function ChatPanel({ s, worker, language, messages, sending, onSend, onRetry, onUndo, banner, onDismissBanner, loading, learning, onOpenMemory }) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const endRef = useRef(null)
  const recRef = useRef(null)
  const inputRef = useRef(null)
  const speechTag = LANGS.find((l) => l.code === language)?.speech || 'en-IN'

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  // Stop listening/speaking if the worker or language changes.
  useEffect(() => () => { recRef.current?.abort(); if (canSpeak) window.speechSynthesis.cancel() }, [worker?.id, language])

  const send = (msg = text) => {
    const m = msg.trim()
    if (!m || sending) return
    recRef.current?.stop()
    onSend(m)
    setText('')
  }

  const quick = (q) => {
    const tpl = s.templates[q.key]
    if (q.sendNow) return send(tpl)
    setText(tpl)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) { el.focus(); el.setSelectionRange(tpl.length, tpl.length) }
    })
  }

  const toggleMic = () => {
    if (listening) { recRef.current?.stop(); return }
    const rec = new SpeechRecognition()
    rec.lang = speechTag
    rec.interimResults = true
    rec.continuous = false
    const base = text ? text.trim() + ' ' : ''
    rec.onresult = (e) => setText(base + Array.from(e.results).map((r) => r[0].transcript).join(''))
    rec.onend = () => { setListening(false); inputRef.current?.focus() }
    rec.onerror = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  const lastAssistant = messages.findLastIndex((m) => m.role === 'assistant')

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
          <div className="mx-auto max-w-3xl space-y-3">
            {[60, 40, 70].map((w, i) => (
              <div key={i} className={`h-14 animate-pulse rounded-2xl bg-sand ${i % 2 ? 'ml-auto' : ''}`} style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto mt-6 max-w-md text-center animate-fade-up">
            <div className="mx-auto mb-3 grid size-16 place-items-center rounded-full bg-brand-soft">
              <MessageCircleHeart className="size-8 text-brand" />
            </div>
            <p className="text-xl font-bold">{s.emptyChatTitle}</p>
            <p className="mt-1 text-muted">{s.emptyChatBody}</p>
          </div>
        ) : (
          <ul className="mx-auto max-w-3xl space-y-4">
            {messages.map((m, i) => (
              <Bubble key={m.id ?? `local-${i}`} m={m} s={s} onRetry={onRetry} onUndo={onUndo} speechTag={speechTag} onOpenMemory={onOpenMemory}
                showLearning={i === lastAssistant && !sending ? learning : null} />
            ))}
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
            {QUICK.map((q) => {
              const Icon = q.icon
              return (
                <button key={q.key} onClick={() => quick(q)} disabled={sending}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-brand/20 bg-white px-3 py-1.5 text-sm font-medium text-brand shadow-sm transition hover:-translate-y-0.5 hover:bg-brand-soft disabled:opacity-50">
                  <Icon className="size-4" /> {s.quick[q.key]}
                </button>
              )
            })}
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
              className="grid size-[3.25rem] shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-soft transition hover:bg-brand-dark active:scale-95 disabled:opacity-40">
              <SendHorizontal className="size-6" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Bubble({ m, s, onRetry, onUndo, speechTag, showLearning, onOpenMemory }) {
  const [speaking, setSpeaking] = useState(false)

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
  const events = (m.events || []).filter((e) => ['promise', 'work_day', 'payment'].includes(e.type))

  const listen = () => {
    if (speak(m.content, speechTag)) {
      setSpeaking(true)
      setTimeout(() => setSpeaking(false), Math.min(15000, 400 + m.content.length * 70))
    }
  }

  return (
    <li className={`flex animate-fade-up flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-[85%] whitespace-pre-wrap px-4 py-3 text-[1.05rem] shadow-soft ${mine
        ? 'rounded-2xl rounded-br-md bg-brand text-white'
        : 'rounded-2xl rounded-bl-md border border-black/5 bg-white text-ink'}`}>
        {m.content}
      </div>

      {mine && events.length > 0 && (
        <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1">
          {events.map((e) => <EventChip key={e.id} e={e} s={s} onUndo={onUndo} />)}
        </div>
      )}

      {m.warnings?.map((w) => (
        <p key={w} className="mt-1 flex items-center gap-1 text-xs text-warn"><AlertTriangle className="size-3.5" /> {w}</p>
      ))}

      <div className={`mt-1 flex items-center gap-2 px-1 text-xs text-muted ${mine ? 'flex-row-reverse' : ''}`}>
        {m.created_at && (
          <span>{new Date(m.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        )}
        {!mine && canSpeak && (
          <button onClick={listen} className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold transition ${speaking ? 'bg-brand text-white' : 'text-brand hover:bg-brand-soft'}`}>
            <Volume2 className="size-3.5" /> {s.listen}
          </button>
        )}
        {showLearning === 'pending' && (
          <span className="flex items-center gap-1 text-brand"><Loader2 className="size-3.5 animate-spin" /> {s.learning}</span>
        )}
        {typeof showLearning === 'number' && showLearning > 0 && (
          <button onClick={onOpenMemory} className="flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-brand transition animate-fade-up hover:bg-brand hover:text-white">
            <Sparkles className="size-3.5" /> {s.learnedNew(showLearning)}
          </button>
        )}
      </div>
    </li>
  )
}

function EventChip({ e, s, onUndo }) {
  const [busy, setBusy] = useState(false)
  let label
  if (e.type === 'promise' && e.basis === 'fixed') label = `${e.employer_name}: ${s.entryFixed} ${inr(e.amount)}`
  else if (e.type === 'promise') label = `${e.employer_name}: ${inr(e.amount)}${s.perDay}`
  else if (e.type === 'work_day') label = `+${e.days} ${s.days} · ${e.employer_name}`
  else label = `${s.paid} ${inr(e.amount)} · ${e.employer_name}`

  if (e.undone) {
    return <span className="rounded-full bg-sand px-2.5 py-1 text-xs text-muted line-through">{label}</span>
  }
  return (
    <span className="flex items-center gap-1 rounded-full border border-brand/15 bg-brand-soft py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand">
      ✓ {s.noted}: {label}
      <button onClick={async () => { setBusy(true); await onUndo(e); setBusy(false) }} disabled={busy}
        title={s.undo} aria-label={`${s.undo}: ${label}`}
        className="grid size-6 place-items-center rounded-full text-brand/70 transition hover:bg-white hover:text-danger">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
      </button>
    </span>
  )
}
