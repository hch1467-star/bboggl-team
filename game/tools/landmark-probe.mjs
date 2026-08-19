/**
 * 🏛 구역마다 **보이는 것**이 있는가 — `npm run landmark`
 *
 * ── 왜 이 검사가 생겼는가 ──────────────────────────────────────────
 * 구역 스크린샷 열두 장을 나란히 놓고 봤습니다. 「무너진 회랑」도 「폐허
 * 안뜰」도 **아무것도 없는 색면 한 장**이었습니다. 이름은 무너졌다는데
 * 화면에 무너진 것이 하나도 없습니다. 참고한 세 게임(로스트아크 ·
 * 검은 신화: 오공 · 노 레스트 포 더 위키드)은 전부 이걸 지물로 풉니다.
 *
 * ── ❌ 첫 가설은 **재 보고 버렸습니다** ────────────────────────────
 * 처음엔 이렇게 주장하려 했습니다: 바닥이 `(cx+cz)%2` 체커라 **주기가
 * 4m** 이니, 평평한 데서 4m 걸으면 화면이 그대로일 것이다 — 그러니 길을
 * 잃는다. 그럴듯했고, 그래서 **재 봤습니다**:
 *
 *     폐허 안뜰 동쪽 4m 100.0% · 무너진 회랑 동쪽 4m 99.8%
 *     …열두 구역 중 두 방향 모두 8% 아래인 곳은 **한 곳도 없었습니다**
 *
 * 틀렸습니다. 카메라가 따라 움직이면 멀리 있는 지형·구역 경계가 통째로
 * 밀려서 픽셀은 얼마든지 달라집니다. **"픽셀이 달라진다"는 "무엇이
 * 보인다"가 아니었습니다.** 가설을 고치지 않고 문턱만 낮췄다면 이 검사는
 * 영영 아무것도 안 재면서 초록이었을 것입니다.
 *
 * ── ✅ 그래서 재는 것을 바꿨습니다 ─────────────────────────────────
 * 지금 재는 것은 **두 가지**이고, 둘 다 있어야 뜻이 생깁니다:
 *
 *   ① 구역마다 지물이 **세어서 있다**   — 게임의 장부(`props()`)로 확인
 *   ② 그 지물이 **화면에 실제로 보인다** — 껐다 켜서 그림이 달라지는지 확인
 *
 * ①만 재면 "만들었는데 안 보이는" 고장이 통과합니다(이 저장소가 이미
 * 겪었습니다 — 등급 불티가 0.24m 라 안 보였습니다). ②만 재면 어느 구역이
 * 비어 있는지 모릅니다. **못 잰 것은 통과가 아닙니다.**
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { decodePng } from './png.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5256
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

const STEP_DT = 1 / 60
const SETTLE = 240 // 4초. 순간이동한 자리로 카메라가 따라붙는 데 씁니다.

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

const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

const diffPct = (a, b) => {
  if (a.width !== b.width || a.height !== b.height) return 100
  let px = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const d =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2])
    // 3 미만은 압축·보간이 남긴 티끌입니다. 사람 눈에는 같은 색입니다.
    if (d >= 3) px++
  }
  return (px / (a.width * a.height)) * 100
}

/**
 * 한 자리에 서서 한 장. 시간은 **걸음 수로** 줍니다(`npm run repro` 가
 * 세워 준 방법) — 벽시계로 두면 두 장이 서로 다른 시각에 서서, 아래의
 * "껐더니 달라졌다"가 지물 때문인지 시간 때문인지 못 가릅니다.
 */
async function shotAt(x, z, withProps) {
  await page.evaluate(
    async ([px, pz, dt, settle, on]) => {
      const G = window.__game
      G.setPaused(true)
      G.showProps(on)
      G.teleportPlayer(px, pz)
      G.step(settle, dt, true)
    },
    [x, z, STEP_DT, SETTLE, withProps],
  )
  return decodePng(await page.screenshot())
}

try {
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  const { regions, props } = await page.evaluate(() => {
    const G = window.__game
    G.clearEnemies()
    G.freezeEnemies(true)
    // 화면 위의 것은 끕니다 — 남은 거리 표시가 자리마다 달라서, 지물을
    // 물으려던 검사가 **글자**를 재게 됩니다.
    for (const el of document.body.children) {
      if (el.tagName !== 'CANVAS') el.style.display = 'none'
    }
    return {
      regions: G.regionList().map((r) => ({ name: r.name, x: r.x, z: r.z })),
      props: G.props(),
    }
  })

  console.log('\n🏛 지형지물 검증 — **구역마다 보이는 것이 있는가**\n')
  console.log(
    `  기둥 ${props.pillars}개 / 자리 ${props.pillarSpots}곳 · 바닥 잔해 ${props.rubble}개 / 자리 ${props.rubbleSpots}곳\n` +
      `  갈 수 없는 바닥 칸 ${props.unreachable}개 — 이 수가 작아서 기둥을 **허공 가장자리**에 세웁니다(render/props.ts)\n`,
  )
  for (const r of regions) {
    const n = props.byRegion[r.name] ?? 0
    console.log(`  ${n === 0 ? '❗' : '  '} ${r.name.padEnd(12, '　')} 지물 ${String(n).padStart(3)}개`)
  }

  /**
   * ① 구역마다 **세어서 있다.**
   *
   * 「구역 밖」(길이 아닌 바깥 칸)은 세지 않습니다 — 거기 아무리 많아도
   * 플레이어가 지나는 곳이 비어 있으면 고쳐야 할 것은 그대로입니다.
   */
  const empty = regions.filter((r) => (props.byRegion[r.name] ?? 0) === 0)
  console.log('')
  check(
    empty.length === 0,
    '🏛 **구역마다 지물이 하나 이상 있다** (❗ 가 빈 구역입니다)',
    empty.length === 0 ? `구역 ${regions.length}곳 확인` : `${empty.length}곳 비었습니다: ${empty.map((r) => r.name).join(' · ')}`,
  )

  /**
   * ② 그 지물이 **화면에 실제로 보인다.**
   *
   * 세 곳만 봅니다 — 매 구역 두 장씩 찍으면 이 프로브가 10분을 넘습니다.
   * 고른 기준은 "장부에 가장 많이 적힌 구역"입니다. 거기서도 안 보이면
   * 나머지는 볼 것도 없습니다.
   */
  const busiest = [...regions]
    .sort((a, b) => (props.byRegion[b.name] ?? 0) - (props.byRegion[a.name] ?? 0))
    .slice(0, 3)
  const seen = []
  for (const r of busiest) {
    const on = await shotAt(r.x, r.z, true)
    const off = await shotAt(r.x, r.z, false)
    seen.push({ name: r.name, pct: diffPct(on, off) })
  }
  for (const s of seen) console.log(`     ${s.name} — 지물을 끄면 화면의 ${s.pct.toFixed(2)}% 가 달라집니다`)
  /**
   * 문턱 0.35%: 640×400 화면에서 약 900픽셀입니다. 30×30픽셀짜리 돌 하나
   * 크기라, *"하나라도 눈에 들어온다"* 를 넘는 선입니다. 더 낮추면 화면
   * 구석의 한 점으로도 통과하고, 그건 "보인다"가 아닙니다.
   */
  check(
    // 표본이 비면 `.every` 는 그냥 참입니다 — 길이를 먼저 겁니다(`npm run guard`).
    seen.length === busiest.length && busiest.length > 0 && seen.every((s) => s.pct > 0.35),
    '🏛 **지물을 끄면 화면이 달라진다** (세어서 있는 것과 보이는 것은 다릅니다)',
    seen.map((s) => `${s.name} ${s.pct.toFixed(2)}%`).join(' · '),
  )
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | ') || '없음')
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 — 위 숫자는 완결된 것이 아닙니다.
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 위 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
