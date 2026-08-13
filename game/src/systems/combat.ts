import { FINISH_COMBO, HEAVY_COMBO, finisherStep, heavyStep, type SkillShape } from '../config/arsenal'
import { COMBAT, COUNTER, FOCUS, PLAYER, POISE } from '../config/balance'
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
import { BOSS_PHASES } from '../config/bossPhases'
import { enemyDef } from '../config/enemies'
import { AttackIntent, attackAt } from '../config/enemyAttacks'
import { defineQuery, hasComponent } from '../core/ecs'
import { combatRng } from '../core/rng'
import { time } from '../core/time'
import { skillForSlot, weaponDamageMult, weaponOf } from './loadout'

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
  /**
   * **누가 때렸는가** — 엔티티 번호.
   *
   * ── 왜 넣었나 (귀속을 추측에서 사실로) ────────────────────────
   * 지금까지 main.ts 는 "맞은 순간 **판정 단계에 있는 적**을 찾아서" 그
   * 적의 것으로 귀속시켰습니다. 적이 하나일 때는 맞지만, 둘이 동시에
   * 판정에 들어가 있으면 **먼저 찾은 쪽**이 가져갑니다. 이 저장소가
   * 장부 때문에 결론을 두 번 물린 적이 있는데, 원인은 늘 이런
   * "그럴듯한 추측"이었습니다. 때린 쪽은 여기서 이미 알고 있으므로
   * 추측할 이유가 없습니다.
   */
  attacker: number
  /** 적의 공격이면 그 패턴 id. 플레이어의 공격이면 빈 문자열. */
  attackId: string
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
  /** 🥋 강타(집중 소모)인가 — 강인도를 크게 깎습니다. */
  heavyBlow?: boolean
  /**
   * 🟡 **판정이 active 구간 내내 남는가.**
   *
   * ── 왜 필요해졌는가 ────────────────────────────────────────────
   * 자동 플레이로 재보니 적의 **적중률이 7%** 였습니다(74회 휘둘러 5회).
   * 봇은 4색을 구분하지 못하고 **아무 예고에나 구르기만** 하는데도요.
   *
   * 원인은 판정이 active **첫 프레임에 한 번만** 나가는 것이었습니다.
   * 구르기 무적이 0.24초라, 그 한 순간만 겹치면 **광역기도 제자리에서
   * 넘어갑니다.** DESIGN.md 4색 표에 *"🟡 노랑 — 걸어서 이탈, 구르기로도
   * 안쪽에 남습니다"* 라고 적어 뒀는데, 실제로는 성립하지 않고 있었습니다.
   *
   * 그러면 "색만 다르고 대응이 같으면 색은 장식"이라는 우리 규칙을
   * 우리가 어기고 있는 셈입니다. 구르기 하나가 다섯 색의 정답이 됩니다.
   *
   * 판정이 **머무르게** 하면 규칙이 저절로 성립합니다. 무적으로 첫 순간을
   * 넘겨도 장판이 아직 거기 있으니, **밖으로 나가는 것 말고는 답이 없습니다.**
   * (반대로 범위 밖으로 굴러 나가면 여전히 안전합니다 — 막다른 길이 아닙니다.)
   */
  lingers?: boolean
  /** 치명타·백어택 배수를 받지 않는다 (처형처럼 이미 큰 한 방). */
  noCrit?: boolean
  /** 처형인가 — 맞히면 무방비를 소모합니다. */
  finisher?: boolean
  /** 무기별 강인도 배율 (arsenal.ts WeaponDef.poiseScale) */
  poiseScale?: number
  /**
   * 🏹 **몸에 막힙니다** — 부채꼴 안에서 가장 가까운 **하나**만, 진영을 안 가리고.
   * 근거는 enemyAttacks.ts `projectile` 주석(엄폐).
   */
  projectile?: boolean
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

/** 처형이 들어간 순간 — 연출과 계측이 읽습니다. */
export const finisherEvents: { entity: number; x: number; y: number; z: number }[] = []

const attackers = defineQuery(Transform, Actor)
const targets = defineQuery(Transform, Body, Health)
const livingEnemies = defineQuery(Enemy, Health, Transform, Body, Actor)

function comboSpec(e: number, comboIndex: number): AttackSpec {
  const weapon = weaponOf(e)
  // 🥋 강타 — 콤보 마무리에서 파생시키고, 태운 집중만큼 세집니다.
  if (comboIndex === HEAVY_COMBO) {
    const h = heavyStep(weapon, Player.focusSpent[e])
    return {
      shape: 'cone',
      damage: h.damage * weaponDamageMult(e),
      range: h.range,
      arcDeg: h.arcDeg,
      knockback: h.knockback,
      hitstop: h.hitstop,
      trauma: h.trauma,
      heavy: true,
      heavyBlow: true,
      poiseScale: weapon.poiseScale,
      hits: 1,
      healSelf: 0,
    }
  }
  // 처형 — 무방비인 적에게만 나가는 한 방.
  if (comboIndex === FINISH_COMBO) {
    const f = finisherStep(weapon)
    return {
      shape: 'cone',
      damage: f.damage * weaponDamageMult(e),
      range: f.range,
      arcDeg: f.arcDeg,
      knockback: f.knockback,
      hitstop: f.hitstop,
      trauma: f.trauma,
      heavy: true,
      /**
       * 처형은 **치명타 배수를 받지 않습니다.**
       * 백어택 치명타와 겹치면 한 방에 전투가 끝나 버립니다 —
       * 무방비인 적은 등을 잡기가 너무 쉬워서(안 돌아섭니다) 사실상 상시
       * 중첩이 됩니다. 처형의 값은 배수가 아니라 **창을 소모하는 거래**입니다.
       */
      noCrit: true,
      finisher: true,
      poiseScale: weapon.poiseScale,
      hits: 1,
      healSelf: 0,
    }
  }
  const c = weapon.combo[Math.min(comboIndex, weapon.combo.length - 1)]
  return {
    shape: 'cone',
    damage: c.damage * weaponDamageMult(e),
    range: c.range,
    arcDeg: c.arcDeg,
    knockback: c.knockback,
    hitstop: c.hitstop,
    trauma: c.trauma,
    heavy: comboIndex === weapon.combo.length - 1,
    poiseScale: weapon.poiseScale,
    hits: 1,
    healSelf: 0,
  }
}

function skillSpec(e: number, slot: number): AttackSpec | null {
  const def = skillForSlot(e, slot)
  if (!def) return null
  return {
    shape: def.shape,
    // 무기 스킬(0~2)만 강화의 영향을 받습니다. 룬(3~4)은 무기가 아닙니다.
    damage: def.damage * (slot <= 2 ? weaponDamageMult(e) : 1),
    range: def.range,
    arcDeg: def.arcDeg,
    knockback: def.knockback,
    hitstop: def.hitstop,
    trauma: def.trauma,
    heavy: def.damage >= 35,
    // 무기 스킬(0~2)은 그 무기의 성격을 따릅니다. 룬(3~4)은 무기가 아니라 1배.
    poiseScale: slot <= 2 ? weaponOf(e).poiseScale : 1,
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
  const kind = Enemy.kind[e]
  const cfg = enemyDef(kind)
  const def = attackAt(kind, Enemy.attackIndex[e])
  return {
    // 360°짜리 전방위 패턴은 각도 검사를 건너뛰도록 circle로 넘깁니다.
    shape: def.arcDeg >= 359 ? 'circle' : 'cone',
    damage: def.damage,
    range: def.reach,
    arcDeg: def.arcDeg,
    knockback: def.knockback,
    hitstop: cfg.hitstop,
    trauma: cfg.trauma,
    heavy: cfg.heavy,
    hits: 1,
    healSelf: 0,
    snare: def.snare,
    pull: def.pull,
    projectile: def.projectile,
    // 🟡 광역만 머무릅니다. 다른 색은 "한 순간"이 정체성입니다.
    lingers: def.intent === AttackIntent.Sweep,
  }
}

/**
 * 적의 강인도를 깎고, 다 깎였으면 무너뜨립니다.
 *
 * ── 왜 "맞으면 무조건 경직"을 버렸는가 ──────────────────────────
 * 측정 결과, 계속 때리기만 하면 **보스가 14초 동안 단 한 번도 공격하지
 * 못했습니다**(3회 → 0회). 3페이즈도 4색 연계도 왼클릭 연타 하나에
 * 전부 무의미했습니다.
 *
 * ── 그렇다고 끊기를 없애지는 않았습니다 ────────────────────────
 * **예고(Windup) 중에 맞으면 강인도가 2.5배로 깎입니다.**
 * "아무 때나 연타"는 막히고 "예고를 읽고 끊기"는 살아 있습니다 —
 * 오히려 타이밍을 요구하므로 4색을 읽을 이유가 하나 더 늘어납니다.
 *
 * 강인도 피해를 `trauma` 에서 뽑는 이유는 balance.ts POISE 주석 참고
 * (같은 뜻의 숫자를 두 벌 두지 않기 위해서입니다).
 */
/**
 * 한 타격이 깎는 **강인도 피해**. 판정과 표시가 반드시 같은 식을 쓰게
 * 하려고 함수로 꺼냈습니다.
 *
 * ── 왜 꺼냈는가 ──────────────────────────────────────────────────
 * 강인도 바에 *"여기까지 깎으면 강타 한 방에 무너진다"* 눈금을 새기는데,
 * 그 눈금 위치를 화면 쪽에서 **다시 계산**하면 언젠가 반드시 어긋납니다.
 * 그리고 어긋나는 방향이 최악입니다 — 게임은 안 무너뜨렸는데 화면은
 * *"지금이다"* 라고 말하는 것. 예고가 틀리면 없느니만 못합니다.
 *
 * > 규칙은 한 곳에만. 화면은 판정과 **같은 함수**를 부릅니다.
 *
 * 보스는 **페이즈가 오를수록 덜 무너집니다**(bossPhases.ts poiseResist 설계 노트).
 * 후반 화력의 상당 부분이 붕괴→처형에서 나오기 때문에, 여기가 페이즈
 * 길이를 되찾는 가장 원인에 가까운 자리입니다.
 */
export function poiseDamage(
  trauma: number,
  poiseScale: number,
  multiplier: number,
  kind: number,
  phase: number,
): number {
  // 무기 성격(poiseScale)이 여기서 곱해집니다 — 대검은 무너뜨리고 단검은 못 합니다.
  const dmg = trauma * POISE.fromTrauma * multiplier * poiseScale
  if (kind !== EnemyKind.Boss) return dmg
  return dmg / (BOSS_PHASES[Math.min(BOSS_PHASES.length - 1, phase)].poiseResist ?? 1)
}

function applyPoise(t: number, spec: AttackSpec, behind = false): void {
  const winding = Actor.state[t] === ActorState.Attack && Actor.phase[t] === AttackPhase.Windup

  /**
   * 🟢 초록 예고 중에는 **강인도가 깎이지 않습니다.**
   *
   * 프로브가 잡은 것: 스킬로만 반격되게 막아 놨더니, 이번엔 좌클릭 연타로
   * **강인도를 깎아** 초록 예고를 끊고 있었습니다(8초에 무너짐 3회 중 반격은 1회).
   * 그러면 반격은 있어도 그만 없어도 그만인 기능이 됩니다.
   *
   * 예외를 두는 근거: 다른 넷은 "예고 중에 때리면 더 깎인다"(×2.5)가 보상인데,
   * 초록은 **예고 중에 때리는 것 자체가 이미 전용 답(반격)** 을 갖고 있습니다.
   * 두 답이 같은 입력에 겹치면 쉬운 쪽(연타)이 이깁니다. 그래서 초록 예고를
   * 끊는 길은 반격 하나만 남깁니다 — 그것이 이 색의 정의입니다.
   * (피해는 정상적으로 들어갑니다. 못 깎이는 것은 강인도뿐입니다.)
   */
  if (winding && attackAt(Enemy.kind[t], Enemy.attackIndex[t]).intent === AttackIntent.Counter) {
    Enemy.poiseIdleT[t] = 0
    return
  }
  /**
   * 배수는 **겹치지 않고 하나만** 고릅니다.
   * 예고 중 강타가 ×2.5×2.2 = 5.5배가 되면 보스도 두 방에 무너집니다 —
   * "둘 다 쓰면 두 배로 좋다"는 곱셈은 밸런스를 빠르게 무너뜨립니다.
   * 평타는 `basicMultiplier` 로 크게 줄여, 끊는 수단에 값을 몰아줍니다.
   */
  const multiplier = spec.heavyBlow
    ? FOCUS.poiseMult
    : winding
      ? POISE.windupMultiplier
      : behind
        ? POISE.backMultiplier
        : POISE.basicMultiplier
  const dmg = poiseDamage(spec.trauma, spec.poiseScale ?? 1, multiplier, Enemy.kind[t], Enemy.phase[t])

  Enemy.poiseIdleT[t] = 0
  Enemy.poise[t] -= dmg
  if (Enemy.poise[t] > 0) return

  breakPoise(t)
}

/**
 * 강인도를 즉시 깨뜨립니다.
 *
 * 공격으로 깎아서 0이 된 경우와, 낙하처럼 **공격이 아닌 이유**로 무너지는
 * 경우가 같은 결과여야 합니다. 두 군데에 같은 코드를 적으면 한쪽만 고치는
 * 날이 반드시 옵니다.
 *
 * 긴 무방비 자체가 보상입니다. 별도의 피해 배수는 붙이지 않았습니다 —
 * 백어택 치명타와 겹치면 한 번의 실수로 전투가 끝나 버립니다.
 */
export function breakPoise(t: number): void {
  const cfg = enemyDef(Enemy.kind[t])
  /**
   * **끊긴 순간이 예고 중이었는가** — 상태를 바꾸기 전에 잡아 둡니다.
   *
   * 반격 프로브가 이걸 폴링(8ms마다 broken 관측)으로 세고 있었는데,
   * 처형이 들어오면 무방비가 **즉시 닫혀서** 관측을 통째로 놓쳤습니다.
   * "반격 1회 · 관측된 끊김 0회" 라는 앞뒤 안 맞는 결과가 그래서 나왔습니다.
   * 사건은 사건이 일어난 자리에서 기록해야 합니다.
   */
  const duringWindup =
    Actor.state[t] === ActorState.Attack && Actor.phase[t] === AttackPhase.Windup
  Enemy.poise[t] = cfg.poiseMax
  Enemy.poiseIdleT[t] = 0
  /**
   * **무너뜨린 타격은 밀지 않습니다.**
   *
   * 이 프레임에 이미 들어간 넉백을 여기서 지웁니다(판정이 넉백 → 강인도
   * 순서라 취소가 가장 단순합니다).
   *
   * ── 왜 ────────────────────────────────────────────────────────
   * 처형을 넣고 재 보니 한 판에 **붕괴 43회 · 처형 1회** 였습니다.
   * 무방비 창은 잡몹 1.0초인데, 무너뜨린 그 타격의 넉백이 적을 2~4m 밖으로
   * 밀어냅니다. 그래서 창의 대부분이 **다시 걸어가는 시간**으로 사라집니다.
   *
   * 세키로의 체간 붕괴도, 소울의 리포스트도 적을 날려 보내지 않습니다.
   * 무너진 적은 **그 자리에 주저앉아야** 합니다 — 그래야 "무너뜨렸다"가
   * 곧바로 "지금 뭘 할 수 있다"로 이어집니다. 밀어내면 보상이 아니라
   * 거리 재설정이 됩니다.
   */
  Velocity.kx[t] = 0
  Velocity.kz[t] = 0
  Enemy.brokenT[t] = Enemy.kind[t] === EnemyKind.Boss ? POISE.brokenTimeBoss : POISE.brokenTime
  Actor.state[t] = ActorState.Stagger
  Actor.timer[t] = Enemy.brokenT[t]
  Actor.hitsLeft[t] = 0
  Actor.comboWindowT[t] = 0
  Actor.bufferedAttack[t] = 0
  breakEvents.push({
    entity: t,
    x: Transform.x[t],
    y: Transform.y[t],
    z: Transform.z[t],
    duringWindup,
  })
}

/** 적이 무너진 순간. 게임 루프가 읽고 비웁니다. */
export interface BreakEvent {
  entity: number
  x: number
  y: number
  z: number
  /** 끊긴 순간이 **예고 중**이었는가 (반격 프로브가 읽습니다) */
  duringWindup?: boolean
}
export const breakEvents: BreakEvent[] = []

/** 🟢 반격이 성립한 순간. 무너짐과 **따로** 알립니다 — 다른 사건이기 때문입니다. */
export const counterEvents: BreakEvent[] = []

/** 🥋 완벽 회피 — 실제로 맞을 공격을 무적 프레임으로 넘긴 순간. */
export const perfectDodgeEvents: BreakEvent[] = []

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

    /**
     * ── 한 프레임에 **여러 타**가 나갈 수 있어야 합니다 ────────────────
     *
     * 원래는 프레임당 최대 한 타였습니다. 그래서 5회 다단히트(active 0.45초,
     * 간격 0.09초)가 **초당 11프레임 미만**에서는 5회를 다 못 채웁니다.
     * 검증 컨테이너(GPU 없음, 약 10fps)에서 재 보니 정확히 **4회**만
     * 들어갔습니다 — 설계상 5회인데 20%가 조용히 사라지고 있었습니다.
     *
     * 이건 검증 환경만의 문제가 아닙니다. 저사양 기기나 순간적인 프레임
     * 드랍에서 **스킬의 위력이 조용히 줄어듭니다.** 플레이어에게는 "가끔
     * 딜이 덜 들어간다"로만 보이고 이유를 알 방법이 없습니다.
     *
     * 그래서 남은 시간(carry)을 들고 밀린 타격을 그 자리에서 몰아 칩니다.
     * 프레임률이 판정을 바꾸지 않게 하는 것이 원칙입니다.
     */
    let carry = dt
    if (Actor.nextHitT[a] > 0) {
      const used = Math.min(Actor.nextHitT[a], carry)
      Actor.nextHitT[a] -= used
      carry -= used
      if (Actor.nextHitT[a] > 0) continue
    }

    const spec = currentSpec(a)
    if (!spec) {
      Actor.hitsLeft[a] = 0
      continue
    }

    // 한 프레임이 아무리 길어도 여기서 끝없이 돌지 않게 상한을 둡니다.
    for (let guard = 0; guard < 16; guard++) {
      const landed = applyHit(a, spec)
      /**
       * 머무는 판정은 **실제로 맞혔을 때만** 소모합니다.
       * 안 맞았으면 active 가 끝날 때까지 매 프레임 다시 봅니다 —
       * 그래서 무적으로 첫 순간을 넘겨도 장판은 아직 거기 있습니다.
       */
      if (spec.lingers && !landed) break
      Actor.hitsLeft[a] = Math.max(0, Actor.hitsLeft[a] - 1)
      if (Actor.hitsLeft[a] === 0) break
      // 남은 타격을 active 구간에 균등 분배합니다.
      const interval = activeDurationOf(a) / spec.hits
      if (carry < interval) {
        Actor.nextHitT[a] = interval - carry
        break
      }
      carry -= interval
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
  return enemyDef(Enemy.kind[a]).active
}

/** @returns 누군가를 실제로 때렸는가 (머무는 판정이 소모될지 판단합니다) */
function applyHit(a: number, spec: AttackSpec): boolean {
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
      attacker: a,
      attackId: '',
    })
  }

  if (spec.damage <= 0) return false

  const originX = spec.originX ?? Transform.x[a]
  const originZ = spec.originZ ?? Transform.z[a]
  const rot = Transform.rotY[a]
  const fx = Math.sin(rot)
  const fz = Math.cos(rot)
  const halfArc = (spec.arcDeg * Math.PI) / 180 / 2
  let landed = false

  const tids = targets.run()
  const tcount = targets.count

  /**
   * 판정 도형 안에 있는가 — 있으면 거리를, 아니면 -1.
   *
   * 아래 루프와 **같은 함수**를 씁니다. 엄폐(누가 화살을 막는가)를 고를 때와
   * 실제로 때릴 때의 기준이 다르면, "막았는데 안 맞았다" 같은 유령이 생깁니다.
   */
  const shapeDist = (t: number): number => {
    const dx = Transform.x[t] - originX
    const dz = Transform.z[t] - originZ
    const dist = Math.hypot(dx, dz)
    // 판정 거리에 대상 반지름을 더합니다. 안 더하면 덩치 큰 적을
    // 코앞에서 때려도 빗나가는 것처럼 느껴집니다.
    if (dist > spec.range + Body.radius[t]) return -1
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
      if (dot < Math.cos(Math.min(Math.PI, halfArc + slack))) return -1
    }
    return dist
  }

  /**
   * ---- 🏹 엄폐 — 화살은 **처음 만나는 몸**에 박힙니다 ----
   *
   * 여기서만 아군 오사 방지를 **끕니다.** 진영을 안 가리고 가장 가까운
   * 하나를 고르고, 나머지는 전부 건너뜁니다.
   *
   * ⚠️ 무적 상태(`invulnT`)인 대상도 **막는 쪽으로는 셉니다.** 무적은
   *    "피해를 안 받는다"이지 "몸이 없다"가 아닙니다. 이걸 빼면 방금 맞은
   *    잡몹을 화살이 통과해서, 플레이어가 보기에 이유 없이 뚫립니다.
   */
  let blocker = -1
  if (spec.projectile) {
    let nearest = Infinity
    for (let j = 0; j < tcount; j++) {
      const t = tids[j]
      if (t === a) continue
      if (Actor.state[t] === ActorState.Dead) continue
      const d = shapeDist(t)
      if (d < 0 || d >= nearest) continue
      nearest = d
      blocker = t
    }
    if (blocker < 0) return false
  }

  for (let j = 0; j < tcount; j++) {
    const t = tids[j]
    if (t === a) continue

    const targetIsPlayer = hasComponent(Player, t)
    // 아군 오사 방지 — 플레이어는 적만, 적은 플레이어만 때립니다.
    // 단 🏹 몸에 막히는 공격은 **막은 그 하나**만 때립니다(진영 무관).
    if (spec.projectile) {
      if (t !== blocker) continue
    } else if (attackerIsPlayer === targetIsPlayer) {
      continue
    }

    if (Actor.state[t] === ActorState.Dead) continue
    if (Health.invulnT[t] > 0) continue

    const dist = shapeDist(t)
    if (dist < 0) continue
    const dx = Transform.x[t] - originX
    const dz = Transform.z[t] - originZ

    /**
     * ---- 🥋 완벽 회피 ----
     *
     * **기하 판정을 다 통과한 뒤에** 무적 프레임을 봅니다.
     *
     * 예전에는 판정 맨 앞에서 걸렀습니다. 그러면 "맞을 리도 없던 공격을
     * 굴러 넘긴 것"과 "코앞의 일격을 정확히 넘긴 것"이 **구분되지 않습니다.**
     * 집중을 주려면 후자만 세야 합니다 — 오공의 완벽 회피가 재밌는 이유가
     * 바로 그 구분이기 때문입니다. 아무 때나 구르면 쌓이는 자원은
     * 자원이 아니라 그냥 시간입니다.
     */
    if (targetIsPlayer && isInIFrames(t)) {
      perfectDodgeEvents.push({ entity: t, x: Transform.x[t], y: Transform.y[t], z: Transform.z[t] })
      continue
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
    /**
     * 🥋 **완벽 회피 뒤의 한 대는 확정 치명타입니다.**
     *
     * 확률을 올리는 게 아니라 **확정**으로 둔 이유: 확률이면 잘 굴렀는데도
     * 아무 일이 없는 판이 생기고, 그러면 플레이어는 회피와 보상을 잇지
     * 못합니다. 보상은 원인과 **매번** 붙어 있어야 배워집니다.
     * (창이 끝나는 것은 아래 playerControl 의 타이머가 처리합니다.)
     */
    /**
     * 🗡 **기습 — 아직 나를 못 본 적을 먼저 치는 것.**
     *
     * 보상은 이 파일이 백어택에서 이미 내린 결론 그대로입니다 —
     * *"조금 더 아프다"가 아니라 **다른 결과가 나온다**".* 그래서 피해
     * 배수를 얹지 않고 **강인도를 즉시 부숩니다.** 이미 있는 문(붕괴 →
     * 처형)으로 보내는 것이지 새 장치를 만드는 것이 아닙니다.
     *
     * ⚠️ 보스는 뺍니다. 보스는 조우 연출로 시작하는 것이 설계이고,
     *    기습으로 그 연출을 건너뛰면 페이즈 학습이 무너집니다.
     */
    const ambush =
      attackerIsPlayer &&
      !targetIsPlayer &&
      hasComponent(Enemy, t) &&
      // "지금 못 보는가"가 아니라 **"조금 전까지 못 봤는가"** — components.ts `unawareT`.
      Enemy.unawareT[t] > 0 &&
      Enemy.kind[t] !== EnemyKind.Boss
    /**
     * ⚠️ **맞으면 반드시 깨어납니다.** 이 한 줄이 없으면 못 본 적을 계속
     *    때리는 동안 **모든 타격이 기습**이 되어, 한 번의 보상이 무한
     *    반복이 됩니다.
     */
    if (attackerIsPlayer && !targetIsPlayer && hasComponent(Enemy, t)) Enemy.aggro[t] = 1

    const perfect = !targetIsPlayer && hasComponent(Player, a) && Player.perfectCritT[a] > 0
    const crit =
      !spec.noCrit && spec.damage > 0 && (perfect || combatRng.chance(critChance))
    if (perfect && !spec.noCrit && spec.damage > 0) Player.perfectCritT[a] = 0

    /**
     * ---- 🟢 반격 성립 판정 ----
     *
     * 조건 셋이 **전부** 맞아야 합니다:
     *   1) 상대가 🟢 패턴의 **예고 중**일 것 — 판정이 시작된 뒤엔 늦었습니다
     *   2) 내가 **정면**에 있을 것 — 등 뒤는 안 됩니다
     *   3) 내가 때린 것일 것 — 적끼리는 반격하지 않습니다
     *
     * 2번이 이 색의 전부입니다. 등 뒤에서도 되게 하면 백어택이 또 만능
     * 정답이 되고, 새 동사를 가르치려던 것이 옛 동사의 보너스가 됩니다.
     */
    const countered =
      attackerIsPlayer &&
      /**
       * **스킬로만 반격됩니다.**
       *
       * 처음엔 아무 공격이나 되게 했는데, 프로브가 재 보니 정면에서 좌클릭만
       * 연타해도 초록이 8초 동안 한 번도 못 터졌습니다. 반격이 결단이 아니라
       * 사고로 성립하고 있었습니다 — 새 동사를 가르치려던 것이 결국
       * '계속 때리면 되는 색'이 된 것입니다.
       *
       * 로스트아크가 카운터를 아무 공격이 아니라 카운터 **스킬**로 제한한 이유가
       * 이것입니다. 쿨다운이 붙은 자원을 써야 하므로 '지금 쓸까'가 판단이 되고,
       * 놓쳐도 구르기라는 답이 남아 있어 막다른 길이 되지 않습니다.
       * 덤으로, 놀고 있던 스킬 슬롯 다섯 개에 쓸 이유가 하나 생깁니다.
       */
      Actor.state[a] === ActorState.Skill &&
      !targetIsPlayer &&
      hasComponent(Enemy, t) &&
      Actor.state[t] === ActorState.Attack &&
      Actor.phase[t] === AttackPhase.Windup &&
      attackAt(Enemy.kind[t], Enemy.attackIndex[t]).intent === AttackIntent.Counter &&
      !isBehindPoint(Transform.x[a], Transform.z[a], Transform.x[t], Transform.z[t], Transform.rotY[t])

    let damage = spec.damage
    if (back && !spec.noCrit) damage *= COMBAT.backDamageMult
    if (crit) damage *= COMBAT.critMult
    if (countered) {
      damage *= COUNTER.damageMultiplier
      // 예고가 어떻게 끝났는지 결산하는 쪽(enemyAI)이 읽습니다.
      Enemy.counteredAt[t] = time.simElapsed
    }

    Health.hp[t] -= damage
    /**
     * ── 🟢 예고 중에는 **죽지 않습니다** (체력 1에서 멈춥니다) ──────────
     *
     * 이 색의 정의는 바로 위(강인도 면제)에 이미 적어 뒀습니다:
     * *"초록 예고를 끊는 길은 반격 하나만 남깁니다."*
     * 그런데 실제로 막아 둔 것은 **강인도로 끊는 길** 하나뿐이었고,
     * **때려죽여서 끊는 길**은 열려 있었습니다. 선언과 구현이 달랐습니다.
     *
     * 재 보니 그 구멍이 주된 통로였습니다:
     *   · 자동 플레이 — 🟢 예고 7회 중 **적이 죽어서 끝난 것 3회**
     *   · 실험대     — 예고 시작 체력 **46/46**, 예고 1.4초 동안 깎인 양 **46**
     *     (즉 이 적은 늘 만피에서 예고를 시작하고, 그 예고가 통째로
     *      공짜 딜 타임이 됩니다. 체력이 모자란 게 아니라 창이 무방비였습니다.)
     *
     * 체력을 올리는 선택은 하지 않았습니다. 그러면 "몇으로 올릴 것인가"가
     * 무기 화력·판수마다 달라지는 추측이 되고, 잡몹 하나가 스펀지가 됩니다.
     * 대신 **규칙을 선언한 대로** 만듭니다 — 예고 중에는 강인도로도, 피해로도
     * 못 끊습니다. 답은 반격 하나뿐입니다.
     *
     * 불공정하지 않은 이유: 피해는 정상적으로 다 들어가고(체력 1까지),
     * 휘두름이 끝나는 순간 다음 한 대에 죽습니다. 그리고 무엇보다
     * **막을 방법이 항상 있습니다** — 정면에서 스킬을 꽂으면 됩니다.
     * 막다른 길이 아니라 "다른 답을 요구하는 창"입니다.
     * (세키로의 위험 공격, 로스트아크의 카운터 구간이 같은 계약입니다.)
     */
    if (
      !targetIsPlayer &&
      hasComponent(Enemy, t) &&
      Actor.state[t] === ActorState.Attack &&
      Actor.phase[t] === AttackPhase.Windup &&
      attackAt(Enemy.kind[t], Enemy.attackIndex[t]).intent === AttackIntent.Counter &&
      Health.hp[t] < 1
    ) {
      Health.hp[t] = 1
    }
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

    /**
     * **처형은 죽여도 처형입니다.**
     *
     * 이 기록이 `!killed` 안에 있었습니다. 그래서 처형이 적을 **죽이면**
     * 한 번도 세어지지 않았습니다 — 자동 플레이가 매번 "처형 1회"로 찍혀서,
     * 저는 "봇이 처형을 안 쓴다"는 **틀린 결론**을 두 라운드 동안 들고
     * 있었습니다. 실제로는 잘 쓰고 있었고, 쓰면 대개 죽였을 뿐입니다.
     * (세키로의 인살이 그렇듯, 마무리가 곧 마무리인 것이 자연스럽습니다.)
     *
     * 사건은 **일어난 자리에서, 결과와 무관하게** 기록해야 합니다.
     */
    if (spec.finisher && !targetIsPlayer && hasComponent(Enemy, t)) {
      finisherEvents.push({ entity: t, x: Transform.x[t], y: Transform.y[t], z: Transform.z[t] })
    }

    if (!killed) {
      if (targetIsPlayer) {
        // 플레이어는 강인도가 없습니다 — 맞으면 항상 밀립니다.
        // 있으면 "맞아도 되는 순간"이 생겨서 예고를 읽을 이유가 줄어듭니다.
        Actor.state[t] = ActorState.Stagger
        Actor.timer[t] = PLAYER.hurtStagger
        Actor.hitsLeft[t] = 0
        Actor.comboWindowT[t] = 0
        Actor.bufferedAttack[t] = 0
      } else if (countered) {
        // 강인도를 **깎지 않고 즉시 부숩니다.** 반격은 누적의 결과가 아니라
        // 타이밍의 결과여야 합니다 — 강인도가 얼마나 남았든 성공해야 합니다.
        breakPoise(t)
        Enemy.brokenT[t] = COUNTER.brokenTime
        Actor.timer[t] = COUNTER.brokenTime
        counterEvents.push({ entity: t, x: Transform.x[t], y: Transform.y[t], z: Transform.z[t] })
      } else if (ambush) {
        // 기습은 **강인도를 깎지 않고 즉시 부숩니다** — 위 설계 노트 참고.
        breakPoise(t)
        // 유예를 비웁니다 — 한 번 놀란 적을 계속 기습할 수는 없습니다.
        Enemy.unawareT[t] = 0
      } else if (spec.finisher && hasComponent(Enemy, t)) {
        /**
         * **처형은 무방비를 소모합니다.** 넣는 순간 적이 일어납니다.
         *
         * 이게 처형을 "공짜로 얹는 피해"가 아니라 **거래**로 만드는 지점입니다.
         * 남은 창에서 두세 대 더 넣는 쪽을 고를 수도 있어야 선택이 생깁니다.
         * 강인도도 가득 채워 돌려줍니다 — 안 그러면 일어나자마자 다시 무너져
         * 처형이 무한히 이어집니다.
         */
        Enemy.brokenT[t] = 0
        Enemy.poise[t] = enemyDef(Enemy.kind[t]).poiseMax
        Enemy.poiseIdleT[t] = 0
        if (Actor.state[t] === ActorState.Stagger) Actor.timer[t] = 0
      } else if (hasComponent(Enemy, t)) {
        // `back` 은 위에서 이미 계산했습니다(근접 부채꼴 + 등 뒤).
        // 강인도에도 같은 판정을 그대로 씁니다 — 두 번 계산하면 언젠가 어긋납니다.
        applyPoise(t, spec, back)
      }
    }

    /**
     * 🥋 집중 획득 — **기본 공격만** 쌓습니다.
     *
     * 스킬로도 쌓게 하면 "스킬 → 집중 → 강타 → 스킬"이 그냥 한 줄기 흐름이
     * 되어 판단이 사라집니다. 오공에서 집중을 쌓는 것이 가벼운 공격인 이유가
     * 이것입니다 — **위험한 근접 거리에 머문 대가**로 주는 자원입니다.
     * 강타 자신도 쌓지 않습니다(태운 것을 도로 채우면 소모가 아닙니다).
     */
    if (
      attackerIsPlayer &&
      Actor.state[a] === ActorState.Attack &&
      Actor.comboIndex[a] !== HEAVY_COMBO
    ) {
      /**
       * ── 한 대가 채우는 양은 **무기마다 다릅니다** ──────────────────
       *
       * 설계가 약속한 것은 "한 대가 0.34점"이 아니라 **"콤보 한 바퀴 =
       * 1점"** 입니다(balance.ts FOCUS 설계 노트). 그런데 고정값 0.34 는
       * **3타 무기에서만** 그 약속을 지킵니다.
       *
       * `npm run rules` 가 잡았습니다 — 그것도 실수로. 새 검사가 무기를
       * 바꿔 놓고 되돌리지 않는 바람에 4타 쌍단검이 걸린 채로 검사가
       * 돌았고, `4타 × 0.34 = 1.36점` 이 나왔습니다. 프로브의 버그가
       * **진짜 구멍을 열어 보여준 것**입니다: 쌍단검은 콤보 한 바퀴마다
       * 집중을 36% 더 벌고 있었습니다.
       *
       * 그래서 값을 무기 길이에서 **끌어냅니다.** 이렇게 두면 무기를
       * 몇 타로 만들든 약속이 저절로 지켜집니다 — 다음 사람이 4타 무기를
       * 추가하면서 이 상수를 같이 고쳐야 한다는 걸 몰라도 됩니다.
       * `perLightHit` 은 이제 **3타 기준선**으로만 남습니다.
       */
      const steps = weaponOf(a).combo.length
      Player.focus[a] = Math.min(FOCUS.max, Player.focus[a] + 1 / Math.max(1, steps))
    }

    /**
     * 이 한 대가 **얼마나 읽어서 나온 것인가** — 0/1/2단.
     *
     * 겹치면 **가장 높은 것 하나만** 씁니다. 백어택이면서 치명타라고 해서
     * 0.035초를 두 번 얹으면, 잘 싸울수록 화면이 오래 멎어 버립니다.
     *
     * ⚠️ 반격(`countered`)과 처형(`spec.finisher`)은 **일부러 여기 없습니다.**
     *    둘은 COUNTER/FINISHER 라는 전용 연출값을 이미 따로 받고 있어서,
     *    등급까지 얹으면 소용이 없거나(0.18 이 이미 이김) 너무 길어집니다
     *    (0.23초). 근거는 balance.ts `feelStep` 주석에 재 놓았습니다.
     */
    const feelGrade = perfect ? 2 : back || crit ? 1 : 0

    hitEvents.push({
      x: Transform.x[t],
      y: Body.height[t] * 0.6,
      z: Transform.z[t],
      dirX: nx,
      dirZ: nz,
      damage,
      /**
       * ── 읽기의 등급만큼 정지·흔들림을 얹습니다 ────────────────────
       *
       * 근거와 등급표는 balance.ts `feelStep` 주석에 있습니다. 요약:
       * 손맛은 **컨트롤의 영수증**이고, 영수증은 **잘 읽었을 때** 커져야
       * 합니다. 예전에는 백어택 하나만 커졌습니다.
       */
      hitstop: spec.hitstop + COMBAT.feelStep * feelGrade,
      trauma: spec.trauma + COMBAT.feelTraumaStep * feelGrade,
      heavy: spec.heavy || crit,
      back,
      crit,
      victimIsPlayer: targetIsPlayer,
      killed,
      attacker: a,
      attackId: attackerIsPlayer ? '' : attackAt(Enemy.kind[a], Enemy.attackIndex[a]).id,
    })
    landed = true
  }
  return landed
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
    /**
     * 무적 창도 구르기 시간과 **같은 배율**로 늘고 줍니다.
     *
     * 절대 시간으로 고정해 두면, 빠른 무기는 구르기의 더 큰 **비율**이
     * 무적이 되어 "값도 싸고 무적도 길다"는 이중 특혜가 됩니다. 비율을
     * 맞추면 남는 차이는 템포 하나입니다 — 그리고 빠른 무기는 무적 창이
     * 절대 시간으로 짧아져 **완벽 회피가 더 빡빡해집니다.** 공짜가 아닙니다.
     */
    const scale = weaponOf(e).dodgeDurationScale ?? 1
    return t >= PLAYER.dodge.iFrameStart * scale && t <= PLAYER.dodge.iFrameEnd * scale
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
