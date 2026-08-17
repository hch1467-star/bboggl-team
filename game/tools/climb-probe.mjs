/**
 * 지형 문법 가독성 — `npm run climb`
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * README 는 이 게임의 레벨 문법을 네 줄로 못박아 두었습니다:
 *
 *   > 1단 = 통로 · 2단 이상 = 막힘 · 위에서 아래로 = 지름길
 *   > **이 네 줄이 곧 레벨 디자인의 문법입니다.**
 *
 * 그런데 렌더러는 **그 문법을 한 글자도 그리지 않고 있었습니다.** 옆면 색이
 * 윗칸의 높이에만 달려 있어서, 올라갈 수 있는 1단 턱과 못 올라가는 3단 벽이
 * **완전히 같은 색**이었습니다. 화면에서 둘을 가르는 단서는 면의 세로 길이
 * 뿐인데, 직교 쿼터뷰에서 0.9m 와 2.7m 는 잘 안 잡힙니다.
 *
 * 그러면 길찾기가 탐색이 아니라 **시행착오**가 됩니다 — 벽에 부딪혀 보고서야
 * 아는 것이죠. 4색 예고에 들인 공("보고 판단하게 만든다")과 정반대입니다.
 *
 * ── 어떻게 재는가 ──────────────────────────────────────────────
 * 설정값(알베도)을 비교하지 않습니다. 씬에는 태양광·환경광·ACES 톤매핑이
 * 걸려 있어서 **알베도의 차이와 화면의 차이는 다릅니다** — 이 파일 옆의
 * `contrast` 프로브가 같은 이유로 픽셀을 읽습니다. 여기서도 **화면을 찍어
 * 픽셀을 읽습니다.**
 *
 * 좌표는 **게임이 줍니다**(`faceSamples()`). 프로브가 지형 데이터를 읽고
 * 카메라 행렬을 흉내 내면, 카메라 각도를 바꾸는 날 프로브만 옛 화면을
 * 검사하게 됩니다. "넘을 수 있는가"의 판정도 게임 규칙 그대로입니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { decodePng, deltaE } from './png.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5220
const VIEWPORT = { width: 1100, height: 690 }
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

/**
 * 기준 ΔE 10.
 *
 * `contrast` 프로브는 예고에 **25** 를 요구합니다. 그건 0.55초 안에 곁눈질로
 * 읽어야 하는 것이라 그렇습니다. 지형은 다릅니다 — **가만히 있고, 계속
 * 보이고, 걸어가면서 몇 초씩 볼 수 있습니다.** 같은 잣대를 대면 지형을
 * 예고만큼 요란하게 칠해야 하고, 그러면 정작 예고가 묻힙니다.
 *
 * 10 은 JND(2.3)의 네 배쯤입니다 — "나란히 두면 확실히 다른 색"이면서
 * 예고(25)보다는 확실히 조용한 값.
 */
const MIN_DELTA_E = 10

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
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🧗 지형 문법 가독성 — 넘을 수 있는 턱과 벽이 눈으로 갈리는가\n')
  const t = await page.evaluate(() => window.__game.terrainInfo())
  console.log(
    `  [설정] 오를 수 있는 단차 ${t.maxClimb}단 · 한 단 ${t.heightStep}m · 기준 ΔE ${MIN_DELTA_E}\n`.replace(
      'MIN_DELTA_E',
      MIN_DELTA_E,
    ),
  )

  /**
   * 존을 여러 자리에서 봅니다. 한 자리만 보면 그 자리에 마침 턱이나 벽이
   * 하나뿐일 수 있고, 그러면 "표본이 없어서 통과"가 됩니다.
   */
  const spots = await page.evaluate(() => {
    const G = window.__game
    return G.levelRoster
      ? [
          { x: 0, z: 0 },
          { x: 20, z: 0 },
          { x: -20, z: 10 },
          { x: 10, z: -20 },
          { x: 30, z: 20 },
        ]
      : [{ x: 0, z: 0 }]
  })

  const bucket = { step: [], wall: [] }
  for (const s of spots) {
    await page.evaluate(async ([x, z]) => {
      const G = window.__game
      G.clearEnemies()
      G.teleportPlayer(x, z)
      await new Promise((r) => setTimeout(r, 60))
      G.setPaused(true)
    }, [s.x, s.z])
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    )
    const samples = await page.evaluate(() => window.__game.faceSamples())
    const shot = decodePng(await page.screenshot())
    await page.evaluate(() => window.__game.setPaused(false))

    for (const f of samples) {
      /**
       * ⚠️ 한 점만 읽지 않고 **3×3 을 평균**냅니다. 면의 한가운데를 노려도
       *    한 픽셀은 모서리의 안티에일리어싱에 물릴 수 있고, 그러면 이웃
       *    면의 색이 섞여 들어옵니다.
       */
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = f.sx + dx
          const py = f.sy + dy
          if (px < 0 || py < 0 || px >= shot.width || py >= shot.height) continue
          const o = (py * shot.width + px) * 4
          r += shot.data[o]
          g += shot.data[o + 1]
          b += shot.data[o + 2]
          n++
        }
      }
      if (n === 0) continue
      const rgb = [r / n, g / n, b / n]
      // HUD 위에 찍힌 표본은 버립니다 — 지형이 아니라 UI 를 잰 것이 됩니다.
      if (f.sy < 120 || f.sy > VIEWPORT.height - 160) continue
      ;(f.climbable ? bucket.step : bucket.wall).push(rgb)
    }
  }

  const avg = (list) =>
    list.length === 0
      ? null
      : [0, 1, 2].map((i) => list.reduce((s, c) => s + c[i], 0) / list.length)

  check(
    bucket.step.length >= 5 && bucket.wall.length >= 5,
    '넘을 수 있는 턱과 벽을 둘 다 화면에서 찾았다 (표본이 없어서 통과하는 일 방지)',
    `턱 ${bucket.step.length}개 · 벽 ${bucket.wall.length}개`,
  )

  const stepC = avg(bucket.step)
  const wallC = avg(bucket.wall)
  if (stepC && wallC) {
    const d = deltaE(stepC, wallC)
    check(
      d >= MIN_DELTA_E,
      '**넘을 수 있는 턱**과 **벽**이 화면에서 구분된다 (레벨 문법이 읽힌다)',
      `ΔE ${d.toFixed(1)} · 턱 rgb(${stepC.map((v) => Math.round(v)).join(',')})` +
        ` vs 벽 rgb(${wallC.map((v) => Math.round(v)).join(',')})`,
    )
    /**
     * ---- 방향까지 봅니다 ----
     *
     * ΔE 는 **크기만** 재는 값이라 "벽이 더 밝다"도 통과시킵니다. 그러면
     * 문법이 거꾸로 읽힙니다 — 밝은 쪽이 이어지는 바닥처럼 보이는 것이
     * 이 설계의 전부이므로, **턱이 더 밝아야** 합니다.
     */
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    check(
      lum(stepC) > lum(wallC),
      '   ↳ 그리고 **턱 쪽이 더 밝다** (밝으면 이어지는 바닥, 어두우면 벽)',
      `턱 밝기 ${lum(stepC).toFixed(0)} vs 벽 ${lum(wallC).toFixed(0)}`,
    )
  }

  console.log('')
  /**
   * ── 🔥 **화톳불 사이 이동은 지름길을 연 뒤에만 열린다** ──────────────
   *
   * 이 존의 화톳불 둘은 같은 복도에 74m 떨어져 있고, 사다리 지름길이
   * 아끼는 거리가 72m 입니다. 조건 없이 이동을 열면 **사다리가 갚을 것이
   * 없어집니다** — 바로 앞 회차에 화톳불을 지름길 뒤에 놓았다가 정확히
   * 그 일을 냈고(`map`: 64m → 64m, 0m 단축), 되돌렸습니다.
   *
   * 다크 소울 1 이 빠른 이동을 중반에 여는 이유가 이것입니다. 우리 버전의
   * "군주의 그릇"은 **사다리**입니다 — 지름길이 이동을 낳습니다.
   *
   * 그래서 사다리 프로브가 이 규칙을 지킵니다. 규칙값(열렸는가·켜진 화톳불
   * 수·키)은 **게임이 냅니다**(`travelInfo`) — 프로브가 베껴 적으면 규칙을
   * 바꾸는 날 이 검사만 옛 규칙을 지킵니다.
   */
  {
    const t0 = await page.evaluate(() => {
      const G = window.__game
      G.reset()
      return G.travelInfo()
    })
    check(
      t0.opened === false,
      '🔥 판을 시작하면 지름길이 아직 안 열려 있다 (검사의 게이트)',
      `열린 지름길 ${t0.opened ? '있음' : '없음'} · 켜진 화톳불 ${t0.lit}개 · 키 ${t0.key}`,
    )
    check(
      t0.opened === false,
      '🔥 **지름길을 열기 전에는 화톳불 사이를 못 건넌다** (지름길이 먼저, 편의는 그 위에)',
      `이동 가능 = 지름길 열림(${t0.opened}) 이므로 지금은 불가`,
    )
  }

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
