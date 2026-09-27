// All calls go through Vite's /api proxy to the FastAPI backend (see vite.config.js).
const BASE = import.meta.env.VITE_API_URL || '/api'

export class ApiError extends Error {
  constructor(message, status, service) {
    super(message)
    this.status = status
    this.service = service
  }
}

async function req(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Cannot reach the HakDaar server. Is the backend running on port 8000?', 0, 'backend')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // Vite's proxy answers 5xx with an empty body when the backend is down.
    const detail = data?.detail
    const msg = typeof detail === 'string' ? detail
      : res.status >= 500 && !data ? 'Cannot reach the HakDaar server. Is the backend running on port 8000?'
      : `Request failed (${res.status})`
    throw new ApiError(msg, res.status, data?.service)
  }
  return data
}

const enc = encodeURIComponent

/** Voice input: upload a recording, get text back (Groq Whisper on the backend). */
async function transcribe(blob, language) {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  form.append('audio', blob, `speech.${ext}`)
  if (language) form.append('language', language)
  let res
  try {
    res = await fetch(`${BASE}/transcribe`, { method: 'POST', body: form })
  } catch {
    throw new ApiError('Cannot reach the HakDaar server. Is the backend running on port 8000?', 0, 'backend')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.detail || `Voice input failed (${res.status})`, res.status, data?.service)
  return data.text
}

export const api = {
  transcribe,
  health: () => req('/health'),
  workers: () => req('/workers'),
  register: (body) => req('/auth/register', { method: 'POST', body }),
  login: (body) => req('/auth/login', { method: 'POST', body }),
  worker: (id) => req(`/workers/${enc(id)}`),
  createWorker: (w) => req('/workers', { method: 'POST', body: w }),
  setLanguage: (id, language) => req(`/workers/${enc(id)}`, { method: 'PATCH', body: { language } }),
  messages: (id) => req(`/workers/${enc(id)}/messages`),
  ledger: (id) => req(`/workers/${enc(id)}/ledger`),
  memories: (id) => req(`/workers/${enc(id)}/memories`),
  alerts: (id) => req(`/workers/${enc(id)}/alerts`),
  chat: (worker_id, message) => req('/chat', { method: 'POST', body: { worker_id, message } }),
  reputation: (name) => req(`/employers/${enc(name)}/reputation`),
  deleteWorker: (id) => req(`/workers/${enc(id)}`, { method: 'DELETE' }),
  deleteEvent: (id, eventId) => req(`/workers/${enc(id)}/events/${eventId}`, { method: 'DELETE' }),
  reset: () => req('/reset', { method: 'POST' }),
}

export function inr(n) {
  if (n === null || n === undefined) return '—'
  return '₹' + Number(n).toLocaleString('en-IN')
}
