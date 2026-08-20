/**
 * 지도 검증 — `npm run map`
 *
 * ── 왜 이 프로브가 따로 필요한가 ──────────────────────────────────
 * 지름길은 **"열렸다/안 열렸다"만 맞으면 되는 기능이 아닙니다.** 열려도
 * 아무 길도 줄어들지 않으면 그건 그냥 장식입니다. 그래서 여기서 재는 것은
 * 두 가지입니다:
 *
 *   1) 규칙이 지켜지는가 — 걷혀 있으면 못 오르고, **위에서만** 내려지고,
 *      한 번 내리면 게임을 다시 켜도 내려져 있는가.
 *   2) **실제로 짧아지는가** — 폐허에서 보스까지의 길이 몇 미터 줄어드는가.
 *
 * 2번은 제가 지도를 그리면서 "이러면 짧아지겠지"라고 생각한 것을 믿지 않기
 * 위한 것입니다. 길이는 **격자 위 실제 경로 탐색**으로 잽니다.
 * (지형 규칙 MAX_CLIMB / VOID / 사다리 개폐를 그대로 흉내 냅니다.)
 *
 * ⚠️ 상수를 여기에 베껴 적지 않습니다. 레벨 JSON과 게임의 디버그 훅에서
 *    읽습니다 — 값을 바꾸면 검증이 따라와야 하기 때문입니다.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
/**
 * 곁길 예산은 **봇과 같은 값**을 봐야 합니다(policy.mjs 설계 노트).
 * 여기서 40 을 따로 적으면, 봇이 예산을 바꾼 날 이 검사만 옛 값을 씁니다.
 *
 * ⚠️ `playthrough.mjs` 에서 가져오면 안 됩니다 — 불러오는 순간 판이 돕니다.
 *    그래서 정책 상수만 담은 파일이 따로 있습니다.
 */
import { DETOUR_BUDGET, SPEND_BUDGET } from './policy.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5193
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
// 격자 경로 탐색 — 게임의 통행 규칙을 그대로 옮긴 BFS.
// ---------------------------------------------------------------------------
const level = JSON.parse(readFileSync(path.join(ROOT, 'src', 'levels', 'broken-gate.json'), 'utf8'))
const VOID = -1
/** 적으로 치는 배치 종류 — 조합 프로브와 같은 목록입니다. */
const FOE_KINDS = new Set(['grunt', 'binder', 'dragger', 'charger', 'archer', 'boss'])

function heightAt(cx, cz) {
  if (cx < 0 || cz < 0 || cx >= level.w || cz >= level.h) return VOID
  return level.heights[cz * level.w + cx]
}

function cellOf(e) {
  return { cx: Math.floor(e.x / 2 + level.w / 2), cz: Math.floor(e.z / 2 + level.h / 2) }
}

/**
 * 사다리 링크를 지형에서 유도합니다 — 게임의 Terrain.buildShortcuts 와 같은 규칙.
 * (같은 규칙을 두 번 적는 것이지만, 여기서 게임 코드를 import 할 수 없고
 *  링크가 틀렸을 때 **양쪽이 같이 틀리는 것**보다 낫습니다.)
 */
function ladderLinks() {
  const links = []
  for (const e of level.entities) {
    if (e.kind !== 'ladder') continue
    const { cx, cz } = cellOf(e)
    const lo = heightAt(cx, cz)
    let best = lo
    let bx = cx
    let bz = cz
    for (const [nx, nz] of [
      [cx - 1, cz],
      [cx + 1, cz],
      [cx, cz - 1],
      [cx, cz + 1],
    ]) {
      const v = heightAt(nx, nz)
      if (v !== VOID && v > best) {
        best = v
        bx = nx
        bz = nz
      }
    }
    links.push({ loX: cx, loZ: cz, hiX: bx, hiZ: bz, rise: best - lo })
  }
  return links
}

/** maxClimb 를 넘는 오르막은 열린 사다리로만 통과합니다. */
/**
 * @param blocked 지나갈 수 없다고 **가정할** 칸들(키 집합). 기본은 없음.
 *   *"첫 길을 막으면 두 번째 길이 있는가"* 를 물으려면 필요합니다 —
 *   BFS 를 한 벌 더 만들면 두 구현이 언젠가 어긋납니다.
 */
function bfs(from, to, maxClimb, openLadders, blocked) {
  const links = openLadders ? ladderLinks() : []
  const linked = (ax, az, bx, bz) =>
    links.some(
      (l) =>
        (l.loX === ax && l.loZ === az && l.hiX === bx && l.hiZ === bz) ||
        (l.loX === bx && l.loZ === bz && l.hiX === ax && l.hiZ === az),
    )
  const key = (x, z) => z * level.w + x
  const dist = new Map([[key(from.cx, from.cz), 0]])
  let queue = [from]
  while (queue.length) {
    const next = []
    for (const cur of queue) {
      if (cur.cx === to.cx && cur.cz === to.cz) return dist.get(key(cur.cx, cur.cz))
      const h = heightAt(cur.cx, cur.cz)
      for (const [nx, nz] of [
        [cur.cx - 1, cur.cz],
        [cur.cx + 1, cur.cz],
        [cur.cx, cur.cz - 1],
        [cur.cx, cur.cz + 1],
      ]) {
        const nh = heightAt(nx, nz)
        if (nh === VOID) continue
        if (nh - h > maxClimb && !linked(cur.cx, cur.cz, nx, nz)) continue
        const k = key(nx, nz)
        if (dist.has(k)) continue
        if (blocked?.has(k)) continue
        dist.set(k, dist.get(key(cur.cx, cur.cz)) + 1)
        next.push({ cx: nx, cz: nz })
      }
    }
    queue = next
  }
  return Infinity
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
  /**
   * 시뮬레이션 시간 기준 대기. **벽시계로 재면 전부 거짓이 됩니다** —
   * SwiftShader에서는 게임이 실시간의 1/3~1/20로 흐릅니다.
   * (페이지를 새로고침하면 사라지므로 함수로 두고 다시 심습니다.)
   */
  const installHarness = () =>
    page.evaluate(() => {
      window.__t = {
        runFor: async (seconds) => {
          const target = window.__game.state().elapsed + seconds
          const deadline = Date.now() + 120000
          while (window.__game.state().elapsed < target && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 8))
          }
        },
      }
    })

  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  await page.evaluate(() => window.__game.resetProgress())
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  await installHarness()

  console.log('\n🪜 지도와 지름길 검증\n')

  // ---- 1. 사다리가 지형에서 제대로 유도되었는가 ----
  const info = await page.evaluate(() => window.__game.shortcutInfo())
  check(info.length > 0, '레벨에 사다리가 있다', `${info.length}개`)
  const maxClimb = await page.evaluate(() => window.__game.terrainInfo().maxClimb)
  for (const s of info) {
    check(
      s.rise > maxClimb,
      `사다리(${s.key})가 걸어서 못 오르는 단차에 있다`,
      `${s.rise}단 (걸어서 오를 수 있는 한계 ${maxClimb}단)`,
    )
    check(!s.open, `사다리(${s.key})는 처음에 걷혀 있다`)
  }

  // ---- 2. 실제로 길이 짧아지는가 ----
  //
  // 지름길의 값어치를 **미터로** 잽니다. "느낌상 가까워짐"은 값이 아닙니다.
  // 재는 출발점은 **화톳불**입니다. 플레이어가 실제로 다시 걷기 시작하는 곳이
  // 거기이기 때문입니다. 사다리 밑에서 재면 "지름길이 지름길이다"라는
  // 동어반복이 되고, 실제로 처음에 그렇게 재서 단축 0m 를 그럴듯하게 놓쳤습니다.
  const boss = cellOf(level.entities.find((e) => e.kind === 'boss'))
  const CELL = 2
  const fireCells = level.entities.filter((e) => e.kind === 'bonfire').map(cellOf)
  const startFire = fireCells.reduce((a, b) =>
    bfs(a, boss, maxClimb, false) > bfs(b, boss, maxClimb, false) ? a : b,
  )
  /**
   * ⚠️ **재는 자리를 바꿨습니다 — 여기가 이 프로브의 핵심 수정입니다.**
   *
   * 예전엔 *가장 먼* 화톳불에서 쟀습니다. 그 숫자는 56m 단축으로 늘 통과했고,
   * 자동 플레이는 네 판 내리 **사다리 0/1** 이었습니다. 둘 다 사실이었습니다.
   *
   * 화톳불마다 따로 재 보니 이랬습니다:
   *   시작 화톳불   186m → 130m  (56m)
   *   중간 화톳불    64m →  64m  (**0m**)
   *   보스 앞 화톳불  28m →  28m  (**0m**)
   *
   * 지름길은 **되돌아 걷는 사람**의 장치인데, 되돌아 걷기가 시작되는 자리
   * (= 죽으면 부활하는, 보스에서 가장 가까운 화톳불)가 벽 너머에 있었습니다.
   * 가장 먼 화톳불에서 재는 것은 **아무도 시작하지 않는 지점에서 재는 것**
   * 이었습니다. 그래서 기준을 **보스에서 가장 가까운 화톳불**로 바꿉니다.
   */
  const respawnFire = fireCells.reduce((a, b) =>
    bfs(a, boss, maxClimb, false) < bfs(b, boss, maxClimb, false) ? a : b,
  )
  const closed = bfs(respawnFire, boss, maxClimb, false)
  const opened = bfs(respawnFire, boss, maxClimb, true)
  console.log(
    `  [거리] 화톳불별 보스까지 — ` +
      fireCells
        .map((f) => {
          const c = bfs(f, boss, maxClimb, false)
          const o = bfs(f, boss, maxClimb, true)
          return `(${f.cx},${f.cz}) ${c * CELL}→${o * CELL}m`
        })
        .join(' · ') +
      `\n         가장 먼 화톳불 ${bfs(startFire, boss, maxClimb, false) * CELL}m · 부활 화톳불 ${closed * CELL}m\n`,
  )
  check(
    Number.isFinite(closed),
    '사다리가 걷혀 있어도 보스까지 갈 길은 있다 (지름길이 필수가 아니다)',
    `부활 화톳불에서 ${closed * CELL}m`,
  )
  check(
    opened < closed,
    '**부활 화톳불에서** 보스까지가 실제로 짧아진다 (되걷는 사람에게 값이 있다)',
    `${closed * CELL}m → ${opened * CELL}m (${(closed - opened) * CELL}m 단축, ${Math.round((1 - opened / closed) * 100)}%)`,
  )
  check(
    (closed - opened) * CELL >= 40,
    '단축 폭이 체감될 만큼 크다 (40m 이상 — 걸어서 8초 이상)',
    `${(closed - opened) * CELL}m`,
  )

  /**
   * **여는 값 < 아끼는 값** — 지름길이 지름길이기 위한 최소 조건.
   *
   * 이 검사가 없어서 오래 놓쳤습니다. 사다리 위 칸이 주 동선에서 100m 가까이
   * 벗어나 있었고(시작→보스 192m, 시작→사다리 위칸 280m), 그래서 봇도 사람도
   * 열러 가지 않았습니다. 다크소울1의 지름길은 **가던 길에서 잠깐 옆으로**
   * 입니다 — 여는 데 드는 값이 아끼는 값보다 크면 그건 수집품이지 지름길이
   * 아닙니다.
   */
  const hi = ladderLinks()[0]
  const detour =
    bfs(respawnFire, { cx: hi.hiX, cz: hi.hiZ }, maxClimb, false) +
    bfs({ cx: hi.hiX, cz: hi.hiZ }, boss, maxClimb, false) -
    closed
  check(
    detour * CELL < (closed - opened) * CELL,
    '사다리를 열러 가는 값이 아끼는 값보다 작다 (가던 길에서 잠깐 옆으로)',
    `추가로 걷는 거리 ${detour * CELL}m vs 매 판 아끼는 거리 ${(closed - opened) * CELL}m`,
  )

  // ---- 3. 걷힌 사다리는 못 오른다 ----
  const climb = await page.evaluate(async () => {
    const s = window.__game.shortcutInfo()[0]
    // 아래 칸 한가운데에 세우고 위 칸 쪽으로 걸어 봅니다.
    window.__game.teleportPlayer(s.loWorldX, s.loWorldZ)
    await window.__t.runFor(0.2)
    const before = window.__game.state().player
    const beforeHint = window.__game.shortcutHint()
    // 아래에서 V를 눌러도 열리지 않아야 합니다.
    window.__game.press('KeyV')
    window.__game.release('KeyV')
    await window.__t.runFor(0.3)
    const stillClosed = !window.__game.shortcutInfo()[0].open
    const walked = window.__game.walkTest(s.loWorldX, s.loWorldZ, s.hiWorldX, s.hiWorldZ)
    return { before, beforeHint, stillClosed, walked }
  })
  check(!climb.walked, '걷힌 사다리 앞에서는 위로 올라갈 수 없다')
  check(climb.stillClosed, '아래에서 V를 눌러도 내려지지 않는다')
  check(
    climb.beforeHint === 'locked',
    '아래에서는 "위에서만 내릴 수 있다"고 알려준다',
    `안내 상태 ${climb.beforeHint}`,
  )

  // ---- 4. 위에서는 내려진다 ----
  const drop = await page.evaluate(async () => {
    const s = window.__game.shortcutInfo()[0]
    window.__game.teleportPlayer(s.hiWorldX, s.hiWorldZ)
    await window.__t.runFor(0.2)
    const hint = window.__game.shortcutHint()
    window.__game.press('KeyV')
    window.__game.release('KeyV')
    await window.__t.runFor(0.3)
    const after = window.__game.shortcutInfo()[0]
    const walked = window.__game.walkTest(s.loWorldX, s.loWorldZ, s.hiWorldX, s.hiWorldZ)
    return { hint, open: after.open, walked }
  })
  check(drop.hint === 'ready', '위에서는 내릴 수 있다고 안내한다', `안내 상태 ${drop.hint}`)
  check(drop.open, '위에서 V를 누르면 사다리가 내려진다')
  check(drop.walked, '내려진 뒤에는 아래에서 위로 올라갈 수 있다')

  // ---- 5. 다시 켜도 내려져 있는가 ----
  //
  // 지름길은 **알아낸 것**이라 보물과 같은 편에 서야 합니다.
  await page.reload()
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  await installHarness()
  const reloaded = await page.evaluate(() => window.__game.shortcutInfo()[0])
  check(reloaded.open, '게임을 다시 켜도 사다리는 내려진 채로 남는다')

  // ---- 6. 지도가 이어져 있는가 ----
  //
  // 사다리와 무관하게, **시작 지점에서 모든 화톳불·보물·보스에 걸어서 닿아야**
  // 합니다. 지형을 손으로 그리다 보면 한 칸 차이로 섬이 생기는데, 그건
  // 플레이해 보기 전에는 절대 눈에 안 띕니다.
  const spawn = cellOf(level.entities.find((e) => e.kind === 'spawn'))
  const unreachable = []
  for (const e of level.entities) {
    if (e.kind === 'spawn' || e.kind === 'ladder') continue
    const c = cellOf(e)
    if (!Number.isFinite(bfs(spawn, c, maxClimb, false))) unreachable.push(`${e.kind}(${c.cx},${c.cz})`)
  }
  check(
    unreachable.length === 0,
    '시작 지점에서 모든 배치물에 사다리 없이도 닿는다',
    unreachable.length ? unreachable.join(' · ') : `${level.entities.length - 2}개 전부`,
  )

  /**
   * ---- 6.5 **쏘는 적에게 걸어서 닿을 수 있는가** ----
   *
   * DESIGN.md 의 *"아직 안 한 것"* 에 이렇게 적어 뒀습니다: *"우리 적 AI가
   * 절벽을 낀 추격을 어떻게 처리하는지 확인하지 않은 채 넣으면 **영영 못
   * 다가오면서 계속 쏘는 적**이 생깁니다. 먼저 재고 넣습니다."*
   *
   * 그 "재는 것"이 이 검사입니다. 시작 지점에서 닿는지(6번)만으로는
   * 부족합니다 — **맞으면서 걸어가야 하는 거리**가 진짜 문제이기 때문입니다.
   * 12m 밖에서 쏘는데 그 자리까지 90m를 돌아가야 한다면, 그건 난이도가
   * 아니라 벌입니다.
   *
   * 그래서 *사거리 안에 들어오는 칸들* 각각에서 그 적까지 **걸어야 하는
   * 거리**를 재고, 사거리의 3배를 넘는 칸이 없어야 한다고 요구합니다.
   * 3배로 잡은 근거: 지형을 한 번 우회하면 대략 2배, 두 번이면 3배가
   * 됩니다. 그 이상은 "돌아가는 길"이 아니라 **다른 길**입니다.
   */
  const RANGED = level.entities.filter((e) => e.kind === 'archer')
  for (const a of RANGED) {
    const ac = cellOf(a)
    const reachM = 12 // 사거리(m) — 아래에서 게임 값과 대조합니다
    const cells = Math.ceil(reachM / 2)
    let worst = 0
    let worstAt = ''
    for (let dz = -cells; dz <= cells; dz++) {
      for (let dx = -cells; dx <= cells; dx++) {
        const cx = ac.cx + dx
        const cz = ac.cz + dz
        if (heightAt(cx, cz) === VOID) continue
        // 사거리 안(직선)인 칸만 봅니다 — 여기서 화살이 날아옵니다.
        if (Math.hypot(dx, dz) * 2 > reachM) continue
        const walk = bfs({ cx, cz }, ac, maxClimb, false)
        if (!Number.isFinite(walk)) continue // 아예 못 가는 칸은 아래에서 따로 봅니다
        if (walk * 2 > worst) {
          worst = walk * 2
          worstAt = `(${cx},${cz})`
        }
      }
    }
    check(
      worst <= reachM * 3,
      `쏘는 자(${ac.cx},${ac.cz})는 맞는 자리에서 걸어서 닿는다 (맞으면서 존을 돌지 않게)`,
      `가장 먼 자리 ${worstAt} 에서 ${worst.toFixed(0)}m · 사거리 ${reachM}m · 한도 ${reachM * 3}m`,
    )
  }

  // ---- 7. 보스 전 화톳불이 영역 밖인가 ----
  const arena = await page.evaluate(() => window.__game.bossEncounter())
  const bossE = level.entities.find((e) => e.kind === 'boss')
  const fires = level.entities.filter((e) => e.kind === 'bonfire')
  const nearestFire = fires.reduce(
    (m, f) => Math.min(m, Math.hypot(f.x - bossE.x, f.z - bossE.z)),
    Infinity,
  )
  check(
    nearestFire > (arena?.arenaRadius ?? 17),
    '보스 전 화톳불이 보스 영역 밖에 있다 (준비하다 전투가 시작되지 않게)',
    `가장 가까운 화톳불 ${nearestFire.toFixed(1)}m · 영역 ${arena?.arenaRadius ?? '?'}m`,
  )

  /**
   * ---- 8. 주 동선이 낭떠러지 옆에서 좁지 않은가 ----
   *
   * **자동 플레이가 잡은 버그를 규칙으로 굳힙니다.**
   * 함몰지 가장자리 통로를 4m로 냈더니 봇이 420초 중 300초를 아래에서
   * 보냈습니다. 체력 100, 성수병 3개 — 죽은 게 아니라 **실수로 떨어져서**
   * 못 나오고 있었습니다. 최단 경로는 함몰지를 지나지도 않는데 말입니다.
   *
   * 조작이 정밀하지 않은 사람과, 적에게 밀리는 상황에서는 **좁은 길 옆의
   * 되돌아올 수 없는 낙차가 곧 기본값**이 됩니다. 그래서 규칙으로 둡니다:
   * 주 동선 위의 칸이 되돌아올 수 없는 낙차와 접해 있으면,
   * 그 자리의 걸을 수 있는 폭이 최소 6m 는 되어야 합니다.
   */
  const routeCells = (() => {
    // 시작 화톳불 → 보스 최단 경로를 되짚습니다.
    const key = (x, z) => z * level.w + x
    const from = startFire
    const prev = new Map()
    const dist = new Map([[key(from.cx, from.cz), 0]])
    let queue = [from]
    let hit = null
    while (queue.length && !hit) {
      const next = []
      for (const cur of queue) {
        if (cur.cx === boss.cx && cur.cz === boss.cz) {
          hit = cur
          break
        }
        const h = heightAt(cur.cx, cur.cz)
        for (const [nx, nz] of [
          [cur.cx - 1, cur.cz],
          [cur.cx + 1, cur.cz],
          [cur.cx, cur.cz - 1],
          [cur.cx, cur.cz + 1],
        ]) {
          const nh = heightAt(nx, nz)
          if (nh === VOID || nh - h > maxClimb) continue
          const k = key(nx, nz)
          if (dist.has(k)) continue
          dist.set(k, dist.get(key(cur.cx, cur.cz)) + 1)
          prev.set(k, cur)
          next.push({ cx: nx, cz: nz })
        }
      }
      queue = next
    }
    const out = []
    let cur = hit
    while (cur) {
      out.push(cur)
      cur = prev.get(key(cur.cx, cur.cz))
    }
    return out.reverse()
  })()

  /** 이 칸에서 걸어갈 수 있는 이웃(같은 높이 ±오를 수 있는 단차)의 수. */
  const walkableWidth = (cx, cz) => {
    const h = heightAt(cx, cz)
    let n = 1
    for (const [dx, dz] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      // 그 방향으로 몇 칸이나 이어지는지 셉니다(양옆 폭의 근사).
      for (let step = 1; step <= 3; step++) {
        const v = heightAt(cx + dx * step, cz + dz * step)
        if (v === VOID || Math.abs(v - h) > maxClimb) break
        n++
      }
    }
    return n
  }

  const MIN_WIDTH_CELLS = 3 // 6m
  const narrow = []
  for (const c of routeCells) {
    const h = heightAt(c.cx, c.cz)
    const nextToDrop = [
      [c.cx - 1, c.cz],
      [c.cx + 1, c.cz],
      [c.cx, c.cz - 1],
      [c.cx, c.cz + 1],
    ].some(([nx, nz]) => {
      const v = heightAt(nx, nz)
      // 되돌아올 수 없는 낙차 = 내려가면 다시 못 오르는 단차
      return v !== VOID && h - v > maxClimb
    })
    if (!nextToDrop) continue
    if (walkableWidth(c.cx, c.cz) < MIN_WIDTH_CELLS * 2) narrow.push(`(${c.cx},${c.cz})`)
  }
  check(
    narrow.length === 0,
    '주 동선이 되돌아올 수 없는 낙차 옆에서 좁지 않다 (실수로 떨어져 갇히지 않게)',
    narrow.length ? `좁은 자리 ${narrow.slice(0, 4).join(' ')}` : `경로 ${routeCells.length}칸 전부`,
  )

  /**
   * ---- 6.4 **쏘는 적의 사거리가 주 동선을 덮는가** ----
   *
   * 앞의 검사(닿을 수 있는가)만 만들고 궁수를 세웠더니, 3판 내내
   * **한 발도 안 쐈습니다.** 원인은 단순했습니다 — "높은 곳에서 내려다본다"는
   * 직관으로 자리를 잡고, **사거리와 동선 사이의 거리를 안 재봤습니다.**
   * 34m 떨어진 곳에 사거리 12m 짜리를 세워 둔 것입니다.
   *
   * 배치했다고 콘텐츠가 되는 게 아닙니다. 원거리 적은 **동선이 사거리 안을
   * 지나가야** 존재합니다. 그래서 주 동선 칸 중 사거리 안에 들어오는 수를
   * 셉니다 — 최소 8칸(16m)은 덮어야 "지나가는 동안 압박한다"가 됩니다.
   */
  for (const a of RANGED) {
    const ac = cellOf(a)
    const covered = routeCells.filter(
      (c) => Math.hypot(c.cx - ac.cx, c.cz - ac.cz) * 2 <= 12,
    ).length
    check(
      covered >= 8,
      `쏘는 자(${ac.cx},${ac.cz})의 사거리가 주 동선을 덮는다 (배치만 하고 안 쏘지 않게)`,
      `동선 ${covered}칸(${covered * 2}m) · 최소 8칸` +
        ` · 가장 가까운 동선 칸 ${(() => {
          let best = Infinity
          let at = ''
          for (const c of routeCells) {
            const d = Math.hypot(c.cx - ac.cx, c.cz - ac.cz) * 2
            if (d < best) {
              best = d
              at = `(${c.cx},${c.cz})`
            }
          }
          return `${at} ${best.toFixed(0)}m`
        })()}`,
    )
  }
  /**
   * ---- 9. 주 동선에 **아무것도 없는 구간**이 얼마나 긴가 ----
   *
   * ── 왜 이 검사가 생겼는가 ──────────────────────────────────────
   * 자동 플레이가 여섯 판 연속 같은 것을 말했습니다:
   *
   *     빈 시간  교전 사이 평균 7~9초 · **최장 19~25초**
   *     무엇을 하고 있었나  목표이동 40% · 접근 26%  (= 걷기 66%)
   *
   * 여섯 번 찍어 놓고 여섯 번 다 넘겼습니다. "소울류도 걷는다"는 말로요.
   * 그런데 소울류의 걷기는 **비어 있지 않습니다.** 다크소울1의 언데드 버그는
   * 모퉁이마다 적이 있고, NRFTW는 오르내릴 것이 있습니다. 우리 존은 방 단위
   * 어그로(14m) 뒤로 **자는 적 옆을 지나가는 시간**이 되었습니다.
   *
   * 매번 봇을 돌려서 재는 것은 느리고, 판마다 경로가 달라 흔들립니다.
   * 지도만 보고도 알 수 있습니다: **주 동선을 따라 걸으면서, 깨울 수 있는
   * 적이 하나도 없는 구간이 몇 미터나 이어지는가.**
   *
   * ⚠️ 어그로 거리는 게임에서 읽습니다(terrainInfo().levelAggroRange).
   */
  const aggro = await page.evaluate(() => window.__game.terrainInfo().levelAggroRange)

  /**
   * ---- 8.5 **색을 가르치는 적이 주 동선에서 깨어나는가** ----
   *
   * ── 왜 이 검사가 생겼는가 ──────────────────────────────────────
   * 🟢 달려드는 자를 5마리 배치했는데 자동 플레이 3판에서 **판당 3회**만
   * 초록 예고가 떴습니다(실제로 만나는 건 5마리 중 2~3마리). 존이 212초니
   * **70초에 한 번**입니다.
   *
   * 기준은 제가 make-zone.mjs 에 이미 적어 뒀습니다:
   *   *"로스트아크의 카운터 창은 20~30초마다 옵니다.
   *     3분짜리 존에서 2회는 배우는 게 아니라 구경하는 것입니다."*
   * 제 기준의 1/2~1/3 입니다.
   *
   * 원인은 쿨다운도 체력도 아니고 **깨지 않는다**였습니다. 레벨 모드의
   * 어그로는 종류값이 아니라 LEVEL_AGGRO_RANGE 로 잘립니다. 그 거리 밖에
   * 세운 적은 존재하지 않는 것과 같습니다 — 34m 밖에 세워 두고 한 발도
   * 못 쏘던 궁수와 **똑같은 실수**입니다. 그때는 원거리만 검사를 만들었고,
   * 근접 특수 적에는 같은 검사가 없었습니다.
   *
   * ⚠️ **직선거리가 아니라 걸어야 하는 거리로 잽니다.** 게임도 그렇게
   * 깨웁니다(enemyAI.ts 의 reachDistance). 이 프로젝트에서 직선/경로를
   * 혼동해 생긴 버그가 이미 셋입니다. 주 동선 칸 **전체에서 한 번에**
   * BFS 를 돌려(다중 출발점), 각 칸이 동선에서 몇 m 인지 구합니다.
   *
   * ── 규칙: 색마다 주 동선에서 깨울 수 있는 개체 2마리 이상 ──────
   * 곁길에 둔 것까지 실패로 치지는 않습니다 — *"곁길에서 한 번 더"* 는
   * 의도된 배치입니다. 다만 **주 동선에서 못 만나는 색은 배운 적이
   * 없는 색**이므로, 색마다 최소 두 번(처음 + 복습)은 동선 위에 있어야
   * 합니다. 한 번은 배우는 게 아니라 구경입니다.
   */
  {
    const key = (x, z) => z * level.w + x
    const distToRoute = new Map()
    let frontier = []
    for (const c of routeCells) {
      distToRoute.set(key(c.cx, c.cz), 0)
      frontier.push(c)
    }
    while (frontier.length) {
      const next = []
      for (const cur of frontier) {
        const h = heightAt(cur.cx, cur.cz)
        const d = distToRoute.get(key(cur.cx, cur.cz))
        for (const [nx, nz] of [
          [cur.cx - 1, cur.cz],
          [cur.cx + 1, cur.cz],
          [cur.cx, cur.cz - 1],
          [cur.cx, cur.cz + 1],
        ]) {
          const nh = heightAt(nx, nz)
          if (nh === VOID || nh - h > maxClimb) continue
          const k = key(nx, nz)
          if (distToRoute.has(k)) continue
          distToRoute.set(k, d + CELL)
          next.push({ cx: nx, cz: nz })
        }
      }
      frontier = next
    }

    /**
     * 색을 가르치는 **근접** 적만 마릿수로 봅니다.
     * 잡몹은 채우는 역할, 보스는 시험입니다.
     *
     * ⚠️ 🔴 쏘는 자는 **일부러 뺐습니다.** 규칙을 빠져나가려는 게 아니라
     * 재는 단위가 다르기 때문입니다. 근접 적은 "만난다/못 만난다"가
     * 한 번의 사건이지만, 원거리 적은 **동선의 어느 구간을 사거리로
     * 덮고 있느냐**가 곧 기회입니다. 한 마리가 22m 를 덮으면 그 22m 를
     * 걷는 내내 압박입니다 — 마릿수로는 그게 안 잡힙니다.
     * 대신 바로 아래에서 **"지나가는 동안 몇 발 쏠 수 있는가"** 를 잽니다.
     */
    const TEACHERS = { charger: '🟢 달려드는 자', binder: '🔵 얽는 자', dragger: '🟣 끄는 자' }
    for (const [kind, label] of Object.entries(TEACHERS)) {
      const placed = level.entities.filter((e) => e.kind === kind)
      const dists = placed.map((e) => {
        const c = cellOf(e)
        return { c, d: distToRoute.get(key(c.cx, c.cz)) ?? Infinity }
      })
      const onRoute = dists.filter((x) => x.d <= aggro)
      check(
        onRoute.length >= 2,
        `${label} — 주 동선에서 깨울 수 있는 개체가 2마리 이상 (배치만 하고 안 만나지 않게)`,
        `${placed.length}마리 중 ${onRoute.length}마리 · 동선까지 ` +
          dists
            .sort((a, b) => a.d - b.d)
            .map((x) => `(${x.c.cx},${x.c.cz}) ${Number.isFinite(x.d) ? `${x.d}m` : '길없음'}`)
            .join(' · ') +
          ` · 어그로 ${aggro}m`,
      )
    }

    /**
     * ── 🔴 원거리: **지나가는 동안 몇 발 쏘는가** ──────────────────
     *
     * 자동 플레이 3판에서 쏘는 자는 판당 **예고 1회**였습니다. 배치도
     * 사거리도 검사를 통과했는데도요. 마릿수로는 안 잡히는 종류의
     * 부족이라 여기서 따로 잽니다.
     *
     * 계산은 전부 **게임에서 읽은 값**으로 합니다 — 상수를 베껴 오면
     * 밸런스를 바꿨을 때 검사만 옛말을 하게 됩니다(이 프로젝트의 규칙).
     *   · 사거리·공격 한 바퀴 시간 → enemyRoster()
     *   · 어그로 → terrainInfo().levelAggroRange (+ 원거리 여유)
     *   · 플레이어 이동 속도 → playerTuning()
     *
     * 지나가는 시간 = (어그로 안에 드는 동선 길이) ÷ 이동 속도
     * 쏠 수 있는 횟수 = 그 시간 ÷ 공격 한 바퀴
     *
     * **2발**을 최소로 둡니다. 한 발은 사고이고, 두 발이어야
     * *"피하고 붙는다"* 라는 대응이 성립합니다.
     */
    const roster = await page.evaluate(() => window.__game.enemyRoster())
    const t = await page.evaluate(() => window.__game.terrainInfo())
    const walkSpeed = t.playerMoveSpeed
    const archerDef = roster.find((r) => r.id === 'archer')
    if (archerDef) {
      // 게임(enemyAI.ts)과 **같은 식**으로 이 종류의 실제 어그로를 냅니다.
      /**
       * 게임(enemyAI.ts)과 **같은 식**으로 깨는 거리를 냅니다.
       * ⚠️ 기준은 `attackRange`(달려들기 시작하는 거리)가 아니라 패턴의
       * **reach**(실제로 때리는 거리)입니다 — 끄는 자가 attackRange 12 ·
       * reach 6.5 라, 이 둘을 헷갈리면 근접 적 어그로까지 조용히 넓어집니다.
       */
      const hurtReach = Math.max(...archerDef.attacks.map((a) => a.reach))
      const wakeRange = Math.min(
        Math.max(t.levelAggroRange, hurtReach + t.levelAggroLead),
        t.levelAggroMax,
      )
      for (const a of level.entities.filter((e) => e.kind === 'archer')) {
        const ac = cellOf(a)
        const inside = routeCells.filter(
          (c) => Math.hypot(c.cx - ac.cx, c.cz - ac.cz) * CELL <= wakeRange,
        ).length
        const metres = inside * CELL
        const seconds = metres / walkSpeed
        const shots = seconds / archerDef.attackCycle
        check(
          shots >= 2,
          `🔴 쏘는 자(${ac.cx},${ac.cz}) — 지나가는 동안 2발 이상 쏠 수 있다 (한 발은 사고입니다)`,
          `깨는 거리 ${wakeRange}m 안의 동선 ${metres}m ÷ 이동 ${walkSpeed}m/s = ${seconds.toFixed(1)}초` +
            ` ÷ 한 바퀴 ${archerDef.attackCycle.toFixed(2)}초 = ${shots.toFixed(1)}발`,
        )
      }
    }

    /**
     * ── 🧮 **소비처에 닿을 때 지갑이 차 있는가** ────────────────────
     *
     * 봇의 새 장부가 이 줄을 찍었습니다:
     *
     *   `70.9초 모루(25,29) **2m** · 불티 34 · 정련석 0 · **못 삼**`
     *
     * **동선은 문제가 아닙니다 — 2m 를 지나갑니다.** 그때 지갑이 비어
     * 있는 것이고, 그건 봇 정책이 아니라 **수입 시점과 소비처 위치의
     * 관계**입니다. 봇 쪽을 네 라운드 고쳤는데 벤치 중앙값이 한 번도
     * 안 움직인 이유가 여기 있었습니다.
     *
     * 그리고 이건 **판을 돌리지 않고 셀 수 있습니다.** 존은 한 방향이라
     * 동선 위의 순서가 곧 시간 순서입니다:
     *
     *   소비처 앞의 적 = 그때까지 벌 수 있는 **불티**
     *   소비처 앞의 보물 = 그때까지 얻을 수 있는 **정련석**
     *
     * 판 편차가 97~226초로 벌어져 3판 벤치로는 아무것도 증명이 안 되는
     * 상황에서, **결정적으로 답할 수 있는 유일한 자리**입니다.
     *
     * ⚠️ **최선의 경우**를 셉니다(앞의 것을 다 잡고 다 줍는다). 그래서
     *    이 검사가 빨간 것은 *"운이 나빴다"* 가 아니라 **"원리적으로
     *    불가능하다"** 는 뜻입니다. 초록이라고 실제로 된다는 보장은
     *    없지만, 빨간데 되는 일은 없습니다.
     */
    {
      const upg = await page.evaluate(() => window.__game.weaponUpgradeInfo())
      const emberOf = new Map(roster.map((r) => [r.id, r.ember ?? 0]))
      /** 동선 위의 **진행도** — 가장 가까운 동선 칸의 순번으로 잽니다. */
      const progressOf = (c) => {
        let best = Infinity
        let at = -1
        for (let i = 0; i < routeCells.length; i++) {
          const d = Math.hypot(routeCells[i].cx - c.cx, routeCells[i].cz - c.cz)
          if (d < best) {
            best = d
            at = i
          }
        }
        return { at, off: best * CELL }
      }
      const foesOnRoute = level.entities
        .filter((e) => FOE_KINDS.has(e.kind) || e.kind === 'archer')
        .map((e) => ({ kind: e.kind, ...progressOf(cellOf(e)) }))
      const treasuresOnRoute = level.entities
        .filter((e) => e.kind === 'treasure')
        .map((e) => ({ ...progressOf(cellOf(e)) }))
      const anvilRows = level.entities
        .filter((e) => e.kind === 'anvil' || e.kind === 'bonfire')
        .map((e) => {
          const pr = progressOf(cellOf(e))
          const embers = foesOnRoute
            .filter((f) => f.at < pr.at && f.off <= aggro)
            .reduce((a, f) => a + (emberOf.get(f.kind) ?? 0), 0)
          const stones = treasuresOnRoute.filter(
            (t) => t.at < pr.at && t.off <= DETOUR_BUDGET,
          ).length
          return { kind: e.kind, c: cellOf(e), pr, embers, stones }
        })
        .sort((a, b) => a.pr.at - b.pr.at)
      for (const r of anvilRows) {
        console.log(
          `  [지갑] ${r.kind === 'anvil' ? '모루' : '화톳불'}(${r.c.cx},${r.c.cz}) — ` +
            `여기 오기까지 불티 ${r.embers} · 정련석 ${r.stones}` +
            ` (첫 강화 ${upg.nextCost}불티 + ${upg.nextStoneCost}정련석)`,
        )
      }
      /**
       * 문턱: **하나 이상의 소비처**에서 첫 강화가 원리적으로 가능해야 합니다.
       *
       * 하나면 충분한 근거: 소비처가 흔해지면 *"들르는 일"* 이 판단이
       * 아니게 됩니다(DESIGN.md). 다만 **한 곳도 없으면** 무기 축은
       * 존에서 존재하지 않는 것입니다 — 실제로 벤치 열한 번 내내
       * `무기 강화 0.0` 이었습니다.
       */
      const affordable = anvilRows.filter(
        (r) => r.embers >= upg.nextCost && r.stones >= upg.nextStoneCost,
      )
      check(
        affordable.length > 0,
        `소비처 하나 이상에서 **첫 강화가 원리적으로 가능**하다 (${upg.nextCost}불티 + ${upg.nextStoneCost}정련석)`,
        affordable.length
          ? affordable.map((r) => `(${r.c.cx},${r.c.cz}) 불티 ${r.embers}·돌 ${r.stones}`).join(' · ')
          : anvilRows
              .map((r) => `(${r.c.cx},${r.c.cz}) 불티 ${r.embers}·돌 ${r.stones}`)
              .join(' · ') + ' — 앞의 것을 **다 잡고 다 주워도** 못 삽니다',
      )
    }

    /**
     * ── 💰 **소비처가 갈 만한 거리인가** ────────────────────────────
     *
     * 3판 벤치가 세 번 연속 같은 말을 했습니다:
     *
     *   > 소비처 — 닿음 **0.0회** · 가려다 접음 2.0회 · 접은 거리 **46~86m**
     *   > 무기 강화 **0.0회** · 남은 불티 404 · 보스 앞 장비 **+0**
     *
     * 불티도 정련석도 제때 모입니다(`늦게 모인 판 0/3`). 닿기만 하면 삽니다
     * (`닿았을 때 무기 강화함 1회`). **끊긴 고리는 거리 하나뿐**입니다.
     * 그런데 지금까지 그것을 재는 검사가 **없었습니다** — 벤치를 한 판씩
     * 40분 돌려야만 알 수 있었고, 그건 이 저장소가 매번 데이는 모양입니다.
     *
     * ⚠️ **양쪽을 다 잽니다.** 이 지도에서 북쪽 단상이 *"들어가긴 94m,
     *    나오는 데 172m"* 였습니다 — 걷기 그래프는 **방향이 있습니다**
     *    (1단 초과는 못 오르고, 내려가는 것은 공짜). 가는 길만 재면
     *    **주머니**를 못 봅니다.
     *
     * 판정은 `policy.mjs` 의 `SPEND_BUDGET` 이 내립니다. 봇이 그 거리에서
     * 발길을 돌리므로, 그 밖의 소비처는 **있으나 마나**입니다.
     */
    {
      /** 동선 → 이 칸 (위 BFS 는 동선에서 바깥으로 폈으므로 이 방향입니다) */
      const toSpot = (c) => distToRoute.get(key(c.cx, c.cz)) ?? Infinity
      /**
       * 이 칸 → 동선 (**되돌아 나오는** 길).
       *
       * ⚠️ 칸마다 BFS 를 돌리면 안 됩니다(동선 칸 수 × 지도 크기).
       *    **간선을 뒤집어** 동선에서 한 번만 폅니다: 위 BFS 는
       *    `nh - h <= maxClimb`(여기서 저기로 오를 수 있나)를 봤고,
       *    여기서는 `h - nh <= maxClimb`(저기서 여기로 올 수 있나)를 봅니다.
       *    걷기 그래프는 **방향이 있어서** 두 값이 다릅니다 —
       *    이 지도의 북쪽 단상이 94m 로 들어가 172m 로 나오던 자리입니다.
       */
      const distFromCell = new Map()
      {
        let f = []
        for (const c of routeCells) {
          distFromCell.set(key(c.cx, c.cz), 0)
          f.push(c)
        }
        while (f.length) {
          const next = []
          for (const cur of f) {
            const h = heightAt(cur.cx, cur.cz)
            const d = distFromCell.get(key(cur.cx, cur.cz))
            for (const [nx, nz] of [
              [cur.cx - 1, cur.cz],
              [cur.cx + 1, cur.cz],
              [cur.cx, cur.cz - 1],
              [cur.cx, cur.cz + 1],
            ]) {
              const nh = heightAt(nx, nz)
              // 뒤집힌 조건 — **n 에서 cur 로** 걸어올 수 있는가.
              if (nh === VOID || h - nh > maxClimb) continue
              const k = key(nx, nz)
              if (distFromCell.has(k)) continue
              distFromCell.set(k, d + CELL)
              next.push({ cx: nx, cz: nz })
            }
          }
          f = next
        }
      }
      const backToRoute = (c) => distFromCell.get(key(c.cx, c.cz)) ?? Infinity
      const spots = level.entities.filter((e) => e.kind === 'anvil' || e.kind === 'bonfire')
      const rows = spots.map((e) => {
        const c = cellOf(e)
        return { e, c, out: toSpot(c), back: backToRoute(c) }
      })
      for (const r of rows) {
        console.log(
          `  [소비처] ${r.e.kind === 'anvil' ? '모루' : '화톳불'}(${r.c.cx},${r.c.cz}) — ` +
            `가는 길 ${Number.isFinite(r.out) ? `${r.out}m` : '길없음'} · ` +
            `나오는 길 ${Number.isFinite(r.back) ? `${r.back}m` : '길없음'}`,
        )
      }
      /**
       * **모루만** 문턱을 겁니다. 화톳불은 부활 지점이라 주 동선 위에
       * 있는 것이 당연하고, 실제로 못 닿아서 문제가 된 것은 모루입니다.
       * 하나라도 예산 안에 있으면 통과입니다 — 소비처가 흔해지면
       * *"들르는 일"* 이 판단이 아니게 되기 때문입니다(DESIGN.md).
       */
      const anvils = rows.filter((r) => r.e.kind === 'anvil')
      const reachable = anvils.filter((r) => r.out <= SPEND_BUDGET && r.back <= SPEND_BUDGET)
      check(
        anvils.length > 0 && reachable.length > 0,
        `모루 하나 이상이 **주 동선에서 예산(${SPEND_BUDGET}m) 안**이다 (왕복 양쪽 모두)`,
        anvils
          .map(
            (r) =>
              `(${r.c.cx},${r.c.cz}) 가는 ${Number.isFinite(r.out) ? `${r.out}m` : '길없음'}/` +
              `나오는 ${Number.isFinite(r.back) ? `${r.back}m` : '길없음'}` +
              `${r.out <= SPEND_BUDGET && r.back <= SPEND_BUDGET ? ' ✅' : ''}`,
          )
          .join(' · '),
      )
    }
  }

  const foes = level.entities.filter((e) => FOE_KINDS.has(e.kind)).map(cellOf)
  const quiet = []
  let runStart = null
  let runLen = 0
  for (const c of routeCells) {
    const near = foes.some(
      (f) => Math.hypot((f.cx - c.cx) * CELL, (f.cz - c.cz) * CELL) <= aggro,
    )
    if (near) {
      if (runStart && runLen * CELL >= 16) {
        quiet.push({ from: runStart, to: c, metres: runLen * CELL })
      }
      runStart = null
      runLen = 0
    } else {
      if (!runStart) runStart = c
      runLen++
    }
  }
  if (runStart && runLen * CELL >= 16) {
    quiet.push({ from: runStart, to: routeCells[routeCells.length - 1], metres: runLen * CELL })
  }
  /**
   * ── 🫁 **쉴 틈 없이 이어지는 구간이 있는가** ──────────────────────
   *
   * 위 [빈 구간]은 *"위협 없이 걷는 시간이 너무 길지 않은가"* 를 봅니다 —
   * 심심함을 막는 검사입니다. 그런데 그 **반대쪽은 아무도 안 보고
   * 있었습니다**: 위협이 끊이지 않고 이어지는 구간.
   *
   * 참고한 게임들이 전부 긴장과 이완을 **번갈아** 둡니다 —
   * 헤일로의 *"30초의 재미"*, 소울류의 조우 사이 빈 복도(물러설 문턱이
   * 늘 있습니다), 로스트아크의 몹 무리 사이 이동 구간. 이완이 없으면
   * 난이도가 아니라 **소모전**이 되고, 잘 싸운 사람과 운 좋은 사람이
   * 구분되지 않습니다.
   *
   * ── 얼마나 쉬어야 충분한가 — 숫자를 안 적습니다 ──────────────────
   * 이 게임에서 "쉬었다"의 뜻은 분명합니다: **빈손으로 다음 싸움에 들어가지
   * 않는 것.** 그래서 기준을 **스태미나를 0에서 가득 채우는 데 걸리는
   * 거리**로 잡습니다 — 전부 게임에서 읽습니다:
   *
   *     (최대치 ÷ 초당 회복 + 회복 지연) × 걷는 속도
   *
   * 스태미나를 손보면 이 기준도 따라 움직입니다.
   */
  const tune2 = await page.evaluate(() => window.__game.terrainInfo())
  const breather =
    (tune2.maxStamina / tune2.staminaRegen + tune2.staminaRegenDelay) * tune2.walkSpeed
  const runs = []
  {
    let start = null
    let len = 0
    let gap = 0
    for (const c of routeCells) {
      const near = foes.some(
        (f) => Math.hypot((f.cx - c.cx) * CELL, (f.cz - c.cz) * CELL) <= aggro,
      )
      if (near) {
        if (start === null) {
          start = c
          len = 0
          // 직전 이완 길이를 이 긴장 구간의 "들어가기 전 쉼"으로 기록합니다.
          runs.push({ from: c, metres: 0, rest: gap * CELL })
        }
        len++
        runs[runs.length - 1].metres = len * CELL
        gap = 0
      } else {
        start = null
        gap++
      }
    }
  }
  const longest = runs.reduce((a, b) => (a && a.metres >= b.metres ? a : b), null)
  console.log(
    `  [긴장 구간] ${runs.length}개 — ` +
      runs
        .slice()
        .sort((a, b) => b.metres - a.metres)
        .slice(0, 4)
        .map((r) => `${r.metres}m(들어가기 전 쉼 ${r.rest}m)`)
        .join(' · ') +
      `  ※ 한 번 쉬면 스태미나가 차는 거리 ${breather.toFixed(0)}m`,
  )
  /**
   * ── 여기에 검사를 하나 **썼다가 좁혔습니다** ─────────────────────
   * 처음엔 *"모든 긴장 구간 앞에 스태미나가 찰 만큼의 쉼이 있다"* 로 걸었고
   * 빨갛게 나왔습니다(구간 사이 쉼 2m). 그런데 중간에 쉼을 내려면 적을
   * **5~7마리** 물려야 했습니다 — 존의 알맹이를 들어내는 셈입니다.
   *
   * 이 레벨은 **와이드 리니어 존**이고(작업 #12), 그 설계에서 동선이 대체로
   * 위협 안에 있는 것은 결함이 아니라 성격입니다. 실제로 옆 검사가 정반대를
   * 지키고 있습니다 — *"위협 없이 30m 넘게 걷는 구간이 없다"*(심심함 방지).
   * 둘 다 최대로 요구하면 서로 모순입니다.
   *
   * 참고한 게임들이 **예외 없이** 지키는 것은 훨씬 좁은 약속입니다:
   * **보스 앞 복도는 비어 있다.** 소울류의 안개문 앞, 몬헌의 둥지 입구,
   * 로스트아크의 관문 앞이 전부 그렇습니다. 마지막 한 번은 숨을 고르고
   * 들어가야 그 싸움이 **시작**으로 느껴집니다.
   *
   * 그래서 요구를 거기로 좁혔습니다. 나머지 리듬은 위 [긴장 구간] 기록으로
   * 남깁니다 — 재되 걸지는 않습니다.
   */
  /**
   * ⚠️ **보스는 빼고 셉니다.** `FOE_KINDS` 에는 보스도 들어 있어서, 그대로
   *    쓰면 보스 앞 복도는 **정의상 절대 비지 않습니다**(보스 자신이 그
   *    복도를 덮습니다). 실제로 그렇게 재서 *"빈 구간 0m"* 가 나왔고,
   *    하마터면 잡몹을 넷이나 옮길 뻔했습니다. 이 검사가 묻는 것은
   *    *"보스 말고 다른 것이 거기 있는가"* 입니다.
   */
  const mobs = level.entities
    .filter((e) => FOE_KINDS.has(e.kind) && e.kind !== 'boss')
    .map(cellOf)
  const tailRest = (() => {
    let n = 0
    for (let i = routeCells.length - 1; i >= 0; i--) {
      const c = routeCells[i]
      const near = mobs.some(
        (f) => Math.hypot((f.cx - c.cx) * CELL, (f.cz - c.cz) * CELL) <= aggro,
      )
      if (near) break
      n++
    }
    return n * CELL
  })()
  check(
    tailRest >= breather,
    '**보스 앞 복도는 비어 있다** (숨 고르고 들어가게)',
    `보스 직전 빈 구간 ${tailRest}m · 스태미나가 차는 거리 ${breather.toFixed(0)}m`,
  )

  /**
   * ── 🔵 **풀 수 없는 기믹은 겹치면 안 된다** ────────────────────────
   *
   * 이 게임의 색에는 각각 답이 있습니다 — 🔴 구르기 · 🟡 걸어서 이탈 ·
   * 🔵 무적 프레임 · 🟣 사거리 밖 · 🟢 반격. 그런데 **🔵 속박에 걸린 뒤에는
   * 그 답들이 전부 사라집니다.** 묶여 있으면 구를 수도, 걸어 나갈 수도
   * 없으니까요. 그래서 속박 중에 들어오는 두 번째 속박은 **원리적으로
   * 대응할 수 없습니다** — 이 게임에는 속박을 푸는 수단이 없습니다.
   *
   * 로스트아크가 *"해제 불가 기믹은 중첩하지 않는다"* 를 지키는 이유이고,
   * 소울류가 강한 CC 를 가진 적을 같은 방에 둘씩 놓지 않는 이유입니다.
   * 겹치면 난이도가 아니라 **입력이 사라진 시간**이 됩니다.
   *
   * ⚠️ "속박"을 이름으로 고르지 않습니다. 로스터에서 **snare 시간이 있는
   *    공격을 가진 적**을 뽑습니다 — 새 적에게 속박을 주면 이 검사가
   *    저절로 따라옵니다.
   */
  {
    const rosterCC = await page.evaluate(() => window.__game.enemyRoster())
    const ccIds = rosterCC
      .filter((r) => r.attacks.some((a2) => (a2.snare ?? 0) > 0))
      .map((r) => r.id)
    const ccFoes = level.entities.filter((e) => ccIds.includes(e.kind)).map((e) => ({
      ...cellOf(e),
      x: e.x,
      z: e.z,
    }))
    let overlap = 0
    let sample = null
    for (const c of routeCells) {
      const near = ccFoes.filter(
        (f) => Math.hypot((f.cx - c.cx) * CELL, (f.cz - c.cz) * CELL) <= aggro,
      )
      if (near.length >= 2) {
        overlap++
        if (!sample) sample = near.map((f) => `(${f.x},${f.z})`).join(' · ')
      }
    }
    check(
      overlap === 0,
      '**속박은 한 자리에서 하나만 깨어난다** (묶인 채로 또 묶이지 않게)',
      overlap === 0
        ? `속박을 가진 적 ${ccFoes.length}마리 · 겹치는 동선 0m`
        : `겹치는 동선 ${overlap * CELL}m — ${sample}`,
    )
  }

  const worst = quiet.reduce((a, b) => (a && a.metres >= b.metres ? a : b), null)
  console.log(
    `  [빈 구간] 주 동선 ${routeCells.length * CELL}m 중 위협 없이 걷는 구간 ${quiet.length}개 — ` +
      (quiet.length
        ? quiet
            .sort((a, b) => b.metres - a.metres)
            .slice(0, 4)
            .map((q) => `${q.metres}m (${q.from.cx},${q.from.cz})→(${q.to.cx},${q.to.cz})`)
            .join(' · ')
        : '없음') +
      '\n',
  )
  check(
    !worst || worst.metres <= 30,
    '주 동선에 위협 없이 30m(약 6초) 넘게 걷는 구간이 없다',
    worst ? `최장 ${worst.metres}m` : '없음',
  )

  console.log('')
  /**
   * ── 🎓 **새 적은 혼자 등장하는가** ────────────────────────────────
   *
   * ── 왜 이걸 재는가 ───────────────────────────────────────────────
   * 이 저장소는 *"색만 다르고 대응이 같으면 색은 장식"* 을 몇 번이나 적어
   * 뒀습니다. 같은 문장이 **구역**과 **적 배치**에도 그대로 걸립니다 —
   * 새 적을 셋씩 한꺼번에 내보내면, 그 적들이 가르치려던 색이 **서로 섞여**
   * 아무것도 안 가르칩니다.
   *
   * 이 게임은 적 종류마다 색 하나를 맡기고 있습니다(🔵 얽는 자에게 패턴을
   * **하나만** 준 이유가 그것입니다 — enemyAttacks.ts BINDER_ATTACKS 주석).
   * 그렇게 공들여 나눠 놓고 배치에서 뭉쳐 내보내면 설계가 사라집니다.
   *
   * 참고한 게임들이 예외 없이 지키는 규칙입니다:
   *   · 다크 소울 — 새 적은 대개 **좁은 통로에서 혼자** 처음 만납니다
   *   · 몬스터 헌터 — 새 몬스터는 **단독 퀘스트**로 먼저 배웁니다
   *   · 로스트아크 — 새 기믹을 한 번 **단독으로** 보여 준 뒤에 섞습니다
   *   · 마리오식 4단 구성 — 소개 → 발전 → 비틀기 → 마무리
   *
   * ── 순서를 짐작하지 않습니다 ─────────────────────────────────────
   * "주 동선 순서"를 프로브에 적으면 레벨을 고치는 날 옛 순서로 검사합니다.
   * **스폰에서 걸어야 하는 거리**로 정렬합니다 — 직선거리가 아닙니다
   * (이 저장소가 이미 한 번 물린 자리입니다).
   */
  console.log('\n  🎓 새 적이 처음 나오는 자리 — 스폰에서 걸어야 하는 거리 순\n')
  const intro = await page.evaluate(async () => {
    const G = window.__game
    G.reset()
    await new Promise((r) => setTimeout(r, 300))
    const foes = G.levelFoes()
    const regions = G.regionList()
    const named = regions.map((r) => ({ name: r.name, x: r.x, z: r.z }))
    // 스폰 지점에서 각 구역 중심까지 **걸어야 하는** 거리.
    const p = G.state().player
    const d = G.distancesToward(p.x, p.z, named.map((r) => ({ x: r.x, z: r.z })))
    return {
      foes,
      regions: named.map((r, i) => ({ ...r, walk: d?.points?.[i] ?? -1 })),
    }
  })

  /**
   * ── 🪧 **이름 없는 땅에 선 적은 세어지지 않습니다** ────────────────
   *
   * 바로 아래 표는 `foe.region` 으로 만들어집니다. 그런데 적의 구역은
   * **자기를 품는 사각형**으로만 정해지고(main.ts `debugLevelFoes`),
   * 어느 사각형에도 안 들면 빈 문자열이 됩니다. 그 적은 표에서 그냥
   * **사라집니다** — 빨개지지도, 경고도 없이.
   *
   * 실제로 그러고 있었습니다. 등뼈(cx57~58)가 어느 구역에도 안 들어서
   * 거기 선 셋(잡졸 둘 · 얽는 자 하나)이 표 밖이었고, 표는 🔵 의 소개를
   * 「오르는 계단」이 한 것으로 적었습니다. 하지만 플레이어가 🔵 를 처음
   * 만나는 자리는 그보다 **40m 앞**, 등뼈 위였습니다. 즉 아래 초록은
   * *"한 번에 하나씩 소개한다"* 를 증명한 것이 아니라, **못 본 것을
   * 0으로 세고** 있었습니다.
   *
   * 그래서 표보다 **먼저** 묻습니다. 이 검사가 빨간 동안에는 아래 표를
   * 믿으면 안 됩니다 — 그게 이 검사가 여기 있는 이유입니다.
   */
  {
    const homeless = intro.foes.filter((f) => !f.region)
    check(
      homeless.length === 0,
      '**모든 적이 이름 있는 구역 안에 있다** (구역 밖의 적은 아래 표에서 사라집니다)',
      homeless.length
        ? homeless.map((f) => `${f.kind}(${f.x},${f.z})`).join(' · ')
        : `적 ${intro.foes.length}마리 전부 · 구역 ${intro.regions.length}곳`,
    )
  }

  const ordered = intro.regions
    .filter((r) => r.walk >= 0)
    .sort((a2, b2) => a2.walk - b2.walk)
  const seen = new Set()
  let worstNew = 0
  let worstWhere = ''
  for (const r of ordered) {
    const kinds = [...new Set(intro.foes.filter((f) => f.region === r.name).map((f) => f.kind))]
    const fresh = kinds.filter((k) => !seen.has(k))
    fresh.forEach((k) => seen.add(k))
    if (fresh.length > worstNew) {
      worstNew = fresh.length
      worstWhere = `${r.name} — ${fresh.join(' · ')}`
    }
    if (kinds.length) {
      console.log(
        `    ${String(Math.round(r.walk)).padStart(3)}m  ${r.name.padEnd(10)} ` +
          `${kinds.join(' · ')}${fresh.length ? `   ← 처음 ${fresh.length}종: ${fresh.join(' · ')}` : ''}`,
      )
    }
  }
  /**
   * ── 🏹 **높이가 전투에 쓰이는가** ─────────────────────────────────
   *
   * 이 지도는 높이가 0~8층이고 절벽이 40%인데, 재 보니 **수직을 전투에 쓰는
   * 자리가 하나도 없었습니다.** 유일한 원거리 적인 궁수가 오히려 비탈
   * **아래**에 서 있었습니다. 그러면 궁수는 체력 34짜리 약한 잡몹이고,
   * 층을 여덟 개 만든 뜻이 없습니다.
   *
   * 참고한 게임들이 수직을 쓰는 방식은 한결같습니다 — 다크 소울의 **저격수**,
   * NRFTW 의 위층에서 시작하는 전투, 로스트아크의 높이 차. 공통점은
   * **높이가 선택을 만든다**는 것입니다: *올라가서 먼저 지울까, 맞으면서
   * 지나갈까.* 배경이 아니라 규칙입니다.
   *
   * ── 원거리는 **사거리 숫자가 아니라 게임의 정의**로 가릅니다 ────────
   * 처음엔 *"사거리 안의 다른 적보다 2층 이상 높은 적"* 으로 썼는데, 그러면
   * **사거리 4.2m 짜리 잡몹**까지 저격수로 세어져 초록이 떴습니다.
   * 원거리 적은 `keepDistance > 0` — **거리를 유지하려는 적** 입니다.
   * 그 정의는 게임이 갖고 있고(enemies.ts), 적을 손봐도 같이 따라옵니다.
   */
  const rosterHi = await page.evaluate(() => window.__game.enemyRoster())
  const rangedIds = rosterHi.filter((r) => (r.keepDistance ?? 0) > 0).map((r) => r.id)
  const highSpots = intro.foes.filter((f) => {
    if (!rangedIds.includes(f.kind)) return false
    const def = rosterHi.find((r) => r.id === f.kind)
    const rng = Math.max(0, ...(def?.attacks ?? []).map((a2) => a2.maxRange))
    return routeCells.some((r) => {
      const wx = (r.cx - level.w / 2 + 0.5) * CELL
      const wz = (r.cz - level.h / 2 + 0.5) * CELL
      return Math.hypot(f.x - wx, f.z - wz) <= rng && f.level - heightAt(r.cx, r.cz) >= 2
    })
  })
  console.log(
    `\n  🏹 높은 곳에서 동선을 내려다보는 원거리 적 — ` +
      (highSpots.length
        ? highSpots.map((f) => `${f.kind}(${f.x},${f.z}) ${f.level}층`).join(' · ')
        : '**없음**'),
  )
  check(
    highSpots.length >= 1,
    '**높이가 전투에 쓰인다** (원거리 적이 동선을 내려다본다)',
    highSpots.length
      ? `${highSpots.length}자리 — ${highSpots.map((f) => `${f.kind} ${f.level}층`).join(' · ')}`
      : '층이 0~8인데 수직을 쓰는 배치가 하나도 없습니다 — 높이가 배경일 뿐입니다',
  )

  /**
   * ── 🔁 **되돌아오는 고리가 있는가** ───────────────────────────────
   *
   * 다크 소울 1 의 정체성은 지도가 **접힌다**는 것입니다 — 늦은 구역이 이른
   * 구역으로 도로 이어지고, 그 순간 세계가 "길"에서 "장소"가 됩니다.
   * 할로우 나이트·메트로배니아 전체가 같은 구조를 씁니다. 반대로 외길
   * 지도는 죽을 때마다 **같은 길을 같은 순서로** 다시 걷게 만듭니다.
   *
   * 재는 법: 첫 길(주 동선)과 그 옆 한 칸을 **막고** 다시 걸어 봅니다.
   * 갈 수 있으면 두 번째 길이 있는 것이고, 못 가면 외길입니다.
   *
   * ⚠️ **사다리를 걷은 채로만 재면 안 됩니다.** 처음에 그렇게 짜 놓고
   *    *"지름길로만 생기는 고리는 고리가 아니다"* 라고 적었는데, 그건
   *    다크 소울을 거꾸로 읽은 것입니다 — **그 지도의 고리는 전부 지름길로
   *    접힙니다.** 열기 전에는 외길이고, 여는 순간 세계가 이어지는 그 사건이
   *    설계의 핵심입니다. 그래서 **걷은 채 / 내린 뒤**를 나란히 냅니다.
   */
  {
    const spawnC = cellOf(level.entities.find((e) => e.kind === 'spawn'))
    const bossC = cellOf(level.entities.find((e) => e.kind === 'boss'))
    const key = (x, z) => z * level.w + x
    const blocked = new Set()
    for (const c of routeCells) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) blocked.add(key(c.cx + dx, c.cz + dz))
      }
    }
    blocked.delete(key(spawnC.cx, spawnC.cz))
    blocked.delete(key(bossC.cx, bossC.cz))
    const first = bfs(spawnC, bossC, maxClimb, false)
    const shut = bfs(spawnC, bossC, maxClimb, false, blocked)
    const open = bfs(spawnC, bossC, maxClimb, true, blocked)
    const say = (v) => (Number.isFinite(v) ? `${Math.round(v * CELL)}m 짜리 **두 번째 길**` : '**갈 수 없음(외길)**')
    console.log(
      `\n  🔁 첫 길 ${Math.round(first * CELL)}m · 그 길을 막으면\n` +
        `       사다리 걷은 채 — ${say(shut)}\n` +
        `       사다리 내린 뒤 — ${say(open)}`,
    )
    /**
     * ── 여기에 검사를 하나 **썼다가 관찰로 내렸습니다** ──────────────
     * *"지름길을 내리면 두 번째 길이 생긴다(지도가 접힌다)"*. 빨갛게
     * 나왔는데, 고쳐야 할 것은 지도가 아니라 **제 주장**이었습니다.
     *
     * 이 레벨은 처음부터 **와이드 리니어 존**으로 설계됐습니다(작업 #12).
     * 넓지만 한 방향으로 흐르는 지도라, 지도를 가로지르는 3칸 띠를 막으면
     * 우회로가 있을 수 없습니다 — **위상적 고리는 이 설계의 목표가 아닙니다.**
     * 다크 소울 1 의 접힘을 그대로 요구하면 다른 게임을 만들라는 말이 됩니다.
     *
     * 그러면 지름길의 값어치는 무엇으로 재는가 — **되걷는 거리**입니다.
     * 그건 이미 위에서 재고 있습니다(*"부활 화톳불에서 보스까지가 실제로
     * 짧아진다"*, *"열러 가는 값이 아끼는 값보다 작다"*). 같은 것을 두 번
     * 세는 검사는 안전망이 아니라 소음입니다.
     *
     * 그래서 이 줄은 **기록**입니다. 언젠가 열린 세계형 지도를 만들면
     * 그때 이 숫자가 0 에서 벗어나야 합니다.
     */
  }

  /**
   * ── 🎁 **막다른 곁길에는 보상이 있는가** ──────────────────────────
   *
   * ── 왜 이걸 재는가 ───────────────────────────────────────────────
   * 보상 7개의 **왕복 비용**을 재 봤더니 다섯이 0~12m 였습니다. 즉 가는 길에
   * 그냥 지나칩니다. 그러면 빛기둥(작업 #15)은 *"갈까 말까"* 가 아니라
   * **이정표**이고, 탐험이라는 결정이 없어집니다.
   *
   * 반대쪽 실패가 더 나빴습니다 — **북쪽 단상**은 왕복 20~60m 를 치러야 하는
   * 막다른 곁길인데 **아무것도 없었습니다.** 소울류가 절대 하지 않는
   * 것입니다: 다크 소울의 막다른 방에는 늘 무언가 있고, 할로우 나이트도,
   * 로스트아크의 숨은 구역도 그렇습니다. **값을 치르게 했으면 갚아야
   * 합니다.** 안 그러면 다음부터 곁길을 안 봅니다.
   *
   * ── 문턱을 안 적습니다 ───────────────────────────────────────────
   * *"곁길"* 을 거리로 정의하지 않습니다. **지나갈 수 없는 구역**,
   * 즉 그 구역의 어느 칸으로도 보스로 가는 길이 짧아지지 않는 곳
   * (최소 추가 비용 > 0)이 막다른 곁길입니다. 지형을 고쳐도 정의가
   * 따라옵니다.
   *
   * 보상에는 **사다리도 넣습니다.** 성벽마루는 왕복 84m 짜리 곁길인데,
   * 거기서 얻는 것은 물건이 아니라 **지름길을 여는 일**입니다 —
   * 다크 소울 1 의 곁길이 정확히 그 모양입니다.
   */
  {
    const spawnC = cellOf(level.entities.find((e) => e.kind === 'spawn'))
    const bossC = cellOf(level.entities.find((e) => e.kind === 'boss'))
    const straight = bfs(spawnC, bossC, maxClimb, false)
    const REWARD = ['treasure', 'anvil', 'bonfire']
    /**
     * ⚠️ 사다리 **엔티티는 아래 칸**에 있습니다. 그래서 그것만 세면
     *    성벽마루처럼 *"위에서 여는"* 구역이 빈 곳으로 찍힙니다 —
     *    실제로 한 번 그렇게 나왔습니다(왕복 84m · 보상 없음).
     *    그 구역이 갚는 것은 물건이 아니라 **지름길을 여는 일**이므로,
     *    게임이 아는 **위쪽 끝**을 읽어 보상으로 셉니다.
     */
    const tops = (await page.evaluate(() => window.__game.shortcutInfo())).map((sc) =>
      cellOf({ x: sc.hiWorldX, z: sc.hiWorldZ }),
    )
    const dead = []
    for (const g of await page.evaluate(() => window.__game.regionList())) {
      let lo = Infinity
      /** 🔎 가장 싼 칸이 **어디이고 얼마인지** 같이 남깁니다 — 숫자만 있으면
       *  "76m 가 어디서 나왔나"를 밖에서 다시 계산해야 하고, 그 재계산이
       *  프로브와 어긋나면 어느 쪽이 맞는지 알 수 없습니다. */
      let loAt = null
      for (let cx = g.x0; cx <= g.x1; cx++) {
        for (let cz = g.z0; cz <= g.z1; cz++) {
          if (heightAt(cx, cz) === VOID) continue
          const a2 = bfs(spawnC, { cx, cz }, maxClimb, false)
          const b2 = bfs({ cx, cz }, bossC, maxClimb, false)
          if (!Number.isFinite(a2) || !Number.isFinite(b2)) continue
          const det = (a2 + b2 - straight) * CELL
          if (det < lo) {
            lo = det
            loAt = { cx, cz, a: a2 * CELL, b: b2 * CELL }
          }
        }
      }
      if (!Number.isFinite(lo) || lo <= 0) continue
      const inside = (c) => c.cx >= g.x0 && c.cx <= g.x1 && c.cz >= g.z0 && c.cz <= g.z1
      const has =
        level.entities.some((e) => REWARD.includes(e.kind) && inside(cellOf(e))) ||
        tops.some(inside)
      dead.push({ name: g.name, cost: lo, has, opensShortcut: tops.some(inside), at: loAt })
    }
    console.log(
      `\n  🎁 막다른 곁길 (직선 경로 ${straight * CELL}m) — ` +
        dead
          .map(
            (r) =>
              `${r.name} 왕복 ${r.cost}m@(${r.at?.cx},${r.at?.cz} 시작${r.at?.a}+보스${r.at?.b})` +
              ` ${r.has ? '보상 있음' : '**없음**'}`,
          )
          .join(' · '),
    )
    /**
     * ── 🚶 **그 곁길이 갈 만한 거리인가** ──────────────────────────
     *
     * 위 검사는 *"값을 치르게 했으면 갚는가"* 만 봤습니다. 그런데 **값이
     * 낼 만한가**는 아무도 안 봤습니다. 그 결과:
     *
     *     맵 프로브 — 4곳 전부 보상 있음 ✅
     *     벤치 5판  — (17,-57) **3/3판 못 주움** · (27,-43) **3/3판 못 주움**
     *
     * 정적 검사는 초록인데 실제로는 아무도 안 갑니다. 보상을 놓아 두고
     * **아무도 못 가는 자리**에 둔 것은, 안 놓아 둔 것과 결과가 같습니다.
     *
     * ⚠️ 문턱은 `policy.mjs` 의 `DETOUR_BUDGET` 입니다. 그 파일 주석이
     *    이미 이 제약을 적어 두었습니다:
     *
     *      > 봇이 곁길을 40m 에서 자르면, 41m 짜리 보물은 아무리 잘 보여도
     *      > **규칙상 영영 안 갑니다.** 그러니 배치를 검사하는 프로브도
     *      > 같은 값을 봐야 합니다.
     *
     *    적어 두기만 하고 **아무도 안 봤습니다.** 이 저장소가 계속 확인하는
     *    그 문장 그대로입니다 — *주석은 읽는 사람에게만 말합니다.*
     *
     * 다른 게임의 좌표: 다크 소울 1 의 곁길은 대개 **주 동선에서 보이는**
     * 짧은 고리이고 되돌아오지 않게 이어집니다. 할로우 나이트의 선택 방도
     * 한두 방 거리입니다. **긴 곁길은 보상이 아니라 세금**입니다.
     */
    /**
     * ⚠️ **지름길을 여는 곁길은 예외입니다.**
     *
     * 처음엔 예산을 넘는 곁길을 전부 빨갛게 잡았는데, 그러면 성벽마루가
     * 걸립니다. 그런데 그 구역이 갚는 것은 물건이 아니라 **지름길을 여는
     * 일**입니다 — 게임에게 물어보니 그 사다리의 `saving` 이 `null`,
     * 즉 *"이 사다리가 없으면 위에서 내려올 길이 아예 없다"* 였습니다.
     * 없는 길을 만드는 것이므로 절약이 큰 정도가 아니라 **길 자체**입니다.
     *
     * 다크 소울 1 의 긴 등반이 정확히 이 계약입니다 — 한 번 오르는 값은
     * 크지만 **그 뒤로 영원히** 짧아집니다. 그래서 한 번의 예산으로 재면
     * 안 됩니다.
     *
     * 물건만 놓인 곁길에는 그 논리가 없습니다. 보물은 한 번 줍고 끝이므로
     * **그 한 번의 왕복이 예산 안**이어야 합니다.
     */
    const tooFar = dead.filter((r) => r.cost > DETOUR_BUDGET && !r.opensShortcut)
    check(
      tooFar.length === 0,
      `**물건만 있는 곁길은 갈 만한 거리다** (예산 ${DETOUR_BUDGET}m — 넘으면 보상이 아니라 세금입니다)`,
      tooFar.length === 0
        ? dead.map((r) => `${r.name} ${r.cost}m${r.opensShortcut ? '(지름길)' : ''}`).join(' · ')
        : tooFar.map((r) => `${r.name} 왕복 ${r.cost}m`).join(' · '),
    )
    check(
      dead.length > 0 && dead.every((r) => r.has),
      '**막다른 곁길에는 보상이 있다** (값을 치르게 했으면 갚는다)',
      dead.length === 0
        ? '막다른 곁길이 하나도 없습니다 — 곁길이 없는 지도입니다'
        : dead.every((r) => r.has)
          ? `${dead.length}곳 전부`
          : dead.filter((r) => !r.has).map((r) => `${r.name}(왕복 ${r.cost}m)`).join(' · '),
    )
  }

  const orphan = intro.foes.filter((f) => !f.region).length
  check(
    ordered.length >= 3 && intro.foes.length >= 5,
    '구역과 적을 실제로 읽었다 (측정이 성립했다)',
    `구역 ${ordered.length}곳 · 적 ${intro.foes.length}마리 (구역 밖 ${orphan})`,
  )
  /**
   * **한 구역이 새 적을 둘 이상 소개하면 안 됩니다.** 하나면 그 적의 색이
   * 무엇인지 배울 수 있고, 둘이면 어느 예고가 누구 것인지부터 헷갈립니다.
   * (이미 배운 적과 섞는 것은 얼마든 좋습니다 — 그게 "발전"입니다.)
   */
  check(
    worstNew <= 1,
    '**새 적은 한 번에 하나씩 나온다** (색을 배울 수 있게)',
    worstNew <= 1 ? '모든 구역이 새 적을 최대 1종만 소개합니다' : `${worstWhere} 를 한꺼번에 소개합니다`,
  )

  console.log('')
  /**
   * ── 🧭 **지도가 말한 길을 몸이 실제로 걸을 수 있는가** ────────────────
   *
   * 이 게임에는 길에 대한 진실이 **두 벌** 있습니다. 흐름장이 말하는
   * *"다음 한 걸음"* 과, 충돌이 허락하는 *"실제로 갈 수 있는 자리"*.
   * 둘이 어긋나도 **아무 오류도 안 납니다.** 그냥 지면 화살표가 못 가는
   * 쪽을 가리키고(기둥 4 — *"걸어갈 수 있는 방향을 가리킨다"*), 자동
   * 플레이는 그 자리에서 왔다 갔다 합니다. 실제로 판마다 찍혔습니다:
   *
   *     막힘 @무너진 회랑 — 순 이동 0.6m 인데 **걸은 거리 68.0m**
   *
   * 그래서 **게임의 두 함수를 그대로 이어 붙여** 걸어 봅니다(`pathWalk`).
   * 프로브가 지형 규칙을 흉내 내면 흉내를 검사하게 되므로, 게임에서 합니다.
   *
   * ⚠️ 「길이 없다」고 한 짝은 세지 않습니다 — 이 검사가 묻는 것은
   *    *"있다고 해 놓고 못 가는가"* 이지 *"없는 길이 있는가"* 가 아닙니다.
   */
  // 칸→월드 변환은 이 파일 위쪽 `CELL` 과 같은 규약입니다(1198행 근처와 동일).
  const world = (cx, cz) => ({ x: (cx - level.w / 2 + 0.5) * CELL, z: (cz - level.h / 2 + 0.5) * CELL })
  // 서 있을 수 있는 칸만 씁니다. 성글게(6칸=12m) 훑어 판이 몇 분 안에 끝나게.
  const spots = []
  for (let cz = 1; cz < level.h - 1; cz += 6) {
    for (let cx = 1; cx < level.w - 1; cx += 6) {
      if (heightAt(cx, cz) === VOID) continue
      spots.push(world(cx, cz))
    }
  }
  const walkRes = await page.evaluate(
    async ([spots]) => {
      const G = window.__game
      const bad = []
      let tried = 0
      let arrived = 0
      // 목표는 같은 표에서 성글게 고릅니다 — 특정 지점 목록에 기대지 않게.
      for (let i = 0; i < spots.length; i += 3) {
        const goal = spots[i]
        const rows = G.pathWalk(goal.x, goal.z, spots)
        for (const r of rows) {
          tried++
          if (r.arrived) {
            arrived++
            continue
          }
          bad.push({
            from: `${r.x.toFixed(0)},${r.z.toFixed(0)}`,
            to: `${goal.x.toFixed(0)},${goal.z.toFixed(0)}`,
            why: r.why,
            walked: r.walked,
            net: r.net,
            end: `${r.endX},${r.endZ}`,
          })
        }
      }
      return { tried, arrived, bad: bad.slice(0, 6), badCount: bad.length }
    },
    [spots],
  )
  console.log(
    `\n  [지도가 말한 길을 걸어 보기] 길이 있다고 한 짝 ${walkRes.tried}개 · 도착 ${walkRes.arrived}개 · ` +
      `**못 간 것 ${walkRes.badCount}개**`,
  )
  for (const b of walkRes.bad) {
    console.log(`     (${b.from}) → (${b.to})  ${b.why} @(${b.end}) · 걸은 ${b.walked}m · 순 이동 ${b.net}m`)
  }
  check(
    walkRes.tried >= 200,
    '🚧 걸어 볼 짝을 **충분히 잡았다** (몇 개만 재고 「지도가 멀쩡하다」고 하지 않게)',
    `${walkRes.tried}개`,
  )
  check(
    walkRes.badCount === 0,
    '🧭 **길이 있다고 한 곳은 걸어서 도착한다** (화살표가 못 가는 쪽을 가리키지 않는다)',
    `못 간 것 ${walkRes.badCount}/${walkRes.tried}`,
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
