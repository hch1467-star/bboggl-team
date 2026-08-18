/**
 * 🖥 HUD 조각들이 서로 겹치지 않는가 — `npm run hud`
 *
 * ── 왜 생겼는가 ────────────────────────────────────────────────────
 * 보스전 스크린샷에 **테두리도 이름도 없는 빨간 줄** 하나가 떠 있었습니다.
 * 마크업을 열어 보니 보스 바에는 이름도, 페이즈 눈금도, 색까지 다
 * 있었습니다 — **스킬바 밑에 깔려 있었을 뿐**입니다:
 *
 *     bossBar  x 360..920 · y 568..604
 *     slots    x 444..837 · y 541..597    ← 이름이 통째로 그 안
 *
 * 코드는 멀쩡했고 **좌표만 틀렸습니다.** 타입검사도 `verify` 도 이런 것을
 * 못 잡습니다. 사람이 스크린샷을 들여다봐야만 보이는 종류인데, 화면은
 * 매번 안 보게 됩니다.
 *
 * ── 좌표가 아니라 **규칙**을 지킵니다 ──────────────────────────────
 * *"보스 바는 y 116 에 있어야 한다"* 는 검사는 다음에 배치를 바꾸는 날
 * 거짓말이 됩니다. 지켜야 하는 것은 **"HUD 조각은 서로 안 가린다"** 이고,
 * 그건 좌표를 몰라도 잴 수 있습니다.
 *
 * ⚠️ **패널 단위로 봅니다.** 바의 채움·글자·눈금은 일부러 포개서 만드는
 *    것이라 세면 안 됩니다 — 아래 `COLLECT` 주석에 실패한 첫 판이 있습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5254
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
 * 재는 화면 크기들. 하나만 보면 *"그 해상도에서만 안 겹친다"* 를 확인하는
 * 것이고, HUD 는 `min(560px, 76vw)` 처럼 화면 폭을 타는 값들을 씁니다.
 */
const SIZES = [
  { w: 1280, h: 720, name: '1280×720' },
  { w: 1600, h: 900, name: '1600×900' },
  { w: 1024, h: 640, name: '1024×640' },
]



try {
  const page = await browser.newPage({ viewport: { width: SIZES[0].w, height: SIZES[0].h } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  await page.evaluate(() => {
    window.__t = {
      runFor: async (s) => {
        const G = window.__game
        const t = G.state().elapsed + s
        const d = Date.now() + 60000
        while (G.state().elapsed < t && Date.now() < d) await new Promise((r) => setTimeout(r, 8))
      },
    }
  })

  console.log('\n🖥 HUD 겹침 검증 — 좌표가 아니라 **서로 안 가리는가**를 봅니다\n')

  /**
   * ── 무엇을 하나의 "조각"으로 볼 것인가 ──────────────────────────────
   *
   * ⚠️ 처음엔 **잎사귀**(자식 없는 요소)를 전부 모았습니다. 그랬더니 겹침이
   *    쏟아졌는데, 전부 **일부러 겹쳐 놓은 것**이었습니다:
   *
   *      hpGhost ↔ hpFill     체력바의 잔상과 채움 — 같은 트랙 위에 포갭니다
   *      hpFill  ↔ hpText     숫자는 바 위에 올라갑니다
   *      bossFill ↔ bossTicks 페이즈 눈금은 채움 위에 새깁니다
   *
   *    바(bar)라는 물건은 원래 겹쳐서 만듭니다. 지켜야 하는 규칙은
   *    *"아무것도 안 겹친다"* 가 아니라 **"서로 다른 패널끼리 안 가린다"**
   *    입니다. 제가 규칙을 너무 넓게 적었던 것입니다.
   *
   * 그래서 **패널 단위**로 봅니다 — `#hud` 의 직계, 그리고 위/아래 줄의
   * 직계. 그 안쪽(바의 채움·글자·눈금)은 한 패널의 부품이라 안 셉니다.
   * 담는 상자는 자식을 감싸므로 빼고, 화면을 통째로 덮는 것(저체력
   * 비네트)은 위젯이 아니라 효과라 뺍니다.
   */
  const panelsNow = () =>
    page.evaluate(() => {
      const hud = document.getElementById('hud')
      if (!hud) return []
      const cand = [...hud.querySelectorAll(':scope > *, :scope > * > *')]
      const out = []
      const area = window.innerWidth * window.innerHeight
      for (const e of cand) {
        const st = getComputedStyle(e)
        if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) continue
        const b = e.getBoundingClientRect()
        if (b.width < 4 || b.height < 4) continue
        if (b.width * b.height > area * 0.55) continue
        out.push({ el: e, id: e.id || e.className || e.tagName, x: b.x, y: b.y, w: b.width, h: b.height })
      }
      // 담는 상자(다른 조각을 품은 것)를 뺍니다 — 남는 것이 곧 패널입니다.
      const panels = out.filter((a) => !out.some((b) => b.el !== a.el && a.el.contains(b.el)))
      return panels.map((a) => ({
        id: String(a.id),
        x: Math.round(a.x),
        y: Math.round(a.y),
        w: Math.round(a.w),
        h: Math.round(a.h),
      }))
    })

  const overlapsOf = (rects) => {
    const bad = []
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oz = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        // 1px 스침은 테두리끼리 닿은 것이라 셈에 넣지 않습니다.
        if (ox > 1 && oz > 1) bad.push({ a: a.id, b: b.id, w: Math.round(ox), h: Math.round(oz) })
      }
    }
    return bad
  }

  /**
   * ---- 두 상황을 봅니다: 평소 · 보스전 ----
   *
   * 보스 바는 보스전에만 뜹니다. 평소 화면만 재면 정작 문제가 있던 자리를
   * 영영 안 보게 됩니다 — 실제로 그래서 못 잡고 있었습니다.
   */
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.w, height: size.h })
    await page.evaluate(async () => {
      await window.__t.runFor(0.4)
    })
    const idle = await panelsNow()
    const bossAt = await page.evaluate(async () => {
      const G = window.__game
      const boss = G.levelFoes().find((f) => f.kind === 'boss')
      G.teleportPlayer(boss.x - 6, boss.z)
      await window.__t.runFor(2.5)
      return document.getElementById('bossBar')?.style.display === 'block'
    })
    const fight = await panelsNow()
    const idleBad = overlapsOf(idle)
    const fightBad = overlapsOf(fight)
    console.log(
      `  [${size.name}] 평소 조각 ${idle.length}개 · 보스전 ${fight.length}개(보스 바 ${bossAt ? '떠 있음' : '안 뜸'})` +
        ` — 겹침 ${idleBad.length} / ${fightBad.length}`,
    )
    for (const o of [...idleBad, ...fightBad].slice(0, 4)) {
      console.log(`      ❗ ${o.a} ↔ ${o.b} — ${o.w}×${o.h}px 겹침`)
    }
    check(
      idle.length >= 5 && fight.length >= 5,
      `🚧 [${size.name}] HUD 조각을 실제로 읽었다 (비교의 게이트)`,
      `평소 ${idle.length}개 · 보스전 ${fight.length}개`,
    )
    check(
      bossAt,
      `🚧 [${size.name}] **보스 바가 실제로 떠 있는 상태**에서 쟀다 (안 뜨면 그 자리를 영영 못 봅니다)`,
      bossAt ? '떠 있음' : '안 뜸',
    )
    check(
      idleBad.length === 0 && fightBad.length === 0,
      `🖥 [${size.name}] **HUD 조각이 서로 안 가린다**`,
      idleBad.length + fightBad.length === 0
        ? '겹침 없음'
        : [...idleBad, ...fightBad].map((o) => `${o.a}↔${o.b}`).join(' · '),
    )
    // 다음 크기를 재기 전에 되돌립니다 — 보스전 상태가 남으면 "평소"가 평소가 아닙니다.
    await page.evaluate(() => window.__game.resetProgress())
    await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
    await page.evaluate(() => {
      window.__t = {
        runFor: async (s) => {
          const G = window.__game
          const t = G.state().elapsed + s
          const d = Date.now() + 60000
          while (G.state().elapsed < t && Date.now() < d) await new Promise((r) => setTimeout(r, 8))
        },
      }
    })
  }

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
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
