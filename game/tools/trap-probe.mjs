/**
 * 갇힘 검증 — `npm run trap`
 *
 * ── 왜 이걸 재게 됐나 ───────────────────────────────────────────
 * Path of Exile 2 를 조사하다 나온 것입니다. PoE2 는 우리와 **장르가 같습니다** —
 * 쿼터뷰 ARPG 에 소울류 구르기를 얹었습니다. 그 게임이 겪은 문제가 이겁니다:
 *
 *   · 구르기는 **몬스터를 통과하지 못합니다**(개발진이 "통과 구르기는 안 한다"고
 *     명시했습니다).
 *   · 그래서 좁은 곳에서 **몸으로 막혀 갇히는** 일이 자주 생깁니다.
 *     개발진도 "가두고 죽이는 것은 의도지만 너무 자주 일어난다"고 인정했습니다.
 *
 * 우리 게임에도 밀어내기(physics.ts)가 있고 구르기는 통과하지 않습니다.
 * 즉 **같은 함정이 이미 깔려 있습니다.** 그런데 지금까지 이걸 잰 적이 없습니다.
 *
 * ── 왜 이게 조용한 고장인가 ─────────────────────────────────────
 * `rules` 프로브가 지키는 약속 중에 이런 게 있습니다:
 *
 *   *"🟡 광역 반경이 구르기 거리(4.2m)보다 크다 — 굴러선 못 빠져나온다"*
 *   *"🔴 직격은 좁은 부채꼴이다 — 옆으로 굴러 빠져나올 수 있다"*
 *
 * 두 약속 모두 **구르기가 실제로 4.2m 를 간다**는 전제 위에 있습니다.
 * 몸에 막혀 1m 밖에 못 가면, 🔴 빨강은 조용히 "피할 수 없는 공격"이 됩니다.
 * 설정값은 하나도 안 바꿨는데 규칙이 뒤집히는 것이고, **설정을 읽는 검사로는
 * 절대 안 잡힙니다.** 굴러 봐야 압니다.
 *
 * ── 무엇을 재는가 ──────────────────────────────────────────────
 *   1) 빈 자리에서 구르면 몇 m 가는가 (기준선)
 *   2) 적에게 둘러싸인 채로 구르면 몇 m 가는가
 *   3) 둘러싸인 채로도 **결국 빠져나올 수 있는가** (몇 번 굴러야 하는가)
 *
 * ⚠️ 적의 AI 는 끕니다. 재려는 것은 **몸이 길을 막는가**이지 "맞아서 못
 *    움직이는가"가 아닙니다. 둘을 섞으면 원인을 못 가립니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5212
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
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🧱 갇힘 검증 — 몸이 길을 막는가\n')

  const t = await page.evaluate(() => window.__game.terrainInfo())
  console.log(`  [설정] 구르기 거리 ${t.dodgeDistance}m · 지속 ${t.dodgeDuration}초\n`)

  /**
   * 공용 실험대. `ring` 명이 플레이어를 둘러싼 채 한 번 구릅니다.
   * ring = 0 이면 아무도 없는 기준선입니다.
   */
  const rollWith = async (ring, radius) =>
    page.evaluate(
      async ([n, r]) => {
        const G = window.__game
        const sleep = () => new Promise((res) => setTimeout(res, 8))
        const now = () => G.state().simElapsed
        const wait = async (sec) => {
          const t0 = now()
          const dl = Date.now() + 30000
          while (now() - t0 < sec && Date.now() < dl) await sleep()
        }
        G.reset()
        await wait(0.4)
        G.clearEnemies()
        // AI 를 꺼야 "몸이 막는가"만 남습니다.
        G.freezeEnemies(true)
        await wait(0.3)
        const p0 = G.state().player
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2
          G.spawnEnemyKind('grunt', p0.x + Math.cos(a) * r, p0.z + Math.sin(a) * r)
        }
        await wait(0.5)
        const before = G.state().player
        // 한 방향(+X)으로 굴립니다 — 방향을 고정해야 판마다 비교됩니다.
        G.aimAtWorld(before.x + 10, before.z)
        G.press('Space')
        G.release('Space')
        await wait(1.0)
        const after = G.state().player
        G.freezeEnemies(false)
        return Number(Math.hypot(after.x - before.x, after.z - before.z).toFixed(2))
      },
      [ring, radius],
    )

  // ---- 1. 기준선 — 빈 자리에서 구르면 얼마나 가는가 ----
  //
  // 설정값(4.2m)을 그대로 믿지 않고 잽니다. 가속·감속 곡선이 있어서
  // 실제 이동은 설정과 정확히 같지 않습니다. 비교 대상은 **실측 기준선**이어야
  // 합니다 — 설정과 비교하면 원래부터 있던 차이를 고장으로 읽습니다.
  const free = await rollWith(0, 0)
  check(free > 0, '기준선 — 빈 자리에서 구른 거리를 쟀다', `${free}m (설정 ${t.dodgeDistance}m)`)

  // ---- 2. 둘러싸인 채로 구르면 ----
  //
  // 6명은 반원 대형이 아니라 **완전한 포위**입니다. 실제 전투에서 이만큼
  // 몰리는 일은 드물지만, 규칙을 재는 실험대는 **가장 나쁜 경우**를 봐야
  // 합니다. 여기서 통과하면 그보다 약한 상황은 자동으로 통과합니다.
  const RING = 6
  const surrounded = await rollWith(RING, 1.6)
  const ratio = free > 0 ? surrounded / free : 0
  check(
    ratio >= 0.5,
    `${RING}명에게 둘러싸여도 구르기가 절반 이상 나간다 (몸이 회피를 죽이지 않는다)`,
    `둘러싸임 ${surrounded}m / 빈 자리 ${free}m = ${Math.round(ratio * 100)}%`,
  )

  // ---- 3. 결국 빠져나올 수 있는가 ----
  //
  // 한 번에 못 나가는 것 자체는 괜찮습니다 — 포위는 위험해야 합니다.
  // 문제가 되는 것은 **영영 못 나가는 것**입니다. 그건 위험이 아니라 고장입니다.
  const escape = await page.evaluate(
    async ([n, r]) => {
      const G = window.__game
      const sleep = () => new Promise((res) => setTimeout(res, 8))
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t0 = now()
        const dl = Date.now() + 30000
        while (now() - t0 < sec && Date.now() < dl) await sleep()
      }
      G.reset()
      await wait(0.4)
      G.clearEnemies()
      G.freezeEnemies(true)
      await wait(0.3)
      const p0 = G.state().player
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        G.spawnEnemyKind('grunt', p0.x + Math.cos(a) * r, p0.z + Math.sin(a) * r)
      }
      await wait(0.5)
      const start = G.state().player
      /**
       * "빠져나왔다"의 정의: **가장 가까운 적보다 멀리** 갔다가 아니라,
       * 모든 적에게서 포위 반지름의 두 배 넘게 떨어진 상태입니다.
       * 전자로 재면 적 하나를 스쳐 지나기만 해도 통과합니다.
       */
      const outOf = () => {
        // threats() 가 이미 거리를 계산해 줍니다 — 프로브가 다시 계산하면
        // 같은 뜻의 식이 두 곳에 생기고 한쪽만 낡습니다.
        const list = G.threats(40)
        if (!list.length) return null
        return list.reduce((m, e) => Math.min(m, e.dist), Infinity)
      }
      let rolls = 0
      const dl = Date.now() + 60000
      while (rolls < 6 && Date.now() < dl) {
        G.aimAtWorld(G.state().player.x + 10, G.state().player.z)
        G.press('Space')
        G.release('Space')
        rolls++
        await wait(0.9)
        const d = outOf()
        if (d !== null && d > r * 2.5) break
        // 기력이 마르면 구르기가 안 나갑니다 — 재려는 것은 몸이지 기력이
        // 아니므로 채워 줍니다.
        G.setStamina(100)
      }
      const end = G.state().player
      return {
        rolls,
        moved: Number(Math.hypot(end.x - start.x, end.z - start.z).toFixed(2)),
        nearest: outOf() === null ? -1 : Number(outOf().toFixed(2)),
      }
    },
    [RING, 1.6],
  )
  /**
   * ⚠️ **첫 판정 기준이 틀렸습니다.** 처음엔 "가장 가까운 적에게서 멀어졌는가"로
   *    물었고 실패가 나왔습니다 — 6번 굴러 19.41m 를 갔는데도 가장 가까운 적이
   *    1.73m 였습니다.
   *
   *    이유를 보니 갇힌 게 아니었습니다. 밀어내기가 플레이어 쪽을 무겁게
   *    잡아 두기 때문에(physics.ts, 플레이어 0.2 : 적 0.8), 정면의 적을
   *    **밀면서 같이 갑니다.** 19m 를 건너간 사람을 두고 "갇혔다"고 할 수는
   *    없습니다.
   *
   *    PoE2 가 겪는 문제는 "적 하나가 앞에 붙어 온다"가 아니라 **"그 자리에서
   *    못 나가고 죽는다"** 입니다. 그러니 물어야 할 것은 **시작 자리에서
   *    벗어났는가** 입니다. 실패한 검사를 무르는 게 아니라, 재려던 것을
   *    다시 겨눈 것입니다.
   */
  check(
    escape.moved > 1.6 * 3,
    '둘러싸여도 그 자리를 벗어난다 (영영 갇히지 않는다)',
    `${escape.rolls}번 굴러 ${escape.moved}m 이동 (포위 반지름 1.6m 의 ${(escape.moved / 1.6).toFixed(1)}배)`,
  )
  /**
   * 검사가 아니라 **관찰**입니다. 앞의 적을 밀고 가는 것이 좋은 일인지
   * 나쁜 일인지 아직 모릅니다 — 이 실험대는 AI 를 꺼 두었으므로, 실제
   * 전투에서 적이 스스로 움직일 때 어떻게 되는지는 여기서 못 답합니다.
   * 판단할 근거가 없는 것을 검사로 만들면 다음 사람이 그것을 규칙으로
   * 오해합니다.
   */
  console.log(
    `     (관찰: 다 구른 뒤 가장 가까운 적이 ${escape.nearest}m — 밀어내기가 플레이어를` +
      ` 무겁게 잡아 두어 앞의 적을 밀고 갑니다. AI 를 끈 실험대의 이야기입니다)`,
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
