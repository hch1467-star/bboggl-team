/**
 * 처형 검증 — `npm run finish`
 *
 * ── 왜 이 프로브가 생겼는가 ──────────────────────────────────────
 * 강인도 붕괴는 원래 *"긴 무방비 자체가 보상"* 으로 두고 별도 배수를 안
 * 붙였습니다. 그 판단이 옳으려면 **무방비 동안 실제로 때리고 있어야** 합니다.
 * 자동 플레이로 재 보니 한 판에 붕괴 **34회**(처치 45마리)인데, 무방비인 적
 * 곁에서 실제로 때린 시간은 **44%** 였습니다. 가장 자주 오는 큰 보상의
 * 절반 이상이 그냥 흘러가고 있었습니다.
 *
 * 그래서 세키로의 인살·소울의 리포스트·오공의 처형이 하는 일을 합니다:
 * **무너진 상태에만 붙는 동사**를 하나 만듭니다.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────
 * 재야 할 것은 "처형이 세다"가 아닙니다. 세게 만드는 건 숫자 하나면 됩니다.
 * 재야 할 것은 **처형이 거래인가** 입니다:
 *
 *   1) 무방비가 아니면 **안 나간다** (평소 공격이 그대로 나간다)
 *   2) 무방비면 나가고 **확실히 크다**
 *   3) 처형은 **무방비를 소모한다** (한 번의 붕괴에 한 번)
 *   4) 치명타·백어택 배수를 **받지 않는다** (한 방에 전투가 끝나지 않게)
 *   5) 선행동작 동안 **무적이 아니다** (옆의 적에게는 여전히 열려 있다)
 *
 * 3·4·5가 없으면 처형은 거래가 아니라 그냥 공짜 강화입니다.
 *
 * ⚠️ 수치를 여기 베껴 적지 않습니다. 배수·사거리·스태미나는 게임의
 *    finisherInfo() 에서 읽습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5207
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
      /**
       * 적 하나를 코앞에 세우고 **한 대 때린 피해**를 잽니다.
       * `broken` 이 참이면 때리기 직전에 강인도를 부숴 무방비로 만듭니다.
       */
      strike: async (broken, fromBehind = false) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.3)
        const p = G.playerEntity()
        // 적은 플레이어를 등지게 세웁니다 — 백어택 여부를 실험이 정하도록.
        const e = G.spawnEnemyKind('grunt', G.state().player.x + 1.4, G.state().player.z)
        await window.__t.runFor(0.2)
        G.setHp(e, 100000)
        G.freezeEnemies(true)
        if (fromBehind) {
          const es = G.entityState(e)
          G.teleportEntity(e, es.x, es.z)
          // 적이 플레이어 반대쪽을 보게 돌립니다.
          G.faceEntity?.(e, 0)
        }
        if (broken) G.breakEnemy(e)
        await window.__t.runFor(0.1)
        const info0 = G.finisherInfo()
        const hp0 = G.entityState(e).hp
        const es = G.entityState(e)
        G.aimAtWorld(es.x, es.z)
        G.press('Mouse0')
        G.release('Mouse0')
        await window.__t.runFor(1.4)
        const after = G.entityState(e)
        G.freezeEnemies(false)
        return {
          damage: Number((hp0 - after.hp).toFixed(1)),
          ready: info0.ready,
          brokenAfter: G.enemyInfo(e)?.broken ?? false,
          finishers: G.finisherInfo().count,
          entity: e,
        }
      },
    }
  })

  console.log('\n🗡️ 처형 검증\n')

  const spec = await page.evaluate(() => window.__game.finisherInfo())
  console.log(
    `  [제원] 사거리 ${spec.reach}m · 마무리 타의 ${spec.damageMultiplier}배 · 스태미나 ${spec.staminaCost}\n`,
  )

  // ---- 1. 무방비가 아니면 안 나간다 ----
  const normal = await page.evaluate(() => window.__t.strike(false))
  check(!normal.ready, '무방비가 아니면 처형 안내가 뜨지 않는다')
  check(normal.damage > 0, '평소 공격은 그대로 나간다', `피해 ${normal.damage}`)
  const beforeCount = normal.finishers

  // ---- 2. 무방비면 나가고, 확실히 크다 ----
  const fin = await page.evaluate(() => window.__t.strike(true))
  check(fin.ready, '무방비면 처형 안내가 뜬다')
  check(
    fin.finishers > beforeCount,
    '무방비인 적에게 기본 공격을 넣으면 처형이 나간다 (새 키가 필요 없다)',
    `처형 누적 ${beforeCount} → ${fin.finishers}`,
  )
  check(
    fin.damage > normal.damage * 1.8,
    '처형이 평소 한 대보다 확실히 크다 (창을 소모할 값어치)',
    `평소 ${normal.damage} → 처형 ${fin.damage}`,
  )

  // ---- 3. 처형은 무방비를 소모한다 ----
  //
  // 이게 없으면 처형은 거래가 아니라 공짜입니다. 한 번의 붕괴에 여러 번
  // 꽂을 수 있으면 붕괴 34회가 그대로 전투 34번의 종료가 됩니다.
  check(!fin.brokenAfter, '처형을 맞히면 무방비가 끝난다 (한 번의 붕괴에 한 번)')

  const twice = await page.evaluate(async () => {
    const G = window.__game
    const r = await window.__t.strike(true)
    // 곧바로 한 번 더 — 이번엔 무방비가 아니므로 처형이 나가면 안 됩니다.
    const before = G.finisherInfo().count
    const es = G.entityState(r.entity)
    G.teleportPlayer(es.x - 1.4, es.z)
    G.aimAtWorld(es.x, es.z)
    await window.__t.runFor(0.2)
    G.press('Mouse0')
    G.release('Mouse0')
    await window.__t.runFor(1.2)
    return { before, after: G.finisherInfo().count }
  })
  check(
    twice.after === twice.before,
    '같은 붕괴에서 처형이 두 번 나가지 않는다',
    `처형 누적 ${twice.before} → ${twice.after}`,
  )

  // ---- 4. 치명타·백어택 배수를 받지 않는다 ----
  //
  // 무방비인 적은 **돌아서지 않습니다.** 등을 잡기가 너무 쉬워서, 배수가
  // 붙으면 사실상 상시 중첩이 됩니다. 그래서 처형 피해는 **매번 같아야**
  // 합니다. 여러 번 재서 흔들리지 않는 것으로 확인합니다.
  const samples = []
  for (let i = 0; i < 4; i++) {
    const r = await page.evaluate(() => window.__t.strike(true))
    samples.push(r.damage)
  }
  const spread = Math.max(...samples) - Math.min(...samples)
  check(
    spread < 0.5,
    '처형 피해는 매번 같다 (치명타·백어택 배수를 받지 않는다)',
    `표본 [${samples.join(', ')}] 편차 ${spread.toFixed(1)}`,
  )

  // ---- 5. 선행동작 동안 무적이 아니다 ----
  //
  // 이 존은 교전 중 45%가 둘 이상입니다. 처형이 무적이면 "여럿에게 둘러싸이면
  // 아무나 무너뜨리고 처형으로 시간을 벌기"가 최적이 되어, 조합 설계가
  // 통째로 무의미해집니다.
  const punished = await page.evaluate(async () => {
    const G = window.__game
    G.reset()
    await window.__t.runFor(0.4)
    G.clearEnemies()
    await window.__t.runFor(0.3)
    const p = G.state().player
    const victim = G.spawnEnemyKind('grunt', p.x + 1.4, p.z)
    await window.__t.runFor(0.2)
    G.setHp(victim, 100000)
    G.freezeEnemies(true)
    G.breakEnemy(victim)
    const es = G.entityState(victim)
    G.aimAtWorld(es.x, es.z)
    G.press('Mouse0')
    G.release('Mouse0')
    /**
     * 처형 선행동작 중에 **다른 적**의 공격을 맞춰 봅니다.
     *
     * ⚠️ 두 가지를 처음에 틀렸습니다:
     *   · 적을 얼려둔 채 forceAttack 만 걸었더니 예고에서 멈춰 영영 안 때렸고,
     *   · 플레이어가 파고들기(lunge)로 앞으로 나가서, 미리 잡아둔 좌표는
     *     이미 사거리 밖이었습니다.
     * 그래서 **선행동작이 시작된 뒤의 실제 위치**를 읽어 그 옆에 세우고,
     * AI를 다시 켭니다. 계측기가 틀리면 "무적이다"라는 거짓 결론이 나옵니다.
     */
    await window.__t.runFor(0.08)
    const now = G.state().player
    const hpBefore = now.hp
    const other = G.spawnEnemyKind('grunt', now.x - 1.1, now.z)
    G.setHp(other, 100000)
    G.freezeEnemies(false)
    G.forceAttack(other, 0)
    await window.__t.runFor(1.6)
    return { hpBefore, hpAfter: G.state().player.hp }
  })
  check(
    punished.hpAfter < punished.hpBefore,
    '처형 중에도 옆의 적에게는 맞는다 (무적이 아니다 — 결정에 위험이 있다)',
    `체력 ${punished.hpBefore.toFixed(0)} → ${punished.hpAfter.toFixed(0)}`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
