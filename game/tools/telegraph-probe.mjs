/**
 * ── 🎨 **보스 예고만 수십 개 뽑는 계기** ────────────────────────────
 *
 * ── 왜 만들었는가 ──────────────────────────────────────────────────
 * 「🔴 직격이 안 닿는다」를 여러 회차 쫓았는데, 근거로 쓴 표본이 매번
 * **판당 1개꼴**이었습니다. 4판 벤치를 25분 돌려도 cleave 예고가 4개입니다.
 * 그 위에서 저는 이런 주장을 했다가 다음 판에 뒤집혔습니다:
 *
 *   · 「예고가 길어서 끊긴다」   → 반대였습니다(cleave 가 가장 짧음)
 *   · 「붙어서 내니까 끊긴다」   → bind 도 minRange 0인데 안 끊깁니다
 *   · 「연계라서 끊긴다」        → 7 대 1 이었는데 **분모가 1** 이었습니다
 *
 * 세 번 다 **분모가 성하지 않은 비율**이었습니다. 계기를 더 정교하게
 * 만드는 것으로는 안 됩니다 — **표본을 늘려야** 합니다.
 *
 * ── 무엇을 하는가 ──────────────────────────────────────────────────
 * 실험장에 보스를 세우고, 플레이어를 **정해진 거리에 묶어 둔 채** 예고를
 * 수십 번 받습니다. 거리마다 따로 돌려서 *"거리가 예고의 생사를 정하는가"*
 * 를 **분모를 채워** 묻습니다.
 *
 * ⚠️ **압력을 두 갈래로 나눠 잽니다.** 이 질문의 답은 «플레이어가 무엇을
 *    하느냐»에 따라 달라지기 때문입니다:
 *      · 가만히      — 보스가 방해 없이 낼 때의 «맨 얼굴»
 *      · 계속 때림   — 실제 전투에 가까운 압력
 *    한 갈래만 재면 그게 게임의 성질인지 그 손버릇의 성질인지 못 가립니다
 *    (`DESIGN.md` 「봇의 습관을 게임의 성질로 착각한다」).
 *
 * 실행: node tools/telegraph-probe.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const PORT = 5207

/** 잴 거리(m). 보스 패턴의 minRange/maxRange 를 가로지르게 고릅니다. */
/**
 * ⚠️ **3.2m 이 빠져 있었습니다.** 처음엔 [1.6, 4.5] 로 골랐는데,
 *    조사하려던 `boss_cleave` 의 창이 **2.4~4.0m** 라 두 띠가 그 창을
 *    **양쪽으로 비껴갑니다.** 그래서 첫 판에 cleave 가 **한 번도** 안
 *    나왔습니다 — 조사 대상을 조사에서 빼놓은 계기였습니다.
 *    띠를 고를 때는 **패턴의 창을 먼저 보고** 골라야 합니다.
 */
const BANDS = [1.6, 3.2, 4.5]
/** 거리·압력 한 조합에서 받을 예고 수. 색이 5개니 색당 10개쯤 쌓입니다. */
const WANT = 30

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PREINSTALLED = ['/opt/pw-browsers/chromium']
const execPath = PREINSTALLED.find((p) => existsSync(p))

try {
  await sleep(4000)
  const browser = await chromium.launch({ executablePath: execPath })
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
  page.on('pageerror', (e) => console.log(`  💥 ${e}`))
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 30000 })
  await sleep(1200)

  /**
   * 시뮬레이션 시간으로 기다리는 헬퍼 — **벽시계가 아닙니다.**
   * (`boss-probe.mjs` 와 같은 규칙. 이 기계는 한 프레임이 최대 0.05초까지
   *  늘어나서, 벽시계로 기다리면 판마다 다른 시간을 재게 됩니다.)
   */
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
  /**
   * 🎓 **1단계 학습 잠금을 끕니다.** 켜 두면 보스 체력이 경계에 붙들려
   *    페이즈가 안 넘어가고, 그러면 2·3단계 패턴을 영영 못 봅니다 —
   *    색깔별 표본을 모으려는 이 계기의 목적과 정면으로 부딪힙니다.
   */
  await page.evaluate(() => window.__game.setPhaseTeaching?.(false))

  console.log(`\n🎨 보스 예고 표본 — 거리 ${BANDS.length}종 × 손 3갈래, 조합마다 ${WANT}개 목표\n`)

  const rows = []
  for (const band of BANDS) {
    for (const hitting of [0, 1, 2]) {
      const r = await page.evaluate(
        async ([dist, mash, want]) => {
          const G = window.__game
          const now = () => G.state().elapsed
          G.resetProgress?.()
          await window.__t.runFor(0.2)

          /** 보스를 하나 세우고 그 곁에 붙습니다. */
          const b = G.spawnEnemyKind('boss', 8, 0)
          if (b < 0) return { error: '보스를 못 세웠습니다' }
          await window.__t.runFor(0.3)

          const seen = {}
          const note = (id, k) => {
            seen[id] ??= { commits: 0, swings: 0, sumDist: 0 }
            seen[id][k]++
          }
          let winding = false
          let lastId = null
          const deadline = now() + 90
          let guard = 0
          while (now() < deadline && guard++ < 200000) {
            const bi = G.enemyInfo(b)
            if (!bi || bi.hp <= 0) break
            /**
             * ⚠️ **거리를 매 프레임 다시 맞춥니다.** 보스가 밀거나 돌진하면
             *    거리가 흔들려 «이 거리에서 잰 값»이 아니게 됩니다.
             */
            G.teleportPlayer(bi.x - dist, bi.z)
            G.aimAtWorld(bi.x, bi.z)
            G.setHp(G.playerEntity(), 100)
            G.setStamina(100)
            /** 보스도 안 죽게 채웁니다 — 재려는 것은 예고지 승패가 아닙니다. */
            G.setHp(b, G.enemyInfo(b).max)
            /**
             * ── 🥋 **손을 세 갈래로 나눕니다** ────────────────────────
             *
             * 첫 판이 이렇게 나왔습니다 — 거리를 고정하니 **끊김이
             * 0~14%** 뿐입니다. 그런데 벤치(실제 플레이)는 50~100% 입니다.
             * 같은 게임인데 계기마다 답이 다르면, 다른 것은 «게임»이
             * 아니라 **«플레이어가 쥔 것»** 입니다:
             *
             *     이 침대 — 평타만        강인도 ×0.35 → 끊김 0~14%
             *     보스 침대 — 평타만       (같은 조건) → 33%
             *     벤치 — 평타+강타+스킬                → 50~100%
             *
             * `POISE` 를 보면 답이 있습니다: 평타는 **×0.35** 로 일부러
             * 약하게 눌러 뒀고, 끊는 힘은 **강타(×2.2)** 와 «예고 중
             * 타격»(×2.5)에 몰아줬습니다. 그게 설계였습니다.
             *
             * 그러니 «붙어 있으면 예고가 죽는다»가 아니라 **«강타를 쓰면
             * 예고가 죽는다»** 일 수 있습니다. 둘은 처방이 정반대입니다 —
             * 앞은 거리(minRange), 뒤는 강인도 배수입니다.
             *
             * 그래서 손을 나눠 잽니다. 0=가만히 · 1=평타만 · 2=강타 섞기.
             */
            if (mash === 1) {
              G.press('Mouse0')
              G.release('Mouse0')
            } else if (mash === 2) {
              // 집중이 차면 강타로 태웁니다 — 안 차면 평타로 채웁니다.
              if ((G.focusInfo?.().focus ?? 0) >= 1) {
                G.press('Mouse2')
                G.release('Mouse2')
              } else {
                G.press('Mouse0')
                G.release('Mouse0')
              }
            }
            const inWindup = bi.attacking === true && bi.attackPhase === 0
            if (inWindup && !winding) {
              lastId = bi.attackId ?? null
              if (lastId) {
                note(lastId, 'commits')
                seen[lastId].sumDist += dist
              }
            }
            /** 예고 → 판정으로 넘어간 순간을 «닿음»으로 셉니다. */
            if (winding && bi.attacking === true && bi.attackPhase === 1 && lastId) {
              note(lastId, 'swings')
              lastId = null
            }
            winding = inWindup
            const total = Object.values(seen).reduce((a, v) => a + v.commits, 0)
            if (total >= want) break
            await window.__t.runFor(0.05)
          }
          G.damageEntity(b, 999999)
          return { seen }
        },
        [band, hitting, WANT],
      )
      if (r.error) {
        console.log(`  💥 ${r.error}`)
        continue
      }
      rows.push({ band, hitting, seen: r.seen })
      const tot = Object.values(r.seen).reduce(
        (a, v) => ({ c: a.c + v.commits, s: a.s + v.swings }),
        { c: 0, s: 0 },
      )
      console.log(
        `  ${band.toFixed(1)}m · ${hitting ? '계속 때림' : '가만히  '} — ` +
          `예고 ${String(tot.c).padStart(3)} → 판정 ${String(tot.s).padStart(3)}` +
          (tot.c > 0 ? ` (끊김 ${Math.round(((tot.c - tot.s) / tot.c) * 100)}%)` : '') +
          '  ' +
          Object.entries(r.seen)
            .map(([id, v]) => `${id.replace('boss_', '')} ${v.commits}→${v.swings}`)
            .join(' · '),
      )
    }
  }

  /**
   * ⚠️ **분모부터 봅니다.** 이 계기를 만든 이유가 «분모가 성하지 않은
   *    비율» 때문이었으므로, 표본이 안 모였으면 아래 판정을 아예 안 합니다.
   */
  const totalCommits = rows.reduce(
    (a, r) => a + Object.values(r.seen).reduce((x, v) => x + v.commits, 0),
    0,
  )
  check(
    totalCommits >= BANDS.length * 3 * 8,
    '🎨 예고 표본이 모였다 (판정의 게이트)',
    `${totalCommits}개 — 조합당 평균 ${(totalCommits / (BANDS.length * 3)).toFixed(0)}개`,
  )

  if (totalCommits >= BANDS.length * 3 * 8) {
    /**
     * 이 계기가 답하려는 질문 하나: **거리가 예고의 생사를 정하는가.**
     * 「계속 때림」 갈래에서 가장 가까운 띠와 가장 먼 띠의 끊김을 견줍니다.
     */
    const mashed = rows.filter((r) => r.hitting === 1)
    const cutOf = (r) => {
      const t = Object.values(r.seen).reduce(
        (a, v) => ({ c: a.c + v.commits, s: a.s + v.swings }),
        { c: 0, s: 0 },
      )
      return t.c > 0 ? (t.c - t.s) / t.c : null
    }
    const near = cutOf(mashed[0])
    const far = cutOf(mashed[mashed.length - 1])
    check(
      near !== null && far !== null,
      '📏 가까운 띠와 먼 띠 둘 다 표본이 있다',
      `${BANDS[0]}m ${near === null ? '없음' : (near * 100).toFixed(0) + '%'} · ` +
        `${BANDS[BANDS.length - 1]}m ${far === null ? '없음' : (far * 100).toFixed(0) + '%'}`,
    )
    if (near !== null && far !== null) {
      console.log(
        `\n  📏 **거리가 예고의 생사를 정하는가** — ` +
          `가까이(${BANDS[0]}m) 끊김 ${(near * 100).toFixed(0)}% vs ` +
          `멀리(${BANDS[BANDS.length - 1]}m) ${(far * 100).toFixed(0)}%` +
          `\n     ${
            near - far >= 0.25
              ? '→ **그렇습니다.** 붙어서 건 예고가 확실히 더 죽습니다.'
              : far - near >= 0.25
                ? '→ **반대입니다.** 멀리서 건 쪽이 더 죽습니다 — 다시 봐야 합니다.'
                : '→ **아닙니다.** 거리로는 안 갈립니다. 원인은 다른 곳입니다.'
          }`,
      )
    }
  }

  await browser.close()
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  dev.kill()
}
