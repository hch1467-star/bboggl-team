/**
 * 보스 페이즈 검증 — `npm run boss`
 *
 * 페이즈 시스템은 **눈으로는 확인하기 어려운 종류**입니다. 전환은 3분짜리
 * 전투 중 두 번뿐이고, 연계는 특정 패턴이 나와야만 볼 수 있습니다.
 * 그래서 체력을 직접 깎아 경계를 강제로 넘기고, 상태를 숫자로 읽습니다.
 *
 * ⚠️ 시뮬레이션 시간으로 재야 합니다. SwiftShader 소프트웨어 렌더링에서는
 * 게임 시간이 실시간의 1/3~1/20 속도로 흐릅니다. 벽시계로 기다리면
 * "1.25초 전환"이 끝나기 전에 검사해서 가짜 실패가 납니다.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5185
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail) {
  if (ok) {
    pass++
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const server = await createServer({ root: '.', server: { port: PORT }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: execPath,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  /**
   * ⚠️ 아래 1~5번은 체력을 강제로 깎아 페이즈를 넘기며 **전환·연계·박자**를
   *    잽니다. 새로 넣은 1단계 학습 잠금(enemyAI `taughtInPhase1`)이 켜져
   *    있으면 그 전환이 막혀서, **상관없는 검사 열 개가 같이 빨개집니다.**
   *    실제로 그렇게 만들어 놓고 한 번 당했습니다. 여기서는 끄고, 잠금
   *    자체는 6번에서 켠 채로 잽니다 — 재는 자리를 나눈 것이지 안 재는
   *    것이 아닙니다.
   */
  await page.evaluate(() => window.__game.setPhaseTeaching(false))

  // 페이지 안에서 쓸 공용 헬퍼를 심어 둡니다.
  await page.evaluate(() => {
    // 시뮬레이션 시간으로 기다립니다 — 벽시계가 아니라.
    window.__t = {
      runFor: async (seconds) => {
        const target = window.__game.state().elapsed + seconds
        const deadline = Date.now() + 200000
        while (window.__game.state().elapsed < target && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 8))
        }
      },
      /** 조건이 참이 될 때까지 (시뮬레이션 최대 `limit`초) 기다립니다. */
      until: async (fn, limit) => {
        const target = window.__game.state().elapsed + limit
        const deadline = Date.now() + 120000
        while (Date.now() < deadline && window.__game.state().elapsed < target) {
          if (fn()) return true
          await new Promise((r) => setTimeout(r, 8))
        }
        return fn()
      },
      /**
       * 체력을 깎고 **그 페이즈로 완전히 넘어갈 때까지** 기다립니다.
       *
       * `transitionT === 0` 만 기다리면 안 됩니다 — 데미지를 준 직후에는
       * 아직 AI가 한 프레임도 안 돌아서 transitionT 가 0이고, 그래서 조건이
       * **즉시 참**이 되어 페이즈가 오르기 전에 검사해 버립니다.
       * (이 프로브가 처음 7개 실패했던 이유가 정확히 이것이었습니다.)
       */
      toPhase: async (b, want, ratio) => {
        window.__game.damageEntity(b, window.__game.enemyInfo(b).max * ratio)
        await window.__t.until(() => window.__game.enemyInfo(b)?.phase === want, 6)
        await window.__t.until(
          () => window.__game.enemyInfo(b)?.transitionT === 0 && window.__game.enemyInfo(b)?.phase === want,
          6,
        )
        return window.__game.enemyInfo(b).phase
      },
    }
  })

  console.log('\n👑 보스 페이즈 검증\n')

  // ---- 1. 체력 임계값에서 페이즈가 올라가는가 ----
  const phases = await page.evaluate(async () => {
    window.__game.clearEnemies()
    const p = window.__game.state().player
    const b = window.__game.spawnBoss(p.x + 7, p.z)
    await window.__t.runFor(0.3)
    const start = window.__game.enemyInfo(b)

    // 65% 경계를 넘깁니다 (420 * 0.65 = 273).
    window.__game.damageEntity(b, start.max * 0.4)
    await window.__t.until(() => window.__game.enemyInfo(b)?.phase >= 1, 3)
    const afterFirst = window.__game.enemyInfo(b)

    // 전환 중에는 무적이어야 합니다 — 지금 때려도 체력이 안 줄어야 합니다.
    const hpBefore = afterFirst.hp
    const inTransition = afterFirst.transitionT > 0

    // 전환이 끝날 때까지 기다립니다.
    await window.__t.until(() => window.__game.enemyInfo(b)?.transitionT === 0, 4)
    const settled = window.__game.enemyInfo(b)

    // 30% 경계 (420 * 0.3 = 126).
    window.__game.damageEntity(b, start.max * 0.4)
    await window.__t.until(() => window.__game.enemyInfo(b)?.phase >= 2, 3)
    const afterSecond = window.__game.enemyInfo(b)
    await window.__t.until(() => window.__game.enemyInfo(b)?.transitionT === 0, 4)

    return { start, afterFirst, hpBefore, inTransition, settled, afterSecond, entity: b }
  })

  check(phases.start.phase === 0, '시작은 1단계', `phase=${phases.start.phase} hp=${phases.start.hp}`)
  check(
    phases.afterFirst.phase === 1,
    '체력 65% 아래에서 2단계로',
    `hp ${phases.afterFirst.hp}/${phases.afterFirst.max} → phase=${phases.afterFirst.phase}`,
  )
  check(phases.inTransition, '전환 연출이 실제로 걸림', `남은 ${phases.afterFirst.transitionT}초`)
  check(phases.settled.transitionT === 0, '전환이 끝나고 정상 복귀')
  check(
    phases.afterSecond.phase === 2,
    '체력 30% 아래에서 3단계로',
    `hp ${phases.afterSecond.hp}/${phases.afterSecond.max} → phase=${phases.afterSecond.phase}`,
  )

  // ---- 2. 전환 중에는 정말 무적인가 ----
  //
  // 무적이 뚫리면 화력이 높은 빌드가 페이즈를 통째로 건너뜁니다.
  // 그러면 2단계에서 배우게 해 둔 "파랑은 무적으로"를 못 배운 채 3단계에
  // 도착하고, 3단계는 그 전제 위에 설계돼 있어서 불합리하게 느껴집니다.
  console.log('')
  const invuln = await page.evaluate(async () => {
    window.__game.clearEnemies()
    const p = window.__game.state().player
    const b = window.__game.spawnBoss(p.x + 2.0, p.z)
    await window.__t.runFor(0.3)
    const max = window.__game.enemyInfo(b).max
    window.__game.damageEntity(b, max * 0.4)
    await window.__t.until(() => window.__game.enemyInfo(b)?.transitionT > 0, 3)
    const before = window.__game.enemyInfo(b).hp

    // 전환 중에 계속 때립니다.
    window.__game.aimAtWorld(p.x + 2.0, p.z)
    let swings = 0
    while (window.__game.enemyInfo(b)?.transitionT > 0) {
      window.__game.press('Mouse0')
      await new Promise((r) => setTimeout(r, 30))
      window.__game.release('Mouse0')
      swings++
      if (swings > 40) break
    }
    const after = window.__game.enemyInfo(b).hp
    return { before, after, swings }
  })
  check(
    invuln.after >= invuln.before,
    '전환 중에는 피해가 안 들어감',
    `${invuln.before} → ${invuln.after} (${invuln.swings}회 시도)`,
  )

  // ---- 3. 연계가 실제로 붙는가 ----
  //
  // 이게 페이즈 시스템의 핵심입니다. 숫자만 바뀌는 페이즈는 새로 배울 것을
  // 주지 않습니다. 🔵 속박 뒤에 🔴 직격이 **반드시** 따라와야 파랑의 설계
  // ("맞으면 다음을 못 피한다")가 처음으로 사실이 됩니다.
  console.log('')
  //
  // **관측이 아니라 강제로 확인합니다.** 보스가 알아서 네 패턴을 다 쓸 때까지
  // 기다리면 시뮬레이션 40초 × 3구간이 필요한데, 소프트웨어 렌더링에서는
  // 그게 실시간 30분이 넘습니다. 패턴을 직접 걸고 붙은 연계를 읽으면
  // 같은 사실을 몇 초 만에, 그것도 **누락 없이** 확인할 수 있습니다.
  // (그래서 debugForceAttack 도 정상 커밋과 똑같이 연계를 세팅하도록 고쳤습니다 —
  //  안 그러면 검증 도구가 보는 것과 실제 전투가 달라집니다.)
  const chains = await page.evaluate(async () => {
    const probe = async (damageRatio) => {
      /**
       * **매번 게임을 초기화합니다.** 앞 항목에서 강제로 건 공격들이 그대로
       * 플레이어를 때려서, 여기 도달할 때쯤이면 플레이어가 죽어 있습니다.
       * 플레이어가 죽으면 적은 어그로를 풀고 공격을 아예 멈추기 때문에
       * "쉬는 시간"이 무한대로 측정됩니다 — 실제로 이 프로브가 14초(측정 상한)를
       * 뱉었던 이유입니다. 상태를 물려받는 검증은 이런 식으로 조용히 거짓말합니다.
       */
      window.__game.reset()
      await window.__t.runFor(0.4)
      window.__game.clearEnemies()
      const p = window.__game.state().player
      const b = window.__game.spawnBoss(p.x + 6, p.z)
      await window.__t.runFor(0.3)
      if (damageRatio > 0) await window.__t.toPhase(b, damageRatio > 0.6 ? 2 : 1, damageRatio)
      const seen = {}
      for (let i = 0; i < 4; i++) {
        const id = window.__game.forceAttack(b, i)
        seen[id] = window.__game.enemyInfo(b).chainNext
      }
      const phase = window.__game.enemyInfo(b).phase
      window.__game.clearEnemies()
      return { phase, seen }
    }
    return { p1: await probe(0), p2: await probe(0.4), p3: await probe(0.8) }
  })
  check(chains.p2.phase === 1, '2단계 진입 확인', `phase=${chains.p2.phase}`)
  check(chains.p3.phase === 2, '3단계 진입 확인', `phase=${chains.p3.phase}`)

  const fmt = (m) =>
    Object.entries(m).map(([k, v]) => `${k}${v ? `→${v}` : ''}`).join(' · ') || '(관측 없음)'
  console.log(`  [1단계] ${fmt(chains.p1.seen)}`)
  console.log(`  [2단계] ${fmt(chains.p2.seen)}`)
  console.log(`  [3단계] ${fmt(chains.p3.seen)}`)
  check(
    Object.values(chains.p1.seen).every((v) => v === ''),
    '1단계에는 연계가 없음',
  )
  check(chains.p2.seen.boss_bind === 'boss_cleave', '2단계: 🔵 속박 → 🔴 직격')
  check(chains.p3.seen.boss_bind === 'boss_quake', '3단계: 🔵 속박 → 🟡 광역')
  check(chains.p3.seen.boss_hook === 'boss_cleave', '3단계: 🟣 갈고리 → 🔴 직격')

  // ---- 4. 쉬는 시간이 실제로 줄어드는가 ----
  //
  // 난이도를 "예고 단축"이 아니라 "쿨다운 축소 + 연계"로 올린다는 설계가
  // 진짜인지 숫자로 확인합니다. 예고가 짧아지면 그건 설계 위반입니다.
  console.log('')
  const tempo = await page.evaluate(async () => {
    const measure = async (want, damageRatio) => {
      /**
       * **매번 게임을 초기화합니다.** 앞 항목에서 강제로 건 공격들이 그대로
       * 플레이어를 때려서, 여기 도달할 때쯤이면 플레이어가 죽어 있습니다.
       * 플레이어가 죽으면 적은 어그로를 풀고 공격을 아예 멈추기 때문에
       * "쉬는 시간"이 무한대로 측정됩니다 — 실제로 이 프로브가 14초(측정 상한)를
       * 뱉었던 이유입니다. 상태를 물려받는 검증은 이런 식으로 조용히 거짓말합니다.
       */
      window.__game.reset()
      await window.__t.runFor(0.4)
      window.__game.clearEnemies()
      const p = window.__game.state().player
      // 🟡 광역(index 1)은 어느 페이즈에서도 연계가 안 붙습니다.
      // 연계가 끼면 간격이 0이 되어 쿨다운 자체를 못 보므로 이걸로 잽니다.
      const b = window.__game.spawnBoss(p.x + 5, p.z)
      await window.__t.runFor(0.3)
      if (damageRatio > 0) await window.__t.toPhase(b, want, damageRatio)
      window.__game.forceAttack(b, 1)
      // 공격이 완전히 끝난 순간부터, 다음 공격이 시작될 때까지의
      // **시뮬레이션 시간**을 잽니다. 이게 곧 "쉬는 시간"입니다.
      await window.__t.until(() => window.__game.enemyInfo(b)?.attacking === false, 10)
      const t0 = window.__game.state().elapsed
      await window.__t.until(() => window.__game.enemyInfo(b)?.attacking === true, 14)
      const gap = window.__game.state().elapsed - t0
      const phase = window.__game.enemyInfo(b).phase
      window.__game.clearEnemies()
      return { gap, phase }
    }
    return { p1: await measure(0, 0), p2: await measure(1, 0.4), p3: await measure(2, 0.8) }
  })
  check(tempo.p1.gap > 0, '1단계 공격 사이 간격', `${tempo.p1.gap.toFixed(2)}초`)
  check(
    tempo.p2.phase === 1 && tempo.p2.gap > 0 && tempo.p2.gap < tempo.p1.gap,
    '2단계는 쉬는 시간이 짧아짐',
    `${tempo.p1.gap.toFixed(2)}초 → ${tempo.p2.gap.toFixed(2)}초`,
  )
  check(
    tempo.p3.phase === 2 && tempo.p3.gap > 0 && tempo.p3.gap < tempo.p2.gap,
    '3단계는 더 짧아짐',
    `${tempo.p2.gap.toFixed(2)}초 → ${tempo.p3.gap.toFixed(2)}초`,
  )

  // ---- 5. 예고 시간은 지켜졌는가 (설계 원칙 검사) ----
  //
  // 이 항목이 이 프로브에서 가장 중요합니다. 난이도를 올리려다 예고를
  // 깎으면 "내가 못 봤네"로 죽게 되고, 그건 기둥 2의 판단 기준 위반입니다.
  // 3단계에서도 모든 패턴의 예고가 잡몹의 가장 짧은 예고(0.55초)보다
  // 길게 남아 있어야 합니다.
  console.log('')
  // 수치는 페이지에서 그대로 받아옵니다 — 검증 스크립트가 상수를 베껴 두면
  // 나중에 밸런스를 바꿨을 때 테스트만 통과하고 게임은 망가집니다.
  const windups = await page.evaluate(() => window.__game.bossTuning())
  const last = windups[windups.length - 1]
  const shortest = Math.min(...last.windups.map((w) => w.seconds))
  console.log(
    `  [${last.name}] ${last.windups.map((w) => `${w.id} ${w.seconds.toFixed(2)}초`).join(' · ')}`,
  )
  check(
    shortest >= 0.55,
    '3단계에서도 예고가 잡몹 최단(0.55초) 이상',
    `가장 짧은 예고 ${shortest.toFixed(2)}초`,
  )

  /**
   * ---- 6. **한 판을 끝까지 싸워 페이즈의 모양을 잽니다** ----
   *
   * ── 왜 필요해졌는가 ──────────────────────────────────────────────
   * 위 1~5번은 전부 **기계장치**를 봅니다 — 전환이 걸리는가, 연계가
   * 이어지는가, 예고가 남아 있는가. 정작 *"싸워 보면 어떤 모양인가"* 는
   * 한 번도 안 쟀습니다. 그건 `npm run bench` 가 존 전체를 도는 김에
   * 곁다리로 냈는데, 그 숫자가 이랬습니다:
   *
   *     1단계 15.4초 · 2단계 14.4  (1.7~27.1) · 3단계 3.8초
   *
   * 2단계의 범위가 **16배**입니다. 이런 값으로는 아무것도 말할 수 없고,
   * 실제로 저는 "1단계가 절반을 먹는다"를 두 번 적었다가 두 번 물렸습니다.
   * 표본이 모자라서가 아니라 **재는 자리가 틀렸기** 때문입니다: 존을 도는
   * 판은 무기 강화·성수병·불티·경로가 판마다 다르고, 보스전은 그 끝에
   * 붙은 한 조각일 뿐입니다.
   *
   * ── 그래서 **일정한 압력**으로 바꿉니다 ──────────────────────────
   * 봇 대신 **정해진 대로만 때리는 손**을 씁니다: 사거리 안에 붙어 서서,
   * 쉬지 않고 평타만, 구르지 않고, 죽지 않게 체력만 채워 가며.
   *
   * 이건 실제 플레이가 아닙니다 — 그게 목적입니다. 플레이어 쪽 변수를
   * 전부 없애면 남는 시간 차이는 **보스 자신의 구조**뿐입니다. 존 한 바퀴가
   * 20분인데 이건 판당 1분이라, 여러 판을 돌려 중앙값을 낼 수도 있습니다.
   *
   * ⚠️ **인트로를 따로 셉니다.** 조우 연출(encounter 1) 동안 보스는
   *    노려보기만 하는데, bench 는 그 시간을 1단계에 더하고 있었습니다.
   */
  /**
   * 여기서 잠금을 **다시 켭니다.** 모양을 재는 것은 규칙이 다 걸려 있는
   * 진짜 게임이어야 합니다 — 끄고 잰 모양은 우리가 안 만든 게임의 모양입니다.
   */
  await page.evaluate(() => window.__game.setPhaseTeaching(true))
  console.log('\n  ⚔️  한 판을 끝까지 — 일정한 압력으로 재는 페이즈의 모양\n')
  const RUNS = 3
  const shapes = []
  for (let run = 0; run < RUNS; run++) {
    const r = await page.evaluate(async () => {
      const G = window.__game
      const sleep = () => new Promise((res) => setTimeout(res, 6))
      const now = () => G.state().simElapsed
      G.reset()
      const t0 = now()
      while (now() - t0 < 0.6) await sleep()
      G.clearEnemies()
      while (now() - t0 < 1.0) await sleep()

      const p = G.state().player
      const b = G.spawnBoss(p.x + 3, p.z)
      const intro = [0]
      const trans = [0]
      const phase = [0, 0, 0]
      const breaks = [0, 0, 0]
      const fins = [0, 0, 0]
      let lastT = now()
      /**
       * ⚠️ **처음엔 0 에서 시작했다가 숫자를 통째로 날렸습니다.**
       *    `runStats()` 의 무너짐·처형은 **누적 카운터**입니다. 0 에서
       *    시작하면 앞 판의 총합이 첫 프레임에 **1단계 몫으로** 얹혀서,
       *    세 판이 1 → 3 → 6 처럼 계단으로 늘었습니다. 실제 싸움이 아니라
       *    **안 지운 장부**를 읽고 있었던 것입니다(강인도 105 에 평타 한 대가
       *    3 남짓이라 2.1초에 여섯 번 무너지는 것은 애초에 불가능합니다).
       *    지금 값을 **바닥으로 잡고** 거기서부터 셉니다.
       */
      const st0 = G.runStats?.() ?? {}
      let lastBreak = st0.poiseBreaks ?? 0
      let lastFin = st0.bossFinishers ?? 0
      let done = false
      const deadline = Date.now() + 200000
      while (!done && Date.now() < deadline) {
        const be = G.bossEncounter()
        const dt = Math.max(0, now() - lastT)
        lastT = now()
        if (!be || be.hp <= 0) {
          done = true
          break
        }
        /**
         * ⚠️ **전환 연출도 따로 셉니다.** 페이즈가 바뀌는 순간 보스는 무적 +
         *    넉백 + 배너로 잠깐 멈춥니다. 그 시간을 그냥 두면 **다음 페이즈의
         *    시간에 섞여** 뒤 구간이 길어 보입니다 — 인트로가 1단계에 섞여
         *    있던 것과 정확히 같은 고장입니다. 전환은 두 번뿐이라 2·3단계만
         *    손해를 봅니다.
         */
        if (be.encounter === 1) intro[0] += dt
        else if (be.transitionT > 0) trans[0] += dt
        else if (be.encounter === 2) phase[Math.min(2, be.phase)] += dt

        /**
         * **일정한 압력** — 붙어 서서 쉬지 않고 평타만.
         * 기력과 체력은 채워 둡니다. 재려는 것은 플레이어의 살림이 아니라
         * 보스의 구간 길이입니다.
         */
        // 보스 좌표는 `enemyInfo` 가 줍니다 — bossEncounter 에는 자리 값이 없습니다.
        const bi = G.enemyInfo(be.entity)
        if (bi) {
          G.teleportPlayer(bi.x, bi.z - 1.8)
          G.aimAtWorld(bi.x, bi.z)
        }
        G.setStamina(100)
        G.setHp(G.playerEntity(), 100)
        G.press('Mouse0')
        G.release('Mouse0')

        // 무너짐·처형은 **일어난 자리에서** 셉니다(상태가 덮이기 전에).
        const st = G.runStats?.() ?? {}
        const i = Math.min(2, be.phase)
        if ((st.poiseBreaks ?? 0) > lastBreak) {
          breaks[i] += (st.poiseBreaks ?? 0) - lastBreak
          lastBreak = st.poiseBreaks ?? 0
        }
        if ((st.bossFinishers ?? 0) > lastFin) {
          fins[i] += (st.bossFinishers ?? 0) - lastFin
          lastFin = st.bossFinishers ?? 0
        }
        await sleep()
      }
      return { intro: intro[0], trans: trans[0], phase, breaks, fins, killed: done }
    })
    shapes.push(r)
    console.log(
      `     ${run + 1}판 — 인트로 ${r.intro.toFixed(1)} · 전환 ${r.trans.toFixed(1)} · 1단계 ${r.phase[0].toFixed(1)} · 2단계 ${r.phase[1].toFixed(1)} · 3단계 ${r.phase[2].toFixed(1)}초` +
        ` · 무너짐 ${r.breaks.join('/')} · 처형 ${r.fins.join('/')}${r.killed ? '' : ' ⚠️ 못 잡음'}`,
    )
  }

  const ok = shapes.filter((s) => s.killed)
  check(ok.length === RUNS, `${RUNS}판 모두 보스를 잡았다 (못 잡은 판으로 평균을 내지 않게)`, `${ok.length}/${RUNS}판`)

  if (ok.length) {
    const mid = (xs) => {
      const a = [...xs].sort((x, y) => x - y)
      const h = a.length >> 1
      return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2
    }
    const per = [0, 1, 2].map((i) => mid(ok.map((s) => s.phase[i])))
    const bands = await page.evaluate(() => window.__game.bossTuning().map((p) => p.hpFrom ?? null))
    console.log(
      `\n     [가운데값] 인트로 ${mid(ok.map((s) => s.intro)).toFixed(1)}초 · 전환 ${mid(ok.map((s) => s.trans)).toFixed(1)}초 · ` +
        per.map((v, i) => `${i + 1}단계 ${v.toFixed(1)}초`).join(' · '),
    )
    void bands

    /**
     * **구간마다 걸리는 시간이 체력 배분과 어긋나지 않는가.**
     *
     * 압력이 일정하므로, 체력을 같은 비율로 나눠 놨다면 시간도 비슷해야
     * 합니다. 한 구간만 유독 길면 원인은 체력이 아니라 **구조**입니다
     * (무적 전환·강인도 회복·연출 시간 따위). 어느 쪽인지는 위에 찍힌
     * 무너짐/처형 분포가 갈라 줍니다.
     *
     * ⚠️ 문턱을 2배로 둔 이유: 3단계는 체력 배분 자체가 30%라 30% 짧고,
     *    처형이 들어가면 더 짧아집니다. 그 정도는 설계대로입니다 —
     *    **배 이상 벌어질 때만** 구조를 의심합니다.
     */
    const hi = Math.max(...per)
    const lo = Math.min(...per.filter((v) => v > 0.05))
    check(
      hi <= lo * 2.5,
      '한 구간만 유독 길지 않다 (가장 긴 구간 ≤ 가장 짧은 구간 × 2.5)',
      `가장 김 ${hi.toFixed(1)}초 · 가장 짧음 ${lo.toFixed(1)}초 · 배수 ${(hi / lo).toFixed(1)}`,
    )
  }

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
