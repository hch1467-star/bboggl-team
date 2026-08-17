import {
  FINISH_COMBO,
  HEAVY_COMBO,
  SKILL_KEY_CODES,
  stepFor,
  RUN_COMBO,
  ROLL_COMBO,
  PLUNGE_COMBO,
  type SkillDef,
  swingPower,
} from '../config/arsenal'
import { FINISHER, FOCUS, GUARD, PLAYER, SKILL_COOLDOWN_SCALE, VIAL } from '../config/balance'
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
import { assistAim, noteFocusBurn } from './combat'
import {
  cooldownOf,
  cycleRune,
  setCooldown,
  skillForSlot,
  SLOT_COUNT,
  tickCooldowns,
  weaponOf,
} from './loadout'

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
  /**
   * @param power 이 한 방의 **무게** 0~1. 콤보 마무리·강타처럼 무거운 것일수록 1 에
   *              가깝습니다. 궤적의 색·두께·머무는 시간이 이 값으로 갈립니다.
   */
  onSwing: (
    x: number,
    z: number,
    rotY: number,
    range: number,
    arcDeg: number,
    power: number,
  ) => void
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
  runAttacks = 0
  rollAttacks = 0
  plungeAttacks = 0
  inputFlow.used = 0
  inputFlow.expiredAttack = 0
  inputFlow.expiredDodge = 0
  inputFlow.expiredSkill = 0
  inputFlow.dropped = 0
  inputFlow.waitSum = 0
  inputFlow.cancels = 0
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
/**
 * ⚔️ 상황 모션이 **실제로 나간** 횟수. 넣어 두고 안 쓰이면 다음 벤치가
 * *"효과가 없다"* 와 *"쓰이질 않았다"* 를 못 가립니다 — 취소 회피를 여덟 판
 * 돌리고 나서야 그 눈금이 없다는 걸 알았던 자리와 같은 교훈입니다.
 */
let runAttacks = 0
let rollAttacks = 0
let plungeAttacks = 0
export function readRhythm(): {
  skillCasts: number[]
  lightSwings: number
  runAttacks: number
  rollAttacks: number
  plungeAttacks: number
} {
  return {
    skillCasts: skillCasts.slice(0, SLOT_COUNT),
    lightSwings,
    runAttacks,
    rollAttacks,
    plungeAttacks,
  }
}

/**
 * ── 이어짐을 재는 눈금 ─────────────────────────────────────────────
 *
 * 선입력(버퍼)을 넣고 나서 **그것이 실제로 일하고 있는지 재는 것이 없었습니다.**
 * 이 프로젝트에서 반복해서 배운 것이 정확히 그 자리입니다 — 재지 않은
 * 변경은 개선이 아니라 희망입니다.
 *
 * "부드럽다"는 느낌말은 셀 수 없으니 **세 가지 사건**으로 나눠 셉니다:
 *
 *   · `used`    눌러 둔 것이 실제로 이어져 나갔다      ← 버퍼가 일한 횟수
 *   · `expired` 창이 지나도록 나갈 자리가 없어 버려졌다 ← 창이 짧거나 상황이 길다
 *   · `dropped` 낼 수 없어서(자원 부족) 버렸다          ← 버퍼 문제가 아님
 *
 * 셋을 갈라 두는 이유는 처방이 서로 다르기 때문입니다. `expired` 가 많으면
 * 창을 늘릴 후보이고, `dropped` 가 많으면 창이 아니라 스태미나 이야기이며,
 * 둘을 뭉쳐 놓으면 어느 쪽인지 영영 못 가립니다.
 *
 * `waitSum` 은 **누른 순간부터 나온 순간까지**의 합입니다. 평균이 0에
 * 가까우면 버퍼가 없어도 되는 상황(이미 Idle)에서만 눌렀다는 뜻이고,
 * 창 길이에 가까우면 매번 아슬아슬하게 걸리고 있다는 뜻입니다.
 *
 * ⚠️ 봇이 아니라 **게임이** 셉니다. 누른 것과 나간 것은 다릅니다.
 */
/**
 * ── ⌨️ **버려진 입력을 종류별로 셉니다** ────────────────────────────────
 *
 * 예전에는 `expired` 한 칸이었고, 거기에 **스킬·공격·구르기 셋**이 전부
 * 들어갔습니다. 벤치는 그 숫자를 찍으면서 *"크면 창(0.55초)이 짧다는
 * 뜻"* 이라고 읽는 법까지 적어 뒀는데, **셋의 처방이 서로 다릅니다**:
 *
 *   · 스킬이 버려짐   → 쿨다운·집중이 이야기입니다. 창과 무관합니다.
 *   · 구르기가 버려짐 → 스태미나 이야기입니다. 창을 늘리면 오히려
 *                       "다 떨어졌는데 뒤늦게 구르는" 그림이 됩니다.
 *   · 공격이 버려짐   → 이때만 **창 대 후딜**의 이야기입니다.
 *
 * 바로 이 파일이 무기 전환 만료를 이 칸에 안 넣으면서 그 이유를 적어
 * 뒀습니다 — *"한 칸이 두 뜻을 가지면 구분이 안 됩니다."* 그래 놓고
 * 나머지 셋은 한 칸에 담고 있었습니다. 이제 갈라 놓습니다.
 */
const inputFlow = {
  used: 0,
  expiredAttack: 0,
  expiredDodge: 0,
  expiredSkill: 0,
  dropped: 0,
  waitSum: 0,
  cancels: 0,
}
export function readInputFlow(): {
  used: number
  expired: number
  expiredAttack: number
  expiredDodge: number
  expiredSkill: number
  dropped: number
  waitAvg: number
  cancels: number
} {
  return {
    used: inputFlow.used,
    // 합계는 **여기서 한 번만** 만듭니다. 읽는 쪽마다 더하면 어느 날
    // 한 곳이 항목 하나를 빠뜨려도 아무도 모릅니다.
    expired: inputFlow.expiredAttack + inputFlow.expiredDodge + inputFlow.expiredSkill,
    expiredAttack: inputFlow.expiredAttack,
    expiredDodge: inputFlow.expiredDodge,
    expiredSkill: inputFlow.expiredSkill,
    dropped: inputFlow.dropped,
    waitAvg: inputFlow.used > 0 ? inputFlow.waitSum / inputFlow.used : 0,
    // 공격을 도중에 끊고 구른 횟수. `used` 안에 포함된 값이라 더하면 안 됩니다.
    cancels: inputFlow.cancels,
  }
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

/**
 * 🫁 **마지막으로 기력을 쓴 것이 무엇인가.**
 *
 * ── 왜 필요한가 (벤치가 네 번 같은 말을 했습니다) ────────────────────
 * `손이 묶임 — stamina` 는 벤치마다 `locked` 1위입니다(24 · 16 · 11 · 8).
 * 뜻은 *"예고를 봤는데 기력이 없어 못 굴렀다"* 인데, **누가 그 기력을
 * 썼는지**는 아무도 말해 주지 않습니다. 처방이 완전히 갈립니다:
 *
 *   · **공격**이 썼다 → 욕심입니다. 구르기 유보분(`canAffordAttack`)이
 *     막아야 하는데 뚫렸다는 뜻이라 **버그**입니다.
 *   · **구르기**가 썼다 → 겁먹고 연달아 굴렀습니다. 값이나 회복의
 *     이야기이고, 소울류에서 **정상적인 실패**이기도 합니다.
 *   · **헛친 가드**가 썼다 → 🟢 반격을 잘못 읽은 것입니다.
 *
 * 앞의 것은 고쳐야 하고 뒤의 것은 가르쳐야 합니다. 한 칸에 뭉쳐 두면
 * 어느 쪽인지 영영 모릅니다 — 이 저장소가 `못 피함` 에서 이미 겪은 일입니다.
 */
export type StaminaSpender = '공격' | '구르기' | '구르기취소' | '헛친가드' | '스킬'
let lastSpender: StaminaSpender | '' = ''
let lastSpendAt = -1
export function readLastSpender(): { what: string; at: number } {
  return { what: lastSpender, at: lastSpendAt }
}
export function resetLastSpender(): void {
  lastSpender = ''
  lastSpendAt = -1
}

function spendStamina(p: number, cost: number, by: StaminaSpender): void {
  const used = Math.min(Stamina.value[p], cost)
  staminaSpent += used
  Stamina.value[p] = Math.max(0, Stamina.value[p] - cost)
  Stamina.regenDelayT[p] = PLAYER.staminaRegenDelay
  if (used > 0) {
    lastSpender = by
    lastSpendAt = time.simElapsed
  }
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
  // 🥋 **태운 쪽이 셉니다** — 관측은 프레임 사이의 소모를 놓칩니다.
  noteFocusBurn(Player.focusSpent[p])
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
  noteLearned(index === HEAVY_COMBO ? 'heavy' : 'attack')
  /**
   * ⚠️ **여기서 직접 풀지 않습니다** — arsenal.ts `stepFor` 한 곳에서 풉니다.
   *
   * 예전엔 이 자리에 삼항 사슬이 있었고, combat.ts 에도 **다른** 사슬이
   * 있었습니다. 그래서 표식을 셋 더 넣었을 때 이쪽만 고쳐졌고, 판정은
   * 조용히 마지막 콤보 타로 나갔습니다. 같은 규칙을 두 곳에 적으면
   * 언젠가 갈라집니다 — 이번엔 "언젠가"가 이미 지나가 있었습니다.
   */
  const c = stepFor(weaponOf(p), index, Player.focusSpent[p], Player.plungeSteps[p])
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
  /**
   * 🤸 **쓰면 창을 닫습니다.** 안 닫으면 구르기 공격 뒤 0.35초 안의
   * 2타까지 구르기 공격이 되어, 한 번 구른 것으로 두 번 갚게 됩니다.
   */
  if (index === ROLL_COMBO) Player.rollAttackT[p] = 0
  if (index === PLUNGE_COMBO) Player.plungeT[p] = 0
  if (index === RUN_COMBO) runAttacks++
  else if (index === ROLL_COMBO) rollAttacks++
  else if (index === PLUNGE_COMBO) plungeAttacks++
  Actor.hitsLeft[p] = 0
  Actor.nextHitT[p] = 0
  /**
   * ── ⌨️ **눌러 둔 것이 여기서 일합니다 — 세는 곳도 여기 하나** ────────
   *
   * ── 장부가 가장 흔한 성공을 통째로 빠뜨리고 있었습니다 ──────────────
   * `inputFlow.used` 는 원래 `takeBufferedAttack()` 에서만 올랐고, 그건
   * **쉬는 자세 가지**에서만 불렸습니다. 그런데 선입력이 실제로 가장 많이
   * 일하는 자리는 거기가 아니라 **콤보 이어치기**입니다 — 후딜에서
   * `endAttack → beginAttack(next)` 로 곧바로 넘어가는 길이라 쉬는 자세를
   * 아예 거치지 않습니다. 처형(`FINISH_COMBO`)도, 스킬 후딜에서 빠져나오는
   * 길도 마찬가지였습니다.
   *
   * 그래서 벤치의 *"선입력 … 이어짐 N회 · 버려짐 26%"* 는 **성공을 거의
   * 안 세고 있었습니다.** 저는 그 26% 를 보고 "선입력 창이 짧은가 보다"를
   * 이번 회차의 출발점으로 삼았는데, **분자가 비어 있어서 커 보였을 뿐**
   * 이었습니다. 값을 손대기 전에 계기를 본 것이 다행이었습니다.
   *
   * ⚠️ 그래서 이 커밋 **이전의 선입력 숫자는 지금 것과 비교하면 안 됩니다.**
   *
   * ── 왜 하필 여기인가 ────────────────────────────────────────────
   * 버퍼가 "쓰였다"는 것은 곧 **공격이 시작됐다**는 뜻이고, 공격이 시작되는
   * 곳은 이 함수 하나입니다. 부르는 쪽마다 세면 길이 하나 늘 때마다 또
   * 빠뜨립니다 — 실제로 그렇게 빠뜨렸습니다.
   *
   * 자기 버퍼만 씁니다 — 구르기 선입력은 남겨 둡니다(후딜에서 구르기로
   * 빠질 수 있게).
   */
  if (Actor.bufferedAttack[p] === 1) {
    inputFlow.used++
    // 기다린 시간은 남은 창에서 거꾸로 나옵니다(`창 − 남은 시간`).
    inputFlow.waitSum += BUFFER_TIME - Actor.bufferedAttackT[p]
  }
  Actor.bufferedAttack[p] = 0
  Actor.bufferedAttackT[p] = 0
  spendStamina(p, c.staminaCost, '공격')
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
  // 환급은 **시전 하나에 한 번**입니다(components.ts counterRefunded 설계 노트).
  Player.counterRefunded[p] = 0
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
/**
 * ── 실제로 **해낸** 동작들 ─────────────────────────────────────
 *
 * 화면 아래 조작표는 그 동작을 해내면 한 줄씩 사라집니다(hud.ts markLearned).
 * 여기서 모으는 이유는 하나입니다 — **키를 누른 것이 아니라 동작이 일어난
 * 것**을 세야 하기 때문입니다. 기력이 없어 구르기가 안 나갔는데 안내가
 * 사라지면, 못 배운 채로 안내만 잃습니다. 그래서 입력 처리 자리가 아니라
 * **동작이 실제로 시작되는 자리**에서 표시합니다.
 */
const learnedActions = new Set<string>()

/** 조준이 돌아간 누적 각도 — 위 `aim` 판정용. */
let aimTurned = 0
let lastAimRot = 0

function noteLearned(id: string): void {
  learnedActions.add(id)
}

/** 이번 프레임까지 해낸 동작들. 게임 루프가 읽어 HUD·세이브로 넘깁니다. */
export function readLearnedActions(): string[] {
  return [...learnedActions]
}

/** 세이브에서 읽은 것을 되살립니다(다시 열었을 때 안내가 되돌아오지 않게). */
export function restoreLearnedActions(ids: readonly string[]): void {
  for (const id of ids) learnedActions.add(id)
}

function beginDrink(p: number): void {
  noteLearned('vial')
  Actor.state[p] = ActorState.Drink
  Actor.phase[p] = AttackPhase.Windup
  Actor.timer[p] = VIAL.windup
  Actor.bufferedAttack[p] = 0
  Actor.bufferedAttackT[p] = 0
  Actor.comboIndex[p] = 0
  Player.vials[p] = Math.max(0, Player.vials[p] - 1)
  sfx.cast(0)
}

/**
 * 🛡 **지금 저스트 가드를 낼 수 있는가.**
 *
 * ── 왜 함수로 빼는가 ────────────────────────────────────────────────
 * 봇이 이 조건을 **자기 쪽에서 다시 세우려다** 문제가 드러났습니다. 봇은
 * 대부분 공격·접근 중인데 가드는 서 있을 때(Idle)와 **후딜**에서만 열립니다.
 * 그래서 봇이 눌러도 대부분 거절당했고, 한 판에서 성공이 **1회**였습니다.
 *
 * 조건을 봇이 베끼면 여는 자리를 바꾸는 날 봇만 옛 규칙을 씁니다. 그러면
 * 봇은 **게임이 아닌 것**을 재게 되고, 그 숫자로 밸런스를 고칩니다.
 * 그래서 판단은 여기 한 곳에 두고 `guardInfo().canGuard` 로 내보냅니다.
 *
 * **여는 자리를 좁게 잡은 근거**(위 설계 노트와 같음): 예고·판정 중에도
 * 열리면, 구르기 취소(기력 45)를 내야 하는 자리를 가드가 **공짜로**
 * 빠져나갑니다. 두 탈출구의 값이 다르면 싼 쪽만 쓰입니다.
 */
export function canGuardNow(p: number): boolean {
  if (Player.guardLockT[p] > 0 || Player.guardT[p] > 0) return false
  const st = Actor.state[p] as ActorState
  if (st === ActorState.Idle) return true
  if (st !== ActorState.Attack && st !== ActorState.Skill) return false
  // 후딜에서는 공짜입니다.
  if (Actor.phase[p] === AttackPhase.Recovery) return true
  /**
   * 예고·판정 중(=커밋 중)에도 열 수 있되 **기력을 냅니다.**
   * 근거와 값은 balance.ts `GUARD.commitCost` — 구르기 취소와 같은 계약입니다.
   */
  return Stamina.value[p] >= GUARD.commitCost
}

/** 지금 창을 여는 것이 **커밋을 뚫고 나가는 것**인가(= 값을 내야 하는가). */
export function guardOpenCost(p: number): number {
  const st = Actor.state[p] as ActorState
  const swinging =
    (st === ActorState.Attack || st === ActorState.Skill) &&
    Actor.phase[p] !== AttackPhase.Recovery
  return swinging ? GUARD.commitCost : 0
}

/**
 * 🤸 **지금 구르기가 막혀 있다면, 무엇이 막고 있는가.** 빈 문자열이면 낼 수 있습니다.
 *
 * ── 왜 함수로 빼는가 ────────────────────────────────────────────────
 * 이 판단이 **두 곳에** 따로 적혀 있었습니다. 시스템 쪽 `canDodge` 와
 * main.ts 의 `answerBlock`(맞은 이유 장부)이 각자 비용식을 다시 썼습니다.
 * 이 저장소가 이번 세션에만 세 번 데인 자리입니다 — 장부가 둘이면 **규칙을
 * 고친 날 장부 하나만 따라오고**, 그 뒤로는 두 숫자가 영영 안 맞습니다.
 * (연계 예약/발동이 정확히 그렇게 어긋나 있었습니다.)
 *
 * 그래서 규칙은 여기 한 곳에 두고, 장부와 봇은 **읽기만** 합니다.
 *
 * ⚠️ **순서가 곧 처방입니다.** 굳어서 못 낸 것과 내가 다 써서 못 낸 것은
 *    책임이 반대이므로 앞선 실패를 적습니다(main.ts `answerBlock` 주석).
 */
export type DodgeBlock = '' | 'dead' | 'stagger' | 'drink' | 'cooldown' | 'stamina'

export function dodgeBlock(p: number): DodgeBlock {
  const st = Actor.state[p] as ActorState
  if (st === ActorState.Dead) return 'dead'
  if (st === ActorState.Stagger) return 'stagger'
  if (st === ActorState.Drink) return 'drink'
  if (Player.dodgeCooldownT[p] > 0) return 'cooldown'
  const swinging =
    (st === ActorState.Attack || st === ActorState.Skill) &&
    Actor.phase[p] !== AttackPhase.Recovery
  if (swinging) {
    /**
     * 휘두름을 **끊고** 구르는 길은 예전 그대로 `>= 비용` 입니다.
     * 근거는 balance.ts `cancelExtraCost` — 공짜로 끊으면 판단이 아니라
     * 그냥 버튼이 됩니다. 새 규칙(빚)은 여기에 **일부러** 안 옵니다.
     */
    const cancel =
      PLAYER.dodge.staminaCost * (weaponOf(p).dodgeCostScale ?? 1) + PLAYER.dodge.cancelExtraCost
    return Stamina.value[p] >= cancel ? '' : 'stamina'
  }
  /**
   * 평상시 구르기(서 있을 때·후딜)는 **비용 이상**이어야 합니다.
   *
   * ⚠️ 여기를 *"0보다 큼"* 으로 바꿔 본 적이 있습니다(소울류의 실제 규칙).
   *    봇이 판당 42회를 빚내며 영구 파산했고 받은 피해가 162 → 280 으로
   *    늘어 **되돌렸습니다**(DESIGN.md). 고친 것은 문턱이 아니라 값입니다
   *    — balance.ts `dodge.staminaCost` 25 → 18.
   */
  const cost = PLAYER.dodge.staminaCost * (weaponOf(p).dodgeCostScale ?? 1)
  return Stamina.value[p] >= cost ? '' : 'stamina'
}

/**
 * ── 🛡 **공격은 구르기 한 번 분을 남기고 멈춥니다** ───────────────────
 *
 * ── 벤치가 찍은 것 ──────────────────────────────────────────────────
 *     맞은 이유  109대 · 못 피함 78(72%) · 손이 묶임 — stamina 28
 *     grunt_sweep  예고 1.816초 · **보인 1.283초** · 자유 0.033초
 *     charger_rush 예고 1.45초  · 보인 1.45초   · 자유 0초
 *     회피 못 낼 때 48%
 *
 * 예고를 1.28초나 **보고도** 답할 자유가 0.03초입니다. 못 본 게 아니라
 * **손이 묶인** 것입니다. 교전 시간의 절반에서 구를 수가 없었습니다.
 *
 * ── 왜 이 손잡이인가 (앞의 둘은 이미 해 봤습니다) ────────────────────
 * 이 자리에서 두 번 싸웠고 둘 다 **방어를 싸게 만드는 쪽**이었습니다:
 *   · 구르기 값 25 → 18 (balance.ts) — 나아졌지만 28대가 남았습니다
 *   · 문턱을 *"0보다 크면"* 으로 (엘든 링의 실제 규칙) — 봇이 판당 42회를
 *     빚내며 파산, 받은 피해 162 → 280 으로 **더 나빠져 되돌렸습니다**
 *
 * 반대편은 한 번도 안 건드렸습니다: **공격이 회피 몫까지 다 써 버리는 것.**
 * 롱소드 콤보는 10 · 11 · 17, 구르기는 18입니다. 기력 20에서 11짜리를
 * 내면 9가 남아 **구를 수 없고**, 18까지 돌아오는 데 0.81초(딜레이 0.55 +
 * 회복 34/초)가 걸립니다. 잡몹 예고가 0.6~2초이니 **공격 한 번이 답할
 * 창을 통째로 먹습니다.** 위 세 줄이 정확히 그 장면입니다.
 *
 * 참고한 게임 셋이 전부 같은 방향입니다 — 세키로는 쳐내기에 자원을 안
 * 걸고, 로스트아크는 회피를 **별도 쿨다운**으로 빼 두었고, 엘든 링은
 * 기력이 0보다 크기만 하면 구르게 합니다. 방식은 다르지만 약속은 하나입니다:
 * **탈출 수단이 공격 때문에 막히지는 않는다.**
 *
 * 앞의 두 시도와 다른 점: 저 둘은 **방어를 무제한으로** 만들어 파산을
 * 불렀습니다. 이건 방어의 몫을 그대로 두고 **공격이 그 몫을 못 건드리게**
 * 합니다. 빚이 생길 수 없습니다 — 못 내면 그냥 안 나갑니다.
 *
 * ⚠️ 구르기 자신은 이 유보분을 **씁니다.** 안 그러면 남겨 둔 몫을 아무도
 *    못 쓰는 죽은 숫자가 되고, 최대 기력만 18 줄인 것과 같아집니다.
 *
 * ⚠️ **한 곳에서만 판단합니다.** 공격이 기력을 확인하던 자리가 여섯
 *    군데였습니다(평타·강타·처형·콤보 연결·스킬 후딜 탈출 둘). 오늘
 *    같은 모양으로 두 번 당했습니다 — 출혈이 배율을 비켜 갔고, 콤보
 *    해석이 세 곳에 흩어져 있었습니다. 조건을 베끼지 않고 부릅니다.
 */
export function canAffordAttack(p: number, cost: number): boolean {
  const reserve = PLAYER.dodge.staminaCost * (weaponOf(p).dodgeCostScale ?? 1)
  return Stamina.value[p] >= cost + reserve * PLAYER.dodge.reserveMult
}

/**
 * ⚔️ **지금 기본 공격을 누르면 무엇이 나가는가.**
 *
 * ── 왜 함수로 빼는가 ────────────────────────────────────────────────
 * 이 판단이 필요한 곳이 셋입니다 — 실제로 공격을 시작하는 자리 둘(Idle ·
 * 후딜 탈출)과, **HUD·프로브가 읽는 자리**. 세 곳에 조건을 베끼면 상황을
 * 하나 더 넣는 날 두 곳만 따라옵니다. 이 저장소가 이번 세션에만 세 번
 * 데인 자리입니다(구르기 비용 · 연계 장부 · 가드 키).
 *
 * ⚠️ **순서가 곧 규칙입니다.** 구르기 직후가 달리기보다 앞섭니다 —
 *    구르며 이동 입력을 유지한 채 달리는 중일 수 있고, 그때 사람이
 *    기대하는 것은 *"방금 굴러 넘겼으니 갚는다"* 이지 돌진이 아닙니다.
 */
export function contextComboIndex(p: number, sprinting: boolean): number {
  /**
   * 🪂 **떨어진 직후가 가장 앞섭니다.** 창이 제일 짧고(0.28초) 가장
   * 구체적인 상황입니다 — 구르며 떨어졌든 달리다 떨어졌든, 방금 뛰어내린
   * 사람이 기대하는 것은 **내려찍기**입니다.
   */
  if (Player.plungeT[p] > 0) return PLUNGE_COMBO
  if (Player.rollAttackT[p] > 0) return ROLL_COMBO
  if (sprinting) return RUN_COMBO
  return 0
}

/** 지금 달리는 중인가 — 규칙을 프로브·HUD가 베끼지 않게 게임이 압니다. */
export function isSprinting(p: number): boolean {
  return Player.sprintT[p] >= PLAYER.sprint.rampUp
}

function beginDodge(p: number, dirX: number, dirZ: number): void {
  noteLearned('dodge')
  Actor.state[p] = ActorState.Dodge
  // 무기마다 구르는 시간이 다릅니다 — 거리는 같고 속도만(arsenal.ts 설계 노트).
  Actor.timer[p] = PLAYER.dodge.duration * (weaponOf(p).dodgeDurationScale ?? 1)
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
  spendStamina(p, PLAYER.dodge.staminaCost * (weaponOf(p).dodgeCostScale ?? 1), '구르기')
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
  // ⌨️ 키는 balance.ts 에만 적혀 있습니다 — 프로브·봇이 `dodgeInfo().key` 로 따라옵니다.
  const dodgePressed = consumePress(PLAYER.dodge.key)
  /**
   * 🛡 **저스트 가드 — `Z`.**
   *
   * 왜 새 키인가: 기본 공격(좌클릭)·강타(우클릭)·구르기(Space)·스킬(QERFG)이
   * 이미 차 있고, 가드는 **다른 답**이므로 다른 키여야 합니다. 처형처럼
   * 기존 키에 얹으면 *"지금 누른 게 무엇이 될지"* 를 상황이 정하게 되는데,
   * 그건 0.18초 창을 노리는 입력에는 최악입니다.
   *
   * ⚠️ **처음에 `V` 로 만들었다가 옮겼습니다.** V 는 이 게임에서
   *    *"이 자리에서 할 수 있는 일"* 하나로 묶인 **맥락 키**입니다
   *    (사다리 내리기 · 화톳불에서 성수병 강화 — main.ts 설계 노트).
   *    거기에 **항상 켜져 있는 전투 동사**를 얹으니 이런 일이 났습니다:
   *
   *      · 봇이 사다리를 내리려고 V 를 누름 → 가드가 그 입력을 먼저 소비
   *      · 사다리는 안 내려감 → 봇이 다시 누름 → **90프레임 무한 반복**
   *      · 매 번 창이 열렸다 헛침 → **기력 18씩 소모 → 0**
   *
   *    세 판 연속 같은 자리에서 같은 모양으로 갇혔습니다. 맥락 키와 상시
   *    키는 **절대 같은 키를 쓰면 안 됩니다** — 맥락 키는 "그 자리에서만"
   *    이라는 전제로 겹침을 허용하는데, 상시 키는 그 전제를 깹니다.
   *
   * 선입력을 안 겁니다(공격·구르기·스킬과 다릅니다). 가드는 **누른 그 순간
   * 부터** 창이 열리는 것이 규칙이라, 버퍼에 넣어 나중에 여는 순간
   * *"내가 언제 눌렀는지"* 와 *"언제 열렸는지"* 가 어긋납니다 — 타이밍 기술의
   * 판정을 게임이 대신 흔드는 셈입니다.
   */
  const guardPressed = consumePress(GUARD.key)
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
     * ── ⌨️ **손이 묶여 있는 동안에는 창이 흐르지 않습니다** ──────────────
     *
     * ── 여기 있던 구멍 ──────────────────────────────────────────────
     * 선입력 창은 0.55초 고정이고, **동작 중에도 계속 줄어듭니다.** 그런데
     * 실제 후딜은 그보다 긴 것이 있습니다:
     *
     *     강타 1.12초 · 처형 · 낙하 공격
     *
     * 그러면 강타를 내고 곧바로 누른 다음 공격이 **후딜이 끝나기도 전에
     * 만료됩니다.** 플레이어에게는 "무거운 무기는 자꾸 씹힌다"로 옵니다.
     * `npm run feel` 이 실제로 그렇게 찍었습니다 — 버려진 순간의 상태가
     * 셋 다 `공격/후딜` 이었습니다.
     *
     * ── 창을 늘리지 않고 **멈춥니다** ────────────────────────────────
     * 창을 1.2초로 늘리는 길도 있었지만, 이 파일이 만료를 둔 이유가 바로
     * *"2초 전에 누른 것이 뜬금없이 튀어나오면 안 된다"* 입니다. 창을
     * 늘리면 그 위험이 **모든 상황에서** 커집니다.
     *
     * 위험이 실제로 있는 구간은 **손이 빈 뒤**입니다 — 낼 수 있는데 안 내고
     * 있다가 뒤늦게 나가는 것. 반대로 **내가 고른 동작이 끝나기를 기다리는
     * 동안**은, 눌러 둔 것이 살아 있는 것이 정확히 플레이어의 뜻입니다.
     * 그래서 창은 손이 빈 다음부터 흐릅니다. (세키로의 인살 뒤, 오공의
     * 봉세 한 방 뒤에 눌러 둔 입력이 동작이 끝나는 순간 나가는 것과 같은
     * 계약입니다.)
     *
     * ⚠️ **경직은 여기 없습니다.** 맞아서 못 움직이는 것은 "내가 고른 동작"이
     *    아닙니다 — 그건 combat.ts 가 이미 버퍼를 비웁니다. 둘을 같이 묶으면
     *    한 대 맞고 일어나면서 안 누른 칼이 나갑니다.
     */
    const handsBusy =
      Actor.state[p] === ActorState.Attack ||
      Actor.state[p] === ActorState.Skill ||
      Actor.state[p] === ActorState.Dodge
    const bufferDt = handsBusy ? 0 : dt

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
      Actor.bufferedSkillT[p] = Math.max(0, Actor.bufferedSkillT[p] - bufferDt)
      if (Actor.bufferedSkillT[p] === 0) {
        Actor.bufferedSkill[p] = 0
        inputFlow.expiredSkill++
      }
    }
    /**
     * 🗡 **무기 전환도 같은 자리에서 같은 방식으로** 기억합니다.
     *
     * 예전에는 이것만 규칙 밖이었습니다 — 프레임 첫머리에서 키를 소비해
     * 놓고 `if (idle && ...)` 로 걸러서, **휘두르는 중에 누른 전환은
     * 통째로 사라졌습니다.** 무기 셋을 준 게임에서 전환이 *"완전히 멈출
     * 때까지 기다렸다가 정확히 누르는 것"* 이면, 그건 이 파일이 스킬
     * 버퍼에 이미 적어 둔 문장 그대로 **조작이 아니라 눈치싸움**입니다.
     *
     * ⚠️ **취소가 아닙니다.** 후딜을 끊어 주는 것이 아니라, 눌러 둔 것이
     *    살아남아 **동작이 끝난 뒤에** 적용될 뿐입니다. 후딜은 휘두른
     *    대가이고 그건 규칙입니다 — 여기서 끊어 주면 템포 설계가 통째로
     *    무너집니다(대검을 아무 대가 없이 쓰게 됩니다).
     *
     * 만료를 두는 이유도 같습니다: 2초 전에 누른 전환이 뒤늦게 적용되면
     * **엉뚱한 무기를 든 채로** 다음 싸움이 시작됩니다.
     */
    if (weaponPressed >= 0) {
      Actor.bufferedWeapon[p] = weaponPressed + 1
      Actor.bufferedWeaponT[p] = BUFFER_TIME
    } else if (Actor.bufferedWeaponT[p] > 0) {
      Actor.bufferedWeaponT[p] = Math.max(0, Actor.bufferedWeaponT[p] - bufferDt)
      /**
       * ⚠️ 만료를 `inputFlow.expired` 에 **안 더합니다.**
       *
       * 그 눈금은 *"내려던 공격이 버려졌다"* 를 세는 자리이고, 벤치가
       * 그 숫자로 선입력 창을 판단합니다. 무기 전환 만료를 같이 넣으면
       * 한 칸이 두 뜻을 갖게 되어, 창을 늘려야 하는지 전환을 덜 눌렀는지
       * 구분이 안 됩니다. 이 저장소가 `locked` 한 칸에 원인 셋을 담았다가
       * 뜻이 뒤집힌 적이 있습니다 — 같은 실수를 안 합니다.
       */
      if (Actor.bufferedWeaponT[p] === 0) Actor.bufferedWeapon[p] = 0
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
      Actor.bufferedAttackT[p] = Math.max(0, Actor.bufferedAttackT[p] - bufferDt)
      if (Actor.bufferedAttackT[p] === 0) {
        Actor.bufferedAttack[p] = 0
        inputFlow.expiredAttack++
      }
    }
    if (dodgePressed) {
      Actor.bufferedDodge[p] = 1
      Actor.bufferedDodgeT[p] = BUFFER_TIME
    } else if (Actor.bufferedDodgeT[p] > 0) {
      Actor.bufferedDodgeT[p] = Math.max(0, Actor.bufferedDodgeT[p] - bufferDt)
      if (Actor.bufferedDodgeT[p] === 0) {
        Actor.bufferedDodge[p] = 0
        inputFlow.expiredDodge++
      }
    }

    // ---- 타이머 ----
    tickCooldowns(p)
    if (dt > 0) {
      Player.dodgeCooldownT[p] = Math.max(0, Player.dodgeCooldownT[p] - dt)
      /**
       * 완벽 회피 확정 치명타 창.
       *
       * 여기서 깎습니다 — 쿨다운·기력과 **같은 자리**입니다. 시간이 흐르는
       * 값은 한 곳에서 다 흐르게 두어야, 나중에 "왜 이건 안 줄지?"를
       * 찾으러 파일을 뒤지지 않습니다. 소비는 combat.ts 가 합니다(때린 쪽이
       * 판정을 아는 유일한 자리라서).
       */
      Player.perfectCritT[p] = Math.max(0, Player.perfectCritT[p] - dt)
      /**
       * 🛡 저스트 가드의 두 타이머도 **같은 자리**에서 흐릅니다.
       *
       * 창이 닫히는 그 프레임에 **잠김을 겁니다** — 헛친 것이기 때문입니다.
       * (막았으면 combat.ts 가 이미 `guardT` 를 0으로 지웠으므로 여기 안 옵니다.
       *  지웠는지 아닌지로 성공/실패가 갈리므로, 깃발을 따로 두지 않습니다.)
       */
      if (Player.guardT[p] > 0) {
        Player.guardT[p] = Math.max(0, Player.guardT[p] - dt)
        if (Player.guardT[p] === 0) {
          Player.guardLockT[p] = GUARD.whiffLock
          /**
           * 🛡 헛친 벌은 **구르기 한 번 분 위에서만** 깎습니다
           * (balance.ts `whiffKeepsDodge` — 근거는 그 주석에).
           * 벌은 그대로 두되, 다음 예고에 답할 수단까지 가져가지 않습니다.
           */
          {
            const keep = GUARD.whiffKeepsDodge
              ? PLAYER.dodge.staminaCost * (weaponOf(p).dodgeCostScale ?? 1)
              : 0
            const room = Math.max(0, Stamina.value[p] - keep)
            spendStamina(p, Math.min(GUARD.whiffStamina, room), '헛친가드')
          }
          sfx.deny()
        }
      }
      Player.guardLockT[p] = Math.max(0, Player.guardLockT[p] - dt)
      // 🤸 구르기 공격 창. 구르는 **동안**은 안 깎습니다 — 창은 끝난 뒤에 엽니다.
      if (Actor.state[p] !== ActorState.Dodge) {
        Player.rollAttackT[p] = Math.max(0, Player.rollAttackT[p] - dt)
      }
      /**
       * 🪂 낙하 창도 **착지 경직 동안은 안 깎습니다.**
       *
       * 이게 없으면 창이 열려도 못 씁니다. 착지 경직(`hurtStagger` 0.28초)이
       * 낙하 창(`plungeWindow` 0.28초)과 같은 길이라, 손이 풀리는 순간
       * 창도 같이 닫힙니다 — 열어 두고 못 쓰게 만드는 셈입니다.
       * 구르기 창과 **같은 규칙**을 씁니다: 창은 몸이 자유로울 때만 흐른다.
       */
      if (Actor.state[p] !== ActorState.Stagger) {
        Player.plungeT[p] = Math.max(0, Player.plungeT[p] - dt)
      }
      if (Stamina.regenDelayT[p] > 0) {
        Stamina.regenDelayT[p] = Math.max(0, Stamina.regenDelayT[p] - dt)
      } else if (Stamina.value[p] < Stamina.max[p]) {
        Stamina.value[p] = Math.min(Stamina.max[p], Stamina.value[p] + PLAYER.staminaRegen * dt)
      }
    }

    const idle = Actor.state[p] === ActorState.Idle

    // ---- 장비 교체 — **눌러 둔 것을 동작이 끝난 뒤에** 적용합니다 ----
    const wantWeapon = Actor.bufferedWeapon[p] - 1
    if (idle && wantWeapon >= 0 && wantWeapon < WEAPONS.length) {
      // **실제로 바뀐 때만** 셉니다 — 들고 있는 무기 키를 다시 눌러도
      // 아무 일이 안 일어나고, 그건 배운 것이 아닙니다.
      if (Loadout.weapon[p] !== wantWeapon) noteLearned('weapon')
      Loadout.weapon[p] = wantWeapon
      Actor.comboIndex[p] = 0
      ctx.onLoadoutChange()
      Actor.bufferedWeapon[p] = 0
      Actor.bufferedWeaponT[p] = 0
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
    if (hasMoveInput) noteLearned('move')
    if (hasMoveInput) {
      mx /= mLen
      mz /= mLen
    }

    // ---- 조준 ----
    /**
     * 조준은 "눌렀는가"로 못 셉니다 — 마우스는 가만 둬도 움직입니다.
     * 그래서 **바라보는 방향이 실제로 크게 바뀌었는지**를 누적해서 봅니다.
     * 반 바퀴(180°)를 돌렸으면 조준이 무엇인지 알게 된 것으로 봅니다.
     */
    const aimDx = ctx.aimX - Transform.x[p]
    const aimDz = ctx.aimZ - Transform.z[p]
    const aimRot = Math.hypot(aimDx, aimDz) > 0.05 ? Math.atan2(aimDx, aimDz) : Transform.rotY[p]
    if (!learnedActions.has('aim')) {
      let d = aimRot - lastAimRot
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      aimTurned += Math.abs(d)
      lastAimRot = aimRot
      if (aimTurned > Math.PI) noteLearned('aim')
    }

    /**
     * ⚠️ 이 자리는 **평상시 구르기**(서 있을 때·후딜)의 문입니다. 휘두름을
     *    끊는 길은 `tryDodgeCancel` 이 따로 지킵니다. 그래서 `dodgeBlock` 의
     *    커밋 분기가 아니라 평상시 분기를 보게 상태를 그대로 넘깁니다 —
     *    규칙은 그 함수 한 곳에만 있습니다.
     */
    const canDodge = dodgeBlock(p) === ''
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
    /**
     * 기다린 시간을 위한 필드를 따로 두지 않습니다 — **남은 창에서 거꾸로**
     * 나옵니다(`창 − 남은 시간`). 누른 프레임에는 남은 시간이 곧 창이라 0이고,
     * 늦게 나갈수록 커집니다. 같은 뜻의 숫자를 두 곳에 두면 한쪽만 낡습니다.
     */
    const takeBufferedDodge = (): boolean => {
      if (Actor.bufferedDodge[p] !== 1) return false
      inputFlow.used++
      inputFlow.waitSum += BUFFER_TIME - Actor.bufferedDodgeT[p]
      Actor.bufferedDodge[p] = 0
      Actor.bufferedDodgeT[p] = 0
      return true
    }

    /** 지금 이 자리에서 구르면 어디로 구를지. 이동 입력이 없으면 등 뒤로. */
    const dodgeDir = (): [number, number] =>
      hasMoveInput ? [mx, mz] : [-Math.sin(Transform.rotY[p]), -Math.cos(Transform.rotY[p])]

    /**
     * 🥋 **공격 취소 회피** — 선행동작/판정 중에 굴러 빠져나갑니다.
     *
     * 지금까지 규칙은 "휘두르기 시작하면 후딜까지 못 뺀다"였습니다. 커밋을
     * 지키자는 뜻은 옳았지만, 실제로 일어나는 일은 **예고를 봤는데 몸이
     * 안 움직이는 것**이었습니다. 위키드·소울류가 이걸 푸는 방식은 취소를
     * 막는 게 아니라 **값을 매기는 것**입니다: 나갈 수는 있되, 나가면
     * 다음 한 번을 못 나갑니다.
     *
     * 그래서 무적이 아니라 **기력**으로 막습니다. 25(기본) + 20(추가) = 45 —
     * 최대 기력의 거의 절반이라 연속 두 번은 불가능하고, 취소하고 나면
     * 다음 구르기까지 회복을 기다려야 합니다. 즉 "실수 한 번은 되돌릴 수
     * 있지만, 되돌리는 것을 전략으로 쓸 수는 없다"가 됩니다.
     *
     * 후딜 탈출은 여기 해당하지 않습니다 — 그건 이미 휘두름이 끝난 뒤라
     * 취소할 게 없고, 예전처럼 기본 값 그대로입니다(아래 Recovery 분기).
     */
    const cancelCost =
      PLAYER.dodge.staminaCost * (weaponOf(p).dodgeCostScale ?? 1) + PLAYER.dodge.cancelExtraCost
    const tryDodgeCancel = (): boolean => {
      if (Actor.bufferedDodge[p] !== 1) return false
      // 쿨다운은 그대로 지킵니다 — 기력만 있으면 무한히 구르는 길이 되면 안 됩니다.
      if (Player.dodgeCooldownT[p] > 0) return false
      /**
       * 기력이 모자라면 **버퍼를 그대로 둡니다.** 지우면 조금 뒤 후딜에서
       * 나갈 수 있었던 구르기가 사라집니다 — takeBufferedSkill 이 경고하는
       * 것과 똑같은 함정입니다. 못 나가면 그냥 취소가 아닌 게 될 뿐입니다.
       */
      if (Stamina.value[p] < cancelCost) return false
      takeBufferedDodge()
      // 추가분만 여기서, 기본분은 beginDodge 가 무기 배율까지 얹어 뺍니다.
      spendStamina(p, PLAYER.dodge.cancelExtraCost, '구르기취소')
      const [dx, dz] = dodgeDir()
      beginDodge(p, dx, dz)
      inputFlow.cancels++
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

    /**
     * ── 🛡 **저스트 가드** ──────────────────────────────────────────
     *
     * 상태 기계 **밖**에서 처리합니다. 가드는 자리를 지키는 답이라
     * 이동·조준을 멈출 이유가 없고, 상태로 만들면 그 프레임 동안 다른 것이
     * 전부 멈춰서 「누르고 서 있기」가 됩니다(components.ts `guardT` 노트).
     *
     * **열 수 있는 자리**를 좁게 잡습니다 — 서 있을 때(Idle)와 동작의
     * **후딜**뿐입니다. 예고·판정 중에도 열리게 하면, 구르기 취소(기력 45)를
     * 내야 하는 자리를 가드가 **공짜로** 빠져나가게 됩니다. 두 탈출구의
     * 값이 다르면 싼 쪽만 쓰입니다.
     *
     * 잠긴 동안(`guardLockT`)은 아무것도 못 합니다 — 헛친 값입니다.
     */
    const guardLocked = Player.guardLockT[p] > 0
    if (guardLocked) moveScale = Math.min(moveScale, 0.25)
    if (guardPressed && !guardLocked && Player.guardT[p] <= 0) {
      if (canGuardNow(p)) {
        // 커밋을 뚫고 여는 것이면 여기서 값을 냅니다(서서 내면 0).
        const cost = guardOpenCost(p)
        if (cost > 0) spendStamina(p, cost, '스킬')
        Player.guardT[p] = GUARD.window
        noteLearned('guard')
        sfx.cast(1)
      } else {
        // 조용히 무시하면 "키가 씹혔나"와 구분이 안 됩니다 — 성수병·강타와 같은 규칙.
        sfx.deny()
      }
    }

    switch (Actor.state[p] as ActorState) {
      case ActorState.Idle: {
        // 🛡 헛친 가드로 굳어 있는 동안은 아무것도 못 합니다(위 설계 노트).
        if (guardLocked) break
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
          if (Player.focus[p] >= 1 && canAffordAttack(p, FOCUS.heavy.staminaCost)) {
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
          if (fin >= 0 && canAffordAttack(p, FINISHER.staminaCost)) {
            // 버퍼를 여기서 꺼내지 않습니다 — `beginAttack` 이 쓰고 셉니다.
            beginAttack(p, FINISH_COMBO, aimRot)
            break
          }
          if (canAffordAttack(p, weapon.combo[0].staminaCost)) {
            // ⚔️ 상황이 모션을 고릅니다 — 판단은 `contextComboIndex` 한 곳에만.
            beginAttack(p, contextComboIndex(p, isSprinting(p)), aimRot)
            break
          }
        }
        /**
         * **거절음.** 지금까지 스태미나가 모자라면 아무 일도 안 일어났습니다.
         * 초보자에게는 "키가 안 먹혔나?"와 구분이 되지 않습니다.
         * 짧은 저음 하나로 "입력은 됐고, 지금은 자원이 없다"가 됩니다.
         * — 스태미나가 자원으로 작동하려면 **바닥났다는 사실이 들려야** 합니다.
         */
        /**
         * ── 못 낸 입력에 어떻게 답할 것인가 ──────────────────────────
         *
         * ⚠️ 여기서 **버퍼를 버렸다가 되돌렸습니다.** 처음엔 "낼 수 없는
         * 입력은 버린다"고 적고 지웠는데, 그러면 제가 만든 연속 구르기가
         * 그대로 막힙니다:
         *
         *   구르기가 끝나는 순간 쿨다운(0.12초)이 걸립니다 → 다음 프레임의
         *   `canDodge` 가 거짓 → 눌러 둔 구르기가 **거절음과 함께 버려짐**
         *
         * 창 0.55초를 `구르기 0.42 + 쿨다운 0.12 = 0.54` 를 덮으라고 잡아
         * 놓고, 정작 그 0.12초를 못 넘기고 지우고 있었습니다. 바로 위
         * `takeBufferedSkill` 주석이 같은 함정을 이미 적어 뒀습니다 —
         * *"쿨다운이라 못 쓴 것을 지워버리면, 쿨이 0.1초 뒤에 도는 흔한
         * 경우에 또 입력이 사라집니다."* 스킬에는 지킨 규칙을 구르기·공격에는
         * 안 지켰습니다.
         *
         * 그래서 **버리지 않고 거절음만 한 번** 냅니다. "한 번 누른 것에
         * 한 번 답한다"는 원래 의도는 그대로이고, 창이 남아 있는 동안
         * 자원이나 쿨다운이 회복되면 그때 나갑니다.
         *
         * 누른 그 프레임인지는 **남은 창**으로 압니다 — 누른 순간에만
         * 남은 시간이 창 전체와 같습니다. 새 필드를 만들지 않습니다.
         */
        const justPressed =
          (dodgeQueued && Actor.bufferedDodgeT[p] >= BUFFER_TIME - 0.0001) ||
          (attackQueued && Actor.bufferedAttackT[p] >= BUFFER_TIME - 0.0001)
        if (justPressed) {
          sfx.deny()
          // 누른 순간에 못 낸 것 — 버린 게 아니라 **그때 못 낸 것**입니다.
          // 창이 남아 있으므로 뒤에 나갈 수도 있고, 그러면 `used` 로도 세어집니다.
          // 두 칸이 겹치므로 합계가 누른 횟수와 같지 않습니다(보고에 적어 둡니다).
          inputFlow.dropped++
        }
        turnToward(p, aimRot, PLAYER.turnSpeedDeg, dt)
        break
      }

      case ActorState.Attack: {
        // 선입력은 위(공용 장부)에서 이미 기억했습니다 — 여기서 또 세우면
        // 상태마다 규칙이 갈립니다.
        moveScale = weapon.attackMoveScale

        /**
         * ⚠️ **같은 사슬의 세 번째 사본이었습니다.** 여기는 판정·후딜 길이를
         * 읽는 자리라, 상황 모션이 빠져 있으면 낙하 공격의 늘린 후딜
         * (1.25배)도 구르기 공격의 줄인 선행동작도 실제로는 안 나옵니다.
         * 이제 셋 다 `stepFor` 하나를 봅니다.
         */
        const combo = stepFor(
          weapon,
          Actor.comboIndex[p],
          Player.focusSpent[p],
          Player.plungeSteps[p],
        )
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
        } else if (tryDodgeCancel()) {
          // 선행동작·판정 중 취소 회피. 값은 위 tryDodgeCancel 설계 노트 참고.
          break
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
            /**
             * ⚔️ **이 한 방의 무게를 궤적에 실어 보냅니다.**
             *
             * 콤보 단계마다 히트스톱이 이미 다릅니다(롱소드 0.055 → 0.11,
             * 단검 0.035 → 0.08). 즉 **손끝은 마무리를 알고 있는데 눈은
             * 몰랐습니다** — 첫 타와 마무리의 궤적이 같은 색, 같은 길이였습니다.
             *
             * 무게를 새로 지어내지 않고 **이미 있는 값(히트스톱)** 을 씁니다.
             * 새 숫자를 만들면 그 둘이 언젠가 갈라지고, 그러면 화면이
             * 손끝과 다른 말을 하게 됩니다 — 이 저장소가 여러 번 데인 모양입니다.
             */
            ctx.onSwing(
              Transform.x[p],
              Transform.z[p],
              Transform.rotY[p],
              combo.range,
              combo.arcDeg,
              swingPower(weapon, combo),
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
            canAffordAttack(p, FINISHER.staminaCost) && finisherTarget(p) >= 0
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
          if (canAffordAttack(p, FINISHER.staminaCost) && finisherTarget(p) >= 0) {
            beginAttack(p, FINISH_COMBO, aimRot)
            break
          }
          if (canAffordAttack(p, weapon.combo[0].staminaCost)) {
            // 후딜에서 빠져나오며 치는 자리 — 여기서도 같은 규칙을 씁니다.
            beginAttack(p, contextComboIndex(p, isSprinting(p)), aimRot)
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
          const [dx, dz] = dodgeDir()
          beginDodge(p, dx, dz)
          break
        }

        /**
         * 스킬도 취소할 수 있습니다 — 값은 공격과 **같습니다.**
         *
         * 다르게 매기고 싶은 유혹이 있었습니다(스킬은 쿨다운을 태우니까
         * 더 비싸게, 같은). 안 했습니다: 규칙이 둘이면 플레이어는 둘 다
         * 못 외우고, "이번엔 왜 안 나가지"만 남습니다. 쿨다운을 날린다는
         * 손해 자체가 이미 스킬 쪽 추가 대가입니다.
         */
        if (phase !== AttackPhase.Recovery && tryDodgeCancel()) break

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
        /**
         * 무기마다 구르는 **시간**이 다릅니다(arsenal.ts dodgeDurationScale).
         * 거리는 그대로라, 빠른 무기는 같은 4.2m 를 더 빨리 지나갑니다 —
         * `distance / dur` 가 그만큼 커지므로 속도 곡선이 알아서 맞습니다.
         */
        const dur = d.duration * (weapon.dodgeDurationScale ?? 1)
        const progress = Math.min(1, Player.dodgeElapsed[p] / dur)
        // 속도 곡선: 시작이 빠르고 끝이 느립니다. 등속으로 굴리면
        // "미끄러지는" 느낌이 나고 무적 타이밍도 읽기 어려워집니다.
        // (1.6 - 1.2t)의 0~1 적분이 정확히 1이라 총 이동거리는 distance가 됩니다.
        const speed = (d.distance / dur) * (1.6 - 1.2 * progress)
        Velocity.x[p] = Player.dodgeDirX[p] * speed
        Velocity.z[p] = Player.dodgeDirZ[p] * speed
        moveScale = 0

        if (Player.dodgeElapsed[p] >= dur) {
          Actor.state[p] = ActorState.Idle
          Player.dodgeCooldownT[p] = d.cooldown
          /**
           * 🤸 **구르기 공격의 창을 엽니다.**
           * 근거는 balance.ts `PLAYER.contextAttack.rollWindow` — 선입력
           * 창(0.55초)보다 짧게 두어야 *"굴러 넘기고 갚는다"* 가 선택이 됩니다.
           */
          Player.rollAttackT[p] = PLAYER.contextAttack.rollWindow
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
        noteLearned('sprint')
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
  /**
   * ⚔️ **상황 모션은 콤보를 엽니다.** 강타·처형과 반대입니다.
   *
   * 달리기·구르기 공격은 그 무기의 **1타에서 파생**된 여는 기술이므로,
   * 뒤로 2타가 이어져야 *"달려들어 붙고 이어 친다"* 가 성립합니다.
   * 여기서 Idle 로 끊으면 두 기술 다 **한 방 치고 굳는** 손해 보는 선택이
   * 되고, 그러면 아무도 안 씁니다.
   *
   * ⚠️ `comboIndex` 를 0 으로 되돌립니다 — 252/253 에 1을 더하면 콤보 표
   *    밖으로 나가서 다음 타가 통째로 사라집니다.
   */
  if (Actor.comboIndex[p] === RUN_COMBO || Actor.comboIndex[p] === ROLL_COMBO) {
    Actor.comboIndex[p] = 0
  }
  /**
   * 🪂 낙하 공격은 **끝내는 한 방**입니다 — 강타·처형과 같은 편입니다.
   * 뒤로 콤보가 이어지면 "높이를 값과 맞바꾼 한 방"의 무게가 사라집니다.
   */
  if (Actor.comboIndex[p] === PLUNGE_COMBO) {
    Actor.state[p] = ActorState.Idle
    Actor.comboIndex[p] = 0
    // ⌨️ **눌러 둔 것은 남깁니다** — 아래 「마무리」 주석 참고.
    Actor.comboWindowT[p] = 0
    return
  }
  /**
   * ── 강타·처형은 **마무리**입니다 — 뒤로 콤보가 이어지면 안 됩니다 ────
   *
   * 그래서 `comboIndex` 를 0 으로 되돌립니다. 다음 공격은 **이어치기가
   * 아니라 새 1타**가 되고, 한 방의 무게가 지켜집니다.
   *
   * ── ⌨️ 그런데 **눌러 둔 것까지 버리고 있었습니다** ────────────────
   * `bufferedAttack` 을 여기서 지웠습니다. "콤보를 안 잇는다"와 "눌러 둔
   * 입력을 없앤다"는 **다른 이야기인데** 한 줄로 붙어 있었습니다.
   *
   * 결과: 강타나 처형을 낸 직후에 누른 다음 공격이 **조용히 사라집니다.**
   * 강타 후딜은 1.12초라 그 사이에 누르는 것이 자연스러운데, 그게 전부
   * 씹혔습니다. `npm run feel` 이 이걸 잡았습니다 — 「무거운 동작 뒤에
   * 눌러 둔 공격이 살아남는가」에서 강타와 처형만 빨갛게 떴습니다.
   *
   * 바로 아래 「콤보가 바닥나는 자리」 분기에 **이미 같은 결론이 적혀**
   * 있습니다: *"눌러 둔 것이 버려지면 정확히 그 순간 한 박자가 비어,
   * 다시 시작하려면 착지를 보고 다시 눌러야 합니다."* 같은 규칙이 세
   * 갈래에만 적용되고 이쪽 세 갈래에는 안 닿아 있었습니다.
   *
   * 참고 게임도 전부 같습니다 — 세키로의 인살 뒤에도, 오공의 봉세 한 방
   * 뒤에도, 눌러 둔 다음 입력은 동작이 끝나는 순간 나갑니다. 마무리의
   * 무게는 **콤보를 안 잇는 것**으로 지키지, 손을 씹어서 지키지 않습니다.
   */
  if (Actor.comboIndex[p] === HEAVY_COMBO || Actor.comboIndex[p] === FINISH_COMBO) {
    Actor.state[p] = ActorState.Idle
    Actor.comboIndex[p] = 0
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
    canAffordAttack(p, FINISHER.staminaCost) &&
    finisherTarget(p) >= 0
  ) {
    beginAttack(p, FINISH_COMBO, aimRot)
    return
  }
  const next = Actor.comboIndex[p] + 1
  const canChain =
    Actor.bufferedAttack[p] === 1 &&
    next < weapon.combo.length &&
    canAffordAttack(p, weapon.combo[next].staminaCost)
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
