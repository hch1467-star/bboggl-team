/**
 * 🧭 동선 스케치패드 — `npm run route`
 *
 * ── 왜 만들었는가 ──────────────────────────────────────────────────
 * 「동선을 북쪽으로 휘게 한다」는 처방을 실제로 해 보려니, 한 번 지형을
 * 만져 보는 데 **8분**이 들었습니다(`npm run zone` → `npm run secret`).
 * 지형은 한 칸만 바꿔도 길이 통째로 넘어가는 물건이라, 그 속도로는
 * 두세 번 시도하고 지칩니다. 실제로 한 회차 동안 **세 번**밖에 못 재
 * 봤고, 그 세 번이 전부 서로 다른 곳을 가리켰습니다.
 *
 * 이 파일은 같은 질문에 **0.2초**로 답합니다. 하는 일은 셋뿐입니다:
 *   ① spawn → boss 최단 거리 (= 이 지도가 강요하는 길의 길이)
 *   ② 최단 경로 위의 칸들을 모아 「동선」으로 보고, 보물마다
 *      **더 걷는 거리**와 **동선에서의 직선거리**를 냅니다
 *   ③ `ROUTE_EDIT` 로 지형을 가상으로 고쳐 ①②를 다시 냅니다
 *
 * ── ⚠️ **이것은 검사가 아닙니다. 스케치입니다.** ──────────────────
 * 이 파일은 지형 규칙(`MAX_CLIMB`, VOID)을 **베껴 씁니다.** 이 저장소가
 * 가장 싫어하는 짓이고, 그래서 **검사로 쓰지 않습니다** — `npm run guard`
 * 의 검사 목록에도 안 들어갑니다. 판정은 언제나 `npm run secret` 이
 * 합니다(게임의 길찾기를 그대로 걷습니다).
 *
 * 두 자가 갈리는 자리도 이미 압니다:
 *   · 여기의 「동선」은 **최단 경로 전부의 합집합**입니다. 두 길이 같은
 *     길이면 둘 다 동선으로 칩니다. 게임은 그중 하나만 걷습니다.
 *   · 여기의 거리는 격자 BFS(맨해튼)라 대각선이 없습니다.
 * 그래서 여기 숫자는 **방향을 고르는 데** 쓰고, 초록/빨강은 프로브에게
 * 물어야 합니다. 값이 갈리면 **프로브가 옳습니다.**
 *
 * ── 쓰는 법 ────────────────────────────────────────────────────
 *   npm run route
 *   ROUTE_EDIT='53,53,14,15,3; 54,54,14,15,4; 55,56,14,15,5' npm run route
 *     → cx0,cx1,cz0,cz1,높이 를 ; 로 이어 붙입니다. 높이 -1 은 허공.
 *
 * ── 이 도구가 첫날 답한 것 (기록) ──────────────────────────────────
 *     북쪽 계단(현재 주 동선)  194m
 *     남쪽 일방통행 고리        206m   ← 겨우 **12m** 차이
 *     북쪽 단상 경유           218m   ← 그래서 넣으면 길이 남쪽으로 넘어감
 *
 * 그리고 보물(17,−57)의 「더 걷는 56m」는 **방의 모양 탓이 아니었습니다.**
 * 보물 바로 옆(cz8~9)에 동쪽 출구를 뚫어 봐도 **56m 그대로**입니다.
 * 원인은 동선이 그 방에서 **44m 떨어져 지나간다**는 것뿐입니다.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const level = JSON.parse(readFileSync(path.join(ROOT, 'src', 'levels', 'broken-gate.json'), 'utf8'))
const W = level.w
const H = level.h
const VOID = -1
/**
 * ⚠️ 베껴 적은 값입니다(`src/level/format.ts`). 위 머리말대로 이 파일은
 *    검사가 아니라 스케치라서 허용하지만, **여기 숫자가 게임과 갈라지면
 *    이 파일의 모든 답이 조용히 틀립니다.** 그래서 첫 줄에 찍어 둡니다.
 */
const MAX_CLIMB = 1
/**
 * 🪜 되돌아올 수 없는 걸음에 얹는 값(칸). 게임과 **같아야** 합니다 —
 *    `src/level/format.ts` `ONE_WAY_COST`. 갈라지면 이 스케치가 게임과
 *    다른 길을 그립니다.
 */
const ONE_WAY_COST = 11
const CELL = 2

const wx = (cx) => (cx - W / 2 + 0.5) * CELL
const wz = (cz) => (cz - H / 2 + 0.5) * CELL
const cellOf = (x, z) => [Math.floor(x / CELL + W / 2), Math.floor(z / CELL + H / 2)]

function heights() {
  const h = level.heights.slice()
  const spec = process.env.ROUTE_EDIT
  if (!spec) return { h, edits: 0 }
  let edits = 0
  for (const part of spec.split(';')) {
    const s = part.trim()
    if (!s) continue
    const n = s.split(',').map((v) => Number(v.trim()))
    if (n.length !== 5 || n.some((v) => !Number.isFinite(v))) {
      console.error(`  ⚠️ 못 읽은 손질: "${s}" — cx0,cx1,cz0,cz1,높이 다섯 개여야 합니다`)
      continue
    }
    const [cx0, cx1, cz0, cz1, v] = n
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue
        h[cz * W + cx] = v
        edits++
      }
    }
  }
  return { h, edits }
}

/**
 * 한 칸에서 퍼져 나가는 BFS. **오르막 방향을 지킵니다** — 내려가는 것은
 * 자유지만 `MAX_CLIMB` 을 넘는 오르막은 못 갑니다. 이게 이 지도의
 * 「내려가면 못 올라온다」를 만드는 규칙이고, 남쪽 고리가 일방통행인 이유입니다.
 */
function flood(h, sx, sz) {
  const at = (cx, cz) => (cx < 0 || cz < 0 || cx >= W || cz >= H ? VOID : h[cz * W + cx])
  const cost = new Int32Array(W * H).fill(-1)
  const steps = new Int32Array(W * H).fill(-1)
  if (at(sx, sz) === VOID) return { cost, steps }
  cost[sz * W + sx] = 0
  steps[sz * W + sx] = 0
  const buckets = [[[sx, sz]]]
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d]
    if (!bucket) continue
    for (const [cx, cz] of bucket) {
      if (cost[cz * W + cx] !== d) continue
      const from = at(cx, cz)
      for (const [nx, nz] of [
        [cx - 1, cz],
        [cx + 1, cz],
        [cx, cz - 1],
        [cx, cz + 1],
      ]) {
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
        const to = at(nx, nz)
        if (to === VOID || to - from > MAX_CLIMB) continue
        // 🪜 되돌아 못 오면 값을 얹습니다 — 게임의 floodFrom 과 같은 규칙.
        const nd = d + 1 + (from - to > MAX_CLIMB ? ONE_WAY_COST : 0)
        const cur = cost[nz * W + nx]
        if (cur !== -1 && cur <= nd) continue
        cost[nz * W + nx] = nd
        steps[nz * W + nx] = steps[cz * W + cx] + 1
        ;(buckets[nd] ??= []).push([nx, nz])
      }
    }
    buckets[d] = []
  }
  return { cost, steps }
}

const { h, edits } = heights()
const ent = (kind) => level.entities.filter((e) => e.kind === kind)
const spawn = ent('spawn')[0]
const boss = ent('boss')[0]
const [sx, sz] = cellOf(spawn.x, spawn.z)
const [bx, bz] = cellOf(boss.x, boss.z)
const fromSpawn = flood(h, sx, sz)
/**
 * ⚠️ **보스에서 퍼뜨린 장은 「보스 → 그 칸」입니다.** 우리가 알고 싶은 것은
 *    「그 칸 → 보스」라 방향이 반대입니다. 낙하가 일방통행인 이 지도에서는
 *    둘이 갈릴 수 있어서, 보물마다 **그 자리에서 다시 퍼뜨려** 잽니다.
 *    느리지만(보물 다섯 × 6336칸) 여전히 0.2초 안쪽이고, 방향을 틀리면
 *    답이 통째로 뒤집힙니다.
 */
const sb = fromSpawn.steps[bz * W + bx]
const sbCost = fromSpawn.cost[bz * W + bx]
console.log(`\n🧭 동선 스케치 — ${level.name ?? 'level'} (${W}×${H}칸 · MAX_CLIMB ${MAX_CLIMB})`)
if (edits > 0) console.log(`  ✂️ 가상 손질 ${edits}칸 적용 — ROUTE_EDIT`)
if (sb < 0 || sbCost < 0) {
  console.log('  ❌ 시작 지점에서 보스까지 **길이 없습니다.**')
  process.exit(1)
}
console.log(`  spawn(${spawn.x},${spawn.z}) → boss(${boss.x},${boss.z}) = **${sb * CELL}m**`)

/**
 * 「동선」 = 최단 경로 위의 칸 전부. 여기서는 `spawn→칸 + 칸→보스 = 전체`
 * 인 칸을 모읍니다. 두 길이 동률이면 **둘 다** 들어옵니다 — 그게 이 자의
 * 한계이자, 동시에 *"지금 칼날 위에 서 있다"* 를 알려 주는 신호입니다.
 */
const toBoss = flood(h, bx, bz) // 근사: 대칭 구간에서만 맞습니다(위 ⚠️)
const route = []
for (let cz = 0; cz < H; cz++) {
  for (let cx = 0; cx < W; cx++) {
    // 동선은 **값(cost)** 으로 고릅니다 — 게임의 화살표와 같은 기준입니다.
    const a = fromSpawn.cost[cz * W + cx]
    const b = toBoss.cost[cz * W + cx]
    if (a >= 0 && b >= 0 && a + b === sbCost) route.push([cx, cz])
  }
}
const zs = route.map(([, cz]) => wz(cz))
const xs = route.map(([cx]) => wx(cx))
console.log(
  `  📐 동선의 폭 — 가로 ${(Math.max(...xs) - Math.min(...xs)).toFixed(0)}m · ` +
    `세로 ${(Math.max(...zs) - Math.min(...zs)).toFixed(0)}m` +
    ` (존은 ${W * CELL}×${H * CELL}m · 카메라 22m)`,
)
/**
 * ⚠️ 이 수를 「두 길이 동률이다」로 읽지 마십시오. 넓은 회랑은 그냥
 *    한 길인데도 칸 수가 몇 배가 됩니다. 동률인지 아닌지는 **한쪽을 막고
 *    다시 재야** 알 수 있습니다(ROUTE_EDIT 으로 벽을 세워 보십시오).
 *    이 존에서 실제로 그렇게 재 보니 북쪽 194m · 남쪽 206m — 12m 차이였습니다.
 */
console.log(`  경로 위 칸 ${route.length}개 (한 줄이면 ${sb + 1}개 — 넓을수록 큽니다)`)

/**
 * ── 🚪 **필수 칸 — 어느 길로 와도 여기는 지납니다** ────────────────
 *
 * ── 왜 필요해졌는가 (실측) ────────────────────────────────────────
 * `npm run map` 이 쏘는 자를 이렇게 인증했습니다:
 *
 *     ✅ 쏘는 자의 사거리가 주 동선을 덮는다 — 가장 가까운 동선 칸 **2m**
 *
 * 그런데 같은 레벨을 봇이 한 판 돌자:
 *
 *     🏹 (55,-31) — 가장 가까이 **21.8m** · 깨는거리 안 **0프레임**
 *     👣 주 동선 100칸 중 봇이 지난 칸 52칸 · 안 지난 최장 토막 **88m**
 *
 * 둘 다 거짓말이 아닙니다. `map` 은 `routeTrail` 이 고른 **한 줄**을 보고,
 * 봇은 그 회랑 안의 **다른 줄**을 걸었을 뿐입니다. 위 ⚠️ 가 적어 둔
 * *"넓은 회랑은 그냥 한 길인데도 칸 수가 몇 배가 된다"* 의 대가입니다 —
 * **줄 옆에 놓은 적은 다른 줄로 간 사람이 영영 안 만납니다.**
 *
 * ── 참고한 게임들이 푸는 방법 ────────────────────────────────────
 * · **오공 · NRFTW** — 복도가 좁아 「길」이 사실상 한 줄입니다
 * · **엘든 링** — 넓게 두되 위협은 **다리·문·좁은 목**에 둡니다
 * · **로스트아크** — 복도 + 관문
 *
 * 하나로 모입니다: **꼭 만나야 하는 적은 「한 최단경로 위」가 아니라
 * 「모든 최단경로가 지나는 칸」에 둔다.**
 *
 * ── 어떻게 재는가 ────────────────────────────────────────────────
 * 위 ⚠️ 가 시킨 그대로입니다 — *"한쪽을 막고 다시 재야 알 수 있습니다."*
 * 그걸 손으로(ROUTE_EDIT) 하던 것을 여기서 **전부 자동으로** 합니다:
 * 경로 위 칸을 하나씩 허공으로 만들고 다시 흘려서, **최단 비용이 늘거나
 * 길이 끊기면** 그 칸은 필수입니다.
 *
 * ⚠️ **비용(cost)으로 봅니다** — 위 동선과 같은 기준입니다. 걸음 수로
 *    보면 편도 낙하(ONE_WAY_COST)가 같은 값으로 보여서, 「돌아올 수 없는
 *    길」이 필수 칸으로 둔갑합니다.
 * ⚠️ 시작·보스 칸은 뺍니다. 당연히 필수인데 셈에 넣으면 *"필수 칸이
 *    2개는 있다"* 는 **아무 말도 아닌 초록**이 됩니다.
 * ⚠️ 이건 여전히 **스케치입니다.** 이 파일은 지형 규칙을 베껴 쓰므로
 *    판정에 쓰지 않습니다(맨 위 선언). 여기 답은 **어디에 놓을지 고르는
 *    데** 쓰고, 놓고 나서는 `npm run map` 과 `npm run play` 가 봅니다.
 */
const mustPass = []
const costlier = []
{
  const t0 = Date.now()
  for (const [cx, cz] of route) {
    if (cx === sx && cz === sz) continue
    if (cx === bx && cz === bz) continue
    const saved = h[cz * W + cx]
    h[cz * W + cx] = VOID
    const again = flood(h, sx, sz)
    h[cz * W + cx] = saved
    const c = again.cost[bz * W + bx]
    /**
     * ⚠️ **둘을 뭉치면 안 됩니다.** 처음에 `c < 0 || c > sbCost` 로 한
     *    칸에 넣었다가 말이 안 되는 답을 얻었습니다 — 「필수 칸 14개」가
     *    나왔는데 봇은 그 근처를 안 지났습니다.
     *
     *      · `c < 0`      — 막으면 **길이 끊깁니다.** 진짜 목입니다.
     *                       어떤 플레이어도 돌아갈 수 없습니다.
     *      · `c > sbCost` — 막아도 **갈 수는 있고 더 비쌀 뿐**입니다.
     *                       최단으로 달리는 사람만 지납니다. 보물을 줍거나
     *                       싸우다 밀려난 사람은 **그냥 안 지납니다.**
     *
     *    봇이 그랬습니다(보물을 주우러 도는 판). 그러니 *"꼭 만나야 하는
     *    적"* 을 놓을 수 있는 자리는 **앞쪽뿐**입니다.
     */
    if (c < 0) mustPass.push([cx, cz])
    else if (c > sbCost) costlier.push([cx, cz])
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const span = (cells) => {
    const mz = cells.map(([, cz]) => wz(cz))
    const mx = cells.map(([cx]) => wx(cx))
    return (
      `x ${Math.min(...mx).toFixed(0)}~${Math.max(...mx).toFixed(0)}m · ` +
      `z ${Math.min(...mz).toFixed(0)}~${Math.max(...mz).toFixed(0)}m`
    )
  }
  if (mustPass.length === 0) {
    console.log(
      `  🚪 **목이 없습니다** — 어느 칸을 막아도 길이 안 끊깁니다(${secs}초).` +
        ` 즉 이 지도에는 **모두가 반드시 지나는 자리가 하나도 없습니다.**` +
        ` 「꼭 만나야 하는 적」은 배치로는 만들 수 없습니다 — 목을 먼저 뚫으십시오.`,
    )
  } else {
    console.log(`  🚪 **목 ${mustPass.length}칸** (${secs}초) — 막으면 길이 끊깁니다. ${span(mustPass)}`)
  }
  if (costlier.length > 0) {
    console.log(
      `     [최단만] ${costlier.length}칸 — 막아도 **갈 수는 있습니다.** ${span(costlier)}\n` +
        `             최단으로 달리는 사람만 지납니다. 보물을 줍거나 밀려난 사람은 안 지납니다 —` +
        ` 여기 놓은 적은 **판에 따라 안 만납니다.**`,
    )
  }
}

const BUDGET = 40
const EYE = 22
let overBudget = 0
let overEye = 0
console.log('')
for (const t of ent('treasure')) {
  const [tx, tz] = cellOf(t.x, t.z)
  const st = fromSpawn.steps[tz * W + tx]
  const tb = flood(h, tx, tz).steps[bz * W + bx]
  const eye = Math.min(...route.map(([cx, cz]) => Math.hypot(wx(cx) - t.x, wz(cz) - t.z)))
  const det = st >= 0 && tb >= 0 ? (st + tb - sb) * CELL : null
  if (det === null || det > BUDGET) overBudget++
  if (eye > EYE) overEye++
  console.log(
    `   (${String(t.x).padStart(4)},${String(t.z).padStart(4)})` +
      `  더 걷는 ${det === null ? ' 못감' : `${String(det).padStart(4)}m`}` +
      `${det !== null && det <= BUDGET ? '  ' : ' ❌'}` +
      ` · 동선에서 ${eye.toFixed(1).padStart(5)}m${eye <= EYE ? '' : ' ❌'}`,
  )
}
console.log(`\n  예산(${BUDGET}m) 밖 ${overBudget}개 · 시야(${EYE}m) 밖 ${overEye}개`)
console.log('  ⚠️ 판정은 `npm run secret` 이 합니다 — 여기 숫자는 **방향을 고르는 용도**입니다.\n')
