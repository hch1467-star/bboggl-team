/**
 * 🏃 달리기 검증 — `npm run sprint`
 *
 * ── 왜 전용 프로브가 필요한가 ──────────────────────────────────────
 * 자동 플레이 봇은 **Shift 를 누르지 않습니다.** 일부러 그렇게 뒀습니다 —
 * 봇이 달리면 클리어가 빨라진 것이 템포 때문인지 달리기 때문인지 섞여서
 * 못 가릅니다(처방이 갈리는 것은 따로 잰다).
 *
 * 그런데 그러면 달리기는 **아무도 세지 않는 기능**이 됩니다. 이 프로젝트가
 * 반복해서 겪은 실패가 정확히 그것입니다:
 *   · 절벽 낙하 — 판당 4~6회 멀쩡히 일어나는데 눈금이 없어 "만들 기능"에 남아 있었습니다
 *   · 궁수      — 배치해 놓고 한 발도 안 쐈습니다
 *   · 연계      — 정상 작동 중인데 보고서엔 "0회"였습니다
 * 달리기는 그보다 나쁜 상태였습니다. 낙하는 최소한 **일어나고는** 있었지만,
 * 달리기는 Shift 입력이 게임에 닿는지조차 확인된 적이 없습니다.
 *
 * ── 무엇을 재는가 ──────────────────────────────────────────────────
 * "빨라지는가" 하나만 보면 안 됩니다. 이 기능의 값은 **걷기와 구분되는
 * 것**이고, 그 구분을 만드는 규칙이 넷입니다:
 *
 *   1) Shift + 이동 → 걷기보다 **빠른가**            (기능이 붙는가)
 *   2) **붙는 데 시간이 걸리는가**                    (즉시면 걷기와 같은 것)
 *   3) **공격하면 즉시 풀리는가**                     ("전투가 값을 낸다")
 *   4) **스태미나를 안 쓰는가**                       (기둥 1을 안 건드렸는가)
 *   5) 제자리에서 Shift 만 → 아무 일도 없는가          (이동 입력이 있어야)
 *
 * 3번이 이 기능의 전부입니다. 안 풀리면 달리면서 싸우는 게 최적이 되고,
 * 걷기·달리기 구분이 그냥 "이동이 빨라짐"으로 무너집니다.
 *
 * ⚠️ 배율을 여기에 베껴 적지 않습니다. `terrainInfo()` 에서 읽습니다 —
 *    1.55 를 적어 두면 나중에 값을 바꿨을 때 **프로브만 옛 규칙으로
 *    통과**합니다. 이 프로젝트에서 상수를 베껴 두 번 틀린 적이 있습니다.
 *
 * 속도는 **위치 차이 ÷ 시뮬레이션 시간**으로 잽니다. 벽시계로 재면
 * SwiftShader 에서 전부 거짓이 됩니다(게임이 실시간의 1/3~1/20 로 흐릅니다).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5199
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
  // 아레나 — 지형·적 없이 이동만 봅니다. 존에서 재면 벽과 단차가 섞입니다.
  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })

  await page.evaluate(() => {
    /**
     * **시뮬레이션 시간** 기준으로 달린 거리를 잽니다.
     * 반환은 m/s. 측정 중에는 적이 없어야 하므로 아레나에서만 씁니다.
     */
    /**
     * **매번 완전히 멈춘 상태에서 시작합니다.**
     *
     * 처음엔 이 준비 없이 이어서 쟀더니, 앞 측정의 공격(돌진)이 남아
     * `제자리 Shift` 검사에서 3.82m 를 움직였습니다. 프로브가 게임을
     * 의심하기 전에 **자기 시작 조건부터** 맞춰야 합니다.
     */
    window.__idle = async () => {
      const G = window.__game
      G.release('KeyW')
      G.release('ShiftLeft')
      G.release('Mouse0')
      const deadline = Date.now() + 8000
      // 상태가 Idle 이 되고, 위치가 두 번 연속 안 움직일 때까지
      let last = null
      while (Date.now() < deadline) {
        const st = G.state()
        const still = last && Math.hypot(st.player.x - last.x, st.player.z - last.z) < 0.01
        if (st.player.state === 0 && still) return true
        last = { x: st.player.x, z: st.player.z }
        await new Promise((r) => setTimeout(r, 16))
      }
      return false
    }
    window.__spd = async (opts) => {
      const G = window.__game
      G.clearEnemies?.()
      await window.__idle()
      // 매번 같은 조건에서 시작합니다 — 앞 측정의 가속이 남으면 거짓이 됩니다.
      G.press('KeyW')
      if (opts.sprint) G.press('ShiftLeft')
      else G.release('ShiftLeft')
      // 붙는 시간을 건너뛸지(정상 속도) 아니면 그 구간을 볼지
      if (opts.settle > 0) {
        const t0 = G.state().simElapsed
        while (G.state().simElapsed - t0 < opts.settle) await new Promise((r) => setTimeout(r, 4))
      }
      const a = G.state()
      const from = { x: a.player.x, z: a.player.z, t: a.simElapsed, st: a.player.stamina }
      if (opts.attackAt >= 0) {
        // 공격 도중의 속도를 봅니다 — 눌러 놓고 창을 재기 시작합니다.
        G.press('Mouse0')
        G.release('Mouse0')
      }
      const t1 = G.state().simElapsed
      while (G.state().simElapsed - t1 < opts.window) await new Promise((r) => setTimeout(r, 4))
      const b = G.state()
      G.release('KeyW')
      G.release('ShiftLeft')
      const dt = b.simElapsed - from.t
      const d = Math.hypot(b.player.x - from.x, b.player.z - from.z)
      return { speed: dt > 0 ? d / dt : 0, staminaDrop: from.st - b.player.stamina, dt }
    }
  })

  console.log('\n🏃 달리기 검증\n')

  const info = await page.evaluate(() => window.__game.terrainInfo())
  const walkCfg = info.playerMoveSpeed
  const scale = info.sprintScale
  console.log(`  [게임에서 읽은 값] 걷기 ${walkCfg}m/s · 달리기 배율 ${scale}배 → ${(walkCfg * scale).toFixed(1)}m/s\n`)

  // ---- 1. 걷기 기준선 ----
  const walk = await page.evaluate(() => window.__spd({ sprint: false, settle: 0.6, window: 1.2, attackAt: -1 }))
  check(
    Math.abs(walk.speed - walkCfg) / walkCfg < 0.15,
    '걷기 속도가 설정값과 맞는다 (측정 방법 자체가 맞는지 먼저 확인)',
    `${walk.speed.toFixed(2)}m/s vs 설정 ${walkCfg}m/s`,
  )

  // ---- 2. 달리기가 실제로 빠른가 ----
  const run = await page.evaluate(() => window.__spd({ sprint: true, settle: 0.6, window: 1.2, attackAt: -1 }))
  check(
    run.speed > walk.speed * 1.2,
    'Shift 를 누르면 걷기보다 확실히 빠르다',
    `${run.speed.toFixed(2)}m/s vs 걷기 ${walk.speed.toFixed(2)}m/s (${(run.speed / walk.speed).toFixed(2)}배)`,
  )
  check(
    Math.abs(run.speed - walkCfg * scale) / (walkCfg * scale) < 0.15,
    '달리기 속도가 배율대로 나온다',
    `${run.speed.toFixed(2)}m/s vs 기대 ${(walkCfg * scale).toFixed(2)}m/s`,
  )

  // ---- 3. 붙는 데 시간이 걸리는가 ----
  //
  // 즉시 최고속이면 걷기와 달리기가 **같은 것**이 됩니다. 붙는 구간을
  // 통째로 재면(settle 0) 평균이 최고속보다 낮아야 합니다.
  /**
   * ⚠️ **같은 조건끼리 비교합니다.**
   * 처음엔 정지 출발 0.25초(3.81m/s)를 **정상 속도** 걷기(5.40)와 비교해
   * 실패로 찍혔습니다. 그 0.25초에는 달리기 가속뿐 아니라 **정지→이동
   * 가속**도 들어 있어서, 애초에 견줄 수 없는 두 값이었습니다.
   * 그래서 걷기도 같은 정지 출발로 재서 나란히 놓습니다.
   */
  const rampRun = await page.evaluate(() => window.__spd({ sprint: true, settle: 0, window: 0.25, attackAt: -1 }))
  const rampWalk = await page.evaluate(() => window.__spd({ sprint: false, settle: 0, window: 0.25, attackAt: -1 }))
  check(
    rampRun.speed < run.speed * 0.97,
    '최고 속도까지 붙는 시간이 있다 (즉시면 걷기와 구분이 없습니다)',
    `정지 출발 0.25초 ${rampRun.speed.toFixed(2)}m/s · 다 붙으면 ${run.speed.toFixed(2)}m/s`,
  )
  check(
    rampRun.speed > rampWalk.speed,
    '붙는 중에도 걷기보다는 빠르다 (같은 정지 출발끼리 비교)',
    `달리기 ${rampRun.speed.toFixed(2)} vs 걷기 ${rampWalk.speed.toFixed(2)}m/s`,
  )

  // ---- 4. 공격하면 풀리는가 — 이 기능의 전부 ----
  const hit = await page.evaluate(() => window.__spd({ sprint: true, settle: 0.6, window: 0.5, attackAt: 0 }))
  check(
    hit.speed < walk.speed,
    '공격하면 달리기가 풀린다 ("전투가 값을 낸다" — 안 풀리면 달리며 싸우는 게 최적)',
    `공격 중 ${hit.speed.toFixed(2)}m/s vs 걷기 ${walk.speed.toFixed(2)}m/s`,
  )

  // ---- 5. 스태미나를 안 쓰는가 ----
  //
  // 기둥 1: 스태미나 = 기본기·회피 전용. 달리기가 먹으면 "달릴까 구를까"가
  // 판단의 중심이 되어 두 리듬이 셋으로 흐려집니다.
  check(
    run.staminaDrop <= 0.5,
    '달려도 스태미나가 줄지 않는다 (기둥 1 — 스태미나는 기본기·회피 전용)',
    `1.2초 달리는 동안 ${run.staminaDrop.toFixed(1)} 소모`,
  )

  // ---- 6. 제자리 Shift 는 아무 일도 없다 ----
  const still = await page.evaluate(async () => {
    const G = window.__game
    await window.__idle()
    G.press('ShiftLeft')
    const a = G.state()
    const t0 = a.simElapsed
    while (G.state().simElapsed - t0 < 0.8) await new Promise((r) => setTimeout(r, 4))
    const b = G.state()
    G.release('ShiftLeft')
    return Math.hypot(b.player.x - a.player.x, b.player.z - a.player.z)
  })
  check(still < 0.2, '제자리에서 Shift 만 눌러도 움직이지 않는다', `${still.toFixed(2)}m`)

  // ---- 7. 달리면 **시야가 넓어지는가** ----
  //
  // 연출이 아니라 반응 시간 때문입니다. 속도가 1.55배가 되면 화면 끝의 적까지
  // 걷기 2.0초 → 달리기 1.3초로 줄어듭니다. 신호가 없으면 플레이어는 달리는
  // 중인지도 모르고(모루에서 정한 원칙 — "생김새가 먼저 말해야 합니다"),
  // 줄어든 시간만 그대로 떠안습니다.
  const view = await page.evaluate(async () => {
    const G = window.__game
    await window.__idle()
    const walkZoom = G.terrainInfo().cameraZoom
    G.press('KeyW')
    G.press('ShiftLeft')
    const t0 = G.state().simElapsed
    while (G.state().simElapsed - t0 < 1.4) await new Promise((r) => setTimeout(r, 4))
    const runZoom = G.terrainInfo().cameraZoom
    await window.__idle()
    const t1 = G.state().simElapsed
    while (G.state().simElapsed - t1 < 0.8) await new Promise((r) => setTimeout(r, 4))
    return { walkZoom, runZoom, backZoom: G.terrainInfo().cameraZoom }
  })
  const wantZoom = 1 / info.sprintViewScale
  check(
    view.runZoom < view.walkZoom * 0.995,
    '달리면 시야가 넓어진다 (줄어든 반응 시간을 일부 돌려줍니다)',
    `줌 ${view.walkZoom.toFixed(3)} → ${view.runZoom.toFixed(3)}` +
      ` (${info.cameraViewSize.toFixed(1)}m → ${(info.cameraViewSize * info.sprintViewScale).toFixed(1)}m)`,
  )
  check(
    Math.abs(view.runZoom - wantZoom) / wantZoom < 0.08,
    '넓어지는 폭이 설정값과 맞는다',
    `${view.runZoom.toFixed(3)} vs 기대 ${wantZoom.toFixed(3)}`,
  )
  check(
    view.backZoom > view.runZoom * 1.02,
    '멈추면 시야가 되돌아온다 (전투가 시작됐는데 화면이 "이동 중"이면 안 됩니다)',
    `${view.runZoom.toFixed(3)} → ${view.backZoom.toFixed(3)}`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
  await browser.close()
  await server.close()
  process.exit(fail === 0 ? 0 : 1)
}
