/**
 * 불티 검증 — `npm run ember`
 *
 * 이 시스템은 **두 구멍을 한 번에 메우려고** 만들었습니다:
 *   1. 적을 죽일 이유가 없었다 (처치 보상 0 → 전투를 지나쳐 달리는 게 최적)
 *   2. 죽음의 대가가 없었다 (화톳불 부활은 잃는 게 없었다)
 *
 * 그래서 확인할 것도 두 가지입니다: **주는가**, 그리고 **잃는가.**
 * 특히 "떨어뜨린 것을 되찾을 수 있는가"가 핵심입니다 —
 * 되찾을 수 없으면 그건 긴장이 아니라 그냥 벌입니다.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5188
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
        await window.__t.runFor(0.6)
      },
    }
  })

  console.log('\n🔥 불티 검증\n')

  // ---- 1. 처치 보상이 실제로 붙는가 ----
  //
  // 이게 0이면 공들여 만든 전투를 전부 지나쳐 달리는 게 최적입니다.
  const kill = await page.evaluate(async () => {
    await window.__t.fresh()
    window.__game.setEmbers(0)
    const before = window.__game.emberInfo().embers
    const killed = window.__game.killAllEnemies()
    await window.__t.runFor(0.5)
    return { before, killed, after: window.__game.emberInfo().embers }
  })
  check(kill.killed > 0, '레벨에 적이 있음', `${kill.killed}마리`)
  check(
    kill.after > kill.before,
    '적을 죽이면 불티가 들어옴',
    `${kill.before} → ${kill.after} (${kill.killed}마리)`,
  )

  // ---- 2. 종류마다 다른 값을 주는가 ----
  //
  // 전부 같은 값이면 "먼저 뭘 죽일까"라는 판단이 생기지 않습니다.
  console.log('')
  const perKind = await page.evaluate(async () => {
    const one = async (kindId) => {
      await window.__t.fresh()
      window.__game.clearEnemies()
      window.__game.setEmbers(0)
      await window.__t.runFor(0.2)
      const p = window.__game.state().player
      window.__game.spawnEnemyKind(kindId, p.x + 6, p.z)
      await window.__t.runFor(0.2)
      window.__game.killAllEnemies()
      await window.__t.runFor(0.4)
      return window.__game.emberInfo().embers
    }
    return {
      grunt: await one('grunt'),
      binder: await one('binder'),
      dragger: await one('dragger'),
      boss: await one('boss'),
    }
  })
  console.log(
    `  [처치 보상] 잡몹 ${perKind.grunt} · 얽는 자 ${perKind.binder} · ` +
      `끄는 자 ${perKind.dragger} · 보스 ${perKind.boss}`,
  )
  check(perKind.grunt > 0, '잡몹이 불티를 줌', String(perKind.grunt))
  check(
    perKind.binder > perKind.grunt && perKind.dragger > perKind.grunt,
    '특수 적이 잡몹보다 많이 줌 (먼저 죽일 이유)',
    `잡몹 ${perKind.grunt} vs 특수 ${perKind.binder}`,
  )
  check(perKind.boss > perKind.grunt * 5, '보스가 압도적으로 많이 줌', String(perKind.boss))

  // ---- 3. 죽으면 떨어뜨리는가 · 되찾을 수 있는가 ----
  //
  // **이 항목이 이 시스템의 전부입니다.** 그냥 사라지면 그건 벌일 뿐이고,
  // 되찾으러 가는 길이 있어야 긴장이 됩니다.
  console.log('')
  const death = await page.evaluate(async () => {
    await window.__t.fresh()
    window.__game.clearEnemies()
    const pe = window.__game.playerEntity()
    window.__game.setEmbers(500)

    // 먼저 화톳불에서 쉬어 부활 지점을 만듭니다(안 그러면 게임 오버).
    const fire = window.__game.nearestBonfire()
    window.__game.teleportPlayer(fire.x, fire.z)
    await window.__t.until(() => window.__game.vialInfo().hasRespawn, 8)
    window.__game.clearEnemies()
    window.__game.setEmbers(500)

    // 화톳불에서 좀 떨어진 곳으로 가서 죽습니다.
    window.__game.teleportPlayer(fire.x + 9, fire.z)
    await window.__t.runFor(0.3)
    const spot = window.__game.state().player
    window.__game.damageEntity(pe, 999)
    await window.__t.until(() => window.__game.emberInfo().drop !== null, 5)
    const dropped = window.__game.emberInfo()
    const afterDeath = { embers: dropped.embers, drop: dropped.drop }

    // 표식 자리로 걸어가 되찾습니다.
    if (dropped.drop) {
      window.__game.teleportPlayer(dropped.drop.x, dropped.drop.z)
      await window.__t.until(() => window.__game.emberInfo().drop === null, 5)
    }
    const recovered = window.__game.emberInfo()
    return { spot, afterDeath, recovered }
  })
  check(death.afterDeath.embers === 0, '죽으면 가진 불티가 0이 됨', `${death.afterDeath.embers}`)
  check(
    death.afterDeath.drop !== null && death.afterDeath.drop.amount === 500,
    '떨어뜨린 표식에 전부 담김',
    `${death.afterDeath.drop?.amount ?? 0}`,
  )
  check(death.recovered.embers === 500, '표식에 닿으면 되찾음', `${death.recovered.embers}`)
  check(death.recovered.drop === null, '되찾으면 표식이 사라짐')

  // ---- 4. 표식은 하나뿐인가 ----
  //
  // 여러 개가 쌓이면 "나중에 한꺼번에 줍지 뭐"가 되어 손실이 실감나지 않습니다.
  console.log('')
  const single = await page.evaluate(async () => {
    const pe = window.__game.playerEntity()
    const fire = window.__game.nearestBonfire()
    window.__game.setEmbers(100)
    window.__game.teleportPlayer(fire.x + 9, fire.z)
    window.__game.clearEnemies()
    await window.__t.runFor(0.3)
    window.__game.damageEntity(pe, 999)
    await window.__t.until(() => window.__game.emberInfo().drop !== null, 5)
    const first = window.__game.emberInfo().drop

    // 되찾지 않고 다른 곳에서 또 죽습니다.
    window.__game.setEmbers(30)
    window.__game.teleportPlayer(fire.x - 9, fire.z)
    window.__game.clearEnemies()
    await window.__t.runFor(0.3)
    window.__game.damageEntity(pe, 999)
    await window.__t.until(() => {
      const d = window.__game.emberInfo().drop
      return d !== null && d.amount === 30
    }, 5)
    return { first, second: window.__game.emberInfo().drop }
  })
  check(
    single.second !== null && single.second.amount === 30,
    '다시 죽으면 표식이 새 자리로 옮겨감 (이전 것은 사라짐)',
    `${single.first?.amount ?? 0} → ${single.second?.amount ?? 0}`,
  )

  // ---- 5. 화톳불에서 성수병 강화 ----
  console.log('')
  const upgrade = await page.evaluate(async () => {
    await window.__t.fresh()
    window.__game.clearEnemies()
    const before = window.__game.emberInfo()
    const fire = window.__game.nearestBonfire()
    window.__game.teleportPlayer(fire.x, fire.z)
    await window.__t.runFor(0.6)

    // 불티가 모자란 상태로 눌러 봅니다 — 아무 일도 없어야 합니다.
    window.__game.setEmbers(Math.max(0, before.upgradeCost - 10))
    await window.__t.tap('KeyV')
    await window.__t.runFor(0.4)
    const poor = window.__game.emberInfo()

    // 충분하게 주고 다시.
    window.__game.setEmbers(before.upgradeCost + 25)
    await window.__t.tap('KeyV')
    await window.__t.runFor(0.5)
    const rich = window.__game.emberInfo()
    return { before, poor, rich }
  })
  check(upgrade.before.upgradeCost > 0, '강화 비용이 정의됨', `${upgrade.before.upgradeCost} 불티`)
  check(
    upgrade.poor.vialsMax === upgrade.before.vialsMax,
    '불티가 모자라면 강화되지 않음',
    `충전 ${upgrade.poor.vialsMax}개 유지`,
  )
  check(
    upgrade.rich.vialsMax === upgrade.before.vialsMax + 1,
    '충분하면 성수병 충전이 +1',
    `${upgrade.before.vialsMax} → ${upgrade.rich.vialsMax}`,
  )
  check(
    upgrade.rich.embers === 25,
    '강화하면 불티가 실제로 차감됨',
    `남은 ${upgrade.rich.embers}`,
  )
  check(
    upgrade.rich.upgradeCost > upgrade.before.upgradeCost,
    '다음 강화는 더 비쌈 (무한 강화 방지)',
    `${upgrade.before.upgradeCost} → ${upgrade.rich.upgradeCost}`,
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
