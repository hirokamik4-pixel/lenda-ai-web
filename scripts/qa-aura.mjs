// Aura Studio QA — runs against the dev server (or any URL via QA_BASE).
// Usage:  node scripts/qa-aura.mjs
//         QA_BASE=http://localhost:5173 QA_IMAGE=test.png node scripts/qa-aura.mjs
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const BASE = process.env.QA_BASE || 'http://localhost:5173'
const CHROME = process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const IMAGE = process.env.QA_IMAGE || 'C:/Users/Tech/Documents/Qoder/2026-11-01/9f55b5be/vibe_images/aura-test-subject_1793623364787_e59689fc.png'

const downloadsDir = join(tmpdir(), `aura-qa-${Date.now()}`)
mkdirSync(downloadsDir, { recursive: true })

let pass = 0
let fail = 0
const failures = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, ok, extra = '') {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  FAIL ${name} ${extra}`)
  }
}

async function waitForText(page, selector, text, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await page.$eval(selector, (el) => el.textContent ?? '').catch(() => '')
    if (value.includes(text)) return value
    await sleep(800)
  }
  return null
}

async function latestFile(dir, pattern) {
  const files = readdirSync(dir).filter((f) => pattern.test(f))
  if (files.length === 0) return null
  return join(dir, files.sort().pop())
}

async function waitForFile(dir, pattern, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const file = await latestFile(dir, pattern)
    if (file && statSync(file).size > 0) return file
    await sleep(800)
  }
  return null
}

async function clickText(page, selector, text) {
  const handles = await page.$$(selector)
  for (const handle of handles) {
    const label = await handle.evaluate((el) => el.textContent ?? '')
    if (label.includes(text)) {
      await handle.click()
      return true
    }
  }
  return false
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  const cdp = await page.createCDPSession()
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsDir })

  console.log(`\n[qa-aura] ${BASE}`)
  console.log('\n1. Navigation and tools')
  await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 60000 })
  const navText = await page.$eval('.shell__tabs', (el) => el.textContent ?? '')
  check('Studio tab is in the navigation', navText.includes('Studio'))

  const toolsTab = await page.$$('.shell__switch button')
  let toolsBtn = null
  for (const btn of toolsTab) {
    const label = await btn.evaluate((el) => el.textContent ?? '')
    if (label.includes('Tools')) toolsBtn = btn
  }
  await toolsBtn.click()
  await sleep(600)
  const cards = await page.$$('.toolcard')
  check('two tool cards shown', cards.length === 2, `got ${cards.length}`)
  const cardTexts = []
  for (const card of cards) cardTexts.push(await card.evaluate((el) => el.textContent ?? ''))
  check('Aura Studio card is first with built-in label', cardTexts[0]?.includes('Aura Studio') && cardTexts[0]?.includes('Built into Axion'), cardTexts[0]?.slice(0, 80))
  const pixoraHref = await cards[1]?.evaluate((el) => el.getAttribute('href'))
  check('Pixora card links to the live Pixora site', pixoraHref === 'https://deluxe-kelpie-851d9e.netlify.app/', String(pixoraHref))

  console.log('\n2. Studio opens from the tool card')
  await cards[0].click()
  await sleep(800)
  const studioTitle = await page.$eval('.aura-studio__title', (el) => el.textContent ?? '').catch(() => '')
  check('Aura Studio opens', studioTitle.includes('Aura Studio'), studioTitle)

  console.log('\n3. Upload and local edits')
  const fileInput = await page.$('.aura-studio input[type=file]')
  check('file input exists', !!fileInput)
  await fileInput.uploadFile(IMAGE)
  await sleep(1200)
  const preview = await page.$('.aura-preview')
  check('preview shows the uploaded image', !!preview)
  const widthBefore = await page.$eval('.aura-preview', (el) => el.naturalWidth).catch(() => 0)
  check('uploaded image is the test photo (896px)', widthBefore === 896, `got ${widthBefore}`)

  console.log('\n4. AI enhance (neural upscale in the browser)')
  await clickText(page, '.aura-btn', 'AI enhance')
  // First use loads the neural model, so this can take a while.
  let enhanceOutcome = null
  const enhanceDeadline = Date.now() + 180000
  while (Date.now() < enhanceDeadline && !enhanceOutcome) {
    const status = await page.$eval('.aura-status', (el) => el.textContent ?? '').catch(() => '')
    if (status.includes('AI enhancement finished')) {
      enhanceOutcome = { kind: 'finished', text: status }
      break
    }
    const errorText = await page.$eval('.aura-error', (el) => el.textContent ?? '').catch(() => '')
    if (errorText.trim()) {
      enhanceOutcome = { kind: 'error', text: errorText }
      break
    }
    await sleep(800)
  }
  check(
    'AI enhance finishes',
    enhanceOutcome?.kind === 'finished',
    enhanceOutcome ? `${enhanceOutcome.kind}: ${enhanceOutcome.text.slice(0, 100)}` : 'no status',
  )
  const enhanceFailedGracefully = enhanceOutcome?.kind === 'error'
  if (enhanceOutcome?.kind === 'finished') {
    const dims = await page.$eval('.aura-preview', (el) => ({
      w: el.naturalWidth,
      h: el.naturalHeight,
    })).catch(() => ({ w: 0, h: 0 }))
    const expected = 2 * Math.round(widthBefore * Math.min(1, 768 / Math.max(widthBefore, 1200)))
    check('AI enhance upscales the photo 2x', dims.w === expected, `${widthBefore} -> ${dims.w} (expected ${expected})`)
  }

  console.log('\n5. Quick boost and filters')
  const widthBeforeBoost = await page.$eval('.aura-preview', (el) => el.naturalWidth).catch(() => 0)
  await clickText(page, '.aura-btn', 'Quick boost')
  const boostStatus = await waitForText(page, '.aura-status', 'Boosted', 30000)
  check('quick boost finishes', !!boostStatus, boostStatus?.slice(0, 80) ?? 'no status')
  const widthAfter = await page.$eval('.aura-preview', (el) => el.naturalWidth).catch(() => 0)
  check('boost doubles the size', widthAfter === widthBeforeBoost * 2, `got ${widthAfter}`)

  await clickText(page, '.aura-filters button', 'Noir')
  await sleep(400)
  const filter = await page.$eval('.aura-preview', (el) => el.style.filter).catch(() => '')
  check('Noir filter applies to the preview', filter.includes('grayscale'), filter)

  await clickText(page, '.aura-btn', 'Download')
  const png = await waitForFile(downloadsDir, /aura-edit.*\.png$/, 20000)
  check('downloads the edited PNG', !!png && statSync(png).size > 10000, png ?? 'no file')

  console.log('\n6. AI remove background (first run downloads the model)')
  await clickText(page, '.aura-btn', 'Remove background')
  const bgStatus = await waitForText(page, '.aura-status', 'Background removed', 300000)
  check('background removed', !!bgStatus, bgStatus?.slice(0, 80) ?? 'no status')

  console.log('\n7. Music tab')
  await clickText(page, '.aura-studio__tabs button', 'Music')
  await sleep(400)
  const promptInput = await page.$('.aura-field input')
  await promptInput.click({ clickCount: 3 })
  await promptInput.type('midnight ocean calm')
  await clickText(page, '.aura-btn', 'Play')
  await sleep(2000)
  const playLabel = await page.$$eval('.aura-btn', (els) => els.map((el) => el.textContent ?? '').find((t) => t.includes('Stop') || t.includes('Play')) ?? '')
  check('music starts (button flips to Stop)', playLabel.includes('Stop'), playLabel)
  const bar1 = await page.$eval('.aura-viz span', (el) => el.style.transform).catch(() => '')
  await sleep(1200)
  const bar2 = await page.$eval('.aura-viz span', (el) => el.style.transform).catch(() => '')
  check('visualizer bars move with the music', bar1 !== bar2, `${bar1} -> ${bar2}`)
  await clickText(page, '.aura-btn', 'Download WAV')
  const wav = await waitForFile(downloadsDir, /aura-music.*\.wav$/, 20000)
  check('downloads a WAV file', !!wav && statSync(wav).size > 1_000_000, wav ?? 'no file')

  console.log('\n8. Reel tab')
  await clickText(page, '.aura-studio__tabs button', 'Reel')
  await sleep(400)
  await clickText(page, '.aura-btn', 'Make my reel')
  const video = await page.waitForSelector('.aura-panel--preview video', { timeout: 30000 }).catch(() => null)
  check('reel video is produced', !!video)
  await clickText(page, '.aura-btn', 'Download reel')
  const webm = await waitForFile(downloadsDir, /aura-reel.*\.webm$/, 20000)
  check('downloads the reel video', !!webm && statSync(webm).size > 20000, webm ?? 'no file')

  console.log('\n9. Console cleanliness')
  let realErrors = consoleErrors.filter((e) => !/favicon|net::ERR/i.test(e))
  if (enhanceFailedGracefully) {
    // The expected local-only failure above logs one resource error in the console.
    realErrors = realErrors.filter(
      (e) => !/Failed to load resource.*status of (4|5)\d\d/.test(e),
    )
  }
  check('zero console/page errors', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 4)))

  await browser.close()
  console.log(`\n[qa-aura] ${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('Failures:', failures.join(' | '))
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[qa-aura] crashed:', err)
  process.exitCode = 1
})
