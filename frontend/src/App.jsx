import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, Info, Loader2, MessagesSquare, RefreshCw, UserRound, Wallet as WalletIcon, WifiOff } from 'lucide-react'
import { ApiError, api, inr } from './api'
import { t } from './i18n'
import { useCountUp } from './hooks'
import Header, { Avatar } from './components/Header'
import ChatPanel from './components/ChatPanel'
import LedgerPanel from './components/LedgerPanel'
import Login from './components/Login'
import AccountDrawer from './components/AccountDrawer'

const LEDGER_TYPES = new Set(['promise', 'work_day', 'payment'])
// Hindsight extracts facts in the background after retain; re-check a few times to show learning live.
const LEARN_POLL_MS = [2500, 6000, 12000, 25000, 45000]
const EMPTY_LEARNED = { total: 0, items: [] }
const SESSION_KEY = 'hakdaar.session'

function readStored(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStored(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch { /* storage blocked */ }
}

export default function App() {
  const [health, setHealth] = useState(null)
  const [backendError, setBackendError] = useState(null)
  const [worker, setWorker] = useState(null)
  const [booted, setBooted] = useState(false)
  const [uiLang, setUiLang] = useState(() => readStored('hakdaar.lang') || 'te')

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
  const [toast, setToast] = useState(null)
  const [tab, setTab] = useState('chat')
  const [drawer, setDrawer] = useState({ open: false, section: 'memories' })

  const pollTimers = useRef([])
  const learnedRef = useRef(EMPTY_LEARNED)
  learnedRef.current = learned

  const language = worker?.language || uiLang
  const s = t(language)

  const showToast = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 5000)
  }, [])

  // ---------- boot: health + restore session ----------
  const boot = useCallback(async () => {
    setBackendError(null)
    try {
      setHealth(await api.health())
      const id = readStored(SESSION_KEY)
      if (id) {
        try {
          setWorker(await api.worker(id))
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) writeStored(SESSION_KEY, null)
          else throw e
        }
      }
    } catch (e) {
      setBackendError(e.message)
    } finally {
      setBooted(true)
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
      setLearned({ total: m.total_learned, items: m.learned })
      setMemoryError(null)
      if (announce && m.total_learned > before.total) {
        setNewIds(new Set(m.learned.filter((x) => !known.has(x.id)).map((x) => x.id)))
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
        if (await refreshMemory(id, { announce: true })) done = true
        else if (i === LEARN_POLL_MS.length - 1) setLearning(null)
      }, ms))
    })
  }, [refreshMemory])

  // ---------- load the logged-in worker ----------
  const loadWorker = useCallback(async (id) => {
    stopPolling()
    setLoadingWorker(true)
    setBanner(null); setLearning(null); setNewIds(new Set()); setRecalled([]); setLearned(EMPTY_LEARNED); setMemoryError(null)
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
    if (worker?.id) loadWorker(worker.id)
    return stopPolling
  }, [worker?.id, loadWorker])

  // ---------- auth ----------
  const startSession = (w) => {
    writeStored(SESSION_KEY, w.id)
    setWorker(w)
    setTab('chat')
  }
  const login = async (creds) => startSession(await api.login(creds))
  const register = async (body) => startSession(await api.register(body))

  const logout = () => {
    stopPolling()
    writeStored(SESSION_KEY, null)
    setDrawer({ open: false })
    setWorker(null)
    setMessages([]); setLedger(null); setAlerts([]); setBanner(null)
  }

  const deleteAccount = async () => {
    if (!window.confirm(s.confirmDeleteAccount)) return
    try {
      const r = await api.deleteWorker(worker.id)
      if (r.warning) showToast(r.warning, 'error')
      logout()
    } catch (e) { showToast(e.message, 'error') }
  }

  const resetAll = async () => {
    if (!window.confirm(s.confirmReset)) return
    try {
      const r = await api.reset()
      if (r.warning) showToast(r.warning, 'error')
      logout()
    } catch (e) { showToast(e.message, 'error') }
  }

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

  const changeLanguage = async (code) => {
    setUiLang(code)
    writeStored('hakdaar.lang', code)
    if (!worker || worker.language === code) return
    setWorker((w) => ({ ...w, language: code }))
    try { await api.setLanguage(worker.id, code) } catch (e) { showToast(e.message, 'error') }
  }

  const openDrawer = (section) => setDrawer({ open: true, section })
  const totals = ledger?.totals || { amount_earned: 0, amount_paid: 0, amount_owed: 0 }
  const repAlerts = alerts.filter((a) => a.type === 'employer_reputation').length

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

  if (!booted) {
    return <div className="grid h-dvh place-items-center"><Loader2 className="size-8 animate-spin text-brand" /></div>
  }

  const degraded = health && (!health.hindsight.ok || !health.groq.ok) && (
    <div className="flex items-center gap-2 bg-warn-soft px-4 py-2 text-sm text-warn">
      <CircleAlert className="size-4 shrink-0" />
      <span className="flex-1">{!health.groq.ok ? s.aiOffline : s.memoryOffline}</span>
      <button onClick={boot} className="font-semibold underline">{s.retry}</button>
    </div>
  )

  if (!worker) {
    return (
      <div className="flex h-dvh flex-col">
        <Header s={s} health={health} />
        {degraded}
        <div className="flex-1 overflow-y-auto"><Login onLogin={login} onRegister={register} lang={uiLang} onLang={(c) => { setUiLang(c); writeStored('hakdaar.lang', c) }} /></div>
        <footer className="border-t border-black/5 px-4 py-2 text-center text-xs text-muted"><Info className="mr-1 inline size-3.5 align-[-2px]" />{s.footer}</footer>
      </div>
    )
  }

  const tabs = [
    { id: 'chat', label: s.chat, icon: MessagesSquare, onClick: () => setTab('chat') },
    { id: 'ledger', label: s.ledgerTab, icon: WalletIcon, onClick: () => setTab('ledger'), dot: totals.amount_owed > 0 },
    { id: 'account', label: s.account, icon: UserRound, onClick: () => openDrawer('memories'), dot: repAlerts > 0 },
  ]

  return (
    <div className="flex h-dvh flex-col">
      <Header s={s} health={health} language={language} onLanguage={changeLanguage}
        worker={worker} alertCount={repAlerts} onAccount={() => openDrawer(repAlerts ? 'alerts' : 'memories')} />
      {degraded}

      <main className="mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className={`${tab === 'chat' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col lg:flex`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-black/5 px-4 py-2.5">
            <Avatar name={worker.name} size="size-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold leading-tight">{worker.name}</p>
              <button onClick={() => openDrawer('memories')} className="truncate text-xs text-muted hover:text-brand">
                🧠 {s.allLearned}: {learned.total}
              </button>
            </div>
            <Wallet s={s} totals={totals} onClick={() => setTab('ledger')} />
          </div>
          <div className="min-h-0 flex-1">
            <ChatPanel
              s={s} worker={worker} language={language} messages={messages} sending={sending} loading={loadingWorker}
              onSend={send} onRetry={retry} onUndo={undo} banner={banner} onDismissBanner={() => setBanner(null)}
              learning={learning} onOpenMemory={() => openDrawer('memories')}
            />
          </div>
        </section>

        <aside className={`${tab === 'ledger' ? 'block' : 'hidden'} min-h-0 lg:block lg:border-l lg:border-black/5 lg:bg-sand/40`}>
          <LedgerPanel s={s} ledger={ledger} loading={loadingWorker} onUndo={undo} />
        </aside>
      </main>

      <footer className="hidden border-t border-black/5 px-4 py-1.5 text-center text-xs text-muted lg:block" lang={language}>
        <Info className="mr-1 inline size-3.5 align-[-2px]" />{s.footer}
      </footer>

      <nav className="grid grid-cols-3 border-t border-black/10 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {tabs.map(({ id, label, icon: Icon, dot, onClick }) => (
          <button key={id} onClick={onClick}
            className={`relative flex flex-col items-center gap-0.5 py-2 text-sm font-semibold ${tab === id ? 'text-brand' : 'text-muted'}`}>
            <Icon className="size-6" />
            {label}
            {dot && <span className="absolute right-[30%] top-1.5 size-2.5 rounded-full bg-danger ring-2 ring-white" />}
            {tab === id && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-brand" />}
          </button>
        ))}
      </nav>

      <AccountDrawer
        s={s} open={drawer.open} section={drawer.section} onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        worker={worker} alerts={alerts}
        memoryProps={{ recalled, learned, newIds, error: memoryError, loading: loadingWorker, learning, worker }}
        onLogout={logout} onDelete={deleteAccount} onResetAll={resetAll}
      />

      {toast && (
        <div role="status" className={`fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md rounded-xl px-4 py-3 text-sm shadow-soft animate-slide-down lg:bottom-6 ${toast.kind === 'error' ? 'bg-danger text-white' : 'bg-ink text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

/** Earned / Paid / Owed tiles. Each has a tooltip explaining the number. */
function Wallet({ s, totals, onClick }) {
  const earned = useCountUp(totals.amount_earned)
  const paid = useCountUp(totals.amount_paid)
  const owed = useCountUp(totals.amount_owed)
  const [eHelp, pHelp, oHelp] = s.howCalcLines.map(([, v]) => v)
  const tile = 'rounded-xl px-3 py-1.5 text-right leading-tight transition hover:-translate-y-0.5'
  return (
    <div className="flex w-full gap-1.5 sm:w-auto">
      <button onClick={onClick} title={eHelp} className={`${tile} flex-1 bg-sand`}>
        <span className="block text-[11px] font-semibold uppercase text-muted">{s.wallet.earned}</span>
        <span className="font-bold tabular-nums">{inr(earned)}</span>
      </button>
      <button onClick={onClick} title={pHelp} className={`${tile} flex-1 bg-sand`}>
        <span className="block text-[11px] font-semibold uppercase text-muted">{s.wallet.paid}</span>
        <span className="font-bold tabular-nums">{inr(paid)}</span>
      </button>
      <button onClick={onClick} title={oHelp}
        className={`${tile} flex-1 ${totals.amount_owed > 0 ? 'bg-danger text-white' : 'bg-brand-soft text-brand'}`}>
        <span className={`block text-[11px] font-semibold uppercase ${totals.amount_owed > 0 ? 'text-white/85' : ''}`}>{s.wallet.owed}</span>
        <span className="font-extrabold tabular-nums">{inr(owed)}</span>
      </button>
    </div>
  )
}
