/**
 * 레벨 미리보기 — 에디터로 샘플 레벨을 만들고, 에디터 화면과 게임 화면을
 * 각각 스크린샷으로 남깁니다.
 *
 * 왜 별도 도구인가: 전체 검증(npm run verify)은 3분 넘게 걸립니다.
 * 지형 색이나 조명을 조정할 때는 "만들고 → 보고 → 고치고"를 빨리 돌려야 하는데,
 * 그때마다 전체 검증을 돌리면 손이 멈춥니다.
 *
 * 실행: npm run level
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ensureFreshBuild } from './fresh-build.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4188
const VIEWPORT = { width: 1100, height: 690 }
const PREINSTALLED = ['/opt/pw-browsers/chromium']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

// 🏗 **찍기 전에 짓습니다.** 이 도구는 소스가 아니라 `dist/` 를 찍습니다 —
//    안 지으면 옛 게임의 그림을 지금 것으로 믿게 됩니다(fresh-build.mjs).
await ensureFreshBuild(ROOT)
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
  // 에디터와 게임은 localStorage 로 레벨을 주고받으므로 컨텍스트를 공유해야 합니다.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })

  const ed = await context.newPage()
  ed.on('pageerror', (e) => console.error('editor error:', e))
  await ed.goto(`http://127.0.0.1:${PORT}/editor.html`, { waitUntil: 'load' })
  await ed.waitForFunction(() => window.__editor?.ready === true, { timeout: 20000 })

  const tool = (t) => ed.evaluate((x) => window.__editor.setTool(x), t)
  const brush = (n) => ed.evaluate((x) => window.__editor.setBrush(x), n)
  const apply = (cx, cz) => ed.evaluate(([a, b]) => window.__editor.applyAt(a, b), [cx, cz])

  // 작은 "와이드 리니어" 샘플: 주 통로 + 한 단 높은 전망대 + 넘을 수 없는 절벽 +
  // 절벽 뒤에 숨긴 보물(= 우회로로만 닿는 보상).
  await tool('raise')
  await brush(2)
  for (let cz = 22; cz <= 34; cz++) await apply(33, cz) // 한 단 능선
  await brush(1)
  for (let i = 0; i < 4; i++) for (let cz = 20; cz <= 36; cz++) await apply(37, cz) // 4단 절벽
  await brush(2)
  for (let cx = 24; cx <= 32; cx++) await apply(cx, 20) // 위쪽 우회로 벽

  await tool('treasure')
  for (const [cx, cz] of [[35, 24], [35, 30], [30, 24], [26, 32]]) await apply(cx, cz)
  await tool('grunt')
  for (const [cx, cz] of [[30, 27], [34, 33], [26, 24]]) await apply(cx, cz)
  await tool('boss')
  await apply(35, 27)
  await ed.evaluate(() => window.__editor.save())

  await sleep(600)
  await ed.screenshot({ path: path.join(OUT, '06-editor-sample.png') })
  console.log('  캡처: 06-editor-sample.png')

  const lv = await context.newPage()
  lv.on('pageerror', (e) => console.error('game error:', e))
  await lv.goto(`http://127.0.0.1:${PORT}/?level=storage&lowfx=1`, { waitUntil: 'load' })
  await lv.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
  await sleep(2600)
  await lv.screenshot({ path: path.join(OUT, '07-level-sample.png') })
  console.log('  캡처: 07-level-sample.png')

  console.log('상태:', JSON.stringify(await lv.evaluate(() => window.__game.state()), null, 0).slice(0, 400))
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
  process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
}
