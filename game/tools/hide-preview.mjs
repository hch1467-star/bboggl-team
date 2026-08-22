/**
 * 🌊 **가림벽이 정말 가리는가** — `npm run hide`
 *
 * ── 왜 캡처여야 하는가 ─────────────────────────────────────────────
 * 이 비밀은 **규칙이 아니라 그림**으로 성립합니다. 벽이 불투명하냐
 * 흐리냐는 `applyOcclusionFade` 가 정하고, 그 결과는 **화면의 픽셀에만**
 * 있습니다. 코드를 읽고 각도를 계산해서 *"안 흐려질 것이다"* 라고 적는
 * 것은 이 저장소가 여러 번 데인 바로 그것입니다 —
 * **「재기 전의 설명은 결론이 아니다」.**
 *
 * 실제로 색 대비를 계산으로 33.6 이라 믿었다가 화면에서 23.3 인 것을
 * `npm run contrast` 로 알아낸 적이 있습니다. 계산과 화면은 다릅니다.
 *
 * ── 무엇을 찍는가 ──────────────────────────────────────────────────
 * 같은 벽을 **두 자리에서** 찍습니다:
 *   ① 바깥 길 — 벽이 **불투명**해야 합니다(안이 안 보여야 비밀입니다)
 *   ② 주머니 안 — 벽이 **흐려져야** 합니다(안 그러면 내가 안 보입니다)
 *
 * 한 장만 찍으면 아무 말도 못 합니다. *"불투명하다"* 는 ②가 있어야
 * 비밀이 되고, *"흐리다"* 는 ①이 있어야 자랑이 됩니다.
 *
 * ⚠️ 이건 **판정 프로브가 아닙니다.** 통과/실패를 내지 않습니다 —
 *    사람이 볼 그림을 만들 뿐입니다. 숫자로 묻는 것은 `npm run map` 과
 *    `npm run urn` 이 이미 합니다.
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ensureFreshBuild } from './fresh-build.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4198
const VIEWPORT = { width: 900, height: 760 }
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
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('error:', e))
  await page.goto(`http://127.0.0.1:${PORT}/?lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 30000 })
  /**
   * ⚠️ **`clearEnemies()` 를 안 부릅니다** — 이름과 하는 일이 다릅니다.
   *
   * 그 함수는 *"플레이어와 보물만 빼고 **전부** 지운다"* 입니다. 그래서
   * 이 도구가 찍으려던 **금 간 벽과 항아리까지 같이 지워졌고**, 그림에
   * 벽이 안 나왔습니다. 한참을 「메시가 안 그려진다」로 헤맸습니다.
   *
   * 이름을 고치지 않는 이유: 그 함수를 **58개 도구가 부릅니다.** 항아리
   * 프로브·통 프로브는 *"싹 지우고 내가 놓은 것만 남는다"* 를 전제로
   * 세고 있어서, 여기서 예외를 하나 넣으면 그쪽 분모가 조용히 틀립니다.
   * 고쳐야 할 자리는 맞지만 **이 회차의 몫이 아닙니다.**
   *
   * 대신 얼립니다 — 적은 화면에 남되 움직이지 않으므로, 그림이 흔들리지
   * 않으면서 **길에서 보이는 것 그대로**를 찍게 됩니다.
   */
  await page.evaluate(() => window.__game.freezeEnemies(true))
  await sleep(600)

  console.log('\n🧱 금 간 벽 — 길에서 「저기 왜 뚫려 있지」가 성립하는가\n')

  /**
   * 칸→월드 변환에 쓰는 값은 **둘 다 밖에서 가져옵니다** — 격자 크기는
   * 레벨 파일에서, 한 칸의 크기는 게임에서. 여기에 `(cx-44+0.5)*2` 를
   * 적어 두면 격자를 바꾸는 날 이 도구만 옛 좌표를 씁니다(이 저장소가
   * 여러 번 데인 「베껴 적은 규칙」).
   */
  const level = JSON.parse(
    await readFile(path.join(ROOT, 'src', 'levels', 'broken-gate.json'), 'utf8'),
  )
  const cell = await page.evaluate(() => window.__game.terrainInfo().cellSize)
  const world = (cx, cz) => ({
    x: (cx - level.w / 2 + 0.5) * cell,
    z: (cz - level.h / 2 + 0.5) * cell,
  })

  /**
   * ── 🧱 **금 간 벽**으로 자리를 옮겼습니다 (cx 24 · cz 29~32) ─────────
   *
   * 예전에는 cx 50~56 · cz 22~23 의 「가림벽 뒤 주머니」를 찍었습니다.
   * 그 시도는 **뺐습니다** — 길에서 벽이 안 보여서 비밀이 성립하지
   * 않았고, 그 기록은 make-zone.mjs 에 남아 있습니다.
   *
   * 이번에 재도전한 자리는 「무너진 성문」 북쪽 벽을 **파낸** 방입니다.
   * 벽을 세우지 않고 파냈으므로 길을 막지 않고, 동선에서 2m 라
   * 화면에 들어옵니다(`npm run route` 의 🧱 줄).
   *
   * **네 자리**를 찍습니다. 물어보는 것이 저마다 다릅니다:
   *   · 멀리서   — 벽 덩어리가 **불투명**해야 합니다(가려 주는 것이 벽)
   *   · 길 위    — 벽면에 난 **2m 구멍이 보이는가**가 이 비밀의 전부
   *   · 입구 앞  — 「금 간 벽」이라는 것이 생김새로 읽히는가
   *   · 방 안    — 들어서면 저절로 열리는가(`applyOcclusionFade`)
   */
  const SPOTS = [
    ['a-far', 24, 38, '멀리서 — 성문 남쪽. 북쪽 벽이 불투명해야 합니다'],
    ['b-path', 24, 33, '길 위 — **벽면의 구멍이 보이는가**. 이 한 장이 이 비밀의 판정입니다'],
    ['c-mouth', 24, 32, '입구 바로 앞 — 금 간 벽이 「칠 수 있는 것」으로 보이는가'],
    ['d-inside', 24, 29, '방 안 — 들어서면 저절로 열려야 합니다'],
  ]
  for (const [name, cx, cz, why] of SPOTS) {
    const w = world(cx, cz)
    await page.evaluate(([x, z]) => window.__game.teleportPlayer(x, z), [w.x, w.z])
    // 카메라가 따라붙고 청크 투명도가 갱신될 때까지 몇 프레임 굴립니다.
    await page.evaluate(
      () =>
        new Promise((r) => {
          let n = 0
          const step = () => (++n < 12 ? requestAnimationFrame(step) : r())
          requestAnimationFrame(step)
        }),
    )
    await page.evaluate(() => window.__game.setPaused(true))
    const file = `19-wall-${name}.png`
    await page.screenshot({ path: path.join(OUT, file) })
    await page.evaluate(() => window.__game.setPaused(false))
    /**
     * ⚠️ **찍은 자리를 게임에게 물어서 같이 적습니다.** 순간이동이 막히거나
     *    지형에 밀려 다른 자리에 서면, 그림만 보고서는 *"왜 안 보이지"* 를
     *    영원히 못 풉니다 — 실제로 한 번 그렇게 헤맸습니다.
     */
    const now = await page.evaluate(() => {
      const p = window.__game.state().player
      return { x: Math.round(p.x), z: Math.round(p.z) }
    })
    const asked = `${Math.round(w.x)},${Math.round(w.z)}`
    const got = `${now.x},${now.z}`
    console.log(
      `  칸(${cx},${cz}) 월드(${asked}) → 실제(${got})${asked === got ? '' : '  ⚠️ **다른 자리에 섰습니다**'}` +
        `  ${file}   ${why}`,
    )
  }

  /**
   * ── 🧱💥 **두꺼운 벽도 같이 찍습니다** ────────────────────────────
   *
   * 이 벽은 오래 **동선에서 24m** 에 서 있었습니다(카메라 22m). 즉 길을
   * 걷는 사람은 한 번도 못 봤고, 「칼로는 안 된다」는 어휘를 아무도 안
   * 배우고 있었습니다. 자리를 옮겼으니(동선 14m) **정말 화면에 잡히는지**
   * 는 숫자가 아니라 그림이 답해야 합니다.
   *
   * ⚠️ 자리를 여기 안 박습니다. `walls()` 로 **게임에게 물어서** 찾습니다 —
   *    이 저장소가 자리 옮길 때마다 주석이 옛말로 남아 온 그 드리프트를
   *    도구 쪽에서도 막습니다.
   */
  const tough = await page.evaluate(() => window.__game.walls().find((v) => v.tough) ?? null)
  if (tough) {
    // 벽에서 길 쪽으로 물러난 세 자리 — 1.5m(코앞) · 5m · 14m(동선 거리).
    for (const back of [1.5, 5, 14]) {
      await page.evaluate(([x, z]) => window.__game.teleportPlayer(x, z), [tough.x + back, tough.z])
      await page.evaluate(
        () =>
          new Promise((r) => {
            let n = 0
            const step = () => (++n < 12 ? requestAnimationFrame(step) : r())
            requestAnimationFrame(step)
          }),
      )
      await page.evaluate(() => window.__game.setPaused(true))
      const file = `19-thick-${String(back).replace('.', '_')}m.png`
      await page.screenshot({ path: path.join(OUT, file) })
      await page.evaluate(() => window.__game.setPaused(false))
      const now = await page.evaluate(() => {
        const p = window.__game.state().player
        return { x: Math.round(p.x), z: Math.round(p.z) }
      })
      console.log(
        `  두꺼운 벽(${Math.round(tough.x)},${Math.round(tough.z)}) 에서 ${back}m 물러남 → 실제(${now.x},${now.z})  ${file}`,
      )
    }
    console.log('  ⚠️ 세 장 중 **한 장이라도 벽이 안 잡히면** 이 어휘는 여전히 아무도 못 배웁니다.')
  } else {
    console.log('  ⚠️ 두꺼운 벽을 못 찾았습니다 — 지도에서 빠졌는지 확인하십시오.')
  }

  console.log('\n  네 장을 나란히 보십시오. **b-path 에서 벽면의 구멍이 안 보이면 이 비밀은 실패입니다** — 지난번이 정확히 그랬습니다.')
  console.log('  ⚠️ 여기서는 판정하지 않습니다 — 사람이 보는 것이 이 도구의 전부입니다.\n')
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 — 조용히 exit 0 하는 계측기는
  //    통과하는 검사보다 나쁩니다.
  console.error('\n💥 캡처가 도중에 죽었습니다 — 그림을 믿지 마십시오\n' + (err?.stack ?? err))
  process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
}
