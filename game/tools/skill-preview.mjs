/**
 * 스킬 화면 미리보기 — 스킬바와 바닥 예고(telegraph)를 눈으로 확인합니다.
 *
 * 자동 검증은 "스킬이 발동했고 쿨다운이 돌았다"까지만 알려줍니다.
 * 예고 도형이 화면에 제대로 그려지는지, 스킬바가 읽히는지는 봐야만 압니다.
 *
 * 실행: npm run skills
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4177
const VIEWPORT = { width: 1100, height: 690 }
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
  await page.goto(`http://127.0.0.1:${PORT}/?lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
  await sleep(1500)

  const tap = async (code) => {
    await page.evaluate((c) => window.__game.press(c), code)
    await sleep(50)
    await page.evaluate((c) => window.__game.release(c), code)
  }
  const aimAt = (x, z) => page.evaluate(([a, b]) => window.__game.aimAtWorld(a, b), [x, z])

  // 1) 대검 — 지점 지정 장판(대지 강타)의 예고를 잡습니다. windup 0.62초.
  await tap('Digit2')
  await sleep(400)
  await aimAt(7, 0)
  await sleep(200)
  await tap('KeyQ')
  // 예고가 반쯤 차오른 순간
  await sleep(320)
  await page.screenshot({ path: path.join(OUT, '08-skill-telegraph.png') })
  console.log('  캡처: 08-skill-telegraph.png (대검 · 지점 지정 장판 예고)')

  // 2) 쿨다운이 돌고 있는 스킬바
  await sleep(1400)
  await page.screenshot({ path: path.join(OUT, '09-skill-cooldown.png') })
  console.log('  캡처: 09-skill-cooldown.png (쿨다운 표시)')

  // 3) 롱소드 회전 베기 — 자기 중심 원형 판정
  await page.evaluate(() => window.__game.reset())
  await sleep(600)
  await tap('KeyE')
  await sleep(260)
  await page.screenshot({ path: path.join(OUT, '10-skill-circle.png') })
  console.log('  캡처: 10-skill-circle.png (롱소드 · 회전 베기 원형 범위)')

  console.log('\n상태:', JSON.stringify((await page.evaluate(() => window.__game.state())).loadout))
} finally {
  await browser.close()
  await server.close()
}
