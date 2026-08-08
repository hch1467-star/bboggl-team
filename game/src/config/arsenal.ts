import { FINISHER, FOCUS } from './balance'

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
 *   Q, E, R  ← 무기 전용 스킬 (무기를 바꿔야 바뀜)     = 정체성, 밸런스 기준선
 *   F, G     ← 룬 스킬 (아무 무기에나 장착)            = 탐험 보상, 자유도
 *
 * 무기 전용 슬롯이 고정이라 "무기별 기본 골격"은 무기 수만큼만 검증하면 되고,
 * 자유 슬롯을 2개로 묶어 조합 폭발을 막습니다.
 * (조사 결론: "클래스 틀 + 스킬 특화"의 절충안이 1인 개발에 가장 현실적)
 *
 * ── 왜 무기 스킬을 2개에서 3개로 늘렸는가 ──────────────────────────────
 * 2개는 **선택이 아니라 순서**였습니다. 둘 다 쿨마다 쓰는 게 언제나 최적이라
 * "무엇을 쓸까"라는 판단이 발생하지 않았습니다. 3개가 되면 상황에 따라
 * 하나를 아껴야 하고, 그때 비로소 판단이 생깁니다.
 *
 * 그리고 세 번째는 **그 무기가 못 하던 것**을 맡습니다. 셋 다 공격기면
 * 숫자만 늘어난 것이지 플레이가 넓어지지 않습니다.
 *   롱소드 → 원거리(검기 발사)    · 붙지 못할 때 할 게 없던 문제
 *   대검   → 기동력(도약 강타)    · 적이 빠지면 아무것도 못 하던 문제
 *   쌍단검 → 속박(발목 긋기)      · 등 뒤를 잡을 시간을 스스로 만들지 못하던 문제
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
  /** 맞은 대상을 묶는 시간(초). 적이 쓰는 파랑 공격과 같은 규칙입니다. */
  snare: number

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
    snare: 0,
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

  blade_wave: skill({
    id: 'blade_wave',
    name: '검기 발사',
    /**
     * 롱소드의 **세 번째 다리**: 원거리.
     *
     * 세 번째 스킬을 고를 때 기준은 "더 센 것"이 아니라 **"이 무기가 못 하던 것"** 입니다.
     * 롱소드는 파고들기(돌진 베기)와 광역(회전 베기)은 있는데, 붙지 못하는 상황에
     * 할 수 있는 게 아무것도 없었습니다. 그래서 붙지 않고 때리는 수단을 줍니다.
     * 좁은 각도(28°)로 둔 이유: 넓으면 이게 최적해가 되어 나머지 둘을 밀어냅니다.
     * 겨눠야 맞는다 = 원거리를 주되 공짜로는 주지 않는다.
     */
    desc: '앞으로 검기를 날린다. 붙지 않고 때리는 유일한 수단.',
    shape: 'cone',
    range: 7.4,
    arcDeg: 28,
    cooldown: 10,
    windup: 0.28,
    active: 0.12,
    recovery: 0.34,
    damage: 30,
    knockback: 2.4,
    hitstop: 0.07,
    trauma: 0.32,
    moveScale: 0.08,
    color: 0x8fe3ff,
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

  leap_slam: skill({
    id: 'leap_slam',
    name: '도약 강타',
    /**
     * 대검의 **세 번째 다리**: 기동력.
     *
     * 대검의 약점은 명확합니다 — 이동 0.86배, 공격 중 0.04배로 사실상 못 움직입니다.
     * 그래서 적이 빠지면 아무것도 못 합니다. 이 스킬 하나가 그 약점을 **정확히**
     * 메웁니다: 뛰어가서 찍는다.
     *
     * 원형 판정 + 대시로 만든 이유는 그림자 도약과 같습니다 — 빠르게 이동하는
     * 동안의 부채꼴 판정은 프레임률에 따라 빗나갑니다(arsenal.ts shadow_step 주석 참고).
     * 무적은 주지 않습니다. 무적까지 붙으면 "느리고 무겁다"는 대검의 정체성이 사라집니다.
     */
    desc: '겨눈 곳으로 뛰어들며 내려찍는다. 붙지 못하던 약점을 메운다.',
    shape: 'circle',
    range: 3.2,
    cooldown: 14,
    windup: 0.3,
    active: 0.14,
    recovery: 0.62,
    damage: 48,
    knockback: 6,
    dash: 6.5,
    hitstop: 0.13,
    trauma: 0.7,
    moveScale: 0,
    color: 0xffa93c,
  }),

  // ── 쌍단검 전용 ────────────────────────────────────────────
  shadow_step: skill({
    id: 'shadow_step',
    name: '그림자 도약',
    desc: '적을 뚫고 지나가며 벤다. 이동 중 무적. 등 뒤를 잡는 기술.',
    /**
     * **원형** 판정입니다. 부채꼴이 아닙니다 — 자동 검증에서 잡은 프레임레이트 버그:
     *
     *   부채꼴은 시전자 "앞"만 때립니다. 그런데 대시는 초당 29m로 움직이므로,
     *   30fps 이하에서는 판정 프레임이 오기 전에 이미 적을 지나쳐 있어서
     *   부채꼴이 허공을 향합니다. 60fps에서는 맞고 30fps에서는 안 맞는,
     *   가장 나쁜 종류의 버그입니다.
     *   원형으로 바꾸면 "지나가는 길에 스친 것"을 때리므로 프레임과 무관합니다.
     *
     * 이 스킬 자체는 백어택 보너스를 받지 않습니다(광역 판정이므로).
     * 이건 **밑작업**이고, 보상은 착지 후 이어지는 기본 공격에서 나옵니다.
     */
    shape: 'circle',
    range: 2.4,
    cooldown: 7,
    /**
     * 이 네 숫자(windup / active / recovery / dash)는 함께 맞춰야 의미가 있습니다.
     * 자동 검증에서 실제로 잡은 설계 결함:
     *
     *   처음엔 dash 6.2m 였는데, 사거리 2.6m 밖에서 발동하면 **적을 4m 가까이
     *   지나쳐 착지**해서 단검(사거리 1.9~2.3m)이 전혀 닿지 않았습니다.
     *   "뚫고 지나가 등 뒤를 친다"는 이 스킬의 존재 이유가 성립하지 않았습니다.
     *
     * 그래서 이렇게 맞췄습니다:
     *  · dash 4.0m  — 사거리(약 2.4m)에서 쓰면 적 뒤 약 1.6m 에 착지 → 바로 닿음
     *  · windup 0.04 — 판정이 대시 **초반**에 터져야 적이 아직 앞에 있습니다.
     *    (늦게 터지면 이미 지나쳐서 부채꼴이 허공을 향합니다)
     *  · recovery 0.14 — 이 스킬이 맞히면 적이 0.22초 경직됩니다. 그 사이에
     *    후딜을 끝내고 후속타를 넣어야 등 뒤가 유지됩니다. 후딜이 길면
     *    적이 돌아서서 백어택 창이 닫힙니다.
     */
    windup: 0.04,
    active: 0.1,
    recovery: 0.14,
    damage: 22,
    knockback: 1.2,
    dash: 3.6,
    // 시전 직후부터 대시가 끝난 뒤까지 무적 — 이게 "뚫고 지나간다"의 정체입니다.
    iFrames: [0.02, 0.3],
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

  hamstring: skill({
    id: 'hamstring',
    name: '발목 긋기',
    /**
     * 쌍단검의 **세 번째 다리**: 상대를 묶는다.
     *
     * 이 스킬만 유일하게 "피해를 주는 것"이 목적이 아닙니다. 12뎀은 기본 콤보
     * 1타(7)보다 조금 나은 수준입니다. 존재 이유는 **속박**입니다.
     *
     * 왜 하필 단검인가 — 기둥 3(포지셔닝이 보상받는다)과 정확히 맞물리기 때문입니다.
     * 적을 묶으면 회전 속도까지 떨어져서 **등 뒤를 잡을 시간이 길어집니다.**
     * 즉 이 스킬은 그 자체로 강한 게 아니라, **다음 백어택을 성립시키는 밑작업**입니다.
     * "묶고 → 돌아가고 → 등을 친다"는 세 동작이 하나의 문장이 됩니다.
     *
     * 그리고 이건 적이 플레이어에게 쓰는 파랑(속박)과 **같은 규칙**입니다.
     * 적이 나에게 쓰는 수단을 나도 쓴다 = 공정합니다(combat.ts 설계 노트).
     */
    desc: '다리를 그어 묶는다. 피해는 작지만 등 뒤를 잡을 시간을 만든다.',
    shape: 'cone',
    range: 2.5,
    arcDeg: 120,
    cooldown: 9,
    windup: 0.1,
    active: 0.08,
    recovery: 0.22,
    damage: 12,
    knockback: 0.4,
    snare: 1.8,
    hitstop: 0.05,
    trauma: 0.2,
    moveScale: 0.3,
    color: 0x67e8f9,
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

/**
 * 강타(集中 소모) 한 방의 제원.
 *
 * 무기마다 따로 정의하지 않고 **콤보 마무리에서 파생**시킵니다.
 * 무기가 셋인데 강타를 따로 적으면 세 벌을 따로 관리하게 되고, 대검만
 * 고치고 단검을 빠뜨리는 날이 옵니다. 파생시키면 무기의 성격(대검은 넓고
 * 느리게, 단검은 좁고 빠르게)이 강타에도 저절로 따라옵니다.
 */
export function heavyStep(weapon: WeaponDef, focusSpent: number): ComboStep {
  const last = weapon.combo[weapon.combo.length - 1]
  const h = FOCUS.heavy
  return {
    name: '강타',
    windup: h.windup,
    active: h.active,
    recovery: h.recovery,
    damage: last.damage * (1 + focusSpent * FOCUS.damagePerPoint),
    range: last.range * h.rangeMult,
    arcDeg: last.arcDeg + h.arcAdd,
    staminaCost: h.staminaCost,
    hitstop: h.hitstop,
    trauma: h.trauma,
    lunge: h.lunge,
    knockback: h.knockback,
  }
}

/** Actor.comboIndex 에 넣는 강타 표식. 콤보 길이(최대 4)와 절대 안 겹칩니다. */
export const HEAVY_COMBO = 250

/**
 * 처형 — 무방비인 적에게만 나가는 한 방.
 *
 * 강타(heavyStep)와 **같은 방식**으로 콤보 마무리에서 파생시킵니다.
 * 무기별 수치를 따로 적지 않는 이유가 여기 있습니다: 마무리 타가 이미
 * 그 무기의 정체성(느림·묵직함 vs 빠름·가벼움)을 담고 있으므로,
 * 처형도 그 성격을 그대로 물려받아야 무기를 바꾼 티가 납니다.
 */
export function finisherStep(weapon: WeaponDef): ComboStep {
  const last = weapon.combo[weapon.combo.length - 1]
  return {
    name: '처형',
    windup: FINISHER.windup,
    active: FINISHER.active,
    recovery: FINISHER.recovery,
    damage: last.damage * FINISHER.damageMultiplier,
    range: FINISHER.reach,
    arcDeg: FINISHER.arcDeg,
    staminaCost: FINISHER.staminaCost,
    hitstop: FINISHER.hitstop,
    trauma: FINISHER.trauma,
    lunge: FINISHER.lunge,
    knockback: FINISHER.knockback,
  }
}

/** Actor.comboIndex 에 넣는 처형 표식. */
export const FINISH_COMBO = 251

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
  /** Q, E, R 슬롯에 들어가는 전용 스킬 */
  skills: [string, string, string]
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'longsword',
    name: '롱소드',
    desc: '균형형. 3타 콤보. 무엇을 해도 무난하다.',
    moveSpeedScale: 1,
    attackMoveScale: 0.12,
    comboWindow: 0.42,
    skills: ['lunge_slash', 'whirlwind', 'blade_wave'],
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
    skills: ['earthshatter', 'wide_cleave', 'leap_slam'],
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
    skills: ['shadow_step', 'flurry', 'hamstring'],
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

/**
 * 슬롯 5개의 표시용 키. WASD와 겹치지 않고 **왼손을 떼지 않고 닿는** 범위입니다.
 *   Q E R  = 무기 스킬 3개   ·   F G = 룬 2개
 * 룬 교체는 Tab(F슬롯) / C(G슬롯) — G가 스킬 키가 되면서 옮겼습니다.
 */
export const SKILL_KEYS = ['Q', 'E', 'R', 'F', 'G'] as const
export const SKILL_KEY_CODES = ['KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyG'] as const
