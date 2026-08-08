/**
 * 🟢 반격 검증 — `npm run counter`
 *
 * ── 무엇을 재는가 ────────────────────────────────────────────────
 * 이 기능의 목적은 "새 동사를 하나 추가하는 것"입니다. 그러니 재야 할 것도
 * **"작동한다"가 아니라 "다른 동사가 맞는가"** 입니다.
 *
 *   1) 예고 중 **정면**에서 때리면 성립하는가
 *   2) **등 뒤**에서는 성립하지 않는가 — 여기가 핵심입니다.
 *      등 뒤에서도 되면 백어택이 또 만능 정답이 되고, 새 동사를 가르치려던
 *      것이 옛 동사의 보너스로 흡수됩니다.
 *   3) 예고가 **끝난 뒤**에는 성립하지 않는가 (타이밍이 실제로 요구되는가)
 *   4) 성립하면 무방비가 일반 무너짐보다 **확실히 긴가**
 *   5) 그냥 연타로는 예고를 못 끊는가 (초록이 "세게 때리면 되는 색"이 아닌가)
 *
 * ⚠️ 수치를 베껴 적지 않습니다. COUNTER/POISE 설정을 게임에서 읽어 비교합니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5196
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
       * 달려드는 자 하나만 세우고, 플레이어를 지정한 **각도**에 놓습니다.
       * angle 0 = 적의 정면, PI = 등 뒤.
       */
      duel: async (angle, dist) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.2)
        const p = G.state().player
        const e = G.spawnEnemyKind('charger', p.x + 14, p.z)
        await window.__t.runFor(0.2)
        const es = G.entityState(e)
        // 적이 바라보는 방향(rotY=0 이면 +Z). 그 기준으로 각도를 잡습니다.
        const rot = G.enemyInfo(e).rotY
        const a = rot + angle
        G.teleportPlayer(es.x + Math.sin(a) * dist, es.z + Math.cos(a) * dist)
        await window.__t.runFor(0.15)
        return e
      },
    }
  })

  console.log('\n🟢 반격 검증\n')

  const cfg = await page.evaluate(() => window.__game.counterInfo())
  console.log('  (반격은 **스킬**로만 성립합니다 — 기본 공격 연타로는 안 됩니다)')
  console.log(
    `  [설정] 무방비 ${cfg.brokenTime}초 (일반 무너짐 ${cfg.normalBrokenTime}초) · 피해 배율 ${cfg.damageMultiplier}\n`,
  )

  /** 예고가 뜰 때까지 기다렸다가 한 대 때립니다. */
  const strikeDuringWindup = await page.evaluate(async () => {
    const G = window.__game
    const e = await window.__t.duel(0, 2.0) // 정면 2m
    const winding = await window.__t.until(() => G.enemyInfo(e)?.winding === true, 12)
    if (!winding) return { ok: false }
    const es = G.entityState(e)
    G.aimAtWorld(es.x, es.z)
    G.press('KeyQ')
    G.release('KeyQ')
    await window.__t.runFor(0.6)
    const after = G.entityState(e)
    return { ok: true, after, counters: G.counterCount() }
  })
  check(strikeDuringWindup.ok, '🟢 예고를 관측했다')
  if (strikeDuringWindup.ok) {
    check(strikeDuringWindup.counters > 0, '정면에서 예고 중에 때리면 반격이 성립한다')
    check(
      strikeDuringWindup.after.brokenT > cfg.normalBrokenTime,
      '반격의 무방비가 일반 무너짐보다 길다',
      `${strikeDuringWindup.after.brokenT}초 > ${cfg.normalBrokenTime}초`,
    )
  }

  /**
   * ---- 등 뒤에서는 성립하지 않아야 합니다 ----
   *
   * 순서가 중요합니다. 처음에는 **먼저 등 뒤에 세우고 예고를 기다렸는데**,
   * 그 사이 적이 플레이어 쪽으로 몸을 돌려버려서 예고가 뜰 무렵엔 이미
   * 정면이었습니다. 프로브는 "등 뒤에서도 반격된다"고 보고했지만 게임은
   * 정상이었습니다 — **관측이 조건을 유지하지 못한 것**입니다.
   * 그래서 예고가 시작된 **뒤에** 등 뒤로 옮깁니다(예고 중에는 안 돕니다).
   */
  const fromBehind = await page.evaluate(async () => {
    const G = window.__game
    const e = await window.__t.duel(0, 2.0)
    const base = G.counterCount()
    const winding = await window.__t.until(() => G.enemyInfo(e)?.winding === true, 12)
    if (!winding) return { ok: false }
    const info = G.enemyInfo(e)
    // 적의 정면 반대쪽으로 옮깁니다.
    const a = info.rotY + Math.PI
    G.teleportPlayer(info.x + Math.sin(a) * 1.6, info.z + Math.cos(a) * 1.6)
    await window.__t.runFor(0.05)
    const still = G.enemyInfo(e)
    G.aimAtWorld(still.x, still.z)
    G.press('KeyQ')
    G.release('KeyQ')
    await window.__t.runFor(0.4)
    return { ok: true, gained: G.counterCount() - base, wasWinding: still.winding }
  })
  check(
    fromBehind.ok && fromBehind.gained === 0,
    '등 뒤에서는 반격이 성립하지 않는다 (백어택이 또 만능 정답이 되지 않게)',
    `반격 ${fromBehind.gained}회 (예고 유지 ${fromBehind.wasWinding})`,
  )

  // ---- 예고가 끝난 뒤에는 늦어야 합니다 ----
  const tooLate = await page.evaluate(async () => {
    const G = window.__game
    const e = await window.__t.duel(0, 2.0)
    const base = G.counterCount()
    // 예고가 끝나 판정/후딜로 넘어갈 때까지 기다립니다.
    await window.__t.until(() => G.enemyInfo(e)?.winding === true, 12)
    await window.__t.until(() => G.enemyInfo(e)?.winding === false, 4)
    const es = G.entityState(e)
    G.aimAtWorld(es.x, es.z)
    G.press('KeyQ')
    G.release('KeyQ')
    await window.__t.runFor(0.5)
    return { gained: G.counterCount() - base }
  })
  check(
    tooLate.gained === 0,
    '예고가 끝난 뒤에 때리면 반격이 아니다 (타이밍이 실제로 요구된다)',
    `반격 ${tooLate.gained}회`,
  )

  /**
   * ---- 초록 예고를 끊는 것은 **오직 반격**이어야 합니다 ----
   *
   * 처음엔 "비스듬히 뒤에 서서 연타하면 반격이 안 된다"를 재려 했는데,
   * 8초 동안 적이 플레이어 쪽으로 몸을 돌려서 각도가 유지되지 않았습니다.
   * **재려던 주장 자체가 성립하지 않는 주장**이었습니다.
   *
   * 실제로 물어야 할 것은 이것입니다: 초록 예고가 끊길 때, 그건 **강인도를
   * 깎아서**인가 **반격해서**인가. 전자가 섞이면 초록은 "세게 때리면 되는 색"이
   * 되어 새 동사가 안 배워집니다. 달려드는 자의 강인도를 45로 높인 이유가
   * 이것이고, 여기서 그게 실제로 작동하는지 봅니다.
   */
  const spam = await page.evaluate(async () => {
    const G = window.__game
    const e = await window.__t.duel(0, 2.0)
    // 8초 동안 살아 있어야 의미가 있습니다. 처음엔 죽어버려서 "반격 0회"가
    // 그냥 **아무 일도 안 일어난 것**이었습니다(강인도 0으로 드러났습니다).
    G.setHp(e, 100000)
    const base = G.counterCount()
    /**
     * ⚠️ **끊김은 게임이 셉니다.**
     *
     * 처음엔 8ms마다 `broken` 을 관측해서 전이를 셌습니다. 그런데 처형이
     * 들어가면 무방비가 **즉시 닫혀서** 관측을 통째로 놓칩니다 —
     * 실제로 "반격 1회 · 관측된 끊김 0회" 라는 앞뒤 안 맞는 결과가 나왔습니다.
     * 사건은 사건이 일어난 자리(combat.ts breakPoise)에서 기록해야 합니다.
     */
    const baseWindupBreaks = G.runStats().windupBreaks
    let landed = 0
    const until = G.state().elapsed + 8
    let wasActive = false
    while (G.state().elapsed < until) {
      const s = G.enemyInfo(e)
      if (!s) break
      // **예고 중에 끊긴 것만** 셉니다.
      // 처음엔 무너짐 전체를 셌는데, 예고가 아닐 때(쿨다운 중) 강인도가 차서
      // 무너지는 것은 지극히 정상입니다. 그것까지 세면 "반격만이 끊는다"가
      // 아니라 "이 적은 절대 안 무너진다"를 요구하게 됩니다 — 틀린 요구입니다.
      const active = s.attacking && s.attackPhase === 1
      if (active && !wasActive) landed++
      wasActive = active
      G.aimAtWorld(s.x, s.z)
      // 좌클릭 연타 + 쿨마다 스킬. "마구 눌러도 되는가"를 재는 자리입니다.
      G.press('Mouse0')
      G.release('Mouse0')
      G.press('KeyQ')
      G.release('KeyQ')
      await new Promise((r) => setTimeout(r, 8))
    }
    const info = G.enemyInfo(e)
    return {
      breaks: G.runStats().windupBreaks - baseWindupBreaks,
      landed,
      counters: G.counterCount() - base,
      poiseMax: info?.poiseMax ?? 0,
    }
  })
  check(
    spam.breaks === spam.counters,
    '예고 중에 초록이 끊긴 것은 전부 반격이었다 (강인도 연타로는 못 끊는다)',
    `예고 중 무너짐 ${spam.breaks}회 = 반격 ${spam.counters}회 · 강인도 ${spam.poiseMax}`,
  )
  console.log(
    `     (참고: 정면에서 8초 연타 — 초록이 실제로 터진 횟수 ${spam.landed}회.` +
      ` 0이면 정면 연타만으로 이 적이 무력화된다는 뜻입니다)`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
