/**
 * 막히는 자리 — `npm run stuck`
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * 자동 플레이 기록에 **25초 막힘**이 반복해서 남았습니다. 지금까지 남은
 * 일곱 건 중 **여섯이 「무너진 회랑」**, 그것도 두 지점에 뭉쳐 있습니다:
 *
 *     (17, -2) · (24, 2) · (24, 3) · (24, 28) · (25, 28)  … 그리고 (48, 16)
 *
 * 한 판에서 25초를 잃으면 보스에 못 갑니다. 클리어 시간이 215~305초로
 * 흔들리는 것도, 어떤 판은 보스를 아예 못 보는 것도 여기서 나옵니다.
 *
 * ── 왜 별도 프로브인가 ─────────────────────────────────────────
 * 막힘은 **판마다 날 수도 안 날 수도** 있습니다. 실제로 덫을 놓은 다음
 * 판은 69마리를 잡고 막힘 없이 끝나서 아무것도 못 봤습니다. 운에 기대는
 * 계측은 계측이 아닙니다 — 그래서 **그 좌표에 직접 세워 놓고** 묻습니다.
 *
 * ── 무엇을 묻는가 ──────────────────────────────────────────────
 * 원인 후보가 둘이고 처방이 정반대입니다:
 *
 *   · **길이 없다**   → 지도·충돌의 이야기 (지형을 고쳐야 합니다)
 *   · **길은 있는데
 *      목표가 진동한다** → 봇 정책의 이야기 (지형은 멀쩡합니다)
 *
 * 그래서 두 가지를 봅니다:
 *   ① 그 자리에서 **강화대·보물·목표까지 길이 있는가**(`pathStep`)
 *   ② 그 길들이 **서로 반대쪽을 가리키는가** — 왕복의 서명입니다.
 *      봇이 두 목표를 번갈아 고르면, 방향이 180°에 가까울수록 제자리에서
 *      진동합니다. 기록에 `[보물이동×76 강화이동×14]` 라고 남은 그 모양입니다.
 *
 * ⚠️ 걸음을 **실제로 밟아 봅니다.** 한 걸음만 물어보면 "길이 있다"까지밖에
 *    말 못 합니다. 그 길로 몇 걸음 가서 **정말 가까워지는지** 봐야
 *    "돌다가 제자리로 오는 길"을 잡을 수 있습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5231
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/**
 * 실제로 기록에 남은 자리들입니다. **지어낸 좌표가 아닙니다** — 지어내면
 * "거기서는 안 막히던데요"가 되고, 재현이 아니라 상상이 됩니다.
 */
const SPOTS = [
  { x: 17, z: -2, note: '보물이동×76 강화이동×14' },
  { x: 24, z: 2, note: '강화이동' },
  { x: 24, z: 28, note: '반복' },
  { x: 25, z: 28, note: '반복' },
  { x: 48, z: 16, note: '오르는 계단' },
]

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

  console.log('\n🧭 막히는 자리 — 길이 없는가, 목표가 진동하는가\n')

  const out = await page.evaluate(async ([spots]) => {
    const G = window.__game
    const nap = () => new Promise((r) => setTimeout(r, 4))
    const now = () => G.state().simElapsed
    const wait = async (sec) => {
      const t0 = now()
      const dl = Date.now() + 20000
      while (now() - t0 < sec && Date.now() < dl) await nap()
    }

    G.reset()
    await wait(0.6)
    // 적이 붙으면 "막힘"이 전투 때문인지 길 때문인지 섞입니다. 길만 봅니다.
    G.clearEnemies()
    G.freezeEnemies(true)
    await wait(0.3)

    const anvils = G.anvils()
    const treasures = G.treasurePositions().filter((t) => !t.taken)

    const rows = []
    for (const s of spots) {
      G.teleportPlayer(s.x, s.z)
      await wait(0.4)
      const here = G.state().player

      /** 목표까지 한 걸음을 묻고, 그 방향(라디안)과 남은 거리를 돌려줍니다. */
      const ask = (tx, tz) => {
        const st = G.pathStep(tx, tz)
        if (!st) return null
        return { dist: st.dist, ang: Math.atan2(st.x - here.x, st.z - here.z) }
      }

      const nearestAnvil = anvils
        .map((a) => ({ ...a, d: Math.hypot(a.x - here.x, a.z - here.z) }))
        .sort((a, b) => a.d - b.d)[0]
      const nearestTreasure = treasures
        .map((t) => ({ ...t, d: Math.hypot(t.x - here.x, t.z - here.z) }))
        .sort((a, b) => a.d - b.d)[0]

      const toAnvil = nearestAnvil ? ask(nearestAnvil.x, nearestAnvil.z) : null
      const toTreasure = nearestTreasure ? ask(nearestTreasure.x, nearestTreasure.z) : null

      /**
       * 두 목표가 **서로 반대쪽**이면 왕복의 조건이 갖춰집니다. 각도 차이를
       * 0~180° 로 접어서 냅니다 — 부호는 왕복 여부와 상관없습니다.
       */
      let spread = -1
      if (toAnvil && toTreasure) {
        let d = Math.abs(toAnvil.ang - toTreasure.ang)
        while (d > Math.PI) d = Math.abs(d - Math.PI * 2)
        spread = (d * 180) / Math.PI
      }

      /**
       * 길을 **실제로 밟아 봅니다.** 한 걸음씩 순간이동하며 남은 거리가
       * 정말 줄어드는지 봅니다. 줄지 않으면 "길이 있다"가 거짓말입니다.
       */
      let walked = null
      if (toAnvil && nearestAnvil) {
        let px = here.x
        let pz = here.z
        let last = toAnvil.dist
        let worst = 0
        let steps = 0
        const dl = Date.now() + 15000
        while (steps < 40 && Date.now() < dl) {
          const st = G.pathStep(nearestAnvil.x, nearestAnvil.z)
          if (!st) break
          if (st.dist <= 2) break
          // 뒤로 간 걸음이 있으면 그 크기를 기억합니다 — 진동의 흔적입니다.
          if (st.dist > last + 0.01) worst = Math.max(worst, st.dist - last)
          last = st.dist
          px = st.x
          pz = st.z
          G.teleportPlayer(px, pz)
          await wait(0.06)
          steps++
        }
        walked = { steps, left: Number(last.toFixed(1)), backStep: Number(worst.toFixed(2)) }
        G.teleportPlayer(s.x, s.z)
        await wait(0.2)
      }

      /**
       * ── 🔨 **다 왔는데 아무 일도 안 일어나는 것** ────────────────────
       *
       * 좌표를 찍어 보고서야 알았습니다 — 막힌 자리 셋은 **강화대 바로
       * 위**입니다((25,29)·(49,17)). 즉 길이 없어서 못 간 게 아니라,
       * **도착한 채로 25초를 서 있었습니다.**
       *
       * 그러면 질문이 바뀝니다: *"왜 도착해서 아무 일도 안 일어나는가."*
       * 그 자리에서 강화 조건을 그대로 물어봅니다.
       */
      const up = G.weaponUpgradeInfo()
      rows.push({
        ...s,
        upgrade: {
          level: up.level,
          maxLevel: up.maxLevel,
          embers: G.state().player.embers ?? G.emberInfo?.()?.embers ?? -1,
          nextCost: up.nextCost,
          stones: up.stones,
          nextStoneCost: up.nextStoneCost,
          atStation: up.atStation,
        },
        anvilDist: toAnvil ? Number(toAnvil.dist.toFixed(1)) : -1,
        treasureDist: toTreasure ? Number(toTreasure.dist.toFixed(1)) : -1,
        spread: Number(spread.toFixed(0)),
        walked,
      })
    }
    G.freezeEnemies(false)
    return { rows, anvils, treasures }
  }, [SPOTS])

  console.log(
    `  [세계] 강화대 ${out.anvils.length}곳 ${out.anvils.map((a) => `(${a.x},${a.z})`).join(' ')}` +
      ` · 안 주운 보물 ${out.treasures.length}개 ${out.treasures.map((t) => `(${t.x},${t.z})`).join(' ')}\n`,
  )
  console.log('  [자리]        강화대까지   보물까지   두 방향의 벌어짐   걸어 본 결과')
  for (const r of out.rows) {
    const w = r.walked
      ? `${r.walked.steps}걸음 → 남은 ${r.walked.left}m` +
        (r.walked.backStep > 0 ? ` · **뒷걸음 ${r.walked.backStep}m**` : '')
      : '길 없음'
    console.log(
      `    (${String(r.x).padStart(3)},${String(r.z).padStart(4)})   ` +
        `${r.anvilDist < 0 ? '  길 없음' : `${String(r.anvilDist).padStart(6)}m`}   ` +
        `${r.treasureDist < 0 ? ' 길 없음' : `${String(r.treasureDist).padStart(5)}m`}   ` +
        `${r.spread < 0 ? '    —' : `${String(r.spread).padStart(5)}°`}          ${w}`,
    )
  }
  console.log('')

  console.log('  [강화대 위에서] 단계   불티 필요/가진   정련석 필요/가진   대 앞인가')
  for (const r of out.rows) {
    const u = r.upgrade
    if (!u?.atStation) continue
    console.log(
      `    (${String(r.x).padStart(3)},${String(r.z).padStart(4)})      ` +
        `${u.level}/${u.maxLevel}    ${u.nextCost} / ${u.embers}      ` +
        `${u.nextStoneCost} / ${u.stones}         ${u.atStation ? 'O' : 'X'}`,
    )
  }
  const atStation = out.rows.filter((r) => r.upgrade?.atStation)
  console.log(`    (강화대 앞으로 잡힌 자리 ${atStation.length}곳)\n`)

  check(
    out.rows.length === SPOTS.length,
    '🧭 기록에 남은 자리를 **전부 세워 봤다** (비교의 게이트)',
    `${out.rows.length}/${SPOTS.length}곳`,
  )

  /**
   * ① **길이 아예 없는 자리**가 있는가. 있으면 지형의 이야기입니다 —
   *    사람이 그 자리에 서면 길안내가 영원히 닿지 않는 곳을 가리킵니다.
   */
  const noPath = out.rows.filter((r) => r.anvilDist < 0 && r.treasureDist < 0)
  check(
    noPath.length === 0,
    '🧭 **어느 자리에서도 길이 아예 없지는 않다** (지형이 가둔 자리가 없다)',
    noPath.length ? noPath.map((r) => `(${r.x},${r.z})`).join(' · ') : `${out.rows.length}곳 모두 길 있음`,
  )

  /**
   * ② 길이 있는데 **밟아도 안 가까워지는** 자리가 있는가. 이게 있으면
   *    `pathStep` 이 거짓말을 하는 것이고, 봇이 아니라 **길찾기**의 이야기입니다.
   */
  /**
   * ⚠️ **이 검사가 처음엔 거짓말을 했습니다.** 「밟아도 안 가까워진다」로
   *    세 자리를 빨갛게 찍었는데, 그 셋은 **이미 도착한 자리**였습니다
   *    (강화대까지 0m). 0m 에서 0m 가 된 것을 "안 가까워졌다"로 읽은
   *    것이고, 게임이 아니라 제 자가 틀린 것이었습니다.
   *    이미 도착한 자리는 **걷는 검사의 표본이 아닙니다.**
   */
  const walkedRows = out.rows.filter((r) => r.walked && r.anvilDist > 2)
  const notCloser = walkedRows.filter((r) => r.walked.left >= r.anvilDist - 0.5)
  check(
    walkedRows.length > 0 && notCloser.length === 0,
    '🧭 **길을 밟으면 실제로 가까워진다** (길안내가 거짓말을 안 한다)',
    walkedRows.length === 0
      ? '걸어 볼 자리가 없었습니다(전부 이미 도착)'
      : notCloser.length
        ? notCloser.map((r) => `(${r.x},${r.z}) ${r.anvilDist}m→${r.walked.left}m`).join(' · ')
        : walkedRows.map((r) => `(${r.x},${r.z}) ${r.anvilDist}→${r.walked.left}m`).join(' · '),
  )

  /**
   * ── 🔨 **여기가 25초를 먹은 자리입니다** ────────────────────────────
   *
   * 막힌 자리 셋은 전부 **강화대 위**였습니다. 길이 없어서가 아니라,
   * 도착한 채로 아무 일도 안 일어나서 서 있었던 것입니다. 그 자리에서
   * 강화 조건을 물어보면 답이 나옵니다 — 불티는 넘치는데 **정련석이
   * 모자랍니다**(필요 1 · 가진 0).
   *
   * ⚠️ 이건 **눈금이지 검사가 아닙니다.** 정련석이 없는 것 자체는 잘못이
   *    아닙니다(그게 정련석의 존재 이유입니다). 잘못은 *"그 자리에 서면
   *    무엇이 모자란지 아무도 말해 주지 않는다"* 쪽이고, 그건 화면의
   *    몫입니다. 여기서는 조건만 찍습니다.
   */
  const blocked = out.rows.filter(
    (r) => r.upgrade?.atStation && r.upgrade.stones < r.upgrade.nextStoneCost,
  )
  console.log(
    `  🔨 강화대 위인데 **못 하는** 자리 ${blocked.length}곳` +
      (blocked.length
        ? ` — ${blocked
            .map(
              (r) =>
                `(${r.x},${r.z}) 정련석 ${r.upgrade.stones}/${r.upgrade.nextStoneCost}` +
                ` · 불티 ${r.upgrade.embers}/${r.upgrade.nextCost}`,
            )
            .join(' · ')}`
        : ''),
  )

  /**
   * ③ 두 목표가 **정반대**를 가리키는 자리 — 왕복의 조건입니다.
   *
   * ⚠️ 이건 **검사가 아니라 눈금**입니다. 정반대라는 사실 자체는 잘못이
   *    아닙니다(강화대와 보물이 양쪽에 있을 수 있습니다). 잘못은 봇이
   *    그 사이에서 **매 프레임 마음을 바꾸는 것**이고, 그건 이 프로브가
   *    아니라 정책이 답할 몫입니다. 여기서는 조건이 갖춰졌는지만 찍습니다.
   */
  const opposed = out.rows.filter((r) => r.spread >= 120)
  console.log(
    `  📐 두 목표가 120° 이상 벌어진 자리 ${opposed.length}곳` +
      (opposed.length ? ` — ${opposed.map((r) => `(${r.x},${r.z}) ${r.spread}°`).join(' · ')}` : '') +
      `  ← 왕복이 **가능한** 자리라는 뜻이지, 왕복했다는 뜻은 아닙니다`,
  )

  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} catch (err) {
  console.error(
    `\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`,
  )
  fail++
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
