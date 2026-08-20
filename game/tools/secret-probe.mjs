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
      /** 존의 실제 크기 — 동선의 폭이 "넓은 존을 얼마나 쓰는가"로 읽히게. */
      zone: (() => {
        const t = G.terrainInfo()
        return t.zoneWidth > 0 ? { w: Math.round(t.zoneWidth), h: Math.round(t.zoneDepth) } : null
      })(),
      treasures: G.treasurePositions().map((v) => ({ x: v.x, z: v.z })),
    }
  })

  /**
   * ── 📍 **2026-08 측정: 이 검사가 빨간 진짜 이유** ──────────────────
   *
   * 「보물이 멀다」로 읽고 자리를 옮기려다, 먼저 재 보고 생각이 바뀌었습니다.
   *
   * ① **주 동선은 z = 1 보다 북쪽으로 한 번도 안 갑니다**(동선 범위
   *    x −61~67 · z 1~35). 즉 지도의 북쪽 절반이 통째로 곁길입니다.
   * ② 그 곁길의 깊이별 **걸어야 하는 거리**(실측):
   *        z −13 → 14m   z −21 → 22m   z −29 → 30m
   *        z −37 → 38m   z −45 → 46m
   *    곁길 예산 40m 는 z −37 까지, 카메라가 담는 22m 는 z −21 까지입니다.
   * ③ 문제의 보물 둘은 z −43 · −57 — **둘 다 그 밖**입니다.
   * ④ 그런데 그 깊은 북쪽(「북쪽 단상」 z −57~−37)은 **빈 땅이 아닙니다**:
   *    지름길 사다리(25,−35) · 달려드는 자 · 잡몹 둘 · 보물 둘이 있습니다.
   *    이 존을 원으로 만드는 장치가 바로 거기 있습니다.
   *
   * 그래서 처방이 뒤집힙니다. 보물을 앞으로 끌어내면 **곁길의 보상만
   * 입구에 놓고 안쪽을 비우는** 셈이고, 사다리는 여전히 깊은 곳에
   * 남습니다. 진짜로 빠진 것은 거리가 아니라 **"저기 뭔가 있다"를
   * 길 위에서 알 방법**입니다 — 카메라가 22m 까지만 담으니 빛기둥도
   * 그 밖에서는 안 보입니다.
   *
   * 엘든 링·NRFTW 가 이걸 푸는 방법은 보물을 옮기는 것이 아니라
   * **곁길 입구를 읽히게** 만드는 것입니다(멀리서도 보이는 구조물·빛).
   * 다음에 손댈 곳은 그쪽이고, 이 검사는 그때까지 빨간 채로 둡니다 —
   * 잘못된 처방(자리 옮기기)으로 초록을 만들지 않기 위해서입니다.
   */
  const trail = walk.trail
  check(
    trail.length > 20,
    '주 동선을 그렸다 (게임의 길찾기를 따라간 자취)',
    `${trail.length}걸음 · 마지막 목표 "${walk.goal?.label ?? '?'}"`,
  )

  /**
   * ── 📐 **동선이 실제로 얼마나 휘는가** ────────────────────────────
   *
   * 아래 검사들은 *"보물이 동선에서 멀다"* 고 말합니다. 그런데 그건 결과일
   * 뿐이고, 원인은 **동선의 모양**일 수 있습니다. 존은 가로세로가 다 넓은데
   * 길이 한 줄로 곧게 나 있으면, 보물을 어디에 놓아도 수직으로 멀어집니다.
   *
   * 엘든 링·NRFTW·오공이 비밀을 보이게 만드는 방식은 보물을 길가로 끌어
   * 내는 것이 **아니라 길이 그쪽으로 휘는 것**입니다. 그러니 고칠 곳이
   * 배치인지 지형인지 가르려면 **길의 폭**을 봐야 합니다.
   *
   * ⚠️ 아직 **검사가 아니라 눈금**입니다. "얼마나 휘어야 충분한가"를
   *    아직 재 본 적이 없어서, 지금 문턱을 정하면 그건 측정이 아니라
   *    제 취향입니다. 먼저 값을 보이게 두고, 근거가 생기면 검사로 올립니다.
   */
  {
    const xs = trail.map((p) => p.x)
    const zs = trail.map((p) => p.z)
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanZ = Math.max(...zs) - Math.min(...zs)
    console.log(
      `  📐 동선의 폭 — 가로 ${spanX.toFixed(0)}m · **세로 ${spanZ.toFixed(0)}m**` +
        ` (존은 ${walk.zone ? `${walk.zone.w}×${walk.zone.h}m` : '?'} · 카메라 22m)`,
    )
  }

  /**
   * ── 🗺 **동선에서 구역까지** — 보물이 아니라 **장소**를 잽니다 ────────
   *
   * 지금까지 이 프로브는 **보물까지의 거리**만 쟀습니다. 그런데 벤치가
   * 매번 이렇게 찍고 있었습니다:
   *
   *     북쪽 단상   머문 14초 · 처치 2마리 **(1/3판)**
   *     성벽마루    머문 15초 · 처치 2마리 **(1/3판)**
   *
   * 세 판 중 한 판만 갑니다. 그게 **안 가는 것**인지 **못 가는 것**인지
   * 아무도 몰랐습니다 — 둘은 고칠 곳이 완전히 다릅니다(유인 vs 배치).
   *
   * 그리고 문제가 보물 하나가 아니라 **구역 하나**일 수 있습니다. 보물만
   * 재면 "저 보물이 멀다"까지만 보이고, 정작 *"저 장소 전체가 예산 밖이라
   * 사다리도 적도 같이 못 쓰인다"* 는 안 보입니다. 실제로 그 깊은 북쪽에는
   * 지름길 사다리와 적 셋이 함께 있습니다.
   *
   * 그래서 구역마다 **동선에서 걸어야 하는 거리**를 잽니다. 길찾기는
   * 게임이 합니다(`distancesToward`) — 프로브가 지형을 다시 판정하면
   * 그 판정이 두 곳에 살게 됩니다.
   *
   * ⚠️ 아직 **검사가 아니라 눈금**입니다. "구역이 예산 안에 있어야 한다"는
   *    아직 이 저장소가 정한 규칙이 아닙니다(예산은 보물을 두고 정했습니다).
   *    문턱을 여기서 지어내면 그건 측정이 아니라 제 취향입니다. 먼저
   *    보이게 두고, 규칙이 정해지면 검사로 올립니다.
   */
  {
    const regions = await page.evaluate(() => window.__game.regionList())
    const rows = []
    for (const r of regions) {
      const d = await page.evaluate(
        ([x, z, pts]) => window.__game.distancesToward(x, z, pts),
        [r.x, r.z, trail.map((p) => ({ x: p.x, z: p.z }))],
      )
      const reach = (d?.points ?? []).filter((v) => Number.isFinite(v))
      rows.push({ name: r.name, walk: reach.length ? Math.min(...reach) : Infinity })
    }
    rows.sort((a, b) => b.walk - a.walk)
    console.log(`\n  🗺 동선에서 구역까지 — **걸어야 하는 거리** (곁길 예산 ${DETOUR_BUDGET}m)`)
    for (const r of rows) {
      const far = !Number.isFinite(r.walk) || r.walk > DETOUR_BUDGET
      console.log(
        `    ${far ? '⚠️' : '  '} ${r.name.padEnd(9)} ${
          Number.isFinite(r.walk) ? `${r.walk.toFixed(0)}m` : '닿을 수 없음'
        }${far ? '  ← 예산 밖' : ''}`,
      )
    }
    const over = rows.filter((r) => !Number.isFinite(r.walk) || r.walk > DETOUR_BUDGET)
    console.log(
      `    → 예산 밖 구역 ${over.length}/${rows.length}곳` +
        (over.length ? ` — ${over.map((r) => r.name).join(' · ')}` : ''),
    )
    console.log('')
  }

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

  /**
   * ── 🧭 **곁길의 값은 "가는 거리"가 아니라 "더 걷는 거리"입니다** ─────
   *
   * ── 이 자가 정확히 반대로 말하고 있었습니다 ──────────────────────
   * 위 `walkNear` 는 **동선에서 보물까지의 편도**를 잽니다. 그 자로는
   * 이 존의 「남쪽 함몰지」를 읽을 수가 없습니다 — 거긴 **2단 낙하로
   * 내려가면 못 올라오고, 대신 복귀 램프가 계단으로 이어지는** 곳입니다
   * (생성기가 일부러 그렇게 만들었습니다). 즉 들어갔다 나오는 길이
   * **원래 가던 길과 거의 같습니다.**
   *
   * 두 자로 같은 다섯 보물을 재면 순위가 통째로 뒤집힙니다:
   *
   *                    편도(옛 자)      더 걷는 거리(이 자)
   *     (13, 47)        46m ❌ 예산 밖      **20m** ✅  ← 가장 싼 축
   *     (17,-57)        32m ✅             **56m** ❌  ← 유일하게 예산 밖
   *     (-27, 19)       18m               32m
   *     (27,-43)        14m               28m
   *     (25,-19)         4m                8m
   *
   * 빨갛던 것이 실은 가장 싼 곁길이었고, 초록이던 것이 유일한 문제였습니다.
   * 이 자로 빨간 것을 보고 지도를 고쳤다면 **잘 만들어진 구조를 부수고**
   * 진짜 문제는 그대로 뒀을 것입니다.
   *
   *     더 걷는 거리 = (스폰→보물) + (보물→보스) − (스폰→보스)
   *
   * 세 값 다 게임의 통행 규칙으로 잰 거리라, 편도 낙하도 지름길도 저절로
   * 반영됩니다. 곁길이 "가는 길에 있으면" 0 에 가깝게 나옵니다 — 그게
   * 엘든 링·오공이 비밀을 배치하는 방식이고, 이 자는 그걸 읽을 수 있습니다.
   */
  const detour = async (tx, tz) => {
    const r = await page.evaluate(
      ([x, z, s, bx, bz]) => {
        const G = window.__game
        const toBoss = G.distancesToward(bx, bz, [s, { x, z }])
        const toT = G.distancesToward(x, z, [s])
        if (!toBoss || !toT) return null
        return { sb: toBoss.points[0], tb: toBoss.points[1], st: toT.points[0] }
      },
      // 끝점은 **동선의 마지막 걸음**입니다 — 보스 좌표를 따로 묻지 않는 이유는
      // 이 자취가 곧 "이 게임이 실제로 걷게 하는 길"이기 때문입니다.
      [tx, tz, { x: trail[0].x, z: trail[0].z }, trail[trail.length - 1].x, trail[trail.length - 1].z],
    )
    /**
     * ⚠️ **못 가는 것은 `null` 로 답합니다 — 예전엔 −1 이었습니다.**
     *
     * 길안내에 「되돌아올 수 없는 길」의 값이 생기면서(format.ts
     * `ONE_WAY_COST`) **음수 우회가 가능해졌습니다.** 안내는 *값*으로
     * 고르고 거리는 *걸음*으로 재니, *"안내받은 길보다 돌아가는 쪽이
     * 실제로는 더 짧다"* 가 성립합니다 — 구덩이로 뛰어내리면 미터는
     * 줄지만 되돌아올 수 없으니 안내가 안 권하는 경우입니다.
     *
     * 그래서 −1 을 「못 감」의 표시로 쓸 수 없게 됐습니다. 실제로 폭발통
     * (45,−9) 가 **−8m** 로 나와 「예산 밖」으로 잘못 찍혔습니다.
     * 못 가는 것과 음수는 **다른 사실**이므로 다른 값으로 답합니다.
     */
    if (!r || ![r.sb, r.tb, r.st].every((v) => Number.isFinite(v) && v >= 0)) return null
    return r.st + r.tb - r.sb
  }

  const seen = []
  for (const v of walk.treasures) {
    seen.push({
      ...v,
      d: nearest(v.x, v.z),
      walk: await walkNear(v.x, v.z),
      extra: await detour(v.x, v.z),
    })
  }
  /**
   * ── 💥 **놓아 둔 것을 아무도 안 만나면 없는 것과 같습니다** ────────────
   *
   * 자동 플레이가 판마다 같은 말을 합니다:
   *
   *     통(17,-9) — 가장 가까이 24.2m · 사거리 안 0프레임 — **곁에 간 적이 없다**
   *     통(45,-9) — 가장 가까이 20.7m · 사거리 안 0프레임 — **곁에 간 적이 없다**
   *
   * 셋 중 둘입니다. 그런데 통 (45,-9) 는 **적 넷 한가운데**에 잘 놓여
   * 있습니다 — 자리가 나쁜 게 아니라 동선이 거기 안 갑니다. 보물에 쓰던
   * 자를 그대로 대 보면 그 둘이 갈립니다.
   *
   * ── 재고 나서 **가설이 뒤집혔습니다** ─────────────────────────
   *
   *     (-31, 1)  눈으로 0.0m · 더 걷는 0m
   *     (17, -9)  눈으로 4.0m · 더 걷는 0m
   *     (45, -9)  눈으로 0.0m · 더 걷는 0m
   *
   * **셋 다 동선 위입니다.** (45,-9) 는 동선이 그대로 지나가고 (17,-9) 는
   * 4m 옆입니다. 즉 「곁에 간 적이 없다」는 **자리의 이야기가 아니라
   * 봇의 이야기**입니다 — 옆을 지나면서 안 씁니다. 재기 전에 옮겼으면
   * 멀쩡한 배치를 망가뜨리고 "고쳤다"고 적었을 자리입니다.
   *
   * 그래서 이것을 **검사로 올립니다.** 지금 초록인 성질이고, 다음에 지도를
   * 손볼 때 통이 동선에서 떨어져 나가면 그때 빨개져야 합니다. 예산은
   * 게임이 내보내는 값을 그대로 씁니다(프로브가 문턱을 안 짓습니다).
   *
   * ⚠️ **통을 「쓰는가」는 여기서 안 묻습니다.** 그건 봇 정책이고
   *    `playthrough` 의 통 장부가 이미 프레임 단위로 셉니다.
   */
  {
    const barrels = await page.evaluate(() => window.__game.barrelInfo().barrels ?? [])
    if (barrels.length > 0) {
      console.log('\n  💥 폭발통 — 동선에서 얼마나 떨어져 있는가')
      const barrelFar = []
      for (const b of barrels) {
        const d = nearest(b.x, b.z)
        const ex = await detour(b.x, b.z)
        if (ex === null || ex > DETOUR_BUDGET) barrelFar.push(`(${Math.round(b.x)},${Math.round(b.z)}) ${ex === null ? '못 감' : `${ex}m`}`)
        console.log(
          `    ${d <= t.cameraViewSize ? '·' : '⚠️'} (${Math.round(b.x)}, ${Math.round(b.z)})` +
            `  눈으로 ${d.toFixed(1)}m · **더 걷는 ${ex === null ? '못 감' : `${ex.toFixed(0)}m`}**` +
            `${d <= t.cameraViewSize ? '' : ` — 시야 ${t.cameraViewSize}m 밖`}`,
        )
      }
      check(
        barrelFar.length === 0,
        `💥 **폭발통이 전부 곁길 예산(${DETOUR_BUDGET}m) 안에 있다** (놓아 두고 아무도 안 만나면 없는 것과 같습니다)`,
        barrelFar.length ? `예산 밖 ${barrelFar.join(' · ')}` : `${barrels.length}개 전부`,
      )
    }
  }

  const hidden = seen.filter((v) => v.d > t.cameraViewSize)
  console.log('')
  for (const v of seen) {
    const ok = v.d <= t.cameraViewSize
    console.log(
      `    ${ok ? '·' : '⚠️'} (${Math.round(v.x)}, ${Math.round(v.z)})` +
        `  눈으로 ${v.d.toFixed(1)}m · 발로 ${v.walk < 0 ? '?' : `${v.walk.toFixed(0)}m`}` +
        ` · **더 걷는 ${v.extra === null ? '못 감' : `${v.extra.toFixed(0)}m`}**` +
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
  const far = seen.filter((v) => v.extra === null || v.extra > DETOUR_BUDGET)
  check(
    seen.length > 0 && far.length === 0,
    `모든 보물이 곁길 예산 안에 있다 — **원래 길보다 더 걷는 거리**로 (${DETOUR_BUDGET}m)`,
    far.length === 0
      ? `가장 비싼 것이 더 걷는 ${Math.max(...seen.map((v) => v.extra)).toFixed(0)}m`
      : far
          .map((v) => `(${Math.round(v.x)}, ${Math.round(v.z)}) 더 걷는 ${v.extra.toFixed(0)}m`)
          .join(' · '),
  )

  console.log('')
  /**
   * ── 📻 **빛기둥은 「알 방법」의 하나이지 전부가 아닙니다** ──────────
   *
   * 이 줄은 오랫동안 **판정**이었습니다: *"모든 보물이 한 번은 화면에
   * 뜬다."* 그런데 그 뒤에 **곁길 알림**(안내 줄)이 생겼고, 그건 정확히
   * *"안 보이는 보물을 알려 주기 위한"* 통로입니다. 그래서 지금 둘을 다
   * 판정으로 두면 **모든 보물에 두 통로를 다 요구**하게 됩니다.
   *
   * 이 파일 맨 위가 묻고 싶은 것은 하나입니다 —
   * *"갈까 말까가 선택이 되려면 **갈 곳이 있다는 걸 알아야** 한다."*
   * 빛기둥이든 안내든, 알면 선택이 성립합니다. 참조한 게임들도 통로를
   * 하나로 강요하지 않습니다:
   *   · **오공** — 주 동선에서 뭔가 **보이게** 두어 발을 돌리게 합니다
   *   · **엘든 링** — 안내가 없고 **빛/실루엣**만으로 알립니다
   *   · **젤다 BotW** — 눈에 안 띄는 것은 **센서가 소리로** 알립니다
   *   · **호라이즌** — 포커스가 범위 안을 **한꺼번에** 띄웁니다
   * 공통점은 「채널이 여럿이고, 하나면 족하다」입니다.
   *
   * 그래서 채널별 숫자는 **눈금으로** 남기고, 판정은 아래 「알 방법이
   * 하나는 있다」 하나로 모읍니다. 눈금을 지우지는 않습니다 — 어느
   * 통로가 약한지는 고칠 때 알아야 하고, 실제로 이 두 숫자가 **서로 다른
   * 보물**을 가리키고 있었습니다(빛기둥 없는 것 2개, 안내 없는 것 2개,
   * 그런데 겹치는 것은 **1개**).
   */
  console.log(
    `  [빛기둥] 동선에서 시야(${t.cameraViewSize}m) 안 ${seen.length - hidden.length}/${seen.length}개` +
      (hidden.length
        ? ` · 밖 ${hidden.map((v) => `(${Math.round(v.x)},${Math.round(v.z)}) ${v.d.toFixed(1)}m`).join(' · ')}`
        : '') +
      '  ※ 재되 걸지 않습니다(위 주석)',
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

  /**
   * ── 🧭 **곁길이 있다는 것을 길 위에서 알 수 있는가** ─────────────────
   *
   * 위 검사들이 말하는 것은 *"보물이 멀고 안 보인다"* 입니다. 그런데 그
   * 깊은 북쪽에는 지름길 사다리와 적 셋이 함께 있어서, 보물만 앞으로
   * 끌어내는 것은 **곁길의 보상만 입구에 놓고 안쪽을 비우는** 처방이었습니다.
   *
   * 그래서 지도가 아니라 **알림**을 고쳤습니다(balance.ts `NAV`). 여기서는
   * 그 알림이 실제로 화면에 도달하는지 봅니다 — 규칙이 아니라 HUD 가 받은
   * 문자열 그대로입니다.
   */
  const hint = await page.evaluate(async ([tx, tz]) => {
    const G = window.__game
    const sleep2 = () => new Promise((r) => setTimeout(r, 8))
    const runFor = async (s2) => {
      const t = G.state().elapsed + s2
      while (G.state().elapsed < t) await sleep2()
    }
    G.reset()
    await runFor(0.4)
    const rule = G.sideHint()
    // ① 시작 지점 — 보물이 저 멀리 있으니 알림이 없어야 정상입니다.
    const far = G.sideHint().text
    /**
     * ② **조건에 맞는 자리를 프로브가 고릅니다.**
     *
     * 처음엔 (17,−21) 을 손으로 찍었는데 거기서는 알림이 안 떴습니다.
     * 다른 보물이 **8m 앞**이라 「눈앞이면 안 알려 준다」 규칙에 걸린
     * 것이었습니다 — 게임은 규칙대로였고 **자리를 잘못 골랐습니다.**
     * 그래서 보물 둘레를 훑어 *"가장 가까운 보물이 눈앞보다는 멀고
     * 예산 안"* 인 자리를 찾습니다. 자리를 손으로 찍지 않는 편이
     * 지도를 고치는 날에도 검사가 따라옵니다.
     */
    const spots = G.treasurePositions().filter((t) => !t.taken)
    let near = ''
    let at = null
    outer: for (const t of spots) {
      for (const r of [26, 32, 38]) {
        for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const x = t.x + Math.cos((a / 8) * Math.PI * 2) * r
          const z = t.z + Math.sin((a / 8) * Math.PI * 2) * r
          G.teleportPlayer(x, z)
          await runFor(0.25)
          const here = G.state().player
          if (Math.hypot(here.x - x, here.z - z) > 3) continue // 못 서는 칸
          const txt = G.sideHint().text
          if (txt) {
            near = txt
            at = { x: Math.round(here.x), z: Math.round(here.z) }
            break outer
          }
        }
      }
    }
    return { rule, far, near, at }
  }, [0, 0])
  check(
    hint.rule.range > 0 && hint.rule.near > 0,
    '곁길 알림의 규칙값을 게임에서 읽었다 (프로브가 문턱을 안 베낍니다)',
    `예산 ${hint.rule.range}m · 눈앞 ${hint.rule.near}m`,
  )
  check(
    hint.far === '',
    '멀면 **안 알려 준다** (갈 수 없는 것을 알려 주는 것은 놀리는 것입니다)',
    `시작 지점에서 "${hint.far}"`,
  )
  /**
   * ── 🧭 **주 동선을 걷는 동안 실제로 뜨는가** ──────────────────────
   *
   * 위 검사는 *"조건이 맞으면 뜬다"* 까지입니다. 그건 규칙이 도는지를
   * 말할 뿐, **플레이어가 그 알림을 보게 되는지**는 말하지 않습니다.
   * 이 저장소가 반복해서 배운 것 그대로입니다 — 규칙이 아니라 **도달한
   * 것**을 봅니다. 그래서 동선을 그대로 따라 걸으며 알림을 모읍니다.
   *
   * 여기가 빨간 채로 남으면 처방은 둘 중 하나입니다: 알림 반경을 넓히거나
   * (그러면 갈 수 없는 것을 알려 주게 됩니다), **동선이 곁길 입구를
   * 스치게** 지도를 고치거나. 어느 쪽인지는 이 숫자가 정합니다.
   */
  const along = await page.evaluate(async () => {
    const G = window.__game
    const sleep2 = () => new Promise((r) => setTimeout(r, 8))
    G.reset()
    await sleep2()
    G.freezeEnemies(true)
    await sleep2()
    const seen = new Set()
    let guard = 0
    /**
     * ⚠️ **걸음마다 시간을 흘려 줍니다.**
     *
     * 알림은 0.75초에 한 번만 다시 계산됩니다(main.ts — 매 프레임 흐름장을
     * 만들었다가 프레임을 느리게 만들어 출혈 검사를 깨뜨린 적이 있습니다).
     * 그런데 이 순회는 순간이동이라 시뮬레이션 시간이 거의 안 흐릅니다.
     * 그대로 두면 96걸음 동안 알림이 서너 번만 갱신되고, 그러면 이 검사는
     * 게임이 아니라 **제 스로틀**을 재게 됩니다.
     */
    const settle = async () => {
      const t = G.state().elapsed + 0.85
      while (G.state().elapsed < t) await sleep2()
    }
    while (guard++ < 4000) {
      const obj = G.objective()
      if (!obj) break
      // ⚠️ 네 걸음에 한 번만 시간을 흘립니다 — 96걸음마다 0.85초씩 주면
      //    이 검사 하나가 시뮬레이션 80초를 먹고, 느린 기계에서는 끝나질
      //    않습니다(실제로 한 번 멈춰 세웠습니다). 알림은 걸음이 아니라
      //    **자리**에 달린 값이라 몇 걸음 건너뛰어도 답이 같습니다.
      if (guard % 4 === 0) await settle()
      const h = G.sideHint()
      if (h.text && h.at) seen.add(`${Math.round(h.at.x)},${Math.round(h.at.z)}`)
      if (obj.walkDist <= 1.5) {
        G.teleportPlayer(obj.x, obj.z)
        await sleep2()
        const next = G.objective()
        if (!next || (Math.abs(next.x - obj.x) < 0.01 && Math.abs(next.z - obj.z) < 0.01)) break
        continue
      }
      const step = G.pathStep(obj.x, obj.z)
      if (!step) break
      G.teleportPlayer(step.x, step.z)
      await sleep2()
    }
    G.freezeEnemies(false)
    return { told: [...seen], total: G.treasurePositions().length }
  })
  /**
   * ⚠️ *"한 번이라도 떴는가"* 로 물으면 **헐겁습니다.** 처음 그렇게 물었더니
   *    남동쪽 하나가 떠서 초록이었고, 정작 문제인 북쪽 둘은 그대로 묻혀
   *    있었습니다. 이 저장소가 빈 표본으로 다섯 번 데인 것과 같은 모양입니다 —
   *    **몇 개가 알려지는가**로 물어야 합니다.
   */
  /**
   * ⚠️ **"모든 보물"이 아니라 "예산 안의 보물"입니다.**
   *
   * 게임은 곁길 예산(더 걷는 거리)을 넘는 보물을 **일부러 안 알려 줍니다** —
   * 봇이 규칙상 안 가는 자리를 사람에게만 권하면, balance.ts 가 적어 둔
   * *"사람에게는 권하고 계측기는 안 가는 틈"* 이 다시 열립니다. 그러니
   * 그런 보물이 안 알려지는 것은 **실패가 아니라 규칙이 지켜진 것**입니다.
   * 예산 밖까지 세면 이 검사는 게임에게 규칙을 어기라고 요구하게 됩니다.
   */
  const inBudget = seen.filter((v) => v.extra !== null && v.extra <= DETOUR_BUDGET)
  const budgetKeys = new Set(inBudget.map((v) => `${Math.round(v.x)},${Math.round(v.z)}`))
  const toldInBudget = along.told.filter((k) => budgetKeys.has(k))
  console.log(
    `  [안내] 예산 안의 보물 중 걷는 동안 알려진 것 ${toldInBudget.length}/${inBudget.length}개` +
      ` — ${toldInBudget.join(' · ') || '없음'}` +
      ` · 예산 밖이라 안 알려 준 것 ${seen.length - inBudget.length}개  ※ 재되 걸지 않습니다`,
  )
  /**
   * ── 🔦 **알 방법이 하나는 있는가 — 이 파일의 판정** ─────────────────
   *
   * 위 두 눈금(빛기둥·안내)을 **또는**으로 묶습니다. 근거는 바로 위
   * 주석과 이 파일 맨 위의 설계 의도입니다.
   *
   * ⚠️ **문턱을 낮춘 것이 아니라 질문을 고친 것입니다.** 확인하는 방법:
   *    묶고 나서도 이 판정은 **빨갛습니다.** 두 눈금이 서로 다른 보물을
   *    가리키고 있었고, 통로가 **하나도 없는** 보물이 정확히 하나
   *    있기 때문입니다. 묶어서 초록이 됐다면 그건 문턱을 낮춘 것입니다.
   *
   * ⚠️ 예산 밖 보물은 뺍니다 — 게임이 **일부러 안 알려 주는** 것이라
   *    (바로 위 주석) 여기서 세면 규칙을 어기라고 요구하게 됩니다.
   */
  const toldSet = new Set(along.told)
  const dark = inBudget.filter(
    (v) => v.d > t.cameraViewSize && !toldSet.has(`${Math.round(v.x)},${Math.round(v.z)}`),
  )
  check(
    inBudget.length > 0 && dark.length === 0,
    '🔦 **보물마다 알 방법이 하나는 있다** (빛기둥이 보이거나 · 안내가 가리키거나)',
    dark.length === 0
      ? `예산 안 ${inBudget.length}개 전부 — 빛기둥 ${inBudget.filter((v) => v.d <= t.cameraViewSize).length}개 · 안내 ${toldInBudget.length}개`
      : dark
          .map((v) => {
            /**
             * 🔎 **어느 문에서 막혔는지까지 댑니다.** 빨간불을 보고 다음에
             *    할 일이 *"보물을 옮긴다"* 인지 *"안내 규칙을 본다"* 인지가
             *    여기서 갈립니다. 이 저장소가 계속 배운 것 —
             *    숫자가 처방이 되려면 **분기 그대로** 갈라 놔야 합니다.
             */
            const why = []
            if (v.d > t.cameraViewSize) why.push(`빛기둥 — 눈으로 ${v.d.toFixed(1)}m > 시야 ${t.cameraViewSize}m`)
            const walkFar = v.walk === null || v.walk > hint.rule.range
            const extraFar = v.extra === null || v.extra > hint.rule.range
            if (walkFar)
              why.push(
                `안내 — **편도 ${v.walk === null ? '못 감' : `${v.walk.toFixed(0)}m`} > ${hint.rule.range}m**` +
                  (extraFar ? '' : ` (더 걷는 ${v.extra.toFixed(0)}m 는 예산 안인데도)`),
              )
            else if (extraFar) why.push(`안내 — 더 걷는 ${v.extra.toFixed(0)}m > ${hint.rule.range}m`)
            else why.push('안내 — 문턱은 통과하는데 다른 보물에 밀림')
            return `(${Math.round(v.x)},${Math.round(v.z)}) ${why.join(' · ')}`
          })
          .join('\n       ') + '\n       → **둘 다 없습니다**',
  )

  check(
    hint.near.includes('보물'),
    '🧭 **곁길 예산 안에 들면 알려 준다** (길 위에서 "저쪽에 있다"를 알 수 있게)',
    `"${hint.near}" (선 자리 ${hint.at ? `${hint.at.x},${hint.at.z}` : '못 찾음'})`,
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
