/**
 * 🔁 같은 시각이면 같은 그림인가 — `npm run repro`
 *
 * ── 왜 이 검사가 생겼는가 ──────────────────────────────────────────
 * 이 저장소의 검사 여럿이 **스크린샷 비교** 위에 서 있습니다 —
 * `npm run depth`(바닥 밝기) · `npm run gear`(등급 불티) · `npm run verify`
 * 의 사진들. 그런데 그 **전제 자체를 재는 검사가 없었습니다.**
 *
 * 전제가 깨져 있기도 했습니다. 연출 난수가 `Math.random()` 이라 타격
 * 한 번에 불꽃이 매번 다른 자리로 흩어졌습니다. 그 상태에서 전투 장면을
 * 픽셀로 비교하는 것은 **원리적으로 불가능**한데, 아무도 그 사실을
 * 말해 주지 않았습니다. (실제로 등급 불티를 만들 때 *"무작위 방출기를
 * 쓰지 않는다"* 를 손으로 지켜야 했고, 깊이 검사에서는 픽셀 비교를
 * 세우느라 네 번을 되돌렸습니다.)
 *
 * ── 무엇을 재는가 ──────────────────────────────────────────────────
 * **페이지를 두 번 새로 띄워** 똑같은 절차를 밟고, 같은 시뮬 시각에서
 * 두 장을 찍어 **픽셀 하나까지** 견줍니다. 두 판 사이에 남는 상태가
 * 없도록 매번 새 탭을 씁니다.
 *
 * ── ⚠️ **네 번 틀렸고, 매번 범인은 게임이 아니었습니다** ────────────
 * 처음엔 타격 연출까지 낸 장면을 견줬고 **4,662픽셀**이 달랐습니다.
 * 씨앗 난수를 넣은 직후였는데도요. 원인은 난수가 아니라 **시계**였습니다:
 *
 *     time.dt     — 시뮬레이션(히트스톱 중 0)
 *     time.realDt — **벽시계**. 카메라 흔들림·VFX·UI 가 씁니다
 *     time.elapsed — realDt 의 누적. 즉 이것도 **벽시계**입니다
 *
 * 연출이 벽시계로 흐르는 것은 **의도된 설계**입니다(core/time.ts) —
 * 히트스톱에 이펙트까지 멈추면 "렉 걸린 느낌"이 납니다.
 *
 * 그래서 뜬 연출을 빼고 **가라앉은 장면**만 견줬습니다. 그래도 **866픽셀**이
 * 달랐습니다. 여기서 값을 만지고 싶어지는데(허용 오차를 866으로 벌리기),
 * 그건 이 저장소가 가장 비싸게 배운 실수입니다 — **계측기가 틀렸을 때 값을
 * 만지면 게임을 망가뜨립니다.**
 *
 * 진짜 원인은 이랬습니다. 프로브는 `elapsed` 가 6초를 넘을 때까지 8ms 마다
 * 들여다보다 사진을 찍는데, **그 사이에도 프레임은 돕니다.** 찍히는 시각은
 * 6.00초가 아니라 `6.00 + 그때그때 다른 나머지`입니다. 그리고 가라앉은 것도
 * 실은 가라앉아 있지 않습니다 — 보물상자는 `time.elapsed` 로 위아래 흔들리고
 * (visuals.ts) 화톳불도 `time.elapsed` 로 맥동합니다. 두 판이 다른 것은
 * **난수가 남아서가 아니라 서로 다른 시각에 서 있어서**였습니다.
 *
 * ── ⏱ 그래서 **벽시계를 걷어내고 걸음 수로 셉니다** ────────────────
 * `__game.step(프레임수, dt, fromZero)` 로 시계를 0으로 되돌리고 **정확히
 * 같은 델타를 같은 횟수** 먹입니다(main.ts `debugStep`). 그러면 두 판이
 * 같은 시각에 서고, **뜬 연출까지 포함해** 픽셀이 맞아떨어집니다.
 * 게임 규칙은 한 줄도 안 건드렸습니다 — 고칠 것은 못 재던 자 쪽이었습니다.
 *
 * ── 🚧 게이트: **다르게 만들면 실제로 달라져야** 합니다 ───────────
 * "두 장이 같다"만 재면 **검정 화면 두 장**도 통과합니다. 그래서 일부러
 * 다른 것 하나(등급을 바꾼 장)를 같이 찍어 **차이가 잡히는지** 먼저
 * 확인합니다. 그게 아니면 아래의 "같다"는 아무 뜻이 없습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { decodePng } from './png.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5255
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

/**
 * 한 판 — **새 탭에서** 정해진 절차를 밟고 한 장 찍습니다.
 *
 * ⚠️ 탭을 새로 여는 것이 요점입니다. 같은 탭에서 두 번 돌리면 씨앗
 *    스트림이 이미 굴러가 있어서, *"두 번째가 첫 번째와 같다"* 가 아니라
 *    *"이어서 굴렸다"* 를 재게 됩니다.
 */
const STEP_DT = 1 / 60 // 한 걸음의 길이. 게임의 상한(1/20초)보다 짧아야 잘리지 않습니다.
const WARM = 90 // 셰이더가 데워질 시간. 첫 프레임은 아직 까맣습니다(gear 검사에서 겪음).
const SETTLE = 270 // 4.5초. 카메라 추적·무기 기본자세가 자리를 잡는 데 필요합니다.

async function shot({ tier = 0, vfx = false, extra = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  await page.evaluate(
    async ([t, vfx, dt, warm, settle, extra]) => {
      const G = window.__game
      // ⏱ 먼저 **벽시계 루프를 세웁니다.** 이걸 안 하면 아래 걸음 사이에
      //    실제 프레임이 끼어들어, 정확한 델타를 준 의미가 사라집니다.
      G.setPaused(true)
      G.clearEnemies()
      G.setGear(0, t, 4242)
      // 화면 위의 것은 끕니다 — 남은 시간 표시나 fps 글자가 매 판 달라서
      // 지형·연출의 재현성을 물으려던 검사가 **글자**를 재게 됩니다.
      for (const el of document.body.children) {
        if (el.tagName !== 'CANVAS') el.style.display = 'none'
      }
      // 시계를 0 으로 되돌리고(fromZero) 정해진 걸음 수만큼 정확히 굴립니다.
      G.step(warm + settle + extra, dt, true)
      if (vfx) {
        // 연출을 **정해진 순서로** 한 번씩 냅니다(게임과 같은 경로).
        for (const kind of ['spark', 'damage', 'swing', 'damage', 'spark']) G.spawnVfx(kind)
        G.step(9, dt)
      }
    },
    [tier, vfx, STEP_DT, WARM, SETTLE, extra],
  )
  const buf = await page.screenshot()
  await page.close()
  return { img: decodePng(buf), errors }
}

const diffOf = (a, b) => {
  if (a.width !== b.width || a.height !== b.height) return { px: Infinity, worst: 255 }
  let px = 0
  let worst = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const d =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2])
    if (d > 0) px++
    if (d > worst) worst = d
  }
  return { px, worst }
}

try {
  console.log('\n🔁 재현성 검증 — **페이지를 두 번 새로 띄워** 같은 그림인지 봅니다\n')

  const a = await shot()
  const b = await shot()
  const c = await shot({ tier: 4 }) // 🚧 대조군 ① — 등급만 다릅니다(불티가 붙습니다)
  const d = await shot({ extra: 12 }) // 🚧 대조군 ② — 걸음 수만 다릅니다(0.2초 뒤)
  // 🔥 뜬 연출까지 낸 장면. 씨앗 난수가 실제로 일하는지는 여기서만 보입니다.
  const v1 = await shot({ vfx: true })
  const v2 = await shot({ vfx: true })

  const same = diffOf(a.img, b.img)
  const other = diffOf(a.img, c.img)
  const later = diffOf(a.img, d.img)
  const vfx = diffOf(v1.img, v2.img)
  const total = (a.img.width * a.img.height) || 1
  const pct = (n) => `${n} / ${total} (${((n / total) * 100).toFixed(3)}%)`
  console.log(
    `  [같은 절차 두 판]   다른 픽셀 ${pct(same.px)} · 가장 큰 차이 ${same.worst}\n` +
      `  [등급만 바꾼 판]    다른 픽셀 ${pct(other.px)} · 가장 큰 차이 ${other.worst}\n` +
      `  [0.2초 뒤에 찍은 판] 다른 픽셀 ${pct(later.px)} · 가장 큰 차이 ${later.worst}\n` +
      `  [연출까지 낸 두 판] 다른 픽셀 ${pct(vfx.px)} · 가장 큰 차이 ${vfx.worst}\n`,
  )

  const allErrors = [a, b, c, d, v1, v2].flatMap((r) => r.errors)
  check(
    allErrors.length === 0,
    '🚧 여섯 판 모두 콘솔 오류 없이 돌았다 (비교의 게이트)',
    allErrors.slice(0, 2).join(' | ') || '없음',
  )
  /**
   * 🚧 **게이트 두 개** — 아래 "같다"가 뜻을 가지려면 먼저 이 비교가
   *    **차이를 잡을 줄 안다**는 것이 증명돼야 합니다. 그것도 두 종류로:
   *
   *      ① 물건이 달라지면  — 등급을 바꿔 불티를 붙입니다
   *      ② **시간이 흐르면** — 같은 판을 0.2초 뒤에 찍습니다
   *
   *    ②가 특히 중요합니다. 이 검사는 이제 *"시간을 정확히 준다"* 를 근거로
   *    같음을 주장하는데, 만약 화면이 시간이 흘러도 안 변하는 정지화면이면
   *    그 주장은 아무것도 안 재고 통과합니다.
   */
  check(
    other.px > total * 0.001,
    '🚧 ① **물건을 바꾸면 실제로 달라진다** (아니면 아래 "같다"는 검정 화면 두 장입니다)',
    `등급을 바꾸니 ${other.px}픽셀 · 가장 큰 차이 ${other.worst}`,
  )
  check(
    later.px > total * 0.001,
    '🚧 ② **시간이 흐르면 실제로 달라진다** (정지화면을 두 번 찍고 통과하지 않게)',
    `0.2초 뒤엔 ${later.px}픽셀 · 가장 큰 차이 ${later.worst}`,
  )
  check(
    same.px === 0,
    '🔁 **같은 절차면 픽셀까지 같다** (스크린샷으로 재는 모든 검사의 전제)',
    same.px === 0 ? '완전히 같음' : `${same.px}픽셀 다름 · 가장 큰 차이 ${same.worst}`,
  )
  /**
   * 🔥 **연출까지 같아야 합니다** — 여기가 씨앗 난수의 값어치입니다.
   *
   * 이 줄은 오래 **"고칠 수 없는 것"** 으로 적혀 있었습니다. 두 가지를
   * 한꺼번에 봤기 때문입니다 — 흩뿌림 난수(`Math.random()`)와 시각의 어긋남.
   * 난수는 씨앗으로 잡았고(core/rng.ts `vfxRng`), 시각은 고정 걸음으로
   * 잡았습니다. 둘 다 잡히자 **0픽셀**이 됐습니다.
   *
   * 그러니 이 줄이 빨개지면 뜻이 분명합니다: 누군가 연출에 `Math.random()`
   * 을 도로 넣었거나(그건 `npm run guard` 가 먼저 잡습니다), 연출이 **걸음
   * 수가 아닌 무엇**에 기대기 시작했다는 뜻입니다.
   */
  check(
    vfx.px === 0,
    '🔥 **연출을 낸 장면도 픽셀까지 같다** (씨앗 난수 + 고정 걸음이 함께 서야만 초록입니다)',
    vfx.px === 0 ? '완전히 같음' : `${vfx.px}픽셀 다름 · 가장 큰 차이 ${vfx.worst}`,
  )
  console.log(
    `\n  📌 [경계] 게임 안에서 연출은 \`time.realDt\`(벽시계)로 흐릅니다(core/time.ts) —\n` +
      `           히트스톱에 이펙트까지 멈추면 "렉 걸린 느낌"이 나기 때문입니다. 위 초록은\n` +
      `           그 설계를 바꿔서 얻은 것이 **아니라**, 프로브가 시간을 걸음으로 주기 때문입니다.\n` +
      `           **벽시계로 돌린 판끼리 픽셀 비교를 세우지 마십시오** — \`__game.step()\` 을 쓰십시오.`,
  )
  /**
   * ── ⚠️ **이 프로브는 기계가 바쁘면 흔들립니다 (실측)** ─────────────
   *
   * 위 경계의 결과를 직접 겪어서 적어 둡니다. **같은 코드 · 같은 레벨**로
   * 두 번 돌렸는데:
   *
   *   기계가 바빴을 때  게이트 ① **3372**픽셀 · 🔁 **2870픽셀 다름** ❌
   *   조용했을 때       게이트 ① **502**픽셀 · 🔁 **완전히 같음**  ✅
   *
   * 코드는 한 글자도 안 달랐습니다. 달랐던 것은 **그 순간 이 컨테이너에서
   * 다른 프로세스가 몇 개 돌고 있었는가** 뿐입니다(폴링용 셸 여덟 개).
   *
   * 왜 그런가: 연출이 `realDt`(벽시계)로 흐르니, CPU 가 밀리면 **두 번
   * 띄운 페이지의 벽시계가 서로 어긋납니다.** 그러면 시뮬레이션은 똑같아도
   * 불꽃·빛기둥이 서로 다른 프레임에 잡히고, 그 차이가 픽셀로 나옵니다.
   * 게이트 ① 까지 6.7배로 부푼 것이 그 증거입니다 — 원인이 특정 검사가
   * 아니라 **찍히는 모든 그림**에 있었다는 뜻입니다.
   *
   * ── 그래서 여기서 빨간불을 보면 ────────────────────────────────
   * ① 먼저 **다른 프로세스를 다 끄고 한 번 더 돌리십시오.** 이 순서를
   *    안 지켜서, 있지도 않은 회귀를 찾느라 25분짜리 판을 세 번 돌렸습니다
   *    (게다가 그 사이 「내 변경이 결정성을 깼다」고 결론낼 뻔했습니다).
   * ② 두 번째도 빨가면 그때 코드를 의심하십시오.
   *
   * 자동으로 재시도하게 만들지는 **않습니다.** 재시도를 넣으면 진짜
   * 비결정성도 같이 삼켜집니다 — 이 검사는 스크린샷으로 재는 모든 검사의
   * 전제라, 조용히 넘어가는 것보다 시끄럽게 두 번 도는 편이 낫습니다.
   */
  if (fail > 0) {
    console.log(
      `\n  📌 [경계] **빨간불을 코드 탓으로 돌리기 전에, 기계를 조용히 하고 한 번 더 돌리십시오.**\n` +
        `           연출이 벽시계로 흐르는 탓에 CPU 가 밀리면 두 판의 벽시계가 어긋나고,\n` +
        `           같은 코드로도 「2870픽셀 다름 ❌ → 완전히 같음 ✅」 이 나옵니다(실측).`,
    )
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 — 아래 숫자는 완결된 것이 아닙니다.
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
