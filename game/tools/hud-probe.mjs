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
    /**
     * ── 🎬 **패널이 뜨는 상황을 하나씩 만들어 봅니다** ──────────────────
     *
     * ⚠️ 첫 판은 「평소」와 「보스전」 둘만 봤고 **10/10 초록**이었습니다.
     *    그런데 시작 화면 스크린샷을 보니 **화톳불 안내가 스킬바에 잘려**
     *    있었습니다. 그 패널은 화톳불 앞에서만 뜨는데, 프로브가 그 상황을
     *    한 번도 안 만들었던 것입니다.
     *
     *    HUD 의 조각은 **대부분 조건부로 뜹니다.** 안 띄워 놓고 "안 겹친다"
     *    를 확인하는 것은 **없는 것을 재는 것**입니다. 이 저장소가 계속
     *    적어 온 그대로 — 못 잰 것은 통과가 아닙니다.
     */
    const states = [
      { name: '평소', go: async () => {} },
      {
        name: '화톳불 앞',
        go: async () => {
          const G = window.__game
          // 자리는 게임에게 묻습니다 — 좌표를 여기 적으면 지도를 손보는 날
          // 이 상황이 조용히 안 만들어지고, 검사는 초록인 채로 남습니다.
          const f = G.nearestBonfire()
          if (f) G.teleportPlayer(f.x, f.z)
          await window.__t.runFor(1.2)
        },
      },
      {
        name: '모루 앞',
        go: async () => {
          const G = window.__game
          const a = G.anvils()[0]
          G.teleportPlayer(a.x, a.z)
          await window.__t.runFor(1.2)
        },
      },
      {
        name: '보스전',
        go: async () => {
          const G = window.__game
          const b = G.levelFoes().find((f) => f.kind === 'boss')
          G.teleportPlayer(b.x - 6, b.z)
          await window.__t.runFor(2.5)
        },
      },
    ]
    const seen = []
    for (const st of states) {
      await page.evaluate(st.go)
      const panels = await panelsNow()
      seen.push({ name: st.name, panels, bad: overlapsOf(panels) })
    }
    console.log(
      `  [${size.name}] ${seen.map((r) => `${r.name} ${r.panels.length}개(겹침 ${r.bad.length})`).join(' · ')}`,
    )
    for (const r of seen) {
      for (const o of r.bad.slice(0, 3)) {
        console.log(`      ❗ [${r.name}] ${o.a} ↔ ${o.b} — ${o.w}×${o.h}px 겹침`)
      }
    }
    /**
     * 🚧 **패널이 실제로 늘어났는지** 봅니다. 조건부 패널이 안 떴는데
     *    "안 겹친다"가 나오면 그건 초록이 아니라 **빈 화면**입니다.
     */
    const idleCount = seen[0].panels.length
    const grew = seen.slice(1).filter((r) => r.panels.length > idleCount).length
    check(
      seen.every((r) => r.panels.length >= 4) && grew >= 2,
      `🚧 [${size.name}] **상황마다 패널이 실제로 늘었다** (안 띄워 놓고 통과하지 않게)`,
      seen.map((r) => `${r.name} ${r.panels.length}`).join(' · '),
    )
    const allBad = seen.flatMap((r) => r.bad.map((o) => ({ ...o, at: r.name })))
    check(
      allBad.length === 0,
      `🖥 [${size.name}] **HUD 조각이 서로 안 가린다**`,
      allBad.length === 0 ? '겹침 없음' : allBad.map((o) => `[${o.at}] ${o.a}↔${o.b}`).join(' · '),
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

  /**
   * ── 🔢 **데미지 숫자끼리도 HUD 다.** ─────────────────────────────────
   *
   * 위 검사는 DOM 패널만 봅니다. 그런데 보스 처형 스크린샷에서 「12」와
   * 「27」이 **완전히 포개져** 있었습니다 — 겹침이 DOM 바깥에서 일어난
   * 것입니다. 같은 규칙(*"조각은 서로 안 가린다"*)이 여기에도 걸립니다.
   *
   * 왜 흔한 일인가: 롱소드 콤보는 0.15 · 0.40 · 0.67초에 꽂히고 숫자 수명은
   * 0.75초입니다. **콤보를 넣을 때마다** 한 적 위에 세 숫자가 동시에 뜹니다.
   * 즉 가장 잘 되는 순간의 피드백이 가장 안 읽혔습니다.
   *
   * 고정 스텝(`step`)으로 돌립니다 — 이 검사는 *"운 좋게 안 겹친 판"* 이
   * 아니라 **같은 판을 다시 재도 같은 답**이 나와야 합니다.
   */
  await page.evaluate(() => window.__game.resetProgress())
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  const combo = await page.evaluate(() => {
    const G = window.__game
    G.setPaused(true)
    /**
     * 🧪 **실험대로 세웁니다** — 레벨에 놓인 보스를 찾아가는 대신 빈 자리에
     * 새로 세웁니다(`npm run track` 과 같은 방식). 레벨의 보스를 쓰면
     * 조우 연출이 시작됐는지에 따라 개체 번호를 못 잡는 판이 생기고,
     * 그러면 아래 살려 두기가 조용히 안 걸립니다.
     */
    // ⚠️ **플레이어가 서 있는 자리 앞**에 세웁니다. (0,0) 에 세우고 거기로
    //    순간이동시켰더니 판마다 결과가 87프레임 ↔ 2프레임으로 튀었습니다 —
    //    그 좌표가 이 존에서 바닥인지 허공인지 실험대가 모르기 때문입니다.
    //    발밑이 확실한 자리는 **지금 서 있는 자리**뿐입니다.
    G.clearEnemies()
    const me0 = G.state().player
    const boss = G.spawnBoss(me0.x, me0.z + 1.6)
    G.step(30, 1 / 60, true)
    /**
     * 🩸 **둘 다 살려 둡니다.** 코앞에서 240프레임을 때리는 동안 보스는
     * 가만히 있지 않습니다. 첫 판에 87프레임이 나왔다가 다음 판에 2프레임이
     * 나온 이유가 이것이었습니다 — **한쪽이 도중에 죽으면** 공격이 안 나가고
     * 숫자도 안 뜹니다. 그러면 "안 겹쳤다"가 아니라 **"안 떴다"** 인데 숫자만
     * 보면 구분이 안 됩니다. (`npm run pace` · `npm run track` 이 똑같은
     * 함정에 이미 걸렸던 자리입니다.)
     */
    const me = G.playerEntity()
    const keepAlive = () => {
      G.setHp(me, 100)
      G.setHp(boss, 400)
    }
    const frames = []
    // 📋 **왜 안 떴는지**를 같이 들고 옵니다. 숫자가 안 뜨는 판이 나왔을 때
    //    "겹칠 일이 없었다"인지 "때리질 못했다"인지 여기서 갈립니다.
    const why = { swung: 0, spawned: 0, dead: 0, minStamina: 999 }
    for (let i = 0; i < 240; i++) {
      keepAlive()
      G.press('Mouse0')
      G.release('Mouse0')
      G.step(1, 1 / 60)
      const st = G.state().player
      // 1=Attack · 4=Dead (core/components.ts ActorState)
      if (st.state === 1) why.swung++
      if (st.state === 4) why.dead++
      why.minStamina = Math.min(why.minStamina, Math.round(st.stamina ?? 999))
      const boxes = G.damageBoxes()
      why.spawned = Math.max(why.spawned, boxes.length)
      if (boxes.length >= 2) frames.push(boxes)
    }
    return { frames, why }
  })
  const { frames: comboFrames, why } = combo
  /**
   * 두 글자 상자가 겹친 넓이가 **작은 쪽의 1/3** 을 넘으면 못 읽는 것으로 봅니다.
   *
   * 0% 로 두지 않는 이유: 상자는 글자의 바깥 테두리라 자릿수 사이 여백까지
   * 포함합니다. 모서리가 몇 픽셀 스치는 것은 눈에 안 걸립니다. 반대로 1/3 을
   * 넘으면 한쪽 숫자의 **자릿수 하나가 통째로** 가려집니다 — 그때부터
   * "37"이 "3"으로 읽히기 시작하고, 그건 피드백이 아니라 오보입니다.
   */
  const BURY = 1 / 3
  let worst = 0
  let worstAt = ''
  for (const boxes of comboFrames) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const ox = Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2)
        const oy = Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2)
        if (ox <= 0 || oy <= 0) continue
        const ratio = (ox * oy) / Math.min(a.w * a.h, b.w * b.h)
        if (ratio > worst) {
          worst = ratio
          // 겹친 넓이만 적으면 *"왜 겹쳤는지"* 를 알 수 없습니다. 두 상자의
          // 자리와 크기를 같이 남겨야 **위로 안 밀린 건지, 밀렸는데 모자란
          // 건지**가 보입니다.
          const one = (n) =>
            `화면(${Math.round(n.cx)},${Math.round(n.cy)}) ${Math.round(n.w)}×${Math.round(n.h)}px` +
            ` · 월드높이 ${n.wy.toFixed(2)} · 가로 ${n.lateral.toFixed(2)} · 나이 ${n.age.toFixed(2)}초`
          worstAt = `${Math.round(ox)}×${Math.round(oy)}px 겹침\n      A ${one(a)}\n      B ${one(b)}`
        }
      }
    }
  }
  const most = comboFrames.reduce((m, f) => Math.max(m, f.length), 0)
  console.log(
    `  [숫자] 두 개 이상 떠 있던 프레임 ${comboFrames.length} · 한 화면 최다 ${most}개 · 최악 겹침 ${(worst * 100).toFixed(0)}%` +
      `\n         (휘두른 프레임 ${why.swung} · 죽어 있던 프레임 ${why.dead} · 최저 스태미나 ${why.minStamina})`,
  )
  // 🚧 **재기 전에 잴 것이 있었는지**부터 봅니다. 숫자가 한 번도 겹칠 기회가
  //    없었으면 아래 초록은 "안 겹쳤다"가 아니라 **"안 떴다"** 입니다.
  check(
    comboFrames.length >= 30 && most >= 3,
    '🚧 콤보 중에 숫자가 **실제로 여러 개 동시에** 떴다 (빈 화면을 재고 통과하지 않게)',
    `겹칠 기회 ${comboFrames.length}프레임 · 최다 ${most}개`,
  )
  check(
    comboFrames.length >= 30 && most >= 3 && worst < BURY,
    '🔢 **콤보 숫자끼리 서로 안 묻힌다** (가장 잘 되는 순간의 피드백이 가장 안 읽히지 않게)',
    `최악 ${(worst * 100).toFixed(0)}% (문턱 ${(BURY * 100).toFixed(0)}%)${worst > 0 ? ` · ${worstAt}` : ''}`,
  )

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
