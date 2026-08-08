/**
 * 화톳불 — 성수병을 채우고, 죽으면 돌아오는 자리.
 *
 * ── 왜 별도 상호작용 키가 없는가 ────────────────────────────────────
 * 남는 키가 마땅치 않기도 하지만, 더 큰 이유는 **쉴 수 있는 조건 자체를
 * 규칙으로 만들고 싶었기** 때문입니다. "가까이서 가만히, 적이 없을 때"로
 * 두면 전투 중 회복이 저절로 막히고, 플레이어는 아무것도 외울 필요가 없습니다.
 * 키 안내가 필요한 상호작용은 그만큼 게임이 설명해야 할 것이 하나 느는 일입니다.
 *
 * ── "가만히"의 판정은 속도로 합니다 ────────────────────────────────
 * 위치 변화로 재면 밀려나거나 지형에 끼었을 때도 "움직였다"가 되어
 * 영원히 못 쉽니다. 입력한 속도로 재야 **플레이어의 의도**를 봅니다.
 */
import { BONFIRE } from '../config/balance'
import {
  Actor,
  ActorState,
  Enemy,
  Player,
  Transform,
  Velocity,
} from '../core/components'
import { defineQuery } from '../core/ecs'
import { time } from '../core/time'

/** 레벨에 놓인 화톳불의 위치. 엔티티가 아니라 좌표 목록으로 들고 있습니다. */
export interface Bonfire {
  x: number
  y: number
  z: number
  /** 한 번이라도 불을 붙였는가 — 켜진 화톳불만 부활 지점이 됩니다. */
  lit: boolean
}

export interface RestResult {
  /** 이번 프레임에 휴식이 성사되었는가 */
  rested: boolean
  /**
   * 이번 프레임에 **처음 닿았는가**(불을 붙였는가).
   *
   * 휴식과 분리한 이유가 중요합니다. 자동 플레이 봇을 돌려보니 시작 지점
   * 3.5m 옆의 화톳불을 **체력이 가득한 채로 지나쳐서** 불이 안 켜졌고,
   * 24초 뒤 첫 죽음이 그대로 **게임 오버**가 됐습니다.
   *
   * 부활 지점은 **보상이 아니라 안전망**입니다. 가만히 서서 쉬는 것(회복 +
   * 적 부활)은 여전히 판단이지만, "여기서 다시 시작한다"는 지나가기만 해도
   * 잡혀야 합니다. 안 그러면 처음 하는 사람일수록 안전망 없이 걷게 됩니다.
   */
  litNow: boolean
  /** 지금 가장 가까운 화톳불 (없으면 null) */
  near: Bonfire | null
  /** 휴식까지의 진행도 0~1. HUD가 게이지로 그립니다. */
  progress: number
  /** 적이 가까워서 못 쉬는 상태인가 — 이유를 알려줘야 답답하지 않습니다. */
  blocked: boolean
}

const enemies = defineQuery(Enemy, Transform, Actor)

/**
 * 매 프레임 호출. 휴식 조건을 판정하고 진행도를 갱신합니다.
 * **실제 보상(체력·성수병 회복, 적 부활)은 이 함수가 하지 않습니다** —
 * 그건 레벨 데이터를 아는 게임 루프의 일입니다.
 */
export function bonfireSystem(p: number, fires: Bonfire[]): RestResult {
  const idle: RestResult = { rested: false, litNow: false, near: null, progress: 0, blocked: false }
  if (fires.length === 0) return idle

  const px = Transform.x[p]
  const pz = Transform.z[p]
  const py = Transform.y[p]

  let near: Bonfire | null = null
  let bestD = Infinity
  for (const f of fires) {
    // 높이도 봅니다 — 아래층을 지나갈 때 위층 화톳불이 켜지면 안 됩니다.
    if (Math.abs(f.y - py) > 2.2) continue
    const d = Math.hypot(f.x - px, f.z - pz)
    if (d < bestD) {
      bestD = d
      near = f
    }
  }
  if (!near || bestD > BONFIRE.radius) {
    Player.restT[p] = 0
    return idle
  }

  // 닿기만 해도 불이 붙습니다(위 설계 노트 참고). 회복은 별개입니다.
  const litNow = !near.lit
  near.lit = true

  // 죽었거나 무언가를 하고 있으면 쉬지 않습니다.
  if (Actor.state[p] !== ActorState.Idle) {
    Player.restT[p] = 0
    return { rested: false, litNow, near, progress: 0, blocked: false }
  }

  // 쫓아오는 적이 근처에 있으면 못 쉽니다.
  // **어그로 상태만** 봅니다 — 멀리서 아직 나를 못 본 적까지 세면
  // 넓은 존에서는 쉴 수 있는 순간이 거의 없어집니다.
  const ids = enemies.run()
  let blocked = false
  for (let i = 0; i < enemies.count; i++) {
    const e = ids[i]
    if (Actor.state[e] === ActorState.Dead) continue
    if (Enemy.aggro[e] === 0) continue
    if (Math.hypot(Transform.x[e] - px, Transform.z[e] - pz) <= BONFIRE.safeRadius) {
      blocked = true
      break
    }
  }
  if (blocked) {
    Player.restT[p] = 0
    return { rested: false, litNow, near, progress: 0, blocked: true }
  }

  // 가만히 있는가 — 위치가 아니라 **속도**로 봅니다(위 설계 노트 참고).
  const moving = Math.hypot(Velocity.x[p], Velocity.z[p]) > 0.35
  if (moving) {
    Player.restT[p] = 0
    return { rested: false, litNow, near, progress: 0, blocked: false }
  }

  Player.restT[p] += time.dt
  if (Player.restT[p] >= BONFIRE.restTime) {
    Player.restT[p] = 0
    return { rested: true, litNow, near, progress: 1, blocked: false }
  }
  return {
    rested: false,
    litNow,
    near,
    progress: Player.restT[p] / BONFIRE.restTime,
    blocked: false,
  }
}
