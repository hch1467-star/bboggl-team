/**
 * ── 📸 **존을 실제로 걸어 다니며 찍습니다** ─────────────────────────
 *
 * 왜 만들었는가: `npm run verify` 가 남기는 그림은 대부분 **실험장**
 * (웨이브 아레나)입니다. 그런데 이 게임의 얼굴은 존(무너진 성문)이고,
 * 사람에게 *"지금 어떤 게임인가"* 를 보여 줄 그림이 **한 장도 없었습니다.**
 *
 * 구역 이름은 레벨 파일이 알고 있으니 **베끼지 않습니다** — 읽어서
 * 각 구역의 한가운데로 순간이동한 뒤 한 장씩 남깁니다.
 *
 * 실행: node tools/shoot-zone.mjs [출력폴더]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const OUT = process.argv[2] ?? path.join(HERE, 'zone-shots')
mkdirSync(OUT, { recursive: true })

const LEVEL = JSON.parse(readFileSync(path.join(ROOT, 'src/levels/broken-gate.json'), 'utf8'))
const CELL = 2
const HALF_X = 44
const HALF_Z = 36
/** 셀 좌표 → 월드 좌표. 규칙은 `level/format.ts` 와 같아야 합니다. */
const worldOf = (cx, cz) => ({ x: (cx - HALF_X + 0.5) * CELL, z: (cz - HALF_Z + 0.5) * CELL })

const PORT = 5199
const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PREINSTALLED = ['/opt/pw-browsers/chromium']
const execPath = PREINSTALLED.find((p) => existsSync(p))

try {
  await sleep(4000)
  const browser = await chromium.launch({ executablePath: execPath })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(`http://127.0.0.1:${PORT}/?lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 30000 })
  await sleep(1500)

  const zs = await page.evaluate(() => window.__game.state())
  console.log(`\n📸 ${zs.levelName} — 구역 ${(LEVEL.regions ?? []).length}곳`)

  let n = 0
  for (const r of LEVEL.regions ?? []) {
    const cx = Math.round((r.x0 + r.x1) / 2)
    const cz = Math.round((r.z0 + r.z1) / 2)
    const { x, z } = worldOf(cx, cz)
    /**
     * ⚠️ 순간이동 뒤 **한 박자 기다립니다.** 카메라가 따라오고 구역
     *    배너가 뜨는 데 시간이 걸립니다 — 바로 찍으면 이전 자리의
     *    화면이 남습니다(실제로 첫 판에 그랬습니다).
     */
    await page.evaluate(([px, pz]) => window.__game.teleportPlayer(px, pz), [x, z])
    await sleep(900)
    const file = path.join(OUT, `${String(++n).padStart(2, '0')}-${r.name.replace(/\s+/g, '')}.png`)
    await page.screenshot({ path: file })
    console.log(`  ${r.name.padEnd(12)} (${cx},${cz}) → ${path.basename(file)}`)
  }

  await browser.close()
  console.log(`\n✅ ${n}장 — ${OUT}\n`)
} finally {
  dev.kill()
}
