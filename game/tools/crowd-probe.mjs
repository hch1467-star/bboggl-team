/**
 * 다대일 전투 부하 측정.
 *
 * 플레이 테스트 피드백: **"걸어서는 피해지는데 여러 명이 겹쳤을 때 피하기가 쉽지 않다."**
 *
 * 이걸 "회피를 유하게 할까 / 범위를 줄일까"로 바로 넘어가면 안 됩니다.
 * 둘 다 **개별 공격**을 건드리는 처방인데, 문제는 개별 공격이 아니라
 * **동시성**일 수 있기 때문입니다. 셋이 동시에 걸면 각자가 아무리 작아도
 * 도망칠 방향의 합집합이 사라집니다 — 그때는 크기를 줄여도 안 풀립니다.
 *
 * 그래서 먼저 잽니다: 잡몹 무리 한가운데에서 **동시에 몇 개의 예고가 뜨는가.**
 *
 * 실행: npm run crowd
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 4199
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = await preview({
  root: ROOT,
  preview: { port: PORT, strictPort: true, host: '127.0.0.1' },
  logLevel: 'error',
})
const browser = await chromium.launch({
  executablePath: ['/opt/pw-browsers/chromium'].find((p) => existsSync(p)),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('error:', e))
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })

  /** 플레이어를 둘러싸고 잡몹 5마리를 세웁니다. 문제가 되는 상황을 그대로 재현합니다. */
  const setup = async () => {
    await page.evaluate(() => {
      window.__game.reset()
    })
    await sleep(500)
    await page.evaluate(() => {
      window.__game.clearEnemies()
      const n = 5
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        window.__game.spawnTestEnemy(Math.sin(a) * 3.4, Math.cos(a) * 3.4)
      }
    })
    await sleep(900)
  }

  /**
   * @param walk 계속 걸어서 빠져나가려 시도할지
   * 두 조건을 **같은 배치**로 재는 것이 핵심입니다. 가만히 서 있을 때와
   * 걸을 때의 차이가 곧 "플레이어의 대응이 결과를 바꾸는가"에 대한 답입니다.
   * 그 차이가 없으면 그 전투는 실력이 개입할 여지가 없다는 뜻입니다.
   */
  const trial = async (walk, seconds = 20) => {
    await setup()
    const hist = new Map()
    let maxTele = 0
    let maxWide = 0
    if (walk) {
      await page.evaluate(() => {
        window.__game.press('KeyD')
        window.__game.press('KeyS')
      })
    }
    const t0 = Date.now()
    while (Date.now() - t0 < seconds * 1000) {
      const st = await page.evaluate(() => window.__game.state())
      hist.set(st.telegraphing, (hist.get(st.telegraphing) ?? 0) + 1)
      maxTele = Math.max(maxTele, st.telegraphing)
      maxWide = Math.max(maxWide, st.wideTelegraphs)
      if (st.player.hp <= 0) break
      await sleep(70)
    }
    if (walk) {
      await page.evaluate(() => {
        window.__game.release('KeyD')
        window.__game.release('KeyS')
      })
    }
    const st = await page.evaluate(() => window.__game.state())
    return { hist, maxTele, maxWide, hp: st.player.hp }
  }

  const still = await trial(false)
  const total = [...still.hist.values()].reduce((a, b) => a + b, 0)
  console.log('동시 예고 개수 분포 (20초, 잡몹 5마리에 포위)')
  for (const k of [...still.hist.keys()].sort((a, b) => a - b)) {
    const pct = ((still.hist.get(k) / total) * 100).toFixed(1)
    console.log(`  ${k}개 : ${pct.padStart(5)}%  ${'█'.repeat(Math.round(pct / 2))}`)
  }
  console.log(`  최대 동시 예고 : ${still.maxTele}개`)
  console.log(`  최대 동시 광역 : ${still.maxWide}개`)
  console.log('')
  const moving = await trial(true)
  console.log('대응이 결과를 바꾸는가 (20초 뒤 남은 체력)')
  console.log(`  가만히 서 있음 : ${still.hp} / 100`)
  console.log(`  계속 걸어서 이탈 : ${moving.hp} / 100`)
} finally {
  await browser.close()
  await server.close()
}
