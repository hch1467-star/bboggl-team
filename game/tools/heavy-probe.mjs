/**
 * ── 🔨 **「강타는 왜 붕괴 장부에 안 나오는가」를 가르는 계기** ──────────
 *
 * ── 왜 만들었는가 ──────────────────────────────────────────────────
 * 벤치의 🏅 칸이 이렇게 나왔습니다 — 붕괴 **112회 중 강타는 1회**.
 * 그런데 `POISE`/`FOCUS` 를 보면 강인도를 끊으라고 몰아준 것이 셋인데
 * 그중 둘이 강타입니다(강타 ×2.2, 예고중 ×2.5, 반격). 설계가 가장
 * 크게 밀어준 도구가 장부에 안 보이면, 원인은 셋 중 하나입니다:
 *
 *   ① **게임의 성질**  — 강타가 실제로 강인도를 못 끊는다
 *   ② **봇의 손버릇**  — 강타를 낼 기회 자체가 거의 없다
 *   ③ **장부의 결함**  — 강타가 깎아 놓고 마지막 한 대를 평타가 친다
 *
 * 셋은 **처방이 전부 다릅니다.** ①이면 배수를 올려야 하고, ②면 봇을
 * 고쳐야 하고, ③이면 게임은 멀쩡하고 **제가 잘못 읽은 것**입니다.
 * 이번 세션에만 이 함정에 세 번 빠졌으므로(예고 길이 · 붙는 거리 ·
 * 연계) 이번에는 **재기 전에 갈라 둡니다.**
 *
 * ── 어떻게 가르는가 ────────────────────────────────────────────────
 * ②를 없애기 위해 **손을 직접 쥡니다.** 봇의 판단(`playthrough.mjs`)을
 * 통째로 빼고, 정해진 손버릇만 반복시킵니다:
 *
 *      · 평타만      — 끊는 힘을 일부러 눌러 둔 쪽(×0.35)
 *      · 강타섞기    — 집중이 1점이라도 있으면 태우는 쪽(×2.2)
 *      · 예고중노림  — 적이 예고 중일 때만 치는 쪽(×2.5)
 *
 * ③을 가르기 위해 **두 장부를 나란히** 냅니다:
 *
 *      · 「이름이 남은 것」 = 마지막 한 대(`breakBy`)
 *      · 「일한 몫」       = 깎은 강인도 누적(`poiseWork`)
 *
 * 100의 피해를 준 뒤 마지막 1 틱에게 처치를 돌리면 안 되듯, 강인도도
 * **누적**입니다. 두 칸이 크게 어긋나면 그것이 곧 ③의 증거입니다.
 *
 * ①을 가르기 위해 **강인도 그릇이 다른 셋**에게 같은 손을 쥐여 줍니다.
 * 강타 한 대는 대략 54(=0.62×40×2.2)를 깎습니다:
 *
 *      잡몹 30   — 한 대로 넘칩니다  → 강타가 이름을 못 남기면 ①입니다
 *      정예 85   — 두 대가 필요합니다
 *      보스 105  — 두 대 + α        → 여기선 ③이 나오는 게 정상입니다
 *
 * 즉 **같은 손인데 그릇만 바꿔서** 답이 달라지는지를 봅니다. 안 달라지면
 * 원인은 그릇(=③)이 아니고, 달라지면 ③입니다.
 *
 * ⚠️ **붕괴할 때마다 상대를 새로 세웁니다.** `POISE.breakResistStep` 때문에
 *    같은 적은 끊길수록 단단해집니다(최대 3번까지 +0.45씩). 한 마리를
 *    계속 두들기면 뒤로 갈수록 손 사이의 차이가 눌려서, **손이 같아
 *    보이는 이유가 손 때문인지 저항 때문인지** 못 가립니다.
 *
 * 실행: node tools/heavy-probe.mjs   (npm run heavy)
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const PORT = 5209

/**
 * 잴 상대 — **강인도 그릇 크기 순서**로 고릅니다. 강타 한 대(≈54)를
 * 기준으로 «넘침 / 두 대 / 두 대+α» 가 되게 셋을 골랐습니다.
 */
const TARGETS = [
  { id: 'grunt', label: '잡몹  ' },
  { id: 'elite', label: '정예  ' },
  { id: 'boss', label: '보스  ' },
]
/**
 * 손 세 갈래. 숫자가 아니라 이름으로 다룹니다 — 출력에서 바로 읽히게.
 *
 * ⚠️ **「예고중노림」은 평타만 씁니다 — 강타를 섞으면 안 됩니다.**
 *    첫 판에서 이 손에도 강타를 태웠다가 재려던 것을 못 쟀습니다.
 *    `applyPoise` 의 배수는 **겹치지 않고 하나만** 고르는데 그 순서가
 *    `heavyBlow` → `winding` 입니다. 즉 예고 중에 낸 강타는 ×2.5 가
 *    아니라 **×2.2** 를 받습니다. 그래서 그 손의 일한 몫이 «강타 57%» 로
 *    나왔고, 저는 ×2.5 를 재고 있다고 믿으면서 실은 ×2.2 를 다시
 *    재고 있었습니다 — **한 손에 두 지렛대를 쥐여 준 것**입니다.
 */
const HANDS = ['평타만  ', '강타섞기', '간파노림  ']
/** 한 조합에서 볼 붕괴 수. 못 채우면 시간 제한으로 끊고 **분모를 밝힙니다.** */
const WANT_BREAKS = 8
/** 한 조합의 시간 상한(시뮬 초). 안 끊기는 손도 있으므로 반드시 필요합니다. */
const CAP_SECONDS = 70

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** 비율을 «분모가 성한지»부터 보고 냅니다 — 0이면 숫자를 안 만듭니다. */
function share(part, whole) {
  return whole > 0 ? part / whole : null
}
function pct(v) {
  return v === null ? '—' : `${Math.round(v * 100)}%`
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
  /** 🎓 1단계 학습 잠금을 끕니다 — 보스 체력이 경계에 붙들리면 표본이 굽습니다. */
  await page.evaluate(() => window.__game.setPhaseTeaching?.(false))

  console.log(
    `\n🔨 강인도를 끊는 것은 무엇인가 — 상대 ${TARGETS.length}종 × 손 ${HANDS.length}갈래\n` +
      `   («이름이 남은 것» = 마지막 한 대 · «일한 몫» = 깎은 누적)\n`,
  )

  const rows = []
  for (const tgt of TARGETS) {
    for (let hand = 0; hand < HANDS.length; hand++) {
      const r = await page.evaluate(
        async ([kindId, hand, wantBreaks, capSeconds]) => {
          const G = window.__game
          const now = () => G.state().elapsed
          const before = G.runStats()
          const baseBreaks = { ...(before.breakBy ?? {}) }
          const baseWork = { ...(before.poiseWork ?? {}) }
          /** 🔧 «무엇 덕분에 깎였나» — 이게 없으면 ×2.5 를 직접 볼 수가 없습니다. */
          const baseLever = { ...(before.poiseLever ?? {}) }
          /** 🔢 대수 — 「배수가 커서 커 보이는 것」과 「자주 걸려서 큰 것」을 가릅니다. */
          const baseHits = { ...(before.poiseHits ?? {}) }
          /** 🎯 강타가 닿은 자리 — 「간파 0회」의 원인을 가르는 세 칸. */
          const baseMik = { ...(before.mikiri ?? {}) }

          /**
           * ⚠️ **실험장을 먼저 비웁니다.**
           *
           * 첫 판의 「잡몹」 줄에 **오사 27~38%** 가 찍혔습니다. 오사는
           * «적이 적을 때린 것»인데, 1:1 을 재는 계기에서 나올 수가 없는
           * 값입니다 — 실험장에 원래 있던 적들이 남아 있었습니다.
           *
           * 장부(`breakBy`/`poiseWork`)는 **판 전체의 누계**라 대상별로
           * 갈라지지 않습니다. 그러니 다른 적이 한 마리라도 살아 있으면
           * 그 줄은 «이 상대에게 잰 값»이 아닙니다. 이름표만 붙어 있고
           * 안에는 다른 것이 섞인 셈입니다.
           */
          G.clearEnemies()
          await window.__t.runFor(0.2)

          /** 상대를 하나 세우고 그 곁에 붙습니다. */
          let foe = G.spawnEnemyKind(kindId, 8, 0)
          if (foe < 0) return { error: `${kindId} 을(를) 못 세웠습니다` }
          await window.__t.runFor(0.3)

          let breaks = 0
          let respawns = 0
          let windupSwings = 0
          let heavySwings = 0
          const t0 = now()
          let guard = 0
          while (breaks < wantBreaks && now() - t0 < capSeconds && guard++ < 200000) {
            const fi = G.enemyInfo(foe)
            if (!fi || fi.hp <= 0) {
              foe = G.spawnEnemyKind(kindId, 8, 0)
              respawns++
              await window.__t.runFor(0.3)
              continue
            }
            /**
             * ⚠️ **거리를 매 프레임 다시 맞춥니다.** 밀리거나 돌진하면
             *    «이 거리에서 잰 값»이 아니게 됩니다(telegraph-probe 와 같은 이유).
             */
            G.teleportPlayer(fi.x - 1.8, fi.z)
            G.aimAtWorld(fi.x, fi.z)
            /** 둘 다 안 죽게 채웁니다 — 재려는 것은 강인도지 승패가 아닙니다. */
            G.setHp(G.playerEntity(), 100)
            G.setStamina(100)
            G.setHp(foe, fi.max)

            /**
             * 🚩 **붕괴를 «사건»으로 잡습니다.** 게이지를 읽어 «0이 됐다»로
             *    치면 회복 중인 프레임을 두 번 셀 수 있습니다. 게임이 세는
             *    칸을 그대로 씁니다.
             */
            if (fi.broken === true) {
              breaks++
              /**
               * 새 상대로 갈아 세웁니다 — `breakResistStep` 이 쌓이면 뒤
               * 표본이 앞 표본과 다른 게임이 됩니다(파일 머리 주석).
               */
              G.damageEntity(foe, 999999)
              await window.__t.runFor(0.15)
              continue
            }

            const canHeavy = (G.focusInfo?.().focus ?? 0) >= 1
            if (hand === 0) {
              G.press('Mouse0')
              G.release('Mouse0')
            } else if (hand === 1) {
              if (canHeavy) {
                G.press('Mouse2')
                G.release('Mouse2')
                heavySwings++
              } else {
                G.press('Mouse0')
                G.release('Mouse0')
              }
            } else {
              /**
               * 🎯 **예고 중에만 칩니다.** `POISE.windupMultiplier` (×2.5) 가
               *    실제로 도는지 보는 손입니다. 예고가 아닐 때는 **아무것도
               *    안 합니다** — 집중을 벌려고 평타를 섞으면 이 손이 재려던
               *    것과 평타가 한 칸에 섞여서 다시 못 가릅니다.
               */
              /**
               * ── 🎯 **예고의 «시작»이 아니라 «창»을 겨눕니다** ──────────
               *
               * ⚠️ 처음엔 `fi.winding === true` 가 되는 **순간** 휘둘렀습니다.
               *    그건 예고의 **맨 앞**이고 간파 창은 **맨 뒤**입니다. 그래서
               *    이 손이 «읽는 손»이 아니라 **«가장 나쁜 손»** 이 됐습니다:
               *
               *      정예(예고 ≈1.4초) 31.7초 — 우연히 창에 걸림 ✅
               *      보스(예고 ≈1.9초) 70초   — **한 번도 못 걸림** ❌
               *
               *    그 상태에서 나온 「초당 붕괴 0.197 vs 0.203」을 저는
               *    *"창이 안 통한다"* 로 읽을 뻔했습니다. 실은 **손이 창을
               *    못 겨눈다**는 뜻이었습니다.
               *
               * ⚠️ **창을 프로브가 계산하지 않습니다.** `punishFraction ×
               *    windup` 을 베껴 적는 순간 그 곱셈이 두 벌이 됩니다 —
               *    `GUARD.poise` 를 560으로 만든 그 자리입니다. 게임이 답합니다.
               *
               * ⚠️ **여기서 강타를 태우면 안 됩니다.** 배수는 하나만 걸리고
               *    `heavyBlow` 가 앞서므로, 강타를 섞으면 이 손은 ×2.5 가
               *    아니라 ×2.2 를 재게 됩니다. 평타만 씁니다.
               */
              /**
               * ⚠️ **이 손은 «강타»를 넣어야 합니다.**
               *
               * 앞 판까지 이 손은 창에서 **평타**를 눌렀습니다. 그런데
               * 간파는 `spec.heavyBlow` 를 요구하므로, **이름값을 할 수가
               * 없는 손**이었습니다 — 「간파노림」이라 부르면서 간파를
               * 낼 수 없게 만들어 놓고 «간파가 0회» 라고 적었습니다.
               *
               * 창이 아닐 때는 평타로 **집중을 법니다** — 자원 없이는
               * 창이 열려도 못 태웁니다. 이것이 사람이 낼 수 있는 손입니다.
               */
              if (fi.punishOpen === true && canHeavy) {
                windupSwings++
                heavySwings++
                G.press('Mouse2')
                G.release('Mouse2')
              } else if (fi.punishOpen !== true) {
                G.press('Mouse0')
                G.release('Mouse0')
              }
            }
            await window.__t.runFor(0.05)
          }
          const elapsed = now() - t0
          if (foe >= 0) G.damageEntity(foe, 999999)

          const after = G.runStats()
          const delta = (now, base) => {
            const out = {}
            for (const [k, v] of Object.entries(now ?? {})) {
              const d = v - (base[k] ?? 0)
              if (d > 0.0001) out[k] = Number(d.toFixed(2))
            }
            return out
          }
          return {
            breaks,
            respawns,
            windupSwings,
            heavySwings,
            elapsed: Number(elapsed.toFixed(1)),
            by: delta(after.breakBy, baseBreaks),
            work: delta(after.poiseWork, baseWork),
            lever: delta(after.poiseLever, baseLever),
            hits: delta(after.poiseHits, baseHits),
            mikiri: delta(after.mikiri, baseMik),
          }
        },
        [tgt.id, hand, WANT_BREAKS, CAP_SECONDS],
      )
      if (r.error) {
        console.log(`  💥 ${r.error}`)
        continue
      }
      rows.push({ target: tgt.id, label: tgt.label, hand, ...r })

      const byTot = Object.values(r.by).reduce((a, v) => a + v, 0)
      const workTot = Object.values(r.work).reduce((a, v) => a + v, 0)
      const fmt = (o, tot) =>
        Object.entries(o)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${tot > 0 ? pct(v / tot) : v}`)
          .join(' · ') || '없음'
      console.log(
        `  ${tgt.label}· ${HANDS[hand]} — 붕괴 ${String(r.breaks).padStart(2)}회 / ${r.elapsed}초\n` +
          `            이름이 남은 것: ${fmt(r.by, byTot)}\n` +
          `            일한 몫(${Math.round(workTot)}): ${fmt(r.work, workTot)}\n` +
          `            지렛대(일한 몫): ${fmt(r.lever, Object.values(r.lever).reduce((a, v) => a + v, 0))}\n` +
          `            지렛대(대수)   : ${fmt(r.hits, Object.values(r.hits).reduce((a, v) => a + v, 0))}\n` +
          `            강타가 닿은 자리: ${fmt(r.mikiri, 0)}`,
      )
    }
  }

  console.log('')

  /**
   * ⚠️ **분모부터 봅니다.** 이 계기를 만든 이유가 «분모 1짜리 비율»이었으므로,
   *    표본이 안 모였으면 아래 판정을 아예 안 합니다.
   */
  const totalBreaks = rows.reduce((a, r) => a + r.breaks, 0)
  check(
    rows.length === TARGETS.length * HANDS.length,
    '🧾 조합이 하나도 안 빠졌다',
    `${rows.length} / ${TARGETS.length * HANDS.length}`,
  )
  check(totalBreaks >= TARGETS.length * HANDS.length * 2, '🔨 붕괴 표본이 모였다 (판정의 게이트)', `${totalBreaks}회`)

  const heavyRows = rows.filter((r) => r.hand === 1)
  const heavyCast = heavyRows.reduce((a, r) => a + r.heavySwings, 0)
  /**
   * ②(봇의 손버릇)를 여기서 끊습니다. 강타를 **한 번도 못 낸** 손으로
   * *"강타는 안 끊는다"* 를 말하면 그것이 정확히 지난번의 실수입니다.
   */
  check(heavyCast >= 10, '🥋 「강타섞기」 손이 강타를 실제로 냈다 (②를 배제하는 게이트)', `${heavyCast}번`)

  if (totalBreaks >= TARGETS.length * HANDS.length * 2 && heavyCast >= 10) {
    const sum = (list, pick) =>
      list.reduce((a, r) => {
        for (const [k, v] of Object.entries(pick(r))) a[k] = (a[k] ?? 0) + v
        return a
      }, {})
    const hb = sum(heavyRows, (r) => r.by)
    const hw = sum(heavyRows, (r) => r.work)
    const hbTot = Object.values(hb).reduce((a, v) => a + v, 0)
    const hwTot = Object.values(hw).reduce((a, v) => a + v, 0)
    const nameShare = share(hb['강타'] ?? 0, hbTot)
    const workShare = share(hw['강타'] ?? 0, hwTot)

    console.log(
      `  🔨 **강타 — 일한 몫 ${pct(workShare)} vs 이름이 남은 몫 ${pct(nameShare)}**` +
        ` (붕괴 ${hbTot}회 · 깎은 양 ${Math.round(hwTot)})`,
    )
    if (workShare !== null && nameShare !== null) {
      console.log(
        `     ${
          workShare >= 0.2 && nameShare <= 0.08
            ? '→ ③ **장부의 결함이었습니다.** 강타는 깎고 있는데 마지막 한 대를 평타가 칩니다.'
            : workShare < 0.1
              ? '→ ① 또는 ② **강타가 일 자체를 안 하고 있습니다.** 배수가 아니라 «낼 기회»부터 보세요.'
              : '→ 두 칸이 대체로 맞습니다. 강타는 일한 만큼 이름도 남기고 있습니다.'
        }`,
      )
    }

    /**
     * ①을 그릇 크기로 가릅니다. 강타 한 대는 잡몹의 강인도를 **넘깁니다**.
     * 그런데도 잡몹에서 강타가 이름을 못 남기면 그것은 그릇 탓이 아닙니다.
     */
    const grunt = heavyRows.find((r) => r.target === 'grunt')
    const boss = heavyRows.find((r) => r.target === 'boss')
    if (grunt && boss) {
      const gTot = Object.values(grunt.by).reduce((a, v) => a + v, 0)
      const bTot = Object.values(boss.by).reduce((a, v) => a + v, 0)
      const g = share(grunt.by['강타'] ?? 0, gTot)
      const b = share(boss.by['강타'] ?? 0, bTot)
      check(gTot > 0 && bTot > 0, '🥣 그릇 비교의 분모가 둘 다 있다', `잡몹 ${gTot}회 · 보스 ${bTot}회`)
      if (gTot > 0 && bTot > 0) {
        console.log(
          `  🥣 **그릇을 바꾸면 답이 달라지는가** — 잡몹(30) ${pct(g)} vs 보스(105) ${pct(b)}\n` +
            `     ${
              g - b >= 0.25
                ? '→ **그렇습니다.** 한 대로 넘치는 그릇에서는 강타가 이름을 남깁니다 — ③의 증거입니다.'
                : g <= 0.08
                  ? '→ **아닙니다.** 한 대로 넘치는 그릇에서도 못 남깁니다 — 그릇 탓이 아닙니다.'
                  : '→ 뚜렷하지 않습니다. 표본을 더 모아야 합니다.'
            }`,
        )
      }
    }

    /**
     * 마지막으로 «몰아준 셋» 중 남은 하나 — 예고 중 타격(×2.5) 이
     * 실제로 도는지 봅니다. 이 손은 **예고가 아닐 때 아무것도 안 하므로**,
     * 휘두른 횟수가 곧 분모입니다.
     */

    /**
     * ⚠️ **선언을 쓰는 자리보다 위에 둡니다.** 이 세션에만 «선언 전에 쓴»
     *    실수로 계기가 세 번 죽었습니다(그중 한 번은 **종료 코드 0으로**
     *    죽어서 초록처럼 보였습니다).
     */
    const windRows = rows.filter((r) => r.hand === 2)
    const lightRows = rows.filter((r) => r.hand === 0)
    const wSwings = windRows.reduce((a, r) => a + r.windupSwings, 0)
    const wBreaks = windRows.reduce((a, r) => a + r.breaks, 0)
    const lBreaks = lightRows.reduce((a, r) => a + r.breaks, 0)
    /**
     * ── 🎯 **「예고 중 타격」은 읽어서 얻는 것인가, 그냥 붙는 것인가** ─────
     *
     * 설계는 ×2.5 를 *"예고를 읽고 끼워 넣는 판단"* 에 대한 보상이라고
     * 적었습니다. 그렇다면 **아무 생각 없이 연타하는 손**에서는 이 지렛대가
     * 드물어야 합니다. 그래서 「평타만」 손의 **대수** 비율을 봅니다.
     *
     * ⚠️ **일한 몫이 아니라 대수로 봅니다.** 일한 몫은 배수(×2.5 vs ×0.35,
     *    7.14배)가 곱해진 값이라, 열 대 중 넉 대만 예고 중이어도 **81%** 로
     *    찍힙니다. 그 숫자로 «연타의 81%가 예고 중» 이라고 읽으면 정확히
     *    거꾸로입니다.
     */
    const lightHits = lightRows.reduce((a, r) => {
      for (const [k, v] of Object.entries(r.hits ?? {})) a[k] = (a[k] ?? 0) + v
      return a
    }, {})
    const lightHitTot = Object.values(lightHits).reduce((a, v) => a + v, 0)
    const freeShare = share(lightHits['예고중'] ?? 0, lightHitTot)
    check(lightHitTot >= 30, '🔢 「평타만」 손의 대수 표본이 모였다 (아래 판정의 게이트)', `${lightHitTot}대`)
    if (lightHitTot >= 30 && freeShare !== null) {
      console.log(
        `  🎯 **아무 생각 없이 연타할 때 예고 중에 들어간 대수** — ${pct(freeShare)} ` +
          `(${lightHits['예고중'] ?? 0} / ${lightHitTot}대)\n` +
          `     ${
            freeShare >= 0.3
              ? '→ ×2.5 는 **읽어서 얻는 것이 아닙니다.** 붙어서 치면 저절로 붙습니다 — ' +
                '설계가 «판단에 대한 보상»이라 부른 것이 실은 «연타에 붙는 보너스»입니다.'
              : '→ 연타로는 잘 안 걸립니다 — 읽어야 얻는 지렛대가 맞습니다.'
          }`,
      )
    }
    check(wSwings >= 10, '🎯 「간파노림」 손이 실제로 창에서 휘둘렀다 (분모)', `${wSwings}번`)
    if (wSwings >= 10) {
      const wSec = windRows.reduce((a, r) => a + r.elapsed, 0)
      const lSec = lightRows.reduce((a, r) => a + r.elapsed, 0)
      const wRate = wSec > 0 ? wBreaks / wSec : null
      const lRate = lSec > 0 ? lBreaks / lSec : null
      console.log(
        `  🎯 **예고 중 타격(×2.5)이 도는가** — 휘두름 ${wSwings}번당 붕괴 ${wBreaks}회` +
          (wRate !== null && lRate !== null
            ? `\n     초당 붕괴: 간파노림 ${wRate.toFixed(3)} vs 평타만 ${lRate.toFixed(3)}` +
              `\n     ${
                lRate > 0 && wRate >= lRate * 1.5
                  ? '→ **돕니다.** 훨씬 적게 휘두르고도 더 자주 끊습니다.'
                  : wRate === 0
                    ? '→ **안 돕니다.** 한 번도 못 끊었습니다 — 배수가 아니라 «맞출 수 있는가»부터 보세요.'
                    : '→ 뚜렷하지 않습니다. 기다리는 시간이 배수를 다 먹고 있습니다.'
              }`
            : ''),
      )
    }
  }

  await browser.close()
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  dev.kill()
}
