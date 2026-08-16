/**
 * 🩸 맞은 한 대는 공정했는가 — `npm run blame`
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * DESIGN.md 기둥 2의 합격 기준은 이 프로젝트 안에 **여섯 군데**에 적혀
 * 있습니다:
 *
 *   > 죽었을 때 **"내가 못 봤네"** 가 아니라 **"내가 못 피했네"** 라고
 *   > 말해야 합니다.
 *
 * 그런데 **한 번도 잰 적이 없습니다.** 적어 두기만 한 기준은 지켜지는지
 * 알 수 없고, 이 저장소에서 그런 것은 늘 조용히 무너져 있었습니다
 * (보물 0개 · 연계 0회 · 안 보이던 초록 예고 · 죽은 봇의 돌기 분기).
 *
 * 하데스는 죽고 나면 **무엇에게 죽었는지** 보여 줍니다. 소울류에서 죽음이
 * 납득되는 이유도 같습니다 — 때린 것이 무엇이었는지, 예고가 있었는지가
 * 분명합니다. 우리는 죽음만이 아니라 **맞은 것 전부**를 적습니다. 죽음은
 * 표본이 너무 적어서 한 판에 몇 줄 안 나옵니다.
 *
 * ── 판정은 게임이 내립니다 ─────────────────────────────────────
 * 이 프로브는 **세기만** 합니다. "볼 수 있었나 · 답할 수 있었나"는 예고가
 * 도는 동안 main.ts 가 프레임마다 모아서 스스로 판정합니다. 맞고 나서
 * 프로브가 되짚으면 화면도 상태도 이미 바뀌어 있어서 남는 건 추측뿐입니다.
 *
 *   tooFast — 예고가 반응 시간보다 짧았다 (원리적으로 못 읽음)
 *   unseen  — 예고는 있었는데 **화면 밖**이었다 ("내가 못 봤네")
 *   locked  — 봤지만 **손이 묶여** 있었다 ("손쓸 방법이 없었네")
 *   fair    — 볼 수 있었고 답할 수 있었다 ("내가 못 피했네")
 *
 * ── 통과만 하는 검사는 아무것도 증명하지 않습니다 ──────────────
 * 그래서 **같은 싸움을 두 번** 돌립니다. 두 판의 차이는 하나뿐입니다 —
 * 플레이어가 답할 수 있느냐. 장부가 두 판을 다르게 적지 못하면, 그
 * 장부는 "공정하다"고 말할 자격이 없습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5227
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}
// 'locked:stamina' 처럼 이유가 붙어 오므로 앞머리로 묶어 셉니다.
const head = (v) => v.split(':')[0]
const tally = (rows) => {
  const t = {}
  for (const r of rows) t[r.verdict] = (t[r.verdict] ?? 0) + 1
  return t
}
const heads = (rows) => {
  const t = {}
  for (const r of rows) t[head(r.verdict)] = (t[head(r.verdict)] ?? 0) + 1
  return t
}
const show = (t) =>
  Object.entries(t)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ') || '없음'

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

  console.log('\n🩸 맞은 한 대는 공정했는가 — 볼 수 있었고, 답할 수 있었는가\n')

  const budget = await page.evaluate(() => window.__game.reactionBudget())
  console.log(`  [기준] 반응 예산 ${budget.choice}초 (${budget.colors.length}색). 예고·시야·자유 시간이`)
  console.log('         모두 이 값을 넘겨야 "볼 수 있었고 답할 수 있었다"가 됩니다.\n')

  /**
   * 한 판을 세웁니다.
   *
   * @param cripple 참이면 매 순간 기력을 0으로 눌러 **구르기를 못 하게** 합니다.
   *   싸움 자체는 위 판과 똑같습니다 — 달라지는 것은 답할 수 있느냐뿐입니다.
   */
  const round = async (cripple, mode = 'idle') =>
    page.evaluate(
      async ([kill, how]) => {
        const G = window.__game
        const sleep = () => new Promise((r) => setTimeout(r, 8))
        const now = () => G.state().simElapsed

        G.reset()
        const t0 = now()
        while (now() - t0 < 0.6) await sleep()
        G.clearEnemies()
        while (now() - t0 < 1.0) await sleep()

        // 플레이어 주위에 붙여 둡니다 — 맞는 표본이 있어야 장부가 채워집니다.
        const px = G.state().player.x
        const pz = G.state().player.z
        G.spawnEnemyKind('grunt', px + 2.2, pz)
        G.spawnEnemyKind('grunt', px - 2.2, pz)
        G.spawnEnemyKind('grunt', px, pz + 2.2)

        /**
         * 플레이어는 **아무것도 하지 않습니다.** 봇처럼 잘 싸우면 안 맞아서
         * 장부가 안 채워지고, 잘 피하면 "공정했나"를 물을 사건 자체가
         * 사라집니다. 여기서 재려는 것은 실력이 아니라 **기회**입니다.
         */
        /**
         * ⚠️ **매 프레임 붙들어야 합니다.** 예전엔 아래 루프에서 8ms 마다
         *    `setStamina(0)` 을 썼는데, 그 사이에도 시뮬레이션이 돌면서
         *    기력이 회복됩니다(34/초). 문턱이 25 였을 땐 티가 안 났지만
         *    문턱이 *"0보다 큰가"* 로 바뀌자 **0을 쓰자마자 차올라** 이 판이
         *    더 이상 "기력 0" 이 아니게 됐고, 검사 셋이 한꺼번에 빨개졌습니다.
         *    재려는 조건은 **게임이** 지켜 줘야 합니다.
         */
        if (kill) G.pinStamina(0)
        const t1 = now()
        let wasWinding = false
        while (now() - t1 < 22) {
          // 죽으면 그 뒤로는 맞을 일이 없으니 체력만 채워 둡니다.
          if (G.state().player.hp < 40) G.setHp(G.playerEntity(), 100)
          /**
           * 🎯 **예고가 뜨는 순간 굴러 버리는 판.**
           *
           * 사람이 겁먹고 미리 굴렀을 때와 같은 모양입니다 — 무적은
           * 0.06~0.3초뿐인데 실제 타격은 예고 1초 뒤에 오니, 구른 것이
           * **아무 소용이 없습니다.** 장부가 이걸 `fair:일찍` 로 적어야
           * "안 눌렀다"와 구분됩니다.
           */
          if (how === 'eager') {
            G.setStamina(100)
            const winding = G.telegraphs().length > 0
            if (winding && !wasWinding) {
              G.press('Space')
              await sleep()
              G.release('Space')
            }
            wasWinding = winding
          }
          await sleep()
        }
        return G.hurtLedger()
      },
      [cripple, mode],
    )

  const free = await round(false)
  const bound = await round(true)
  const eager = await round(false, 'eager')

  const tFree = heads(free)
  const tBound = heads(bound)
  const dFree = tally(free)
  const dBound = tally(bound)
  const dEager = tally(eager)
  console.log(`  [자유롭게 서 있기] ${free.length}대 맞음 — ${show(dFree)}`)
  console.log(`  [기력 0 으로 묶음] ${bound.length}대 맞음 — ${show(dBound)}`)
  console.log(`  [예고 뜨자마자 구름] ${eager.length}대 맞음 — ${show(dEager)}\n`)

  check(free.length > 0 && bound.length > 0, '두 판 모두 실제로 맞았다 (빈 장부로 통과하지 않게)', `${free.length}대 · ${bound.length}대`)

  /**
   * ---- 1. 계측기가 살아 있는가 ----
   *
   * `unknown` 은 "때린 놈이 누구인지 못 찾았다"는 뜻입니다. 하나라도 나오면
   * 나머지 숫자는 전부 못 믿습니다 — 얼마나 빠졌는지 알 수 없으니까요.
   */
  const unknown = free.filter((r) => r.verdict === 'unknown').length + bound.filter((r) => r.verdict === 'unknown').length
  check(unknown === 0, '모든 한 대의 출처를 찾았다 (귀속이 추측이 아니다)', `unknown ${unknown}대`)

  /**
   * ---- 2. **장부가 두 판을 다르게 적는가** ----
   *
   * 이게 이 프로브의 뼈대입니다. 기력을 0으로 묶은 판은 예고를 다 봤어도
   * 구르기를 시작할 수 없으므로 `locked` 여야 합니다. 두 판이 똑같이
   * 나오면 장부는 아무것도 재고 있지 않은 것이고, 아래 3번은 통과해도
   * 의미가 없습니다.
   */
  check(
    (dBound['locked:stamina'] ?? 0) > 0,
    '기력으로 묶은 판을 **locked:stamina 로 적는다** (이유까지 맞히는지 확인)',
    `묶인 판 locked:stamina ${dBound['locked:stamina'] ?? 0}대 / 자유 판 ${dFree['locked:stamina'] ?? 0}대`,
  )
  check(
    (tBound.locked ?? 0) > (tFree.locked ?? 0),
    '같은 싸움인데 **묶은 쪽이 더 억울하다** (두 판을 갈라서 적는다)',
    `${tFree.locked ?? 0}대 → ${tBound.locked ?? 0}대`,
  )

  /**
   * ---- 3. 그래서 **기준을 지키고 있는가** ----
   *
   * 자유로운 판에서 맞은 한 대는 전부 *"내가 못 피했네"* 여야 합니다.
   * `unseen` 이나 `tooFast` 가 섞이면 그건 플레이어 잘못이 아닙니다.
   */
  const unfair = free.filter((r) => head(r.verdict) === 'unseen' || head(r.verdict) === 'tooFast')
  check(
    unfair.length === 0,
    '자유로울 땐 맞은 한 대가 전부 **볼 수 있었던 것**이다 ("내가 못 봤네"가 없다)',
    unfair.length
      ? unfair.slice(0, 3).map((r) => `${r.attackId} ${r.verdict}(예고 ${r.telegraph}초/보인 ${r.seen}초)`).join(' · ')
      : `${free.length}대 전부`,
  )

  /**
   * ---- 3.5 **"못 피함"이 정말 갈라지는가** ----
   *
   * `fair` 한 칸에 40대가 뭉쳐 있던 것을 셋으로 쪼갰습니다(main.ts
   * `noteHurt`). 쪼갠 것이 **실제로 다른 것을 가리키는지**를 여기서
   * 확인합니다 — 안 그러면 칸만 늘고 뜻은 그대로입니다.
   *
   * 두 판이 정반대여야 합니다:
   *   · 가만히 선 판  — 한 번도 안 굴렀으니 전부 `안누름`
   *   · 뜨자마자 구른 판 — 굴렀지만 무적(0.06~0.3초)이 타격 전에 끝나므로 `일찍`
   *
   * 두 판이 같은 칸으로 나오면 장부는 **구르기를 보고 있지 않은** 것입니다.
   */
  const idleFair = free.filter((r) => r.verdict.startsWith('fair'))
  const eagerFair = eager.filter((r) => r.verdict.startsWith('fair'))
  check(
    idleFair.length > 0 && eagerFair.length > 0,
    '🎯 두 판 모두 "못 피함"이 실제로 나왔다 (빈 장부로 비교하지 않게)',
    `가만히 ${idleFair.length}대 · 뜨자마자 ${eagerFair.length}대`,
  )
  check(
    idleFair.length > 0 && idleFair.every((r) => r.verdict === 'fair:안누름'),
    '🎯 **가만히 선 판은 전부 `안누름`** (구른 적이 없으니 다른 칸이 나오면 안 됩니다)',
    show(tally(idleFair)),
  )
  check(
    (dEager['fair:일찍'] ?? 0) > 0 && (dEager['fair:일찍'] ?? 0) > (dEager['fair:안누름'] ?? 0),
    '🎯 **뜨자마자 구른 판은 `일찍`으로 적힌다** (같은 한 대를 다르게 적는다)',
    `일찍 ${dEager['fair:일찍'] ?? 0}대 · 안누름 ${dEager['fair:안누름'] ?? 0}대` +
      ` · 구른 뒤 평균 ${
        eagerFair.filter((r) => r.sinceTry >= 0).length
          ? (
              eagerFair.filter((r) => r.sinceTry >= 0).reduce((a, r) => a + r.sinceTry, 0) /
              eagerFair.filter((r) => r.sinceTry >= 0).length
            ).toFixed(2)
          : '?'
      }초에 맞음 (무적은 0.3초까지)`,
  )

  /**
   * ---- 4. 자유로운데도 묶였다고 적히면 그건 **후딜이 너무 길다**는 뜻 ----
   *
   * 아무 것도 안 하고 서 있는데 `locked` 가 나오면, 남은 원인은 경직
   * (맞고 굳는 시간)뿐입니다. 그게 예고보다 길면 **한 번 맞은 것이 다음
   * 한 대를 부르는** 구조가 됩니다 — 소울류에서 가장 미움받는 모양입니다.
   */
  const lockedRate = free.length ? (tFree.locked ?? 0) / free.length : 0
  check(
    lockedRate <= 0.5,
    '가만히 서 있을 때 **경직으로 묶여 맞는 비율**이 절반을 넘지 않는다',
    `${((lockedRate * 100) | 0)}% (${tFree.locked ?? 0}/${free.length})`,
  )

  /**
   * ---- 5. **장부를 플레이어에게 돌려줍니다** ----
   *
   * 위 검사들은 전부 *우리가* 공정함을 아는지를 봅니다. 그런데 기둥 2의
   * 기준은 **플레이어가** *"내가 못 피했네"* 라고 말하는 것입니다. 말할
   * 재료를 안 주면 그 대사는 나올 수 없습니다 — 지금까지 죽으면 화면에
   * `웨이브 1 · 0마리 처치` 만 떴습니다.
   *
   * 그래서 죽여 보고 **화면에 실제로 뜬 글자**를 읽습니다. 게임 내부의
   * 값을 다시 묻지 않습니다 — 내부가 맞아도 화면에 안 뜨면 없는 것입니다.
   */
  console.log('')
  const die = async (starve) => {
    await page.evaluate(
      async ([kill]) => {
        const G = window.__game
        const sleep = () => new Promise((r) => setTimeout(r, 8))
        const now = () => G.state().simElapsed
        G.reset()
        const t0 = now()
        while (now() - t0 < 0.6) await sleep()
        G.clearEnemies()
        while (now() - t0 < 1.0) await sleep()
        const px = G.state().player.x
        const pz = G.state().player.z
        G.spawnEnemyKind('grunt', px + 2.2, pz)
        G.spawnEnemyKind('grunt', px - 2.2, pz)
        // 위와 같은 이유로 **붙들어** 둡니다 — 한 번 써 넣는 것으론 안 됩니다.
        if (kill) G.pinStamina(0)
        const t1 = now()
        while (now() - t1 < 30) {
          // 죽을 때까지 체력을 아주 낮게 눌러 둡니다 — 한 대면 끝나게.
          if (G.state().player.hp > 6) G.setHp(G.playerEntity(), 6)
          if (G.state().player.hp <= 0) break
          await sleep()
        }
        // 배너가 그려질 한 프레임을 줍니다.
        const t2 = now()
        while (now() - t2 < 0.4) await sleep()
      },
      [starve],
    )
    return page.evaluate(() => ({
      title: document.getElementById('bannerTitle')?.textContent ?? '',
      sub: document.getElementById('bannerSub')?.textContent ?? '',
    }))
  }

  const deathFree = await die(false)
  const deathStarved = await die(true)
  console.log(`  [자유롭게 죽음] ${deathFree.title} · ${deathFree.sub}`)
  console.log(`  [기력 0 로 죽음] ${deathStarved.title} · ${deathStarved.sub}\n`)

  check(
    /쓰러졌다|떨어졌다/.test(deathFree.sub),
    '죽음 화면이 **무엇에 쓰러졌는지**를 말한다 (점수만 찍지 않는다)',
    deathFree.sub || '(빈 화면)',
  )
  check(
    deathFree.sub !== deathStarved.sub,
    '죽은 **이유가 다르면 문장도 다르다** (돌려 쓰는 문구가 아니다)',
    `"${deathFree.sub}" vs "${deathStarved.sub}"`,
  )
  check(
    /기력/.test(deathStarved.sub),
    '기력이 없어 죽으면 화면이 **기력을 지목한다** (다음 판에 바꿀 것을 짚어 준다)',
    deathStarved.sub || '(빈 화면)',
  )

  /**
   * ---- 6. 🛡 **방어의 값** — 위 3·4번이 부른 처방을 재 봅니다 ----
   *
   * 3판 벤치가 *"맞은 이유 45대 · 못 피함 27(60%) · 손이 묶임 stamina 15"* 를
   * 찍었고, 예시로 뽑힌 여덟 줄이 **전부** `locked:stamina` 였습니다.
   *
   * ⚠️ **먼저 문턱을 없애 봤고, 되돌렸습니다.** 소울류의 실제 규칙(*"0보다
   *    크면 나간다"*)로 바꿨더니 봇이 판당 42회를 빚내며 영구 파산했고
   *    받은 피해 162 → 280, 클리어 195 → 248초로 **더 나빠졌습니다.**
   *    문턱은 스스로를 지키는 브레이크였습니다. 고칠 곳은 **값**이었습니다.
   *
   * 그래서 여기서 재는 것은 셋입니다:
   *   ① 방어(구르기)가 **공격 두 대보다 싸다**   ← 소울류에서 뒤집힌 적 없는 부등호
   *   ② 값 이상이면 나간다
   *   ③ 값보다 적으면 **못 낸다**                ← 실패할 수 있는 검사
   */
  console.log('')
  const rule = await page.evaluate(() => window.__game.dodgeInfo())
  const arms = await page.evaluate(() => window.__game.weaponTable())
  console.log(`  [규칙] 키 ${rule.key} · 구르기 ${rule.cost} · 회복지연 ${rule.regenDelay}초`)

  /**
   * ① **방어가 공격보다 싸야 합니다.**
   *
   * 블러드본의 퀵스텝은 공격보다 싸고, 엘든 링의 구르기는 강공격보다
   * 싸며, 세키로는 회피에서 자원을 아예 뺐습니다. 이 부등호가 뒤집히면
   * **공격한 사람이 방어할 수 없습니다** — 벤치의 `locked:stamina` 가
   * 그 모양이었습니다.
   *
   * 견주는 대상을 "가벼운 공격 두 대"로 잡은 근거: 한 번의 교전에서 두 대는
   * 넣고 물러나는 것이 이 게임의 기본 리듬이고(콤보 3타 중 둘), 그 뒤에
   * 구르지 못하면 리듬 자체가 성립하지 않습니다.
   */
  const flipped = arms.filter((w) => !(w.dodgeCost < w.firstTwoStamina))
  check(
    arms.length >= 3 && flipped.length === 0,
    '**세 무기 모두** 구르기가 가벼운 공격 두 대보다 싸다 (방어가 공격보다 비싸면 안 됩니다)',
    arms.map((w) => `${w.id} ${w.dodgeCost}<${w.firstTwoStamina}${w.dodgeCost < w.firstTwoStamina ? '' : ' ❌'}`).join(' · '),
  )

  /** 기력을 붙들어 두고 구르기를 한 번 눌러 봅니다. */
  const tryRoll = (stamina) =>
    page.evaluate(
      async ([sta]) => {
        const G = window.__game
        const sleep = () => new Promise((r) => setTimeout(r, 8))
        const now = () => G.state().simElapsed
        G.reset()
        const t0 = now()
        while (now() - t0 < 0.6) await sleep()
        // 적이 없어야 맞아서 굳는 것과 섞이지 않습니다 — 재려는 건 기력 하나입니다.
        G.clearEnemies()
        while (now() - t0 < 1.2) await sleep()
        /**
         * 붙들어 둡니다 — 누르는 프레임에 **실제로 그 값이어야** 합니다.
         * 한 번 써 넣기만 하면 눌리기 전에 회복이 값을 올려 버립니다.
         */
        G.pinStamina(sta)
        while (now() - t0 < 1.4) await sleep()
        const before = G.dodgeInfo()
        const key = before.key
        G.press(key)
        G.release(key)
        /** 구르기가 **시작됐는지**만 봅니다. 판정은 게임의 `rolling` 이 내립니다. */
        let rolled = false
        const t1 = now()
        while (now() - t1 < 0.5) {
          if (G.dodgeInfo().rolling) {
            rolled = true
            break
          }
          await sleep()
        }
        G.pinStamina(null)
        return { before, rolled }
      },
      [stamina],
    )

  const rich = await tryRoll(Math.ceil(rule.cost) + 5)
  const poor = await tryRoll(Math.max(0, Math.floor(rule.cost) - 5))
  console.log(
    `  [기력 ${rich.before.stamina}] 굴렀나 ${rich.rolled ? 'O' : 'X'} · 막은 것 "${rich.before.block}"`,
  )
  console.log(
    `  [기력 ${poor.before.stamina}] 굴렀나 ${poor.rolled ? 'O' : 'X'} · 막은 것 "${poor.before.block}"\n`,
  )
  check(
    rich.rolled && rich.before.block === '',
    '값 이상이면 구르기가 나간다',
    `기력 ${rich.before.stamina} ≥ ${rule.cost} — ${rich.rolled ? '나감' : `막힘("${rich.before.block}")`}`,
  )
  check(
    !poor.rolled && poor.before.block === 'stamina',
    '값보다 적으면 **못 낸다** (이 줄이 없으면 위 검사가 아무것도 증명하지 않습니다)',
    `기력 ${poor.before.stamina} < ${rule.cost} — 굴렀나 ${poor.rolled ? 'O' : 'X'} · "${poor.before.block}"`,
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
