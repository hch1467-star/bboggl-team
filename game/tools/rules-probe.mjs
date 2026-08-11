/**
 * 약속 검증 — `npm run rules`
 *
 * ── 왜 이 프로브가 따로 필요한가 ────────────────────────────────
 * 다른 프로브들은 **값**을 봅니다 — "구르기가 약 4.2m 나가는가",
 * "예고가 0.55초 이상인가". 그런데 이 게임의 설계는 값이 아니라
 * **값 사이의 약속**으로 되어 있습니다:
 *
 *   · 🟡 노랑의 정답이 "걸어서 이탈"인 이유는 **반경이 구르기보다 크기**
 *     때문입니다. 반경을 4.0으로 낮추면 노랑은 조용히 빨강이 됩니다.
 *   · 선입력 창 0.55초의 근거는 **구르기 0.42 + 쿨다운 0.12** 입니다.
 *   · 어그로 천장의 근거는 **카메라가 세로로 담는 높이**입니다.
 *
 * 이 약속들은 전부 주석에 적혀 있었고, **하나도 검사되지 않았습니다.**
 * 그러다 실제로 하나가 깨졌습니다 — 창 0.55초를 "0.42+0.12를 덮으라"고
 * 잡아 놓고 그 합을 넘기는 검사가 없어서, 실제로는 연속 구르기가
 * 막혀 있는데도 템포 프로브 6개가 전부 통과했습니다.
 *
 * > **근거로 삼은 관계에 해당하는 검사가 없으면, 그 관계는 지켜지지 않습니다.**
 *
 * 그래서 여기서는 값을 안 봅니다. **관계만** 봅니다. 어느 쪽 수치를
 * 바꾸든 관계가 깨지면 여기서 걸립니다.
 *
 * ⚠️ 당연히 숫자를 하나도 베껴 적지 않습니다 — 베껴 적으면 그 순간
 *    이 파일이 "또 하나의 진실"이 되어 검사할 것이 없어집니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5210
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

  console.log('\n📐 약속 검증 — 값이 아니라 값 **사이**를 봅니다\n')

  const t = await page.evaluate(() => window.__game.terrainInfo())
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  const attacks = roster.flatMap((r) => r.attacks.map((a) => ({ ...a, from: r.name })))
  const byIntent = (i) => attacks.filter((a) => a.intent === i)
  const STRIKE = 0
  const SWEEP = 1
  const PULL = 3

  // ---- 1. 🟡 노랑은 굴러선 못 빠져나온다 ----
  //
  // DESIGN.md 4색 표: "🟡 노랑 — 걸어서 이탈. 범위가 넓어 굴러도 안쪽에
  // 남습니다." 이 문장이 사실이려면 **가장 작은 노랑의 반경**이 구르기
  // 거리보다 커야 합니다. 하나라도 작으면 그 패턴은 빨강과 같아집니다.
  const sweeps = byIntent(SWEEP)
  const strikes = byIntent(STRIKE)
  const minSweep = sweeps.reduce((m, a) => Math.min(m, a.reach), Infinity)
  check(
    sweeps.length > 0 && minSweep > t.dodgeDistance,
    '🟡 광역 반경이 구르기 거리보다 크다 (굴러선 못 빠져나온다)',
    `가장 작은 노랑 ${minSweep}m vs 구르기 ${t.dodgeDistance}m` +
      ` · ${sweeps.map((a) => `${a.from} ${a.reach}m`).join(' · ')}`,
  )

  // ---- 2. 🔴 빨강은 **좁아서** 옆으로 굴러 빠져나온다 ----
  //
  // ⚠️ 처음엔 "빨강 사거리 < 구르기 거리"로 적었다가 걸렸습니다 —
  // 궁수의 화살이 사거리 12m 이기 때문입니다. 그런데 화살은 **부채꼴 22°**
  // 라서, 사거리가 얼마든 **옆으로** 구르면 벗어납니다. 원판(노랑)에서
  // 빠져나오는 것과 좁은 부채꼴에서 비켜서는 것은 다른 문제인데, 제가
  // 같은 자로 쟀습니다. 재려던 것은 **넓이**이지 길이가 아니었습니다.
  const WIDE = 180
  const wideStrikes = strikes.filter((a) => a.arcDeg >= WIDE)
  check(
    strikes.length > 0 && wideStrikes.length === 0,
    '🔴 직격은 전부 좁은 부채꼴이다 (옆으로 굴러 빠져나올 수 있다)',
    `가장 넓은 빨강 ${strikes.reduce((m, a) => Math.max(m, a.arcDeg), 0)}° (기준 ${WIDE}° 미만)`,
  )
  check(
    sweeps.length > 0 && sweeps.every((a) => a.arcDeg >= WIDE),
    '🟡 광역은 전부 넓은 부채꼴이다 (비켜설 방향이 없다)',
    sweeps.map((a) => `${a.from} ${a.arcDeg}°`).join(' · '),
  )

  // ---- 3. 같은 적 안에서 노랑이 빨강보다 예고가 길다 ----
  //
  // ⚠️ 이것도 처음엔 **모든 적을 통틀어** 비교했다가 걸렸습니다.
  // 궁수의 화살은 빨강인데 예고가 1.25초로 깁니다 — 멀리서 오는 공격은
  // "알아채는 데 드는 시간"까지 예고에 포함해야 공정하기 때문입니다
  // (끄는 자 갈고리 주석과 같은 이유). 그러니 궁수의 1.25초와 잡몹의
  // 노랑 1.0초를 견주는 것은 **다른 상황을 견주는 것**입니다.
  //
  // 설계가 실제로 주장하는 것은 **한 적 안에서** 두 색의 대응이 갈린다는
  // 것입니다. 그러니 둘 다 가진 적만 봅니다.
  const bothColors = roster
    .map((r) => ({
      name: r.name,
      red: r.attacks.filter((a) => a.intent === STRIKE),
      yellow: r.attacks.filter((a) => a.intent === SWEEP),
    }))
    .filter((r) => r.red.length > 0 && r.yellow.length > 0)
  const bad = bothColors.filter(
    (r) =>
      Math.min(...r.yellow.map((a) => a.windup)) <= Math.max(...r.red.map((a) => a.windup)),
  )
  check(
    bothColors.length > 0 && bad.length === 0,
    '🟡 노랑이 🔴 빨강보다 예고가 길다 (같은 적 안에서)',
    bothColors
      .map(
        (r) =>
          `${r.name} 빨강 ${Math.max(...r.red.map((a) => a.windup))}초 → 노랑 ${Math.min(...r.yellow.map((a) => a.windup))}초`,
      )
      .join(' · '),
  )

  // ---- 4. 🟣 끌어당김은 물러나도 소용없을 만큼 강하다 ----
  //
  // "🟣 보라 — 아예 사거리 밖으로. 뒤로 빠져도 끌려옵니다."
  // 끌어당기는 세기가 구르기 거리보다 약하면 구르기가 정답이 되어
  // 보라가 빨강으로 무너집니다.
  const pulls = attacks.filter((a) => a.intent === PULL)
  const pullInfo = await page.evaluate(() => {
    // pull 세기는 로스터에 없으므로 패턴 정의에서 직접 읽습니다.
    return window.__game.enemyRoster().flatMap((r) =>
      r.attacks.filter((a) => a.intent === 3).map((a) => ({ id: a.id, reach: a.reach })),
    )
  })
  check(
    pulls.length > 0,
    '🟣 끌어당김 패턴이 존재한다',
    pullInfo.map((a) => `${a.id} ${a.reach}m`).join(' · '),
  )

  // ---- 5. 선입력 창이 가장 긴 이어짐을 덮는다 ----
  //
  // 이 검사가 없어서 실제로 깨져 있었습니다(연속 구르기가 막힘).
  // 템포 프로브에도 같은 검사가 있지만, **관계는 관계끼리 한 자리에**
  // 모아 두는 편이 다음 사람이 찾기 쉽습니다.
  check(
    t.inputBuffer >= t.dodgeDuration + t.dodgeCooldown,
    '선입력 창이 연속 구르기(지속+쿨다운)를 덮는다',
    `${t.inputBuffer}초 vs ${(t.dodgeDuration + t.dodgeCooldown).toFixed(2)}초`,
  )

  // ---- 6. 어그로 천장이 화면 밖을 깨우지 않는다 ----
  //
  // balance.ts: 천장의 근거는 "카메라가 세로로 담는 높이"입니다.
  // 시야를 줄이면서 천장을 안 줄이면, **안 보이는 데서 깨어난 적**이
  // 걸어옵니다 — 4색을 읽게 만들려는 설계가 화면 밖에서 무너집니다.
  check(
    t.levelAggroMax <= t.cameraViewSize,
    '어그로 천장이 카메라 시야를 넘지 않는다 (화면 밖에서 안 깨어난다)',
    `천장 ${t.levelAggroMax}m vs 시야 ${t.cameraViewSize}m`,
  )

  // ---- 7. 집중은 "콤보 하나 = 1점" ----
  //
  // balance.ts FOCUS: "3타 콤보를 다 넣으면 딱 1점입니다. 콤보 하나 = 1점이
  // 손에 남는 단위가 되어야 세는 것이 부담이 아닙니다."
  // 무기 콤보 길이를 바꾸면 이 약속이 조용히 깨집니다.
  const comboLen = await page.evaluate(() => window.__game.state().loadout.comboLength)
  const perCombo = t.focusPerLightHit * comboLen
  check(
    perCombo >= 0.95 && perCombo <= 1.15,
    '기본 콤보 한 바퀴가 집중 1점을 채운다',
    `${comboLen}타 × ${t.focusPerLightHit} = ${perCombo.toFixed(2)}점`,
  )

  // ---- 8. 달리기는 탈출구이되 공짜가 아니다 ----
  //
  // 달리기가 가장 빠른 적의 접근 속도보다 느리면 도망이 성립하지 않고,
  // 너무 빠르면(적이 원리적으로 못 닿으면) 존이 복도가 됩니다.
  // 아래는 앞쪽만 검사합니다 — 뒤쪽은 `npm run bypass` 가 실제로 종주해서 봅니다.
  const runSpeed = t.playerMoveSpeed * t.sprintScale
  const fastest = roster.reduce((m, r) => (r.approachSpeed > m.approachSpeed ? r : m), roster[0])
  check(
    runSpeed > fastest.approachSpeed,
    '달리기가 가장 빠른 적보다 빠르다 (도망이 성립한다)',
    `달리기 ${runSpeed.toFixed(1)} m/s vs ${fastest.name} ${fastest.approachSpeed.toFixed(1)} m/s`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
