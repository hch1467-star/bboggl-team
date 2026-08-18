/**
 * 🌑 높이가 화면에서 읽히는가 — `npm run depth`
 *
 * ── 왜 이 검사가 생겼는가 ──────────────────────────────────────────
 * 존 스크린샷을 훑다가 걸렸습니다. 「성벽마루 — **아래로 폐허가
 * 내려다보인다**」라는 안내가 떠 있는 화면에 **낙차가 하나도 안
 * 보였습니다.** 높은 곳과 낮은 곳이 그냥 *색이 다른 평평한 바닥* 두
 * 장이었습니다. 「오르는 계단」도 계단이 한 칸도 안 보였습니다.
 *
 * 이 존의 설계가 통째로 높이 위에 서 있습니다 — 성벽 위 · 함몰지 ·
 * 낭떠러지 · 사다리 · 낙하 피해. 그게 안 보이면 지도가 거짓말을 합니다.
 * 실제로 자동 플레이 장부에 `낙하 — 예고 0초 · 보인 0초` 가 있습니다.
 *
 * ── 무엇을 재는가 ──────────────────────────────────────────────────
 * 쿼터뷰에서 높이를 읽게 하는 것은 벽 자체가 아니라 **벽이 바닥에
 * 드리우는 그림자**입니다(디아블로·로스트아크·헤이디스가 전부 같습니다).
 * 그래서 **낮은 쪽 바닥**을 두 군데서 찍어 견줍니다:
 *
 *   · 벽 **발치**(경계에서 한 칸)
 *   · 같은 단의 **먼 곳**(경계에서 세 칸)
 *
 * 발치가 눈에 띄게 어두워야 "저기가 위다"가 읽힙니다.
 *
 * ── 🚧 게이트가 먼저입니다 ────────────────────────────────────────
 * 이 눈금은 **두 점의 밝기 차이**입니다. 그런데 이 게임의 바닥에는
 * 원래 밝기 차이가 있습니다 — 격자 체크무늬(±7%)와 구역 색조입니다.
 * 그래서 **낙차가 없는 평지에서 같은 방법으로 재서 0에 가까운지**를
 * 먼저 확인합니다. 그게 아니면 아래 숫자는 체크무늬를 잰 것입니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { decodePng, luminance } from './png.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5253
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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
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

  console.log('\n🌑 높이가 화면에서 읽히는가 — 벽이 아니라 **발치의 바닥**을 봅니다\n')

  /**
   * ---- 낙차 경계와 평지를 **게임에게 찾게 합니다** ----
   *
   * 좌표를 여기 적어 두면 지도를 손보는 날 이 검사가 없는 자리를 잽니다.
   */
  const spots = await page.evaluate(() => {
    const G = window.__game
    const info = G.terrainInfo()
    const cell = info.cellSize
    const rises = []
    const flats = []
    // 존을 성기게 훑습니다. 촘촘히 돌 이유가 없습니다 — 몇 자리면 충분합니다.
    for (let x = -60; x <= 70; x += cell) {
      for (let z = -60; z <= 60; z += cell) {
        const here = G.terrainLevelAt(x, z)
        if (here < 0) continue
        // 네 방향 중 **한 칸 옆이 더 높은** 자리 = 벽의 발치
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const up = G.terrainLevelAt(x + dx * cell, z + dz * cell)
          if (up <= here) continue
          /**
           * 반대쪽 **네 칸**이 먼 곳 표본입니다.
           *
           * ⚠️ **짝수 칸이라야 합니다.** 처음엔 세 칸이었고 게이트가 바로
           *    잡았습니다 — 평지에서도 두 점이 **11.1%** 나 달랐습니다.
           *    바닥의 체크무늬가 `(cx+cz) % 2` 로 ±7% 를 오가므로, 홀수
           *    칸을 건너뛰면 **반대 무늬**에 내려앉습니다. 1.07 대 0.93 =
           *    정확히 13%. 그림자를 재려던 눈금이 무늬를 재고 있었습니다.
           */
          /**
           * ⚠️ **칸의 한가운데를 찍습니다 — 꼭짓점이 아니라.**
           *
           * 그림자는 꼭짓점마다 다르게 칠해집니다(벽에 닿는 꼭짓점만 어둡게).
           * 그래서 격자점을 그대로 찍으면 **전부 어둡거나 전혀 안 어둡거나**
           * 둘 중 하나가 나옵니다. 실제로 첫 실행이 `71% · 1% · 68% · 0%` 로
           * 딱 번갈아 찍혔습니다. 반 칸씩 밀어 **칸의 평균**을 봅니다.
           */
          const nx2 = x - dx * cell * 0.5
          const nz2 = z - dz * cell * 0.5
          const fx = x - dx * cell * 4.5
          const fz = z - dz * cell * 4.5
          if (G.terrainLevelAt(fx, fz) !== here) continue
          let clean = true
          for (let k = 1; k <= 5; k++) {
            if (G.terrainLevelAt(x - dx * cell * k, z - dz * cell * k) !== here) clean = false
          }
          if (!clean) continue
          /**
           * ⚠️ **카메라 쪽으로 솟은 벽은 자기 발치를 가립니다.**
           *
           * 직교 투영에서 벽이 카메라 쪽에 있으면 그 벽면이 **바로 아래
           * 바닥을 덮습니다.** 그런 자리를 재면 그림자가 아니라 **벽면**을
           * 재게 되고(밝기 17 — 그림자보다 훨씬 어둡습니다), 그건 이 변화가
           * 만든 값이 아닙니다. 가려지지 않는 쪽만 씁니다.
           */
          const cam = G.cameraAxes()
          if (dx * cam.forwardX + dz * cam.forwardZ <= 0.2) continue
          // 🎨 **같은 구역 안에서만** 견줍니다 — 아래 게이트 주석 참고.
          if (G.regionAt(nx2, nz2) !== G.regionAt(fx, fz)) continue
          rises.push({ x: nx2, z: nz2, fx, fz, rise: up - here, level: here })
          break
        }
      }
    }
    // 평지 — 반경 8m 안에 단이 하나뿐인 자리
    for (let x = -60; x <= 70; x += cell) {
      for (let z = -60; z <= 60; z += cell) {
        const here = G.terrainLevelAt(x, z)
        if (here < 0) continue
        /**
         * ⚠️ **낙차 표본과 똑같은 넓이로** 평평한지 봅니다.
         *
         * 게이트가 재는 것과 본 검사가 재는 것의 **모양이 같아야** 게이트가
         * 뜻이 있습니다. 처음엔 ±5칸만 봤는데, 먼 표본(4.5칸)의 바로 뒤에
         * 벽이 서 있는 자리가 걸려 4곳 중 2곳이 어두웠습니다 — 게이트가
         * 잡음이 아니라 **다른 그림자**를 재고 있었던 것입니다.
         */
        let flat = true
        for (let dx = -8; dx <= 8 && flat; dx++) {
          for (let dz = -8; dz <= 8 && flat; dz++) {
            if (G.terrainLevelAt(x + dx * cell, z + dz * cell) !== here) flat = false
          }
        }
        if (!flat) continue
        const nx3 = x + cell * 0.5
        const fx3 = x - cell * 3.5
        /**
         * ⚠️ **같은 구역 안에서만** 두 점을 찍습니다.
         *
         * 처음엔 안 봤고 게이트가 평지에서 **14.9%** 를 냈습니다. 원인은
         * 구역 색조였습니다 — 이 게임은 구역마다 바닥의 **색온도**를
         * 바꾸고(노랑·파랑·보라), 색조는 밝기를 1로 정규화해 두었지만
         * 사람 눈의 **휘도**(R 0.21 · G 0.72 · B 0.07)는 채널마다 무게가
         * 달라서 그대로 남습니다. 8m 를 건너뛰면 구역이 바뀌고, 그러면
         * 그림자가 아니라 **색조**를 재게 됩니다.
         */
        if (G.regionAt(nx3, z) !== G.regionAt(fx3, z)) continue
        flats.push({ x: nx3, z, fx: fx3, fz: z, level: here })
      }
    }
    return { rises, flats, cell }
  })
  console.log(`  [찾음] 낙차 경계 ${spots.rises.length}곳 · 평지 ${spots.flats.length}곳`)
  check(
    spots.rises.length >= 5 && spots.flats.length >= 3,
    '🚧 존에서 **낙차와 평지를 둘 다** 찾았다 (비교의 게이트)',
    `낙차 ${spots.rises.length} · 평지 ${spots.flats.length}`,
  )

  /**
   * 한 자리를 재는 방법 — 플레이어를 그 옆에 세우고 한 장 찍은 뒤,
   * 두 월드 좌표의 **화면 픽셀**을 읽습니다.
   *
   * ⚠️ 적을 치웁니다. 몸이나 예고가 표본 위에 겹치면 바닥이 아니라
   *    **적을 재게 됩니다.**
   */
  const measure = async (s) => {
    const at = await page.evaluate(
      async ([p]) => {
        const G = window.__game
        G.clearEnemies()
        // 두 표본의 한가운데에 서면 둘 다 화면 복판에 옵니다.
        G.teleportPlayer((p.x + p.fx) / 2, (p.z + p.fz) / 2)
        await window.__t.runFor(0.6)
        return {
          near: G.screenPos(p.x, G.terrainInfo().heightStep * p.level, p.z),
          far: G.screenPos(p.fx, G.terrainInfo().heightStep * p.level, p.fz),
        }
      },
      [s],
    )
    if (!at.near || !at.far) return null
    const img = decodePng(await page.screenshot())
    // 한 점이 아니라 작은 사각형의 **중앙값**을 씁니다 — 체크무늬 한 칸이나
    // 격자선 하나에 결과가 끌려가지 않게.
    /**
     * 상자 크기 ±8px 의 근거: 이 카메라에서 1m 는 22px 남짓이라 한 칸(2m)이
     * **44px** 입니다. ±8px 면 칸 안에 확실히 들어가면서도(경계를 안 물고),
     * 픽셀 몇 개의 잡음은 지워집니다.
     */
    const sample = (sp) => {
      const vals = []
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const x = Math.round(sp.sx) + dx
          const y = Math.round(sp.sy) + dy
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
          const i = (y * img.width + x) * 4
          vals.push(luminance([img.data[i], img.data[i + 1], img.data[i + 2]]))
        }
      }
      if (vals.length === 0) return null
      vals.sort((a, b) => a - b)
      return vals[vals.length >> 1]
    }
    const near = sample(at.near)
    const far = sample(at.far)
    if (near === null || far === null) return null
    return { near, far, drop: far > 0 ? 1 - near / far : 0 }
  }

  /**
   * ---- 🚧 게이트: **평지에서는 차이가 없어야** 합니다 ----
   */
  const flatRows = []
  for (const s of spots.flats.slice(0, 4)) {
    const r = await measure(s)
    if (r) flatRows.push(r)
  }
  const flatDrop = flatRows.length
    ? flatRows.reduce((a, r) => a + Math.abs(r.drop), 0) / flatRows.length
    : -1
  console.log(
    `  [평지] ${flatRows.length}곳 — 발치쪽 ${flatRows.map((r) => r.near.toFixed(0)).join('·')} vs 먼쪽 ${flatRows
      .map((r) => r.far.toFixed(0))
      .join('·')} → 평균 차이 ${(flatDrop * 100).toFixed(1)}%`,
  )
  check(
    flatRows.length >= 3 && flatDrop >= 0 && flatDrop < 0.08,
    '🚧 **평지에서는 두 점의 밝기가 거의 같다** (아니면 아래 숫자는 체크무늬를 잰 것입니다)',
    `평균 차이 ${(flatDrop * 100).toFixed(1)}%`,
  )

  /**
   * ---- 🌑 **낙차의 발치는 어두운가** ----
   */
  const riseRows = []
  for (const s of spots.rises.slice(0, 8)) {
    const r = await measure(s)
    if (r) riseRows.push({ ...r, rise: s.rise })
  }
  for (const r of riseRows) {
    console.log(
      `    ${r.rise}단 낙차 — 발치 ${r.near.toFixed(0)} · 먼쪽 ${r.far.toFixed(0)} → **${(r.drop * 100).toFixed(0)}% 어두움**`,
    )
  }
  const riseDrop = riseRows.length
    ? riseRows.reduce((a, r) => a + r.drop, 0) / riseRows.length
    : -1
  check(
    riseRows.length >= 5,
    '🚧 낙차 경계를 여러 곳에서 실제로 읽었다 (한 자리는 우연일 수 있습니다)',
    `${riseRows.length}곳`,
  )
  /**
   * 문턱 12% 의 근거: 이 게임의 바닥에는 **격자 체크무늬 ±7%** 가 이미
   * 깔려 있습니다(terrain.ts `checker`). 그보다 확실히 커야 *"체크무늬가
   * 아니라 그림자"* 로 읽힙니다. 위 평지 게이트가 그 잡음의 실측치를
   * 같이 찍으므로, 두 숫자를 나란히 보면 이 문턱이 어디서 왔는지 보입니다.
   */
  check(
    riseRows.length >= 5 && riseDrop >= 0.12,
    '🌑 **낙차의 발치가 눈에 띄게 어둡다** (쿼터뷰에서 높이를 읽게 하는 유일한 단서)',
    `평균 ${(riseDrop * 100).toFixed(0)}% 어두움 (체크무늬 잡음 ±7%)`,
  )
  check(
    riseRows.length >= 5 && riseRows.filter((r) => r.drop >= 0.08).length >= riseRows.length - 1,
    '🌑 **거의 모든 낙차에서** 그림자가 잡힌다 (한두 곳만 되는 것은 지형의 우연입니다)',
    `${riseRows.filter((r) => r.drop >= 0.08).length}/${riseRows.length}곳`,
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
