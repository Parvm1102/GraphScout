// Screenshot loop: node scripts/shot.mjs <name> [path] [--wait=<ms>] [--click=<selector>]... [--w=1440] [--h=900]
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const name = args.find((a) => !a.startsWith('--')) ?? 'app'
const path = args.filter((a) => !a.startsWith('--'))[1] ?? '/app'
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d }
const wait = Number(opt('wait', '1500'))

const width = Number(opt('w', '1440')), height = Number(opt('h', '900'))

mkdirSync(join(here, '..', 'shots'), { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' })
await page.waitForSelector('svg[role="img"] circle', { timeout: 30000 }).catch(() => {})
for (const step of args.filter((a) => a.startsWith('--click=') || a.startsWith('--fill=') || a.startsWith('--waitfor=') || a.startsWith('--hover=') || a.startsWith('--press='))) {
  const [kind, rest] = [step.slice(2, step.indexOf('=')), step.slice(step.indexOf('=') + 1)]
  const [sel, extra] = rest.split('::')
  if (kind === 'click') {
    await page.click(sel, { timeout: 10000 }).catch((e) => errors.push(`click failed ${sel}: ${e.message}`))
    await page.waitForTimeout(Number(extra ?? 600))
  } else if (kind === 'hover') {
    await page.hover(sel, { timeout: 10000 }).catch((e) => errors.push(`hover failed ${sel}: ${e.message}`))
    await page.waitForTimeout(Number(extra ?? 400))
  } else if (kind === 'fill') {
    await page.fill(sel, extra ?? '')
  } else if (kind === 'press') {
    await page.press(sel, extra ?? 'Enter')
  } else if (kind === 'waitfor') {
    await page.waitForSelector(sel, { timeout: Number(extra ?? 60000) }).catch((e) => errors.push(`waitfor failed ${sel}: ${e.message}`))
  }
}
await page.waitForTimeout(wait)
const out = join(here, '..', 'shots', `${name}.png`)
await page.screenshot({ path: out, fullPage: true })
console.log(`saved ${out}`)
if (errors.length) { console.log('console errors:'); for (const e of errors) console.log(' -', e.slice(0, 300)) }
await browser.close()
