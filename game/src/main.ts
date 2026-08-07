import * as THREE from 'three'
import { KILL_FEEDBACK, PLAYER, TREASURE, WORLD } from './config/balance'
import {
  Actor,
  ActorState,
  Health,
  Pickup,
  Renderable,
  Stamina,
  Transform,
} from './core/components'
import { defineQuery, destroyEntity, isAlive, resetWorld } from './core/ecs'
import { debugInput, endFrame, initInput, mouse } from './core/input'
import { requestHitstop, resetTime, tick, time } from './core/time'
import { loadLevelFromStorage } from './level/format'
import { Terrain } from './level/terrain'
import { QuarterViewCamera } from './render/camera'
import { createScene } from './render/scene'
import { Vfx } from './render/vfx'
import { KIND_TREASURE, Visuals } from './render/visuals'
import { countLivingEnemies, hitEvents, resolveAttacks } from './systems/combat'
import { enemyAiSystem } from './systems/enemyAI'
import { deathEvents, healthSystem } from './systems/health'
import { physicsSystem, setTerrain } from './systems/physics'
import { playerControlSystem, type ControlContext } from './systems/playerControl'
import { enemyCountForWave, spawnFromLevel, spawnPlayer, spawnWave } from './systems/world'
import { Hud } from './ui/hud'

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

class Game {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly cursorRing: THREE.Mesh
  private readonly sunTarget: THREE.Object3D
  private readonly arena: THREE.Group
  private readonly cam: QuarterViewCamera
  private readonly visuals: Visuals
  private readonly vfx: Vfx
  private readonly hud: Hud

  private playerEntity = -1
  private wave = 1
  private kills = 0
  private waveTimer = 0
  private gameOver = false
  private lastFrameMs = 0
  private readonly aim = { x: 0, z: 0 }
  private readonly controlCtx: ControlContext

  /** 레벨 모드 상태 */
  private readonly wantsLevel: boolean
  private levelMode = false
  private levelName = ''
  private terrain: Terrain | null = null
  private treasureTotal = 0
  private treasuresFound = 0
  private lastFadeLevel = -999

  constructor(canvas: HTMLCanvasElement) {
    const bundle = createScene(canvas)
    this.renderer = bundle.renderer
    this.scene = bundle.scene
    this.cursorRing = bundle.cursorRing
    this.sunTarget = bundle.sunTarget
    this.arena = bundle.arena

    this.cam = new QuarterViewCamera(window.innerWidth / window.innerHeight)
    this.visuals = new Visuals(this.scene, this.cam.camera)
    this.vfx = new Vfx(this.scene)
    this.hud = new Hud()

    this.wantsLevel = new URLSearchParams(location.search).get('level') === 'storage'

    this.controlCtx = {
      forwardX: this.cam.forward.x,
      forwardZ: this.cam.forward.z,
      rightX: this.cam.right.x,
      rightZ: this.cam.right.z,
      aimX: 0,
      aimZ: 0,
      onSwing: (x, z, rotY, range, arcDeg) => this.vfx.spawnSwing(x, z, rotY, range, arcDeg),
    }

    initInput(canvas)
    this.hud.restartButton.addEventListener('click', () => this.reset())
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

    if (this.terrain) {
      this.scene.remove(this.terrain.group)
      this.terrain.dispose()
      this.terrain = null
      setTerrain(null)
    }
    this.lastFadeLevel = -999

    this.kills = 0
    this.waveTimer = 0
    this.gameOver = false
    this.treasuresFound = 0
    this.treasureTotal = 0
    this.hud.hideBanner()

    const level = this.wantsLevel ? loadLevelFromStorage() : null
    this.levelMode = level !== null

    if (level) {
      this.levelName = level.name
      this.terrain = new Terrain(level)
      this.scene.add(this.terrain.group)
      setTerrain(this.terrain)
      this.arena.visible = false

      const spawned = spawnFromLevel(level, this.terrain)
      this.playerEntity = spawned.player
      this.visuals.attach(this.playerEntity, Renderable.kind[this.playerEntity])
      for (const e of spawned.entities) this.visuals.attach(e, Renderable.kind[e])
      this.treasureTotal = spawned.treasureTotal

      const foes = spawned.entities.length - spawned.treasureTotal
      this.hud.setMode('level')
      this.hud.showBanner(level.name, `적 ${foes} · 보물 ${spawned.treasureTotal}`, 2.4)
      // 시작 지점이 화면 중앙에 오도록 카메라를 미리 붙여 둡니다.
      this.cam.snapTo(Transform.x[this.playerEntity], Transform.z[this.playerEntity])
    } else {
      this.levelName = ''
      this.arena.visible = true
      this.playerEntity = spawnPlayer()
      this.visuals.attach(this.playerEntity, Renderable.kind[this.playerEntity])
      this.wave = 1
      this.hud.setMode('arena')
      this.startWave()
    }
  }

  private startWave(): void {
    const ids = spawnWave(enemyCountForWave(this.wave))
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

    // ---- 2. 시뮬레이션 ----
    if (playerAlive) playerControlSystem(this.controlCtx)
    enemyAiSystem(p, playerAlive, this.controlCtx)
    physicsSystem()
    resolveAttacks()

    // ---- 3. 타격 피드백 ----
    // 손맛의 3요소(정지 + 흔들림 + 숫자)를 여기서 한꺼번에 터뜨립니다.
    for (const hit of hitEvents) {
      requestHitstop(hit.hitstop)
      this.cam.addTrauma(hit.trauma, hit.dirX, hit.dirZ)
      this.vfx.spawnHitSpark(hit.x, hit.y, hit.z, hit.heavy ? 1.5 : 1)
      this.vfx.spawnDamage(hit.x, hit.y + 0.5, hit.z, hit.damage, hit.heavy)
    }
    hitEvents.length = 0

    // ---- 4. 사망 처리 ----
    healthSystem()
    for (const death of deathEvents) {
      if (death.isPlayer) {
        this.gameOver = true
        this.cam.addTrauma(0.8)
        requestHitstop(0.22)
        this.hud.showGameOver(this.kills, this.wave)
      } else {
        this.kills++
        requestHitstop(KILL_FEEDBACK.hitstop)
        this.cam.addTrauma(KILL_FEEDBACK.trauma)
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
      if (safeLvl !== this.lastFadeLevel) {
        this.terrain.applyOcclusionFade(safeLvl)
        this.lastFadeLevel = safeLvl
      }
    }

    this.visuals.sync()
    this.vfx.update(this.cam.camera)
    this.renderer.render(this.scene, this.cam.camera)
    if (this.sampleRequested) {
      this.sampleRequested = false
      this.lastSample = this.readFramebuffer()
    }

    // ---- 8. HUD ----
    this.hud.setVitals(Health.hp[p], Health.max[p], Stamina.value[p], Stamina.max[p])
    if (this.levelMode) {
      this.hud.setLevelProgress(this.levelName, enemiesLeft, this.treasuresFound, this.treasureTotal)
    } else {
      this.hud.setProgress(this.wave, enemiesLeft, this.kills)
    }
    this.hud.tickPerf(time.realDt)

    endFrame()
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
      this.vfx.spawnHitSpark(Transform.x[e], Transform.y[e] + 1.05, Transform.z[e], 1.8)
      this.cam.addTrauma(0.18)
      this.hud.showBanner('보물 획득', `${this.treasuresFound} / ${this.treasureTotal}`, 1.4)
      this.visuals.detach(e)
      destroyEntity(e)
    }
  }

  /**
   * VFX 격리 확인용. 적을 모두 치우고 이펙트 한 종류만 화면에 띄웁니다.
   * 전투 중 스크린샷은 여러 이펙트가 겹쳐 있어서, 어느 것이 잘못 그려지는지
   * 구분할 수가 없습니다. 하나씩 떼어놓고 봐야 원인이 특정됩니다.
   */
  debugClearEnemies(): void {
    for (let e = 0; e < 4096; e++) {
      if (!isAlive(e) || e === this.playerEntity) continue
      if (Renderable.kind[e] === KIND_TREASURE) continue
      this.visuals.detach(e)
      destroyEntity(e)
    }
  }

  debugSpawnVfx(kind: 'spark' | 'damage' | 'swing'): void {
    const x = Transform.x[this.playerEntity]
    const z = Transform.z[this.playerEntity] + 2.5
    const y = Transform.y[this.playerEntity]
    if (kind === 'spark') this.vfx.spawnHitSpark(x, y + 1.0, z, 1)
    else if (kind === 'damage') this.vfx.spawnDamage(x, y + 1.4, z, 27, true)
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
  private nearestEnemy(): { x: number; z: number; dist: number } | null {
    const p = this.playerEntity
    let best: { x: number; z: number; dist: number } | null = null
    for (let e = 0; e < 4096; e++) {
      if (!isAlive(e) || e === p) continue
      if (Actor.state[e] === ActorState.Dead) continue
      const kind = Renderable.kind[e]
      if (kind !== 1 && kind !== 3) continue
      const d = Math.hypot(Transform.x[e] - Transform.x[p], Transform.z[e] - Transform.z[p])
      if (!best || d < best.dist) best = { x: Transform.x[e], z: Transform.z[e], dist: d }
    }
    return best
  }

  /** 헤드리스 검증용 스냅샷 */
  debugState() {
    const p = this.playerEntity
    const near = this.nearestEnemy()
    return {
      nearestEnemy: near
        ? { x: Number(near.x.toFixed(3)), z: Number(near.z.toFixed(3)), dist: Number(near.dist.toFixed(3)) }
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
        terrainLevel: this.terrain ? this.terrain.levelAtWorld(Transform.x[p], Transform.z[p]) : null,
      },
      aim: { x: Number(this.aim.x.toFixed(3)), z: Number(this.aim.z.toFixed(3)) },
      enemiesLeft: countLivingEnemies(),
      kills: this.kills,
      wave: this.wave,
      gameOver: this.gameOver,
      maxCombo: PLAYER.combo.length,
      levelMode: this.levelMode,
      levelName: this.levelName,
      treasuresFound: this.treasuresFound,
      treasureTotal: this.treasureTotal,
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
      spawnVfx: (kind: 'spark' | 'damage' | 'swing') => void
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
  spawnVfx: (kind) => game.debugSpawnVfx(kind),
}
