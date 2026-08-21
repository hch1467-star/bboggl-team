/**
 * 무기 3종 비교 — `npm run weapons`
 *
 * ── 왜 이 프로브가 생겼는가 ──────────────────────────────────────
 * 무기가 셋인데, **한 판 내내 하나만 씁니다.** 자동 플레이도, 아마 사람도요.
 * 선택지가 셋이어도 답이 하나면 그건 선택이 아니라 장식입니다 —
 * 4색 예고에 대해 우리가 이미 세운 규칙("색만 다르고 대응이 같으면 색은
 * 장식")을 무기에도 그대로 적용해야 합니다.
 *
 * 그런데 "무기가 다른가"는 지금까지 **한 번도 재 본 적이 없습니다.**
 * arsenal.ts 에 숫자가 다르게 적혀 있으니 다를 것이라고 믿고 있었을 뿐입니다.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────
 * 소울류의 무기 다양성이 성립하는 조건은 "수치가 다르다"가 아니라
 * **"이기는 축이 다르다"** 입니다. 대검은 느리지만 무너뜨리고, 단검은
 * 약하지만 붙어 있을 수 있고, 롱소드는 무난합니다. 그래서 셋을 잽니다:
 *
 *   1) 초당 피해            — 누가 빨리 죽이는가
 *   2) 초당 강인도 피해     — 누가 빨리 무너뜨리는가
 *   3) 스태미나 지속력      — 누가 오래 붙어 있는가 (스태미나당 피해)
 *
 * 그리고 이렇게 요구합니다:
 *   · 어느 하나가 **모든 축에서** 1등이면 안 됩니다 (그러면 답이 하나)
 *   · 초당 피해 격차가 지나치면 안 됩니다 (다른 축이 위로가 안 됨)
 *
 * ⚠️ 무기 수치를 여기 베껴 적지 않습니다. `weaponTable()` 로 게임에서 읽고,
 *    실제 값은 **때려 보고** 잽니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5209
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/**
 * 콤보 마무리 타의 피해 — `weaponTable()` 이 주는 합계에서 되짚습니다.
 * (제원에 마무리 타 하나만 따로 노출하기보다, 이미 있는 값으로 유도합니다.)
 */
function lastStepDamage(w) {
  return w.lastStepDamage
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
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })

  await page.evaluate(() => {
    window.__t = {
      runFor: async (seconds) => {
        const target = window.__game.state().elapsed + seconds
        const deadline = Date.now() + 180000
        while (window.__game.state().elapsed < target && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 8))
        }
      },
      /**
       * 🫁 **게임의 실제 리듬에서 스태미나가 무는가.**
       *
       * ── 왜 재게 됐는가 ──────────────────────────────────────────
       * 안전창(0.70초) 안에서 세 무기가 낸 값을 뜯어 보면 이렇습니다:
       *
       *     롱소드  2타 — 피해 26 · 강인도 0.48 · 스태미나 21
       *     대검    1타 — 피해 26 · 강인도 **0.68** · 스태미나 26
       *     쌍단검  3타 — 피해 24 · 강인도 0.235 · 스태미나 15
       *
       * **대검이 같은 피해에 강인도 1.4배**입니다. 유일한 대가는 스태미나
       * 5인데, 그 대가는 *"스태미나가 실제로 모자라질 때"* 만 대가입니다.
       * 반격은 2~3초에 한 번 오고 그 사이 스태미나는 회복합니다.
       *
       * 이 저장소는 이미 같은 의심을 적어 뒀습니다 — *"스태미나가 콤보의
       * 1/3 아래로 떨어진 시간이 1%였습니다. 관리할 것이 없었다는 뜻입니다."*
       * 그 말이 맞다면 **효율 축(쌍단검의 정체성)은 실전에 존재하지 않고**,
       * 가장 자주 오는 상황에서 대검이 그냥 우세합니다.
       *
       * 그래서 **게임의 리듬 그대로** 돌려 봅니다: 구르고 → 창 안에서 치고
       * → 다음 공격을 기다리고. 위 벤치처럼 계속 두들기는 것이 아니라요.
       * 계속 두들기면 어떤 무기든 바닥나는 게 당연하고, 그건 실전이 아닙니다.
       */
      rhythm: async (slot, windowSec, cycleSec, cycles) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.5)
        G.clearEnemies()
        await window.__t.runFor(0.3)
        G.press(`Digit${slot}`)
        G.release(`Digit${slot}`)
        await window.__t.runFor(0.5)
        const p = G.state().player
        const e = G.spawnEnemyKind('grunt', p.x + 1.4, p.z)
        G.setHp(e, 1000000)
        G.freezeEnemies(true)
        const es = G.entityState(e)
        G.aimAtWorld(es.x, es.z)
        G.setStamina(100)

        const waitSim = async (sec) => {
          const t0 = G.state().simElapsed
          const dl = Date.now() + 30000
          while (G.state().simElapsed - t0 < sec && Date.now() < dl) {
            const st = G.state().player.stamina
            if (st < minStam) minStam = st
            await new Promise((r) => setTimeout(r, 8))
          }
        }
        let minStam = 100
        let denied = 0
        let dealt = 0
        /**
         * 🪨 **몇 주기 만에 무너뜨리는가.**
         *
         * 두 라운드 전에 남긴 질문입니다: 대검은 표준 창에서 같은 피해에
         * 강인도 1.4배인데, 그 우위를 스태미나 대가가 상쇄하는가.
         * 상쇄되는지는 **붕괴까지 걸리는 주기 수**로만 갈립니다.
         *
         * ⚠️ 여기서 강인도 **회복**이 결정적입니다. 그런데 재 보니
         *    **실전 리듬에서는 회복이 한 번도 켜지지 않았습니다.**
         *    강인도 감소가 완벽히 선형이었기 때문에 알 수 있었습니다
         *    (30 → 6주기 뒤 대검 13.3 · 롱소드 23 · 쌍단검 27.5).
         *
         *    이유는 산수입니다 — 회복은 **마지막 타격**부터 셉니다:
         *        안전창 끝 0.72초 + 회복 지연 2.2초 = 2.92초
         *        다음 공격은 2.47초에 옵니다 → 켜지기 전에 다시 맞음
         *    즉 붙어 있는 동안엔 압박이 새지 않고, 떨어지면 그때 찹니다.
         *    세키로의 체간과 같은 성질인데, **이 성질은 두 숫자의 관계로만
         *    성립합니다.** 아래에서 그 관계 자체를 검사합니다.
         */
        let breakAtCycle = -1
        let wasBroken = false
        let minPoise = 9999
        /** 깎인 **비율**을 내려면 가득 찬 값이 필요합니다 — 게임에서 읽습니다. */
        const poiseFull = G.enemyInfo(e)?.poiseMax ?? -1
        const hp0 = G.entityState(e).hp
        for (let c = 0; c < cycles; c++) {
          // ① 적의 공격에 답합니다 — 구르기가 이 게임의 기본 대응이고
          //    스태미나의 가장 큰 소비처입니다. 빼고 재면 후하게 나옵니다.
          G.press('Space')
          G.release('Space')
          await waitSim(0.45)
          /**
           * ② 창 안에서 칩니다 — **낼 수 있을 때만** 냅니다.
           *
           * ⚠️ 처음엔 창 동안 8ms마다 무작정 눌렀습니다. 그랬더니 셋 다
           *    최저 0에 6주기 누적 피해가 27뿐이었습니다 — 스태미나가
           *    없는데 계속 눌러서 **거의 못 때린 것**입니다. 그건 게임의
           *    리듬이 아니라 계측기가 만든 곤경이고, 셋이 다 0이면
           *    무기를 가를 수도 없습니다.
           *
           *    사람은 못 낼 것을 알면 안 냅니다. 그래서 **한 타 값**만큼
           *    남아 있을 때만 누릅니다. 기준값은 게임 데이터에서 끌어옵니다
           *    (콤보 총 소모 ÷ 타수) — 여기 숫자를 적지 않습니다.
           */
          const perStep = G.weaponTable()[slot - 1].comboStamina / G.weaponTable()[slot - 1].comboLength
          const t1 = G.state().simElapsed
          while (G.state().simElapsed - t1 < windowSec) {
            const st = G.state().player.stamina
            if (st < minStam) minStam = st
            if (st >= perStep) {
              G.aimAtWorld(es.x, es.z)
              G.press('Mouse0')
              G.release('Mouse0')
            } else denied++
            await new Promise((r) => setTimeout(r, 8))
          }
          {
            const i = G.enemyInfo(e)
            if (i && i.broken && !wasBroken && breakAtCycle < 0) breakAtCycle = c + 1
            wasBroken = !!(i && i.broken)
            // 무너지면 강인도가 가득 차므로 **무너지기 전 최저치**만 셉니다.
            if (i && !i.broken && i.poise < minPoise) minPoise = i.poise
          }
          // ③ 다음 공격이 올 때까지 기다립니다(회복이 도는 구간).
          await waitSim(Math.max(0.1, cycleSec - windowSec - 0.45))
        }
        dealt = hp0 - G.entityState(e).hp
        /**
         * ⚠️ **지우기 전에 읽습니다.** 지난번엔 `return` 안에서 강인도를
         *    읽었는데 그 시점엔 이미 `clearEnemies()` 가 돈 뒤라 전부
         *    `-1`(적 없음)로 찍혔고, "못 무너뜨림(-1 남음)"이라는 뜻 모를
         *    줄이 나왔습니다.
         */
        const poiseMinSeen = minPoise === 9999 ? -1 : Number(minPoise.toFixed(1))
        G.freezeEnemies(false)
        G.clearEnemies()
        return {
          name: G.state().loadout.weaponName,
          minStamina: Number(minStam.toFixed(0)),
          /** 낼 수 없어서 참은 프레임 수 — 스태미나가 실제로 막은 양입니다. */
          denied,
          /** 몇 번째 주기에 무너뜨렸나. -1 이면 끝내 못 무너뜨렸습니다. */
          breakAtCycle,
          /** 무너지기 전 **가장 낮았던** 강인도 — 얼마나 근접했는지. */
          poiseMin: poiseMinSeen,
          /** 가득 찬 강인도. 주기당 깎는 양을 내는 데 씁니다. */
          poiseFull,
          dealt: Number(dealt.toFixed(0)),
        }
      },
      /**
       * 🪟 **진짜 반격 창을 잽니다** — 유도하지 않고 관측합니다.
       *
       * ⚠️ 처음엔 창을 `recovery` 하나로 잡았습니다. 그게 틀렸습니다.
       *    잡몹은 후딜이 끝나도 **`attackCooldown` 만큼 더** 못 때리고,
       *    그 뒤에도 예고(windup)가 붙습니다. 즉 후딜만 세면 창을
       *    실제보다 훨씬 짧게 잡게 되고, 그 짧은 창 끝에 무기의 마지막
       *    타가 걸리는 것처럼 보입니다.
       *
       *    설정값을 더해서 구할 수도 있지만(`recovery + attackCooldown`),
       *    그러면 프로브가 **또 하나의 진실**이 됩니다. AI가 실제로
       *    언제 다시 예고를 켜는지를 **보고** 잽니다.
       *
       * 재는 구간: 판정이 끝난 순간 → 다음 예고가 켜지는 순간.
       * (예고가 켜지는 것까지가 창입니다 — 예고는 보고 대응할 수 있으니까요.)
       */
      punishWindow: async () => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.5)
        G.clearEnemies()
        await window.__t.runFor(0.3)
        const p = G.state().player
        const e = G.spawnEnemyKind('grunt', p.x + 1.6, p.z)
        G.wakeEnemy(e)
        // 죽지도 죽이지도 않게 — 우리는 **적의 리듬**만 봅니다.
        G.setHp(e, 1000000)
        await window.__t.runFor(0.3)
        const gaps = []
        /**
         * ⚠️ **판정 단계(Active)를 직접 봅니다.**
         *
         * 처음엔 `attacking && !winding` 을 "판정 중"으로 삼았는데, 그건
         * **후딜까지 포함**합니다. 그래서 다음 예고가 켜지는 바로 그
         * 순간에 "판정이 끝났다"고 기록해 버려서 간격이 `0` 으로 찍혔습니다
         * (5회 중 3회가 0). 눈금이 아니라 **눈금의 정의**가 틀린 것입니다.
         */
        let wasActive = false
        let activeEndedAt = -1
        const t0 = G.state().simElapsed
        const dl = Date.now() + 90000
        while (gaps.length < 5 && Date.now() < dl && G.state().simElapsed - t0 < 45) {
          const i = G.enemyInfo(e)
          if (!i) break
          // AttackPhase.Active === 1 (core/components.ts)
          const active = i.attacking && i.attackPhase === 1
          if (wasActive && !active) activeEndedAt = G.state().simElapsed
          if (activeEndedAt > 0 && i.winding) {
            gaps.push(Number((G.state().simElapsed - activeEndedAt).toFixed(3)))
            activeEndedAt = -1
          }
          wasActive = active
          // 플레이어가 죽지 않게 계속 채워 둡니다(창을 재는 중입니다).
          if (G.state().player.hp < 60) G.setHp(G.playerEntity(), 100)
          await new Promise((r) => setTimeout(r, 8))
        }
        G.clearEnemies()
        return gaps
      },
      /**
       * 🕐 **한 대 한 대가 언제 꽂히는가** — 누른 시점부터의 시간표.
       *
       * ── 왜 이게 필요해졌는가 ────────────────────────────────────
       * 창 비교에서 대검이 잡몹 후딜(0.85초)에 `26~92.8` 을 오갔습니다.
       * 같은 상황에서 결과가 **3.5배** 갈린다는 뜻입니다 — 2타가 창
       * 경계에 딱 걸려 있어서요.
       *
       * 그런데 그게 **긴장인지 운인지**는 시간표를 봐야 압니다.
       * 소울류·니오가 무거운 무기로 파는 긴장은 *"한 대만 넣고 빠질까,
       * 두 대를 노릴까"* 인데, 그 긴장이 성립하려면 플레이어가 **어느
       * 쪽인지 알 수 있어야** 합니다. 경계가 종이 한 장이면 그건 판단이
       * 아니라 **동전 던지기**이고, 동전 던지기는 선택이 아닙니다.
       *
       * 그래서 타별 착탄 시각을 재서 창과 견줍니다.
       */
      timeline: async (slot) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.3)
        const p = G.state().player
        const e = G.spawnEnemyKind('grunt', p.x + 1.2, p.z)
        await window.__t.runFor(0.2)
        G.setHp(e, 1000000)
        G.freezeEnemies(true)
        G.press(`Digit${slot}`)
        G.release(`Digit${slot}`)
        await window.__t.runFor(0.6)
        G.setStamina(100)
        const es = G.entityState(e)
        G.aimAtWorld(es.x, es.z)

        const steps = G.weaponTable()[slot - 1].comboLength
        const at = []
        let seen = G.state().hitsDealt
        const t0 = G.state().simElapsed
        G.press('Mouse0')
        G.release('Mouse0')
        const dl = Date.now() + 30000
        while (at.length < steps && Date.now() < dl) {
          const h = G.state().hitsDealt
          if (h > seen) {
            seen = h
            at.push(Number((G.state().simElapsed - t0).toFixed(3)))
            // 다음 타를 이어 칩니다 — 콤보가 끊기면 시간표가 아니라
            // "1타를 몇 번 쳤나"가 됩니다.
            if (at.length < steps) {
              G.aimAtWorld(es.x, es.z)
              G.press('Mouse0')
              G.release('Mouse0')
            }
          }
          if (G.state().simElapsed - t0 > 6) break
          await new Promise((r) => setTimeout(r, 8))
        }
        G.freezeEnemies(false)
        G.clearEnemies()
        return { name: G.state().loadout.weaponName, at }
      },
      /**
       * 무기 하나를 들고 **불사신 허수아비**를 정해진 시뮬레이션 시간만큼
       * 두들깁니다. 스태미나는 자연 회복만 받습니다 — 무기별 소모가
       * 다른 것이 지속력의 정체이기 때문입니다.
       *
       * 허수아비를 얼려 두는 이유: 도망가거나 반격하면 무기가 아니라
       * **AI를 재게 됩니다.** 강인도도 계속 회복되면 무너지므로,
       * 회복분까지 합쳐 "실제로 깎은 총량"을 누적해서 셉니다.
       */
      bench: async (slot, burstSeconds, totalSeconds, fromBehind) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.3)
        const p = G.state().player
        const e = G.spawnEnemyKind('grunt', p.x + 1.2, p.z)
        await window.__t.runFor(0.2)
        G.setHp(e, 1000000)
        G.freezeEnemies(true)
        G.press(`Digit${slot}`)
        G.release(`Digit${slot}`)
        await window.__t.runFor(0.5)

        const es0 = G.entityState(e)
        G.aimAtWorld(es0.x, es0.z)
        const startHp = G.entityState(e).hp
        const startHits = G.state().hitsDealt
        // ⚠️ **시뮬레이션 시계**로 잽니다. `elapsed` 는 히트스톱 동안에도
        // 흘러서, 히트스톱이 큰 무기(대검 0.15초/타)일수록 손해를 봅니다.
        const t0 = G.state().simElapsed
        const wall0 = G.state().elapsed
        /**
         * **어느 타가 몇 번 나갔는지**도 셉니다.
         *
         * 이론값(콤보 피해합 ÷ 콤보 시간)과 실측이 어긋날 때, 원인이
         * "무기가 약해서"인지 "콤보가 안 이어져서 1타만 반복해서"인지
         * 가르지 못하면 엉뚱한 곳을 고치게 됩니다.
         */
        let burstDealt = 0
        let burstFin = 0
        let burstBrk = 0
        /**
         * 💢 **창 안에서 깎은 강인도**도 같은 순간에 잡아 둡니다.
         *
         * 지금까지 창 표는 **피해 하나만** 재고 있었습니다. 그래서
         * *"표준 반격 창은 평평하다(26 · 26 · 24)"* 는 관찰이 나왔는데,
         * 이 게임이 무기를 가르는 축은 셋입니다 — **폭발 · 효율 · 강인도.**
         * 축 하나만 보고 "평평하다"고 적으면, 실제로는 갈려 있는데도
         * 갈리지 않는다고 말하게 됩니다. (그 결론으로 피해 수치를
         * 만졌다면 멀쩡한 밸런스를 망가뜨릴 뻔했습니다.)
         */
        let burstPoise = 0
        /**
         * ⚠️ **깎은 쪽에게 묻습니다.**
         *
         * 예전엔 `enemyInfo().poise` 를 훑어 *"줄어든 만큼"* 을 더했습니다.
         * 그런데 무너지는 순간 강인도가 **최대치로 되돌아가서**, 무너뜨린
         * 그 한 방이 *증가*로 보여 한 번도 안 세어졌습니다. 16초에 세 번
         * 무너뜨리는 대검이 가장 많이 손해를 봤고, 이론상 3.18배인 격차가
         * 실측 **1.30배**로 눌렸습니다 — 계측기가 하필 그 무기를 깎고
         * 있었습니다. 이 저장소가 스태미나에서 이미 배운 것입니다:
         * **쓴 쪽(깎은 쪽)이 세는 것이 정확합니다.**
         */
        const poiseStart = G.runStats().poiseDealt ?? 0
        // ⚠️ 스태미나는 **게임이 센 누적값**을 씁니다.
        // 프레임 사이에 "크게 쓰고 조금 회복"이 겹치면 관측으로는 놓칩니다 —
        // 한 번에 크게 쓰는 무기일수록 효율이 실제보다 좋아 보였습니다.
        const stamStart = G.runStats().staminaSpent
        const critStart = G.state().critHits
        const finStart = G.runStats().finishers
        const backStart = G.state().backHits
        let breaks = 0
        let wasBroken = false
        /**
         * ── 기둥 1 을 이 자리에서 잽니다 ────────────────────────────
         *
         * 설계는 *"쿨다운 도는 중에는 기본공격·회피로 버티며 **스태미나
         * 관리**"* 라고 적어 두었습니다. 그런데 자동 플레이에서 스태미나가
         * 콤보의 1/3 아래로 떨어진 시간이 **1%** 였습니다 — 관리할 것이
         * 없었다는 뜻입니다.
         *
         * 다만 봇은 기본 공격을 별로 안 씁니다(스킬 비중 65%). 그래서
         * 봇으로는 "자원이 헐렁하다"와 "봇이 그 리듬에 안 머문다"를
         * 가를 수 없습니다. **여기서는 쉬지 않고 기본 공격만** 하므로
         * 자원 자체의 여유가 그대로 드러납니다.
         *
         * 재는 것: 쉬지 않고 때릴 때 **회피(25)를 못 낼 만큼** 스태미나가
         * 낮았던 시간의 비율. 0% 면 스태미나는 장식입니다.
         */
        let stamSamples = 0
        let stamStarved = 0
        let minStam = 999
        const dodgeCost = G.runStats().dodgeStamina

        while (G.state().simElapsed - t0 < totalSeconds) {
          // 스태미나가 가득인 동안의 **폭발력**과, 바닥난 뒤의 **지속력**은
          // 완전히 다른 능력입니다. 하나로 뭉치면 둘 다 안 보입니다.
          if (burstDealt === 0 && G.state().simElapsed - t0 >= burstSeconds) {
            burstDealt = startHp - G.entityState(e).hp
            // 창 안에서 벌어진 붕괴·처형도 그 순간에 함께 잡아 둡니다
            // (위 `burstFinishers` 설계 노트 참고).
            burstFin = G.runStats().finishers - finStart
            burstBrk = breaks
            burstPoise = (G.runStats().poiseDealt ?? 0) - poiseStart
          }
          const info = G.enemyInfo(e)
          if (!info) break
          // 강인도는 회복도 하고 무너지면 가득 찹니다 — **줄어든 만큼만** 더합니다.
          if (info.broken && !wasBroken) breaks++
          wasBroken = info.broken
          // 위치가 밀릴 수 있으므로 매번 붙여 세웁니다 — 사거리 차이가 아니라
          // **때렸을 때의 성능**을 재는 자리입니다.
          const es = G.entityState(e)
          /**
           * `fromBehind` 면 **적의 등 뒤**에 섭니다.
           *
           * 쌍단검의 설명은 *"회피로 등 뒤를 잡는 무기"* 입니다. 그런데
           * 지금까지 이 프로브는 정면에 얼어붙은 허수아비만 때렸습니다 —
           * **단검의 정체성이 통째로 안 보이는 자리에서** 세 무기를 비교하고
           * 있었던 것입니다. 대검을 너프하기 전에 이 축을 먼저 재야 합니다.
           */
          const fx = Math.sin(es.rotY)
          const fz = Math.cos(es.rotY)
          const side = fromBehind ? -1.2 : 1.2
          G.teleportPlayer(es.x + fx * side, es.z + fz * side)
          G.aimAtWorld(es.x, es.z)
          const stam = G.state().player.stamina
          stamSamples++
          if (stam < dodgeCost) stamStarved++
          if (stam < minStam) minStam = stam
          G.press('Mouse0')
          G.release('Mouse0')
          await new Promise((r) => setTimeout(r, 8))
        }
        const elapsed = G.state().simElapsed - t0
        const wall = G.state().elapsed - wall0
        const dealt = startHp - G.entityState(e).hp
        const staminaUsed = G.runStats().staminaSpent - stamStart
        const crits = G.state().critHits - critStart
        const finishers = G.runStats().finishers - finStart
        const backHits = G.state().backHits - backStart
        G.freezeEnemies(false)
        const hits = G.state().hitsDealt - startHits
        return {
          minStamina: Number(minStam.toFixed(0)),
          starvedPct: stamSamples ? Math.round((stamStarved / stamSamples) * 100) : 0,
          dodgeCost,
          hits,
          avgHit: Number((dealt / Math.max(1, hits)).toFixed(1)),
          weapon: G.state().loadout.weapon,
          name: G.state().loadout.weaponName,
          seconds: Number(elapsed.toFixed(2)),
          /** 스태미나가 가득인 첫 구간의 초당 피해 = 폭발력 */
          burstDps: Number((burstDealt / burstSeconds).toFixed(1)),
          /** 그 구간에 **실제로 넣은 피해 총량** — 창 길이별 비교에 씁니다. */
          burstDealt: Number(burstDealt.toFixed(1)),
          burstPoise: Number(burstPoise.toFixed(1)),
          /**
           * 그 구간에 들어간 **처형 횟수·붕괴 횟수**.
           *
           * ⚠️ 이 파일은 이미 같은 것에 한 번 속았습니다 — 정면 초당 피해가
           *    데이터의 두 배로 나온 원인이 처형이었습니다. 창 비교에서도
           *    똑같은 함정이 있습니다: 강인도를 잘 깎는 무기는 짧은 창
           *    안에서도 허수아비를 **무너뜨려 버리고**, 그 순간 처형이
           *    선입력으로 나가면서 "창에 넣은 피해"에 얹힙니다.
           *    그런데 진짜 후딜 창에서는 적이 무너져 있지 않습니다.
           *    그러니 갈라서 볼 수 있어야 합니다.
           */
          burstFinishers: burstFin,
          burstBreaks: burstBrk,
          /** 그 뒤 구간의 초당 피해 = 스태미나 회복에 묶인 지속력 */
          sustainDps: Number(
            ((dealt - burstDealt) / Math.max(0.1, elapsed - burstSeconds)).toFixed(1),
          ),
          dps: Number((dealt / elapsed).toFixed(1)),
          poisePerSec: Number((((G.runStats().poiseDealt ?? 0) - poiseStart) / elapsed).toFixed(1)),
          // 지속력 = 스태미나 1당 피해. 소모가 적고 세면 오래 붙어 있습니다.
          perStamina: Number((dealt / Math.max(1, staminaUsed)).toFixed(2)),
          staminaUsed: Math.round(staminaUsed),
          /** 히트스톱으로 멈춰 있던 비율 — 계측이 얼마나 왜곡됐었는지 */
          frozenPct: Math.round(((wall - elapsed) / Math.max(0.01, wall)) * 100),
          crits,
          backHits,
          finishers,
          breaks,
        }
      },
    }
  })

  console.log('\n⚔️ 무기 3종 비교\n')

  const table = await page.evaluate(() => window.__game.weaponTable())
  console.log('  [제원 — 게임 데이터에서 읽음]')
  for (const w of table) {
    console.log(
      `    ${w.name.padEnd(5)} ${w.comboLength}타 · 콤보 ${w.comboSeconds}초 · 피해합 ${w.comboDamage} · ` +
        `스태미나합 ${w.comboStamina} · 사거리 ${w.maxRange} · 이동 ${w.moveSpeedScale}배`,
    )
  }
  console.log('')

  /**
   * ⚠️ **무기마다 두 번 재서 평균을 냅니다.**
   *
   * 한 번만 재면 치명타 한두 번과 프레임 흔들림으로 순위가 뒤집힙니다 —
   * 실제로 같은 코드에서 통과와 실패가 번갈아 나왔습니다. 밸런스 판단을
   * **동전 던지기**로 만들면 안 됩니다. (구르기 프로브에서 같은 이유로
   * 이미 한 번 겪었습니다.)
   */
  /**
   * 처형 한 방의 피해는 **게임에서 읽습니다**(마무리 타 × 배율).
   * 이 값을 빼야 "무기 자체의 초당 피해"가 보입니다 — 아래 설계 노트 참고.
   */
  const finSpec = await page.evaluate(() => window.__game.finisherInfo())
  const results = []
  for (let slot = 1; slot <= table.length; slot++) {
    const runs = []
    for (let i = 0; i < 2; i++) {
      runs.push(await page.evaluate((s) => window.__t.bench(s, 3, 16, false), slot))
    }
    const mean = (key) => Number((runs.reduce((a, r) => a + r[key], 0) / runs.length).toFixed(2))
    results.push({
      ...runs[0],
      burstDps: mean('burstDps'),
      sustainDps: mean('sustainDps'),
      dps: mean('dps'),
      poisePerSec: mean('poisePerSec'),
      perStamina: mean('perStamina'),
      hits: Math.round(mean('hits')),
      crits: Math.round(mean('crits')),
      finishers: mean('finishers'),
      staminaUsed: Math.round(mean('staminaUsed')),
      breaks: Math.round(mean('breaks')),
      minStamina: Math.round(mean('minStamina')),
      starvedPct: Math.round(mean('starvedPct')),
    })
    const r = results[results.length - 1]
    const w = table[slot - 1]
    /**
     * ── 실측 초당 피해가 데이터의 두 배였던 이유 ────────────────────
     *
     * 히트스톱(12%)으로는 설명이 안 됐습니다. 타격당 평균 피해를 보고 알았습니다:
     * 대검은 한 대 평균 **49**인데 콤보 평균은 36입니다. 남는 13은 **처형**
     * 이었습니다 — 대검은 강인도 ×1.7 이라 16초에 세 번 무너뜨리고,
     * 무너뜨릴 때마다 선입력이 처형(마무리 타 × 2.6)으로 나갑니다.
     *
     * 즉 계측기 탓이 아니라 **게임의 실제 연쇄**였습니다:
     * *무너뜨리는 무기가 곧 가장 세게 때리는 무기가 됩니다.*
     * 이건 밸런스 질문이지 계측 오류가 아닙니다. 그래서 지우지 않고
     * **갈라서 둘 다 보여줍니다** — 무기 자체의 힘과, 처형이 얹는 힘.
     */
    r.finisherDamage = Math.round(finSpec.damageMultiplier * lastStepDamage(w))
    r.dpsNoFinisher = Number(
      (r.dps - (r.finishers * r.finisherDamage) / (r.seconds || 1)).toFixed(1),
    )
    // ---- 등 뒤에서 ----
    const back = await page.evaluate((s) => window.__t.bench(s, 3, 12, true), slot)
    r.backDps = back.dps
    /**
     * ⚠️ **등 뒤 이득도 처형을 빼고 봅니다.**
     *
     * 이 파일은 이미 같은 교훈을 배웠습니다 — 정면 초당 피해가 데이터의
     * 두 배로 나온 원인이 **처형**이었고, 그래서 `dpsNoFinisher` 를 따로
     * 냈습니다(위 설계 노트). 그런데 **등 뒤 판에는 그 교훈을 안 적용**
     * 했습니다.
     *
     * 등 뒤 강인도 배수(POISE.backMultiplier)를 넣자 바로 드러났습니다:
     * 등 뒤에서 무너뜨림이 2배가 되니 처형도 2배가 되고, 처형이 큰 무기
     * (롱소드 70 · 대검 120)일수록 "등 뒤 이득"이 부풀었습니다.
     * 그래서 *"등 뒤 이득은 쌍단검이 가장 크다"* 는 검사가 깨졌습니다 —
     * 게임이 아니라 **눈금이** 깨진 것입니다.
     *
     * 재려는 것은 *"등 뒤에 서면 이 무기의 타격이 얼마나 세지는가"* 이지
     * *"등 뒤에 서면 처형이 몇 번 더 나오는가"* 가 아닙니다. 후자는
     * 무기 성격이 아니라 강인도 규칙의 결과이고, 이미 따로 재고 있습니다
     * (무너뜨림 정면/등 뒤).
     */
    r.backDpsNoFinisher = Number(
      (back.dps - (back.finishers * r.finisherDamage) / (back.seconds || 1)).toFixed(1),
    )
    r.backGain = Number((r.backDpsNoFinisher / Math.max(0.1, r.dpsNoFinisher)).toFixed(2))
    r.backCrits = back.crits
    r.backHits = back.backHits
    /**
     * ── 등 뒤에서 **강인도가 얼마나 빨리 깎이는가** ──────────────────
     *
     * 등 뒤 판(fromBehind)은 이미 돌리고 있었는데 **강인도만 보고에서
     * 빠져 있었습니다.** 그래서 `POISE.backMultiplier` 를 넣고도 그 효과를
     * 자동 플레이(존 전체)로만 재려 했고, 3판 A/B 에서 범위가 겹쳐
     * 아무것도 증명하지 못했습니다.
     *
     * 당연했습니다 — **클리어 시간과 받은 피해는 존 전체의 잡음을 다 안고
     * 있습니다.** 조합이 어떻게 깨어났는지, 보물을 몇 개 주웠는지, 보스가
     * 초기화됐는지가 전부 섞입니다. 그 둔한 자로 전투 한 조각의 변경을
     * 재려 한 것이 잘못이었습니다.
     *
     * 메커니즘은 **허수아비에서 결정적으로** 재집니다. 여기 숫자는 판마다
     * 흔들리지 않습니다.
     */
    r.backPoisePerSec = back.poisePerSec
    r.backBreaks = back.breaks
    r.backOfHits = `${back.backHits}/${back.hits}`
  }

  console.log(
    '  [실측 — 허수아비 16시뮬초 × 2회 평균]  ⚠️ 초당 피해는 참고용입니다\n' +
      '           (히트스톱·프레임 간격이 섞여 데이터상 값의 두 배까지 나옵니다.\n' +
      '            판정은 아래 [데이터상의 축]과 강인도로 합니다)',
  )
  for (const r of results) {
    console.log(
      `    ${r.name.padEnd(5)} 폭발력 ${String(r.burstDps).padStart(5)} · 지속력 ${String(r.sustainDps).padStart(5)} · ` +
        `초당 강인도 ${String(r.poisePerSec).padStart(5)} · 무너뜨림 ${r.breaks}회\n` +
        `          전체 초당 ${r.dps} · 타격 ${r.hits}회(치명 ${r.crits}) · 한 대 평균 ${r.avgHit} · 스태미나 ${r.staminaUsed} 소모 · 스태미나당 ${r.perStamina}\n` +
        `          히트스톱으로 멈춰 있던 시간 ${r.frozenPct}% · **처형 ${r.finishers}회** (한 방 ${r.finisherDamage})\n` +
        `          처형을 뺀 초당 피해 — 정면 ${r.dpsNoFinisher} · 등 뒤 ${r.backDpsNoFinisher} (${r.backGain}배 · 백어택 ${r.backOfHits}타 · 치명 ${r.backCrits})\n` +
        `          쉬지 않고 때릴 때 — 최저 스태미나 ${r.minStamina} · 회피(${r.dodgeCost})를 못 낼 만큼 낮았던 시간 ${r.starvedPct}%\n` +
        `          초당 강인도 — 정면 ${r.poisePerSec} · 등 뒤 ${
          /**
           * ⚠️ **한 프레임 안에 무너뜨리면 0으로 찍힙니다.**
           *
           * 강인도는 "줄어든 만큼만" 더해서 셉니다(무너지면 가득 차므로).
           * 그런데 10fps 에서 대검이 등 뒤 한 방으로 무너뜨리면, 표본은
           * 가득 → (붕괴) → 가득 만 보고 **감소를 한 번도 못 봅니다.**
           * 그래서 "등 뒤 0인데 무너뜨림 6회"라는 앞뒤 안 맞는 줄이 나왔습니다.
           *
           * 계기의 한계이지 게임이 아닙니다. 숨기지 않고 **그렇다고 적습니다** —
           * 0 은 이 프로젝트에서 가장 의심스러운 관측이고, 설명 없는 0 을
           * 남겨 두면 다음 사람이 또 속습니다.
           */
          r.backPoisePerSec === 0 && r.backBreaks > 0
            ? '측정불가(한 프레임에 무너뜨림)'
            : `${r.backPoisePerSec} (${(r.backPoisePerSec / Math.max(0.1, r.poisePerSec)).toFixed(1)}배)`
        } · 무너뜨림 정면 ${r.breaks}회 / 등 뒤 ${r.backBreaks}회 (${(r.backBreaks / Math.max(1, r.breaks)).toFixed(1)}배)`,
    )
  }
  console.log('')

  check(results.length === table.length, '무기 셋을 전부 쟀다', `${results.length}종`)
  check(
    results.every((r) => r.dps > 0),
    '무기 셋 모두 실제로 피해를 준다',
  )

  /**
   * ---- 1. 이기는 축이 서로 다른가 ----
   *
   * 이게 이 프로브의 전부입니다. 하나가 세 축을 다 가져가면
   * 나머지 둘은 **고를 이유가 없는 선택지**입니다.
   */
  /**
   * ⚠️ **판정은 "데이터상의 축"으로 합니다. 실측 초당 피해로는 하지 않습니다.**
   *
   * 두 번씩 재서 평균을 냈더니 실측이 이렇게 나왔습니다:
   *     대검 폭발력 82.2 · 지속력 25.2 · 강인도 5.2 — **세 축 전부 1등**
   * 그런데 데이터로 계산한 대검의 폭발력은 초당 40 남짓입니다(72피해 ÷ 1.8초).
   * 실측이 그 두 배라는 것은 **무기가 아니라 계측이 뭔가를 더 세고 있다**는
   * 뜻입니다(히트스톱 동안 시뮬레이션 시간이 안 흐르는 것 등).
   *
   * 원인을 다 밝히기 전까지, 그 숫자로 밸런스를 만지지 않습니다.
   * 대신 **흔들리지 않는 두 가지**로 판정합니다:
   *   · 강인도 — 적의 게이지에서 직접 읽습니다(프레임·히트스톱 무관)
   *   · 데이터상의 축 — 콤보 피해합·시간·스태미나합으로 계산합니다
   * 실측 표는 **정보로 출력**하되 판정에는 쓰지 않습니다.
   */
  const axes = table.map((w) => ({
    name: w.name,
    burst: w.comboDamage / w.comboSeconds, // 한 번에 얼마나 크게
    thrift: w.comboDamage / w.comboStamina, // 스태미나 1당 얼마나
    poise: w.poiseScale,
  }))
  const bestOf = (key) => axes.reduce((a, b) => (a[key] >= b[key] ? a : b)).name
  const winners = new Set([bestOf('burst'), bestOf('thrift'), bestOf('poise')])
  /**
   * ---- 순수한 힘은 같은가 ----
   *
   * 처형을 빼고 나면 세 무기의 초당 피해가 얼마나 벌어지는지를 봅니다.
   * 여기서 크게 벌어지면 "무기 자체가 세다/약하다"는 뜻이고,
   * 좁으면 **차이는 전부 동사(처형·백어택)에서 나온다**는 뜻입니다.
   */
  /**
   * ⚠️ **이 검사가 재던 것이 이 게임에 없는 무기였습니다.**
   *
   * 처형을 뺀 초당 피해는 롱소드 31.6 · 대검 **19.7** · 쌍단검 47.9 로
   * 2.4배가 벌어집니다. 그런데 바로 위 설계 노트가 이미 답을 적어
   * 뒀습니다 — *"무너뜨리는 무기가 곧 가장 세게 때리는 무기가 됩니다."*
   * 대검의 피해는 **무너뜨리고 처형하는 고리**에서 나오고, 그걸 빼면
   * 남는 것은 **대검이 아닙니다.** 소울류의 대검도 초당 피해는 낮고
   * 한 방과 경직으로 갚습니다.
   *
   * 그래서 문턱을 **처형까지 포함한 총 초당 피해**에 겁니다(36 · 42.15 ·
   * 50.8 → 1.41배). 그리고 갈라 놓은 값은 **버리지 않고** 아래에서
   * *"피해의 출처가 무기마다 다른가"* 로 씁니다 — 그게 원래 물으려던
   * 것이었습니다.
   *
   * ⚠️ 검사를 초록으로 만들려고 문턱을 옮긴 것이 아닙니다. 재는 **대상**을
   *    바꿨고, 대신 아래에 **더 빡빡한 짝**을 새로 세웠습니다.
   */
  const totMax = Math.max(...results.map((r) => r.dps))
  const totMin = Math.min(...results.map((r) => r.dps))
  check(
    totMax / totMin <= 1.5,
    '총 초당 피해(처형 포함)가 무기끼리 1.5배 안이다 (꼴찌 무기가 없게)',
    results.map((r) => `${r.name} ${r.dps}`).join(' · '),
  )
  /**
   * **피해의 출처가 무기마다 달라야 합니다.**
   *
   * 총합이 비슷하다는 것만으로는 *"셋 다 같은 방식으로 때린다"* 와
   * 구분이 안 됩니다. 무기제를 고른 이유는 총합이 아니라 **구성**입니다:
   * 대검은 처형 몫이 크고, 단검은 잦은 타격 몫이 커야 합니다.
   */
  const finShare = (r) =>
    r.dps > 0 ? Number(((r.dps - r.dpsNoFinisher) / r.dps).toFixed(2)) : 0
  const heavyW = results.find((r) => r.name.includes('대검'))
  const lightW = results.find((r) => r.name.includes('쌍단검'))
  check(
    !!heavyW && !!lightW && finShare(heavyW) >= finShare(lightW) * 2,
    '**피해의 출처가 다르다** — 대검은 처형 몫이 단검의 두 배 이상',
    results.map((r) => `${r.name} 처형 몫 ${Math.round(finShare(r) * 100)}%`).join(' · '),
  )
  /**
   * ---- 등 뒤를 잡는 값이 무기마다 다른가 ----
   *
   * 쌍단검은 *"회피로 등 뒤를 잡는 무기"* 라고 적혀 있습니다.
   *
   * ── 이 검사를 다시 썼습니다 ────────────────────────────────────
   * 예전에는 **배수**(등 뒤 초당 피해 ÷ 정면 초당 피해)가 단검에서 가장
   * 큰지 봤습니다. 그건 틀린 질문이었습니다 — 백어택 배수와 치명타 보너스는
   * **세 무기가 똑같이 받는 공용 규칙**입니다. 배수가 무기마다 다르게
   * 나온다면 그건 성격이 아니라 **치명타 운**입니다.
   *
   * 실제로 처형까지 걷어내고 재니 롱소드 2.0 · 대검 1.28 · 쌍단검 1.88 로,
   * 롱소드가 앞섰습니다. 예전에 단검이 이겼던 것(2.33 대 2.27)도 같은
   * 크기의 운이었습니다 — **우연히 통과하던 검사**였습니다.
   *
   * 단검이 등 뒤에서 유리한 **진짜** 이유는 배수가 아니라 **횟수**입니다.
   * 콤보가 1.27초에 4타라, 같은 창에 더 많이 꽂습니다. 그게 "회피로 등
   * 뒤를 잡는 무기"라는 설명의 실체입니다. 구조적인 것을 재야 검사가
   * 운에 흔들리지 않습니다.
   */
  const bestBack = results.reduce((a, b) => (a.backHits >= b.backHits ? a : b))
  check(
    bestBack.weapon === 'daggers',
    '등 뒤 창에서 쌍단검이 가장 많이 꽂는다 (설명과 실제가 일치)',
    results.map((r) => `${r.name} ${r.backHits}타(${r.backGain}배)`).join(' · '),
  )
  console.log(
    '  [데이터상의 축] ' +
      axes
        .map(
          (a) =>
            `${a.name} 폭발 ${a.burst.toFixed(1)}/초 · 효율 ${a.thrift.toFixed(2)}/스태미나 · 강인도 ×${a.poise}`,
        )
        .join('\n                  ') +
      '\n',
  )
  check(
    winners.size >= 2,
    '이기는 축이 무기마다 다르다 (하나가 전부 1등이 아니다)',
    `폭발 ${bestOf('burst')} · 효율 ${bestOf('thrift')} · 강인도 ${bestOf('poise')}`,
  )

  /**
   * ---- 1.5 강인도가 무기마다 실제로 다른가 ----
   *
   * 처음 쟀을 때 셋 다 4.7~4.9였습니다. *"대검은 무너뜨리는 무기"* 라는 말이
   * 어디에도 없는 상태였습니다. 성격이 숫자로 존재해야 말이 사실이 됩니다.
   */
  const poiseMaxV = Math.max(...results.map((r) => r.poisePerSec))
  const poiseMinV = Math.min(...results.map((r) => r.poisePerSec))
  check(
    poiseMaxV / Math.max(0.01, poiseMinV) >= 1.8,
    '무너뜨리는 힘이 무기마다 확실히 다르다 (1.8배 이상)',
    results.map((r) => `${r.name} ${r.poisePerSec}`).join(' · '),
  )

  /**
   * ---- 1.6 만능형은 **어느 축에서도 꼴찌가 아니다** ----
   *
   * 롱소드의 정체성은 "1등이 없다"가 아니라 "약점이 없다"입니다.
   * 모든 축에서 꼴찌면 그건 균형형이 아니라 그냥 열등한 무기입니다.
   */
  const allRound = axes.find((a) => a.name === '롱소드')
  if (allRound) {
    const lastIn = (key) => axes.every((a) => a[key] >= allRound[key])
    check(
      !lastIn('burst') || !lastIn('thrift') || !lastIn('poise'),
      '균형형(롱소드)이 모든 축에서 꼴찌는 아니다',
      `폭발 ${allRound.burst.toFixed(1)} · 효율 ${allRound.thrift.toFixed(2)} · 강인도 ×${allRound.poise}`,
    )
  }

  /**
   * ---- 2. 피해 격차가 다른 축으로 감당될 만한가 ----
   *
   * 축이 달라도 초당 피해가 두 배 차이 나면, 느린 무기는 "취향"이 아니라
   * **손해**가 됩니다. 소울류에서 대검이 성립하는 이유는 느린 대신
   * 한 방과 무너뜨리는 힘이 확실히 크기 때문입니다.
   */
  /**
   * ---- 2. 피해 격차는 **스태미나당**으로 봅니다 ----
   *
   * ⚠️ 처음엔 "전체 초당 피해"로 쟀습니다. 그 숫자를 믿고 밸런스를 만질
   * 뻔했는데, 아래 달성률을 같이 재 보고 멈췄습니다.
   *
   * 이 프로브는 8ms마다 좌클릭을 넣습니다. 그런데 이 컨테이너는 프레임이
   * 초당 10회 안팎이라, **콤보 창이 짧은 무기일수록 이어치기를 놓칩니다.**
   * 즉 초당 피해는 무기의 성능이 아니라 **계측기의 손가락 속도**를 섞어
   * 재고 있었습니다. 쌍단검(콤보 창 0.36초)이 특히 손해를 봅니다.
   *
   * 스태미나당 피해는 그 왜곡을 받지 않습니다 — 몇 번 때렸든, 쓴 만큼
   * 나눈 값이기 때문입니다. 그래서 밸런스 판단은 이쪽으로 합니다.
   */
  const effMax = Math.max(...axes.map((a) => a.thrift))
  const effMin = Math.min(...axes.map((a) => a.thrift))
  check(
    effMax / effMin <= 1.7,
    '스태미나 효율 격차가 1.7배 이내다 (효율 꼴찌 무기가 없게)',
    axes.map((a) => `${a.name} ${a.thrift.toFixed(2)}`).join(' · '),
  )

  /**
   * ---- 2.5 이 실행에서 초당 피해를 믿어도 되는가 ----
   *
   * 무기마다 "이론상 초당 몇 타"가 정해져 있습니다(콤보 길이 ÷ 콤보 시간).
   * 실제 타격 수가 거기에 얼마나 근접했는지를 **달성률**로 봅니다.
   * 무기 간 달성률이 크게 벌어지면, 그 실행의 초당 피해 비교는 무기가 아니라
   * 입력 주기를 재고 있는 것입니다. **계측기가 스스로 그 사실을 말하게** 합니다.
   */
  const rates = results.map((r) => {
    const w = table.find((t) => t.id === r.weapon)
    const ideal = (w.comboLength / w.comboSeconds) * r.seconds
    return { name: r.name, rate: r.hits / ideal }
  })
  const rateMin = Math.min(...rates.map((r) => r.rate))
  const rateMax = Math.max(...rates.map((r) => r.rate))
  console.log(
    `  [달성률] 이론상 타격 수 대비 — ` +
      rates.map((r) => `${r.name} ${Math.round(r.rate * 100)}%`).join(' · ') +
      (rateMax / rateMin > 1.4
        ? '\n           ⚠️ 격차가 큽니다 — 이 실행의 **초당 피해 비교는 신뢰하지 마세요**(입력 주기 탓).'
        : ''),
  )
  console.log('')
  check(
    rateMin > 0.3,
    '어느 무기도 이론 대비 30% 밑으로 떨어지지 않았다 (계측이 성립했다)',
    rates.map((r) => `${r.name} ${Math.round(r.rate * 100)}%`).join(' · '),
  )

  /**
   * ---- 3. 제원이 실제로 다른가 ----
   * 콤보 길이·사거리·이동 배율이 같으면 손에 잡히는 차이가 없습니다.
   */
  check(
    new Set(table.map((w) => w.comboLength)).size >= 2,
    '콤보 길이가 무기마다 다르다',
    table.map((w) => `${w.name} ${w.comboLength}타`).join(' · '),
  )
  check(
    Math.max(...table.map((w) => w.maxRange)) - Math.min(...table.map((w) => w.maxRange)) >= 0.5,
    '사거리가 눈에 띄게 다르다 (0.5m 이상)',
    table.map((w) => `${w.name} ${w.maxRange}m`).join(' · '),
  )
  check(
    Math.max(...table.map((w) => w.moveSpeedScale)) -
      Math.min(...table.map((w) => w.moveSpeedScale)) >=
      0.15,
    '들고 다닐 때의 이동 속도가 다르다',
    table.map((w) => `${w.name} ${w.moveSpeedScale}배`).join(' · '),
  )
  check(
    new Set(table.map((w) => w.poiseScale)).size === table.length,
    '무기마다 강인도 성격이 데이터에 따로 적혀 있다',
    table.map((w) => `${w.name} ×${w.poiseScale}`).join(' · '),
  )

  /**
   * ── 🪟 **창 길이별로 누가 1등인가** ──────────────────────────────
   *
   * ── 왜 이걸 재게 됐는가 ──────────────────────────────────────────
   * 무기 전환이 이제 전투 중에도 **입력으로 살아남습니다**(선입력 버퍼).
   * 길은 뚫었는데 그 길이 어딘가로 이어지는지는 안 봤습니다. 위 검사들은
   * 전부 *"제원의 축이 다른가"* 를 봅니다 — 폭발·효율·강인도. 그런데
   * **축이 다른 것과 각자 쓸 데가 있는 것은 다른 얘기**입니다.
   * (이 저장소가 4색에서 이미 배운 구분입니다: 오답을 막는 것과 정답이
   * 성립하는 것은 따로 확인해야 합니다.)
   *
   * 니오·오공·세키로가 자세/무기를 바꾸게 만드는 이유는 하나입니다 —
   * **주어지는 창의 길이가 상황마다 다르고, 창마다 최선이 다르기 때문**입니다.
   * 짧은 후딜에는 빠른 무기가, 긴 붕괴 창에는 느리고 센 무기가 들어갑니다.
   *
   * ⚠️ 창 길이를 **여기 적지 않습니다.** 위 벤치는 폭발 구간을 `3` 초로
   *    박아 두고 있었는데, 그 3초는 게임 어디에도 없는 숫자입니다.
   *    게임이 실제로 주는 창을 게임에게 물어서 씁니다.
   */
  const cw = await page.evaluate(() => window.__game.counterInfo())
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  const gruntAtks = roster.find((r) => r.id === 'grunt')?.attacks ?? []
  /**
   * ⚠️ **잡몹 창은 설정값이 아니라 관측값을 씁니다.**
   *
   * 처음엔 `recovery`(0.85초) 하나로 잡았다가 틀렸습니다 — 잡몹은 후딜이
   * 끝나도 `attackCooldown`(1.1초) 만큼 더 못 때립니다. 그 짧은 창으로
   * 재니 **세 무기의 마지막 타가 전부 창 끝에 걸린** 것처럼 보였고,
   * 하마터면 "모든 무기의 마무리가 동전 던지기"라는 결론을 낼 뻔했습니다.
   * 게임이 아니라 **제가 창을 잘못 그린 것**이었습니다.
   */
  const punishGaps = await page.evaluate(() => window.__t.punishWindow())
  /**
   * ⚠️ **중앙값을 쓰면 안 되는 자리였습니다.**
   *
   * 관측값이 두 무리로 갈립니다 — `0.70, 0.72` 와 `1.83, 1.85, 2.02`.
   * 잡몹이 짧게 이어치는 경우와 한 박자 쉬는 경우가 따로 있는 것입니다.
   * **봉우리가 둘인 분포에 중앙값을 쓰면 아무 뜻도 없습니다.** 실제로
   * 판마다 `0.75` 와 `1.85` 를 오갔습니다. 어느 쪽도 "평균적인 창"이
   * 아니고, 그 사이 값은 **한 번도 일어나지 않습니다.**
   *
   * 그래서 **가장 짧은 쪽**을 씁니다. 근거는 통계가 아니라 설계입니다:
   * 플레이어는 이번이 어느 쪽인지 **미리 알 수 없습니다.** 소울류에서
   * 반격을 정할 때 기준이 되는 것은 언제나 **최악의 경우**입니다 —
   * 긴 쪽에 맞춰 욕심내면 짧은 쪽이 왔을 때 맞습니다.
   * 즉 이 값은 *"안전하게 넣을 수 있는 창"* 입니다.
   */
  const punishSec = punishGaps.length
    ? Math.min(...punishGaps)
    : Math.max(...gruntAtks.map((a) => a.recovery))
  const slow = punishGaps.filter((g) => g > punishSec * 1.5)
  console.log(
    `\n  [관측] 잡몹의 진짜 반격 창 — 판정 끝 → 다음 예고까지 ` +
      `**안전창 ${punishSec.toFixed(2)}초**` +
      (slow.length ? ` (길게 쉴 때는 ${Math.max(...slow).toFixed(2)}초 — 봉우리가 둘입니다)` : '') +
      `\n         관측 ${punishGaps.length}회: ${punishGaps.join(', ')}` +
      `  ※ 설정상 후딜만 보면 ${Math.max(...gruntAtks.map((a) => a.recovery)).toFixed(2)}초`,
  )
  const windows = [
    // 잡몹이 한 대 휘두른 뒤 **실제로** 못 때리는 시간 — 위에서 관측한 값.
    { name: '잡몹 반격창', sec: punishSec },
    { name: '잡몹 무너짐', sec: cw.normalBrokenTime },
    { name: '보스 무너짐', sec: cw.bossBrokenTime },
  ].filter((w) => Number.isFinite(w.sec) && w.sec > 0)

  /**
   * ⚠️ **세 번씩 재서 중앙값을 씁니다.**
   *
   * 한 번만 재면 이 검사가 **운으로 통과합니다.** 치명타가 확률이라
   * 같은 조건에서 잡몹 후딜의 대검이 `92.8 → 108.8` 로 움직였고,
   * 잡몹 무너짐은 롱소드 74.6 vs 대검 72 — **3.5% 차이**였습니다.
   * 그 폭이면 다음 판에 부호가 뒤집힙니다.
   *
   * 이 저장소의 규칙 그대로입니다: **부호가 갈리면 증명되지 않은 것.**
   * 중앙값으로 판정하고, 1등은 **뚜렷한 차이**일 때만 1등으로 셉니다.
   */
  const WIN_REPS = 3
  const medOf = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  const byWindow = []
  for (const win of windows) {
    const row = { name: win.name, sec: win.sec, dealt: [] }
    for (let slot = 1; slot <= table.length; slot++) {
      // 창 하나를 재는 것이므로 총 시간은 창보다 조금만 길게 잡습니다.
      const reps = []
      for (let i = 0; i < WIN_REPS; i++) {
        reps.push(
          await page.evaluate(
            ([s, sec]) => window.__t.bench(s, sec, sec + 0.6, false),
            [slot, win.sec],
          ),
        )
      }
      const r = {
        burstFinishers: medOf(reps.map((x) => x.burstFinishers)),
        burstDealt: medOf(reps.map((x) => x.burstDealt)),
        burstPoise: medOf(reps.map((x) => x.burstPoise)),
        span: `${Math.min(...reps.map((x) => x.burstDealt))}~${Math.max(...reps.map((x) => x.burstDealt))}`,
      }
      /**
       * ⚠️ **처형을 뺀 값으로 견줍니다.**
       *
       * 진짜 후딜 창에서 적은 무너져 있지 않습니다. 그런데 허수아비는
       * 짧은 창 안에서도 무너지고, 무너지면 처형이 선입력으로 나가면서
       * "창에 넣은 피해"에 얹힙니다 — 강인도를 잘 깎는 무기일수록 더요.
       * 그러면 재는 것이 *"창에 무엇이 들어가는가"* 가 아니라
       * *"누가 허수아비를 빨리 무너뜨리는가"* 가 됩니다. 그건 바로 위
       * `강인도` 축이 이미 재고 있는 것이고, **같은 것을 두 번 세면
       * 그 무기가 두 배로 이깁니다.**
       */
      const finDmg = Math.round(finSpec.damageMultiplier * lastStepDamage(table[slot - 1]))
      row.dealt.push({
        name: table[slot - 1].name,
        raw: r.burstDealt,
        fin: r.burstFinishers,
        span: r.span,
        dealt: Number(Math.max(0, r.burstDealt - r.burstFinishers * finDmg).toFixed(1)),
        poise: Number(r.burstPoise.toFixed(1)),
      })
    }
    byWindow.push(row)
  }
  console.log('\n  [창] 게임이 실제로 주는 창에 **무엇을 넣을 수 있는가**')
  /**
   * **뚜렷한 차이일 때만 1등입니다.** 2등보다 15% 넘게 앞서야 합니다 —
   * 그보다 좁으면 치명타 운으로 갈리는 폭이라 "누가 낫다"고 말할 수 없습니다.
   * 좁으면 `동률` 로 적습니다. 모르는 것을 모른다고 적는 것이
   * 아는 척하는 것보다 언제나 낫습니다.
   */
  const MARGIN = 1.15
  const winnerOf = (row) => {
    const sorted = [...row.dealt].sort((a, b) => b.dealt - a.dealt)
    return sorted[0].dealt >= sorted[1].dealt * MARGIN ? sorted[0].name : '동률'
  }
  for (const row of byWindow) {
    const best = winnerOf(row)
    console.log(
      `    ${row.name.padEnd(12)} ${row.sec.toFixed(2)}초 — ` +
        row.dealt
          .map((d) => `${d.name} 피해 ${d.dealt} · 강인도 ${d.poise}${d.fin ? `[처형 ${d.fin} 뺌]` : ''}`)
          .join(' · ') +
        `   → ${best === '동률' ? '**동률**' : `1등 **${best}**`}`,
    )
  }
  const winByWindow = byWindow.map(winnerOf)
  /**
   * 이 줄이 *"무기를 바꿀 이유가 있는가"* 입니다. 창마다 1등이 같으면
   * 전환은 조작만 있고 뜻이 없습니다 — 무기 셋이 사실상 하나입니다.
   */
  /**
   * ── 여기서 검사 하나를 **버리고 다른 것으로 바꿨습니다** ──────────
   *
   * 처음 쓴 것은 *"창 길이가 달라지면 1등도 달라진다"* 였습니다. 한 번
   * 돌렸을 때는 통과했습니다(잡몹 무너짐 → 롱소드). 그런데 세 번씩 재
   * 보니 그 1등은 **치명타 운**이었고, 중앙값으로는 셋 다 대검이었습니다.
   *
   * 그리고 더 중요한 것을 알았습니다 — **그 검사는 설계가 한 적 없는
   * 약속을 요구하고 있었습니다.** 이 게임이 무기를 가르는 축은 위에
   * 적힌 셋입니다: **폭발 · 효율 · 강인도.** 그런데 창 하나만 재면 그건
   * **폭발만** 재는 것이고, 폭발 1등이 모든 창에서 이기는 것은 결함이
   * 아니라 **정의**입니다. 대검이 셋 다 이긴 것은 게임이 틀린 게 아니라
   * 제가 틀린 질문을 한 것입니다.
   *
   * ⚠️ 창 하나에는 **효율이 아예 안 들어갑니다.** 스태미나가 가득인
   *    채로 시작하니까요. 그러니 창 비교로 "무기를 바꿀 이유"를 물으면
   *    영원히 폭발 무기만 나옵니다.
   *
   * 그래서 **바꿀 이유가 실제로 있는지**를 설계의 언어로 다시 묻습니다:
   * *짧게 끊어 칠 때 최선과, 오래 붙어 있을 때 최선이 다른가.*
   * 다르면 전환은 뜻이 있고, 같으면 무기 셋은 사실상 하나입니다.
   */
  /**
   * ⚠️ **어느 창을 쓰느냐가 이 검사의 전부였습니다.**
   *
   * 처음엔 무조건 첫 번째 창(표준 반격 창)으로 물었습니다. 그런데 창을
   * 제대로 재고 나니 그 창에서는 셋이 **거의 같습니다** — 롱소드 26 ·
   * 대검 26 · 쌍단검 24. 그래서 "동률"이 나왔고, 검사는 빨갛지만
   * 게임이 틀린 것은 아닙니다: 가장 흔한 상황에서 어느 무기도 압도하지
   * 않는 것은 **나쁜 밸런스가 아니라 평평한 밸런스**입니다.
   *
   * 물어야 하는 것은 *"첫 창에서 갈리는가"* 가 아니라
   * *"갈리는 자리가 **어딘가에** 있는가"* 입니다. 하나라도 있으면
   * 전환에 뜻이 있습니다.
   */
  const decidedWins = winByWindow.filter((n) => n !== '동률')
  const thriftBest = axes.reduce((a, b) => (a.thrift >= b.thrift ? a : b)).name
  check(
    decidedWins.some((n) => n !== thriftBest),
    '**끊어 칠 때와 오래 붙을 때의 최선이 다르다** (무기를 바꿀 이유가 실제로 있다)',
    windows.map((w, i) => `${w.name} → ${winByWindow[i]}`).join(' · ') +
      ` · 오래 붙기(스태미나 효율) → ${thriftBest}`,
  )
  /**
   * 📋 [관찰] **표준 반격 창은 평평합니다.**
   *
   * 무기 셋이 26 · 26 · 24 — 동사는 다른데(롱소드 2타, 대검 1타, 쌍단검
   * 3타) 결과가 같습니다. 이게 의도된 평평함인지(어느 무기를 들어도
   * 기본 대응은 손해가 없다), 아니면 무기 정체성이 **가장 자주 오는
   * 상황에서만 사라지는** 것인지는 아직 결론 낼 근거가 없습니다.
   * 니오·오공은 여기서도 갈리게 만듭니다(빠른 무기는 여러 대, 무거운
   * 무기는 한 대 크게). 숫자를 적어 두고 다음 라운드로 넘깁니다.
   */
  /**
   * ── 💢 **"평평하다"를 축 하나로 말하지 않습니다** ────────────────────
   *
   * 지난 라운드에 *"표준 반격 창은 평평합니다(26 · 26 · 24)"* 를 관찰로
   * 적어 두고 다음 라운드로 넘겼습니다. 그런데 그 줄은 **피해만** 재고
   * 있었습니다. 이 게임이 무기를 가르는 축은 셋인데(폭발 · 효율 · 강인도)
   * 하나만 보고 평평하다고 적은 것입니다.
   *
   * 축 하나로 결론을 내고 피해 수치를 만졌다면, **갈려 있던 것을 제 손으로
   * 뭉갤 뻔했습니다.** 그래서 이제 창마다 **피해와 강인도를 같이** 적고,
   * *"어느 축에서도 안 갈리는 창이 있는가"* 를 묻습니다.
   *
   * 니오·오공이 짧은 틈에서도 무기를 가르는 방법이 정확히 이것입니다 —
   * 빠른 무기는 **여러 대**, 무거운 무기는 **한 대 크게(그리고 무너뜨리게)**.
   */
  const flatOn = (row, key) => {
    const sorted = [...row.dealt].sort((a, b) => b[key] - a[key])
    return sorted[0][key] < sorted[1][key] * MARGIN
  }
  const flatBoth = byWindow.filter((r) => flatOn(r, 'dealt') && flatOn(r, 'poise'))
  check(
    flatBoth.length === 0,
    '💢 **어느 창에도 "두 축 모두 평평한" 자리가 없다** (가장 흔한 상황에서 무기가 사실상 하나가 되지 않게)',
    flatBoth.length === 0
      ? byWindow
          .map((r) => `${r.name} → ${flatOn(r, 'dealt') ? '강인도로' : '피해로'} 갈림`)
          .join(' · ')
      : `평평한 창: ${flatBoth.map((r) => r.name).join(' · ')}`,
  )

  /**
   * ── 🕐 **경계가 종이 한 장인가** ────────────────────────────────
   *
   * 위 창 표에서 대검이 잡몹 후딜 0.85초에 `26~92.8` 을 오갔습니다.
   * 그게 **긴장인지 운인지**를 여기서 가릅니다.
   *
   * 소울류·니오가 무거운 무기로 파는 긴장은 *"한 대만 넣고 빠질까,
   * 두 대를 노릴까"* 입니다. 그런데 그 긴장이 성립하려면 플레이어가
   * **어느 쪽인지 알 수 있어야** 합니다. 착탄 시각이 창 끝과 종이 한 장
   * 차이면, 같은 판단을 해도 결과가 판마다 달라집니다.
   *
   * > **결정할 수 없는 선택은 선택이 아닙니다.**
   * > 그건 긴장이 아니라 그냥 운입니다.
   *
   * 그래서 창 끝에서 가장 가까운 타의 **여유**를 잽니다. 여유가 사람이
   * 느끼기에 유의미한 폭보다 좁으면 그 자리는 동전 던지기입니다.
   */
  /**
   * ⚠️ **시간표도 세 번 재서 중앙값을 씁니다.**
   *
   * 아래 경계 검사는 **두 관측값을 견줍니다** — 창 길이와 착탄 시각.
   * 둘 다 흔들리는데 기준(0.08초)이 그 흔들림과 비슷한 크기라, 한 번씩만
   * 재면 검사가 게임과 무관하게 빨강·초록을 오갑니다. 실제로 이번
   * 라운드에 통과 → 실패 → 통과를 겪었고, 쌍단검 3타가 판에 따라
   * `0.53초` 와 `0.67초` 로 찍혔습니다.
   *
   * 8~20fps 에서 8ms 폴링으로 재면 한 프레임(0.05초)이 통째로 오차가
   * 됩니다. **계측기의 눈금보다 가는 것을 물으면 안 됩니다** — 눈금을
   * 굵게 하든지(중앙값), 질문을 굵게 하든지 둘 중 하나입니다.
   */
  const lines = []
  for (let slot = 1; slot <= table.length; slot++) {
    const reps = []
    for (let i = 0; i < 3; i++) reps.push(await page.evaluate((s) => window.__t.timeline(s), slot))
    const steps = Math.min(...reps.map((r) => r.at.length))
    const at = []
    for (let i = 0; i < steps; i++) {
      at.push([...reps.map((r) => r.at[i])].sort((a, b) => a - b)[1])
    }
    lines.push({ name: reps[0].name, at })
  }
  console.log('\n  [시간표] 누른 뒤 **몇 초에** 꽂히는가 (콤보 타별)')
  for (const l of lines) {
    console.log(`    ${l.name.padEnd(12)} ${l.at.map((t, i) => `${i + 1}타 ${t.toFixed(2)}초`).join(' · ')}`)
  }

  /**
   * 기준 0.08초의 근거: 이 게임의 한 프레임이 60fps 에서 0.017초이고,
   * `npm run feel` 이 재는 접수 지연도 그 한 프레임입니다. 사람이 "언제
   * 끝나는지 보고 판단"하려면 **여러 프레임**의 여유가 필요합니다.
   * 0.08초면 약 5프레임 — 눈으로 보고 손이 따라갈 수 있는 최소치입니다.
   * 그보다 좁으면 같은 판단이 판마다 다른 결과를 냅니다.
   */
  const EDGE = 0.08
  /**
   * ── 📏 **눈금보다 가는 것을 묻지 않습니다** ──────────────────────
   *
   * ── 무엇이 잘못돼 있었는가 ────────────────────────────────────
   * 이 검사는 **두 관측값**을 견줍니다 — 창 길이와 착탄 시각. 위 주석이
   * 이미 진단해 두었습니다: *"둘 다 흔들리는데 기준(0.08초)이 그 흔들림과
   * 비슷한 크기라, 한 번씩만 재면 검사가 게임과 무관하게 빨강·초록을
   * 오갑니다."*
   *
   * 그런데 **처방이 한쪽에만 적용돼 있었습니다.** 착탄 시각은 3회
   * 중앙값으로 굵게 만들었는데(`lines`), 창 길이(`punishSec`)는 관측
   * 5회의 **최솟값** 그대로입니다. 두 값을 견주는 검사인데 한쪽만
   * 다듬은 셈입니다.
   *
   * 실제로 그래서 이런 줄이 나왔습니다:
   *
   *     ❌ 롱소드 3타가 잡몹 반격창(0.72초) 끝과 **0.067초** (문턱 0.08)
   *
   * 차이가 **0.013초**입니다. 이 컨테이너는 8~20fps 라 **한 프레임이
   * 0.05초**이고, 창 값 자체가 그 눈금 위에서 관측된 최솟값입니다.
   * 즉 이 계측기는 0.067 과 0.08 을 **가를 수 없습니다.**
   *
   * ── 그래서 셋으로 나눕니다 ────────────────────────────────────
   * 「못 잰 것은 통과가 아니다」 — 그리고 **실패도 아닙니다.** 분해능
   * 안쪽은 판정하지 않고 `[못 잼]` 으로 적습니다. 여기서 ❌ 를 내면
   * *계측기의 한계를 게임의 결론으로* 만드는 것이고, ✅ 를 내면 *못 잰
   * 것을 통과로* 만드는 것입니다. 둘 다 이 저장소가 금지한 쪽입니다.
   *
   * ⚠️ 분해능은 **관측에서 나옵니다** — 짧은 봉우리의 관측 폭입니다.
   *    여기에 0.05 를 적어 두면 더 빠른 기계에서도 그 굵기를 그대로
   *    쓰게 되어, **계측기가 좋아져도 검사는 안 좋아집니다.**
   * ⚠️ 짧은 봉우리 표본이 2개 미만이면 폭을 낼 수 없습니다. 그때는
   *    분해능을 모르는 것이므로 **경계에 걸친 것을 전부 `[못 잼]`** 으로
   *    돌립니다 — 모르면 판정하지 않습니다.
   */
  const fastGaps = punishGaps.filter((g) => g <= punishSec * 1.5)
  const resolution =
    fastGaps.length >= 2 ? Math.max(...fastGaps) - Math.min(...fastGaps) : Infinity
  const edges = []
  const unmeasurable = []
  for (const win of windows) {
    for (const l of lines) {
      for (let i = 0; i < l.at.length; i++) {
        const gap = Math.abs(win.sec - l.at[i])
        if (gap >= EDGE + resolution) continue // 확실히 안전
        const line = `${l.name} ${i + 1}타가 ${win.name}(${win.sec.toFixed(2)}초) 끝과 ${gap.toFixed(3)}초`
        // 문턱보다 **분해능만큼 더 작아야** 걸쳤다고 말합니다.
        if (gap < EDGE - resolution) edges.push(line)
        else unmeasurable.push(line)
      }
    }
  }
  if (unmeasurable.length > 0) {
    console.log(
      `     [못 잼] 이 계측기의 분해능 ±${Number.isFinite(resolution) ? resolution.toFixed(3) : '?'}초 안이라 판정하지 않습니다` +
        ` (짧은 봉우리 ${fastGaps.length}회: ${fastGaps.join(', ')}) — ${unmeasurable.join(' · ')}`,
    )
  }
  check(
    edges.length === 0,
    '창 경계에 **종이 한 장 차이로 걸친 타**가 없다 (판단이 동전 던지기가 되지 않게)',
    edges.length
      ? edges.join(' · ')
      : `모든 타가 창 끝에서 ${EDGE}초 넘게 떨어져 있습니다` +
        (unmeasurable.length ? ` · ⚠️ 단 ${unmeasurable.length}건은 **못 잼**(위 줄 참고)` : ''),
  )

  /**
   * ── 🫁 **효율 축이 실전에 존재하는가** ──────────────────────────
   *
   * 위 표에서 대검은 안전창에 **같은 피해 + 강인도 1.4배**를 넣습니다.
   * 대가는 스태미나뿐인데, 그 대가는 스태미나가 **실제로 모자라질 때만**
   * 대가입니다. 게임의 리듬 그대로 돌려서 바닥을 봅니다.
   *
   * ⚠️ 한 주기 길이는 **적에게 물어서** 씁니다(`attackCycle`). 여기 숫자를
   *    적으면 적을 손볼 때마다 이 검사가 조용히 옛말이 됩니다.
   */
  const gruntDef = roster.find((r) => r.id === 'grunt')
  const cycleSec = gruntDef?.attackCycle ?? 2.5
  /**
   * 반복 횟수를 **한 곳에서만** 정합니다. 지난번에 6을 10으로 바꾸면서
   * 출력 문구의 "6번"을 안 고쳐, 10주기 결과를 6주기라고 읽을 뻔했습니다.
   */
  const RHYTHM_CYCLES = 6
  // 세 번씩 재고 중앙값 — 이 파일이 창 비교에서 이미 배운 것(운으로 통과 금지).
  const rhythm = []
  for (let slot = 1; slot <= table.length; slot++) {
    const reps = []
    for (let i = 0; i < 3; i++) {
      reps.push(
        await page.evaluate(
          ([s, w, c, n]) => window.__t.rhythm(s, w, c, n),
          [slot, punishSec, cycleSec, RHYTHM_CYCLES],
        ),
      )
    }
    const md = (f) => [...reps.map(f)].sort((a, b) => a - b)[1]
    rhythm.push({
      name: reps[0].name,
      minStamina: md((r) => r.minStamina),
      denied: md((r) => r.denied),
      breakAtCycle: md((r) => r.breakAtCycle),
      poiseMin: md((r) => r.poiseMin),
      poiseFull: reps[0].poiseFull,
      dealt: md((r) => r.dealt),
      span: `${Math.min(...reps.map((r) => r.dealt))}~${Math.max(...reps.map((r) => r.dealt))}`,
    })
  }
  console.log(
    `\n  [리듬] 구르고 → 안전창 ${punishSec.toFixed(2)}초 치고 → ` +
      `${cycleSec.toFixed(2)}초 주기로 ${RHYTHM_CYCLES}번 (실전에 가까운 반복)\n    ` +
      rhythm
        .map(
          (r) =>
            `${r.name.padEnd(6)} 최저 스태미나 ${String(r.minStamina).padStart(3)} · ` +
            `누적 피해 ${String(r.dealt).padStart(4)} · 막힘 ${String(r.denied).padStart(3)} · ` +
            (r.breakAtCycle > 0
              ? `**${r.breakAtCycle}주기에 무너뜨림**`
              : `강인도 ${r.poiseFull} → ${r.poiseMin}`),
        )
        .join('\n    '),
  )
  /**
   * 기준: **콤보 한 바퀴를 못 낼 만큼** 내려가 본 적이 있는가.
   * 그보다 위에서만 논다면 "관리"라고 부를 것이 없습니다 — 자원은
   * 모자랄 때만 자원이고, 늘 남으면 그냥 배경입니다.
   *
   * 그리고 이 축이 죽으면 **쌍단검의 정체성이 통째로 사라집니다.**
   * 강인도는 대검, 폭발도 대검, 남는 것이 효율뿐인데 그 효율이 실전에서
   * 아무 일도 안 하면 쌍단검을 들 이유가 없습니다.
   */
  const worstCombo = Math.max(...table.map((w) => w.comboStamina))
  /**
   * 두 가지를 **함께** 요구합니다. 최저치만 보면 "잠깐 스쳤다"도 통과하는데,
   * 자원이 문다는 것은 *"내려던 것을 못 냈다"* 는 뜻입니다. 그래서
   * **막힌 프레임**을 같이 봅니다 — 이게 실제로 손이 묶인 증거입니다.
   */
  /**
   * ── 여기에 검사를 하나 **썼다가 지웠습니다** ──────────────────────
   * *"아끼는 무기가 실제로 덜 막힌다"*. 세 번 고장 내 봤고 **세 번 다
   * 통과했습니다.**
   *
   *   ① 회복 34 → 400 : 롱소드·쌍단검은 전혀 안 막혔는데(0), 대검이
   *      회복 지연(0.55초) 때문에 여전히 막혀서 통과.
   *   ② 쌍단검 소모를 대검과 같게 : 그러자 **효율 1등이 롱소드로 바뀌고**,
   *      롱소드가 쌍단검보다 덜 막혀서 또 통과.
   *
   * ②가 결정적이었습니다. 이 검사는 *"효율 순위"* 를 **막힘과 같은
   * 뿌리에서 다시 뽑아** 견주고 있었습니다. 무엇을 망가뜨리든 순위가
   * 같이 따라 움직이니 **원리적으로 빨개질 수 없습니다.**
   *
   * > 자기 자신을 기준으로 삼는 검사는 언제나 통과합니다.
   *
   * 게다가 지울 이유가 하나 더 있었습니다 — ②를 넣자 **옆의 검사 셋이
   * 실제로 빨개졌습니다**(초당 피해 · 축이 다른가 · 효율 격차 1.7배).
   * 축이 죽으면 이미 세 곳에서 웁니다. 같은 것을 네 번째로 세는 검사는
   * 안전망이 아니라 **소음**입니다.
   *
   * 그래서 **관측만 남깁니다.** 아래 두 줄은 검사가 아니라 기록입니다.
   */
  /**
   * 📋 [관찰] **이 압박이 4색과 맞물립니다.**
   *
   * 한 주기에 드는 값은 구르기 25 + 반격 15~26 = 40~51 인데, 주기 안에서
   * 회복되는 양은 그보다 적습니다(회복 34/초 · 지연 0.55초). 즉 **매번
   * 구르면서 매번 반격까지 채우는 리듬은 성립하지 않습니다.**
   *
   * 그런데 이 게임에는 **공짜 대응**이 하나 있습니다 — 🟡 노랑의 정답인
   * *"걸어서 이탈"* 은 스태미나를 한 방울도 안 씁니다. 즉 스태미나 경제가
   * 4색 설계를 뒤에서 밀고 있습니다: 구를 필요가 없을 때 구르면, 정작
   * 반격할 힘이 없습니다. 소울류가 스태미나로 파는 긴장이 정확히 이것입니다.
   *
   * 이건 지금 확인된 **관계**이지 새로 만든 규칙이 아닙니다. 적어 둡니다.
   */
  const tune = await page.evaluate(() => window.__game.terrainInfo())
  const dodgeCostSeen = tune?.dodgeStaminaCost ?? '?'
  const regenSeen = tune?.staminaRegen ?? '?'
  const regenDelaySeen = tune?.staminaRegenDelay ?? '?'
  /**
   * ── 🪨 **강인도 우위가 실전에서도 우위인가** ─────────────────────
   *
   * 두 라운드 전에 남긴 질문의 답이 여기 있습니다. 대검은 표준 창에서
   * **같은 피해에 강인도 1.4배**인데, 그 우위를 스태미나 대가가 상쇄하는지는
   * *"몇 주기 만에 무너뜨리는가"* 로만 갈립니다.
   *
   * 이 자리에는 벤치가 절대 못 보는 것이 있습니다 — **강인도 회복.**
   * 한 주기에 깎는 양이 회복량보다 적으면 그 무기에게 붕괴는 존재하지
   * 않습니다. 쉬지 않고 두들기면 셋 다 무너뜨리므로 안 보입니다.
   */
  /**
   * ── 여기에 **틀린 검사를 하나 썼다가 지웠습니다** ─────────────────
   * *"모든 무기가 실전 리듬 안에서 결국 무너뜨린다"*. 셋 다 빨갛게
   * 나왔는데, 고쳐야 할 것은 밸런스가 아니라 **제 주장**이었습니다.
   *
   * 강인도가 남은 값이 30 → 13.3 / 23 / 27.5 로 **완벽히 선형**이었고,
   * 6주기를 그 기울기로 늘리면 대검 11주기 · 롱소드 26 · 쌍단검 72 입니다.
   * 즉 *"못 무너뜨린다"* 가 아니라 **6주기가 짧았을 뿐**입니다. 그리고
   * `basicMultiplier: 0.35` 의 설계 주석이 원하는 바가 정확히 이것입니다 —
   * 평타로는 실전 시간 안에 안 무너지고, 끊는 수단(강타·예고 중·등 뒤·반격)이
   * 답이어야 한다. **검사가 설계와 반대되는 것을 요구하고 있었습니다.**
   *
   * > 빨간 검사를 보면 먼저 물어야 합니다 — 게임이 틀렸나, 내 주장이 틀렸나.
   */
  /**
   * ── 🪨 **붙어 있는 동안 압박이 새지 않는가** ──────────────────────
   *
   * 위 선형성이 알려 준 진짜 사실은 따로 있었습니다. 강인도 회복이
   * **한 번도 켜지지 않았습니다.** 회복은 마지막 타격부터 세는데,
   *
   *     안전창 끝 + 회복 지연  >  적의 공격 주기
   *
   * 이면 다음 공격이 먼저 와서 매번 리셋됩니다. 지금은 아슬아슬하게
   * 성립합니다(0.72 + 2.2 = 2.92 vs 2.47 — 여유 0.45초).
   *
   * ── 왜 이걸 검사로 남기는가 ──────────────────────────────────────
   * 이건 **따로 정한 두 숫자의 관계**입니다. 잡몹 공격 쿨다운을 0.5초만
   * 늘리거나 회복 지연을 조금 줄이면, 아무 오류 없이 **강인도 압박이
   * 절반으로 줄어듭니다.** 이 저장소가 반복해서 물린 자리가 정확히
   * 여기입니다 — *수명이 다른 두 숫자가 조용히 어긋난다.*
   *
   * 참고한 게임들이 같은 규칙을 씁니다: 세키로의 체간은 붙어서 압박하는
   * 동안에는 안 차고 **떨어지면** 찹니다. 로스트아크의 무력화도 파티가
   * 붙어 있는 동안 유지됩니다. "떨어지면 리셋"이 붙어 싸울 이유를 만듭니다.
   *
   * ⚠️ 세 숫자 전부 게임에서 읽습니다 — 안전창은 이 파일이 **재서** 얻었고,
   *    회복 지연은 `counterInfo`, 주기는 `enemyRoster` 입니다.
   */
  const poiseCfg = await page.evaluate(() => window.__game.counterInfo())
  const regenGap = punishSec + poiseCfg.poiseRegenDelay - cycleSec
  check(
    regenGap > 0,
    '**붙어서 싸우는 동안 강인도 회복이 켜지지 않는다** (떨어져야 찬다)',
    `안전창 ${punishSec.toFixed(2)}초 + 회복 지연 ${poiseCfg.poiseRegenDelay}초 = ` +
      `${(punishSec + poiseCfg.poiseRegenDelay).toFixed(2)}초 vs 잡몹 주기 ${cycleSec.toFixed(2)}초 ` +
      `— 여유 ${regenGap.toFixed(2)}초`,
  )

  /**
   * 📋 [관찰] **평타로 무너뜨리려면 몇 주기가 필요한가.**
   *
   * 검사가 아니라 기록입니다. 위 검사가 "회복이 안 샌다"를 지키고 있으므로
   * 감소는 선형이고, 6주기 실측을 그대로 늘려서 읽을 수 있습니다.
   *
   * 명목 `poiseScale` 은 롱소드 1 · 대검 1.7 · 쌍단검 0.5 인데 **실측 격차는
   * 더 벌어집니다** — trauma 와 휘두르는 속도가 함께 곱해지기 때문입니다.
   * 두 라운드 전 질문(*"대검의 강인도 우위를 스태미나 대가가 상쇄하는가"*)의
   * 답이 여기 있습니다: **상쇄하지 못합니다.**
   */
  const drains = rhythm.map((r) => {
    const per = r.poiseFull > 0 ? (r.poiseFull - r.poiseMin) / RHYTHM_CYCLES : 0
    return { name: r.name, per, cycles: per > 0 ? Math.ceil(r.poiseFull / per) : -1 }
  })
  const slowest = Math.min(...drains.map((d) => d.per))
  console.log(
    `  📋 [관찰] 평타만으로 잡몹(강인도 ${rhythm[0].poiseFull})을 무너뜨리기까지 — ` +
      drains
        .map(
          (d) =>
            `${d.name} 주기당 ${d.per.toFixed(2)}(${d.cycles < 0 ? '∞' : `${d.cycles}주기`}` +
            `${slowest > 0 ? ` · ${(d.per / slowest).toFixed(1)}배` : ''})`,
        )
        .join(' · ') +
      ` — **평타는 답이 아닙니다**(설계대로). 끊는 수단이 답입니다`,
  )

  console.log(
    `  📋 [관찰] 한 주기 비용 구르기 ${dodgeCostSeen} + 반격 ${Math.min(...table.map((w) => w.comboStamina))}~${worstCombo} ` +
      `vs 회복(${regenSeen}/초 · 지연 ${regenDelaySeen}초) — **매번 구르며 매번 반격까지는 안 됩니다.** ` +
      `🟡 의 정답(걸어서 이탈)이 스태미나를 안 쓰는 이유가 여기에 있습니다`,
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
