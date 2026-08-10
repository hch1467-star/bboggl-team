import {
  FINISH_COMBO,
  HEAVY_COMBO,
  SKILL_KEY_CODES,
  finisherStep,
  heavyStep,
  type SkillDef,
} from '../config/arsenal'
import { FINISHER, FOCUS, PLAYER, SKILL_COOLDOWN_SCALE, VIAL } from '../config/balance'
import { SNARE_MOVE_SCALE } from '../config/enemyAttacks'
import {
  Actor,
  ActorState,
  AttackPhase,
  Enemy,
  Health,
  Loadout,
  Player,
  Stamina,
  Status,
  Transform,
  Velocity,
} from '../core/components'
import { sfx } from '../core/audio'
import { defineQuery } from '../core/ecs'
import { consumePress, isDown } from '../core/input'
import { time } from '../core/time'
import { WEAPONS } from '../config/arsenal'
import { assistAim } from './combat'
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

/**
 * 지금까지 쓴 스태미나의 **누적 합** — 무기 비교 프로브가 읽습니다.
 *
 * 프로브가 매 프레임 스태미나 값을 관측해서 감소분을 더하고 있었는데,
 * 한 표본 사이에 "크게 쓰고 조금 회복"이 같이 일어나면 그만큼을 놓칩니다.
 * 한 번에 크게 쓰는 무기(대검)일수록 덜 세어져서, **효율이 실제보다 좋아
 * 보였습니다.** 쓴 쪽이 세는 것이 정확합니다.
 */
let staminaSpent = 0
export function readStaminaSpent(): number {
  return staminaSpent
}
export function resetStaminaSpent(): void {
  staminaSpent = 0
  skillCasts.fill(0)
  lightSwings = 0
}

/**
 * ── 기둥 1 을 재는 눈금 ─────────────────────────────────────────────
 *
 * *"두 자원, 두 리듬"* 은 이 게임의 **핵심 차별점**이라고 적어 둔
 * 것입니다(DESIGN.md 기둥 1): 기본 공격은 **스태미나**로, 스킬 다섯은
 * **쿨다운**으로 굴러가고, 둘이 번갈아 오면서 리듬이 생긴다는 주장입니다.
 *
 * 그런데 **한 번도 재 본 적이 없습니다.** 재지 않은 주장은 설계가 아니라
 * 희망입니다. 실제로는 세 가지 중 하나일 수 있습니다:
 *   · 스킬이 늘 하나는 준비되어 있다 → 쿨다운 리듬이 **장식**
 *   · 스킬이 거의 안 나온다        → 슬롯 다섯이 **장식**
 *   · 번갈아 온다                  → 주장이 사실
 *
 * 봇이 키를 눌렀는지가 아니라 **실제로 나갔는지**를 게임 쪽에서 셉니다.
 * 누른 것과 나간 것은 다릅니다(스태미나·쿨다운·상태가 막습니다). 이
 * 프로젝트에서 잡은 계기 버그 열둘이 전부 그 틈에서 나왔습니다.
 */
const skillCasts = new Array<number>(8).fill(0)
let lightSwings = 0
export function readRhythm(): { skillCasts: number[]; lightSwings: number } {
  return { skillCasts: skillCasts.slice(0, 5), lightSwings }
}
/**
 * 플레이어 공격의 **앞뒤(예고·후딜) 배율.** 판정(active)은 안 건드립니다 —
 * 그건 손맛이 아니라 규칙이고, 적 예고 길이와 맞물려 있습니다.
 * (근거는 balance.ts PLAYER.tempo 주석)
 *
 * ⚠️ 시간을 **넣는 곳과 재는 곳이 같은 배율**을 써야 합니다. 후딜만 줄이고
 * 취소 판정(`recovery * 0.5`)을 안 줄이면, 줄어든 후딜 안에서 그 지점이
 * 상대적으로 뒤로 밀려 **취소가 더 늦게** 열립니다 — 빠르게 만들려던 것이
 * 반대로 굼떠집니다. 그래서 아래 모든 자리에 함께 곱합니다.
 */
const TEMPO = PLAYER.tempo.attackScale

function spendStamina(p: number, cost: number): void {
  const used = Math.min(Stamina.value[p], cost)
  staminaSpent += used
  Stamina.value[p] = Math.max(0, Stamina.value[p] - cost)
  Stamina.regenDelayT[p] = PLAYER.staminaRegenDelay
}
const finishable = defineQuery(Enemy, Transform, Health, Actor)

/**
 * 회복이 실제로 들어간 순간. 게임 루프가 읽고 비웁니다.
 * (연출은 시스템 밖에서 — hitEvents / deathEvents 와 같은 규약입니다.)
 */
export interface HealEvent {
  x: number
  y: number
  z: number
  amount: number
}
export const healEvents: HealEvent[] = []

const DEG = Math.PI / 180

/** 대시 스킬이 조준 지점을 지나쳐 더 나아가는 거리(m). 이만큼이 "등 뒤"가 됩니다. */
const DASH_OVERSHOOT = 1.2

/**
 * 스킬 선입력을 붙잡아 두는 시간(초).
 *
 * ⚠️ 예전에는 이 창이 **스킬에만** 있었습니다. 공격은 만료 없는 깃발
 * 하나였고 구르기는 아예 버퍼가 없었습니다. 같은 손가락이 누르는 세
 * 가지에 규칙이 셋이면, 손은 그중 가장 인색한 것에 맞춰 배웁니다 —
 * "일단 기다렸다가 누른다". 그래서 셋이 **한 상수**를 씁니다.
 * (길이의 근거는 balance.ts `PLAYER.tempo.inputBuffer` 주석에 있습니다.)
 */
const BUFFER_TIME = PLAYER.tempo.inputBuffer

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

/**
 * 남은 시간 안에 **정확히 도착하도록** 목표 각도로 수렴시킵니다.
 *
 * 플레이 테스트: "공격 시작할 때 몸이 확 도는 게 이상하다."
 * 예전에는 공격을 시작하는 순간 `rotY = 목표`로 **순간이동**시켰습니다.
 * 조준 보정이 붙으면서 그 순간 회전이 최대 48°까지 커져 더 튀어 보였습니다.
 *
 * 그렇다고 고정 속도로 천천히 돌리면, 선행동작이 0.07초인 단검은 다 돌기 전에
 * 판정이 터져서 **엉뚱한 곳을 벱니다.** 그래서 "남은 시간에 맞춰" 도는 방식을 씁니다:
 * 남은 시간이 한 프레임 이하면 그냥 도착시킵니다. 판정이 시작되는 순간에는
 * 항상 목표를 정확히 향하고 있으므로 **부드러워지되 정확도는 그대로**입니다.
 */
function turnArrive(p: number, targetRot: number, remaining: number, dt: number): void {
  const diff = wrapAngle(targetRot - Transform.rotY[p])
  const k = remaining <= dt ? 1 : dt / remaining
  Transform.rotY[p] += diff * k
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

/**
 * 🥋 강타 — 모아 둔 집중을 **전부** 태웁니다.
 *
 * 일부만 쓰게 하지 않은 이유: "2점 중 1점만 쓰기" 같은 선택지를 열면
 * 판단이 늘어나는 게 아니라 **매 순간 계산해야 할 것**이 늘어납니다.
 * 오공도 모아둔 것을 한 번에 태웁니다. 결정은 "얼마나 쓸까"가 아니라
 * **"지금 태울까, 더 모을까"** 하나로 충분합니다.
 */
function beginHeavy(p: number, aimRot: number): void {
  Player.focusSpent[p] = Math.floor(Player.focus[p])
  Player.focus[p] -= Player.focusSpent[p]
  beginAttack(p, HEAVY_COMBO, aimRot)
}

/**
 * 지금 처형할 수 있는 무방비 적 — 없으면 -1.
 *
 * **정면을 요구하지 않습니다.** 무방비인 적은 방향 개념이 없으니(안 돌아섭니다)
 * 각도를 요구하면 "왜 안 되지"만 늘어납니다. 대신 거리는 짧게(2.6m) 둬서
 * **다가가는 것 자체가 결정**이 되게 합니다 — 그 사이 옆의 적이 움직입니다.
 */
export function finisherTarget(p: number): number {
  const ids = finishable.run()
  let best = -1
  let bestD: number = FINISHER.reach
  for (let i = 0; i < finishable.count; i++) {
    const e = ids[i]
    if (Enemy.brokenT[e] <= 0) continue
    if (Health.hp[e] <= 0) continue
    const d = Math.hypot(Transform.x[e] - Transform.x[p], Transform.z[e] - Transform.z[p])
    if (d > bestD) continue
    bestD = d
    best = e
  }
  return best
}

function beginAttack(p: number, index: number, aimRot: number): void {
  const c =
    index === HEAVY_COMBO
      ? heavyStep(weaponOf(p), Player.focusSpent[p])
      : index === FINISH_COMBO
        ? finisherStep(weaponOf(p))
        : weaponOf(p).combo[index]
  // 조준 보정 — 이미 대충 맞게 겨눴으면 마무리를 다듬어 줍니다(combat.ts 설계 노트).
  // 파고들기가 커서를 따라가므로, 보정 없이는 빗나간 조준이 위치까지 틀어 놓습니다.
  const aim = assistAim(Transform.x[p], Transform.z[p], aimRot, c.range)

  /**
   * **적응형 파고들기.**
   *
   * 고정 1.5m를 파고들면 1.6m 앞의 적을 지나쳐 버립니다. 측정에서 정확히
   * 그렇게 나왔습니다 — 몸은 적을 보고 있는데(보정 성공) 코앞에서만 빗나갔습니다:
   *
   *     롱소드 1.6m :  0°  O  /  15°  .  /  30°  .      (몸각 0~10°)
   *
   * 그래서 **고정 거리가 아니라 "사거리 안쪽으로 들어갈 만큼만"** 파고듭니다.
   * 대시 스킬에서 이미 같은 방식으로 고쳤던 문제입니다(arsenal.ts shadow_step 주석).
   * 적이 없으면(허공을 침) 원래 거리를 그대로 써서 전진하는 손맛을 남깁니다.
   */
  const settle = c.range * 0.55 // 이 정도 거리에 서면 부채꼴 한가운데에 들어옵니다
  const lunge =
    aim.dist === Infinity ? c.lunge : Math.min(c.lunge, Math.max(0, aim.dist - settle))
  Player.dashSpeed[p] = lunge / Math.max(c.windup, 0.001)
  const rot = aim.rot
  Actor.state[p] = ActorState.Attack
  Actor.phase[p] = AttackPhase.Windup
  Actor.timer[p] = c.windup * TEMPO
  Actor.comboIndex[p] = index
  Actor.hitsLeft[p] = 0
  Actor.nextHitT[p] = 0
  // 자기 버퍼만 씁니다 — 구르기 선입력은 남겨 둡니다(후딜에서 구르기로 빠질 수 있게).
  Actor.bufferedAttack[p] = 0
  Actor.bufferedAttackT[p] = 0
  spendStamina(p, c.staminaCost)
  // 기둥 1 — **스태미나로 낸 공격**. 쿨다운으로 낸 것과 나눠 셉니다.
  lightSwings++
  // 스냅하지 않고 **목표만 정해 둡니다.** 선행동작 동안 수렴합니다(turnArrive).
  Player.faceRot[p] = rot

  /**
   * 휘두르는 소리의 무게를 **trauma 값에서 그대로 가져옵니다.**
   * 무게용 필드를 새로 만들지 않은 이유: trauma는 이미 "이 타격이 얼마나
   * 묵직한가"를 나타내는 숫자입니다. 같은 뜻의 숫자를 두 개 두면 밸런스를
   * 바꿀 때 한쪽만 고쳐서 소리와 화면이 어긋나게 됩니다.
   */
  sfx.swing(c.trauma / 0.55)
}

function beginSkill(
  p: number,
  slot: number,
  def: SkillDef,
  aimRotIn: number,
  ctx: ControlContext,
): void {
  let aimRot = aimRotIn
  /**
   * 스킬도 같은 보정을 받습니다 — 단, **지점 지정(point) 스킬은 제외**합니다.
   * 지점 스킬은 "커서가 가리킨 자리에 떨어뜨린다"가 기술의 정체라서,
   * 여기에 보정을 넣으면 플레이어가 고른 자리를 게임이 덮어쓰게 됩니다.
   */
  if (def.shape !== 'point') {
    aimRot = assistAim(Transform.x[p], Transform.z[p], aimRot, def.range + def.dash).rot
  }

  if (slot >= 0 && slot < skillCasts.length) skillCasts[slot]++
  Actor.state[p] = ActorState.Skill
  Actor.phase[p] = AttackPhase.Windup
  Actor.timer[p] = def.windup * TEMPO
  Actor.skillSlot[p] = slot
  Actor.hitsLeft[p] = 0
  Actor.nextHitT[p] = 0
  Actor.comboIndex[p] = 0
  Actor.bufferedAttack[p] = 0
  // 무적 프레임 타이밍은 회피와 같은 필드를 씁니다(동시에 일어나지 않으므로 안전).
  Player.dodgeElapsed[p] = 0
  // 기본 공격과 같은 규칙 — 스냅하지 않고 선행동작 동안 수렴합니다.
  Player.faceRot[p] = aimRot
  // 기둥 1 의 리듬 손잡이 — balance.ts SKILL_COOLDOWN_SCALE 설계 노트 참고.
  setCooldown(p, slot, def.cooldown * SKILL_COOLDOWN_SCALE)

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
    Player.dashSpeed[p] = distance / Math.max(def.windup * TEMPO + def.active, 0.001)
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

  // 무기마다 시전음의 음정이 다릅니다 — 어떤 무기의 스킬을 썼는지 귀로 구분됩니다.
  sfx.cast(WEAPONS.indexOf(weaponOf(p)))

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
    duration: def.windup * TEMPO,
  })
}

/**
 * 성수병을 마시기 시작합니다.
 *
 * **충전은 여기서 즉시 깎습니다.** 회복이 들어가는 순간이 아니라요.
 * 이 한 줄이 이 시스템의 핵심입니다 — 마시다가 맞으면 병만 날아갑니다.
 * 회복 시점에 깎으면 "맞으면 취소되고 병도 돌아온다"가 되어,
 * 아무 때나 눌러도 손해가 없는 **판단 없는 버튼**이 됩니다.
 */
function beginDrink(p: number): void {
  Actor.state[p] = ActorState.Drink
  Actor.phase[p] = AttackPhase.Windup
  Actor.timer[p] = VIAL.windup
  Actor.bufferedAttack[p] = 0
  Actor.bufferedAttackT[p] = 0
  Actor.comboIndex[p] = 0
  Player.vials[p] = Math.max(0, Player.vials[p] - 1)
  sfx.cast(0)
}

function beginDodge(p: number, dirX: number, dirZ: number): void {
  Actor.state[p] = ActorState.Dodge
  Actor.timer[p] = PLAYER.dodge.duration
  Actor.comboIndex[p] = 0
  /**
   * ⚠️ **공격 선입력을 지우지 않습니다.** (예전에는 지웠습니다.)
   *
   * 그 한 줄이 "구르고 나서 바로 치기"를 불가능하게 만들고 있었습니다.
   * 구르기를 시작하는 순간 눌러 둔 공격이 버려지니, 플레이어는 착지를
   * **눈으로 확인하고** 다시 눌러야 했습니다. 소울류·오공에서 구르기가
   * 공격 준비 동작으로 쓰이는 이유가 정확히 이 이어짐입니다.
   */
  Actor.bufferedDodge[p] = 0
  Actor.bufferedDodgeT[p] = 0
  Actor.hitsLeft[p] = 0
  Player.dodgeDirX[p] = dirX
  Player.dodgeDirZ[p] = dirZ
  Player.dodgeElapsed[p] = 0
  // 무기마다 회피 값이 다릅니다 — arsenal.ts dodgeCostScale 설계 노트 참고.
  spendStamina(p, PLAYER.dodge.staminaCost * (weaponOf(p).dodgeCostScale ?? 1))
  Transform.rotY[p] = Math.atan2(dirX, dirZ)
  sfx.dodge()
}

export function playerControlSystem(ctx: ControlContext): void {
  const dt = time.dt
  const ids = players.run()

  // 입력은 상태와 무관하게 매 프레임 한 번씩 소비합니다.
  // 상태 안에서 조건부로 읽으면 입력이 다음 프레임에 남아 뒤늦게 터집니다.
  const attackPressed = consumePress('Mouse0')
  // 🥋 강타 — 우클릭. 지금까지 비어 있던 유일한 주요 입력이라, 새 키를
  // 외우게 하지 않고도 "왼쪽은 쌓기, 오른쪽은 태우기"가 손에 붙습니다.
  const heavyPressed = consumePress('Mouse2')
  /**
   * 구르기는 **Space 하나**입니다.
   *
   * 예전엔 `Space || ShiftLeft` 였습니다 — 편의로 둔 보조 키였는데,
   * 달리기를 Shift 에 넣으면서 **같은 키가 두 동사를 갖게** 됐습니다.
   * 달리려고 Shift 를 누르면 대신 굴러 버립니다.
   *
   * 눈으로는 못 잡았습니다. 봇은 Shift 를 안 누르고, 벤치도 안 씁니다.
   * `npm run sprint` 의 *"제자리에서 Shift 만 눌러도 움직이지 않는다"* 가
   * 3.91m 를 찍어서 드러났습니다 — 구르기 거리(4.2m)와 같은 값이었습니다.
   *
   * 소울류는 **탭=구르기, 홀드=달리기**로 한 키에 둘을 겁니다. 그 방식도
   * 좋지만 지금 넣지 않았습니다: 탭/홀드 판정에는 문턱 시간이 필요하고,
   * 그 시간만큼 **구르기가 늦게 나갑니다.** 회피가 늦는 것은 이 게임에서
   * 가장 비싼 지연입니다(무적 프레임이 0.06~0.3초 구간입니다).
   * 키가 남아 있으니 굳이 한 키에 겹칠 이유가 없습니다.
   */
  const dodgePressed = consumePress('Space')
  const drinkPressed = consumePress('KeyX')
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
      Actor.bufferedSkillT[p] = BUFFER_TIME
    } else if (Actor.bufferedSkillT[p] > 0) {
      Actor.bufferedSkillT[p] = Math.max(0, Actor.bufferedSkillT[p] - dt)
      if (Actor.bufferedSkillT[p] === 0) Actor.bufferedSkill[p] = 0
    }
    /**
     * 공격·구르기도 **같은 자리에서 같은 방식으로** 기억합니다.
     *
     * 예전에는 공격 버퍼를 `case ActorState.Attack:` 안에서 세웠습니다.
     * 그래서 공격 중에 누른 것만 기억되고, **구르는 중에 누른 공격은
     * 통째로 사라졌습니다** — 구르고 나서 치려면 착지를 보고 다시 눌러야
     * 했습니다. 상태마다 다른 데서 기억하면 반드시 이런 구멍이 생깁니다.
     */
    if (attackPressed) {
      Actor.bufferedAttack[p] = 1
      Actor.bufferedAttackT[p] = BUFFER_TIME
    } else if (Actor.bufferedAttackT[p] > 0) {
      Actor.bufferedAttackT[p] = Math.max(0, Actor.bufferedAttackT[p] - dt)
      if (Actor.bufferedAttackT[p] === 0) Actor.bufferedAttack[p] = 0
    }
    if (dodgePressed) {
      Actor.bufferedDodge[p] = 1
      Actor.bufferedDodgeT[p] = BUFFER_TIME
    } else if (Actor.bufferedDodgeT[p] > 0) {
      Actor.bufferedDodgeT[p] = Math.max(0, Actor.bufferedDodgeT[p] - dt)
      if (Actor.bufferedDodgeT[p] === 0) Actor.bufferedDodge[p] = 0
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

    const canDodge =
      Stamina.value[p] >= PLAYER.dodge.staminaCost * (weaponOf(p).dodgeCostScale ?? 1) &&
      Player.dodgeCooldownT[p] <= 0
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
    /**
     * 눌러 둔 것을 **꺼내 씁니다.** 꺼내면 사라집니다 — 한 번 누른 것이
     * 두 번 나가면 안 됩니다.
     */
    const takeBufferedDodge = (): boolean => {
      if (Actor.bufferedDodge[p] !== 1) return false
      Actor.bufferedDodge[p] = 0
      Actor.bufferedDodgeT[p] = 0
      return true
    }
    const takeBufferedAttack = (): boolean => {
      if (Actor.bufferedAttack[p] !== 1) return false
      Actor.bufferedAttack[p] = 0
      Actor.bufferedAttackT[p] = 0
      return true
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
        /**
         * ⚠️ 이번 프레임의 키가 아니라 **버퍼**를 봅니다.
         *
         * Idle 은 싸우는 동안 거의 오지 않는 상태입니다(공격·후딜·구르기가
         * 이어지므로). 그래서 "Idle 인 프레임에 정확히 눌렀는가"로 판정하면,
         * 실제로는 눌렀는데 아무 일도 안 일어나는 순간이 계속 생깁니다.
         * 처형이 안 나가던 것도 같은 이유였습니다(아래 endAttack 설계 노트).
         */
        const dodgeQueued = Actor.bufferedDodge[p] === 1
        const attackQueued = Actor.bufferedAttack[p] === 1
        if (dodgeQueued && canDodge) {
          takeBufferedDodge()
          // 이동 입력이 있으면 그 방향으로, 없으면 조준 반대(뒤)로 구릅니다.
          const dx = hasMoveInput ? mx : -Math.sin(aimRot)
          const dz = hasMoveInput ? mz : -Math.cos(aimRot)
          beginDodge(p, dx, dz)
          break
        }
        if (drinkPressed) {
          // 체력이 가득이어도 마실 수 있게 둡니다. "가득이라 안 마셔짐"은
          // 다급한 순간에 **키가 씹힌 것과 구분되지 않습니다.**
          if (Player.vials[p] > 0) beginDrink(p)
          else sfx.deny()
          break
        }
        if (heavyPressed) {
          // 집중이 없으면 거절음. 조용히 무시하면 "키가 씹혔나"와 구분이 안 됩니다.
          if (Player.focus[p] >= 1 && Stamina.value[p] >= FOCUS.heavy.staminaCost) {
            beginHeavy(p, aimRot)
          } else {
            sfx.deny()
          }
          break
        }
        if (attackQueued) {
          /**
           * ---- 처형 ----
           *
           * **새 키를 만들지 않았습니다.** 소울류의 리포스트가 그렇듯 기본
           * 공격이 상황에 따라 다른 것이 됩니다. 키를 하나 더 늘리면 초보자가
           * 외울 것이 늘고, 정작 급한 순간에 안 눌립니다. 화면에는 "처형" 안내가
           * 뜨므로 **무엇이 달라지는지는 보입니다.**
           */
          const fin = finisherTarget(p)
          if (fin >= 0 && Stamina.value[p] >= FINISHER.staminaCost) {
            takeBufferedAttack()
            beginAttack(p, FINISH_COMBO, aimRot)
            break
          }
          if (Stamina.value[p] >= weapon.combo[0].staminaCost) {
            takeBufferedAttack()
            beginAttack(p, 0, aimRot)
            break
          }
        }
        /**
         * **거절음.** 지금까지 스태미나가 모자라면 아무 일도 안 일어났습니다.
         * 초보자에게는 "키가 안 먹혔나?"와 구분이 되지 않습니다.
         * 짧은 저음 하나로 "입력은 됐고, 지금은 자원이 없다"가 됩니다.
         * — 스태미나가 자원으로 작동하려면 **바닥났다는 사실이 들려야** 합니다.
         */
        if (dodgeQueued || attackQueued) {
          sfx.deny()
          /**
           * 낼 수 없는 입력은 **버립니다.**
           *
           * 버퍼가 살아 있으면 자원이 찰 때까지 거절음이 **프레임마다**
           * 울립니다. 한 번 누른 것에 한 번 답해야 정보가 됩니다 —
           * 계속 울리면 그건 정보가 아니라 소음입니다.
           */
          takeBufferedDodge()
          takeBufferedAttack()
        }
        turnToward(p, aimRot, PLAYER.turnSpeedDeg, dt)
        break
      }

      case ActorState.Attack: {
        // 선입력은 위(공용 장부)에서 이미 기억했습니다 — 여기서 또 세우면
        // 상태마다 규칙이 갈립니다.
        moveScale = weapon.attackMoveScale

        const combo =
          Actor.comboIndex[p] === HEAVY_COMBO
            ? heavyStep(weapon, Player.focusSpent[p])
            : Actor.comboIndex[p] === FINISH_COMBO
              ? finisherStep(weapon)
              : weapon.combo[Math.min(Actor.comboIndex[p], weapon.combo.length - 1)]
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
          if (Actor.bufferedDodge[p] === 1 && canDodge) {
            takeBufferedDodge()
            const dx = hasMoveInput ? mx : -Math.sin(Transform.rotY[p])
            const dz = hasMoveInput ? mz : -Math.cos(Transform.rotY[p])
            beginDodge(p, dx, dz)
            break
          }
          /**
           * 후딜에서는 **성수병으로도** 빠져나갈 수 있습니다.
           *
           * Idle 에서만 마실 수 있게 두면 전투 중에는 사실상 못 마십니다 —
           * 공격 후딜이 계속 이어지기 때문입니다. 검증에서 X를 12번 눌러
           * 3병 중 1병밖에 못 쓴 것이 정확히 이 증상이었습니다.
           * 스킬·회피 탈출과 **같은 자리**에 두어 규칙을 하나로 유지합니다.
           */
          if (drinkPressed) {
            if (Player.vials[p] > 0) {
              beginDrink(p)
              break
            }
            sfx.deny()
          }
        }

        // 선행동작 중에는 느리게나마 방향을 틀 수 있습니다(완전 고정은 답답함).
        if (phase === AttackPhase.Windup) {
          // 판정이 시작될 때 정확히 목표를 향하도록 남은 선행동작 시간에 맞춰 수렴합니다.
          turnArrive(p, Player.faceRot[p], Actor.timer[p], dt)
          // 앞으로 파고드는 전진. 거리는 beginAttack 이 적과의 간격에 맞춰 정합니다.
          if (Player.dashSpeed[p] > 0) forwardOverride = Player.dashSpeed[p]
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
            Actor.timer[p] = combo.recovery * TEMPO
            Actor.comboWindowT[p] = weapon.comboWindow
          } else {
            endAttack(p, aimRot)
          }
        } else if (phase === AttackPhase.Recovery && Actor.bufferedAttack[p] === 1) {
          /**
           * 후딜의 남은 비율이 문턱 아래면 다음 타로 이어집니다.
           * 후딜을 끝까지 기다리게 하면 콤보가 "무겁게 끌리는" 느낌이 납니다.
           *
           * ── 단, **이어질 곳이 있을 때만** 잘라 냅니다 ────────────────
           * 콤보 선입력을 콤보 끝에서 버리지 않게 고치고 나서, 이 줄이
           * 조용히 다른 것을 바꾼다는 걸 알았습니다: 3타 무기의 3타째에서도
           * 후딜이 잘려 나가고 곧바로 1타가 다시 나갑니다. 그러면 콤보에
           * **마침표가 없어집니다** — 마지막 타의 긴 후딜(0.62초)이 그
           * 한 방을 무겁게 만드는 장치인데, 그게 통째로 사라집니다.
           *
           * 잘라 내기는 "이어치기를 위한 것"이지 "빨리 끝내기 위한 것"이
           * 아닙니다. 그래서 다음 타가 실제로 있을 때(또는 처형이 걸릴 때)만
           * 자릅니다. 콤보가 바닥났으면 후딜을 끝까지 치르고, 눌러 둔 입력은
           * **버려지지 않고 남아** 그 뒤에 새 콤보 1타로 나갑니다.
           */
          const hasNext = Actor.comboIndex[p] + 1 < weapon.combo.length
          const canFinish =
            Stamina.value[p] >= FINISHER.staminaCost && finisherTarget(p) >= 0
          if (
            (hasNext || canFinish) &&
            Actor.timer[p] <= combo.recovery * TEMPO * PLAYER.tempo.comboCancel
          )
            endAttack(p, aimRot)
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
        // (선입력은 공용 장부에서 이미 기억합니다)
        if (
          phase === AttackPhase.Recovery &&
          Actor.bufferedAttack[p] === 1 &&
          Actor.timer[p] <= def.recovery * TEMPO * 0.5
        ) {
          /**
           * 스킬 후딜에서도 **처형**이 나갑니다 — 콤보 후딜과 같은 규칙입니다.
           *
           * 이게 빠져 있으면 스킬을 많이 쓰는 플레이일수록 처형을 못 봅니다.
           * 실제로 자동 플레이가 그랬습니다: 무방비 창을 89%나 쓰면서도
           * 처형은 한 판에 한 번. 스킬 동작 중에 적이 무너지면 그 창이
           * 통째로 스킬 후딜에 먹혔기 때문입니다.
           * "무너뜨렸으면 마무리할 수 있다"는 약속은 **무엇을 쓰던 중이었든**
           * 지켜져야 합니다.
           */
          if (Stamina.value[p] >= FINISHER.staminaCost && finisherTarget(p) >= 0) {
            beginAttack(p, FINISH_COMBO, aimRot)
            break
          }
          if (Stamina.value[p] >= weapon.combo[0].staminaCost) {
            beginAttack(p, 0, aimRot)
            break
          }
        }

        // 후딜 후반에는 **다음 스킬로 바로 이어갈 수 있습니다.**
        // 스킬 3개를 엮는 것이 이 게임의 리듬이므로, 이어치기가 안 되면
        // 슬롯을 늘린 의미가 없습니다. 전반부는 못 빠지므로 커밋은 유지됩니다.
        if (phase === AttackPhase.Recovery && Actor.timer[p] <= def.recovery * TEMPO * 0.5) {
          const queued = takeBufferedSkill()
          if (queued) {
            beginSkill(p, queued.slot, queued.def, aimRot, ctx)
            break
          }
        }


        /**
         * 후딜 후반에는 **성수병으로도** 빠져나갈 수 있습니다.
         *
         * Idle 에서만 마실 수 있게 두면, 전투 중에는 사실상 못 마십니다 —
         * 공격/스킬 후딜이 계속 이어지기 때문입니다. 검증에서 X를 12번 눌러
         * 3병 중 1병밖에 못 쓴 것이 정확히 이 증상이었습니다.
         * 회피·스킬 이어가기와 **같은 규칙**(후딜 절반 이후)을 씁니다 —
         * 규칙이 하나면 외울 것도 하나입니다.
         */
        if (drinkPressed && phase === AttackPhase.Recovery && Actor.timer[p] <= def.recovery * TEMPO * 0.5) {
          if (Player.vials[p] > 0) {
            beginDrink(p)
            break
          }
          sfx.deny()
        }

        // 후딜 후반에는 회피로도 빠져나갈 수 있습니다(기본 공격과 같은 규칙).
        if (
          phase === AttackPhase.Recovery &&
          Actor.bufferedDodge[p] === 1 &&
          canDodge &&
          Actor.timer[p] <= def.recovery * TEMPO * 0.5
        ) {
          takeBufferedDodge()
          const dx = hasMoveInput ? mx : -Math.sin(Transform.rotY[p])
          const dz = hasMoveInput ? mz : -Math.cos(Transform.rotY[p])
          beginDodge(p, dx, dz)
          break
        }

        if (phase === AttackPhase.Windup) {
          // 지점 지정 스킬도 몸은 시전 방향으로 돌아야 자세가 자연스럽습니다.
          // (착탄점은 이미 고정돼 있으므로 몸이 도는 것은 판정에 영향이 없습니다.)
          turnArrive(p, Player.faceRot[p], Actor.timer[p], dt)
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
            Actor.timer[p] = def.recovery * TEMPO
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
          /**
           * ── 구르기 → 다음 동작이 이어지는 자리 ─────────────────────
           *
           * 여기서 **다음 동작을 직접 시작하지 않습니다.** 버퍼를 그대로 두고
           * Idle 로 보내면 다음 프레임에 Idle 처리가 받아 갑니다.
           *
           * 처음에는 이 자리에서 바로 이어 붙였다가 두 가지가 걸렸습니다:
           *
           *  1. **구르기 쿨다운을 건너뜁니다.** `canDodge` 는 이 프레임 앞쪽에서
           *     한 번 계산되는데, 쿨다운(0.12초)은 바로 윗줄에서 **지금** 걸립니다.
           *     그래서 여기서 이어 구르면 0.54초짜리 연속 구르기가 0.42초가
           *     됩니다 — 설계한 것보다 빠른 회피가 조용히 생깁니다.
           *  2. **같은 규칙이 두 곳에 생깁니다.** 처형 우선순위·스태미나 문턱을
           *     Idle 과 여기 양쪽에 적으면 언젠가 한쪽만 낡습니다.
           *
           * 실제로 이어짐을 막고 있던 것은 이 자리가 아니라 `beginDodge` 가
           * **공격 선입력을 지우던 한 줄**이었습니다. 그걸 없앴으므로
           * 구르면서 눌러 둔 공격은 이제 일어나는 즉시 나갑니다.
           * 버퍼 창(0.55초)이 구르기 0.42 + 쿨다운 0.12 을 덮도록 잡힌 것도
           * 정확히 이 경로를 위해서입니다.
           */
        }
        break
      }

      /**
       * 마시는 중 — **무적 프레임이 없습니다.**
       *
       * 회피(0.42초 중 0.24초 무적)와 정반대로 설계했습니다. 회피는 "맞지 않기"
       * 위한 행동이고, 회복은 **"맞지 않을 자리를 먼저 만든 다음"** 하는
       * 행동이어야 합니다. 무적을 붙이면 회복이 곧 회피가 되어, 예고를 읽는
       * 대신 체력이 닳을 때마다 눌러 버리는 게 최적이 됩니다.
       *
       * 걸을 수는 있지만 35% 속도입니다. 완전히 못 움직이면 광역 예고
       * (🟡 4.6m)가 뜬 순간 확정으로 맞아서, 회복이 도박이 아니라 자살이 됩니다.
       */
      case ActorState.Drink: {
        Actor.timer[p] -= dt
        moveScale = VIAL.moveScale
        if (Actor.timer[p] <= 0) {
          if (Actor.phase[p] === AttackPhase.Windup) {
            Actor.phase[p] = AttackPhase.Recovery
            Actor.timer[p] = VIAL.recovery
            Health.hp[p] = Math.min(Health.max[p], Health.hp[p] + VIAL.heal)
            healEvents.push({ x: Transform.x[p], y: Transform.y[p], z: Transform.z[p], amount: VIAL.heal })
          } else {
            Actor.state[p] = ActorState.Idle
          }
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
      // **최종 방향**으로 나갑니다. 회전 중인 몸을 따라가면 궤적이 휘어서
      // beginAttack/beginSkill 이 계산해 둔 착지 지점과 어긋납니다.
      Velocity.x[p] = Math.sin(Player.faceRot[p]) * forwardOverride
      Velocity.z[p] = Math.cos(Player.faceRot[p]) * forwardOverride
    } else if (Actor.state[p] !== ActorState.Dodge) {
      /**
       * ---- 🏃 달리기 ----
       *
       * Shift 를 누르고 **움직이는 동안** 붙습니다. 조건이 둘뿐입니다:
       *   · 지금 공격/스킬 중이 아닐 것 — 휘두르면 그 순간 걷기로 돌아옵니다
       *   · 실제로 이동 입력이 있을 것 — 제자리 달리기는 없습니다
       *
       * 스태미나를 안 쓰는 이유와 배율의 근거는 balance.ts PLAYER.sprint.
       * 여기서는 **붙는 데 시간이 걸리고 끊길 때는 즉시**만 지킵니다 —
       * 공격하려는 순간 미끄러지면 조준이 어긋납니다.
       */
      const wantSprint =
        isDown('ShiftLeft') || isDown('ShiftRight')
      const canSprint = wantSprint && hasMoveInput && Actor.state[p] === ActorState.Idle
      if (canSprint) {
        Player.sprintT[p] = Math.min(PLAYER.sprint.rampUp, Player.sprintT[p] + dt)
      } else {
        Player.sprintT[p] = 0
      }
      const sprintMix = PLAYER.sprint.rampUp > 0 ? Player.sprintT[p] / PLAYER.sprint.rampUp : 0
      const sprintScale = 1 + (PLAYER.sprint.speedScale - 1) * sprintMix
      const speedCap = PLAYER.moveSpeed * weapon.moveSpeedScale * sprintScale
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
  // 강타와 처형은 **마무리**입니다. 뒤로 콤보가 이어지면 그 한 방의 무게가 사라집니다.
  if (Actor.comboIndex[p] === HEAVY_COMBO || Actor.comboIndex[p] === FINISH_COMBO) {
    Actor.state[p] = ActorState.Idle
    Actor.comboIndex[p] = 0
    Actor.bufferedAttack[p] = 0
    Actor.comboWindowT[p] = 0
    Player.focusSpent[p] = 0
    return
  }
  /**
   * ---- 콤보 도중에 적이 무너지면, 다음 타는 **처형**이 됩니다 ----
   *
   * ── 왜 이게 필요했는가 (계측이 답을 그대로 줬습니다) ──────────────
   * 처형을 넣고 재 보니 한 판에 **붕괴 43회 · 처형 0~1회** 였습니다.
   * 원인을 세어 보니 이렇게 나왔습니다:
   *
   *     처형 안내가 떠 있던 프레임 5355
   *     그중 곧바로 누를 수 있던 프레임 **31** (0.6%)
   *
   * 안내는 충분히 떠 있었습니다. **누를 수 있는 순간이 없었을 뿐입니다.**
   * 처형이 `Idle` 에서만 시작되는데, 싸우는 동안 플레이어는 거의 항상
   * 공격·후딜 중이라 Idle 인 프레임이 사실상 없습니다.
   *
   * 소울류의 리포스트도, 세키로의 인살도 이 문제를 **선입력**으로 풉니다 —
   * 휘두르는 중에 눌러 둔 것이 동작이 끝나는 순간 나갑니다. 우리에게는 이미
   * 그 버퍼가 있습니다(스킬 선입력). 콤보로 이어질 자리에서 **무방비인 적이
   * 사거리 안이면 다음 타를 처형으로 바꾸기만** 하면 됩니다.
   *
   * 그래서 새 키도, 새 상태도 늘리지 않습니다: 무너뜨린 그 손으로 이어서
   * 누르면 처형이 나갑니다.
   */
  if (
    Actor.bufferedAttack[p] === 1 &&
    Stamina.value[p] >= FINISHER.staminaCost &&
    finisherTarget(p) >= 0
  ) {
    beginAttack(p, FINISH_COMBO, aimRot)
    return
  }
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
    /**
     * ⚠️ **선입력을 지우지 않습니다.** (예전에는 지웠습니다.)
     *
     * 콤보가 바닥나는 자리(3타 무기면 3타째 뒤)에서 눌러 둔 것이 버려지면,
     * 정확히 그 순간 한 박자가 비어 **콤보를 다시 시작하려면 착지를 보고
     * 다시 눌러야** 합니다. 남겨 두면 다음 프레임 Idle 이 받아서 1타로
     * 이어집니다.
     *
     * 무한 연타가 되지 않는 이유: 입력은 `consumePress` 라 **누를 때 한 번**만
     * 잡힙니다. 꾹 눌러도 반복되지 않고, 스태미나가 그대로 문지기입니다.
     */
    Actor.comboWindowT[p] = 0
  }
}
