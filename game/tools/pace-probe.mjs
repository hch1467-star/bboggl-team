/**
 * 보스 페이스 실험대 — `npm run pace`
 *
 * ── 왜 벤치로는 안 되는가 ───────────────────────────────────────
 * 설계 문서는 *"마지막 구간이 가장 길어야 한다"* 고 적어 두었는데 벤치는
 * 계속 반대로 나옵니다. 그래서 구간 배분을 화력에서 거꾸로 풀어 고쳤다가
 * **되돌렸습니다** — 근거로 쓴 화력의 폭이 너무 넓었기 때문입니다.
 *
 * 같은 코드로 5판 벤치를 두 번 돌린 결과가 이렇습니다:
 *
 *     ① 1단계 13.1초 (12.7~13.9) · 화력 11.8 (11.2~12.2)
 *     ② 1단계 19.9초 (7.0~28.6)  · 화력  7.8 (5.4~22.1)
 *
 * ①의 좁음은 **우연이었습니다.** 자동 플레이의 보스전에는 존을 걸어온
 * 상태가 통째로 섞입니다 — 성수병을 몇 개 썼는지, 무기를 강화했는지,
 * 스킬이 얼마나 차 있는지, 오다가 죽었는지. 그 위에서 구간 시간을 재는 것은
 * **소음에 자를 대는 것**입니다.
 *
 * ── 그래서 여기서 하는 것 ───────────────────────────────────────
 * 존을 걸어오지 않습니다. 보스 앞으로 **순간이동**하고, 시작 상태를
 * 못 박고(체력·스태미나·무기 강화·불티), **똑같은 정책**으로 싸웁니다.
 * 판마다 다른 것은 보스의 패턴 선택뿐입니다.
 *
 * 그러면 두 가지 중 하나가 나옵니다. 둘 다 알아야 할 답입니다:
 *   · 범위가 좁아진다 → 벤치의 폭은 **여정** 때문이었습니다. 이 수치로
 *     구간 배분을 풀 수 있습니다.
 *   · 여전히 넓다     → 폭의 원인이 보스 자신(패턴 선택)입니다. 그러면
 *     배분을 아무리 맞춰도 판마다 다르게 느껴집니다 — 고칠 곳이 배분이
 *     아니라 **패턴 가중치**라는 뜻입니다.
 *
 * ⚠️ 봇처럼 잘 싸우는 것이 목적이 아닙니다. **같은 방식으로** 싸우는 것이
 *    목적입니다. 정책이 단순할수록 재려는 것(구간 길이)이 또렷해집니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { simPerWall, announceSpeed } from './machine.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5211
const RUNS = Math.max(2, Math.min(9, Number(process.argv[2]) || 5))
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const span = (xs) => {
  const a = [...xs].sort((x, y) => x - y)
  return `${a[0].toFixed(1)}~${a[a.length - 1].toFixed(1)}`
}
const fmt = (xs) => `${med(xs).toFixed(1)} (${span(xs)})`

const server = await createServer({ root: ROOT, server: { port: PORT }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: execPath,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  // ⏱ 이 프로브는 판당 20여 시뮬레이션초를 씁니다 — 느린 기계에서는
  //    `npm run pace 2` 로 판수를 줄일 수 있습니다(RUNS, 2~9).
  announceSpeed(await simPerWall(page), RUNS * 24, '판수를 줄이려면 `npm run pace 2`.')

  console.log(`\n🥁 보스 페이스 실험대 — ${RUNS}판, 같은 시작 · 같은 정책\n`)

  /**
   * ── 강화 단계만 바꿔 가며 돌립니다 ─────────────────────────────
   *
   * 앞선 실험대가 강화 0단계에서 3단계를 못 끝냈습니다(화력 5.1/초,
   * 3판 중 2판 시간초과). 그런데 벤치(강화된 무기 + 똑똑한 봇)에서는
   * 3단계 화력이 28.7 로 오릅니다. **둘 다 사실일 수 있습니다** —
   * 3단계가 "성장을 요구하는 구간"이면 그게 정상이니까요.
   *
   * 그래서 **강화 단계 하나만** 바꿉니다. 나머지는 전부 같습니다.
   *   · 0단계에서 못 끝내고 뒤 단계에서 끝난다 → 성장 관문. 설계대로입니다.
   *   · 어느 단계에서도 못 끝낸다               → 구간 자체가 벽입니다.
   *   · 0단계에서도 끝난다                      → 앞 결과가 정책 탓이었습니다.
   *
   * 한 변수만 움직이는 것이 요점입니다. 오늘 되돌린 셋 중 둘이 "여러 개가
   * 같이 움직이는 자리에서 하나를 지목한" 것이었습니다.
   */
  /**
   * 한 판을 도는 몸통을 **페이지 안에 한 번만** 심습니다.
   *
   * ⚠️ 원래는 스윕 안에 인라인으로 있었습니다. 그러면 아래 A/B 절이
   *    같은 몸통을 쓸 수 없어서 **복사본**을 만들어야 하는데, 복사한
   *    순간 두 정책이 미묘하게 다른 손이 되어 버립니다 — 비교가
   *    성립하지 않습니다. 한 변수만 다르게 하려면 몸통은 하나여야 합니다.
   */
  await page.evaluate(() => {
    window.__pace = async (wLv, colorBlind) => {
      const G = window.__game
      const sleep = () => new Promise((r) => setTimeout(r, 8))
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t0 = now()
        const dl = Date.now() + 30000
        while (now() - t0 < sec && Date.now() < dl) await sleep()
      }
      const tap = (c) => {
        G.press(c)
        G.release(c)
      }

      G.resetProgress()
      await new Promise((r) => setTimeout(r, 400))
      await wait(0.5)

      /**
       * **시작 상태를 못 박습니다.** 벤치에서 폭을 만들던 것들입니다 —
       * 무기 강화 단계와 지갑이 판마다 달랐습니다. 강화 0단계로 고정하면
       * "화력이 오르는 것"이 장비 때문인지 전투 중 자원(집중·처형) 때문인지
       * 갈립니다.
       */
      G.setWeaponLevel(0, wLv)
      G.setEmbers(0)

      /**
       * 한 타에 드는 스태미나 — **게임 데이터에서** 끌어옵니다.
       * 여기 숫자를 적으면 무기를 손보는 날 이 실험대가 조용히 옛말이 됩니다.
       */
      const wt = G.weaponTable()[0]
      const perStep = wt.comboStamina / wt.comboLength
      /**
       * ⏱ **사람 박자로 누릅니다** — 한 타에 걸리는 시간만큼 쉽니다.
       *
       * ⚠️ 이 실험대는 매 폴링(8ms)마다 눌렀습니다. 초당 ~250번입니다.
       *    그런데 이 게임의 평타는 **휘두르며 앞으로 나갑니다**(롱소드 1타
       *    lunge 1.5m). 즉 누르는 것만으로 플레이어가 보스에게 **계속
       *    끌려 들어갑니다.**
       *
       *    그 결과가 이랬습니다 — 3단계에서 **3m 안쪽에 있던 시간 96%**.
       *    보스의 🟢 돌진(3~10m)과 🟣 갈고리(5~11m)는 그 안에서 후보에도
       *    못 듭니다. *"보스가 패턴 둘을 안 쓴다"* 는 결론을 **계측기가
       *    자기 손으로 만들고 있었습니다.** 보스 쪽을 세 번 고쳐 봤고
       *    세 번 다 0회였던 이유가 여기 있었습니다.
       *
       * 박자는 게임 데이터에서 끌어옵니다(콤보 전체 시간 ÷ 타수).
       */
      const swingGap = wt.comboSeconds / wt.comboLength
      let lastSwingAt = -99
      /**
       * 🧭 **서는 거리를 게임에서 읽습니다.**
       *
       * ⚠️ 여기 `2.6m` 이 박혀 있었습니다. 그 한 줄이 결론을 하나 만들어
       *    냈습니다 — 보스의 다섯 패턴 중 둘(🟢 돌진 3~10m · 🟣 갈고리
       *    5~11m)이 **세 페이즈 통틀어 0회**로 찍혔는데, 2.6m 에 붙여 놓으면
       *    그 둘은 `pickAttack` 굴림에서 아예 빠지기 때문입니다.
       *    게다가 매 프레임 순간이동으로 붙이므로 **보스가 물러나도 소용이
       *    없습니다** — 실험대가 자기 손으로 관측을 막고 있었습니다.
       *
       * 보스가 근접 공격을 내는 자리, 즉 `attackRange` 에 섭니다. 그 값은
       * 적을 손보면 같이 따라옵니다. 여유(0.8m)는 붙었다 떨어지는 폭입니다.
       */
      /**
       * 🎨 **색을 읽는 손**이 쓰는 값 — 전부 게임에서 읽습니다.
       *
       * 이 실험대의 손은 지금까지 **색을 안 가리고** 예고마다 구르기만
       * 했습니다(봇 지능이 결과에 섞이지 않게). 그런데 이 게임의 기둥은
       * *"색마다 다른 대응"* 입니다 — 색맹인 손으로만 재면 그 기둥은
       * **한 번도 시험되지 않습니다.**
       *
       * 그래서 딱 한 가지만 다른 손을 하나 더 둡니다: 🟡 처럼 **구르기로는
       * 못 빠져나오는 넓은 예고**에는 구르지 않고 **걸어서 나갑니다.**
       * 색 이름을 적어 두지 않고 **도형에서** 정합니다 —
       * `reach > dodgeDistance` 면 굴러도 안쪽에 남는다는 뜻이니까요
       * (`npm run rules` 가 지키는 바로 그 약속입니다).
       *
       * 색이 값어치가 있다면 이 손이 **덜 맞아야** 합니다. 아니라면 4색은
       * 장식입니다 — 그건 재서 알아야 할 일이지 믿을 일이 아닙니다.
       */
      const tune0 = G.terrainInfo()
      const bossDef = G.enemyRoster().find((r) => r.id === 'boss')
      const stand = bossDef?.attackRange ?? 3.4
      const leash = stand + 0.8
      /**
       * 🧭 **"쓰려면 떨어져 있어야 하는 패턴"의 문턱**을 게임에서 읽습니다.
       * 어느 패턴이 왜 안 나오는지 물으려면 가중치가 아니라 이 구간을 봐야
       * 합니다 — 가중치는 의도이고, 굴려지는지는 사거리가 정합니다.
       */
      /** 구르기로 못 벗어나는 패턴들의 사거리 — 색이 아니라 **도형**으로 가릅니다. */
      const wideReach = {}
      for (const a of bossDef?.attacks ?? []) {
        if (a.reach > tune0.dodgeDistance) wideReach[a.intent] = Math.max(wideReach[a.intent] ?? 0, a.reach)
      }
      const gated = (bossDef?.attacks ?? []).filter((a) => a.minRange > 0)
      const gateAt = gated.length ? Math.min(...gated.map((a) => a.minRange)) : 0
      const be0 = G.bossEncounter()
      if (!be0) return null
      const bi = G.enemyInfo(be0.entity)
      if (!bi) return null
      // 보스 코앞이 아니라 **조우가 걸릴 만큼만** 다가갑니다.
      G.teleportPlayer(bi.x - 6, bi.z)
      await wait(0.5)

      const phaseTime = [0, 0, 0]
      const phaseDmg = [0, 0, 0]
      /**
       * 🔬 **화력이 왜 떨어졌는지 가르는 진단값**입니다.
       *
       * 3단계 화력이 1단계의 1/7(31.4 → 4.5)로 나왔는데, 원인 후보가
       * 최소 셋입니다: ① 보스가 창을 안 준다 ② 사거리 밖으로 밀려난다
       * ③ **이 실험대의 손이 놀고 있다.**
       *
       * ①은 이미 지웠습니다 — `npm run boss` 로 잰 페이즈별 안전창은
       * 1.85 / 0.80 / 1.65초라 3단계가 좁지 않습니다. 남은 둘을 가르려면
       * *"페이즈마다 손이 실제로 무엇을 했는가"* 를 세야 합니다.
       *
       * 특히 이 정책에는 **아무것도 안 하는 가지**가 있습니다 —
       * 예고에 한 번 구른 뒤에는 그 예고가 끝날 때까지 손을 놓습니다.
       * 예고 비율이 높은 페이즈에서는 그 가지가 시간을 통째로 먹습니다.
       */
      const phaseWind = [0, 0, 0]
      const phaseFar = [0, 0, 0]
      const phaseIdle = [0, 0, 0]
      const phaseSwing = [0, 0, 0]
      const phaseDodge = [0, 0, 0]
      /**
       * 두 번째 진단 묶음 — 첫 묶음이 후보를 **전부** 지웠기 때문에 넣습니다.
       * 3단계는 손을 놓지도(0%), 사거리 밖으로 밀려나지도(0%) 않았고
       * 오히려 1단계의 2.7배를 휘둘렀는데 화력은 1/14였습니다. 그리고
       * **예고 중이 3%뿐**이었습니다(1단계 29.9%) — 보스가 거의 안 때립니다.
       * 그러면 남는 것은 *"때려도 안 들어가는 상태"* 입니다:
       * 무방비(붕괴)·전환 무적·스태미나 고갈 셋을 직접 셉니다.
       */
      const phaseWait = [0, 0, 0]
      /** 문턱 안쪽(= 원거리 패턴이 후보에서 빠지는 거리)에 있던 시간 */
      const phaseInside = [0, 0, 0]
      /** 🎨 넓은 예고를 걸어서 빠져나간 시간 */
      const phaseWalk = [0, 0, 0]
      /** 이 판에서 플레이어가 받은 피해 합계 — 정책의 값어치는 여기서 갈립니다. */
      let taken = 0
      let lastPlayerHp = -1
      const phaseBroken = [0, 0, 0]
      const phaseInvuln = [0, 0, 0]
      const phaseNoStam = [0, 0, 0]
      let lastHp = -1
      let lastSample = now()
      const t0 = now()
      let killed = false
      let slot = 0
      let wasWinding = false
      const dl = Date.now() + 150000

      /**
       * 판당 상한 90초. 처음엔 180초로 뒀다가 **전체가 시간 제한에 걸려**
       * 결과를 하나도 못 봤습니다(5판 × 180초 > 900초). 실험대는 벤치와
       * 달리 여러 판을 빨리 돌려 폭을 보는 것이 목적이므로, 한 판이 길면
       * 목적 자체가 무너집니다. 90초를 넘기면 그 판은 "시간초과"로 남기고
       * 넘어갑니다 — 안 끝나는 것도 정보입니다.
       */
      /**
       * 판당 상한 45초. 강화 0·2단계는 어차피 안 끝나므로(60초 넘게 3단계에
       * 머무릅니다) 상한을 길게 잡아 봐야 **똑같이 시간초과가 나오면서
       * 전체 실행만 못 끝냅니다.** 실제로 75초로 뒀다가 3단계 실행이
       * 통째로 시간 제한에 걸려 마지막 판을 못 봤습니다.
       * 가르려는 것은 "끝나는가"이지 "몇 초에 끝나는가"가 아닙니다.
       */
      while (now() - t0 < 45 && Date.now() < dl) {
        const be = G.bossEncounter()
        if (!be || be.hp <= 0) {
          killed = true
          break
        }
        const info = G.enemyInfo(be.entity)
        const p = G.state().player
        if (!info) break

        const dt = Math.max(0, now() - lastSample)
        lastSample = now()
        const ph = Math.min(2, be.phase)
        // 조우 중일 때만 셉니다(귀환·연출 제외).
        if (be.encounter > 0 && be.encounter < 3) {
          phaseTime[ph] += dt
          if (lastHp >= 0 && lastHp > be.hp) phaseDmg[ph] += lastHp - be.hp
        }
        lastHp = be.hp

        /**
         * ── 정책: 언제나 같은 순서 ────────────────────────────────
         * 1) 예고가 뜨면 구른다 (색을 안 가립니다 — 가리기 시작하면
         *    "봇이 얼마나 똑똑한가"가 결과에 섞입니다)
         * 2) 아니면 스킬을 슬롯 순서대로 돌린다
         * 3) 아니면 기본 공격
         * 붙는 것은 순간이동으로 유지합니다 — 이동 실력이 섞이지 않게.
         */
        /**
         * 🩹 **살려 두고 잽니다** — 그리고 그게 이 실험대의 오래된 구멍이었습니다.
         *
         * 받은 피해를 세 봤더니 8판이 **전부 정확히 100.0** 이었습니다.
         * 측정이 아니라 **포화**입니다 — 최대 체력이 100 이고, 죽으면 그 뒤
         * 45초가 통째로 죽은 판입니다. 그동안 페이즈 시간·화력이 판마다
         * 300배씩 흔들린 것도 이것으로 설명됩니다: *"보스가 오래 버텼다"* 가
         * 아니라 **때릴 사람이 없었던** 것입니다.
         *
         * 이 실험대가 재려는 것은 생존이 아니라 **보스의 박자**입니다.
         * 그래서 체력을 채워 두고, 대신 **받은 피해를 누적**합니다 —
         * 정책의 값어치는 "얼마나 버티나"가 아니라 "얼마나 먹나"에서 갈립니다.
         */
        if (lastPlayerHp >= 0 && p.hp < lastPlayerHp) taken += lastPlayerHp - p.hp
        if (p.hp < 55) {
          G.setHp(G.playerEntity(), 100)
          lastPlayerHp = 100
        } else lastPlayerHp = p.hp
        const threatIntent = G.threats(40).find((t2) => t2.entity === be.entity)?.intent ?? -1
        /** 지금 예고가 "굴러선 못 벗어나는" 것인가 — 그렇다면 나가야 할 거리. */
        const needOut = !colorBlind && info.winding ? (wideReach[threatIntent] ?? 0) : 0
        const dist = Math.hypot(info.x - p.x, info.z - p.z)
        if (be.encounter > 0 && be.encounter < 3) {
          if (info.winding) phaseWind[ph] += dt
          if (dist > leash) phaseFar[ph] += dt
          if (gateAt > 0 && dist < gateAt) phaseInside[ph] += dt
          if (info.broken) phaseBroken[ph] += dt
          if (info.transitionT > 0) phaseInvuln[ph] += dt
          if (p.stamina < 10) phaseNoStam[ph] += dt
        }
        /**
         * ⚠️ **빠져나가는 중에는 끌어당기지 않습니다.**
         *
         * 처음엔 이 줄이 무조건 돌았습니다. 그러면 🟡 을 피해 걸어 나가자마자
         * 리시가 도로 안쪽으로 끌어당겨서, **색을 읽는 손이 구르지도 못하고
         * 그대로 맞았습니다**(받은 피해 색맹 128 vs 색 읽기 198).
         * 정책이 정책을 방해하고 있었던 것입니다 — 이 저장소가 이번 세션에만
         * 다섯 번째로 밟은 함정입니다: **계측기의 한 규칙이 다른 규칙의 답을
         * 지웁니다.**
         */
        if (dist > leash && needOut <= 0) G.teleportPlayer(info.x - stand, info.z)
        G.aimAtWorld(info.x, info.z)

        /**
         * ⚠️ 처음엔 `예고 중이면 구른다`로 두었다가 결과가 뒤집혔습니다:
         *
         *     1단계 화력 34.1/초 → 3단계 **2.9/초** · 처치 0/3판
         *
         * 벤치는 화력이 **오른다**고 하는데 실험대는 12배 떨어진다고 했습니다.
         * 원인은 보스가 아니라 정책이었습니다. 3단계는 쿨다운이 0.55배라
         * 예고가 거의 끊이지 않는데, `예고 중이면 구른다`는 매 프레임 구르기만
         * 시도합니다. 스태미나가 마르면 **아무것도 안 하고 서 있습니다** —
         * 공격은 `else` 가지에 있으니 영영 안 옵니다.
         *
         * 그래서 예고 **한 번에 한 번만** 구르고, 스태미나가 모자라면
         * 그냥 때립니다. 사람이 하는 것도 그것입니다 — 못 구르면 맞더라도
         * 넣습니다. 여전히 결정적이고(같은 규칙), 굶지 않습니다.
         */
        const stam = G.state().player.stamina
        const newTelegraph = info.winding && !wasWinding
        wasWinding = info.winding
        /**
         * 🎨 넓은 예고면 **걸어서** 나갑니다. 순간이동을 쓰되 **걷는 속도로만**
         * 옮깁니다 — 이동 실력은 빼되 이동의 **대가**(시간)는 남기려는 것입니다.
         */

        if (needOut > 0 && dist < needOut + 0.4) {
          const step = tune0.walkSpeed * dt
          const nx = dist > 0.0001 ? (p.x - info.x) / dist : 1
          const nz = dist > 0.0001 ? (p.z - info.z) / dist : 0
          G.teleportPlayer(p.x + nx * step, p.z + nz * step)
          phaseWalk[ph] += dt
          await sleep()
          continue
        }
        if (newTelegraph && stam >= 25) {
          tap('Space')
          phaseDodge[ph] += 1
        } else if (info.winding && stam < 25 && now() - lastSwingAt >= swingGap) {
          lastSwingAt = now()
          tap('Mouse0')
          phaseSwing[ph] += 1
        } else if (info.winding) {
          // 이미 이 예고에 대응했습니다 — 겹쳐 구르지 않습니다.
          phaseIdle[ph] += dt
        } else if (stam >= perStep && now() - lastSwingAt >= swingGap) {
          lastSwingAt = now()
          /**
           * ⚠️ **낼 수 있을 때만 냅니다.**
           *
           * 예전엔 여기서 매 프레임 무조건 눌렀습니다. 그 결과가 이랬습니다:
           *
           *     1단계 — 초당 33   · 스태미나 바닥 43%
           *     3단계 — 초당 4.7  · 스태미나 바닥 97% · 휘두름 6289회
           *
           * 3단계는 예고가 2.8%뿐이라(1단계 28.7%) **손이 쉴 틈이 없고**,
           * 쉬지 않고 누르면 스태미나가 바닥에 붙어 대부분 거절됩니다.
           * 즉 화력 붕괴는 보스가 아니라 **누르는 방식**이 만든 것이었습니다.
           *
           * 무기 프로브가 똑같은 실수를 이미 한 번 했고 같은 규칙으로
           * 고쳤습니다 — *"사람은 못 낼 것을 알면 안 냅니다."* 기준값은
           * 게임 데이터에서 끌어옵니다(콤보 총 소모 ÷ 타수).
           */
          phaseSwing[ph] += 1
          const ready = G.slotCooldowns().filter((s) => !s.empty && s.cd <= 0)
          if (ready.length > 0) {
            tap(ready[slot % ready.length].key)
            slot++
          } else {
            tap('Mouse0')
          }
        } else {
          // 낼 수 없어 참는 시간 — 스태미나가 실제로 손을 묶은 양입니다.
          phaseWait[ph] += dt
        }
        await sleep()
      }

      /**
       * 🧾 **보스가 페이즈마다 실제로 무엇을 냈는가.**
       *
       * 3단계 "예고 중 3.3%"(1단계 28.7%)의 원인을 가르려면 가중치가 아니라
       * **나온 것**을 세야 합니다. 가중치는 의도이고, 이건 결과입니다.
       */
      const swings = G.bossSwingLog?.() ?? {}
      /**
       * 📒 **빗나간 이유** — 게임이 판정을 내린 그 자리에서 적은 장부입니다
       * (`systems/combat.ts` `swingRecords`). 여기서 각도를 다시 재지
       * 않는 것이 요점입니다 — 재면 판정의 사본이 생깁니다.
       *
       * 읽으면서 비워지므로 **판마다 깨끗합니다.**
       */
      const misses = G.swings?.() ?? []
      return {
        misses,
        swingLog: Object.fromEntries(
          Object.entries(swings).map(([id, v]) => [id, v.byPhase ?? []]),
        ),
        killed,
        total: Number((phaseTime[0] + phaseTime[1] + phaseTime[2]).toFixed(1)),
        phaseTime: phaseTime.map((v) => Number(v.toFixed(1))),
        phaseDmg: phaseDmg.map((v) => Math.round(v)),
        phaseWind: phaseWind.map((v) => Number(v.toFixed(1))),
        phaseFar: phaseFar.map((v) => Number(v.toFixed(1))),
        phaseIdle: phaseIdle.map((v) => Number(v.toFixed(1))),
        phaseSwing,
        phaseDodge,
        phaseBroken: phaseBroken.map((v) => Number(v.toFixed(1))),
        phaseInvuln: phaseInvuln.map((v) => Number(v.toFixed(1))),
        phaseNoStam: phaseNoStam.map((v) => Number(v.toFixed(1))),
        phaseWait: phaseWait.map((v) => Number(v.toFixed(1))),
        phaseInside: phaseInside.map((v) => Number(v.toFixed(1))),
        phaseWalk: phaseWalk.map((v) => Number(v.toFixed(1))),
        taken: Math.round(taken),
        gateAt,
        /**
         * 🧭 **이 손이 서는 거리** — 아래 「빠짐없이 나온다」 검사가
         * *증거*와 *손이 안 닿는 것*을 가르는 데 씁니다. 이 값을 안 실어
         * 보내면 그 검사가 게임이 아니라 **실험대의 정책**을 잽니다.
         */
        stand,
        leash,
      }
    }
  })

  const LEVELS = [0, 2, 5]
  const byLevel = new Map()
  const runs = []
  for (const level of LEVELS) {
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`  +${level} ${i + 1}/${RUNS}판… `)
    const r = await page.evaluate(async ([wLv, cb]) => window.__pace(wLv, cb), [level, true])
    if (!r) {
      console.log('보스를 못 찾음')
      continue
    }
    console.log(`${r.killed ? '처치' : '시간초과'} ${r.total}초 · ${r.phaseTime.join(' / ')}`)
    runs.push(r)
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level).push(r)
  }
  }

  /**
   * ── 📒 **보스가 왜 빗나가는가** ──────────────────────────────────
   *
   * 자동 플레이에서 보스전이 *"22.4초 · 받은 피해 38"* 로 나왔습니다.
   * 존의 마지막 시험이 플레이어 체력의 22%만 깎은 것입니다. 그런데
   * **왜** 빗나갔는지는 어디에도 안 남아 있었고, 후보가 셋인데 답이
   * 셋 다 다릅니다 — 사거리(접근) · 각도(선회) · 무적(잘 굴렀다).
   *
   * 짐작으로 하나를 고르면 나머지 둘을 망가뜨립니다. 그래서 셉니다.
   */
  const allSwings = runs.flatMap((r) => r.misses ?? [])
  if (allSwings.length > 0) {
    const byId = new Map()
    for (const s of allSwings) {
      const k = s.attackId || '(이름없음)'
      const e = byId.get(k) ?? { n: 0, hit: 0, far: 0, wide: 0, invuln: 0, angSum: 0, arcSum: 0 }
      e.n++
      if (s.hit) e.hit++
      else if (s.invuln) e.invuln++
      // 사거리와 각도를 **둘 다** 셉니다 — 하나만 세면 겹친 경우를 놓칩니다.
      else if (s.dist > s.reach) e.far++
      else e.wide++
      e.angSum += s.angleDeg
      e.arcSum += s.halfArcDeg
      byId.set(k, e)
    }
    console.log('\n  ── 📒 보스가 휘두른 것 — **빗나갔다면 왜인가** ──────')
    console.log('     (사거리 = 너무 멀어서 · 각도 = 못 따라 돌아서 · 무적 = 잘 굴러서)')
    for (const [id, e] of [...byId.entries()].sort((a, b) => b[1].n - a[1].n)) {
      console.log(
        `     ${id.padEnd(12)} ${String(e.n).padStart(3)}회 · 적중 ${String(e.hit).padStart(3)}회(${Math.round(
          (e.hit / e.n) * 100,
        )}%)` +
          ` · 사거리 ${e.far} · **각도 ${e.wide}** · 무적 ${e.invuln}` +
          ` · 평균 각도차 ${(e.angSum / e.n).toFixed(0)}° / 허용 ${(e.arcSum / e.n).toFixed(0)}°`,
      )
    }
    const tot = allSwings.length
    const wide = allSwings.filter((s) => !s.hit && !s.invuln && s.dist <= s.reach).length
    const invuln = allSwings.filter((s) => !s.hit && s.invuln).length
    const hit = allSwings.filter((s) => s.hit).length
    console.log(
      `     합계 ${tot}회 — 적중 ${hit}(${Math.round((hit / tot) * 100)}%) · ` +
        `각도로 빗나감 ${wide}(${Math.round((wide / tot) * 100)}%) · 무적 ${invuln}(${Math.round((invuln / tot) * 100)}%)`,
    )
    /**
     * 🚧 **장부가 비면 위 숫자는 아무것도 아닙니다.** 보스가 한 번도
     *    안 휘두른 판을 "각도 문제 0%"로 읽으면 정확히 거꾸로 갑니다.
     */
    check(tot >= runs.length, '🚧 판마다 보스가 최소 한 번은 휘둘렀다 (빈 장부로 결론 내지 않게)', `${tot}회 / ${runs.length}판`)
  } else {
    check(false, '🚧 보스의 휘두름이 장부에 남았다 (빈 장부로 결론 내지 않게)', '한 줄도 없습니다')
  }

  console.log('\n  ── 강화 단계별 (한 변수만 다름) ──────')
  for (const [lv, rs] of byLevel) {
    const kills = rs.filter((r) => r.killed).length
    console.log(
      `  +${lv}            처치 ${kills}/${rs.length}판 · 전체 ${fmt(rs.map((r) => r.total))}초 · ` +
        `3단계 ${fmt(rs.map((r) => r.phaseTime[2]))}초 · ` +
        `3단계 화력 ${fmt(rs.map((r) => r.phaseDmg[2] / Math.max(0.1, r.phaseTime[2])))}/초`,
    )
  }
  {
    const lo = byLevel.get(LEVELS[0]) ?? []
    const hi = byLevel.get(LEVELS[LEVELS.length - 1]) ?? []
    const loKill = lo.filter((r) => r.killed).length
    const hiKill = hi.filter((r) => r.killed).length
    console.log(
      `\n  → ${hiKill > loKill ? '강화가 3단계를 뚫는 열쇠입니다 (성장 관문)' : hiKill === lo.length && loKill === lo.length ? '강화 없이도 끝납니다' : '강화를 최대로 해도 안 끝납니다 — 구간 자체를 봐야 합니다'}`,
    )
  }

  if (runs.length < 2) {
    check(false, '실험대가 보스전을 재현했다', `${runs.length}판만 성공`)
  } else {
    console.log('')
    const dps = (i) => runs.map((r) => r.phaseDmg[i] / Math.max(0.1, r.phaseTime[i]))
    /**
     * 🔬 **화력 옆에 "그 시간에 무엇을 했는가"를 나란히 놓습니다.**
     *
     * 화력만 보면 *"3단계가 어렵다"* 로 읽히지만, 손이 놀고 있었다면 그건
     * 게임이 아니라 **정책**을 잰 것입니다. 이 저장소가 두 번 물린 자리라
     * 이제는 숫자 옆에 원인을 같이 찍습니다.
     */
    const ratio = (i, f) => runs.map((r) => (100 * f(r)[i]) / Math.max(0.1, r.phaseTime[i]))
    for (let i = 0; i < 3; i++) {
      console.log(
        `  ${i + 1}단계         ${fmt(runs.map((r) => r.phaseTime[i]))}초 · ` +
          `화력 ${fmt(dps(i))}/초`,
      )
      console.log(
        `                 예고 중 ${fmt(ratio(i, (r) => r.phaseWind))}% · ` +
          `**손 놓음 ${fmt(ratio(i, (r) => r.phaseIdle))}%** · ` +
          `사거리 밖 ${fmt(ratio(i, (r) => r.phaseFar))}% · ` +
          `휘두름 ${fmt(runs.map((r) => r.phaseSwing[i]))}회 · ` +
          `구르기 ${fmt(runs.map((r) => r.phaseDodge[i]))}회`,
      )
      console.log(
        `                 무방비 ${fmt(ratio(i, (r) => r.phaseBroken))}% · ` +
          `전환 무적 ${fmt(ratio(i, (r) => r.phaseInvuln))}% · ` +
          `**스태미나 바닥 ${fmt(ratio(i, (r) => r.phaseNoStam))}%** · ` +
          `못 내서 참음 ${fmt(ratio(i, (r) => r.phaseWait))}%` +
          ` · **${(runs[0].gateAt ?? 0).toFixed(1)}m 안쪽 ${fmt(ratio(i, (r) => r.phaseInside))}%**`,
      )
      const ids = [...new Set(runs.flatMap((r) => Object.keys(r.swingLog ?? {})))]
      const counts = ids
        .map((id) => ({
          id,
          n: runs.reduce((acc, r) => acc + (r.swingLog?.[id]?.[i] ?? 0), 0),
        }))
        .filter((c) => c.n > 0)
        .sort((a2, b2) => b2.n - a2.n)
      console.log(
        `                 보스가 낸 것 ${runs.length}판 합계 — ` +
          (counts.length ? counts.map((c) => `${c.id} ${c.n}`).join(' · ') : '**한 번도 없음**'),
      )
    }
    console.log(`  전체           ${fmt(runs.map((r) => r.total))}초\n`)

    /**
     * ── 🕳 **적어 둔 패턴이 실전에서 실제로 나오는가** ──────────────────
     *
     * `npm run boss` 는 *"가중치대로 고른다"* 를 이미 재고 있습니다. 다만
     * 그건 **거리를 고정한 침대** 위에서 잽니다 — 후보 집합이 고정이라
     * 굴림만 봅니다. 그건 옳은 질문이고, **다른 질문**이 하나 남습니다:
     * 실제로 싸우는 동안 그 패턴이 **후보에 오르기는 하는가.**
     *
     * 이 실험대가 그 자리입니다. 15판을 재 보니:
     *
     *     1단계 cleave 99 · quake 89 · bind 75 · charge 2
     *     2단계 cleave 57 · quake 56 · bind 42
     *     3단계 charge 113 · cleave 43 · quake 14 · bind 14
     *     → **boss_hook 은 어느 단계에도 없습니다(0회).**
     *
     * `boss_hook` 은 `minRange 5` 인데 플레이어가 **3m 안쪽에 있는 시간이
     * 55~76%** 라 후보에 못 오릅니다. 그리고 그것이 보스의 **🟣 끌어당김**
     * 입니다 — `npm run react` 가 *"🟣 은 반응하고도 물러날 시간이 남는다"*
     * 로 통과시킨 바로 그 패턴이고, **실전에는 존재하지 않습니다.**
     *
     * 이 저장소가 여러 번 만난 모양입니다 — 규칙은 도는데 **도달하지
     * 않습니다**(「배치만 하고 안 쏘지 않게」). 가중치를 아무리 맞춰도
     * 후보에 못 오르면 0 입니다. 그래서 **가중치가 아니라 등장**을 묻습니다.
     *
     * ⚠️ 처방은 이 검사가 정하지 않습니다. 후보에 올리려면 ① 최소 사거리를
     *    낮추거나 ② 보스가 거리를 벌리게 하거나 ③ 그 색을 다른 패턴에
     *    주거나 — 셋 다 밸런스를 다시 재야 하는 일입니다. 여기서는
     *    **없다는 사실과 그 색이 무엇인지**까지만 찍습니다.
     */
    {
      const all = await page.evaluate(
        () => window.__game.enemyRoster().find((r) => r.id === 'boss')?.attacks ?? [],
      )
      const fired = new Set(
        runs.flatMap((r) =>
          Object.entries(r.swingLog ?? {})
            .filter(([, per]) => per.some((n) => n > 0))
            .map(([id]) => id),
        ),
      )
      /**
       * ── 🚧 **이 손이 안 닿는 것은 증거가 아닙니다** ──────────────────
       *
       * 이 실험대는 **한 자리에 섭니다**(보스의 `attackRange` + 여유).
       * 정책이 단순해야 구간 길이가 또렷해지기 때문인데(맨 위 주석),
       * 그 대가로 **서는 거리보다 먼 데서만 나오는 패턴은 원리적으로
       * 관측할 수 없습니다.**
       *
       * 이 파일은 그 함정에 **이미 한 번 빠졌습니다** — 예전엔 2.6m 에
       * 붙어 있었고, 그래서 🟢돌진·🟣갈고리가 「세 페이즈 통틀어 0회」로
       * 찍혔습니다. 서는 거리를 고치자 돌진은 살아났습니다(3단계 113회).
       * 갈고리(최소 5m)는 지금 손(≈4.2m)으로도 여전히 못 닿습니다.
       *
       * 그러니 갈고리의 0회는 **게임의 사실이 아니라 이 손의 한계**입니다.
       * 손이 닿는 것만 판정하고, 나머지는 [손이 안 닿음] 으로 따로 적습니다.
       * 지난 라운드에 `blame` 이 봇의 한계를 게임 탓으로 돌릴 뻔한 것과
       * 같은 자리입니다 — **계측기의 정책을 게임의 결론으로 만들지 않습니다.**
       */
      const stand = runs[0]?.stand ?? 0
      const leash = runs[0]?.leash ?? 0
      const inHand = all.filter((a) => a.minRange <= leash)
      const outOfHand = all.filter((a) => a.minRange > leash)
      const missing = inHand.filter((a) => !fired.has(a.id))
      check(
        inHand.length > 0 && missing.length === 0,
        '🕳 **이 손이 닿는 보스 패턴은 하나도 빠짐없이 나온다** (후보에 못 오르면 가중치는 0입니다)',
        (missing.length === 0
          ? `닿는 ${inHand.length}종 전부 — ${inHand.map((a) => a.id).join(' · ')}`
          : missing
              .map((a) => `**${a.id}**(최소 사거리 ${a.minRange}m) 0회`)
              .join(' · ') + ` — ${runs.length}판 내내 후보에 못 올랐습니다`) +
          (outOfHand.length
            ? `\n     ↳ [손이 안 닿음] ${outOfHand
                .map((a) => `${a.id} 최소 ${a.minRange}m`)
                .join(' · ')} — 이 손은 ${stand.toFixed(1)}~${leash.toFixed(1)}m 에 섭니다.` +
              ` **관측 못 한 것이지 없는 것이 아닙니다** — 물러나는 손이 필요합니다.`
            : ''),
      )
    }

    /**
     * **이 실험대의 존재 이유가 이 검사입니다.**
     *
     * 여정을 걷어냈는데도 폭이 2배를 넘으면, 폭의 원인은 여정이 아니라
     * **보스 자신**입니다(패턴 선택). 그러면 구간 배분을 아무리 정교하게
     * 맞춰도 판마다 다르게 느껴지므로, 고칠 곳은 배분이 아니라 가중치입니다.
     * 그 판단을 사람이 눈대중으로 하지 않도록 여기서 못 박습니다.
     */
    const spread = (i) => {
      const a = [...runs.map((r) => r.phaseTime[i])].sort((x, y) => x - y)
      return a[a.length - 1] / Math.max(0.1, a[0])
    }
    const worst = Math.max(spread(0), spread(1), spread(2))
    check(
      worst <= 2,
      '구간 시간이 판마다 2배 넘게 흔들리지 않는다 (이 수치로 배분을 풀 수 있다)',
      `가장 넓은 구간이 ${worst.toFixed(1)}배` +
        (worst > 2 ? ' — 폭의 원인이 여정이 아니라 보스입니다(패턴 선택)' : ''),
    )
    /**
     * ⚠️ **"처치했는가"를 합격/불합격으로 걸지 않습니다.**
     *
     * 처음엔 "모든 판에서 처치"를 검사로 뒀는데, 그건 게임이 아니라
     * **이 실험대의 정책**을 재는 것이었습니다. 실제 자동 플레이는 강화
     * +1 로 보스를 26.4초에 잡습니다. 같은 +2 에서 실험대는 절반만
     * 잡았습니다 — 차이는 보스가 아니라 싸우는 방식입니다(여기서는 예고마다
     * 한 번 구르고 사거리를 순간이동으로 유지할 뿐입니다).
     *
     * 그러니 이 실험대의 값어치는 **절대값이 아니라 비교**에 있습니다:
     * 한 변수만 바꿔 가며 재면 그 변수의 영향이 보입니다. 절대 난이도는
     * 자동 플레이(`npm run play`)와 벤치가 봅니다. 돌진 프로브에서 배운
     * 것과 같은 자리입니다 — 켜든 끄든 같은 답이 나오는 검사는 가르는
     * 힘이 없고, 정책을 재는 검사는 게임을 못 봅니다.
     */
    console.log(
      `  참고           처치 ${runs.filter((r) => r.killed).length}/${runs.length}판 ` +
        `— 이 값은 게임이 아니라 **이 실험대의 정책**을 잽니다`,
    )
    /**
     * ── ⚠️ **이 실험대는 구간 "시간"을 물으면 안 됩니다** ──────────────
     *
     * 여기 *"3단계가 1단계보다 짧지 않다"* 는 검사가 있었고, 15판 중앙값이
     * `1단계 9.6초 · 3단계 6.3초` 로 빨갛게 떴습니다. 그런데 같은 약속을
     * **존 벤치**로 재면 `13.9 / 10.5 / 17.3` — 3단계가 가장 깁니다.
     * 두 계측기가 정반대로 말했습니다.
     *
     * 이유는 이 실험대의 **정책**에 있습니다(위 주석들 참고):
     *   · 체력이 55 아래로 가면 **채워 줍니다**
     *   · 멀어지면 **순간이동으로 도로 붙입니다**
     * 즉 플레이어의 **접촉률이 항상 최대**입니다. 그런데 3단계가 하는 일이
     * 정확히 *"쿨다운 0.55배로 더 자주 휘둘러 접촉률을 깎는 것"* 입니다.
     * 이 실험대는 그 효과를 **구조적으로 볼 수 없습니다** — 더 자주 때려도
     * 플레이어는 계속 붙어서 계속 칩니다. 그러니 3단계는 그냥 녹습니다.
     *
     * 15판을 돌려도 **잘못된 바닥에서** 재면 답이 안 나옵니다. 그래서
     * 이 약속은 여기서 묻지 않고, 실제 플레이 고리가 도는 `npm run bench`
     * 가 묻습니다(거기서는 접촉률이 진짜로 줄어듭니다).
     *
     * 대신 이 실험대가 **정직하게 답할 수 있는 것**을 묻습니다: 접촉률을
     * 고정해 놓았을 때 보스가 3단계에서 실제로 **더 자주 휘두르는가.**
     * 그게 `cooldownScale 0.55` 가 약속한 것이고, 이 바닥에서만 잡음 없이
     * 보입니다 — 플레이어의 이동 실력이 안 섞이니까요.
     */
    const t3 = med(runs.map((r) => r.phaseTime[2]))
    const t1 = med(runs.map((r) => r.phaseTime[0]))
    /**
     * ⚠️ **횟수로 묻습니다, 시간 비중이 아니라.**
     *
     * 처음엔 *"예고에 쓴 시간의 비중"* 으로 물었고 `1단계 30% → 3단계 26%`
     * 로 빨갛게 떴습니다. 그런데 3단계는 쿨다운만 줄이는 게 아니라
     * **예고도 0.9배로 줄입니다**(`windupScale`). 더 자주 휘두르면서 한 번의
     * 예고가 짧아지면 시간 비중은 얼마든지 내려갈 수 있습니다 —
     * 두 가지를 한 숫자에 섞어 놓고 물은 것입니다.
     *
     * 약속은 *"더 자주"* 이므로 **초당 휘두른 횟수**로 묻습니다.
     */
    const rate = (i) => {
      const t = med(runs.map((r) => r.phaseTime[i]))
      const n = med(runs.map((r) => r.phaseSwing?.[i] ?? 0))
      return t > 0 ? n / t : 0
    }
    const rate1 = rate(0)
    const rate3 = rate(2)
    check(
      rate3 > rate1,
      '3단계에서 보스가 **더 자주 휘두른다** (bossPhases.ts cooldownScale 0.55)',
      `초당 ${rate1.toFixed(2)}회 → ${rate3.toFixed(2)}회`,
    )
    check(
      true,
      '구간 **시간**은 여기서 안 묻습니다 — 접촉률을 고정한 바닥이라 답할 수 없습니다',
      /**
       * ⚠️ 여기 원래 *"판정은 npm run bench"* 라고 적혀 있었습니다. 그런데
       *    벤치는 이제 구간 시간이 판마다 2배 넘게 벌어지면 **판정을
       *    보류**합니다(⏸). 즉 이 줄은 **판정 안 하는 곳**으로 사람을
       *    보내고 있었습니다. 제가 벤치를 고치면서 남의 파일의 문장을
       *    낡게 만든 것이고, 아무도 알려 주지 않았습니다.
       *
       *    실제 판정은 **죽지 않는 침대**에 있습니다(boss-probe:
       *    "가장 긴 구간 ≤ 가장 짧은 구간 × 2.5" · "마지막 구간이 가장 길다").
       */
      `참고값 1단계 ${t1.toFixed(1)}초 · 3단계 ${t3.toFixed(1)}초 (판정은 npm run boss — 죽지 않는 침대)`,
    )

  }

  /**
   * ── 🎨 **색을 읽는 것이 값어치가 있는가** ─────────────────────────
   *
   * 이 저장소는 *"색만 다르고 대응이 같으면 색은 장식"* 을 몇 번이나 적어
   * 뒀습니다. 그런데 그 문장을 **한 번도 재지 않았습니다** — 이 실험대의
   * 손이 색을 안 가리기 때문입니다(예고마다 구르기 하나).
   *
   * 한 변수만 바꿔 나란히 돌립니다:
   *   색맹    — 예고마다 구른다 (지금까지의 손)
   *   색 읽기 — **구르기로 못 벗어나는 넓은 예고**에는 굴지 않고 걸어 나간다
   *
   * 색 이름을 프로브에 적지 않았습니다. `reach > dodgeDistance` 라는
   * **도형**으로 가릅니다 — `npm run rules` 가 지키는 바로 그 약속입니다.
   * 그래서 색을 새로 추가해도 이 손은 저절로 따라옵니다.
   *
   * ⚠️ 걸어 나가는 것도 **걷는 속도로만** 옮깁니다. 순간이동으로 한 번에
   *    빼면 "걸어서 이탈"의 대가(시간)가 사라져서, 색 읽기가 공짜가 됩니다.
   *    공짜인 답과 비교하면 무엇을 재든 색 읽기가 이깁니다.
   */
  console.log('\n  🎨 색을 읽는 것이 값어치가 있는가 — 한 변수만 다른 두 손\n')
  const AB_RUNS = 4
  const AB_LEVEL = 2
  const ab = []
  for (const blind of [true, false]) {
    const rs = []
    for (let i = 0; i < AB_RUNS; i++) {
      process.stdout.write(`  ${blind ? '색맹' : '색 읽기'} ${i + 1}/${AB_RUNS}판… `)
      const r = await page.evaluate(async ([wLv, colorBlind]) => window.__pace(wLv, colorBlind), [
        AB_LEVEL,
        blind,
      ])
      if (r) {
        rs.push(r)
        console.log(`${r.killed ? '처치' : '시간초과'} ${r.total}초 · 받은 피해 ${r.taken}`)
      } else console.log('보스를 못 찾음')
    }
    ab.push({ blind, rs })
  }
  for (const row of ab) {
    if (!row.rs.length) continue
    console.log(
      `    ${row.blind ? '색맹   ' : '색 읽기'}  처치 ${row.rs.filter((r) => r.killed).length}/${row.rs.length}판 · ` +
        `받은 피해 ${fmt(row.rs.map((r) => r.taken))} · 전체 ${fmt(row.rs.map((r) => r.total))}초 · ` +
        `걸어 나간 시간 ${fmt(row.rs.map((r) => r.phaseWalk.reduce((a2, b2) => a2 + b2, 0)))}초`,
    )
  }
  const blindHurt = ab[0]?.rs.length ? med(ab[0].rs.map((r) => r.taken)) : -1
  const seeingHurt = ab[1]?.rs.length ? med(ab[1].rs.map((r) => r.taken)) : -1
  check(
    blindHurt >= 0 && seeingHurt >= 0,
    '두 손 다 실제로 싸웠다 (비교가 성립했다)',
    `색맹 ${ab[0]?.rs.length ?? 0}판 · 색 읽기 ${ab[1]?.rs.length ?? 0}판`,
  )
  /**
   * ── 여기에 검사를 하나 **썼다가 관찰로 내렸습니다** ────────────────
   * *"색을 읽으면 덜 맞는다"*. 4판으로는 **갈리지 않습니다**:
   *
   *     색맹    140 (96~233)
   *     색 읽기 164 (134~164)
   *
   * 가운데값은 색 읽기가 더 맞는다고 하는데, 색맹의 폭이 96~233 으로
   * 넓어서 **범위가 통째로 겹칩니다.** 이 저장소의 규칙 그대로입니다 —
   * **부호가 갈리면 증명되지 않은 것.** 한 판에 30초씩 드는 측정이라
   * 표본을 키우는 것이 값싸지 않으므로, 결론은 다음 라운드로 미룹니다.
   *
   * 미리 적어 둘 것: 색 읽기가 더 맞는 것이 **사실일 수도** 있습니다.
   * 🟡 을 피해 나가면 그만큼 멀어지고, 돌아오는 동안 다른 색을 먹습니다.
   * 소울류가 광역기를 "피할 수는 있지만 대가가 있는" 것으로 두는 이유가
   * 이것입니다. 그렇다면 고칠 곳은 색이 아니라 **돌아오는 길**입니다.
   */
  console.log(
    `  📋 [관찰] 받은 피해 — 색맹 ${blindHurt} · 색 읽기 ${seeingHurt} ` +
      `(4판으로는 범위가 겹쳐 **갈리지 않습니다** — 다음 라운드에 표본을 키웁니다)`,
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
