/**
 * 🌊 **가림벽이 정말 가리는가** — `npm run hide`
 *
 * ── 왜 캡처여야 하는가 ─────────────────────────────────────────────
 * 이 비밀은 **규칙이 아니라 그림**으로 성립합니다. 벽이 불투명하냐
 * 흐리냐는 `applyOcclusionFade` 가 정하고, 그 결과는 **화면의 픽셀에만**
 * 있습니다. 코드를 읽고 각도를 계산해서 *"안 흐려질 것이다"* 라고 적는
 * 것은 이 저장소가 여러 번 데인 바로 그것입니다 —
 * **「재기 전의 설명은 결론이 아니다」.**
 *
 * 실제로 색 대비를 계산으로 33.6 이라 믿었다가 화면에서 23.3 인 것을
 * `npm run contrast` 로 알아낸 적이 있습니다. 계산과 화면은 다릅니다.
 *
 * ── 무엇을 찍는가 ──────────────────────────────────────────────────
 * 같은 벽을 **두 자리에서** 찍습니다:
 *   ① 바깥 길 — 벽이 **불투명**해야 합니다(안이 안 보여야 비밀입니다)
 *   ② 주머니 안 — 벽이 **흐려져야** 합니다(안 그러면 내가 안 보입니다)
 *
 * 한 장만 찍으면 아무 말도 못 합니다. *"불투명하다"* 는 ②가 있어야
 * 비밀이 되고, *"흐리다"* 는 ①이 있어야 자랑이 됩니다.
 *
 * ⚠️ 이건 **판정 프로브가 아닙니다.** 통과/실패를 내지 않습니다 —
 *    사람이 볼 그림을 만들 뿐입니다. 숫자로 묻는 것은 `npm run map` 과
 *    `npm run urn` 이 이미 합니다.
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4198
const VIEWPORT = { width: 900, height: 760 }
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
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 30000 })
  await page.evaluate(() => window.__game.clearEnemies())
  await sleep(600)

  console.log('\n🌊 가림벽 — 바깥에서는 막고, 안에서는 열리는가\n')

  /**
   * 칸→월드 변환에 쓰는 값은 **둘 다 밖에서 가져옵니다** — 격자 크기는
   * 레벨 파일에서, 한 칸의 크기는 게임에서. 여기에 `(cx-44+0.5)*2` 를
   * 적어 두면 격자를 바꾸는 날 이 도구만 옛 좌표를 씁니다(이 저장소가
   * 여러 번 데인 「베껴 적은 규칙」).
   */
  const level = JSON.parse(
    await readFile(path.join(ROOT, 'src', 'levels', 'broken-gate.json'), 'utf8'),
  )
  const cell = await page.evaluate(() => window.__game.terrainInfo().cellSize)
  const world = (cx, cz) => ({
    x: (cx - level.w / 2 + 0.5) * cell,
    z: (cz - level.h / 2 + 0.5) * cell,
  })

  /**
   * 벽은 cx 50~56 · cz 22~23 (make-zone.mjs 「가림벽 뒤」 참고).
   *
   * **세 자리**를 찍습니다. 둘로는 못 가리는 것이 있습니다 — 계산해
   * 보니 길 위에서도 벽에 **가까우면 흐려집니다**(cz 30 부근이 문턱).
   * 그래서 「먼 길 · 가까운 길 · 안」 셋을 두고, 흐려지기 시작하는
   * 자리가 어디인지를 그림으로 남깁니다.
   */
  const SPOTS = [
    ['a-far', 52, 34, '먼 길 — 불투명해야 합니다(멀리서는 안 보임)'],
    ['b-near', 52, 30, '가까운 길 — 문턱 부근. 흐려지기 시작할 수 있습니다'],
    ['c-inside', 52, 20, '주머니 안 — 흐려져야 합니다'],
  ]
  for (const [name, cx, cz, why] of SPOTS) {
    const w = world(cx, cz)
    await page.evaluate(([x, z]) => window.__game.teleportPlayer(x, z), [w.x, w.z])
    // 카메라가 따라붙고 청크 투명도가 갱신될 때까지 몇 프레임 굴립니다.
    await page.evaluate(
      () =>
        new Promise((r) => {
          let n = 0
          const step = () => (++n < 12 ? requestAnimationFrame(step) : r())
          requestAnimationFrame(step)
        }),
    )
    await page.evaluate(() => window.__game.setPaused(true))
    const file = `19-hide-${name}.png`
    await page.screenshot({ path: path.join(OUT, file) })
    await page.evaluate(() => window.__game.setPaused(false))
    console.log(`  칸(${cx},${cz}) → ${file}   ${why}`)
  }

  console.log('\n  세 장을 나란히 보십시오. 먼 길은 불투명하고 안은 흐려야 이 비밀이 성립합니다.')
  console.log('  ⚠️ 여기서는 판정하지 않습니다 — 사람이 보는 것이 이 도구의 전부입니다.\n')
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 — 조용히 exit 0 하는 계측기는
  //    통과하는 검사보다 나쁩니다.
  console.error('\n💥 캡처가 도중에 죽었습니다 — 그림을 믿지 마십시오\n' + (err?.stack ?? err))
  process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
}
