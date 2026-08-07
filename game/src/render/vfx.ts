import * as THREE from 'three'
import { time } from '../core/time'

/**
 * 타격 이펙트 — 데미지 숫자, 히트 스파크, 검격 궤적.
 *
 * 전부 time.realDt 로 움직입니다. 히트스톱으로 게임이 멈춘 순간에도
 * 이펙트는 계속 흘러야 "정지"가 아니라 "충격"으로 읽힙니다.
 * (이펙트까지 같이 멈추면 그냥 프레임 드랍처럼 보입니다.)
 *
 * 모든 오브젝트는 풀(pool)로 미리 만들어 둡니다. 타격마다 new 를 하면
 * GC가 튀면서 정확히 가장 바쁜 순간에 프레임이 끊깁니다.
 */

const DAMAGE_POOL = 40
const SPARK_POOL = 24
const SWING_POOL = 8

const DAMAGE_LIFE = 0.75
const SPARK_LIFE = 0.22
/** 궤적은 짧아야 잔상처럼 보입니다. 길면 지면에 눌어붙은 장판처럼 보입니다. */
const SWING_LIFE = 0.19
/** 궤적 지오메트리의 기준 반지름. 실제 사거리는 이 값 대비 균등 스케일로 맞춥니다. */
const SWING_BASE_RADIUS = 2.6

interface DamageItem {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  life: number
  vy: number
  driftX: number
  driftZ: number
}

interface SparkItem {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  life: number
  scale: number
}

interface SwingItem {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  life: number
  baseScale: number
}

/**
 * 방사형 글로우 텍스처.
 *
 * 없으면 안 되는 이유: 가산 블렌딩(Additive)을 건 판(Plane)에 텍스처가 없으면
 * 화면에 **밝은 정사각형**이 그대로 찍힙니다. 실제로 첫 검증 스크린샷에서
 * 타격할 때마다 흰 네모가 튀어나왔습니다. 알파가 가장자리로 갈수록 0이 되는
 * 그라디언트를 씌워야 "빛 번짐"으로 읽힙니다.
 */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,245,214,0.92)')
  g.addColorStop(0.42, 'rgba(255,196,110,0.34)')
  g.addColorStop(0.72, 'rgba(255,140,60,0.08)')
  g.addColorStop(1, 'rgba(255,120,40,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeDamageCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 160
  c.height = 80
  return c
}

function drawDamage(canvas: HTMLCanvasElement, text: string, color: string): void {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = 'bold 56px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // 검은 테두리 — 밝은 바닥 위에서도 숫자가 읽히게 합니다.
  ctx.lineWidth = 9
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2)
  ctx.fillStyle = color
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
}

export class Vfx {
  private readonly damages: DamageItem[] = []
  private readonly sparks: SparkItem[] = []
  private readonly swings: SwingItem[] = []
  private damageCursor = 0
  private sparkCursor = 0
  private swingCursor = 0
  private readonly glowTexture: THREE.CanvasTexture

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < DAMAGE_POOL; i++) {
      const canvas = makeDamageCanvas()
      const texture = new THREE.CanvasTexture(canvas)
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
      )
      sprite.scale.set(1.5, 0.75, 1)
      sprite.visible = false
      sprite.renderOrder = 20
      scene.add(sprite)
      this.damages.push({ sprite, canvas, texture, life: 0, vy: 0, driftX: 0, driftZ: 0 })
    }

    const sparkGeo = new THREE.PlaneGeometry(1, 1)
    this.glowTexture = makeGlowTexture()
    for (let i = 0; i < SPARK_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color: 0xfff0c0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(sparkGeo, material)
      mesh.visible = false
      mesh.renderOrder = 15
      scene.add(mesh)
      this.sparks.push({ mesh, material, life: 0, scale: 1 })
    }

    // 검격 궤적 — 지면에 눕힌 초승달 모양. 중심이 로컬 +Z를 향하게 미리 회전해 둡니다.
    //
    // 두께가 얇아야 하는 이유: 안쪽까지 꽉 찬 부채꼴로 그리면 "회색 덩어리"로 보입니다
    // (첫 검증 스크린샷에서 실제로 그렇게 나왔습니다). 바깥 테두리만 남긴 초승달이라야
    // 칼이 지나간 자국으로 읽히고, 동시에 **공격이 닿는 거리와 각도**를 정확히 알려줍니다.
    const swingGeo = new THREE.RingGeometry(SWING_BASE_RADIUS * 0.66, SWING_BASE_RADIUS, 44, 1, -1.15, 2.3)
    swingGeo.rotateX(-Math.PI / 2)
    swingGeo.rotateY(-Math.PI / 2)
    for (let i = 0; i < SWING_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xeaf6ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(swingGeo, material)
      mesh.visible = false
      mesh.renderOrder = 14
      scene.add(mesh)
      this.swings.push({ mesh, material, life: 0, baseScale: 1 })
    }
  }

  spawnDamage(x: number, y: number, z: number, amount: number, heavy = false): void {
    const item = this.damages[this.damageCursor]
    this.damageCursor = (this.damageCursor + 1) % DAMAGE_POOL

    drawDamage(item.canvas, String(Math.round(amount)), heavy ? '#ffd257' : '#ffffff')
    item.texture.needsUpdate = true
    item.sprite.position.set(x, y, z)
    item.sprite.scale.set(heavy ? 2.1 : 1.5, heavy ? 1.05 : 0.75, 1)
    item.sprite.visible = true
    item.sprite.material.opacity = 1
    item.life = DAMAGE_LIFE
    item.vy = 3.1
    // 같은 자리에 여러 숫자가 겹쳐 안 보이는 것을 막기 위해 옆으로 살짝 흩뿌립니다.
    const a = Math.random() * Math.PI * 2
    item.driftX = Math.cos(a) * 1.1
    item.driftZ = Math.sin(a) * 1.1
  }

  spawnHitSpark(x: number, y: number, z: number, scale = 1): void {
    const item = this.sparks[this.sparkCursor]
    this.sparkCursor = (this.sparkCursor + 1) % SPARK_POOL
    item.mesh.position.set(x, y, z)
    item.mesh.visible = true
    item.material.opacity = 1
    item.life = SPARK_LIFE
    item.scale = scale
  }

  spawnSwing(x: number, z: number, rotY: number, range: number, _arcDeg: number): void {
    const item = this.swings[this.swingCursor]
    this.swingCursor = (this.swingCursor + 1) % SWING_POOL
    item.mesh.position.set(x, 0.06, z)
    item.mesh.rotation.y = rotY
    // 반드시 **균등 스케일**이어야 합니다. X와 Z를 다르게 주면 부채꼴이 좁아지는 게
    // 아니라 타원으로 찌그러져서, 표시되는 범위가 실제 판정 범위와 어긋납니다.
    // (각도 차이는 무기별 지오메트리를 따로 만들 때 반영합니다.)
    const s = range / SWING_BASE_RADIUS
    item.baseScale = s
    item.mesh.scale.set(s, 1, s)
    item.mesh.visible = true
    item.material.opacity = 1
    item.life = SWING_LIFE
  }

  update(camera: THREE.Camera): void {
    const dt = time.realDt

    for (const d of this.damages) {
      if (d.life <= 0) continue
      d.life -= dt
      if (d.life <= 0) {
        d.sprite.visible = false
        continue
      }
      const t = 1 - d.life / DAMAGE_LIFE
      d.vy -= 7.5 * dt // 위로 튀었다가 중력으로 떨어지는 곡선
      d.sprite.position.y += d.vy * dt
      d.sprite.position.x += d.driftX * dt
      d.sprite.position.z += d.driftZ * dt
      // 마지막 35%에서만 사라지게 — 너무 일찍 흐려지면 숫자를 못 읽습니다.
      d.sprite.material.opacity = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35
    }

    for (const s of this.sparks) {
      if (s.life <= 0) continue
      s.life -= dt
      if (s.life <= 0) {
        s.mesh.visible = false
        continue
      }
      const t = 1 - s.life / SPARK_LIFE
      const size = s.scale * (0.6 + t * 2.4)
      s.mesh.scale.set(size, size, 1)
      s.material.opacity = 1 - t
      s.mesh.quaternion.copy(camera.quaternion)
    }

    for (const w of this.swings) {
      if (w.life <= 0) continue
      w.life -= dt
      if (w.life <= 0) {
        w.mesh.visible = false
        continue
      }
      const t = 1 - w.life / SWING_LIFE
      // 살짝 커지면서 사라집니다 — 칼이 지나간 뒤 잔상이 퍼지는 느낌.
      const grow = 1 + t * 0.12
      w.mesh.scale.x = w.baseScale * grow
      w.mesh.scale.z = w.baseScale * grow
      // 뒤쪽 60%에서만 급격히 사라지게 해서, 초반에는 확실히 보이게 합니다.
      w.material.opacity = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6
    }
  }

  dispose(): void {
    for (const d of this.damages) {
      this.scene.remove(d.sprite)
      d.texture.dispose()
      d.sprite.material.dispose()
    }
    for (const s of this.sparks) {
      this.scene.remove(s.mesh)
      s.material.dispose()
    }
    for (const w of this.swings) {
      this.scene.remove(w.mesh)
      w.material.dispose()
    }
    this.glowTexture.dispose()
  }
}
