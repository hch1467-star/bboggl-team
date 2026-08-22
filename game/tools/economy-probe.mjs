/**
 * 💰 **불티 경제 검사** — `npm run economy`
 *
 * ── 왜 만들었는가 ──────────────────────────────────────────────────
 * `npm run play` 가 존을 끝낼 때마다 이런 줄이 찍혔습니다:
 *
 *     불티 448 · 정련석 6 · 무기 강화 **1회**
 *
 * 여기서 세 가지가 서로 다른 이야기인데 **한 줄로 보입니다**:
 *   ① 벌이가 쓸 곳보다 많은가 (설계의 문제)
 *   ② 쓸 곳까지 못 갔는가     (봇의 이동 예산 45m — **계측기의 정책**)
 *   ③ 재료가 없었는가         (정련석)
 * 이 저장소가 이번 세션에 가장 여러 번 데인 모양 그대로입니다 —
 * **처방이 다른 셋이 한 칸에 담기면 정확히 거꾸로 읽힙니다.**
 *
 * 봇은 ②를 재는 데는 좋지만 ①은 **못 잽니다.** ①은 "잘하는 사람이
 * 다 털었을 때"의 질문이고, 봇의 한 판은 그게 아닙니다. 그래서 이
 * 파일은 봇을 안 돌립니다 — **가격표와 지도만** 놓고 산수를 합니다.
 *
 * ── ⚠️ 숫자를 **베껴 적지 않습니다** ──────────────────────────────
 * 가격표(`WEAPON_UPGRADE`·`EMBER`)도 지도의 적·상자 수도 전부 게임이
 * `window.__game.economy()` 로 내보내는 것을 읽습니다. 베껴 적으면
 * 밸런스를 손보는 날 이 검사가 **조용히 거짓**이 됩니다 —
 * `npm run route` 가 스스로를 "검사가 아니라 스케치"라고 못 박은 것과
 * 같은 이유이고, 여기서는 베끼지 않으므로 **검사로 씁니다.**
 *
 * ── 처음 돌렸을 때 나온 것 (기록) ─────────────────────────────────
 *     한 바퀴 불티 608 (적 31마리) · 정련석 공급 **13** (상자 11 + 보스 2)
 *     만렙 필요 : 불티 1750 · 정련석 **9**
 *
 * 즉 **정련석이 남습니다.** 그런데 `balance.ts` 는 정련석을 이렇게
 * 설명하고 있었습니다 — *"불티는 흔한 것(싸우면 나옴), 정련석은 귀한
 * 것(보물과 보스에서만). 이 존에는 보물 5개 + 보스 1이 있어 최대 7개
 * 이므로 한 존을 다 털어도 +4까지"*.
 *
 * 그 사이에 지도가 자랐습니다. 상자는 5개가 아니라 **11개**입니다
 * (놓인 것 8 + 항아리 속 3). 설명은 그대로였고 숫자만 움직였습니다.
 *
 * 이게 왜 큰 문제인가 — **불티는 무한합니다.** 쉬면 적이 되살아나고,
 * 되살아난 적도 (줄어들지언정) 불티를 줍니다. 그래서 *"파밍으로는
 * 만렙이 안 된다"* 를 지키는 문턱은 **정련석 하나뿐**이었습니다.
 * 공급이 필요량을 넘은 순간 그 약속은 통째로 거짓이 됩니다:
 * 같은 자리를 오래 돌면 +5 가 나옵니다.
 *
 * 이 파일의 검사 ③ 이 그것이고, 만들자마자 **빨간불**이었습니다.
 * (고친 자리는 `balance.ts` 의 `stoneCosts` 주석에 적어 뒀습니다.)
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5217
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** 누적 합 — `[80,170,300]` → `[80,250,550]`. 단계 비용이 아니라 **거기까지**의 값. */
const cumulative = (arr) => arr.map((_, i) => arr.slice(0, i + 1).reduce((a, b) => a + b, 0))
/** 이만큼 가지고 갈 수 있는 최대 단계(0 = 한 단계도 못 감). */
const levelAffordable = (cum, budget) => cum.filter((c) => c <= budget).length

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

  const eco = await page.evaluate(() => window.__game.economy())

  const emberCum = cumulative(eco.weapon.costs)
  const stoneCum = cumulative(eco.weapon.stoneCosts)
  const maxEmber = emberCum[emberCum.length - 1]
  const maxStone = stoneCum[stoneCum.length - 1]

  // 한 바퀴 = **원본 배치를 한 번씩** 잡았을 때. 되살아난 적은 안 셉니다.
  const chests = eco.zone.chests + eco.zone.urnChests
  const income = eco.zone.foes.reduce((n, f) => n + f.count * f.ember, 0)
  const foeCount = eco.zone.foes.reduce((n, f) => n + f.count, 0)
  const stoneSupply = chests * eco.stone.perTreasure + eco.stone.perBoss
  const vialTotal = eco.vial.costs.reduce((a, b) => a + b, 0)

  console.log(`\n💰 불티 경제 — 「${eco.zone.name}」\n`)
  console.log(`  [공급] 적 ${foeCount}마리 → 불티 ${income}`)
  for (const f of eco.zone.foes) {
    console.log(`         · ${f.id.padEnd(8)} ${String(f.count).padStart(2)}마리 × ${f.ember} = ${f.count * f.ember}`)
  }
  console.log(
    `         상자 ${chests}개(놓인 것 ${eco.zone.chests} + 항아리 속 ${eco.zone.urnChests}) + 보스 → 정련석 ${stoneSupply}`,
  )
  console.log(`         모루 ${eco.zone.anvils}곳 · 화톳불 ${eco.zone.bonfires}곳`)
  console.log(`  [가격] 무기 만렙 +${eco.weapon.maxLevel} — 불티 ${maxEmber} · 정련석 ${maxStone}`)
  console.log(`         누적 불티   ${emberCum.join(' · ')}`)
  console.log(`         누적 정련석 ${stoneCum.join(' · ')}`)
  console.log(`         성수병 ${eco.vial.start}→${eco.vial.max}개 — 불티 ${vialTotal} (${eco.vial.costs.join(' · ')})\n`)

  // ---- ① 첫 강화는 존을 다 돌기 전에 산다 ----
  /**
   * 첫 강화가 존 끝에서야 살 수 있으면, 성장은 **이 존의 이야기가
   * 아니라 다음 존의 이야기**가 됩니다. 그러면 이 존을 도는 동안
   * 불티는 그냥 늘어나는 숫자이고, "죽으면 잃는다"도 안 아픕니다.
   *
   * 문턱을 4분의 1로 잡은 근거: 이 존의 주 동선이 194m 이므로(`npm run
   * route`) 대략 **첫 50m 안**입니다. 첫 모루까지의 거리와 같은 자리에
   * 있어야 첫 강화가 "가는 길에 하는 일"이 됩니다.
   */
  const firstCost = eco.weapon.costs[0]
  check(
    firstCost <= income * 0.25,
    '첫 강화는 존의 4분의 1을 돌기 전에 산다',
    `${firstCost} ≤ ${Math.round(income * 0.25)} (한 바퀴 ${income}의 25%)`,
  )

  // ---- ② 성수병 첫 강화가 무기 첫 강화보다 싸다 ----
  /**
   * `balance.ts` 가 명시한 약속입니다 — *"처음 손에 쥔 불티는 생존에
   * 쓰는 것이 기본값이어야 한다. 초보자가 죽어서 배우는 게임이니까."*
   * 글로만 적힌 약속은 표를 손보는 날 조용히 뒤집힙니다.
   */
  check(
    eco.vial.costs[0] < firstCost,
    '첫 불티의 기본값은 **생존** — 성수병이 무기보다 싸다',
    `성수병 ${eco.vial.costs[0]} < 무기 ${firstCost}`,
  )

  // ---- ③ 한 존의 정련석으로는 만렙이 안 된다 ----
  /**
   * ⚠️ **이 검사가 이 파일의 이유입니다.**
   *
   * 불티는 무한합니다 — 화톳불에서 쉬면 적이 되살아나고, 되살아난 적도
   * 불티를 줍니다(줄어들 뿐, `respawnFloor` 아래로는 안 내려갑니다).
   * 그러니 *"파밍으로는 만렙이 안 된다"* 를 지키는 문턱은 **정련석 하나
   * 뿐**입니다. 공급이 필요량 이상이 되는 순간, 같은 자리를 오래 도는
   * 것만으로 만렙이 나옵니다.
   *
   * 지도가 자라면 공급이 자동으로 늡니다(상자 하나 = 정련석 하나).
   * 그래서 이건 **한 번 맞춰 놓고 잊을 수 있는 값이 아닙니다** —
   * 상자를 더 놓는 날 여기가 빨개져야 합니다.
   */
  check(
    stoneSupply < maxStone,
    '한 존을 다 털어도 만렙은 안 된다 (파밍 방지 문턱)',
    `공급 ${stoneSupply} < 필요 ${maxStone} · 여유 ${maxStone - stoneSupply}`,
  )

  // ---- ④ 그래도 이 존에서 오르긴 오른다 ----
  /**
   * ③ 을 고치려고 정련석 값을 올리다 보면 **아무도 못 넘는 문턱**이
   * 되기 쉽습니다. 이 저장소의 오래된 규칙 — *"아무도 못 넘는 문턱은
   * 눈금이 아니라 벽이다."* ③ 과 ④ 는 반대 방향이라 **둘이 같이 있어야**
   * 값이 사이에 놓입니다.
   */
  const stoneLevel = levelAffordable(stoneCum, stoneSupply)
  check(
    stoneLevel >= 2,
    '이 존의 정련석만으로도 두 단계 이상은 오른다',
    `+${stoneLevel} 까지 (정련석 ${stoneSupply}개)`,
  )

  // ---- ⑤ 한 바퀴로는 만렙 불티가 안 모인다 ----
  /**
   * 한 존이 성장을 다 끝내 버리면 다음 존이 줄 것이 없습니다.
   * ③ 과 다른 축을 재는 검사입니다 — ③ 은 **파밍해도** 안 되는 것,
   * 이건 **한 바퀴로는** 안 되는 것.
   */
  check(
    income < maxEmber,
    '한 바퀴 벌이로는 만렙 불티가 안 모인다',
    `${income} < ${maxEmber} (한 바퀴는 만렙의 ${Math.round((income / maxEmber) * 100)}%)`,
  )

  // ---- ⑥ 불티가 남아돌지 않는다 ----
  /**
   * *"잃어도 아깝지 않은 것을 잃는 것은 대가가 아닙니다."* — 죽으면
   * 불티를 잃는다는 규칙이 아프려면, 불티가 **모자라야** 합니다.
   *
   * 쓸 곳은 이 존 **안에서 실제로 닿는 것**만 셉니다: 정련석이 허락하는
   * 단계까지의 무기 강화 + 성수병 강화 전부. 만렙 비용을 다 세면
   * "정련석이 없어서 못 쓰는 불티"까지 쓸 곳으로 쳐서 검사가 헐거워집니다.
   */
  const spendable = (stoneLevel > 0 ? emberCum[stoneLevel - 1] : 0) + vialTotal
  check(
    income < spendable,
    '한 바퀴 벌이가 이 존의 쓸 곳을 못 넘는다',
    `벌이 ${income} < 쓸 곳 ${spendable} (무기 +${stoneLevel} ${stoneLevel > 0 ? emberCum[stoneLevel - 1] : 0} + 성수병 ${vialTotal})`,
  )

  // ---- ⑦ 쓸 곳이 지도 위에 실제로 있다 ----
  /**
   * 값이 아무리 맞아도 모루가 없으면 불티는 쓸 수 없는 숫자입니다.
   * 화톳불도 같이 봅니다 — 성수병 강화가 거기서 일어납니다.
   */
  check(eco.zone.anvils >= 1, '무기를 강화할 모루가 지도에 있다', `${eco.zone.anvils}곳`)
  check(eco.zone.bonfires >= 1, '성수병을 강화할 화톳불이 지도에 있다', `${eco.zone.bonfires}곳`)

  /**
   * ---- 🧭 **돈이 모이는 것과 쓸 수 있는 것은 다른 말입니다** ----
   *
   * 위 검사 ① 은 *"첫 강화는 존의 4분의 1을 돌기 전에 산다"* 고 말하지만,
   * 그건 **지갑 얘기일 뿐**입니다. 불티가 80 모여도 모루가 존 끝에만
   * 있으면 첫 강화는 *"가는 길에 하는 일"* 이 아니라 **끝나고 정산하는
   * 일**이 됩니다. 그 상태라면 「처음 손에 쥔 불티를 무엇에 쓸까」라는
   * 선택 자체가 존 안에 없습니다.
   *
   * ⚠️ 제가 ① 을 써 놓고 이 구멍을 못 봤습니다. **재기 전의 설명은
   *    결론이 아닙니다** — 그래서 거리를 직접 잽니다.
   *
   * 거리는 **게임의 길찾기**에게 묻습니다(`walkToPlayer`). 격자 BFS 를
   * 여기서 다시 짜면 `npm run route` 와 같은 처지가 됩니다 —
   * 규칙을 베낀 자는 검사로 쓸 수 없습니다.
   */
  const reach = await page.evaluate((spots) => {
    const G = window.__game
    const p = G.state().player
    return {
      from: { x: Number(p.x.toFixed(1)), z: Number(p.z.toFixed(1)) },
      walk: spots.map((s) => {
        const d = G.walkToPlayer(s.x, s.z)
        return { ...s, walk: d === null ? null : Number(d.toFixed(1)) }
      }),
    }
  }, [
    ...eco.zone.anvilAt.map((a) => ({ ...a, label: '모루' })),
    ...eco.zone.bonfireAt.map((b) => ({ ...b, label: '화톳불' })),
    ...(eco.zone.bossAt ? [{ ...eco.zone.bossAt, label: '보스' }] : []),
  ])
  const walkOf = (label) =>
    reach.walk.filter((w) => w.label === label && w.walk !== null).map((w) => w.walk)
  const zoneLength = walkOf('보스')[0] ?? null
  const anvilWalks = walkOf('모루').sort((a, b) => a - b)
  const fireWalks = walkOf('화톳불').sort((a, b) => a - b)
  const pct = (d) => (zoneLength ? `${Math.round((d / zoneLength) * 100)}%` : '?')

  console.log(`  🧭 시작 지점(${reach.from.x}, ${reach.from.z})에서 **걸어서**:`)
  console.log(`     존 길이(→보스) ${zoneLength}m`)
  console.log(`     모루   ${anvilWalks.map((d) => `${d}m(${pct(d)})`).join(' · ')}`)
  console.log(`     화톳불 ${fireWalks.map((d) => `${d}m(${pct(d)})`).join(' · ')}`)

  /**
   * ---- ⑧ **강화할 수 있는 첫 자리가 존의 절반 안에 있다** ----
   *
   * ── ⚠️ **여기서 제가 한 번 틀렸습니다 (기록)** ────────────────────
   * 처음엔 이렇게 적었습니다 — *"첫 **모루**가 존의 절반 안에 있다"*.
   * 재 보니 모루는 114m(69%)·138m(83%) 로 둘 다 존의 뒤쪽 3분의 1에만
   * 있었고, 저는 *"앞의 69% 동안은 성수병밖에 못 산다 → 「생존이냐
   * 화력이냐」라는 선택이 지도 때문에 사라졌다"* 는 결론까지 갔습니다.
   * 모루를 앞으로 옮기자는 처방을 쓰기 직전이었습니다.
   *
   * **그 결론이 틀렸습니다.** main.ts 는 이렇게 되어 있습니다:
   *
   *     this.canSpendHere = atFire || nearAnvil
   *
   * 무기 강화는 **화톳불에서도 됩니다.** 그리고 이 존의 첫 화톳불은
   * 시작 지점에서 **4m(2%)** 입니다. 엘든 링의 축복이 하는 일을 이 게임은
   * 이미 하고 있었습니다. 고칠 것은 게임이 아니라 **제 검사**였습니다.
   *
   * ── 그래서 자리를 **게임에게 물어봅니다** ─────────────────────────
   * 「모루 또는 화톳불」이라고 여기에 적으면 그게 바로 베껴 적는 것이고,
   * 언젠가 규칙이 바뀌면 이 검사는 조용히 거짓이 됩니다 — 방금 제가
   * 당한 것이 정확히 그 모양입니다(코드를 안 읽고 지도만 보고 판단).
   * 그래서 후보 자리마다 **가서 서 보고** `atStation` 을 읽습니다.
   *
   * ⚠️ `blockedBy === 'foe'` 도 **자리로 칩니다.** 그건 *"소비처에 닿았는데
   *    적이 14m 안에 있다"* 는 뜻이라 자리는 맞습니다(main.ts `spendBlock`).
   *    적을 치우는 것은 플레이어의 일이지 지도의 문제가 아닙니다.
   */
  const stations = await page.evaluate(async (spots) => {
    const G = window.__game
    const home = G.state().player
    const out = []
    for (const s of spots) {
      G.teleportPlayer(s.x, s.z)
      // 한 프레임으로는 소비처 판정이 안 돕니다 — 갱신을 기다립니다.
      const t = G.state().elapsed + 0.25
      const dl = Date.now() + 20000
      while (G.state().elapsed < t && Date.now() < dl) await new Promise((r) => setTimeout(r, 8))
      const wu = G.weaponUpgradeInfo()
      out.push({ ...s, station: wu.atStation || wu.blockedBy === 'foe', why: wu.blockedBy })
    }
    G.teleportPlayer(home.x, home.z)
    return out
  }, reach.walk.filter((w) => w.label !== '보스' && w.walk !== null))

  const spendWalks = stations
    .filter((s) => s.station)
    .map((s) => s.walk)
    .sort((a, b) => a - b)
  console.log(
    `     강화되는 자리(게임에게 물음): ${stations.map((s) => `${s.label} ${s.walk}m ${s.station ? '⚒️' : `✖(${s.why})`}`).join(' · ')}`,
  )

  /**
   * 왜 절반인가 — `balance.ts` 는 *"성수병 첫 강화(60)보다 무기 첫
   * 강화(80)가 비싸다. 처음 손에 쥔 불티는 생존에 쓰는 것이 기본값"* 이라는
   * **선택**을 설계해 뒀습니다. 그 선택이 성립하려면 둘 다 **같은 자리에서
   * 살 수 있어야** 합니다. 강화 자리가 존 끝에만 있으면 그건 고민이 아니라
   * 순서가 됩니다.
   *
   * 참고한 게임들이 전부 같은 자리에 있습니다 — 다크 소울의 안드레이는
   * 성벽 초반, 엘든 링의 축복은 어디에나. 강화는 **여정 중에 하는 일**이지
   * 정산이 아닙니다.
   */
  if (zoneLength !== null && spendWalks.length > 0) {
    check(
      spendWalks[0] <= zoneLength * 0.5,
      '강화할 수 있는 첫 자리가 존의 절반 안에 있다 (강화는 정산이 아니라 여정 중의 일)',
      `${spendWalks[0]}m / ${zoneLength}m = ${pct(spendWalks[0])}`,
    )
  } else {
    check(false, '강화할 수 있는 첫 자리가 존의 절반 안에 있다', '강화되는 자리를 하나도 못 찾았습니다')
  }

  /**
   * 👁 **모루까지의 거리에는 판정을 안 답니다.**
   *
   * 모루가 화톳불과 다른 점은 강화가 아니라 **상점**입니다(gear.ts `SHOP` —
   * 모루 둘 × 여섯 = 열둘, 재입고 없음). *"살 수 있는 물건을 존 앞쪽에서도
   * 보여줘야 하는가"* 는 이 저장소가 아직 안 정한 질문입니다. 지금 답을
   * 정해 문턱으로 세우면, 계측기가 게임의 결론을 대신 내는 것이 됩니다.
   */
  if (zoneLength !== null && anvilWalks.length > 0) {
    console.log(`     👁 상점(모루)은 ${pct(anvilWalks[0])} 지점부터 — 판정 없음(아직 안 정한 질문)`)
  }

  // ---- 👁 판정을 안 다는 표 ----
  /**
   * ⚠️ **여기에는 초록/빨강을 안 답니다.**
   *
   * *"어느 자원이 막는가"* 는 좋고 나쁨이 아니라 **성격**입니다. 불티가
   * 막으면 「더 싸워라」, 정련석이 막으면 「더 찾아라」이고, 이 게임은
   * 둘 다 원합니다. 문턱을 세우는 순간 이 파일이 **어느 쪽이 옳은지를
   * 정해 버리게** 되고, 그건 계측기가 할 일이 아닙니다 —
   * 이 세션에 이미 한 번 겪은 자리입니다(`npm run map` 의 구역 거리표).
   */
  const emberLevel = levelAffordable(emberCum, income)
  const gate = emberLevel < stoneLevel ? '불티(싸움)' : emberLevel > stoneLevel ? '정련석(탐험)' : '둘이 같은 자리'
  console.log(`\n  👁 한 바퀴로 닿는 단계 — 불티로 +${emberLevel} · 정련석으로 +${stoneLevel}`)
  console.log(`     실제로 막는 것: **${gate}** · 파밍하면(불티 무한) +${stoneLevel} 까지`)
  console.log(`     되살아난 적의 벌이: ×${eco.respawn.decay} 씩 줄고 ×${eco.respawn.floor} 아래로는 안 내려갑니다\n`)

  if (errors.length > 0) check(false, '콘솔 오류 없음', errors.slice(0, 2).join(' / '))
} catch (err) {
  // 프로브가 도중에 죽으면 **조용히 성공**하는 것이 가장 나쁩니다.
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
