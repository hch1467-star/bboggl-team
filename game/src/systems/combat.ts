import type { SkillShape } from '../config/arsenal'
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
import { time } from '../core/time'
import { skillForSlot, weaponOf } from './loadout'

/**
 * 타격 판정 — 플레이어와 적이 **같은 코드**를 씁니다.
 *
 * 설계 근거: 소울라이크에서 "적도 나와 같은 규칙으로 싸운다"는 느낌이 공정함을
 * 만듭니다. 코드를 공유하면 그 공정함이 저절로 보장되고, 밸런스 버그도 반으로 줍니다.
 *
 * 판정 도형은 세 가지입니다:
 *   cone   — 시전자 앞 부채꼴 (기본 공격, 대부분의 근접 스킬)
 *   circle — 시전자 중심 원 (회전 베기, 충격파)
 *   point  — 지정한 좌표 중심 원 (로스트아크식 바닥 장판)
 *
 * 물리 충돌체를 휘두르는 방식보다 훨씬 싸고, 프레임레이트에 따라 판정이
 * 달라지는 문제(터널링)가 없습니다.
 */

export interface HitEvent {
  x: number
  y: number
  z: number
  /** 공격자 -> 피격자 방향(정규화) */
  dirX: number
  dirZ: number
  /** 음수면 회복입니다 */
  damage: number
  hitstop: number
  trauma: number
  /** 강타 여부 — 데미지 숫자 크기/색이 달라집니다 */
  heavy: boolean
  victimIsPlayer: boolean
  killed: boolean
}

export interface AttackSpec {
  shape: SkillShape
  damage: number
  /** cone = 사거리 / circle·point = 반경 */
  range: number
  arcDeg: number
  knockback: number
  hitstop: number
  trauma: number
  heavy: boolean
  /** 다단히트 횟수 */
  hits: number
  /** 판정 중심 (point 스킬용). 없으면 시전자 위치. */
  originX?: number
  originZ?: number
  healSelf: number
}

/** 현재 프레임에 발생한 타격들. 게임 루프가 읽고 비웁니다. */
export const hitEvents: HitEvent[] = []

const attackers = defineQuery(Transform, Actor)
const targets = defineQuery(Transform, Body, Health)
const livingEnemies = defineQuery(Enemy, Health)

function comboSpec(e: number, comboIndex: number): AttackSpec {
  const weapon = weaponOf(e)
  const c = weapon.combo[Math.min(comboIndex, weapon.combo.length - 1)]
  return {
    shape: 'cone',
    damage: c.damage,
    range: c.range,
    arcDeg: c.arcDeg,
    knockback: c.knockback,
    hitstop: c.hitstop,
    trauma: c.trauma,
    heavy: comboIndex === weapon.combo.length - 1,
    hits: 1,
    healSelf: 0,
  }
}

function skillSpec(e: number, slot: number): AttackSpec | null {
  const def = skillForSlot(e, slot)
  if (!def) return null
  return {
    shape: def.shape,
    damage: def.damage,
    range: def.range,
    arcDeg: def.arcDeg,
    knockback: def.knockback,
    hitstop: def.hitstop,
    trauma: def.trauma,
    heavy: def.damage >= 35,
    hits: Math.max(1, def.hits),
    originX: def.shape === 'point' ? Player.castX[e] : undefined,
    originZ: def.shape === 'point' ? Player.castZ[e] : undefined,
    healSelf: def.healSelf,
  }
}

const GRUNT_SPEC: AttackSpec = {
  shape: 'cone',
  damage: GRUNT.damage,
  range: GRUNT.attackReach,
  arcDeg: GRUNT.attackArcDeg,
  knockback: GRUNT.knockback,
  hitstop: 0.05,
  trauma: 0.34,
  heavy: false,
  hits: 1,
  healSelf: 0,
}

/** 보스는 한 대가 무겁습니다 — 정지·흔들림도 그만큼 세게 줍니다. */
const BOSS_SPEC: AttackSpec = {
  shape: 'cone',
  damage: BOSS.damage,
  range: BOSS.attackReach,
  arcDeg: BOSS.attackArcDeg,
  knockback: BOSS.knockback,
  hitstop: 0.1,
  trauma: 0.62,
  heavy: true,
  hits: 1,
  healSelf: 0,
}

function enemySpec(e: number): AttackSpec {
  return Enemy.kind[e] === EnemyKind.Boss ? BOSS_SPEC : GRUNT_SPEC
}

function enemyStagger(e: number): number {
  return Enemy.kind[e] === EnemyKind.Boss ? BOSS.hurtStagger : GRUNT.hurtStagger
}

/** 이 프레임에 이 액터가 쓰고 있는 공격의 제원. */
export function currentSpec(a: number): AttackSpec | null {
  const state = Actor.state[a] as ActorState
  if (state === ActorState.Attack) {
    return hasComponent(Player, a) ? comboSpec(a, Actor.comboIndex[a]) : enemySpec(a)
  }
  if (state === ActorState.Skill) return skillSpec(a, Actor.skillSlot[a])
  return null
}

/**
 * active 단계에 들어간 공격을 해석해 피해를 적용합니다.
 * hitsLeft / nextHitT 로 다단히트를 처리합니다 — 1히트 공격도 같은 코드를 씁니다.
 */
export function resolveAttacks(): void {
  const dt = time.dt
  const ids = attackers.run()
  const count = attackers.count

  for (let i = 0; i < count; i++) {
    const a = ids[i]
    const state = Actor.state[a] as ActorState
    if (state !== ActorState.Attack && state !== ActorState.Skill) continue
    if (Actor.phase[a] !== AttackPhase.Active) continue
    if (Actor.hitsLeft[a] === 0) continue

    if (Actor.nextHitT[a] > 0) {
      Actor.nextHitT[a] = Math.max(0, Actor.nextHitT[a] - dt)
      continue
    }

    const spec = currentSpec(a)
    if (!spec) {
      Actor.hitsLeft[a] = 0
      continue
    }

    applyHit(a, spec)
    Actor.hitsLeft[a] = Math.max(0, Actor.hitsLeft[a] - 1)
    if (Actor.hitsLeft[a] > 0) {
      // 남은 타격을 active 구간에 균등 분배합니다.
      Actor.nextHitT[a] = activeDurationOf(a) / spec.hits
    }
  }
}

function activeDurationOf(a: number): number {
  if (Actor.state[a] === ActorState.Skill) {
    return skillForSlot(a, Actor.skillSlot[a])?.active ?? 0.1
  }
  if (hasComponent(Player, a)) {
    const weapon = weaponOf(a)
    return weapon.combo[Math.min(Actor.comboIndex[a], weapon.combo.length - 1)].active
  }
  return Enemy.kind[a] === EnemyKind.Boss ? BOSS.active : GRUNT.active
}

function applyHit(a: number, spec: AttackSpec): void {
  const attackerIsPlayer = hasComponent(Player, a)

  if (spec.healSelf > 0 && hasComponent(Health, a)) {
    Health.hp[a] = Math.min(Health.max[a], Health.hp[a] + spec.healSelf)
    hitEvents.push({
      x: Transform.x[a],
      y: Body.height[a] * 0.8,
      z: Transform.z[a],
      dirX: 0,
      dirZ: 0,
      damage: -spec.healSelf,
      hitstop: 0,
      trauma: 0,
      heavy: false,
      victimIsPlayer: attackerIsPlayer,
      killed: false,
    })
  }

  if (spec.damage <= 0) return

  const originX = spec.originX ?? Transform.x[a]
  const originZ = spec.originZ ?? Transform.z[a]
  const rot = Transform.rotY[a]
  const fx = Math.sin(rot)
  const fz = Math.cos(rot)
  const cosHalfArc = Math.cos((spec.arcDeg * Math.PI) / 180 / 2)

  const tids = targets.run()
  const tcount = targets.count

  for (let j = 0; j < tcount; j++) {
    const t = tids[j]
    if (t === a) continue

    // 아군 오사 방지 — 플레이어는 적만, 적은 플레이어만 때립니다.
    const targetIsPlayer = hasComponent(Player, t)
    if (attackerIsPlayer === targetIsPlayer) continue

    if (Actor.state[t] === ActorState.Dead) continue
    if (Health.invulnT[t] > 0) continue
    if (targetIsPlayer && isInIFrames(t)) continue

    const dx = Transform.x[t] - originX
    const dz = Transform.z[t] - originZ
    const dist = Math.hypot(dx, dz)
    // 판정 거리에 대상 반지름을 더합니다. 안 더하면 덩치 큰 적을
    // 코앞에서 때려도 빗나가는 것처럼 느껴집니다.
    if (dist > spec.range + Body.radius[t]) continue

    // cone 만 각도 검사를 합니다. circle/point 는 반경 안이면 전부 맞습니다.
    if (spec.shape === 'cone' && dist > 0.0001) {
      const dot = (dx * fx + dz * fz) / dist
      if (dot < cosHalfArc) continue
    }

    // 넉백 방향: point 스킬은 착탄점 바깥으로 밀어야 자연스럽습니다.
    const nx = dist > 0.0001 ? dx / dist : fx
    const nz = dist > 0.0001 ? dz / dist : fz

    Health.hp[t] -= spec.damage
    Health.flashT[t] = 0.12
    // 다단히트 스킬은 무적 시간을 아주 짧게 줘야 두 번째 타격이 씹히지 않습니다.
    Health.invulnT[t] = targetIsPlayer ? PLAYER.invulnAfterHit : 0.02

    // 넉백은 전용 채널에 넣습니다. 이동 속도에 더하면 이동 제어 로직이
    // 즉시 지워버려서 밀려나는 연출이 안 보입니다.
    Velocity.kx[t] += nx * spec.knockback
    Velocity.kz[t] += nz * spec.knockback

    const killed = Health.hp[t] <= 0
    if (!killed) {
      // 경직: 공격 중이던 적도 끊깁니다 = 플레이어가 선공으로 흐름을 끊을 수 있음
      Actor.state[t] = ActorState.Stagger
      Actor.timer[t] = targetIsPlayer ? PLAYER.hurtStagger : enemyStagger(t)
      Actor.hitsLeft[t] = 0
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
  }
}

/** 회피 구르기 무적 프레임 + 대시 스킬 무적 프레임 */
export function isInIFrames(e: number): boolean {
  if (!hasComponent(Player, e)) return false
  if (Actor.state[e] === ActorState.Dodge) {
    const t = Player.dodgeElapsed[e]
    return t >= PLAYER.dodge.iFrameStart && t <= PLAYER.dodge.iFrameEnd
  }
  if (Actor.state[e] === ActorState.Skill) {
    const def = skillForSlot(e, Actor.skillSlot[e])
    if (!def?.iFrames) return false
    // 스킬 시전 경과도 dodgeElapsed 필드를 재사용합니다 (둘은 동시에 일어나지 않음).
    const elapsed = Player.dodgeElapsed[e]
    return elapsed >= def.iFrames[0] && elapsed <= def.iFrames[1]
  }
  return false
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
