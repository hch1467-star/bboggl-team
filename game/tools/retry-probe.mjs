/**
 * 되돌아가기 검증 — `npm run retry`
 *
 * ── 왜 이걸 재게 됐나 ───────────────────────────────────────────
 * 소울류에서 가장 많이 욕먹는 것이 전투 난이도가 아니라 **되돌아가는 길**
 * (run-back)입니다. 죽는 것 자체는 배움인데, 죽고 나서 **아무것도 배울 게
 * 없는 길을 다시 걷는 시간**은 그냥 벌입니다. 엘든 링·NRFTW 모두 초반
 * 비판의 상당 부분이 여기였고, 실제로 패치로 손본 항목입니다.
 *
 * 우리 존은 주 동선 188m 에 **화톳불이 둘**입니다. 그런데 이 배치를
 * 재 본 적이 없습니다. DESIGN.md 에 한 번 나오긴 합니다 — 보스 영역
 * **안**에 화톳불이 있어서 "쉬려고 다가가면 전투가 시작되는" 함정이었고
 * 21m 로 옮겼다는 기록입니다. 그때 배운 문장이 이것이었습니다:
 *
 *   > 배치는 **눈으로 보면 그럴듯해 보입니다.** 재보기 전까지는 화톳불이
 *   > 영역 안에 있다는 걸 알 수 없었습니다.
 *
 * 그 교훈을 **화톳불 하나가 아니라 존 전체**에 적용해 본 적이 없습니다.
 *
 * ── 무엇을 재는가 ──────────────────────────────────────────────
 * 주 동선을 게임의 길찾기로 그린 뒤(`secret` 프로브와 같은 방식),
 * 각 지점에서 **가장 가까운 화톳불까지 걸어야 하는 거리**를 잽니다.
 * 직선이 아니라 걷는 거리입니다 — 이 저장소는 그 둘을 혼동해서 이미 한 번
 * 크게 데였습니다(직선 12.4m 인데 경로 98m 였던 적이 있습니다).
 *
 * ── 무엇을 단언하고 무엇을 단언하지 않는가 ──────────────────────
 * "되돌아가는 길은 N초 이내여야 한다" 같은 기준을 **지어내지 않겠습니다.**
 * 그런 숫자는 이 프로젝트에 근거가 없습니다. 대신 근거가 있는 둘만 겁니다:
 *
 *   1. **화톳불이 주 동선에서 보인다.** 안 보이는 체크포인트는 안 쓰는
 *      체크포인트입니다. 문턱은 보물과 똑같이 `cameraViewSize` 를 씁니다.
 *   2. **보스 앞에 화톳불이 있다.** 이건 DESIGN.md 가 이미 의도를 적어
 *      둔 항목입니다(21m 로 옮긴 그 기록). 가장 어려운 싸움 앞에 준비
 *      지점이 없으면 되돌아가는 길이 가장 긴 자리가 곧 가장 자주 죽는
 *      자리가 됩니다.
 *
 * 나머지 — 구간별 되돌아가기 거리 — 는 **숫자만 찍습니다.** 판단할 근거가
 * 생기기 전에 검사로 만들면, 다음 사람이 그 숫자를 규칙으로 오해합니다.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5216
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

  console.log('\n🔥 되돌아가기 검증 — 죽고 나서 다시 오는 길\n')

  const t = await page.evaluate(() => window.__game.terrainInfo())
  console.log(
    `  [설정] 카메라 ${t.cameraViewSize}m · 걷기 ${t.playerMoveSpeed}m/s · 달리기 ×${t.sprintScale}\n`,
  )

  const data = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    G.reset()
    await sleep()
    G.freezeEnemies(true)
    await sleep()
    // 주 동선 (secret 프로브와 같은 방식 — 적을 지우지 않고 얼립니다)
    const trail = []
    let guard = 0
    while (guard++ < 4000) {
      const obj = G.objective()
      if (!obj) break
      const p = G.state().player
      trail.push({ x: Number(p.x.toFixed(2)), z: Number(p.z.toFixed(2)) })
      if (obj.walkDist <= 1.5) break
      const step = G.pathStep(obj.x, obj.z)
      if (!step) break
      G.teleportPlayer(step.x, step.z)
      await sleep()
    }
    return { trail }
  })

  const trail = data.trail
  check(trail.length > 20, '주 동선을 그렸다', `${trail.length}걸음`)

  // 화톳불 위치는 레벨 데이터가 진실입니다.
  const level = JSON.parse(readFileSync(path.join(ROOT, 'src/levels/broken-gate.json'), 'utf8'))
  const fires = level.entities.filter((e) => e.kind === 'bonfire')
  const spawn = level.entities.find((e) => e.kind === 'spawn')
  const bossMarker = level.entities.find((e) => e.kind === 'boss')
  /**
   * 시작 지점도 부활 지점입니다 — 화톳불에 한 번도 안 쉬었다면 거기로
   * 돌아갑니다. 빼놓으면 존 앞부분의 되돌아가기가 실제보다 길게 나옵니다.
   */
  const rest = [...fires.map((f) => ({ ...f, what: '화톳불' })), { ...spawn, what: '시작' }]

  /**
   * **걷는 거리**로 잽니다. 직선으로 재면 벽 너머가 가깝게 보입니다 —
   * 이 저장소가 이미 한 번 크게 데인 자리입니다(직선 12.4m / 경로 98m).
   * 게임의 흐름장을 각 쉼터마다 한 번씩 세우고 동선 전체를 한꺼번에 읽습니다.
   */
  const walkTables = []
  for (const r of rest) {
    const d = await page.evaluate(
      ([tx, tz, pts]) => window.__game.distancesToward(tx, tz, pts),
      [r.x, r.z, trail],
    )
    /**
     * ⚠️ 반환값은 배열이 아니라 `{ player, points }` 입니다. 처음엔 배열로
     *    알고 `d[i]` 를 읽었고, 전부 undefined 라 관찰 구간이 **아무것도
     *    못 찍고 조용히 지나갔습니다.** 검사 셋은 통과하고 있었으므로
     *    출력만 보면 정상으로 보였습니다 — 이 프로젝트에서 가장 비싼
     *    종류의 고장(조용히 아무 말도 안 하는 계측기)입니다.
     */
    if (!d || !Array.isArray(d.points)) throw new Error('distancesToward 반환 형태가 예상과 다릅니다')
    walkTables.push({ rest: r, d: d.points })
  }

  // ---- 1. 화톳불이 주 동선에서 보이는가 ----
  //
  // 보물과 **같은 잣대**입니다. 안 보이는 체크포인트는 안 쓰는 체크포인트고,
  // 안 쓰면 되돌아가는 길이 존 처음부터가 됩니다.
  for (const f of fires) {
    let best = Infinity
    for (const p of trail) best = Math.min(best, Math.hypot(p.x - f.x, p.z - f.z))
    check(
      best <= t.cameraViewSize,
      `화톳불 (${f.x}, ${f.z}) 이 주 동선에서 화면에 뜬다`,
      `동선까지 ${best.toFixed(1)}m (시야 ${t.cameraViewSize}m)`,
    )
  }

  // ---- 2. 보스 앞에 쉼터가 있는가 ----
  //
  // DESIGN.md 가 이미 의도를 적어 둔 유일한 항목이라 여기만 단언합니다.
  if (bossMarker) {
    let nearest = { what: '?', d: Infinity }
    for (const r of rest) {
      const d = Math.hypot(r.x - bossMarker.x, r.z - bossMarker.z)
      if (d < nearest.d) nearest = { what: `${r.what} (${r.x}, ${r.z})`, d }
    }
    /**
     * 존 전체 길이와 견줍니다 — "짧다"는 상대적인 말이라 기준이 필요한데,
     * 지어내는 대신 **이 존 자신**을 기준으로 씁니다. 보스까지 되돌아가는
     * 길이 존을 한 번 걷는 것의 절반을 넘으면, 그건 재도전이 아니라
     * 존을 다시 하는 것입니다.
     */
    let pathLen = 0
    for (let i = 1; i < trail.length; i++) {
      pathLen += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].z - trail[i - 1].z)
    }
    check(
      nearest.d < pathLen * 0.5,
      '보스에서 가장 가까운 쉼터가 존 절반보다 가깝다 (재도전이 존 재주행이 아니다)',
      `${nearest.what} 까지 ${nearest.d.toFixed(0)}m · 존 한 바퀴 ${pathLen.toFixed(0)}m`,
    )
  }

  // ---- 관찰: 구간별 되돌아가기 (검사 아님) ----
  //
  // 판단할 근거가 아직 없어서 **숫자만** 남깁니다. 검사로 만들면 다음 사람이
  // 이 숫자를 규칙으로 오해합니다.
  console.log('\n  [관찰] 주 동선에서 가장 가까운 쉼터까지 — 걷는 거리\n')
  let worst = { i: -1, d: -1 }
  for (let i = 0; i < trail.length; i++) {
    let best = Infinity
    for (const w of walkTables) {
      const v = w.d[i]
      // 길이 없으면 Infinity 로 옵니다 — 그 쉼터에서는 못 오는 자리입니다.
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < best) best = v
    }
    if (best !== Infinity && best > worst.d) worst = { i, d: best }
  }
  if (worst.i >= 0) {
    const secs = worst.d / t.playerMoveSpeed
    console.log(
      `    가장 먼 지점 (${trail[worst.i].x}, ${trail[worst.i].z}) — 걸어서 ${worst.d.toFixed(0)}m` +
        ` (약 ${secs.toFixed(0)}초, 달리면 ${(secs / t.sprintScale).toFixed(0)}초)`,
    )
  }
  console.log(`    쉼터 ${rest.length}곳: ${rest.map((r) => `${r.what}(${r.x},${r.z})`).join(' · ')}`)

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
