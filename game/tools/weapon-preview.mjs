/**
 * 무기 비교 미리보기.
 *
 * 플레이 테스트 피드백: **"무기 차이가 잘 못 느껴져. 모션이랑 공격범위 표시가 잘못된 것 같아."**
 *
 * 이 도구는 그 한 문장에만 답합니다. 무기 3종을 같은 자리·같은 타이밍에 세워
 *   (1) 들고 있는 모양(실루엣)
 *   (2) 휘두르는 순간의 궤적(초승달)  ← 무기마다 각도와 사거리가 달라야 합니다
 * 을 나란히 찍습니다. 셋을 겹쳐 보면 "달라 보이는가"가 즉시 판정됩니다.
 *
 * 왜 자동 검증으로 안 되는가: "3타 콤보다 / 사거리가 3.1m다"는 숫자로 통과하지만,
 * **화면에서 똑같아 보이는 것**은 숫자로 안 잡힙니다. 실제로 첫 판에서
 * 초승달 지오메트리가 137° 하나로 고정돼 세 무기가 전부 같은 모양이었는데,
 * 로직 테스트는 전부 통과했습니다.
 *
 * 실행: npm run weapons
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4193
const VIEWPORT = { width: 760, height: 620 }
/** 플레이어(화면 중앙)를 감싸는 잘라내기 영역. 무기와 궤적만 크게 봅니다. */
const CLIP = { x: 268, y: 232, width: 300, height: 205 }
const PREINSTALLED = ['/opt/pw-browsers/chromium']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

const WEAPONS = [
  { key: 'Digit1', id: 'longsword', label: '롱소드' },
  { key: 'Digit2', id: 'greatsword', label: '대검' },
  { key: 'Digit3', id: 'daggers', label: '쌍단검' },
]

const server = await preview({
  root: ROOT,
  preview: { port: PORT, strictPort: true, host: '127.0.0.1' },
  logLevel: 'error',
})
const browser = await chromium.launch({
  executablePath: PREINSTALLED.find((p) => existsSync(p)),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  // 전투 시험장(arena)으로 엽니다. 지형이 없어 무기 실루엣만 깨끗하게 보입니다.
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('error:', e))
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
  await page.evaluate(() => window.__game.clearEnemies())
  await sleep(900)

  const tap = async (code, hold = 60) => {
    await page.evaluate((c) => window.__game.press(c), code)
    await sleep(hold)
    await page.evaluate((c) => window.__game.release(c), code)
  }

  for (const w of WEAPONS) {
    // 시험장은 웨이브를 계속 내보냅니다. 무기 실루엣만 봐야 하므로 매번 비웁니다.
    await page.evaluate(() => window.__game.clearEnemies())
    await tap(w.key)
    await page.evaluate(() => window.__game.aimAtWorld(6, 0)) // 항상 +X를 겨눔
    // 웨이브 배너가 플레이어를 정면으로 가립니다. 배너의 1.6초는 **시뮬레이션 시간**이라
    // 소프트웨어 렌더링(실시간의 1/3 속도)에서는 벽시계로 5초 가까이 걸립니다.
    // 그래서 시간이 아니라 **배너가 실제로 사라진 것**을 기다립니다.
    await page
      .waitForFunction(() => !document.getElementById('banner')?.classList.contains('show'), {
        timeout: 15000,
        polling: 50,
      })
      .catch(() => console.warn('    (경고: 배너가 안 사라졌습니다)'))
    await sleep(250)

    // 전체 화면은 무기가 화면의 3%뿐이라 비교가 안 됩니다. 플레이어 주변만 잘라
    // 크게 봐야 "달라 보이는가"를 판정할 수 있습니다.
    const idle = `13-weapon-${w.id}-idle.png`
    await page.screenshot({ path: path.join(OUT, idle), clip: CLIP })

    // 좌클릭 1타.
    //
    // **벽시계로 기다리면 안 됩니다.** 소프트웨어 렌더링에서는 시뮬레이션이
    // 실제 시간의 1/3 속도로 도는 데다, 무기마다 선행동작이 0.07~0.26초로
    // 세 배 넘게 차이납니다. 실제로 고정 대기(150ms)로 찍었더니 롱소드는
    // 판정 순간이, 대검은 아직 칼을 들어 올리는 중이 찍혀 비교가 안 됐습니다.
    // 그래서 **판정(active) 단계로 들어간 프레임을 직접 기다립니다.**
    // (a) 선행동작 — 바닥에 뜨는 **사거리 예고**를 확인합니다.
    // 무기마다 1.9m / 3.1m / 2.3m 로 다르므로, 이 도형의 크기 차이가
    // 곧 "무기를 바꾸면 닿는 거리가 달라진다"는 설명입니다.
    const wound = await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.__game.press('Mouse0')
          window.__game.release('Mouse0')
          let tries = 0
          const step = () => {
            const st = window.__game.state().player
            if (st.state === 1 && st.phase === 0) {
              window.__game.setPaused(true)
              resolve(true)
            } else if (++tries > 240) resolve(false)
            else requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }),
    )
    const windupShot = `17-weapon-${w.id}-range.png`
    await page.screenshot({ path: path.join(OUT, windupShot), clip: CLIP })
    await page.evaluate(() => window.__game.setPaused(false))
    if (!wound) console.warn(`    (경고: ${w.label} 선행동작을 못 잡았습니다)`)
    await sleep(1400) // 이 콤보가 끝나고 콤보 카운터가 돌아올 때까지

    //
    // (b) 판정 — 궤적은 0.19초만 살아 있습니다. 브라우저 **밖에서** 폴링하면
    // CDP 왕복(수십 ms) 때문에 매번 놓칩니다 — 실제로 롱소드는 궤적이 통째로
    // 빠진 사진이 나왔습니다. 그래서 판정을 **페이지 안**에서 하고,
    // 궤적이 뜬 그 프레임에 화면을 멈춥니다.
    const hit = await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.__game.press('Mouse0')
          window.__game.release('Mouse0')
          let tries = 0
          const step = () => {
            if (window.__game.swingVisible()) {
              window.__game.setPaused(true)
              resolve(true)
            } else if (++tries > 240) resolve(false)
            else requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }),
    )

    const swing = `14-weapon-${w.id}-swing.png`
    await page.screenshot({ path: path.join(OUT, swing), clip: CLIP })
    await page.evaluate(() => window.__game.setPaused(false))
    if (!hit) console.warn(`    (경고: ${w.label} 궤적을 못 잡았습니다)`)

    console.log(`  ${w.label.padEnd(4)} → ${idle} / ${windupShot} / ${swing}`)
    await sleep(1200) // 후딜 + 콤보 리셋
  }
} finally {
  await browser.close()
  await server.close()
}
