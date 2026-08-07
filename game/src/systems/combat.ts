import type { SkillShape } from '../config/arsenal'
import { BOSS, COMBAT, GRUNT, PLAYER } from '../config/balance'
import {
  Actor,
  ActorState,
  AttackPhase,
  Body,
  Enemy,
  EnemyKind,
  Health,
  Player,
  Status,
  Transform,
  Velocity,
} from '../core/components'
import { attackAt } from '../config/enemyAttacks'
import { defineQuery, hasComponent } from '../core/ecs'
import { combatRng } from '../core/rng'
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
  /** 등 뒤에서 꽂았는가 (기둥 3) */
  back: boolean
  /** 치명타인가 */
  crit: boolean
  victimIsPlayer: boolean
  killed: boolean
}

/**
 * 대상의 **등 뒤 부채꼴** 안에서 때렸는지.
 *
 * 대상이 바라보는 방향의 정반대 COMBAT.backArcDeg 안에 공격자가 있으면 백어택입니다.
 * 판정을 "공격 방향"이 아니라 **"내가 서 있는 위치"**로 재는 것이 중요합니다.
 * 공격 방향으로 재면 제자리에서 마우스만 돌려도 백어택이 터져서,
 * 이동해서 등 뒤를 잡는다는 기둥 3의 의미가 사라집니다.
 */
export function isBehindPoint(
  attackerX: number,
  attackerZ: number,
  targetX: number,
  targetZ: number,
  targetRotY: number,
): boolean {
  const dx = attackerX - targetX
  const dz = attackerZ - targetZ
  const dist = Math.hypot(dx, dz)
  if (dist < 0.0001) return false
  const fx = Math.sin(targetRotY)
  const fz = Math.cos(targetRotY)
  const dot = (dx * fx + dz * fz) / dist
  // 후방 부채꼴의 절반 각도까지가 등 뒤입니다.
  return dot <= -Math.cos(((COMBAT.backArcDeg / 2) * Math.PI) / 180)
}

export function isBackAttack(attacker: number, target: number): boolean {
  return isBehindPoint(
    Transform.x[attacker],
    Transform.z[attacker],
    Transform.x[target],
    Transform.z[target],
    Transform.rotY[target],
  )
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
  /** 🔵 맞은 대상을 묶는 시간(초) */
  snare?: number
  /** 🟣 맞은 대상을 공격자 쪽으로 끌어당기는 세기(m/s) */
  pull?: number
}

/** 현재 프레임에 발생한 타격들. 게임 루프가 읽고 비웁니다. */
export const hitEvents: HitEvent[] = []

const attackers = defineQuery(Transform, Actor)
const targets = defineQuery(Transform, Body, Health)
const livingEnemies = defineQuery(Enemy, Health, Transform, Body, Actor)

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
    // 플레이어도 적을 묶을 수 있습니다(발목 긋기). 적이 나에게 쓰는 수단을
    // 나도 쓴다 — 같은 코드, 같은 규칙입니다.
    snare: def.snare > 0 ? def.snare : undefined,
  }
}

/**
 * 적의 공격 제원은 **지금 시전 중인 패턴**에서 나옵니다 (enemyAttacks.ts).
 *
 * 예전에는 적 종류마다 고정 제원 하나였습니다. 그러면 예고 색을 나눠도
 * 실제 판정은 늘 같아서, 색이 **거짓말**을 하게 됩니다 — 노랑(넓음)을 띄워놓고
 * 실제로는 빨강과 같은 좁은 부채꼴로 때리는 식으로요.
 * 예고와 판정이 같은 데이터에서 나와야 색을 믿을 수 있습니다.
 */
function enemySpec(e: number): AttackSpec {
  const isBoss = Enemy.kind[e] === EnemyKind.Boss
  const def = attackAt(isBoss, Enemy.attackIndex[e])
  return {
    // 360°짜리 전방위 패턴은 각도 검사를 건너뛰도록 circle로 넘깁니다.
    shape: def.arcDeg >= 359 ? 'circle' : 'cone',
    damage: def.damage,
    range: def.reach,
    arcDeg: def.arcDeg,
    knockback: def.knockback,
    hitstop: isBoss ? 0.1 : 0.05,
    trauma: isBoss ? 0.62 : 0.34,
    heavy: isBoss,
    hits: 1,
    healSelf: 0,
    snare: def.snare,
    pull: def.pull,
  }
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
      back: false,
      crit: false,
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
  const halfArc = (spec.arcDeg * Math.PI) / 180 / 2

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

    /**
     * cone 만 각도 검사를 합니다. circle/point 는 반경 안이면 전부 맞습니다.
     *
     * ── 대상의 **굵기**를 각도에도 반영합니다 ────────────────────────
     * 플레이 테스트: "공격범위 이펙트에 히트박스가 좀 어색해, 제대로 안 맞는 느낌."
     *
     * 원인은 판정의 **비대칭**이었습니다:
     *   · 거리는 관대 — `range + Body.radius` 로 대상의 굵기를 더해 줍니다
     *   · 각도는 엄격 — 대상의 **중심**이 부채꼴 안에 있어야만 했습니다
     *
     * 그래서 적의 몸통이 초승달에 뻔히 겹쳐 보이는데도 중심이 부채꼴 밖이면
     * 빗나갔습니다. 보이는 것과 판정이 어긋나니 "왜 안 맞지"가 됩니다.
     *
     * 반지름 r인 물체는 거리 d에서 ±atan(r/d) 만큼의 각도를 차지합니다.
     * 그만큼 부채꼴을 넓혀 주면 **"몸이 겹치면 맞는다"** 가 성립합니다.
     * 임의의 보정값이 아니라 기하학적으로 옳은 값이라는 점이 중요합니다 —
     * 가까울수록 많이, 멀수록 적게 넓어져서 저절로 자연스러워집니다.
     */
    if (spec.shape === 'cone' && dist > 0.0001) {
      const dot = (dx * fx + dz * fz) / dist
      const slack = Math.atan2(Body.radius[t], dist)
      if (dot < Math.cos(Math.min(Math.PI, halfArc + slack))) continue
    }

    // 넉백 방향: point 스킬은 착탄점 바깥으로 밀어야 자연스럽습니다.
    const nx = dist > 0.0001 ? dx / dist : fx
    const nz = dist > 0.0001 ? dz / dist : fz

    // ---- 포지셔닝 보상 (기둥 3) ----
    // 근접 부채꼴 공격에만 적용합니다. 광역기(원형/지점)까지 등 뒤 보너스를 주면
    // "위치를 잡는 기술"이 아니라 "장판을 크게 까는 기술"이 최적이 되어버립니다.
    const back =
      attackerIsPlayer && !targetIsPlayer && spec.shape === 'cone' && isBackAttack(a, t)
    const critChance = COMBAT.baseCritChance + (back ? COMBAT.backCritBonus : 0)
    const crit = spec.damage > 0 && combatRng.chance(critChance)

    let damage = spec.damage
    if (back) damage *= COMBAT.backDamageMult
    if (crit) damage *= COMBAT.critMult

    Health.hp[t] -= damage
    Health.flashT[t] = 0.12
    // 다단히트 스킬은 무적 시간을 아주 짧게 줘야 두 번째 타격이 씹히지 않습니다.
    Health.invulnT[t] = targetIsPlayer ? PLAYER.invulnAfterHit : 0.02

    // 넉백은 전용 채널에 넣습니다. 이동 속도에 더하면 이동 제어 로직이
    // 즉시 지워버려서 밀려나는 연출이 안 보입니다.
    Velocity.kx[t] += nx * spec.knockback
    Velocity.kz[t] += nz * spec.knockback

    // ---- 🟣 끌어당김 — 넉백의 부호를 뒤집습니다 ----
    // 같은 채널을 쓰므로 "밀려남"과 정확히 같은 감쇠 곡선을 탑니다.
    // 별도 처리를 만들면 두 힘이 서로 다른 물리로 움직여 어색해집니다.
    if (spec.pull && spec.pull > 0) {
      Velocity.kx[t] -= nx * spec.pull
      Velocity.kz[t] -= nz * spec.pull
    }

    // ---- 🔵 속박 ----
    // 피해가 아니라 **다음 공격을 못 피하게 만드는 것**이 이 공격의 위협입니다.
    if (spec.snare && spec.snare > 0 && hasComponent(Status, t)) {
      Status.snareT[t] = Math.max(Status.snareT[t], spec.snare)
    }

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
      damage,
      // 제대로 꽂혔을 때 정지와 흔들림을 더 줍니다 — 손으로 느껴지는 보상.
      hitstop: spec.hitstop + (back ? COMBAT.backHitstopBonus : 0),
      trauma: spec.trauma + (back ? COMBAT.backTraumaBonus : 0),
      heavy: spec.heavy || crit,
      back,
      crit,
      victimIsPlayer: targetIsPlayer,
      killed,
    })
  }
}

/**
 * 조준 보정 (소프트 락온).
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 플레이 테스트: **"아예 논타겟팅인 만큼 맞추기가 좀 어려워."**
 *
 * 감으로 고치지 않고 재봤습니다. "커서가 적에서 몇 도까지 빗나가도 맞는가":
 *
 *     롱소드        0°  10°  20°  30°  40°
 *       1.6m         O   O   .   .   .     <- 코앞이 제일 어렵다
 *       2.4m         O   O   O   O   .
 *
 * **가까울수록 어려운** 이상한 결과가 나왔고, 원인은 파고들기였습니다.
 * 공격을 시작하면 커서 방향으로 1.5m를 파고드는데, 커서가 빗나가 있으면
 * 그 빗나간 방향으로 파고들어 **코앞의 적을 지나쳐 버립니다.**
 * 조준이 조금 틀린 것이 위치까지 틀어지면서 두 배로 벌어진 것입니다.
 *
 * ── 보정하되, 조준을 무의미하게 만들지는 않습니다 ──────────────────
 * 완전 자동 조준은 기둥 3(포지셔닝이 보상받는다)을 무너뜨립니다.
 * 그래서 **이미 대충 맞게 겨눈 경우에만** 마무리를 다듬어 줍니다:
 *  · 조준선에서 ASSIST_ARC 안에 있는 적만 후보
 *  · 사거리 안(+여유)에 있는 적만 후보
 *  · 여럿이면 **조준선에 가장 가까운** 적 (거리순이 아닙니다 —
 *    거리순으로 하면 겨눈 적을 두고 옆의 다른 적을 치는 배신이 일어납니다)
 *
 * 백어택은 **위치**로 판정하므로(isBehindPoint) 이 보정이 기둥 3을 건드리지
 * 않습니다. 몸이 도는 것뿐이고, 등 뒤로 돌아가는 일은 여전히 발로 해야 합니다.
 */
const ASSIST_ARC = (48 * Math.PI) / 180
/** 사거리 밖이어도 이만큼까지는 후보로 봅니다(파고들며 닿는 거리). */
const ASSIST_REACH_MARGIN = 1.4

export interface AimAssist {
  /** 보정된 몸 방향(라디안) */
  rot: number
  /** 보정 대상까지의 거리(m). 대상이 없으면 Infinity. */
  dist: number
}

export function assistAim(px: number, pz: number, aimRot: number, reach: number): AimAssist {
  const ids = livingEnemies.run()
  const maxDist = reach + ASSIST_REACH_MARGIN
  let bestRot = aimRot
  let bestDist = Infinity
  let bestOff = ASSIST_ARC
  for (let i = 0; i < livingEnemies.count; i++) {
    const e = ids[i]
    if (Actor.state[e] === ActorState.Dead) continue
    const dx = Transform.x[e] - px
    const dz = Transform.z[e] - pz
    const dist = Math.hypot(dx, dz)
    if (dist < 0.0001 || dist > maxDist + Body.radius[e]) continue
    const rot = Math.atan2(dx, dz)
    let off = rot - aimRot
    while (off > Math.PI) off -= Math.PI * 2
    while (off < -Math.PI) off += Math.PI * 2
    off = Math.abs(off)
    if (off < bestOff) {
      bestOff = off
      bestRot = rot
      bestDist = dist
    }
  }
  return { rot: bestRot, dist: bestDist }
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
