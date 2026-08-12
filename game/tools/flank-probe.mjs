/**
 * 등 뒤를 잡을 **기회** — `npm run flank`
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * DESIGN.md 에 답이 안 난 채로 적혀 있는 문제가 하나 있습니다:
 *
 *   > 롱소드 백어택 7/96 = 7% · 쌍단검 11/172 = 6%
 *   > **기둥 3(포지셔닝 보상)이 존에서 6~7%밖에 안 돌아갑니다.**
 *   > 다음에 잴 것: 등 뒤를 잡을 **기회**가 부족한가, 아니면 …
 *
 * 그 뒤로 못 재고 있었습니다. 이유가 분명합니다 — 저 6~7% 는 **봇이** 낸
 * 숫자이고, 같은 문서가 다른 자리에 이렇게 적어 뒀습니다:
 *
 *   > 그 숫자는 **봇이 등 뒤로 도는지**를 재고 있고, 봇은 원래 안 돕니다.
 *
 * 즉 봇으로는 **영원히** 답이 안 납니다. 기회가 없어서 6%인지, 봇이 안 돌아서
 * 6%인지 구별할 수가 없으니까요. 이 저장소의 구분 그대로입니다:
 *
 *   > 봇은 밸런스를 재고, **실험대는 규칙을 잽니다.**
 *
 * ── 그래서 게임 쪽에서 **기회만** 잽니다 ────────────────────────
 * 정책을 빼고 묻습니다: *"적이 공격을 커밋한 동안, 걷는 속도로 등 뒤에
 * 닿을 수 있는가?"* 소울류가 등 뒤를 주는 창이 바로 그 자리입니다 —
 * 휘두르고 나서 굳어 있는 동안.
 *
 * 커밋한 창 = **판정 + 후딜**. 예고는 뺍니다 — 예고 중에 등 뒤로 도는 것은
 * 공격을 피하는 일이지 처벌하는 일이 아니고, 애초에 적이 그때는 아직
 * 돌 수 있습니다.
 *
 * ⚠️ 걷는 속도를 **넘지 않습니다.** 매 프레임 `이동속도 × 경과시간` 만큼만
 *    옮깁니다. 순간이동으로 돌면 "기회가 있다"가 거짓이 됩니다.
 * ⚠️ 등 뒤 판정도 **게임이 합니다**(`testBehind`). 여기서 140° 를 베껴 적으면
 *    각도를 바꾸는 날 이 프로브만 옛 규칙으로 통과합니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5224
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

  console.log('\n🔄 등 뒤를 잡을 **기회** — 적이 굳어 있는 동안 돌아갈 수 있는가\n')

  const t = await page.evaluate(() => window.__game.terrainInfo())
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  console.log(`  [설정] 걷기 ${t.playerMoveSpeed} m/s · 플레이어 반지름 ${t.playerRadius}m\n`)

  const results = []
  for (const foe of roster) {
    /**
     * ⚠️ **서는 거리를 적마다 다르게** 잡습니다. 처음엔 전부 2m 앞에
     *    세웠는데 끄는 자와 쏘는 자가 **한 번도 공격을 안 했습니다** —
     *    둘은 거리를 두는 적이라 코앞에서는 쏠 수 있는 패턴이 없습니다.
     *    그 적의 패턴이 고르는 거리(minRange~maxRange)의 한가운데에 섭니다.
     */
    const stand = Math.max(
      1.8,
      Math.min(...foe.attacks.map((a) => (a.minRange + Math.min(a.maxRange, a.reach)) / 2)),
    )
    const r = await page.evaluate(async ([id, moveSpeed, playerR, stand]) => {
      const G = window.__game
      const sleep = () => new Promise((res) => setTimeout(res, 8))
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t0 = now()
        const dl = Date.now() + 30000
        while (now() - t0 < sec && Date.now() < dl) await sleep()
      }
      const runs = []
      for (let attempt = 0; attempt < 3; attempt++) {
        G.reset()
        await wait(0.4)
        G.clearEnemies()
        await wait(0.2)
        const p0 = G.state().player
        const e = G.spawnEnemyKind(id, p0.x + stand, p0.z)
        if (e < 0) break
        G.setHp(e, 100000)
        await wait(0.2)

        // 적이 공격을 커밋할 때까지 코앞에 서 있습니다(예고가 뜨게).
        let committed = false
        const t0 = now()
        const dl = Date.now() + 60000
        while (now() - t0 < 20 && Date.now() < dl) {
          const info = G.enemyInfo(e)
          if (!info) break
          // 제자리를 지킵니다 — 아직 도는 단계가 아닙니다.
          G.teleportPlayer(info.x - stand, info.z)
          if (info.attacking && !info.winding) {
            committed = true
            break
          }
          await sleep()
        }
        if (!committed) continue

        /**
         * 판정이 뜬 순간부터 **걷는 속도로** 등 뒤를 향해 돕니다.
         * 매 프레임 옮기는 거리는 `이동속도 × 경과시간` 을 넘지 않습니다.
         */
        const startT = now()
        let last = now()
        let behindAt = -1
        let released = -1
        const dl2 = Date.now() + 60000
        while (now() - startT < 6 && Date.now() < dl2) {
          const info = G.enemyInfo(e)
          if (!info) break
          const s = G.state().player
          if (behindAt < 0 && G.testBehind(s.x, s.z, info.x, info.z, info.rotY)) {
            behindAt = now() - startT
          }
          if (!info.attacking) {
            // 커밋이 끝났습니다 — 여기까지가 창입니다.
            // ⚠️ 등 뒤에 닿아도 **여기서 멈추지 않습니다.** 닿은 시각만 재고
            //    창의 끝까지 봐야 "0.58초 걸렸는데 창이 0.7초였다"를 말할 수
            //    있습니다. 처음엔 닿자마자 끊어서 창이 늘 물음표였습니다.
            released = now() - startT
            break
          }
          const dt = Math.max(0, now() - last)
          last = now()
          const step = moveSpeed * dt
          // 적을 중심으로 **접선 방향**으로 한 걸음. 반지름은 밀착 거리로 유지.
          const dx = s.x - info.x
          const dz = s.z - info.z
          const d = Math.hypot(dx, dz) || 1
          const want = playerR + (info.radius ?? 0.5)
          const ang = Math.atan2(dz, dx) + step / Math.max(want, 0.3)
          const nx = info.x + Math.cos(ang) * want
          const nz = info.z + Math.sin(ang) * want
          // 반지름 보정까지 합쳐도 한 프레임 이동 상한을 안 넘게 자릅니다.
          const mx = nx - s.x
          const mz = nz - s.z
          const ml = Math.hypot(mx, mz) || 1
          const cap = Math.min(1, step / ml)
          G.teleportPlayer(s.x + mx * cap, s.z + mz * cap)
          void d
          await sleep()
        }
        if (released < 0) released = now() - startT
        runs.push({ behindAt: Number(behindAt.toFixed(2)), window: Number(released.toFixed(2)) })
        G.clearEnemies()
      }
      return runs
    }, [foe.id, t.playerMoveSpeed, t.playerRadius, stand])
    results.push({ name: foe.name, runs: r })
  }

  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : -1)

  check(
    results.every((r) => r.runs.length >= 2),
    '적 종류마다 커밋 순간을 관측했다 (관측 못 해서 통과하는 일 방지)',
    results.map((r) => `${r.name} ${r.runs.length}회`).join(' · '),
  )

  /**
   * ⚠️ 관측 못 한 적을 **빼고** 판정하면 안 됩니다. 처음에 그렇게 짰다가
   *    끄는 자·쏘는 자가 0회인데도 이 줄이 ✅ 로 나왔습니다 — 못 본 것을
   *    통과로 세는 것이 이 저장소에서 가장 비싼 고장입니다.
   *
   * ── 그런데 **잣대가 한 번 더 틀렸습니다** ────────────────────────
   * 처음엔 여섯 종 전부에게 같은 것을 요구했고 쏘는 자가 실패했습니다.
   * 그 실패는 게임의 결함이 아니라 **질문이 틀린 것**이었습니다:
   *
   *   · 쏘는 자는 7.5m 밖에서 쏩니다. 창 1.07초 동안 걸어서 갈 수 있는
   *     거리는 5.8m 이라, **닿기도 전에 창이 끝납니다.**
   *   · 그런데 이 적의 정답은 원래 *"붙어라"* 입니다. 그리고 붙으면
   *     **최소 사거리(3m)에 걸려 아예 못 쏩니다** — 처벌할 후딜 자체가
   *     생기지 않습니다. 대신 강인도가 14로 가장 낮아 금방 무너집니다.
   *
   * 즉 원거리 적에게 "후딜에 등 뒤를 잡아라"는 **없는 창을 잡으라는 말**
   * 입니다. 그래서 **밀착 거리에서 쓸 수 있는 패턴이 하나도 없는 적**은
   * 이 검사에서 뺍니다. 빼되 **조용히 빼지 않고** 이유와 함께 찍습니다.
   */
  const contact = t.playerRadius
  const melee = results.filter((r) => {
    const foe = roster.find((x) => x.name === r.name)
    const reach = contact + (foe?.radius ?? 0.5)
    return foe?.attacks.some((a) => a.minRange <= reach)
  })
  const ranged = results.filter((r) => !melee.includes(r))
  const failed = melee.filter((r) => r.runs.length < 2 || med(r.runs.map((x) => x.behindAt)) < 0)
  check(
    melee.length > 0 && failed.length === 0,
    '**붙어서 싸우는 적은 전부** 굳어 있는 동안 등 뒤로 돌 수 있다 (기둥 3 의 기회가 존재한다)',
    melee
      .map((r) => {
        const b = r.runs.length ? med(r.runs.map((x) => x.behindAt)) : -1
        return `${r.name} ${b < 0 ? '못 돎' : `${b.toFixed(2)}초`}`
      })
      .join(' · '),
  )
  if (ranged.length) {
    console.log(
      `     ↳ [면제] ${ranged.map((r) => r.name).join(' · ')} — 밀착 거리에서 쓸 수 있는 패턴이` +
        ` 없습니다(최소 사거리). 붙으면 아예 못 쏘므로 **처벌할 후딜 자체가 없고**,` +
        ` 이 적의 답은 후딜이 아니라 "붙어라" 입니다.`,
    )
  }

  console.log('\n  [적별] 등 뒤에 닿기까지 / 커밋이 풀릴 때까지 (여유)')
  for (const r of results) {
    const b = r.runs.length ? med(r.runs.map((x) => x.behindAt)) : -1
    const w = r.runs.length ? med(r.runs.map((x) => x.window)) : -1
    console.log(
      `    ${r.name.padEnd(7)} ${b < 0 ? '   못 돎' : `${b.toFixed(2)}초`}` +
        `  창 ${w < 0 ? '?' : `${w.toFixed(2)}초`}` +
        `  ${b >= 0 && w >= 0 ? `(여유 ${(w - b).toFixed(2)}초)` : ''}  · ` +
        r.runs.map((x) => (x.behindAt < 0 ? '✗' : `${x.behindAt}`)).join(' '),
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
