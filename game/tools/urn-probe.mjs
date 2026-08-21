/**
 * 🏺 항아리 검증 — `npm run urn`
 *
 * ── 왜 기능과 눈금을 같이 넣는가 ────────────────────────────────────
 * 폭발통을 넣을 때 이 저장소가 적어 둔 문장 그대로입니다:
 * *"없던 것은 기능이 아니라 **눈금**이었습니다."* 기능만 넣고 재는 것이
 * 없으면 이 물건은 **있는지 없는지 아무도 모르는 채로** 남습니다.
 *
 * ── 이 물건의 설계를 세 문장으로 (balance.ts `URN`) ────────────────
 *   ① 한 대면 부서진다 — 체력 싸움이 아니라 **판단**이라야 합니다
 *   ② 부수는 데 **대가가 없다** — 망설이게 만들면 재미가 사라집니다
 *   ③ 그중 어떤 것은 **보물을 품고 있다** — 확률이 아니라 배치입니다
 *
 * 셋 다 *"코드에 그렇게 적혀 있다"* 가 아니라 **눌러서** 확인합니다.
 *
 * ── ⚠️ 규칙값은 게임에서 읽습니다 ───────────────────────────────────
 * 소리 거리(고함 거리와 같은 값)를 여기 적으면, 값을 손보는 날 **검사만
 * 옛 규칙을 지킵니다.** `awareInfo()` 가 게임이 실제로 쓰는 값을 냅니다.
 *
 * ── ⚠️ 이 프로브가 스스로를 못 믿는 자리 ────────────────────────────
 * *"안 깨어났다"* 는 **원인이 없어도 참**이 됩니다 — 애초에 못 깨어날
 * 자리에 세워 두면 무엇을 해도 초록입니다. 그래서 게이트를 둡니다:
 * 적이 정말 자고 있었는가, 항아리가 정말 깨졌는가. 둘 다 아니면 그
 * 판은 **아무것도 말하지 않은 것**입니다.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5248
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

  console.log('\n🏺 항아리 — 마음껏 부수고, 그중 하나가 진짜입니다\n')

  const aware = await page.evaluate(() => window.__game.awareInfo())
  // 거리는 **적이 안 깨어나는지** 확인할 자리를 잡는 데만 씁니다(규칙이 아닙니다).
  console.log(`  [참고] 고함이 닿는 거리 ${aware.alertRadius}m — 항아리는 이 소리를 내지 않습니다\n`)

  /**
   * ── ① 한 대면 부서지는가 ──────────────────────────────────────
   *
   * 플레이어 바로 앞에 세우고 **한 번** 휘두릅니다. 여러 번 때려서
   * 부서지면 이 물건이 묻는 질문이 *"깰까 말까"* 에서 *"몇 대 남았지"* 로
   * 바뀝니다.
   */
  const one = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    const runFor = async (sec) => {
      const t = G.state().simElapsed + sec
      const dl = Date.now() + 30000
      while (G.state().simElapsed < t && Date.now() < dl) await sleep()
    }
    G.reset()
    await runFor(0.3)
    G.clearEnemies()
    await runFor(0.2)
    const p = G.state().player
    // 롱소드 1타가 닿는 자리에 세웁니다.
    G.spawnUrn(p.x, p.z + 1.6, false)
    await runFor(0.2)
    const before = G.urns().length
    G.press('Mouse0')
    await sleep()
    G.release('Mouse0')
    await runFor(1.2)
    return { before, after: G.urns().filter((u) => !u.broken).length }
  })
  check(
    one !== null && one.before === 1,
    '🚧 항아리를 실제로 세웠다 (비교의 게이트)',
    `세운 뒤 ${one?.before ?? '?'}개`,
  )
  check(
    one !== null && one.before === 1 && one.after === 0,
    '🏺 **한 대면 부서진다** (체력 싸움이 아니라 판단이라야 합니다)',
    `한 번 휘두른 뒤 남은 것 ${one?.after ?? '?'}개`,
  )

  /**
   * ── ② **부수는 데 대가가 없어야 합니다** ──────────────────────
   *
   * 한때 여기에 *"깨면 소리가 나고 근처 적이 깨어난다"* 를 재는 검사가
   * 셋 있었습니다. 규칙째로 뺐습니다 — 대가를 붙이면 플레이어가 항아리
   * 앞에서 **망설이고**, 그러면 *"시원하게 부수고 다니는"* 감각이
   * 사라집니다(설계와 번복 기록은 balance.ts `URN`).
   *
   * 그래서 지금은 **반대쪽**을 잽니다: 자고 있던 적이 항아리가 깨져도
   * **그대로 자고 있는가.** 뺐다고 검사까지 지우면, 다음에 누가 소리를
   * 다시 붙였을 때 **아무 말도 안 나옵니다.** 「없던 것은 기능이 아니라
   * 눈금이었습니다」의 반대 방향 짝입니다.
   *
   * ── ⚠️ 거리로는 못 떼어 놓았습니다 ────────────────────────────
   * 처음엔 적을 플레이어에게서 40m, 그다음 120m 떨어뜨려 봤습니다.
   * 그래도 게이트가 계속 빨갰습니다 — **깨기도 전에 이미 깨어 있음.**
   * 아레나에서는 깨어나는 거리가 레벨 모드와 달라서(종류별 기본값),
   * 거리로 밀어내는 방법으로는 확실히 재울 수가 없었습니다.
   *
   * 그래서 거리 대신 **규칙을 직접 좁힙니다**(`setAggroRange`). 이건
   * 실험대가 게임을 속이는 것이 아니라, *"보고 깨어나는 길"* 을 잠시
   * 막아서 **남는 길이 소리 하나뿐**이게 만드는 것입니다. 그러고도
   * 안 깨어나면 그건 소리가 없다는 뜻입니다.
   *
   * ⚠️ 끝나면 **반드시 되돌립니다.** 안 되돌리면 이 프로브 뒤에 붙는
   *    실험들이 조용히 다른 게임을 재게 됩니다.
   */
  const quiet = await page.evaluate(async ([R]) => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    const runFor = async (sec) => {
      const t = G.state().simElapsed + sec
      const dl = Date.now() + 40000
      while (G.state().simElapsed < t && Date.now() < dl) await sleep()
    }
    G.reset()
    await runFor(0.3)
    G.clearEnemies()
    await runFor(0.2)
    const p = G.state().player
    // 👁 **보고 깨어나는 길을 잠시 막습니다** — 남는 길이 소리뿐이게.
    G.setAggroRange(1)
    const ux = p.x + 30
    const uz = p.z + 30
    const near = G.spawnEnemyKind('grunt', ux, uz + R * 0.5, true)
    const urn = G.spawnUrn(ux, uz, false)
    await runFor(0.4)
    const before = G.enemyInfo(near)?.aggro ?? null
    // 🔨 칼이 아니라 **피해**로 깹니다 — 플레이어를 실험에서 빼기 위해.
    G.damageEntity(urn, 99)
    await runFor(0.8)
    const after = G.enemyInfo(near)?.aggro ?? null
    const broken = G.urns().length === 0
    // ⚠️ 반드시 되돌립니다 — 뒤에 오는 실험이 다른 게임을 재지 않게.
    G.setAggroRange(0)
    return { before, after, broken, dist: R * 0.5 }
  }, [aware.alertRadius])
  check(
    quiet !== null && quiet.before === false && quiet.broken === true,
    '🚧 적은 **자고 있었고** 항아리는 **실제로 깨졌다** (비교의 게이트)',
    quiet ? `깨기 전 어그로 ${quiet.before} · 깨진 뒤 남은 항아리 ${quiet.broken ? 0 : '있음'}` : '실패',
  )
  if (quiet && quiet.before === false && quiet.broken === true) {
    check(
      quiet.after === false,
      '🤫 항아리를 깨도 **적은 안 깨어난다** (부수는 데 대가를 두지 않습니다)',
      `${quiet.dist.toFixed(1)}m 의 적 — ${quiet.after === false ? '그대로 잠' : '깨어남'}`,
    )
  }

  /**
   * ── ③ 안에 든 것이 나오는가 ───────────────────────────────────
   *
   * 그리고 **빈 항아리에서는 안 나와야** 합니다. 한쪽만 재면
   * *"항상 나온다"* 도 통과합니다 — 그러면 숨긴 것이 숨은 것이 아닙니다.
   */
  const holds = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    const runFor = async (sec) => {
      const t = G.state().simElapsed + sec
      const dl = Date.now() + 30000
      while (G.state().simElapsed < t && Date.now() < dl) await sleep()
    }
    const trial = async (withTreasure) => {
      G.reset()
      await runFor(0.3)
      G.clearEnemies()
      await runFor(0.2)
      const p = G.state().player
      const before = G.state().treasureFound
      G.spawnUrn(p.x, p.z + 1.6, withTreasure)
      await runFor(0.2)
      G.press('Mouse0')
      await sleep()
      G.release('Mouse0')
      await runFor(1.0)
      // 보물은 **주워야** 세어집니다. 깨진 자리로 걸어갑니다.
      G.press('KeyW')
      await runFor(1.2)
      G.release('KeyW')
      await runFor(0.4)
      return G.state().treasureFound - before
    }
    return { full: await trial(true), empty: await trial(false) }
  })
  check(
    holds !== null,
    '🚧 두 항아리를 모두 실제로 깨 봤다 (비교의 게이트)',
    holds ? `보물 든 것 ${holds.full} · 빈 것 ${holds.empty}` : '실패',
  )
  if (holds) {
    check(
      holds.full > 0,
      '🎁 **보물을 품은 항아리에서 보물이 나온다**',
      `주운 것 ${holds.full}개`,
    )
    check(
      holds.empty === 0,
      '🎁 그리고 **빈 항아리에서는 안 나온다** (안 그러면 숨긴 것이 숨은 것이 아닙니다)',
      `주운 것 ${holds.empty}개`,
    )
  }

  /**
   * ── ④ 🔎 **숨긴 것에 단서가 있는가** ─────────────────────────────
   *
   * 여기서부터는 물건이 아니라 **레벨**을 봅니다. 항아리가 잘 부서지고
   * 보물이 잘 나와도, 그 보물이 **아무 단서 없이** 놓여 있으면 찾는
   * 방법은 「전부 부수기」뿐입니다. 그건 탐험이 아니라 청소입니다.
   *
   * 오공·젤다가 파는 감각은 *"저기 뭔가 있을 것 같은데"* → **정말
   * 있었다** 입니다. 그러려면 **의심할 거리**가 화면에 있어야 하고,
   * 이 게임에서 그것은 **무더기**입니다 — 항아리 하나는 잡동사니지만
   * 여럿이 모여 있으면 *"사람이 쌓은 것"* 으로 읽힙니다.
   *
   * 그래서 두 방향을 다 봅니다. 한쪽만 재면 거짓말이 통과합니다:
   *   · 보물이 **무더기 안에** 있는가 — 아니면 순전한 운입니다
   *   · 무더기에 **뭔가 들어 있는가** — 아니면 단서가 거짓말입니다
   *
   * ⚠️ 레벨 파일을 **직접 읽습니다.** 이 검사가 묻는 것은 게임의 동작이
   *    아니라 **배치**라서, 브라우저를 거칠 이유가 없습니다.
   * ⚠️ 「무더기」의 크기(3)와 반경은 **여기서 정합니다.** 게임에는 그런
   *    규칙이 없으니까요 — 이건 게임의 규칙이 아니라 **레벨 설계의
   *    약속**이고, 계측기가 그 약속을 들고 있는 것이 맞습니다. 대신
   *    그 사실을 여기 적어 둡니다. 「계측기의 정책을 게임의 결론으로
   *    만들지 않는다」.
   */
  {
    const level = JSON.parse(
      await readFile(path.join(ROOT, 'src', 'levels', 'broken-gate.json'), 'utf8'),
    )
    const urnEnts = (level.entities ?? []).filter((e) => e.kind === 'urn' || e.kind === 'urnFull')
    const full = urnEnts.filter((e) => e.kind === 'urnFull')
    // 무더기로 읽히는 거리 — 한 화면(22m) 안이 아니라 **한눈에** 들어와야
    // 하므로 훨씬 좁게 잡습니다. 4m 는 항아리 두 칸 거리입니다.
    const NEAR = 4
    const CLUSTER = 3
    const around = (e) =>
      urnEnts.filter((o) => Math.hypot(o.x - e.x, o.z - e.z) <= NEAR).length
    check(
      urnEnts.length > 0 && full.length > 0,
      '🚧 레벨에 항아리와 **보물 든 항아리**가 둘 다 있다 (비교의 게이트)',
      `항아리 ${urnEnts.length}개 · 그중 보물 ${full.length}개`,
    )
    if (urnEnts.length > 0 && full.length > 0) {
      const lonely = full.filter((e) => around(e) < CLUSTER)
      check(
        lonely.length === 0,
        `🔎 **숨긴 보물은 전부 무더기 안에 있다** (${NEAR}m 안에 ${CLUSTER}개 이상 — 운이 아니라 감으로 찾게)`,
        lonely.length === 0
          ? full.map((e) => `(${e.x.toFixed(0)},${e.z.toFixed(0)}) 이웃 ${around(e)}개`).join(' · ')
          : lonely.map((e) => `❗(${e.x.toFixed(0)},${e.z.toFixed(0)}) 이웃 ${around(e)}개뿐`).join(' · '),
      )
      /**
       * 반대쪽 — **빈 무더기**가 있으면 단서가 거짓말이 됩니다. 한 번
       * 속으면 다음 무더기는 안 봅니다. 그러면 이 물건 전체가 죽습니다.
       */
      const clusters = []
      const seen = new Set()
      for (const e of urnEnts) {
        if (seen.has(e)) continue
        const group = urnEnts.filter((o) => Math.hypot(o.x - e.x, o.z - e.z) <= NEAR)
        if (group.length < CLUSTER) continue
        for (const g of group) seen.add(g)
        clusters.push(group)
      }
      const empty = clusters.filter((g) => !g.some((o) => o.kind === 'urnFull'))
      check(
        clusters.length > 0 && empty.length === 0,
        '🔎 그리고 **빈 무더기가 없다** (한 번 속으면 다음 무더기는 안 봅니다)',
        `무더기 ${clusters.length}개 — ${clusters
          .map((g) => `${g.length}개들이(${g.some((o) => o.kind === 'urnFull') ? '보물 있음' : '❗비었음'})`)
          .join(' · ')}`,
      )
    }
  }

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} catch (err) {
  /**
   * 💥 **도중에 죽으면 반드시 소리를 냅니다.** 조용히 exit 0 하는 계측기는
   *    통과하는 검사보다 나쁩니다 — 이 저장소가 프로브 49개 전부에서
   *    겪은 실패입니다.
   */
  console.error('\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**')
  console.error(err?.stack ?? err)
  fail++
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
