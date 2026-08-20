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
import { simPerWall, announceSpeed } from './machine.mjs'

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
  announceSpeed(await simPerWall(page), 0)

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
    // 그 적의 가장 긴 판정 시간 — "판정이 끝난 뒤"를 게임 데이터로 정합니다.
    const activeMax = Math.max(...foe.attacks.map((a) => a.active))
    const r = await page.evaluate(async ([id, moveSpeed, playerR, stand, activeMax]) => {
      const G = window.__game
      const sleep = () => new Promise((res) => setTimeout(res, 8))
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t0 = now()
        const dl = Date.now() + 30000
        while (now() - t0 < sec && Date.now() < dl) await sleep()
      }
      const runs = []
      /**
       * ── **언제부터 돌기 시작하는가** 를 두 가지로 돌려 봅니다 ──────────
       *
       * 봇에게 "커밋하면 돌아라"를 가르쳤더니 네 판 비교에서 부호가 갈렸고,
       * 한 판은 받은 피해가 192 늘었습니다. 기계 고장을 의심하기 전에
       * **기제**를 하나 떠올렸습니다: 커밋에는 **판정(active)** 도 들어갑니다.
       * 그때 적 둘레를 도는 것은 **휘두르는 칼 안으로 걸어 들어가는 것**이고,
       * 🟡 광역은 판정이 예고 내내 **머무릅니다**(combat.ts lingers).
       *
       * 그래서 같은 자리에서 두 가지를 재서 가릅니다:
       *   A. 판정이 뜨자마자 돌기
       *   B. **판정이 끝난 뒤**(후딜부터) 돌기
       * 사람이 하는 것은 B 입니다 — 맞을 것을 피하고 나서 돕니다.
       */
      for (let attempt = 0; attempt < 6; attempt++) {
        const waitActive = attempt % 2 === 1
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
        // 변형 B: 판정이 끝날 때까지 제자리에서 기다립니다.
        if (waitActive) {
          const info0 = G.enemyInfo(e)
          if (info0) G.teleportPlayer(info0.x - stand, info0.z)
          await wait(activeMax)
        }

        /**
         * 판정이 뜬 순간부터 **걷는 속도로** 등 뒤를 향해 돕니다.
         * 매 프레임 옮기는 거리는 `이동속도 × 경과시간` 을 넘지 않습니다.
         */
        const startT = now()
        let last = now()
        let behindAt = -1
        let released = -1
        const hp0 = G.state().player.hp
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
        runs.push({
          waitActive,
          behindAt: Number(behindAt.toFixed(2)),
          window: Number(released.toFixed(2)),
          hpLost: Number((hp0 - G.state().player.hp).toFixed(1)),
        })
        G.clearEnemies()
      }
      return runs
    }, [foe.id, t.playerMoveSpeed, t.playerRadius, stand, activeMax])
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

  /**
   * ---- 판정부터 도는 것과 후딜부터 도는 것 ----
   * 이 두 줄이 봇에게 무엇을 가르칠지 정합니다.
   */
  const lost = (f) => {
    const v = results.flatMap((r) => r.runs.filter(f).map((x) => x.hpLost))
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : -1
  }
  const fromActive = lost((x) => !x.waitActive)
  const fromRecovery = lost((x) => x.waitActive)
  check(
    fromActive >= 0 && fromRecovery >= 0,
    '두 시작 시점을 다 관측했다 (판정부터 / 후딜부터)',
    `판정부터 ${fromActive.toFixed(1)} · 후딜부터 ${fromRecovery.toFixed(1)} (평균 받은 피해)`,
  )
  check(
    fromRecovery <= fromActive,
    '**후딜부터** 도는 쪽이 덜 맞는다 (판정 중에 도는 것은 칼 안으로 걸어드는 것)',
    `판정부터 ${fromActive.toFixed(1)} vs 후딜부터 ${fromRecovery.toFixed(1)}`,
  )

  /**
   * ── 🧍 **사람을 계산에 넣습니다** ──────────────────────────────────
   *
   * 위 검사는 *"등 뒤에 닿을 수 있는가"* 를 묻고 초록입니다 — 붙어 싸우는
   * 적 전부가 통과합니다. 그런데 그 계산에는 **사람이 없습니다.** 이 실험대는
   * 커밋이 시작되는 **바로 그 프레임**에 움직이기 시작합니다.
   *
   * 사람은 보고 나서 움직입니다. 이 저장소는 그 예산을 이미 갖고 있고
   * (`balance.ts` `reactionTime` — Hick의 법칙), 답이 하나뿐인 경우가
   * `simple` 입니다. 등 뒤로 도는 데는 고를 것이 없으니 그 값이 맞습니다.
   *
   * ⚠️ 값을 여기 적지 않고 **게임에서 받습니다**(`reactionBudget()`).
   *    `npm run react` 가 색 목록을 손으로 적어 두었다가 🔵 을 통째로
   *    빠뜨린 적이 있습니다 — 같은 실수를 반복하지 않습니다.
   *
   * 이건 `npm run react` 가 4색에 한 일과 **같은 일**입니다. 거기 머리말이
   * 이렇게 적혀 있습니다 — *"그 계산을 다시 읽어 보니 **사람이 들어 있지
   * 않았습니다**."* 기둥 3 의 계산에도 안 들어 있었습니다.
   */
  const react = await page.evaluate(() => window.__game.reactionBudget())
  {
    const rows = results
      .filter((r) => r.runs.some((x) => x.behindAt >= 0))
      .map((r) => {
        const b = med(r.runs.map((x) => x.behindAt))
        const w = med(r.runs.map((x) => x.window))
        return { name: r.name, slack: w - b, left: w - b - react.simple }
      })
    const dead = rows.filter((r) => r.left < 0)
    check(
      rows.length > 0 && dead.length === 0,
      '🧍 **사람이 보고 움직여도 등 뒤 창이 남는다** (여유에서 반응 시간을 뺀 값)',
      `반응 ${react.simple}초(답이 하나뿐일 때) · ` +
        rows
          .sort((a, b) => a.left - b.left)
          .map((r) => `${r.name} ${r.left >= 0 ? '+' : ''}${r.left.toFixed(2)}초`)
          .join(' · ') +
        (dead.length
          ? ` — **${dead.map((d) => d.name).join('·')}** 는 사람이 움직이기 시작하기도 전에 닫힙니다`
          : ''),
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
        r.runs.map((x) => `${x.waitActive ? '후' : '판'}${x.behindAt < 0 ? '✗' : x.behindAt}/-${x.hpLost}`).join(' '),
    )
  }

  /**
   * ---- 🗡 **기습** — 못 본 적을 먼저 치면 다른 결과가 나오는가 ----
   *
   * ⚠️ **무대를 먼저 세워야 합니다.** 잡몹의 `aggroRange` 는 55m 인데 아레나
   *    반지름은 26m 입니다. 즉 **아레나에서는 모든 적이 항상 나를 봅니다** —
   *    아무리 멀리 낳아도(물리가 반지름 안으로 끌어당기기까지 합니다).
   *    존은 `LEVEL_AGGRO_RANGE`(14m)로 덮어써서 방 단위로 깨우는데 아레나엔
   *    그 덮어쓰기가 없습니다.
   *
   *    이걸 모르고 "기습이 안 된다"는 결론을 낼 뻔했습니다. 게임이 아니라
   *    **무대가 불가능**했습니다. 그래서 존과 같은 값으로 덮어쓰고 잽니다.
   *
   * 검사는 **같은 싸움을 두 번** 돌려서 합니다 — 차이는 하나뿐입니다:
   * 적이 나를 봤는가. 두 판이 같은 결과면 기습은 이름만 있는 것입니다.
   */
  console.log('')
  const strike = async (awake) =>
    page.evaluate(
      async ([wake]) => {
        const G = window.__game
        const sleep = () => new Promise((r) => setTimeout(r, 8))
        const now = () => G.state().simElapsed
        G.reset()
        G.setAggroRange(14) // 존과 같은 무대로 (위 설계 노트)
        const t0 = now()
        while (now() - t0 < 0.6) await sleep()
        G.clearEnemies()
        while (now() - t0 < 1.0) await sleep()

        const p = G.state().player
        // 이 무대는 **못 본 적**이 있어야 성립합니다 — 그래서 재워서 낳습니다.
        // (실험대 스폰의 기본은 깨어 있는 적입니다 — main.ts 설계 노트)
        const e = G.spawnEnemyKind('grunt', p.x + 18, p.z, true)
        if (e == null || e < 0) return null
        while (now() - t0 < 1.6) await sleep()

        /**
         * 적이 보는 방향의 **반대쪽**, 조용히 서 있을 때의 청각 거리 **바로
         * 밖**에 섭니다 — 들리지는 않고 칼은 닿는 자리.
         *
         * ⚠️ 거리를 여기 적어 두지 **않습니다.** `awareInfo()` 로 게임에게
         *    묻습니다. 베껴 적으면 `hearQuiet` 을 고치는 순간 무대가 조용히
         *    무너지고(적이 미리 깨어남) 검사는 "기습이 안 된다"고 **엉뚱한
         *    결론**을 냅니다. 규칙은 한 곳에만 — 게임이 판단하고 프로브는 읽습니다.
         */
        const back = G.awareInfo().hearQuiet + 0.3
        const at = G.enemyInfo(e)
        if (!at) return null
        if (at.aggro) return { broke: false, staged: false, why: '멀리서 이미 깨어 있었습니다' }
        G.teleportPlayer(at.x - Math.sin(at.rotY) * back, at.z - Math.cos(at.rotY) * back)
        if (wake) G.wakeEnemy(e)
        while (now() - t0 < 2.2) await sleep()

        const before = G.enemyInfo(e)
        if (!wake && before.aggro) return { broke: false, staged: false, why: '붙는 동안 깨어났습니다' }

        G.aimAtWorld(before.x, before.z)
        G.setStamina(100)
        while (now() - t0 < 2.7) await sleep()
        G.press('Mouse0')
        G.release('Mouse0')
        const hp0 = before.hp
        const t1 = now()
        let broke = false
        let minPoise = 999
        let hpNow = hp0
        while (now() - t1 < 1.6) {
          const i = G.enemyInfo(e)
          if (!i) break
          if (i.broken) broke = true
          if (i.poise != null && i.poise < minPoise) minPoise = i.poise
          hpNow = i.hp
          await sleep()
        }
        return { broke, staged: true, hit: hpNow < hp0 - 0.01, minPoise }
      },
      [awake],
    )

  const sneak = await strike(false)
  const seen = await strike(true)
  console.log(
    `  [못 본 적을 침] 맞음 ${sneak?.hit ? 'O' : 'X'} · 무너짐 ${sneak?.broke ? 'O' : 'X'} · 최저 강인도 ${sneak?.minPoise}` +
      ` · [이미 본 적을 침] 맞음 ${seen?.hit ? 'O' : 'X'} · 무너짐 ${seen?.broke ? 'O' : 'X'} · 최저 강인도 ${seen?.minPoise}`,
  )
  check(
    sneak != null && seen != null && sneak.staged !== false,
    '무대가 실제로 섰다 (못 본 적이 정말 못 본 상태였는가)',
    sneak?.staged === false ? sneak.why : '',
  )
  check(sneak?.broke === true, '못 본 적을 치면 **즉시 무너진다** (기습이 실제로 일한다)')
  /**
   * ── 여기에 검사를 하나 **썼다가 지웠습니다** ──────────────────────
   * *"기습하면 근처 동료가 함께 깨어난다"*. 통과했고, 뜻이 맞았고,
   * **아무것도 재고 있지 않았습니다.**
   *
   * 규칙대로 일부러 고장 내 봤습니다 — 고함 거리를 7m → **0m** 로 놓아
   * 고함을 통째로 껐습니다. 검사는 그대로 **초록**이었습니다. 이유는
   * 무대에 있었습니다: 동료를 적 옆 5m 에 세웠는데, 적은 스폰할 때
   * 원점을 바라보므로 **동료의 시야가 마침 플레이어 쪽**이었습니다.
   * 동료는 고함이 아니라 **눈으로** 깨어나고 있었습니다.
   *
   * 삼각부등식 때문에 이 무대에서는 고칠 수도 없습니다: 동료가 고함
   * 거리(7m) 안에 있으려면 플레이어에게서 9.1m 를 넘길 수 없고, 그건
   * 시야 거리(14m) 안입니다. **무대 자체가 두 원인을 못 가릅니다.**
   *
   * 그래서 지웠습니다. 고함이 사는지는 `npm run encounter` 가 이미
   * 가릅니다 — 고함 거리를 0으로 놓으면 거기서는 7개 중 6개가
   * **7개 중 2개**로 떨어집니다. 같은 것을 두 번 재느니, **재는 쪽 하나만**
   * 남깁니다.
   *
   * > 통과하는 검사보다 나쁜 것은 **아무 말도 안 하는 검사**입니다.
   */
  check(
    seen?.broke === false,
    '이미 본 적은 한 대로 안 무너진다 (기습이 평타와 구분된다)',
    seen?.broke ? '깨어 있는 적도 무너졌습니다 — 기습이 아니라 그냥 센 한 대입니다' : '',
  )

  console.log('')
  /**
   * ── 📏 **등 뒤 표시가 사실을 말하는가** ─────────────────────────────
   *
   * 앞 라운드에서 예고 부채꼴이 **그린 선 밖 0.45m 에서 맞는다**는 것을
   * 재서 고쳤습니다. 같은 부류를 찾다가 이 자리를 봤고, 게임이 준 숫자로만
   * 봐도 어긋납니다:
   *
   *     그리는 쪽 — 고리 바깥 `backZoneOuter()` ≈ 1.6m
   *     판정 쪽   — `isBehindPoint` … **각도만**. 거리 제한 **없음**
   *     닿는 끝   — 1타 사거리 + 대상 굵기 ≈ 2.75m
   *
   * ⚠️ **한 번 되돌린 검사입니다.** 지난 라운드에 네 번 헛짚었고 넷 다
   *    같은 부류였습니다 — **전제가 서기 전에 재기 시작함**. 그래서 이번엔
   *    전제를 **게임에게 확인받고** 나서야 때립니다:
   *
   *      · 손이 비었는가        → `player.state === 0`
   *      · 몸이 다 돌았는가      → `threats()[0].facing` (게임의 판단)
   *      · 정말 등 뒤인가        → `threats()[0].inFront === false`
   *
   *    제 삼각함수로 각도를 계산하다 1.12m 마저 빨개졌던 것이 지난번입니다.
   *    **재는 쪽이 규칙을 다시 쓰면 그 순간 두 번째 진실이 됩니다.**
   */
  {
    const zone = await page.evaluate(async () => {
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
      const e = G.spawnEnemyKind('grunt', p0.x + 6, p0.z)
      await runFor(0.4)
      G.setHp(e, 100000)
      G.freezeEnemies(true)
      const info = G.enemyInfo(e)
      const outer = G.backZoneOuter(0)
      const wid = G.state().loadout.weapon
      const w = G.weaponTable().find((x) => x.id === wid)
      const hitMax = w.comboSteps[0].range
      const foe = G.enemyRoster().find((r) => r.id === 'grunt')
      const reachEdge = hitMax + foe.radius

      /** `side` = -1 이면 등 뒤, +1 이면 정면(같은 축, 반대쪽). */
      const at = async (d, side) => {
        // 1) 손이 빌 때까지.
        {
          const t0 = G.state().elapsed
          while (G.state().elapsed - t0 < 3 && G.state().player.state !== 0) await sleep()
        }
        /**
         * ⚠️ **적의 자리를 매번 되돌리고, 좌표도 새로 읽습니다.**
         *
         * 처음엔 시작할 때 한 번 읽은 `info` 를 계속 썼습니다. 그런데 앞
         * 측정에서 아홉 대를 때리면 **넉백으로 적이 밀려납니다.** 그래서
         * 뒤이어 등 뒤라고 계산한 좌표가 이미 엉뚱한 자리였고, 등 뒤 훑기가
         * **전부 헛쳤습니다.** 정면을 대조로 넣지 않았다면 저는 그걸
         * *"등 뒤라서 안 맞는다"* 로 읽었을 것입니다.
         *
         * 계측기가 재려는 대상을 움직여 놓고 그 값을 믿는 것 — 이 저장소가
         * 출혈 프로브에서 이미 적어 둔 실패입니다.
         */
        G.teleportEnemy(e, info.x, info.z)
        await sleep()
        const cur = G.enemyInfo(e)
        const bx = cur.x + side * Math.sin(cur.rotY) * d
        const bz = cur.z + side * Math.cos(cur.rotY) * d
        G.teleportPlayer(bx, bz)
        G.aimAtWorld(cur.x, cur.z)
        G.setStamina(1000)
        /**
         * 2) **게임이** "적이 내 앞에 있다"(`facing`) 고 말할 때까지.
         *
         * ⚠️ `aimAtWorld` 만으로는 **몸이 안 돕니다.** 조준은 마우스 쪽
         *    값이고, 판정 부채꼴은 **몸의 방향**을 씁니다. 그래서 등 뒤로
         *    순간이동만 하고 때리면 부채꼴이 딴 데를 봅니다 — 가까운
         *    0.9~1.15m 만 맞았는데, 그건 가까울수록 각도 여유(`atan(r/d)`)가
         *    커서 어긋난 채로도 몸이 걸린 것입니다. 1.4m 부터는 전부 헛쳤고,
         *    게이트(`조준 5/9`)가 그 자리를 정확히 짚어 줬습니다.
         *
         * 사람은 걸으면서 몸을 돌립니다. 그래서 **이동 키를 잠깐 눌러**
         * 몸을 돌린 뒤, 움직인 만큼을 되돌려 놓고 잽니다.
         */
        let aimed = false
        for (let tries = 0; tries < 3 && !aimed; tries++) {
          const t0 = G.state().elapsed
          while (G.state().elapsed - t0 < 0.5) {
            const t = G.threats(20).find((x) => x.entity === e)
            if (t?.facing) {
              aimed = true
              break
            }
            // 적 쪽으로 한 걸음 — 몸이 그 방향으로 돕니다.
            const s2 = G.state().player
            const cam = G.cameraAxes()
            const dx = cur.x - s2.x
            const dz = cur.z - s2.z
            const fwd = dx * cam.forwardX + dz * cam.forwardZ
            const right = dx * cam.rightX + dz * cam.rightZ
            for (const [k, v] of [
              ['KeyW', fwd > 0.25],
              ['KeyS', fwd < -0.25],
              ['KeyD', right > 0.25],
              ['KeyA', right < -0.25],
            ]) {
              if (v) G.press(k)
              else G.release(k)
            }
            await sleep()
          }
          for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) G.release(k)
          // 걸으면서 가까워진 만큼 **정확히 그 자리로** 되돌립니다.
          G.teleportPlayer(bx, bz)
          G.aimAtWorld(cur.x, cur.z)
          await sleep()
        }
        const t = G.threats(20).find((x) => x.entity === e)
        const behind = t ? t.inFront === false : false
        const hp0 = G.enemyInfo(e).hp
        const backs0 = G.state().backHits
        G.press('Mouse0')
        await sleep()
        G.release('Mouse0')
        const t0 = G.state().elapsed
        while (G.state().elapsed - t0 < 2 && G.enemyInfo(e).hp === hp0) await sleep()
        const landed = G.enemyInfo(e).hp < hp0
        return {
          d: Number(d.toFixed(2)),
          aimed,
          behind,
          landed,
          back: G.state().backHits > backs0,
        }
      }

      /**
       * ⚠️ **정면에서도 같은 거리를 잽니다.**
       *
       * 등 뒤에서 1.4m 부터 전부 헛쳤습니다. 원인이 *"등 뒤라서"* 인지
       * *"이 사거리가 실제로는 짧아서"* 인지 갈라야 합니다. 정면이 같은
       * 거리에서 맞으면 등 뒤 문제이고, **정면도 못 맞히면 사거리 문제**
       * 입니다 — 그건 등 뒤 표시와 무관한, 훨씬 큰 이야기가 됩니다.
       * 가설이 둘일 때는 **가르는 실험**부터 합니다.
       */
      const front = []
      for (let d = 0.9; d <= reachEdge + 0.3; d += 0.25) front.push(await at(d, +1))
      const scan = []
      for (let d = 0.9; d <= reachEdge + 0.3; d += 0.25) scan.push(await at(d, -1))
      G.freezeEnemies(false)
      return {
        outer: Number(outer.toFixed(2)),
        hitMax: Number(hitMax.toFixed(2)),
        reachEdge: Number(reachEdge.toFixed(2)),
        scan,
        front,
      }
    })
    console.log(
      `     [정면] ${zone.front
        .map((r) => `${r.d}m ${r.landed ? (r.back ? '백' : '앞') : '못맞힘'}`)
        .join(' · ')}`,
    )
    console.log(
      `     [등 뒤] ${zone.scan
        .map((r) => `${r.d}m ${r.landed ? (r.back ? '백' : '앞') : '못맞힘'}`)
        .join(' · ')}`,
    )
    const landed = zone.scan.filter((r) => r.landed)
    const outside = landed.filter((r) => r.d > zone.outer)
    check(
      Number.isFinite(zone.reachEdge) &&
        zone.hitMax > 0 &&
        zone.scan.length > 0 &&
        zone.scan.every((r) => r.aimed),
      '📏 잰 값이 수이고, **모든 자리에서 몸이 다 돌았다** (전제부터 확인)',
      `1타 ${zone.hitMax}m · 닿는 끝 ${zone.reachEdge}m · 조준 ${zone.scan.filter((r) => r.aimed).length}/${zone.scan.length}`,
    )
    const backs = landed.filter((r) => r.back)
    const fronts = zone.front.filter((r) => r.landed)
    /**
     * ⚠️ **약속을 제대로 씁니다.**
     *
     * 처음엔 *"고리 밖에서 맞은 곳 중 백어택이 없다"* 로 썼습니다. 그런데
     * 고치고 나니 고리가 잰 자리를 전부 덮어서 **"고리 밖에서 맞은 곳"이
     * 0** 이 되고, 그 검사는 구조적으로 만족할 수 없게 됐습니다.
     * 재려던 약속은 반대 방향으로 써야 합니다 —
     * **맞은 백어택은 전부 표시 안에 있어야 한다.**
     */
    check(
      landed.length >= 4 && backs.length >= 2 && fronts.length >= 2,
      '📏 등 뒤·정면 양쪽에서 충분히 맞혔다 (비교의 게이트)',
      `맞음 ${landed.length}곳 (백 ${backs.length}) · 정면 대조군 ${fronts.length}곳` +
        ` · 백어택 사거리 ${backs.length ? Math.max(...backs.map((r) => r.d)) : 0}m 까지`,
    )
    check(
      fronts.length > 0 && fronts.every((r) => !r.back),
      '📏 정면은 백어택이 아니다 (대조군이 살아 있다 — 아무 데나 백으로 세지 않는다)',
      `정면 ${fronts.length}곳 중 백어택 ${fronts.filter((r) => r.back).length}곳`,
    )
    check(
      backs.length > 0 && backs.every((r) => r.d <= zone.outer + 0.01),
      '📏 **백어택이 되는 자리는 전부 표시 안이다** (표시가 사실을 말한다)',
      `그린 고리 ${zone.outer}m · 백어택 ${backs.map((r) => r.d).join('/')}m` +
        ` · 표시 밖 ${backs.filter((r) => r.d > zone.outer + 0.01).length}곳`,
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
