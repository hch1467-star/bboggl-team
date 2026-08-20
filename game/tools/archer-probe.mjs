/**
 * 🏹 쏘는 자 실험대 — `npm run archer`
 *
 * ── 무엇을 묻는가 ──────────────────────────────────────────────────
 * `npm run map` 은 쏘는 자에 대해 이렇게 **계산**합니다:
 *
 *     깨는 거리 19m 안의 동선 50m ÷ 이동 5.4m/s = 9.3초
 *     ÷ 한 바퀴 5.35초 = **1.7발**
 *
 * 그런데 같은 판을 실제로 걸은 자동 플레이 기록에는 쏘는 자가
 * **한 줄도 없습니다.** 예고 0회 · 피해 0 · 그 구역(오르는 계단)에서
 * 적의 휘두름 0회. 지도는 1.7발이라 하고 판은 0발입니다.
 *
 * 둘 중 하나는 틀렸는데, **어느 쪽인지 모르면 고칠 수가 없습니다.**
 *   · 모델이 틀렸다  → 고칠 것은 `map-probe` 의 식입니다
 *   · 판이 틀렸다    → 고칠 것은 배치나 수치입니다
 * 값을 먼저 만지면 이 저장소가 이미 두 번 그랬듯 게임을 망가뜨립니다
 * (「계측기가 틀렸을 때 값을 만지면 게임을 망가뜨린다」).
 *
 * 그래서 **재는 것을 먼저 만듭니다.** 이 실험대는 지도가 계산한 바로 그
 * 상황을 실제로 실행합니다 — 진짜 판, 진짜 동선, 진짜 걸음, 진짜 AI.
 *
 * ── 두 가지를 따로 잽니다 ──────────────────────────────────────────
 * ① **지나가기** — 동선을 그냥 걸어 지나갑니다. 지도의 1.7발과 비교합니다.
 * ② **멈춰 서기** — 사거리 안에 서 있습니다. 두 발째가 **언제** 오는지 잽니다.
 *
 * 왜 둘인가: `enemyAttacks.ts` 의 `archer_shot` 주석이 이 적의 설계를
 * 이렇게 적어 두었습니다 — *"이 적이 만드는 새로움은 색이 아니라 위치입니다
 * — **붙어 있는 잡몹을 상대하는 동안 계속 날아오니까요**."* 즉 설계상 이
 * 적의 무대는 「지나가는 사람」이 아니라 「멈춰 서서 싸우는 사람」입니다.
 * 그런데 지도는 ①만 재고 있었습니다. ②를 재야 설계를 검사하는 것입니다.
 *
 * ── 다른 게임의 좌표 ───────────────────────────────────────────────
 * 궁수를 잘 쓰는 게임들은 하나같이 **혼자 두지 않습니다.**
 *   · 다크 소울 1 아노르 론도 — 좁은 들보 위에 세워, 화살과 발밑을
 *     동시에 처리하게 만듭니다. 화살 자체는 피할 수 있습니다.
 *   · 엘든 링 성벽 저격수 — 근접전을 **느긋하게 하지 못하게** 하는 세금.
 *   · 로스트아크 원거리 잡몹 — 채널링을 끊어 **처치 우선순위**를 강요.
 *   · 검은 신화: 오공 창 던지는 적 — 강공격의 **후딜**을 노립니다.
 * 넷 다 같은 말입니다: **궁수는 혼자서 위협이 아니라, 다른 싸움을 어렵게
 * 만드는 장치입니다.** ②가 그것을 재는 눈금입니다.
 *
 * ── ⚠️ 아레나에 세우면 안 됩니다 ───────────────────────────────────
 * 깨는 거리는 **모드에 따라 다릅니다** — 레벨 19m, 아레나 55m
 * (`enemyAI.wakeRangeOf`). 편하다고 아레나에 허수아비를 세우면
 * **게임과 다른 규칙**을 재게 됩니다. 그래서 이 실험대는 진짜 판을 열고,
 * 다른 적만 치운 뒤, 원래 자리에 쏘는 자를 다시 세웁니다.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5263
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const level = JSON.parse(
  readFileSync(path.join(ROOT, 'src/levels/broken-gate.json'), 'utf8'),
)
const CELL = level.cellSize ?? 2
/** 셀 → 월드. 지도 프로브와 **같은 규약**입니다(map-probe `cellOf` 의 역). */
const worldOf = (cx, cz) => ({ x: (cx - level.w / 2 + 0.5) * CELL, z: (cz - level.h / 2 + 0.5) * CELL })
const cellOf = (e) => ({ cx: Math.floor(e.x / CELL + level.w / 2), cz: Math.floor(e.z / CELL + level.h / 2) })

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

  console.log('\n🏹 쏘는 자 실험대 — 지도가 계산한 「1.7발」을 실제로 실행해 봅니다\n')

  /**
   * ---- 0. 판을 처음 상태로 ----
   *
   * 내려진 사다리는 **세이브에 남습니다.** 그대로 두면 길찾기가 열린
   * 지름길로 동선을 그려, 지도가 잰 것과 **다른 길**을 걷게 됩니다.
   * 지난 회차에 이걸로 크게 속았습니다(map-probe 같은 자리 주석).
   */
  await page.evaluate(() => {
    window.__game.resetProgress()
    window.__game.reset()
  })
  await new Promise((r) => setTimeout(r, 400))

  /**
   * ---- 1. 규칙을 **게임에게 묻습니다** ----
   *
   * 여기 식을 베껴 두면 밸런스를 손보는 날 검사만 옛말을 합니다.
   * 특히 `wakeRange` 는 원래 `map-probe` 가 손으로 다시 계산하던 값이라,
   * 이번에 `enemyAI.wakeRangeOf` 한 곳으로 모으고 로스터로 내보냈습니다.
   */
  const rules = await page.evaluate(() => {
    const G = window.__game
    const a = G.enemyRoster().find((r) => r.id === 'archer')
    const t = G.terrainInfo()
    return {
      archer: a,
      walkSpeed: t.playerMoveSpeed,
    }
  })
  const A = rules.archer
  const bands = A.attacks.map((a) => `${a.id} 예고 ${a.windup}초·${a.minRange}~${a.maxRange}m`)
  console.log(
    `  [규칙] 쏘는 자 — 깨는 거리 ${A.wakeRange}m · 한 바퀴 ${A.attackCycle.toFixed(2)}초 · ` +
      `체력 ${A.maxHp} · 물러나는 거리 ${A.keepDistance ?? 0}m · 걸음 ${rules.walkSpeed}m/s`,
  )
  console.log(`         패턴 — ${bands.join(' · ')}`)

  /**
   * 🚧 **비교 앞에 세우는 게이트.** 쏘는 자가 사거리 밖에서 깨어나야
   *    "지나가며 쏜다"가 성립합니다. 깨는 거리가 사거리보다 작으면
   *    이 실험 전체가 무의미하므로, 먼저 그것부터 확인합니다.
   */
  const maxShotRange = Math.max(...A.attacks.map((a) => a.maxRange))
  const minShotRange = Math.min(...A.attacks.map((a) => a.minRange))
  const [WAKE, SMIN, SMAX] = [A.wakeRange, minShotRange, maxShotRange]
  check(
    A.wakeRange > maxShotRange,
    '🚧 깨는 거리가 사거리보다 **멀다** (사거리 안에서야 깨면 쏠 틈이 없습니다)',
    `깨는 ${A.wakeRange}m vs 사거리 ${maxShotRange}m · 여유 ${(A.wakeRange - maxShotRange).toFixed(1)}m`,
  )

  /**
   * ---- 2. 판에서 **다른 적만** 치우고 쏘는 자를 원래 자리에 세웁니다 ----
   *
   * 격리하는 이유: 다른 적이 붙으면 걸음이 막혀 「지나가기」가 성립하지
   * 않고, 그러면 0발이 나와도 **쏘는 자 때문인지 길이 막혀서인지** 못
   * 가릅니다. 원인이 둘인데 처방이 정반대인 상황을 만들지 않습니다.
   */
  const archerEnt = level.entities.find((e) => e.kind === 'archer')
  if (!archerEnt) throw new Error('판에 쏘는 자가 없습니다')
  const ac = cellOf(archerEnt)
  const aw = worldOf(ac.cx, ac.cz)

  const spawned = await page.evaluate(
    ([x, z]) => {
      const G = window.__game
      G.clearEnemies()
      // 잠든 채로 세웁니다 — **깨는 것 자체가 측정 대상**이라 깨워 두면 안 됩니다.
      return G.spawnEnemyKind('archer', x, z, true)
    },
    [aw.x, aw.z],
  )
  check(spawned >= 0, '🚧 쏘는 자를 원래 자리에 다시 세웠다', `칸 (${ac.cx},${ac.cz}) · 월드 (${aw.x},${aw.z})`)

  /**
   * ---- 3. 동선에서 **쏘는 자 앞뒤 구간**을 잘라 냅니다 ----
   *
   * 게임에게 동선을 물어봅니다(`routeTrail`). 여기서 다시 길찾기를 짜면
   * 지난 회차에 고친 그 병 — **동선을 여러 곳에서 따로 그리기** — 이
   * 재발합니다.
   */
  const fire = level.entities
    .filter((e) => e.kind === 'bonfire')
    .map(cellOf)
    .sort((a, b) => a.cx - b.cx)[0]
  const bossC = cellOf(level.entities.find((e) => e.kind === 'boss'))
  const fw = worldOf(fire.cx, fire.cz)
  const bw = worldOf(bossC.cx, bossC.cz)
  const trail = await page.evaluate(
    ([fx, fz, bx, bz]) => window.__game.routeTrail(fx, fz, bx, bz),
    [fw.x, fw.z, bw.x, bw.z],
  )
  const distTo = (p) => Math.hypot(p.x - aw.x, p.z - aw.z)
  /** 깨는 거리보다 한 칸 더 앞에서 출발합니다 — 깨는 순간을 놓치지 않게. */
  const MARGIN = CELL * 2
  const near = trail.map((p, i) => ({ i, d: distTo(p) })).filter((r) => r.d <= A.wakeRange + MARGIN)
  check(
    near.length > 0,
    '🚧 동선이 쏘는 자의 깨는 거리 안을 **실제로 지난다** (안 지나면 잴 것이 없습니다)',
    near.length ? `${near.length}칸 · 가장 가까이 ${Math.min(...near.map((r) => r.d)).toFixed(1)}m` : '0칸',
  )
  const from = near[0].i
  const to = near[near.length - 1].i
  const stretch = trail.slice(from, to + 1)
  const closest = stretch.reduce((b, p) => (distTo(p) < distTo(b) ? p : b), stretch[0])

  /**
   * ---- 4. 실험 ① — **지나가기** ----
   *
   * 지도가 계산한 그 상황입니다. 실제로 걸어서 몇 발이 오는지 셉니다.
   */
  await page.evaluate(([WAKE, SMIN, SMAX]) => {
    const G = window.__game
    /** 시뮬레이션 시계로 기다립니다 — 벽시계로 재면 이 컨테이너에서는
     *  한 프레임이 0.2초라 「1.2초」가 여섯 프레임이 됩니다(두 번 데었습니다). */
    window.__t = {
      runFor: async (s) => {
        const end = G.state().simElapsed + s
        const dl = Date.now() + 180000
        while (G.state().simElapsed < end && Date.now() < dl) await new Promise((r) => setTimeout(r, 6))
      },
    }
    /**
     * 🔭 **예고 감시기.** 예고가 시작되는 순간을 세려면 프레임 사이를
     * 촘촘히 봐야 합니다. Node 에서 매번 물어보면 왕복이 느려 놓칩니다.
     */
    const w = {
      tele: [],
      woke: null,
      minDist: Infinity,
      /** 🚶 깨는 판정이 쓰는 값의 최솟값 — 직선과 나란히 놓고 봅니다. */
      minWalk: Infinity,
      /** 직선으로는 사거리 안인데 **걸어서는 깨는 거리 밖**이었던 프레임. */
      asleepFar: 0,
      awake: 0,
      inShot: 0,
      samplesInShot: [],
      samples: 0,
      wake: WAKE,
      shotMin: SMIN,
      shotMax: SMAX,
    }
    window.__arch = w
    let prevId = ''
    w.timer = setInterval(() => {
      const G2 = window.__game
      const st = G2.state()
      w.samples++
      const th = G2.threats(200)
      const t0 = th.length ? th.reduce((b, x) => (x.dist < b.dist ? x : b), th[0]) : null
      if (t0) {
        w.minDist = Math.min(w.minDist, t0.dist)
        /**
         * 🚶 **깨는 판정이 실제로 쓰는 값**을 그대로 받아 적습니다.
         *
         * 이 게임은 적을 **직선거리가 아니라 걸어야 하는 거리**로 깨웁니다
         * (벽 건너 적이 직선 12.4m 라고 깨어나 영원히 벽을 향해 걷던 사고
         * 때문입니다 — 실제 경로는 98m 였습니다). 그래서 직선만 보면
         * *"코앞인데 왜 안 깨지?"* 가 영원히 안 풀립니다.
         *
         * `enemyInfo().walk` 는 AI 가 쓰는 그 값입니다. 프로브가 지형에서
         * 다시 계산하면 **다른 함수**를 검사하게 됩니다.
         */
        const inf = G2.enemyInfo(t0.entity)
        const walk = inf ? inf.walk : null
        if (walk !== null && walk < w.minWalk) w.minWalk = walk
        // 직선은 가까운데 걸어서는 먼 자리 — 원거리 적이 잠드는 자리입니다.
        if (t0.dist <= w.shotMax && (walk === null || walk > w.wake)) w.asleepFar++
        if (t0.aggro) w.awake++
        if (t0.dist >= w.shotMin && t0.dist <= w.shotMax) {
          w.inShot++
          w.samplesInShot.push({
            straight: Number(t0.dist.toFixed(1)),
            walk: walk === null ? null : Number(walk.toFixed(1)),
            aggro: t0.aggro,
            why: t0.idleWhy,
          })
        }
        if (t0.aggro && w.woke === null)
          w.woke = {
            at: st.simElapsed,
            dist: Number(t0.dist.toFixed(2)),
            walk: walk === null ? null : Number(walk.toFixed(2)),
          }
      }
      const mine = G2.telegraphs()
      const id = mine.length ? mine[0].attackId : ''
      // 같은 예고가 이어지는 동안은 한 번만 셉니다 — id 가 바뀌는 순간이 시작입니다.
      if (id && id !== prevId) {
        w.tele.push({ id, at: Number(st.simElapsed.toFixed(2)), dist: t0 ? Number(t0.dist.toFixed(2)) : null })
      }
      prevId = id
    }, 6)
  }, [WAKE, SMIN, SMAX])

  const walkResult = await page.evaluate(
    async ([cells, speed]) => {
      const G = window.__game
      const held = new Set()
      const hold = (c) => {
        if (!held.has(c)) {
          held.add(c)
          G.press(c)
        }
      }
      const release = (c) => {
        if (held.has(c)) {
          held.delete(c)
          G.release(c)
        }
      }
      const releaseAll = () => [...held].forEach(release)

      G.teleportPlayer(cells[0].x, cells[0].z)
      await window.__t.runFor(0.4)
      const t0 = G.state().simElapsed
      const p0 = G.state().player
      let walked = 0
      let last = { x: p0.x, z: p0.z }
      for (const target of cells.slice(1)) {
        // 한 칸에 지나치게 오래 매달리지 않게 상한을 둡니다(끼면 그 사실을 남깁니다).
        const deadline = G.state().simElapsed + 4
        while (G.state().simElapsed < deadline) {
          const p = G.state().player
          walked += Math.hypot(p.x - last.x, p.z - last.z)
          last = { x: p.x, z: p.z }
          const dx = target.x - p.x
          const dz = target.z - p.z
          if (Math.hypot(dx, dz) < 1.2) break
          const cam = G.cameraAxes()
          const fwd = dx * cam.forwardX + dz * cam.forwardZ
          const right = dx * cam.rightX + dz * cam.rightZ
          const dead = 0.25
          fwd > dead ? hold('KeyW') : release('KeyW')
          fwd < -dead ? hold('KeyS') : release('KeyS')
          right > dead ? hold('KeyD') : release('KeyD')
          right < -dead ? hold('KeyA') : release('KeyA')
          await new Promise((r) => setTimeout(r, 6))
        }
      }
      releaseAll()
      const p = G.state().player
      walked += Math.hypot(p.x - last.x, p.z - last.z)
      return {
        seconds: Number((G.state().simElapsed - t0).toFixed(2)),
        walked: Number(walked.toFixed(1)),
        hp: G.state().player.hp,
        speed,
      }
    },
    [stretch, rules.walkSpeed],
  )
  const walkWatch = await page.evaluate(() => ({ ...window.__arch, timer: undefined }))

  /**
   * 📐 **지도와 같은 식**을 이 구간에 적용한 값입니다.
   *
   * ⚠️ `npm run map` 이 찍는 숫자와 **똑같지 않습니다.** 지도는 깨는 거리
   *    안의 동선(50m)만 세고, 여기는 깨는 순간을 놓치지 않으려고 앞뒤로
   *    두 칸씩 더 걷습니다(58m). 그래서 지도 1.7발 · 여기 2.0발입니다.
   *    비교하는 것은 **식이 맞느냐**이지 두 숫자가 같으냐가 아닙니다 —
   *    같은 구간에 같은 식을 쓰고, 그 구간을 실제로 걸어 봅니다.
   */
  const predicted = (stretch.length * CELL) / rules.walkSpeed / A.attackCycle
  console.log(
    `\n  ① 지나가기 — 동선 ${stretch.length}칸(${stretch.length * CELL}m) 을 걸었습니다\n` +
      `     실제로 걸은 거리 ${walkResult.walked}m · 걸린 시간 ${walkResult.seconds}초 ` +
      `(걸음 ${rules.walkSpeed}m/s 로 계산하면 ${((stretch.length * CELL) / rules.walkSpeed).toFixed(1)}초)\n` +
      `     가장 가까이 붙은 거리 ${walkWatch.minDist === null ? '—' : walkWatch.minDist.toFixed(1)}m ` +
      `(걸어서 ${Number.isFinite(walkWatch.minWalk) ? walkWatch.minWalk.toFixed(1) : '길없음'}m)\n` +
      `     깬 순간 ${walkWatch.woke ? `직선 ${walkWatch.woke.dist}m · 걸어서 ${walkWatch.woke.walk ?? '?'}m` : '**안 깼습니다**'}\n` +
      `     사거리 안 ${walkWatch.inShot}표본 · 깨어 있던 ${walkWatch.awake}표본(사거리 밖 포함) · ` +
      `직선은 사거리 안인데 **걸어서는 깨는 거리 밖**이던 ${walkWatch.asleepFar}표본\n` +
      `     📐 같은 식으로 계산하면 **${predicted.toFixed(1)}발**  vs  🏹 실측 **${walkWatch.tele.length}발**` +
      (walkWatch.tele.length
        ? ` (${walkWatch.tele.map((t) => `${t.id}@${t.dist}m`).join(' · ')})`
        : ''),
  )

  /**
   * 🚧 걸음이 실제로 나갔는지부터 봅니다. 안 걸었는데 0발이면
   *    그건 쏘는 자 이야기가 아니라 **실험대 고장**입니다.
   */
  check(
    walkResult.walked > stretch.length * CELL * 0.5,
    '🚧 실험대가 **실제로 걸었다** (안 걷고 0발이면 그건 실험대 고장입니다)',
    `${walkResult.walked}m / 동선 ${stretch.length * CELL}m`,
  )
  /**
   * ── 🚶 **직선은 코앞인데 걸어서는 먼 자리** ────────────────────────
   *
   * 이 게임은 적을 **걸어야 하는 거리**로 깨웁니다. 근접 적에게는 옳은
   * 규칙입니다 — 벽 건너 적이 직선 12.4m 라고 깨어나 영원히 벽을 향해
   * 걷던 사고(실제 경로 98m)를 고치려고 넣은 것이니까요.
   *
   * 그런데 **원거리 적에게 「돌아가야 하는 자리」는 바로 쏘라고 세워 둔
   * 자리입니다.** 아노르 론도의 은기사 궁수가 건너편 들보에 있는 것이
   * 설계의 전부인 것처럼요. 근접을 고친 규칙이 원거리를 끌 수 있습니다.
   *
   * 자동 플레이가 그 모양을 찍었습니다 — 사거리 안 297프레임 중 깨어
   * 있던 것이 **8프레임**. 다만 봇의 길은 판마다 흔들려서(주 동선 밟은
   * 비율 56~100%) 봇으로는 결론을 못 냅니다. 여기서는 **같은 길을 늘
   * 같게** 걸으므로 결론이 납니다.
   */
  const farFrames = walkWatch.asleepFar
  check(
    farFrames === 0,
    '🚶 **직선으로 사거리 안이면 걸어서도 깨는 거리 안**이다 (원거리 적이 코앞에서 자지 않게)',
    farFrames === 0
      ? `그런 프레임 0개 · 가장 가까이 직선 ${walkWatch.minDist.toFixed(1)}m / 걸어서 ${Number.isFinite(walkWatch.minWalk) ? walkWatch.minWalk.toFixed(1) : '길없음'}m`
      : `${farFrames}프레임 — 예: ` +
        (walkWatch.samplesInShot ?? [])
          .filter((s) => s.walk === null || s.walk > A.wakeRange)
          .slice(0, 3)
          .map((s) => `직선 ${s.straight}m/걸어서 ${s.walk ?? '길없음'}m`)
          .join(' · ') +
        ` (깨는 거리 ${A.wakeRange}m)`,
  )

  check(
    walkWatch.woke !== null,
    '🚧 지나가는 동안 쏘는 자가 **깨어났다**',
    walkWatch.woke ? `${walkWatch.woke.dist}m 에서` : `가장 가까이 ${walkWatch.minDist.toFixed(1)}m 까지 갔는데도 안 깼습니다`,
  )

  /**
   * 📐 **모델과 실측을 맞대 봅니다 — 이 회차의 핵심 판정입니다.**
   *
   * 지도는 이 상황을 1.7발이라 계산합니다. 실측이 크게 다르면 고칠 것은
   * 배치가 아니라 **지도의 식**입니다. 문턱을 반올림 한 발로 둡니다 —
   * 예고가 걸치는 타이밍 때문에 ±1 은 정직한 오차입니다.
   */
  check(
    Math.abs(walkWatch.tele.length - predicted) <= 1,
    '📐 **지도의 예측과 실측이 한 발 안쪽으로 맞는다** (안 맞으면 고칠 것은 배치가 아니라 식입니다)',
    `예측 ${predicted.toFixed(1)}발 · 실측 ${walkWatch.tele.length}발 · 차이 ${Math.abs(walkWatch.tele.length - predicted).toFixed(1)}`,
  )

  /**
   * ---- 5. 실험 ② — **멈춰 서기** ----
   *
   * 설계가 말하는 이 적의 진짜 무대입니다. 사거리 안에 서 있을 때
   * **두 발째가 언제 오는가.** 그 시간이 곧 *"이 궁수를 무시하고 다른
   * 적과 싸울 수 있는 시간"* 입니다.
   *
   * 서 있는 자리는 동선에서 쏘는 자에게 가장 가까운 칸입니다 —
   * 임의의 좌표를 고르면 판에 없는 상황을 재게 됩니다.
   */
  const standSeconds = A.attackCycle * 3
  const stand = await page.evaluate(
    async ([x, z, secs]) => {
      const G = window.__game
      const w = window.__arch
      w.tele.length = 0
      G.teleportPlayer(x, z)
      const t0 = G.state().simElapsed
      w.standT0 = t0
      await window.__t.runFor(secs)
      return { seconds: Number((G.state().simElapsed - t0).toFixed(2)), hp: G.state().player.hp }
    },
    [closest.x, closest.z, standSeconds],
  )
  const standWatch = await page.evaluate(() => ({ tele: window.__arch.tele, t0: window.__arch.standT0 }))
  const rel = standWatch.tele.map((t) => Number((t.at - standWatch.t0).toFixed(2)))
  console.log(
    `\n  ② 멈춰 서기 — 동선에서 가장 가까운 칸(${distTo(closest).toFixed(1)}m)에 ${stand.seconds}초 서 있었습니다\n` +
      `     예고 ${standWatch.tele.length}발` +
      (rel.length ? ` — ${standWatch.tele.map((t, i) => `${t.id} ${rel[i]}초`).join(' · ')}` : '') +
      `\n     체력 ${walkResult.hp} → ${stand.hp}`,
  )

  check(
    standWatch.tele.length >= 1,
    '🏹 **사거리 안에 서 있으면 실제로 쏜다** (설계가 말하는 이 적의 무대입니다)',
    `${stand.seconds}초 동안 ${standWatch.tele.length}발`,
  )
  /**
   * 두 발째까지의 시간 = *"이 궁수를 무시하고 다른 적과 싸울 수 있는 시간"*.
   * 한 바퀴(`attackCycle`) 안쪽이면 설계대로 **압박**이고, 그보다 훨씬
   * 길면 실질적으로 **없는 적**입니다.
   */
  const second = rel.length >= 2 ? rel[1] : null
  check(
    second !== null && second <= A.attackCycle * 2,
    '🏹 **두 발째가 한 바퀴 두 번 안에 온다** (「붙는 동안 여러 발」이라던 설계대로)',
    second === null
      ? `${stand.seconds}초 동안 두 발째가 안 왔습니다 (한 바퀴 ${A.attackCycle.toFixed(2)}초)`
      : `${second}초 · 한 바퀴 ${A.attackCycle.toFixed(2)}초`,
  )

  /**
   * ---- 6. 실험 ③ — **다른 적이 있을 때** (A/B) ----
   *
   * ── 왜 이 실험이 남았는가 ──────────────────────────────────────────
   * 여기까지 가설이 **다섯 번 틀렸습니다.** 궁수 수치 → 지도의 식 →
   * 봇의 동선 → 공격 토큰 → 걸어야 하는 거리. 다섯 번 다 계측기가
   * 먼저 말했고, 위 ①②가 그중 넷을 지웠습니다:
   *
   *     실험대에서는 **전부 정상**입니다 — 지나가면 2발, 서 있으면 3발.
   *     그런데 진짜 판에서는 사거리 안 297프레임 중 깨어 있던 것이
   *     **8프레임**이고, 그 8프레임에는 막은 문이 **없습니다**.
   *
   * 이제 실험대와 진짜 판 사이에 남은 **측정된 차이는 하나**입니다 —
   * 위 2번에서 `clearEnemies()` 로 치운 **다른 적 30마리**.
   *
   * 그래서 ②를 그대로 한 번 더 하되, **적을 안 치우고** 합니다.
   * 조건이 하나만 다른 두 판이라 결과 차이의 원인이 하나로 좁혀집니다.
   * (이 저장소가 출혈 실험대에서 쓴 것과 같은 방법입니다 — 죽지 않는
   *  허수아비를 세우고 변수를 하나만 남겼습니다.)
   *
   * ⚠️ 여기서 「없음」이 아니라 다른 문이 나오면, 그것이 여섯 번째
   *    가설이 아니라 **답**입니다. 실험대는 같은 길을 늘 같게 걷습니다.
   */
  const crowd = await page.evaluate(
    async ([x, z, secs]) => {
      const G = window.__game
      const w = window.__arch
      // 판을 통째로 되돌립니다 — 치웠던 적 30마리가 원래 자리로 돌아옵니다.
      G.resetProgress()
      G.reset()
      await window.__t.runFor(0.5)
      w.tele.length = 0
      w.why = {}
      w.crowdAwake = 0
      w.crowdInShot = 0
      G.teleportPlayer(x, z)
      const t0 = G.state().simElapsed
      const dl = Date.now() + 240000
      /** 이 실험 동안만 궁수를 따로 지켜봅니다 — 가장 가까운 적은 잡몹일 수 있습니다. */
      while (G.state().simElapsed < t0 + secs && Date.now() < dl) {
        const a = G.threats(400).find(
          (t) => t.kind === 'archer' && Math.hypot(t.x - x, t.z - z) < 6,
        )
        if (a) {
          if (a.aggro) w.crowdAwake++
          if (a.dist >= w.shotMin && a.dist <= w.shotMax) {
            w.crowdInShot++
            if (a.aggro) w.why[a.idleWhy] = (w.why[a.idleWhy] ?? 0) + 1
          }
        }
        await new Promise((r) => setTimeout(r, 6))
      }
      return {
        seconds: Number((G.state().simElapsed - t0).toFixed(2)),
        hp: G.state().player.hp,
        awake: w.crowdAwake,
        inShot: w.crowdInShot,
        why: w.why,
        tele: w.tele.length,
        others: G.threats(20).filter((t) => t.kind !== 'archer').length,
      }
    },
    [closest.x, closest.z, standSeconds],
  )
  const whyText = Object.entries(crowd.why ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}표본`)
    .join(' · ')
  console.log(
    `\n  ③ 다른 적이 있을 때 — 같은 자리에 ${crowd.seconds}초 (곁의 다른 적 ${crowd.others}마리)\n` +
      `     예고 ${crowd.tele}발 · 사거리 안 ${crowd.inShot}표본 · 그중 깨어 있던 ${crowd.awake}표본\n` +
      `     막은 문 — ${whyText || '(깨어 있던 표본 없음)'}`,
  )
  /**
   * 📐 **이 회차의 결론이 걸린 줄입니다.**
   * ②(혼자)와 ③(다른 적과 함께)의 차이가 곧 원인입니다.
   */
  check(
    crowd.tele >= 1,
    '🏹 **다른 적이 곁에 있어도 쏜다** (「붙어 있는 잡몹을 상대하는 동안 계속 날아온다」는 설계 그대로)',
    `혼자 ${standWatch.tele.length}발 vs 다른 적과 함께 ${crowd.tele}발` +
      (crowd.tele === 0 && crowd.awake === 0 ? ' — **깨지도 않았습니다**' : ''),
  )

  await page.evaluate(() => clearInterval(window.__arch.timer))
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} catch (e) {
  console.log(`\n💥 ${e && e.stack ? e.stack : e}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
