/**
 * 🥋 집중 검증 — `npm run focus`
 *
 * ── 무엇을 재는가 ────────────────────────────────────────────────
 * 집중의 목적은 **"큰 숫자 하나 추가"가 아닙니다.** 두 가지를 바꾸려고
 * 넣은 것입니다:
 *   · 기본 공격에 "지금 태울까, 더 모을까"라는 **결정**을 주기
 *   · 구르기를 방어가 아니라 **공격 준비**로 바꾸기
 *
 * 그래서 재는 것도 그 둘입니다:
 *   1) 기본 공격 3타 = 1점인가 (손에 남는 단위인가)
 *   2) **맞을 공격을 넘겼을 때만** 완벽 회피가 되는가
 *      — 아무 때나 굴러도 쌓이면 그건 자원이 아니라 시간입니다
 *   3) 태운 점수만큼 강타가 세지는가 (모아 쓰는 것이 실제로 이득인가)
 *   4) 상한을 넘겨 쌓이지 않는가
 *   5) 스킬로는 안 쌓이는가 (한 줄기 흐름이 되지 않게)
 *
 * ⚠️ 수치를 베껴 적지 않습니다. FOCUS 설정을 게임에서 읽어 계산합니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5198
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
      /** 잡몹 하나를 앞에 세우고 집중을 0으로 맞춥니다. */
      dummy: async (dist = 1.8) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.2)
        const p = G.state().player
        const e = G.spawnEnemyKind('grunt', p.x + 12, p.z)
        await window.__t.runFor(0.2)
        const es = G.entityState(e)
        G.setHp(e, 100000) // 시험 중에 죽으면 측정이 끊깁니다
        G.teleportPlayer(es.x, es.z - dist)
        G.setFocus(0)
        await window.__t.runFor(0.2)
        return e
      },
    }
  })

  console.log('\n🥋 집중 검증\n')

  const cfg = await page.evaluate(() => window.__game.focusInfo())
  console.log(
    `  [설정] 상한 ${cfg.max} · 기본 공격 +${cfg.perLightHit} · 완벽 회피 +${cfg.perPerfectDodge} · 점당 피해 +${Math.round(cfg.damagePerPoint * 100)}%\n`,
  )

  // ---- 1. 기본 공격 3타 = 1점 ----
  const light = await page.evaluate(async () => {
    const G = window.__game
    const e = await window.__t.dummy()
    const es = G.entityState(e)
    const got = []
    for (let i = 0; i < 3; i++) {
      G.aimAtWorld(es.x, es.z)
      G.press('Mouse0')
      G.release('Mouse0')
      await window.__t.runFor(0.55)
      got.push(Number(G.focusInfo().focus.toFixed(2)))
    }
    return got
  })
  check(
    light[2] >= 1,
    '기본 공격 3타면 집중 1점이 찬다 (콤보 하나 = 1점)',
    `${light.join(' → ')}`,
  )

  // ---- 2. 완벽 회피는 **맞을 공격**을 넘겼을 때만 ----
  //
  // 먼저 "아무 때나 구르기"를 재고, 다음에 "예고를 보고 구르기"를 잽니다.
  // 둘이 같은 값이면 이 자원은 그냥 시간으로 살 수 있는 것이 됩니다.
  const idleRoll = await page.evaluate(async () => {
    const G = window.__game
    await window.__t.dummy(14) // 멀리 — 아무 공격도 안 닿는 거리
    for (let i = 0; i < 5; i++) {
      G.press('Space')
      G.release('Space')
      await window.__t.runFor(0.7)
    }
    return Number(G.focusInfo().focus.toFixed(2))
  })
  check(idleRoll === 0, '허공에 구르는 것으로는 집중이 쌓이지 않는다', `${idleRoll}점`)

  const timedRoll = await page.evaluate(async () => {
    const G = window.__game
    const e = await window.__t.dummy(1.8)
    /**
     * ⚠️ **횟수를 세지 말고 될 때까지 시도합니다.**
     *
     * 예전엔 `dodges < 2` 로 두 번만 시도하고 끝냈습니다. 완벽 회피는
     * 타이밍이라 이 기계(GPU 없음, 프레임 흔들림)에서는 두 번으로 안 찹니다 —
     * `2번 시도 · 0점` 으로 빨갛게 떴습니다. 그런데 바로 아래 2b 는 **같은
     * 설정**인데 통과합니다. 차이는 하나뿐이었습니다: 2b 는 창이 열릴
     * 때까지 **계속** 시도합니다.
     *
     * 즉 게임이 아니라 **표본이 모자랐습니다.** 재려는 것은 *"두 번 만에
     * 되는가"* 가 아니라 *"무적으로 넘기면 집중이 쌓이는가"* 입니다.
     * 안 차면 그 사실이 그대로 빨갛게 나오도록, 시도 횟수도 함께 냅니다.
     */
    let dodges = 0
    const until = G.state().elapsed + 20
    while (G.state().elapsed < until && G.focusInfo().focus <= 0) {
      const info = G.enemyInfo(e)
      if (!info) break
      /**
       * **예고가 끝나기 0.15초 전**에 구릅니다.
       *
       * 처음엔 "예고가 끝날 때까지 기다렸다가" 굴렀는데, 그때는 이미 판정이
       * 지나간 뒤였습니다(집중 0점). 구르기 무적은 시작 0.06초부터 0.30초까지라,
       * **판정 순간이 그 창 안에 들어오도록** 미리 굴러야 합니다.
       * 이것도 계측기가 조건을 못 맞춘 경우였습니다 — 기능은 멀쩡했습니다.
       */
      if (info.winding && info.timer <= 0.15) {
        G.press('Space')
        G.release('Space')
        dodges++
        await window.__t.runFor(0.6)
      }
      await new Promise((r) => setTimeout(r, 8))
    }
    return { focus: Number(G.focusInfo().focus.toFixed(2)), dodges }
  })
  check(
    timedRoll.focus > 0,
    '맞을 공격을 무적 프레임으로 넘기면 집중이 쌓인다 (구르기가 공격 준비가 됨)',
    `${timedRoll.dodges}번 시도 · ${timedRoll.focus}점`,
  )

  /**
   * ---- 2b. 완벽 회피의 **즉시** 보상 — 확정 치명타 창 ----
   *
   * 집중은 나중에 쓸 자원입니다. 넘긴 그 순간 손에 쥐는 게 없으면
   * "잘했다"가 느낌으로 안 옵니다. 그래서 창을 하나 더 엽니다.
   *
   * 여기서 재는 것은 **치명타가 떴는가**가 아니라 **창이 열리고 닫히는가**
   * 입니다. 치명타는 기본 확률로도 뜨니 한두 번 떴다고 확정이라는 증거가
   * 못 됩니다. 창의 개폐는 확률이 안 끼는 값이라 한 번으로 판정됩니다.
   */
  const critWindow = await page.evaluate(async () => {
    const G = window.__game
    const e = await window.__t.dummy(1.8)
    const win = G.focusInfo().perfectDodgeCritWindow
    let opened = -1
    const until = G.state().elapsed + 20
    while (G.state().elapsed < until) {
      const info = G.enemyInfo(e)
      if (!info) break
      if (info.winding && info.timer <= 0.15) {
        G.press('Space')
        G.release('Space')
        await window.__t.runFor(0.5)
        opened = G.focusInfo().critT
        if (opened > 0) break
      }
      await new Promise((r) => setTimeout(r, 8))
    }
    if (opened <= 0) return { opened: 0 }
    /**
     * ⚠️ **굴렀으면 멀어져 있습니다.** 처음엔 그 자리에서 그냥 쳤는데
     * 치명타 0회였습니다 — 기능이 아니라 계측기 문제였습니다. 구르기는
     * 4.2m 를 가고 무기 사거리는 그보다 짧으니, 헛방을 친 것입니다.
     *
     * 사람이 실제로 하는 것을 그대로 합니다: **다가가서** 칩니다.
     * 이 재현이 중요한 이유가 하나 더 있습니다 — 다가가는 데 드는
     * 시간이 창보다 길면 보상은 설계상 못 받는 것이 됩니다.
     * 그러면 고칠 곳은 창 길이지 프로브가 아닙니다.
     */
    const held = new Set()
    const hold = (k) => { if (!held.has(k)) { held.add(k); G.press(k) } }
    const release = (k) => { if (held.has(k)) { held.delete(k); G.release(k) } }
    const moveToward = (dx, dz) => {
      const cam = G.cameraAxes()
      const fwd = dx * cam.forwardX + dz * cam.forwardZ
      const right = dx * cam.rightX + dz * cam.rightZ
      const dead = 0.25
      fwd > dead ? hold('KeyW') : release('KeyW')
      fwd < -dead ? hold('KeyS') : release('KeyS')
      right > dead ? hold('KeyD') : release('KeyD')
      right < -dead ? hold('KeyA') : release('KeyA')
    }
    const critsBefore = G.state().critHits
    const openedAt = G.state().simElapsed
    let dist = 99
    // 창이 남아 있는 동안만 다가갑니다 — 창 밖에서 때리면 검사가 무의미합니다.
    while (G.focusInfo().critT > 0) {
      const info = G.enemyInfo(e)
      const p = G.state().player
      if (!info) break
      dist = Math.hypot(info.x - p.x, info.z - p.z)
      if (dist < 2.0) break
      moveToward(info.x - p.x, info.z - p.z)
      // 겨냥은 매 프레임 적에게. 안 하면 다가가긴 해도 **딴 데를 칩니다.**
      G.aimAtWorld(info.x, info.z)
      await new Promise((r) => setTimeout(r, 8))
    }
    for (const k of [...held]) release(k)
    const closedIn = G.state().simElapsed - openedAt
    // 창이 열린 채로 한 대 칩니다. 창은 이 한 방에 닫혀야 합니다.
    const info2 = G.enemyInfo(e)
    if (info2) G.aimAtWorld(info2.x, info2.z)
    const hpBefore = info2 ? info2.hp : 0
    G.press('Mouse0')
    G.release('Mouse0')
    await window.__t.runFor(0.9)
    return {
      opened,
      win,
      dist: Number(dist.toFixed(2)),
      closedIn: Number(closedIn.toFixed(2)),
      closed: G.focusInfo().critT,
      crits: G.state().critHits - critsBefore,
      // 맞았는지부터 확인합니다 — 헛방이면 창이 소비된 게 아니라 만료된 것입니다.
      landed: (() => { const i = G.enemyInfo(e); return i ? Number((hpBefore - i.hp).toFixed(1)) : -1 })(),
    }
  })
  check(
    critWindow.opened > 0,
    '완벽 회피 순간 확정 치명타 창이 열린다',
    critWindow.opened > 0
      ? `${critWindow.opened.toFixed(2)}초 남음 (창 ${critWindow.win}초)`
      : '창이 열리지 않았습니다 — 완벽 회피를 못 만들었거나 보상이 안 붙었습니다',
  )
  check(
    critWindow.opened > 0 && critWindow.crits >= 1 && critWindow.closed === 0,
    '그 창에서 다가가 때리면 치명타가 나고 창이 닫힌다 (한 방만)',
    critWindow.opened > 0
      ? `${critWindow.closedIn}초 걸려 ${critWindow.dist}m 까지 접근 · ${critWindow.landed} 피해 · 치명타 ${critWindow.crits}회 · 남은 창 ${critWindow.closed}초`
      : '앞 검사가 실패해 잴 수 없었습니다',
  )

  // ---- 3. 태운 점수만큼 강타가 세진다 ----
  const heavy = await page.evaluate(async () => {
    const G = window.__game
    const out = []
    for (const points of [1, 3]) {
      const e = await window.__t.dummy()
      const es = G.entityState(e)
      G.setFocus(points)
      const before = G.entityState(e).hp
      G.aimAtWorld(es.x, es.z)
      G.press('Mouse2')
      G.release('Mouse2')
      await window.__t.runFor(0.9)
      const after = G.entityState(e)
      out.push({ points, damage: Number((before - after.hp).toFixed(1)), left: G.focusInfo().focus })
    }
    return out
  })
  const [one, three] = heavy
  check(one.damage > 0, '강타가 실제로 적중한다', `1점 강타 ${one.damage} 피해`)
  check(
    three.damage > one.damage,
    '집중을 많이 태울수록 강타가 세진다 (모아 쓰는 것이 이득)',
    `1점 ${one.damage} → 3점 ${three.damage} (${(three.damage / one.damage).toFixed(2)}배)`,
  )
  check(one.left < 1, '강타는 모아둔 집중을 전부 태운다', `사용 후 ${one.left}점`)

  // ---- 4. 상한 ----
  const cap = await page.evaluate(async () => {
    const G = window.__game
    const e = await window.__t.dummy()
    const es = G.entityState(e)
    const until = G.state().elapsed + 14
    while (G.state().elapsed < until) {
      G.aimAtWorld(es.x, es.z)
      G.press('Mouse0')
      G.release('Mouse0')
      await new Promise((r) => setTimeout(r, 8))
    }
    return Number(G.focusInfo().focus.toFixed(2))
  })
  check(cap <= cfg.max, '집중이 상한을 넘지 않는다', `${cap} / ${cfg.max}`)
  check(cap >= 1, '계속 때리면 실제로 모인다 (기준선)', `${cap}점`)

  // ---- 5. 스킬로는 안 쌓입니다 ----
  const bySkill = await page.evaluate(async () => {
    const G = window.__game
    const e = await window.__t.dummy(2.2)
    const es = G.entityState(e)
    for (let i = 0; i < 3; i++) {
      G.aimAtWorld(es.x, es.z)
      G.press('KeyQ')
      G.release('KeyQ')
      await window.__t.runFor(1.2)
    }
    return Number(G.focusInfo().focus.toFixed(2))
  })
  check(
    bySkill === 0,
    '스킬로는 집중이 쌓이지 않는다 (근접에 머문 대가로 주는 자원)',
    `${bySkill}점`,
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
