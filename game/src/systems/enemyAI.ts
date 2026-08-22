import { bleedMaxOf, enemyDef } from '../config/enemies'
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
  AttackIntent,
  ATTACK_COMMIT_GAP,
  MAX_CONCURRENT_ATTACKERS,
  MAX_CONCURRENT_WIDE,
  MAX_CONCURRENT_RANGED,
  SNARE_MOVE_SCALE,
  REPEAT_PENALTY,
  WIDE_ARC_DEG,
  attackAt,
  attacksFor,
  hasAttackInBand,
  openingOf,
  pickAttack,
  type EnemyAttackDef,
} from '../config/enemyAttacks'
import { isTimingAnswer } from '../config/punish'
import {
  BOSS_PHASES,
  NO_CHAIN,
  PHASE_SHOCKWAVE,
  PHASE_TRANSITION_TIME,
  bossPhase,
  phaseForHp,
} from '../config/bossPhases'
import {
  AWARE,
  BOSS_ARENA,
  GUARD,
  LEVEL_AGGRO_LEAD,
  LEVEL_AGGRO_MAX,
  LEVEL_DEAGGRO_MIN,
  LEVEL_DEAGGRO_RATIO,
  PLAYER,
  BLEED,
  POISE,
  PUNISH_HEAL,
  hearDistance,
  WINDUP_TURN_BUDGET_DEG,
} from '../config/balance'
import { sfx, SfxIntent } from '../core/audio'
import { defineQuery, isAlive } from '../core/ecs'

/**
 * 예고 색 → 예고음. **표 없이 캐스팅으로 넘기다가 🟢 이 조용해졌습니다**
 * (아래 sfx.telegraph 호출부 설계 노트). `Record` 라서 AttackIntent 에
 * 값을 하나 더하면 여기서 컴파일이 막힙니다.
 */
const INTENT_TO_SFX: Record<AttackIntent, SfxIntent> = {
  [AttackIntent.Strike]: SfxIntent.Strike,
  [AttackIntent.Sweep]: SfxIntent.Sweep,
  [AttackIntent.Snare]: SfxIntent.Snare,
  [AttackIntent.Pull]: SfxIntent.Pull,
  [AttackIntent.Counter]: SfxIntent.Counter,
}
import { combatRng } from '../core/rng'
import { isBehindPoint, noteBleedBlocked, noteBleedDecay } from './combat'
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

/**
 * 0이면 종류별 기본값을 씁니다(아레나). 레벨 모드에서 방 단위 값으로 덮습니다.
 */
let aggroRangeOverride = 0

/**
 * "저 적이 나에게 실제로 걸어올 수 있는가"를 물어보는 함수.
 *
 * 지형(거리장)이 있으면 게임 루프가 여기에 꽂아 줍니다. 없으면(아레나 모드)
 * null 을 돌려주고, 그때는 예전처럼 직선거리를 씁니다.
 */
let reachDistance: ((x: number, z: number) => number | null) | null = null

export function setReachDistance(fn: ((x: number, z: number) => number | null) | null): void {
  reachDistance = fn
}
/**
 * 🚪 **AI 가 지금 쓰고 있는 「그 적이 나에게 오는 거리」.**
 *
 * 프로브가 지형에서 다시 계산하면 *다른 함수*를 검사하게 됩니다. 실제로
 * 한 번 방향을 반대로 재서 속았고, 그 다음엔 *"규칙이 안 도는지, 값이
 * 다른지"* 를 못 갈랐습니다. 판단하는 쪽이 쓰는 값을 그대로 내보냅니다.
 * `reachDistance` 가 아예 안 걸려 있으면(아레나) **null** 입니다 —
 * 그 사실 자체가 답인 경우가 있습니다.
 */
export function reachDistanceOf(x: number, z: number): number | null {
  return reachDistance ? reachDistance(x, z) : null
}

export function setAggroRangeOverride(range: number): void {
  aggroRangeOverride = range
}

/**
 * 🔔 **이 종류가 실제로 깨어나는 거리**(m) — 판단하는 쪽이 쓰는 바로 그 값.
 *
 * ── 왜 함수로 빼는가 ────────────────────────────────────────────────
 * 이 식은 아래 루프에 인라인으로 있었고, `npm run map` 이 **같은 식을 손으로
 * 베껴** 쓰고 있었습니다. 지난 회차에 「주 동선」이 세 곳에서 따로 그려지다
 * 서로 어긋난 것과 **똑같은 병**입니다. 그때 배운 것을 여기에도 적용합니다:
 * 베낀 식은 언젠가 갈라지고, 갈라진 뒤에는 **프로브가 없는 게임을 검사합니다.**
 *
 * ── 무엇을 계산하는가 ──────────────────────────────────────────────
 * · 레벨 모드(`aggroRangeOverride > 0`)에서는 방 단위로 좁히되,
 *   원거리 적에게는 **자기 사거리 + 여유**만큼은 확보해 줍니다.
 *   (근거는 balance.ts 의 `LEVEL_AGGRO_RANGE` · `LEVEL_AGGRO_LEAD` 설계 노트)
 * · 아레나 모드에서는 종류별 기본값 그대로입니다.
 *
 * ⚠️ 기준은 `attackRange`(달려들기 시작하는 거리)가 **아니라** 패턴의
 *    `reach`(실제로 때리는 거리)입니다. 끄는 자가 attackRange 12 · reach 6.5
 *    라, 이 둘을 헷갈리면 근접 적 어그로까지 조용히 넓어집니다 —
 *    실제로 한 번 그렇게 틀렸고 `npm run encounter` 가 잡았습니다.
 */
export function wakeRangeOf(kind: EnemyKind): number {
  const cfg = enemyDef(kind)
  const hurtReach = attacksFor(kind).reduce((m, a) => Math.max(m, a.reach), 0)
  const wakeCap = Math.min(
    LEVEL_AGGRO_MAX,
    Math.max(aggroRangeOverride, hurtReach + LEVEL_AGGRO_LEAD),
  )
  return aggroRangeOverride > 0 ? Math.min(cfg.aggroRange, wakeCap) : cfg.aggroRange
}

/** 🚧 AI 가 지금 도는가 — 프로브가 **멈춘 게임**을 재고 규칙 탓을 하지 않게. */
export function enemyAiRunning(): boolean {
  return aiEnabled
}
export function setEnemyAiEnabled(enabled: boolean): void {
  aiEnabled = enabled
}

export interface EnemyAiContext {
  onSwing: (
    x: number,
    z: number,
    rotY: number,
    range: number,
    arcDeg: number,
    power: number,
  ) => void
}

const enemies = defineQuery(Enemy, Actor, Transform, Velocity, Health)

/**
 * 👀 **들킨 순간** — 이번 프레임에 `aggro` 가 0 → 1 로 넘어간 적들.
 *
 * 왜 배열로 내보내는가: 인지가 바뀌는 것은 **사건**인데, 지금까지는
 * 상태(`aggro`)만 있고 사건이 없었습니다. 상태만 있으면 화면은
 * *"어느새 깨어 있더라"* 밖에 못 그립니다 — 원인과 결과가 끊깁니다.
 * 세키로의 `!` 도, 쓰시마의 경계 표시도 전부 **그 한 순간**을 그립니다.
 *
 * `hitEvents`·`breakEvents` 와 같은 규약입니다: 시스템이 밀어 넣고,
 * 게임 루프가 읽고 비웁니다. 사건은 사건이 일어난 자리에서 기록합니다.
 */
export const spotEvents: { entity: number; x: number; z: number; heard: boolean }[] = []

/**
 * 🚪 **놓친 순간** — 걸어서 닿을 수 없게 되어 `aggro` 가 1 → 0 으로
 * 돌아간 적들. `spotEvents` 의 짝입니다.
 *
 * 사건으로 내보내는 이유도 같습니다 — 이 규칙이 하는 일은 *"안 하는 것"*
 * (예고를 안 띄우는 것)이라 상태만 봐서는 **일어났는지조차 알 수 없습니다.**
 * 직선거리와 경로거리를 같이 실어서, 장부가 *"몇 배였길래 풀렸는가"* 를
 * 그대로 말할 수 있게 합니다.
 */
export const deaggroEvents: { entity: number; straight: number; walk: number }[] = []

const DEG = Math.PI / 180
/**
 * 이 각도 안에 플레이어가 들어와야 공격을 **시작**합니다(뒤통수에 대고
 * 휘두르지 않도록).
 *
 * ⚠️ 이 값은 **닿는 각도가 아니라 시작해도 되는 각도**입니다. 둘은 다르고,
 *    지금 13개 부채꼴 패턴 중 10개가 이 값보다 **좁은 반각**을 가집니다
 *    (가장 좁은 `dragger_reel` 은 14° — 이 문턱의 1/3). 그래도 말이 되는
 *    이유는 **예고 동안 스스로 돌아서 고치기 때문**입니다
 *    (`WINDUP_TURN_BUDGET_DEG`). 즉 이 세 값은 **서로를 전제로** 정해져
 *    있는데 파일이 셋 다 다릅니다 — 하나만 바꾸면 조용히 깨집니다.
 *
 *    그래서 밖으로 냅니다: `npm run rules` 의 「스스로 고칠 수 있는
 *    만큼만 커밋을 허락한다」가 이 관계를 지킵니다.
 */
export const ATTACK_FACING_TOLERANCE_DEG = 45
const ATTACK_FACING_TOLERANCE = ATTACK_FACING_TOLERANCE_DEG * DEG

/**
 * 준비가 된 채로 이만큼(초) 조준을 못 맞추면 **홱 돌아봅니다.**
 * 0.6초인 이유: 사람이 "보스가 나를 노려봤다"를 알아챌 만큼은 길고,
 * 전투가 멈춘 것처럼 느껴질 만큼은 짧습니다.
 */
const ATTACK_PATIENCE = 0.6

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

/** 연계가 예약된 횟수 — 실제로 발동한 횟수와 비교합니다(commitAttack 설계 노트). */
let chainsArmed = 0
/** 예약이 **실제로 쓰인** 횟수 — 예약과 같은 줄에서 셉니다(위 설계 노트). */
let chainsFired = 0
/**
 * 🍶 **회복을 노린 횟수** — 규칙이 실제로 도는지 재는 눈금.
 * "안 노린다"와 "노렸는데 못 맞혔다"는 처방이 정반대입니다.
 */
let healPunishArmed = 0
export function readHealPunish(): number {
  return healPunishArmed
}
export function resetHealPunish(): void {
  healPunishArmed = 0
}

export function readChainsArmed(): number {
  return chainsArmed
}

/** 예약이 실제로 쓰인 횟수. 예약과 **같은 자리**에서 세므로 나란히 뺄 수 있습니다. */
export function readChainsFired(): number {
  return chainsFired
}

/**
 * 예약된 연계가 **무너짐으로 끊긴** 횟수 — 끊긴 시점의 박자별로 셉니다.
 * `[예고 중, 휘두르는 중, 후딜 중]`
 *
 * ── 왜 박자를 나눠 세는가 ──────────────────────────────────────────
 * "예약 3회 · 발동 0회"까지는 쟀는데, 그 숫자만으로는 **고쳐야 할지**
 * 판단할 수 없습니다. 끊긴 자리가 어디냐에 따라 답이 정반대이기 때문입니다:
 *
 *   · **후딜에서 끊겼다** → 고칠 게 없습니다. 연계는 "후딜을 욕심내지 마라"는
 *     장치이고, 그걸 무너뜨려 끊는 것은 플레이어가 **이긴** 것입니다.
 *   · **예고에서 끊겼다** → 연계는 시작도 못 해 봤습니다. 두 박자를 배우게
 *     하려던 설계가 통째로 도달 불가입니다.
 *
 * 추측으로 고르지 않으려고 세는 한 줄입니다.
 */
/**
 * 🔎 **적이 안 때리고 서 있는 프레임의 이유** — 문 앞에서 셉니다.
 *
 * `npm run rhythm` 이 *"방해가 없어도 보스가 5.1초에 한 번만 휘두른다"* 를
 * 재 놨습니다(설정값으로 계산한 한 주기는 3.0초). 2초가 어디로 가는지
 * 짐작으로 두 번 고쳐 봤고 두 번 다 틀렸습니다.
 *
 * 커밋 문에는 조건이 셋 붙어 있습니다 — **토큰 · 쿨다운 · 조준**. 어느
 * 것이 몇 프레임을 잡아먹는지는 **그 문 앞에서 세는 수밖에** 없습니다.
 * 밖에서 상태를 훑으면 프레임 사이에 열렸다 닫힌 것을 놓칩니다.
 */
const idleReasons = { token: 0, cooldown: 0, facing: 0, noPattern: 0, committed: 0 }
export function readIdleReasons(): typeof idleReasons {
  const out = { ...idleReasons }
  for (const k of Object.keys(idleReasons) as (keyof typeof idleReasons)[]) idleReasons[k] = 0
  return out
}

const chainsLost: [number, number, number] = [0, 0, 0]
/**
 * 💢 **무너졌지만 안 잃은** 연계 — 무거운 적이 일어나면서 이어서 낸 횟수.
 *
 * "지우기 전에 세라"는 이 저장소의 규칙입니다. 무거운 적의 연계는 이제
 * 무너져도 안 지워지므로, **끊김**으로 세면 거짓말이고 아예 안 세면 어디로
 * 갔는지 모릅니다. 그래서 칸을 따로 둡니다 — 다른 사건은 다른 칸에.
 */
let chainsResumed = 0
export function readChainsLost(): [number, number, number, number] {
  return [chainsLost[0], chainsLost[1], chainsLost[2], chainsResumed]
}

/**
 * 예약된 연계가 **무너짐 말고 다른 이유로** 사라진 횟수.
 *
 * ── 왜 필요해졌는가 ────────────────────────────────────────────
 * 벤치가 *"연계 예약 8회 / 발동 0회"* 를 찍었습니다. 그런데 우리가 세고
 * 있던 끊김은 **무너짐 하나뿐**이었습니다. 예약을 지우는 자리는 그 밖에도
 * 셋이나 더 있습니다:
 *
 *   · 페이즈 전환 — 체력이 경계를 넘으면 하던 것을 끊고 자세를 바꿉니다
 *   · 귀환      — 영역 밖으로 나가면 자리로 돌아가며 전부 되돌립니다
 *   · 사망      — 예약을 안고 죽습니다
 *
 * 그래서 "예약 8 · 발동 0 · 무너짐 2" 같은 표가 나오면 **나머지 6이 어디로
 * 갔는지 아무도 모릅니다.** 셈이 안 맞는 표는 읽는 사람을 속입니다.
 *
 * 이제 **장부가 맞아떨어지는지** 자체를 검사할 수 있습니다:
 *
 *     예약 = 발동 + 무너짐 + 페이즈전환 + 귀환 + 사망 + 판이 끝날 때 남은 것
 */
const chainsDropped = { phase: 0, leash: 0, death: 0, overwrite: 0, wiped: 0 }

/**
 * **한꺼번에 지워진 예약** — 화톳불에서 쉬거나 부활할 때 적을 전부 없애고
 * 다시 깝니다. 그때 예약을 안고 있던 적은 `Dead` 상태를 거치지 않고
 * **엔티티째 사라지므로**, 아래 사망 분기가 영영 안 봅니다.
 *
 * ── 이게 오래 걸린 이유 ────────────────────────────────────────────
 * 장부가 여러 라운드 동안 **잔액 4~7회**를 냈고, 그때마다 결말 칸은 전부
 * 0이었습니다(무너짐 0 · 페이즈전환 0 · 귀환 0 · 사망 0 · 덮어씀 0).
 * 결말이 전부 0인데 잔액이 남는다는 건 **분류가 모자란 것**이지 어느
 * 분류가 틀린 게 아닙니다 — 그런데 저는 계속 있는 칸들을 의심했습니다.
 *
 * 장부가 안 맞을 때 물어야 할 것은 *"어느 칸이 틀렸나"* 가 아니라
 * **"내가 아직 칸을 안 만든 결말이 있나"** 입니다.
 */
/**
 * **죽어서 사라지는 적 하나**의 예약을 셉니다.
 *
 * ⚠️ 아래 사망 분기(`state === Dead`)만으로는 못 잡습니다. 프레임 순서가
 *    이렇기 때문입니다:
 *
 *      enemyAiSystem → resolveAttacks(여기서 죽음) → 사망 처리(엔티티 파괴)
 *
 *    즉 **판정으로 죽은 적은 AI 가 `Dead` 를 한 번도 못 보고** 그 프레임에
 *    사라집니다. 예약을 안고 있었으면 그대로 증발합니다 — 결말 칸이 전부
 *    0인데 잔액만 남던 마지막 조각입니다.
 *
 *    "지우기 전에 세라"는 규칙은 한 군데만 지켜서는 소용이 없습니다.
 *    **지우는 자리마다** 지켜야 합니다.
 */
export function noteChainDeath(e: number): void {
  if (Enemy.chainNext[e] !== NO_CHAIN) {
    chainsDropped.death++
    Enemy.chainNext[e] = NO_CHAIN
  }
}

export function noteChainsWiped(): number {
  let n = 0
  const ids = enemies.run()
  for (let i = 0; i < enemies.count; i++) {
    const e = ids[i]
    if (Enemy.chainNext[e] !== NO_CHAIN) {
      n++
      Enemy.chainNext[e] = NO_CHAIN
    }
  }
  chainsDropped.wiped += n
  return n
}

/**
 * 🎓 **1단계가 아직 안 보여준 색** — 보스별로 기록합니다.
 *
 * ── 왜 필요해졌는가 ────────────────────────────────────────────────
 * 바로 아래 페이즈 전환 코드에 이렇게 적혀 있었습니다:
 *
 *   > 화력이 높으면 페이즈를 통째로 **건너뛸 수 있고**(설계한 학습 순서가
 *   > 무너짐) …
 *
 * 그래서 한 번에 두 단계를 뛰지 못하게 막아 뒀습니다. 그런데 그건 **번호를
 * 건너뛰는 것**만 막습니다. `npm run boss` 로 일정한 압력을 넣어 재 보니
 * 1단계가 **2.1초** 였습니다(2단계 5.5 · 3단계 6.2). 번호는 안 건너뛰었지만
 * *1단계가 가르치기로 한 것*은 통째로 사라집니다 — 색 하나 못 보고 지나갑니다.
 *
 * DESIGN.md 는 1단계를 **"읽기 — 4색 훈련장"** 이라고 부릅니다. 훈련장이
 * 2초라면 그 이름이 거짓말입니다.
 *
 * ── 왜 체력 배분으로 못 고치는가 ──────────────────────────────────
 * 체력은 35/35/30 으로 나눠 놨는데 시간은 1 : 2.6 : 3.0 으로 나옵니다.
 * 즉 구간 길이를 정하는 것은 체력이 아니라 **보스가 나를 얼마나 자주
 * 끊는가**입니다(뒤 페이즈일수록 쿨다운이 짧아 더 자주 끊습니다).
 * 1단계를 2.6배로 늘리려면 체력의 90% 를 거기 몰아야 하는데, 그건
 * 3페이즈 보스가 아닙니다.
 *
 * ── 그래서 **시간이 아니라 사건**으로 잠급니다 ──────────────────────
 * 세키로의 페이즈 관문이 쓰는 방식입니다: 체력이 임계값에 닿아도, **아직
 * 안 보여준 색이 남아 있으면 전환을 미룹니다.** 그러면 1단계의 길이가
 * 플레이어의 화력이 아니라 **가르칠 것이 남았는가**로 정해집니다.
 *
 * ⚠️ 무한정 미루지 않습니다. 패턴 선택은 확률이라 운이 나쁘면 한 색이
 *    계속 안 나올 수 있고, 그러면 보스가 죽지도 않고 안 넘어갑니다.
 *    상한을 두고, 넘으면 그냥 넘어갑니다.
 */
const taughtInPhase1 = new Map<number, Set<string>>()

/**
 * 🧾 **그 페이즈에서 연계를 한 번이라도 보여줬는가** (보스별·페이즈별 비트).
 *
 * ── 왜 필요해졌는가 ────────────────────────────────────────────────
 * 장부를 믿을 수 있게 되고 나서 처음으로 물을 수 있었습니다: *"연계가
 * 실제로 몇 번 나오는가."* 일정한 압력으로 세 판을 재니 이랬습니다:
 *
 *     연계 예약 0/2/0 발동 0/0/0
 *     연계 예약 0/0/1 발동 0/0/1
 *     연계 예약 0/1/0 발동 0/0/0
 *
 * 1단계 0 은 설계대로입니다("1페이즈에는 연계가 없다"). 그런데 **2·3단계도
 * 판당 1~2회 예약에 발동은 세 판 중 한 번**이었습니다. 2페이즈의 정체성이
 * 🔵→🔴 인데, 한 판에 한 번도 안 보이는 판이 더 많습니다.
 *
 * 원인은 밸런스가 아니라 **기회**입니다. 한 페이즈는 5초 남짓이라 공격이
 * 서너 번뿐인데, 방아쇠가 되는 색(🔵 속박·🟣 갈고리)은 가중치의 일부일
 * 뿐입니다. 굴림에 맡기면 그 서너 번 안에 안 나오는 판이 흔합니다.
 *
 * ── ⚠️ 그래서 방아쇠 가중치를 올려 봤고, **되돌렸습니다** ────────────
 * 1단계 학습 잠금과 같은 처방(보여줄 게 남았으면 그것부터)을 걸고 다시
 * 쟀습니다:
 *
 *     연계 예약 0/0/0 · 0/2/2 · 0/1/0     ← 예약은 조금 늘고
 *     연계 발동 0/0/0 · 0/0/0 · 0/0/0     ← **발동은 그대로 0**
 *
 * 병목이 예약이 아니었습니다. 매 판 **무너짐이 1/1/1** 로 찍힙니다 —
 * 쉬지 않고 때리는 손은 예약이 걸리자마자 보스를 무너뜨리고, 무너지면
 * 예약은 취소됩니다. 즉 **이 실험대에서는 연계가 원리적으로 못 나옵니다.**
 *
 * 그리고 존을 도는 실제 판에서는 이랬습니다:
 *
 *     예약 24 · 발동 21   (88%)
 *
 * **연계는 멀쩡했습니다.** 문제는 게임이 아니라 **재는 자리**였습니다.
 * 일정한 압력 실험대는 *페이즈의 길이*를 재는 데는 맞지만 *연계*를 재는
 * 데는 틀린 자리입니다 — 그 손은 연계를 원천 봉쇄합니다.
 *
 * 그래서 가중치 변경은 **되돌렸습니다.** 하지 않은 이유를 남기는 것이
 * 이 프로젝트에서 여러 번 값이 있었습니다. 이 표는 남겨 둡니다 —
 * 다음에 누가 "연계가 안 나온다"고 말하면, 먼저 **어디서 쟀는지**를
 * 물어야 합니다.
 */
const chainShownPhase = new Map<number, Set<number>>()
/**
 * 1단계를 끝내기 전에 보여줘야 하는 **색 가짓수.**
 *
 * ⚠️ "가진 색 전부"로 두면 **잠깁니다.** 보스의 🟣 갈고리는 5m 밖에서만,
 *    🟢 돌진도 거리를 두고 나옵니다. 붙어서 싸우는 플레이어에게는 그 둘이
 *    영영 안 나오고, 그러면 1단계가 상한(아래)까지 늘어져 매번 똑같이
 *    지루해집니다. 근접에서 확실히 나오는 셋(🔴 🟡 🔵)이 최소선입니다 —
 *    *"어휘는 봤다"* 가 기준이지 *"전부 봤다"* 가 아닙니다.
 */
const PHASE1_TEACH_COLORS = 3
/** 다 못 가르쳤어도 이만큼 지나면 넘어갑니다 — 확률이 나쁠 때의 탈출구. */
const PHASE1_TEACH_CAP = 12
const phase1HeldT = new Map<number, number>()

/** 판 시작에만 지웁니다(장부 설계 노트와 같은 규칙). */
export function resetPhaseTeaching(): void {
  taughtInPhase1.clear()
  phase1HeldT.clear()
  chainShownPhase.clear()
}

/**
 * 실험대 전용 — 이 잠금을 끕니다.
 *
 * ⚠️ **규칙을 끄는 스위치는 위험합니다.** 그래도 둔 이유가 있습니다:
 *    `npm run boss` 의 앞부분은 전환·연계·박자 같은 **다른 규칙**을 재려고
 *    체력을 강제로 깎아 페이즈를 넘깁니다. 이 잠금이 켜져 있으면 그
 *    전환들이 막혀서, 아무 상관 없는 검사 열 개가 같이 빨개집니다.
 *    (실제로 그렇게 만들어 놓고 한 번 당했습니다.)
 *
 *    끄는 것은 **잠금 하나**뿐이고, 그 잠금 자체는 같은 프로브의 뒷부분이
 *    켠 채로 잽니다. 규칙을 안 재는 게 아니라 **재는 자리를 나눈 것**입니다.
 */
/**
 * 🎓 **지금 학습 잠금이 이 보스의 페이즈를 붙잡고 있는가.**
 *
 * ── 왜 내보내는가 (프로브 셋이 오래 빨갰습니다) ────────────────────
 * 이 잠금은 1단계에서 색 셋을 다 보여줄 때까지 체력을
 * `최대치 × 0.75 + 0.5` 아래로 **안 내려가게 붙잡습니다.** 아레나 프로브가
 * 체력을 절반 깎고 페이즈가 오르기를 기다리다 영영 못 기다렸고, 검사 셋이
 * **아주 오래 빨간 채**로 있었습니다. 넣은 피해 310 중 154.5 만 남은 것처럼
 * 보여서, 하마터면 `damageEntity` 를 의심할 뻔했습니다.
 *
 * 게임이 *"지금 붙잡고 있다"* 고 말해 주면 다음 사람은 안 당합니다.
 * 이 저장소가 가장 비싸게 여기는 실패가 **아무 말도 안 하는 계측기**인데,
 * 여기서는 **아무 말도 안 하는 게임**이었습니다.
 */
export function phaseTeachHold(e: number): { holding: boolean; seen: number; need: number } {
  const seen = taughtInPhase1.get(e)?.size ?? 0
  const held = phase1HeldT.get(e) ?? 0
  return {
    holding: phaseTeachingOn && Enemy.phase[e] === 0 && seen < PHASE1_TEACH_COLORS && held < PHASE1_TEACH_CAP,
    seen,
    need: PHASE1_TEACH_COLORS,
  }
}

export function setPhaseTeaching(on: boolean): void {
  phaseTeachingOn = on
}
let phaseTeachingOn = true
export function readChainsDropped(): {
  phase: number
  leash: number
  death: number
  overwrite: number
} {
  return { ...chainsDropped }
}

/** 지금 예약을 안고 있는 적이 몇인지 — 판이 끝날 때 남은 몫을 세려고. */
export function countChainsPending(): number {
  const ids = enemies.run()
  let n = 0
  for (let i = 0; i < enemies.count; i++) {
    if (Enemy.chainNext[ids[i]] !== NO_CHAIN) n++
  }
  return n
}

/**
 * 공격 토큰의 **살아 있는 상태**만 되돌립니다 — 화톳불 휴식·부활에서 부릅니다.
 *
 * ⚠️ 여기서 **연계 장부를 지우면 안 됩니다.** 예전에는 지웠습니다. 그런데
 *    발동 쪽(`foeSwingLog`)은 판 내내 쌓이므로, 예약은 중간에 0으로
 *    돌아가고 발동은 안 돌아갔습니다. 즉 벤치가 여러 라운드 동안 찍어 온
 *    **"연계 예약 8회 / 발동 0회"는 견줄 수 없는 두 숫자**였습니다.
 *    (장부를 만들고 나서야 잔액이 **음수**로 나와서 들켰습니다 —
 *     예약 1인데 발동 4.)
 *
 *    수명이 다른 두 값을 나란히 찍으면, 읽는 사람은 그것을 비율로 읽습니다.
 *    그리고 저는 실제로 그 비율을 보고 "보스가 가르칠 시간을 잃었다"고
 *    적었습니다. 그 결론은 **철회합니다.**
 */
export function resetAttackTokens(): void {
  commitGapT = 0
}

/** 연계 장부 — **판이 시작할 때만** 지웁니다(발동 쪽과 수명을 맞춥니다). */
export function resetChainLedger(): void {
  chainsArmed = 0
  chainsLost[0] = 0
  chainsLost[1] = 0
  chainsLost[2] = 0
  chainsResumed = 0
  chainsDropped.phase = 0
  chainsDropped.leash = 0
  chainsDropped.death = 0
  chainsDropped.overwrite = 0
  chainsDropped.wiped = 0
  chainsFired = 0
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
/**
 * ── 🎟 **공격 허가를 나눠 줍니다** — 거리 하나로 줄을 세우지 않습니다 ──────
 *
 * 예전에는 `waiting.sort((a, b) => a.d - b.d)` 한 줄이었습니다. 가장 가까운
 * 적부터 토큰을 줍니다. 그런데 `npm run encounter` 가 이렇게 찍었습니다:
 *
 *   [띠] 네 반지름(2·3·4.5·7m) **전부** — dragger **0회** · archer **0회**
 *   자리한 거리 — grunt 2.1m · binder 5.8m · dragger 8.1m · archer 8.6m
 *
 * 끄는 자와 쏘는 자는 **자기 띠(3~12m) 한가운데**에 서고도 24초 동안 한 번도
 * 못 휘둘렀습니다. 잡몹은 수가 많고 빨리 붙으니 늘 앞줄이고, **멀리서
 * 싸우는 것이 정체성인** 둘은 영영 셋째·넷째였기 때문입니다.
 *
 * 기둥 2("색마다 다른 정답")는 색이 **나와야** 성립합니다. 안 나오는 색은
 * 배치의 문제가 아니라 **규칙상 없는 색**입니다.
 *
 * ── 다른 게임은 이 자리를 어떻게 두는가 ───────────────────────────
 * · **배트맨: 아캄 / 섀도우 오브 모르도르** — 둘러싼 적에게 공격 허가를
 *   **돌아가며** 줍니다. 특수 적을 일부러 앞세워 플레이어가 **다른 대응**을
 *   보게 만듭니다. 같은 잡기만 스무 번 오면 배울 것이 없으니까요.
 * · **헤일로**(전투 지휘자) — 공격 슬롯을 배분하고 **회전**시킵니다.
 *   한 부류의 독점을 막는 것이 명시적 목표입니다.
 * · **소울류** — 적마다 망설임 타이머가 따로 돌아, 가장 가까운 놈이 무한히
 *   우선권을 갖지 않습니다.
 *
 * 공통점은 하나입니다 — **거리는 우선순위의 전부가 아닙니다.**
 *
 * 그래서 둘을 바꿉니다:
 *   ① **지금 낼 수 있는 적만** 줄에 세웁니다(`hasAttackInBand`). 못 쓸 적에게
 *      자리를 주면 그 프레임이 통째로 버려집니다 — 토큰이 둘뿐이라 그
 *      낭비가 곧 "아무도 안 때리는 시간"이 됩니다.
 *   ② **오래 기다린 순서**로 줍니다(`Enemy.waitT`). 거리는 **동점일 때만**
 *      봅니다. 이게 아캄·헤일로의 회전이고, 잡몹이 늘 앞줄인 구조를 끊습니다.
 */
function grantAttackTokens(
  ids: Int32Array | Uint32Array | number[],
  count: number,
  px: number,
  pz: number,
  dt: number,
): Set<number> {
  const granted = new Set<number>()

  /**
   * 🏹 **날아가는 공격만 쓰는 적인가.** 근거는 enemyAttacks.ts
   * `MAX_CONCURRENT_RANGED` 주석 — 요약하면 *"근접의 동시성을 막으려고
   * 만든 줄에 원거리를 세우면 원거리는 벌만 받고 근접의 위험은 하나도
   * 안 줄어든다"* 입니다.
   *
   * ⚠️ **종류 이름으로 가르지 않습니다.** `kind === Archer` 로 적으면
   *    새 원거리 적을 넣는 날 그 적만 조용히 옛 줄에 섭니다. 묻는 것은
   *    이름이 아니라 **하는 일**입니다 — 가진 패턴이 전부 날아가는가.
   */
  const isRanged = (kind: number): boolean => {
    const list = attacksFor(kind)
    return list.length > 0 && list.every((a) => a.projectile === true)
  }

  // 이미 공격 중인 적이 토큰을 쥐고 있는 것으로 칩니다.
  let busy = 0
  let wideBusy = 0
  let rangedBusy = 0
  const waiting: { e: number; d: number; w: number }[] = []
  const waitingRanged: { e: number; d: number; w: number }[] = []
  for (let i = 0; i < count; i++) {
    const e = ids[i]
    if (!isAlive(e) || Actor.state[e] === ActorState.Dead) continue
    if (Actor.state[e] === ActorState.Attack) {
      // 🏹 쏘는 중인 적은 **근접 줄의 자리를 안 먹습니다.** 안 그러면
      //    빼 준 의미가 없습니다 — 기다리는 쪽만 바뀔 뿐입니다.
      if (isRanged(Enemy.kind[e])) rangedBusy++
      else busy++
      const def = attackAt(Enemy.kind[e], Enemy.attackIndex[e])
      if (def.arcDeg >= WIDE_ARC_DEG) wideBusy++
      continue
    }
    if (Enemy.aggro[e] === 0) continue
    if (Actor.state[e] === ActorState.Stagger) continue
    const d = Math.hypot(Transform.x[e] - px, Transform.z[e] - pz)
    /**
     * ⏳ **기다린 시간은 줄에 서 있는 동안만 흐릅니다.**
     * 자고 있거나 굳어 있는 적까지 세면, 깨어나자마자 맨 앞으로 오게 됩니다.
     */
    Enemy.waitT[e] += dt
    /**
     * ① **지금 낼 수 있는 적만** 줄에 세웁니다. 밴드 판정은 `pickAttack` 과
     *    같은 식을 씁니다(`hasAttackInBand`) — 두 곳이 다른 식을 쓰면
     *    "토큰은 받았는데 못 쓰는" 적이 조용히 생깁니다.
     */
    if (!hasAttackInBand(attacksFor(Enemy.kind[e]), d)) continue
    // 🏹 **줄을 나눕니다** — 같은 줄에 두면 순서가 섞여서, 슬롯을 따로
    //    둔 것이 아무 일도 하지 않습니다.
    ;(isRanged(Enemy.kind[e]) ? waitingRanged : waiting).push({ e, d, w: Enemy.waitT[e] })
  }

  // 광역 여유분은 **항상 먼저** 갱신합니다.
  // 아래 조기 반환보다 뒤에 두면 값이 지난 프레임 것으로 남아,
  // 광역이 이미 하나 진행 중인데도 하나 더 허용되는 순간이 생깁니다.
  wideSlotsLeft = MAX_CONCURRENT_WIDE - wideBusy

  if (commitGapT > 0) return granted // 아직 다음 차례가 아닙니다

  /**
   * 🏹 **원거리 몫을 먼저 나눠 줍니다** — 근접 자리가 없어도 쏠 수 있게.
   * 이 줄은 `MAX_CONCURRENT_RANGED` 만 봅니다(근접 `busy` 와 무관).
   */
  let rangedFree = MAX_CONCURRENT_RANGED - rangedBusy
  if (rangedFree > 0 && waitingRanged.length > 0) {
    waitingRanged.sort((a, b) => (Math.abs(b.w - a.w) > 0.25 ? b.w - a.w : a.d - b.d))
    for (const w of waitingRanged) {
      if (rangedFree <= 0) break
      granted.add(w.e)
      rangedFree--
    }
  }

  let free = MAX_CONCURRENT_ATTACKERS - busy
  if (free <= 0) return granted

  /**
   * ② **오래 기다린 순서.** 거리는 **동점일 때만** 봅니다(0.25초 안이면
   *    같은 차례로 칩니다 — 부동소수 차이로 순서가 매 프레임 흔들리면
   *    아무도 못 내는 상태가 됩니다).
   */
  waiting.sort((a, b) => (Math.abs(b.w - a.w) > 0.25 ? b.w - a.w : a.d - b.d))
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
  const list = attacksFor(kind)
  const from = list[attackIndex]?.id ?? ''
  /**
   * 보스는 **페이즈마다** 연계가 다릅니다(2페이즈 🔵→🟡, 3페이즈 🔵→🟣).
   * 잡몹은 페이즈가 없으므로 종류 정의에 붙습니다(enemies.ts chains).
   * 두 자리를 **한 함수**로 모으는 이유는 이 파일 아래 commitAttack 설계
   * 노트와 같습니다 — 갈라 두면 한쪽에만 예고음이 붙는 식으로 어긋납니다.
   */
  const chainId =
    kind === EnemyKind.Boss ? bossPhase(phaseIdx).chains?.[from] : enemyDef(kind).chains?.[from]
  if (!chainId) return NO_CHAIN
  const idx = list.findIndex((a) => a.id === chainId)
  return idx >= 0 ? idx : NO_CHAIN
}

/**
 * ⚠️ `player` 는 **기본값을 주지 않습니다.** 기본값(-1 같은)을 두면 부르는
 * 쪽에서 빠뜨려도 조용히 통과하고, `aimAtStart` 에는 말이 안 되는 각도가
 * 남습니다. 「못 잰 것은 통과가 아니다」 — 빠뜨리면 컴파일이 막게 둡니다.
 */
function commitAttack(
  e: number,
  player: number,
  kind: number,
  index: number,
  windupScale: number,
  chained = false,
): void {
  const list = attacksFor(kind)
  const atk = list[index]
  /**
   * ⏳ **차례를 썼으면 대기 시간을 비웁니다.**
   *
   * 안 비우면 한 번 밀린 적의 `waitT` 가 계속 자라서 **영원히 앞줄**을
   * 차지하고, 회전이 아니라 새로운 독점이 됩니다 — 고치려던 것과 같은
   * 모양이 반대편에 생기는 셈입니다.
   */
  Enemy.waitT[e] = 0
  Enemy.attackIndex[e] = index
  Actor.state[e] = ActorState.Attack
  Actor.phase[e] = AttackPhase.Windup
  /**
   * 🎓 **본 것은 예고가 뜬 순간 셉니다.** 판정까지 기다리면, 플레이어가
   * 잘 피해서 판정이 안 난 색은 "안 가르친 것"이 되어 1단계가 끝나지
   * 않습니다 — 잘할수록 벌받는 구조가 됩니다.
   */
  if (Enemy.phase[e] === 0) {
    let seen = taughtInPhase1.get(e)
    if (!seen) {
      seen = new Set<string>()
      taughtInPhase1.set(e, seen)
    }
    seen.add(String(atk.intent))
  }
  /**
   * ⏳ **지연 공격** — 가끔 뜸을 들입니다(enemyAttacks.ts `hold` 설계 노트).
   *
   * `combatRng` 를 씁니다. `Math.random()` 은 이 저장소에서 금지입니다 —
   * 같은 시드로 같은 판이 나와야 벤치의 중앙값에 뜻이 생기고, 버그도
   * 재현됩니다(core/rng.ts). 전투 스트림을 쓰므로 지도 생성과 안 섞입니다.
   *
   * **더하기만 합니다.** 곱하지 않는 이유: 배율이면 페이즈 배율
   * (`windupScale`)과 곱해져서 3단계에서 지연이 같이 줄어듭니다. 뜸은
   * 페이즈와 무관하게 *"이번엔 늦게 온다"* 하나여야 읽는 사람이 배웁니다.
   *
   * 어느 패턴이 뜸을 들이는지는 **데이터에 적혀 있습니다**(`hold`).
   * 여기서 종류를 분기하면 적을 하나 더 넣는 날 이 파일도 같이 고쳐야 합니다.
   */
  const hold = atk.hold
  const holdT = hold && combatRng.chance(hold.chance) ? hold.add : 0
  Actor.timer[e] = atk.windup * windupScale + holdT
  Enemy.heldT[e] = holdT
  // 🕐 **실제로 건 값**을 남깁니다 — 읽는 쪽이 설정값을 다시 계산하지 않게.
  Enemy.windupLen[e] = Actor.timer[e]
  /**
   * 🎯 **예고를 거는 순간의 각도**도 같이 남깁니다(components.ts `aimAtStart`).
   * 휘두를 때의 각도만으로는 *"처음부터 빗나가 있었다"* 와 *"예고 동안
   * 벌어졌다"* 가 한 칸에 뭉칩니다.
   */
  {
    const dx = Transform.x[player] - Transform.x[e]
    const dz = Transform.z[player] - Transform.z[e]
    const want = Math.atan2(dx, dz)
    let d = want - Transform.rotY[e]
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    Enemy.aimAtStart[e] = Math.abs((d * 180) / Math.PI)
  }
  Actor.hitsLeft[e] = 1
  Actor.nextHitT[e] = 0
  Enemy.chained[e] = chained ? 1 : 0

  /**
   * 이 패턴 뒤에 따라붙을 연계를 지금 정해 둡니다.
   *
   * ⚠️ **연계에서 또 연계를 걸지 않습니다**(`chained` 면 무조건 없음).
   *    지금까지는 보스 표가 전부 한 방향(🔵→🟡, 🟣→🟡)이라 저절로
   *    끝났습니다. 그런데 잡몹에 `grunt_jab → grunt_jab` 같은 **자기
   *    자신으로의 연계**를 넣는 순간, 이 줄은 영원히 다음 연계를 예약해서
   *    적이 **끝없이 휘두릅니다.** 표만 보고는 안 보이는 종류의 고장이라
   *    규칙 자체를 여기 못 박습니다: 연계는 **두 번까지**.
   */
  /**
   * ⚠️ **살아 있는 예약을 덮어쓰는 것도 결말입니다.**
   *
   * 장부를 만들고 처음 돌리자마자 *"설명 안 되는 3회"* 가 나왔습니다.
   * 무너짐·페이즈전환·귀환·사망 넷을 다 세도 예약의 행방이 안 맞았습니다.
   * 남은 길이 여기였습니다 — 앞 공격이 **연계를 안고 있는 채로** 끝나지
   * 못하고(반격에 끊기는 등) 다음 공격을 새로 걸면, 이 한 줄이 예약을
   * 조용히 지웁니다.
   *
   * 세지 않으면 "예약은 됐는데 어디로 갔는지 모른다"가 남고, 그 표를 보고
   * 페이즈 길이나 체력을 손대게 됩니다 — **엉뚱한 것을 고치는 길**입니다.
   */
  if (!chained && Enemy.chainNext[e] !== NO_CHAIN) chainsDropped.overwrite++
  /**
   * **발동은 여기서 셉니다** — 예약이 소비되는 바로 그 줄에서.
   *
   * ── 잔액 4~7회를 여러 라운드 끌고 온 진짜 이유 ────────────────────
   * 지금까지 "발동"은 main.ts 가 셌습니다. 적이 **판정(Active)** 에 들어갈 때
   * `chained` 표시를 보고 세는 방식이었습니다. 그런데 예약은 여기, **예고가
   * 시작되는 순간** 소비됩니다. 둘 사이에는 예고 하나가 통째로 들어 있고,
   * 그 사이에 적이 죽으면 이렇게 됩니다:
   *
   *   · 예약: 소비됨 (chainNext = NO_CHAIN)
   *   · 발동: 안 세짐 (판정까지 못 감)
   *   · 사망: 안 세짐 (셀 때는 이미 chainNext 가 비어 있음)
   *
   * **어느 칸에도 안 들어갑니다.** 결말 칸이 전부 0인데 잔액만 남던 이유가
   * 이것이었습니다.
   *
   * 이 저장소가 같은 병으로 이미 한 번 결론을 물렸습니다 — 수명이 다른 두
   * 숫자를 나란히 놓고 뺀 것입니다. 그래서 이번엔 **예약과 발동을 같은
   * 줄에서** 셉니다. 나란히 놓고 뺄 수 있으려면 **같은 자리에서 세야**
   * 합니다.
   */
  if (chained) {
    chainsFired++
    // 이 페이즈는 연계를 보여줬습니다 — 아래 우선순위를 여기서 내립니다.
    let shown = chainShownPhase.get(e)
    if (!shown) {
      shown = new Set<number>()
      chainShownPhase.set(e, shown)
    }
    shown.add(Enemy.phase[e])
  }
  Enemy.chainNext[e] = chained ? NO_CHAIN : chainIndexFor(kind, Enemy.phase[e], index)
  /**
   * **예약된 연계의 수**를 셉니다.
   *
   * 연계 프로브는 15/15 통과인데 실제 플레이에서는 0회입니다. 남은 가설이
   * 둘인데 지금까지 **가르지 못했습니다**:
   *   · 방아쇠가 되는 색이 안 나온다        → 예약 자체가 0
   *   · 예약은 되는데 중간에 끊긴다(무너짐)  → 예약 > 0, 발동 0
   * 세면 갈립니다. 추측으로 고치지 않기 위한 한 줄입니다.
   */
  if (Enemy.chainNext[e] !== NO_CHAIN) chainsArmed++

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
   * ⚠️ 예전 주석은 이렇게 적혀 있었습니다: *"값이 1:1로 같으니 일부러 변환
   * 표를 만들지 않았다 — 표가 있으면 색을 추가할 때 한쪽만 고쳐서 색과
   * 소리가 어긋난다."*
   *
   * **정확히 그 일이 표 없이 일어났습니다.** AttackIntent 에 🟢 Counter(4) 를
   * 더하면서 SfxIntent 는 0~3 에 머물렀고, 이 자리의 `as unknown as` 캐스팅이
   * 타입 검사를 통째로 지워 버려서 아무도 알려 주지 않았습니다. 초록만
   * **소리 없이** 예고되고 있었습니다.
   *
   * 표가 위험한 게 아니라 **검사받지 않는 변환**이 위험했던 것입니다.
   * 그래서 캐스팅을 지우고 `Record<AttackIntent, SfxIntent>` 로 바꿉니다 —
   * 색을 하나 만들면 이 표가 **컴파일 단계에서** 먼저 막습니다.
   * 같은 실수를 INTENT_EMOJI 가 배열이었을 때 이미 한 번 했고(`undefined🟢`),
   * Record 로 바꿔서 잡았습니다. 그 교훈이 여기까지는 안 왔던 것입니다.
   */
  sfx.telegraph(INTENT_TO_SFX[atk.intent], Transform.x[e], Transform.z[e])
}


/**
 * ── 🟢 초록 예고가 **어떻게 끝났는가** ──────────────────────────────
 *
 * 벤치가 이렇게 말합니다: `초록 예고 4회 · 실제 반격 1회`.
 * 그런데 이 두 숫자만으로는 **왜 셋이 답 없이 끝났는지** 알 수 없습니다.
 * 가능한 이야기가 서로 완전히 다른데 처방도 서로 반대입니다:
 *
 *   · 플레이어가 못 답했다        → 반격을 쉽게 (창·사거리·표시)
 *   · 적이 예고 도중 **죽었다**   → 이 적의 체력/등장 거리 문제
 *   · 휘두름까지 갔다(정상)       → 애초에 답 못 한 게 아님. 맞고 배우는 중
 *
 * 같은 자리에서 세 번 배운 것을 또 씁니다 — **결과 하나를 갈래마다 나눠
 * 셉니다.** 그리고 봇이 아니라 **게임이** 셉니다: 예고가 끝나는 순간을
 * 아는 것은 상태 기계뿐입니다.
 *
 * ⚠️ `countered` 는 여기서 세지 않습니다. 반격 판정은 combat.ts 가 하고,
 *    이미 `runStats().counters` 로 나옵니다. 두 곳에서 같은 것을 세면
 *    언젠가 두 숫자가 어긋나고, 그때 어느 쪽을 믿을지 알 수 없게 됩니다.
 *    여기서는 **예고가 끝난 방식**만 셉니다.
 */
/**
 * ── 🎲 **무엇을 왜 골랐는가** ────────────────────────────────────────
 *
 * `npm run boss` 의 *"가중치대로 고른다"* 가 오랫동안 흔들렸습니다. 표본을
 * 7~8회에서 20여 회로 늘렸더니 흔들림이 아니라 **안정적인 어긋남**이
 * 드러났습니다(2.1m 에서 🔴 직격 기대 50% · 실제 24%).
 *
 * 그런데 그때부터 세 번 연속으로 **이론만 세웠습니다** — 연계 탓인가,
 * `preferReach` 탓인가, 광역 자리 대체 탓인가. 셋 다 그럴듯했고 셋 다
 * 근거가 없었습니다. 이 저장소가 이번 세션에 열 번 넘게 배운 것이
 * 정확히 그 자리입니다:
 *
 * > **재기 전의 설명은 결론이 아닙니다.**
 *
 * 문제의 뿌리는 프로브가 **휘두름 수**를 가중치와 비교한다는 것이었습니다.
 * 휘두름에는 굴림이 아닌 것이 섞여 있습니다:
 *   · **연계** — 이전 공격이 예약한 것. 굴린 적이 없습니다.
 *   · **광역 자리 대체** — 굴려서 🟡 이 나왔는데 자리가 차서 다른 것으로
 *     바꿔 답니다. 그 대체는 굴림이 아니라 **목록 순서**로 고릅니다.
 *   · **`preferReach`** — 기다리다 지친 적은 가중치를 통째로 무시합니다.
 *
 * 그래서 게임이 **자기가 무엇을 어떻게 골랐는지** 직접 적습니다.
 * 프로브는 이 장부를 읽고 *"굴려서 고른 것"* 만 가중치와 비교하면 됩니다.
 * 추측할 필요가 없어집니다.
 */
export interface PickRecord {
  kind: number
  /** 고를 때의 거리 — 사거리 밖 패턴이 왜 후보에서 빠졌는지 설명합니다 */
  dist: number
  phase: number
  /** 가중치를 무시하고 **가장 먼 사거리**를 고른 판인가 */
  preferReach: boolean
  /** 굴려서 나온 것. null 이면 후보가 없었습니다 */
  rolled: string
  /** 실제로 건 것. `rolled` 와 다르면 광역 자리가 차서 바뀐 것입니다 */
  chosen: string
  candidates: { id: string; w: number }[]
}
/** 상한을 둡니다 — 장부가 한 판 내내 자라면 그것 자체가 성능 문제가 됩니다. */
const PICK_LOG_CAP = 600
const pickLog: PickRecord[] = []

function notePick(
  e: number,
  kind: number,
  dist: number,
  preferReach: boolean,
  list: EnemyAttackDef[],
  weights: Record<string, number> | undefined,
  rolled: EnemyAttackDef | null,
  chosen: EnemyAttackDef | null,
): void {
  if (pickLog.length >= PICK_LOG_CAP) return
  pickLog.push({
    kind,
    dist: Number(dist.toFixed(2)),
    phase: Enemy.phase[e],
    preferReach,
    rolled: rolled?.id ?? '',
    chosen: chosen?.id ?? '',
    /**
     * 후보와 그 가중치도 같이 적습니다. 기대치를 프로브가 따로 계산하면
     * 사거리 판정(min/max)을 **두 곳**에 두게 되고, 언젠가 한쪽만 고쳐서
     * 프로브가 조용히 다른 기대치를 씁니다.
     */
    candidates: list
      .filter((a) => dist >= a.minRange && dist <= a.maxRange)
      .map((a) => ({ id: a.id, w: weights?.[a.id] ?? a.weight }))
      .filter((c) => c.w > 0),
  })
}

export function readPickLog(): PickRecord[] {
  return pickLog.map((r) => ({ ...r, candidates: r.candidates.map((c) => ({ ...c })) }))
}
export function resetPickLog(): void {
  pickLog.length = 0
}

/**
 * 🔁 **적마다 «직전에 낸 패턴»** — 같은 것이 연달아 나오는 것을 줄이는 데 씁니다.
 * 규칙은 아래 `REPEAT_PENALTY` 자리에 있습니다(왜 필요한지, 숫자까지).
 */
const lastPick = new Map<number, string>()
export function resetLastPicks(): void {
  lastPick.clear()
}

const greenOutcome = { swung: 0, died: 0, countered: 0, broken: 0 }
/** 지금 초록 예고 중인 적들 — 프레임마다 갱신하고, 빠진 것을 결산합니다. */
const greenWinding = new Set<number>()
export function readGreenOutcome(): {
  swung: number
  died: number
  countered: number
  broken: number
} {
  return { ...greenOutcome }
}
export function resetGreenOutcome(): void {
  greenOutcome.swung = 0
  greenOutcome.died = 0
  greenOutcome.countered = 0
  greenOutcome.broken = 0
  greenWinding.clear()
}

/**
 * 한 프레임의 결산. 지난 프레임에 초록 예고 중이던 적 가운데 **이제 아닌**
 * 것들을 분류합니다. 상태를 보고 나누므로 순서에 의존하지 않습니다.
 */
function settleGreenWindups(): void {
  for (const e of [...greenWinding]) {
    if (isAlive(e) && Actor.state[e] === ActorState.Attack) {
      const atk = attackAt(Enemy.kind[e], Enemy.attackIndex[e])
      if (atk.intent === AttackIntent.Counter && Actor.phase[e] === AttackPhase.Windup) continue
      // 아직 공격 중인데 예고가 아니다 = 판정까지 갔다.
      greenWinding.delete(e)
      greenOutcome.swung++
      continue
    }
    greenWinding.delete(e)
    // 죽었는가, 아니면 무너져서(경직) 끊겼는가.
    if (!isAlive(e) || Actor.state[e] === ActorState.Dead) {
      greenOutcome.died++
      continue
    }
    /**
     * 끊긴 것이 **반격 때문인가**, 아니면 다른 무엇인가.
     *
     * 지난번 출력은 `무너져 끊김 2회` 였고 반격도 2회였습니다. 같은 숫자라
     * "그러면 반격이겠지" 하고 넘어갈 뻔했는데, 두 숫자가 **우연히 같은 것**과
     * **같은 사건인 것**은 다릅니다. 이 프로젝트에서 계기를 여덟 번 틀린
     * 이유가 매번 그 자리였습니다. 그래서 잇습니다 — combat.ts 가 찍어 둔
     * 시각을 보고 방금 반격당한 것인지 확인합니다.
     *
     * 0.5초를 창으로 두는 이유: 반격이 들어간 프레임과 예고가 끝났다고
     * 결산되는 프레임이 다를 수 있습니다(이 환경은 한 프레임이 0.1초).
     */
    if (time.simElapsed - Enemy.counteredAt[e] < 0.5) greenOutcome.countered++
    else greenOutcome.broken++
  }
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
  /**
   * 🔊 지금 플레이어가 내는 **소리의 크기 = 속도**.
   *
   * 한 프레임에 한 번만 재서 모든 적이 같은 값을 씁니다. 적마다 따로
   * 재면 언젠가 한쪽만 고쳐져서 "어떤 적은 뛰는 걸 못 듣는" 상태가 됩니다.
   */
  const playerSpeed = Math.hypot(Velocity.x[playerEntity], Velocity.z[playerEntity])
  /**
   * 🍶 지금 플레이어가 **회복 중인가.** 한 프레임에 한 번만 읽어 모든 적이
   * 같은 값을 씁니다 — 위 `playerSpeed` 와 같은 규약입니다(적마다 따로
   * 읽으면 언젠가 한쪽만 고쳐져서 "어떤 적은 못 알아채는" 상태가 됩니다).
   */
  const drinkingNow = playerAlive && Actor.state[playerEntity] === ActorState.Drink
  const ids = enemies.run()

  if (commitGapT > 0) commitGapT = Math.max(0, commitGapT - dt)
  const tokens = grantAttackTokens(ids, enemies.count, px, pz, dt)

  for (let i = 0; i < enemies.count; i++) {
    const e = ids[i]
    if (!isAlive(e)) continue
    if (Actor.state[e] === ActorState.Dead) {
      // 예약을 안고 죽었으면 그것도 **결말**입니다 — 한 번만 세고 지웁니다.
      if (Enemy.chainNext[e] !== NO_CHAIN) {
        chainsDropped.death++
        Enemy.chainNext[e] = NO_CHAIN
        Enemy.openerNext[e] = NO_CHAIN
      }
      continue
    }

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
        /**
         * ⏸ **이 `continue` 가 출혈의 유예 시계도 함께 멈춥니다.**
         *
         * 아래 식는 블록이 통째로 건너뛰어지기 때문입니다. 부수 효과지만
         * **옳은 부수 효과**입니다 — 전환 중에는 무적이라 때려도 안
         * 들어가고, *"못 때린 시간"* 을 태만으로 계산하면 게임이 손을 묶어
         * 놓고 그 값을 플레이어에게 물리는 셈이 됩니다.
         *
         * ⚠️ **부수 효과라서 조용히 사라질 수 있습니다.** 여기를 언젠가
         *    `continue` 없이 풀어 쓰면 아무 오류 없이 규칙만 바뀝니다.
         *    그래서 `npm run bleed` 가 **같은 보스·같은 체력**으로 등을 맞댄
         *    두 창을 재서 못 박아 뒀습니다(창A 무적 −0 · 창B −22.3).
         *    근거 전체는 balance.ts `BLEED` 의 ⏸ 노트에 있습니다.
         *
         * 여기서는 **얼마나 그랬는지만** 셉니다. 안 깎은 것은 장부에 흔적이
         * 안 남아서, 안 세면 다음 사람이 코드를 읽고 상상해야 합니다.
         */
        if (Enemy.bleed[e] > 0) noteBleedBlocked(e, dt)
        continue
      }
      let want = phaseForHp(Health.hp[e] / Health.max[e])
      /**
       * 🎓 **1단계는 색을 몇 가지 보여주기 전에는 안 끝납니다.**
       * (근거는 이 파일 위쪽 `taughtInPhase1` 주석.)
       *
       * ⚠️ **처음엔 체력만 붙잡아 두고 끝냈다가 아무 일도 안 일어났습니다.**
       *    바로 아래 전환은 이미 계산해 둔 `want` 를 쓰는데, 체력을 되돌려도
       *    그 값은 **옛날 체력으로 구한 것**이라 그대로 넘어갔습니다.
       *    붙잡았으면 **판단도 다시 해야** 합니다.
       */
      if (phaseTeachingOn && want > 0 && Enemy.phase[e] === 0) {
        const held = (phase1HeldT.get(e) ?? 0) + dt
        phase1HeldT.set(e, held)
        const seen = taughtInPhase1.get(e)?.size ?? 0
        if (seen < PHASE1_TEACH_COLORS && held < PHASE1_TEACH_CAP) {
          Health.hp[e] = Math.max(
            Health.hp[e],
            Health.max[e] * BOSS_PHASES[1].enterBelow + 0.5,
          )
          want = phaseForHp(Health.hp[e] / Health.max[e])
        }
      }
      if (want > Enemy.phase[e]) {
        Enemy.phase[e] = want
        Enemy.transitionT[e] = PHASE_TRANSITION_TIME
        if (Enemy.chainNext[e] !== NO_CHAIN) chainsDropped.phase++
        Enemy.chainNext[e] = NO_CHAIN
        /**
         * 🎬 **새 페이즈의 첫 패턴을 예약합니다**(있으면).
         * 바로 아래 넉백이 자리를 만들고, 이 예약이 그 자리를 씁니다.
         * 규칙과 근거는 bossPhases.ts `firstAttack` 주석에 있습니다.
         */
        {
          const opener = BOSS_PHASES[want].firstAttack
          const at = opener ? attacksFor(kind).findIndex((a) => a.id === opener) : -1
          Enemy.openerNext[e] = at >= 0 ? at : NO_CHAIN
        }
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

    /**
     * 쿨다운은 **0 아래로도 내려갑니다** — 그 음수가 "준비된 채로 얼마나
     * 오래 못 때리고 있는가"(인내심)입니다. 새 필드를 만들지 않고 이미 있는
     * 값의 부호를 쓰는 이유는 ECS 컴포넌트가 타입 배열이라, 필드 하나를
     * 늘리면 모든 적에게 메모리가 붙기 때문입니다.
     */
    if (Actor.cooldownT[e] > -ATTACK_PATIENCE * 2) Actor.cooldownT[e] -= dt

    /**
     * ── 강인도 회복 ────────────────────────────────────────────────
     *
     * 한동안 안 맞으면 차오릅니다. 회복이 없으면 전투가 길어질수록 누적만
     * 되어서 **결국 무조건 무너지는 것**이 되고, 그건 예전의 "무조건 경직"과
     * 결과가 같습니다. 회복이 있어야 "한 번에 몰아쳐야 무너뜨린다"가 됩니다.
     */
    if (Enemy.brokenT[e] > 0) Enemy.brokenT[e] = Math.max(0, Enemy.brokenT[e] - dt)
    /**
     * 🩸 **출혈은 시간이 지나면 식습니다.**
     *
     * 강인도 회복과 **같은 자리**에서 흐르게 둡니다 — 시간이 흐르는 값은
     * 한 곳에서 다 흐르게 해야 나중에 "왜 이건 안 줄지?"를 찾으러 파일을
     * 뒤지지 않습니다(playerControl 의 타이머 블록과 같은 규약).
     *
     * 식는다는 것이 이 축의 전부입니다 — **이어서 압박하면 유지되고
     * 물러나면 사라집니다.** 안 식으면 "언젠가는 터진다"가 되어, 소울류의
     * 출혈이 아니라 그냥 느린 피해가 됩니다.
     */
    Enemy.bleedIdleT[e] += dt
    if (Enemy.bleedIdleT[e] >= BLEED.decayDelay && Enemy.bleed[e] > 0) {
      const before = Enemy.bleed[e]
      /**
       * 🩸 **몰릴수록 지운 것이 덜 지워집니다** — 근거는 balance.ts
       * `decayFloorRatio`. 규칙은 저기 한 곳에만 있고 여기서는 **바닥까지만**
       * 깎습니다. 체력이 가득한 적에게는 바닥이 정확히 0 이라, 짧게 끝나는
       * 싸움과 허수아비 벤치는 **한 점도 안 움직입니다.**
       *
       * ⚠️ 바닥 **위로 끌어올리지는 않습니다.** `Math.max(floor, …)` 가
       *    아니라 이미 바닥 아래인 값은 그대로 둡니다 — 안 그러면 한 대도
       *    안 때린 적의 게이지가 체력이 깎였다는 이유만으로 차오릅니다.
       *    올리는 것은 타격의 몫이고, 이 값이 하는 일은 **지우지 않는 것**
       *    뿐입니다.
       */
      const hpLeft = Health.max[e] > 0 ? Math.min(1, Math.max(0, Health.hp[e]) / Health.max[e]) : 1
      const floor = bleedMaxOf(Enemy.kind[e]) * BLEED.decayFloorRatio * (1 - hpLeft)
      const next = Enemy.bleed[e] - BLEED.decayPerSec * dt
      Enemy.bleed[e] = Math.max(0, Math.min(Enemy.bleed[e], Math.max(floor, next)))
      // 🩸 **깎은 쪽이 셉니다** — 관측은 프레임 사이에 날아간 양을 놓칩니다.
      noteBleedDecay(e, before - Enemy.bleed[e])
    }
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
    // 💥 오사 재장전 — 근거는 components.ts `crossfireT` 에 적어 뒀습니다.
    if (Status.crossfireT[e] > 0) Status.crossfireT[e] = Math.max(0, Status.crossfireT[e] - dt)

    // 경직 중에는 아무것도 못 합니다 — 플레이어가 흐름을 끊을 수 있는 근거
    if (Actor.state[e] === ActorState.Stagger) {
      /**
       * 무너지면 **예약해 둔 연계는 사라집니다.**
       *
       * 원래는 `Enemy.chainNext` 가 그대로 남아 있었습니다. 다음 공격을
       * 걸 때 덮어써지니 눈에 띄는 버그는 아니었지만, "예약이 살아 있는데
       * 영원히 안 나간다"는 상태가 존재하는 것 자체가 셈을 흐립니다.
       * 여기서 명시적으로 지우고, **어느 박자에서 끊겼는지**를 기록합니다.
       *
       * `Actor.phase` 는 breakPoise 가 건드리지 않아서 끊긴 순간의 값이
       * 그대로 남아 있습니다(combat.ts breakPoise 참고).
       */
      /**
       * ── 💢 **무거운 적은 예약을 들고 일어납니다** ────────────────────
       *
       * 자동 플레이에서 보스의 연계가 **예약 16회 · 발동 3회 · 무너져서
       * 끊김 10회**로 나왔습니다. 주력기에 후속을 붙여 박자를 고치려 했는데,
       * 붙인 만큼 그대로 무너져서 증발했습니다.
       *
       * 원래 여기서 지운 이유는 설계가 아니라 **셈의 청결**이었습니다
       * (*"예약이 살아 있는데 영원히 안 나가는 상태가 셈을 흐린다"*).
       * 그런데 그 청결이 보스의 차례를 통째로 지우고 있었습니다.
       *
       * 참고한 게임들은 전부 반대로 합니다 — 오공의 보스는 무너진 뒤
       * **일어나면서 반격**하고, 엘든 링도 경직에서 회복하는 즉시 다음
       * 타를 냅니다. 플레이어는 무방비 동안 이미 값을 받았습니다(처형까지).
       * 일어난 뒤까지 공짜일 이유는 없습니다.
       *
       * ⚠️ **잡몹은 그대로 지웁니다.** 잡몹을 계속 무너뜨려 흐름을 끊는 것은
       *    군중을 다루는 재미이고, 잡몹이 일어나며 반격하면 다대일이 그냥
       *    벌이 됩니다. 이 규칙도 무거운 적에게만 뜻이 있습니다.
       */
      const holdsChain = cfg.heavy === true && Enemy.chainNext[e] !== NO_CHAIN
      if (!holdsChain && Enemy.chainNext[e] !== NO_CHAIN) {
        const at = Actor.phase[e]
        chainsLost[at === 0 ? 0 : at === 1 ? 1 : 2]++
        Enemy.chainNext[e] = NO_CHAIN
      }
      Actor.timer[e] -= dt
      if (Actor.timer[e] <= 0) {
        Actor.state[e] = ActorState.Idle
        if (holdsChain) {
          // 일어나면서 곧바로 이어 냅니다 — 쿨다운도 토큰도 안 봅니다
          // (연계는 이미 시작한 하나의 공격이 이어지는 것이라는 같은 근거).
          const next = Enemy.chainNext[e]
          Enemy.chainNext[e] = NO_CHAIN
          Actor.cooldownT[e] = 0
          chainsResumed++
          commitAttack(e, playerEntity, kind, next, ph.windupScale, true)
        }
      }
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
        if (Enemy.chainNext[e] !== NO_CHAIN) chainsDropped.leash++
        Enemy.chainNext[e] = NO_CHAIN
        Enemy.openerNext[e] = NO_CHAIN
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

    /**
     * 레벨 모드에서는 **방 단위**로 좁힙니다(balance.ts LEVEL_AGGRO_RANGE 설계 노트).
     * 종류별 값을 그대로 쓰면 존 전체가 한 번에 깨어나 한 줄로 걸어옵니다.
     */
    /**
     * 원거리 적은 **자기 사거리 + 여유**만큼은 확보해 줍니다.
     * 사거리 12m 인 적을 14m 에서 깨우면 여유가 2m 뿐이라, 한 발 쏘고
     * 끝납니다(balance.ts LEVEL_AGGRO_LEAD 설계 노트). 근접 적은
     * 사거리가 작아 이 식이 14m 를 넘지 않으므로 **아무것도 안 바뀝니다.**
     */
    // 식 자체는 `wakeRangeOf` 하나뿐입니다 — 프로브도 **같은 함수**를 읽습니다.
    const range = wakeRangeOf(kind)
    /**
     * ⚠️ **직선거리가 아니라 걸어야 하는 거리로 깨웁니다.**
     *
     * 자동 플레이가 잡았습니다: 성벽마루 건너편의 적이 직선 12.4m 라고
     * 깨어나 영원히 벽을 향해 걸었습니다(실제 경로는 98m). 그 적 하나가
     * 근처 화톳불을 영원히 잠그기까지 했습니다 — 사람에게는 "화면에 적이
     * 없는데 쉴 수가 없다"로 보입니다.
     *
     * 수직 지도를 만든 순간 생긴 문제입니다. 한 줄짜리 지도에서는 직선과
     * 경로가 거의 같아서 드러나지 않았습니다.
     */
    // 지형이 없으면(아레나) 예전처럼 직선거리. 지형이 있는데 **길이 아예 없으면**
    // 그 적은 나에게 올 수 없으므로 영원히 안 깨어납니다.
    const effectiveDist = reachDistance
      ? (reachDistance(Transform.x[e], Transform.z[e]) ?? Infinity)
      : dist
    /**
     * 👁 **보는 거리와 듣는 거리를 나눕니다** (balance.ts `AWARE`).
     *
     * 앞쪽 부채꼴 안이면 원래 거리에서 보고, 등 뒤면 **내가 낸 소리만큼**
     * 듣습니다. 이것이 있어야 *"못 본 적의 등에 먼저 꽂는다"* 가 존재하고,
     * 동시에 *"뛰어서 지나가면 들킨다"* 도 같이 성립합니다.
     *
     * ⚠️ 거리는 위에서 구한 **걸어야 하는 거리**를 그대로 씁니다. 방향만
     *    새로 봅니다 — 직선거리로 되돌아가면 이 파일이 이미 겪은 "벽 건너
     *    적이 깨어난다"가 다시 살아납니다.
     */
    if (Enemy.aggro[e] === 0) {
      const fx = Math.sin(Transform.rotY[e])
      const fz = Math.cos(Transform.rotY[e])
      const dx = px - Transform.x[e]
      const dz = pz - Transform.z[e]
      const len = Math.hypot(dx, dz) || 1
      const inFront =
        (dx * fx + dz * fz) / len >= Math.cos(((AWARE.frontArcDeg / 2) * Math.PI) / 180)
      if (effectiveDist <= (inFront ? range : hearDistance(playerSpeed))) {
        Enemy.aggro[e] = 1
        // 사건을 남깁니다 — 눈으로 봤는지 소리로 들었는지까지 같이.
        spotEvents.push({ entity: e, x: Transform.x[e], z: Transform.z[e], heard: !inFront })
      }
      // 아직 못 봤으면 유예를 채워 둡니다 — 깨어난 뒤에도 잠깐 남습니다.
      Enemy.unawareT[e] = AWARE.ambushGrace
    } else {
      if (Enemy.unawareT[e] > 0) Enemy.unawareT[e] = Math.max(0, Enemy.unawareT[e] - dt)
      /**
       * 🚪 **깬 뒤에도 「걸어서 닿는가」를 계속 묻습니다.**
       *
       * 지금까지 이 질문은 깨울 때 **딱 한 번** 했습니다. 그래서 깬 뒤에
       * 플레이어가 벽 반대편으로 돌아가면, 그 적은 직선 6m 만 보고
       * **영원히 예고를 띄웠습니다**(실측: 경로 78m). 문턱과 근거는
       * balance.ts `LEVEL_DEAGGRO_RATIO` 한 곳에만 있습니다.
       *
       * ⚠️ **예고·판정 중에는 안 풉니다. 다만 후딜에서는 풉니다.**
       *    이미 나간 공격을 지형 때문에 중간에 지우면 플레이어가 본 예고가
       *    아무 이유 없이 사라집니다 — 그건 규칙이 아니라 마법입니다.
       *
       *    처음엔 *"공격 상태면 통째로 건너뛴다"* 로 적었는데, 프로브가
       *    **한 번도 안 풀린다**고 했습니다. 벽에 붙은 적은 휘두름과 후딜을
       *    끊임없이 반복해서 `state` 가 거의 항상 `Attack` 이기 때문입니다.
       *    실제로 자동 플레이의 그 적도 `{"attacking":true,"recovering":true}`
       *    였습니다. **후딜에는 화면에 아무 약속도 안 떠 있으므로**, 거기서
       *    푸는 것은 아무것도 지우지 않습니다.
       *
       * ⚠️ 보스는 제외합니다. 보스에게는 아레나 리쉬라는 **다른 규칙**이
       *    이미 있고, 둘을 겹치면 어느 쪽이 보스를 되돌렸는지 못 가립니다.
       */
      if (
        !isBoss &&
        !(
          Actor.state[e] === ActorState.Attack &&
          (Actor.phase[e] as AttackPhase) !== AttackPhase.Recovery
        ) &&
        effectiveDist > LEVEL_DEAGGRO_MIN &&
        effectiveDist > dist * LEVEL_DEAGGRO_RATIO
      ) {
        // 다시 재웁니다 — 다음 프레임부터 **깨우는 쪽 문턱**이 다시 판단합니다.
        Enemy.aggro[e] = 0
        Enemy.unawareT[e] = AWARE.ambushGrace
        deaggroEvents.push({ entity: e, straight: dist, walk: effectiveDist })
      }
    }

    if (Enemy.aggro[e] === 0) {
      decayVelocity(e, dt, 5)
      continue
    }

    if (Actor.state[e] === ActorState.Attack) {
      const phase = Actor.phase[e] as AttackPhase
      const atk = attackAt(kind, Enemy.attackIndex[e])

      if (phase === AttackPhase.Windup) {
        /**
         * 🎯 **예고당 각도**로 돕니다 — 규칙과 근거는 balance.ts
         * `WINDUP_TURN_BUDGET_DEG` 에 한 곳으로 모아 두었습니다.
         *
         * 분모는 설정값이 아니라 **이번 공격에 실제로 건 예고 길이**입니다
         * (`windupLen`) — 페이즈 배율과 뜸(`hold`)이 이미 반영돼 있어서,
         * 뜸을 들인 만큼 천천히 돌게 됩니다. 그게 뜸의 값어치입니다.
         */
        /**
         * ⚠️ **뜸(`hold`)은 분모에서 뺍니다.**
         *
         * `windupLen` 을 그대로 나누면 뜸을 들일수록 적이 **천천히** 돌게
         * 됩니다 — 총 회전량이 45°로 고정되니까요. 그러면 "뜸 들이기"가
         * 플레이어에게 **공짜 각도**를 주는 셈이라, 읽기 싸움으로 만들려던
         * 장치가 거꾸로 적을 약하게 만듭니다(실측에서 150°/s 가 그렇게
         * 빠져나갔습니다).
         *
         * 그래서 **평소 예고 길이**로 비율을 정하고, 뜸 동안에도 같은
         * 속도로 계속 돕니다. 뜸의 값어치는 *"더 오래 볼 수 있다"* 이지
         * *"더 쉽게 돌아 들어간다"* 가 아닙니다.
         */
        const base = Math.max(0.05, Enemy.windupLen[e] - Enemy.heldT[e])
        const rate = Math.min(cfg.turnSpeedDeg, WINDUP_TURN_BUDGET_DEG / base)
        turnToward(e, toPlayer, rate, dt)
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
      } else if (phase === AttackPhase.Windup && atk.lungeSpeed && dist > atk.reach * 0.7) {
        /**
         * 🟢 돌진 — **자기 정면으로만** 나갑니다 (설계 근거는 enemyAttacks.ts
         * `lungeSpeed` 주석). 여기서 `dx/dz`(플레이어 방향)를 쓰면 추적 공격이
         * 되어 옆으로 꺾어 피할 방법이 사라집니다. 그래서 `rotY` 를 씁니다 —
         * 예고 중 회전은 바로 위에서 이미 평소의 30%로 묶여 있습니다.
         */
        const fx = Math.sin(Transform.rotY[e])
        const fz = Math.cos(Transform.rotY[e])
        // 가속을 크게 잡습니다. 돌진은 "점점 빨라지는 것"이 아니라 **터지는 것**이고,
        // 천천히 붙으면 위에서 계산한 1.4초 예산이 그대로 사라집니다.
        const accel = 60 * dt
        Velocity.x[e] += clampMag(fx * atk.lungeSpeed - Velocity.x[e], accel)
        Velocity.z[e] += clampMag(fz * atk.lungeSpeed - Velocity.z[e], accel)
      } else {
        decayVelocity(e, dt, 12)
      }

      /**
       * ⏱ **「지금」 박자** — 답해야 하는 순간에 한 번만 울립니다.
       *
       * 화면의 「지금」 신호(visuals.ts)는 **그 적을 보고 있어야** 도움이
       * 됩니다. 벤치가 말하길 둘 이상과 싸우는 시간이 **61%**(최대 7마리)
       * 이므로 다 볼 수 없습니다. 세키로가 이 신호를 소리로 준 이유입니다.
       *
       * **경계를 넘는 그 프레임에만** 울립니다 — `timer` 가 창 위에 있다가
       * 아래로 내려가는 순간. 깃발을 따로 두지 않아도 정확히 한 번입니다.
       *
       * ⚠️ 타이밍으로 푸는 색에만(`isTimingAnswer`). 🟡 은 걸어 나가야 하고
       *    🟣 는 사거리 밖에 있어야 하므로, 마지막 순간의 박자는 도움이
       *    아니라 **이미 늦은 때 알려 주는 거짓말**입니다.
       */
      if (
        phase === AttackPhase.Windup &&
        isTimingAnswer(atk.intent) &&
        Actor.timer[e] > GUARD.window &&
        Actor.timer[e] - dt <= GUARD.window
      ) {
        sfx.nowBeat(Transform.x[e], Transform.z[e])
      }
      Actor.timer[e] -= dt
      if (Actor.timer[e] <= 0) {
        if (phase === AttackPhase.Windup) {
          Actor.phase[e] = AttackPhase.Active
          Actor.timer[e] = atk.active
          Actor.hitsLeft[e] = 1
          Actor.nextHitT[e] = 0
          /**
           * 🔁 아직 아무것도 못 했다고 세워 둡니다. combat.ts 가 플레이어를
           * 맞히면 지웁니다. 아래에서 판정이 끝날 때 이 값을 읽습니다.
           *
           * ⚠️ `hitsLeft` 로는 못 가릅니다 — 그 값은 **맞았든 안 맞았든**
           *    닳습니다(combat.ts 의 `hitsLeft -= 1` 은 `landed` 와 무관).
           *    실제로 처음엔 그걸 쓰려다가, 헛쳐도 0이 되는 것을 보고
           *    깃발을 따로 뒀습니다.
           */
          Enemy.whiffing[e] = 1
          // 적의 궤적은 **무게를 안 실어 보냅니다**(0). 적이 무엇을 하는지는
          // 지면의 4색 예고가 이미 말하고, 궤적까지 등급을 가지면 그 색과
          // 다투게 됩니다 — 화면이 시끄러워지는 만큼 색이 안 읽힙니다.
          ctx.onSwing(Transform.x[e], Transform.z[e], Transform.rotY[e], atk.reach, atk.arcDeg, 0)
          // 실제로 휘두르는 순간. 예고음(windup 시작)과 시간이 벌어져 있어서
          // "예고 → 발동" 두 박자가 귀로도 잡힙니다.
          sfx.swing(cfg.heavy ? 0.95 : 0.55, Transform.x[e], Transform.z[e])
        } else if (phase === AttackPhase.Active) {
          Actor.phase[e] = AttackPhase.Recovery
          /**
           * 🔁 **헛쳤으면 더 오래 무방비입니다.** 근거는 enemyAttacks.ts 의
           * `whiffRecovery` 주석에 있습니다(몬헌·엘든링·격투게임이 공유하는
           * 규칙: 맞았을 때가 아니라 **빗나갔을 때** 빈틈이 생깁니다).
           *
           * 값을 여기서 고르지 않고 `openingOf()` 에 물어보는 이유:
           * 같은 판단이 프로브가 읽는 `punishTable()` 에도 필요한데,
           * 두 곳에 같은 식을 적어 두면 한쪽만 고치는 날 **프로브가
           * 게임을 안 재게 됩니다.** 규칙은 한 곳에만 둡니다.
           */
          Actor.timer[e] = Enemy.whiffing[e] === 1 ? openingOf(atk) : atk.recovery
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
            commitAttack(e, playerEntity, kind, next, ph.windupScale, true)
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

    /**
     * ── 오래 못 때리고 있으면 **홱 돌아봅니다** ──────────────────────
     *
     * 자동 플레이가 보스전을 뜯어 보여 줬습니다:
     *
     *     보스전 70.5초 · 보스가 사거리(3.4m) 안에 있던 시간 **16%**
     *     예고를 띄우고 있던 시간 **6%** · 휘두름 **4회** · 연계 **0회**
     *
     * 3페이즈짜리 절정인데 70초에 네 번 휘두릅니다. 설계해 둔 연계
     * (🔵→🔴, 🟣→🔴, 🔵→🟡)는 **한 번도 나오지 않았습니다.**
     *
     * 원인은 밸런스가 아니라 조준이었습니다. 공격을 커밋하려면 정면 45°
     * 안에 들어와야 하는데, 보스는 100°/s 로 돕니다. 플레이어는 5.4m/s 로
     * 4m 반경을 도니까 각속도가 비슷합니다 — **영원히 조준이 안 맞습니다.**
     * 그동안 보스는 돌기만 하고, 그래서 존의 절정이 존에서 가장 안전한
     * 전투가 되어 있었습니다.
     *
     * 소울류 보스가 이걸 푸는 방법은 "더 빨리 걷기"가 아닙니다 —
     * **크게 한 번 노려보고 커밋합니다.** 준비가 된 채로 일정 시간 조준을
     * 못 맞추면 회전을 확 올려 겨눕니다. 예고 시간은 그대로이므로 플레이어가
     * 읽고 피할 여지는 하나도 줄지 않습니다. 줄어드는 것은 **아무 일도
     * 일어나지 않는 시간**뿐입니다.
     */
    const impatient = Actor.cooldownT[e] <= -ATTACK_PATIENCE
    turnToward(e, toPlayer, cfg.turnSpeedDeg * snareScale * (impatient ? 4 : 1), dt)

    const facingError = Math.abs(wrapAngle(toPlayer - Transform.rotY[e]))
    const inRange = dist <= cfg.attackRange

    /**
     * 🍶 **회복을 노립니다** — 적이 플레이어의 상태를 읽는 유일한 자리.
     *
     * 근거는 balance.ts `PUNISH_HEAL` 설계 노트에 적어 두었습니다.
     * 요약하면: 마시기에 무적을 일부러 안 넣어 놓고(components.ts),
     * 정작 그 위험을 만들 주체가 아무도 없었습니다.
     *
     * ⚠️ **예고는 하나도 안 줄입니다.** 당기는 것은 쿨다운뿐이고,
     *    토큰도 그대로 지킵니다. 즉 *"읽으면 답이 있다"* 와
     *    *"한 번에 한 명만 덤빈다"* 는 그대로입니다. 줄어드는 것은
     *    **아무 일도 안 일어나는 시간**뿐입니다 — 바로 위 `impatient`
     *    (노려보다 커밋)가 이미 쓴 것과 같은 논리입니다.
     *
     * 한 번 당기면 그걸로 끝입니다(이미 `cutTo` 아래면 안 건드림).
     * 매 프레임 다시 당기면 마시는 내내 쿨다운이 0에 붙어 있어서,
     * 마시기가 끝난 뒤까지 연타로 이어집니다.
     */
    if (
      drinkingNow &&
      dist <= cfg.attackRange * PUNISH_HEAL.rangeMult &&
      Actor.cooldownT[e] > PUNISH_HEAL.cutTo
    ) {
      Actor.cooldownT[e] = PUNISH_HEAL.cutTo
      healPunishArmed++
    }

    // ---- 공격 개시: 거리에 맞는 패턴을 골라 예고를 띄웁니다 ----
    //
    // 사거리를 `cfg.attackRange` 하나로 재던 것을 **패턴별 사거리**로 바꿨습니다.
    // 보스의 갈고리(11m)처럼 멀리서만 쓰는 패턴이 생기면, 접근 판정 하나로는
    // 표현할 수 없습니다. "거리마다 다른 색이 나온다"가 이 구조에서 나옵니다.
    //
    // **공격 토큰**이 있어야 커밋할 수 있습니다(enemyAttacks.ts 설계 노트).
    // 토큰이 없는 적은 그냥 다음 판정으로 흘러가 노려보며 기다립니다.
    /**
     * 🔎 문 앞에서 셉니다 — **순서가 곧 뜻**입니다(먼저 막는 것이 범인).
     * 위 `idleReasons` 주석에 왜 여기서 세는지 적어 두었습니다.
     */
    if (!tokens.has(e)) idleReasons.token++
    else if (Actor.cooldownT[e] > 0) idleReasons.cooldown++
    else if (facingError > ATTACK_FACING_TOLERANCE) idleReasons.facing++

    /**
     * 🚦 **같은 판정을 적마다도 남깁니다**(components.ts `idleWhy` 설계 노트).
     * 합계만으로는 *"저 한 마리가 왜 못 쐈는가"* 에 답할 수 없습니다.
     *
     * ⚠️ 순서가 곧 뜻입니다 — **먼저 막는 문이 범인**입니다. 위 합계와
     *    같은 순서를 씁니다. 두 곳이 다른 순서를 쓰면 두 숫자가 어긋나고,
     *    그때 어느 쪽을 믿을지 알 수 없게 됩니다.
     * ⚠️ 토큰 줄에 **아예 못 선** 경우(자기 띠 밖이라 `hasAttackInBand` 가
     *    걸렀을 때)도 `!tokens.has(e)` 로 보입니다. 그 둘은 고칠 곳이
     *    다르므로(토큰 수 vs 자리·사거리) 여기서 갈라 둡니다.
     */
    /**
     * ── 🎟 **「토큰 탓」을 둘로 가릅니다** ─────────────────────────────
     *
     * 첫 판에서 이 눈금이 *"쏘는 자가 사거리 안에 있던 시간의 **57%** 를
     * 토큰 때문에 기다렸다"* 고 찍었습니다. 그대로 읽으면 처방은 하나뿐
     * 입니다 — **토큰을 늘려라.**
     *
     * 그런데 그 57% 는 **부풀려진 숫자**입니다. 위 합계는 「먼저 막는
     * 문이 범인」 순서라, **어차피 쿨다운이라 못 쏠 프레임까지** 토큰
     * 탓으로 셉니다. 토큰이 있었어도 그 프레임엔 아무 일도 안 일어났을
     * 것이므로, 그 몫만큼 토큰을 늘려 봐야 **아무것도 안 바뀝니다** —
     * 대신 동시 예고가 늘어 다대일 설계(색이 서로를 가리지 않게)만
     * 흔들립니다.
     *
     * 그래서 토큰을 두 값으로 나눕니다:
     *   · 1 **토큰만** — 토큰만 있었으면 **지금 쐈을** 프레임. 진짜 병목.
     *   · 5 **토큰+**  — 토큰이 있어도 못 쐈을 프레임(쿨다운·바라보기).
     *
     * 「아무도 못 넘는 문턱은 눈금이 아니라 벽」의 짝입니다 — **고쳐도
     * 안 바뀌는 몫을 병목이라 부르면 안 됩니다.**
     */
    const otherGatesOpen =
      Actor.cooldownT[e] <= 0 && facingError <= ATTACK_FACING_TOLERANCE
    Enemy.idleWhy[e] = !tokens.has(e)
      ? !hasAttackInBand(attacksFor(kind), dist)
        ? 4
        : otherGatesOpen
          ? 1
          : 5
      : Actor.cooldownT[e] > 0
        ? 2
        : facingError > ATTACK_FACING_TOLERANCE
          ? 3
          : 0

    if (tokens.has(e) && Actor.cooldownT[e] <= 0 && facingError <= ATTACK_FACING_TOLERANCE) {
      const list = attacksFor(kind)
      /**
       * 기다리다 지친 적은 **거리를 좁히는 패턴**을 고릅니다.
       * (enemyAttacks.ts pickAttack 의 preferReach 설계 노트 참고)
       * 근접 사거리 안에 이미 들어와 있으면 평소대로 굴립니다 — 코앞에서까지
       * 긴 패턴만 나오면 그게 또 하나의 단조로움이 됩니다.
       */
      const wantReach = impatient && dist > cfg.attackRange
      /**
       * 🎓 **1단계에서는 아직 안 보여준 색을 먼저 고릅니다.**
       *
       * ── 왜 확률에 맡기면 안 되는가 ────────────────────────────────
       * 처음엔 "색 셋을 볼 때까지 전환을 미룬다"만 걸었습니다. 그랬더니
       * 세 판 중 두 판이 **12초 상한까지 붙잡혀** 있었습니다. 붙어서 싸우는
       * 거리에서 고를 수 있는 색이 정확히 셋인데, 가중치 굴림이 같은 색을
       * 계속 뽑았기 때문입니다. 가르치는 구간을 **주사위에 맡긴** 셈입니다.
       *
       * 소울류·몬헌의 보스가 첫 조우에서 대표 패턴을 차례로 보여 주는 것은
       * 우연이 아닙니다. 가르칠 것이 남았으면 **그것부터** 냅니다.
       *
       * 새 경로를 만들지 않고 **가중치 덮어쓰기**로 합니다 — 이 파일이 이미
       * 페이즈 성격을 그렇게 만들고 있고(패턴을 복제하지 않는 이유는
       * enemyAttacks.ts `weights` 주석), 거리·광역 제한 같은 나머지 규칙이
       * 그대로 살아 있습니다.
       */
      let weights = ph.weights
      if (phaseTeachingOn && isBoss && Enemy.phase[e] === 0) {
        const seen = taughtInPhase1.get(e)
        const fresh = list.filter(
          (a) => !seen?.has(String(a.intent)) && dist >= a.minRange && dist <= a.maxRange,
        )
        // 남은 색이 지금 거리에서 하나도 안 닿으면 평소대로 굴립니다.
        if (fresh.length > 0) {
          const only: Record<string, number> = {}
          for (const a of list) only[a.id] = fresh.includes(a) ? (weights?.[a.id] ?? a.weight) : 0
          weights = only
        }
      }
      /**
       * ── 🔁 **직전에 낸 것에는 벌점을 줍니다** ─────────────────────────
       *
       * ── 무엇이 문제였나 (재고 나서 넣습니다) ──────────────────────────
       * `npm run pace` 가 오래 빨간 채였고, 그 프로브가 스스로 원인을
       * 이렇게 적어 뒀습니다 — *"구간 폭의 원인이 여정이 아니라 **보스**
       * (패턴 선택)"* (판마다 **5.7배**).
       *
       * 그래서 보스의 굴림을 세어 봤습니다(`npm run boss` 의 새 줄):
       *
       *     연달아 같은 것 12/46쌍 = **26%** · 독립 굴림이라면 33%
       *     가장 긴 연속 **4회**
       *
       * 실측이 독립 굴림의 기대치와 사실상 같습니다 — **당연합니다.
       * 여기엔 직전 것에 대한 벌점이 없었습니다.** 매번 새로 굴리니 같은
       * 것이 연달아 나올 확률이 Σp² 이고, 붙어 싸우는 거리의 후보가 셋이면
       * 약 3분의 1, 네 번 연속도 실제로 나왔습니다.
       *
       * ── 왜 그게 나쁜가 (재미의 문제입니다) ────────────────────────────
       * 이 게임이 재미있다고 정한 지점은 *"예고를 읽고 대응한다"* 입니다.
       * 같은 색이 세 번 연속 나오면 **읽을 것이 없습니다** — 첫 번째만
       * 읽기이고 나머지는 반복입니다. 반대로 셋이 골고루 오면 배운 것이
       * 전부 쓰입니다. 세키로·몬스터헌터·검은신화 오공의 보스가 같은
       * 기술을 연달아 잘 안 내는 이유가 이것이고(엘든 링은 내되 사이를
       * 벌립니다), 이 저장소가 이미 같은 판단을 한 자리도 있습니다 —
       * 바로 위 **1단계 학습 잠금**이 *"가르칠 것이 남았으면 그것부터"* 라고
       * 굴림에 손을 댑니다. 같은 생각의 **평생판**입니다.
       *
       * ── 왜 «금지»가 아니라 «벌점»인가 ────────────────────────────────
       * 0 으로 막으면 두 가지가 깨집니다. 후보가 하나뿐인 거리에서는 낼
       * 것이 없어지고(그 적은 멍하니 섭니다 — 광역 자리에서 배운 것:
       * **막는 게 아니라 바꾸는 것**), *"절대 두 번 연속은 없다"* 는
       * 규칙을 플레이어가 금방 외웁니다. 그러면 이번엔 **읽기가 필요
       * 없어집니다** — 반복이 없다는 것 자체가 정보가 되니까요.
       * 0.3 배면 셋짜리 후보에서 반복이 33% → **약 17%** 로 줄고,
       * 여전히 가끔은 두 번 옵니다.
       *
       * ── 왜 여기(가중치 덮어쓰기)에 넣는가 ────────────────────────────
       * 새 경로를 만들지 않습니다. 그러면 거리·광역·오프너 같은 나머지
       * 규칙이 그대로 살고, 무엇보다 **장부가 저절로 정직해집니다** —
       * `notePick` 은 후보의 가중치를 *여기서 정한 값 그대로* 적으므로,
       * 「가중치대로 고른다」 검사의 기대치도 벌점을 포함한 값이 됩니다.
       * (벌점을 pickAttack 안에 숨겼다면 그 검사가 **거짓으로 빨개졌을**
       * 것입니다.)
       */
      const prev = lastPick.get(e)
      if (prev) {
        const scaled: Record<string, number> = {}
        for (const a of list) {
          const w = weights?.[a.id] ?? a.weight
          scaled[a.id] = a.id === prev ? w * REPEAT_PENALTY : w
        }
        weights = scaled
      }
      /**
       * 🎬 **오프너가 예약돼 있으면 굴리지 않습니다.**
       *
       * 굴림(`pickAttack`)은 거리로 후보를 거릅니다. 그런데 오프너의 존재
       * 이유가 바로 *"거리 때문에 영영 후보가 못 되는 패턴을 한 번은 낸다"*
       * 이므로, 여기서 심사를 다시 하면 아무것도 안 바뀝니다.
       * 나머지 규칙(쿨다운·토큰·방향)은 위에서 이미 다 지켰습니다.
       */
      const opener = Enemy.openerNext[e]
      if (opener !== NO_CHAIN) {
        Enemy.openerNext[e] = NO_CHAIN
        idleReasons.committed++
        /**
         * 광역 자리는 **깎기만 하고 막지는 않습니다.**
         * 지금 오프너인 `boss_charge` 는 60° 라 어차피 해당이 없지만,
         * 나중에 누가 넓은 패턴을 오프너로 적어 두면 이 줄이 없을 때
         * 자리를 **쓰고도 안 쓴 척**하게 됩니다 — 그러면 같은 프레임에
         * 광역이 둘 나가서 "동시에 하나만"이라는 약속이 조용히 깨집니다.
         * 막지 않는 이유는 위와 같습니다. 오프너는 심사 대상이 아닙니다.
         */
        if (attackAt(kind, opener).arcDeg >= WIDE_ARC_DEG) wideSlotsLeft--
        commitGapT = ATTACK_COMMIT_GAP
        tokens.delete(e)
        // 🔁 오프너도 **플레이어가 본 것**이므로 다음 굴림의 벌점 대상이 됩니다.
        lastPick.set(e, attackAt(kind, opener).id)
        commitAttack(e, playerEntity, kind, opener, ph.windupScale)
        decayVelocity(e, dt, 12)
        continue
      }
      const rolled = pickAttack(list, dist, combatRng.next(), weights, wantReach)
      let picked = rolled
      // 광역 자리가 찼으면 좁은 패턴으로 바꿔 답니다. 그냥 취소하면 그 적이
      // 아무것도 안 하고 서 있게 되어 전투가 심심해집니다 — 막는 게 아니라 **바꾸는** 것입니다.
      if (picked && picked.arcDeg >= WIDE_ARC_DEG && wideSlotsLeft <= 0) {
        picked = list.find((a) => a.arcDeg < WIDE_ARC_DEG && dist >= a.minRange && dist <= a.maxRange) ?? null
      }
      notePick(e, kind, dist, wantReach, list, weights, rolled, picked)
      if (!picked) idleReasons.noPattern++
      if (picked) {
        idleReasons.committed++
        if (picked.arcDeg >= WIDE_ARC_DEG) wideSlotsLeft--
        commitGapT = ATTACK_COMMIT_GAP
        tokens.delete(e)
        /**
         * 🔁 **낸 것을 적어 둡니다** — 다음 굴림에서 이 id 가 벌점을 받습니다.
         *
         * ⚠️ 굴림과 오프너만 적습니다. **연계(chain)는 안 적습니다** —
         *    연계는 설계자가 «이 순서로 이어진다»고 짜 둔 한 줄이라,
         *    그 안의 반복은 우연이 아니라 의도입니다. 여기서 재는 것은
         *    *"주사위가 같은 눈을 연달아 냈는가"* 입니다.
         */
        lastPick.set(e, picked.id)
        commitAttack(e, playerEntity, kind, list.indexOf(picked), ph.windupScale)
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
      /**
       * ── 🕳 **기다리는 적은 옆으로 벌어집니다** ──────────────────────
       *
       * ── 왜 (재고 나서 넣었습니다) ─────────────────────────────────
       * 공격 토큰(#20)은 *동시에 때리는 수*를 막습니다. 그런데 **안 때리는
       * 적이 무엇을 하는지**는 아무도 재지 않았습니다. 7마리에 둘러싸여
       * 재 보니, 가장 좁았던 순간 이웃 사이의 가장 넓은 틈이 **0.70m** 이고
       * 플레이어 몸 지름은 **0.90m** 였습니다 — **빠져나갈 틈이 없습니다.**
       *
       * 이 게임의 4색은 전부 *"움직여서 답한다"* 입니다(구르기 · 걸어서 이탈 ·
       * 사거리 밖). 나갈 틈이 없으면 **색 전체가 무효**가 됩니다. 아캄·니오·
       * 섀도 오브 모르도르가 대기 중인 적을 **돌게** 만드는 이유가 이것입니다 —
       * 안 때려도 몸으로 막으면 그건 난이도가 아니라 잠금입니다.
       *
       * ⚠️ 간격의 기준을 숫자로 적지 않습니다. *"두 몸 사이로 플레이어가
       *    지나갈 만큼"* 이므로 **몸 반지름들에서** 나옵니다:
       *        내 반지름 + 이웃 반지름 + 플레이어 지름
       *    몸 크기를 손보면 이 간격도 따라 움직입니다.
       *
       * 미는 힘은 **약하게**(접근 가속의 1/3) 둡니다. 세게 밀면 서로 튕겨
       * 나가 포위가 풀려 버리고, 그건 다대일 설계를 없애는 것입니다.
       */
      let sx = 0
      let sz = 0
      for (let j = 0; j < enemies.count; j++) {
        const o = ids[j]
        if (o === e || !isAlive(o) || Actor.state[o] === ActorState.Dead) continue
        if (Enemy.aggro[o] === 0) continue
        const ox = Transform.x[e] - Transform.x[o]
        const oz = Transform.z[e] - Transform.z[o]
        const od = Math.hypot(ox, oz)
        const want = cfg.radius + enemyDef(Enemy.kind[o]).radius + PLAYER.radius * 2
        if (od > 0.0001 && od < want) {
          sx += (ox / od) * (want - od)
          sz += (oz / od) * (want - od)
        }
      }
      if (sx !== 0 || sz !== 0) {
        const sd = Math.hypot(sx, sz)
        const push = cfg.moveSpeed * 0.85 * snareScale
        const accel = 9 * dt
        Velocity.x[e] += clampMag((sx / sd) * push - Velocity.x[e], accel)
        Velocity.z[e] += clampMag((sz / sd) * push - Velocity.z[e], accel)
      }
    } else {
      const nx = dist > 0.0001 ? dx / dist : 0
      const nz = dist > 0.0001 ? dz / dist : 0
      const accel = 26 * dt
      /**
       * **보스만** 멀어지면 뛰어옵니다 (BOSS_ARENA.chaseRange 설계 노트).
       *
       * 잡몹에는 일부러 주지 않았습니다. 잡몹이 빨라지면 "먼저 뭘 죽일까"가
       * 사라지고 모두가 동시에 얼굴 앞에 도착합니다 — 다대일 설계(공격
       * 토큰)가 풀려는 문제를 오히려 키웁니다. 보스는 1:1이라 안전합니다.
       */
      /**
       * 여기가 **사거리 밖**입니다 — 위 두 가지(물러남/사거리 안 대기)가 아닌 경우.
       * `approachSpeedScale` 은 정확히 이 자리에서만 걸립니다. 전투 중
       * 붙었다 떨어지는 속도는 그대로 두고 **추격만** 빨라집니다.
       * (설계 근거는 enemies.ts 의 `approachSpeedScale` 주석에 적어 두었습니다.)
       */
      const chase =
        kind === EnemyKind.Boss && dist > BOSS_ARENA.chaseRange
          ? BOSS_ARENA.chaseSpeedScale
          : (cfg.approachSpeedScale ?? 1)
      Velocity.x[e] += clampMag(nx * cfg.moveSpeed * chase * snareScale - Velocity.x[e], accel)
      Velocity.z[e] += clampMag(nz * cfg.moveSpeed * chase * snareScale - Velocity.z[e], accel)
    }
  }

  /**
   * 📣 **방금 깨어난 적은 소리를 지릅니다 — 무리가 함께 옵니다.**
   *
   * ── 왜 필요해졌는가 ──────────────────────────────────────────────
   * 인지를 방향으로 나누자마자 **무리가 무리가 아니게 됐습니다.**
   * `npm run encounter` 가 그 자리에서 잡았습니다: 무리 한가운데에
   * 서 있어도 함께 깨어난 무리가 **7개 중 2개**뿐이었습니다
   * (깨어난 수 [2,2,1,0,1,1,1]). 등을 보이고 선 동료는 옆에서 싸움이
   * 나도 끝까지 모릅니다 — 그러면 무리는 **1대1이 줄줄이 이어지는 것**이
   * 되고, 이 게임이 다대일에 들인 것(공격 토큰·군중 프로브)이 다 놀게 됩니다.
   *
   * 세키로·엘든 링·고스트 오브 쓰시마가 전부 같은 답을 씁니다:
   * **한 명이 눈치채면 소리를 질러 주변을 깨웁니다.** 그래서 잠입은
   * "안 들키기"가 아니라 **"들키기 전에 한 명씩 지우기"** 가 됩니다.
   *
   * ── 두 가지를 일부러 이렇게 두었습니다 ──────────────────────────
   * ① **한 다리만 건너갑니다(연쇄 금지).** 깨워진 동료의 유예를 0으로
   *    지워서 그 동료는 다시 지르지 않습니다. 안 그러면 A→B→C 로 존
   *    전체가 한 번에 깨어나 `bypass` 가 지키는 "걸으면 덜 깨운다"가
   *    죽습니다.
   * ② **직선거리로 봅니다** — 이 파일의 다른 판정과 반대입니다. 시야는
   *    벽을 못 넘지만 **고함은 넘습니다.** 여기서 "걸어야 하는 거리"를
   *    쓰면 벽 하나 사이에 둔 같은 방 동료가 안 듣습니다.
   *
   * 소리의 출처를 `unawareT > 0` 으로 잡습니다 — *"깨어난 지 얼마 안 됐다"*.
   * 원인을 안 가리는 것이 요점입니다: 눈으로 봤든, 발소리를 들었든,
   * **맞아서 깨어났든** 전부 여기로 들어옵니다(`combat.ts` 가 aggro 만
   * 세워도 잡힙니다). 그래서 기습에도 값이 붙습니다 — 하나를 몰래
   * 무너뜨리면 그 소리에 무리가 옵니다.
   *
   * ⚠️ 전용 칸(`alertT`)을 따로 만들어 봤다가 **되돌렸습니다.** 근거는
   *    DESIGN.md 에 적어 두었습니다 — 요약하면 *"어떤 계측으로도 차이가
   *    안 났습니다."* 재지 못하는 구분은 코드에 두지 않습니다.
   */
  for (let i = 0; i < enemies.count; i++) {
    const e = ids[i]
    if (!isAlive(e) || Actor.state[e] === ActorState.Dead) continue
    if (Enemy.aggro[e] !== 1 || Enemy.unawareT[e] <= 0) continue
    // 보스는 조우 연출이 깨우는 것이라 이 그물에서 뺍니다(양쪽 다).
    if (Enemy.kind[e] === EnemyKind.Boss) continue
    for (let j = 0; j < enemies.count; j++) {
      const o = ids[j]
      if (o === e || !isAlive(o) || Enemy.aggro[o] !== 0) continue
      if (Enemy.kind[o] === EnemyKind.Boss) continue
      const ddx = Transform.x[o] - Transform.x[e]
      const ddz = Transform.z[o] - Transform.z[e]
      if (ddx * ddx + ddz * ddz > AWARE.alertRadius * AWARE.alertRadius) continue
      Enemy.aggro[o] = 1
      // 고함도 **들킨 것**입니다 — 화면에 같은 신호로 나가야 원인이 읽힙니다.
      spotEvents.push({ entity: o, x: Transform.x[o], z: Transform.z[o], heard: true })
      // 고함을 들은 적은 **완전히 깨어 있습니다** — 기습도, 재고함도 없습니다.
      Enemy.unawareT[o] = 0
    }
  }

  /**
   * ── 🏺 **항아리 소리는 적을 깨우지 않습니다** ────────────────────
   *
   * 한 번 넣었다가 **뺐습니다.** 넣을 때의 논리는 이랬습니다:
   * *"부수는 데 대가가 있어야 잡동사니를 전부 부수는 것이 공짜가 아니게
   * 된다."* 규칙으로는 말이 되는데, **재미의 방향이 반대**였습니다.
   *
   * 대가를 붙이면 플레이어는 항아리 앞에서 **망설입니다.** 그런데 이
   * 물건이 존재하는 이유는 *"시원하게 부수고 다니는 것"* 이고, 부수는
   * 김에 뭔가 나오면 *"역시 내 감이 맞았다"* 가 되는 것입니다. 망설이게
   * 만들면 그 감각이 통째로 사라집니다 — 세금을 피하려다 **재미 쪽에
   * 세금을 매긴** 셈이었습니다.
   *
   * 그래서 적은 **가까이 가면 반응하는 정도**로만 둡니다(이미 있는
   * 시야·청각 규칙 그대로). 항아리는 소음원이 아닙니다.
   *
   * ⚠️ 남겨 두는 이유: 다음에 누가 *"항아리에 대가를 붙이면 어떨까"* 를
   *    다시 떠올릴 때, **이미 해 봤고 왜 뺐는지**가 여기 적혀 있어야
   *    합니다. 지운 자리는 아무 말도 안 합니다.
   */

  // 이번 프레임에 초록 예고 중인 적을 표시해 두고, 빠진 것들을 결산합니다.
  for (let i = 0; i < enemies.count; i++) {
    const e = ids[i]
    if (!isAlive(e) || Actor.state[e] !== ActorState.Attack) continue
    if (Actor.phase[e] !== AttackPhase.Windup) continue
    if (attackAt(Enemy.kind[e], Enemy.attackIndex[e]).intent !== AttackIntent.Counter) continue
    greenWinding.add(e)
  }
  settleGreenWindups()
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
