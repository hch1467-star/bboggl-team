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
function bfs(from, to, maxClimb, openLadders) {
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

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
