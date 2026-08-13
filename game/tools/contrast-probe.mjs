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
 *
 * ── 어느 **순간**을 재는가 ─────────────────────────────────────────
 * 예고는 투명도가 0.12 → 0.54 로 차오릅니다("점점 위험해진다"). 그래서
 * "예고 색"은 하나가 아니라 시간에 따라 달라집니다. 어느 순간을 재는지
 * 정하지 않으면 이 프로브는 아무 말도 못 합니다.
 *
 * ⚠️ 중간에 한 번 헛짚었고, 그 기록을 남깁니다. "지금은 띄우자마자 찍으니
 *    **가장 흐린 순간**을 재고 있다"고 판단해서, 예고가 절반쯤 지날 때까지
 *    기다리도록 고쳤습니다. 그런데 실제로 재 보니 그 전제가 틀렸습니다:
 *
 *      `freezeEnemies(true)` 상태에서는 예고 타이머가 **멈춰 있고**,
 *      멈춘 자리가 네 패턴 모두 **남은 시간 25%** 로 똑같습니다.
 *      (0.195/0.78 · 0.338/1.35 · 0.23/0.92 — 전부 정확히 25%)
 *
 *    즉 원래부터 **75% 지난 지점**, 투명도로는 0.44 쯤을 재고 있었습니다.
 *    가장 흐린 순간이 아니라 오히려 **넉넉한 순간**이었습니다.
 *    그리고 "절반까지 기다리기"는 타이머가 안 흐르니 즉시 참이 되어,
 *    렌더러가 새 예고를 그리기도 전에 화면을 찍었습니다 — 그래서 결과가
 *    **한 칸씩 밀렸습니다**(첫 패턴은 13px, 나머지는 앞 패턴의 색).
 *
 * 결론: 얼어붙은 상태가 **네 패턴에 똑같이** 적용되므로 비교에는 오히려
 * 이상적입니다. 기다리지 않고, 렌더러가 새 예고를 그릴 두 프레임만 줍니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { CVD_KINDS, decodePng, deltaE, luminance, simulateCvd } from './png.mjs'

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

/**
 * **정해 둔 지면 지점들**의 색을 두 장에서 각각 읽습니다.
 *
 * ── 왜 "달라진 픽셀 전부"에서 여기로 바꿨는가 ──────────────────────
 * 예전 방식(아래 `telegraphVsGround`)은 두 장을 견줘 **달라진 픽셀을 전부**
 * 모았습니다. 넷까지는 잘 돌았는데, 🟢 을 재기 시작하자 무너졌습니다:
 *
 *     🟢 예고 rgb(60,77,76) vs 바탕 rgb(69,73,82) — 예고가 바탕보다 **어둡다**
 *
 * 밝은 민트색을 덮어 그린 자리가 바탕보다 어두울 수는 없습니다. 즉 이건
 * 게임이 아니라 **계기가 틀린 것**이었습니다. 원인은 둘이었습니다:
 *
 *   1. 🟢 예고는 **깜빡입니다**(visuals.ts — 요구하는 동작이 정반대라
 *      일부러 그렇게 만들었습니다). 어느 프레임에 찍히느냐로 값이 갈립니다.
 *   2. 달라진 픽셀에는 **보스의 몸**도 들어옵니다. 예고가 뜨는 동안 몸이
 *      발광하기 때문입니다. 그래서 🟢 만 바탕 평균이 rgb(69,73,82) 로
 *      다른 넷(rgb 30~52)보다 훨씬 밝게 나왔습니다 — 지면이 아니라
 *      **보스를 재고 있었습니다.**
 *
 * 그래서 "달라진 곳"을 찾지 않고, **어디를 볼지 먼저 정합니다**: 부채꼴
 * 안쪽 지면 위의 점들을 게임에게 화면 좌표로 물어보고 거기만 읽습니다.
 * 몸도, 배경도, 깜빡임이 만든 헛것도 섞이지 않습니다.
 */
function sampleTelegraph(basePng, litPng, spots) {
  const a = decodePng(basePng)
  const b = decodePng(litPng)
  let n = 0
  const g = [0, 0, 0]
  const l = [0, 0, 0]
  for (const s of spots) {
    const x = Math.round(s.sx)
    const y = Math.round(s.sy)
    if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue
    const i = (y * a.width + x) * 4
    // 바탕이 이미 밝으면 지면이 아니라 몸일 수 있습니다 — 그런 점은 버립니다.
    if (a.data[i] > 120 || a.data[i + 1] > 120) continue
    g[0] += a.data[i]
    g[1] += a.data[i + 1]
    g[2] += a.data[i + 2]
    l[0] += b.data[i]
    l[1] += b.data[i + 1]
    l[2] += b.data[i + 2]
    n++
  }
  if (n < 6) return null
  return {
    ground: g.map((v) => Math.round(v / n)),
    lit: l.map((v) => Math.round(v / n)),
    pixels: n,
  }
}

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
  /**
   * ⚠️ **`i < 4` 로 박혀 있었습니다.** 색이 넷이던 시절의 숫자인데, 🟢 반격이
   *    다섯째로 들어온 뒤에도 그대로였습니다. 즉 이 프로브는 몇 라운드 동안
   *    **🟢 을 한 번도 안 재고** 초록불을 켜고 있었습니다. 같은 실수를
   *    `npm run react` 에서도 했습니다(거기선 예산이 4지선다에 묶여 있었습니다).
   *    이제 보스가 가진 패턴 수만큼 돕니다 — 색을 늘리면 여기가 저절로 늘어납니다.
   */
  for (let i = 0; i < bossDef.attacks.length; i++) {
    await page.evaluate(([b, n]) => window.__game.forceAttack(b, n), [boss, i])
    /**
     * 렌더러가 **새 예고를 그린 뒤**에 찍어야 합니다. 두 프레임을 주는
     * 이유가 이것입니다 — 한 프레임만 주고 찍었더니 앞 패턴의 화면이
     * 찍혀 결과가 통째로 한 칸씩 밀렸습니다.
     */
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    )
    // 얼어붙은 예고는 네 패턴 모두 "남은 시간 25%" 에 멈춥니다(위 설계 노트).
    const at = await page.evaluate(([b]) => {
      const i = window.__game.enemyInfo(b)
      return i ? Number((1 - i.timer / i.windup).toFixed(2)) : -1
    }, [boss])
    /**
     * 부채꼴 안 **지면 위의 점들**을 게임에게 화면 좌표로 물어봅니다.
     * 사거리의 35~80% 구간을 씁니다 — 안쪽은 몸에 가리고, 맨 끝은 도형의
     * 가장자리라 반칸만 칠해집니다.
     */
    const geo = bossDef.attacks[i]
    const groundSpots = await page.evaluate(
      ([b, reach, arcDeg]) => {
        const G = window.__game
        const info = G.enemyInfo(b)
        if (!info) return []
        const out = []
        const half = ((arcDeg / 2) * Math.PI) / 180
        for (const frac of [0.35, 0.5, 0.65, 0.8]) {
          for (const t of [-0.7, -0.35, 0, 0.35, 0.7]) {
            const ang = info.rotY + half * t
            const r = reach * frac
            // 예고 판은 지면 바로 위(y=0.04)에 깔립니다.
            const p = G.screenPos(info.x + Math.sin(ang) * r, 0.05, info.z + Math.cos(ang) * r)
            if (p) out.push(p)
          }
        }
        return out
      },
      [boss, geo.reach, geo.arcDeg],
    )
    /**
     * 🟢 은 **깜빡입니다.** 한 장만 찍으면 어느 위상에 걸리느냐로 값이
     * 갈립니다. 여러 장 찍어 **가장 진한 순간**을 씁니다 — 깜빡이는 표시는
     * 사람 눈에도 가장 진한 순간이 기준이 됩니다(안 깜빡이는 넷은 어느
     * 장을 골라도 같으므로 이 규칙이 불공평하지 않습니다).
     */
    let shot = null
    let bestSum = -1
    for (let k = 0; k < 4; k++) {
      await page.evaluate(() => window.__game.setPaused(true))
      const one = await page.screenshot()
      await page.evaluate(() => window.__game.setPaused(false))
      const probe = sampleTelegraph(base, one, groundSpots)
      const sum = probe ? deltaE(probe.lit, probe.ground) : -1
      if (sum > bestSum) {
        bestSum = sum
        shot = one
      }
      await page.waitForTimeout(45)
    }
    const r = sampleTelegraph(base, shot, groundSpots)
    const name = bossDef.attacks[i]?.color ?? `패턴${i}`
    if (!r) {
      check(false, `${name} 예고가 화면에 나타났다`, '지면 표본을 못 잡았습니다')
      continue
    }
    measured.push({ name, at, ...r })
    await page.waitForTimeout(150)
  }

  // ---- 1. 예고가 **밟고 선 바탕**과 구분되는가 ----
  for (const m of measured) {
    const d = deltaE(m.lit, m.ground)
    check(
      d >= MIN_DELTA_E,
      `${m.name} 예고가 그 자리 바탕과 구분된다`,
      `ΔE ${d.toFixed(1)} · 예고 rgb(${m.lit}) vs 바탕 rgb(${m.ground}) · ${m.pixels}px · 예고 ${Math.round(m.at * 100)}% 지점`,
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

  /**
   * ---- 3. **색각 이상인 사람에게도 갈리는가** ----
   *
   * enemyAttacks.ts 가 색을 정하며 적어 둔 문장입니다:
   *
   *   > 색맹(적록)을 고려해 **밝기와 채도도 함께** 벌려 두었습니다. 색만으로
   *   > 구분하게 만들면 남성 약 8%가 빨강/노랑을 구분하지 못합니다.
   *
   * 옳은 판단인데 **한 번도 확인한 적이 없습니다.** 위 1·2번은 정상 시야
   * 에서만 재므로 이 문장을 검사하지 않습니다. 같은 화면을 그 사람 눈으로
   * 바꿔 놓고 다시 잽니다(png.mjs `simulateCvd` — Machado 2009 계수).
   */
  const worstPair = (map) => {
    let worst = { d: Infinity, a: '', b: '' }
    for (let i = 0; i < measured.length; i++) {
      for (let j = i + 1; j < measured.length; j++) {
        const d = deltaE(map(measured[i].lit), map(measured[j].lit))
        if (d < worst.d) worst = { d, a: measured[i].name, b: measured[j].name }
      }
    }
    return worst
  }
  console.log('')
  const cvdCollisions = []
  if (measured.length >= 2) {
    /**
     * ⚠️ **여기에 "색각 이상에서도 ΔE 25 이상"을 요구했다가 거뒀습니다.**
     *
     * 통과할 수 없는 검사였기 때문입니다. 🟢 을 빼고 **원래 넷만** 재도
     * 청색맹에서 🟡 vs 🟣 가 ΔE 15.2 입니다 — 다섯 색은커녕 **넷으로도**
     * 처음부터 불가능한 기준이었습니다. 색각 이상은 색 채널 자체를
     * 접어 버리므로, 색을 아무리 잘 골라도 살 수 없습니다.
     *
     * 그래서 요구를 옮깁니다: **무너지는 쌍을 찍어 두고, 그 쌍이 도형으로
     * 갈리는지**를 아래 5번이 요구합니다. 이게 접근성 실무가 말하는
     * "중복 부호화"입니다 — 색이 접히면 **다른 채널이 같은 뜻을 져야** 합니다.
     */
    for (const kind of CVD_KINDS) {
      const w = worstPair((c) => simulateCvd(c, kind))
      const label = { protan: '적색맹', deutan: '녹색맹', tritan: '청색맹' }[kind] ?? kind
      if (w.d < MIN_DELTA_E) cvdCollisions.push(`${label} ${w.a}vs${w.b} ΔE${w.d.toFixed(1)}`)
      console.log(
        `  📋 [관찰] ${label} 에서 가장 붙는 한 쌍 — ${w.a} vs ${w.b} ΔE ${w.d.toFixed(1)}` +
          `${w.d < MIN_DELTA_E ? ' (색으로는 못 갈림 — 도형이 져야 합니다)' : ''}`,
      )
    }

    /**
     * ---- 4. **색이 아예 없으면 밝기로는 안 됩니다 (계산으로 압니다)** ----
     *
     * 처음엔 여기에 "밝기만으로도 다섯이 갈린다"를 요구했습니다. 그런데
     * 그건 **통과할 수 없는 검사**였습니다. 밝기는 축이 하나뿐이라 다섯을
     * 세우려면 네 칸이 필요하고, 칸마다 ΔE 25 면 L* 로 100 — 검정에서
     * 흰색까지 **전 구간**입니다. 예고는 어두운 지면 위에서 다 보여야
     * 하므로 그 범위를 쓸 수 없습니다.
     *
     * 통과 못 할 검사를 걸어 두면 둘 중 하나가 됩니다: 영원히 빨간 줄로
     * 남아 무시되거나, 어느 날 조용히 지워지거나. **둘 다 나쁩니다.**
     *
     * 그래서 질문을 바꿉니다. 밝기로 가장 붙어 있는 한 쌍을 **찍어만 두고**,
     * 그 둘이 **도형으로 갈리는지**를 아래 5번에서 요구합니다. 색이 통째로
     * 사라지는 환경(어두운 화면·햇빛·채도 죽은 모니터)에서 남는 채널은
     * 밝기가 아니라 **모양과 움직임**입니다.
     */
    const g = worstPair((c) => [luminance(c), luminance(c), luminance(c)])
    console.log(
      `  📋 [관찰] 밝기만 남기면 가장 붙는 한 쌍 — ${g.a} vs ${g.b} ΔE ${g.d.toFixed(1)}` +
        ` (다섯 색을 밝기 하나로 세우는 것은 원리적으로 불가능합니다 — 아래 5번이 대신 지킵니다)`,
    )
  }

  /**
   * ---- 5. 그러면 **모양이 대신 갈라 주는가** ----
   *
   * enemyAttacks.ts 는 색이 무너져도 괜찮은 이유를 이렇게 적어 두었습니다:
   *
   *   > 도형의 두께도 다르게 그립니다 (visuals.ts) — 색이 안 보여도
   *   > **굵기로 읽히게** 하는 것이 목적입니다.
   *
   * 이건 픽셀을 안 찍어도 **데이터만으로** 확인할 수 있습니다. 예고 도형은
   * `makeSectorGeometry(0.35, reach, arcDeg)` 하나로 만들어지므로, **사거리와
   * 각도가 같으면 도형이 글자 그대로 같습니다.** 서로 **다른 색**인데 그 둘이
   * 같으면, 색을 지웠을 때 남는 것이 아무것도 없습니다.
   */
  {
    const all = roster.flatMap((r) => r.attacks.map((a) => ({ ...a, from: r.name })))
    const collide = []
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        if (a.intent === b.intent) continue
        // 화면에서 1m ≈ 31px 이므로 0.3m·10° 안쪽이면 흘깃 봐서는 같은 도형입니다.
        if (Math.abs(a.reach - b.reach) <= 0.3 && Math.abs(a.arcDeg - b.arcDeg) <= 10) {
          collide.push(`${a.color}${a.id} vs ${b.color}${b.id} (${a.reach}m/${a.arcDeg}° · ${b.reach}m/${b.arcDeg}°)`)
        }
      }
    }
    check(
      collide.length === 0,
      '색이 다르면 **도형도 다르다** (색이 접혀도 남는 것이 있다)',
      collide.length
        ? collide.slice(0, 4).join(' · ')
        : `패턴 ${all.length}개 중 겹치는 쌍 없음` +
          (cvdCollisions.length ? ` · 색으로 못 갈리는 쌍 ${cvdCollisions.length}건을 도형이 받습니다` : ''),
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
