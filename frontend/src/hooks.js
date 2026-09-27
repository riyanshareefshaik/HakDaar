import { useEffect, useRef, useState } from 'react'

/** Animates a number from its previous value to the new one (ease-out). */
export function useCountUp(value, ms = 700) {
  const [shown, setShown] = useState(value ?? 0)
  const prev = useRef(value ?? 0)
  useEffect(() => {
    const from = prev.current
    const to = value ?? 0
    prev.current = to
    if (from === to) { setShown(to); return }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setShown(to); return }
    const t0 = performance.now()
    let raf
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms)
      setShown(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

// ---------------------------------------------------------------- read aloud

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function below100(n) {
  return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
}
function below1000(n) {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h ? ONES[h] + ' hundred' : '', r ? below100(r) : ''].filter(Boolean).join(' ')
}

/** 125000 -> "one lakh twenty five thousand" (Indian numbering, how workers say amounts). */
export function numberToWordsEn(n) {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'zero'
  const parts = []
  const crore = Math.floor(n / 1e7); n %= 1e7
  const lakh = Math.floor(n / 1e5); n %= 1e5
  const thousand = Math.floor(n / 1e3); n %= 1e3
  if (crore) parts.push(numberToWordsEn(crore) + ' crore')
  if (lakh) parts.push(below100(lakh) + ' lakh')
  if (thousand) parts.push(below100(thousand) + ' thousand')
  if (n) parts.push(below1000(n))
  return parts.join(' ')
}

const RUPEES = { en: 'rupees', hi: 'रुपये', te: 'రూపాయలు' }
const PER_DAY = { en: ' per day', hi: ' प्रति दिन', te: ' రోజుకు' }

/**
 * Make text sound right when spoken:
 *  "₹50,000" -> "fifty thousand rupees" (English) / "50000 रुपये" (Hindi) / "50000 రూపాయలు" (Telugu).
 * Indian digit grouping ("1,25,000") confuses speech engines, which is why amounts sounded like "5 00, 00".
 */
export function speakableText(text, lang) {
  const word = RUPEES[lang] || RUPEES.en
  const toSpoken = (digits) => {
    const n = Number(digits.replace(/,/g, ''))
    if (!Number.isFinite(n)) return digits
    return lang === 'en' ? numberToWordsEn(n) : String(n)
  }
  return text
    // ₹50,000 / ₹ 50,000 / Rs. 50,000 / 50,000 ₹ / 50000 INR
    .replace(/(?:₹|\bRs\.?|\bINR)\s*([\d,]+(?:\.\d+)?)/gi, (_, d) => `${toSpoken(d)} ${word}`)
    .replace(/([\d,]+(?:\.\d+)?)\s*(?:₹|INR\b|rs\b\.?|rupees?|रुपये|रुपए|రూపాయలు)/gi, (_, d) => `${toSpoken(d)} ${word}`)
    .replace(/\s*×\s*/g, lang === 'en' ? ' times ' : ' x ')
    // any remaining grouped number: 1,25,000 -> 125000
    .replace(/\d{1,3}(?:,\d{2,3})+/g, (d) => (lang === 'en' ? numberToWordsEn(Number(d.replace(/,/g, ''))) : d.replace(/,/g, '')))
    .replace(/\s*\/\s*(day|दिन|రోజు)/gi, PER_DAY[lang] || PER_DAY.en)
    .replace(/[*_#`>|~]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

let voicesReady = null
function loadVoices() {
  if (!canSpeak) return Promise.resolve([])
  const now = window.speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  voicesReady ??= new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices())
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 1500) // some browsers never fire the event
  })
  return voicesReady
}

/** Best installed voice for a language: exact match, then higher-quality engines first. */
async function pickVoice(langTag) {
  const voices = await loadVoices()
  const base = langTag.slice(0, 2).toLowerCase()
  const matches = voices.filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith(base))
  const score = (v) =>
    (v.lang?.toLowerCase().replace('_', '-') === langTag.toLowerCase() ? 4 : 0) +
    (/google|natural|neural|premium|enhanced|siri/i.test(v.name) ? 3 : 0) +
    (v.localService ? 0 : 1)
  return matches.sort((a, b) => score(b) - score(a))[0] || null
}

/**
 * Read text aloud. Returns 'ok', 'no-voice' (this device has no voice for the language, so we don't
 * butcher it with a wrong-language voice) or 'unsupported'. Long text is split into sentences
 * because Chrome silently stops very long utterances.
 */
export async function speak(text, langTag, lang, { onEnd } = {}) {
  if (!canSpeak) return 'unsupported'
  const voice = await pickVoice(langTag)
  if (!voice && lang !== 'en') return 'no-voice'
  const synth = window.speechSynthesis
  synth.cancel()
  const chunks = speakableText(text, lang).match(/[^.!?।\n]+[.!?।]?/g)?.map((c) => c.trim()).filter(Boolean) || []
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk)
    u.lang = voice?.lang || langTag
    if (voice) u.voice = voice
    u.rate = lang === 'en' ? 0.95 : 0.9
    if (i === chunks.length - 1) { u.onend = onEnd; u.onerror = onEnd }
    synth.speak(u)
  })
  if (!chunks.length) onEnd?.()
  return 'ok'
}

export function stopSpeaking() {
  if (canSpeak) window.speechSynthesis.cancel()
}

// ---------------------------------------------------------------- voice input

export const canRecord = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && 'MediaRecorder' in window

function pickMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t
  }
  return ''
}

/**
 * Records from the microphone with MediaRecorder (works in Chrome, Safari, Edge, Firefox).
 * The audio is sent to the backend and transcribed by Groq Whisper.
 */
export function useRecorder({ maxSeconds = 60 } = {}) {
  const [state, setState] = useState('idle') // idle | recording
  const [seconds, setSeconds] = useState(0)
  const rec = useRef(null)
  const streamRef = useRef(null)
  const timer = useRef(null)
  const resolver = useRef(null)

  const cleanup = () => {
    clearInterval(timer.current)
    streamRef.current?.getTracks().forEach((t) => t.stop()) // release the mic (turns off the browser's red dot)
    streamRef.current = null
    rec.current = null
    setState('idle')
  }

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    streamRef.current = stream
    const mimeType = pickMime()
    const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks = []
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    r.onstop = () => {
      const type = r.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunks, { type })
      cleanup()
      resolver.current?.(blob)
    }
    rec.current = r
    r.start()
    setSeconds(0)
    setState('recording')
    const t0 = Date.now()
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000)
      setSeconds(s)
      if (s >= maxSeconds) r.state === 'recording' && r.stop()
    }, 250)
  }

  /** Stop and get the recording as a Blob. */
  const stop = () => new Promise((resolve) => {
    resolver.current = resolve
    if (rec.current?.state === 'recording') rec.current.stop()
    else resolve(null)
  })

  const cancel = () => {
    resolver.current = null
    if (rec.current?.state === 'recording') rec.current.stop()
    else cleanup()
  }

  useEffect(() => () => { clearInterval(timer.current); streamRef.current?.getTracks().forEach((t) => t.stop()) }, [])

  return { state, seconds, start, stop, cancel }
}
