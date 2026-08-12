import * as THREE from 'three'
import { appliedTweaks, assertAllTweaksApplied } from './config/tweak'
import { RUNE_ORDER, SKILLS, WEAPONS } from './config/arsenal'
import {
  BOSS_ARENA,
  COMBAT,
  COUNTER,
  CAMERA,
  BONFIRE,
  EMBER,
  FALL,
  FINISHER,
  FOCUS,
  KILL_FEEDBACK,
  LADDER_REACH,
  LEVEL_AGGRO_LEAD,
  LEVEL_AGGRO_MAX,
  LEVEL_AGGRO_RANGE,
  PLAYER as PLAYER_CFG,
  POISE,
  reactionTime,
  TREASURE,
  VIAL,
  WEAPON_UPGRADE,
  WORLD,
} from './config/balance'
import {
  INTENT_COLOR,
  INTENT_EMOJI,
  INTENT_LABEL,
  SNARE_MOVE_SCALE,
  attackAt,
  attacksFor,
} from './config/enemyAttacks'
import { BOSS_PHASES, NO_CHAIN } from './config/bossPhases'
import { ENEMY_DEFS, enemyDef, kindFromId } from './config/enemies'
import {
  Actor,
  ActorState,
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
  Velocity,
} from './core/components'
import { AttackPhase } from './core/components'
import { defineQuery, destroyEntity, hasComponent, isAlive, resetWorld } from './core/ecs'
import { sfx } from './core/audio'
import { consumePress, debugInput, endFrame, initInput, mouse, wasPressed } from './core/input'
import { requestHitstop, resetTime, tick, time } from './core/time'
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
import { KIND_TREASURE, Visuals } from './render/visuals'
import {
  breakEvents,
  breakPoise,
  finisherEvents,
  counterEvents,
  countLivingEnemies,
  perfectDodgeEvents,
  hitEvents,
  isBackAttack,
  isBehindPoint,
  resolveAttacks,
} from './systems/combat'
import {
  chainIndexFor,
  encounterEvents,
  enemyAiSystem,
  readChainsArmed,
  resetChainLedger,
  readChainsDropped,
  countChainsPending,
  readGreenOutcome,
  resetGreenOutcome,
  readChainsLost,
  setAggroRangeOverride,
  setReachDistance,
  phaseEvents,
  resetAttackTokens,
  setEnemyAiEnabled,
} from './systems/enemyAI'
import { bonfireSystem, setBonfireReach, type Bonfire } from './systems/bonfire'
import { deathEvents, healthSystem } from './systems/health'
import {
  SLOT_COUNT,
  cooldownOf,
  grantRune,
  setCooldown,
  setWeaponLevel,
  skillForSlot,
  weaponLevel,
  weaponOf,
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
  readLearnedActions,
  readRhythm,
  readStaminaSpent,
  resetStaminaSpent,
  type ControlContext,
} from './systems/playerControl'
import {
  bossKey,
  enemyCountForWave,
  respawnLevelEnemies,
  spawnEnemy,
  spawnFromLevel,
  spawnGrunt,
  spawnPlayer,
  spawnWave,
} from './systems/world'
import { Hud } from './ui/hud'
import { SkillBar } from './ui/skillbar'
import { TripodPanel } from './ui/tripodPanel'

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
  /** 매 프레임 배열을 새로 만들지 않도록 재사용합니다. */
  private readonly cdBuf = new Array<number>(SLOT_COUNT).fill(0)
  private readonly cdMaxBuf = new Array<number>(SLOT_COUNT).fill(1)

  private playerEntity = -1
  private wave = 1
  private kills = 0
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
  private treasureTotal = 0
  private treasuresFound = 0
  private regions: LevelRegion[] = []
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
      free: number
      /** 손이 묶여 있던 **이유별** 시간. 처방이 갈리므로 칸을 나눕니다. */
      blocked: Record<string, number>
    }
  >()
  private hurtLedger: {
    attackId: string
    intent: number
    /** 실제로 보여준 예고 시간(초) */
    telegraph: number
    /** 그중 때린 쪽이 **화면 안에** 있던 시간 */
    seen: number
    /** 그중 플레이어가 **답할 수 있던**(구르기를 시작할 수 있던) 시간 */
    free: number
    damage: number
    /** fair · unseen · locked · tooFast · unknown */
    verdict: string
  }[] = []
  private bonfires: Bonfire[] = []
  /** 모루 — 불티·정련석을 쓰는 곳. 부활도 회복도 아닙니다(world.ts 설계 노트). */
  private anvils: { x: number; y: number; z: number }[] = []
  private ladderVisuals: { setOpen: (open: boolean) => void }[] = []
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
      onSwing: (x, z, rotY, range, arcDeg) => this.vfx.spawnSwing(x, z, rotY, range, arcDeg),
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
    this.defeatedBosses = new Set()
    this.bonfires = []
    this.anvils = []
    this.levelData = null

    if (this.terrain) {
      this.scene.remove(this.terrain.group)
      this.terrain.dispose()
      this.terrain = null
      setTerrain(null)
    }

    this.kills = 0
    this.waveTimer = 0
    this.gameOver = false
    this.bossDefeated = false
    this.treasuresFound = 0
    this.treasureTotal = 0
    this.hitsDealt = 0
    this.damageDealt = 0
    this.backHits = 0
    this.critHits = 0
    this.hud.hideBanner()
    this.saveId = ''
    this.takenTreasures = new Set()
    resetTripods()
    this.tripodPanel.setOpen(false)
    setEnemyAiEnabled(true)
    // 아레나는 종류별 기본값(55m)을 그대로 씁니다 — 좁히면 반경 21m에 소환된
    // 적이 영원히 제자리에 섭니다. 레벨을 실제로 불러온 뒤에 방 단위로 덮습니다.
    setAggroRangeOverride(0)
    // 아레나에는 지형이 없으므로 직선거리로 되돌립니다.
    setReachDistance(null)
    setBonfireReach(null)
    resetAttackTokens()
    resetChainLedger()  // 장부는 **판 시작에만** 지웁니다(enemyAI 설계 노트)
    // 눈금도 같이 비웁니다 — 안 그러면 앞 판의 초록이 이번 판에 섞입니다
    // (조합 프로브가 '앞 검사가 깨워 놓은 적'을 세던 것과 같은 실수).
    resetGreenOutcome()
    resetStaminaSpent()
    // 🩸 피격 장부도 **판 시작에만** 지웁니다(연계 장부에서 배운 것 — 화톳불마다
    //    지우면 예약과 발동의 수명이 달라져 서로 비교할 수 없게 됩니다).
    this.hurtLedger = []
    this.hurtWatch.clear()
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
      this.levelW = level.w
      this.levelH = level.h
      this.terrain = new Terrain(level)
      this.scene.add(this.terrain.group)
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
      this.ladderVisuals = this.terrain.shortcuts.map((s) => this.visuals.addLadder(s))
      this.playerEntity = spawned.player
      this.visuals.attach(this.playerEntity, Renderable.kind[this.playerEntity])
      for (const e of spawned.entities) this.visuals.attach(e, Renderable.kind[e])
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
        this.defeatedBosses = new Set(save.bosses)
        // 내려둔 사다리는 남습니다. **지름길은 지식의 보상**이라, 게임을 껐다
        // 켰다고 다시 걷히면 알아낸 것을 빼앗는 셈이 됩니다.
        this.terrain.applyOpenShortcuts(save.ladders)
        this.syncLadderVisuals()
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
    this.skillBar.setLoadout(lv > 0 ? `${weaponOf(p).name} +${lv}` : weaponOf(p).name, slots)
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

    // ---- 2. 시뮬레이션 ----
    /**
     * **플레이어까지의 거리장을 먼저 만듭니다.**
     * 어그로와 화톳불 차단이 이 값을 씁니다(직선거리가 아니라 걷는 거리).
     * 플레이어가 격자 칸을 옮길 때만 다시 계산합니다 — 대부분의 프레임은 캐시입니다.
     */
    this.terrain?.buildPlayerField(Transform.x[p], Transform.z[p])
    if (playerAlive) playerControlSystem(this.controlCtx)
    enemyAiSystem(p, playerAlive, this.controlCtx)
    physicsSystem()
    // 🩸 예고 중에 모읍니다 — 맞고 나서 되짚으면 화면도 상태도 이미 바뀝니다.
    this.watchTelegraphs(p)
    resolveAttacks()

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
          0.6 + Math.random() * 1.8,
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
    if (playerAlive) {
      for (const a of this.anvils) {
        if (Math.hypot(a.x - Transform.x[p], a.z - Transform.z[p]) <= BONFIRE.radius) {
          nearAnvil = true
          break
        }
      }
    }

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
      this.tryUpgrade(p, this.canSpendHere)
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
        const intent = attackAt(Enemy.kind[e], Enemy.attackIndex[e]).intent
        if (this.seenIntents.has(intent)) continue
        this.seenIntents.add(intent)
        this.hud.showColorHint(INTENT_LABEL[intent], INTENT_COLOR[intent])
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
      Health.flashT[f.entity] = 0.12
      this.vfx.spawnDamage(f.x, f.y + 1.3, f.z, Math.round(dmg))
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        this.vfx.spawnHitSpark(f.x + Math.cos(a) * 0.7, f.y + 0.15, f.z + Math.sin(a) * 0.7, 0.9)
      }
      sfx.impact(true, false, f.x, f.z)
      if (f.entity === p) {
        // 플레이어는 강인도가 없어 늘 비틀거립니다. 착지도 같은 규칙을 씁니다.
        Actor.state[p] = ActorState.Stagger
        Actor.timer[p] = PLAYER_CFG.hurtStagger
        this.cam.addTrauma(FALL.trauma)
        requestHitstop(FALL.hitstop)
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
      Player.focus[p] = Math.min(FOCUS.max, Player.focus[p] + FOCUS.perPerfectDodge)
      Player.perfectCritT[p] = FOCUS.perfectDodgeCritWindow
      this.cam.addTrauma(0.18)
      sfx.pickup()
      this.vfx.spawnHitSpark(d.x, d.y + 1.1, d.z, 1.1)
      this.hud.showBanner('완벽 회피', '집중 +1 · 다음 일격 확정 치명타', 0.9)
    }
    perfectDodgeEvents.length = 0

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
        this.hud.showGameOver(this.kills, this.wave)
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
            death.x + (Math.random() - 0.5) * 0.9,
            Transform.y[death.entity] + 0.5 + Math.random() * 1.1,
            death.z + (Math.random() - 0.5) * 0.9,
            0.8 + Math.random() * 0.7,
          )
        }
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

    this.visuals.sync(px, pz)
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
    this.hud.setLowHp(
      Health.hp[p] / Math.max(1, Health.max[p]),
      0.5 + 0.5 * Math.sin(time.elapsed * 6.5),
    )
    if (this.levelMode) {
      this.hud.setLevelProgress(this.levelName, enemiesLeft, this.treasuresFound, this.treasureTotal)
    } else {
      this.hud.setProgress(this.wave, enemiesLeft, this.kills)
    }
    this.cdBuf[0] = Loadout.cd0[p]
    this.cdBuf[1] = Loadout.cd1[p]
    this.cdBuf[2] = Loadout.cd2[p]
    this.cdBuf[3] = Loadout.cd3[p]
    this.cdBuf[4] = Loadout.cd4[p]
    for (let i = 0; i < SLOT_COUNT; i++) this.cdMaxBuf[i] = skillForSlot(p, i)?.cooldown ?? 1
    this.skillBar.update(this.cdBuf, this.cdMaxBuf)
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

    this.hud.setNavigation(
      this.currentRegion,
      objective ? `목표: ${objective.label} (${shownDist.toFixed(0)}m)` : '목표: 완료',
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
      return { ...boss, label: '수문장 처치', dist: Math.hypot(boss.x - px, boss.z - pz) }
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
      this.takenTreasures.add(treasureKey(Transform.x[e], Transform.z[e]))
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
      this.visuals.detach(e)
      destroyEntity(e)
      // 진행이 실제로 바뀐 순간에만 저장합니다. 매 프레임 쓰면 낭비이고,
      // 종료 시점에만 쓰면 브라우저를 그냥 닫는 흔한 경우에 통째로 날아갑니다.
      this.persist()
    }
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

  private removeTakenTreasures(): void {
    const ids = pickups.run()
    // 순회 중에 엔티티를 지우므로 먼저 모아 둡니다.
    const doomed: number[] = []
    for (let i = 0; i < pickups.count; i++) {
      const e = ids[i]
      if (this.takenTreasures.has(treasureKey(Transform.x[e], Transform.z[e]))) doomed.push(e)
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
  debugSetPaused(paused: boolean): void {
    this.paused = paused
  }

  debugSwingVisible(): boolean {
    return this.vfx.hasActiveSwing()
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
  debugSpawnTestEnemy(x: number, z: number, rotY?: number): number {
    const e = spawnGrunt(x, z)
    // 바라보는 방향을 지정할 수 있어야 백어택 같은 방향 판정을 검증할 수 있습니다.
    if (rotY !== undefined) Transform.rotY[e] = rotY
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
  debugForceAttack(entity: number, index: number): string {
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
    Actor.timer[entity] = list[i].windup * 0.25
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

  private syncLadderVisuals(): void {
    if (!this.terrain) return
    for (let i = 0; i < this.ladderVisuals.length; i++) {
      const s = this.terrain.shortcuts[i]
      if (s) this.ladderVisuals[i].setOpen(s.open)
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
      for (const e of doomed) {
        this.visuals.detach(e)
        destroyEntity(e)
      }
      const fresh = respawnLevelEnemies(this.levelData, this.terrain, this.defeatedBosses)
      for (const e of fresh) this.visuals.attach(e, Renderable.kind[e])
      revived = fresh.length
      resetAttackTokens()
    }
    this.hud.showBanner('다시 일어섰다', `화톳불에서 부활 · 적 ${revived}마리 부활`, 2.2)
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
    const ids = enemyQuery.run()
    const live = new Set<number>()
    for (let i = 0; i < enemyQuery.count; i++) {
      const e = ids[i]
      live.add(e)
      const winding =
        Actor.state[e] === ActorState.Attack && Actor.phase[e] === AttackPhase.Windup
      if (!winding) continue
      const id = attackAt(Enemy.kind[e], Enemy.attackIndex[e]).id
      let rec = this.hurtWatch.get(e)
      /**
       * 패턴이 바뀌면 **새 예고**입니다. 같은 적이 연달아 휘두를 때 앞
       * 예고의 시간이 뒤로 넘어가면, 없던 여유를 있는 것처럼 적게 됩니다.
       */
      if (!rec || rec.id !== id) {
        rec = {
          id,
          intent: attackAt(Enemy.kind[e], Enemy.attackIndex[e]).intent,
          start: time.simElapsed,
          seen: 0,
          free: 0,
          blocked: {},
        }
        this.hurtWatch.set(e, rec)
      }
      if (this.onScreen(e)) rec.seen += dt
      const why = this.answerBlock(p)
      if (why === '') rec.free += dt
      else rec.blocked[why] = (rec.blocked[why] ?? 0) + dt
    }
    // 죽거나 사라진 적의 기록은 버립니다 — 엔티티 번호는 재사용됩니다.
    for (const e of [...this.hurtWatch.keys()]) if (!live.has(e)) this.hurtWatch.delete(e)
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
   * ⚠️ 값을 새로 정하지 않고 playerControl 이 실제로 쓰는 조건을 그대로
   *    옮겨 적습니다 — 경직·사망·마시는 중이 아니고, 쿨다운이 없고, 기력이
   *    충분할 것. 휘두르는 중(예고·판정)에는 **취소 추가분**까지 있어야
   *    하는 것도 같습니다(playerControl `cancelCost`).
   */
  private answerBlock(p: number): string {
    const st = Actor.state[p]
    /**
     * ⚠️ **순서가 곧 처방입니다.** "손이 묶였다"를 한 칸으로 두면
     *    39%가 나와도 어디를 고쳐야 할지 모릅니다 — 내가 기력을 다 쓴 것과
     *    맞아서 굳은 것은 **책임이 반대**입니다. 앞의 것은 소울류가 말하는
     *    정당한 대가이고, 뒤의 것은 *"한 대 맞으면 다음 대도 맞는"* 연쇄로
     *    소울류에서 가장 미움받는 모양입니다.
     */
    if (st === ActorState.Dead) return 'dead'
    if (st === ActorState.Stagger) return 'stagger'
    if (st === ActorState.Drink) return 'drink'
    if (Player.dodgeCooldownT[p] > 0) return 'cooldown'
    const swinging =
      (st === ActorState.Attack || st === ActorState.Skill) &&
      Actor.phase[p] !== AttackPhase.Recovery
    const cost =
      PLAYER_CFG.dodge.staminaCost * (weaponOf(p).dodgeCostScale ?? 1) +
      (swinging ? PLAYER_CFG.dodge.cancelExtraCost : 0)
    if (Stamina.value[p] < cost) return 'stamina'
    return ''
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
        free: 0,
        damage,
        verdict: 'unknown',
      })
      return
    }
    const telegraph = time.simElapsed - rec.start
    // 묶여 있던 이유 중 **가장 오래 묶은 것**을 붙입니다.
    const worst = Object.entries(rec.blocked).sort((x, y) => y[1] - x[1])[0]
    const verdict =
      telegraph < budget
        ? 'tooFast'
        : rec.seen < budget
          ? 'unseen'
          : rec.free < budget
            ? `locked:${worst ? worst[0] : '?'}`
            : 'fair'
    this.hurtLedger.push({
      attackId: rec.id,
      intent: rec.intent,
      telegraph: Number(telegraph.toFixed(3)),
      seen: Number(rec.seen.toFixed(3)),
      free: Number(rec.free.toFixed(3)),
      damage,
      verdict,
    })
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
    return this.terrain.shortcuts.map((s) => {
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
  debugPathStep(toX: number, toZ: number): { x: number; z: number; dist: number } | null {
    if (!this.terrain) return null
    const p = this.playerEntity
    this.terrain.buildFlowField(toX, toZ)
    const step = this.terrain.nextStepToward(Transform.x[p], Transform.z[p])
    const dist = this.terrain.pathDistance(Transform.x[p], Transform.z[p])
    if (!step) return dist === 0 ? { x: toX, z: toZ, dist: 0 } : null
    return { x: step.x, z: step.z, dist: dist ?? 0 }
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

  debugTerrainInfo(): {
    maxClimb: number
    heightStep: number
    cellSize: number
    fallFreeSteps: number
    fallDamagePerStep: number
    /** 존에서 적이 깨어나는 거리(m) — 프로브가 상수를 베끼지 않게. */
    levelAggroRange: number
    /** 달리기 배율 · 공격 템포 배율 — 프로브가 상수를 베끼지 않게. */
    sprintScale: number
    /** 달릴 때 시야가 넓어지는 배율 · 기본 시야(m) · 지금 카메라 줌. */
    sprintViewScale: number
    cameraViewSize: number
    cameraZoom: number
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
    dodgeStaminaCost: number
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
  } {
    return {
      maxClimb: MAX_CLIMB,
      heightStep: HEIGHT_STEP,
      cellSize: CELL_SIZE,
      fallFreeSteps: FALL.freeSteps,
      fallDamagePerStep: FALL.damagePerStep,
      levelAggroRange: LEVEL_AGGRO_RANGE,
      sprintScale: PLAYER_CFG.sprint.speedScale,
      sprintViewScale: CAMERA.sprintViewScale,
      cameraViewSize: CAMERA.viewSize,
      cameraZoom: this.cam.currentZoom(),
      attackTempo: PLAYER_CFG.tempo.attackScale,
      inputBuffer: PLAYER_CFG.tempo.inputBuffer,
      dodgeDuration: PLAYER_CFG.dodge.duration,
      dodgeCooldown: PLAYER_CFG.dodge.cooldown,
      dodgeDistance: PLAYER_CFG.dodge.distance,
      dodgeStaminaCost: PLAYER_CFG.dodge.staminaCost,
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

  debugTreasurePositions(): { x: number; z: number; taken: boolean }[] {
    const ids = pickups.run()
    const out: { x: number; z: number; taken: boolean }[] = []
    for (let i = 0; i < pickups.count; i++) {
      const e = ids[i]
      out.push({
        x: Number(Transform.x[e].toFixed(2)),
        z: Number(Transform.z[e].toFixed(2)),
        taken: Pickup.taken[e] === 1,
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
    bossFinishers: number
    /** 연계가 예약된 횟수 — 실제 발동 수와 비교해 "안 나온다"의 원인을 가릅니다. */
    chainsArmed: number
    /** 예약된 연계가 무너짐으로 끊긴 횟수 — `[예고, 휘두름, 후딜]` 박자별 */
    chainsLost: [number, number, number]
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
    /** 이어짐 눈금 — 선입력이 실제로 일했는가 (playerControl.ts readInputFlow) */
    inputUsed: number
    inputExpired: number
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
      bossFinishers: this.bossFinishers,
      chainsArmed: readChainsArmed(),
      chainsDropped: readChainsDropped(),
      chainsPending: countChainsPending(),
      chainsLost: readChainsLost(),
      dodgeStamina: PLAYER_CFG.dodge.staminaCost,
      staminaSpent: Number(readStaminaSpent().toFixed(1)),
      skillCasts: readRhythm().skillCasts,
      lightSwings: readRhythm().lightSwings,
      inputUsed: readInputFlow().used,
      inputExpired: readInputFlow().expired,
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

  debugSpawnKind(id: string, x: number, z: number): number {
    const kind = kindFromId(id)
    if (kind === null) return -1
    const e = spawnEnemy(kind, x, z)
    if (this.terrain) Transform.y[e] = this.terrain.groundYAt(x, z)
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
  debugThreats(range = 14): {
    entity: number
    x: number
    z: number
    dist: number
    /** AttackIntent. -1 = 공격 중이 아님 */
    intent: number
    aggro: boolean
    winding: boolean
    /** 내가 이 적의 정면에 있는가 (반격 가능 방향) */
    inFront: boolean
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
        x: Number(Transform.x[e].toFixed(2)),
        z: Number(Transform.z[e].toFixed(2)),
        dist: Number(d.toFixed(2)),
        intent: attacking ? attackAt(Enemy.kind[e], Enemy.attackIndex[e]).intent : -1,
        /** 나를 쫓고 있는가 — "몇 마리를 동시에 상대하는가"를 재려면 필요합니다. */
        aggro: Enemy.aggro[e] === 1,
        winding: attacking && Actor.phase[e] === AttackPhase.Windup,
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
    const keys = ['KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyG']
    const cds = [Loadout.cd0[p], Loadout.cd1[p], Loadout.cd2[p], Loadout.cd3[p], Loadout.cd4[p]]
    return keys.map((key, slot) => ({
      slot,
      key,
      cd: Number(cds[slot].toFixed(2)),
      empty: skillForSlot(p, slot) === null,
    }))
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
        cooldowns: [
          Number(Loadout.cd0[p].toFixed(2)),
          Number(Loadout.cd1[p].toFixed(2)),
          Number(Loadout.cd2[p].toFixed(2)),
          Number(Loadout.cd3[p].toFixed(2)),
          Number(Loadout.cd4[p].toFixed(2)),
        ],
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
      testBehind: (ax: number, az: number, tx: number, tz: number, trot: number) => boolean
      /** 검증 스크립트가 수치를 하드코딩하지 않도록 튜닝 상수를 그대로 내보냅니다. */
      tuning: () => { backArcDeg: number }
      /** 화면을 그 프레임에 멈춰 세웁니다(스크린샷용). */
      setPaused: (paused: boolean) => void
      /** 지금 검격 궤적이 떠 있는가 — 캡처 타이밍을 페이지 안에서 잡기 위한 것. */
      swingVisible: () => boolean
      spawnTestEnemy: (x: number, z: number, rotY?: number) => number
      freezeEnemies: (frozen: boolean) => void
      spawnVfx: (kind: 'spark' | 'damage' | 'swing') => void
      /** 적을 특정 공격 패턴의 예고 상태로 세워 둡니다(4색 확인용). */
      forceAttack: (entity: number, index: number) => string
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
        windups: { id: string; seconds: number }[]
        chains: Record<string, string>
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
        attackCycle: number
        attacks: {
          id: string
          intent: number
          color: string
          reach: number
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
        }[]
      }[]
      /** 지금 레벨에 배치된 적 종류별 마릿수. */
      levelRoster: () => Record<string, number>
      /** 종류를 id 문자열로 지정해 소환합니다. */
      spawnEnemyKind: (id: string, x: number, z: number) => number
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
        brokenT: number
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
      } | null
      /**
       * 자동 플레이 봇용 훅.
       *
       * WASD는 **카메라 기준**이라 월드 방향을 그대로 못 씁니다
       * (쿼터뷰 45°에서 월드 +X로 가려면 화면상 오른쪽 아래로 가야 합니다).
       * 봇이 축을 직접 계산하면 카메라 각도를 바꿀 때 봇이 조용히 틀립니다.
       */
      /** 🟢 반격 검증용 */
      counterInfo: () => { brokenTime: number; normalBrokenTime: number; damageMultiplier: number }
      /**
       * 사람이 반응하는 데 걸리는 시간 예산 — 프로브가 **읽습니다**(balance.ts REACTION).
       * 색 가짓수는 게임이 **자기 데이터에서 세어** 넘깁니다.
       */
      reactionBudget: () => {
        simple: number
        choice: number
        colors: { intent: number; emoji: string; label: string }[]
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
      grantPerfectDodge: () => void
      /** 주변 적의 위협 상태 — 봇이 색과 방향을 읽습니다. */
      threats: (range?: number) => {
        entity: number
        x: number
        z: number
        dist: number
        intent: number
        aggro: boolean
        winding: boolean
        inFront: boolean
        hp: number
      }[]
      slotCooldowns: () => { slot: number; key: string; cd: number; empty: boolean }[]
      cameraAxes: () => { forwardX: number; forwardZ: number; rightX: number; rightZ: number }
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
      } | null
      /** 불티 검증용 */
      emberInfo: () => {
        embers: number
        vialsMax: number
        drop: { x: number; z: number; amount: number } | null
        upgradeCost: number
      }
      setEmbers: (n: number) => void
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
      }
      setStones: (n: number) => void
      treasurePositions: () => { x: number; z: number; taken: boolean }[]
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
      distancesToward: (
        toX: number,
        toZ: number,
        pts: { x: number; z: number }[],
      ) => { player: number; points: number[] } | null
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
        attackTempo: number
        /** 선입력 창(초) — 템포 프로브가 0.55 를 베껴 적지 않게 */
        inputBuffer: number
        dodgeDuration: number
        dodgeCooldown: number
        dodgeDistance: number
        dodgeStaminaCost: number
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
        bossFinishers: number
        chainsArmed: number
        chainsLost: [number, number, number]
        dodgeStamina: number
        staminaSpent: number
        skillCasts: number[]
        lightSwings: number
        inputUsed: number
        inputExpired: number
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
  // 등 뒤 판정은 순수 기하 계산이라 엔티티 없이 그대로 검증할 수 있습니다.
  testBehind: (ax, az, tx, tz, trot) => isBehindPoint(ax, az, tx, tz, trot),
  tuning: () => ({ backArcDeg: COMBAT.backArcDeg }),
  setPaused: (paused) => game.debugSetPaused(paused),
  swingVisible: () => game.debugSwingVisible(),
  spawnTestEnemy: (x, z, rotY) => game.debugSpawnTestEnemy(x, z, rotY),
  freezeEnemies: (frozen) => setEnemyAiEnabled(!frozen),
  spawnVfx: (kind) => game.debugSpawnVfx(kind),
  forceAttack: (entity, index) => game.debugForceAttack(entity, index),
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
        /**
         * **사거리 밖에서 실제로 내는 속도.** 프로브가 `moveSpeed`만 보고
         * "가장 빠른 적"을 고르면 추격전에서는 틀린 답이 나옵니다 —
         * 이 게임에서 도망을 따라잡는 건 전투 속도가 아니라 접근 속도입니다.
         */
        approachSpeed: d.moveSpeed * (d.approachSpeedScale ?? 1),
        attackRange: d.attackRange,
        keepDistance: d.keepDistance,
        /**
         * **한 번 공격하는 데 걸리는 전체 시간**(초). 프로브가 네 값을
         * 따로 받아 더하다가 하나를 빠뜨리는 일이 없도록 여기서 냅니다.
         */
        attackCycle: d.attackCooldown + d.windup + d.active + d.recovery,
        attacks: attacksFor(k).map((a) => ({
          id: a.id,
          intent: a.intent as number,
          color: INTENT_EMOJI[a.intent],
          /** 실제로 때리는 거리. 어그로 여유를 이 값으로 잽니다(attackRange 아님). */
          reach: a.reach,
          /** 예고 중 돌진 속도(m/s). 0이면 제자리에서 휘두릅니다. */
          lungeSpeed: a.lungeSpeed ?? 0,
          windup: a.windup,
          arcDeg: a.arcDeg,
          active: a.active,
          recovery: a.recovery,
          snare: a.snare ?? 0,
          minRange: a.minRange,
          maxRange: a.maxRange,
        })),
      }
    }),
  levelRoster: () => game.debugLevelRoster(),
  spawnEnemyKind: (id, x, z) => game.debugSpawnKind(id, x, z),
  bossTuning: () =>
    BOSS_PHASES.map((ph) => ({
      name: ph.name,
      enterBelow: ph.enterBelow,
      cooldownScale: ph.cooldownScale,
      windups: attacksFor(EnemyKind.Boss).map((a) => ({ id: a.id, seconds: a.windup * ph.windupScale })),
      /**
       * 이 페이즈의 **연계 표** — 프로브가 기대값을 베껴 적지 않도록 그대로 내보냅니다.
       * (연계를 바꿨는데 검증만 옛 표로 통과하는 일을 막습니다.)
       */
      chains: ph.chains ?? {},
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
      windup: attackAt(kind, Enemy.attackIndex[entity]).windup,
      brokenT: Number(Enemy.brokenT[entity].toFixed(2)),
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
      poiseMax: enemyDef(Enemy.kind[entity]).poiseMax,
      attackId: attackAt(kind, Enemy.attackIndex[entity]).id,
      attackPhase: Actor.phase[entity],
      chainNext: chain === NO_CHAIN ? '' : (list[chain]?.id ?? ''),
      cooldownT: Number(Actor.cooldownT[entity].toFixed(3)),
      /** 등 뒤를 잡혔을 때 "아직 못 알아챈" 남은 시간(초). 백어택 여유의 실체입니다. */
      reactT: Number(Enemy.reactT[entity].toFixed(3)),
      aggro: Enemy.aggro[entity] === 1,
    }
  },
  counterInfo: () => ({
    brokenTime: COUNTER.brokenTime,
    normalBrokenTime: POISE.brokenTime,
    damageMultiplier: COUNTER.damageMultiplier,
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
    const seen = new Map<number, { intent: number; emoji: string; label: string }>()
    for (const key of Object.keys(ENEMY_DEFS)) {
      for (const a of attacksFor(Number(key) as EnemyKind)) {
        if (!seen.has(a.intent)) {
          seen.set(a.intent, {
            intent: a.intent,
            emoji: INTENT_EMOJI[a.intent],
            label: INTENT_LABEL[a.intent],
          })
        }
      }
    }
    const colors = [...seen.values()].sort((x, y) => x.intent - y.intent)
    return {
      simple: Number(reactionTime(1).toFixed(3)),
      choice: Number(reactionTime(colors.length).toFixed(3)),
      colors,
    }
  },
  counterCount: () => game.debugCounterCount(),
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
  grantPerfectDodge: () => {
    Player.perfectCritT[game.debugPlayerEntity()] = FOCUS.perfectDodgeCritWindow
  },
  threats: (range) => game.debugThreats(range),
  slotCooldowns: () => game.debugSlotCooldowns(),
  cameraAxes: () => game.debugCameraAxes(),
  objective: () => game.debugObjective(),
  bossEncounter: () => game.debugBossEncounter(),
  emberInfo: () => game.debugEmberInfo(),
  setEmbers: (n) => game.debugSetEmbers(n),
  weaponUpgradeInfo: () => game.debugWeaponUpgradeInfo(),
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
  shortcutInfo: () => game.debugShortcutInfo(),
  shortcutHint: () => game.debugShortcutHint(),
  walkTest: (fromX, fromZ, toX, toZ) => game.debugWalkTest(fromX, fromZ, toX, toZ),
  pathStep: (toX, toZ) => game.debugPathStep(toX, toZ),
  distancesToward: (toX, toZ, pts) => game.debugDistancesToward(toX, toZ, pts),
  terrainInfo: () => game.debugTerrainInfo(),
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
