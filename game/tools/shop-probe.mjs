/**
 * 🏪 모루의 상점 검증 — `npm run shop`
 *
 * ── 무엇을 묻는가 ──────────────────────────────────────────────────
 * 상점의 함정은 등급 시스템과 닮았습니다 — **창에는 있는데 사면 아무 일도
 * 안 일어납니다.** 그래서 여기서는 사고 나서
 *   · 불티가 실제로 줄었는가
 *   · 무기 등급이 실제로 올랐는가
 *   · 다시 사려 하면 막히는가
 * 를 **게임 상태**로 확인합니다.
 *
 * ── 이 상점의 설계가 지켜지는지도 같이 봅니다 ─────────────────────
 *   · **재입고가 없다** — 같은 모루는 언제 봐도 같은 재고
 *   · **자리다** — 모루에서 멀면 아무것도 안 보인다
 *   · **무기 종류마다 하나** — 안 쓰는 무기 것만 셋이 나오지 않는다
 *   · 값은 **강화 곡선 그대로** — 새 숫자가 아니다
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5245
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
  await page.evaluate(() => window.__game.resetProgress())
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  await page.evaluate(() => {
    window.__t = {
      runFor: async (s) => {
        const G = window.__game
        const t = G.state().elapsed + s
        const d = Date.now() + 60000
        while (G.state().elapsed < t && Date.now() < d) await new Promise((r) => setTimeout(r, 8))
      },
    }
  })

  console.log('\n🏪 모루의 상점 검증 — 창이 아니라 **지갑과 무기**를 봅니다\n')

  /**
   * ---- 1. 상점은 **자리**인가 ----
   *
   * 모루에서 멀면 아무것도 안 보여야 합니다. 이게 "메뉴"와 "자리"를
   * 가르는 유일한 선이고, 여기가 무너지면 모루를 찾아갈 이유가 없어집니다.
   */
  const away = await page.evaluate(async () => {
    const G = window.__game
    G.teleportPlayer(-59, 1) // 시작 지점 — 모루에서 멉니다
    await window.__t.runFor(0.3)
    return G.shopInfo()
  })
  check(!away.atAnvil, '🏪 모루에서 멀면 **상점이 없다** (메뉴가 아니라 자리다)', `재고 ${away.items.length}개`)

  /**
   * ---- 2. 모루 앞에 서면 재고가 보이는가 ----
   */
  const anvils = await page.evaluate(() => window.__game.anvils())
  const at = await page.evaluate(async ([a]) => {
    const G = window.__game
    G.teleportPlayer(a.x, a.z)
    await window.__t.runFor(0.4)
    return G.shopInfo()
  }, [anvils[0]])
  console.log(`  [모루 ${anvils.length}곳] 첫 모루의 재고`)
  for (const it of at.items) {
    console.log(
      `    ${it.tierName.padEnd(4)} ${it.weaponName.padEnd(4)} 불티 ${String(it.price).padStart(3)} — ` +
        (it.affixes.map((a) => `${a.name}+${a.value}`).join(' · ') || '옵션 없음'),
    )
  }
  check(at.atAnvil, '🏪 모루 앞에 서면 **상점이 열린다**')
  check(at.items.length > 0, '🏪 재고가 비어 있지 않다 (검사의 게이트)', `${at.items.length}개`)
  check(
    at.items.length > 0 &&
      new Set(at.items.map((i) => i.weaponIndex)).size === at.items.length,
    '🏪 **무기 종류마다 하나씩** 내놓는다 (안 쓰는 무기 것만 셋이 나오지 않게)',
    at.items.map((i) => i.weaponName).join(' · '),
  )

  /**
   * ---- 3. 값이 **강화 곡선 그대로**인가 ----
   *
   * 이 상점의 설계 문장이 *"같은 불티면 「강화 한 단계」와 「등급 한 칸」이
   * 맞바꿔진다"* 입니다. 값을 따로 지어냈으면 그 문장이 거짓이 됩니다.
   * 강화 비용도 **게임에서 읽습니다**.
   */
  const costs = await page.evaluate(() => window.__game.upgradeCosts())
  const priced = at.items.filter((i) => i.tier > 0)
  check(
    priced.length > 0,
    '💰 값이 붙은 물건이 있다 (검사의 게이트 — 전부 일반이면 값을 못 잽니다)',
    `${priced.length}/${at.items.length}개`,
  )
  check(
    priced.length > 0 && priced.every((i) => i.price === costs[Math.min(costs.length - 1, i.tier - 1)]),
    '💰 값이 **강화 곡선 그대로**다 (새 숫자를 안 만들었다)',
    priced.map((i) => `${i.tierName} ${i.price}=${costs[i.tier - 1]}`).join(' · '),
  )

  /**
   * ---- 4. 사면 **실제로 바뀌는가** ----
   *
   * 창의 버튼과 **같은 함수**를 부릅니다(`buyShopItem` → `buyGear`).
   * 프로브 전용 구매 경로를 만들면 창에만 있는 조건을 안 지나갑니다.
   */
  const buy = await page.evaluate(async () => {
    const G = window.__game
    const info = G.shopInfo()
    // 살 만한 것 하나 — 등급이 지금 것보다 높은 첫 물건.
    const idx = info.items.findIndex((i) => i.tier > i.haveTier)
    if (idx < 0) return { skipped: true }
    const item = info.items[idx]
    G.setEmbers(item.price + 25) // 🧪 실험대 — 살 수 있는 지갑을 만들어 둡니다
    await window.__t.runFor(0.2)
    const before = {
      embers: G.emberInfo().embers,
      tier: G.gearInfo().weapons[item.weaponIndex].tier,
    }
    const ok = G.buyShopItem(idx)
    await window.__t.runFor(0.2)
    const after = {
      embers: G.emberInfo().embers,
      tier: G.gearInfo().weapons[item.weaponIndex].tier,
      sold: G.shopInfo().items[idx].sold,
    }
    // 두 번째 시도 — 이미 산 물건은 막혀야 합니다.
    const twice = G.buyShopItem(idx)
    return { skipped: false, item, ok, before, after, twice, afterTwice: G.emberInfo().embers }
  })
  if (buy.skipped) {
    check(false, '🛒 살 만한 물건을 찾았다 (검사의 게이트)', '전부 지금 든 것보다 낮았습니다')
  } else {
    console.log(
      `\n  [구매] ${buy.item.tierName} ${buy.item.weaponName} — 불티 ${buy.before.embers} → ${buy.after.embers}` +
        ` · 등급 ${buy.before.tier} → ${buy.after.tier}\n`,
    )
    check(buy.ok, '🛒 **샀다** (창의 버튼과 같은 함수로)')
    check(
      buy.before.embers - buy.after.embers === buy.item.price,
      '💸 불티가 **값만큼 정확히** 줄었다',
      `${buy.before.embers} → ${buy.after.embers} (값 ${buy.item.price})`,
    )
    check(
      buy.after.tier === buy.item.tier && buy.after.tier > buy.before.tier,
      '🏆 그 무기의 **등급이 실제로 올랐다**',
      `${buy.before.tier} → ${buy.after.tier}`,
    )
    check(buy.after.sold, '🏪 산 물건은 **팔린 것으로 표시된다**')
    check(
      !buy.twice && buy.afterTwice === buy.after.embers,
      '🚫 **두 번은 못 산다** (재입고가 없다는 약속을 지킵니다)',
      `두 번째 시도 ${buy.twice ? '성공(문제)' : '막힘'} · 불티 ${buy.afterTwice}`,
    )
  }

  /**
   * ---- 5. **재입고가 없는가** ----
   *
   * 이 상점의 핵심 약속입니다. 재입고가 있으면 *"좋은 게 나올 때까지
   * 쉬기"* 가 최적 전략이 되고, 그건 탐험이 아니라 새로고침입니다.
   * 멀리 갔다 돌아와서 **같은 재고인지** 봅니다.
   */
  const restock = await page.evaluate(async ([a]) => {
    const G = window.__game
    const sig = (info) => info.items.map((i) => `${i.weaponIndex}:${i.tier}:${i.price}`).join('|')
    const first = sig(G.shopInfo())
    G.teleportPlayer(-59, 1)
    await window.__t.runFor(0.6)
    G.teleportPlayer(a.x, a.z)
    await window.__t.runFor(0.4)
    return { first, second: sig(G.shopInfo()) }
  }, [anvils[0]])
  check(
    restock.first === restock.second && restock.first.length > 0,
    '🔁 **떠났다 돌아와도 같은 재고다** (재입고가 없다 — 새로고침이 최적해가 되지 않게)',
    restock.first === restock.second ? '같음' : `${restock.first} vs ${restock.second}`,
  )

  /**
   * ---- 6. 모루마다 **다른 물건**인가 ----
   *
   * 같으면 두 번째 모루를 찾아갈 이유가 없습니다.
   */
  if (anvils.length > 1) {
    const two = await page.evaluate(async ([a, b]) => {
      const G = window.__game
      const sig = (info) => info.items.map((i) => `${i.weaponIndex}:${i.tier}`).join('|')
      G.teleportPlayer(a.x, a.z)
      await window.__t.runFor(0.4)
      const one = sig(G.shopInfo())
      G.teleportPlayer(b.x, b.z)
      await window.__t.runFor(0.4)
      return { one, two: sig(G.shopInfo()) }
    }, [anvils[0], anvils[1]])
    check(
      two.one !== two.two,
      '🏪 **모루마다 재고가 다르다** (두 번째 모루를 찾아갈 이유가 있다)',
      `${two.one} vs ${two.two}`,
    )
  }

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 (notice-probe.mjs 의 같은 주석 참고).
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
