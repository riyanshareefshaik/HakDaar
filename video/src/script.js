// What the video says over each part of the recording (ids match record.mjs).
// speed > 1 plays that part faster (typing and waiting), so the video stays short.
export const STEPS = {
  landing: { title: 'Meet HakDaar', body: 'A wage companion for daily-wage and migrant workers in Hyderabad.', speed: 1 },
  signup: { title: 'Sign up with a phone number and a 4-digit PIN', body: 'No SMS or OTP costs. A forgotten PIN is reset with a security question.', speed: 2 },
  login: { title: 'Log in', body: 'Simple enough for any phone user.', speed: 1.5 },
  promise: { title: 'Just say it, like talking to a friend', body: 'Type or speak in English, Telugu or Hindi. HakDaar notes the promised daily wage.', speed: 1.4 },
  work: { title: 'Days worked are counted', body: 'Earned, Paid and Owed update the moment the facts are saved.', speed: 1.4 },
  payment: { title: 'Short payments are caught', body: 'The AI only reads the facts. Python does every rupee of the maths, exactly.', speed: 1.4 },
  owed: { title: 'Ask any time: how much am I owed?', body: 'The answer comes from the exact ledger, never guessed by the AI.', speed: 1.4 },
  ledger: { title: 'Every entry is visible, and can be undone', body: 'Workers can check each rupee: promised rate, days, payments.', speed: 1 },
  memory: { title: 'Hindsight memory learns from every chat', body: 'retain and recall: HakDaar remembers promises, dates and problems across conversations.', speed: 1 },
  light: { title: 'Light or dark, in My account', body: 'Big buttons, read-aloud and voice input for workers who find reading hard.', speed: 1 },
  community: { title: 'Workers protect each other, anonymously', body: 'A second worker mentions the same employer. HakDaar warns her from what it learned in the first worker’s chats, summarised by Hindsight reflect. No names are shared.', speed: 1.6 },
}

export const INTRO = { title: 'HakDaar', tagline: 'Your work. Your wages. Remembered.' }

export const PROBLEM = [
  'A daily-wage worker is promised ₹800 a day.',
  'After a week, they get ₹3,000 and "the rest later".',
  'There is no record. Nobody remembers. The money is lost.',
]

export const TECH = [
  ['Hindsight memory', 'retain · recall · reflect, self-hosted in Docker'],
  ['Groq', 'understands messages and voice, writes replies'],
  ['Python', 'does all the maths, so numbers are always exact'],
]

export const LINKS = ['hakdaar.vercel.app', 'github.com/riyanshareefshaik/HakDaar']
