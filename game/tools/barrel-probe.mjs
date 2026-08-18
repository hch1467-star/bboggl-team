/**
 * 💥 폭발통 검증 — `npm run barrel`
 *
 * ── 왜 이 프로브를 먼저 쓰는가 ──────────────────────────────────────
 * DESIGN.md 「아직 안 한 것」의 바로 옆 항목(밀어 떨어뜨리기)에서 이
 * 저장소는 이렇게 배웠습니다: *"없던 것은 기능이 아니라 **눈금**이었습니다."*
 * 그래서 통을 넣으면서 눈금을 같이 만듭니다. 기능만 넣고 재는 것이 없으면,
 * 이 물건은 **있는지 없는지 아무도 모르는 채로** 남습니다.
 *
 * ── 무엇을 묻는가 ──────────────────────────────────────────────────
 * 통의 설계는 balance.ts `BARREL` 에 있고, 요약하면 세 문장입니다:
 *   ① 때리면 🟡 이 깔리고 도화선이 탄다
 *   ② 다 타면 반경 안의 **모두**가 자세를 잃는다 (적은 강인도, 나는 스태미나)
 *   ③ **피해는 한 점도 없다** — 오사와 같은 이유(유인이 싸움을 대신하면 안 됨)
 * 셋 다 *"코드에 그렇게 적혀 있다"* 가 아니라 **눌러서** 확인합니다.
 *
 * ── ⚠️ 규칙값은 전부 게임에서 읽습니다 ──────────────────────────────
 * 반경 4m·도화선 1.0초·스태미나 36 을 여기 적으면, 값을 손보는 날
 * **검사만 옛 규칙을 지킵니다.** `barrelInfo()` 가 게임이 실제로 쓰는 값을
 * 내보내므로 그것과 맞대 봅니다.
 *
 * ── ⚠️ 시간은 시뮬 시계로 잽니다 ────────────────────────────────────
 * 이 컨테이너는 GPU 가 없어 10~25fps 로 돕니다. 벽시계로 도화선을 재면
 * 게임이 아니라 **컨테이너를 재게** 됩니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5241
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
  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  await page.evaluate(() => {
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

  console.log('\n💥 폭발통 검증 — 때리면 무엇이 일어나는가\n')

  const rule = await page.evaluate(() => window.__game.barrelInfo())
  console.log(
    `  [규칙] 반경 ${rule.blast}m · 도화선 ${rule.fuse.toFixed(2)}초 · ` +
      `휘말린 나의 스태미나 -${rule.staminaLoss}\n`,
  )

  /**
   * ---- 1. 때리면 불이 붙는가 ----
   *
   * 아레나에 통을 하나 세우고, 플레이어를 **사거리 안**에 두고 좌클릭합니다.
   * "코드가 그렇게 생겼다"가 아니라 **눌러서** 확인하는 것이 요점입니다.
   */
  const lit = await page.evaluate(async () => {
    const G = window.__game
    G.clearEnemies()
    const b = G.spawnBarrel(6, 0)
    G.teleportPlayer(4.2, 0)
    G.aimAtWorld(6, 0)
    await window.__t.runFor(0.2)
    const before = G.barrelInfo().barrels.find((x) => x.entity === b)
    G.press('Mouse0')
    await window.__t.runFor(0.05)
    G.release('Mouse0')
    await window.__t.runFor(0.45)
    const after = G.barrelInfo().barrels.find((x) => x.entity === b)
    return { b, beforeFuse: before?.fuseT ?? -1, after: after ?? null }
  })
  check(lit.beforeFuse === 0, '가만히 둔 통은 **혼자 안 터진다** (검사의 게이트)', `누르기 전 도화선 ${lit.beforeFuse}초`)
  check(
    !!lit.after && lit.after.fuseT > 0,
    '💥 **때리면 도화선에 불이 붙는다**',
    lit.after ? `남은 ${lit.after.fuseT.toFixed(2)}초 / 전체 ${lit.after.fuseTotal.toFixed(2)}초` : '통이 사라짐',
  )
  check(
    !!lit.after && Math.abs(lit.after.fuseTotal - rule.fuse) < 0.02,
    '💥 붙은 도화선 길이가 **게임의 규칙과 같다** (그림이 자기 값을 갖지 않는다)',
    lit.after ? `${lit.after.fuseTotal.toFixed(3)}초 vs 규칙 ${rule.fuse.toFixed(3)}초` : '—',
  )

  /**
   * ---- 2. 반경 안은 무너지고 밖은 멀쩡한가 ----
   *
   * **두 마리를 같이 세웁니다.** 한 마리만 보면 *"반경이 규칙대로인가"* 를
   * 물을 수 없습니다 — 안쪽이 무너진 것만 확인하고 넘어가면, 반경이
   * 100m 여도 이 검사는 초록입니다. 경계는 **양쪽을 봐야** 잽니다.
   *
   * 안쪽은 반경의 절반, 바깥쪽은 반경의 두 배에 둡니다.
   */
  const blast = await page.evaluate(async () => {
    const G = window.__game
    G.clearEnemies()
    const info = G.barrelInfo()
    const R = info.blast
    const b = G.spawnBarrel(0, 0)
    // 통 판정에 안 걸리게 플레이어는 멀리 세워 둡니다(스태미나는 따로 잽니다).
    G.teleportPlayer(0, 30)
    const inner = G.spawnEnemyKind('grunt', R * 0.5, 0, true)
    const outer = G.spawnEnemyKind('grunt', R * 2, 0, true)
    await window.__t.runFor(0.2)
    const hp0 = { inner: G.enemyInfo(inner).hp, outer: G.enemyInfo(outer).hp }
    // 통을 직접 켭니다 — 여기서 재는 것은 "때리는 것"이 아니라 "터지면 무엇이 되는가"입니다.
    G.damageEntity(b, 1)
    await window.__t.runFor(0.05)
    const litNow = G.barrelInfo().barrels.find((x) => x.entity === b)
    await window.__t.runFor(info.fuse + 0.3)
    const gone = !G.barrelInfo().barrels.some((x) => x.entity === b)
    return {
      R,
      lit: litNow ? litNow.fuseT > 0 : false,
      gone,
      inner: G.enemyInfo(inner),
      outer: G.enemyInfo(outer),
      hp0,
      blown: G.barrelInfo().blown,
      caught: G.barrelInfo().caught,
    }
  })
  check(blast.lit, '💥 통은 **무엇에 맞아도** 불이 붙는다 (통 전용 판정을 안 만든 결과)')
  check(blast.gone, '💥 도화선이 다 타면 **통이 사라진다** (한 번 쓰는 물건이다)', `터진 통 ${blast.blown}개`)
  check(
    !!blast.inner && blast.inner.brokenT > 0,
    `💥 반경 안(${(blast.R * 0.5).toFixed(1)}m)의 적이 **자세를 잃는다**`,
    blast.inner ? `무방비 ${blast.inner.brokenT}초 남음` : '적이 사라짐',
  )
  check(
    !!blast.outer && blast.outer.brokenT === 0,
    `💥 반경 **밖**(${(blast.R * 2).toFixed(1)}m)의 적은 멀쩡하다 (경계가 규칙대로다)`,
    blast.outer ? `무방비 ${blast.outer.brokenT}초` : '적이 사라짐',
  )
  check(
    !!blast.inner && blast.inner.hp === blast.hp0.inner,
    '💥 **피해는 한 점도 안 들어간다** (유인이 싸움을 대신하면 안 됩니다 — 오사와 같은 규칙)',
    blast.inner ? `${blast.hp0.inner} → ${blast.inner.hp}` : '—',
  )

  /**
   * ---- 3. 나도 대가를 치르는가 ----
   *
   * 대가가 없으면 통은 "항상 누르는 공짜 버튼"입니다. 스태미나를 가득
   * 채워 두고 한가운데 서서 확인합니다 — **체력은 그대로, 스태미나는 규칙만큼.**
   */
  const self = await page.evaluate(async () => {
    const G = window.__game
    G.clearEnemies()
    const info = G.barrelInfo()
    const b = G.spawnBarrel(0, 0)
    G.teleportPlayer(0.5, 0)
    G.setStamina(100)
    await window.__t.runFor(0.2)
    const before = G.state().player
    G.damageEntity(b, 1)
    await window.__t.runFor(info.fuse + 0.25)
    const after = G.state().player
    return { before, after, loss: info.staminaLoss }
  })
  check(
    Math.abs(self.before.stamina - self.after.stamina - self.loss) < 1.5,
    '💥 휘말린 나는 **스태미나를 잃는다** (통이 공짜 버튼이 되지 않게)',
    `${self.before.stamina} → ${self.after.stamina} (규칙 -${self.loss})`,
  )
  check(
    self.after.hp === self.before.hp,
    '💥 그래도 나에게도 **피해는 없다** (규칙이 진영을 안 가린다)',
    `체력 ${self.before.hp} → ${self.after.hp}`,
  )

  /**
   * ---- 4. 도화선이 실제로 **답할 시간**인가 ----
   *
   * 이게 이 물건의 전부입니다. 규칙상 도화선 = 단순 반응 + 반경÷걸음속도
   * 인데, **정말 걸어서 나갈 수 있는지**는 걸어 봐야 압니다.
   * 한가운데서 불을 붙이고 **곧바로 걷기만** 해서 빠져나옵니다.
   */
  const escape = await page.evaluate(async () => {
    const G = window.__game
    G.clearEnemies()
    const info = G.barrelInfo()
    const b = G.spawnBarrel(0, 0)
    G.teleportPlayer(0, 0)
    G.setStamina(100)
    await window.__t.runFor(0.2)
    const before = G.state().player.stamina
    G.damageEntity(b, 1)
    // 걷기만 합니다 — 구르기·달리기를 쓰면 "걸어서 이탈"이라는 🟡 의 답을 안 잰 것이 됩니다.
    const cam = G.cameraAxes()
    const keys = []
    if (cam.forwardX > 0.25 || cam.forwardZ > 0.25) keys.push('KeyW')
    else keys.push('KeyS')
    for (const k of keys) G.press(k)
    await window.__t.runFor(info.fuse + 0.3)
    for (const k of keys) G.release(k)
    const p = G.state().player
    return { before, after: p.stamina, dist: Math.hypot(p.x, p.z), R: info.blast }
  })
  check(
    escape.dist > escape.R,
    '🚶 도화선 동안 **걸어서** 반경 밖으로 나갈 수 있다 (🟡 의 답이 통에도 통한다)',
    `걸어간 거리 ${escape.dist.toFixed(1)}m > 반경 ${escape.R}m`,
  )
  check(
    escape.after === escape.before,
    '🚶 나간 사람은 **아무것도 안 잃는다** (읽고 답한 값이 있다)',
    `스태미나 ${escape.before} → ${escape.after}`,
  )

  /**
   * ---- 5. 연쇄 ----
   *
   * 반경 안의 다른 통에는 **불만** 붙습니다(폭발이 옮는 것이 아닙니다).
   * 즉 연쇄는 한 박자 뒤에 오고, 그 박자만큼 다시 도망칠 시간이 생깁니다.
   * 그렇지 않으면 통 두 개가 놓인 자리는 답이 없는 함정이 됩니다.
   */
  const chain = await page.evaluate(async () => {
    const G = window.__game
    G.clearEnemies()
    const info = G.barrelInfo()
    const a = G.spawnBarrel(0, 0)
    const b = G.spawnBarrel(info.blast * 0.6, 0)
    G.teleportPlayer(0, 30)
    await window.__t.runFor(0.2)
    G.damageEntity(a, 1)
    await window.__t.runFor(info.fuse + 0.1)
    const second = G.barrelInfo().barrels.find((x) => x.entity === b)
    const firstGone = !G.barrelInfo().barrels.some((x) => x.entity === a)
    return { firstGone, second: second ?? null, fuse: info.fuse }
  })
  check(
    chain.firstGone && !!chain.second,
    '⛓ 첫 통이 터진 **직후에도 둘째 통은 남아 있다** (연쇄가 즉발이 아니다)',
    chain.second ? `둘째 남은 도화선 ${chain.second.fuseT.toFixed(2)}초` : '둘째가 이미 사라짐',
  )
  check(
    !!chain.second && chain.second.fuseTotal > 0 && Math.abs(chain.second.fuseTotal - chain.fuse) < 0.02,
    '⛓ 옮은 것은 **폭발이 아니라 불**이다 (도화선을 처음부터 다시 태운다)',
    chain.second ? `${chain.second.fuseTotal.toFixed(2)}초 vs 규칙 ${chain.fuse.toFixed(2)}초` : '—',
  )

  /**
   * ---- 6. 존에 실제로 놓여 있는가 ----
   *
   * 아레나에서 아무리 잘 돌아도 **존에 없으면 없는 기능**입니다.
   * 이 저장소가 여러 번 데인 자리라 마지막에 꼭 확인합니다.
   */
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  const inZone = await page.evaluate(() => {
    const G = window.__game
    const b = G.barrelInfo().barrels
    const foes = G.levelFoes()
    const blast = G.barrelInfo().blast
    return b.map((x) => ({
      x: x.x,
      z: x.z,
      near: foes.filter((f) => Math.hypot(f.x - x.x, f.z - x.z) <= blast).length,
    }))
  })
  console.log(
    `\n  [존] 놓인 통 ${inZone.length}개 — ` +
      inZone.map((b) => `(${b.x},${b.z}) 반경 안 적 ${b.near}마리`).join(' · '),
  )
  check(inZone.length > 0, '💥 **존에 통이 실제로 놓여 있다** (아레나에서만 되는 기능이 아니다)', `${inZone.length}개`)
  check(
    inZone.length > 0 && inZone.every((b) => b.near >= 1),
    '💥 놓인 통마다 반경 안에 **적이 있다** (놓기만 하고 아무 일도 안 나지 않게)',
    inZone.map((b) => `${b.near}마리`).join(' · '),
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 (notice-probe.mjs 의 같은 주석 참고).
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
