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
const clicks = args.filter((a) => a.startsWith('--click=')).map((a) => a.slice(8))
const fills = args.filter((a) => a.startsWith('--fill=')).map((a) => a.slice(7))
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
for (const f of fills) { const [sel, val] = f.split('::'); await page.fill(sel, val) }
for (const c of clicks) {
  const [sel, w] = c.split('::')
  await page.click(sel, { timeout: 10000 }).catch((e) => errors.push(`click failed ${sel}: ${e.message}`))
  await page.waitForTimeout(Number(w ?? 600))
}
await page.waitForTimeout(wait)
const out = join(here, '..', 'shots', `${name}.png`)
await page.screenshot({ path: out, fullPage: true })
console.log(`saved ${out}`)
if (errors.length) { console.log('console errors:'); for (const e of errors) console.log(' -', e.slice(0, 300)) }
await browser.close()
