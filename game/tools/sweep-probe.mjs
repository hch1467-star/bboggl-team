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
      /**
       * 🚶 **정말 걸어서 벗어날 수 있는가.**
       *
       * ── 왜 이게 따로 필요한가 ──────────────────────────────────
       * 아래 `trial(escape=true)` 는 범위 밖으로 **순간이동**시킵니다.
       * 주석에는 *"'걸어서 이탈'과 같은 결과입니다"* 라고 적혀 있는데,
       * 그 등호가 한 번도 검사된 적이 없습니다. 그리고 자동 플레이
       * 벤치가 정확히 그 등호를 반증했습니다:
       *
       *     4대  다른적  🟡광역  정답: 걸어서 이탈  **발: 걸었지만**
       *     4대  일찍   🟡광역  정답: 걸어서 이탈  **발: 걸었지만**
       *
       * 정답대로 **걸어서 빠져나가려 했는데 맞았습니다.** 순간이동은
       * *"밖에 있으면 안 맞는다"* 만 증명하지, *"예고 안에 밖으로 나갈 수
       * 있다"* 는 증명하지 않습니다. **조리법이 아니라 요리를 잽니다.**
       *
       * 그래서 예고가 뜬 그 순간부터 **키를 눌러 실제로 걸어** 나갑니다.
       * 맞았는지, 그리고 판정이 나갈 때 얼마나 벗어나 있었는지를 함께
       * 돌려줍니다 — 아슬아슬하게 실패한 것과 한참 모자란 것은 처방이
       * 다릅니다(속도 · 예고 길이 · 반경).
       */
      /**
       * @param delay 예고가 뜬 뒤 **가만히 서 있는** 시간(시뮬레이션초).
       *              0 이면 예전과 같습니다(사람이 낼 수 있는 최선).
       */
      walkOut: async (kind, wantId, delay = 0) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.2)
        const p0 = G.state().player
        const e = G.spawnEnemyKind(kind, p0.x + 12, p0.z)
        await window.__t.runFor(0.2)
        G.setHp(e, 100000)
        /** 카메라 축으로 "적 반대쪽" 을 누릅니다 — 쿼터뷰라 W가 북쪽이 아닙니다. */
        const walkAway = (ex, ez) => {
          const s = G.state().player
          const cam = G.cameraAxes()
          const dx = s.x - ex
          const dz = s.z - ez
          const fwd = dx * cam.forwardX + dz * cam.forwardZ
          const right = dx * cam.rightX + dz * cam.rightZ
          const dead = 0.25
          for (const [k, v] of [
            ['KeyW', fwd > dead],
            ['KeyS', fwd < -dead],
            ['KeyD', right > dead],
            ['KeyA', right < -dead],
          ]) {
            if (v) G.press(k)
            else G.release(k)
          }
        }
        const stop = () => ['KeyW', 'KeyA', 'KeyS', 'KeyD'].forEach((k) => G.release(k))
        for (let attempt = 0; attempt < 14; attempt++) {
          const es = G.entityState(e)
          stop()
          // 사거리 **안쪽 가장자리**에서 시작합니다 — 코앞이면 너무 쉽고,
          // 밖이면 애초에 맞을 일이 없어 아무것도 안 재는 검사가 됩니다.
          G.teleportPlayer(es.x, es.z - 1.6)
          G.setHp(G.playerEntity(), 100)
          await window.__t.runFor(0.25)
          const got = await window.__t.until(() => {
            const info = G.enemyInfo(e)
            return info?.winding === true && info.attackId === wantId
          }, 6)
          if (!got) continue
          const before = G.state().player.hp
          const startInfo = G.enemyInfo(e)
          const tele = startInfo.timer
          // 예고가 뜬 **그 순간부터** 걷습니다. 사람이 낼 수 있는 최선입니다.
          /**
           * ── ⏱ **늦게 출발해도 되는가** ────────────────────────────────
           *
           * `delay` 만큼 **가만히 서 있다가** 걷기 시작합니다. 0 이면 예전
           * 그대로입니다.
           *
           * 왜 필요한가: 이 검사는 지금까지 *"예고가 뜬 순간부터 걸으면
           * 벗어난다"* 만 말했습니다. 그건 **반응 시간이 0인 사람**의
           * 이야기입니다. 사람은 색을 보고, 그게 구를 색이 아님을 알고,
           * 방향을 정하고, 그다음에 손이 움직입니다.
           *
           * 참고 게임이 광역을 공정하게 만드는 방법이 정확히 이 여유입니다 —
           * FF14·로스트아크의 장판은 **읽고 나서도 걸어 나갈 시간**이 남게
           * 잡혀 있습니다. 여유가 반응 시간보다 짧으면 그 색은 "읽는 색"이
           * 아니라 **미리 아는 색**이 됩니다(외워야 하는 것).
           */
          if (delay > 0) await window.__t.runFor(delay)
          /**
           * ⚠️ **판정이 나가는 순간의 거리**를 잡습니다.
           *
           * 처음엔 반복문이 끝난 뒤의 거리를 적었는데, 그 반복문은 후딜이
           * 끝날 때까지 돕니다. 그래서 22.18m 같은 값이 나왔습니다 —
           * 예고 1.9초 동안 걸을 수 있는 거리(약 11m)의 두 배입니다.
           * **맞았는지**는 맞았지만 *"얼마나 여유였나"* 는 거짓말이었고,
           * 이 숫자는 바로 그 여유를 재라고 있는 것입니다.
           */
          let far = 0
          let farAtHit = -1
          const deadline = Date.now() + 30000
          while (Date.now() < deadline) {
            const info = G.enemyInfo(e)
            if (!info) break
            walkAway(info.x, info.z)
            const s = G.state().player
            far = Math.hypot(s.x - info.x, s.z - info.z)
            // 예고가 끝나는 그 프레임 = 판정이 나가는 순간.
            if (!info.winding && farAtHit < 0) farAtHit = far
            if (!info.winding && info.state !== 1) break
            await new Promise((r) => setTimeout(r, 8))
          }
          stop()
          await window.__t.runFor(0.3)
          return {
            hp: G.state().player.hp,
            before,
            /** 예고 길이(초) — 얼마나 걸을 시간이 있었나 */
            telegraph: Number(tele.toFixed(2)),
            /** 판정이 **나가는 순간** 적과의 거리(m) — 여유가 얼마였나 */
            far: Number((farAtHit >= 0 ? farAtHit : far).toFixed(2)),
          }
        }
        return null
      },
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

  /**
   * ---- 3.5 🚶 **순간이동 말고 진짜 걸어서** 벗어날 수 있는가 ----
   *
   * 위 3번은 순간이동으로 *"밖에 있으면 안 맞는다"* 를 증명합니다. 그건
   * 이 색의 **정답이 성립하는지**를 증명하지 않습니다. 벤치가 그 차이를
   * 찍었습니다 — 봇이 정답대로 걸었는데 9대를 맞았습니다.
   *
   * ⚠️ 세 번 시도해 **한 번이라도 벗어나면** 통과입니다. 위 1번과 같은
   *    이유입니다 — GPU 없는 이 컨테이너의 프레임 흔들림까지 재면
   *    게임이 아니라 기계 운을 재게 됩니다.
   *
   * 사거리 밖으로 나갔는지는 **거리로도 함께 찍습니다.** 아슬아슬하게
   * 실패한 것(속도·예고를 조금 손볼 일)과 한참 모자란 것(반경이 잘못된
   * 일)은 처방이 다릅니다.
   */
  {
    const tries = []
    let walked = null
    for (let i = 0; i < 3; i++) {
      const r = await page.evaluate(() => window.__t.walkOut('boss', 'boss_quake'))
      if (!r) continue
      walked = r
      tries.push(r)
      if (r.hp === r.before) break
    }
    check(walked !== null, '🚶 광역 예고를 관측하고 실제로 걸어 봤다')
    if (walked) {
      check(
        tries.some((r) => r.hp === r.before),
        '🚶 **예고가 뜬 순간부터 걸으면 벗어난다** (이 색의 정답이 실제로 성립한다)',
        tries
          .map((r) => `예고 ${r.telegraph}초 · 끝났을 때 ${r.far}m · ${r.hp === r.before ? '안 맞음' : `${r.before}→${r.hp}`}`)
          .join(' | '),
      )
    }
  }

  /**
   * ---- 3.55 🚶 **잡몹 광역도 걸어서 벗어날 수 있는가** ────────────────
   *
   * 위 3.5 는 **보스 광역**(예고 1.9초 · 반경 7.5m)으로만 확인했습니다 —
   * 판정 순간 12.9m 로 여유롭게 벗어납니다. 그런데 실제 존에서 플레이어를
   * 때리는 🟡 은 대부분 **잡몹 광역**이고, 그쪽은 한 번도 안 쟀습니다.
   *
   * 재야 하는 이유가 생겼습니다. 죽음 장부의 `발:` 칸을 고치고 나니
   * (예전엔 적과의 거리 변화라 **적이 따라오면 `제자리`** 로 찍혔습니다)
   * 그림이 뒤집혔습니다:
   *
   *     🟡 14대 중 **12대가 "걸어서 실제로 멀어졌는데도 맞음"**
   *
   * 산수로는 벗어날 수 있어야 합니다 — 예고 1.25초 · 반경 4.6m ·
   * 이동 5.4m/s. 1.6m 에서 5.05m(반경+내 굵기)까지는 3.45m, 0.64초면
   * 됩니다. **산수와 벤치가 어긋나니 실제로 걸어 봅니다.**
   */
  {
    const tries = []
    let walked = null
    for (let i = 0; i < 3; i++) {
      const r = await page.evaluate(() => window.__t.walkOut('grunt', 'grunt_sweep'))
      if (!r) continue
      walked = r
      tries.push(r)
      if (r.hp === r.before) break
    }
    check(walked !== null, '🚶 잡몹 광역 예고를 관측하고 실제로 걸어 봤다')
    if (walked) {
      check(
        tries.some((r) => r.hp === r.before),
        '🚶 **잡몹 광역도 예고가 뜬 순간부터 걸으면 벗어난다** (존에서 실제로 때리는 쪽)',
        tries
          .map(
            (r) =>
              `예고 ${r.telegraph}초 · 판정 순간 ${r.far}m · ${r.hp === r.before ? '안 맞음' : `${r.before}→${r.hp}`}`,
          )
          .join(' | '),
      )
    }
  }

  /**
   * ---- 3.6 ⏱ **얼마나 늦게 출발해도 되는가** — 이 색의 여유 ────────────
   *
   * 위 두 검사는 *"예고가 뜬 **순간부터** 걸으면 벗어난다"* 고 말합니다.
   * 그건 **반응 시간이 0인 사람**의 이야기입니다. 사람은 색을 보고, 그게
   * 구를 색이 아님을 알고, 방향을 정하고, 그다음에 손이 움직입니다.
   *
   * 참고 게임이 광역을 공정하게 만드는 방법이 정확히 이 여유입니다.
   * FF14·로스트아크의 장판은 **읽고 나서도 걸어 나갈 시간**이 남게 잡혀
   * 있습니다. 여유가 반응 시간보다 짧으면 그 색은 "읽는 색"이 아니라
   * **미리 아는 색** — 즉 외워야 하는 것이 됩니다. 그건 이 게임의 기둥
   * (*"내가 못 봤네"가 아니라 "내가 못 피했네"*)과 정면으로 어긋납니다.
   *
   * ⚠️ 문턱은 제가 안 정합니다. `reactionBudget()` 이 게임에서 옵니다 —
   *    4색 중 하나를 고르는 **선택 반응**이라 `choice` 쪽을 씁니다.
   *    (`simple` 은 "뭔가 오면 무조건 구른다" 일 때의 값입니다.)
   *
   * ⚠️ 늦은 쪽부터 재지 않고 **0.1초씩 늘려 가며** 마지막으로 성공한
   *    지점을 찾습니다. 한 번의 실패로 끊으면 프레임 흔들림 한 번이
   *    그대로 답이 됩니다 — 실패가 두 번 이어질 때 멈춥니다.
   */
  {
    const budget = await page.evaluate(() => window.__game.reactionBudget())
    const STEP = 0.1
    const MAX = 1.2
    let latest = -1
    let misses = 0
    const rows = []
    for (let d = 0; d <= MAX + 1e-9; d += STEP) {
      const delay = Number(d.toFixed(2))
      let ok = false
      for (let i = 0; i < 2; i++) {
        const r = await page.evaluate(
          ([k, id, dl]) => window.__t.walkOut(k, id, dl),
          ['grunt', 'grunt_sweep', delay],
        )
        if (r && r.hp === r.before) {
          ok = true
          break
        }
      }
      rows.push(`${delay.toFixed(1)}초${ok ? '○' : '×'}`)
      if (ok) {
        latest = delay
        misses = 0
      } else if (++misses >= 2) break
    }
    check(
      latest >= 0,
      '⏱ 늦게 출발하는 경우를 실제로 재 봤다 (여유가 있는지 묻는 게이트)',
      rows.join(' '),
    )
    /**
     * ── 🐲 **보스 광역도 같은 질문을 받습니다** ──────────────────────
     *
     * 위는 잡몹(예고 1.25초 · 반경 4.6m)입니다. 존에서 자주 만나는 쪽이라
     * 여유를 촘촘히 쟀습니다. 그런데 **플레이어가 마지막에 시험받는 것은
     * 보스**(예고 1.9초 · 반경 7.5m)이고, 그쪽은 한 번도 이 질문을 안
     * 받았습니다. 예고가 길어 넉넉할 것 같지만 반경도 큽니다 — 둘이
     * 반대로 작용하므로 **짐작으로는 답이 안 나옵니다.**
     *
     * 여기서는 여유의 크기를 찾지 않고 **한 점만** 찍습니다: *"반응 예산만큼
     * 늦게 출발해도 벗어나는가."* 그게 이 검사가 실제로 묻는 것이고,
     * 0.1초씩 훑으면 판이 열세 번 더 돌아 검사가 40분짜리가 됩니다.
     * 알고 싶은 것보다 비싼 측정은 안 합니다.
     */
    {
      const late = Number(budget.choice.toFixed(2))
      let ok = false
      let last = null
      for (let i = 0; i < 3; i++) {
        const r = await page.evaluate(
          ([k, id, dl]) => window.__t.walkOut(k, id, dl),
          ['boss', 'boss_quake', late],
        )
        if (!r) continue
        last = r
        if (r.hp === r.before) {
          ok = true
          break
        }
      }
      check(
        ok,
        '🐲 **보스 광역도 읽고 나서 출발하면 벗어난다** (마지막 시험에서도 읽는 색)',
        last
          ? `${late.toFixed(2)}초 늦게 출발 · 예고 ${last.telegraph}초 · 판정 순간 ${last.far}m` +
            ` · ${ok ? '안 맞음' : `${last.before}→${last.hp}`}`
          : '예고를 못 잡았습니다',
      )
    }

    if (latest >= 0) {
      check(
        latest >= budget.choice,
        '⏱ **읽고 나서 출발해도 늦지 않다** (🟡 이 외우는 색이 아니라 읽는 색으로 남는다)',
        `늦어도 ${latest.toFixed(1)}초까지는 벗어납니다 · 4색 중 고르는 반응 예산 ${budget.choice.toFixed(2)}초` +
          (latest >= budget.choice
            ? ` — ${(latest - budget.choice).toFixed(2)}초 남습니다`
            : ` — **${(budget.choice - latest).toFixed(2)}초 모자랍니다**`),
      )
    }
  }

  /**
   * ---- 3.6 📏 **그린 선이 진실인가** ────────────────────────────────
   *
   * ── 왜 의심하게 됐는가 ──────────────────────────────────────────
   * 예고 부채꼴은 실제 `reach`·`arcDeg` 로 그립니다(visuals.ts
   * `makeSectorGeometry(0.35, def.reach, def.arcDeg)`). 모양은 맞습니다.
   * 그런데 **판정**은 이렇습니다(combat.ts `shapeDist`):
   *
   *     if (dist > spec.range + Body.radius[t]) return -1
   *
   * 대상의 굵기를 **더해 줍니다.** 플레이어 반지름이 0.45m 이니,
   * **그린 선 밖 0.45m 까지도 맞습니다.**
   *
   * 그 관대함은 원래 플레이어를 위한 것이었습니다 — 주석에 *"덩치 큰 적을
   * 코앞에서 때려도 빗나가는 것처럼 느껴진다"* 고 적혀 있습니다. 격투
   * 게임과 액션 게임의 관례도 같습니다: **때리는 판정은 넉넉하게, 맞는
   * 판정은 인색하게.** 둘 다 플레이어에게 유리한 방향입니다.
   *
   * 그런데 여기서는 **같은 한 줄이 양쪽에 다 적용**됩니다. 적이 때릴 때는
   * 그 관대함이 플레이어를 향하고, 그러면 *"선 밖에 있으면 안전하다"* 는
   * 예고의 약속이 깨집니다. 🟡 광역의 정답이 **걸어서 이탈**인데,
   * 어디까지 걸어야 하는지를 화면이 0.45m 틀리게 말하고 있는 셈입니다.
   *
   * 죽음 장부가 세 번 다 *"예고를 다 봤는데 답을 내지 않았다"* 라고 적은
   * 그 자리에서, 이건 충분히 의심할 만합니다. **재 봅니다.**
   */
  {
    const edge = await page.evaluate(async () => {
      const G = window.__game
      const roster = G.enemyRoster()
      const def = roster
        .flatMap((r) => r.attacks)
        .find((a) => a.id === 'boss_quake')
      const probeAt = async (at) => {
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.2)
        const p0 = G.state().player
        const e = G.spawnEnemyKind('boss', p0.x + 12, p0.z)
        await window.__t.runFor(0.2)
        G.setHp(e, 100000)
        for (let attempt = 0; attempt < 14; attempt++) {
          const es = G.entityState(e)
          // 그린 선을 기준으로 **정확히** 그 거리에 세웁니다.
          G.teleportPlayer(es.x, es.z - at)
          G.setHp(G.playerEntity(), 100)
          await window.__t.runFor(0.2)
          const got = await window.__t.until(() => {
            const i = G.enemyInfo(e)
            return i?.winding === true && i.attackId === 'boss_quake'
          }, 6)
          if (!got) continue
          // 예고 내내 그 자리에 붙들어 둡니다 — 넉백·이동으로 거리가 변하지 않게.
          const before = G.state().player.hp
          const t0 = G.state().elapsed
          while (G.state().elapsed - t0 < 3) {
            const i = G.enemyInfo(e)
            if (!i) break
            G.teleportPlayer(i.x, i.z - at)
            if (!i.winding && i.state !== 1) break
            await new Promise((r) => setTimeout(r, 8))
          }
          await window.__t.runFor(0.3)
          return { hp: G.state().player.hp, before, dist: Number(at.toFixed(2)) }
        }
        return null
      }
      /**
       * ⚠️ **띠 안을 재야 합니다.**
       *
       * 처음엔 `reach * 1.06` 을 썼는데 7.5 × 1.06 = 7.95 이고, 그건
       * `reach + 몸 반지름(0.45)` 과 **정확히 같은 값** — 관대한 띠의
       * 바깥 끝입니다. 당연히 안 맞고, 검사는 주장하는 자리를 **재지도
       * 않고** 통과했습니다. 이 세션에서 여러 번 겪은 모양입니다.
       *
       * 재려는 곳은 *"그린 선 밖이지만 몸 굵기 안"* — 그 한가운데입니다.
       * 반지름은 게임에게 묻습니다(`playerInfo().radius`).
       */
      /**
       * ⚠️ **"그린 선"은 게임에게 묻습니다.**
       *
       * 여기서 `def.reach` 를 선이라고 가정하면, 그리는 규칙을 고치는 날
       * 프로브만 옛 선을 들고 빨개집니다. `drawnReach` 가 실제로 화면에
       * 그려지는 반지름입니다(enemyAttacks.ts `telegraphRadius`).
       */
      const r = G.state().player.radius
      const line = def.drawnReach
      return {
        reach: def.reach,
        line,
        radius: r,
        inside: await probeAt(line * 0.8),
        // 그린 선 **바깥**. 예전 규칙(reach 까지만 그림)에서 맞던 자리입니다.
        outside: await probeAt(line + 0.2),
      }
    })
    check(
      edge.inside !== null && edge.outside !== null,
      '📏 선 안팎에서 각각 예고를 관측했다 (비교의 게이트)',
      `판정 반경 ${edge.reach}m · 그린 선 ${edge.line}m · 몸 반지름 ${edge.radius.toFixed(2)}m` +
        ` · 안쪽 ${edge.inside?.dist}m · 선 밖 ${edge.outside?.dist}m`,
    )
    if (edge.inside && edge.outside) {
      check(
        edge.inside.hp < edge.inside.before,
        '📏 선 **안**에 있으면 맞는다 (측정이 성립했다)',
        `${edge.inside.dist}m 에서 ${edge.inside.before} → ${edge.inside.hp}`,
      )
      check(
        edge.outside.hp === edge.outside.before,
        '📏 **그린 선 밖에 있으면 안 맞는다** (예고가 말한 대로여야 걸어서 이탈이 성립합니다)',
        `${edge.outside.dist}m — 그린 선 ${edge.line}m 밖 · ${edge.outside.before} → ${edge.outside.hp}`,
      )
    }
  }

  /**
   * ---- 4. 처음 보는 색이면 **정답을 한 번** 알려줬는가 ----
   *
   * 위 시험들은 🔴 과 🟡 예고를 실제로 띄웠습니다. 그러니 그 두 색의
   * 안내가 **나갔어야** 하고, 같은 색이 여러 번 나왔어도 **한 번씩만**
   * 기록되어야 합니다.
   *
   * "한 번만"은 **안 일어나는 것**을 재는 조건입니다 — 시험을 안 쓰면
   * 두 번 뜨는 것을 아무도 모릅니다(모루 프로브와 같은 종류의 위험).
   */
  const seen = await page.evaluate(() => window.__game.seenIntents())
  check(seen.length >= 2, '예고를 띄운 색마다 안내가 나갔다', `${seen.length}색`)
  check(
    new Set(seen).size === seen.length,
    '같은 색을 두 번 알려주지 않는다 (안내가 잔소리가 되지 않게)',
    `[${seen.join(',')}]`,
  )

  /**
   * ── 🤸 **틀린 답을 되풀이하면 한 번 더 가르치는가** ──────────────────
   *
   * 위 4번은 *"처음 보는 색이면 한 번 알려준다"* 를 재고, 그게 전부였습니다.
   * 그 뒤로 🟡 에 계속 구르며 계속 맞아도 아무도 말해 주지 않았습니다 —
   * **죽어야** 죽음 화면이 말해 줍니다.
   *
   * 이 프로브가 방금 확인한 것: 두 광역 모두 예고가 뜬 순간부터 걸으면
   * 벗어납니다. 즉 **답이 안 통하는 게 아니라 답을 모르는 것**이고,
   * 모르는 것은 알려 주면 됩니다. 가르칠 자리는 **실패한 순간**입니다.
   *
   * 두 가지를 같이 재야 합니다 — 하나만 재면 반대쪽이 무너집니다:
   *   · 되풀이하면 **다시 가르친다**
   *   · 그래도 **잔소리가 되지 않는다** (색당 평생 두 번까지)
   */
  console.log('')
  {
    const teach = await page.evaluate(async () => {
      const G = window.__game
      const sleep = () => new Promise((r) => setTimeout(r, 8))
      const runFor = async (sec) => {
        const t = G.state().elapsed + sec
        while (G.state().elapsed < t) await sleep()
      }
      G.reset()
      await runFor(0.5)
      G.clearEnemies()
      await runFor(0.3)
      const p0 = G.state().player
      const e = G.spawnEnemyKind('grunt', p0.x + 12, p0.z)
      await runFor(0.3)
      G.setHp(e, 1000000)
      const before = G.colorTeach()
      const need = before.after
      /**
       * 🟡 예고가 뜰 때마다 **일부러 구릅니다** — 이 색의 오답입니다.
       * 그리고 그 자리에 남습니다(걸어 나가면 안 맞고, 그러면 오답을
       * 낸 적이 없는 것이 되어 아무것도 안 세어집니다).
       */
      /**
       * ⚠️ **횟수를 세지 말고 목표가 찰 때까지 돕니다.**
       *
       * 잡몹은 `grunt_jab` 도 섞어 쓰므로 🟡 예고가 매번 오지 않습니다.
       * `need + 6` 번 돌아 봤자 실제로 구른 것은 2회였습니다 — 재려는
       * 것(오답 누적)이 안 찬 채로 판정이 났습니다. **표본이 찰 때까지**
       * 돌고, 안 차면 그 사실이 그대로 빨갛게 나오게 둡니다.
       */
      let rolled = 0
      for (let n = 0; n < need * 12; n++) {
        if ((G.colorTeach().wrong[1] ?? 0) >= need + 1) break
        /**
         * ⚠️ **손이 빌 때까지 기다립니다.** 앞 한 대에 경직으로 묶여 있으면
         *    Space 가 안 먹고, 그러면 `tries` 가 0 이라 **오답으로 세어지지
         *    않습니다.** 처음엔 이걸 빼놓고 6번 시도해 1회만 세었습니다 —
         *    게임이 아니라 재는 쪽이 조급했습니다(이 세션에서 몇 번째인지
         *    모르겠습니다).
         */
        {
          const t0 = G.state().elapsed
          while (G.state().elapsed - t0 < 4 && G.state().player.state !== 0) await sleep()
        }
        const es = G.entityState(e)
        G.teleportPlayer(es.x, es.z - 1.6)
        G.setHp(G.playerEntity(), 100)
        G.setStamina(1000)
        const got = await window.__t.until(() => {
          const i = G.enemyInfo(e)
          return i?.winding === true && i.attackId === 'grunt_sweep'
        }, 8)
        if (!got) continue
        // 예고가 끝나기 직전에 굴러서 무적을 흘려보냅니다 = 틀린 답.
        await window.__t.until(() => (G.enemyInfo(e)?.timer ?? 9) <= 0.12, 3)
        G.press('Space')
        await sleep()
        G.release('Space')
        // 실제로 굴렀는지 확인합니다 — 안 굴렀으면 오답을 낸 적이 없습니다.
        if (await window.__t.until(() => G.state().player.state === 2, 0.6)) rolled++
        await runFor(1.4)
      }
      return { before, after: G.colorTeach(), need, rolled }
    })
    const SWEEP_INTENT = 1
    const wrong = teach.after.wrong[SWEEP_INTENT] ?? 0
    check(
      teach.rolled >= teach.need,
      '🤸 실제로 **틀린 답을 여러 번 냈다** (측정이 성립했다 — 굴렀는지 확인)',
      `구른 횟수 ${teach.rolled}회 · 문턱 ${teach.need}회`,
    )
    check(
      wrong >= teach.need,
      '🤸 **틀린 답을 낸 것을 세고 있다** (구를 색이 아닌데 굴러서 맞음)',
      `🟡 오답 ${wrong}회 · 문턱 ${teach.need}회`,
    )
    check(
      teach.after.retaught.includes(SWEEP_INTENT),
      '🤸 **되풀이하면 그 색의 정답을 한 번 더 알려준다** (죽어야 배우지 않게)',
      `다시 가르친 색 [${teach.after.retaught.join(', ')}]`,
    )
    check(
      teach.after.retaught.filter((x) => x === SWEEP_INTENT).length === 1,
      '🤸 그래도 **잔소리가 되지 않는다** (색당 한 번만 더)',
      `🟡 오답이 ${wrong}회인데 다시 가르친 것은 ${teach.after.retaught.filter((x) => x === SWEEP_INTENT).length}회`,
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
