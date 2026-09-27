import { useCallback, useEffect, useRef, useState } from 'react'
import { BellRing, CircleAlert, CircleHelp, Loader2, MessagesSquare, RefreshCw, UserRound, Wallet as WalletIcon, WifiOff } from 'lucide-react'
import { ApiError, api, inr } from './api'
import { t } from './i18n'
import { useCountUp } from './hooks'
import Header from './components/Header'
import ChatPanel from './components/ChatPanel'
import LedgerPanel from './components/LedgerPanel'
import Login from './components/Login'
import AccountDrawer from './components/AccountDrawer'
import HowItWorks from './components/HowItWorks'
import LegalModal from './components/LegalModal'

const LEDGER_TYPES = new Set(['promise', 'work_day', 'payment'])
// Hindsight extracts facts in the background after retain; re-check a few times to show learning live.
const LEARN_POLL_MS = [2500, 6000, 12000, 25000, 45000]
const EMPTY_LEARNED = { total: 0, items: [] }
const SESSION_KEY = 'hakdaar.session'
// Same background video as the landing page.
const BG_VIDEO = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4'

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
  const [welcome, setWelcome] = useState(null)
  const [welcomeLoading, setWelcomeLoading] = useState(false)
  const [welcomeAt, setWelcomeAt] = useState(0) // the welcome card sits after the history loaded at login
  const [welcomeOpen, setWelcomeOpen] = useState(true)
  const owedByEmployer = useRef(null)
  // Links from the landing page: /app?mode=register, /app?guide=1, /app?doc=terms|privacy
  const [entry] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    const doc = q.get('doc')
    return { mode: q.get('mode') === 'register' ? 'register' : 'login', guide: q.has('guide'),
      doc: doc === 'terms' || doc === 'privacy' ? doc : null }
  })
  const [storyOpen, setStoryOpen] = useState(entry.guide)
  const [legalDoc, setLegalDoc] = useState(entry.doc)
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname)
  }, [])

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
    setWelcome(null)
    setWelcomeOpen(true)
    owedByEmployer.current = null
    setWelcomeLoading(true)
    // HakDaar speaks first: greeting from memory + follow-up nudges (loads in parallel with the chat).
    api.welcome(id)
      .then(setWelcome)
      .catch(() => setWelcome({ greeting: null, nudges: [], has_history: false }))
      .finally(() => setWelcomeLoading(false))
    try {
      const [msgs, led, al] = await Promise.all([api.messages(id), api.ledger(id), api.alerts(id)])
      setMessages(msgs)
      setWelcomeAt(msgs.length)
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
      // The wallet, ledger and "Noted" chips update the moment the facts are saved;
      // the written reply follows a few seconds later.
      const markNoted = (evs) => setMessages((m) => {
        const copy = [...m]
        const i = copy.findLastIndex((x) => x.pending)
        if (i >= 0) copy[i] = { ...copy[i], pending: false, events: evs.filter((e) => LEDGER_TYPES.has(e.type) && e.id) }
        return copy
      })
      const r = await api.chat(id, text, (p) => {
        setLedger(p.ledger)
        setAlerts(p.alerts)
        markNoted(p.extracted_events)
      })
      markNoted(r.extracted_events)
      setMessages((m) => [...m, { role: 'assistant', content: r.reply, warnings: r.warnings, created_at: new Date().toISOString(), fresh: true }])
      setAlerts(r.alerts)
      setRecalled(r.recalled_memories)
      const memWarn = r.warnings?.find((w) => w.startsWith('Memory'))
      setMemoryError(memWarn || null)
      setBanner(r.alerts.find((a) => a.type === 'underpayment') || null)
      api.ledger(id).then(setLedger).catch(() => {})
      refreshNudges(id)
      if (!memWarn) watchLearning(id)
    } catch (e) {
      setMessages((m) => [...m.filter((x) => !x.pending), { role: 'error', content: e.message, retry: text }])
    } finally {
      setSending(false)
    }
  }

  const refreshNudges = (id) =>
    api.nudges(id).then((n) => setWelcome((w) => (w ? { ...w, nudges: n } : w))).catch(() => {})

  const closeStory = () => setStoryOpen(false)

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
      refreshNudges(worker.id)
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

  // A quiet confirmation when an employer that owed money has now paid everything.
  useEffect(() => {
    if (!ledger?.employers) return
    const now = Object.fromEntries(ledger.employers.map((r) => [r.employer_name, r.amount_owed ?? 0]))
    const before = owedByEmployer.current
    owedByEmployer.current = now
    if (before && Object.entries(now).some(([e, owed]) => owed === 0 && (before[e] ?? 0) > 0)) showToast(s.celebrate)
  }, [ledger]) // eslint-disable-line react-hooks/exhaustive-deps
  const totals = ledger?.totals || { amount_earned: 0, amount_paid: 0, amount_owed: 0 }
  const repAlerts = alerts.filter((a) => a.type === 'employer_reputation').length

  // ---------- screens ----------
  if (backendError) {
    return (
      <div className="grid h-dvh place-items-center bg-bg p-6">
        <div className="panel max-w-md p-8 text-center animate-rise">
          <WifiOff className="mx-auto mb-4 size-8 text-owed" />
          <p className="font-display text-2xl text-white">{s.backendDown}</p>
          <p className="mt-2 text-fg2/80">{backendError}</p>
          <code className="mt-4 block rounded-xl border border-line bg-card p-3 text-left text-sm text-fg2">./scripts/start-backend.sh</code>
          <button onClick={boot} className="btn-white mt-5"><RefreshCw className="size-4" /> {s.retry}</button>
        </div>
      </div>
    )
  }

  if (!booted) {
    return <div className="grid h-dvh place-items-center bg-bg"><Loader2 className="size-7 animate-spin text-white/60" /></div>
  }

  const degraded = health && (!health.hindsight.ok || !health.groq.ok) && (
    <div className="mx-auto mt-3 flex w-[calc(100%-1.5rem)] max-w-[1400px] items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn sm:w-[calc(100%-3rem)]">
      <CircleAlert className="size-4 shrink-0" />
      <span className="flex-1">{!health.groq.ok ? s.aiOffline : s.memoryOffline}</span>
      <button onClick={boot} className="font-semibold underline underline-offset-2">{s.retry}</button>
    </div>
  )

  const toastEl = toast && (
    <div role="status" className={`fixed inset-x-4 bottom-24 z-50 mx-auto w-fit max-w-md rounded-full px-5 py-2.5 text-sm font-medium shadow-[0_20px_60px_rgba(0,0,0,0.45)] animate-rise lg:bottom-8 ${toast.kind === 'error' ? 'bg-owed text-white' : 'bg-white text-black'}`}>
      {toast.msg}
    </div>
  )

  if (!worker) {
    const setLang = (c) => { setUiLang(c); writeStored('hakdaar.lang', c) }
    return (
      <div className="relative h-dvh overflow-hidden bg-black">
        {/* Same looping video as the landing page, dimmed so the form stays readable */}
        <video className="pointer-events-none absolute inset-0 size-full object-cover opacity-70" autoPlay muted loop playsInline aria-hidden="true">
          <source src={BG_VIDEO} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/45" aria-hidden="true" />
        <div className="relative z-10 flex h-full flex-col">
          <Header s={s} language={uiLang} onLanguage={setLang} showHome />
          {degraded}
          <div className="flex-1 overflow-y-auto scroll-thin">
            <Login onLogin={login} lang={uiLang} initialMode={entry.mode} onOpenLegal={setLegalDoc} onHowItWorks={() => setStoryOpen(true)} />
            <footer className="mx-auto flex max-w-[920px] flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 pb-6 text-[12.5px] text-muted">
              <span>© 2026 HakDaar</span>
              <button onClick={() => setLegalDoc('terms')} className="hover:text-white">{s.terms}</button>
              <button onClick={() => setLegalDoc('privacy')} className="hover:text-white">{s.privacy}</button>
              <span className="basis-full text-center sm:basis-auto">{s.footer}</span>
            </footer>
          </div>
        </div>
        <HowItWorks s={s} language={uiLang} open={storyOpen} onClose={closeStory} />
        <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} note={s.legalNote} />
        {toastEl}
      </div>
    )
  }

  const tabs = [
    { id: 'chat', label: s.chat, icon: MessagesSquare, onClick: () => setTab('chat') },
    { id: 'ledger', label: s.ledgerTab, icon: WalletIcon, onClick: () => setTab('ledger'), dot: totals.amount_owed > 0 },
    { id: 'account', label: s.account, icon: UserRound, onClick: () => openDrawer('memories'), dot: repAlerts > 0 },
  ]

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg">
      {/* The landing page's video, kept very dim so it only adds depth behind the glass panels */}
      <video className="pointer-events-none absolute inset-0 size-full object-cover opacity-35" autoPlay muted loop playsInline aria-hidden="true">
        <source src={BG_VIDEO} type="video/mp4" />
      </video>
      <div className="pointer-events-none absolute inset-0 bg-black/60" aria-hidden="true" />

      <Header s={s} language={language} onLanguage={changeLanguage}
        worker={worker} alertCount={repAlerts} onAccount={() => openDrawer(repAlerts ? 'alerts' : 'memories')} />
      {degraded}

      <main className="relative z-10 mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 grid-cols-[minmax(0,1fr)] gap-4 p-3 sm:p-6 sm:pt-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className={`${tab === 'chat' ? 'flex' : 'hidden'} glass min-h-0 min-w-0 flex-col overflow-hidden lg:flex`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-4 py-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold leading-tight text-white">{worker.name}</p>
              <button onClick={() => openDrawer('memories')} className="text-[13px] text-muted transition hover:text-white">
                {s.allLearned}: <span className="tabular-nums text-fg2">{learned.total}</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              {!welcomeOpen && welcome?.nudges?.length > 0 && (
                <button onClick={() => setWelcomeOpen(true)} title={s.reminders}
                  className="relative grid size-10 place-items-center rounded-full border border-line-strong bg-pill text-fg2 transition hover:bg-pill-hover hover:text-white">
                  <BellRing className="size-[18px]" />
                  <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-owed text-[11px] font-bold text-white">{welcome.nudges.length}</span>
                </button>
              )}
              <button onClick={() => setStoryOpen(true)} title={s.howItWorks}
                className="grid size-10 place-items-center rounded-full border border-line-strong bg-pill text-fg2 transition hover:bg-pill-hover hover:text-white">
                <CircleHelp className="size-[18px]" />
              </button>
            </div>
            <Wallet s={s} totals={totals} onClick={() => setTab('ledger')} />
          </div>
          <div className="min-h-0 flex-1">
            <ChatPanel
              s={s} worker={worker} language={language} messages={messages} sending={sending} loading={loadingWorker}
              onSend={send} onRetry={retry} onUndo={undo} banner={banner} onDismissBanner={() => setBanner(null)}
              learning={learning} onOpenMemory={() => openDrawer('memories')}
              welcome={welcome} welcomeLoading={welcomeLoading} welcomeAt={welcomeAt}
              welcomeOpen={welcomeOpen} onCloseWelcome={() => setWelcomeOpen(false)}
              employers={(ledger?.employers || []).map((r) => r.employer_name)}
            />
          </div>
        </section>

        <aside className={`${tab === 'ledger' ? 'block' : 'hidden'} glass min-h-0 overflow-hidden lg:block`}>
          <LedgerPanel s={s} ledger={ledger} loading={loadingWorker} onUndo={undo} />
        </aside>
      </main>

      <footer className="relative z-10 hidden pb-3 text-center text-[12px] text-muted lg:block" lang={language}>{s.footer}</footer>

      <nav className="relative z-10 grid grid-cols-3 border-t border-line bg-black/70 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {tabs.map(({ id, label, icon: Icon, dot, onClick }) => {
          const active = id === 'account' ? drawer.open : tab === id && !drawer.open
          return (
            <button key={id} onClick={onClick}
              className={`relative flex flex-col items-center gap-0.5 pb-3.5 pt-2.5 text-[13px] font-medium transition ${active ? 'dot-active text-white' : 'text-muted'}`}>
              <Icon className="size-[22px]" />
              {label}
              {dot && <span className="absolute right-[32%] top-2 size-2 rounded-full bg-owed" />}
            </button>
          )
        })}
      </nav>

      <HowItWorks s={s} language={language} open={storyOpen} onClose={closeStory} />
      <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} note={s.legalNote} />

      <AccountDrawer
        s={s} open={drawer.open} section={drawer.section} onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        worker={worker} alerts={alerts}
        memoryProps={{ recalled, learned, newIds, error: memoryError, loading: loadingWorker, learning, worker }}
        onLogout={logout} onDelete={deleteAccount} onResetAll={resetAll}
        onOpenLegal={setLegalDoc}
        health={health} onRecheck={async () => { try { setHealth(await api.health()) } catch (e) { showToast(e.message, 'error') } }}
      />
      {toastEl}
    </div>
  )
}

/** Earned / Paid / Owed, styled like the landing page stats. Each explains itself on hover. */
function Wallet({ s, totals, onClick }) {
  const earned = useCountUp(totals.amount_earned)
  const paid = useCountUp(totals.amount_paid)
  const owed = useCountUp(totals.amount_owed)
  const [eHelp, pHelp, oHelp] = s.howCalcLines.map(([, v]) => v)
  const items = [
    [s.wallet.earned, earned, eHelp, 'text-white'],
    [s.wallet.paid, paid, pHelp, 'text-white'],
    [s.wallet.owed, owed, oHelp, totals.amount_owed > 0 ? 'text-owed' : 'text-ok'],
  ]
  return (
    <div className="grid w-full grid-cols-3 divide-x divide-line rounded-2xl border border-line bg-card sm:w-auto">
      {items.map(([label, value, help, tone]) => (
        <button key={label} onClick={onClick} title={help} className="px-3 py-2 text-left transition hover:bg-white/[0.03] sm:px-4">
          <span className="eyebrow block">{label}</span>
          <span className={`font-display text-[22px] leading-tight tabular-nums ${tone}`}>{inr(value)}</span>
        </button>
      ))}
    </div>
  )
}
