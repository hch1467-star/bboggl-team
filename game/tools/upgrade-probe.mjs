/**
 * 무기 강화 검증 — `npm run upgrade`
 *
 * ── 왜 이 시스템을 넣었는가 ──────────────────────────────────────
 * 자동 플레이가 존을 끝냈을 때 **불티 364를 들고 강화는 1회**였습니다.
 * 불티는 쓸 곳이 없어 그냥 쌓이는 숫자였고, 그러면 "죽으면 불티를 잃는다"는
 * 규칙도 아프지 않습니다 — **잃어도 아깝지 않은 것을 잃는 것은 대가가 아닙니다.**
 *
 * ── 그래서 여기서 재는 것 ────────────────────────────────────────
 *   1) 강화가 실제로 피해를 올리는가 (설정한 비율대로)
 *   2) **무기마다 따로** 올라가는가 — 하나로 합치면 "무엇에 투자했는가"가 사라집니다
 *   3) 룬 스킬은 영향을 안 받는가 — 무기와 각인은 다른 성장이어야 합니다
 *   4) 세이브에 남는가 — 안 남으면 불티를 쓰는 것 자체가 손해가 됩니다
 *   5) 불티가 **실제로 모자란가** — 남아돌면 소비처를 만든 의미가 없습니다
 *
 * ⚠️ 수치를 베껴 적지 않습니다. WEAPON_UPGRADE 설정을 게임에서 읽습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5199
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

  const harness = () =>
    page.evaluate(() => {
      window.__t = {
        runFor: async (seconds) => {
          const target = window.__game.state().elapsed + seconds
          const deadline = Date.now() + 120000
          while (window.__game.state().elapsed < target && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 8))
          }
        },
        /** 허수아비 하나를 앞에 세웁니다. */
        dummy: async () => {
          const G = window.__game
          G.reset()
          await window.__t.runFor(0.4)
          G.clearEnemies()
          await window.__t.runFor(0.2)
          const p = G.state().player
          const e = G.spawnEnemyKind('grunt', p.x + 12, p.z)
          await window.__t.runFor(0.2)
          const es = G.entityState(e)
          G.setHp(e, 100000)
          G.teleportPlayer(es.x, es.z - 1.8)
          await window.__t.runFor(0.2)
          return e
        },
        /** 기본 공격 1타의 피해를 잽니다. */
        oneHit: async (e) => {
          const G = window.__game
          const es = G.entityState(e)
          const before = es.hp
          G.aimAtWorld(es.x, es.z)
          G.press('Mouse0')
          G.release('Mouse0')
          await window.__t.runFor(0.6)
          return Number((before - G.entityState(e).hp).toFixed(2))
        },
      }
    })

  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  await harness()

  console.log('\n⚒️  무기 강화 검증\n')

  const cfg = await page.evaluate(() => window.__game.weaponUpgradeInfo())
  console.log(
    `  [설정] 최대 +${cfg.maxLevel} · 단계당 피해 +${Math.round(cfg.damagePerLevel * 100)}% · 첫 비용 ${cfg.nextCost}\n`,
  )

  // ---- 1. 강화가 피해를 올리는가 ----
  const scaling = await page.evaluate(async () => {
    const G = window.__game
    const out = []
    for (const level of [0, 3]) {
      const e = await window.__t.dummy()
      G.setWeaponLevel(G.weaponUpgradeInfo().weapon, level)
      await window.__t.runFor(0.1)
      out.push({ level, damage: await window.__t.oneHit(e) })
    }
    return out
  })
  const [base, plus3] = scaling
  const expected = base.damage * (1 + 3 * cfg.damagePerLevel)
  check(base.damage > 0, '기준선 — +0 기본 공격이 들어간다', `${base.damage} 피해`)
  check(
    Math.abs(plus3.damage - expected) < base.damage * 0.02,
    '강화한 만큼 피해가 오른다 (설정대로)',
    `+0 ${base.damage} → +3 ${plus3.damage} (계산값 ${expected.toFixed(2)})`,
  )

  // ---- 2. 무기마다 따로 ----
  const perWeapon = await page.evaluate(async () => {
    const G = window.__game
    await window.__t.dummy()
    G.setWeaponLevel(0, 4)
    G.setWeaponLevel(1, 0)
    G.setWeaponLevel(2, 0)
    await window.__t.runFor(0.1)
    const before = G.weaponUpgradeInfo()
    // 2번 무기로 바꿉니다.
    G.press('Digit2')
    G.release('Digit2')
    await window.__t.runFor(0.3)
    const after = G.weaponUpgradeInfo()
    return { before, after }
  })
  check(
    perWeapon.before.level === 4 && perWeapon.after.level === 0,
    '무기를 바꾸면 강화 단계도 그 무기의 것으로 바뀐다',
    `무기0 +${perWeapon.before.level} → 무기${perWeapon.after.weapon} +${perWeapon.after.level}`,
  )
  check(
    perWeapon.after.levels[0] === 4,
    '다른 무기의 강화는 그대로 남는다 (투자한 것이 사라지지 않게)',
    `[${perWeapon.after.levels.join(', ')}]`,
  )

  // ---- 3. 룬 스킬은 영향을 받지 않는다 ----
  //
  // 무기와 각인이 같이 오르면 "무기를 키운다"는 선택이 그냥 전체 강화가 됩니다.
  const runeUnaffected = await page.evaluate(async () => {
    const G = window.__game
    const out = []
    for (const level of [0, 5]) {
      const e = await window.__t.dummy()
      G.setWeaponLevel(G.weaponUpgradeInfo().weapon, level)
      await window.__t.runFor(0.1)
      const es = G.entityState(e)
      const before = es.hp
      G.aimAtWorld(es.x, es.z)
      G.press('KeyF') // 룬 슬롯 1
      G.release('KeyF')
      await window.__t.runFor(1.0)
      out.push(Number((before - G.entityState(e).hp).toFixed(2)))
    }
    return out
  })
  check(
    runeUnaffected[0] > 0 && Math.abs(runeUnaffected[1] - runeUnaffected[0]) < 0.5,
    '룬 스킬은 무기 강화의 영향을 받지 않는다 (무기와 각인은 다른 성장)',
    `+0 ${runeUnaffected[0]} · +5 ${runeUnaffected[1]}`,
  )

  // ---- 4. 세이브에 남는다 ----
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  await page.evaluate(() => window.__game.resetProgress())
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  await harness()
  const saved = await page.evaluate(async () => {
    const G = window.__game
    G.setWeaponLevel(0, 2)
    G.setEmbers(0)
    await window.__t.runFor(0.2)
    G.saveNow()
    return G.weaponUpgradeInfo().levels
  })
  await page.reload()
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  const reloaded = await page.evaluate(() => window.__game.weaponUpgradeInfo().levels)
  check(
    reloaded[0] === saved[0] && saved[0] === 2,
    '게임을 다시 켜도 강화가 남는다 (안 남으면 불티를 쓰는 것 자체가 손해)',
    `[${saved.join(', ')}] → [${reloaded.join(', ')}]`,
  )

  // ---- 5. 불티가 실제로 모자란가 ----
  //
  // 이게 이 시스템을 넣은 **이유** 그 자체입니다. 한 판에서 버는 불티로
  // 전부 강화할 수 있으면, 소비처를 만들어도 자원은 여전히 남아돕니다.
  const totalCost = await page.evaluate(() => {
    const G = window.__game
    let sum = 0
    for (let lv = 0; lv < G.weaponUpgradeInfo().maxLevel; lv++) {
      G.setWeaponLevel(G.weaponUpgradeInfo().weapon, lv)
      sum += G.weaponUpgradeInfo().nextCost
    }
    G.setWeaponLevel(G.weaponUpgradeInfo().weapon, 0)
    return sum
  })
  /** 자동 플레이 한 판에서 실제로 번 불티(직전 측정값). */
  const RUN_EMBERS = 364
  check(
    totalCost > RUN_EMBERS * 2,
    '한 판 벌이로는 무기 하나도 다 못 올린다 (자원이 모자란 자원이 됨)',
    `총 ${totalCost} 불티 vs 한 판 벌이 ${RUN_EMBERS}`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
