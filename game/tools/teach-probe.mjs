/**
 * 🎨 **색을 가르치는 계약 — `npm run teach`**
 *
 * ── 이 게임의 계약 ────────────────────────────────────────────────
 * *"색은 **처음 볼 때 한 번** 설명한다."* (main.ts 「처음 보는 색이면
 * 정답을 한 번」). 기둥 2가 4색 예고인 게임에서 이건 곁가지가 아니라
 * **규칙을 알려 주는 유일한 자리**입니다.
 *
 * ── 그런데 아무도 안 재고 있었습니다 ──────────────────────────────
 * 그 사이에 계약이 두 군데서 깨져 있었습니다:
 *
 * ① **판을 새로 시작해도 다시 안 가르쳤습니다.** `seenIntents` 선언부에
 *    *"판을 새로 시작하는 사람은 대개 다시 배우고 싶은 사람"* 이라고
 *    적어 놓고, `reset()` 에서 그 집합을 **안 지웠습니다.** 프로브는
 *    전부 `reset()` 으로 시작하므로, 계측기들도 이 사실을 못 봤습니다.
 *
 * ② **보스가 처음 가르치는 색이 있었습니다.** `npm run map` 의 🎨 검사가
 *    다섯 색 전부 피해 갈 수 있다고 답했고, 못 피하는 자리는 스폰 58m
 *    안과 보스 13m 안뿐입니다. 즉 🔵 속박·🟣 강제이동을 **보스가
 *    휘두르는 순간** 처음 배우는 판이 실제로 있을 수 있습니다.
 *
 * 이 프로브는 계약을 **네 조각**으로 나눠 잽니다. 조각마다 처방이
 * 다르기 때문입니다 — 한 칸에 담으면 어느 쪽이 깨졌는지 못 가릅니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5273
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
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🎨 색을 가르치는 계약 — 처음 볼 때 한 번, 그리고 늦지 않게\n')

  /**
   * ── ① **판을 새로 시작하면 다시 배운다** ─────────────────────────
   *
   * 여기가 제일 조용히 깨져 있던 자리입니다. 페이지를 켠 직후에는
   * 당연히 비어 있으므로 **한 번 배우게 한 뒤 다시 시작해서** 봅니다 —
   * 안 그러면 이 검사는 "새 페이지는 깨끗하다"는 당연한 말만 하게 됩니다.
   */
  const teachOnce = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 16))
    G.reset()
    await sleep()
    const p = G.playerEntity()
    const px = G.state().player.x
    const pz = G.state().player.z
    // 바로 앞에 한 마리 세워 두면 곧 예고를 겁니다 — 그게 「처음 보는 색」입니다.
    G.spawnTestEnemy(px + 2.2, pz)
    for (let i = 0; i < 240 && G.seenIntents().length === 0; i++) {
      G.step(1, 0.05)
      await sleep()
    }
    return { seen: G.seenIntents().length, alive: p >= 0 }
  })
  check(
    teachOnce.seen > 0,
    '① **잡몹 하나만 세워도 색을 가르친다** (계약이 실제로 도는가)',
    `배운 색 ${teachOnce.seen}개`,
  )

  const afterReset = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 16))
    G.reset()
    await sleep()
    return G.seenIntents().length
  })
  check(
    afterReset === 0,
    '① **판을 새로 시작하면 배운 것이 지워진다** (다시 배울 수 있게)',
    afterReset === 0 ? '0개' : `**${afterReset}개가 남았습니다** — 새 판에서 안내가 영영 안 뜹니다`,
  )

  /**
   * ── ② **보스를 만나기 전에 못 본 색이 있으면, 조우에서 가르친다** ──
   *
   * 아무것도 안 만나고 보스 앞으로 갑니다(적을 얼려 둡니다). 그러면
   * 「한 번도 못 본 색으로 보스를 만나는 판」이 그대로 재현됩니다.
   */
  const enc = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 16))
    G.reset()
    await sleep()
    G.freezeEnemies(true)
    await sleep()
    const before = G.seenIntents().slice()
    /**
     * 보스 자리는 **목표 안내를 따라가서** 찾습니다 — 좌표를 프로브가
     * 외우면 지도를 고치는 날 이 검사만 옛 자리로 갑니다.
     *
     * ⚠️ 목표는 **이어집니다**(수문장 → … → 보스). 이름으로 고르려다
     *    첫 목표인 수문장에서 멈춰 **조우가 0** 이 났습니다. 이름을 안 보고
     *    *"목표가 더 안 바뀔 때까지"* 따라갑니다 — 그 마지막이 보스입니다.
     */
    let last = null
    for (let i = 0; i < 80; i++) {
      const o = G.objective()
      if (!o) break
      if (last && Math.abs(o.x - last.x) < 0.01 && Math.abs(o.z - last.z) < 0.01) break
      last = { x: o.x, z: o.z }
      G.teleportPlayer(o.x, o.z)
      await sleep()
      G.step(1, 0.05)
    }
    /**
     * ⚠️ **여기서 얼음을 풉니다.** 조우 판정은 적 AI 안에 있어서, 얼린
     *    채로는 보스 앞에 서 있어도 **영원히 조우가 안 됩니다**(실제로
     *    `encounter 0` 이 두 번 났습니다). 오는 길에만 얼려 두는 것이
     *    이 프로브가 원하는 것 — *"아무것도 안 만나고 보스 앞에 선다"* — 입니다.
     */
    G.freezeEnemies(false)
    await sleep()
    for (let i = 0; i < 200; i++) {
      G.step(1, 0.05)
      await sleep()
      if ((G.bossEncounter()?.encounter ?? 0) > 0 && G.seenIntents().length > before.length) break
    }
    const hint = document.getElementById('colorHint')
    return {
      before,
      after: G.seenIntents().slice(),
      engaged: G.bossEncounter()?.encounter ?? 0,
      hintText: hint && hint.style.display !== 'none' ? (hint.textContent ?? '') : '',
    }
  })
  check(enc.engaged > 0, '② 보스와 **실제로 조우했다** (측정이 성립했다)', `encounter ${enc.engaged}`)
  const learned = enc.after.filter((i) => !enc.before.includes(i))
  check(
    learned.length > 0,
    '② **못 본 색을 조우 순간에 가르친다** (보스가 휘두른 뒤가 아니라)',
    learned.length > 0
      ? `조우에서 배운 색 ${learned.length}개 (그 전 ${enc.before.length}개 → ${enc.after.length}개)`
      : '**하나도 안 가르쳤습니다** — 첫 🔵 를 보스의 속박으로 배우게 됩니다',
  )
  check(
    enc.hintText !== '',
    '② 그리고 그 안내가 **화면에 실제로 떠 있다** (규칙이 도는 것과 보이는 것은 다릅니다)',
    enc.hintText ? `"${enc.hintText.slice(0, 40)}"` : '화면에 아무것도 없습니다',
  )

  /**
   * ── ③ **이미 배운 색은 다시 안 가르친다** ────────────────────────
   *
   * 계약의 뒷절입니다 — *"색마다 **한 번만**."* 반복되면 안내가 아니라
   * 잔소리가 되고, 잔소리는 다음 안내까지 같이 무시하게 만듭니다.
   */
  const again = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 16))
    const n = G.seenIntents().length
    for (let i = 0; i < 200; i++) {
      G.step(1, 0.05)
      await sleep()
    }
    return { before: n, after: G.seenIntents().length }
  })
  check(
    again.after === again.before,
    '③ **이미 배운 색을 다시 세지 않는다** (색마다 한 번만)',
    `${again.before}개 → ${again.after}개`,
  )

  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' / '))
  console.log(
    '\n  ⚠️ **「배웠는가」는 여기서 못 잽니다.** 이 프로브가 재는 것은 ' +
      '*"게임이 제때 말했는가"* 까지입니다 — 사람이 그걸 읽고 색을 구분하게 되는지는 ' +
      '`npm run contrast`(색이 구분되는가)와 `npm run play`(🎨 색별 겪음)가 나눠 봅니다.\n',
  )
  console.log(`${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  await browser.close()
  await server.close()
}
