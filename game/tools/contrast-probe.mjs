/**
 * 예고 대비 검증 — `npm run contrast`
 *
 * ── 왜 이걸 재게 됐나 ───────────────────────────────────────────
 * Hades II 를 조사하다 나왔습니다. 그 게임도 쿼터뷰이고, 플레이어들이
 * 전투를 못 읽겠다고 하는 이유가 이렇게 정리돼 있었습니다:
 *
 *   · *"노랑 무대, 노랑 공격, 노랑 적, 노랑 예고"* — 보스전에서 위협을
 *     구분할 수가 없다.
 *   · 애니메이션은 180°처럼 보이는데 실제 판정은 360°다.
 *
 * 두 번째는 우리가 이미 막아 뒀습니다(DESIGN.md "보이는 것 = 맞는 것" —
 * 예고를 지면에 **판정 도형 그대로** 그립니다).
 *
 * 하지만 **첫 번째는 한 번도 잰 적이 없습니다.** 우리 4색 예고 시스템은
 * "색으로 대응을 가르친다"가 전부인데, 그 색이 **밟고 선 지형과 구분되는지**
 * 확인하는 장치가 없습니다. 지형 팔레트를 누가 손보는 순간 조용히 깨지고,
 * 설정값 검사로는 절대 안 잡힙니다 — 색은 그대로인데 **바탕이 바뀌니까요.**
 *
 * ── 어떻게 재는가 ──────────────────────────────────────────────
 * 설정에 적힌 색(0xff4530 …)을 보는 게 아닙니다. 그건 조명·톤매핑·투명도를
 * 지나기 **전**의 값이라 화면에 나오는 색과 다릅니다. 그래서:
 *
 *   1. 예고가 없는 화면을 찍습니다 (바탕).
 *   2. 같은 자리에 예고를 띄우고 찍습니다.
 *   3. **두 장에서 달라진 픽셀**이 곧 예고가 그려진 자리입니다.
 *   4. 그 자리의 "예고 색"과 "원래 바탕 색"을 각각 평균 냅니다.
 *   5. 둘의 거리를 **CIELAB ΔE** 로 잽니다.
 *
 * 즉 게임이 실제로 그린 결과를 봅니다. 조명이 어두워져도, 예고 투명도를
 * 낮춰도, 지형 색을 바꿔도 전부 이 숫자에 반영됩니다.
 *
 * ── 기준선을 **재기 전에** 정합니다 ──────────────────────────────
 * 값을 보고 나서 기준을 정하면 그건 검사가 아니라 기록입니다. 그래서 근거를
 * 먼저 적습니다:
 *
 *   · ΔE ≈ 2.3 은 JND(겨우 알아볼 수 있는 차이)입니다. 다만 이 값은
 *     **나란히 놓고, 정지 상태로, 집중해서** 볼 때의 값입니다.
 *   · 예고는 정반대 조건에서 읽힙니다 — **곁눈질로, 움직이는 중에,
 *     0.55초 안에.** 접근성 실무에서 이런 "흘깃 보고 구분" 용도에는
 *     JND 의 열 배쯤을 잡습니다.
 *
 * 그래서 **ΔE 25** 를 문턱으로 씁니다. 재고 나서 고르지 않았습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { decodePng, deltaE } from './png.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5213
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))
const VIEWPORT = { width: 900, height: 560 }

/** 흘깃 보고 구분되어야 하는 문턱 (위 설계 노트의 근거). */
const MIN_DELTA_E = 25

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

/** 두 장을 견줘 "달라진 픽셀"만 골라 평균 색 두 개를 냅니다. */
function telegraphVsGround(basePng, litPng) {
  const a = decodePng(basePng)
  const b = decodePng(litPng)
  if (a.width !== b.width || a.height !== b.height) throw new Error('두 장의 크기가 다릅니다')
  let n = 0
  const sumLit = [0, 0, 0]
  const sumBase = [0, 0, 0]
  for (let i = 0; i < a.width * a.height; i++) {
    const o = i * 4
    const dr = b.data[o] - a.data[o]
    const dg = b.data[o + 1] - a.data[o + 1]
    const db = b.data[o + 2] - a.data[o + 2]
    /**
     * 문턱 18: 압축 잡음·안티에일리어싱·미세한 조명 흔들림을 걸러 냅니다.
     * 0 으로 두면 배경 노이즈까지 "예고"로 세어 평균이 바탕 쪽으로 끌려갑니다.
     */
    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) < 18) continue
    n++
    sumLit[0] += b.data[o]
    sumLit[1] += b.data[o + 1]
    sumLit[2] += b.data[o + 2]
    sumBase[0] += a.data[o]
    sumBase[1] += a.data[o + 1]
    sumBase[2] += a.data[o + 2]
  }
  if (n === 0) return null
  return {
    pixels: n,
    lit: sumLit.map((v) => Math.round(v / n)),
    ground: sumBase.map((v) => Math.round(v / n)),
  }
}

try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🎨 예고 대비 검증 — 색이 바탕과 구분되는가\n')
  console.log(`  [기준] ΔE ${MIN_DELTA_E} 이상 (JND 2.3 의 약 10배 — 곁눈질·이동 중·0.55초)\n`)

  await page.evaluate(() => {
    window.__game.clearEnemies()
    window.__game.freezeEnemies(true)
  })
  await page.waitForTimeout(800)
  const boss = await page.evaluate(() => window.__game.spawnBoss(0, 5))
  await page.waitForTimeout(400)

  /** 예고가 꺼진 상태의 바탕 한 장. */
  await page.evaluate(() => window.__game.setPaused(true))
  const base = await page.screenshot()
  await page.evaluate(() => window.__game.setPaused(false))

  /**
   * 색 이름은 게임에서 읽습니다 — 프로브가 '빨강/노랑' 순서를 외우면
   * 패턴 순서가 바뀌는 날 조용히 엉뚱한 것을 검사하게 됩니다.
   */
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  const bossDef = roster.find((r) => r.attacks.length >= 4) ?? roster[0]

  const measured = []
  for (let i = 0; i < 4; i++) {
    await page.evaluate(([b, n]) => window.__game.forceAttack(b, n), [boss, i])
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    )
    await page.evaluate(() => window.__game.setPaused(true))
    const shot = await page.screenshot()
    await page.evaluate(() => window.__game.setPaused(false))
    const r = telegraphVsGround(base, shot)
    const name = bossDef.attacks[i]?.color ?? `패턴${i}`
    if (!r) {
      check(false, `${name} 예고가 화면에 나타났다`, '달라진 픽셀이 없습니다')
      continue
    }
    measured.push({ name, ...r })
    await page.waitForTimeout(150)
  }

  // ---- 1. 예고가 **밟고 선 바탕**과 구분되는가 ----
  for (const m of measured) {
    const d = deltaE(m.lit, m.ground)
    check(
      d >= MIN_DELTA_E,
      `${m.name} 예고가 그 자리 바탕과 구분된다`,
      `ΔE ${d.toFixed(1)} · 예고 rgb(${m.lit}) vs 바탕 rgb(${m.ground}) · ${m.pixels}px`,
    )
  }

  // ---- 2. 네 색이 **서로** 구분되는가 ----
  //
  // 바탕과의 대비만 보면 "넷 다 밝은 주황"이어도 전부 통과합니다.
  // 그러면 색으로 대응을 가르친다는 설계가 무너지는데도 검사는 초록입니다.
  // 가장 가까운 한 쌍만 봅니다 — 나머지는 그보다 멀 수밖에 없습니다.
  if (measured.length >= 2) {
    let worst = { d: Infinity, a: '', b: '' }
    for (let i = 0; i < measured.length; i++) {
      for (let j = i + 1; j < measured.length; j++) {
        const d = deltaE(measured[i].lit, measured[j].lit)
        if (d < worst.d) worst = { d, a: measured[i].name, b: measured[j].name }
      }
    }
    check(
      worst.d >= MIN_DELTA_E,
      '네 색이 서로 구분된다 (가장 헷갈리는 한 쌍 기준)',
      `${worst.a} vs ${worst.b} — ΔE ${worst.d.toFixed(1)}`,
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
