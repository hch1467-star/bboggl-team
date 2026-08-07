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
 * ── 공격 토큰 (다대일 전투의 핵심 장치) ──────────────────────────
 *
 * 플레이 테스트 피드백: **"여러 명이 겹쳤을 때 피하기가 쉽지 않다."**
 *
 * 측정부터 했습니다. 잡몹 5마리에 포위된 상태로 20초를 재보니:
 *   동시 예고 0개 54% · 1개 14% · 2개 9% · **3개 이상 23%** · 최대 5개
 *   광역(260°)이 **둘 동시에** 뜨는 순간도 있었고, 그때는 가만히 서 있는 것과
 *   피하려 애쓰는 것의 결과가 같았습니다(체력 100 -> 5).
 *
 * 여기서 중요한 판단이 갈립니다. 처음 떠오르는 처방 두 가지는 둘 다 틀렸습니다:
 *
 *   · **무적 프레임을 늘린다** → 구르기가 만능 정답이 되어 **4색이 1색으로 붕괴**합니다.
 *     노랑의 존재 이유가 "굴러선 못 빠져나온다"인데 그걸 없애는 셈입니다.
 *     (게다가 지금도 0.42초 중 0.24초가 무적입니다 — 이미 관대한 편입니다.)
 *   · **공격 범위를 줄인다** → 셋이 동시에 걸면 **각자가 아무리 작아도**
 *     도망칠 방향의 합집합이 사라집니다. 크기는 원인이 아닙니다.
 *
 * 원인은 **동시성**이고, 그러면 고칠 것도 동시성입니다.
 * 소울라이크 · 아캄 · 헤일로가 전부 쓰는 방식이 이것입니다: 무리 전체가 공유하는
 * **공격 권한(토큰)** 을 두고, 토큰을 쥔 소수만 커밋합니다. 나머지는 노려보며 기다립니다.
 *
 * 이게 난이도를 낮추는 장치가 아니라는 점이 중요합니다. 적은 여전히 다 살아 있고
 * 포위도 그대로입니다. 바뀌는 것은 **읽을 수 있게 된다**는 것뿐입니다.
 * DESIGN.md 기둥 2의 판단 기준 — "내가 못 봤네"가 아니라 "내가 못 피했네" — 그대로입니다.
 */

/** 동시에 공격을 걸 수 있는 적의 수. */
export const MAX_CONCURRENT_ATTACKERS = 2

/**
 * 그중 광역(180° 이상)은 **한 번에 하나뿐**입니다.
 * 260°짜리 둘이 겹치면 남는 방향이 물리적으로 없어서, 개수 제한만으론 부족합니다.
 */
export const MAX_CONCURRENT_WIDE = 1

/**
 * 한 마리가 공격을 건 뒤 다음 마리가 걸 수 있을 때까지의 간격(초).
 *
 * 개수만 제한하면 둘이 **똑같은 순간에** 시작해서, 예고도 판정도 완전히 겹칩니다.
 * 그러면 2개가 사실상 1개의 커다란 공격이 되어 제한한 의미가 없습니다.
 * 어긋나게 들어와야 "하나 피하고 다음 하나 피하는" 리듬이 생깁니다.
 */
export const ATTACK_COMMIT_GAP = 0.4

/** 이 각도 이상이면 광역으로 셉니다. */
export const WIDE_ARC_DEG = 180

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
    /**
     * 노랑은 **예고가 길고 범위가 넓습니다.** 그래서 구르기(4.2m)로도 안쪽에 남고,
     * 대신 예고가 길어 걸어서 나갈 시간이 충분합니다. 정답이 하나로 좁혀집니다.
     *
     * ── 260° -> 200° 로 줄인 이유 (반경이 아니라 각도를 줄였습니다) ──
     * 플레이 테스트: "여러 명이 겹쳤을 때 피하기가 쉽지 않다."
     * 여기서 **반경**(4.6m)을 줄이는 선택은 하지 않았습니다. 구르기가 4.2m이므로
     * 반경을 4.2 아래로 내리면 굴러서 빠져나갈 수 있게 되고, 그러면 노랑이
     * 빨강과 같아져 **4색이 3색으로 줄어듭니다.**
     *
     * 대신 각도를 줄였습니다. 260°는 안전한 방향이 100°뿐이라 사실상 "운"이지만,
     * 200°면 등 뒤로 160°가 열립니다. 즉 정답이 "멀리 도망가기"가 아니라
     * **"돌아서 뒤로 가기"** 가 됩니다 — 기둥 3(포지셔닝이 보상받는다)과 같은 답입니다.
     * 크기를 깎아 쉽게 만든 것이 아니라, **답이 있는 모양으로 바꾼 것**입니다.
     */
    id: 'grunt_sweep',
    intent: AttackIntent.Sweep,
    windup: 1.0,
    active: 0.18,
    recovery: 0.85,
    reach: 4.6,
    arcDeg: 200,
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
  /**
   * 가중치 덮어쓰기(패턴 id → 가중치). 보스 페이즈가 이걸로 "이 구간에서는
   * 파랑이 자주 나온다" 같은 성격을 만듭니다. 패턴 정의를 복제하지 않고
   * 가중치만 갈아 끼우는 이유: 같은 패턴을 두 벌 두면 예고 도형·소리·판정을
   * 전부 두 번 관리해야 하고, 한쪽만 고쳐서 어긋나기 시작합니다.
   */
  weights?: Record<string, number>,
): EnemyAttackDef | null {
  const weightOf = (a: EnemyAttackDef): number => weights?.[a.id] ?? a.weight
  let total = 0
  for (const a of attacks) {
    if (dist >= a.minRange && dist <= a.maxRange) total += weightOf(a)
  }
  if (total <= 0) return null
  let roll = rand * total
  for (const a of attacks) {
    if (dist < a.minRange || dist > a.maxRange) continue
    roll -= weightOf(a)
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
