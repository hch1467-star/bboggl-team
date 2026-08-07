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

  // 페이지 안에서 쓸 공용 헬퍼를 심어 둡니다.
  await page.evaluate(() => {
    // 시뮬레이션 시간으로 기다립니다 — 벽시계가 아니라.
    window.__t = {
      runFor: async (seconds) => {
        const target = window.__game.state().elapsed + seconds
        const deadline = Date.now() + 90000
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

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
