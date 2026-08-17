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

/**
 * ── 창의 길이를 **기계 속도에서** 정합니다 ──────────────────────────
 *
 * 예전에는 창이 420 시뮬레이션초로 고정이었고, 벽시계 안전줄에 걸린 판을
 * 버렸습니다. 그런데 버려지는 판이 무작위가 아니었습니다:
 *
 *   · 존을 깨면 판이 **그 순간 끝납니다**(예: 190초).
 *   · 못 깨면 창 끝(420초)까지 **다 돕니다.**
 *   → 벽시계에 먼저 걸리는 쪽은 언제나 **못 깬 판**입니다.
 *
 * 그래서 3판 중 2판이 잘리고 남은 1판이 클리어한 판이었던 벤치가
 * `존 클리어 1/1판` 이라고 적었습니다. **1/3을 100%로 보고한 것입니다.**
 * 자르는 잣대가 재려는 것과 붙어 있으면 남은 것은 표본이 아닙니다.
 *
 * 고치는 방향은 "잘 버리기"가 아니라 **"안 잘리게 하기"** 입니다. 짧은
 * 예비 판으로 이 기계가 시뮬레이션 1초를 벽시계 몇 초에 도는지 재고,
 * 안전줄 안에서 **끝까지 돌 수 있는 창**을 정해 모든 판에 똑같이 줍니다.
 * 창이 짧아지면 "덜 깬다"가 아니라 **"짧은 창에서 몇 판이나 깨는가"** 라는
 * 정직한 질문으로 바뀝니다 — 그래서 창 길이를 아래에 반드시 찍습니다.
 *
 * 안전 계수 0.85 는 예비 판이 **초반**만 본다는 것 때문입니다. 뒤로 갈수록
 * 적도 이펙트도 많아져 느려집니다. (덜 데워진 브라우저 때문에 반대로 느려
 * 보이던 몫은 `simPerWallWarm` 이 이미 걷어냈으니, 남은 건 이 부하 증가분
 * 하나입니다.) 창이 조금 짧은 것은 손해지만, 창을 넘겨 잡으면 잘린 판이
 * 다시 생기고 그건 편향으로 돌아옵니다.
 */
const SAFE_WALL = 780 // 자식 프로세스는 900초에 죽습니다. 기록을 쓸 여유를 남깁니다.
const CAL_LIMIT = 40
const WINDOW_MIN = 150
const WINDOW_MAX = Number(process.env.BENCH_WINDOW_MAX ?? 420)

function runOnce(out, limit, extraEnv = {}) {
  return spawnSync('node', ['tools/playthrough.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...extraEnv,
      PLAY_JSON: out,
      PLAY_LIMIT: String(limit),
      PLAY_WALL: String(SAFE_WALL),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
    timeout: 15 * 60 * 1000,
  })
}

let WINDOW = WINDOW_MAX
{
  process.stdout.write(`  기계 속도 재는 중(${CAL_LIMIT}초짜리 예비 판)… `)
  const out = path.join(dir, 'calib.json')
  const r = runOnce(out, CAL_LIMIT)
  if (r.status === 0 && existsSync(out)) {
    const c = JSON.parse(readFileSync(out, 'utf8'))
    const speed = Number(c.simPerWallWarm ?? c.simPerWall)
    if (Number.isFinite(speed) && speed > 0) {
      WINDOW = Math.max(WINDOW_MIN, Math.min(WINDOW_MAX, Math.floor(SAFE_WALL * speed * 0.85)))
      console.log(`시뮬 ${speed.toFixed(2)}초/벽시계 1초 → 창 ${WINDOW}초`)
    } else {
      console.log(`속도를 못 읽었습니다 — 창 ${WINDOW}초로 갑니다`)
    }
  } else {
    console.log(`예비 판 실패 — 창 ${WINDOW}초로 갑니다`)
  }
  if (WINDOW < WINDOW_MAX) {
    console.log(
      `  ⚠️ 이 기계로는 ${WINDOW_MAX}초를 안전줄 안에 못 돕니다. ` +
        `아래 수치는 전부 **${WINDOW}초짜리 창**의 이야기입니다.`,
    )
  }
  console.log('')
}

const logs = []
/** 벽시계에 걸려 잘린 판 수 — 집계에는 안 들어가지만 반드시 보고합니다. */
let wallCut = 0
for (let i = 0; i < RUNS; i++) {
  const out = path.join(dir, `run${i}.json`)
  process.stdout.write(`  ${i + 1}/${RUNS}판 도는 중… `)
  const t0 = Date.now()
  const r = runOnce(out, WINDOW)
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
   *
   * ⚠️ 그런데 **빼는 것도 공짜가 아닙니다.** 잘리는 쪽은 못 깬 판에
   *    쏠려 있어서(위 창 계산 주석), 여기서 빼면 클리어율이 부풀려집니다.
   *    그래서 이제 창을 미리 줄여 **여기 걸리지 않게** 만듭니다. 그래도
   *    걸린다면 그건 "느린 기계"가 아니라 **창 계산이 틀렸다는 신호**이고,
   *    아래에서 그렇게 말합니다.
   */
  if (log.wallStopped) {
    wallCut++
    console.log(`⏱️ 벽시계로 잘림 — 집계에서 뺍니다 (${secs}초)`)
    continue
  }
  log.wallSecs = Number(secs)
  logs.push(log)
  console.log(
    `${log.clearedAt > 0 ? `★ ${log.clearedAt}초 클리어` : '클리어 못함'} · 사망 ${log.deaths} (${secs}초)`,
  )
}
rmSync(dir, { recursive: true, force: true })

if (wallCut > 0) {
  const slowest = Math.min(...logs.map((l) => l.simPerWall ?? Infinity))
  console.log(
    `\n  ⚠️ ${RUNS}판 중 ${wallCut}판이 안전줄에 걸려 잘렸습니다 — 창 계산(${WINDOW}초)이 낙관적이었습니다.` +
      `\n     잘리는 쪽은 **못 깬 판**에 쏠려 있으니, 아래 클리어율은 실제보다 높습니다.` +
      (Number.isFinite(slowest)
        ? `\n     끝까지 돈 판의 가장 느린 속도는 시뮬 ${slowest.toFixed(2)}초/벽시계 1초였습니다` +
          ` → 다음엔 \`BENCH_WINDOW_MAX=${Math.floor(SAFE_WALL * slowest * 0.7)}\` 로 다시 재십시오.`
        : ''),
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
/**
 * 창 길이를 **클리어율 옆에** 붙입니다. 이 둘은 떼면 거짓말이 됩니다 —
 * 창이 420초일 때의 2/3판과 200초일 때의 2/3판은 다른 이야기인데,
 * 표에는 똑같이 `2/3판` 이라고만 적힙니다. 다음에 이 표를 보는 사람이
 * 창을 따로 찾아봐야 한다면 그 사람은 결국 안 찾아봅니다.
 */
console.log(`  존 클리어      ${cleared.length}/${logs.length}판  (창 ${WINDOW}초)`)
console.log(`  클리어 시간    ${fmt(cleared.map((l) => l.clearedAt))}초`)
console.log(`  사망           ${fmt(pick((l) => l.deaths), 1)}회`)
console.log(`  처치           ${fmt(pick((l) => l.kills), 0)}마리`)
console.log(`  받은 피해      ${fmt(pick((l) => l.damageTaken), 0)}`)
/**
 * ── 🕐 **기계 속도** — 이 판들을 다른 벤치와 견줄 수 있는가 ──────────
 *
 * 봇의 판단 루프는 **벽시계**에 묶여 있습니다(8ms). GPU 없는 이 컨테이너는
 * 부하에 따라 프레임률이 흔들리고, 느린 판에서는 같은 시뮬레이션 1초 동안
 * 봇이 더 적게 판단합니다 — **늦게 반응하고 더 맞습니다.**
 *
 * ⚠️ 이 줄이 없어서 하마터면 틀린 결론을 낼 뻔했습니다. 벤치 셋의 판당
 *    벽시계가 240~316 → 339~413 → 481~723초 로 **73% 느려졌는데**,
 *    그 위에서 `받은 피해 162 → 280` 을 **밸런스 변화로 읽었습니다.**
 *    전투 숫자를 다른 벤치와 견주기 전에 **이 값이 비슷한지 먼저** 보십시오.
 *    다르면 견줄 수 있는 것은 지도·경제처럼 속도에 안 묶인 것뿐입니다.
 */
console.log(
  `  기계 속도      시뮬 ${fmt(pick((l) => l.simPerWall ?? NaN), 2)}초/벽시계 1초` +
    ` · 봇 판단 ${fmt(pick((l) => l.botTicksPerSec ?? NaN), 1)}회/시뮬초` +
    '  ← 다른 벤치와 견주기 전에 이 줄을 먼저 보십시오',
)
/**
 * ── 📉 **이번 판들끼리 얼마나 흔들렸는가** ──────────────────────────
 *
 * ⚠️ 이 줄이 없어서 이번 세션에만 **두 번** 잡음에 맞출 뻔했습니다.
 *
 *   · `damageTakenScale` 을 하나도 안 바꾼 채 돌린 두 벤치가
 *     3단계를 26.2초와 8.4초로 찍었습니다 (3배, 방향까지 반대)
 *   · 같은 게임 코드로 돌린 두 벤치의 받은 피해가 146과 442,
 *     클리어가 166초와 318초였습니다
 *
 * 위 `기계 속도` 는 **벤치끼리** 견줄 수 있는지를 말해 주지만, **한 벤치
 * 안에서** 판마다 얼마나 벌어졌는지는 아무도 안 말해 줬습니다. 중앙값만
 * 크게 찍고 괄호 안의 폭은 눈에 안 들어옵니다 — 그래서 3배 흔들리는
 * 관측 위에서 값을 0.48로 바꿀 계산을 하고 있었습니다.
 *
 * 폭이 2배를 넘으면 **그 숫자로는 값을 못 정합니다.** 방향만 봅니다.
 * (판을 늘리는 것이 정답이지만, 이 컨테이너에서 3판이 이미 40분입니다.
 *  그러니 적어도 **못 믿는다는 사실**은 화면에 띄웁니다.)
 */
{
  const spread = (xs) => {
    const v = xs.filter((n) => Number.isFinite(n) && n > 0)
    if (v.length < 2) return null
    return Math.max(...v) / Math.min(...v)
  }
  const rows = [
    ['클리어 시간', spread(cleared.map((l) => l.clearedAt))],
    ['받은 피해', spread(pick((l) => l.damageTaken))],
    ['처치', spread(pick((l) => l.kills))],
  ].filter(([, r]) => r !== null)
  const worst = rows.length ? rows.reduce((a, b) => (a[1] >= b[1] ? a : b)) : null
  if (worst && worst[1] >= 2) {
    console.log(
      `  📉 판마다 흔들림  ${rows.map(([k, r]) => `${k} ${r.toFixed(1)}배`).join(' · ')}` +
        `  ← **${worst[0]}가 ${worst[1].toFixed(1)}배 벌어졌습니다.** 이 숫자로 값을 정하지 마십시오 (방향만).`,
    )
  } else if (worst) {
    console.log(
      `  📉 판마다 흔들림  ${rows.map(([k, r]) => `${k} ${r.toFixed(1)}배`).join(' · ')}  (2배 미만 — 값을 견줄 만합니다)`,
    )
  }
}
/**
 * 🩸 **맞은 이유** — 기둥 2의 합격 기준을 숫자로 답합니다.
 *
 * ⚠️ 이 줄이 **처음엔 없었습니다.** playthrough 의 보고서에만 넣어 두고
 *    벤치를 돌렸는데, 벤치는 자기 집계를 따로 찍기 때문에 40분을 돌리고도
 *    장부가 한 글자도 안 나왔습니다. 이 저장소에서 제일 비싼 고장이 늘
 *    **"아무 말도 안 하는 계측기"** 인데, 그걸 또 만들었습니다.
 *
 * fair 가 아닌 한 대는 **플레이어 잘못이 아닙니다.** 화면 밖에서 왔거나
 * (unseen), 손이 묶여 있었거나(locked), 예고가 반응 시간보다 짧았습니다
 * (tooFast). 셋 다 처방이 다르므로 칸을 나눠 둡니다.
 */
{
  const keys = new Set()
  for (const l of logs) for (const k of Object.keys(l.hurt ?? {})) keys.add(k)
  const sum = (f) => logs.reduce((a, l) => a + (l.hurt?.[f] ?? 0), 0)
  const total = [...keys].reduce((a, k) => a + sum(k), 0)
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0)
  const locks = [...keys]
    .filter((k) => k.startsWith('locked:') && sum(k) > 0)
    .sort((a, b) => sum(b) - sum(a))
    .map((k) => `${k.slice(7)} ${sum(k)}`)
    .join(' · ')
  /**
   * 🎯 **"못 피함" 안을 갈라 봅니다** (main.ts `noteHurt`).
   *
   * 이 칸이 하나였을 때 40대가 통째로 들어 있었고, 저는 그걸 보고
   * *"봇이 욕심을 부린다"* 고 믿었습니다. **근거는 없었습니다.**
   * 안 눌러서 맞은 것과, 눌렀는데 일찍/늦어서 맞은 것은 고칠 곳이
   * 각각 다릅니다 — 보상 · 무적 창 · 반응 예산.
   */
  const fairKeys = [...keys].filter((k) => k === 'fair' || k.startsWith('fair:'))
  const fairTotal = fairKeys.reduce((a, k) => a + sum(k), 0)
  const split = fairKeys
    .filter((k) => sum(k) > 0)
    .sort((a, b) => sum(b) - sum(a))
    .map((k) => `${k === 'fair' ? '갈라지기 전' : k.slice(5)} ${sum(k)}`)
    .join(' · ')
  console.log(
    `  맞은 이유      ${total}대(전 판 합) · 못 피함 ${fairTotal}(${pct(fairTotal)}%)` +
      ` · 아무것도 못 봄 ${sum('unseen:아무것도')}` +
      ` · 몸만 못 봄 ${sum('unseen:몸만')}` +
      ` · 예고가 짧음 ${sum('tooFast')} · 출처불명 ${sum('unknown')}`,
  )
  console.log(`                 그중 — ${split || '갈라진 기록 없음'}`)
  console.log(`                 손이 묶임 — ${locks || '없음'}`)
  /**
   * 🫁 **그 기력을 누가 썼는가.** 한 칸이던 `stamina` 를 갈라 봅니다 —
   * 공격이면 유보분이 뚫린 것(버그), 구르기면 연달아 구른 것(가르칠 일).
   */
  {
    const by = {}
    for (const l of logs) for (const [k, v] of Object.entries(l.lockSpenders ?? {})) by[k] = (by[k] ?? 0) + v
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1])
    if (rows.length) {
      console.log(
        `                    그 기력을 쓴 것 — ${rows.map(([k, v]) => `${k} ${v}`).join(' · ')}`,
      )
    }
  }
  /**
   * 🎨 **색별로 다시 봅니다 — 색마다 답이 다르기 때문입니다.**
   *
   * `안누름 30` 만 보면 *"구르기를 안 쓴다"* 로 읽히지만, 🟡 광역의 정답은
   * **걸어서 이탈**이고 🟣 끌어당김의 정답은 **거리 두기**입니다. 그 색을
   * 안 구른 것은 틀린 게 아니라 **정답**이고, 그런데도 맞았다면 고칠 곳은
   * 구르기가 아니라 *"어디로 빠져나가야 하는지가 안 보인다"* 입니다.
   * 로스트아크가 바닥에 장판 모양을 그리는 이유가 정확히 이것입니다.
   *
   * 색을 안 보고 값을 만지면 **엉뚱한 손잡이**를 잡습니다.
   */
  {
    const byColor = {}
    for (const l of logs) {
      for (const [k, v] of Object.entries(l.hurtByColor ?? {})) byColor[k] = (byColor[k] ?? 0) + v
    }
    const rows = Object.entries(byColor).sort((a, b) => b[1] - a[1])
    if (rows.length) {
      console.log(
        '                 🎨 색별 — 판정 · 색 · 그 색의 정답 · 발(움직였나 — **정답을 냈나가 아닙니다**)',
      )
      for (const [k, v] of rows.slice(0, 8)) {
        const [verdict, color, answer, walk] = k.split('|')
        console.log(
          `                    ${String(v).padStart(3)}대  ${verdict.padEnd(6)} ${color.padEnd(8)} 정답: ${String(answer).padEnd(10)} 발: ${walk ?? '?'}`,
        )
      }
    } else {
      console.log('                 🎨 색별 — 기록 없음 ⚠️ 계측기를 먼저 의심하십시오')
    }
  }
  // 억울한 한 대는 **정체를 찍습니다** — 숫자만으로는 어디를 고칠지 못 정합니다.
  const bad = logs.flatMap((l) => l.unfairHits ?? []).slice(0, 8)
  for (const u of bad) {
    console.log(
      `                 ${u.id.padEnd(14)} ${u.why.padEnd(12)} 예고 ${u.tel}초 · 보인 ${u.seen}초 · 자유 ${u.free}초` +
        (u.since >= 0 ? ` · 구른 뒤 ${u.since}초` : ''),
    )
  }
  if (total === 0) console.log('                 ⚠️ 장부가 비었습니다 — 계측기를 먼저 의심하십시오')
}
/**
 * 💀 **무엇에 죽었는가.**
 *
 * 벤치는 지금까지 `사망 2.0회` 라고만 말했습니다. 죽음은 이 게임에서 가장
 * 비싼 사건입니다 — 진행이 되감기고, **보스 구간 측정이 통째로 무너집니다**
 * (실제로 지난 벤치의 1단계 시간이 4.1~15.3초로 벌어져 계측기가 스스로
 * *"이 수치로 배분을 계산하지 마세요"* 라고 막았습니다). 그런데 그 비싼
 * 사건에 **설명이 한 줄도 없었습니다.**
 *
 * 문장은 게임이 이미 만들고 있었습니다(main.ts `deathLesson`) — 화면에만
 * 띄우고 장부에는 안 남겼을 뿐입니다. 세는 것은 여기서 합니다.
 */
{
  const causes = {}
  for (const l of logs) for (const d of l.deathLog ?? []) causes[d] = (causes[d] ?? 0) + 1
  const rows = Object.entries(causes).sort((a, b) => b[1] - a[1])
  if (rows.length) {
    console.log('  💀 무엇에 죽었나')
    for (const [why, n] of rows.slice(0, 6)) console.log(`       ${String(n).padStart(2)}회  ${why}`)
  } else {
    console.log('  💀 무엇에 죽었나  — 죽지 않았습니다')
  }
}
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
  /**
   * ── 🚧 **소비처 여행이 어디서 막혔는가** ──────────────────────────
   *
   * `닿음 0.0회 · 무기 강화 0.0회` 가 **벤치 여덟 번 내내** 같습니다. 그런데
   * 갈림길 장부는 **단일 판 보고서에만** 있어서, 40분짜리 벤치를 돌리고도
   * *"왜 0인가"* 에 답할 자료가 없었습니다. 이 저장소가 반복해서 데인
   * 모양 그대로입니다 — playthrough 에만 넣고 벤치를 돌리는 것.
   *
   * 조건이 넷이고 **처방이 전부 다릅니다**:
   *   · 소비처없음 → 배치        · 못삼   → 경제(비용·수입)
   *   · 지갑안늘어 → 수입/기준선  · 쿨다운 → 봇 규칙
   * 뭉쳐 놓으면 어느 쪽인지 영영 모르고, 지난번처럼 또 헛짚습니다.
   */
  {
    const has = logs.filter((l) => l.tripBlock)
    if (has.length) {
      const share = (k) =>
        fmt(
          has.map((l) => {
            const t = l.tripBlock
            const tot = t.noFire + t.cantBuy + t.noGrowth + t.cooling + t.open
            return tot ? Math.round((t[k] / tot) * 100) : 0
          }),
          0,
        )
      console.log(
        `  막힌 곳       소비처없음 ${share('noFire')}% · 못삼 ${share('cantBuy')}%` +
          ` · 지갑안늘어 ${share('noGrowth')}% · 쿨다운 ${share('cooling')}%` +
          ` · **열림 ${share('open')}%**`,
      )
      /**
       * 🧭 **소비처마다 실제로 얼마나 가까이 갔는가** — 중앙값으로.
       *
       * 이 줄이 없어서 두 계측기가 오래 어긋나 있었습니다: `npm run map` 은
       * *"모루가 주 동선에서 0m"* 라고 하고, 봇 장부는 *"판 전체에서 12m
       * 안으로 지나친 소비처 1곳"* 이라고 했습니다. 둘 다 참이었습니다 —
       * **봇의 실제 동선이 주 동선이 아니었기 때문**입니다. 그 차이를
       * 보려면 고르는 규칙과 무관한 이 거리가 필요합니다.
       */
      const spots = new Map()
      for (const l of logs) {
        for (const b of l.spendBest ?? []) {
          const k = `${b.anvil ? '모루' : '화톳불'} (${b.where})`
          if (!spots.has(k)) spots.set(k, [])
          spots.get(k).push(b)
        }
      }
      if (spots.size) {
        console.log('  🧭 소비처 접근   (가장 가까이 간 거리 · 그때 살 수 있었는지)')
        for (const [k, rows] of [...spots.entries()].sort(
          (a, b) => median(a[1].map((r) => r.dist)) - median(b[1].map((r) => r.dist)),
        )) {
          const buy = rows.filter((r) => r.canBuy).length
          console.log(
            `    ${k.padEnd(16)} ${fmt(rows.map((r) => r.dist), 0)}m · 살 수 있었던 판 ${buy}/${rows.length}`,
          )
        }
      }
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
{
  /**
   * ⚠️ **조우 연출을 1단계에서 떼어 냈습니다.**
   *
   * 보스는 조우 직후 잠깐 노려보기만 합니다 — 싸움이 아닙니다. 그런데
   * 그 시간이 1단계에 얹혀 있었고, 저는 그 숫자를 보고 *"1단계가 보스전의
   * 절반을 먹는다"* 를 두 번 적었다가 두 번 물렸습니다.
   * `npm run boss` 를 고치다 같은 고장이 여기에도 있는 것을 찾았습니다 —
   * **한 계기에서 고친 고장은 다른 계기에도 있는지 찾아봐야 합니다.**
   */
  const intro = boss.map((l) => l.boss.introTime ?? 0)
  console.log(`  조우 연출      ${fmt(intro)}초 (싸움이 아닙니다 — 1단계와 따로 셉니다)`)
}
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
  /**
   * ⚠️ **못 잰 구간은 집계에서 뺍니다.** 보스전 중에 죽으면 누적이
   *    초기화되어 어떤 구간이 0초로 남습니다. 그걸 하한 0.1 로 나누면
   *    `2170/초` 같은 값이 나오고, 그 한 판이 중앙값과 범위를 통째로
   *    끌고 갑니다. 못 잰 것은 **빼는 것**이지 큰 값이 아닙니다.
   */
  const dps = phaseSrc
    .filter((l) => (l.boss.phaseTime?.[i] ?? 0) >= 0.5)
    .map((l) => (l.boss.phaseBands?.[i] ?? 0) / l.boss.phaseTime[i])
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
/**
 * ── ⏳ **마지막 구간이 가장 길어야 합니다** ────────────────────────
 *
 * bossPhases.ts 가 적어 둔 약속입니다. 이 검사는 원래 `npm run pace` 에
 * 있었는데, 그 실험대는 플레이어를 **순간이동으로 붙여 두고 체력도
 * 채워** 줍니다 — 접촉률이 항상 최대입니다. 그런데 3단계가 하는 일이
 * 정확히 *"더 자주 휘둘러 접촉률을 깎는 것"* 이라, 그 바닥에서는 효과가
 * **구조적으로 안 보입니다.** 15판을 돌려도 잘못된 바닥이면 답이 안
 * 나옵니다 — 실제로 정반대로 빨갛게 떴습니다(1단계 9.6 · 3단계 6.3).
 *
 * 여기는 실제 플레이 고리가 돕니다 — 물러나고, 다가가고, 못 때립니다.
 * 그래서 이 약속은 여기서 묻습니다.
 */
/**
 * ⚠️ **약속을 양쪽에서 묻습니다 — 한쪽만 물으면 넘어갑니다.**
 *
 * 원래 이 검사는 `t3 >= t1` 하나뿐이었습니다. 그래서 3단계가 길어지기만
 * 하면 **얼마나 길어지든 초록**이었습니다. 실제로 그 일이 났습니다:
 * `damageTakenScale` 을 넣자 1단계 10.1초 · 3단계 26.2초(2.6배)로 초록이
 * 떴는데, 그건 *"마지막이 가장 길다"* 가 아니라 **"마지막만 길다"** 입니다.
 * 3단계는 체력의 30%를 갖고 있는데 보스전 37.8초 중 26.2초를 먹었습니다.
 *
 * 참고한 게임들이 뒤 페이즈에서 피하는 자리가 정확히 여기입니다 —
 * 단단해지는 것과 **안 죽는 것**은 다릅니다. 엘든 링에서 욕을 먹은 보스는
 * 어려운 보스가 아니라 *"때리는 시간보다 기다리는 시간이 긴"* 보스였습니다.
 *
 * `npm run boss` 는 같은 모양을 이미 양쪽에서 묻고 있습니다
 * (`가장 긴 구간 ≤ 가장 짧은 구간 × 2.5`). **한 번 고친 고장은 다른
 * 계기에도 있는지 찾아본다** 는 이 저장소의 규칙을 그대로 적용합니다.
 *
 * 문턱을 2.5배로 둔 이유: 3단계는 체력 배분이 30%라 원래 짧아야 정상이고,
 * 설계는 그럼에도 *"가장 길게"* 를 원합니다. 두 요구가 겹치는 폭이
 * 대략 1~2.5배입니다. 그보다 벌어지면 배율이 아니라 **스펀지**입니다.
 */
/**
 * ⚠️ **판정 앞에 게이트를 세웁니다 — 이 줄이 오염된 수치로 판정하고 있었습니다.**
 *
 * 바로 위에서 `cleanBoss`(보스전 중 초기화가 없던 판)를 이미 골라 놓고
 * *"초기화 없는 판이 없습니다 — 아래 수치로 배분을 계산하지 마세요"* 라고
 * 경고까지 찍습니다. 그런데 **이 판정은 오염된 `boss` 로** 하고 있었습니다.
 * 경고를 띄우고 그 경고를 스스로 무시한 셈입니다.
 *
 * 죽으면 보스 체력이 되감기므로 구간 시간이 통째로 무너집니다. 실제로
 * 그런 벤치에서 `1단계 9.7 (4.1~15.3)초` 가 나왔고, 그 위에서 이 줄은
 * **빨간 줄을 띄우고 있었습니다.** 여러 회차 동안 저는 그 빨강을 보고
 * 보스 배율을 만질 계산을 했습니다 — 사실 재고 있던 것은 **죽음**이었습니다.
 *
 * 죽지 않는 침대(`npm run boss`, 체력·기력을 매 틱 채우며 일정한 압력)에서
 * 같은 것을 재면 세 판이 이렇게 나옵니다:
 *
 *     1판 1단계 5.5 · 2단계 3.5 · **3단계 6.6초**
 *     2판 1단계 6.4 · 2단계 4.0 · 3단계 5.3초
 *     3판 1단계 5.9 · 2단계 3.9 · **3단계 6.8초**
 *
 * **약속은 지켜지고 있었습니다.** 그래서 이 약속의 빨강/초록은 그 침대로
 * 옮겼고(boss-probe), 여기서는 **판정할 수 있을 때만** 판정합니다.
 */
{
  const t1 = median(phaseSrc.map((l) => l.boss.phaseTime?.[0] ?? 0))
  const t3 = median(phaseSrc.map((l) => l.boss.phaseTime?.[2] ?? 0))
  if (cleanBoss.length === 0) {
    console.log(
      '  ⏸ 마지막 구간이 가장 길다 (bossPhases.ts 의 약속) — **이 벤치로는 판정하지 않습니다**' +
        `: 모든 판이 보스전 중에 죽어 구간이 되감겼습니다 (1단계 ${t1.toFixed(1)}초 · 3단계 ${t3.toFixed(1)}초는 죽음을 잰 값). ` +
        '죽지 않는 침대는 `npm run boss` 입니다 — 판정은 거기 있습니다.',
    )
  } else {
    const longest = t1 > 0 && t3 >= t1
    const notSponge = t1 > 0 && t3 <= t1 * 2.5
    const ok = longest && notSponge
    console.log(
      `  ${ok ? '✅' : '❌'} 마지막 구간이 가장 길다 — **그리고 스펀지는 아니다** (bossPhases.ts 의 약속) — ` +
        `1단계 ${t1.toFixed(1)}초 · 3단계 ${t3.toFixed(1)}초` +
        (t1 > 0 ? ` (${(t3 / t1).toFixed(1)}배 · 허용 1.0~2.5배)` : '') +
        (cleanBoss.length < boss.length ? ` [초기화 없는 ${cleanBoss.length}판만]` : '') +
        (longest ? '' : ' ← 마지막이 짧습니다') +
        (notSponge ? '' : ' ← **너무 깁니다**: 단단한 게 아니라 안 죽는 것입니다'),
    )
  }
}
console.log(`  보스 처형      ${fmt(boss.map((l) => l.boss.finishers ?? 0), 1)}회`)
/**
 * ⚠️ **이 줄이 아래 장부와 다른 숫자를 세고 있었습니다.**
 *
 * 3판 벤치가 `연계 예약 10.0회 / 발동 0.0회` 를 찍었는데, 바로 아래 장부는
 * 잔액 0 으로 **맞았습니다.** 둘 다 맞을 수는 없습니다. 원인은 이 줄이
 * `bossSwings[].chained`(**보스만**, **판정에 들어갈 때**)를 세고 있었던
 * 것입니다. 반면 `chainsArmed` 는 **모든 적**의 예약을 **예고가 시작될 때**
 * 셉니다. 무리도 시점도 다른 두 숫자를 빗금 하나로 붙여 놓았으니, 나눗셈이
 * 뜻하는 것이 아무것도 없었습니다.
 *
 * 같은 판을 단일 출력으로 돌리면 `예약 14 · 발동 13` 이 나옵니다 —
 * playthrough.mjs 는 처음부터 `chainsFired` 를 썼기 때문입니다.
 * **한 저장소 안에서 같은 것을 두 번 세면, 언젠가 두 값이 갈립니다.**
 * 아래 장부와 **같은 칸**을 읽게 고칩니다.
 */
console.log(`  연계 예약/발동 ${fmt(boss.map((l) => l.boss.chainsArmed ?? 0), 1)}회 / ` +
  `${fmt(boss.map((l) => l.boss.chainsFired ?? 0), 1)}회`)
/**
 * ── 예약된 연계의 **결말을 전부** 셉니다 ────────────────────────
 *
 * 벤치가 *"예약 8회 / 발동 0회"* 를 찍었습니다. 그 두 숫자만으로는 무엇을
 * 고쳐야 할지 알 수 없습니다 — 8이 **어디로 갔는지** 모르니까요. 단일 판
 * 출력에는 "무너져서 끊김"이 있었지만 **벤치에는 없었고**, 예약을 지우는
 * 자리는 무너짐 말고도 넷(페이즈 전환 · 귀환 · 사망 · 덮어씀)이 더 있는데
 * **아무도 세지 않았습니다.**
 *
 * ⚠️ **중앙값끼리 빼면 안 됩니다.** 처음에 그렇게 짜서 "설명 안 되는 5.5회"가
 *    나왔는데, 그건 게임이 아니라 **산수**였습니다. 중앙값은 더하고 빼지지
 *    않습니다 — 항목마다 다른 판이 중앙에 오니까요. 장부는 **판 안에서**
 *    맞아야 합니다. 그래서 판마다 잔액을 구해 그대로 늘어놓습니다.
 */
{
  /**
   * ⚠️ **발동을 세는 자리를 옮겼습니다.** 예전에는 `foeSwings[].chained`
   *    (판정에 들어간 순간 main.ts 가 센 값)를 썼는데, 예약은 **예고가
   *    시작될 때** 소비됩니다. 그 사이에 적이 죽으면 예약은 사라졌는데
   *    발동에도 안 잡혀 어느 칸에도 안 들어갔습니다 — 잔액 4~7회의 정체입니다.
   *    이제 예약과 같은 줄에서 센 `chainsFired` 를 씁니다.
   */
  const rests = boss.map((l) => {
    const d = l.boss.chainsDropped ?? {}
    /**
     * ⚠️ **보스만 세면 안 됩니다.** 처음엔 `bossSwings` 로만 발동을 셌는데,
     *    `chainsArmed` 는 **모든 적**의 예약을 셉니다 — 잡몹도 연계를 갖고
     *    있습니다(grunt_jab → grunt_jab). 그래서 판마다 8회가 "설명 안 됨"
     *    으로 남았는데, 그건 사라진 게 아니라 **잡몹이 실제로 발동시킨 것**을
     *    보스 장부에서 찾고 있었던 것입니다. 같은 무리를 견주어야 합니다.
     */
    /**
     * ⚠️ 위 주석대로 **무리**는 맞췄는데 **시점**이 틀려 있었습니다.
     *    `foeSwings[].chained` 는 적이 **판정(Active)** 에 들어갈 때 세고,
     *    예약은 **예고가 시작될 때** 소비됩니다. 그 사이에 죽으면 예약은
     *    사라졌는데 발동에도 안 잡혀 어느 칸에도 안 들어갑니다.
     *    이제 예약과 **같은 줄**에서 센 값을 씁니다.
     */
    const fired = l.boss.chainsFired ?? (l.foeSwings ?? []).reduce((a, b) => a + (b.chained ?? 0), 0)
    const st = (l.boss.chainsLost ?? []).reduce((a, b) => a + b, 0)
    return (
      (l.boss.chainsArmed ?? 0) -
      (fired +
        st +
        (d.phase ?? 0) +
        (d.leash ?? 0) +
        (d.death ?? 0) +
        (d.overwrite ?? 0) +
        (d.wiped ?? 0) +
        (l.boss.chainsPending ?? 0))
    )
  })
  const m = (f) => median(boss.map(f))
  const worst = rests.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0)
  console.log(
    // ⚠️ 잔액 계산(`fired`)과 **같은 칸**을 보여 줍니다. 예전엔 여기만
    //    `foeSwings[].chained` 였고, 그래서 화면의 항목들이 잔액과 안 맞았습니다.
    `                 결말 — 발동(모든 적) ${m((l) => l.boss.chainsFired ?? 0)}` +
      ` · 무너짐 ${m((l) => (l.boss.chainsLost ?? []).reduce((a, b) => a + b, 0))}` +
      ` · 페이즈전환 ${m((l) => l.boss.chainsDropped?.phase ?? 0)}` +
      ` · 귀환 ${m((l) => l.boss.chainsDropped?.leash ?? 0)}` +
      ` · 사망 ${m((l) => l.boss.chainsDropped?.death ?? 0)}` +
      ` · 덮어씀 ${m((l) => l.boss.chainsDropped?.overwrite ?? 0)}` +
      // 화톳불에서 적을 전부 갈아 끼울 때 함께 사라진 예약 — 오래 비어 있던 칸입니다.
      ` · 통째지움 ${m((l) => l.boss.chainsDropped?.wiped ?? 0)}` +
      ` · 판 끝에 남음 ${m((l) => l.boss.chainsPending ?? 0)}`,
  )
  console.log(
    `                 장부 잔액(판별) ${rests.join(', ')}` +
      (worst === 0 ? '  → 맞음' : `  ⚠️ 최악 ${worst}회가 설명 안 됩니다`),
  )
}

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
  /**
   * ⚔️ 상황 모션이 **실제로 나간** 횟수.
   *
   * ⚠️ playthrough 에만 넣어 두고 벤치를 돌렸다가 40분을 태우고도 이 줄을
   *    못 찾은 적이 있습니다(이어짐 눈금이 그랬습니다). 벤치는 자기 집계를
   *    따로 찍으므로, 양쪽에 다 넣어야 합니다.
   */
  console.log(
    `                 ⚔️ 상황 모션 — 달리기 ${fmt(pick((l) => l.runAttacks ?? 0), 0)}회 · ` +
      `구르기 ${fmt(pick((l) => l.rollAttacks ?? 0), 0)}회 · ` +
      `낙하 ${fmt(pick((l) => l.plungeAttacks ?? 0), 0)}회`,
  )
  /**
   * 🩸 **보스 출혈이 어디서 새는가** — 중앙값으로.
   *
   * 한 판씩 보면 최고치가 57 · 63 · 96 · 96 으로 널뛰어서 무엇도 못
   * 고릅니다. 이 축은 "터졌다/안 터졌다"가 전부인데 네 판 내리 0이었으니,
   * 값을 만지려면 **중앙값**이 있어야 합니다.
   */
  /**
   * 📊 **보스를 녹인 것**의 출처별 중앙값.
   *
   * 페이즈별 초당 피해가 1단계 18.9 → 2단계 86.8 로 튀는 이유를 두 라운드
   * 동안 "플레이어 화력이 전투 중에 올라가서"라고 **추측만** 했습니다.
   * 이제 출처가 찍히므로 추측할 필요가 없습니다.
   */
  /**
   * 🥋 집중의 출처 — 설계가 "가벼운 공격이 번다"고 적어 둔 것이 참인지.
   * `버림`은 가득 찬 채로 흘린 몫입니다(봇은 가득 찼을 때만 태웁니다).
   */
  console.log(
    `                 🥋 집중 — 평타 ${fmt(pick((l) => l.focusFlow?.['평타'] ?? 0), 1)}점 · ` +
      `완벽회피 ${fmt(pick((l) => l.focusFlow?.['완벽회피'] ?? 0), 1)}점 · ` +
      `태움 ${fmt(pick((l) => l.focusFlow?.['태움'] ?? 0), 1)}점 · ` +
      `가득 차서 흘림 ${fmt(pick((l) => l.focusFlow?.['버림'] ?? 0), 1)}점`,
  )
  const SOURCES = ['평타', '상황', '강타', '처형', '스킬', '출혈']
  console.log(
    `                 📊 보스를 녹인 것 — ` +
      SOURCES.map(
        (k) =>
          `${k} ${fmt(
            pick((l) => (l.bossDamageBySource?.[k] ?? []).reduce((a, b) => a + b, 0)),
            0,
          )}`,
      ).join(' · '),
  )
  console.log(
    `                 🩸 보스 출혈 — 터짐 ${fmt(pick((l) => l.bossBleedPops ?? 0), 0)}회 · ` +
      `최고 ${fmt(pick((l) => l.bossBleedPeak ?? 0), 0)}/100`,
  )
  console.log(
    `                    쌓은 ${fmt(pick((l) => l.bossBleedApplied ?? 0), 0)} · ` +
      `식은 ${fmt(pick((l) => l.bossBleedDecayed ?? 0), 0)} · ` +
      `간격 평균 ${fmt(pick((l) => l.bossBleedGapAvg ?? 0), 2)}초 / 최대 ${fmt(pick((l) => l.bossBleedGapMax ?? 0), 2)}초 · ` +
      `유예 안 ${fmt(pick((l) => (l.bossBleedGapInsideRate ?? 0) * 100), 0)}%`,
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
      bySpot.get(k).push({ best: t.best, block: t.block ?? '?' })
    }
  }
  if (bySpot.size) {
    console.log('  못 주운 보물   (가장 가까이 간 거리 · 그때 막고 있던 것 — 예산 40m)')
    for (const [k, rows] of [...bySpot.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const seen = rows.map((r) => r.best).filter((d) => d >= 0)
      /**
       * 🧭 **가장 가까이 간 그 순간 무엇이 막고 있었는가.**
       *
       * 거리만으로는 처방이 안 정해집니다 — 10m 까지 갔는데 못 주운
       * 보물이 있었고, 그건 "멀어서"가 아닙니다. 판마다 이유가 다를 수
       * 있으니 이유별 판수를 그대로 적습니다.
       */
      const why = {}
      for (const r of rows) why[r.block] = (why[r.block] ?? 0) + 1
      const whyStr = Object.entries(why)
        .sort((a, b) => b[1] - a[1])
        .map(([w, n]) => `${w} ${n}판`)
        .join(' · ')
      console.log(
        `    ${k.padEnd(12)} ${rows.length}/${logs.length}판에서 못 주움 · ` +
          (seen.length ? `${fmt(seen, 0)}m` : '경로 자체를 못 찾음') +
          ` · ${whyStr}`,
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
