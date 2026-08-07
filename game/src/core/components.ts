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
  Attack = 1,
  Dodge = 2,
  Stagger = 3,
  Dead = 4,
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
  /** 다음 공격까지 남은 쿨다운(적 전용) */
  cooldownT: 'f32',
  /** 이번 active 구간에서 이미 명중했는지 (1프레임 다중 히트 방지) */
  hasHit: 'u8',
  /** 이동 속도 배율 (공격 중 감속 등) */
  moveScale: 'f32',
})

/** 플레이어 전용 데이터 */
export const Player = defineComponent({
  /** 구르기 방향 */
  dodgeDirX: 'f32',
  dodgeDirZ: 'f32',
  /** 구르기 총 지속시간 대비 경과 시간 — 무적 프레임 판정에 사용 */
  dodgeElapsed: 'f32',
  dodgeCooldownT: 'f32',
})

/** 적 전용 데이터 */
export const Enemy = defineComponent({
  /** 0 = 잡몹. 나중에 정예/보스 추가 */
  kind: 'u8',
  /** 어그로 상태 (0 = 미발견, 1 = 추격 중) */
  aggro: 'u8',
})

/** Three.js 오브젝트와 엔티티를 잇는 핸들. 실제 메시는 render/visuals.ts가 보관합니다. */
export const Renderable = defineComponent({
  /** 0 = 플레이어 캡슐, 1 = 잡몹 */
  kind: 'u8',
})
