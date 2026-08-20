/**
 * 인지 신호 검증 — `npm run notice`
 *
 * ── 왜 이 프로브가 필요한가 ────────────────────────────────────────
 * 지난 라운드에 인지 규칙을 셋 실었습니다 — 시야, 발소리, 고함. 그리고
 * `src/render` 와 `src/ui` 를 통틀어 `aggro` 라는 낱말이 **한 번도**
 * 안 나온다는 것을 이번에 발견했습니다. 즉 규칙은 다 도는데 플레이어가
 * 알 수 있는 것은 **하나도 없었습니다.**
 *
 * 그건 난이도가 아니라 **운**입니다. 이 저장소가 이미 한 번 적어 둔
 * 문장이 그대로 다시 맞습니다: *"게임이 자기 규칙을 한 번도 설명하지
 * 않고 있었습니다."*
 *
 * ── 이 프로브가 지키는 두 가지 ─────────────────────────────────────
 * ① **화면이 규칙과 같은 말을 하는가** — 표시가 뜨고, 규칙이 바뀌는
 *    순간 같이 바뀌는가. 특히 발소리 링의 반지름이 게임이 실제로 쓰는
 *    청각 거리와 **같은 값**인가.
 * ② **그게 사람 눈에 실제로 보이는가** — 이 저장소는 색을 원본 값으로
 *    고쳤다가 화면에서는 더 나빠진 적이 있습니다. 그래서 마지막엔
 *    **픽셀을 찍어서** 확인합니다.
 *
 * ⚠️ 규칙 숫자를 하나도 베껴 적지 않습니다. 전부 `awareInfo()` 로
 *    게임에게 묻습니다 — 베껴 적는 순간 이 파일이 "또 하나의 진실"이
 *    되어 검사할 것이 없어집니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { decodePng, deltaE } from './png.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5216
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
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n👀 인지 신호 검증 — 규칙이 아니라 **화면**을 읽습니다\n')

  const cfg = await page.evaluate(() => window.__game.awareInfo())
  console.log(
    `  [규칙] 시야 ${cfg.frontArcDeg}° · 청각 ${cfg.hearQuiet}~${cfg.hearLoud}m · ` +
      `고함 ${cfg.alertRadius}m · 표시 거리 ${cfg.markRange ?? '?'}m\n`,
  )

  // ---- 1. 못 본 적에게 표시가 뜨는가 ----
  //
  // 무대를 먼저 세웁니다: 아레나는 잡몹 어그로가 55m 라 **항상 깨어
  // 있습니다**(flank 프로브가 배운 것). 존과 같은 14m 로 덮어씁니다.
  const mark = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    const now = () => G.state().simElapsed
    const wait = async (sec) => {
      const t0 = now()
      const dl = Date.now() + 30000
      while (now() - t0 < sec && Date.now() < dl) await sleep()
    }
    G.reset()
    G.setAggroRange(14)
    await wait(0.5)
    G.clearEnemies()
    await wait(0.3)
    const p = G.state().player
    // 표시 거리 안, 어그로 거리 밖은 아니어야 하므로 적당히 가까이.
    // 재워서 낳습니다 — 실험대 스폰의 기본은 깨어 있는 적입니다(main.ts).
    const e = G.spawnEnemyKind('grunt', p.x + 5, p.z, true)
    await wait(0.5)
    const asleep = { ...G.awareInfo(), aggro: G.enemyInfo(e)?.aggro }
    // 같은 적을 깨우면 표시가 **사라져야** 합니다 — 이 껐다/켰다가 규칙입니다.
    G.wakeEnemy(e)
    await wait(0.4)
    const awake = { ...G.awareInfo(), aggro: G.enemyInfo(e)?.aggro }
    G.clearEnemies()
    return { asleep, awake }
  })
  console.log(
    `  [못 본 적 표시] 자고 있을 때 ${mark.asleep.marks}개(aggro ${mark.asleep.aggro}) · ` +
      `깨운 뒤 ${mark.awake.marks}개(aggro ${mark.awake.aggro})`,
  )
  check(
    mark.asleep.aggro === false && mark.asleep.marks >= 1,
    '아직 나를 못 본 적에게 표시가 뜬다 (기회가 보인다)',
    `표시 ${mark.asleep.marks}개`,
  )
  /**
   * ⚠️ 이 아래 줄이 이 검사쌍의 **전부**입니다. 표시가 뜨기만 하고 안
   *    꺼지면 그건 정보가 아니라 장식입니다 — 플레이어는 "이 표시는 늘
   *    있는 것"으로 배우고, 정작 사라지는 순간을 못 읽습니다.
   */
  check(
    mark.awake.aggro === true && mark.awake.marks === 0,
    '깨어나는 순간 표시가 **꺼진다** (기회가 닫힌 것이 보인다)',
    `표시 ${mark.awake.marks}개`,
  )

  // ---- 2. 발소리 링이 규칙과 **같은 값**을 그리는가 ----
  //
  // 화면이 자기 식을 갖는 순간 "보이는 대로 했는데 들키는" 경험이
  // 시작됩니다. 그건 버그보다 나쁩니다 — 플레이어가 배운 것이 틀린 게
  // 되니까요. 그래서 그려진 반지름과 게임이 쓰는 값을 직접 견줍니다.
  const ring = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    const now = () => G.state().simElapsed
    const wait = async (sec) => {
      const t0 = now()
      const dl = Date.now() + 30000
      while (now() - t0 < sec && Date.now() < dl) await sleep()
    }
    /**
     * ⚠️ **매번 제자리로 되돌려 놓고 달립니다.**
     *    처음엔 걷기 다음에 곧바로 달렸다가 물렸습니다 — 달리면 1.2초에
     *    10m 를 가서 **적이 링을 켜는 거리 밖으로 밀려납니다.** 링이 0으로
     *    찍혔고, 하마터면 "질주에서 링이 고장난다"고 적을 뻔했습니다.
     *    재려는 것은 속도지 이동 거리가 아닙니다.
     */
    let home = null
    let watch = -1
    const watchDist = () => {
      const i = G.enemyInfo(watch)
      const s = G.state().player
      return i ? Number(Math.hypot(i.x - s.x, i.z - s.z).toFixed(1)) : -1
    }
    const move = async (sprint, sec) => {
      if (home) G.teleportPlayer(home.x, home.z)
      await wait(0.15)
      if (sprint) G.press('ShiftLeft')
      G.press('KeyD')
      await wait(sec)
      const snap = { ...G.awareInfo(), aggro: G.enemyInfo(watch)?.aggro, dist: watchDist() }
      G.release('KeyD')
      if (sprint) G.release('ShiftLeft')
      await wait(0.25)
      return snap
    }
    G.reset()
    /**
     * ⚠️ **무대를 두 조건 사이에 끼워 넣어야 합니다.** 링을 켜 두려면
     *    근처에 못 본 적이 있어야 하는데(설계 노트), 그 적이 **깨면 안
     *    됩니다.** 즉 적은 `시야 거리 < 거리 < 링을 켜는 거리` 에 있어야
     *    합니다.
     *
     *    처음엔 시야를 14m 로 두고 적을 13m 에 세웠다가 물렸습니다 —
     *    적은 스폰할 때 원점(=플레이어 쪽)을 보므로 **정면 13m 는 그냥
     *    보입니다.** 링이 0으로 나왔고, 자칫 "링이 고장났다"고 결론 낼
     *    뻔했습니다. 게임이 아니라 무대가 틀렸습니다.
     */
    const sight = 10
    G.setAggroRange(sight)
    await wait(0.5)
    G.clearEnemies()
    await wait(0.3)
    const p = G.state().player
    // 시야보다 조금만 멀리 — 달리는 동안 링 거리 밖으로 나가지 않게.
    const far = sight + 1.5
    const e = G.spawnEnemyKind('grunt', p.x, p.z + far, true)
    home = { x: p.x, z: p.z }
    watch = e
    await wait(0.4)
    const still = { ...G.awareInfo(), aggro: G.enemyInfo(e)?.aggro, dist: watchDist() }
    // 달리기는 붙는 데 시간이 걸립니다(PLAYER.sprint.rampUp) — 넉넉히 줍니다.
    /**
     * ⚠️ **달리는 시간을 짧게 잡습니다.** 쿼터뷰라 `KeyD` 는 화면 기준
     *    오른쪽 = 월드에서는 **대각선**입니다. 0.9초를 달리면 적이 링을
     *    켜는 거리(16m) 밖으로 나가서 링이 꺼지고, 그러면 재는 것이
     *    "속도"가 아니라 "얼마나 멀리 갔나"가 됩니다.
     *    질주는 0.3초면 최고 속도에 붙으므로(PLAYER.sprint.rampUp)
     *    0.5초면 충분합니다 — 아래 출력의 m/s 가 그걸 증명합니다.
     */
    const walk = await move(false, 0.6)
    const run = await move(true, 0.5)
    G.clearEnemies()
    return { still, walk, run, spawned: e >= 0 }
  })
  console.log(
    `  [발소리 링] 멈춤 ${ring.still.noiseRadius}m(규칙 ${ring.still.hearNow}m) · ` +
      `걷기 ${ring.walk.noiseRadius}m(규칙 ${ring.walk.hearNow}m, ${ring.walk.playerSpeed.toFixed(1)} m/s) · ` +
      `달리기 ${ring.run.noiseRadius}m(규칙 ${ring.run.hearNow}m, ${ring.run.playerSpeed.toFixed(1)} m/s)\n` +
      `                 [무대] 멈춤 aggro=${ring.still.aggro}/${ring.still.dist}m · 걷기 aggro=${ring.walk.aggro}/${ring.walk.dist}m · 달리기 aggro=${ring.run.aggro}/${ring.run.dist}m`,
  )
  const sameAsRule = (s) => s.noiseVisible && Math.abs(s.noiseRadius - s.hearNow) <= 0.06
  check(
    sameAsRule(ring.still) && sameAsRule(ring.walk) && sameAsRule(ring.run),
    '그려진 링 = 게임이 쓰는 청각 거리 (화면이 자기 식을 갖지 않는다)',
    `세 상태 모두 오차 0.06m 이내`,
  )
  /**
   * 이 줄이 새 **선택**(걷기 ↔ 질주)이 화면에 존재하는지를 묻습니다.
   * 링이 늘 같은 크기면 규칙은 돌지만 플레이어에게는 없는 것입니다.
   */
  check(
    ring.run.noiseRadius > ring.walk.noiseRadius && ring.walk.noiseRadius > ring.still.noiseRadius,
    '빠를수록 링이 커진다 (걷기와 질주가 눈에 보이는 선택이 된다)',
    `멈춤 ${ring.still.noiseRadius} < 걷기 ${ring.walk.noiseRadius} < 달리기 ${ring.run.noiseRadius}`,
  )

  // ---- 3. 링은 **필요할 때만** 떠 있는가 ----
  //
  // 싸움이 붙은 뒤에도 계속 깔리면 정보가 아니라 방해입니다. 이 게임은
  // 바닥을 예고 부채꼴에 쓰고 있어서 특히 그렇습니다.
  const quiet = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    const now = () => G.state().simElapsed
    const wait = async (sec) => {
      const t0 = now()
      const dl = Date.now() + 30000
      while (now() - t0 < sec && Date.now() < dl) await sleep()
    }
    G.reset()
    G.setAggroRange(14)
    await wait(0.5)
    G.clearEnemies()
    await wait(0.5)
    // 못 본 적이 하나도 없는 상태 — 링이 꺼져 있어야 합니다.
    return G.awareInfo()
  })
  check(
    quiet.noiseVisible === false,
    '못 본 적이 없으면 링이 꺼진다 (평소 바닥을 안 잡아먹는다)',
    `링 ${quiet.noiseVisible ? '켜짐' : '꺼짐'}`,
  )

  // ---- 4. 그래서 **화면에 실제로 보이는가** (픽셀) ----
  /**
   * 이 저장소는 색을 원본 값에서 고쳤다가 화면에서는 오히려 나빠진 적이
   * 있습니다(23.5 → 20.8). 그 뒤로 규칙은 하나입니다 — **눈으로 재는 것은
   * 눈이 보는 자리에서 잰다.** `visible === true` 는 "그리라고 시켰다"일
   * 뿐이고, 실제로 보이는지는 픽셀만 압니다.
   *
   * 같은 자리를 표시 **있을 때 / 없을 때** 두 번 찍어 견줍니다.
   * 적을 지우면 바닥만 남으므로, 그 차이가 곧 표시의 값어치입니다.
   */
  const shotSpots = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    const now = () => G.state().simElapsed
    const wait = async (sec) => {
      const t0 = now()
      const dl = Date.now() + 30000
      while (now() - t0 < sec && Date.now() < dl) await sleep()
    }
    G.reset()
    G.setAggroRange(14)
    await wait(0.5)
    G.clearEnemies()
    await wait(0.3)
    const p = G.state().player
    // 재워서 낳습니다 — 실험대 스폰의 기본은 깨어 있는 적입니다(main.ts).
    const e = G.spawnEnemyKind('grunt', p.x + 5, p.z, true)
    await wait(0.5)
    const info = G.enemyInfo(e)
    if (!info) return null
    // 링은 몸 **바깥**에 있습니다 — 몸을 찍으면 표시가 아니라 적을 재게 됩니다.
    const r = G.enemyRoster().find((x) => x.id === 'grunt')?.radius ?? 0.5
    const out = []
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      const rr = r + 0.27
      const s = G.screenPos(info.x + Math.cos(a) * rr, 0.05, info.z + Math.sin(a) * rr)
      if (s) out.push(s)
    }
    return { spots: out, entity: e }
  })
  if (!shotSpots) {
    check(false, '표시 픽셀을 잴 무대가 섰다', '적을 못 세웠습니다')
  } else {
    await page.evaluate(() => window.__game.setPaused(true))
    const withMark = await page.screenshot()
    await page.evaluate(() => window.__game.setPaused(false))
    // 표시만 지웁니다 — 적은 그대로 두고 깨워서, 차이가 **표시 하나**가 되게.
    await page.evaluate(
      async ([e]) => {
        const G = window.__game
        G.wakeEnemy(e)
        const t0 = G.state().simElapsed
        while (G.state().simElapsed - t0 < 0.4) await new Promise((r) => setTimeout(r, 8))
      },
      [shotSpots.entity],
    )
    await page.evaluate(() => window.__game.setPaused(true))
    const without = await page.screenshot()
    await page.evaluate(() => window.__game.setPaused(false))

    const a = decodePng(without)
    const b = decodePng(withMark)
    let n = 0
    const off = [0, 0, 0]
    const on = [0, 0, 0]
    for (const s of shotSpots.spots) {
      const x = Math.round(s.sx)
      const y = Math.round(s.sy)
      if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue
      const i = (y * a.width + x) * 4
      off[0] += a.data[i]
      off[1] += a.data[i + 1]
      off[2] += a.data[i + 2]
      on[0] += b.data[i]
      on[1] += b.data[i + 1]
      on[2] += b.data[i + 2]
      n++
    }
    if (n < 6) {
      check(false, '표시 픽셀을 잴 무대가 섰다', `쓸 수 있는 점 ${n}개`)
    } else {
      const offC = off.map((v) => Math.round(v / n))
      const onC = on.map((v) => Math.round(v / n))
      const d = deltaE(onC, offC)
      console.log(
        `  [픽셀] 표시 있음 rgb(${onC.join(',')}) · 없음 rgb(${offC.join(',')}) · 차이 ΔE ${d.toFixed(1)} (${n}점)`,
      )
      /**
       * 기준 3.0 의 근거: ΔE 2~3 은 **나란히 놓고 봐야** 구분되는 차이라
       * "정보"라고 부를 수 없습니다. 예고 부채꼴이 지키는 값(대비 프로브)
       * 보다는 낮게 잡습니다 — 예고는 **답해야 하는** 신호라 더 세야 하고,
       * 이건 **기회**를 알리는 신호라 조용해도 됩니다. 조용하되 **있기는
       * 있어야** 한다는 것이 이 줄입니다.
       */
      check(d >= 3, '그 표시가 화면에서 실제로 구분된다 (ΔE ≥ 3)', `ΔE ${d.toFixed(1)}`)
    }
  }

  /**
   * ── 🎥 **화면 밖에서 시작되는 일은 없어야 합니다** ──────────────────
   *
   * ── 왜 이 검사가 필요한가 ──────────────────────────────────────
   * 이 프로브의 나머지는 *"게임이 신호를 그리는가"* 를 봅니다. 그런데
   * 신호가 **화면 밖에서** 그려지면 그린 적도 없는 것과 같습니다.
   *
   * 이 게임에는 서로 모르는 두 숫자가 있습니다:
   *   · `CAMERA.viewSize` — 화면이 담는 세계의 크기 (읽기 쉬움이 정한 값)
   *   · 존의 시야 거리 — 적이 나를 알아채는 거리 (전투 리듬이 정한 값)
   * 둘은 **다른 이유로** 정해졌는데, 지켜야 할 관계가 하나 있습니다:
   * *"적이 나를 알아채는 순간, 그 적이 화면 안에 있어야 한다."*
   * 안 그러면 「들킴」 파문도 「못 본 적」 표시도 안 보이는 곳에서
   * 소비되고, 플레이어에게는 적이 **이미 화난 채로 등장**합니다.
   *
   * 아무도 이 관계를 안 적어 뒀고, 재 보니 **2% 차이로 어긋나** 있었습니다.
   * 우연히 맞거나 틀리는 자리를 그대로 두면, viewSize 나 시야 거리를
   * 손보는 날 아무 말 없이 깨집니다.
   *
   * ── 무엇을 어떻게 재는가 ──────────────────────────────────────
   * 카메라 행렬은 **게임에게 물어봅니다**(`screenPos`). 여기서 직교 투영을
   * 흉내 내면, 카메라를 손보는 날 이 검사만 옛 카메라를 지킵니다.
   * 360 방향으로 한 도씩 걸어 나가며 화면을 벗어나는 거리를 찾습니다.
   *
   * ⚠️ 커서는 **플레이어 위에** 둡니다 — 가장 불리한 자리입니다.
   *    카메라는 커서 쪽으로 최대 `aimLeadMax` 만큼 밀리므로, 실제
   *    플레이에서는 가는 쪽을 보면 그만큼 더 보입니다. 그 여유를
   *    **기본값으로 세면 안 됩니다**(플레이어가 안 쓸 수도 있습니다).
   *
   * ── 문턱을 둘로 나눈 이유 ─────────────────────────────────────
   *   ① **달릴 때는 커서 없이도** 모든 방향이 들어와야 합니다. 달리기는
   *      모르는 땅을 가장 빨리 지나는 상태이고, 시간이 가장 없습니다.
   *      (그래서 카메라도 달릴 때 넓어집니다 — 그 장치가 정말 갚는지를
   *       여기서 확인하는 셈입니다.)
   *   ② **걸을 때는 커서 리드까지 써서** 들어오면 됩니다. 걸음은
   *      느리고, 가는 쪽을 보는 것은 플레이어가 실제로 쓸 수 있는 수단입니다.
   * 걷기의 맨눈 수치는 **걸지 않고 장부로만** 남깁니다 — 지금 값이
   * 아슬아슬하다는 사실 자체를 숨기지 않으려는 것입니다.
   */
  {
    const view = await page.evaluate(async () => {
      const G = window.__game
      G.teleportPlayer(0, 0)
      await new Promise((r) => setTimeout(r, 400))
      const p = G.state().player
      const vw = window.innerWidth
      const vh = window.innerHeight
      const seeAlong = (dx, dz) => {
        let last = 0
        for (let d = 0.5; d <= 60; d += 0.25) {
          const s = G.screenPos(p.x + dx * d, p.y, p.z + dz * d)
          if (!s || s.sx < 0 || s.sx > vw || s.sy < 0 || s.sy > vh) break
          last = d
        }
        return last
      }
      const rows = []
      for (let deg = 0; deg < 360; deg++) {
        const a = (deg * Math.PI) / 180
        rows.push({ deg, see: seeAlong(Math.sin(a), Math.cos(a)) })
      }
      const t = G.terrainInfo()
      const roster = G.enemyRoster()
      return {
        rows,
        aggro: t.levelAggroRange,
        sprintViewScale: t.sprintViewScale,
        aimLeadMax: t.aimLeadMax,
        // 몸의 굵기까지 들어와야 "보인다"입니다. 보스는 몰래 다가오지
        // 않으므로(전용 영역) 잡몹 중 가장 굵은 것으로 잽니다.
        bodyR: Math.max(...roster.filter((r) => r.id !== 'boss').map((r) => r.radius)),
      }
    })
    const worst = view.rows.reduce((a, b) => (a.see <= b.see ? a : b))
    const need = view.aggro + view.bodyR
    const bare = view.rows.filter((r) => r.see < need).length
    const sprint = view.rows.filter((r) => r.see * view.sprintViewScale < need).length
    const lead = view.rows.filter((r) => r.see + view.aimLeadMax < need).length
    console.log(
      `\n  [시야] 화면이 담는 거리 ${worst.see}~${view.rows.reduce((a, b) => (a.see >= b.see ? a : b)).see}m ` +
        `(가장 좁은 방향 ${worst.deg}°) · 적이 알아채는 거리 ${view.aggro}m + 몸 ${view.bodyR}m = ${need}m`,
    )
    console.log(
      `  [장부] 맨눈으로 걸을 때 몸이 화면에 걸치는 방향 ${bare}/360 (${(bare / 3.6).toFixed(1)}%) ` +
        `— 재되 걸지는 않습니다 (아래 두 줄이 문턱입니다)\n`,
    )
    check(
      // ⚠️ `.every` 만 쓰면 **빈 배열이 통과합니다.** 표본 수를 같이 걸어야
      //    이 줄이 게이트가 됩니다 (`npm run guard` 가 이걸 잡습니다).
      view.rows.length === 360 && view.rows.every((r) => r.see > 0),
      '🎥 360 방향을 실제로 재 봤다 (한 방향도 0으로 세지 않게)',
      `가장 좁은 ${worst.see}m · 가장 넓은 ${view.rows.reduce((a, b) => (a.see >= b.see ? a : b)).see}m`,
    )
    check(
      sprint === 0,
      '🎥 **달릴 때는 커서를 안 써도** 알아채는 적이 화면 안이다 (가장 빠른 상태에 시간이 가장 없습니다)',
      sprint === 0
        ? `달릴 때 화면 ×${view.sprintViewScale} → 가장 좁은 방향 ${(worst.see * view.sprintViewScale).toFixed(1)}m ≥ ${need}m`
        : `${sprint}/360 방향이 화면 밖`,
    )
    check(
      lead === 0,
      '🎥 걸을 때는 **가는 쪽을 보면** 알아채는 적이 화면 안이다 (커서 리드가 실제로 갚는다)',
      lead === 0
        ? `가장 좁은 ${worst.see}m + 커서 리드 ${view.aimLeadMax}m = ${(worst.see + view.aimLeadMax).toFixed(1)}m ≥ ${need}m`
        : `${lead}/360 방향이 커서를 써도 화면 밖`,
    )
  }

  /**
   * ── 🚪 **깬 뒤에도 「걸어서 닿는가」를 다시 묻는가** ────────────────────
   *
   * 자동 플레이가 「무너진 회랑」에서 이걸 찍었습니다:
   *
   *     가까운적 **6.0m** · **경로 78m** · {"aggro":true,"attacking":true}
   *
   * 벽 건너 6m 에서 돌진 예고를 띄우고 있었습니다. 깨우는 판정은 걸어야
   * 하는 거리를 쓰는데 그 질문을 **한 번밖에** 안 했기 때문입니다.
   *
   * ⚠️ **자리를 좌표로 베껴 적지 않습니다.** (24,3) 은 이번 판에서 그랬던
   *    자리일 뿐이고, 존을 한 번 손보면 그 좌표는 거짓이 됩니다. 대신
   *    **성질**로 찾습니다 — *"직선은 가까운데 경로는 먼 자리"*. 그런 자리가
   *    이 존에 없으면 그건 검사가 통과할 일이 아니라 **못 잰 것**입니다.
   */
  const unreach = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 16))
    /**
     * ⚠️ **시뮬 시계로 셉니다(`simElapsed`), 벽시계가 아니라.**
     *
     * 이 파일의 다른 절들은 `state().time`(벽시계)을 씁니다. 표시가 떴는지
     * 같은 건 그걸로도 되지만, **적이 움직이는지**를 재려면 안 됩니다 —
     * SwiftShader 에서 한 프레임이 0.2초라 「1.2초」가 실제로는 **여섯
     * 프레임**입니다. 그래서 두 적 모두 스폰 자리 그대로였고, 저는 그걸
     * 「규칙이 안 돈다」로 읽어 게임을 세 번 고치려 들었습니다.
     * 게이트(「적이 실제로 움직였다」)가 없었으면 그대로 넘어갔을 자리입니다.
     */
    const now = () => G.state().simElapsed
    const wait = async (sec) => {
      const t0 = now()
      const dl = Date.now() + 40000
      while (now() - t0 < sec && Date.now() < dl) await sleep()
    }
    G.reset()
    G.setAggroRange(14)
    /**
     * 🚧 **앞 절이 남긴 스위치를 스스로 되돌립니다.**
     * 이 저장소는 켠 스위치를 안 끄고 다음 절로 넘어가 판을 통째로 망친
     * 적이 있습니다(crowd 프로브의 무적 스위치). 여기서는 값이 아니라
     * **되돌리는 것**이 공짜이므로 무조건 되돌립니다.
     */
    G.setPaused(false)
    G.freezeEnemies(false)
    await wait(0.5)
    G.clearEnemies()
    await wait(0.3)
    const rule = G.awareInfo()
    /**
     * ⚠️ **처음엔 시작 지점 둘레만 훑었고, 게이트가 「그런 자리 없음」으로
     *    잡았습니다.** 당연합니다 — 병이 난 곳은 존 안쪽의 「무너진 회랑」
     *    이고 플레이어는 입구에서 시작합니다. 자를 안 옮기고 잰 셈입니다.
     *
     * 그래서 **플레이어를 옮겨 가며** 찾습니다. (24,3) 은 자동 플레이가
     * 실제로 막혔던 자리라 **힌트로만** 먼저 넣고, 거기서 안 나오면 존을
     * 성글게 훑습니다 — 좌표가 틀려도 검사가 살아남게.
     */
    const ring = (ox, oz) => {
      let far = null
      let near = null
      for (let a = 0; a < 24 && !(far && near); a++) {
        for (const r of [4, 6, 8]) {
          const x = ox + Math.cos((a / 24) * Math.PI * 2) * r
          const z = oz + Math.sin((a / 24) * Math.PI * 2) * r
          /**
           * ⚠️ **`pathStep` 은 방향이 반대입니다.** 저건 *내가 거기로* 가는
           *    거리이고, 어그로 규칙이 쓰는 것은 *그 적이 나에게* 오는
           *    거리입니다. 한쪽으로만 내려갈 수 있는 턱이 있으면 둘이
           *    다릅니다 — 실제로 여기서 76m 를 보고 "적이 못 온다"고 읽었는데
           *    그 적은 **턱을 뛰어내려** 올 수 있었습니다. 규칙이 쓰는 값을
           *    그대로 물어봅니다.
           */
          const walk = G.walkToPlayer(x, z)
          if (walk === null) continue
          const straight = Math.hypot(x - ox, z - oz)
          if (!far && walk > straight * rule.deaggroRatio && walk > rule.deaggroMin) {
            far = { x, z, straight: Number(straight.toFixed(1)), walk: Number(walk.toFixed(1)) }
          }
          if (!near && walk < straight * 1.5) {
            near = { x, z, straight: Number(straight.toFixed(1)), walk: Number(walk.toFixed(1)) }
          }
        }
      }
      return { far, near }
    }
    const spots = [[24, 3]]
    for (let x = -56; x <= 56; x += 8) for (let z = -56; z <= 56; z += 8) spots.push([x, z])
    let far = null
    let near = null
    let stood = null
    for (const [ox, oz] of spots) {
      // 순간이동도 경로 조회도 **그 프레임에** 끝납니다 — 기다릴 것이 없습니다.
      G.teleportPlayer(ox, oz)
      const p2 = G.state().player
      // 못 서는 칸이면 게임이 다른 데로 밀어냅니다 — 그 경우 그 자리로 잽니다.
      const got = ring(p2.x, p2.z)
      if (got.far && got.near) {
        far = got.far
        near = got.near
        stood = { x: Number(p2.x.toFixed(1)), z: Number(p2.z.toFixed(1)) }
        break
      }
    }
    const probe = async (spot) => {
      if (!spot) return null
      G.clearEnemies()
      await wait(0.3)
      const e = G.spawnEnemyKind('grunt', spot.x, spot.z, true)
      await wait(0.3)
      // **깨워 놓고** 봅니다 — 이 규칙이 고치는 것은 "안 깨는 것"이 아니라
      // "깬 뒤에 다시 안 묻는 것"입니다.
      G.wakeEnemy(e)
      /**
       * ⚠️ **깨운 그 자리에서 읽습니다.** 0.2초를 기다렸다가 읽었더니
       *    「깬 적 없다」로 나왔습니다 — 규칙이 그 사이에 **이미 풀어
       *    버렸기 때문**입니다. 게이트가 성공을 실패로 읽고 있었습니다.
       */
      const woke = G.enemyInfo(e)?.aggro
      await wait(2.0)
      const inf = G.enemyInfo(e)
      const later = inf?.aggro
      // 🚪 **AI 가 이 적을 몇 미터로 보고 있는가.** 프로브가 따로 계산한
      //    값과 어긋나면, 규칙이 아니라 **자가 다른 것**입니다.
      const aiWalk = inf?.walk ?? null
      // 끝 시점의 **직선거리**도 같이 냅니다. 문턱은 비(比)라서, 적이
      // 옆으로 밀려나 직선이 커지면 같은 경로거리로도 안 풀립니다.
      const pp = G.state().player
      const straightEnd = inf ? Math.hypot(inf.x - pp.x, inf.z - pp.z) : null
      G.clearEnemies()
      return {
        woke,
        later,
        aiWalk: aiWalk === null ? null : Number(aiWalk.toFixed(1)),
        straightEnd: straightEnd === null ? null : Number(straightEnd.toFixed(1)),
        state: inf?.state ?? null,
      }
    }
    const farR = await probe(far)
    const nearR = await probe(near)
    // 🚧 **AI 가 실제로 돌았는가.** 두 적이 1.2초 동안 한 발도 안 움직였다면
    //    이 판은 규칙을 잰 것이 아니라 **멈춘 게임**을 잰 것입니다.
    const fired = G.runStats().deaggroUnreachable ?? 0
    const aiOn = G.awareInfo().enemyAiOn
    return { rule: { ratio: rule.deaggroRatio, min: rule.deaggroMin }, far, near, farR, nearR, stood, fired, aiOn }
  })
  console.log(
    `\n  [깬 뒤에 다시 묻기 — 문턱 직선의 ${unreach.rule.ratio}배 & ${unreach.rule.min}m 초과] 선 자리 ${unreach.stood ? `(${unreach.stood.x}, ${unreach.stood.z})` : '못 찾음'}\n` +
      `    벽 너머   ${unreach.far ? `직선 ${unreach.far.straight}m · 경로 ${unreach.far.walk}m (${(unreach.far.walk / unreach.far.straight).toFixed(1)}배)` : '— 그런 자리를 못 찾음'}` +
      `${unreach.farR ? ` → 깨움 ${unreach.farR.woke} · 2초 뒤 **${unreach.farR.later}** · AI가 본 거리 ${unreach.farR.aiWalk}m · 끝 직선 ${unreach.farR.straightEnd}m(상태 ${unreach.farR.state})` : ''}\n` +
      `    같은 쪽   ${unreach.near ? `직선 ${unreach.near.straight}m · 경로 ${unreach.near.walk}m (${(unreach.near.walk / unreach.near.straight).toFixed(1)}배)` : '— 그런 자리를 못 찾음'}` +
      `${unreach.nearR ? ` → 깨움 ${unreach.nearR.woke} · 2초 뒤 **${unreach.nearR.later}** · AI가 본 거리 ${unreach.nearR.aiWalk}m · 끝 직선 ${unreach.nearR.straightEnd}m(상태 ${unreach.nearR.state})` : ''}\n`,
  )
  check(
    unreach.far !== null && unreach.near !== null,
    '🚧 벽 너머 자리와 같은 쪽 자리를 **둘 다 찾았다** (비교의 게이트 — 한쪽만으로는 아무 말도 못 합니다)',
    `벽 너머 ${unreach.far ? '있음' : '없음'} · 같은 쪽 ${unreach.near ? '있음' : '없음'}`,
  )
  check(
    unreach.nearR !== null && unreach.near !== null && unreach.nearR.straightEnd !== unreach.near.straight,
    '🚧 **적이 실제로 움직였다** = AI 가 돌았다 (멈춘 게임을 재고 규칙 탓을 하지 않게)',
    `같은 쪽 ${unreach.near?.straight}m → ${unreach.nearR?.straightEnd}m · AI 켜짐 ${unreach.aiOn} · 규칙이 푼 횟수 ${unreach.fired}`,
  )
  check(
    unreach.farR?.woke === true && unreach.nearR?.woke === true,
    '🚧 두 적 **모두 실제로 깼다** (안 깬 것을 「풀렸다」로 읽지 않게)',
    `벽 너머 ${unreach.farR?.woke} · 같은 쪽 ${unreach.nearR?.woke}`,
  )
  check(
    unreach.farR?.later === false,
    '🚪 **걸어서 못 오는 적은 나를 놓는다** (대응할 수 없는 예고는 난이도가 아니라 노이즈입니다)',
    unreach.far ? `직선 ${unreach.far.straight}m · 경로 ${unreach.far.walk}m → aggro ${unreach.farR?.later}` : '',
  )
  check(
    unreach.nearR?.later === true,
    '🚪 **같은 쪽 적은 계속 쫓는다** (도망이 공짜가 되면 안 됩니다 — 푸는 것은 거리가 아니라 지형입니다)',
    unreach.near ? `직선 ${unreach.near.straight}m · 경로 ${unreach.near.walk}m → aggro ${unreach.nearR?.later}` : '',
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} catch (err) {
  /**
   * 💥 **도중에 죽으면 반드시 소리를 냅니다.**
   *
   * ── 왜 이게 없어서 한 라운드를 통째로 날렸는가 ────────────────────
   * 이 파일들은 전부 `try { ... } finally { 닫기 }` 뿐이고 **`catch` 가
   * 없었습니다.** 그래서 본문이 도중에 던지면:
   *   · 집계 줄(`N개 통과 / N개 실패`)에 **영영 도달하지 않고**
   *   · 그 아래 `process.exit(fail === 0 ? 0 : 1)` 도 **실행되지 않아**
   *   · 껍데기는 **성공(exit 0)** 처럼 보입니다.
   *
   * 실제로 무기 프로브가 측정 도중 죽었는데 오류 한 줄 없이 exit 0 이었고,
   * 출력이 중간에서 끊긴 것을 눈치채기 전까지 그 숫자를 믿을 뻔했습니다.
   * 이 저장소가 가장 비싸게 여기는 실패 — **아무 말도 안 하는 계측기** —
   * 를 계측기 **전부**가 갖고 있었던 셈입니다(49개 중 49개).
   *
   * 통과하는 검사보다 나쁜 것은 아무 말도 안 하는 검사이고,
   * 그보다 더 나쁜 것은 **죽으면서 성공했다고 말하는 검사**입니다.
   */
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
