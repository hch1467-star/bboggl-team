/**
 * 🩸 출혈 축 검증 — `npm run bleed`
 *
 * ── 무엇을 묻는가 ──────────────────────────────────────────────────
 * 이 축은 **한 번도 터진 적이 없습니다.** 자동 플레이 두 판이 같은 말을
 * 했습니다 — 롱소드 0회(최고 65.7), 쌍단검 0회(최고 57.6).
 *
 * 그런데 벤치는 *"한 판에 몇 번 터졌나"* 만 셉니다. 0 이 나왔을 때
 * **왜** 0 인지는 못 말합니다. 원인이 둘인데 처방이 정반대이기 때문입니다:
 *
 *   · 적이 **먼저 죽는다**  → 문턱/적 체력의 이야기
 *   · **식어서** 못 채운다  → 유예/식는 속도의 이야기
 *
 * 그래서 여기서는 **버티는 적**(허수아비)을 세워 놓고 두 원인을 갈라
 * 잽니다. 죽지 않는 상대에게 일정 간격으로 때리면, 남는 변수는 식는
 * 것뿐입니다.
 *
 * ── 이번에 고친 것은 **보스 쪽 절반**입니다 ────────────────────────
 * *"몰릴수록 지운 것이 덜 지워진다"*(세키로의 체간). 체력이 깎일수록
 * 게이지의 **바닥**이 올라옵니다. 그래서 이 프로브의 핵심 질문은 하나입니다:
 *
 *   **17초를 물러났을 때, 체력이 낮은 쪽에서만 남는가.**
 *
 * ⚠️ 체력이 가득한 적에게는 바닥이 정확히 0 이라 **아무것도 안 바뀝니다.**
 *    그것도 같이 확인합니다 — 안 바뀌어야 `npm run weapons` 의 허수아비
 *    숫자가 그대로입니다(예전에 문턱을 건드렸다가 그 벤치를 깨뜨렸습니다).
 *
 * ── ❌ 여기서 처방을 **한 번 갈아엎었습니다** ─────────────────────
 * 처음엔 *"체력이 낮을수록 천천히 식는다"* 였습니다. 이 프로브가 재 보니
 * 같은 간격 3.2초 × 14대에서 24 → 89.7 로 **방향은 맞는데 안 터졌고**,
 * 더 나쁜 것은 89.7 까지 열여섯 대가 필요한데 **보스가 체력 15% 이하로
 * 있는 시간이 8.3초**(실측)뿐이라는 것이었습니다. 실제로는 일어나지 않는
 * 조건을 고치고 있었습니다. 계측기가 없었으면 "고쳤다"고 적었을 자리입니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5251
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

  console.log('\n🩸 출혈 축 검증 — 0회일 때 **왜** 0인지를 가릅니다\n')

  /**
   * ---- 1. 규칙을 **게임에게 묻습니다** ----
   *
   * 식을 여기 베껴 두면 값을 손보는 날 조용히 옛말이 됩니다.
   */
  const info = await page.evaluate(() => window.__game.bleedInfo())
  console.log(
    `  [규칙] 유예 ${info.decayDelay}초 · 식는 속도 ${info.decayPerSec}/초 · ` +
      `바닥 비율 ${info.decayFloorRatio} · 터짐 최대체력의 ${(info.popDamagePct * 100).toFixed(0)}%(상한 ${info.popDamageCap})`,
  )
  for (const w of info.weapons) {
    console.log(
      `    ${w.id.padEnd(10)} 배율 ${w.bleedScale} · 한 바퀴 ${w.perCombo} · ` +
        `손익분기 간격 ${w.breakEvenGap}초 · 바닥에서 문턱까지 ${w.hitsFromFloor}대`,
    )
  }
  check(
    info.decayFloorRatio > 0 && info.decayFloorRatio < 1,
    '🩸 바닥 비율이 **0도 1도 아니다** (0이면 아무것도 안 바뀌고, 1이면 안 때려도 터집니다)',
    `${info.decayFloorRatio}`,
  )
  check(
    info.weapons.length > 0 &&
      info.weapons.every((w) => w.hitsFromFloor >= 2) &&
      info.weapons.some((w) => w.hitsFromFloor <= w.hitsPerCombo * 2),
    '🩸 바닥에서 문턱까지가 **한 번 붙는 동안 들어올 타수**다 (두 대보다는 많고, 두 바퀴 안쪽인 무기가 있다)',
    info.weapons.map((w) => `${w.id} ${w.hitsFromFloor}대(한 바퀴 ${w.hitsPerCombo}타)`).join(' · '),
  )

  /**
   * ---- 2. **긴 공백이 무엇을 지우는가** ----
   *
   * 실측이 가리킨 범인이 여기입니다 — 보스전 타격 간격은 평균 2.45초로
   * 유예(2.5초) **안쪽**인데도 쌓은 것의 **85%**가 날아갔습니다. 범인은
   * 평균이 아니라 **최대 17.05초**짜리 공백입니다. 20/초로 340이 지워지니,
   * 그때까지 무엇을 쌓았든 0 이 됩니다.
   *
   * 그래서 이 프로브의 핵심 실험은 하나입니다:
   * **가득 채워 놓고 길게 쉬면 어디까지 지워지는가.**
   * 두 판의 차이는 **체력 하나뿐**입니다.
   */
  const afterSilence = async (hpRatio) =>
    page.evaluate(
      async ([r]) => {
        const G = window.__game
        const e = G.spawnBleedDummy(r)
        // 유예 안쪽으로 몰아쳐 높이 올려 둡니다 — 지워지는 것을 보려면 먼저 쌓아야 합니다.
        let built = 0
        for (let i = 0; i < 6; i++) {
          G.hitBleedDummy(e)
          built = Math.max(built, G.bleedOf(e))
          await window.__t.runFor(1.5)
        }
        // 그리고 **실측 최대 공백**(17초)만큼 물러납니다.
        await window.__t.runFor(17)
        const out = { built: Number(built.toFixed(1)), left: Number(G.bleedOf(e).toFixed(1)) }
        G.despawnBleedDummy(e)
        return out
      },
      [hpRatio],
    )
  const fullSilence = await afterSilence(1.0)
  const dyingSilence = await afterSilence(0.15)
  console.log(
    `\n  [17초 물러남 — 보스전 실측 최대 공백] 체력 100% ${fullSilence.built} → **${fullSilence.left}**` +
      `   |   체력 15% ${dyingSilence.built} → **${dyingSilence.left}**\n`,
  )
  check(
    fullSilence.built > 0 && dyingSilence.built > 0,
    '🚧 두 판 모두 **실제로 쌓았다** (비교의 게이트)',
    `${fullSilence.built} / ${dyingSilence.built}`,
  )
  check(
    fullSilence.left === 0,
    '🩸 **체력이 가득한 적에게선 물러나면 사라진다** (이 축의 계약은 초반에 그대로입니다)',
    `${fullSilence.built} → ${fullSilence.left}`,
  )
  check(
    dyingSilence.left > 0,
    '🩸 **몰린 적에게선 물러나도 남는다** (17초짜리 공백 하나가 전부를 지우지 못합니다)',
    `${dyingSilence.built} → ${dyingSilence.left}`,
  )

  /**
   * ---- 3. **바닥에서 몰아붙이면 터지는가** ----
   *
   * 바닥이 하는 일은 *"지우지 않는 것"* 뿐입니다. 터뜨리는 것은 여전히
   * 플레이어의 몫이라야 합니다 — 안 그러면 안 때려도 터지는 눈금이 됩니다.
   * 그래서 **긴 공백 뒤에 콤보 한 바퀴 반**을 넣어 봅니다.
   */
  const burst = await page.evaluate(async () => {
    const G = window.__game
    const info = G.bleedInfo()
    const e = G.spawnBleedDummy(0.15)
    for (let i = 0; i < 6; i++) {
      G.hitBleedDummy(e)
      await window.__t.runFor(1.5)
    }
    await window.__t.runFor(17) // 물러났다가
    const floor = Number(G.bleedOf(e).toFixed(1))
    /**
     * ⚠️ **필요한 타수는 잰 바닥에서 셉니다.**
     *
     * 처음엔 게임이 내주는 `hitsFromFloor`(4대)를 그대로 썼다가 빨갛게
     * 나왔습니다 — 51 + 4×12 = **99**, 한 대 차이로요. 그 값은 **빈사
     * (체력 0)의 바닥 60** 을 기준으로 한 *최선*이고, 살아 있는 적의
     * 바닥은 그보다 낮습니다(체력 15% → 51). 규칙이 틀린 게 아니라
     * 제가 다른 기준의 숫자를 가져다 쓴 것입니다.
     */
    const need = Math.ceil((info.maxByKind.find((m) => m.id === 'grunt').max - floor) / info.perHit)
    let pops = 0
    // 다시 붙어서 **바닥에서 문턱까지** 필요한 만큼만 때립니다(콤보 안쪽 간격).
    for (let i = 0; i < need; i++) {
      pops += G.hitBleedDummy(e) ? 1 : 0
      await window.__t.runFor(0.4)
    }
    G.despawnBleedDummy(e)
    return { floor, need, pops }
  })
  console.log(
    `  [바닥 ${burst.floor} 에서 ${burst.need}대] 터짐 ${burst.pops}회\n`,
  )
  check(
    burst.pops > 0,
    '🩸 **터진다** — 이 축이 실제로 완결되는 것을 처음 확인합니다',
    `바닥 ${burst.floor} → ${burst.need}대에 ${burst.pops}회`,
  )

  /**
   * ---- 3-b. **체력이 가득하면 아무것도 안 바뀌어야** 합니다 ----
   *
   * 이게 이번 변화가 `npm run weapons` 를 안 건드린다는 증거입니다.
   * 그 벤치의 허수아비는 체력 1,000,000 을 **가득 채우고** 서 있습니다.
   * 예전에 문턱을 건드렸다가 정확히 그 벤치가 17/18 → 14/17 로 깨졌고,
   * 그래서 되돌렸습니다. 같은 자리를 두 번 밟지 않으려고 재 둡니다.
   */
  const noDecay = await page.evaluate(async () => {
    const G = window.__game
    const out = []
    for (const r of [1.0, 0.15]) {
      const e = G.spawnBleedDummy(r)
      for (let i = 0; i < 4; i++) {
        G.hitBleedDummy(e)
        await window.__t.runFor(2.0) // 유예(2.5초) 안쪽 — 식지 않는 구간
      }
      out.push(Number(G.bleedOf(e).toFixed(1)))
      G.despawnBleedDummy(e)
    }
    return out
  })
  const expect = Number((info.perHit * info.weapons[0].bleedScale * 4).toFixed(1))
  console.log(
    `  [유예 안쪽 2.0초 × 4대 — 식지 않는 구간] 체력 100% ${noDecay[0]} · 체력 15% ${noDecay[1]} (예상 ${expect})\n`,
  )
  check(
    noDecay[0] === noDecay[1] && noDecay[0] === expect,
    '🛡 **안 식는 구간에서는 체력이 아무 영향을 안 준다** (허수아비 벤치가 안 흔들립니다)',
    `${noDecay[0]} vs ${noDecay[1]} (예상 ${expect})`,
  )

  /**
   * ---- 4. **잡몹은 왜 여전히 안 터지는가** — 숨기지 않고 적어 둡니다 ----
   *
   * 이번에 고친 것은 보스 쪽 절반뿐입니다. 잡몹은 *"적이 먼저 죽어서"*
   * 안 터지고, 그건 문턱이 아니라 **잡몹 체력**의 이야기라 이 축이 혼자
   * 답할 수 없습니다(문턱을 내리는 길은 이미 한 번 시도하고 되돌렸습니다 —
   * `enemies.ts` `bleedMaxOf` 설계 노트).
   *
   * 그래도 **얼마나 모자라는지**는 숫자로 남깁니다. 안 적어 두면 다음에
   * 이 자리를 보는 사람이 "고쳤나 보다" 하고 지나갑니다.
   */
  const gap2 = await page.evaluate(() => {
    const G = window.__game
    const info = G.bleedInfo()
    const best = info.weapons.reduce((a, b) => (b.bleedScale > a.bleedScale ? b : a))
    const grunt = info.maxByKind.find((m) => m.id === 'grunt')
    // 실측(자동 플레이): 잡몹은 평균 2.8대에 죽고 한 대당 11.4 가 쌓입니다.
    return { need: grunt.max, perHit: info.perHit * best.bleedScale, best: best.id }
  })
  console.log(
    `  🧾 잡몹 — 문턱 ${gap2.need} · 가장 잘 쌓는 무기(${gap2.best}) 한 대 ${gap2.perHit.toFixed(1)}` +
      ` → **${Math.ceil(gap2.need / gap2.perHit)}대**를 버텨야 하는데 실측은 **2.8대**에 죽습니다\n`,
  )
  check(
    Math.ceil(gap2.need / gap2.perHit) > 3,
    '🧾 **잡몹 쪽은 아직 안 고쳤다는 사실을 장부가 알고 있다** (조용히 넘어가지 않게)',
    `필요 ${Math.ceil(gap2.need / gap2.perHit)}대 vs 실측 수명 2.8대`,
  )

  /**
   * ---- 5. ⏸ **때릴 수 없었던 시간은 유예를 먹지 않는가** ----
   *
   * 이 축의 계약은 *"물러나면 사라진다"* 인데, 계약의 주어는 **플레이어**
   * 여야 합니다. 페이즈 전환(1.25초) 동안 보스는 무적이고 플레이어를
   * 밀어냅니다 — 그 시간은 *"안 때린 것"* 이 아니라 *"못 때린 것"* 입니다.
   *
   * ── 왜 **같은 보스·같은 체력**으로 두 창을 이어 재는가 ──────────────
   * 무적 구간만 재면 "원래 그 구간엔 안 식었을 수도" 를 못 가립니다. 그렇다고
   * 다른 판과 견주면 **체력이 달라지고, 체력이 달라지면 바닥이 달라집니다**
   * (`decayFloorRatio`) — 규칙이 아니라 바닥이 만든 차이를 규칙의 공으로
   * 적게 됩니다. 그래서 **한 마리에게 등을 맞대고** 잽니다:
   *
   *     창 A = 전환 직후 1.25초 (무적)      ← 안 식어야 합니다
   *     창 B = 바로 이어지는 1.25초 (무적 풀림) ← 식어야 합니다
   *
   * 두 창은 체력도 바닥도 사실상 같습니다. 남는 차이는 **무적 하나**입니다.
   */
  const blocked = await page.evaluate(() => {
    const G = window.__game
    G.reset()
    G.clearEnemies()
    G.setPaused(true)
    const b = G.spawnBoss(6, 0)
    G.step(20, 1 / 60, true)
    G.wakeEnemy(b)
    const roster = G.enemyRoster().find((r) => r.id === 'boss')
    const t = G.bossTuning()
    const info = G.bleedInfo()
    /**
     * ⚠️ **3단계 전환으로 잽니다. 1→2 는 이 시험에 못 씁니다.**
     *    `enemyAI` 에 *"1단계는 색을 몇 가지 보여주기 전에는 안 끝난다"* 는
     *    규칙이 있어서, 체력을 아무리 낮춰도 보스가 **0.75×최대로 되돌려
     *    놓습니다.** 그것도 모르고 두 번을 더 헛짚었습니다 — 두 번 다
     *    게이트가 「페이즈 0 → 0」으로 잡아 줬습니다. 그 되돌림은 `phase===0`
     *    일 때만이므로, **한 단계 넘어간 뒤**에 재면 깨끗합니다.
     */
    G.setHp(b, (G.enemyInfo(b)?.max ?? 0) * (t[2].enterBelow + 0.02))
    for (let i = 0; i < 600; i++) {
      G.step(1, 1 / 60)
      if ((G.enemyInfo(b)?.phase ?? 0) >= 1) break
    }
    G.step(120, 1 / 60) // 그 전환의 무적(1.25초)을 흘려보냅니다
    /**
     * 유예 안쪽(0.5초)으로 연달아 얹어 높이 쌓습니다. 문턱(100)에 안 닿게
     * 여덟 대까지만 — 터져 버리면 0 이 되어 잴 것이 없어집니다.
     */
    for (let i = 0; i < 8; i++) {
      G.hitBleedDummy(b)
      G.step(30, 1 / 60)
    }
    const stacked = G.bleedOf(b)
    // 유예를 다 태웁니다 — **이미 식고 있는 상태**여야 시험이 성립합니다.
    G.step(Math.ceil((info.decayDelay + 0.25) * 60), 1 / 60)
    const beforePhase = G.enemyInfo(b)?.phase ?? -1
    const g0 = G.bleedOf(b)
    /**
     * ⚠️ **두 번 헛짚고서야 실험대가 맞았습니다. 둘 다 게임이 아니라 자였습니다.**
     *
     * ① 경계 바로 위에 세우고 `damageEntity` 로 넘기려 했습니다 → 페이즈가
     *    안 넘어갔습니다(게이트가 「0 → 0」으로 잡아 줬습니다).
     * ② 체력을 경계 아래로 직접 세웠는데도 여전히 「0 → 0」이었습니다.
     *    범인은 **`enemyRoster().maxHp` 로 비율을 계산한 것**입니다. 페이즈는
     *    `Health.max` 를 분모로 쓰는데 그 둘이 같다는 보장이 없습니다 —
     *    실제로 어긋나 있었고, 그래서 「0.70 을 세웠는데 0.75 로 읽히는」
     *    일이 났습니다. **분모는 그 개체에게 물어봅니다**(`enemyInfo().max`).
     *
     * 그리고 게이트도 바꿉니다. 「페이즈가 늘었다」는 무적을 **추론**하는
     * 것이고, `transitionT` 는 무적 그 자체를 **읽는** 것입니다.
     */
    const maxHp = G.enemyInfo(b)?.max ?? 0
    G.setHp(b, maxHp * (t[2].enterBelow - 0.05))
    G.step(2, 1 / 60)
    const gEnter = G.bleedOf(b)
    const midPhase = G.enemyInfo(b)?.phase ?? -1
    const leftT = G.enemyInfo(b)?.transitionT ?? 0
    // 창은 남은 무적보다 **짧게** — 경계에 딱 맞추면 한 프레임 차이가 결과를 뒤집습니다.
    const frames = Math.max(1, Math.round(leftT * 60) - 8)
    G.step(frames, 1 / 60) // 창 A — 무적 **안쪽**에서 끝납니다
    const gA = G.bleedOf(b)
    const midT = G.enemyInfo(b)?.transitionT ?? 0
    /**
     * 남은 무적은 **계산하지 말고 읽으면서** 흘려보냅니다. 프레임 수로
     * 맞추려다 0.05초가 남았고, 게이트가 그걸 잡았습니다 — 창 B 가 무적
     * 자락을 물고 시작하면 「무적이 풀리면 식는다」쪽이 약해집니다.
     */
    for (let i = 0; i < 240 && (G.enemyInfo(b)?.transitionT ?? 0) > 0; i++) G.step(1, 1 / 60)
    G.step(4, 1 / 60)
    const gMid = G.bleedOf(b)
    const outT = G.enemyInfo(b)?.transitionT ?? 0
    G.step(frames, 1 / 60) // 창 B — 같은 길이, 같은 체력, 무적만 없음
    const gB = G.bleedOf(b)
    const inf = G.enemyInfo(b)
    return {
      stacked: Number(stacked.toFixed(1)),
      g0: Number(g0.toFixed(1)),
      gEnter: Number(gEnter.toFixed(1)),
      gA: Number(gA.toFixed(1)),
      gMid: Number(gMid.toFixed(1)),
      midPhase,
      leftT: Number(leftT.toFixed(2)),
      midT: Number(midT.toFixed(2)),
      outT: Number(outT.toFixed(2)),
      gB: Number(gB.toFixed(1)),
      beforePhase,
      afterPhase: inf?.phase ?? -1,
      windowSec: Number((frames / 60).toFixed(2)),
      // 창 B 가 바닥에 닿아 멈춘 것을 「안 식었다」로 오독하지 않도록 함께 냅니다.
      floor: Number(
        (
          info.maxByKind.find((m) => m.id === 'boss').max *
          info.decayFloorRatio *
          (1 - (inf?.hp ?? 0) / (inf?.max ?? 1))
        ).toFixed(1),
      ),
    }
  })
  const lostA = Number((blocked.gEnter - blocked.gA).toFixed(1))
  const lostB = Number((blocked.gMid - blocked.gB).toFixed(1))
  console.log(
    `\n  [등을 맞댄 두 창 ${blocked.windowSec}초] 쌓음 ${blocked.stacked} → 전환 직전 ${blocked.g0} → 전환 직후 ${blocked.gEnter}` +
      `  |  창A(무적) **-${lostA}**  →  창B(무적 풀림) **-${lostB}**  (바닥 ${blocked.floor})\n`,
  )
  check(
    blocked.midPhase > blocked.beforePhase && blocked.midT > 0 && blocked.outT === 0,
    '🚧 창 A 는 **무적 안에서 끝났고** 창 B 는 무적 밖에서 시작했다 (비교의 게이트 — 추론이 아니라 읽은 값)',
    `페이즈 ${blocked.beforePhase} → ${blocked.midPhase} · 무적 남음 A끝 ${blocked.midT}초 · B시작 ${blocked.outT}초`,
  )
  check(
    blocked.g0 < blocked.stacked,
    '🚧 창 A 에 들어갈 때 **이미 식고 있었다** (안 식던 것이 안 식는 건 증거가 아닙니다)',
    `쌓음 ${blocked.stacked} → 전환 직전 ${blocked.g0}`,
  )
  check(
    blocked.gB > blocked.floor + 1,
    '🚧 창 B 가 **바닥에 안 닿고 끝났다** (바닥이 멈춘 것을 규칙의 공으로 적지 않게)',
    `끝 ${blocked.gB} vs 바닥 ${blocked.floor}`,
  )
  check(
    lostA <= 0.01,
    '⏸ **무적인 동안에는 안 식는다** (게임이 손을 묶어 놓고 그 값을 물리지 않습니다)',
    `창A -${lostA}`,
  )
  check(
    lostB > 1,
    '⏸ **무적이 풀리면 다시 식는다** (계약이 사라진 게 아니라 주어가 정해진 것입니다)',
    `창B -${lostB} (같은 체력·같은 바닥)`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 — 아래 숫자는 완결된 것이 아닙니다.
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
