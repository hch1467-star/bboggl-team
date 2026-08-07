/**
 * 트라이포드 — 스킬 변형 시스템.
 *
 * ── 로스트아크의 트라이포드가 실제로 하는 일 ────────────────────────
 * 스킬 하나에 3개의 **단계(tier)** 가 있고, 단계마다 선택지 중 하나를 고릅니다.
 * 중요한 것은 그 선택지가 "피해 +5%" 같은 게 아니라, **스킬이 하는 일 자체를
 * 바꾼다**는 점입니다. 같은 이름의 스킬이 사람마다 다르게 작동합니다.
 *
 * 우리가 이걸 가져오는 이유는 취향이 아니라 **DESIGN.md와 맞아떨어지기 때문**입니다:
 *
 *   > 보물 = 새 스킬 / 스킬 변형 (수치 +5%가 아니라 **플레이가 바뀌는 것**)
 *   > "세져서 재미있다"가 아니라 **"새로운 걸 할 수 있어서 재미있다"**
 *
 * 트라이포드는 그 문장을 그대로 시스템으로 옮긴 것입니다. 숨겨둔 보물을 찾으면
 * 스킬이 **다르게 작동하기 시작합니다.** 기둥 4(탐험)와 기둥 1(전투)이 여기서 만납니다.
 *
 * ── 우리 규모에 맞춘 축소 ──────────────────────────────────────────
 * 원본은 3단계 × 3선택 = 27조합/스킬입니다. 스킬 9개면 243가지를 밸런싱해야 합니다.
 * 1인 개발에서 그건 검증 불가능한 숫자입니다. 그래서 **3단계 × 2선택 = 8조합**으로
 * 줄였습니다. 3의 구조(트라이 = 셋)는 유지하되 폭만 좁힌 것입니다.
 * 선택지가 2개라도 "둘 다 매력적이면" 고민은 똑같이 발생합니다.
 * 중요한 것은 선택지의 **개수**가 아니라 **서로 다른 방향**인지입니다.
 *
 * ── 단계별 역할 (모든 스킬 공통) ────────────────────────────────────
 *   1단계 · 성능  — 가장 안전한 선택. "더 크게" vs "더 자주"
 *   2단계 · 운용  — 쓰는 방법이 바뀝니다. "안전하게" vs "공격적으로"
 *   3단계 · 변형  — **스킬의 정체가 바뀝니다.** 여기가 트라이포드의 핵심입니다.
 *
 * 1·2단계를 밋밋하게 두고 3단계에 힘을 몰아준 이유: 셋 다 크게 바뀌면
 * 조합이 8가지라도 실제로는 8개의 다른 스킬이 되어 밸런스가 무너집니다.
 * "기본 성능은 조금, 마지막에 크게"가 학습 곡선에도 맞습니다.
 *
 * ── 해금: 보물 ────────────────────────────────────────────────────
 * 보물 하나 = 트라이포드 포인트 1. 포인트로 **단계를 하나씩** 엽니다.
 * 즉 탐험을 안 하면 스킬은 기본형 그대로입니다. 숨은 보물을 찾을 이유가
 * "수치가 오른다"가 아니라 **"내 스킬이 달라진다"** 가 됩니다.
 */

/** 트라이포드가 스킬 수치에 가하는 변형. 곱연산과 합연산을 명확히 구분합니다. */
export interface TripodMods {
  damageMult?: number
  cooldownMult?: number
  /** 사거리/반경에 더하는 값(m) */
  rangeAdd?: number
  /** 부채꼴 각도에 더하는 값(도) */
  arcAdd?: number
  /** 다단히트 횟수에 더하는 값 */
  hitsAdd?: number
  knockbackMult?: number
  /** 선행동작/후딜 배율 — 1보다 작으면 빨라집니다 */
  windupMult?: number
  recoveryMult?: number
  /** 시전 중 이동 속도 배율에 더하는 값 */
  moveScaleAdd?: number
  /** 대시 거리에 더하는 값(m) */
  dashAdd?: number
  /** 자가 회복량에 더하는 값 */
  healAdd?: number
  /** 속박 시간에 더하는 값(초) */
  snareAdd?: number
  /** 무적 구간을 부여/연장합니다 [시작, 끝] */
  iFrames?: [number, number]
  /** 판정 도형을 통째로 바꿉니다 — 3단계 전용 */
  shape?: 'cone' | 'circle' | 'point'
}

export interface TripodOption {
  id: string
  name: string
  desc: string
  mods: TripodMods
}

export interface TripodTier {
  /** 1단계 · 2단계 · 3단계 */
  title: string
  options: [TripodOption, TripodOption]
}

/** 스킬 id -> 3단계. 단계가 없는 스킬(룬 일부)은 기본형만 씁니다. */
export const TRIPODS: Record<string, [TripodTier, TripodTier, TripodTier]> = {
  // ══ 롱소드 ═══════════════════════════════════════════════════════
  lunge_slash: [
    {
      title: '1단계 · 성능',
      options: [
        { id: 'ls1a', name: '깊은 상처', desc: '피해 +35%', mods: { damageMult: 1.35 } },
        { id: 'ls1b', name: '가벼운 검', desc: '쿨다운 -30%', mods: { cooldownMult: 0.7 } },
      ],
    },
    {
      title: '2단계 · 운용',
      options: [
        { id: 'ls2a', name: '긴 도약', desc: '돌진 거리 +2.5m', mods: { dashAdd: 2.5 } },
        {
          id: 'ls2b',
          name: '흘리기',
          desc: '돌진하는 동안 무적',
          mods: { iFrames: [0.02, 0.24] },
        },
      ],
    },
    {
      title: '3단계 · 변형',
      options: [
        {
          // 부채꼴 90° → 원형. "앞으로 뚫는 기술"이 "지나가며 다 베는 기술"이 됩니다.
          id: 'ls3a',
          name: '관통',
          desc: '판정이 원형이 되어 지나가는 길의 모두를 벤다. 피해 -25%',
          mods: { shape: 'circle', rangeAdd: -0.4, damageMult: 0.75 },
        },
        {
          id: 'ls3b',
          name: '처형',
          desc: '피해 +80%, 대신 쿨다운 +60%. 한 번에 몰아치는 형태로 바뀐다.',
          mods: { damageMult: 1.8, cooldownMult: 1.6, knockbackMult: 1.6 },
        },
      ],
    },
  ],
  whirlwind: [
    {
      title: '1단계 · 성능',
      options: [
        { id: 'ww1a', name: '넓은 원', desc: '반경 +1.2m', mods: { rangeAdd: 1.2 } },
        { id: 'ww1b', name: '빠른 회전', desc: '쿨다운 -25%', mods: { cooldownMult: 0.75 } },
      ],
    },
    {
      title: '2단계 · 운용',
      options: [
        { id: 'ww2a', name: '발놀림', desc: '시전 중 이동 속도 대폭 증가', mods: { moveScaleAdd: 0.45 } },
        { id: 'ww2b', name: '버티기', desc: '회전하는 동안 무적', mods: { iFrames: [0.2, 0.55] } },
      ],
    },
    {
      title: '3단계 · 변형',
      options: [
        {
          id: 'ww3a',
          name: '연속 회전',
          desc: '타격 횟수 +3. 포위를 갈아버리는 형태.',
          mods: { hitsAdd: 3, damageMult: 0.7 },
        },
        {
          id: 'ww3b',
          name: '폭풍의 눈',
          desc: '밀어내는 힘이 두 배. 적을 전부 떼어낸다.',
          mods: { knockbackMult: 2.2, rangeAdd: 0.6 },
        },
      ],
    },
  ],
  blade_wave: [
    {
      title: '1단계 · 성능',
      options: [
        { id: 'bw1a', name: '먼 검기', desc: '사거리 +3m', mods: { rangeAdd: 3 } },
        { id: 'bw1b', name: '예리함', desc: '피해 +40%', mods: { damageMult: 1.4 } },
      ],
    },
    {
      title: '2단계 · 운용',
      options: [
        { id: 'bw2a', name: '속사', desc: '선행동작 -45%', mods: { windupMult: 0.55 } },
        { id: 'bw2b', name: '반동 없음', desc: '후딜 -40%, 시전 중 이동 가능', mods: { recoveryMult: 0.6, moveScaleAdd: 0.3 } },
      ],
    },
    {
      title: '3단계 · 변형',
      options: [
        {
          // 28° -> 100°. 저격용 원거리기가 광역 견제기로 바뀝니다.
          id: 'bw3a',
          name: '확산',
          desc: '부챗살처럼 퍼진다. 각도 +72°, 피해 -30%',
          mods: { arcAdd: 72, damageMult: 0.7 },
        },
        {
          id: 'bw3b',
          name: '삼연격',
          desc: '검기를 세 번 날린다.',
          mods: { hitsAdd: 2, damageMult: 0.55, recoveryMult: 1.2 },
        },
      ],
    },
  ],

  // ══ 대검 ═════════════════════════════════════════════════════════
  earthshatter: [
    {
      title: '1단계 · 성능',
      options: [
        { id: 'es1a', name: '큰 균열', desc: '반경 +1.4m', mods: { rangeAdd: 1.4 } },
        { id: 'es1b', name: '무게', desc: '피해 +30%', mods: { damageMult: 1.3 } },
      ],
    },
    {
      title: '2단계 · 운용',
      options: [
        { id: 'es2a', name: '빠른 낙하', desc: '선행동작 -40% (예고가 짧아 피하기 어렵다)', mods: { windupMult: 0.6 } },
        { id: 'es2b', name: '멀리 던지기', desc: '지정 가능 거리 +4m', mods: { rangeAdd: 0.4, dashAdd: 0 } },
      ],
    },
    {
      title: '3단계 · 변형',
      options: [
        {
          id: 'es3a',
          name: '여진',
          desc: '두 번 연달아 터진다.',
          mods: { hitsAdd: 1, damageMult: 0.68 },
        },
        {
          id: 'es3b',
          name: '지면 균열',
          desc: '맞은 적을 1.6초 묶는다.',
          mods: { snareAdd: 1.6, damageMult: 0.85 },
        },
      ],
    },
  ],
  wide_cleave: [
    {
      title: '1단계 · 성능',
      options: [
        { id: 'wc1a', name: '긴 팔', desc: '사거리 +1.2m', mods: { rangeAdd: 1.2 } },
        { id: 'wc1b', name: '완력', desc: '피해 +32%', mods: { damageMult: 1.32 } },
      ],
    },
    {
      title: '2단계 · 운용',
      options: [
        { id: 'wc2a', name: '휘두르며 전진', desc: '시전 중 이동 가능', mods: { moveScaleAdd: 0.4 } },
        { id: 'wc2b', name: '쿨다운 단축', desc: '쿨다운 -30%', mods: { cooldownMult: 0.7 } },
      ],
    },
    {
      title: '3단계 · 변형',
      options: [
        {
          // 175° -> 360°. 전방 광역기가 전방위 광역기가 됩니다.
          id: 'wc3a',
          name: '전방위',
          desc: '몸 주위를 전부 훑는다. 등 뒤도 벤다.',
          mods: { shape: 'circle', damageMult: 0.8 },
        },
        {
          id: 'wc3b',
          name: '분쇄',
          desc: '타격 횟수 +3, 밀어내는 힘 증가.',
          mods: { hitsAdd: 3, damageMult: 0.66, knockbackMult: 1.5 },
        },
      ],
    },
  ],
  leap_slam: [
    {
      title: '1단계 · 성능',
      options: [
        { id: 'lp1a', name: '멀리 뛰기', desc: '도약 거리 +3m', mods: { dashAdd: 3 } },
        { id: 'lp1b', name: '충격', desc: '피해 +30%', mods: { damageMult: 1.3 } },
      ],
    },
    {
      title: '2단계 · 운용',
      options: [
        { id: 'lp2a', name: '공중 회피', desc: '도약하는 동안 무적', mods: { iFrames: [0.05, 0.42] } },
        { id: 'lp2b', name: '착지 취소', desc: '후딜 -45%', mods: { recoveryMult: 0.55 } },
      ],
    },
    {
      title: '3단계 · 변형',
      options: [
        {
          id: 'lp3a',
          name: '지진',
          desc: '착지 반경 +2.5m. 뛰어들며 판을 깐다.',
          mods: { rangeAdd: 2.5, damageMult: 0.78 },
        },
        {
          id: 'lp3b',
          name: '못 박기',
          desc: '착지 지점의 적을 2초 묶는다.',
          mods: { snareAdd: 2, knockbackMult: 0.2 },
        },
      ],
    },
  ],

  // ══ 쌍단검 ═══════════════════════════════════════════════════════
  shadow_step: [
    {
      title: '1단계 · 성능',
      options: [
        { id: 'ss1a', name: '깊은 찌르기', desc: '피해 +45%', mods: { damageMult: 1.45 } },
        { id: 'ss1b', name: '짧은 준비', desc: '쿨다운 -35%', mods: { cooldownMult: 0.65 } },
      ],
    },
    {
      title: '2단계 · 운용',
      options: [
        { id: 'ss2a', name: '긴 도약', desc: '이동 거리 +2m', mods: { dashAdd: 2 } },
        { id: 'ss2b', name: '즉시 복귀', desc: '후딜 -50% — 착지 직후 바로 등을 친다', mods: { recoveryMult: 0.5 } },
      ],
    },
    {
      title: '3단계 · 변형',
      options: [
        {
          id: 'ss3a',
          name: '그림자 사슬',
          desc: '지나친 적을 1.4초 묶는다. 등 뒤를 잡을 시간이 늘어난다.',
          mods: { snareAdd: 1.4 },
        },
        {
          id: 'ss3b',
          name: '연막',
          desc: '무적 시간이 크게 늘어난다.',
          mods: { iFrames: [0.0, 0.55], damageMult: 0.8 },
        },
      ],
    },
  ],
  flurry: [
    {
      title: '1단계 · 성능',
      options: [
        { id: 'fl1a', name: '더 많이', desc: '타격 횟수 +3', mods: { hitsAdd: 3 } },
        { id: 'fl1b', name: '더 세게', desc: '한 대의 피해 +45%', mods: { damageMult: 1.45 } },
      ],
    },
    {
      title: '2단계 · 운용',
      options: [
        { id: 'fl2a', name: '따라붙기', desc: '시전 중 이동 속도 증가', mods: { moveScaleAdd: 0.4 } },
        { id: 'fl2b', name: '빠른 준비', desc: '선행동작 -50%, 쿨다운 -20%', mods: { windupMult: 0.5, cooldownMult: 0.8 } },
      ],
    },
    {
      title: '3단계 · 변형',
      options: [
        {
          // 55° -> 145°. 단일 대상 딜링기가 다수 상대 기술이 됩니다.
          id: 'fl3a',
          name: '난무',
          desc: '범위가 크게 넓어진다. 여럿을 한 번에.',
          mods: { arcAdd: 90, rangeAdd: 0.8, damageMult: 0.72 },
        },
        {
          id: 'fl3b',
          name: '급소 노리기',
          desc: '한 대 한 대가 무겁다. 피해 +70%, 타격 횟수 -2',
          mods: { damageMult: 1.7, hitsAdd: -2 },
        },
      ],
    },
  ],
  hamstring: [
    {
      title: '1단계 · 성능',
      options: [
        { id: 'hs1a', name: '깊은 절개', desc: '속박 +1.2초', mods: { snareAdd: 1.2 } },
        { id: 'hs1b', name: '빠른 손', desc: '쿨다운 -35%', mods: { cooldownMult: 0.65 } },
      ],
    },
    {
      title: '2단계 · 운용',
      options: [
        { id: 'hs2a', name: '넓게 긋기', desc: '각도 +100° — 여럿을 한 번에 묶는다', mods: { arcAdd: 100 } },
        { id: 'hs2b', name: '치고 빠지기', desc: '후딜 -50%, 시전 중 이동 가능', mods: { recoveryMult: 0.5, moveScaleAdd: 0.5 } },
      ],
    },
    {
      title: '3단계 · 변형',
      options: [
        {
          id: 'hs3a',
          name: '아킬레스',
          desc: '속박 +2.2초. 등 뒤를 잡고도 남는 시간.',
          mods: { snareAdd: 2.2 },
        },
        {
          id: 'hs3b',
          name: '독날',
          desc: '보조기가 주력기가 된다. 피해 +190%',
          mods: { damageMult: 2.9, snareAdd: -0.6 },
        },
      ],
    },
  ],
}

/** 이 스킬에 트라이포드가 있는가. 룬은 아직 없습니다(탐험 보상 자체이므로). */
export function tripodsFor(skillId: string): [TripodTier, TripodTier, TripodTier] | null {
  return TRIPODS[skillId] ?? null
}

export const TRIPOD_TIERS = 3
