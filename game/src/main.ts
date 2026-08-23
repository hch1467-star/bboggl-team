import * as THREE from 'three'
import { TRIPOD_TIERS, tripodsFor } from './config/tripods'
import { appliedTweaks, assertAllTweaksApplied } from './config/tweak'
import {
  RUNE_ORDER,
  SKILLS,
  WEAPONS,
  weaponAt,
  runningStep,
  stepFor,
  rollingStep,
  plungeStep,
  heavyStep,
  finisherStep,
  swingRadius,
  swingRadiusUpperBound,
  swingPower,
  RUN_COMBO,
  ROLL_COMBO,
  PLUNGE_COMBO,
  HEAVY_COMBO,
  FINISH_COMBO,
  SKILL_KEY_CODES,
  longestPlayerReach,
} from './config/arsenal'
import {
  AWARE,
  BARREL,
  URN,
  CRACKED_WALL,
  BLEED,
  barrelFuse,
  barrelStaminaLoss,
  hearDistance,
  BOSS_ARENA,
  COMBAT,
  COUNTER,
  CAMERA,
  BONFIRE,
  EMBER,
  FALL,
  FINISHER,
  FOCUS,
  GUARD,
  KILL_FEEDBACK,
  LADDER_REACH,
  LEVEL_AGGRO_LEAD,
  LEVEL_AGGRO_MAX,
  LEVEL_DEAGGRO_MIN,
  LEVEL_DEAGGRO_RATIO,
  LEVEL_AGGRO_RANGE,
  HURT,
  hurtFlash,
  PLAYER as PLAYER_CFG,
  NAV,
  TRAVEL_KEY,
  POISE,
  PUNISH_HEAL,
  reactionTime,
  FEEL,
  TREASURE,
  VIAL,
  WEAPON_UPGRADE,
  WORLD,
  WINDUP_TURN_BUDGET_DEG,
} from './config/balance'
import {
  AttackIntent,
  INTENT_COLOR,
  INTENT_ANSWER,
  INTENT_EMOJI,
  INTENT_LABEL,
  ANSWER_IS_DODGE,
  RETEACH_AFTER,
  INTENT_NAME,
  SNARE_MOVE_SCALE,
  MAX_CONCURRENT_ATTACKERS,
  MAX_CONCURRENT_WIDE,
  MAX_CONCURRENT_RANGED,
  ATTACK_COMMIT_GAP,
  attackAt,
  attacksFor,
  longestReach,
  telegraphRadius,
} from './config/enemyAttacks'
import { BOSS_PHASES, NO_CHAIN, PHASE_TRANSITION_TIME } from './config/bossPhases'
import { GEAR_TIERS, rollAffixes, rollTier, tierDef } from './config/gear'
import { punishTable, sidestepTable, type PunishRow, type SidestepRow } from './config/punish'
import { ENEMY_DEFS, bleedMaxOf, enemyDef, kindFromId } from './config/enemies'
import {
  Actor,
  ActorState,
  Barrel,
  Body,
  Enemy,
  EnemyKind,
  Health,
  Loadout,
  Pickup,
  Player,
  Renderable,
  Stamina,
  Status,
  Transform,
  Urn,
  CrackedWall,
  Velocity,
} from './core/components'
import { AttackPhase } from './core/components'
import { defineQuery, destroyEntity, hasComponent, isAlive, resetWorld } from './core/ecs'
import { sfx } from './core/audio'
import { consumePress, debugInput, endFrame, initInput, mouse, wasPressed } from './core/input'
import { combatRng, vfxRng } from './core/rng'
import { requestHitstop, resetTime, tick, time, MAX_FRAME_DT } from './core/time'
import { buildProps, type PropsInfo } from './render/props'
import {
  CELL_SIZE,
  HEIGHT_STEP,
  MAX_CLIMB,
  VOID,
  cellToWorld,
  loadLevelFromStorage,
  worldToCell,
  type LevelData,
  type LevelRegion,
} from './level/format'
import { DEFAULT_LEVEL_ID, loadBundledLevel } from './levels'
import { Terrain } from './level/terrain'
import { QuarterViewCamera } from './render/camera'
import { createScene } from './render/scene'
import { Vfx } from './render/vfx'
import { KIND_TREASURE, Visuals, backZoneOuter } from './render/visuals'
import {
  breakEvents,
  bleedEvents,
  readBleedPeak,
  readBossDamageBySource,
  readMobDamageBySource,
  readFocusFlow,
  resetFocusFlow,
  noteFocusDodge,
  readCrossfireHits,
  readPoiseDealt,
  resetPoiseDealt,
  resetBleedPeak,
  breakPoise,
  finisherEvents,
  counterEvents,
  crossfireEvents,
  barrelSystem,
  barrelLitEvents,
  barrelBlastEvents,
  urnSystem,
  urnBreakEvents,
  wallBreakEvents,
  crackedWallSystem,
  countLivingEnemies,
  justGuardEvents,
  perfectDodgeEvents,
  hitEvents,
  isBackAttack,
  isBehindPoint,
  resolveAttacks,
  setPlayerInvulnerable,
  debugApplyBleed,
  swingRecords,
  flushSwingRecords,
  poiseDamage,
  countInBlast,
  pickupBlownEvents,
} from './systems/combat'
import {
  chainIndexFor,
  encounterEvents,
  enemyAiSystem,
  readChainsArmed,
  readHealPunish,
  resetHealPunish,
  resetChainLedger,
  noteChainDeath,
  noteChainsWiped,
  readChainsFired,
  phaseTeachHold,
  resetPhaseTeaching,
  setPhaseTeaching,
  readChainsDropped,
  countChainsPending,
  readGreenOutcome,
  resetGreenOutcome,
  readPickLog,
  resetPickLog,
  resetLastPicks,
  type PickRecord,
  readChainsLost,
  readIdleReasons,
  setAggroRangeOverride,
  wakeRangeOf,
  ATTACK_FACING_TOLERANCE_DEG,
  spotEvents,
  deaggroEvents,
  reachDistanceOf,
  enemyAiRunning,
  setReachDistance,
  phaseEvents,
  resetAttackTokens,
  setEnemyAiEnabled,
} from './systems/enemyAI'
import { bonfireSystem, setBonfireReach, type Bonfire } from './systems/bonfire'
import { deathEvents, healthSystem } from './systems/health'
import {
  SLOT_COUNT,
  FIRST_RUNE_SLOT,
  cooldownOf,
  grantRune,
  setCooldown,
  equipGear,
  setWeaponLevel,
  skillForSlot,
  weaponAffixes,
  weaponLevel,
  weaponOf,
  weaponCooldownScale,
  weaponDamageMult,
  weaponMagicFlat,
  weaponSeed,
  weaponSpeedScale,
  weaponTier,
} from './systems/loadout'
import { grantTripodPoint, resetTripods, switchTripod, tripodPoints, unlockTripod } from './systems/tripod'
import {
  applySave,
  captureSave,
  clearSave,
  levelIdOf,
  loadSave,
  treasureKey,
  writeSave,
} from './systems/save'
import { fallEvents, physicsSystem, setTerrain } from './systems/physics'
import {
  finisherTarget,
  healEvents,
  playerControlSystem,
  readInputFlow,
  canGuardNow,
  readLearnedActions,
  readRhythm,
  readStaminaSpent,
  resetStaminaSpent,
  dodgeBlock,
  canAffordAttack,
  readLastSpender,
  contextComboIndex,
  isSprinting,
  type ControlContext,
} from './systems/playerControl'
import {
  bossKey,
  enemyCountForWave,
  respawnLevelEnemies,
  spawnBarrel,
  spawnUrn,
  spawnTreasure,
  spawnEnemy,
  spawnFromLevel,
  spawnGrunt,
  spawnPlayer,
  spawnWave,
} from './systems/world'
import { Hud } from './ui/hud'
import { SkillBar } from './ui/skillbar'
import { TripodPanel } from './ui/tripodPanel'
import { ShopPanel } from './ui/shopPanel'
import { shopItemKey, shopStock, type ShopItem } from './systems/shop'

/**
 * 게임 루프 — 시스템 실행 순서가 여기 담깁니다.
 *
 * 순서가 왜 중요한가: "입력 -> AI -> 물리 -> 판정 -> 사망 -> 연출" 순서를 지켜야
 * 한 프레임 안에서 인과가 맞습니다. 예를 들어 판정을 물리보다 먼저 하면
 * 이번 프레임에 이미 밀려난 위치가 아니라 지난 프레임 위치로 맞는지를 재게 되어,
 * 빠르게 움직일 때 "분명 피했는데 맞는" 현상이 생깁니다.
 *
 * 두 가지 모드로 돌아갑니다:
 *  - **레벨 모드** (?level=storage): 에디터로 만든 지형/배치를 그대로 플레이
 *  - **아레나 모드** (기본): 웨이브로 적이 몰려오는 전투 시험장
 */
const pickups = defineQuery(Transform, Pickup)
const enemyQuery = defineQuery(Transform, Enemy, Health)
// 🏺 항아리 — 디버그 훅이 "진짜가 어디 있었나"를 답할 수 있게.
const urnQuery = defineQuery(Transform, Urn)
/** 🎁 보물 — 벽 뒤에 있는 것의 빛기둥을 끄기 위해 훑습니다(`syncHiddenTreasures`). */
const treasureQuery = defineQuery(Transform, Pickup)

class Game {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly cursorRing: THREE.Mesh
  private readonly sunTarget: THREE.Object3D
  private readonly arena: THREE.Group
  private readonly guide: THREE.Group
  private readonly guideMaterials: THREE.MeshBasicMaterial[]
  private readonly cam: QuarterViewCamera
  private readonly visuals: Visuals
  private readonly vfx: Vfx
  private readonly hud: Hud
  private readonly skillBar: SkillBar
  private readonly tripodPanel: TripodPanel
  /** 🏪 모루의 상점 창 — 트라이포드 창과 같은 규격입니다. */
  private readonly shopPanel: ShopPanel
  /** 매 프레임 배열을 새로 만들지 않도록 재사용합니다. */
  private readonly cdBuf = new Array<number>(SLOT_COUNT).fill(0)
  private readonly cdMaxBuf = new Array<number>(SLOT_COUNT).fill(1)

  private playerEntity = -1
  private wave = 1
  private kills = 0
  /**
   * 🩸 출혈 실험대의 **고정 체력**. 터짐 피해가 체력 비율을 흔들면
   * *"체력만 다른 두 판"* 이 성립하지 않습니다 — 그래서 세운 값을 기억했다
   * 매 타격 뒤 되돌립니다.
   */
  private readonly bleedDummyHp = new Map<number, number>()
  private waveTimer = 0
  private gameOver = false
  /** 이 존의 보스를 잡았는가 — 존의 끝은 보스입니다(아래 6번 설계 노트). */
  private bossDefeated = false
  private lastFrameMs = 0
  private paused = false
  private readonly aim = { x: 0, z: 0 }
  private readonly controlCtx: ControlContext

  /**
   * 어떤 콘텐츠를 띄울지.
   *   bundled — 함께 배포되는 존 (기본). 링크만 열면 누구나 같은 콘텐츠를 봅니다.
   *   storage — 에디터에서 만든 레벨 (?level=storage)
   *   arena   — 웨이브 전투 시험장 (?mode=arena)
   */
  private readonly source: 'bundled' | 'storage' | 'arena'
  private levelMode = false
  private levelName = ''
  private terrain: Terrain | null = null
  /** 💥 이번 판에 터진 통 수 · 그 폭발에 휘말린 몸 수 — 벤치·프로브가 읽습니다. */
  private barrelsBlown = 0
  /**
   * 🎁💥 폭발에 밀려나 **주울 수 있는 자리로 내려온** 보물의 수.
   * 세는 이유: 이 동사를 넣고도 판에서 한 번도 안 일어나면 *"안 쓸 만하다"* 가
   * 아니라 **"배치가 없다"** 입니다. 봇 정책이 만든 0 을 게임의 성질로
   * 읽지 않으려면 게임이 직접 세야 합니다.
   */
  private treasuresBlown = 0
  private barrelsCaught = 0
  /** 💥 **불붙일 때** 반경 안에 있던 적의 합계 — 터질 때와의 차이가 「걸어 나간 수」. */
  private barrelsLitCaught = 0
  private treasureTotal = 0
  private treasuresFound = 0
  private regions: LevelRegion[] = []
  /**
   * 🗺 **구역 이웃 표** — 「지금 여기서 알려 줄 만한가」의 단위.
   *
   * 곁길 알림이 오랫동안 **거리**로 그 질문에 답하려 했는데, 재 보니
   * 그 자로는 답이 없었습니다(secret 프로브의 ⛰️ 벽):
   *
   *     안 알려지는 보물을 담으려면 편도 문턱 **≥ 60m**
   *     시작 지점에서 조용하려면              **< 52m**
   *
   * 52 < 60 이라 **어떤 값도 둘 다 만족하지 못합니다.** 게다가 다른 축인
   * 「더 걷는 거리」는 최단 경로 위에서 **위치와 무관하게 일정**합니다
   * (시작에서도 4m, 곁길 입구에서도 4m) — 즉 *"얼마나 비싼가"* 만 말하고
   * *"지금인가"* 는 못 말합니다. 거리 둘로는 「지금」을 표현할 수 없습니다.
   *
   * 참고한 게임들은 이 질문을 **거리로 안 풉니다** — 할로우 나이트의
   * 지도는 **지금 방**을 채우고, 소울류가 가르치는 단위는 **구역**이며,
   * 로스트아크의 미니맵도 현재 구역입니다. 이 게임에도 구역이 있고
   * HUD 가 이미 그 이름을 띄웁니다.
   *
   * 그래서 문턱을 **위상**으로 바꿉니다: *"지금 구역이거나 그 이웃"*.
   * 판의 크기와 무관하고, 조율할 숫자가 없습니다.
   */
  private regionNeighbours = new Map<string, Set<string>>()
  /** 🏛 폐허 잔해 그룹 — 지형과 따로 답니다(render/props.ts). */
  private props: THREE.Group | null = null
  private propsInfo: PropsInfo | null = null
  private currentRegion = ''
  private levelW = 0
  private levelH = 0
  /** 화톳불 좌표들. 엔티티가 아니라 좌표 목록입니다(부딪히지 않으므로). */
  /**
   * 이번 판에 **이미 알려준** 예고 색들. 색마다 한 번만 알려줍니다.
   *
   * 세이브에 남기지 않는 이유: 처음 여는 사람에게 필요한 것이지, 이어하는
   * 사람에게는 이미 아는 내용입니다. 그리고 판을 새로 시작하는 사람은
   * 대개 **다시 배우고 싶은** 사람입니다 — 저장해 두면 그 기회를 막습니다.
   */
  private readonly seenIntents = new Set<number>()
  /**
   * 🎨 **아직 못 띄운 색 안내들** — 한 줄씩 차례로 나갑니다.
   *
   * ── 왜 줄이 필요해졌는가 ──────────────────────────────────────────
   * `hud.showColorHint` 는 **덮어씁니다.** 지금까지는 안내가 「예고를
   * 처음 볼 때 한 개」씩만 나가서 문제가 없었는데, 보스 조우에서 **한
   * 번에 둘**을 알려 줘야 하는 자리가 생겼습니다(아래 `queueColorHint`).
   * 그대로 두 번 부르면 첫 줄이 **읽히기도 전에 사라집니다.**
   *
   * ⚠️ 「본 색」 표시는 **줄에 넣을 때** 합니다(띄울 때가 아니라).
   *    띄울 때 하면, 줄에서 기다리는 동안 같은 색을 또 만나 **같은
   *    안내가 두 번 줄에 쌓입니다.**
   */
  private readonly colorHintQueue: number[] = []
  /** 지금 떠 있는 색 안내의 남은 시간(초). 0이면 다음 줄을 띄웁니다. */
  private colorHintT = 0
  /** 적 종류별 휘두름/적중 — 잡몹이 존에서 실제로 무엇을 하는지. */
  private foeSwingLog: Record<
    string,
    {
      swings: number
      hits: number
      deaths?: number
      /** 예고를 건 횟수. `swings`(판정 도달)와의 차이가 **끊긴 공격**입니다. */
      commits?: number
      /** 그중 **연계로 이어져 나온** 예고. 잡몹 연계가 실제로 도달하는지. */
      chained?: number
      /** 아래 다섯은 **살아 있던 시간의 분해**입니다(초, 시뮬레이션 시간). */
      aggroT?: number
      atkT?: number
      stagT?: number
      coolT?: number
      chaseT?: number
      readyT?: number
    }
  > = {}
  private readonly foeLastSwing = new Map<number, string>()

  /**
   * ── ⚔️ **보스전에서 나는 무엇을 하고 있었나** ────────────────────────
   *
   * ── 왜 이게 없어서 막혔는가 ──────────────────────────────────────
   * 적이 무엇을 했는지는 이미 잽니다 — *"보스 깨어 75.6초 중 공격 50% ·
   * 경직 1% · 쿨 22% · 접근 7% · 사거리 안 대기 17%"*. 그런데 **내가**
   * 무엇을 했는지는 한 줄도 없습니다.
   *
   * 그래서 출혈을 쫓다가 막혔습니다. 보스 타격 간격이 판마다 **1.0초와
   * 3.20초** 사이를 오가는데(그 차이가 출혈이 터지느냐 마느냐를 가릅니다),
   * *"왜 어떤 판은 못 붙어 있는가"* 에 답할 값이 없었습니다. 후보는 넷이고
   * 처방이 전부 다릅니다 — 예고를 피하느라(창 설계) · 기력이 없어서(경제) ·
   * 거리가 멀어서(이동·보스 이동) · 마시느라(회복 규칙).
   *
   * ── 적 쪽과 **같은 모양**으로 나눕니다 ────────────────────────────
   * 위 `foeSwingLog` 가 적의 시간을 코드의 분기 그대로 갈랐듯이, 여기서도
   * 플레이어 상태 기계의 분기 그대로 가릅니다. 추측한 이름으로 나누면
   * 숫자가 나와도 어느 코드를 고쳐야 할지 모릅니다.
   *
   * ⚠️ 시뮬레이션 시간으로 더합니다 — 벽시계로 재면 10fps 컨테이너에서
   *    **프레임 수를 재는 것**이 됩니다.
   */
  private bossTime: {
    total: number
    attack: number
    dodge: number
    guard: number
    stagger: number
    drink: number
    chase: number
    /** 닿는 거리인데 안 때린 시간 — 그중 기력이 없던 몫을 따로 셉니다. */
    ready: number
    readyNoStamina: number
  } = {
    total: 0,
    attack: 0,
    dodge: 0,
    guard: 0,
    stagger: 0,
    drink: 0,
    chase: 0,
    ready: 0,
    readyNoStamina: 0,
  }

  /**
   * ── 🩸 **피격 장부** — 맞은 한 대마다 "공정했는가"를 적습니다 ──────
   *
   * DESIGN.md 기둥 2의 합격 기준은 프로젝트 내내 여섯 군데에 적혀 있습니다:
   *
   *   > 죽었을 때 **"내가 못 봤네"** 가 아니라 **"내가 못 피했네"** 라고
   *   > 말해야 합니다.
   *
   * 그런데 **한 번도 잰 적이 없습니다.** 적어 두기만 한 기준은 지켜지는지
   * 알 수 없고, 이 저장소에서 그런 것은 늘 조용히 무너져 있었습니다
   * (보물 0개 · 연계 0회 · 안 보이던 초록 예고 · 죽은 봇의 돌기 분기).
   *
   * 재는 법은 **맞은 뒤가 아니라 예고 중에** 모읍니다. 맞고 나서 되짚으면
   * 이미 화면도 상태도 바뀌어 있어서, 남는 것은 추측뿐입니다.
   * 하데스가 죽은 뒤 "무엇에게 죽었는가"를 보여 주는 것과 같은 장치인데,
   * 우리는 **죽음만이 아니라 맞은 것 전부**를 적습니다 — 죽음은 표본이
   * 너무 적어서 판이 끝나도 몇 줄 안 나옵니다.
   */
  private readonly hurtWatch = new Map<
    number,
    {
      id: string
      intent: number
      start: number
      seen: number
      /** 몸이 아니라 **지면 예고 부채꼴**이 화면 안이던 시간 */
      cueSeen: number
      free: number
      /** 손이 묶여 있던 **이유별** 시간. 처방이 갈리므로 칸을 나눕니다. */
      blocked: Record<string, number>
      /**
       * 🎯 이 예고가 뜬 **뒤에** 답을 시도한 마지막 시각(초). -1 이면 한 번도
       * 안 눌렀다는 뜻입니다. 아래 `noteHurt` 가 `fair` 를 쪼개는 데 씁니다.
       */
      lastTryT: number
      /** 이 예고 동안 답을 시도한 횟수 — "한 번도 안 눌렀다"와 구분하려고. */
      tries: number
      /**
       * 이 휘두름이 **약속한** 예고 길이(초) — `Enemy.windupLen` 을 그대로.
       * 잰 값과 나란히 두면 *"계측기가 예고를 합쳤는가"* 를 검사할 수 있습니다.
       */
      expected: number
      /** 마지막 시도가 향했던 적(그 순간 가장 임박했던 예고의 주인). -1 = 없음. */
      tryTarget: number
      /**
      /** 🚶 예고가 뜬 순간 **내가 서 있던 자리**. 내 발이 한 일만 따로 재려고. */
      startX: number
      startZ: number
      /**
       * 🚶 예고가 **뜬 순간** 그 적과의 거리(m).
       *
       * 맞은 순간의 거리와 견주면 *"걸어서 벗어나려 했는가"* 가 사실로
       * 남습니다. `안누름` 이 지금은 **구르지 않았다**만 뜻해서,
       * 🟡 광역처럼 **정답이 걸어서 이탈**인 색에서는 *"아무것도 안 했다"*
       * 와 *"걸었는데 못 벗어났다"* 가 한 칸에 뭉칩니다. 처방은 정반대입니다
       * — 앞은 예고의 뜻이 안 읽히는 것이고, 뒤는 **장판이 걸어서 벗어날
       * 수 있는 크기가 아닌** 것입니다.
       */
      distStart: number
    }
  >()
  /** 🎯 마지막으로 **구르기가 시작된** 시각(초). -1 = 아직 한 번도. */
  private answerStartT = -1
  /** 그 구르기가 향했던 적 — 구른 순간 가장 임박했던 예고의 주인. -1 = 없음. */
  private answerTarget = -1
  /** 그 모서리를 잡기 위한 직전 프레임의 구르기 여부. */
  private wasRolling = false
  /**
   * 직전 프레임에 **휘두름을 시작하고 있던** 적들. 같은 패턴을 연달아 쓸 때
   * 앞 예고의 시간이 뒤로 넘어가지 않게 하는 데 씁니다(아래 설계 노트).
   */
  private windingLast = new Set<number>()
  private hurtLedger: {
    attackId: string
    intent: number
    /** 실제로 보여준 예고 시간(초) */
    telegraph: number
    /** 그중 때린 쪽의 **몸이** 화면 안에 있던 시간 */
    seen: number
    /**
     * 그중 **지면 예고 부채꼴**이 화면에 걸쳐 있던 시간.
     *
     * `seen` 과 나누는 이유는 `cueOnScreen` 주석에 있습니다 — 몸이 화면
     * 밖이어도 위험 표시는 내 발치에 보일 수 있고, 그 둘은 고칠 곳이
     * 정반대입니다(게임이냐 계측기냐).
     */
    cueSeen: number
    /** 그중 플레이어가 **답할 수 있던**(구르기를 시작할 수 있던) 시간 */
    free: number
    damage: number
    /**
     * fair:안누름 · fair:다른적 · fair:일찍 · fair:늦게 · fair:못막는공격 ·
     * unseen:아무것도 · unseen:몸만 · locked:* · tooFast · unknown
     */
    verdict: string
    /** 구르기를 시작한 지 얼마 만에 맞았는가(초). -1 = 안 굴렀음. */
    sinceTry: number
    /** 이 휘두름이 약속했던 예고 길이(초). 0 = 기록 없음(낙하 등). */
    expected: number
    /** 🚶 예고 동안 **내가 움직인 거리**(m). 기준점이 안 움직이는 값. */
    walked: number
    /**
     * 🫁 `locked:stamina` 일 때 **그 기력을 마지막으로 쓴 것**.
     * 공격이면 유보분이 뚫린 것(버그), 구르기면 연달아 구른 것(가르칠 일),
     * 헛친 가드면 🟢 를 잘못 읽은 것 — 처방이 각각 다릅니다.
     */
    spender: string
    /** 🚶 예고 동안 적과의 거리 변화(m). 음수면 다가갔다는 뜻. */
    moved: number
    /** 🎨 색 이름(이모지 포함) · 그 색이 요구한 답. 재는 쪽이 표를 안 들게. */
    color: string
    answer: string
  }[] = []
  private bonfires: Bonfire[] = []
  /** 모루 — 불티·정련석을 쓰는 곳. 부활도 회복도 아닙니다(world.ts 설계 노트). */
  private anvils: { x: number; y: number; z: number }[] = []
  /** 🏪 지금 서 있는 모루(없으면 null) — 상점 재고의 열쇠입니다. */
  private shopAnvil: { x: number; y: number; z: number } | null = null
  /** 🏪 이미 산 물건들. 세이브에 남습니다 — 재입고가 없으니 이게 곧 재고입니다. */
  private boughtItems = new Set<string>()
  // 🧱 벽 자리는 null 입니다 — 번호로 `terrain.shortcuts` 와 짝을 맞춥니다.
  private ladderVisuals: ({ setOpen: (open: boolean) => void } | null)[] = []
  /** 지금까지 쉰 횟수 — 자동 플레이 봇이 **추측하지 않고 읽도록** 노출합니다. */
  private restCount = 0
  /**
   * 죽은 횟수. 이것도 게임이 셉니다.
   *
   * 봇은 "체력이 0인 프레임"을 보고 죽음을 셌는데, 부활이 **같은 프레임에**
   * 끝나서 그 프레임이 존재하지 않았습니다. 그래서 봇은 사망 0회라고
   * 보고하면서 불티가 280에서 32로 줄어 있었습니다 — 계측기가 거짓말을 한 것입니다.
   */
  private deathCount = 0
  /** 🟢 반격 성공 횟수 — 프로브와 봇이 추측하지 않고 읽습니다. */
  private counterCount = 0
  /** 🛡 이번 판에 성립한 저스트 가드 수 — 프로브가 "실제로 되는가"를 묻습니다. */
  private justGuards = 0
  /** 🩸 이번 판에 출혈이 터진 횟수 — 넣어 두고 안 터지면 잴 수가 없습니다. */
  private bleedPops = 0
  /**
   * 🧪 실험대에서 **붙들어 둔** 기력(null 이면 안 붙듦). 위 루프 주석 참고 —
   * 한 번 써 넣는 것과 매 프레임 유지하는 것은 다릅니다.
   */
  private staminaPin: number | null = null
  setStaminaPin(n: number | null): void {
    this.staminaPin = n
  }
  /**
   * 이번 실행에서 **번** 정련석의 총합.
   *
   * 가진 개수만 보면 쓴 것이 안 보여서 "얼마나 나왔는가"를 알 수 없습니다.
   * 자동 플레이에서 가진 6개 + 쓴 4개 = 10개가 나왔는데 존의 상한은
   * 보물 5 + 보스 2 = 7이었습니다. 숫자가 안 맞으면 **추측하지 말고 세야** 합니다.
   */
  private stonesEarned = 0
  /**
   * **자발적으로** 쉰 횟수. 되살아난 적의 불티 보상이 이만큼 체감합니다.
   * (죽어서 되살아난 것은 세지 않습니다 — balance.ts EMBER 설계 노트 참고)
   */
  private restGeneration = 0
  /**
   * 적이 **판정을 낸 횟수**와 그중 **플레이어에게 맞은 횟수**.
   *
   * 봇이 서서 싸우는데도(후퇴 3%) 총 피해가 148뿐이라, 남은 가능성은 둘입니다:
   * 적이 안 휘두르거나, 휘두르는데 안 맞거나. **둘은 고칠 곳이 완전히 다릅니다** —
   * 전자는 공격 빈도·토큰, 후자는 예고 시간·무적 프레임입니다.
   */
  private enemySwings = 0
  private enemyHits = 0
  /**
   * 강인도 붕괴가 **실제로 몇 번 일어나는가** — 자동 플레이로 재기 위한 값입니다.
   * 붕괴는 이 게임에서 가장 큰 보상(긴 무방비)인데, 한 판에 몇 번이나
   * 일어나는지 아무도 재 본 적이 없었습니다. 드물면 시스템이 사실상 없는
   * 것이고, 잦은데 활용을 못 하면 보상의 형태가 틀린 것입니다 — 답이 다릅니다.
   */
  private poiseBreaks = 0
  /** 처형이 실제로 몇 번 나갔는가 — 무방비 창을 쓰게 됐는지 재는 값입니다. */
  private finishers = 0
  /**
   * 🚪 걸어서 닿을 수 없게 되어 **어그로가 풀린 횟수**, 그리고 그중
   * 가장 심했던 한 건(직선/경로). 안 하는 일은 세지 않으면 없는 일이 됩니다.
   */
  private deaggroCount = 0
  private deaggroWorstWalk = 0
  private deaggroWorstStraight = 0
  /** 그중 보스에게 들어간 것 */
  private bossFinishers = 0
  /** 그중 **예고 중에** 끊긴 것 — 🟢 반격만이 초록을 끊는지 재는 값입니다. */
  private windupBreaks = 0
  /** 보스가 색깔별로 몇 번 휘두르고 몇 번 맞혔는가 */
  private bossSwingLog: Record<
    string,
    { swings: number; hits: number; chained: number; byPhase: number[] }
  > = {}
  private readonly bossLastSwing = new Map<number, string>()
  /** 무너진 순간의 체력 비율 합 — 평균을 내면 "붕괴가 언제 터지는가"가 나옵니다. */
  private breakHpSum = 0
  /** 무방비 상태 그대로 죽은 적의 수 — 처형까지 못 가고 정리된 횟수. */
  private brokenDeaths = 0
  /**
   * **절벽에서 떨어진 횟수** — 나와 적을 따로 셉니다.
   *
   * ── 왜 이제야 세는가 ──────────────────────────────────────────
   * 「밀어서 떨어뜨리기」를 **만들려다** 코드를 읽어 보니 **이미 있었습니다.**
   * 낙하 판정은 플레이어와 적을 가리지 않고, 적이 떨어지면 피해 +
   * `breakPoise()` 까지 들어갑니다. balance.ts FALL 주석에 설계 의도도
   * 그대로 적혀 있습니다 — *"밀어 떨어뜨린 적이 무방비로 착지하는 것이
   * 진짜 보상"*.
   *
   * 그런데 **한 번이라도 일어나는지는 아무도 모릅니다.** 이 프로젝트에서
   * 몇 번이나 나온 모양입니다: 연계 0회 · 안 보이던 초록 예고 · 한 발도
   * 안 쏘던 궁수 — 전부 기능은 멀쩡한데 **세는 눈금이 없어서** 없는 것과
   * 같았습니다. 새 기능을 얹기 전에 있는 기능부터 셉니다.
   *
   * 지형은 미리 재 뒀습니다: 넉백 5m 면 낙차(3단 이상) 옆에 서 있는 적이
   * 일곱이고 전부 주 동선입니다. 조건은 있는데 결과를 모르는 상태입니다.
   */
  private fallLog: { player: number; foe: number; foeSteps: number; byKind: Record<string, number> } =
    { player: 0, foe: 0, foeSteps: 0, byKind: {} }
  /** 지금 서 있는 자리에서 강화가 되는가 — 게임의 판단(봇이 다시 계산하지 않게). */
  private canSpendHere = false
  /**
   * 지금 강화가 **왜** 안 되는가 — `''`(된다) · `'foe'`(적이 막음) · `'away'`(안 닿음).
   * 봇이 밖에서 추측하지 않게, 갈림길에 이름을 붙여 내보냅니다.
   */
  private spendBlock: '' | 'foe' | 'away' = 'away'
  /** 무기 강화 시도의 **갈림길별** 횟수 — 밖에서 추측하지 않도록 게임이 셉니다. */
  private upgradeTries = { seen: 0, notStation: 0, consumed: 0, noStone: 0, noEmber: 0, done: 0 }
  /** 지난 프레임에 판정 중이던 적 — 같은 휘두르기를 여러 프레임 세지 않기 위해. */
  private readonly swungLastFrame = new Set<number>()
  /**
   * 지난 프레임에 **예고 중**이던 적.
   *
   * 판정(위)과 따로 세는 이유가 이번 라운드의 핵심입니다. `휘두름` 은
   * 판정 단계에 들어간 횟수만 셉니다 — *"예고만 띄우고 끊긴 것은 세지
   * 않는다"* 고 아래에 적어 뒀습니다. 그런데 **반격은 예고 중에 강인도를
   * 무너뜨리는 것**이므로, 반격이 성공하면 그 공격은 판정에 영영 못 갑니다.
   *
   * 그래서 `휘두름 0회` 가 정반대 두 가지를 같은 숫자로 보여 줍니다:
   *   · 한 번도 공격을 못 걸었다  (문제)
   *   · 걸 때마다 플레이어가 끊었다  (설계대로)
   * 하필 🟢 달려드는 자가 **반격을 가르치려고 만든 적**이라, 가장 중요한
   * 구분이 가장 안 보이는 자리에 있었습니다.
   */
  private readonly windingLastFrame = new Set<number>()
  /** 적을 되살리려면 원본 배치가 필요합니다. */
  private levelData: LevelData | null = null
  /**
   * 죽은 자리에 떨어뜨린 불티. **항상 하나뿐**입니다.
   *
   * 여러 개가 쌓이면 "나중에 한꺼번에 줍지 뭐"가 되어 손실이 실감나지 않습니다.
   * 하나만 두면 **되찾으러 가다가 또 죽는 것이 진짜 손실**이 됩니다.
   */
  /** 지금 싸우고 있는 보스 엔티티. -1 이면 교전 중이 아닙니다. */
  private bossEntity = -1
  private drop: { x: number; y: number; z: number; amount: number } | null = null
  private dropVisual: THREE.Object3D | null = null
  /** 이 레벨의 세이브 칸 식별자. 아레나면 빈 문자열(저장하지 않음). */
  private saveId = ''
  /** 이미 먹은 보물의 위치 키. 세이브에서 복원되고, 새로 먹을 때마다 추가됩니다. */
  private takenTreasures = new Set<string>()
  /** 이미 잡은 보스의 위치 키. 화톳불에서 쉬어도 되살아나지 않습니다. */
  private defeatedBosses = new Set<string>()
  /** 플레이어가 적중시킨 누적 타격 수/피해량 — 다단히트 같은 것을 검증할 때 씁니다. */
  private hitsDealt = 0
  private damageDealt = 0
  private backHits = 0
  private critHits = 0

  constructor(canvas: HTMLCanvasElement) {
    const bundle = createScene(canvas)
    this.renderer = bundle.renderer
    this.scene = bundle.scene
    this.cursorRing = bundle.cursorRing
    this.sunTarget = bundle.sunTarget
    this.arena = bundle.arena
    this.guide = bundle.guide
    this.guideMaterials = bundle.guideMaterials

    this.cam = new QuarterViewCamera(window.innerWidth / window.innerHeight)
    this.visuals = new Visuals(this.scene, this.cam.camera)
    this.vfx = new Vfx(this.scene)
    this.hud = new Hud()
    this.skillBar = new SkillBar()
    this.tripodPanel = new TripodPanel()
    this.shopPanel = new ShopPanel()
    this.shopPanel.setBuyHandler((item) => this.buyGear(item))

    const params = new URLSearchParams(location.search)
    this.source =
      params.get('level') === 'storage' ? 'storage' : params.get('mode') === 'arena' ? 'arena' : 'bundled'

    this.controlCtx = {
      forwardX: this.cam.forward.x,
      forwardZ: this.cam.forward.z,
      rightX: this.cam.right.x,
      rightZ: this.cam.right.z,
      aimX: 0,
      aimZ: 0,
      onSwing: (x, z, rotY, range, arcDeg, power) =>
        this.vfx.spawnSwing(
          x,
          z,
          rotY,
          range,
          arcDeg,
          power,
          tierDef(weaponTier(this.playerEntity)).color,
          // 세기는 등급의 `glow` 를 그대로 씁니다 — 손에서 빛나는 세기와
          // 자국에 물드는 세기가 **같은 값**이라야 둘이 한 사건으로 읽힙니다.
          tierDef(weaponTier(this.playerEntity)).glow,
        ),
      onCast: (v) => {
        const y = this.terrain ? this.terrain.groundYAt(v.x, v.z) : 0
        // 원형/지점 스킬은 전방위이므로 부채꼴 각도를 360°로 바꿉니다.
        const arc = v.shape === 'cone' ? v.arcDeg : 360
        if (v.phase === 'telegraph') {
          // 테두리(범위) + 차오르는 안쪽(남은 시간) 두 장을 겹칩니다.
          this.vfx.spawnGroundShape(v.x, y, v.z, v.rotY, v.range, arc, v.color, v.duration, 'outline')
          this.vfx.spawnGroundShape(v.x, y, v.z, v.rotY, v.range, arc, v.color, v.duration, 'fill')
        } else {
          this.vfx.spawnGroundShape(v.x, y, v.z, v.rotY, v.range, arc, v.color, v.duration, 'fade')
        }
      },
      onLoadoutChange: () => this.refreshLoadout(),
    }

    initInput(canvas)
    /**
     * 브라우저는 사용자가 페이지를 한 번이라도 건드리기 전에는 소리를 막습니다
     * (자동재생 정책). 그래서 첫 입력에서 오디오를 엽니다. `once`가 아니라
     * 매번 부르는 이유: 탭을 옮겼다 오면 AudioContext가 다시 잠들기 때문에,
     * 조작할 때마다 깨워 주는 쪽이 확실합니다(이미 열려 있으면 즉시 반환).
     */
    const wake = () => sfx.unlock()
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    this.hud.restartButton.addEventListener('click', () => this.reset())
    // 진행 초기화는 되돌릴 수 없으므로 한 번 더 묻습니다.
    document.getElementById('resetProgress')?.addEventListener('click', () => {
      if (confirm('이 레벨의 각인석 · 룬 · 먹은 보물을 전부 지우고 처음부터 시작합니다.')) {
        this.resetProgress()
      }
    })
    window.addEventListener('resize', () => this.resize())
    this.resize()
    this.reset()
  }

  private resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.cam.resize(w / h)
  }

  reset(): void {
    // 🧪 붙들어 둔 기력은 **판을 넘기지 않습니다.** 남겨 두면 다음 실험이
    //    이유를 모른 채 이상하게 돌고, 그게 이 저장소가 제일 비싸게 친 실패입니다.
    this.staminaPin = null
    // 기존 엔티티의 Three.js 오브젝트를 먼저 떼어냅니다(안 하면 유령 메시가 남습니다).
    for (let e = 0; e < 4096; e++) if (isAlive(e)) this.visuals.detach(e)
    resetWorld()
    resetTime()
    hitEvents.length = 0
    deathEvents.length = 0
    phaseEvents.length = 0
    healEvents.length = 0
    this.visuals.clearBonfires()
    this.visuals.clearLadders()
    this.ladderVisuals = []
    this.clearDrop()
    this.bossEntity = -1
    sfx.stopMusic()
    encounterEvents.length = 0
    spotEvents.length = 0
    deaggroEvents.length = 0
    this.defeatedBosses = new Set()
    /**
     * 🎨 **색 안내를 다시 배울 수 있게 지웁니다.**
     *
     * `seenIntents` 선언부에 이렇게 적혀 있습니다 — *"판을 새로 시작하는
     * 사람은 대개 다시 배우고 싶은 사람입니다."* 그런데 **그 규칙이
     * 코드에 없었습니다.** 한 번 켠 뒤로는 다시 시작해도 안내가 영영
     * 안 떴습니다(계측기도 그래서 못 봤습니다 — 프로브는 전부 `reset()`
     * 으로 시작합니다).
     */
    this.hiddenTreasures.clear()
    this.seenIntents.clear()
    this.colorHintQueue.length = 0
    this.colorHintT = 0
    this.bonfires = []
    this.anvils = []
    this.levelData = null

    if (this.props) {
      this.scene.remove(this.props)
      this.props.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
      })
      this.props = null
      this.propsInfo = null
    }
    if (this.terrain) {
      this.scene.remove(this.terrain.group)
      this.terrain.dispose()
      this.terrain = null
      setTerrain(null)
    }

    this.kills = 0
    // 🤸 색 학습도 판 단위입니다 — 앞 판에서 배운 것이 새 판에 얹히지 않게.
    this.wrongAnswers.clear()
    this.retaught.clear()
    // 💀 판이 바뀌면 사인 장부도 비웁니다 — 앞 판의 죽음이 다음 판에 얹히지 않게.
    this.deathLog = []
    this.waveTimer = 0
    this.gameOver = false
    this.bossDefeated = false
    this.treasuresFound = 0
    this.treasureTotal = 0
    this.barrelsBlown = 0
    this.treasuresBlown = 0
    this.barrelsCaught = 0
    this.barrelsLitCaught = 0
    this.hitsDealt = 0
    this.damageDealt = 0
    this.backHits = 0
    this.critHits = 0
    this.hud.hideBanner()
    this.saveId = ''
    this.takenTreasures = new Set()
    this.boughtItems = new Set()
    resetTripods()
    this.tripodPanel.setOpen(false)
    this.shopPanel.setOpen(false)
    setEnemyAiEnabled(true)
    // 아레나는 종류별 기본값(55m)을 그대로 씁니다 — 좁히면 반경 21m에 소환된
    // 적이 영원히 제자리에 섭니다. 레벨을 실제로 불러온 뒤에 방 단위로 덮습니다.
    setAggroRangeOverride(0)
    // 아레나에는 지형이 없으므로 직선거리로 되돌립니다.
    setReachDistance(null)
    setBonfireReach(null)
    resetAttackTokens()
    resetChainLedger()  // 장부는 **판 시작에만** 지웁니다(enemyAI 설계 노트)
    resetPhaseTeaching()
    // 눈금도 같이 비웁니다 — 안 그러면 앞 판의 초록이 이번 판에 섞입니다
    // (조합 프로브가 '앞 검사가 깨워 놓은 적'을 세던 것과 같은 실수).
    resetGreenOutcome()
    // 🎲 무엇을 골랐는지의 장부도 같은 자리에서 비웁니다(enemyAI `notePick` 설계 노트).
    resetPickLog()
    // 🔁 «직전에 낸 것» 장부도 판 시작에 비웁니다(enemyAI `REPEAT_PENALTY` 설계 노트).
    resetLastPicks()
    resetStaminaSpent()
    // 🩸 피격 장부도 **판 시작에만** 지웁니다(연계 장부에서 배운 것 — 화톳불마다
    //    지우면 예약과 발동의 수명이 달라져 서로 비교할 수 없게 됩니다).
    this.hurtLedger = []
    this.hurtWatch.clear()
    this.justGuards = 0
    this.bleedPops = 0
    // ⚔️ 보스전 시간 분해도 판마다 비웁니다 — 안 비우면 두 판이 섞입니다.
    this.bossTime = {
      total: 0,
      attack: 0,
      dodge: 0,
      guard: 0,
      stagger: 0,
      drink: 0,
      chase: 0,
      ready: 0,
      readyNoStamina: 0,
    }
    resetBleedPeak()
    resetPoiseDealt()
    resetFocusFlow()
    resetHealPunish()
    this.regions = []
    this.currentRegion = ''
    this.guide.visible = false

    let level: LevelData | null = null
    if (this.source === 'storage') level = loadLevelFromStorage()
    else if (this.source === 'bundled') level = loadBundledLevel(DEFAULT_LEVEL_ID)
    this.levelMode = level !== null

    if (level) {
      this.levelName = level.name
      this.regions = level.regions ?? []
      this.buildRegionNeighbours()
      this.levelW = level.w
      this.levelH = level.h
      this.terrain = new Terrain(level)
      this.scene.add(this.terrain.group)
      /**
       * 🏛 폐허 잔해 — 지형과 **따로** 붙입니다(render/props.ts 머리말).
       * 플레이어가 설 수 없는 칸에만 서므로 이동·전투에는 손대지 않습니다.
       */
      const props = buildProps(this.terrain)
      this.props = props.group
      this.propsInfo = props.info
      this.scene.add(this.props)
      setTerrain(this.terrain)
      this.arena.visible = false

      // 존은 **방 단위**로 깨어납니다(balance.ts LEVEL_AGGRO_RANGE 설계 노트).
      setAggroRangeOverride(LEVEL_AGGRO_RANGE)
      /**
       * 그리고 그 "방 단위"는 **걸어야 하는 거리**로 잽니다.
       * 직선으로 재면 벽 너머의 적이 깨어나 영원히 벽을 향해 걷습니다
       * (terrain.ts buildPlayerField 설계 노트에 측정값이 있습니다).
       */
      const reach = (x: number, z: number) => this.terrain?.distanceToPlayer(x, z) ?? null
      setReachDistance(reach)
      setBonfireReach(reach)
      this.levelData = level
      const spawned = spawnFromLevel(level, this.terrain)
      this.bonfires = spawned.bonfires
      for (const f of this.bonfires) this.visuals.addBonfire(f.x, f.y, f.z)
      this.anvils = spawned.anvils
      for (const a of this.anvils) this.visuals.addAnvil(a.x, a.y, a.z)
      /**
       * 🧱 **금 간 벽에는 사다리를 안 그립니다.** 두 장치가 같은 부품을
       *    쓰기 때문에(terrain.ts `Shortcut.kind`) 여기서 갈라 주지 않으면
       *    벽 자리에 사다리가 한 짝 서게 됩니다.
       *
       * ⚠️ 그래도 **자리는 비워 둡니다**(null). `syncLadderVisuals` 가
       *    번호로 짝을 맞추므로, 걸러서 배열을 줄이면 그 뒤의 사다리들이
       *    전부 **한 칸씩 밀린 상태를 따라가게** 됩니다.
       */
      this.ladderVisuals = this.terrain.shortcuts.map((s) =>
        s.kind === 'ladder' ? this.visuals.addLadder(s) : null,
      )
      this.playerEntity = spawned.player
      this.visuals.attach(this.playerEntity, Renderable.kind[this.playerEntity])
      for (const e of spawned.entities) this.visuals.attach(e, Renderable.kind[e])
      this.syncHiddenTreasures()
      this.treasureTotal = spawned.treasureTotal

      // ---- 세이브 복원 (systems/save.ts 설계 노트: 얻은 것은 남고, 싸움은 처음부터) ----
      //
      // **적은 이미 전부 되살아난 뒤**입니다(spawnFromLevel이 방금 다 만들었습니다).
      // 여기서 되돌리는 것은 성장과 획득뿐입니다. 순서가 중요합니다 —
      // 플레이어 엔티티가 만들어진 **다음에** 장비를 얹어야 합니다.
      this.saveId = levelIdOf(level.name, level.w, level.h)
      const save = loadSave(this.saveId)
      if (save) {
        applySave(save, this.playerEntity)
        this.takenTreasures = new Set(save.treasures)
        this.boughtItems = new Set(save.boughtItems ?? [])
        this.defeatedBosses = new Set(save.bosses)
        // 내려둔 사다리는 남습니다. **지름길은 지식의 보상**이라, 게임을 껐다
        // 켰다고 다시 걷히면 알아낸 것을 빼앗는 셈이 됩니다.
        this.terrain.applyOpenShortcuts(save.ladders)
        this.syncLadderVisuals()
        /**
         * 🧱 **이미 부순 벽은 다시 세우지 않습니다.**
         *
         * 벽의 열림 상태는 사다리와 같은 곳에 저장되므로(`openShortcutKeys`)
         * 위 한 줄로 **길은** 열린 채 돌아옵니다. 그런데 **몸통**은 다릅니다 —
         * `spawnFromLevel` 이 벽 하나당 하나씩 이미 세워 놓은 뒤라,
         * 그대로 두면 *"길은 뚫려 있는데 벽이 서 있는"* 그림이 됩니다.
         *
         * 먹은 보물·잡은 보스와 **완전히 같은 모양의 문제**이고, 그래서
         * 바로 아래 두 줄과 나란히 같은 방식으로 치웁니다.
         */
        this.removeBrokenWalls()
        // 🎁 벽이 열린 채로 시작하면 그 방 보물은 더 이상 숨은 것이 아닙니다.
        this.syncHiddenTreasures()
        // 이미 먹은 보물은 아예 치웁니다. 남겨두면 다시 먹혀서 각인석이 무한정 생깁니다.
        this.removeTakenTreasures()
        // 이미 잡은 보스도 치웁니다. 안 하면 게임을 다시 켤 때마다 보스가
        // 되살아나서 "보스는 부활하지 않는다"는 규칙이 반쪽이 됩니다.
        this.removeDefeatedBosses()
      }
      this.treasuresFound = this.takenTreasures.size

      const foes = spawned.entities.length - spawned.treasureTotal
      this.hud.setMode('level')
      if (save) {
        this.hud.showBanner(
          level.name,
          `이어하기 — 보물 ${this.treasuresFound}/${this.treasureTotal} · 각인석 ${tripodPoints()}`,
          2.4,
        )
      } else {
        // 레벨 모드는 룬 없이 시작합니다 — 룬은 탐험(보물)으로 얻습니다.
        this.hud.showBanner(level.name, `적 ${foes} · 보물 ${spawned.treasureTotal}`, 2.4)
      }
      // 시작 지점이 화면 중앙에 오도록 카메라를 미리 붙여 둡니다.
      this.cam.snapTo(Transform.x[this.playerEntity], Transform.z[this.playerEntity])
    } else {
      // 아레나는 전투 시험장이라 진행이라는 개념이 없습니다 — 저장하지 않습니다.
      this.saveId = ''
      this.levelName = ''
      this.arena.visible = true
      this.playerEntity = spawnPlayer()
      this.visuals.attach(this.playerEntity, Renderable.kind[this.playerEntity])
      // 아레나는 전투 시험장이므로 룬 두 개를 미리 줍니다.
      // (레벨 모드에서는 탐험으로 얻어야 합니다 — 성장 설계의 차이)
      grantRune(this.playerEntity, 0)
      grantRune(this.playerEntity, 1)
      this.wave = 1
      this.hud.setMode('arena')
      this.startWave()
    }
    this.refreshLoadout()
  }

  /** 스킬바에 현재 무기/룬 이름을 반영합니다. */
  private refreshLoadout(): void {
    const p = this.playerEntity
    if (p < 0) return
    const slots = []
    for (let i = 0; i < SLOT_COUNT; i++) {
      const def = skillForSlot(p, i)
      slots.push({ name: def?.name ?? '', empty: !def })
    }
    // 강화 단계를 무기 이름에 붙입니다. 소울라이크가 "+3 롱소드"라고 쓰는 이유는
    // **지금 내 무기가 얼마나 컸는지**가 매 순간 보여야 투자가 실감되기 때문입니다.
    const lv = weaponLevel(p)
    /**
     * 🏆 **등급을 이름 앞에 붙이고, 이름에 등급 색을 입힙니다.**
     *
     * 옵션 줄은 이름 아래에 작게 답니다 — 이 게임의 화면 규칙(*"안내는
     * 필요한 만큼만"*)을 지키되, **지금 내가 무엇을 들고 있는가**는 늘
     * 보여야 합니다. 그게 안 보이면 상자를 여는 재미가 배너 3초로 끝납니다.
     */
    const tier = weaponTier(p)
    const td = tierDef(tier)
    const base = lv > 0 ? `${weaponOf(p).name} +${lv}` : weaponOf(p).name
    const label = tier > 0 ? `${td.name} ${base}` : base
    this.skillBar.setLoadout(label, slots, {
      color: td.color,
      affixes: weaponAffixes(p).map((a) => `${a.name} +${a.value}${a.unit === '%' ? '%' : ''}`),
    })
    this.tripodPanel.setPlayer(p)
  }

  private startWave(): void {
    const ids = spawnWave(enemyCountForWave(this.wave), this.wave)
    for (const e of ids) this.visuals.attach(e, Renderable.kind[e])
    this.hud.showBanner(`웨이브 ${this.wave}`, `적 ${ids.length}마리`, 1.6)
  }

  start(): void {
    this.lastFrameMs = performance.now()
    const loop = (nowMs: number) => {
      requestAnimationFrame(loop)
      this.frame(nowMs)
    }
    requestAnimationFrame(loop)
  }

  private frame(nowMs: number): void {
    // 일시정지는 **검증 도구 전용**입니다. 0.19초짜리 검격 궤적처럼 짧은 순간을
    // 사진으로 남기려면 그 프레임에서 화면을 멈춰 세우는 수밖에 없습니다.
    // 시각을 갱신해 두어야 재개할 때 델타가 튀지 않습니다.
    if (this.paused) {
      this.lastFrameMs = nowMs
      return
    }
    const rawDt = (nowMs - this.lastFrameMs) / 1000
    this.lastFrameMs = nowMs
    tick(rawDt)

    const p = this.playerEntity
    const playerAlive = !this.gameOver && Actor.state[p] !== ActorState.Dead
    const playerY = Transform.y[p]

    // ---- 1. 조준: 화면 커서 -> 지면 좌표 ----
    // 조준 평면을 플레이어가 서 있는 높이에 맞춥니다. y=0 고정으로 두면
    // 언덕 위에 올라섰을 때 커서와 실제 조준 방향이 어긋납니다.
    if (this.cam.screenToGround(mouse.ndcX, mouse.ndcY, playerY, this.aim)) {
      mouse.worldX = this.aim.x
      mouse.worldZ = this.aim.z
    }
    this.controlCtx.aimX = this.aim.x
    this.controlCtx.aimZ = this.aim.z

    // 소리의 기준점 = 플레이어. 좌우 패닝은 **카메라의 우측 벡터**로 계산합니다.
    // 월드 좌표를 그대로 쓰면 쿼터뷰 45° 때문에 화면 왼쪽 적이 오른쪽에서
    // 들립니다 — 보이는 위치와 들리는 위치가 어긋나면 정보가 아니라 방해입니다.
    sfx.setListener(Transform.x[p], Transform.z[p], this.cam.right.x, this.cam.right.z)
    // 음악은 **realDt** 축입니다 — 히트스톱으로 게임이 멈춰도 흘러야 합니다
    // (VFX·카메라와 같은 규칙, core/time.ts 설계 노트).
    sfx.tickMusic(time.realDt)

    // ---- 1.4 음소거 (M) ----
    /**
     * F1 — 조작표를 통째로 펼칩니다.
     *
     * "배우면 사라지는 안내"에는 **다시 찾아볼 곳**이 반드시 있어야 합니다.
     * 없으면 그건 사라지는 안내가 아니라 그냥 사라진 안내입니다.
     */
    if (consumePress('F1')) {
      this.hud.toggleAllControls()
    }
    if (consumePress('KeyM')) {
      this.hud.showBanner(sfx.toggleMute() ? '음소거' : '소리 켜짐', 'M 키로 전환', 1.1)
    }

    // ---- 1.5 트라이포드 창 (T) ----
    // 창을 열어도 게임은 계속 돕니다(ui/tripodPanel.ts 설계 노트).
    // 그래서 여는 것 자체가 안전하지 않은 선택이 되고, "언제 열지"도 판단이 됩니다.
    if (consumePress('KeyT')) this.tripodPanel.toggle()

    // ---- 1.6 상점 창 (N) — **모루 앞에서만** ----
    /**
     * 🏪 맥락 키입니다(*"이 자리에서 할 수 있는 일"*). 모루에서 멀면
     * 아무 일도 안 일어나고, 멀어지면 창이 저절로 닫힙니다.
     *
     * ⚠️ 상시 키(전투 동사)와 겹치면 안 됩니다 — `npm run guard` 가 봅니다.
     *    N 은 전투에서 아무 뜻도 없는 키입니다.
     * ⚠️ **안 되는 이유를 말해 줍니다.** 아무 반응이 없으면 「고장」으로
     *    읽힙니다 — 사다리가 아래에서 안 열릴 때와 같은 규칙입니다.
     */
    if (consumePress('KeyN')) {
      if (this.shopAnvil) {
        this.shopPanel.toggle()
        if (this.shopPanel.isOpen()) this.refreshShop()
      } else {
        this.hud.showBanner('상점은 모루에서', '모루 앞에 서면 N 으로 열립니다', 1.6)
      }
    }

    // ---- 2. 시뮬레이션 ----
    /**
     * **플레이어까지의 거리장을 먼저 만듭니다.**
     * 어그로와 화톳불 차단이 이 값을 씁니다(직선거리가 아니라 걷는 거리).
     * 플레이어가 격자 칸을 옮길 때만 다시 계산합니다 — 대부분의 프레임은 캐시입니다.
     */
    this.terrain?.buildPlayerField(Transform.x[p], Transform.z[p])
    /**
     * 🧪 실험대 전용 — 기력을 **붙들어 둡니다**(`pinStamina`).
     *
     * ⚠️ 왜 `setStamina` 로는 부족한가: 프로브는 8ms 마다 JS 로 0을 써
     *    넣었는데, 시뮬레이션은 그 사이에도 돌면서 기력을 **회복시킵니다**
     *    (34/초). 문턱이 25였을 땐 그래도 계속 25 밑이라 티가 안 났지만,
     *    문턱을 *"0보다 큰가"* 로 바꾸자마자 **0을 쓰는 즉시 0.3씩 차올라**
     *    "기력 0" 이라던 판이 사실은 기력 0이 아니게 됐습니다.
     *    프로브의 검사 셋이 한꺼번에 빨개진 것이 그 증상이었습니다.
     *
     * 재려는 조건을 **게임이 매 프레임 지켜 줘야** 실험이 실험이 됩니다.
     */
    if (this.staminaPin !== null) {
      Stamina.value[p] = this.staminaPin
      /**
       * ⚠️ **회복도 같이 막아야 합니다.** 여기서 값만 써 넣었더니
       *    바로 뒤 `playerControlSystem` 안의 회복이 같은 프레임에 돌아서
       *    0으로 붙든 기력이 **1.7 로 올라간 채** 구르기 판정을 만났습니다
       *    (34/초 × 최대 50ms 프레임 = 1.7 — 프로브가 찍은 값과 정확히 같습니다).
       *    붙든다는 것은 *"쓰기"* 가 아니라 *"그 값으로 유지"* 입니다.
       */
      Stamina.regenDelayT[p] = 999
    }
    if (playerAlive) playerControlSystem(this.controlCtx)
    enemyAiSystem(p, playerAlive, this.controlCtx)
    physicsSystem()
    // 🩸 예고 중에 모읍니다 — 맞고 나서 되짚으면 화면도 상태도 이미 바뀝니다.
    this.watchTelegraphs(p)
    resolveAttacks()
    /**
     * 💥 도화선은 **판정 뒤에** 굴립니다. 순서가 뜻입니다 — 이 프레임에
     * 붙은 불이 같은 프레임에 한 틱 타 버리면, 짧은 프레임에서는 도화선이
     * 규칙보다 짧아집니다. 붙는 것과 타는 것은 다른 프레임의 일입니다.
     */
    barrelSystem(time.dt)
    /**
     * 🏺 항아리는 **도화선이 없으므로** 판정 바로 뒤에 결산합니다.
     * 통과 나란히 두는 이유는 하나입니다 — 둘 다 *"때려서 부수는 물건"*
     * 이라 어느 하나만 다른 프레임에 처리되면 같은 한 대에 대한 반응이
     * 한 프레임 어긋납니다.
     */
    urnSystem()
    crackedWallSystem()

    // ---- 3. 타격 피드백 ----
    // 손맛의 3요소(정지 + 흔들림 + 숫자)를 여기서 한꺼번에 터뜨립니다.
    for (const hit of hitEvents) {
      if (!hit.victimIsPlayer && hit.damage > 0) {
        this.hitsDealt++
        this.damageDealt += hit.damage
        if (hit.back) this.backHits++
        if (hit.crit) this.critHits++
      }
      requestHitstop(hit.hitstop)
      this.cam.addTrauma(hit.trauma, hit.dirX, hit.dirZ)
      /**
       * 소리를 **여기서** 냅니다 — 히트스톱·흔들림·데미지 숫자와 같은 줄에서.
       *
       * 손맛은 눈·귀·손 세 신호가 **같은 프레임에** 도착할 때 완성됩니다.
       * 시스템 안쪽에서 따로 울리면 히트스톱만큼(최대 0.11초) 어긋나는데,
       * 그 정도면 사람은 "소리가 늦다"로 느낍니다.
       */
      if (hit.victimIsPlayer && hit.damage > 0) {
        this.enemyHits++
        // 🩸 이 한 대가 공정했는지를 **맞은 자리에서** 적습니다.
        this.noteHurt(hit.attacker, hit.attackId, hit.damage)
        /**
         * ── 귀속을 **추측에서 사실로** 바꿨습니다 ────────────────────
         *
         * 예전에는 이랬습니다: *"지금 판정 단계에 있는 적을 찾아서, 처음
         * 찾은 쪽의 것으로 친다."* 적이 하나면 맞지만, 둘이 동시에 판정에
         * 들어가 있으면 **먼저 발견된 쪽이 가져갑니다.** 잡몹 다섯에
         * 둘러싸인 상황이 흔하니 드문 일도 아니었습니다.
         *
         * 이제 타격 사건이 때린 쪽(`hit.attacker`)을 직접 들고 옵니다.
         * 알고 있는 것을 다시 추측할 이유가 없습니다.
         */
        const byKind = this.foeLastSwing.get(hit.attacker)
        if (byKind) {
          const rec = (this.foeSwingLog[byKind] ??= { swings: 0, hits: 0 })
          rec.hits++
        }
        const byColor = this.bossLastSwing.get(hit.attacker)
        if (byColor) {
          const rec = (this.bossSwingLog[byColor] ??= {
            swings: 0,
            hits: 0,
            chained: 0,
            byPhase: [0, 0, 0],
          })
          rec.hits++
        }
      }
      if (hit.victimIsPlayer) {
        sfx.hurt()
      } else if (hit.damage > 0) {
        sfx.impact(hit.heavy, hit.back || hit.crit, hit.x, hit.z)
      }
      this.vfx.spawnHitSpark(hit.x, hit.y, hit.z, hit.back || hit.crit ? 1.8 : hit.heavy ? 1.5 : 1)
      this.vfx.spawnDamage(hit.x, hit.y + 0.5, hit.z, Math.abs(hit.damage), {
        heavy: hit.heavy,
        back: hit.back,
        crit: hit.crit,
        heal: hit.damage < 0,
      })
    }
    hitEvents.length = 0

    /**
     * ---- 3.5 보스 페이즈 전환 ----
     *
     * 전환은 **놓칠 수 없어야** 합니다. 배너(눈) + 포효(귀) + 흔들림/충격파(손)를
     * 한꺼번에 터뜨립니다. 소리를 넣어 둔 덕에 이제 세 채널이 다 동원됩니다.
     * 배너 문구에 "무엇이 바뀌었는지"를 그대로 적는 이유: 규칙이 바뀐 것을
     * 알아도 **무엇이 바뀌었는지 모르면** 결국 맞아 보고 배우게 됩니다.
     */
    for (const ev of phaseEvents) {
      // 페이즈가 오르면 음악도 거세집니다 — 숫자를 안 봐도 단계가 귀에 들립니다.
      sfx.startMusic(ev.phase + 1)
      this.hud.showBanner(ev.banner, ev.desc, 3.2)
      this.cam.addTrauma(0.95)
      requestHitstop(0.16)
      sfx.bossPhase()
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        this.vfx.spawnHitSpark(
          ev.x + Math.cos(a) * 1.9,
          0.6 + vfxRng.next() * 1.8,
          ev.z + Math.sin(a) * 1.9,
          1.5,
        )
      }
    }
    phaseEvents.length = 0

    // ---- 3.6 회복 연출 ----
    for (const h of healEvents) {
      this.vfx.spawnDamage(h.x, h.y + 0.9, h.z, h.amount, { heal: true })
      this.vfx.spawnHitSpark(h.x, h.y + 0.8, h.z, 1.1)
      sfx.pickup()
    }
    healEvents.length = 0

    /**
     * ---- 3.7 화톳불 ----
     *
     * 판정은 systems/bonfire.ts 가 하고, **보상은 여기서** 줍니다.
     * 시스템은 레벨 데이터를 몰라야 하기 때문입니다(적을 되살리려면 원본 배치가
     * 필요한데, 그건 게임 루프만 갖고 있습니다).
     */
    if (playerAlive) this.collectDrop(p)

    /**
     * **모루 곁인가** — 화톳불과 같은 반경을 씁니다.
     *
     * 반경을 따로 두지 않은 이유: 플레이어가 "얼마나 붙어야 하는가"를
     * 물건마다 다르게 외울 이유가 없습니다. 다른 것은 **무엇을 해 주는가**
     * 하나뿐이어야 배울 것이 늘지 않습니다.
     */
    let nearAnvil = false
    // 🏪 **어느** 모루인지도 기억합니다 — 상점의 재고가 모루마다 다릅니다.
    this.shopAnvil = null
    if (playerAlive) {
      for (const a of this.anvils) {
        if (Math.hypot(a.x - Transform.x[p], a.z - Transform.z[p]) <= BONFIRE.radius) {
          nearAnvil = true
          this.shopAnvil = a
          break
        }
      }
    }
    // 모루에서 멀어지면 창이 따라 닫힙니다. **자리를 떠나면 그 자리의 일도
    // 끝나야** "이 자리에서 할 수 있는 일"이라는 약속이 지켜집니다.
    if (!nearAnvil && this.shopPanel.isOpen()) this.shopPanel.setOpen(false)

    if (playerAlive && (this.bonfires.length > 0 || nearAnvil)) {
      const rest =
        this.bonfires.length > 0
          ? bonfireSystem(p, this.bonfires)
          : { rested: false, litNow: false, near: null, progress: 0, blocked: false }
      const atFire = rest.near !== null && !rest.blocked
      /**
       * 강화는 **화톳불 또는 모루** 어느 쪽에서든 됩니다.
       * 나머지(회복·부활·적 부활)는 아래에서 `rest` 로만 갑니다 — 모루는
       * 그 어느 것도 건드리지 않습니다.
       */
      /**
       * **게임이 판단한 "지금 여기서 강화할 수 있는가"** 를 남깁니다.
       *
       * 자동 플레이가 소비처에 닿아 B 를 네 번 눌렀는데 강화 횟수는
       * **0** 이었습니다. 봇이 자기 기준(직선 2.6m)으로 "닿았다"를 판단하고
       * 있었기 때문입니다. 게임의 반경은 `BONFIRE.radius` 2.4m 이고,
       * 화톳불 쪽은 **적이 14m 안에 있으면 막힙니다**(`rest.blocked`).
       * 즉 봇은 못 쓰는 자리에서 누르고 "썼다"고 적고 있었습니다.
       *
       * 규칙을 두 곳에 적으면 한쪽만 낡습니다. 처형(`finisherInfo().ready`)
       * 에서 이미 정한 방식대로, **판단은 게임이 하고 봇은 읽기만** 합니다.
       */
      this.canSpendHere = atFire || nearAnvil
      /**
       * ⚠️ **왜 못 쓰는지까지 남깁니다.**
       *
       * `자리아님 4회` 라는 숫자는 나오는데, 그 넷이 *"가까이 안 갔다"* 인지
       * *"갔는데 적 때문에 막혔다"* 인지 알 수 없었습니다. 처방이 정반대입니다:
       * 앞은 **봇의 이동**, 뒤는 **정리부터 하고 쉬라**는 설계 그대로입니다.
       *
       * 이 저장소가 이번 세션에 계속 확인한 규칙 그대로 — 결과 하나를
       * **갈래마다 나눠 셉니다.** 그리고 그 갈래는 사건이 일어난 이 자리에서
       * 이름이 붙어야 밖에서 추측하지 않습니다.
       */
      this.spendBlock = this.canSpendHere
        ? ''
        : rest.near !== null && rest.blocked
          ? 'foe' // 화톳불에 닿았는데 적이 14m 안에 있습니다
          : 'away' // 아직 어느 소비처에도 안 닿았습니다
      this.tryUpgrade(p, this.canSpendHere)
      this.tryTravel(p, atFire)
      this.tryUpgradeWeapon(p, this.canSpendHere)
      if (nearAnvil && !atFire) this.hud.setRest(true, 0, false, true)
      else this.hud.setRest(rest.near !== null, rest.progress, rest.blocked)
      if (rest.litNow && rest.near) {
        // **닿기만 해도 부활 지점이 됩니다.** 회복·적 부활은 여전히 "쉬어야"
        // 일어납니다 — 안전망과 보상을 분리한 것입니다(systems/bonfire.ts 설계 노트).
        Player.respawnX[p] = rest.near.x
        Player.respawnZ[p] = rest.near.z
        Player.hasRespawn[p] = 1
        sfx.pickup()
        this.hud.showBanner('화톳불에 불이 붙었다', '여기서 다시 시작합니다', 2.0)
        this.persistProgress()
      }
      if (rest.rested && rest.near) this.restAt(p, rest.near)
    } else {
      this.hud.setRest(false, 0, false)
    }

    /**
     * ---- 처음 보는 색이면 **정답을 한 번** 알려줍니다 ----
     *
     * ── 왜 필요한가 ──────────────────────────────────────────────
     * 이 게임의 중심은 4색 예고입니다(기둥 2). 그런데 게임 **안에서**
     * 그 규칙을 설명하는 곳이 한 군데도 없었습니다 — 화면 아래 키 목록은
     * 조작표이지 규칙이 아닙니다. 처음 여는 사람은 색만 보고 다섯 가지
     * 다른 정답을 **추론**해야 합니다.
     *
     * 존은 이미 색을 순서대로 가르치도록 배치되어 있습니다(잡몹이 먼저,
     * 보스가 나중). 배치가 *언제* 가르칠지를 정했으니, 여기서는 *무엇을*
     * 가르칠지만 한 줄 얹습니다.
     *
     * ── 규칙 셋 ──────────────────────────────────────────────────
     *   1. **색마다 한 번만.** 반복되면 안내가 아니라 잔소리가 됩니다.
     *   2. **예고가 시작될 때.** 맞고 나서 알려주면 늦습니다.
     *   3. 문구는 `INTENT_LABEL` 에서 그대로 가져옵니다 — 색의 정답을
     *      바꿨을 때 안내만 옛말을 하는 일이 없어야 합니다.
     */
    if (playerAlive) {
      const ids = enemyQuery.run()
      for (let i = 0; i < enemyQuery.count; i++) {
        const e = ids[i]
        if (Actor.state[e] !== ActorState.Attack) continue
        if (Actor.phase[e] !== AttackPhase.Windup) continue
        if (this.queueColorHint(attackAt(Enemy.kind[e], Enemy.attackIndex[e]).intent)) break
      }
    }
    // 🎨 줄에서 하나씩 꺼냅니다 — 규칙(색마다 한 번)은 넣을 때 이미 걸렸습니다.
    this.colorHintT = Math.max(0, this.colorHintT - time.dt)
    if (this.colorHintT <= 0 && this.colorHintQueue.length > 0) {
      const intent = this.colorHintQueue.shift() as AttackIntent
      this.hud.showColorHint(INTENT_LABEL[intent], INTENT_COLOR[intent])
      // HUD 의 기본 표시 시간과 **같은 값**이라야 줄이 앞당겨지지 않습니다.
      this.colorHintT = Hud.COLOR_HINT_SECONDS
    }

    /**
     * ---- 🤸 **틀린 답을 되풀이하면 한 번 더** 알려줍니다 ----
     *
     * ── 왜 필요한가 (재고 나서) ────────────────────────────────────
     * 위 안내는 **첫 목격 때 한 번**이 전부입니다. 그 뒤로 🟡 에 계속
     * 구르며 계속 맞아도 *"그건 이 색의 답이 아니다"* 라고 말해 주는
     * 곳이 없습니다 — **죽어야** 죽음 화면이 말해 줍니다.
     *
     * 그런데 자동 플레이(초보자의 하한선)는 **모든 색에 구르기로 답합니다.**
     * 그리고 게임 쪽은 멀쩡합니다 — `npm run sweep` 이 두 광역 모두
     * *"예고가 뜬 순간부터 걸으면 벗어난다"* 고 확인했습니다
     * (잡몹 1.25초·4.6m → 판정 순간 8.8m). 즉 **답을 모르는 것**이지
     * 답이 안 통하는 것이 아닙니다. 모르는 것은 알려 주면 됩니다.
     *
     * 참고한 자리: 세키로는 쳐내기 실패를 **즉시 다른 소리**로 알려 주고,
     * 몬스터 헌터는 같은 실수를 반복하면 화면이 다시 가르칩니다.
     * 공통 원리는 **가르칠 자리는 실패한 순간**이라는 것입니다 —
     * 주의가 가장 높은 때이고, 그때 배운 것만 남습니다.
     *
     * ── 잔소리가 되지 않게 ────────────────────────────────────────
     * 위 규칙 1(*"색마다 한 번만"*)을 깨는 것이므로 조건을 좁게 둡니다:
     *   · **틀린 답으로** 맞았을 때만 셉니다(구를 색이 아닌데 굴렀다)
     *   · 색마다 `RETEACH_AFTER` 번 쌓였을 때 **딱 한 번 더**
     * 즉 색당 평생 최대 두 번입니다.
     */
    if (playerAlive) {
      for (const [intent, n] of this.wrongAnswers) {
        if (n < RETEACH_AFTER || this.retaught.has(intent)) continue
        this.retaught.add(intent)
        this.hud.showColorHint(INTENT_LABEL[intent as AttackIntent], INTENT_COLOR[intent as AttackIntent])
        break
      }
    }

    /**
     * 적이 **판정 단계에 진입한 횟수**를 셉니다.
     * 예고만 띄우고 끊긴 것은 세지 않습니다 — 재려는 것은 "휘둘렀는가"입니다.
     */
    {
      const ids = enemyQuery.run()
      for (let i = 0; i < enemyQuery.count; i++) {
        const e = ids[i]
        if (Actor.state[e] !== ActorState.Attack) continue
        if (Actor.phase[e] !== AttackPhase.Active) continue
        if (this.swungLastFrame.has(e)) continue
        this.enemySwings++
        /**
         * **보스가 어떤 색을 몇 번 휘두르고 몇 번 맞혔는지**를 따로 셉니다.
         *
         * 자동 플레이 아홉 판을 모아 보니 보스전에서 받은 피해가 4~77,
         * 교전 1분당 45.7 — **존에서 가장 안전한 지속 전투**였습니다.
         * 3페이즈짜리 절정인데도요. 원인이 "예고가 길어서 다 피한다"인지
         * "연계가 설계대로 안 나온다"인지 갈라야 고칠 곳이 정해집니다.
         */
        /**
         * ── 적 **종류마다** 휘두름/적중을 셉니다 ────────────────────
         *
         * 지금까지 이 눈금은 **보스만** 셌습니다. 그래서 잡몹들이 존에서
         * 실제로 무엇을 하는지는 한 번도 본 적이 없습니다 — 쏘는 자를
         * 넣고도 *"정말 쏘는가"* 를 물을 방법이 없었습니다.
         *
         * 이 프로젝트에서 반복된 모양입니다: **세는 눈금이 없으면 그
         * 기능은 있어도 없는 것과 같습니다**(보물 0개 · 연계 상수 0 ·
         * 안 보이던 초록 예고). 새 적을 넣을 때마다 눈금을 새로 만드는 대신,
         * 종류 전체를 한 번에 셉니다.
         */
        {
          const id = enemyDef(Enemy.kind[e]).id
          const rec = (this.foeSwingLog[id] ??= { swings: 0, hits: 0 })
          rec.swings++
          this.foeLastSwing.set(e, id)
        }
        if (Enemy.kind[e] === EnemyKind.Boss) {
          const id = attackAt(Enemy.kind[e], Enemy.attackIndex[e]).id
          const rec = (this.bossSwingLog[id] ??= {
            swings: 0,
            hits: 0,
            chained: 0,
            byPhase: [0, 0, 0],
          })
          rec.swings++
          /**
           * **이 휘두름이 연계로 나온 것인가.**
           *
           * ⚠️ 이 한 줄이 원래 **없었습니다.** `chained: 0` 으로 만들어만 놓고
           * 아무 데서도 올리지 않았습니다. 그래서 판마다 찍히던 "연계 0회"는
           * 관측이 아니라 **상수 0** 이었습니다.
           *
           * 이걸 모르고 세 라운드를 썼습니다 — 보스 조준을 고치고, 거리
           * 조건을 열고, 페이즈 경계를 옮기고, 전용 프로브(`npm run chain`)까지
           * 만들었습니다. 프로브는 15/15 통과했는데 플레이는 0이라, "드물게
           * 나온다"와 "고장 났다" 사이에서 계속 헤맸습니다. 둘 다 아니었고,
           * **세는 눈금이 아예 없었습니다.**
           *
           * 이 프로젝트에서 열두 번째로 잡은 계기 버그입니다. 규칙은 그대로:
           * 숫자가 이상하면 게임보다 **계기를 먼저 의심한다.**
           */
          if (Enemy.chained[e] === 1) rec.chained++
          // **어느 페이즈에서 나왔는지**도 남깁니다. 연계는 2·3페이즈에만
          // 걸려 있으므로, 그 페이즈에 공격이 몇 번이나 나왔는지가
          // "연계가 안 나온다"의 답입니다.
          rec.byPhase[Math.min(2, Enemy.phase[e])]++
          this.bossLastSwing.set(e, id)
        }
      }
      /**
       * **예고를 시작한 횟수** — 판정까지 갔는지와 무관하게 셉니다.
       * 둘의 차이가 곧 *"끊긴 공격"* 이고, 그게 반격이 실제로 먹힌 횟수입니다.
       */
      for (let i = 0; i < enemyQuery.count; i++) {
        const e = ids[i]
        if (Actor.state[e] !== ActorState.Attack) continue
        if (Actor.phase[e] !== AttackPhase.Windup) continue
        if (this.windingLastFrame.has(e)) continue
        const rec = (this.foeSwingLog[enemyDef(Enemy.kind[e]).id] ??= { swings: 0, hits: 0 })
        rec.commits = (rec.commits ?? 0) + 1
        /**
         * **연계로 나온 예고인가.**
         *
         * ⚠️ 잡몹 연계를 넣고 나서야 이게 없다는 걸 알았습니다. 벤치의
         *    "연계 예약/발동" 중 **발동은 보스만 셉니다**(bossSwingLog).
         *    그래서 잡몹 연계가 실제로 이어졌는지는 **어디에도 안 남아
         *    있었습니다.**
         *
         *    예약은 전역이라 1.0 → 6.5 회로 뛴 것이 보였는데, 그건
         *    "예약됐다"까지입니다. 예약과 발동을 갈라 세려고 만든 눈금이
         *    정작 잡몹에는 절반만 있었던 셈입니다 — inputCancels 때와
         *    똑같은 구멍입니다.
         */
        if (Enemy.chained[e] === 1) rec.chained = (rec.chained ?? 0) + 1
      }

      this.swungLastFrame.clear()
      this.windingLastFrame.clear()
      for (let i = 0; i < enemyQuery.count; i++) {
        const e = ids[i]
        if (Actor.state[e] !== ActorState.Attack) continue
        if (Actor.phase[e] === AttackPhase.Active) this.swungLastFrame.add(e)
        if (Actor.phase[e] === AttackPhase.Windup) this.windingLastFrame.add(e)
      }

      /**
       * **적이 살아 있는 동안 무엇을 하고 있었는지**를 나눠 담습니다.
       *
       * 왜 이 눈금이 필요한가: 달려드는 자가 마리당 0.33회만 휘두른다는
       * 것까지는 셌지만, *왜* 인지는 후보가 셋이었습니다. 그런데
       * enemyAI.ts 의 토큰 코드를 읽어 보니 **셋 다 코드에 실제로 있는
       * 갈림길**이었습니다:
       *   · 경직 중이면 대기열에 **아예 들어가지 않습니다**(`Stagger` continue)
       *   · 쿨다운이 남아 있으면 토큰이 있어도 못 겁니다
       *   · 토큰은 **가까운 순서**로 둘까지만 나갑니다
       *
       * 그래서 살아 있던 시간을 그 세 갈래 그대로 나눠 잽니다. 추측이
       * 아니라 **코드의 분기와 같은 모양으로** 재야 답이 처방으로 이어집니다
       * (경직이면 체력·경직시간, 쿨다운이면 수치, 토큰이면 배치·규칙).
       *
       * 시뮬레이션 시간(dt)으로 더합니다 — 벽시계로 재면 10fps 환경에서
       * 프레임 수를 재는 것이 되어 버립니다(이 프로젝트에서 이미 겪은 종류).
       */
      for (let i = 0; i < enemyQuery.count; i++) {
        const e = ids[i]
        if (Enemy.aggro[e] === 0) continue
        if (Actor.state[e] === ActorState.Dead) continue
        const rec = (this.foeSwingLog[enemyDef(Enemy.kind[e]).id] ??= { swings: 0, hits: 0 })
        rec.aggroT = (rec.aggroT ?? 0) + time.dt
        if (Actor.state[e] === ActorState.Attack) rec.atkT = (rec.atkT ?? 0) + time.dt
        else if (Actor.state[e] === ActorState.Stagger) rec.stagT = (rec.stagT ?? 0) + time.dt
        else if (Actor.cooldownT[e] > 0) rec.coolT = (rec.coolT ?? 0) + time.dt
        else {
          /**
           * 남은 시간을 **거리로 한 번 더 가릅니다.**
           *
           * 첫 판에서 '대기' 하나로 뭉쳐 놨더니 읽을 수가 없었습니다.
           * aggroRange 가 55m 라 깨어 있는 시간의 대부분이 **아직 달려오는
           * 중**일 수 있는데, 그러면 *"사거리 안인데 토큰이 없어 못 건다"*
           * 라는 진짜 신호가 추격 시간에 묻힙니다.
           *
           * 이 프로젝트에서 이미 한 번 겪은 실수입니다 — 길 걷기와
           * 심부름을 '빈 시간' 하나로 재던 것과 같은 모양입니다.
           * 처방도 정반대라서(추격이면 배치·이동속도, 대기면 토큰 규칙)
           * 반드시 갈라야 합니다.
           */
          const reach = attacksFor(Enemy.kind[e]).reduce((m, a) => Math.max(m, a.reach), 0)
          const d = Math.hypot(Transform.x[e] - Transform.x[p], Transform.z[e] - Transform.z[p])
          if (d > reach) rec.chaseT = (rec.chaseT ?? 0) + time.dt
          else rec.readyT = (rec.readyT ?? 0) + time.dt
        }
      }
    }

    /** ---- 3.71 처형 안내 ---- */
    //
    // 무방비 창은 잡몹 기준 1.0초입니다. 안내가 없으면 창이 있는 줄도 모르고
    // 지나갑니다 — 자동 플레이가 "무방비인 적 곁에서 실제로 때린 시간 44%"
    // 라고 재 준 그 상태입니다.
    this.hud.setFinisher(playerAlive && finisherTarget(p) >= 0)

    /** ---- 3.72 사다리(지름길) ---- */
    this.tryDropLadder(p, playerAlive)

    /**
     * ---- 3.75 보스 조우 ----
     *
     * 영역에 들어서면 **준비할 순간**이 생깁니다(1.6초). 그동안 보스는
     * 노려보기만 하고, 배너·포효·전용 체력바가 함께 뜹니다.
     * 안개문이 원래 하던 일 — "여기부터 보스다"를 명확히 알리는 것 — 을
     * 문 없이 하는 방법입니다.
     */
    for (const ev of encounterEvents) {
      if (ev.name === '') {
        // 귀환 = 교전 종료. 체력바를 내리고 음악도 끕니다.
        this.bossEntity = -1
        sfx.stopMusic()
        this.hud.showBanner('놓쳤다', '보스가 자리로 돌아갑니다', 1.8)
        continue
      }
      this.bossEntity = ev.entity
      // 음악은 **여기서만** 시작됩니다. 탐험 구간의 침묵이 설계이므로
      // (core/audio.ts 설계 노트), 조우 자체가 하나의 신호가 됩니다.
      sfx.startMusic(1)
      this.cam.addTrauma(0.55)
      sfx.bossPhase()
      this.hud.showBanner(ev.name, '물러설 곳이 없다', 2.2)
      /**
       * ── 🎨 **이 보스가 쓰는 색 중 아직 못 본 것을 여기서 가르칩니다** ──
       *
       * ── 왜 필요한가 (재고 나서) ────────────────────────────────────
       * `npm run map` 의 🎨 검사가 **다섯 색 전부 피해서 갈 수 있다**고
       * 답했습니다. 그리고 「못 피하는 자리」는 **스폰 58m 안**과 **보스
       * 13m 안**에만 있습니다 — 중반 130m 구간에는 하나도 없습니다.
       * 즉 🔵 속박과 🟣 강제이동을 **보스전에서 처음 보는 판**이 실제로
       * 있을 수 있습니다.
       *
       * 이 게임의 계약은 *"색은 처음 볼 때 한 번 설명한다"* 입니다.
       * 그 계약이 지금은 **보스가 그 색을 휘두르는 순간** 이행됩니다 —
       * 가장 나쁜 때입니다. 계약을 바꾸는 게 아니라 **이행 시점을 앞으로**
       * 옮깁니다: 조우의 준비 구간(1.6초)은 원래 *"여기부터 보스다"* 를
       * 알리는 자리이므로, 거기서 알려 주는 것이 같은 뜻입니다.
       *
       * ⚠️ **못 본 색만** 나갑니다. 잡몹에게 이미 배운 색을 다시 말하면
       *    안내가 아니라 잔소리가 되고, 그건 이 저장소가 색 안내를 만들 때
       *    이미 정한 규칙입니다(「색마다 한 번만」).
       *
       * ⚠️ 배치를 안 고친 이유: 중반에 「반드시 만나는 자리」를 만들려면
       *    지형을 좁혀야 하고, 그건 이 존의 성격(와이드 리니어)을 바꿉니다.
       *    초반(58m 안)에 두면 「새 적은 한 번에 하나씩」이 깨집니다.
       *    **셋 중 가장 싼 것**을 골랐고, 나머지 둘은 make-zone.mjs 에
       *    숫자와 함께 적어 두었습니다.
       */
      /**
       * ⚠️ **최악의 경우는 다섯 줄입니다**(`npm run teach` 가 그렇게 찍습니다 —
       *    이 보스는 다섯 색을 다 씁니다). 한 줄이 3.5초이므로 17.5초가
       *    되는데, 그건 **아무 적도 안 만나고 온 판**에서만 생깁니다.
       *    실제 자동 플레이는 판마다 🔴🟡🟢 을 먼저 만나므로 남는 것은
       *    보통 🔵🟣 둘(7초)입니다.
       *
       *    줄 수를 자르지 않은 이유: 자르면 **못 배운 색이 남고**, 그 색은
       *    다시 보스가 휘두를 때 배우게 됩니다 — 고치려던 바로 그 문제로
       *    돌아갑니다. 다섯 줄이 필요한 사람은 다섯 줄이 필요한 사람입니다.
       */
      for (const a of attacksFor(Enemy.kind[ev.entity])) this.queueColorHint(a.intent)
    }
    encounterEvents.length = 0

    /**
     * ---- 3.78 낙하 ----
     *
     * 물리는 "몇 단 떨어졌다"만 알려주고, **그것을 무엇으로 바꿀지는 여기서**
     * 정합니다. 물리가 체력을 깎기 시작하면 무적 프레임·강인도·연출을 전부
     * 알아야 해서 시스템 경계가 무너집니다.
     *
     * 적에게는 피해보다 **무너짐**이 본체입니다. 절벽 옆 싸움에서 넉백으로
     * 밀어 떨어뜨리면 적이 무방비로 착지하고, 그 틈이 보상입니다.
     * 즉사시키지 않는 이유: 2.7m 낙하로 적이 죽으면 모든 전투가
     * "절벽으로 유인하기" 하나로 수렴합니다.
     */
    for (const f of fallEvents) {
      if (!isAlive(f.entity) || Actor.state[f.entity] === ActorState.Dead) continue
      const dmg = Health.max[f.entity] * (f.steps - FALL.freeSteps) * FALL.damagePerStep
      Health.hp[f.entity] -= dmg
      // 🤕 낙하는 무기가 없으니 히트스톱이 없습니다. 가장 무거운 쪽 끝을
      // 그대로 씁니다 — 절벽에서 떨어진 것은 어떤 칼보다 가볍지 않습니다.
      Health.flashT[f.entity] = hurtFlash(HURT.heavyHitstop)
      this.vfx.spawnDamage(f.x, f.y + 1.3, f.z, Math.round(dmg))
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        this.vfx.spawnHitSpark(f.x + Math.cos(a) * 0.7, f.y + 0.15, f.z + Math.sin(a) * 0.7, 0.9)
      }
      sfx.impact(true, false, f.x, f.z)
      if (f.entity === p) {
        /**
         * 🩸 **낙하도 장부에 적습니다.**
         *
         * 낙하 피해는 `hitEvents` 를 거치지 않습니다. 그래서 장부에 안 적으면,
         * 떨어져 죽은 판에서 **직전에 때린 적이 범인으로 몰립니다.** 이
         * 저장소가 반복해서 당한 "그럴듯한 오귀속"과 같은 모양입니다.
         * 판정은 위 네 가지와 성격이 달라 따로 둡니다 — 예고도 시야도
         * 없었고, 대신 **내 발이 한 일**입니다.
         */
        this.hurtLedger.push({
          attackId: '낙하',
          intent: -1,
          telegraph: 0,
          seen: 0,
          cueSeen: 0,
          free: 0,
          damage: dmg,
          verdict: 'fall',
                  /** 낙하는 구르기로 답할 수 있는 종류가 아닙니다 — -1. */
          sinceTry: -1,
          expected: 0,
          walked: 0,
          spender: '',
          moved: 0,
          color: '낙하',
          answer: '발밑을 보기',
        })
        // 플레이어는 강인도가 없어 늘 비틀거립니다. 착지도 같은 규칙을 씁니다.
        Actor.state[p] = ActorState.Stagger
        Actor.timer[p] = PLAYER_CFG.hurtStagger
        this.cam.addTrauma(FALL.trauma)
        requestHitstop(FALL.hitstop)
        /**
         * 🪂 **낙하 공격 창을 여는 곳은 여기 하나입니다.**
         *
         * 소울류·세키로·오공의 낙하 공격이 파는 것은 "체공"이 아니라
         * **"높이를 무기로 바꾸되 값을 먼저 치른다"** 입니다. 우리는 체공
         * 상태가 없지만(physics.ts 설계 노트 참고 — 쿼터뷰에서 체공은
         * 조작감만 해칩니다), **값은 이미 치렀습니다** — 바로 윗줄에서
         * 체력이 깎이고 경직이 걸렸습니다. 그러니 이 자리가 정확합니다:
         * *떨어져서 아팠다*는 사실이 확정된 직후에만 창이 열립니다.
         *
         * 적에게는 안 엽니다. 적은 낙하로 **무너지고**(위 `breakPoise`),
         * 그 틈이 플레이어의 보상입니다. 양쪽 다 주면 절벽이 서로에게
         * 같은 도구가 되어 "절벽으로 유인하기"의 값어치가 사라집니다.
         *
         * `steps` 를 그대로 넘기는 이유: 높이가 곧 위력이어야 합니다.
         * 2단은 값싼 마무리, 5단은 큰 한 방 — 대신 5단은 체력 36%를
         * 먼저 냅니다. 위험과 보상이 **같은 숫자**에 묶여 있습니다.
         */
        Player.plungeT[p] = PLAYER_CFG.contextAttack.plungeWindow
        Player.plungeSteps[p] = f.steps
      } else if (FALL.breaksPoise && hasComponent(Enemy, f.entity)) {
        breakPoise(f.entity)
      }
      // 사건이 일어난 자리에서 셉니다 — 상태가 덮이기 전에.
      if (f.entity === p) this.fallLog.player++
      else if (hasComponent(Enemy, f.entity)) {
        this.fallLog.foe++
        this.fallLog.foeSteps += f.steps
        const id = enemyDef(Enemy.kind[f.entity]).id
        this.fallLog.byKind[id] = (this.fallLog.byKind[id] ?? 0) + 1
      }
    }
    fallEvents.length = 0

    /**
     * ---- 3.785 🥋 완벽 회피 ----
     *
     * **맞을 공격을 정확히 넘긴 순간에만** 옵니다(combat.ts 판정 주석 참고).
     * 지금까지 구르기는 잘 써도 "안 맞았다"가 전부였습니다. 여기서 집중이
     * 차오르면 회피가 **공격 준비**가 됩니다 — 오공이 완벽 회피에 집중을
     * 주는 이유가 이것입니다.
     *
     * 그런데 집중은 **나중에 쓸 자원**입니다. 완벽 회피를 해낸 그 순간
     * 손에 쥐는 게 없으면 "잘했다"는 느낌이 안 옵니다. 그래서 여기서
     * 확정 치명타 창(perfectCritT)을 같이 엽니다 — 넘긴 즉시 반격하면
     * **반드시** 크리티컬입니다. 로스트아크의 백어택처럼 "정확히 해낸
     * 사람만 받는 확정 보상"이고, 운(치명타 확률)이 끼지 않아야
     * 플레이어가 인과를 배울 수 있습니다.
     */
    for (const d of perfectDodgeEvents) {
      // 🥋 들어온 만큼과 흘린 만큼을 나눠 셉니다 — combat.ts `focusGain` 주석.
      const focusBefore = Player.focus[p]
      Player.focus[p] = Math.min(FOCUS.max, focusBefore + FOCUS.perPerfectDodge)
      noteFocusDodge(
        Player.focus[p] - focusBefore,
        FOCUS.perPerfectDodge - (Player.focus[p] - focusBefore),
      )
      Player.perfectCritT[p] = FOCUS.perfectDodgeCritWindow
      this.cam.addTrauma(0.18)
      sfx.pickup()
      this.vfx.spawnHitSpark(d.x, d.y + 1.1, d.z, 1.1)
      this.hud.showBanner('완벽 회피', '집중 +1 · 다음 일격 확정 치명타', 0.9)
    }
    perfectDodgeEvents.length = 0

    /**
     * ---- 3.78 🛡 저스트 가드 성공 ----
     *
     * 완벽 회피와 **다른 연출**을 씁니다. 회피는 *"내가 잘 피했다"* 라
     * 내 자리에서 터지고, 가드는 *"저 녀석이 튕겨 나갔다"* 라 **막힌 적**의
     * 자리에서 터집니다. 두 답이 다른 것을 벌었다는 사실이 눈으로 갈려야,
     * 플레이어가 "언제 구르고 언제 막을까"를 배웁니다.
     *
     * 히트스톱을 짧게 겁니다 — 저스트 가드의 손맛은 화면이 멎는 길이가
     * 아니라 **딱 맞았다는 순간**에 있습니다(세키로의 튕기기 소리가 짧은 것과
     * 같은 이유). 길게 걸면 자기 다음 행동이 늦어져 오히려 손해로 느껴집니다.
     */
    for (const g of justGuardEvents) {
      this.justGuards++
      requestHitstop(0.07)
      this.cam.addTrauma(0.22)
      sfx.impact(true, true, g.x, g.z)
      this.vfx.spawnHitSpark(g.x, g.y + 1.0, g.z, 1.3)
      this.hud.showBanner('저스트 가드', '자세를 무너뜨립니다', 0.8)
    }
    justGuardEvents.length = 0

    /**
     * ---- 3.79 🟢 반격 성공 ----
     *
     * 일반 무너짐과 **따로** 알립니다. 같은 연출로 처리하면 플레이어는
     * "운 좋게 강인도가 찼구나"로 읽고, 자기가 **의도해서 만든 일**임을
     * 모릅니다. 새 동사를 가르치는 중에는 인과가 분명해야 합니다.
     */
    for (const c of counterEvents) {
      this.counterCount++
      this.cam.addTrauma(COUNTER.trauma)
      requestHitstop(COUNTER.hitstop)
      sfx.bossPhase()
      /**
       * ── 성공했을 때만 쿨다운을 일부 돌려줍니다 ────────────────────
       *
       * 근거는 balance.ts COUNTER.cooldownRefund 설계 노트에 있습니다.
       * 한 줄로: 지금까지 반격은 **위험한 쪽인데 보상이 없었습니다.**
       * 빗나가면 슬롯이 통째로 죽고, 구르기는 빗나가도 기력만 조금 씁니다.
       *
       * ⚠️ 여기(반격이 **성립한** 자리)에서만 합니다. 시전하는 자리에서
       *    깎으면 그건 반격 보상이 아니라 그냥 쿨다운 단축입니다.
       */
      if (Player.counterRefunded[p] === 0) {
        Player.counterRefunded[p] = 1
        const slot = Actor.skillSlot[p]
        setCooldown(p, slot, cooldownOf(p, slot) * (1 - COUNTER.cooldownRefund))
      }
      this.hud.showBanner('반격!', '2.4초 무방비 · 쿨다운 환급', 1.4)
      // 무너짐(6방향)보다 촘촘한 12방향 — 같은 불꽃이라도 밀도가 다르면
      // "더 큰 일이 일어났다"가 읽힙니다.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        this.vfx.spawnHitSpark(c.x + Math.cos(a) * 1.2, c.y + 1.1, c.z + Math.sin(a) * 1.2, 1.7)
      }
    }
    counterEvents.length = 0

    /**
     * ---- 💥 오사 연출 — **작게, 그러나 확실히** ----
     *
     * 화면을 멈추거나 흔들지 **않습니다.** 오사는 플레이어가 낸 타격이
     * 아니라 **판이 만든 사건**입니다. 여기에 히트스톱을 얹으면, 잡몹이
     * 많을수록 화면이 제멋대로 끊깁니다 — 내 손과 무관하게 멎는 화면은
     * 손맛이 아니라 렉으로 읽힙니다.
     *
     * 대신 불꽃 몇 개와 짧은 소리로 *"저기서 뭔가 들어갔다"* 만 말합니다.
     * 무너지면 그때는 기존 무너짐 연출이 크게 알려 줍니다 — 알림의 크기가
     * **사건의 크기**를 따라가야 합니다.
     */
    for (const c of crossfireEvents) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        this.vfx.spawnHitSpark(c.x + Math.cos(a) * 0.5, c.y, c.z + Math.sin(a) * 0.5, 0.7)
      }
      sfx.impact(false, false, c.x, c.z)
    }
    crossfireEvents.length = 0

    /**
     * ── 💥 **폭발통** — 예고는 4색과 **같은 장치**로 그립니다 ────────────
     *
     * 여기서 통 전용 그림을 새로 만들지 않는 것이 요점입니다. 적의 🟡 광역이
     * 쓰는 바로 그 `spawnGroundShape` 를, 같은 색(`INTENT_COLOR[Sweep]`)으로,
     * 같은 두 겹(테두리 = 범위 · 차오름 = 남은 시간)으로 씁니다.
     *
     * 그래야 플레이어가 배운 것이 그대로 통합니다 — *"노란 원이 차오르면
     * 걸어서 나간다."* 통이라고 다른 그림을 쓰면, 이미 가르친 문장을 두고
     * **새 문장을 하나 더** 외우게 하는 셈입니다.
     *
     * 길이는 게임에게 묻지 않고 **사건이 실어 옵니다**(`fuseTotal`). 여기서
     * `barrelFuse()` 를 다시 부르면 규칙의 두 번째 사본이 생깁니다.
     */
    for (const lit of barrelLitEvents) {
      const life = Barrel.fuseTotal[lit.entity] || barrelFuse()
      const gy = Transform.y[lit.entity]
      const color = INTENT_COLOR[AttackIntent.Sweep]
      this.vfx.spawnGroundShape(lit.x, gy, lit.z, 0, BARREL.blast, 360, color, life, 'outline')
      this.vfx.spawnGroundShape(lit.x, gy, lit.z, 0, BARREL.blast, 360, color, life, 'fill')
      sfx.impact(true, false, lit.x, lit.z)
    }
    barrelLitEvents.length = 0

    /**
     * 터진 뒤: 번쩍임 + 화면 흔들림 + 통 치우기.
     *
     * ⚠️ 흔들림은 **방향 없이** 겁니다. 방향을 주면 "누가 나를 때렸다"로
     *    읽히는데, 이건 내가 만든 사건입니다.
     */
    for (const blast of barrelBlastEvents) {
      this.vfx.spawnGroundShape(
        blast.x,
        Transform.y[blast.entity],
        blast.z,
        0,
        blast.radius,
        360,
        INTENT_COLOR[AttackIntent.Sweep],
        0.4,
        'fade',
      )
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        this.vfx.spawnHitSpark(blast.x + Math.cos(a) * 1.1, blast.y, blast.z + Math.sin(a) * 1.1, 1.4)
      }
      this.cam.addTrauma(BARREL.trauma)
      sfx.impact(true, true, blast.x, blast.z)
      this.barrelsBlown++
      this.barrelsCaught += blast.caught
      this.barrelsLitCaught += blast.litCaught
      this.visuals.detach(blast.entity)
      destroyEntity(blast.entity)
    }
    barrelBlastEvents.length = 0

    /**
     * ── 🎁💥 **밀려난 보물이 어디에 떨어지는가** ────────────────────────
     *
     * 무엇을 노리는지는 combat.ts `explodeBarrel` 의 설계 노트에 있습니다
     * (요약: *"보이는데 못 간다"* 에 답을 만드는 것 — 젤다가 손 안 닿는
     * 단 위의 것을 떨어뜨려 줍게 하는 그것).
     *
     * ── 규칙은 한 문장입니다 ─────────────────────────────────────────
     * **폭발은 보물을 「주울 수 있는 가장 가까운 자리」로 보냅니다.**
     *
     * 튀어나가는 물리를 흉내 내지 않습니다. 항아리가 깨질 때 내용물을
     * *"그 자리에 그대로 세우는"* 이유와 정확히 같습니다 — 지형에 따라
     * 못 줍는 자리에 떨어지면 *"분명 나왔는데 없어졌다"* 가 되니까요.
     * 여기서는 그 규칙을 **반대 방향으로** 씁니다: 못 줍는 자리에 있던
     * 것을 주울 수 있는 자리로 옮깁니다. 산나비의 원칙 그대로 —
     * **어려운 부분(어디로 튈까)은 기계가 가져가고**, 플레이어 몫으로
     * 남는 것은 *"저걸 떨어뜨릴 수 있겠다"* 를 알아보는 것 하나입니다.
     *
     * ── 「주울 수 있는가」는 **걸어갈 수 있는가**입니다 ─────────────────
     * `canWalk` 만으로는 부족합니다 — 단상 위 칸도 땅은 있으니까요.
     * 플레이어 흐름장(`distanceToPlayer`)이 **닿을 수 없는 칸에 null** 을
     * 내므로 그걸 씁니다. 즉 판단을 여기서 새로 만들지 않고 **길찾기에게
     * 물어봅니다.** 이 저장소가 `?? 0` 으로 「못 간다」를 「다 왔다」로
     * 바꿔 놓고 한참 헤맨 자리라(`debugPathStep` 주석), null 을 그대로
     * null 로 다룹니다.
     *
     * ⚠️ 못 찾으면 **안 옮깁니다.** 억지로 옮기면 벽 속에 박힙니다.
     */
    if (pickupBlownEvents.length > 0 && this.terrain) {
      const p = this.playerEntity
      /**
       * ⚠️ **거리장이 아니라 `reachableFrom` 입니다.** 거리장은 *"거기서
       *    플레이어까지"* 를 답하고, 내려가는 것은 공짜라 **성벽 위도
       *    「닿는다」** 고 말합니다. 실제로 그렇게 물었다가 보물이 성벽
       *    위에 그대로 놓였습니다(`terrain.reachableFrom` 주석의 기록).
       *    여기서 필요한 것은 **플레이어가 거기로 갈 수 있는가**입니다.
       */
      const cell = this.terrain.cellOf(Transform.x[p], Transform.z[p])
      const canGo = this.terrain.reachableFrom(cell.cx, cell.cz)
      for (const ev of pickupBlownEvents) {
        if (!isAlive(ev.entity) || Pickup.taken[ev.entity] === 1) continue
        const spot = this.landingSpotFor(canGo, ev.x, ev.z, ev.dirX, ev.dirZ)
        if (!spot) continue
        Transform.x[ev.entity] = spot.x
        Transform.z[ev.entity] = spot.z
        Transform.y[ev.entity] = this.terrain.groundYAt(spot.x, spot.z)
        // 떨어진 자리에서 한 번 튀깁니다 — 눈이 **어디로 갔는지**를 따라가야
        // 합니다. 소리도 같이 냅니다(화면 밖으로 떨어질 수 있으므로).
        this.vfx.spawnHitSpark(spot.x, Transform.y[ev.entity] + 0.4, spot.z, 1.6)
        sfx.pickup()
        this.treasuresBlown++
        // 빛기둥이 **새 자리**에서 서게 다시 셈합니다(숨은 보물 목록도 좌표를 씁니다).
        this.syncHiddenTreasures(true)
      }
    }
    pickupBlownEvents.length = 0

    /**
     * ── 🏺 **항아리가 깨졌습니다** ────────────────────────────────
     *
     * 통과 **다른 그림**을 씁니다. 통은 🟡 장판을 깔아 *"여기서 나가라"*
     * 를 말하지만, 항아리는 아무것도 깔지 않습니다 — 깔면 플레이어는
     * 항아리도 위험한 물건으로 배웁니다.
     *
     * 그리고 **파문도 안 그립니다.** 한때 소리 파문을 그렸는데, 그건
     * *"이만큼 들렸다"* 는 규칙이 있을 때만 참말입니다. 규칙을 뺐으니
     * 그림도 같이 빼야 합니다 — 안 그러면 화면이 **없는 규칙을
     * 가르칩니다**(번복 기록은 balance.ts `URN`).
     *
     * 남는 것은 **부서지는 느낌**뿐입니다. 그거면 됩니다.
     */
    for (const ev of urnBreakEvents) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        this.vfx.spawnHitSpark(ev.x + Math.cos(a) * 0.35, ev.y, ev.z + Math.sin(a) * 0.35, 0.6)
      }
      this.cam.addTrauma(URN.trauma)
      sfx.impact(false, false, ev.x, ev.z)
      /**
       * 🎁 **안에 든 것이 나옵니다.** 항아리가 있던 자리에 그대로 세웁니다 —
       * 튀어나가게 하면 지형(계단·구덩이)에 따라 못 줍는 자리에 떨어질 수
       * 있고, 그러면 *"분명 나왔는데 없어졌다"* 가 됩니다.
       */
      if (ev.holds) {
        const t = spawnTreasure(ev.x, ev.z)
        Transform.y[t] = this.terrain ? this.terrain.groundYAt(ev.x, ev.z) : 0
        this.visuals.attach(t, Renderable.kind[t])
      }
      this.visuals.detach(ev.entity)
      destroyEntity(ev.entity)
    }
    urnBreakEvents.length = 0

    /**
     * ── 🧱 **금 간 벽이 무너집니다** ────────────────────────────────
     *
     * 항아리와 나란히 두되 **내놓는 것이 다릅니다**: 항아리는 물건을,
     * 벽은 **길**을 내놓습니다. 그래서 여기서 하는 일의 핵심은
     * `terrain.breakWall()` 한 줄이고, 나머지는 전부 *"방금 큰 일이
     * 일어났다"* 를 몸에 전하는 연출입니다.
     *
     * ⚠️ **열렸을 때만** 연출합니다. `breakWall` 이 false 를 돌려주는
     *    경우(이미 열린 벽·짝이 없는 벽)에 소리와 흔들림만 나면,
     *    플레이어는 *"열린 줄 알았는데 안 열렸다"* 를 겪습니다.
     *    이 저장소의 「못 잰 것은 통과가 아니다」와 같은 자리입니다.
     */
    for (const ev of wallBreakEvents) {
      const opened = this.terrain ? this.terrain.breakWall(`${ev.cx},${ev.cz}`) : false
      if (opened) {
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2
          this.vfx.spawnHitSpark(ev.x + Math.cos(a) * 0.7, ev.y, ev.z + Math.sin(a) * 0.7, 0.9)
        }
        this.cam.addTrauma(CRACKED_WALL.trauma)
        sfx.impact(true, false, ev.x, ev.z)
        /**
         * 🧭 **길이 바뀌었으니 안내도 다시 그립니다.** 거리장은 열림
         *    상태가 캐시 키에 들어 있어 저절로 다시 만들어지지만,
         *    그건 *"다음에 물을 때"* 입니다. 여기서 지워 두지 않으면
         *    부순 그 프레임의 화살표가 **아직 벽이 있는 지도**를
         *    가리킵니다.
         */
        this.terrain?.buildPlayerField(Transform.x[this.playerEntity], Transform.z[this.playerEntity])
        // 🎁 방금 열린 방의 보물은 이제 **숨은 것이 아닙니다** — 빛기둥을 켭니다.
        //    숨어 있던 것만 다시 봅니다(위 `onlyHidden` 문단 — 긴 프레임이 판정을 삼킵니다).
        this.syncHiddenTreasures(true)
      }
      this.visuals.detach(ev.entity)
      destroyEntity(ev.entity)
    }
    wallBreakEvents.length = 0

    // ---- 3.8 무너짐 연출 ----
    //
    // 무너짐은 **긴 무방비**라는 큰 보상이라, 눈·귀·손 셋 다 써서 확실히 알립니다.
    // 못 알아채면 공짜 딜 창을 그냥 흘려보내게 됩니다.
    /**
     * ---- 처형 연출 ----
     *
     * 세키로의 인살, 오공의 처형이 공통으로 하는 일: **화면이 한 박자 멈춥니다.**
     * 같은 피해라도 멈춤과 소리가 붙으면 "끝냈다"가 되고, 없으면 그냥 큰 숫자가
     * 하나 뜬 것이 됩니다. 무방비를 소모하는 거래이므로 그만한 마침표가 필요합니다.
     */
    for (const f of finisherEvents) {
      this.finishers++
      /**
       * **보스에게 들어간 처형**을 따로 셉니다.
       *
       * 보스 페이즈 경계를 옮겼는데도 3단계가 3.5초뿐이었습니다.
       * 남은 용의자는 처형입니다 — 한 방이 마무리 타의 2.6배라, 두 번이면
       * 마지막 페이즈가 통째로 지워집니다. 세키로의 인살은 그게 곧 끝이라
       * 자연스럽지만, 우리는 그 뒤에 **아직 보여주지 못한 연계**가 남아
       * 있습니다. 얼마나 지우고 있는지부터 알아야 합니다.
       */
      if (hasComponent(Enemy, f.entity) && Enemy.kind[f.entity] === EnemyKind.Boss) {
        this.bossFinishers++
      }
      this.cam.addTrauma(0.7)
      requestHitstop(0.2)
      sfx.impact(true, true, f.x, f.z)
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        this.vfx.spawnHitSpark(f.x + Math.cos(a) * 0.75, f.y + 1.05, f.z + Math.sin(a) * 0.75, 1.6)
      }
    }
    finisherEvents.length = 0

    for (const b of breakEvents) {
      this.poiseBreaks++
      if (b.duringWindup) this.windupBreaks++
      /**
       * **무너진 순간의 체력**을 기록합니다.
       *
       * 처형이 판당 1회에서 안 올라갑니다. 무방비 창은 87% 쓰고 있는데도요.
       * 남은 가설은 하나입니다 — **무너진 적이 곧바로 평타에 죽어서** 처형까지
       * 갈 일이 없다는 것. 그렇다면 처형이 아니라 **강인도가 언제 터지는가**가
       * 문제입니다. 빈사에서만 터지는 붕괴는 보상이 아니라 사망 연출입니다.
       *
       * 세키로가 체간을 체력과 **따로** 둔 이유가 이것입니다: 체간은 체력이
       * 많이 남았을 때도 터져야 "무너뜨리고 마무리한다"가 하나의 전술이 됩니다.
       */
      if (hasComponent(Health, b.entity) && Health.max[b.entity] > 0) {
        this.breakHpSum += Math.max(0, Health.hp[b.entity]) / Health.max[b.entity]
      }
      this.cam.addTrauma(0.5)
      requestHitstop(0.12)
      sfx.impact(true, true, b.x, b.z)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        this.vfx.spawnHitSpark(b.x + Math.cos(a) * 0.9, b.y + 1.0, b.z + Math.sin(a) * 0.9, 1.3)
      }
    }
    breakEvents.length = 0

    /**
     * 🩸 **출혈이 터진 순간** — 화면과 귀에 한 번씩.
     *
     * 무너짐(붕괴)보다 **작게** 냅니다. 둘이 같은 크기로 터지면 플레이어는
     * 두 축을 구분하지 못하고, 그러면 축이 둘인 뜻이 없어집니다:
     *   · 붕괴  — 큰 흔들림 + 긴 히트스톱 + 사방 스파크 (무방비가 열립니다)
     *   · 출혈  — 작은 흔들림 + 짧은 멎음 + **한 점**에서 터지는 스파크
     */
    for (const b of bleedEvents) {
      this.bleedPops++
      this.cam.addTrauma(0.22)
      requestHitstop(0.06)
      sfx.impact(true, false, b.x, b.z)
      for (let i = 0; i < 4; i++) {
        this.vfx.spawnHitSpark(b.x, b.y + 1.1 + i * 0.12, b.z, 0.9)
      }
    }
    bleedEvents.length = 0

    /**
     * 👀 **들킨 순간** — 화면과 귀에 한 번씩.
     *
     * ── 왜 필요한가 ────────────────────────────────────────────────
     * 인지 규칙(시야·청각·고함)을 다 만들어 놓고 **화면에는 아무것도
     * 올리지 않았습니다.** 그러면 플레이어가 겪는 것은 규칙이 아니라
     * *"가끔 갑자기 다 달려든다"* 입니다. 원인이 안 보이면 배울 것이 없고,
     * 배울 것이 없으면 그건 난이도가 아니라 운입니다.
     *
     * 파문은 **고함 거리(`AWARE.alertRadius`)와 같은 크기**로 그립니다.
     * 눈에 보이는 크기가 곧 규칙의 크기여야, 보고 배운 것이 맞는 것이
     * 됩니다 — 이 저장소가 예고 부채꼴에서 이미 지키고 있는 원칙입니다
     * (*"모양과 색이 같은 데이터에서 나온다"*).
     *
     * ⚠️ 소리는 `sfx.spotted` 안에서 한 번으로 묶입니다(gate). 무리가
     *    통째로 깨어나면 사건이 6개 들어오는데, 6번 울리면 경보가 아니라
     *    소음입니다. **"들켰다"는 마릿수가 아니라 사건입니다.**
     */
    const pv = this.debugPlayerEntity()
    for (const sp of spotEvents) {
      /**
       * ⚠️ **가까운 것만 그립니다.** 소리는 `gate` 로 한 번에 묶었는데
       *    그림은 안 묶어 뒀다가 뒤늦게 알아챘습니다: 존을 달려 지나가면
       *    19마리가 깨어나고, 무리로 깨면 7m 짜리 흰 원이 **한 프레임에
       *    대여섯 장** 겹칩니다. 가산 혼합이라 그대로 더해져서 화면이
       *    하얗게 뜹니다 — 소리에서 막은 것과 **똑같은 실패**입니다.
       *
       * 거리 기준은 못 본 적 표시와 **같은 값**을 씁니다(`markRange`).
       * 그래야 화면이 한 문장을 말합니다 — *표시가 꺼진 그 자리에서
       * 파문이 터진다.* 화면 밖에서 깨어난 적은 그릴 이유가 없습니다.
       */
      const d = Math.hypot(sp.x - Transform.x[pv], sp.z - Transform.z[pv])
      if (d > AWARE.markRange) continue
      this.vfx.spawnGroundShape(
        sp.x,
        0,
        sp.z,
        0,
        AWARE.alertRadius,
        360,
        // 무채색 — 4색 표(어떻게 답하라)를 침범하지 않습니다.
        0xe8eef8,
        AWARE.spotFlash,
        'fade',
      )
      sfx.spotted(sp.x, sp.z)
    }
    spotEvents.length = 0
    /**
     * 🚪 **놓친 순간** — 걸어서 닿을 수 없게 되어 어그로가 풀린 적.
     *
     * 화면 연출은 **일부러 안 붙입니다.** 들킨 순간(`!`)은 플레이어가
     * 반응해야 하는 사건이지만, 이건 *"저 적은 이제 나에게 못 온다"* 는
     * 사실이고 화면에는 **예고가 사라지는 것**으로 이미 나타납니다.
     * 표시를 하나 더 띄우면 조용해진 것을 시끄럽게 알리는 꼴입니다.
     * 대신 장부에는 남깁니다 — 안 하는 일은 세지 않으면 없는 일이 됩니다.
     */
    for (const d of deaggroEvents) {
      this.deaggroCount++
      if (d.walk > this.deaggroWorstWalk) {
        this.deaggroWorstWalk = d.walk
        this.deaggroWorstStraight = d.straight
      }
    }
    deaggroEvents.length = 0

    // ---- 4. 사망 처리 ----
    healthSystem()
    for (const death of deathEvents) {
      // **무너진 채로 죽었는가** — 처형까지 못 가고 평타에 정리된 횟수입니다.
      if (!death.isPlayer && hasComponent(Enemy, death.entity) && Enemy.brokenT[death.entity] > 0) {
        this.brokenDeaths++
      }
      /**
       * ── **종류별 처치 수** ────────────────────────────────────────
       *
       * 여기에 `예고 중 사망`(예고를 띄운 채로 죽었는가) 도 같이 셌었는데,
       * **재던 방법이 틀려서 걷어냈습니다.** 열다섯 번째 계기 버그입니다.
       *
       * 죽는 순간의 `Actor.state` 를 봤습니다. 그런데 강인도가 무너지면
       * combat.ts 가 상태를 **`Stagger` 로 덮어씁니다.** 예고 중에 무너뜨린
       * 뒤 죽이는 것 — 즉 **반격이 성공한 바로 그 경로** — 는 죽을 때
       * 이미 `Attack/Windup` 이 아닙니다. 그래서 모든 종류가 한결같이
       * **0%** 로 나왔고, 저는 그걸 *"먼저 죽는 건 아니다"* 라는 근거로
       * 썼습니다. 실제로는 **셀 수 없는 것을 세고 0을 얻은 것**입니다.
       *
       * 이 프로젝트에서 몇 번이나 나온 모양 그대로입니다:
       * **"0"은 가장 의심스러운 관측입니다** — *안 일어났다* 와
       * *안 세어지고 있다* 가 똑같이 생겼습니다.
       *
       * 대신 `예고 → 판정` 을 따로 세고 그 차이를 `끊김` 으로 봅니다.
       * 사건이 일어난 자리(상태가 덮이기 전)에서 세므로 덮어쓰기에
       * 영향받지 않고, *"공격을 걸었는데 판정까지 못 갔다"* 를 이유와
       * 무관하게 전부 잡습니다.
       */
      if (!death.isPlayer && hasComponent(Enemy, death.entity)) {
        const id = enemyDef(Enemy.kind[death.entity]).id
        const rec = (this.foeSwingLog[id] ??= { swings: 0, hits: 0, deaths: 0 })
        rec.deaths = (rec.deaths ?? 0) + 1
      }
      if (death.isPlayer) {
        this.deathCount++
        this.cam.addTrauma(0.8)
        requestHitstop(0.22)
        sfx.death(true)
        sfx.stopMusic()
        /**
         * **불을 붙인 화톳불이 있으면 게임 오버가 아니라 부활입니다.**
         *
         * 레벨 전체를 처음부터 다시 걷게 만드는 것은 벌이 아니라 **지루함**입니다.
         * 소울라이크가 죽음을 견딜 만하게 만드는 방법이 정확히 이것입니다 —
         * 잃는 것은 진도가 아니라 **그 구간의 시도**뿐입니다.
         * (아직 화톳불을 못 만났으면 예전대로 게임 오버입니다.)
         */
        if (Player.hasRespawn[p] === 1) {
          this.respawnAtBonfire(p)
          continue
        }
        this.dropEmbers(p)
        this.gameOver = true
        this.hud.showGameOver(this.kills, this.wave, this.deathLesson())
      } else {
        this.kills++
        if (Enemy.kind[death.entity] === EnemyKind.Boss) {
          sfx.stopMusic()
          /**
           * 보스는 부활하지 않습니다 — 앞으로 나아갔다는 유일한 표지입니다.
           *
           * **죽은 자리가 아니라 원래 자리(home)로 기록합니다.**
           * 예전에는 `death.x/z` 를 썼는데, 보스는 플레이어를 쫓아 움직이므로
           * 자기 자리에서 죽는 일이 거의 없습니다. 그러면 키가 레벨 데이터의
           * 배치 좌표와 안 맞아서 **화톳불에서 쉴 때마다 되살아났습니다.**
           *
           * 조용한 버그였습니다. 화면상으로는 "적이 부활했다"로만 보이고,
           * 규칙이 깨진 줄은 알 수가 없습니다. 정련석 누적량을 세기 시작하고서야
           * 드러났습니다 — 존 상한이 7개인데 **9개**가 나왔습니다.
           */
          this.defeatedBosses.add(bossKey(Enemy.homeX[death.entity], Enemy.homeZ[death.entity]))
          // 즉시 저장합니다. 여기서 안 하면 게임을 끄고 켤 때 보스가 되살아나
          // "진행의 표지"라는 이 규칙 자체가 무너집니다.
          this.persistProgress()
        }
        // 처치 보상. 이게 없으면 전투를 전부 지나쳐 달리는 게 최적이 됩니다.
        if (Enemy.kind[death.entity] === EnemyKind.Boss) {
          Player.stones[p] += WEAPON_UPGRADE.stonePerBoss
          this.stonesEarned += WEAPON_UPGRADE.stonePerBoss
          this.bossDefeated = true
        }
        /**
         * 되살아난 적일수록 덜 줍니다. 보스는 예외 — 부활하지 않으므로
         * 체감시킬 이유가 없고, 존의 마지막 보상이 쉰 횟수에 따라
         * 달라지면 "언제 쉬었나"가 보스 보상을 좌우하게 됩니다.
         */
        const decay =
          Enemy.kind[death.entity] === EnemyKind.Boss
            ? 1
            : Math.max(EMBER.respawnFloor, EMBER.respawnDecay ** this.restGeneration)
        const gain = Math.max(1, Math.round(enemyDef(Enemy.kind[death.entity]).ember * decay))
        Player.embers[p] += gain
        this.vfx.spawnDamage(death.x, Transform.y[death.entity] + 1.3, death.z, gain, { heal: true })
        requestHitstop(KILL_FEEDBACK.hitstop)
        this.cam.addTrauma(KILL_FEEDBACK.trauma)
        // 보스는 더 낮고 길게 꺼집니다 — 처치의 무게가 소리 길이로 구분됩니다.
        sfx.death(Enemy.kind[death.entity] === EnemyKind.Boss, death.x, death.z)
        // 처치 순간 파편을 여러 개 흩뿌립니다 — 한 개보다 훨씬 시원합니다.
        for (let i = 0; i < 4; i++) {
          this.vfx.spawnHitSpark(
            death.x + (vfxRng.next() - 0.5) * 0.9,
            Transform.y[death.entity] + 0.5 + vfxRng.next() * 1.1,
            death.z + (vfxRng.next() - 0.5) * 0.9,
            0.8 + vfxRng.next() * 0.7,
          )
        }
        // ⚠️ 지우기 **전에** 예약을 셉니다 — 이 자리를 빠뜨려서 잔액이 남았습니다.
        noteChainDeath(death.entity)
        this.visuals.detach(death.entity)
        destroyEntity(death.entity)
      }
    }
    deathEvents.length = 0

    // ---- 5. 보물 획득 ----
    if (playerAlive) this.collectTreasures(p)

    // ---- 6. 진행 ----
    const enemiesLeft = countLivingEnemies()
    if (this.levelMode) {
      /**
       * ── 존의 끝은 **보스**입니다 ────────────────────────────────
       *
       * 예전 조건은 *"모든 적 처치 + 모든 보물 획득"* 이었습니다.
       * 자동 플레이가 그 대가를 그대로 찍어 줬습니다:
       *
       *     376초 클리어 중 보스 처치는 140초 — **236초(63%)가 그 뒤의 청소**
       *     가장 긴 빈 구간 넷 중 셋이 "북쪽 단상 → 무너진 성문",
       *     즉 지도를 **거꾸로 가로질러 되돌아가는** 길이었습니다.
       *
       * 목표 화살표가 보스를 잡은 뒤 남은 보물을 가리키면서, 존의 마지막
       * 3분의 2가 **수집 심부름**이 되어 있었습니다. 절정 뒤에 잡일이 붙으면
       * 절정이 절정이 아니게 됩니다.
       *
       * 소울류는 이렇게 하지 않습니다. 보스를 잡으면 그 구역은 끝이고,
       * 못 주운 아이템은 **아쉬움으로 남습니다.** 그래서 안개문 앞에서
       * *"더 둘러볼까, 지금 들어갈까"* 가 진짜 결정이 됩니다.
       *
       * 그 결정을 만들려면 클리어 조건이 보스여야 합니다. 보물 수는 **가두는
       * 조건이 아니라 기록**으로 남깁니다 — 배너에 3/5 라고 적히는 것이
       * "두 개는 두고 왔구나"를 말해 줍니다.
       */
      const hasBoss = (this.levelData?.entities ?? []).some((e) => e.kind === 'boss')
      const done = hasBoss
        ? this.bossDefeated
        : enemiesLeft === 0 && this.treasuresFound >= this.treasureTotal
      if (!this.gameOver && done) {
        this.gameOver = true
        this.hud.showBanner(
          '클리어!',
          `${this.levelName} · 보물 ${this.treasuresFound}/${this.treasureTotal}` +
            (this.treasuresFound < this.treasureTotal ? ' — 두고 온 것이 있다' : ''),
          6,
        )
      }
    } else if (!this.gameOver && enemiesLeft === 0) {
      this.waveTimer -= time.realDt
      if (this.waveTimer <= 0) {
        this.wave++
        this.startWave()
        this.waveTimer = WORLD.waveDelay
      }
    } else {
      this.waveTimer = WORLD.waveDelay
    }

    // ---- 6.5 길안내 (목표 · 구역 · 방향 화살표) ----
    if (this.levelMode && playerAlive) this.updateNavigation(p)

    // ---- 7. 카메라 & 렌더 ----
    const px = Transform.x[p]
    const pz = Transform.z[p]
    /**
     * 달리는 만큼 시야를 넓힙니다 — 연출이 아니라 **반응 시간** 때문입니다
     * (render/camera.ts setSprint 주석). 게임이 이미 센 값을 그대로 넘깁니다.
     */
    this.cam.setSprint(
      PLAYER_CFG.sprint.rampUp > 0 ? Player.sprintT[p] / PLAYER_CFG.sprint.rampUp : 0,
    )
    this.cam.update(px, playerY, pz, this.aim.x, this.aim.z)
    this.sunTarget.position.set(px, playerY, pz)

    // 커서 링을 지면 높이에 붙입니다.
    const ringY = this.terrain ? this.terrain.groundYAt(this.aim.x, this.aim.z) : 0
    this.cursorRing.position.set(this.aim.x, ringY + 0.03, this.aim.z)
    this.cursorRing.visible = playerAlive

    // 플레이어보다 훨씬 높은 지형을 반투명하게 — 쿼터뷰의 가림 문제 해소.
    if (this.terrain) {
      const lvl = this.terrain.levelAtWorld(px, pz)
      const safeLvl = lvl < 0 ? 0 : lvl
      // 플레이어 -> 카메라 방향(XZ). 이 방향에 있는 덩어리만 시야를 가릴 수 있습니다.
      this.terrain.applyOcclusionFade(safeLvl, px, pz, -this.cam.forward.x, -this.cam.forward.z)
    }

    this.visuals.sync(px, pz, p)
    this.vfx.update(this.cam.camera)
    this.renderer.render(this.scene, this.cam.camera)
    if (this.sampleRequested) {
      this.sampleRequested = false
      this.lastSample = this.readFramebuffer()
    }

    // ---- 8. HUD ----
    this.hud.setVitals(Health.hp[p], Health.max[p], Stamina.value[p], Stamina.max[p])
    this.hud.setVials(Player.vials[p], Player.vialsMax[p])
    this.hud.setFocus(Player.focus[p], FOCUS.max)
    this.hud.setStones(Player.stones[p])
    // 해낸 조작은 화면에서 내립니다(hud.ts markLearned 설계 노트).
    this.hud.applyLearned(readLearnedActions())
    this.hud.setEmbers(Player.embers[p])
    if (this.bossEntity >= 0 && isAlive(this.bossEntity) && Health.hp[this.bossEntity] > 0) {
      const b = this.bossEntity
      /**
       * ⚔️ **내 시간의 분해** — 적 쪽(`foeSwingLog`)과 같은 모양입니다.
       * 설계 근거는 `bossTime` 선언부에 적어 뒀습니다. 한 줄로: 보스에게
       * 못 붙는 이유의 후보가 넷인데 처방이 전부 달라서, 코드의 분기
       * 그대로 갈라 놔야 숫자가 처방이 됩니다.
       */
      if (playerAlive) {
        const bt = this.bossTime
        bt.total += time.dt
        const st = Actor.state[p] as ActorState
        if (st === ActorState.Attack || st === ActorState.Skill) bt.attack += time.dt
        else if (st === ActorState.Dodge) bt.dodge += time.dt
        else if (st === ActorState.Stagger) bt.stagger += time.dt
        else if (st === ActorState.Drink) bt.drink += time.dt
        else if (Player.guardT[p] > 0) bt.guard += time.dt
        else {
          // 남은 시간을 **거리로 한 번 더 가릅니다** — 적 쪽과 같은 이유로.
          // 뭉쳐 놓으면 "멀어서 못 때림"과 "닿는데 안 때림"이 섞이는데,
          // 처방이 정반대입니다(배치·이동 vs 창·기력).
          const d = Math.hypot(Transform.x[b] - Transform.x[p], Transform.z[b] - Transform.z[p])
          if (d > longestPlayerReach() + Body.radius[b]) bt.chase += time.dt
          else {
            bt.ready += time.dt
            // 닿는데 안 때린 그 시간 중 **기력이 없던 몫**. 이게 크면
            // 창 설계가 아니라 경제 이야기입니다.
            if (!canAffordAttack(p, WEAPONS[Loadout.weapon[p]].combo[0].staminaCost))
              bt.readyNoStamina += time.dt
          }
        }
      }
      this.hud.setBoss(
        enemyDef(Enemy.kind[b]).name,
        Health.hp[b] / Math.max(1, Health.max[b]),
        // 눈금은 페이즈 표에서 그대로 가져옵니다 — 숫자를 베끼면 밸런스를
        // 바꿨을 때 화면과 실제가 어긋납니다(머리 위 바와 같은 규칙).
        BOSS_PHASES.slice(1).map((ph) => ph.enterBelow),
      )
    } else {
      if (this.bossEntity >= 0) this.bossEntity = -1
      this.hud.setBoss(null, 0, [])
    }
    // 맥동은 **실시간**(realDt) 축으로 돕니다 — 히트스톱 중에도 경고는 살아 있어야
    // 합니다. 화면이 멈춘 그 순간이 정확히 "위험하다"를 알려야 할 때입니다.
    const hpRatio = Health.hp[p] / Math.max(1, Health.max[p])
    this.hud.setLowHp(hpRatio, 0.5 + 0.5 * Math.sin(time.elapsed * 6.5))
    /**
     * ❤️ **같은 경고를 귀에도 냅니다** (audio `heartbeat` 설계 노트).
     *
     * 죽음 장부가 세 번 다 *"예고를 다 봤는데 답을 내지 않았다"* 라고
     * 적었습니다. 예고는 보였는데 죽습니다. 저체력 경고가 **눈 하나**
     * 뿐이었고, 그 순간 눈은 화면 가장자리가 아니라 적에게 있습니다.
     *
     * 문턱은 위 `setLowHp` 와 **같은 값**을 넘깁니다 — 두 채널이 다른
     * 순간에 말하기 시작하면 플레이어는 둘 중 하나를 못 믿게 됩니다.
     */
    sfx.heartbeat(time.realDt, hpRatio, PLAYER_CFG.lowHpWarn)
    if (this.levelMode) {
      this.hud.setLevelProgress(this.levelName, enemiesLeft, this.treasuresFound, this.treasureTotal)
    } else {
      this.hud.setProgress(this.wave, enemiesLeft, this.kills)
    }
    /**
     * ⚠️ 예전에는 `cd0..cd4` 를 손으로 늘어놓았습니다. 슬롯이 하나 늘자
     *    이 줄만 옛 개수를 그리고 있었을 자리입니다 — 화면에 안 보이는
     *    슬롯이 생기는, 조용한 종류의 고장입니다. `cooldownOf` 하나만 봅니다.
     */
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.cdBuf[i] = cooldownOf(p, i)
      this.cdMaxBuf[i] = skillForSlot(p, i)?.cooldown ?? 1
    }
    this.skillBar.update(this.cdBuf, this.cdMaxBuf)
    /**
     * 🟢 **지금 반격할 수 있는가** — 규칙은 여기가 정하고 화면은 그리기만.
     *
     * 조건을 combat.ts 의 판정과 **같은 모양**으로 둡니다: 🟢 예고 중이고,
     * 내가 그 적의 **정면**에 있고, 스킬이 닿을 만한 거리. 화면이 자기
     * 판단을 갖는 순간 "보이는 것과 실제가 다른" 버그가 시작됩니다.
     *
     * ⚠️ 거리는 **넉넉하게** 봅니다(예고 반경 + 여유). 반격은 *"달려가서
     *    꽂는"* 답이라, 지금 사거리 안이어야 알려 준다면 이미 늦습니다 —
     *    🟢 의 예고가 1.25초 이상으로 길게 잡혀 있는 이유가 그것입니다
     *    (enemyAttacks.ts: 반격은 반사신경이 아니라 **결단**이어야 한다).
     */
    {
      let canCounter = false
      const eids = enemyQuery.run()
      for (let i = 0; i < enemyQuery.count; i++) {
        const e = eids[i]
        if (!isAlive(e) || Actor.state[e] !== ActorState.Attack) continue
        if (Actor.phase[e] !== AttackPhase.Windup) continue
        const def = attackAt(Enemy.kind[e], Enemy.attackIndex[e])
        if (def.intent !== AttackIntent.Counter) continue
        // 판정과 같은 함수입니다 — 뜻이 두 개가 되지 않게(combat.ts `countered`).
        if (isBehindPoint(Transform.x[p], Transform.z[p], Transform.x[e], Transform.z[e], Transform.rotY[e]))
          continue
        const d = Math.hypot(Transform.x[e] - Transform.x[p], Transform.z[e] - Transform.z[p])
        /**
         * ⚠️ `+3` 같은 리터럴을 쓰지 않습니다. *"내 무기가 닿는 가장 먼
         *    거리"* 는 게임이 이미 알고 있고(arsenal `longestPlayerReach`),
         *    무기를 손보는 날 이 줄만 옛 값을 들고 있으면 안 됩니다.
         *    문턱은 규칙이지 리터럴이 아닙니다.
         */
        if (d > def.reach + longestPlayerReach()) continue
        canCounter = true
        break
      }
      this.skillBar.setCounterCue(canCounter)
    }
    /**
     * 🗡 예약된 무기 전환을 스킬바에 비춥니다.
     *
     * 규칙은 `playerControl` 이 갖고 있고 여기서는 **읽어서 그리기만**
     * 합니다 — 지난 라운드에 발소리 링에서 정한 것과 같은 규약입니다.
     * 화면이 자기 판단을 갖는 순간 "보이는 것과 실제가 다른" 버그가 시작됩니다.
     */
    {
      const pe = this.debugPlayerEntity()
      const want = Actor.bufferedWeapon[pe] - 1
      const pending =
        want >= 0 && want < WEAPONS.length && want !== Loadout.weapon[pe] ? WEAPONS[want].name : ''
      this.skillBar.setPendingWeapon(pending)
    }
    this.hud.tickPerf(time.realDt)

    endFrame()
  }

  /**
   * 길안내 — "어디로 가야 하고 어디에 뭐가 있는가"에 답합니다.
   *
   * 플레이 테스트 피드백: "목표가 없으니 그냥 눈앞의 적만 잡고 말게 된다."
   * 미니맵은 쓰지 않기로 했으므로(DESIGN.md 기둥 4) 세 가지로 대신합니다:
   *   1) **구역 이름** — 새 장소에 들어서면 이름이 뜹니다 (진행 감각)
   *   2) **한 줄 목표** — 지금 무엇을 해야 하는지 (HUD)
   *   3) **지면 화살표** — 목표가 멀 때 발밑에서 그쪽으로 흐릅니다 (방향)
   * 보물의 위치는 visuals.ts 의 빛기둥이 멀리서도 알려줍니다.
   */
  private updateNavigation(p: number): void {
    const px = Transform.x[p]
    const pz = Transform.z[p]

    // --- 구역 판정: 가장 작은(= 가장 구체적인) 구역이 이깁니다 ---
    const { cx, cz } = worldToCell(px, pz, this.levelW, this.levelH)
    // 규칙은 `regionAtCell` 한 곳에만 — 예전엔 여기와 디버그 훅이 서로
    // 다른 규칙을 써서 겹치는 구역에서 답이 갈렸습니다(그 함수 주석).
    const found = this.regionAtCell(cx, cz)
    if (found && found.name !== this.currentRegion) {
      this.currentRegion = found.name
      this.hud.showBanner(found.name, found.hint ?? '', 2.2)
    }

    // --- 목표: 보스 → 남은 보물 → 남은 적 순 ---
    const objective = this.findObjective(px, pz)

    /**
     * **화살표는 걸어갈 수 있는 방향을 가리켜야 합니다.**
     *
     * 예전에는 목표를 직선으로 가리켰습니다. 지도가 한 줄일 때는 그게 맞았지만,
     * 성벽마루로 길을 돌아가게 만든 순간 화살표가 벽을 뚫고 가라고 가리키게
     * 되었습니다. 돌아가는 설계를 넣었으면 **안내도 같이 돌아가야** 합니다.
     * 안 그러면 플레이어에게는 설계가 아니라 버그로 보입니다.
     *
     * 거리도 직선이 아니라 **실제로 걸어야 하는 거리**로 바꿉니다. 이쪽이
     * 정직할 뿐 아니라, 사다리를 내리는 순간 숫자가 뚝 떨어지는 것이
     * 지름길의 값어치를 그 자리에서 보여줍니다.
     */
    let guideX = objective?.x ?? px
    let guideZ = objective?.z ?? pz
    let shownDist = objective?.dist ?? 0
    if (objective && this.terrain) {
      this.terrain.buildFlowField(objective.x, objective.z)
      const step = this.terrain.nextStepToward(px, pz)
      if (step) {
        guideX = step.x
        guideZ = step.z
      }
      const walk = this.terrain.pathDistance(px, pz)
      if (walk !== null) shownDist = walk
    }

    /**
     * ── 🧭 **곁길이 있다는 것을 길 위에서 알려 줍니다** ────────────────
     *
     * ── 무엇이 없었는가 (재고 나서 알았습니다) ─────────────────────
     * `npm run secret` 이 *"보물 둘이 걸어서 58m·50m 라 예산 밖"* 이라고
     * 빨갛게 떴습니다. 자리를 옮기려다 먼저 쟀더니 진단이 뒤집혔습니다:
     *
     *   · 주 동선은 z=1 보다 북쪽으로 **한 번도 안 갑니다**
     *   · 그런데 그 북쪽(「북쪽 단상」)에는 **지름길 사다리**와 적 셋과
     *     보물 둘이 있습니다 — 빈 땅이 아니라 내용이 있는 곁길입니다
     *   · 카메라는 22m 까지만 담으므로 빛기둥도 그 밖에서는 안 보입니다
     *
     * 그리고 결정적으로, **길안내는 보스가 살아 있는 한 항상 보스만
     * 가리킵니다**(`findObjective`). 보물이 목표가 되는 것은 보스를 잡은
     * 뒤인데, 보스를 잡으면 존이 끝납니다. 즉 정련석이 나오는 유일한
     * 곳을 게임이 **한 번도 가리킨 적이 없습니다.**
     *
     * ── 참고 게임 ─────────────────────────────────────────────────
     * 엘든 링은 화살표 없이 **세계가 보여 줍니다**(아이템 광채·유적
     * 실루엣). 우리 카메라 각도와 22m 시야에서는 그 방법이 안 통합니다.
     * 우리와 시점이 같은 **로스트아크·NRFTW 는 화면 표시로** 풉니다 —
     * 근처에 뭔가 있으면 알려 주고, 갈지 말지는 플레이어가 정합니다.
     *
     * ⚠️ **목표를 바꾸지 않습니다.** 화살표는 그대로 보스를 가리킵니다.
     *    여기서 더하는 것은 *"저쪽에 곁길이 있다"* 한 줄뿐이고, 데려다
     *    주지 않습니다. 곁길의 값어치는 **가기로 정하는 것**에 있습니다.
     *
     * ⚠️ 반경은 **곁길 예산과 같은 값**을 씁니다(`SPEND_BUDGET` 과 같은
     *    45m). 안 보이는 것을 알려 줘 봐야 갈 수 없으면 놀리는 것입니다.
     */
    /**
     * ⚠️ **매 프레임 다시 계산하지 않습니다 — 그리고 흐름장을 되돌립니다.**
     *
     * 처음엔 이 줄을 매 프레임 돌렸습니다. `findSideHint` 안에서
     * `buildFlowField` 를 부르는데, 그건 지도 6336칸을 훑는 BFS 이고
     * **모두가 함께 쓰는 상태**입니다. 두 가지가 한꺼번에 깨졌습니다:
     *
     *   · 프레임이 느려져 `npm run verify` 의 출혈 검사 셋이 빨개졌습니다
     *     (0 → 0 · 게이지 안 뜸 · 표본 없음). 게임의 출혈은 멀쩡했고,
     *     **시뮬레이션 1초당 봇이 덜 때린** 것입니다.
     *   · 화살표가 쓰는 흐름장을 보물 쪽으로 덮어써서, 안내가 가리키는
     *     방향이 프레임마다 흔들릴 수 있었습니다.
     *
     * 그래서 0.75초에 한 번만 재고, 잰 뒤에는 **목표 쪽 흐름장을 도로
     * 세워 둡니다.** 한 줄짜리 안내가 게임의 공용 상태를 바꿔 놓으면
     * 안 됩니다.
     */
    this.sideHintT -= time.dt
    if (this.sideHintT <= 0) {
      this.sideHintT = 0.75
      const side = this.findSideHint(px, pz, objective)
      this.sideHintText = side ? `${side.dir} ${side.dist.toFixed(0)}m — 보물` : ''
      // 어느 보물을 가리켰는지도 남깁니다 — 프로브가 "몇 개가 알려지는가"를 셀 수 있게.
      this.sideHintAt = side ? { x: side.x, z: side.z } : null
      if (objective && this.terrain) this.terrain.buildFlowField(objective.x, objective.z)
    }
    this.hud.setNavigation(
      this.currentRegion,
      objective ? `목표: ${objective.label} (${shownDist.toFixed(0)}m)` : '목표: 완료',
      this.sideHintText,
    )

    // --- 지면 화살표: 목표가 멀 때만. 가까우면 눈으로 보이므로 방해만 됩니다. ---
    const showGuide = objective !== null && objective.dist > 9
    this.guide.visible = showGuide
    if (showGuide && objective) {
      this.guide.position.set(px, Transform.y[p] + 0.06, pz)
      this.guide.rotation.y = Math.atan2(guideX - px, guideZ - pz)
      // 앞으로 흘러가는 파도. 정지한 화살표보다 방향이 훨씬 잘 읽힙니다.
      for (let i = 0; i < this.guideMaterials.length; i++) {
        const t = (time.elapsed * 1.25 - i * 0.26) % 1
        this.guideMaterials[i].opacity = 0.16 + 0.55 * Math.max(0, Math.sin(t * Math.PI))
      }
    }
  }

  /**
   * 🧭 **가까운 곁길 하나** — 지금 걸어서 갈 만한 거리에 있는 미획득 보물.
   *
   * 방향은 여덟 갈래 이름으로 줍니다. 각도를 숫자로 주면 읽는 데 시간이
   * 걸리고, 화면 가장자리 화살표를 새로 만들면 배울 것이 하나 늘어납니다 —
   * 이 게임은 이미 조작표를 줄이는 쪽으로 손봐 왔습니다(hints 프로브).
   */
  /** 지금 HUD 에 올라간 곁길 한 줄(없으면 빈 문자열). 실험대가 읽습니다. */
  private sideHintText = ''
  private sideHintAt: { x: number; z: number } | null = null
  /** 곁길 알림을 다시 재기까지 남은 시간(초) — 위 설계 노트 참고. */
  private sideHintT = 0
  debugSideHintText(): string {
    return this.sideHintText
  }

  /** 지금 알림이 가리키는 보물의 자리(없으면 null). */
  debugSideHintAt(): { x: number; z: number } | null {
    return this.sideHintAt
  }

  private findSideHint(
    px: number,
    pz: number,
    goal: { x: number; z: number } | null,
  ): { dir: string; dist: number; x: number; z: number } | null {
    const ids = pickups.run()
    /**
     * ⚠️ **규칙에 맞는 것 중 가장 가까운 것**을 고릅니다.
     *
     * 처음엔 *가장 가까운 보물 하나*를 고른 뒤 규칙(예산·눈앞)으로
     * 걸렀습니다. 그러면 가장 가까운 것이 규칙에 안 맞을 때 **다른
     * 보물이 예산 안에 있어도 통째로 포기**합니다. 실제로 동선을 걸어
     * 보니 다섯 중 **하나만** 알려졌습니다. 고르고 나서 거르면 안 되고,
     * **거르고 나서 골라야** 합니다.
     *
     * ⚠️ 직선거리로 먼저 추립니다 — 걸어야 하는 거리는 직선보다 짧을 수
     *    없으므로, 직선이 예산 밖이면 볼 것도 없습니다. 흐름장(6336칸
     *    BFS)을 보물마다 돌리는 값을 이걸로 아낍니다.
     */
    const cands: { x: number; z: number }[] = []
    for (let i = 0; i < pickups.count; i++) {
      const e = ids[i]
      if (Pickup.taken[e] === 1) continue
      /**
       * 🕯 **비밀은 안내가 말하지 않습니다.** 여기 한 줄이 이 게임의
       * *"역시 나는 게임을 안다"* 를 지킵니다 — 화면이 먼저 *"북서 12m —
       * 보물"* 이라고 말해 버리면 찾아낸 사람의 몫이 사라집니다.
       * (같은 이유로 금 간 벽도 안내에 안 뜹니다 — `npm run wall` ④.)
       */
      if (Pickup.secret[e] === 1) continue
      const x = Transform.x[e]
      const z = Transform.z[e]
      if (Math.hypot(x - px, z - pz) > NAV.sideHintRange) continue
      cands.push({ x, z })
    }
    if (cands.length === 0) return null
    /**
     * ── 🧭 **"저기까지 얼마" 가 아니라 "원래 길보다 얼마나 더"** ──────────
     *
     * 근거는 balance.ts `NAV.sideHintRange` 에 적어 뒀습니다. 요약: 편도로
     * 재면 **편도 낙하 + 복귀 램프**로 만든 곁길(이 존의 「남쪽 함몰지」)을
     * 못 읽습니다 — 들어갔다 나오는 길이 원래 가던 길과 거의 같은데도
     * "46m 나 떨어져 있다"고 재서 안 알려 줍니다.
     *
     * 목표 쪽 흐름장을 **한 번만** 세워서 두 값을 한꺼번에 뽑습니다
     * (나→목표 · 보물→목표). 후보마다 다시 세우지 않습니다.
     */
    let meToGoal = 0
    const goalDist = new Map<{ x: number; z: number }, number>()
    if (goal && this.terrain) {
      this.terrain.buildFlowField(goal.x, goal.z)
      meToGoal = this.terrain.pathDistance(px, pz) ?? 0
      for (const c of cands) {
        const d = this.terrain.pathDistance(c.x, c.z)
        if (d !== null) goalDist.set(c, d)
      }
    }
    /** 지금 서 있는 구역 — 아래 위상 문의 기준입니다(루프 밖에서 한 번만). */
    const hereCell = worldToCell(px, pz, this.levelW, this.levelH)
    const hereName = this.regionAtCell(hereCell.cx, hereCell.cz)?.name ?? ''
    const nearby = this.regionNeighbours.get(hereName)
    let best: { x: number; z: number; walk: number; extra: number } | null = null
    for (const c of cands) {
      /**
       * ⚠️ **걸어야 하는 거리로 거릅니다.** 직선으로 재면 벽 너머 18m 짜리
       *    보물을 "가깝다"고 알려 주게 됩니다 — 이 저장소가 직선거리로 네 번
       *    데인 자리입니다(secret 프로브 주석).
       */
      let walk = Math.hypot(c.x - px, c.z - pz)
      if (this.terrain) {
        this.terrain.buildFlowField(c.x, c.z)
        const d = this.terrain.pathDistance(px, pz)
        if (d === null) continue
        walk = d
      }
      /**
       * 목표가 없으면(다 끝났으면) 견줄 「원래 길」이 없습니다. 그때는
       * 편도가 곧 더 걷는 거리입니다 — 되돌아올 이유가 없으니까요.
       */
      const toGoal = goalDist.get(c)
      const extra = goal && toGoal !== undefined ? walk + toGoal - meToGoal : walk
      /**
       * ── **문턱이 둘인 이유** (하나로 하려다 다른 규칙을 깼습니다) ──────
       *
       * 처음엔 편도 문턱을 **더 걷는 거리로 갈아 끼웠습니다.** 그랬더니
       * `npm run secret` 의 「멀면 안 알려 준다」가 바로 빨개졌습니다 —
       * 시작 지점에서 **"남동 52m — 보물"**. 가는 길에 있는 보물은 더
       * 걷는 거리가 작아서, 존 반대편에 있어도 계속 권하게 됩니다.
       * *"갈 수 없는 것을 알려 주는 것은 놀리는 것"* 이라는 규칙 그대로였습니다.
       *
       * 두 문턱은 **다른 질문**이었습니다:
       *   · 편도 ≤ 예산  — *"지금 이 근처인가"*  (놀리지 않기)
       *   · 더 걷는 ≤ 예산 — *"값이 싼가"*        (헛걸음 시키지 않기)
       * 그래서 갈아 끼우지 않고 **둘 다** 겁니다. 새로 거르는 것은
       * 「북쪽 단상」의 보물(편도 32m 인데 **더 걷는 56m**)입니다 — 봇은
       * 예산 밖이라 영영 안 가는데 사람에게는 권하고 있던 자리입니다.
       * balance.ts 가 적어 둔 *"사람에게는 권하고 계측기는 안 가는 틈"* 이
       * 값이 아니라 **자** 때문에 다시 열려 있었습니다.
       */
      /**
       * ── 🗺 **「지금인가」는 거리가 아니라 구역이 답합니다** ────────────
       *
       * 여기엔 `walk > NAV.sideHintRange` 가 있었습니다. `npm run secret`
       * 이 그 문턱이 **벽**임을 증명했습니다:
       *
       *     안 알려지는 보물을 담으려면 **≥ 60m** · 시작에서 조용하려면 **< 52m**
       *
       * 52 < 60 — 어떤 값도 둘 다 만족하지 못합니다. 그리고 다른 축인
       * `extra` 는 최단 경로 위에서 **위치와 무관하게 일정**하므로
       * (시작에서도 4m, 곁길 입구에서도 4m) *"지금인가"* 를 못 말합니다.
       * **거리 둘로는 「지금」을 표현할 수 없었습니다.**
       *
       * 그래서 위상으로 바꿉니다 — *"지금 구역이거나 그 이웃"*
       * (설계 근거는 `regionNeighbours` 선언부). 조율할 숫자가 없고
       * 판 크기와 무관합니다. 실제로 이 존에서:
       *   · 시작 구역의 이웃은 「무너진 성문」 하나뿐이고 거기엔 보물이
       *     없습니다 → **시작 침묵이 저절로** 지켜집니다
       *   · 보물 여섯 구역 **전부** 동선이 지나는 구역을 이웃으로 둡니다
       *
       * ⚠️ 구역이 없는 자리(구역 밖)에서는 예전처럼 거리로 거릅니다 —
       *    위상을 못 쓰는 곳에서 **아무 문도 없이** 두면 안 됩니다.
       */
      const cCell = worldToCell(c.x, c.z, this.levelW, this.levelH)
      const there = this.regionAtCell(cCell.cx, cCell.cz)?.name ?? ''
      if (hereName && there) {
        if (there !== hereName && !(nearby?.has(there) ?? false)) continue
      } else if (walk > NAV.sideHintRange) continue
      if (extra > NAV.sideHintRange) continue
      // 눈앞에 있으면 알려 줄 필요가 없습니다 — 빛기둥이 이미 보입니다.
      // (이 문턱만은 **편도**로 봅니다: 물어보는 것이 *"이미 보이는가"* 라서.)
      if (walk < NAV.sideHintNear) continue
      /**
       * 고르는 기준도 **더 걷는 거리**입니다 — 가장 싸게 얻는 것을 권합니다.
       *
       * ── ⚠️ **자리가 하나라 싼 것이 비싼 것을 영원히 가립니다** ─────────
       * 알림 자리는 하나인데 후보는 여럿입니다. 그래서 같은 구역에 후보가
       * 둘 있으면 싼 쪽만 계속 뜹니다. 이 존에서 실제로 그렇습니다:
       *
       *     (35,35) 더 걷는  4m  — 「함몰지 가장자리」  ← 늘 이깁니다
       *     (13,47) 더 걷는 12m  — 「남쪽 함몰지」      ← 한 번도 안 뜸
       *
       * **고쳐 보고 되돌렸습니다.** *"이미 말한 것보다 아직 안 말한 것을
       * 먼저"* 라는 순환 규칙을 넣고 `npm run secret` 을 다시 돌렸더니
       * **알려진 보물이 그대로 4/6** 이었습니다 — 넷도 같은 넷이었습니다.
       * (13,47) 이 안 뜨는 진짜 이유는 자리 다툼이 아니라 **가까이서 재면
       * 더 걷는 거리가 예산을 넘기 때문**입니다: 남쪽 함몰지는 일방통행이라
       * 회랑에서 내려가면 되돌아 나오는 값(ONE_WAY_COST)이 얹힙니다.
       * 시작 지점에서 잰 12m 는 그 값이 안 얹힌 수였습니다.
       *
       * 효과가 없는 변경은 남기지 않습니다 — 남기면 다음 사람이 *"이건
       * 무엇을 고친 것이지"* 를 다시 풀어야 합니다.
       */
      if (!best || extra < best.extra) best = { x: c.x, z: c.z, walk, extra }
    }
    if (!best) return null
    const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
    // 화면 위쪽이 −z 입니다(쿼터뷰). 그 축을 '북'으로 부릅니다.
    const a = Math.atan2(best.x - px, -(best.z - pz))
    const idx = ((Math.round((a / (Math.PI * 2)) * 8) % 8) + 8) % 8
    return { dir: DIRS[idx], dist: best.walk, x: best.x, z: best.z }
  }

  private findObjective(px: number, pz: number): { x: number; z: number; label: string; dist: number } | null {
    const eids = enemyQuery.run()
    let boss: { x: number; z: number } | null = null
    let anyEnemy: { x: number; z: number; dist: number } | null = null
    for (let i = 0; i < enemyQuery.count; i++) {
      const e = eids[i]
      if (Actor.state[e] === ActorState.Dead) continue
      const d = Math.hypot(Transform.x[e] - px, Transform.z[e] - pz)
      if (Enemy.kind[e] === EnemyKind.Boss) boss = { x: Transform.x[e], z: Transform.z[e] }
      if (!anyEnemy || d < anyEnemy.dist) anyEnemy = { x: Transform.x[e], z: Transform.z[e], dist: d }
    }
    if (boss) {
      // 🐉 이름은 **적 표에서** 가져옵니다 — 화면 위쪽 보스 바와 같은 값이라야
      //    한 놈에게 이름이 둘이 되지 않습니다(enemies.ts `Boss.name` 주석).
      return {
        ...boss,
        label: `${enemyDef(EnemyKind.Boss).name} 처치`,
        dist: Math.hypot(boss.x - px, boss.z - pz),
      }
    }

    // 보스를 잡았으면 남은 보물이 목표가 됩니다.
    const tids = pickups.run()
    let treasure: { x: number; z: number; dist: number } | null = null
    for (let i = 0; i < pickups.count; i++) {
      const e = tids[i]
      if (Pickup.taken[e] === 1) continue
      const d = Math.hypot(Transform.x[e] - px, Transform.z[e] - pz)
      if (!treasure || d < treasure.dist) treasure = { x: Transform.x[e], z: Transform.z[e], dist: d }
    }
    if (treasure) return { ...treasure, label: '남은 보물' }
    if (anyEnemy) return { ...anyEnemy, label: '남은 적' }
    return null
  }

  /** 플레이어와 가까운 보물을 회수합니다. */
  private collectTreasures(p: number): void {
    const px = Transform.x[p]
    const py = Transform.y[p]
    const pz = Transform.z[p]
    const ids = pickups.run()
    for (let i = 0; i < pickups.count; i++) {
      const e = ids[i]
      if (Pickup.taken[e] === 1) continue
      const dx = Transform.x[e] - px
      const dz = Transform.z[e] - pz
      // 높이도 봅니다 — 아래층을 지나갈 때 위층 보물이 딸려오면 안 됩니다.
      const dy = Transform.y[e] - py
      if (Math.abs(dy) > 1.6) continue
      if (Math.hypot(dx, dz) > TREASURE.pickupRadius) continue

      Pickup.taken[e] = 1
      this.treasuresFound++
      // 정련석 — 무기 강화에만 쓰는 탐험 전용 재료. 파밍으로는 얻을 수 없습니다.
      Player.stones[p] += WEAPON_UPGRADE.stonePerTreasure
      this.stonesEarned += WEAPON_UPGRADE.stonePerTreasure
      // 📍 **처음 자리**로 기록합니다 — 폭발에 밀려난 보물도 같은 상자입니다.
      this.takenTreasures.add(treasureKey(Pickup.homeX[e], Pickup.homeZ[e]))
      this.vfx.spawnHitSpark(Transform.x[e], Transform.y[e] + 1.05, Transform.z[e], 1.8)
      this.cam.addTrauma(0.18)
      sfx.pickup()

      // 보물 = 새 룬(= 새 스킬) **또는** 트라이포드 포인트(= 스킬의 변형).
      // "세져서" 가 아니라 "새로운 걸 할 수 있어서" 재미있어야 한다는
      // DESIGN.md 성장 설계를 시스템으로 구현한 지점입니다.
      //
      // 룬을 먼저 주고 그다음에 포인트를 주는 순서인 이유: 룬은 **새 스킬**이라
      // 변화가 크고 즉시 체감됩니다. 트라이포드는 이미 쓰던 스킬을 다듬는 것이라
      // 먼저 주면 무슨 일이 일어났는지 알기 어렵습니다. 큰 변화부터 보여줍니다.
      const nextRune = Loadout.runesOwned[p]
      if (nextRune < RUNE_ORDER.length) {
        grantRune(p, nextRune)
        this.refreshLoadout()
        const def = SKILLS[RUNE_ORDER[nextRune]]
        this.hud.showBanner(`룬 획득 — ${def.name}`, def.desc, 2.6)
      } else {
        grantTripodPoint()
        this.tripodPanel.refresh()
        this.hud.showBanner('각인석 획득', `T 를 눌러 스킬을 변형하세요 (보유 ${tripodPoints()})`, 2.6)
      }

      /**
       * ── 🏆 **상자마다 무기가 하나 나옵니다** ────────────────────────
       *
       * 이 존의 보물 다섯은 지금까지 **전부 같은 것**을 줬습니다(룬 또는
       * 각인석). 다섯 번째 상자를 여는 이유가 첫 번째와 똑같았습니다.
       * 그게 탐험의 재미에서 가장 큰 구멍이었습니다 — 디아블로·로스트아크가
       * 상자를 열게 만드는 힘은 **모르는 것을 여는 것**입니다.
       *
       * ── 시드는 **자리**에서 나옵니다 ───────────────────────────────
       * `treasureKey`(좌표)를 숫자로 접어 시드로 씁니다. 그래서:
       *   · 같은 상자는 **언제 열어도 같은 것**이 나옵니다. 죽고 되돌아와
       *     다시 열면 더 좋은 게 나오는 게임은, 상자가 아니라 **재시도**를
       *     보상합니다.
       *   · 프로브가 **같은 결과를 재현**할 수 있습니다.
       *
       * ── 진행도가 등급을 밀어 올립니다 ─────────────────────────────
       * `luck` 은 시작 지점에서 걸어온 거리의 비율입니다. 뒤에 있는 상자일수록
       * 좋은 것이 나와야 *"더 깊이 들어갈 이유"* 가 생깁니다 — 소울류의
       * 후반 보물이 하는 일 그대로입니다. 규칙은 gear.ts `rollTier` 한 곳에.
       *
       * ⚠️ **지금 든 무기에만** 끼웁니다. 셋 다 올려 주면 무기를 고르는 일이
       *    사라지고, 상자가 "진행도"가 됩니다. 지금 든 것이 좋아지는 쪽이
       *    *"이 무기로 가겠다"* 는 선택을 갚습니다.
       * ⚠️ 등급이 지금 것보다 낮으면 **안 바꿉니다**(loadout.ts `equipGear`).
       */
      {
        // 📍 굴림의 씨앗도 **처음 자리**입니다 — 밀려난 거리로 등급이 바뀌면 안 됩니다.
        const { seed, tier } = this.gearRollAt(Pickup.homeX[e], Pickup.homeZ[e])
        const weaponIndex = Loadout.weapon[p]
        const got = equipGear(p, weaponIndex, tier, seed)
        const td = tierDef(tier)
        const wname = weaponAt(weaponIndex).name
        if (got) {
          this.refreshLoadout()
          const lines = weaponAffixes(p, weaponIndex)
            .map((a) => `${a.name} +${a.value}${a.unit === '%' ? '%' : ''}`)
            .join(' · ')
          this.hud.showBanner(`${td.name} ${wname}`, lines || '옵션 없음', 3.0, td.color)
        } else {
          // **아무 말도 안 하면 안 됩니다.** "나왔는데 안 바뀌었다"와
          // "아무것도 안 나왔다"는 다른 사건이고, 화면이 그걸 갈라 줘야
          // 플레이어가 규칙(더 좋을 때만 바뀐다)을 배웁니다.
          this.hud.showBanner(`${td.name} ${wname}`, '지금 든 것이 더 좋다', 2.0, td.color)
        }
      }

      this.visuals.detach(e)
      destroyEntity(e)
      // 진행이 실제로 바뀐 순간에만 저장합니다. 매 프레임 쓰면 낭비이고,
      // 종료 시점에만 쓰면 브라우저를 그냥 닫는 흔한 경우에 통째로 날아갑니다.
      this.persist()
    }
  }

  /**
   * 🏪 **상점의 규칙과 지금 재고** — 프로브가 값을 베껴 적지 않게.
   *
   * `atAnvil` 이 false 면 재고는 빈 배열입니다. 그게 곧 규칙입니다 —
   * 상점은 **자리**이지 메뉴가 아닙니다.
   */
  debugShopInfo(): {
    atAnvil: boolean
    open: boolean
    embers: number
    items: {
      weaponIndex: number
      weaponName: string
      tier: number
      tierName: string
      price: number
      sold: boolean
      haveTier: number
      affordable: boolean
      affixes: { name: string; unit: string; value: number }[]
    }[]
  } {
    const a = this.shopAnvil
    const p = this.playerEntity
    if (!a) return { atAnvil: false, open: this.shopPanel.isOpen(), embers: Player.embers[p], items: [] }
    const key = treasureKey(a.x, a.z)
    return {
      atAnvil: true,
      open: this.shopPanel.isOpen(),
      embers: Player.embers[p],
      items: shopStock(key, this.progressRatio(a.x, a.z)).map((item) => ({
        weaponIndex: item.weaponIndex,
        weaponName: item.weaponName,
        tier: item.tier as number,
        tierName: item.tierName,
        price: item.price,
        sold: this.boughtItems.has(shopItemKey(key, item)),
        haveTier: weaponTier(p, item.weaponIndex),
        affordable: Player.embers[p] >= item.price,
        affixes: item.affixes.map((x) => ({ name: x.name, unit: x.unit, value: x.value })),
      })),
    }
  }

  /**
   * 🧪 **실험대 전용** — 재고의 n번째를 삽니다.
   *
   * 창의 버튼을 클릭하는 것과 **같은 함수**(`buyGear`)를 부릅니다. 프로브가
   * 따로 사는 길을 만들면, 창에만 있는 조건을 안 지나가서 *"프로브는
   * 통과하는데 사람은 못 사는"* 상태가 생깁니다.
   */
  debugBuyShopItem(index: number): boolean {
    const a = this.shopAnvil
    if (!a) return false
    const stock = shopStock(treasureKey(a.x, a.z), this.progressRatio(a.x, a.z))
    const item = stock[index]
    if (!item) return false
    const before = weaponTier(this.playerEntity, item.weaponIndex)
    this.buyGear(item)
    return weaponTier(this.playerEntity, item.weaponIndex) !== before
  }

  /** 🏪 지금 서 있는 모루의 재고를 창에 그립니다. */
  private refreshShop(): void {
    const a = this.shopAnvil
    if (!a) return
    const p = this.playerEntity
    const key = treasureKey(a.x, a.z)
    const stock = shopStock(key, this.progressRatio(a.x, a.z))
    this.shopPanel.render(
      stock.map((item) => ({
        item,
        sold: this.boughtItems.has(shopItemKey(key, item)),
        haveTier: weaponTier(p, item.weaponIndex),
        embers: Player.embers[p],
      })),
      Player.embers[p],
    )
  }

  /**
   * 🏪 **삽니다.**
   *
   * ⚠️ 조건을 여기서 **다시 봅니다.** 창의 버튼이 이미 걸러 주지만, 창은
   *    마지막으로 그린 시점의 상태를 들고 있습니다 — 그 사이에 죽어서
   *    불티를 흘렸을 수도 있습니다. **누르는 쪽이 아니라 파는 쪽이**
   *    조건을 지켜야 합니다(이 저장소가 강화에서 이미 배운 자리:
   *    *"일어나기 전에 재지 않습니다"*).
   */
  private buyGear(item: ShopItem): void {
    const a = this.shopAnvil
    if (!a) return
    const p = this.playerEntity
    const key = shopItemKey(treasureKey(a.x, a.z), item)
    if (this.boughtItems.has(key)) return
    if (item.tier <= weaponTier(p, item.weaponIndex)) return
    if (Player.embers[p] < item.price) {
      sfx.deny()
      return
    }
    Player.embers[p] -= item.price
    this.boughtItems.add(key)
    equipGear(p, item.weaponIndex, item.tier, item.seed)
    this.refreshLoadout()
    this.refreshShop()
    sfx.pickup()
    const td = tierDef(item.tier)
    this.hud.showBanner(
      `${item.tierName} ${item.weaponName}`,
      item.affixes.map((x) => `${x.name} +${x.value}${x.unit === '%' ? '%' : ''}`).join(' · ') ||
        '옵션 없음',
      2.6,
      td.color,
    )
    this.persist()
  }

  /**
   * 🏆 **이 자리의 상자에서 나올 것** — 시드와 등급.
   *
   * ⚠️ **줍는 곳과 검사가 같은 함수를 부릅니다.** 프로브가 좌표에서
   *    시드를 다시 만들면 규칙의 두 번째 사본이 생기고, 시드 식을 손보는
   *    날 둘이 갈라집니다. 이 저장소에서 가장 비쌌던 버그가 전부 그
   *    모양이었습니다.
   */
  gearRollAt(x: number, z: number): { seed: number; luck: number; tier: number } {
    const key = treasureKey(x, z)
    let seed = 0
    for (let i = 0; i < key.length; i++) seed = (Math.imul(seed, 31) + key.charCodeAt(i)) | 0
    const luck = this.progressRatio(x, z)
    return { seed, luck, tier: rollTier(seed, luck) }
  }

  /**
   * 🎁 존에 남아 있는 상자들이 **각각 무엇을 줄 것인가** — 열어 보지 않고.
   *
   * 검사가 *"상자마다 다른 것이 나오는가"* 를 물으려면 다섯 번을 실제로
   * 열어야 하는데, 그건 자동 플레이 한 판입니다. 규칙이 다양한 결과를
   * 내는지는 **자리만으로** 답할 수 있습니다.
   */
  debugTreasureRolls(): {
    x: number
    z: number
    luck: number
    tier: number
    tierName: string
    affixes: { name: string; unit: string; value: number }[]
  }[] {
    const out = []
    for (const item of this.terrain?.level.entities ?? []) {
      if (item.kind !== 'treasure') continue
      const roll = this.gearRollAt(item.x, item.z)
      out.push({
        x: item.x,
        z: item.z,
        luck: Number(roll.luck.toFixed(3)),
        tier: roll.tier as number,
        tierName: tierDef(roll.tier).name,
        affixes: rollAffixes(roll.seed, roll.tier).map((a) => ({
          name: a.name,
          unit: a.unit,
          value: a.value,
        })),
      })
    }
    return out.sort((a, b) => a.luck - b.luck)
  }

  /**
   * 🏆 **지금 이 자리가 존의 어디쯤인가**(0=시작, 1=보스).
   *
   * 등급 추첨의 `luck` 으로 씁니다 — 뒤에 있는 상자일수록 좋은 것이
   * 나와야 *"더 깊이 들어갈 이유"* 가 생깁니다.
   *
   * ⚠️ **직선 거리로 잽니다.** 실제로 걸어야 하는 거리가 더 정확하지만,
   *    이 값이 정하는 것은 **다섯 상자의 순서**뿐이고 이 존은 한 방향
   *    (+X)이라 직선으로도 순서가 안 뒤집힙니다. 길찾기를 태워 정밀도를
   *    사는 대신, **틀리면 눈에 보이는 곳**(상자 다섯의 등급 분포)에서
   *    확인합니다 — `npm run gear` 가 그걸 봅니다.
   *    존이 여러 갈래가 되는 날 다시 볼 자리입니다.
   */
  private progressRatio(x = Transform.x[this.playerEntity], z = Transform.z[this.playerEntity]): number {
    const boss = this.terrain?.level.entities.find((e) => e.kind === 'boss')
    const spawn = this.terrain?.level.entities.find((e) => e.kind === 'spawn')
    if (!boss || !spawn) return 0
    const span = Math.hypot(boss.x - spawn.x, boss.z - spawn.z)
    if (span <= 0.001) return 0
    return Math.max(0, Math.min(1, Math.hypot(x - spawn.x, z - spawn.z) / span))
  }

  /**
   * 이미 먹은 보물을 월드에서 치웁니다.
   *
   * 남겨두면 다시 먹혀서 각인석이 무한정 생깁니다 — 세이브가 곧 치트가 됩니다.
   * 보물 자체를 지우는 편이 "먹었지만 안 보이게"보다 낫습니다. 빛기둥과
   * 길안내 목표 계산이 전부 살아 있는 보물만 보면 되기 때문입니다.
   */
  private removeDefeatedBosses(): void {
    if (this.defeatedBosses.size === 0) return
    const ids = enemyQuery.run()
    const doomed: number[] = []
    for (let i = 0; i < enemyQuery.count; i++) {
      const e = ids[i]
      if (Enemy.kind[e] !== EnemyKind.Boss) continue
      if (!this.defeatedBosses.has(bossKey(Transform.x[e], Transform.z[e]))) continue
      doomed.push(e)
    }
    for (const e of doomed) {
      this.visuals.detach(e)
      destroyEntity(e)
    }
  }

  /**
   * ── 🎁💥 **밀려난 보물이 내려앉을 자리** ─────────────────────────────
   *
   * 폭발 중심에서 바깥으로(`dirX,dirZ`) 밀되, **주울 수 있는 자리**를
   * 찾습니다. 「주울 수 있는가」 = 플레이어가 **걸어서 닿는가** 이고,
   * 그 판단은 흐름장(`distanceToPlayer`)에게 물어봅니다 — 여기서 지형
   * 규칙을 다시 쓰면 규칙이 두 벌이 됩니다.
   *
   * ── 왜 부채꼴로 훑는가 ───────────────────────────────────────────
   * 곧장 밀린 방향으로만 보면, 그 방향이 벼랑이거나 벽이면 **아무 자리도
   * 못 찾습니다.** 단상은 대개 한쪽만 트여 있어서 실제로 자주 그렇습니다.
   * 그래서 밀린 방향을 **가운데로** 두고 좌우로 벌려 가며 봅니다 —
   * 물리적으로 정확한 궤적은 아니지만, 이 게임이 약속한 것은 궤적이
   * 아니라 *"떨어뜨리면 주울 수 있다"* 입니다.
   *
   * ⚠️ 가까운 것부터 찾습니다(반지름을 안쪽에서 바깥으로). 멀리 던지는
   *    것이 시원해 보여도, **어디로 갔는지 못 찾는 보물**이 제일 나쁩니다.
   *
   * ── 두 반경이 하는 일이 다릅니다 ─────────────────────────────────
   *   · **휘말리는가** = `BARREL.blast`(4m). 물리적으로 폭발에 닿는 거리라
   *     적·플레이어와 같은 자를 씁니다.
   *   · **얼마나 멀리 밀리는가** = 「주울 수 있는 자리가 어디 있는가」가
   *     정하고, **상한만** `BARREL.chain`(8m)으로 둡니다.
   *
   * 상한에 새 숫자를 안 만든 것이 요점입니다. `chain` 은 이미 *"폭발이
   * 관여하는 가장 먼 거리"* 라는 뜻이라(불이 거기까지 번집니다), 그 밖으로
   * 나가면 **폭발과 무관한 순간이동**이 됩니다. 여기에 `12` 같은 값을
   * 새로 적으면 나중에 아무도 그 12가 무엇이었는지 모릅니다.
   *
   * ⚠️ 못 찾으면 그냥 **안 옮깁니다.** 억지로 옮기면 벽 속에 박힙니다.
   */
  private landingSpotFor(
    canGo: Uint8Array,
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
  ): { x: number; z: number } | null {
    const t = this.terrain
    if (!t) return null
    // 방향이 없으면(정확히 통 위) 정면을 +x 로 두고 한 바퀴 다 봅니다.
    const base = dirX === 0 && dirZ === 0 ? 0 : Math.atan2(dirX, dirZ)
    for (let r = 1.0; r <= BARREL.chain; r += 0.5) {
      for (let spread = 0; spread <= Math.PI; spread += Math.PI / 12) {
        for (const side of spread === 0 ? [0] : [-1, 1]) {
          const a = base + spread * side
          const nx = x + Math.sin(a) * r
          const nz = z + Math.cos(a) * r
          if (!t.canReach(canGo, nx, nz)) continue
          return { x: nx, z: nz }
        }
      }
    }
    return null
  }

  private removeTakenTreasures(): void {
    const ids = pickups.run()
    // 순회 중에 엔티티를 지우므로 먼저 모아 둡니다.
    const doomed: number[] = []
    for (let i = 0; i < pickups.count; i++) {
      const e = ids[i]
      if (this.takenTreasures.has(treasureKey(Pickup.homeX[e], Pickup.homeZ[e]))) doomed.push(e)
    }
    for (const e of doomed) {
      this.visuals.detach(e)
      destroyEntity(e)
    }
  }

  /**
   * 지금 진행 상황을 기록합니다.
   *
   * 저장 실패(용량 초과·사생활 보호 모드)는 삼킵니다 — 저장이 안 된다고
   * 게임이 멈추면 안 됩니다. 대신 HUD가 저장 여부를 보여줍니다.
   */
  /** 외부(트라이포드 창 등)에서 진행이 바뀌었을 때 부릅니다. */
  persistProgress(): void {
    this.persist()
  }

  private persist(): void {
    if (!this.saveId || this.playerEntity < 0) return
    const ok = writeSave(
      captureSave(
        this.saveId,
        this.playerEntity,
        this.takenTreasures,
        time.elapsed,
        this.defeatedBosses,
        this.terrain?.openShortcutKeys() ?? [],
        this.boughtItems,
      ),
    )
    this.hud.flashSaved(ok)
  }

  /** 이 레벨의 진행을 지우고 처음부터 시작합니다. */
  resetProgress(): void {
    if (this.saveId) clearSave(this.saveId)
    this.reset()
  }

  /**
   * VFX 격리 확인용. 적을 모두 치우고 이펙트 한 종류만 화면에 띄웁니다.
   * 전투 중 스크린샷은 여러 이펙트가 겹쳐 있어서, 어느 것이 잘못 그려지는지
   * 구분할 수가 없습니다. 하나씩 떼어놓고 봐야 원인이 특정됩니다.
   */
  /**
   * 🏛 **잔해 장부** — 프로브가 좌표를 베껴 적지 않게 게임이 내보냅니다.
   *
   * `candidates` 를 같이 내보내는 이유: 상한(`MAX_PROPS`)에 걸려 잘렸는지
   * 여기서만 보입니다. 잘린 것을 모르면 *"이 구역엔 원래 잔해가 없구나"* 로
   * 읽게 되는데, 실은 **앞에서 다 써 버린 것**입니다.
   */
  /**
   * 💢 한 대가 깎는 강인도 — **판정이 쓰는 그 함수**(`poiseDamage`)를 그대로
   * 부릅니다. 프로브가 식을 베껴 적으면 규칙의 사본이 생깁니다.
   */
  debugPoiseRule(kindId: string, breaks: number): number {
    const kind = kindFromId(kindId)
    if (kind === null || kind === undefined) return -1
    const def = enemyDef(kind)
    return Number(poiseDamage(def.trauma, 1, POISE.basicMultiplier, kind, 0, breaks).toFixed(4))
  }

  debugShowProps(on: boolean): void {
    if (this.props) this.props.visible = on
  }

  debugProps(): PropsInfo {
    return (
      this.propsInfo ?? {
        pillars: 0,
        rubble: 0,
        pillarSpots: 0,
        rubbleSpots: 0,
        unreachable: 0,
        byRegion: {},
      }
    )
  }

  debugSetPaused(paused: boolean): void {
    this.paused = paused
  }

  /**
   * ⏱ **고정 걸음** — 프레임을 정확히 `dtSec` 초씩 `frames` 번 진행합니다.
   *
   * ── 왜 필요한가 (재현성 검사가 866픽셀에서 막혀 있었습니다) ──────────
   * 이 저장소의 검사 여럿이 *"같은 시각이면 같은 그림"* 위에 서 있습니다.
   * 그런데 **같은 시각에 설 방법이 없었습니다.** 프로브는 `elapsed` 가 6초를
   * 넘을 때까지 8ms 마다 들여다보다가 사진을 찍는데, 그 사이에도 프레임은
   * 계속 돌아갑니다. 그래서 실제로 찍히는 시각은 6.00초가 아니라
   * **6.00 + 그때그때 다른 나머지**입니다.
   *
   * 그 나머지가 픽셀로 새어 나옵니다 — 보물상자는 `time.elapsed` 로 위아래
   * 흔들리고(visuals.ts) 화톳불도 `time.elapsed` 로 맥동합니다. 즉 두 판이
   * 다른 것은 **난수가 남아서가 아니라 시각이 달라서**였습니다. 씨앗을 아무리
   * 심어도 이 차이는 안 없어집니다.
   *
   * 해결은 값을 만지는 쪽이 아니라 **계측기를 고치는 쪽**입니다. 벽시계 대신
   * 걸음 수로 시간을 주면 두 판이 **정확히 같은 시각**에 섭니다. 게임 쪽
   * 규칙(연출이 `realDt` 로 흐른다)은 하나도 안 건드립니다 — 그건 의도된
   * 설계이고(core/time.ts), 고쳐야 할 것은 그걸 못 재던 자 쪽이었습니다.
   *
   * ⚠️ **검증 도구 전용입니다.** 부르기 전에 `setPaused(true)` 로 rAF 루프를
   *    세워야 합니다. 안 세우면 걸음 사이사이에 벽시계 프레임이 끼어들어
   *    이 함수가 주는 정확한 델타가 다시 흐트러집니다.
   *
   * @param fromZero 시계를 0으로 되돌리고 시작합니다. 페이지가 뜨기까지
   *   걸린 시간이 판마다 달라서, 안 되돌리면 첫 걸음의 시각부터 어긋납니다.
   */
  debugStep(frames: number, dtSec: number, fromZero = false): void {
    if (fromZero) resetTime()
    const was = this.paused
    this.paused = false
    // 여기는 동기 루프라 rAF 가 중간에 끼어들 수 없습니다(자바스크립트는 한 줄).
    for (let i = 0; i < frames; i++) this.frame(this.lastFrameMs + dtSec * 1000)
    this.paused = was
  }

  debugSwingVisible(): boolean {
    return this.vfx.hasActiveSwing()
  }

  /**
   * 🩸 **출혈 실험대** — 죽지 않는 허수아비를 원하는 체력 비율로 세웁니다.
   *
   * *"같은 간격으로 때리는데 체력만 다르면 결과가 달라지는가"* 를 재려면
   * 두 판의 차이가 **체력 하나뿐**이어야 합니다. 실제 적은 맞다가 죽으므로
   * 최대 체력을 크게 잡아 **타수를 다 채울 때까지 버티게** 합니다.
   *
   * ⚠️ 잠들여 둡니다(`asleep`). 깨어 있으면 플레이어에게 걸어와 때리고,
   *    그러면 이 실험의 변수가 체력 하나가 아니게 됩니다. 출혈이 식는
   *    코드는 잠든 적에게도 그대로 흐릅니다(enemyAI 의 같은 루프).
   */
  debugSpawnBleedDummy(hpRatio: number): number {
    const e = this.debugSpawnTestEnemy(-80, -80, 0, true)
    Health.max[e] = 10000
    Health.hp[e] = Math.max(1, 10000 * Math.min(1, Math.max(0, hpRatio)))
    this.bleedDummyHp.set(e, Health.hp[e])
    Enemy.bleed[e] = 0
    Enemy.bleedBuilt[e] = 0
    Enemy.bleedIdleT[e] = 0
    return e
  }

  /** 🩸 실험대 — 한 대분 얹습니다(게임과 **같은 함수**). 터졌으면 true. */
  debugHitBleedDummy(e: number, bleedScale = 1): boolean {
    const popped = debugApplyBleed(e, bleedScale)
    // 터짐 피해로 체력 비율이 흔들리지 않게 되돌립니다 — 재려는 변수는 체력이고,
    // 그 체력이 실험 도중에 바뀌면 두 판을 견줄 수가 없습니다.
    Health.hp[e] = this.bleedDummyHp.get(e) ?? Health.hp[e]
    return popped
  }

  /** 🩸 실험대 — 지금 쌓여 있는 양. */
  debugBleedOf(e: number): number {
    return Enemy.bleed[e]
  }

  /** 🩸 실험대 — 치웁니다. 남겨 두면 다음 판의 "가장 가까운 적"이 됩니다. */
  debugDespawnBleedDummy(e: number): void {
    this.bleedDummyHp.delete(e)
    if (!isAlive(e)) return
    this.visuals.detach(e)
    destroyEntity(e)
  }

  debugClearEnemies(): void {
    for (let e = 0; e < 4096; e++) {
      if (!isAlive(e) || e === this.playerEntity) continue
      if (Renderable.kind[e] === KIND_TREASURE) continue
      this.visuals.detach(e)
      destroyEntity(e)
    }
  }

  /**
   * 적을 정확히 한 마리만 세워 1:1 상황을 만듭니다.
   *
   * 백어택 같은 포지셔닝 기술은 적이 여럿이면 검증이 불가능합니다 —
   * "가장 가까운 적"이 계속 바뀌어서 무엇의 등 뒤인지 알 수가 없기 때문입니다.
   * 밸런스를 손으로 만져볼 때도 1:1 시험장이 필요해서 남겨 둡니다.
   */
  debugSpawnTestEnemy(x: number, z: number, rotY?: number, asleep = false): number {
    const e = spawnGrunt(x, z)
    // 바라보는 방향을 지정할 수 있어야 백어택 같은 방향 판정을 검증할 수 있습니다.
    if (rotY !== undefined) Transform.rotY[e] = rotY
    // 위 debugSpawnKind 와 같은 계약입니다 — 기본은 **깨어 있는 적**.
    if (!asleep) Enemy.aggro[e] = 1
    if (this.terrain) Transform.y[e] = this.terrain.groundYAt(x, z)
    this.visuals.attach(e, Renderable.kind[e])
    return e
  }

  /**
   * 특정 적을 지정한 공격 패턴의 **예고 단계에 세워 둡니다.**
   *
   * 4색 예고는 "빨강이 떴을 때 화면이 어떻게 보이는가"를 눈으로 봐야 검증됩니다.
   * 그런데 어떤 색이 나올지는 거리와 난수가 정하므로, 그냥 기다려서는
   * 원하는 색을 잡을 수 없습니다. 그래서 직접 지정할 수단을 둡니다.
   */
  /**
   * @param windupScale 남길 예고의 비율. 기본 0.25 는 **사진용**입니다 —
   *   예고 이펙트가 가장 진한 후반부에 세워 두려는 것이라, 이 값으로는
   *   *"예고 동안 적이 얼마나 따라 도는가"* 를 잴 수 없습니다(시간의 4분의
   *   1만 흐르니까요). 추적을 재는 실험대는 **1** 을 넣어 전체 예고를 씁니다.
   */
  debugForceAttack(entity: number, index: number, windupScale = 0.25): string {
    const kind = Enemy.kind[entity]
    const list = attacksFor(kind)
    const i = Math.min(Math.max(index, 0), list.length - 1)
    Enemy.attackIndex[entity] = i
    Enemy.aggro[entity] = 1
    // 강제 공격도 **정상 커밋과 같은 연계**를 달고 있어야 합니다.
    // 여기서 빠뜨리면 검증 도구가 보는 것과 실제 전투가 달라집니다.
    Enemy.chainNext[entity] = chainIndexFor(kind, Enemy.phase[entity], i)
    Actor.state[entity] = ActorState.Attack
    Actor.phase[entity] = AttackPhase.Windup
    // 예고 투명도는 **남은 시간 비율**로 계산됩니다(가득 찰수록 진해짐).
    // 그래서 타이머를 크게 넣으면 오히려 투명해져 아무것도 안 보입니다.
    // 잘 보이는 후반부(75% 지점)에 세워 둡니다.
    Actor.timer[entity] = list[i].windup * windupScale
    /**
     * 🕐 **예고 «전체 길이»도 같이 세웁니다** — 정상 커밋과 같은 모양으로.
     *
     * `commitAttack` 은 `Enemy.windupLen = Actor.timer` 를 남기는데 이
     * 디버그 경로는 안 남기고 있었습니다. 그런데 화면의 차오름이
     * `p = 1 − 남은 시간 / windupLen` 이라, 안 세우면 **앞 공격이 남긴
     * 값**으로 나눕니다 — 즉 차오름이 «지난 공격의 길이»에 따라 달라집니다.
     *
     * 지금까지 안 들킨 이유: 기본 배율이 0.25 이고 `windupLen` 이 마침
     * **같은 공격의 전체 길이**로 남아 있으면 p = 0.75 가 되어 «후반부에
     * 세운다»는 의도와 우연히 맞았습니다. 우연히 맞는 것은 규칙이
     * 아닙니다 — `npm run fill` 이 그 우연에 걸려 세 장을 전부 0.78 로
     * 찍었습니다.
     *
     * ⚠️ `timer` 가 아니라 **전체 길이**를 넣습니다. `timer` 를 넣으면
     *    p = 0 이 되어 예고가 텅 빈 채로 서고, «잘 보이는 후반부»라는
     *    이 함수의 목적이 사라집니다.
     */
    Enemy.windupLen[entity] = list[i].windup
    /**
     * ⏳ **세우는 쪽이 예고 길이도 적습니다.**
     *
     * 차오름의 분모가 `Enemy.windupLen` 으로 바뀐 뒤로, 이 줄이 없으면
     * 분모가 0 이라 투명도가 0 으로 눌립니다 — `npm run contrast` 가
     * 8개 중 6개 빨간색으로 그걸 잡았습니다. 화면에 아무것도 안 그려진
     * 채로 "색이 안 갈린다"고 찍혔던 것입니다.
     * 상태를 세우는 자리는 **정상 커밋과 같은 것을 다 채워야** 합니다
     * (바로 위 `chainNext` 도 같은 이유로 여기 있습니다).
     */
    Enemy.windupLen[entity] = list[i].windup
    Enemy.heldT[entity] = 0
    // 플레이어를 바라보게 돌려 둡니다 — 등지고 선 예고는 확인할 의미가 없습니다.
    const p = this.playerEntity
    Transform.rotY[entity] = Math.atan2(
      Transform.x[p] - Transform.x[entity],
      Transform.z[p] - Transform.z[entity],
    )
    return list[i].id
  }

  /** 지금 레벨에 살아 있는 적을 종류별로 셉니다. */
  debugLevelRoster(): Record<string, number> {
    const out: Record<string, number> = {}
    const ids = enemyQuery.run()
    for (let i = 0; i < enemyQuery.count; i++) {
      const id = enemyDef(Enemy.kind[ids[i]]).id
      out[id] = (out[id] ?? 0) + 1
    }
    return out
  }

  /**
   * 화톳불에서 쉽니다 — 체력·성수병 회복 + **적 부활** + 부활 지점 지정.
   *
   * 적을 되살리는 것이 이 기능의 핵심입니다. 없으면 "화톳불 왕복 = 공짜 회복"이
   * 되어, 성수병을 충전식으로 만든 이유가 통째로 사라집니다.
   * 되돌아가는 데 비용이 있어야 **"밀고 갈까"** 가 진짜 선택이 됩니다.
   */
  /**
   * 사다리를 내립니다 — **위에 서 있을 때만.**
   *
   * 조사에서 반복해 나온 문장이 결론을 그대로 말해 줍니다:
   * *"닿지 않는 사다리가 보이면 그 위쪽을 아직 다 못 본 것이다."*
   * 아래에서도 열 수 있게 하면 이 문장이 성립하지 않게 되고, 걷힌 사다리는
   * 정보가 아니라 그냥 잠긴 문이 됩니다. 그래서 아래에서는 **왜 안 되는지**만
   * 알려주고 열어주지 않습니다.
   *
   * 화톳불(자동으로 붙음)과 달리 버튼을 요구하는 이유: 지름길이 열리는 순간은
   * 이 게임에서 **탐험이 보상받는 유일한 순간**입니다. 모르고 지나가면
   * 보상이 아니라 우연이 됩니다.
   */
  private tryDropLadder(p: number, playerAlive: boolean): void {
    if (!this.terrain || !playerAlive || this.terrain.shortcuts.length === 0) {
      this.hud.setShortcut(null)
      return
    }
    const found = this.terrain.shortcutNear(Transform.x[p], Transform.z[p], LADDER_REACH)
    if (!found) {
      this.hud.setShortcut(null)
      return
    }
    const { s, fromTop } = found
    this.hud.setShortcut(
      s.open ? 'open' : fromTop ? 'ready' : 'locked',
      s.open ? null : this.terrain.shortcutSaving(s),
    )
    if (s.open || !fromTop) return
    /**
     * 키가 **V**인 이유: E는 이미 무기 스킬 2번입니다(실제로 E로 만들었다가
     * 프로브에서 사다리 대신 스킬이 나갔습니다). 새 키를 하나 더 늘리는 대신
     * 화톳불 강화와 같은 V를 씁니다 — V는 "이 자리에서 할 수 있는 일" 하나로
     * 묶입니다. 화톳불과 사다리가 같은 자리에 있을 일은 없고(사다리는 절벽
     * 경계, 화톳불은 트인 바닥), 만에 하나 겹치면 강화가 먼저 소비합니다.
     */
    if (!consumePress('KeyV')) return

    // 배너에도 **잰 값**을 씁니다. "지름길이 열렸습니다"는 무슨 일이 일어났는지고,
    // "98m가 2m가 됐습니다"는 무엇을 얻었는지입니다.
    const saved = this.terrain.shortcutSaving(s)
    s.open = true
    this.syncLadderVisuals()
    sfx.pickup()
    this.cam.addTrauma(0.22)
    this.hud.showBanner(
      '사다리를 내렸다',
      saved !== null && saved > 6 ? `돌아오던 ${Math.round(saved)}m가 2m가 되었다` : '지름길이 열렸습니다',
      2.4,
    )
    this.persistProgress()
  }

  /**
   * 🎁 **아직 벽 뒤에 있는 보물의 빛기둥을 끕니다.**
   *
   * 「숨었는가」를 **깃발로 들고 다니지 않습니다.** 지형에게 *"지금
   * 걸어서 닿는가"* 를 물어서 그때그때 정합니다. 깃발로 두면 레벨을
   * 고치는 날 깃발과 지형이 갈라지고, 그러면 **벽이 없는데 안 보이는
   * 보물**이나 그 반대가 조용히 생깁니다.
   *
   * ⚠️ 비용 때문에 **매 프레임 부르지 않습니다.** 보물 하나마다 격자
   *    전체(6336칸)를 한 번 훑으므로, 답이 바뀔 수 있는 순간에만
   *    부릅니다 — 레벨을 연 직후와 **벽이 부서졌을 때**. 그 둘 말고는
   *    「걸어서 닿는가」가 바뀔 길이 없습니다(사다리는 위로만 여는
   *    장치라 보물을 가두지 않습니다).
   */
  /**
   * 🎨 **이 색을 아직 안 배웠으면 줄에 넣습니다.**
   *
   * 이 저장소에서 색 안내를 만드는 자리는 **여기 하나뿐**입니다.
   * 두 곳이 되면 「색마다 한 번」이 한쪽에서만 지켜집니다.
   *
   * @returns 이번에 새로 넣었으면 true
   */
  private queueColorHint(intent: number): boolean {
    if (this.seenIntents.has(intent)) return false
    this.seenIntents.add(intent)
    this.colorHintQueue.push(intent)
    return true
  }

  /**
   * 🎁 지금 **벽 뒤에 있는** 보물들. `syncHiddenTreasures` 가 채웁니다.
   *
   * 이 집합이 있는 이유는 아래 `onlyHidden` 문단입니다 — 요약하면
   * **벽을 부순 프레임에 여덟 번 흘리지 않기 위해서**입니다.
   */
  private readonly hiddenTreasures = new Set<number>()

  /**
   * @param onlyHidden true 면 **이미 숨어 있던 보물만** 다시 봅니다.
   *
   * 벽이 열려서 **새로 보이게 될 수 있는 보물은 원래 숨어 있던 것뿐**
   * 입니다. 그래서 다시 볼 것도 그것뿐입니다 — 흘리기가 여덟 번에서
   * 보통 **한 번**으로 줄어듭니다(하나에 격자 전체 6336칸입니다).
   *
   * ── ⚠️ **이 변경은 버그를 고치려다 나왔는데, 그 버그가 아니었습니다** ──
   * `npm run wall` 에서 *"벽을 부순 다음 휘두름이 판정을 건너뛴다"* 가
   * 났고, 저는 **긴 프레임이 판정을 삼킨 것**이라고 읽었습니다(이 저장소에
   * 실제로 그런 기록이 있습니다 — 매 프레임 흐름장을 만들었다가 출혈
   * 검사를 깨뜨린 적). 그래서 이 최적화를 넣었는데 **빨간불이 그대로**
   * 였습니다.
   *
   * 진짜 원인은 프로브였습니다: `debugInput.press` 는 이미 눌린 키를
   * 무시하는데 뗀 적이 없어서 **두 번째 휘두름부터 아예 없었습니다.**
   *
   * 그래도 이 줄은 **남깁니다** — 고친 것이 아니라 **덜 하는 것**이고,
   * 한 프레임에 격자를 여덟 번 훑을 이유는 원래 없었습니다.
   * ⚠️ 다만 *"이게 그 버그를 고쳤다"* 고 읽지 마십시오. 안 고쳤습니다.
   */
  private syncHiddenTreasures(onlyHidden = false): void {
    if (!this.terrain) return
    const ids = treasureQuery.run()
    for (let i = 0; i < treasureQuery.count; i++) {
      const e = ids[i]
      if (onlyHidden && !this.hiddenTreasures.has(e)) continue
      this.terrain.buildFlowField(Transform.x[e], Transform.z[e])
      const reach = this.terrain.pathDistance(Transform.x[this.playerEntity], Transform.z[this.playerEntity])
      this.visuals.setPillarVisible(e, reach !== null)
      if (reach === null) this.hiddenTreasures.add(e)
      else this.hiddenTreasures.delete(e)
    }
  }

  /**
   * 🧱 세이브에 **부순 것으로 적힌 벽**의 몸통을 치웁니다.
   *
   * `removeTakenTreasures` · `removeDefeatedBosses` 와 같은 계약입니다:
   * *"세이브가 「이미 끝난 일」이라고 말하는 것은 판이 시작될 때 이미
   * 없어야 한다."*
   */
  private removeBrokenWalls(): void {
    if (!this.terrain) return
    const open = new Set(
      this.terrain.shortcuts.filter((s) => s.kind === 'wall' && s.open).map((s) => s.key),
    )
    if (open.size === 0) return
    for (let e = 0; e < 4096; e++) {
      if (!isAlive(e) || !hasComponent(CrackedWall, e)) continue
      if (!open.has(`${CrackedWall.cx[e]},${CrackedWall.cz[e]}`)) continue
      this.visuals.detach(e)
      destroyEntity(e)
    }
  }

  private syncLadderVisuals(): void {
    if (!this.terrain) return
    for (let i = 0; i < this.ladderVisuals.length; i++) {
      const s = this.terrain.shortcuts[i]
      const v = this.ladderVisuals[i]
      if (s && v) v.setOpen(s.open)
    }
  }

  private restAt(p: number, fire: Bonfire): void {
    this.restCount++
    this.restGeneration++
    Health.hp[p] = Health.max[p]
    Stamina.value[p] = Stamina.max[p]
    Player.vials[p] = Player.vialsMax[p]
    Player.respawnX[p] = fire.x
    Player.respawnZ[p] = fire.z
    Player.hasRespawn[p] = 1

    let revived = 0
    if (this.levelData && this.terrain) {
      // 살아 있는 적을 먼저 치우고 원본 배치대로 다시 만듭니다.
      // 안 치우면 쉴 때마다 적이 두 배씩 늘어납니다.
      const ids = enemyQuery.run()
      const doomed: number[] = []
      for (let i = 0; i < enemyQuery.count; i++) doomed.push(ids[i])
      // ⚠️ 지우기 **전에** 예약을 셉니다 — 엔티티가 사라지면 아무도 못 셉니다.
      noteChainsWiped()
      for (const e of doomed) {
        this.visuals.detach(e)
        destroyEntity(e)
      }
      const fresh = respawnLevelEnemies(this.levelData, this.terrain, this.defeatedBosses)
      for (const e of fresh) this.visuals.attach(e, Renderable.kind[e])
      revived = fresh.length
      resetAttackTokens()
    }

    this.cam.addTrauma(0.2)
    sfx.bossPhase()
    /**
     * **체감률을 배너에 적습니다.**
     *
     * 조용히 줄이면 플레이어는 "왜 불티가 안 모이지"만 느끼고 이유를 모릅니다.
     * 규칙은 숨기는 순간 불공정이 됩니다 — 4색 예고를 만든 원칙 그대로입니다.
     */
    const decayPct = Math.round(
      Math.max(EMBER.respawnFloor, EMBER.respawnDecay ** this.restGeneration) * 100,
    )
    this.hud.showBanner(
      '화톳불에서 쉬었다',
      `성수병 ${Player.vialsMax[p]}개 · 적 ${revived}마리 부활 · 불티 ${decayPct}%`,
      2.2,
    )
    this.persistProgress()
  }

  /**
   * 죽은 자리에 가진 불티를 전부 떨어뜨립니다.
   *
   * **그냥 사라지게 하지 않는 이유**: 사라지면 그건 벌일 뿐입니다.
   * 되찾으러 가는 길이 있어야 긴장이 생깁니다 — 죽은 자리로 돌아가는
   * 그 한 번의 이동이 이 시스템이 만들어내는 가장 중요한 순간입니다.
   *
   * 표식이 이미 있으면 **덮어씁니다.** 여러 개가 쌓이면 손실이 실감나지 않고,
   * 되찾으러 가다가 또 죽는 것이 진짜 손실이 되어야 합니다.
   */
  private dropEmbers(p: number): void {
    const amount = Player.embers[p]
    this.clearDrop()
    if (amount <= 0) return
    Player.embers[p] = 0
    this.drop = { x: Transform.x[p], y: Transform.y[p], z: Transform.z[p], amount }
    this.dropVisual = this.visuals.addEmberDrop(this.drop.x, this.drop.y, this.drop.z)
  }

  /**
   * ── 🔥 **화톳불 사이 빠른 이동 — 지름길을 연 뒤에만 열립니다** ────────
   *
   * ── 왜 조건을 다는가 (안 달았으면 사다리가 죽습니다) ─────────────────
   * 이 존의 화톳불 둘은 같은 복도에 74m 떨어져 있고, 사다리 지름길이
   * 아끼는 거리가 72m 입니다. 즉 조건 없이 이동을 열면 **사다리가 갚을
   * 것이 없어집니다.** 바로 앞 회차에 화톳불을 지름길 뒤에 놓았다가
   * 정확히 그 일을 냈습니다 — `map` 이 *"부활 화톳불에서 보스까지
   * 64m → 64m (0m 단축)"* 로 잡았습니다.
   *
   * 다크 소울 1 이 빠른 이동을 **중반에** 여는 이유가 이것입니다. 지형을
   * 알아내는 일이 먼저이고, 편의는 그 위에 얹힙니다. 우리 버전의 "군주의
   * 그릇"은 **사다리**입니다 — 한 바퀴 돌아 위에서 내린 그 사다리가
   * 이동의 열쇠가 됩니다. 지름길을 죽이는 대신 **지름길이 이동을
   * 낳습니다.**
   *
   * ── 왜 목록 UI 가 없는가 ────────────────────────────────────────
   * 이 게임의 화톳불에는 일부러 상호작용 키를 안 뒀습니다(bonfire.ts:
   * *"키 안내가 필요한 상호작용은 게임이 설명해야 할 것이 하나 느는 일"*).
   * 켜진 화톳불이 둘일 때 "다음 것으로"는 곧 "다른 것으로"라 고를 것이
   * 없습니다. 셋 이상이 되면 그때 목록이 필요해지고, 그건 그때의 변경
   * 입니다 — 지금 만들면 쓰지 않는 화면을 하나 더 지키게 됩니다.
   *
   * ⚠️ **쉴 수 있을 때만** 됩니다(`atFire` 는 적이 가까우면 거짓입니다).
   *    전투 중 탈출로가 되면 이 게임에서 가장 비싼 자원인 *"도망칠 수
   *    없다"* 가 사라집니다.
   */
  private tryTravel(p: number, atFire: boolean): void {
    const lit = this.bonfires.filter((f) => f.lit)
    /**
     * 🧱 **벽을 부순 것은 지름길을 연 것이 아닙니다.** 순간이동의 조건은
     *    *"돌아오는 길을 스스로 만들었는가"* 인데, 벽은 막다른 방을 여는
     *    물건이라 돌아오는 길과 아무 상관이 없습니다. `kind` 로 가르지
     *    않으면 항아리 방 하나를 연 사람이 **순간이동을 얻습니다.**
     */
    const opened = (this.terrain?.shortcuts ?? []).some((s) => s.kind === 'ladder' && s.open)
    const ready = atFire && lit.length >= 2 && opened
    this.hud.setTravel(atFire && lit.length >= 2, opened)
    if (!ready || !consumePress(TRAVEL_KEY)) return
    /**
     * 지금 서 있는 화톳불 **다음** 것으로. 목록의 순서를 쓰므로 여러 번
     * 누르면 순환합니다 — 셋 이상이 되어도 규칙이 그대로 성립합니다.
     */
    let here = 0
    let best = Infinity
    for (let i = 0; i < lit.length; i++) {
      const d = Math.hypot(lit[i].x - Transform.x[p], lit[i].z - Transform.z[p])
      if (d < best) {
        best = d
        here = i
      }
    }
    const to = lit[(here + 1) % lit.length]
    this.debugTeleport(to.x, to.z)
    sfx.bossPhase()
    this.cam.snapTo(to.x, to.z)
    this.hud.showBanner('화톳불 사이를 건넜다', '지름길을 연 값입니다', 1.8)
  }

  /**
   * 화톳불 앞에서 **V** 로 성수병을 강화합니다.
   *
   * 왜 하필 성수병인가: 방금 만든 회복 시스템에 직접 이어지고, **생존력**
   * 강화라 죽을수록 다음 시도가 쉬워집니다. 좌절을 푸는 밸브 역할입니다.
   * 공격력에 붓게 하면 "약해서 죽었으니 더 죽어야 강해진다"가 되어 반대로 갑니다.
   *
   * 상한(6개)을 둔 이유: 무한히 늘리면 회복이 다시 공짜가 되어,
   * 성수병을 충전식으로 만든 이유가 사라집니다.
   */
  private tryUpgrade(p: number, atFire: boolean): void {
    const step = Player.vialsMax[p] - VIAL.charges
    const cost = step < EMBER.vialUpgradeCosts.length ? EMBER.vialUpgradeCosts[step] : -1
    const maxed = Player.vialsMax[p] >= EMBER.vialMax || cost < 0
    this.hud.setUpgrade(atFire, maxed ? -1 : cost, Player.embers[p])
    if (!atFire || maxed) return
    if (!consumePress('KeyV')) return
    if (Player.embers[p] < cost) {
      sfx.deny()
      this.hud.showBanner('불티가 모자라다', `${Player.embers[p]} / ${cost}`, 1.2)
      return
    }
    Player.embers[p] -= cost
    Player.vialsMax[p] += 1
    Player.vials[p] = Player.vialsMax[p]
    sfx.bossPhase()
    this.cam.addTrauma(0.25)
    this.hud.showBanner('성수병 강화', `충전 ${Player.vialsMax[p]}개 · 불티 -${cost}`, 2.0)
    this.persistProgress()
  }

  /**
   * 무기 강화 — 화톳불에서 **B**.
   *
   * 성수병 강화(V)와 키를 나눈 이유: 둘은 성격이 반대인 선택이라 **한 화면에
   * 나란히 보여야** 합니다. 하나의 키로 돌려 쓰게 하면 "지금 뭐가 걸려 있지"를
   * 매번 확인해야 하고, 그 순간 선택이 아니라 조작이 됩니다.
   *   V = 지금 죽지 않기 (생존)
   *   B = 다음 구간을 빨리 넘기기 (공격)
   */
  private tryUpgradeWeapon(p: number, atFire: boolean): void {
    const weaponIndex = Loadout.weapon[p]
    const level = weaponLevel(p, weaponIndex)
    const cost = level < WEAPON_UPGRADE.costs.length ? WEAPON_UPGRADE.costs[level] : -1
    const stoneCost = level < WEAPON_UPGRADE.stoneCosts.length ? WEAPON_UPGRADE.stoneCosts[level] : -1
    const maxed = level >= WEAPON_UPGRADE.maxLevel || cost < 0
    this.hud.setWeaponUpgrade(
      atFire,
      maxed ? -1 : cost,
      Player.embers[p],
      level,
      stoneCost,
      Player.stones[p],
    )
    /**
     * **왜 강화가 안 됐는지를 게임이 직접 적습니다.**
     *
     * 밖에서 세 번 추측하고 세 번 틀렸습니다 — 소비처가 중간에 없어서 /
     * 성수병이 불티를 먹어서 / 적이 14m 안이라 막혀서. 마지막 것은
     * 누른 직후의 자리 상태가 `O→O` 로 찍혀 refute 되었습니다.
     *
     * 밖에서 보이는 것은 **결과(레벨이 안 올랐다)** 뿐이고, 그 앞의
     * 갈림길은 전부 이 함수 안에 있습니다. 그래서 갈림길마다 이름을
     * 남깁니다. 이 프로젝트에서 계속 확인한 규칙 그대로입니다 —
     * **사건은 사건이 일어난 자리에서 기록합니다.**
     */
    if (wasPressed('KeyB')) this.upgradeTries.seen++
    if (!atFire || maxed) {
      if (wasPressed('KeyB')) this.upgradeTries.notStation++
      return
    }
    if (!consumePress('KeyB')) return
    this.upgradeTries.consumed++
    /**
     * **정련석을 먼저 봅니다.**
     *
     * 불티가 모자란 것은 "더 싸우면 된다"이고, 정련석이 모자란 것은
     * **"더 찾아야 한다"** 입니다. 둘은 플레이어가 해야 할 일이 다르므로
     * 메시지도 달라야 합니다. 한 줄로 뭉뚱그리면 무엇을 하라는 건지 모릅니다.
     */
    if (Player.stones[p] < stoneCost) {
      this.upgradeTries.noStone++
      sfx.deny()
      this.hud.showBanner(
        '정련석이 모자라다',
        `${Player.stones[p]} / ${stoneCost} · 보물과 보스에서만 나온다`,
        1.6,
      )
      return
    }
    if (Player.embers[p] < cost) {
      this.upgradeTries.noEmber++
      sfx.deny()
      this.hud.showBanner('불티가 모자라다', `${Player.embers[p]} / ${cost}`, 1.2)
      return
    }
    this.upgradeTries.done++
    Player.stones[p] -= stoneCost
    Player.embers[p] -= cost
    setWeaponLevel(p, weaponIndex, level + 1)
    sfx.bossPhase()
    this.cam.addTrauma(0.25)
    this.hud.showBanner(
      `${weaponOf(p).name} +${level + 1}`,
      `피해 +${Math.round((level + 1) * WEAPON_UPGRADE.damagePerLevel * 100)}% · 불티 -${cost} · 정련석 -${stoneCost}`,
      2.0,
    )
    this.refreshLoadout()
    this.persistProgress()
  }

  private clearDrop(): void {
    if (this.dropVisual) {
      this.visuals.removeObject(this.dropVisual)
      this.dropVisual = null
    }
    this.drop = null
  }

  /** 떨어뜨린 자리에 닿으면 되찾습니다. */
  private collectDrop(p: number): void {
    if (!this.drop) return
    const d = Math.hypot(this.drop.x - Transform.x[p], this.drop.z - Transform.z[p])
    if (Math.abs(this.drop.y - Transform.y[p]) > 2.2) return
    if (d > TREASURE.pickupRadius + 0.6) return
    Player.embers[p] += this.drop.amount
    this.vfx.spawnDamage(this.drop.x, this.drop.y + 1.1, this.drop.z, this.drop.amount, { heal: true })
    this.vfx.spawnHitSpark(this.drop.x, this.drop.y + 0.8, this.drop.z, 1.6)
    sfx.pickup()
    this.hud.showBanner('불티를 되찾았다', `+${this.drop.amount}`, 1.4)
    this.clearDrop()
  }

  /** 죽었을 때 마지막으로 쉰 화톳불에서 다시 시작합니다. */
  private respawnAtBonfire(p: number): void {
    this.dropEmbers(p)
    Actor.state[p] = ActorState.Idle
    Actor.timer[p] = 0
    Health.hp[p] = Health.max[p]
    Health.invulnT[p] = 1.2
    Stamina.value[p] = Stamina.max[p]
    Player.vials[p] = Player.vialsMax[p]
    Status.snareT[p] = 0
    Transform.x[p] = Player.respawnX[p]
    Transform.z[p] = Player.respawnZ[p]
    if (this.terrain) Transform.y[p] = this.terrain.groundYAt(Transform.x[p], Transform.z[p])
    this.cam.snapTo(Transform.x[p], Transform.z[p])

    let revived = 0
    if (this.levelData && this.terrain) {
      const ids = enemyQuery.run()
      const doomed: number[] = []
      for (let i = 0; i < enemyQuery.count; i++) doomed.push(ids[i])
      // ⚠️ 지우기 **전에** 예약을 셉니다 — 엔티티가 사라지면 아무도 못 셉니다.
      noteChainsWiped()
      for (const e of doomed) {
        this.visuals.detach(e)
        destroyEntity(e)
      }
      const fresh = respawnLevelEnemies(this.levelData, this.terrain, this.defeatedBosses)
      for (const e of fresh) this.visuals.attach(e, Renderable.kind[e])
      revived = fresh.length
      resetAttackTokens()
    }
    const lesson = this.deathLesson()
    /**
     * 💀 **무엇에 죽었는지를 장부에도 남깁니다.**
     *
     * 지금까지 이 문장은 **화면에만** 떴습니다. 그래서 벤치는 `사망 2.0회`
     * 라고만 말하고 *"무엇에"* 는 한 번도 말한 적이 없습니다. 죽음은
     * 이 게임에서 가장 비싼 사건인데(진행이 되감기고, 보스 구간 측정이
     * 통째로 무너집니다) **가장 설명이 없는 사건**이었습니다.
     *
     * 이 저장소가 반복해서 배운 것: *"0이 나왔을 때 왜인지 말해 주지 않는
     * 계측기는 눈이 먼 채로 고치게 만든다."* 죽음도 같습니다.
     * 판정은 이미 `deathLesson` 이 내렸으니 여기서는 **모으기만** 합니다.
     */
    this.deathLog.push(lesson)
    this.hud.showBanner('다시 일어섰다', `${lesson} · 적 ${revived}마리 부활`, 3.6)
  }

  /** 🤸 색마다 **틀린 답으로 맞은 횟수**(구를 색이 아닌데 굴렀다). */
  private readonly wrongAnswers = new Map<number, number>()
  /** 🤸 이미 한 번 더 가르친 색 — 색당 평생 두 번까지입니다. */
  private readonly retaught = new Set<number>()
  /** 💀 이 판에서 죽은 순간마다의 사인. 벤치가 세어 줍니다. */
  private deathLog: string[] = []
  debugDeathLog(): string[] {
    return this.deathLog
  }

  /** 🤸 자동 검증용 — 색 학습 상태. */
  debugColorTeach(): { wrong: Record<number, number>; retaught: number[]; after: number } {
    const wrong: Record<number, number> = {}
    for (const [k, v] of this.wrongAnswers) wrong[k] = v
    return { wrong, retaught: [...this.retaught], after: RETEACH_AFTER }
  }

  /** 실험대 전용 — 화면이 지금 그리고 있는 인지 신호(visuals.ts 설계 노트). */
  debugAwareMarks(): { marks: number; noiseVisible: boolean; noiseRadius: number } {
    return this.visuals.debugAwareMarks()
  }

  /** 실험대 전용 — 강타 눈금이 실제로 그려진 자리(visuals.ts 설계 노트). */
  debugPoiseBars(): ReturnType<Visuals['debugPoiseBars']> {
    return this.visuals.debugPoiseBars()
  }

  debugPlayerEntity(): number {
    return this.playerEntity
  }

  debugSetVials(n: number): void {
    Player.vials[this.playerEntity] = Math.max(0, Math.min(255, n))
  }

  debugTeleport(x: number, z: number): void {
    const p = this.playerEntity
    Transform.x[p] = x
    Transform.z[p] = z
    if (this.terrain) Transform.y[p] = this.terrain.groundYAt(x, z)
    this.cam.snapTo(x, z)
  }

  /**
   * 지형의 **세로면**들을 화면 좌표로 돌려줍니다 — 레벨 문법 가독성 검증용.
   *
   * ⚠️ 프로브가 지형 데이터를 직접 읽고 카메라 행렬을 흉내 내면, 카메라
   *    각도를 바꾸는 날 **프로브만 옛 화면을 검사**하게 됩니다. 그래서 투영은
   *    게임이 합니다 — 실제로 그리는 그 카메라로.
   *
   * `drop` 은 이 면의 낙차(단 수)입니다. `MAX_CLIMB` 이하면 넘어갈 수 있는
   * 턱, 그보다 크면 벽입니다. **판정은 게임 규칙 그대로** 씁니다.
   */
  private readonly faceRay = new THREE.Raycaster()

  /**
   * 이 NDC 자리로 광선을 쏘아 **처음 맞는 것이 그 점인지** 봅니다.
   * 눈에 안 보이는 면·바닥은 가독성과 무관하므로 표본에서 뺍니다.
   */
  private faceVisible(ndcX: number, ndcY: number, wx: number, wy: number, wz: number): boolean {
    const t = this.terrain
    if (!t) return false
    this.faceRay.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.cam.camera)
    const hit = this.faceRay.intersectObject(t.group, true)[0]
    if (!hit) return false
    return hit.point.distanceTo(new THREE.Vector3(wx, wy, wz)) <= 0.35
  }

  /**
   * 월드 한 점의 화면 좌표.
   *
   * 실루엣을 재려고 만들었습니다. 처음엔 화면 전체를 빈 화면과 빼서
   * "달라진 픽셀"을 적이라고 봤는데, **HUD 의 「남은 적」 숫자가 같이
   * 바뀌면서** 테두리 상자가 화면 절반으로 부풀었습니다. 그 상자로
   * 정규화하니 서로 다른 두 적이 IoU 1.00 으로 나왔습니다 — 적이 아니라
   * 글자를 견주고 있었던 것입니다. 잴 곳을 좁히려면 좌표가 필요합니다.
   */
  /**
   * 🩸 예고가 도는 동안 **공정함의 재료**를 모읍니다.
   *
   * 매 프레임, 예고 단계에 있는 적마다 두 가지를 시뮬레이션 시간으로 더합니다:
   *
   *   · **보였는가** — 그 적이 화면 안에 있었는가. 화면 밖에서 날아온 한 대는
   *     플레이어가 *"내가 못 봤네"* 라고 말하게 되는 바로 그 경우입니다.
   *   · **답할 수 있었는가** — 그 순간 구르기를 **시작할 수 있었는가**.
   *     예고를 다 봤어도 후딜·경직·기력 때문에 손이 묶여 있었으면,
   *     본 것은 아무 소용이 없습니다.
   *
   * ⚠️ **벽시계가 아니라 시뮬레이션 시간(`time.dt`)으로 셉니다.** 이 컨테이너는
   *    GPU가 없어 프레임이 들쭉날쭉하고, 히트스톱 중에는 게임이 아예 멈춥니다.
   *    벽시계로 세면 게임이 아니라 컨테이너를 재게 됩니다.
   */
  private watchTelegraphs(p: number): void {
    const dt = time.dt
    /**
     * 🎯 **구르기가 시작된 순간**을 한 프레임에 한 번만 잡습니다.
     *
     * 상태가 Dodge 로 **올라서는 모서리**를 봅니다. 상태만 보면 구르는
     * 0.42초 동안 매 프레임이 "시도"가 되어, 한 번 구른 것이 스무 번으로
     * 세어집니다. **상태의 전이를 세야지 값을 세면 안 됩니다** — 이
     * 저장소가 연계 장부에서 이미 배운 것입니다.
     */
    const rolling = Actor.state[p] === ActorState.Dodge
    const rollEdge = rolling && !this.wasRolling
    this.wasRolling = rolling
    const ids = enemyQuery.run()
    const live = new Set<number>()
    const windingNow = new Set<number>()
    for (let i = 0; i < enemyQuery.count; i++) {
      const e = ids[i]
      live.add(e)
      const winding =
        Actor.state[e] === ActorState.Attack && Actor.phase[e] === AttackPhase.Windup
      if (!winding) continue
      windingNow.add(e)
      const id = attackAt(Enemy.kind[e], Enemy.attackIndex[e]).id
      let rec = this.hurtWatch.get(e)
      /**
       * 패턴이 바뀌면 **새 예고**입니다. 같은 적이 연달아 휘두를 때 앞
       * 예고의 시간이 뒤로 넘어가면, 없던 여유를 있는 것처럼 적게 됩니다.
       *
       * ⚠️ **패턴이 안 바뀌어도 새 예고입니다.** 예전엔 `rec.id !== id` 만
       *    봤습니다. 그래서 잡몹이 `grunt_sweep` 을 연달아 세 번 휘두르면
       *    **첫 예고의 기록이 그대로 살아남아** 시간이 계속 쌓였습니다.
       *    벤치가 그 결과를 그대로 찍었습니다:
       *
       *        dragger_hook 예고 **18.466초** · 구른 뒤 **9.867초**
       *        grunt_sweep  예고 **10.733초**
       *
       *    잡몹 예고는 0.6~2초입니다. 18초짜리 예고는 없습니다. `seen`·`free`
       *    도 같이 부풀어서, 사실은 촉박했던 한 대가 *"볼 시간도 답할 시간도
       *    넉넉했다"* 로 적혔고, `구른 뒤 9.867초` 는 **몇 번 전 예고 때 구른
       *    것**입니다. 그 위에서 `일찍` 을 세고 있었습니다.
       *
       *    그래서 **휘두름이 올라서는 모서리**를 함께 봅니다. 값이 아니라
       *    전이를 세는 것 — 바로 위 구르기 감지와 같은 규칙입니다.
       */
      const freshWind = !this.windingLast.has(e)
      if (!rec || rec.id !== id || freshWind) {
        rec = {
          id,
          intent: attackAt(Enemy.kind[e], Enemy.attackIndex[e]).intent,
          start: time.simElapsed,
          seen: 0,
          cueSeen: 0,
          free: 0,
          blocked: {},
          lastTryT: -1,
          tries: 0,
          expected: Enemy.windupLen[e] > 0 ? Enemy.windupLen[e] : Actor.timer[e],
          tryTarget: -1,
          startX: Transform.x[p],
          startZ: Transform.z[p],
          distStart: Math.hypot(Transform.x[e] - Transform.x[p], Transform.z[e] - Transform.z[p]),
        }
        this.hurtWatch.set(e, rec)
      }
      if (this.onScreen(e)) rec.seen += dt
      /**
       * 🖥 **몸 말고 지면 예고도 따로 셉니다.** 근거는 `cueOnScreen` 주석.
       * 둘을 한 칸에 담으면 "고칠 곳이 게임인가 계측기인가"가 안 갈립니다.
       */
      if (this.cueOnScreen(e)) rec.cueSeen += dt
      const why = this.answerBlock(p)
      if (why === '') rec.free += dt
      else rec.blocked[why] = (rec.blocked[why] ?? 0) + dt
      /**
       * 🎯 **답을 눌렀는가**를 예고마다 따로 셉니다.
       *
       * `this.answerStartT` 는 한 프레임에 한 번만 갱신되는 **전역 사실**
       * (구르기가 시작된 순간)이고, 여기서는 *"그 순간이 이 예고 뒤였나"*
       * 만 봅니다. 적마다 따로 감지하면 같은 구르기를 다섯 번 세게 됩니다.
       */
      if (this.answerStartT > rec.start && this.answerStartT > rec.lastTryT) {
        rec.lastTryT = this.answerStartT
        rec.tries++
        // 그 구르기가 **누구를 향한 것이었는지**도 같이 물려받습니다.
        rec.tryTarget = this.answerTarget
      }
    }
    /**
     * 🎯 **구른 순간, 그것이 누구를 향한 것이었는가.**
     *
     * 다대일에서 판정을 가르는 사실입니다. 봇이든 사람이든 **가장 먼저
     * 떨어지는 한 대**에 맞춰 구르는데, 그 사이 다른 적의 한 대가 뒤이어
     * 닿으면 같은 구르기로는 못 넘깁니다. 그걸 *"일찍 굴렀다"* 로 적으면
     * **무적 창이 짧다**는 결론이 나오는데 틀린 처방입니다 — 고칠 곳은
     * 창이 아니라 **적들의 한 대가 겹쳐 오는 간격**입니다(공격 토큰의 몫).
     *
     * 의도를 짐작하지 않습니다. *"구른 그 순간 가장 임박했던 예고의
     * 주인"* 은 짐작이 아니라 **사실**입니다.
     */
    if (rollEdge) {
      this.answerStartT = time.simElapsed
      let best = -1
      let bestT = Infinity
      for (const e of windingNow) {
        if (Actor.timer[e] < bestT) {
          bestT = Actor.timer[e]
          best = e
        }
      }
      this.answerTarget = best
    }
    // 죽거나 사라진 적의 기록은 버립니다 — 엔티티 번호는 재사용됩니다.
    for (const e of [...this.hurtWatch.keys()]) if (!live.has(e)) this.hurtWatch.delete(e)
    this.windingLast = windingNow
  }

  /**
   * ── 🖥 그 적의 **지면 예고 부채꼴**이 화면에 걸쳐 있는가 ───────────
   *
   * `onScreen` 은 **몸**을 봅니다. 그런데 이 게임에서 위험을 말하는 것은
   * 몸이 아니라 지면에 뜨는 부채꼴입니다(render/visuals.ts). 부채꼴은
   * 적에게서 **플레이어 쪽으로** 뻗으므로, 적이 화면 밖이어도 그 표시는
   * 내 발치에 걸쳐 있을 수 있습니다.
   *
   * 이 구분이 왜 필요한가. 화면은 세로 22m(±11m)인데 사거리 12m 짜리
   * 공격이 둘 있습니다(🏹 궁수 · 🟣 끄는 자). 화면 세로 방향에서 오면
   * 그 몸은 **원리적으로** 화면 밖입니다. 그걸 전부 *"못 봤다"* 로 적으면
   * 두 가지가 한 칸에 뭉칩니다:
   *
   *   · 몸도 표시도 안 보였다 → 정말 못 봤습니다. **게임을 고칠 일.**
   *   · 몸은 안 보였지만 표시는 보였다 → 알 수 있었습니다. **계측기를 고칠 일.**
   *
   * 처방이 정반대인 둘을 한 칸에 담아 두면, 이 저장소에서 늘 그랬듯이
   * 엉뚱한 쪽을 고치러 갑니다.
   *
   * 윤곽을 **여러 점**으로 뜹니다. 한 점(부채꼴 중심 같은)만 보면 그 점이
   * 하필 화면 밖일 때 "안 보인다"고 답하는데, 실제로는 나머지가 다
   * 보이는 경우가 있습니다. 점 하나라도 화면 안이면 표시는 보인 것입니다.
   */
  private readonly cueProbe = new THREE.Vector3()
  private cueOnScreen(e: number): boolean {
    const def = attackAt(Enemy.kind[e], Enemy.attackIndex[e])
    const R = telegraphRadius(def)
    const half = (def.arcDeg * Math.PI) / 360
    const face = Transform.rotY[e]
    const y = Transform.y[e] + 0.04
    for (const s of [-1, 0, 1]) {
      const a = face + s * half
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const v = this.cueProbe
          .set(
            Transform.x[e] + Math.sin(a) * R * t,
            y,
            Transform.z[e] + Math.cos(a) * R * t,
          )
          .project(this.cam.camera)
        if (Number.isFinite(v.x) && v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) return true
      }
    }
    return false
  }

  /** 그 적이 지금 화면 안에 있는가 (몸 가운데 높이 기준). */
  private onScreen(e: number): boolean {
    const v = new THREE.Vector3(
      Transform.x[e],
      Transform.y[e] + Body.height[e] * 0.5,
      Transform.z[e],
    ).project(this.cam.camera)
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return false
    // z > 1 이면 카메라 뒤(또는 far 밖)입니다. 화면 좌표만 보면 뒤에 있는 적도 통과합니다.
    return v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1
  }

  /**
   * 지금 이 프레임에 **구르기를 시작할 수 있는가.**
   *
   * ⚠️ **여기서 판단하지 않습니다.** 예전에는 이 자리에 조건을 "그대로 옮겨
   *    적어" 두었는데, 옮겨 적은 것은 **장부가 둘**이라는 뜻입니다. 실제로
   *    구르기 문턱을 바꾼 날(balance.ts `staminaExhaustDelay`) 시스템만
   *    바뀌고 이 장부는 옛 규칙을 계속 세었을 것이고, 그러면 *"맞은 이유:
   *    stamina"* 가 **거짓말**이 됩니다 — 게임은 내줬는데 장부는 막혔다고
   *    적는 것이니까요. 판단은 playerControl `dodgeBlock` 한 곳에 있습니다.
   *
   * 순서가 곧 처방이라는 규칙(사망·경직·마심 → 쿨다운 → 기력)도 그 함수가
   * 갖고 있습니다. 내가 기력을 다 쓴 것과 맞아서 굳은 것은 **책임이 반대**라,
   * 한 칸으로 뭉치면 39%가 나와도 어디를 고칠지 알 수 없습니다.
   */
  private answerBlock(p: number): string {
    return dodgeBlock(p)
  }

  /**
   * 🩸 맞은 한 대를 장부에 적습니다.
   *
   * 판정의 **순서가 곧 뜻**입니다. 둘 다 나쁠 수 있으므로 더 앞선 실패를
   * 적습니다: 예고 자체가 짧았으면 보이든 말든 소용이 없고, 안 보였으면
   * 손이 자유로웠는지는 물을 필요가 없습니다.
   *
   *   tooFast — 예고가 반응 시간보다 짧았다 (원리적으로 못 읽음)
   *   unseen  — 예고는 있었는데 **화면 밖**이었다 ("내가 못 봤네")
   *   locked  — 봤지만 **손이 묶여** 있었다 ("손쓸 방법이 없었네")
   *   fair    — 볼 수 있었고 답할 수 있었다 ("내가 못 피했네")
   *
   * ⚠️ 기록이 없는 한 대는 **조용히 버리지 않고** `unknown` 으로 남깁니다.
   *    이 저장소에서 가장 비쌌던 고장이 늘 "아무 말도 안 하는 계측기"였습니다.
   */
  private noteHurt(attacker: number, attackId: string, damage: number): void {
    const rec = this.hurtWatch.get(attacker)
    const budget = reactionTime(this.colorCount())
    if (!rec) {
      this.hurtLedger.push({
        attackId: attackId || '?',
        intent: -1,
        telegraph: 0,
        seen: 0,
        cueSeen: 0,
        free: 0,
        damage,
        verdict: 'unknown',
              /** 예고 기록 자체가 없으니 잰 거리도 없습니다. */
        sinceTry: -1,
        expected: 0,
        walked: 0,
        spender: '',
        moved: 0,
        color: '?',
        answer: '?',
      })
      return
    }
    const telegraph = time.simElapsed - rec.start
    // 묶여 있던 이유 중 **가장 오래 묶은 것**을 붙입니다.
    const worst = Object.entries(rec.blocked).sort((x, y) => y[1] - x[1])[0]
    /**
     * ── 🎯 **"못 피함"을 쪼갭니다 — 처방이 셋으로 갈립니다** ────────────
     *
     * `fair` 는 *"예고도 길었고, 봤고, 손도 비어 있었는데 맞았다"* 입니다.
     * 이 게임의 합격 기준(*"내가 못 봤네"가 아니라 "내가 못 피했네"*)에서
     * 목표로 하는 바로 그 한 대입니다. 그래서 지금까지 더 안 캤습니다.
     *
     * 그런데 벤치가 이렇게 찍었습니다:
     *
     *     맞은 이유 50대 · 못 피함 40(80%) · 손이 묶임 stamina 10
     *
     * 40대가 **한 칸에 뭉쳐** 있습니다. 그 안에는 완전히 다른 세 가지가
     * 섞여 있고, 고칠 곳이 각각 다릅니다:
     *
     *   · **안 눌렀다**   → 위험을 못 읽은 것. 예고의 *의미*가 안 읽히거나,
     *                      욕심낼 값이 너무 싼 것 (보상 설계 문제)
     *   · **일찍 굴렀다** → 무적이 이미 끝난 뒤 맞음. 예고 길이 대비
     *                      무적 창(0.06~0.3초)이 짧은 것 (창 문제)
     *   · **늦게 굴렀다** → 무적이 켜지기 전에 맞음. 반응 예산이나
     *                      선입력이 부족한 것 (입력 문제)
     *
     * 소울류가 이 셋을 절대 같이 다루지 않습니다. 세키로에서 "안 눌렀다"는
     * 패턴을 외우게 하는 문제이고, "타이밍이 어긋났다"는 창을 손보는
     * 문제입니다. 뭉쳐 두면 창을 넓혀야 할 때 보상을 만지게 됩니다.
     *
     * ⚠️ 이 칸을 만들기 전까지는 40대 전부를 *"봇이 욕심을 부린다"* 고
     *    믿고 있었습니다. **근거는 없었습니다.** 숫자가 한 칸뿐이었으니까요.
     */
    const iFrom = PLAYER_CFG.dodge.iFrameStart
    const iTo = PLAYER_CFG.dodge.iFrameEnd
    const sinceTry = rec.tries > 0 ? time.simElapsed - rec.lastTryT : -1
    const missed =
      rec.tries === 0
        ? 'fair:안누름'
        : // 다른 적의 한 대에 맞춰 구른 것이라면 이건 창 이야기가 아닙니다.
          rec.tryTarget >= 0 && rec.tryTarget !== attacker
          ? 'fair:다른적'
          : sinceTry >= iTo
            ? 'fair:일찍'
            : sinceTry < iFrom
              ? 'fair:늦게'
              : /**
                 * 무적 창 **안**인데 맞았다면 회피로 못 넘기는 한 대입니다.
                 *
                 * ⚠️ 부등호가 `>` 였을 때 이 칸에 `구른 뒤 0.3초` 짜리가
                 *    쌓였습니다 — 무적 끝값과 **정확히 같은 값**입니다.
                 *    무적이 막 닫힌 자리를 *"막을 수 없는 공격"* 이라고
                 *    적으면, 있지도 않은 무적 관통 공격을 찾으러 갑니다.
                 *    끝값은 `일찍` 쪽입니다(창이 이미 닫혔으니까).
                 *
                 *    그래서 이 칸은 이제 **엄밀히 창 안**인 경우만 남습니다.
                 *    평소에는 0이어야 하고, 0이 아니면 그건 밸런스가 아니라
                 *    **무적 프레임이 새고 있다**는 뜻입니다. 남겨 두는 이유가
                 *    그것입니다 — 이 칸은 눈금이 아니라 **경보기**입니다.
                 */
                'fair:못막는공격'
    const verdict =
      telegraph < budget
        ? 'tooFast'
        : rec.seen < budget
          ? /**
             * ── 🖥 **못 본 한 대를 둘로 가릅니다** ──────────────────────
             *
             *   · `unseen:아무것도` — 몸도 지면 예고도 화면 밖이었습니다.
             *     플레이어에게 아무 신호도 안 갔습니다. **게임을 고칠 일.**
             *   · `unseen:몸만`     — 몸은 화면 밖이었지만 지면 예고는
             *     발치에 걸쳐 있었습니다. 색도 방향도 보였으니 알 수는
             *     있었습니다. **여기는 `unseen` 이 부풀어 있던 것.**
             *
             * 이 게임은 세로 22m 화면에 사거리 12m 공격을 둘 갖고 있어서
             * (🏹 궁수 · 🟣 끄는 자) 뒤엣것이 **원리적으로 자주** 생깁니다.
             * 둘을 한 칸에 담아 두면 "화면 밖에서 왔다" 를 보고 사거리를
             * 깎으러 가는데, 정작 표시는 보이고 있었을 수 있습니다.
             */
            rec.cueSeen < budget
            ? 'unseen:아무것도'
            : 'unseen:몸만'
          : rec.free < budget
            ? `locked:${worst ? worst[0] : '?'}`
            : missed
    /**
     * 🤸 **틀린 답을 셉니다** — 구를 색이 아닌데 굴러서 맞은 한 대.
     *
     * `tries > 0` 은 이 예고 동안 실제로 구르기를 시작했다는 뜻입니다
     * (상태의 전이로 잡습니다). 그 색의 정답이 구르기가 아니라면
     * **틀린 답을 낸 것**이고, 그게 되풀이되면 위에서 한 번 더 가르칩니다.
     */
    if (rec.tries > 0 && rec.intent >= 0 && !ANSWER_IS_DODGE[rec.intent as AttackIntent]) {
      this.wrongAnswers.set(rec.intent, (this.wrongAnswers.get(rec.intent) ?? 0) + 1)
    }
    this.hurtLedger.push({
      attackId: rec.id,
      intent: rec.intent,
      telegraph: Number(telegraph.toFixed(3)),
      seen: Number(rec.seen.toFixed(3)),
      cueSeen: Number(rec.cueSeen.toFixed(3)),
      free: Number(rec.free.toFixed(3)),
      damage,
      verdict,
      /**
       * 🎯 구른 지 얼마 만에 맞았는가(초). -1 = 한 번도 안 굴렀음.
       * 무적 창(iFrameStart~End)과 나란히 놓고 보면 *"얼마나 빗나갔는지"*
       * 가 바로 보입니다 — 판정만 내고 거리를 안 주면 얼마나 손볼지를
       * 다시 짐작하게 됩니다.
       */
      sinceTry: Number(sinceTry.toFixed(3)),
      /** 이 휘두름이 약속했던 예고 길이(초). `telegraph` 와 크게 벌어지면 계측기 고장. */
      expected: Number(rec.expected.toFixed(3)),
      /**
       * 🎨 **이 색이 요구한 답** — 게임이 적어 보냅니다.
       *
       * 4색은 답이 서로 다릅니다(🔴 구르기 · 🟡 걸어서 이탈 · 🔵 무적
       * 프레임 · 🟣 거리 두기 · 🟢 정면에서 때려라). 그런데 장부는
       * *"굴렀는가"* 만 물었습니다. 🟡 광역을 안 구른 것은 **틀린 게
       * 아니라 정답**일 수 있고, 그런데도 맞았다면 고칠 곳은 구르기가
       * 아니라 *"어디로 빠져나가야 하는지가 안 보인다"* 입니다.
       *
       * 재는 쪽이 색과 답을 다시 적지 않도록 **여기서 붙여 보냅니다** —
       * 색을 하나 늘리는 날 프로브만 옛 표를 들고 있지 않게.
       */
      /**
       * 🚶 예고가 뜬 뒤 **내가 실제로 움직인 거리**(m).
       *
       * ── 왜 따로 재는가 (제가 쓰던 눈금이 두 가지를 더하고 있었습니다) ──
       * 아래 `moved` 는 **적과의 거리 변화**입니다. 그런데 **적도 움직입니다.**
       * 내가 열심히 걸어 나가도 적이 따라오면 거리가 그대로라
       * `제자리` 로 찍히고, 그러면 *"안 걸었다 → 예고의 뜻이 안 읽힌다"*
       * 라는 **정반대 처방**이 나옵니다. 🟡 광역을 두 라운드 동안 그
       * 눈금 위에서 판단했습니다.
       *
       * 바로 앞 라운드에서 배운 것 그대로입니다:
       * **재는 기준점이 움직이면 그 값은 두 가지를 더한 값입니다.**
       * 그래서 움직이지 않는 기준(내가 서 있던 자리)에서 **내 발이 한
       * 일만** 따로 잽니다. 둘을 나란히 놓아야 *"걸었는데 적이 따라왔다"* 와
       * *"아예 안 걸었다"* 가 갈립니다.
       */
      walked: Number(
        Math.hypot(
          Transform.x[this.playerEntity] - rec.startX,
          Transform.z[this.playerEntity] - rec.startZ,
        ).toFixed(2),
      ),
      /**
       * 🚶 예고가 뜬 뒤 **적과의 거리가 얼마나 벌어졌는가**(m). 음수면 다가감.
       * `walked` 와 나란히 봐야 뜻이 생깁니다(위 설계 노트).
       */
      moved: Number(
        (
          Math.hypot(
            Transform.x[attacker] - Transform.x[this.playerEntity],
            Transform.z[attacker] - Transform.z[this.playerEntity],
          ) - rec.distStart
        ).toFixed(2),
      ),
      /**
       * 🫁 기력에 묶여 맞은 한 대만 **누가 썼는지**를 적습니다.
       * 다른 판정에서는 뜻이 없으므로 빈 칸으로 둡니다 — 안 쓰는 축에
       * 값을 채우면 그건 정보가 아니라 소음입니다.
       */
      spender: verdict === 'locked:stamina' ? readLastSpender().what : '',
      color: rec.intent >= 0 ? `${INTENT_EMOJI[rec.intent as AttackIntent]}${INTENT_NAME[rec.intent as AttackIntent]}` : '?',
      answer: rec.intent >= 0 ? INTENT_ANSWER[rec.intent as AttackIntent] : '?',
    })
  }

  /**
   * 🩸 **무엇에 쓰러졌고, 왜 못 막았는가** — 죽은 순간 플레이어에게 줍니다.
   *
   * ── 왜 넣었나 ──────────────────────────────────────────────────
   * 이 게임의 합격 기준은 *"죽었을 때 '내가 못 봤네'가 아니라 '내가 못
   * 피했네'라고 말해야 한다"* 입니다. 그런데 지금까지 죽으면 화면에
   * **`다시 일어섰다 · 적 12마리 부활`** 만 떴습니다. 무엇에 죽었는지도,
   * 왜 못 피했는지도 안 알려 주면서 *"내가 못 피했네"* 라고 말하기를
   * 기대한 셈입니다. **말할 재료를 안 주고 대사를 기대한 것**입니다.
   *
   * 하데스는 죽으면 무엇에게 죽었는지 보여 줍니다. 리터널은 사인을 적어
   * 줍니다. 소울류는 안 보여 주는 대신 **적이 하나뿐이고 예고가 크다**는
   * 것으로 대신합니다 — 우리는 다대일이라 그 방법을 쓸 수 없습니다.
   *
   * 그리고 우리는 한 걸음 더 갈 수 있습니다. 장부가 이미 **공정했는지까지**
   * 판정해 두었으므로, "무엇에 죽었다"가 아니라 **"무엇을, 왜 못 막았다"**
   * 를 말할 수 있습니다. 그게 다음 판에 바꿀 행동을 지목합니다.
   *
   * ⚠️ 장부가 비었으면 **지어내지 않습니다.** 원인을 모를 때 그럴듯한 문장을
   *    만들면, 플레이어는 틀린 교훈을 배웁니다.
   */
  private deathLesson(): string {
    const last = this.hurtLedger[this.hurtLedger.length - 1]
    if (!last) return '화톳불에서 부활'
    if (last.verdict === 'fall') return '발을 헛디뎠다 — 떨어졌다'

    const i = last.intent as AttackIntent
    const what = last.intent >= 0 ? `${INTENT_EMOJI[i]} ${INTENT_NAME[i]}` : '알 수 없는 공격'
    /**
     * **정답을 같이 적습니다.** "무엇에 죽었다"만으로는 다음 판이 안 바뀝니다.
     * 이 게임이 파는 것은 *색을 읽고 그 색의 답을 내는 것*이므로, 죽음
     * 화면은 그 답을 짚어 주는 자리이기도 합니다.
     */
    const answer = last.intent >= 0 ? ` · 정답은 ${INTENT_ANSWER[i]}` : ''
    const tel = last.telegraph.toFixed(1)
    /**
     * 판정마다 **다음 판에 바꿀 행동**이 다릅니다. 그래서 문장도 다릅니다 —
     * 같은 말을 돌려 쓰면 죽음이 가르치는 것이 없어집니다.
     */
    /**
     * 🎯 **갈라진 판정이 여기서도 다른 문장이 됩니다.**
     *
     * 장부를 셋으로 쪼개 놓고 죽음 화면만 *"예고를 다 봤다"* 로 두면,
     * 안에서만 아는 사실이 됩니다. 플레이어가 다음 판에 바꿀 행동은
     * 셋이 서로 다릅니다 — 누를지 말지 / 조금 늦게 / 조금 빨리.
     * 소울류가 죽음에서 가르치는 것이 정확히 이 한 문장입니다.
     */
    const off = last.sinceTry >= 0 ? last.sinceTry.toFixed(2) : ''
    const why =
      last.verdict === 'fair:안누름'
        ? /**
           * ⚠️ **여기서 "구르기"라고 말하면 안 됩니다.**
           *
           * 판정을 색별로 가르고 나서 벤치에 이런 줄이 찍혔습니다:
           *
           *     🟡 광역에 쓰러졌다 — 예고 1.3초를 다 봤는데 **구르지 않았다**
           *                        · 정답은 **걸어서 이탈**
           *
           * 한 문장 안에서 *"구르지 않았다"* 고 나무라고 *"정답은 걸어서
           * 이탈"* 이라고 말합니다. **앞뒤가 모순입니다.** 죽음 화면은
           * 초보자가 다음 판에 할 일을 배우는 자리인데, 여기서 틀린 동작을
           * 지목하면 그 사람은 🟡 앞에서 계속 구르게 됩니다.
           *
           * `안누름` 은 원래 *"구르기를 안 눌렀다"* 를 뜻했지만, 그건
           * **재는 쪽의 말**입니다. 플레이어에게는 *"이 색의 답을 안 냈다"*
           * 가 맞고, 그 답이 무엇인지는 바로 뒤에 이미 붙습니다.
           */
          `예고 ${tel}초를 다 봤는데 답을 내지 않았다`
        : last.verdict === 'fair:다른적'
          ? `다른 적의 한 대를 피하느라 이건 못 피했다 — 둘을 한 번에는 못 넘긴다`
        : last.verdict === 'fair:일찍'
          ? `${off}초 전에 굴러서 무적이 이미 끝나 있었다 — 조금 늦게`
          : last.verdict === 'fair:늦게'
            ? `구르는 순간 이미 맞았다 — 조금 빨리`
            : last.verdict === 'fair:못막는공격'
              ? `구르기로는 넘길 수 없는 한 대였다`
              : last.verdict === 'fair'
                ? `예고 ${tel}초를 다 봤다`
                : last.verdict === 'locked:stamina'
          ? `예고는 봤지만 기력이 없어 구르지 못했다`
          : last.verdict === 'locked:stagger'
            ? `앞의 한 대에 굳어 있었다`
            : last.verdict === 'locked:cooldown'
              ? `방금 굴러서 아직 구를 수 없었다`
              : last.verdict === 'locked:drink'
                ? `성수병을 마시는 중이었다`
                : last.verdict === 'unseen:아무것도'
                  ? `몸도 예고도 화면 밖이었다`
                  : last.verdict === 'unseen:몸만'
                  ? `몸은 화면 밖이었다 (예고는 발치에 보였다)`
                  : last.verdict === 'tooFast'
                    ? `예고가 ${tel}초뿐이었다`
                    : '원인을 기록하지 못했다'
    return `${what}에 쓰러졌다 — ${why}${answer}`
  }

  /** 🩸 장부를 그대로 내보냅니다 — 판정은 이미 게임이 내렸습니다. */
  debugHurtLedger(): typeof this.hurtLedger {
    return this.hurtLedger
  }

  /** 실제로 쓰이는 예고 색 가짓수 — 반응 예산이 여기에 달려 있습니다. */
  private colorCount(): number {
    if (this.colorCountCache === 0) {
      const seen = new Set<number>()
      for (const key of Object.keys(ENEMY_DEFS)) {
        for (const a of attacksFor(Number(key) as EnemyKind)) seen.add(a.intent)
      }
      this.colorCountCache = seen.size
    }
    return this.colorCountCache
  }
  private colorCountCache = 0

  debugScreenPos(x: number, y: number, z: number): { sx: number; sy: number } | null {
    const el = this.renderer.domElement
    const v = new THREE.Vector3(x, y, z).project(this.cam.camera)
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null
    return {
      sx: Math.round(((v.x + 1) / 2) * el.clientWidth),
      sy: Math.round(((1 - v.y) / 2) * el.clientHeight),
    }
  }

  /** 구역 목록 — 프로브가 레벨 JSON 을 따로 읽지 않도록. */
  debugRegionList(): {
    name: string
    x0: number
    x1: number
    z0: number
    z1: number
    x: number
    z: number
    tint: [number, number, number] | null
  }[] {
    const t = this.terrain
    if (!t) return []
    const { w, h } = t.level
    return this.regions.map((r) => {
      const c = cellToWorld(Math.round((r.x0 + r.x1) / 2), Math.round((r.z0 + r.z1) / 2), w, h)
      return { ...r, x: c.x, z: c.z, tint: r.tint ?? null }
    })
  }

  /**
   * 지금 레벨에 서 있는 **적들을 구역과 묶어서** 돌려줍니다.
   *
   * ── 왜 게임이 묶어 주는가 ────────────────────────────────────────
   * 프로브가 레벨 JSON 을 읽어 구역 사각형을 **다시 그리면**, 구역을 옮기는
   * 날 프로브만 옛 경계로 검사합니다. 게다가 격자↔월드 변환(CELL_SIZE)을
   * 프로브에 적어야 하는데, 그 값이 바뀌면 조용히 엉뚱한 구역을 셉니다.
   * 실제로 이 숫자를 손으로 내다가 셀 크기를 1.5 로 잘못 잡아 **적의 44%가
   * "구역 밖"** 으로 찍힌 적이 있습니다.
   *
   * 그래서 게임이 **자기가 쓰는 그 사각형으로** 판정해서 냅니다.
   */
  debugLevelFoes(): { kind: string; x: number; z: number; region: string; level: number }[] {
    const t = this.terrain
    if (!t) return []
    const { w, h } = t.level
    const out: { kind: string; x: number; z: number; region: string; level: number }[] = []
    for (const e of t.level.entities) {
      // 적인지 아닌지는 게임의 표로 가립니다(보물·모루·화톳불이 섞이지 않게).
      if (kindFromId(e.kind) === null) continue
      const cell = worldToCell(e.x, e.z, w, h)
      const r = this.regions.find(
        (g) => cell.cx >= g.x0 && cell.cx <= g.x1 && cell.cz >= g.z0 && cell.cz <= g.z1,
      )
      /**
       * 서 있는 **지형 층**. 소울류·NRFTW 가 쓰는 수직 배치(위에서 아래를
       * 쏘는 궁수)가 실제로 성립하는지 재려면 이 값이 필요합니다 —
       * 좌표만으로는 "높은 곳"인지 알 수 없습니다.
       */
      out.push({ kind: e.kind, x: e.x, z: e.z, region: r?.name ?? '', level: t.levelAtWorld(e.x, e.z) })
    }
    return out
  }

  /**
   * 지금 화면에 보이는 **바닥 윗면**들을 구역 이름과 함께 돌려줍니다.
   *
   * `debugFaceSamples` 와 같은 이유로 게임이 투영합니다 — 구역 판정도
   * 게임이 쓰는 그 사각형 그대로여야, 구역을 옮겼을 때 프로브만 옛
   * 경계로 검사하는 일이 안 생깁니다.
   */
  debugGroundSamples(): { sx: number; sy: number; region: string }[] {
    const t = this.terrain
    if (!t) return []
    const cam = this.cam.camera
    const el = this.renderer.domElement
    const { w, h } = t.level
    const originX = (-w / 2) * CELL_SIZE
    const originZ = (-h / 2) * CELL_SIZE
    const out: { sx: number; sy: number; region: string }[] = []
    const v = new THREE.Vector3()
    for (let cz = 0; cz < h; cz++) {
      for (let cx = 0; cx < w; cx++) {
        const lvl = t.levelAtCell(cx, cz)
        if (lvl === VOID) continue
        const region = this.regions.find(
          (r) => cx >= r.x0 && cx <= r.x1 && cz >= r.z0 && cz <= r.z1,
        )
        if (!region) continue
        const wx = originX + (cx + 0.5) * CELL_SIZE
        const wy = lvl * HEIGHT_STEP
        const wz = originZ + (cz + 0.5) * CELL_SIZE
        v.set(wx, wy, wz).project(cam)
        if (v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue
        if (!this.faceVisible(v.x, v.y, wx, wy, wz)) continue
        out.push({
          sx: Math.round(((v.x + 1) / 2) * el.clientWidth),
          sy: Math.round(((1 - v.y) / 2) * el.clientHeight),
          region: region.name,
        })
      }
    }
    return out
  }

  debugFaceSamples(): { sx: number; sy: number; drop: number; climbable: boolean }[] {
    const t = this.terrain
    if (!t) return []
    const cam = this.cam.camera
    const el = this.renderer.domElement
    const { w, h } = t.level
    const originX = (-w / 2) * CELL_SIZE
    const originZ = (-h / 2) * CELL_SIZE
    const out: { sx: number; sy: number; drop: number; climbable: boolean }[] = []
    const v = new THREE.Vector3()
    for (let cz = 0; cz < h; cz++) {
      for (let cx = 0; cx < w; cx++) {
        const lvl = t.levelAtCell(cx, cz)
        if (lvl === VOID) continue
        /**
         * **카메라를 향한 면만** 봅니다. 등진 면은 자기 지형에 가려서
         * 화면에 없고, 그걸 표본에 넣으면 엉뚱한 픽셀을 재게 됩니다.
         * 카메라가 +x·+z 쪽에서 내려다보므로 그 두 방향 면이 보입니다.
         */
        for (const [nx, nz, dx, dz] of [
          [cx + 1, cz, 1, 0],
          [cx, cz + 1, 0, 1],
        ] as const) {
          const nLvl = t.levelAtCell(nx, nz)
          if (nLvl !== VOID && nLvl >= lvl) continue
          const drop = nLvl === VOID ? 99 : lvl - nLvl
          // 면의 한가운데 — 위아래 가장자리는 이웃 면과 섞여서 못 씁니다.
          const midY = (lvl * HEIGHT_STEP + (nLvl === VOID ? lvl * HEIGHT_STEP - 5 : nLvl * HEIGHT_STEP)) / 2
          v.set(
            originX + (cx + 0.5 + dx * 0.5) * CELL_SIZE,
            midY,
            originZ + (cz + 0.5 + dz * 0.5) * CELL_SIZE,
          )
          const wx = v.x
          const wy = v.y
          const wz = v.z
          v.project(cam)
          if (v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue
          /**
           * ⚠️ **가려진 면은 버립니다.** 처음엔 화면 안이기만 하면 표본에
           *    넣었는데, 직교 쿼터뷰에서는 앞쪽 지형이 뒤쪽 면을 통째로
           *    가립니다. 그러면 "벽을 쟀다"고 믿으면서 실제로는 그 앞의
           *    윗면이나 턱을 재게 되고, **벽을 밝게 칠할수록 벽이 밝아지는
           *    게 아니라 턱을 밝게 칠해도 벽이 밝아집니다.**
           *    (실제로 그 증상으로 잡았습니다 — 턱만 밝혔는데 벽 표본이
           *     rgb 20 → 23 으로 같이 올라갔습니다.)
           *
           *    그래서 그 자리로 광선을 쏴서 **처음 맞는 것이 이 면인지**
           *    확인합니다. 눈에 안 보이는 면은 가독성과 무관합니다.
           */
          if (!this.faceVisible(v.x, v.y, wx, wy, wz)) continue
          out.push({
            sx: Math.round(((v.x + 1) / 2) * el.clientWidth),
            sy: Math.round(((1 - v.y) / 2) * el.clientHeight),
            drop,
            climbable: drop <= MAX_CLIMB,
          })
        }
      }
    }
    return out
  }

  /**
   * 적 하나를 원하는 자리에 세웁니다 — `debugTeleport` 의 적 판.
   *
   * 🏹 엄폐 검증에 필요했습니다. "화살 선 위에 잡몹을 세워 두고 쏘게 한다"를
   * 하려면 그 잡몹이 **그 자리에 있어야** 하는데, 살아 있는 잡몹은 예고
   * 1.25초 동안 3m 를 걸어와서 선을 벗어납니다. `freezeEnemies` 는 전부
   * 얼려서 궁수까지 안 쏘게 되므로 쓸 수 없었습니다.
   */
  /** 🌀 무기 축이 지금 놓인 각도 — 궤적이 단마다 다른지 재는 데 씁니다. */
  debugSwingPose(e: number): { x: number; y: number } | null {
    return this.visuals.debugSwingPose(e)
  }

  debugTeleportEnemy(e: number, x: number, z: number): void {
    if (!isAlive(e)) return
    Transform.x[e] = x
    Transform.z[e] = z
    if (this.terrain) Transform.y[e] = this.terrain.groundYAt(x, z)
    Velocity.x[e] = 0
    Velocity.z[e] = 0
  }

  /** 사다리 상태 — 프로브가 상수를 베끼지 않고 게임에서 읽도록. */
  debugBossSwingLog(): Record<
    string,
    { swings: number; hits: number; chained: number; byPhase: number[] }
  > {
    return this.bossSwingLog
  }

  /**
   * 🧪 **실험대 전용** — 원하는 자리에 통을 하나 세웁니다.
   *
   * `setHp`·`setStamina` 와 같은 성격입니다: 게임 규칙이 아니라 **재기 위한
   * 받침대**입니다. 존에 놓인 통 셋은 서로 멀리 떨어져 있어서
   * *"연쇄가 붙는가"* 나 *"반경 밖은 안 무너지는가"* 를 **존 안에서는
   * 세울 수가 없습니다.** 그 상황을 못 세우면 그 규칙은 영영 안 재집니다.
   */
  /**
   * 🧪 **실험대 전용** — 등급을 직접 끼웁니다.
   *
   * `equipGear` 와 달리 **내려가는 것도 허용**합니다. 검사는 *"신화가
   * 일반보다 센가"* 를 물어야 하는데, 게임 규칙만 쓰면 한 번 올라간
   * 등급을 되돌릴 수가 없어서 **비교 자체가 성립하지 않습니다.**
   */
  /** 🏆 지금 떠 있는 검격 자국의 색 — 그림이 아니라 **그린 값**을 봅니다. */
  debugSwingColor(): number {
    return this.vfx.debugSwingColor()
  }

  /**
   * 🔢 지금 떠 있는 데미지 숫자들을 **화면 좌표의 상자**로 돌려줍니다.
   *
   * 월드가 아니라 화면으로 바꿔서 주는 이유: 겹침은 **보는 사람의 눈에서**
   * 일어납니다. 월드에서 1m 떨어져 있어도 카메라 축에 따라 화면에서는
   * 붙어 보일 수 있습니다. 프로브가 재야 하는 것은 후자입니다.
   */
  debugDamageBoxes(): {
    cx: number
    cy: number
    w: number
    h: number
    wy: number
    lateral: number
    age: number
  }[] {
    const el = this.renderer.domElement
    const cam = this.cam.camera
    // 스프라이트는 카메라를 보고 서므로, 화면에서의 가로/세로는 **카메라의
    // 오른쪽·위 축**입니다. 그 축으로 반지름만큼 옮긴 점을 같이 투영하면
    // 화면 크기를 얻습니다 — 원근이면 거리에 따라 달라지는 것까지 알아서 반영됩니다.
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
    const v = new THREE.Vector3()
    const out = []
    for (const d of this.vfx.debugDamages()) {
      v.set(d.x, d.y, d.z).project(cam)
      const ndcX = v.x
      const ndcY = v.y
      if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) continue
      v.set(d.x, d.y, d.z).addScaledVector(right, d.w / 2).project(cam)
      const w = Math.abs(v.x - ndcX) * el.clientWidth
      v.set(d.x, d.y, d.z).addScaledVector(up, d.h / 2).project(cam)
      const h = Math.abs(v.y - ndcY) * el.clientHeight
      out.push({
        cx: ((ndcX + 1) / 2) * el.clientWidth,
        cy: ((1 - ndcY) / 2) * el.clientHeight,
        w,
        h,
        // 월드 높이·가로치우침·나이를 같이 넘깁니다 — 겹쳤을 때 *"안 쌓았다"* 와
        // *"쌓았는데 모자랐다"* 를 가르는 데 화면 좌표만으로는 부족합니다.
        wy: d.y,
        lateral: d.lateral,
        age: d.age,
      })
    }
    return out
  }

  /** ✨ 지금 화면에 놓인 등급 불티 — 프로브가 규칙을 베끼지 않게 그린 값을 줍니다. */
  debugAura(): {
    count: number
    color: number
    weapon: number
    motes: { x: number; y: number; z: number; size: number; opacity: number }[]
  } {
    return this.visuals.debugAura()
  }

  debugSetGear(weaponIndex: number, tier: number, seed: number): void {
    const p = this.playerEntity
    if (weaponIndex === 1) {
      Loadout.wTier1[p] = tier
      Loadout.wSeed1[p] = seed >>> 0
    } else if (weaponIndex === 2) {
      Loadout.wTier2[p] = tier
      Loadout.wSeed2[p] = seed >>> 0
    } else {
      Loadout.wTier0[p] = tier
      Loadout.wSeed0[p] = seed >>> 0
    }
    this.refreshLoadout()
  }

  debugSpawnBarrel(x: number, z: number): number {
    const e = spawnBarrel(x, z)
    if (this.terrain) Transform.y[e] = this.terrain.groundYAt(x, z)
    this.visuals.attach(e, Renderable.kind[e])
    return e
  }

  /**
   * 🏺 실험대 — 항아리를 세웁니다. `holds` 면 안에 보물이 들어 있습니다.
   *
   * 통과 **같은 모양의 훅**을 두는 이유: 프로브가 항아리만 다른 방식으로
   * 세우면, 게임이 실제로 세우는 길과 다른 길을 재게 됩니다.
   */
  debugSpawnUrn(x: number, z: number, holds = false): number {
    const e = spawnUrn(x, z, holds)
    if (this.terrain) Transform.y[e] = this.terrain.groundYAt(x, z)
    this.visuals.attach(e, Renderable.kind[e])
    return e
  }

  /**
   * 🏺 실험대 — 지금 서 있는 항아리들. **안에 든 것까지** 냅니다.
   *
   * ⚠️ 이건 **디버그 전용**입니다. 게임 화면은 안에 든 것을 절대 안
   *    보여 줍니다(그게 숨기는 것의 전부니까요). 프로브가 *"진짜가 정말
   *    거기 있었나"* 를 물으려면 답을 아는 창구가 하나는 있어야 합니다.
   */
  debugUrns(): { entity: number; x: number; z: number; holds: boolean; broken: boolean }[] {
    const out: { entity: number; x: number; z: number; holds: boolean; broken: boolean }[] = []
    for (const e of urnQuery.run().slice(0, urnQuery.count)) {
      out.push({
        entity: e,
        x: Number(Transform.x[e].toFixed(3)),
        z: Number(Transform.z[e].toFixed(3)),
        holds: Urn.holds[e] === 1,
        broken: Urn.broken[e] === 1,
      })
    }
    return out
  }

  /**
   * 🏆 **장비 등급의 규칙과 지금 상태** — 프로브가 표를 베껴 적지 않게.
   *
   * `tiers` 는 규칙 그 자체이고, `weapons` 는 지금 이 판의 상태입니다.
   * 검사는 둘을 맞대 보는 것만으로 *"규칙대로 붙었는가"* 를 물을 수 있고,
   * 표를 손보는 날 검사만 옛 규칙을 지키는 일이 없습니다.
   */
  debugGearInfo(): {
    tiers: { id: number; name: string; color: number; affixes: number; scale: number; weight: number }[]
    weapons: {
      index: number
      name: string
      tier: number
      tierName: string
      seed: number
      level: number
      affixes: { kind: number; name: string; unit: string; value: number }[]
    }[]
    /** 지금 든 무기가 실제로 곱하고 있는 값들 — **결과**를 봅니다. */
    live: { damageMult: number; speedScale: number; cooldownScale: number; magicFlat: number }
  } {
    const p = this.playerEntity
    return {
      tiers: GEAR_TIERS.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        affixes: t.affixes,
        scale: t.scale,
        weight: t.weight,
      })),
      weapons: WEAPONS.map((w, i) => ({
        index: i,
        name: w.name,
        tier: weaponTier(p, i),
        tierName: tierDef(weaponTier(p, i)).name,
        seed: weaponSeed(p, i),
        level: weaponLevel(p, i),
        affixes: weaponAffixes(p, i).map((a) => ({
          kind: a.kind as number,
          name: a.name,
          unit: a.unit,
          value: a.value,
        })),
      })),
      live: {
        damageMult: Number(weaponDamageMult(p).toFixed(4)),
        speedScale: Number(weaponSpeedScale(p).toFixed(4)),
        cooldownScale: Number(weaponCooldownScale(p).toFixed(4)),
        magicFlat: Number(weaponMagicFlat(p).toFixed(2)),
      },
    }
  }

  /**
   * 🧱 **금 간 벽의 상태** — 계측기가 「비밀」을 알아볼 수 있게.
   *
   * `walkable` 이 이 창의 핵심입니다: *"지금 이 자리까지 걸어갈 수
   * 있는가"* 를 **게임의 길찾기에게** 물어본 값입니다. 프로브가 지형을
   * 베껴 다시 계산하면 규칙이 두 벌이 되고, 벽 규칙은 이제 막 생겨서
   * 두 벌이 갈라질 여지가 가장 큽니다.
   */
  debugWalls(): {
    key: string
    x: number
    z: number
    open: boolean
    standing: boolean
    tough: boolean
  }[] {
    if (!this.terrain) return []
    /**
     * `open` 과 `standing` 은 **다른 것**입니다:
     *   · `open`     — **길**이 뚫렸는가 (지형의 통행 규칙)
     *   · `standing` — **몸통**이 아직 서 있는가 (화면에 보이는 것)
     *
     * 둘을 한 칸으로 답하면 세이브를 넘긴 뒤의 어긋남 — *"길은 뚫렸는데
     * 벽이 서 있다"* — 을 **물어볼 수조차 없습니다.** 실제로 그 버그가
     * 생길 수 있는 자리가 있어서(`removeBrokenWalls`), 여기서 갈라 답합니다.
     */
    const standing = new Set<string>()
    const tough = new Set<string>()
    for (let e = 0; e < 4096; e++) {
      if (!isAlive(e) || !hasComponent(CrackedWall, e)) continue
      const key = `${CrackedWall.cx[e]},${CrackedWall.cz[e]}`
      standing.add(key)
      if (CrackedWall.tough[e] === 1) tough.add(key)
    }
    return this.terrain.shortcuts
      .filter((s) => s.kind === 'wall')
      .map((s) => ({
        key: s.key,
        x: s.x,
        z: s.z,
        open: s.open,
        standing: standing.has(s.key),
        /** 🧱💥 칼로는 안 열리는가 — **몸통**이 아는 사실이라 몸통에서 읽습니다. */
        tough: tough.has(s.key),
      }))
  }

  /**
   * 지금 플레이어가 **걸어서** 그 자리에 닿을 수 있는가.
   *
   * ⚠️ 「닿을 수 있다」는 판이 진행되면 바뀝니다(벽을 부수면 열립니다).
   *    그래서 이 값은 **물어본 순간의 답**입니다 — 프로브가 판 시작에
   *    한 번 물어 두고 나중까지 그 답을 쓰면 안 됩니다.
   */
  debugWalkableFromPlayer(x: number, z: number): boolean {
    if (!this.terrain) return false
    this.terrain.buildFlowField(x, z)
    return this.terrain.pathDistance(Transform.x[this.playerEntity], Transform.z[this.playerEntity]) !== null
  }

  /**
   * 💥 **폭발통의 상태와 규칙** — 프로브가 반경·도화선을 베껴 적지 않게.
   *
   * `blast`·`fuse`·`staminaLoss` 는 게임이 **실제로 쓰는 값**이고,
   * `barrels` 는 지금 판에 남아 있는 통들입니다. 검사는 이 둘을 맞대 보는
   * 것으로 *"그린 원이 규칙과 같은가"* 를 물을 수 있습니다.
   */
  debugBarrelInfo(): {
    blast: number
    /** 🔥 불이 옮겨 붙는 거리 — **피해 반경과 다른 숫자**입니다(balance.ts `BARREL.chain`). */
    chain: number
    fuse: number
    staminaLoss: number
    blown: number
    caught: number
    barrels: { entity: number; x: number; z: number; fuseT: number; fuseTotal: number; catches: number }[]
  } {
    const out: {
      entity: number
      x: number
      z: number
      fuseT: number
      fuseTotal: number
      catches: number
    }[] = []
    for (let e = 0; e < 4096; e++) {
      if (!isAlive(e) || !hasComponent(Barrel, e)) continue
      out.push({
        entity: e,
        x: Number(Transform.x[e].toFixed(3)),
        z: Number(Transform.z[e].toFixed(3)),
        fuseT: Number(Barrel.fuseT[e].toFixed(3)),
        fuseTotal: Number(Barrel.fuseTotal[e].toFixed(3)),
        /**
         * 💥 지금 터지면 휘말릴 적의 수 — **게임의 폭발이 쓰는 그 함수**로
         * 셉니다(combat.ts `countInBlast`). 프로브가 거리를 다시 재면
         * 몸 굵기를 빼먹고 게임보다 좁은 원을 재게 됩니다.
         */
        catches: countInBlast(Transform.x[e], Transform.z[e]),
      })
    }
    return {
      blast: BARREL.blast,
      chain: BARREL.chain,
      fuse: barrelFuse(),
      staminaLoss: barrelStaminaLoss(),
      blown: this.barrelsBlown,
      caught: this.barrelsCaught,
      barrels: out,
    }
  }

  debugShortcutInfo(): {
    key: string
    open: boolean
    rise: number
    loWorldX: number
    loWorldZ: number
    hiWorldX: number
    hiWorldZ: number
    /** 걷힌 채로 아래에서 위까지 돌아가야 하는 거리(m) — 지형에서 잰 값. */
    saving: number | null
  }[] {
    if (!this.terrain) return []
    const { w, h } = this.terrain.level
    // 🧱 계측기가 읽는 「사다리 장부」입니다 — 벽이 섞이면 `npm run play` 의
    //    *"사다리 0/2 내림"* 분모가 조용히 늘어납니다. 못 잰 것을 통과로
    //    만들지 않는 것과 같은 이유로, **안 센 것을 분모에 넣지 않습니다.**
    return this.terrain.shortcuts
      .filter((s) => s.kind === 'ladder')
      .map((s) => {
        const lo = cellToWorld(s.loX, s.loZ, w, h)
        const hi = cellToWorld(s.hiX, s.hiZ, w, h)
        return {
          key: s.key,
          open: s.open,
          rise: Math.round((s.hiY - s.loY) / HEIGHT_STEP),
          loWorldX: lo.x,
          loWorldZ: lo.z,
          hiWorldX: hi.x,
          hiWorldZ: hi.z,
          saving: this.terrain!.shortcutSaving(s),
        }
      })
  }

  /** 지금 화면에 뜬 사다리 안내 상태. */
  debugShortcutHint(): 'ready' | 'locked' | 'open' | null {
    if (!this.terrain) return null
    const p = this.playerEntity
    const found = this.terrain.shortcutNear(Transform.x[p], Transform.z[p], LADDER_REACH)
    if (!found) return null
    return found.s.open ? 'open' : found.fromTop ? 'ready' : 'locked'
  }

  /**
   * 임의의 목표로 향하는 **다음 한 걸음**.
   *
   * 자동 플레이 봇이 화톳불로 되돌아갈 때 필요합니다. 직선으로 걸어가게
   * 두었더니 벽에 걸려 성문 앞에서 133초를 헤맸고, 그 시간이 지도가 어려운
   * 탓으로 잘못 기록될 뻔했습니다. **길찾기를 쓰는 쪽과 안 쓰는 쪽이 섞여
   * 있으면 계측이 거짓말을 합니다.**
   */
  /**
   * 🚪 그 자리에서 **나에게 오는** 걸어야 하는 거리(m). 어그로 규칙이 쓰는
   * 바로 그 값입니다 — 프로브가 다른 방향으로 재다가 한 번 속았습니다.
   */
  /**
   * 🧭 **지도가 「길이 있다」고 한 곳을 몸으로 걸어가 봅니다.**
   *
   * ── 왜 필요한가 ──────────────────────────────────────────────
   * 이 게임에는 길에 대한 진실이 **두 벌** 있습니다:
   *   · `nextStepToward` — 흐름장이 말하는 *"다음 한 걸음"*
   *   · `resolveMove`    — 몸이 실제로 갈 수 있는 자리(충돌·단차·미끄러짐)
   *
   * 둘이 어긋나면 아무 오류도 안 납니다. 그냥 **지면 화살표가 못 가는 쪽을
   * 가리키고**(기둥 4), 자동 플레이는 그 자리에서 왔다 갔다 합니다 —
   * 실제로 판마다 *"순 이동 0.6m 인데 걸은 거리 68m"* 가 찍혔습니다.
   *
   * 그래서 **게임의 두 함수를 그대로 이어 붙여** 걸어 봅니다. 프로브가
   * 지형 규칙을 흉내 내면 흉내를 검사하게 되므로, 여기서 합니다.
   *
   * ⚠️ 이건 걸음의 **가능성**만 잽니다(속도·조향·적 없음). 그래서 실패는
   *    확실한 병이고, 성공은 *"적어도 지도 탓은 아니다"* 까지입니다.
   */
  /**
   * 🧭 **게임이 안내하는 길을 칸으로 돌려줍니다.**
   *
   * ── 왜 필요한가 ──────────────────────────────────────────────
   * 「주 동선」을 지금까지 **세 곳에서 따로** 그리고 있었습니다:
   *   · 게임    — 흐름장(`nextStepToward`)
   *   · secret  — 게임에게 물어 걷습니다 (옳음)
   *   · map     — **자기 BFS** 로 다시 그립니다 (흉내)
   *
   * 흉내는 언젠가 갈라집니다. 실제로 갈라졌습니다 — 길안내에
   * *"되돌아올 수 없는 길"* 의 값(`ONE_WAY_COST`)을 넣었더니 게임은 남쪽
   * 낙하를 피하는데 map 의 BFS 는 그대로 그리로 갔고, 그 길로 잰
   * *"보스 앞 복도"* 가 **20m** 로 빨갛게 떴습니다. 게임의 길로 재면
   * **62m** 입니다. 프로브가 **없는 길의 박자**를 재고 있었던 것입니다.
   *
   * 그래서 그리는 자리를 한 곳으로 모읍니다. 프로브는 이 함수를 부릅니다.
   *
   * ⚠️ 걸음이 아니라 **칸**을 돌려줍니다. 부르는 쪽이 배치와 견주려면
   *    칸이 필요하고, 미터가 필요하면 `pathDistance` 가 따로 있습니다.
   */
  debugRouteTrail(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    maxSteps = 4000,
  ): { x: number; z: number }[] {
    const t = this.terrain
    if (!t) return []
    t.buildFlowField(toX, toZ)
    if (t.pathDistance(fromX, fromZ) === null) return []
    const out: { x: number; z: number }[] = [{ x: fromX, z: fromZ }]
    let x = fromX
    let z = fromZ
    for (let i = 0; i < maxSteps; i++) {
      if (t.pathDistance(x, z) === 0) break
      const nxt = t.nextStepToward(x, z)
      if (!nxt) break
      x = nxt.x
      z = nxt.z
      out.push({ x, z })
    }
    return out
  }

  debugPathWalk(
    toX: number,
    toZ: number,
    starts: readonly { x: number; z: number }[],
    step = 0.35,
    maxSteps = 3000,
  ): {
    x: number
    z: number
    arrived: boolean
    walked: number
    net: number
    endX: number
    endZ: number
    why: string
  }[] {
    const out: {
      x: number
      z: number
      arrived: boolean
      walked: number
      net: number
      endX: number
      endZ: number
      why: string
    }[] = []
    const t = this.terrain
    if (!t) return out
    t.buildFlowField(toX, toZ)
    for (const s0 of starts) {
      // 지도가 "길이 없다"고 한 짝은 이 검사의 대상이 아닙니다.
      if (t.pathDistance(s0.x, s0.z) === null) continue
      let x = s0.x
      let z = s0.z
      let walked = 0
      let why = '걸음 수를 다 씀'
      let arrived = false
      for (let i = 0; i < maxSteps; i++) {
        /**
         * ⚠️ **「도착」을 1m 라는 리터럴로 정했다가 26건이 빨갛게 떴습니다.**
         *    죽은 자리가 26건 **전부 같은 칸**이었습니다 — 목표 칸 안에
         *    들어와 있는데 목표 *점*까지는 1m 남은 상태. 칸이 2m 니까
         *    당연한 일이고, 지도는 아무 잘못이 없었습니다.
         *    도착했는지는 **게임에게 묻습니다** — 흐름장 값이 0 인 칸이
         *    곧 목표 칸입니다.
         */
        if (t.pathDistance(x, z) === 0) {
          arrived = true
          why = ''
          break
        }
        const nxt = t.nextStepToward(x, z)
        if (!nxt) {
          /**
           * 여기서 **두 가지 병을 갈라야 합니다.**
           *   · 흐름장 **밖**으로 미끄러졌다 — 몸이 지도가 안 덮는 칸에 있음
           *     (한쪽으로만 내려가는 턱에서 잘 납니다. 지도는 목표로 *올 수
           *     있는* 칸만 덮으므로, 떨어지면 그 칸엔 값이 없습니다)
           *   · 흐름장이 그 칸에서 **끝났다** — 값은 있는데 더 낮은 이웃이 없음
           * 처방이 정반대라 한 칸에 담으면 안 됩니다.
           */
          why = t.pathDistance(x, z) === null ? '흐름장 밖으로 미끄러졌다' : '흐름장이 그 칸에서 끝났다'
          break
        }
        const dx = nxt.x - x
        const dz = nxt.z - z
        const l = Math.hypot(dx, dz) || 1
        const r = t.resolveMove(x, z, x + (dx / l) * step, z + (dz / l) * step)
        const moved = Math.hypot(r.x - x, r.z - z)
        x = r.x
        z = r.z
        walked += moved
        if (moved < step * 0.05) {
          // 지도는 가라는데 **몸이 안 나갑니다.** 이게 두 진실이 어긋난 자리입니다.
          why = '지도는 가라는데 몸이 안 나간다'
          break
        }
      }
      out.push({
        x: s0.x,
        z: s0.z,
        arrived,
        walked: Number(walked.toFixed(1)),
        net: Number(Math.hypot(x - s0.x, z - s0.z).toFixed(1)),
        endX: Number(x.toFixed(0)),
        endZ: Number(z.toFixed(0)),
        why,
      })
    }
    return out
  }

  debugWalkToPlayer(x: number, z: number): number | null {
    const p = this.playerEntity
    this.terrain?.buildPlayerField(Transform.x[p], Transform.z[p])
    return this.terrain?.distanceToPlayer(x, z) ?? null
  }

  debugPathStep(toX: number, toZ: number): { x: number; z: number; dist: number } | null {
    if (!this.terrain) return null
    const p = this.playerEntity
    this.terrain.buildFlowField(toX, toZ)
    const step = this.terrain.nextStepToward(Transform.x[p], Transform.z[p])
    const dist = this.terrain.pathDistance(Transform.x[p], Transform.z[p])
    if (!step) return dist === 0 ? { x: toX, z: toZ, dist: 0 } : null
    /**
     * ── ⚠️ **`?? 0` 이 「못 간다」를 「다 왔다」로 바꾸고 있었습니다** ──────
     *
     * `pathDistance` 는 닿을 수 없는 칸에 **null** 을 냅니다(terrain.ts).
     * 그런데 여기서 `dist ?? 0` 으로 받아서, 닿을 수 없는 자리가 **0m** 로
     * 나갔습니다. 0m 은 이 함수에서 *"이미 도착했다"* 는 뜻입니다 —
     * 하필 정반대의 뜻으로 뭉개진 셈입니다.
     *
     * 그 결과가 자동 플레이의 **25초 막힘**이었습니다. 봇은 강화대까지
     * "0m" 를 보고 도착했다고 믿어 그 자리에 서고, 매 프레임 다시
     * 강화이동을 고릅니다. 기록에 `[강화이동×90]` 인데 위치는 그대로인
     * 그 모양입니다. 일곱 건 중 여섯이 같은 구역이었던 것도 설명됩니다 —
     * 거기서 강화대가 실제로 안 닿습니다.
     *
     * 못 가는 것은 **못 간다고** 말해야 합니다. 이 함수에는 이미 그 신호가
     * 있습니다 — `null`. 없는 값을 그럴듯한 숫자로 채우면, 부르는 쪽은
     * 틀린 것을 **확신을 갖고** 합니다.
     */
    if (dist == null) return null
    return { x: step.x, z: step.z, dist }
  }

  /**
   * **목표까지의 걷는 거리** — 플레이어와 임의의 지점들을 한 번에.
   *
   * 왜 게임이 내주는가: 길찾기(흐름장)는 게임만 가지고 있습니다. 봇이
   * 직선으로 대신 재면 벽 너머가 가깝게 보입니다 — 이 프로젝트에서
   * 직선/경로를 혼동해 생긴 버그가 이미 넷입니다.
   *
   * 왜 한 번에: 흐름장은 **목적지 하나마다** 한 번 만듭니다. 지점마다
   * 따로 물으면 그 수만큼 다시 만들어야 하고, 봇의 판단 루프는 벽시계에
   * 묶여 있어서 그 비용이 그대로 **측정값을 흔듭니다**(느려진 봇이 더 못
   * 싸우고, 그게 밸런스 변화로 잘못 기록됩니다).
   */
  /**
   * ── 🧭 **지금 이 자리에서 안내가 «무엇을 가리킬 것인가»** ──────────────
   *
   * ── 왜 필요했는가 ────────────────────────────────────────────────
   * `npm run secret` 의 「보물마다 알 방법이 하나는 있다」가 **같은 코드로
   * 4/6 과 5/6 을 오갔습니다.** 원인은 게임이 아니라 **재는 법**이었습니다:
   * 화면의 안내는 **타이머로 하나씩** 뜨는데(`sideHintT`), 프로브는 봇이
   * 걷는 동안 *"지금 화면에 떠 있는 글"* 을 표본으로 주웠습니다. 봇이
   * 그 자리를 몇 프레임에 지나가느냐에 따라 같은 지도가 다른 답을 냅니다.
   *
   * ⚠️ 흔들리는 검사는 **없는 것보다 나쁩니다** — 멀쩡한 배치를 고치게
   *    만듭니다. 이 저장소는 실제로 그럴 뻔한 적이 있습니다(`findSideHint`
   *    의 「알림 자리 돌리기」를 넣었다가 효과 없어 되돌린 기록).
   *
   * 그래서 **타이머를 빼고 규칙만** 묻습니다. 게임이 *"이 자리에서라면
   * 무엇을 가리킬 것인가"* 를 그때그때 다시 계산해 답합니다 — 규칙은
   * `findSideHint` 한 곳 그대로이고, 프로브는 **고르는 규칙**을 재게 됩니다.
   *
   * ⚠️ 화면에 **뜨는 것**(타이머·한 번에 하나)은 여전히 별개입니다.
   *    그건 `sideHint()` 가 답하고, 이 훅은 *"고를 것이 있었는가"* 만
   *    답합니다 — 처방이 다른 둘을 한 칸에 담지 않습니다.
   */
  debugSideHintAtHere(): { dir: string; dist: number; x: number; z: number } | null {
    const p = this.playerEntity
    const px = Transform.x[p]
    const pz = Transform.z[p]
    const obj = this.findObjective(px, pz)
    return this.findSideHint(px, pz, obj ? { x: obj.x, z: obj.z } : null)
  }

  debugDistancesToward(
    toX: number,
    toZ: number,
    pts: { x: number; z: number }[],
  ): { player: number; points: number[] } | null {
    if (!this.terrain) return null
    this.terrain.buildFlowField(toX, toZ)
    const p = this.playerEntity
    return {
      player: this.terrain.pathDistance(Transform.x[p], Transform.z[p]) ?? Infinity,
      points: pts.map((q) => this.terrain?.pathDistance(q.x, q.z) ?? Infinity),
    }
  }

  /** 두 지점 사이를 걸어서 통과할 수 있는가 — 게임의 통행 규칙 그대로. */
  debugWalkTest(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    return this.terrain?.canWalk(fromX, fromZ, toX, toZ) ?? false
  }

  /** 🗺 이 월드 좌표의 지형 단(段) — 프로브가 낙차 경계를 찾는 데 씁니다. */
  debugTerrainLevelAt(x: number, z: number): number {
    return this.terrain ? this.terrain.levelAtWorld(x, z) : 0
  }

  /**
   * 🗺 이 월드 좌표가 **어느 구역인가**(없으면 빈 문자열).
   *
   * 바닥 밝기를 두 점에서 견주는 검사에 필요합니다 — 구역마다 색조가
   * 달라서, 경계를 넘어 두 점을 찍으면 **그림자가 아니라 색조**를
   * 재게 됩니다(`npm run depth` 의 게이트가 실제로 그렇게 걸렸습니다).
   */
  /**
   * 🗺 **이 칸이 어느 구역인가 — 규칙은 여기 하나뿐입니다.**
   *
   * ⚠️ 예전엔 두 곳에 **다른 규칙**이 있었습니다. HUD 배너는 *"가장 작은
   *    구역"* 을 골랐고 디버그 훅은 *"먼저 찾은 구역"* 을 골랐습니다.
   *    이 존은 구역이 **겹칩니다**(함몰지 가장자리 ↔ 남쪽 함몰지) —
   *    겹치는 자리에서 두 규칙이 서로 다른 답을 냅니다. 화면에는 「함몰지
   *    가장자리」가 뜨는데 프로브는 「남쪽 함몰지」로 읽는 식입니다.
   *    이 저장소가 같은 병으로 여러 번 데였습니다(동선 사본 셋, 깨는 거리
   *    두 곳). 한 곳에만 둡니다.
   *
   * 「가장 작은 구역」이 맞는 이유: 큰 구역 안에 작은 주머니를 겹쳐 놓는
   * 것이 이 존의 작법이고, 그때 플레이어가 서 있는 곳은 **주머니**입니다.
   */
  /**
   * 🗺 **이웃 표를 한 번만 만듭니다** — 구역 두 개가 맞닿거나 겹치면 이웃.
   *
   * 「맞닿는다」의 여유는 **한 칸**입니다. 이건 조율값이 아니라 격자의
   * 최소 단위입니다 — 사각형 둘이 나란히 붙어 있으면 `x1 + 1 === x2` 라,
   * 여유가 0 이면 **닿아 있는 구역이 이웃이 아니게** 됩니다.
   */
  private buildRegionNeighbours(): void {
    this.regionNeighbours = new Map()
    const touching = (a: LevelRegion, b: LevelRegion): boolean =>
      !(a.x1 + 1 < b.x0 || b.x1 + 1 < a.x0 || a.z1 + 1 < b.z0 || b.z1 + 1 < a.z0)
    for (const a of this.regions) {
      const set = this.regionNeighbours.get(a.name) ?? new Set<string>()
      for (const b of this.regions) if (b !== a && touching(a, b)) set.add(b.name)
      this.regionNeighbours.set(a.name, set)
    }
  }

  private regionAtCell(cx: number, cz: number): LevelRegion | null {
    let found: LevelRegion | null = null
    let foundArea = Infinity
    for (const r of this.regions) {
      if (cx < r.x0 || cx > r.x1 || cz < r.z0 || cz > r.z1) continue
      const area = (r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1)
      if (area < foundArea) {
        found = r
        foundArea = area
      }
    }
    return found
  }

  debugRegionAt(x: number, z: number): string {
    if (!this.terrain) return ''
    const { w, h } = this.terrain.level
    const cell = worldToCell(x, z, w, h)
    return this.regionAtCell(cell.cx, cell.cz)?.name ?? ''
  }

  debugTerrainInfo(): {
    maxClimb: number
    heightStep: number
    cellSize: number
    fallFreeSteps: number
    fallDamagePerStep: number
    /** 존에서 적이 깨어나는 거리(m) — 프로브가 상수를 베끼지 않게. */
    levelAggroRange: number
    /**
     * 🔇 **등 돌린 적이 «듣는» 거리**(m) — 걸을 때와 달릴 때.
     *
     * 깨는 식이 이렇습니다: `보고 있으면 시야거리 · 등 돌렸으면 이 거리`.
     * 즉 소리 규칙은 **등 돌린 적에게만** 뜻이 있고, 두 값 **사이의 띠**
     * 에서만 «걸어서 지나가기»와 «달려서 지나가기»의 답이 갈립니다.
     *
     * 프로브가 `1.8 + 7.2 × 속도비` 를 베껴 적으면, 값을 고치는 날
     * 프로브만 옛 게임을 잽니다 — 게임의 `hearDistance` 로 계산해 냅니다.
     */
    hearWalk: number
    hearRun: number
    /** 「보고 있다」로 치는 부채꼴(도). 이 밖이면 소리만 듣습니다. */
    frontArcDeg: number
    /**
     * 📣 **깬 적이 동료를 부르는 거리**(m). 조용히 지나갈 자리를 고르려면
     * 이것도 봐야 합니다 — 곁에 동료가 있으면 **소리와 무관하게** 깨어납니다.
     */
    alertRadius: number
    /** 달리기 배율 · 공격 템포 배율 — 프로브가 상수를 베끼지 않게. */
    sprintScale: number
    /** 달릴 때 시야가 넓어지는 배율 · 기본 시야(m) · 지금 카메라 줌. */
    sprintViewScale: number
    cameraViewSize: number
    cameraZoom: number
    /**
     * 🎥 **카메라 각도**(도). 고정 시점이라 «무엇이 지형에 가리는가»가 이 둘로 정해집니다 —
     * 프로브가 52/45 를 베껴 적지 않게 게임이 답합니다(`npm run secret` 의 🕯 검사).
     */
    cameraPitchDeg: number
    cameraYawDeg: number
    /**
     * 🎥 커서 쪽으로 카메라가 밀리는 **최대 거리(m)**.
     *
     * `notice` 프로브가 *"알아채는 적이 화면 안인가"* 를 물을 때, 걸을 때의
     * 여유가 이 값에서 나옵니다 — 가는 쪽을 보면 그만큼 더 보입니다.
     * 프로브가 3.2 를 베껴 적으면, 이 값을 손보는 날 검사만 옛 카메라를
     * 지킵니다.
     */
    aimLeadMax: number
    attackTempo: number
    /**
     * 선입력 창(초)과 구르기 시간 — 템포 프로브가 숫자를 베껴 적지 않도록.
     * 이 셋은 서로 묶인 값입니다: `inputBuffer >= dodgeDuration + dodgeCooldown`
     * 이어야 연속 구르기가 선입력으로 이어집니다.
     */
    inputBuffer: number
    dodgeDuration: number
    dodgeCooldown: number
    /** 구르기 이동 거리(m) — 🟡 반경이 이보다 커야 "굴러선 못 빠져나온다"가 성립합니다 */
    dodgeDistance: number
    /**
     * 걷는 속도(m/s). 🟡 의 정답이 *"걸어서 이탈"* 이므로, 그 답이 실제로
     * 성립하는지 재려면 **예고 시간 동안 걸어서 갈 수 있는 거리**를 알아야
     * 합니다. 구르기 거리만으로는 그 색을 검사할 수 없습니다.
     */
    walkSpeed: number
    /**
     * 스태미나 최대치. *"한 판 쉬면 얼마나 회복되는가"* 를 재려면
     * 회복 속도·지연과 **함께** 필요합니다 — 지도의 이완 구간이 충분한지는
     * 결국 "빈손으로 다음 싸움에 들어가지 않는가"이기 때문입니다.
     */
    maxStamina: number
    /** 플레이어 몸 반지름 — 포위 탈출 틈을 재는 데 씁니다. */
    bodyRadius: number
    dodgeStaminaCost: number
    staminaRegen: number
    staminaRegenDelay: number
    dodgeCancelExtraCost: number
    /** 기본 공격 한 대가 채우는 집중 — 3타 콤보 = 1점이라는 약속을 검사하려면 필요합니다 */
    focusPerLightHit: number
    /** ActorState 값 — 프로브가 1/2/5 같은 숫자를 외우지 않게 */
    actorStates: { idle: number; attack: number; dodge: number; skill: number }
    /** 원거리 적이 자기 사거리 위에 더 받는 여유(m). */
    levelAggroLead: number
    /** 어그로 천장(m) — 카메라가 세로로 담는 높이. */
    levelAggroMax: number
    /** 플레이어 이동 속도(m/s) — "지나가는 데 몇 초"를 프로브가 직접 계산하도록. */
    playerMoveSpeed: number
    playerRadius: number
    /**
     * 🔵 속박에 걸렸을 때의 걷기 배율. 이 색의 **정답이 왜 무적 프레임인지**를
     * 검사하려면 필요합니다 — 속박이 무는 것은 "걷기"뿐이라서, 뒤따르는
     * 🟡(걸어서 이탈)을 못 걸어 나오는지가 이 색의 존재 이유입니다.
     */
    snareMoveScale: number
    /**
     * 존의 실제 크기(m). 동선의 폭을 **존의 크기에 견주려면** 필요합니다 —
     * "가로 128m 세로 34m" 는 그 자체로는 아무 말도 안 하고, 존이 얼마나
     * 넓은지를 옆에 놓아야 *"넓은 땅을 한 줄로만 쓰고 있다"* 가 됩니다.
     * 레벨이 없으면(아레나) 0.
     */
    zoneWidth: number
    zoneDepth: number
  } {
    return {
      zoneWidth: this.levelW * CELL_SIZE,
      zoneDepth: this.levelH * CELL_SIZE,
      maxClimb: MAX_CLIMB,
      heightStep: HEIGHT_STEP,
      cellSize: CELL_SIZE,
      fallFreeSteps: FALL.freeSteps,
      fallDamagePerStep: FALL.damagePerStep,
      levelAggroRange: LEVEL_AGGRO_RANGE,
      // 🔇 게임의 식으로 냅니다(선언부 주석) — 프로브가 상수를 안 베끼게.
      hearWalk: hearDistance(PLAYER_CFG.moveSpeed),
      hearRun: hearDistance(PLAYER_CFG.moveSpeed * PLAYER_CFG.sprint.speedScale),
      frontArcDeg: AWARE.frontArcDeg,
      alertRadius: AWARE.alertRadius,
      sprintScale: PLAYER_CFG.sprint.speedScale,
      sprintViewScale: CAMERA.sprintViewScale,
      cameraViewSize: CAMERA.viewSize,
      cameraZoom: this.cam.currentZoom(),
      cameraPitchDeg: CAMERA.pitchDeg,
      cameraYawDeg: CAMERA.yawDeg,
      aimLeadMax: CAMERA.aimLeadMax,
      attackTempo: PLAYER_CFG.tempo.attackScale,
      inputBuffer: PLAYER_CFG.tempo.inputBuffer,
      dodgeDuration: PLAYER_CFG.dodge.duration,
      dodgeCooldown: PLAYER_CFG.dodge.cooldown,
      dodgeDistance: PLAYER_CFG.dodge.distance,
      walkSpeed: PLAYER_CFG.moveSpeed,
      maxStamina: PLAYER_CFG.maxStamina,
      bodyRadius: PLAYER_CFG.radius,
      dodgeStaminaCost: PLAYER_CFG.dodge.staminaCost,
      /** 스태미나 회복 — 실전 리듬이 성립하는지 재려면 프로브가 알아야 합니다. */
      staminaRegen: PLAYER_CFG.staminaRegen,
      staminaRegenDelay: PLAYER_CFG.staminaRegenDelay,
      dodgeCancelExtraCost: PLAYER_CFG.dodge.cancelExtraCost,
      focusPerLightHit: FOCUS.perLightHit,
      actorStates: {
        idle: ActorState.Idle,
        attack: ActorState.Attack,
        dodge: ActorState.Dodge,
        skill: ActorState.Skill,
      },
      levelAggroLead: LEVEL_AGGRO_LEAD,
      levelAggroMax: LEVEL_AGGRO_MAX,
      playerMoveSpeed: PLAYER_CFG.moveSpeed,
      playerRadius: PLAYER_CFG.radius,
      snareMoveScale: SNARE_MOVE_SCALE,
    }
  }

  /** 특정 엔티티의 상태를 그대로 읽습니다 — 낙하 검증용. */
  debugEntityState(e: number): {
    hp: number
    maxHp: number
    level: number
    state: number
    brokenT: number
    x: number
    z: number
    /**
     * 바라보는 방향 — **등 뒤를 재려면 반드시 필요합니다.**
     *
     * 이게 없어서 무기 프로브의 "등 뒤에서" 측정이 `undefined` 를 읽고
     * NaN 좌표로 순간이동했습니다. 55타 중 백어택 **0타**가 나왔는데도
     * 피해는 정상적으로 들어와서, 하마터면 *"쌍단검의 백어택은 이득이
     * 14%뿐"* 이라는 결론을 낼 뻔했습니다.
     */
    rotY: number
  } | null {
    if (!isAlive(e)) return null
    return {
      rotY: Number(Transform.rotY[e].toFixed(3)),
      hp: Number(Health.hp[e].toFixed(2)),
      maxHp: Health.max[e],
      level: this.terrain?.levelAtWorld(Transform.x[e], Transform.z[e]) ?? 0,
      state: Actor.state[e],
      brokenT: Number((hasComponent(Enemy, e) ? Enemy.brokenT[e] : 0).toFixed(2)),
      x: Number(Transform.x[e].toFixed(2)),
      z: Number(Transform.z[e].toFixed(2)),
    }
  }

  debugCounterCount(): number {
    return this.counterCount
  }

  debugPersist(): void {
    this.persistProgress()
  }

  debugTreasurePositions(): { x: number; z: number; taken: boolean; secret: boolean }[] {
    const ids = pickups.run()
    const out: { x: number; z: number; taken: boolean; secret: boolean }[] = []
    for (let i = 0; i < pickups.count; i++) {
      const e = ids[i]
      out.push({
        x: Number(Transform.x[e].toFixed(2)),
        z: Number(Transform.z[e].toFixed(2)),
        taken: Pickup.taken[e] === 1,
        /**
         * 🕯 **이 상자가 「비밀」인가** — 프로브가 무리를 가르는 데 씁니다.
         * 좌표로 짐작하게 두면 지도를 고치는 날 조용히 어긋납니다(이
         * 저장소가 좌표를 신분증으로 쓰다 세 번 데인 자리 — `Pickup.homeX`).
         */
        secret: Pickup.secret[e] === 1,
      })
    }
    return out
  }

  debugForceRespawn(): void {
    if (this.playerEntity >= 0) this.restAt(this.playerEntity, { x: 0, y: 0, z: 0, lit: true } as Bonfire)
  }

  debugWeaponUpgradeInfo(): {
    weapon: number
    level: number
    maxLevel: number
    nextCost: number
    nextStoneCost: number
    stones: number
    earnedStones: number
    damagePerLevel: number
    levels: number[]
    /** **지금 이 자리에서** 강화가 되는가. 봇이 거리를 다시 재지 않게. */
    atStation: boolean
    /** 안 되면 **왜** 안 되는가 — `'foe'`(적이 막음) · `'away'`(안 닿음) · `''`(된다). */
    blockedBy: '' | 'foe' | 'away'
  } {
    const p = this.playerEntity
    const w = Loadout.weapon[p]
    const level = weaponLevel(p, w)
    return {
      weapon: w,
      level,
      maxLevel: WEAPON_UPGRADE.maxLevel,
      nextCost: level < WEAPON_UPGRADE.costs.length ? WEAPON_UPGRADE.costs[level] : -1,
      earnedStones: this.stonesEarned,
      nextStoneCost:
        level < WEAPON_UPGRADE.stoneCosts.length ? WEAPON_UPGRADE.stoneCosts[level] : -1,
      stones: Player.stones[p],
      damagePerLevel: WEAPON_UPGRADE.damagePerLevel,
      levels: [Loadout.wLv0[p], Loadout.wLv1[p], Loadout.wLv2[p]],
      atStation: this.canSpendHere,
      blockedBy: this.spendBlock,
    }
  }

  debugRunStats(): {
    deaths: number
    rests: number
    kills: number
    restGeneration: number
    emberDecay: number
    enemySwings: number
    enemyHits: number
    poiseBreaks: number
    windupBreaks: number
    /** 🟢 예고가 끝난 방식 — 휘두름까지 / 적이 죽음 / 무너져 끊김 */
    greenSwung: number
    greenDied: number
    greenCountered: number
    greenBroken: number
    /** 무너진 순간의 평균 체력 비율(0~1) */
    breakHpAvg: number
    /** 무방비인 채로 죽은 적의 수 */
    brokenDeaths: number
    finishers: number
    /** 🚪 걸어서 닿을 수 없어 어그로가 풀린 횟수 — 그리고 가장 심했던 한 건 */
    deaggroUnreachable: number
    deaggroWorstWalk: number
    deaggroWorstStraight: number
    bossFinishers: number
    /** 연계가 예약된 횟수 — 실제 발동 수와 비교해 "안 나온다"의 원인을 가릅니다. */
    chainsArmed: number
    /** 예약이 실제로 쓰인 횟수 — 예약과 같은 자리에서 셉니다(enemyAI 설계 노트). */
    chainsFired: number
    /** 예약된 연계가 무너짐으로 끊긴 횟수 — `[예고, 휘두름, 후딜]` 박자별 */
    /** [예고 · 휘두름 · 후딜 · **일어나며 이어 냄**] — 마지막 칸은 잃은 것이 아닙니다. */
    chainsLost: [number, number, number, number]
    /** 무너짐 말고 다른 이유로 사라진 예약 — 장부가 맞아떨어지게(enemyAI 설계 노트). */
    chainsDropped: { phase: number; leash: number; death: number; overwrite: number }
    /** 판이 끝나는 순간 아직 예약을 안고 있는 적 수. */
    chainsPending: number
    /** 회피 한 번의 스태미나 값 — 봇이 상수를 베끼지 않게 게임이 알려줍니다. */
    dodgeStamina: number
    /** 지금까지 쓴 스태미나 누적 — 무기 효율을 정확히 재기 위해 게임이 셉니다. */
    staminaSpent: number
    /** 기둥 1 — 슬롯별 **실제 시전 횟수**(누른 횟수가 아님) */
    skillCasts: number[]
    /** 기둥 1 — 스태미나로 낸 기본 공격 횟수 */
    lightSwings: number
    /** 🩸 출혈이 터진 횟수 */
    bleedPops: number
    /** 🔨 실제로 깎은 강인도의 누적 (관측이 아니라 깎은 쪽이 셉니다) */
    poiseDealt: number
    /**
     * 💥 **적이 적을 스친 횟수.** 규칙을 넣을 때 세는 칸을 같이 넣습니다 —
     * 안 그러면 "있는지 없는지도 모르는 규칙"이 하나 늘어납니다.
     */
    crossfireHits: number
    /** 🩸 한 적에게 쌓였던 최고치 — "안 쌓임"과 "쌓였는데 안 터짐"을 가릅니다 */
    bleedPeak: number
    /**
     * 🩸 **「터짐 0회」가 왜 0회인지 가르는 값들** — 죽어서인가 식어서인가.
     * 처방이 정반대라 한 칸에 두면 안 됩니다(combat.ts `noteDeathWithBleed`).
     */
    bleedDecayedAll: number
    bleedDiedWith: number
    bleedDiedWithAvg: number
    bleedDiedWithMax: number
    /** 🩸 그 적들에게 **쌓았던** 총량의 평균 — 남은 것과 견주면 식은 몫. */
    bleedDiedBuiltAvg: number
    /** 🩸 죽기까지 맞은 횟수의 평균 — 쌓은 총량의 **분모**. */
    bleedDiedHitsAvg: number
    /**
     * ⚔️ **보스전에서 내가 무엇을 했는가.** 적 쪽 분해는 이미 있었는데
     * 내 쪽이 없어서, "왜 못 붙어 있는가"에 답할 값이 없었습니다.
     */
    bossTime: {
      total: number
      attack: number
      dodge: number
      guard: number
      stagger: number
      drink: number
      chase: number
      ready: number
      readyNoStamina: number
    }
    /** 🩸 보스에게만 — 이 축이 사는지 죽는지를 가르는 자리 */
    bossBleedPeak: number
    bossBleedPops: number
    /** 🩸 보스에게 **쌓은 총량** vs **식어서 날아간 총량** — 새는 곳을 가릅니다 */
    bossBleedApplied: number
    bossBleedDecayed: number
    /** 🩸 출혈 타격 사이의 간격(초) — 유예 안에 이어진 비율까지 */
    bossBleedGapAvg: number
    bossBleedGapMax: number
    bossBleedGapInsideRate: number
    /** ⏸ 보스가 **때릴 수 없는 상태**여서 유예를 안 먹은 시간(초) */
    bossBleedBlocked: number
    /** 📊 보스가 받은 피해 — 출처 × 페이즈. 무엇이 보스를 녹이는지 가릅니다 */
    bossDamageBySource: Record<string, number[]>
    /** 📊 잡몹을 죽인 것 — 출처별 피해와 **마지막 한 방** 횟수. */
    mobDamageBySource: Record<string, { dmg: number; kills: number }>
    /** 🥋 집중이 어디서 왔고 얼마나 흘렸고 얼마나 태웠는가 */
    focusFlow: { 평타: number; 완벽회피: number; 버림: number; 태움: number }
    /** 🍶 적이 회복을 노린 횟수 — 규칙이 실제로 도는가 */
    healPunished: number
    /** ⚔️ 상황 모션이 실제로 나간 횟수 */
    runAttacks: number
    rollAttacks: number
    /** 🪂 낙하 공격 — 떨어진 값을 위력으로 바꾼 횟수 */
    plungeAttacks: number
    /**
     * 💥 이번 판에 **터진 통** 수와 그 폭발에 **휘말린 몸** 수.
     *
     * 봇에게 이 동사를 가르치기 전에는 둘 다 0 이고, 그 0 은 *"안 쓸
     * 만하다"* 가 아니라 **"안 가르쳤다"** 입니다 — 이 저장소가 여러 번
     * 데인 자리라 벤치가 볼 수 있게 내보냅니다.
     */
    barrelsBlown: number
    /** 🎁💥 폭발에 밀려나 주울 수 있는 자리로 내려온 보물 수. */
    treasuresBlown: number
    barrelsCaught: number
    /** 💥 불붙일 때 담겼던 적의 합계 — 터질 때와의 차이가 「걸어 나간 수」. */
    barrelsLitCaught: number
    /** 이어짐 눈금 — 선입력이 실제로 일했는가 (playerControl.ts readInputFlow) */
    inputUsed: number
    inputExpired: number
    /**
     * 버려진 선입력을 **종류별로** 나눈 값. 셋의 처방이 서로 다르기
     * 때문입니다 — 근거는 playerControl.ts `inputFlow` 에 적어 뒀습니다.
     * 합계(`inputExpired`)는 게임이 한 곳에서 만들어 줍니다.
     */
    inputExpiredAttack: number
    inputExpiredDodge: number
    inputExpiredSkill: number
    inputDropped: number
    inputWaitAvg: number
    /** 공격/스킬을 끊고 구른 횟수. inputUsed 안에 **포함**된 값입니다. */
    inputCancels: number
  } {
    return {
      poiseBreaks: this.poiseBreaks,
      windupBreaks: this.windupBreaks,
      greenSwung: readGreenOutcome().swung,
      greenDied: readGreenOutcome().died,
      greenCountered: readGreenOutcome().countered,
      greenBroken: readGreenOutcome().broken,
      breakHpAvg: this.poiseBreaks > 0 ? Number((this.breakHpSum / this.poiseBreaks).toFixed(3)) : 0,
      brokenDeaths: this.brokenDeaths,
      finishers: this.finishers,
      deaggroUnreachable: this.deaggroCount,
      deaggroWorstWalk: Number(this.deaggroWorstWalk.toFixed(1)),
      deaggroWorstStraight: Number(this.deaggroWorstStraight.toFixed(1)),
      bossFinishers: this.bossFinishers,
      bleedPops: this.bleedPops,
      // 🔨 깎은 쪽이 센 강인도 누적 — 관측은 무너지는 한 방을 놓칩니다.
      poiseDealt: Number(readPoiseDealt().toFixed(1)),
      crossfireHits: readCrossfireHits(),
      bleedPeak: Number(readBleedPeak().any.toFixed(1)),
      bleedDecayedAll: Number(readBleedPeak().decayedAll.toFixed(1)),
      bleedDiedWith: readBleedPeak().diedWith,
      bleedDiedWithAvg: Number(readBleedPeak().diedWithAvg.toFixed(1)),
      bleedDiedWithMax: Number(readBleedPeak().diedWithMax.toFixed(1)),
      bleedDiedBuiltAvg: Number(readBleedPeak().diedBuiltAvg.toFixed(1)),
      bleedDiedHitsAvg: Number(readBleedPeak().diedHitsAvg.toFixed(1)),
      /** ⚔️ 보스전에서 **내** 시간이 어디로 갔는가 (초, 시뮬레이션 시간). */
      bossTime: { ...this.bossTime },
      // 🩸 보스에게만 따로 — 잡몹의 0이 보스의 값을 덮지 않게(combat.ts 주석).
      bossBleedPeak: Number(readBleedPeak().boss.toFixed(1)),
      bossBleedPops: readBleedPeak().bossPops,
      bossBleedApplied: Number(readBleedPeak().bossApplied.toFixed(1)),
      bossBleedDecayed: Number(readBleedPeak().bossDecayed.toFixed(1)),
      bossBleedGapAvg: Number(readBleedPeak().bossGapAvg.toFixed(2)),
      bossBleedGapMax: Number(readBleedPeak().bossGapMax.toFixed(2)),
      bossBleedGapInsideRate: Number(readBleedPeak().bossGapInsideRate.toFixed(2)),
      bossBleedBlocked: Number(readBleedPeak().bossBlocked.toFixed(2)),
      focusFlow: readFocusFlow(),
      healPunished: readHealPunish(),
      mobDamageBySource: Object.fromEntries(
        Object.entries(readMobDamageBySource()).map(([k, v]) => [
          k,
          { dmg: Number(v.dmg.toFixed(1)), kills: v.kills },
        ]),
      ),
      bossDamageBySource: Object.fromEntries(
        Object.entries(readBossDamageBySource()).map(([k, v]) => [
          k,
          v.map((n) => Number(n.toFixed(1))),
        ]),
      ),
      chainsArmed: readChainsArmed(),
      chainsFired: readChainsFired(),
      chainsDropped: readChainsDropped(),
      chainsPending: countChainsPending(),
      chainsLost: readChainsLost(),
      dodgeStamina: PLAYER_CFG.dodge.staminaCost,
      staminaSpent: Number(readStaminaSpent().toFixed(1)),
      skillCasts: readRhythm().skillCasts,
      lightSwings: readRhythm().lightSwings,
      runAttacks: readRhythm().runAttacks,
      rollAttacks: readRhythm().rollAttacks,
      plungeAttacks: readRhythm().plungeAttacks,
      barrelsBlown: this.barrelsBlown,
      treasuresBlown: this.treasuresBlown,
      barrelsCaught: this.barrelsCaught,
      barrelsLitCaught: this.barrelsLitCaught,
      inputUsed: readInputFlow().used,
      inputExpired: readInputFlow().expired,
      inputExpiredAttack: readInputFlow().expiredAttack,
      inputExpiredDodge: readInputFlow().expiredDodge,
      inputExpiredSkill: readInputFlow().expiredSkill,
      inputDropped: readInputFlow().dropped,
      inputWaitAvg: Number(readInputFlow().waitAvg.toFixed(3)),
      inputCancels: readInputFlow().cancels,
      deaths: this.deathCount,
      rests: this.restCount,
      kills: this.kills,
      restGeneration: this.restGeneration,
      enemySwings: this.enemySwings,
      enemyHits: this.enemyHits,
      emberDecay: Number(
        Math.max(EMBER.respawnFloor, EMBER.respawnDecay ** this.restGeneration).toFixed(3),
      ),
    }
  }

  /**
   * 가장 가까운 **소비처**(화톳불 또는 모루).
   *
   * 봇과 프로브가 "불티를 쓰러 어디로 가야 하나"를 물을 때 쓰는 값입니다.
   * 화톳불만 돌려주면 모루를 놓아도 아무도 안 갑니다 — 실제로 그런
   * 계기 버그를 열두 번 잡았습니다. 물건을 늘렸으면 **묻는 자리도**
   * 같이 늘려야 합니다.
   */
  /**
   * **소비처 전부**를 좌표로 내보냅니다. 고르는 것은 부르는 쪽입니다.
   *
   * ── 왜 "가장 가까운 하나"를 돌려주지 않는가 ────────────────────────
   * 처음엔 `debugNearestSpend()` 가 **직선거리**로 하나를 골라 줬습니다.
   * 그게 조용히 봇을 망가뜨렸습니다:
   *
   *   재료가 모이는 시각 98.9초 · 소비처에 닿을 수 있던 마지막 시각 139.6초
   *   → 40초의 창이 있는데도 **무기 강화 0/3판**
   *
   * 봇이 계단 위에 있을 때, 폐허의 화톳불은 **직선 20m**지만 성벽마루를
   * 돌아가야 해서 **걸어야 하는 거리는 98m** 입니다. 바로 옆(약 30m)의
   * 모루를 두고 그 화톳불을 고른 뒤, "너무 멀다"며 왕복을 접었습니다.
   *
   * 이 프로젝트에서 **직선거리로 고른 것**이 문제가 된 것은 이번이 세 번째
   * 입니다 — 적 어그로(성벽 건너 12.4m), 화톳불 막힘 판정, 그리고 여기.
   * 앞의 둘은 고쳐 놓고 주석까지 적었는데, **세 라운드 전에 제가 새로 쓴
   * 코드에서 같은 실수가 되살아났습니다.**
   *
   * 그래서 이번엔 고르는 일을 아예 안 합니다. 목록만 주고, **길찾기를
   * 가진 쪽**이 고르게 둡니다. 고르는 코드가 하나면 다시 어긋날 자리도
   * 하나입니다.
   */
  debugSpendPoints(): { x: number; z: number; anvil: boolean }[] {
    return [
      ...this.bonfires.map((f) => ({ x: f.x, z: f.z, anvil: false })),
      ...this.anvils.map((a) => ({ x: a.x, z: a.z, anvil: true })),
    ]
  }

  /**
   * 지금까지 안내한 예고 색들 — 검증용.
   * "색마다 한 번만"은 **안 일어나는 것**을 재는 조건이라, 시험을 안 쓰면
   * 두 번 뜨는 것을 아무도 모릅니다(모루 프로브와 같은 종류의 위험입니다).
   */
  debugFoeSwingLog(): Record<
    string,
    { swings: number; hits: number; deaths?: number }
  > {
    return this.foeSwingLog
  }

  debugSeenIntents(): number[] {
    return [...this.seenIntents]
  }

  /** 무기 강화 시도가 어느 갈림길에서 멈췄는가. */
  debugUpgradeTries(): { seen: number; notStation: number; consumed: number; noStone: number; noEmber: number; done: number } {
    return this.upgradeTries
  }

  /** 절벽 낙하 — 나 / 적 / 적의 총 낙차(단) / 종류별. */
  debugFallLog(): { player: number; foe: number; foeSteps: number; byKind: Record<string, number> } {
    return this.fallLog
  }

  /** 모루 목록 — 검증용(부활·회복을 **안 한다**는 것을 재려면 위치가 필요합니다). */
  debugAnvils(): { x: number; z: number }[] {
    return this.anvils.map((a) => ({ x: a.x, z: a.z }))
  }

  debugNearestBonfire(): { x: number; z: number } | null {
    const p = this.playerEntity
    let best: { x: number; z: number } | null = null
    let bestD = Infinity
    for (const f of this.bonfires) {
      const d = Math.hypot(f.x - Transform.x[p], f.z - Transform.z[p])
      if (d < bestD) {
        bestD = d
        best = { x: f.x, z: f.z }
      }
    }
    return best
  }

  /**
   * ── 🖥 **예고가 화면 안에 있었는가** — 몸과 위험 표시를 나눠서 ────────
   *
   * 피격 장부는 `unseen`("화면 밖에서 왔다")을 **적의 몸**으로 판정합니다.
   * 그런데 이 게임에서 위험을 말하는 것은 몸이 아니라 **지면의 예고
   * 부채꼴**입니다. 부채꼴은 적에게서 플레이어 쪽으로 뻗으므로, 적이
   * 화면 밖이어도 **내 발치에 걸쳐 있을 수 있습니다.**
   *
   * 이 구분이 없으면 처방이 갈립니다:
   *
   *   · 몸도 표시도 안 보였다 → 정말로 못 봤습니다. **고칠 것은 게임**
   *     (화면 밖 위협 표시를 넣거나, 그 사거리를 줄이거나).
   *   · 몸은 안 보였지만 표시는 보였다 → 플레이어는 알 수 있었습니다.
   *     **고칠 것은 계측기** — `unseen` 이 부풀어 있는 것입니다.
   *
   * 두 경우 모두 고칠 곳이 있고 서로 반대인데, 지금 장부는 둘을 한 칸에
   * 담고 있습니다. 이 저장소에서 그런 칸은 늘 엉뚱한 곳을 고치게 했습니다.
   *
   * 세로 22m 화면(±11m)에 사거리 12m 짜리 공격이 둘 있습니다(🏹 궁수 ·
   * 🟣 끄는 자). 화면 세로 방향이면 몸은 **원리적으로** 화면 밖입니다.
   * 그러니 이 질문은 가정이 아니라 이미 벌어지고 있는 일입니다.
   *
   * `cueSeen` 은 부채꼴 윤곽을 여러 점으로 떠서 **그중 몇이 화면 안인지**
   * 봅니다. 한 점(예: 부채꼴 중심)만 보면 그 점이 하필 화면 밖일 때
   * "안 보인다"고 답하는데, 실제로는 나머지가 다 보이는 경우가 있습니다.
   */
  debugTelegraphView(): Array<{
    entity: number
    kind: number
    id: string
    intent: number
    dist: number
    bodySeen: boolean
    cueSeen: boolean
  }> {
    const p = this.playerEntity
    const out: ReturnType<Game['debugTelegraphView']> = []
    const ids = enemyQuery.run()
    for (let i = 0; i < enemyQuery.count; i++) {
      const e = ids[i]
      if (!isAlive(e) || Actor.state[e] !== ActorState.Attack) continue
      if (Actor.phase[e] !== AttackPhase.Windup) continue
      const def = attackAt(Enemy.kind[e], Enemy.attackIndex[e])
      out.push({
        entity: e,
        kind: Enemy.kind[e],
        id: def.id,
        intent: def.intent,
        dist: Number(
          Math.hypot(Transform.x[e] - Transform.x[p], Transform.z[e] - Transform.z[p]).toFixed(2),
        ),
        bodySeen: this.onScreen(e),
        cueSeen: this.cueOnScreen(e),
      })
    }
    return out
  }

  debugTravelInfo(): { lit: number; opened: boolean; key: string } {
    return {
      lit: this.bonfires.filter((f) => f.lit).length,
      opened: (this.terrain?.shortcuts ?? []).some((s) => s.kind === 'ladder' && s.open),
      key: TRAVEL_KEY,
    }
  }

  debugCameraAxes(): { forwardX: number; forwardZ: number; rightX: number; rightZ: number } {
    return {
      forwardX: this.cam.forward.x,
      forwardZ: this.cam.forward.z,
      rightX: this.cam.right.x,
      rightZ: this.cam.right.z,
    }
  }

  debugObjective(): {
    x: number
    z: number
    label: string
    dist: number
    /** 다음에 향할 지점 — 벽을 돌아가는 경로의 한 걸음. 길이 없으면 목표와 같습니다. */
    stepX: number
    stepZ: number
    /** 실제로 걸어야 하는 거리(m). 길이 없으면 직선 거리. */
    walkDist: number
  } | null {
    const p = this.playerEntity
    const px = Transform.x[p]
    const pz = Transform.z[p]
    const o = this.findObjective(px, pz)
    if (!o) return null
    let stepX = o.x
    let stepZ = o.z
    let walkDist = o.dist
    if (this.terrain) {
      this.terrain.buildFlowField(o.x, o.z)
      const step = this.terrain.nextStepToward(px, pz)
      if (step) {
        stepX = step.x
        stepZ = step.z
      }
      const d = this.terrain.pathDistance(px, pz)
      if (d !== null) walkDist = d
    }
    return { ...o, stepX, stepZ, walkDist }
  }

  debugBossEncounter(): {
    entity: number
    encounter: number
    aggro: number
    hp: number
    maxHp: number
    phase: number
    homeDist: number
    selfHomeDist: number
    arenaRadius: number
    leashRadius: number
    leashT: number
    leashGrace: number
    /**
     * 🎓 지금 **1단계 학습 잠금**이 페이즈를 붙잡고 있는가(enemyAI 설계 노트).
     * 이게 없어서 아레나 프로브의 검사 셋이 아주 오래 빨간 채로 있었습니다 —
     * 체력을 깎아도 페이즈가 안 올라가는데 **이유를 아무도 말해 주지
     * 않았습니다.**
     */
    teachHold: { holding: boolean; seen: number; need: number }
  } | null {
    const ids = enemyQuery.run()
    for (let i = 0; i < enemyQuery.count; i++) {
      const e = ids[i]
      if (Enemy.kind[e] !== EnemyKind.Boss) continue
      const p = this.playerEntity
      return {
        entity: e,
        encounter: Enemy.encounter[e],
        aggro: Enemy.aggro[e],
        hp: Number(Health.hp[e].toFixed(1)),
        maxHp: Health.max[e],
        phase: Enemy.phase[e],
        homeDist: Number(
          Math.hypot(Transform.x[p] - Enemy.homeX[e], Transform.z[p] - Enemy.homeZ[e]).toFixed(2),
        ),
        selfHomeDist: Number(
          Math.hypot(Transform.x[e] - Enemy.homeX[e], Transform.z[e] - Enemy.homeZ[e]).toFixed(2),
        ),
        arenaRadius: BOSS_ARENA.radius,
        leashRadius: BOSS_ARENA.leashRadius,
        leashT: Number(Enemy.leashT[e].toFixed(2)),
        leashGrace: BOSS_ARENA.leashGrace,
        teachHold: phaseTeachHold(e),
      }
    }
    return null
  }

  debugEmberInfo(): {
    embers: number
    vialsMax: number
    drop: { x: number; z: number; amount: number } | null
    upgradeCost: number
  } {
    const p = this.playerEntity
    const step = Player.vialsMax[p] - VIAL.charges
    const cost =
      Player.vialsMax[p] >= EMBER.vialMax || step >= EMBER.vialUpgradeCosts.length
        ? -1
        : EMBER.vialUpgradeCosts[step]
    return {
      embers: Player.embers[p],
      vialsMax: Player.vialsMax[p],
      drop: this.drop ? { x: this.drop.x, z: this.drop.z, amount: this.drop.amount } : null,
      upgradeCost: cost,
    }
  }

  debugSetEmbers(n: number): void {
    Player.embers[this.playerEntity] = Math.max(0, n)
  }

  /**
   * ── 💰 **경제 원장** — `npm run economy` 가 읽습니다 ────────────────
   *
   * ── 왜 게임이 내보내는가 ──────────────────────────────────────────
   * 이 값들을 프로브에 베껴 적으면, 밸런스를 손보는 날 검사가 **조용히
   * 거짓**이 됩니다. 이 저장소가 가장 여러 번 데인 모양이라
   * (`npm run vial` 의 `heal` 도 같은 이유로 여기서 나갑니다) 규칙은
   * 한 곳에만 두고 프로브는 **읽기만** 합니다.
   *
   * ── 왜 지도의 census 까지 같이 내보내는가 ─────────────────────────
   * 경제의 질문은 **표 하나로 답이 안 나옵니다.** *"만렙 비용이 1750"*
   * 은 그 자체로는 비싼지 싼지를 말하지 않습니다. *"이 존을 한 바퀴 돌면
   * 얼마가 들어오는가"* 와 나란히 놓여야 비로소 문장이 됩니다.
   * 그래서 **공급(지도)과 가격(표)을 같은 호출에서** 냅니다 — 둘을 따로
   * 읽으면 서로 다른 판의 숫자를 비교하게 될 수 있습니다.
   *
   * ⚠️ 적 수는 `levelData` 의 **원본 배치**를 셉니다. 지금 살아 있는 적을
   *    세면 되살아난 적까지 들어가서 *"한 바퀴"* 가 아니게 됩니다.
   */
  debugEconomy(): {
    weapon: { maxLevel: number; costs: number[]; stoneCosts: number[] }
    vial: { costs: number[]; max: number; start: number }
    stone: { perTreasure: number; perBoss: number }
    respawn: { decay: number; floor: number }
    zone: {
      name: string
      foes: { id: string; count: number; ember: number }[]
      chests: number
      urnChests: number
      anvils: number
      bonfires: number
      /**
       * 🧭 **소비처와 끝점의 자리** — 개수만으로는 못 묻는 질문이 있습니다.
       * *"불티가 80 모였다"* 와 *"그걸 쓸 수 있다"* 는 다른 말이고,
       * 둘을 가르는 것은 **모루가 어디 서 있는가**뿐입니다.
       */
      anvilAt: { x: number; z: number }[]
      bonfireAt: { x: number; z: number }[]
      bossAt: { x: number; z: number } | null
    }
  } {
    const items = this.levelData?.entities ?? []
    // 적 종류별로 모읍니다 — 종류가 아니라 마릿수만 세면 "정예 하나가
    // 잡몹 일곱 몫"이라는 사실이 합계 안에서 사라집니다.
    const foes = new Map<string, { id: string; count: number; ember: number }>()
    let chests = 0
    let urnChests = 0
    let anvils = 0
    let bonfires = 0
    const anvilAt: { x: number; z: number }[] = []
    const bonfireAt: { x: number; z: number }[] = []
    let bossAt: { x: number; z: number } | null = null
    for (const it of items) {
      const kind = kindFromId(it.kind)
      if (kind !== null) {
        const def = enemyDef(kind)
        const row = foes.get(def.id) ?? { id: def.id, count: 0, ember: def.ember }
        row.count++
        foes.set(def.id, row)
        if (kind === EnemyKind.Boss) bossAt = { x: it.x, z: it.z }
        continue
      }
      if (it.kind === 'treasure') chests++
      // 🏺 항아리 속 상자는 **깨면 같은 상자가 그대로 나옵니다**(world.ts).
      //    보상이 같으니 공급으로도 같이 세야 합니다. 따로 내보내는 이유는
      //    "숨어 있다"와 "놓여 있다"를 프로브가 나눠 말할 수 있게 하려고.
      else if (it.kind === 'urnFull') urnChests++
      else if (it.kind === 'anvil') {
        anvils++
        anvilAt.push({ x: it.x, z: it.z })
      } else if (it.kind === 'bonfire') {
        bonfires++
        bonfireAt.push({ x: it.x, z: it.z })
      }
    }
    return {
      weapon: {
        maxLevel: WEAPON_UPGRADE.maxLevel,
        costs: [...WEAPON_UPGRADE.costs],
        stoneCosts: [...WEAPON_UPGRADE.stoneCosts],
      },
      vial: { costs: [...EMBER.vialUpgradeCosts], max: EMBER.vialMax, start: VIAL.charges },
      stone: {
        perTreasure: WEAPON_UPGRADE.stonePerTreasure,
        perBoss: WEAPON_UPGRADE.stonePerBoss,
      },
      respawn: { decay: EMBER.respawnDecay, floor: EMBER.respawnFloor },
      zone: {
        name: this.levelName,
        foes: [...foes.values()].sort((a, b) => b.count * b.ember - a.count * a.ember),
        chests,
        urnChests,
        anvils,
        bonfires,
        anvilAt,
        bonfireAt,
        bossAt,
      },
    }
  }

  /** 살아 있는 적을 전부 죽입니다 — 처치 보상이 실제로 붙는지 보려고. */
  debugKillAll(): number {
    const ids = enemyQuery.run()
    let n = 0
    for (let i = 0; i < enemyQuery.count; i++) {
      const e = ids[i]
      if (Actor.state[e] === ActorState.Dead) continue
      Health.hp[e] = 0
      n++
    }
    return n
  }

  debugVialInfo(): {
    vials: number
    max: number
    /**
     * 한 병이 되돌리는 체력.
     *
     * 프로브가 "이만큼 잃었다"를 판단하려면 **되돌릴 수 있는 단위**가
     * 있어야 합니다. 이 값을 프로브에 베껴 적으면 밸런스를 바꾼 날
     * 검사가 조용히 거짓이 됩니다 — 그래서 게임이 내보냅니다.
     */
    heal: number
    hp: number
    state: number
    drinking: boolean
    bonfires: number
    hasRespawn: boolean
    restProgress: number
    restCount: number
  } {
    const p = this.playerEntity
    return {
      vials: Player.vials[p],
      max: Player.vialsMax[p],
      heal: VIAL.heal,
      hp: Number(Health.hp[p].toFixed(1)),
      state: Actor.state[p],
      drinking: Actor.state[p] === ActorState.Drink,
      bonfires: this.bonfires.length,
      hasRespawn: Player.hasRespawn[p] === 1,
      restProgress: Number(Player.restT[p].toFixed(3)),
      restCount: this.restCount,
    }
  }

  /**
   * 실험대 전용 스폰은 **깨어 있는 적**을 냅니다 (`asleep: true` 로만 재웁니다).
   *
   * ── 왜 기본값이 "깨어 있음"인가 ──────────────────────────────────
   * 인지를 방향으로 나눈 뒤, 이 훅으로 적을 낳는 프로브 **스무 개**가
   * 조용히 뜻을 잃었습니다. 적은 낳을 때 원점을 보므로 무대에 따라
   * 등을 보이고, 그러면 가만히 선 계측기를 **영영 못 봅니다.** 증상은
   * 프로브마다 다르게 나타납니다 —
   *   · `audio`  → *"진폭 0.0000 · 시뮬레이션 29.1초"*
   *   · `poise`  → *"가만히 두면 잡몹이 공격 0회"*
   *   · `cover`  → *"궁수가 안 쏨"* (+ 그 아래 검사 넷이 전부 −0)
   *   · `rules`  → *"20초 안에 갈고리를 걸지 않았습니다"*
   * 전부 같은 원인인데 **한 번도 같은 말로 나오지 않습니다.** 그래서
   * 하나씩 만날 때마다 매번 게임을 의심하게 됩니다.
   *
   * 이 훅의 원래 계약은 *"나와 싸울 적을 세워 달라"* 였습니다. 계약이
   * 그랬으면 계약대로 두는 것이 맞습니다 — 스무 파일에 같은 줄을
   * 붙여 넣는 것은 **다음에 프로브를 쓰는 사람이 그 줄을 모른다**는
   * 문제를 하나도 안 풉니다.
   *
   * 못 본 적이 필요한 쪽(`flank`·`notice`)은 **그렇게 적어서** 부릅니다.
   * 드문 쪽이 말하게 하는 것이 규칙입니다.
   */
  debugSpawnKind(id: string, x: number, z: number, asleep = false): number {
    const kind = kindFromId(id)
    if (kind === null) return -1
    const e = spawnEnemy(kind, x, z)
    if (this.terrain) Transform.y[e] = this.terrain.groundYAt(x, z)
    if (!asleep) Enemy.aggro[e] = 1
    this.visuals.attach(e, Renderable.kind[e])
    return e
  }

  debugSpawnBoss(x: number, z: number): number {
    const e = spawnEnemy(EnemyKind.Boss, x, z)
    if (this.terrain) Transform.y[e] = this.terrain.groundYAt(x, z)
    this.visuals.attach(e, Renderable.kind[e])
    return e
  }

  /**
   * 동시 공격 부하 측정.
   *
   * 플레이 테스트 피드백: "여러 명이 겹쳤을 때 피하기가 쉽지 않다."
   * 공격 하나하나의 크기를 아무리 줄여도, **여럿이 동시에 걸면** 도망칠 방향의
   * 합집합이 사라져 피할 수 없게 됩니다. 즉 이 문제는 개별 공격의 수치가 아니라
   * **동시성**의 문제이고, 그렇다면 측정해야 할 것도 동시에 걸리는 개수입니다.
   */
  debugAttackLoad(): { attacking: number; telegraphing: number; wideTelegraphs: number } {
    const ids = enemyQuery.run()
    let attacking = 0
    let telegraphing = 0
    let wideTelegraphs = 0
    for (let i = 0; i < enemyQuery.count; i++) {
      const e = ids[i]
      if (Actor.state[e] !== ActorState.Attack) continue
      attacking++
      if (Actor.phase[e] !== AttackPhase.Windup) continue
      telegraphing++
      if (attackAt(Enemy.kind[e], Enemy.attackIndex[e]).arcDeg >= 180) {
        wideTelegraphs++
      }
    }
    return { attacking, telegraphing, wideTelegraphs }
  }

  debugRefreshLoadout(): void {
    this.refreshLoadout()
  }

  /** 트라이포드가 실제로 적용된 뒤의 수치. 데이터가 아니라 **결과**를 검증합니다. */
  debugEffectiveSkill(slot: number): Record<string, number | string> | null {
    const def = skillForSlot(this.playerEntity, slot)
    if (!def) return null
    return {
      id: def.id,
      shape: def.shape,
      damage: Number(def.damage.toFixed(2)),
      range: Number(def.range.toFixed(2)),
      arcDeg: Number(def.arcDeg.toFixed(1)),
      cooldown: Number(def.cooldown.toFixed(2)),
      hits: def.hits,
      snare: Number(def.snare.toFixed(2)),
      dash: Number(def.dash.toFixed(2)),
    }
  }

  debugSaveInfo(): { saveId: string; treasuresTaken: number } {
    return { saveId: this.saveId, treasuresTaken: this.takenTreasures.size }
  }

  debugTripodInfo(): { points: number; panelOpen: boolean } {
    return { points: tripodPoints(), panelOpen: this.tripodPanel.isOpen() }
  }

  debugToggleTripodPanel(): void {
    this.tripodPanel.toggle()
  }

  debugApplySnare(seconds: number): void {
    Status.snareT[this.playerEntity] = seconds
  }

  debugSpawnVfx(kind: 'spark' | 'damage' | 'swing'): void {
    const x = Transform.x[this.playerEntity]
    const z = Transform.z[this.playerEntity] + 2.5
    const y = Transform.y[this.playerEntity]
    if (kind === 'spark') this.vfx.spawnHitSpark(x, y + 1.0, z, 1)
    else if (kind === 'damage') this.vfx.spawnDamage(x, y + 1.4, z, 62, { back: true, crit: true })
    else this.vfx.spawnSwing(x, z, 0, 2.7, 150)
  }

  private sampleRequested = false
  private lastSample: {
    uniqueColors: number
    meanLuma: number
    darkRatio: number
    bgRatio: number
  } | null = null

  /**
   * 렌더 직후 프레임버퍼를 직접 읽어 "화면이 정말 그려졌는지" 통계를 냅니다.
   *
   * 왜 필요한가: 이 프로젝트에서 실제로 겪은 일 — 타입 검사도 통과하고,
   * 이동/전투 로직 테스트 24개도 전부 통과했는데, 안개 설정 실수로 **화면이
   * 통째로 검게** 나왔습니다. 로직 테스트로는 절대 잡히지 않는 종류의 버그입니다.
   * 이제 자동 검증이 이 함수로 "새까만 화면"을 직접 잡아냅니다.
   */
  private readFramebuffer(): {
    uniqueColors: number
    meanLuma: number
    darkRatio: number
    bgRatio: number
  } {
    const gl = this.renderer.getContext()
    const canvasEl = this.renderer.domElement
    // 화면의 상당 부분을 봅니다. 좁게 보면 평평한 바닥 한가운데만 잡혀서
    // "색이 2종뿐"이라는 이유로 정상 화면을 실패 처리하게 됩니다.
    const w = Math.min(320, canvasEl.width)
    const h = Math.min(200, canvasEl.height)
    const x = Math.max(0, ((canvasEl.width - w) / 2) | 0)
    const y = Math.max(0, ((canvasEl.height - h) / 2) | 0)
    const px = new Uint8Array(w * h * 4)
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)

    const seen = new Set<number>()
    let lumaSum = 0
    let dark = 0
    let background = 0
    const total = w * h
    for (let i = 0; i < total; i++) {
      const r = px[i * 4]
      const g = px[i * 4 + 1]
      const b = px[i * 4 + 2]
      // 5비트로 양자화 — 미세한 노이즈를 서로 다른 색으로 세지 않기 위해서입니다.
      seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3))
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      lumaSum += luma
      if (luma < 18) dark++
      // 씬 배경색(0x0d1017)과 거의 같은 픽셀 = 아무것도 안 그려진 곳.
      // "3D가 정말 그려졌는가"를 재는 가장 직접적인 지표입니다.
      if (Math.abs(r - 13) < 8 && Math.abs(g - 16) < 8 && Math.abs(b - 23) < 8) background++
    }
    return {
      uniqueColors: seen.size,
      meanLuma: Number((lumaSum / total).toFixed(2)),
      darkRatio: Number((dark / total).toFixed(3)),
      bgRatio: Number((background / total).toFixed(3)),
    }
  }

  /** 다음 프레임 렌더 직후에 픽셀 통계를 수집하도록 예약합니다. */
  requestSample(): void {
    this.sampleRequested = true
    this.lastSample = null
  }

  getSample() {
    return this.lastSample
  }

  /** 커서를 특정 월드 좌표로 옮깁니다(자동 검증용). 카메라 투영을 그대로 통과시켜
   *  screenToGround 와의 왕복 정확도까지 함께 검증됩니다. */
  aimAtWorld(x: number, z: number): void {
    const y = Transform.y[this.playerEntity]
    const v = new THREE.Vector3(x, y, z).project(this.cam.camera)
    debugInput.setMouseNdc(v.x, v.y)
  }

  /** 가장 가까운 적 (검증 및 디버깅용) */
  private nearestEnemy(): {
    /**
     * **엔티티 번호.** 이게 없어서 봇의 「등 뒤로 돌기」 가지가 **한 번도
     * 실행되지 않았습니다.**
     *
     * 봇은 `G.entityState(near.entity)` 로 그 적의 방향을 읽으려 했는데,
     * 이 객체에 `entity` 가 없어서 `undefined` 가 넘어갔고, 돌아온 null 이
     * 그대로 조건을 막았습니다. **오류도 경고도 없었습니다** — 가지가
     * 조용히 없는 것과 같아졌고, 그 상태로 여러 라운드 동안 "백어택이 왜
     * 6~7% 인가"를 논했습니다. 자동 플레이 여덟 판의 가지 분포에서
     * 「돌기」는 **0%**, 아예 목록에 없었습니다.
     */
    entity: number
    x: number
    z: number
    dist: number
    hp: number
    playerBehind: boolean
  } | null {
    const p = this.playerEntity
    let best: { entity: number; x: number; z: number; dist: number; hp: number; playerBehind: boolean } | null = null
    const ids = enemyQuery.run()
    for (let i = 0; i < enemyQuery.count; i++) {
      const e = ids[i]
      if (!isAlive(e) || e === p) continue
      if (Actor.state[e] === ActorState.Dead) continue
      /**
       * 예전엔 렌더 종류를 `kind !== 1 && kind !== 3`(잡몹·보스)으로 박아
       * 뒀는데, 적 종류를 늘리자 **얽는 자·끄는 자가 안 세어졌습니다.**
       * 오류도 안 나고 화면도 멀쩡해서 눈으로는 못 잡는 종류의 버그입니다.
       * 이제 "Enemy 컴포넌트를 가졌는가"로만 판단하므로 새 적이 저절로 포함됩니다.
       */
      const d = Math.hypot(Transform.x[e] - Transform.x[p], Transform.z[e] - Transform.z[p])
      if (!best || d < best.dist) {
        best = {
          x: Transform.x[e],
          z: Transform.z[e],
          dist: d,
          hp: Health.hp[e],
          entity: e,
          playerBehind: isBackAttack(p, e),
        }
      }
    }
    return best
  }

  /**
   * 주변 적의 **위협 상태**.
   *
   * 자동 플레이 봇이 반격을 배우려면 "지금 초록이 뜬 적이 누구고, 내가 그
   * 정면에 있는가"를 알아야 합니다. 지금까지 봇은 `telegraphing` 개수만 보고
   * 무조건 굴렀는데, 그러면 초록의 정답(앞으로 나가 스킬)을 **영영 못 배웁니다.**
   * 사람은 화면에서 색과 자기 위치를 봅니다 — 봇에게도 같은 정보를 줍니다.
   */
  /**
   * 🎯 **가장 멀리 닿는 한 대의 사거리**(m) — 재는 쪽이 자기 숫자를 안 들게.
   *
   * 봇이 `threats(9)` 로 물어보고 있었는데 갈고리·화살은 12m 입니다.
   * 자세한 사연은 enemyAttacks.ts `longestReach` 주석에 한 번만 적어 뒀습니다.
   */
  debugThreatRange(): number {
    return Number((longestReach() + Body.radius[this.playerEntity]).toFixed(2))
  }

  debugThreats(range = 14): {
    entity: number
    /** 🏷 적의 종류 id — 화면의 색·실루엣과 같은 정보입니다(구현부 주석). */
    kind: string
    /**
     * 🚦 지금 이 적을 막고 있는 문.
     * · 토큰만 — 토큰만 있었으면 **지금 쐈을** 프레임 (진짜 병목)
     * · 토큰+  — 토큰이 있어도 못 쐈을 프레임 (쿨다운·바라보기가 겹침)
     * 둘을 합치면 「토큰 탓」이 부풀려집니다(enemyAI 같은 자리 주석).
     */
    idleWhy: string
    x: number
    z: number
    dist: number
    /**
     * 🚪 이 적이 나에게 오는 **걸어야 하는 거리**(m). 지형 규칙이 없으면 null.
     * 깨는 판정이 쓰는 값입니다 — 직선(`dist`)과 견주면 안 됩니다(구현부 주석).
     */
    walk: number | null
    /** AttackIntent. -1 = 공격 중이 아님 */
    intent: number
    aggro: boolean
    winding: boolean
    /** 내가 이 적의 정면에 있는가 (반격 가능 방향) */
    inFront: boolean
    /**
     * ⏳ **남은 예고 시간**(초). 예고 중이 아니면 0.
     *
     * ── 왜 이게 없어서 가지 하나가 죽었나 ──────────────────────────
     * 봇에게 저스트 가드를 가르치면서 `t.timer <= 창 × 2.5` 라고 썼는데,
     * 이 목록에 `timer` 가 **없었습니다.** `undefined <= 0.45` 는 언제나
     * 거짓이라 그 가지가 통째로 죽었고, 한 판에서 **시도 0회**가 나왔습니다.
     * 기둥 3 이 여러 라운드 동안 죽어 있던 것과 같은 모양입니다.
     *
     * ── 봇에게 숨은 정보를 주는 것이 아닙니다 ──────────────────────
     * 예고 도형의 **투명도가 남은 시간 비율**로 계산됩니다(가득 찰수록
     * 진해집니다). 즉 사람도 화면에서 이 값을 보고 있습니다. 안 보이는
     * 것을 봇에게 주면 봇이 사람보다 잘하게 되어 밸런스가 거짓이 되는데,
     * 이건 **보이는 것을 숫자로 준 것**입니다.
     */
    timer: number
    /**
     * 🎯 **이 예고가 지금 내 자리에 닿는가.**
     *
     * ── 왜 필요했나 (잰 숫자) ──────────────────────────────────────
     * 봇에게 저스트 가드를 가르쳤더니 이랬습니다:
     *
     *     붙잡은 🔴 5회 · **창을 연 것 5회 · 헛친 것 5회 · 성공 0회**
     *
     * 스팸이 아니었습니다(연 횟수 = 붙잡은 횟수). 연 것이 **전부** 헛쳤습니다.
     * 원인은 봇이 `dist < 4.5` 로 붙잡았다는 것 — 그런데 잡몹의 찌르기는
     * 사거리가 **2.5m** 입니다. **닿지도 않을 공격을 막으려고** 창을 열고
     * 기력을 냈습니다. 막을 것이 없으니 당연히 100% 헛칩니다.
     *
     * 봇이 사거리를 자기 쪽에 적어 두면 밸런스를 바꾸는 날 봇만 옛 값을
     * 씁니다. 그래서 **게임이 판단해서 내보냅니다** — 판정과 같은 식
     * (combat.ts `shapeDist`: `dist <= reach + 내 반지름`)을 씁니다.
     */
    willReach: boolean
    /**
     * 👁 **내가 이 적을 보고 있는가.**
     *
     * `inFront` 와 **반대 방향**입니다 — 저건 *"내가 적의 정면에 있는가"*
     * (반격 조건)이고, 이건 *"적이 내 정면에 있는가"* (가드 조건)입니다.
     * 둘을 한 칸으로 두면 반드시 헷갈립니다.
     *
     * ── 왜 필요했나 (계산으로 좁혀진 것) ──────────────────────────
     * 봇이 22번 붙잡아 12번 열었는데 **11번 헛쳤습니다.** 남은 원인을
     * 산수로 좁히니 하나가 남았습니다:
     *
     *     플레이어 회전 900°/s → 180° 도는 데 **0.200초**
     *     가드 창 **0.18초**
     *
     * 즉 등지고 있다가 누르는 순간 조준을 돌리면 **물리적으로 못 돌립니다.**
     * 가드는 **이미 보고 있어야** 성립합니다 — 설계상 옳고(맞서는 기술),
     * 봇은 그걸 몰랐습니다.
     */
    facing: boolean
    hp: number
  }[] {
    const p = this.playerEntity
    const out: ReturnType<Game['debugThreats']> = []
    const ids = enemyQuery.run()
    for (let i = 0; i < enemyQuery.count; i++) {
      const e = ids[i]
      if (!isAlive(e) || e === p || Actor.state[e] === ActorState.Dead) continue
      const d = Math.hypot(Transform.x[e] - Transform.x[p], Transform.z[e] - Transform.z[p])
      if (d > range) continue
      const attacking = Actor.state[e] === ActorState.Attack
      out.push({
        entity: e,
        /**
         * 🚪 **이 적이 나에게 오는 «걸어야 하는» 거리**(m). 규칙이 없으면 null.
         *
         * ── 왜 이 줄을 더하는가 (틀린 라벨 하나 때문에) ────────────────
         * 자동 플레이의 쏘는 자 장부가 이렇게 찍었습니다:
         *
         *     (61,27) 가장 가까이 **17.4m**(걸어서 24.0m) · 깨는거리 안
         *     134프레임 · 깨어 있던 0프레임 — *"깨는 거리 안에 들어갔는데
         *     **안 깼다**"*
         *
         * 게임은 안 틀렸습니다. 깨는 판정은 **걸어야 하는 거리**로 하고
         * (바로 위 `wakeRangeOf` 자리의 설계 노트 — 벽 건너 적이 깨어나
         * 영원히 벽을 향해 걷던 사고), 걸어서는 24m 라 19m 밖입니다.
         * **틀린 것은 장부의 라벨**이었습니다 — 직선 17.4m 를 깨는 거리와
         * 견주고 있었습니다.
         *
         * 이 저장소가 직선/경로를 혼동해 낸 **네 번째** 사고입니다. 앞의
         * 셋에서 배운 처방을 그대로 씁니다: 프로브가 자기 자로 다시 재게
         * 두지 말고, **게임이 판정에 쓴 바로 그 값을 내보냅니다.**
         *
         * ⚠️ 값싼 줄입니다 — 흐름장은 AI 때문에 매 프레임 이미 서 있고,
         *    여기서는 **한 칸 읽기**만 합니다(BFS 를 새로 돌리지 않습니다).
         *    프로브가 대신 쓰던 `pathStep` 은 흐름장을 **다시 세워서**
         *    안내까지 흔들었습니다.
         */
        walk: reachDistanceOf(Transform.x[e], Transform.z[e]),
        /**
         * 🏷 **이 적의 종류**(`grunt`·`archer`…).
         *
         * ── 봇에게 숨은 정보를 주는 것이 아닙니다 ──────────────────
         * 적마다 **색과 실루엣이 다릅니다.** 쏘는 자는 일부러 밝고 차가운
         * 색(0x8fb3c9)을 줬는데, 그 근거가 `enemies.ts` 에 이렇게 적혀
         * 있습니다 — *"멀리 있는 실루엣이 배경에 묻히면 「저기서 쏘고
         * 있다」를 못 읽습니다."* 즉 사람도 화면에서 종류를 읽습니다.
         *
         * ── 왜 필요했나 ────────────────────────────────────────────
         * 자동 플레이 기록에 쏘는 자가 **한 줄도 없었습니다**(예고 0회).
         * 그런데 `npm run archer` 로 같은 자리를 실제로 걸어 보니
         * **두 발**이 정확히 날아왔습니다. 모델도 배치도 맞는데 판에서만
         * 0 이라면 남은 갈림길은 *"봇이 거기를 안 걷는다"* 인데,
         * 종류가 없으면 그 장부를 **적을 수가 없습니다.**
         */
        kind: enemyDef(Enemy.kind[e]).id,
        /**
         * 🚦 **이 적이 지금 못 때리는 이유** (components.ts `idleWhy`).
         * 「사거리 안에 있었는데 예고 0회」의 범인을 이름으로 부릅니다 —
         * 토큰인지 쿨다운인지 바라보기인지 띠 밖인지에 따라 고칠 곳이
         * 전부 다릅니다.
         */
        idleWhy:
          ['없음', '토큰만', '쿨다운', '바라보기', '띠밖', '토큰+'][Enemy.idleWhy[e]] ?? '?',
        x: Number(Transform.x[e].toFixed(2)),
        z: Number(Transform.z[e].toFixed(2)),
        dist: Number(d.toFixed(2)),
        intent: attacking ? attackAt(Enemy.kind[e], Enemy.attackIndex[e]).intent : -1,
        /** 나를 쫓고 있는가 — "몇 마리를 동시에 상대하는가"를 재려면 필요합니다. */
        aggro: Enemy.aggro[e] === 1,
        winding: attacking && Actor.phase[e] === AttackPhase.Windup,
        timer:
          attacking && Actor.phase[e] === AttackPhase.Windup
            ? Number(Actor.timer[e].toFixed(3))
            : 0,
        // 판정과 **같은 식**입니다(combat.ts `shapeDist`) — 대상의 굵기를 더합니다.
        willReach:
          attacking && d <= attackAt(Enemy.kind[e], Enemy.attackIndex[e]).reach + Body.radius[p],
        /** 가드 판정과 **같은 함수**입니다(combat.ts) — 뜻이 두 개가 되지 않게. */
        facing: !isBehindPoint(
          Transform.x[e],
          Transform.z[e],
          Transform.x[p],
          Transform.z[p],
          Transform.rotY[p],
        ),
        inFront: !isBehindPoint(
          Transform.x[p],
          Transform.z[p],
          Transform.x[e],
          Transform.z[e],
          Transform.rotY[e],
        ),
        hp: Number(Health.hp[e].toFixed(1)),
      })
    }
    out.sort((a, b) => a.dist - b.dist)
    return out
  }

  /** 슬롯별 남은 쿨다운(초). 봇이 "쓸 수 있는 스킬"을 고르는 데 씁니다. */
  debugSlotCooldowns(): { slot: number; key: string; cd: number; empty: boolean }[] {
    const p = this.playerEntity
    // ⌨️ 키도 개수도 **게임의 표**를 그대로 씁니다 — 봇이 옛 다섯 칸을 보지 않게.
    return SKILL_KEY_CODES.slice(0, SLOT_COUNT).map((key: string, slot: number) => ({
      slot,
      key,
      cd: Number(cooldownOf(p, slot).toFixed(2)),
      empty: skillForSlot(p, slot) === null,
    }))
  }

  /** ⏱ 예고 도형이 지금 화면에 어떻게 그려져 있는가 (visuals `debugTelegraphs`). */
  /** 🩸 출혈 게이지가 실제로 그려져 있는가 (visuals `debugBleedBars`). */
  debugBleedBars(): ReturnType<Visuals['debugBleedBars']> {
    return this.visuals.debugBleedBars()
  }

  debugTelegraphs(): ReturnType<Visuals['debugTelegraphs']> {
    return this.visuals.debugTelegraphs()
  }

  /** 🛡 저스트 가드 — 지금 상태와 **규칙값**(balance.ts `GUARD`). */
  debugGuardInfo(): {
    windowT: number
    canGuard: boolean
    key: string
    lockT: number
    count: number
    window: number
    whiffLock: number
    whiffStamina: number
    refund: number
    poise: number
    /** 🛡 지금 이 창이 **면제 표시**를 달고 있는가(읽기는 맞았는데 예고가 끊김). */
    spared: boolean
  } {
    const p = this.playerEntity
    return {
      windowT: Number(Player.guardT[p].toFixed(3)),
      /** 지금 낼 수 있는가 — 판단은 playerControl 한 곳에만 있습니다. */
      canGuard: canGuardNow(p),
      /** ⌨️ 이 동작의 키. 프로브·봇이 베끼지 않게 게임이 알려 줍니다. */
      key: GUARD.key,
      lockT: Number(Player.guardLockT[p].toFixed(3)),
      count: this.justGuards,
      window: GUARD.window,
      whiffLock: GUARD.whiffLock,
      whiffStamina: GUARD.whiffStamina,
      refund: GUARD.refund,
      poise: GUARD.poise,
      spared: Player.guardSpared[p] === 1,
    }
  }

  /**
   * 🤸 **구르기 규칙을 밖으로 내보냅니다** — 프로브·봇이 베끼지 않게.
   *
   * ⚠️ `rolling` 을 굳이 여기서 계산하는 이유: 프로브가 `state === 2` 로
   *    비교하면 열거형 순서를 바꾸는 날 **조용히** 다른 상태를 재게 됩니다.
   *    이 저장소는 이미 그 사고를 한 번 겪었습니다(`enemyInfo.attacking`).
   *    상태 번호는 게임 안에서만 뜻이 있습니다.
   */
  debugDodgeInfo(): {
    /** 막혀 있다면 무엇이 막는가 — '' 면 지금 나갑니다 */
    block: string
    /** 지금 구르기 중인가 */
    rolling: boolean
    stamina: number
    /** 규칙값 — 프로브가 문턱을 들고 있지 않게 게임이 알려 줍니다 */
    cost: number
    cancelExtraCost: number
    /** 🛡 무적 구간(초) — 재는 쪽이 창 안에 들어올 수 있도록 게임이 알려 줍니다. */
    iFrameStart: number
    iFrameEnd: number
    /**
     * 🛡 공격이 **남겨 두어야 하는** 구르기 몫 (playerControl `canAffordAttack`).
     * 프로브가 `18 * 1` 을 다시 계산하지 않도록 게임이 내보냅니다.
     */
    attackReserve: number
    /** 지금 가장 싼 기본 공격이 나가는가 — 유보분까지 따진 뒤의 답. */
    canAttack: boolean
    regenDelay: number
    /** 회복이 시작되기까지 남은 시간(초) */
    regenDelayT: number
    key: string
  } {
    const p = this.playerEntity
    return {
      block: dodgeBlock(p),
      rolling: Actor.state[p] === ActorState.Dodge,
      stamina: Number(Stamina.value[p].toFixed(2)),
      cost: PLAYER_CFG.dodge.staminaCost * (weaponOf(p).dodgeCostScale ?? 1),
      cancelExtraCost: PLAYER_CFG.dodge.cancelExtraCost,
      /**
       * 🛡 무적이 켜져 있는 구간(초, 구르기 시작 기준).
       * **봇·프로브가 0.06/0.3 을 베껴 적지 않도록** 게임이 내보냅니다 —
       * 이 값을 옮기는 날 재는 쪽만 옛 창을 들고 헛굴게 됩니다.
       */
      iFrameStart: PLAYER_CFG.dodge.iFrameStart,
      iFrameEnd: PLAYER_CFG.dodge.iFrameEnd,
      attackReserve:
        PLAYER_CFG.dodge.staminaCost *
        (weaponOf(p).dodgeCostScale ?? 1) *
        PLAYER_CFG.dodge.reserveMult,
      canAttack: canAffordAttack(p, weaponOf(p).combo[0].staminaCost),
      regenDelay: PLAYER_CFG.staminaRegenDelay,
      regenDelayT: Number(Stamina.regenDelayT[p].toFixed(3)),
      key: PLAYER_CFG.dodge.key,
    }
  }

  /**
   * ⚔️ **지금 기본 공격을 누르면 무엇이 나가는가.**
   *
   * 규칙은 playerControl `contextComboIndex` 한 곳에 있고 여기서는 **이름만**
   * 붙입니다. 프로브가 `sprintT >= rampUp` 같은 조건을 베끼면, 상황을 하나
   * 더 넣는 날 프로브만 옛 규칙을 씁니다.
   */
  debugMoveInfo(): {
    /** 지금 누르면 나갈 기술의 이름 */
    pending: string
    /** 지금 휘두르고 있는 기술의 이름('' 이면 안 휘두르는 중) */
    current: string
    /** 🤸 구르기 공격 창의 남은 시간(초) */
    rollWindowT: number
    /** 🎲 창이 열려 있는가 — 반올림한 `rollWindowT` 로 규칙을 되묻지 않게. */
    rollWindowOpen: boolean
    /** 🏃 달리는 중인가 */
    sprinting: boolean
    /** 규칙값 — 프로브가 베끼지 않게 */
    rollWindow: number
    /**
     * 🏃 달리기 공격이 **닿는 거리**(사거리 + 파고들기).
     *
     * 봇이 이걸 몰라서 첫 판에 **달리기 공격 0회**가 나왔습니다 — 붙고 나서야
     * 쳤고, 붙으면 이미 달리는 중이 아니니까요. 소울류의 달리기 공격은
     * **도착하기 전에** 칩니다. 그 거리를 봇이 계산하면 배율을 바꾸는 날
     * 봇만 옛 값을 쓰므로 게임이 알려 줍니다.
     */
    runReach: number
    /**
     * 🗡 **평타가 닿는 거리**(1타 사거리 + 파고들기).
     *
     * 봇이 여기에 2.2 같은 리터럴을 들고 있으면 무기를 바꾸거나 사거리를
     * 손보는 날 **봇만 옛 값**을 씁니다. 실제로 그렇게 데였습니다 —
     * 폭발통 가지에 2.2 를 적어 뒀더니, 정작 통은 그보다 **먼 거리에서
     * 평타에 우연히** 터지고 있었고(가장 가까이 3.1m) 전용 가지는 한 번도
     * 안 걸렸습니다. 계측기가 자기 문턱 때문에 기회를 못 본 것입니다.
     */
    hitReach: number
    /** 🪂 낙하 공격 창의 남은 시간(초) */
    plungeWindowT: number
    /** 🪂 이번 낙하가 몇 단이었는가(창이 닫히면 의미 없음) */
    plungeSteps: number
    /** 규칙값 — 프로브가 베끼지 않게 */
    plungeWindow: number
  } {
    const p = this.playerEntity
    const w = weaponOf(p)
    const nameOf = (idx: number): string =>
      idx === RUN_COMBO
        ? runningStep(w).name
        : idx === ROLL_COMBO
          ? rollingStep(w).name
          : idx === PLUNGE_COMBO
            ? plungeStep(w, Player.plungeSteps[p]).name
            : idx === HEAVY_COMBO
              ? '강타'
              : idx === FINISH_COMBO
                ? '처형'
                : w.combo[Math.min(idx, w.combo.length - 1)].name
    const st = Actor.state[p] as ActorState
    return {
      pending: nameOf(contextComboIndex(p, isSprinting(p))),
      current: st === ActorState.Attack ? nameOf(Actor.comboIndex[p]) : '',
      rollWindowT: Number(Player.rollAttackT[p].toFixed(3)),
      /**
       * ── 🎲 **창이 열려 있는가 — 반올림한 숫자로 되묻지 않게** ────────────
       *
       * `rollWindowT` 는 보기 좋으라고 `toFixed(3)` 으로 깎아서 냅니다.
       * 그런데 남은 창이 0.0004초면 그 값이 **정확히 0** 이 됩니다. 반면
       * `pending` 은 `contextComboIndex` 가 **깎지 않은 원본**을 보므로
       * 아직 「구르기 공격」입니다. 두 값이 한 번의 호출 안에서 서로
       * **모순된 말**을 하는 셈입니다.
       *
       * `verify` 의 *"창이 지나면 도로 1타"* 가 판마다 오가던 것이
       * 이것이었습니다(129 → 128 → 129 → 128). 게임은 멀쩡했고, **계측기가
       * 자기가 반올림해 놓은 숫자로 규칙을 되물었습니다.**
       *
       * 그래서 게임이 직접 답합니다. 프로브가 `=== 0` 으로 규칙을 다시
       * 만들 필요가 없어집니다 — 이 저장소가 여러 번 배운 그 규칙입니다:
       * **재는 쪽이 규칙을 다시 쓰면 언젠가 갈라집니다.**
       */
      rollWindowOpen: Player.rollAttackT[p] > 0,
      sprinting: isSprinting(p),
      rollWindow: PLAYER_CFG.contextAttack.rollWindow,
      runReach: Number((runningStep(w).range + runningStep(w).lunge).toFixed(2)),
      hitReach: Number((stepFor(w, 0, 0, 0).range + stepFor(w, 0, 0, 0).lunge).toFixed(2)),
      plungeWindowT: Number(Player.plungeT[p].toFixed(3)),
      plungeSteps: Player.plungeSteps[p],
      plungeWindow: PLAYER_CFG.contextAttack.plungeWindow,
    }
  }

  /** 헤드리스 검증용 스냅샷 */
  debugState() {
    const p = this.playerEntity
    const near = this.nearestEnemy()
    return {
      nearestEnemy: near
        ? {
            x: Number(near.x.toFixed(3)),
            z: Number(near.z.toFixed(3)),
            entity: near.entity,
            dist: Number(near.dist.toFixed(3)),
            hp: Number(near.hp.toFixed(1)),
            playerBehind: near.playerBehind,
          }
        : null,
      frame: time.frame,
      elapsed: Number(time.elapsed.toFixed(3)),
      /** 시뮬레이션이 실제로 진행한 시간 — 히트스톱을 뺀 값(core/time.ts 설계 노트). */
      simElapsed: Number(time.simElapsed.toFixed(3)),
      hitstop: Number(time.hitstop.toFixed(4)),
      trauma: Number(this.cam.currentTrauma.toFixed(4)),
      player: {
        x: Number(Transform.x[p].toFixed(3)),
        y: Number(Transform.y[p].toFixed(3)),
        z: Number(Transform.z[p].toFixed(3)),
        rotY: Number(Transform.rotY[p].toFixed(3)),
        hp: Number(Health.hp[p].toFixed(1)),
        stamina: Number(Stamina.value[p].toFixed(1)),
        state: Actor.state[p],
        /**
         * 📏 **내 몸 굵기.** 판정이 `range + Body.radius[대상]` 으로 관대하게
         * 잡기 때문에(combat.ts `shapeDist`), *"그린 선 밖 어디까지 맞는가"*
         * 를 재려면 이 값이 필요합니다. 프로브가 0.45 를 베껴 적지 않게
         * 게임이 내보냅니다.
         */
        radius: Body.radius[p],
        comboIndex: Actor.comboIndex[p],
        // 0=선행동작 1=판정 2=후딜. 검증 도구가 "판정이 뜬 그 프레임"을 정확히
        // 집어낼 수 있어야 합니다. 벽시계로 기다리면 프레임률에 따라 어긋납니다.
        phase: Actor.phase[p],
        terrainLevel: this.terrain ? this.terrain.levelAtWorld(Transform.x[p], Transform.z[p]) : null,
      },
      aim: { x: Number(this.aim.x.toFixed(3)), z: Number(this.aim.z.toFixed(3)) },
      cast: { x: Number(Player.castX[p].toFixed(3)), z: Number(Player.castZ[p].toFixed(3)) },
      enemiesLeft: countLivingEnemies(),
      treasureFound: this.treasuresFound,
      // 지금 몇 마리가 **동시에** 공격을 걸고 있는가.
      // "여러 명이 겹치면 못 피한다"는 문제는 이 숫자로만 잴 수 있습니다.
      ...this.debugAttackLoad(),
      kills: this.kills,
      hitsDealt: this.hitsDealt,
      damageDealt: Number(this.damageDealt.toFixed(1)),
      backHits: this.backHits,
      critHits: this.critHits,
      wave: this.wave,
      gameOver: this.gameOver,
      loadout: {
        weapon: weaponOf(p).id,
        weaponName: weaponOf(p).name,
        weaponLevel: weaponLevel(p),
        comboLength: weaponOf(p).combo.length,
        runesOwned: Loadout.runesOwned[p],
        slots: Array.from({ length: SLOT_COUNT }, (_, i) => skillForSlot(p, i)?.id ?? null),
        cooldowns: Array.from({ length: SLOT_COUNT }, (_, i) =>
          Number(cooldownOf(p, i).toFixed(2)),
        ),
      },
      levelMode: this.levelMode,
      levelName: this.levelName,
      source: this.source,
      treasuresFound: this.treasuresFound,
      treasureTotal: this.treasureTotal,
      region: this.currentRegion,
      regionCount: this.regions.length,
    }
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement
/**
 * 실험용 덮어쓰기 중 **아무도 못 알아들은 것**이 있으면 여기서 터집니다.
 *
 * 설정 파일들이 각자 applyTweaks 를 부른 뒤이므로, 남아 있다는 것은
 * 경로 오타라는 뜻입니다. 조용히 넘기면 A 와 B 가 사실 같은 설정으로
 * 돌고, 그 벤치는 "차이 없음"을 **정확하게 틀리게** 보고합니다.
 */
assertAllTweaksApplied()

const game = new Game(canvas)
game.start()

// 자동 검증 스크립트(tools/verify.mjs)가 실제 이벤트 없이 게임을 조작하기 위한 훅.
// 프로덕션 빌드에도 남겨 둡니다 — 용량이 무의미하게 작고, 버그 재현에 유용합니다.
declare global {
  interface Window {
    __game: {
      ready: boolean
      press: (code: string) => void
      release: (code: string) => void
      setAim: (ndcX: number, ndcY: number) => void
      aimAtWorld: (x: number, z: number) => void
      state: () => ReturnType<Game['debugState']>
      reset: () => void
      requestSample: () => void
      getSample: () => ReturnType<Game['getSample']>
      clearEnemies: () => void
      /** 🩸 실험대 — 죽지 않는 허수아비를 원하는 체력 비율(0~1)로 세웁니다. */
      spawnBleedDummy: (hpRatio: number) => number
      /** 🩸 실험대 — 한 대분 얹습니다(게임과 **같은 함수**). 터졌으면 true. */
      hitBleedDummy: (e: number, bleedScale?: number) => boolean
      /** 🩸 실험대 — 지금 쌓여 있는 양. */
      bleedOf: (e: number) => number
      /** 🩸 실험대 — 치웁니다. */
      despawnBleedDummy: (e: number) => void
      testBehind: (ax: number, az: number, tx: number, tz: number, trot: number) => boolean
      /** 검증 스크립트가 수치를 하드코딩하지 않도록 튜닝 상수를 그대로 내보냅니다. */
      tuning: () => { backArcDeg: number }
      /** 🎯 시작해도 되는 각도 · 예고 한 번에 돌 수 있는 각도 — 구현부 주석 참고. */
      aimRule: () => { commitToleranceDeg: number; windupTurnBudgetDeg: number }
      /** 화면을 그 프레임에 멈춰 세웁니다(스크린샷용). */
      setPaused: (paused: boolean) => void
      idleReasons: () => { token: number; cooldown: number; facing: number; noPattern: number; committed: number }
      poiseRule: (kindId: string, breaks: number) => number
      swings: () => {
        attackId: string
        hit: boolean
        dist: number
        angleDeg: number
        /** 🎯 예고를 걸던 순간의 빗나감(도) — `angleDeg` 와 짝. combat.ts 참고. */
        aimAtStart: number
        halfArcDeg: number
        reach: number
        invuln: boolean
      }[]
      showProps: (on: boolean) => void
      props: () => {
        pillars: number
        rubble: number
        pillarSpots: number
        rubbleSpots: number
        unreachable: number
        byRegion: Record<string, number>
      }
      step: (frames: number, dtSec: number, fromZero?: boolean) => void
      /** 지금 검격 궤적이 떠 있는가 — 캡처 타이밍을 페이지 안에서 잡기 위한 것. */
      swingVisible: () => boolean
      /** ⏱ 예고 도형이 지금 **화면에 어떻게 그려져 있는가** (visuals `debugTelegraphs`) */
      telegraphs: () => {
        entity: number
        attackId: string
        intent: number
        timing: boolean
        left: number
        /** ⏳ 이번 공격에 실제로 건 예고 길이 — 차오름의 분모 */
        windup: number
        /** ⏳ 그중 뜸 들인 몫 */
        held: number
        opacity: number
        /** ⏳ 차오른 몫(0~1) — 1이면 지금이 판정. visuals.ts 참고. */
        grow: number
      }[]
      /** 실험대 전용 스폰. 기본은 **깨어 있는 적** — 재우려면 `asleep: true`. */
      spawnTestEnemy: (x: number, z: number, rotY?: number, asleep?: boolean) => number
      freezeEnemies: (frozen: boolean) => void
      spawnVfx: (kind: 'spark' | 'damage' | 'swing') => void
      /** 적을 특정 공격 패턴의 예고 상태로 세워 둡니다(4색 확인용). */
      forceAttack: (entity: number, index: number, windupScale?: number) => string
      spawnBoss: (x: number, z: number) => number
      /** 플레이어에게 속박을 겁니다(파랑 상태 확인용). */
      applySnare: (seconds: number) => void
      /** 트라이포드 검증용 — 포인트 지급 / 해금 / 실효 수치 조회 */
      grantTripod: (n: number) => void
      unlockTripod: (skillId: string, tier: number, option: number) => boolean
      switchTripod: (skillId: string, tier: number, option: number) => boolean
      effectiveSkill: (slot: number) => Record<string, number | string> | null
      tripodInfo: () => { points: number; panelOpen: boolean }
      toggleTripodPanel: () => void
      /**
       * 보스 페이즈 튜닝 값을 그대로 내보냅니다.
       * 검증 스크립트가 상수를 베껴 두면, 밸런스를 바꿨을 때
       * **테스트만 통과하고 게임은 망가집니다.**
       */
      bossTuning: () => {
        name: string
        enterBelow: number
        cooldownScale: number
        damageTakenScale: number
        windups: { id: string; seconds: number }[]
        chains: Record<string, string>
        /** 🎬 전환 직후 반드시 나오는 첫 패턴(없으면 ''). */
        firstAttack: string
        /** ⏸ 전환 연출의 길이(초) — 이 동안 보스는 무적입니다. 프로브가 1.25 를 베끼지 않게. */
        transitionTime: number
      }[]
      /** 적 종류 검증용 — 표를 그대로 내보냅니다(스크립트가 수치를 베끼지 않도록). */
      enemyRoster: () => {
        id: string
        name: string
        maxHp: number
        height: number
        /** 몸 반지름 — "밀착해도 이만큼은 떨어져 있다"를 재려면 필요합니다. */
        radius: number
        moveSpeed: number
        /** 사거리 밖에서 내는 속도 — 추격을 잴 때 봐야 하는 값 */
        approachSpeed: number
        attackRange: number
        keepDistance?: number
        /** 🎯 도는 속도(도/초) — 예고 중 회전은 이 값과 `aimRule` 예산 중 작은 쪽입니다. */
        turnSpeedDeg: number
        attackCycle: number
        /** 강인도 최대치 — "무너뜨리려면 얼마나 깎아야 하는가"의 기준입니다. */
        poiseMax: number
        /** 🔔 지금 모드에서 이 종류가 **실제로 깨어나는 거리**(m). */
        wakeRange: number
        attacks: {
          id: string
          intent: number
          color: string
          reach: number
          /** 📏 화면에 그려지는 반지름(= 실제로 맞는 자리). `reach` 와 다릅니다. */
          drawnReach: number
          /** 기본 가중치 — 페이즈 덮어쓰기(bossPhaseWeights)와 짝입니다. */
          weight: number
          lungeSpeed: number
          /** 예고 길이와 부채꼴 — 색끼리의 **관계**를 검사하려면 필요합니다 */
          windup: number
          arcDeg: number
          /**
           * 판정·후딜. 연계가 **언제 오는지**는 이 둘이 정합니다
           * (판정 끝 → 후딜 끝 → 다음 예고 시작). 🔵 속박이 다음 공격까지
           * 살아 있는지를 재려면 프로브가 이 시간표를 알아야 합니다.
           */
          active: number
          recovery: number
          /** 🔵 이 공격에 맞으면 걸리는 속박 시간(초). 0이면 안 묶습니다. */
          snare: number
          /**
           * 이 패턴을 고르는 거리 구간. 🟣 의 정답("사거리 밖으로")이
           * 성립하는지는 **어느 거리에서 걸리느냐**에 달려 있으므로,
           * 프로브가 "가장 가까이서 걸릴 수 있는 거리"를 알아야 합니다.
           */
          minRange: number
          maxRange: number
          /**
           * 💥 **한 대의 피해.** 프로브가 *"8초에 최대 얼마까지 아플 수
           * 있는가"*(천장)를 세려면 시간표만으로는 모자랍니다 — 붙잡는
           * 시간 × 대수까지는 세도 **한 대가 얼마인지**를 몰라서 거기서
           * 멈췄습니다. 실제로 `npm run bypass` 의 「끌고 온 무리의
           * 청구서」가 그 천장을 못 재서 한 회차를 통째로 기다렸습니다.
           */
          damage: number
          /**
           * 🏹 **날아가는 패턴인가.** 토큰 줄이 근접·원거리로 갈려 있어서
           * (`combatLimits`), 천장을 셀 때도 같은 기준으로 갈라야 합니다.
           * ⚠️ 종류 이름(`archer`)으로 가르면 새 원거리 적이 조용히 근접
           *    줄에 섭니다 — enemyAI 의 `isRanged` 가 이름이 아니라
           *    **하는 일**로 가르는 것과 같은 이유입니다.
           */
          projectile: boolean
        }[]
      }[]
      /**
       * 🎟 **동시에 몇이 때릴 수 있는가** — 작업 #20 의 규칙(enemyAttacks.ts).
       *
       * 프로브가 *"무리가 아무리 많아도 8초에 최대 얼마"* 를 세려면 이
       * 상한이 필요합니다. 여기서 내주는 이유는 하나입니다 — 프로브에
       * `2` 를 적어 두면 토큰을 3으로 바꾸는 날 **프로브만 옛 게임을
       * 재게 됩니다.** 「규칙은 한 곳에만」의 그 자리입니다.
       */
      combatLimits: () => {
        /** 근접 동시 공격자 수 */
        melee: number
        /** 그중 광역(넓은 부채꼴)으로 나갈 수 있는 수 */
        wide: number
        /** 근접 줄과 **따로** 도는 원거리 자리 수 */
        ranged: number
        /** 누가 커밋한 뒤 다음 커밋까지 강제로 비는 시간(초) */
        commitGap: number
      }
      /** 지금 레벨에 배치된 적 종류별 마릿수. */
      levelRoster: () => Record<string, number>
      /** 종류를 id 문자열로 지정해 소환합니다. */
      /** 실험대 전용 스폰. 기본은 **깨어 있는 적** — 재우려면 `asleep: true`. */
      spawnEnemyKind: (id: string, x: number, z: number, asleep?: boolean) => number
      /** 보스 페이즈 검증용 — 체력을 직접 깎고 상태를 읽습니다. */
      damageEntity: (entity: number, amount: number) => void
      enemyInfo: (entity: number) => {
        hp: number
        max: number
        phase: number
        transitionT: number
        x: number
        z: number
        state: number
        /**
         * 지금 공격(예고 포함) 중인가.
         * 검증 스크립트가 `state === 1` 같은 숫자를 베껴 두면 열거형 순서를
         * 바꿨을 때 조용히 틀립니다 — 실제로 이 프로브가 그렇게 실패했습니다.
         */
        attacking: boolean
        winding: boolean
        /** 후딜(판정이 끝난 무방비 구간)인가 — 등 뒤로 돌 수 있는 진짜 창. */
        recovering: boolean
        rotY: number
        timer: number
        /**
         * ⏳ **이번 공격에 실제로 건 예고 길이**(초) — 페이즈 배율과 지연이
         * 이미 반영된 값입니다(components.ts `windupLen`).
         */
        windup: number
        /** ⏳ 그중 뜸 들인 몫(초). 0이면 평소 박자 */
        held: number
        /** 🍶 다음 공격까지 남은 쿨다운(초). 음수 = 준비된 채로 기다린 시간 */
        cooldown: number
        brokenT: number
        /** 🤕 지금 남아 있는 피격 번쩍임(초) — 타격의 무게만큼 길어집니다. */
        flashT: number
        /** 🤕 지금 밀려나는 속도(m/s) — 몸이 젖혀지는 양의 출처. */
        knock: number
        intent: number
        staggered: boolean
        broken: boolean
        poise: number
        poiseMax: number
        attackId: string
        attackPhase: number
        chainNext: string
        cooldownT: number
        reactT: number
        aggro: boolean
        unawareT: number
      } | null
      /**
       * 자동 플레이 봇용 훅.
       *
       * WASD는 **카메라 기준**이라 월드 방향을 그대로 못 씁니다
       * (쿼터뷰 45°에서 월드 +X로 가려면 화면상 오른쪽 아래로 가야 합니다).
       * 봇이 축을 직접 계산하면 카메라 각도를 바꿀 때 봇이 조용히 틀립니다.
       */
      /** 보스 페이즈의 체력 경계(enterBelow) — 프로브가 페이즈 한가운데를 잡는 데 씁니다. */
      bossPhaseBounds: () => number[]
      /** 페이즈별 가중치 덮어쓰기 — "적어 둔 성격이 실제로 나오는가"의 기대치입니다. */
      bossPhaseWeights: () => Record<string, number>[]
      /** 🎲 무엇을 왜 골랐는가 — 굴림 · 후보 · 대체까지 (enemyAI `notePick`) */
      pickLog: () => PickRecord[]
      /** 🎲 전투 난수의 씨앗을 갈아 끼웁니다 — **프로브 전용**(core/rng.ts `reseed`). */
      setCombatSeed: (seed: number) => void
      /** 🔁 정답대로 답한 사람이 한 대 갚을 수 있는가 (config/punish.ts) */
      punishTable: () => PunishRow[]
      /** 예고 동안 옆으로 빠져 부채꼴을 벗어날 수 있는가 */
      sidestepTable: () => SidestepRow[]
      /** 🧪 실험대 전용 무적 (combat.ts 설계 노트). 게임 코드는 켜지 않습니다. */
      setPlayerInvulnerable: (on: boolean) => void
      /** 🟢 반격 검증용 */
      counterInfo: () => {
        brokenTime: number
        normalBrokenTime: number
        bossBrokenTime: number
        damageMultiplier: number
        poiseRegenDelay: number
        poiseRegenPerSec: number
      }
      /**
       * 사람이 반응하는 데 걸리는 시간 예산 — 프로브가 **읽습니다**(balance.ts REACTION).
       * 색 가짓수는 게임이 **자기 데이터에서 세어** 넘깁니다.
       */
      reactionBudget: () => {
        /** 🖥 손끝 차이를 셀 때의 한 프레임(초) — 60fps 가정(balance.ts FEEL). */
        frame: number
        /** 🖥 프레임의 안전 상한(초) — core/time.ts MAX_FRAME_DT. 목표가 아닙니다. */
        maxFrame: number
        simple: number
        choice: number
        /** `answerIsDodge` 는 `ANSWER_IS_DODGE` 를 그대로 실어 보냅니다. */
        colors: { intent: number; emoji: string; label: string; answerIsDodge: boolean }[]
      }
      /**
       * 🩸 **피격 장부** — 맞은 한 대마다 볼 수 있었는지·답할 수 있었는지.
       * 판정은 **게임이** 내리고 프로브는 세기만 합니다.
       */
      hurtLedger: () => {
        attackId: string
        intent: number
        telegraph: number
        seen: number
        free: number
        damage: number
        verdict: string
      }[]
      counterCount: () => number
      /**
       * 🛡 저스트 가드의 **게임 쪽 판정**을 그대로 냅니다.
       *
       * 프로브가 창 길이·잠김을 따로 적어 두면, 값을 바꾸는 날 그 프로브가
       * 조용히 옛 규칙을 재게 됩니다. 규칙은 balance.ts `GUARD` 한 곳에만
       * 있고 여기서는 **읽기만** 합니다.
       */
      guardInfo: () => {
        /** 지금 창이 열려 있는 남은 시간(초) */
        windowT: number
        /** 🛡 지금 누르면 열리는가 (서 있거나 후딜일 때만) — 봇이 베끼지 않게 */
        canGuard: boolean
        /** ⌨️ 이 동작의 키 — 옮겨도 프로브·봇이 따라옵니다 */
        key: string
        /** 헛쳐서 굳어 있는 남은 시간(초) */
        lockT: number
        /** 이번 판에 성립한 저스트 가드 수 */
        count: number
        /** 규칙값 — 프로브가 베끼지 않게 게임이 알려 줍니다 */
        window: number
        whiffLock: number
        whiffStamina: number
        refund: number
        poise: number
      }
      /** 🩸 출혈 게이지가 화면에 그려진 상태 */
      bleedBars: () => { entity: number; visible: boolean; fill: number; bleed: number }[]
      /** 🩸 출혈 규칙 — 문턱과 무기별 배율을 게임이 알려 줍니다 */
      bleedInfo: () => {
        maxByKind: { id: string; max: number }[]
        perHit: number
        decayDelay: number
        decayPerSec: number
        popDamagePct: number
        popDamageCap: number
        weapons: {
          id: string
          bleedScale: number
          poiseScale: number
          hitsPerCombo: number
          perCombo: number
        }[]
      }
      /** 🎛 슬롯 규약 — 검사가 숫자를 베끼지 않게 */
      slotInfo: () => { count: number; firstRuneSlot: number }
      /** 🌿 트라이포드 표의 크기 */
      tripodTable: () => { skills: number; tiers: number; perTier: number }
      /** ⚔️ 지금 좌클릭이 무엇이 되는가 — 상황 모션 검증용 */
      moveInfo: () => {
        pending: string
        current: string
        rollWindowT: number
        /** 🎲 창이 열려 있는가 — 반올림한 숫자로 규칙을 되묻지 않게. */
        rollWindowOpen: boolean
        sprinting: boolean
        rollWindow: number
        runReach: number
        hitReach: number
        plungeWindowT: number
        plungeSteps: number
        plungeWindow: number
      }
      /** 🤸 구르기 규칙 — 프로브·봇이 문턱과 키를 베끼지 않게 */
      dodgeInfo: () => {
        block: string
        rolling: boolean
        stamina: number
        cost: number
        cancelExtraCost: number
        iFrameStart: number
        iFrameEnd: number
        attackReserve: number
        canAttack: boolean
        regenDelay: number
        regenDelayT: number
        key: string
      }
      /** 🥋 집중 검증용 */
      focusInfo: () => {
        focus: number
        max: number
        perLightHit: number
        perPerfectDodge: number
        damagePerPoint: number
      }
      setFocus: (n: number) => void
      setStamina: (n: number) => void
      /** 🧪 기력을 매 프레임 붙들어 둡니다. null 이면 풀립니다. */
      pinStamina: (n: number | null) => void
      grantPerfectDodge: () => void
      /** 실험대 전용 — 적을 깨웁니다. */
      wakeEnemy: (entity: number) => void
      /** 실험대 전용 — 어그로 거리를 존과 같게 덮어씁니다(아레나는 55m 라 항상 깨어 있습니다). */
      setAggroRange: (range: number) => void
      /** 실험대 전용 — 1단계 학습 잠금을 켜고 끕니다(enemyAI 설계 노트). */
      setPhaseTeaching: (on: boolean) => void
      /** 인지 규칙 — 프로브가 식을 베끼지 않도록 **게임이 답합니다**. */
      awareInfo: () => {
        frontArcDeg: number
        hearQuiet: number
        hearLoud: number
        ambushGrace: number
        alertRadius: number
        markRange: number
        noiseRingRange: number
        /** 🚪 어그로가 풀리는 문턱 — 직선 대비 경로의 배수, 그리고 최소 절대거리(m) */
        deaggroRatio: number
        deaggroMin: number
        enemyAiOn: boolean
        /** 지금 이 순간 내 발소리가 닿는 거리(m) — 속도에 따라 변합니다. */
        hearNow: number
        playerSpeed: number
        /** 화면이 실제로 그리고 있는 것 — 규칙이 아니라 **픽셀 쪽** 진실입니다. */
        marks: number
        noiseVisible: boolean
        noiseRadius: number
      }
      /**
       * 🥋 강타 눈금이 **화면에** 그려진 자리. 규칙이 아니라 픽셀 쪽 진실입니다.
       * (프로브가 강인도 식을 다시 계산하면 눈금을 안 그려도 통과합니다.)
       */
      poiseBars: () => {
        entity: number
        markRatio: number
        markVisible: boolean
        markBright: boolean
        fill: [number, number, number]
      }[]
      /** 주변 적의 위협 상태 — 봇이 색과 방향을 읽습니다. */
      /** 🎯 가장 멀리 닿는 한 대의 사거리(m). `threats()` 에 넣을 값을 게임이 줍니다. */
      threatRange: () => number
      /** 💀 이 판에서 죽은 순간마다의 사인(무엇에 · 왜 못 막았는지). */
      deathLog: () => string[]
      /** 🤸 색별 오답 횟수 · 다시 가르친 색 · 문턱 */
      colorTeach: () => { wrong: Record<number, number>; retaught: number[]; after: number }
      /** 📏 등 뒤 표시의 바깥 반지름(m). 판정에는 거리 제한이 없습니다. */
      backZoneOuter: (kind: number) => number
      /** ❤️ 저체력 심장 박동 — 뛴 횟수 · 세기(0~1) · 문턱 */
      heartbeatInfo: () => { beats: number; intensity: number; warn: number }
      threats: (range?: number) => {
        entity: number
        /** 🏷 적의 종류 id — 화면의 색·실루엣과 같은 정보입니다. */
        kind: string
        /**
         * 🚦 지금 이 적을 막고 있는 문.
         * 「토큰만」과 「토큰+」이 갈려 있습니다 — 앞은 고치면 바뀌는 몫,
         * 뒤는 토큰을 늘려도 안 바뀌는 몫입니다.
         */
        idleWhy: string
        x: number
        z: number
        dist: number
        /** 🚪 나에게 오는 **걸어야 하는 거리**(m) — 깨는 판정이 쓰는 값. 규칙 없으면 null. */
        walk: number | null
        intent: number
        aggro: boolean
        winding: boolean
        inFront: boolean
        /** ⏳ 남은 예고 시간(초). 예고 중이 아니면 0 — 화면의 투명도와 같은 값입니다. */
        timer: number
        /** 🎯 이 예고가 지금 내 자리에 닿는가 (판정과 같은 식) */
        willReach: boolean
        /** 👁 내가 이 적을 보고 있는가 (가드 조건). `inFront` 와 반대 방향입니다 */
        facing: boolean
        hp: number
      }[]
      slotCooldowns: () => { slot: number; key: string; cd: number; empty: boolean }[]
      cameraAxes: () => { forwardX: number; forwardZ: number; rightX: number; rightZ: number }
      /** 🖥 지금 예고 중인 적마다 **몸**과 **지면 예고**가 화면 안인지 따로. */
      telegraphView: () => {
        entity: number
        kind: number
        id: string
        intent: number
        dist: number
        bodySeen: boolean
        cueSeen: boolean
      }[]
      /** 지금 목표 지점(길안내와 **같은 계산**). 없으면 null. */
      objective: () => {
        x: number
        z: number
        label: string
        dist: number
        stepX: number
        stepZ: number
        walkDist: number
      } | null
      /** 보스 조우 검증용 */
      bossEncounter: () => {
        entity: number
        encounter: number
        aggro: number
        hp: number
        maxHp: number
        phase: number
        homeDist: number
        /** 보스 **자신**이 자기 자리에서 떨어진 거리 — 귀환 관측에 필요합니다. */
        selfHomeDist: number
        arenaRadius: number
        leashRadius: number
        /**
         * 🎓 1단계 학습 잠금이 페이즈를 붙잡고 있는가 — **왜 안 올라가는지**
         * 게임이 말해 줍니다. 이게 없어서 아레나 프로브의 검사 셋이 아주
         * 오래 빨간 채로 있었습니다.
         */
        teachHold: { holding: boolean; seen: number; need: number }
      } | null
      /** 불티 검증용 */
      emberInfo: () => {
        embers: number
        vialsMax: number
        drop: { x: number; z: number; amount: number } | null
        upgradeCost: number
      }
      setEmbers: (n: number) => void
      /** 💰 경제 원장 — 가격표(설정)와 공급(지도)을 **같은 호출에서** 냅니다. */
      economy: () => {
        weapon: { maxLevel: number; costs: number[]; stoneCosts: number[] }
        vial: { costs: number[]; max: number; start: number }
        stone: { perTreasure: number; perBoss: number }
        respawn: { decay: number; floor: number }
        zone: {
          name: string
          foes: { id: string; count: number; ember: number }[]
          chests: number
          urnChests: number
          anvils: number
          bonfires: number
          anvilAt: { x: number; z: number }[]
          bonfireAt: { x: number; z: number }[]
          bossAt: { x: number; z: number } | null
        }
      }
      /** 무기 강화 검증용 */
      setWeaponLevel: (weapon: number, level: number) => void
      saveNow: () => void
      weaponUpgradeInfo: () => {
        weapon: number
        level: number
        maxLevel: number
        nextCost: number
        nextStoneCost: number
        stones: number
        earnedStones: number
        damagePerLevel: number
        levels: number[]
        atStation: boolean
        /** 안 되면 **왜** — `'foe'`(적이 막음) · `'away'`(안 닿음) · `''`(된다). */
        blockedBy: '' | 'foe' | 'away'
      }
      /**
       * 🌀 **지금 무기 축이 놓인 각도**(라디안). `y` 가 좌우, `x` 가 위아래.
       * 콤보 단마다 궤적이 실제로 갈라지는지를 여기서 봅니다.
       */
      swingPose: (entity: number) => { x: number; y: number } | null
      setStones: (n: number) => void
      treasurePositions: () => { x: number; z: number; taken: boolean; secret: boolean }[]
      forceRespawnEnemies: () => void
      killAllEnemies: () => number
      /** 회복 검증용 — 성수병/화톳불 상태 */
      vialInfo: () => {
        vials: number
        max: number
        /** 한 병 회복량 — 프로브가 "되돌릴 수 있는 단위"로 쓰는 기준선 */
        heal: number
        hp: number
        state: number
        drinking: boolean
        bonfires: number
        hasRespawn: boolean
        restProgress: number
        restCount: number
      }
      playerEntity: () => number
      setHp: (entity: number, hp: number) => void
      enemyCount: () => number
      setVials: (n: number) => void
      teleportPlayer: (x: number, z: number) => void
      /** 적을 원하는 자리에 세웁니다 — 🏹 엄폐처럼 **자리**가 전부인 검증용. */
      teleportEnemy: (entity: number, x: number, z: number) => void
      /** 지형 세로면의 화면 좌표 + 낙차 — 레벨 문법이 눈에 읽히는지 검증용. */
      faceSamples: () => { sx: number; sy: number; drop: number; climbable: boolean }[]
      /** 화면에 보이는 바닥 윗면 + 그 칸의 구역 이름 — 구역 색조 검증용. */
      groundSamples: () => { sx: number; sy: number; region: string }[]
      /** 월드 좌표를 화면 좌표로 — 프로브가 카메라 행렬을 흉내 내지 않게. */
      screenPos: (x: number, y: number, z: number) => { sx: number; sy: number } | null
      /** 구역 목록 — 이름·격자 범위·한가운데 월드 좌표·색조. */
      regionList: () => {
        name: string
        x0: number
        x1: number
        z0: number
        z1: number
        x: number
        z: number
        tint: [number, number, number] | null
      }[]
      /** 예고 4색의 RGB. */
      intentColors: () => { color: string; rgb: [number, number, number] }[]
      nearestBonfire: () => { x: number; z: number } | null
      /** 소비처 전부(화톳불 + 모루). **고르는 것은 부르는 쪽** — 걸어야 하는 거리로. */
      spendPoints: () => { x: number; z: number; anvil: boolean }[]
      anvils: () => { x: number; z: number }[]
      /** 💰 강화 곡선(불티) — 상점 값의 출처. */
      upgradeCosts: () => number[]
      /** 안내가 나간 예고 색들(AttackIntent 값) */
      seenIntents: () => number[]
      /** 적 종류별 휘두름/적중 — 잡몹이 존에서 실제로 무엇을 하는지 */
      upgradeTries: () => {
        seen: number
        notStation: number
        consumed: number
        noStone: number
        noEmber: number
        done: number
      }
      fallLog: () => {
        player: number
        foe: number
        foeSteps: number
        byKind: Record<string, number>
      }
      foeSwingLog: () => Record<
        string,
        {
          swings: number
          hits: number
          deaths?: number
              commits?: number
          aggroT?: number
          atkT?: number
          stagT?: number
          coolT?: number
          chaseT?: number
          readyT?: number
        }
      >
      /** 사다리(지름길) 검증용 */
      finisherInfo: () => {
        ready: boolean
        target: number
        reach: number
        damageMultiplier: number
        staminaCost: number
        count: number
      }
      breakEnemy: (entity: number) => void
      tweaks: () => { path: string; from: number; to: number }[]
      /** 무기별 구르기 — 거리·시간·무적창·값. 프로브가 arsenal 을 안 읽게. */
      dodgeScales: () => {
        id: string
        name: string
        distance: number
        duration: number
        staminaCost: number
        iFrames: number
        /** 누른 뒤 **무적이 시작되기까지의 지연** — 반응 예산 계산에 필요합니다. */
        iFrameStart: number
      }[]
      /**
   * 🧭 지금 화면에 뜬 **곁길 한 줄** — 규칙값까지 같이.
   *
   * 프로브가 DOM 을 긁지 않게 게임이 내줍니다. 화면에 실제로 그려진 것과
   * 같은 문자열이어야 하므로 HUD 가 받은 값을 그대로 돌려줍니다 —
   * 이 저장소가 지연 공격에서 배운 것: **규칙이 아니라 도달한 것**을 봅니다.
   */
      sideHint: () => { text: string; range: number; near: number }
      /** 🧭 지금 자리에서 안내가 **무엇을 고를 것인가** — 타이머 없이 규칙만. */
      sideHintHere: () => { dir: string; dist: number; x: number; z: number } | null
      /** 🍶 회복 노림의 규칙값 — 프로브가 문턱을 베끼지 않게 게임이 알려 줍니다. */
      punishHealInfo: () => { rangeMult: number; cutTo: number }
      weaponTable: () => {
        id: string
        name: string
        comboLength: number
        moveSpeedScale: number
        attackMoveScale: number
        comboWindow: number
        comboDamage: number
        comboStamina: number
        comboSeconds: number
        comboTrauma: number
        /** ⚔️ 상황 모션(달리기·구르기 공격)의 실제 제원 — 1타에서 파생된 값 */
        moves: {
          name: string
          damage: number
          range: number
          lunge: number
          windup: number
          recovery: number
          staminaCost: number
        }[]
        /** 🪂 낙하 공격의 제원 — [낮은 낙하, 높은 낙하] 두 벌 */
        plungeMoves: {
          steps: number
          name: string
          damage: number
          trauma: number
          lunge: number
          staminaCost: number
        }[]
        /** ⚔️ 콤보 각 타의 제원 — 실측과 대조하려면 필요합니다 */
        comboSteps: {
          name: string
          damage: number
          staminaCost: number
          range: number
          drawnRange: number
          reachUpperBound: number
          /** 이 단계의 **손끝**(히트스톱, 초)과 **눈**(궤적 무게 0~1). */
          hitstop: number
          power: number
        }[]
        /** 🥋 강타 — 태운 집중 0~3점 각각의 피해 */
        heavySteps: { spent: number; damage: number }[]
        finisherDamage: number
        firstWindup: number
        firstLunge: number
        poiseScale: number
        lastStepDamage: number
        maxRange: number
        /**
         * 누르고 나서 **판정이 뜨기까지**(초). 🟢 반격처럼 "예고 안에 한 대를
         * 꽂아야" 성립하는 색을 검사하려면 이 값이 필요합니다.
         * (이 선언값이 실제와 같다는 것은 `npm run feel` 이 라이브로 잽니다.)
         */
        firstHitAt: number
      }[]
      bossSwingLog: () => Record<
        string,
        { swings: number; hits: number; chained: number; byPhase: number[] }
      >
      /** 레벨에 배치된 적 + 그 적이 선 구역 — 구역 판정은 **게임이** 합니다. */
      levelFoes: () => { kind: string; x: number; z: number; region: string; level: number }[]
      /** 🔥 화톳불 사이 이동의 상태 — 프로브가 규칙을 베끼지 않게. */
      travelInfo: () => { lit: number; opened: boolean; key: string }
      /** 🧪 실험대 전용 — 통을 하나 세웁니다(연쇄·반경 검사를 세우려면 필요). */
      spawnBarrel: (x: number, z: number) => number
      /** 🏺 항아리를 세웁니다. holds 면 안에 보물이 들어 있습니다. */
      spawnUrn: (x: number, z: number, holds?: boolean) => number
      /** 🏺 지금 서 있는 항아리들 — **안에 든 것까지**(디버그 전용). */
      urns: () => { entity: number; x: number; z: number; holds: boolean; broken: boolean }[]
      /** 🏪 상점의 지금 재고 — 프로브가 값을 베끼지 않게. */
      shopInfo: () => {
        atAnvil: boolean
        open: boolean
        embers: number
        items: {
          weaponIndex: number
          weaponName: string
          tier: number
          tierName: string
          price: number
          sold: boolean
          haveTier: number
          affordable: boolean
          affixes: { name: string; unit: string; value: number }[]
        }[]
      }
      /** 🧪 실험대 전용 — 재고의 n번째를 삽니다(창의 버튼과 같은 함수). */
      buyShopItem: (index: number) => boolean
      /** 🏆 장비 등급의 규칙과 지금 상태 — 프로브가 표를 베끼지 않게. */
      gearInfo: () => {
        tiers: { id: number; name: string; color: number; affixes: number; scale: number; weight: number }[]
        weapons: {
          index: number
          name: string
          tier: number
          tierName: string
          seed: number
          level: number
          affixes: { kind: number; name: string; unit: string; value: number }[]
        }[]
        live: { damageMult: number; speedScale: number; cooldownScale: number; magicFlat: number }
      }
      /** 🎁 존의 상자들이 각각 무엇을 줄 것인가 — 열어 보지 않고. */
      treasureRolls: () => {
        x: number
        z: number
        luck: number
        tier: number
        tierName: string
        affixes: { name: string; unit: string; value: number }[]
      }[]
      /** 🏆 지금 떠 있는 검격 자국의 색(0xRRGGBB). 없으면 -1. */
      swingColor: () => number
      /** 🔢 지금 떠 있는 데미지 숫자들의 **화면 상자**(글자가 실제로 차지한 크기). */
      damageBoxes: () => {
        cx: number
        cy: number
        w: number
        h: number
        wy: number
        lateral: number
        age: number
      }[]
      /** ✨ 지금 화면에 놓인 등급 불티(개수·색·좌표). 그린 값을 그대로 묻습니다. */
      auraInfo: () => {
        count: number
        color: number
        weapon: number
        motes: { x: number; y: number; z: number; size: number; opacity: number }[]
      }
      /** 🧪 실험대 전용 — 등급/시드를 직접 끼웁니다. */
      setGear: (weaponIndex: number, tier: number, seed: number) => void
      /** 🧱 금 간 벽 — 길이 뚫렸는가(`open`)와 몸통이 서 있는가(`standing`)는 다릅니다. */
      walls: () => {
        key: string
        x: number
        z: number
        open: boolean
        standing: boolean
        tough: boolean
      }[]
      /** 지금 **걸어서** 그 자리에 닿는가 — 벽 뒤인지를 게임에게 묻는 창. */
      walkableFromPlayer: (x: number, z: number) => boolean
      /** 💥 폭발통의 규칙과 지금 상태 — 프로브가 반경·도화선을 베끼지 않게. */
      barrelInfo: () => {
        blast: number
        chain: number
        fuse: number
        staminaLoss: number
        blown: number
        caught: number
        barrels: {
          entity: number
          x: number
          z: number
          fuseT: number
          fuseTotal: number
          /** 💥 지금 터지면 휘말릴 적의 수 — 게임의 폭발이 쓰는 그 함수로 셉니다. */
          catches: number
        }[]
      }
      shortcutInfo: () => {
        key: string
        open: boolean
        rise: number
        loWorldX: number
        loWorldZ: number
        hiWorldX: number
        hiWorldZ: number
        saving: number | null
      }[]
      shortcutHint: () => 'ready' | 'locked' | 'open' | null
      walkTest: (fromX: number, fromZ: number, toX: number, toZ: number) => boolean
      pathStep: (toX: number, toZ: number) => { x: number; z: number; dist: number } | null
      /**
       * 🚪 **그 자리에서 「나에게 오는」 걸어야 하는 거리**(m). 길이 없으면 null.
       *
       * ⚠️ `pathStep(...).dist` 와 **방향이 반대**입니다. 저건 *내가 거기로*
       *    가는 거리입니다. 한쪽으로만 내려갈 수 있는 턱이 있으면 둘은
       *    다릅니다 — 실제로 이 프로브가 76m 를 보고 "적이 못 온다"고
       *    읽었는데, 그 적은 **턱을 뛰어내려 4m 로** 올 수 있었습니다.
       *    어그로 규칙이 쓰는 것은 **이 방향**입니다.
       */
      walkToPlayer: (x: number, z: number) => number | null
      /**
       * 🧭 지도가 말한 길을 **게임의 충돌로 실제로 걸어** 봅니다.
       * 실패한 시작점만 봐도 *"화살표가 못 가는 쪽을 가리키는 자리"* 가 나옵니다.
       */
      /** 🧭 **게임이 안내하는 길**을 칸으로. 프로브가 동선을 다시 그리지 않게. */
      routeTrail: (fromX: number, fromZ: number, toX: number, toZ: number) => { x: number; z: number }[]
      pathWalk: (
        toX: number,
        toZ: number,
        starts: readonly { x: number; z: number }[],
        step?: number,
        maxSteps?: number,
      ) => {
        x: number
        z: number
        arrived: boolean
        walked: number
        net: number
        endX: number
        endZ: number
        why: string
      }[]
      distancesToward: (
        toX: number,
        toZ: number,
        pts: { x: number; z: number }[],
      ) => { player: number; points: number[] } | null
      /** 🗺 이 월드 좌표의 지형 단(段). 낭떠러지는 -1. */
      terrainLevelAt: (x: number, z: number) => number
      /** 🗺 이 월드 좌표의 구역 이름(없으면 ''). 구역마다 바닥 색조가 다릅니다. */
      regionAt: (x: number, z: number) => string
      terrainInfo: () => {
        maxClimb: number
        heightStep: number
        cellSize: number
        fallFreeSteps: number
        fallDamagePerStep: number
        levelAggroRange: number
        sprintScale: number
        sprintViewScale: number
        cameraViewSize: number
        cameraZoom: number
        /** 🎥 카메라 각도(도) — 지형 가림을 재는 데 씁니다. */
        cameraPitchDeg: number
        cameraYawDeg: number
        aimLeadMax: number
        attackTempo: number
        /** 선입력 창(초) — 템포 프로브가 0.55 를 베껴 적지 않게 */
        inputBuffer: number
        dodgeDuration: number
        dodgeCooldown: number
        dodgeDistance: number
        /** 걷는 속도(m/s) — 🟡 의 정답("걸어서 이탈")을 재려면 필요합니다. */
        walkSpeed: number
        /** 스태미나 최대치 — 이완 구간이 충분한지 재는 데 씁니다. */
        maxStamina: number
        /** 플레이어 몸 반지름 — "포위됐을 때 몸이 지나갈 틈이 있는가"를 재려면 필요합니다. */
        bodyRadius: number
        dodgeStaminaCost: number
        staminaRegen: number
        staminaRegenDelay: number
        dodgeCancelExtraCost: number
        focusPerLightHit: number
        /** ActorState 값 — 프로브가 1/2/5 같은 숫자를 외우지 않게 */
        actorStates: { idle: number; attack: number; dodge: number; skill: number }
        levelAggroLead: number
        levelAggroMax: number
        playerMoveSpeed: number
        playerRadius: number
      }
      entityState: (e: number) => {
        hp: number
        maxHp: number
        level: number
        state: number
        brokenT: number
        x: number
        z: number
        rotY: number
      } | null
      teleportEntity: (e: number, x: number, z: number) => void
      pushEntity: (e: number, vx: number, vz: number) => void
      /** 봇이 추측하지 않고 읽는 실행 통계 */
      runStats: () => {
        deaths: number
        rests: number
        kills: number
        restGeneration: number
        emberDecay: number
        enemySwings: number
        enemyHits: number
        poiseBreaks: number
        windupBreaks: number
        greenSwung: number
        greenDied: number
        greenCountered: number
        greenBroken: number
        breakHpAvg: number
        brokenDeaths: number
        finishers: number
        deaggroUnreachable: number
        deaggroWorstWalk: number
        deaggroWorstStraight: number
        bossFinishers: number
        chainsArmed: number
        chainsFired: number
        chainsLost: [number, number, number, number]
        dodgeStamina: number
        staminaSpent: number
        skillCasts: number[]
        lightSwings: number
        inputUsed: number
        inputExpired: number
        inputExpiredAttack: number
        inputExpiredDodge: number
        inputExpiredSkill: number
        inputDropped: number
        inputWaitAvg: number
        inputCancels: number
      }
      /** 세이브 검증용 — 저장 여부 · 진행 초기화 */
      saveInfo: () => { saveId: string; treasuresTaken: number }
      resetProgress: () => void
      /**
       * 사운드 검증용. 헤드리스에서는 소리를 들을 수 없으므로 **파형의 진폭**을
       * 재서 "실제로 소리가 났다"를 숫자로 확인합니다.
       */
      audio: {
        unlock: () => void
        state: () => { ready: boolean; state: string; voices: number; muted: boolean }
        level: () => number
        music: () => { level: number; voices: number }
        cue: (name: string, a?: number, b?: number) => void
      }
    }
  }
}
window.__game = {
  ready: true,
  press: (code) => debugInput.press(code),
  release: (code) => debugInput.release(code),
  setAim: (x, y) => debugInput.setMouseNdc(x, y),
  aimAtWorld: (x, z) => game.aimAtWorld(x, z),
  state: () => game.debugState(),
  reset: () => game.reset(),
  requestSample: () => game.requestSample(),
  getSample: () => game.getSample(),
  clearEnemies: () => game.debugClearEnemies(),
  /** 🩸 실험대 — 죽지 않는 허수아비를 원하는 체력 비율로 세웁니다. */
  spawnBleedDummy: (hpRatio) => game.debugSpawnBleedDummy(hpRatio),
  /** 🩸 실험대 — 한 대분 얹습니다(게임과 같은 함수). 터졌으면 true. */
  hitBleedDummy: (e, bleedScale) => game.debugHitBleedDummy(e, bleedScale),
  bleedOf: (e) => game.debugBleedOf(e),
  despawnBleedDummy: (e) => game.debugDespawnBleedDummy(e),
  // 등 뒤 판정은 순수 기하 계산이라 엔티티 없이 그대로 검증할 수 있습니다.
  testBehind: (ax, az, tx, tz, trot) => isBehindPoint(ax, az, tx, tz, trot),
  tuning: () => ({ backArcDeg: COMBAT.backArcDeg }),
  /**
   * 🎯 **조준 규칙** — 세 파일에 흩어져 있는 세 값을 한 줄로 냅니다.
   *
   * · `commitToleranceDeg` — 시작해도 되는 각도 (enemyAI.ts)
   * · `windupTurnBudgetDeg` — 예고 한 번에 돌 수 있는 각도 (balance.ts)
   * · 패턴의 `arcDeg` 반값 — 실제로 닿는 각도 (enemyAttacks.ts)
   *
   * 셋은 **서로를 전제로** 정해져 있습니다: 닿는 각도보다 넓게 시작을
   * 허락해 놓고, 모자란 몫은 예고 동안 돌아서 채우기로 한 것입니다.
   * 그런데 파일이 셋 다 달라서, 예고를 줄이거나 부채꼴을 좁히면
   * **아무 검사도 울리지 않은 채** 그 패턴이 확정 헛방이 됩니다.
   *
   * 프로브가 45·90 을 베껴 적으면 그 순간 이 파일들이 「또 하나의 진실」이
   * 되므로 값은 게임이 알려 줍니다.
   */
  aimRule: () => ({
    commitToleranceDeg: ATTACK_FACING_TOLERANCE_DEG,
    windupTurnBudgetDeg: WINDUP_TURN_BUDGET_DEG,
  }),
  setPaused: (paused) => game.debugSetPaused(paused),
  /**
   * 💢 **강인도 규칙을 그대로 물어봅니다** — 판정과 **같은 함수**입니다.
   *
   * ⚠️ 처음엔 프로브가 실제로 보스를 세 번 무너뜨려 "몇 대 들었나"를 셌습니다.
   *    맞는 방향이지만 SwiftShader 에서 프레임 수천 장을 그려야 해서 한 판이
   *    10분을 넘겼습니다 — **검사가 너무 느리면 아무도 안 돌립니다.**
   *
   *    규칙이 참인지는 순수 함수 하나로 답할 수 있습니다. *효과*(붕괴가
   *    실제로 줄었는가)는 `npm run play` 가 이미 세고 있으니, 여기서는
   *    **규칙만** 봅니다. 둘을 한 검사에 욱여넣지 않습니다.
   */
  poiseRule: (kindId, breaks) => game.debugPoiseRule(kindId, breaks),
  /** 🔎 적이 안 때리고 서 있던 프레임의 이유 — 읽으면서 비웁니다. */
  idleReasons: () => readIdleReasons(),
  /** 📒 적의 휘두름 장부 — 읽으면서 **비웁니다**(다음 판에 섞이지 않게). */
  swings: () => {
    // 아직 열려 있는 휘두름을 먼저 닫습니다 — 안 그러면 마지막 한 줄이 빕니다.
    flushSwingRecords()
    const out = swingRecords.map((r) => ({ ...r }))
    swingRecords.length = 0
    return out
  },
  /** 🏛 폐허 잔해 장부 — 몇 개가 어느 구역에 섰는가. */
  props: () => game.debugProps(),
  /**
   * 🏛 잔해를 통째로 껐다 켭니다 — **"세어서 있다"와 "화면에 보인다"는
   * 다른 말**이라, 프로브가 끄고 한 장 더 찍어 견주려고 씁니다.
   */
  showProps: (on) => game.debugShowProps(on),
  /** ⏱ 고정 걸음 — 벽시계 대신 걸음 수로 시간을 줍니다(설계 근거는 debugStep 주석). */
  step: (frames, dtSec, fromZero) => game.debugStep(frames, dtSec, fromZero),
  swingVisible: () => game.debugSwingVisible(),
  swingColor: () => game.debugSwingColor(),
  damageBoxes: () => game.debugDamageBoxes(),
  auraInfo: () => game.debugAura(),
  telegraphs: () => game.debugTelegraphs(),
  spawnTestEnemy: (x, z, rotY, asleep) => game.debugSpawnTestEnemy(x, z, rotY, asleep),
  freezeEnemies: (frozen) => setEnemyAiEnabled(!frozen),
  spawnVfx: (kind) => game.debugSpawnVfx(kind),
  forceAttack: (entity, index, windupScale) => game.debugForceAttack(entity, index, windupScale),
  spawnBoss: (x, z) => game.debugSpawnBoss(x, z),
  applySnare: (seconds) => game.debugApplySnare(seconds),
  grantTripod: (n) => {
    grantTripodPoint(n)
    game.debugRefreshLoadout()
  },
  unlockTripod: (skillId, tier, option) => {
    const ok = unlockTripod(skillId, tier, option)
    if (ok) {
      game.debugRefreshLoadout()
      game.persistProgress()
    }
    return ok
  },
  switchTripod: (skillId, tier, option) => {
    const ok = switchTripod(skillId, tier, option)
    if (ok) {
      game.debugRefreshLoadout()
      game.persistProgress()
    }
    return ok
  },
  effectiveSkill: (slot) => game.debugEffectiveSkill(slot),
  tripodInfo: () => game.debugTripodInfo(),
  toggleTripodPanel: () => game.debugToggleTripodPanel(),
  /**
   * 적 종류표 — **ENEMY_DEFS 를 그대로 돌립니다.**
   *
   * 예전엔 `[Grunt, Binder, Dragger, Boss]` 라고 손으로 적어 뒀는데,
   * 그 뒤에 들어온 **달려드는 자와 쏘는 자가 통째로 빠져 있었습니다.**
   * 새 적을 넣을 때 이 줄을 고쳐야 한다는 걸 아무것도 알려주지 않습니다 —
   * 렌더링에서 달려드는 자가 **투명하게 보이던** 버그와 같은 모양입니다
   * (visuals.ts 도 같은 이유로 손으로 적은 switch 를 걷어냈습니다).
   *
   * 목록을 손으로 적으면 언젠가 반드시 빠집니다. 데이터에서 돌립니다.
   */
  enemyRoster: () =>
    Object.keys(ENEMY_DEFS).map((key) => {
      const k = Number(key) as EnemyKind
      const d = enemyDef(k)
      return {
        id: d.id,
        name: d.name,
        maxHp: d.maxHp,
        height: d.height,
        radius: d.radius,
        moveSpeed: d.moveSpeed,
        // 처치가 주는 불티 — 지도 위의 **수입**을 정적으로 셀 수 있게 합니다.
        ember: d.ember,
        /**
         * **사거리 밖에서 실제로 내는 속도.** 프로브가 `moveSpeed`만 보고
         * "가장 빠른 적"을 고르면 추격전에서는 틀린 답이 나옵니다 —
         * 이 게임에서 도망을 따라잡는 건 전투 속도가 아니라 접근 속도입니다.
         */
        approachSpeed: d.moveSpeed * (d.approachSpeedScale ?? 1),
        attackRange: d.attackRange,
        keepDistance: d.keepDistance,
        /**
         * 🎯 **도는 속도**(도/초). 예고 중에는 이 값과 `aimRule` 의 예산 중
         * **작은 쪽**이 실제 속도가 됩니다(`enemyAI` 예고 회전). 느린 적은
         * 예산을 다 못 쓰므로, 예산만 보면 못 도는 적을 돈다고 셉니다.
         */
        turnSpeedDeg: d.turnSpeedDeg,
        /**
         * **한 번 공격하는 데 걸리는 전체 시간**(초). 프로브가 네 값을
         * 따로 받아 더하다가 하나를 빠뜨리는 일이 없도록 여기서 냅니다.
         *
         * ⚠️ **적 정의의 windup/active/recovery 를 쓰면 안 됩니다.**
         *    실제로 도는 것은 **패턴의 값**이고(`commitAttack`), 정의의
         *    값은 기본값일 뿐입니다. 패턴이 하나일 때는 둘이 같아서 아무도
         *    몰랐는데, 적마다 **두 번째 박자**를 주는 순간 이 값이 허구가
         *    됩니다 — 예를 들어 쏘는 자는 저격(2.29초)과 큰 한 발(3.21초)을
         *    번갈아 쓰는데, 정의 하나로는 그 둘 중 어느 것도 아닙니다.
         *
         *    그래서 **가중 평균**을 냅니다. `npm run map` 이 이 값으로
         *    *"지나가는 동안 몇 발 쏘는가"* 를 계산하므로, 여기가 틀리면
         *    그 판정이 통째로 틀립니다. 박자를 늘린 변경이 **계기의 가정을
         *    깬 것**이고, 가정을 깼으면 계기도 같이 고쳐야 합니다.
         */
        attackCycle: (() => {
          const list = attacksFor(k)
          const total = list.reduce((n, a) => n + a.weight, 0)
          if (total <= 0) return d.attackCooldown + d.windup + d.active + d.recovery
          const avg =
            list.reduce((n, a) => n + (a.windup + a.active + a.recovery) * a.weight, 0) / total
          return d.attackCooldown + avg
        })(),
        poiseMax: d.poiseMax,
        /**
         * 🔔 **이 종류가 실제로 깨어나는 거리**(m) — AI 가 쓰는 바로 그 값.
         *
         * `npm run map` 이 이 식을 손으로 베껴 두고 있었습니다. 지난 회차에
         * 「주 동선」이 세 곳에서 따로 그려지다 어긋난 것과 같은 병이라,
         * 같은 처방을 씁니다 — 식은 `enemyAI.wakeRangeOf` 한 곳에만 둡니다.
         *
         * ⚠️ **모드에 따라 값이 다릅니다.** 레벨 모드에서는 방 단위로 좁혀
         *    쏘는 자 19m 이고, 아레나에서는 종류별 기본값(55m)입니다.
         *    실험대를 아레나에 세우면 **게임과 다른 규칙**을 재게 됩니다.
         */
        wakeRange: wakeRangeOf(k),
        attacks: attacksFor(k).map((a) => ({
          id: a.id,
          intent: a.intent as number,
          color: INTENT_EMOJI[a.intent],
          /** 실제로 때리는 거리. 어그로 여유를 이 값으로 잽니다(attackRange 아님). */
          reach: a.reach,
          /**
           * 📏 **화면에 그려지는 반지름** — 실제로 맞는 자리까지
           * (enemyAttacks.ts `telegraphRadius`). `reach` 와 다릅니다.
           * 프로브가 *"선 밖에서 맞는가"* 를 물으려면 **그린 값**이
           * 필요합니다. 여기서 계산해 주면 프로브가 `+0.45` 를 베끼지
           * 않고, 규칙을 옮기는 날 검사가 저절로 따라옵니다.
           */
          drawnReach: Number(telegraphRadius(a).toFixed(3)),
          /**
           * **기본 가중치.** 페이즈 덮어쓰기가 없을 때 이 값이 쓰입니다
           * (bossPhaseWeights 와 짝입니다). 프로브가 *"가중치대로 고르는가"*
           * 의 기대치를 만들려면 둘 다 필요한데, 한쪽만 있으면 덮어쓰기가
           * 없는 패턴의 기대치가 **조용히 0** 이 됩니다 — 실제로 그렇게
           * 만들어 놓고 한 번 당했습니다(기대 0% · 실제 63%).
           */
          weight: a.weight,
          /** 예고 중 돌진 속도(m/s). 0이면 제자리에서 휘두릅니다. */
          lungeSpeed: a.lungeSpeed ?? 0,
          windup: a.windup,
          arcDeg: a.arcDeg,
          active: a.active,
          recovery: a.recovery,
          snare: a.snare ?? 0,
          minRange: a.minRange,
          maxRange: a.maxRange,
          /** 💥 한 대의 피해 — 「8초의 천장」을 세는 데 필요합니다(선언부 주석). */
          damage: a.damage,
          /** 🏹 날아가는 패턴인가 — 토큰 줄이 근접·원거리로 갈려 있습니다. */
          projectile: a.projectile === true,
        })),
      }
    }),
  /**
   * 🎟 토큰 규칙을 **표 그대로** 내보냅니다 — 프로브가 숫자를 베끼지
   * 않도록(선언부 주석에 이유를 적어 두었습니다).
   */
  combatLimits: () => ({
    melee: MAX_CONCURRENT_ATTACKERS,
    wide: MAX_CONCURRENT_WIDE,
    ranged: MAX_CONCURRENT_RANGED,
    commitGap: ATTACK_COMMIT_GAP,
  }),
  levelRoster: () => game.debugLevelRoster(),
  spawnEnemyKind: (id, x, z, asleep) => game.debugSpawnKind(id, x, z, asleep),
  bossTuning: () =>
    BOSS_PHASES.map((ph) => ({
      name: ph.name,
      enterBelow: ph.enterBelow,
      cooldownScale: ph.cooldownScale,
      /** ⏸ 전환 연출 = 무적 구간의 길이. 페이즈마다 같지만 읽는 자리에서 바로 쓰이게 함께 냅니다. */
      transitionTime: PHASE_TRANSITION_TIME,
      /** 🛡 받는 피해 배율 — 프로브가 0.7 을 **베껴 적지 않도록** 내보냅니다. */
      damageTakenScale: ph.damageTakenScale ?? 1,
      windups: attacksFor(EnemyKind.Boss).map((a) => ({ id: a.id, seconds: a.windup * ph.windupScale })),
      /**
       * 이 페이즈의 **연계 표** — 프로브가 기대값을 베껴 적지 않도록 그대로 내보냅니다.
       * (연계를 바꿨는데 검증만 옛 표로 통과하는 일을 막습니다.)
       */
      chains: ph.chains ?? {},
      /** 🎬 전환 직후의 고정 패턴 — 프로브가 'boss_charge' 를 베껴 적지 않게. */
      firstAttack: ph.firstAttack ?? '',
    })),
  damageEntity: (entity, amount) => {
    if (!isAlive(entity)) return
    Health.hp[entity] = Math.max(0, Health.hp[entity] - amount)
  },
  enemyInfo: (entity) => {
    if (!isAlive(entity)) return null
    const kind = Enemy.kind[entity]
    const list = attacksFor(kind)
    const chain = Enemy.chainNext[entity]
    return {
      hp: Number(Health.hp[entity].toFixed(1)),
      max: Health.max[entity],
      /** 🚪 AI 가 쓰는 **그 적이 나에게 오는** 걸어야 하는 거리(m). 규칙이 없으면 null. */
      walk: reachDistanceOf(Transform.x[entity], Transform.z[entity]),
      phase: Enemy.phase[entity],
      transitionT: Number(Enemy.transitionT[entity].toFixed(3)),
      x: Number(Transform.x[entity].toFixed(3)),
      z: Number(Transform.z[entity].toFixed(3)),
      state: Actor.state[entity],
      attacking: Actor.state[entity] === ActorState.Attack,
      // 예고 중인가 — 반격 검증이 `attackPhase === 0` 을 베끼지 않도록 노출합니다.
      winding:
        Actor.state[entity] === ActorState.Attack && Actor.phase[entity] === AttackPhase.Windup,
      rotY: Number(Transform.rotY[entity].toFixed(3)),
      /** 현재 단계의 남은 시간(초) — 완벽 회피 타이밍을 재려면 필요합니다. */
      timer: Number(Actor.timer[entity].toFixed(3)),
      /**
       * 지금 패턴의 예고 길이(초).
       *
       * `timer` 만 있으면 "절반쯤 지났는가"를 물을 수 없습니다 — 분모가
       * 없으니까요. 프로브가 예고 길이를 베껴 적는 순간 그 파일이 또 하나의
       * 진실이 되므로, 게임이 알려 줍니다.
       */
      /**
       * ⏳ 설정값이 아니라 **이번 공격에 실제로 건 길이**입니다.
       * 페이즈 배율과 지연(`hold`)이 이미 반영돼 있습니다 — components.ts
       * `windupLen` 주석 참고.
       */
      windup: Number(Enemy.windupLen[entity].toFixed(3)),
      /** ⏳ 그중 **뜸 들인 몫**(초). 0이면 평소 박자입니다. */
      held: Number(Enemy.heldT[entity].toFixed(3)),
      /**
       * 🍶 다음 공격까지 남은 쿨다운(초). 음수는 *"준비됐는데 못 때리고
       * 있는 시간"*(인내심)입니다 — enemyAI 의 `impatient` 와 같은 값.
       *
       * 노출하는 이유: *"회복을 노려 쿨다운을 당겼는가"* 를 **시간을 재서**
       * 확인하면 검사가 흔들립니다(실제로 기준선이 판마다 1.15초와 "못 봄"
       * 사이를 오갔습니다). 규칙이 바꾸는 값을 직접 보면 흔들릴 것이 없습니다.
       */
      cooldown: Number(Actor.cooldownT[entity].toFixed(3)),
      brokenT: Number(Enemy.brokenT[entity].toFixed(2)),
      /**
       * 🤕 **지금 남아 있는 피격 번쩍임**(초). 프로브가 *"무거운 타격이
       * 실제로 더 오래 반응을 남기는가"* 를 **설정이 아니라 화면에 실린
       * 값으로** 재려고 노출합니다 — 상수를 읽어 비교하면 배선이 끊겨
       * 있어도 통과합니다.
       */
      flashT: Number(Health.flashT[entity].toFixed(3)),
      /** 🤕 지금 밀려나는 속도(m/s). 몸이 젖혀지는 양이 여기서 나옵니다. */
      knock: Number(Math.hypot(Velocity.kx[entity], Velocity.kz[entity]).toFixed(3)),
      intent: attackAt(kind, Enemy.attackIndex[entity]).intent,
      /**
       * **후딜 중인가** — 판정이 이미 끝나 무방비인 구간.
       *
       * 봇이 `attacking && !winding` 으로 판정과 후딜을 **한 덩어리로**
       * 보고 있었습니다. 그런데 `npm run flank` 로 재 보니 둘은 완전히
       * 다른 구간입니다: 판정 중에 적 둘레를 돌면 잡몹 기준 **매번 14**
       * 를 맞고(3/3), 후딜부터 돌면 **매번 0** 입니다. 휘두르는 칼 안으로
       * 걸어 들어가는 것이니 당연합니다 — 🟡 광역은 판정이 머무르기까지
       * 합니다(combat.ts lingers).
       *
       * 구간을 가르는 것은 **게임이** 합니다. 봇이 `active` 시간을 베껴
       * 세고 있으면 판정 길이를 바꾸는 날 봇만 옛 시간표로 돕니다.
       */
      recovering:
        Actor.state[entity] === ActorState.Attack &&
        Actor.phase[entity] === AttackPhase.Recovery,
      staggered: Actor.state[entity] === ActorState.Stagger,
      broken: Enemy.brokenT[entity] > 0,
      poise: Number(Enemy.poise[entity].toFixed(1)),
      /** 🩸 지금 쌓인 출혈(0~max). 프로브가 축적을 눈으로 볼 수 있게 합니다. */
      bleed: Number(Enemy.bleed[entity].toFixed(1)),
      poiseMax: enemyDef(Enemy.kind[entity]).poiseMax,
      attackId: attackAt(kind, Enemy.attackIndex[entity]).id,
      attackPhase: Actor.phase[entity],
      chainNext: chain === NO_CHAIN ? '' : (list[chain]?.id ?? ''),
      cooldownT: Number(Actor.cooldownT[entity].toFixed(3)),
      /** 등 뒤를 잡혔을 때 "아직 못 알아챈" 남은 시간(초). 백어택 여유의 실체입니다. */
      reactT: Number(Enemy.reactT[entity].toFixed(3)),
      aggro: Enemy.aggro[entity] === 1,
      /** 기습 유예 남은 시간(초) — "조금 전까지 나를 못 봤다"의 실체입니다. */
      unawareT: Number(Enemy.unawareT[entity].toFixed(3)),
    }
  },
  /**
   * 보스 페이즈의 **체력 경계**(enterBelow) 배열. 프로브가 "2단계 한가운데"
   * 같은 자리를 잡으려면 필요한데, 여기 숫자를 프로브에 적어 두면 경계를
   * 옮기는 날 그 프로브가 **조용히 엉뚱한 페이즈**를 재게 됩니다.
   */
  bossPhaseBounds: () => BOSS_PHASES.map((p) => p.enterBelow),
  /**
   * 페이즈별 **가중치 덮어쓰기** 표. 프로브가 *"적어 둔 성격이 실제로
   * 나오는가"* 를 물으려면 기대치가 필요한데, 그 기대치를 프로브가 따로
   * 적어 두면 가중치를 바꾸는 날 검사가 조용히 옛말이 됩니다.
   */
  bossPhaseWeights: () => BOSS_PHASES.map((p) => ({ ...(p.weights ?? {}) })),
  /**
   * 🎲 **무엇을 왜 골랐는가** (설계 노트는 enemyAI `notePick`).
   *
   * 휘두름 수를 가중치와 비교하면 굴림이 아닌 것(연계 · 광역 자리 대체 ·
   * `preferReach`)이 섞여서 **엉뚱한 결론**이 납니다. 이 장부는 굴림 자체를
   * 적으므로, 프로브가 추측 없이 *"굴려서 고른 것"* 만 골라 볼 수 있습니다.
   */
  pickLog: () => readPickLog(),
  /**
   * 🎲 **전투 난수의 씨앗을 갈아 끼웁니다** — 프로브가 «여러 판»을 볼 수 있게.
   * 왜 필요했는지는 `core/rng.ts` 의 `reseed` 자리에 적어 뒀습니다
   * (표본이 하나뿐이라 3σ 어긋남을 판정할 수 없었던 일).
   */
  setCombatSeed: (seed: number) => combatRng.reseed(seed),
  /**
   * 🔁 **갚을 수 있는가** — 정답대로 답한 사람의 돌아오는 길
   *    (설계와 계산은 config/punish.ts).
   *
   * 통과/실패 판단(`ok`)까지 게임이 합니다. 프로브가 문턱을 들고 있으면
   * 밸런스를 바꿀 때마다 프로브를 같이 고쳐야 하고, 그러다 보면 프로브가
   * 게임을 따라 움직여서 **영영 빨개지지 않습니다.**
   */
  punishTable: () => punishTable(),
  /** 예고 동안 옆으로 빠져 부채꼴을 벗어날 수 있는가 — 위 표의 반대편 근거. */
  sidestepTable: () => sidestepTable(),
  /**
   * 🧪 실험대 전용 무적 — 근거는 combat.ts `setPlayerInvulnerable` 설계 노트.
   * (보스가 내주는 창을 재려면 그 앞에 오래 서 있어야 하는데, 한 번 죽으면
   *  조우가 통째로 끝나 그 뒤 관측이 전부 빈 값이 됩니다.)
   */
  setPlayerInvulnerable: (on) => setPlayerInvulnerable(on),
  counterInfo: () => ({
    brokenTime: COUNTER.brokenTime,
    normalBrokenTime: POISE.brokenTime,
    /** 보스가 무너져 있는 시간(초) — 잡몹보다 깁니다. 창 길이가 무기 선택을 가릅니다. */
    bossBrokenTime: POISE.brokenTimeBoss,
    damageMultiplier: COUNTER.damageMultiplier,
    /**
     * 강인도 **회복**의 두 값입니다.
     *
     * ⚠️ 이 둘을 프로브에 적어 두면 안 되는 이유가 이번에 드러났습니다 —
     *    실전 리듬에서 회복이 켜지는지 아닌지는 `regenDelay` 하나가 아니라
     *    **적의 공격 주기와의 관계**로 정해집니다. 관계를 재려면 양쪽 다
     *    게임에서 읽어야 하고, 한쪽이라도 복사해 두면 그 관계가 바뀐 날
     *    검사가 조용히 옛말이 됩니다.
     */
    poiseRegenDelay: POISE.regenDelay,
    poiseRegenPerSec: POISE.regenPerSec,
  }),
  /**
   * 예산을 프로브가 스스로 정하지 않게 여기서 넘겨줍니다.
   *
   * ⚠️ 색 가짓수도 **프로브가 세면 안 됩니다.** 프로브에 "4색"이라고 적어
   *    뒀다가 🟢 이 다섯째로 들어온 것을 놓쳤습니다. 여기서 실제 패턴
   *    표를 훑어 세면, 색을 추가한 그날 예산이 저절로 올라갑니다.
   */
  hurtLedger: () => game.debugHurtLedger(),
  reactionBudget: () => {
    const seen = new Map<
      number,
      { intent: number; emoji: string; label: string; answerIsDodge: boolean }
    >()
    for (const key of Object.keys(ENEMY_DEFS)) {
      for (const a of attacksFor(Number(key) as EnemyKind)) {
        if (!seen.has(a.intent)) {
          seen.set(a.intent, {
            intent: a.intent,
            emoji: INTENT_EMOJI[a.intent],
            label: INTENT_LABEL[a.intent],
            /**
             * **이 색의 정답이 구르기인가.** 규칙은 `enemyAttacks.ts`
             * `ANSWER_IS_DODGE` 한 곳에만 있고 여기서는 실어 보내기만
             * 합니다 — 프로브가 라벨 문자열로 짐작하지 않게.
             *
             * 없어서 생긴 일: `npm run react` 가 🔴·🟡·🟣·🟢 만 재고
             * **🔵 속박을 아예 안 재고 있었습니다.** 🔵 의 정답도
             * 구르기(무적 프레임)라 🔴 과 같은 검사를 받아야 하는데,
             * 프로브가 색 목록을 손으로 적어 두어서 빠진 것을 아무도
             * 몰랐습니다. 이제 게임이 답을 같이 보내므로 프로브가
             * **색마다 빠짐없이** 돌 수 있습니다.
             */
            answerIsDodge: ANSWER_IS_DODGE[a.intent],
          })
        }
      }
    }
    const colors = [...seen.values()].sort((x, y) => x.intent - y.intent)
    return {
      /**
       * 🖥 손끝 차이를 셀 때의 **한 프레임**(초) — balance.ts `FEEL`.
       * 프로브가 `1/60` 을 손으로 적어 쓰고 있었습니다. 가정이므로
       * 한 곳에 두고 **읽어 가게** 합니다(REACTION 과 같은 취급).
       */
      frame: FEEL.frame,
      /**
       * 🖥 **한 프레임의 안전 상한**(초) — `core/time.ts` 의 `MAX_FRAME_DT`.
       * 목표 프레임이 **아닙니다**(탭 전환 복귀용). 느린 기계는 매 프레임
       * 여기 붙어 도는데, 그때 찍히는 초를 게임의 입력 지연으로 읽으면
       * 안 되므로 프로브가 **구분해서 말할 수 있게** 같이 보냅니다.
       */
      maxFrame: MAX_FRAME_DT,
      simple: Number(reactionTime(1).toFixed(3)),
      choice: Number(reactionTime(colors.length).toFixed(3)),
      colors,
    }
  },
  counterCount: () => game.debugCounterCount(),
  guardInfo: () => game.debugGuardInfo(),
  dodgeInfo: () => game.debugDodgeInfo(),
  moveInfo: () => game.debugMoveInfo(),
  /**
   * 🩸 출혈 규칙 — 프로브가 문턱과 배율을 베끼지 않게 게임이 알려 줍니다.
   * 무기별 배율까지 함께 냅니다(무기 하나로 통과시키면 나머지 둘을 든
   * 사람에게는 없는 규칙이 됩니다 — punish.ts 가 적어 둔 문장).
   */
  bleedBars: () => game.debugBleedBars(),
  bleedInfo: () => ({
    /**
     * 🩸 **문턱은 적마다 다릅니다**(enemies.ts `bleedMaxOf`). 예전에는
     * 전역 `BLEED.max` 하나를 내보냈는데, 그 값은 이제 **아무것도 정하지
     * 않습니다.** 안 정하는 값을 계속 내보내면 프로브가 그걸로 판정하다가
     * 조용히 틀립니다 — 그래서 지웠고, 대신 적별 표를 냅니다.
     */
    maxByKind: Object.keys(ENEMY_DEFS).map((key) => {
      const k = Number(key) as EnemyKind
      return { id: enemyDef(k).id, max: bleedMaxOf(k) }
    }),
    perHit: BLEED.perHit,
    decayDelay: BLEED.decayDelay,
    decayPerSec: BLEED.decayPerSec,
    /** 🩸 몰린 적의 게이지 **바닥** 비율 — 규칙은 balance.ts `decayFloorRatio` 한 곳에만. */
    decayFloorRatio: BLEED.decayFloorRatio,
    popDamagePct: BLEED.popDamagePct,
    popDamageCap: BLEED.popDamageCap,
    weapons: WEAPONS.map((w) => ({
      id: w.id,
      bleedScale: w.bleedScale,
      poiseScale: w.poiseScale,
      hitsPerCombo: w.combo.length,
      /** 콤보 한 바퀴가 쌓는 양 — "몇 바퀴면 터지는가"를 게임이 계산합니다. */
      perCombo: Number((BLEED.perHit * w.bleedScale * w.combo.length).toFixed(1)),
      /**
       * ── 🩸 **손익분기 간격**(초) — 이보다 느리게 때리면 **줄어듭니다** ──
       *
       * 출혈은 쌓기만 하는 눈금이 아닙니다. 유예(`decayDelay`)가 지나면
       * 초당 `decayPerSec` 씩 식습니다. 그래서 한 대의 값어치는 절대량이
       * 아니라 **간격과의 싸움**입니다:
       *
       *     손익분기 = 유예 + (한 대가 쌓는 양 ÷ 식는 속도)
       *
       * 이 간격보다 느리게 때리면 한 대 쌓는 동안 그보다 더 잃습니다 —
       * 아무리 오래 싸워도 **영원히 안 찹니다.** 실제로 보스전이 그랬습니다:
       * 평균 간격 3.20초에 롱소드 손익분기 3.10초. 0.1초 차이로 지고
       * 있었고, 그래서 96/100 까지 갔다가 늘 되돌아왔습니다.
       *
       * 게임이 계산합니다 — 프로브가 이 식을 베껴 두면 값을 손보는 날
       * 조용히 옛말이 됩니다.
       */
      breakEvenGap: Number(
        (BLEED.decayDelay + (BLEED.perHit * w.bleedScale) / BLEED.decayPerSec).toFixed(2),
      ),
      /**
       * 🩸 **바닥에서 문턱까지 몇 대인가.**
       *
       * 이번에 넣은 규칙(`decayFloorRatio`)이 파는 문장이 *"몰아붙이면
       * 터진다"* 인데, 그게 **한 번 붙는 동안에 들어오는 타수**인지가
       * 전부입니다. 빈사(체력 0 기준)의 바닥에서 문턱까지 필요한 타수를
       * 게임이 계산합니다 — 프로브가 이 식을 베껴 두면 값을 손보는 날
       * 조용히 옛말이 됩니다.
       */
      hitsFromFloor: Math.ceil(
        (BLEED.max * (1 - BLEED.decayFloorRatio)) / (BLEED.perHit * w.bleedScale),
      ),
    })),
  }),
  /**
   * 🎛 슬롯 규약 — **loadout.ts 가 정한 것을 그대로** 내보냅니다.
   * 검사가 "룬은 3·4번" 같은 숫자를 들고 있으면, 슬롯을 늘리는 날
   * 게임은 멀쩡한데 검사만 빨개집니다(실제로 그렇게 됐습니다).
   */
  slotInfo: () => ({ count: SLOT_COUNT, firstRuneSlot: FIRST_RUNE_SLOT }),
  /** 🌿 트라이포드 **표의 크기** — 창에 몇 개가 그려져야 하는지 게임이 압니다. */
  tripodTable: () => ({
    skills: WEAPONS[Loadout.weapon[game.debugPlayerEntity()]].skills.filter((id) =>
      tripodsFor(id),
    ).length,
    tiers: TRIPOD_TIERS,
    perTier: 2,
  }),
  focusInfo: () => ({
    focus: Number(Player.focus[game.debugPlayerEntity()].toFixed(3)),
    max: FOCUS.max,
    perLightHit: FOCUS.perLightHit,
    perPerfectDodge: FOCUS.perPerfectDodge,
    damagePerPoint: FOCUS.damagePerPoint,
    perfectDodgeCritWindow: FOCUS.perfectDodgeCritWindow,
    // 지금 남은 확정 치명타 시간. 규칙은 게임이 굴리고 실험대는 **읽기만** 합니다.
    critT: Number(Player.perfectCritT[game.debugPlayerEntity()].toFixed(3)),
  }),
  setFocus: (n) => {
    Player.focus[game.debugPlayerEntity()] = Math.max(0, Math.min(FOCUS.max, n))
  },
  /**
   * 실험대 전용 — 기력을 원하는 값으로 맞춥니다.
   *
   * "기력이 모자라면 취소가 안 된다"를 검사하려면 **모자란 상태를 만들어야**
   * 하는데, 굴러서 빼면 굴린 만큼 쿨다운·회복지연이 함께 걸려 무엇 때문에
   * 안 된 것인지 못 가립니다. setFocus·setHp 와 같은 성격의 장치입니다.
   */
  setStamina: (n) => {
    const p = game.debugPlayerEntity()
    Stamina.value[p] = Math.max(0, Math.min(Stamina.max[p], n))
  },
  /**
   * 🧪 기력을 **매 프레임** 그 값으로 붙들어 둡니다(null 이면 풉니다).
   * `setStamina` 는 한 번 써 넣을 뿐이라, 회복이 도는 사이에 값이 올라갑니다.
   * 근거는 게임 루프의 `staminaPin` 주석.
   */
  pinStamina: (n) => {
    const p = game.debugPlayerEntity()
    game.setStaminaPin(n === null ? null : Math.max(0, Math.min(Stamina.max[p], n)))
  },
  /**
   * 실험대 전용 — 완벽 회피 직후 상태(확정 치명타 창)를 강제로 엽니다.
   *
   * ── 왜 필요한가 ──────────────────────────────────────────────
   * `npm run feel` 은 "잘 읽을수록 화면이 더 오래 멎는가"를 **실제로 재야**
   * 하는데, 완벽 회피는 적의 예고를 코앞에서 굴러 넘겨야 성립합니다. GPU가
   * 없어 10~20fps 로 도는 이 컨테이너에서 그 타이밍을 맞추면, 재는 것이
   * **게임이 아니라 운**이 됩니다.
   *
   * ⚠️ 이건 **결과를 조작하는 장치가 아닙니다.** 여는 것은 *조건*뿐이고,
   *    등급을 매기고 정지 시간을 정하는 코드는 실제 전투 경로 그대로
   *    돕니다. setStamina·setFocus 와 정확히 같은 성격입니다 — "만들기
   *    어려운 상태를 만들어 주되, 규칙은 게임이 판단한다."
   */
  setPhaseTeaching: (on) => setPhaseTeaching(on),
  wakeEnemy: (entity) => {
    Enemy.aggro[entity] = 1
    // "깨운다"는 곧 **나를 봤다**는 뜻입니다 — 유예도 같이 지워야
    // 실험대가 "이미 싸우고 있는 적"이라는 뜻대로 섭니다.
    Enemy.unawareT[entity] = 0
  },
  /**
   * 실험대 전용 — 어그로 거리 덮어쓰기.
   *
   * ⚠️ **아레나는 접근을 잴 수 없는 무대입니다.** 잡몹의 `aggroRange` 는
   *    55m 인데 아레나 반지름은 26m 라, 아무리 멀리 낳아도 **항상 깨어
   *    있습니다**(게다가 물리가 반지름 안으로 끌어당깁니다). 존은
   *    `LEVEL_AGGRO_RANGE`(14m)로 덮어써서 방 단위로 깨우는데, 아레나에는
   *    그 덮어쓰기가 없습니다.
   *
   *    이걸 모르고 "기습이 안 된다"는 결론을 낼 뻔했습니다 — 게임이 아니라
   *    **무대가 불가능했던 것**입니다.
   */
  setAggroRange: (range) => setAggroRangeOverride(range),
  awareInfo: () => {
    const p = game.debugPlayerEntity()
    const speed = Math.hypot(Velocity.x[p], Velocity.z[p])
    return {
      frontArcDeg: AWARE.frontArcDeg,
      hearQuiet: AWARE.hearQuiet,
      hearLoud: AWARE.hearLoud,
      ambushGrace: AWARE.ambushGrace,
      alertRadius: AWARE.alertRadius,
      markRange: AWARE.markRange,
      noiseRingRange: AWARE.noiseRingRange,
      /**
       * 🚪 **깬 뒤에도 「걸어서 닿는가」를 다시 묻는** 문턱 — 프로브가
       * 4 와 20 을 베껴 적지 않게 게임이 내보냅니다.
       */
      deaggroRatio: LEVEL_DEAGGRO_RATIO,
      deaggroMin: LEVEL_DEAGGRO_MIN,
      /** 🚧 적 AI 가 지금 도는가 — 멈춘 게임을 재고 규칙 탓을 하지 않게. */
      enemyAiOn: enemyAiRunning(),
      // 식이 아니라 **게임이 쓰는 그 함수**를 부릅니다(balance.ts 주석 참고).
      hearNow: hearDistance(speed),
      playerSpeed: speed,
      ...game.debugAwareMarks(),
    }
  },
  grantPerfectDodge: () => {
    Player.perfectCritT[game.debugPlayerEntity()] = FOCUS.perfectDodgeCritWindow
  },
  poiseBars: () => game.debugPoiseBars(),
  threats: (range) => game.debugThreats(range),
  threatRange: () => game.debugThreatRange(),
  deathLog: () => game.debugDeathLog(),
  /** 🤸 색별 오답 횟수와 다시 가르친 색 — 프로브가 문턱을 안 들게 게임이 답합니다. */
  colorTeach: () => game.debugColorTeach(),
  /**
   * 📏 **등 뒤 표시가 그려지는 바깥 반지름**(m) — 판정(`testBehind`)에는
   * 거리 제한이 없습니다. 둘을 나란히 놓아야 *"표시가 사실을 말하는가"* 를
   * 물을 수 있습니다. 프로브가 `+1.15` 를 베끼지 않게 게임이 내보냅니다.
   */
  backZoneOuter: (kind) => backZoneOuter(kind),
  /** ❤️ 저체력 심장 박동 — 문턱은 게임이 알려 줍니다(프로브가 베끼지 않게). */
  heartbeatInfo: () => ({ ...sfx.debugHeartbeat(), warn: PLAYER_CFG.lowHpWarn }),
  slotCooldowns: () => game.debugSlotCooldowns(),
  cameraAxes: () => game.debugCameraAxes(),
  telegraphView: () => game.debugTelegraphView(),
  objective: () => game.debugObjective(),
  bossEncounter: () => game.debugBossEncounter(),
  emberInfo: () => game.debugEmberInfo(),
  setEmbers: (n) => game.debugSetEmbers(n),
  economy: () => game.debugEconomy(),
  weaponUpgradeInfo: () => game.debugWeaponUpgradeInfo(),
  /**
   * 🌀 **지금 무기 축이 놓인 각도**(라디안). `y` 가 좌우, `x` 가 위아래입니다.
   * 콤보 단마다 궤적이 실제로 갈라지는지를 `npm run feel` 이 이걸로 봅니다.
   */
  swingPose: (entity: number) => game.debugSwingPose(entity),
  treasurePositions: () => game.debugTreasurePositions(),
  forceRespawnEnemies: () => game.debugForceRespawn(),
  setStones: (n) => {
    Player.stones[game.debugPlayerEntity()] = Math.max(0, n)
  },
  setWeaponLevel: (weapon, level) => {
    setWeaponLevel(game.debugPlayerEntity(), weapon, level)
    game.debugRefreshLoadout()
  },
  saveNow: () => game.debugPersist(),
  killAllEnemies: () => game.debugKillAll(),
  vialInfo: () => game.debugVialInfo(),
  playerEntity: () => game.debugPlayerEntity(),
  setHp: (entity, hp) => {
    if (!isAlive(entity)) return
    Health.max[entity] = Math.max(Health.max[entity], hp)
    Health.hp[entity] = hp
  },
  enemyCount: () => countLivingEnemies(),
  setVials: (n) => game.debugSetVials(n),
  teleportPlayer: (x, z) => game.debugTeleport(x, z),
  teleportEnemy: (entity, x, z) => game.debugTeleportEnemy(entity, x, z),
  faceSamples: () => game.debugFaceSamples(),
  groundSamples: () => game.debugGroundSamples(),
  screenPos: (x, y, z) => game.debugScreenPos(x, y, z),
  regionList: () => game.debugRegionList(),
  /**
   * 예고 4색의 RGB — 프로브가 색을 베껴 적지 않도록 게임이 내보냅니다.
   * (베껴 적으면 예고 색을 손보는 날 그 검사만 옛 색을 지킵니다.)
   */
  intentColors: () =>
    (Object.keys(INTENT_COLOR).map(Number) as (keyof typeof INTENT_COLOR)[]).map((k) => {
      const hex = INTENT_COLOR[k]
      return {
        color: INTENT_EMOJI[k],
        rgb: [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255] as [number, number, number],
      }
    }),
  nearestBonfire: () => game.debugNearestBonfire(),
  spendPoints: () => game.debugSpendPoints(),
  anvils: () => game.debugAnvils(),
  /** 💰 강화 곡선 — 상점 값이 이것을 그대로 쓰는지 프로브가 맞대 봅니다. */
  upgradeCosts: () => [...WEAPON_UPGRADE.costs],
  seenIntents: () => game.debugSeenIntents(),
  foeSwingLog: () => game.debugFoeSwingLog(),
  fallLog: () => game.debugFallLog(),
  upgradeTries: () => game.debugUpgradeTries(),
  /**
   * 처형 검증용.
   *
   * `ready` 는 **게임이 판단한 값**입니다. 프로브가 "무방비 + 2.6m 안" 을
   * 다시 계산하면 조건을 바꿨을 때 프로브만 옛 규칙으로 통과합니다.
   */
  finisherInfo: () => ({
    ready: finisherTarget(game.debugPlayerEntity()) >= 0,
    target: finisherTarget(game.debugPlayerEntity()),
    reach: FINISHER.reach,
    damageMultiplier: FINISHER.damageMultiplier,
    staminaCost: FINISHER.staminaCost,
    count: game.debugRunStats().finishers,
  }),
  /** 강인도를 즉시 부숩니다 — 무방비 상태를 만들어 놓고 재기 위한 훅. */
  breakEnemy: (entity: number) => {
    breakPoise(entity)
  },
  /**
   * 무기 3종의 제원 — **게임 데이터에서** 읽습니다.
   *
   * 프로브가 arsenal.ts 의 숫자를 베껴 적으면, 무기를 손보는 순간
   * "무기가 서로 다른가"라는 검증이 조용히 옛 무기를 재게 됩니다.
   */
  /**
   * 무기별 구르기 — **거리·시간·값**을 한 줄로.
   *
   * 프로브가 arsenal.ts 를 읽어 계산하지 않게 게임이 내줍니다. 특히 거리는
   * `rules` 의 "🟡 반경 > 구르기" 약속이 걸린 값이라, 여기서 나오는 숫자가
   * 곧 그 검사의 근거가 됩니다.
   */
  /** 이번 판에 덮어쓴 설정 — 보고서가 "무엇을 바꿔 돌렸나"를 적을 수 있게. */
  tweaks: () => appliedTweaks(),
  dodgeScales: () =>
    WEAPONS.map((w) => ({
      id: w.id,
      name: w.name,
      distance: PLAYER_CFG.dodge.distance,
      duration: Number((PLAYER_CFG.dodge.duration * (w.dodgeDurationScale ?? 1)).toFixed(3)),
      staminaCost: Number((PLAYER_CFG.dodge.staminaCost * (w.dodgeCostScale ?? 1)).toFixed(1)),
      iFrames: Number(
        (
          (PLAYER_CFG.dodge.iFrameEnd - PLAYER_CFG.dodge.iFrameStart) *
          (w.dodgeDurationScale ?? 1)
        ).toFixed(3),
      ),
      iFrameStart: Number(
        (PLAYER_CFG.dodge.iFrameStart * (w.dodgeDurationScale ?? 1)).toFixed(3),
      ),
    })),
  /** 🍶 회복 노림의 규칙값 — 프로브가 문턱을 베끼지 않게 게임이 알려 줍니다. */
  /** 🧭 지금 화면에 뜬 곁길 한 줄 — 규칙이 아니라 **도달한 것**을 봅니다. */
  /** 🧭 **지금 자리에서 안내가 무엇을 고를 것인가** — 타이머 없이 규칙만. */
  sideHintHere: () => game.debugSideHintAtHere(),
  sideHint: () => ({
    text: game.debugSideHintText(),
    at: game.debugSideHintAt(),
    range: NAV.sideHintRange,
    near: NAV.sideHintNear,
  }),
  punishHealInfo: () => ({ rangeMult: PUNISH_HEAL.rangeMult, cutTo: PUNISH_HEAL.cutTo }),
  weaponTable: () =>
    WEAPONS.map((w) => ({
      id: w.id,
      name: w.name,
      comboLength: w.combo.length,
      moveSpeedScale: w.moveSpeedScale,
      attackMoveScale: w.attackMoveScale,
      comboWindow: w.comboWindow,
      /** 콤보 한 바퀴의 합계 — 무기 성격이 가장 잘 드러나는 값들입니다. */
      comboDamage: w.combo.reduce((a, c) => a + c.damage, 0),
      comboStamina: w.combo.reduce((a, c) => a + c.staminaCost, 0),
      /**
       * 🛡 **방어와 공격의 값을 나란히** 내보냅니다.
       *
       * 소울류에서 뒤집힌 적 없는 부등호가 하나 있습니다 — **구르기가
       * 공격보다 싸다**(블러드본 퀵스텝 · 엘든 링 구르기 < 강공격 ·
       * 세키로는 회피에 자원 없음). 이 게임은 25 vs 롱소드 1·2타 21 로
       * **뒤집혀 있었고**, 벤치의 `locked:stamina` 60% 가 그 결과였습니다.
       *
       * ⚠️ 프로브가 배율을 다시 곱하지 않게 **여기서 곱해** 보냅니다.
       *    `dodgeCostScale` 을 프로브가 들고 있으면, 무기를 하나 더 넣는 날
       *    프로브만 옛 식을 씁니다.
       */
      firstTwoStamina: w.combo.slice(0, 2).reduce((a, c) => a + c.staminaCost, 0),
      /**
       * ⚔️ **상황 모션**의 제원 — 무기마다 따로 적지 않고 1타에서 파생된 값입니다
       * (arsenal.ts `runningStep`·`rollingStep`). 프로브가 배율을 다시 곱하지
       * 않게 **계산된 결과**를 그대로 내보냅니다.
       */
      moves: [runningStep(w), rollingStep(w)].map((c) => ({
        name: c.name,
        damage: Number(c.damage.toFixed(1)),
        range: Number(c.range.toFixed(2)),
        lunge: Number(c.lunge.toFixed(2)),
        windup: Number(c.windup.toFixed(3)),
        recovery: Number(c.recovery.toFixed(3)),
        staminaCost: c.staminaCost,
      })),
      /**
       * 🪂 **높이가 위력이 되는지**를 프로브가 곱셈 없이 볼 수 있게 두 벌 냅니다.
       *
       * 낙하 공격만 `steps` 를 인자로 받습니다 — 달리기·구르기는 상황이
       * 켜졌는가(예/아니오)뿐이지만, 낙하는 **얼마나 높았는가**가 남습니다.
       * 3단은 공짜 2단 바로 위(제일 싼 낙하), 5단은 체력 36%를 낸 낙하.
       * 둘의 피해가 같게 나오면 높이가 아무 의미도 없다는 뜻입니다.
       */
      plungeMoves: [3, 5].map((steps) => {
        const c = plungeStep(w, steps)
        return {
          steps,
          name: c.name,
          damage: Number(c.damage.toFixed(1)),
          trauma: Number(c.trauma.toFixed(2)),
          lunge: Number(c.lunge.toFixed(2)),
          staminaCost: c.staminaCost,
        }
      }),
      /**
       * ⚔️ **콤보 각 타의 제원** — "조리법 대 요리" 대조에 씁니다.
       *
       * 지금까지 무기표는 합계(`comboDamage`)와 마지막 타만 내보냈습니다.
       * 그러면 *"3타가 설계대로 들어가는가"* 를 물을 수가 없습니다. 이
       * 저장소가 두 번 데인 자리가 정확히 거기입니다 — 파생값은 완벽했고
       * 실제 타격은 다른 기술이었습니다.
       */
      comboSteps: w.combo.map((c) => ({
        name: c.name,
        damage: Number((c.damage * 1).toFixed(2)),
        staminaCost: c.staminaCost,
        /** 📏 이 타의 사거리(m). 판정은 여기에 **대상의 굵기**를 더합니다. */
        range: c.range,
        /**
         * ⚔️ 이 단계의 **손끝**(히트스톱)과 **눈**(궤적 무게).
         *
         * 콤보 단계마다 히트스톱이 다르다는 것은 설계에 적혀만 있었고,
         * 그게 실제로 손끝으로 구분될 만큼 벌어져 있는지는 아무도 안
         * 쟀습니다. 그리고 그 무게가 화면에도 실려 나가는지는 더더욱요.
         * 재려면 게임이 두 값을 같이 내야 합니다 — 프로브가 베껴 적으면
         * 값을 바꾸는 날 그 검사만 옛 숫자를 지킵니다.
         */
        hitstop: c.hitstop,
        power: Number(swingPower(w, c).toFixed(3)),
        /**
         * 📏 **화면에 실제로 그려지는 반지름**(m). 지금은 `range` 와 같지만,
         * 프로브가 그 사실을 **짐작하지 않도록** 게임이 답합니다
         * (적 예고의 `drawnReach` 와 같은 규약 — 그리는 규칙을 바꾸는 날
         * 검사가 저절로 따라옵니다).
         */
        drawnRange: Number(swingRadius(c).toFixed(3)),
        /** 📏 파고들기까지 더한 **상한**(m). 적응형이라 실제 이동은 이보다 짧습니다. */
        reachUpperBound: Number(swingRadiusUpperBound(c).toFixed(3)),
      })),
      /** 🥋 강타 — 태운 집중 0~3점 각각의 피해 */
      heavySteps: [0, 1, 2, 3].map((n) => ({
        spent: n,
        damage: Number(heavyStep(w, n).damage.toFixed(2)),
      })),
      /** 처형 — 무방비인 적에게만 나가는 한 방 */
      finisherDamage: Number(finisherStep(w).damage.toFixed(2)),
      firstWindup: w.combo[0].windup,
      firstLunge: w.combo[0].lunge,
      dodgeCost: PLAYER_CFG.dodge.staminaCost * (w.dodgeCostScale ?? 1),
      comboSeconds: Number(
        w.combo.reduce((a, c) => a + c.windup + c.active + c.recovery, 0).toFixed(3),
      ),
      comboTrauma: Number(w.combo.reduce((a, c) => a + c.trauma, 0).toFixed(3)),
      poiseScale: w.poiseScale,
      /** 마무리 타의 피해 — 처형(마무리 타 × 배율)을 계산하려면 필요합니다. */
      lastStepDamage: w.combo[w.combo.length - 1].damage,
      maxRange: Math.max(...w.combo.map((c) => c.range)),
      firstHitAt: w.combo[0].windup,
    })),
  /** 보스가 어떤 색을 몇 번 휘두르고 몇 번 맞혔는가 — 절정이 위험한지 재는 값. */
  bossSwingLog: () => game.debugBossSwingLog(),
  levelFoes: () => game.debugLevelFoes(),
  travelInfo: () => game.debugTravelInfo(),
  walls: () => game.debugWalls(),
  walkableFromPlayer: (x, z) => game.debugWalkableFromPlayer(x, z),
  barrelInfo: () => game.debugBarrelInfo(),
  gearInfo: () => game.debugGearInfo(),
  shopInfo: () => game.debugShopInfo(),
  buyShopItem: (i) => game.debugBuyShopItem(i),
  treasureRolls: () => game.debugTreasureRolls(),
  /** 🧪 실험대 전용 — 원하는 등급/시드를 무기에 끼웁니다(등급 비교를 세우려면 필요). */
  setGear: (weaponIndex, tier, seed) => game.debugSetGear(weaponIndex, tier, seed),
  spawnBarrel: (x, z) => game.debugSpawnBarrel(x, z),
  spawnUrn: (x, z, holds) => game.debugSpawnUrn(x, z, holds),
  urns: () => game.debugUrns(),
  shortcutInfo: () => game.debugShortcutInfo(),
  shortcutHint: () => game.debugShortcutHint(),
  walkTest: (fromX, fromZ, toX, toZ) => game.debugWalkTest(fromX, fromZ, toX, toZ),
  pathStep: (toX, toZ) => game.debugPathStep(toX, toZ),
  walkToPlayer: (x, z) => game.debugWalkToPlayer(x, z),
  pathWalk: (toX, toZ, starts, step, maxSteps) => game.debugPathWalk(toX, toZ, starts, step, maxSteps),
  routeTrail: (fromX, fromZ, toX, toZ) => game.debugRouteTrail(fromX, fromZ, toX, toZ),
  distancesToward: (toX, toZ, pts) => game.debugDistancesToward(toX, toZ, pts),
  terrainInfo: () => game.debugTerrainInfo(),
  /** 🗺 이 월드 좌표의 지형 단(段). 프로브가 낙차를 **찾아내는** 데 씁니다. */
  terrainLevelAt: (x, z) => game.debugTerrainLevelAt(x, z),
  regionAt: (x, z) => game.debugRegionAt(x, z),
  entityState: (e) => game.debugEntityState(e),
  teleportEntity: (e, x, z) => {
    if (!isAlive(e)) return
    Transform.x[e] = x
    Transform.z[e] = z
  },
  /**
   * 넉백을 그대로 흉내 냅니다 — 낙하 검증은 **밀려서 떨어지는 것**을 재야
   * 하므로, 좌표를 옮겨 놓는 것으로는 검증이 되지 않습니다(순간이동은
   * 물리를 거치지 않아 낙하로 잡히지 않습니다).
   */
  pushEntity: (e, vx, vz) => {
    if (!isAlive(e)) return
    Velocity.kx[e] += vx
    Velocity.kz[e] += vz
  },
  runStats: () => game.debugRunStats(),
  saveInfo: () => game.debugSaveInfo(),
  resetProgress: () => game.resetProgress(),
  audio: {
    unlock: () => sfx.unlock(),
    state: () => sfx.debugState(),
    level: () => sfx.debugLevel(),
    music: () => sfx.debugMusic(),
    cue: (name, a = 0, b = 0) => {
      switch (name) {
        case 'swing':
          sfx.swing(a)
          break
        case 'impact':
          sfx.impact(a > 0, b > 0)
          break
        case 'telegraph': {
          // 예고음은 **위치가 있는 소리**입니다. 원점에서 울리면 플레이어가
          // 레벨 어디에 서 있느냐에 따라 거리 감쇠로 지워집니다.
          // b = 플레이어로부터의 거리(m).
          const at = sfx.debugListener()
          sfx.telegraph(a, at.x + b, at.z)
          break
        }
        case 'nowBeat': {
          // ⏱ 「지금」 박자도 **위치가 있는 소리**입니다(예고음과 같은 규칙).
          const at = sfx.debugListener()
          sfx.nowBeat(at.x + b, at.z)
          break
        }
        case 'dodge':
          sfx.dodge()
          break
        case 'hurt':
          sfx.hurt()
          break
        case 'death':
          sfx.death(a > 0)
          break
        case 'cast':
          sfx.cast(a)
          break
        case 'pickup':
          sfx.pickup()
          break
        case 'deny':
          sfx.deny()
          break
      }
    },
  },
}
