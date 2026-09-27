import { Fragment, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Banknote, BriefcaseBusiness, CalendarCheck, CircleAlert, CircleHelp, Loader2,
  Mic, PenLine, RefreshCw, SendHorizontal, Sparkles, Square, Undo2, Volume2, VolumeX, X,
} from 'lucide-react'
import { inr } from '../api'
import { LANGS } from '../i18n'
import { api } from '../api'
import { canRecord, canSpeak, speak, stopSpeaking, useRecorder } from '../hooks'
import WelcomeCard from './WelcomeCard'
import QuickEntrySheet from './QuickEntrySheet'
import Logo from './Logo'


// Big, colour-coded picture buttons: recognisable without reading.
const QUICK = [
  { key: 'promise', icon: BriefcaseBusiness, tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  { key: 'worked', icon: CalendarCheck, tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  { key: 'paid', icon: Banknote, tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  { key: 'owed', icon: CircleHelp, sendNow: true, tone: 'bg-rose-50 text-rose-800 ring-rose-200' },
]

export default function ChatPanel({ s, worker, language, messages, sending, onSend, onRetry, onUndo, banner, onDismissBanner, loading, learning, onOpenMemory,
  welcome, welcomeLoading, welcomeAt = 0, welcomeOpen = true, onCloseWelcome, employers = [] }) {
  const [text, setText] = useState('')
  const [sheet, setSheet] = useState({ mode: null, employer: null })
  const [voice, setVoice] = useState({ busy: false, error: null })
  const recorder = useRecorder({ maxSeconds: 60 })
  const recording = recorder.state === 'recording'
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const speechTag = LANGS.find((l) => l.code === language)?.speech || 'en-IN'

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  // Stop recording/speaking if the worker or language changes.
  useEffect(() => () => { recorder.cancel(); stopSpeaking() }, [worker?.id, language]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = (msg = text) => {
    const m = msg.trim()
    if (!m || sending) return
    onCloseWelcome?.()
    onSend(m)
    setText('')
  }

  // Picture buttons: "owed" asks straight away; the others open the no-typing entry sheet.
  const quick = (q) => {
    if (q.sendNow) return send(s.templates[q.key])
    setSheet({ mode: q.key, employer: null })
  }

  // Voice: record in the browser, transcribe with Groq Whisper on the backend, put the text in the box.
  const startRecording = async () => {
    setVoice({ busy: false, error: null })
    stopSpeaking()
    try {
      await recorder.start()
    } catch (e) {
      const error = e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? s.micDenied
        : e?.name === 'NotFoundError' ? s.micMissing : s.micFailed
      setVoice({ busy: false, error })
    }
  }

  const finishRecording = async () => {
    const blob = await recorder.stop()
    if (!blob || blob.size < 1200) { setVoice({ busy: false, error: s.heardNothing }); return }
    setVoice({ busy: true, error: null })
    try {
      const said = await api.transcribe(blob, language)
      if (!said) { setVoice({ busy: false, error: s.heardNothing }); return }
      setText((t) => (t.trim() ? `${t.trim()} ${said}` : said))
      setVoice({ busy: false, error: null })
      requestAnimationFrame(() => inputRef.current?.focus())
    } catch (e) {
      setVoice({ busy: false, error: e.message })
    }
  }

  const lastAssistant = messages.findLastIndex((m) => m.role === 'assistant')
  // A plain element (not a nested component) so it isn't remounted, and doesn't re-speak, on every render.
  const welcomeEl = welcomeOpen && (
    <WelcomeCard key="welcome" onClose={onCloseWelcome} s={s} worker={worker} language={language} speechTag={speechTag} welcome={welcome} loading={welcomeLoading}
      onReply={(t) => send(t)} onTellRate={(e) => setSheet({ mode: 'promise', employer: e })} />
  )

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

      <div className="chat-bg flex-1 overflow-y-auto scroll-thin px-4 py-4" lang={language}>
        {loading ? (
          <div className="mx-auto max-w-3xl space-y-3">
            {[60, 40, 70].map((w, i) => (
              <div key={i} className={`h-14 animate-pulse rounded-2xl bg-sand ${i % 2 ? 'ml-auto' : ''}`} style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          <ul className="mx-auto max-w-3xl space-y-4">
            {messages.map((m, i) => (
              <Fragment key={m.id ?? `local-${i}`}>
                {i === welcomeAt && welcomeEl}
                <Bubble m={m} s={s} onRetry={onRetry} onUndo={onUndo} speechTag={speechTag} language={language} onOpenMemory={onOpenMemory}
                  showLearning={i === lastAssistant && !sending ? learning : null} />
              </Fragment>
            ))}
            {welcomeAt >= messages.length && welcomeEl}
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

      <div className="relative z-10 -mt-3 rounded-t-3xl border-t border-black/5 bg-white px-4 pb-3 pt-3 shadow-[0_-8px_24px_-12px_rgb(30_42_36/0.18)]">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 grid grid-cols-4 gap-2" lang={language}>
            {QUICK.map((q) => {
              const Icon = q.icon
              return (
                <button key={q.key} onClick={() => quick(q)} disabled={sending || recording}
                  className={`flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-xs font-bold leading-tight shadow-sm ring-1 transition hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 sm:text-sm ${q.tone}`}>
                  <Icon className="size-6" /> <span className="line-clamp-2 text-center">{s.quick[q.key]}</span>
                </button>
              )
            })}
          </div>
          {voice.error && (
            <p className="mb-2 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger animate-fade-up" role="alert">
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> <span className="flex-1">{voice.error}</span>
              <button onClick={() => setVoice({ busy: false, error: null })} aria-label={s.close}><X className="size-4" /></button>
            </p>
          )}
          {recording ? (
            <>
            <p className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-center font-semibold text-danger animate-fade-up" role="status">
              <Mic className="size-5 shrink-0" /> {s.recording}
            </p>
            <div className="flex items-center gap-2">
              <div className="flex h-14 min-w-0 flex-1 items-center gap-2.5 rounded-2xl border border-danger/40 bg-danger-soft px-3">
                <span className="relative flex size-3 shrink-0"><span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" /><span className="relative inline-flex size-3 rounded-full bg-danger" /></span>
                <span className="font-mono font-bold tabular-nums text-danger">0:{String(recorder.seconds).padStart(2, '0')}</span>
                <Bars />
              </div>
              <button type="button" onClick={() => recorder.cancel()} aria-label={s.cancel} title={s.cancel}
                className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white text-muted shadow-soft hover:text-ink"><X className="size-6" /></button>
              <button type="button" onClick={finishRecording}
                className="flex h-14 shrink-0 items-center gap-2 rounded-2xl bg-danger px-4 text-base font-bold text-white shadow-soft animate-pulse-ring active:scale-95">
                <Square className="size-5 fill-current" /> {s.stopRecording}
              </button>
            </div>
            </>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex items-end gap-2">
              <div className="flex flex-1 items-end rounded-2xl border-2 border-black/10 bg-cream transition focus-within:border-brand focus-within:bg-white">
                <textarea
                  ref={inputRef} rows={1} value={text} lang={language} disabled={voice.busy}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder={voice.busy ? s.transcribing : s.placeholder}
                  className="max-h-36 min-h-[3.25rem] flex-1 resize-none bg-transparent px-4 py-3 text-lg outline-none placeholder:text-muted/70"
                  style={{ fieldSizing: 'content' }}
                />
              </div>
              {/* Speak is the main action (a labelled button, not an icon); it becomes Send once there is text. */}
              {canRecord && !text.trim() ? (
                <button type="button" onClick={startRecording} disabled={voice.busy || sending} aria-label={s.mic} title={s.mic}
                  className="flex h-14 shrink-0 items-center gap-2 rounded-2xl bg-gradient-to-b from-amber-500 to-saffron px-4 font-display text-lg font-bold text-white shadow-lift transition hover:brightness-105 active:scale-95 disabled:opacity-60">
                  {voice.busy ? <Loader2 className="size-6 animate-spin" /> : <Mic className="size-6" />}
                  <span className="hidden min-[400px]:inline">{s.speakBtn}</span>
                </button>
              ) : (
                <button type="submit" disabled={!text.trim() || sending || voice.busy} aria-label={s.send}
                  className="flex h-14 shrink-0 items-center gap-2 rounded-2xl bg-gradient-to-b from-brand to-brand-dark px-4 font-display text-lg font-bold text-white shadow-lift transition active:scale-95 disabled:opacity-40">
                  <SendHorizontal className="size-6" /> <span className="hidden min-[400px]:inline">{s.send}</span>
                </button>
              )}
            </form>
          )}
        </div>
      </div>
      <QuickEntrySheet s={s} mode={sheet.mode} employers={employers} defaultEmployer={sheet.employer}
        onClose={() => setSheet({ mode: null, employer: null })}
        onSubmit={(t) => { setSheet({ mode: null, employer: null }); send(t) }} />
    </div>
  )
}

function Bubble({ m, s, onRetry, onUndo, speechTag, language, showLearning, onOpenMemory }) {
  const [speaking, setSpeaking] = useState(false)
  const [voiceNote, setVoiceNote] = useState(null)

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

  const listen = async () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    setVoiceNote(null)
    setSpeaking(true)
    const result = await speak(m.content, speechTag, language, { onEnd: () => setSpeaking(false) })
    if (result !== 'ok') {
      setSpeaking(false)
      const name = LANGS.find((l) => l.code === language)?.native || language
      setVoiceNote(s.noVoice(name))
    }
  }

  return (
    <li className={`flex animate-fade-up flex-col ${mine ? 'items-end' : 'items-start'}`}>
      {/* Entries in a khata, not chat bubbles: HakDaar writes on white paper, the worker in blue ink. */}
      <article className={`max-w-[92%] px-4 pb-3 pt-2 sm:max-w-[80%] ${mine
        ? 'rounded-[20px_6px_20px_20px] border-r-4 border-ink-blue bg-[#EEF3FA] text-ink-blue shadow-soft'
        : 'rounded-[6px_20px_20px_20px] border-l-4 border-brand bg-paper text-ink shadow-soft'}`}>
        <header className={`mb-0.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${mine ? 'justify-end text-ink-blue/70' : 'text-brand'}`}>
          {mine ? <><PenLine className="size-3.5" /> {s.you}</> : <><Logo size={18} tone="dark" /> <span className="font-display text-sm normal-case tracking-normal">HakDaar</span></>}
        </header>
        <p className="whitespace-pre-wrap text-[1.07rem] leading-relaxed">{m.content}</p>
      </article>

      {mine && events.length > 0 && (
        <div className="mt-2 flex max-w-[92%] flex-col items-end gap-1.5">
          {events.map((e) => <ReceiptStub key={e.id} e={e} s={s} onUndo={onUndo} />)}
        </div>
      )}

      {voiceNote && <p className="mt-1 max-w-[85%] rounded-lg bg-warn-soft px-2 py-1 text-xs text-warn">{voiceNote}</p>}
      {m.warnings?.map((w) => (
        <p key={w} className="mt-1 flex items-center gap-1 text-xs text-warn"><AlertTriangle className="size-3.5" /> {w}</p>
      ))}

      <div className={`mt-1 flex items-center gap-2 px-1 text-xs text-muted ${mine ? 'flex-row-reverse' : ''}`}>
        {m.created_at && (
          <span>{new Date(m.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        )}
        {!mine && canSpeak && (
          <button onClick={listen} className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold transition ${speaking ? 'bg-brand text-white' : 'text-brand hover:bg-brand-soft'}`}>
            {speaking ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />} {speaking ? s.stopReading : s.listen}
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

const STUB = {
  promise: { icon: BriefcaseBusiness, tint: 'bg-sky-100 text-sky-700' },
  work_day: { icon: CalendarCheck, tint: 'bg-amber-100 text-amber-700' },
  payment: { icon: Banknote, tint: 'bg-emerald-100 text-emerald-700' },
}

/** Every recorded fact becomes a torn-off receipt with a "NOTED" rubber stamp (and an undo). */
function ReceiptStub({ e, s, onUndo }) {
  const [busy, setBusy] = useState(false)
  const conf = STUB[e.type]
  const Icon = conf.icon
  let label, value
  if (e.type === 'promise' && e.basis === 'fixed') { label = s.entryFixed; value = inr(e.amount) }
  else if (e.type === 'promise') { label = s.entryPromise; value = `${inr(e.amount)}${s.perDay}` }
  else if (e.type === 'work_day') { label = s.entryWork; value = `${e.days} ${e.days === 1 ? s.day1 : s.days}` }
  else { label = s.entryPay; value = inr(e.amount) }

  return (
    <div className={`stub flex items-center gap-3 py-2 pl-5 pr-3 ${e.undone ? 'opacity-50 grayscale' : ''}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-full ${conf.tint}`}><Icon className="size-5" /></span>
      <span className="min-w-0 border-l border-dashed border-black/15 pl-3">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">{label} · {e.employer_name}</span>
        <span className={`font-display text-xl font-bold leading-tight tabular-nums text-ink ${e.undone ? 'line-through' : ''}`}>{value}</span>
      </span>
      <span className={`stamp animate-stamp ml-1 shrink-0 px-1.5 py-0.5 text-[11px] font-extrabold ${e.undone ? 'text-muted' : 'text-brand'}`}>
        {e.undone ? s.undone : `✓ ${s.noted}`}
      </span>
      {!e.undone && (
        <button onClick={async () => { setBusy(true); await onUndo(e); setBusy(false) }} disabled={busy}
          title={s.undo} aria-label={`${s.undo}: ${label} ${value}`}
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-danger-soft hover:text-danger">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
        </button>
      )}
    </div>
  )
}

/** Little animated equaliser shown while recording. */
function Bars() {
  return (
    <span className="flex h-5 items-end gap-0.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="w-1 rounded-full bg-danger/70 eq-bar" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  )
}
