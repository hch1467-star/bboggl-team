import { SKILL_KEY_CODES, type SkillDef } from '../config/arsenal'
import { PLAYER } from '../config/balance'
import { SNARE_MOVE_SCALE } from '../config/enemyAttacks'
import {
  Actor,
  ActorState,
  AttackPhase,
  Health,
  Loadout,
  Player,
  Stamina,
  Status,
  Transform,
  Velocity,
} from '../core/components'
import { defineQuery } from '../core/ecs'
import { consumePress, isDown } from '../core/input'
import { time } from '../core/time'
import { WEAPONS } from '../config/arsenal'
import { cooldownOf, cycleRune, setCooldown, skillForSlot, tickCooldowns, weaponOf } from './loadout'

/**
 * 플레이어 조작 — 이동 + 조준 + 기본 콤보 + 회피 + **스킬 5슬롯**.
 *
 * ── 전투의 핵심 리듬 (DESIGN.md 기둥 1) ─────────────────────────────
 *   스태미나 = 기본 콤보 · 회피 구르기   (소울라이크)
 *   쿨다운   = 스킬 5개 (무기 3 + 룬 2)  (로스트아크)
 *
 * 두 자원을 분리했기 때문에 "쿨다운 도는 동안 기본기로 버티다가,
 * 차면 스킬로 터뜨리는" 리듬이 저절로 만들어집니다.
 * 스킬에 스태미나까지 물렸다면 스킬을 쓸수록 회피를 못 하게 되어
 * 로아식 시원함이 죽었을 겁니다.
 *
 * ── 그 밖의 조작 설계 ────────────────────────────────────────────
 *  1) **커밋**: 공격/스킬을 시작하면 취소할 수 없고 이동이 크게 느려집니다.
 *     "언제 때릴지"가 진짜 선택이 되는 이유가 이것입니다.
 *  2) **선입력 버퍼**: 후딜 중에 눌러도 다음 타로 이어집니다.
 *  3) **스킬 캔슬**: 기본 공격의 **후딜에서만** 스킬로 이어갈 수 있습니다.
 *     선행동작·판정 중에는 못 빠집니다 = 무모한 공격은 대가를 치릅니다.
 *
 * 이 시스템은 Three.js를 import 하지 않습니다 — Unity 이식 시 그대로 옮겨집니다.
 */

export interface CastVisual {
  shape: 'cone' | 'circle' | 'point'
  x: number
  z: number
  rotY: number
  range: number
  arcDeg: number
  color: number
  phase: 'telegraph' | 'strike'
  duration: number
}

export interface ControlContext {
  /** 카메라 기준 전방/우측 (XZ 평면, 정규화) */
  forwardX: number
  forwardZ: number
  rightX: number
  rightZ: number
  /** 커서의 지면 위치 */
  aimX: number
  aimZ: number
  /** 기본 공격 검격 궤적 */
  onSwing: (x: number, z: number, rotY: number, range: number, arcDeg: number) => void
  /** 스킬 예고/발동 이펙트 */
  onCast: (visual: CastVisual) => void
  /** 무기를 바꿨을 때 (HUD 갱신용) */
  onLoadoutChange: () => void
}

const players = defineQuery(Player, Actor, Transform, Velocity, Stamina, Health, Loadout)

const DEG = Math.PI / 180

/** 대시 스킬이 조준 지점을 지나쳐 더 나아가는 거리(m). 이만큼이 "등 뒤"가 됩니다. */
const DASH_OVERSHOOT = 1.2

/**
 * 스킬 선입력을 붙잡아 두는 시간(초).
 *
 * 0.45초는 "한 동작이 끝나가는 것을 보고 미리 누르는" 자연스러운 앞당김을
 * 전부 담으면서, 잊어버릴 만큼 길지는 않은 길이입니다.
 * 더 길게 잡으면 예전에 누른 스킬이 뜬금없이 튀어나옵니다.
 */
const SKILL_BUFFER_TIME = 0.45

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

/** 남은 속도를 상한까지 눌러 관성 미끄러짐을 끊습니다. */
function damp(p: number, cap: number): void {
  const speed = Math.hypot(Velocity.x[p], Velocity.z[p])
  if (speed <= cap) return
  const k = cap / speed
  Velocity.x[p] *= k
  Velocity.z[p] *= k
}

function clampMag(value: number, max: number): number {
  if (value > max) return max
  if (value < -max) return -max
  return value
}

function beginAttack(p: number, index: number, aimRot: number): void {
  const c = weaponOf(p).combo[index]
  Actor.state[p] = ActorState.Attack
  Actor.phase[p] = AttackPhase.Windup
  Actor.timer[p] = c.windup
  Actor.comboIndex[p] = index
  Actor.hitsLeft[p] = 0
  Actor.nextHitT[p] = 0
  Actor.bufferedAttack[p] = 0
  Stamina.value[p] = Math.max(0, Stamina.value[p] - c.staminaCost)
  Stamina.regenDelayT[p] = PLAYER.staminaRegenDelay
  // 공격 시작 순간 커서 방향으로 몸을 스냅. 반응이 즉각적으로 느껴집니다.
  Transform.rotY[p] = aimRot
}

function beginSkill(
  p: number,
  slot: number,
  def: SkillDef,
  aimRot: number,
  ctx: ControlContext,
): void {
  Actor.state[p] = ActorState.Skill
  Actor.phase[p] = AttackPhase.Windup
  Actor.timer[p] = def.windup
  Actor.skillSlot[p] = slot
  Actor.hitsLeft[p] = 0
  Actor.nextHitT[p] = 0
  Actor.comboIndex[p] = 0
  Actor.bufferedAttack[p] = 0
  // 무적 프레임 타이밍은 회피와 같은 필드를 씁니다(동시에 일어나지 않으므로 안전).
  Player.dodgeElapsed[p] = 0
  Transform.rotY[p] = aimRot
  setCooldown(p, slot, def.cooldown)

  // 대시 거리는 **조준한 지점 바로 뒤**에 착지하도록 그때그때 계산합니다.
  //
  // 고정 거리로 두면 교전 거리에 따라 착지점이 들쭉날쭉합니다.
  // 자동 검증에서 확인한 실제 문제: 1.4m 거리에서 3.6m 대시를 쓰면 적을
  // 2.2m 지나쳐 착지하는데, 여기에 밀어내기까지 겹쳐 4.5m가 벌어지면서
  // 단검(사거리 2.35m)이 전혀 닿지 않았습니다. "뚫고 지나가 등 뒤를 친다"가
  // 성립하려면 **항상 사거리 안에** 떨어져야 합니다.
  if (def.dash > 0) {
    const adx = ctx.aimX - Transform.x[p]
    const adz = ctx.aimZ - Transform.z[p]
    const aimDist = Math.hypot(adx, adz)
    const distance = Math.min(def.dash, aimDist + DASH_OVERSHOOT)
    Player.dashSpeed[p] = distance / Math.max(def.windup + def.active, 0.001)
  } else {
    Player.dashSpeed[p] = 0
  }

  if (def.shape === 'point') {
    // 착탄 지점을 시전 순간에 **고정**합니다. 커서를 계속 따라가면
    // 적이 예고를 보고 피하는 것 자체가 불가능해집니다.
    const dx = ctx.aimX - Transform.x[p]
    const dz = ctx.aimZ - Transform.z[p]
    const dist = Math.hypot(dx, dz)
    const s = dist > def.castRange ? def.castRange / dist : 1
    Player.castX[p] = Transform.x[p] + dx * s
    Player.castZ[p] = Transform.z[p] + dz * s
  } else {
    Player.castX[p] = Transform.x[p]
    Player.castZ[p] = Transform.z[p]
  }

  // 예고 표시 — windup 동안 지면에 범위를 그려 줍니다.
  ctx.onCast({
    shape: def.shape,
    x: def.shape === 'point' ? Player.castX[p] : Transform.x[p],
    z: def.shape === 'point' ? Player.castZ[p] : Transform.z[p],
    rotY: Transform.rotY[p],
    range: def.range,
    arcDeg: def.arcDeg,
    color: def.color,
    phase: 'telegraph',
    duration: def.windup,
  })
}

function beginDodge(p: number, dirX: number, dirZ: number): void {
  Actor.state[p] = ActorState.Dodge
  Actor.timer[p] = PLAYER.dodge.duration
  Actor.comboIndex[p] = 0
  Actor.bufferedAttack[p] = 0
  Actor.hitsLeft[p] = 0
  Player.dodgeDirX[p] = dirX
  Player.dodgeDirZ[p] = dirZ
  Player.dodgeElapsed[p] = 0
  Stamina.value[p] = Math.max(0, Stamina.value[p] - PLAYER.dodge.staminaCost)
  Stamina.regenDelayT[p] = PLAYER.staminaRegenDelay
  Transform.rotY[p] = Math.atan2(dirX, dirZ)
}

export function playerControlSystem(ctx: ControlContext): void {
  const dt = time.dt
  const ids = players.run()

  // 입력은 상태와 무관하게 매 프레임 한 번씩 소비합니다.
  // 상태 안에서 조건부로 읽으면 입력이 다음 프레임에 남아 뒤늦게 터집니다.
  const attackPressed = consumePress('Mouse0')
  const dodgePressed = consumePress('Space') || consumePress('ShiftLeft')
  let skillPressed = -1
  for (let i = 0; i < SKILL_KEY_CODES.length; i++) {
    if (consumePress(SKILL_KEY_CODES[i])) {
      skillPressed = i
      break
    }
  }
  const weaponPressed = consumePress('Digit1')
    ? 0
    : consumePress('Digit2')
      ? 1
      : consumePress('Digit3')
        ? 2
        : -1
  // 룬 교체 키. G가 스킬 슬롯(룬2)이 되면서 교체 키를 Tab / C 로 옮겼습니다.
  const cycleRune0 = consumePress('Tab')
  const cycleRune1 = consumePress('KeyC')

  for (let i = 0; i < players.count; i++) {
    const p = ids[i]
    if (Actor.state[p] === ActorState.Dead) continue

    /**
     * ---- 스킬 선입력 버퍼 ----
     *
     * 플레이 테스트: **"스킬이 한 번씩밖에 사용이 안 되네."**
     * 원인은 쿨다운이 아니라 **입력이 사라지는 것**이었습니다. 기본 공격에는
     * 버퍼가 있었는데 스킬에는 없어서, 시전 중이나 후딜 중에 누른 키가
     * 그대로 버려졌습니다. 측정해 보니 시간의 1/3을 시전 상태로 보내고 있어서
     * 쿨다운이 6초인 스킬을 **13.4초 만에** 겨우 다시 쓰고 있었습니다.
     *
     * 스킬 3개를 이어 쓰는 것이 이 게임의 리듬(기둥 1: 버티다가 터뜨린다)인데,
     * 버퍼가 없으면 매번 완전히 Idle이 될 때까지 기다렸다가 정확히 눌러야 합니다.
     * 그건 조작이 아니라 눈치싸움입니다.
     *
     * 만료를 두는 이유: 버퍼가 영원히 남으면 2초 전에 누른 스킬이 뜬금없이
     * 튀어나옵니다. 안 나가는 것보다 **의도하지 않은 때 나가는 것**이 더 나쁩니다.
     */
    if (skillPressed >= 0) {
      Actor.bufferedSkill[p] = skillPressed + 1
      Actor.bufferedSkillT[p] = SKILL_BUFFER_TIME
    } else if (Actor.bufferedSkillT[p] > 0) {
      Actor.bufferedSkillT[p] = Math.max(0, Actor.bufferedSkillT[p] - dt)
      if (Actor.bufferedSkillT[p] === 0) Actor.bufferedSkill[p] = 0
    }

    // ---- 타이머 ----
    tickCooldowns(p)
    if (dt > 0) {
      Player.dodgeCooldownT[p] = Math.max(0, Player.dodgeCooldownT[p] - dt)
      if (Stamina.regenDelayT[p] > 0) {
        Stamina.regenDelayT[p] = Math.max(0, Stamina.regenDelayT[p] - dt)
      } else if (Stamina.value[p] < Stamina.max[p]) {
        Stamina.value[p] = Math.min(Stamina.max[p], Stamina.value[p] + PLAYER.staminaRegen * dt)
      }
    }

    const idle = Actor.state[p] === ActorState.Idle

    // ---- 장비 교체 (전투 중에는 불가) ----
    if (idle && weaponPressed >= 0 && weaponPressed < WEAPONS.length) {
      Loadout.weapon[p] = weaponPressed
      Actor.comboIndex[p] = 0
      ctx.onLoadoutChange()
    }
    if (idle && cycleRune0) {
      cycleRune(p, 3)
      ctx.onLoadoutChange()
    }
    if (idle && cycleRune1) {
      cycleRune(p, 4)
      ctx.onLoadoutChange()
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
    const aimRot = Math.hypot(aimDx, aimDz) > 0.05 ? Math.atan2(aimDx, aimDz) : Transform.rotY[p]

    const canDodge = Stamina.value[p] >= PLAYER.dodge.staminaCost && Player.dodgeCooldownT[p] <= 0
    const weapon = weaponOf(p)

    /** 슬롯을 지금 쓸 수 있는지 — 룬이 비었거나 쿨다운이면 불가. */
    const readySkill = (slot: number): SkillDef | null => {
      if (slot < 0) return null
      if (cooldownOf(p, slot) > 0) return null
      return skillForSlot(p, slot)
    }

    /**
     * 버퍼에 담긴 스킬을 꺼내 씁니다. 쓸 수 있을 때만 버퍼를 비웁니다 —
     * 쿨다운이라 못 쓴 것을 지워버리면, 쿨이 0.1초 뒤에 도는 흔한 경우에
     * 또 입력이 사라집니다.
     */
    const takeBufferedSkill = (): { slot: number; def: SkillDef } | null => {
      const buffered = Actor.bufferedSkill[p]
      if (buffered === 0) return null
      const slot = buffered - 1
      const def = readySkill(slot)
      if (!def) return null
      Actor.bufferedSkill[p] = 0
      Actor.bufferedSkillT[p] = 0
      return { slot, def }
    }

    let moveScale = 1
    /**
     * 전진 속도 오버라이드(m/s).
     *
     * 공격의 파고들기(lunge)와 스킬의 대시는 **일반 이동 로직을 무시하고**
     * 속도를 직접 지정해야 합니다. 예전에는 lunge를 Velocity에 더하기만 했는데,
     * 바로 아래 이동 코드가 "목표 속도(정지)"로 매 프레임 3m/s씩 끌어내려서
     * 결국 한 발짝도 못 나갔습니다. 사거리를 채워주려고 넣은 장치가
     * 실제로는 아무 일도 안 하고 있었습니다.
     */
    let forwardOverride: number | null = null

    switch (Actor.state[p] as ActorState) {
      case ActorState.Idle: {
        const queued = takeBufferedSkill()
        if (queued) {
          beginSkill(p, queued.slot, queued.def, aimRot, ctx)
          break
        }
        if (dodgePressed && canDodge) {
          // 이동 입력이 있으면 그 방향으로, 없으면 조준 반대(뒤)로 구릅니다.
          const dx = hasMoveInput ? mx : -Math.sin(aimRot)
          const dz = hasMoveInput ? mz : -Math.cos(aimRot)
          beginDodge(p, dx, dz)
          break
        }
        if (attackPressed && Stamina.value[p] >= weapon.combo[0].staminaCost) {
          beginAttack(p, 0, aimRot)
          break
        }
        turnToward(p, aimRot, PLAYER.turnSpeedDeg, dt)
        break
      }

      case ActorState.Attack: {
        if (attackPressed) Actor.bufferedAttack[p] = 1
        moveScale = weapon.attackMoveScale

        const combo = weapon.combo[Math.min(Actor.comboIndex[p], weapon.combo.length - 1)]
        const phase = Actor.phase[p] as AttackPhase

        // 후딜에서만 스킬/구르기로 탈출할 수 있습니다.
        // 여기서도 **버퍼**를 읽습니다 — 이번 프레임의 입력만 보면
        // 후딜에 들어가기 직전에 누른 것이 사라집니다(이게 원래 버그였습니다).
        if (phase === AttackPhase.Recovery) {
          const queued = takeBufferedSkill()
          if (queued) {
            beginSkill(p, queued.slot, queued.def, aimRot, ctx)
            break
          }
          if (dodgePressed && canDodge) {
            const dx = hasMoveInput ? mx : -Math.sin(Transform.rotY[p])
            const dz = hasMoveInput ? mz : -Math.cos(Transform.rotY[p])
            beginDodge(p, dx, dz)
            break
          }
        }

        // 선행동작 중에는 느리게나마 방향을 틀 수 있습니다(완전 고정은 답답함).
        if (phase === AttackPhase.Windup && combo.lunge > 0) {
          turnToward(p, aimRot, PLAYER.turnSpeedDeg * 0.35, dt)
          // 앞으로 파고드는 전진. 사거리가 짧은 무기가 닿게 해주는 장치입니다.
          forwardOverride = combo.lunge / Math.max(combo.windup, 0.001)
        } else if (phase === AttackPhase.Windup) {
          turnToward(p, aimRot, PLAYER.turnSpeedDeg * 0.35, dt)
        }

        Actor.timer[p] -= dt
        if (Actor.timer[p] <= 0) {
          if (phase === AttackPhase.Windup) {
            Actor.phase[p] = AttackPhase.Active
            Actor.timer[p] = combo.active
            Actor.hitsLeft[p] = 1
            Actor.nextHitT[p] = 0
            // 파고들기가 끝나면 잔여 속도를 죽입니다(대시와 같은 이유).
            forwardOverride = null
            damp(p, PLAYER.moveSpeed * weapon.moveSpeedScale * 0.3)
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
            Actor.comboWindowT[p] = weapon.comboWindow
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

      case ActorState.Skill: {
        const def = skillForSlot(p, Actor.skillSlot[p])
        if (!def) {
          Actor.state[p] = ActorState.Idle
          break
        }
        Player.dodgeElapsed[p] += dt
        moveScale = def.moveScale
        const phase = Actor.phase[p] as AttackPhase

        // 대시 스킬은 선행동작+판정 동안 앞으로 미끄러집니다.
        if (def.dash > 0 && phase !== AttackPhase.Recovery) {
          forwardOverride = Player.dashSpeed[p]
        }

        // 스킬 후딜에도 **선입력**을 받습니다.
        //
        // 이게 없으면 그림자 도약처럼 "뚫고 지나가 등 뒤를 친다"는 기술이
        // 성립하지 않습니다. 자동 검증에서 실제로 확인한 결과:
        // 적은 경직에서 풀린 뒤 0.29초면 몸을 돌려 등 뒤 판정을 벗어나는데,
        // 후딜이 끝나고 나서야 입력을 받으면 그 창을 놓칩니다.
        // 후딜의 후반부에서 기본 공격으로 이어갈 수 있게 하면
        // "커밋"은 유지하면서(전반부는 못 빠짐) 반격 창이 살아납니다.
        if (attackPressed) Actor.bufferedAttack[p] = 1
        if (
          phase === AttackPhase.Recovery &&
          Actor.bufferedAttack[p] === 1 &&
          Actor.timer[p] <= def.recovery * 0.5 &&
          Stamina.value[p] >= weapon.combo[0].staminaCost
        ) {
          beginAttack(p, 0, aimRot)
          break
        }

        // 후딜 후반에는 **다음 스킬로 바로 이어갈 수 있습니다.**
        // 스킬 3개를 엮는 것이 이 게임의 리듬이므로, 이어치기가 안 되면
        // 슬롯을 늘린 의미가 없습니다. 전반부는 못 빠지므로 커밋은 유지됩니다.
        if (phase === AttackPhase.Recovery && Actor.timer[p] <= def.recovery * 0.5) {
          const queued = takeBufferedSkill()
          if (queued) {
            beginSkill(p, queued.slot, queued.def, aimRot, ctx)
            break
          }
        }

        // 후딜 후반에는 회피로도 빠져나갈 수 있습니다(기본 공격과 같은 규칙).
        if (
          phase === AttackPhase.Recovery &&
          dodgePressed &&
          canDodge &&
          Actor.timer[p] <= def.recovery * 0.5
        ) {
          const dx = hasMoveInput ? mx : -Math.sin(Transform.rotY[p])
          const dz = hasMoveInput ? mz : -Math.cos(Transform.rotY[p])
          beginDodge(p, dx, dz)
          break
        }

        if (phase === AttackPhase.Windup) {
          // 지점 지정 스킬은 시전 중 방향을 못 바꿉니다(착탄점이 이미 고정됨).
          if (def.shape !== 'point') turnToward(p, aimRot, PLAYER.turnSpeedDeg * 0.3, dt)
        }

        Actor.timer[p] -= dt
        if (Actor.timer[p] <= 0) {
          if (phase === AttackPhase.Windup) {
            Actor.phase[p] = AttackPhase.Active
            Actor.timer[p] = def.active
            Actor.hitsLeft[p] = Math.max(1, def.hits)
            Actor.nextHitT[p] = 0
            ctx.onCast({
              shape: def.shape,
              x: def.shape === 'point' ? Player.castX[p] : Transform.x[p],
              z: def.shape === 'point' ? Player.castZ[p] : Transform.z[p],
              rotY: Transform.rotY[p],
              range: def.range,
              arcDeg: def.arcDeg,
              color: def.color,
              phase: 'strike',
              duration: Math.max(def.active, 0.16),
            })
          } else if (phase === AttackPhase.Active) {
            Actor.phase[p] = AttackPhase.Recovery
            Actor.timer[p] = def.recovery
            // 대시가 끝나면 남은 속도를 반드시 죽여야 합니다.
            //
            // 자동 검증으로 잡은 버그: 대시는 초당 29m로 달리는데, 대시가 끝난 뒤
            // 일반 이동 로직은 가속도 60m/s²로만 감속합니다. 29 -> 0 까지 0.5초가
            // 걸리고 그 사이에 **관성으로 6m를 더 미끄러집니다.**
            // 설계상 4m 대시가 실제로는 10.4m 날아가서, 적 등 뒤에 착지한다는
            // 이 스킬의 존재 이유 자체가 무너져 있었습니다.
            if (def.dash > 0) {
              // 오버라이드를 반드시 같이 꺼야 합니다. 이 블록은 switch 안이고,
              // 속도를 실제로 쓰는 코드는 switch **뒤**에 있습니다. 안 끄면
              // 여기서 줄인 속도를 그 코드가 다시 29m/s로 덮어씁니다.
              forwardOverride = null
              damp(p, PLAYER.moveSpeed * weapon.moveSpeedScale * 0.35)
            }
          } else {
            Actor.state[p] = ActorState.Idle
            Actor.hitsLeft[p] = 0
          }
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

    // ---- 🔵 속박 (파랑 예고에 맞았을 때) ----
    //
    // **회피 구르기와 대시는 막지 않습니다.** 묶인 채로 탈출 수단까지 빼앗으면
    // "맞는 순간 게임이 끝"이고, 그건 DESIGN.md가 못박은 "내가 못 피했네"가 아니라
    // "손쓸 방법이 없었네"가 됩니다. 걷는 속도만 죽여서 **다음 예고를 피하기 어렵게**
    // 만드는 것이 이 상태이상의 전부입니다.
    if (Status.snareT[p] > 0) {
      Status.snareT[p] = Math.max(0, Status.snareT[p] - dt)
      moveScale *= SNARE_MOVE_SCALE
    }

    // ---- 목표 속도 적용 ----
    if (forwardOverride !== null) {
      Velocity.x[p] = Math.sin(Transform.rotY[p]) * forwardOverride
      Velocity.z[p] = Math.cos(Transform.rotY[p]) * forwardOverride
    } else if (Actor.state[p] !== ActorState.Dodge) {
      const speedCap = PLAYER.moveSpeed * weapon.moveSpeedScale
      const targetVx = mx * speedCap * moveScale
      const targetVz = mz * speedCap * moveScale
      const accel = PLAYER.acceleration * dt
      Velocity.x[p] += clampMag(targetVx - Velocity.x[p], accel)
      Velocity.z[p] += clampMag(targetVz - Velocity.z[p], accel)
    }

    Actor.moveScale[p] = moveScale
    if (Actor.comboWindowT[p] > 0) Actor.comboWindowT[p] -= dt
  }
}

function endAttack(p: number, aimRot: number): void {
  const weapon = weaponOf(p)
  const next = Actor.comboIndex[p] + 1
  const canChain =
    Actor.bufferedAttack[p] === 1 &&
    next < weapon.combo.length &&
    Stamina.value[p] >= weapon.combo[next].staminaCost
  if (canChain) {
    beginAttack(p, next, aimRot)
  } else {
    Actor.state[p] = ActorState.Idle
    Actor.comboIndex[p] = 0
    Actor.bufferedAttack[p] = 0
    Actor.comboWindowT[p] = 0
  }
}
