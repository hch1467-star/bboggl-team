/**
 * 🛡 저스트 가드 판정 — `npm run parry`
 *
 * ── 이 프로브가 지키는 계약 ───────────────────────────────────────
 * 참고한 게임들(세키로 튕기기 · Lies of P 퍼펙트 가드 · God Hand 저스트
 * 가드 · Wo Long 화해)이 공유하는 문법은 셋입니다:
 *
 *   ① 창이 **짧다**            → 아무 때나 눌러서는 안 됩니다
 *   ② 성공은 자원을 **안 쓰고 오히려 번다**
 *   ③ 실패는 **평소보다 나쁘다** → "일단 눌러 보는 버튼"이 되면 안 됩니다
 *
 * 셋 중 하나라도 빠지면 저스트 가드가 아니라 그냥 무적 버튼입니다.
 * 그래서 세 줄을 **각각** 검사합니다.
 *
 * ── 그리고 색 체계를 지키는 검사 ─────────────────────────────────
 * 가장 큰 위험은 가드가 **만능 정답**이 되는 것입니다. 지금 다섯 색은 각각
 * 다른 답을 요구하는데, 가드가 아무 색에나 통하면 그 답들이 통째로 값을
 * 잃습니다. 그래서 **🔴 직격에만 통하고 나머지에는 안 통한다**를 잽니다.
 * (세키로에서 위험(危) 공격이 튕기기로 안 풀리는 것과 같은 자리입니다.)
 *
 * ⚠️ 규칙값(창 길이 · 잠김 · 기력)은 **게임에게 물어봅니다**(`guardInfo()`).
 *    여기에 0.18 을 적어 두면, 값을 바꾸는 날 이 프로브가 조용히 옛 규칙을
 *    재게 됩니다 — 이 저장소가 이번 세션에 열 번 넘게 밟은 함정입니다.
 *
 * 실행: npm run parry
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 4215

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

const server = await createServer({
  root: ROOT,
  server: { port: PORT, strictPort: true, host: '127.0.0.1' },
  logLevel: 'error',
})
await server.listen()
const browser = await chromium.launch({
  executablePath: ['/opt/pw-browsers/chromium'].find((p) => existsSync(p)),
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
})

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })
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
      /**
       * 적 하나를 **정면 코앞**에 세우고 지정한 공격을 시킵니다.
       * `guardAt` 이 null 이 아니면 판정이 닿기 전 그 시점에 V 를 누릅니다.
       */
      duel: async (kindId, attackId, dist) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.5)
        G.clearEnemies()
        await window.__t.runFor(0.2)
        const p = G.state().player
        const e = G.spawnEnemyKind(kindId, p.x, p.z + 8)
        await window.__t.runFor(0.3)
        G.wakeEnemy(e)
        const es = G.enemyInfo(e)
        // 적의 **정면**에 세웁니다 — 부채꼴 안이어야 판정이 닿습니다.
        G.teleportPlayer(es.x + Math.sin(es.rotY) * dist, es.z + Math.cos(es.rotY) * dist)
        G.aimAtWorld(es.x, es.z)
        await window.__t.runFor(0.15)
        /**
         * ⚠️ **적이 쉬고 있을 때까지 기다립니다.**
         *
         * 이게 없어서 "일찍 누르면 안 막힌다" 검사가 거짓으로 빨갰습니다.
         * 코앞에 세워 둔 잡몹은 `forceAttack` 을 부르기 **전에** 이미 제
         * 예고를 시작해 있었고, 그래서 "공격 시작 0초" 라고 적은 시점이
         * 실제로는 예고 중반이었습니다. 0.02초 뒤에 누른 것이 **정확한
         * 타이밍**이 되어 버렸습니다.
         *
         * 타임라인을 찍어 보고서야 알았습니다(창 0.1→0.18초에 열렸다 닫혔고,
         * 그 사이에 판정이 왔습니다). 게임은 멀쩡했고 **프로브가 틀렸습니다.**
         */
        await window.__t.until(() => !G.enemyInfo(e)?.attacking, 3)
        // 이 적의 공격 목록에서 그 id 의 자리를 **게임에게** 물어봅니다.
        const idx = G.punishTable()
          .filter((r) => r.attackId === attackId)
          .map((r) => r.index)[0]
        return { e, idx }
      },
    }
  })

  console.log('\n🛡 저스트 가드 판정\n')

  const rule = await page.evaluate(() => window.__game.guardInfo())
  console.log(
    `  [규칙 — 게임이 알려 준 값] 창 ${rule.window}초 · 헛치면 ${rule.whiffLock}초 잠김` +
      ` · 기력 -${rule.whiffStamina} · 성공 시 기력 +${rule.refund} · 강인도 ${rule.poise}`,
  )

  /**
   * ── ① 성공 — 🔴 직격을 정확히 막는다 ────────────────────────────
   *
   * 판정이 닿기 **직전**에 누릅니다. 예고 시간을 게임에서 읽어(`threats`)
   * 남은 시간이 창보다 짧아지는 순간에 누르므로, 창 길이를 베끼지 않습니다.
   */
  const guarded = await page.evaluate(async () => {
    const G = window.__game
    const { e, idx } = await window.__t.duel('grunt', 'grunt_jab', 1.8)
    const hp0 = G.state().player.hp
    const st0 = G.state().player.stamina ?? 0
    const poise0 = G.enemyInfo(e).poise
    G.forceAttack(e, idx)
    // 판정 직전까지 기다렸다가 누릅니다 — 남은 예고 시간은 게임이 압니다.
    await window.__t.until(() => {
      const i = G.enemyInfo(e)
      return !!i && i.winding && i.timer <= window.__game.guardInfo().window * 0.6
    }, 4)
    G.press('KeyV')
    G.release('KeyV')
    let broke = false
    const deadline = G.state().elapsed + 0.8
    while (G.state().elapsed < deadline) {
      if (G.enemyInfo(e)?.broken) broke = true
      await new Promise((r) => setTimeout(r, 8))
    }
    return {
      count: G.guardInfo().count,
      hurt: hp0 - G.state().player.hp,
      /**
       * ⚠️ **무너짐도 같이 봅니다.** 처음엔 강인도 감소만 봤는데 0.0 이
       *    나왔습니다 — 잡몹은 강인도가 작아서 **한 번에 무너지고**, 무너지면
       *    강인도가 최대치로 되돌아가 차이가 0이 됩니다. 결과가 옳았는데
       *    계측기가 놓친 것입니다.
       */
      broke,
      poiseDrop: poise0 - G.enemyInfo(e).poise,
      staminaAfter: (G.state().player.stamina ?? 0) - st0,
    }
  })
  check(
    guarded.count === 1,
    '① 🔴 직격을 정확히 막으면 저스트 가드가 성립한다',
    `${guarded.count}회`,
  )
  check(guarded.hurt === 0, '   막았으면 피해가 0이다', `피해 ${guarded.hurt}`)
  check(
    guarded.poiseDrop > 0 || guarded.broke,
    '   보상은 **강인도** (완벽 회피와 다른 것을 번다)',
    guarded.broke ? '한 번에 무너뜨림' : `강인도 -${guarded.poiseDrop.toFixed(1)}`,
  )

  /**
   * ── ② 실패 — 일찍 누르면 안 막힌다 ──────────────────────────────
   *
   * 예고가 **시작하자마자** 누릅니다. 창이 짧다면 판정이 올 때쯤엔 이미
   * 닫혀 있어야 합니다. 이 검사가 초록이 아니면 창 길이가 아무 뜻이 없습니다.
   */
  const early = await page.evaluate(async () => {
    const G = window.__game
    const { e, idx } = await window.__t.duel('grunt', 'grunt_jab', 1.8)
    const hp0 = G.state().player.hp
    const c0 = G.guardInfo().count
    /**
     * ⚠️ 여기서는 `forceAttack` 을 **안 씁니다.**
     *
     * 그 훅은 예고를 **25% 남은 지점**부터 시작합니다(예고 도형이 잘 보이도록
     * 일부러 그렇게 만든 것 — main.ts `debugForceAttack` 주석). grunt_jab 은
     * 예고 0.55초라 남는 시간이 0.14초뿐이고, 가드 창(0.18초)보다 짧습니다.
     * 즉 이 훅으로는 **"일찍 누르기"가 원리적으로 불가능**합니다.
     *
     * 그래서 적이 **스스로** 휘두르기 시작할 때까지 기다렸다가 누릅니다.
     * 그러면 남은 예고가 창보다 확실히 길고, 아래 게이트가 그것을 확인합니다.
     */
    await window.__t.until(() => G.enemyInfo(e)?.winding === true, 6)
    const t0 = G.state().elapsed
    const leftAtPress = G.enemyInfo(e)?.timer ?? 0
    G.press('KeyV')
    G.release('KeyV')
    /**
     * ⚠️ **타임라인을 같이 적습니다.** 처음엔 이 검사가 빨간 이유를 두고
     *    이론을 세우려 했습니다 — 창이 안 닫히나? 입력이 늦나? 적이 이미
     *    휘두르고 있었나? 셋 다 그럴듯했습니다. 이 저장소가 같은 자리에서
     *    이미 여러 번 배웠습니다: **재기 전의 설명은 결론이 아닙니다.**
     */
    let tOpen = -1
    let tClose = -1
    let tHit = -1
    const deadline = G.state().elapsed + 1.6
    while (G.state().elapsed < deadline) {
      const g = G.guardInfo()
      const now = G.state().elapsed
      if (tOpen < 0 && g.windowT > 0) tOpen = now - t0
      if (tOpen >= 0 && tClose < 0 && g.windowT === 0) tClose = now - t0
      if (tHit < 0 && G.state().player.hp < hp0) tHit = now - t0
      await new Promise((r) => setTimeout(r, 8))
    }
    return {
      count: G.guardInfo().count - c0,
      hurt: hp0 - G.state().player.hp,
      leftAtPress: Number(leftAtPress.toFixed(2)),
      tOpen: Number(tOpen.toFixed(2)),
      tClose: Number(tClose.toFixed(2)),
      tHit: Number(tHit.toFixed(2)),
    }
  })
  console.log(
    `    [타임라인] 누른 시점 0초(남은 예고 ${early.leftAtPress}초) → 창 열림 ${early.tOpen}초` +
      ` → 창 닫힘 ${early.tClose}초 → 맞음 ${early.tHit}초`,
  )
  /**
   * ⚠️ **측정이 성립했는지 먼저 묻습니다.** 판정이 창 안에 들어와 버리면
   *    이 절은 "일찍 누른 것"을 잰 적이 없습니다 — 그런데도 초록/빨강 중
   *    하나가 나오므로, 가르지 않으면 아무 말이나 하는 검사가 됩니다.
   */
  check(
    early.leftAtPress > rule.window,
    '② 측정이 성립했다 — 누른 시점에 남은 예고가 창보다 길다 (진짜 "일찍")',
    `남은 예고 ${early.leftAtPress}초 vs 창 ${rule.window}초`,
  )
  check(early.count === 0, '   너무 일찍 누르면 안 막힌다 (창이 짧다)', `${early.count}회`)
  check(early.hurt > 0, '   그리고 그대로 맞는다', `피해 ${early.hurt}`)

  /**
   * ── ③ 헛치면 값을 낸다 ──────────────────────────────────────────
   *
   * 아무도 안 때리는데 눌러 봅니다. 잠김과 기력 손실이 없으면 저스트 가드가
   * 아니라 **공짜 버튼**입니다 — 그러면 최적 플레이가 "계속 누르기"가 됩니다.
   */
  const whiff = await page.evaluate(async () => {
    const G = window.__game
    G.reset()
    await window.__t.runFor(0.5)
    G.clearEnemies()
    await window.__t.runFor(0.3)
    const before = G.state().player.stamina ?? 0
    G.press('KeyV')
    G.release('KeyV')
    /**
     * ⚠️ 창은 **다음 프레임**에 열립니다(입력을 프레임 첫머리에서 소비하므로).
     *    누르자마자 읽으면 언제나 0이라, 이 검사가 게임이 아니라 **읽는
     *    시점**을 재고 있었습니다.
     */
    const opened = await window.__t.until(() => window.__game.guardInfo().windowT > 0, 1)
    // 창이 닫힐 때까지.
    await window.__t.until(() => window.__game.guardInfo().lockT > 0, 2)
    const locked = G.guardInfo().lockT
    const after = G.state().player.stamina ?? 0
    return { opened, locked, spent: before - after }
  })
  check(whiff.opened, '③ 누르면 창이 실제로 열린다 (측정이 성립했다)')
  check(
    whiff.locked > 0,
    '   헛치면 굳는다 (연타가 상시 가드가 되지 않게)',
    `${whiff.locked.toFixed(2)}초`,
  )
  check(whiff.spent > 0, '   헛치면 기력을 낸다', `-${whiff.spent.toFixed(0)}`)

  /**
   * ── ④ 만능 정답이 아니다 ────────────────────────────────────────
   *
   * **이 프로브에서 가장 중요한 검사입니다.** 가드가 아무 색에나 통하면
   * 색 다섯이 통째로 값을 잃습니다. 🔵 속박과 🟣 강제이동은 같은 방식으로
   * 정확히 눌러도 **안 막혀야** 합니다.
   */
  const colors = []
  for (const [kind, atk, mark] of [
    ['binder', 'binder_web', '🔵'],
    ['dragger', 'dragger_hook', '🟣'],
    ['charger', 'charger_rush', '🟢'],
  ]) {
    const r = await page.evaluate(
      async ({ kind, atk }) => {
        const G = window.__game
        const { e, idx } = await window.__t.duel(kind, atk, 3.0)
        const hp0 = G.state().player.hp
        const c0 = G.guardInfo().count
        G.forceAttack(e, idx)
        await window.__t.until(() => {
          const i = G.enemyInfo(e)
          return !!i && i.winding && i.timer <= window.__game.guardInfo().window * 0.6
        }, 4)
        G.press('KeyV')
        G.release('KeyV')
        await window.__t.runFor(0.8)
        return { gained: G.guardInfo().count - c0, hurt: hp0 - G.state().player.hp }
      },
      { kind, atk },
    )
    colors.push({ mark, atk, ...r })
  }
  for (const c of colors) {
    console.log(`    ${c.mark} ${c.atk} — 가드 성립 ${c.gained}회 · 피해 ${c.hurt}`)
  }
  check(
    colors.every((c) => c.gained === 0),
    '④ **🔴 말고는 안 막힌다** (가드가 만능 정답이 되지 않게)',
    colors
      .filter((c) => c.gained > 0)
      .map((c) => c.atk)
      .join(', ') || '전부 안 막힘',
  )

  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} catch (e) {
  fail++
  console.error('\n💥', e)
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
