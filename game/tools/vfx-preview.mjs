/**
 * 이펙트 격리 미리보기.
 *
 * 왜 필요한가: 전투 중 스크린샷에는 검격 궤적 · 타격 스파크 · 데미지 숫자 ·
 * 적 예고 부채꼴이 전부 겹쳐 있습니다. 뭔가 이상하게 보여도 **어느 것이 범인인지
 * 구분할 수가 없습니다.** 실제로 이 프로젝트에서 "화면에 회색 네모가 뜬다"는
 * 문제를 이 도구로 3번 만에 검격 궤적으로 특정했습니다.
 *
 * 실행: npm run vfx
 * 결과: tools/shots/vfx-{spark,damage,swing}.png
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4199
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
  const page = await browser.newPage({ viewport: { width: 700, height: 460 } })
  await page.goto(`http://127.0.0.1:${PORT}/?lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
  await sleep(1500)

  for (const kind of ['spark', 'damage', 'swing']) {
    await page.evaluate(() => window.__game.clearEnemies())
    await sleep(700)
    await page.evaluate((k) => window.__game.spawnVfx(k), kind)
    // 이펙트가 가장 잘 보이는 초반에 캡처합니다. 늦게 찍으면 이미 페이드아웃되어
    // "이펙트가 안 나온다"는 잘못된 결론을 내리게 됩니다.
    await sleep(25)
    await page.screenshot({ path: path.join(OUT, `vfx-${kind}.png`) })
    console.log(`  캡처: vfx-${kind}.png`)
  }
  console.log(`\n결과: ${OUT}`)
} finally {
  await browser.close()
  await server.close()
}
