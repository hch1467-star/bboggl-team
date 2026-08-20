import {
  FINISH_COMBO,
  HEAVY_COMBO,
  PLUNGE_COMBO,
  ROLL_COMBO,
  RUN_COMBO,
  stepFor,
  type SkillShape,
} from '../config/arsenal'
import {
  BARREL,
  BLEED,
  COMBAT,
  COUNTER,
  FOCUS,
  COMBO_FINISH_REFUND,
  GUARD,
  PLAYER,
  POISE,
  barrelFuse,
  barrelStaminaLoss,
  hurtFlash,
} from '../config/balance'
import {
  Actor,
  ActorState,
  AttackPhase,
  Barrel,
  Body,
  Enemy,
  EnemyKind,
  Health,
  Player,
  Stamina,
  Status,
  Transform,
  Velocity,
} from '../core/components'
import { BOSS_PHASES } from '../config/bossPhases'
import { bleedMaxOf, enemyDef } from '../config/enemies'
import { AttackIntent, attackAt, crossfirePause } from '../config/enemyAttacks'
import { defineQuery, hasComponent } from '../core/ecs'
import { combatRng } from '../core/rng'
import { time } from '../core/time'
import { skillForSlot, weaponHit, weaponOf } from './loadout'

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
   * 🩸 **출혈 축적 배율.** 없으면 1 로 봅니다.
   * 강인도와 **반대 방향**으로 잡습니다 — 무거운 것은 무너뜨리고 가벼운
   * 것은 터뜨립니다(arsenal.ts `bleedScale`).
   */
  bleedScale?: number
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
  /** 🌀 콤보의 마지막 타인가 — 맞히면 기력을 일부 갚습니다. */
  comboFinisher?: boolean
  /** 🌀 그 타가 쓴 기력(갚을 몫의 분모). */
  finisherCost?: number
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
  /**
   * 📊 **이 한 방이 어디서 나온 것인가** — 계측 전용, 판정에는 안 씁니다.
   *
   * 지난 라운드에 보스 페이즈별 초당 피해를 재 놓고 이렇게 적었습니다:
   * *"그 상승분이 어디서 오는지도 갈라야 처방이 정해진다 — 처형인가,
   * 무방비 창인가, 그냥 익숙해진 것인가."* 그걸 안 갈라 놓고 체력을
   * 두 번 올렸고, 두 번 다 다시 짧아졌습니다.
   *
   * 판정에 쓰지 않는 값을 스펙에 넣는 것이 마음에 걸리지만, 대안은
   * 계측기가 *"이 피해는 스킬처럼 크니 스킬일 것"* 이라고 **추측**하는
   * 것입니다. 이 저장소는 그런 추측으로 이미 여러 번 틀렸습니다.
   * **쓴 쪽이 이름을 답니다.**
   */
  source?: '평타' | '강타' | '처형' | '스킬' | '상황'
}

/** 현재 프레임에 발생한 타격들. 게임 루프가 읽고 비웁니다. */
export const hitEvents: HitEvent[] = []

/**
 * 📒 **빗나간 이유 장부** — 적이 한 번 휘두를 때마다 한 줄.
 *
 * ── 왜 필요한가 (보스가 22초 동안 한 대만 때렸습니다) ─────────────
 * 자동 플레이의 보스전이 이렇게 나왔습니다:
 *
 *     보스전 22.4초 · **받은 피해 38** (그 사이 최저 체력 78) · 처치
 *     boss_cleave 3회 휘두름 · **0회 적중**
 *
 * 존의 마지막 시험이 플레이어 체력의 22%만 깎았습니다. 그런데 **왜**
 * 빗나갔는지는 어디에도 안 남아 있었습니다. 후보가 넷이고 답이 넷 다
 * 다릅니다:
 *
 *   · 사거리 밖이었다   → 보스가 너무 멀리서 휘두른다(접근 로직)
 *   · 각도 밖이었다     → 보스가 못 따라 돈다(선회 속도 · 예고 중 추적)
 *   · 무적이었다        → 플레이어가 제대로 굴렀다(고칠 것 없음)
 *   · 맞았다            → 빗나간 게 아니다
 *
 * 짐작으로 하나를 고르면 나머지 셋을 망가뜨립니다. 그래서 **세어서**
 * 고릅니다 — 이 저장소가 계속 치른 값입니다.
 *
 * ⚠️ **근접 부채꼴만 적습니다.** 원형(🟡 광역)·투사체(🏹)는 대상이 아닙니다 —
 *    이 장부는 *"각도로 빗나갔는가"* 를 묻자고 만든 것이고, 360°짜리에는
 *    그 질문이 성립하지 않기 때문입니다.
 *
 *    그래서 **줄 수를 "적이 휘두른 횟수"로 읽으면 안 됩니다.** `npm run rhythm`
 *    이 정확히 그렇게 읽었다가 *"보스가 5.1초에 한 번만 휘두른다"* 는 가짜
 *    결론을 냈고, 그 2초를 쫓느라 가설 셋을 세워 셋 다 버렸습니다. 실제
 *    커밋은 7회인데 이 장부에는 5줄뿐이었습니다. 횟수를 물으려면 커밋을
 *    세십시오(`readIdleReasons().committed`).
 *
 * ⚠️ 판정은 **`shapeDist` 가 내립니다.** 여기서 각도를 다시 계산하지
 *    않습니다 — 그러면 판정의 사본이 생겨서, 한쪽만 고치는 날 장부가
 *    게임이 아닌 것을 재게 됩니다. 아래 `angleDeg`·`dist` 는 **사람이
 *    읽을 설명**이지 판단이 아닙니다.
 */
export interface SwingRecord {
  attackId: string
  hit: boolean
  /** 판정 순간의 거리(m). */
  dist: number
  /** 정면에서 벗어난 각도(도). */
  angleDeg: number
  /** 그 거리에서 실제로 허용된 반각(도) — 굵기 보정까지 포함합니다. */
  halfArcDeg: number
  /** 판정 사거리(m) — 대상 반지름까지 더한 값입니다. */
  reach: number
  /** 대상이 무적(구르기 등)이었나. */
  invuln: boolean
}

/**
 * 게임 루프가 아니라 **프로브가** 비웁니다(`__game.swings()`).
 * 매 프레임 비우면 실험대가 한 판을 다 돌고 나서 물어볼 수가 없습니다.
 * 그래서 상한을 두고, 넘치면 **오래된 것부터** 버립니다.
 */
export const swingRecords: SwingRecord[] = []
const SWING_LOG_MAX = 400

/**
 * ── ❌ **첫 판은 한 번의 휘두름을 여러 줄로 셌습니다** ────────────────
 *
 * 처음엔 `applyHit` 이 불릴 때마다 한 줄씩 적었습니다. 그랬더니 자동
 * 플레이에서 **휘두름 62회인데 장부는 210줄**이 나왔고, 그중 165줄이
 * `grunt_sweep` 하나였습니다. 결론은 *"71%가 사거리 밖"* — 적이 허공을
 * 친다는 뜻으로 읽힙니다.
 *
 * 거짓말이었습니다. 🟡 는 **판정이 0.55초 머무는** 공격이라(`lingers`)
 * active 내내 매 프레임 다시 검사합니다. 걸어서 빠져나간 플레이어는
 * 나머지 프레임에서 전부 "사거리 밖"으로 찍힙니다 — 그건 고장이 아니라
 * **설계된 정답**입니다(DESIGN.md 4색 표: 🟡 은 걸어서 이탈).
 *
 * 즉 장부가 *"잘 피했다"* 를 *"적이 허공을 친다"* 로 뒤집어 적고 있었습니다.
 * 그 숫자를 믿고 적의 사거리를 늘렸다면 정답을 없앨 뻔했습니다.
 *
 * 그래서 **한 번의 휘두름에 한 줄**로 바꿉니다. 판정이 살아 있는 동안은
 * 한 줄을 계속 고쳐 쓰고, 다음 휘두름이 시작될 때(또는 프로브가 읽을 때)
 * 닫습니다. 빗나간 이유는 **가장 가까웠던 순간**으로 정합니다 — 그래야
 * "사거리 밖"이 *"내내 한 번도 안 닿았다"* 를 뜻합니다.
 */
type OpenSwing = { rec: SwingRecord; minDist: number; frame: number }
const openSwings = new Map<number, OpenSwing>()

/** 열려 있던 줄을 장부에 옮깁니다. */
function closeSwing(a: number): void {
  const o = openSwings.get(a)
  if (!o) return
  openSwings.delete(a)
  swingRecords.push(o.rec)
  if (swingRecords.length > SWING_LOG_MAX) swingRecords.shift()
}

/**
 * 프로브가 장부를 읽기 전에 부릅니다 — 마지막 휘두름이 아직 열려 있으면
 * 그 한 줄이 통째로 빠집니다.
 */
export function flushSwingRecords(): void {
  for (const a of [...openSwings.keys()]) closeSwing(a)
}

/** 처형이 들어간 순간 — 연출과 계측이 읽습니다. */
export const finisherEvents: { entity: number; x: number; y: number; z: number }[] = []

const attackers = defineQuery(Transform, Actor)
const targets = defineQuery(Transform, Body, Health)
const livingEnemies = defineQuery(Enemy, Health, Transform, Body, Actor)

function comboSpec(e: number, comboIndex: number): AttackSpec {
  const weapon = weaponOf(e)
  // 🥋 강타 — 콤보 마무리에서 파생시키고, 태운 집중만큼 세집니다.
  if (comboIndex === HEAVY_COMBO) {
    const h = stepFor(weapon, HEAVY_COMBO, Player.focusSpent[e], 0)
    return {
      shape: 'cone',
      damage: weaponHit(e, h.damage),
      range: h.range,
      arcDeg: h.arcDeg,
      knockback: h.knockback,
      hitstop: h.hitstop,
      trauma: h.trauma,
      heavy: true,
      heavyBlow: true,
      source: '강타',
      poiseScale: weapon.poiseScale,
      // 🩸 강인도와 **반대 방향**의 배율 — arsenal.ts `bleedScale` 주석.
      bleedScale: weapon.bleedScale,
      hits: 1,
      healSelf: 0,
    }
  }
  // 처형 — 무방비인 적에게만 나가는 한 방.
  if (comboIndex === FINISH_COMBO) {
    const f = stepFor(weapon, FINISH_COMBO, 0, 0)
    return {
      shape: 'cone',
      damage: weaponHit(e, f.damage),
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
      source: '처형',
      poiseScale: weapon.poiseScale,
      // 🩸 강인도와 **반대 방향**의 배율 — arsenal.ts `bleedScale` 주석.
      bleedScale: weapon.bleedScale,
      hits: 1,
      healSelf: 0,
    }
  }
  /**
   * ⚔️ **여기가 이번 라운드에 실제로 빨갰던 자리입니다.**
   *
   * 예전 코드는 `weapon.combo[Math.min(comboIndex, 끝)]` 이었습니다.
   * 달리기(252)·구르기(253)·낙하(254)가 전부 **마지막 콤보 타**로
   * 접혔습니다 — 피해도 각도도 사거리도 강인도도 파고들기도 전부
   * 그 기술의 것이 아니었습니다. `Math.min` 은 아무 소리도 안 냅니다.
   *
   * 이제 `stepFor` 가 표식을 풉니다. 상황 모션은 `평타`와 나눠서
   * 세도록 이름도 따로 답니다(`상황`) — 안 그러면 다음에 페이즈별
   * 피해를 갈라 볼 때 셋이 평타 안에 숨습니다.
   */
  const situational =
    comboIndex === RUN_COMBO || comboIndex === ROLL_COMBO || comboIndex === PLUNGE_COMBO
  const c = stepFor(weapon, comboIndex, Player.focusSpent[e], Player.plungeSteps[e])
  return {
    shape: 'cone',
    source: situational ? '상황' : '평타',
    damage: weaponHit(e, c.damage),
    range: c.range,
    arcDeg: c.arcDeg,
    knockback: c.knockback,
    hitstop: c.hitstop,
    trauma: c.trauma,
    heavy: situational ? c.trauma >= weapon.combo[weapon.combo.length - 1].trauma : comboIndex === weapon.combo.length - 1,
    /**
     * 🌀 **콤보의 마지막 타인가** — 맞히면 기력을 일부 갚습니다
     * (balance.ts `COMBO_FINISH_REFUND`). `heavy` 와 따로 두는 이유:
     * `heavy` 는 상황 공격(달리기·구르기 공격)에도 붙는 **손맛** 표시이고,
     * 이것은 **콤보를 끝까지 이었는가**라는 다른 사실입니다. 한 칸에 두
     * 사건을 담으면 언젠가 한쪽이 다른 쪽을 조용히 바꿉니다.
     */
    comboFinisher: !situational && comboIndex === weapon.combo.length - 1,
    finisherCost: c.staminaCost,
    poiseScale: weapon.poiseScale,
    // 🩸 기본 콤보야말로 이 축의 주된 통로입니다 — 여기 빠뜨리면 무기별
    //    차이가 통째로 사라집니다(실제로 쌍단검이 배율 1.0으로 재졌습니다).
    bleedScale: weapon.bleedScale,
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
    // 룬 스킬(슬롯 3 이상)은 무기가 아니라 각인이라 무기 성장이 안 붙습니다.
    damage: weaponHit(e, def.damage, slot <= 2),
    range: def.range,
    arcDeg: def.arcDeg,
    knockback: def.knockback,
    hitstop: def.hitstop,
    trauma: def.trauma,
    heavy: def.damage >= 35,
    source: '스킬',
    // 무기 스킬(0~2)은 그 무기의 성격을 따릅니다. 룬(3~4)은 무기가 아니라 1배.
    poiseScale: slot <= 2 ? weaponOf(e).poiseScale : 1,
    // 무기 스킬은 그 무기의 출혈 성격도 따릅니다. 룬은 무기가 아니라 1배.
    bleedScale: slot <= 2 ? weaponOf(e).bleedScale : 1,
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
  breaks = 0,
): number {
  // 무기 성격(poiseScale)이 여기서 곱해집니다 — 대검은 무너뜨리고 단검은 못 합니다.
  const dmg = trauma * POISE.fromTrauma * multiplier * poiseScale
  /**
   * 💢 **무너질수록 단단해집니다** — 무거운 적만(balance.ts `breakResistStep`).
   *
   * 화면(강인도 바의 눈금)도 이 함수를 부르므로, 저항이 오르면 눈금도 같이
   * 물러납니다 — *"여기까지 깎으면 무너진다"* 가 계속 참말입니다.
   * 규칙을 여기 두는 이유가 그것입니다.
   */
  const heavy = enemyDef(kind).heavy === true
  const worn = heavy ? 1 + POISE.breakResistStep * Math.min(breaks, POISE.breakResistMax) : 1
  if (kind !== EnemyKind.Boss) return dmg / worn
  return dmg / worn / (BOSS_PHASES[Math.min(BOSS_PHASES.length - 1, phase)].poiseResist ?? 1)
}

/**
 * 🛡 **보스가 이번 구간에서 받는 피해 배율** (bossPhases.ts `damageTakenScale`).
 *
 * 강인도가 이미 똑같은 모양을 하고 있습니다 — 바로 위 `poiseDamage` 가
 * `poiseResist` 로 나눕니다. 체력 쪽에만 그 손잡이가 없었습니다.
 *
 * ⚠️ **함수로 뺀 이유가 전부입니다.** 처음에는 타격 처리 안쪽 한 줄에만
 *    곱해 놓고 "한 곳에서만 곱한다"고 주석까지 적었는데, 체력을 깎는 자리는
 *    거기 말고 **출혈이 터지는 자리**에도 있었습니다. 즉 적어 둔 다짐이
 *    그대로 거짓이었습니다. 규칙을 한 곳에 두려면 주석이 아니라 **부르는
 *    자리가 하나뿐인 함수**여야 합니다. (`bleedScale` 때 똑같이 당했습니다.)
 *
 * 낙하 피해(main.ts)는 일부러 뺐습니다. 그건 최대 체력의 퍼센트라
 * 애초에 화력과 무관하고, 보스방에는 떨어질 단차가 없습니다.
 */
export function bossTakenScale(t: number): number {
  if (Enemy.kind[t] !== EnemyKind.Boss) return 1
  return BOSS_PHASES[Math.min(BOSS_PHASES.length - 1, Enemy.phase[t])].damageTakenScale ?? 1
}

/** 🧪 실험대 전용 — 위 applyDamage 설계 노트 참고. 게임 코드는 켜지 않습니다. */
let debugPlayerInvulnerable = false
export function setPlayerInvulnerable(on: boolean): void {
  debugPlayerInvulnerable = on
}

/**
 * ── 💥 **적끼리의 오사 — 자리를 잡으면 적이 적을 무너뜨립니다** ──────────
 *
 * ── 이 게임에 없던 것 ──────────────────────────────────────────────
 * 여럿을 상대할 때 지금까지 할 수 있는 일은 *"순서를 고르는 것"* 하나뿐
 * 이었습니다. 어디에 서느냐는 백어택 말고는 아무 뜻도 없었습니다. 그래서
 * 잡몹 셋이든 다섯이든 **같은 싸움을 횟수만 늘려서** 했습니다.
 *
 * 참고한 게임들은 전부 여기에 답을 갖고 있습니다:
 *
 *   · 엘든 링·니오 — 적의 광역이 동료를 그대로 때립니다. 유인이 전술이 됩니다
 *   · 오공 — 적을 겹쳐 세우면 한 동작이 여럿을 흔듭니다
 *   · 위키드 — 좁은 길에서 서로 걸려 자세가 무너집니다
 *
 * 공통점은 **"어디에 서는가"가 값을 갖게 된다**는 것입니다.
 *
 * ── 그런데 피해는 **주지 않습니다** ────────────────────────────────
 * 엘든 링처럼 피해까지 주면, 이 게임에서는 최적해가 *"끌고 다니며 서로
 * 죽이게 두기"* 로 굳습니다. 그러면 이 게임의 기둥(예고를 읽고 답한다)을
 * **통째로 우회**하는 길이 하나 생깁니다. 재미를 늘리려다 이유를 없애는 셈입니다.
 *
 * 그래서 오사는 **강인도만** 깎습니다. 유인으로 적을 죽일 수는 없지만,
 * **무너뜨릴 수는 있습니다** — 그리고 무너진 적에게는 처형이 열립니다.
 * 즉 자리를 잡는 일이 *"싸움을 건너뛰는 길"* 이 아니라 *"더 좋은 한 방을
 * 여는 길"* 이 됩니다. (니오의 기력 붕괴, 오공의 자세 무너뜨리기가 같은 계약입니다.)
 *
 * ── 배수를 새로 만들지 않습니다 — 다만 **처음 고른 것은 틀렸습니다** ────
 * 처음엔 `POISE.windupMultiplier`(2.5)를 골랐습니다. *"자리를 만드는 것도
 * 예고를 읽는 것과 같은 급의 판단"* 이라는 그럴듯한 이유까지 적었습니다.
 * 그런데 **재 보니 한 번 스치면 그 자리에서 무너졌습니다**:
 *
 *     잡몹 0.34 × fromTrauma 40 × 2.5 = 34   vs   잡몹 강인도 **30**
 *
 * 그건 *"자리를 잡으면 무너뜨릴 수 있다"* 가 아니라 *"스치면 즉시
 * 무너진다"* 입니다. 잡몹 무리가 자기들끼리 스치기만 해도 줄줄이 무너지면,
 * 피해를 뺀 의미가 없어집니다 — 우회로를 막아 놓고 옆문을 연 셈입니다.
 *
 * `POISE.backMultiplier`(1.6)로 내렸습니다. 뜻이 더 정확하기도 합니다 —
 * 백어택 배수는 *"좋은 자리를 잡고 때렸다"* 이고, 오사는 *"좋은 자리를
 * 잡아 적이 적을 때리게 했다"* 입니다. 같은 것을 재는 값입니다.
 * 이제 잡몹은 **두 번** 스쳐야 무너집니다(21.8 × 2 > 30).
 */
function applyPoise(t: number, spec: AttackSpec, behind = false, crossfire = false): void {
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
  const multiplier = crossfire
    ? POISE.backMultiplier
    : spec.heavyBlow
      ? FOCUS.poiseMult
      : winding
        ? POISE.windupMultiplier
        : behind
          ? POISE.backMultiplier
          : POISE.basicMultiplier
  const dmg = poiseDamage(
    spec.trauma,
    spec.poiseScale ?? 1,
    multiplier,
    Enemy.kind[t],
    Enemy.phase[t],
    Enemy.breaks[t],
  )
  /**
   * 🔨 **깎은 쪽이 셉니다.**
   *
   * 프로브는 `enemyInfo().poise` 를 훑어서 *"줄어든 만큼"* 을 더하고
   * 있었습니다. 그런데 무너지는 순간 강인도가 **최대치로 되돌아가므로**,
   * 무너뜨린 그 마지막 한 방은 *증가*로 보여 **한 번도 안 세어집니다.**
   * 16초에 세 번 무너뜨리는 대검이 가장 많이 손해를 봤고, 그래서
   * 이론상 3.18배인 격차가 실측 **1.30배**로 눌려 있었습니다.
   *
   * 이 저장소가 스태미나에서 이미 똑같이 배웠습니다 — *"쓴 쪽이 세는
   * 것이 정확합니다."* 관측은 프레임 사이에 일어난 일을 못 봅니다.
   */
  /**
   * ⚠️ **오사는 이 장부에 안 넣습니다.** `poiseDealt` 는 *"플레이어가 깎은
   * 강인도"* 이고, 무기별 비교(`npm run weapons`)가 그 값으로 대검과 단검을
   * 가릅니다. 적이 깎은 것을 섞으면 **옆에 서 있던 무기가 잘한 것처럼**
   * 보입니다. 이 저장소가 `locked` 한 칸에 원인 셋을 담았다가 뜻이 뒤집힌
   * 것과 같은 모양입니다 — 다른 사건은 다른 칸에.
   */
  if (crossfire) crossfireHits++
  else poiseDealt += dmg

  Enemy.poiseIdleT[t] = 0
  Enemy.poise[t] -= dmg
  if (Enemy.poise[t] > 0) return

  breakPoise(t)
}

/**
 * 🩸 **출혈을 쌓고, 가득 차면 터뜨립니다.**
 *
 * ── 왜 강인도와 나란히 두는가 ──────────────────────────────────
 * 같은 타격에서 갈라져야 두 축이 **같은 사건을 다르게 읽는다**는 것이
 * 분명해집니다. 강인도는 `trauma`(한 방의 무게)로, 출혈은 **타수**로
 * 오릅니다 — 그래서 대검은 무너뜨리고 단검은 터뜨립니다.
 *
 * ⚠️ **예고 중 배수·백어택 배수를 여기엔 안 겁니다.** 강인도는 *"언제
 *    때렸는가"* 를 보상하고, 출혈은 *"얼마나 이어졌는가"* 를 보상합니다.
 *    둘 다 같은 배수를 받으면 축이 둘이 아니라 하나가 됩니다.
 *
 * ⚠️ 터진 피해는 **최대 체력의 비율**입니다. 고정값이면 잡몹에게만 세거나
 *    보스에게만 세집니다(balance.ts `BLEED.popDamagePct` 주석).
 */
function applyBleed(t: number, spec: AttackSpec): void {
  const w = spec.bleedScale ?? 1
  if (w <= 0) return
  const onBoss = Enemy.kind[t] === EnemyKind.Boss
  /**
   * 🩸 **때린 간격을 여기서 셉니다 — 0으로 지우기 직전에.**
   *
   * 보스에게 출혈이 96/100 까지 찼는데 한 번도 안 터졌습니다. 원인 후보가
   * 넷인데(한 대당 12가 작다 · 유예 2.5초가 짧다 · 식는 속도 20/초가
   * 빠르다 · 봇이 안 때린다) **숫자 없이는 어느 것도 못 고릅니다.**
   * 값부터 만지면 "고쳤다고 믿는 것"만 남습니다.
   *
   * `bleedIdleT` 는 *"마지막 출혈 타격 이후 흐른 시간"* 이고, 바로 아래
   * 줄에서 0이 됩니다. 그러니 지우기 **직전 값**이 곧 이번 타격의 간격
   * 입니다 — 따로 시계를 둘 필요가 없습니다. 관측하는 쪽이 프레임 사이를
   * 놓치는 문제도 없습니다(**쌓는 쪽이 셉니다**).
   */
  if (onBoss && bossEverBled) {
    const gap = Enemy.bleedIdleT[t]
    bossGapSum += gap
    bossGapCount++
    if (gap > bossGapMax) bossGapMax = gap
    // 유예 안에 들어온 타격만이 **쌓입니다** — 그 밖은 식은 뒤에 다시 시작한 것.
    if (gap <= BLEED.decayDelay) bossGapInside++
  }
  Enemy.bleedIdleT[t] = 0
  Enemy.bleed[t] += BLEED.perHit * w
  // 🩸 쌓은 총량은 따로 셉니다 — 식어서 날아간 몫을 나중에 되돌려 볼 수 있게.
  Enemy.bleedBuilt[t] += BLEED.perHit * w
  if (onBoss) {
    bossBleedApplied += BLEED.perHit * w
    bossEverBled = true
  }
  if (Enemy.bleed[t] > bleedPeak) bleedPeak = Enemy.bleed[t]
  if (onBoss && Enemy.bleed[t] > bossBleedPeak) bossBleedPeak = Enemy.bleed[t]
  // 🩸 문턱은 적마다 다릅니다 — 근거는 enemies.ts `bleedMaxOf`.
  if (Enemy.bleed[t] < bleedMaxOf(Enemy.kind[t])) return

  if (onBoss) bossBleedPops++
  Enemy.bleed[t] = 0
  // ⚠️ 상한이 없으면 체력이 큰 상대가 출혈 하나로 삭제됩니다(balance.ts 주석).
  const dmg =
    Math.min(Health.max[t] * BLEED.popDamagePct, BLEED.popDamageCap) * bossTakenScale(t)
  Health.hp[t] = Math.max(0, Health.hp[t] - dmg)
  if (onBoss) noteBossDamage('출혈', Enemy.phase[t], dmg)
  bleedEvents.push({ entity: t, x: Transform.x[t], y: Transform.y[t], z: Transform.z[t] })
  /**
   * 터질 때 강인도도 조금 깎습니다. 작게 두는 이유: 무너뜨리기는 강인도의
   * 몫이고, 여기서 크게 주면 두 축이 같은 결과로 수렴합니다.
   */
  Enemy.poiseIdleT[t] = 0
  Enemy.poise[t] -= poiseDamage(BLEED.popPoise, 1, 1, Enemy.kind[t], Enemy.phase[t], Enemy.breaks[t])
  if (Enemy.poise[t] <= 0) breakPoise(t)
}

/**
 * 🧪 **실험대 전용 — 게임과 같은 경로로** 출혈을 한 대분 얹습니다.
 *
 * 프로브가 `Enemy.bleed` 를 직접 더하면 문턱 판정도, 터짐도, 강인도
 * 연동도 통째로 건너뜁니다 — 그러면 *"쌓인다"* 만 확인하고 정작 묻고
 * 싶은 *"터진다"* 는 못 봅니다. 이 저장소가 상점 구매를 잴 때 배운 것과
 * 같은 규약입니다: **창의 버튼과 같은 함수를 부릅니다.**
 *
 * @returns 이 타격으로 **터졌는가**. (터지면 게이지가 0으로 돌아가므로,
 *          쌓은 만큼 안 올랐다는 것이 곧 터졌다는 뜻입니다.)
 */
export function debugApplyBleed(t: number, bleedScale: number): boolean {
  const before = Enemy.bleed[t]
  applyBleed(t, { bleedScale } as AttackSpec)
  return Enemy.bleed[t] < before + BLEED.perHit * bleedScale - 0.001
}

/**
 * 🥋 집중의 출처별 누적 · 흘린 양 · 태운 양.
 *
 * 설계 노트는 *"집중을 쌓는 것은 가벼운 공격"* 이라고 적어 뒀는데,
 * 벤치에서 평타가 보스 피해 중앙값 0으로 나왔습니다. 안 누르는 버튼이
 * 자원을 벌 수는 없으니, 그 문장이 참인지 여기서 잽니다.
 */
export const focusGain = { 평타: 0, 완벽회피: 0 }
let focusWasted = 0
let focusBurned = 0
/** 완벽 회피 쪽은 main.ts 가, 태우는 쪽은 playerControl 이 넣습니다 — 쓰는 쪽이 셉니다. */
export function noteFocusDodge(gained: number, wasted: number): void {
  focusGain.완벽회피 += gained
  focusWasted += wasted
}
export function noteFocusBurn(points: number): void {
  focusBurned += points
}
export function readFocusFlow(): { 평타: number; 완벽회피: number; 버림: number; 태움: number } {
  return {
    평타: Number(focusGain.평타.toFixed(2)),
    완벽회피: Number(focusGain.완벽회피.toFixed(2)),
    버림: Number(focusWasted.toFixed(2)),
    태움: Number(focusBurned.toFixed(2)),
  }
}
export function resetFocusFlow(): void {
  focusGain.평타 = 0
  focusGain.완벽회피 = 0
  focusWasted = 0
  focusBurned = 0
}

/**
 * 🔨 **실제로 깎은 강인도의 누적**(무기 프로브가 읽습니다).
 * 관측이 아니라 **깎은 쪽**이 셉니다 — 위 `applyPoise` 주석 참고.
 */
let poiseDealt = 0
export function readPoiseDealt(): number {
  return poiseDealt
}
export function resetPoiseDealt(): void {
  poiseDealt = 0
  crossfireHits = 0
}

/**
 * 💥 **적이 적을 스친 횟수.**
 *
 * 눈금이 없으면 이 규칙은 **있는지 없는지도 모르는 규칙**이 됩니다. 이
 * 저장소에는 이미 그런 것이 하나 있었습니다 — 화살이 동료 몸에 막히는
 * 규칙(`blocker`)은 오래전부터 있었는데, 실제로 한 판에 몇 번 일어나는지
 * 아무도 안 셌습니다. 규칙을 넣을 때 세는 칸을 같이 넣습니다.
 */
let crossfireHits = 0
export function readCrossfireHits(): number {
  return crossfireHits
}

/** 🩸 출혈이 터진 순간 — 게임 루프가 읽고 비웁니다(연출은 시스템 밖에서). */
export const bleedEvents: BreakEvent[] = []

/**
 * 🩸 **한 적에게 쌓였던 최고치.**
 *
 * `터짐 0회` 만으로는 *"5까지밖에 안 찼다"* 와 *"99까지 찼는데 식었다"* 를
 * **똑같이** 말합니다 — 처방이 정반대인데요(전자면 이 축은 잡몹에게 원래
 * 안 도는 것이고, 후자면 식는 값이 틀린 것입니다).
 *
 * ⚠️ **때린 직후에만 셉니다.** 출혈은 타격으로만 오르고 그 사이에는 식기만
 *    하므로, 최고치는 언제나 증가 직후입니다. 매 프레임 살아 있는 적을
 *    훑을 이유가 없습니다.
 */
let bleedPeak = 0
/**
 * 🩸 **보스에게만** 따로 셉니다.
 *
 * 소울류의 출혈은 잡몹에게는 원래 안 돕니다 — 두세 대에 죽으니까요.
 * 값은 **오래 버티는 상대**에게서 나옵니다(그래서 피해가 비율입니다).
 * 그러니 이 축이 사는지 죽는지를 가르는 자리는 존 전체가 아니라
 * **보스전 하나**입니다. 존 합계로 보면 잡몹의 0이 보스의 값을 덮습니다.
 *
 * 이걸 안 나눠 놓으면 다음 라운드가 또 *"얇으니 올리자"* 가 되고, 그러면
 * 잡몹까지 같이 세져서 앞 라운드에 되살린 난이도가 도로 무너집니다.
 */
let bossBleedPeak = 0
let bossBleedPops = 0
/**
 * 🩸 **보스 출혈이 어디서 새는가** — 네 후보를 가르는 최소한의 숫자들.
 *
 * `applied` 는 쌓은 총량, `decayed` 는 식어서 날아간 총량입니다. 둘의
 * 차이가 곧 *"지금 남아 있는 것 + 터진 것"* 이므로, `applied` 가 100을
 * 훨씬 넘는데 터짐이 0이면 **범인은 식는 쪽**입니다. `applied` 자체가
 * 작으면 범인은 **타수**이고, 그건 값이 아니라 봇·전투 흐름 문제입니다.
 */
let bossBleedApplied = 0
let bossBleedDecayed = 0
/**
 * ⚠️ **간격을 재는 문을 여기에 둡니다** — 게이지가 아니라 *"한 번이라도
 * 출혈을 준 적이 있는가"* 로.
 *
 * 처음엔 문이 `Enemy.bleed[t] > 0` 이었습니다. 첫 타격은 잴 이전 간격이
 * 없으니 빼려던 것인데, **게이지가 0까지 다 식은 뒤의 타격도 같이
 * 빠졌습니다.** 즉 *"오래 못 때려서 다 날아간"* 경우 — 바로 제가 찾던
 * 그 경우 — 만 골라서 통계에서 제외하고 있었습니다. 그래서 평균 1.24초·
 * 최대 2.88초 라는 **살아남은 것들만의 분포**가 나왔습니다.
 *
 * 재려는 것을 빼고 재면, 숫자는 늘 "문제 없음"이라고 말합니다.
 */
let bossEverBled = false
/**
 * 📊 보스가 받은 피해를 **출처 × 페이즈**로. 합계가 보스 최대 체력과
 * 얼추 같아야 정상입니다(회복이 없으므로). 크게 모자라면 세지 못한
 * 경로가 있다는 뜻이고, 그것 자체가 다음에 봐야 할 자리입니다.
 */
/**
 * 📊 **잡몹을 죽인 것** — 출처별 피해와, 그 출처가 마지막 한 방이었던 횟수.
 *
 * ── 왜 (이 저장소가 스스로에게 남긴 질문) ──────────────────────────
 * 출혈이 잡몹에게 한 번도 안 터집니다. 문턱을 100 → 30 으로 내려 봤다가
 * **되돌렸습니다** — 단검이 두 대 만에 터뜨려 세 창의 1등을 전부 가져가고,
 * *"무기를 바꿀 이유"* 검사가 빨개졌기 때문입니다(enemies.ts `bleedMaxOf`
 * 주석). 그때 적어 둔 다음 질문이 이것입니다:
 *
 *   > 문턱이 높은 것이 아니라 **쌓이는 타수가 적습니다** — 잡몹이 기본기
 *   > 두 대 값어치만 받고 스킬·처형으로 죽습니다. 문턱을 내리는 대신
 *   > **"왜 두 대뿐인가"** 를 먼저 재야 합니다.
 *
 * 그 질문에 답하려면 *"무엇이 잡몹을 죽이는가"* 를 알아야 하는데, 보스
 * 쪽에만 장부가 있었습니다. 잡몹은 **한 번도 안 세어 봤습니다.**
 *
 * ⚠️ 피해 총량과 **마지막 한 방**을 따로 셉니다. 둘은 다른 사실입니다 —
 *    평타가 총량의 절반을 넣고도 처형이 늘 마무리하면, 출혈이 찰 시간은
 *    없습니다. 한 칸에 담으면 그 구분이 사라집니다.
 */
const mobDamageBySource: Record<string, { dmg: number; kills: number }> = {}
function noteMobDamage(kind: string, dmg: number, killed: boolean): void {
  const row = (mobDamageBySource[kind] ??= { dmg: 0, kills: 0 })
  row.dmg += dmg
  if (killed) row.kills += 1
}
export function readMobDamageBySource(): Record<string, { dmg: number; kills: number }> {
  return mobDamageBySource
}

const bossDamageBySource: Record<string, [number, number, number]> = {
  평타: [0, 0, 0],
  상황: [0, 0, 0],
  강타: [0, 0, 0],
  처형: [0, 0, 0],
  스킬: [0, 0, 0],
  출혈: [0, 0, 0],
}
/** 출혈 터짐은 위 경로를 안 지납니다 — 터뜨리는 쪽에서 직접 넣습니다. */
function noteBossDamage(kind: string, phase: number, dmg: number): void {
  const row = bossDamageBySource[kind]
  if (row) row[Math.min(2, Math.max(0, phase))] += dmg
}
export function readBossDamageBySource(): Record<string, [number, number, number]> {
  return bossDamageBySource
}
let bossGapSum = 0
let bossGapCount = 0
let bossGapInside = 0
let bossGapMax = 0
export function noteBleedDecay(t: number, lost: number): void {
  if (Enemy.kind[t] === EnemyKind.Boss) bossBleedDecayed += lost
  bleedDecayedAll += lost
}
/**
 * ⏸ **때릴 수 없어서 유예를 안 먹은 시간**(초). 규칙은 enemyAI 의 식는
 * 블록에 한 번만 적혀 있고, 여기서는 **얼마나 그랬는지**만 셉니다.
 *
 * 왜 세는가: 이 규칙은 값을 *깎지 않는 것*이라 장부에 흔적이 안 남습니다.
 * 안 남으면 다음 사람이 *"이거 실제로 일어나긴 하나?"* 를 물었을 때
 * 코드를 읽고 상상해야 합니다 — 이 저장소가 여러 번 그래서 틀렸습니다.
 * 초로 적어 두면 `× 식는 속도` 로 **살려 낸 몫**이 바로 나옵니다.
 */
export function noteBleedBlocked(t: number, seconds: number): void {
  if (Enemy.kind[t] === EnemyKind.Boss) bossBleedBlocked += seconds
  bleedBlockedAll += seconds
}
let bossBleedBlocked = 0
let bleedBlockedAll = 0

/**
 * ── 🩸 **「0회」가 왜 0회인지 말하게 만듭니다** ──────────────────────────
 *
 * 출혈이 한 판에 **한 번도 안 터진** 상태가 오래 이어졌습니다. 그런데
 * 장부에는 `터짐 0회 · 최고 96/100` 밖에 없어서, 원인이 **둘 중 어느
 * 쪽인지 알 수 없었습니다**:
 *
 *   · **죽어서** — 게이지가 차기 전에 적이 먼저 쓰러진다 (잡몹 쪽 의심)
 *   · **식어서** — 차는 속도보다 식는 속도가 이긴다 (보스 쪽 의심)
 *
 * 처방이 정반대입니다. 앞이면 **문턱**이나 **한 대당 축적**의 이야기이고,
 * 뒤면 **식는 속도**나 **유예**의 이야기입니다. 이 저장소는 `locked` 한 칸에
 * 원인 셋을 담았다가 뜻이 뒤집힌 적이 있습니다 — 0 도 한 칸이면 같은 함정입니다.
 *
 * 그래서 **죽는 순간 게이지에 남아 있던 몫**을 셉니다. 관측이 아니라
 * 사건이 일어난 자리에서 셉니다 — 프레임 사이에 죽으면 관측은 못 봅니다.
 */
export function noteDeathWithBleed(t: number): void {
  const left = Enemy.bleed[t]
  if (left <= 0) return
  diedWithBleedCount++
  diedWithBleedSum += left
  if (left > diedWithBleedMax) diedWithBleedMax = left
  // 이 적에게 **쌓은 총량**도 같이 — 둘의 차이가 「식어서 날아간 몫」입니다.
  diedBuiltSum += Enemy.bleedBuilt[t]
  diedHitsSum += Enemy.hitsTaken[t]
}
let diedBuiltSum = 0
let diedHitsSum = 0
let bleedDecayedAll = 0
let diedWithBleedCount = 0
let diedWithBleedSum = 0
let diedWithBleedMax = 0
export function readBleedPeak(): {
  any: number
  boss: number
  bossPops: number
  bossApplied: number
  bossDecayed: number
  bossGapAvg: number
  bossGapMax: number
  /** 유예(2.5초) 안에 이어진 타격의 비율 — 1에 가까울수록 압박이 안 끊긴 것 */
  bossGapInsideRate: number
  /** ⏸ 보스가 **때릴 수 없는 상태**여서 유예를 안 먹은 시간(초) */
  bossBlocked: number
  /** ⏸ 같은 것, 적 전부 합쳐서 */
  blockedAll: number
  decayedAll: number
  diedWith: number
  diedWithAvg: number
  diedWithMax: number
  diedBuiltAvg: number
  diedHitsAvg: number
} {
  return {
    any: bleedPeak,
    /** 🩸 식어서 날아간 총량(보스 말고 전부 포함) */
    decayedAll: bleedDecayedAll,
    /** 🩸 **게이지를 남긴 채 죽은 적**의 수 — 「죽어서 못 터짐」의 크기 */
    diedWith: diedWithBleedCount,
    /** 🩸 그 적들이 남기고 간 게이지의 평균과 최고 */
    diedWithAvg: diedWithBleedCount > 0 ? diedWithBleedSum / diedWithBleedCount : 0,
    diedWithMax: diedWithBleedMax,
    /** 🩸 그 적들에게 **쌓았던** 총량의 평균 — 남은 것과 견주면 식은 몫이 나옵니다. */
    diedBuiltAvg: diedWithBleedCount > 0 ? diedBuiltSum / diedWithBleedCount : 0,
    /** 🩸 그 적들이 **죽기까지 맞은 횟수**의 평균 — 쌓은 총량의 분모. */
    diedHitsAvg: diedWithBleedCount > 0 ? diedHitsSum / diedWithBleedCount : 0,
    boss: bossBleedPeak,
    bossPops: bossBleedPops,
    bossApplied: bossBleedApplied,
    bossDecayed: bossBleedDecayed,
    bossGapAvg: bossGapCount > 0 ? bossGapSum / bossGapCount : 0,
    bossGapMax: bossGapMax,
    bossGapInsideRate: bossGapCount > 0 ? bossGapInside / bossGapCount : 0,
    bossBlocked: bossBleedBlocked,
    blockedAll: bleedBlockedAll,
  }
}
export function resetBleedPeak(): void {
  bleedDecayedAll = 0
  diedWithBleedCount = 0
  diedWithBleedSum = 0
  diedWithBleedMax = 0
  diedBuiltSum = 0
  diedHitsSum = 0
  bleedPeak = 0
  bossBleedPeak = 0
  bossBleedPops = 0
  bossBleedApplied = 0
  bossBleedDecayed = 0
  bossGapSum = 0
  bossGapCount = 0
  bossGapInside = 0
  bossGapMax = 0
  bossBleedBlocked = 0
  bleedBlockedAll = 0
  bossEverBled = false
  for (const k of Object.keys(bossDamageBySource)) bossDamageBySource[k] = [0, 0, 0]
  for (const k of Object.keys(mobDamageBySource)) delete mobDamageBySource[k]
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
   * 💢 **몇 번째 붕괴인지 셉니다** — 다음 붕괴를 어렵게 만드는 근거입니다
   * (balance.ts `POISE.breakResistStep`). 세는 자리를 여기 두는 이유는
   * 하나입니다: 붕괴는 여러 경로(평타 누적 · 강타 · 출혈 폭발 · 반격)로
   * 들어오는데, **이 함수만은 전부가 지나갑니다.**
   */
  Enemy.breaks[t] += 1
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
  /**
   * ── 🛡 **읽기가 맞았는데 답할 것이 사라진 경우** ────────────────────
   *
   * 예고를 보고 가드를 열어 뒀는데, 그 예고를 **내가 무너뜨려서** 끊어
   * 버리면 창은 아무것도 못 만나고 닫힙니다. 그리고 지금까지는 그것도
   * *"헛친 것"* 으로 벌했습니다 — 잠김 0.35초 + 기력 18.
   *
   * 자동 플레이가 이 모양을 그대로 찍었습니다: **창을 연 것 19회 ·
   * 헛친 것 19회 · 성공 0회.** 그런데 `npm run parry` 의 ⑥ 은 봇의
   * **같은 규칙**으로 1:1 에서 2/3 을 막습니다. 창도 규칙도 멀쩡하니,
   * 남는 것은 *"여럿이 붙은 실전에서 예고가 자꾸 끊긴다"* 입니다.
   *
   * 여기가 그 끊는 자리이므로, 여기서 표시합니다. 판단을 나중에 다시
   * 하려면 *"이 창이 왜 비었는가"* 를 복원해야 하는데, 그건 이미 지나간
   * 정보입니다 — **사건은 사건이 일어난 자리에서 기록합니다**(바로 위
   * `duringWindup` 이 같은 이유로 여기 있습니다).
   *
   * ⚠️ 🔴 만 표시합니다. 다른 색은 애초에 못 막으므로 그 예고가 끊긴 것은
   *    가드와 아무 상관이 없고, 표시하면 **진짜 헛침이 공짜가 됩니다.**
   */
  if (duringWindup && attackAt(Enemy.kind[t], Enemy.attackIndex[t]).intent === AttackIntent.Strike) {
    const ps = players.run()
    for (let i = 0; i < players.count; i++) {
      const p = ps[i]
      if (Player.guardT[p] > 0) Player.guardSpared[p] = 1
    }
  }
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

/**
 * 💥 적이 적을 스친 순간. 무너짐과 따로 알립니다 — 스쳤다고 늘 무너지는
 * 것은 아니고, 플레이어는 **쌓이는 중**인 것도 봐야 자리를 잡을 이유가 생깁니다.
 */
export const crossfireEvents: BreakEvent[] = []

/** 🥋 완벽 회피 — 실제로 맞을 공격을 무적 프레임으로 넘긴 순간. */
export const perfectDodgeEvents: BreakEvent[] = []
/**
 * 🛡 저스트 가드가 성립한 순간들. **막은 적**의 자리를 담습니다
 * (완벽 회피는 *구른 나*의 자리를 담습니다 — 연출이 향하는 곳이 다릅니다:
 * 회피는 "내가 잘 피했다", 가드는 **"저 녀석이 튕겨 나갔다"** 입니다).
 */
export const justGuardEvents: BreakEvent[] = []

/** 💥 통에 불이 붙은 순간. 소리와 연출이 읽습니다. */
export const barrelLitEvents: BreakEvent[] = []
/** 💥 통이 터진 순간. `radius` 는 **실제로 쓴 반경** 입니다(그림이 규칙을 베끼지 않게). */
export const barrelBlastEvents: (BreakEvent & {
  radius: number
  /** 터질 때 담긴 몸 수(적 + 나) */
  caught: number
  /** **불붙일 때** 반경 안에 있던 적의 수 — 둘의 차이가 「걸어 나간 수」입니다. */
  litCaught: number
})[] = []

const barrels = defineQuery(Barrel, Transform, Health)
/** 🛡 예고를 끊은 자리에서 플레이어의 가드 창을 봐야 합니다(`breakPoise`). */
const players = defineQuery(Player, Stamina)

/**
 * ── 💥 **도화선을 굴리고, 다 타면 터뜨립니다** ──────────────────────
 *
 * 설계 근거는 balance.ts `BARREL` 에 길게 적어 두었습니다. 요약:
 * **피해는 없고 자세만 무너집니다** — 적은 강인도로, 플레이어는
 * 스태미나로. 오사가 *"유인이 싸움을 대신하면 안 된다"* 로 피해를 뺀 것과
 * 같은 이유이고, 여기서 피해를 주면 "통 옆으로 끌고 가기"가 전투의
 * 정답이 됩니다.
 *
 * ⚠️ 적을 **죽이지 않는** 것에는 실무적인 이유도 하나 더 있습니다.
 *    처치는 불티·처치 수·세이브·출혈 장부를 함께 건드리는데, 그 경로는
 *    `applyHit` 본문에 있습니다. 폭발이 죽일 수 있게 하려면 그 경로를
 *    두 번째로 구현해야 하고, 두 벌이 된 순간 한쪽만 고치는 날이 옵니다.
 *    지금 규칙은 그 위험 자체를 없앱니다.
 */
export function barrelSystem(dt: number): void {
  const ids = barrels.run()
  const count = barrels.count
  // ⚠️ 터진 통을 이 루프 안에서 지우면 질의 배열이 밑에서 바뀝니다.
  //    터질 것을 모아 두고 루프가 끝난 뒤 처리합니다.
  const blown: number[] = []
  for (let i = 0; i < count; i++) {
    const b = ids[i]
    /**
     * ① **점화** — 체력이 0이 된 통에 불이 붙습니다. 이 저장소에서 통에
     *    불을 붙이는 자리는 **여기 하나뿐**입니다(근거는 `applyHit` 의
     *    통 가지 주석).
     *
     * ⚠️ `lit` 을 안 보면 터진 통이 매 프레임 다시 불붙습니다 — 조건이
     *    「체력 ≤ 0」 이라 터진 뒤에도 영원히 참이기 때문입니다.
     * ⚠️ 붙인 프레임에는 `continue` 로 **안 태웁니다.** 붙는 것과 타는
     *    것이 같은 프레임에 일어나면, 긴 프레임에서 도화선이 규칙보다
     *    짧아집니다.
     */
    if (Health.hp[b] <= 0 && Barrel.lit[b] === 0) {
      Barrel.lit[b] = 1
      Barrel.fuseT[b] = barrelFuse()
      Barrel.fuseTotal[b] = Barrel.fuseT[b]
      Barrel.litCaught[b] = Math.min(255, countInBlast(Transform.x[b], Transform.z[b]))
      barrelLitEvents.push({
        entity: b,
        x: Transform.x[b],
        y: Transform.y[b] + BARREL.height * 0.5,
        z: Transform.z[b],
      })
      continue
    }
    // ② **연소**
    if (Barrel.fuseT[b] <= 0) continue
    Barrel.fuseT[b] -= dt
    if (Barrel.fuseT[b] <= 0) blown.push(b)
  }
  for (const b of blown) explodeBarrel(b)
}

/** 💥 이 자리에서 지금 터지면 몇 **마리**가 담기는가 (플레이어·통은 뺍니다). */
function countInBlast(bx: number, bz: number): number {
  const tids = targets.run()
  let n = 0
  for (let j = 0; j < targets.count; j++) {
    const t = tids[j]
    if (!hasComponent(Enemy, t)) continue
    if (Actor.state[t] === ActorState.Dead) continue
    if (Math.hypot(Transform.x[t] - bx, Transform.z[t] - bz) > BARREL.blast + Body.radius[t]) continue
    n++
  }
  return n
}

function explodeBarrel(b: number): void {
  const bx = Transform.x[b]
  const bz = Transform.z[b]
  const by = Transform.y[b]
  // 두 번 터지지 않게 먼저 끕니다 — 연쇄가 이 통을 다시 집을 수 있습니다.
  Barrel.fuseT[b] = 0
  Barrel.fuseTotal[b] = 0
  Health.hp[b] = 0

  const tids = targets.run()
  const tcount = targets.count
  let caught = 0
  for (let j = 0; j < tcount; j++) {
    const t = tids[j]
    if (t === b) continue
    const dx = Transform.x[t] - bx
    const dz = Transform.z[t] - bz
    /**
     * 📏 대상의 **굵기를 더합니다** — 타격 판정(`shapeDist`)과 같은 규칙
     * 입니다. 폭발만 중심으로 재면 "그린 원에 몸이 걸쳤는데 안 맞았다"가
     * 생기고, 그건 이 저장소가 이미 한 번 고친 종류의 어긋남입니다.
     */
    if (Math.hypot(dx, dz) > BARREL.blast + Body.radius[t]) continue

    /**
     * 💥 **연쇄** — 반경 안의 다른 통에도 불이 붙습니다.
     *
     * 붙는 것은 **불**이지 폭발이 아닙니다(도화선을 처음부터 굴립니다).
     * 즉 연쇄는 즉발이 아니라 **한 박자 뒤**에 옵니다 — 플레이어에게도
     * 적에게도 다시 한 번 *"걸어서 이탈"* 할 시간이 주어집니다.
     * 이미 불붙은 통은 건드리지 않으므로 무한 연쇄가 생길 수 없습니다.
     */
    if (hasComponent(Barrel, t)) {
      // 옆 통은 **체력만 깎습니다.** 불은 다음 프레임에 `barrelSystem` 이
      // 붙입니다 — 점화 경로가 하나여야 연쇄도 규칙대로 한 박자 뒤에 옵니다.
      if (Health.hp[t] > 0) Health.hp[t] = 0
      continue
    }

    if (Actor.state[t] === ActorState.Dead) continue

    if (hasComponent(Player, t)) {
      /**
       * 🫁 휘말린 플레이어는 **스태미나를 잃습니다**(구르기 2회분).
       * 피해가 아닌 이유는 balance.ts `BARREL` 주석에 있습니다.
       * 회복 지연도 같이 겁니다 — 안 그러면 잃자마자 도로 차오릅니다.
       */
      Stamina.value[t] = Math.max(0, Stamina.value[t] - barrelStaminaLoss())
      Stamina.regenDelayT[t] = Math.max(Stamina.regenDelayT[t], PLAYER.staminaRegenDelay)
      const len = Math.hypot(dx, dz) || 1
      Velocity.kx[t] = (dx / len) * BARREL.knockback
      Velocity.kz[t] = (dz / len) * BARREL.knockback
      caught++
      continue
    }

    /**
     * 무너뜨립니다. `breakPoise` 를 그대로 부르는 이유: 무방비 시간·
     * 넉백 취소·붕괴 사건 기록이 전부 거기 한 곳에 있습니다. 여기서
     * 흉내 내면 처형 창의 규칙이 두 벌이 됩니다.
     */
    if (hasComponent(Enemy, t)) {
      breakPoise(t)
      Health.flashT[t] = hurtFlash(BARREL.hitstop)
      caught++
    }
  }

  barrelBlastEvents.push({
    entity: b,
    x: bx,
    y: by + BARREL.height * 0.5,
    z: bz,
    radius: BARREL.blast,
    caught,
    litCaught: Barrel.litCaught[b],
  })
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
   * ── 📒 **빗나간 이유를 여기서 적습니다** ────────────────────────────
   *
   * 적의 근접 부채꼴 한 번마다 한 줄. **사건이 일어난 자리에서** 적습니다 —
   * 바깥에서 각도를 다시 재면 판정의 사본이 생기고, 한쪽만 고치는 날
   * 장부가 게임이 아닌 것을 재게 됩니다(위 `swingRecords` 주석).
   *
   * 판정 자체는 아래 루프가 그대로 내립니다. 여기서 하는 일은 **같은
   * `shapeDist`** 를 플레이어에게 한 번 더 물어 보고, 사람이 읽을 숫자를
   * 곁들여 적는 것뿐입니다.
   */
  if (!attackerIsPlayer && spec.shape === 'cone' && !spec.projectile) {
    const pids = players.run()
    if (players.count > 0) {
      const t = pids[0]
      // 이름은 게임에게 묻습니다 — 아래 hitEvents 와 **같은 줄**입니다.
      const id = attackAt(Enemy.kind[a], Enemy.attackIndex[a]).id
      const dx = Transform.x[t] - originX
      const dz = Transform.z[t] - originZ
      const dist = Math.hypot(dx, dz)
      const dot = dist > 0.0001 ? (dx * fx + dz * fz) / dist : 1
      const slack = Math.atan2(Body.radius[t], Math.max(dist, 0.0001))
      // 이 한 줄만이 "맞았는가"의 답입니다 — 나머지는 설명입니다.
      const inShape = shapeDist(t) >= 0

      /**
       * 같은 휘두름인가 — **연속한 프레임의 같은 공격**이면 같은 것입니다.
       * 한 프레임이라도 건너뛰면 그건 다음 휘두름입니다(머무는 판정은
       * active 동안 매 프레임 불립니다).
       */
      const open = openSwings.get(a)
      if (open && (open.rec.attackId !== id || time.frame - open.frame > 1)) closeSwing(a)
      let cur = openSwings.get(a)
      if (!cur) {
        cur = {
          rec: { attackId: id, hit: false, dist, angleDeg: 0, halfArcDeg: 0, reach: 0, invuln: false },
          minDist: Infinity,
          frame: time.frame,
        }
        openSwings.set(a, cur)
      }
      cur.frame = time.frame
      /**
       * ── 🛡 **적이 스스로 빗나갔으면, 읽은 사람을 벌하지 않습니다** ──────
       *
       * 위 `breakPoise` 에 같은 규칙이 이미 적혀 있습니다 — *"벌은 틀린 때
       * 눌렀을 때 붙는 것이지, 맞게 눌렀는데 상대가 사라졌을 때 붙는 것이
       * 아니다."* 그런데 그 면제는 **원인 하나**(내가 무너뜨려 예고가 끊김)
       * 에만 걸려 있었습니다. 원인은 둘입니다.
       *
       * ── 자동 플레이가 두 번째 원인을 찍어 줬습니다 ────────────────────
       *     🛡 창을 연 것 6회 · **헛친 것 3회**
       *        빈 창이 닫힌 이유 — 판정지나감 3회
       *          (누를때 남은예고 0.167초 · 거리 2.8→3.2m)
       *          (누를때 남은예고 0.180초 · 거리 1.4→2.0m)
       *          (누를때 남은예고 0.147초 · 거리 1.7→**1.5m**)
       *
       * 창은 0.18초인데 0.147초 남았을 때 눌러도 헛쳤습니다. 처음엔 창이
       * 광고보다 짧은 줄 알고 `npm run parry` 에 **창을 훑는 검사**를 새로
       * 만들었는데, 실측 0.17/0.18초(93%)로 **창은 멀쩡했습니다.** 세 번째
       * 줄이 답이었습니다 — 거리가 **가까워졌는데도** 안 맞았습니다. 즉
       * 멀어져서가 아니라 **적이 각도로 빗나간** 것입니다(같은 판의 빗나감
       * 장부: grunt_jab 4회 중 각도 2회).
       *
       * 읽기는 맞았고 답할 것이 안 왔을 뿐인데 벌은 그대로였습니다 —
       * 잠김 0.35초 + 기력 18. **잘한 일에 벌을 받는 것**이고, 초보자가 이
       * 기술을 영영 안 쓰게 되는 종류의 경험입니다. 세키로·Lies of P 에서
       * 쳐내기를 냈는데 적의 공격이 빗나가면 아무 일도 안 일어납니다.
       *
       * ⚠️ **매 판정 프레임에 봅니다.** 처음엔 판정 첫 프레임에서만 봤는데,
       *    같은 실험대가 판마다 초록/빨강을 오갔습니다(자취는 프레임 단위로
       *    똑같았는데도). 첫 프레임은 `openSwings` 에 앞선 휘두름이 남아
       *    있었는지에 따라 잡히기도 하고 안 잡히기도 하는 **불안정한 자리**
       *    였습니다. 지켜야 하는 규칙은 *"이 창이 열려 있는 동안 나를 안
       *    맞힌 🔴 판정이 지나갔다"* 이고, 그건 매 프레임 보면 됩니다.
       *
       * ⚠️ 🔴 만 면제합니다 — 다른 색은 애초에 가드로 못 막으므로, 그 예고에
       *    누른 것은 **진짜 틀린 읽기**입니다(위 breakPoise 와 같은 이유).
       */
      if (
        !inShape &&
        Player.guardT[t] > 0 &&
        attackAt(Enemy.kind[a], Enemy.attackIndex[a]).intent === AttackIntent.Strike
      ) {
        Player.guardSpared[t] = 1
      }
      if (inShape && Health.invulnT[t] <= 0) cur.rec.hit = true
      // 무적은 **판정 도형 안에 있었을 때만** 셉니다 — 밖에서 구른 것은
      // "무적으로 넘겼다"가 아니라 그냥 안 맞은 것입니다.
      if (inShape && Health.invulnT[t] > 0) cur.rec.invuln = true
      // 가장 가까웠던 순간을 남깁니다 — "사거리 밖"이 *내내 안 닿았다*를 뜻하게.
      if (dist < cur.minDist) {
        cur.minDist = dist
        cur.rec.dist = dist
        cur.rec.angleDeg = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI
        cur.rec.halfArcDeg = (Math.min(Math.PI, halfArc + slack) * 180) / Math.PI
        cur.rec.reach = spec.range + Body.radius[t]
      }
    }
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
      /**
       * ── 💥 **적이 적을 스치면 — 무너집니다** ─────────────────────────
       *
       * 설계 근거는 `applyPoise` 위에 길게 적어 뒀습니다. 요약: 피해는
       * 없고 강인도만 깎입니다. 유인으로 죽일 수는 없지만 무너뜨릴 수는
       * 있고, 무너지면 처형이 열립니다.
       *
       * ⚠️ **여기서 `continue` 로 빠져나갑니다.** 아래 본문(피해·출혈·
       *    넉백·어그로·피해 숫자·장부)은 한 줄도 타지 않습니다. 오사가
       *    "약한 타격"이 아니라 **다른 사건**이기 때문입니다 — 본문에
       *    조건을 흩뿌리면 나중에 하나 빠뜨린 곳이 조용히 생깁니다.
       */
      if (
        !attackerIsPlayer &&
        hasComponent(Enemy, t) &&
        hasComponent(Status, t) &&
        Actor.state[t] !== ActorState.Dead &&
        // 💥 **한 번 스치면 잠시 안 스칩니다.** 이게 없으면 판정이 열려
        // 있는 매 프레임 다시 성립합니다 — 실제로 8초에 1166회가
        // 찍혔습니다(components.ts `crossfireT`).
        Status.crossfireT[t] <= 0 &&
        // 화살은 위에서 이미 「처음 만나는 몸」 규칙을 씁니다 — 두 번 처리 금지.
        !spec.projectile &&
        shapeDist(t) >= 0
      ) {
        Status.crossfireT[t] = crossfirePause()
        applyPoise(t, spec, false, true)
        // 눈에 보여야 규칙입니다 — 맞은 쪽 번쩍임은 무게 규칙을 그대로 씁니다.
        Health.flashT[t] = hurtFlash(spec.hitstop)
        crossfireEvents.push({
          entity: t,
          x: Transform.x[t],
          y: Transform.y[t] + Body.height[t] * 0.5,
          z: Transform.z[t],
        })
      }
      continue
    }

    if (Actor.state[t] === ActorState.Dead) continue
    if (Health.invulnT[t] > 0) continue

    const dist = shapeDist(t)
    if (dist < 0) continue

    /**
     * ── 💥 **폭발통에 불을 붙입니다** ────────────────────────────────
     *
     * 오사와 **같은 자리·같은 모양**으로 짭니다: 여기서 `continue` 로
     * 빠져나가고 아래 본문(피해·출혈·넉백·어그로·피해 숫자·장부)은
     * 한 줄도 안 탑니다. 통에 불이 붙는 것은 "약한 타격"이 아니라
     * **다른 사건**이기 때문입니다.
     *
     * ⚠️ 여기에 **적은 못 옵니다.** 적이 통을 치면 위 진영 검사에서
     *    `attackerIsPlayer === targetIsPlayer`(둘 다 false)로 걸려
     *    오사 가지로 갔다가 `hasComponent(Enemy, t)` 에서 떨어집니다.
     *    일부러 그렇습니다 — 통은 **플레이어가 고르는 도구**이지
     *    아무 때나 터지는 함정이 아닙니다. 함정이 되면 플레이어는
     *    "저 통 옆에서 싸우지 말자"만 배웁니다.
     *
     * ⚠️ `landed = true` 로 둡니다. 통을 친 것도 **맞은 것**이라
     *    히트스톱·소리가 나야 합니다. 안 그러면 허공을 벤 것처럼 보입니다.
     */
    if (hasComponent(Barrel, t)) {
      /**
       * 여기서는 **체력만 깎습니다.** 불을 붙이는 것은 `barrelSystem` 한 곳
       * 뿐입니다.
       *
       * ⚠️ 처음엔 여기서 바로 불을 붙였습니다. `npm run barrel` 이 그걸
       *    잡았습니다 — 다른 경로로 들어온 피해(실험대의 `damageEntity`,
       *    앞으로 생길 지형 피해·장판 등)로는 통이 **꿈쩍도 안 했습니다.**
       *    주석에는 *"체력 1이라 한 대면 터진다"* 고 적어 놓고 정작 체력은
       *    한 번도 안 줄고 있었습니다. 점화 조건을 **「체력이 0이 되면」**
       *    하나로 모으면, 앞으로 어떤 피해원이 생겨도 저절로 통합니다.
       */
      if (Health.hp[t] > 0) Health.hp[t] = 0
      landed = true
      continue
    }

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
    /**
     * 🧪 **실험대 전용 무적** — `setHp`·`setStamina`·`setFocus` 와 같은 성격의
     * "만들기" 장치입니다. 게임 규칙이 아니라 **재기 위한 받침대**입니다.
     *
     * 왜 필요했는가: 보스가 페이즈마다 내주는 창을 재려면 플레이어가 그
     * 앞에 40초를 서 있어야 하는데, **한 번 죽으면 조우가 통째로 끝납니다**
     * (enemyAI 귀환 → 어그로 0). 실제로 2단계(속박)에서 딱 한 프레임 죽었고,
     * 그 뒤 40초가 전부 빈 관측이 되어 *"2단계는 창을 안 준다"* 는
     * **정반대 결론**을 낼 뻔했습니다. 프로브에서 매 프레임 체력을 채우는
     * 것으로는 한 프레임 안에 들어오는 큰 한 방을 못 막습니다.
     *
     * ⚠️ 기본값은 꺼짐이고, 켜는 곳은 실험대뿐입니다. 피해만 막고 넉백·
     *    경직·집중은 그대로 둡니다 — 보스의 **리듬**을 재는 것이지
     *    플레이어를 유령으로 만드는 것이 아닙니다.
     */
    if (targetIsPlayer && debugPlayerInvulnerable) continue
    /**
     * 🛡 **저스트 가드** — 완벽 회피보다 **먼저** 봅니다.
     *
     * 순서가 곧 뜻입니다. 둘 다 성립할 수 있는 순간(구르는 중에 가드가
     * 열려 있는 경우)에 회피를 먼저 보면, 가드는 **영영 안 잡히는 판정**이
     * 됩니다 — 창이 더 짧은 쪽이 먼저 와야 짧게 만든 값이 살아납니다.
     * 다만 실제로는 겹치지 않게 playerControl 이 구르는 중 가드를 막습니다.
     *
     * ⚠️ **🔴 직격에만 통합니다**(설계 근거는 balance.ts `GUARD`). 아무
     *    색에나 통하면 "전부 가드로 푼다"가 만능 정답이 되어 색 다섯이
     *    통째로 무의미해집니다.
     */
    if (
      targetIsPlayer &&
      Player.guardT[t] > 0 &&
      !attackerIsPlayer &&
      hasComponent(Enemy, a) &&
      attackAt(Enemy.kind[a], Enemy.attackIndex[a]).intent === AttackIntent.Strike &&
      /**
       * 🛡 **등지고는 못 막습니다.**
       *
       * 처음엔 방향을 안 봤습니다. 봇에게 이 동사를 가르치려고 코드를 다시
       * 읽다가 구멍이 보였습니다 — 방향이 없으면 **도망치면서 아무 쪽으로나
       * 눌러도 되는 답**이 되고, 그러면 "정면에서 받아낸다"는 가드의 정체성이
       * 사라집니다. 반격(🟢)은 이미 정면만 인정하는데 가드만 안 그랬습니다.
       *
       * 세키로·Lies of P·Wo Long 의 가드는 전부 **방향이 있습니다.** 그게
       * 가드를 회피와 다른 기술로 만드는 절반입니다 — 회피는 몸을 빼는 것이고
       * 가드는 **맞서는 것**입니다.
       *
       * 판정은 반격과 **같은 함수**를 씁니다. 둘이 다른 식을 쓰면 "정면"의
       * 뜻이 두 개가 되어, 한쪽을 고치는 날 조용히 갈라집니다.
       */
      !isBehindPoint(Transform.x[a], Transform.z[a], Transform.x[t], Transform.z[t], Transform.rotY[t])
    ) {
      /**
       * 창을 **닫습니다.** 안 닫으면 남은 창 동안 두 번째·세 번째 공격까지
       * 공짜로 막혀서, 다대일에서 가드 한 번이 전부를 지웁니다.
       */
      Player.guardT[t] = 0
      Stamina.value[t] = Math.min(Stamina.max[t], Stamina.value[t] + GUARD.refund)
      /**
       * 보상은 **강인도**입니다 — 완벽 회피(다음 한 대 확정 치명타)와
       * 다른 것을 벌어야 두 답이 각자 값을 갖습니다. 세키로가 튕기기를
       * 체간에, 회피를 위치에 붙여 나눈 것과 같은 자리입니다.
       * 무기의 `poiseScale` 을 그대로 태워, 무엇을 들었는지가 남습니다.
       */
      Enemy.poiseIdleT[a] = 0
      Enemy.poise[a] -= poiseDamage(
        GUARD.poise,
        weaponOf(t).poiseScale ?? 1,
        1,
        Enemy.kind[a],
        Enemy.phase[a],
      )
      if (Enemy.poise[a] <= 0) breakPoise(a)
      justGuardEvents.push({ entity: a, x: Transform.x[a], y: Transform.y[a], z: Transform.z[a] })
      continue
    }
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

    /**
     * 🛡 **보스는 뒤 구간에서 덜 맞습니다** — 배율의 근거는 `bossTakenScale`.
     *
     * 평타·강타·처형·스킬·반격이 전부 이 한 줄로 모이기 때문에, 새 공격
     * 종류를 넣어도 여기를 지나갑니다. 출처별로 곱하지 않는 이유입니다.
     */
    damage *= bossTakenScale(t)
    Health.hp[t] -= damage
    /**
     * 📊 **보스가 무엇에 녹는가** — 출처별로, 페이즈별로.
     *
     * 지난 라운드에 페이즈별 초당 피해를 재 놓고 *"상승분이 어디서
     * 오는지도 갈라야 처방이 정해진다"* 고 적어 놓고는, 안 가른 채
     * 체력을 두 번 올렸습니다. 두 번 다 다시 짧아졌습니다. 무딘 수단을
     * 두 번 쓴 이유는 **어디를 깎아야 할지 몰랐기 때문**입니다.
     *
     * 여기서 세면 추측이 안 들어갑니다 — `spec.source` 는 스펙을 만든
     * 쪽이 직접 단 이름이고, 페이즈는 지금 그 보스의 페이즈입니다.
     * (출혈 터짐과 낙하는 이 경로를 안 지나므로 각자 자리에서 셉니다.)
     */
    if (Enemy.kind[t] === EnemyKind.Boss && spec.source) {
      const ph = Math.min(2, Math.max(0, Enemy.phase[t]))
      const row = bossDamageBySource[spec.source]
      if (row) row[ph] += damage
    }
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
    // 🤕 맞는 쪽 반응은 **이 한 대의 무게**로 갈립니다 (balance.ts `HURT`).
    // 숫자를 여기 적지 않는 이유: 그리는 쪽(visuals.ts)이 같은 규칙으로
    // 되읽어야 하는데, 양쪽에 적어 두면 갈라져도 아무도 모릅니다.
    Health.flashT[t] = hurtFlash(spec.hitstop)
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

    // 🩸 맞은 횟수 — 「쌓은 총량」의 분모입니다(components.ts `hitsTaken`).
    if (!targetIsPlayer && hasComponent(Enemy, t)) Enemy.hitsTaken[t]++
    const killed = Health.hp[t] <= 0
    /**
     * 📊 **잡몹 장부** — 보스가 아닌 적에게 들어간 것만(설계 근거는 위
     * `mobDamageBySource`). 보스는 페이즈별로 따로 세므로 여기서 뺍니다.
     */
    if (hasComponent(Enemy, t) && Enemy.kind[t] !== EnemyKind.Boss && spec.source) {
      noteMobDamage(spec.source, damage, killed)
    }
    // 🩸 죽는 순간 게이지에 남은 몫 — 「0회」의 이유를 가르는 값입니다.
    if (killed && !targetIsPlayer && hasComponent(Enemy, t)) noteDeathWithBleed(t)

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
      } else if (hasComponent(Enemy, t)) {
        /**
         * 🩸 **출혈은 어느 가지로 가든 쌓입니다 — 사슬 밖에 둡니다.**
         *
         * ── 여기 있던 버그 ────────────────────────────────────────
         * `applyBleed` 가 이 사슬의 **마지막 가지 안**에 있었습니다. 그래서
         * 반격·기습·처형으로 때린 타격은 출혈을 **한 방울도** 안 쌓았습니다.
         * 보스에게 출혈이 한 번도 안 터진 이유가 이것이었습니다 — 잘 싸울수록
         * (반격 6회 · 처형 2회) 출혈 축이 더 죽었습니다. **잘하면 손해**가
         * 되는 규칙이 숨어 있었던 셈입니다.
         *
         * 더 나쁜 것은 간격입니다. 출혈은 *"얼마나 이어졌는가"* 를 재는데,
         * 반격하는 동안에도 `bleedIdleT` 는 계속 자랍니다. 즉 게임이 가장
         * 칭찬하는 행동이 출혈 게이지에는 **때리지 않은 시간**으로 잡혔습니다.
         *
         * 참고 게임은 전부 반대입니다 — 엘든 링·다크 소울 3 에서 치명타·
         * 백스탭·리포스트도 출혈을 쌓고, 몬헌은 타격 종류와 무관하게 상태를
         * 누적하며, 로스트아크의 무력화·파괴 게이지도 출처를 안 가립니다.
         * 공통 규칙은 하나입니다: **누적은 "맞았는가"의 성질이지 "어느
         * 가지로 갔는가"의 성질이 아닙니다.**
         *
         * 강인도(`applyPoise`)는 반대로 사슬 **안**에 그대로 둡니다. 반격과
         * 기습은 강인도를 *깎는* 게 아니라 **즉시 부수는** 것이라, 두 번
         * 처리하면 규칙이 겹칩니다.
         */
        applyBleed(t, spec)

        if (countered) {
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
        } else if (spec.finisher) {
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
        } else {
          // `back` 은 위에서 이미 계산했습니다(근접 부채꼴 + 등 뒤).
          // 강인도에도 같은 판정을 그대로 씁니다 — 두 번 계산하면 언젠가 어긋납니다.
          applyPoise(t, spec, back)
        }
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
      const gain = 1 / Math.max(1, steps)
      const had = Player.focus[a]
      Player.focus[a] = Math.min(FOCUS.max, had + gain)
      // 🥋 들어온 만큼과 흘린 만큼을 나눠 셉니다 — 위 `focusGain` 주석.
      focusGain.평타 += Player.focus[a] - had
      focusWasted += gain - (Player.focus[a] - had)
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
    /**
     * 🔁 **헛치지 않았습니다.** 이 깃발이 남아 있어야만 긴 후딜을 씁니다
     * (근거는 enemyAttacks.ts `whiffRecovery` 주석).
     *
     * ⚠️ 여기에 두는 것이 중요합니다. 위쪽의 무적 프레임·실험대 무적은
     *    `continue` 로 빠지므로 깃발이 **남습니다** — 즉 잘 구른 사람도
     *    "빗나가게 만든 사람"으로 셉니다. 그게 맞습니다: 이 값이 갚아 주려는
     *    대상은 *맞지 않은 사람*이지 *멀리 선 사람*이 아닙니다.
     */
    if (!attackerIsPlayer && targetIsPlayer) Enemy.whiffing[a] = 0
    /**
     * ⚡ **적중 캔슬의 깃발** — 플레이어가 맞혔다는 사실을 여기서 적습니다.
     *
     * 적의 `whiffing` 과 **같은 자리에 나란히** 둡니다. 둘은 같은 사건의
     * 양면이고(누가 맞혔는가), 이 저장소가 계속 적어 온 그대로
     * **사건은 사건이 일어난 자리에서 기록합니다.** 조작 쪽(playerControl)
     * 에서 "아마 맞았겠지"를 추측하면, 무적 프레임·통·실험대 무적 같은
     * 예외가 생길 때마다 두 곳이 갈라집니다.
     *
     * ⚠️ 위 무적 프레임 처리가 `continue` 로 빠지므로, **잘 구른 적을 친
     *    것은 여기에 안 옵니다.** 그게 맞습니다 — 상대가 무적으로 흘린
     *    것은 맞힌 것이 아닙니다.
     */
    if (attackerIsPlayer && !targetIsPlayer) Player.hitConfirm[a] = 1
    /**
     * 🌀 **마무리를 맞혔으면 기력을 일부 갚습니다** (니오의 기 펄스와 같은
     * 자리 — 설계 근거는 balance.ts `COMBO_FINISH_REFUND`).
     *
     * `!landed` 로 감싼 것이 요점입니다: 여럿을 때려도 **한 번만** 갚습니다.
     * 안 그러면 군중 한복판에서 마무리 한 번에 기력이 가득 찹니다.
     */
    if (attackerIsPlayer && spec.comboFinisher && !landed && hasComponent(Stamina, a)) {
      Stamina.value[a] = Math.min(
        Stamina.max[a],
        Stamina.value[a] + (spec.finisherCost ?? 0) * COMBO_FINISH_REFUND,
      )
    }
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

  /**
   * ── 💥 **통을 겨눴으면 손을 안 돌립니다** ────────────────────────
   *
   * 위 주석이 이미 규칙을 적어 뒀습니다: *"거리순으로 하면 겨눈 적을 두고
   * 옆의 다른 적을 치는 **배신**이 일어납니다."* 폭발통이 생기면서 같은
   * 배신이 한 종류 더 생겼습니다 — **통을 클릭했는데 옆의 적을 칩니다.**
   *
   * 자동 플레이가 그대로 보여 줬습니다. 봇이 통을 겨눠 누른 프레임이
   * 145 인데 터진 통은 3 개였습니다. 사람에게는 *"분명히 통을 눌렀는데
   * 안 터진다"* 로 보입니다 — 조준 보정이 만든 결함이지 통의 결함이
   * 아닙니다.
   *
   * 새 원칙을 만들지 않습니다. **같은 원칙(조준선에 가장 가까운 것)** 을
   * 통에도 적용할 뿐입니다: 조준선에 통이 적보다 가까우면 보정을
   * **끕니다**(적 쪽으로 돌리지 않습니다). 통 쪽으로 억지로 돌리지도
   * 않습니다 — 통은 안 움직이므로 겨누기 쉬운 대상이고, 도와줄 이유가
   * 없습니다. 필요한 것은 **방해하지 않는 것**뿐입니다.
   */
  const bids = barrels.run()
  for (let i = 0; i < barrels.count; i++) {
    const b = bids[i]
    if (Health.hp[b] <= 0) continue
    const dx = Transform.x[b] - px
    const dz = Transform.z[b] - pz
    const dist = Math.hypot(dx, dz)
    if (dist < 0.0001 || dist > maxDist + Body.radius[b]) continue
    let off = Math.atan2(dx, dz) - aimRot
    while (off > Math.PI) off -= Math.PI * 2
    while (off < -Math.PI) off += Math.PI * 2
    if (Math.abs(off) < bestOff) return { rot: aimRot, dist: Infinity }
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
