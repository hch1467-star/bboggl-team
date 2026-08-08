import * as THREE from 'three'
import { RUNE_ORDER, SKILLS } from './config/arsenal'
import { COMBAT, KILL_FEEDBACK, TREASURE, WORLD } from './config/balance'
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
} from './core/components'
import { AttackPhase } from './core/components'
import { defineQuery, destroyEntity, isAlive, resetWorld } from './core/ecs'
import { sfx } from './core/audio'
import { consumePress, debugInput, endFrame, initInput, mouse } from './core/input'
import { requestHitstop, resetTime, tick, time } from './core/time'
import { loadLevelFromStorage, worldToCell, type LevelData, type LevelRegion } from './level/format'
import { DEFAULT_LEVEL_ID, loadBundledLevel } from './levels'
import { Terrain } from './level/terrain'
import { QuarterViewCamera } from './render/camera'
import { createScene } from './render/scene'
import { Vfx } from './render/vfx'
import { KIND_TREASURE, Visuals } from './render/visuals'
import { countLivingEnemies, hitEvents, isBackAttack, isBehindPoint, resolveAttacks } from './systems/combat'
import {
  chainIndexFor,
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
import { physicsSystem, setTerrain } from './systems/physics'
import { healEvents, playerControlSystem, type ControlContext } from './systems/playerControl'
import {
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
  /** 적을 되살리려면 원본 배치가 필요합니다. */
  private levelData: LevelData | null = null
  /** 이 레벨의 세이브 칸 식별자. 아레나면 빈 문자열(저장하지 않음). */
  private saveId = ''
  /** 이미 먹은 보물의 위치 키. 세이브에서 복원되고, 새로 먹을 때마다 추가됩니다. */
  private takenTreasures = new Set<string>()
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
        // 이미 먹은 보물은 아예 치웁니다. 남겨두면 다시 먹혀서 각인석이 무한정 생깁니다.
        this.removeTakenTreasures()
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
    if (playerAlive && this.bonfires.length > 0) {
      const rest = bonfireSystem(p, this.bonfires)
      this.hud.setRest(rest.near !== null, rest.progress, rest.blocked)
      if (rest.rested && rest.near) this.restAt(p, rest.near)
    } else {
      this.hud.setRest(false, 0, false)
    }

    // ---- 4. 사망 처리 ----
    healthSystem()
    for (const death of deathEvents) {
      if (death.isPlayer) {
        this.cam.addTrauma(0.8)
        requestHitstop(0.22)
        sfx.death(true)
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
        this.gameOver = true
        this.hud.showGameOver(this.kills, this.wave)
      } else {
        this.kills++
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
    this.hud.setNavigation(
      this.currentRegion,
      objective ? `목표: ${objective.label} (${objective.dist.toFixed(0)}m)` : '목표: 완료',
    )

    // --- 지면 화살표: 목표가 멀 때만. 가까우면 눈으로 보이므로 방해만 됩니다. ---
    const showGuide = objective !== null && objective.dist > 9
    this.guide.visible = showGuide
    if (showGuide && objective) {
      this.guide.position.set(px, Transform.y[p] + 0.06, pz)
      this.guide.rotation.y = Math.atan2(objective.x - px, objective.z - pz)
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
      captureSave(this.saveId, this.playerEntity, this.takenTreasures, time.elapsed),
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
  private restAt(p: number, fire: Bonfire): void {
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
      const fresh = respawnLevelEnemies(this.levelData, this.terrain)
      for (const e of fresh) this.visuals.attach(e, Renderable.kind[e])
      revived = fresh.length
      resetAttackTokens()
    }

    this.cam.addTrauma(0.2)
    sfx.bossPhase()
    this.hud.showBanner('화톳불에서 쉬었다', `성수병 ${Player.vialsMax[p]}개 · 적 ${revived}마리 부활`, 2.2)
    this.persistProgress()
  }

  /** 죽었을 때 마지막으로 쉰 화톳불에서 다시 시작합니다. */
  private respawnAtBonfire(p: number): void {
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
      const fresh = respawnLevelEnemies(this.levelData, this.terrain)
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

  debugVialInfo(): {
    vials: number
    max: number
    hp: number
    state: number
    drinking: boolean
    bonfires: number
    hasRespawn: boolean
    restProgress: number
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
    for (let e = 0; e < 4096; e++) {
      if (!isAlive(e) || e === p) continue
      if (Actor.state[e] === ActorState.Dead) continue
      const kind = Renderable.kind[e]
      if (kind !== 1 && kind !== 3) continue
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
        attackId: string
        attackPhase: number
        chainNext: string
        cooldownT: number
      } | null
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
      }
      playerEntity: () => number
      enemyCount: () => number
      setVials: (n: number) => void
      teleportPlayer: (x: number, z: number) => void
      nearestBonfire: () => { x: number; z: number } | null
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
      attackId: attackAt(kind, Enemy.attackIndex[entity]).id,
      attackPhase: Actor.phase[entity],
      chainNext: chain === NO_CHAIN ? '' : (list[chain]?.id ?? ''),
      cooldownT: Number(Actor.cooldownT[entity].toFixed(3)),
    }
  },
  vialInfo: () => game.debugVialInfo(),
  playerEntity: () => game.debugPlayerEntity(),
  enemyCount: () => countLivingEnemies(),
  setVials: (n) => game.debugSetVials(n),
  teleportPlayer: (x, z) => game.debugTeleport(x, z),
  nearestBonfire: () => game.debugNearestBonfire(),
  saveInfo: () => game.debugSaveInfo(),
  resetProgress: () => game.resetProgress(),
  audio: {
    unlock: () => sfx.unlock(),
    state: () => sfx.debugState(),
    level: () => sfx.debugLevel(),
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
