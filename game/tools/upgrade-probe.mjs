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
  await harness() // 새로고침하면 window.__t 가 사라집니다.
  const reloaded = await page.evaluate(() => window.__game.weaponUpgradeInfo().levels)
  check(
    reloaded[0] === saved[0] && saved[0] === 2,
    '게임을 다시 켜도 강화가 남는다 (안 남으면 불티를 쓰는 것 자체가 손해)',
    `[${saved.join(', ')}] → [${reloaded.join(', ')}]`,
  )

  /**
   * ---- 5. 정련석 — **비용이 아니라 획득의 한계가 희소성을 만듭니다** ----
   *
   * 처음엔 "한 판 벌이(364)로는 총비용(1750)을 못 낸다"를 근거로 삼았습니다.
   * 그 검사는 통과했지만 **결론이 틀렸습니다.** 봇이 화톳불을 제대로 쓰게
   * 고치자 같은 판에서 처치가 21 → 59로 늘었습니다 — 쉬면 적이 되살아나므로
   * 파밍은 무제한입니다. 실측으로 초당 3.53 불티, 만렙까지 **210초만 더**
   * 파밍하면 됐습니다.
   *
   * 그래서 재는 것을 바꿉니다: 불티가 아니라 **정련석의 총량**이 존을
   * 다 털어도 만렙에 못 미치는가.
   */
  const stoneMath = await page.evaluate(() => {
    const G = window.__game
    let sum = 0
    const w = G.weaponUpgradeInfo().weapon
    for (let lv = 0; lv < G.weaponUpgradeInfo().maxLevel; lv++) {
      G.setWeaponLevel(w, lv)
      sum += G.weaponUpgradeInfo().nextStoneCost
    }
    G.setWeaponLevel(w, 0)
    return sum
  })
  /**
   * ── ⚠️ **이 몇 줄이 두 가지를 동시에 틀리고 있었습니다** ──────────
   *
   * 원래 이렇게 세고 있었습니다:
   *
   *     const treasures = level.entities.filter((e) => e.kind === 'treasure').length
   *     const perTreasure = 1   // ← 베껴 적은 값
   *     const perBoss = 2       // ← 베껴 적은 값
   *
   * ① **베껴 적었습니다.** `stonePerTreasure` 를 바꾸는 날 이 검사는
   *    아무 말 없이 옛날 값으로 통과합니다 — 이 저장소가 가장 싫어하는
   *    「규칙이 두 곳에」입니다.
   * ② **항아리 속 상자를 안 셌습니다.** `urnFull` 은 깨면 상자가 그대로
   *    나오고 정련석도 그대로 줍니다(world.ts). 지금 이 존에 3개 있으니
   *    실제 공급은 10이 아니라 **13**입니다. *"숨겼다"* 는 **찾기 어렵다**
   *    는 뜻이지 **없다**는 뜻이 아닙니다.
   *
   * 둘 다 검사를 **헐겁게** 만드는 방향이었습니다(공급을 적게 셈).
   *
   * ── 그리고 이 줄은 **이미 빨간불이었습니다** ─────────────────────
   * 헐겁게 세고도 10 ≥ 9 라 조건이 깨져 있었습니다. 고치기 전에 한 번
   * 돌려 본 기록:
   *
   *     ❌ 존을 다 털어도 … 못 올린다 — 존 전체 정련석 10개 vs 만렙 9개
   *
   * 즉 계측기는 **제대로 말하고 있었는데 아무도 안 들었습니다.** 이 저장소의
   * 프로브 80여 개 중 실제로 도는 것은 몇 개뿐이라는 오래된 문제가, 처음으로
   * **실제 밸런스 구멍**으로 나타난 자리입니다. 「못 잰 것은 통과가 아니다」
   * 옆에 한 줄 더 붙습니다 — **안 읽은 빨강도 통과가 아닙니다.**
   *
   * (그래서 `npm run economy` 는 이 계산을 자기 몫으로 다시 합니다.
   *  같은 것을 두 곳에서 재는 게 아니라, 저쪽은 공급·가격·소비처를
   *  통째로 보는 자리이고 여기는 강화 시스템의 한 줄입니다.)
   */
  const eco = await page.evaluate(() => window.__game.economy())
  const chests = eco.zone.chests + eco.zone.urnChests
  const zoneTotal = chests * eco.stone.perTreasure + eco.stone.perBoss
  check(
    zoneTotal < stoneMath,
    '존을 다 털어도 무기 하나를 만렙까지 못 올린다 (다음 존이 줄 것이 남아야)',
    `존 전체 정련석 ${zoneTotal}개 (상자 ${chests} = 놓인 것 ${eco.zone.chests} + 항아리 속 ${eco.zone.urnChests}, 보스 +${eco.stone.perBoss}) vs 만렙 ${stoneMath}개`,
  )

  /**
   * ---- 6. **잡몹**을 아무리 잡아도 정련석은 안 나온다 ----
   *
   * 이게 이 자원의 존재 이유입니다. 잡몹은 쉬면 되살아나므로 무제한입니다 —
   * 거기서 나오면 정련석도 결국 시간으로 살 수 있는 것이 됩니다.
   *
   * 처음엔 "적을 잡아도 안 나온다"로 적었다가 프로브가 2개를 잡아냈습니다.
   * 보스가 섞여 있었기 때문입니다 — 그건 **설계대로**입니다(보스는 부활하지
   * 않으므로 존당 1회뿐). 기능이 아니라 **제 주장이 부정확**했던 경우입니다.
   */
  const byFarming = await page.evaluate(async () => {
    const G = window.__game
    G.setStones(0)
    const before = G.weaponUpgradeInfo().stones
    const p = G.state().player
    let killed = 0
    for (let round = 0; round < 3; round++) {
      const spawned = []
      for (let i = 0; i < 4; i++) spawned.push(G.spawnEnemyKind('grunt', p.x + 6 + i, p.z + 4))
      await window.__t.runFor(0.3)
      for (const e of spawned) G.damageEntity(e, 99999)
      await window.__t.runFor(0.4)
      killed += spawned.length
    }
    return { before, after: G.weaponUpgradeInfo().stones, killed }
  })
  check(
    byFarming.after === byFarming.before,
    '잡몹을 아무리 잡아도 정련석은 나오지 않는다 (시간으로 살 수 없는 자원)',
    `${byFarming.killed}마리 처치 · 정련석 ${byFarming.before} → ${byFarming.after}`,
  )

  // ---- 7. 보스는 정확히 정해진 만큼만, 그리고 한 번만 줍니다 ----
  const byBoss = await page.evaluate(async () => {
    const G = window.__game
    G.setStones(0)
    const b = G.bossEncounter()
    if (!b) return null
    G.damageEntity(b.entity, 99999)
    await window.__t.runFor(0.6)
    return G.weaponUpgradeInfo().stones
  })
  check(
    byBoss === 2,
    '보스 처치는 정련석을 정해진 만큼 준다',
    `정련석 ${byBoss}개`,
  )

  /**
   * ---- 8. 보스는 쉬어도 부활하지 않는다 ----
   *
   * 이 검사가 없어서 **조용히 깨져 있었습니다.** 격파 기록을 "죽은 자리"
   * 좌표로 저장했는데 보스는 플레이어를 쫓아 움직이므로, 자기 자리에서
   * 죽지 않으면 키가 배치 좌표와 안 맞아 화톳불에서 쉴 때마다 되살아났습니다.
   * 화면에는 "적이 부활했다"로만 보여서 눈으로는 못 잡습니다 —
   * 정련석 누적량이 존 상한 7개를 넘어 **9개**가 나오고서야 드러났습니다.
   */
  const bossRevive = await page.evaluate(async () => {
    const G = window.__game
    const before = G.bossEncounter()
    G.forceRespawnEnemies()
    await window.__t.runFor(0.6)
    return { before: before !== null, after: G.bossEncounter() !== null }
  })
  check(
    bossRevive.before === false && bossRevive.after === false,
    '한 번 잡은 보스는 쉬어도 부활하지 않는다 (진행의 표지가 유지됨)',
    `쉬기 전 ${bossRevive.before ? '살아있음' : '없음'} → 쉰 뒤 ${bossRevive.after ? '부활함' : '없음'}`,
  )

  /**
   * ---- 9. 되살아난 적은 불티를 덜 준다 ----
   *
   * 자동 플레이가 존을 사망 0회로 끝내는 이유를 재보니 이랬습니다:
   *
   *     총 받은 피해 205 (최대 체력의 2배) · 최저 체력 26.8 · **휴식 4회**
   *
   * 맞긴 맞는데 **회복이 피해보다 훨씬 넉넉**했습니다. 휴식 4회 = 완전 회복
   * 4번이고 그게 공짜였습니다. 소울라이크에서 쉬는 대가는 "적이 되살아난다"인데,
   * 우리는 적을 잡으면 불티가 나오므로 그게 **벌이 아니라 보상**이었습니다.
   *
   * 여기서 재는 것: 쉴수록 수확이 실제로 줄어드는가, 그리고 **바닥이 있는가**
   * (0으로 떨어지면 되살아난 적이 완전한 낭비가 되어 지나치는 게 정답이 됩니다).
   */
  const decay = await page.evaluate(async () => {
    const G = window.__game
    const out = []
    for (let i = 0; i < 5; i++) {
      out.push({
        gen: G.runStats().restGeneration,
        decay: G.runStats().emberDecay,
      })
      G.forceRespawnEnemies()
      await window.__t.runFor(0.3)
    }
    return out
  })
  // 앞선 검사들이 이미 쉬었으므로 **세대가 0에서 시작한다고 가정하면 안 됩니다.**
  // (처음에 그렇게 적어서 멀쩡한 기능이 실패로 나왔습니다.)
  // 재야 할 것은 절대값이 아니라 **단조 감소**입니다.
  check(
    decay[1].decay < decay[0].decay,
    '쉴수록 되살아난 적의 불티가 줄어든다',
    decay.map((d) => `${d.gen}회:${Math.round(d.decay * 100)}%`).join(' → '),
  )
  const last = decay[decay.length - 1].decay
  check(last > 0, '아무리 쉬어도 바닥이 있다 (되살아난 적이 완전한 낭비가 되지 않게)', `${Math.round(last * 100)}%`)

  // ---- 10. 죽어서 되살아난 것은 세대를 올리지 않는다 ----
  //
  // 죽을수록 벌이가 줄면 못하는 사람이 영영 못 따라옵니다.
  // 대가는 **스스로 고른 휴식**에만 붙습니다.
  const byDeath = await page.evaluate(async () => {
    const G = window.__game
    const before = G.runStats().restGeneration
    G.setHp(G.playerEntity(), 1)
    G.damageEntity(G.playerEntity(), 9999)
    await window.__t.runFor(1.2)
    return { before, after: G.runStats().restGeneration }
  })
  check(
    byDeath.after === byDeath.before,
    '죽어서 적이 되살아나도 불티 체감은 커지지 않는다 (못하는 사람을 더 때리지 않게)',
    `세대 ${byDeath.before} → ${byDeath.after}`,
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
