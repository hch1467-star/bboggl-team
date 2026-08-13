/**
 * 보스 연계 검증 — `npm run chain`
 *
 * ── 왜 이 프로브가 생겼는가 ──────────────────────────────────────
 * 보스 2·3페이즈의 **연계**(🔵 속박 → 🔴 직격 / 🟣 갈고리 → 🔴 직격 /
 * 🔵 속박 → 🟡 광역)는 이 존 전투 설계의 마지막 층입니다. *"이미 아는 색
 * 둘을 붙여, 새 규칙을 외우게 하지 않으면서 난이도만 올린다"* 는 것이
 * 설계 의도였습니다(bossPhases.ts).
 *
 * 그런데 자동 플레이를 **여덟 판** 돌리는 동안 연계는 **한 번도** 관측되지
 * 않았습니다. 원인을 두 라운드에 걸쳐 좁혔습니다:
 *   · 보스가 조준을 못 맞춰 공격 자체를 거의 못 함  → 고침(인내심 조준)
 *   · 거리가 안 맞아 🔵🟣가 안 나옴                → 고침(접근 패턴 우선)
 *   · 3페이즈가 **1.9초**라 창이 없음               → 고침(체력·경계 재배분)
 *
 * 셋을 다 고쳐도 여전히 0회입니다. 여기서부터는 **플레이로는 확인할 수
 * 없습니다** — 확률이 낮은 사건을 기다리는 것과, 기능이 고장 난 것을
 * 구분할 방법이 없기 때문입니다.
 *
 * 그래서 연계만 따로 세워 놓고 잽니다. 이 프로브가 통과하면 "연계는
 * 작동하는데 드물게 나온다"가 되고, 실패하면 "연계는 애초에 안 나간다"가
 * 됩니다. **둘은 완전히 다른 문제**이고, 지금까지 그걸 못 갈랐습니다.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────
 *   1) 페이즈마다 **연계가 실제로 걸리는가** (예고 중에 다음 패턴이 예약되나)
 *   2) 예약된 연계가 **실제로 이어서 나가는가** (쿨다운을 건너뛰고)
 *   3) 연계로 나온 공격도 **예고를 그대로 다 보여주는가**
 *      — bossPhases.ts 의 "예고는 줄이지 않는다" 원칙이 지켜지는지
 *   4) 1페이즈에는 연계가 **없는가** (난이도가 실제로 올라가는지)
 *
 * ⚠️ 연계 표를 여기 베껴 적지 않습니다. `bossTuning().chains` 로 읽습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5211
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
  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  /**
   * ⚠️ 이 프로브는 체력을 강제로 깎아 2·3단계로 넘겨 **연계**를 잽니다.
   *    1단계 학습 잠금(enemyAI `taughtInPhase1`)이 켜져 있으면 그 전환이
   *    막혀서 연계 검사 아홉 개가 통째로 빨개집니다 — 연계는 멀쩡한데요.
   *    잠금 자체는 `npm run boss` 의 마지막 절이 켠 채로 잽니다.
   */
  await page.evaluate(() => window.__game.setPhaseTeaching(false))

  await page.evaluate(() => {
    window.__t = {
      runFor: async (seconds) => {
        const target = window.__game.state().simElapsed + seconds
        const deadline = Date.now() + 120000
        while (window.__game.state().simElapsed < target && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 8))
        }
      },
      until: async (fn, limit) => {
        const target = window.__game.state().simElapsed + limit
        const deadline = Date.now() + 120000
        while (Date.now() < deadline && window.__game.state().simElapsed < target) {
          if (fn()) return true
          await new Promise((r) => setTimeout(r, 8))
        }
        return fn()
      },
      /**
       * 보스를 **원하는 페이즈**에 세우고, 방아쇠가 되는 색을 강제로 겁니다.
       * 그리고 그 공격이 끝난 뒤 무엇이 이어 나오는지 봅니다.
       *
       * 보스를 얼리지 않는 이유: 연계는 AI가 후딜 끝에서 거는 것이라,
       * 얼려 두면 **연계 자체가 안 돌아갑니다.** 대신 플레이어를 멀리 세워
       * 두어 다른 판단이 끼어들지 않게 합니다.
       */
      chainTrial: async (phaseIdx, triggerId) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.3)
        const b = G.spawnBoss(6, 0)
        await window.__t.runFor(0.3)
        const tuning = G.bossTuning()
        const roster = G.enemyRoster().find((r) => r.id === 'boss')
        const maxHp = roster.maxHp
        // 그 페이즈에 **확실히** 들어가는 체력으로 맞춥니다.
        // (경계 바로 아래가 아니라 구간 한가운데 — 한 대 맞고 넘어가지 않게)
        const upper = tuning[phaseIdx].enterBelow
        const lower = phaseIdx + 1 < tuning.length ? tuning[phaseIdx + 1].enterBelow : 0
        G.setHp(b, maxHp * ((upper + lower) / 2))
        await window.__t.runFor(0.4)
        const idx = roster.attacks.findIndex((a) => a.id === triggerId)
        G.forceAttack(b, idx)
        await window.__t.runFor(0.05)
        const armed = G.enemyInfo(b)
        // 방아쇠 공격이 끝나고 다음 공격이 시작될 때까지 기다립니다.
        await window.__t.until(() => G.enemyInfo(b)?.attackId !== triggerId, 4)
        const after = G.enemyInfo(b)
        // 이어진 공격의 **예고 시간**을 잽니다(줄이지 않았는지 확인).
        const windup = after?.winding ? after.timer : 0
        /**
         * 예고가 **끝까지 가서 실제로 휘두를 때까지** 기다립니다.
         *
         * 원래는 여기서 바로 다음 시험으로 넘어갔습니다. 그런데 보고서용
         * 눈금(`bossSwingLog`)은 **판정 단계(Active)에 들어간 순간**에만
         * 올라갑니다. 예고 중에 `reset()` 해 버리면 연계가 분명히 걸렸는데도
         * 로그에는 아무것도 안 남습니다 — 프로브가 자기 손으로 증거를
         * 지우고 있었던 셈입니다.
         */
        await window.__t.until(() => G.enemyInfo(b)?.attackPhase !== 0, 3)
        return {
          phase: armed?.phase ?? -1,
          armedChain: armed?.chainNext ?? '',
          nextId: after?.attackId ?? '',
          nextWinding: after?.winding ?? false,
          windupLeft: windup,
          expectedWindup:
            tuning[phaseIdx].windups.find((w) => w.id === (after?.attackId ?? ''))?.seconds ?? 0,
        }
      },
    }
  })

  console.log('\n⛓️ 보스 연계 검증\n')

  const tuning = await page.evaluate(() => window.__game.bossTuning())
  for (let i = 0; i < tuning.length; i++) {
    const list = Object.entries(tuning[i].chains)
    console.log(
      `  [${tuning[i].name}] 연계 ${list.length}개 — ` +
        (list.length ? list.map(([a, b]) => `${a}→${b}`).join(' · ') : '없음'),
    )
  }
  console.log('')

  // ---- 1. 1페이즈에는 연계가 없다 ----
  //
  // 난이도가 **올라간다**는 말이 성립하려면 시작점이 낮아야 합니다.
  check(
    Object.keys(tuning[0].chains).length === 0,
    '1페이즈에는 연계가 없다 (배우는 구간)',
    `${Object.keys(tuning[0].chains).length}개`,
  )

  // ---- 2. 2·3페이즈의 연계가 실제로 이어진다 ----
  let tested = 0
  for (let phaseIdx = 1; phaseIdx < tuning.length; phaseIdx++) {
    for (const [trigger, expected] of Object.entries(tuning[phaseIdx].chains)) {
      const r = await page.evaluate(
        ([p, t]) => window.__t.chainTrial(p, t),
        [phaseIdx, trigger],
      )
      tested++
      check(
        r.phase === phaseIdx,
        `${tuning[phaseIdx].name}: 보스가 그 페이즈에 서 있다`,
        `페이즈 ${r.phase}`,
      )
      check(
        r.armedChain === expected,
        `${tuning[phaseIdx].name}: ${trigger} 예고 중에 ${expected} 가 예약된다`,
        `예약 "${r.armedChain}"`,
      )
      check(
        r.nextId === expected,
        `${tuning[phaseIdx].name}: ${trigger} 뒤에 실제로 ${expected} 가 이어진다`,
        `이어진 것 "${r.nextId}"`,
      )
      /**
       * **예고는 줄이지 않습니다.**
       *
       * 연계가 없애는 것은 "쉬는 시간"이지 "읽을 시간"이 아닙니다
       * (bossPhases.ts 설계 원칙). 이게 깨지면 연계는 난이도가 아니라
       * **불공정**이 됩니다 — DESIGN.md 의 판단 기준 그대로,
       * "내가 못 봤네"가 나오면 안 됩니다.
       */
      if (r.nextId === expected) {
        check(
          r.nextWinding && r.windupLeft > r.expectedWindup * 0.5,
          `${tuning[phaseIdx].name}: 이어진 ${expected} 도 예고를 다 보여준다`,
          `남은 예고 ${r.windupLeft.toFixed(2)}초 / 정상 ${r.expectedWindup.toFixed(2)}초`,
        )
      }
    }
  }
  check(tested >= 3, '연계를 최소 3개 시험했다', `${tested}개`)

  /**
   * ---- 3. **잡몹도** 연계한다 ----
   *
   * 지금까지 연계는 보스에만 있었습니다. 그러면 잡몹 구간에서 배우는 것이
   * *"휘두르고 나면 후딜은 공짜"* 인데, 보스에서 그게 거짓이 됩니다 —
   * 가르치는 순서가 거꾸로입니다(enemies.ts chains 설계 노트).
   *
   * ⚠️ 엘든 링에서 배운 **금지선**도 같이 겁니다. 그 게임의 지연 공격
   *    비판은 "반응이 아니라 암기를 요구한다"였습니다. 그러니 이어지는
   *    두 번째도 **예고를 통째로 보여줘야** 합니다. 예고를 줄이는 순간
   *    이건 난이도가 아니라 기억력 시험이 됩니다.
   */
  const grunt = await page.evaluate(async () => {
    const G = window.__game
    G.reset()
    await window.__t.runFor(0.4)
    G.clearEnemies()
    await window.__t.runFor(0.3)
    const e = G.spawnEnemyKind('grunt', 6, 0)
    await window.__t.runFor(0.3)
    G.setHp(e, 100000) // 시험 도중 죽으면 연계를 못 봅니다
    const roster = G.enemyRoster().find((r) => r.id === 'grunt')
    const trigger = 'grunt_jab'
    const idx = roster.attacks.findIndex((a) => a.id === trigger)
    if (idx < 0) return { ok: false, why: 'grunt_jab 을 못 찾음' }
    G.forceAttack(e, idx)
    await window.__t.runFor(0.05)
    const armed = G.enemyInfo(e)
    await window.__t.until(() => G.enemyInfo(e)?.attackPhase !== 0, 3)
    // 첫 타가 끝나고 두 번째가 시작되기를 기다립니다.
    await window.__t.until(() => G.enemyInfo(e)?.winding === true, 4)
    const second = G.enemyInfo(e)
    const full = roster.attacks.find((a) => a.id === (second?.attackId ?? ''))?.windup ?? 0
    /**
     * **세 번째는 없어야 합니다.** 자기 자신으로 잇는 연계라, 연계가 또
     * 연계를 걸면 적이 끝없이 휘두릅니다(enemyAI commitAttack 설계 노트).
     */
    const thirdArmed = second?.chainNext ?? ''
    return {
      ok: true,
      armed: armed?.chainNext ?? '',
      secondId: second?.attackId ?? '',
      secondWinding: second?.winding ?? false,
      windupLeft: second?.timer ?? 0,
      fullWindup: full,
      thirdArmed,
    }
  })
  check(
    grunt.ok && grunt.armed === 'grunt_jab',
    '잡몹 🔴 뒤에 🔴 이 예약된다 (잡몹이 보스의 문법을 미리 가르친다)',
    grunt.ok ? `예약 "${grunt.armed}"` : grunt.why,
  )
  check(
    grunt.ok && grunt.secondId === 'grunt_jab' && grunt.secondWinding,
    '그 연계가 실제로 이어진다',
    `이어진 것 "${grunt.secondId}"`,
  )
  check(
    grunt.ok && grunt.fullWindup > 0 && grunt.windupLeft >= grunt.fullWindup - 0.12,
    '⚠️ 이어진 타도 예고를 **다 보여준다** (암기가 아니라 반응으로 풀리게)',
    `남은 예고 ${grunt.windupLeft?.toFixed(2)}초 / 정상 ${grunt.fullWindup}초`,
  )
  check(
    grunt.ok && grunt.thirdArmed === '',
    '⚠️ 세 번째는 없다 (연계가 또 연계를 걸면 끝없이 휘두릅니다)',
    grunt.thirdArmed ? `세 번째로 "${grunt.thirdArmed}" 가 예약됨` : '없음',
  )

  /**
   * ── 계기가 실제로 세는가 ────────────────────────────────────────
   *
   * 위의 검사는 전부 `enemyInfo()` 로 봅니다. 그런데 **자동 플레이 보고서**는
   * 다른 눈금(`bossSwingLog().chained`)을 씁니다. 그 눈금은 만들어만 놓고
   * **한 번도 올리지 않아서**, 판마다 "연계 0회"를 찍고 있었습니다.
   * 그 상수 0을 관측으로 믿고 세 라운드를 썼습니다.
   *
   * 그래서 여기서 **보고서가 보는 그 눈금을** 직접 확인합니다.
   * 위가 다 통과해도 이게 0이면, 게임이 아니라 계기가 고장 난 것입니다.
   */
  const swingLog = await page.evaluate(() => window.__game.bossSwingLog())
  const chainedTotal = Object.values(swingLog).reduce((a, v) => a + (v.chained ?? 0), 0)
  check(
    chainedTotal >= tested,
    '보고서가 쓰는 눈금(bossSwingLog.chained)도 연계를 센다',
    `${chainedTotal}회 / 시험 ${tested}회`,
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
