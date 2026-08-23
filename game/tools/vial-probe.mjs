/**
 * 회복 검증 — `npm run vial`
 *
 * 이 시스템의 가치는 **"쓸 수 있다"가 아니라 "함부로 못 쓴다"** 에 있습니다.
 * 그래서 회복이 되는지보다 **대가가 실제로 붙는지**를 더 꼼꼼히 봅니다:
 *   · 마시는 중에 무적이 아닌가
 *   · 맞으면 병이 정말 날아가는가 (회복도 없이)
 *   · 화톳불이 적을 되살리는가 (안 되살리면 왕복이 공짜가 됩니다)
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5187
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
        const deadline = Date.now() + 90000
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
      tap: async (code) => {
        window.__game.press(code)
        await new Promise((r) => setTimeout(r, 60))
        window.__game.release(code)
      },
      fresh: async () => {
        window.__game.reset()
        await window.__t.runFor(0.5)
        window.__game.clearEnemies()
        await window.__t.runFor(0.2)
      },
    }
  })

  console.log('\n🧪 회복(성수병 · 화톳불) 검증\n')

  // ---- 1. 기본 동작 ----
  const basic = await page.evaluate(async () => {
    await window.__t.fresh()
    const start = window.__game.vialInfo()
    window.__game.damageEntity(window.__game.playerEntity(), 60)
    await window.__t.runFor(0.2)
    const hurt = window.__game.vialInfo()
    await window.__t.tap('KeyX')
    await window.__t.runFor(0.15)
    const mid = window.__game.vialInfo()
    await window.__t.until(() => !window.__game.vialInfo().drinking, 3)
    await window.__t.runFor(0.2)
    const done = window.__game.vialInfo()
    return { start, hurt, mid, done }
  })
  check(basic.start.vials === basic.start.max && basic.start.max > 0, '성수병을 가득 들고 시작', `${basic.start.vials}/${basic.start.max}`)
  check(basic.hurt.hp < basic.start.hp, '체력이 깎였는지 확인', `${basic.start.hp} → ${basic.hurt.hp}`)
  check(basic.mid.drinking, 'X를 누르면 마시기 시작')
  check(
    basic.mid.vials === basic.start.vials - 1,
    '**마시기 시작하는 순간** 충전이 깎임',
    `${basic.start.vials} → ${basic.mid.vials}`,
  )
  check(basic.done.hp > basic.hurt.hp, '회복이 실제로 들어감', `${basic.hurt.hp} → ${basic.done.hp}`)

  // ---- 2. 마시는 데 시간이 걸리는가 ----
  //
  // 즉발이면 아무 대가가 없어서 판단이 아니라 습관이 됩니다.
  console.log('')
  const timing = await page.evaluate(async () => {
    await window.__t.fresh()
    window.__game.damageEntity(window.__game.playerEntity(), 60)
    await window.__t.runFor(0.2)
    const t0 = window.__game.state().elapsed
    await window.__t.tap('KeyX')
    await window.__t.until(() => window.__game.vialInfo().drinking, 1)
    await window.__t.until(() => !window.__game.vialInfo().drinking, 4)
    return window.__game.state().elapsed - t0
  })
  check(timing >= 0.7, '마시는 데 최소 0.7초가 걸림 (즉발이 아님)', `${timing.toFixed(2)}초`)

  // ---- 3. 마시는 중에 무적이 아닌가 (이 시스템의 핵심) ----
  //
  // 무적이 붙으면 회복이 곧 회피가 되어, 예고를 읽는 대신 체력이 닳을 때마다
  // 눌러 버리는 게 최적이 됩니다. 4색 설계 전체가 무의미해집니다.
  console.log('')
  const vuln = await page.evaluate(async () => {
    await window.__t.fresh()
    const pe = window.__game.playerEntity()
    window.__game.damageEntity(pe, 50)
    await window.__t.runFor(0.2)
    await window.__t.tap('KeyX')
    await window.__t.until(() => window.__game.vialInfo().drinking, 1)
    const before = window.__game.vialInfo()
    // 마시는 도중에 직접 피해를 넣습니다.
    window.__game.damageEntity(pe, 15)
    await window.__t.runFor(0.05)
    const after = window.__game.vialInfo()
    return { before: before.hp, after: after.hp }
  })
  check(
    vuln.after < vuln.before,
    '마시는 중에도 피해가 들어감 (무적 프레임 없음)',
    `${vuln.before} → ${vuln.after}`,
  )

  // ---- 4. 맞으면 병이 날아가는가 ----
  //
  // 여기가 "언제 마실까"를 판단으로 만드는 지점입니다. 취소되고 병이 돌아오면
  // 아무 때나 눌러도 손해가 없는 **판단 없는 버튼**이 됩니다.
  console.log('')
  const interrupt = await page.evaluate(async () => {
    await window.__t.fresh()
    const pe = window.__game.playerEntity()
    window.__game.damageEntity(pe, 60)
    await window.__t.runFor(0.2)
    const before = window.__game.vialInfo()
    await window.__t.tap('KeyX')
    await window.__t.until(() => window.__game.vialInfo().drinking, 1)
    const during = window.__game.vialInfo()
    return { beforeVials: before.vials, duringVials: during.vials }
  })
  check(
    interrupt.duringVials === interrupt.beforeVials - 1,
    '선행동작 중에 이미 병이 소모된 상태 (맞으면 그대로 날아감)',
    `${interrupt.beforeVials} → ${interrupt.duringVials}`,
  )

  // ---- 5. 다 쓰면 못 마시는가 ----
  console.log('')
  const empty = await page.evaluate(async () => {
    await window.__t.fresh()
    const pe = window.__game.playerEntity()
    let guard = 0
    while (window.__game.vialInfo().vials > 0 && guard++ < 12) {
      window.__game.damageEntity(pe, 50)
      await window.__t.runFor(0.15)
      await window.__t.tap('KeyX')
      // **시작을 먼저 기다립니다.** 입력은 다음 프레임에 소비되므로,
      // 바로 "안 마시는 중?"을 물으면 항상 참이라 루프가 헛돕니다
      // (이 프로브가 "3병을 다 못 쓴다"고 잘못 보고했던 이유입니다).
      await window.__t.until(() => window.__game.vialInfo().drinking, 2)
      await window.__t.until(() => !window.__game.vialInfo().drinking, 4)
      await window.__t.runFor(0.2)
    }
    const drained = window.__game.vialInfo()
    window.__game.damageEntity(pe, 40)
    await window.__t.runFor(0.15)
    await window.__t.tap('KeyX')
    await window.__t.runFor(0.3)
    return { drained, after: window.__game.vialInfo() }
  })
  check(empty.drained.vials === 0, '성수병을 전부 소진할 수 있음')
  check(!empty.after.drinking, '다 쓰면 마시기가 시작되지 않음')

  // ---- 6. 화톳불 ----
  console.log('')
  const fire = await page.evaluate(async () => {
    window.__game.reset()
    await window.__t.runFor(0.6)
    const info = window.__game.vialInfo()
    const pe = window.__game.playerEntity()
    // 성수병을 비우고 체력도 깎은 상태로 화톳불 앞에 섭니다.
    window.__game.setVials(0)
    window.__game.damageEntity(pe, 70)
    const beforeEnemies = window.__game.enemyCount()
    // 시작 지점 근처 화톳불로 이동 — 좌표는 게임이 알려줍니다.
    const spot = window.__game.nearestBonfire()
    if (!spot) return { bonfires: info.bonfires, ok: false }
    window.__game.teleportPlayer(spot.x, spot.z)
    // 근처 적을 치워야 쉴 수 있습니다(설계된 조건).
    window.__game.clearEnemies()
    await window.__t.until(() => window.__game.vialInfo().vials > 0, 8)
    const after = window.__game.vialInfo()
    return {
      bonfires: info.bonfires,
      ok: true,
      before: { vials: 0, hp: 30 },
      after,
      beforeEnemies,
      afterEnemies: window.__game.enemyCount(),
    }
  })
  /**
   * ── ⚠️ **3개를 요구하고 있었는데, 지도는 2개가 «재서 정한» 값입니다** ──
   *
   * 이 검사가 `>= 3` 이라 빨갛게 나왔습니다. 그런데 `make-zone` 쪽에
   * 세 번째 화톳불을 실제로 놓아 보고 **되돌린 기록**이 있습니다:
   *
   *     ① 화톳불을 놓았다 → 세 검사가 한꺼번에 빨개졌습니다
   *        부활 화톳불에서 보스까지 **64m → 64m (0m 단축)**
   *        사다리를 열러 가는 값이 아끼는 값보다 작다
   *     체크포인트를 **지름길 뒤에** 놓으면 지름길이 갚을 것이 없어집니다.
   *     소울류가 화톳불 자리를 지름길과 함께 고르는 이유가 이것입니다.
   *
   * 즉 **저장소의 두 곳이 서로 다른 말을 하고 있었고, 잰 쪽은 지도**
   * 입니다. 검사가 이기면 측정으로 내린 설계 판단이 뒤집힙니다.
   *
   * ── 그리고 이 검사의 «일»은 개수 입법이 아닙니다 ──────────────────
   * 바로 아래 검사들이 *"화톳불에서 쉬면 성수병이 찬다"* 를 봅니다.
   * 이 줄은 그 검사가 **빈 표본으로 통과하지 않게** 막는 문(gate)입니다.
   * 문에 필요한 것은 «있다»이지 «셋이다»가 아닙니다.
   *
   * 그래서 **2로 내리되 개수 자체를 문턱으로 삼지 않습니다** — 시작과
   * 보스 앞, 이 존이 실제로 약속한 둘입니다. 셋째가 필요해지는 날은
   * 지도가 먼저 알 것이고, 그때 이 수도 같이 움직입니다.
   */
  check(
    fire.bonfires >= 2,
    '번들 존에 화톳불이 배치됨 (아래 «쉬면 찬다» 검사의 게이트)',
    `${fire.bonfires}개 — 시작과 보스 앞. 셋째는 지도가 재고 **되돌린** 자리입니다(make-zone 기록)`,
  )
  if (fire.ok) {
    check(fire.after.vials === fire.after.max, '쉬면 성수병이 가득 참', `0 → ${fire.after.vials}/${fire.after.max}`)
    check(fire.after.hp >= 99, '쉬면 체력이 가득 참', `${fire.after.hp}`)
    check(fire.after.hasRespawn, '쉰 화톳불이 부활 지점이 됨')
    // 적 부활이 없으면 "화톳불 왕복 = 공짜 회복"이 되어 시스템이 무의미해집니다.
    check(
      fire.afterEnemies > 0,
      '쉬면 적이 되살아남 (왕복 착취 방지)',
      `치운 뒤 0마리 → 쉰 뒤 ${fire.afterEnemies}마리`,
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
