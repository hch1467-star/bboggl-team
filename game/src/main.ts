import * as THREE from 'three'
import { RUNE_ORDER, SKILLS } from './config/arsenal'
import {
  BOSS_ARENA,
  COMBAT,
  COUNTER,
  EMBER,
  FALL,
  KILL_FEEDBACK,
  LADDER_REACH,
  PLAYER as PLAYER_CFG,
  POISE,
  TREASURE,
  VIAL,
  WORLD,
} from './config/balance'
import { attackAt, attacksFor } from './config/enemyAttacks'
import { BOSS_PHASES, NO_CHAIN } from './config/bossPhases'
import { enemyDef, kindFromId } from './config/enemies'
import {
  Actor,
  ActorState,
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
import { consumePress, debugInput, endFrame, initInput, mouse } from './core/input'
import { requestHitstop, resetTime, tick, time } from './core/time'
import {
  CELL_SIZE,
  HEIGHT_STEP,
  MAX_CLIMB,
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
  counterEvents,
  countLivingEnemies,
  hitEvents,
  isBackAttack,
  isBehindPoint,
  resolveAttacks,
} from './systems/combat'
import {
  chainIndexFor,
  encounterEvents,
  enemyAiSystem,
  phaseEvents,
  resetAttackTokens,
  setEnemyAiEnabled,
} from './systems/enemyAI'
import { bonfireSystem, type Bonfire } from './systems/bonfire'
import { deathEvents, healthSystem } from './systems/health'
import { SLOT_COUNT, grantRune, skillForSlot, weaponOf } from './systems/loadout'
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
import { healEvents, playerControlSystem, type ControlContext } from './systems/playerControl'
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
  private bonfires: Bonfire[] = []
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
    resetAttackTokens()
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

      this.levelData = level
      const spawned = spawnFromLevel(level, this.terrain)
      this.bonfires = spawned.bonfires
      for (const f of this.bonfires) this.visuals.addBonfire(f.x, f.y, f.z)
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
    this.skillBar.setLoadout(weaponOf(p).name, slots)
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
    if (consumePress('KeyM')) {
      this.hud.showBanner(sfx.toggleMute() ? '음소거' : '소리 켜짐', 'M 키로 전환', 1.1)
    }

    // ---- 1.5 트라이포드 창 (T) ----
    // 창을 열어도 게임은 계속 돕니다(ui/tripodPanel.ts 설계 노트).
    // 그래서 여는 것 자체가 안전하지 않은 선택이 되고, "언제 열지"도 판단이 됩니다.
    if (consumePress('KeyT')) this.tripodPanel.toggle()

    // ---- 2. 시뮬레이션 ----
    if (playerAlive) playerControlSystem(this.controlCtx)
    enemyAiSystem(p, playerAlive, this.controlCtx)
    physicsSystem()
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

    if (playerAlive && this.bonfires.length > 0) {
      const rest = bonfireSystem(p, this.bonfires)
      this.tryUpgrade(p, rest.near !== null && !rest.blocked)
      this.hud.setRest(rest.near !== null, rest.progress, rest.blocked)
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
    }
    fallEvents.length = 0

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
      this.hud.showBanner('반격!', '2.4초 무방비', 1.4)
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
    for (const b of breakEvents) {
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
          // 보스는 부활하지 않습니다 — 앞으로 나아갔다는 유일한 표지입니다.
          this.defeatedBosses.add(bossKey(death.x, death.z))
          // 즉시 저장합니다. 여기서 안 하면 게임을 끄고 켤 때 보스가 되살아나
          // "진행의 표지"라는 이 규칙 자체가 무너집니다.
          this.persistProgress()
        }
        // 처치 보상. 이게 없으면 전투를 전부 지나쳐 달리는 게 최적이 됩니다.
        const gain = enemyDef(Enemy.kind[death.entity]).ember
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
      if (!this.gameOver && enemiesLeft === 0 && this.treasuresFound >= this.treasureTotal) {
        this.gameOver = true
        this.hud.showBanner('클리어!', `${this.levelName} · 보물 ${this.treasuresFound}/${this.treasureTotal}`, 6)
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
    this.hud.setShortcut(s.open ? 'open' : fromTop ? 'ready' : 'locked')
    if (s.open || !fromTop) return
    /**
     * 키가 **V**인 이유: E는 이미 무기 스킬 2번입니다(실제로 E로 만들었다가
     * 프로브에서 사다리 대신 스킬이 나갔습니다). 새 키를 하나 더 늘리는 대신
     * 화톳불 강화와 같은 V를 씁니다 — V는 "이 자리에서 할 수 있는 일" 하나로
     * 묶입니다. 화톳불과 사다리가 같은 자리에 있을 일은 없고(사다리는 절벽
     * 경계, 화톳불은 트인 바닥), 만에 하나 겹치면 강화가 먼저 소비합니다.
     */
    if (!consumePress('KeyV')) return

    s.open = true
    this.syncLadderVisuals()
    sfx.pickup()
    this.cam.addTrauma(0.22)
    this.hud.showBanner('사다리를 내렸다', '지름길이 열렸습니다', 2.2)
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
    this.hud.showBanner('화톳불에서 쉬었다', `성수병 ${Player.vialsMax[p]}개 · 적 ${revived}마리 부활`, 2.2)
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

  /** 사다리 상태 — 프로브가 상수를 베끼지 않고 게임에서 읽도록. */
  debugShortcutInfo(): {
    key: string
    open: boolean
    rise: number
    loWorldX: number
    loWorldZ: number
    hiWorldX: number
    hiWorldZ: number
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
  } {
    return {
      maxClimb: MAX_CLIMB,
      heightStep: HEIGHT_STEP,
      cellSize: CELL_SIZE,
      fallFreeSteps: FALL.freeSteps,
      fallDamagePerStep: FALL.damagePerStep,
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
  } | null {
    if (!isAlive(e)) return null
    return {
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

  debugRunStats(): { deaths: number; rests: number; kills: number } {
    return { deaths: this.deathCount, rests: this.restCount, kills: this.kills }
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
    x: number
    z: number
    dist: number
    hp: number
    playerBehind: boolean
  } | null {
    const p = this.playerEntity
    let best: { x: number; z: number; dist: number; hp: number; playerBehind: boolean } | null = null
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
            dist: Number(near.dist.toFixed(3)),
            hp: Number(near.hp.toFixed(1)),
            playerBehind: near.playerBehind,
          }
        : null,
      frame: time.frame,
      elapsed: Number(time.elapsed.toFixed(3)),
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
      }[]
      /** 적 종류 검증용 — 표를 그대로 내보냅니다(스크립트가 수치를 베끼지 않도록). */
      enemyRoster: () => {
        id: string
        name: string
        maxHp: number
        height: number
        moveSpeed: number
        attackRange: number
        keepDistance?: number
        attacks: { id: string; intent: number; color: string }[]
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
        rotY: number
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
      counterCount: () => number
      /** 주변 적의 위협 상태 — 봇이 색과 방향을 읽습니다. */
      threats: (range?: number) => {
        entity: number
        x: number
        z: number
        dist: number
        intent: number
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
      killAllEnemies: () => number
      /** 회복 검증용 — 성수병/화톳불 상태 */
      vialInfo: () => {
        vials: number
        max: number
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
      nearestBonfire: () => { x: number; z: number } | null
      /** 사다리(지름길) 검증용 */
      shortcutInfo: () => {
        key: string
        open: boolean
        rise: number
        loWorldX: number
        loWorldZ: number
        hiWorldX: number
        hiWorldZ: number
      }[]
      shortcutHint: () => 'ready' | 'locked' | 'open' | null
      walkTest: (fromX: number, fromZ: number, toX: number, toZ: number) => boolean
      pathStep: (toX: number, toZ: number) => { x: number; z: number; dist: number } | null
      terrainInfo: () => {
        maxClimb: number
        heightStep: number
        cellSize: number
        fallFreeSteps: number
        fallDamagePerStep: number
      }
      entityState: (e: number) => {
        hp: number
        maxHp: number
        level: number
        state: number
        brokenT: number
        x: number
        z: number
      } | null
      teleportEntity: (e: number, x: number, z: number) => void
      pushEntity: (e: number, vx: number, vz: number) => void
      /** 봇이 추측하지 않고 읽는 실행 통계 */
      runStats: () => { deaths: number; rests: number; kills: number }
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
  enemyRoster: () =>
    [EnemyKind.Grunt, EnemyKind.Binder, EnemyKind.Dragger, EnemyKind.Boss].map((k) => {
      const d = enemyDef(k)
      return {
        id: d.id,
        name: d.name,
        maxHp: d.maxHp,
        height: d.height,
        moveSpeed: d.moveSpeed,
        attackRange: d.attackRange,
        keepDistance: d.keepDistance,
        attacks: attacksFor(k).map((a) => ({
          id: a.id,
          intent: a.intent as number,
          color: ['🔴', '🟡', '🔵', '🟣'][a.intent as number],
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
      brokenT: Number(Enemy.brokenT[entity].toFixed(2)),
      intent: attackAt(kind, Enemy.attackIndex[entity]).intent,
      staggered: Actor.state[entity] === ActorState.Stagger,
      broken: Enemy.brokenT[entity] > 0,
      poise: Number(Enemy.poise[entity].toFixed(1)),
      poiseMax: enemyDef(Enemy.kind[entity]).poiseMax,
      attackId: attackAt(kind, Enemy.attackIndex[entity]).id,
      attackPhase: Actor.phase[entity],
      chainNext: chain === NO_CHAIN ? '' : (list[chain]?.id ?? ''),
      cooldownT: Number(Actor.cooldownT[entity].toFixed(3)),
    }
  },
  counterInfo: () => ({
    brokenTime: COUNTER.brokenTime,
    normalBrokenTime: POISE.brokenTime,
    damageMultiplier: COUNTER.damageMultiplier,
  }),
  counterCount: () => game.debugCounterCount(),
  threats: (range) => game.debugThreats(range),
  slotCooldowns: () => game.debugSlotCooldowns(),
  cameraAxes: () => game.debugCameraAxes(),
  objective: () => game.debugObjective(),
  bossEncounter: () => game.debugBossEncounter(),
  emberInfo: () => game.debugEmberInfo(),
  setEmbers: (n) => game.debugSetEmbers(n),
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
  nearestBonfire: () => game.debugNearestBonfire(),
  shortcutInfo: () => game.debugShortcutInfo(),
  shortcutHint: () => game.debugShortcutHint(),
  walkTest: (fromX, fromZ, toX, toZ) => game.debugWalkTest(fromX, fromZ, toX, toZ),
  pathStep: (toX, toZ) => game.debugPathStep(toX, toZ),
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
