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

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4188
const VIEWPORT = { width: 1100, height: 690 }
const PREINSTALLED = ['/opt/pw-browsers/chromium']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

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
} finally {
  await browser.close()
  await server.close()
}
