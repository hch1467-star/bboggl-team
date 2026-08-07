import { BOSS, GRUNT, PLAYER } from '../config/balance'
import {
  Actor,
  ActorState,
  AttackPhase,
  Body,
  Enemy,
  EnemyKind,
  Health,
  Player,
  Transform,
  Velocity,
} from '../core/components'
import { defineQuery, hasComponent } from '../core/ecs'

/**
 * 타격 판정 — 플레이어와 적이 **같은 코드**를 씁니다.
 *
 * 설계 근거: 소울라이크에서 "적도 나와 같은 규칙으로 싸운다"는 느낌이 공정함을
 * 만듭니다. 코드를 공유하면 그 공정함이 저절로 보장되고, 밸런스 버그도 반으로 줍니다.
 *
 * 판정 방식은 부채꼴(거리 + 각도)입니다. 물리 충돌체를 휘두르는 방식보다
 * 훨씬 싸고, 프레임레이트에 따라 판정이 달라지는 문제(터널링)가 없습니다.
 */

export interface HitEvent {
  /** 타격 지점(월드) */
  x: number
  y: number
  z: number
  /** 공격자 -> 피격자 방향(정규화) */
  dirX: number
  dirZ: number
  damage: number
  hitstop: number
  trauma: number
  /** 마무리 일격 등 강타 여부 — 데미지 숫자 크기/색이 달라집니다 */
  heavy: boolean
  /** 맞은 쪽이 플레이어인가 */
  victimIsPlayer: boolean
  /** 이 타격으로 처치되었는가 */
  killed: boolean
}

export interface AttackSpec {
  damage: number
  range: number
  arcDeg: number
  knockback: number
  hitstop: number
  trauma: number
  heavy: boolean
}

/** 현재 프레임에 발생한 타격들. 게임 루프가 읽고 비웁니다. */
export const hitEvents: HitEvent[] = []

const attackers = defineQuery(Transform, Actor)
const targets = defineQuery(Transform, Body, Health)
const livingEnemies = defineQuery(Enemy, Health)

function playerSpec(comboIndex: number): AttackSpec {
  const c = PLAYER.combo[Math.min(comboIndex, PLAYER.combo.length - 1)]
  return {
    damage: c.damage,
    range: c.range,
    arcDeg: c.arcDeg,
    knockback: c.knockback,
    hitstop: c.hitstop,
    trauma: c.trauma,
    heavy: comboIndex === PLAYER.combo.length - 1,
  }
}

const GRUNT_SPEC: AttackSpec = {
  damage: GRUNT.damage,
  range: GRUNT.attackReach,
  arcDeg: GRUNT.attackArcDeg,
  knockback: GRUNT.knockback,
  hitstop: 0.05,
  trauma: 0.34,
  heavy: false,
}

/** 보스는 한 대가 무겁습니다 — 정지·흔들림도 그만큼 세게 줍니다. */
const BOSS_SPEC: AttackSpec = {
  damage: BOSS.damage,
  range: BOSS.attackReach,
  arcDeg: BOSS.attackArcDeg,
  knockback: BOSS.knockback,
  hitstop: 0.1,
  trauma: 0.62,
  heavy: true,
}

function enemySpec(e: number): AttackSpec {
  return Enemy.kind[e] === EnemyKind.Boss ? BOSS_SPEC : GRUNT_SPEC
}

function enemyStagger(e: number): number {
  return Enemy.kind[e] === EnemyKind.Boss ? BOSS.hurtStagger : GRUNT.hurtStagger
}

/**
 * active 단계에 들어간 공격을 해석해 피해를 적용합니다.
 * hasHit 플래그 덕분에 active가 여러 프레임 이어져도 한 번만 맞습니다.
 */
export function resolveAttacks(): void {
  const ids = attackers.run()
  const count = attackers.count

  for (let i = 0; i < count; i++) {
    const a = ids[i]
    if (Actor.state[a] !== ActorState.Attack) continue
    if (Actor.phase[a] !== AttackPhase.Active) continue
    if (Actor.hasHit[a] === 1) continue

    const attackerIsPlayer = hasComponent(Player, a)
    const spec = attackerIsPlayer ? playerSpec(Actor.comboIndex[a]) : enemySpec(a)

    const ax = Transform.x[a]
    const az = Transform.z[a]
    const rot = Transform.rotY[a]
    const fx = Math.sin(rot)
    const fz = Math.cos(rot)
    const cosHalfArc = Math.cos((spec.arcDeg * Math.PI) / 180 / 2)

    let connected = false
    const tids = targets.run()
    const tcount = targets.count

    for (let j = 0; j < tcount; j++) {
      const t = tids[j]
      if (t === a) continue

      // 아군 오사 방지 — 플레이어는 적만, 적은 플레이어만 때립니다.
      const targetIsPlayer = hasComponent(Player, t)
      if (attackerIsPlayer === targetIsPlayer) continue
      if (!attackerIsPlayer && !targetIsPlayer) continue

      if (Actor.state[t] === ActorState.Dead) continue
      if (Health.invulnT[t] > 0) continue
      // 회피 구르기의 무적 프레임
      if (targetIsPlayer && isInIFrames(t)) continue

      const dx = Transform.x[t] - ax
      const dz = Transform.z[t] - az
      const dist = Math.hypot(dx, dz)
      // 판정 거리에 대상 반지름을 더합니다. 안 더하면 덩치 큰 적을
      // 코앞에서 때려도 빗나가는 것처럼 느껴집니다.
      if (dist > spec.range + Body.radius[t]) continue

      if (dist > 0.0001) {
        const dot = (dx * fx + dz * fz) / dist
        if (dot < cosHalfArc) continue
      }

      // ---- 명중 ----
      const nx = dist > 0.0001 ? dx / dist : fx
      const nz = dist > 0.0001 ? dz / dist : fz

      Health.hp[t] -= spec.damage
      Health.flashT[t] = 0.12
      Health.invulnT[t] = targetIsPlayer ? PLAYER.invulnAfterHit : 0.04

      // 넉백은 전용 채널에 넣습니다. 이동 속도에 더하면 이동 제어 로직이
      // 즉시 지워버려서 밀려나는 연출이 안 보입니다.
      Velocity.kx[t] += nx * spec.knockback
      Velocity.kz[t] += nz * spec.knockback

      const killed = Health.hp[t] <= 0
      if (!killed) {
        // 경직: 공격 중이던 적도 끊깁니다 = 플레이어가 선공으로 흐름을 끊을 수 있음
        Actor.state[t] = ActorState.Stagger
        Actor.timer[t] = targetIsPlayer ? PLAYER.hurtStagger : enemyStagger(t)
        Actor.hasHit[t] = 0
        Actor.comboWindowT[t] = 0
        Actor.bufferedAttack[t] = 0
      }

      hitEvents.push({
        x: Transform.x[t],
        y: Body.height[t] * 0.6,
        z: Transform.z[t],
        dirX: nx,
        dirZ: nz,
        damage: spec.damage,
        hitstop: spec.hitstop,
        trauma: spec.trauma,
        heavy: spec.heavy,
        victimIsPlayer: targetIsPlayer,
        killed,
      })

      connected = true
    }

    if (connected) Actor.hasHit[a] = 1
  }
}

/** 회피 구르기 무적 프레임 판정 */
export function isInIFrames(e: number): boolean {
  if (!hasComponent(Player, e)) return false
  if (Actor.state[e] !== ActorState.Dodge) return false
  const t = Player.dodgeElapsed[e]
  return t >= PLAYER.dodge.iFrameStart && t <= PLAYER.dodge.iFrameEnd
}

/** 적 개체 수 — HUD/웨이브 로직용 */
export function countLivingEnemies(): number {
  const ids = livingEnemies.run()
  let n = 0
  for (let i = 0; i < livingEnemies.count; i++) {
    if (Actor.state[ids[i]] !== ActorState.Dead) n++
  }
  return n
}
