/**
 * 조준 허용 오차 측정.
 *
 * 플레이 테스트: **"아예 논타겟팅인 만큼 맞추기가 좀 어려워."**
 *
 * "어렵다"는 느낌을 그대로 튜닝하면 감으로 숫자를 만지게 됩니다. 대신 잽니다:
 * **커서가 적에서 몇 도 빗나가면 공격이 빗나가는가.**
 *
 * 그 각도가 곧 플레이어에게 요구되는 정밀도이고, 논타겟팅 액션의 조작감은
 * 사실상 이 숫자 하나로 결정됩니다. 너무 좁으면 "왜 안 맞지"가 되고,
 * 너무 넓으면 조준이 의미를 잃어 기둥 3(포지셔닝)이 무너집니다.
 *
 * 적을 얼려 두고, 커서를 적에서 일부러 N도 빗겨 놓은 채 때려 봅니다.
 *
 * 실행: npm run aim
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 4205
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 적을 놓을 거리(m)와 커서를 빗겨 놓을 각도(도) */
const DISTANCES = [1.6, 2.4, 3.2]
const ANGLES = [0, 15, 30, 45, 60]

const server = await preview({ root: ROOT, preview: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' })
const browser = await chromium.launch({
  executablePath: ['/opt/pw-browsers/chromium'].find((p) => existsSync(p)),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('ERR:', e.message))
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
  await sleep(900)

  const st = () => page.evaluate(() => window.__game.state())

  /**
   * 적을 정확히 +Z 방향 dist 미터에 세우고, 커서는 그로부터 angle 도 빗겨 놓은 뒤
   * 한 대 칩니다. 맞았는지만 봅니다.
   */
  const trial = async (weaponKey, dist, angleDeg) => {
    await page.evaluate(() => window.__game.reset())
    await sleep(320)
    await page.evaluate(() => window.__game.clearEnemies())
    await page.evaluate(() => window.__game.freezeEnemies(true))
    await sleep(200)
    await page.evaluate((k) => window.__game.press(k), weaponKey)
    await sleep(40)
    await page.evaluate((k) => window.__game.release(k), weaponKey)
    await sleep(260)
    await page.evaluate((d) => window.__game.spawnTestEnemy(0, d, Math.PI), dist)
    await sleep(200)

    // 커서는 적과 같은 거리에, 각도만 빗겨 놓습니다.
    const rad = (angleDeg * Math.PI) / 180
    await page.evaluate(
      ([x, z]) => window.__game.aimAtWorld(x, z),
      [Math.sin(rad) * dist, Math.cos(rad) * dist],
    )
    await sleep(260)

    // Idle 을 확인하고 칩니다(후딜 중이면 입력이 씹힙니다).
    for (let i = 0; i < 30; i++) {
      if ((await st()).player.state === 0) break
      await sleep(60)
    }
    await page.evaluate(() => window.__game.press('Mouse0'))
    await sleep(50)
    await page.evaluate(() => window.__game.release('Mouse0'))

    let rot = null
    for (let i = 0; i < 45; i++) {
      const s = await st()
      if (rot === null && s.player.state === 1) rot = s.player.rotY
      if (s.hitsDealt > 0) return { hit: true, rot }
      if (s.player.state === 0 && i > 10) break
      await sleep(70)
    }
    return { hit: false, rot }
  }

  /**
   * 한 칸을 여러 번 재서 **비율**로 봅니다.
   * 한 번만 재면 소프트웨어 렌더링의 프레임 흔들림 때문에 같은 조건이
   * O 였다 . 였다 합니다. 그 위에서 수치를 만지면 노이즈를 튜닝하게 됩니다.
   */
  const cell = async (weaponKey, dist, angleDeg, tries = 3) => {
    let hits = 0
    let rotSum = 0
    let rotN = 0
    for (let i = 0; i < tries; i++) {
      const r = await trial(weaponKey, dist, angleDeg)
      if (r.hit) hits++
      if (r.rot !== null) {
        rotSum += r.rot
        rotN++
      }
    }
    return { rate: hits / tries, rot: rotN ? (rotSum / rotN) * (180 / Math.PI) : NaN }
  }

  for (const [key, label] of [
    ['Digit1', '롱소드 (사거리 2.3m / 110°)'],
    ['Digit3', '쌍단검 (사거리 1.9m /  95°)'],
  ]) {
    console.log(`\n${label}`)
    console.log('        ' + ANGLES.map((a) => String(a).padStart(4) + '°').join(''))
    for (const d of DISTANCES) {
      const row = []
      const rots = []
      for (const a of ANGLES) {
        const c = await cell(key, d, a)
        row.push(c.rate === 1 ? '   O' : c.rate === 0 ? '   .' : `  ${Math.round(c.rate * 3)}/3`)
        rots.push(Number.isNaN(c.rot) ? '  -' : String(Math.round(c.rot)).padStart(4))
      }
      console.log(`  ${d.toFixed(1)}m ` + row.join(''))
      // 몸이 실제로 어느 쪽을 향했는지. 보정이 걸리면 0°(적 방향)에 가까워야 합니다.
      console.log(`   몸각 ` + rots.join(''))
    }
  }
  console.log('\n  O = 명중,  . = 빗나감   (가로축 = 커서가 적에서 빗나간 각도)')
} finally {
  await browser.close()
  await server.close()
}
