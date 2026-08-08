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
    let dodges = 0
    const until = G.state().elapsed + 20
    while (G.state().elapsed < until && dodges < 2) {
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
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
