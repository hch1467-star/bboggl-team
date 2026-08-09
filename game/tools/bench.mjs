/**
 * 여러 판을 돌려 **중앙값과 범위**를 냅니다 — `npm run bench [판수]`
 *
 * ── 왜 이게 필요한가 ────────────────────────────────────────────────
 * 지금까지 밸런스 손잡이를 **한두 판** 보고 돌렸습니다. 그런데 같은 설정에서
 * 나온 두 판이 이렇습니다:
 *
 *     보스전 37.1초 · 사망 0        보스전 50.3초 · 사망 3
 *     존 클리어 166.3초             존 클리어 352.7초
 *
 * 같은 코드, 같은 지도, 같은 봇입니다. 무기를 강화했는지, 집중이 언제 찼는지,
 * 어느 조합이 먼저 깨어났는지에 따라 **두 배씩** 달라집니다.
 *
 * 그 위에서 "3단계가 7.2초가 되었으니 좋다"고 말하는 것은 **측정이 아니라
 * 도박**입니다. 방금 그렇게 할 뻔했고, 그래서 이 도구를 먼저 만듭니다.
 *
 * ── 왜 평균이 아니라 중앙값인가 ─────────────────────────────────────
 * 봇은 가끔 완전히 망합니다(보스에게 세 번 죽어 존이 352초). 그 한 판이
 * 평균을 통째로 끌고 갑니다. 중앙값은 "보통 어떤가"를 말하고, 범위는
 * "얼마나 흔들리는가"를 말합니다. **둘 다 있어야** 값을 만질지 말지가
 * 정해집니다 — 범위가 겹치면 그 변경은 아직 증명되지 않은 것입니다.
 *
 * ── 왜 한 판씩 차례로 도는가 ────────────────────────────────────────
 * 봇의 판단 루프는 **벽시계**에 묶여 있습니다. 두 판을 동시에 돌리면 CPU를
 * 나눠 쓰느라 봇이 더 못 싸우고, 그게 밸런스 변화로 잘못 기록됩니다.
 * (실제로 그렇게 두 판을 날린 적이 있습니다.)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const RUNS = Math.max(2, Math.min(9, Number(process.argv[2]) || 3))
const dir = mkdtempSync(path.join(tmpdir(), 'bench-'))

/** 중앙값. 짝수 개면 가운데 둘의 평균. */
function median(xs) {
  const v = xs.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!v.length) return 0
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

function fmt(xs, digits = 1) {
  const v = xs.filter((n) => Number.isFinite(n))
  if (!v.length) return '—'
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const m = median(v)
  const d = (n) => n.toFixed(digits)
  // 범위가 없으면 굳이 괄호를 붙이지 않습니다 — 읽는 눈을 아낍니다.
  return lo === hi ? d(m) : `${d(m)}  (${d(lo)}~${d(hi)})`
}

const WEAPON = process.env.PLAY_WEAPON
console.log(
  `\n📊 ${RUNS}판 벤치 — 중앙값 (최소~최대)` +
    (WEAPON ? ` · 무기 고정 ${WEAPON}번` : '') +
    '\n',
)

const logs = []
for (let i = 0; i < RUNS; i++) {
  const out = path.join(dir, `run${i}.json`)
  process.stdout.write(`  ${i + 1}/${RUNS}판 도는 중… `)
  const t0 = Date.now()
  const r = spawnSync('node', ['tools/playthrough.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PLAY_JSON: out },
    stdio: ['ignore', 'ignore', 'inherit'],
    timeout: 15 * 60 * 1000,
  })
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  if (r.status !== 0 || !existsSync(out)) {
    console.log(`❌ 실패 (${secs}초)`)
    continue
  }
  const log = JSON.parse(readFileSync(out, 'utf8'))
  logs.push(log)
  console.log(
    `${log.clearedAt > 0 ? `★ ${log.clearedAt}초 클리어` : '클리어 못함'} · 사망 ${log.deaths} (${secs}초)`,
  )
}
rmSync(dir, { recursive: true, force: true })

if (logs.length < 2) {
  console.log('\n❌ 판이 2개 미만이라 집계할 수 없습니다\n')
  process.exit(1)
}

const pick = (fn) => logs.map(fn)
const cleared = logs.filter((l) => l.clearedAt > 0)
const boss = logs.filter((l) => l.boss?.fought)

console.log('\n  ── 진행 ──────────────────────────────')
console.log(`  존 클리어      ${cleared.length}/${logs.length}판`)
console.log(`  클리어 시간    ${fmt(cleared.map((l) => l.clearedAt))}초`)
console.log(`  사망           ${fmt(pick((l) => l.deaths), 1)}회`)
console.log(`  처치           ${fmt(pick((l) => l.kills), 0)}마리`)
console.log(`  받은 피해      ${fmt(pick((l) => l.damageTaken), 0)}`)
console.log(`  쓴 무기        ${[...new Set(pick((l) => l.weaponId))].join(', ')}`)
console.log(
  `  백어택         ${fmt(pick((l) => l.backHits ?? 0), 0)}회 / 총 타격 ${fmt(pick((l) => l.hitsDealt ?? 0), 0)}회` +
    ` (${fmt(pick((l) => ((l.backHits ?? 0) / Math.max(1, l.hitsDealt ?? 1)) * 100), 0)}%)`,
)

console.log('\n  ── 보스 ──────────────────────────────')
console.log(`  보스전         ${fmt(boss.map((l) => l.boss.engaged))}초`)
/**
 * 초기화(귀환)가 섞이면 "긴 보스전"과 "죽고 다시 걸어온 판"이 같은 숫자로
 * 보입니다. 몇 판에서 일어났는지 세어 함께 보여 줍니다.
 */
const resets = boss.filter((l) => (l.boss.resets ?? 0) > 0).length
if (resets) console.log(`  ⚠️ 초기화        ${resets}/${boss.length}판에서 발생`)
for (let i = 0; i < 3; i++) {
  const times = boss.map((l) => l.boss.phaseTime?.[i])
  const dps = boss.map((l) => (l.boss.phaseBands?.[i] ?? 0) / Math.max(0.1, l.boss.phaseTime?.[i] ?? 0))
  console.log(`  ${i + 1}단계         ${fmt(times)}초 · 실효 화력 ${fmt(dps)}/초`)
}
console.log(`  보스 붕괴      ${fmt(boss.map((l) => l.boss.breaks ?? 0), 1)}회`)
console.log(`  보스 처형      ${fmt(boss.map((l) => l.boss.finishers ?? 0), 1)}회`)
console.log(`  연계 예약/발동 ${fmt(boss.map((l) => l.boss.chainsArmed ?? 0), 1)}회 / ` +
  `${fmt(boss.map((l) => (l.bossSwings ?? []).reduce((a, b) => a + (b.chained ?? 0), 0)), 1)}회`)

console.log('\n  ── 두 리듬 (기둥 1) ───────────────────')
console.log(`  스킬 : 기본    ${fmt(pick((l) => (l.skillCasts ?? []).reduce((a, b) => a + b, 0)), 0)}회 : ` +
  `${fmt(pick((l) => l.lightSwings ?? 0), 0)}회`)
console.log(`  쓸 스킬 없음   ${fmt(pick((l) => l.noSkillPct), 0)}%`)
console.log(`  셋 이상 준비   ${fmt(pick((l) => l.manySkillPct), 0)}%`)
console.log(`  회피 못 낼 때  ${fmt(pick((l) => l.lowStaminaRatio), 0)}%`)

console.log('\n  ── 배움과 성장 ────────────────────────')
console.log(`  🟢 초록 예고   ${fmt(pick((l) => l.greenEvents ?? 0), 0)}회 · 실제 반격 ${fmt(pick((l) => l.counters), 0)}회`)
console.log(`  보물           ${fmt(pick((l) => Number(String(l.treasures).split('/')[0])), 0)} / ` +
  `${logs[0].treasures?.split('/')[1] ?? '?'}`)
console.log(`  무기 강화      ${fmt(pick((l) => l.weaponUps ?? 0), 1)}회`)
/**
 * 안 주운 보물마다 **가장 가까이 갔던 거리**를 모읍니다.
 * 예산(40m)보다 크면 "못 간 것", 작으면 "안 간 것" — 처방이 다릅니다.
 */
{
  const bySpot = new Map()
  for (const l of logs) {
    for (const t of l.untakenTreasures ?? []) {
      const k = `(${t.x}, ${t.z})`
      if (!bySpot.has(k)) bySpot.set(k, [])
      bySpot.get(k).push(t.best)
    }
  }
  if (bySpot.size) {
    console.log('  못 주운 보물   (가장 가까이 간 거리 — 예산 40m)')
    for (const [k, ds] of [...bySpot.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const seen = ds.filter((d) => d >= 0)
      console.log(
        `    ${k.padEnd(12)} ${ds.length}/${logs.length}판에서 못 주움 · ` +
          (seen.length ? `${fmt(seen, 0)}m` : '경로 자체를 못 찾음'),
      )
    }
  }
}
/**
 * **살 수 있게 된 때**와 **소비처에 마지막으로 닿을 수 있었던 때**.
 * 앞이 뒤보다 늦으면 돈이 모자란 게 아니라 **너무 늦게 모인** 것입니다.
 */
const afford = pick((l) => l.affordableAt).filter((n) => n >= 0)
console.log(
  `  살 수 있게 된 때  ${afford.length ? fmt(afford) : '한 번도 없음'}초` +
    ` · 소비처에 닿을 수 있던 마지막 때 ${fmt(pick((l) => l.lastSpendChanceAt))}초`,
)
const tooLate = logs.filter(
  (l) => l.affordableAt >= 0 && l.lastSpendChanceAt >= 0 && l.affordableAt > l.lastSpendChanceAt,
).length
console.log(`  → 늦게 모인 판    ${tooLate}/${logs.length}판`)
console.log(`  남은 불티      ${fmt(pick((l) => l.embers ?? 0), 0)}`)

console.log('\n  ── 흐름 ──────────────────────────────')
console.log(`  교전 사이 빈 시간 평균 ${fmt(pick((l) => l.gapAvg))}초 · 최장 ${fmt(pick((l) => l.gapMax))}초`)
/**
 * 8초 이상 빈 구간을 **길 걷기**와 **심부름**으로 갈라 셉니다.
 * 앞은 지도가 준 시간(길면 설계 문제), 뒤는 플레이어가 고른 시간
 * (길어도 문제 아님 — 오히려 곁길이 살아 있다는 뜻).
 */
{
  const walk = []
  const errand = []
  for (const l of logs) {
    const gs = l.longGaps ?? []
    walk.push(gs.filter((g) => !g.errand).length)
    errand.push(gs.filter((g) => g.errand).length)
  }
  console.log(`  8초 이상 — 길 걷기 ${fmt(walk, 1)}회 · 심부름 ${fmt(errand, 1)}회`)
}
/**
 * ── 긴 빈 시간이 **어디서** 생기는가 ────────────────────────────────
 *
 * 곁길 보물을 주 동선 쪽으로 옮긴 뒤 최장 빈 시간이 10.4 → 15.6초로
 * 늘었습니다. "탐험을 늘렸으니 당연하다"로 넘길 수도 있지만, 그러면
 * **흐름이 어디서 끊기는지** 영영 모릅니다.
 *
 * 구간(어디→어디)과 그때 무엇을 하고 있었는지를 판마다 모읍니다.
 * 같은 구간이 판마다 반복되면 그건 운이 아니라 **지도**입니다.
 */
{
  const byWhere = new Map()
  for (const l of logs) {
    for (const g of l.longGaps ?? []) {
      if (!byWhere.has(g.where)) byWhere.set(g.where, { secs: [], did: new Map(), errand: 0 })
      const e = byWhere.get(g.where)
      e.secs.push(g.secs)
      if (g.errand) e.errand++
      for (const part of String(g.did).split(' ')) {
        // "지름길이동 73%" 같은 조각 — 이름만 세어 무엇을 하며 걸었는지 봅니다.
        const name = part.replace(/\d+%$/, '')
        if (name) e.did.set(name, (e.did.get(name) ?? 0) + 1)
      }
    }
  }
  if (byWhere.size) {
    console.log('  긴 빈 구간 (8초 이상)')
    for (const [where, e] of [...byWhere.entries()].sort((a, b) => b[1].secs.length - a[1].secs.length)) {
      const top = [...e.did.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k)
      console.log(
        `    ${where.padEnd(26)} ${e.secs.length}회 · ${fmt(e.secs)}초` +
          (top.length ? ` · 주로 ${top.join('·')}` : '') +
          (e.errand > e.secs.length / 2 ? '  [심부름]' : '  [길 걷기]'),
      )
    }
  }
}
console.log('')
