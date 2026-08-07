import { Actor, ActorState, Health, Player, Transform } from '../core/components'
import { defineQuery, hasComponent } from '../core/ecs'
import { time } from '../core/time'

/**
 * 체력 관련 타이머 처리와 사망 판정.
 *
 * 타이머는 realDt가 아니라 dt(시뮬레이션 시간)로 줄입니다.
 * 히트스톱 중에 무적 시간이 흐르면, 정지 시간이 길수록 무적이 짧아지는
 * 이상한 일이 벌어집니다.
 *
 * 단, 피격 플래시(flashT)만은 realDt를 씁니다 — 이건 연출이라
 * 히트스톱 중에도 눈에 보여야 합니다.
 */

export interface DeathEvent {
  entity: number
  x: number
  z: number
  isPlayer: boolean
}

const alive = defineQuery(Health, Actor, Transform)

export const deathEvents: DeathEvent[] = []

export function healthSystem(): void {
  const ids = alive.run()
  for (let i = 0; i < alive.count; i++) {
    const e = ids[i]

    if (Health.flashT[e] > 0) {
      Health.flashT[e] = Math.max(0, Health.flashT[e] - time.realDt)
    }
    if (time.dt > 0 && Health.invulnT[e] > 0) {
      Health.invulnT[e] = Math.max(0, Health.invulnT[e] - time.dt)
    }

    if (Health.hp[e] <= 0 && Actor.state[e] !== ActorState.Dead) {
      Health.hp[e] = 0
      Actor.state[e] = ActorState.Dead
      Actor.timer[e] = 0
      deathEvents.push({
        entity: e,
        x: Transform.x[e],
        z: Transform.z[e],
        isPlayer: hasComponent(Player, e),
      })
    }
  }
}
