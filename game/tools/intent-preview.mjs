/**
 * 4색 예고 비교 촬영 (DESIGN.md 기둥 2).
 *
 * 색을 나눈 목적은 **"색마다 다른 대응"** 을 가르치는 것입니다. 그러려면 화면에서
 *   1) 색이 확실히 구분되고
 *   2) 도형의 크기·모양도 함께 달라야
 * 합니다. 색만 다르고 모양이 같으면 "노랑은 넓다"가 거짓말이 되고,
 * 색맹 플레이어에게는 정보가 아예 0이 됩니다.
 *
 * 어떤 색이 뜰지는 거리와 난수가 정하므로 기다려서는 원하는 색을 못 잡습니다.
 * 그래서 패턴을 직접 지정하고, 예고가 떠 있는 프레임에서 화면을 멈춰 찍습니다.
 *
 * 실행: npm run intents
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4195
const VIEWPORT = { width: 900, height: 760 }
const CLIP = { x: 190, y: 150, width: 520, height: 460 }
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
  await page.evaluate(() => window.__game.freezeEnemies(true))
  await sleep(800)

  // 보스 하나를 플레이어 앞에 세우고 네 패턴을 차례로 띄웁니다.
  // 보스만 네 색을 전부 씁니다(잡몹은 빨강·노랑 둘뿐 — enemyAttacks.ts 참고).
  const boss = await page.evaluate(() => window.__game.spawnBoss(0, 5))
  await sleep(400)

  const NAMES = ['red-strike', 'yellow-sweep', 'blue-snare', 'purple-pull']
  for (let i = 0; i < NAMES.length; i++) {
    const id = await page.evaluate(([b, n]) => window.__game.forceAttack(b, n), [boss, i])
    // 예고 도형이 실제로 켜진 프레임을 기다렸다가 멈춥니다.
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    )
    await page.evaluate(() => window.__game.setPaused(true))
    const file = `15-intent-${i}-${NAMES[i]}.png`
    await page.screenshot({ path: path.join(OUT, file), clip: CLIP })
    await page.evaluate(() => window.__game.setPaused(false))
    console.log(`  ${NAMES[i].padEnd(13)} → ${file}  (패턴 ${id})`)
    await sleep(150)
  }

  // 잡몹의 노랑(200°). 보스의 360°와 달리 **등 뒤가 열려 있어야** 합니다 —
  // 그게 "돌아서 뒤로 가라"는 답이 존재한다는 증거입니다.
  await page.evaluate(() => window.__game.clearEnemies())
  await sleep(300)
  const grunt = await page.evaluate(() => window.__game.spawnTestEnemy(0, 4.5))
  await sleep(300)
  await page.evaluate(([g]) => window.__game.forceAttack(g, 1), [grunt])
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )
  await page.evaluate(() => window.__game.setPaused(true))
  await page.screenshot({ path: path.join(OUT, '17-grunt-sweep.png'), clip: CLIP })
  await page.evaluate(() => window.__game.setPaused(false))
  console.log('  잡몹 노랑(200°) → 17-grunt-sweep.png')

  // 🔵 속박에 걸린 상태 — 파랑 예고와 파란 족쇄가 **같은 색**이어야
  // "저 공격에 맞으면 이렇게 된다"가 한 번에 연결됩니다.
  await page.evaluate(() => window.__game.applySnare(3))
  await sleep(300)
  await page.evaluate(() => window.__game.setPaused(true))
  await page.screenshot({ path: path.join(OUT, '16-snared.png'), clip: CLIP })
  await page.evaluate(() => window.__game.setPaused(false))
  console.log('  속박 상태      → 16-snared.png')
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
