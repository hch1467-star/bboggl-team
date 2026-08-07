import { BOSS, GRUNT } from '../config/balance'
import {
  Actor,
  ActorState,
  AttackPhase,
  Enemy,
  EnemyKind,
  Health,
  Transform,
  Velocity,
} from '../core/components'
import { defineQuery, isAlive } from '../core/ecs'
import { time } from '../core/time'

/**
 * 잡몹 AI — 추격 → 예고 → 공격 → 후딜.
 *
 * 설계 근거: 소울라이크에서 적은 "강해서" 재미있는 게 아니라
 * **읽을 수 있어서** 재미있습니다. 그래서 세 가지를 지킵니다.
 *
 *  1) 긴 선행동작(0.55초): 사람이 보고 반응해서 구를 수 있는 최소 시간입니다.
 *     0.2초로 줄이면 즉시 "이건 불공정하다"고 느껴집니다.
 *  2) 선행동작 중 추적 회전을 크게 줄입니다: 완전히 안 돌면 옆으로 걷기만 해도
 *     피해지고, 끝까지 따라 돌면 회피가 무의미해집니다. 30%가 그 사이입니다.
 *  3) 긴 후딜(0.7초): 적의 공격을 피한 뒤 **반격할 창**이 생깁니다.
 *     이 창이 없으면 회피에 보상이 없어서 그냥 도망 다니는 게 최적이 됩니다.
 */

/**
 * AI 일시정지 스위치.
 *
 * 전투 판정(백어택 등)을 검증하려면 적이 가만히 있어야 합니다.
 * 적이 계속 몸을 돌리면 "등 뒤를 쳤는데 왜 보너스가 안 붙지?"를
 * 판정 버그 때문인지 타이밍 때문인지 구분할 수가 없습니다.
 * 밸런스를 손으로 만져볼 때도 필요해서 정식 기능으로 둡니다.
 */
let aiEnabled = true

export function setEnemyAiEnabled(enabled: boolean): void {
  aiEnabled = enabled
}

export interface EnemyAiContext {
  onSwing: (x: number, z: number, rotY: number, range: number, arcDeg: number) => void
}

const enemies = defineQuery(Enemy, Actor, Transform, Velocity, Health)

const DEG = Math.PI / 180
/** 이 각도 안에 플레이어가 들어와야 공격을 시작합니다(뒤통수에 대고 휘두르지 않도록). */
const ATTACK_FACING_TOLERANCE = 45 * DEG

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

export function enemyAiSystem(
  playerEntity: number,
  playerAlive: boolean,
  ctx: EnemyAiContext,
): void {
  const dt = time.dt
  if (dt <= 0) return // 히트스톱 중엔 AI도 멈춥니다
  if (!aiEnabled) return

  const px = Transform.x[playerEntity]
  const pz = Transform.z[playerEntity]
  const ids = enemies.run()

  for (let i = 0; i < enemies.count; i++) {
    const e = ids[i]
    if (!isAlive(e)) continue
    if (Actor.state[e] === ActorState.Dead) continue

    // 잡몹과 보스는 같은 코드를 쓰고 수치표만 갈아 끼웁니다.
    // 이렇게 해두면 새 적을 추가할 때 AI 코드를 건드릴 필요가 없습니다.
    const cfg = Enemy.kind[e] === EnemyKind.Boss ? BOSS : GRUNT

    if (Actor.cooldownT[e] > 0) Actor.cooldownT[e] = Math.max(0, Actor.cooldownT[e] - dt)

    // 경직 중에는 아무것도 못 합니다 — 플레이어가 흐름을 끊을 수 있는 근거
    if (Actor.state[e] === ActorState.Stagger) {
      Actor.timer[e] -= dt
      if (Actor.timer[e] <= 0) Actor.state[e] = ActorState.Idle
      decayVelocity(e, dt, 9)
      continue
    }

    const dx = px - Transform.x[e]
    const dz = pz - Transform.z[e]
    const dist = Math.hypot(dx, dz)
    const toPlayer = Math.atan2(dx, dz)

    if (!playerAlive) {
      Enemy.aggro[e] = 0
      decayVelocity(e, dt, 5)
      continue
    }

    if (Enemy.aggro[e] === 0 && dist <= cfg.aggroRange) Enemy.aggro[e] = 1

    if (Enemy.aggro[e] === 0) {
      decayVelocity(e, dt, 5)
      continue
    }

    if (Actor.state[e] === ActorState.Attack) {
      const phase = Actor.phase[e] as AttackPhase

      if (phase === AttackPhase.Windup) {
        turnToward(e, toPlayer, cfg.turnSpeedDeg * 0.3, dt)
      }
      // 공격 중에는 발이 묶입니다 — 적도 커밋합니다
      decayVelocity(e, dt, 12)

      Actor.timer[e] -= dt
      if (Actor.timer[e] <= 0) {
        if (phase === AttackPhase.Windup) {
          Actor.phase[e] = AttackPhase.Active
          Actor.timer[e] = cfg.active
          Actor.hitsLeft[e] = 1
          Actor.nextHitT[e] = 0
          ctx.onSwing(
            Transform.x[e],
            Transform.z[e],
            Transform.rotY[e],
            cfg.attackReach,
            cfg.attackArcDeg,
          )
        } else if (phase === AttackPhase.Active) {
          Actor.phase[e] = AttackPhase.Recovery
          Actor.timer[e] = cfg.recovery
        } else {
          Actor.state[e] = ActorState.Idle
          Actor.cooldownT[e] = cfg.attackCooldown
        }
      }
      continue
    }

    // ---- Idle: 추격하거나 공격을 시작 ----
    turnToward(e, toPlayer, cfg.turnSpeedDeg, dt)

    const facingError = Math.abs(wrapAngle(toPlayer - Transform.rotY[e]))
    const inRange = dist <= cfg.attackRange

    if (inRange && Actor.cooldownT[e] <= 0 && facingError <= ATTACK_FACING_TOLERANCE) {
      Actor.state[e] = ActorState.Attack
      Actor.phase[e] = AttackPhase.Windup
      Actor.timer[e] = cfg.windup
      Actor.hitsLeft[e] = 1
          Actor.nextHitT[e] = 0
      decayVelocity(e, dt, 12)
      continue
    }

    if (inRange) {
      // 사거리 안이지만 쿨다운 중 — 제자리에서 노려봅니다.
      // 계속 파고들면 플레이어가 적 무리에 파묻혀 아무것도 안 보이게 됩니다.
      decayVelocity(e, dt, 8)
    } else {
      const nx = dist > 0.0001 ? dx / dist : 0
      const nz = dist > 0.0001 ? dz / dist : 0
      const accel = 26 * dt
      Velocity.x[e] += clampMag(nx * cfg.moveSpeed - Velocity.x[e], accel)
      Velocity.z[e] += clampMag(nz * cfg.moveSpeed - Velocity.z[e], accel)
    }
  }
}

function turnToward(e: number, targetRot: number, speedDegPerSec: number, dt: number): void {
  const diff = wrapAngle(targetRot - Transform.rotY[e])
  const maxStep = speedDegPerSec * DEG * dt
  Transform.rotY[e] += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep
}

function decayVelocity(e: number, dt: number, rate: number): void {
  const k = Math.exp(-rate * dt)
  Velocity.x[e] *= k
  Velocity.z[e] *= k
}

function clampMag(value: number, max: number): number {
  if (value > max) return max
  if (value < -max) return -max
  return value
}
