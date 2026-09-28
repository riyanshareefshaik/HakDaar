// All calls go through Vite's /api proxy to the FastAPI backend (see vite.config.js).
// A static host like Vercel sets VITE_API_URL to wherever the backend runs, e.g. https://…/api
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')

export class ApiError extends Error {
  constructor(message, status, service) {
    super(message)
    this.status = status
    this.service = service
  }
}

// Session token from /auth/login ('worker_id.signature'); sent with every request.
let token = null
export const setToken = (t) => { token = t || null }
const authHeader = () => (token ? { Authorization: `Bearer ${token}` } : {})

const OFFLINE = import.meta.env.DEV
  ? 'Cannot reach the HakDaar server. Is the backend running on port 8000?'
  : 'HakDaar is offline right now. Your records are safe. Please try again in a few minutes.'

// Organization logins (employers, support groups) have their own token, kept apart from a worker's.
let orgToken = null
export const setOrgToken = (t) => { orgToken = t || null }
const orgHeader = () => (orgToken ? { Authorization: `Bearer ${orgToken}` } : {})

async function send(path, method, body, headers = authHeader()) {
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(OFFLINE, 0, 'backend')
  }
}

async function req(path, { method = 'GET', body, org = false } = {}) {
  const res = await send(path, method, body, org ? orgHeader() : authHeader())
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // Vite's proxy answers 5xx with an empty body when the backend is down.
    const detail = data?.detail
    const msg = typeof detail === 'string' ? detail
      : res.status >= 500 && !data ? OFFLINE
      : `Request failed (${res.status})`
    throw new ApiError(msg, res.status, data?.service)
  }
  return data
}

const enc = encodeURIComponent

/** Chat, streamed: onRecorded({ledger, extracted_events, alerts}) fires as soon as the facts are saved,
 *  so Earned / Paid / Owed update instantly; the promise resolves with the full reply afterwards. */
async function chat(worker_id, message, onRecorded) {
  const res = await send('/chat?stream=true', 'POST', { worker_id, message })
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null)
    const detail = data?.detail
    throw new ApiError(typeof detail === 'string' ? detail : res.status >= 500 && !data ? OFFLINE : `Request failed (${res.status})`,
      res.status, data?.service)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    buf += decoder.decode(value || new Uint8Array(), { stream: !done })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const part = JSON.parse(line)
      if (part.stage === 'recorded') onRecorded?.(part)
      else if (part.stage === 'done') return part
      else if (part.stage === 'error') throw new ApiError(part.detail, 500)
    }
    if (done) throw new ApiError('The reply was cut off. Your entries were saved; please check the ledger.', 0)
  }
}

/** Voice input: upload a recording, get text back (Groq Whisper on the backend). */
async function transcribe(blob, language) {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  form.append('audio', blob, `speech.${ext}`)
  if (language) form.append('language', language)
  let res
  try {
    res = await fetch(`${BASE}/transcribe`, { method: 'POST', body: form, headers: authHeader() })
  } catch {
    throw new ApiError(OFFLINE, 0, 'backend')
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
  recoveryQuestion: (phone) => req('/auth/recovery-question', { method: 'POST', body: { phone } }),
  resetPin: (body) => req('/auth/reset-pin', { method: 'POST', body }),
  worker: (id) => req(`/workers/${enc(id)}`),
  createWorker: (w) => req('/workers', { method: 'POST', body: w }),
  setLanguage: (id, language) => req(`/workers/${enc(id)}`, { method: 'PATCH', body: { language } }),
  messages: (id) => req(`/workers/${enc(id)}/messages`),
  ledger: (id) => req(`/workers/${enc(id)}/ledger`),
  welcome: (id) => req(`/workers/${enc(id)}/welcome`),
  nudges: (id) => req(`/workers/${enc(id)}/nudges`),
  memories: (id) => req(`/workers/${enc(id)}/memories`),
  alerts: (id) => req(`/workers/${enc(id)}/alerts`),
  chat,
  reputation: (name) => req(`/employers/${enc(name)}/reputation`),
  deleteWorker: (id) => req(`/workers/${enc(id)}`, { method: 'DELETE' }),
  deleteEvent: (id, eventId) => req(`/workers/${enc(id)}/events/${eventId}`, { method: 'DELETE' }),
  // Admin dashboard (the server only answers for the admin account)
  adminOverview: () => req('/admin/overview'),
  adminWorkers: () => req('/admin/workers'),
  adminDeleteWorker: (id) => req(`/admin/workers/${enc(id)}`, { method: 'DELETE' }),
  adminReports: () => req('/admin/reports'),
  adminDeleteReport: (id) => req(`/admin/reports/${id}`, { method: 'DELETE' }),
  adminReset: () => req('/admin/reset', { method: 'POST' }),
  adminOrgs: () => req('/admin/orgs'),
  adminVerifyOrg: (id, verified) => req(`/admin/orgs/${enc(id)}/verify`, { method: 'POST', body: { verified } }),
  adminDeleteOrg: (id) => req(`/admin/orgs/${enc(id)}`, { method: 'DELETE' }),

  // Worker side of organizations
  myOrgs: (id) => req(`/workers/${enc(id)}/organizations`),
  answerInvite: (id, linkId, accept, employer_alias) =>
    req(`/workers/${enc(id)}/invites/${linkId}`, { method: 'POST', body: { accept, employer_alias } }),
  leaveOrg: (id, linkId) => req(`/workers/${enc(id)}/organizations/${linkId}`, { method: 'DELETE' }),
  confirmEntry: (id, eventId) => req(`/workers/${enc(id)}/entries/${eventId}/confirm`, { method: 'POST' }),
  disputeEntry: (id, eventId, reason) => req(`/workers/${enc(id)}/entries/${eventId}/dispute`, { method: 'POST', body: { reason } }),

  // Organization portal (uses the organization login)
  orgRegister: (b) => req('/org/register', { method: 'POST', body: b }),
  orgLogin: (b) => req('/org/login', { method: 'POST', body: b }),
  orgMe: () => req('/org/me', { org: true }),
  orgMembers: () => req('/org/members', { org: true }),
  orgAddMember: (b) => req('/org/members', { method: 'POST', body: b, org: true }),
  orgRemoveMember: (id) => req(`/org/members/${enc(id)}`, { method: 'DELETE', org: true }),
  orgInvite: (phone) => req('/org/invites', { method: 'POST', body: { phone }, org: true }),
  orgWorkers: () => req('/org/workers', { org: true }),
  orgRemoveWorker: (id) => req(`/org/workers/${enc(id)}`, { method: 'DELETE', org: true }),
  orgRecord: (workerId, entry) => req(`/org/workers/${enc(workerId)}/entries`, { method: 'POST', body: entry, org: true }),
  orgWorkerEntries: (workerId) => req(`/org/workers/${enc(workerId)}/entries`, { org: true }),
  orgDues: () => req('/org/dues', { org: true }),
  orgReputation: () => req('/org/reputation', { org: true }),
  orgReply: (text) => req('/org/reputation/reply', { method: 'POST', body: { text }, org: true }),
  orgCases: () => req('/org/cases', { org: true }),
  orgCase: (id) => req(`/org/cases/${enc(id)}`, { org: true }),
  orgAddNote: (id, text) => req(`/org/cases/${enc(id)}/notes`, { method: 'POST', body: { text }, org: true }),
  orgCaseStatus: (id, status) => req(`/org/cases/${enc(id)}`, { method: 'PATCH', body: { status }, org: true }),
}

export function inr(n) {
  if (n === null || n === undefined) return '—'
  return '₹' + Number(n).toLocaleString('en-IN')
}
