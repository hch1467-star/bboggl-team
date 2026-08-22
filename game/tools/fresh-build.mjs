/**
 * 🏗 **그림 도구는 `dist/` 를 찍습니다 — 그런데 아무도 안 지었습니다.**
 *
 * ── 어떻게 드러났는가 ─────────────────────────────────────────────
 * 금 간 벽을 넣고 `npm run hide` 로 그림을 찍었는데 **벽이 없었습니다.**
 * 벽을 자홍색으로 칠하고 6m 로 키워도 안 나왔습니다. 그런데 같은 페이지를
 * 개발 서버(`createServer`)로 띄우고 찍으니 **그대로 있었습니다.**
 *
 * 차이는 하나였습니다:
 *
 *     probe 류 — `createServer()`  → **소스**를 그때그때 읽습니다
 *     preview 류 — `preview()`     → **`dist/`** 를 읽습니다
 *
 * 그리고 이 저장소의 어느 그림 도구도 **짓지 않았습니다.** 즉 열 개의
 * 그림 도구가 전부 *"마지막으로 누가 `npm run build` 를 한 시점"* 의
 * 게임을 찍고 있었습니다. 화면에 보이는 것이 지금 코드라는 보장이
 * 없었던 것입니다.
 *
 * ⚠️ 이게 왜 큰가: 이 저장소는 **못 재는 것을 그림으로 판정**합니다.
 *    「가림벽이 길에서 보이는가」처럼 자로 못 재는 물음은 그림이
 *    마지막 심판입니다. 그 심판이 옛 빌드를 보고 있었다면, **그림으로
 *    내린 결론은 전부 다시 봐야 합니다.**
 *    (실제로 「가림벽 뒤 주머니」를 뺀 근거 ①이 그림이었습니다.
 *     그 결론이 옛 빌드였는지는 이제 알 수 없습니다.)
 *
 * ── 왜 「경고」가 아니라 「짓기」인가 ───────────────────────────────
 * *"낡았으면 빨간 글씨를 찍는다"* 로 두면, 급할 때 그 줄을 넘기고
 * 그림을 믿게 됩니다. 도구가 **거짓말을 할 수 없게** 만드는 편이 낫습니다.
 * 짓는 비용(수십 초)은 그림 한 장을 잘못 믿는 비용보다 훨씬 쌉니다.
 */
import { readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { build } from 'vite'

/** 폴더 아래에서 **가장 늦게 고쳐진 시각**(ms). 없으면 0. */
function newestMTime(dir) {
  if (!existsSync(dir)) return 0
  let newest = 0
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    const t = st.isDirectory() ? newestMTime(p) : st.mtimeMs
    if (t > newest) newest = t
  }
  return newest
}

/**
 * `dist/` 가 소스보다 낡았으면 **짓습니다.**
 *
 * @param root 게임 폴더(package.json 이 있는 곳)
 * @returns 실제로 지었으면 true
 */
export async function ensureFreshBuild(root) {
  const dist = path.join(root, 'dist')
  /**
   * 비교 대상에 `index.html` 도 넣습니다 — 소스만 보면 진입 문서를
   * 고친 날 이 검사가 조용히 통과합니다.
   */
  const indexHtml = path.join(root, 'index.html')
  const src = Math.max(
    newestMTime(path.join(root, 'src')),
    existsSync(indexHtml) ? statSync(indexHtml).mtimeMs : 0,
  )
  const built = newestMTime(dist)
  if (built > src) return false
  console.log(
    built === 0
      ? '  🏗 `dist/` 가 없습니다 — 짓습니다(이 도구는 소스가 아니라 빌드를 찍습니다).'
      : '  🏗 `dist/` 가 소스보다 낡았습니다 — 짓습니다(안 지으면 **옛 게임을 찍습니다**).',
  )
  const t0 = Date.now()
  await build({ root, logLevel: 'error' })
  console.log(`  🏗 빌드 완료 (${((Date.now() - t0) / 1000).toFixed(1)}초)`)
  return true
}
