/**
 * ✨ **«보는 맛» 시안 — `npm run look`**
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────────
 * *"노 레스트 포 더 위키드 같은 그래픽이 나올 수 있나?"* 라는 물음에
 * 말로 답하면 인상이 됩니다. 그런데 이 저장소가 이번 회차에 배운 것이
 * 정확히 그 반대입니다 — **인상으로 말하면 틀립니다.**
 *
 * 그래서 **같은 자리·같은 구도**에서 두 장을 찍습니다:
 *
 *     지금 그대로            ?look=0 (기본 게임)
 *     시안(같은 도형 그대로)  ?look=1 + 평면 셰이딩
 *
 * ⚠️ **다른 자리에서 찍으면 그건 비교가 아니라 두 장의 그림입니다.**
 *    그래서 카메라를 흔들 수 있는 것(적의 움직임·이펙트)이 끼기 전에,
 *    같은 좌표로 순간이동시키고 같은 프레임 수만큼 기다린 뒤 찍습니다.
 *
 * ⚠️ 이 도구는 **판정을 안 합니다.** «예쁜가»는 어느 프로브도 못 재는
 *    종류이고, 이 저장소는 그걸 `npm run dressing` 에도 적어 뒀습니다.
 *    고르는 것은 사람이고, 도구는 **같은 조건으로 보여 주는** 일만 합니다.
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ensureFreshBuild } from './fresh-build.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4191
const VIEWPORT = { width: 1280, height: 800 }
const PREINSTALLED = ['/opt/pw-browsers/chromium']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

// 🏗 소스가 아니라 dist 를 찍습니다 — 안 지으면 옛 그림을 지금 것으로 믿습니다.
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

/**
 * 📍 **찍는 자리.** 존 안에서 «전투가 실제로 일어나는» 곳을 고릅니다 —
 *    빈 들판을 찍으면 어느 쪽이든 잘 나오고, 그건 아무것도 안 알려 줍니다.
 *    broken-gate.json 의 잡몹 무리 근처(x 27~33 · z −9~−5)입니다.
 */
const SPOT = { x: 29, z: -6 }

async function shoot(page, tag, look) {
  await page.goto(`http://127.0.0.1:${PORT}/?level=broken-gate${look ? '&look=1' : ''}`, {
    waitUntil: 'load',
  })
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  await page.evaluate(
    ([x, z, useLook]) => {
      const G = window.__game
      G.teleportPlayer(x, z)
      G.aimAtWorld(x + 3, z + 1)
      // ✨ 평면 셰이딩은 «고르기 전» 값이라 게임 파일이 아니라 여기서 겁니다.
      if (useLook) G.applyLook()
    },
    [SPOT.x, SPOT.z, look],
  )

  /**
   * 카메라가 새 자리로 따라붙고 적이 깨어나 «장면»이 되기를 기다립니다.
   * 두 장에 **같은 시간**을 줍니다 — 한쪽만 더 기다리면 그 차이가
   * 조명이 아니라 «누가 더 가까이 왔나»로 나타납니다.
   */
  await sleep(2600)

  const file = path.join(OUT, `look-${tag}.png`)
  await page.screenshot({ path: file })
  const lit = await page.evaluate(() => {
    const G = window.__game
    return { enemies: G.state().enemiesLeft, hp: G.state().player.hp }
  })
  console.log(`  📸 ${path.basename(file)} — 적 ${lit.enemies}마리 · 체력 ${lit.hp}`)
  return file
}

try {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.error('game error:', e))

  console.log('\n✨ 보는 맛 시안 — 같은 자리·같은 구도로 두 장\n')
  await shoot(page, 'now', false)
  await shoot(page, 'draft', true)
  console.log('\n  두 장은 tools/shots/ 에 있습니다. 판정은 안 합니다 — 고르는 것은 사람입니다.\n')
} finally {
  await browser.close()
  await server.close()
}
