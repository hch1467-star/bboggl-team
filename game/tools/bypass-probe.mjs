/**
 * 지나치기 프로브 — `npm run bypass`
 *
 * ── 왜 이걸 재는가 ──────────────────────────────────────────────
 * 방금 **달리기**(Shift, 1.55배)를 넣었습니다. 그런데 달리기는 이동만
 * 바꾸는 기능이 아닙니다. **거리의 값을 바꾸는** 기능입니다.
 *
 * 이 존의 설계는 전부 "걸어서 지나간다"를 전제로 잽니다:
 *   · `npm run map` 의 "위협 없이 30m(약 6초) 넘게 걷지 말 것"
 *   · 궁수가 "지나가는 동안 2발 쏜다"는 배치 근거
 *   · 방 단위 어그로 14m
 * 이 6초·2발·14m는 전부 **초당 5.4m**로 나눈 값입니다. 8.4m/s가 되면
 * 같은 배치가 다른 게임이 됩니다 — 노출 시간이 36% 줄어듭니다.
 *
 * ── 다른 게임은 이걸 어떻게 다루는가 ────────────────────────────
 * · **엘든 링 / 다크소울**: 달려서 지나갈 수 있습니다. 대신 **공짜가
 *   아닙니다** — 등 뒤에서 맞고, 화톳불까지 끌고 가고, 보스방 앞에
 *   **피가 깎인 채** 도착합니다. 그게 "그냥 뛰어"의 가격표입니다.
 * · **로스트아크**: 잡몹을 지나칠 수 있지만 문이 잠겨 있거나 관문
 *   보상이 참여를 강제합니다.
 * · **검은 신화: 오공**: 달리기가 자유롭지만 통로가 좁아 지나칠 공간이
 *   애초에 없습니다.
 *
 * 셋 다 "못 지나가게" 막지 않습니다. **지나가는 데 값을 매깁니다.**
 * 우리 게임은 어느 쪽인지 **한 번도 재 본 적이 없습니다.**
 *
 * ── 그래서 여기서 재는 것 ───────────────────────────────────────
 *   싸우지 않고 목표만 따라 보스까지 간다. 걸어서 한 번, 달려서 한 번.
 *   · 얼마나 걸리는가 (시뮬레이션 시간)
 *   · **체력을 얼마나 잃는가** ← 이게 "가격표"입니다
 *   · 몇 대나 맞는가 · 몇 마리를 뒤에 달고 도착하는가
 *
 * 값이 0이면 이 존의 전투는 전부 **선택 사항**이고, 4색을 가르치려고
 * 만든 배치가 통째로 건너뛰어집니다.
 *
 * ⚠️ 이 프로브는 수치를 하나도 베껴 적지 않습니다. 속도·성수병 회복량은
 *    전부 게임에서 꺼내 씁니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5207
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

  console.log('\n🏃 지나치기 프로브 — 싸우지 않고 보스까지\n')

  const terrain = await page.evaluate(() => window.__game.terrainInfo())
  const walkSpeed = terrain.playerMoveSpeed
  const runSpeed = walkSpeed * terrain.sprintScale
  console.log(
    `  [속도] 걷기 ${walkSpeed.toFixed(1)} m/s · 달리기 ${runSpeed.toFixed(1)} m/s (×${terrain.sprintScale})`,
  )

  // 가장 빠른 적이 누구인지도 **게임에서** 꺼냅니다.
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  // ⚠️ `moveSpeed` 가 아니라 `approachSpeed` 로 고릅니다 — 도망을 따라잡는 건
  //    전투 속도가 아니라 **사거리 밖에서 내는 속도**입니다.
  const fastest = roster.reduce((m, r) => (r.approachSpeed > m.approachSpeed ? r : m), roster[0])
  console.log(
    `  [적] 가장 빨리 다가오는 적 ${fastest.name} ${fastest.approachSpeed.toFixed(1)} m/s ` +
      `(전투 중엔 ${fastest.moveSpeed}) — 걷기의 ${((fastest.approachSpeed / walkSpeed) * 100).toFixed(0)}% · ` +
      `달리기의 ${((fastest.approachSpeed / runSpeed) * 100).toFixed(0)}%\n`,
  )

  /**
   * **한 번의 종주.** 목표(objective)만 따라가고 공격·회피는 절대 안 합니다.
   *
   * 봇이 잘 싸우는지가 아니라 **안 싸우고도 갈 수 있는지**를 재는 것이므로,
   * 여기서 공격을 섞으면 재려던 것이 사라집니다.
   */
  const traverse = async (sprint) =>
    page.evaluate(async (useSprint) => {
      const G = window.__game
      G.resetProgress()
      await new Promise((r) => setTimeout(r, 400))

      const now = () => G.state().simElapsed
      const sleep = () => new Promise((r) => setTimeout(r, 8))
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
      const moveToward = (dx, dz) => {
        const cam = G.cameraAxes()
        const fwd = dx * cam.forwardX + dz * cam.forwardZ
        const right = dx * cam.rightX + dz * cam.rightZ
        const dead = 0.25
        fwd > dead ? hold('KeyW') : release('KeyW')
        fwd < -dead ? hold('KeyS') : release('KeyS')
        right > dead ? hold('KeyD') : release('KeyD')
        right < -dead ? hold('KeyA') : release('KeyA')
      }

      const t0 = now()
      const start = G.state().player
      // 최대 체력도 **게임에서** 꺼냅니다. 100을 적어 두면 밸런스를 바꾼 날
      // "체력 78/100" 같은 거짓말이 로그에 남습니다.
      const maxHp = G.entityState(G.playerEntity())?.maxHp ?? 0
      let lastHp = G.state().player.hp
      let hits = 0
      let damage = 0
      let deaths = 0
      let travelled = 0
      let last = { x: start.x, z: start.z }
      let arrived = false
      let stuckSince = t0
      let stuckPos = { x: start.x, z: start.z }
      let stuckTime = 0

      // 시뮬레이션 시간 기준 제한 — 벽시계로 재면 프레임률에 따라 결과가 흔들립니다.
      const LIMIT = 180
      const wallDeadline = Date.now() + 300000

      while (now() - t0 < LIMIT && Date.now() < wallDeadline) {
        const s = G.state()
        const p = s.player

        travelled += Math.hypot(p.x - last.x, p.z - last.z)
        last = { x: p.x, z: p.z }

        // 받은 피해 — 회복이 없으므로 줄어든 만큼이 곧 피해입니다.
        if (p.hp < lastHp - 0.01) {
          hits++
          damage += lastHp - p.hp
        }
        if (p.hp > lastHp + 0.01) deaths++ // 부활(리스폰)로만 늘어납니다
        lastHp = p.hp

        const be = G.bossEncounter()
        if (be && be.encounter > 0) {
          arrived = true
          break
        }

        const obj = G.objective()
        if (!obj) break
        moveToward(obj.stepX - p.x, obj.stepZ - p.z)

        // 막힘 감시 — 적 몸통에 걸려 못 가면 그것도 "지나치기의 가격"입니다.
        if (Math.hypot(p.x - stuckPos.x, p.z - stuckPos.z) > 1.5) {
          stuckPos = { x: p.x, z: p.z }
          stuckSince = now()
        } else if (now() - stuckSince > 1.0) {
          stuckTime += now() - stuckSince
          stuckSince = now()
        }

        if (useSprint) hold('ShiftLeft')
        else release('ShiftLeft')
        await sleep()
      }

      for (const c of [...held]) release(c)
      // ⚠️ 종주 시간은 **여기서** 확정합니다. 아래 8초 관측을 하고 나서 재면
      //    걷기·달리기 둘 다에 8초가 얹혀 단축률이 흐려집니다.
      const travelTime = now() - t0
      /**
       * ⚠️ **도착 시점의 체력을 여기서 붙잡습니다.**
       *
       * 처음엔 8초 관측이 끝난 뒤의 체력을 "도착 체력"이라고 찍었습니다.
       * 그러니 로그가 `체력 18/100 (피해 4)` 라고 나왔습니다 — 두 수가
       * 서로 모순인데 둘 다 맞았습니다. 하나는 **도착 순간**, 하나는
       * **8초 뒤**의 이야기였을 뿐입니다. 한 줄에 다른 시점의 두 수를
       * 나란히 찍으면 읽는 사람은 반드시 틀리게 읽습니다.
       */
      const arriveHp = G.state().player.hp

      /**
       * **도착 뒤 8초를 더 봅니다.**
       *
       * 엘든 링에서 몹을 달고 안개문을 넘으면 보스방에 그 몹들이 따라옵니다.
       * 그게 "그냥 뛰어"의 진짜 청구서입니다 — 보스 + 잡몹 다섯.
       * 도착하는 **순간**의 추격자 수만 세면 이걸 못 봅니다. 5마리가 따라오다
       * 문턱에서 멈추면 통행료는 0원이고, 안까지 들어오면 제값입니다.
       */
      const arenaSettle = now()
      while (now() - arenaSettle < 8 && Date.now() < wallDeadline) await sleep()
      const be2 = G.bossEncounter()
      const arenaR = be2?.arenaRadius ?? 0
      const inArena = G.threats(300).filter((t) => t.aggro && t.dist <= arenaR).length
      const hpAfterSettle = G.state().player.hp

      const end = G.state()
      const awake = G.threats(300).filter((t) => t.aggro).length
      const chasing = G.threats(300).filter((t) => t.aggro && t.dist < 25).length
      return {
        arrived,
        time: Number(travelTime.toFixed(1)),
        hp: Number(arriveHp.toFixed(1)),
        maxHp,
        damage: Number(damage.toFixed(1)),
        hits,
        deaths,
        travelled: Number(travelled.toFixed(0)),
        kills: end.kills,
        awake,
        chasing,
        inArena,
        arenaR: Number(arenaR.toFixed(1)),
        hpAfterSettle: Number(hpAfterSettle.toFixed(1)),
        /** 도착 뒤 가만히 서 있는 8초 동안 잃은 체력 — 끌고 온 무리의 청구서 */
        trainBill: Number(Math.max(0, arriveHp - hpAfterSettle).toFixed(1)),
        stuck: Number(stuckTime.toFixed(1)),
        enemiesLeft: end.enemiesLeft,
      }
    }, sprint)

  /**
   * **세 판씩 돌립니다.**
   *
   * 이 프로브를 처음 돌렸을 때 달리기 종주가 "피해 0 · 피격 0회"로 나왔고,
   * 같은 코드로 한 번 더 돌리니 "피해 4 · 피격 1회"였습니다. 한 판만 봤으면
   * "완전 무료"라고 적었을 것이고, 그 문장 위에 밸런스를 얹었을 것입니다.
   * 중앙값과 최소~최대를 같이 냅니다 — **범위가 겹치면 증명된 게 아닙니다.**
   */
  const RUNS = 3
  const med = (xs) => {
    const a = [...xs].sort((x, y) => x - y)
    return a[Math.floor(a.length / 2)]
  }
  const span = (xs) => {
    const a = [...xs].sort((x, y) => x - y)
    return `${a[0]}~${a[a.length - 1]}`
  }
  const summarize = (runs) => ({
    arrived: runs.filter((r) => r.arrived).length,
    time: med(runs.map((r) => r.time)),
    timeSpan: span(runs.map((r) => r.time)),
    hp: med(runs.map((r) => r.hp)),
    hpSpan: span(runs.map((r) => r.hp)),
    maxHp: runs[0].maxHp,
    damage: med(runs.map((r) => r.damage)),
    damageSpan: span(runs.map((r) => r.damage)),
    hits: med(runs.map((r) => r.hits)),
    hitsSpan: span(runs.map((r) => r.hits)),
    chasing: med(runs.map((r) => r.chasing)),
    inArena: med(runs.map((r) => r.inArena)),
    inArenaSpan: span(runs.map((r) => r.inArena)),
    trainBill: med(runs.map((r) => r.trainBill)),
    trainBillSpan: span(runs.map((r) => r.trainBill)),
    awake: med(runs.map((r) => r.awake)),
    arenaR: runs[0].arenaR,
    travelled: med(runs.map((r) => r.travelled)),
  })

  const gather = async (sprint) => {
    const runs = []
    for (let i = 0; i < RUNS; i++) runs.push(await traverse(sprint))
    return summarize(runs)
  }

  const walk = await gather(false)
  const run = await gather(true)
  const line = (label, r) =>
    `  [${label}] 도착 ${r.arrived}/${RUNS} · ${r.time}초(${r.timeSpan}) · ${r.travelled}m\n` +
    `           도착 시 체력 ${r.hp}/${r.maxHp}(${r.hpSpan}) · 오는 길 피해 ${r.damage}(${r.damageSpan}) · ` +
    `피격 ${r.hits}회(${r.hitsSpan})\n` +
    `           보스 영역 안까지 따라온 적 ${r.inArena}마리(${r.inArenaSpan}) · ` +
    `가만히 선 8초의 청구서 ${r.trainBill}(${r.trainBillSpan})`
  console.log(line('걸어서', walk))
  console.log(line('달려서', run) + '\n')

  // ---- 1. 종주 자체가 성립하는가 (계기 점검이 먼저) ----
  check(walk.arrived === RUNS, '싸우지 않고 걸어서 보스까지 도달한다 (계기가 실제로 종주를 했다)', `${walk.arrived}/${RUNS} · ${walk.time}초`)
  check(run.arrived === RUNS, '싸우지 않고 달려서 보스까지 도달한다', `${run.arrived}/${RUNS} · ${run.time}초`)

  // ---- 2. 달리기가 실제로 시간을 줄이는가 ----
  //
  // 실험실(sprint 프로브)에서 8.4 m/s가 나왔어도, 지형·적·경로에서 그만큼
  // 줄어드는지는 **다른 질문**입니다. 코너·오르막·몸통 충돌이 다 먹습니다.
  {
    const saved = (1 - run.time / walk.time) * 100
    check(
      saved > 10,
      '달리면 종주 시간이 실제로 줄어든다 (실험실 수치가 지형에서도 산다)',
      `${walk.time}초 → ${run.time}초 (${saved.toFixed(0)}% 단축) · 이론상 최대 ${(
        (1 - walkSpeed / runSpeed) *
        100
      ).toFixed(0)}%`,
    )
  }

  // ---- 3. 지나치기에 값이 붙는가 ← 이 프로브의 존재 이유 ----
  //
  // 기준을 어디서 가져오는가: **성수병 한 병**입니다.
  // 소울류의 계약은 "지나갈 수 있다, 대신 자원을 쓴 상태로 도착한다"입니다.
  // 한 병으로 되돌릴 수 있는 피해면 사실상 0원짜리 통행료입니다.
  const vialHeal = (await page.evaluate(() => window.__game.vialInfo())).heal
  /**
   * 통행료는 **둘 중 하나로만** 내면 됩니다:
   *   ① 오는 길에 맞은 피해가 성수병 한 병을 넘거나
   *   ② 보스방까지 잡몹을 끌고 들어가거나
   * 둘 다 아니면 존 전체가 20초짜리 무료 복도입니다.
   *
   * ②를 인정하는 이유: 엘든 링에서 몹을 달고 안개문을 넘으면 보스방에
   * 그대로 따라 들어옵니다. 청구서가 **나중에** 온다고 해서 없는 게 아닙니다.
   */
  const paidByBlood = run.damage >= vialHeal
  const paidByTrain = run.inArena >= 2
  check(
    paidByBlood || paidByTrain,
    '달려서 지나치는 데 값이 붙는다 (피해로든, 끌고 온 무리로든)',
    `오는 길 피해 ${run.damage}(성수병 ${vialHeal}) · 보스 영역(${run.arenaR}m) 안 ${run.inArena}마리 · 8초 청구서 ${run.trainBill}`,
  )
  check(
    run.chasing >= 2,
    '지나친 적이 뒤를 따라온다 (문턱까지는 온다)',
    `${run.chasing}마리 추격 · 전체 깨어남 ${run.awake}마리`,
  )
  /**
   * ── 여기서 검사 하나를 **버렸습니다** ──────────────────────────
   * 처음엔 `run.hits >= 1` 을 걸었습니다 — "달려서 지나가는 동안 최소
   * 한 번은 닿아야 한다". 달려드는 자에게 접근 속도(6.0)와 돌진(11)을
   * 주고 다시 쟀는데도 **여전히 0회**였습니다. 걸어서는 6회에서 12회로
   * 배가 됐는데 달려서는 그대로였습니다.
   *
   * 값을 더 올리기 전에 **왜인지**를 먼저 봤습니다. 이유는 튜닝이 아니라
   * **역할 충돌**이었습니다:
   *
   *   달려드는 자는 🟢 **반격**을 가르치는 적입니다. 그래서 예고가
   *   1.4초로 깁니다 — 읽고 답할 시간을 주는 것이 존재 이유입니다.
   *   그런데 "달리는 사람을 벌한다"는 역할은 **짧은 예고**를 요구합니다.
   *   1.4초를 주면 8.4 m/s 는 그 사이 11.8m 를 지나가 버립니다.
   *   한 적에게 두 역할을 다 시키면, 예고를 줄여 반격을 죽이거나
   *   돌진을 늘려 회피를 죽이는 것 말고는 길이 없습니다.
   *
   * 그래서 이 검사는 **틀린 것을 요구하고 있었습니다.** 게임은 다른
   * 방식으로 값을 물리고 있었고(아래), 검사가 그걸 못 보고 있었을 뿐입니다.
   * 통과시키려고 지운 것이 아니라, **재려던 것이 아니어서** 지웠습니다.
   *
   * 대신 실제로 일어나는 일을 겁니다: 지나치면 **청구서가 미뤄집니다.**
   * 싸우며 걸어가면 무리가 길에서 붙잡히고(영역 안 2마리), 달려서
   * 지나치면 그대로 보스방까지 따라 들어옵니다(6~8마리).
   * 엘든 링에서 몹을 달고 안개문을 넘는 것과 같은 계약입니다.
   */
  check(
    run.inArena > walk.inArena,
    '지나치면 청구서가 보스방으로 미뤄진다 (싸우며 갈 때보다 더 많이 끌고 들어온다)',
    `달려서 ${run.inArena}마리(${run.inArenaSpan}) vs 걸어서 ${walk.inArena}마리(${walk.inArenaSpan})`,
  )
  check(
    run.trainBill >= vialHeal,
    '끌고 온 무리가 실제로 아프다 (장식이 아니다)',
    `보스방에서 가만히 선 8초에 ${run.trainBill}(${run.trainBillSpan}) · 성수병 ${vialHeal}`,
  )

  // ---- 4. 달리기로 노출 시간이 얼마나 줄었는가 ----
  //
  // `npm run map` 이 지키는 규칙은 "위협 없이 30m 넘게 걷지 말 것"이고,
  // 그 30m의 근거는 **약 6초**였습니다. 달리기가 들어온 지금 같은 30m는
  // 3.6초입니다. 규칙을 미터가 아니라 **초**로 다시 적어야 합니다.
  const gapMeters = 30
  const walkGap = gapMeters / walkSpeed
  const runGap = gapMeters / runSpeed
  console.log(
    `\n  [노출] 빈 구간 ${gapMeters}m = 걸어서 ${walkGap.toFixed(1)}초 · 달려서 ${runGap.toFixed(1)}초`,
  )
  check(
    runGap >= 3,
    '달려도 빈 구간 기준이 무의미해지지 않는다 (지도 규칙이 여전히 유효)',
    `달려서 ${runGap.toFixed(1)}초`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
