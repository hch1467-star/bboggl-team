import { defineComponent } from './ecs'

/**
 * 컴포넌트 = "순수 데이터". 여기에는 로직(함수)이 절대 들어가지 않습니다.
 * 로직은 전부 src/systems/ 에 있습니다.
 *
 * UNITY 이식 노트: 각 컴포넌트가 IComponentData struct 하나에 대응됩니다.
 */

/** 위치와 바라보는 방향. y는 지면 높이(점프/낙하용, 지금은 0 고정). */
export const Transform = defineComponent({
  x: 'f32',
  y: 'f32',
  z: 'f32',
  /** Y축 회전(라디안). 캐릭터가 바라보는 방향. */
  rotY: 'f32',
})

/**
 * XZ 평면 속도(m/s). 쿼터뷰라 수직 속도는 아직 쓰지 않습니다.
 *
 * 이동 속도(x,z)와 넉백(kx,kz)을 **분리**한 이유:
 * 하나로 합치면 플레이어의 이동 제어(목표 속도로 빠르게 수렴)가 넉백을
 * 0.07초 만에 지워버려서, 맞아도 밀려나는 게 눈에 안 보입니다.
 * 넉백을 따로 두고 천천히 감쇠시켜야 "맞았다"는 게 몸으로 느껴집니다.
 */
export const Velocity = defineComponent({ x: 'f32', z: 'f32', kx: 'f32', kz: 'f32' })

/** 충돌/밀림 처리용 원기둥 근사 */
export const Body = defineComponent({ radius: 'f32', height: 'f32' })

export const Health = defineComponent({
  hp: 'f32',
  max: 'f32',
  /** 남은 무적 시간(초) */
  invulnT: 'f32',
  /** 피격 흰색 플래시 남은 시간(초) */
  flashT: 'f32',
})

export const Stamina = defineComponent({
  value: 'f32',
  max: 'f32',
  /** 회복이 재개되기까지 남은 시간(초) */
  regenDelayT: 'f32',
})

/** 액터 상태 값 (Actor.state) */
export const enum ActorState {
  Idle = 0,
  /** 기본 공격 콤보 */
  Attack = 1,
  Dodge = 2,
  Stagger = 3,
  Dead = 4,
  /** 스킬 시전. 기본 공격과 같은 windup/active/recovery 3단 구조를 씁니다. */
  Skill = 5,
  /** 성수병을 마시는 중. 무적 프레임이 **없는** 것이 핵심입니다. */
  Drink = 6,
}

/** 공격 단계 값 (Actor.phase) */
export const enum AttackPhase {
  Windup = 0,
  Active = 1,
  Recovery = 2,
}

/**
 * 플레이어와 적이 공유하는 행동 상태 기계.
 * 같은 컴포넌트를 쓰는 덕분에 전투 판정 시스템 하나가 양쪽을 모두 처리합니다.
 */
export const Actor = defineComponent({
  /** ActorState */
  state: 'u8',
  /** AttackPhase (state === Attack 일 때만 유효) */
  phase: 'u8',
  /** 현재 단계의 남은 시간(초) */
  timer: 'f32',
  /** 현재 콤보 인덱스 (0,1,2) */
  comboIndex: 'u8',
  /** 콤보 이어치기 입력을 받는 남은 시간(초). 0이면 콤보 종료. */
  comboWindowT: 'f32',
  /** 콤보 입력 선입력(버퍼). 후딜 중에 눌러도 다음 타로 이어지게 해줍니다. */
  bufferedAttack: 'u8',
  /**
   * 스킬 선입력. 0 = 없음, 그 외에는 **슬롯 번호 + 1**.
   *
   * 0을 "없음"으로 쓰려면 슬롯 0(Q)과 구분되어야 해서 1을 더해 저장합니다.
   */
  bufferedSkill: 'u8',
  /** 스킬 선입력이 만료되기까지 남은 시간(초). 지나면 버립니다. */
  bufferedSkillT: 'f32',
  /** 다음 공격까지 남은 쿨다운(적 전용) */
  cooldownT: 'f32',
  /**
   * 이번 active 구간에서 남은 타격 횟수.
   * 1이면 한 번만 맞습니다(1프레임 다중 히트 방지). 다단히트 스킬은 2 이상으로 시작해
   * active 구간을 균등 분할하며 여러 번 때립니다.
   */
  hitsLeft: 'u8',
  /** 다음 타격까지 남은 시간(초). 다단히트 간격. */
  nextHitT: 'f32',
  /** 시전 중인 스킬 슬롯 (0~3). state === Skill 일 때만 유효. */
  skillSlot: 'u8',
  /** 이동 속도 배율 (공격 중 감속 등) */
  moveScale: 'f32',
})

/** 플레이어 전용 데이터 */
export const Player = defineComponent({
  /** 구르기 방향 */
  dodgeDirX: 'f32',
  dodgeDirZ: 'f32',
  /** 지점 지정 스킬의 착탄 좌표 — 시전 시작 순간에 고정합니다.
   *  매 프레임 커서를 따라가게 하면 예고를 보고 피하는 것이 불가능해집니다. */
  castX: 'f32',
  castZ: 'f32',
  /** 구르기 총 지속시간 대비 경과 시간 — 무적 프레임 판정에 사용 */
  dodgeElapsed: 'f32',
  /** 대시 스킬의 실제 전진 속도(m/s). 시전 순간 조준 거리에 맞춰 계산합니다. */
  dashSpeed: 'f32',
  /**
   * 이번 동작이 **최종적으로 바라볼 방향**(라디안).
   *
   * 공격 시작 순간에 몸을 확 돌리지 않고, 선행동작 동안 이 각도로 수렴합니다.
   * 판정이 시작될 때(=선행동작이 끝날 때) 정확히 도착하므로 손해는 없습니다.
   */
  faceRot: 'f32',
  dodgeCooldownT: 'f32',
  /** 남은 성수병 충전 수 */
  vials: 'u8',
  /** 최대 충전 수 — 나중에 보물로 늘릴 여지를 남겨 둡니다. */
  vialsMax: 'u8',
  /** 화톳불 앞에서 가만히 있은 시간(초). BONFIRE.restTime 을 넘기면 휴식. */
  restT: 'f32',
  /** 마지막으로 쉰 화톳불의 좌표 — 죽으면 여기서 다시 시작합니다. */
  respawnX: 'f32',
  respawnZ: 'f32',
  /** 부활 지점이 정해졌는가(0=아직 화톳불을 만난 적 없음) */
  hasRespawn: 'u8',
  /** 가진 불티. 죽으면 전부 그 자리에 떨어집니다. */
  embers: 'u32',
})

/** 적 종류 (Enemy.kind) */
/**
 * 적 종류.
 *
 * **값을 바꾸지 마세요.** 레벨 파일과 세이브에 숫자로 저장됩니다.
 * 새 종류는 항상 뒤에 추가합니다.
 */
export const enum EnemyKind {
  Grunt = 0,
  Boss = 1,
  /** 🔵 얽는 자 — 원거리 속박만 겁니다. 파랑을 가르치는 적. */
  Binder = 2,
  /** 🟣 끄는 자 — 아주 먼 거리에서 끌어당기기만 합니다. 보라를 가르치는 적. */
  Dragger = 3,
}

/** 적 전용 데이터 */
export const Enemy = defineComponent({
  /** EnemyKind */
  kind: 'u8',
  /** 어그로 상태 (0 = 미발견, 1 = 추격 중) */
  aggro: 'u8',
  /**
   * 등 뒤를 잡혔을 때 알아채기까지 남은 시간(초).
   * 0이 되어야 몸을 돌리기 시작합니다 — 이 시간이 플레이어의 반격 창입니다.
   */
  reactT: 'f32',
  /**
   * 지금 시전 중인 공격 패턴의 인덱스 (enemyAttacks.ts 의 목록 기준).
   * ECS에는 숫자만 담을 수 있어 인덱스로 들고 있다가 조회해서 씁니다.
   */
  attackIndex: 'u8',
  /** 보스 전용 — 현재 페이즈(0부터). 잡몹은 항상 0입니다. */
  phase: 'u8',
  /** 페이즈 전환 연출 남은 시간(초). 0보다 크면 무적 + 행동 정지. */
  transitionT: 'f32',
  /**
   * 다음에 **쿨다운 없이 곧바로** 걸 연계 패턴의 인덱스.
   * 255 = 없음. (u8이라 255를 "없음"으로 씁니다 — 패턴이 255개가 될 일은 없습니다)
   */
  chainNext: 'u8',
  /**
   * 지금 시전 중인 공격이 **연계로 들어온 것인가**(1) 아닌가(0).
   * 연계 선행동작 동안에는 발이 묶이지 않고 대상 쪽으로 파고듭니다.
   */
  chained: 'u8',
})

/** 상태이상 — 지금은 속박 하나. 늘어나면 별도 컴포넌트로 나눕니다. */
export const Status = defineComponent({
  /** 🔵 속박 남은 시간(초). 이동 속도가 SNARE_MOVE_SCALE 배가 됩니다. */
  snareT: 'f32',
})

/**
 * 장비 — 무기 1개 + 룬 2개, 그리고 스킬 슬롯 5개의 쿨다운.
 *
 * 슬롯 배치: [0]=무기1(Q) [1]=무기2(E) [2]=무기3(R) [3]=룬1(F) [4]=룬2(G)
 * 무기 슬롯을 고정해 둔 것이 밸런스의 기준선입니다(arsenal.ts 설계 노트 참고).
 */
export const Loadout = defineComponent({
  weapon: 'u8',
  /** 장착된 룬의 RUNE_ORDER 인덱스. -1 = 비어 있음. */
  rune0: 'i32',
  rune1: 'i32',
  /** 지금까지 획득한 룬 개수 (탐험 보상으로 늘어남) */
  runesOwned: 'u8',
  /** 슬롯별 남은 쿨다운(초) */
  cd0: 'f32',
  cd1: 'f32',
  cd2: 'f32',
  cd3: 'f32',
  cd4: 'f32',
})

/** 주울 수 있는 것 — 지금은 보물. 나중에 스킬 해금/소모품으로 확장합니다. */
export const Pickup = defineComponent({
  taken: 'u8',
  /** 둥둥 뜨는 연출의 위상차. 여러 개가 똑같이 움직이면 인공적으로 보입니다. */
  phase: 'f32',
})

/** Three.js 오브젝트와 엔티티를 잇는 핸들. 실제 메시는 render/visuals.ts가 보관합니다. */
export const Renderable = defineComponent({
  /** 0 = 플레이어 캡슐, 1 = 잡몹 */
  kind: 'u8',
})
