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
import { ensureFreshBuild } from './fresh-build.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4197
const VIEWPORT = { width: 1100, height: 760 }
const PREINSTALLED = ['/opt/pw-browsers/chromium']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

// 🏗 **찍기 전에 짓습니다.** 이 도구는 소스가 아니라 `dist/` 를 찍습니다 —
//    안 지으면 옛 게임의 그림을 지금 것으로 믿게 됩니다(fresh-build.mjs).
await ensureFreshBuild(ROOT)
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
} catch (err) {
  /**
   * 💥 **도중에 죽으면 반드시 소리를 냅니다.**
   *
   * ── 왜 이게 없어서 한 라운드를 통째로 날렸는가 ────────────────────
   * 이 파일들은 전부 `try { ... } finally { 닫기 }` 뿐이고 **`catch` 가
   * 없었습니다.** 그래서 본문이 도중에 던지면:
   *   · 집계 줄(`N개 통과 / N개 실패`)에 **영영 도달하지 않고**
   *   · 그 아래 `process.exit(fail === 0 ? 0 : 1)` 도 **실행되지 않아**
   *   · 껍데기는 **성공(exit 0)** 처럼 보입니다.
   *
   * 실제로 무기 프로브가 측정 도중 죽었는데 오류 한 줄 없이 exit 0 이었고,
   * 출력이 중간에서 끊긴 것을 눈치채기 전까지 그 숫자를 믿을 뻔했습니다.
   * 이 저장소가 가장 비싸게 여기는 실패 — **아무 말도 안 하는 계측기** —
   * 를 계측기 **전부**가 갖고 있었던 셈입니다(49개 중 49개).
   *
   * 통과하는 검사보다 나쁜 것은 아무 말도 안 하는 검사이고,
   * 그보다 더 나쁜 것은 **죽으면서 성공했다고 말하는 검사**입니다.
   */
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
}
