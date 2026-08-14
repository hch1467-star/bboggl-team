/**
 * 🔁 **갚을 수 있는가** — 정답대로 답한 사람에게 돌아오는 길이 있는지 재는 규칙.
 *
 * ── 왜 이 파일이 필요했나 ─────────────────────────────────────────
 * 기둥 2는 *"색마다 다른 정답이 있고, 그 정답이 실제로 통한다"* 까지만
 * 약속합니다. **통한다 = 안 맞는다** 입니다. 그런데 안 맞기만 해서는
 * 전투가 앞으로 안 갑니다. 잘 읽은 사람은 **한 대 갚을 수 있어야** 합니다.
 * 그러지 않으면 색을 읽는 값이 0이고, 플레이어는 읽기를 그만둡니다.
 *
 * 이 세션에서 색맹 봇과 색 읽는 봇을 붙여 봤을 때 결론이 안 났고, 그때
 * 이렇게 적어 두었습니다:
 *
 *   > *"그렇다면 고칠 곳은 색이 아니라 **돌아오는 길**입니다."*
 *
 * 이 파일이 그 돌아오는 길을 잽니다.
 *
 * ── 다른 게임이 이미 갖고 있는 규칙 ───────────────────────────────
 * · **몬스터헌터** — 큰 기술일수록 빈틈이 큽니다. "빗나간 대기술"이
 *   교과서적인 딜 타이밍이고, 그래서 큰 기술을 유도하는 플레이가 성립합니다.
 * · **엘든 링** — 잡기가 **빗나가면** 훨씬 긴 경직이 붙습니다. 맞았으면
 *   그 자체가 벌이므로 빈틈을 줄 필요가 없습니다.
 * · **격투게임** — 이름이 아예 있습니다: **헛친 딜레이(whiff punish)**.
 *   헛치는 것 자체가 상대에게 주는 값입니다.
 *
 * 공통점은 하나입니다 — **맞았을 때가 아니라 빗나갔을 때 빈틈이 생깁니다.**
 * 우리 게임에는 이 구분이 없었습니다. 후딜이 하나뿐이었습니다.
 *
 * ── 규칙은 여기 한 곳에만 ─────────────────────────────────────────
 * 무엇이 통과인지 판단하는 것은 이 파일입니다. 프로브는 `punishTable()` 을
 * **읽기만** 합니다. 프로브가 문턱을 들고 있으면, 밸런스를 고칠 때마다
 * 프로브를 같이 고쳐야 하고 그러다 보면 프로브가 게임을 따라 움직여서
 * 영영 빨개지지 않습니다.
 */
import { PLAYER } from './balance'
import { WEAPONS } from './arsenal'
import { ENEMY_DEFS, enemyDef } from './enemies'
import { AttackIntent, attacksFor, openingOf } from './enemyAttacks'
import { EnemyKind } from '../core/components'

/**
 * 이 색의 정답이 **자리를 뜨라고** 요구하는가.
 *
 * 자리를 뜨지 않는 답(무적 프레임 · 반격)은 돌아올 길이 필요 없습니다.
 * 이미 적의 코앞에 있으니까요. 되돌아오는 길이 문제가 되는 것은
 * **거리로 푸는 색** 뿐입니다.
 *
 * ⚠️ 숫자가 아니라 **문자열**입니다. 프로브는 이 값을 브라우저 밖으로
 *    들고 나가서 비교하는데, 숫자 열거형이면 순서를 바꾼 날 프로브가
 *    **조용히** 다른 것을 고릅니다. 이 저장소는 이미 그 사고를 한 번
 *    겪었습니다(`enemyInfo.attacking` 주석 참고 — `state === 1` 을 베꼈다가
 *    열거형 순서가 바뀌어 틀렸습니다).
 */
export type PunishAnswer =
  /** 🔴🔵 무적 프레임 — 제자리에서 넘깁니다 */
  | 'iframe'
  /** 🟡🟣 거리 — 사거리 밖으로 나갔다가 **돌아와야** 합니다 */
  | 'distance'
  /** 🟢 반격 — 예고 중에 붙어서 때리는 것이 답입니다 */
  | 'counter'

/**
 * 색 → 정답의 성격. **enemyAttacks.ts 표의 마지막 칸을 그대로 옮긴 것**이고,
 * 여기서 새로 정하는 값이 아닙니다.
 */
const ANSWER_OF: Record<AttackIntent, PunishAnswer> = {
  [AttackIntent.Strike]: 'iframe',
  [AttackIntent.Sweep]: 'distance',
  [AttackIntent.Snare]: 'iframe',
  [AttackIntent.Pull]: 'distance',
  [AttackIntent.Counter]: 'counter',
}

export interface PunishRow {
  enemy: string
  attackId: string
  /**
   * `attacksFor(kind)` 안에서의 자리. 프로브가 `forceAttack(e, index)` 로
   * **바로 이 공격**을 시킬 때 씁니다 — 프로브가 순서를 세어 두면
   * 패턴을 하나 끼워 넣는 날 조용히 다른 공격을 재게 됩니다.
   */
  index: number
  intent: AttackIntent
  answer: PunishAnswer
  weapon: string
  /** 이 거리 안이면 맞습니다 = 정답이 요구하는 이탈 거리 (combat.ts `shapeDist` 와 같은 식) */
  safeDist: number
  /** 이 거리부터 내 1타가 닿습니다 — 휘두르며 나가는 거리(lunge)까지 칩니다 */
  punishDist: number
  /** 돌아오는 데 걸리는 시간(초) */
  returnT: number
  /** 돌아와서 1타가 나가기까지(초) */
  windupT: number
  /** 갚을 수 있는 창(초) — 빗나갔을 때의 후딜 */
  openingT: number
  /** 남는 시간. 음수면 **정답대로 답했는데 갚을 수 없습니다** */
  slack: number
  ok: boolean
}

/**
 * 예고 동안 **옆으로 빠져서** 부채꼴을 벗어날 수 있는가.
 *
 * 왜 같이 재는가: 🟣 가 못 갚는다는 결과가 나왔을 때 *"부채꼴이 좁으니
 * 옆으로 비키면 되지 않나"* 가 곧바로 떠오릅니다. 그 답이 실제로 되는지
 * **재 보지 않고** 넘기면, 고칠 필요 없는 것을 고치거나 고쳐야 할 것을
 * 안 고칩니다. 적은 예고 중에도 평소의 30% 속도로 **따라 돕니다**
 * (enemyAI 의 `turnSpeedDeg * 0.3`). 그래서 멀수록 불리합니다 —
 * 거리 d 에서 플레이어의 각속도는 `v/d` 로 줄어드는데 적의 회전은 그대로입니다.
 */
export interface SidestepRow {
  enemy: string
  attackId: string
  /** 가장 먼 선택 거리에서 잽니다. 여기서 되면 가까운 쪽은 더 쉽습니다 */
  atDist: number
  /** 플레이어가 벌 수 있는 각속도 − 적의 추적 각속도 (도/초) */
  gainDegPerSec: number
  /** 부채꼴을 벗어나는 데 필요한 시간(초). 못 벌면 Infinity */
  needSec: number
  /** 쓸 수 있는 시간 = 예고(초) */
  haveSec: number
  ok: boolean
}

const RAD2DEG = 180 / Math.PI

/**
 * ⏱ **이 색의 정답이 「타이밍」인가.**
 *
 * 무적 프레임으로 넘기는 색(🔴 직격 · 🔵 속박)만 참입니다. 이 둘은
 * *"언제 누르는가"* 가 전부이고, 나머지 셋은 **미리** 움직여야 합니다
 * (🟡 걸어 나가기 · 🟣 사거리 밖 · 🟢 예고 중에 반격).
 *
 * 어디에 쓰는가: 「지금」 신호(visuals.ts)를 **이 색들에만** 켭니다.
 * 🟡🟣 에 마지막 순간 신호를 켜면 **이미 늦은 때 알려 주는 것**이라
 * 도움이 아니라 거짓말이 됩니다.
 *
 * ⚠️ 색 번호를 새로 적지 않고 `ANSWER_OF` 를 그대로 씁니다 — 어떤 색이
 *    어떤 답을 갖는지는 이 파일에 한 번만 적혀 있어야 합니다.
 */
export function isTimingAnswer(intent: AttackIntent): boolean {
  return ANSWER_OF[intent] === 'iframe'
}

const KINDS: EnemyKind[] = Object.keys(ENEMY_DEFS).map((k) => Number(k) as EnemyKind)

/**
 * 모든 적 × 모든 공격 × 모든 무기에 대해 **돌아오는 길**을 계산합니다.
 *
 * ⚠️ 세 무기를 다 봅니다. "롱소드로는 갚을 수 있다"로 통과시키면,
 *    대검을 든 사람에게는 없는 규칙이 됩니다. 무기를 고르는 것이
 *    **색을 포기하는 것**이 되면 안 됩니다.
 */
export function punishTable(): PunishRow[] {
  const rows: PunishRow[] = []
  for (const kind of KINDS) {
    const cfg = enemyDef(kind)
    attacksFor(kind).forEach((atk, index) => {
      const answer = ANSWER_OF[atk.intent]
      for (const w of WEAPONS) {
        const step = w.combo[0]
        /**
         * 안전 거리는 **판정과 같은 식**으로 구합니다(combat.ts `shapeDist`):
         * `dist > range + 대상반지름` 이면 빗나갑니다. 여기서 대상은 플레이어입니다.
         */
        const safeDist = atk.reach + PLAYER.radius
        /** 내 1타가 닿는 거리. 적의 굵기와, 휘두르며 나가는 거리를 더합니다. */
        const punishDist = step.range + cfg.radius + step.lunge
        const speed = PLAYER.moveSpeed * w.moveSpeedScale
        /**
         * 자리를 안 뜨는 답(무적 프레임 · 반격)은 되돌아올 거리가 0입니다.
         * 이 줄이 없으면 🔴 직격이 "4.2m 밖에서 시작"으로 잘못 계산됩니다 —
         * 실제로는 구르며 넘기고 그 자리에 있습니다.
         */
        const back = answer === 'distance' ? Math.max(0, safeDist - punishDist) : 0
        const returnT = back / speed
        const openingT = openingOf(atk)
        const slack = openingT - returnT - step.windup
        rows.push({
          enemy: cfg.id,
          attackId: atk.id,
          index,
          intent: atk.intent,
          answer,
          weapon: w.id,
          safeDist: round(safeDist),
          punishDist: round(punishDist),
          returnT: round(returnT),
          windupT: step.windup,
          openingT: round(openingT),
          slack: round(slack),
          ok: slack >= 0,
        })
      }
    })
  }
  return rows
}

/** 예고 동안 옆으로 빠질 수 있는지 — 가장 먼 선택 거리에서. */
export function sidestepTable(): SidestepRow[] {
  const rows: SidestepRow[] = []
  for (const kind of KINDS) {
    const cfg = enemyDef(kind)
    for (const atk of attacksFor(kind)) {
      const atDist = Math.max(0.5, Math.min(atk.maxRange, atk.reach))
      /** 예고 중 회전은 평소의 30% 로 묶여 있습니다(enemyAI). */
      const chase = cfg.turnSpeedDeg * 0.3
      const mine = (PLAYER.moveSpeed / atDist) * RAD2DEG
      const gain = mine - chase
      /** 부채꼴 반각 + 내 몸 굵기가 차지하는 각도(판정이 굵기를 더해 줍니다). */
      const needDeg = atk.arcDeg / 2 + Math.atan2(PLAYER.radius, atDist) * RAD2DEG
      const needSec = gain > 0 ? needDeg / gain : Infinity
      rows.push({
        enemy: cfg.id,
        attackId: atk.id,
        atDist: round(atDist),
        gainDegPerSec: round(gain),
        needSec: Number.isFinite(needSec) ? round(needSec) : Infinity,
        haveSec: atk.windup,
        ok: needSec <= atk.windup,
      })
    }
  }
  return rows
}

function round(n: number): number {
  return Number(n.toFixed(3))
}
