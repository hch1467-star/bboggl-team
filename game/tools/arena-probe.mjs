/**
 * 보스 조우 검증 — `npm run arena`
 *
 * ── 무엇을 확인하는가 ──────────────────────────────────────────────
 * 보스 어그로가 55m라 존을 가로지르면 **잡몹 전투 도중에 보스가 걸어
 * 들어왔습니다.** 3페이즈짜리 보스전을 잡몹 넷과 섞으면 페이즈도 연계도
 * 읽을 수가 없습니다. 그리고 걷다 보면 어느새 시작돼 있어서 준비할 순간이
 * 없었습니다.
 *
 * 그래서 세 가지를 봅니다:
 *   1. 영역 **밖**에서는 보스가 잠들어 있는가 (전투 격리)
 *   2. 영역에 들어서면 **준비 구간**이 생기는가 (그동안 공격 안 함)
 *   3. 도망치면 **초기화**되는가 (때리고 도망 반복이 최적이 되면 안 됩니다)
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5190
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
      until: async (fn, limit) => {
        const target = window.__game.state().elapsed + limit
        const deadline = Date.now() + 120000
        while (Date.now() < deadline && window.__game.state().elapsed < target) {
          if (fn()) return true
          await new Promise((r) => setTimeout(r, 8))
        }
        return fn()
      },
      /** 보스를 홀로 세우고, 플레이어를 지정한 거리에 놓습니다. */
      setup: async (dist) => {
        window.__game.reset()
        await window.__t.runFor(0.5)
        window.__game.clearEnemies()
        await window.__t.runFor(0.2)
        const p = window.__game.state().player
        const b = window.__game.spawnBoss(p.x + 40, p.z)
        await window.__t.runFor(0.2)
        // 보스의 자리를 기준으로 플레이어를 옮깁니다.
        window.__game.teleportPlayer(p.x + 40 - dist, p.z)
        await window.__t.runFor(0.3)
        return b
      },
    }
  })

  console.log('\n🚪 보스 조우 검증\n')

  const cfg = await page.evaluate(async () => {
    await window.__t.setup(40)
    return window.__game.bossEncounter()
  })
  console.log(`  [영역] 진입 ${cfg.arenaRadius}m · 이탈 ${cfg.leashRadius}m`)

  // ---- 1. 영역 밖에서는 잠들어 있는가 ----
  const outside = await page.evaluate(async () => {
    await window.__t.setup(30)
    await window.__t.runFor(6)
    return window.__game.bossEncounter()
  })
  check(
    outside.encounter === 0 && outside.aggro === 0,
    '영역 밖(30m)에서는 보스가 반응하지 않음',
    `상태 ${outside.encounter} · 어그로 ${outside.aggro} · 거리 ${outside.homeDist}m`,
  )

  // ---- 2. 들어서면 조우 + 준비 구간 ----
  console.log('')
  const enter = await page.evaluate(async () => {
    await window.__t.setup(10)
    // 조우가 잡힐 때까지
    await window.__t.until(() => (window.__game.bossEncounter()?.encounter ?? 0) > 0, 4)
    const started = window.__game.bossEncounter()
    // 준비 구간(연출) 동안 공격을 하지 않아야 합니다.
    let attackedDuringIntro = false
    while ((window.__game.bossEncounter()?.encounter ?? 0) === 1) {
      const info = window.__game.enemyInfo(started.entity)
      if (info?.attacking) attackedDuringIntro = true
      await new Promise((r) => setTimeout(r, 8))
    }
    const after = window.__game.bossEncounter()
    return { started, attackedDuringIntro, after }
  })
  check(enter.started.encounter === 1, '영역에 들어서면 조우가 시작됨', `상태 ${enter.started.encounter}`)
  check(!enter.attackedDuringIntro, '준비 구간 동안 보스가 공격하지 않음')
  check(enter.after.encounter === 2, '준비가 끝나면 교전으로 넘어감', `상태 ${enter.after.encounter}`)

  // ---- 3. 도망치면 초기화되는가 ----
  //
  // 이게 없으면 "때리고 도망, 회복하고 다시"가 최적 전략이 되어 보스전이
  // 소모전이 됩니다. 도망은 가능하되 **아무것도 얻지 못해야** 합니다.
  console.log('')
  const flee = await page.evaluate(async () => {
    await window.__t.setup(8)
    await window.__t.until(() => (window.__game.bossEncounter()?.encounter ?? 0) === 2, 6)
    const b = window.__game.bossEncounter().entity
    // 체력을 깎고 페이즈를 올린 상태로 도망칩니다.
    window.__game.damageEntity(b, window.__game.bossEncounter().maxHp * 0.5)
    await window.__t.until(() => (window.__game.bossEncounter()?.phase ?? 0) > 0, 6)
    const hurt = window.__game.bossEncounter()

    /**
     * **먼저 보스를 자기 자리에서 끌어냅니다.**
     *
     * 안 끌어내고 바로 도망치면 보스가 이미 제자리에 서 있어서 귀환이
     * **같은 프레임에 끝나버립니다**(상태 3을 한 번도 못 봄).
     * 실제로 이 프로브가 그렇게 실패했었습니다 — 게임은 정상이고
     * 관측이 순간을 놓친 것이었습니다.
     */
    const start = window.__game.state().player
    window.__game.teleportPlayer(start.x - 12, start.z)
    await window.__t.until(() => (window.__game.bossEncounter()?.selfHomeDist ?? 0) > 5, 20)
    const lured = window.__game.bossEncounter()

    // 이탈 반경 밖으로 순간이동.
    const p = window.__game.state().player
    window.__game.teleportPlayer(p.x - hurt.leashRadius - 12, p.z)
    await window.__t.until(() => (window.__game.bossEncounter()?.encounter ?? 0) === 3, 6)
    const leashed = window.__game.bossEncounter()
    // 자리로 돌아가 초기화될 때까지.
    await window.__t.until(() => (window.__game.bossEncounter()?.encounter ?? 9) === 0, 30)
    return { hurt, lured, leashed, reset: window.__game.bossEncounter() }
  })
  check(
    flee.hurt.hp < flee.hurt.maxHp && flee.hurt.phase > 0,
    '교전 중 체력이 깎이고 페이즈가 올라감',
    `체력 ${flee.hurt.hp}/${flee.hurt.maxHp} · ${flee.hurt.phase + 1}단계`,
  )
  check(
    flee.lured.selfHomeDist > 5,
    '보스가 자리에서 끌려나옴 (귀환을 관측하기 위한 준비)',
    `자리에서 ${flee.lured.selfHomeDist}m`,
  )
  check(flee.leashed.encounter === 3, '이탈 반경을 넘으면 귀환 상태로', `상태 ${flee.leashed.encounter}`)
  check(
    flee.reset.encounter === 0 && flee.reset.hp === flee.reset.maxHp,
    '자리로 돌아가면 체력이 완전히 회복됨',
    `${flee.hurt.hp} → ${flee.reset.hp}`,
  )
  check(flee.reset.phase === 0, '페이즈도 1단계로 되돌아감', `${flee.reset.phase + 1}단계`)

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
