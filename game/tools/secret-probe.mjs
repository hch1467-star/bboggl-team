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
import { DETOUR_BUDGET } from './policy.mjs'

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
   * ⚠️ **적을 지우면 안 됩니다.** 처음엔 `clearEnemies()` 로 치웠습니다 —
   *    "재려는 건 길이지 전투가 아니니까". 그런데 목표를 정하는 규칙이
   *    이렇습니다(main.ts findObjective):
   *
   *        보스가 살아 있으면 → "수문장 처치"
   *        보스를 잡았으면    → "남은 보물"
   *
   *    적을 지우면 **보스도 사라지므로** 첫 목표부터 보물이 됩니다. 그러면
   *    제가 그린 "주 동선"이 이미 **보물 쪽으로 걸어간 선**이 되어, 재려던
   *    거리(보물이 동선에서 얼마나 떨어졌나)가 저절로 작아집니다.
   *    실제로 첫 판에서 마지막 목표가 "남은 보물"로 찍혀 있었는데,
   *    그게 이 실수의 흔적이었습니다.
   *
   *    그래서 지우지 않고 **얼리기만** 합니다. 보스가 살아 있으니 목표는
   *    보스이고, 얼어 있으니 밀리거나 맞아서 경로가 흔들리지 않습니다.
   */
  const walk = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    G.reset()
    await sleep()
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

  /**
   * 보물에서 동선까지 — **두 가지로** 잽니다.
   *
   * ── 직선거리로만 재다가 네 번째로 데였습니다 ────────────────────
   * 여기 원래 `Math.hypot` 하나였습니다. 그래서 이 프로브는 다섯 보물이
   * 전부 *"동선에서 17~18m"* 라고 **통과**시켜 왔습니다. 그런데 같은 날
   * 벤치 4판은 이렇게 찍었습니다:
   *
   *   (41,−7)  4/4판 못 주움 · 가장 가까이 간 거리 **57~104m**
   *   (33,−15) 4/4판 못 주움 · **68~112m**
   *
   * 둘 다 맞습니다. **눈으로는 18m 지만 발로는 57m** 입니다 — 사이에
   * 벽이 있으면 돌아가야 하니까요. 이 저장소가 직선거리로 데인 것이
   * 이번이 네 번째입니다(적 어그로 · 화톳불 막힘 · 소비처 고르기).
   * 그때마다 주석을 적었는데 **새로 쓴 프로브에서 되살아났습니다.**
   *
   *   · 직선거리 → **"보이는가"** 를 묻는 데는 맞습니다(빛기둥은 벽을 뚫고
   *     보입니다). 그래서 시야 검사에는 그대로 씁니다.
   *   · **걸어야 하는 거리** → "갈 만한가"를 묻는 유일한 자입니다.
   *     길찾기는 게임이 합니다(`distancesToward`).
   */
  const nearest = (tx, tz) => {
    let best = Infinity
    for (const p of trail) {
      const d = Math.hypot(p.x - tx, p.z - tz)
      if (d < best) best = d
    }
    return best
  }

  /** 동선의 각 걸음에서 그 보물까지 **걸어야 하는 거리** 중 가장 짧은 것. */
  const walkNear = async (tx, tz) => {
    const r = await page.evaluate(
      ([x, z, pts]) => window.__game.distancesToward(x, z, pts),
      [tx, tz, trail.map((p) => ({ x: p.x, z: p.z }))],
    )
    if (!r || !Array.isArray(r.points)) return -1
    const ok = r.points.filter((v) => v >= 0)
    return ok.length ? Math.min(...ok) : -1
  }

  const seen = []
  for (const v of walk.treasures) {
    seen.push({ ...v, d: nearest(v.x, v.z), walk: await walkNear(v.x, v.z) })
  }
  const hidden = seen.filter((v) => v.d > t.cameraViewSize)
  console.log('')
  for (const v of seen) {
    const ok = v.d <= t.cameraViewSize
    console.log(
      `    ${ok ? '·' : '⚠️'} (${Math.round(v.x)}, ${Math.round(v.z)})` +
        `  눈으로 ${v.d.toFixed(1)}m · **발로 ${v.walk < 0 ? '?' : `${v.walk.toFixed(0)}m`}**` +
        `${ok ? '' : ` — 시야 ${t.cameraViewSize}m 밖`}`,
    )
  }
  /**
   * ---- **걸어서 갈 만한가** ----
   *
   * 위 검사는 *"보이는가"* 를 묻습니다(빛기둥은 벽을 뚫고 보이므로 직선거리가
   * 맞습니다). 그런데 보인다고 갈 수 있는 것은 아닙니다. 봇은 곁길을
   * **걸어야 하는 거리**로 자르고(`DETOUR_BUDGET`), 그 예산을 넘는 보물은
   * 규칙상 **영영 안 갑니다.** 실제로 벤치 4판에서 두 보물이 4/4판 미획득
   * 이었고, 이 프로브는 같은 보물들을 "동선에서 18m"라며 통과시키고
   * 있었습니다 — 눈으로 18m, 발로 48m.
   *
   * ⚠️ 예산은 봇에서 **읽어 옵니다.** 여기 40을 적으면 예산을 바꾸는 날
   *    이 검사만 옛 값으로 통과합니다.
   */
  const far = seen.filter((v) => v.walk < 0 || v.walk > DETOUR_BUDGET)
  check(
    far.length === 0,
    `모든 보물이 **걸어서** 곁길 예산 안에 있다 (${DETOUR_BUDGET}m)`,
    far.length === 0
      ? `가장 먼 것이 발로 ${Math.max(...seen.map((v) => v.walk)).toFixed(0)}m`
      : far
          .map((v) => `(${Math.round(v.x)}, ${Math.round(v.z)}) 발로 ${v.walk.toFixed(0)}m`)
          .join(' · '),
  )

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
  fail++
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
