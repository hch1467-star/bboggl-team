/**
 * 강인도(포이즈) 검증 — `npm run poise`
 *
 * ── 이 프로브가 던지는 질문 ────────────────────────────────────────
 * **"계속 때리기만 하면 이기는가?"**
 *
 * 4색 예고는 이 게임의 중심 설계입니다. 그런데 매 타격마다 적이 무조건
 * 경직된다면, 플레이어는 예고를 읽을 필요 없이 **먼저 때리기만 하면**
 * 됩니다. 적이 예고를 시작조차 못 하니까요. 그러면 색도, 트라이포드도,
 * 공격 토큰도 전부 장식이 됩니다.
 *
 * 그래서 **적이 실제로 예고를 몇 번 띄웠는지**를 셉니다.
 *   · 플레이어가 가만히 있을 때  = 기준선
 *   · 플레이어가 계속 때릴 때    = 실제
 * 둘의 비율이 곧 "때리기만 해서 얼마나 봉쇄되는가"입니다.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5189
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

  await page.evaluate(() => {
    window.__t = {
      runFor: async (seconds) => {
        const target = window.__game.state().elapsed + seconds
        const deadline = Date.now() + 120000
        while (window.__game.state().elapsed < target && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 8))
        }
      },
      /**
       * 적 하나를 세워 놓고 정해진 **시뮬레이션 시간** 동안 관찰합니다.
       * @param spam true 면 플레이어가 쉬지 않고 공격합니다.
       */
      observe: async (kindId, seconds, spam) => {
        window.__game.reset()
        await window.__t.runFor(0.5)
        window.__game.clearEnemies()
        await window.__t.runFor(0.2)
        const p = window.__game.state().player
        // 사거리 안쪽에 붙여 놓습니다 — 접근하는 시간을 관측에서 빼기 위해서.
        const e = window.__game.spawnEnemyKind(kindId, p.x + 1.9, p.z)
        window.__game.aimAtWorld(p.x + 1.9, p.z)
        /**
         * ⚠️ **깨워 놓고 잽니다.** 적은 이제 방향으로 알아채기 때문에
         *    (balance.ts `AWARE`), 등을 보인 채 낳으면 가만히 선 플레이어를
         *    영영 못 봅니다 — "가만히 두면 잡몹이 공격을 성사시킴(기준선)"이
         *    실제로 **0회**로 죽었습니다. 이 프로브가 묻는 것은 *"강인도가
         *    적을 봉쇄하는가"* 이지 *"적이 나를 알아채는가"* 가 아닙니다.
         */
        window.__game.wakeEnemy(e)
        // 적이 죽지 않아야 관측이 끝까지 갑니다. 체력을 크게 올려 둡니다.
        window.__game.setHp(e, 100000)
        await window.__t.runFor(0.3)

        /**
         * **"예고를 시작한 횟수"가 아니라 "공격이 실제로 나간 횟수"를 셉니다.**
         *
         * 처음엔 예고 시작을 셌는데, 측정이 가설을 반증했습니다 —
         * 계속 때릴 때 예고가 오히려 **늘었습니다**(잡몹 6→11회).
         * 경직이 공격을 끊고 Idle 로 되돌리니 적이 예고를 다시 시작하고,
         * 그 재시작이 새 예고로 세어졌던 것입니다.
         *
         * 우리가 알고 싶은 건 "적이 반격할 수 있는가"이므로,
         * 판정(Active)까지 **도달한** 공격만 세는 것이 맞습니다.
         */
        let swings = 0
        let wasActive = false
        let telegraphs = 0
        let wasWindup = false
        let staggerFrames = 0
        let frames = 0
        const target = window.__game.state().elapsed + seconds
        while (window.__game.state().elapsed < target) {
          if (spam) {
            window.__game.press('Mouse0')
            window.__game.release('Mouse0')
          }
          const info = window.__game.enemyInfo(e)
          if (!info) break
          const winding = info.attacking && info.attackPhase === 0
          if (winding && !wasWindup) telegraphs++
          wasWindup = winding
          const active = info.attacking && info.attackPhase === 1
          if (active && !wasActive) swings++
          wasActive = active
          if (info.staggered) staggerFrames++
          frames++
          await new Promise((r) => setTimeout(r, 8))
        }
        window.__game.clearEnemies()
        return { telegraphs, swings, staggerRatio: frames ? staggerFrames / frames : 0 }
      },
    }
  })

  console.log('\n🛡  강인도(포이즈) 검증\n')

  const WINDOW = 14

  // ---- 1. 때리기만 해서 적을 봉쇄할 수 있는가 ----
  const grunt = await page.evaluate(
    async (w) => ({
      idle: await window.__t.observe('grunt', w, false),
      spam: await window.__t.observe('grunt', w, true),
    }),
    WINDOW,
  )
  console.log(
    `  [잡몹 ${WINDOW}초] 가만히: 예고 ${grunt.idle.telegraphs}회 / 실제 공격 ${grunt.idle.swings}회 · ` +
      `계속 때릴 때: 예고 ${grunt.spam.telegraphs}회 / 실제 공격 ${grunt.spam.swings}회 ` +
      `(경직 ${(grunt.spam.staggerRatio * 100).toFixed(0)}%)`,
  )
  // 절반 이상 남아야 "예고를 읽는 게임"이 유지됩니다.
  // 0에 가까우면 4색 설계 전체가 장식이 됩니다.
  check(
    grunt.idle.swings > 0,
    '가만히 두면 잡몹이 공격을 성사시킴 (기준선)',
    `${grunt.idle.swings}회`,
  )
  check(
    grunt.spam.swings >= Math.ceil(grunt.idle.swings * 0.4),
    '계속 때려도 잡몹이 반격함 (봉쇄 불가)',
    `${grunt.idle.swings}회 → ${grunt.spam.swings}회`,
  )

  // ---- 2. 보스는 더 단단해야 합니다 ----
  console.log('')
  const boss = await page.evaluate(
    async (w) => ({
      idle: await window.__t.observe('boss', w, false),
      spam: await window.__t.observe('boss', w, true),
    }),
    WINDOW,
  )
  console.log(
    `  [보스 ${WINDOW}초] 가만히: 예고 ${boss.idle.telegraphs}회 / 실제 공격 ${boss.idle.swings}회 · ` +
      `계속 때릴 때: 예고 ${boss.spam.telegraphs}회 / 실제 공격 ${boss.spam.swings}회 ` +
      `(경직 ${(boss.spam.staggerRatio * 100).toFixed(0)}%)`,
  )
  check(
    boss.spam.swings >= Math.ceil(boss.idle.swings * 0.6),
    '보스는 계속 때려도 거의 그대로 공격함',
    `${boss.idle.swings}회 → ${boss.spam.swings}회`,
  )
  check(
    boss.spam.staggerRatio < grunt.spam.staggerRatio,
    '보스가 잡몹보다 덜 경직됨 (강인도 차이)',
    `보스 ${(boss.spam.staggerRatio * 100).toFixed(0)}% vs 잡몹 ${(grunt.spam.staggerRatio * 100).toFixed(0)}%`,
  )

  // ---- 3. 무너뜨리는 것이 가능한가 (보상) ----
  //
  // 봉쇄를 막았다고 공격에 보상이 없으면 이번엔 "때릴 이유"가 사라집니다.
  // 강인도를 다 깎으면 **긴 무방비**가 와야 공격이 판단으로 남습니다.
  console.log('')
  const brk = await page.evaluate(async () => {
    window.__game.reset()
    await window.__t.runFor(0.5)
    window.__game.clearEnemies()
    await window.__t.runFor(0.2)
    const p = window.__game.state().player
    const e = window.__game.spawnEnemyKind('grunt', p.x + 1.9, p.z)
    window.__game.aimAtWorld(p.x + 1.9, p.z)
    window.__game.setHp(e, 100000)
    await window.__t.runFor(0.3)
    const info0 = window.__game.enemyInfo(e)

    let broke = false
    let longest = 0
    let cur = 0
    const target = window.__game.state().elapsed + 16
    while (window.__game.state().elapsed < target) {
      window.__game.press('Mouse0')
      window.__game.release('Mouse0')
      const info = window.__game.enemyInfo(e)
      if (!info) break
      if (info.broken) {
        broke = true
        cur += 1
        longest = Math.max(longest, cur)
      } else {
        cur = 0
      }
      await new Promise((r) => setTimeout(r, 8))
    }
    window.__game.clearEnemies()
    return { broke, longest, poiseMax: info0?.poiseMax ?? 0 }
  })
  check(brk.poiseMax > 0, '적에게 강인도 수치가 있음', `${brk.poiseMax}`)
  check(brk.broke, '계속 때리면 결국 무너짐 (공격의 보상)', `무방비 ${brk.longest}프레임`)

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
