/**
 * 사람을 계산에 넣습니다 — `npm run react`
 *
 * ── 왜 이 프로브가 필요해졌는가 ──────────────────────────────────
 * `npm run rules` 는 4색의 정답이 성립하는지를 이미 재고 있습니다. 그런데
 * 그 계산을 다시 읽어 보니 **사람이 들어 있지 않았습니다.** 🟡 검사는
 * 이렇게 되어 있습니다:
 *
 *   갈 수 있는 거리 = 걷는 속도 × **예고 길이 전체**
 *
 * 즉 *"예고가 뜬 첫 프레임에 이미 반대 방향으로 걷고 있던 플레이어"* 를
 * 가정합니다. 그런 사람은 없습니다. 색을 **보고**, 무슨 색인지 **알아보고**,
 * 어디로 갈지 **정하고** 나서야 손이 움직입니다.
 *
 * 이건 rules 가 틀렸다는 뜻이 아닙니다. rules 는 **게임이 스스로 모순되지
 * 않는가**를 봅니다(반경 vs 구르기 거리). 이 프로브는 다른 것을 봅니다 —
 * **사람이 실제로 답할 수 있는가.** 둘 다 통과해야 색이 색 노릇을 합니다.
 *
 * ── 예산도 색 가짓수도 게임이 들고 있습니다 ──────────────────────
 * 반응 시간은 balance.ts `REACTION` 이 계산하고 여기서는 **읽기만** 합니다.
 * 색 가짓수도 게임이 자기 패턴 표를 훑어 셉니다. 첫 판에 이 프로브에
 * "4색"이라고 적어 뒀다가 🟢 이 다섯째로 들어와 있던 것을 놓쳤습니다.
 *
 * ⚠️ **반응 시간은 우리 플레이어를 잰 값이 아닙니다.** 예산이지 측정치가
 *    아닙니다. 그래서 실패했을 때 답이 둘입니다 — *게임을 고친다* 혹은
 *    *예산이 틀렸다*. 프로브는 어느 쪽인지 정하지 않고, **얼마가 필요한지**
 *    까지만 정확히 찍습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5226
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

  const t = await page.evaluate(() => window.__game.terrainInfo())
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  const dodges = await page.evaluate(() => window.__game.dodgeScales())
  const weapons = await page.evaluate(() => window.__game.weaponTable())
  const budget = await page.evaluate(() => window.__game.reactionBudget())

  /**
   * ⚠️ **보스는 페이즈마다 예고가 짧아집니다**(bossPhases.ts `windupScale`).
   *    처음엔 그걸 모르고 기본값으로 쟀는데, 그러면 실제로 가장 어려운
   *    순간을 **안 재고 통과**시킵니다. rules 프로브는 이미 페이즈 값을
   *    쓰고 있었습니다 — 새 프로브만 옛날 방식으로 재고 있었던 셈입니다.
   *    여기서는 모든 페이즈 중 **가장 짧은 예고**를 그 패턴의 값으로 씁니다.
   */
  const phases = await page.evaluate(() => window.__game.bossTuning())
  const shortest = new Map()
  for (const ph of phases) {
    for (const w of ph.windups ?? []) {
      const cur = shortest.get(w.id)
      if (!cur || w.seconds < cur.seconds) shortest.set(w.id, { seconds: w.seconds, phase: ph.name })
    }
  }
  const attacks = roster.flatMap((r) =>
    r.attacks.map((a) => {
      const s = shortest.get(a.id)
      return {
        ...a,
        from: r.name,
        radius: r.radius,
        keepDistance: r.keepDistance,
        /** 실제로 가장 짧아지는 예고. 없으면(잡몹) 기본값 그대로. */
        windup: s && s.seconds < a.windup ? s.seconds : a.windup,
        worstPhase: s && s.seconds < a.windup ? s.phase : null,
      }
    }),
  )
  const showWindup = (a) => `${a.windup}초${a.worstPhase ? `(${a.worstPhase})` : ''}`
  // 색 이름은 **게임이 준 것만** 씁니다. 여기서 이모지를 적어 두면 색이
  // 늘었을 때 프로브만 옛날 표를 들고 있게 됩니다.
  const EMOJI = Object.fromEntries(budget.colors.map((c) => [c.intent, c.emoji]))
  const LABEL = Object.fromEntries(budget.colors.map((c) => [c.intent, c.label]))
  const of = (i) => attacks.filter((a) => a.intent === i)
  // 색의 뜻은 라벨에서 찾습니다 — 숫자를 프로브가 외우지 않게.
  const intentBy = (needle) => budget.colors.find((c) => c.label.includes(needle))?.intent

  const STRIKE = intentBy('구르기')
  const SWEEP = intentBy('걸어서')
  const PULL = intentBy('거리')
  const COUNTER = intentBy('때려')

  console.log('\n⏱  사람을 계산에 넣습니다 — 색을 알아보는 시간을 빼고도 답이 되는가\n')
  console.log(
    `  [예산] 선택 반응 ${budget.choice}초 (게임이 센 ${budget.colors.length}색 기준) · 단순 반응 ${budget.simple}초`,
  )
  console.log(`         ${budget.colors.map((c) => `${c.emoji} ${c.label}`).join(' · ')}\n`)

  check(
    [STRIKE, SWEEP, PULL, COUNTER].every((v) => v != null),
    '검사할 색을 전부 찾았다 (라벨이 바뀌어 조용히 안 재는 일이 없게)',
    [
      ['🔴', STRIKE],
      ['🟡', SWEEP],
      ['🟣', PULL],
      ['🟢', COUNTER],
    ]
      .map(([e, v]) => `${e}${v == null ? '없음' : v}`)
      .join(' · '),
  )

  /**
   * ---- 0. 먼저 **예고가 반응 시간보다 긴가** ----
   *
   * 가장 굵은 검사입니다. 예고가 반응 시간보다 짧으면 그 공격은 **읽고
   * 답하는 것이 원리적으로 불가능**합니다. 외워서 미리 누르는 것 말고는
   * 방법이 없고, 그건 이 게임이 팔겠다고 한 재미가 아닙니다.
   */
  const tooFast = attacks.filter((a) => a.windup <= budget.choice)
  check(
    tooFast.length === 0,
    '모든 예고가 **색을 알아볼 시간보다 길다** (읽는 것이 원리적으로 가능하다)',
    tooFast.length
      ? tooFast.map((a) => `${EMOJI[a.intent]} ${a.from} ${showWindup(a)}`).join(' · ')
      : `가장 짧은 예고 ${Math.min(...attacks.map((a) => a.windup))}초 > ${budget.choice}초`,
  )

  /**
   * ---- 1. 🔴 — 반응하고 굴러서 **무적이 제때 켜지는가** ----
   *
   * 🔴 의 정답은 구르기입니다. 그런데 구르기는 누른 **즉시** 무적이 아닙니다 —
   * `iFrameStart` 만큼 뒤에 켜집니다(balance.ts: *"시작 직후가 아니라 살짝
   * 뒤부터 — 이게 소울라이크식입니다"*). 그러니 실제로 필요한 것은:
   *
   *   반응 시간 + 무적이 켜지기까지 ≤ 예고 길이
   *
   * ⚠️ "구르기 거리"나 "구르기 시간"으로 재면 **틀립니다.** 🔴 은 피해서
   *    나가는 게 아니라 **통과시키는** 색입니다. 거리는 상관이 없습니다.
   *    (rules 프로브가 🟡 에서 이미 겪은 실수 — 잣대를 색마다 다시 골라야
   *    합니다.)
   */
  const slowStart = dodges.reduce((a, b) => (b.iFrameStart > a.iFrameStart ? b : a), dodges[0])
  const strikeNeed = budget.choice + slowStart.iFrameStart
  const strikes = of(STRIKE)
  const strikeBad = strikes.filter((a) => a.windup < strikeNeed)
  check(
    strikes.length > 0 && strikeBad.length === 0,
    '🔴 은 반응하고 굴러도 **무적이 제때 켜진다**',
    `예고가 ${strikeNeed.toFixed(2)}초 이상이어야 함 (반응 ${budget.choice} + 무적까지 ${slowStart.iFrameStart}, ${slowStart.name} 기준)` +
      ` · 가장 짧은 🔴 ${Math.min(...strikes.map((a) => a.windup))}초` +
      (strikeBad.length ? ` · ❗ ${strikeBad.map((a) => `${a.from} ${showWindup(a)}`).join(' · ')}` : ''),
  )

  /**
   * ---- 2. 🟡 — 반응하고 **남은 시간에 걸어 나올 수 있는가** ----
   *
   * rules 1b 와 **똑같은 식**을 쓰되, 걸을 수 있는 시간에서 반응 시간을
   * 뺍니다. 가야 하는 거리는 `반경 − 밀착 거리` 입니다 — `reach` 는 적
   * 중심에서 재는 값이고 플레이어는 중심이 아니라 몸 밖에 서 있습니다.
   * (이 계산은 rules 프로브가 이미 한 번 틀렸다가 고친 것입니다. 여기서
   * 다시 틀리지 않도록 같은 식을 그대로 씁니다.)
   */
  const sweeps = of(SWEEP).map((a) => {
    const need = a.reach - (t.playerRadius + a.radius)
    const free = Math.max(0, a.windup - budget.choice)
    return {
      from: a.from,
      id: a.id,
      need,
      have: t.playerMoveSpeed * free,
      /** 통과하려면 예고가 얼마여야 하는가 — 처방을 프로브가 직접 냅니다. */
      wantWindup: budget.choice + need / t.playerMoveSpeed,
      windup: a.windup,
    }
  })
  const sweepBad = sweeps.filter((s) => s.have <= s.need)
  check(
    sweeps.length > 0 && sweepBad.length === 0,
    '🟡 은 반응하고도 **걸어서 빠져나올 시간이 남는다**',
    sweeps
      .map(
        (s) =>
          `${s.from} ${s.need.toFixed(1)}m 가야 함 / 반응 빼고 ${s.have.toFixed(1)}m` +
          (s.have <= s.need ? ` ❗예고 ${s.windup}→${s.wantWindup.toFixed(2)}초 필요` : ''),
      )
      .join(' · '),
  )

  /**
   * ---- 3. 🟣 — 반응하고 **뒤로 빠질 시간이 남는가** ----
   *
   * 🟣 의 정답은 "끝까지 물러나기"입니다(rules 프로브). 여기서도 반응
   * 시간만큼 늦게 출발합니다. 구르기 한 번 + 남은 시간 걷기로 잽니다.
   *
   * ⚠️ **출발 거리를 한 번 틀렸고 기록으로 남깁니다.** 처음엔
   *    `roster.minRange` 를 읽었는데, `minRange` 는 적이 아니라 **패턴**에
   *    달린 값입니다. `undefined` 가 0이 되어 "보스는 5.2m 밖에 못 간다"는
   *    엉터리 실패가 나왔습니다 — 있지도 않은 문제를 만들어 낼 뻔했습니다.
   *    거리를 두는 적은 `keepDistance`, 아니면 그 패턴의 `minRange` 입니다.
   */
  const slowDodge = dodges.reduce((a, b) => (b.duration > a.duration ? b : a), dodges[0])
  const pulls = of(PULL).map((a) => {
    const start = a.keepDistance ?? a.minRange ?? 0
    const free = Math.max(0, a.windup - budget.choice)
    const walk = Math.max(0, free - slowDodge.duration)
    return {
      from: a.from,
      need: a.reach,
      have: start + t.dodgeDistance + t.playerMoveSpeed * walk,
      start,
      canDodge: free >= slowDodge.duration,
    }
  })
  const pullBad = pulls.filter((p) => p.have <= p.need)
  check(
    pulls.length > 0 && pullBad.length === 0,
    '🟣 은 반응하고도 **사거리 밖으로 물러날 시간이 남는다**',
    pulls
      .map(
        (p) =>
          `${p.from} ${p.start}m 에서 시작해 ${p.need}m 밖으로 / 반응 빼고 ${p.have.toFixed(1)}m` +
          (p.canDodge ? '' : ' ❗구르기조차 못 넣음'),
      )
      .join(' · '),
  )

  /**
   * ---- 4. 🟢 — 반응하고 **예고 안에 한 대를 꽂을 수 있는가** ----
   *
   * 🟢 은 피하는 것이 정답이 **아닌** 유일한 색입니다(enemyAttacks.ts).
   * 예고 중에 정면에서 때려야 성립하므로, 필요한 것은:
   *
   *   반응 시간 + 무기가 판정까지 가는 시간 ≤ 예고 길이
   *
   * ⚠️ **가장 느린 무기**로 잽니다. 대검으로는 못 하는 색이면 그건 색이
   *    아니라 무기 제한입니다. (판정까지 걸리는 시간이 선언값과 실제로
   *    같은지는 `npm run feel` 이 라이브로 잽니다 — 여기서는 읽기만.)
   */
  const slowWeapon = weapons.reduce((a, b) => (b.firstHitAt > a.firstHitAt ? b : a), weapons[0])
  const counterNeed = budget.choice + slowWeapon.firstHitAt
  const greens = of(COUNTER)
  const greenBad = greens.filter((a) => a.windup < counterNeed)
  check(
    greens.length > 0 && greenBad.length === 0,
    '🟢 은 반응하고도 **가장 느린 무기로 한 대 꽂을 시간이 남는다**',
    `예고가 ${counterNeed.toFixed(2)}초 이상이어야 함 (반응 ${budget.choice} + ${slowWeapon.name} ${slowWeapon.firstHitAt}초)` +
      ` · 가장 짧은 🟢 ${greens.length ? Math.min(...greens.map((a) => a.windup)) : '없음'}초` +
      (greenBad.length ? ` · ❗ ${greenBad.map((a) => `${a.from} ${showWindup(a)}`).join(' · ')}` : ''),
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
  void LABEL
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
