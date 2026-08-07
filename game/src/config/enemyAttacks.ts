/**
 * 적 공격 패턴 — 4색 예고 (DESIGN.md 기둥 2 「바닥을 읽는 전투」).
 *
 * ── 왜 색을 나누는가 ──────────────────────────────────────────────
 * 예고 도형이 전부 같은 색이면, 플레이어가 읽을 수 있는 정보는 **"어디"** 하나뿐입니다.
 * 그러면 대응도 하나뿐입니다 — "범위 밖으로". 결국 모든 전투가 백스텝 반복이 됩니다.
 *
 * 색을 나누면 **"어떻게"** 가 추가됩니다. 같은 자리에 뜬 같은 부채꼴이라도
 * 빨강이면 굴러야 하고 노랑이면 걸어 나가면 됩니다. 이 한 겹이 붙는 순간
 * 전투가 "피하기"에서 **"판단하기"** 로 바뀝니다. 로스트아크에서 우리가 가져오려던
 * 것이 정확히 이것입니다 — 파밍이 아니라 **전투의 구성**.
 *
 * ── 색은 반드시 "다른 대응"을 요구해야 합니다 ─────────────────────
 * 색만 다르고 대응이 같으면 색은 장식입니다. 그래서 네 색에 **서로 다른 정답**을
 * 강제로 심었습니다. 아래 표의 마지막 칸이 그 근거입니다.
 *
 * | 색 | 공격 성격 | 정답 | 왜 그 정답만 통하는가 |
 * |---|---|---|---|
 * | 🔴 빨강 | 빠르고 좁음 | 회피 구르기 | 예고가 짧아 걸어서는 못 빠져나갑니다 |
 * | 🟡 노랑 | 느리고 아주 넓음 | 걸어서 이탈 | 범위가 넓어 굴러도 안쪽에 남습니다. 일찍 걷기 시작해야 합니다 |
 * | 🔵 파랑 | 속박을 겁니다 | 반드시 무적 프레임 | 맞으면 묶여서 **다음 공격을 못 피합니다**. 범위 밖으로는 늦습니다 |
 * | 🟣 보라 | 끌어당깁니다 | 아예 사거리 밖으로 | 뒤로 빠져도 끌려옵니다. 굴러도 착지 후 끌려옵니다 |
 *
 * > 판단 기준(DESIGN.md): 죽었을 때 **"내가 못 봤네"** 가 아니라
 * > **"내가 못 피했네"** 라고 말해야 합니다.
 *
 * ── 막기(방패)를 넣지 않은 이유 ────────────────────────────────────
 * 로스트아크 원본 4색에는 "막기"가 있지만 우리는 뺐습니다. 기둥 1이
 * **스태미나 = 기본기·회피 전용**이라고 못박았기 때문입니다. 막기를 넣으면
 * 스태미나를 또 나눠 써야 하고, "막을까 구를까"가 아니라 "스태미나가 있나"가
 * 판단의 중심이 됩니다. 네 색 모두 **위치와 타이밍**으로만 풀리게 남겼습니다.
 */

/** 공격의 의도 = 요구되는 대응. 예고 색이 곧 이 값입니다. */
export const enum AttackIntent {
  /** 🔴 직격 — 회피 구르기 */
  Strike = 0,
  /** 🟡 광역 — 걸어서 빠져나가기 */
  Sweep = 1,
  /** 🔵 속박 — 반드시 무적 프레임 */
  Snare = 2,
  /** 🟣 강제이동 — 사거리 밖에 있어야 함 */
  Pull = 3,
}

/**
 * 예고 색.
 *
 * 색맹(적록)을 고려해 **밝기와 채도도 함께** 벌려 두었습니다. 색만으로 구분하게
 * 만들면 남성 약 8%가 빨강/노랑을 구분하지 못합니다. 도형의 두께도 다르게 그립니다
 * (visuals.ts) — 색이 안 보여도 굵기로 읽히게 하는 것이 목적입니다.
 */
export const INTENT_COLOR: Record<AttackIntent, number> = {
  [AttackIntent.Strike]: 0xff4530,
  [AttackIntent.Sweep]: 0xffc61e,
  [AttackIntent.Snare]: 0x35a7ff,
  [AttackIntent.Pull]: 0xc061ff,
}

export const INTENT_LABEL: Record<AttackIntent, string> = {
  [AttackIntent.Strike]: '직격 — 구르기',
  [AttackIntent.Sweep]: '광역 — 걸어서 이탈',
  [AttackIntent.Snare]: '속박 — 무적 프레임',
  [AttackIntent.Pull]: '끌어당김 — 거리 두기',
}

export interface EnemyAttackDef {
  id: string
  intent: AttackIntent
  /** 예고 → 판정 → 후딜 */
  windup: number
  active: number
  recovery: number
  /** 부채꼴 사거리(m)와 각도(도) */
  reach: number
  arcDeg: number
  damage: number
  knockback: number
  /** 이 거리 안에 들어와야 이 패턴을 고릅니다 */
  minRange: number
  maxRange: number
  /** 패턴 선택 가중치 — 클수록 자주 나옵니다 */
  weight: number
  /** 🔵 맞으면 걸리는 속박 시간(초). 이동 속도가 SNARE_MOVE_SCALE로 떨어집니다. */
  snare?: number
  /** 🟣 맞으면 적 쪽으로 끌려오는 세기(m/s) */
  pull?: number
}

/** 속박에 걸렸을 때의 이동 속도 배율. 0이면 완전 정지라 너무 가혹합니다. */
export const SNARE_MOVE_SCALE = 0.28

/**
 * 잡몹 — 빨강과 노랑 두 가지만 씁니다.
 *
 * 왜 잡몹에 4색을 다 주지 않는가: 잡몹은 여럿이 동시에 달려듭니다. 네 종류가
 * 겹치면 바닥이 색 잔치가 되어 **읽을 수 없게** 됩니다. 읽히게 하려고 만든 장치가
 * 읽기를 방해하면 본말전도입니다. 잡몹은 두 색으로 "구를까 걸을까"만 묻고,
 * 네 색 전부를 읽는 훈련은 1:1로 붙는 **보스**에서 시킵니다.
 */
export const GRUNT_ATTACKS: EnemyAttackDef[] = [
  {
    id: 'grunt_jab',
    intent: AttackIntent.Strike,
    windup: 0.55,
    active: 0.12,
    recovery: 0.7,
    reach: 2.5,
    arcDeg: 100,
    damage: 14,
    knockback: 2.6,
    minRange: 0,
    maxRange: 2.4,
    weight: 3,
  },
  {
    // 노랑은 **예고가 길고 범위가 넓습니다.** 그래서 구르기(4.2m)로도 안쪽에 남고,
    // 대신 예고가 길어 걸어서 나갈 시간이 충분합니다. 정답이 하나로 좁혀집니다.
    id: 'grunt_sweep',
    intent: AttackIntent.Sweep,
    windup: 1.0,
    active: 0.18,
    recovery: 0.85,
    reach: 4.6,
    arcDeg: 260,
    damage: 11,
    knockback: 3.4,
    minRange: 0,
    maxRange: 4.2,
    weight: 1,
  },
]

/**
 * 보스 — 네 색을 모두 씁니다. 이 존의 보스는 사실상 **4색 훈련장**입니다.
 *
 * 거리에 따라 나오는 패턴이 갈립니다. 이게 중요한 이유: 거리마다 다른 색이
 * 나오면 플레이어가 **"거리를 고르는 것"이 곧 "상대할 패턴을 고르는 것"** 임을
 * 배웁니다. 포지셔닝이 회피가 아니라 선택이 됩니다(기둥 3과 같은 논리).
 */
export const BOSS_ATTACKS: EnemyAttackDef[] = [
  {
    id: 'boss_cleave',
    intent: AttackIntent.Strike,
    windup: 0.78,
    active: 0.16,
    recovery: 1.05,
    reach: 4.2,
    arcDeg: 130,
    damage: 30,
    knockback: 6.5,
    minRange: 0,
    maxRange: 4.0,
    weight: 3,
  },
  {
    id: 'boss_quake',
    intent: AttackIntent.Sweep,
    windup: 1.35,
    active: 0.22,
    recovery: 1.2,
    reach: 7.5,
    arcDeg: 360,
    damage: 22,
    knockback: 5,
    minRange: 0,
    maxRange: 6.5,
    weight: 2,
  },
  {
    // 파랑 — 맞아도 피해는 작습니다. 무서운 건 **1.6초 속박**입니다.
    // 속박 중에 다음 패턴이 들어오면 그건 피할 수 없습니다. 그래서
    // "아프니까 피한다"가 아니라 **"다음이 무서우니 반드시 무적으로 넘긴다"** 가 됩니다.
    id: 'boss_bind',
    intent: AttackIntent.Snare,
    windup: 0.92,
    active: 0.14,
    recovery: 0.8,
    reach: 5.5,
    arcDeg: 80,
    damage: 12,
    knockback: 0,
    minRange: 2.5,
    maxRange: 9,
    weight: 2,
    snare: 1.6,
  },
  {
    // 보라 — 멀리 있을 때만 나옵니다. 끌려온 직후 보스는 후딜 중이라
    // **끌려온 것이 곧 반격 기회**이기도 합니다. 일방적인 처벌이 아닙니다.
    id: 'boss_hook',
    intent: AttackIntent.Pull,
    windup: 1.05,
    active: 0.16,
    recovery: 1.15,
    reach: 11,
    arcDeg: 55,
    damage: 16,
    knockback: 0,
    minRange: 5,
    maxRange: 11,
    weight: 2,
    pull: 15,
  },
]

/**
 * 지금 거리에서 쓸 수 있는 패턴 중 하나를 가중치로 고릅니다.
 * rand는 0~1. 시드 RNG를 넘겨 받아 **재현 가능한** 전투를 만듭니다.
 */
export function pickAttack(
  attacks: EnemyAttackDef[],
  dist: number,
  rand: number,
): EnemyAttackDef | null {
  let total = 0
  for (const a of attacks) {
    if (dist >= a.minRange && dist <= a.maxRange) total += a.weight
  }
  if (total <= 0) return null
  let roll = rand * total
  for (const a of attacks) {
    if (dist < a.minRange || dist > a.maxRange) continue
    roll -= a.weight
    if (roll <= 0) return a
  }
  return null
}

/** 이 적이 쓰는 패턴 목록. EnemyKind 값으로 찾습니다. */
export function attacksFor(isBoss: boolean): EnemyAttackDef[] {
  return isBoss ? BOSS_ATTACKS : GRUNT_ATTACKS
}

/** 패턴을 인덱스로 저장하기 위한 조회 — ECS는 숫자만 담을 수 있습니다. */
export function attackAt(isBoss: boolean, index: number): EnemyAttackDef {
  const list = attacksFor(isBoss)
  return list[Math.min(Math.max(index, 0), list.length - 1)]
}
