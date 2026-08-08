/**
 * 🟡 광역 검증 — `npm run sweep`
 *
 * ── 왜 이 프로브가 생겼는가 ──────────────────────────────────────
 * 자동 플레이로 재보니 적의 **적중률이 7%** 였습니다(74회 휘둘러 5회).
 * 봇은 4색을 구분하지 못하고 **아무 예고에나 구르기만** 하는데도요.
 *
 * 원인은 판정이 active **첫 프레임에 한 번만** 나가는 것이었습니다.
 * 구르기 무적이 0.24초라 그 한 순간만 겹치면 광역기도 제자리에서 넘어갑니다.
 * DESIGN.md 4색 표에는 *"🟡 노랑 — 걸어서 이탈, 구르기로도 안쪽에 남습니다"*
 * 라고 적어 뒀는데 **실제로는 성립하지 않고 있었습니다.**
 *
 * ── 그래서 여기서 재는 것 ────────────────────────────────────────
 * 재야 할 것은 "광역이 세다"가 아니라 **"색마다 답이 다른가"** 입니다.
 *
 *   1) 🔴 직격은 제자리 구르기로 넘어간다      (구르기의 정체성 유지)
 *   2) 🟡 광역은 제자리 구르기로 **못** 넘어간다 (표의 주장이 사실이 됨)
 *   3) 🟡 광역도 **범위 밖으로 나가면** 안 맞는다 (막다른 길이 아님)
 *
 * 3번이 없으면 이 변경은 그냥 "노랑은 무조건 맞는다"가 되어, 읽을 이유가
 * 아니라 읽어도 소용없는 색이 됩니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5203
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
       * 잡몹 하나를 세우고, **지정한 색의 예고가 뜰 때까지** 기다렸다가
       * 예고가 끝나기 직전에 구릅니다. 그리고 맞았는지 봅니다.
       *
       * `escape` 가 참이면 구르기 전에 먼저 범위 밖으로 걸어 나갑니다.
       */
      trial: async (kind, wantId, escape) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.2)
        const p = G.state().player
        const e = G.spawnEnemyKind(kind, p.x + 12, p.z)
        await window.__t.runFor(0.2)
        G.setHp(e, 100000)
        for (let attempt = 0; attempt < 14; attempt++) {
          const es = G.entityState(e)
          G.teleportPlayer(es.x, es.z - 1.6)
          G.setHp(G.playerEntity(), 100)
          await window.__t.runFor(0.2)
          const got = await window.__t.until(() => {
            const info = G.enemyInfo(e)
            return info?.winding === true && info.attackId === wantId
          }, 6)
          if (!got) continue
          const info = G.enemyInfo(e)
          if (escape) {
            // 판정 반경 밖으로 순간이동 — "걸어서 이탈"과 같은 결과입니다.
            G.teleportPlayer(info.x, info.z - 13)
          }
          // 예고 종료 0.12초 전에 구릅니다 — 무적이 판정 순간에 걸리도록.
          await window.__t.until(() => (G.enemyInfo(e)?.timer ?? 9) <= 0.12, 3)
          const before = G.state().player.hp
          G.press('Space')
          G.release('Space')
          await window.__t.runFor(1.2)
          return { hp: G.state().player.hp, before, attackId: wantId }
        }
        return null
      },
    }
  })

  console.log('\n🟡 광역 검증\n')

  // ---- 1. 🔴 직격은 구르기로 넘어간다 ----
  /**
   * ⚠️ **세 번까지 시도하고, 한 번이라도 넘기면 통과입니다.**
   *
   * 주장은 *"🔴는 제자리 구르기로 넘길 수 있다"* 이지 *"아무 때나 굴러도
   * 넘어간다"* 가 아닙니다. 이 컨테이너는 프레임 간격이 들쭉날쭉해서
   * (GPU 없음, 10fps 안팎) 무적 0.24초와 판정 프레임이 어긋나는 판이
   * 섞입니다 — 실제로 같은 코드에서 세 번 돌려 2승 1패가 나왔습니다.
   * 한 번 실패로 빨간 줄을 띄우면 **게임이 아니라 프레임 운을 재는** 검사가
   * 됩니다. 반대로 시도를 늘려도 "넘길 수 있다"는 주장은 약해지지 않습니다.
   */
  const attempts = []
  let strike = null
  for (let i = 0; i < 3; i++) {
    const r = await page.evaluate(() => window.__t.trial('grunt', 'grunt_jab', false))
    if (!r) continue
    strike = r
    attempts.push(`${r.before}→${r.hp}`)
    if (r.hp === r.before) break
  }
  check(strike !== null, '🔴 직격 예고를 관측했다')
  if (strike) {
    check(
      attempts.some((a) => {
        const [b, h] = a.split('→').map(Number)
        return b === h
      }),
      '🔴 직격은 제자리 구르기로 넘길 수 있다 (구르기의 정체성)',
      `시도 [${attempts.join(' · ')}]`,
    )
  }

  // ---- 2. 🟡 광역은 제자리 구르기로 못 넘어간다 ----
  /**
   * **보스의 광역(7.5m)으로 잽니다.**
   *
   * 처음엔 잡몹 광역(4.6m)으로 쟀는데 안 맞았습니다 — 그건 정상입니다.
   * 코앞(1.6m)에서 뒤로 4.2m 구르면 5.8m 로 **반경 밖**입니다. 즉 잡몹
   * 광역은 구르기가 정당한 답입니다. DESIGN.md 표에 *"구르기로도 안쪽에
   * 남습니다"* 라고 뭉뚱그려 적어 둔 것이 부정확했습니다 —
   * 그 주장은 **반경 7.5m 인 보스 광역**에나 해당합니다.
   */
  const sweep = await page.evaluate(() => window.__t.trial('boss', 'boss_quake', false))
  check(sweep !== null, '🟡 광역 예고를 관측했다')
  if (sweep) {
    check(
      sweep.hp < sweep.before,
      '🟡 광역은 제자리 구르기로 못 넘어간다 (표의 주장이 사실이 됨)',
      `체력 ${sweep.before} → ${sweep.hp}`,
    )
  }

  // ---- 3. 그래도 범위 밖으로 나가면 안 맞는다 ----
  const escaped = await page.evaluate(() => window.__t.trial('boss', 'boss_quake', true))
  check(escaped !== null, '🟡 광역 예고를 다시 관측했다')
  if (escaped) {
    check(
      escaped.hp === escaped.before,
      '🟡 범위 밖으로 나가면 안 맞는다 (읽을 이유가 있는 색으로 남음)',
      `체력 ${escaped.before} → ${escaped.hp}`,
    )
  }

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
