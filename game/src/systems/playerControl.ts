import { PLAYER } from '../config/balance'
import {
  Actor,
  ActorState,
  AttackPhase,
  Health,
  Player,
  Stamina,
  Transform,
  Velocity,
} from '../core/components'
import { defineQuery } from '../core/ecs'
import { consumePress, isDown } from '../core/input'
import { time } from '../core/time'

/**
 * 플레이어 조작 — WASD 이동 + 마우스 조준 + 3타 콤보 + 회피 구르기.
 *
 * 설계 근거 (소울라이크 + ARPG 혼합의 핵심):
 *  1) **커밋(commitment)**: 공격을 시작하면 취소할 수 없고 이동 속도가 12%로 떨어집니다.
 *     "언제 때릴지"가 진짜 선택이 되는 이유가 이것입니다. 아무 때나 취소되면
 *     최적 전략은 항상 "일단 때리기"가 되어 버립니다.
 *  2) **선입력 버퍼**: 후딜 중에 눌러도 다음 타로 이어집니다. 이게 없으면
 *     정확한 프레임에 눌러야 해서 조작이 "안 먹는다"고 느껴집니다.
 *  3) **회피 캔슬**: 후딜(recovery) 중에만 구르기로 빠져나올 수 있습니다.
 *     선행동작이나 판정 중에는 못 빠집니다 = 무모한 공격은 대가를 치릅니다.
 *
 * 이 시스템은 Three.js를 import 하지 않습니다. 카메라 축과 조준 좌표는
 * ControlContext로 주입받습니다. 덕분에 Unity 이식 시 그대로 옮겨집니다.
 */

export interface ControlContext {
  /** 카메라 기준 전방/우측 (XZ 평면, 정규화) */
  forwardX: number
  forwardZ: number
  rightX: number
  rightZ: number
  /** 커서의 지면 위치 */
  aimX: number
  aimZ: number
  /** 검격 궤적 이펙트 콜백 */
  onSwing: (x: number, z: number, rotY: number, range: number, arcDeg: number) => void
}

const players = defineQuery(Player, Actor, Transform, Velocity, Stamina, Health)

const DEG = Math.PI / 180

function beginAttack(p: number, index: number, aimRot: number): void {
  const c = PLAYER.combo[index]
  Actor.state[p] = ActorState.Attack
  Actor.phase[p] = AttackPhase.Windup
  Actor.timer[p] = c.windup
  Actor.comboIndex[p] = index
  Actor.hasHit[p] = 0
  Actor.bufferedAttack[p] = 0
  Stamina.value[p] = Math.max(0, Stamina.value[p] - c.staminaCost)
  Stamina.regenDelayT[p] = PLAYER.staminaRegenDelay
  // 공격 시작 순간 커서 방향으로 몸을 스냅. 반응이 즉각적으로 느껴집니다.
  Transform.rotY[p] = aimRot
}

function beginDodge(p: number, dirX: number, dirZ: number): void {
  Actor.state[p] = ActorState.Dodge
  Actor.timer[p] = PLAYER.dodge.duration
  Actor.comboIndex[p] = 0
  Actor.bufferedAttack[p] = 0
  Actor.hasHit[p] = 0
  Player.dodgeDirX[p] = dirX
  Player.dodgeDirZ[p] = dirZ
  Player.dodgeElapsed[p] = 0
  Stamina.value[p] = Math.max(0, Stamina.value[p] - PLAYER.dodge.staminaCost)
  Stamina.regenDelayT[p] = PLAYER.staminaRegenDelay
  Transform.rotY[p] = Math.atan2(dirX, dirZ)
}

/** 각도를 -PI..PI 로 감아 최단 회전 방향을 얻습니다. */
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function turnToward(p: number, targetRot: number, speedDegPerSec: number, dt: number): void {
  const diff = wrapAngle(targetRot - Transform.rotY[p])
  const maxStep = speedDegPerSec * DEG * dt
  Transform.rotY[p] += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep
}

export function playerControlSystem(ctx: ControlContext): void {
  const dt = time.dt
  const ids = players.run()

  // 입력은 상태와 무관하게 매 프레임 한 번씩 소비합니다.
  // 상태 안에서 조건부로 읽으면 입력이 다음 프레임에 남아 뒤늦게 터집니다.
  const attackPressed = consumePress('Mouse0')
  const dodgePressed = consumePress('Space') || consumePress('ShiftLeft')

  for (let i = 0; i < players.count; i++) {
    const p = ids[i]
    if (Actor.state[p] === ActorState.Dead) continue

    // ---- 타이머 ----
    if (dt > 0) {
      Player.dodgeCooldownT[p] = Math.max(0, Player.dodgeCooldownT[p] - dt)
      if (Stamina.regenDelayT[p] > 0) {
        Stamina.regenDelayT[p] = Math.max(0, Stamina.regenDelayT[p] - dt)
      } else if (Stamina.value[p] < Stamina.max[p]) {
        Stamina.value[p] = Math.min(Stamina.max[p], Stamina.value[p] + PLAYER.staminaRegen * dt)
      }
    }

    // ---- 이동 입력 (카메라 기준) ----
    // W가 "월드 +Z"가 아니라 "화면 위쪽"으로 가야 합니다. 쿼터뷰에서 이걸
    // 틀리면 조작이 45도 어긋나 즉시 멀미가 납니다.
    let mx = 0
    let mz = 0
    if (isDown('KeyW') || isDown('ArrowUp')) {
      mx += ctx.forwardX
      mz += ctx.forwardZ
    }
    if (isDown('KeyS') || isDown('ArrowDown')) {
      mx -= ctx.forwardX
      mz -= ctx.forwardZ
    }
    if (isDown('KeyD') || isDown('ArrowRight')) {
      mx += ctx.rightX
      mz += ctx.rightZ
    }
    if (isDown('KeyA') || isDown('ArrowLeft')) {
      mx -= ctx.rightX
      mz -= ctx.rightZ
    }
    const mLen = Math.hypot(mx, mz)
    const hasMoveInput = mLen > 0.001
    if (hasMoveInput) {
      mx /= mLen
      mz /= mLen
    }

    // ---- 조준 ----
    const aimDx = ctx.aimX - Transform.x[p]
    const aimDz = ctx.aimZ - Transform.z[p]
    const aimRot =
      Math.hypot(aimDx, aimDz) > 0.05 ? Math.atan2(aimDx, aimDz) : Transform.rotY[p]

    const canDodge =
      Stamina.value[p] >= PLAYER.dodge.staminaCost && Player.dodgeCooldownT[p] <= 0

    let moveScale = 1

    switch (Actor.state[p] as ActorState) {
      case ActorState.Idle: {
        if (dodgePressed && canDodge) {
          // 이동 입력이 있으면 그 방향으로, 없으면 조준 반대(뒤)로 구릅니다.
          const dx = hasMoveInput ? mx : -Math.sin(aimRot)
          const dz = hasMoveInput ? mz : -Math.cos(aimRot)
          beginDodge(p, dx, dz)
          break
        }
        if (attackPressed && Stamina.value[p] >= PLAYER.combo[0].staminaCost) {
          beginAttack(p, 0, aimRot)
          break
        }
        turnToward(p, aimRot, PLAYER.turnSpeedDeg, dt)
        break
      }

      case ActorState.Attack: {
        if (attackPressed) Actor.bufferedAttack[p] = 1
        moveScale = PLAYER.attackMoveScale

        const combo = PLAYER.combo[Actor.comboIndex[p]]
        const phase = Actor.phase[p] as AttackPhase

        // 후딜에서만 구르기로 탈출 가능
        if (dodgePressed && canDodge && phase === AttackPhase.Recovery) {
          const dx = hasMoveInput ? mx : -Math.sin(Transform.rotY[p])
          const dz = hasMoveInput ? mz : -Math.cos(Transform.rotY[p])
          beginDodge(p, dx, dz)
          break
        }

        // 선행동작 중에는 느리게나마 방향을 틀 수 있습니다(완전 고정은 답답함).
        if (phase === AttackPhase.Windup) {
          turnToward(p, aimRot, PLAYER.turnSpeedDeg * 0.35, dt)
          // 앞으로 파고드는 전진. 사거리가 짧은 무기가 닿게 해주는 장치입니다.
          const lungeSpeed = combo.lunge / Math.max(combo.windup, 0.001)
          Velocity.x[p] += Math.sin(Transform.rotY[p]) * lungeSpeed * dt * 4
          Velocity.z[p] += Math.cos(Transform.rotY[p]) * lungeSpeed * dt * 4
        }

        Actor.timer[p] -= dt
        if (Actor.timer[p] <= 0) {
          if (phase === AttackPhase.Windup) {
            Actor.phase[p] = AttackPhase.Active
            Actor.timer[p] = combo.active
            Actor.hasHit[p] = 0
            ctx.onSwing(
              Transform.x[p],
              Transform.z[p],
              Transform.rotY[p],
              combo.range,
              combo.arcDeg,
            )
          } else if (phase === AttackPhase.Active) {
            Actor.phase[p] = AttackPhase.Recovery
            Actor.timer[p] = combo.recovery
            Actor.comboWindowT[p] = PLAYER.comboWindow
          } else {
            endAttack(p, aimRot)
          }
        } else if (phase === AttackPhase.Recovery && Actor.bufferedAttack[p] === 1) {
          // 후딜의 55%가 지났으면 즉시 다음 타로 이어집니다.
          // 후딜을 끝까지 기다리게 하면 콤보가 "무겁게 끌리는" 느낌이 납니다.
          if (Actor.timer[p] <= combo.recovery * 0.45) endAttack(p, aimRot)
        }
        break
      }

      case ActorState.Dodge: {
        Player.dodgeElapsed[p] += dt
        const d = PLAYER.dodge
        const progress = Math.min(1, Player.dodgeElapsed[p] / d.duration)
        // 속도 곡선: 시작이 빠르고 끝이 느립니다. 등속으로 굴리면
        // "미끄러지는" 느낌이 나고 무적 타이밍도 읽기 어려워집니다.
        // (1.6 - 1.2t)의 0~1 적분이 정확히 1이라 총 이동거리는 distance가 됩니다.
        const speed = (d.distance / d.duration) * (1.6 - 1.2 * progress)
        Velocity.x[p] = Player.dodgeDirX[p] * speed
        Velocity.z[p] = Player.dodgeDirZ[p] * speed
        moveScale = 0

        if (Player.dodgeElapsed[p] >= d.duration) {
          Actor.state[p] = ActorState.Idle
          Player.dodgeCooldownT[p] = d.cooldown
        }
        break
      }

      case ActorState.Stagger: {
        Actor.timer[p] -= dt
        moveScale = 0
        if (Actor.timer[p] <= 0) Actor.state[p] = ActorState.Idle
        break
      }

      default:
        break
    }

    // ---- 목표 속도 적용 ----
    // 구르기는 위에서 속도를 직접 지정하므로 건너뜁니다.
    if (Actor.state[p] !== ActorState.Dodge) {
      const targetVx = mx * PLAYER.moveSpeed * moveScale
      const targetVz = mz * PLAYER.moveSpeed * moveScale
      const accel = PLAYER.acceleration * dt
      Velocity.x[p] += clampMag(targetVx - Velocity.x[p], accel)
      Velocity.z[p] += clampMag(targetVz - Velocity.z[p], accel)
    }

    Actor.moveScale[p] = moveScale
    if (Actor.comboWindowT[p] > 0) Actor.comboWindowT[p] -= dt
  }
}

function endAttack(p: number, aimRot: number): void {
  const next = Actor.comboIndex[p] + 1
  const canChain =
    Actor.bufferedAttack[p] === 1 &&
    next < PLAYER.combo.length &&
    Stamina.value[p] >= PLAYER.combo[next].staminaCost
  if (canChain) {
    beginAttack(p, next, aimRot)
  } else {
    Actor.state[p] = ActorState.Idle
    Actor.comboIndex[p] = 0
    Actor.bufferedAttack[p] = 0
    Actor.comboWindowT[p] = 0
  }
}

function clampMag(value: number, max: number): number {
  if (value > max) return max
  if (value < -max) return -max
  return value
}
