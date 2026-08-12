/**
 * 실루엣 가독성 — `npm run shape`
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * `visuals.ts` 에는 오래 이렇게 적혀 있었습니다:
 *
 *   > 적은 전부 붉은 계열, 종류는 명도·채도와 **실루엣**으로 가릅니다.
 *
 * 그런데 실제로 만들던 것은 **크기만 다른 같은 캡슐 여섯 개**였습니다.
 * 그리고 그걸 지키는 검사는 `enemy` 프로브의 *"키 차이 0.3m 이상"* 하나
 * 뿐이었습니다. 그 검사는 **설정값을 봅니다** — 같은 모양을 3cm 늘린 것도
 * 통과시킵니다. 쿼터뷰에서 적은 화면의 몇십 픽셀이라, 그건 모양이 아니라
 * **크기**입니다.
 *
 * ── 그래서 화면에 그려진 **윤곽**을 잽니다 ──────────────────────
 * 종류마다 혼자 세워 놓고 찍고, **빈 화면과 빼서** 그 적이 차지한 픽셀만
 * 남깁니다(`contrast` 프로브가 예고를 떼어낼 때 쓰는 그 방법).
 *
 * 그 다음이 이 프로브의 핵심입니다: **테두리 상자로 정규화**합니다.
 * 크기를 지워 버리고 **모양만** 남겨서 겹쳐 보는 것입니다. 정규화를 안 하면
 * "큰 캡슐과 작은 캡슐"이 다른 모양으로 보이고, 그러면 지금 이 상태가
 * 그대로 통과합니다 — 검사가 고쳐야 할 바로 그것을 통과시키는 셈입니다.
 *
 * ⚠️ 기준 IoU 0.75. 두 윤곽을 포개 놓았을 때 **네 곳 중 한 곳은 어긋나야**
 *    합니다. 한 덩어리의 4분의 1쯤이면 팔·뿔·활 하나에 해당하고, 그 정도면
 *    "뭐가 달린 놈"으로 읽힙니다. 그보다 작으면 "조금 다른 캡슐"입니다.
 *    비교할 눈금으로 **보물(팔면체) vs 잡몹(캡슐)** 을 같이 찍습니다 —
 *    누가 봐도 다른 한 쌍이 이 자에서 몇으로 나오는지 보여 두려고요.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { decodePng } from './png.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5223
const VIEWPORT = { width: 1100, height: 690 }
const GRID = 48
const MAX_IOU = 0.75
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/**
 * 두 장을 빼서 "달라진 픽셀"만 남기고, 테두리 상자로 정규화한 격자를 냅니다.
 *
 * ⚠️ **적이 서 있는 자리 둘레만** 봅니다. 처음엔 화면 전체를 뺐는데,
 *    HUD 의 「남은 적」 숫자가 같이 바뀌면서 테두리 상자가 화면 절반으로
 *    부풀었습니다. 그 상자로 정규화하니 **서로 다른 두 적이 IoU 1.00** 으로
 *    나왔습니다 — 적이 아니라 글자를 견주고 있었습니다.
 */
function silhouette(base, shot, at, pad) {
  const w = shot.width
  const h = shot.height
  const pts = []
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const yLo = Math.max(0, at.sy - pad * 2)
  const yHi = Math.min(h - 1, at.sy + pad)
  const xLo = Math.max(0, at.sx - pad)
  const xHi = Math.min(w - 1, at.sx + pad)
  for (let y = yLo; y <= yHi; y++) {
    for (let x = xLo; x <= xHi; x++) {
      const o = (y * w + x) * 4
      const d =
        Math.abs(shot.data[o] - base.data[o]) +
        Math.abs(shot.data[o + 1] - base.data[o + 1]) +
        Math.abs(shot.data[o + 2] - base.data[o + 2])
      // 그림자·안티에일리어싱을 걸러낼 만큼만 문턱을 둡니다.
      if (d < 40) continue
      pts.push([x, y])
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (pts.length < 50) return null
  return { grid: gridOf(pts), pts, pixels: pts.length, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

/** 점 뭉치를 **테두리 상자로 정규화한** 격자로. 여기가 "크기를 지우는" 자리입니다. */
function gridOf(pts) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  const bw = Math.max(1e-6, x1 - x0)
  const bh = Math.max(1e-6, y1 - y0)
  const grid = new Uint8Array(GRID * GRID)
  for (const [x, y] of pts) {
    const gx = Math.min(GRID - 1, Math.floor(((x - x0) / bw) * GRID))
    const gy = Math.min(GRID - 1, Math.floor(((y - y0) / bh) * GRID))
    grid[gy * GRID + gx] = 1
  }
  return grid
}

function iou(a, b) {
  let inter = 0
  let uni = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) uni++
    if (a[i] && b[i]) inter++
  }
  return uni ? inter / uni : 1
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
  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n👤 실루엣 가독성 — 윤곽만 보고 종류가 갈리는가\n')
  console.log(`  [기준] 크기를 지운 뒤 겹침 IoU ${MAX_IOU} 이하 (네 곳 중 한 곳은 어긋나야)\n`)

  const roster = await page.evaluate(() => window.__game.enemyRoster())

  await page.evaluate(() => {
    window.__game.clearEnemies()
    window.__game.freezeEnemies(true)
  })
  await page.waitForTimeout(600)
  await page.evaluate(() => window.__game.setPaused(true))
  const base = decodePng(await page.screenshot())
  await page.evaluate(() => window.__game.setPaused(false))

  const shapes = []
  for (const r of roster) {
    const at = await page.evaluate(async ([id]) => {
      const G = window.__game
      G.clearEnemies()
      await new Promise((res) => setTimeout(res, 120))
      const p = G.state().player
      /**
       * ⚠️ **(+x, +z) 로 놓으면 안 됩니다.** 처음엔 (+6, +6) 에 세웠는데
       *    잡몹과 끄는 자가 6×24px 밖에 안 잡혔습니다. 쿼터뷰의 화면 가로는
       *    대략 (x − z) 라서 **+x 와 +z 가 서로 상쇄되고**, 그 자리는 화면에서
       *    플레이어 바로 위입니다. 즉 적이 플레이어 뒤에 가려져 있었고,
       *    삐져나온 조각만 재고 있었습니다. 큰 보스만 많이 삐져나와서
       *    "작은 적은 모양이 없다"처럼 보였습니다.
       */
      const e = G.spawnEnemyKind(id, p.x + 8, p.z - 8)
      if (e < 0) return null
      await new Promise((res) => setTimeout(res, 250))
      const info = G.enemyInfo(e)
      if (!info) return null
      // 발치를 기준점으로 삼습니다 — 표식은 대개 **머리 위**에 붙습니다.
      return G.screenPos(info.x, 0, info.z)
    }, [r.id])
    await page.evaluate(
      () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))),
    )
    await page.evaluate(() => window.__game.setPaused(true))
    const shot = decodePng(await page.screenshot())
    await page.evaluate(() => window.__game.setPaused(false))
    const sil = at ? silhouette(base, shot, at, 110) : null
    if (sil) shapes.push({ name: r.name, ...sil })
  }
  await page.evaluate(() => window.__game.clearEnemies())

  check(
    shapes.length === roster.length,
    '적 종류 전부의 윤곽을 화면에서 떠냈다 (못 본 종류가 조용히 빠지지 않게)',
    `${shapes.length}/${roster.length}종 · ${shapes.map((s) => `${s.name} ${s.pixels}px`).join(' · ')}`,
  )

  /**
   * ---- 이 자가 정말 **크기를 지우는가** ----
   *
   * 이 프로브의 주장은 하나입니다: *"크기를 지우고 모양만 본다."* 그 주장이
   * 틀리면 아래 숫자는 전부 뜻이 없습니다. 그러니 주장부터 검사합니다.
   *
   * 실제로 찍은 윤곽 하나를 **60%로 줄여** 다시 정규화하고 겹쳐 봅니다.
   * 같은 모양이므로 거의 1이 나와야 합니다. 안 나오면 정규화가 고장 난
   * 것이고, "달려드는 자와 쏘는 자가 다르다"는 말도 못 믿습니다.
   *
   * ⚠️ 원래 여기서는 보물(팔면체)을 눈금으로 쓰려 했는데, `spawnTreasure`
   *    라는 훅이 **아예 없어서 조용히 건너뛰고 있었습니다.** 있지도 않은
   *    것을 부르고 `if (ok)` 로 감싸 둔 탓에 아무 말 없이 지나갔습니다 —
   *    이 저장소에서 가장 비싼 고장이 늘 그것이었는데 또 했습니다.
   *    그래서 없는 훅에 기대지 않는 검사로 바꿨습니다.
   */
  // ---- 종류끼리 윤곽이 겹치지 않는가 ----
  const pairs = []
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      pairs.push({ a: shapes[i].name, b: shapes[j].name, v: iou(shapes[i].grid, shapes[j].grid) })
    }
  }
  pairs.sort((x, y) => y.v - x.v)
  const worst = pairs[0]
  check(
    pairs.length > 0 && worst.v <= MAX_IOU,
    '**크기를 지워도** 종류끼리 윤곽이 다르다 (가장 닮은 한 쌍 기준)',
    worst
      ? `${worst.a} ↔ ${worst.b} IoU ${worst.v.toFixed(2)} · 다음 ${pairs
          .slice(1, 3)
          .map((p) => `${p.a}↔${p.b} ${p.v.toFixed(2)}`)
          .join(' · ')}`
      : '비교할 쌍이 없습니다',
  )
  /**
   * ---- 이 자가 정말 **크기를 지우는가** ----
   *
   * 이 프로브의 주장은 하나입니다: *"크기를 지우고 모양만 본다."* 그 주장이
   * 틀리면 위 숫자는 전부 뜻이 없습니다. 그러니 주장부터 검사합니다.
   *
   * 실제로 찍은 윤곽의 **점들을** 0.6배로 옮겨 같은 정규화를 태웁니다.
   * 같은 모양이므로 거의 그대로 겹쳐야 합니다.
   *
   * ⚠️ 절대값으로 "0.95 이상"을 요구하지 **않습니다.** 좌표가 정수라
   *    0.6배 하면 반올림이 한 칸씩 어긋나고, 그래서 실제로 0.90 이 나옵니다.
   *    그건 정규화의 고장이 아니라 **격자의 계단**입니다. 그 0.05 를 두고
   *    기준을 옮기기 시작하면 검사가 아니라 흥정이 됩니다.
   *
   *    그래서 **견주어** 묻습니다: 크기만 바꾼 자기 자신이, 가장 닮은 남보다
   *    확실히 높은가? 이 프로브가 성립하려면 그 순서가 맞아야 하고, 그건
   *    지어낸 숫자 없이 물을 수 있는 질문입니다.
   *
   * ⚠️ 원래 여기서는 보물(팔면체)을 눈금으로 쓰려 했는데, `spawnTreasure`
   *    라는 훅이 **아예 없어서 조용히 건너뛰고 있었습니다.** 있지도 않은
   *    것을 부르고 `if (ok)` 로 감싸 둔 탓에 아무 말 없이 지나갔습니다 —
   *    이 저장소에서 가장 비싼 고장이 늘 그것이었는데 또 했습니다.
   */
  let calib = null
  if (shapes.length) {
    const src = shapes.find((x) => x.pixels > 1000) ?? shapes[0]
    const shrunk = src.pts.map(([x, y]) => [x * 0.6, y * 0.6])
    calib = iou(src.grid, gridOf(shrunk))
    check(
      worst !== undefined && calib > worst.v + 0.1,
      '이 자가 **크기를 지운다** (크기만 바꾼 자기 자신 > 가장 닮은 남)',
      `${src.name} 원본↔60% 축소 ${calib.toFixed(2)}` +
        (worst ? ` vs 가장 닮은 남 ${worst.a}↔${worst.b} ${worst.v.toFixed(2)}` : ''),
    )
  }


  console.log('\n  [종류별 윤곽]')
  for (const s of shapes) {
    console.log(`    ${s.name.padEnd(7)} ${s.pixels}px · 가로세로 ${s.w}×${s.h}`)
  }

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
