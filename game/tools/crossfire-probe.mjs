/**
 * ── 🔀 **「오사」는 기량인가 부산물인가** ────────────────────────────────
 *
 * ── 왜 만들었는가 ──────────────────────────────────────────────────
 * 강인도 장부를 켜고 다섯 판을 재는 동안, 설계가 **이름조차 대지 않은 것**이
 * 계속 상위권이었습니다 — 「오사」(적이 적을 때린 것):
 *
 *     18% (2위) · **31% (1위)** · 13% · **27% (1위)** · 13%
 *
 * 가드에 이어 **두 번째로 이름 없는 기둥**입니다. 그런데 가드와 성격이
 * 다릅니다 — 가드는 «버튼»이고 오사는 **«자리»** 입니다.
 *
 * 그래서 「골라서 낸 것」 칸에 **일부러 안 넣었습니다.** 봇이 자리를
 * «노려서» 잡은 것인지 그냥 그렇게 서 있게 된 것인지 못 가리기 때문입니다.
 * **못 가리는 것을 실력 칸에 넣으면 비율이 저절로 좋아 보입니다.**
 *
 * ── 무엇을 묻는가 ──────────────────────────────────────────────────
 * 딱 하나입니다: **자리를 노리면 오사가 늘어나는가.**
 *
 *   · 늘어난다 → 오사는 **기량의 축**입니다. 그러면 설계 문서에 이름을
 *     올리고 **화면에도 신호**를 줘야 합니다(지금은 아무 표시가 없고,
 *     이 저장소의 규칙대로 **안 보이는 것은 읽기가 아니라 우연**입니다).
 *   · 안 늘어난다 → 다대일의 부산물입니다. 그러면 「골라서 낸 것」에서
 *     계속 빼 두는 것이 맞습니다.
 *
 * ── 어떻게 가르는가 ────────────────────────────────────────────────
 * 이번 회차에 두 번 값을 한 방법을 그대로 씁니다 — **손을 나눠 재기**:
 *
 *     ① 그냥 붙기   — 가장 가까운 적 옆에 서서 팹니다
 *     ② 줄 세우기   — **다른 적을 사이에 두고** 섭니다
 *
 *                        ②의 그림
 *          [적 A] ──────▶ [적 B] ──────▶ [나]
 *                A 가 나를 향해 휘두르면 그 부채꼴에 **B 가 들어갑니다**
 *
 * ⚠️ **순간이동으로 세웁니다 — 그리고 그것이 이 계기의 한계입니다.**
 *    사람은 걸어서 그 자리에 가야 하고, 가는 동안 맞습니다. 그래서 이
 *    계기가 내는 값은 **«잘 서면 얼마나 되는가»의 상한**이지 실전 값이
 *    아닙니다. 상한이 낮으면 축이 아예 없는 것이고(그때는 여기서 끝),
 *    상한이 높으면 **그다음에 «걸어서 갈 수 있는가»를 따로 재야** 합니다.
 *    이 저장소가 `secret-probe` 에서 직선거리로 재다 뒤집힌 그 자리입니다.
 *
 * 실행: node tools/crossfire-probe.mjs   (npm run crossfire)
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const PORT = 5211

/** 몇 마리를 세울 것인가. 오사는 **둘 이상**이어야 생기므로 셋이 최소 표본. */
const FOES = 3
/** 한 손을 재는 시간(시뮬 초). */
const SECONDS = 70

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}
function pct(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'
}

const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

try {
  await sleep(4000)
  const browser = await chromium.launch({ executablePath: execPath })
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
  page.on('pageerror', (e) => console.log(`  💥 ${e}`))
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 30000 })
  await sleep(1200)

  /** 시뮬 시간으로 기다립니다 — 벽시계로 재면 판마다 다른 시간이 됩니다. */
  await page.evaluate(() => {
    window.__t = {
      runFor: async (seconds) => {
        const target = window.__game.state().elapsed + seconds
        const deadline = Date.now() + 200000
        while (window.__game.state().elapsed < target && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 8))
        }
      },
    }
  })

  console.log(`\n🔀 「오사」는 기량인가 부산물인가 — 잡몹 ${FOES}마리 · 손 2갈래\n`)

  const rows = []
  for (const hand of [0, 1]) {
    const r = await page.evaluate(
      async ([hand, foes, seconds]) => {
        const G = window.__game
        const now = () => G.state().elapsed
        const before = G.runStats()
        const baseLever = { ...(before.poiseLever ?? {}) }
        const baseHits = { ...(before.poiseHits ?? {}) }
        const baseBy = { ...(before.breakBy ?? {}) }

        G.clearEnemies()
        await window.__t.runFor(0.2)

        /** 셋을 삼각으로 세웁니다 — 한 줄로 세우면 ①이 공짜로 유리해집니다. */
        const ids = []
        for (let i = 0; i < foes; i++) {
          const a = (i / foes) * Math.PI * 2
          const e = G.spawnEnemyKind('grunt', 6 + Math.cos(a) * 3, Math.sin(a) * 3)
          if (e >= 0) ids.push(e)
        }
        if (ids.length < 2) return { error: '적을 둘 이상 못 세웠습니다' }
        await window.__t.runFor(0.3)

        let lined = 0
        let frames = 0
        const t0 = now()
        let guard = 0
        while (now() - t0 < seconds && guard++ < 200000) {
          const alive = ids.map((e) => ({ e, i: G.enemyInfo(e) })).filter((o) => o.i && o.i.hp > 0)
          /** 죽으면 다시 세웁니다 — 재려는 것은 자리지 승패가 아닙니다. */
          if (alive.length < 2) {
            /** 둘 미만이 되면 판을 새로 세웁니다 — 오사는 둘 이상에서만 생깁니다. */
            G.clearEnemies()
            ids.length = 0
            for (let i = 0; i < foes; i++) {
              const a = (i / foes) * Math.PI * 2
              const e = G.spawnEnemyKind('grunt', 6 + Math.cos(a) * 3, Math.sin(a) * 3)
              if (e >= 0) ids.push(e)
            }
            await window.__t.runFor(0.3)
            continue
          }
          /** 둘 다 안 죽게 채웁니다. */
          G.setHp(G.playerEntity(), 100)
          G.setStamina(100)
          for (const o of alive) G.setHp(o.e, o.i.max)

          let target = alive[0]
          if (hand === 0) {
            /**
             * ① **그냥 붙기** — 가장 가까운 적 옆에 섭니다. 자리를 안 봅니다.
             */
            const p = G.state().player
            target = alive.reduce((a, b) =>
              Math.hypot(a.i.x - p.x, a.i.z - p.z) <= Math.hypot(b.i.x - p.x, b.i.z - p.z) ? a : b,
            )
            G.teleportPlayer(target.i.x - 1.8, target.i.z)
          } else {
            /**
             * ② **줄 세우기** — 다른 적(A)과 일직선이 되게, 가운데 적(B)의
             *    **반대편**에 섭니다:
             *
             *        [A] ────▶ [B] ────▶ [나]
             *
             *    A 가 나를 향해 휘두르면 그 부채꼴에 B 가 들어갑니다.
             *    A 는 **예고 중인 적**을 우선 고릅니다 — 지금 휘두를 놈이
             *    줄의 머리여야 뜻이 있습니다.
             */
            const shooter =
              alive.find((o) => o.i.winding === true) ??
              alive.reduce((a, b) => (a.e < b.e ? a : b))
            const mid = alive.find((o) => o.e !== shooter.e)
            if (!mid) continue
            target = mid
            const dx = mid.i.x - shooter.i.x
            const dz = mid.i.z - shooter.i.z
            const len = Math.hypot(dx, dz) || 1
            G.teleportPlayer(mid.i.x + (dx / len) * 1.8, mid.i.z + (dz / len) * 1.8)
            lined++
          }
          frames++
          G.aimAtWorld(target.i.x, target.i.z)
          G.press('Mouse0')
          G.release('Mouse0')
          await window.__t.runFor(0.05)
        }
        const elapsed = now() - t0
        G.clearEnemies()

        const after = G.runStats()
        const delta = (nowV, base) => {
          const out = {}
          for (const [k, v] of Object.entries(nowV ?? {})) {
            const d = v - (base[k] ?? 0)
            if (d > 0.0001) out[k] = Number(d.toFixed(2))
          }
          return out
        }
        return {
          elapsed: Number(elapsed.toFixed(1)),
          frames,
          lined,
          lever: delta(after.poiseLever, baseLever),
          hits: delta(after.poiseHits, baseHits),
          by: delta(after.breakBy, baseBy),
        }
      },
      [hand, FOES, SECONDS],
    )
    if (r.error) {
      console.log(`  💥 ${r.error}`)
      continue
    }
    rows.push({ hand, ...r })
    const lTot = Object.values(r.lever).reduce((a, v) => a + v, 0)
    const hTot = Object.values(r.hits).reduce((a, v) => a + v, 0)
    const bTot = Object.values(r.by).reduce((a, v) => a + v, 0)
    const fmt = (o, tot) =>
      Object.entries(o)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${pct(v, tot)}`)
        .join(' · ') || '없음'
    console.log(
      `  ${hand === 0 ? '① 그냥 붙기 ' : '② 줄 세우기 '} — ${r.elapsed}초 · 붕괴 ${bTot}회\n` +
        `       지렛대(일한 몫): ${fmt(r.lever, lTot)}\n` +
        `       지렛대(대수)   : ${fmt(r.hits, hTot)}\n` +
        `       이름이 남은 것 : ${fmt(r.by, bTot)}`,
    )
  }

  console.log('')
  /**
   * ⚠️ **분모부터 봅니다.** 두 손 다 실제로 때렸어야 견줄 수 있습니다.
   *    이 저장소가 「분모 1짜리 비율」로 세 번 뒤집힌 자리입니다.
   */
  check(rows.length === 2, '🧾 두 손 다 돌았다 (비교의 게이트)', `${rows.length}/2`)
  if (rows.length === 2) {
    const tot = (r) => Object.values(r.hits).reduce((a, v) => a + v, 0)
    check(
      tot(rows[0]) >= 20 && tot(rows[1]) >= 20,
      '🔢 두 손 다 충분히 때렸다 (비율의 분모)',
      `① ${tot(rows[0])}대 · ② ${tot(rows[1])}대`,
    )
    if (tot(rows[0]) >= 20 && tot(rows[1]) >= 20) {
      /**
       * ⚠️ **일한 몫이 아니라 «대수»로 견줍니다.** 일한 몫은 배수(오사는
       *    ×1.6, 기본은 ×0.35)가 곱해진 값이라, 드물게 걸려도 커 보입니다.
       *    「자리를 노리면 **더 자주** 일어나는가」를 묻는 것이므로 대수가
       *    맞는 자입니다(이 회차의 `poiseHitsByLever` 설계 노트).
       */
      const share = (r, k) => (r.hits[k] ?? 0) / tot(r)
      const a = share(rows[0], '오사')
      const b = share(rows[1], '오사')
      /**
       * ── ⚠️ **몫이 올라도 «결과»가 그대로면 축이 아닙니다** ─────────────
       *
       * 첫 판에서 이 줄이 «기량의 축입니다» 라고 초록을 냈습니다 —
       * 오사 대수가 9% → 16% 로 **1.8배** 올랐으니까요. 그런데 같은
       * 판의 다른 두 줄이 이렇게 나와 있었습니다:
       *
       *     붕괴  ① 32회 / 70초   vs   ② 29회 / 70.1초
       *     타수  ① 129대          vs   ② 124대
       *
       * **아무것도 나아지지 않았습니다.** 자리를 노려서 얻은 것은
       * «오사의 몫»이지 «더 빨리 무너뜨림»이 아니었습니다. 몫은 파이를
       * 어떻게 나눴는지만 말하고, 파이가 커졌는지는 말하지 않습니다.
       *
       * 이 저장소가 「비율은 분모가 성한지부터」로 세 번 데였는데, 이건
       * 그 사촌입니다 — **분모는 성한데 파이가 안 커진 경우.** 그래서
       * 이제 **몫과 결과를 둘 다** 넘겨야 초록이 납니다.
       */
      const rate = (r) => (r.elapsed > 0 ? Object.values(r.by).reduce((x, v) => x + v, 0) / r.elapsed : 0)
      const rA = rate(rows[0])
      const rB = rate(rows[1])
      const shareUp = b >= a * 1.5 && b >= 0.1
      const outcomeUp = rA > 0 && rB >= rA * 1.15
      console.log(
        `  🔀 **자리를 노리면 오사가 늘어나는가** — ` +
          `① 그냥 ${(a * 100).toFixed(0)}% vs ② 줄 세우기 ${(b * 100).toFixed(0)}% (대수 기준)\n` +
          `     초당 붕괴 — ① ${rA.toFixed(3)} vs ② ${rB.toFixed(3)}\n` +
          `     ${
            shareUp && outcomeUp
              ? '→ **기량의 축입니다.** 몫도 오르고 **결과도** 좋아집니다 — 설계 문서에 ' +
                '이름을 올리고 **화면에 신호**를 줘야 합니다.'
              : shareUp
                ? '→ **몫만 오르고 결과는 그대로입니다.** 오사는 자리를 노리면 늘긴 하지만, ' +
                  '그것으로 **더 빨리 무너뜨리지는 못합니다.** 기둥으로 올릴 근거가 아직 없습니다.'
                : '→ **부산물입니다.** 잘 서도 안 늘어납니다 — 「골라서 낸 것」에서 계속 빼 두는 것이 맞습니다.'
          }`,
      )
      /**
       * 🔍 **그 자리가 «실제로» 산 것은 무엇인가.**
       *
       * ②는 오사만 사지 않습니다. 다른 적 뒤에 서면 **그 적의 등 뒤**에도
       * 서게 됩니다. 첫 판에서 백어택이 **0% → 31%** 로 뛰었는데, 이건
       * 오사(9→16%)보다 **훨씬 큰 변화**입니다. 그리고 백어택은 설계가
       * **이미 이름을 댄** 축입니다.
       *
       * 즉 «줄 세우기»가 산 것의 대부분은 새 기둥이 아니라 **있던 기둥**
       * 입니다. 한 손이 두 가지를 동시에 바꾸면 큰 쪽이 작은 쪽의 공을
       * 가져갑니다 — 그래서 **바뀐 것을 전부 나열**합니다.
       */
      const moved = [...new Set([...Object.keys(rows[0].hits), ...Object.keys(rows[1].hits)])]
        .map((k) => ({ k, d: share(rows[1], k) - share(rows[0], k) }))
        .filter((o) => Math.abs(o.d) >= 0.03)
        .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
      console.log(
        `  🔍 그 자리가 실제로 바꾼 것 — ` +
          moved.map((o) => `${o.k} ${o.d > 0 ? '+' : ''}${(o.d * 100).toFixed(0)}%p`).join(' · ') +
          (moved.length > 0 && moved[0].k !== '오사'
            ? `\n     → 가장 크게 바뀐 것은 **${moved[0].k}** 입니다. 오사가 아니라 그쪽을 보십시오.`
            : ''),
      )
      console.log(
        `     ⚠️ 이 값은 **순간이동으로 세운 상한**입니다. 사람은 걸어서 가야 하고,\n` +
          `        가는 동안 맞습니다 — 상한이 높으면 «걸어서 갈 수 있는가»를 따로 재야 합니다.`,
      )
    }
  }

  await browser.close()
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  dev.kill()
}
