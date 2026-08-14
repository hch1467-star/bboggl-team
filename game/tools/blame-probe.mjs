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
  const round = async (cripple) =>
    page.evaluate(
      async ([kill]) => {
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
        while (now() - t1 < 22) {
          // 죽으면 그 뒤로는 맞을 일이 없으니 체력만 채워 둡니다.
          if (G.state().player.hp < 40) G.setHp(G.playerEntity(), 100)
          await sleep()
        }
        return G.hurtLedger()
      },
      [cripple],
    )

  const free = await round(false)
  const bound = await round(true)

  const tFree = heads(free)
  const tBound = heads(bound)
  const dFree = tally(free)
  const dBound = tally(bound)
  console.log(`  [자유롭게 서 있기] ${free.length}대 맞음 — ${show(dFree)}`)
  console.log(`  [기력 0 으로 묶음] ${bound.length}대 맞음 — ${show(dBound)}\n`)

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
   * ---- 6. 🫁 **빚내서 구르기** — 위 3·4번이 부른 처방을 실제로 재 봅니다 ----
   *
   * 3판 벤치가 *"맞은 이유 45대 · 못 피함 27(60%) · 손이 묶임 stamina 15"* 를
   * 찍었고, 예시로 뽑힌 여덟 줄이 **전부** `locked:stamina` 였습니다. 즉
   * 맞은 대의 절반 이상이 *"봤고, 알았고, 눌렀는데 게임이 거절한"* 것입니다.
   *
   * 다크 소울·엘든 링은 행동의 문턱이 *"비용 이상"* 이 아니라 ***"0보다
   * 큰가"*** 이고, 모자란 만큼은 **더 긴 회복 지연**으로 갚습니다.
   * 몬스터헌터도 스태미나가 바닥나도 회피는 나가고 막히는 건 달리기입니다.
   * 세키로는 회피에서 자원을 아예 뺐습니다. 셋의 공통점은 **위험한 순간에
   * 방어 입력을 조용히 거절하지 않는다**입니다.
   *
   * ⚠️ 여기서 재는 것은 네 가지이고, **넷이 다 있어야** 규칙이 규칙입니다:
   *   ① 기력이 모자라도 구르기가 **나간다**       (내주는가)
   *   ② 빚을 지면 회복이 **늦게** 시작된다        (값을 치르는가)
   *   ③ 기력이 **0이면 여전히 못 낸다**           ← 공짜가 아님을 증명
   *   ④ 게임이 그 횟수를 **세고 있다**            ← 안 세면 다음에 못 잰다
   *
   * ③ 이 없으면 "늘 나간다"와 구분이 안 됩니다. 통과만 하는 검사는 아무것도
   * 증명하지 않는다는 이 파일의 뼈대와 같은 이유입니다.
   */
  console.log('')
  const rule = await page.evaluate(() => window.__game.dodgeInfo())
  console.log(
    `  [규칙] 키 ${rule.key} · 비용 ${rule.cost} · 평소 회복지연 ${rule.regenDelay}초 · ` +
      `빚졌을 때 ${rule.exhaustDelay}초`,
  )
  check(
    rule.exhaustDelay > rule.regenDelay,
    '빚졌을 때의 회복 지연이 **평소보다 길다** (값을 치르는 규칙인가)',
    `${rule.regenDelay}초 → ${rule.exhaustDelay}초`,
  )

  /** 기력을 원하는 값으로 맞추고 구르기를 한 번 눌러 봅니다. */
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
        /**
         * ⚠️ **회복 지연을 읽기 전에 풉니다.** 붙들어 둔 채로 읽으면 기력이
         *    안 줄어 빚이 안 생기고, 그러면 재려던 것이 사라집니다.
         *    (구르기는 이미 시작했으므로 값은 그때 정해졌습니다.)
         */
        G.pinStamina(null)
        // 구른 뒤의 회복 지연을 읽습니다 — 빚을 졌으면 여기가 길어야 합니다.
        const after = G.dodgeInfo()
        return { before, after, rolled }
      },
      [stamina],
    )

  /** 비용의 5분의 1만 남긴 상태 — 예전 규칙(`>= 비용`)이면 거절당합니다. */
  const poor = await tryRoll(Math.max(1, Math.round(rule.cost / 5)))
  const empty = await tryRoll(0)
  const rich = await tryRoll(100)
  console.log(
    `  [기력 ${poor.before.stamina}] 굴렀나 ${poor.rolled ? 'O' : 'X'} · 막은 것 "${poor.before.block}" · ` +
      `구른 뒤 회복지연 ${poor.after.regenDelayT}초`,
  )
  console.log(
    `  [기력 ${empty.before.stamina}] 굴렀나 ${empty.rolled ? 'O' : 'X'} · 막은 것 "${empty.before.block}"`,
  )
  console.log(
    `  [기력 ${rich.before.stamina}] 굴렀나 ${rich.rolled ? 'O' : 'X'} · ` +
      `구른 뒤 회복지연 ${rich.after.regenDelayT}초\n`,
  )

  check(
    poor.rolled,
    '기력이 **비용보다 적어도 구르기가 나간다** (읽고 눌렀는데 거절당하지 않는다)',
    `기력 ${poor.before.stamina} < 비용 ${rule.cost} — ${poor.rolled ? '나감' : `막힘("${poor.before.block}")`}`,
  )
  check(
    !empty.rolled && empty.before.block === 'stamina',
    '기력이 **0이면 여전히 못 낸다** (공짜가 아니라는 것 — 이 줄이 없으면 위 검사가 무의미합니다)',
    `굴렀나 ${empty.rolled ? 'O' : 'X'} · 막은 것 "${empty.before.block}"`,
  )
  check(
    poor.after.regenDelayT > rich.after.regenDelayT,
    '빚내서 구르면 **회복이 더 늦게** 시작된다 (뒤에 청구한다)',
    `모자랄 때 ${poor.after.regenDelayT}초 vs 넉넉할 때 ${rich.after.regenDelayT}초`,
  )
  check(
    poor.after.exhausted > poor.before.exhausted,
    '게임이 **빚내서 낸 구르기를 세고 있다** (벤치가 "쓰이질 않았다"와 "효과가 없다"를 가릅니다)',
    `${poor.before.exhausted}회 → ${poor.after.exhausted}회`,
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
