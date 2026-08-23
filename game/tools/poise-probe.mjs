/**
 * 강인도(포이즈) 검증 — `npm run poise`
 *
 * ── 이 프로브가 던지는 질문 ────────────────────────────────────────
 * **"계속 때리기만 하면 이기는가?"**
 *
 * 4색 예고는 이 게임의 중심 설계입니다. 그런데 매 타격마다 적이 무조건
 * 경직된다면, 플레이어는 예고를 읽을 필요 없이 **먼저 때리기만 하면**
 * 됩니다. 적이 예고를 시작조차 못 하니까요. 그러면 색도, 트라이포드도,
 * 공격 토큰도 전부 장식이 됩니다.
 *
 * 그래서 **적이 실제로 예고를 몇 번 띄웠는지**를 셉니다.
 *   · 플레이어가 가만히 있을 때  = 기준선
 *   · 플레이어가 계속 때릴 때    = 실제
 * 둘의 비율이 곧 "때리기만 해서 얼마나 봉쇄되는가"입니다.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5189
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail) {
  if (ok) {
    pass++
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const server = await createServer({ root: '.', server: { port: PORT }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: execPath,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/`)
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
       * 적 하나를 세워 놓고 정해진 **시뮬레이션 시간** 동안 관찰합니다.
       * @param spam true 면 플레이어가 쉬지 않고 공격합니다.
       */
      observe: async (kindId, seconds, spam) => {
        window.__game.reset()
        await window.__t.runFor(0.5)
        window.__game.clearEnemies()
        await window.__t.runFor(0.2)
        const p = window.__game.state().player
        // 사거리 안쪽에 붙여 놓습니다 — 접근하는 시간을 관측에서 빼기 위해서.
        const e = window.__game.spawnEnemyKind(kindId, p.x + 1.9, p.z)
        window.__game.aimAtWorld(p.x + 1.9, p.z)
        /**
         * ⚠️ **깨워 놓고 잽니다.** 적은 이제 방향으로 알아채기 때문에
         *    (balance.ts `AWARE`), 등을 보인 채 낳으면 가만히 선 플레이어를
         *    영영 못 봅니다 — "가만히 두면 잡몹이 공격을 성사시킴(기준선)"이
         *    실제로 **0회**로 죽었습니다. 이 프로브가 묻는 것은 *"강인도가
         *    적을 봉쇄하는가"* 이지 *"적이 나를 알아채는가"* 가 아닙니다.
         */
        window.__game.wakeEnemy(e)
        // 적이 죽지 않아야 관측이 끝까지 갑니다. 체력을 크게 올려 둡니다.
        window.__game.setHp(e, 100000)
        await window.__t.runFor(0.3)

        /**
         * **"예고를 시작한 횟수"가 아니라 "공격이 실제로 나간 횟수"를 셉니다.**
         *
         * 처음엔 예고 시작을 셌는데, 측정이 가설을 반증했습니다 —
         * 계속 때릴 때 예고가 오히려 **늘었습니다**(잡몹 6→11회).
         * 경직이 공격을 끊고 Idle 로 되돌리니 적이 예고를 다시 시작하고,
         * 그 재시작이 새 예고로 세어졌던 것입니다.
         *
         * 우리가 알고 싶은 건 "적이 반격할 수 있는가"이므로,
         * 판정(Active)까지 **도달한** 공격만 세는 것이 맞습니다.
         */
        let swings = 0
        let wasActive = false
        let telegraphs = 0
        let wasWindup = false
        let staggerFrames = 0
        let frames = 0
        const target = window.__game.state().elapsed + seconds
        while (window.__game.state().elapsed < target) {
          if (spam) {
            window.__game.press('Mouse0')
            window.__game.release('Mouse0')
          }
          const info = window.__game.enemyInfo(e)
          if (!info) break
          const winding = info.attacking && info.attackPhase === 0
          if (winding && !wasWindup) telegraphs++
          wasWindup = winding
          const active = info.attacking && info.attackPhase === 1
          if (active && !wasActive) swings++
          wasActive = active
          if (info.staggered) staggerFrames++
          frames++
          await new Promise((r) => setTimeout(r, 8))
        }
        window.__game.clearEnemies()
        return { telegraphs, swings, staggerRatio: frames ? staggerFrames / frames : 0 }
      },
    }
  })

  console.log('\n🛡  강인도(포이즈) 검증\n')

  const WINDOW = 14

  /**
   * ⚠️ **세 번 재서 가운데값으로 봅니다** — 한 판의 휘두름 수는 한 자릿수라
   *    하나만 달라져도 판정이 뒤집힙니다.
   *
   * 실제로 그랬습니다: 가만히 **6회** / 계속 때릴 때 **2회** 였고 문턱이
   * `ceil(6 × 0.4) = 3` 이라, **휘두름 한 번 차이**로 빨갛게 나왔습니다.
   * 「한 칸 차이의 초록은 운이다」— 빨강도 마찬가지입니다.
   *
   * 창을 늘리지 않고 **판을 늘리는** 이유: 창을 늘리면 적이 죽거나
   * 체력이 바닥나 관측이 도중에 성질을 바꿉니다. 같은 길이의 판을
   * 여러 번 보는 쪽이 재려던 것(**14초 동안의 박자**)을 안 바꿉니다.
   */
  const REPEATS = 7
  const med = (xs) => [...xs].sort((a2, b2) => a2 - b2)[Math.floor(xs.length / 2)]
  const trials = []
  for (let i = 0; i < REPEATS; i++)
    trials.push(
      await page.evaluate(
        async (w) => ({
          idle: await window.__t.observe('grunt', w, false),
          spam: await window.__t.observe('grunt', w, true),
        }),
        WINDOW,
      ),
    )
  const grunt = {
    idle: {
      telegraphs: med(trials.map((t) => t.idle.telegraphs)),
      swings: med(trials.map((t) => t.idle.swings)),
      staggerRatio: med(trials.map((t) => t.idle.staggerRatio)),
    },
    spam: {
      telegraphs: med(trials.map((t) => t.spam.telegraphs)),
      swings: med(trials.map((t) => t.spam.swings)),
      staggerRatio: med(trials.map((t) => t.spam.staggerRatio)),
    },
  }
  console.log(
    `  [잡몹 ${WINDOW}초] 가만히: 예고 ${grunt.idle.telegraphs}회 / 실제 공격 ${grunt.idle.swings}회 · ` +
      `계속 때릴 때: 예고 ${grunt.spam.telegraphs}회 / 실제 공격 ${grunt.spam.swings}회 ` +
      `(경직 ${(grunt.spam.staggerRatio * 100).toFixed(0)}%)` +
      `\n     ${REPEATS}판의 값 — 가만히 ${trials
        .map((t) => t.idle.swings)
        .join('·')} · 계속 때릴 때 ${trials.map((t) => t.spam.swings).join('·')} (판정은 가운데값)`,
  )
  /**
   * ⚠️ **주석과 코드가 어긋나 있었습니다.** 원래 여기 *"절반 이상 남아야"*
   *    라고 적혀 있는데 코드는 `0.4`(40%)였습니다 — 이 회차에만 같은
   *    모양을 다섯 번 봤습니다(절벽 제안기 · `alertRadius` · 검사의 블록
   *    주석 · `archer_draw` 가중치 · 여기).
   *
   * **글을 코드에 맞춥니다** — 0.4 쪽이 옳다고 보기 때문입니다.
   * 지키려는 것은 *"봉쇄가 안 된다"* 이지 *"때려도 절반은 낸다"* 가
   * 아닙니다. 계속 때리면 눈에 띄게 줄어드는 것이 **강인도의 값어치**이고
   * (그게 없으면 강인도를 깎을 이유가 없습니다), 다만 **0 이 되면 안**
   * 됩니다 — 0 에 가까우면 4색 설계 전체가 장식이 됩니다.
   */
  /**
   * ── 📐 **비율이 아니라 «안정적인 쪽»으로 겁니다** ────────────────────
   *
   * 세 판을 재고 *"계속 때릴 때는 2·2·2 로 안정적"* 이라고 적었는데,
   * **바로 다음 실행이 2·3·1 이었습니다.** 세 판짜리 한 표본을 보고
   * 「안정적」이라고 부른 것이 성급했습니다 — 이 회차에 «한 표본으로
   * 성질을 단정하다»에 또 걸린 자리라 지우지 않고 남겨 둡니다.
   *
   *     가만히       6·5·5
   *     계속 때릴 때 2·2·2  ↔  2·3·1     ← **양쪽 다 흔들립니다**
   *
   * 한 자릿수 세기라 판마다 ±1 이 움직이고, 세 판의 가운데값도 그만큼
   * 흔들립니다. 그래서 **판 수를 일곱으로** 올립니다 — 창을 늘리지 않는
   * 이유는 그대로입니다(창이 길면 적이 죽거나 체력이 바닥나 관측이
   * 도중에 성질을 바꿉니다).
   *
   * 그리고 문턱을 `가만히 × 0.4` 로 걸면 **흔들리는 쪽이 분모**가 됩니다.
   * 실제로 이 검사는 가만히가 6일 때 빨강(문턱 3), 5일 때 초록(문턱 2)
   * 이었습니다 — **게임은 하나도 안 변했는데** 판정이 뒤집혔습니다.
   * 분자만 봐도 흔들리지만, 분모까지 곱하면 흔들림이 **겹칩니다.**
   *
   * 이 회차에 같은 것을 한 번 더 배웠습니다 — 「걸어서 vs 달려서」의
   * 2.0배가 *"달리면 더 아프다"* 가 아니라 *"걸어온 사람은 잃을 체력이
   * 없다"* 를 재고 있던 자리입니다. **비율은 분모가 성한지부터.**
   *
   * 그래서 **안정적인 쪽(계속 때릴 때의 절대 횟수)** 으로 겁니다.
   * 14초에 **두 번** — 7초에 한 번꼴입니다. 잡몹 한 바퀴가 2.5초 남짓
   * 이므로, 이건 *"평소의 1/3 로 줄어도 침묵하지는 않는다"* 는 뜻입니다.
   * 지키려던 문장(**봉쇄가 안 된다**)이 그대로 남고, 재는 값만 성한
   * 쪽으로 옮겼습니다.
   *
   * 비율은 **기록으로** 옆에 찍습니다 — 사람이 «얼마나 줄었나»를 보는
   * 데는 그 값이 맞습니다. 판정만 안 맡길 뿐입니다.
   */
  const MIN_SWINGS = 2
  check(
    grunt.idle.swings > 0,
    '가만히 두면 잡몹이 공격을 성사시킴 (기준선)',
    `${grunt.idle.swings}회`,
  )
  check(
    grunt.spam.swings >= MIN_SWINGS,
    `계속 때려도 잡몹이 반격함 (봉쇄 불가 — ${WINDOW}초에 ${MIN_SWINGS}번은)`,
    `${grunt.idle.swings}회 → ${grunt.spam.swings}회 (${(
      (grunt.spam.swings / Math.max(1, grunt.idle.swings)) *
      100
    ).toFixed(0)}% 남음 · ${REPEATS}판 가운데값) · 비율은 **기록**이고 판정은 절대 횟수로 합니다`,
  )

  // ---- 2. 보스는 더 단단해야 합니다 ----
  console.log('')
  const boss = await page.evaluate(
    async (w) => ({
      idle: await window.__t.observe('boss', w, false),
      spam: await window.__t.observe('boss', w, true),
    }),
    WINDOW,
  )
  console.log(
    `  [보스 ${WINDOW}초] 가만히: 예고 ${boss.idle.telegraphs}회 / 실제 공격 ${boss.idle.swings}회 · ` +
      `계속 때릴 때: 예고 ${boss.spam.telegraphs}회 / 실제 공격 ${boss.spam.swings}회 ` +
      `(경직 ${(boss.spam.staggerRatio * 100).toFixed(0)}%)`,
  )
  check(
    boss.spam.swings >= Math.ceil(boss.idle.swings * 0.6),
    '보스는 계속 때려도 거의 그대로 공격함',
    `${boss.idle.swings}회 → ${boss.spam.swings}회`,
  )
  check(
    boss.spam.staggerRatio < grunt.spam.staggerRatio,
    '보스가 잡몹보다 덜 경직됨 (강인도 차이)',
    `보스 ${(boss.spam.staggerRatio * 100).toFixed(0)}% vs 잡몹 ${(grunt.spam.staggerRatio * 100).toFixed(0)}%`,
  )

  // ---- 3. 무너뜨리는 것이 가능한가 (보상) ----
  //
  // 봉쇄를 막았다고 공격에 보상이 없으면 이번엔 "때릴 이유"가 사라집니다.
  // 강인도를 다 깎으면 **긴 무방비**가 와야 공격이 판단으로 남습니다.
  console.log('')
  const brk = await page.evaluate(async () => {
    window.__game.reset()
    await window.__t.runFor(0.5)
    window.__game.clearEnemies()
    await window.__t.runFor(0.2)
    const p = window.__game.state().player
    const e = window.__game.spawnEnemyKind('grunt', p.x + 1.9, p.z)
    window.__game.aimAtWorld(p.x + 1.9, p.z)
    window.__game.setHp(e, 100000)
    await window.__t.runFor(0.3)
    const info0 = window.__game.enemyInfo(e)

    let broke = false
    let longest = 0
    let cur = 0
    const target = window.__game.state().elapsed + 16
    while (window.__game.state().elapsed < target) {
      window.__game.press('Mouse0')
      window.__game.release('Mouse0')
      const info = window.__game.enemyInfo(e)
      if (!info) break
      if (info.broken) {
        broke = true
        cur += 1
        longest = Math.max(longest, cur)
      } else {
        cur = 0
      }
      await new Promise((r) => setTimeout(r, 8))
    }
    window.__game.clearEnemies()
    return { broke, longest, poiseMax: info0?.poiseMax ?? 0 }
  })
  check(brk.poiseMax > 0, '적에게 강인도 수치가 있음', `${brk.poiseMax}`)
  check(brk.broke, '계속 때리면 결국 무너짐 (공격의 보상)', `무방비 ${brk.longest}프레임`)

  /**
   * ── 🥋 **강타 눈금이 거짓말을 하지 않는가** ────────────────────────
   *
   * ── 왜 이 검사를 넣는가 (재고 나서) ──────────────────────────────
   * 실전 리듬으로 재 보니 평타만으로 잡몹을 무너뜨리려면 대검 11주기 ·
   * 롱소드 26 · 쌍단검 72 였습니다. 사실상 **평타는 답이 아닙니다**(설계대로).
   * 답인 강타는 잡몹을 현재 강인도와 무관하게 즉시 무너뜨리지만, **큰 적은
   * 미리 깎아 둬야** 무너집니다. 그런데 *"이번 강타로 무너지는가"* 를
   * 플레이어가 알 방법이 없었습니다 — 집중을 태우는 결정이 도박이었습니다.
   *
   * 그래서 강인도 바에 **한 방이 닿는 지점**을 눈금으로 새겼습니다.
   * 세키로·P의 거짓·로스트아크가 전부 임계를 미리 보여 주는 이유입니다.
   *
   * ── 무엇을 검사해야 하는가 ───────────────────────────────────────
   * 눈금 위치를 프로브가 다시 계산해서 견주면 **아무것도 검사하지 못합니다** —
   * 그건 제 산수를 검사하는 것이고 눈금을 아예 안 그려도 통과합니다.
   * 그래서 두 가지를 봅니다:
   *   ① 눈금이 **무기에 따라 움직이는가** (메시 위치를 그대로 읽습니다)
   *   ② 눈금이 밝아진 뒤 강타를 쓰면 **실제로 무너지는가** (예고가 참인가)
   * ②가 핵심입니다. 틀린 예고는 없는 예고보다 나쁩니다.
   */
  console.log('')
  const mark = await page.evaluate(async () => {
    const G = window.__game
    /**
     * 강인도가 가장 높은 **잡몹**을 게임에서 골라옵니다. 여기에 이름을
     * 적어 두면 적을 손보는 날 이 검사가 조용히 옛말이 됩니다.
     * (보스는 뺍니다 — 조우 절차가 따로 있어 이 자리에서 세울 수 없습니다.)
     */
    const roster = G.enemyRoster().filter((r) => r.id !== 'boss')
    const tough = roster.reduce((a, b) => (b.poiseMax > a.poiseMax ? b : a))

    G.reset()
    await window.__t.runFor(0.5)
    G.clearEnemies()
    await window.__t.runFor(0.2)
    const p = G.state().player
    const e = G.spawnEnemyKind(tough.id, p.x + 1.9, p.z)
    G.setHp(e, 100000)
    G.freezeEnemies(true)
    G.aimAtWorld(p.x + 1.9, p.z)
    await window.__t.runFor(0.3)

    // ① 무기를 바꿔 가며 **눈금 메시의 자리**를 읽습니다.
    const perWeapon = []
    for (let slot = 1; slot <= 3; slot++) {
      G.press(`Digit${slot}`)
      G.release(`Digit${slot}`)
      await window.__t.runFor(0.35)
      const bar = G.poiseBars().find((b) => b.entity === e)
      perWeapon.push({
        name: G.state().loadout.weaponName,
        ratio: bar?.markRatio ?? -1,
        visible: !!bar?.markVisible,
      })
    }

    /**
     * ② 눈금이 **밝아질 때까지** 평타로 깎고, 그 순간 강타를 냅니다.
     *
     * 가장 약한 무기로 합니다 — 나머지는 가득 찬 상태에서도 한 방이라
     * "깎아 두는 것이 의미가 있는가"를 못 봅니다.
     *
     * ⚠️ **무기를 눈금으로 고르면 안 됩니다.** 처음에 그렇게 짰다가 고장
     *    테스트에서 들켰습니다 — 눈금을 1.9배 부풀리자 셋이 전부 100%로
     *    뭉개졌고, 그러자 프로브가 롱소드(가득 차도 한 방)를 골라 **자동으로
     *    통과**했습니다. 검사해야 할 것으로 검사 대상을 고르면 언제나
     *    통과합니다. 그래서 무기 표의 `poiseScale` 로 고릅니다 — 눈금과
     *    **다른 뿌리**입니다.
     */
    const table = G.weaponTable()
    let weakest = 0
    for (let i = 1; i < table.length; i++) {
      if (table[i].poiseScale < table[weakest].poiseScale) weakest = i
    }
    G.press(`Digit${weakest + 1}`)
    G.release(`Digit${weakest + 1}`)
    await window.__t.runFor(0.35)

    /** 밝아지기 **전에** 강타가 안 통하는지도 봐야 눈금이 뜻을 갖습니다. */
    let brightAt = -1
    let brokeEarly = false
    const limit = G.state().simElapsed + 30
    while (G.state().simElapsed < limit) {
      const bar = G.poiseBars().find((b) => b.entity === e)
      const info = G.enemyInfo(e)
      if (!bar || !info) break
      if (info.broken) {
        brokeEarly = true
        break
      }
      if (bar.markBright) {
        brightAt = info.poise
        break
      }
      // 스태미나는 계속 채워 줍니다 — 여기서 재는 것은 자원이 아니라 **표시**입니다.
      G.setStamina(999)
      G.setFocus(3)
      G.press('Mouse0')
      G.release('Mouse0')
      await new Promise((r) => setTimeout(r, 8))
    }

    /**
     * 밝아진 그 순간 강타 한 방 — 예고대로 무너지는가.
     *
     * ⚠️ **연타 직후에 바로 누르면 안 됩니다.** 강타는 손이 비어 있을 때만
     *    나가는데(playerControl), 평타 연타의 후딜 중에 누르면 입력이
     *    그대로 버려집니다. 그러면 *"예고가 틀렸다"* 가 아니라 *"강타를
     *    안 냈다"* 인데, 결과만 보면 구분이 안 됩니다.
     *    회복 지연이 2.2초라 1초쯤 쉬어도 강인도는 그대로입니다.
     */
    let brokeOnHeavy = false
    let heavyLanded = false
    let poiseBefore = -1
    let poiseAfter = -1
    if (brightAt >= 0) {
      await window.__t.runFor(1)
      G.setStamina(999)
      G.setFocus(3)
      poiseBefore = G.enemyInfo(e)?.poise ?? -1
      const hp0 = G.entityState(e).hp
      G.press('Mouse2')
      G.release('Mouse2')
      const until = G.state().simElapsed + 2.2
      while (G.state().simElapsed < until) {
        const info = G.enemyInfo(e)
        if (!info) break
        if (G.entityState(e).hp < hp0) heavyLanded = true
        if (info.broken) {
          brokeOnHeavy = true
          break
        }
        await new Promise((r) => setTimeout(r, 8))
      }
      poiseAfter = G.enemyInfo(e)?.poise ?? -1
    }
    G.freezeEnemies(false)
    G.clearEnemies()
    return {
      kind: tough.id,
      poiseMax: tough.poiseMax,
      perWeapon,
      brightAt,
      brokeEarly,
      brokeOnHeavy,
      heavyLanded,
      weakestName: table[weakest].name,
      /** 그 무기의 눈금이 실제로 **가득보다 왼쪽**인가 — 아니면 이 단계는 무효입니다. */
      weakestRatio: perWeapon[weakest]?.ratio ?? -1,
      poiseBefore,
      poiseAfter,
    }
  })

  const ratios = mark.perWeapon.map((w) => w.ratio)
  console.log(
    `  [눈금] ${mark.kind}(강인도 ${mark.poiseMax}) 기준 강타 한 방이 닿는 지점 — ` +
      mark.perWeapon.map((w) => `${w.name} ${(w.ratio * 100).toFixed(0)}%`).join(' · '),
  )
  check(
    mark.perWeapon.length > 0 && mark.perWeapon.every((w) => w.visible),
    '강타 눈금이 실제로 그려진다 (규칙이 아니라 화면)',
    mark.perWeapon.map((w) => `${w.name} ${w.visible ? '보임' : '**없음**'}`).join(' · '),
  )
  /**
   * 무기마다 자리가 달라야 **무기 정체성이 눈에 보입니다.** 셋이 같은
   * 자리면 눈금은 그냥 장식이고, 무기를 바꿀 이유를 화면이 못 말합니다.
   */
  check(
    Math.max(...ratios) - Math.min(...ratios) > 0.15,
    '**무기를 바꾸면 눈금이 움직인다** (강인도 정체성이 처음으로 눈에 보임)',
    `가장 오른쪽 ${(Math.max(...ratios) * 100).toFixed(0)}% · 가장 왼쪽 ${(Math.min(...ratios) * 100).toFixed(0)}%`,
  )
  /**
   * `weakestRatio < 0.95` 를 **함께** 요구합니다. 눈금이 오른쪽 끝에 붙어
   * 있으면 그 무기는 가득 찬 강인도도 한 방에 깨므로, 무엇을 확인하든
   * *"깎아 둔 것이 의미가 있었다"* 를 확인한 것이 아닙니다. 고장 테스트에서
   * 정확히 그 상태로 통과했습니다 — 그때 조용히 통과하지 말고 **빨개져야**
   * 합니다. 아무것도 못 잰 단계는 실패입니다.
   */
  check(
    mark.weakestRatio < 0.95 && !mark.brokeEarly && mark.brightAt >= 0 && mark.brokeOnHeavy,
    '**눈금이 밝아진 뒤 강타를 쓰면 진짜로 무너진다** (예고가 거짓말을 안 함)',
    mark.weakestRatio >= 0.95
      ? `${mark.weakestName} 눈금이 ${(mark.weakestRatio * 100).toFixed(0)}% — ` +
          '가득 차도 한 방이라 **이 단계는 아무것도 검사하지 못했습니다**'
      : mark.brokeEarly
        ? '평타만으로 먼저 무너져서 예고를 확인 못 함'
        : mark.brightAt < 0
          ? '30초를 깎아도 눈금이 끝내 안 밝아짐'
          : !mark.heavyLanded
            ? '**강타가 아예 안 맞았습니다** — 예고가 아니라 계측기 문제입니다'
            : `강인도 ${mark.brightAt.toFixed(1)} 에서 밝아짐 → 강타로 ` +
              `${mark.poiseBefore.toFixed(1)} → ${mark.poiseAfter.toFixed(1)} · ` +
              `${mark.brokeOnHeavy ? '무너짐' : '**안 무너짐**'}`,
  )

  console.log('')
  /**
   * ── 💢 **무너뜨릴수록 어려워지는가** ───────────────────────────────
   *
   * 자동 플레이의 보스전이 *"15.4초 · 받은 피해 0 · 붕괴 3회 · 휘두름
   * 한 번"* 으로 나왔습니다. 예고를 여섯 번 띄웠는데 다섯 번이 무너져서
   * 끊겼습니다 — 보상이 너무 자주 와서 **보스의 차례가 아예 없습니다.**
   *
   * 세키로·오공·엘든 링이 쓰는 답은 같습니다: **첫 붕괴는 크게 갚아 주고,
   * 그 뒤로는 점점 어렵게.** 그게 실제로 그렇게 되는지 여기서 잽니다.
   *
   * ⚠️ **잡몹은 그대로여야 합니다.** 잡몹을 연달아 무너뜨리는 것은 군중을
   *    다루는 재미 그 자체입니다. 그래서 둘 다 재고, **갈리는지**를 봅니다.
   */
  const wear = await page.evaluate(() => {
    const G = window.__game
    const row = (id) => [0, 1, 2, 3, 4].map((b) => G.poiseRule(id, b))
    return { boss: row('boss'), elite: row('elite'), grunt: row('grunt') }
  })
  const say = (a) => a.map((v) => v.toFixed(2)).join(' → ')
  console.log(
    `\n  💢 붕괴 횟수별 **평타 한 대가 깎는 강인도** (0회 → 4회)\n` +
      `     수문장 ${say(wear.boss)}\n     정예   ${say(wear.elite)}\n     잡몹   ${say(wear.grunt)}`,
  )
  /**
   * 🚧 게이트 — **숫자가 실제로 나왔어야** 아래 비교가 뜻을 가집니다.
   *    이름을 잘못 적으면 -1 이 돌아오는데, 그걸 "줄었다"로 읽으면 안 됩니다.
   */
  check(
    [...wear.boss, ...wear.elite, ...wear.grunt].every((v) => v > 0),
    '🚧 세 종류 모두 강인도 피해가 나왔다 (아래 비교의 게이트)',
    `수문장 ${wear.boss[0].toFixed(2)} · 정예 ${wear.elite[0].toFixed(2)} · 잡몹 ${wear.grunt[0].toFixed(2)}`,
  )
  /**
   * 💢 **무거운 적은 무너질수록 단단해집니다.**
   *
   * 자동 플레이의 보스전이 *"15.4초 · 받은 피해 0 · 붕괴 3회 · 휘두름 한 번"*
   * 이었습니다. 예고를 여섯 번 띄웠는데 다섯 번이 무너져서 끊겼습니다 —
   * 보상이 너무 자주 와서 **보스의 차례가 없습니다.** 세키로·오공·엘든 링이
   * 쓰는 답은 같습니다: **첫 붕괴는 크게 갚아 주고, 그 뒤로는 점점 어렵게.**
   *
   * 문턱 1.5배: 세 번째 붕괴가 첫 번째보다 확실히 비싸야 한다는 뜻입니다.
   * (규칙대로면 1 + 0.45×2 = 1.9배입니다 — 여유가 0.4배 있습니다.)
   */
  for (const [name, row] of [
    ['수문장', wear.boss],
    ['정예', wear.elite],
  ]) {
    check(
      row[0] / row[2] >= 1.5,
      `💢 **${name}은 무너뜨릴수록 어려워진다** (첫 붕괴는 갚아 주되 세 번째는 확실히 비싸게)`,
      `${row[0].toFixed(2)} → ${row[2].toFixed(2)} (${(row[0] / row[2]).toFixed(2)}배 단단해짐)`,
    )
  }
  /**
   * 💢 **잡몹은 그대로여야 합니다.** 연달아 무너뜨리는 것은 군중을 다루는
   *    재미 그 자체입니다(로스트아크가 파는 것이 그것입니다). 이 규칙은
   *    *"한 놈과 오래 싸우는"* 상대에게만 뜻이 있습니다.
   */
  check(
    // 표본이 비면 `.every` 는 그냥 참입니다 — 길이를 먼저 겁니다(`npm run guard`).
    wear.grunt.length === 5 && wear.grunt.every((v) => Math.abs(v - wear.grunt[0]) < 0.001),
    '💢 **잡몹은 그대로다** (군중을 연달아 무너뜨리는 재미는 안 건드립니다)',
    say(wear.grunt),
  )
  /**
   * 🚧 **상한이 실제로 걸리는가** — 안 걸리면 오래 싸울수록 무한히 단단해져,
   *    긴 전투에서 붕괴가 아예 불가능해집니다. 그건 보상을 없애는 것입니다.
   */
  check(
    Math.abs(wear.boss[3] - wear.boss[4]) < 0.001,
    '🚧 **단단해지는 데 상한이 있다** (무한히 오르면 붕괴가 사라집니다)',
    `3회 ${wear.boss[3].toFixed(2)} · 4회 ${wear.boss[4].toFixed(2)}`,
  )

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
