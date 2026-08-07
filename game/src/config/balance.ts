/**
 * 게임의 모든 튜닝 수치를 여기 한 곳에 모읍니다.
 *
 * 설계 근거: 밸런싱은 "코드 고치기"가 아니라 "숫자 고치기"여야 합니다.
 * 숫자가 로직 안에 흩어져 있으면 밸런스 한 번 바꿀 때마다 버그가 생깁니다.
 *
 * UNITY 이식 노트: 이 파일의 각 블록이 그대로 ScriptableObject 하나가 됩니다.
 * (PlayerConfig.asset, EnemyConfig.asset, CameraConfig.asset ...)
 * 그래서 지금 JSON처럼 순수 데이터로만 유지하고, 함수는 넣지 않습니다.
 */

/** 쿼터뷰 카메라 리그 */
export const CAMERA = {
  /** 수평 회전각(도). 45° = 고전적인 쿼터뷰/아이소메트릭 각도 */
  yawDeg: 45,
  /**
   * 수직 내려보는 각(도). 30°면 아이소메트릭에 가깝고 벽/지형이 많이 보입니다.
   * 55°에 가까울수록 탑다운이 되어 바닥 장판(AoE)이 잘 보입니다.
   * 로스트아크류 ARPG는 장판 회피가 중요해서 이 정도로 눕혀 잡습니다.
   */
  pitchDeg: 52,
  /** 직교 카메라가 세로로 담는 월드 높이(m). 작을수록 확대. */
  viewSize: 22,
  /**
   * 대상에서 카메라까지의 거리(m).
   *
   * 직교 투영이라 이 값은 **화면 크기에 아무 영향이 없습니다**(viewSize가 결정).
   * 그런데 안개(fog)는 카메라로부터의 거리로 계산되기 때문에, 이 값을 무시하고
   * 안개를 잡으면 씬 전체가 안개에 먹혀 화면이 새까맣게 나옵니다.
   * (자동 검증 스크린샷에서 실제로 잡은 버그입니다. 그래서 설정으로 뺐습니다.)
   */
  distance: 48,
  /** 카메라가 플레이어를 따라가는 부드러움. 클수록 빠르게 따라붙음. */
  followLerp: 9,
  /** 커서 방향으로 시야를 살짝 밀어주는 양(0이면 끔). 조준감이 좋아집니다. */
  aimLeadFactor: 0.18,
  aimLeadMax: 3.2,
  /** 화면 흔들림 */
  shake: {
    /** trauma가 1일 때 최대 위치 흔들림(m) */
    maxOffset: 0.55,
    /** trauma가 1일 때 최대 회전 흔들림(도) */
    maxRollDeg: 1.6,
    /** 초당 trauma 감쇠량. 클수록 빨리 잦아듦. */
    decay: 2.2,
    /** 흔들림 노이즈 주파수(Hz) */
    frequency: 22,
  },
} as const

/** 플레이어 */
export const PLAYER = {
  maxHp: 100,
  radius: 0.45,
  height: 1.75,

  /** 이동 */
  moveSpeed: 5.4,
  /** 목표 속도까지 도달하는 가속(m/s^2). 무한대면 미끄러짐 없이 즉각 반응. */
  acceleration: 60,
  /** 초당 회전 속도(도) — 마우스 조준 방향으로 몸을 돌리는 속도 */
  turnSpeedDeg: 900,
  /** 스태미나 */
  maxStamina: 100,
  staminaRegen: 34,
  /** 스태미나를 쓴 뒤 회복이 시작되기까지의 딜레이(초) */
  staminaRegenDelay: 0.55,

  /** 회피 구르기 */
  dodge: {
    duration: 0.42,
    distance: 4.2,
    staminaCost: 25,
    /** 무적 프레임 구간(초). 시작 직후가 아니라 살짝 뒤부터 — 이게 소울라이크식입니다. */
    iFrameStart: 0.06,
    iFrameEnd: 0.3,
    /** 구르기 끝나고 다시 구를 수 있을 때까지 */
    cooldown: 0.12,
  },

  // 기본 공격 콤보 · 콤보 윈도우 · 공격 중 이동 배율은 **무기마다 다르므로**
  // config/arsenal.ts 의 WEAPONS 로 옮겼습니다. (대검은 2타, 쌍단검은 4타 등)

  /** 피격 시 경직 시간(초) */
  hurtStagger: 0.28,
  /** 피격 후 무적(연속 피격 방지) */
  invulnAfterHit: 0.45,
} as const

/** 잡몹 — 소울라이크식으로 "읽고 피할 수 있는" 적 */
export const GRUNT = {
  maxHp: 58,
  radius: 0.45,
  height: 1.7,
  moveSpeed: 3.0,
  turnSpeedDeg: 420,

  /**
   * 이 거리 안에 들어오면 추격 시작.
   *
   * 아레나 모드에서는 반드시 아레나 전체를 덮어야 합니다.
   * (자동 검증에서 잡은 실제 버그: 15로 두면 적이 반지름 21 지점에 스폰되는데
   *  어그로 범위 밖이라 영원히 제자리에 서 있었습니다. 웨이브가 진행되지 않습니다.)
   * 나중에 던전 콘텐츠를 만들 때는 방 단위로 작은 값을 쓰게 됩니다.
   */
  aggroRange: 55,
  /** 이 거리 안이면 공격 시도 */
  attackRange: 2.1,
  /** 공격 후 다음 공격까지 */
  attackCooldown: 1.1,

  /**
   * 텔레그래프(예고 동작).
   * 0.5초 이상 줘야 사람이 보고 반응해서 구를 수 있습니다.
   * 이 수치를 0.2로 낮추면 게임이 즉시 "불공정하다"고 느껴집니다.
   */
  windup: 0.55,
  active: 0.12,
  recovery: 0.7,

  damage: 14,
  attackArcDeg: 100,
  attackReach: 2.5,
  knockback: 2.6,

  /** 피격 경직 */
  hurtStagger: 0.22,
  /** 서로 밀어내는 힘 — 적들이 한 점에 겹쳐 쌓이는 것을 막습니다. */
  separationForce: 7.5,
} as const

/**
 * 보스 — 잡몹과 같은 상태 기계를 쓰되 수치만 다릅니다.
 *
 * 설계 근거: 보스를 "체력 많은 잡몹"으로 만들면 지루해집니다. 그래서
 * 체력보다 **예고 시간과 후딜을 더 길게** 잡았습니다. 느리고 무거운 대신
 * 한 대가 치명적이라, 플레이어가 "읽고 → 피하고 → 반격하는" 리듬을
 * 확실히 연습하게 됩니다. (기둥 2·3의 훈련장 역할)
 */
export const BOSS = {
  maxHp: 420,
  radius: 0.95,
  height: 2.9,
  moveSpeed: 2.4,
  turnSpeedDeg: 240,
  aggroRange: 55,
  attackRange: 3.4,
  attackCooldown: 1.5,
  /** 잡몹보다 확실히 긴 예고 — 크고 느린 만큼 확실히 읽힙니다. */
  windup: 0.78,
  active: 0.16,
  recovery: 1.05,
  damage: 30,
  attackArcDeg: 130,
  attackReach: 4.2,
  knockback: 6.5,
  hurtStagger: 0.1,
} as const

/**
 * 포지셔닝 — 백어택과 치명타 (DESIGN.md 기둥 3).
 *
 * 이 기둥의 목적은 하나입니다: **이동을 "도망"이 아니라 "공격의 일부"로 만들기.**
 * 등 뒤를 치면 크게 아프기 때문에, 회피 구르기와 그림자 도약이
 * "안 맞으려고 쓰는 것"에서 "때리려고 쓰는 것"으로 바뀝니다.
 * 소울라이크의 '회피 후 반격'과 로스트아크의 '백어택'이 여기서 하나로 맞물립니다.
 *
 * 적 -> 플레이어 방향으로는 적용하지 않습니다.
 * 적이 여럿이면 플레이어는 한쪽만 볼 수 있어서, 뒤에서 오는 추가 피해가
 * "실력으로 막을 수 있는 것"이 아니라 **피할 수 없는 소모**가 되기 때문입니다.
 * (막기 방향 같은 대응 수단이 생기면 그때 대칭으로 되돌립니다.)
 */
export const COMBAT = {
  /** 등 뒤 판정 부채꼴(도). 적의 후방 이 각도 안에서 때리면 백어택. */
  backArcDeg: 120,
  /** 백어택 피해 배율 */
  backDamageMult: 1.55,
  /** 기본 치명타 확률 */
  baseCritChance: 0.08,
  /** 백어택일 때 더해지는 치명타 확률 */
  backCritBonus: 0.45,
  /** 치명타 피해 배율 */
  critMult: 1.8,
  /** 백어택 시 히트스톱을 조금 더 줍니다 — "제대로 꽂혔다"는 감각. */
  backHitstopBonus: 0.035,
  backTraumaBonus: 0.12,
  /**
   * 이 거리 안으로 들어가면 적의 등 뒤 구역이 지면에 표시됩니다.
   * 항상 켜두면 화면이 지저분해지고, 없으면 백어택이 운처럼 느껴집니다.
   */
  backIndicatorRange: 5.5,
} as const

/** 보물 */
export const TREASURE = {
  /** 이 거리 안에 들어오면 획득 */
  pickupRadius: 1.5,
  bobHeight: 0.25,
  bobSpeed: 2.2,
  spinSpeed: 1.6,
} as const

/** 월드 */
export const WORLD = {
  /** 아레나 반지름(m) */
  arenaRadius: 26,
  gridSize: 2,
  /** 초기 적 스폰 수 */
  initialEnemies: 6,
  /** 적이 다 죽으면 다음 웨이브를 이 시간 뒤에 소환 */
  waveDelay: 2.5,
  /** 웨이브마다 늘어나는 적 수 */
  enemiesPerWaveGrowth: 2,
  maxEnemiesPerWave: 24,
} as const

/** 처치 시 연출 */
export const KILL_FEEDBACK = {
  hitstop: 0.13,
  trauma: 0.45,
} as const
