/**
 * 숨김 검증 — `npm run secret`
 *
 * ── 왜 이걸 재게 됐나 ───────────────────────────────────────────
 * 벤치가 매 판 같은 말을 하고 있었는데 제가 계속 흘려들었습니다:
 *
 *     못 주운 보물   (5,-49) 4/4판에서 못 주움 · 63 (52~66)m
 *                    (39,-39) 4/4판에서 못 주움 · 52 (52~94)m
 *
 * "봇이 보물을 안 주우러 간다"로 읽고 넘겼습니다. 봇 이야기니까요.
 * 그런데 숫자를 카메라와 나란히 놓으면 다른 이야기가 됩니다 —
 * **카메라가 담는 거리는 22m 인데 가장 가까이 간 것이 52m 입니다.**
 * 저 보물의 빛기둥은 **한 번도 화면에 뜬 적이 없습니다.**
 *
 * 그러면 이건 봇의 성향이 아니라 배치의 문제입니다.
 *
 * ── 무엇에 비추어 판단하는가 ────────────────────────────────────
 * DESIGN.md 의 오공 기둥은 *"손으로 숨긴 보물 · 헤매지 않는 탐험"* 입니다.
 * 검은 신화: 오공이 비밀을 숨기는 방식은 **안 보이게 두는 것이 아닙니다.**
 * 주 동선에서 **뭔가 보이게** 두고, 그것이 플레이어의 발을 돌리게 합니다.
 * 갈까 말까가 선택이 되려면 **갈 곳이 있다는 걸 알아야** 합니다.
 *
 * 주 동선에서 아예 안 보이는 보물은 "숨긴 것"이 아니라 **없는 것**입니다.
 * 지도를 다 뒤지는 사람만 찾게 되는데, 그건 탐험이 아니라 청소입니다.
 *
 * ── 어떻게 재는가 ──────────────────────────────────────────────
 * "주 동선"을 제가 정하지 않습니다. **게임의 길찾기가 정합니다.**
 * 시작 지점에서 최종 목표까지 `pathStep` 을 반복해 따라가며 지나온
 * 자리를 모읍니다. 그게 이 존이 플레이어를 실제로 데려가는 선입니다.
 *
 * 그 다음 보물마다 그 선까지의 최단 거리를 재고, **카메라가 담는 거리**와
 * 견줍니다. 문턱도 제가 안 정합니다 — `terrainInfo().cameraViewSize` 를
 * 그대로 씁니다.
 *
 * ⚠️ 일부러 **가장 느슨한 잣대**를 씁니다. 시야 거리 안에 들어오기만 하면
 *    통과입니다(화면 구석이라도). 이보다 엄하게 잡으면 "얼마나 잘 보이나"를
 *    다투게 되는데, 지금 묻는 것은 그게 아니라 **한 번이라도 보이는가**
 *    입니다. 느슨한 잣대에서 걸린 것은 변명의 여지가 없습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5214
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const server = await createServer({ root: ROOT, server: { port: PORT }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: execPath,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🗺️ 숨김 검증 — 보물이 주 동선에서 보이는가\n')

  const t = await page.evaluate(() => window.__game.terrainInfo())
  console.log(`  [설정] 카메라가 담는 거리 ${t.cameraViewSize}m\n`)

  /**
   * 주 동선을 게임의 길찾기로 그립니다.
   *
   * 적은 치웁니다 — 재려는 것은 **길**이지 전투가 아닙니다. 적이 있으면
   * 밀려서 경로가 흔들리고, 그러면 "동선"이 아니라 "그날의 사고"가 됩니다.
   */
  const walk = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    G.reset()
    await sleep()
    G.clearEnemies()
    G.freezeEnemies(true)
    await sleep()
    const trail = []
    let guard = 0
    let goal = null
    /**
     * 목표는 하나가 아니라 **이어집니다**(수문장 → … → 보스). 하나에 닿으면
     * 다음 목표가 나오므로, 목표가 안 바뀔 때까지 계속 따라갑니다.
     * 목표 순서를 프로브가 외우지 않는다는 점이 중요합니다 — 레벨을 고치면
     * 이 프로브가 저절로 새 동선을 따라갑니다.
     */
    while (guard++ < 4000) {
      const obj = G.objective()
      if (!obj) break
      goal = { x: obj.x, z: obj.z, label: obj.label }
      const p = G.state().player
      trail.push({ x: p.x, z: p.z })
      // 목표에 충분히 붙었으면 다음 목표로 넘어가도록 그 자리에 세웁니다.
      if (obj.walkDist <= 1.5) {
        G.teleportPlayer(obj.x, obj.z)
        await sleep()
        const next = G.objective()
        // 목표가 그대로면 더 갈 데가 없습니다(마지막 목표는 처치를 요구합니다).
        if (!next || (Math.abs(next.x - obj.x) < 0.01 && Math.abs(next.z - obj.z) < 0.01)) break
        continue
      }
      const step = G.pathStep(obj.x, obj.z)
      if (!step) break
      G.teleportPlayer(step.x, step.z)
      await sleep()
    }
    G.freezeEnemies(false)
    return {
      trail,
      goal,
      treasures: G.treasurePositions().map((v) => ({ x: v.x, z: v.z })),
    }
  })

  const trail = walk.trail
  check(
    trail.length > 20,
    '주 동선을 그렸다 (게임의 길찾기를 따라간 자취)',
    `${trail.length}걸음 · 마지막 목표 "${walk.goal?.label ?? '?'}"`,
  )

  /** 보물에서 동선까지의 최단 거리. */
  const nearest = (tx, tz) => {
    let best = Infinity
    for (const p of trail) {
      const d = Math.hypot(p.x - tx, p.z - tz)
      if (d < best) best = d
    }
    return best
  }

  const seen = walk.treasures.map((v) => ({ ...v, d: nearest(v.x, v.z) }))
  const hidden = seen.filter((v) => v.d > t.cameraViewSize)
  console.log('')
  for (const v of seen) {
    const ok = v.d <= t.cameraViewSize
    console.log(
      `    ${ok ? '·' : '⚠️'} (${Math.round(v.x)}, ${Math.round(v.z)})` +
        `  동선까지 ${v.d.toFixed(1)}m ${ok ? '' : `— 시야 ${t.cameraViewSize}m 밖`}`,
    )
  }
  console.log('')
  check(
    hidden.length === 0,
    '모든 보물이 주 동선에서 한 번은 화면에 뜬다 (빛기둥이 발을 돌릴 수 있다)',
    hidden.length === 0
      ? `가장 먼 것이 ${Math.max(...seen.map((v) => v.d)).toFixed(1)}m`
      : `${hidden.length}개가 동선에서 시야 밖 — 최대 ${Math.max(...hidden.map((v) => v.d)).toFixed(1)}m`,
  )

  /**
   * 두 번째 검사: **너무 가까워도** 곤란합니다.
   *
   * 동선 위에 놓인 보물은 숨긴 것이 아니라 주운 것입니다. 갈까 말까가
   * 선택이 되려면 **몇 걸음이라도 벗어나야** 합니다. 위 검사와 짝이라서
   * 둘 다 있어야 "숨겼다"가 성립합니다 — 하나만 두면 보물을 전부 길
   * 한복판에 놓아도 통과합니다.
   */
  const ONPATH = 4
  const tooClose = seen.filter((v) => v.d < ONPATH)
  check(
    tooClose.length < seen.length,
    `보물이 전부 길 위에 있지는 않다 (${ONPATH}m 이내는 '숨긴 것'이 아님)`,
    `길 위 ${tooClose.length}개 / 전체 ${seen.length}개`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
