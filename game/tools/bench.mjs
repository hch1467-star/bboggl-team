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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * 찍은 것을 **파일로도 남깁니다.**
 *
 * 이번에 40분짜리 벤치를 돌려 놓고 `| tail -45` 로 받는 바람에 맨 앞의
 * 클리어·받은 피해·사망·백어택을 **통째로 잃었습니다.** 40분짜리 측정이
 * 파이프 한 조각에 날아가면 안 됩니다.
 *
 * 출력 자리를 38군데 고치는 대신 `console.log` 를 **한 번 감쌉니다** —
 * 나중에 줄을 더 넣는 사람이 "여기도 파일에 남겨야 하나"를 신경 쓸 필요가
 * 없어야 합니다. 빠뜨릴 자리를 아예 안 만드는 쪽이 늘 낫습니다.
 */
const OUT_PATH = process.env.BENCH_OUT || path.join(ROOT, 'tools/last-bench.txt')
const captured = []
{
  const real = console.log.bind(console)
  console.log = (...args) => {
    captured.push(args.join(' '))
    real(...args)
  }
  const flush = () => {
    try {
      writeFileSync(OUT_PATH, captured.join('\n') + '\n')
    } catch {
      /* 남기지 못해도 벤치 자체를 죽이지는 않습니다. */
    }
  }
  process.on('exit', flush)
}

const logs = []
/** 벽시계에 걸려 잘린 판 수 — 집계에는 안 들어가지만 반드시 보고합니다. */
let wallCut = 0
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
  /**
   * ── 벽시계로 잘린 판은 **집계에 넣지 않습니다** ──────────────────
   *
   * 이 컨테이너는 GPU 가 없어 프레임률이 판마다 흔들립니다. 같은 420
   * 시뮬레이션초가 벽시계로는 452~900초 넘게까지 벌어졌습니다. 예전에는
   * 900초를 넘기면 자식이 통째로 죽어 **그 판의 모든 것이 사라졌습니다**
   * (3판 중 2판이 그렇게 날아가 아무 결론도 못 낸 벤치가 있었습니다).
   *
   * 이제는 판이 스스로 멈추고 기록을 남기지만, 그 기록을 다른 판과
   * 섞으면 안 됩니다. 중간에 잘린 판은 처치도 피해도 적으니 **"쉬웠던
   * 판"처럼 보여** 모든 중앙값을 아래로 끌어내립니다. 그건 게임이 아니라
   * 기계를 재는 것입니다.
   */
  if (log.wallStopped) {
    wallCut++
    console.log(`⏱️ 벽시계로 잘림 — 집계에서 뺍니다 (${secs}초)`)
    continue
  }
  logs.push(log)
  console.log(
    `${log.clearedAt > 0 ? `★ ${log.clearedAt}초 클리어` : '클리어 못함'} · 사망 ${log.deaths} (${secs}초)`,
  )
}
rmSync(dir, { recursive: true, force: true })

if (wallCut > 0) {
  console.log(
    `\n  ⚠️ ${RUNS}판 중 ${wallCut}판이 **기계가 느려** 중간에 잘렸습니다 — 아래 수치는 나머지 ${logs.length}판입니다.`,
  )
}

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
          chn: [],
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
      // 연계로 이어져 나온 예고. 잡몹 연계가 **도달하는지** 보는 유일한 눈금입니다.
      byFoe.get(f.id).chn.push(f.chained ?? 0)
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
          ` · 처치 ${fmt(v.dead, 0)}마리 → 마리당 예고 ${(com / Math.max(1, dead)).toFixed(2)}회` +
          // 연계가 있는 종류에만 붙입니다 — 없는 적에 0회를 찍으면 줄만 길어집니다.
          (median(v.chn) > 0 ? ` · 그중 연계 ${fmt(v.chn, 0)}회` : ''),
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
 * ── 구역별 위험도 — **난이도가 보스를 향해 올라가는가** ────────────
 *
 * 한 판짜리 출력에만 있던 눈금입니다. 그래서 제가 한 판을 보고
 * *"절정이 존 한가운데이고 보스로 가는 길이 가장 안전하다"* 고 읽었습니다.
 * 네 판을 나란히 놓으니 **정확히 뒤집혀** 있었습니다:
 *
 *     구역        판6    판7    판8    판9
 *     성벽 위(보스) 132    130    127    118
 *     무너진 성문   103    104    105    104
 *     중앙 폐허     85     94     92   **135**   ← 판9만 튐
 *
 * 실제 곡선은 `성문 103 → 폐허 90 → 보스 130` 으로 **올라갑니다.**
 * 판9 하나가 이상값이었고, 저는 그 한 판으로 존을 다시 짤 뻔했습니다.
 *
 * 이번 라운드에만 두 번째입니다(`답할 스킬 0%` 도 91초에 막힌 실패 판의
 * 값이었습니다). 그래서 고칠 것은 게임이 아니라 **읽는 자리**입니다 —
 * 여러 판을 보는 도구에 없으면, 한 판을 보고 판단하게 됩니다.
 * `fireVisits` 를 벤치에 올린 것과 같은 이유입니다.
 */
{
  const byRegion = new Map()
  for (const l of logs) {
    for (const r of l.regionDanger ?? []) {
      if (!byRegion.has(r.name)) byRegion.set(r.name, { risk: [], secs: [], kills: [] })
      const g = byRegion.get(r.name)
      // 위험도는 **판마다 먼저** 냅니다(부분의 중앙값은 전체의 중앙값과 안 맞습니다).
      if (r.combat > 0) g.risk.push((r.damage / r.combat) * 60)
      g.secs.push(r.seconds)
      g.kills.push(r.kills)
    }
  }
  if (byRegion.size) {
    console.log('\n  ── 구역별 위험도 (교전 1분당 받은 피해) ────')
    for (const [name, g] of [...byRegion.entries()].sort(
      (a, b) => median(b[1].risk) - median(a[1].risk),
    )) {
      console.log(
        `  ${name.padEnd(12)} ${fmt(g.risk, 0)} /교전분` +
          ` · 머문 ${fmt(g.secs, 0)}초 · 처치 ${fmt(g.kills, 0)}마리` +
          ` (${g.risk.length}/${logs.length}판)`,
      )
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
        /**
         * `자리 아님` 이 맨 앞입니다 — **이게 진짜 원인이었습니다.**
         * 봇이 소비처에 닿았다고 믿고 B 를 눌렀는데 게임 기준으로는
         * 강화가 되는 자리가 아니었고(반경 2.4m · 화톳불은 적 14m 이내면
         * 막힘), 그걸 "강화함"으로 적고 있었습니다. 자원 부족과 자리 문제는
         * 처방이 정반대라(수입·배치 vs 지도·반경) 반드시 갈라야 합니다.
         *
         * ⚠️ `눌렀는데 안 됨` 도 따로 둡니다. 예전엔 `불티 부족` 이 **맨 끝
         * 분류**여서, 자원이 넉넉한데 강화가 안 된 경우까지 전부 그리로
         * 떨어졌습니다. 한 판에서 `불티 106 · 필요 80` 인데 `불티 부족` 이라고
         * 찍힌 것이 그것입니다 — 라벨이 원인을 **지어내고** 있었습니다.
         */
        const k = !v.atStation
          ? '자리 아님'
          : v.weapon
            ? '무기 강화함'
            : v.emberNeed <= 0
              ? '최대 단계'
              : v.stones < v.stoneNeed
                ? '정련석 부족'
                : v.embers - (v.vial ? v.vialCost : 0) < v.emberNeed
                  ? '불티 부족'
                  : '눌렀는데 안 됨'
        why[k] = (why[k] ?? 0) + 1
      }
      /**
       * **성수병을 몇 번 샀는가**도 같이 셉니다.
       *
       * 「불티 부족」이 5회인데 판이 끝나면 불티가 303 남습니다. 앞뒤가
       * 안 맞아 보이지만, 봇은 **성수병 먼저 사고 남으면 무기**입니다.
       * 성수병 사다리가 60 → 140 → 260 이라, 싼 쪽이 먼저 팔리면서
       * 무기(첫 단계 80)가 영영 순서를 못 받는 것이 가설입니다.
       * 가설이므로 **셉니다.** 성수병 강화가 0회인데 불티가 부족했다면
       * 원인은 딴 데 있습니다.
       */
      const vials = visits.filter((v) => v.vial).length
      console.log(`  성수병 강화   ${vials}회 (같은 불티를 무기와 나눠 씁니다)`)
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
/**
 * ── ⚠️ 구간 시간은 **초기화 없는 판만** 모읍니다 ────────────────────
 *
 * 이 줄이 왜 이렇게 됐는지: 초기화가 2/3판이던 벤치의 구간별 화력
 * (23.5 → 31.4 → 44.3/초)에서 체력 배분을 거꾸로 풀어 경계를 옮겼습니다.
 * 예상 5.3/6.1/6.9초를 미리 적고 다시 쟀더니 **16.5/6.8/11.0초** 가
 * 나왔습니다 — 1단계는 체력을 줄였는데 시간이 늘었습니다.
 *
 * 두 벤치의 차이는 하나였습니다: **초기화 2/3판 vs 0판.**
 * 보스가 이탈로 귀환하면 봇은 누적을 버리고 마지막 시도만 보고합니다.
 * 그래서 "한 번 물러났다 다시 들어간 판"과 "한 번에 간 판"이 같은 칸에
 * 섞여 있었고, 저는 그 섞인 중앙값으로 소수 둘째 자리를 계산했습니다.
 *
 * 경고를 위에 한 줄 찍는 것만으로는 부족했습니다 — 실제로 그 경고가
 * 찍혀 있는데도 아래 숫자를 그냥 읽었습니다. 그래서 **섞이지 않게**
 * 만듭니다. 비교할 수 있는 것끼리만 모읍니다.
 */
const cleanBoss = boss.filter((l) => (l.boss.resets ?? 0) === 0)
const phaseSrc = cleanBoss.length > 0 ? cleanBoss : boss
const phaseNote =
  cleanBoss.length > 0
    ? cleanBoss.length < boss.length
      ? ` (초기화 없는 ${cleanBoss.length}판만)`
      : ''
    : ' ⚠️ 초기화 없는 판이 없습니다 — 아래 수치로 배분을 계산하지 마세요'
for (let i = 0; i < 3; i++) {
  const times = phaseSrc.map((l) => l.boss.phaseTime?.[i])
  const dps = phaseSrc.map(
    (l) => (l.boss.phaseBands?.[i] ?? 0) / Math.max(0.1, l.boss.phaseTime?.[i] ?? 0),
  )
  /**
   * **처형·붕괴를 구간별로 같이 냅니다.**
   *
   * 5판 벤치가 화력이 구간마다 11.8 → 23.1 → 38.8/초 로 **3.3배** 오른다고
   * 말합니다. 그런데 그 숫자만으로는 고칠 곳을 못 정합니다. 오르는 이유가
   * 무엇이냐에 따라 처방이 완전히 다르기 때문입니다:
   *
   *   · 처형/붕괴가 뒤로 몰린다 → 체력 배분이 아니라 **강인도** 이야기입니다
   *   · 고르게 퍼져 있다        → 스킬·집중이 쌓이는 것이고, 배분으로 풉니다
   *
   * 지난번에 이걸 안 보고 배분부터 계산했다가 되돌렸습니다. 갈래를 먼저 셉니다.
   */
  const fin = phaseSrc.map((l) => l.boss.phaseFinishers?.[i] ?? 0)
  const brk = phaseSrc.map((l) => l.boss.phaseBreaks?.[i] ?? 0)
  console.log(
    `  ${i + 1}단계         ${fmt(times)}초 · 실효 화력 ${fmt(dps)}/초 · ` +
      `처형 ${fmt(fin, 1)} · 붕괴 ${fmt(brk, 1)}${i === 0 ? phaseNote : ''}`,
  )
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
/**
 * ── 이어짐 — 눌러 둔 것이 실제로 일했는가 ──────────────────────────
 *
 * ⚠️ 이 줄이 여기 있어야 하는 이유는 DESIGN.md 규칙 5 에 이미 적혀 있습니다:
 * *"눈금은 여러 판을 보는 자리(벤치)에 있어야 합니다 — 한 판짜리 출력에만
 * 있으면 한 판으로 판단하게 됩니다."* 선입력을 넣고 눈금을 만들면서
 * `playthrough` 에만 붙였다가, 정작 3판 벤치를 돌리고 나서 **찾을 수 없었습니다.**
 * 규칙을 적어 둔 사람이 같은 세션에서 그 규칙을 어겼습니다.
 *
 * 읽는 법 — 셋의 처방이 서로 다릅니다:
 *   · `버려짐(만료)` 이 크면 → 창(0.55초)이 짧거나 빠져나올 자리가 늦게 옵니다
 *   · `누른 순간 못 냄` 이 크면 → 버퍼가 아니라 **스태미나** 이야기입니다
 *   · `평균 대기` 가 0에 가까우면 → 이미 Idle 일 때만 눌렀다는 뜻이라
 *     버퍼가 하는 일이 없습니다(있으나 마나)
 */
{
  /**
   * ⚠️ **합계가 누른 횟수와 같지 않습니다.**
   *
   * 처음엔 셋(이어짐·만료·못 냄)을 더해 "선입력 N회"라고 찍었는데, 그
   * 뒤에 거절 처리를 고치면서 뜻이 바뀌었습니다. 예전에는 못 내면 버퍼를
   * **버렸으므로** 셋이 배타적이었습니다. 지금은 버리지 않고 거절음만
   * 한 번 내므로, **누른 순간 못 냈던 입력이 잠시 뒤 나갈 수 있습니다** —
   * 그러면 `못 냄` 과 `이어짐` 에 둘 다 세어집니다.
   *
   * 그래서 분모를 `이어짐 + 만료`(결말이 난 것)로 잡고, `못 냄` 은
   * 그 위에 겹쳐 놓는 값으로 따로 적습니다. 고친 코드에 맞춰 표기를
   * 안 고치면, 다음에 읽는 사람은 **없는 사건을 세게** 됩니다.
   */
  const settled = (l) => (l.inputUsed ?? 0) + (l.inputExpired ?? 0)
  console.log(
    `  선입력         결말 ${fmt(pick(settled), 0)}회 중 이어짐 ${fmt(pick((l) => l.inputUsed ?? 0), 0)}회 ` +
      `(${fmt(pick((l) => Math.round(((l.inputUsed ?? 0) / Math.max(1, settled(l))) * 100)), 0)}%) · ` +
    `공격 끊고 구르기 ${fmt(pick((l) => l.inputCancels ?? 0), 0)}회 · ` +
      `버려짐(만료) ${fmt(pick((l) => l.inputExpired ?? 0), 0)}회`,
  )
  console.log(
    `                 그중 누른 순간엔 못 냈던 것 ${fmt(pick((l) => l.inputDropped ?? 0), 0)}회 (겹침) · ` +
      `평균 대기 ${fmt(pick((l) => l.inputWaitAvg ?? 0), 2)}초`,
  )
}

console.log('\n  ── 배움과 성장 ────────────────────────')
console.log(`  🟢 초록 예고   ${fmt(pick((l) => l.greenEvents ?? 0), 0)}회 · 실제 반격 ${fmt(pick((l) => l.counters), 0)}회`)
/**
 * **예고가 끝난 방식**을 나눠 봅니다. "초록 4회 · 반격 1회"만으로는
 * 나머지 셋이 왜 답 없이 끝났는지 알 수 없고, 가능한 이야기마다 처방이
 * 정반대입니다: 못 답한 것이면 반격을 쉽게, 적이 죽은 것이면 이 적의
 * 체력·등장 거리, 휘두름까지 갔으면 애초에 문제가 아닙니다(맞고 배우는 중).
 */
console.log(
  `                 끝난 방식 — 휘두름까지 ${fmt(pick((l) => l.greenSwung ?? 0), 0)}회 · ` +
    `적이 죽음 ${fmt(pick((l) => l.greenDied ?? 0), 0)}회 · ` +
    `반격으로 끊김 ${fmt(pick((l) => l.greenCountered ?? 0), 0)}회 · ` +
    `그 밖의 끊김 ${fmt(pick((l) => l.greenBroken ?? 0), 0)}회`,
)
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
