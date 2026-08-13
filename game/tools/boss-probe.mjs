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
      /**
       * 🧾 **연계도 구간별로 셉니다.**
       *
       * 설계는 *"1단계에는 연계가 없고, 2단계가 🔵→🔴 을, 3단계가 🟣→🔴 과
       * 🔵→🟡 을 더한다"* 입니다. `npm run chain` 은 그 연계가 **걸리는지**를
       * 강제로 확인하지만, **실제 싸움에서 몇 번이나 나오는지**는 아무도
       * 안 셌습니다. 한 판에 한 번도 안 나오면 그 페이즈의 정체성은
       * 화면에 없는 것과 같습니다 — 이 저장소가 보물 0개·연계 0회로
       * 이미 두 번 겪은 모양입니다.
       *
       * ⚠️ **여기서 나온 0 을 게임 탓으로 읽으면 안 됩니다.** 이 실험대의
       *    손은 쉬지 않고 때리므로 매 페이즈 보스를 무너뜨리고, 무너지면
       *    예약이 취소됩니다. 실제 존 판에서는 예약 24 · 발동 21(88%)로
       *    멀쩡히 나옵니다. 이 칸은 *"연계가 고장났나"* 가 아니라
       *    **"공격을 안 멈추면 연계가 봉쇄되는가"** 를 재는 칸입니다.
       *    (그 구분을 못 하고 방아쇠 가중치를 올렸다가 되돌렸습니다 —
       *     enemyAI `chainShownPhase` 주석.)
       */
      const armed = [0, 0, 0]
      const fired = [0, 0, 0]
      let lastArmed = st0.chainsArmed ?? 0
      let lastFired = st0.chainsFired ?? 0
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
        if ((st.chainsArmed ?? 0) > lastArmed) {
          armed[i] += (st.chainsArmed ?? 0) - lastArmed
          lastArmed = st.chainsArmed ?? 0
        }
        if ((st.chainsFired ?? 0) > lastFired) {
          fired[i] += (st.chainsFired ?? 0) - lastFired
          lastFired = st.chainsFired ?? 0
        }
        await sleep()
      }
      return { intro: intro[0], trans: trans[0], phase, breaks, fins, armed, fired, killed: done }
    })
    shapes.push(r)
    console.log(
      `     ${run + 1}판 — 인트로 ${r.intro.toFixed(1)} · 전환 ${r.trans.toFixed(1)} · 1단계 ${r.phase[0].toFixed(1)} · 2단계 ${r.phase[1].toFixed(1)} · 3단계 ${r.phase[2].toFixed(1)}초` +
        ` · 무너짐 ${r.breaks.join('/')} · 처형 ${r.fins.join('/')}` +
        ` · 연계 예약 ${r.armed.join('/')} 발동 ${r.fired.join('/')}${r.killed ? '' : ' ⚠️ 못 잡음'}`,
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

  /**
   * ── 🪟 **페이즈마다 보스가 내주는 창을 잰다** ─────────────────────
   *
   * ── 왜 이걸 재게 됐는가 (숫자가 먼저 있었습니다) ──────────────────
   * `npm run pace` 5판×3강화에서 페이즈별 **플레이어 화력**이 이렇게 나왔습니다:
   *
   *     1단계  8.2초 · 31.4/초
   *     2단계  7.7초 · 26.6/초
   *     3단계 26.5초 · **4.5/초**   ← 1/7 로 폭락
   *
   * 3단계가 짧아서 문제였던 예전과 정반대입니다. 지금은 **길어졌는데 그
   * 안에서 아무것도 못 합니다.** 15판 중 13판이 45초 시간초과였습니다.
   *
   * 가설: `cooldownScale` 이 1 → 0.75 → 0.55 로 내려가 3단계의 공격 빈도가
   * 1.8배가 되는데, 그러면 **압박이 아니라 봉쇄**가 됩니다. 참고한 게임들이
   * 전부 피하는 자리입니다 —
   *   · 세키로·엘든 링 — 가장 사나운 페이즈에도 반격 창은 남습니다.
   *     창이 사라진 패턴(예: 엘든 링의 특정 연속기)은 예외 없이 욕을 먹었습니다
   *   · 몬스터 헌터 — 분노하면 빨라지지만 큰 기술의 **후딜은 길어집니다**
   *   · 로스트아크 — 빨라지는 대신 무력화 체크로 **강제 공격 구간**을 엽니다
   * 공통 원리: **속도를 올릴 때 창까지 같이 좁히면 안 됩니다.**
   *
   * ── 무엇을 재는가 ────────────────────────────────────────────────
   * 무기 프로브가 잡몹에게 쓰는 것과 **같은 정의**입니다:
   *   판정(Active)이 끝난 순간 → 다음 예고(windup)가 켜지는 순간.
   * 예고는 보고 대응할 수 있으므로 예고 시작까지가 창입니다.
   *
   * ⚠️ 설정값을 더해서 구하지 않습니다(`recovery + attackCooldown × scale`).
   *    그러면 프로브가 **또 하나의 진실**이 되고, AI가 실제로 언제 다시
   *    예고를 켜는지와 어긋나도 아무도 모릅니다. **보고** 잽니다.
   */
  console.log('\n  🪟 페이즈마다 보스가 내주는 창 — 판정 끝 → 다음 예고\n')
  const windows = await page.evaluate(async () => {
    const G = window.__game
    const out = []
    for (let want = 0; want < 3; want++) {
      /**
       * ⚠️ **판을 새로 엽니다.** 앞 절차를 거친 뒤라 플레이어가 죽어 있을
       *    수 있는데, 보스 조우는 `playerAlive` 가 거짓이면 아예 시작되지
       *    않습니다(enemyAI 보스 조우 블록). 그래서 `wakeEnemy` 를 불러도
       *    다음 프레임에 어그로가 0 으로 되돌아갑니다 — 세 페이즈 모두
       *    관측 0회로 나온 진짜 이유가 이것이었습니다.
       */
      G.reset()
      await window.__t.runFor(0.6)
      G.clearEnemies()
      await window.__t.runFor(0.3)
      const p = G.state().player
      const b = G.spawnBoss(p.x + 4, p.z)
      /**
       * ⚠️ **깨워야 합니다.** 처음엔 이 줄이 없어서 세 페이즈 모두 관측
       *    0회였습니다 — 진단값을 같이 찍어 두지 않았다면 *"보스가 창을
       *    안 준다"* 는 **정반대 결론**을 낼 뻔했습니다(어그로 0 · 7m 그대로).
       *    잡몹 창을 재는 무기 프로브에는 있던 줄입니다.
       */
      G.wakeEnemy(b)
      /**
       * 🧪 무적을 켭니다 — **재는 동안만.** 근거는 combat.ts 설계 노트:
       * 한 번 죽으면 조우가 끝나(귀환) 그 뒤 40초가 통째로 빈 관측이 됩니다.
       * 실제로 2단계에서 딱 한 프레임 죽어서 *"2단계는 창을 안 준다"* 는
       * 정반대 결론을 낼 뻔했습니다.
       */
      G.setPlayerInvulnerable(true)
      await window.__t.runFor(0.4)
      const max = G.enemyInfo(b).max
      /**
       * 원하는 페이즈의 **체력 구간 한가운데**에 세웁니다.
       *
       * ⚠️ 처음엔 페이즈를 넘긴 뒤 `setHp(b, max * 1000)` 으로 체력을 크게
       *    채워 뒀습니다. 그러자 비율이 1000 이 되어 **페이즈가 1단계로
       *    되돌아갔고**, "3단계 안전창 1.85초"라고 찍힌 값이 사실은 1단계
       *    값이었습니다. 페이즈는 체력 비율에서 **매 프레임 다시 계산**되지
       *    한 번 오르면 걸리는 것이 아닙니다(bossPhases `phaseForHp`).
       *    죽지 않게 하려다 **재려던 것을 지웠습니다.**
       *
       *    비율은 게임의 경계에서 끌어옵니다 — 여기 숫자를 적지 않습니다.
       */
      const bounds = G.bossPhaseBounds()
      const hi = want === 0 ? 1 : bounds[want]
      const lo = want + 1 < bounds.length ? bounds[want + 1] : 0
      const target = max * ((hi + lo) / 2)
      G.setHp(b, target)
      await window.__t.until(
        () => G.enemyInfo(b)?.phase === want && G.enemyInfo(b)?.transitionT === 0,
        8,
      )
      let wasActive = false
      let endedAt = -1
      const gaps = []
      /** 창이 0회로 나올 때 **왜인지** 말해 주는 값들 — 없으면 눈이 먼 채로 고칩니다. */
      const diag = { frames: 0, attacking: 0, winding: 0, aggro: 0, minDist: 99, hpNow: 0, dead: 0 }
      const t0 = G.state().simElapsed
      while (gaps.length < 6 && G.state().simElapsed - t0 < 40) {
        const i = G.enemyInfo(b)
        if (!i) break
        diag.frames++
        if (i.attacking) diag.attacking++
        if (i.winding) diag.winding++
        if (i.aggro) diag.aggro++
        const pl = G.state().player
        const d = Math.hypot(i.x - pl.x, i.z - pl.z)
        if (d < diag.minDist) diag.minDist = d
        // AttackPhase.Active === 1 (core/components.ts)
        const active = i.attacking && i.attackPhase === 1
        if (wasActive && !active) endedAt = G.state().simElapsed
        if (endedAt > 0 && i.winding) {
          gaps.push(Number((G.state().simElapsed - endedAt).toFixed(3)))
          endedAt = -1
        }
        wasActive = active
        // 체력이 구간 밖으로 새면 페이즈가 바뀝니다 — 매 프레임 제자리에 둡니다.
        if (Math.abs((G.enemyInfo(b)?.hp ?? target) - target) > 1) G.setHp(b, target)
        /**
         * ⚠️ **플레이어를 매 프레임 채웁니다.** 처음엔 `hp < 60` 일 때만
         *    채웠는데, 2단계(속박)에서 한 번에 그보다 크게 맞아 **죽었고**,
         *    죽으면 보스 조우가 통째로 멈춥니다(`playerAlive` 거짓 → 어그로 0).
         *    그래서 2단계만 관측 0회였습니다 — 보스가 창을 안 준 것이
         *    아니라 **잴 사람이 없어진 것**입니다.
         */
        if (pl.hp <= 0) diag.dead++
        G.setHp(G.playerEntity(), 100000)
        await new Promise((r) => setTimeout(r, 8))
      }
      const last = G.enemyInfo(b)
      const phaseNow = last?.phase ?? -1
      diag.hpNow = Math.round(last?.hp ?? -1)
      diag.minDist = Number(diag.minDist.toFixed(2))
      G.setPlayerInvulnerable(false)
      G.clearEnemies()
      out.push({ want, phaseNow, gaps, diag })
    }
    return out
  })

  /**
   * ⚠️ **최솟값을 씁니다** — 무기 프로브가 잡몹 창에서 배운 그대로입니다.
   *    플레이어는 이번이 긴 쪽인지 짧은 쪽인지 **미리 알 수 없으므로**,
   *    안전하게 넣을 수 있는 창은 언제나 가장 짧은 쪽입니다.
   */
  const safeOf = (g) => (g.length ? Math.min(...g) : -1)
  for (const w of windows) {
    console.log(
      `    ${w.want + 1}단계  안전창 ${safeOf(w.gaps) < 0 ? '측정불가' : `**${safeOf(w.gaps).toFixed(2)}초**`}` +
        `  (관측 ${w.gaps.length}회: ${w.gaps.join(', ') || '없음'})` +
        (w.gaps.length === 0
          ? `\n            ↳ 프레임 ${w.diag.frames} · 공격중 ${w.diag.attacking} · 예고중 ${w.diag.winding} · ` +
            `어그로 ${w.diag.aggro} · 최소거리 ${w.diag.minDist}m · 체력 ${w.diag.hpNow} · 플레이어 사망 ${w.diag.dead}프레임`
          : '') +
        (w.phaseNow !== w.want ? `  ⚠️ 재는 동안 ${w.phaseNow + 1}단계로 넘어감` : ''),
    )
  }
  check(
    windows.every((w) => w.phaseNow === w.want && w.gaps.length >= 3),
    '세 페이즈 모두에서 창을 실제로 관측했다 (측정이 성립했다)',
    windows.map((w) => `${w.want + 1}단계 ${w.gaps.length}회`).join(' · '),
  )
  /**
   * **창은 무엇보다 길어야 하는가** — 여기에 숫자를 적으면 안 됩니다.
   *
   * ⚠️ 처음엔 **가장 빠른** 무기의 1타(0.07초)를 기준으로 삼았습니다.
   *    그 선은 아무것도 못 막습니다 — 창이 0.1초여도 통과합니다.
   *    기준은 *"누구든 한 대는 넣을 수 있는가"* 여야 하므로 **가장 느린**
   *    무기의 1타(대검 0.27초)를 씁니다. 그보다 짧은 창이 있으면
   *    그 페이즈에서는 **대검을 든 사람에게 반격이라는 선택지가 없습니다.**
   *    무기 선택이 페이즈 때문에 막히면 무기 셋을 만든 뜻이 없습니다.
   *
   * 참고한 게임들이 지키는 선이기도 합니다 — 몬스터 헌터는 분노해도 큰
   * 기술의 후딜을 남기고, 세키로·엘든 링에서 창이 사라진 패턴은 예외 없이
   * 문제로 지목됐습니다. **속도를 올릴 때 창까지 좁히면 안 됩니다.**
   */
  const slowestFirst = await page.evaluate(() =>
    Math.max(...window.__game.weaponTable().map((w) => w.firstHitAt)),
  )
  const fastest = slowestFirst
  const measured = windows.map((w) => safeOf(w.gaps)).filter((v) => v > 0)
  /**
   * ⚠️ `Math.min()` 은 빈 배열에 **Infinity** 를 돌려줍니다. 그대로 두었더니
   *    창을 한 번도 못 쟀는데 *"가장 좁은 창 Infinity초"* 로 **통과**했습니다.
   *    지난 라운드와 똑같은 자리입니다 — **아무것도 못 잰 단계는 실패입니다.**
   */
  const tightest = measured.length === 3 ? Math.min(...measured) : -1
  check(
    tightest > fastest,
    '**어느 페이즈에서도 세 무기 다 한 대는 넣을 수 있다** (속도를 올려도 창은 남는다)',
    tightest < 0
      ? `세 페이즈 중 ${3 - measured.length}곳에서 창을 못 쟀습니다 — **검사가 성립하지 않았습니다**`
      : `가장 좁은 창 ${tightest.toFixed(2)}초 vs 가장 느린 1타 ${fastest.toFixed(2)}초(대검) — 여유 ${(tightest - fastest).toFixed(2)}초`,
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
