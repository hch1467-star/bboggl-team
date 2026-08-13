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

  // 4) 백어택 — 등 뒤 구역 표시와 "백어택 치명타!" 데미지 숫자
  await page.evaluate(() => window.__game.reset())
  await sleep(600)
  await page.evaluate(() => window.__game.clearEnemies())
  await sleep(300)
  // rotY=0 이면 적이 +Z(플레이어 반대편)를 봅니다 = 플레이어가 등 뒤
  await page.evaluate(() => window.__game.spawnTestEnemy(0, 2.4, 0))
  await page.evaluate(() => window.__game.spawnTestEnemy(3.2, 3.6, 0))
  await page.evaluate(() => window.__game.freezeEnemies(true))
  await sleep(500)
  await aimAt(0, 2.4)
  await sleep(300)
  await page.screenshot({ path: path.join(OUT, '11-backzone.png') })
  console.log('  캡처: 11-backzone.png (등 뒤 구역 표시)')

  for (let i = 0; i < 8; i++) {
    await tap('Mouse0')
    await sleep(120)
    const st = await page.evaluate(() => window.__game.state())
    if (st.backHits > 0) break
    await sleep(200)
  }
  await sleep(120)
  await page.screenshot({ path: path.join(OUT, '12-backattack.png') })
  console.log('  캡처: 12-backattack.png (백어택 데미지 숫자)')

  console.log('\n상태:', JSON.stringify((await page.evaluate(() => window.__game.state())).loadout))
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
