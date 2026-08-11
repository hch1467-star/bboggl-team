/**
 * 보물 자리 제안 — `node tools/place-treasures.mjs`
 *
 * `npm run secret` 이 "보물 5개 중 4개가 주 동선에서 화면에 안 뜬다"를
 * 잡아냈습니다. 이 도구는 그 넷에게 **옮길 자리를 제안**합니다.
 *
 * ── 왜 자동으로 고치지 않는가 ───────────────────────────────────
 * 레벨 데이터를 프로그램이 직접 덮어쓰게 두지 않았습니다. 배치에는
 * 눈으로만 아는 의도가 섞여 있고(절벽 위, 막다른 골목 안쪽 같은),
 * 그걸 거리 계산이 대신 판단할 수는 없습니다. 그래서 **제안만 하고**
 * 적용은 사람이 합니다.
 *
 * ── 무엇을 만족해야 하는가 ──────────────────────────────────────
 *   1. 주 동선에서 **18m 이내** — 빛기둥이 화면에 들어옵니다.
 *      (검사 문턱은 22m 이지만 18m 를 노립니다. 22m 에 딱 맞추면
 *       화면 맨 구석이라, 검사에 맞춘 것이지 고친 게 아닙니다.)
 *   2. 주 동선에서 **10m 이상** — 몇 걸음이라도 벗어나야 "갈까 말까"가
 *      선택이 됩니다. 길 위에 있으면 숨긴 게 아니라 주운 것입니다.
 *   3. **걸어서 닿는 자리** — 게임의 길찾기로 확인합니다. 눈으로 좋아
 *      보여도 허공이나 벽 안이면 소용없습니다.
 *   4. 위 셋을 만족하는 것 중 **원래 자리에서 가장 가까운 곳**.
 *      배치 의도를 최대한 남기려는 것입니다 — 조건을 채우는 아무 자리나
 *      고르면 레벨 디자인을 지우는 셈입니다.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5215
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

/** 목표 창 — 검사 문턱(22m)이 아니라 그 안쪽을 노립니다(위 설계 노트). */
const WANT_MAX = 18
const WANT_MIN = 10

const server = await createServer({ root: ROOT, server: { port: PORT }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: execPath,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('error:', e))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  const t = await page.evaluate(() => window.__game.terrainInfo())
  console.log(`\n🧭 보물 자리 제안 — 노리는 창 ${WANT_MIN}~${WANT_MAX}m (검사 문턱 ${t.cameraViewSize}m)\n`)

  // 주 동선. secret 프로브와 **같은 방식**입니다 — 적을 지우지 않고 얼립니다.
  const trail = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    G.reset()
    await sleep()
    G.freezeEnemies(true)
    await sleep()
    const out = []
    let guard = 0
    while (guard++ < 4000) {
      const obj = G.objective()
      if (!obj) break
      const p = G.state().player
      out.push({ x: p.x, z: p.z })
      if (obj.walkDist <= 1.5) break
      const step = G.pathStep(obj.x, obj.z)
      if (!step) break
      G.teleportPlayer(step.x, step.z)
      await sleep()
    }
    return out
  })
  console.log(`  주 동선 ${trail.length}걸음\n`)

  const level = JSON.parse(readFileSync(path.join(ROOT, 'src/levels/broken-gate.json'), 'utf8'))
  const treasures = level.entities.filter((e) => e.kind === 'treasure')
  /** 다른 마커와 겹치면 안 됩니다 — 화톳불 위에 보물을 놓을 수는 없습니다. */
  const occupied = level.entities.map((e) => ({ x: e.x, z: e.z }))

  const distToTrail = (x, z) => {
    let best = Infinity
    for (const p of trail) {
      const d = Math.hypot(p.x - x, p.z - z)
      if (d < best) best = d
    }
    return best
  }

  for (const tr of treasures) {
    const cur = distToTrail(tr.x, tr.z)
    if (cur <= t.cameraViewSize) {
      console.log(`  · (${tr.x}, ${tr.z})  동선까지 ${cur.toFixed(1)}m — 그대로 둡니다`)
      continue
    }

    /**
     * 원래 자리를 중심으로 **가까운 곳부터** 훑습니다. 처음 조건을 만족하는
     * 자리가 곧 "가장 적게 옮기는 자리"입니다.
     */
    const candidates = []
    for (let dx = -60; dx <= 60; dx += 2) {
      for (let dz = -60; dz <= 60; dz += 2) {
        const x = tr.x + dx
        const z = tr.z + dz
        const d = distToTrail(x, z)
        if (d > WANT_MAX || d < WANT_MIN) continue
        if (occupied.some((o) => Math.hypot(o.x - x, o.z - z) < 3)) continue
        candidates.push({ x, z, d, moved: Math.hypot(dx, dz) })
      }
    }
    candidates.sort((a, b) => a.moved - b.moved)

    // 걸어서 닿는지는 **게임**이 답합니다. 후보가 많으므로 가까운 것부터 몇 개만.
    const checked = await page.evaluate(
      async ([list, start]) => {
        const G = window.__game
        const sleep = () => new Promise((r) => setTimeout(r, 8))
        const out = []
        for (const c of list) {
          G.teleportPlayer(start.x, start.z)
          await sleep()
          const step = G.pathStep(c.x, c.z)
          // 길이 없으면 null. 있으면 dist 가 **걸어야 하는 거리**입니다.
          if (!step) continue
          out.push({ ...c, walk: Number(step.dist.toFixed(1)) })
          if (out.length >= 3) break
        }
        return out
      },
      [candidates.slice(0, 60), trail[Math.floor(trail.length / 2)]],
    )

    console.log(`\n  ⚠️ (${tr.x}, ${tr.z})  동선까지 ${cur.toFixed(1)}m — 옮길 후보:`)
    if (!checked.length) {
      console.log('     (조건을 만족하면서 걸어서 닿는 자리를 못 찾았습니다)')
      continue
    }
    for (const c of checked) {
      console.log(
        `     → (${c.x}, ${c.z})  동선까지 ${c.d.toFixed(1)}m · 원래 자리에서 ${c.moved.toFixed(1)}m 이동 · 걸어서 ${c.walk}m`,
      )
    }
  }
  console.log('')
} finally {
  await browser.close()
  await server.close()
}
