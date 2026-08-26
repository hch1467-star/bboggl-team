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
    Object.values(chains.p1.seen).length > 0 &&
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
      /**
       * ── 🎬 **보스가 시작한 예고 / 끝낸 휘두름** ──────────────────
       *
       * `balance.ts` 의 `breakResistStep` 주석이 이 병을 이미 한 번
       * 진단해 놓았습니다:
       *
       *     보스전 15.4초 · 예고 여섯 번 · **판정까지 간 것은 한 번**
       *     붕괴 3회 · 처형 3회 — "15초에 세 번이면 기본기입니다"
       *
       * 처방(무너질 때마다 저항 +45%)을 넣은 뒤 벤치는 이렇게 말합니다:
       *
       *     보스전 22초 · **예고 8회 → 판정 3회(끊김 63%)** · 붕괴 3회
       *
       * 나아졌지만 **같은 병이 남아 있습니다.** 그런데 이 숫자를 지금까지
       * 아무 검사도 안 봤습니다 — 주석이 약속을 하고, 벤치가 찍기만 하고,
       * 판정은 어디에도 없었습니다. 「주석의 약속은 지켜지지 않는다」.
       *
       * ⚠️ **여기서는 아직 판정하지 않고 기록만 합니다.** 이 침대는
       *    붙어 서서 기력 무한으로 평타를 쉬지 않고 넣는 **최악의 압력**
       *    이라, 사람이 낼 수 없는 조건입니다. 문턱을 눈으로 정하지 않고
       *    **재고 나서** 답니다 — 「아무도 못 넘는 문턱은 눈금이 아니라
       *    벽이다」.
       */
      const swing0 = Object.values(G.bossSwingLog()).reduce(
        (a, v) => ({ com: a.com + (v.commits ?? 0), sw: a.sw + v.swings }),
        { com: 0, sw: 0 },
      )
      /**
       * ── 🧾 **잃어버린 예고의 «영수증»** ──────────────────────────
       *
       * 첫 판이 이렇게 나왔습니다:
       *
       *     예고 6 → 판정 2 (끊김 67%) · **무너짐 1/1/0** (합 2회)
       *
       * 끊긴 것은 4번인데 무너진 것은 2번입니다. **둘이 안 맞습니다.**
       * 붕괴로 설명되는 것은 절반뿐이고, 나머지 절반은 무엇이 가져갔는지
       * 아무도 모릅니다. 이대로 문턱을 달면 «설명 못 하는 절반» 위에
       * 판정을 세우게 됩니다 — 「못 잰 것은 통과가 아니다」.
       *
       * `windupBreaks` 는 **예고 도중에 일어난 붕괴만** 셉니다(main.ts 가
       * `breakEvents.duringWindup` 으로 갈라 둡니다). 그러니 이게 곧
       * *"붕괴가 죽인 예고의 수"* 이고, 장부가 맞아야 합니다:
       *
       *     잃은 예고 = 예고 − 판정   vs   예고 중 붕괴
       *
       *   · 같다      → 원인은 전부 강인도입니다. 처방이 하나로 정해집니다.
       *   · 잃은 쪽이 크다 → **다른 것이 예고를 지웁니다**(페이즈 전환·
       *     자기 취소…) 또는 제 계수기가 겹쳐 셉니다. 어느 쪽이든
       *     **먼저 밝힐 것**이지 문턱을 달 자리가 아닙니다.
       *
       * 잔액을 안 찍으면 이런 어긋남은 조용히 지나갑니다 — 이 저장소가
       * 연계 장부(`장부 잔액 -2회`)에서 이미 배운 자리입니다.
       */
      const wb0 = G.runStats?.().windupBreaks ?? 0
      /**
       * 🧊 **전환이 지운 예고** — 장부의 셋째 칸.
       *
       * `enemyAI.ts` 가 페이즈를 올릴 때 `Actor.state[e] = ActorState.Idle`
       * 로 **자세를 통째로 끊습니다.** 그 주석의 뜻은 *"붙어서 딜을 넣던
       * 자세를 끊는다"* 이고 그건 플레이어 쪽 이야기인데, 부수 효과로
       * **보스가 걸어 둔 예고도 같이 사라집니다.** 플레이어가 보는 것은
       * 「🔴 예고가 떴다 → 배너가 떴다 → 공격이 그냥 없어졌다」입니다.
       *
       * 붕괴로 설명되는 것은 잃은 예고의 절반뿐이었습니다(예고중붕괴
       * 2·1·1 vs 잃은 예고 4·4·3). 전환은 판마다 2번(전환 2.5초 =
       * 1.25 × 2)이라 남는 2~3 과 자릿수가 맞습니다. **자릿수가 맞는
       * 것과 같은 사건인 것은 다르므로**(greenOutcome 주석) 세어서
       * 잔액을 0으로 만들어 확인합니다.
       */
      let transitions = 0
      let wasTrans = false
      /**
       * ── ⚖️ **전환 «횟수»가 아니라 «전환이 실제로 지운 예고»** ────────
       *
       * 판마다 전환이 2번이니 2개를 지운다 — 로 셌더니 깨끗한 기계에서
       * 3판째가 이렇게 나왔습니다:
       *
       *     잃은예고 3 = 붕괴 2 + 전환 2 + **설명못함 −1** ⚠️
       *
       * 음수입니다. 잃은 것보다 **설명이 더 많습니다** — 예고 하나를
       * 둘이 각자 제 몫이라고 주장한 것입니다. 그럴 수 있는 자리가
       * 있습니다: 예고 중에 무너뜨린 그 타격(+처형)이 체력을 경계 아래로
       * 밀면, **같은 예고 하나**가 붕괴로도 죽고 그 직후 전환도 납니다.
       *
       * 문턱을 달기 전에 게이트를 세운 이유가 이것이었습니다. 게이트가
       * 없었으면 이 겹침은 조용히 지나갔고, 저는 「전환이 판마다 2개를
       * 가져간다」를 **한 번 더** 사실처럼 적었을 것입니다.
       *
       * 그래서 대리 지표(전환 횟수)를 버리고 **사건 자체**를 셉니다:
       * *"전환이 시작된 그 프레임에 보스가 예고 중이었는가."* 예고가
       * 이미 붕괴로 끝났으면 그 순간 예고 중이 아니라 겹치지 않습니다.
       * 한 손실에 원인 하나 — 장부는 그래야 닫힙니다.
       */
      let transKilled = 0
      /** 💀 죽는 순간 보스가 물고 있던 예고(0 또는 1). 아래 죽음 판정에서 셉니다. */
      let deathKilled = 0
      /**
       * ── 🏷 **잃은 예고에 «이름»을 받아 적습니다** ─────────────────────
       *
       * ── 왜 칸을 하나 더 추측하지 않는가 ──────────────────────────
       * 이 장부는 「잃은 것 − 아는 원인들」이라는 **뺄셈**이었습니다.
       * 남는 몫이 생길 때마다 저는 원인을 하나 **짐작해서** 칸을
       * 붙였습니다 — 전환, 그다음 죽음. 두 번 다 맞았지만, 세 번째로
       * 남은 1개 앞에서 같은 짓을 또 하려던 참이었습니다.
       *
       * 뺄셈의 나머지는 **아무 이름이 없습니다.** 그래서 볼 때마다
       * 그럴듯한 이름을 붙이게 되고, 그게 이번 회차에서 세 번 나온
       * 「축이 틀린 채로 답처럼 생긴 숫자」의 만드는 법입니다.
       *
       * ── 대신 «사건»에서 이름을 받습니다 ──────────────────────────
       * 예고가 판정으로 안 가고 끝나는 **그 프레임**에 보스가 무엇을
       * 하고 있었는지 물어봅니다. 그러면 나머지가 0이 아니라 **「기타
       * (state=n)」라는 이름 붙은 칸**이 되고, 다음 판이 그 이름을
       * 직접 알려 줍니다. 짐작할 자리가 사라집니다.
       *
       * ⚠️ 원인은 **위에서부터 하나만** 고릅니다. 전환과 붕괴가 겹치는
       *    프레임이 실제로 있었기 때문입니다(전환 칸 주석 참고).
       *    한 손실에 원인 하나 — 그래야 장부가 닫힙니다.
       */
      const lostBy = {}
      const noteLost = (why) => {
        lostBy[why] = (lostBy[why] ?? 0) + 1
      }
      let swPrev = swing0.sw
      let wasWinding = false
      /**
       * ── 🎓 **가르치느라 붙들려 있던 시간** ──────────────────────────
       *
       * `enemyAI.ts` 는 플레이어가 색 3가지를 볼 때까지 보스 체력을
       * 1→2단계 경계에 **붙들어 둡니다**(`PHASE1_TEACH_COLORS`, 상한
       * `PHASE1_TEACH_CAP` 12초). 그러니 **1단계는 체력 깎기 시합이
       * 아닙니다** — 일부러 늘려 놓은 구간입니다.
       *
       * 그런데 이 프로브는 그 시간을 그냥 「1단계에 걸린 시간」으로
       * 셌습니다. 결과가 이렇게 나왔습니다:
       *
       *     💪 감산 되돌린 화력  1단계 **28** · 2단계 77 · 3단계 67/초
       *
       * 1→2 에서 2.75배 튀고 3단계는 오히려 내려옵니다. 「플레이어가
       * 점점 세진다」로는 안 나오는 모양입니다 — **1단계만 낮습니다.**
       * 분모에 «안 깎이는 시간»이 섞여 있으니 당연합니다.
       *
       * 그리고 같은 이유로 「마지막 구간이 가장 길다」가 못 넘는 문턱이
       * 됩니다: 1단계는 학습 잠금만큼 **공짜로** 길어집니다.
       *
       * ⚠️ 이게 이 세션에서 **세 번째 같은 모양**입니다 —
       *      · 인트로 1.6초가 1단계에 섞여 있었고(고침)
       *      · 전환 2.5초가 2·3단계에 섞여 있었고(고침)
       *      · 이번엔 학습 잠금이 1단계에 섞여 있습니다
       *    「재려는 것이 아닌 시간이 재려는 것 안에」. 한 번 고친 고장은
       *    다른 자리에도 있는지 찾아봐야 한다는 규칙 그대로입니다.
       *
       * 게임은 이미 `teachHold` 로 말해 주고 있었습니다 — 안 듣고
       * 있었을 뿐입니다.
       */
      let heldT = 0
      /** 1단계에서 **실제로 체력이 깎이던** 시간 — 붙듦의 짝입니다. */
      let raceT = 0
      /** 1→2 경계 체력 비율. 게임에게 물어봅니다 — 베껴 적지 않습니다. */
      const p1Edge = G.bossTuning()[1]?.enterBelow ?? 0.75
      let done = false
      const deadline = Date.now() + 200000
      while (!done && Date.now() < deadline) {
        const be = G.bossEncounter()
        const dt = Math.max(0, now() - lastT)
        lastT = now()
        if (!be || be.hp <= 0) {
          /**
           * ── 💀 **장부의 넷째 칸 — 죽음이 지운 예고** ────────────────
           *
           * 세 판 모두 「설명못함 **1**」이 나왔습니다. 판마다 **정확히
           * 하나씩**, 세 판 내리요. 그 정도로 규칙적이면 노이즈가 아니라
           * **장부에 칸이 하나 없는 것**입니다.
           *
           * 후보는 하나뿐이었습니다: 보스가 **예고를 물고 있는 채로
           * 죽으면** 그 예고는 판정에 못 갑니다. 마지막 타격이 예고
           * 도중에 들어가는 것은 드문 일이 아니라 **거의 항상**입니다 —
           * 붙어 서서 쉬지 않고 때리는 침대이므로 보스는 늘 뭔가를
           * 걸고 있습니다.
           *
           * ⚠️ 붕괴와 겹치지 않습니다. 예고가 붕괴로 이미 끝났다면 그
           *    프레임에 `wasWinding` 이 거짓이라 여기서 안 셉니다 —
           *    「전환이 지운 예고」에서 세운 규칙과 같습니다:
           *    **한 손실에 원인 하나.**
           */
          if (wasWinding) {
            deathKilled = 1
            noteLost('죽음')
          }
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
        /**
         * ── 🧊 **`be.transitionT` 는 없는 칸이었습니다** ────────────
         *
         * 이 줄은 원래 `be.transitionT > 0` 이었습니다. 그런데
         * `bossEncounter()` 에는 **`transitionT` 가 없습니다**(main.ts 의
         * 타입을 보십시오 — entity·encounter·aggro·hp·maxHp·phase·
         * homeDist·selfHomeDist·arenaRadius·leashRadius·teachHold).
         * 그 값은 `enemyInfo()` 에 있습니다. 그래서 식은 늘
         * `undefined > 0` = **false** 였고, 이 가지는 **한 번도 실행된
         * 적이 없습니다.**
         *
         * 증거는 출력에 그대로 있었습니다 — 세 판 모두 `전환 0.0초`.
         * 전환은 1.25초(`PHASE_TRANSITION_TIME`)이고 이 판은 한 프레임이
         * 0.16초라 일곱 번쯤 잡혀야 합니다. **0.0 은 «없었다»가 아니라
         * «못 봤다»였습니다.** 0 을 관측으로 읽으면 이렇게 됩니다.
         *
         * 그동안 전환 시간은 통째로 **2·3단계 시간에 섞여** 있었습니다.
         * 바로 위 주석이 *"그 시간을 그냥 두면 뒤 구간이 길어 보인다"* 고
         * 경고한 그 고장이, 경고를 적어 둔 채로 **살아 있었습니다.**
         * 이 저장소의 `lungeSpeed` 와 같은 모양입니다 — 선언·주석·분기가
         * 다 있는데 값이 없어서 조용히 아무 일도 안 하던 자리.
         *
         * ⚠️ 이게 왜 큰가: 「마지막 구간이 가장 길다」의 **판정이 바로 이
         *    침대에 있습니다.** 벤치가 죽음 때문에 못 믿을 값을 낸다고 해서
         *    일부러 여기로 옮겨 온 판정입니다. 그 판정이 2·3단계에 각각
         *    최대 1.25초가 얹힌 값 위에서 초록을 내고 있었습니다.
         */
        const bt = G.enemyInfo(be.entity)?.transitionT ?? 0
        // 올라가는 모서리에서만 셉니다 — 프레임마다 세면 «횟수»가 «시간»이 됩니다.
        const bInfo = G.enemyInfo(be.entity)
        if (bt > 0 && !wasTrans) {
          transitions++
          // 직전 프레임에 예고 중이었다면, 그 예고는 전환이 지운 것입니다.
          if (wasWinding) transKilled++
        }
        wasTrans = bt > 0
        const nowWinding = bt <= 0 && bInfo?.attacking === true && bInfo?.attackPhase === 0
        /**
         * 🏷 **예고가 판정으로 안 가고 끝난 프레임**을 잡습니다.
         * 「휘두름이 나왔는가」는 게임의 장부(`bossSwingLog`)로 판단합니다 —
         * 프로브가 판정 조건을 다시 쓰면 규칙이 두 곳이 됩니다.
         */
        const swNow = Object.values(G.bossSwingLog()).reduce((a2, v) => a2 + v.swings, 0)
        if (wasWinding && !nowWinding && swNow === swPrev) {
          noteLost(
            bt > 0
              ? '전환'
              : (bInfo?.brokenT ?? 0) > 0
                ? '붕괴'
                : `기타(state=${bInfo?.state ?? '없음'})`,
          )
        }
        swPrev = swNow
        wasWinding = nowWinding
        if (be.encounter === 1) intro[0] += dt
        else if (bt > 0) trans[0] += dt
        else if (be.encounter === 2) {
          phase[Math.min(2, be.phase)] += dt
          /**
           * 🎓 **1단계 시간에 담기는 그 프레임에서만** 붙듦을 셉니다.
           *
           * ── 여기 있던 제 버그 ────────────────────────────────────
           * 처음엔 이 줄을 바깥에 두고 `teachHold.holding` 이 참인 모든
           * 프레임에 쌓았습니다. 그런데 1단계 시간은 «인트로도 아니고
           * 전환도 아닐 때»만 쌓입니다. 그래서 붙듦에는 **인트로 1.6초와
           * 전환 시간이 섞였고**, 빼고 나니 이렇게 됐습니다:
           *
           *     1단계 5.5초 · 붙듦 **6.7초** → 5.5 − 6.7 = **−1.1초**
           *     💪 1단계 0/초 (6748.3배)
           *     ✅ 🏁 … 3단계/1단계 **525.00배**  ← 음수 위의 초록
           *
           * 빨강을 없애려고 만든 수정이 **말이 안 되는 숫자로 초록**을
           * 만들어 냈습니다. 「초록도 잘못 잰 초록일 수 있다」 그대로입니다.
           * 그리고 이건 제가 바로 전 커밋에서 «세 번째 같은 모양»이라고
           * 지적한 그 실수입니다 — **서로 다른 구간의 시간을 빼기.**
           * 지적한 사람이 같은 자리에서 넘어졌으니, 규칙이 아니라 **구조**로
           * 막습니다: 빼는 두 값을 **같은 줄에서, 같은 조건으로** 셉니다.
           */
          /**
           * ── 🎯 **«잠금이 켜져 있다»와 «지금 붙들려 있다»는 다릅니다** ──
           *
           * 처음엔 `teachHold.holding` 을 그대로 붙듦으로 셌습니다. 그런데
           * 그 깃발의 뜻은 *"색을 아직 다 못 봤다"* 이고, **1단계 시작부터
           * 참**입니다 — 플레이어가 체력을 한창 깎고 있는 동안에도요.
           * 그래서 «체력을 깎던 시간»까지 붙듦에 들어가 1단계 5.6초 중
           * 5.2초가 붙듦으로 찍혔고, 남은 0.5초로는 판정을 못 했습니다.
           *
           * 실제로 손해 보는 시간은 **체력이 경계선에 닿은 뒤**입니다.
           * 그 전까지는 때리는 만큼 깎입니다(클램프는 «경계 아래로 못
           * 내려간다»는 규칙이지 «안 깎인다»가 아닙니다). 그래서
           * **체력 비율로 가릅니다** — 깃발이 아니라 **사건**으로.
           *
           * 이 세션에서 대리 지표를 사건으로 바꾼 두 번째 자리입니다
           * (첫 번째는 「전환 횟수 → 전환이 실제로 지운 예고」).
           */
          if (be.phase === 0) {
            if (be.hp / Math.max(1, be.maxHp) <= p1Edge + 0.01) heldT += dt
            else raceT += dt
          }
        }

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
      const swing1 = Object.values(G.bossSwingLog()).reduce(
        (a, v) => ({ com: a.com + (v.commits ?? 0), sw: a.sw + v.swings }),
        { com: 0, sw: 0 },
      )
      return {
        intro: intro[0],
        trans: trans[0],
        phase,
        breaks,
        fins,
        armed,
        fired,
        killed: done,
        commits: swing1.com - swing0.com,
        swings: swing1.sw - swing0.sw,
        windupBreaks: (G.runStats?.().windupBreaks ?? 0) - wb0,
        transitions,
        transKilled,
        deathKilled,
        lostBy,
        heldT,
        raceT,
      }
    })
    shapes.push(r)
    console.log(
      `     ${run + 1}판 — 인트로 ${r.intro.toFixed(1)} · 전환 ${r.trans.toFixed(1)} · 1단계 ${r.phase[0].toFixed(1)} · 2단계 ${r.phase[1].toFixed(1)} · 3단계 ${r.phase[2].toFixed(1)}초` +
        ` · 무너짐 ${r.breaks.join('/')} · 처형 ${r.fins.join('/')}` +
        ` · 예고 ${r.commits}→판정 ${r.swings}` +
        (r.commits > 0 ? `(끊김 ${Math.round(((r.commits - r.swings) / r.commits) * 100)}%)` : '') +
        ` · 1단계 깎기 ${r.raceT.toFixed(1)}초 + 붙듦 ${r.heldT.toFixed(1)}초` +
        ` · 잃은예고 ${r.commits - r.swings} = ` +
        (() => {
          /**
           * 🏷 뺄셈이 아니라 **이름 붙은 칸들의 합**입니다. 나머지가
           * 남으면 그건 «설명 못 함»이 아니라 «관측이 놓친 것»이고,
           * 그 구분이 중요합니다 — 앞의 것은 게임의 수수께끼이고
           * 뒤의 것은 **제 계기의 구멍**입니다.
           */
          const named = Object.entries(r.lostBy ?? {})
          const sum = named.reduce((a2, [, v]) => a2 + v, 0)
          const gap = r.commits - r.swings - sum
          return (
            (named.length ? named.map(([k, v]) => `${k} ${v}`).join(' + ') : '없음') +
            (gap === 0 ? ' (장부 맞음)' : ` + **관측이 놓침 ${gap}** ⚠️`)
          )
        })() +
        ` · 연계 예약 ${r.armed.join('/')} 발동 ${r.fired.join('/')}${r.killed ? '' : ' ⚠️ 못 잡음'}`,
    )
  }

  const ok = shapes.filter((s) => s.killed)
  check(ok.length === RUNS, `${RUNS}판 모두 보스를 잡았다 (못 잡은 판으로 평균을 내지 않게)`, `${ok.length}/${RUNS}판`)

  /**
   * ── 🧾 **장부가 닫혔습니다 — 그리고 결론이 뒤집혔습니다** ──────────
   *
   * 세 판 모두 잔액 0입니다:
   *
   *     1판 잃은예고 4 = 붕괴 2 + 전환 2
   *     2판 잃은예고 3 = 붕괴 1 + 전환 2
   *     3판 잃은예고 3 = 붕괴 1 + 전환 2
   *
   * **전환이 판마다 정확히 2개씩 가져갑니다.** 페이즈가 오를 때
   * `enemyAI.ts` 가 `Actor.state[e] = ActorState.Idle` 로 자세를 끊는데,
   * 그 부수 효과로 보스가 걸어 둔 예고가 사라집니다. 전환은 판당 2번,
   * 그래서 **매판 2개**입니다 — 플레이어가 한 일이 아닙니다.
   *
   * ── 제가 세 회차 동안 틀리게 말한 것 ────────────────────────────
   * 저는 이 값을 「끊김 63%」로 읽고 *"보스가 시작한 공격의 3분의 2를
   * 잃는다 · 같은 병이 세 번째다 · 0.45 처방이 안 들었다"* 고 적었습니다.
   * **절반이 구조적인 것이었습니다.** 전환 몫을 빼면 강인도가 죽인 예고는
   *
   *     6개 중 2 · 1 · 1 → **33% · 17% · 17%**
   *
   * 판당 1~2회입니다. 참고한 게임들이 겨냥하는 자리가 정확히 거기입니다 —
   * 세키로·엘든 링·오공에서 보스를 공격 도중에 무너뜨리는 것은 **읽어낸
   * 값**이지 기본기가 아니고, 한 판에 한두 번이 그 모양입니다.
   * `breakResistStep 0.45` 는 **제 일을 하고 있었습니다.** 제가 장부의
   * 칸이 하나뿐인 계기를 보고 병이라고 불렀을 뿐입니다.
   *
   * 그래서 이제야 문턱을 답니다 — **재고 나서**, 그리고 «설명 못 하는
   * 몫이 0일 때만».
   *
   * ── ⚠️ **`ok`(잡은 판)가 아니라 `shapes`(모든 판)를 씁니다** ──────
   * 처음엔 이 블록을 `if (ok.length)` 안에 뒀습니다. 그랬더니 기계가
   * 느려 세 판 다 시간 안에 못 잡은 날, 장부 검사가 **빨갛게 실패한 게
   * 아니라 통째로 사라졌습니다.** 출력에 아무 줄도 안 남습니다.
   *
   * 그런데 장부는 **보스를 잡았는지와 무관합니다** — 예고가 몇 개
   * 사라졌고 무엇이 가져갔는지는 진 판에서도 똑같이 셀 수 있습니다.
   * 구간 «시간»만 이긴 판을 필요로 합니다(진 판은 3단계가 0초라
   * 평균을 망칩니다). 그래서 시간 검사만 `ok` 안에 두고, 장부는
   * 밖으로 꺼냅니다. 「없어지는 검사는 통과가 아닙니다」.
   */
  /**
   * ⚠️ **여기 있어야 합니다.** 원래 이 함수는 `if (ok.length)` 안에
   * 있었는데, 장부 블록을 그 앞으로 옮기면서 «선언보다 먼저 쓰는» 꼴이
   * 됐고 프로브가 `ReferenceError: mid is not defined` 로 죽었습니다
   * (32개 중 19개만 돌고 끝났습니다). 이 세션에서만 세 번째 같은 실수라,
   * 블록을 옮길 때는 **그 블록이 쓰는 이름이 위에 있는지**를 같이 봅니다.
   */
  const mid = (xs) => {
    const a = [...xs].sort((x, y) => x - y)
    const h = a.length >> 1
    return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2
  }
  const led = shapes.map((s) => ({
    com: s.commits,
    lost: s.commits - s.swings,
    wb: s.windupBreaks,
    tr: s.transKilled,
    trAll: s.transitions,
    dk: s.deathKilled,
    named: Object.values(s.lostBy ?? {}).reduce((a2, v) => a2 + v, 0),
  }))
  const rest = led.reduce((a, r) => a + (r.lost - r.named), 0)
  check(
    rest === 0 && led.length > 0,
    '🧾 잃은 예고에 **전부 이름이 붙었다** (관측이 놓친 것이 없다 · 판정의 게이트)',
    led.length
      ? led.map((r) => `${r.lost}=${r.named}`).join(' · ') + (rest ? ` ← 놓침 ${rest}` : '')
      : '판이 없습니다',
  )
  {
    /**
     * 🏷 **무엇이 예고를 지웠는가 — 이름별 합계.** 판정은 안 답니다.
     * 여기 「기타(state=n)」 가 뜨면 그게 다음에 볼 자리입니다 —
     * 뺄셈의 나머지와 달리 **어디를 볼지 알려 주는** 나머지입니다.
     */
    const roll = {}
    for (const sh of shapes)
      for (const [k, v] of Object.entries(sh.lostBy ?? {})) roll[k] = (roll[k] ?? 0) + v
    const rows = Object.entries(roll).sort((a2, b2) => b2[1] - a2[1])
    console.log(
      `     🏷 예고를 지운 것 — ${rows.length ? rows.map(([k, v]) => `${k} ${v}회`).join(' · ') : '없음'}`,
    )
  }
  /**
   * ⚠️ **장부가 안 닫히면 이 아래는 판정하지 않습니다.** 설명 못 하는
   *    몫이 남아 있는데 비율을 판정하면, 그 몫이 나중에 계기 고장으로
   *    밝혀졌을 때 빨강/초록이 통째로 무의미해집니다. 실제로 이 자리에서
   *    「전환 0.0초」라는 **못 본 값**을 관측으로 읽고 초록을 낸 적이
   *    있습니다.
   */
  if (rest === 0 && led.length > 0) {
    const brokeRate = mid(led.map((r) => (r.com > 0 ? r.wb / r.com : 0)))
    /**
     * 문턱 «절반»의 근거: *"보스가 시작한 것보다 끝낸 것이 많아야 한다"* 는
     * 설명이 필요 없는 선입니다. 잰 값은 33·17·17% 라 1.5~3배 여유가
     * 있습니다 — **벽이 아니라 되돌이 방지선**입니다. 누가 평타의 강인도
     * 배수를 올리거나 보스 강인도를 낮추면 이 줄이 먼저 웁니다.
     *
     * 전환 몫은 **일부러 뺍니다.** 그건 강인도 이야기가 아니라 연출
     * 이야기이고, 처방이 다른 둘을 한 칸에 담으면 거꾸로 읽힙니다.
     */
    check(
      brokeRate <= 0.5,
      '💢 **강인도로 끊기는 예고가 절반을 넘지 않는다** (무너뜨리기는 읽어낸 값이지 기본기가 아니게 · 전환 몫 제외)',
      `${(brokeRate * 100).toFixed(0)}% — 판별 ` +
        led.map((r) => `${r.wb}/${r.com}`).join(' · '),
    )
    console.log(
      `     📏 전환이 지운 예고 ${led.map((r) => r.tr).join('/')} · 전환 자체는 ${led.map((r) => r.trAll).join('/')}회` +
        ' (전환이 늘 예고를 지우는 것은 아닙니다 · 강인도가 아니라 연출 몫 — 판정 안 함)',
    )
  }
  /**
   * ── 💪 **구간마다 «같은 손»이 얼마나 세지는가** ──────────────────
   *
   * 이 침대는 평타(Mouse0)만 누릅니다. 강타도 스킬도 성수병도 없습니다.
   * 그러니 구간이 바뀌어도 **플레이어가 하는 일은 똑같습니다.** 그런데
   * 세 판이 이렇게 나왔습니다:
   *
   *     1단계 5.6초 · 무너짐 1 · 처형 1
   *     3단계 5.3초 · 무너짐 **0** · 처형 **0**
   *
   * 3단계는 붕괴도 처형도 **한 번도 없는데** 1단계와 비슷한 시간에
   * 끝납니다. 그런데 3단계가 지고 있는 짐은 훨씬 무겁습니다:
   *
   *     구간 체력  40% vs 25%            → 1.6배
   *     피해 감산  0.70 vs 1.00          → 1.43배 더 때려야 함
   *     ─────────────────────────────────────────
   *     실효 일감 **2.3배**  ·  걸린 시간 **0.94배**
   *
   * 여기까지 읽고 저는 *"같은 손이 3단계에서 2.4배쯤 세진다"* 고 적었고,
   * 그 원인을 두 회차 동안 찾아다녔습니다(출혈? 집중? 우연?).
   *
   * ── ❌ **2.4배는 없는 숫자였습니다** ─────────────────────────────
   *
   * 위 계산의 «1단계 5.6초»에는 **학습 잠금으로 붙들린 4~6초**가 들어
   * 있었습니다(`enemyAI.ts` 는 색 3가지를 볼 때까지 보스 체력을 1→2
   * 경계에 고정합니다). 체력이 안 깎이는 시간을 분모에 넣었으니
   * 1단계 화력만 낮게 찍힌 것이고, 그 낮은 값이 «뒤가 세 보이는»
   * 착시를 만들었습니다.
   *
   * 깎던 시간만으로 다시 재면 **방향이 뒤집힙니다**:
   *
   *     1단계 깎기 1.3초 → 초당 **119**
   *     2단계 3.3초      → 초당   77
   *     3단계 5.2초      → 초당 **67**    (0.6배)
   *
   * (⚠️ 굵게와 슬래시를 붙여 «별별슬래시»를 만들면 주석이 거기서
   *  닫힙니다. 이 세션에서 두 번째로 밟은 자리라 떼어 씁니다.)
   *
   * 손은 세지는 게 아니라 **약해집니다.** `damageTakenScale`
   * (1.00 → 0.85 → 0.70)과 `poiseResist` 가 설계대로 일하고 있습니다.
   * 찾아다닌 원인은 **처음부터 없었습니다** — 계기가 만든 숫자였습니다.
   *
   * (출혈 가설도 여기서 접습니다. combat.ts 는 출혈 팝에도
   *  `bossTakenScale` 을 곱하고, 팝 피해는 `min(maxHp×0.15, 100)` 로
   *  회당 고정입니다 — 길어진다고 커지는 값이 아닙니다.)
   *
   * ── 그래서 이 줄이 지금 말하는 것 ───────────────────────────────
   * 이제 1단계는 **체력이 실제로 깎이던 시간**으로만 잽니다. 남는
   * 관찰은 하나입니다: **1단계 체력 구간(25%)이 1.3초 만에 사라집니다.**
   * 구간을 지탱하는 것은 체력이 아니라 학습 잠금입니다.
   *
   * ⚠️ 다만 이 침대는 기력 무한으로 붙어서 평타만 넣는 **최악의 압력**
   *    이라 1.3초는 극단값입니다. 실제 플레이(벤치)에서 1단계는
   *    9.9초였는데 그중 얼마가 잠금인지는 **아직 아무도 모릅니다.**
   *    벤치에도 같은 갈래를 넣기 전에는 배분을 만지지 마십시오.
   */
  if (ok.length) {
    const tune = await page.evaluate(() => ({
      t: window.__game.bossTuning(),
      maxHp: window.__game.enemyRoster().find((r) => r.id === 'boss')?.maxHp ?? 0,
    }))
    /**
     * 🎓 **1단계에서는 붙들린 시간을 뺍니다.** 그 초 동안 보스 체력은
     *    경계선에 고정입니다 — 때려도 안 깎입니다. 분모에 넣으면
     *    «플레이어가 약하다»로 읽히는데, 실제로는 «게임이 안 깎아 준
     *    시간»입니다. 이걸 빼기 전에는 1단계만 28/초로 찍혀서 저는
     *    「뒤로 갈수록 손이 세진다」는 없는 이야기를 쫓고 있었습니다.
     */
    const rawOf = (i) => {
      const upper = tune.t[i].enterBelow
      const lower = i + 1 < tune.t.length ? tune.t[i + 1].enterBelow : 0
      const band = tune.maxHp * (upper - lower)
      const secs = i === 0 ? mid(ok.map((s) => s.raceT)) : mid(ok.map((s) => s.phase[i]))
      const tough = tune.t[i].damageTakenScale ?? 1
      // 0.05 로는 못 막습니다 — 음수도 «> 0.05 가 아님»으로 0이 되지만,
      // 0 을 화력으로 찍으면 «약하다»로 읽힙니다. 못 잰 것은 0이 아닙니다.
      return secs > 0.5 ? band / tough / secs : NaN
    }
    const raws = [0, 1, 2].map(rawOf)
    console.log(
      `     💪 감산 되돌린 화력 ${raws
        .map((v, i) => `${i + 1}단계 ${Number.isFinite(v) ? v.toFixed(0) : '못 잼'}`)
        .join(' · ')}/초` +
        (Number.isFinite(raws[0]) && Number.isFinite(raws[2])
          ? ` (${(raws[2] / raws[0]).toFixed(1)}배)`
          : ' (배수는 못 냅니다 — 성한 분모가 없습니다)') +
        ` — 1단계는 **체력이 실제로 깎이던 ${mid(ok.map((s) => s.raceT)).toFixed(1)}초**로 잰 값입니다` +
        ` (붙듦 ${mid(ok.map((s) => s.heldT)).toFixed(1)}초는 뺐습니다)`,
    )
  }
  if (ok.length) {
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
    /**
     * ── ⚖️ **바로 아래 검사와 «1단계»의 뜻을 맞춥니다** ──────────────
     *
     * 이 두 검사가 같은 판을 놓고 반대로 말한 적이 있습니다:
     *
     *     ❌ 한 구간만 유독 길지 않다 — 가장 김 **7.2초** · 배수 3.2
     *     ✅ 🏁 마지막 구간이 가장 길다 — 1단계 **1.3초** · 3단계 4.5초
     *
     * 같은 1단계가 한 줄에서는 7.2초, 다음 줄에서는 1.3초입니다. 차이는
     * **붙듦 5.9초** — 색을 다 보여줄 때까지 보스 체력을 붙들어 두는
     * «가르치는 시간»입니다. 🏁 는 그걸 빼고, 이 검사는 안 뺐습니다.
     *
     * 어느 쪽이 옳은가: **빼는 쪽입니다.** 이 검사가 묻는 것은 *"체력을
     * 고르게 나눴는데 한 구간만 오래 걸리는가"* 이고, 붙듦은 체력 배분과
     * 아무 상관이 없습니다 — 플레이어가 때려도 안 깎이도록 **일부러**
     * 멈춰 둔 시간입니다. 그걸 넣고 재면 「1단계가 길다」는 답이 항상
     * 나오는데, 그건 구조 문제가 아니라 **설계대로**입니다.
     *
     * ⭐ 같은 화면의 두 검사가 같은 이름을 다르게 세면, 반드시 하나는
     *    거짓말을 합니다. 정의는 한 곳에서 나와야 합니다.
     */
    const perNet = [mid(ok.map((s) => s.raceT)), per[1], per[2]]
    const band = await page.evaluate(() => window.__game.bossTuning()[0].lenBand)
    /**
     * ── ⚖️ **이 검사가 🏁 와 반대를 요구하고 있었습니다** ────────────
     *
     * 붙듦을 빼고 나니 모순이 드러났습니다:
     *
     *     ✅ 🏁 마지막 구간이 가장 길다  — 3단계/1단계 3.28배
     *     ❌ 한 구간만 유독 길지 않다     — 3.28배 (상한 2.5)
     *
     * 3.28배는 위 약속을 **지킨 결과**인데 아래가 그걸 금지합니다.
     * 설계가 «길어라»라고 이름 댄 구간을, 이름 없는 상한이 자릅니다.
     *
     * ── 그래서 역할을 가릅니다 ──────────────────────────────────────
     * · **마지막 구간**은 🏁 가 봅니다 — 아래·위 눈금 둘 다
     *   (`PHASE_LEN_BAND`, bossPhases.ts 한 곳).
     * · **여기**는 설계가 아무 말도 안 한 구간들끼리만 봅니다
     *   (1단계 vs 2단계). 원래 잡으려던 것 — *"체력을 고르게 나눴는데
     *   한 구간만 유독 길다"* — 은 그대로 잡힙니다.
     *
     * ⚠️ 빨강을 없애려고 문턱을 무르게 한 것이 **아닙니다.** 상한 자체는
     *    🏁 로 옮겨 갔고, 거기서 지금 실제로 판정합니다.
     */
    const midPer = [perNet[0], perNet[1]]
    const hi = Math.max(...midPer)
    const lo = Math.min(...midPer.filter((v) => v > 0.05))
    check(
      hi <= lo * band.max,
      `설계가 «길어라»라고 안 한 구간끼리 유독 벌어지지 않는다 (1·2단계 · ≤ ${band.max}배 · 마지막 구간은 🏁 가 봅니다)`,
      `1단계 ${perNet[0].toFixed(1)}초(깎던 시간) · 2단계 ${perNet[1].toFixed(1)}초 · 배수 ${(hi / lo).toFixed(1)}` +
        ` [붙듦 ${mid(ok.map((s) => s.heldT)).toFixed(1)}초 별도]`,
    )

    /**
     * ── 🏁 **마지막 구간이 가장 길다** (bossPhases.ts 의 약속) ──────────
     *
     * ── 왜 이 판정이 여기로 왔는가 ──────────────────────────────────
     * 이 약속의 빨강/초록은 원래 `npm run bench` 에 있었습니다. 그런데
     * 벤치의 플레이어는 **보스전 중에 죽습니다.** 죽으면 보스 체력이
     * 되감기므로 구간 시간이 통째로 무너지고, 실제로 `1단계 9.7
     * (4.1~15.3)초` 같은 값이 나왔습니다. 벤치는 그걸 알고 *"이 수치로
     * 배분을 계산하지 마세요"* 라고 경고까지 찍으면서, **바로 아랫줄에서
     * 그 수치로 판정**하고 있었습니다.
     *
     * 저는 여러 회차 동안 그 빨강을 보고 보스 배율을 만질 계산을 했습니다.
     * 재고 있던 것은 보스가 아니라 **죽음**이었습니다.
     *
     * 여기는 체력·기력을 매 틱 채우며 **일정한 압력**을 넣는 자리라
     * 죽음이 없습니다. 약속이 묻는 것(*"체력 배분과 실제 시간이 맞는가"*)
     * 에 정확히 맞는 침대입니다. **재는 자리를 옮긴 것이지 문턱을 낮춘
     * 것이 아닙니다** — 스펀지 쪽 게이트는 바로 위에 그대로 있습니다.
     */
    /**
     * ── 🎓 **1단계에서 «가르치느라 붙든 시간»을 뺍니다** ────────────────
     *
     * 이 검사의 질문은 바로 위 주석이 적어 둔 그대로입니다 —
     * *"체력 배분과 실제 시간이 맞는가."* 그렇다면 **체력이 안 깎이는
     * 시간은 그 질문에 속하지 않습니다.**
     *
     * `enemyAI.ts` 는 색 3가지를 보여줄 때까지 보스 체력을 1→2 경계에
     * 고정합니다(상한 12초). 그 동안 플레이어가 아무리 때려도 게이지는
     * 안 움직입니다. 그 초를 1단계에 얹으면 1단계는 **공짜로** 길어지고,
     * 3단계는 그걸 이길 방법이 없습니다.
     *
     * ⚠️ 그리고 이 침대에서는 붙드는 시간이 **더 길어집니다.** 여기 손은
     *    쉬지 않고 평타를 넣어 보스를 자주 무너뜨리는데, 무너지면 예고가
     *    끊기고, 예고가 끊기면 **색을 못 보여 줍니다.** 즉 이 침대는
     *    학습 잠금을 실제 플레이보다 오래 붙잡습니다 — 침대의 성질이지
     *    게임의 성질이 아닙니다. 더더욱 빼고 봐야 합니다.
     *
     * 🔎 **뺀 값과 안 뺀 값을 나란히 냅니다.** 하나만 내면 다음 사람이
     *    «무엇을 뺀 숫자인지» 모른 채 값을 만지게 됩니다. 이 세션이
     *    인트로·전환에서 두 번 겪은 자리입니다.
     */
    const hold = mid(ok.map((s) => s.heldT))
    /**
     * ⚠️ **빼기가 아니라 «그 자리에서 센 값»을 씁니다.**
     *
     * `per[0] − hold` 로 구하던 것을 그만둡니다. 빼기는 두 값이 정확히
     * 같은 구간을 덮을 때만 맞고, 이 세션에서 그게 어긋나 **음수 분모
     * 위의 초록**이 한 번 나왔습니다. 이제 깎던 시간을 **같은 프레임에서
     * 직접** 셉니다 — 빼기가 없으면 어긋날 것도 없습니다.
     */
    const p1Fight = mid(ok.map((s) => s.raceT))
    /**
     * ⚠️ **음수·0 위에서는 판정하지 않습니다.**
     *
     * 이 게이트가 없어서 `1단계 −1.1초` 가 `3단계/1단계 525배` 로
     * 계산되어 **초록**이 떴습니다. 빼기가 어긋나면 비율은 아무 값이나
     * 됩니다 — 「비율은 분모가 성한지부터」.
     */
    if (p1Fight <= 0.5) {
      console.log(
        `  ⏸ 🏁 마지막 구간이 가장 길다 — **판정하지 않습니다**: ` +
          `1단계 ${per[0].toFixed(1)}초에서 붙듦 ${hold.toFixed(1)}초를 빼면 ` +
          `${p1Fight.toFixed(1)}초입니다. 분모가 성하지 않으면 배수는 아무 값이나 됩니다.`,
      )
    } else {
    /**
     * 📏 **눈금은 게임이 줍니다** — bossPhases.ts `PHASE_LEN_BAND`.
     * 여기 상수를 다시 적으면, 벤치·침대·배수 검사가 각자 다른 값을
     * 들고 있던 그 상태로 돌아갑니다(그 상수의 주석 참고).
     *
     * ⚠️ **위 눈금이 새로 생겼습니다.** 전에는 «1배만 넘으면 통과»라
     *    3단계가 아무리 길어도 안 잡혔습니다. 「가장 길다」는 약속이지
     *    「길수록 좋다」가 아닙니다 — 스펀지가 되는 선이 있어야 합니다.
     */
    const lb = await page.evaluate(() => window.__game.bossTuning()[0].lenBand)
    const ratio = per[2] / Math.max(0.01, p1Fight)
    check(
      ratio >= lb.min && ratio <= lb.max,
      `🏁 **마지막 구간이 가장 길다 — 그리고 스펀지는 아니다** (bossPhases.ts 의 약속 · 허용 ${lb.min}~${lb.max}배 · 죽음 없는 자리에서 · **붙듦 제외**)`,
      `1단계 ${p1Fight.toFixed(1)}초(깎던 시간 · 붙듦 ${hold.toFixed(1)}초 별도 · 합 ${per[0].toFixed(1)}초) · ` +
        `2단계 ${per[1].toFixed(1)}초 · 3단계 ${per[2].toFixed(1)}초` +
        ` (3단계/1단계 **${ratio.toFixed(2)}배**)` +
        (ratio > lb.max
          ? ' ← ⚠️ 분모(1단계 깎던 시간)가 붙듦에 눌린 값입니다. 이 배수로 밸런스를 움직이기 전에 그것부터 가르십시오.'
          : ''),
    )
    }
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

  /**
   * ── 🎲 **거리마다 무엇을 고르는가** ───────────────────────────────
   *
   * ── 왜 이 측정이 필요해졌는가 (세 번 실패하고 나서) ────────────────
   * 보스의 🟢 돌진(3~10m)과 🟣 갈고리(5~11m)가 실전 측정에서 **0회**였습니다.
   * 3단계는 가중치 13 중 9를 그 둘에 걸어 뒀는데도요. 그래서 보스의
   * **위치 행동**을 세 번 고쳤고 세 번 다 0회여서 세 번 다 되돌렸습니다:
   *   ① 막히면 한 발 물러선다(쿨다운 3.2초) ② 같은 것을 조여서(1.2초)
   *   ③ 그 페이즈 주인공 패턴의 사거리를 지킨다
   *
   * 그리고 마지막 판에서 더 이상한 것이 보였습니다 — 3단계에서 실제로
   * 나온 분포가 **가중치와 맞지 않습니다**:
   *
   *     기대: cleave 4 · quake 2 · bind 2   (붙어 있는 거리에서 후보인 셋)
   *     실제: quake 44 · cleave 41 · bind **0**
   *
   * cleave 는 quake 의 두 배여야 하는데 1:1 이고 bind 는 아예 0 입니다.
   * 이건 위치 문제가 **아닙니다.** 위치를 아무리 고쳐도 안 풀립니다.
   *
   * > **행동을 고치기 전에, 고르는 것부터 재라.**
   *
   * ── 어떻게 재는가 ────────────────────────────────────────────────
   * 거리를 **통제**합니다. 플레이어를 매 프레임 정확한 거리에 세워 두고
   * (때리지 않으므로 무기 돌진이 거리를 흐트러뜨리지 않습니다), 페이즈를
   * 체력 구간 한가운데에 고정하고, 무적으로 죽지 않게 한 뒤, 보스가 무엇을
   * 고르는지 셉니다. 거리가 고정이면 후보 집합도 고정이라 **가중치대로
   * 나오는가**를 한 번에 가를 수 있습니다.
   *
   * ⚠️ 거리 목록도 **게임에서** 만듭니다 — 패턴들의 `minRange` 경계를 읽어
   *    그 바로 안쪽·바깥쪽을 고릅니다. 여기 숫자를 적으면 사거리를 손보는
   *    날 이 측정이 조용히 엉뚱한 자리를 재게 됩니다.
   */
  console.log('\n  🎲 거리를 고정해 놓고 — 보스가 무엇을 고르는가 (3단계)\n')
  const picks = await page.evaluate(async () => {
    const G = window.__game
    const roster = G.enemyRoster().find((r) => r.id === 'boss')
    const atks = roster?.attacks ?? []
    /** 경계 바로 바깥쪽에 서 봅니다 — 경계마다 후보 집합이 한 칸씩 늘어납니다. */
    const edges = [...new Set(atks.map((a) => a.minRange))].sort((x, y) => x - y)
    /**
     * ⚠️ **몸통 안쪽에는 못 섭니다.** 처음엔 경계 0 에서 0.6m 를 잡았는데,
     *    보스 반지름이 0.95m 라 물리가 서로를 밀어내고 26초에 **1회**밖에
     *    안 휘둘렀습니다. 표본 1회로는 분포를 말할 수 없습니다.
     *    가장 가까운 자리도 **몸이 닿지 않는 거리**부터 잡습니다.
     */
    const floor = (roster?.radius ?? 1) + 1.2
    const spots = [...new Set(edges.map((v) => Number(Math.max(v + 0.6, floor).toFixed(1))))]
    const bounds = G.bossPhaseBounds()
    const out = []
    for (const d of spots) {
      /**
       * 🎲 **거리마다 난수 씨앗을 갈아 끼웁니다.**
       *
       * `combatRng` 는 씨앗이 고정이라, 이 프로브를 백 번 돌려도 **같은 한
       * 판**입니다. 그래서 아래 「연달아 같은 것」이 기대치와 3σ 어긋났을 때
       * *"진짜 어긋남"* 인지 *"그 한 판이 그랬을 뿐"* 인지 가릴 수가
       * 없었습니다. 세 거리를 **세 개의 다른 스트림**으로 돌리면 적어도
       * 서로 독립한 세 판이 됩니다.
       *
       * ⚠️ 씨앗은 **거리에서 유도**합니다(자리마다 고정). 그래야 이 검사가
       *    돌릴 때마다 다른 답을 내지 않습니다 — 재현되지 않는 계측기는
       *    계측기가 아닙니다.
       */
      G.setCombatSeed(Math.round(d * 1000))
      G.reset()
      await window.__t.runFor(0.6)
      G.clearEnemies()
      await window.__t.runFor(0.3)
      const p = G.state().player
      const b = G.spawnBoss(p.x + 4, p.z)
      G.wakeEnemy(b)
      G.setPlayerInvulnerable(true)
      await window.__t.runFor(0.4)
      const max = G.enemyInfo(b).max
      // 3단계 체력 구간 한가운데 — 경계는 게임에서 읽습니다.
      const target = max * (bounds[2] / 2)
      G.setHp(b, target)
      await window.__t.until(
        () => G.enemyInfo(b)?.phase === 2 && G.enemyInfo(b)?.transitionT === 0,
        8,
      )
      /** 지금까지의 누적을 **바닥으로** 잡습니다(장부는 누적입니다). */
      const base = {}
      for (const [id, v] of Object.entries(G.bossSwingLog())) base[id] = v.swings
      /**
       * 🎲 **굴림 장부의 바닥도 같이 찍습니다.**
       *
       * 아래에서 세는 `bossSwingLog` 는 **휘두름**이고, 휘두름에는 굴림이
       * 아닌 것이 섞여 있습니다(연계 · 광역 자리 대체). 가중치와 비교해야
       * 하는 것은 **굴림**입니다. 그 구분을 프로브가 추측하지 않도록
       * 게임이 `pickLog()` 로 적어 줍니다(enemyAI `notePick` 설계 노트).
       */
      const pickBase = G.pickLog().length
      const t0 = G.state().simElapsed
      /**
       * ⚠️ **26 → 70초.** 같은 커밋에서 이 프로브가 한 번은 22/23, 한 번은
       *    23/23 을 냈습니다 — 코드는 그대로였는데 답이 바뀌었습니다.
       *
       *    26초로는 거리마다 **7~8회**밖에 안 휘두릅니다. 그런데 아래
       *    가중치 검사의 문턱 0.25 는 자기 주석에 *"표본 20~40회"* 라고
       *    적어 두고 잡은 값입니다. 8회에서 25%p 는 **휘두름 한 번 차이**
       *    입니다(2/8 = 25% vs 3/8 = 38%). 그래서 굴림 하나에 검사가
       *    빨개졌다 초록이 됐다 합니다.
       *
       *    고칠 곳은 **문턱이 아니라 표본 수**입니다. 문턱을 늘리면
       *    *"이제 안 빨개진다"* 만 남고, 진짜로 규칙이 어긋난 날에도
       *    조용합니다. 70초면 거리마다 대략 20회가 모입니다.
       */
      while (G.state().simElapsed - t0 < 70) {
        const i = G.enemyInfo(b)
        if (!i) break
        // 거리를 **정확히** 유지합니다 — 이 측정의 통제 변수입니다.
        G.teleportPlayer(i.x - d, i.z)
        G.aimAtWorld(i.x, i.z)
        if (Math.abs((G.enemyInfo(b)?.hp ?? target) - target) > 1) G.setHp(b, target)
        await new Promise((r) => setTimeout(r, 8))
      }
      const got = {}
      for (const [id, v] of Object.entries(G.bossSwingLog())) {
        const n = v.swings - (base[id] ?? 0)
        if (n > 0) got[id] = n
      }
      const picked = G.pickLog().slice(pickBase)
      G.setPlayerInvulnerable(false)
      G.clearEnemies()
      out.push({ d, got, picked })
    }
    return { spots, out, atks }
  })

  /**
   * ── 🎲 **굴림**을 가중치와 비교합니다 (예전에는 휘두름을 비교했습니다) ──
   *
   * 이 검사는 오래 흔들렸고, 표본을 20여 회로 늘리자 **안정적으로 빨개졌습니다**
   * (2.1m 의 🔴 직격 — 기대 50% · 실제 24%). 그때부터 이론을 셋 세웠습니다:
   * 연계 탓인가, `preferReach` 탓인가, 광역 자리 대체 탓인가.
   *
   * 게임에게 물어보니(`pickLog()`) **셋 다 틀렸습니다** — 그 판에서
   * `preferReach` 0회, 대체 0회였고, **굴림 자체는 가중치대로**였습니다
   * (직격 53% · 광역 37% · 속박 11%). 틀린 것은 게임이 아니라 **비교 대상**
   * 이었습니다: 휘두름에는 굴린 적 없는 **연계**가 섞여 있습니다.
   *
   * 그래서 이제 굴림만 봅니다. 그리고 **세 거리를 합쳐서** 봅니다 —
   * 기대치가 거리마다 다르므로 각 굴림이 자기 후보표에서 자기 기대치를
   * 갖고 오면, 합쳐도 뜻이 흐려지지 않고 표본만 세 배가 됩니다.
   *
   * ⚠️ 기대치는 **게임이 적어 준 후보와 가중치**로 만듭니다. 프로브가
   *    사거리(min/max)를 다시 판정하면 그 판정이 두 곳에 살게 되고,
   *    언젠가 한쪽만 고쳐서 조용히 다른 기대치를 씁니다.
   */
  const allPicks = picks.out.flatMap((r) => r.picked ?? [])
  /** 굴림이 아닌 경로가 실제로 얼마나 끼는지 — 위 표가 왜 달랐는지의 근거입니다. */
  const swapped = allPicks.filter((q) => q.rolled !== q.chosen).length
  const preferred = allPicks.filter((q) => q.preferReach).length
  const rolls = new Map()
  const expect = new Map()
  for (const q of allPicks) {
    if (!q.rolled) continue
    rolls.set(q.rolled, (rolls.get(q.rolled) ?? 0) + 1)
    const total = q.candidates.reduce((n, c) => n + c.w, 0)
    if (total <= 0) continue
    for (const c of q.candidates) expect.set(c.id, (expect.get(c.id) ?? 0) + c.w / total)
  }
  const nRolls = allPicks.filter((q) => q.rolled).length
  for (const row of picks.out) {
    const n = Object.values(row.got).reduce((a2, b2) => a2 + b2, 0)
    const nPick = (row.picked ?? []).filter((q) => q.rolled).length
    const parts = Object.entries(row.got).map(([id, v]) => `${id} ${v}`)
    console.log(
      `    ${String(row.d).padStart(4)}m  휘두름 ${String(n).padStart(3)}회 · 그중 굴림 ${String(nPick).padStart(3)}회 — ${parts.join(' · ')}`,
    )
  }
  console.log(
    `    [합쳐서] 굴림 ${nRolls}회 · 광역 자리로 바뀐 것 ${swapped}회 · preferReach ${preferred}회`,
  )

  /**
   * ── 🔁 **같은 패턴이 연달아 나오는 비율** ────────────────────────────
   *
   * ── 왜 재는가 ────────────────────────────────────────────────────
   * `npm run pace` 가 오래 빨간 채였고, 그 프로브가 스스로 원인을 이렇게
   * 적어 뒀습니다 — *"폭의 원인이 여정이 아니라 **보스**입니다(패턴 선택)"*
   * (구간 시간이 판마다 **5.7배** 흔들립니다).
   *
   * 코드를 읽어 보니 이 게임의 보스에는 **직전에 낸 것에 대한 벌점이
   * 없습니다.** 매번 가중치로 새로 굴립니다. 그러면 같은 것이 연달아
   * 나올 확률이 **Σp²** 인데, 붙어 싸우는 거리의 후보가 셋(대략
   * 50/37/11%)이면 **약 40%**, 세 번 연속도 16% 입니다.
   *
   * 그게 왜 문제인가: 이 게임의 재미는 *"읽고 대응한다"* 인데, 같은 색이
   * 세 번 연속 나오면 읽을 것이 없고 반대로 셋이 골고루 오면 배운 것이
   * 전부 쓰입니다. 세키로·몬스터헌터·검은신화 오공의 보스가 **같은 기술을
   * 연달아 잘 안 내는** 이유가 이것입니다(엘든 링은 내되 사이를 벌립니다).
   *
   * ── 판정은 아직 안 겁니다 ────────────────────────────────────────
   * 여기서는 **실측과 «독립 굴림이라면 나왔을 값»을 나란히** 놓기만
   * 합니다. 「재기 전의 설명은 결론이 아니다」 — 벌점을 넣기 전에 지금
   * 값이 얼마인지부터 남깁니다. 기대치는 프로브가 따로 계산하지 않고
   * **게임이 적어 준 후보표**로 만듭니다(위 문단과 같은 이유).
   */
  {
    let pairs = 0
    let repeats = 0
    let expected = 0
    let longest = 0
    for (const row of picks.out) {
      const seq = (row.picked ?? []).filter((q) => q.chosen)
      let run = seq.length ? 1 : 0
      for (let i = 1; i < seq.length; i++) {
        pairs++
        if (seq[i].chosen === seq[i - 1].chosen) {
          repeats++
          run++
          if (run > longest) longest = run
        } else run = 1
        // 이 굴림의 후보표에서 «직전 것»이 다시 뽑힐 확률 = 독립 굴림의 기대치
        const total = seq[i].candidates.reduce((n, c) => n + c.w, 0)
        const prev = seq[i].candidates.find((c) => c.id === seq[i - 1].chosen)
        if (total > 0) expected += (prev?.w ?? 0) / total
      }
      if (run > longest) longest = run
    }
    const pct = (v) => `${Math.round((v / Math.max(1, pairs)) * 100)}%`
    console.log(
      `    [연달아 같은 것] ${repeats}/${pairs}쌍 = **${pct(repeats)}** · ` +
        `독립 굴림이라면 ${pct(expected)} · 가장 긴 연속 **${longest}회**`,
    )
    /**
     * ⚠️ **실측과 기대가 어긋나면 «줄 자체»를 폅니다.**
     *
     * 벌점(`REPEAT_PENALTY`)을 넣은 뒤 기대치는 33%→14% 로 내려갔는데
     * **실측은 26%→28% 로 안 내려갔습니다.** 이런 어긋남 앞에서 추측을
     * 시작하면(난수가 나쁜가·연계가 끼는가·다른 적이 섞이는가) 이 저장소가
     * 늘 헛짚었습니다. 그래서 **고른 순서를 그대로 찍습니다** — 어느 쌍이
     * 반복이고, 그 순간 표에 벌점이 실제로 들어 있었는지까지.
     */
    for (const row of picks.out) {
      const seq = (row.picked ?? []).filter((q) => q.chosen)
      if (!seq.length) continue
      const short = (id) => id.replace(/^boss_/, '')
      console.log(
        `      ${String(row.d).padStart(4)}m ${seq.map((q) => short(q.chosen)).join('→')}`,
      )
      // 반복한 쌍마다: 그 굴림의 표에서 «직전 것»이 몇이었나(벌점이 들어갔나)
      const marks = []
      for (let i = 1; i < seq.length; i++) {
        if (seq[i].chosen !== seq[i - 1].chosen) continue
        const c = seq[i].candidates.find((q) => q.id === seq[i - 1].chosen)
        const tot = seq[i].candidates.reduce((n, q) => n + q.w, 0)
        marks.push(`${short(seq[i].chosen)} w${c ? c.w.toFixed(2) : '?'}/${tot.toFixed(2)}`)
      }
      if (marks.length) console.log(`           반복 자리 — ${marks.join(' · ')}`)
    }
  }
  let worstGap = 0
  let worstLine = ''
  const summary = []
  for (const [id, e] of [...expect].sort((a, b) => b[1] - a[1])) {
    const o = rolls.get(id) ?? 0
    const gap = nRolls > 0 ? Math.abs(o - e) / nRolls : 0
    if (gap > worstGap) {
      worstGap = gap
      worstLine = `${id} — 기대 ${((e / nRolls) * 100).toFixed(0)}% 실제 ${((o / nRolls) * 100).toFixed(0)}%`
    }
    summary.push(`${id} ${((o / nRolls) * 100).toFixed(0)}%(기대 ${((e / nRolls) * 100).toFixed(0)}%)`)
  }
  console.log(`    ${summary.join(' · ')}`)
  /**
   * **표본이 문턱에 어울리는 크기인가.**
   *
   * 원래 이 게이트는 `>= 3` 이었습니다. 3회 표본에서 25%p 문턱은 아무
   * 뜻이 없습니다 — 한 번이 통째로 33%p 이기 때문입니다. 게이트와 문턱이
   * **서로 다른 세계에서 온 숫자**였고, 그래서 아래 검사가 흔들렸습니다.
   *
   * 16 은 계산해서 나온 값입니다: 확률 p 의 비율은 표본 n 에서 표준편차가
   * `sqrt(p(1-p)/n)` 입니다. 가장 흔들리는 p=0.5 에서 0.25 가 **2σ** 가
   * 되려면 `2·sqrt(0.25/n) = 0.25` → **n = 16**. 거리 셋을 합쳐서 보므로
   * 48 을 요구합니다. 이 게이트를 통과한 표본에서만 아래 문턱이
   * *"운이 아니라 규칙"* 을 뜻합니다.
   *
   * ⚠️ 세는 대상이 **휘두름에서 굴림으로** 바뀐 것이 이 라운드의 핵심입니다.
   *    휘두름에는 굴린 적 없는 연계가 섞여 있어서, 아무리 표본을 늘려도
   *    가중치와는 영영 안 맞습니다. 표본 수보다 **무엇을 세는가**가 먼저입니다.
   */
  const MIN_ROLLS = 48
  check(
    nRolls >= MIN_ROLLS,
    `문턱에 어울릴 만큼 굴렸다 (${MIN_ROLLS}회 이상 — 아래 25%p 가 2σ 가 되는 크기)`,
    `굴림 ${nRolls}회`,
  )
  /**
   * **가중치대로 고르는가.** 문턱 0.25 는 관대한 편입니다 — 굴림이라
   * 표본 50~60 회에서 ±10%p 는 흔들립니다. 그보다 크게 벌어지면 그건
   * 운이 아니라 **규칙이 다른 것**입니다.
   *
   * ⚠️ 예전 주석은 *"표본 20~40회"* 라고 적어 두고 잡은 문턱인데, 실제로는
   *    거리마다 7~8회만 모으고 있었습니다. 관측을 26 → 70초로 늘리고
   *    위에 게이트를 세워 **다시는 조용히 작아지지 못하게** 했습니다.
   *    표본이 모자라면 이 검사가 통과하기 전에 게이트가 먼저 빨개집니다.
   */
  check(
    worstGap <= 0.25,
    '**가중치대로 고른다** (적어 둔 성격이 실제로 나온다)',
    worstGap > 0.25 ? `가장 크게 어긋난 곳 — ${worstLine}` : `가장 큰 어긋남 ${(worstGap * 100).toFixed(0)}%p`,
  )

  /**
   * ── ⏳ **같은 패턴이 두 가지 박자로 나오는가** ────────────────────
   *
   * 지금까지 모든 공격의 예고 길이가 **정확히 하나**였습니다. 그러면
   * 패턴마다 정답이 하나가 아니라 **박자가 하나**이고, 한 번 외우면
   * 화면을 안 봐도 됩니다. 엘든 링·세키로·오공이 공통으로 깨는 자리입니다.
   *
   * ⚠️ 검사할 것이 둘입니다. 하나만 보면 반쪽입니다:
   *   ① 실제로 **두 박자가 나오는가** (안 나오면 지연은 죽은 설정)
   *   ② **짧은 쪽이 여전히 읽을 수 있는가** (예고가 짧아지면 그건
   *      난이도가 아니라 거짓말입니다 — 늘리기만 해야 합니다)
   */
  {
    const seen = await page.evaluate(async () => {
      const G = window.__game
      const sleep2 = () => new Promise((r) => setTimeout(r, 8))
      G.clearEnemies()
      await window.__t.runFor(0.3)
      const p = G.state().player
      const b = G.spawnBoss(p.x + 4, p.z)
      /**
       * ⚠️ **깨우고, 나를 무적으로 두고, 붙잡아 둡니다.**
       * 이 파일이 이미 두 번 배운 자리입니다 — 안 깨우면 관측 0회이고,
       * 죽으면 조우가 끝나 그 뒤가 통째로 빈 관측이 됩니다. 처음에
       * 그냥 `reset()` 만 하고 쟀다가 90초에 **4회**밖에 못 봤습니다.
       */
      G.wakeEnemy(b)
      G.setPlayerInvulnerable(true)
      await window.__t.runFor(0.4)
      const lens = []
      const t0 = G.state().elapsed
      /**
       * ⚠️ **예고가 시작되는 그 순간(false→true)만 셉니다.**
       *
       * 처음엔 `intent:windup` 조합이 바뀔 때 적었습니다. 그러면 같은
       * 패턴이 **같은 박자로 연달아** 나올 때 한 번만 세어져서, 60초에
       * 4회밖에 안 잡혔습니다. 하필 그건 *"뜸을 안 들인 경우"* 를 골라
       * 지우는 쪽이라, 검사가 재려던 것과 정반대로 편향됩니다.
       * 상태의 **전이**를 세야지 값을 세면 안 됩니다.
       */
      let wasWinding = false
      while (G.state().elapsed - t0 < 90) {
        const i = G.enemyInfo(b)
        if (i) {
          if (i.winding && !wasWinding) {
            lens.push({ intent: i.intent, windup: i.windup, held: i.held })
          }
          wasWinding = !!i.winding

        }
        await sleep2()
      }
      return lens
    })
    const rows = seen
    const swings = rows.length
    check(swings >= 10, '⏳ 예고를 충분히 봤다 (확률 0.35 를 볼 만큼)', `${swings}회`)
    if (swings >= 10) {
      const held = rows.filter((r) => r.held > 0)
      const plain = rows.filter((r) => r.held === 0)
      check(
        held.length > 0 && plain.length > 0,
        '⏳ **같은 보스가 두 가지 박자로 휘두른다** (리듬으로 구르기가 안 통하게)',
        `뜸 들인 것 ${held.length}회 · 평소 ${plain.length}회`,
      )
      /**
       * 짝이 되는 음성 검사. 지연은 **더하기만** 해야 합니다 — 빼기 시작하면
       * 반응 시간 하한이 무너지고, 맞은 이유가 `예고가 짧음` 으로 찍힙니다.
       */
      const minPlain = plain.length ? Math.min(...plain.map((r) => r.windup)) : -1
      const minHeld = held.length ? Math.min(...held.map((r) => r.windup)) : -1
      check(
        held.length === 0 || plain.length === 0 || minHeld > minPlain,
        '⏳ 뜸은 **늘리기만 한다** (예고가 짧아지면 난이도가 아니라 거짓말입니다)',
        `평소 최소 ${minPlain}초 · 뜸 최소 ${minHeld}초`,
      )
    }
  }

  /**
   * ── ⏳ **뜸 들인 공격도 처음부터 보이는가** ───────────────────────
   *
   * 지연을 넣으면서 화면 쪽을 안 봤습니다. 예고의 차오름이
   * `1 - 남은시간 / **설정** 예고` 로 계산되고 있었는데, 뜸을 들이면
   * 분자가 분모보다 커져 `p` 가 **음수**로 시작합니다. 투명도가 0 아래로
   * 눌리므로 뜸 들인 공격은 처음 0.35초 동안 **아예 안 보입니다.**
   *
   * 예고가 늦게 뜨는 것은 난이도가 아니라 거짓말이고, 맞은 이유가
   * `못 봄` 으로 찍혀야 할 자리입니다. 그래서 **뜬 순간의 투명도**를
   * 직접 봅니다 — 규칙이 아니라 화면에 실제로 그려진 값입니다.
   */
  {
    const seen = await page.evaluate(async () => {
      const G = window.__game
      const sleep2 = () => new Promise((r) => setTimeout(r, 8))
      G.clearEnemies()
      await window.__t.runFor(0.3)
      const p = G.state().player
      const b = G.spawnBoss(p.x + 4, p.z)
      G.wakeEnemy(b)
      G.setPlayerInvulnerable(true)
      await window.__t.runFor(0.4)
      const rows = []
      let wasWinding = false
      const t0 = G.state().elapsed
      while (G.state().elapsed - t0 < 90) {
        const tg = G.telegraphs().find((t) => t.entity === b)
        if (tg && !wasWinding) {
          // 뜬 **첫 프레임**의 투명도. 여기가 0 이면 화면에 아무것도 없습니다.
          rows.push({ opacity: tg.opacity, held: tg.held, windup: tg.windup })
        }
        wasWinding = !!tg
        await sleep2()
      }
      return rows
    })
    const held = seen.filter((r) => r.held > 0)
    const plain = seen.filter((r) => r.held === 0)
    check(
      seen.length >= 10 && held.length > 0,
      '⏳ 예고가 뜬 첫 순간을 충분히 봤다 (뜸 들인 것 포함)',
      `${seen.length}회 · 그중 뜸 ${held.length}회`,
    )
    if (held.length > 0) {
      const worst = Math.min(...seen.map((r) => r.opacity))
      check(
        worst > 0.05,
        '⏳ **뜸 들인 공격도 뜨는 순간부터 보인다** (안 보이는 예고는 난이도가 아니라 거짓말)',
        `가장 흐렸던 첫 프레임 ${worst} (평소 ${plain.length}회 · 뜸 ${held.length}회)`,
      )
    }
  }

  /**
   * ── 🛡 **뒤 구간의 보스는 정말 덜 아파하는가** ───────────────────
   *
   * ── 왜 이 손잡이를 달았는가 (숫자가 먼저 있었습니다) ──────────────
   * `npm run bench` 3판 가운데값이 이렇게 나왔습니다:
   *
   *     1단계 7.6초 · 실효 화력 20.6/초
   *     2단계 5.4초 · 실효 화력 55.0/초
   *     3단계 5.3초 · 실효 화력 73.5/초   ← 1단계의 **3.6배**
   *
   * 마지막 구간이 가장 길어야 한다는 `bossPhases.ts` 의 약속이 깨져
   * 있었고, 원인은 보스가 아니라 **플레이어**였습니다. 스킬 쿨다운·집중
   * 3점·출혈 누적이 전부 뒤로 갈수록 터지기 때문에, 체력을 아무리 뒤에
   * 몰아 줘도 그 이상으로 빨리 녹습니다. (실제로 체력을 두 번 올렸고
   * 두 번 다 실패했습니다 — 값이 아니라 **모양**이 문제였습니다.)
   *
   * 참고한 게임들이 같은 자리에서 쓰는 손잡이:
   *   · 엘든 링·로스트아크 — 뒤 페이즈에서 **받는 피해를 줄입니다**
   *   · 세키로 — 체간 회복을 느리게 해 *"쌓아 둔 것"* 의 값을 깎습니다
   * 공통 원리: 플레이어가 쌓아 온 화력을 **구간이 되받아쳐야** 합니다.
   *
   * ── 이 검사가 재는 것 ────────────────────────────────────────────
   * `damageTakenScale` 이 설정에 적혀 있는지가 아니라, **같은 공격이
   * 실제로 덜 깎는가**입니다. 이 저장소가 다섯 번 당한 고장이 전부
   * *"파생값은 맞는데 판정까지 도달하지 않았다"* 였습니다.
   * (규칙이 아니라 도달한 것을 봅니다.)
   *
   * ⚠️ 배수가 섞이지 않게: 얼려 두고(반격·완벽회피 차단), 정면에서 치고,
   *    강화 0단계로, 매 타격 전에 체력을 같은 값으로 되돌립니다.
   *    체력을 안 되돌리면 재는 도중에 페이즈가 넘어가 버립니다.
   */
  console.log('')
  {
    const taken = await page.evaluate(async () => {
      const G = window.__game
      const sleep2 = () => new Promise((r) => setTimeout(r, 8))
      const runFor = async (sec) => {
        const t = G.state().elapsed + sec
        while (G.state().elapsed < t) await sleep2()
      }
      /**
       * ⚠️ **1단계 학습 잠금을 반드시 꺼야 합니다.**
       *
       * 파일 맨 위에서 한 번 껐지만 6번 항목이 다시 켜 놓고 끝납니다.
       * 그대로 두고 재면 잠금이 매 프레임 보스 체력을 65%로 **되돌려 놔서**
       * 페이즈가 영영 0 입니다. 처음 돌렸을 때 실제로 `phase 0→0` 이 나왔고,
       * 그런데도 아래 비교는 **초록이었습니다**(62%로 줄었다고). 두 측정이
       * 사실은 둘 다 1단계였고 콤보 단계·치명타 차이를 배율로 읽은 것입니다.
       * 위의 게이트 한 줄이 없었으면 그 거짓말을 그대로 믿었을 것입니다.
       */
      G.setPhaseTeaching(false)
      G.reset()
      await runFor(0.4)
      G.setPhaseTeaching(false) // reset 이 상태를 되돌릴 수 있으니 뒤에서 한 번 더.
      G.clearEnemies()
      await runFor(0.3)
      const p = G.state().player
      const b = G.spawnBoss(p.x + 5, p.z)
      G.wakeEnemy(b)
      await runFor(0.4)
      const max = G.enemyInfo(b).max

      /**
       * 한 페이즈에서 **같은 평타를 N번** 때리고 깎인 총량을 돌려줍니다.
       * 한 대만 재면 치명타 한 번에 판정이 뒤집힙니다 — 여러 대의 합으로
       * 봐야 우연이 씻깁니다.
       */
      const swings = async (n) => {
        let total = 0
        let landed = 0
        for (let i = 0; i < n; i++) {
          // 매번 같은 조건: 붙어 서서, 정면에서, 기력 가득, 체력 되돌림.
          const bi = G.enemyInfo(b)
          G.teleportPlayer(bi.x - 1.2, bi.z)
          G.aimAtWorld(bi.x, bi.z)
          G.setStamina(1000)
          G.setHp(b, max)
          await runFor(0.15)
          const before = G.enemyInfo(b).hp
          const hits0 = G.state().hitsDealt
          G.press('Mouse0')
          await new Promise((r) => setTimeout(r, 30))
          G.release('Mouse0')
          const t0 = G.state().elapsed
          while (G.state().elapsed - t0 < 1.2 && G.state().hitsDealt === hits0) await sleep2()
          await runFor(0.25)
          const dealt = before - G.enemyInfo(b).hp
          if (dealt > 0) {
            total += dealt
            landed++
          }
        }
        return { total, landed }
      }

      // ── 1단계 ── 얼려 두고 잽니다(맞으면 반격·완벽회피 배수가 섞입니다).
      G.freezeEnemies(true)
      G.setPlayerInvulnerable(true)
      const one = await swings(10)
      const phase1 = G.enemyInfo(b).phase

      /**
       * ── 3단계로 ── **AI 를 잠깐 풀어 줘야 합니다.**
       * 페이즈를 올리는 코드가 `enemyAiSystem` 안에 있어서, 얼린 채로
       * 체력만 깎으면 phase 가 영영 0 입니다. (이걸 모르고 짰다가
       * "배율이 안 걸린다"는 가짜 실패를 볼 뻔했습니다.)
       */
      G.freezeEnemies(false)
      G.setHp(b, max)
      G.damageEntity(b, max * 0.75)
      await window.__t.until(() => G.enemyInfo(b)?.phase >= 2, 6)
      await window.__t.until(
        () => G.enemyInfo(b)?.phase >= 2 && G.enemyInfo(b)?.transitionT === 0,
        6,
      )
      const phase3 = G.enemyInfo(b).phase
      G.freezeEnemies(true)
      const three = await swings(10)

      G.setPlayerInvulnerable(false)
      G.freezeEnemies(false)
      return { one, three, phase1, phase3 }
    })

    const want = await page.evaluate(() =>
      window.__game.bossTuning().map((p) => p.damageTakenScale ?? 1),
    )
    const a = taken.one.total
    const c = taken.three.total
    const ratio = a > 0 ? c / a : -1
    /**
     * **게이트** — 두 측정이 정말 서로 다른 페이즈였는가, 그리고 때린
     * 횟수가 같은가. 이게 아니면 아래 비율은 아무 뜻이 없습니다.
     */
    const gate =
      taken.phase1 === 0 && taken.phase3 === 2 && taken.one.landed >= 8 && taken.three.landed >= 8
    check(
      gate,
      '🛡 1단계·3단계에서 **같은 수만큼** 때렸다 (비교의 게이트)',
      `1단계 ${taken.one.landed}/10타 · 3단계 ${taken.three.landed}/10타 (phase ${taken.phase1}→${taken.phase3})`,
    )
    /**
     * ⚠️ **게이트를 조건에 넣습니다.** 처음엔 두 검사를 따로 뒀는데,
     *    게이트가 빨간데 비교는 초록으로 떴습니다. 게이트가 **막지 않으면**
     *    게이트가 아니라 그냥 옆에 적힌 메모입니다.
     *
     * 문턱을 설정값에 딱 맞추지 않습니다. 치명타·콤보 단계가 섞여 있어
     * 열 대의 합이라도 흔들립니다. 재려는 것은 *"배율이 정확히 0.7인가"* 가
     * 아니라 **"뒤 구간이 실제로 단단해졌는가"** 입니다. 배율을 그대로
     * 베껴 적으면 그 순간 프로브가 두 번째 진실이 됩니다.
     */
    const wantRatio = (want[2] ?? 1) / (want[0] ?? 1)
    check(
      gate && ratio > 0 && ratio < 0.9,
      '🛡 **3단계 보스는 같은 평타를 덜 아파한다** (설정이 아니라 줄어든 체력으로 확인)',
      `1단계 ${a.toFixed(1)} → 3단계 ${c.toFixed(1)} (${(ratio * 100).toFixed(0)}%, 설정상 ${(wantRatio * 100).toFixed(0)}%)` +
        (gate ? '' : ' ⚠️ 게이트가 빨개서 비교는 성립하지 않았습니다'),
    )
  }

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
