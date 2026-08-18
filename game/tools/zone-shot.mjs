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
 *
 * ── ⚠️ 자리는 **게임에게 물어봅니다** (손으로 적지 않습니다) ──────────
 * 처음엔 좌표 다섯 개를 손으로 적어 뒀는데, 이름이 **틀려 있었습니다** —
 * `[64, 40, 'D-계단']` 은 실제로 「성벽 위」한복판이었습니다. 격자 칸과
 * 월드 좌표를 헷갈린 것입니다(월드 = 칸×2 − 87/71).
 *
 * 어디를 찍는지 이름이 틀린 스크린샷 도구는, 이 도구가 막으려던 바로 그
 * 실수(**안 보고 말하기**)를 더 그럴듯한 모습으로 되풀이하게 합니다.
 * 그래서 자리를 `regionList()` 에서 읽습니다 — 게임이 내주는 구역 이름과
 * 한가운데 월드 좌표입니다. 구역을 늘리거나 옮겨도 이 파일은 안 고쳐도
 * 되고, 새 구역이 **조용히 빠지지도** 않습니다.
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
const spots = await page.evaluate(() =>
  window.__game.regionList().map((r) => ({ name: r.name, x: r.x, z: r.z })),
)
// 스폰에서 걸어야 하는 순서대로 — 파일 이름 앞의 번호가 곧 진행 순서입니다.
/**
 * ⚠️ 꼬리 인자는 **대괄호 리터럴 하나**로 넘기고, 받는 쪽도 `([pts])` 로
 *    분해합니다. 이 저장소의 모든 도구가 그 모양인데, 이유가 있습니다 —
 *    `npm run guard` 는 파서가 아니라 괄호 세기라서, 꼬리 인자를 알아보는
 *    수단이 **대괄호**뿐입니다. 다른 모양으로 넘기면 그 꼬리를 화살표
 *    몸통으로 읽고 "브라우저 안에서 모듈 상수를 참조한다"고 잡습니다
 *    (제가 실제로 그렇게 잡혔습니다). 검사를 느슨하게 푸는 대신
 *    **집 모양에 맞춥니다.**
 */
const points = spots.map((s) => ({ x: s.x, z: s.z }))
const walk = await page.evaluate(([pts]) => {
  const p = window.__game.state().player
  return window.__game.distancesToward(p.x, p.z, pts)?.points ?? pts.map(() => 0)
}, [points])
spots.forEach((s, i) => (s.walk = walk[i] ?? 0))
spots.sort((a, b) => a.walk - b.walk)
let n = 0
for (const s of spots) {
  const tag = String(++n).padStart(2, '0')
  await page.evaluate(([x, z]) => { window.__game.teleportPlayer(x, z) }, [s.x, s.z])
  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shots', `zone-${tag}-${s.name}.png`) })
  console.log(`찍음 ${tag} ${s.name}  (스폰에서 ${Math.round(s.walk)}m · 월드 ${s.x},${s.z})`)
}
await browser.close()
await server.close()
