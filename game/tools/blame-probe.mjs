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
        const t1 = now()
        while (now() - t1 < 22) {
          if (kill) G.setStamina(0)
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

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
