/**
 * 🏹 엄폐 검증 — `npm run cover`
 *
 * ── 왜 이걸 만들었나 ───────────────────────────────────────────
 * 쏘는 자를 만들 때 enemyAttacks.ts 에 이렇게 적어 두었습니다:
 *
 *   > *이 적이 만드는 새로움은 색이 아니라 **위치**입니다.*
 *
 * 그런데 위치로 할 수 있는 일이 **하나뿐**이었습니다 — 선 위에서 비켜서기.
 * 12m 짜리 화살은 앞에 뭐가 서 있든 **통과**했습니다. 소울류·젤다·헤일로가
 * 전부 쓰는 규칙(화살은 처음 만나는 몸에 박힌다)을 넣고, **정말 그렇게
 * 되는지**를 여기서 잽니다.
 *
 * ── 이 프로브가 반드시 세 방향을 다 봐야 하는 이유 ──────────────
 * "막혔다"만 검사하면 **아무도 안 맞는 고장**과 구별되지 않습니다.
 * 그래서 셋을 같이 봅니다:
 *
 *   1. 아무도 없으면 **플레이어가 맞는다**      (기준선 — 화살이 살아 있다)
 *   2. 선 위에 세우면 **플레이어가 안 맞는다**   (막힌다)
 *   3. 그때 **막은 쪽이 대신 맞는다**           (사라진 게 아니라 옮겨간 것)
 *   4. 옆으로 비킨 몸은 **안 막는다**           (항상 막히는 고장이 아니다)
 *
 * ⚠️ 3번이 없으면 "화살이 그냥 없어지는 버그"가 통과합니다. 4번이 없으면
 *    "부채꼴을 무시하고 무조건 앞의 하나에 꽂히는 버그"가 통과합니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5219
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

  console.log('\n🏹 엄폐 검증 — 화살은 처음 만나는 몸에 박히는가\n')

  const roster = await page.evaluate(() => window.__game.enemyRoster())
  const shot = roster
    .flatMap((r) => r.attacks)
    .find((a) => a.id === 'archer_shot')
  console.log(`  [설정] 화살 사거리 ${shot.reach}m · 부채꼴 ${shot.arcDeg}° · 예고 ${shot.windup}초\n`)

  /**
   * 한 판 = 궁수 하나 + (선택) 막는 잡몹 하나.
   *
   * ⚠️ 막는 잡몹은 **매 프레임 제자리에 다시 세웁니다.** 살아 있는 잡몹은
   *    예고 1.25초 동안 3m 를 걸어와 선을 벗어나기 때문입니다. `freezeEnemies`
   *    로 얼리면 궁수까지 안 쏘므로 쓸 수 없습니다. 그래서 자리만 고정하고
   *    나머지는 게임이 하던 대로 하게 둡니다 — 규칙은 게임이 판정합니다.
   */
  const trial = async (blockerOffsetZ) =>
    await page.evaluate(async ([offZ, range]) => {
      const G = window.__game
      const sleep = () => new Promise((r) => setTimeout(r, 8))
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t0 = now()
        const dl = Date.now() + 30000
        while (now() - t0 < sec && Date.now() < dl) await sleep()
      }
      G.reset()
      await wait(0.4)
      G.clearEnemies()
      await wait(0.2)

      const p0 = G.state().player
      // 궁수는 사거리의 3/4 쯤에 — 최소 사거리(3m)보다 멀고 사거리 안입니다.
      const ax = p0.x + range * 0.75
      const archer = G.spawnEnemyKind('archer', ax, p0.z)
      // 막는 몸은 **정확히 중간**에. offZ 로 옆으로 밀면 부채꼴을 벗어납니다.
      const bx = p0.x + range * 0.375
      const blocker = offZ === null ? -1 : G.spawnEnemyKind('grunt', bx, p0.z + offZ)
      if (blocker >= 0) G.setHp(blocker, 100000) // 죽어서 사라지면 막던 것도 사라집니다.
      await wait(0.2)

      const hp0 = G.state().player.hp
      const bhp0 = blocker >= 0 ? G.enemyInfo(blocker).hp : 0
      // 플레이어는 가만히 서 있습니다 — 피하는 능력이 아니라 **규칙**을 재는 중입니다.
      let swung = false
      const t0 = now()
      const dl = Date.now() + 60000
      while (now() - t0 < 25 && Date.now() < dl) {
        if (blocker >= 0) G.teleportEnemy(blocker, bx, p0.z + offZ)
        G.teleportPlayer(p0.x, p0.z)
        const info = G.enemyInfo(archer)
        if (!info) break
        if (info.attacking && !info.winding) swung = true
        if (swung && !info.attacking) break // 판정이 끝났습니다.
        await sleep()
      }
      await wait(0.3)
      const hp1 = G.state().player.hp
      const bhp1 = blocker >= 0 ? (G.enemyInfo(blocker)?.hp ?? bhp0) : 0
      G.clearEnemies()
      return {
        swung,
        playerLost: Number((hp0 - hp1).toFixed(1)),
        blockerLost: Number((bhp0 - bhp1).toFixed(1)),
      }
    }, [blockerOffsetZ, shot.reach])

  // ---- 1. 기준선 — 아무도 없으면 플레이어가 맞는다 ----
  const clear = await trial(null)
  check(clear.swung, '궁수가 실제로 쐈다 (기준선)', `${clear.swung ? '쏨' : '안 쏨'}`)
  check(
    clear.playerLost > 0,
    '가리는 것이 없으면 화살이 플레이어를 맞힌다',
    `플레이어 체력 −${clear.playerLost}`,
  )

  // ---- 2·3. 선 위에 세우면 막히고, 막은 쪽이 대신 맞는다 ----
  const blocked = await trial(0)
  check(
    blocked.swung && blocked.playerLost === 0,
    '**선 위에 몸이 있으면** 플레이어는 안 맞는다 (엄폐가 된다)',
    `플레이어 체력 −${blocked.playerLost}`,
  )
  check(
    blocked.blockerLost > 0,
    '   ↳ 그리고 **막은 쪽이 대신 맞는다** (화살이 사라진 게 아니다)',
    `막은 잡몹 체력 −${blocked.blockerLost}`,
  )

  /**
   * ---- 4. 옆으로 비킨 몸은 안 막는다 ----
   *
   * ⚠️ 얼마나 옆으로 밀지를 **제가 정하지 않습니다.** 부채꼴 절반 각도에
   *    해당하는 옆거리를 게임 설정(각도·사거리)에서 계산하고, 거기에
   *    몸 두께가 더 있으니 넉넉히 두 배로 밉니다. 상수를 베끼면 각도를
   *    바꿨을 때 이 검사만 옛 각도로 통과합니다.
   */
  const half = (shot.arcDeg * Math.PI) / 180 / 2
  const off = Math.tan(half) * (shot.reach * 0.375) * 2 + 2
  const aside = await trial(Number(off.toFixed(2)))
  check(
    aside.swung && aside.playerLost > 0,
    '옆으로 비킨 몸은 **안 막는다** (부채꼴을 무시하고 막는 고장이 아니다)',
    `옆으로 ${off.toFixed(1)}m · 플레이어 체력 −${aside.playerLost} · 그 몸 −${aside.blockerLost}`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
