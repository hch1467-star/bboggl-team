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
   * ── ⚠️ **누른 뒤에는 반드시 뗍니다** (이걸 몰라서 오래 헤맸습니다) ──
   *    `debugInput.press` 는 **이미 눌려 있는 키를 무시합니다**
   *    (`if (!down.has(code)) pressedThisFrame.add(code)`). 즉 떼지 않으면
   *    **두 번째 누름부터 아무 일도 안 일어납니다.**
   *
   *    그 사실을 모른 채, 검사 순서를 바꿀 때마다 *"한 대로는 안 열렸다"*
   *    가 자리를 옮겨 다니는 것을 보고 **게임을 세 번 의심했습니다**
   *    (긴 프레임이 판정을 삼킨다 · 다시 연 페이지가 입력을 막는다 ·
   *    폭발이 뒤를 망친다). 전부 틀렸습니다 — **두 번째 휘두름부터가
   *    아예 없었던 것**입니다.
   *
   *    다른 프로브들은 이미 `release` 를 짝지어 씁니다. 새 프로브를 쓸 때
   *    그 관례를 안 따른 것이 원인이었습니다.
   */
  const walls = await page.evaluate(() => window.__game.walls())
  const barrels = await page.evaluate(() => window.__game.barrelInfo())
  const eye = await page.evaluate(() => window.__game.terrainInfo().cameraViewSize)
  /**
   * ⚠️ **빈 표본으로 통과시키지 않습니다.** 벽이 하나도 없으면 아래 검사가
   *    전부 「반례 없음」으로 조용히 초록이 됩니다. 그건 *"규칙이 지켜졌다"*
   *    가 아니라 *"아무것도 안 쟀다"* 입니다.
   */
  check(walls.length > 0, '🧱 이 존에 금 간 벽이 하나라도 있다', `${walls.length}개`)
  /**
   * ── 🧱💥 **두꺼운 벽의 답이 같은 화면에 있는가** ────────────────────
   *
   * 이 검사가 이 물건의 **설계 계약**입니다. 두꺼운 벽은 칼을 거절하므로,
   * 답(폭발통)이 다른 화면에 있으면 수수께끼가 아니라 **심부름**이 됩니다
   * (balance.ts `CRACKED_WALL` 의 산나비 문단 — *"열쇠가 어디 있지"* 로
   * 질문이 바뀌는 순간 이 물건의 값이 사라집니다).
   *
   * 두 가지를 **따로** 묻습니다. 처방이 다르기 때문입니다:
   *   · 폭발 반경 안 — **닿는가**(안 닿으면 답이 아예 아닙니다)
   *   · 카메라 안   — **보이는가**(닿아도 안 보이면 못 알아봅니다)
   */
  const toughs = walls.filter((w) => w.tough)
  if (toughs.length > 0) {
    const blast = barrels.blast
    for (const w of toughs) {
      const near = barrels.barrels
        .map((b) => ({ b, d: Math.hypot(b.x - w.x, b.z - w.z) }))
        .sort((p, q) => p.d - q.d)[0]
      check(
        !!near && near.d <= blast + 1,
        `🧱💥 두꺼운 벽에 **폭발이 닿는 통이 있다** (반경 ${blast}m)`,
        near ? `가장 가까운 통 ${near.d.toFixed(1)}m` : '통이 하나도 없습니다',
      )
      check(
        !!near && near.d <= eye,
        `🧱💥 그 통이 **같은 화면에 있다** (카메라 ${eye}m — 답이 다른 화면이면 심부름입니다)`,
        near ? `${near.d.toFixed(1)}m` : '-',
      )
    }
  } else {
    check(false, '🧱💥 이 존에 **두꺼운 벽이 있다**', '0개 — 못 잰 것이지 통과가 아닙니다')
  }
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
     * ── ⑥⑦ **두꺼운 벽은 칼을 거절하고 폭발에 열리는가** ────────────
     *
     * 위 ①~⑤ 는 전부 **금 간 벽**을 잽니다. 두꺼운 벽의 계약은 정반대라
     * 따로 물어야 합니다 — 그리고 **둘 다** 물어야 합니다:
     *
     *   ⑥ 칼로 쳐도 **안 열린다**  — 안 그러면 두 벽이 같은 물건입니다
     *   ⑦ 폭발이면 **열린다**      — 안 그러면 답이 없는 벽입니다
     *
     * ⑥만 재면 *"아무것도 안 통하는 벽"* 도 통과합니다. ⑦만 재면
     * *"칼로도 되는데 폭발로도 되는 벽"* 이 통과합니다. 한 칸에 담으면
     * 어느 쪽이 깨졌는지 못 가릅니다.
     *
     * ⚠️ **⑤(페이지 다시 열기)보다 앞에 둡니다.** 처음에 뒤에 뒀다가
     *    ⑥이 **거짓 초록**이 났습니다 — 다시 연 페이지에서는 휘두르기
     *    입력이 안 먹어서(이 파일 첫머리에 이미 적어 둔 현상) 칼이
     *    한 번도 안 닿았고, 그래서 *"칼로 안 열렸다"* 가 참이 되어
     *    버렸습니다. **아무것도 안 한 것이 통과로 읽힌** 것입니다.
     *    ⑦이 *"터진 통 0개"* 를 같이 찍어 준 덕에 들켰습니다 —
     *    실패한 검사가 옆 검사의 거짓 초록을 잡아낸 셈입니다.
     *
     * ⚠️ **②(금 간 벽 부수기)보다도 앞에 둡니다.** ② 뒤에 두면 ⑦ 이
     *    통을 쳐도 **불이 안 붙습니다**(도화선 0.00 · 터진 통 0개).
     *    ⑥ 을 건너뛰어도 같았으므로 원인은 ⑥ 이 아니라 ② 입니다.
     *    **원인은 못 밝혔습니다** — 새 페이지에서 곧바로 통을 치면
     *    멀쩡히 터집니다. 이 파일 첫머리의 *"휘두르기는 첫 goto 뒤에"* 와
     *    같은 계열의 현상으로 보고, **모르는 것을 안다고 적지 않고**
     *    순서로 피합니다. 다음에 이 자리를 건드리는 사람이 재현할 수
     *    있도록 증상을 그대로 남깁니다.
     */
    if (toughs.length > 0) {
      const tw = toughs[0]
      /**
       * ⚠️ **열쇠로 찾습니다, 「두꺼운가」로 찾지 않습니다.**
       *
       * `tough` 는 **몸통**이 아는 사실이라(`CrackedWall.tough`), 벽이
       * 부서져 몸통이 사라지면 **false 로 바뀝니다.** 그래서 `find(v =>
       * v.tough)` 로 찾으면 폭발 뒤에 **아무것도 못 찾고**, 이 검사는
       * *"안 열렸다"* 고 보고합니다 — 실제로 그렇게 한 번 빨개졌습니다.
       * 부서진 뒤에도 남는 것은 **열쇠와 열림 상태**뿐입니다.
       */
      const sword = await page.evaluate(async ({ wx, wz, key }) => {
        const g = window.__game
        const sleep = () => new Promise((r) => setTimeout(r, 40))
        /**
         * ── ⚠️ **「칼로 열렸습니다」의 정체를 찾았습니다** ─────────────────
         *
         * 이 파일 위쪽에 *"원인은 못 밝혔습니다"* 라고 적어 둔 흔들림입니다.
         * 프레임마다 찍어 보니 이랬습니다:
         *
         *     세워 놓고 한 번 휘두름 → **통(-11,-23)의 도화선이 0.7초**
         *     그리고 플레이어가 **동쪽으로** 0.9m 씩 밀려납니다(파고들기)
         *
         * 벽은 **칼로 안 열렸습니다.** 등 뒤의 통이 켜졌고, 그 폭발이
         * 연 것입니다. 왜 통 쪽을 쳤나 — **조준이 유지되지 않습니다.**
         * `aimAtWorld` 를 한 번 부르고 300ms 를 기다리면, 그 사이에
         * 몸 방향이 **다른 값으로 돌아가 있습니다**(측정: 벽 쪽 −1.57 이
         * 아니라 2.06 — 동북동). 그 방향으로 파고들다 통을 칩니다.
         *
         * ⚠️ **처음엔 소프트 락온이 통을 문 줄 알았습니다.** 서는 자리를
         *    0.9m 로 당겨 벽이 더 가깝게 만들었는데 **그대로 빨갰습니다.**
         *    코드를 보니 `assistAim` 은 `livingEnemies` 만 봅니다 — 통은
         *    후보에도 안 듭니다. 틀린 진단이었고, 고쳐 적습니다.
         *
         * 고침: **휘두르기 직전마다 다시 겨눕니다.** 그러면 1.6m 그대로
         * 통은 세 번 다 안 켜지고(도화선 0), 벽도 안 열립니다.
         *
         * ⚠️ 통을 치우는 것으로 피하지 않았습니다. 그 통은 ⑦ 이 **답**으로
         *    쓰는 물건이고, 치우면 이 파일이 재는 것이 게임이 아니게 됩니다.
         */
        g.teleportPlayer(wx + 1.6, wz)
        g.aimAtWorld(wx, wz)
        /**
         * ⚠️ **몸이 돌 시간을 줍니다.** 순간이동 직후에는 아직 옛 방향을
         *    보고 있어서, 곧바로 휘두르면 부채꼴이 벽을 안 덮습니다.
         *    40ms 로 두었다가 ⑦ 이 *"터진 통 0개"* 를 찍어서 알았습니다.
         */
        await new Promise((r) => setTimeout(r, 300))
        for (let i = 0; i < 3; i++) {
          // 🎯 **매번 다시 겨눕니다** — 한 번 겨눈 방향은 유지되지 않습니다(위 노트).
          g.aimAtWorld(wx, wz)
          await new Promise((r) => setTimeout(r, 120))
          g.press('Mouse0')
          g.release('Mouse0')
          await new Promise((r) => setTimeout(r, 700))
        }
        const w = g.walls().find((v) => v.key === key)
        return { open: w?.open ?? true, standing: w?.standing ?? false }
      }, { wx: tw.x, wz: tw.z, key: tw.key })
      check(
        !sword.open,
        '⑥ 두꺼운 벽은 **칼로 세 번 쳐도 안 열린다** (거절을 배울 수 있게)',
        sword.open ? '**칼로 열렸습니다** — 금 간 벽과 같은 물건입니다' : '닫힘 · 몸통 그대로',
      )

      const boom = await page.evaluate(async (key) => {
        const g = window.__game
        const sleep = () => new Promise((r) => setTimeout(r, 40))
        const w0 = g.walls().find((v) => v.key === key)
        const info = g.barrelInfo()
        const near = info.barrels
          .map((b) => ({ b, d: Math.hypot(b.x - w0.x, b.z - w0.z) }))
          .sort((p, q) => p.d - q.d)[0]
        if (!near) return { open: false, lit: false, why: '통이 없습니다' }
        // 통을 쳐서 불을 붙이고 — 도화선이 다 탈 때까지 기다립니다.
        /**
         * ── ⚠️ **서는 자리를 「+x 로 1.6m」로 짓지 않습니다** ──────────────
         *
         * 두꺼운 벽이 새 자리로 옮겨간 뒤 이 검사가 **흔들렸습니다**
         * (같은 코드로 초록·빨강). 이유는 새 통의 동쪽 칸이 **한 단 높기**
         * 때문입니다 — `+x 로 1.6m` 가 하필 그 턱 위였고, 그 자리에서
         * 휘두르면 판정이 들쭉날쭉했습니다.
         *
         * 방향을 지어내지 않고 **게임에게 묻습니다**: 네 방향 중
         *   · 걸어갈 수 있고
         *   · 통과 **같은 지형 단**에 있는
         * 자리를 씁니다. 그러면 통이 어디로 옮겨가도 이 검사가 따라옵니다.
         */
        const lvl = g.terrainLevelAt(near.b.x, near.b.z)
        const spot =
          [
            [1.8, 0],
            [-1.8, 0],
            [0, 1.8],
            [0, -1.8],
          ]
            .map(([ox, oz]) => ({ x: near.b.x + ox, z: near.b.z + oz }))
            .find((q) => g.walkableFromPlayer(q.x, q.z) && g.terrainLevelAt(q.x, q.z) === lvl) ??
          { x: near.b.x + 1.6, z: near.b.z }
        g.teleportPlayer(spot.x, spot.z)
        await new Promise((r) => setTimeout(r, 300))
        /**
         * 🎯 ⑥ 과 **같은 이유로** 휘두르기 직전에 다시 겨눕니다 — 한 번
         * 겨눈 방향은 유지되지 않습니다. 여기도 같은 병을 앓고 있었고,
         * ⑥ 을 고치자마자 이쪽이 빨개져서 드러났습니다(예전에는 ⑥ 이
         * **벽을 미리 열어 놓아서** 이 검사가 공짜로 통과했습니다).
         * 두 번 휘두르는 것은 한 번이 빗나가도 되게 하려는 것입니다.
         */
        for (let i = 0; i < 2; i++) {
          g.aimAtWorld(near.b.x, near.b.z)
          await new Promise((r) => setTimeout(r, 120))
          g.press('Mouse0')
          g.release('Mouse0')
          await new Promise((r) => setTimeout(r, 400))
        }
        // ⚠️ 폭발에 휘말리지 않게 물러납니다 — 재려는 것은 벽이지 플레이어가 아닙니다.
        // 물러나는 것도 같은 방향의 반대쪽으로 — 폭발에 안 휘말리게.
        g.teleportPlayer(
          near.b.x + (spot.x - near.b.x) * 6,
          near.b.z + (spot.z - near.b.z) * 6,
        )
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 100))
          const w = g.walls().find((v) => v.key === key)
          if (w?.open) return { open: true, lit: true }
        }
        const w = g.walls().find((v) => v.key === key)
        return {
          open: w?.open ?? false,
          lit: true,
          why:
            `통 ${info.barrels.length}개 · 터진 ${g.barrelInfo().blown}개` +
            ` · 노린 통(${near.b.x.toFixed(1)},${near.b.z.toFixed(1)}) 도화선 ${(g.barrelInfo().barrels.find((b) => Math.abs(b.x - near.b.x) < 0.1)?.fuseT ?? -1).toFixed(2)}` +
            ` · 내 자리(${g.state().player.x.toFixed(1)},${g.state().player.z.toFixed(1)}) 체력 ${g.state().player.hp.toFixed(0)}`,
        }
      }, tw.key)
      check(
        boom.open,
        '⑦ **폭발이면 열린다** (거절에는 답이 있어야 합니다)',
        boom.open ? '열림' : `**안 열렸습니다** — 답이 없는 벽입니다 (${boom.why ?? '?'})`,
      )
    }

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

    const swung = await page.evaluate(async ({ ox, oz, key }) => {
      const g = window.__game
      const wall = g.walls().find((v) => v.key === key)
      g.teleportPlayer(ox, oz)
      // 조준은 커서로 합니다 — 실제 조작과 같은 길이라야 「칠 수 있다」가 참말입니다.
      g.aimAtWorld(wall.x, wall.z)
      await new Promise((r) => setTimeout(r, 300))
      /**
       * ⚠️ **세 번 누릅니다 — 「한 대면 열린다」를 세 대로 재는 것이 아닙니다.**
       *
       * 한 번만 누르면 **눌린 것이 판정까지 갔는지**를 이 프로브가 알 수
       * 없습니다(순간이동 직후의 방향 수렴·콤보 창·히트스톱이 전부
       * 첫 입력을 삼킬 수 있습니다). 실제로 검사 순서를 바꿀 때마다
       * *"한 대로는 안 열렸습니다"* 가 자리를 옮겨 다녔습니다 —
       * **입력이 안 들어간 것을 벽 탓으로 읽고 있었습니다.**
       *
       * 「한 대면 열린다」는 여기가 아니라 **⑥ 이 재고 있습니다**:
       * 두꺼운 벽은 세 대를 쳐도 안 열립니다. 두 검사를 나란히 두면
       * *"칼 세 번에 하나는 열리고 하나는 안 열린다"* 가 되어, 재려던
       * **차이**가 그대로 남습니다.
       */
      for (let i = 0; i < 3; i++) {
        g.press('Mouse0')
        g.release('Mouse0')
        await new Promise((r) => setTimeout(r, 700))
      }
      return { open: g.walls().find((v) => v.key === key)?.open ?? true }
    }, { ox: outside.x, oz: outside.z, key: w.key })
    check(swung.open, '② 금 간 벽은 **칼로 열린다** (열쇠도 폭탄도 없이 — ⑥ 과 짝)', swung.open ? '열림' : '한 대로는 안 열렸습니다')

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
