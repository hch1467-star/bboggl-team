/**
 * 🎁💥 **떨어뜨려서 줍기** — `npm run drop`
 *
 * ── 무엇을 재는가 ──────────────────────────────────────────────────
 * 이 존의 「비밀 어휘」 중 하나입니다 — **"손이 안 닿아도 답이 있다."**
 * 길 위의 통 B 를 친다 → 불이 선반 위 통 A 로 옮는다 → A 가 터지며
 * 보물을 길 쪽으로 **밀어 떨어뜨립니다.**
 *
 * ⚠️ **여기에 자리도 거리도 안 적습니다.** 처음에는 머리말에
 *    *"114m 성벽 위"* 라고 적었다가 자리를 옮기고 **두 번** 옛말로
 *    남았습니다(114m → 80m → 36m). 지도가 움직이는 물건이라 그렇습니다.
 *    설명이 낡는 것을 막는 방법은 **설명을 안 적는 것**이 아니라
 *    **좌표를 안 적는 것**입니다 — 아래 검사는 자리를 게임에게 물어서
 *    찾으므로, 다음에 또 옮겨도 그대로 굴러갑니다.
 *    (자리와 근거는 `tools/make-zone.mjs` 의 🎁💥 주석 한 곳에만 있습니다.)
 *
 * ── ⚠️ 왜 **다섯 갈래**를 다 봐야 하는가 ───────────────────────────
 * 이 장치는 다섯 군데 중 **어디가 무너져도 겉보기는 똑같습니다** —
 * *"보물이 안 내려온다."* 그런데 처방은 전부 다릅니다:
 *   ① 보물이 애초에 **닿는 자리**에 있었다  → 배치 문제(퍼즐이 아님)
 *   ② 통 A 를 **칼로 칠 수 있었다**         → 배치 문제(연쇄가 답이 아님)
 *   ③ 불이 **안 옮았다**                    → 숫자 문제(chain 반경)
 *   ④ 옮았는데 보물이 **안 움직였다**       → 코드 문제(밀어내기)
 *   ⑤ 움직였는데 **못 줍는 자리**로 갔다    → 코드 문제(내려앉을 자리 찾기)
 * 하나로 뭉뚱그리면 이 다섯을 영영 못 가릅니다. 이 저장소가 이번
 * 세션에 가장 여러 번 데인 모양 그대로입니다 —
 * **처방이 다른 것들이 한 칸에 담기면 정확히 거꾸로 읽힙니다.**
 *
 * 그리고 여섯째로 **신분증**을 봅니다: 밀려나서 좌표가 바뀐 보물을
 * 주웠을 때, 다시 켜면 **또 나오면 안 됩니다**(정련석 무한). 이 저장소는
 * 똑같은 버그를 보스에서 이미 겪었습니다(격파 기록을 「죽은 자리」로
 * 저장 → 쉴 때마다 부활). 그래서 미리 못 박습니다.
 *
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

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
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  const harness = () =>
    page.evaluate(() => {
      window.__t = {
        runFor: async (seconds) => {
          const target = window.__game.state().elapsed + seconds
          const deadline = Date.now() + 120000
          while (window.__game.state().elapsed < target && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 8))
          }
        },
      }
    })

  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  await page.evaluate(() => window.__game.resetProgress())
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  await harness()

  console.log('\n🎁💥 떨어뜨려서 줍기\n')

  // ---- 자리 찾기 — **게임에게 묻습니다** ----
  const site = await page.evaluate(() => {
    const G = window.__game
    const info = G.barrelInfo()
    /**
     * 이 장치가 있는 자리 = **걸어갈 수 없는 보물 중, 폭발 반경 안에
     * 통이 있는 것**.
     *
     * ⚠️ 처음엔 *"걸어갈 수 없는 보물"* 만으로 골랐다가 **금 간 벽 뒤의
     *    보물**을 집었습니다(그것도 걸어서는 못 갑니다 — 벽을 부숴야
     *    하니까). 둘 다 *"못 간다"* 지만 **답이 다릅니다** — 하나는 벽을
     *    부수는 것이고 하나는 떨어뜨리는 것입니다. 「통이 곁에 있는가」가
     *    그 둘을 가르는 자리입니다.
     */
    const stranded = G.treasurePositions().filter(
      (t) =>
        !t.taken &&
        !G.walkableFromPlayer(t.x, t.z) &&
        info.barrels.some((b) => Math.hypot(b.x - t.x, b.z - t.z) <= info.blast),
    )
    if (stranded.length === 0) return null
    const t = stranded[0]
    // 그 보물에 가장 가까운 통이 **위쪽 통(A)**, A 에서 불 반경 안이면서
    // 걸어갈 수 있는 통이 **아래 통(B)** 입니다. 이름을 좌표로 안 박습니다.
    const near = info.barrels
      .map((b) => ({ ...b, d: Math.hypot(b.x - t.x, b.z - t.z) }))
      .sort((a, b) => a.d - b.d)
    const A = near[0]
    const B = info.barrels
      .filter((b) => b.entity !== A.entity && G.walkableFromPlayer(b.x, b.z))
      .map((b) => ({ ...b, d: Math.hypot(b.x - A.x, b.z - A.z) }))
      .sort((a, b) => a.d - b.d)[0]
    return { t, A, B, chain: info.chain, blast: info.blast, fuse: info.fuse }
  })
  check(!!site, '① 걸어갈 수 없는 보물이 지도에 있다 (이 장치가 놓여 있다)')
  if (!site) throw new Error('자리를 못 찾아 나머지를 못 잽니다')
  console.log(
    `  [자리] 보물(${site.t.x},${site.t.z}) · 위 통(${site.A.x},${site.A.z}) ${site.A.d.toFixed(2)}m · 아래 통(${site.B.x},${site.B.z}) ${site.B.d.toFixed(2)}m`,
  )

  // ---- ② 위쪽 통은 칼이 안 닿는다 ----
  /**
   * 근접 최대 도달은 **게임이 계산해 줍니다**(`reachUpperBound` = 사거리 +
   * 파고들기). 걸어갈 수 있는 칸은 게임의 길찾기에게 묻습니다. 그러면 이
   * 검사에는 베껴 적은 숫자가 하나도 안 남습니다.
   *
   * ⚠️ 칸 한가운데가 아니라 **칸 가장자리**까지 걸어 나갈 수 있으므로,
   *    가장 가까운 칸에서 반 칸(1m)을 빼고 비교합니다. 여기서 반 칸을
   *    안 빼면 검사가 게임보다 후해집니다.
   */
  const unreachable = await page.evaluate(
    ({ ax, az }) => {
      const G = window.__game
      let maxReach = 0
      let who = ''
      for (const w of G.weaponTable()) {
        for (const c of w.comboSteps ?? []) {
          if (c.reachUpperBound > maxReach) {
            maxReach = c.reachUpperBound
            who = `${w.name} ${c.name}`
          }
        }
      }
      let best = 1e9
      for (let dx = -12; dx <= 12; dx += 1) {
        for (let dz = -12; dz <= 12; dz += 1) {
          const x = ax + dx
          const z = az + dz
          if (!G.walkableFromPlayer(x, z)) continue
          const d = Math.hypot(dx, dz)
          if (d < best) best = d
        }
      }
      return { best: Number(best.toFixed(2)), maxReach, who }
    },
    { ax: site.A.x, az: site.A.z },
  )
  check(
    unreachable.best > unreachable.maxReach,
    '② 위쪽 통은 **칼이 안 닿는다** (연쇄 말고 다른 답이 없다)',
    `가장 가까운 발판 ${unreachable.best}m > 최대 도달 ${unreachable.maxReach}m (${unreachable.who})`,
  )

  // ---- ③④⑤ 아래 통을 치면 무엇이 일어나는가 ----
  const run = await page.evaluate(
    async ({ bx, bz, tx, tz, fuse }) => {
      const G = window.__game
      // 통 옆에 섭니다 — 2m 면 어느 무기로도 닿습니다.
      G.teleportPlayer(bx, bz + 2)
      await window.__t.runFor(0.4)
      const before = G.runStats().treasuresBlown
      const key = (t) => `${t.x.toFixed(2)},${t.z.toFixed(2)}`
      const wasThere = new Set(G.treasurePositions().filter((t) => !t.taken).map(key))
      G.aimAtWorld(bx, bz)
      G.press('Mouse0')
      // ⚠️ **누르면 반드시 뗍니다.** `press` 는 이미 눌린 키를 무시하므로
      //    안 떼면 다음 휘두르기가 조용히 안 나갑니다(이 저장소의 기록).
      G.release('Mouse0')
      /**
       * ⚠️ **때린 뒤에는 물러납니다.** 안 물러나면 내려온 보물이 발밑에
       *    떨어져 **그 자리에서 바로 주워집니다** — 그러면 검사가
       *    *"보물이 사라졌다"* 고 읽습니다(실제로 한 번 그렇게 나왔고,
       *    장치는 멀쩡했습니다). 줍는 것은 ⑥ 에서 따로 볼 것이므로
       *    여기서는 **어디에 내려앉았는지**만 봐야 합니다.
       */
      await window.__t.runFor(0.25)
      G.teleportPlayer(bx, bz + 20)
      // 도화선 두 번(아래 통 → 위 통) + 여유.
      await window.__t.runFor(fuse * 2 + 1.2)
      const now = G.treasurePositions().filter((t) => !t.taken)
      /**
       * ⚠️ **가까움으로 신분을 정하지 않습니다.** 처음엔 *"원래 자리에서
       *    가장 가까운 남은 보물"* 로 골랐다가, 6m 옆 **비밀방의 다른
       *    보물**을 집었습니다 — 그리고 그걸 「내려온 보물」이라 부르며
       *    검사 하나가 조용히 엉뚱한 것을 쟀습니다.
       *
       *    이건 이 회차에 게임 쪽에서 막 고친 것과 **똑같은 함정**입니다
       *    (좌표를 신분증으로 쓰기 — `Pickup.homeX/homeZ`). 계측기도
       *    같은 규칙을 지켜야 합니다: **없어진 자리와 새로 생긴 자리**를
       *    맞대서 찾습니다.
       */
      const moved = now.find((t) => !wasThere.has(key(t))) ?? null
      return {
        blown: G.runStats().treasuresBlown - before,
        moved: moved ? { ...moved, d: Math.hypot(moved.x - tx, moved.z - tz) } : null,
        landed: moved ? G.walkableFromPlayer(moved.x, moved.z) : false,
      }
    },
    { bx: site.B.x, bz: site.B.z, tx: site.t.x, tz: site.t.z, fuse: site.fuse },
  )
  check(run.blown === 1, '③④ 불이 옮아 붙고 보물이 **밀려났다**', `밀려난 보물 ${run.blown}개`)
  check(
    run.landed,
    '⑤ 밀려난 보물이 **걸어갈 수 있는 자리**에 내려앉았다',
    run.moved ? `(${run.moved.x.toFixed(1)},${run.moved.z.toFixed(1)}) · 옮긴 거리 ${run.moved.d.toFixed(1)}m` : '보물이 사라짐',
  )

  // ---- 실제로 주울 수 있는가 ----
  const picked = await page.evaluate(
    async ({ x, z }) => {
      const G = window.__game
      // 주운 개수는 `state()` 가 셉니다(runStats 에는 없습니다).
      const before = G.state().treasuresFound
      const stonesBefore = G.weaponUpgradeInfo().stones
      G.teleportPlayer(x, z)
      await window.__t.runFor(0.6)
      return {
        found: G.state().treasuresFound - before,
        stones: G.weaponUpgradeInfo().stones - stonesBefore,
      }
    },
    { x: run.moved?.x ?? 0, z: run.moved?.z ?? 0 },
  )
  check(
    picked.found === 1 && picked.stones >= 1,
    '⑥ 내려온 보물을 **실제로 줍는다** (연출만이 아니라 보상까지)',
    `보물 ${picked.found}개 · 정련석 +${picked.stones}`,
  )

  // ---- 신분증 ----
  /**
   * 밀려난 보물은 좌표가 바뀝니다. 「이미 주웠다」를 **지금 자리**로
   * 적으면, 다시 켤 때 원래 자리의 상자와 안 맞아 **또 나옵니다** —
   * 정련석이 무한이 됩니다. 보스에서 똑같이 당한 적이 있어
   * (`Enemy.homeX/homeZ`) 여기서 못 박습니다.
   */
  const reborn = await page.evaluate(async () => {
    const G = window.__game
    G.saveNow()
    return G.treasurePositions().filter((t) => !t.taken).length
  })
  await page.reload()
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  const afterReload = await page.evaluate(() => window.__game.treasurePositions().filter((t) => !t.taken).length)
  check(
    afterReload === reborn,
    '⑦ 밀려난 뒤 주운 보물은 **다시 켜도 안 돌아온다** (신분증이 처음 자리다)',
    `끄기 전 남은 상자 ${reborn}개 → 켠 뒤 ${afterReload}개`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} catch (err) {
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
