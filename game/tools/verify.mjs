/**
 * 헤드리스 자동 검증.
 *
 * 왜 이게 있는가: 게임은 "빌드가 통과했다"가 아무 의미가 없습니다.
 * 타입 검사를 통과해도 캐릭터가 안 움직이거나, 판정이 안 맞거나,
 * 화면이 까맣게 나올 수 있습니다. 이 스크립트는 실제 브라우저에서 게임을 띄우고
 * 키를 눌러본 뒤, 게임 상태가 기대대로 변했는지 검사하고 스크린샷을 남깁니다.
 *
 * 실행: npm run verify
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SHOTS = process.env.SHOT_DIR ?? path.join(ROOT, 'tools', 'shots')
const PORT = 4173
const VIEWPORT = { width: 1100, height: 690 }

/**
 * ⚠️ **레벨의 개수는 레벨 데이터에서 읽습니다 — 베껴 적지 않습니다.**
 *
 * 여기에는 원래 `treasureTotal === 4`, `regionCount === 8` 이 박혀 있었습니다.
 * 그 뒤로 지도에 보물과 구역이 늘었는데도 검증은 통과했습니다 —
 * `npm run verify` 가 **`dist/`(빌드 결과물)** 를 띄우기 때문에, 다시 빌드하지
 * 않는 한 몇 주 전 지도를 검사하고 있었던 것입니다. 베낀 상수와 낡은 빌드가
 * 서로를 가려 주고 있었습니다.
 *
 * 그래서 두 가지를 같이 고칩니다: 개수는 데이터에서 읽고(아래),
 * verify 는 항상 빌드부터 합니다(package.json).
 */
const LEVEL = JSON.parse(readFileSync(path.join(ROOT, 'src', 'levels', 'broken-gate.json'), 'utf8'))
const LEVEL_TREASURES = LEVEL.entities.filter((e) => e.kind === 'treasure').length
const LEVEL_REGIONS = (LEVEL.regions ?? []).length

// 컨테이너/CI에는 Playwright가 내려받은 브라우저가 없을 수 있어, 미리 설치된
// Chromium 경로를 먼저 찾아봅니다.
const PREINSTALLED = ['/opt/pw-browsers/chromium']
const execPath = PREINSTALLED.find((p) => existsSync(p))

const results = []
let failed = 0

function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
  const mark = ok ? '  PASS' : '✗ FAIL'
  console.log(`${mark}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failed++
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  mkdirSync(SHOTS, { recursive: true })

  const server = await preview({
    root: ROOT,
    preview: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'error',
  })

  const browser = await chromium.launch({
    executablePath: execPath,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  })

  // 반드시 **하나의 컨텍스트**를 공유해야 합니다.
  // browser.newPage() 는 호출할 때마다 새 컨텍스트를 만들어서 localStorage 가 격리됩니다.
  // 그러면 에디터가 저장한 레벨을 게임 페이지가 못 읽습니다.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  page.on('requestfailed', (r) => consoleErrors.push(`요청 실패: ${r.url()}`))
  page.on('response', (r) => {
    if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()}: ${r.url()}`)
  })

  // lowfx=1: 소프트웨어 렌더링에서 그림자를 끄면 프레임이 5배 이상 나옵니다.
  // mode=arena: 기본 화면은 이제 번들 존이므로, 전투 검사는 시험장을 명시적으로 엽니다.
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })

  const state = () => page.evaluate(() => window.__game.state())
  const press = (c) => page.evaluate((code) => window.__game.press(code), c)
  const release = (c) => page.evaluate((code) => window.__game.release(code), c)
  const tap = async (c) => {
    await press(c)
    await sleep(40)
    await release(c)
  }
  const aimAt = (x, z) => page.evaluate(([ax, az]) => window.__game.aimAtWorld(ax, az), [x, z])
  /**
   * Idle 이 될 때까지 기다립니다.
   * 벽시계로 기다리면 안 됩니다 — 소프트웨어 렌더링에서는 시뮬레이션이 실제 시간의
   * 1/3 속도로 돌아서, 후딜이 안 끝난 상태에서 누른 입력이 통째로 씹힙니다.
   */
  const waitIdle = async (timeoutMs = 4000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      if ((await state()).player.state === 0) return true
      await sleep(60)
    }
    return false
  }
  /**
   * **시뮬레이션 시간으로 기다립니다.**
   *
   * `sleep(1600)` 같은 벽시계 대기는 이 컨테이너에서 거짓입니다 — 게임이
   * 실시간의 1/3~1/20로 흐르므로 1.6초를 기다려도 게임 안에서는 0.3초밖에
   * 안 지납니다. 실제로 5회 다단히트 스킬이 "2회 명중"으로 찍혀 실패했습니다.
   * 스킬이 아니라 **기다리는 방법이 틀린** 것이었습니다.
   */
  const simSleep = async (seconds, capMs = 60000) => {
    const target = (await state()).elapsed + seconds
    const cap = Date.now() + capMs
    while (Date.now() < cap) {
      if ((await state()).elapsed >= target) return
      await sleep(20)
    }
  }
  const shot = async (name) => {
    const file = path.join(SHOTS, `${name}.png`)
    await page.screenshot({ path: file })
    return file
  }

  /** 렌더 직후 화면 중앙 픽셀 통계를 가져옵니다. */
  async function sampleScreen(timeoutMs = 8000) {
    await page.evaluate(() => window.__game.requestSample())
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const s = await page.evaluate(() => window.__game.getSample())
      if (s) return s
      await sleep(60)
    }
    return null
  }

  /** 조건이 참이 될 때까지 기다립니다. 소프트웨어 렌더링은 느려서 고정 sleep은 못 씁니다. */
  async function waitUntil(fn, timeoutMs, label) {
    const start = Date.now()
    let last = null
    while (Date.now() - start < timeoutMs) {
      last = await state()
      if (fn(last)) return { ok: true, state: last, ms: Date.now() - start }
      await sleep(60)
    }
    return { ok: false, state: last, ms: timeoutMs, label }
  }

  try {
    // ---------- 1. 부팅 ----------
    await page.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
    let s = await state()
    check('게임 부팅 및 디버그 훅 노출', s != null)
    check('플레이어가 원점에 스폰됨', Math.abs(s.player.x) < 0.05 && Math.abs(s.player.z) < 0.05, `(${s.player.x}, ${s.player.z})`)
    check('1웨이브 적 6마리 스폰', s.enemiesLeft === 6, `실제 ${s.enemiesLeft}마리`)
    check('플레이어 체력 100', s.player.hp === 100)

    // 프레임이 실제로 도는지 확인
    const f0 = s.frame
    await sleep(1200)
    s = await state()
    const fps = (s.frame - f0) / 1.2
    check('렌더 루프 동작 중', s.frame > f0, `약 ${fps.toFixed(0)} fps (소프트웨어 렌더링)`)

    const boot = await shot('01-boot')
    check('부팅 스크린샷이 비어있지 않음', statSync(boot).size > 15000, `${(statSync(boot).size / 1024).toFixed(0)} KB`)

    // 화면이 실제로 "그려졌는지" 프레임버퍼를 직접 읽어 확인합니다.
    // 파일 크기만 보면 HUD 텍스트 때문에 3D가 새까매도 통과해버립니다.
    const pix = await sampleScreen()
    check('3D 씬이 실제로 렌더링됨 (검은 화면 아님)',
      pix != null && pix.bgRatio < 0.5 && pix.meanLuma >= 10,
      pix ? `배경색 픽셀 ${(pix.bgRatio * 100).toFixed(0)}% · 평균밝기 ${pix.meanLuma} · 색상 ${pix.uniqueColors}종` : '샘플 수집 실패')

    // ---------- 2. WASD 이동이 카메라 기준인지 ----------
    // 카메라 yaw 45° -> 전방 = (-0.707, 0, -0.707). W를 누르면 x, z 둘 다 감소해야 합니다.
    await page.evaluate(() => window.__game.reset())
    await sleep(200)
    let before = await state()
    await press('KeyW')
    const moved = await waitUntil((st) => Math.hypot(st.player.x - before.player.x, st.player.z - before.player.z) > 1.5, 6000)
    await release('KeyW')
    const dW = moved.state
    check(
      'W = 화면 위쪽(카메라 전방)으로 이동',
      moved.ok && dW.player.x < before.player.x - 0.5 && dW.player.z < before.player.z - 0.5,
      `Δx=${(dW.player.x - before.player.x).toFixed(2)} Δz=${(dW.player.z - before.player.z).toFixed(2)}`,
    )

    await page.evaluate(() => window.__game.reset())
    await sleep(200)
    before = await state()
    await press('KeyD')
    const movedD = await waitUntil((st) => Math.hypot(st.player.x - before.player.x, st.player.z - before.player.z) > 1.5, 6000)
    await release('KeyD')
    const dD = movedD.state
    // 우측 = (0.707, 0, -0.707)
    check(
      'D = 화면 오른쪽으로 이동',
      movedD.ok && dD.player.x > before.player.x + 0.5 && dD.player.z < before.player.z - 0.5,
      `Δx=${(dD.player.x - before.player.x).toFixed(2)} Δz=${(dD.player.z - before.player.z).toFixed(2)}`,
    )

    // ---------- 3. 마우스 조준 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(200)
    // 월드 (0, 10) = rotY 0 방향(+Z), 월드 (10, 0) = rotY 90°(+X)
    await aimAt(0, 10)
    let aimed = await waitUntil((st) => Math.abs(st.player.rotY) < 0.12, 3000)
    check('커서를 +Z에 두면 캐릭터가 +Z를 봄', aimed.ok, `rotY=${aimed.state.player.rotY}`)
    // 화면좌표 -> 지면 왕복 검사.
    // z가 정확히 10이 아니라 11 근처로 나오는 것은 버그가 아닙니다: 카메라가 커서 쪽으로
    // 시야를 미는 aimLead(18%, 최대 3.2m) 때문에, NDC를 고정하면 지면 교차점이
    // 리드만큼 바깥으로 밀립니다. 방향이 맞고 리드 상한 안에 있으면 정상입니다.
    check(
      '커서 월드좌표 왕복(카메라 리드 포함)',
      Math.abs(aimed.state.aim.x) < 1.0 && aimed.state.aim.z > 9 && aimed.state.aim.z < 10 + 3.4,
      `aim=(${aimed.state.aim.x}, ${aimed.state.aim.z}) / 기대 z≈10~13.4`,
    )

    await aimAt(10, 0)
    aimed = await waitUntil((st) => Math.abs(st.player.rotY - Math.PI / 2) < 0.12, 3000)
    check('커서를 +X에 두면 캐릭터가 +X를 봄', aimed.ok, `rotY=${aimed.state.player.rotY}`)

    // ---------- 4. 회피 구르기 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(300)
    before = await state()
    await tap('Space')
    const dodging = await waitUntil((st) => st.player.state === 2, 2500)
    check('Space로 회피 구르기 진입', dodging.ok, `state=${dodging.state.player.state}`)
    /**
     * ⚠️ **숫자를 여기 적어 두지 않습니다.** 예전에는 `- 25` 라고 박아 뒀는데,
     *    그건 규칙의 **세 번째 사본**이었습니다(playerControl · main · 여기).
     *    회피 값을 25 → 18 로 옮기는 날 이 줄만 옛 값을 들고 빨개집니다 —
     *    게임은 멀쩡한데 검사가 틀리는, 이 저장소가 제일 싫어하는 모양입니다.
     */
    const dodgeCost = await page.evaluate(() => window.__game.dodgeInfo().cost)
    check(
      `회피가 스태미나 ${dodgeCost} 소모`,
      dodging.ok && Math.abs(before.player.stamina - dodging.state.player.stamina - dodgeCost) < 3,
      `${before.player.stamina} -> ${dodging.state.player.stamina}`,
    )
    const rolled = await waitUntil((st) => st.player.state !== 2, 3000)
    const rollDist = Math.hypot(rolled.state.player.x - before.player.x, rolled.state.player.z - before.player.z)
    check('회피 이동거리 약 4.2m', rollDist > 3.0 && rollDist < 5.5, `${rollDist.toFixed(2)}m`)
    const staminaBack = await waitUntil((st) => st.player.stamina > 95, 6000)
    check('스태미나 자동 회복', staminaBack.ok, `${staminaBack.state.player.stamina}`)

    /**
     * ⚠️ **앞뒤를 리셋으로 격리합니다.** 이 절은 달리고 구르므로, 격리하지
     *    않으면 남은 속도가 다음 검사에 얹힙니다 — 실제로 *"회피 이동거리
     *    4.2m"* 가 5.63m → 9.37m 으로 두 번 빨개졌고, 두 번 다 게임이 아니라
     *    **앞 검사가 뒤 검사를 오염시킨** 것이었습니다.
     */
    await page.evaluate(() => window.__game.reset())
    await sleep(300)
    /**
     * ── ⚔️ **상황이 모션을 바꾸는가** ────────────────────────────────
     *
     * 무기 하나가 가진 것이 콤보 2~4타 + 강타 + 처형뿐이라, 서 있든 달리든
     * 막 굴렀든 좌클릭은 늘 같은 1타였습니다. 소울류의 깊이는 대부분
     * **상태가 기술을 고르는** 데서 나옵니다(다크 소울·엘든 링의 달리기·
     * 구르기 공격, 몬헌의 회피 파생기, 오공의 달리며 치기).
     *
     * ⚠️ 이름을 프로브가 정하지 않습니다 — `moveInfo().pending` 은 게임이
     *    `contextComboIndex` 로 판단한 결과입니다. 조건을 베끼면 상황을
     *    하나 더 넣는 날 프로브만 옛 규칙을 씁니다.
     */
    {
      const mv = await page.evaluate(() => window.__game.moveInfo())
      // ① 아무것도 안 하면 평범한 1타 — **실패할 수 있는 짝**입니다.
      check('가만히 서서 치면 평소 1타', mv.pending === '1타', `"${mv.pending}"`)

      /**
       * ②③ 굴러 넘긴 **직후** 창이 열리고, 지나면 닫히는가.
       *
       * ⚠️ **한 번의 evaluate 안에서 둘 다 잽니다.** 처음엔 나눠 불렀는데,
       *    두 호출 사이의 왕복이 창(0.35초)보다 길어져서 *"창이 지나면 도로
       *    1타"* 가 엉뚱하게 빨개졌습니다. 따로 추적해 보니 게임은 정확히
       *    0.35 → 0 으로 닫히고 있었습니다 — **계측기가 창보다 느렸습니다.**
       *    창보다 짧은 것을 재려면 재는 쪽이 그 안에 있어야 합니다.
       */
      const rollWin = await page.evaluate(async () => {
        const G = window.__game
        const step = () => new Promise((r) => setTimeout(r, 8))
        G.press('Space')
        G.release('Space')
        let opened = null
        const t0 = G.state().elapsed
        while (G.state().elapsed - t0 < 2) {
          const m = G.moveInfo()
          if (m.rollWindowT > 0) {
            opened = m
            break
          }
          await step()
        }
        let closed = null
        /**
         * ⚠️ **4초를 줍니다(창은 0.35초).**
         *
         * 2초로 잡았다가 느린 판에서 한 번 빨개졌습니다. 창은 구르는
         * **동안에는 안 줄어들고**(끝난 뒤에 여는 규칙), 선입력이 살아 있으면
         * 한 번 더 구를 수 있습니다. 그러면 닫히는 시점이 창 길이가 아니라
         * **구르기 하나만큼** 뒤로 밀립니다. 재려는 것은 *"언젠가 닫히는가"*
         * 이지 *"몇 초에 닫히는가"* 가 아니므로 여유를 줍니다.
         */
        const t1 = G.state().elapsed
        while (G.state().elapsed - t1 < 4) {
          const m = G.moveInfo()
          if (m.rollWindowT === 0) {
            closed = m
            break
          }
          await step()
        }
        return { opened, closed }
      })
      check(
        '구른 직후엔 **구르기 공격**이 열린다',
        rollWin.opened?.pending === '구르기 공격' && rollWin.opened?.rollWindowT > 0,
        `"${rollWin.opened?.pending}" · 창 ${rollWin.opened?.rollWindowT}초`,
      )
      check(
        '창이 지나면 도로 1타 (상시 기술이 아니다)',
        rollWin.closed?.pending === '1타',
        `"${rollWin.closed?.pending}"`,
      )

      // ④ 달리는 중 — 거리를 좁히는 기술로 바뀝니다.
      const running = await page.evaluate(async () => {
        const G = window.__game
        G.press('KeyW')
        G.press('ShiftLeft')
        const deadline = G.state().elapsed + 2
        let m = G.moveInfo()
        while (G.state().elapsed < deadline) {
          m = G.moveInfo()
          if (m.sprinting) break
          await new Promise((r) => setTimeout(r, 8))
        }
        const out = { ...m }
        G.release('KeyW')
        G.release('ShiftLeft')
        /**
         * ⚠️ **멈출 때까지 기다립니다.** 이걸 빼먹었더니 바로 다음 검사인
         *    *"회피 이동거리 약 4.2m"* 가 **5.63m** 로 빨개졌습니다 —
         *    달리던 속도가 남아 구르기 거리에 얹힌 것입니다. 게임은 멀쩡한데
         *    **앞 검사가 뒤 검사를 오염시킨** 것이고, 이 저장소에서 제일
         *    비싼 종류의 거짓말입니다.
         */
        const stop = G.state().elapsed + 1.2
        while (G.state().elapsed < stop) await new Promise((r) => setTimeout(r, 8))
        return out
      })
      check(
        '달리는 중엔 **달리기 공격**이 나간다',
        running.sprinting && running.pending === '달리기 공격',
        `달리는 중 ${running.sprinting} · "${running.pending}"`,
      )

      /**
       * ⑤ **세 무기 모두** 새 기술이 자기 성격을 물려받는가.
       *
       * 한 무기만 통과시키면 나머지 둘을 든 사람에게는 없는 기술이 됩니다
       * (punish.ts 가 같은 문장을 이미 적어 뒀습니다). 값을 프로브가 다시
       * 곱하지 않고, 게임이 **계산해 준 결과**를 견줍니다.
       */
      const tbl = await page.evaluate(() => window.__game.weaponTable())
      /**
       * ⚠️ **여기 셋은 인자 순서가 뒤집혀 있었습니다** — `check(조건, '라벨')`.
       *
       * 서명은 `check(label, ok)` 인데 조건을 앞에 넣었으니, 라벨 자리에
       * boolean 이 가고 **판정 자리에는 문자열(항상 참)** 이 갔습니다.
       * 즉 세 검사 모두 무슨 값이 나오든 초록이었습니다 — 이 저장소에서
       * 같은 실수가 이걸로 **다섯 번째**입니다(출혈 5개 · 여기 3개).
       * 검사가 빨개질 수 없으면 검사가 아닙니다.
       */
      const badLunge = tbl.filter((w) => !(w.moves[0].lunge > w.firstLunge))
      check(
        '달리기 공격은 세 무기 모두 **1타보다 더 파고든다** (거리를 좁히는 기술)',
        tbl.length >= 3 && badLunge.length === 0,
        tbl.map((w) => `${w.id} ${w.moves[0].lunge}>${w.firstLunge}`).join(' · '),
      )
      const badFast = tbl.filter((w) => !(w.moves[1].windup < w.firstWindup))
      check(
        '구르기 공격은 세 무기 모두 **1타보다 빠르다** (갚는 손이니까)',
        tbl.length >= 3 && badFast.length === 0,
        tbl.map((w) => `${w.id} ${w.moves[1].windup}<${w.firstWindup}`).join(' · '),
      )
      /** 무기 성격이 살아 있는가 — 대검의 새 기술이 단검보다 느려야 합니다. */
      const gs = tbl.find((w) => w.id === 'greatsword')
      const dg = tbl.find((w) => w.id === 'daggers')
      check(
        '새 기술에도 무기 성격이 따라온다 (대검이 단검보다 느리게 달려든다)',
        !!gs && !!dg && gs.moves[0].windup > dg.moves[0].windup,
        `대검 ${gs?.moves[0].windup} vs 단검 ${dg?.moves[0].windup}`,
      )
    }

    await page.evaluate(() => window.__game.reset())
    await sleep(300)

    /**
     * ── 🩸 **세 번째 축이 실제로 도는가** ────────────────────────────
     *
     * 적에게 쌓이는 것이 체력과 강인도 둘뿐이었고, 둘 다 *"한 방이 얼마나
     * 센가"* 를 묻습니다. 참고 게임은 전부 세 번째를 갖고 있습니다 —
     * 소울류의 출혈·독, 블러드본의 신속 독, 오공의 화상·빙결·감전,
     * 로스트아크의 파괴·무력화. 공통점은 **한 방이 아니라 이어짐**이
     * 보상받는다는 것입니다.
     *
     * ⚠️ 문턱과 배율을 프로브가 들고 있지 않습니다 — `bleedInfo()` 가
     *    게임의 값을 그대로 줍니다. 값을 바꾸는 날 검사만 빨개지면
     *    고쳐야 할 것은 게임이 아니라 검사입니다.
     */
    {
      /**
       * ⚠️ **인자 순서를 한 번 뒤집어 썼습니다** — `check(조건, '라벨')` 로.
       *    그러면 라벨 자리에 `true` 가 들어가고 조건 자리에 문자열이
       *    들어가서 **다섯 검사가 전부 무조건 통과**했습니다. 출력의
       *    `PASS  true` 가 그 흔적입니다. 이 파일은 `check(라벨, 조건, 설명)`
       *    입니다. 이 저장소가 제일 비싸게 치는 실패가 **아무 말도 안 하는
       *    계측기**인데, 새 축을 넣으면서 그걸 다섯 개 만들 뻔했습니다.
       */
      await page.evaluate(() => window.__game.reset())
      await sleep(300)
      const rule = await page.evaluate(() => window.__game.bleedInfo())

      /**
       * ① **두 축이 반대 방향인가.** 같은 방향이면 축이 하나 늘어난 것이
       *    아니라 강한 무기가 더 강해질 뿐입니다.
       */
      const heavy = rule.weapons.find((w) => w.id === 'greatsword')
      const light = rule.weapons.find((w) => w.id === 'daggers')
      check(
        '강인도와 출혈이 **반대 방향**이다 (대검은 무너뜨리고 단검은 터뜨린다)',
        !!heavy && !!light && heavy.poiseScale > light.poiseScale && heavy.bleedScale < light.bleedScale,
        `대검 강인도 ${heavy?.poiseScale}·출혈 ${heavy?.bleedScale} vs 단검 ${light?.poiseScale}·${light?.bleedScale}`,
      )
      // ② 무기마다 "몇 바퀴면 터지는가"가 실제로 다른가.
      const laps = (w) => rule.max / w.perCombo
      check(
        '무기마다 **터지기까지의 바퀴 수**가 크게 다르다 (선택이 되게)',
        !!heavy && !!light && laps(heavy) > laps(light) * 2,
        rule.weapons.map((w) => `${w.id} ${(rule.max / w.perCombo).toFixed(1)}바퀴`).join(' · '),
      )

      /**
       * ③ **실제로 쌓이고 터지는가.** 허수아비를 세워 두고 단검으로
       *    이어 칩니다. 판정은 게임의 `enemyInfo().bleed` 와 `bleedPops`
       *    가 내립니다 — 봇이 타수를 세어 추정하지 않습니다.
       */
      const popped = await page.evaluate(async () => {
        const G = window.__game
        const sleep2 = () => new Promise((r) => setTimeout(r, 8))
        G.reset()
        await new Promise((r) => setTimeout(r, 400))
        G.clearEnemies()
        await new Promise((r) => setTimeout(r, 200))
        /**
         * 3번 무기(쌍단검)로 바꿉니다 — 이 축을 파는 무기입니다.
         *
         * ⚠️ **바뀔 때까지 기다립니다.** 무기 교체는 동작이 끝난 뒤에
         *    적용되므로(playerControl `bufferedWeapon`), 300ms 를 자고
         *    넘어갔더니 롱소드로 재고 있었습니다 — 쌓인 값이 12(배율 1.0)
         *    였던 것이 그 흔적입니다. 바뀐 것을 **확인**하고 갑니다.
         */
        G.press('Digit3')
        G.release('Digit3')
        const swapBy = G.state().elapsed + 2
        while (
          G.state().elapsed < swapBy &&
          G.state().loadout.slots[0] !== 'shadow_step'
        ) {
          await sleep2()
        }
        const weaponOk = G.state().loadout.slots[0] === 'shadow_step'
        const p = G.state().player
        const e = G.spawnEnemyKind('grunt', p.x + 1.6, p.z)
        // 죽으면 표본이 사라지므로 체력을 크게 잡아 둡니다.
        G.setHp(e, 9999)
        G.aimAtWorld(G.enemyInfo(e).x, G.enemyInfo(e).z)
        const before = G.runStats().bleedPops
        let peak = 0
        const t0 = G.state().elapsed
        while (G.state().elapsed - t0 < 14) {
          const i = G.enemyInfo(e)
          if (i) {
            peak = Math.max(peak, i.bleed)
            G.setHp(e, 9999)
            /**
             * ⚠️ **적이 아니라 플레이어를 붙입니다.**
             *
             * 처음엔 넉백으로 밀려난 적을 매 프레임 순간이동으로 되돌렸는데,
             * 14초 동안 **한 대**만 들어갔습니다. 적을 옮기는 것이 그 적의
             * 물리·상태를 방해했습니다 — 토큰 실험에서 이미 한 번 겪은
             * 모양입니다(*"계측기가 재려는 것을 바꿔 버리면 그 숫자는
             * 게임의 것이 아닙니다"*). 이번엔 **내 쪽**을 옮깁니다.
             */
            G.teleportPlayer(i.x - 1.4, i.z)
            G.aimAtWorld(i.x, i.z)
          }
          G.press('Mouse0')
          G.release('Mouse0')
          await sleep2()
        }
        /**
         * ④ **식는지도 같은 evaluate 안에서 잽니다.**
         *
         * 처음엔 따로 불러서 `G.enemies()` 로 적을 다시 찾으려 했는데,
         * **그런 훅이 없습니다.** 그러면 빈 값이 들어와 검사가 조용히
         * 통과했을 자리입니다 — 이 저장소가 빈 배열로 세 번 데인 모양
         * 그대로입니다. 적을 쥐고 있는 여기서 이어서 잽니다.
         */
        /**
         * ⑤ **그려진 게이지를 여기서 잡습니다** — 아직 쌓여 있을 때.
         *
         * 처음엔 이 evaluate 가 끝난 **뒤에** 읽었는데, 그 사이 5초를
         * 기다리며 식혀 놓고 *"게이지가 안 뜬다"* 고 적었습니다. 게임은
         * 멀쩡했고 **읽는 시점이 틀렸습니다.** 창보다 짧은 것을 재려면
         * 재는 쪽이 그 안에 있어야 한다는, 이 세션에서 이미 두 번 배운 것.
         */
        const bars = G.bleedBars()
        // 마지막 타격 직후의 값을 잡고, 그 뒤로는 **아무것도 안 합니다**.
        const coolStart = G.enemyInfo(e)?.bleed ?? -1
        const t1 = G.state().elapsed
        while (G.state().elapsed - t1 < 5) await sleep2()
        const coolEnd = G.enemyInfo(e)?.bleed ?? -1
        return {
          weaponOk,
          bars,
          // 몇 대가 실제로 들어갔는가 — "안 쌓인다"와 "안 맞았다"를 가릅니다.
          hits: G.state().hitsDealt,
          peak,
          pops: G.runStats().bleedPops - before,
          coolStart,
          coolEnd,
        }
      })
      check(
        '때리면 출혈이 **쌓인다** (측정이 성립했다 — 쌍단검으로 쟀다)',
        popped.weaponOk && popped.peak > 0,
        `무기 교체 ${popped.weaponOk ? 'O' : 'X'} · 때린 횟수 ${popped.hits} · 최고 ${popped.peak} / ${rule.max}`,
      )
      check('가득 차면 **터진다**', popped.pops > 0, `${popped.pops}회`)
      /**
       * ⚠️ **비율 피해에는 상한이 있어야 합니다.**
       *
       * 이 검사가 없어서 `npm run weapons` 가 먼저 죽었습니다 — 허수아비
       * 체력을 1,000,000 으로 세우자 한 번 터질 때 **15만**이 들어갔고,
       * 초당 피해가 18,764 로 찍혔습니다. 계측기 탓이 아니라 **규칙에
       * 상한이 없다**는 뜻이고, 체력 큰 적이 나오는 날 그 적은 출혈 하나로
       * 삭제됩니다. 값이 아니라 **위가 막혀 있는지**를 검사합니다.
       */
      check(
        '터질 때 피해에 **상한이 있다** (체력 큰 적이 한 방에 삭제되지 않게)',
        rule.popDamageCap > 0 && rule.popDamageCap < 1e6 * rule.popDamagePct,
        `상한 ${rule.popDamageCap} · 비율 ${rule.popDamagePct} (체력 100만이면 상한 없이 ${1e6 * rule.popDamagePct})`,
      )

      /**
       * ④ **식는가** — 이 줄이 없으면 "언젠가는 터진다"가 되어, 소울류의
       *    출혈이 아니라 그냥 느린 피해입니다. **실패할 수 있는 짝**입니다.
       */
      check(
        '때리지 않으면 **식는다** (이어진 압박만 보상받게)',
        popped.coolStart > 0 && popped.coolEnd < popped.coolStart,
        `${popped.coolStart} → ${popped.coolEnd}`,
      )

      /**
       * ⑤ **화면에 실제로 그려지는가.**
       *
       * 값이 맞아도 안 보이면 없는 것입니다 — 이 저장소가 인지 규칙·처형
       * 안내·초록 예고에서 세 번 겪은 실패입니다. 게임 안의 숫자를 다시
       * 묻지 않고 **그려진 것**(`bleedBars`)을 읽습니다.
       *
       * 짝을 맞춥니다: 쌓였을 땐 보이고, **0일 땐 안 보입니다** — 안 쓰는
       * 축의 빈 칸이 늘 떠 있으면 있지도 않은 축을 보게 됩니다.
       */
      const shown = (popped.bars ?? []).filter((b) => b.visible)
      check(
        '쌓이면 게이지가 **화면에 뜬다** (안 보이면 없는 것입니다)',
        shown.length > 0 && shown.every((b) => b.fill > 0),
        (popped.bars ?? [])
          .map((b) => `${b.bleed}→${b.visible ? `${(b.fill * 100) | 0}%` : '안 뜸'}`)
          .join(' · ') || '적 없음',
      )
      /**
       * ⚠️ **표본이 있는지 먼저 묻습니다.** 처음엔 `every` 만 봤더니
       *    바가 하나도 없을 때 *"표본 없음"* 으로 **조용히 통과**했습니다.
       *    이 저장소가 빈 배열로 네 번째 데인 자리입니다.
       */
      check(
        '차 있는 만큼만 **길이가 맞는다** (숫자와 그림이 같은 것을 말한다)',
        shown.length > 0 &&
          shown.every((b) => Math.abs(b.fill - b.bleed / rule.max) < 0.05),
        shown.map((b) => `${b.bleed}/${rule.max} vs ${(b.fill * 100) | 0}%`).join(' · ') || '**표본 없음**',
      )

      /**
       * ── 🩸 **잘 싸운 타격도 출혈을 쌓는가** ──────────────────────
       *
       * 여기가 이번에 실제로 빨갰던 자리입니다. `applyBleed` 가 판정
       * 사슬의 **마지막 가지 안**에 있어서, 반격·기습·처형으로 때린
       * 타격은 출혈을 한 방울도 안 쌓았습니다. 보스에게 출혈이 한 번도
       * 안 터진 이유가 이것이었고 — **잘 싸울수록 이 축이 죽었습니다.**
       *
       * 참고 게임의 공통 규칙: 누적은 *"맞았는가"* 의 성질이지 *"어느
       * 가지로 갔는가"* 의 성질이 아닙니다(엘든 링의 치명타·백스탭,
       * 몬헌의 상태이상, 로스트아크의 무력화 게이지).
       *
       * ⚠️ 앞의 검사들은 **평타**로만 쟀기 때문에 이걸 못 잡았습니다.
       *    가지가 넷이면 검사도 가지를 알아야 합니다.
       */
      const branches = await page.evaluate(async () => {
        const G = window.__game
        const sleep2 = () => new Promise((r) => setTimeout(r, 8))
        const runFor = async (s) => {
          const t = G.state().elapsed + s
          while (G.state().elapsed < t) await sleep2()
        }
        /** 적 하나를 붙잡고 한 대 때린 뒤, 출혈이 얼마나 올랐는지 돌려줍니다. */
        const hitOnce = async (asleep, breakFirst) => {
          G.reset()
          await runFor(0.4)
          const e = G.spawnEnemyKind('grunt', 6, 0, asleep)
          await runFor(0.3)
          G.setHp(e, 9999)
          const i0 = G.enemyInfo(e)
          if (!i0) return null
          G.teleportPlayer(i0.x - 1.2, i0.z)
          G.aimAtWorld(i0.x, i0.z)
          await runFor(0.2)
          if (breakFirst) G.breakEnemy(e)
          await runFor(0.05)
          const before = G.enemyInfo(e)?.bleed ?? -1
          const finBefore = G.runStats().finishers
          const hitsBefore = G.state().hitsDealt
          G.press('Mouse0')
          G.release('Mouse0')
          // 판정이 뜰 때까지만 기다립니다 — 식기 전에 읽어야 합니다.
          const deadline = G.state().elapsed + 1.5
          while (G.state().elapsed < deadline && G.state().hitsDealt === hitsBefore) {
            G.setHp(e, 9999)
            await sleep2()
          }
          return {
            before,
            after: G.enemyInfo(e)?.bleed ?? -1,
            hit: G.state().hitsDealt > hitsBefore,
            finisher: G.runStats().finishers > finBefore,
          }
        }
        return { ambush: await hitOnce(true, false), finisher: await hitOnce(false, true) }
      })
      // 게이트 — 때리지도 못했으면 아래 비교는 아무 뜻이 없습니다.
      check(
        '가지별 측정이 성립했다 (기습·처형 둘 다 실제로 맞혔다)',
        branches.ambush?.hit === true && branches.finisher?.hit === true,
        `기습 ${branches.ambush?.hit ? 'O' : 'X'} · 처형 ${branches.finisher?.hit ? 'O' : 'X'}(처형 판정 ${branches.finisher?.finisher ? 'O' : 'X'})`,
      )
      check(
        '🩸 **기습**도 출혈을 쌓는다 (누적은 가지를 안 가린다)',
        branches.ambush?.hit === true && branches.ambush.after > branches.ambush.before,
        `${branches.ambush?.before} → ${branches.ambush?.after}`,
      )
      /**
       * ── 🥋 **집중은 실제로 평타에서 오는가** ─────────────────────
       *
       * 설계 노트가 오공을 인용해 *"집중을 쌓는 것은 가벼운 공격 —
       * 위험한 근접 거리에 머문 대가"* 라고 적어 뒀습니다. 그런데 그
       * 문장이 참인지 재는 검사는 **하나도 없었습니다.**
       *
       * 실제로 이번에 계측기를 붙이다가 배선이 빠진 채로 돌렸고, 화면에
       * *"평타 0점 (0%)"* 이 찍혔습니다. 게임은 멀쩡했고 **재는 쪽이
       * 안 붙어 있었을 뿐**인데, 하마터면 "평타가 자원을 못 번다"는 큰
       * 결론을 그대로 들고 갈 뻔했습니다. 그래서 라이브로 못 박습니다.
       */
      const focusRun = await page.evaluate(async () => {
        const G = window.__game
        const sleep2 = () => new Promise((r) => setTimeout(r, 8))
        G.reset()
        const runFor = async (sec) => {
          const t = G.state().elapsed + sec
          while (G.state().elapsed < t) await sleep2()
        }
        await runFor(0.4)
        const e = G.spawnEnemyKind('grunt', 6, 0)
        await runFor(0.3)
        const i0 = G.enemyInfo(e)
        if (!i0) return null
        G.teleportPlayer(i0.x - 1.2, i0.z)
        G.aimAtWorld(i0.x, i0.z)
        await runFor(0.2)
        /**
         * ⚠️ **집중을 0으로 놓고 시작합니다.**
         *
         * 이걸 안 했더니 *"5대 → 0점"* 으로 빨개졌습니다. 게임은 멀쩡했고
         * (따로 재보니 7대 → 2.33점, 7/3 정확) **앞 검사들이 집중을 3/3
         * 까지 채워 놓은 것**이 원인이었습니다. 가득 찬 뒤에 들어온 몫은
         * 전부 `버림` 으로 가니 `평타` 는 0 입니다.
         *
         * 이 저장소가 이미 한 번 데인 모양 그대로입니다 — *"앞 검사가 뒤
         * 검사를 오염시킨"*(달리던 속도가 구르기 거리에 얹혔던 그 자리).
         * 앞에서 무엇이 돌았든 같은 답이 나와야 검사입니다.
         */
        G.setFocus(0)
        const startFocus = G.focusInfo().focus
        const before = G.runStats().focusFlow['평타']
        const hitsBefore = G.state().hitsDealt
        // 콤보 한 바퀴가 돌 만큼만 칩니다.
        const t0 = G.state().elapsed
        while (G.state().elapsed - t0 < 3) {
          const i = G.enemyInfo(e)
          if (i) {
            G.setHp(e, 9999)
            G.teleportPlayer(i.x - 1.2, i.z)
            G.aimAtWorld(i.x, i.z)
          }
          G.press('Mouse0')
          G.release('Mouse0')
          await sleep2()
        }
        return {
          hits: G.state().hitsDealt - hitsBefore,
          gained: Number((G.runStats().focusFlow['평타'] - before).toFixed(2)),
          focus: G.focusInfo().focus,
          comboLength: G.state().loadout.comboLength,
          startFocus,
          wasted: Number((G.runStats().focusFlow['버림'] ?? 0).toFixed(2)),
        }
      })
      check(
        '집중 측정이 성립했다 (실제로 평타를 맞혔다)',
        (focusRun?.hits ?? 0) > 0,
        `${focusRun?.hits ?? 0}대`,
      )
      check(
        '🥋 **평타가 집중을 번다** (설계가 말하는 자원의 출처)',
        (focusRun?.hits ?? 0) > 0 && (focusRun?.gained ?? 0) > 0,
        `${focusRun?.hits}대 → ${focusRun?.gained}점 (시작 집중 ${focusRun?.startFocus} · 넘쳐 흘린 것 ${focusRun?.wasted})`,
      )
      /**
       * 짝이 되는 음성 검사. "콤보 한 바퀴 = 1점"이 약속이므로, 맞은 대수를
       * 콤보 길이로 나눈 값과 얼추 같아야 합니다. 이게 없으면 한 대만
       * 들어가도 위 검사가 초록입니다.
       */
      check(
        '한 바퀴가 **1점**이라는 약속이 지켜진다 (무기 길이와 무관하게)',
        (focusRun?.hits ?? 0) >= 3 &&
          Math.abs((focusRun?.gained ?? 0) - (focusRun?.hits ?? 0) / focusRun.comboLength) < 0.35,
        `${focusRun?.hits}대 / ${focusRun?.comboLength}타 = ${((focusRun?.hits ?? 0) / (focusRun?.comboLength ?? 1)).toFixed(2)}점 기대 · 실제 ${focusRun?.gained}점`,
      )

      /**
       * ── 🍶 **회복을 노리는 적이 있는가** ─────────────────────────
       *
       * 마시기에는 무적 프레임이 **일부러** 없습니다(components.ts). 그런데
       * `enemyAI.ts` 전체에 플레이어의 상태를 읽는 줄이 하나도 없어서,
       * 그 위험을 만들 주체가 아무도 없었습니다 — 설계 노트만 있고 실행이
       * 없는 상태였습니다. 소울류에서 *"언제 마실까"* 가 어려운 이유가
       * 정확히 이것이고, 안전한 회복은 체력을 자원이 아니라 시간으로
       * 만듭니다.
       *
       * ⚠️ 검사할 것이 둘입니다:
       *   ① 마시면 적이 **실제로 당겨서** 커밋하는가
       *   ② 그러면서 **예고는 그대로인가** — 줄어들면 기둥 2가 깨집니다
       */
      const heal = await page.evaluate(async () => {
        const G = window.__game
        const sleep2 = () => new Promise((r) => setTimeout(r, 8))
        const runFor = async (sec) => {
          const t = G.state().elapsed + sec
          while (G.state().elapsed < t) await sleep2()
        }
        const p = G.playerEntity()
        G.reset()
        await runFor(0.4)
        G.setPlayerInvulnerable(true)
        const e = G.spawnEnemyKind('grunt', 6, 0)
        await runFor(0.2)
        if (!G.enemyInfo(e)) return null
        G.wakeEnemy(e)
        const pin = () => {
          const i = G.enemyInfo(e)
          if (i) G.teleportPlayer(i.x - 1.8, i.z)
          return i
        }
        pin()
        G.setHp(p, 40)
        await runFor(0.3)
        /**
         * ⚠️ **쿨다운이 넉넉히 남은 순간을 잡습니다.**
         *
         * 처음엔 *"마신 뒤 예고가 뜨기까지 걸린 시간"* 을 쟀는데, 기준선이
         * 판마다 1.15초와 "한 번도 못 봄" 사이를 오갔습니다. 재려는 것은
         * **규칙이 바꾸는 값**(쿨다운)인데 그 값의 *결과*(언제 휘두르나)를
         * 재고 있었으니, 사이에 낀 모든 것이 잡음으로 들어옵니다.
         * 이 저장소가 반복해서 배운 것 그대로입니다 — **재는 대상을 고칩니다.**
         */
        let before = -99
        const t0 = G.state().elapsed
        while (G.state().elapsed - t0 < 12) {
          const i = pin()
          if (i && !i.attacking && i.cooldown > G.punishHealInfo().cutTo + 0.3) {
            before = i.cooldown
            break
          }
          await sleep2()
        }
        if (before === -99) return { ok: false }
        const armedBefore = G.runStats().healPunished
        G.press('KeyX')
        G.release('KeyX')
        await runFor(0.1)
        const i2 = pin()
        const after = i2 ? i2.cooldown : -99
        const drinking = G.state().player.state === 6
        G.setPlayerInvulnerable(false)
        return {
          ok: true,
          before: Number(before.toFixed(2)),
          after: Number(after.toFixed(2)),
          drinking,
          armed: G.runStats().healPunished - armedBefore,
          cutTo: G.punishHealInfo().cutTo,
          windup: i2?.windup ?? -1,
          minBase: Math.min(
            ...G.enemyRoster()
              .find((r) => r.id === 'grunt')
              .attacks.map((a) => a.windup),
          ),
        }
      })
      check(
        '회복 노림 측정이 성립했다 (실제로 마셨고, 쿨다운이 남은 자리를 잡았다)',
        heal?.ok === true && heal.drinking === true && heal.before > heal.cutTo,
        `마시는 중 ${heal?.drinking} · 마시기 전 쿨다운 ${heal?.before}초`,
      )
      check(
        '🍶 **마시면 적이 노린다** (회복이 안전하면 체력은 자원이 아니라 시간입니다)',
        heal?.ok === true && heal.armed > 0 && heal.after <= heal.cutTo + 0.001,
        `쿨다운 ${heal?.before}초 → ${heal?.after}초 (문턱 ${heal?.cutTo}) · 노린 횟수 ${heal?.armed}`,
      )
      check(
        '🍶 그래도 **예고는 안 줄어든다** (당기는 것은 쿨다운뿐)',
        heal?.ok === true && (heal.windup <= 0 || heal.windup >= heal.minBase - 0.001),
        `설정 최소 ${heal?.minBase}초 · 지금 ${heal?.windup}초`,
      )

      check(
        '🩸 **처형**도 출혈을 쌓는다 (잘 싸울수록 축이 죽으면 안 됩니다)',
        branches.finisher?.hit === true &&
          branches.finisher.finisher === true &&
          branches.finisher.after > branches.finisher.before,
        `${branches.finisher?.before} → ${branches.finisher?.after}`,
      )
    }

    // ---------- 5. 공격 상태 기계 & 콤보 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(300)
    await tap('Mouse0')
    const attacking = await waitUntil((st) => st.player.state === 1, 2000)
    check('좌클릭으로 공격 진입', attacking.ok, `state=${attacking.state.player.state}`)

    // 연타해서 3타까지 이어지는지
    let maxCombo = 0
    for (let i = 0; i < 26; i++) {
      await tap('Mouse0')
      const st = await state()
      if (st.player.state === 1) maxCombo = Math.max(maxCombo, st.player.comboIndex)
      await sleep(70)
    }
    check('연타 시 3타 콤보까지 진행', maxCombo >= 2, `도달 콤보 인덱스 ${maxCombo} (0,1,2 중)`)

    // ---------- 6. 타격 판정 + 손맛(히트스톱/화면흔들림) ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(300)

    // 가장 가까운 적을 계속 조준하며 접근 + 공격
    let sawHitstop = false
    let sawTrauma = 0
    let killShot = null
    const combatStart = Date.now()
    await press('KeyW') // 아무 방향으로든 계속 움직이며 교전 유도
    while (Date.now() - combatStart < 45000) {
      const st = await state()
      if (st.hitstop > 0) {
        // 타격이 꽂혀 게임이 멈춘 바로 그 순간을 캡처합니다.
        // 이펙트/히트스톱 연출을 눈으로 확인할 수 있는 유일한 타이밍입니다.
        if (!sawHitstop) await shot('02b-impact-frame')
        sawHitstop = true
      }
      sawTrauma = Math.max(sawTrauma, st.trauma)
      if (st.kills >= 1 && !killShot) killShot = st
      if (st.kills >= 2 || st.gameOver) break

      if (st.nearestEnemy) {
        await aimAt(st.nearestEnemy.x, st.nearestEnemy.z)
        // 적 쪽으로 걸어가기: W 대신 조준 방향으로 가도록 키를 바꿔가며 접근
        if (st.nearestEnemy.dist < 2.2) {
          await release('KeyW')
          await tap('Mouse0')
        } else {
          await press('KeyW')
        }
      }
      await sleep(90)
    }
    await release('KeyW')
    const combat = await state()

    check('전투 중 적에게 피해를 입힘(처치 발생)', combat.kills >= 1, `${combat.kills}마리 처치`)
    check('타격 시 히트스톱 발동', sawHitstop, sawHitstop ? '감지됨' : '미감지')
    check('타격 시 화면 흔들림(trauma) 발동', sawTrauma > 0.05, `최대 trauma=${sawTrauma.toFixed(3)}`)

    const combatShot = await shot('02-combat')
    check('전투 스크린샷 생성', statSync(combatShot).size > 15000, `${(statSync(combatShot).size / 1024).toFixed(0)} KB`)

    // ---------- 7. 적 AI가 실제로 플레이어를 공격하는가 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(300)
    const startHp = (await state()).player.hp
    const damaged = await waitUntil((st) => st.player.hp < startHp, 40000)
    check('적 AI가 플레이어를 추격해 공격함', damaged.ok, damaged.ok ? `체력 ${startHp} -> ${damaged.state.player.hp}` : '40초 내 미발생')
    await shot('03-enemies-engaging')

    // ---------- 7.4 백어택 판정 (기둥 3) ----------
    // 판정은 순수 기하 계산이라, 전투를 돌리지 않고 좌표만 넣어 정확히 검사합니다.
    // 적은 rotY=0 일 때 +Z를 봅니다. 따라서 -Z 쪽(뒤)에서 때리면 백어택입니다.
    const behind = (ax, az, trot = 0) =>
      page.evaluate(([a, b, r]) => window.__game.testBehind(a, b, 0, 0, r), [ax, az, trot])

    check('정면(+Z)에서 때리면 백어택 아님', (await behind(0, 3)) === false)
    check('등 뒤(-Z)에서 때리면 백어택', (await behind(0, -3)) === true)
    check('옆(+X)에서 때리면 백어택 아님', (await behind(3, 0)) === false)
    // 부채꼴 경계를 검사합니다. 각도를 하드코딩하면 밸런스를 만질 때마다
    // 테스트가 "거짓으로" 깨집니다(실제로 120°->140°로 넓히자 깨졌습니다).
    // 그래서 게임이 쓰는 상수를 그대로 읽어 **경계 안/밖**만 확인합니다.
    const { backArcDeg } = await page.evaluate(() => window.__game.tuning())
    const half = backArcDeg / 2
    const at = (deg, r = 3) => [Math.sin(((180 - deg) * Math.PI) / 180) * r, Math.cos(((180 - deg) * Math.PI) / 180) * r]
    check(`뒤에서 ${(half - 5).toFixed(0)}° 비껴서도 백어택 (부채꼴 ${backArcDeg}°)`, (await behind(...at(half - 5))) === true)
    check(`뒤에서 ${(half + 5).toFixed(0)}° 비끼면 백어택 아님`, (await behind(...at(half + 5))) === false)
    // 적이 돌아서면 판정도 같이 돌아야 합니다.
    check('적이 180° 돌면 +Z 쪽이 등 뒤가 됨', (await behind(0, 3, Math.PI)) === true)

    // ---------- 7.5 스킬 + 쿨다운 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(400)
    s = await state()
    check('시작 무기 = 롱소드', s.loadout.weapon === 'longsword', s.loadout.weaponName)
    check(
      '슬롯 4개(무기2 + 룬2)가 모두 채워짐',
      s.loadout.slots.every((x) => x !== null),
      JSON.stringify(s.loadout.slots),
    )
    check('시작 쿨다운은 모두 0', s.loadout.cooldowns.every((c) => c === 0))

    await tap('KeyQ')
    const casting = await waitUntil((st) => st.player.state === 5, 3000)
    check('Q로 스킬 시전 (state=Skill)', casting.ok, `state=${casting.state.player.state}`)
    check(
      '시전과 동시에 해당 슬롯 쿨다운 시작',
      casting.ok && casting.state.loadout.cooldowns[0] > 0,
      `cd=${casting.state?.loadout.cooldowns[0]}`,
    )

    // 시전이 끝난 뒤에도 쿨다운이 남아 있으면 재시전이 막혀야 합니다.
    await waitUntil((st) => st.player.state !== 5, 5000)
    const cdState = await state()
    await tap('KeyQ')
    await sleep(400)
    const afterRecast = await state()
    check(
      '쿨다운 중에는 재시전 불가',
      cdState.loadout.cooldowns[0] > 0 && afterRecast.player.state !== 5,
      `남은 쿨다운 ${cdState.loadout.cooldowns[0]}초`,
    )

    // ---------- 7.6 무기별로 스킬과 콤보가 달라지는가 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(400)
    await tap('Digit2')
    await sleep(400)
    s = await state()
    check('2번 키로 대검 교체', s.loadout.weapon === 'greatsword', s.loadout.weaponName)
    check('대검은 2타 콤보 (롱소드는 3타)', s.loadout.comboLength === 2, `${s.loadout.comboLength}타`)
    check(
      '무기를 바꾸면 Q/E 스킬도 바뀜',
      s.loadout.slots[0] === 'earthshatter' && s.loadout.slots[1] === 'wide_cleave',
      JSON.stringify(s.loadout.slots.slice(0, 2)),
    )
    // 룬 슬롯은 무기와 무관하게 유지되어야 합니다(자유 슬롯의 정의).
    check('무기를 바꿔도 룬 슬롯은 유지됨', s.loadout.slots[2] !== null && s.loadout.slots[3] !== null)

    // 지점 지정 스킬은 커서 위치에 착탄점을 고정합니다.
    await aimAt(6, 0)
    await sleep(250)
    await tap('KeyQ')
    const pointCast = await waitUntil((st) => st.player.state === 5, 3000)
    check(
      '지점 지정 스킬이 커서 쪽에 착탄점을 고정',
      pointCast.ok && Math.hypot(pointCast.state.cast.x - 6, pointCast.state.cast.z) < 4,
      `착탄 (${pointCast.state?.cast.x}, ${pointCast.state?.cast.z}) / 조준 (6, 0)`,
    )

    // 무기 교체는 **대기 상태에서만** 됩니다(시전 중 교체는 의도적으로 막혀 있음).
    // 그래서 시전이 끝날 때까지 기다린 뒤에 눌러야 합니다.
    const idleAgain = await waitUntil((st) => st.player.state === 0, 6000)
    check('시전 중에는 무기 교체가 막힘 (시전 종료 대기)', idleAgain.ok)
    await tap('Digit3')
    await sleep(400)
    s = await state()
    check('3번 키로 쌍단검 교체 + 4타 콤보', s.loadout.weapon === 'daggers' && s.loadout.comboLength === 4, `${s.loadout.weaponName} ${s.loadout.comboLength}타`)

    // ---------- 7.7 다단히트 스킬이 실제로 여러 번 때리는가 ----------
    /**
     * 쌍단검 E = 연속 찌르기(5회). 체력 변화가 아니라 **명중 횟수 자체**를 셉니다.
     *
     * ── 왜 다시 썼는가 ────────────────────────────────────────────
     * 예전에는 웨이브가 살아 있는 채로 "가장 가까운 적"에게 달려가 시전하고,
     * 1.6초를 **벽시계로** 기다린 뒤 hitsDealt 차이를 셌습니다. 그래서 9회,
     * 12회 같은 값이 나왔습니다 — 설계상 최대가 5회인데도요. 여러 적이 한
     * 타격에 같이 맞은 것을 "다단히트"로 세고 있었던 것입니다.
     *
     * 즉 이 검사는 **통과하고 있었지만 재는 대상이 틀려 있었습니다.**
     * 그래서 셋을 고칩니다:
     *   · 표적을 **하나만** 남깁니다 (여럿에 맞은 것을 다단히트로 세지 않게)
     *   · 표적이 **죽지 않게** 합니다 (죽으면 남은 타가 허공을 칩니다)
     *   · 기다리는 것도 **시뮬레이션 시간**으로 (벽시계 1.6초 = 게임 0.3초)
     */
    await page.evaluate(() => window.__game.reset())
    await sleep(400)
    await page.evaluate(() => window.__game.clearEnemies())
    await sleep(200)
    const flurryTarget = await page.evaluate(() => {
      const e = window.__game.spawnTestEnemy(0, 1.6, Math.PI)
      window.__game.freezeEnemies(true)
      window.__game.setHp(e, 100000) // 다단히트 도중에 죽지 않게
      return e
    })
    await tap('Digit3')
    await sleep(300)
    await aimAt(0, 1.6)
    await waitIdle()
    /**
     * **어떤 슬롯이 다단히트인지도 게임에게 물어봅니다.**
     * 처음엔 "E = 슬롯 2 = 연속 찌르기"라고 적어 두었는데 슬롯 2의 hits 는
     * 1이었습니다. 키와 슬롯의 대응을 검증 스크립트가 외우고 있으면,
     * 무기 구성을 바꾸는 순간 **엉뚱한 스킬을 재면서 통과**합니다.
     */
    const flurrySlot = await page.evaluate(() => {
      for (const s of window.__game.slotCooldowns()) {
        if (s.empty) continue
        const spec = window.__game.effectiveSkill(s.slot)
        if (Number(spec?.hits ?? 0) > 1) return { slot: s.slot, key: s.key, hits: Number(spec.hits) }
      }
      return null
    })
    const flurryBefore = (await state()).hitsDealt
    if (flurrySlot) await tap(flurrySlot.key)
    await simSleep(1.6)
    const flurryHits = (await state()).hitsDealt - flurryBefore
    await page.evaluate(() => window.__game.freezeEnemies(false))
    void flurryTarget
    const flurryExpected = flurrySlot?.hits ?? 0
    check(
      '다단히트 스킬이 한 번의 시전으로 설계한 횟수만큼 명중',
      flurryExpected > 1 && flurryHits === flurryExpected,
      `한 번 시전에 ${flurryHits}회 명중 (설계 ${flurryExpected}회 · ${flurrySlot?.key ?? '?'} · 표적 하나·무적)`,
    )

    // ---------- 7.75 스킬 선입력 버퍼 ----------
    // 플레이 테스트: "스킬이 한 번씩밖에 사용이 안 되네."
    // 원인은 쿨다운이 아니라 **입력이 사라지는 것**이었습니다. 시전/공격 중에
    // 누른 스킬 키가 버려져서, 쿨다운 6초짜리를 13초 만에 겨우 다시 쓰고 있었습니다.
    // 그래서 검사도 "쿨다운이 도는가"가 아니라 **"바쁠 때 누른 입력이 살아남는가"** 를 봅니다.
    await page.evaluate(() => window.__game.reset())
    await sleep(400)
    await page.evaluate(() => window.__game.clearEnemies())
    await sleep(300)
    await tap('Digit1') // 롱소드
    await sleep(300)

    // 기본 공격을 시작한 **직후**(선행동작 중)에 Q를 누릅니다.
    // 버퍼가 없으면 이 입력은 그대로 버려집니다.
    await tap('Mouse0')
    await sleep(60)
    await tap('KeyQ')
    const buffered = await waitUntil((st) => st.loadout.cooldowns[0] > 0, 5000)
    check(
      '공격 중에 누른 스킬이 버려지지 않고 이어서 발동됨',
      buffered.ok,
      buffered.ok ? `쿨다운 ${buffered.state.loadout.cooldowns[0]}초 시작` : '5초 내 미발동',
    )

    // ---------- 7.77 논타겟 조준 보정 ----------
    // 플레이 테스트: "아예 논타겟팅인 만큼 맞추기가 좀 어려워."
    //
    // 보정의 목표는 **관대하되 무의미하지는 않게**입니다. 그래서 양쪽을 다 봅니다:
    // 대충 맞게 겨눴으면 맞아야 하고, 확실히 빗나가게 겨눴으면 빗나가야 합니다.
    // 뒤쪽이 없으면 조준이 장식이 되고 기둥 3(포지셔닝)이 무너집니다.
    const aimTrial = async (offsetDeg) => {
      await page.evaluate(() => window.__game.reset())
      await sleep(350)
      await page.evaluate(() => window.__game.clearEnemies())
      await page.evaluate(() => window.__game.freezeEnemies(true))
      await sleep(250)
      await page.evaluate(() => window.__game.spawnTestEnemy(0, 2.2, Math.PI))
      await sleep(250)
      const rad = (offsetDeg * Math.PI) / 180
      await aimAt(Math.sin(rad) * 2.2, Math.cos(rad) * 2.2)
      await sleep(250)
      await waitIdle()
      await tap('Mouse0')
      const hit = await waitUntil((st) => st.hitsDealt > 0, 3000)
      return hit.ok
    }
    check('커서가 30° 빗나가도 명중 (보정이 걸림)', await aimTrial(30))
    check('커서가 75° 빗나가면 빗나감 (조준은 여전히 의미 있음)', (await aimTrial(75)) === false)
    await page.evaluate(() => window.__game.freezeEnemies(true))

    // ---------- 7.8 백어택이 실제 전투에 반영되는가 ----------
    // 적 AI를 멈추고 1:1로 통제된 실험을 합니다.
    // 적이 계속 몸을 돌리면 "보너스가 왜 안 붙지?"가 판정 버그 때문인지
    // 타이밍 때문인지 구분할 수 없어, 검증이 아니라 추측이 됩니다.
    // 적을 **원하는 방향으로** 세워 놓습니다.
    // 플레이어는 원점, 적은 (0, 2.2). 적의 rotY=0 이면 +Z(플레이어 반대)를 보므로
    // 플레이어는 정확히 등 뒤에 있게 됩니다. rotY=PI 면 플레이어를 마주 봅니다.
    // 걸어서 돌아가는 방식은 밀어내기 때문에 재현이 안 돼서 이렇게 바꿨습니다.
    const setupDummy = async (facing) => {
      await page.evaluate(() => window.__game.reset())
      await sleep(300)
      await page.evaluate(() => window.__game.clearEnemies())
      await sleep(200)
      await page.evaluate((f) => window.__game.spawnTestEnemy(0, 2.2, f), facing)
      await page.evaluate(() => window.__game.freezeEnemies(true))
      await sleep(300)
      await aimAt(0, 2.2)
      await sleep(250)
    }
    /** 적을 여러 번 후려쳐, 실제 타격이 날 때까지 기다립니다. */
    //
    // **벽시계로 기다리면 안 됩니다.** 소프트웨어 렌더링에서는 시뮬레이션이 실제
    // 시간의 1/3 속도로 돌아서, 300ms를 기다려도 후딜(0.2초)이 안 끝나 있을 수
    // 있습니다. 그러면 8번을 눌러도 전부 후딜 중에 씹혀 "0타"가 나옵니다.
    // 실제로 그렇게 실패했습니다 — 판정 코드는 멀쩡한데 테스트만 깨진 경우입니다.
    // 그래서 **Idle 상태가 된 것을 확인하고** 누릅니다.
    const swingUntilHit = async (times = 8) => {
      for (let i = 0; i < times; i++) {
        await waitIdle()
        await tap('Mouse0')
        await sleep(220)
        if ((await state()).hitsDealt > 0) break
      }
      return state()
    }

    // (A) 대조군 — 적이 플레이어를 마주 봄. 보너스가 붙으면 안 됩니다.
    await setupDummy(Math.PI)
    let facingMe = await state()
    check('대조군: 적이 플레이어를 마주 봄', facingMe.nearestEnemy?.playerBehind === false)
    const front = await swingUntilHit()
    check('정면 타격은 명중함', front.hitsDealt > 0, `${front.hitsDealt}타`)
    check('정면 타격에는 백어택 보너스가 없음', front.backHits === 0, `백어택 ${front.backHits}회`)

    // (B) 실험군 — 적이 등을 보임. 보너스가 붙어야 합니다.
    await setupDummy(0)
    const turned = await state()
    check('실험군: 플레이어가 적의 등 뒤에 위치', turned.nearestEnemy?.playerBehind === true)
    const back = await swingUntilHit()
    check('등 뒤 타격이 백어택으로 판정됨', back.backHits > 0, `백어택 ${back.backHits}회`)
    // 롱소드 1타 기본 피해는 12. 백어택(x1.55)만 붙어도 18.6,
    // 치명타(x1.8)까지 겹치면 33.5 입니다. 보너스가 없으면 12를 넘을 수 없습니다.
    check(
      '백어택 피해 배율이 실제로 적용됨',
      back.damageDealt > 15,
      `첫 타 피해 ${back.damageDealt} (보너스 없으면 12)`,
    )

    // ---------- 7.9 등 뒤를 잡을 "여유"가 실제로 있는가 ----------
    // 플레이 테스트 피드백: **"뒤로 돌아가도 순간적으로 다시 정면을 향해버려서
    // 백어택 적용이 쉽지가 않네. 조금 여유가 있어야 할 것 같아."**
    //
    // 판정이 맞는지(7.8)와 **잡을 시간이 있는지**는 완전히 다른 문제입니다.
    // 7.8은 적을 얼려놓고 재므로 회전 속도를 아무리 빠르게 해도 통과합니다.
    // 그래서 여기서는 AI를 **살려두고**, 등 뒤에 선 순간부터 적이 돌아설 때까지
    // 몇 초가 걸리는지를 잽니다. 이 숫자가 곧 플레이어가 느끼는 "여유"입니다.
    /**
     * ⚠️ **시뮬레이션 시간으로 잽니다 — 벽시계로 재면 거짓이 됩니다.**
     *
     * 원래 이 검사는 `Date.now()` 로 쟀습니다. 그래서 이 컨테이너(GPU 없음,
     * SwiftShader)에서 게임이 실시간의 1/3~1/20로 흐를 때, 실제로는 적이
     * 1.7초 동안 등을 보이고 있어도 **벽시계로는 0.59초**로 찍혔습니다.
     * 기준이 0.6초라 아슬아슬하게 실패했고, 장비가 바쁠 때만 깨지는
     * "가끔 빨간 줄"이 되어 있었습니다. 게임이 아니라 계측기가 틀린
     * 경우입니다 — 이 프로젝트에서 이미 여러 번 겪은 실패라 규칙으로 둡니다:
     * **게임 안의 시간은 게임에게 물어봅니다.**
     */
    await setupDummy(0)
    await page.evaluate(() => window.__game.freezeEnemies(false)) // AI를 깨웁니다
    const t0 = (await state()).elapsed
    const reactAtStart = await page.evaluate(() => {
      const t = window.__game.threats(30)[0]
      return t ? window.__game.enemyInfo(t.entity)?.reactT : null
    })
    let window0 = 0
    const wallDeadline = Date.now() + 60000
    while (Date.now() < wallDeadline) {
      const st = await state()
      if (st.elapsed - t0 > 6) break
      if (st.nearestEnemy?.playerBehind !== true) break
      window0 = st.elapsed - t0
      await sleep(20)
    }
    // 반응 지연 0.5초 + 150°/s로 180° 회전(1.2초) = 이론상 1.7초.
    // 측정 오차와 프레임률을 감안해 **0.6초 이상**이면 "여유가 생겼다"고 봅니다.
    // 튜닝 전(회전 420°/s, 지연 없음)에는 0.43초라 사실상 불가능했습니다.
    check(
      '등 뒤에 섰을 때 적이 곧바로 돌아서지 않음',
      window0 >= 0.6,
      `등 뒤 유지 ${window0.toFixed(2)}초 (시뮬레이션 시간 · 시작 시 남은 반응 유예 ${reactAtStart ?? '?'}초)`,
    )
    await page.evaluate(() => window.__game.freezeEnemies(true))

    // ---------- 8. 레벨 에디터 ----------
    // 에디터로 레벨을 "만들어서" 저장하고, 그 레벨을 게임이 실제로 불러와
    // 플레이되는지까지 한 번에 확인합니다. 두 프로그램의 접점이 여기라서
    // 따로 검사하면 "에디터는 되는데 게임에서 안 열리는" 상태를 놓칩니다.
    const ed = await context.newPage()
    ed.on('pageerror', (e) => consoleErrors.push(`editor: ${e}`))
    await ed.goto(`http://127.0.0.1:${PORT}/editor.html`, { waitUntil: 'load' })
    await ed.waitForFunction(() => window.__editor?.ready === true, { timeout: 20000 })

    const edState = () => ed.evaluate(() => window.__editor.state())
    const edTool = (t) => ed.evaluate((x) => window.__editor.setTool(x), t)
    const edBrush = (n) => ed.evaluate((x) => window.__editor.setBrush(x), n)
    const edApply = (cx, cz) => ed.evaluate(([a, b]) => window.__editor.applyAt(a, b), [cx, cz])

    let es = await edState()
    check('에디터 부팅 + 기본 레벨 생성', es.floorCells > 100, `바닥 ${es.floorCells}칸 (${es.w}x${es.h})`)
    check('기본 레벨에 시작 지점 존재', es.byKind.spawn === 1)

    // 지형 특징은 **벽처럼 길게** 만듭니다. 한 칸만 올리면 플레이어가 적에게
    // 밀려 살짝만 옆으로 벗어나도 그 칸을 비껴가서, 검사 자체가 무의미해집니다.
    await edTool('raise')
    await edBrush(1)
    const ROWS = []
    for (let cz = 20; cz <= 36; cz++) ROWS.push(cz)
    for (const cz of ROWS) await edApply(31, cz) // 오를 수 있는 1단 능선
    for (let i = 0; i < 3; i++) for (const cz of ROWS) await edApply(34, cz) // 오를 수 없는 3단 절벽
    es = await edState()
    check('지형 올리기 도구 동작', es.maxHeight === 3, `최고 높이 ${es.maxHeight}`)

    // 보물도 한 줄로 여러 개 — 지나가는 경로가 조금 달라져도 반드시 하나는 만납니다.
    // 칸 간격(2m)이 획득 반경(1.5m)보다 좁으므로, 연속으로 깔면
    // 이 띠를 가로지르는 어떤 경로든 반드시 하나는 지나가게 됩니다.
    await edTool('treasure')
    for (const cz of ROWS) await edApply(30, cz)
    await edTool('grunt')
    await edApply(24, 28)
    es = await edState()
    check(
      '보물/적 배치 도구 동작',
      es.byKind.treasure === ROWS.length && es.byKind.grunt === 1,
      JSON.stringify(es.byKind),
    )

    const beforeUndo = es.entities
    await ed.evaluate(() => window.__editor.undo())
    es = await edState()
    check('되돌리기 동작', es.entities === beforeUndo - 1, `엔티티 ${beforeUndo} -> ${es.entities}`)

    await edApply(24, 28) // 되돌린 적을 다시 배치
    await ed.evaluate(() => window.__editor.save())
    es = await edState()
    check('레벨 저장', es.byKind.grunt === 1 && es.byKind.treasure === ROWS.length)

    const edShot = path.join(SHOTS, '04-editor.png')
    await ed.screenshot({ path: edShot })
    check('에디터 스크린샷 생성', statSync(edShot).size > 15000, `${(statSync(edShot).size / 1024).toFixed(0)} KB`)

    // ---------- 9. 게임이 그 레벨을 실제로 플레이하는가 ----------
    const lv = await context.newPage()
    lv.on('pageerror', (e) => consoleErrors.push(`level: ${e}`))
    await lv.goto(`http://127.0.0.1:${PORT}/?level=storage&lowfx=1`, { waitUntil: 'load' })
    await lv.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
    await sleep(1200)

    const lvState = () => lv.evaluate(() => window.__game.state())
    const lvPress = (c) => lv.evaluate((x) => window.__game.press(x), c)
    const lvRelease = (c) => lv.evaluate((x) => window.__game.release(x), c)

    let ls = await lvState()
    check('게임이 에디터 레벨을 불러옴', ls.levelMode === true, `레벨명 "${ls.levelName}"`)
    check('레벨의 보물 개수 반영', ls.treasureTotal === ROWS.length, `${ls.treasureTotal}개`)
    check('레벨의 적 배치 반영', ls.enemiesLeft === 1, `${ls.enemiesLeft}마리`)
    check('플레이어가 지형 위에 서 있음', ls.player.terrainLevel === 0, `높이 단계 ${ls.player.terrainLevel}`)

    await lv.evaluate(() => window.__game.requestSample())
    let lvPix = null
    for (let t = 0; t < 130 && !lvPix; t++) {
      lvPix = await lv.evaluate(() => window.__game.getSample())
      if (!lvPix) await sleep(60)
    }
    check(
      '레벨 지형이 화면에 렌더링됨',
      lvPix != null && lvPix.bgRatio < 0.5 && lvPix.meanLuma >= 10,
      lvPix
        ? `배경색 픽셀 ${(lvPix.bgRatio * 100).toFixed(0)}% · 평균밝기 ${lvPix.meanLuma} · 색상 ${lvPix.uniqueColors}종`
        : '샘플 실패',
    )

    // 카메라 전방(-0.707,0,-0.707)과 우측(0.707,0,-0.707)을 더하면 -Z,
    // 우측에서 전방을 빼면 +X 입니다. 즉 D + S 동시 입력이 월드 +X 직진입니다.
    const startX = ls.player.x
    await lvPress('KeyD')
    await lvPress('KeyS')

    let climbed = null
    for (const t0 = Date.now(); Date.now() - t0 < 30000; ) {
      const st = await lvState()
      if (st.player.terrainLevel === 1) {
        climbed = st
        break
      }
      await sleep(80)
    }
    check('한 칸 단차를 걸어서 오름', climbed !== null, climbed ? `y=${climbed.player.y}` : '30초 내 미발생')
    check('오르면 실제로 Y좌표가 올라감', !!climbed && climbed.player.y > 0.5, `y=${climbed?.player.y ?? '-'}`)

    await sleep(7000)
    const blocked1 = await lvState()
    await sleep(3000)
    const blocked2 = await lvState()
    await lvRelease('KeyD')
    await lvRelease('KeyS')
    check(
      '오를 수 없는 절벽에서 막힘',
      Math.abs(blocked2.player.x - blocked1.player.x) < 0.35 && blocked2.player.x > startX + 2,
      `x ${blocked1.player.x} -> ${blocked2.player.x} (시작 ${startX})`,
    )
    check('지나가며 보물 획득', blocked2.treasuresFound >= 1, `${blocked2.treasuresFound}/${blocked2.treasureTotal}`)

    const lvShot = path.join(SHOTS, '05-level-play.png')
    await lv.screenshot({ path: lvShot })
    check('레벨 플레이 스크린샷 생성', statSync(lvShot).size > 15000, `${(statSync(lvShot).size / 1024).toFixed(0)} KB`)

    // ---------- 9.5 배포되는 존이 기본으로 열리는가 ----------
    // 링크만 열었을 때 무엇이 나오는지가 사실상 이 게임의 첫인상입니다.
    const zone = await context.newPage()
    zone.on('pageerror', (e) => consoleErrors.push(`zone: ${e}`))
    await zone.goto(`http://127.0.0.1:${PORT}/?lowfx=1`, { waitUntil: 'load' })
    await zone.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
    await sleep(1500)

    const zs = await zone.evaluate(() => window.__game.state())
    check('아무 옵션 없이 열면 번들 존이 실행됨', zs.source === 'bundled' && zs.levelMode, `source=${zs.source}`)
    check('존 이름이 표시됨', zs.levelName === '무너진 성문', `"${zs.levelName}"`)
    check(
      '존의 보물이 레벨 데이터와 같은 수로 배치됨',
      zs.treasureTotal === LEVEL_TREASURES,
      `게임 ${zs.treasureTotal}개 · 레벨 데이터 ${LEVEL_TREASURES}개`,
    )
    /**
     * **개수를 베끼지 않습니다.** 예전엔 `=== 12` 로 박아 뒀는데, 적 종류를
     * 두 가지 추가하자마자 이 검사만 빨갛게 됐습니다 — 게임은 멀쩡한데
     * 테스트가 낡은 것이었죠. 이런 실패가 쌓이면 결국 아무도 안 봅니다.
     * 레벨 파일에 적힌 대로 나왔는지를 **데이터끼리** 비교합니다.
     */
    const roster = await zone.evaluate(() => window.__game.levelRoster())
    const rosterTotal = Object.values(roster).reduce((a, b) => a + b, 0)
    check(
      '레벨 파일에 배치된 적이 전부 등장함',
      zs.enemiesLeft === rosterTotal && rosterTotal > 0,
      `${zs.enemiesLeft}마리 — ${Object.entries(roster).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
    )
    check('시작 지점이 바닥 위(높이 2)', zs.player.terrainLevel === 2, `높이 단계 ${zs.player.terrainLevel}`)
    check('시작 지점 근처에는 적이 없음', (zs.nearestEnemy?.dist ?? 99) > 8, `가장 가까운 적 ${zs.nearestEnemy?.dist}m`)
    /**
     * ⚠️ **슬롯 번호를 여기 적지 않습니다.** 예전엔 *"룬은 3·4번"* 이라고
     *    박아 뒀는데, 무기 기예가 들어와 무기 스킬이 4개가 되자 룬이 4·5번으로
     *    밀렸고 이 줄만 옛 규약을 봤습니다. 규약은 loadout.ts 한 곳에 있고,
     *    `slotInfo()` 가 그것을 그대로 내보냅니다.
     */
    const slotRule = await zone.evaluate(() => window.__game.slotInfo())
    const runeSlots = zs.loadout.slots.slice(slotRule.firstRuneSlot)
    check(
      '존 시작 시 룬 슬롯 2개는 비어 있음(탐험으로 획득)',
      runeSlots.length === 2 && runeSlots.every((v) => v === null),
      `룬 슬롯 ${slotRule.firstRuneSlot}번부터 · ${JSON.stringify(zs.loadout.slots)}`,
    )

    await zone.evaluate(() => window.__game.requestSample())
    let zpix = null
    for (let t = 0; t < 130 && !zpix; t++) {
      zpix = await zone.evaluate(() => window.__game.getSample())
      if (!zpix) await sleep(60)
    }
    check(
      '존이 화면에 렌더링됨',
      zpix != null && zpix.bgRatio < 0.5 && zpix.meanLuma >= 10,
      zpix ? `배경색 픽셀 ${(zpix.bgRatio * 100).toFixed(0)}% · 평균밝기 ${zpix.meanLuma}` : '샘플 실패',
    )

    const zoneShot = path.join(SHOTS, '13-zone.png')
    await zone.screenshot({ path: zoneShot })
    check('존 스크린샷 생성', statSync(zoneShot).size > 15000, `${(statSync(zoneShot).size / 1024).toFixed(0)} KB`)

    // ---------- 9.55 4색 예고 (기둥 2) ----------
    // "색이 다르다"만으로는 부족합니다. **판정 자체가 달라야** 색이 정보가 됩니다.
    // 그래서 색이 아니라 **패턴별 실제 제원과 효과**를 검사합니다.
    await page.evaluate(() => window.__game.reset())
    await sleep(400)
    await page.evaluate(() => window.__game.clearEnemies())
    await page.evaluate(() => window.__game.freezeEnemies(true))
    await sleep(250)
    const bossE = await page.evaluate(() => window.__game.spawnBoss(0, 4))
    const intentIds = []
    for (let i = 0; i < 4; i++) {
      intentIds.push(await page.evaluate(([b, n]) => window.__game.forceAttack(b, n), [bossE, i]))
    }
    check(
      '보스가 4색 패턴을 모두 가짐',
      new Set(intentIds).size === 4,
      intentIds.join(', '),
    )

    // 🔵 속박이 실제로 이동을 늦추는가. 상태값이 아니라 **이동한 거리**로 잽니다.
    await page.evaluate(() => window.__game.reset())
    await sleep(400)
    await page.evaluate(() => window.__game.clearEnemies())
    await sleep(250)
    /**
     * **시뮬레이션 시간**으로 잽니다(벽시계가 아니라).
     *
     * 벽시계 1.6초로 재던 것이 부하가 걸린 날 거짓으로 깨졌습니다:
     * 시뮬레이션이 거의 안 흘러서 자유 이동도 0.4m밖에 못 갔고,
     * 그러면 "속박이 느리게 만드는가"를 0.4 vs 0.3 으로 판정하게 됩니다 — 노이즈입니다.
     * 두 조건을 비교하려면 **같은 게임 시간**을 줘야 합니다.
     */
    const runFor = async (simSeconds) => {
      const first = await state()
      const a = first.player
      const t0 = first.elapsed
      const wallCap = Date.now() + 40000 // 안전장치
      await press('KeyD')
      await press('KeyS')
      let b = a
      for (;;) {
        const cur = await state()
        b = cur.player
        if (cur.elapsed - t0 >= simSeconds || Date.now() > wallCap) break
        await sleep(70)
      }
      await release('KeyD')
      await release('KeyS')
      await sleep(300)
      return Math.hypot(b.x - a.x, b.z - a.z)
    }
    const freeDist = await runFor(1.6)
    await page.evaluate(() => window.__game.reset())
    await sleep(400)
    await page.evaluate(() => window.__game.clearEnemies())
    await page.evaluate(() => window.__game.applySnare(6))
    await sleep(250)
    const snaredDist = await runFor(1.6)
    check(
      '속박(파랑)에 걸리면 실제로 느려짐',
      snaredDist < freeDist * 0.6,
      `자유 ${freeDist.toFixed(1)}m vs 속박 ${snaredDist.toFixed(1)}m`,
    )

    // ---------- 다대일(공격 토큰)은 여기서 검사하지 않습니다 ----------
    //
    // 넣었다가 뺐습니다. 이유를 남겨 둡니다 — 같은 실수를 다시 하지 않기 위해서입니다.
    //
    // 이 검사는 "잡몹 5마리에 포위된 채 **실제로 몇 초를 살아보는**" 성격이라
    // 시뮬레이션 시간이 필요합니다. 그런데 이 시점의 검증 스크립트는 페이지를
    // 넷 열어 두고 있어서 시뮬레이션이 실시간의 1/10~1/20 속도로 흐르고,
    // 게다가 `page.evaluate` 에는 기본 타임아웃이 없어서 페이지가 바빠지면
    // 폴링 자체가 **영원히 멈춥니다.** 실제로 두 번 연속 그렇게 멈췄습니다.
    //
    // 성격이 다른 두 가지를 구분합니다:
    //   · **구조 불변식**  — 빠르고 결정적. 검증 스위트가 지킵니다.
    //   · **밸런스 수치**  — 느리고 부하에 흔들림. `npm run crowd` 전용 도구가 잽니다.
    //
    // 공격 토큰은 후자에 가깝습니다(동시 예고 개수 · 생존 시간 모두 시간을 재야 함).
    // 그래서 `npm run crowd` 로 옮겼습니다. 그 도구는 페이지를 하나만 열어서
    // 빠르고 안정적이고, 튜닝할 때 사람이 실제로 보는 숫자를 그대로 뽑아 줍니다:
    //
    //     동시 예고 3개 이상 : 23% -> 0%
    //     최대 동시 예고     : 5개 -> 2개
    //     가만히 0 / 걸어서 50  (체력 100 기준)
    //
    // 검증 스위트가 느려지거나 멈추면 아무도 안 돌리게 되어 결국 아무것도 못 막습니다.

    // ---------- 9.57 무기 스킬 3개 + 트라이포드 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(500)
    const arm = await state()
    check(
      '무기 스킬이 3개(Q/E/R)로 늘어남',
      arm.loadout.slots.slice(0, 3).every(Boolean),
      arm.loadout.slots.slice(0, 3).join(', '),
    )
    // 시험장은 룬 2개를 미리 쥐여줍니다(전투 검증용). 레벨 모드에서는 비어 있고,
    // 그건 바로 위 9.5 존 검사가 확인합니다.
    const armSlots = await page.evaluate(() => window.__game.slotInfo())
    check(
      `스킬 슬롯이 ${armSlots.count}개(무기 ${armSlots.firstRuneSlot} + 룬 ${armSlots.count - armSlots.firstRuneSlot})로 확장됨`,
      arm.loadout.slots.length === armSlots.count &&
        arm.loadout.cooldowns.length === armSlots.count,
      `슬롯 ${arm.loadout.slots.length}개 · 쿨다운 ${arm.loadout.cooldowns.length}개`,
    )

    // 트라이포드는 **실효 수치**로 검증합니다. 데이터가 맞는지가 아니라
    // 전투 코드가 읽는 값이 실제로 바뀌었는지를 봐야 의미가 있습니다.
    const baseSkill = await page.evaluate(() => window.__game.effectiveSkill(0))
    const noPoint = await page.evaluate(() =>
      window.__game.unlockTripod('lunge_slash', 0, 0),
    )
    check('각인석이 없으면 해금 불가', noPoint === false)

    await page.evaluate(() => window.__game.grantTripod(3))
    const skipTier = await page.evaluate(() =>
      window.__game.unlockTripod('lunge_slash', 2, 0),
    )
    check('앞 단계를 건너뛰고 3단계를 열 수 없음', skipTier === false)

    const ok1 = await page.evaluate(() => window.__game.unlockTripod('lunge_slash', 0, 0))
    const afterT1 = await page.evaluate(() => window.__game.effectiveSkill(0))
    check('1단계 해금 성공', ok1 === true)
    check(
      '1단계 「깊은 상처」가 피해를 +35% 올림',
      Math.abs(afterT1.damage - baseSkill.damage * 1.35) < 0.05,
      `${baseSkill.damage} -> ${afterT1.damage}`,
    )
    const pts = await page.evaluate(() => window.__game.tripodInfo())
    check('해금이 각인석을 1개 소모함', pts.points === 2, `남은 각인석 ${pts.points}`)

    // 같은 단계 안에서 갈아타는 것은 **무료**여야 합니다(실험을 막지 않기 위해).
    await page.evaluate(() => window.__game.switchTripod('lunge_slash', 0, 1))
    const swapped = await page.evaluate(() => window.__game.effectiveSkill(0))
    const pts2 = await page.evaluate(() => window.__game.tripodInfo())
    check(
      '같은 단계 안 교체는 무료 (「가벼운 검」 쿨다운 -30%)',
      pts2.points === 2 && Math.abs(swapped.cooldown - baseSkill.cooldown * 0.7) < 0.05,
      `쿨다운 ${baseSkill.cooldown} -> ${swapped.cooldown}, 각인석 ${pts2.points}`,
    )

    // 3단계는 **판정 도형 자체**를 바꿉니다 — 트라이포드의 핵심 주장입니다.
    await page.evaluate(() => window.__game.unlockTripod('lunge_slash', 1, 0))
    await page.evaluate(() => window.__game.unlockTripod('lunge_slash', 2, 0))
    const morphed = await page.evaluate(() => window.__game.effectiveSkill(0))
    check(
      '3단계 「관통」이 판정 도형을 부채꼴 -> 원형으로 바꿈',
      baseSkill.shape === 'cone' && morphed.shape === 'circle',
      `${baseSkill.shape} -> ${morphed.shape}`,
    )

    // 트라이포드 창이 실제로 열리고 내용이 그려지는가.
    await page.evaluate(() => window.__game.toggleTripodPanel())
    await sleep(300)
    const panel = await page.evaluate(() => ({
      open: document.getElementById('tripod')?.classList.contains('show') ?? false,
      skills: document.querySelectorAll('#tripodBody .tpSkill').length,
      options: document.querySelectorAll('#tripodBody .tpOpt').length,
    }))
    // 몇 개가 그려져야 하는지도 **게임이 압니다** — 스킬을 하나 넣는 날
    // 이 줄만 옛 숫자를 들고 빨개지면, 고쳐야 할 것은 게임이 아니라 검사입니다.
    const tri = await page.evaluate(() => window.__game.tripodTable())
    check(
      `T 창이 열리고 스킬 ${tri.skills}개 × ${tri.tiers}단계 × ${tri.perTier}선택이 그려짐`,
      panel.open && panel.skills === tri.skills && panel.options === tri.skills * tri.tiers * tri.perTier,
      `스킬 ${panel.skills}개 · 선택지 ${panel.options}개`,
    )
    await page.evaluate(() => window.__game.toggleTripodPanel())

    // ---------- 9.58 세이브 ----------
    // 세이브의 핵심은 저장 기술이 아니라 **경계선**입니다:
    // 얻은 것(각인석·룬·먹은 보물)은 남고, 싸움(적·체력)은 처음부터.
    // 그래서 검사도 양쪽을 다 봅니다 — 남아야 할 것이 남는가, 날아가야 할 것이 날아가는가.
    const zoneState = () => zone.evaluate(() => window.__game.state())

    // 진행을 만듭니다: 각인석을 주고 트라이포드를 하나 열어 둡니다.
    await zone.evaluate(() => {
      window.__game.resetProgress() // 깨끗한 상태에서 시작
    })
    await sleep(900)
    await zone.evaluate(() => {
      window.__game.grantTripod(2)
      window.__game.unlockTripod('lunge_slash', 0, 0)
    })
    await sleep(400)
    const beforeReload = await zone.evaluate(() => ({
      skill: window.__game.effectiveSkill(0),
      tripod: window.__game.tripodInfo(),
      save: window.__game.saveInfo(),
    }))
    check(
      '레벨 모드에는 세이브 칸이 배정됨',
      beforeReload.save.saveId.includes('무너진 성문'),
      `"${beforeReload.save.saveId}"`,
    )

    // 페이지를 통째로 새로고침합니다 — 진짜 "다시 켰을 때"입니다.
    await zone.reload({ waitUntil: 'load' })
    await zone.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
    await sleep(1200)
    const afterReload = await zone.evaluate(() => ({
      skill: window.__game.effectiveSkill(0),
      tripod: window.__game.tripodInfo(),
      state: window.__game.state(),
    }))
    check(
      '새로고침해도 각인석이 남음',
      afterReload.tripod.points === beforeReload.tripod.points,
      `${beforeReload.tripod.points} -> ${afterReload.tripod.points}`,
    )
    check(
      '새로고침해도 트라이포드 선택이 남음 (피해 배율 유지)',
      Math.abs(afterReload.skill.damage - beforeReload.skill.damage) < 0.05,
      `피해 ${beforeReload.skill.damage} -> ${afterReload.skill.damage}`,
    )
    // 반대쪽: 전투 상태는 반드시 되돌아가야 합니다.
    // 여기서도 상수를 베끼지 않고 레벨 데이터와 맞춥니다.
    const reloadRoster = await zone.evaluate(() => window.__game.levelRoster())
    const reloadTotal = Object.values(reloadRoster).reduce((a, b) => a + b, 0)
    check(
      '적은 전부 되살아남 (전투는 처음부터)',
      afterReload.state.enemiesLeft === reloadTotal &&
        reloadTotal > 0 &&
        afterReload.state.player.hp === 100,
      `적 ${afterReload.state.enemiesLeft}마리 · 체력 ${afterReload.state.player.hp}`,
    )

    // 진행 초기화가 실제로 지우는가.
    await zone.evaluate(() => window.__game.resetProgress())
    await sleep(1000)
    const cleared = await zone.evaluate(() => window.__game.tripodInfo())
    check('진행 초기화가 각인석을 0으로 되돌림', cleared.points === 0, `각인석 ${cleared.points}`)

    // ---------- 9.6 길안내 (기둥 4) ----------
    // 플레이 테스트 피드백: **"어디로 가야 하고, 어디에 뭐가 있는지 목표가 없으니
    // 그냥 눈앞에 적들만 잡고 말고 있거든."**
    //
    // 미니맵을 쓰지 않기로 했으므로(DESIGN.md 기둥 4) 세 가지가 대신 답해야 합니다:
    // 구역 이름 · 한 줄 목표 · 목표를 가리키는 방향. 셋 다 확인합니다.
    check(
      '존에 이름 붙은 구역이 레벨 데이터와 같은 수로 있음',
      zs.regionCount === LEVEL_REGIONS && LEVEL_REGIONS >= 5,
      `게임 ${zs.regionCount}곳 · 레벨 데이터 ${LEVEL_REGIONS}곳`,
    )
    check('시작하자마자 현재 구역이 잡힘', zs.region === '버려진 앞마당', `"${zs.region}"`)

    // 화면에 실제로 글자가 떠 있는지까지 봅니다. 상태값만 맞고 HUD에 안 뜨면
    // 플레이어에게는 없는 기능입니다.
    const nav = await zone.evaluate(() => ({
      region: document.getElementById('regionText')?.textContent ?? '',
      objective: document.getElementById('objectiveText')?.textContent ?? '',
    }))
    check('구역 이름이 HUD에 표시됨', nav.region.includes('버려진 앞마당'), `"${nav.region}"`)
    check('한 줄 목표가 HUD에 표시됨', /수문장|보물|적/.test(nav.objective), `"${nav.objective}"`)

    // 걸어 들어가면 구역이 실제로 바뀌어야 합니다. 안 바뀌면 "진행하고 있다"는
    // 감각이 생기지 않습니다 — 피드백의 핵심이 바로 그것이었습니다.
    await zone.evaluate(() => window.__game.press('KeyD'))
    await zone.evaluate(() => window.__game.press('KeyS'))
    let movedRegion = null
    for (const tStart = Date.now(); Date.now() - tStart < 40000; ) {
      const st = await zone.evaluate(() => window.__game.state())
      if (st.region && st.region !== '버려진 앞마당') {
        movedRegion = st
        break
      }
      await sleep(120)
    }
    await zone.evaluate(() => window.__game.release('KeyD'))
    await zone.evaluate(() => window.__game.release('KeyS'))
    check('동쪽으로 걸어가면 다음 구역으로 넘어감', movedRegion !== null, movedRegion ? `"${movedRegion.region}"` : '40초 내 미발생')

    // ---------- 10. 안정성 ----------
    check('런타임 콘솔 에러 없음', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    // 프레임 총량이 아니라 "지금도 증가하는가"를 봅니다.
    // reset()이 프레임 카운터를 0으로 되돌리므로 누적값 비교는 의미가 없습니다.
    const tickA = (await state()).frame
    await sleep(1500)
    const tickB = (await state()).frame
    check('루프가 끝까지 살아있음(멈춤/크래시 없음)', tickB > tickA, `1.5초 동안 +${tickB - tickA} 프레임`)
  } finally {
    await browser.close()
    await server.close()
  }

  console.log('\n' + '─'.repeat(56))
  console.log(`검증 결과: ${results.length - failed} / ${results.length} 통과`)
  console.log(`스크린샷: ${SHOTS}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('검증 스크립트 실패:', e)
  process.exitCode = 1
})
