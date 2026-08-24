/**
 * ── 🌱 **성장이 «세지는 것»이 아니라 «바뀌는 것»인가** ──────────────────
 *
 * `DESIGN.md` 가 성장을 이렇게 못박았습니다:
 *
 *   > 보물 = 새 스킬(룬) / 스킬 변형(트라이포드) — **수치 +5%가 아니라
 *   > 플레이가 바뀌는 것**. 즉 *"세져서 재미있다"가 아니라 **"새로운 걸
 *   > 할 수 있어서 재미있다"***
 *
 * 이 약속을 **재는 계기가 없었습니다.** 벤치는 「받은 피해」와 「클리어
 * 시간」을 재는데, 그건 **세졌는가**를 묻는 자입니다. 그래서 성장을 켜도
 * *"거의 안 바뀐다"* 로 읽혔습니다 — 정작 바뀐 것은 **무엇으로 이기는가**
 * 였는데 아무도 그 칸을 안 보고 있었습니다.
 *
 * 손으로 로그 둘을 견주면 보이긴 합니다. 그런데 손으로 하는 비교는
 * **다음 사람에게 남지 않습니다.** 그래서 한 자리에서 나란히 냅니다.
 *
 * ── 무엇을 «바뀜»으로 세는가 ──────────────────────────────────────
 * 보스를 녹인 출처의 **구성비**입니다. 총량이 아니라 **비율**을 봅니다 —
 * 총량은 «세졌는가»이고 비율이 «바뀌었는가»입니다. 같은 이유로 집중의
 * 흐름(평타/완벽회피/태움)도 같이 봅니다.
 *
 * 실행: node tools/growth-probe.mjs [판수] [성장단계]
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNS = Math.max(2, Math.min(5, Number(process.argv[2]) || 3))
const GROWN = Math.max(1, Number(process.argv[3]) || 8)

/** 보스를 녹인 출처 — bench.mjs 와 **같은 목록**이어야 합니다. */
const SOURCES = ['평타', '상황', '강타', '처형', '스킬', '출혈']

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/**
 * 한 조건으로 벤치를 돌리고 **JSON 한 줄**을 받아옵니다.
 *
 * ⚠️ 벤치의 사람용 출력을 파싱하지 않습니다. 그 줄들은 사람이 읽으라고
 *    만든 것이라 언제든 모양이 바뀌고, 파싱은 **조용히** 틀립니다.
 *    `BENCH_JSON=1` 로 기계용 한 줄을 따로 받습니다.
 */
function runBench(growth) {
  const r = spawnSync(process.execPath, [path.join(HERE, 'bench.mjs'), String(RUNS)], {
    cwd: path.join(HERE, '..'),
    encoding: 'utf8',
    env: { ...process.env, GROWTH: String(growth), BENCH_JSON: '1' },
    maxBuffer: 64 * 1024 * 1024,
  })
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('BENCH_JSON '))
  if (!line) return null
  try {
    return JSON.parse(line.slice('BENCH_JSON '.length))
  } catch {
    return null
  }
}

/** 출처별 총합에서 **구성비(%)** 를 냅니다 — 총량이 아니라 «무엇으로». */
function mixOf(rows) {
  const sum = {}
  let total = 0
  for (const k of SOURCES) {
    const v = rows[k] ?? 0
    sum[k] = v
    total += v
  }
  if (total <= 0) return null
  const out = {}
  for (const k of SOURCES) out[k] = (sum[k] / total) * 100
  return out
}

console.log(`\n🌱 성장이 «플레이»를 바꾸는가 — ${RUNS}판 × 2조건 (성장 0 vs ${GROWN})\n`)

const a = runBench(0)
const b = runBench(GROWN)

check(a !== null && b !== null, '🌱 두 조건 다 값을 받았다 (판정의 게이트)', a && b ? '성장 0 · 성장 N 모두 OK' : '벤치가 JSON 을 안 냈습니다')

if (a && b) {
  const mixA = mixOf(a.melt ?? {})
  const mixB = mixOf(b.melt ?? {})
  check(
    mixA !== null && mixB !== null,
    '🌱 보스를 녹인 출처가 **둘 다 잡혔다** (0으로 나누지 않게)',
    mixA && mixB ? '양쪽 다 피해 기록 있음' : '한쪽이 비었습니다 — 보스를 못 잡은 판일 수 있습니다',
  )

  if (mixA && mixB) {
    console.log(`\n  📊 보스를 녹인 **구성비** (총량이 아니라 «무엇으로»)\n`)
    console.log(`     ${'출처'.padEnd(8)} ${'성장 0'.padStart(8)} ${`성장 ${GROWN}`.padStart(8)}   변화`)
    let biggest = { k: '', d: 0 }
    for (const k of SOURCES) {
      const d = mixB[k] - mixA[k]
      if (Math.abs(d) > Math.abs(biggest.d)) biggest = { k, d }
      console.log(
        `     ${k.padEnd(8)} ${mixA[k].toFixed(1).padStart(7)}% ${mixB[k].toFixed(1).padStart(7)}%   ` +
          `${d >= 0 ? '+' : ''}${d.toFixed(1)}%p`,
      )
    }
    /**
     * ⚠️ **판정은 «바뀌었는가»만 합니다.** «좋아졌는가»는 설계 결정이지
     *    계기가 정할 값이 아닙니다. 문턱 5%p 의 근거: 구성비가 그보다 적게
     *    움직이면 판 사이 흔들림과 구분이 안 됩니다(받은 피해가 판마다
     *    6배 흔들리는 표본입니다).
     */
    check(
      Math.abs(biggest.d) >= 5,
      '🌱 **성장이 «무엇으로 이기는가»를 바꾼다** (수치가 아니라 플레이 — DESIGN.md 성장 절)',
      `가장 크게 움직인 것: ${biggest.k} ${biggest.d >= 0 ? '+' : ''}${biggest.d.toFixed(1)}%p`,
    )

    /** 세졌는지는 **따로** 냅니다 — 두 질문을 한 칸에 담지 않습니다. */
    console.log(
      `\n  💪 세졌는가(참고 · 판정 안 함) — 받은 피해 ${a.hurt} → ${b.hurt} · ` +
        `클리어 ${a.clear}초 → ${b.clear}초 · 사망 ${a.deaths} → ${b.deaths}`,
    )
    console.log(
      `  🌱 실제 성장 — 단계 ${a.tripodUnlocks} → ${b.tripodUnlocks} · 이식 ${a.grafts} → ${b.grafts}`,
    )
    check(
      b.tripodUnlocks > a.tripodUnlocks,
      '🌱 성장 조건에서 **실제로 더 자랐다** (비교의 전제)',
      `단계 ${a.tripodUnlocks} → ${b.tripodUnlocks}`,
    )
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
