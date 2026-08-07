import { BOSS, GRUNT } from '../config/balance'
import {
  Actor,
  ActorState,
  AttackPhase,
  Enemy,
  EnemyKind,
  Health,
  Status,
  Transform,
  Velocity,
} from '../core/components'
import {
  ATTACK_COMMIT_GAP,
  MAX_CONCURRENT_ATTACKERS,
  MAX_CONCURRENT_WIDE,
  SNARE_MOVE_SCALE,
  WIDE_ARC_DEG,
  attackAt,
  attacksFor,
  pickAttack,
} from '../config/enemyAttacks'
import { sfx, SfxIntent } from '../core/audio'
import { defineQuery, isAlive } from '../core/ecs'
import { combatRng } from '../core/rng'
import { isBehindPoint } from './combat'
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

/**
 * 다음 적이 공격을 걸 수 있을 때까지 남은 시간. **무리 전체가 공유**합니다.
 * 이 한 줄이 "동시에 시작해서 완전히 겹치는" 문제를 막습니다.
 */
let commitGapT = 0

export function resetAttackTokens(): void {
  commitGapT = 0
}

/**
 * 이번 프레임에 공격을 걸어도 되는 적들을 미리 뽑습니다.
 *
 * **왜 미리 뽑는가:** 루프를 돌면서 선착순으로 허용하면, 배열에 먼저 들어 있는
 * 적이 늘 이깁니다. 그건 플레이어 눈에 무작위로 보입니다.
 * **가장 가까운 적부터** 권한을 주면 "붙은 놈이 친다"가 되어 납득이 갑니다.
 *
 * @returns 공격을 걸어도 되는 엔티티 집합
 */
function grantAttackTokens(
  ids: Int32Array | Uint32Array | number[],
  count: number,
  px: number,
  pz: number,
): Set<number> {
  const granted = new Set<number>()

  // 이미 공격 중인 적이 토큰을 쥐고 있는 것으로 칩니다.
  let busy = 0
  let wideBusy = 0
  const waiting: { e: number; d: number }[] = []
  for (let i = 0; i < count; i++) {
    const e = ids[i]
    if (!isAlive(e) || Actor.state[e] === ActorState.Dead) continue
    if (Actor.state[e] === ActorState.Attack) {
      busy++
      const def = attackAt(Enemy.kind[e] === EnemyKind.Boss, Enemy.attackIndex[e])
      if (def.arcDeg >= WIDE_ARC_DEG) wideBusy++
      continue
    }
    if (Enemy.aggro[e] === 0) continue
    if (Actor.state[e] === ActorState.Stagger) continue
    waiting.push({ e, d: Math.hypot(Transform.x[e] - px, Transform.z[e] - pz) })
  }

  // 광역 여유분은 **항상 먼저** 갱신합니다.
  // 아래 조기 반환보다 뒤에 두면 값이 지난 프레임 것으로 남아,
  // 광역이 이미 하나 진행 중인데도 하나 더 허용되는 순간이 생깁니다.
  wideSlotsLeft = MAX_CONCURRENT_WIDE - wideBusy

  if (commitGapT > 0) return granted // 아직 다음 차례가 아닙니다
  let free = MAX_CONCURRENT_ATTACKERS - busy
  if (free <= 0) return granted

  waiting.sort((a, b) => a.d - b.d)
  for (const w of waiting) {
    if (free <= 0) break
    granted.add(w.e)
    free--
  }
  return granted
}

/** 이번 프레임에 광역 패턴을 몇 개 더 허용할 수 있는가. grantAttackTokens가 채웁니다. */
let wideSlotsLeft = MAX_CONCURRENT_WIDE

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

  if (commitGapT > 0) commitGapT = Math.max(0, commitGapT - dt)
  const tokens = grantAttackTokens(ids, enemies.count, px, pz)

  for (let i = 0; i < enemies.count; i++) {
    const e = ids[i]
    if (!isAlive(e)) continue
    if (Actor.state[e] === ActorState.Dead) continue

    // 잡몹과 보스는 같은 코드를 쓰고 수치표만 갈아 끼웁니다.
    // 이렇게 해두면 새 적을 추가할 때 AI 코드를 건드릴 필요가 없습니다.
    const isBoss = Enemy.kind[e] === EnemyKind.Boss
    const cfg = isBoss ? BOSS : GRUNT

    if (Actor.cooldownT[e] > 0) Actor.cooldownT[e] = Math.max(0, Actor.cooldownT[e] - dt)

    /**
     * 🔵 속박 (쌍단검의 '발목 긋기').
     *
     * **회전까지 함께 늦추는 것이 핵심입니다.** 이동만 늦추면 적이 제자리에서
     * 팽이처럼 돌며 계속 나를 마주 봐서, 등 뒤를 잡을 시간이 전혀 생기지 않습니다.
     * 그러면 이 스킬은 "조금 느려지는 디버프"가 되고, 기둥 3(포지셔닝이 보상받는다)과
     * 연결되지 않습니다. 회전을 늦춰야 "묶고 → 돌아가고 → 등을 친다"가 성립합니다.
     */
    let snareScale = 1
    if (Status.snareT[e] > 0) {
      Status.snareT[e] = Math.max(0, Status.snareT[e] - dt)
      snareScale = SNARE_MOVE_SCALE
    }

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
      const atk = attackAt(isBoss, Enemy.attackIndex[e])

      if (phase === AttackPhase.Windup) {
        turnToward(e, toPlayer, cfg.turnSpeedDeg * 0.3, dt)
      }
      // 공격 중에는 발이 묶입니다 — 적도 커밋합니다
      decayVelocity(e, dt, 12)

      Actor.timer[e] -= dt
      if (Actor.timer[e] <= 0) {
        if (phase === AttackPhase.Windup) {
          Actor.phase[e] = AttackPhase.Active
          Actor.timer[e] = atk.active
          Actor.hitsLeft[e] = 1
          Actor.nextHitT[e] = 0
          ctx.onSwing(Transform.x[e], Transform.z[e], Transform.rotY[e], atk.reach, atk.arcDeg)
          // 실제로 휘두르는 순간. 예고음(windup 시작)과 시간이 벌어져 있어서
          // "예고 → 발동" 두 박자가 귀로도 잡힙니다.
          sfx.swing(isBoss ? 0.95 : 0.55, Transform.x[e], Transform.z[e])
        } else if (phase === AttackPhase.Active) {
          Actor.phase[e] = AttackPhase.Recovery
          Actor.timer[e] = atk.recovery
        } else {
          Actor.state[e] = ActorState.Idle
          Actor.cooldownT[e] = cfg.attackCooldown
        }
      }
      continue
    }

    // ---- Idle: 추격하거나 공격을 시작 ----
    //
    // **등 뒤를 잡히면 바로 돌지 않습니다.** (DESIGN.md 기둥 3)
    // 즉시 따라 돌면 플레이어가 아무리 돌아가도 항상 정면이라, 백어택이
    // 시스템으로만 존재하고 실제로는 쓸 수 없습니다(플레이 테스트에서 확인).
    // 지연 + 느린 회전이 합쳐져 "등 뒤를 잡았다"는 상태가 실제로 유지됩니다.
    const behind = isBehindPoint(px, pz, Transform.x[e], Transform.z[e], Transform.rotY[e])
    if (behind) {
      if (Enemy.reactT[e] > 0) {
        Enemy.reactT[e] = Math.max(0, Enemy.reactT[e] - dt)
        // 알아채기 전에는 제자리에서 두리번거립니다 — 돌지도, 쫓지도 않습니다.
        decayVelocity(e, dt, 8)
        continue
      }
    } else {
      // 정면으로 돌아오면 다시 방심합니다. 매번 새로운 기회가 생깁니다.
      Enemy.reactT[e] = cfg.backReactionDelay
    }

    turnToward(e, toPlayer, cfg.turnSpeedDeg * snareScale, dt)

    const facingError = Math.abs(wrapAngle(toPlayer - Transform.rotY[e]))
    const inRange = dist <= cfg.attackRange

    // ---- 공격 개시: 거리에 맞는 패턴을 골라 예고를 띄웁니다 ----
    //
    // 사거리를 `cfg.attackRange` 하나로 재던 것을 **패턴별 사거리**로 바꿨습니다.
    // 보스의 갈고리(11m)처럼 멀리서만 쓰는 패턴이 생기면, 접근 판정 하나로는
    // 표현할 수 없습니다. "거리마다 다른 색이 나온다"가 이 구조에서 나옵니다.
    //
    // **공격 토큰**이 있어야 커밋할 수 있습니다(enemyAttacks.ts 설계 노트).
    // 토큰이 없는 적은 그냥 다음 판정으로 흘러가 노려보며 기다립니다.
    if (tokens.has(e) && Actor.cooldownT[e] <= 0 && facingError <= ATTACK_FACING_TOLERANCE) {
      const list = attacksFor(isBoss)
      let picked = pickAttack(list, dist, combatRng.next())
      // 광역 자리가 찼으면 좁은 패턴으로 바꿔 답니다. 그냥 취소하면 그 적이
      // 아무것도 안 하고 서 있게 되어 전투가 심심해집니다 — 막는 게 아니라 **바꾸는** 것입니다.
      if (picked && picked.arcDeg >= WIDE_ARC_DEG && wideSlotsLeft <= 0) {
        picked = list.find((a) => a.arcDeg < WIDE_ARC_DEG && dist >= a.minRange && dist <= a.maxRange) ?? null
      }
      if (picked) {
        if (picked.arcDeg >= WIDE_ARC_DEG) wideSlotsLeft--
        commitGapT = ATTACK_COMMIT_GAP
        tokens.delete(e)
        Enemy.attackIndex[e] = list.indexOf(picked)
        Actor.state[e] = ActorState.Attack
        Actor.phase[e] = AttackPhase.Windup
        Actor.timer[e] = picked.windup
        Actor.hitsLeft[e] = 1
        Actor.nextHitT[e] = 0
        /**
         * **예고음 — 4색이 곧 4개의 음입니다.**
         *
         * 쿼터뷰에서 적이 겹치면 색 예고가 서로를 가립니다(플레이 테스트에서
         * "여러 명 겹쳤을 때 피하기 어렵다"로 이미 확인). 공격 토큰으로
         * 동시 예고를 2개로 줄였지만, 2개도 겹치면 하나는 안 보입니다.
         * 소리는 겹쳐도 서로를 가리지 않는다 — 이게 이 한 줄의 이유입니다.
         *
         * AttackIntent 와 SfxIntent 는 값이 1:1로 같습니다(0~3).
         * 일부러 같게 맞춰서 변환 표를 만들지 않았습니다 — 표가 있으면
         * 색을 추가할 때 한쪽만 고쳐서 색과 소리가 어긋납니다.
         */
        sfx.telegraph(picked.intent as unknown as SfxIntent, Transform.x[e], Transform.z[e])
        decayVelocity(e, dt, 12)
        continue
      }
    }

    if (inRange) {
      // 사거리 안이지만 쿨다운 중 — 제자리에서 노려봅니다.
      // 계속 파고들면 플레이어가 적 무리에 파묻혀 아무것도 안 보이게 됩니다.
      decayVelocity(e, dt, 8)
    } else {
      const nx = dist > 0.0001 ? dx / dist : 0
      const nz = dist > 0.0001 ? dz / dist : 0
      const accel = 26 * dt
      Velocity.x[e] += clampMag(nx * cfg.moveSpeed * snareScale - Velocity.x[e], accel)
      Velocity.z[e] += clampMag(nz * cfg.moveSpeed * snareScale - Velocity.z[e], accel)
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
