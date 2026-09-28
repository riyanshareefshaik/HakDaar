// Records a real walkthrough of HakDaar in a browser, for the demo video.
//
//   npm run record                                  # records https://hakdaar.vercel.app
//   HAKDAAR_URL=http://localhost:5173 npm run record  # or any other copy
//
// Output: public/recording.webm and src/segments.json (when each part of the demo starts and ends).
// Then run `npm run render` to turn it into out/HakDaar-demo.mp4.
// The backend must be running and reachable from the site you record.
import { chromium } from 'playwright'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'

const URL = (process.env.HAKDAAR_URL || 'https://hakdaar.vercel.app').replace(/\/+$/, '')
const W = 1600, H = 900
const executablePath = process.env.CHROMIUM_PATH || undefined

const phone = () => '9' + String(Math.floor(100000000 + Math.random() * 899999999))
const WORKERS = [
  { name: 'Ravi Kumar', phone: phone(), pin: '2580' },
  { name: 'Lakshmi', phone: phone(), pin: '1470' },
]

mkdirSync('public', { recursive: true })
mkdirSync('out/raw', { recursive: true })

const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: 'out/raw', size: { width: W, height: H } },
  locale: 'en-IN',
})
// Record in English (the language menu is one tap away in the app).
await context.addInitScript(() => { try { localStorage.setItem('hakdaar.lang', 'en') } catch {} })
const page = await context.newPage()
const t0 = Date.now()
const segments = []
let current = null
const mark = (id) => {
  const now = (Date.now() - t0) / 1000
  if (current) current.end = now
  current = id ? { id, start: now } : null
  if (current) segments.push(current)
  console.log(`${now.toFixed(1)}s  ${id ?? 'end'}`)
}
const pause = (s) => page.waitForTimeout(s * 1000)

async function typeSlowly(locator, text) {
  await locator.click()
  await locator.pressSequentially(text, { delay: 45 })
}

async function pin(id, digits) {
  await page.locator(`#${id}`).click()
  await page.keyboard.type(digits, { delay: 120 })
}

async function register(w) {
  await page.goto(`${URL}/app?mode=register`)
  await page.locator('#f-name').waitFor()
  await pause(1)
  await typeSlowly(page.locator('#f-name'), w.name)
  await typeSlowly(page.locator('#f-phone'), w.phone)
  await pin('f-pin', w.pin)
  await pin('f-pin2', w.pin)
  await page.locator('#f-q').selectOption({ index: 1 })
  await typeSlowly(page.locator('#f-ans'), 'Hyderabad')
  await page.locator('input[type=checkbox]').check()
  await pause(0.6)
  await page.locator('button[type=submit]').click()
  await page.locator('#f-pin2').waitFor({ state: 'detached' })   // back on the login form
  await pause(1.5)
}

async function login(w) {
  const phoneBox = page.locator('#f-phone')
  if (!(await phoneBox.inputValue())) await typeSlowly(phoneBox, w.phone)
  await pin('f-pin', w.pin)
  await pause(0.5)
  await page.locator('button[type=submit]').click()
  await page.locator('textarea').waitFor({ timeout: 30000 })
  await pause(2)
}

async function say(text, readFor = 3) {
  const box = page.locator('textarea')
  await typeSlowly(box, text)
  await pause(0.4)
  await page.keyboard.press('Enter')
  // HakDaar shows typing dots while it thinks; wait for the reply to arrive.
  await page.locator('.typing-dot').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  await page.locator('.typing-dot').first().waitFor({ state: 'detached', timeout: 90000 })
  await pause(readFor)
}

async function openAccount() {
  await page.locator('header button[title]').last().click()
  await pause(1.5)
}

// ---------------------------------------------------------------- the walkthrough
mark('landing')
await page.goto(`${URL}/`)
await pause(8)

mark('signup')
await register(WORKERS[0])

mark('login')
await login(WORKERS[0])

mark('promise')
await say('Rakesh promised me 800 rupees per day for the building work')

mark('work')
await say('I worked 6 days for him')

mark('payment')
await say('He paid me only 3000 and said the rest later', 4)

mark('owed')
await say('How much am I still owed?', 4)

mark('ledger')
await page.getByRole('button', { name: /Show entries/ }).first().click().catch(() => {})
await pause(5)

mark('memory')
await openAccount()
await pause(5)

mark('light')
await page.getByRole('radio', { name: /Light/ }).click()
await pause(2.5)
await page.keyboard.press('Escape')
await pause(3)
await openAccount()
await page.getByRole('radio', { name: /Dark/ }).click()
await pause(1)
await page.getByRole('button', { name: /Log out/ }).click()
await pause(1.5)

mark('community')
await register(WORKERS[1])
await login(WORKERS[1])
await say('Rakesh has offered me work at 700 per day', 4)
await openAccount()
await page.getByRole('button', { name: /Employer alerts/ }).click()
await pause(2)
await page.getByRole('button', { name: /What have workers reported/ }).first().click().catch(() => {})
await page.waitForTimeout(12000)   // Hindsight "reflect" summarises the reports

mark(null)
const video = page.video()
await context.close()
await browser.close()
const raw = await video.path()
renameSync(raw, 'public/recording.webm')

const duration = segments.at(-1).end
writeFileSync('src/segments.json', JSON.stringify({ source: URL, duration, segments }, null, 2))
console.log(`\nSaved public/recording.webm (${duration.toFixed(0)}s) and src/segments.json`)
console.log('Next: npm run render')
