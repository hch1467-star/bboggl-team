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
        // (`attackId` 가 null 이면 적이 스스로 고르게 두는 절입니다.)
        const idx = attackId
          ? G.punishTable()
              .filter((r) => r.attackId === attackId)
              .map((r) => r.index)[0]
          : -1
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
    G.press(G.guardInfo().key)
    G.release(G.guardInfo().key)
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
    G.press(G.guardInfo().key)
    G.release(G.guardInfo().key)
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
    G.press(G.guardInfo().key)
    G.release(G.guardInfo().key)
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
   * ── ③-2 등지고는 못 막는다 ──────────────────────────────────────
   *
   * ①과 **같은 상황에서 방향만 뒤집습니다.** 그래서 이 검사가 빨개지면
   * 원인이 방향 하나로 좁혀집니다(다른 조건은 전부 같으므로).
   *
   * 왜 필요한가: 방향이 없으면 도망치면서 아무 쪽으로나 눌러도 되는 답이
   * 되고, "정면에서 받아낸다"는 가드의 정체성이 사라집니다. 세키로·
   * Lies of P·Wo Long 의 가드는 전부 방향이 있습니다.
   */
  const backTurned = await page.evaluate(async () => {
    const G = window.__game
    const { e, idx } = await window.__t.duel('grunt', 'grunt_jab', 1.8)
    const hp0 = G.state().player.hp
    const c0 = G.guardInfo().count
    G.forceAttack(e, idx)
    // 적을 **등지게** 조준을 반대로 돌립니다. 나머지는 ①과 같습니다.
    const es = G.enemyInfo(e)
    const ps = G.state().player
    G.aimAtWorld(ps.x - (es.x - ps.x) * 4, ps.z - (es.z - ps.z) * 4)
    await window.__t.until(() => {
      const i = G.enemyInfo(e)
      return !!i && i.winding && i.timer <= window.__game.guardInfo().window * 0.6
    }, 4)
    G.press(G.guardInfo().key)
    G.release(G.guardInfo().key)
    await window.__t.runFor(0.8)
    return { gained: G.guardInfo().count - c0, hurt: hp0 - G.state().player.hp }
  })
  check(
    backTurned.gained === 0,
    '③-2 **등지고는 못 막는다** (가드는 맞서는 기술입니다)',
    `가드 성립 ${backTurned.gained}회 · 피해 ${backTurned.hurt}`,
  )

  /**
   * ── ③-3 휘두르는 중에도 열 수 있되 **값을 낸다** ────────────────
   *
   * 자동 플레이에서 붙잡은 🔴 18회 중 **창을 본 것이 18회(100%)** 인데
   * 그중 **9회**가 "낼 자리가 없어서" 사라졌습니다. 읽었는데 답할 수
   * 없는 것은 기둥 2 가 가장 싫어하는 모양입니다.
   *
   * 그래서 구르기 취소와 **같은 계약**으로 엽니다 — 낼 수는 있게, 대신
   * 비싸게. 여기서는 두 방향을 다 잽니다: **기력이 있으면 열리고, 없으면
   * 안 열린다.** 한쪽만 재면 "그냥 항상 열린다"와 구분이 안 됩니다.
   */
  const midSwing = await page.evaluate(async () => {
    const G = window.__game
    const out = {}
    for (const rich of [true, false]) {
      G.reset()
      await window.__t.runFor(0.5)
      G.clearEnemies()
      await window.__t.runFor(0.3)
      /**
       * 기력을 통제합니다 — 값을 못 내는 상태를 만들어야 반대쪽이 재집니다.
       *
       * ⚠️ **붙들어야 합니다.** 예전엔 `setStamina(5)` 한 번이었는데, 바로
       *    아래에서 최대 1초를 기다리는 동안 회복(34/초)이 5 → 39 로
       *    올려놓습니다. 그러면 *"기력이 없으면 안 열린다"* 를 재려던
       *    순간에 **기력이 있습니다.** 게임은 멀쩡한데 검사가 빨개지는,
       *    이 저장소가 blame 프로브에서 이미 한 번 배운 모양입니다
       *    (*"재려는 조건은 게임이 지켜 줘야 합니다"*).
       */
      /**
       * ⚠️ **먼저 휘두르게 하고, 휘두르는 중에 기력을 뺍니다.**
       *
       * 예전엔 기력을 5로 **먼저** 낮추고 좌클릭했습니다. 그런데 이제
       * 기력 5에서는 **공격이 아예 안 나갑니다**(playerControl
       * `canAffordAttack` — 공격은 구르기 한 번 분을 남깁니다).
       * 그러면 플레이어는 휘두르는 중이 아니라 **서 있는** 상태이고,
       * 거기서 가드를 누르면 평범한 가드가 열립니다. 재려던 것은
       * *"커밋을 뚫는 자리"* 인데 **다른 자리를 재고 있었습니다.**
       *
       * 검사는 빨갛게 떴고 저는 처음에 회복 탓인 줄 알았습니다. 회복을
       * 붙들어도 그대로였습니다 — 상황 자체가 성립하지 않았던 것입니다.
       */
      G.pinStamina(null)
      G.setStamina(100)
      G.press('Mouse0')
      G.release('Mouse0')
      // 실제로 **휘두르는 중**이 될 때까지 기다립니다(후딜은 커밋이 아닙니다).
      const swinging = await window.__t.until(
        () => G.state().player.state === 1 && G.state().player.phase !== 2,
        1.2,
      )
      // 그 다음에 기력을 뺍니다 — 이러면 "커밋 중 + 기력 없음"이 성립합니다.
      if (!rich) G.pinStamina(5)
      await window.__t.until(() => window.__game.guardInfo().canGuard === rich, 0.6)
      const before = G.state().player.stamina
      const can = G.guardInfo().canGuard
      G.press(G.guardInfo().key)
      G.release(G.guardInfo().key)
      const opened = await window.__t.until(() => window.__game.guardInfo().windowT > 0, 0.6)
      out[rich ? 'rich' : 'poor'] = {
        can,
        opened,
        // 🚪 게이트 — 정말 휘두르는 중이었나. 아니면 아래 판정은 뜻이 없습니다.
        swinging,
        spent: Number((before - G.state().player.stamina).toFixed(0)),
      }
    }
    // 붙들어 둔 것을 풉니다 — 뒤 검사가 마른 기력을 물려받지 않게.
    G.pinStamina(null)
    return out
  })
  check(
    midSwing.rich.opened,
    '③-3 휘두르는 중에도 **기력이 있으면** 열린다',
    `기력 ${midSwing.rich.spent} 냄`,
  )
  check(
    midSwing.rich.spent > 0,
    '   그리고 공짜가 아니다 (커밋을 뚫는 값)',
    `순감소 -${midSwing.rich.spent} (회복분이 상쇄된 값)`,
  )
  check(
    midSwing.rich.swinging && midSwing.poor.swinging,
    '   🚪 두 판 모두 **정말 휘두르는 중**이었다 (비교 앞의 게이트)',
    `기력 있음 ${midSwing.rich.swinging ? 'O' : 'X'} · 없음 ${midSwing.poor.swinging ? 'O' : 'X'}`,
  )
  check(
    !midSwing.poor.opened,
    '   **기력이 없으면 안 열린다** (그래야 값이 값입니다)',
    `기력 ${midSwing.poor.can ? '있다고 나옴' : '없음'} · 열림 ${midSwing.poor.opened ? 'O' : 'X'}`,
  )

  /**
   * ── ③-4 ⏱ **「지금」 신호** — 언제는 박자가, 무엇은 색이 ──────────
   *
   * ── 왜 이 절이 필요한가 ───────────────────────────────────────
   * 자동 플레이에서 붙잡은 🔴 **26회 중 성공 4회**였습니다. 창이 0.18초인데
   * 화면이 알려 주는 것은 **차오르는 그라데이션**뿐입니다 — *"점점
   * 위험해진다"* 는 말하지만 ***"지금"*** 은 말하지 않습니다.
   *
   * ⚠️ **느낌은 봇으로 못 잽니다.** 봇은 숫자를 읽지 화면을 안 봅니다.
   *    그래서 여기서 재는 것은 *"이 신호가 사람에게 도움이 되는가"* 가
   *    **아니라** *"실제로 그려졌는가 · 제때 켜졌는가 · 켜져야 할 색에만
   *    켜졌는가"* 입니다. `npm run contrast` 가 색 대비를 **실제로 그려진
   *    픽셀**로 재는 것과 같은 자리입니다.
   */
  const beat = await page.evaluate(async () => {
    const G = window.__game
    /**
     * ⚠️ **이름표는 관측된 것에서 가져옵니다.**
     *
     * 처음엔 `duel('grunt','grunt_sweep')` 로 부르고 그 이름으로 결과를
     * 적었는데, 적이 스스로 고른 것은 `grunt_jab` 이었습니다. 그래서
     * *"🟡 인데 타이밍색 true"* 라는 말이 안 되는 줄이 나왔습니다 —
     * **요청한 것의 이름표를 붙이고 실제로 일어난 것을 재고** 있었습니다.
     *
     * 잡몹은 공격이 둘(🔴 찌르기 · 🟡 휩쓸기)뿐이므로, 한 마리를 오래
     * 지켜보면 둘 다 나옵니다. 그리고 `telegraphs()` 가 **자기가 무엇인지
     * 말해 주므로** 이름표를 제가 붙일 이유가 없습니다.
     */
    const win = G.guardInfo().window
    const byId = {}
    /**
     * ⚠️ **공격이 하나뿐인 적**을 씁니다.
     *
     * 잡몹으로 22초를 지켜봤더니 🔴 찌르기만 나왔고, *"아닌 색"* 표본이
     * 0이라 그 검사가 **공짜로 초록**이 됐습니다(게이트가 잡았습니다).
     * 굴림에 맡기면 표본이 안 모이는 판이 생깁니다.
     *
     * 얽는 자는 🔵 하나, 끄는 자는 🟣 하나뿐입니다(enemies.ts — 색 하나를
     * 확실히 가르치라고 그렇게 만든 적들입니다). 그래서 **반드시** 두 갈래가
     * 다 모입니다. 덤으로 🔴 이 아닌 **다른 타이밍 색(🔵)** 을 재게 됩니다.
     */
    for (const [kind, dist] of [
      ['binder', 4.0],
      ['dragger', 6.0],
    ]) {
      const { e } = await window.__t.duel(kind, null, dist)
      const dl = G.state().elapsed + 14
      while (G.state().elapsed < dl) {
        const t = G.telegraphs().find((x) => x.entity === e)
        if (t) {
          const r = (byId[t.attackId] ??= { timing: t.timing, inside: [], outside: [] })
          ;(t.left <= win ? r.inside : r.outside).push(t.opacity)
        }
        await new Promise((r2) => setTimeout(r2, 8))
      }
    }
    return Object.entries(byId).map(([atk, r]) => ({
      atk,
      timing: r.timing,
      // ⚠️ 빈 배열이면 **없다고 말합니다.** 0 으로 채우면 "어둡다"로 읽힙니다.
      inWindow: r.inside.length ? Math.max(...r.inside) : null,
      outWindow: r.outside.length ? Math.max(...r.outside) : null,
      nIn: r.inside.length,
      nOut: r.outside.length,
    }))
  })
  for (const b of beat) {
    console.log(
      `    ${b.atk} — 타이밍색 ${b.timing} · 창 밖 최대 ${b.outWindow}(${b.nOut}표본)` +
        ` → 창 안 최대 ${b.inWindow}(${b.nIn}표본)`,
    )
  }
  const timing = beat.filter((b) => b.timing && b.nIn > 0 && b.nOut > 0)
  const nonTiming = beat.filter((b) => !b.timing && b.nIn > 0)
  check(
    timing.length > 0 && nonTiming.length > 0,
    '③-4 타이밍 색과 아닌 색을 **둘 다** 관측했다 (측정이 성립했다)',
    beat.map((b) => `${b.atk}(${b.timing ? '타이밍' : '아님'})`).join(' · ') || '아무것도 못 봄',
  )
  /**
   * ⚠️ **처음에 세운 검사가 틀렸습니다.** *"타이밍이 아닌 색은 창 안에서
   *    안 밝아진다"* 로 잡았는데 빨갰습니다 — 🟡 도 끝으로 갈수록 밝아지기
   *    때문입니다. 그건 제 신호가 아니라 **원래 있던 그라데이션**
   *    (`0.16 + p×0.72`, 천장 0.88)입니다. 검사가 신호와 그라데이션을 한
   *    칸에 뭉쳐 놓고 있었습니다.
   *
   *    가르는 것은 **1.0 에 닿는가** 입니다 — 그라데이션은 0.88 에서 멈추고
   *    「지금」 신호만 끝까지 밉니다.
   */
  check(
    timing.length > 0 && timing.every((b) => b.inWindow >= 0.999),
    '   타이밍 색은 창 안에서 **끝까지 밝아진다** (「지금」이 보인다)',
    timing.map((b) => `${b.atk} ${b.outWindow}→${b.inWindow}`).join(' · '),
  )
  check(
    nonTiming.length > 0 && nonTiming.every((b) => b.inWindow < 0.999),
    '   아닌 색은 끝까지 안 갑니다 (걸어 나가는 색에 마지막 순간 신호는 **거짓말**입니다)',
    nonTiming.map((b) => `${b.atk} 최대 ${b.inWindow}`).join(' · '),
  )

  /**
   * ── ③-5 🔊 「지금」을 **귀로도** ─────────────────────────────────
   *
   * 화면의 「지금」 신호는 **그 적을 보고 있어야** 도움이 됩니다. 그런데
   * 벤치가 말합니다 — *"둘 이상과 싸우는 시간 **61%**, 최대 7마리"*.
   * 다 볼 수 없습니다. 세키로가 이 신호를 소리로 준 이유입니다.
   *
   * 여기서 재는 것: **예고 도중 소리가 한 번 더 나는가**, 그리고 그것이
   * **타이밍 색에서만** 나는가. 실제 파형이 났는지는 `npm run audio` 가
   * 따로 잽니다 — 여기서는 **제때 · 맞는 색에** 를 봅니다.
   */
  const beatSound = await page.evaluate(async () => {
    const G = window.__game
    /**
     * ⚠️ **소리를 먼저 켭니다.** 이 프로브는 여태 오디오를 열지 않았고,
     *    그래서 첫 측정에서 창 안팎이 **둘 다 0** 이었습니다. 그건
     *    "박자가 안 난다"가 아니라 **"아무 소리도 안 난다"** 입니다.
     *    그리고 *"아닌 색은 안 난다"* 검사가 `0 ≤ 0` 으로 **공짜로 초록**이
     *    됐습니다 — 혼자 초록인 검사는 대개 아무것도 안 재고 있습니다.
     */
    G.audio.unlock()
    await window.__t.runFor(0.3)
    const out = {}
    for (const [kind, dist] of [
      ['binder', 4.0],
      ['dragger', 6.0],
    ]) {
      const { e } = await window.__t.duel(kind, null, dist)
      const win = G.guardInfo().window
      let peakEarly = 0
      let peakLate = 0
      let id = ''
      let timing = null
      const dl = G.state().elapsed + 12
      while (G.state().elapsed < dl) {
        const t = G.telegraphs().find((x) => x.entity === e)
        if (t) {
          id = t.attackId
          timing = t.timing
          const v = G.audio.level()
          /**
           * ⚠️ 예고 **시작음**과 「지금」 박자를 갈라야 합니다. 시작음은
           *    예고가 뜨는 순간 한 번 울리므로, 창 밖 **후반**만 봅니다
           *    (시작음이 이미 잦아든 뒤). 안 가르면 "소리가 났다"가
           *    시작음인지 박자인지 알 수 없습니다.
           */
          if (t.left <= win) peakLate = Math.max(peakLate, v)
          else if (t.left <= win * 2.5) peakEarly = Math.max(peakEarly, v)
        }
        await new Promise((r) => setTimeout(r, 8))
      }
      out[id || kind] = {
        timing,
        early: Number(peakEarly.toFixed(4)),
        late: Number(peakLate.toFixed(4)),
      }
    }
    return out
  })
  for (const [id, v] of Object.entries(beatSound)) {
    console.log(`    ${id} — 타이밍색 ${v.timing} · 창 직전 ${v.early} → 창 안 ${v.late}`)
  }
  const bTiming = Object.values(beatSound).filter((v) => v.timing)
  const bOther = Object.values(beatSound).filter((v) => v.timing === false)
  check(
    bTiming.length > 0 &&
      bOther.length > 0 &&
      Object.values(beatSound).some((v) => v.early > 0.001 || v.late > 0.001),
    '③-5 소리가 실제로 나는 상태에서 쟀다 (측정이 성립했다)',
    Object.entries(beatSound)
      .map(([id, v]) => `${id} ${Math.max(v.early, v.late)}`)
      .join(' · '),
  )
  check(
    bTiming.length > 0 && bTiming.every((v) => v.late > v.early),
    '   타이밍 색은 창에 들어설 때 **소리가 한 번 더** 난다',
    bTiming.map((v) => `${v.early} → ${v.late}`).join(' · '),
  )
  check(
    bOther.length > 0 && bOther.every((v) => v.late <= v.early),
    '   아닌 색은 안 납니다 (걸어 나가는 색에 마지막 박자는 **거짓말**입니다)',
    bOther.map((v) => `${v.early} → ${v.late}`).join(' · '),
  )

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
        G.press(G.guardInfo().key)
        G.release(G.guardInfo().key)
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
    colors.length > 0 && colors.every((c) => c.gained === 0),
    '④ **🔴 말고는 안 막힌다** (가드가 만능 정답이 되지 않게)',
    colors
      .filter((c) => c.gained > 0)
      .map((c) => c.atk)
      .join(', ') || '전부 안 막힘',
  )

  /**
   * ── ⑤ **실제로 통하는 구간은 얼마인가** ──────────────────────────
   *
   * 설계값은 0.18초입니다. 그런데 자동 플레이의 깔때기는 이렇습니다:
   *
   *   창을 연 것 13회 · **헛친 것 12회** · 성공 2회
   *
   * 92%가 헛칩니다. 봇은 `timer <= 창` 일 때만 누르는데도요. 그러면 남은
   * 이야기는 둘인데 **처방이 정반대**입니다:
   *
   *   · 창은 제대로 0.18초인데 봇이 **늦게/일찍** 누른다  → 봇을 고침
   *   · 창이 실제로는 훨씬 **좁다**                        → 게임을 고침
   *
   * 지금까지 이걸 가를 자료가 없었습니다. 그래서 **쓸어 봅니다** —
   * 남은 예고를 여러 지점에서 잡아 누르고, 어디서 통하는지 표로 찍습니다.
   *
   * ⚠️ **프레임 시간을 같이 잽니다.** 이 컨테이너는 GPU 가 없어 8~20fps
   *    입니다. 프레임이 125ms 면 0.18초 창은 **1.4프레임**이고, 그러면
   *    "창이 좁다"의 정체가 밸런스가 아니라 **기계**입니다. 그 둘을 안
   *    갈라 놓으면 또 엉뚱한 값을 돌리게 됩니다(이번 라운드에 이미 한 번
   *    기계 속도를 밸런스 변화로 읽을 뻔했습니다).
   */
  console.log('')
  const dt = await page.evaluate(async () => {
    const G = window.__game
    /**
     * ⚠️ **최소값이 아니라 중앙값입니다.** 처음엔 최솟값을 썼는데, 그건
     *    *"가장 좋았던 한 프레임"* 이라 17ms 가 나왔습니다. 같은 판에서
     *    쓸기는 0.288 → 0.138초로 **한 걸음에 150ms** 를 건너뛰었습니다.
     *    두 숫자가 열 배 차이 나면 둘 중 하나는 거짓말입니다.
     */
    let prev = G.state().simElapsed
    const ds = []
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 4))
      const now = G.state().simElapsed
      const d = now - prev
      if (d > 0.0001) ds.push(d)
      prev = now
    }
    ds.sort((a, b) => a - b)
    return Number((ds[ds.length >> 1] ?? 0).toFixed(4))
  })
  console.log(`  [기계] 시뮬 한 프레임 ${(dt * 1000).toFixed(0)}ms — 창 ${rule.window}초 = ${(rule.window / dt).toFixed(1)}프레임`)

  /**
   * 누르는 시점을 **창의 배수**로 잡습니다 — 창 길이를 프로브가 베끼지
   * 않게(게임이 알려 준 `rule.window` 를 곱합니다). 1.0 을 넘는 지점은
   * *"일찍 누른 것"* 이라 실패가 정상입니다 — 표의 **위쪽 경계**입니다.
   */
  /**
   * ⚠️ **창 밖 표본이 안 잡혔습니다.** 처음엔 창의 1.6배까지만 올렸는데,
   *    프레임이 굵어서 조건이 참이 되는 순간 이미 창 안이었습니다 —
   *    `창×1.6 · 1.2 · 1.0` 이 **전부 같은 0.138초**로 찍혔습니다.
   *    그래서 위쪽 경계가 표본 0으로 남았고, 짝 없는 검사가 됐습니다.
   *    이제 창의 **여러 배**까지 올려서 확실히 밖에서 한 번 누릅니다.
   */
  const FRACTIONS = [6, 3, 1.6, 1.0, 0.8, 0.6, 0.4, 0.2]
  const sweep = []
  for (const f of FRACTIONS) {
    const r = await page.evaluate(
      async ({ f }) => {
        const G = window.__game
        const { e, idx } = await window.__t.duel('grunt', 'grunt_jab', 1.8)
        const hp0 = G.state().player.hp
        const c0 = G.guardInfo().count
        G.forceAttack(e, idx)
        const ok = await window.__t.until(() => {
          const i = G.enemyInfo(e)
          return !!i && i.winding && i.timer <= window.__game.guardInfo().window * f
        }, 4)
        // 실제로 **누른 순간에 남아 있던** 예고 — 의도가 아니라 사실을 적습니다.
        const left = G.enemyInfo(e)?.timer ?? -1
        G.press(G.guardInfo().key)
        G.release(G.guardInfo().key)
        await window.__t.runFor(0.9)
        return {
          reached: ok,
          left: Number(left.toFixed(3)),
          gained: G.guardInfo().count - c0,
          hurt: hp0 - G.state().player.hp,
        }
      },
      { f },
    )
    sweep.push({ f, ...r })
    console.log(
      `  창×${String(f).padEnd(4)} — 누를 때 남은 예고 ${String(r.left).padEnd(6)}초 · ` +
        `${r.gained > 0 ? '✅ 막음' : `❌ 못 막음(피해 ${r.hurt})`}`,
    )
  }

  /**
   * ⚠️ **위쪽 경계도 같이 봅니다.** 통한 구간만 세면 *"항상 통한다"* 와
   *    구분이 안 됩니다 — 창 밖(×1.6)에서도 막히면 그건 창이 아니라
   *    상시 가드입니다.
   */
  const inside = sweep.filter((r) => r.reached && r.left >= 0 && r.left <= rule.window)
  const worked = inside.filter((r) => r.gained > 0)
  check(
    inside.length >= 3 && worked.length >= Math.ceil(inside.length / 2),
    '⑤ 창 **안**에서 누르면 절반 이상 실제로 막힌다 (설계값이 실전값과 같은가)',
    `창 안 ${inside.length}지점 중 ${worked.length}지점 성공` +
      ` — ${inside.map((r) => `${r.left}초${r.gained > 0 ? '✅' : '❌'}`).join(' · ')}`,
  )
  /**
   * ⚠️ **위쪽 경계는 여기서 못 잽니다 — ②가 잽니다.**
   *
   * 처음엔 이 절에서 창의 6배까지 올려 "창 밖" 표본을 잡으려 했습니다.
   * `창×6 · 3 · 1.6 · 1` 이 **전부 같은 0.138초**로 찍혔습니다. 이유는
   * ② 주석에 이미 적혀 있었습니다 — `forceAttack` 은 예고를 **25% 남은
   * 지점**부터 시작합니다(0.138초). 이 훅을 쓰는 한 창 밖은 **원리적으로
   * 관측 불가능**합니다.
   *
   * 그래서 짝을 **새로 만들지 않고** ②의 결과를 그대로 씁니다. 같은 것을
   * 두 번 재면 언젠가 두 값이 갈립니다(이번 세션에 연계 장부에서 이미
   * 겪었습니다). ②는 `forceAttack` 없이 적이 스스로 휘두를 때까지 기다려
   * 남은 예고가 창보다 길다는 것을 **게이트로 확인한 뒤** 누릅니다.
   */
  console.log(
    `  [위쪽 경계는 ②가 잽니다] 남은 예고 ${early.leftAtPress}초(> 창 ${rule.window}초)에 눌러 ` +
      `${early.count === 0 ? '못 막음 ✅' : '막힘 ❌'} — forceAttack 은 예고 25% 지점부터라 여기선 못 잽니다`,
  )

  console.log('')
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
