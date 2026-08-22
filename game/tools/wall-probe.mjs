/**
 * 🧱 **금 간 벽 — `npm run wall`**
 *
 * ── 왜 이 계측기가 따로 필요한가 ──────────────────────────────────
 * 이 물건은 항아리와 겉이 같습니다(체력 1, 한 대면 부서짐). 그래서
 * `npm run urn` 으로 재고 싶어집니다. 그런데 **부서진 뒤에 하는 일이
 * 다릅니다** — 항아리는 물건을 내놓고, 벽은 **길**을 내놓습니다.
 * 그 차이가 이 파일이 있는 이유 전부입니다.
 *
 * 이 저장소가 이번 세션에 여덟 번 만난 실패가 *"처방이 다른 둘이 한
 * 칸에 담기면 정확히 거꾸로 읽힌다"* 였습니다. 「부수면 나온다」와
 * 「부수면 열린다」를 한 프로브에 담으면 아홉 번째가 됩니다.
 *
 * ── 무엇을 재는가 (넷) ────────────────────────────────────────────
 *   ① 부수기 전에는 **정말 막혀 있는가** — 길찾기에게 묻습니다
 *   ② 한 대면 열리는가 — 「어려운 일은 기계가」(balance.ts `CRACKED_WALL`)
 *   ③ 열린 뒤 **길이 실제로 생기는가** — 다시 길찾기에게 묻습니다
 *   ④ 부수기 전에 **안내가 비밀을 일러바치지 않는가**
 *   ⑤ **껐다 켜도 부순 채로 있는가** — 길도, 몸통도
 *
 * ④ 가 이 물건의 심장입니다. 값은 방 안의 보물이 아니라 *"역시 나는
 * 게임을 안다"* 인데, 화면이 *"북동 34m — 보물"* 이라고 먼저 말해 버리면
 * 그 값은 **지불되기 전에 사라집니다.**
 *
 * ── 못 재는 것 ────────────────────────────────────────────────────
 * *"길에서 눈에 띄는가"* 는 여기서 못 잽니다. 거리는 `npm run route` 의
 * 🧱 줄이 재고, **실제로 보이는지는 그림으로**(`npm run hide`) 봐야
 * 합니다. 못 잰 것을 통과로 만들지 않으려고 여기 적어 둡니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5271
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

  console.log('\n🧱 금 간 벽 — 알아본 사람에게만 열립니다\n')

  /**
   * ⚠️ **앞선 실행의 세이브가 이번 판에 새지 않는가** — 이 프로브는
   *    마지막에 세이브를 남기므로(⑤), 그게 다음 실행에 남으면 ①②가
   *    *"막혀 있다 / 한 대에 열렸다"* 를 재는 대신 조용히 통과합니다.
   *
   *    지우는 코드는 **안 씁니다.** `browser.newPage()` 가 매번 **새 컨텍스트**를
   *    만들어서 저장소가 이미 비어 있기 때문입니다. 대신 아래 ②의
   *    *"판이 시작될 때 벽은 닫혀 있다"* 가 그 사실을 **매번 확인합니다** —
   *    빈 저장소를 믿는 것이 아니라 재는 것입니다.
   *
   * ⚠️ 지우려고 `resetProgress()` 와 `localStorage.clear()+reload()` 를
   *    차례로 시도했는데 **둘 다 ②를 빨갛게 만들었습니다** — 다시 연
   *    페이지에서는 휘두르기 입력이 안 먹었습니다. 원인을 못 밝혔으므로
   *    **여기 적어 둡니다**: 이 프로브에서 휘두르기는 **첫 goto 뒤에**
   *    해야 합니다.
   */
  const walls = await page.evaluate(() => window.__game.walls())
  /**
   * ⚠️ **빈 표본으로 통과시키지 않습니다.** 벽이 하나도 없으면 아래 검사가
   *    전부 「반례 없음」으로 조용히 초록이 됩니다. 그건 *"규칙이 지켜졌다"*
   *    가 아니라 *"아무것도 안 쟀다"* 입니다.
   */
  check(walls.length > 0, '🧱 이 존에 금 간 벽이 하나라도 있다', `${walls.length}개`)
  if (walls.length === 0) {
    console.log('\n  ⚠️ 벽이 없어 나머지를 재지 못했습니다 — **통과가 아니라 못 잰 것**입니다.\n')
    console.log(`❌ ${pass}개 통과 / ${fail + 1}개 실패\n`)
    process.exitCode = 1
  } else {
    const w = walls[0]
    console.log(`  [자리] (${w.x.toFixed(0)},${w.z.toFixed(0)}) · 열쇠 ${w.key}\n`)

    /**
     * ── ① 부수기 전에는 막혀 있는가 ────────────────────────────────
     *
     * 벽 **뒤쪽**(방 안) 한 칸을 잡아 *"지금 걸어서 닿는가"* 를 묻습니다.
     * 뒤쪽이 어느 쪽인지는 벽이 서 있는 방향에서 나옵니다 — 벽의 자리는
     * 두 칸의 **경계 한가운데**이고, 방은 바깥의 반대편입니다.
     *
     * ⚠️ 방향을 프로브가 다시 계산하지 않고 **게임에게 물어본 값**만
     *    씁니다. 벽 규칙은 이제 막 생겨서, 두 벌이 되면 갈라질 여지가
     *    가장 큰 자리입니다.
     */
    const room = await page.evaluate(() => {
      const wall = window.__game.walls()[0]
      // 벽 경계에서 양쪽으로 1칸(2m)씩 — 둘 중 **안 닿는 쪽**이 방입니다.
      const cands = [
        { x: wall.x + 2, z: wall.z },
        { x: wall.x - 2, z: wall.z },
        { x: wall.x, z: wall.z + 2 },
        { x: wall.x, z: wall.z - 2 },
      ]
      return cands.map((c) => ({ ...c, walkable: window.__game.walkableFromPlayer(c.x, c.z) }))
    })
    const sealed = room.filter((c) => !c.walkable)
    const open = room.filter((c) => c.walkable)
    console.log(
      `  [벽 양옆] 닿는 칸 ${open.length}개 · 안 닿는 칸 ${sealed.length}개` +
        `  ${room.map((c) => `(${c.x.toFixed(0)},${c.z.toFixed(0)})${c.walkable ? '○' : '✕'}`).join(' ')}`,
    )
    check(
      sealed.length > 0,
      '① 부수기 전에는 **벽 뒤로 걸어갈 수 없다**',
      sealed.length > 0
        ? `막힌 칸 (${sealed[0].x.toFixed(0)},${sealed[0].z.toFixed(0)})`
        : '**전부 닿습니다** — 벽이 아무것도 안 막고 있습니다',
    )

    /**
     * ── ④ 안내가 비밀을 일러바치지 않는가 (부수기 **전에** 묻습니다) ──
     *
     * 순서가 중요합니다. 부순 뒤에 물으면 이미 열린 방이라 당연히
     * 안내되고, 그건 아무 잘못이 아닙니다. *"부수기 전에 말하는가"* 가
     * 물음이므로 여기서 물어야 합니다.
     */
    const hint = await page.evaluate(() => window.__game.sideHint())
    const roomCell = sealed[0]
    const at = hint.at
    const tells = at && roomCell ? Math.hypot(at.x - roomCell.x, at.z - roomCell.z) < 6 : false
    check(
      !tells,
      '④ 부수기 전에 **안내가 벽 뒤를 가리키지 않는다**',
      at ? `지금 안내: "${hint.text}" → (${at.x.toFixed(0)},${at.z.toFixed(0)})` : `안내 "${hint.text || '없음'}"`,
    )

    /**
     * ── ② 한 대면 열리는가 ─────────────────────────────────────────
     *
     * 벽 앞(바깥 쪽)에 서서 벽을 보고 **한 번** 휘두릅니다.
     *
     * ⚠️ 실제 공격 입력은 **Mouse0** 입니다. 이 저장소가 `KeyJ`(실험대의
     *    모루 키)로 휘두른 줄 알고 **엉뚱한 곳을 범인으로 지목한** 적이
     *    있습니다. 키를 여기 못 박아 둡니다.
     */
    const outside = open[0]
    const before = await page.evaluate(() => window.__game.walls()[0].open)
    check(!before, '② 판이 시작될 때 벽은 **닫혀 있다**', before ? '이미 열려 있습니다' : '닫힘')

    const swung = await page.evaluate(async ({ ox, oz }) => {
      const g = window.__game
      const wall = g.walls()[0]
      g.teleportPlayer(ox, oz)
      // 조준은 커서로 합니다 — 실제 조작과 같은 길이라야 「칠 수 있다」가 참말입니다.
      g.aimAtWorld(wall.x, wall.z)
      await new Promise((r) => setTimeout(r, 120))
      g.press('Mouse0')
      await new Promise((r) => setTimeout(r, 900))
      return { open: g.walls().length > 0 ? g.walls()[0].open : true }
    }, { ox: outside.x, oz: outside.z })
    check(swung.open, '② **한 대면 열린다** (열쇠도 폭탄도 없이)', swung.open ? '열림' : '한 대로는 안 열렸습니다')

    /**
     * ── ③ 열린 뒤에 **정말 길이 생기는가** ──────────────────────────
     *
     * 이게 이 물건과 항아리를 가르는 자리입니다. 화면에서 벽이 사라지는
     * 것만으로는 부족합니다 — **길찾기가 바뀌어야** 적도 따라 들어오고
     * 안내도 안쪽을 가리킵니다.
     */
    const after = await page.evaluate(
      ({ rx, rz }) => window.__game.walkableFromPlayer(rx, rz),
      { rx: roomCell.x, rz: roomCell.z },
    )
    check(
      after,
      '③ 열린 뒤에는 **벽 뒤로 걸어갈 수 있다** (길찾기가 바뀐다)',
      after ? `(${roomCell.x.toFixed(0)},${roomCell.z.toFixed(0)}) 까지 길이 생겼습니다` : '아직도 막혀 있습니다',
    )

    /**
     * ── ⑤ **껐다 켜도 부순 채로 있는가** ────────────────────────────
     *
     * 이 검사는 **추론만으로 쓴 코드**를 재려고 있습니다. 벽의 열림
     * 상태는 사다리와 같은 목록에 저장되므로(`openShortcutKeys`) **길은**
     * 공짜로 돌아옵니다. 그런데 **몸통**은 아닙니다 — 레벨을 열 때
     * `spawnFromLevel` 이 벽마다 하나씩 세워 놓기 때문에, 아무것도 안 하면
     * *"길은 뚫렸는데 벽이 서 있는"* 그림이 됩니다.
     *
     * 그래서 `removeBrokenWalls()` 를 넣었는데, 그건 **재기 전의 설명**
     * 이었습니다. 여기서 실제로 껐다 켜 봅니다.
     *
     * ⚠️ 두 가지를 **따로** 묻습니다(`open` 과 `standing`). 한 칸으로
     *    물으면 둘 중 어느 쪽이 틀렸는지 못 가르고, 처방이 정반대입니다 —
     *    길이 안 열리면 지형이, 몸통이 남으면 세이브 복원이 범인입니다.
     */
    await page.evaluate(() => window.__game.saveNow())
    await page.reload()
    await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
    const reborn = await page.evaluate(() => window.__game.walls())
    const w2 = reborn[0]
    check(
      !!w2 && w2.open,
      '⑤ 껐다 켜도 **길은 뚫린 채로** 있다',
      w2 ? (w2.open ? '열림' : '**다시 막혔습니다** — 세이브에 안 남았습니다') : '벽 자체가 사라졌습니다',
    )
    check(
      !!w2 && !w2.standing,
      '⑤ 껐다 켜도 **벽은 안 서 있다** (길만 뚫리고 몸통이 남으면 안 됩니다)',
      w2 ? (w2.standing ? '**몸통이 되살아났습니다** — 부순 벽이 다시 섰습니다' : '없음') : '-',
    )

    check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' / '))
    console.log(
      `\n  ⚠️ **「길에서 눈에 띄는가」는 여기서 안 잽니다.** 거리는 ` +
        `\`npm run route\` 의 🧱 줄이, 실제로 보이는지는 \`npm run hide\` 의 그림이 봅니다.\n`,
    )
    console.log(`${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
    process.exitCode = fail === 0 ? 0 : 1
  }
} finally {
  await browser.close()
  await server.close()
}
