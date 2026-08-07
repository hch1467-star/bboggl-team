import { WORLD } from '../config/balance'
import { Actor, ActorState, Body, Player, Transform, Velocity } from '../core/components'
import { defineQuery, hasComponent } from '../core/ecs'
import { time } from '../core/time'

/**
 * 이동 적분 + 밀어내기 + 아레나 경계.
 *
 * 밀어내기(separation)가 왜 필요한가:
 * 적들이 모두 플레이어를 향해 직진하면 전부 한 점에 겹쳐 쌓입니다.
 * 화면에는 적 1마리처럼 보이는데 데미지는 10배로 들어오는, 최악의 상태가 됩니다.
 * 서로 밀어내면 자연스럽게 반원으로 둘러싸는 대형이 만들어집니다.
 *
 * 성능 노트: 지금은 O(n²) 전수 비교입니다. n이 30 이하면 문제없지만
 * M3에서 적을 수백 마리로 늘릴 때는 공간 해시(spatial hash)로 교체해야 합니다.
 */

const bodies = defineQuery(Transform, Body, Velocity)

/** 넉백 감쇠율(1/초). 클수록 빨리 멈춥니다. */
const KNOCKBACK_DECAY = 7

export function physicsSystem(): void {
  const dt = time.dt
  if (dt <= 0) return

  const ids = bodies.run()
  const count = bodies.count

  // ---- 1. 겹침 해소 ----
  for (let i = 0; i < count; i++) {
    const a = ids[i]
    if (Actor.state[a] === ActorState.Dead) continue
    for (let j = i + 1; j < count; j++) {
      const b = ids[j]
      if (Actor.state[b] === ActorState.Dead) continue

      const dx = Transform.x[b] - Transform.x[a]
      const dz = Transform.z[b] - Transform.z[a]
      const minDist = Body.radius[a] + Body.radius[b]
      const distSq = dx * dx + dz * dz
      if (distSq >= minDist * minDist) continue

      const dist = Math.sqrt(distSq)
      // 완전히 겹친 경우(거리 0)는 방향을 만들 수 없으니 임의로 갈라 놓습니다.
      const nx = dist > 0.0001 ? dx / dist : 1
      const nz = dist > 0.0001 ? dz / dist : 0
      const overlap = minDist - dist

      // 플레이어는 무겁게 취급합니다. 적 떼에 밀려 아레나 밖으로
      // 떠내려가는 것을 막고, 조작 주도권을 플레이어에게 남겨 둡니다.
      const aIsPlayer = hasComponent(Player, a)
      const bIsPlayer = hasComponent(Player, b)
      let wa = 0.5
      let wb = 0.5
      if (aIsPlayer && !bIsPlayer) {
        wa = 0.2
        wb = 0.8
      } else if (bIsPlayer && !aIsPlayer) {
        wa = 0.8
        wb = 0.2
      }

      Transform.x[a] -= nx * overlap * wa
      Transform.z[a] -= nz * overlap * wa
      Transform.x[b] += nx * overlap * wb
      Transform.z[b] += nz * overlap * wb
    }
  }

  // ---- 2. 적분 + 넉백 감쇠 + 경계 ----
  const decay = Math.exp(-KNOCKBACK_DECAY * dt)
  for (let i = 0; i < count; i++) {
    const e = ids[i]

    Transform.x[e] += (Velocity.x[e] + Velocity.kx[e]) * dt
    Transform.z[e] += (Velocity.z[e] + Velocity.kz[e]) * dt

    Velocity.kx[e] *= decay
    Velocity.kz[e] *= decay
    if (Math.abs(Velocity.kx[e]) < 0.01) Velocity.kx[e] = 0
    if (Math.abs(Velocity.kz[e]) < 0.01) Velocity.kz[e] = 0

    // 원형 아레나 밖으로 못 나가게 클램프
    const limit = WORLD.arenaRadius - Body.radius[e]
    const distSq = Transform.x[e] * Transform.x[e] + Transform.z[e] * Transform.z[e]
    if (distSq > limit * limit) {
      const dist = Math.sqrt(distSq)
      const s = limit / dist
      Transform.x[e] *= s
      Transform.z[e] *= s
      // 벽에 붙어 진동하지 않도록 벽을 향한 속도 성분을 제거합니다.
      const nx = Transform.x[e] / limit
      const nz = Transform.z[e] / limit
      const vDotN = Velocity.x[e] * nx + Velocity.z[e] * nz
      if (vDotN > 0) {
        Velocity.x[e] -= nx * vDotN
        Velocity.z[e] -= nz * vDotN
      }
      const kDotN = Velocity.kx[e] * nx + Velocity.kz[e] * nz
      if (kDotN > 0) {
        Velocity.kx[e] -= nx * kDotN
        Velocity.kz[e] -= nz * kDotN
      }
    }
  }
}
