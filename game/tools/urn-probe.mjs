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
 *   ② 부서지면 **소리가 나고 근처 적이 깨어난다** — 이것이 대가입니다
 *   ③ 그중 어떤 것은 **보물을 품고 있다** — 확률이 아니라 배치입니다
 *
 * 셋 다 *"코드에 그렇게 적혀 있다"* 가 아니라 **눌러서** 확인합니다.
 *
 * ── ⚠️ 규칙값은 게임에서 읽습니다 ───────────────────────────────────
 * 소리 거리(고함 거리와 같은 값)를 여기 적으면, 값을 손보는 날 **검사만
 * 옛 규칙을 지킵니다.** `awareInfo()` 가 게임이 실제로 쓰는 값을 냅니다.
 *
 * ── ⚠️ 이 프로브가 스스로를 못 믿는 자리 ────────────────────────────
 * *"소리를 듣고 깨어났다"* 와 *"원래 보고 깨어났다"* 는 겉으로 같습니다.
 * 그래서 항아리를 **적의 등 뒤 쪽**, 시야 밖에 세웁니다. 그렇게 안 하면
 * 이 검사는 소리가 없어도 통과합니다 — 「빈 표본으로 통과하지 않게」와
 * 같은 종류의 함정이고, 여기서는 **표본이 아니라 원인**이 비어 있습니다.
 */
import { existsSync } from 'node:fs'
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

  console.log('\n🏺 항아리 — 부수는 데 대가가 있고, 그중 하나가 진짜입니다\n')

  const aware = await page.evaluate(() => window.__game.awareInfo())
  console.log(`  [규칙 — 게임이 알려 준 값] 소리가 닿는 거리 ${aware.alertRadius}m\n`)

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
    G.press('KeyJ')
    await sleep()
    G.release('KeyJ')
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
   * ── ② 소리가 적을 깨우는가 ────────────────────────────────────
   *
   * ── ⚠️ 첫 판을 이렇게 짰다가 못 쓰게 됐습니다 ──────────────────
   * 항아리를 플레이어 앞에 세우고 칼로 깼습니다. 그런데 소리 거리가 7m
   * 라 **가까운 적도 플레이어에게서 5m 안**에 서게 되고, 그 적은 소리와
   * 무관하게 **나를 보고** 깨어납니다. 게이트가 잡았습니다 —
   * `가까운 true · 먼 true`, 즉 **깨기도 전에 둘 다 깨어 있었습니다.**
   * 통과했다면 소리가 아예 없어도 초록인 검사였습니다. 표본이 아니라
   * **원인**이 비어 있는 초록입니다.
   *
   * ── 그래서 플레이어를 빼 버립니다 ──────────────────────────────
   * 항아리와 적들을 **플레이어에게서 멀리** 세우고, 칼 대신
   * `damageEntity` 로 부숩니다. 그러면 깨어날 이유가 **소리 하나**만
   * 남습니다.
   *
   * ⚠️ 이건 편법이 아니라 통이 이미 증명한 길입니다 — 부서짐 조건이
   *    「체력이 0이 되면」 하나로 모여 있어서, **어떤 피해원으로 깨든
   *    같은 규칙**이 돕니다(combat.ts 통 가지 주석). 그 설계 덕분에
   *    플레이어를 실험에서 뺄 수 있습니다.
   * ⚠️ 멀리 있는 적도 같이 둡니다 — 소리가 온 세상을 깨우면 그건 거리가
   *    있는 규칙이 아닙니다.
   */
  const heard = await page.evaluate(async ([R]) => {
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
    // 플레이어에게서 충분히 멀리 — 시야(가장 넓은 어그로)보다 훨씬 밖.
    const ux = p.x + 40
    const uz = p.z + 40
    // 가까운 적: 소리 거리 안. 먼 적: 소리 거리 밖(1.6배).
    const near = G.spawnEnemyKind('grunt', ux, uz + R * 0.5, true)
    const far = G.spawnEnemyKind('grunt', ux, uz + R * 1.6, true)
    const urn = G.spawnUrn(ux, uz, false)
    await runFor(0.4)
    const before = { near: G.enemyInfo(near)?.aggro ?? null, far: G.enemyInfo(far)?.aggro ?? null }
    // 🔨 칼이 아니라 **피해**로 깹니다 — 플레이어를 실험에서 빼기 위해.
    G.damageEntity(urn, 99)
    await runFor(0.8)
    return {
      before,
      after: { near: G.enemyInfo(near)?.aggro ?? null, far: G.enemyInfo(far)?.aggro ?? null },
      broken: G.urns().filter((u) => u.broken).length,
      dist: { near: R * 0.5, far: R * 1.6 },
    }
  }, [aware.alertRadius])
  check(
    heard !== null &&
      heard.before.near === false &&
      heard.before.far === false &&
      heard.broken === 1,
    '🚧 두 적 모두 **자고 있었고**, 항아리는 **실제로 깨졌다** (비교의 게이트)',
    heard
      ? `깨기 전 — 가까운 ${heard.before.near} · 먼 ${heard.before.far} · 깨진 항아리 ${heard.broken}개`
      : '실패',
  )
  if (heard && heard.before.near === false && heard.before.far === false && heard.broken === 1) {
    check(
      heard.after.near === true,
      '🔊 **소리를 들은 적이 깨어난다** (부수는 데 대가가 있다)',
      `${heard.dist.near.toFixed(1)}m 의 적 — ${heard.after.near === true ? '깨어남' : '그대로 잠'}`,
    )
    check(
      heard.after.far === false,
      '🔊 그리고 **멀리까지는 안 들린다** (거리가 있는 규칙이다)',
      `${heard.dist.far.toFixed(1)}m 의 적 — ${heard.after.far === false ? '그대로 잠' : '깨어남'}`,
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
      G.press('KeyJ')
      await sleep()
      G.release('KeyJ')
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
