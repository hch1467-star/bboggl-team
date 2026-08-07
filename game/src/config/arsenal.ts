/**
 * 무기와 스킬 데이터.
 *
 * ── 왜 "직업"이 아니라 "무기"인가 (DESIGN.md 기둥과 직결된 결정) ─────────────
 *
 * 조사한 두 방식의 실제 구조:
 *   · 로스트아크 = 직업제. 직업을 고르면 스킬 풀이 고정되고, 트라이포드로 각 스킬을
 *     변형합니다(피해·쿨다운·사거리·심지어 발동 방식까지 바뀜).
 *   · No Rest for the Wicked = 무기제. "룬"이 무기에 꽂혀 액티브 스킬 전체를 결정합니다.
 *     룬을 뽑아 다른 무기에 옮길 수 있어, 같은 클레이모어가 화염 무기도 되고
 *     단검이 번개 무기도 됩니다.
 *
 * 우리 선택은 **무기제**입니다. 이유는 취향이 아니라 우리 설계에서 강제됩니다:
 *
 *  1) 기둥 4 — 보물은 손으로 숨깁니다. 그런데 **직업제에서는 발견한 보물이
 *     플레이를 못 바꿉니다.** 다른 직업 스킬을 줄 수 없으니 결국 "공격력 +5%"가
 *     되는데, 그건 우리가 명시적으로 버린 성장 방식입니다.
 *     무기제에서는 "찾은 무기 = 새 플레이 방식"이 그대로 성립합니다.
 *  2) 1인 개발 비용 — 직업 1개 추가 = 그 직업을 고른 사람만 쓰는 8스킬 세트.
 *     무기 1개 추가 = **모든 플레이어가 쓸 수 있는** 새 플레이 방식.
 *  3) 밸런스 — 조사에 따르면 완전 자유 조합(클래스리스)은 조합 폭발로
 *     1인 개발자가 감당하기 어렵습니다. 그래서 **절충**합니다(아래).
 *
 * ── 구조: 무기 2슬롯 고정 + 룬 2슬롯 자유 ────────────────────────────────
 *
 *   Q, E  ← 무기 전용 스킬 (무기를 바꿔야 바뀜)      = 정체성, 밸런스 기준선
 *   R, F  ← 룬 스킬 (아무 무기에나 장착)             = 탐험 보상, 자유도
 *
 * 무기 전용 슬롯이 고정이라 "무기별 기본 골격"은 무기 수만큼만 검증하면 되고,
 * 자유 슬롯을 2개로 묶어 조합 폭발을 막습니다.
 * (조사 결론: "클래스 틀 + 스킬 특화"의 절충안이 1인 개발에 가장 현실적)
 *
 * ── 자원: 스킬은 오직 쿨다운 ───────────────────────────────────────────
 * DESIGN.md 기둥 1 그대로입니다. 스킬에 스태미나를 물리면 "스킬 쓰면 회피 못 함"이
 * 되어 로아식 시원함이 죽습니다. 스태미나는 기본공격·회피 전용으로 남깁니다.
 */

export type SkillShape = 'cone' | 'circle' | 'point'

export interface SkillDef {
  id: string
  name: string
  /** 스킬 발동 도형 */
  shape: SkillShape
  /** cone = 사거리 / circle = 자기 중심 반경 / point = 착탄 반경 */
  range: number
  /** cone 전용 */
  arcDeg: number
  /** point 전용 — 커서를 이 거리까지만 지정할 수 있습니다 */
  castRange: number

  cooldown: number
  /** 선행동작 → 판정 → 후딜 (기본 공격과 같은 3단 구조) */
  windup: number
  active: number
  recovery: number
  /** 시전 중 이동 속도 배율 */
  moveScale: number

  damage: number
  /** 다단히트 횟수. active 구간을 균등 분할해 때립니다. */
  hits: number
  knockback: number
  hitstop: number
  trauma: number

  /** 시전과 함께 전방으로 미끄러지는 거리(m) */
  dash: number
  /** 대시 중 무적 구간 [시작, 끝] — 시전 시작 기준 초. 없으면 무적 없음. */
  iFrames?: [number, number]
  /** 자가 회복량 */
  healSelf: number

  /** 예고/이펙트 색 */
  color: number
  desc: string
}

function skill(def: Partial<SkillDef> & Pick<SkillDef, 'id' | 'name' | 'desc'>): SkillDef {
  return {
    shape: 'cone',
    range: 2.5,
    arcDeg: 100,
    castRange: 9,
    cooldown: 8,
    windup: 0.2,
    active: 0.1,
    recovery: 0.3,
    moveScale: 0.1,
    damage: 20,
    hits: 1,
    knockback: 2,
    hitstop: 0.08,
    trauma: 0.35,
    dash: 0,
    healSelf: 0,
    color: 0xbfe0ff,
    ...def,
  }
}

export const SKILLS: Record<string, SkillDef> = {
  // ── 롱소드 전용 ─────────────────────────────────────────────
  lunge_slash: skill({
    id: 'lunge_slash',
    name: '돌진 베기',
    desc: '앞으로 파고들며 벤다. 거리를 좁히는 용도.',
    shape: 'cone',
    range: 3.0,
    arcDeg: 90,
    cooldown: 6,
    windup: 0.16,
    active: 0.1,
    recovery: 0.26,
    damage: 28,
    knockback: 3.2,
    dash: 4.2,
    hitstop: 0.09,
    trauma: 0.4,
    color: 0x9fd2ff,
  }),
  whirlwind: skill({
    id: 'whirlwind',
    name: '회전 베기',
    desc: '주변을 한 바퀴 쓸어 밀어낸다. 포위를 풀 때.',
    shape: 'circle',
    range: 3.4,
    cooldown: 9,
    windup: 0.24,
    active: 0.34,
    recovery: 0.4,
    damage: 16,
    hits: 2,
    knockback: 5.5,
    hitstop: 0.06,
    trauma: 0.45,
    moveScale: 0.35,
    color: 0xcfe8ff,
  }),

  // ── 대검 전용 ──────────────────────────────────────────────
  earthshatter: skill({
    id: 'earthshatter',
    name: '대지 강타',
    desc: '지정한 곳을 내리찍는다. 느리지만 한 방이 크다.',
    shape: 'point',
    range: 3.0,
    castRange: 8,
    cooldown: 11,
    windup: 0.62, // 길게 — 지점 예고를 보고 적이 나올 시간을 주는 것이 로아식 장판의 문법
    active: 0.12,
    recovery: 0.6,
    damage: 58,
    knockback: 7,
    hitstop: 0.14,
    trauma: 0.75,
    moveScale: 0,
    color: 0xffb648,
  }),
  wide_cleave: skill({
    id: 'wide_cleave',
    name: '광폭 휘두르기',
    desc: '앞을 넓게 세 번 훑는다.',
    shape: 'cone',
    range: 3.8,
    arcDeg: 175,
    cooldown: 13,
    windup: 0.34,
    active: 0.36,
    recovery: 0.55,
    damage: 19,
    hits: 3,
    knockback: 3.4,
    hitstop: 0.07,
    trauma: 0.4,
    moveScale: 0.05,
    color: 0xffcf7a,
  }),

  // ── 쌍단검 전용 ────────────────────────────────────────────
  shadow_step: skill({
    id: 'shadow_step',
    name: '그림자 도약',
    desc: '적을 뚫고 지나가며 벤다. 이동 중 무적. 등 뒤를 잡는 기술.',
    shape: 'cone',
    range: 3.2,
    arcDeg: 120,
    cooldown: 7,
    windup: 0.08,
    active: 0.1,
    recovery: 0.22,
    damage: 22,
    knockback: 1.2,
    dash: 6.2,
    // 시전 거의 직후부터 대시가 끝날 때까지 무적 — 이게 "뚫고 지나간다"의 정체입니다.
    iFrames: [0.04, 0.3],
    hitstop: 0.07,
    trauma: 0.3,
    color: 0xa78bfa,
  }),
  flurry: skill({
    id: 'flurry',
    name: '연속 찌르기',
    desc: '좁은 범위를 다섯 번 찌른다. 단일 대상에 강하다.',
    shape: 'cone',
    range: 2.6,
    arcDeg: 55,
    cooldown: 8,
    windup: 0.14,
    active: 0.45,
    recovery: 0.3,
    damage: 10,
    hits: 5,
    knockback: 0.5,
    hitstop: 0.035,
    trauma: 0.16,
    moveScale: 0.3,
    color: 0xc4b5fd,
  }),

  // ── 룬 (모든 무기 공용, 탐험으로 획득) ──────────────────────
  rune_flame: skill({
    id: 'rune_flame',
    name: '화염 폭발',
    desc: '지정한 곳을 태운다.',
    shape: 'point',
    range: 2.8,
    castRange: 9,
    cooldown: 12,
    windup: 0.45,
    active: 0.12,
    recovery: 0.35,
    damage: 42,
    knockback: 3,
    hitstop: 0.1,
    trauma: 0.5,
    moveScale: 0.15,
    color: 0xff7a3c,
  }),
  rune_shock: skill({
    id: 'rune_shock',
    name: '충격파',
    desc: '주변을 강하게 밀어낸다. 피해는 작지만 판을 정리한다.',
    shape: 'circle',
    range: 5.0,
    cooldown: 10,
    windup: 0.3,
    active: 0.1,
    recovery: 0.32,
    damage: 14,
    knockback: 9.5,
    hitstop: 0.08,
    trauma: 0.55,
    moveScale: 0.1,
    color: 0x5fd0ff,
  }),
  rune_pierce: skill({
    id: 'rune_pierce',
    name: '관통 창',
    desc: '좁고 길게 꿰뚫는다. 일렬로 선 적을 한 번에.',
    shape: 'cone',
    range: 8.5,
    arcDeg: 22,
    cooldown: 9,
    windup: 0.3,
    active: 0.14,
    recovery: 0.34,
    damage: 34,
    hits: 2,
    knockback: 2,
    hitstop: 0.09,
    trauma: 0.35,
    moveScale: 0.05,
    color: 0x8bf5c4,
  }),
  rune_mend: skill({
    id: 'rune_mend',
    name: '치유의 룬',
    desc: '체력을 회복한다. 공격 슬롯 하나를 포기하는 선택.',
    shape: 'circle',
    range: 0.1,
    cooldown: 26,
    windup: 0.5,
    active: 0.05,
    recovery: 0.4,
    damage: 0,
    knockback: 0,
    healSelf: 38,
    hitstop: 0,
    trauma: 0,
    moveScale: 0.1,
    color: 0x7ef2a5,
  }),
}

/** 탐험으로 얻는 순서. 보물을 먹을 때마다 이 순서대로 하나씩 해금됩니다. */
export const RUNE_ORDER = ['rune_shock', 'rune_flame', 'rune_pierce', 'rune_mend'] as const

export interface ComboStep {
  name: string
  windup: number
  active: number
  recovery: number
  damage: number
  range: number
  arcDeg: number
  staminaCost: number
  hitstop: number
  trauma: number
  lunge: number
  knockback: number
}

export interface WeaponDef {
  id: string
  name: string
  desc: string
  /** 이 무기를 들었을 때의 이동 속도 배율 */
  moveSpeedScale: number
  /** 공격 중 이동 속도 배율 — 무거운 무기일수록 발이 묶입니다 */
  attackMoveScale: number
  comboWindow: number
  combo: ComboStep[]
  /** Q, E 슬롯에 들어가는 전용 스킬 */
  skills: [string, string]
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'longsword',
    name: '롱소드',
    desc: '균형형. 3타 콤보. 무엇을 해도 무난하다.',
    moveSpeedScale: 1,
    attackMoveScale: 0.12,
    comboWindow: 0.42,
    skills: ['lunge_slash', 'whirlwind'],
    combo: [
      { name: '1타', windup: 0.12, active: 0.08, recovery: 0.2, damage: 12, range: 2.3, arcDeg: 110, staminaCost: 11, hitstop: 0.055, trauma: 0.22, lunge: 1.5, knockback: 1.6 },
      { name: '2타', windup: 0.1, active: 0.08, recovery: 0.22, damage: 14, range: 2.3, arcDeg: 120, staminaCost: 12, hitstop: 0.06, trauma: 0.26, lunge: 1.7, knockback: 1.8 },
      { name: '3타(마무리)', windup: 0.22, active: 0.1, recovery: 0.42, damage: 27, range: 2.7, arcDeg: 150, staminaCost: 20, hitstop: 0.11, trauma: 0.5, lunge: 2.4, knockback: 4.2 },
    ],
  },
  {
    id: 'greatsword',
    name: '대검',
    desc: '느리고 무겁다. 2타뿐이지만 한 대가 크고 사거리가 길다.',
    moveSpeedScale: 0.86,
    // 대검은 휘두르는 순간 거의 못 움직입니다. 이 수치 하나가 "무겁다"를 만듭니다.
    attackMoveScale: 0.04,
    comboWindow: 0.55,
    skills: ['earthshatter', 'wide_cleave'],
    combo: [
      { name: '1타', windup: 0.26, active: 0.11, recovery: 0.34, damage: 26, range: 3.1, arcDeg: 130, staminaCost: 18, hitstop: 0.09, trauma: 0.4, lunge: 1.6, knockback: 3.4 },
      { name: '2타(마무리)', windup: 0.36, active: 0.13, recovery: 0.6, damage: 46, range: 3.5, arcDeg: 165, staminaCost: 30, hitstop: 0.15, trauma: 0.7, lunge: 2.2, knockback: 7.5 },
    ],
  },
  {
    id: 'daggers',
    name: '쌍단검',
    desc: '빠르고 약하다. 4타 콤보. 회피로 등 뒤를 잡는 무기.',
    moveSpeedScale: 1.12,
    // 단검은 공격 중에도 꽤 움직입니다 — 치고 빠지는 리듬의 근거.
    attackMoveScale: 0.34,
    comboWindow: 0.36,
    skills: ['shadow_step', 'flurry'],
    combo: [
      { name: '1타', windup: 0.07, active: 0.06, recovery: 0.12, damage: 7, range: 1.9, arcDeg: 95, staminaCost: 6, hitstop: 0.035, trauma: 0.14, lunge: 1.1, knockback: 0.8 },
      { name: '2타', windup: 0.06, active: 0.06, recovery: 0.12, damage: 8, range: 1.9, arcDeg: 95, staminaCost: 6, hitstop: 0.035, trauma: 0.15, lunge: 1.1, knockback: 0.8 },
      { name: '3타', windup: 0.07, active: 0.06, recovery: 0.14, damage: 9, range: 2.0, arcDeg: 105, staminaCost: 7, hitstop: 0.04, trauma: 0.18, lunge: 1.3, knockback: 1 },
      { name: '4타(마무리)', windup: 0.13, active: 0.08, recovery: 0.3, damage: 18, range: 2.3, arcDeg: 130, staminaCost: 13, hitstop: 0.08, trauma: 0.36, lunge: 2.0, knockback: 3 },
    ],
  },
]

export function weaponAt(index: number): WeaponDef {
  return WEAPONS[Math.min(Math.max(index, 0), WEAPONS.length - 1)]
}

/** 슬롯 4개의 표시용 키. WASD와 겹치지 않게 고른 배치입니다. */
export const SKILL_KEYS = ['Q', 'E', 'R', 'F'] as const
export const SKILL_KEY_CODES = ['KeyQ', 'KeyE', 'KeyR', 'KeyF'] as const
