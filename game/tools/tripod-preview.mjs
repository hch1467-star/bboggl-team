/**
 * 트라이포드 창 확인 촬영.
 *
 * 이 창의 목적은 두 가지이고, 둘 다 **눈으로만** 판정됩니다:
 *  1) 세 단계 × 두 선택이 한눈에 비교되는가 (안 되면 고를 수가 없습니다)
 *  2) 잠긴 것이 "왜 잠겼는지"까지 읽히는가 (안 되면 탐험할 이유가 안 생깁니다)
 *
 * 실행: npm run tripod
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4197
const VIEWPORT = { width: 1100, height: 760 }
const PREINSTALLED = ['/opt/pw-browsers/chromium']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

const server = await preview({
  root: ROOT,
  preview: { port: PORT, strictPort: true, host: '127.0.0.1' },
  logLevel: 'error',
})
const browser = await chromium.launch({
  executablePath: PREINSTALLED.find((p) => existsSync(p)),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('error:', e))
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
  await page.evaluate(() => window.__game.clearEnemies())
  await sleep(900)

  // (1) 각인석 0개 — 전부 잠긴 상태. "무엇을 얻게 되는지"가 보여야 합니다.
  await page.evaluate(() => window.__game.toggleTripodPanel())
  await sleep(500)
  await page.screenshot({ path: path.join(OUT, '18-tripod-locked.png') })
  console.log('  잠긴 상태      → 18-tripod-locked.png')

  // (2) 각인석 3개로 롱소드 「돌진 베기」를 3단계까지 연 상태.
  await page.evaluate(() => {
    window.__game.grantTripod(4)
    window.__game.unlockTripod('lunge_slash', 0, 0)
    window.__game.unlockTripod('lunge_slash', 1, 1)
    window.__game.unlockTripod('lunge_slash', 2, 0)
  })
  await sleep(500)
  await page.screenshot({ path: path.join(OUT, '19-tripod-unlocked.png') })
  console.log('  해금 상태      → 19-tripod-unlocked.png')

  const before = await page.evaluate(() => window.__game.effectiveSkill(0))
  console.log('  실효 수치      →', JSON.stringify(before))
} finally {
  await browser.close()
  await server.close()
}
