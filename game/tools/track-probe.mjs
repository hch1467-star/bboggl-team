/**
 * 🎯 적은 **얼마나 빨리 도는 사람까지 따라잡는가** — `npm run track`
 *
 * ── 왜 이 실험대가 생겼는가 ────────────────────────────────────────
 * 자동 플레이의 보스전이 이렇게 나왔습니다:
 *
 *     보스전 22.4초 · **받은 피해 38** (최저 체력 78) · 3페이즈 전부 봄 · 처치
 *
 * 존의 마지막 시험이 플레이어 체력의 22%만 깎았습니다. **왜**인지를 물으려고
 * 판정 자리에 장부를 달았더니(`systems/combat.ts` `swingRecords`) 답이 나왔습니다:
 *
 *     boss_cleave 2회 · 적중 0회 · **각도로 빗나감 2회 · 평균 125° / 허용 75°**
 *
 * 125°는 **거의 등 뒤**입니다. 보스는 플레이어를 등에 지고 허공을 칩니다.
 *
 * 이유는 코드에 있습니다 — 적은 예고 중에 평소 선회 속도의 **30%** 로만
 * 따라 돕니다(`enemyAI.ts`). 보스는 100°/s × 0.3 = **30°/s**, 예고가
 * 0.78초이니 **23°** 밖에 못 돕니다. 옆으로 걷기만 해도 부채꼴(±65°)을
 * 벗어납니다.
 *
 * ── ⚠️ 그런데 값을 바로 올리면 안 됩니다 ───────────────────────────
 * 이 게임의 기둥 3은 **백어택**입니다. 등 뒤를 잡는 것이 보상이어야
 * 하는데, 추적을 올리면 그 보상이 사라집니다. 소울류·오공·세키로가
 * 쓰는 답은 *"추적하되 전부는 못 따라온다"* 이고, 그건 **숫자 하나가
 * 아니라 경계선**입니다:
 *
 *   · 옆으로 **걷는** 정도는 따라잡아야 한다 (그래야 위협이 됩니다)
 *   · 작정하고 **돌아 들어가면** 놓쳐야 한다 (그래야 백어택이 보상입니다)
 *
 * 그 경계선을 **재는** 것이 이 실험대입니다. 자동 플레이는 판마다 교전이
 * 21~62회로 흔들려서 이런 것을 못 가릅니다.
 *
 * ── 어떻게 재는가 ──────────────────────────────────────────────────
 * 아레나에 보스 하나만 세우고, 플레이어를 **정해진 각속도로 원을 그리며**
 * 돌립니다. 그 상태에서 공격을 강제로 시키고, 장부에 "맞았다/각도로
 * 빗나갔다"가 무엇으로 찍히는지 봅니다. 각속도를 0°/s 부터 올려 가며
 * **몇 °/s 부터 놓치는지**를 찾습니다.
 *
 * ⏱ 시간은 벽시계가 아니라 **걸음 수**로 줍니다(`__game.step`). 그래야
 *    같은 각속도가 판마다 같은 각도를 만듭니다 — SwiftShader 위에서
 *    프레임이 들쭉날쭉하면 "60°/s" 가 판마다 다른 뜻이 됩니다.
 *    (`npm run repro` 가 세워 준 바닥입니다.)
 *
 * ── ⚠️ **아직 설명 못 한 것이 둘 있습니다** ─────────────────────────
 * 이 실험대는 지금 **보스 쪽만 믿을 수 있습니다.** 남은 둘을 초록으로
 * 만들려고 문턱을 손대지 않았습니다 — 그러면 아무것도 안 재면서 초록인
 * 검사가 하나 더 생길 뿐입니다.
 *
 *   ① **보스는 80°/s 이상에서 판정이 아예 안 납니다**(빗나가는 것이
 *      아니라 판정 자체가 없습니다). 강제 공격은 남은 예고를 0.25배로
 *      세우므로(main.ts `debugForceAttack`) 그 짧은 사이에 사람이 벌 수
 *      있는 각도는 16° 뿐이고, 허용은 77° 입니다 — **각도로는 설명되지
 *      않습니다.** 원인을 모른 채 선회 값을 올리면 엉뚱한 것을 고칩니다.
 *   ② **잡몹은 0°/s 에서도 판정이 안 납니다.** 각속도와 무관하므로 이건
 *      게임이 아니라 **이 실험대가 잡몹을 세우는 방법**의 문제일 가능성이
 *      큽니다. 그래서 잡몹 표는 **읽지 마십시오** — 아래 게이트가 빨간
 *      것이 그 뜻입니다.
 *
 * 둘 다 다음 라운드의 첫 일감입니다. 여기 적어 두는 이유는 하나입니다 —
 * **못 잰 것을 통과로 적지 않기 위해서.**
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5257
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

const STEP_DT = 1 / 60
/** 재는 각속도들(°/초). 사람의 옆걸음은 이 중 어디쯤인지 아래에서 셉니다. */
const SPEEDS = [0, 20, 40, 60, 80, 100, 120, 150]

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
  const page = await browser.newPage({ viewport: { width: 480, height: 320 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🎯 추적 실험대 — **얼마나 빨리 도는 사람까지 따라잡는가**\n')

  /**
   * 한 판 = 각속도 하나. 매번 **적을 새로 세웁니다** — 앞 판의 회전이
   * 남아 있으면 "이번 각속도" 가 아니라 "지난 판의 나머지"를 재게 됩니다.
   */
  await page.evaluate(() => {
    window.__track = ({ kind, atkIndex, degPerSec, radius, dt }) => {
      const G = window.__game
      G.setPaused(true)
      G.clearEnemies()
      G.swings() // 앞 판의 장부를 비웁니다
      const e = kind === 'boss' ? G.spawnBoss(0, 0) : G.spawnTestEnemy(0, 0, 0, false)
      // 플레이어를 적의 **정면**에 세웁니다(각도 0에서 출발).
      let ang = 0
      const px = () => Math.sin(ang) * radius
      const pz = () => Math.cos(ang) * radius
      G.teleportPlayer(px(), pz())
      /**
       * 적이 플레이어를 향해 돌 시간을 줍니다 — 시작부터 등지고 있으면
       * 이 실험이 "추적"이 아니라 "처음에 어디를 보고 있었나"를 잽니다.
       *
       * ⚠️ **적이 쉬고 있을 때까지 기다립니다.** 처음엔 90걸음만 굴리고
       *    바로 강제 공격을 걸었는데, 그 사이에 적이 **스스로 공격을 시작**
       *    해 버립니다. 그 위에 덮어쓰면 상태가 어긋나 판정이 아예 안 나고,
       *    표에는 "빗나감"으로 찍힙니다 — 잡몹은 0°/s 에서도 그랬습니다.
       *    실험대가 자기 손으로 만든 결과를 게임의 성질로 읽을 뻔했습니다.
       */
      let waited = 0
      for (; waited < 600; waited++) {
        G.teleportPlayer(px(), pz())
        G.step(1, dt)
        const st = G.enemyInfo(e)
        if (waited > 60 && st && st.state === 0) break
      }
      G.forceAttack(e, atkIndex)
      // 예고 + 판정이 끝날 만큼 굴립니다. 그동안 플레이어는 원을 그립니다.
      const w = (degPerSec * Math.PI) / 180
      for (let i = 0; i < 180; i++) {
        ang += w * dt
        G.teleportPlayer(px(), pz())
        G.step(1, dt)
      }
      const rows = G.swings()
      // 판정이 안 났을 때 **적이 무엇을 하고 있었는지**를 같이 봅니다 —
      // "빗나갔다"와 "휘두르다 말았다"는 고칠 곳이 정반대입니다.
      const info = G.enemyInfo(e)
      return { rows, waited, turned: Math.round((ang * 180) / Math.PI), state: info?.state, phase: info?.phase, winding: info?.winding, alive: !!info }
    }
  })

  /**
   * 🚧 **사람이 실제로 낼 수 있는 각속도**를 게임에서 읽습니다.
   * 여기 숫자를 적으면 이동 속도를 손보는 날 이 실험대가 조용히 옛말이
   * 됩니다 — 이 저장소가 여러 번 치른 값입니다.
   */
  const human = await page.evaluate(() => ({ speed: window.__game.terrainInfo().playerMoveSpeed }))
  /**
   * 🚧 **서는 거리도 게임에서 읽습니다.**
   *
   * ⚠️ 처음엔 두 적 모두 2.5m 에 세웠습니다. 그랬더니 잡몹은 **한 번도
   *    안 휘둘렀습니다** — 잡몹의 사거리가 그보다 짧아서 강제 공격을
   *    시켜도 판정이 안 납니다. 그 표를 그대로 읽었다면 *"잡몹은 아무도
   *    못 맞힌다"* 는 엉뚱한 결론이 나왔을 것입니다.
   *    (게이트가 그걸 잡았습니다 — 가만히 선 사람이 안 맞았으니까요.)
   */
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  for (const kind of ['boss', 'grunt']) {
    const def = roster.find((r) => r.id === kind)
    // 사거리의 60% — 확실히 안쪽이면서, 회전이 각도차로 바뀌는 거리입니다.
    const RADIUS = Number((((def?.attackReach ?? def?.attackRange ?? 4.2) * 0.6)).toFixed(2))
    const rows = []
    for (const deg of SPEEDS) {
      const r = await page.evaluate(
        async ([k, d, rad, dt]) => window.__track({ kind: k, atkIndex: 0, degPerSec: d, radius: rad, dt }),
        [kind, deg, RADIUS, STEP_DT],
      )
      const rec = (r.rows ?? [])[0]
      /**
       * ⚠️ **"장부에 없다"와 "빗나갔다"는 다른 말입니다.**
       *
       * 첫 판에서 80°/s 이상이 전부 "빗나감"으로 찍혔는데, 실은 장부에
       * 줄이 **한 개도 없었습니다** — 판정 자체가 안 난 것입니다. 그 둘을
       * 같은 칸에 적으면 *"각도로 빗나간다"* 와 *"아예 안 휘두른다"* 가
       * 구분이 안 되고, 고칠 곳이 정반대가 됩니다.
       */
      rows.push({
        deg,
        id: rec?.attackId ?? '',
        swung: !!rec,
        state: r.state,
        phase: r.phase,
        alive: r.alive,
        hit: rec?.hit === true,
        ang: rec ? Math.round(rec.angleDeg) : -1,
        arc: rec ? Math.round(rec.halfArcDeg) : -1,
      })
    }
    console.log(`  [${kind}] 반경 ${RADIUS}m · 공격 ${rows.find((r) => r.id)?.id ?? '(한 번도 안 휘두름)'}`)
    for (const r of rows) {
      const what = !r.swung ? '판정 안 남' : r.hit ? '맞음      ' : '각도로 빗나감'
      console.log(
        `     ${String(r.deg).padStart(3)}°/s → ${what}` +
          (r.swung ? ` (각도차 ${String(r.ang).padStart(3)}° / 허용 ${r.arc}°)` : ` [적 상태 ${r.state} · 단계 ${r.phase} · 살아있음 ${r.alive}]`),
      )
    }
    const lastHit = [...rows].reverse().find((r) => r.hit)
    const firstMiss = rows.find((r) => !r.hit)
    console.log(
      `     → 따라잡는 한계 **${lastHit ? lastHit.deg : '없음'}°/s** · 처음 놓치는 곳 ${
        firstMiss ? `${firstMiss.deg}°/s` : '없음'
      }\n`,
    )
    /**
     * 🚧 게이트 — **가만히 선 사람은 반드시 맞아야** 합니다.
     *    이게 깨지면 위 표는 추적이 아니라 다른 고장을 재고 있는 것입니다.
     */
    check(
      rows[0].hit,
      `🚧 [${kind}] 가만히 선 사람은 맞는다 (아래 표가 추적을 재고 있다는 근거)`,
      `0°/s — ${!rows[0].swung ? '판정이 안 났습니다' : rows[0].hit ? '맞음' : '빗나감'}`,
    )
    /**
     * 🎯 **옆으로 걷는 정도는 따라잡아야 합니다.**
     *
     * 사람이 반경 2.5m 에서 옆걸음으로 내는 각속도 = 이동속도 / 반경.
     * 게임에서 읽은 값으로 계산합니다 — 여기 숫자를 적지 않습니다.
     */
    const walkDeg = Math.round(((human.speed / RADIUS) * 180) / Math.PI)
    const atWalk = rows.reduce((best, r) => (Math.abs(r.deg - walkDeg) < Math.abs(best.deg - walkDeg) ? r : best), rows[0])
    check(
      atWalk.hit,
      `🎯 [${kind}] **옆으로 걷는 정도는 따라잡는다** (${walkDeg}°/s = 이동속도 ${human.speed}m/s ÷ 반경 ${RADIUS}m)`,
      `${atWalk.deg}°/s 에서 ${atWalk.hit ? '맞음' : '빗나감'} · 각도차 ${atWalk.ang}° / 허용 ${atWalk.arc}°`,
    )
    /**
     * 🗡 **그렇다고 전부 따라오면 안 됩니다** — 백어택(기둥 3)이 죽습니다.
     *    가장 빠르게 도는 손은 반드시 놓쳐야 합니다.
     */
    check(
      !rows[rows.length - 1].hit,
      `🗡 [${kind}] **작정하고 돌면 놓친다** (백어택이 보상으로 남아야 합니다)`,
      `${rows[rows.length - 1].deg}°/s 에서 ${rows[rows.length - 1].hit ? '맞음 — 등 뒤를 못 잡습니다' : '빗나감'}`,
    )
  }

  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | ') || '없음')
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 — 위 숫자는 완결된 것이 아닙니다.
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 위 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
