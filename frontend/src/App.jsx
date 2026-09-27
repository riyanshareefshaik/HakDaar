import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, CircleAlert, Info, Loader2, MessagesSquare, RefreshCw, Users, WifiOff } from 'lucide-react'
import { api, inr } from './api'
import { t } from './i18n'
import { useCountUp } from './hooks'
import Header from './components/Header'
import WorkerPanel, { Avatar } from './components/WorkerPanel'
import ChatPanel from './components/ChatPanel'
import MemoryPanel from './components/MemoryPanel'
import Onboarding from './components/Onboarding'

const LEDGER_TYPES = new Set(['promise', 'work_day', 'payment'])
// Hindsight extracts facts in the background after retain; re-check a few times to show learning live.
const LEARN_POLL_MS = [2500, 6000, 12000, 25000, 45000]
const EMPTY_LEARNED = { total: 0, items: [] }

function readStored(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, value) } catch { /* storage blocked: ignore */ }
}

export default function App() {
  const [health, setHealth] = useState(null)
  const [backendError, setBackendError] = useState(null)
  const [workers, setWorkers] = useState([])
  const [activeId, setActiveId] = useState(() => readStored('hakdaar.worker'))
  const [uiLang, setUiLang] = useState('en')

  const [messages, setMessages] = useState([])
  const [ledger, setLedger] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [recalled, setRecalled] = useState([])
  const [learned, setLearned] = useState(EMPTY_LEARNED)
  const [newIds, setNewIds] = useState(new Set())
  const [learning, setLearning] = useState(null) // null | 'pending' | number of new facts
  const [memoryError, setMemoryError] = useState(null)
  const [loadingWorker, setLoadingWorker] = useState(false)

  const [sending, setSending] = useState(false)
  const [banner, setBanner] = useState(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [toast, setToast] = useState(null)
  const [tab, setTab] = useState('chat')

  const pollTimers = useRef([])
  const learnedRef = useRef(EMPTY_LEARNED)
  learnedRef.current = learned

  const worker = workers.find((w) => w.id === activeId) || null
  const language = worker?.language || uiLang
  const s = t(language)

  const showToast = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 5000)
  }, [])

  // ---------- boot ----------
  const boot = useCallback(async () => {
    setBackendError(null)
    try {
      const [h, ws] = await Promise.all([api.health(), api.workers()])
      setHealth(h)
      setWorkers(ws)
      setActiveId((cur) => (ws.some((w) => w.id === cur) ? cur : ws[0]?.id ?? null))
    } catch (e) {
      setBackendError(e.message)
    }
  }, [])
  useEffect(() => { boot() }, [boot])

  // ---------- memory ----------
  const stopPolling = () => { pollTimers.current.forEach(clearTimeout); pollTimers.current = [] }

  const refreshMemory = useCallback(async (id, { announce = false } = {}) => {
    try {
      const m = await api.memories(id)
      const before = learnedRef.current
      const known = new Set(before.items.map((x) => x.id))
      const fresh = m.learned.filter((x) => !known.has(x.id)).map((x) => x.id)
      setLearned({ total: m.total_learned, items: m.learned })
      setMemoryError(null)
      if (announce && m.total_learned > before.total) {
        setNewIds(new Set(fresh))
        setLearning(m.total_learned - before.total)
        return true
      }
    } catch (e) {
      setMemoryError(e.message)
    }
    return false
  }, [])

  const watchLearning = useCallback((id) => {
    stopPolling()
    setLearning('pending')
    let done = false
    LEARN_POLL_MS.forEach((ms, i) => {
      pollTimers.current.push(setTimeout(async () => {
        if (done) return
        const got = await refreshMemory(id, { announce: true })
        if (got) done = true
        else if (i === LEARN_POLL_MS.length - 1) setLearning(null)
      }, ms))
    })
  }, [refreshMemory])

  // ---------- load a worker ----------
  const loadWorker = useCallback(async (id) => {
    stopPolling()
    setLoadingWorker(true)
    setBanner(null)
    setLearning(null)
    setNewIds(new Set())
    setRecalled([])
    setLearned(EMPTY_LEARNED)
    setMemoryError(null)
    try {
      const [msgs, led, al] = await Promise.all([api.messages(id), api.ledger(id), api.alerts(id)])
      setMessages(msgs)
      setLedger(led)
      setAlerts(al)
    } catch (e) {
      setMessages([{ role: 'error', content: e.message }])
    } finally {
      setLoadingWorker(false)
    }
    refreshMemory(id) // Hindsight may be slower or offline; don't block the chat on it.
  }, [refreshMemory])

  useEffect(() => {
    if (activeId) {
      writeStored('hakdaar.worker', activeId)
      loadWorker(activeId)
    } else {
      stopPolling()
      setMessages([]); setLedger(null); setAlerts([]); setRecalled([]); setLearned(EMPTY_LEARNED)
    }
    return stopPolling
  }, [activeId, loadWorker])

  // ---------- chat ----------
  const send = async (text) => {
    if (!worker) return
    const id = worker.id
    stopPolling()
    setLearning(null)
    setNewIds(new Set())
    setMessages((m) => [...m, { role: 'user', content: text, created_at: new Date().toISOString(), pending: true }])
    setSending(true)
    try {
      const r = await api.chat(id, text)
      const events = r.extracted_events.filter((e) => LEDGER_TYPES.has(e.type) && e.id)
      setMessages((m) => {
        const copy = [...m]
        const i = copy.findLastIndex((x) => x.pending)
        if (i >= 0) copy[i] = { ...copy[i], pending: false, events }
        return [...copy, { role: 'assistant', content: r.reply, warnings: r.warnings, created_at: new Date().toISOString() }]
      })
      setAlerts(r.alerts)
      setRecalled(r.recalled_memories)
      const memWarn = r.warnings?.find((w) => w.startsWith('Memory'))
      setMemoryError(memWarn || null)
      setBanner(r.alerts.find((a) => a.type === 'underpayment') || null)
      api.ledger(id).then(setLedger).catch(() => {})
      if (!memWarn) watchLearning(id)
    } catch (e) {
      setMessages((m) => [...m.filter((x) => !x.pending), { role: 'error', content: e.message, retry: text }])
    } finally {
      setSending(false)
    }
  }

  const retry = (text) => {
    setMessages((m) => m.filter((x) => x.retry !== text))
    send(text)
  }

  const undo = async (event) => {
    if (!worker) return
    try {
      const r = await api.deleteEvent(worker.id, event.id)
      setLedger(r.ledger)
      setMessages((ms) => ms.map((m) => (m.events?.some((e) => e.id === event.id)
        ? { ...m, events: m.events.map((e) => (e.id === event.id ? { ...e, undone: true } : e)) }
        : m)))
      const al = await api.alerts(worker.id)
      setAlerts(al)
      setBanner((b) => (b ? al.find((a) => a.type === 'underpayment' && a.employer_name === b.employer_name) || null : null))
      if (r.warning) showToast(r.warning, 'error')
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  // ---------- workers ----------
  const changeLanguage = async (code) => {
    setUiLang(code)
    if (!worker || worker.language === code) return
    setWorkers((ws) => ws.map((w) => (w.id === worker.id ? { ...w, language: code } : w)))
    try { await api.setLanguage(worker.id, code) } catch (e) { showToast(e.message, 'error') }
  }

  const createWorker = async (w) => {
    setBusy(true)
    try {
      const nw = await api.createWorker(w)
      setWorkers((ws) => [...ws, nw])
      setActiveId(nw.id)
      setAdding(false)
      setTab('chat')
    } catch (e) { showToast(e.message, 'error') } finally { setBusy(false) }
  }

  const deleteWorker = async (w) => {
    if (!window.confirm(s.confirmDeleteWorker(w.name))) return
    setBusy(true)
    try {
      const r = await api.deleteWorker(w.id)
      setWorkers((ws) => {
        const rest = ws.filter((x) => x.id !== w.id)
        if (activeId === w.id) setActiveId(rest[0]?.id ?? null)
        return rest
      })
      if (r.warning) showToast(r.warning, 'error')
    } catch (e) { showToast(e.message, 'error') } finally { setBusy(false) }
  }

  const reset = async () => {
    if (!window.confirm(s.confirmReset)) return
    setBusy(true)
    try {
      const r = await api.reset()
      setWorkers([]); setActiveId(null); setBanner(null)
      if (r.warning) showToast(r.warning, 'error')
    } catch (e) { showToast(e.message, 'error') } finally { setBusy(false) }
  }

  const totals = ledger?.totals || { amount_earned: 0, amount_paid: 0, amount_owed: 0 }

  // ---------- screens ----------
  if (backendError) {
    return (
      <div className="flex h-dvh flex-col">
        <Header s={s} />
        <div className="grid flex-1 place-items-center p-6">
          <div className="card max-w-md p-6 text-center">
            <WifiOff className="mx-auto mb-3 size-10 text-danger" />
            <p className="text-lg font-bold">{s.backendDown}</p>
            <p className="mt-1 text-muted">{backendError}</p>
            <code className="mt-3 block rounded-lg bg-sand p-2 text-left text-sm">./scripts/start-backend.sh</code>
            <button onClick={boot} className="mx-auto mt-4 flex items-center gap-2 rounded-xl bg-brand px-4 py-2 font-semibold text-white">
              <RefreshCw className="size-4" /> {s.retry}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!health) {
    return <div className="grid h-dvh place-items-center"><Loader2 className="size-8 animate-spin text-brand" /></div>
  }

  const degraded = (!health.hindsight.ok || !health.groq.ok) && (
    <div className="flex items-center gap-2 bg-warn-soft px-4 py-2 text-sm text-warn">
      <CircleAlert className="size-4 shrink-0" />
      <span className="flex-1">{!health.groq.ok ? s.aiOffline : s.memoryOffline}</span>
      <button onClick={boot} className="font-semibold underline">{s.retry}</button>
    </div>
  )

  if (workers.length === 0) {
    return (
      <div className="flex h-dvh flex-col">
        <Header s={s} health={health} />
        {degraded}
        <div className="flex-1 overflow-y-auto"><Onboarding onCreate={createWorker} busy={busy} /></div>
        <footer className="border-t border-black/5 px-4 py-2 text-center text-xs text-muted"><Info className="mr-1 inline size-3.5 align-[-2px]" />{s.footer}</footer>
        <Toast toast={toast} />
      </div>
    )
  }

  const tabs = [
    { id: 'workers', label: s.workers, icon: Users },
    { id: 'chat', label: s.chat, icon: MessagesSquare },
    { id: 'memory', label: s.memory, icon: Brain, dot: totals.amount_owed > 0 || learning > 0 },
  ]

  return (
    <div className="flex h-dvh flex-col">
      <Header s={s} health={health} />
      {degraded}

      <main className="mx-auto grid min-h-0 w-full max-w-[1500px] flex-1 lg:grid-cols-[290px_minmax(0,1fr)_390px]">
        <aside className={`${tab === 'workers' ? 'block' : 'hidden'} min-h-0 lg:block lg:border-r lg:border-black/5`}>
          <WorkerPanel
            s={s} workers={workers} activeId={activeId} activeOwed={totals.amount_owed} language={language} busy={busy}
            onSelect={(id) => { setActiveId(id); setTab('chat') }}
            onLanguage={changeLanguage} onAdd={() => setAdding(true)} onDelete={deleteWorker} onReset={reset}
          />
        </aside>

        <section className={`${tab === 'chat' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
          {worker && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-black/5 px-4 py-2.5">
              <Avatar name={worker.name} index={workers.indexOf(worker)} size="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold leading-tight">{worker.name}</p>
                <p className="truncate text-xs text-muted">
                  <Brain className="mr-1 inline size-3 align-[-1px]" />worker-{worker.id} · {learned.total}
                </p>
              </div>
              <Wallet s={s} totals={totals} onClick={() => setTab('memory')} />
            </div>
          )}
          <div className="min-h-0 flex-1">
            <ChatPanel
              s={s} worker={worker} language={language} messages={messages} sending={sending} loading={loadingWorker}
              onSend={send} onRetry={retry} onUndo={undo} banner={banner} onDismissBanner={() => setBanner(null)}
              learning={learning}
            />
          </div>
        </section>

        <aside className={`${tab === 'memory' ? 'block' : 'hidden'} min-h-0 lg:block lg:border-l lg:border-black/5 lg:bg-sand/40`}>
          <MemoryPanel
            s={s} worker={worker} ledger={ledger} recalled={recalled} learned={learned} newIds={newIds}
            memoryError={memoryError} alerts={alerts} loading={loadingWorker} learning={learning} onUndo={undo}
          />
        </aside>
      </main>

      <footer className="hidden border-t border-black/5 px-4 py-1.5 text-center text-xs text-muted lg:block" lang={language}>
        <Info className="mr-1 inline size-3.5 align-[-2px]" />{s.footer}
      </footer>

      <nav className="grid grid-cols-3 border-t border-black/10 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {tabs.map(({ id, label, icon: Icon, dot }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`relative flex flex-col items-center gap-0.5 py-2 text-sm font-semibold ${tab === id ? 'text-brand' : 'text-muted'}`}>
            <Icon className="size-6" />
            {label}
            {dot && <span className="absolute right-[30%] top-1.5 size-2.5 rounded-full bg-danger ring-2 ring-white" />}
            {tab === id && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-brand" />}
          </button>
        ))}
      </nav>

      {adding && (
        <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-ink/40 p-2 backdrop-blur-sm" onClick={() => setAdding(false)}>
          <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <Onboarding compact onCreate={createWorker} busy={busy} onCancel={() => setAdding(false)} />
          </div>
        </div>
      )}
      <Toast toast={toast} />
    </div>
  )
}

function Wallet({ s, totals, onClick }) {
  const earned = useCountUp(totals.amount_earned)
  const paid = useCountUp(totals.amount_paid)
  const owed = useCountUp(totals.amount_owed)
  const tile = 'rounded-xl px-3 py-1.5 text-right leading-tight'
  return (
    <button onClick={onClick} className="flex w-full gap-1.5 sm:w-auto" title={s.ledger}>
      <span className={`${tile} flex-1 bg-sand`}>
        <span className="block text-[11px] font-semibold uppercase text-muted">{s.wallet.earned}</span>
        <span className="font-bold tabular-nums">{inr(earned)}</span>
      </span>
      <span className={`${tile} flex-1 bg-sand`}>
        <span className="block text-[11px] font-semibold uppercase text-muted">{s.wallet.paid}</span>
        <span className="font-bold tabular-nums">{inr(paid)}</span>
      </span>
      <span className={`${tile} flex-1 ${totals.amount_owed > 0 ? 'bg-danger text-white' : 'bg-brand-soft text-brand'}`}>
        <span className={`block text-[11px] font-semibold uppercase ${totals.amount_owed > 0 ? 'text-white/85' : ''}`}>{s.wallet.owed}</span>
        <span className="font-extrabold tabular-nums">{inr(owed)}</span>
      </span>
    </button>
  )
}

function Toast({ toast }) {
  if (!toast) return null
  return (
    <div role="status" className={`fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md rounded-xl px-4 py-3 text-sm shadow-soft animate-slide-down lg:bottom-6 ${toast.kind === 'error' ? 'bg-danger text-white' : 'bg-ink text-white'}`}>
      {toast.msg}
    </div>
  )
}
