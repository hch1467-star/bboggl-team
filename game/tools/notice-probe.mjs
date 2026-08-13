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

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
