/**
 * 무기 3종 비교 — `npm run weapons`
 *
 * ── 왜 이 프로브가 생겼는가 ──────────────────────────────────────
 * 무기가 셋인데, **한 판 내내 하나만 씁니다.** 자동 플레이도, 아마 사람도요.
 * 선택지가 셋이어도 답이 하나면 그건 선택이 아니라 장식입니다 —
 * 4색 예고에 대해 우리가 이미 세운 규칙("색만 다르고 대응이 같으면 색은
 * 장식")을 무기에도 그대로 적용해야 합니다.
 *
 * 그런데 "무기가 다른가"는 지금까지 **한 번도 재 본 적이 없습니다.**
 * arsenal.ts 에 숫자가 다르게 적혀 있으니 다를 것이라고 믿고 있었을 뿐입니다.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────
 * 소울류의 무기 다양성이 성립하는 조건은 "수치가 다르다"가 아니라
 * **"이기는 축이 다르다"** 입니다. 대검은 느리지만 무너뜨리고, 단검은
 * 약하지만 붙어 있을 수 있고, 롱소드는 무난합니다. 그래서 셋을 잽니다:
 *
 *   1) 초당 피해            — 누가 빨리 죽이는가
 *   2) 초당 강인도 피해     — 누가 빨리 무너뜨리는가
 *   3) 스태미나 지속력      — 누가 오래 붙어 있는가 (스태미나당 피해)
 *
 * 그리고 이렇게 요구합니다:
 *   · 어느 하나가 **모든 축에서** 1등이면 안 됩니다 (그러면 답이 하나)
 *   · 초당 피해 격차가 지나치면 안 됩니다 (다른 축이 위로가 안 됨)
 *
 * ⚠️ 무기 수치를 여기 베껴 적지 않습니다. `weaponTable()` 로 게임에서 읽고,
 *    실제 값은 **때려 보고** 잽니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5209
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
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })

  await page.evaluate(() => {
    window.__t = {
      runFor: async (seconds) => {
        const target = window.__game.state().elapsed + seconds
        const deadline = Date.now() + 180000
        while (window.__game.state().elapsed < target && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 8))
        }
      },
      /**
       * 무기 하나를 들고 **불사신 허수아비**를 정해진 시뮬레이션 시간만큼
       * 두들깁니다. 스태미나는 자연 회복만 받습니다 — 무기별 소모가
       * 다른 것이 지속력의 정체이기 때문입니다.
       *
       * 허수아비를 얼려 두는 이유: 도망가거나 반격하면 무기가 아니라
       * **AI를 재게 됩니다.** 강인도도 계속 회복되면 무너지므로,
       * 회복분까지 합쳐 "실제로 깎은 총량"을 누적해서 셉니다.
       */
      bench: async (slot, burstSeconds, totalSeconds) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.3)
        const p = G.state().player
        const e = G.spawnEnemyKind('grunt', p.x + 1.2, p.z)
        await window.__t.runFor(0.2)
        G.setHp(e, 1000000)
        G.freezeEnemies(true)
        G.press(`Digit${slot}`)
        G.release(`Digit${slot}`)
        await window.__t.runFor(0.5)

        const es0 = G.entityState(e)
        G.aimAtWorld(es0.x, es0.z)
        const startHp = G.entityState(e).hp
        const startHits = G.state().hitsDealt
        const t0 = G.state().elapsed
        /**
         * **어느 타가 몇 번 나갔는지**도 셉니다.
         *
         * 이론값(콤보 피해합 ÷ 콤보 시간)과 실측이 어긋날 때, 원인이
         * "무기가 약해서"인지 "콤보가 안 이어져서 1타만 반복해서"인지
         * 가르지 못하면 엉뚱한 곳을 고치게 됩니다.
         */
        let burstDealt = 0
        let poiseDealt = 0
        let lastPoise = G.enemyInfo(e).poise
        // ⚠️ 스태미나는 **게임이 센 누적값**을 씁니다.
        // 프레임 사이에 "크게 쓰고 조금 회복"이 겹치면 관측으로는 놓칩니다 —
        // 한 번에 크게 쓰는 무기일수록 효율이 실제보다 좋아 보였습니다.
        const stamStart = G.runStats().staminaSpent
        const critStart = G.state().critHits
        let breaks = 0
        let wasBroken = false

        while (G.state().elapsed - t0 < totalSeconds) {
          // 스태미나가 가득인 동안의 **폭발력**과, 바닥난 뒤의 **지속력**은
          // 완전히 다른 능력입니다. 하나로 뭉치면 둘 다 안 보입니다.
          if (burstDealt === 0 && G.state().elapsed - t0 >= burstSeconds) {
            burstDealt = startHp - G.entityState(e).hp
          }
          const info = G.enemyInfo(e)
          if (!info) break
          // 강인도는 회복도 하고 무너지면 가득 찹니다 — **줄어든 만큼만** 더합니다.
          if (info.poise < lastPoise) poiseDealt += lastPoise - info.poise
          lastPoise = info.poise
          if (info.broken && !wasBroken) breaks++
          wasBroken = info.broken
          // 위치가 밀릴 수 있으므로 매번 붙여 세웁니다 — 사거리 차이가 아니라
          // **때렸을 때의 성능**을 재는 자리입니다.
          const es = G.entityState(e)
          G.teleportPlayer(es.x - 1.2, es.z)
          G.aimAtWorld(es.x, es.z)
          G.press('Mouse0')
          G.release('Mouse0')
          await new Promise((r) => setTimeout(r, 8))
        }
        const elapsed = G.state().elapsed - t0
        const dealt = startHp - G.entityState(e).hp
        const staminaUsed = G.runStats().staminaSpent - stamStart
        const crits = G.state().critHits - critStart
        G.freezeEnemies(false)
        const hits = G.state().hitsDealt - startHits
        return {
          hits,
          avgHit: Number((dealt / Math.max(1, hits)).toFixed(1)),
          weapon: G.state().loadout.weapon,
          name: G.state().loadout.weaponName,
          seconds: Number(elapsed.toFixed(2)),
          /** 스태미나가 가득인 첫 구간의 초당 피해 = 폭발력 */
          burstDps: Number((burstDealt / burstSeconds).toFixed(1)),
          /** 그 뒤 구간의 초당 피해 = 스태미나 회복에 묶인 지속력 */
          sustainDps: Number(
            ((dealt - burstDealt) / Math.max(0.1, elapsed - burstSeconds)).toFixed(1),
          ),
          dps: Number((dealt / elapsed).toFixed(1)),
          poisePerSec: Number((poiseDealt / elapsed).toFixed(1)),
          // 지속력 = 스태미나 1당 피해. 소모가 적고 세면 오래 붙어 있습니다.
          perStamina: Number((dealt / Math.max(1, staminaUsed)).toFixed(2)),
          staminaUsed: Math.round(staminaUsed),
          crits,
          breaks,
        }
      },
    }
  })

  console.log('\n⚔️ 무기 3종 비교\n')

  const table = await page.evaluate(() => window.__game.weaponTable())
  console.log('  [제원 — 게임 데이터에서 읽음]')
  for (const w of table) {
    console.log(
      `    ${w.name.padEnd(5)} ${w.comboLength}타 · 콤보 ${w.comboSeconds}초 · 피해합 ${w.comboDamage} · ` +
        `스태미나합 ${w.comboStamina} · 사거리 ${w.maxRange} · 이동 ${w.moveSpeedScale}배`,
    )
  }
  console.log('')

  const results = []
  for (let slot = 1; slot <= table.length; slot++) {
    const r = await page.evaluate((s) => window.__t.bench(s, 3, 16), slot)
    results.push(r)
  }

  console.log('  [실측 — 불사신 허수아비를 12시뮬초 두들김 (앞 3초 = 폭발력)]')
  for (const r of results) {
    console.log(
      `    ${r.name.padEnd(5)} 폭발력 ${String(r.burstDps).padStart(5)} · 지속력 ${String(r.sustainDps).padStart(5)} · ` +
        `초당 강인도 ${String(r.poisePerSec).padStart(5)} · 무너뜨림 ${r.breaks}회\n` +
        `          전체 초당 ${r.dps} · 타격 ${r.hits}회(치명 ${r.crits}) · 한 대 평균 ${r.avgHit} · 스태미나 ${r.staminaUsed} 소모 · 스태미나당 ${r.perStamina}`,
    )
  }
  console.log('')

  check(results.length === table.length, '무기 셋을 전부 쟀다', `${results.length}종`)
  check(
    results.every((r) => r.dps > 0),
    '무기 셋 모두 실제로 피해를 준다',
  )

  /**
   * ---- 1. 이기는 축이 서로 다른가 ----
   *
   * 이게 이 프로브의 전부입니다. 하나가 세 축을 다 가져가면
   * 나머지 둘은 **고를 이유가 없는 선택지**입니다.
   */
  const bestBurst = results.reduce((a, b) => (a.burstDps >= b.burstDps ? a : b))
  const bestPoise = results.reduce((a, b) => (a.poisePerSec >= b.poisePerSec ? a : b))
  const bestSustain = results.reduce((a, b) => (a.sustainDps >= b.sustainDps ? a : b))
  const winners = new Set([bestBurst.weapon, bestPoise.weapon, bestSustain.weapon])
  check(
    winners.size >= 2,
    '이기는 축이 무기마다 다르다 (하나가 전부 1등이 아니다)',
    `폭발력 ${bestBurst.name} · 강인도 ${bestPoise.name} · 지속력 ${bestSustain.name}`,
  )

  /**
   * ---- 1.5 강인도가 무기마다 실제로 다른가 ----
   *
   * 처음 쟀을 때 셋 다 4.7~4.9였습니다. *"대검은 무너뜨리는 무기"* 라는 말이
   * 어디에도 없는 상태였습니다. 성격이 숫자로 존재해야 말이 사실이 됩니다.
   */
  const poiseMaxV = Math.max(...results.map((r) => r.poisePerSec))
  const poiseMinV = Math.min(...results.map((r) => r.poisePerSec))
  check(
    poiseMaxV / Math.max(0.01, poiseMinV) >= 1.8,
    '무너뜨리는 힘이 무기마다 확실히 다르다 (1.8배 이상)',
    results.map((r) => `${r.name} ${r.poisePerSec}`).join(' · '),
  )

  /**
   * ---- 1.6 만능형은 **어느 축에서도 꼴찌가 아니다** ----
   *
   * 롱소드의 정체성은 "1등이 없다"가 아니라 "약점이 없다"입니다.
   * 모든 축에서 꼴찌면 그건 균형형이 아니라 그냥 열등한 무기입니다.
   */
  const allRound = results.find((r) => r.weapon === 'longsword')
  if (allRound) {
    const lastIn = (key) => results.every((r) => r[key] >= allRound[key])
    check(
      !(lastIn('burstDps') && lastIn('sustainDps')) && !lastIn('poisePerSec'),
      '균형형(롱소드)이 모든 축에서 꼴찌는 아니다',
      `폭발력 ${allRound.burstDps} · 지속력 ${allRound.sustainDps} · 강인도 ${allRound.poisePerSec}`,
    )
  }

  /**
   * ---- 2. 피해 격차가 다른 축으로 감당될 만한가 ----
   *
   * 축이 달라도 초당 피해가 두 배 차이 나면, 느린 무기는 "취향"이 아니라
   * **손해**가 됩니다. 소울류에서 대검이 성립하는 이유는 느린 대신
   * 한 방과 무너뜨리는 힘이 확실히 크기 때문입니다.
   */
  /**
   * ---- 2. 피해 격차는 **스태미나당**으로 봅니다 ----
   *
   * ⚠️ 처음엔 "전체 초당 피해"로 쟀습니다. 그 숫자를 믿고 밸런스를 만질
   * 뻔했는데, 아래 달성률을 같이 재 보고 멈췄습니다.
   *
   * 이 프로브는 8ms마다 좌클릭을 넣습니다. 그런데 이 컨테이너는 프레임이
   * 초당 10회 안팎이라, **콤보 창이 짧은 무기일수록 이어치기를 놓칩니다.**
   * 즉 초당 피해는 무기의 성능이 아니라 **계측기의 손가락 속도**를 섞어
   * 재고 있었습니다. 쌍단검(콤보 창 0.36초)이 특히 손해를 봅니다.
   *
   * 스태미나당 피해는 그 왜곡을 받지 않습니다 — 몇 번 때렸든, 쓴 만큼
   * 나눈 값이기 때문입니다. 그래서 밸런스 판단은 이쪽으로 합니다.
   */
  const effMax = Math.max(...results.map((r) => r.perStamina))
  const effMin = Math.min(...results.map((r) => r.perStamina))
  check(
    effMax / effMin <= 1.6,
    '스태미나당 피해 격차가 1.6배 이내다 (효율 꼴찌 무기가 없게)',
    results.map((r) => `${r.name} ${r.perStamina}`).join(' · '),
  )

  /**
   * ---- 2.5 이 실행에서 초당 피해를 믿어도 되는가 ----
   *
   * 무기마다 "이론상 초당 몇 타"가 정해져 있습니다(콤보 길이 ÷ 콤보 시간).
   * 실제 타격 수가 거기에 얼마나 근접했는지를 **달성률**로 봅니다.
   * 무기 간 달성률이 크게 벌어지면, 그 실행의 초당 피해 비교는 무기가 아니라
   * 입력 주기를 재고 있는 것입니다. **계측기가 스스로 그 사실을 말하게** 합니다.
   */
  const rates = results.map((r) => {
    const w = table.find((t) => t.id === r.weapon)
    const ideal = (w.comboLength / w.comboSeconds) * r.seconds
    return { name: r.name, rate: r.hits / ideal }
  })
  const rateMin = Math.min(...rates.map((r) => r.rate))
  const rateMax = Math.max(...rates.map((r) => r.rate))
  console.log(
    `  [달성률] 이론상 타격 수 대비 — ` +
      rates.map((r) => `${r.name} ${Math.round(r.rate * 100)}%`).join(' · ') +
      (rateMax / rateMin > 1.4
        ? '\n           ⚠️ 격차가 큽니다 — 이 실행의 **초당 피해 비교는 신뢰하지 마세요**(입력 주기 탓).'
        : ''),
  )
  console.log('')
  check(
    rateMin > 0.3,
    '어느 무기도 이론 대비 30% 밑으로 떨어지지 않았다 (계측이 성립했다)',
    rates.map((r) => `${r.name} ${Math.round(r.rate * 100)}%`).join(' · '),
  )

  /**
   * ---- 3. 제원이 실제로 다른가 ----
   * 콤보 길이·사거리·이동 배율이 같으면 손에 잡히는 차이가 없습니다.
   */
  check(
    new Set(table.map((w) => w.comboLength)).size >= 2,
    '콤보 길이가 무기마다 다르다',
    table.map((w) => `${w.name} ${w.comboLength}타`).join(' · '),
  )
  check(
    Math.max(...table.map((w) => w.maxRange)) - Math.min(...table.map((w) => w.maxRange)) >= 0.5,
    '사거리가 눈에 띄게 다르다 (0.5m 이상)',
    table.map((w) => `${w.name} ${w.maxRange}m`).join(' · '),
  )
  check(
    Math.max(...table.map((w) => w.moveSpeedScale)) -
      Math.min(...table.map((w) => w.moveSpeedScale)) >=
      0.15,
    '들고 다닐 때의 이동 속도가 다르다',
    table.map((w) => `${w.name} ${w.moveSpeedScale}배`).join(' · '),
  )
  check(
    new Set(table.map((w) => w.poiseScale)).size === table.length,
    '무기마다 강인도 성격이 데이터에 따로 적혀 있다',
    table.map((w) => `${w.name} ×${w.poiseScale}`).join(' · '),
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
