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
  /**
   * ── 🔵 **예고가 깔고 앉은 바탕이 진짜 "맨 지면"인가** ─────────────────
   *
   * 위 검사들은 예고를 **밟고 선 지면**과 견줍니다. 그런데 그 전제가
   * 방금 흔들렸습니다: 등 뒤 표시 고리를 1.6m → 3.95m 로 넓혔거든요
   * (visuals `backZoneOuter` — 판정에 거리 제한이 없어서 표시가 좁았던 것을
   * 고친 것입니다). 고리는 `backIndicatorRange`(5.5m) 안의 **모든 적**에게
   * 그려지므로, 실제 전투의 지면은 맨 흙이 아니라 **겹친 고리들**입니다.
   *
   * 즉 이 프로브가 재던 바탕은 **전투 중에 존재하지 않는 바탕**일 수
   * 있습니다. 넓힌 것이 예고를 못 읽게 만들었다면 그건 제가 만든 해악이고,
   * 아무도 그걸 재고 있지 않았습니다.
   *
   * 그래서 같은 자리에서 **대조군**을 만듭니다 — 적 없이 한 장, 적을
   * 둘러세우고 한 장. 문턱은 위와 **같은 값**(`MIN_DELTA_E`)을 씁니다.
   * (대조군이 없어서 원인을 못 갈랐던 것이 바로 앞 라운드의 교훈입니다.)
   */
  console.log('')
  {
    const crowded = await page.evaluate(async () => {
      const G = window.__game
      const sleep = () => new Promise((r) => setTimeout(r, 16))
      G.reset()
      await sleep()
      G.clearEnemies()
      await sleep()
      const p = G.state().player
      // 플레이어 둘레에 고리가 겹치도록 세웁니다 — 표시 사거리(5.5m) 안쪽.
      const spots = [
        [2.2, 0],
        [-2.2, 0.6],
        [0.4, 2.4],
        [0.2, -2.3],
      ]
      const made = []
      for (const [dx, dz] of spots) made.push(G.spawnEnemyKind('grunt', p.x + dx, p.z + dz))
      for (const e of made) G.wakeEnemy(e)
      G.freezeEnemies(true)
      await new Promise((r) => setTimeout(r, 400))
      /**
       * ⚠️ **한 점만 찍지 않습니다.**
       *
       * 처음엔 발밑 앞 한 점만 봤고 `ΔE 0.0` 이 나왔습니다 — 픽셀이
       * **완전히 동일**했습니다. 적 넷을 세웠는데 아무 변화가 없다는 건
       * 고리가 그 한 점을 안 덮었다는 뜻일 뿐, *"고리가 지면을 안 바꾼다"* 는
       * 뜻이 아닙니다. 고리는 뒤쪽 140° 부채꼴이라 어디 서느냐로 갈립니다.
       * 바로 앞 라운드에서 한 자리만 찍고 결론 낼 뻔한 그 실수입니다.
       *
       * 그래서 플레이어 둘레를 **격자로 훑고 가장 크게 바뀐 곳**을 씁니다.
       * 재려는 것은 *"어딘가에서 바탕이 바뀌는가"* 이므로 최댓값이 맞습니다.
       */
      const at = []
      for (const dx of [-3, -2, -1, 0, 1, 2, 3]) {
        for (const dz of [-3, -2, -1, 0, 1, 2, 3]) {
          /**
           * ⚠️ **적의 몸을 찍으면 안 됩니다.**
           *
           * 격자를 훑었더니 가장 크게 바뀐 곳이 `rgb(178,53,44)` — 붉은색,
           * 즉 **적의 몸**이었습니다. 재려는 것은 *"고리가 지면을 바꾸는가"*
           * 인데 *"거기 적이 서 있는가"* 를 재고 있었습니다. 적이 새로
           * 생겼으니 당연히 바뀌고, 그 값은 아무 뜻이 없습니다.
           *
           * 그래서 적 둘레는 넉넉히 비웁니다. 지면만 남깁니다.
           */
          const nearBody = spots.some(([sx, sz]) => Math.hypot(dx - sx, dz - sz) < 1.4)
          if (nearBody) continue
          const q = G.screenPos(p.x + dx, 0.05, p.z + dz)
          if (q) at.push(q)
        }
      }
      return { at, count: made.length }
    })
    const withFoes = await page.screenshot()
    await page.evaluate(async () => {
      window.__game.freezeEnemies(false)
      window.__game.clearEnemies()
      await new Promise((r) => setTimeout(r, 300))
    })
    await page.waitForTimeout(300)
    const bare = await page.screenshot()

    const pick = (png, at) => {
      const img = decodePng(png)
      const x = Math.round(at.sx)
      const y = Math.round(at.sy)
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null
      const i = (y * img.width + x) * 4
      return [img.data[i], img.data[i + 1], img.data[i + 2]]
    }
    let worst = null
    for (const q of crowded.at ?? []) {
      const a0 = pick(bare, q)
      const b0 = pick(withFoes, q)
      if (!a0 || !b0) continue
      const d = deltaE(b0, a0)
      if (!worst || d > worst.d) worst = { d, a: a0, b: b0 }
    }
    check(
      crowded.count >= 3 && (crowded.at?.length ?? 0) >= 9 && worst !== null,
      '🔵 같은 자리들을 적 있을 때와 없을 때 각각 찍었다 (대조군의 게이트)',
      `적 ${crowded.count}마리 · 훑은 점 ${crowded.at?.length ?? 0}곳` +
        (worst ? ` · 가장 크게 바뀐 곳 맨 지면 rgb(${worst.a}) → rgb(${worst.b})` : ''),
    )
    if (worst) {
      const a = worst.a
      const b = worst.b
      const shift = worst.d
      /**
       * 고리가 바탕을 **문턱만큼** 바꿔 놓으면, 위 검사들이 통과시킨
       * 예고도 실제 전투에서는 그만큼 덜 읽힙니다. 문턱을 새로 만들지
       * 않고 같은 `MIN_DELTA_E` 를 씁니다 — *"색 하나를 구분할 수 있는
       * 최소 차이"* 라는 뜻이 양쪽에서 같기 때문입니다.
       */
      check(
        shift < MIN_DELTA_E,
        '🔵 **등 뒤 고리가 지면을 덮어 예고의 바탕을 바꾸지 않는다** (넓힌 표시가 예고를 잡아먹지 않게)',
        `가장 크게 바뀐 곳 ΔE ${shift.toFixed(1)} (문턱 ${MIN_DELTA_E} 미만)` +
          ` · rgb(${a}) → rgb(${b}) · 적 ${crowded.count}마리를 5.5m 안에`,
      )
    }
  }

  /**
   * ── 🗂 **예고끼리 겹쳤을 때, 더 급한 색이 이기는가** ─────────────────
   *
   * ── 왜 이 검사가 없었는가 ────────────────────────────────────────
   * 위 검사들은 전부 **예고 하나 vs 바탕**입니다. 그런데 실전에서 동시에
   * 붙는 적이 최대 4마리이고(`npm run play` 실측), 그러면 부채꼴 넷이
   * 한 자리에 포개집니다. 그 상태의 화면을 처음 찍어 봤더니 **한복판이
   * 탁한 회갈색**이었습니다 — 색이 곧 답인 게임인데, 답이 가장 필요한
   * 자리에서 색을 못 읽습니다.
   *
   * 원인은 그리는 순서에 규칙이 없던 것이었습니다(enemyAttacks.ts
   * `INTENT_LAYER`). 그래서 지켜야 할 규칙은 *"안 겹친다"* 가 아니라
   * **"겹치면 더 급한 것이 보인다"** 입니다 — 겹침 자체는 막을 수 없으니까요.
   *
   * ⚠️ 두 색을 **바꿔 가며 두 번** 잽니다. 한 번만 재면 *"규칙이 이겼다"*
   *    와 *"어쩌다 그 적이 카메라에 가까웠다"* 가 구분되지 않습니다.
   *    자리를 맞바꿔도 같은 색이 이겨야 규칙입니다.
   */
  {
    const spot = await page.evaluate(() => {
      const G = window.__game
      G.freezeEnemies(false)
      G.clearEnemies()
      return G.state().player
    })
    const layerRun = async (swap) => {
      const r = await page.evaluate(
        ([px, pz, sw]) => {
          const G = window.__game
          G.clearEnemies()
          /**
           * 🟡 광역과 🔴 직격을 플레이어 양옆에 세웁니다. 둘 다 플레이어를
           * 노리므로 부채꼴이 **플레이어 앞쪽에서 겹칩니다.**
           * `sw` 로 자리를 맞바꿔 카메라 거리를 뒤집습니다.
           */
          const near = sw ? -3.4 : 3.4
          const far = sw ? 3.4 : -3.4
          const red = G.spawnEnemyKind('grunt', px + 0.6, pz + near)
          const yellow = G.spawnEnemyKind('charger', px - 0.6, pz + far)
          G.step(20, 1 / 60, true)
          G.wakeEnemy(red)
          G.wakeEnemy(yellow)
          G.step(10, 1 / 60)
          G.setHp(G.playerEntity(), 100)
          for (const e of [red, yellow]) {
            G.setHp(e, 400)
            G.forceAttack(e, 0, 1)
          }
          G.step(30, 1 / 60)
          const tg = G.telegraphs()
          // 겹치는 자리 — 플레이어 바로 앞뒤 지면. 몸에 안 가리게 옆으로도 훑습니다.
          const at = []
          for (const dz of [-1.1, -0.6, 0.6, 1.1]) {
            for (const dx of [-1.0, -0.5, 0.5, 1.0]) {
              const p = G.screenPos(px + dx, 0.05, pz + dz)
              if (p) at.push(p)
            }
          }
          return { at, tg: tg.map((t) => ({ id: t.attackId, intent: t.intent, op: t.opacity })) }
        },
        [spot.x, spot.z, swap],
      )
      await page.evaluate(() => window.__game.setPaused(true))
      const png = await page.screenshot()
      return { ...r, png }
    }
    const runs = [await layerRun(false), await layerRun(true)]
    const pick2 = (png, at) => {
      const img = decodePng(png)
      const x = Math.round(at.sx)
      const y = Math.round(at.sy)
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null
      const i = (y * img.width + x) * 4
      // 밝으면 지면이 아니라 몸입니다 — 위 sampleTelegraph 와 같은 규칙.
      if (img.data[i] > 150 && img.data[i + 1] > 150) return null
      return [img.data[i], img.data[i + 1], img.data[i + 2]]
    }
    /**
     * 🔴 와 🟡 의 **원색을 게임에게 묻습니다**(프로브가 색을 베끼지 않게).
     *
     * 절대 거리가 아니라 *"어느 쪽으로 기울었는가"* 만 봅니다. 예고는
     * 투명도 0.x 로 지면에 얹히므로 화면색이 원색과 같아질 수 없습니다 —
     * 위 🟢 주석의 *"계산으로는 33.6인데 화면에서는 23.3"* 이 그 이야기입니다.
     * 방향만 물으면 그 왜곡이 양쪽에 똑같이 걸려 상쇄됩니다.
     */
    const hues = await page.evaluate(() => window.__game.intentColors())
    const redRgb = hues[0].rgb // 🔴 직격 (INTENT_COLOR 의 첫 칸 = Strike)
    const yellowRgb = hues[1].rgb // 🟡 광역
    const scored = runs.map((r) => {
      let red = 0
      let yellow = 0
      let n = 0
      for (const q of r.at) {
        const c = pick2(r.png, q)
        if (!c) continue
        n++
        // 화면색이 어느 원색 쪽으로 **기울었는가**만 봅니다(색상 방향).
        if (deltaE(c, redRgb) < deltaE(c, yellowRgb)) red++
        else yellow++
      }
      return { red, yellow, n, tg: r.tg.length }
    })
    console.log(
      `  [겹친 자리] ${scored
        .map((s, i) => `${i === 0 ? '🔴가까움' : '🔴멀음'} 🔴쪽 ${s.red} · 🟡쪽 ${s.yellow} (표본 ${s.n})`)
        .join(' · ')}`,
    )
    // 🚧 두 판 다 예고가 실제로 둘 떠 있었고 표본이 잡혔는지부터.
    check(
      runs.length === 2 &&
        runs.every((r) => r.tg.length >= 2) &&
        scored.length === 2 &&
        scored.every((s) => s.n >= 6),
      '🚧 두 판 다 예고가 **둘 다 떠 있고** 겹친 자리를 실제로 읽었다 (비교의 게이트)',
      runs.map((r, i) => `${i + 1}판 예고 ${r.tg.length}개 · 표본 ${scored[i].n}`).join(' · '),
    )
    check(
      // 길이를 먼저 못 박습니다 — `.every` 는 빈 배열에서 참입니다(npm run guard).
      scored.length === 2 && scored.every((s) => s.n >= 6 && s.red > s.yellow),
      '🗂 **예고가 겹치면 더 급한 색(🔴)이 보인다** (자리를 맞바꿔도 같게)',
      scored.map((s, i) => `${i === 0 ? '🔴가까움' : '🔴멀음'} ${s.red}:${s.yellow}`).join(' · '),
    )
    await page.evaluate(() => {
      window.__game.setPaused(false)
      window.__game.clearEnemies()
    })
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
