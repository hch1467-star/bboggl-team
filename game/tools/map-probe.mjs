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
/**
 * 🪜 이 사다리가 **여는 값**(m) — 걷힌 채로 아래 칸에서 위 칸까지 걸어야
 *    하는 거리. 내리고 나면 그게 한 칸(2m)이 됩니다. 못 가면 Infinity 라
 *    「길이 아예 없던 곳을 잇는다」는 뜻이고, 그건 최고로 값진 사다리입니다.
 */
function ladderSaving(hi, maxClimb, cellSize) {
  const d = bfs({ cx: hi.loX, cz: hi.loZ }, { cx: hi.hiX, cz: hi.hiZ }, maxClimb, false)
  return Number.isFinite(d) ? d * cellSize : Infinity
}

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

/**
 * **여러 칸에서 한꺼번에 퍼지는 걸음 거리 장(場)** — *"이 칸이 그 길에서
 * 걸어서 몇 m 인가"* 를 지도 전체에 대해 한 번에 답합니다.
 *
 * 원래 이 스무 줄은 「색을 가르치는 적」 검사 안에만 있었습니다. 그런데
 * 아래에서 **두 번째 길**에도 같은 것을 묻게 되면서 한 벌 더 쓸 뻔했습니다.
 * 「규칙은 한 곳에만」 — 같은 자를 두 곳에서 따로 만들면 언젠가 둘이
 * 어긋납니다. 이 저장소는 그 사고를 이미 세 번 냈습니다(동선을 세 곳에서
 * 따로 그리던 시절).
 *
 * ⚠️ **직선거리가 아니라 걸어야 하는 거리**입니다. 게임이 적을 깨우는
 *    자와 같습니다(enemyAI.ts `reachDistance`).
 */
function walkField(cells, maxClimb, CELL) {
  const key = (x, z) => z * level.w + x
  const dist = new Map()
  let frontier = []
  for (const c of cells) {
    dist.set(key(c.cx, c.cz), 0)
    frontier.push(c)
  }
  while (frontier.length) {
    const next = []
    for (const cur of frontier) {
      const h = heightAt(cur.cx, cur.cz)
      const d = dist.get(key(cur.cx, cur.cz))
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
        dist.set(k, d + CELL)
        next.push({ cx: nx, cz: nz })
      }
    }
    frontier = next
  }
  return dist
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
  /**
   * ⚠️ **이 검사는 오랫동안 사다리를 「하나만」 봤습니다** (`ladderLinks()[0]`).
   *
   * 그래서 두 번째 사다리가 **아끼는 값 0m** 인 채로 오래 남아 있었습니다 —
   * 바로 옆에 걸어서 오르는 계단이 생겼는데 사다리만 그대로였던 것입니다.
   * 자동 플레이의 장부에 눈금을 붙이고서야 드러났습니다:
   *
   *     사다리(56,18) — **아끼는 값 0m** · 곁에 간 적이 없다
   *
   * 이 저장소가 `.every(` 에 길이 게이트를 세우는 이유와 같은 병입니다 —
   * **여럿 중 하나만 보면 나머지는 검사받지 않습니다.** 전부 봅니다.
   */
  for (const hi of ladderLinks()) {
    const key = `${hi.loX},${hi.loZ}`
    const detour =
      bfs(respawnFire, { cx: hi.hiX, cz: hi.hiZ }, maxClimb, false) +
      bfs({ cx: hi.hiX, cz: hi.hiZ }, boss, maxClimb, false) -
      closed
    /**
     * 🪜 **아끼는 값이 0 이면 그건 지름길이 아니라 장식입니다.**
     *    사다리마다 따로 잽니다 — 걷힌 채로 아래 칸에서 위 칸까지 걸어야
     *    하는 거리가 곧 그 사다리가 여는 값입니다(게임이 잽니다).
     */
    const saves = ladderSaving(hi, maxClimb, CELL)
    check(
      saves > 2,
      `사다리(${key})는 **실제로 아끼는 것이 있다** (0m 짜리는 지름길이 아니라 장식입니다)`,
      `내리면 ${Math.round(saves)}m 가 한 칸(2m)이 됩니다`,
    )
    check(
      detour * CELL < (closed - opened) * CELL,
      `사다리(${key})를 열러 가는 값이 아끼는 값보다 작다 (가던 길에서 잠깐 옆으로)`,
      `추가로 걷는 거리 ${detour * CELL}m vs 매 판 아끼는 거리 ${(closed - opened) * CELL}m`,
    )
  }

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
  /**
   * ── ⚠️ **「모든 배치물은 닿아야 한다」가 더는 참이 아닙니다** ──────────
   *
   * 이 검사는 *"지형을 손으로 그리다 한 칸 차이로 섬이 생기는 것"* 을
   * 잡으려고 만들었고, 그 목적은 지금도 옳습니다. 그런데 그 뒤에
   * **일부러 못 가게 둔 배치물**이 생겼습니다:
   *   · 🧱 부술 수 있는 벽 **뒤**의 보물 — 벽을 부숴야 들어갑니다
   *   · 🎁💥 **선반 위**의 보물과 통 — 폭발로 떨어뜨려야 줍습니다
   * 둘 다 「섬」이 아니라 **설계**입니다. 그대로 두면 이 검사는
   * *"퍼즐을 없애라"* 고 말하게 됩니다.
   *
   * ⚠️ 그리고 이 줄은 **선반 장치를 놓은 회차부터 계속 빨간불이었습니다.**
   *    저는 그동안 `map` 을 안 돌렸습니다. 이 저장소가 이번 세션에 두 번째로
   *    겪는 「안 읽은 빨강」입니다(첫 번째는 `upgrade` 의 정련석 줄).
   *
   * ── 무르게 하지 않고 **갈래를 나눕니다** ──────────────────────────
   *   · 닿는 것이 **기본**입니다 — 아래 첫 검사 그대로.
   *   · 못 닿는 것은 **답이 있어야** 합니다 — 폭발 반경 안에 통이 있거나,
   *     부술 수 있는 벽이 곁에 있거나. 답이 없으면 그건 **섬**이고
   *     여전히 빨강입니다.
   * (장치가 실제로 굴러가는지는 `npm run drop` · `npm run wall` 이 봅니다.
   *  여기서는 *"이게 섬인가 설계인가"* 만 가릅니다.)
   */
  const spawn = cellOf(level.entities.find((e) => e.kind === 'spawn'))
  const blastR = await page.evaluate(() => window.__game.barrelInfo().blast)
  const barrelsAt = level.entities.filter((e) => e.kind === 'barrel')
  const wallsAt = level.entities.filter((e) => e.kind === 'crackedWall' || e.kind === 'thickWall')
  const unreachable = []
  const byDesign = []
  for (const e of level.entities) {
    if (e.kind === 'spawn' || e.kind === 'ladder') continue
    const c = cellOf(e)
    if (Number.isFinite(bfs(spawn, c, maxClimb, false))) continue
    const near = (list, r) => list.some((o) => Math.hypot(o.x - e.x, o.z - e.z) <= r)
    // 💥 폭발이 닿으면 「떨어뜨리기」, 벽이 곁이면 「벽 뒤」 — 둘 다 답이 있습니다.
    if (near(barrelsAt, blastR)) byDesign.push(`${e.kind}(${c.cx},${c.cz})💥`)
    else if (near(wallsAt, 4)) byDesign.push(`${e.kind}(${c.cx},${c.cz})🧱`)
    else unreachable.push(`${e.kind}(${c.cx},${c.cz})`)
  }
  check(
    unreachable.length === 0,
    '시작 지점에서 못 닿는 배치물이 **섬이 아니다** (답이 있거나 · 걸어서 닿거나)',
    unreachable.length
      ? `**답이 없습니다** — ${unreachable.join(' · ')}`
      : `걸어서 닿는 것 ${level.entities.length - 2 - byDesign.length}개 · 답이 있어 일부러 못 가게 둔 것 ${byDesign.length}개${byDesign.length ? ` (${byDesign.join(' · ')})` : ''}`,
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
  /**
   * ── 🧭 **동선은 게임에게 그려 달라고 합니다** ────────────────────────
   *
   * 여기에는 *"시작 화톳불 → 보스 최단 경로"* 를 **이 파일이 직접 BFS 로**
   * 그리는 코드가 있었습니다. 흉내는 언젠가 갈라지고, 실제로 갈라졌습니다 —
   * 길안내에 「되돌아올 수 없는 길」의 값(`ONE_WAY_COST`)이 생긴 뒤로
   * 게임은 남쪽 낙하를 피하는데 이 BFS 는 그대로 그리로 갔습니다.
   * 그 결과 *"보스 앞 복도는 비어 있다"* 가 **20m** 로 빨갛게 떴는데,
   * 게임이 실제로 안내하는 길로 재면 **62m** 였습니다.
   *
   * **없는 길의 박자를 재고 있었습니다.** 이 파일의 다른 BFS 들은 그대로
   * 둡니다 — 저건 「몇 미터인가」를 재는 자라 값이 없는 쪽이 맞습니다.
   * 갈라지면 안 되는 것은 **어느 길로 가는가** 하나뿐입니다.
   */
  /**
   * ⚠️ **재기 전에 판을 되돌립니다 — 이 줄이 없어서 한 번 크게 속았습니다.**
   *
   * 이 파일은 위쪽에서 **사다리를 실제로 내려 봅니다**(「위에서는 내릴 수
   * 있다고 안내한다」). 그 상태가 그대로 남아 있으면 길찾기가 **열린
   * 지름길로** 길을 그립니다. 실제로 그렇게 나왔습니다:
   *
   *     🧭 주 동선 — 66칸(132m) · **세로 6m**   ← 등뼈를 관통하는 직선
   *
   * 처음 플레이어가 걷는 길은 사다리가 **걷힌** 상태의 길입니다. 켠 스위치를
   * 안 끄고 다음 절로 넘어가 판을 망친 것이 이 저장소에서만 세 번째입니다.
   *
   * ⚠️ **`reset()` 으로는 안 됩니다.** 내린 사다리는 **세이브에 남습니다**
   *    (「한 번 내리면 게임을 다시 켜도 내려져 있다」는 이 파일이 검사하는
   *    기능입니다). 그래서 진행도까지 지웁니다 — `resetProgress()`.
   *    실제로 `reset()` 만 불렀을 때 동선이 **그대로 132m 직선**이었고,
   *    하마터면 "사다리 탓이 아니었네" 하고 다른 데를 팔 뻔했습니다.
   */
  await page.evaluate(() => {
    window.__game.resetProgress()
    window.__game.reset()
  })
  await new Promise((r) => setTimeout(r, 300))
  const routeCells = (
    await page.evaluate(
      ([fx, fz, bxw, bzw]) => window.__game.routeTrail(fx, fz, bxw, bzw),
      [
        (startFire.cx - level.w / 2 + 0.5) * CELL,
        (startFire.cz - level.h / 2 + 0.5) * CELL,
        (boss.cx - level.w / 2 + 0.5) * CELL,
        (boss.cz - level.h / 2 + 0.5) * CELL,
      ],
    )
  ).map((p) => ({ cx: Math.floor(p.x / CELL + level.w / 2), cz: Math.floor(p.z / CELL + level.h / 2) }))
  /**
   * ── 🧭 **이 선이 「게임이 안내하는 길」과 같은가** ─────────────────────
   *
   * ── 오래 품고 있던 의심 ──────────────────────────────────────────
   * 이 파일의 배치 검사 열 몇 개가 전부 **「주 동선」**(화톳불→보스 최단로)
   * 위에서 이뤄집니다. `tools/playthrough.mjs` 에 이런 의심이 적혀
   * 있었습니다:
   *
   *     *"「주 동선」은 **아무도 걷지 않는 길**일 수 있는데, 그 위에서 하는
   *       배치 검사 열 몇 개가 전부 없는 길을 재고 있는 셈입니다."*
   *
   * 그럴 만한 이유가 있었습니다 — 봇이 판마다 이 선의 **절반**밖에
   * 안 지납니다(49~52%). 그 절반이 **길이 틀려서**인지 **봇이 딴 데로
   * 새서**인지는 아무도 안 재 봤습니다. 처방이 정반대입니다:
   * 앞이면 **프로브를 고쳐야** 하고, 뒤면 **봇을 고쳐야** 합니다.
   *
   * ── 재 봤습니다 ──────────────────────────────────────────────────
   *     주 동선 100칸 · 안내를 따라 걸은 길 104걸음
   *     서로 14m 안으로 덮는 비율 **양방향 100%** · 가장 먼 어긋남 **4m**
   *
   * **같은 길입니다.** 의심은 풀렸고, 봇의 49% 는 길이 아니라
   * **봇의 발** 이야기입니다(곁길·전투로 새는 것).
   *
   * ⚠️ 그래서 이 사실을 **검사로 올립니다.** 지금 초록인 성질이고,
   *    안내 규칙(`findObjective`)이나 길찾기를 손보는 날 둘이 갈라지면
   *    **그때 빨개져야** 합니다 — 안 그러면 이 파일의 검사 전부가
   *    조용히 없는 길을 재게 됩니다.
   */
  {
    const guide = await page.evaluate(async () => {
      const G = window.__game
      const nap = () => new Promise((r) => setTimeout(r, 8))
      G.reset()
      await nap()
      G.freezeEnemies(true)
      await nap()
      const out = []
      let guard = 0
      while (guard++ < 4000) {
        const obj = G.objective()
        if (!obj) break
        const p = G.state().player
        out.push({ x: p.x, z: p.z })
        if (obj.walkDist <= 1.5) {
          G.teleportPlayer(obj.x, obj.z)
          await nap()
          const next = G.objective()
          if (!next || (Math.abs(next.x - obj.x) < 0.01 && Math.abs(next.z - obj.z) < 0.01)) break
          continue
        }
        const step = G.pathStep(obj.x, obj.z)
        if (!step) break
        G.teleportPlayer(step.x, step.z)
        await nap()
      }
      G.freezeEnemies(false)
      G.reset()
      await nap()
      return out
    })
    const routeW = routeCells.map((c) => ({
      x: (c.cx - level.w / 2 + 0.5) * CELL,
      z: (c.cz - level.h / 2 + 0.5) * CELL,
    }))
    const nearestTo = (pts, q) => {
      let b = Infinity
      for (const p of pts) b = Math.min(b, Math.hypot(p.x - q.x, p.z - q.z))
      return b
    }
    const rToG = routeW.map((r) => nearestTo(guide, r))
    const gToR = guide.map((g) => nearestTo(routeW, g))
    // 문턱은 **어그로 거리**를 씁니다 — 이 파일의 다른 배치 검사가 쓰는 자와 같게.
    const LIM = 14
    const pct = (arr) => Math.round((arr.filter((d) => d <= LIM).length / Math.max(1, arr.length)) * 100)
    const worst = Math.round(Math.max(0, ...rToG, ...gToR))
    check(
      guide.length > 20 && pct(rToG) >= 95 && pct(gToR) >= 95,
      '🧭 **「주 동선」이 게임이 안내하는 길과 같은 선이다** (없는 길 위에서 배치를 재지 않게)',
      `주 동선 ${routeW.length}칸 · 안내 ${guide.length}걸음 · 서로 ${LIM}m 안 ${pct(rToG)}%/${pct(gToR)}% · 가장 먼 어긋남 ${worst}m`,
    )
  }
  {
    // 🧭 동선 자체를 눈금으로 남깁니다 — 이 선이 틀리면 아래 배치 검사가
    //    전부 **없는 길**을 재게 됩니다. 그때 제일 먼저 볼 줄입니다.
    const zsr = routeCells.map((c) => (c.cz - level.h / 2 + 0.5) * CELL)
    const xsr = routeCells.map((c) => (c.cx - level.w / 2 + 0.5) * CELL)
    /**
     * ⚠️ **아래 🔁 줄의 「첫 길 194m」과 이 줄의 200m 은 다른 값이 맞습니다.**
     *    같은 화면에 6m 차이 나는 두 길이가 아무 설명 없이 찍혀 있으면
     *    버그로 읽힙니다. 다른 이유가 **둘** 있어서 그렇습니다:
     *
     *      ① 출발점이 다릅니다 — 이 줄은 **부활 화톳불**에서, 🔁 줄은
     *         **스폰**에서 잽니다. 🔁 이 묻는 것은 "막으면 다른 길이
     *         있는가"라 판 전체를 봐야 하고, 이 줄이 묻는 것은 "죽고 나서
     *         매번 걷는 길"이라 화톳불에서 시작하는 게 맞습니다.
     *      ② 규칙이 다릅니다 — 이 줄은 **게임의 안내가 실제로 미는 길**
     *         (`routeTrail`, 되돌아올 수 없는 낙차에 `ONE_WAY_COST` 벌점),
     *         🔁 줄은 **칸 수만 세는 BFS**입니다. 그래서 이 줄이 몇 칸
     *         **더 깁니다** — 안내가 사람을 절벽으로 안 밀기 때문입니다.
     *         그 차이가 0 이 되면 벌점이 일을 안 하고 있다는 뜻입니다.
     *
     *    갈라지면 안 되는 것은 **어느 길로 가는가** 하나뿐이고, 그건 이제
     *    전부 `routeTrail` 한 곳에서 나옵니다.
     */
    console.log(
      `\n  🧭 주 동선 (화톳불→보스, 게임의 안내가 미는 길) — ` +
        `${routeCells.length}칸 (${routeCells.length * CELL}m) · ` +
        `가로 ${Math.max(...xsr) - Math.min(...xsr)}m · 세로 ${Math.max(...zsr) - Math.min(...zsr)}m · ` +
        `끝 (${xsr[xsr.length - 1]},${zsr[zsr.length - 1]})`,
    )
    /**
     * ── 🗺️ `MAP_ART=1 npm run map` — 판을 **글자로 그려 봅니다** ──────
     *
     * 왜 넣었나: 위 배치 검사들이 *"(66,32) 동선까지 22m"* 같은 숫자만
     * 내놓습니다. 그 숫자로 **어디로 옮겨야 하는지**는 알 수 없습니다 —
     * 22m 를 줄이려면 어느 방향으로 몇 칸인지는 동선의 **모양**을 봐야
     * 알고, 모양은 좌표 목록으로는 안 보입니다. 실제로 이 그림이 없어서
     * 「동선을 남쪽으로 휘게 한다」를 **세 번 시도해서 세 번 되돌렸습니다**.
     *
     * 기본 실행에서는 안 찍습니다 — 눈금이 아니라 **연장**이라서, 판정에
     * 섞이면 통과/실패를 읽는 눈을 가립니다.
     *
     *   =  주 동선     f 화톳불   A 모루   L 사다리   T 보물
     *   g  잡졸  c 달려드는 자  b 얽는 자  d 끄는 자  a 쏘는 자  B 보스
     *   ·  걸을 수 있는 칸       (빈칸) 허공
     */
    if (process.env.MAP_ART) {
      const GLYPH = {
        grunt: 'g', charger: 'c', binder: 'b', dragger: 'd', archer: 'a',
        boss: 'B', bonfire: 'f', anvil: 'A', ladder: 'L', treasure: 'T', spawn: 'S',
      }
      const art = []
      for (let cz = 0; cz < level.h; cz++) {
        art.push(
          Array.from({ length: level.w }, (_, cx) =>
            heightAt(cx, cz) === VOID ? ' ' : '·',
          ),
        )
      }
      for (const c of routeCells) if (art[c.cz]) art[c.cz][c.cx] = '='
      // 배치물이 동선을 덮어씁니다 — 여기서 알고 싶은 것은 "무엇이 있나" 입니다.
      for (const e of level.entities) {
        const g = GLYPH[e.kind]
        if (!g) continue
        const { cx, cz } = cellOf(e)
        if (art[cz]) art[cz][cx] = g
      }
      // 동선이 지나는 띠만 잘라 냅니다 — 88×72 를 다 찍으면 허공이 대부분입니다.
      const zs = routeCells.map((c) => c.cz)
      const lo = Math.max(0, Math.min(...zs) - 8)
      const hi = Math.min(level.h - 1, Math.max(...zs) + 8)
      console.log(`\n  🗺️  cz ${lo}‥${hi} (cx 0‥${level.w - 1})`)
      for (let cz = lo; cz <= hi; cz++) {
        console.log(`  ${String(cz).padStart(2)} ${art[cz].join('')}`)
      }
    }
  }

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
  /**
   * ⚠️ **이 검사는 아래 🔴 절로 옮겼습니다.** 두 가지 때문입니다:
   *
   *   ① 여기 있던 사거리 `12` 는 **손으로 베낀 상수**였습니다. 아래
   *      절은 같은 값을 로스터에서 읽습니다 — 밸런스를 바꾸는 날
   *      검사만 옛말을 하는 것이 이 저장소의 단골 사고입니다.
   *   ② 이제 길이 **둘**이라(🛣 절) 이 물음은 *"어느 길을 덮는가"* 로
   *      바뀌어야 하는데, 그 두 번째 길은 이 줄보다 아래에서 그려집니다.
   *
   * 「한 물음은 한 자리에」 — 쏘는 자에 대한 물음은 전부 아래 🔴 절에
   * 모여 있습니다.
   */
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
  const roster = await page.evaluate(() => window.__game.enemyRoster())

  /**
   * ── 🚧 **14m 를 근접 적 전부에게 쓰는 것이 아직 맞는가** ────────────
   *
   * 아래 검사들은 *"이 칸에서 깨울 수 있는 적"* 을 **한 개의 반지름**
   * (`levelAggroRange` = 14m)으로 셉니다. 오늘은 맞습니다 — 근접 적은
   * 전부 `reach + 여유` 가 14 미만이라 깨는 거리가 14m 로 눌립니다
   * (balance.ts `LEVEL_AGGRO_LEAD` 설계 노트의 표).
   *
   * 하지만 그건 **지금 수치에서만** 참인 우연입니다. 누군가 근접 적의
   * 사거리를 늘리면 그 적의 깨는 거리는 조용히 넓어지는데, 이 파일은
   * 계속 14m 로 세면서 **초록을 유지합니다.** 「한 칸 차이의 초록은
   * 운이다」의 전형입니다.
   *
   * 그래서 우연이 깨지는 순간 **말을 하게** 둡니다. 원거리 적(쏘는 자)은
   * 애초에 다른 반지름으로 재므로 여기서 뺍니다.
   */
  /**
   * ── 🔔 **깨는 거리는 종류마다 다릅니다** ────────────────────────────
   *
   * 이 파일은 오랫동안 *"적을 깨울 수 있는가"* 를 **반지름 하나**
   * (`levelAggroRange` = 14m)로 셌습니다. 근거는 balance.ts 의 표였습니다 —
   * *"근접 적은 전부 `reach + 여유` 가 14 미만이라 그대로다"*.
   *
   * 그 표가 **낡았습니다.** 게임에게 직접 물어보니:
   *
   *     잡졸 14m · 달려드는 자 14m · **얽는 자 15m · 끄는 자 19m**
   *
   * 끄는 자는 쏘는 자와 **같은 19m** 입니다. `dragger_hook` 의 사거리가
   * 12m 로 늘어난 뒤 아무도 그 표를 안 고쳤고, 이 파일은 계속 14m 로
   * 세면서 **초록을 유지했습니다.** 「한 칸 차이의 초록은 운이다」의
   * 전형이라, 우연이 깨지는 순간 말하도록 게이트를 세워 뒀더니 바로
   * 이렇게 잡혔습니다.
   *
   * 그래서 반지름을 **종류별로** 씁니다. 게이트는 이제 할 일이 없으므로
   * 눈금으로 바꿉니다 — 값 자체는 계속 보여야 다음 사람이 압니다.
   */
  const wakeByKind = Object.fromEntries(roster.map((r) => [r.id, r.wakeRange]))
  /** 이 적을 깨울 수 있는 거리(m). 모르는 종류면 판 기본값. */
  const wakeOf = (kindId) => wakeByKind[kindId] ?? aggro
  console.log(
    `\n  🔔 깨는 거리 — ` +
      ['grunt', 'charger', 'binder', 'dragger', 'archer']
        .filter((k) => wakeByKind[k] !== undefined)
        .map((k) => `${k} ${wakeByKind[k]}m`)
        .join(' · ') +
      `   (판 기본 ${aggro}m)`,
  )

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
    const distToRoute = walkField(routeCells, maxClimb, CELL)

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
      // 색마다 깨는 거리가 다릅니다(위 🔔 표) — 그 색의 값으로 셉니다.
      const wake = wakeOf(kind)
      const onRoute = dists.filter((x) => x.d <= wake)
      check(
        onRoute.length >= 2,
        `${label} — 주 동선에서 깨울 수 있는 개체가 2마리 이상 (배치만 하고 안 만나지 않게)`,
        `${placed.length}마리 중 ${onRoute.length}마리 · 동선까지 ` +
          dists
            .sort((a, b) => a.d - b.d)
            .map((x) => `(${x.c.cx},${x.c.cz}) ${Number.isFinite(x.d) ? `${x.d}m` : '길없음'}`)
            .join(' · ') +
          ` · 어그로 ${wake}m`,
      )
    }

    /**
     * ── 8.6 🛣 **두 번째 길에서도 그 색을 만나는가** ────────────────────
     *
     * ── 이 검사가 어디서 왔는가 (숫자부터) ───────────────────────────
     * 바로 위 검사는 **주 동선 하나** 위에서 색을 셉니다. 지난 회차에
     * 그 선이 게임의 안내와 같은 선이라는 것까지 확인했으니(🧭 검사),
     * 이제 안심해도 될 것 같았습니다. 그런데 자동 플레이 세 판이 계속
     * 같은 말을 했습니다:
     *
     *     주 동선 100칸 중 봇이 지난 칸 **38% · 52% · 52%**
     *     ↳ 셋 다 **못 간 앞길 0칸** (보스까지 갔고, 다 잡았습니다)
     *
     * 즉 시간이 모자란 게 아니라 **다른 길로 갔습니다.** 발자국을 주 동선
     * 위에 겹쳐 그려 보니 이유가 한눈에 보였습니다:
     *
     *     주 동선 — 서쪽에서 z=2 를 따라 동쪽으로 → x=32 에서 **북쪽
     *               성벽마루로 올라가** 동쪽 끝까지 → 내려와 보스
     *     봇     — 같은 z=2 를 가다 x=-24 에서 **남쪽 벌판으로 내려가**
     *               보물·모루를 훑고 동쪽 끝에서 올라와 보스
     *
     * 둘은 **양끝에서만 만나고 가운데 100m 를 45~51m 떨어져** 나란히
     * 갑니다. 곁길이 아니라 **두 번째 길**입니다.
     *
     * ── 그래서 무엇이 깨지는가 ───────────────────────────────────────
     * 곁길 11개마다 *"그걸 챙기고 보스로 간 길"* 을 그려서 주 동선을 얼마나
     * 덮는지 쟀습니다(같은 자, 같은 `routeTrail`):
     *
     *     북쪽 보물 넷 — **100%** (챙겨도 주 동선을 그대로 걷습니다)
     *     남쪽 보물·모루 넷 — **53% · 55% · 55% · 75%**
     *
     * 남쪽을 챙긴 플레이어는 주 동선의 **절반을 안 봅니다.** 그 절반에
     * 무엇이 있었는지 세어 보면:
     *
     *     🔵 얽는 자 3마리 — 남쪽 길에서 **0마리** (33m · 51m · 16m)
     *     🏹 쏘는 자 1마리 — 남쪽 길에서 40m
     *     🧱 두꺼운 벽과 그 답(통) — 남쪽 길에서 35~39m
     *
     * **한 색을 통째로 못 배우고 보스에 도착하는 길이 있습니다.** 위
     * 검사는 이걸 못 잡습니다 — 한 길만 보기 때문입니다. 「빈 표본으로
     * 통과하지 않게」의 형제입니다: *"안 본 길에서 못 만나는 것은
     * 통과가 아닙니다."*
     *
     * ── 다른 게임은 어떻게 하는가 ────────────────────────────────────
     * 엘든 링은 길이 여러 갈래여도 **가르치는 것은 갈림 이전이나 합류점**에
     * 둡니다(리엥의 첫 병사, 관문 앞 기마병). 로스트아크는 아예 갈래를
     * 안 만들고, NRFTW 는 갈래가 **눈에 보이는 거리 안에서 다시 합칩니다.**
     * 공통점은 하나입니다 — **어느 길로 가도 배울 것은 배웁니다.**
     *
     * ── 무엇을 문턱으로 삼는가 ───────────────────────────────────────
     * 두 번째 길에는 **1마리**만 요구합니다(주 동선은 2마리 — 처음+복습).
     * 두 번째 길은 *"고를 수 있는 길"* 이지 *"설계된 순서"* 가 아니므로,
     * 여기서 요구할 것은 복습이 아니라 **첫 만남이 있느냐**입니다.
     *
     * ⚠️ 「두 번째 길」을 **좌표로 적지 않습니다.** 곁길마다 길을 다 그려
     *    보고 **주 동선을 가장 적게 덮는 것**을 고릅니다. 지도를 고치면
     *    고른 길도 따라 바뀝니다. 좌표를 적어 두면 그 자리를 옮기는 날
     *    검사가 조용히 딴 길을 재게 됩니다(이 저장소가 세 번 낸 사고).
     */
    const worldOf = (c) => ({ x: (c.cx - level.w / 2 + 0.5) * CELL, z: (c.cz - level.h / 2 + 0.5) * CELL })
    const fireW = worldOf(startFire)
    const bossW = worldOf(boss)
    const trailBetween = (a, b) =>
      page.evaluate(
        ([ax, az, bx, bz]) => window.__game.routeTrail(ax, az, bx, bz),
        [a.x, a.z, b.x, b.z],
      )
    const routeW = routeCells.map(worldOf)
    const nearestOf = (pts, q) => {
      let best = Infinity
      for (const p of pts) best = Math.min(best, Math.hypot(p.x - q.x, p.z - q.z))
      return best
    }
    const roads = []
    for (const r of level.entities.filter((e) => e.kind === 'treasure' || e.kind === 'anvil')) {
      const q = { x: r.x, z: r.z }
      const p1 = await trailBetween(fireW, q)
      const p2 = await trailBetween(q, bossW)
      /**
       * ⚠️ 길이 **없는** 보상은 뺍니다. 없어서가 아니라 **일부러 못 가게
       *    둔 것**이기 때문입니다(선반 위 보물 — 통으로 떨궈야 닿습니다).
       *    이걸 0% 로 세면 "두 번째 길이 주 동선을 하나도 안 덮는다"는
       *    거짓 빨강이 납니다.
       */
      if (!p1.length || !p2.length) continue
      const road = [...p1, ...p2]
      roads.push({
        at: `${r.kind === 'anvil' ? '모루' : '보물'}(${Math.round(r.x)},${Math.round(r.z)})`,
        road,
        cov: Math.round((routeW.filter((c) => nearestOf(road, c) <= aggro).length / Math.max(1, routeW.length)) * 100),
      })
    }
    roads.sort((a, b) => a.cov - b.cov)
    console.log(
      `\n  🛣 곁길을 챙기고 보스로 간 길이 **주 동선을 덮는 비율** (어그로 ${aggro}m 안) — ` +
        (roads.length ? roads.map((r) => `${r.at} ${r.cov}%`).join(' · ') : '**표본 없음**'),
    )
    /** 🛣 두 번째 길 — 아래 🔴 검사도 같은 길을 봐야 하므로 블록 밖에 둡니다. */
    let secondRoad = null
    if (roads.length) {
      const worst = roads[0]
      const roadCells = worst.road.map((p) => ({
        cx: Math.floor(p.x / CELL + level.w / 2),
        cz: Math.floor(p.z / CELL + level.h / 2),
      }))
      secondRoad = { at: worst.at, cells: roadCells }
      const distToB = walkField(roadCells, maxClimb, CELL)
      console.log(
        `     └ 그중 가장 적게 덮는 **두 번째 길**: ${worst.at} 경유 ${worst.road.length}칸 · 주 동선의 ${worst.cov}%`,
      )
      for (const [kind, label] of Object.entries(TEACHERS)) {
        const placed = level.entities.filter((e) => e.kind === kind)
        const dists = placed.map((e) => {
          const c = cellOf(e)
          return { c, d: distToB.get(key(c.cx, c.cz)) ?? Infinity }
        })
        const wake = wakeOf(kind)
        const onB = dists.filter((x) => x.d <= wake)
        check(
          onB.length >= 1,
          `${label} — **두 번째 길**(${worst.at} 경유)에서도 깨울 수 있는 개체가 있다 (한 색을 통째로 안 배우고 보스에 닿지 않게)`,
          `${placed.length}마리 중 ${onB.length}마리 · 그 길까지 ` +
            dists
              .sort((a, b) => a.d - b.d)
              .map((x) => `(${x.c.cx},${x.c.cz}) ${Number.isFinite(x.d) ? `${x.d}m` : '길없음'}`)
              .join(' · ') +
            ` · 어그로 ${wake}m`,
        )
      }
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
    // 로스터는 위(어그로 게이트)에서 이미 한 번 읽었습니다 — 그대로 씁니다.
    const t = await page.evaluate(() => window.__game.terrainInfo())
    const walkSpeed = t.playerMoveSpeed
    const archerDef = roster.find((r) => r.id === 'archer')
    if (archerDef) {
      /**
       * ── 🔔 깨는 거리는 **게임에게 묻습니다** ──────────────────────
       *
       * 여기에는 원래 `min(max(levelAggroRange, reach + lead), max)` 라는
       * 식이 **손으로 베껴** 적혀 있었습니다. 게임 쪽 원본은
       * `enemyAI.ts` 의 루프 안에 인라인으로 있었고요 — 즉 같은 규칙이
       * 두 곳에 있었습니다.
       *
       * 지난 회차에 「주 동선」이 세 곳에서 따로 그려지다 서로 어긋난
       * 것과 **똑같은 병**입니다. 그때 배운 처방을 그대로 씁니다:
       * 식은 `enemyAI.wakeRangeOf` 한 곳에만 두고, 여기서는 그 결과를
       * 로스터로 받아 읽기만 합니다. 밸런스를 손보는 날 검사가 저절로
       * 따라옵니다.
       */
      const wakeRange = archerDef.wakeRange
      /**
       * ── 🧗 **이 판의 천장을 같이 찍습니다** ─────────────────────
       *
       * 이 검사가 빨갛게 나왔을 때 제일 먼저 하는 일은 **궁수를 옮기는
       * 것**입니다. 그래서 걸을 수 있는 칸을 전부 훑어 봤더니:
       *
       *     사거리 검사(8칸)를 통과하는 칸 630곳 · 그 전부가 **1.87발**
       *
       * **어디로 옮겨도 2발이 안 됩니다.** 이유는 기하입니다 — 동선은
       * 한 줄이고, 반지름 19m 짜리 원이 한 줄에서 잘라 갈 수 있는 길이는
       * 정해져 있습니다(꺾이는 자리에 세워도 54m 가 최대).
       *
       * 천장을 안 찍으면 이 빨간불은 *"자리를 잘못 잡았다"* 로 읽힙니다.
       * 실제로 가리키는 것은 **궁수의 수치**(사거리 · 한 바퀴)입니다.
       * 「못 잰 것은 통과가 아니다」의 짝입니다 — **아무도 못 넘는 문턱은
       * 눈금이 아니라 벽입니다.** 벽이면 벽이라고 적어 둡니다.
       */
      let ceiling = 0
      for (let cz = 0; cz < level.h; cz++) {
        for (let cx = 0; cx < level.w; cx++) {
          if (heightAt(cx, cz) === VOID) continue
          const n = routeCells.filter(
            (c) => Math.hypot(c.cx - cx, c.cz - cz) * CELL <= wakeRange,
          ).length
          if (n > ceiling) ceiling = n
        }
      }
      const bestShots = ((ceiling * CELL) / walkSpeed) / archerDef.attackCycle
      /**
       * 「지나가는 동안 몇 발」을 **한 곳에서만** 계산합니다 — 아래 🛣 검사가
       * 같은 셈을 두 번째 길에 대고 다시 합니다. 같은 식을 두 벌 적으면
       * 언젠가 둘이 어긋납니다(이 저장소가 세 번 낸 사고).
       */
      const shotsAgainst = (roadCells, ac) => {
        const inside = roadCells.filter(
          (c) => Math.hypot(c.cx - ac.cx, c.cz - ac.cz) * CELL <= wakeRange,
        ).length
        const metres = inside * CELL
        const seconds = metres / walkSpeed
        return { metres, seconds, shots: seconds / archerDef.attackCycle }
      }
      /**
       * ── ⚠️ **"동선"이 하나가 아니게 됐습니다** ────────────────────────
       *
       * 이 두 검사는 원래 **주 동선 하나**만 봤습니다. 그런데 🛣 절이
       * 두 번째 길을 드러냈고(같은 존, 가운데 100m 를 45m 떨어져 나란히
       * 가는 길), 그러면 *"이 궁수가 아무도 안 쏜다"* 는 판정이 **길을
       * 잘못 골라서** 나올 수 있습니다.
       *
       * 그래서 묻는 것을 바꿉니다 — *"주 동선을 덮는가"* 가 아니라
       * **"사람이 걷는 길 하나라도 덮는가"**. 남쪽 성벽에서 남쪽 길만
       * 쏘는 궁수는 배치 실수가 아니라 **그 길의 콘텐츠**입니다.
       *
       * ⚠️ 두 길을 **다 적습니다.** 어느 길에서 나온 값인지 안 보이면
       *    빨간불이 떴을 때 어디를 고쳐야 하는지 알 수 없습니다.
       */
      const walked = [
        { name: '주 동선', cells: routeCells },
        ...(secondRoad ? [{ name: `두 번째 길(${secondRoad.at})`, cells: secondRoad.cells }] : []),
      ]
      for (const a of level.entities.filter((e) => e.kind === 'archer')) {
        const ac = cellOf(a)
        const per = walked.map((r) => ({
          name: r.name,
          ...shotsAgainst(r.cells, ac),
          // 🎯 사거리(깨는 거리가 아니라 **실제로 화살이 닿는 거리**)로 덮는 칸.
          inRange: r.cells.filter(
            (c) => Math.hypot(c.cx - ac.cx, c.cz - ac.cz) * CELL <= archerDef.attackRange,
          ).length,
        }))
        const best = per.reduce((m, x) => (x.shots > m.shots ? x : m))
        const bestRange = per.reduce((m, x) => (x.inRange > m.inRange ? x : m))
        const table = per.map((x) => `${x.name} ${x.metres}m→${x.shots.toFixed(1)}발`).join(' · ')
        check(
          best.shots >= 2,
          `🔴 쏘는 자(${ac.cx},${ac.cz}) — 걷는 길 하나에서 2발 이상 쏠 수 있다 (한 발은 사고입니다)`,
          `${table} · 깨는 거리 ${wakeRange}m ÷ 이동 ${walkSpeed}m/s ÷ 한 바퀴 ${archerDef.attackCycle.toFixed(2)}초` +
            (best.shots < 2
              ? ` · ⛰️ **주 동선의 천장 ${bestShots.toFixed(2)}발**` +
                (bestShots < 2
                  ? ' — 어느 칸으로 옮겨도 2발이 안 됩니다. 자리가 아니라 사거리/한 바퀴를 보세요'
                  : '')
              : ''),
        )
        /**
         * 같은 궁수에게 **다른 것**을 한 번 더 묻습니다. 위는 *"깨어 있는
         * 동안 몇 발을 낼 시간이 되는가"* 이고, 이것은 *"화살이 실제로
         * 닿는 구간이 있는가"* 입니다 — 깨는 거리(19m)가 사거리(12m)보다
         * 넓어서 둘은 같은 값이 아닙니다. 예전에 34m 밖에 세운 궁수가
         * 3판 내내 한 발도 안 쐈던 사고가 이 물음의 출처입니다.
         */
        check(
          bestRange.inRange >= 8,
          `쏘는 자(${ac.cx},${ac.cz})의 사거리가 걷는 길을 덮는다 (배치만 하고 안 쏘지 않게)`,
          per.map((x) => `${x.name} ${x.inRange}칸(${x.inRange * CELL}m)`).join(' · ') +
            ` · 사거리 ${archerDef.attackRange}m · 최소 8칸`,
        )
      }

      /**
       * ── 🛣🔴 **두 번째 길에도 «멀리서 오는 것»이 있는가** ──────────────
       *
       * 지난 자리에서 🔵 를 두 번째 길에 붙이고 이렇게 적어 뒀습니다:
       * *"🏹 쏘는 자와 🧱 두꺼운 벽은 아직 북쪽 길에만 있습니다 — 다음
       * 자리의 질문입니다."* 그 질문을 여기서 답합니다.
       *
       * ── 왜 벽은 빼고 궁수만 검사로 만드나 ────────────────────────────
       * 둘은 **성질이 다릅니다.**
       *   · 🧱 비밀은 **고르는 것**입니다. 못 보고 지나가는 것이 설계의
       *     일부입니다(그래야 찾았을 때 값이 납니다). 그리고 실제로
       *     남쪽으로 가도 금 간 벽(10m)과 선반 위 보물(8m)은 만납니다 —
       *     비밀 어휘 셋 중 둘은 이미 두 길 공통입니다.
       *   · 🏹 원거리는 **배우는 것**입니다. "멀리서 날아오는 것에는
       *     엄폐하거나 붙는다" 는 이 게임의 어휘 중 하나이고, 그걸 한 번도
       *     안 겪고 보스에 닿으면 보스의 원거리 페이즈가 **처음 보는 것**이
       *     됩니다. 색과 같은 종류의 구멍입니다.
       *
       * ── 문턱을 2발이 아니라 **1발**로 두는 이유 ──────────────────────
       * 주 동선에는 *"한 발은 사고"* 라며 2발을 겁니다. 두 번째 길에는
       * **1발**만 요구합니다 — 여기서 묻는 것은 *"연습이 되는가"* 가 아니라
       * *"그런 것이 있다는 걸 아는가"* 이기 때문입니다. 색 검사에서 주
       * 동선에 2마리(처음+복습), 두 번째 길에 1마리(첫 만남)를 요구한 것과
       * 같은 눈금입니다.
       *
       * ⚠️ 천장을 **같이 찍습니다.** 이 검사가 빨갛다고 곧장 궁수를
       *    옮기거나 늘리면 안 됩니다 — 두 번째 길에서 아무 칸도 1발을
       *    못 내면 그건 배치가 아니라 **길의 기하** 이야기입니다
       *    (「아무도 못 넘는 문턱은 눈금이 아니라 벽이다」).
       */
      if (secondRoad) {
        let ceilB = 0
        for (let cz = 0; cz < level.h; cz++) {
          for (let cx = 0; cx < level.w; cx++) {
            if (heightAt(cx, cz) === VOID) continue
            const n = secondRoad.cells.filter(
              (c) => Math.hypot(c.cx - cx, c.cz - cz) * CELL <= wakeRange,
            ).length
            if (n > ceilB) ceilB = n
          }
        }
        const ceilShots = (ceilB * CELL) / walkSpeed / archerDef.attackCycle
        const perArcher = level.entities
          .filter((e) => e.kind === 'archer')
          .map((a) => {
            const ac = cellOf(a)
            return { ac, ...shotsAgainst(secondRoad.cells, ac) }
          })
        const best = perArcher.reduce((m, x) => (x.shots > m.shots ? x : m), { shots: 0 })
        check(
          best.shots >= 1,
          `🛣🔴 **두 번째 길**(${secondRoad.at} 경유)에서도 화살이 한 발은 날아온다 (원거리를 한 번도 안 겪고 보스에 닿지 않게)`,
          perArcher
            .map((x) => `(${x.ac.cx},${x.ac.cz}) ${x.metres}m→${x.shots.toFixed(1)}발`)
            .join(' · ') + ` · ⛰️ 그 길의 천장 ${ceilShots.toFixed(1)}발`,
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
            .filter((f) => f.at < pr.at && f.off <= wakeOf(f.kind))
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

  /**
   * ── 🔥 **쉼터는 맞는 자리가 아니다** ───────────────────────────────
   *
   * ── 다른 게임이 예외 없이 지키는 것 ────────────────────────────────
   * 소울류의 화톳불, 할로우 나이트의 벤치, 오공의 토지묘, 로스트아크의
   * 관문 앞 — 전부 **주머니 안**에 있습니다. 취향이 아니라 규칙입니다.
   * 부활 지점이 안전하지 않으면 **죽음의 대가가 두 번 청구됩니다** —
   * 한 번은 불티로, 한 번은 일어서자마자 다시 맞는 것으로.
   *
   * ── 무엇을 걸고 무엇을 안 거는가 ──────────────────────────────────
   * 「깨울 수 있는 적이 하나도 없다」로 걸고 싶었지만 **안 겁니다.**
   * 이 레벨은 와이드 리니어 존이라 동선이 대체로 위협 안에 있는 것이
   * 성격이고(바로 위 [긴장 구간] 주석), 화톳불 둘레에 19m 짜리 빈
   * 주머니를 요구하면 존의 알맹이를 들어내야 합니다. 실제로 훑어 보니
   * 가장 가까운 조용한 칸이 **15.6m** 밖이었습니다 — 화톳불을 거기로
   * 옮기면 주 동선에서 내려가고, 예전에 그렇게 옮겼다가 **봇이 두 판
   * 연속 408초 동안 존을 못 끝냈습니다**(playthrough.mjs 기록).
   *
   * 그래서 **깨는 거리가 아니라 사거리**로 겁니다. 깨는 것은 견딜 만합니다 —
   * 보고 걸어 나갈 수 있으니까요. 불공정한 것은 **서 있는 그 자리가 이미
   * 맞는 자리인 것**입니다. 문턱을 좁히면 존을 안 헐고도 그 불공정만
   * 잡을 수 있습니다. 깨는 쪽은 아래에 **눈금으로** 남깁니다.
   *
   * ⚠️ 사거리는 **패턴의 reach** 입니다(`attackRange` 아님). 이 저장소가
   *    그 둘을 헷갈려 어그로가 조용히 넓어진 적이 있습니다 — 끄는 자가
   *    attackRange 12 · reach 6.5 였고, 지금은 갈고리가 12m 입니다.
   */
  {
    const reachOf = (kindId) => {
      const r = roster.find((x) => x.id === kindId)
      return r ? Math.max(...r.attacks.map((a) => a.reach)) : 0
    }
    const restKinds = ['bonfire', 'anvil']
    const rests = level.entities
      .filter((e) => restKinds.includes(e.kind))
      .map((e) => ({ kind: e.kind, c: cellOf(e) }))
    const mobsNear = level.entities
      .filter((e) => FOE_KINDS.has(e.kind) && e.kind !== 'boss')
      .map((e) => ({ kind: e.kind, c: cellOf(e) }))
    const hit = []
    const wakeLedger = []
    for (const r of rests) {
      const d = (m) => Math.hypot(m.c.cx - r.c.cx, m.c.cz - r.c.cz) * CELL
      const covering = mobsNear.filter((m) => d(m) <= reachOf(m.kind))
      const waking = mobsNear.filter((m) => d(m) <= wakeOf(m.kind))
      if (covering.length) {
        hit.push(
          `${r.kind === 'bonfire' ? '화톳불' : '모루'}(${r.c.cx},${r.c.cz}) ← ` +
            covering
              .map((m) => `${m.kind}(${m.c.cx},${m.c.cz}) ${d(m).toFixed(1)}m/사거리 ${reachOf(m.kind)}m`)
              .join(' · '),
        )
      }
      wakeLedger.push(
        `${r.kind === 'bonfire' ? '🔥' : '🔨'}(${r.c.cx},${r.c.cz}) ${waking.length}마리`,
      )
    }
    console.log(`  [쉼터] 그 자리에서 깨울 수 있는 적 — ${wakeLedger.join(' · ')}  ※ 재되 걸지 않습니다(위 주석)`)
    check(
      hit.length === 0,
      '🔥 **쉼터가 맞는 자리는 아니다** (부활하자마자 맞지 않게 — 소울류의 화톳불이 늘 주머니에 있는 이유)',
      hit.length ? hit.join(' | ') : `쉼터 ${rests.length}곳 전부`,
    )
  }

  /**
   * ⚠️ **보스는 빼고 셉니다** — 이 줄을 아래 검사에서만 지키고 여기서는
   *    안 지켜서, 같은 출력 안에서 **두 자가 서로 다른 값을 말했습니다**:
   *
   *        ✅ 보스 직전 빈 구간 **62m**        ← 보스를 뺀 자
   *        [빈 구간] … 최장 **46m**            ← 보스를 넣은 자
   *
   *    둘 다 "위협 없이 걷는 거리"를 잰다고 적혀 있었으니, 읽는 사람은
   *    둘 중 하나가 버그라고 결론냅니다. 실제로는 **정의가 달랐을 뿐**이고
   *    어디에도 안 적혀 있었습니다.
   *
   *    어느 쪽이 맞는가: **보스를 빼는 쪽.** 보스는 잡몹처럼 어그로 반경
   *    (14m)으로 사람을 무는 것이 아니라 **전용 조우 영역**(17m)을 가지고
   *    있고, 그 영역은 바로 위 「보스 전 화톳불이 보스 영역 밖에 있다」가
   *    따로 지킵니다. 잡몹 자로 보스를 재면 "보스 앞은 정의상 시끄럽다"가
   *    되어, 리듬을 보려던 자가 늘 같은 답만 냅니다.
   *
   *    (이 값이 62m 로 커지면서 아래 「위협 없이 30m 넘게 걷는 구간이 없다」는
   *     **더 빨개집니다**. 자를 고치면 눈금이 나빠지는 쪽으로 움직이는 것이
   *     정상입니다 — 46m 는 보스가 가려 준 46m 였습니다.)
   */
  const mobs = level.entities
    .filter((e) => FOE_KINDS.has(e.kind) && e.kind !== 'boss')
    // ⚠️ 종류를 들고 다녀야 **종류별 깨는 거리**를 쓸 수 있습니다.
    .map((e) => ({ ...cellOf(e), kind: e.kind }))
  const foes = mobs
  const quiet = []
  let runStart = null
  let runLen = 0
  for (const c of routeCells) {
    const near = foes.some(
      (f) => Math.hypot((f.cx - c.cx) * CELL, (f.cz - c.cz) * CELL) <= wakeOf(f.kind),
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
        (f) => Math.hypot((f.cx - c.cx) * CELL, (f.cz - c.cz) * CELL) <= wakeOf(f.kind),
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
   *
   *    → `mobs` 는 이제 위 [빈 구간]·[긴장 구간]과 **같은 목록**입니다.
   *      한동안 여기서만 보스를 빼고 위에서는 안 뺐고, 그 결과 같은 화면에
   *      62m 와 46m 가 나란히 찍혔습니다. 규칙은 한 곳에만 둡니다.
   */
  /**
   * ── 🔎 **복도를 끊는 적의 이름까지 댑니다** ─────────────────────────
   *
   * 이 검사가 빨개졌을 때 다음 할 일은 *"어느 적을 물릴 것인가"* 인데,
   * 예전에는 미터만 찍어서 그걸 손으로 찾아야 했습니다. 실제로 한 번
   * **다른 자로 재서** 엉뚱한 적을 범인으로 지목할 뻔했습니다 — 저는
   * 「보스까지 직선거리」로 훑었고 이 검사는 **동선을 따라** 잽니다.
   * 두 자가 다르면 답도 다릅니다.
   *
   * 그래서 **이 검사가 쓰는 그 자로** 범인을 집어 냅니다. 「사건은 사건이
   * 일어난 자리에서 기록한다」의 짝입니다 — 판정한 자리에서 이름을 댑니다.
   */
  const tail = (() => {
    let n = 0
    let blame = null
    for (let i = routeCells.length - 1; i >= 0; i--) {
      const c = routeCells[i]
      // 가장 깊이 파고든 적을 고릅니다 — 여유(거리 − 깨는 거리)가 가장 작은 놈.
      let worst = null
      for (const f of mobs) {
        const d = Math.hypot((f.cx - c.cx) * CELL, (f.cz - c.cz) * CELL)
        const slack = d - wakeOf(f.kind)
        if (slack <= 0 && (worst === null || slack < worst.slack)) {
          worst = { f, d: Number(d.toFixed(1)), slack: Number(slack.toFixed(1)) }
        }
      }
      if (worst) {
        blame = { ...worst, at: c }
        break
      }
      n++
    }
    return { metres: n * CELL, blame }
  })()
  const tailRest = tail.metres
  check(
    tailRest >= breather,
    '**보스 앞 복도는 비어 있다** (숨 고르고 들어가게)',
    `보스 직전 빈 구간 ${tailRest}m · 스태미나가 차는 거리 ${breather.toFixed(0)}m` +
      (tail.blame
        ? ` · 🔎 복도를 끊는 것 — ${tail.blame.f.kind}(${tail.blame.f.cx},${tail.blame.f.cz})` +
          ` 가 동선 칸 (${tail.blame.at.cx},${tail.blame.at.cz}) 를 ${tail.blame.d}m 로 덮습니다` +
          ` (깨는 ${wakeOf(tail.blame.f.kind)}m)` +
          /**
           * ⚠️ 여유를 **음수로 찍지 않습니다.** 초록일 때 "-1m 더 물려야
           *    합니다" 라고 나오면 읽는 사람이 아직 모자란 줄 압니다.
           *    그리고 여유는 **칸으로도** 보여 줍니다 — 동선은 2m 격자라
           *    "1m 남았다" 는 사실상 **반 칸**이고, 다음 편집 한 번에
           *    뒤집힙니다(「한 칸 차이의 초록은 운이다」).
           */
          (tailRest >= breather
            ? ` · 여유 ${(tailRest - breather).toFixed(0)}m(${((tailRest - breather) / CELL).toFixed(1)}칸)`
            : ` · ${(breather - tailRest).toFixed(0)}m 더 물려야 합니다`)
        : ''),
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
  /**
   * ── 🎨 **색을 통째로 피해 갈 수 있는가** ────────────────────────────
   *
   * ── 왜 이 자가 필요해졌는가 ──────────────────────────────────────
   * 자동 플레이가 판마다 이렇게 찍습니다:
   *
   *     🎨 색별 겪음  🔴 11회 · 🟡 8회 · 🔵 **2회** · 🟣 4회 · 🟢 5회
   *
   * 그런데 그건 **한 판의 장부**라 처방이 안 나옵니다 — 봇이 안 간 것인지
   * 지도가 안 만나게 한 것인지 구분이 안 됩니다. 이 게임의 4색은
   * **언어**이고, 두 번 들은 말은 배울 수가 없습니다. 그래서 지형에게
   * 직접 묻습니다:
   *
   *     **"이 색을 던지는 적을 전부 피해서 보스까지 갈 수 있는가?"**
   *
   * ⚠️ **기존 🎯 와 묻는 것이 다릅니다.** `npm run route` 의 🎯 는 적을
   *    **하나씩** 지워 봅니다. 그래서 두 갈래 길에 하나씩 세워 둔 색은
   *    거기서 둘 다 「피할 수 있다」로 나오지만, 실제로는 **어느 길로 가도
   *    만납니다.** 하나씩 묻는 자로는 「그 색을 배우는가」에 답할 수 없습니다.
   *
   * ⚠️ 원으로 지우는 것은 **가장 후한 가정**입니다(실제 인지는 부채꼴).
   *    그러니 여기서 「피할 수 있다」가 나오면 실제로는 더 쉽게 피합니다.
   *
   * ⚠️ 여기서 「만난다」는 **깨어난다**까지입니다. 깨어난 적이 실제로
   *    예고를 띄우고 그걸 보고 배우는지는 `npm run play` 의 🎨 장부가 봅니다 —
   *    지형이 답할 수 있는 데까지만 답합니다.
   */
  {
    const rosterColor = await page.evaluate(() => window.__game.enemyRoster())
    const aggroM = await page.evaluate(() => window.__game.terrainInfo().levelAggroRange)
    /** 색 → 그 색을 던지는 적 id 들. **로스터에서 뽑습니다** — 새 적이 생겨도 따라옵니다. */
    const byColor = new Map()
    for (const r of rosterColor) {
      for (const a2 of r.attacks) {
        if (!byColor.has(a2.color)) byColor.set(a2.color, new Set())
        byColor.get(a2.color).add(r.id)
      }
    }
    const spawnC = cellOf(level.entities.find((e) => e.kind === 'spawn'))
    const bossC = cellOf(level.entities.find((e) => e.kind === 'boss'))
    // 한 칸의 크기는 위에서 쓰던 값과 같습니다(격자 2m).
    const cell = 2
    const rc = Math.ceil(aggroM / cell)
    const lines = []
    let dodgeable = 0
    let measured = 0
    for (const [color, ids] of byColor) {
      /**
       * ⚠️ **보스는 뺍니다.** 보스는 반드시 만나므로 보스가 던지는 색은
       *    전부 「못 피한다」가 됩니다 — 그러면 이 자는 *"보스가 있는가"*
       *    를 재게 되고, 물어보려던 **잡몹 배치**에 대해 아무 말도
       *    안 하게 됩니다.
       */
      const foes = level.entities.filter((e) => e.kind !== 'boss' && ids.has(e.kind))
      /**
       * ⚠️ **빈 표본으로 통과시키지 않습니다.** 그 색을 던지는 잡몹이
       *    하나도 없으면 아래 흘리기는 당연히 보스에 닿는데, 그건
       *    *"피할 수 있다"* 가 아니라 *"애초에 없다"* 입니다.
       */
      if (foes.length === 0) {
        lines.push(`     ${color} — **잡몹 중에 이 색을 던지는 적이 없습니다**(피할 수 있는 게 아니라 없는 것)`)
        continue
      }
      measured++
      const blocked = new Set()
      for (const e of foes) {
        const c = cellOf(e)
        for (let dz = -rc; dz <= rc; dz++) {
          for (let dx = -rc; dx <= rc; dx++) {
            const cx = c.cx + dx
            const cz = c.cz + dz
            if (cx < 0 || cz < 0 || cx >= level.w || cz >= level.h) continue
            if (Math.hypot(dx, dz) * cell > aggroM) continue
            blocked.add(cz * level.w + cx)
          }
        }
      }
      // 사다리는 **내려져 있다고** 봅니다 — 가장 많은 길이 열린 상태에서도
      // 못 피한다면 그건 확실한 「만난다」입니다.
      const reach = blocked.has(spawnC.cz * level.w + spawnC.cx)
        ? undefined
        : bfs(spawnC, bossC, maxClimb, true, blocked)
      const canDodge = reach !== undefined
      if (canDodge) dodgeable++
      lines.push(
        `     ${color} — 잡몹 ${foes.length}마리 · ` +
          (canDodge
            ? '**피해서 갈 수 있습니다** — 판에 따라 한 번도 안 나옵니다'
            : '어느 길로 가도 만납니다'),
      )
    }
    console.log(`\n  🎨 **색을 통째로 피해 갈 수 있는가** (인지 ${aggroM}m · 원으로 후하게)`)
    for (const l of lines) console.log(l)
    /**
     * ⚠️ **판정으로 걸지 않습니다.** 「모든 색을 반드시 만나야 한다」는
     *    아직 아무도 정한 규칙이 아닙니다 — 소울류는 오히려 못 만나고
     *    지나가는 적을 일부러 둡니다. 여기서 정하고 싶은 것은 *"몇 개가
     *    그런가"* 이고, 그 수를 보고 사람이 정할 일입니다.
     *    **재기 전의 설명을 결론으로 만들지 않습니다.**
     */
    check(
      measured > 0,
      '🎨 **색마다 피할 수 있는지 실제로 쟀다** (빈 표본으로 통과하지 않게)',
      `${measured}색 측정 · 그중 피해 갈 수 있는 색 ${dodgeable}개`,
    )
  }

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
        (f) => Math.hypot((f.cx - c.cx) * CELL, (f.cz - c.cz) * CELL) <= wakeOf(f.kind),
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

  /**
   * ── ⚖️ **두 검사가 같은 62m 를 두고 반대로 판정했습니다** ──────────
   *
   * 자를 고쳐서 보스를 뺀 뒤, 출력이 이렇게 나왔습니다:
   *
   *     ✅ 보스 앞 복도는 비어 있다 — 보스 직전 빈 구간 **62m** (≥23m 필요)
   *     ❌ 위협 없이 30m 넘게 걷는 구간이 없다 — 최장 **62m**
   *
   * **같은 62m 입니다.** 하나는 있어야 한다고 하고 하나는 있으면 안 된다고
   * 합니다. 이대로 두면 둘 중 하나를 맞추는 순간 다른 하나가 빨개져서,
   * 고칠 수 없는 검사 한 쌍이 영원히 남습니다.
   *
   * 어디가 틀렸나: **심심함 검사가 보스 앞 복도를 몰랐습니다.** 보스 직전의
   * 빈 길은 심심한 것이 아니라 **설계된 숨 고르기**입니다 — 소울류의 안개문
   * 앞이 조용한 것은 실수가 아닙니다. 그래서 마지막 빈 구간에서는 **숨
   * 고르기로 정당화되는 몫(스태미나가 차는 거리)을 빼고** 심심함을 셉니다.
   *
   *     62m − 23m = **39m** ← 아무 이유 없이 빈 나머지
   *
   * ⚠️ **면제해 주지, 문턱을 맞추지는 않습니다.** 심심함 문턱을 `breather`
   *    로 바꾸면 두 검사가 **같은 값에서 만나** 경계에서 깜빡입니다(이 저장소가
   *    이미 세 번 겪은 실수입니다 — 문턱이 하나면 경계에서 깜빡인다).
   *    두 검사는 이제 서로 다른 것을 묻습니다: 하나는 *"숨 쉴 틈이 있나"*,
   *    다른 하나는 *"숨 쉬고도 남는 빈 길이 있나"*.
   */
  const scored = quiet.map((q) => {
    const isTail = q.to === routeCells[routeCells.length - 1]
    return { ...q, isTail, judged: isTail ? Math.max(0, q.metres - breather) : q.metres }
  })
  const worst = scored.reduce((a, b) => (a && a.judged >= b.judged ? a : b), null)
  console.log(
    `  [빈 구간] 주 동선 ${routeCells.length * CELL}m 중 위협 없이 걷는 구간 ${quiet.length}개 — ` +
      (scored.length
        ? scored
            .slice()
            .sort((a, b) => b.judged - a.judged)
            .slice(0, 4)
            .map(
              (q) =>
                `${q.metres}m (${q.from.cx},${q.from.cz})→(${q.to.cx},${q.to.cz})` +
                (q.isTail ? ` [보스 앞 — 숨 고르기 ${breather.toFixed(0)}m 빼면 ${q.judged.toFixed(0)}m]` : ''),
            )
            .join(' · ')
        : '없음') +
      '\n',
  )
  check(
    !worst || worst.judged <= 30,
    '주 동선에 위협 없이 30m(약 6초) 넘게 걷는 구간이 없다 (보스 앞 숨 고르기는 뺍니다)',
    worst ? `최장 ${worst.judged.toFixed(0)}m` : '없음',
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
   * ── 🪂 **밀어서 떨어뜨릴 자리가 있는가** ─────────────────────────────
   *
   * 위 검사는 높이를 **적이 쓰는** 쪽(내려다보며 쏜다)만 봅니다. 반대쪽,
   * **플레이어가 높이를 무기로 쓰는** 쪽은 아무도 안 보고 있었습니다.
   *
   * ── 코드에는 이미 있습니다 ────────────────────────────────────────
   * 떨어지면 피해가 들어가고(`FALL.damagePerStep`) 적은 **무너집니다**
   * (`FALL.breaksPoise`). 그리고 낙하 공격 창은 **플레이어에게만** 엽니다 —
   * main.ts 에 그 이유가 적혀 있습니다: *"양쪽 다 주면 절벽이 서로에게
   * 같은 도구가 되어 «절벽으로 유인하기»의 값어치가 사라집니다."*
   * 즉 **절벽은 설계상 플레이어의 도구**입니다(세키로의 발차기, 오공의
   * 밀치기, 젤다의 굴리는 바위가 파는 그 재미).
   *
   * ── 그런데 판에서 일어나는지는 안 봤습니다 ────────────────────────
   * 자동 플레이가 `fallLog` 를 판마다 모으고 있었는데 **화면에 한 번도
   * 안 찍혔습니다.** 찍게 하고 돌렸더니:
   *
   *     🪂 절벽 — 내가 떨어진 것 0회 · **적이 떨어진 것 2회** (평균 3.0단)
   *
   * 일어나긴 합니다. 그런데 지도를 세어 보면 그 2회가 어디서 왔는지가
   * 드러납니다 — **적 31마리 중 곁(3m)에 «아픈 낙차»가 있는 것은 3마리**
   * 뿐이고, 나머지는 대부분 낙차 0의 평지입니다. 즉 이 어휘는 설계된
   * 것이 아니라 **성문 잔해 옆에서 우연히** 성립하고 있었습니다.
   *
   * ⚠️ 「아픈 낙차」는 `FALL.freeSteps` **초과**입니다. 2단은 공짜라
   *    남쪽 함몰지(h2→h0)로 밀어 넣어도 피해가 0입니다 — 그건 벌이 아니라
   *    **선택**으로 만든 값입니다(「내려가면 못 올라온다」).
   *    문턱을 여기 적지 않고 게임에서 읽는 이유는 늘 같습니다.
   *
   * 검사는 **동선 위에 하나라도 있는가**로 겁니다. 마릿수를 요구하면
   * 지도를 절벽투성이로 만들라는 말이 되고, 그건 이 존의 설계가 아닙니다.
   * 지키려는 것은 하나입니다 — 이 어휘가 **걷는 길에서 사라지지 않는 것**.
   */
  {
    const fall = await page.evaluate(() => {
      const t = window.__game.terrainInfo()
      return { free: t.fallFreeSteps, aggro: t.levelAggroRange }
    })
    const PUSH = 3.5 // 강타 넉백이 밀어낼 만한 거리(m) — 아래 ⚠️ 참고
    const foes = level.entities.filter((e) => FOE_KINDS.has(e.kind) || e.kind === 'archer')
    const rad = Math.ceil(PUSH / CELL)
    /**
     * ── 🧭 **낙차가 «어느 쪽»에 있는지도 봅니다** ─────────────────────
     *
     * 여기까지의 검사는 *"곁에 아픈 낙차가 있는가"* 만 물었습니다. 그런데
     * 밀어서 떨어뜨리는 것은 **방향이 있는 동사**입니다 — 넉백은 플레이어의
     * 반대쪽으로 나가므로, 낙차가 **적의 등 뒤**에 있어야 쓸 수 있습니다.
     *
     * 낭떠러지가 **내 등 뒤**에 있으면 같은 지형이 정반대의 뜻이 됩니다:
     * 가르치는 자리가 아니라 **내가 떨어지는 자리**입니다. 두 경우의 칸
     * 모양이 똑같아서, 방향을 안 재면 그 둘이 한 수에 담깁니다 —
     * 이 저장소가 반복해서 물린 그 모양입니다(처방이 다른 둘이 한 칸에).
     *
     * 미는 방향은 **동선에서 적을 향하는 쪽**으로 봅니다. 플레이어는
     * 길을 따라 와서 적을 마주 보므로, 그 연장선이 넉백이 나가는 쪽입니다.
     * ±60°(부채꼴 120°)를 «등 뒤»로 칩니다 — 정확히 뒤에 서야만 성립하면
     * 그건 지형이 아니라 **곡예**를 요구하는 것이라, 조작이 아무리 좋아도
     * 우연에 기대게 됩니다.
     *
     * 참고한 것: 「무자비한 세계(No Rest for the Wicked)」가 절벽 처치를
     * 가르치는 방식 — 좁은 길에 **혼자** 선 적, 플레이어가 오는 쪽의
     * 반대편이 낭떠러지. 플레이어는 평소대로 때렸을 뿐인데 적이 떨어지고,
     * 그 순간 *"세계가 무기다"* 를 스스로 알아냅니다. 가르쳐 준 것이
     * 아니라 **알아낸 것**이라, 사용자가 말한 「스스로 잘한다는 느낌」이
     * 바로 이 자리에서 납니다.
     */
    const PUSH_ARC_COS = Math.cos((60 * Math.PI) / 180)
    const rows = foes.map((e) => {
      const c = cellOf(e)
      const h0 = heightAt(c.cx, c.cz)
      // 🧭 동선에서 이 적을 향하는 쪽 — 넉백이 나가는 방향입니다.
      let near = null
      for (const r of routeCells) {
        const d = Math.hypot((r.cx - c.cx) * CELL, (r.cz - c.cz) * CELL)
        // 같은 칸이면 방향이 안 나옵니다(0 벡터). 한 칸 밖부터 봅니다.
        if (d < CELL) continue
        if (!near || d < near.d) near = { r, d }
      }
      const pux = near ? (c.cx - near.r.cx) / (near.d / CELL) : 0
      const puz = near ? (c.cz - near.r.cz) / (near.d / CELL) : 0
      let drop = 0
      /** 🧭 그중 **등 뒤 부채꼴 안**에 있는 낙차 — 실제로 밀어 넣을 수 있는 것 */
      let behindDrop = 0
      for (let dx = -rad; dx <= rad; dx++) {
        for (let dz = -rad; dz <= rad; dz++) {
          const len = Math.hypot(dx * CELL, dz * CELL)
          if (len > PUSH || len === 0) continue
          const hn = heightAt(c.cx + dx, c.cz + dz)
          if (hn === VOID) continue
          const d = h0 - hn
          drop = Math.max(drop, d)
          const cos = near ? ((dx * CELL) / len) * pux + ((dz * CELL) / len) * puz : -1
          if (cos >= PUSH_ARC_COS) behindDrop = Math.max(behindDrop, d)
        }
      }
      // 이 적이 **동선에서 깨어나는가** — 안 깨면 있어도 없는 것입니다.
      const onRoute = routeCells.some(
        (r) => Math.hypot((r.cx - c.cx) * CELL, (r.cz - c.cz) * CELL) <= wakeOf(e.kind),
      )
      return { kind: e.kind, x: Math.round(e.x), z: Math.round(e.z), drop, behindDrop, onRoute }
    })
    const hurty = rows.filter((r) => r.drop > fall.free)
    const onRoad = hurty.filter((r) => r.onRoute)
    /** 🧭 등 뒤에 낙차가 있고, 동선에서 깨는 것 — **실제로 밀어 넣을 수 있는** 적 */
    const pushable = onRoad.filter((r) => r.behindDrop > fall.free)
    console.log(
      `\n  🪂 밀어서 떨어뜨릴 수 있는 자리 (${PUSH}m 안에 ${fall.free}단 초과 낙차) — ` +
        `적 ${rows.length}마리 중 **${hurty.length}마리** · 그중 동선에서 깨는 것 ${onRoad.length}마리 · ` +
        `그중 낙차가 **등 뒤**인 것 ${pushable.length}마리` +
        (hurty.length
          ? `\n     ${hurty
              .map(
                (r) =>
                  `${r.kind}(${r.x},${r.z}) ${r.drop}단${
                    r.behindDrop > fall.free ? '·등 뒤' : '·옆/앞'
                  }${r.onRoute ? '' : ' ·동선 밖'}`,
              )
              .join(' · ')}`
          : ''),
    )
    check(
      onRoad.length >= 1,
      '🪂 **밀어서 떨어뜨릴 자리가 걷는 길 위에 있다** (절벽을 무기로 쓰는 어휘가 지도에서 사라지지 않게)',
      onRoad.length
        ? `${onRoad.map((r) => `${r.kind}(${r.x},${r.z}) ${r.drop}단`).join(' · ')}`
        : `${fall.free}단 초과 낙차 곁에서 깨는 적이 하나도 없습니다 — 낙하 피해·무너짐 규칙이 코드에만 있게 됩니다`,
    )
    /**
     * 🧭 **방향까지 맞는 자리가 하나는 있어야 합니다.**
     *
     * 위 줄만으로는 *"곁에 절벽이 있다"* 까지밖에 못 셉니다. 그 절벽이
     * 플레이어 쪽에 있으면 같은 지형이 **가르치는 자리**가 아니라
     * **죽는 자리**입니다. 하나만 요구하는 이유는 위 줄과 같습니다 —
     * 마릿수를 요구하면 지도를 절벽투성이로 만들라는 말이 됩니다.
     */
    check(
      pushable.length >= 1,
      '🧭 **낙차가 적의 «등 뒤»인 자리가 하나는 있다** (넉백이 나가는 쪽에 절벽이 있어야 밀어 넣습니다)',
      pushable.length
        ? `${pushable.map((r) => `${r.kind}(${r.x},${r.z}) 등 뒤 ${r.behindDrop}단`).join(' · ')}`
        : `동선에서 깨는 ${onRoad.length}마리 모두 낙차가 옆이나 앞입니다 — 밀면 벽에 붙고, 그 절벽은 **내가** 떨어지는 쪽입니다`,
    )
  }

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
      `\n  🔁 첫 길 ${Math.round(first * CELL)}m (스폰→보스, 칸만 세는 자) · 그 길을 막으면\n` +
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

    /**
     * ── 👁 **보상을 준 곳은 보여야 합니다** ────────────────────────────
     *
     * ── 왜 이 자가 필요해졌는가 ──────────────────────────────────────
     * `npm run secret` 이 보물 (13,47) 을 두고 *"빛기둥도 안 보이고 안내도
     * 안 뜬다"* 며 오래 빨간 채였습니다. 저는 그걸 **보물 하나의 문제**로
     * 읽고 자리를 옮길 곳을 찾다가, 구역 단위로 재 보고 나서야 알았습니다:
     *
     *     남쪽 함몰지   — 구역 전체가 동선에서 **41m**
     *     함몰지 가장자리 — 구역 전체가 동선에서 **34m**
     *     (나머지 열한 구역은 0~18m)
     *
     * **보물이 안 보이는 게 아니라 구역이 안 보입니다.** 그 안에서 자리를
     * 아무리 옮겨도 22m 안으로는 못 들어옵니다(실제로 24m 안 후보 0칸).
     *
     * ⚠️ 한 번 **엉뚱한 결론을 냈다가 되돌렸습니다.** 남쪽 갈래에서 재면
     *    4m 라고 나와서 *"계측기가 동선을 하나로 봤을 뿐"* 이라고 적었는데,
     *    그 수는 **버그 있는 흘리기**가 낸 것이었습니다. 방향을 지키는
     *    다익스트라로 다시 재니 여유 12m 를 줘도 30~40m 였습니다.
     *    **재는 코드가 틀리면 결론이 정확히 거꾸로 나옵니다.**
     *
     * ── 무엇을 거는가 ────────────────────────────────────────────────
     * *"보상이 있는 구역은 그 입구가 카메라(22m) 안에 있어야 한다."*
     * 위 「막다른 곁길에는 보상이 있다」의 짝입니다 — 그쪽은 *"값을
     * 치르게 했으면 갚는가"*, 이쪽은 *"갚을 곳이 있는 줄 아는가"* 입니다.
     * 아무도 못 보는 곳에 놓은 보상은 보상이 아니라 **없는 것**입니다.
     *
     * ⚠️ 「동선」은 **이 파일의 자로** 정합니다(걸음 수 최단). `route` 는
     *    되돌아올 수 없는 걸음에 값을 얹은 자를 쓰므로 수가 조금 다릅니다.
     *    같은 이름의 두 자가 있다는 것을 여기 적어 둡니다 — 숫자를 맞대려면
     *    어느 자로 잰 것인지부터 봐야 합니다.
     */
    {
      const onRoute = []
      const regionCells = new Map()
      for (const g of await page.evaluate(() => window.__game.regionList())) {
        const mine = []
        for (let cx = g.x0; cx <= g.x1; cx++) {
          for (let cz = g.z0; cz <= g.z1; cz++) {
            if (heightAt(cx, cz) === VOID) continue
            const a2 = bfs(spawnC, { cx, cz }, maxClimb, false)
            const b2 = bfs({ cx, cz }, bossC, maxClimb, false)
            if (!Number.isFinite(a2) || !Number.isFinite(b2)) continue
            mine.push({ cx, cz })
            if (a2 + b2 <= straight) onRoute.push({ cx, cz })
          }
        }
        regionCells.set(g.name, mine)
      }
      const eye = await page.evaluate(() => window.__game.terrainInfo().cameraViewSize)
      const rows = []
      for (const [name, cells] of regionCells) {
        if (cells.length === 0) continue
        let best = Infinity
        for (const c of cells) {
          for (const r of onRoute) {
            const d = Math.hypot(c.cx - r.cx, c.cz - r.cz) * CELL
            if (d < best) best = d
          }
        }
        const info = dead.find((r) => r.name === name)
        rows.push({ name, d: best, reward: info ? info.has : false, side: !!info })
      }
      rows.sort((p2, q2) => q2.d - p2.d)
      console.log(`\n  👁 **구역이 동선에서 얼마나 떨어져 있는가** (카메라 ${eye}m · 동선 ${onRoute.length}칸)`)
      for (const r of rows.slice(0, 6))
        console.log(
          `     ${r.name} — ${r.d.toFixed(0)}m${r.side ? ' (곁길)' : ''}${r.reward ? ' · 보상 있음' : ''}` +
            `${r.d > eye ? '  ❌ 카메라 밖' : ''}`,
        )
      const blind = rows.filter((r) => r.reward && r.d > eye)
      const rewarded = rows.filter((r) => r.reward)
      /**
       * ── ⚠️ **여기서 판정하지 않습니다** (걸었다가 걷었습니다) ──────────
       *
       * 처음에는 *"보상이 있는 구역은 카메라(22m) 안에 있어야 한다"* 를
       * 실패로 걸었습니다. 남쪽 함몰지(32m)와 함몰지 가장자리(28m)가
       * 빨개졌고, 숫자는 맞습니다. 그런데 **어디가 가장 가까운지**를
       * 찍어 보고 물음이 틀렸다는 걸 알았습니다:
       *
       *     함몰지 가장자리 (57,53) ↔ 동선 (57,39)   — 둘 다 **같은 좁은 길** 위
       *
       * 즉 그 구역은 **동선이 지나는 통로가 남쪽으로 그대로 이어진 끝**
       * 입니다. 통로가 이어지는 것은 22m 밖에서도 보입니다 — 「저 길이
       * 계속 가네」가 곧 초대장입니다. 오공·엘든 링이 곁길을 여는 가장
       * 흔한 방식이 정확히 그것입니다.
       *
       * 그렇다고 물음을 *"길로 이어져 있는가"* 로 바꾸면 **거의 모든 구역이
       * 통과합니다**(다 걸어서 닿으니까요) — 아무도 못 넘는 문턱이 아니라
       * **아무나 넘는 문턱**이 되고, 그건 눈금이 아니라 장식입니다.
       *
       * 그래서 **재기만 하고 사람에게 넘깁니다.** 재는 것 자체는 값이
       * 있습니다 — 이 표가 없었으면 「보물 하나가 안 보인다」로 계속
       * 읽었을 것이고, 실제로 저는 그 보물의 자리를 옮길 곳을 찾느라
       * 시간을 썼습니다. **구역이 멀다**는 것을 알아야 옮길 것이
       * 보물이 아니라 **길이나 구역**임을 압니다.
       */
      console.log(
        `     ⚠️ **판정은 안 겁니다** — 카메라 밖 ${blind.length}곳(${blind
          .map((r) => `${r.name} ${r.d.toFixed(0)}m`)
          .join(' · ') || '없음'})은 「이어진 통로의 끝」일 수 있습니다.` +
          ' 그건 이 자로 못 가릅니다',
      )
      /**
       * ⚠️ 대신 **잰 것 자체는 검사합니다.** 표가 비면 위 문단이 아무
       *    말도 안 하게 되고, 그러면 「판정을 안 건다」가 「아무것도 안
       *    잰다」와 구별이 안 됩니다.
       */
      check(
        rewarded.length > 0 && onRoute.length > 0,
        '👁 **구역과 동선의 거리를 실제로 쟀다** (판정은 사람 몫 — 위 ⚠️)',
        `동선 ${onRoute.length}칸 · 보상 있는 구역 ${rewarded.length}곳 · 가장 먼 곳 ${rows[0]?.name} ${rows[0]?.d.toFixed(0)}m`,
      )
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
