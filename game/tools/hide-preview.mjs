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
   * ── 🚶 **동선 위에서 찍습니다 — 「걸어가면서 보이는가」** ─────────────
   *
   * ── 왜 자리를 바꿨는가 (지난 회차의 실수) ────────────────────────
   * 처음에는 벽에서 **+x 로 3·8·14m 물러난** 자리에서 찍었습니다. 그
   * 그림으로 *"14m 에서는 화면 가장자리"* 라는 결론을 낼 뻔했는데,
   * 그건 **제가 고른 한 방향**일 뿐입니다. 카메라는 yaw 45° 로 고정이라
   * 무엇이 화면 어디에 오는지는 **플레이어가 어느 쪽에 서 있는가**로
   * 정해집니다 — 서쪽에 두면 좌상단 구석, 북쪽에 두면 화면 한가운데.
   *
   * 물어야 하는 것은 *"어느 방향에서 보이는가"* 가 아니라
   * **"게임이 안내하는 길을 걸을 때 보이는가"** 입니다. 그래서 자리를
   * 짓지 않고 **동선에서 가져옵니다.**
   *
   * ── 세 자리를 찍습니다 ───────────────────────────────────────────
   *   · 다가가며 — 가장 가까운 걸음보다 **16m 앞**
   *   · 다가가며 — **8m 앞**
   *   · 가장 가까운 걸음 — 이 판이 주는 **최선의 순간**
   * 최선의 순간에도 안 보이면 그 비밀은 없는 것과 같습니다.
   *
   * ⚠️ 자리를 여기 안 박습니다. 벽은 `walls()` 로, 「떨어뜨릴 보물」의
   *    길 위 통은 통 목록에서 **게임에게 물어서** 찾습니다.
   */
  const trail = await page.evaluate(async () => {
    const G = window.__game
    const nap = () => new Promise((r) => setTimeout(r, 8))
    G.reset()
    await nap()
    G.freezeEnemies(true)
    await nap()
    const out = []
    let guard = 0
    while (guard++ < 4000) {
      const obj = G.objective()
      if (!obj) break
      const p = G.state().player
      out.push({ x: p.x, z: p.z })
      if (obj.walkDist <= 1.5) {
        G.teleportPlayer(obj.x, obj.z)
        await nap()
        const next = G.objective()
        if (!next || (Math.abs(next.x - obj.x) < 0.01 && Math.abs(next.z - obj.z) < 0.01)) break
        continue
      }
      const step = G.pathStep(obj.x, obj.z)
      if (!step) break
      G.teleportPlayer(step.x, step.z)
      await nap()
    }
    return out
  })
  await page.evaluate(() => window.__game.freezeEnemies(true))

  const secrets = await page.evaluate(() => {
    const G = window.__game
    const info = G.barrelInfo()
    const out = G.walls().map((w) => ({
      name: w.tough ? 'thick' : 'cracked',
      label: w.tough ? '두꺼운 벽 (칼로는 안 됨)' : '금 간 벽 (치면 열림)',
      x: w.x,
      z: w.z,
    }))
    // 🎁💥 떨어뜨릴 보물의 **길 위 통** — 플레이어가 실제로 쳐야 하는 것.
    const stranded = G.treasurePositions().filter(
      (t) =>
        !t.taken &&
        !G.walkableFromPlayer(t.x, t.z) &&
        info.barrels.some((b) => Math.hypot(b.x - t.x, b.z - t.z) <= info.blast),
    )
    for (const t of stranded) {
      const A = info.barrels
        .map((b) => ({ b, d: Math.hypot(b.x - t.x, b.z - t.z) }))
        .sort((p, q) => p.d - q.d)[0]
      const B = info.barrels
        .filter((b) => b.entity !== A.b.entity && G.walkableFromPlayer(b.x, b.z))
        .map((b) => ({ b, d: Math.hypot(b.x - A.b.x, b.z - A.b.z) }))
        .sort((p, q) => p.d - q.d)[0]
      if (B) out.push({ name: 'drop', label: '선반 위 보물의 길 위 통', x: B.b.x, z: B.b.z })
    }
    /**
     * 🕯 **그늘 벽감** — 네 번째 비밀. 여기서 그림으로 봐야 하는 것이
     * 앞의 셋과 다릅니다:
     *
     *   금 간 벽·두꺼운 벽·선반 통 — *"길에서 **보이는가**"*
     *   그늘 벽감                — *"길에서 **무엇이 보이는가**"*
     *
     * 「가려진다」는 것은 `npm run secret` 이 높이맵으로 이미 재고
     * 있습니다. 그림이 답해야 하는 것은 **단서가 남아 있는가** 입니다 —
     * 빛기둥이 보이면 *"저기 뭔가 있는데 어떻게 들어가지"* 가 되고,
     * 아무것도 안 보이면 그건 탐험이 아니라 **픽셀 찾기**입니다.
     * 그 판단은 숫자가 아니라 **눈**이 해야 해서 여기 넣습니다.
     */
    for (const t of G.treasurePositions()) {
      if (!t.taken && t.secret) out.push({ name: 'shade', label: '그늘 벽감 (빛기둥만 보임)', x: t.x, z: t.z })
    }
    return out
  })

  console.log('\n🚶 동선 위에서 — 걸어가면서 세 비밀이 보이는가\n')
  for (const sec of secrets) {
    /**
     * ── 🎯 **「가장 가까운 걸음」이 아니라 「화면에 가장 잘 담기는 걸음」** ──
     *
     * 처음에는 거리로 골랐습니다. 그런데 `npm run secret` 은 **화면 중심에
     * 가장 가까운 순간**으로 판정합니다(카메라가 기울어져 있어 거리와
     * 화면 자리가 따로 놉니다). 둘이 다른 순간을 보면 **그림과 판정이
     * 서로 다른 이야기를 하게 됩니다** — 실제로 2m 어긋난 걸음을 찍고
     * *"자는 초록인데 그림은 아무것도 없다"* 로 헤맸습니다.
     *
     * 그래서 여기서도 **같은 규칙**으로 고릅니다. 자리는 게임의 카메라가
     * 정합니다(`screenPos`).
     */
    let bestI = 0
    let best = Infinity
    {
      let bestScore = Infinity
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i]
        const d = Math.hypot(p.x - sec.x, p.z - sec.z)
        if (d < best) best = d
        if (d > 30) continue
        const sc = await page.evaluate(
          async ([px, pz, sx, sz]) => {
            const G = window.__game
            const nap = () => new Promise((r) => requestAnimationFrame(() => r()))
            G.teleportPlayer(px, pz)
            const W = window.innerWidth
            const H = window.innerHeight
            for (let k = 0; k < 40; k++) {
              await nap()
              const me = G.screenPos(px, 1.0, pz)
              if (me && Math.hypot(me.sx - W / 2, me.sy - H / 2) < 90) break
            }
            const sp = G.screenPos(sx, 1.0, sz)
            if (!sp) return null
            return Math.hypot(sp.sx - W / 2, sp.sy - H / 2)
          },
          [p.x, p.z, sec.x, sec.z],
        )
        if (sc !== null && sc < bestScore) {
          bestScore = sc
          bestI = i
        }
      }
    }
    const stepM = 2 // 동선 한 걸음이 대략 한 칸입니다
    for (const [tag, backSteps] of [
      ['approach16', Math.round(16 / stepM)],
      ['approach8', Math.round(8 / stepM)],
      ['closest', 0],
    ]) {
      const i = Math.max(0, bestI - backSteps)
      const p = trail[i]
      if (!p) continue
      await page.evaluate(([x, z]) => window.__game.teleportPlayer(x, z), [p.x, p.z])
      await page.evaluate(
        () =>
          new Promise((r) => {
            let n = 0
            const step = () => (++n < 12 ? requestAnimationFrame(step) : r())
            requestAnimationFrame(step)
          }),
      )
      await page.evaluate(() => window.__game.setPaused(true))
      const file = `20-${sec.name}-${tag}.png`
      await page.screenshot({ path: path.join(OUT, file) })
      await page.evaluate(() => window.__game.setPaused(false))
      const now = await page.evaluate(() => {
        const q = window.__game.state().player
        return { x: Math.round(q.x), z: Math.round(q.z) }
      })
      const d = Math.hypot(now.x - sec.x, now.z - sec.z)
      console.log(
        `  ${sec.label.padEnd(24)} ${tag.padEnd(11)} 동선(${now.x},${now.z}) → 대상까지 ${d.toFixed(1)}m   ${file}`,
      )
    }
    console.log(`     ↑ **closest 에서도 안 보이면** 이 비밀은 없는 것과 같습니다 (가장 가까운 순간 ${best.toFixed(1)}m)\n`)
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
