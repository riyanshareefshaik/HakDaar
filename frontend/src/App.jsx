import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, CircleAlert, Info, Loader2, MessagesSquare, RefreshCw, Users, WifiOff } from 'lucide-react'
import { api } from './api'
import { t } from './i18n'
import Header from './components/Header'
import WorkerPanel, { Avatar } from './components/WorkerPanel'
import ChatPanel from './components/ChatPanel'
import MemoryPanel from './components/MemoryPanel'

const LEDGER_TYPES = new Set(['promise', 'work_day', 'payment'])

function readStored(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, value) } catch { /* private mode: ignore */ }
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
  const [memories, setMemories] = useState([])
  const [memorySource, setMemorySource] = useState('profile')
  const [memoryError, setMemoryError] = useState(null)
  const [loadingWorker, setLoadingWorker] = useState(false)

  const [sending, setSending] = useState(false)
  const [banner, setBanner] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [tab, setTab] = useState('chat')

  const worker = workers.find((w) => w.id === activeId) || null
  const language = worker?.language || uiLang
  const s = t(language)

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

  // ---------- load a worker ----------
  const loadWorker = useCallback(async (id) => {
    setLoadingWorker(true)
    setBanner(null)
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
    // Memories come from Hindsight and may be slower or offline; load them separately.
    setMemorySource('profile')
    try {
      const m = await api.memories(id)
      setMemories(m.memories)
    } catch (e) {
      setMemories([])
      setMemoryError(e.message)
    }
  }, [])

  useEffect(() => {
    if (activeId) {
      writeStored('hakdaar.worker', activeId)
      loadWorker(activeId)
    } else {
      setMessages([]); setLedger(null); setAlerts([]); setMemories([])
    }
  }, [activeId, loadWorker])

  const showToast = (msg, kind = 'info') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 5000)
  }

  // ---------- actions ----------
  const send = async (text) => {
    if (!worker) return
    const id = worker.id
    setMessages((m) => [...m, { role: 'user', content: text, created_at: new Date().toISOString(), pending: true }])
    setSending(true)
    try {
      const r = await api.chat(id, text)
      const events = r.extracted_events.filter((e) => LEDGER_TYPES.has(e.type))
      setMessages((m) => {
        const copy = [...m]
        const i = copy.findLastIndex((x) => x.pending)
        if (i >= 0) copy[i] = { ...copy[i], pending: false, events }
        return [...copy, { role: 'assistant', content: r.reply, warnings: r.warnings, created_at: new Date().toISOString() }]
      })
      setAlerts(r.alerts)
      setMemories(r.recalled_memories)
      setMemorySource('latest')
      setMemoryError(r.warnings?.find((w) => w.startsWith('Memory')) || null)
      const under = r.alerts.find((a) => a.type === 'underpayment')
      setBanner(under || null)
      api.ledger(id).then(setLedger).catch(() => {})
    } catch (e) {
      setMessages((m) => {
        const copy = m.filter((x) => !x.pending)
        return [...copy, { role: 'error', content: e.message, retry: text }]
      })
    } finally {
      setSending(false)
    }
  }

  const retry = (text) => {
    setMessages((m) => m.filter((x) => x.retry !== text))
    send(text)
  }

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
      setTab('chat')
    } catch (e) { showToast(e.message, 'error') } finally { setBusy(false) }
  }

  const seed = async () => {
    setBusy(true)
    try {
      const r = await api.seed()
      setWorkers(r.workers)
      const first = r.workers[0]?.id ?? null
      setActiveId(first)
      if (first) loadWorker(first) // reload even if the id happens to match
      setTab('chat')
      showToast(r.warnings?.length ? r.warnings.at(-1) : r.note, r.warnings?.length ? 'error' : 'info')
    } catch (e) { showToast(e.message, 'error') } finally { setBusy(false) }
  }

  const reset = async () => {
    if (!window.confirm('Delete all workers, chats and HakDaar memories?')) return
    setBusy(true)
    try {
      await api.reset()
      setWorkers([]); setActiveId(null); setBanner(null)
    } catch (e) { showToast(e.message, 'error') } finally { setBusy(false) }
  }

  const topEmployer = ledger?.employers?.[0]?.employer_name
  const suggestions = useMemo(() => s.suggestions(topEmployer), [s, topEmployer])
  const owedTotal = ledger?.totals?.amount_owed || 0

  // ---------- backend unreachable ----------
  if (backendError) {
    return (
      <div className="flex h-dvh flex-col">
        <Header s={s} />
        <div className="grid flex-1 place-items-center p-6">
          <div className="card max-w-md p-6 text-center">
            <WifiOff className="mx-auto mb-3 size-10 text-danger" />
            <p className="text-lg font-bold">{s.backendDown}</p>
            <p className="mt-1 text-muted">{backendError}</p>
            <code className="mt-3 block rounded-lg bg-sand p-2 text-left text-sm">cd backend &amp;&amp; uvicorn app.main:app --reload --port 8000</code>
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

  const tabs = [
    { id: 'workers', label: s.workers, icon: Users },
    { id: 'chat', label: s.chat, icon: MessagesSquare },
    { id: 'memory', label: s.memory, icon: Brain, dot: owedTotal > 0 },
  ]

  return (
    <div className="flex h-dvh flex-col">
      <Header s={s} health={health} />

      {(!health.hindsight.ok || !health.groq.ok) && (
        <div className="flex items-center gap-2 bg-warn-soft px-4 py-2 text-sm text-warn">
          <CircleAlert className="size-4 shrink-0" />
          <span className="flex-1">{!health.groq.ok ? s.aiOffline : s.memoryOffline}</span>
          <button onClick={boot} className="font-semibold underline">{s.retry}</button>
        </div>
      )}

      <main className="mx-auto grid min-h-0 w-full max-w-[1500px] flex-1 lg:grid-cols-[290px_minmax(0,1fr)_380px]">
        <aside className={`${tab === 'workers' ? 'block' : 'hidden'} min-h-0 lg:block lg:border-r lg:border-black/5`}>
          <WorkerPanel
            s={s} workers={workers} activeId={activeId} language={language} busy={busy}
            onSelect={(id) => { setActiveId(id); setTab('chat') }}
            onLanguage={changeLanguage} onCreate={createWorker} onSeed={seed} onReset={reset}
          />
        </aside>

        <section className={`${tab === 'chat' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
          {worker && (
            <div className="flex items-center gap-3 border-b border-black/5 px-4 py-2.5">
              <Avatar name={worker.name} index={workers.indexOf(worker)} size="size-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold leading-tight">{worker.name}</p>
                <p className="text-xs text-muted">worker-{worker.id}</p>
              </div>
              {owedTotal > 0 && (
                <button onClick={() => setTab('memory')} className="rounded-full bg-danger-soft px-3 py-1 text-sm font-bold text-danger lg:hidden">
                  {s.owed} ₹{owedTotal.toLocaleString('en-IN')}
                </button>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <ChatPanel
              s={s} worker={worker} language={language} messages={messages} sending={sending} loading={loadingWorker}
              onSend={send} onRetry={retry} banner={banner} onDismissBanner={() => setBanner(null)} suggestions={suggestions}
            />
          </div>
        </section>

        <aside className={`${tab === 'memory' ? 'block' : 'hidden'} min-h-0 lg:block lg:border-l lg:border-black/5 lg:bg-sand/40`}>
          <MemoryPanel
            s={s} worker={worker} ledger={ledger} memories={memories} memorySource={memorySource}
            memoryError={memoryError} alerts={alerts} loading={loadingWorker}
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

      {toast && (
        <div className={`fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md rounded-xl px-4 py-3 text-sm shadow-soft animate-slide-down lg:bottom-6 ${toast.kind === 'error' ? 'bg-danger text-white' : 'bg-ink text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
