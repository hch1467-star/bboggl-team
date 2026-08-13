/**
 * 구역 색조 검증 — `npm run zones`
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * 이 존에는 이름 붙은 구역이 열 곳 있고 저마다 한 줄 설명까지 달려 있는데,
 * **화면에서는 전부 같은 회색**이었습니다. 구역이 바뀐 것을 알려 주는 것은
 * HUD 글자뿐이라, 지도를 읽는 일이 **글을 읽는 일**이 되어 있었습니다.
 * 쿼터뷰에서 지역을 구분하는 것은 원래 눈의 일입니다.
 *
 * ── 그런데 색을 넣으면 **예고가 묻힐 수 있습니다** ────────────────
 * 이 프로젝트에는 이미 약속이 하나 있습니다: *예고 4색은 바탕과 ΔE 25 이상
 * 떨어져 있어야 한다* (`npm run contrast`). 그 검사는 **시험장 한 곳**에서
 * 잽니다. 지면을 구역마다 물들이면, 어떤 구역에서만 그 여유가 사라질 수
 * 있고 **기존 검사는 그걸 못 봅니다.**
 *
 * 그래서 이 프로브는 두 가지를 같이 봅니다:
 *   1. 붙어 있는 구역끼리 **눈으로 갈리는가** (이 기능의 목적)
 *   2. 어느 구역에서도 예고 4색이 **안 묻히는가** (기능의 대가)
 *
 * 2번이 없으면 이 기능은 "보기 좋아졌는데 왜 죽는지 모르겠다"가 됩니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { decodePng, deltaE } from './png.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5221
const VIEWPORT = { width: 1100, height: 690 }
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

/**
 * 붙어 있는 구역끼리의 기준 ΔE 10.
 *
 * `climb` 프로브의 턱/벽과 **같은 상황이라 같은 값**을 씁니다 — 구역 경계는
 * 한 화면에 두 색이 **나란히** 놓이는 자리이고, 나란히 보는 비교는 그만큼
 * 예민합니다. (예고의 25 는 0.55초 안에 곁눈질로 읽어야 해서 그렇게 큽니다.)
 */
const MIN_ADJACENT = 10

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

/** 화면의 한 점 둘레 3×3 평균. 한 픽셀은 모서리 안티에일리어싱에 물립니다. */
function patch(shot, sx, sy) {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = sx + dx
      const py = sy + dy
      if (px < 0 || py < 0 || px >= shot.width || py >= shot.height) continue
      const o = (py * shot.width + px) * 4
      r += shot.data[o]
      g += shot.data[o + 1]
      b += shot.data[o + 2]
      n++
    }
  }
  return n ? [r / n, g / n, b / n] : null
}

try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🗺️  구역 색조 검증 — 지역이 눈에 갈리는가, 그 대가로 예고가 묻히지 않는가\n')

  const regions = await page.evaluate(() => window.__game.regionList())
  console.log(`  [설정] 구역 ${regions.length}곳 · 붙은 구역 기준 ΔE ${MIN_ADJACENT}\n`.replace('MIN_ADJACENT', MIN_ADJACENT))

  /** 구역마다 그 한가운데로 가서 바닥 픽셀을 모읍니다. */
  const ground = new Map()
  for (const r of regions) {
    await page.evaluate(async ([x, z]) => {
      const G = window.__game
      G.clearEnemies()
      G.teleportPlayer(x, z)
      await new Promise((res) => setTimeout(res, 60))
      G.setPaused(true)
    }, [r.x, r.z])
    await page.evaluate(
      () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))),
    )
    const samples = await page.evaluate(() => window.__game.groundSamples())
    const shot = decodePng(await page.screenshot())
    await page.evaluate(() => window.__game.setPaused(false))
    for (const s of samples) {
      // HUD 위 표본은 버립니다 — 지형이 아니라 UI 를 잰 것이 됩니다.
      if (s.sy < 120 || s.sy > VIEWPORT.height - 160) continue
      const c = patch(shot, s.sx, s.sy)
      if (!c) continue
      const list = ground.get(s.region) ?? []
      list.push(c)
      ground.set(s.region, list)
    }
  }

  const avg = (list) => [0, 1, 2].map((i) => list.reduce((s, c) => s + c[i], 0) / list.length)
  const color = new Map()
  for (const [name, list] of ground) if (list.length >= 8) color.set(name, avg(list))

  check(
    color.size === regions.length,
    '구역 전부의 바닥을 화면에서 봤다 (못 본 구역이 조용히 빠지지 않게)',
    `${color.size}/${regions.length}곳` +
      (color.size < regions.length
        ? ` · 못 본 곳: ${regions.filter((r) => !color.has(r.name)).map((r) => r.name).join(', ')}`
        : ''),
  )

  // ---- 1. 붙어 있는 구역끼리 갈리는가 ----
  //
  // "붙어 있다"를 제가 정하지 않습니다 — 게임이 준 사각형이 **맞닿거나
  // 겹치는가**로 봅니다. 안 붙은 구역끼리는 한 화면에 같이 안 나오므로
  // 같은 색이어도 헷갈릴 일이 없습니다.
  const touch = (a, b) =>
    a.x0 <= b.x1 + 1 && b.x0 <= a.x1 + 1 && a.z0 <= b.z1 + 1 && b.z0 <= a.z1 + 1
  const pairs = []
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      if (!touch(regions[i], regions[j])) continue
      const ca = color.get(regions[i].name)
      const cb = color.get(regions[j].name)
      if (!ca || !cb) continue
      pairs.push({ a: regions[i].name, b: regions[j].name, d: deltaE(ca, cb) })
    }
  }
  pairs.sort((x, y) => x.d - y.d)
  check(pairs.length > 0, '붙어 있는 구역 쌍을 찾았다', `${pairs.length}쌍`)
  if (pairs.length) {
    const worst = pairs[0]
    check(
      worst.d >= MIN_ADJACENT,
      '붙어 있는 구역은 전부 눈으로 갈린다 (가장 비슷한 한 쌍 기준)',
      `${worst.a} ↔ ${worst.b} ΔE ${worst.d.toFixed(1)} · 다음 ${pairs
        .slice(1, 3)
        .map((p) => `${p.a}↔${p.b} ${p.d.toFixed(1)}`)
        .join(' · ')}`,
    )
  }

  /**
   * ---- 2. 어느 구역에서도 예고 4색이 안 묻히는가 ----
   *
   * ⚠️ 기준값(25)도 예고 색도 **게임에서 읽습니다.** 여기에 25 를 베껴 적거나
   *    빨강의 RGB 를 적어 두면, 예고 색을 손보는 날 이 검사만 옛 색을 지킵니다.
   */
  const intents = await page.evaluate(() => window.__game.intentColors())
  const MIN_TELEGRAPH = 25
  let worstPair = null
  for (const [name, c] of color) {
    for (const it of intents) {
      const d = deltaE(c, it.rgb)
      if (!worstPair || d < worstPair.d) worstPair = { name, color: it.color, d }
    }
  }
  check(
    worstPair !== null && worstPair.d >= MIN_TELEGRAPH,
    `색조를 넣어도 예고가 안 묻힌다 (가장 아슬아슬한 구역·색 기준 ΔE ${MIN_TELEGRAPH})`,
    worstPair
      ? `${worstPair.name} 바닥 vs ${worstPair.color} 예고 ΔE ${worstPair.d.toFixed(1)}`
      : '비교할 것이 없습니다',
  )

  console.log('\n  [구역별 바닥색]')
  for (const r of regions) {
    const c = color.get(r.name)
    console.log(
      `    ${r.name.padEnd(9)} ${c ? `rgb(${c.map((v) => Math.round(v)).join(',')})` : '못 봄'}` +
        `  ${r.tint ? `색조 ${r.tint.map((v) => v.toFixed(2)).join('/')}` : '색조 없음'}`,
    )
  }

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
