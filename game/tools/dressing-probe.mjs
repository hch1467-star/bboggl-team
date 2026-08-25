/**
 * ── 🏗 **「볼 것이 있는가」 — 구역마다 지물이 서 있는지** ────────────────
 *
 * ── 왜 만들었는가 (스크린샷 한 장이 시켰습니다) ──────────────────────
 * 이 세션은 아주 오래 **숫자만** 봤습니다. 강인도 장부 · 지렛대 · 대수 ·
 * 초당 붕괴. 그러다 존을 **처음으로 찍어 봤고**, 숫자가 한 번도 말하지
 * 않은 것이 화면에 있었습니다:
 *
 *     HUD:  남은 적 33 · 보물 0/13 · 목표 202m
 *     화면: 체커 바닥 · 작은 큐브 여덟 개 · 원뿔 하나
 *
 * **시작 지점이 비어 있습니다.** 33마리와 13개가 있다는 존인데, 처음
 * 서는 자리에서는 아무것도 안 보입니다. 로스트아크·NRFTW·엘든 링이
 * 존의 첫 화면에 공들이는 이유가 그것입니다 — **첫 화면이 그 존이 어떤
 * 곳인지 말합니다.**
 *
 * ── 그런데 이 저장소는 그걸 잴 장부를 **이미 갖고 있었습니다** ────────
 * `props.ts` 의 `PropsInfo` 에 이렇게 적혀 있습니다:
 *
 *     pillarSpots / rubbleSpots — "세울 수 있었던 칸 수 — **상한에 걸려
 *                                  잘렸는지 이걸로만 압니다.**"
 *     byRegion                  — "구역 이름 → 그 구역에 선 지물 수."
 *
 * 잘림을 잡으려고 만든 칸입니다. 그런데 **어느 프로브도 이걸 안 읽습니다.**
 * 이 저장소가 이름 붙여 둔 그것입니다 — **「안 재는 약속은 지켜지지
 * 않습니다」.** 그래서 여기서 읽습니다.
 *
 * ── 무엇을 묻는가 ──────────────────────────────────────────────────
 *   ① 지물이 **상한에 잘렸는가** — 잘렸다면 뒤쪽 구역이 비는 이유가
 *      «원래 없음»이 아니라 **«앞에서 다 써 버림»** 입니다. 처방이 정반대
 *      입니다(더 놓기 vs 상한 올리기/재분배).
 *   ② **볼 것이 하나도 없는 구역**이 있는가 — 이름과 한 줄 설명까지
 *      붙어 있는데 화면에는 아무것도 없는 구역.
 *
 * ⚠️ 이 프로브는 «예쁜가»를 재지 않습니다. **«있는가»만** 잽니다.
 *    아름다움은 이 자로 못 재고, 못 재는 것을 재는 척하면 그때부터
 *    숫자가 거짓말을 시작합니다.
 *
 * 실행: node tools/dressing-probe.mjs   (npm run dressing)
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const PORT = 5213

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

try {
  await sleep(4000)
  const browser = await chromium.launch({ executablePath: execPath })
  const page = await browser.newPage({ viewport: { width: 1100, height: 690 } })
  page.on('pageerror', (e) => console.log(`  💥 ${e}`))
  await page.goto(`http://127.0.0.1:${PORT}/?lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 30000 })
  await sleep(1500)

  const info = await page.evaluate(() => {
    const G = window.__game
    return { props: G.props(), regions: G.regionList() }
  })

  const p = info.props
  const regions = info.regions ?? []
  console.log(`\n🏗 지물 — 기둥 ${p.pillars} · 잔해 ${p.rubble} (합 ${p.pillars + p.rubble})\n`)

  /**
   * 🚧 **게이트 먼저.** 지물이 하나도 안 섰으면 아래 판정은 전부 «빈 표본
   *    으로 통과»입니다. 이 저장소가 가장 자주 데인 자리입니다.
   */
  check(p.pillars + p.rubble > 0, '🚧 지물이 실제로 섰다 (아래 판정의 게이트)', `${p.pillars + p.rubble}개`)
  check(regions.length > 0, '🚧 구역 목록을 실제로 읽었다 (아래 판정의 게이트)', `${regions.length}곳`)

  if (p.pillars + p.rubble > 0 && regions.length > 0) {
    /**
     * ① **상한에 잘렸는가.** 잘렸다면 뒤쪽 구역이 빈 이유가 «원래 없음»이
     *    아니라 «앞에서 다 써 버림»입니다 — 처방이 정반대입니다.
     */
    /**
     * ── ⚠️ **`spots` 는 «후보»가 아니라 «자격 있는 칸»입니다** ──────────
     *
     * 첫 판에서 저는 `spots − 선 것` 을 **「상한에 잘린 수」**로 읽고
     * *"잔해 2846개가 잘렸다"* 는 빨강을 냈습니다. **틀렸습니다.**
     * `props.ts` 의 `pick` 을 읽으면 사이에 **밀도**가 한 겹 더 있습니다:
     *
     *     자격 있는 칸  2971
     *       × RUBBLE_DENSITY 0.055   ← 여기서 걸러집니다
     *     ≈ 후보 163            상한 170
     *     실제 125              → **상한에 안 걸렸습니다**
     *
     * 즉 2846개는 «잘린 것»이 아니라 **«애초에 안 뽑힌 것»** 이고, 그건
     * 설계입니다. 두 수 사이에 한 겹이 더 있는 줄 모르고 뺄셈을 했습니다.
     *
     * ⭐ **«A − B» 를 하기 전에 A 와 B 사이에 무엇이 있는지 봐야 합니다.**
     *    이름이 비슷하면(`spots` vs 선 것) 그 사이가 없어 보입니다.
     *
     * 상한에 걸렸는지는 **상한과 직접** 견줍니다 — 그게 그 질문의 자입니다.
     * (`PropsInfo` 의 *"상한에 걸려 잘렸는지 이걸로만 압니다"* 라는 주석도
     *  그래서 정확하지 않습니다. 아래 검사가 그 자리를 대신합니다.)
     */
    const caps = await page.evaluate(() => window.__game.propCaps())
    const hitP = p.pillars >= caps.pillars
    const hitR = p.rubble >= caps.rubble
    console.log(
      `  자격 있는 칸 — 기둥 ${p.pillarSpots} · 잔해 ${p.rubbleSpots}` +
        `  (밀도로 걸러진 뒤 선 것: 기둥 ${p.pillars} · 잔해 ${p.rubble})\n` +
        `  상한 — 기둥 ${caps.pillars} · 잔해 ${caps.rubble}`,
    )
    check(
      !hitP && !hitR,
      '🏗 **지물이 상한에 걸리지 않았다** (걸리면 뒤쪽 구역이 «원래 빈 곳»으로 읽힙니다)',
      hitP || hitR
        ? `기둥 ${p.pillars}/${caps.pillars} · 잔해 ${p.rubble}/${caps.rubble} — 상한이 자르고 있습니다`
        : `기둥 ${p.pillars}/${caps.pillars} · 잔해 ${p.rubble}/${caps.rubble} — 성긴 것은 상한이 아니라 **밀도**의 결과입니다`,
    )

    /**
     * ② **볼 것이 하나도 없는 구역.** 이름과 한 줄 설명까지 붙여 놓고
     *    화면에는 아무것도 없는 곳 — 「이름만 있는 방」입니다.
     */
    const named = regions.map((r) => (typeof r === 'string' ? r : (r.name ?? r.label ?? '')))
    const rows = named
      .filter((n) => n)
      .map((n) => ({ n, c: p.byRegion[n] ?? 0 }))
      .sort((a, b) => a.c - b.c)
    console.log(
      '\n  구역별 지물 — ' + rows.map((r) => `${r.n} ${r.c}`).join(' · '),
    )
    const empty = rows.filter((r) => r.c === 0)
    check(
      rows.length > 0,
      '🚧 구역 이름과 장부의 이름이 맞물렸다 (아래 판정의 게이트)',
      `${rows.length}곳 대조`,
    )
    if (rows.length > 0) {
      check(
        empty.length === 0,
        '👁 **볼 것이 하나도 없는 구역이 없다** (이름과 설명이 붙은 곳이라면 화면에도 있어야 합니다)',
        empty.length ? `빈 곳 ${empty.length}: ${empty.map((r) => r.n).join(' · ')}` : `${rows.length}곳 모두 있음`,
      )
    }
  }

  /**
   * ── ⏱ **상한의 근거를 재 봅니다** ─────────────────────────────────
   *
   * `MAX_PILLARS`/`MAX_RUBBLE` 옆의 주석은 이렇게 적혀 있습니다:
   * *"GPU 없는 환경에서도 돌아가야 해서(20fps 언저리)"*. 즉 **이 컨테이너에
   * 맞춰 정한 값**입니다. 그런데 지물은 `InstancedMesh` 라 140개든 1400개든
   * **드로우콜은 하나**입니다 — 비용 구조가 주석이 가정한 것과 다릅니다.
   *
   * 그래서 «지물을 껐다 켰을 때 기계 속도가 움직이는가»를 잽니다. 이건
   * **상한을 올렸을 때의 비용을 재는 것이 아니라, 지금 있는 것의 값을
   * 재는 것**입니다 — 240개가 공짜면 상한의 근거가 흔들리고, 240개가
   * 비싸면 상한은 정당합니다.
   *
   * ⚠️ **시뮬/벽시계 비**로 잽니다(벤치의 「기계 속도」와 같은 자). 프레임률을
   *    직접 세면 이 컨테이너의 들쭉날쭉함이 그대로 들어옵니다.
   *
   * ⚠️ **같은 판에서 두 번 잽니다.** 따로 돌리면 기계의 부하 차이가 결과에
   *    섞입니다 — 이 저장소가 «재는 동안 기계를 빼앗으면 그 판은 표본이
   *    아니다»로 이미 데인 자리입니다.
   */
  const speed = await page.evaluate(async () => {
    const G = window.__game
    const run = async (seconds) => {
      const t0 = G.state().simElapsed
      const w0 = Date.now()
      while (G.state().simElapsed - t0 < seconds && Date.now() - w0 < 60000) {
        await new Promise((r) => setTimeout(r, 8))
      }
      return (G.state().simElapsed - t0) / ((Date.now() - w0) / 1000)
    }
    await run(2) // 예열 — 첫 몇 초는 셰이더 컴파일이 섞입니다
    G.showProps(true)
    const on = await run(6)
    G.showProps(false)
    const off = await run(6)
    G.showProps(true)
    return { on, off }
  })
  const gain = speed.on > 0 ? speed.off / speed.on : 0
  console.log(
    `\n  ⏱ 기계 속도 — 지물 켜짐 ${speed.on.toFixed(3)} vs 꺼짐 ${speed.off.toFixed(3)} 시뮬초/벽시계초` +
      ` (끄면 ${gain.toFixed(2)}배)\n` +
      `     ${
        gain >= 1.15
          ? '→ 지물이 **실제로 비쌉니다.** 상한의 근거가 섭니다.'
          : '→ 지물을 통째로 꺼도 **거의 안 빨라집니다.** ' +
            '상한(140/170)의 근거였던 «GPU 없는 환경» 은 이 240개에 대해서는 ' +
            '**성립하지 않습니다** — 인스턴싱이라 드로우콜이 하나이기 때문입니다.'
      }`,
  )

  await browser.close()
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  dev.kill()
}
