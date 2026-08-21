/**
 * 🔺 트라이포드 검증 — `npm run tripods`
 *
 * ── 왜 이제야 만드는가 ──────────────────────────────────────────────
 * 이 저장소는 4색·무기·적·지형에 전부 계측기를 세워 놓고 **성장 시스템에만
 * 안 세웠습니다.** 있는 것은 `npm run tripod`(창 캡처)뿐이고, 그 파일
 * 머리말이 스스로 이렇게 적어 두었습니다 — *"둘 다 **눈으로만** 판정됩니다."*
 *
 * 그래서 **선택지 72개 중 어느 것이 압도적인지 아무도 모릅니다.** 트라이포드의
 * 값어치는 *"둘 다 매력적이라 고민된다"* 에 있는데, 한쪽이 명백히 세면 그건
 * 선택이 아니라 **정답 외우기**입니다.
 *
 * ── ⚠️ 하나의 자로 전부 재면 안 됩니다 ─────────────────────────────
 * 가장 쉬운 자는 **초당 피해**입니다. 그런데 그 자로 재면 *"돌진하는 동안
 * 무적"* 은 0점이 됩니다 — 피해를 하나도 안 올리니까요. 실제로는 그게 이
 * 게임에서 가장 값진 것 중 하나입니다(🔵 의 정답이 무적 프레임입니다).
 *
 * **한 자로 다른 축을 재면 멀쩡한 선택지가 죽은 것으로 보입니다.** 이
 * 세션에서만 같은 병을 일곱 번 봤습니다(각도·넘긴 이유·눈금·목·거리·
 * 사다리·되돌아옴). 그래서 여기서는 **축이 같은 것끼리만** 견줍니다:
 *
 *   · 두 선택지가 **초당 피해에만** 손대면 → 견줄 수 있습니다. 비율을 냅니다
 *   · 한쪽이라도 **다른 축**(무적·도형·사거리·속박…)을 건드리면
 *     → **「이 자로는 못 잽니다」** 라고 적고 넘어갑니다
 *
 * 「못 잰 것은 통과가 아니다」 — 그러니 못 잰 것은 **못 잼으로** 셉니다.
 *
 * ── ⚠️ 이것은 후보를 좁히는 자입니다 ───────────────────────────────
 * 여기서 나오는 것은 **계산**입니다. 이 저장소는 계산과 실제가 다른 것을
 * 여러 번 겪었습니다(색 대비 계산 33.6 → 화면 23.3). 그러니 여기 답은
 * *"어디를 실제로 재 볼지"* 를 고르는 데 쓰고, 판정은 실측에 맡기십시오.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { TRIPODS } = await import(path.join(ROOT, 'src/config/tripods.ts'))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('\n🔺 트라이포드 — 둘 다 매력적인가, 아니면 정답이 정해져 있는가\n')

/**
 * 초당 피해에 **직접** 곱해지는 칸들. 여기 밖의 칸이 하나라도 있으면
 * 그 선택지는 이 자의 대상이 아닙니다.
 *
 * ⚠️ `hitsAdd` 는 스킬마다 기본 타수가 달라서 배율을 못 냅니다(1→2 는
 *    2배지만 4→5 는 1.25배입니다). 기본 타수를 여기 적으면 그 순간
 *    **베껴 적은 규칙**이 되므로, **못 잼**으로 돌립니다.
 */
const DPS_KEYS = new Set(['damageMult', 'cooldownMult'])

const dpsOf = (mods) => {
  const keys = Object.keys(mods ?? {})
  if (keys.length === 0) return null
  if (!keys.every((k) => DPS_KEYS.has(k))) return null
  return (mods.damageMult ?? 1) / (mods.cooldownMult ?? 1)
}

const rows = []
let comparable = 0
let unmeasurable = 0
for (const [skill, tiers] of Object.entries(TRIPODS)) {
  tiers.forEach((tier, i) => {
    const opts = tier.options ?? []
    if (opts.length !== 2) {
      rows.push({ skill, i, kind: 'shape', note: `선택지가 ${opts.length}개입니다` })
      return
    }
    const a = dpsOf(opts[0].mods)
    const b = dpsOf(opts[1].mods)
    if (a === null || b === null) {
      unmeasurable++
      rows.push({
        skill,
        i,
        kind: 'other',
        note: `${opts[0].name} ↔ ${opts[1].name}`,
      })
      return
    }
    comparable++
    const hi = Math.max(a, b)
    const lo = Math.min(a, b)
    rows.push({
      skill,
      i,
      kind: 'dps',
      ratio: hi / lo,
      a,
      b,
      names: [opts[0].name, opts[1].name],
    })
  })
}

/**
 * 🚧 **게이트** — 견줄 수 있는 짝이 하나도 없으면 아래 판정은 빈 표본으로
 *    통과합니다. 이 저장소가 다섯 번 데인 자리입니다.
 */
check(
  comparable > 0,
  '🚧 같은 자로 견줄 수 있는 짝이 있다 (빈 표본으로 통과하지 않게)',
  `초당 피해로 견줄 수 있는 단계 ${comparable}개 · 축이 달라 못 재는 단계 ${unmeasurable}개`,
)

const dps = rows.filter((r) => r.kind === 'dps')
if (dps.length > 0) {
  dps.sort((a, b) => b.ratio - a.ratio)
  console.log('\n  [초당 피해로 견줄 수 있는 단계] — 비율이 클수록 한쪽이 셉니다')
  for (const r of dps.slice(0, 8)) {
    console.log(
      `     ${r.skill.padEnd(14)} ${r.i + 1}단계  ` +
        `${r.names[0]} ×${r.a.toFixed(2)}  ↔  ${r.names[1]} ×${r.b.toFixed(2)}` +
        `   **${r.ratio.toFixed(2)}배**`,
    )
  }
  /**
   * ── 문턱 1.25 의 근거 ────────────────────────────────────────────
   * 이 저장소에는 이미 같은 성질의 기준이 있습니다 — `npm run weapons` 가
   * 무기끼리 견줄 때 *"1등은 **뚜렷한 차이**일 때만 1등으로 센다"* 고
   * 적어 두었고, 거기서 3.5% 차이는 **부호가 판마다 뒤집혔습니다.**
   *
   * 트라이포드는 **한 번 고르면 그 판 내내 갑니다.** 그러니 무기 비교보다
   * 관대해도 됩니다 — 다만 **4분의 1**을 넘으면 그건 취향이 아니라
   * 정답입니다. 1.25 는 *"한쪽을 고르면 25% 더 센다"* 이고, 그 정도면
   * 사람은 고민하지 않습니다.
   *
   * ⚠️ 이 값은 **계측기의 정책**이지 게임의 규칙이 아닙니다. 여기서
   *    빨간불이 뜬다고 곧바로 값을 만지지 마십시오 — 먼저 **실제로**
   *    그 선택지가 이기는지 보십시오(계산과 실제는 다릅니다).
   */
  const DOMINANT = 1.25
  const bad = dps.filter((r) => r.ratio >= DOMINANT)
  check(
    bad.length === 0,
    `🔺 **초당 피해가 겹치는 단계에서 한쪽이 압도하지 않는다** (${DOMINANT}배 미만 — 넘으면 취향이 아니라 정답입니다)`,
    bad.length === 0
      ? `가장 벌어진 것 ${dps[0].skill} ${dps[0].i + 1}단계 ${dps[0].ratio.toFixed(2)}배`
      : bad.map((r) => `${r.skill} ${r.i + 1}단계 **${r.ratio.toFixed(2)}배**`).join(' · '),
  )
}

const other = rows.filter((r) => r.kind === 'other')
if (other.length > 0) {
  console.log(
    `\n  [못 잼] 축이 달라 이 자로는 못 재는 단계 ${other.length}개 —` +
      ` **통과도 실패도 아닙니다.** 실제로 눌러 봐야 압니다`,
  )
  for (const r of other.slice(0, 6)) {
    console.log(`     ${r.skill.padEnd(14)} ${r.i + 1}단계  ${r.note}`)
  }
  if (other.length > 6) console.log(`     … 그 밖 ${other.length - 6}개`)
}

/**
 * 🔺 **한쪽이 다른 쪽을 완전히 지배하는가.**
 *
 * ── ⚠️ 「정체가 바뀐다」를 두 번 기계화하려다 두 번 틀렸습니다 ──────
 * 설계는 3단계의 역할을 *"스킬의 정체가 바뀝니다"* 로 정해 두었습니다.
 * 그걸 검사로 옮기려고 두 번 시도했고, 두 번 다 **멀쩡한 설계를
 * 빨갛게** 칠했습니다:
 *
 *   ① *"수치가 아닌 것을 바꾸는가"* → `cleave_helm` 이 걸렸습니다.
 *      그런데 「피해 ×2.5 · 강인도 ×0.4」 ↔ 「강인도 ×2.2 · 피해 ×0.7」은
 *      **한 방 기술과 무너뜨리는 기술로 갈리는 것**이라 정체가 바뀝니다.
 *      맞바꿈으로 표현했을 뿐입니다.
 *
 *   ② *"얻는 것과 버리는 것이 둘 다 있는가"* → `shove/절벽으로`(넉백
 *      ×2.6)가 걸렸습니다. 수치상 손해는 없지만 이 존은 **절벽이
 *      많아서**, 미는 기술이 **떨어뜨리는 기술**이 됩니다. 대가가 숫자가
 *      아니라 **상황**입니다.
 *
 * 「정체가 바뀐다」는 **mods 만으로는 기계화가 안 됩니다.** 억지로
 * 기계화하면 계측기가 설계를 고치라고 시킵니다 — 이 세션에서 이미
 * 겪은 일이고(사다리 장부가 다크 소울 문법을 버그로 신고했습니다),
 * 그 대가는 **고칠 것이 없는 곳을 고치는 것**입니다.
 *
 * ── 그래서 **답할 수 있는 것만** 묻습니다 ────────────────────────
 * 기계가 확실히 아는 것은 하나입니다 — *"같은 축에서 한쪽이 모두 낫고
 * 하나라도 더 나은가."* 그러면 다른 쪽은 **고를 이유가 없습니다.**
 * 축이 겹치지 않으면 견줄 수 없고, 그건 **못 잼**입니다.
 */
const GAIN_WHEN_LOW = new Set(['cooldownMult', 'windupMult', 'recoveryMult'])
const better = (k, v, w) => (GAIN_WHEN_LOW.has(k) ? v < w : v > w)
/** A 가 B 를 완전히 지배하는가 — 겹치는 축 전부에서 A ≥ B 이고 하나는 A > B. */
const dominates = (A, B) => {
  const ka = Object.keys(A ?? {}).filter((k) => typeof A[k] === 'number')
  const kb = Object.keys(B ?? {}).filter((k) => typeof B[k] === 'number')
  // 한쪽에만 있는 축이 있으면 그건 **다른 것을 주는 것**이라 지배가 아닙니다.
  if (ka.length !== kb.length || !ka.every((k) => kb.includes(k))) return false
  if (ka.length === 0) return false
  let strict = false
  for (const k of ka) {
    if (A[k] === B[k]) continue
    if (!better(k, A[k], B[k])) return false
    strict = true
  }
  return strict
}
const dominated = []
for (const [skill, tiers] of Object.entries(TRIPODS)) {
  tiers.forEach((tier, i) => {
    const [x, y] = tier.options ?? []
    if (!x || !y) return
    if (dominates(x.mods, y.mods)) dominated.push(`${skill} ${i + 1}단계 — **${x.name}** 이 ${y.name} 을 지배`)
    else if (dominates(y.mods, x.mods)) dominated.push(`${skill} ${i + 1}단계 — **${y.name}** 이 ${x.name} 을 지배`)
  })
}
check(
  dominated.length === 0,
  '🔺 **한쪽이 다른 쪽을 완전히 지배하지 않는다** (지배당한 쪽은 고를 이유가 없습니다)',
  dominated.length === 0
    ? `36개 단계 전부 — 축이 겹치는 짝에서 지배 없음`
    : dominated.join(' · '),
)
console.log(
  '     ⚠️ **「정체가 바뀌는가」는 여기서 안 묻습니다** — mods 만으로는 기계화가' +
    ' 안 됩니다(위 주석의 두 번의 실패). 그건 사람이 봐야 합니다',
)

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
