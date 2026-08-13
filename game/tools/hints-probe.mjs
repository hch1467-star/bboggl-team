/**
 * 배우면 사라지는 조작표 — `npm run hints`
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * 이 게임은 화면 아래에 **열한 줄짜리 조작표**를 늘 띄우고 있었습니다.
 * DESIGN.md 는 그것을 두고 *"조작표이지 규칙이 아니다"* 라고 적어 뒀지만,
 * **적어 두기만 하고 치우지는 않았습니다.**
 *
 * 쿼터뷰에서 화면은 곧 정보입니다. 아래쪽 3분의 1이 안 바뀌는 표라면,
 * 그만큼 세상을 못 보고 있는 것입니다.
 *
 * 그래서 셀레스트·하데스가 쓰는 방식으로 바꿨습니다 — 안내는 그 동작을
 * **해낼 때까지만** 있습니다. 안내의 일은 "어떻게 하는가"에 답하는 것이고,
 * 한 번 해내면 그 질문은 끝납니다.
 *
 * ── 이 프로브가 네 가지를 다 봐야 하는 이유 ──────────────────────
 * "사라졌다"만 검사하면 **처음부터 안 뜨는 고장**과 구별이 안 됩니다.
 * 그리고 사라지기만 하고 다시 볼 곳이 없으면, 그건 사라지는 안내가 아니라
 * 그냥 **사라진 안내**입니다.
 *
 *   1. 처음엔 보인다                     (안내가 살아 있다)
 *   2. 해낸 것만 사라진다                 (다른 줄은 남는다)
 *   3. **못 해낸 것은 안 사라진다**       (키만 눌러선 안 없어진다)
 *   4. F1 로 전부 되돌아온다              (찾아볼 곳이 있다)
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5222
const VIEWPORT = { width: 1100, height: 690 }
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

/** 지금 화면에 실제로 보이는 조작 안내 줄들. */
const shown = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#controls .key')]
      .filter((n) => n.offsetParent !== null)
      .map((n) => n.getAttribute('data-learn') ?? 'always'),
  )

try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.resetProgress?.())

  console.log('\n⌨️  배우면 사라지는 조작표 — 안내가 제 일을 하고 물러나는가\n')

  const first = await shown(page)
  check(first.length >= 6, '처음엔 조작 안내가 떠 있다', `${first.length}줄: ${first.join(' ')}`)

  /**
   * 화면에서 안내가 먹고 있던 넓이 — 검사가 아니라 **관측**입니다.
   * "몇 줄 줄었다"보다 "화면을 얼마나 돌려받았다"가 이 변경의 값입니다.
   */
  const box0 = await page.evaluate(() => {
    const n = document.getElementById('controls')
    const r = n.getBoundingClientRect()
    return { h: Math.round(r.height), w: Math.round(r.width) }
  })

  // ---- 2·3. 구르기만 해내고, 나머지는 **키만 누릅니다** ----
  //
  // ⚠️ 기력을 0으로 만들어 놓고 X(성수병)·Shift 를 눌러 봅니다. 키는
  //    눌렸지만 동작은 안 일어나야 하고, 그러면 그 줄은 **남아 있어야**
  //    합니다. 이걸 안 보면 "키 누르면 지운다"는 고장이 통과합니다.
  const afterDodge = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    G.reset()
    await sleep()
    G.clearEnemies()
    await sleep()
    G.press('Space')
    G.release('Space')
    for (let i = 0; i < 40; i++) await sleep()
    // 기력을 비워 두고 성수병 키를 눌러 봅니다 — 마시는 동작은 안 나갑니다.
    G.setVials?.(0)
    G.press('KeyX')
    G.release('KeyX')
    for (let i = 0; i < 30; i++) await sleep()
    return true
  })
  void afterDodge
  const second = await shown(page)
  check(
    !second.includes('dodge'),
    '**해낸** 동작(구르기)의 줄은 사라진다',
    `남은 줄: ${second.join(' ')}`,
  )
  check(
    second.includes('vial'),
    '**못 해낸** 동작(성수병 0병)의 줄은 안 사라진다 (키만 눌러선 안 됩니다)',
    second.includes('vial') ? '남아 있음' : '사라졌습니다 — 키 입력만으로 지워지고 있습니다',
  )

  // ---- 4. F1 로 전부 돌아온다 ----
  await page.evaluate(async () => {
    const G = window.__game
    G.press('F1')
    G.release('F1')
    await new Promise((r) => setTimeout(r, 60))
  })
  const opened = await shown(page)
  check(
    opened.length > first.length && opened.includes('dodge'),
    'F1 을 누르면 배운 것·숨긴 것까지 **전부** 돌아온다',
    `${opened.length}줄 (처음 ${first.length}줄 · 배운 뒤 ${second.length}줄)`,
  )
  /**
   * 펼친 높이 = **예전에 늘 떠 있던 그 높이**입니다. 되찾은 넓이를 재려면
   * 이 값과 비교해야 합니다 — 한 줄만 지우고 "줄었다"고 하면 거짓말입니다
   * (실제로 첫 판에서 74px → 74px 로 하나도 안 줄었습니다. 줄바꿈 때문에
   *  한 줄 사라져도 높이는 그대로였습니다).
   */
  const boxAll = await page.evaluate(
    () => Math.round(document.getElementById('controls').getBoundingClientRect().height),
  )
  await page.evaluate(async () => {
    const G = window.__game
    G.press('F1')
    G.release('F1')
    await new Promise((r) => setTimeout(r, 60))
  })

  // ---- 5. 여덟 가지를 **다 해내면** 조작표가 사라진다 ----
  await page.evaluate(async () => {
    const G = window.__game
    const sleep = (n = 8) => new Promise((r) => setTimeout(r, n))
    const hold = async (key, frames) => {
      G.press(key)
      for (let i = 0; i < frames; i++) await sleep()
      G.release(key)
      await sleep()
    }
    G.reset()
    await sleep(80)
    G.clearEnemies()
    await sleep(80)
    await hold('KeyW', 12) // 걷기
    G.press('ShiftLeft')
    await hold('KeyW', 40) // 달리기 (붙는 데 0.3초)
    G.release('ShiftLeft')
    const p = G.state().player
    for (const [x, z] of [[p.x + 9, p.z], [p.x - 9, p.z], [p.x, p.z + 9], [p.x, p.z - 9]]) {
      G.aimAtWorld(x, z) // 조준 — 누적 회전으로 셉니다
      await sleep(40)
    }
    /**
     * ⚠️ 사람처럼 **끝나기를 기다렸다가** 다음 걸 누릅니다. 처음엔 고정
     *    시간으로 밀어붙였는데 강타와 무기 교체가 안 나갔습니다 — 둘 다
     *    "지금 아무것도 안 하는 중"을 요구하는데, 앞 동작의 후딜이 아직
     *    안 끝났던 것입니다. 게임이 아니라 **누르는 쪽이 급했습니다.**
     */
    const IDLE = G.terrainInfo().actorStates.idle
    const untilIdle = async () => {
      for (let i = 0; i < 400; i++) {
        if (G.state().player.state === IDLE) return
        await sleep()
      }
    }
    /**
     * ⚠️ 누르고 **시작한 것을 본 뒤** 끝나기를 기다립니다.
     *
     * 처음엔 "누르고 → 한가해질 때까지"만 했는데 강타가 안 나갔습니다.
     * 이 컨테이너는 한 프레임이 50~100ms 인데 누르고 24ms 만에 물어보니,
     * **아직 시작도 안 한 동작을 보고 "다 끝났다"** 고 판단하고 다음 키를
     * 눌러 버린 것입니다. 그 다음 키가 앞의 것을 덮었습니다.
     * 게임이 느린 게 아니라 **누르는 쪽이 급했습니다.**
     */
    const act = async (key) => {
      await untilIdle()
      G.press(key)
      await sleep()
      G.release(key)
      for (let i = 0; i < 200; i++) {
        if (G.state().player.state !== IDLE) break
        await sleep()
      }
      await untilIdle()
    }
    await act('Mouse0') // 공격
    G.setFocus(3)
    G.setStamina(100)
    await act('Mouse2') // 강타 (집중·기력 필요)
    await act('Space') // 구르기
    await act('Digit2') // 무기 교체 — 상태를 안 바꾸므로 위 대기가 그냥 지나갑니다
    G.setVials(3)
    await act('KeyX') // 성수병
    await sleep(600)
  })
  const third = await shown(page)
  check(
    third.length === 0,
    '여덟 가지를 다 해내면 조작표가 **통째로** 사라진다',
    third.length ? `아직 남음: ${third.join(' ')}` : '전부 사라짐',
  )
  const boxDone = await page.evaluate(
    () => Math.round(document.getElementById('controls').getBoundingClientRect().height),
  )
  console.log(
    `\n     ↳ [관측] 조작표 높이 ${boxAll}px(전부 펼침 = 예전 상태) → ${boxDone}px(다 배운 뒤)` +
      ` · 화면 세로 ${VIEWPORT.height}px 의 ${((boxAll / VIEWPORT.height) * 100).toFixed(0)}%` +
      ` → ${((boxDone / VIEWPORT.height) * 100).toFixed(0)}%`,
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
