import { enemyDef } from '../config/enemies'
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
import {
  BOSS_PHASES,
  NO_CHAIN,
  PHASE_SHOCKWAVE,
  PHASE_TRANSITION_TIME,
  bossPhase,
  phaseForHp,
} from '../config/bossPhases'
import { BOSS_ARENA, POISE } from '../config/balance'
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
      const def = attackAt(Enemy.kind[e], Enemy.attackIndex[e])
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

/** 페이즈가 바뀐 순간. 게임 루프가 읽고 비웁니다(연출은 시스템 밖에서). */
export interface PhaseEvent {
  entity: number
  phase: number
  name: string
  banner: string
  desc: string
  x: number
  z: number
}
export const phaseEvents: PhaseEvent[] = []

/**
 * 보스전이 시작되거나 끝난 순간.
 * `name` 이 빈 문자열이면 **종료**(귀환)입니다.
 */
export interface EncounterEvent {
  entity: number
  name: string
  maxHp: number
  x: number
  z: number
}
export const encounterEvents: EncounterEvent[] = []

/**
 * 패턴 하나를 실제로 겁니다 — 예고 시작.
 *
 * 일반 커밋과 연계 커밋이 **같은 함수**를 지나가야 합니다. 따로 쓰면
 * 한쪽에만 예고음을 넣거나 한쪽만 선행동작 배율을 빠뜨리는 식으로
 * 조용히 어긋납니다(4색 예고에서 이미 겪은 종류의 버그입니다).
 */
export function chainIndexFor(kind: number, phaseIdx: number, attackIndex: number): number {
  // 연계는 보스 페이즈에만 있는 개념입니다. 다른 종류는 항상 "없음".
  if (kind !== EnemyKind.Boss) return NO_CHAIN
  const list = attacksFor(kind)
  const chainId = bossPhase(phaseIdx).chains?.[list[attackIndex]?.id ?? '']
  if (!chainId) return NO_CHAIN
  const idx = list.findIndex((a) => a.id === chainId)
  return idx >= 0 ? idx : NO_CHAIN
}

function commitAttack(
  e: number,
  kind: number,
  index: number,
  windupScale: number,
  chained = false,
): void {
  const list = attacksFor(kind)
  const atk = list[index]
  Enemy.attackIndex[e] = index
  Actor.state[e] = ActorState.Attack
  Actor.phase[e] = AttackPhase.Windup
  Actor.timer[e] = atk.windup * windupScale
  Actor.hitsLeft[e] = 1
  Actor.nextHitT[e] = 0
  Enemy.chained[e] = chained ? 1 : 0

  // 이 패턴 뒤에 따라붙을 연계를 지금 정해 둡니다.
  Enemy.chainNext[e] = chainIndexFor(kind, Enemy.phase[e], index)

  /**
   * **예고음 — 4색이 곧 4개의 음입니다.**
   *
   * 쿼터뷰에서 적이 겹치면 색 예고가 서로를 가립니다. 공격 토큰으로 동시 예고를
   * 2개로 줄였지만, 2개도 겹치면 하나는 안 보입니다. 소리는 겹쳐도 서로를
   * 가리지 않는다 — 이게 이 한 줄의 이유입니다.
   *
   * 보스 연계에서는 이게 더 중요해집니다. 🔵 뒤에 🔴 이 붙는다는 걸
   * **화면을 다시 안 봐도** 알 수 있어야 무적 타이밍을 잡을 수 있습니다.
   *
   * AttackIntent 와 SfxIntent 는 값이 1:1로 같습니다(0~3). 일부러 같게 맞춰서
   * 변환 표를 만들지 않았습니다 — 표가 있으면 색을 추가할 때 한쪽만 고쳐서
   * 색과 소리가 어긋납니다.
   */
  sfx.telegraph(atk.intent as unknown as SfxIntent, Transform.x[e], Transform.z[e])
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

  if (commitGapT > 0) commitGapT = Math.max(0, commitGapT - dt)
  const tokens = grantAttackTokens(ids, enemies.count, px, pz)

  for (let i = 0; i < enemies.count; i++) {
    const e = ids[i]
    if (!isAlive(e)) continue
    if (Actor.state[e] === ActorState.Dead) continue

    // 잡몹과 보스는 같은 코드를 쓰고 수치표만 갈아 끼웁니다.
    // 이렇게 해두면 새 적을 추가할 때 AI 코드를 건드릴 필요가 없습니다.
    const kind = Enemy.kind[e]
    const isBoss = kind === EnemyKind.Boss
    const cfg = enemyDef(kind)
    const ph = bossPhase(isBoss ? Enemy.phase[e] : 0)

    /**
     * ── 보스 페이즈 전환 ────────────────────────────────────────────
     *
     * 체력 비율 하나로만 판정합니다. 시간도 확률도 섞지 않는 이유:
     * 참고한 보스전에서 플레이어가 가장 싫어한다고 말한 것이
     * **"미리 알 수 없는 조건이 겹치는 것"** 이었습니다. 전환이 결정적이면
     * "체력 얼마에서 바뀐다"를 외울 수 있고, 외울 수 있으면 준비할 수 있습니다.
     *
     * 전환 중에는 **무적 + 행동 정지 + 넉백** 입니다. 무적이 필요한 이유는
     * 두 가지입니다: 화력이 높으면 페이즈를 통째로 건너뛸 수 있고(설계한
     * 학습 순서가 무너짐), 규칙이 바뀌는 순간에 얻어맞으면 무엇이 바뀌었는지
     * 읽을 시간이 없습니다.
     */
    if (isBoss && Health.max[e] > 0) {
      if (Enemy.transitionT[e] > 0) {
        Enemy.transitionT[e] = Math.max(0, Enemy.transitionT[e] - dt)
        // 전환이 끝날 때까지 계속 무적을 덮어씁니다(healthSystem이 깎으므로).
        Health.invulnT[e] = Math.max(Health.invulnT[e], Enemy.transitionT[e])
        decayVelocity(e, dt, 10)
        continue
      }
      const want = phaseForHp(Health.hp[e] / Health.max[e])
      if (want > Enemy.phase[e]) {
        Enemy.phase[e] = want
        Enemy.transitionT[e] = PHASE_TRANSITION_TIME
        Enemy.chainNext[e] = NO_CHAIN
        Health.invulnT[e] = PHASE_TRANSITION_TIME
        Actor.state[e] = ActorState.Idle
        Actor.timer[e] = 0
        Actor.cooldownT[e] = PHASE_TRANSITION_TIME
        // 붙어서 딜을 넣던 자세를 한 번 끊습니다 — 전환이 "쉬는 시간"이 아니라
        // **자리를 다시 잡는 시간**이 되어야 페이즈가 바뀐 값어치가 있습니다.
        const kdx = px - Transform.x[e]
        const kdz = pz - Transform.z[e]
        const klen = Math.hypot(kdx, kdz) || 1
        Velocity.kx[playerEntity] += (kdx / klen) * PHASE_SHOCKWAVE
        Velocity.kz[playerEntity] += (kdz / klen) * PHASE_SHOCKWAVE
        const def = BOSS_PHASES[want]
        phaseEvents.push({
          entity: e,
          phase: want,
          name: def.name,
          banner: def.banner,
          desc: def.desc,
          x: Transform.x[e],
          z: Transform.z[e],
        })
        continue
      }
    }

    if (Actor.cooldownT[e] > 0) Actor.cooldownT[e] = Math.max(0, Actor.cooldownT[e] - dt)

    /**
     * ── 강인도 회복 ────────────────────────────────────────────────
     *
     * 한동안 안 맞으면 차오릅니다. 회복이 없으면 전투가 길어질수록 누적만
     * 되어서 **결국 무조건 무너지는 것**이 되고, 그건 예전의 "무조건 경직"과
     * 결과가 같습니다. 회복이 있어야 "한 번에 몰아쳐야 무너뜨린다"가 됩니다.
     */
    if (Enemy.brokenT[e] > 0) Enemy.brokenT[e] = Math.max(0, Enemy.brokenT[e] - dt)
    Enemy.poiseIdleT[e] += dt
    if (Enemy.poiseIdleT[e] >= POISE.regenDelay && Enemy.poise[e] < cfg.poiseMax) {
      Enemy.poise[e] = Math.min(cfg.poiseMax, Enemy.poise[e] + POISE.regenPerSec * dt)
    }

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

    /**
     * ── 보스 조우 (전용 영역) ──────────────────────────────────────
     *
     * 보스는 **자기 자리를 중심으로 한 영역** 안에서만 싸웁니다.
     *
     * 왜 필요한가: 보스 어그로가 55m라 존을 가로지르면 잡몹 전투 도중에
     * 보스가 걸어 들어왔습니다. 3페이즈짜리 보스전을 잡몹 넷과 섞으면
     * 페이즈도 연계도 읽을 수가 없습니다. 그리고 걷다 보면 어느새 시작돼
     * 있어서 **준비할 순간이 없었습니다.**
     *
     * 안개문 대신 영역을 쓴 이유는 balance.ts BOSS_ARENA 주석 참고
     * (쿼터뷰에서 안 보이는 벽은 버그로 읽힙니다).
     */
    if (isBoss) {
      const homeDist = Math.hypot(px - Enemy.homeX[e], pz - Enemy.homeZ[e])
      const state = Enemy.encounter[e]

      if (state === 0) {
        // 대기 — 영역 밖이면 아무것도 안 합니다. 어그로도 안 잡힙니다.
        if (homeDist > BOSS_ARENA.radius || !playerAlive) {
          Enemy.aggro[e] = 0
          decayVelocity(e, dt, 6)
          continue
        }
        Enemy.encounter[e] = 1
        Enemy.introT[e] = BOSS_ARENA.introTime
        Enemy.aggro[e] = 1
        encounterEvents.push({
          entity: e,
          name: cfg.name,
          maxHp: Health.max[e],
          x: Transform.x[e],
          z: Transform.z[e],
        })
      }

      if (Enemy.encounter[e] === 1) {
        // 조우 연출 — 플레이어를 노려보기만 합니다. 여기가 "준비할 순간"입니다.
        Enemy.introT[e] = Math.max(0, Enemy.introT[e] - dt)
        turnToward(e, Math.atan2(px - Transform.x[e], pz - Transform.z[e]), cfg.turnSpeedDeg, dt)
        decayVelocity(e, dt, 8)
        if (Enemy.introT[e] <= 0) {
          Enemy.encounter[e] = 2
          Actor.cooldownT[e] = 0.35
        }
        continue
      }

      const selfHome = Math.hypot(Transform.x[e] - Enemy.homeX[e], Transform.z[e] - Enemy.homeZ[e])
      /**
       * **거리만으로 판정하지 않습니다.**
       *
       * 자동 플레이에서 봇이 보스를 240초 동안 못 잡았는데, 원인이 여기였습니다:
       * 체력이 낮아 물러나 회복하면 그 후퇴가 반경을 넘겨 보스가 초기화되고,
       * 돌아오면 처음부터. 무한 반복이었습니다.
       *
       * "물러나서 회복하고 복귀"는 소울라이크의 **정상적인 플레이**이고,
       * "때리고 도망"은 우리가 막으려던 것입니다. 거리로는 둘이 같아 보이지만
       * **시간을 붙이면 갈립니다.** 잠깐 나갔다 오는 것은 허용합니다.
       */
      if (Enemy.encounter[e] === 2) {
        if (homeDist > BOSS_ARENA.leashRadius) Enemy.leashT[e] += dt
        else Enemy.leashT[e] = 0
      }
      if (
        Enemy.encounter[e] === 2 &&
        (Enemy.leashT[e] >= BOSS_ARENA.leashGrace || !playerAlive)
      ) {
        // 영역 밖에 계속 머물렀습니다 — 귀환.
        Enemy.leashT[e] = 0
        Enemy.encounter[e] = 3
        Enemy.aggro[e] = 0
        Actor.state[e] = ActorState.Idle
        Enemy.chainNext[e] = NO_CHAIN
        encounterEvents.push({ entity: e, name: '', maxHp: 0, x: 0, z: 0 })
      }

      if (Enemy.encounter[e] === 3) {
        /**
         * 귀환 — 자리로 걸어 돌아가며 **체력·페이즈·강인도를 전부 되돌립니다.**
         *
         * 되돌리지 않으면 "때리고 도망, 회복하고 다시"가 최적 전략이 되어
         * 보스전이 소모전이 됩니다. 도망은 가능하되 **아무것도 얻지 못해야**
         * 안개문에 갇힌 것과 같은 압박이 됩니다.
         */
        if (selfHome < 1.2) {
          Enemy.encounter[e] = 0
          Health.hp[e] = Health.max[e]
          Enemy.phase[e] = 0
          Enemy.poise[e] = cfg.poiseMax
          Enemy.brokenT[e] = 0
          Enemy.transitionT[e] = 0
          Enemy.leashT[e] = 0
          decayVelocity(e, dt, 8)
          continue
        }
        const hx = Enemy.homeX[e] - Transform.x[e]
        const hz = Enemy.homeZ[e] - Transform.z[e]
        const hl = Math.hypot(hx, hz) || 1
        const accel = 26 * dt
        const speed = cfg.moveSpeed * BOSS_ARENA.returnSpeedScale
        Velocity.x[e] += clampMag((hx / hl) * speed - Velocity.x[e], accel)
        Velocity.z[e] += clampMag((hz / hl) * speed - Velocity.z[e], accel)
        turnToward(e, Math.atan2(hx, hz), cfg.turnSpeedDeg, dt)
        // 돌아가는 동안은 무적입니다 — 뒤에서 쫓아가며 때리는 것이
        // "리셋 없이 딜을 넣는" 우회로가 되면 안 됩니다.
        Health.invulnT[e] = Math.max(Health.invulnT[e], 0.2)
        continue
      }
    }

    if (Enemy.aggro[e] === 0 && dist <= cfg.aggroRange) Enemy.aggro[e] = 1

    if (Enemy.aggro[e] === 0) {
      decayVelocity(e, dt, 5)
      continue
    }

    if (Actor.state[e] === ActorState.Attack) {
      const phase = Actor.phase[e] as AttackPhase
      const atk = attackAt(kind, Enemy.attackIndex[e])

      if (phase === AttackPhase.Windup) {
        turnToward(e, toPlayer, cfg.turnSpeedDeg * 0.3, dt)
      }

      /**
       * 공격 중에는 발이 묶입니다 — 적도 커밋합니다.
       *
       * **단, 연계로 들어온 공격의 선행동작만 예외입니다.**
       * 이 예외가 없으면 2단계의 `🔵 속박 → 🔴 직격` 이 설계대로 작동하지
       * 않습니다: 속박은 5.5m까지 닿는데 직격은 4.2m라서, 5m 거리에서
       * 묶인 플레이어에게는 후속타가 그냥 빗나갑니다. 그러면
       * **"파랑을 무적으로 넘겨야 한다"** 는 교훈이 성립하지 않습니다.
       *
       * 그래서 연계 선행동작 동안 보스가 **성큼 다가옵니다.** 예고는 그대로
       * 다 나오므로 여전히 읽고 대응할 수 있고, 다만 "멀리 있으면 저절로
       * 안 맞는다"가 사라집니다 — 파랑을 무시한 대가가 확실해집니다.
       */
      if (phase === AttackPhase.Windup && Enemy.chained[e] === 1 && dist > atk.reach * 0.7) {
        const nx = dist > 0.0001 ? dx / dist : 0
        const nz = dist > 0.0001 ? dz / dist : 0
        const accel = 30 * dt
        Velocity.x[e] += clampMag(nx * cfg.moveSpeed * 1.35 - Velocity.x[e], accel)
        Velocity.z[e] += clampMag(nz * cfg.moveSpeed * 1.35 - Velocity.z[e], accel)
      } else {
        decayVelocity(e, dt, 12)
      }

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
          sfx.swing(cfg.heavy ? 0.95 : 0.55, Transform.x[e], Transform.z[e])
        } else if (phase === AttackPhase.Active) {
          Actor.phase[e] = AttackPhase.Recovery
          Actor.timer[e] = atk.recovery
        } else {
          /**
           * ── 연계 ────────────────────────────────────────────────
           * 후딜이 끝나는 순간, 페이즈가 정해 둔 다음 패턴이 있으면
           * **쿨다운도 토큰도 없이** 바로 겁니다.
           *
           * 토큰을 요구하지 않는 이유: 연계는 이미 시작한 하나의 공격이
           * 두 박자로 이어지는 것이지, 새 공격자가 끼어드는 것이 아닙니다.
           * (보스는 1:1이라 실제로 다른 적과 겹칠 일도 없습니다.)
           *
           * **예고는 그대로 다 나옵니다.** 사라지는 건 쉬는 시간뿐입니다 —
           * bossPhases.ts 의 "예고는 줄이지 않는다" 원칙 그대로입니다.
           */
          const next = Enemy.chainNext[e]
          Actor.state[e] = ActorState.Idle
          if (next !== NO_CHAIN) {
            Enemy.chainNext[e] = NO_CHAIN
            Actor.cooldownT[e] = 0
            commitAttack(e, kind, next, ph.windupScale, true)
          } else {
            Actor.cooldownT[e] = cfg.attackCooldown * ph.cooldownScale
          }
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
      const list = attacksFor(kind)
      let picked = pickAttack(list, dist, combatRng.next(), ph.weights)
      // 광역 자리가 찼으면 좁은 패턴으로 바꿔 답니다. 그냥 취소하면 그 적이
      // 아무것도 안 하고 서 있게 되어 전투가 심심해집니다 — 막는 게 아니라 **바꾸는** 것입니다.
      if (picked && picked.arcDeg >= WIDE_ARC_DEG && wideSlotsLeft <= 0) {
        picked = list.find((a) => a.arcDeg < WIDE_ARC_DEG && dist >= a.minRange && dist <= a.maxRange) ?? null
      }
      if (picked) {
        if (picked.arcDeg >= WIDE_ARC_DEG) wideSlotsLeft--
        commitGapT = ATTACK_COMMIT_GAP
        tokens.delete(e)
        commitAttack(e, kind, list.indexOf(picked), ph.windupScale)
        decayVelocity(e, dt, 12)
        continue
      }
    }

    /**
     * ── 거리 유지 (원거리 적) ──────────────────────────────────────
     *
     * `keepDistance` 가 있는 적은 그보다 가까워지면 **물러납니다.**
     *
     * 이 열 줄이 없으면 원거리 적이라는 개념 자체가 성립하지 않습니다.
     * 얽는 자는 6m 사거리를 갖고 있지만, 접근 로직만 있으면 결국
     * 플레이어 코앞까지 걸어와서 **체력 40짜리 약한 잡몹**이 됩니다.
     * 그러면 "파랑을 가르친다"는 이 적의 존재 이유가 사라지고,
     * 플레이어는 그냥 다른 적들과 같이 두들겨 패면 그만입니다.
     *
     * 물러나는 속도를 접근보다 느리게(0.85배) 둔 이유: 같은 속도면
     * 플레이어가 **영원히 따라잡을 수 없습니다.** 쫓아가면 잡히지만
     * 시간이 걸리는 것 — 그게 "먼저 뭘 죽일까"라는 판단을 만듭니다.
     */
    const keep = cfg.keepDistance ?? 0
    const tooClose = keep > 0 && dist < keep

    if (tooClose) {
      const nx = dist > 0.0001 ? dx / dist : 0
      const nz = dist > 0.0001 ? dz / dist : 0
      const accel = 26 * dt
      const back = cfg.moveSpeed * 0.85 * snareScale
      Velocity.x[e] += clampMag(-nx * back - Velocity.x[e], accel)
      Velocity.z[e] += clampMag(-nz * back - Velocity.z[e], accel)
    } else if (inRange) {
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
