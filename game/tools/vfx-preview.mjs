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
