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
import { simPerWall, announceSpeed } from './machine.mjs'

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
  // ⏱ 예산은 안 적습니다 — 이 프로브가 쓰는 시뮬레이션 시간이 지연 격자와
  //    적 종류에 따라 달라져서, 어림하면 지어낸 숫자가 됩니다.
  announceSpeed(await simPerWall(page), 0)

  const t = await page.evaluate(() => window.__game.terrainInfo())
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  const dodges = await page.evaluate(() => window.__game.dodgeScales())
  /** 무적 구간 — 아래 📐 예측이 쓰는 값. 프로브가 숫자를 들고 있지 않게. */
  const dodge = await page.evaluate(() => window.__game.dodgeInfo())
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
        /**
         * 소환에 쓰는 **종류 id**. `from`(표시 이름)과 나누는 이유는,
         * 아래 늦은 구르기 실험이 `from` 을 그대로 `spawnEnemyKind` 에
         * 넘겼다가 null 을 받고 죽었기 때문입니다. 사람에게 보여 줄
         * 이름과 기계에 넘길 이름은 같은 칸에 두면 안 됩니다.
         */
        kindId: r.id,
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

  /**
   * ── 🕳 **검사가 자기가 안 재는 색을 못 봅니다** ──────────────────────
   *
   * 이 프로브는 🔴·🟡·🟣·🟢 을 손으로 적어 두고 그 넷만 쟀습니다. 게임에는
   * **🔵 속박**이 있고, 그 색의 정답도 구르기(무적 프레임)라 🔴 과 같은
   * 검사를 받아야 합니다. 그런데 목록에 없으니 **아무 말도 안 나옵니다** —
   * 이 저장소가 가장 비싸게 여기는 실패(조용한 계측기) 그대로입니다.
   *
   * 그래서 **잰 색을 표시해 두고, 게임이 말한 색을 다 덮었는지** 맨 끝에서
   * 묻습니다. 색이 여섯 번째로 늘어나면 그날 이 프로브가 빨개집니다.
   */
  const covered = new Set()
  const mark = (...intents) => intents.forEach((i) => i != null && covered.add(i))

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
  // 0번은 **모든 색**을 한꺼번에 봅니다(예고가 반응 시간보다 긴가).
  // 그래도 색별 검사의 대체물은 아니므로 여기서 덮었다고 치지 않습니다.
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
  mark(SWEEP)
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
   * ---- 2.5 🔴 **산수 말고 실제로 늦게 굴러 봅니다** ────────────────────
   *
   * 바로 위 🔴 검사가 이렇게 통과했습니다:
   *
   *     예고가 0.54초 이상이어야 함 · 가장 짧은 🔴 **0.55초**
   *
   * **여유가 0.01초입니다.** 그리고 이건 산수지 실제로 굴러 본 값이
   * 아닙니다. 프레임 하나가 이 컨테이너에서 0.05초, 60fps 에서도
   * 0.0167초입니다 — **여유가 한 프레임보다 작습니다.** 종이 위에서는
   * 통과하고 손에서는 동전 던지기입니다.
   *
   * 소울류가 가장 빠른 공격의 선행동작을 반응+무적시작보다 **넉넉히**
   * 길게 잡는 이유가 이것입니다. 마진이 프레임 단위 아래로 내려가면
   * 그 공격은 "읽고 답하는 공격"이 아니라 **외워서 미리 누르는 공격**이
   * 됩니다 — 이 프로브의 0번 검사가 막으려던 바로 그것인데, 0번은
   * 예고 길이만 보고 무적이 켜지는 시점은 안 봅니다.
   *
   * 그래서 실제로 눌러 봅니다: 예고가 뜬 뒤 **반응 예산만큼 기다렸다가**
   * 구르고, 맞는지 봅니다. 이 저장소의 규칙 그대로입니다 —
   * **규칙이 아니라 도달한 것을 본다.**
   *
   * ⚠️ 세 번 시도해 한 번이라도 넘기면 통과입니다. GPU 없는 이 컨테이너의
   *    프레임 흔들림까지 재면 게임이 아니라 기계 운을 재게 됩니다.
   *    (그래서 이 검사는 **여유가 없다**는 것을 증명하지는 못하고,
   *     **여유가 있다**는 것만 증명합니다. 빨강이 뜨면 그건 세 번 다
   *     실패했다는 뜻이라 훨씬 무거운 신호입니다.)
   */
  /**
   * ⚠️ **색을 손으로 적지 않습니다.** 예전엔 `of(STRIKE)` 하나였는데,
   *    정답이 구르기인 색은 🔴 말고 **🔵 속박**도 있습니다(그 색의 정답이
   *    바로 무적 프레임입니다). 프로브가 색 목록을 외우고 있었기 때문에
   *    🔵 은 이 검사를 **한 번도 안 받았습니다.** 이제 게임이 색마다
   *    `answerIsDodge` 를 실어 보내므로 그 목록으로 돕니다.
   */
  for (const color of budget.colors.filter((c) => c.answerIsDodge)) {
    const fastest = of(color.intent).sort((a, b) => a.windup - b.windup)[0]
    if (!fastest) {
      check(false, `${color.emoji} 가장 빠른 공격을 찾았다 (검사의 게이트)`)
    } else {
      mark(color.intent)
      /**
       * 한 번의 시도 = 예고를 잡고, `delay` 만큼 기다렸다가, 구르고, 맞았나.
       * 함수로 뽑는 이유는 아래에서 **여러 delay 로 되풀이**하기 때문입니다.
       */
      const rollAfter = (delay) =>
        page.evaluate(
          async ([kindId, wantId, wait]) => {
            const G = window.__game
            const runFor = async (sec) => {
              const target = G.state().elapsed + sec
              const dl = Date.now() + 60000
              while (G.state().elapsed < target && Date.now() < dl) {
                await new Promise((r) => setTimeout(r, 8))
              }
            }
            G.reset()
            await runFor(0.4)
            G.clearEnemies()
            await runFor(0.2)
            const p0 = G.state().player
            const e = G.spawnEnemyKind(kindId, p0.x + 12, p0.z)
            if (e == null || !G.entityState(e)) return { spawnFailed: kindId }
            await runFor(0.2)
            G.setHp(e, 100000)
            for (let attempt = 0; attempt < 14; attempt++) {
              const es = G.entityState(e)
              // 사거리 **안**에 서야 예고가 나옵니다. 코앞이 아니라 안쪽 가장자리.
              G.teleportPlayer(es.x, es.z - 1.6)
              G.setHp(G.playerEntity(), 100)
              await runFor(0.25)
              const dl = Date.now() + 20000
              let got = false
              while (Date.now() < dl) {
                const info = G.enemyInfo(e)
                if (info?.winding === true && info.attackId === wantId) {
                  got = true
                  break
                }
                await new Promise((r) => setTimeout(r, 8))
              }
              if (!got) continue
              const before = G.state().player.hp
              const tele = G.enemyInfo(e)?.timer ?? 0
              await runFor(wait)
              G.press('Space')
              await runFor(0.05)
              G.release('Space')
              await runFor(1.2)
              return { telegraph: Number(tele.toFixed(3)), before, hp: G.state().player.hp }
            }
            return null
          },
          [fastest.kindId, fastest.id, delay],
        )
      /**
       * ── 🎲 **몇 번 중 몇 번인지까지 셉니다** ────────────────────────
       *
       * 예전엔 한 번이라도 넘기면 곧장 `ok` 를 내고 멈췄습니다. 그래서
       * **1/3과 3/3이 표에서 똑같이 ○** 로 보였습니다. 실제로 이 차이가
       * 눈앞에서 드러났습니다 — `boss_bind` 의 0.48초가 한 번 돌렸을 때
       * `×`(0/3), 다음에 돌렸을 때 `○` 였습니다. **같은 자리가 판마다
       * 뒤집힙니다.**
       *
       * 프레임이 0.05초라 이 정도 흔들림은 기계 몫입니다. 그걸 없앨 수는
       * 없지만 **숨기지는 않습니다.** 아슬아슬하게 되는 자리와 넉넉히 되는
       * 자리는 게임에서 완전히 다른 것이고, ○ 하나로 뭉치면 그 차이가
       * 사라집니다 — 이 저장소가 여러 번 데인 그 모양입니다.
       *
       * 판정은 그대로 "한 번이라도 넘기면 된다"입니다(기계 운을 재지
       * 않으려고). 다만 **몇 번이었는지는 표에 남깁니다.**
       */
      const TRIES = 3
      const survives = async (delay) => {
        let win = 0
        let ran = 0
        for (let i = 0; i < TRIES; i++) {
          const r = await rollAfter(delay)
          if (!r) continue
          if (r.spawnFailed) return { spawnFailed: r.spawnFailed }
          ran++
          if (r.hp === r.before) win++
        }
        return { ok: win > 0, win, ran }
      }

      /**
       * ── ⏳ **"반응 시간에 정확히 누른다"는 최선이 아닙니다** ────────────
       *
       * 처음엔 예산(0.48초)에 딱 맞춰 한 번만 눌러 보고 판정했습니다.
       * 그 검사가 🔵 을 이렇게 빨갛게 만들었습니다:
       *
       *     boss_bind 예고 0.828초 · 0.48초× 0.40× 0.32× **0.24○**
       *     ❗예고 0.828 → 1.07초 필요
       *
       * **처방이 거꾸로였습니다.** 무적 창은 누른 뒤 0.06~0.30초입니다.
       * 0.48초에 누르면 무적은 0.54~0.78초인데 판정은 0.828초 — **이미
       * 닫혀 있습니다.** 실패 원인이 *늦어서*가 아니라 **너무 일찍 굴러서**
       * 였고, 그런데도 검사는 "예고를 더 늘리라"고 처방했습니다. 그대로
       * 따랐으면 일찍 구르는 문제를 **더 키웠을 것**입니다.
       *
       * 사람은 예고가 길면 반응하고 나서 **기다립니다.** 소울류가 긴 공격을
       * 공정하게 만드는 것도 그 때문입니다 — 늦게 눌러도 되는 창이 있습니다.
       * 그러니 물어야 할 것은 *"예산에 정확히 누르면 되는가"* 가 아니라
       * **"예산 이후에 넘길 수 있는 순간이 있는가, 그 창이 얼마나 넓은가"**
       * 입니다. 창의 넓이가 곧 이 공격의 너그러움입니다.
       *
       * ⚠️ 예산보다 **이른** 시각은 일부러 안 봅니다. 그건 색을 알아보기
       *    전에 누른 것이라 반응이 아니라 **예측**입니다.
       */
      /**
       * ── 📐 **기하학이 예측하는 창을 나란히 찍습니다** ────────────────
       *
       * 무적은 누른 뒤 `iFrameStart ~ iFrameEnd` 입니다. 판정이 예고 끝
       * `W` 에 온다면, 넘기려면 무적이 그 순간을 덮어야 하므로 누르는 시각은
       *
       *     t ∈ [W − iFrameEnd, W − iFrameStart]
       *
       * 입니다. 이 예측을 실측 옆에 두는 이유는, 둘이 어긋나는 순간이
       * **무적이 새고 있다**거나 **선입력이 시각을 옮기고 있다**는 신호이기
       * 때문입니다. 지금은 맞습니다 — `boss_bind`(예고 0.83초)에서 예측한
       * 창이 0.53~0.77초였고, 실측이 `0.48초 0/3 · 0.56초 1/3 ·
       * 0.64초 3/3 · 0.72초 3/3 · 0.80초 1/3` 로 **경계까지 그대로**
       * 나왔습니다.
       *
       * 그 덕에 기전을 정정할 수 있었습니다. 저는 앞서 이 실패를
       * *"밀려나서 살았다"* 로 읽었는데, 예측이 경계까지 맞는 이상 기전은
       * **무적 프레임 타이밍** 하나입니다. 짐작한 기전 위에서 값을 만졌으면
       * 엉뚱한 것을 고쳤을 것입니다.
       *
       * ── ⏭ **남는 차이는 프레임 한 장입니다 — 쫓아가지 마십시오** ──────
       *
       * 둘을 나란히 놓으면 실측이 예측보다 **늦은 쪽으로 조금** 밀려 있습니다:
       *
       *     🔵 예측 0.53~0.77   실측 0.56초 0/3 · 0.64 3/3 · 0.80 **1/3**
       *     🔴 예측 0.33~0.57   실측 0.48초 3/3 · 0.56 **2/3**
       *
       * 예측이 "열린다"고 한 0.53~0.56 근처가 실측에서는 아직 닫혀 있고,
       * "닫힌다"고 한 0.77 너머의 0.80 이 가끔 됩니다. 양쪽 다 **한 방향으로
       * 최대 0.05초** 밀린 것이고, 그게 이 컨테이너의 프레임 길이입니다 —
       * 요청한 시각에 정확히 눌리는 것이 아니라 **다음 프레임 경계에서**
       * 눌립니다.
       *
       * 즉 이 차이는 게임의 고장이 아니라 **재는 쪽의 해상도**입니다.
       * 여기를 좁히려고 무적 값을 만지면 있지도 않은 문제를 고치게 됩니다.
       * 어긋남이 **한 프레임을 넘을 때**만 신호로 읽으십시오.
       */
      const openAt = fastest.windup - dodge.iFrameEnd
      const closeAt = fastest.windup - dodge.iFrameStart
      const late = Number(budget.choice.toFixed(2))
      const STEP = 0.08
      const hits = []
      const rows = []
      let spawnFailed = null
      // 판정이 나간 뒤에 누르는 것은 뜻이 없으니 예고 길이에서 멈춥니다.
      for (let d = late; d <= fastest.windup + 1e-9; d += STEP) {
        const delay = Number(d.toFixed(2))
        const res = await survives(delay)
        if (res.spawnFailed) {
          spawnFailed = res.spawnFailed
          break
        }
        rows.push(`${delay.toFixed(2)}초 ${res.win}/${res.ran || TRIES}`)
        if (res.ok) hits.push({ delay, win: res.win, ran: res.ran || TRIES })
      }
      check(
        !spawnFailed && rows.length > 0,
        `${color.emoji} 늦게 굴러 보는 실험이 성립했다 (적을 세우고 예고를 잡았다)`,
        spawnFailed
          ? `적을 못 세웠습니다 — 종류 "${spawnFailed}"`
          : rows.length
            ? `${rows.length}개 시각을 재 봤습니다`
            : '예산이 예고보다 길어 잴 자리가 없습니다',
      )
      if (!spawnFailed && rows.length > 0) {
        /**
         * 창의 넓이는 **성공한 시각들의 폭 + 한 칸**입니다. 한 칸을 더하는
         * 이유: 0.08초 간격으로 훑었으므로 성공한 지점 하나는 최소 그
         * 정도의 폭을 갖습니다. 한 지점만 성공했을 때 "폭 0" 이라고 적으면
         * 실제보다 나쁘게 말하는 것입니다.
         */
        const width = hits.length ? hits[hits.length - 1].delay - hits[0].delay + STEP : 0
        /**
         * 창이 훑는 간격 한 칸뿐이거나, 넘긴 자리가 전부 아슬아슬(3번 중
         * 1번)하면 **초록이라고 안심시키지 않습니다.** 그 둘은 "된다"가
         * 아니라 **"측정 한계에서 겨우 보인다"** 입니다.
         */
        const thin = hits.length > 0 && (width <= STEP + 1e-9 || hits.every((h) => h.win === 1))
        const note = !hits.length
          ? ' ❗예산 이후 **어느 순간에도** 못 넘깁니다'
          : thin
            ? ` — ⚠️ 창이 ${width.toFixed(2)}초뿐입니다(훑는 간격 ${STEP}초 · 프레임 0.05초).` +
              ' 된다기보다 **겨우 보인다**에 가깝습니다'
            : ` — ${hits[0].delay.toFixed(2)}~${hits[hits.length - 1].delay.toFixed(2)}초에 넘김` +
              ` (창 ${width.toFixed(2)}초)`
        check(
          hits.length > 0,
          `${color.emoji} **읽고 나서 넘길 수 있는 순간이 있다** (산수가 아니라 눌러 본 값)`,
          `${fastest.from} ${fastest.id} · 예고 ${fastest.windup.toFixed(2)}초` +
            ` · 📐 예측한 창 ${Math.max(0, openAt).toFixed(2)}~${closeAt.toFixed(2)}초` +
            (openAt > budget.choice
              ? ` (반응 예산보다 ${(openAt - budget.choice).toFixed(2)}초 늦게 열림 — **읽자마자 구르면 안 됩니다**)`
              : '') +
            `\n                 ${rows.join(' · ')}` +
            note,
        )
      }
    }
  }

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
    /**
     * ⚠️ **못 하는 동작의 거리를 더하면 안 됩니다.**
     *
     * 이 식은 *"반응 → 구르기 → 걷기"* 를 가정하는데, 남은 예고가 구르기
     * 길이보다 짧으면 **구르기가 끝나지 않습니다.** 그런데 `have` 에는
     * 구르기 거리가 그대로 들어가 있었고, `canDodge` 는 ❗ 표시만 하고
     * **판정은 그 거리로 통과**시켰습니다.
     *
     * 이 저장소가 여러 번 데인 모양입니다 — 경고를 찍되 문을 안 세우면
     * 초록에 묻힙니다. 못 구르면 **걸어서만** 갑니다.
     */
    const canDodge = free >= slowDodge.duration
    return {
      from: a.from,
      need: a.reach,
      have: start + (canDodge ? t.dodgeDistance : 0) + t.playerMoveSpeed * walk,
      start,
      canDodge,
      /**
       * 🚧 **시작부터 사거리 밖이면 증거가 아닙니다.**
       * 「8m 에서 시작해 6m 밖으로」는 물러날 것도 없이 이미 밖입니다.
       * 그런 줄이 섞이면 *"물러날 시간이 남는다"* 가 **빈 표본으로**
       * 통과할 수 있습니다 — 이 파일이 다른 자리마다 세워 둔 게이트와
       * 같은 이유로 갈라 둡니다.
       */
      trivial: start >= a.reach,
    }
  })
  const real = pulls.filter((p) => !p.trivial)
  const pullBad = real.filter((p) => p.have <= p.need)
  mark(PULL)
  check(
    real.length > 0 && pullBad.length === 0,
    '🟣 은 반응하고도 **사거리 밖으로 물러날 시간이 남는다**',
    real
      .map(
        (p) =>
          `${p.from} ${p.start}m 에서 시작해 ${p.need}m 밖으로 / 반응 빼고 ${p.have.toFixed(1)}m` +
          (p.canDodge ? '' : ' ❗구르기는 못 넣어 **걸어서만** 잰 값'),
      )
      .join(' · ') +
      (pulls.length > real.length
        ? ` · [증거 아님] 시작부터 사거리 밖 ${pulls.length - real.length}개 — ` +
          pulls
            .filter((p) => p.trivial)
            .map((p) => `${p.from} ${p.start}m≥${p.need}m`)
            .join(' · ')
        : ''),
  )

  /**
   * ── 🟣 **정답이 하나인가 — 옆으로 굴러도 넘어가는가** ────────────────
   *
   * 위 검사는 *"의도한 답(물러나기)이 성립하는가"* 를 봅니다. 그런데
   * 자동 플레이 9판을 세어 보니 아무도 그 답을 쓰지 않았습니다:
   *
   *     boss_hook — 9판 중 4판에 나옴 · **적중 4회 전부 0(0%)**
   *     빗나간 이유 **각도 3** · 사거리 1
   *     휘두르는 순간 플레이어 **54~58°** · 허용 반부채꼴 **35°**
   *
   * 즉 실전에서는 **옆으로 비켜서** 넘기고 있습니다. 그게 정답이어도
   * 되는지는 설계 판단이지만, 판단하려면 먼저 **정말 통하는지** 알아야
   * 합니다. 통한다면 이 색의 답은 둘이고, 그중 **싼 쪽이 이깁니다.**
   *
   * 기둥 2 는 *"색마다 다른 대응"* 입니다. 🟣 의 실질 정답이 🔴 과 같은
   * 구르기라면 색이 하나 줄어든 것과 같습니다 — 세키로가 危 하나에 답을
   * 셋(점프·간파·회피) 두고 **모션으로 어느 것인지 가르치는** 이유가
   * 그것입니다. 답이 겹치면 기호가 남아도 배울 것이 없습니다.
   *
   * ⚠️ 패턴을 **강제로** 세웁니다(`forceAttack`). 6.5m 에서 갈고리는
   *    열 발 중 한 발이라(`npm run pace` 물러난 손), 기다려서 재면
   *    표본이 안 모입니다. 묻는 것은 빈도가 아니라 **성립 여부**입니다.
   */
  {
    const bossRow = roster.find((r) => r.id === 'boss')
    const hookIdx = (bossRow?.attacks ?? []).findIndex((a) => a.intent === PULL)
    const hook = hookIdx >= 0 ? bossRow.attacks[hookIdx] : null
    if (hook) {
      const at = (hook.minRange + Math.min(hook.maxRange ?? hook.reach, hook.reach)) / 2
      /**
       * ── ⏱ **언제 구르느냐를 같이 흔듭니다** ──────────────────────────
       *
       * 지난 회차에 이 실험대는 **한 타이밍만** 눌러 보고 「옆으로는 못
       * 넘긴다」를 초록으로 냈습니다. 그런데 실전 장부는 정반대였습니다:
       *
       *     boss_hook — 예고를 걸 때 **0°**(정면) → 휘두를 때 **88°**
       *     binder_cocoon — **0°** → **124°**
       *
       * 적은 정확히 조준하고 시작했고, 빗나감은 **예고 동안 전부** 생겼습니다.
       * 실험대는 예고 0.25초에 굴렀고(=이른 구르기) 맞았습니다. 그러면
       * 남는 설명은 하나입니다 — **실전은 더 늦게 구른다.**
       *
       * 이르게 구르면 적에게 되돌릴 시간이 남고, 늦게 구르면 안 남습니다.
       * 그러니 「옆으로는 못 넘긴다」는 **타이밍 하나짜리 초록**이었습니다.
       * 「한 칸 차이의 초록은 운이다」와 같은 병이라 같은 처방을 씁니다 —
       * **답이 하나라도 통하면 통하는 것**으로 봅니다.
       *
       * ⚠️ 지연은 초가 아니라 **예고의 몫**으로 줍니다. 예고 길이를 여기
       *    베껴 적으면 페이즈 배율을 바꾸는 날 이 실험이 조용히 다른
       *    타이밍을 재게 됩니다. 길이는 게임에게 묻습니다(`enemyInfo`).
       */
      const arm = async (mode, frac) =>
        page.evaluate(
          async ([idx, dist, how, delayFrac, atkId]) => {
            const G = window.__game
            const sleep = () => new Promise((r) => setTimeout(r, 6))
            const runFor = async (sec) => {
              const t = G.state().elapsed + sec
              const dl = Date.now() + 30000
              while (G.state().elapsed < t && Date.now() < dl) await sleep()
            }
            G.reset()
            await runFor(0.3)
            G.clearEnemies()
            await runFor(0.2)
            const p0 = G.state().player
            const b = G.spawnBoss(p0.x + dist, p0.z)
            if (b == null) return null
            G.setHp(b, 100000)
            await runFor(0.2)
            const bs = G.entityState(b)
            G.teleportPlayer(bs.x - dist, bs.z)
            G.setStamina(100)
            G.setHp(G.playerEntity(), 100)
            await runFor(0.2)
            if (!G.forceAttack(b, idx)) return null
            // 📒 장부를 비우고 시작합니다 — 앞선 시도의 줄이 섞이면
            //    "왜 안 맞았나"의 답이 다른 판의 것이 됩니다.
            G.swings()
            /**
             * 예고 길이는 **게임에게 묻습니다** — 페이즈 배율과 뜸이 이미
             * 반영된 값입니다. 그 몫만큼 기다렸다가 구릅니다.
             *
             * ⏱ 구르기는 **시작 시점**이 아니라 **끝나는 시점**이 판정과
             *    겹쳐야 의미가 있으므로, 늦은 쪽은 예고가 거의 다 찬
             *    자리에서 누릅니다.
             */
            const wlen = G.enemyInfo(b)?.windup ?? 1.5
            await runFor(Math.max(0.05, wlen * delayFrac))
            // 보스 → 나 방향. 뒤로는 그 반대, 옆으로는 90° 돌린 쪽.
            const me = G.state().player
            const es = G.entityState(b)
            const ax = me.x - es.x
            const az = me.z - es.z
            const L = Math.hypot(ax, az) || 1
            const dx = how === 'back' ? ax / L : -az / L
            const dz = how === 'back' ? az / L : ax / L
            const cam = G.cameraAxes()
            const fwd = dx * cam.forwardX + dz * cam.forwardZ
            const right = dx * cam.rightX + dz * cam.rightZ
            const keys = []
            if (fwd > 0.25) keys.push('KeyW')
            if (fwd < -0.25) keys.push('KeyS')
            if (right > 0.25) keys.push('KeyD')
            if (right < -0.25) keys.push('KeyA')
            for (const k of keys) G.press(k)
            await sleep()
            const before = G.state().player.hp
            G.press('Space')
            await sleep()
            G.release('Space')
            await runFor(1.8)
            for (const k of keys) G.release(k)
            const me2 = G.state().player
            const es2 = G.entityState(b)
            /**
             * 🔎 **넘겼다면 왜 넘겼는지**를 게임에게 묻습니다.
             *
             * "받은 피해 0" 만으로는 답이 갈리지 않습니다. 옆으로 구르면
             * 각도도 벌어지지만 **거리도** 벌어지기 때문입니다:
             *
             *   · **각도**로 빠졌다면 → 🟣 의 답이 🔴(구르기)과 같아진 것
             *   · **사거리**로 빠졌다면 → 🟣 의 답(물러나기)이 그대로 산 것.
             *     옆으로 구른 것이 우연히 거리도 벌어 준 것뿐입니다.
             *
             * 처방이 정반대라 뭉쳐 두면 안 됩니다. 그리고 여기서 각도를
             * 다시 재지 않습니다 — 판정을 내린 자리(`combat.ts` 장부)의
             * 답을 그대로 씁니다. 다시 재면 판정의 사본이 생깁니다.
             */
            const rec = G.swings().find((s) => s.attackId === atkId) ?? null
            return {
              hurt: before - me2.hp,
              dist: Math.hypot(me2.x - es2.x, me2.z - es2.z),
              windup: wlen,
              why: rec
                ? rec.hit
                  ? '적중'
                  : rec.invuln
                    ? '무적'
                    : rec.dist > rec.reach
                      ? '사거리'
                      : '각도'
                : '판정없음',
              rec,
            }
          },
          [hookIdx, at, mode, frac, hook.id],
        )
      /**
       * 세 타이밍: **이르게 · 절반 · 늦게.** 이른 쪽은 지난 회차와 같은
       * 자리라 예전 결과와 맞대어 볼 수 있고, 늦은 쪽이 실전에 가깝습니다.
       */
      const TIMINGS = [
        ['이르게', 0.17],
        ['절반', 0.5],
        ['늦게', 0.8],
      ]
      /**
       * ── 🎲 **한 번 눌러 보고 답을 정하지 않습니다** ────────────────────
       *
       * 이 실험을 두 번 돌렸더니 **같은 타이밍이 다른 답**을 냈습니다:
       *
       *     1회차  옆으로 늦게 — 받은 피해  0 · 끝난 거리 13.5m
       *     2회차  옆으로 늦게 — 받은 피해 16 · 끝난 거리 10.1m
       *
       * 게임의 난수는 씨앗이라 여기가 흔들릴 곳이 아닙니다. 흔들리는 것은
       * **실험대 쪽**입니다 — 이 실험대는 `setTimeout(6ms)` 로 게임을
       * 들여다보며 "예고의 80%가 지났으면 구른다"를 누르는데, GPU 없는
       * 컨테이너에서는 그 눈금이 프레임마다 튑니다. 늦은 구르기는 판정과
       * **0.1초 안쪽**에서 겹치므로, 그 튐이 그대로 답을 뒤집습니다.
       *
       * 그러니 한 번의 초록은 「한 칸 차이의 초록은 운이다」 그 자체입니다.
       * **여러 번 눌러 보고, 한 번이라도 빠지면 빠지는 것으로** 봅니다 —
       * 플레이어는 판마다 다시 주사위를 굴리지 않고, 되는 것을 찾아
       * 그것만 씁니다.
       *
       * ⚠️ 흔들림 자체도 적습니다. *"세 번 중 한 번만 빠진다"* 와 *"세 번
       *    다 빠진다"* 는 설계에 다른 말을 합니다 — 앞은 **타이밍 창**이고
       *    뒤는 **그냥 되는 답**입니다.
       */
      const TRIES = 3
      const sides = []
      for (const [name, frac] of TIMINGS) {
        const runs = []
        for (let i = 0; i < TRIES; i++) runs.push(await arm('side', frac))
        // 대표값은 **가장 잘 빠진 판**입니다. 최악을 고르면 "안 된다"는
        // 결론이 실험대의 느림 덕분에 나올 수 있습니다.
        const best = runs.filter(Boolean).sort((a, b) => a.hurt - b.hurt)[0] ?? null
        sides.push([name, best, runs])
      }
      const back = await arm('back', 0.17)
      const side = sides[0][1] // 지난 회차와 같은 타이밍 — 아래 비교의 기준
      console.log(
        `\n  🟣 ${hook.id} 를 ${at.toFixed(1)}m 에서 강제로 세우고 눌러 봤습니다` +
          `${side ? ` (예고 ${side.windup.toFixed(2)}초)` : ''}\n` +
          sides
            .map(
              ([name, r, runs]) =>
                `     옆으로 구르기 ${name.padEnd(4)} — ${
                  r ? `받은 피해 ${r.hurt} · 끝난 거리 ${r.dist.toFixed(1)}m · 판정 ${r.why}` : '실패'
                }   [${TRIES}번: ${runs.map((x) => (x ? `${x.hurt}(${x.why})` : '실패')).join(' ')}]${
                  // 🎲 답이 판마다 갈렸으면 **그 사실 자체가 결론**입니다.
                  new Set(runs.map((x) => (x ? x.why : '실패'))).size > 1 ? ' ⚠️ 판마다 다름' : ''
                }`,
            )
            .join('\n') +
          `\n     뒤로 구르기        — ${back ? `받은 피해 ${back.hurt} · 끝난 거리 ${back.dist.toFixed(1)}m · 판정 ${back.why}` : '실패'}`,
      )
      check(
        sides.every(([, r]) => r !== null) && back !== null,
        '🚧 🟣 네 답을 모두 실제로 눌러 봤다 (비교의 게이트)',
        `${sides.map(([n, r]) => `${n} ${r ? '○' : '×'}`).join(' · ')} · 뒤 ${back ? '○' : '×'}`,
      )
      if (sides.every(([, r]) => r !== null) && back) {
        /**
         * ⚠️ **하나라도 통하면 통하는 것입니다.** 플레이어는 세 타이밍을
         *    평균 내지 않습니다 — 되는 것을 찾아서 그것만 씁니다. 그러니
         *    "평균은 맞더라"는 답이 될 수 없습니다.
         */
        // ⚠️ **대표값이 아니라 모든 판**을 봅니다. 대표값만 보면 한 판만
        //    빠진 타이밍이 "안 빠지는 것"으로 묻힙니다.
        const escaped = sides
          .map(([n, , runs]) => [n, runs.filter(Boolean).find((x) => x.hurt === 0) ?? null, runs])
          .filter(([, r]) => r !== null)
        /**
         * 🔎 **각도로 빠진 것만이 색을 지웁니다.**
         *
         * 옆으로 구르면 각도도 벌어지지만 **거리도** 벌어집니다. 사거리로
         * 빠졌다면 그건 🟣 의 정답(물러나기)을 옆걸음으로 이룬 것일 뿐이라
         * 색이 겹친 것이 아닙니다. 그래서 판정 이유까지 보고 가릅니다 —
         * 「빗나간 이유를 사건이 일어난 자리에서 적는다」의 값을 그대로
         * 씁니다(여기서 각도를 다시 재지 않습니다).
         */
        const byAngle = escaped.filter(([, r]) => r.why === '각도')
        check(
          byAngle.length === 0,
          '🟣 **옆으로 굴러서는 못 넘긴다** (색마다 다른 대응 — 답이 겹치면 색이 하나 줄어듭니다)',
          byAngle.length === 0
            ? `각도로 빠진 타이밍 없음 — ${sides.map(([n, r]) => `${n} ${r.hurt}(${r.why})`).join(' · ')} · 뒤로 ${back.hurt}(${back.why})`
            : `**${byAngle.map(([n]) => n).join('·')} 구르면 각도로 빠집니다** — ` +
              `${sides.map(([n, r]) => `${n} ${r.hurt}(${r.why})`).join(' · ')}` +
              ` · 🟣 의 답이 🔴 과 같아집니다(실전 장부: 예고 시작 0° → 판정 88°)`,
        )
        /**
         * 판정과 별개로 **거리로 빠진 것도 적어 둡니다.** 색이 겹친 것은
         * 아니지만 *"옆으로 굴렀는데 물러나기가 된다"* 는 것 자체가 설계
         * 판단거리입니다 — 판정으로 만들지 않는 이유는 그게 정답의
         * 성립이지 위반이 아니기 때문입니다.
         */
        const byRange = escaped.filter(([, r]) => r.why !== '각도')
        if (byRange.length > 0) {
          console.log(
            `     [관측] ${byRange.map(([n, r]) => `${n}`).join('·')} 는 **${byRange[0][1].why}** 로 빠졌습니다` +
              ` — 옆으로 굴러도 사거리 밖(${byRange.map(([, r]) => `${r.dist.toFixed(1)}m`).join('·')})이면 🟣 의 정답을 옆걸음으로 이룬 것입니다`,
          )
        }
      }
    }
  }

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
  mark(COUNTER)
  check(
    greens.length > 0 && greenBad.length === 0,
    '🟢 은 반응하고도 **가장 느린 무기로 한 대 꽂을 시간이 남는다**',
    `예고가 ${counterNeed.toFixed(2)}초 이상이어야 함 (반응 ${budget.choice} + ${slowWeapon.name} ${slowWeapon.firstHitAt}초)` +
      ` · 가장 짧은 🟢 ${greens.length ? Math.min(...greens.map((a) => a.windup)) : '없음'}초` +
      (greenBad.length ? ` · ❗ ${greenBad.map((a) => `${a.from} ${showWindup(a)}`).join(' · ')}` : ''),
  )

  console.log('')
  /**
   * ── 🕳 **게임이 말한 색을 다 쟀는가** ──────────────────────────────
   *
   * 맨 마지막에 묻습니다. 이 프로브는 색 목록을 손으로 적어 두고 넷만
   * 쟀고, 그래서 **🔵 속박이 한 번도 검사를 안 받았습니다.** 빠진 것을
   * 알려 주는 것이 아무것도 없었습니다 — 통과하는 검사보다 나쁜 것이
   * 아무 말도 안 하는 검사라고 이 파일 아래에 적어 두고, 정작 이 파일이
   * 그러고 있었습니다.
   *
   * 색이 여섯 번째로 늘어나면 그날 이 줄이 빨개집니다. 그게 목적입니다.
   *
   * ⚠️ 표본이 비면 통과가 아닙니다 — 색을 하나도 못 읽었으면 그건
   *    "다 쟀다"가 아니라 "아무것도 못 읽었다"입니다.
   */
  const missed = budget.colors.filter((c) => !covered.has(c.intent))
  check(
    budget.colors.length > 0 && missed.length === 0,
    '🕳 **게임이 가진 색을 하나도 빠짐없이 쟀다** (안 재는 색을 검사가 스스로 볼 수 있게)',
    budget.colors.length === 0
      ? '색을 하나도 못 읽었습니다'
      : missed.length
        ? `안 잰 색 — ${missed.map((c) => `${c.emoji} ${c.label}`).join(' · ')}`
        : `${budget.colors.length}색 전부 — ${budget.colors.map((c) => c.emoji).join('')}`,
  )

  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
  void LABEL
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
