/**
 * 돌진 검증 — `npm run charge`
 *
 * ── 왜 이 프로브가 필요한가 ─────────────────────────────────────
 * 달려드는 자에게 예고 중 돌진(`lungeSpeed`)을 넣고 자동 플레이를
 * 베이스라인과 나란히 돌렸더니 **반대 결과**가 나왔습니다:
 *
 *   적 적중률   51% → **30%**
 *   총 받은 피해  238 → **123**
 *   🟢 예고 횟수   8회 → **4회**
 *
 * 더 아프게 만들려던 변경이 게임을 **더 쉽게** 만들었습니다. 여기서
 * 판마다 다른 숫자를 더 뽑아 보는 것은 답이 아닙니다 — 자동 플레이는
 * 결과만 보여 주고 **왜**를 안 알려 줍니다. 의심되는 기전을 직접 잽니다.
 *
 * ── 의심하는 기전: 지나쳐 버림 ──────────────────────────────────
 * 돌진은 예고(1.4초) 내내 걸리고, 사거리의 70%까지 오면 멈춥니다.
 * 그런데 11 m/s 로 달리던 것이 "멈춰라"는 신호 하나로 서지 않습니다 —
 * 남은 속도로 **플레이어를 뚫고 지나갑니다.** 지나가면 두 가지가 한꺼번에
 * 일어납니다: 판정이 뜰 때 부채꼴이 엉뚱한 곳을 보고 있고, 다시 돌아서는
 * 동안 쿨다운(3.2초)이 돌아 **다음 예고까지 늦어집니다.**
 * 적중률과 예고 횟수가 같이 떨어진 것이 이 모양과 맞습니다.
 *
 * ── 그래서 재는 것 ──────────────────────────────────────────────
 * 가만히 선 플레이어에게 달려드는 자를 붙여 놓고, 예고 한 번 동안
 *   · 가장 가까웠던 거리 (0에 가까우면 파고든 것)
 *   · **판정이 뜬 그 순간의 거리** ← 이게 사거리를 넘으면 헛칩니다
 *   · 판정 순간 플레이어가 적의 뒤에 있었는가 (지나쳐 버린 증거)
 *   · 실제로 맞았는가
 *
 * ⚠️ 수치는 전부 게임에서 꺼냅니다(사거리·돌진 속도·예고 길이).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5208
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
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🐗 돌진 검증 — 달려드는 자가 닿는가, 지나치는가\n')

  const roster = await page.evaluate(() => window.__game.enemyRoster())
  const charger = roster.find((r) => r.id === 'charger')
  const rush = charger.attacks[0]
  console.log(
    `  [설정] 사거리 ${rush.reach}m · 돌진 ${rush.lungeSpeed} m/s · ` +
      `접근 ${charger.approachSpeed.toFixed(1)} m/s (전투 ${charger.moveSpeed})\n`,
  )

  /**
   * 한 번의 관측. **가만히 선** 플레이어에게 거리 `startDist` 에서 붙여 놓고
   * 예고 → 판정을 끝까지 봅니다.
   *
   * 플레이어를 안 움직이는 이유: 움직이면 "빗나갔다"의 원인이 돌진 때문인지
   * 플레이어가 피해서인지 갈리지 않습니다. 재려는 것은 **돌진 자체**입니다.
   */
  const observe = async (startDist) =>
    page.evaluate(async (d) => {
      const G = window.__game
      G.reset()
      const sleep = () => new Promise((r) => setTimeout(r, 8))
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t = now()
        const deadline = Date.now() + 30000
        while (now() - t < sec && Date.now() < deadline) await sleep()
      }
      await wait(0.4)
      G.clearEnemies()
      const p = G.state().player
      const e = G.spawnEnemyKind('charger', p.x + d, p.z)

      let minDist = Infinity
      let hitDist = -1
      let behindAtHit = null
      let sawWindup = false
      const hp0 = G.state().player.hp
      // 🧾 장부를 비우고 시작합니다 — 앞 판의 휘두름이 섞이면 이 판의
      //    숫자가 거짓이 됩니다(crowd-probe 가 같은 사고를 한 번 냈습니다).
      G.swings()

      const t0 = now()
      const deadline = Date.now() + 60000
      /**
       * ⚠️ **예고의 마지막 프레임**을 붙잡습니다 — 판정이 뜬 프레임이 아니라.
       *
       * 판정(active)은 0.16초인데 이 환경의 한 프레임이 약 0.1초입니다.
       * 그 창을 노리면 프레임률에 따라 놓치기도 하고 잡히기도 해서, 같은
       * 코드가 판마다 다른 답을 냅니다. 예고가 끝난 순간의 거리는 **반드시**
       * 관측되고, 휘두름이 닿을지를 정하는 것도 정확히 그 거리입니다.
       *
       * 또 `enemyInfo` 는 공격 단계를 숫자로 안 줍니다(반격 프로브가
       * `phase === 0` 을 베끼지 못하게 일부러 `winding` 만 냅니다).
       * 그래서 `winding` 이 참인 동안의 마지막 값을 들고 있습니다.
       */
      while (now() - t0 < 8 && Date.now() < deadline) {
        const info = G.enemyInfo(e)
        if (!info) break
        const s = G.state().player
        const dist = Math.hypot(info.x - s.x, info.z - s.z)
        if (dist < minDist) minDist = dist
        if (info.winding) {
          sawWindup = true
          hitDist = dist
          // 플레이어가 적의 **뒤**에 있는가 = 적이 지나쳐 버렸다는 뜻입니다.
          behindAtHit = G.testBehind(s.x, s.z, info.x, info.z, info.rotY)
        } else if (sawWindup && info.attacking) {
          /**
           * ⚠️ **여기서 멈추면 «맞기 직전»에 체력을 읽습니다.**
           *
           * 원래는 이 프레임에서 바로 `break` 했습니다. 그런데 피해는
           * **판정(active) 단계**에 들어갑니다 — 예고가 끝나는 순간은
           * 아직 아무 일도 안 일어난 때입니다. 그래서 이 프로브는
           * *"예고 3/3 · 판정 순간 5.12m vs 사거리 5.5m · 지나쳐 가지도
           * 않음 · **피해 0**"* 이라는, 서로 모순인 표를 내고 있었습니다.
           * 기하는 다 맞는데 피해만 0이면 **재는 순간**을 의심해야 합니다.
           *
           * 이 회차에 같은 병을 한 번 고쳤습니다 — `bypass` 의 8초 창이
           * 무리가 **오기 전에** 열려 있던 자리입니다.
           * **재는 순간이 판정보다 빠르면 언제나 0이 나옵니다.**
           *
           * 그래서 판정이 시작된 뒤 **0.6초를 더 봅니다.** 판정(0.16초)과
           * 그 직후를 덮으면서, 쿨다운(3.2초)보다 훨씬 짧아 **두 번째
           * 공격이 섞이지 않습니다** — 원래 주석이 걱정하던 그 조건을
           * 그대로 지킵니다.
           */
          const until = G.state().simElapsed + 0.6
          while (G.state().simElapsed < until) {
            if (G.state().player.hp < hp0 - 0.01) break
            await sleep()
          }
          break
        }
        await sleep()
      }
      const dmg = hp0 - G.state().player.hp
      /**
       * 🧾 **왜 안 맞았는지는 장부가 압니다.** 「기하는 맞는데 피해가 0」
       * 이 나왔을 때 짐작할 것이 넷이나 됩니다 — 무적 · 부채꼴 밖 ·
       * 사거리 밖 · 아예 안 휘두름. 장부에는 그 넷이 다 적혀 있습니다.
       */
      const led = G.swings().filter((x) => x.attackId.startsWith('charger'))
      G.clearEnemies()
      return {
        sawWindup,
        minDist: Number(minDist.toFixed(2)),
        hitDist: Number(hitDist.toFixed(2)),
        behindAtHit,
        damage: Number(dmg.toFixed(1)),
        ledger: led.map(
          (x) =>
            `${x.attackId} ${x.hit ? '맞음' : '빗나감'} 거리${x.dist.toFixed(
              2,
            )}/사거리${x.reach} 각${x.angleDeg.toFixed(0)}°/반부채${x.halfArcDeg}° ${
              x.invuln ? '·무적' : ''
            }`,
        ),
      }
    }, startDist)

  /**
   * 두 거리에서 봅니다.
   *   · 6.5m — 예고가 걸릴 수 있는 **가장 먼 쪽**(maxRange 7.5 바로 안쪽).
   *            돌진이 가장 길게 걸리는 자리라 지나침이 있으면 여기서 납니다.
   *   · 4.5m — 사거리 바로 밖. 돌진이 짧게만 걸립니다.
   */
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  for (const d of [6.5, 4.5]) {
    const runs = []
    for (let i = 0; i < 3; i++) runs.push(await observe(d))
    const seen = runs.filter((r) => r.sawWindup && r.hitDist >= 0)
    console.log(
      `  [${d}m 에서] 예고 관측 ${seen.length}/3 · 가장 가까웠던 거리 ${med(runs.map((r) => r.minDist))}m · ` +
        `판정 순간 거리 ${seen.length ? med(seen.map((r) => r.hitDist)) : '-'}m · ` +
        `판정 순간 뒤에 있었음 ${runs.filter((r) => r.behindAtHit).length}/3 · ` +
        `피해 ${med(runs.map((r) => r.damage))}`,
    )
    if (seen.length) {
      check(
        med(seen.map((r) => r.hitDist)) <= rush.reach,
        `${d}m — 판정이 뜰 때 사거리 안에 있다 (돌진이 지나쳐 버리지 않는다)`,
        `판정 순간 ${med(seen.map((r) => r.hitDist))}m vs 사거리 ${rush.reach}m`,
      )
      check(
        runs.filter((r) => r.behindAtHit).length === 0,
        `${d}m — 판정 순간 플레이어를 뚫고 지나가 있지 않다`,
        `뒤에 있었음 ${runs.filter((r) => r.behindAtHit).length}/3`,
      )
      check(
        med(runs.map((r) => r.damage)) > 0,
        `${d}m — 가만히 서 있으면 실제로 맞는다`,
        `피해 ${med(runs.map((r) => r.damage))}` +
          (med(runs.map((r) => r.damage)) === 0
            ? `\n     🧾 장부 — ${runs.flatMap((r) => r.ledger).slice(0, 3).join(' · ') || '휘두름 기록 없음'}`
            : ''),
      )
    } else {
      check(false, `${d}m — 예고를 관측했다`, '8초 안에 공격을 걸지 않았습니다')
    }
  }

  /**
   * ── ⚠️ 위 검사들의 **치명적인 한계** ─────────────────────────────
   *
   * 여기까지는 플레이어가 **가만히 서서 아무것도 안 합니다.** 그 조건에서
   * 돌진은 7/7 로 통과했고, 저는 그걸 근거로 "기전은 설계대로 작동한다"고
   * 적었습니다. 그런데 3판 벤치는 이 적의 **판정이 한 번도 안 뜬다**고
   * 말했습니다(끊김 100%).
   *
   * 둘 다 맞았습니다. 프로브가 재던 상황이 **실제 전투에서 일어나지 않는
   * 상황**이었을 뿐입니다. 진짜 전투에서 플레이어는 때립니다. 그리고
   * 돌진은 적을 **플레이어의 사거리 안(3.1m)** 까지 끌고 들어옵니다 —
   * 1.4초짜리 예고를 띄운 채로. 그 1.4초 동안 콤보가 들어가면 강인도(45)가
   * 무너지고 휘두름은 영영 안 나옵니다.
   *
   * 그래서 같은 것을 **때리면서** 한 번 더 잽니다. 검사에서 빠져 있던
   * 조건이 하필 결과를 뒤집는 조건이었습니다.
   */
  console.log('')
  const fighting = await page.evaluate(async () => {
    const G = window.__game
    const out = []
    for (let i = 0; i < 3; i++) {
      G.reset()
      const sleep = () => new Promise((r) => setTimeout(r, 8))
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t = now()
        const dl = Date.now() + 30000
        while (now() - t < sec && Date.now() < dl) await sleep()
      }
      await wait(0.4)
      G.clearEnemies()
      const p = G.state().player
      const e = G.spawnEnemyKind('charger', p.x + 6.5, p.z)
      G.aimAtWorld(p.x + 6.5, p.z)

      let sawWindup = false
      let reachedActive = false
      let broken = false
      let windupEndDist = -1
      let hpAtWindup = -1
      let maxHp = 0
      let hpAtEnd = -1
      const t0 = now()
      const dl = Date.now() + 60000
      while (now() - t0 < 10 && Date.now() < dl) {
        const info = G.enemyInfo(e)
        if (!info) break
        const s = G.state().player
        const dist = Math.hypot(info.x - s.x, info.z - s.z)
        // 플레이어는 **계속 때립니다** — 실제 전투가 그렇습니다.
        G.aimAtWorld(info.x, info.z)
        G.press('Mouse0')
        G.release('Mouse0')
        if (info.winding) {
          if (!sawWindup) {
            // ⚠️ **예고가 시작되는 순간의 체력.** "예고 도중에 죽는다"를
            //    고치려면 얼마나 올려야 하는지가 이 값에서 나옵니다 —
            //    추측한 체력을 넣고 벤치를 돌리는 것보다 한 단계 빠릅니다.
            hpAtWindup = info.hp
            maxHp = info.max
          }
          sawWindup = true
          windupEndDist = dist
        } else if (sawWindup) {
          // 예고가 끝났습니다. 공격 상태로 남아 있으면 판정까지 간 것이고,
          // 경직/무너짐이면 끊긴 것입니다.
          if (info.attacking) reachedActive = true
          else broken = true
          break
        }
        await sleep()
      }
      {
        const fin = G.enemyInfo(e)
        hpAtEnd = fin ? fin.hp : 0 // null = 죽어서 사라짐
      }
      out.push({
        sawWindup,
        reachedActive,
        broken,
        windupEndDist: Number(windupEndDist.toFixed(2)),
        hpAtWindup,
        maxHp,
        hpAtEnd,
        // 예고 한 번을 버티는 데 실제로 필요한 체력 = 그 사이에 깎인 양
        drainDuringWindup: hpAtWindup >= 0 ? Number((hpAtWindup - hpAtEnd).toFixed(1)) : -1,
      })
      G.clearEnemies()
    }
    return out
  })
  const sawN = fighting.filter((r) => r.sawWindup).length
  const activeN = fighting.filter((r) => r.reachedActive).length
  console.log(
    `  [때리면서 6.5m] 예고 관측 ${sawN}/3 · 판정까지 감 ${activeN}/3 · ` +
      `끊김 ${fighting.filter((r) => r.broken).length}/3 · ` +
      `예고 끝 거리 ${fighting.map((r) => r.windupEndDist).join(' / ')}m`,
  )
  /**
   * **예고를 한 번 버티는 데 드는 체력.**
   *
   * 벤치가 "🟢 예고 7회 중 3회는 적이 죽어서 끝났다"고 했습니다. 고칠 값은
   * 체력인데, 얼마로 올릴지를 추측하면 오늘 두 번 되돌린 것과 같은 일이
   * 반복됩니다. 그래서 **예고가 시작된 순간의 체력**과 **그 사이에 깎인 양**을
   * 직접 잽니다 — 필요한 체력이 숫자에서 나오게.
   */
  const withHp = fighting.filter((r) => r.hpAtWindup >= 0)
  if (withHp.length) {
    console.log(
      `  [예고 한 번의 값] 예고 시작 체력 ${withHp.map((r) => r.hpAtWindup).join(' / ')}` +
        ` (최대 ${withHp[0].maxHp}) · 예고 중 깎인 양 ${withHp.map((r) => r.drainDuringWindup).join(' / ')}`,
    )
  }
  /**
   * ⚠️ **여기에는 합격/불합격을 두지 않습니다.**
   *
   * 처음엔 "때리면서도 휘두름이 나온다"를 검사로 걸었습니다. 그런데 돌진을
   * 11 과 0 으로 놓고 각각 재 보니 **예고 끝 거리가 똑같았습니다**
   * (1.89/2.48/1.89 vs 1.84/2.33/1.83). 그 거리를 정하는 것은 적의 돌진이
   * 아니라 **플레이어 자신의 파고들기**(beginAttack 의 dashSpeed)였습니다.
   *
   * 즉 이 검사는 적을 재는 척하면서 플레이어를 재고 있었습니다. 켜든 끄든
   * 같은 답이 나오는 검사는 **가르는 힘이 없습니다.** 그래서 검사에서 빼고
   * 관측값만 남깁니다 — 값 자체는 여전히 쓸모가 있습니다: 가만히 선 시험이
   * 실제 전투를 **대표하지 않는다**는 것을 이 한 줄이 보여 줍니다.
   */

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
