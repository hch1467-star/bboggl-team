/**
 * 존을 눈으로 보기 — `npm run shots`
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * 그래픽을 손보려다 **엉뚱한 그림을 보고 판단할 뻔했습니다.** 저장돼 있던
 * 스크린샷 중 눈에 띈 것이 `07-level-sample.png` 였는데, 그건 **견본
 * 레벨**이지 실제 존이 아닙니다. 그걸 보고 *"구역마다 색이 똑같다"* 는
 * 결론을 냈는데 — 진짜 존은 이미 11개 구역이 전부 다른 색조를 쓰고
 * 있었습니다. 하마터면 **있는 기능을 다시 만들** 뻔했습니다.
 *
 * (같은 라운드에 *"강화대 앞에서 무엇이 모자란지 화면이 안 알려 준다"* 도
 * 화면을 안 열어 보고 적었다가 틀렸습니다. 두 번 다 원인이 같습니다 —
 * **안 보고 말했습니다.**)
 *
 * 그래서 "실제로 플레이어가 보는 화면"을 **한 줄로** 띄울 수 있게 둡니다.
 * 계측기가 아무리 많아도, 그래픽은 결국 봐야 압니다.
 *
 * ⚠️ 판정하지 않습니다. 이 도구는 **찍기만** 합니다 — 그림을 보고 무엇을
 *    할지는 사람이 정합니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
const ROOT = '/home/user/bboggl-team/game'
const PORT = 5299
const server = await createServer({ root: ROOT, server: { port: PORT }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: ['/opt/pw-browsers/chromium'].find((p) => existsSync(p)),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1100, height: 690 } })
await page.goto(`http://localhost:${PORT}/?lowfx=1`)
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
const spots = [[10, 36, 'A-앞마당'], [30, 36, 'B-성문'], [50, 36, 'C-회랑'], [64, 40, 'D-계단'], [77, 40, 'E-성벽위']]
for (const [x, z, name] of spots) {
  await page.evaluate(([x, z]) => { window.__game.teleportPlayer(x, z) }, [x, z])
  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shots', `zone-${name}.png`) })
  console.log('찍음', name)
}
await browser.close()
await server.close()
