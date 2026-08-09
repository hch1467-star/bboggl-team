/**
 * 모루 검증 — `npm run anvil`
 *
 * ── 이 프로브가 재는 것은 대부분 "**안 하는 것**" 입니다 ──────────────
 * 모루의 존재 이유는 화톳불에서 **기능 하나만 떼어 온 것**입니다:
 * 불티와 정련석은 쓸 수 있지만, 회복도 부활도 적 부활도 없습니다.
 *
 * 그래서 위험이 보통 기능과 반대 방향으로 있습니다. 새 기능은 "안 된다"가
 * 바로 보이지만, 모루는 **되면 안 되는 것이 조용히 되는** 쪽이 훨씬
 * 위험합니다. 성수병이 몰래 차 있으면 아무도 눈치채지 못한 채 난이도가
 * 통째로 무너지고, 부활 지점이 몰래 옮겨지면 지름길(사다리)의 값어치가
 * 사라집니다 — 그건 이 존의 지도 설계 전체를 헛되게 만드는 일입니다.
 *
 * "안 되는 것"은 시험을 안 쓰면 **영영 발견되지 않습니다.** 그래서 씁니다.
 *
 * ⚠️ 위치·반경·비용을 여기 베껴 적지 않습니다. 전부 게임에서 읽습니다.
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
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })

  await page.evaluate(() => {
    window.__t = {
      runFor: async (seconds) => {
        const target = window.__game.state().simElapsed + seconds
        const deadline = Date.now() + 120000
        while (window.__game.state().simElapsed < target && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 8))
        }
      },
    }
  })

  console.log('\n🔨 모루 검증\n')

  const anvils = await page.evaluate(() => window.__game.anvils())
  check(anvils.length >= 1, '존에 모루가 놓여 있다', `${anvils.length}개`)
  if (anvils.length === 0) throw new Error('모루가 없어 나머지를 시험할 수 없습니다')

  /**
   * ---- 1. 자리 — 벌이의 **뒤**, 보스 영역 **밖** ----
   *
   * 모루를 만든 이유가 "수입이 들어오는 쪽에 소비처를 둔다"이므로,
   * 자리가 틀리면 물건이 맞아도 문제는 그대로입니다.
   * 그리고 보스 영역 안에 있으면 보스전 중에 뒤로 빠져 쓰는 길이 생깁니다.
   */
  const geo = await page.evaluate(() => {
    const G = window.__game
    const b = G.bossEncounter()
    const a = G.anvils()[0]
    const bs = b ? G.entityState(b.entity) : null
    return {
      anvil: a,
      arena: b?.arenaRadius ?? 0,
      dist: bs ? Math.hypot(a.x - bs.x, a.z - bs.z) : -1,
      fire: G.nearestBonfire(),
    }
  })
  if (geo.dist > 0) {
    check(
      geo.dist > geo.arena,
      '모루가 보스 영역 밖에 있다 (전투 중 후퇴로 쓸 수 없다)',
      `보스에서 ${geo.dist.toFixed(1)}m · 영역 ${geo.arena}m`,
    )
  }

  /**
   * ---- 2. 되면 안 되는 것 셋 ----
   *
   * 모루 위에 세워 두고 **한참** 서 있어 봅니다. 화톳불이라면 이 사이에
   * 성수병이 차고 부활 지점이 옮겨지고 적이 되살아납니다.
   */
  const before = await page.evaluate(async () => {
    const G = window.__game
    G.reset()
    await window.__t.runFor(0.5)
    const a = G.anvils()[0]
    G.teleportPlayer(a.x, a.z)
    await window.__t.runFor(0.4)
    // 성수병을 **일부러 비우고** 체력도 깎아 둡니다. 그래야 "찼다"가 보입니다.
    G.setVials(0)
    G.damageEntity(G.playerEntity(), 40)
    await window.__t.runFor(0.4)
    const v = G.vialInfo()
    return { vials: v.vials, hp: Number(v.hp.toFixed(1)), enemies: G.state().enemiesLeft }
  })
  // 화톳불 휴식 시간(BONFIRE.restTime)보다 **훨씬 오래** 서 있습니다.
  await page.evaluate(() => window.__t.runFor(6))
  const after = await page.evaluate(() => {
    const G = window.__game
    const v = G.vialInfo()
    return {
      vials: v.vials,
      hp: Number(v.hp.toFixed(1)),
      enemies: G.state().enemiesLeft,
      hasRespawn: v.hasRespawn,
    }
  })

  check(after.vials === before.vials, '모루 위에서 6초 — 성수병이 차지 않는다', `${before.vials} → ${after.vials}`)
  check(after.hp <= before.hp + 0.5, '모루 위에서 6초 — 체력이 회복되지 않는다', `${before.hp} → ${after.hp}`)
  check(
    after.enemies <= before.enemies,
    '모루 위에서 6초 — 적이 되살아나지 않는다',
    `${before.enemies} → ${after.enemies}`,
  )
  check(!after.hasRespawn, '모루는 부활 지점이 되지 않는다 (지름길의 값어치를 지킨다)', `hasRespawn=${after.hasRespawn}`)

  /**
   * ---- 3. 되어야 하는 것 하나 ----
   *
   * 여기가 통과해야 이 물건이 존재할 이유가 생깁니다.
   * 비용은 게임에서 읽습니다 — 상수를 베끼면 값을 바꿨을 때 시험만 통과합니다.
   */
  const spend = await page.evaluate(async () => {
    const G = window.__game
    const wu = G.weaponUpgradeInfo()
    G.setEmbers(wu.nextCost + 50)
    G.setStones(wu.nextStoneCost + 1)
    await window.__t.runFor(0.3)
    const beforeLv = G.weaponUpgradeInfo().level
    G.press('KeyB')
    await window.__t.runFor(0.3)
    G.release('KeyB')
    await window.__t.runFor(0.3)
    const w = G.weaponUpgradeInfo()
    return { beforeLv, afterLv: w.level, cost: wu.nextCost, stoneCost: wu.nextStoneCost, embers: G.emberInfo().embers }
  })
  check(
    spend.afterLv === spend.beforeLv + 1,
    '모루에서 무기를 강화할 수 있다',
    `${spend.beforeLv} → ${spend.afterLv} (불티 ${spend.cost} · 정련석 ${spend.stoneCost})`,
  )
  check(spend.embers <= 50, '강화한 만큼 불티가 실제로 빠졌다', `남은 불티 ${spend.embers}`)

  /**
   * ---- 4. 성수병 강화도 된다 ----
   * 화톳불에서 되던 소비는 **전부** 모루에서도 되어야 합니다.
   * 하나만 되면 플레이어는 "여기선 뭘 할 수 있더라"를 외워야 합니다.
   */
  const vialUp = await page.evaluate(async () => {
    const G = window.__game
    const em = G.emberInfo()
    G.setEmbers(em.upgradeCost + 10)
    await window.__t.runFor(0.3)
    const before = G.vialInfo().max
    G.press('KeyV')
    await window.__t.runFor(0.3)
    G.release('KeyV')
    await window.__t.runFor(0.3)
    return { before, after: G.vialInfo().max }
  })
  check(vialUp.after === vialUp.before + 1, '모루에서 성수병도 강화할 수 있다', `${vialUp.before} → ${vialUp.after}`)

  /**
   * ---- 5. 멀어지면 안 된다 ----
   * 반경 밖에서도 눌리면 "어디서나 강화"가 되어 소비처라는 개념이 사라집니다.
   */
  const far = await page.evaluate(async () => {
    const G = window.__game
    const a = G.anvils()[0]
    G.teleportPlayer(a.x + 12, a.z + 12)
    await window.__t.runFor(0.4)
    const wu = G.weaponUpgradeInfo()
    G.setEmbers(wu.nextCost + 50)
    G.setStones(wu.nextStoneCost + 1)
    await window.__t.runFor(0.3)
    const before = G.weaponUpgradeInfo().level
    G.press('KeyB')
    await window.__t.runFor(0.3)
    G.release('KeyB')
    await window.__t.runFor(0.3)
    return { before, after: G.weaponUpgradeInfo().level }
  })
  check(far.after === far.before, '모루에서 12m 떨어지면 강화되지 않는다', `${far.before} → ${far.after}`)

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
