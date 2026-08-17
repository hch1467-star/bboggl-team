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
const GROUND_POOL = 20

const DAMAGE_LIFE = 0.75
const SPARK_LIFE = 0.22
/**
 * 궤적은 짧아야 잔상처럼 보입니다. 길면 지면에 눌어붙은 장판처럼 보입니다.
 *
 * ⚔️ **무게에 따라 늘어납니다.** 콤보 마무리는 첫 타보다 오래 남아야
 * *"방금 큰 게 들어갔다"* 가 눈에 남습니다 — 손끝(히트스톱)이 이미 그렇게
 * 말하고 있는데 화면만 같은 말을 반복하고 있었습니다.
 * 최대치도 0.30초에 묶어 둡니다. 더 길면 잔상이 아니라 장판이 됩니다.
 */
const SWING_LIFE = 0.19
const SWING_LIFE_HEAVY = 0.3
/** 가벼운 것은 서늘한 흰빛, 무거운 것은 달아오른 호박빛. */
const SWING_COLOR_LIGHT = 0xeaf6ff
const SWING_COLOR_HEAVY = 0xffc46b


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

/**
 * 지면 도형 — 스킬의 예고(telegraph)와 발동 범위 표시.
 *
 * DESIGN.md 기둥 2("바닥을 읽는 전투")의 핵심 장치입니다.
 * 로스트아크가 바닥 색으로 대응을 구분하듯, 우리도 스킬마다 색을 다르게 주고
 * **예고 → 채워짐 → 발동** 3단계로 보여줍니다. 이게 있어야 적도 플레이어도
 * "보고 피할" 수 있고, 죽었을 때 "못 봤다"가 아니라 "못 피했다"가 됩니다.
 *
 *   outline — 범위 테두리 (예고 내내 고정)
 *   fill    — 안쪽이 차오름 (남은 시간 = 위험 시점을 알려줌)
 *   fade    — 발동 순간 번쩍이며 사라짐
 */
type GroundMode = 'outline' | 'fill' | 'fade'

interface GroundItem {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  life: number
  maxLife: number
  mode: GroundMode
  radius: number
}

interface SwingItem {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  life: number
  /** 이 궤적이 **처음 받은** 수명. 무게마다 다르므로 사그라드는 비율을
   *  고정값으로 나누면 무거운 것이 갑자기 사라집니다. */
  maxLife: number
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
  c.width = 220
  c.height = 112
  return c
}

/** 데미지 숫자의 종류. 색·크기·머리말이 달라집니다. */
export interface DamageStyle {
  heavy?: boolean
  /** 등 뒤에서 꽂았는가 */
  back?: boolean
  crit?: boolean
  heal?: boolean
}

/**
 * 숫자 위에 머리말을 붙여 **왜 이 숫자가 큰지** 알려줍니다.
 *
 * 색만 바꾸면 "어? 이번엔 왜 세게 들어갔지?"에 답이 안 됩니다.
 * "백어택"이라고 써 줘야 플레이어가 **다음에도 그렇게 하려고** 움직입니다.
 * 기둥 3(포지셔닝 보상)이 학습되는 지점이 정확히 여기입니다.
 */
function styleOf(style: DamageStyle): { color: string; label: string; scale: number } {
  if (style.heal) return { color: '#7ef2a5', label: '회복', scale: 1.1 }
  if (style.back && style.crit) return { color: '#ff8a3c', label: '백어택 치명타!', scale: 1.9 }
  if (style.back) return { color: '#ffb648', label: '백어택', scale: 1.5 }
  if (style.crit) return { color: '#ffe07a', label: '치명타', scale: 1.45 }
  if (style.heavy) return { color: '#ffd257', label: '', scale: 1.3 }
  return { color: '#ffffff', label: '', scale: 1 }
}

function drawDamage(canvas: HTMLCanvasElement, text: string, color: string, label: string): void {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const numY = label ? canvas.height * 0.62 : canvas.height / 2
  ctx.font = 'bold 58px system-ui, -apple-system, "Segoe UI", sans-serif'
  // 검은 테두리 — 밝은 바닥 위에서도 숫자가 읽히게 합니다.
  ctx.lineWidth = 9
  ctx.strokeStyle = 'rgba(0,0,0,0.88)'
  ctx.strokeText(text, canvas.width / 2, numY)
  ctx.fillStyle = color
  ctx.fillText(text, canvas.width / 2, numY)

  if (label) {
    ctx.font = 'bold 26px system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(0,0,0,0.88)'
    ctx.strokeText(label, canvas.width / 2, canvas.height * 0.2)
    ctx.fillStyle = color
    ctx.fillText(label, canvas.width / 2, canvas.height * 0.2)
  }
}

export class Vfx {
  private readonly damages: DamageItem[] = []
  private readonly sparks: SparkItem[] = []
  private readonly swings: SwingItem[] = []
  private damageCursor = 0
  private sparkCursor = 0
  private swingCursor = 0
  private readonly glowTexture: THREE.CanvasTexture
  private readonly grounds: GroundItem[] = []
  private groundCursor = 0
  /** 부채꼴 지오메트리는 각도마다 달라서 캐시합니다(스킬 종류가 적어 금방 포화). */
  private readonly sectorCache = new Map<number, THREE.BufferGeometry>()
  private readonly crescentCache = new Map<number, THREE.BufferGeometry>()

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

    for (let i = 0; i < SWING_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xeaf6ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.crescentGeo(120), material)
      mesh.visible = false
      mesh.renderOrder = 14
      scene.add(mesh)
      this.swings.push({ mesh, material, life: 0, maxLife: SWING_LIFE, baseScale: 1 })
    }

    for (let i = 0; i < GROUND_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.sectorGeo(360), material)
      mesh.visible = false
      mesh.renderOrder = 12
      scene.add(mesh)
      this.grounds.push({ mesh, material, life: 0, maxLife: 1, mode: 'fade', radius: 1 })
    }
  }

  /**
   * 반지름 1짜리 단위 **초승달**. 검격 궤적용.
   *
   * 각도마다 지오메트리를 따로 만드는 것이 핵심입니다.
   * 예전에는 고정 각도(137°) 하나를 만들어 크기만 늘렸다 줄였다 했는데,
   * 그러면 175°로 훑는 대검과 95°로 찌르는 단검이 **화면에서 완전히 똑같이** 보입니다.
   * "무기 차이가 안 느껴진다"는 플레이 테스트 피드백의 직접적인 원인이었습니다.
   */
  private crescentGeo(arcDeg: number): THREE.BufferGeometry {
    const key = Math.round(arcDeg)
    const cached = this.crescentCache.get(key)
    if (cached) return cached
    const arc = (key * Math.PI) / 180
    /**
     * 안쪽 반지름 0.66 -> 0.46.
     *
     * 히트박스는 **0부터 사거리까지 전부**인데 초승달은 바깥 1/3만 그려서,
     * 사거리 안쪽에 바짝 붙은 적이 맞아도 화면에는 그 적 **너머로** 궤적이
     * 지나갔습니다. "이펙트랑 히트박스가 어긋난다"는 지적의 절반이 이것입니다.
     *
     * 완전히 채우면(0부터) 예전처럼 회색 덩어리가 되어 궤적으로 안 읽힙니다.
     * 0.46은 "휘두른 자국"으로 읽히면서도 실제 도달 범위를 훨씬 정직하게 덮는 선입니다.
     */
    const geo = new THREE.RingGeometry(0.46, 1, 48, 1, -arc / 2, arc)
    geo.rotateX(-Math.PI / 2)
    geo.rotateY(-Math.PI / 2)
    this.crescentCache.set(key, geo)
    return geo
  }

  /** 반지름 1짜리 단위 부채꼴. 실제 크기는 스케일로 맞춥니다. */
  private sectorGeo(arcDeg: number): THREE.BufferGeometry {
    const key = Math.round(arcDeg)
    const cached = this.sectorCache.get(key)
    if (cached) return cached
    const arc = key >= 359 ? Math.PI * 2 : (key * Math.PI) / 180
    const geo = new THREE.RingGeometry(0.03, 1, 56, 1, -arc / 2, arc)
    geo.rotateX(-Math.PI / 2) // 지면에 눕히기
    geo.rotateY(-Math.PI / 2) // theta=0 을 정면(+Z)으로
    this.sectorCache.set(key, geo)
    return geo
  }

  spawnGroundShape(
    x: number,
    y: number,
    z: number,
    rotY: number,
    radius: number,
    arcDeg: number,
    color: number,
    life: number,
    mode: GroundMode,
  ): void {
    const item = this.grounds[this.groundCursor]
    this.groundCursor = (this.groundCursor + 1) % GROUND_POOL
    item.mesh.geometry = this.sectorGeo(arcDeg)
    item.mesh.position.set(x, y + 0.05, z)
    item.mesh.rotation.y = rotY
    item.mesh.scale.set(radius, 1, radius)
    item.mesh.visible = true
    item.material.color.setHex(color)
    item.material.opacity = mode === 'fade' ? 0.85 : mode === 'fill' ? 0.5 : 0.42
    item.material.blending = mode === 'fade' ? THREE.AdditiveBlending : THREE.NormalBlending
    item.material.needsUpdate = true
    item.life = Math.max(life, 0.05)
    item.maxLife = item.life
    item.mode = mode
    item.radius = radius
  }

  spawnDamage(x: number, y: number, z: number, amount: number, style: DamageStyle = {}): void {
    const item = this.damages[this.damageCursor]
    this.damageCursor = (this.damageCursor + 1) % DAMAGE_POOL

    const look = styleOf(style)
    const text = (style.heal ? '+' : '') + String(Math.round(amount))
    drawDamage(item.canvas, text, look.color, look.label)
    item.texture.needsUpdate = true
    item.sprite.position.set(x, y, z)
    item.sprite.scale.set(1.7 * look.scale, 0.87 * look.scale, 1)
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

  /**
   * 검격 궤적. **실제 판정과 같은 사거리·같은 각도**로 그립니다.
   * 이 도형이 곧 "내 공격이 닿는 범위"의 설명이므로, 조금이라도 어긋나면
   * 플레이어가 사거리를 잘못 배우게 됩니다.
   */
  /**
   * @param power 이 한 방의 **무게** 0~1 (arsenal `swingPower`).
   *              색·두께·머무는 시간이 이 값 하나로 갈립니다.
   */
  spawnSwing(
    x: number,
    z: number,
    rotY: number,
    range: number,
    arcDeg: number,
    power = 0,
  ): void {
    const item = this.swings[this.swingCursor]
    this.swingCursor = (this.swingCursor + 1) % SWING_POOL
    item.mesh.geometry = this.crescentGeo(arcDeg)
    item.mesh.position.set(x, 0.06, z)
    item.mesh.rotation.y = rotY
    // 단위 초승달(반지름 1)을 사거리만큼 균등 확대. X/Z를 다르게 주면
    // 타원으로 찌그러져 표시 범위와 판정 범위가 어긋납니다.
    item.baseScale = range
    item.mesh.scale.set(range, 1, range)
    item.mesh.visible = true
    item.material.opacity = 1
    /**
     * ⚔️ 무게가 세 가지를 한꺼번에 움직입니다 — 색·크기·머무는 시간.
     *
     * 하나만 바꾸면 (예: 색만) 눈에 잘 안 들어옵니다. 주변 시야로 보는
     * 화면에서 읽히는 것은 **여러 신호가 같은 방향으로 함께 움직일 때**
     * 입니다 — 이 저장소가 반격 신호를 만들 때 이미 쓴 규칙입니다
     * (테두리만 바꾸지 않고 맥박을 같이 준 것).
     */
    const w = Math.max(0, Math.min(1, power))
    item.material.color.setHex(SWING_COLOR_LIGHT).lerp(new THREE.Color(SWING_COLOR_HEAVY), w)
    item.mesh.scale.y = 1 + w * 0.6
    item.life = SWING_LIFE + (SWING_LIFE_HEAVY - SWING_LIFE) * w
    item.maxLife = item.life
  }

  /**
   * 지금 화면에 검격 궤적이 떠 있는가.
   *
   * 검증 도구가 **궤적이 실제로 보이는 프레임**을 집어내는 데 씁니다.
   * 궤적은 0.19초만 살아 있어서, 브라우저 바깥에서 폴링하면 왕복 지연 때문에
   * 매번 놓칩니다(실제로 롱소드 사진에 궤적이 통째로 빠졌습니다).
   */
  hasActiveSwing(): boolean {
    for (const s of this.swings) if (s.life > 0) return true
    return false
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

    for (const g of this.grounds) {
      if (g.life <= 0) continue
      g.life -= dt
      if (g.life <= 0) {
        g.mesh.visible = false
        continue
      }
      const t = 1 - g.life / g.maxLife
      if (g.mode === 'fill') {
        // 안쪽이 차오르는 속도 = 남은 예고 시간. 다 차면 터집니다.
        const s2 = g.radius * (0.06 + t * 0.94)
        g.mesh.scale.set(s2, 1, s2)
        g.material.opacity = 0.5
      } else if (g.mode === 'fade') {
        const s2 = g.radius * (1 + t * 0.14)
        g.mesh.scale.set(s2, 1, s2)
        g.material.opacity = 0.8 * (1 - t)
      } else {
        // outline — 예고 내내 같은 자리에 같은 세기로 남아 범위를 알려줍니다.
        g.material.opacity = 0.42
      }
    }

    for (const w of this.swings) {
      if (w.life <= 0) continue
      w.life -= dt
      if (w.life <= 0) {
        w.mesh.visible = false
        continue
      }
      const t = 1 - w.life / (w.maxLife || SWING_LIFE)
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
    for (const g of this.grounds) {
      this.scene.remove(g.mesh)
      g.material.dispose()
    }
    for (const geo of this.sectorCache.values()) geo.dispose()
    this.sectorCache.clear()
    for (const geo of this.crescentCache.values()) geo.dispose()
    this.crescentCache.clear()
    this.glowTexture.dispose()
  }
}
