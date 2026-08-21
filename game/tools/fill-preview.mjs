/**
 * ⏳ **차오르는 예고**를 눈으로 확인합니다 — `npm run fill`
 *
 * ── 왜 캡처가 따로 필요한가 ──────────────────────────────────────
 * `npm run parry` 가 이미 숫자로 확인합니다 — 차오른 몫이 판정 즈음
 * 0.99 에 닿고, 그 전에는 0.85쯤이라는 것. 그런데 그건 **값이 맞다**는
 * 확인이지 **보인다**는 확인이 아닙니다.
 *
 * 이 신호가 하려는 일은 *"밝은 끝이 바깥 선에 닿는 순간이 판정"* 을
 * 사람 눈에 가르치는 것입니다. 그러려면 **자라는 것이 눈에 띄어야**
 * 하고, 그건 픽셀을 봐야 압니다. 실제로 이 저장소는 색 대비를 계산으로
 * 33.6 이라고 믿었다가 화면에서 23.3 인 것을 `npm run contrast` 로
 * 알아낸 적이 있습니다 — **계산과 화면은 다른 것**입니다.
 *
 * 한 공격의 예고를 **여러 지점에서** 찍어 나란히 둡니다. 한 장만 찍으면
 * "차오른다"는 그림으로 확인할 수가 없습니다 — 비교 대상이 없으니까요.
 *
 * ⚠️ 이건 **판정 프로브가 아닙니다.** 통과/실패를 내지 않습니다. 사람이
 *    볼 그림을 만들 뿐이고, 옳은지는 `npm run parry` 가 숫자로 봅니다.
 *    둘을 한 파일에 섞으면 "그림이 예쁘다"가 초록이 되어 버립니다.
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4197
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

  console.log('\n⏳ 차오르는 예고 — 한 공격을 여러 지점에서 찍습니다\n')

  const boss = await page.evaluate(() => window.__game.spawnBoss(0, 5))
  await sleep(400)

  /**
   * 🔴 직격을 씁니다 — 타이밍으로 푸는 색이라 저스트 회피의 대상이고,
   * 부채꼴이 좁아 **자란 길이가 한눈에 보입니다**. 🟡 광역(360°)은
   * 화면을 다 덮어서 "얼마나 찼는가"가 오히려 안 읽힙니다.
   */
  const SHOTS = [
    ['a-start', 0.15],
    ['b-half', 0.55],
    ['c-almost', 0.9],
  ]
  await page.evaluate(([b]) => window.__game.forceAttack(b, 0), [boss])
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )

  for (const [name, want] of SHOTS) {
    /**
     * 원하는 지점까지 **게임에게 물어보며** 굴립니다. 벽시계로 기다리면
     * 이 컨테이너에서는 프레임이 튀어 매번 다른 자리를 찍습니다 —
     * 같은 파일 이름에 다른 그림이 들어가는 것이 가장 나쁩니다.
     */
    const got = await page.evaluate(
      async ([target]) => {
        const G = window.__game
        for (let i = 0; i < 600; i++) {
          const t = G.telegraphs()[0]
          if (!t) break
          // 남은 시간이 아니라 **화면에 그려진 크기**로 기다립니다 —
          // 이 캡처가 확인하려는 것이 바로 그 값이니까요.
          if (t.grow >= target) return t.grow
          await new Promise((r) => requestAnimationFrame(r))
        }
        return G.telegraphs()[0]?.grow ?? -1
      },
      [want],
    )
    await page.evaluate(() => window.__game.setPaused(true))
    const file = `18-fill-${name}.png`
    await page.screenshot({ path: path.join(OUT, file), clip: CLIP })
    await page.evaluate(() => window.__game.setPaused(false))
    console.log(`  차오름 ${String(got).padStart(5)} → ${file}`)
  }

  console.log('\n  세 장을 나란히 보면 밝은 부채꼴이 자라는 것이 보여야 합니다.')
  console.log('  ⚠️ 옳은지는 여기서 안 봅니다 — `npm run parry` 가 숫자로 봅니다.\n')
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 — 조용히 exit 0 하는 계측기는
  //    통과하는 검사보다 나쁩니다(intent-preview.mjs 의 같은 자리 참고).
  console.error('\n💥 캡처가 도중에 죽었습니다 — 그림을 믿지 마십시오\n' + (err?.stack ?? err))
  process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
}
