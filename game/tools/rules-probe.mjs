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
  const cfgCounter = await page.evaluate(() => window.__game.counterInfo())
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
  /**
   * ⚠️ 위 검사는 구르기 거리를 **하나**로 봅니다. 무기마다 구르기가 달라지는
   *    순간 그 전제가 조용히 깨집니다 — 가벼운 무기 하나만 4.6m 를 넘겨도
   *    그 무기에게는 🟡 이 그냥 🔴 이 되고, 색이 하나 사라집니다.
   *
   *    지금은 무기마다 **시간**만 다르고 거리는 같게 만들어 두었습니다
   *    (arsenal.ts dodgeDurationScale). 그 약속을 여기서 못 박습니다 —
   *    누가 무기별 거리를 넣는 순간 이 줄이 먼저 막습니다.
   */
  const weapons = await page.evaluate(() => window.__game.weaponTable())
  const dodgeScales = await page.evaluate(() => window.__game.dodgeScales())
  const maxDodge = Math.max(...dodgeScales.map((w) => w.distance))
  check(
    maxDodge < minSweep,
    '무기를 바꿔도 구르기 거리는 그대로다 (가장 긴 구르기 < 가장 작은 노랑)',
    `가장 긴 구르기 ${maxDodge}m vs 노랑 ${minSweep}m · ` +
      dodgeScales.map((w) => `${w.name} ${w.distance}m/${w.duration}초`).join(' · '),
  )
  void weapons

  /**
   * ---- 1b. 🟡 의 **정답이 실제로 성립하는가** ----
   *
   * 위 검사(1)는 🟡 의 **오답**만 막습니다 — "굴러선 못 빠져나온다".
   * 그런데 DESIGN.md 4색 표에서 🟡 의 정답은 **"걸어서 이탈"** 입니다.
   * 그 정답이 성립하는지는 **한 번도 확인한 적이 없었습니다.** 오답을
   * 막아 두고 정답은 안 본 셈이라, 반경만 조금 키우면 🟡 은 조용히
   * **답이 없는 색**이 됩니다 — 굴러도 안 되고 걸어도 안 되는.
   *
   * ⚠️ 계산을 한 번 틀렸고 그 기록을 남깁니다. 처음엔 `반경 ÷ 걷는 속도`
   *    로 재서 "보스 🟡 는 0.2m 모자라다"가 나왔습니다. 틀렸습니다 —
   *    `reach` 는 **적 중심에서** 재는 값이고, 플레이어는 이미 그 안에
   *    서 있지 중심에 있지 않습니다. 실제로 가야 하는 거리는
   *    **반경 − 밀착 거리**(두 몸 반지름의 합)입니다.
   *
   *    그래서 이 검사가 성립하는 진짜 이유는 **몸이 겹치지 않기 때문**
   *    입니다. 보스 반지름을 줄이거나 예고를 당기면 조용히 깨집니다.
   *    지금 보스 🟡 의 여유는 1.2m, 시간으로 0.22초뿐입니다.
   */
  const sweepWalk = sweeps.map((a) => {
    const foe = roster.find((r) => r.attacks.some((x) => x.id === a.id))
    const gap = t.playerRadius + (foe?.radius ?? 0)
    return {
      from: a.from,
      need: a.reach - gap,
      have: t.playerMoveSpeed * a.windup,
    }
  })
  check(
    sweepWalk.length > 0 && sweepWalk.every((w) => w.have > w.need),
    '🟡 는 **걸어서** 빠져나올 수 있다 (이 색의 정답이 실제로 성립한다)',
    sweepWalk
      .map((w) => `${w.from} ${w.need.toFixed(1)}m 가야 함 / 예고 동안 ${w.have.toFixed(1)}m (여유 ${(w.have - w.need).toFixed(1)}m)`)
      .join(' · '),
  )

  /**
   * ---- 1c. 🔵 속박의 **정답이 왜 무적 프레임인가** ----
   *
   * DESIGN.md 4색 표: *"🔵 파랑 — 반드시 무적 프레임. 맞으면 묶여서
   * **다음 공격을 못 피합니다.** 피해는 12로 작습니다 — 무서운 건 다음입니다."*
   *
   * 이 색은 **피해로 벌하지 않습니다.** 그러니 "다음을 못 피한다"가 거짓이면
   * 🔵 는 12뎀짜리 약한 🔴 이고, 색이 하나 장식이 됩니다. 그런데 그 문장이
   * 성립하는지 **한 번도 확인한 적이 없습니다.**
   *
   * ⚠️ **처음 세운 잣대가 틀렸습니다. 기록으로 남깁니다.**
   *    처음엔 "🔵 의 판정 시간 < 무적 창"으로 재려 했습니다. 무적으로 넘기려면
   *    판정이 무적 창보다 짧아야 한다는 생각이었습니다. 틀렸고, 게다가
   *    **이미 DESIGN.md 「머무는 판정」에 적혀 있는 내용**이었습니다 —
   *    combat.ts 에서 **머무는 판정(`lingers`)은 🟡 뿐**입니다.
   *    나머지 색은 판정이 뜨는 **첫 프레임 한 번**만 해석되고 `hitsLeft` 가
   *    바로 0이 됩니다. 즉 🔵 의 판정 0.14초는 무적과 아무 상관이 없고,
   *    그 검사는 **통과해도 아무것도 증명하지 못했을** 것입니다.
   *
   * 코드를 읽고 나서야 진짜 약속이 보였습니다. 속박이 실제로 하는 일은
   * playerControl.ts 에 못박혀 있습니다:
   *
   *   > **회피 구르기와 대시는 막지 않습니다.** … 걷는 속도만 죽여서
   *   > **다음 예고를 피하기 어렵게** 만드는 것이 이 상태이상의 전부입니다.
   *
   * 그러면 속박이 **막을 수 있는 색은 하나뿐**입니다 — 정답이 "걸어서 이탈"인
   * 🟡. 뒤에 🔴 가 오면 구르면 그만이라 속박은 거의 공짜입니다.
   * 그래서 이 검사는 **🔵 → 🟡 연계**를 봅니다. 그 연계에서 묶인 몸으로
   * 걸어 나올 수 있으면, 이 색의 존재 이유가 통째로 무너집니다.
   *
   * 재는 법은 1b 와 **똑같은 식**이고 부호만 반대입니다:
   *   · 안 묶였으면 예고 안에 걸어 나올 수 있어야 한다 (🟡 의 정답)
   *   · 묶였으면 걸어 나올 수 **없어야** 한다 (🔵 의 존재 이유)
   */
  const SNARE = 2
  const bossPhases = await page.evaluate(() => window.__game.bossTuning())
  const bossDef = roster.find((r) => r.attacks.some((a) => a.intent === SNARE && a.snare > 0))
  const snareChains = []
  for (const ph of bossPhases) {
    for (const [fromId, toId] of Object.entries(ph.chains ?? {})) {
      const from = attacks.find((a) => a.id === fromId)
      const to = attacks.find((a) => a.id === toId)
      if (!from || !to) continue
      if (from.intent !== SNARE || to.intent !== SWEEP) continue
      // 이 페이즈의 **실제** 예고 길이(페이즈 배율이 이미 곱해져 나옵니다).
      const windup = ph.windups.find((w) => w.id === toId)?.seconds ?? to.windup
      /**
       * 시간표: 속박은 **판정 첫 프레임**에 걸립니다. 거기서부터
       * 남은 판정 → 후딜 → (연계는 쿨다운 없이) 다음 예고 시작.
       */
      const toWindupStart = from.active + from.recovery
      const left = Math.max(0, from.snare - toWindupStart)
      const bound = Math.min(left, windup)
      const free = windup - bound
      const gap = t.playerRadius + (bossDef?.radius ?? 0)
      snareChains.push({
        phase: ph.name,
        from: fromId,
        to: toId,
        need: to.reach - gap,
        walkFree: t.playerMoveSpeed * windup,
        walkBound: t.playerMoveSpeed * (t.snareMoveScale * bound + free),
        bound,
      })
    }
  }
  /**
   * ⚠️ **비어 있으면 통과가 아니라 실패입니다.** 🔵 뒤에 🟡 이 하나도 안 오면
   *    위 검사는 아무것도 안 보고 조용히 통과합니다 — 이 저장소에서 가장
   *    비싼 고장이 늘 "아무 말도 안 하는 계측기"였습니다.
   */
  check(
    snareChains.length > 0,
    '🔵 뒤에 🟡 이 실제로 이어진다 (속박이 물 것이 있다)',
    snareChains.length
      ? snareChains.map((c) => `${c.phase} ${c.from}→${c.to}`).join(' · ')
      : '🔵→🟡 연계가 없습니다 — 속박은 구르기를 안 막으므로 물 색이 없습니다',
  )
  if (snareChains.length) {
    check(
      snareChains.every((c) => c.walkFree > c.need),
      '   ↳ 안 묶였으면 그 🟡 을 걸어서 빠져나온다 (🟡 의 정답이 여기서도 산다)',
      snareChains
        .map((c) => `${c.to} ${c.need.toFixed(1)}m 필요 / 자유 ${c.walkFree.toFixed(1)}m`)
        .join(' · '),
    )
    check(
      snareChains.every((c) => c.walkBound < c.need),
      '   ↳ **묶이면** 그 🟡 을 걸어서 못 빠져나온다 (🔵 이 색인 이유)',
      snareChains
        .map(
          (c) =>
            `${c.to} ${c.need.toFixed(1)}m 필요 / 묶인 채 ${c.walkBound.toFixed(1)}m` +
            ` (예고 중 ${c.bound.toFixed(2)}초 묶임)`,
        )
        .join(' · '),
    )
  }

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

  // ---- 4. 🟣 끌어당김은 **굴러도 못 벗어난다** ----
  //
  // DESIGN.md 4색 표: "🟣 보라 — 아예 사거리 밖으로. 뒤로 빠져도 끌려옵니다.
  // 굴러도 착지 후 끌려옵니다." 이 문장이 이 색의 **존재 이유**입니다 —
  // 구르기로 벗어날 수 있으면 보라는 그냥 빨강이고, 색이 하나 줄어듭니다.
  //
  // ⚠️ 이건 설정값 비교로는 검사할 수 없습니다. `pull` 은 세기(m/s)이고
  // 구르기는 거리(m)라 **단위가 다릅니다.** 그래서 실제로 굴러 보고
  // **끝난 자리**를 잽니다 — 설정이 아니라 결과를 봅니다.
  const hooked = await page.evaluate(async () => {
    const G = window.__game
    const out = []
    for (let i = 0; i < 3; i++) {
      G.reset()
      const sleep = () => new Promise((r) => setTimeout(r, 8))
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t0 = now()
        const dl = Date.now() + 30000
        while (now() - t0 < sec && Date.now() < dl) await sleep()
      }
      await wait(0.4)
      G.clearEnemies()
      const p0 = G.state().player
      // 갈고리 사거리 안쪽에 세웁니다.
      // ⚠️ 시작 거리를 **사거리 절반쯤**에 둡니다.
      // 처음엔 9m(사거리 12m)에 뒀다가 걸렸습니다 — 거기서 뒤로 4.2m 구르면
      // 13.2m 라 **사거리를 벗어나 그냥 빗나갑니다.** 그러면 재고 있는 것이
      // "끌림이 구르기를 이기는가"가 아니라 "가장자리에서 벗어날 수 있는가"가
      // 됩니다. 가장자리에서 벗어나는 것은 당연하고, 설계가 주장하는 바도
      // 아닙니다. 사거리 **안**에서 굴렀을 때를 물어야 합니다.
      const e = G.spawnEnemyKind('dragger', p0.x + 6, p0.z)
      /**
       * ⚠️ **깨워 놓고 잽니다.** 적은 이제 방향으로 알아채기 때문에(AWARE),
       *    낳은 자리가 등 뒤면 6m 에서는 영영 깨어나지 않습니다 — 실제로
       *    이 검사가 *"20초 안에 갈고리를 걸지 않았습니다"* 로 죽었습니다.
       *    여기서 물으려는 것은 "적이 나를 알아채는가"가 아니라 **"걸린
       *    갈고리를 굴러서 벗어날 수 있는가"** 입니다. 재려는 것 앞의
       *    조건은 무대가 만들어 줘야 합니다.
       */
      G.wakeEnemy(e)
      // 예고가 뜨기를 기다렸다가, **판정 직전에 뒤로 구릅니다.**
      let rolled = false
      let startDist = -1
      const t0 = now()
      const dl = Date.now() + 60000
      while (now() - t0 < 20 && Date.now() < dl) {
        const info = G.enemyInfo(e)
        if (!info) break
        const s = G.state().player
        const d = Math.hypot(info.x - s.x, info.z - s.z)
        if (info.winding && !rolled) {
          // 적 반대쪽으로 굴러 달아납니다 — 사람이 하는 그 대응.
          startDist = d
          G.aimAtWorld(info.x, info.z)
          G.press('Space')
          G.release('Space')
          rolled = true
        }
        if (rolled && !info.winding && info.attacking) {
          // 판정이 뜬 뒤 끌림이 끝나기를 기다립니다.
          await wait(1.2)
          const s2 = G.state().player
          const info2 = G.enemyInfo(e)
          const endDist = info2 ? Math.hypot(info2.x - s2.x, info2.z - s2.z) : -1
          out.push({ startDist: Number(startDist.toFixed(2)), endDist: Number(endDist.toFixed(2)) })
          break
        }
        await sleep()
      }
      G.clearEnemies()
    }
    return out
  })
  if (hooked.length) {
    const medEnd = [...hooked.map((h) => h.endDist)].sort((a, b) => a - b)[Math.floor(hooked.length / 2)]
    const medStart = [...hooked.map((h) => h.startDist)].sort((a, b) => a - b)[Math.floor(hooked.length / 2)]
    /**
     * 견줄 대상은 **방해받지 않은 구르기**입니다 — 그냥 굴렀다면 도달했을
     * 거리(시작 + 구르기 거리). 끌림이 일을 했다면 그보다 확실히 가까워야
     * 합니다. "시작보다 가까운가"로 물으면 안 됩니다: 끄는 자는 거리를
     * 유지하는 적이라 판정 뒤에 스스로 물러나서, 끌림이 성공해도 최종
     * 거리는 시작보다 멀 수 있습니다.
     */
    const cleanEscape = medStart + t.dodgeDistance
    check(
      medEnd < cleanEscape - 1,
      '🟣 갈고리는 굴러 달아나도 **그냥 구른 것보다 가깝게** 끝난다 (구르기가 답이 아니다)',
      `그냥 굴렀다면 ${cleanEscape.toFixed(1)}m · 실제 ${medEnd}m · ` +
        hooked.map((h) => `${h.startDist}→${h.endDist}`).join(' · '),
    )
  } else {
    check(false, '🟣 갈고리를 관측했다', '20초 안에 갈고리를 걸지 않았습니다')
  }

  /**
   * ---- 4b. 🟣 의 **정답이 실제로 성립하는가** ----
   *
   * 위 검사(4)는 🟣 의 **오답**만 막습니다 — "굴러선 못 벗어난다". 그런데
   * DESIGN.md 4색 표에서 🟣 의 정답은 **"아예 사거리 밖으로"** 입니다.
   * 🟡·🔵 과 똑같은 구멍이 여기에도 있었습니다: 오답은 막아 뒀는데 정답이
   * 성립하는지는 안 봤습니다. 사거리를 조금만 늘리면 🟣 는 **굴러도 안 되고
   * 물러나도 안 되는** 색이 됩니다.
   *
   * 정답에 해당하는 움직임은 "한 번 구르기"가 아니라 **끝까지 물러나기**입니다:
   *   구르기 거리 + (예고에서 구르기를 뺀 나머지 시간 동안 걷기)
   *
   * ⚠️ 구르기 시간은 무기마다 다릅니다(쌍단검 0.357초). 빠른 구르기는 걸을
   *    시간이 더 남아 **유리하므로**, 가장 불리한 쪽 — **가장 느린 구르기**로
   *    잽니다. 최악을 통과하면 나머지는 자동입니다.
   *
   * ⚠️ 어느 거리에서 재느냐가 이 검사의 전부입니다. `minRange` 는 그 패턴이
   *    걸릴 수 있는 **가장 가까운** 거리인데, 끄는 자는 그 값이 3m 입니다.
   *    3m 에서는 12m 밖으로 못 나갑니다 — 그런데 그건 결함이 아닙니다.
   *    **3m 에서는 끌려 봤자 갈 데가 없기 때문**입니다(이미 붙어 있습니다).
   *    벌이 큰 거리에서 답이 있으면 됩니다. 그래서 적이 **실제로 유지하는
   *    거리**(`keepDistance`)를 쓰고, 없으면 `minRange` 를 씁니다.
   *    아래에 "몇 m 부터 물러나면 벗어나는가"도 같이 찍습니다 — 검사는
   *    아니고 관측입니다.
   */
  // (PULL 은 파일 위에서 이미 선언했습니다)
  const slowestRoll = dodgeScales.reduce((m, w) => (w.duration > m.duration ? w : m), dodgeScales[0])
  const retreatOf = (windup) =>
    slowestRoll.distance + t.playerMoveSpeed * Math.max(0, windup - slowestRoll.duration)
  const pulls = byIntent(PULL).map((a) => {
    const foe = roster.find((r) => r.attacks.some((x) => x.id === a.id))
    const retreat = retreatOf(a.windup)
    // 판정은 `reach + 내 반지름` 까지 닿습니다(combat.ts). 그 밖으로 나가야 합니다.
    const out = a.reach + t.playerRadius
    return {
      from: a.from,
      // 적이 실제로 그 거리를 유지하면 거기서, 아니면 걸릴 수 있는 가장 가까운 곳에서.
      at: foe?.keepDistance ?? a.minRange,
      basis: foe?.keepDistance != null ? 'keepDistance' : 'minRange',
      retreat,
      out,
      floor: out - retreat,
    }
  })
  check(
    pulls.length > 0 && pulls.every((p) => p.at + p.retreat > p.out),
    '🟣 는 **끝까지 물러나면** 사거리 밖으로 나간다 (이 색의 정답이 실제로 성립한다)',
    pulls
      .map(
        (p) =>
          `${p.from} ${p.at}m(${p.basis})에서 ${p.out.toFixed(1)}m 밖으로 · ` +
          `물러나면 ${(p.at + p.retreat).toFixed(1)}m (여유 ${(p.at + p.retreat - p.out).toFixed(1)}m)`,
      )
      .join(' · '),
  )
  console.log(
    `     ↳ [관측] 물러나서 벗어날 수 있는 최소 거리 — ` +
      pulls.map((p) => `${p.from} ${p.floor.toFixed(1)}m 이상`).join(' · ') +
      ` (가장 느린 구르기 ${slowestRoll.name} ${slowestRoll.duration}초 기준)`,
  )

  // ---- 4.5 등 뒤 창이 **한 대 넣을 시간보다 길다** (기둥 3) ----
  //
  // DESIGN.md 기둥 3: 등 뒤를 잡히면 적이 바로 안 돕니다(반응 지연 + 느린
  // 회전). 그 창이 **한 대 넣는 시간보다 짧으면** 백어택은 시스템으로만
  // 존재하고 실제로는 못 씁니다 — 예전 플레이 테스트에서 실제로 그랬습니다.
  //
  // ⚠️ 벤치의 `백어택 6%` 로는 이걸 못 봅니다. 그 숫자는 **봇이 등 뒤로
  // 도는지**를 재고 있고, 봇은 원래 안 돕니다. 게임이 창을 주는지는
  // 게임 쪽에서 재야 합니다 — 봇은 밸런스를 재고 실험대는 규칙을 잽니다.
  const backWindow = await page.evaluate(async () => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    const now = () => G.state().simElapsed
    const wait = async (sec) => {
      const t0 = now()
      const dl = Date.now() + 30000
      while (now() - t0 < sec && Date.now() < dl) await sleep()
    }
    // (1) 기본 공격 한 대가 판정까지 가는 데 걸리는 시간
    G.reset()
    await wait(0.5)
    G.clearEnemies()
    await wait(0.3)
    const t0 = now()
    G.press('Mouse0')
    G.release('Mouse0')
    let swingAt = -1
    {
      const dl = Date.now() + 30000
      while (now() - t0 < 3 && Date.now() < dl) {
        const p = G.state().player
        if (p.state === 1 && p.phase === 1) {
          swingAt = now() - t0
          break
        }
        await sleep()
      }
    }
    // (2) 등 뒤를 잡았을 때 등 뒤로 남아 있는 시간
    G.reset()
    await wait(0.5)
    G.clearEnemies()
    const p0 = G.state().player
    const e = G.spawnEnemyKind('grunt', p0.x + 2.2, p0.z)
    await wait(0.4)
    /**
     * 적의 **등 뒤**로 옮겨 놓습니다.
     *
     * ⚠️ 처음엔 `info.x + 2.2` 로 적 너머에 놓았다가 `0초` 가 나왔습니다.
     * 그건 "적이 플레이어를 보고 있다"고 가정한 자리인데, 소환 직후의 적은
     * 아직 안 돌아섰을 수 있습니다(회전 130°/초). 그러면 옆에 세워 놓고
     * "등 뒤가 유지되나"를 물은 셈입니다.
     * 가정하지 않고 **바라보는 방향의 정반대**로 계산해서 놓습니다.
     */
    const info = G.enemyInfo(e)
    if (!info) return { swingAt, window: -1 }
    G.teleportPlayer(info.x - Math.sin(info.rotY) * 2.2, info.z - Math.cos(info.rotY) * 2.2)
    await sleep()
    const start = now()
    // ⚠️ `window` 라는 이름을 쓰면 안 됩니다 — 페이지 안에서 도는 코드라
    //    브라우저 전역 `window` 를 가려 `__game` 을 못 찾습니다.
    let stayed = -1
    const dl = Date.now() + 40000
    while (now() - start < 6 && Date.now() < dl) {
      const s = G.state().player
      const i2 = G.enemyInfo(e)
      if (!i2) break
      if (!G.testBehind(s.x, s.z, i2.x, i2.z, i2.rotY)) {
        stayed = now() - start
        break
      }
      await sleep()
    }
    if (stayed < 0) stayed = 6
    G.clearEnemies()
    return { swingAt: Number(swingAt.toFixed(2)), window: Number(stayed.toFixed(2)) }
  })
  check(
    backWindow.swingAt > 0 && backWindow.window > backWindow.swingAt,
    '등 뒤 창이 기본 공격 한 대보다 길다 (백어택을 실제로 쓸 수 있다)',
    `등 뒤로 남는 시간 ${backWindow.window}초 vs 한 대 넣는 데 ${backWindow.swingAt}초`,
  )

  /**
   * ---- 4.6 **모든** 무기가 무너짐 창 안에 두 대를 넣을 수 있다 ----
   *
   * NRFTW 공략들이 처벌 창을 설명하는 단위가 일관됩니다:
   * *"옆으로 굴러 **빠른 공격 2~3대**로 처벌하라."* 초가 아니라 **대수**입니다.
   *
   * 우리는 지금까지 무방비를 **초로만** 재고 있었습니다(반격 2.4초 등).
   * 초는 무기가 바뀌면 뜻이 달라집니다 — 같은 창에 단검은 여러 대,
   * 대검은 한 대가 들어갑니다. 무기를 하나 느리게 만들면서 창을 안 늘리면
   * **그 무기만 조용히 처벌을 못 하게** 되고, 초로 재는 한 안 보입니다.
   *
   * 한 대는 이미 위(4.5)에서 봤습니다. 여기서는 **두 대**를 봅니다 —
   * 한 대만 들어가는 창은 "처벌"이 아니라 "겨우 한 방"이고, 그러면
   * 무너뜨릴 이유가 백어택 한 대와 다를 게 없습니다.
   *
   * ⚠️ 계산하지 않고 **재서** 얻습니다. 두 번째 타는 선입력·후딜 취소가
   *    맞물려 결정되므로, 콤보 시간을 나누는 식으로는 틀립니다.
   */
  const twoHits = await page.evaluate(async (states) => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    const now = () => G.state().simElapsed
    const wait = async (sec) => {
      const t0 = now()
      const dl = Date.now() + 30000
      while (now() - t0 < sec && Date.now() < dl) await sleep()
    }
    const out = []
    for (let w = 0; w < 3; w++) {
      G.reset()
      await wait(0.4)
      G.clearEnemies()
      await wait(0.2)
      G.press(`Digit${w + 1}`)
      G.release(`Digit${w + 1}`)
      await wait(0.5)
      const name = G.weaponTable()[w].name
      const t0 = now()
      let swings = 0
      let secondAt = -1
      let wasActive = false
      G.press('Mouse0')
      G.release('Mouse0')
      const dl = Date.now() + 40000
      while (now() - t0 < 6 && Date.now() < dl) {
        const p = G.state().player
        const active = p.state === states.attack && p.phase === 1
        // 판정이 **뜨는 순간**만 셉니다. 판정은 여러 프레임 유지됩니다.
        if (active && !wasActive) {
          swings++
          if (swings === 2) {
            secondAt = now() - t0
            break
          }
          // 다음 타를 눌러 둡니다 — 사람이 하는 그대로(선입력).
          G.press('Mouse0')
          G.release('Mouse0')
        }
        wasActive = active
        await sleep()
      }
      out.push({ name, secondAt: Number(secondAt.toFixed(2)) })
    }
    /**
     * ⚠️ **바꾼 것은 되돌립니다.** 처음엔 안 되돌렸고, 그래서 뒤따르는
     *    "콤보 한 바퀴 = 집중 1점" 검사가 4타 쌍단검을 든 채로 돌아
     *    엉뚱하게 실패했습니다. 프로브가 남긴 상태가 **다른 검사의
     *    결과를 바꾼** 것이라, 실패를 보고도 원인을 게임에서 찾게 됩니다.
     *    (덕분에 진짜 구멍을 하나 찾긴 했습니다 — combat.ts 집중 주석 참고.)
     */
    G.press('Digit1')
    G.release('Digit1')
    await wait(0.4)
    return out
  }, t.actorStates)
  const shortest = cfgCounter.normalBrokenTime
  const worst = twoHits.reduce((a, b) => (b.secondAt > a.secondAt ? b : a), twoHits[0])
  check(
    twoHits.every((x) => x.secondAt > 0 && x.secondAt <= shortest),
    `모든 무기가 가장 짧은 무너짐 창 안에 **두 대**를 넣는다 (처벌이 무기를 안 가린다)`,
    `창 ${shortest}초 · ` + twoHits.map((x) => `${x.name} ${x.secondAt}초`).join(' · ') +
      ` (가장 느린 것 ${worst.name})`,
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

  /**
   * ---- 7. **모든 무기가** 콤보 하나에 집중 1점 ----
   *
   * balance.ts FOCUS: *"3타 콤보를 다 넣으면 딱 1점입니다. 콤보 하나 = 1점이
   * 손에 남는 단위가 되어야 세는 것이 부담이 아닙니다."*
   *
   * ⚠️ 예전 검사는 **설정값을 곱했습니다** (`perLightHit × 콤보 길이`).
   *    그건 지금 든 무기 하나만 보는 데다, 값이 무기별로 달라지면 아예
   *    뜻을 잃습니다. 실제로 이 검사는 4타 무기를 든 채로 돌자마자
   *    깨졌고, 그때 드러난 것이 **쌍단검이 콤보마다 36% 더 벌고 있었다**는
   *    사실이었습니다.
   *
   *    그래서 곱하지 않고 **때려서 잽니다.** 무기 셋을 차례로 들고 콤보를
   *    한 바퀴 다 넣은 뒤 집중을 읽습니다. 약속을 지키는지는 게임이
   *    답할 일이고, 프로브는 세기만 합니다.
   */
  const focusPerCombo = await page.evaluate(async ([states]) => {
    const G = window.__game
    const sleep = () => new Promise((r) => setTimeout(r, 8))
    const now = () => G.state().simElapsed
    const wait = async (sec) => {
      const t0 = now()
      const dl = Date.now() + 30000
      while (now() - t0 < sec && Date.now() < dl) await sleep()
    }
    const out = []
    for (let w = 0; w < 3; w++) {
      G.reset()
      await wait(0.4)
      G.clearEnemies()
      await wait(0.2)
      G.press(`Digit${w + 1}`)
      G.release(`Digit${w + 1}`)
      await wait(0.4)
      const info = G.weaponTable()[w]
      // 죽지 않는 표적 — 시험 도중 쓰러지면 남은 타가 허공을 칩니다.
      const p0 = G.state().player
      const e = G.spawnEnemyKind('grunt', p0.x + 1.8, p0.z)
      /**
       * ⚠️ **깨워 놓고 잽니다.** 안 깨우면 첫 타가 **기습**이 되어 강인도를
       *    즉시 부수고, 무너진 적을 때리는 것은 평타 콤보가 아닙니다.
       *    실제로 이 검사가 `롱소드 3타 → 0.67점` 으로 죽었습니다 —
       *    게임이 약속을 어긴 것이 아니라 **다른 것을 재고 있었던** 것입니다.
       */
      G.wakeEnemy(e)
      await wait(0.3)
      G.setHp(e, 100000)
      G.freezeEnemies(true)
      G.setFocus(0)
      let swings = 0
      let wasActive = false
      const t0 = now()
      const dl = Date.now() + 40000
      G.aimAtWorld(G.enemyInfo(e).x, G.enemyInfo(e).z)
      G.press('Mouse0')
      G.release('Mouse0')
      while (swings < info.comboLength && now() - t0 < 8 && Date.now() < dl) {
        const p = G.state().player
        const active = p.state === states.attack && p.phase === 1
        if (active && !wasActive) {
          swings++
          if (swings < info.comboLength) {
            G.aimAtWorld(G.enemyInfo(e).x, G.enemyInfo(e).z)
            G.press('Mouse0')
            G.release('Mouse0')
          }
        }
        wasActive = active
        await sleep()
      }
      await wait(0.4)
      out.push({
        name: info.name,
        steps: info.comboLength,
        swings,
        focus: Number(G.focusInfo().focus.toFixed(2)),
      })
      G.freezeEnemies(false)
      G.clearEnemies()
    }
    // 바꾼 것은 되돌립니다(위 두 대 검사에서 배운 것).
    G.press('Digit1')
    G.release('Digit1')
    await wait(0.3)
    return out
  }, [t.actorStates])
  check(
    focusPerCombo.every((w) => w.swings === w.steps && w.focus >= 0.95 && w.focus <= 1.15),
    '**모든 무기가** 콤보 한 바퀴에 집중 1점을 채운다',
    focusPerCombo.map((w) => `${w.name} ${w.steps}타 → ${w.focus}점`).join(' · '),
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

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
