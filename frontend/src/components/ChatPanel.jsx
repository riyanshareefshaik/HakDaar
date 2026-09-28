import { Fragment, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Banknote, BriefcaseBusiness, CalendarCheck, CircleAlert, CircleHelp, Loader2,
  Check, Mic, RefreshCw, SendHorizontal, Sparkles, Square, Undo2, Volume2, VolumeX, X,
} from 'lucide-react'
import { api, inr } from '../api'
import { LANGS } from '../i18n'
import { canRecord, canSpeak, speak, stopSpeaking, useRecorder } from '../hooks'
import WelcomeCard from './WelcomeCard'
import QuickEntrySheet from './QuickEntrySheet'
import Logo from './Logo'


// Big picture buttons: recognisable by icon, no reading needed.
const QUICK = [
  { key: 'promise', icon: BriefcaseBusiness },
  { key: 'worked', icon: CalendarCheck },
  { key: 'paid', icon: Banknote },
  { key: 'owed', icon: CircleHelp, sendNow: true },
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
        <div className="px-4 pt-4 sm:px-6">
          <div role="alert" className="flex items-center gap-3 rounded-2xl border border-owed/40 bg-owed/10 px-4 py-3 animate-rise">
            <span className="relative flex size-2.5 shrink-0"><span className="absolute inline-flex size-full rounded-full bg-owed animate-ping-soft" /><span className="relative size-2.5 rounded-full bg-owed" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">{s.owesYou(banner.employer_name, inr(banner.amount_owed))}</p>
              <p className="hidden text-[13px] leading-snug text-fg2/80 sm:block">{banner.message}</p>
            </div>
            <button onClick={onDismissBanner} className="rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-white" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scroll-thin px-4 py-5 sm:px-6" lang={language}>
        {loading ? (
          <div className="mx-auto max-w-3xl space-y-3">
            {[60, 40, 70].map((w, i) => (
              <div key={i} className={`h-14 animate-pulse rounded-2xl bg-card ${i % 2 ? 'ml-auto' : ''}`} style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : messages.length === 0 ? (
          /* First visit: a quiet greeting in the landing page's style instead of an empty screen */
          <div className="flex min-h-full flex-col items-center justify-center px-2 py-8 text-center animate-rise">
            <span className="mb-5 inline-flex items-center rounded-full border border-line-strong bg-pill px-4 py-1.5 text-[13px] text-fg2">{s.tagline}</span>
            <h2 className="font-display text-[clamp(34px,5.5vw,64px)] leading-[1.08] tracking-[-0.04em] text-white">
              <span className="block">{s.hello}</span>
              <span className="block">{worker.name}</span>
            </h2>
            <p className="mx-auto mt-4 max-w-[46ch] text-[16.5px] leading-relaxed text-fg2/80">{s.emptyChatBody}</p>
          </div>
        ) : (
          <ul className="mx-auto max-w-3xl space-y-5">
            {messages.map((m, i) => (
              <Fragment key={m.id ?? `local-${i}`}>
                {i === welcomeAt && welcomeEl}
                <Bubble m={m} s={s} onRetry={onRetry} onUndo={onUndo} speechTag={speechTag} language={language} onOpenMemory={onOpenMemory}
                  showLearning={i === lastAssistant && !sending ? learning : null} />
              </Fragment>
            ))}
            {welcomeAt >= messages.length && welcomeEl}
            {sending && (
              <li className="flex items-center gap-3 text-muted animate-fade">
                <span className="flex gap-1 rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 backdrop-blur-md">
                  <span className="typing-dot size-1.5 rounded-full bg-white" />
                  <span className="typing-dot size-1.5 rounded-full bg-white" />
                  <span className="typing-dot size-1.5 rounded-full bg-white" />
                </span>
                <span className="text-sm">{s.typing}</span>
              </li>
            )}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line px-4 pb-4 pt-3 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto" lang={language}>
            {QUICK.map((q) => {
              const Icon = q.icon
              return (
                <button key={q.key} onClick={() => quick(q)} disabled={sending || recording}
                  className="btn-dark shrink-0 px-4 py-2 text-[14px] disabled:opacity-40">
                  <Icon className="size-[18px]" /> {s.quick[q.key]}
                </button>
              )
            })}
          </div>
          {voice.error && (
            <p className="mb-3 flex items-start gap-2 rounded-2xl border border-owed/40 bg-owed/10 px-3.5 py-2.5 text-sm text-owed animate-fade" role="alert">
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> <span className="flex-1">{voice.error}</span>
              <button onClick={() => setVoice({ busy: false, error: null })} aria-label={s.close}><X className="size-4" /></button>
            </p>
          )}
          {recording ? (
            <div role="status">
              <p className="mb-2 text-center text-sm text-fg2">{s.recording}</p>
              <div className="flex items-center gap-2">
                <div className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full border border-line bg-card px-4">
                  <span className="size-2.5 shrink-0 rounded-full bg-owed animate-ping-soft" />
                  <span className="font-display text-lg tabular-nums text-white">0:{String(recorder.seconds).padStart(2, '0')}</span>
                  <Bars />
                </div>
                <button type="button" onClick={() => recorder.cancel()} aria-label={s.cancel} title={s.cancel}
                  className="grid size-12 shrink-0 place-items-center rounded-full border border-line-strong bg-pill text-fg2 hover:text-white"><X className="size-5" /></button>
                <button type="button" onClick={finishRecording} className="btn-white h-12 shrink-0 px-5">
                  <Square className="size-4 fill-current" /> {s.stopRecording}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex items-end gap-2">
              <div className="flex flex-1 items-end rounded-[24px] border border-line bg-card transition focus-within:border-white/40">
                <textarea
                  ref={inputRef} rows={1} value={text} lang={language} disabled={voice.busy}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder={voice.busy ? s.transcribing : s.placeholder}
                  className="max-h-36 min-h-12 flex-1 resize-none bg-transparent px-5 py-3 text-[16.5px] text-white outline-none placeholder:text-muted/70"
                  style={{ fieldSizing: 'content' }}
                />
              </div>
              {/* Speak is the main action (a labelled button); it becomes Send once there is text. */}
              {canRecord && !text.trim() ? (
                <button type="button" onClick={startRecording} disabled={voice.busy || sending} aria-label={s.mic} title={s.mic}
                  className="btn-white h-12 shrink-0 px-5">
                  {voice.busy ? <Loader2 className="size-5 animate-spin" /> : <Mic className="size-5" />}
                  <span className="hidden min-[400px]:inline">{s.speakBtn}</span>
                </button>
              ) : (
                <button type="submit" disabled={!text.trim() || sending || voice.busy} aria-label={s.send}
                  className="btn-white h-12 shrink-0 px-5">
                  <SendHorizontal className="size-5" /> <span className="hidden min-[400px]:inline">{s.send}</span>
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
      <li className="flex items-start gap-2.5 rounded-2xl border border-owed/40 bg-owed/10 px-4 py-3 text-owed animate-rise">
        <CircleAlert className="mt-0.5 size-5 shrink-0" />
        <div className="flex-1">
          <p className="font-medium">{m.content}</p>
          {m.retry && (
            <button onClick={() => onRetry(m.retry)} className="mt-1.5 flex items-center gap-1 text-sm font-semibold text-white underline underline-offset-2">
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
    <li className={`flex flex-col animate-rise ${mine ? 'items-end' : 'items-start'}`}>
      {/* The worker's messages in white (like the landing CTA), HakDaar's on dark cards. */}
      {mine ? (
        <p className="max-w-[88%] whitespace-pre-wrap rounded-[22px] rounded-br-md bg-white px-4 py-2.5 text-[16px] leading-relaxed text-black sm:max-w-[75%]">{m.content}</p>
      ) : (
        <div className="max-w-[92%] sm:max-w-[80%]">
          <p className="mb-1.5 flex items-center gap-2 text-[12px] text-muted">
            <span className="grid size-6 place-items-center rounded-full border border-line-strong bg-black"><Logo size={20} /></span> HakDaar
          </p>
          <p className="whitespace-pre-wrap rounded-[22px] rounded-tl-md border border-white/10 bg-white/[0.06] px-4 py-3 text-[16px] leading-relaxed text-fg backdrop-blur-md">{m.content}</p>
        </div>
      )}

      {mine && events.length > 0 && (
        <div className="mt-2 flex max-w-[92%] flex-wrap justify-end gap-1.5">
          {events.map((e) => <EntryChip key={e.id} e={e} s={s} onUndo={onUndo} />)}
        </div>
      )}

      {voiceNote && <p className="mt-1.5 max-w-[85%] rounded-xl border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-warn">{voiceNote}</p>}
      {m.warnings?.map((w) => (
        <p key={w} className="mt-1.5 flex items-center gap-1.5 text-xs text-warn"><AlertTriangle className="size-3.5" /> {w}</p>
      ))}

      <div className={`mt-1.5 flex items-center gap-3 px-1 text-[12px] text-muted ${mine ? 'flex-row-reverse' : ''}`}>
        {m.created_at && (
          <span className="tabular-nums">{new Date(m.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        )}
        {!mine && canSpeak && (
          <button onClick={listen} className={`flex items-center gap-1 font-medium transition ${speaking ? 'text-white' : 'hover:text-white'}`}>
            {speaking ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />} {speaking ? s.stopReading : s.listen}
          </button>
        )}
        {showLearning === 'pending' && (
          <span className="flex items-center gap-1"><Loader2 className="size-3.5 animate-spin" /> {s.learning}</span>
        )}
        {typeof showLearning === 'number' && showLearning > 0 && (
          <button onClick={onOpenMemory} className="flex items-center gap-1 font-medium text-fg2 transition animate-fade hover:text-white">
            <Sparkles className="size-3.5" /> {s.learnedNew(showLearning)}
          </button>
        )}
      </div>
    </li>
  )
}

const ENTRY_ICONS = { promise: BriefcaseBusiness, work_day: CalendarCheck, payment: Banknote }

/** What HakDaar recorded from the message, as a small pill with an undo. */
function EntryChip({ e, s, onUndo }) {
  const [busy, setBusy] = useState(false)
  const Icon = ENTRY_ICONS[e.type]
  let label, value
  if (e.type === 'promise' && e.basis === 'fixed') { label = s.entryFixed; value = inr(e.amount) }
  else if (e.type === 'promise') { label = s.entryPromise; value = `${inr(e.amount)}${s.perDay}` }
  else if (e.type === 'work_day') { label = s.entryWork; value = `${e.days} ${e.days === 1 ? s.day1 : s.days}` }
  else { label = s.entryPay; value = inr(e.amount) }

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border border-line-strong bg-pill py-1 pl-3 pr-1 text-[13px] text-fg2 ${e.undone ? 'opacity-40' : ''}`}>
      <Icon className="size-3.5 shrink-0 text-muted" />
      <span className={e.undone ? 'line-through' : ''}>{label} · {e.employer_name} · <span className="font-semibold tabular-nums text-white">{value}</span></span>
      {e.undone ? (
        <span className="pr-2 text-muted">{s.undone}</span>
      ) : (
        <>
          <span className="flex items-center gap-1 text-ok"><Check className="size-3.5" /> {s.noted}</span>
          <button onClick={async () => { setBusy(true); await onUndo(e); setBusy(false) }} disabled={busy}
            title={s.undo} aria-label={`${s.undo}: ${label} ${value}`}
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-white">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
          </button>
        </>
      )}
    </span>
  )
}

/** Little animated equaliser shown while recording. */
function Bars() {
  return (
    <span className="flex h-5 items-end gap-0.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="w-[3px] rounded-full bg-white/70 eq-bar" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  )
}
