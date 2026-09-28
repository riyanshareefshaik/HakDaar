import { useEffect } from 'react'
import { X } from 'lucide-react'

const UPDATED = '27 September 2026'

// Plain-language documents. They describe what this app actually does with data.
const DOCS = {
  terms: {
    title: 'Terms of Use',
    sections: [
      ['What HakDaar is', [
        'HakDaar is a free tool that helps daily-wage and migrant workers keep a record of work, wages promised and payments received. It was built for HackwithHyderabad 3.0 and is offered as a prototype.',
      ]],
      ['Not legal advice', [
        'HakDaar is not a lawyer, a government service or a labour authority. Amounts shown are calculated from what you tell the app. They are a record to help you, not a legal judgement.',
        'For disputes about wages, contact your local labour office or a legal aid service.',
      ]],
      ['Your account', [
        'You sign in with your mobile number and a 4-digit PIN. Keep your PIN private. Anyone who has your number and PIN can see your records.',
        'If you forget your PIN, you can reset it by answering the security question you chose when signing up. Choose an answer other people will not easily guess.',
      ]],
      ['What you agree to', [
        'Enter information that is true to the best of your knowledge.',
        'Do not use HakDaar to harass, threaten or defame anyone. Warnings about employers are shown only as anonymous counts from other workers.',
        'Do not create extra or fake accounts, or report payments that did not happen. A single report is always shown as unverified, and a warning appears only when several different workers report the same employer.',
        'Do not try to access other people\'s accounts or disrupt the service.',
      ]],
      ['Accuracy and availability', [
        'HakDaar uses AI to understand messages and voice. It can misunderstand. Check every entry marked "Noted" and use Undo if something is wrong.',
        'The service may be unavailable at times, and features may change. We do not guarantee that records will never be lost, so keep your own notes for important payments.',
      ]],
      ['Closing your account', [
        'You can delete your account at any time from My account → Delete my account. This removes your records and personal memory.',
      ]],
      ['Changes', [
        'If these terms change, the new version will be shown in the app with a new date.',
      ]],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      ['What we collect', [
        'Your name, mobile number and preferred language.',
        'Your PIN and security answer, stored only in scrambled (hashed) form so they cannot be read back.',
        'The messages you type or speak, and the work, wage and payment entries recorded from them.',
        'Voice recordings are used only to turn speech into text and are not stored by HakDaar.',
      ]],
      ['How it is used', [
        'To keep your wage record, calculate what is owed, remind you about pending payments and reply to you.',
        'Messages are processed by an AI service (Groq) to understand them and write replies, and by a memory service (Hindsight) so HakDaar can remember past conversations.',
      ]],
      ['Warnings shared with other workers', [
        'When a payment is short or late, HakDaar stores an anonymous report about the employer, for example "a worker reported a short payment from this employer". Your name and number are never included, and other workers only see counts and summaries.',
      ]],
      ['What we do not do', [
        'We do not sell your data or show you advertisements.',
        'We do not send SMS messages or charge for OTPs.',
      ]],
      ['Your choices', [
        'You can see your records and what HakDaar has learned in the app at any time.',
        'You can remove any wrong entry with Undo, and delete your whole account from My account.',
        'This policy is written with India\'s Digital Personal Data Protection Act, 2023 in mind. Contact the team that runs your HakDaar installation for any privacy request.',
      ]],
    ],
  },
}

export default function LegalModal({ doc, onClose, note }) {
  useEffect(() => {
    if (!doc) return
    const esc = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [doc, onClose])
  if (!doc) return null
  const d = DOCS[doc]
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-md animate-fade sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={d.title}>
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-t-[28px] border border-line bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.45)] animate-sheet sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-line px-6 py-5">
          <div>
            <h2 className="font-display text-3xl leading-none text-white">{d.title}</h2>
            <p className="mt-2 text-sm text-muted">Last updated {UPDATED}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-white"><X className="size-5" /></button>
        </div>
        <div className="scroll-thin overflow-y-auto px-6 py-5 text-[15px] leading-relaxed text-fg2/90">
          {note && (
            <div className="mb-5 rounded-2xl border border-line-strong/50 bg-card p-4 text-sm">
              <p className="mb-1 font-semibold text-white">{note[0]}</p>
              <ul className="list-disc space-y-0.5 pl-5">{note.slice(1).map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
          {d.sections.map(([h, paras], i) => (
            <section key={h} className="mb-5">
              <h3 className="mb-1.5 font-semibold text-white">{i + 1}. {h}</h3>
              {paras.length > 1
                ? <ul className="list-disc space-y-1 pl-5">{paras.map((p) => <li key={p}>{p}</li>)}</ul>
                : <p>{paras[0]}</p>}
            </section>
          ))}
        </div>
        <div className="border-t border-line px-6 py-4 text-right">
          <button onClick={onClose} className="btn-white px-6">OK</button>
        </div>
      </div>
    </div>
  )
}
