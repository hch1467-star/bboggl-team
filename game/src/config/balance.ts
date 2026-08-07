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
  /** 공격 중 이동 속도 배율. 소울라이크의 "커밋" 감각을 만드는 핵심 수치. */
  attackMoveScale: 0.12,

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

  /**
   * 3타 콤보. 각 타는 3단계로 구성됩니다:
   *   windup(선행동작) → active(판정 발생) → recovery(후딜)
   *
   * windup이 없으면 "허공에서 데미지가 튀어나오는" 느낌이 나고,
   * recovery가 없으면 무한 연타가 되어 긴장감이 사라집니다.
   */
  combo: [
    {
      name: '1타',
      windup: 0.12,
      active: 0.08,
      recovery: 0.2,
      damage: 12,
      range: 2.3,
      arcDeg: 110,
      staminaCost: 11,
      /** 타격 시 정지 시간(초) */
      hitstop: 0.055,
      /** 타격 시 화면 흔들림 강도(0~1) */
      trauma: 0.22,
      /** 공격하며 앞으로 미끄러지는 거리(m) */
      lunge: 1.5,
      knockback: 1.6,
    },
    {
      name: '2타',
      windup: 0.1,
      active: 0.08,
      recovery: 0.22,
      damage: 14,
      range: 2.3,
      arcDeg: 120,
      staminaCost: 12,
      hitstop: 0.06,
      trauma: 0.26,
      lunge: 1.7,
      knockback: 1.8,
    },
    {
      name: '3타(마무리)',
      windup: 0.22,
      active: 0.1,
      recovery: 0.42,
      damage: 27,
      range: 2.7,
      arcDeg: 150,
      staminaCost: 20,
      hitstop: 0.11,
      trauma: 0.5,
      lunge: 2.4,
      knockback: 4.2,
    },
  ],

  /** active가 끝난 뒤 이 시간 안에 다시 누르면 다음 타로 이어집니다. */
  comboWindow: 0.42,
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
