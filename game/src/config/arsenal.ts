import { FINISHER, FOCUS, PLAYER } from './balance'

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

/**
 * ── ⚔️ **무기 기예** — 무기마다 자기 kit 에 **없던 동사** 하나씩 ────────
 *
 * 무기 스킬이 셋이었는데, 세 무기 모두 *"때리는 방법"* 세 가지였습니다.
 * 다크 소울 3의 **전투 기술**, 로스트아크의 **각성기**, 몬스터헌터의 무기별
 * 고유 동작이 하는 일은 하나입니다 — **그 무기만 할 수 있는 일**을 줍니다.
 * 그래야 무기를 바꾸는 것이 수치가 아니라 **선택지**가 바뀌는 일이 됩니다.
 *
 * 셋 다 벤치가 찍은 숫자에 답하도록 골랐습니다. 없는 구멍을 메우는 것이지
 * 칸을 채우는 것이 아닙니다.
 */
export const ARTS: Record<string, SkillDef> = {
  /**
   * 🗡 **롱소드 — 투구가르기.**
   *
   * 근거가 된 숫자: `강인도 붕괴 16회 · 처형 8회`. 붕괴는 일어나는데
   * **의도해서 만드는 수단이 없습니다** — 때리다 보면 무너집니다. 그래서
   * 처형(이 게임에서 가장 큰 한 방)이 우연에 가깝습니다.
   *
   * 이 기술은 피해가 아니라 **강인도**를 팝니다(trauma 1.1 — 롱소드 마무리
   * 타의 두 배 이상). *"지금 무너뜨리고 처형한다"* 를 손으로 만들 수 있게
   * 하는 것이 전부입니다. 소울류의 대검 강공격이 하는 역할과 같습니다.
   */
  cleave_helm: skill({
    id: 'cleave_helm',
    name: '투구가르기',
    shape: 'cone',
    range: 2.9,
    arcDeg: 70,
    cooldown: 11,
    // 예고가 깁니다 — 강인도를 파는 대가입니다. 아무 때나 낼 수 없어야 합니다.
    windup: 0.42,
    active: 0.12,
    recovery: 0.5,
    damage: 26,
    knockback: 3,
    hitstop: 0.13,
    // 🔨 이 값이 이 기술의 정체입니다. combat.ts applyPoise 가 trauma 로 강인도를 깎습니다.
    trauma: 1.1,
    color: 0xffd9a0,
    desc: '내리찍어 강인도를 크게 깎는다. 무너뜨리고 처형으로 잇는 기술',
  }),

  /**
   * 🪓 **대검 — 밀쳐내기.**
   *
   * 근거가 된 숫자: `동시 교전 둘 이상인 시간 58% · 최대 7마리`. 그리고
   * 대검은 후딜이 가장 길어(콤보 한 바퀴 1.51초) **둘러싸이면 빠져나올
   * 수단이 없습니다.** 스킬 셋(대지 강타·광폭 휘두르기·도약 강타)이 전부
   * 느린 광역이라 갇힌 상태에서는 셋 다 늦습니다.
   *
   * 그래서 **빠르고(예고 0.14) 약하고(피해 8) 크게 미는(넉백 9)** 기술을
   * 줍니다. 딜이 아니라 **자리**를 버는 기술입니다 — 몬스터헌터 대검의
   * 태클, 소울류의 방패 밀치기가 정확히 이 자리에 있습니다.
   */
  shove: skill({
    id: 'shove',
    name: '밀쳐내기',
    shape: 'cone',
    range: 2.8,
    arcDeg: 150,
    cooldown: 7,
    windup: 0.14,
    active: 0.1,
    recovery: 0.24,
    damage: 8,
    knockback: 9,
    hitstop: 0.05,
    trauma: 0.3,
    moveScale: 0.5,
    color: 0xc9d6ff,
    desc: '크게 밀어내 자리를 만든다. 피해는 낮고 대신 빠르다',
  }),

  /**
   * 🗡🗡 **쌍단검 — 등지기.**
   *
   * 근거가 된 숫자: `백어택 19~24%`. 이 무기의 축이 *"등 뒤를 잡고 오래
   * 붙어 있는 것"* 인데(arsenal 의 dodgeDurationScale 주석), 등을 잡는 것을
   * **손으로 만드는 수단이 없습니다.** 적이 돌아설 때까지 기다릴 뿐입니다.
   *
   * 대시 거리(4.6m)를 사거리(1.8m)보다 크게 잡은 것이 이 기술의 전부입니다 —
   * **지나쳐서 뒤에 섭니다.** 소울류의 백스텝, 세키로의 스텝이 하는 일과
   * 같습니다. 무적을 짧게 붙여 예고를 넘기며 파고들 수 있게 했습니다.
   */
  backstep_cut: skill({
    id: 'backstep_cut',
    name: '등지기',
    shape: 'cone',
    range: 1.8,
    arcDeg: 120,
    cooldown: 9,
    windup: 0.1,
    active: 0.1,
    recovery: 0.26,
    damage: 14,
    hits: 2,
    knockback: 0,
    hitstop: 0.05,
    trauma: 0.2,
    // ⚠️ 사거리(1.8)보다 **크게** — 지나쳐야 등 뒤에 섭니다.
    dash: 4.6,
    iFrames: [0.02, 0.18],
    color: 0xb9a7ff,
    desc: '지나치며 벤다. 끝나면 적의 등 뒤에 선다',
  }),
}

export const SKILLS: Record<string, SkillDef> = {
  // ⚔️ 무기 기예 셋 — 위 ARTS 에 근거와 함께 정의돼 있습니다.
  ...ARTS,
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

/**
 * ⚔️ **상황 모션** — 같은 버튼이 상태에 따라 다른 기술이 됩니다.
 *
 * 강타·처형과 **같은 방식**으로 그 무기의 1타에서 파생시킵니다. 무기가
 * 셋인데 상황 모션을 따로 적으면 여섯 벌을 관리하게 되고, 대검만 고치고
 * 단검을 빠뜨리는 날이 옵니다. 파생시키면 무기의 성격(대검은 넓고 느리게,
 * 단검은 좁고 빠르게)이 새 기술에도 저절로 따라옵니다.
 *
 * 근거와 배율은 balance.ts `PLAYER.contextAttack` 주석에 있습니다.
 *
 * ⚠️ **1타에서 파생시킵니다**(마무리가 아니라). 이 둘은 콤보를 **여는**
 *    기술이므로, 마무리 타의 무게를 물려받으면 "달려들면 마무리 한 방"이
 *    되어 콤보를 쌓을 이유가 사라집니다.
 */
function contextStep(
  weapon: WeaponDef,
  name: string,
  m: {
    damageMult: number
    rangeMult: number
    lungeMult: number
    windupMult: number
    recoveryMult: number
    staminaMult: number
    arcAdd: number
  },
): ComboStep {
  const first = weapon.combo[0]
  return {
    name,
    windup: first.windup * m.windupMult,
    active: first.active,
    recovery: first.recovery * m.recoveryMult,
    damage: first.damage * m.damageMult,
    range: first.range * m.rangeMult,
    arcDeg: Math.max(20, first.arcDeg + m.arcAdd),
    staminaCost: Math.round(first.staminaCost * m.staminaMult),
    hitstop: first.hitstop,
    trauma: first.trauma,
    lunge: first.lunge * m.lungeMult,
    knockback: first.knockback,
  }
}

/** 🏃 달리며 치는 한 방 — 거리를 좁히고, 빗나가면 크게 뭅니다. */
export function runningStep(weapon: WeaponDef): ComboStep {
  return contextStep(weapon, '달리기 공격', PLAYER.contextAttack.running)
}

/** 🤸 굴러 넘긴 직후에만 나가는 빠른 한 방 — 갚는 손입니다. */
export function rollingStep(weapon: WeaponDef): ComboStep {
  return contextStep(weapon, '구르기 공격', PLAYER.contextAttack.rolling)
}

/**
 * 🪂 **떨어진 직후의 내려찍기.**
 *
 * ⚠️ **마지막 타에서 파생시킵니다**(1타가 아니라). 달리기·구르기 공격은
 *    콤보를 **여는** 기술이라 1타에서 파생했지만, 이건 그 자체로 **끝내는**
 *    한 방입니다 — 높이를 값과 맞바꾼 결과가 잽이면 아무도 안 뜁니다.
 *
 * 낙하 단수가 배율로 들어옵니다. 근거는 balance.ts `contextAttack.plunge`.
 */
export function plungeStep(weapon: WeaponDef, steps: number): ComboStep {
  const last = weapon.combo[weapon.combo.length - 1]
  const m = PLAYER.contextAttack.plunge
  // 무료 낙하(FALL.freeSteps)를 넘은 만큼만 셉니다 — 한 계단 내려선 것은 낙하가 아닙니다.
  const extra = Math.max(0, steps - 2) * m.perStep
  const scale = m.damageMult + extra
  return {
    name: '낙하 공격',
    windup: last.windup * m.windupMult,
    active: last.active,
    recovery: last.recovery * m.recoveryMult,
    damage: last.damage * scale,
    range: last.range * m.rangeMult,
    arcDeg: Math.max(20, last.arcDeg + m.arcAdd),
    staminaCost: Math.round(last.staminaCost * m.staminaMult),
    hitstop: last.hitstop,
    // 🔨 이 기술의 값은 무너뜨림입니다 — 강인도에 더 크게 실립니다.
    trauma: last.trauma * m.poiseMult * scale,
    lunge: last.lunge * m.lungeMult,
    knockback: last.knockback,
  }
}

/** Actor.comboIndex 에 넣는 표식. 콤보 길이(최대 4)·강타·처형과 안 겹칩니다. */
export const RUN_COMBO = 252
export const ROLL_COMBO = 253
export const PLUNGE_COMBO = 254

export interface WeaponDef {
  id: string
  name: string
  desc: string
  /** 이 무기를 들었을 때의 이동 속도 배율 */
  moveSpeedScale: number
  /** 공격 중 이동 속도 배율 — 무거운 무기일수록 발이 묶입니다 */
  attackMoveScale: number
  comboWindow: number
  /**
   * **강인도 피해 배율 — 무기의 정체성이 여기에 있습니다.**
   *
   * ── 왜 생겼는가 (프로브가 잡았습니다) ────────────────────────────
   * `npm run weapons` 로 세 무기를 같은 허수아비에 8초씩 두들겨 봤더니
   * **초당 강인도 피해가 4.9 / 4.7 / 4.7** 이었습니다. 셋이 사실상 같습니다.
   * 강인도 피해를 `trauma` 에서 뽑는데, 콤보 한 바퀴의 trauma 합이 무기마다
   * 비슷하게 적혀 있었기 때문입니다.
   *
   * 그러면 *"대검은 무너뜨리는 무기"* 라는 말이 **어디에도 없는 상태**가
   * 됩니다. 소울류에서 대검이 성립하는 이유가 정확히 그건데요 — 느리고
   * 스태미나를 많이 먹는 대신 **한 방이 자세를 무너뜨립니다.**
   *
   * 그래서 무기마다 배율을 둡니다. 별도 필드를 만든 이유는 `trauma` 를
   * 건드리면 화면 흔들림·소리까지 같이 바뀌기 때문입니다(손맛과 강인도는
   * 같은 숫자에서 나오되, 무기 성격만큼은 따로 조절할 수 있어야 합니다).
   */
  poiseScale: number
  /**
   * 🩸 **출혈 축적 배율.** 강인도(`poiseScale`)와 **반대 방향**으로 잡습니다 —
   * 무거운 무기는 무너뜨리고, 가벼운 무기는 터뜨립니다. 두 배율이 같은
   * 방향이면 축이 하나 늘어난 게 아니라 강한 무기가 더 강해질 뿐입니다.
   * 근거와 값의 계산은 balance.ts `BLEED` 주석.
   */
  bleedScale: number
  /**
   * 회피 스태미나 배율 (1 = 기본 25).
   *
   * ── 왜 무기마다 회피 값이 다른가 ────────────────────────────────
   * 존을 세 무기로 각각 돌려 보고 넣었습니다(그전까지 봇은 한 무기만
   * 썼습니다). 쌍단검이 명백히 불리했습니다:
   *
   *     받은 피해  롱소드 229 (191~266)  ·  쌍단검 376 (322~430)
   *     총 타격    롱소드 96회           ·  쌍단검 172회
   *     회피를 못 낼 만큼 낮았던 시간  6%  ·  10%
   *
   * 범위가 안 겹칩니다 — "단검이 더 많이 맞는다"는 증명되었습니다.
   * 원인은 명확합니다. 한 대가 약하니 **두 배를 휘두르고**, 그만큼
   * 적 앞에 서 있는 시간이 길고, 콤보가 싸도 횟수가 많아 스태미나가
   * 결국 더 마릅니다.
   *
   * ── 왜 피해를 올리지 않는가 ─────────────────────────────────────
   * 단검의 정체성은 *"등 뒤에서 2.33배"* 입니다(무기 벤치). 피해를
   * 올리면 그 축이 흐려집니다. 그리고 존에서 백어택 비율을 재 보니
   * **6% (롱소드도 7%)** 였습니다 — 강점이 **조건부**로만 실현되는데
   * 약점은 **무조건** 실현되고 있었습니다. 그게 평균적으로 약한 이유입니다.
   *
   * 그래서 **방어 쪽 축**을 줍니다. 참고: 엘든 링은 장비 무게가 가벼우면
   * 구르기가 싸고 빠릅니다. NRFTW 도 가벼운 무기가 더 자주 굴러요.
   * 가벼운 무기가 **더 자주 피한다**는 것은 장르의 공용 문법입니다.
   * 피해를 안 건드리고 "앞에 오래 서 있어야 한다"는 약점만 완화합니다.
   */
  dodgeCostScale?: number
  /**
   * ── 구르기 **속도** 배율 (거리는 그대로) ──────────────────────────
   *
   * Monster Hunter 는 무기마다 회피 **동작 자체**가 다릅니다 — 가벼운
   * 무기는 짧고 빠른 스텝, 무거운 무기는 굼뜬 구르기. 엘든 링·NRFTW 의
   * 장비 무게도 같은 이야기입니다. 우리는 지금까지 `dodgeCostScale`(값)만
   * 달랐고 **동작은 셋이 똑같았습니다.** 무기를 골라도 구르는 느낌은
   * 하나였다는 뜻입니다.
   *
   * ⚠️ 바꾸는 것은 **시간**이지 거리가 아닙니다. 거리를 건드리면
   *    `npm run rules` 의 약속 하나가 무너집니다:
   *
   *      "🟡 광역 반경이 구르기 거리보다 크다 — 굴러선 못 빠져나온다"
   *      (가장 작은 노랑 4.6m vs 구르기 4.2m — 여유가 **0.4m 뿐**)
   *
   *    가벼운 무기의 구르기를 조금만 늘려도 노랑이 조용히 빨강이 됩니다.
   *    색 하나가 통째로 사라지는 것이고, 그건 손맛을 얻자고 치를 값이
   *    아닙니다. 그래서 같은 거리를 **더 빨리/더 느리게** 갑니다.
   *
   * 무적 프레임도 **같은 배율로** 늘리고 줄입니다. 절대 시간을 고정해 두면
   * 빠른 무기는 구르기의 더 큰 **비율**이 무적이 되어, 값도 싸고 무적도
   * 길어지는 이중 특혜가 됩니다. 비율을 맞추면 남는 차이는 **템포 하나**
   * 입니다 — 가벼운 무기는 빨리 돌아와 다시 붙고, 무거운 무기는 오래
   * 누워 있습니다. 대신 가벼운 무기는 무적 창이 **절대 시간으로는 짧아져**
   * 완벽 회피 타이밍이 더 빡빡합니다. 공짜가 아닙니다.
   */
  dodgeDurationScale?: number
  combo: ComboStep[]
  /** Q, E, R 슬롯에 들어가는 전용 스킬 */
  skills: [string, string, string, string]
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'longsword',
    name: '롱소드',
    desc: '균형형. 3타 콤보. 무엇을 해도 무난하다.',
    moveSpeedScale: 1,
    attackMoveScale: 0.12,
    comboWindow: 0.42,
    // 만능형 — 어느 축에서도 1등이 아니지만 어느 축에서도 꼴찌가 아닙니다.
    poiseScale: 1,
    // 균형 무기 — 두 축 다 기본값입니다. 3타 × 12 = 36/바퀴.
    bleedScale: 1,
    skills: ['lunge_slash', 'whirlwind', 'blade_wave', 'cleave_helm'],
    combo: [
      { name: '1타', windup: 0.12, active: 0.08, recovery: 0.2, damage: 12, range: 2.3, arcDeg: 110, staminaCost: 10, hitstop: 0.055, trauma: 0.22, lunge: 1.5, knockback: 1.6 },
      { name: '2타', windup: 0.1, active: 0.08, recovery: 0.22, damage: 14, range: 2.3, arcDeg: 120, staminaCost: 11, hitstop: 0.06, trauma: 0.26, lunge: 1.7, knockback: 1.8 },
      { name: '3타(마무리)', windup: 0.22, active: 0.1, recovery: 0.42, damage: 27, range: 2.7, arcDeg: 150, staminaCost: 17, hitstop: 0.11, trauma: 0.5, lunge: 2.4, knockback: 4.2 },
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
    /**
     * 무너뜨리는 무기. 대신 스태미나를 크게 씁니다(아래 combo) —
     * **한 번에 크게, 오래는 못 붙어 있는** 것이 이 무기의 거래입니다.
     */
    poiseScale: 1.7,
    /**
     * 대검은 **무너뜨리는 쪽**입니다. 2타 × 12 × 0.55 = 13.2/바퀴 —
     * 여덟 바퀴가 걸려 사실상 이 축을 안 씁니다. 그게 의도입니다:
     * 모든 무기가 모든 축을 쓰면 무기를 고르는 일이 사라집니다.
     */
    bleedScale: 0.55,
    // 대검은 기본값(1)입니다. 무거운 무기에 벌을 더 주면 "느리고 무겁다"가
    // 성격이 아니라 **불이익 두 겹**이 됩니다.
    skills: ['earthshatter', 'wide_cleave', 'leap_slam', 'shove'],
    combo: [
      { name: '1타', windup: 0.26, active: 0.11, recovery: 0.34, damage: 26, range: 3.1, arcDeg: 130, staminaCost: 26, hitstop: 0.09, trauma: 0.4, lunge: 1.6, knockback: 3.4 },
      { name: '2타(마무리)', windup: 0.36, active: 0.13, recovery: 0.6, damage: 46, range: 3.5, arcDeg: 165, staminaCost: 42, hitstop: 0.15, trauma: 0.7, lunge: 2.2, knockback: 7.5 },
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
    /**
     * 거의 못 무너뜨립니다. 단검으로 무너뜨리려는 것은 이 무기의 답이
     * 아닙니다 — 등 뒤를 잡고 **오래 붙어 있는** 것이 답입니다.
     */
    poiseScale: 0.5,
    /**
     * 쌍단검은 **터뜨리는 쪽**입니다. 4타 × 12 × 1.6 = 76.8/바퀴 —
     * 약 1.6바퀴면 터집니다. 이 무기가 존재할 이유가 지금까지 백어택
     * 하나였는데, 이제 *"이어서 붙어 있으면 큰 것이 온다"* 가 생깁니다.
     */
    bleedScale: 1.6,
    /**
     * **회피가 25 → 19 로 쌉니다** (0.75).
     *
     * 이 무기의 약점은 피해가 아니라 **적 앞에 서 있는 시간**입니다.
     * 존에서 롱소드보다 타격 수가 1.8배(96 → 172)이고, 그만큼 더 맞습니다
     * (받은 피해 229 → 376, 범위 안 겹침). 회피를 싸게 해 주면 그 시간을
     * **피하는 데** 쓸 수 있습니다 — 피해를 안 건드리고 약점만 깎습니다.
     *
     * ⚠️ **0.75 였다가 0.5 로 내렸습니다.** 구르기 값을 25 → 18 로 내리면서
     *    `npm run blame` 에 *"세 무기 모두 구르기가 가벼운 공격 두 대보다
     *    싸다"* 를 넣었는데, **단검만 빨갛게** 나왔습니다:
     *
     *      longsword 18 < 21 ✅   greatsword 18 < 68 ✅   daggers 13.5 < 10 ❌
     *
     *    단검의 1·2타는 5+5=10 입니다. 한 대가 가벼운 만큼 **구르기가
     *    상대적으로 제일 비싼 무기**였습니다 — 정확히 이 무기가 팔려는
     *    "가볍게 붙었다 빠진다"의 반대입니다. 0.5 면 9 로, 두 대보다 쌉니다.
     *    엘든 링·소울류의 장비 무게가 말하는 것과 같습니다 — **가벼운 쪽이
     *    가볍게 구릅니다.**
     *
     *    한 무기만 통과시키면 나머지 무기를 든 사람에게는 없는 규칙이 됩니다.
     */
    dodgeCostScale: 0.5,
    /**
     * **구르기가 15% 빠릅니다** (0.42 → 0.36초).
     *
     * 이 무기의 축은 "등 뒤를 잡고 오래 붙어 있는 것"입니다. 빨리 구르면
     * 빨리 다시 붙습니다 — 축을 그대로 강화합니다. 무적 창은 0.24 → 0.20초로
     * 같이 줄어서, 완벽 회피는 오히려 어려워집니다.
     */
    dodgeDurationScale: 0.85,
    skills: ['shadow_step', 'flurry', 'hamstring', 'backstep_cut'],
    combo: [
      { name: '1타', windup: 0.07, active: 0.06, recovery: 0.12, damage: 7, range: 1.9, arcDeg: 95, staminaCost: 5, hitstop: 0.035, trauma: 0.14, lunge: 1.1, knockback: 0.8 },
      { name: '2타', windup: 0.06, active: 0.06, recovery: 0.12, damage: 8, range: 1.9, arcDeg: 95, staminaCost: 5, hitstop: 0.035, trauma: 0.15, lunge: 1.1, knockback: 0.8 },
      { name: '3타', windup: 0.07, active: 0.06, recovery: 0.14, damage: 9, range: 2.0, arcDeg: 105, staminaCost: 5, hitstop: 0.04, trauma: 0.18, lunge: 1.3, knockback: 1 },
      { name: '4타(마무리)', windup: 0.13, active: 0.08, recovery: 0.3, damage: 18, range: 2.3, arcDeg: 130, staminaCost: 10, hitstop: 0.08, trauma: 0.36, lunge: 2.0, knockback: 3 },
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
/**
 * ⌨️ 스킬 키. **여섯 자리**입니다 — 무기 스킬 4 + 룬 2.
 *
 * ⚠️ 새로 넣은 `KeyC` 가 맥락 키(V·B)와 겹치지 않는지는 `npm run guard` 가
 *    봅니다. 가드 키를 V 에 얹었다가 사다리와 부딪혀 봇이 90프레임 갇힌
 *    사고가 있었습니다 — 상시 키와 맥락 키는 절대 같으면 안 됩니다.
 */
export const SKILL_KEY_CODES = ['KeyQ', 'KeyE', 'KeyR', 'KeyC', 'KeyF', 'KeyG'] as const
