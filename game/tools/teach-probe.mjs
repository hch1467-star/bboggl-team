/**
 * 가르치는 순서 검증 — `npm run teach`
 *
 * ── 왜 이걸 재게 됐나 ───────────────────────────────────────────
 * 이 프로젝트에는 **"4색을 잡몹이 가르치게"** 라는 항목이 있고 완료로
 * 표시돼 있습니다. 적 종류를 늘려서 색마다 다른 대응을 가르치겠다는
 * 것이었습니다. 그런데 **가르치는 순서**는 한 번도 확인한 적이 없습니다.
 *
 * 순서가 중요한 이유는 소울류·오공이 전부 같은 방식을 쓰기 때문입니다:
 * 새 문법은 **혼자, 안전하게** 처음 만나게 합니다. 언데드 애실럼의 첫
 * 방, 림그레이브의 첫 병사가 그렇습니다. 새것을 둘 이상 겹쳐 놓으면
 * 플레이어는 무엇 때문에 죽었는지 못 가리고, 못 가리면 못 배웁니다.
 *
 * 반대 사례도 이미 우리 안에 있습니다. 잡몹 연계를 넣을 때 🔴→🟡 이
 * 아니라 🔴→🔴 로 간 이유가 정확히 이것이었습니다:
 *
 *   > 새것을 둘 겹치면 둘 다 못 배우고 "그냥 죽었다"만 남습니다.
 *
 * 같은 잣대를 **존 배치**에는 대 본 적이 없습니다.
 *
 * ── 어떻게 재는가 ──────────────────────────────────────────────
 * 주 동선을 게임의 길찾기로 그리고(`secret`·`retry` 와 같은 방식),
 * 적 하나하나가 그 선의 **몇 번째 걸음** 근처에 있는지로 등장 순서를
 * 정합니다. 제가 "이 적이 먼저"라고 정하지 않습니다 — 길이 정합니다.
 *
 * ⚠️ 어그로 거리도 제가 안 정합니다. `terrainInfo().levelAggroRange` 를
 *    그대로 씁니다. "같이 만난다"의 뜻이 곧 "둘 다 깨어난다" 이므로,
 *    기준은 게임이 실제로 쓰는 그 거리여야 합니다.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5217
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

  console.log('\n🎓 가르치는 순서 검증 — 새 적을 혼자 만나는가\n')

  const t = await page.evaluate(() => window.__game.terrainInfo())
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  console.log(`  [설정] 존 어그로 ${t.levelAggroRange}m\n`)

  const trail = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    G.reset()
    await sleep()
    G.freezeEnemies(true)
    await sleep()
    const out = []
    let guard = 0
    while (guard++ < 4000) {
      const obj = G.objective()
      if (!obj) break
      const p = G.state().player
      out.push({ x: p.x, z: p.z })
      if (obj.walkDist <= 1.5) break
      const step = G.pathStep(obj.x, obj.z)
      if (!step) break
      G.teleportPlayer(step.x, step.z)
      await sleep()
    }
    return out
  })
  check(trail.length > 20, '주 동선을 그렸다', `${trail.length}걸음`)

  const level = JSON.parse(readFileSync(path.join(ROOT, 'src/levels/broken-gate.json'), 'utf8'))
  const kinds = new Set(roster.map((r) => r.id))
  const foes = level.entities.filter((e) => kinds.has(e.kind) && e.kind !== 'boss')

  /**
   * 등장 순서 = **동선에서 가장 가까운 걸음의 번호**. 걸음은 순서대로
   * 쌓였으므로 그 번호가 곧 "얼마나 앞에서 만나는가" 입니다.
   * 동선에서 어그로 거리보다 먼 적은 **지나가며 안 깨우므로** 뺍니다.
   */
  const placed = []
  for (const f of foes) {
    let best = { i: -1, d: Infinity }
    for (let i = 0; i < trail.length; i++) {
      const d = Math.hypot(trail[i].x - f.x, trail[i].z - f.z)
      if (d < best.d) best = { i, d }
    }
    if (best.d <= t.levelAggroRange) placed.push({ ...f, step: best.i, off: best.d })
  }
  placed.sort((a, b) => a.step - b.step)

  const nameOf = (id) => roster.find((r) => r.id === id)?.name ?? id
  const colorsOf = (id) => {
    const r = roster.find((x) => x.id === id)
    return r ? [...new Set(r.attacks.map((a) => a.color))].join('') : ''
  }

  // 종류별 **첫 등장**
  const first = new Map()
  for (const p of placed) if (!first.has(p.kind)) first.set(p.kind, p)
  const order = [...first.values()].sort((a, b) => a.step - b.step)

  console.log('  [등장 순서] 주 동선에서 깨울 수 있는 적의 첫 만남\n')
  for (const o of order) {
    console.log(
      `    ${String(o.step).padStart(3)}걸음  ${colorsOf(o.kind)} ${nameOf(o.kind)}` +
        `  (${o.x}, ${o.z}) · 동선에서 ${o.off.toFixed(0)}m`,
    )
  }
  console.log('')

  /**
   * ---- 1. **피하는 법을 먼저, 파고드는 법을 나중에** ----
   *
   * ⚠️ 첫 판에서 이 검사를 **패턴 수**로 썼습니다 — "패턴이 하나뿐인 적이
   *    쉬운 적"이라고 본 것입니다. 돌려 보니 실패가 났는데, 실패한 쪽은
   *    게임이 아니라 **제 잣대**였습니다:
   *
   *      첫 만남   잡몹        패턴 2개 (🔴🟡)
   *      가장 적음 달려드는 자  패턴 1개 (🟢)
   *
   *    달려드는 자는 패턴이 하나지만 그 하나가 **🟢 반격**입니다 — 물러나던
   *    몸을 앞으로 밀어야 하는, 이 게임에서 가장 어려운 대응입니다. 패턴
   *    개수는 **난이도의 대리값이 못 됩니다.** 대리값이 틀리면 검사는 멀쩡한
   *    배치를 고장이라 부르고, 그 말을 믿고 배치를 고치면 진짜 고장이 납니다.
   *
   * 설계가 실제로 말하는 것을 그대로 씁니다. 반격 설계 노트의 문장입니다:
   *
   *   > 네 색의 정답을 나란히 놓고 보니 전부 **"피하라"** 였습니다.
   *   > 로스트아크의 카운터가 이 문제를 정확히 풉니다 — 한 색만
   *   > **반대 방향**을 요구하기 때문입니다.
   *
   * 그러니 물어야 할 것은 개수가 아니라 **순서**입니다: 피하는 색을 먼저
   * 만나고, 반대 방향을 요구하는 🟢 은 그 뒤에 와야 합니다. 앞뒤가 바뀌면
   * 플레이어는 "예고를 보면 앞으로"라는 반사를 먼저 배우고, 그 반사는
   * 나머지 네 색 모두에서 죽는 길입니다.
   */
  const COUNTER_EMOJI = '🟢'
  const firstCounter = order.findIndex((o) => colorsOf(o.kind).includes(COUNTER_EMOJI))
  const firstEvade = order.findIndex((o) => {
    const c = colorsOf(o.kind)
    return c.length > 0 && !c.includes(COUNTER_EMOJI)
  })
  check(
    firstEvade >= 0 && (firstCounter < 0 || firstEvade < firstCounter),
    '🟢 반격보다 **피하는 색**을 먼저 만난다 (반대 방향은 나중에)',
    firstEvade < 0
      ? '피하는 색을 쓰는 적이 동선에 없습니다'
      : `${nameOf(order[firstEvade].kind)}(${colorsOf(order[firstEvade].kind)}) ${order[firstEvade].step}걸음` +
        (firstCounter >= 0
          ? ` → ${nameOf(order[firstCounter].kind)}(🟢) ${order[firstCounter].step}걸음`
          : ' · 🟢 은 동선에 없음'),
  )

  /**
   * ---- 2. **새 적은 혼자 등장한다** ----
   *
   * 이 프로브의 핵심입니다. 어떤 종류를 처음 만나는 자리에서, **아직 안
   * 배운 다른 종류**가 같이 깨어나면 안 됩니다. 이미 배운 종류가 함께
   * 있는 것은 괜찮습니다 — 오히려 그게 조합을 가르치는 방식입니다.
   */
  const learned = new Set()
  const clashes = []
  for (const o of order) {
    for (const other of placed) {
      if (other.kind === o.kind) continue
      if (learned.has(other.kind)) continue
      const d = Math.hypot(other.x - o.x, other.z - o.z)
      if (d <= t.levelAggroRange) {
        clashes.push(`${nameOf(o.kind)} 첫 만남에 ${nameOf(other.kind)} 가 ${d.toFixed(0)}m`)
      }
    }
    learned.add(o.kind)
  }
  check(
    clashes.length === 0,
    '새 적을 처음 만날 때 **아직 안 배운 다른 적**이 같이 깨지 않는다',
    clashes.length === 0 ? '겹침 없음' : clashes.join(' · '),
  )

  /**
   * ---- 3. **보스가 쓸 색을 존이 먼저 가르쳤는가** ----
   *
   * ── 위 1번이 **비어서 통과할 수 있었습니다** ────────────────────
   * 1번은 *"🟢 보다 피하는 색을 먼저 만난다"* 를 봅니다. 그런데 🟢 을 쓰는
   * 적이 동선에 **하나도 없으면** `firstCounter < 0` 이 되어 그대로
   * 통과합니다. 즉 *가르친 적이 없으면 순서 위반도 없다* 는 이유로 초록불이
   * 켜집니다 — 이 저장소에서 가장 비싼 고장인 **"아무 말도 안 하는 계측기"**
   * 의 교과서적인 모양입니다.
   *
   * ── 왜 하필 보스 기준인가 ──────────────────────────────────────
   * 방금 보스에 **1단계 학습 잠금**을 넣었습니다 — 색을 몇 가지 보여주기
   * 전에는 2단계로 안 넘어갑니다(enemyAI `taughtInPhase1`). 그건 보스가
   * *자기 문법*을 가르치는 장치이지, **존이 할 일을 대신하는 장치가
   * 아닙니다.** 보스 앞에서 처음 보는 색이 있으면 그 색은 이 게임에서 가장
   * 위험한 자리에서 처음 배우게 됩니다. 소울류가 절대 안 하는 일입니다.
   *
   * 그래서 묻습니다: **보스가 쓰는 색 전부를, 보스에 닿기 전에 만나는가.**
   */
  {
    const bossDef = roster.find((r) => r.id === 'boss')
    const bossColors = bossDef ? [...new Set(bossDef.attacks.map((a) => a.color))] : []
    // 동선에서 만나는 적들이 가르치는 색 (보스 제외 — 위 `foes` 가 이미 뺐습니다).
    const taught = new Set()
    for (const o of order) for (const c of colorsOf(o.kind)) taught.add(c)
    const missing = bossColors.filter((c) => !taught.has(c))
    console.log(
      `  [보스가 쓰는 색] ${bossColors.join(' ')} · [존이 가르치는 색] ${[...taught].join(' ')}\n`,
    )
    check(
      bossColors.length > 0,
      '보스의 색을 실제로 읽어 왔다 (빈 목록으로 통과하지 않게)',
      `${bossColors.length}색`,
    )
    check(
      missing.length === 0,
      '보스가 쓰는 색을 **존이 먼저 다 가르친다** (보스 앞에서 처음 보는 색이 없다)',
      missing.length ? `못 가르친 색 ${missing.join(' ')}` : `${bossColors.length}색 전부`,
    )
  }

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
