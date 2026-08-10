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

/**
 * ── 적 종류가 **존에서 제 일을 하는가** ────────────────────────────
 *
 * 배치했다고 일어나는 게 아닙니다. 죽기 전에 한 번도 못 휘두르는 적,
 * 예고만 띄우고 사라지는 적이 있으면 그 종류는 **있으나 마나**입니다.
 * 새 적을 넣을 때마다 눈금을 새로 만드는 대신 종류 전체를 한 줄로 봅니다.
 */
{
  const byFoe = new Map()
  for (const l of logs) {
    for (const f of l.foeSwings ?? []) {
      if (!byFoe.has(f.id))
        byFoe.set(f.id, {
          sw: [],
          com: [],
          hit: [],
          dead: [],
          live: [],
          pAtk: [],
          pStag: [],
          pCool: [],
          pChase: [],
          pReady: [],
        })
      byFoe.get(f.id).sw.push(f.swings)
      byFoe.get(f.id).com.push(f.commits ?? 0)
      /**
       * 백분율은 **판마다 먼저 낸 뒤** 그 값들의 중앙값을 봅니다.
       *
       * 처음엔 각 칸의 중앙값을 깨어 있던 시간의 중앙값으로 나눴는데,
       * 달려드는 자만 네 칸 합이 **74%** 로 나왔습니다(나머지는 100%).
       * 부분의 중앙값은 전체의 중앙값과 안 맞습니다 — 판마다 모양이
       * 다르면 어긋나고, 그 어긋남 자체가 "이 적은 판마다 딴판"이라는
       * 신호인데 합이 안 맞는 표로는 읽을 수가 없습니다.
       */
      const live = f.aggroT ?? 0
      if (live > 0.5) {
        byFoe.get(f.id).pAtk.push(((f.atkT ?? 0) / live) * 100)
        byFoe.get(f.id).pStag.push(((f.stagT ?? 0) / live) * 100)
        byFoe.get(f.id).pCool.push(((f.coolT ?? 0) / live) * 100)
        byFoe.get(f.id).pChase.push(((f.chaseT ?? 0) / live) * 100)
        byFoe.get(f.id).pReady.push(((f.readyT ?? 0) / live) * 100)
      }
      byFoe.get(f.id).hit.push(f.hits)
      byFoe.get(f.id).dead.push(f.deaths ?? 0)
      byFoe.get(f.id).live.push(f.aggroT ?? 0)
    }
  }
  if (byFoe.size) {
    console.log('\n  ── 적이 실제로 한 일 (판당) ───────────')
    for (const [id, v] of [...byFoe.entries()].sort((a, b) => median(b[1].sw) - median(a[1].sw))) {
      const sw = median(v.sw)
      const hit = median(v.hit)
      /**
       * **처치 수로 나눠야** 종류끼리 비교가 됩니다. 잡몹은 16마리,
       * 달려드는 자는 5마리라 총합만 보면 배치 비율을 다시 읽을 뿐입니다.
       */
      const dead = median(v.dead)
      const com = median(v.com)
      /**
       * **예고 → 판정** 순서로 씁니다. 이 둘 사이에서 사라진 것이
       * `끊김` 이고, 그게 플레이어가 실제로 반격/방해에 성공한 횟수입니다.
       *
       * 예전엔 `휘두름`(판정 도달) 하나만 있었는데, 그러면 🟢 달려드는 자처럼
       * **끊기라고 만든 적**이 잘 돌아갈수록 숫자가 0에 가까워집니다 —
       * 성공과 고장이 같은 모양으로 보였습니다.
       */
      console.log(
        `  ${id.padEnd(10)} 예고 ${fmt(v.com, 0)}회 → 판정 ${fmt(v.sw, 0)}회` +
          (com > 0 ? ` (끊김 ${Math.round(((com - sw) / com) * 100)}%)` : '') +
          ` · 적중 ${fmt(v.hit, 0)}회 (${Math.round((hit / Math.max(1, sw)) * 100)}%)` +
          ` · 처치 ${fmt(v.dead, 0)}마리 → 마리당 예고 ${(com / Math.max(1, dead)).toFixed(2)}회`,
      )
      /**
       * **깨어 있던 시간을 다섯으로 나눠** 한 줄 더 붙입니다.
       *
       * 앞 줄은 *"몇 번 걸었나"* 만 말합니다. 적게 걸었다는 것까지는 알아도
       * **왜** 인지는 처방이 갈립니다. 그래서 enemyAI.ts 가 실제로 나누는
       * 갈림길과 **같은 모양으로** 시간을 나눕니다:
       *   · 경직 — 무너진 동안에는 공격 대기열에 **아예 못 들어갑니다**
       *   · 쿨 — 다음 공격까지 쉬는 시간(balance.ts 의 attackCooldown).
       *          단, 쿨은 공격이 **끝난 뒤에** 채워집니다. 첫 공격은 안 막습니다
       *   · 접근 — 아직 사거리 밖. 못 때리는 게 당연한 시간입니다
       *   · 사거리 안 대기 — 닿는데도 안 겁니다 → **토큰**이거나 각도
       * 어디가 크냐가 그대로 처방입니다
       * (체력·경직 / 수치 / 배치·이동속도 / 토큰 규칙).
       */
      const live = median(v.live)
      if (live > 0.5 && v.pAtk.length) {
        const pct = (arr) => Math.round(median(arr))
        console.log(
          `             └ 깨어 ${live.toFixed(1)}초 중` +
            ` 공격 ${pct(v.pAtk)}% · 경직 ${pct(v.pStag)}% · 쿨 ${pct(v.pCool)}%` +
            ` · 접근 ${pct(v.pChase)}% · 사거리 안 대기 ${pct(v.pReady)}%`,
        )
      }
    }
  }
}

/**
 * ── 소비처 — **강화가 왜 안 일어나는가** ──────────────────────────
 *
 * 벤치가 판마다 `무기 강화 0.0회` 를 찍는데, 그 옆에는 `남은 불티 285` 와
 * `살 수 있게 된 때 37초 / 닿을 수 있던 마지막 때 138초` 가 같이 있습니다.
 * **살 수 있고 닿을 수 있는데 100초 동안 안 삽니다.**
 *
 * 이유를 가르는 데이터는 봇이 **이미 모으고 있었습니다** — 소비처에 닿은
 * 순간의 지갑과, 닿고도 못 산 이유(`fireVisits`), 가려다 접은 횟수와
 * 그때의 거리(`fireSkips`). 그런데 그 둘을 **한 판짜리 출력에만** 찍고
 * 있어서, 제가 내내 읽던 벤치에는 한 번도 안 나왔습니다.
 *
 * 이번 라운드에 세 번째로 만나는 같은 모양입니다 — 기능도 데이터도 있는데
 * **보는 자리에 없어서** 없는 것과 같았습니다.
 */
{
  const visits = logs.flatMap((l) => l.fireVisits ?? [])
  const skips = logs.flatMap((l) => l.fireSkips ?? [])
  if (visits.length || skips.length) {
    console.log('\n  ── 소비처 (판당) ─────────────────────')
    console.log(
      `  닿음          ${fmt(logs.map((l) => (l.fireVisits ?? []).length), 1)}회` +
        ` · 가려다 접음 ${fmt(logs.map((l) => (l.fireSkips ?? []).length), 1)}회`,
    )
    if (skips.length) {
      const ds = skips.map((f) => f.dist).filter((d) => d >= 0)
      if (ds.length) console.log(`  접은 거리     ${Math.min(...ds)}~${Math.max(...ds)}m (예산 45m)`)
    }
    /**
     * 닿고도 못 산 이유를 **묶어서** 셉니다. 이유마다 처방이 다릅니다:
     * 정련석이면 **보물 배치**, 불티면 **수입**, 최대 단계면 **손댈 것 없음**.
     */
    if (visits.length) {
      const why = {}
      for (const v of visits) {
        const k = v.weapon
          ? '무기 강화함'
          : v.emberNeed <= 0
            ? '최대 단계'
            : v.stones < v.stoneNeed
              ? '정련석 부족'
              : '불티 부족'
        why[k] = (why[k] ?? 0) + 1
      }
      console.log(
        '  닿았을 때     ' +
          Object.entries(why)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${k} ${n}회`)
            .join(' · '),
      )
    }
  }
}

/**
 * ── 절벽 — **밀어서 떨어뜨리기가 일어나는가** ──────────────────────
 *
 * 이 동사는 새로 만든 게 아니라 **이미 있던 것**입니다(넉백 + 낙하 판정).
 * balance.ts FALL 주석이 *"밀어 떨어뜨린 적이 무방비로 착지하는 것이 진짜
 * 보상"* 이라고 설계까지 적어 뒀는데, **한 번이라도 일어나는지는 아무도
 * 세지 않았습니다.** 이 프로젝트에서 기능이 조용히 죽어 있던 자리는 늘
 * 여기였습니다 — 세는 눈금이 없는 곳.
 *
 * 지형은 미리 쟀습니다: 넉백 5m 면 3단 이상 낙차 옆에 선 적이 7마리이고
 * 전부 주 동선입니다. **기회는 있습니다.** 결과를 봅니다.
 */
{
  const fall = logs.map((l) => l.falls).filter(Boolean)
  if (fall.length) {
    console.log('\n  ── 절벽 (판당) ───────────────────────')
    const foe = fall.map((f) => f.foe)
    const me = fall.map((f) => f.player)
    console.log(
      `  적을 떨어뜨림  ${fmt(foe, 0)}회` +
        (median(foe) > 0 ? ` · 평균 낙차 ${(median(fall.map((f) => f.foeSteps / Math.max(1, f.foe)))).toFixed(1)}단` : ''),
    )
    console.log(`  내가 떨어짐    ${fmt(me, 0)}회`)
    const kinds = new Map()
    for (const f of fall) for (const [id, n] of Object.entries(f.byKind ?? {})) {
      if (!kinds.has(id)) kinds.set(id, [])
      kinds.get(id).push(n)
    }
    if (kinds.size) {
      console.log(
        '  종류별        ' +
          [...kinds.entries()].map(([id, ns]) => `${id} ${fmt(ns, 0)}`).join(' · '),
      )
    }
  }
}

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
