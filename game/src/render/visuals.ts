import * as THREE from 'three'
import { GRUNT, PLAYER } from '../config/balance'
import { Actor, ActorState, AttackPhase, Health, Renderable, Transform } from '../core/components'
import { defineQuery } from '../core/ecs'

/**
 * ECS 데이터 -> Three.js 오브젝트 동기화.
 *
 * 중요한 설계 원칙: 게임 로직은 Three.js를 전혀 모릅니다.
 * 로직은 Transform.x / rotY 같은 숫자만 만지고, 이 파일이 그 숫자를 읽어
 * 화면에 옮깁니다. 이 경계선 덕분에 나중에 Unity로 이식할 때
 * **이 파일 하나만 버리면** 나머지 로직이 그대로 넘어갑니다.
 *
 * 회전 규약: rotY = 0 일 때 캐릭터의 정면은 월드 +Z 입니다.
 *   forward = (sin(rotY), 0, cos(rotY))
 * Three.js Group의 rotation.y 를 rotY 로 두면 로컬 +Z 가 정확히 이 방향이 됩니다.
 */

const KIND_PLAYER = 0
const KIND_GRUNT = 1

interface Visual {
  group: THREE.Group
  body: THREE.Mesh
  material: THREE.MeshStandardMaterial
  /** 적이 공격을 준비할 때 지면에 뜨는 예고 부채꼴 */
  telegraph?: THREE.Mesh
  telegraphMat?: THREE.MeshBasicMaterial
  /** 머리 위 체력바 (적 전용) */
  hpBar?: THREE.Group
  hpFill?: THREE.Mesh
  baseColor: THREE.Color
}

/** 부채꼴 예고 지오메트리를 만들고, 부채꼴 중심이 로컬 +Z를 향하도록 미리 눕혀 둡니다. */
function makeTelegraphGeometry(reach: number, arcDeg: number): THREE.BufferGeometry {
  const arc = (arcDeg * Math.PI) / 180
  const geo = new THREE.RingGeometry(0.35, reach, 40, 1, -arc / 2, arc)
  geo.rotateX(-Math.PI / 2) // XY평면 -> XZ평면(지면). theta=0 은 아직 +X.
  geo.rotateY(-Math.PI / 2) // theta=0 을 +Z(정면)으로 회전
  return geo
}

export class Visuals {
  private readonly items = new Map<number, Visual>()
  private readonly query = defineQuery(Transform, Renderable)

  // 지오메트리는 모든 엔티티가 공유합니다(메모리/드로우콜 절약).
  // 머티리얼만 개체별로 복제 — 피격 플래시를 개별로 켜야 하기 때문입니다.
  private readonly playerGeo: THREE.CapsuleGeometry
  private readonly gruntGeo: THREE.CapsuleGeometry
  private readonly bladeGeo: THREE.BoxGeometry
  private readonly telegraphGeo: THREE.BufferGeometry
  private readonly hpBarGeo: THREE.PlaneGeometry

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    this.playerGeo = new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2, 6, 14)
    this.gruntGeo = new THREE.CapsuleGeometry(GRUNT.radius, GRUNT.height - GRUNT.radius * 2, 6, 12)
    this.bladeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.95)
    this.telegraphGeo = makeTelegraphGeometry(GRUNT.attackReach, GRUNT.attackArcDeg)
    // 왼쪽 끝을 고정한 채 오른쪽으로 자라도록 지오메트리를 +X 쪽으로 밀어 둡니다.
    this.hpBarGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0)
  }

  attach(entity: number, kind: number): void {
    if (this.items.has(entity)) return
    const group = new THREE.Group()

    const isPlayer = kind === KIND_PLAYER
    const baseColor = new THREE.Color(isPlayer ? 0x5fa8ff : 0xc0453f)
    const material = new THREE.MeshStandardMaterial({
      color: baseColor.clone(),
      roughness: 0.55,
      metalness: 0.08,
      emissive: new THREE.Color(0x000000),
    })

    const geo = isPlayer ? this.playerGeo : this.gruntGeo
    const height = isPlayer ? PLAYER.height : GRUNT.height
    const body = new THREE.Mesh(geo, material)
    body.position.y = height / 2
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    // 정면 표시용 막대. 도형 프로토타입에서 "어디를 보고 있는지"를 알려주는
    // 유일한 단서라, 없으면 조준이 전혀 안 됩니다.
    const blade = new THREE.Mesh(
      this.bladeGeo,
      new THREE.MeshStandardMaterial({
        color: isPlayer ? 0xe8f0ff : 0x2a1d1c,
        roughness: 0.3,
        metalness: 0.6,
      }),
    )
    blade.position.set(isPlayer ? 0.32 : 0.3, height * 0.55, 0.55)
    blade.castShadow = true
    group.add(blade)

    const visual: Visual = { group, body, material, baseColor }

    if (!isPlayer) {
      const telegraphMat = new THREE.MeshBasicMaterial({
        color: 0xff5a3c,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const telegraph = new THREE.Mesh(this.telegraphGeo, telegraphMat)
      telegraph.position.y = 0.04
      telegraph.renderOrder = 1
      telegraph.visible = false
      group.add(telegraph)
      visual.telegraph = telegraph
      visual.telegraphMat = telegraphMat

      const hpBar = new THREE.Group()
      hpBar.position.y = height + 0.42
      const barW = 1.1
      const bg = new THREE.Mesh(
        this.hpBarGeo,
        new THREE.MeshBasicMaterial({ color: 0x14181f, depthTest: false, transparent: true, opacity: 0.8 }),
      )
      bg.scale.set(barW, 0.13, 1)
      bg.position.x = -barW / 2
      bg.renderOrder = 10
      const fill = new THREE.Mesh(
        this.hpBarGeo,
        new THREE.MeshBasicMaterial({ color: 0xe8503c, depthTest: false }),
      )
      fill.scale.set(barW, 0.1, 1)
      fill.position.set(-barW / 2, 0, 0.001)
      fill.renderOrder = 11
      hpBar.add(bg, fill)
      group.add(hpBar)
      visual.hpBar = hpBar
      visual.hpFill = fill
    }

    this.scene.add(group)
    this.items.set(entity, visual)
  }

  detach(entity: number): void {
    const v = this.items.get(entity)
    if (!v) return
    this.scene.remove(v.group)
    v.material.dispose()
    v.telegraphMat?.dispose()
    this.items.delete(entity)
  }

  /** 매 프레임 호출. ECS의 숫자를 읽어 화면에 반영합니다. */
  sync(): void {
    const ids = this.query.run()
    for (let i = 0; i < this.query.count; i++) {
      const e = ids[i]
      const v = this.items.get(e)
      if (!v) continue

      v.group.position.set(Transform.x[e], Transform.y[e], Transform.z[e])
      v.group.rotation.y = Transform.rotY[e]

      // 피격 플래시 — 흰색 발광을 순간적으로 올렸다가 감쇠시킵니다.
      // 데미지 숫자보다 훨씬 빠르게 읽히는 "맞았다" 신호입니다.
      const flash = Math.max(0, Health.flashT[e]) / 0.12
      if (flash > 0) {
        const k = Math.min(1, flash)
        v.material.emissive.setRGB(k, k * 0.85, k * 0.7)
      } else if (v.material.emissive.r !== 0) {
        v.material.emissive.setRGB(0, 0, 0)
      }

      // 적 예고 부채꼴: windup 동안 서서히 진해집니다.
      // 이 연출이 있어야 "보고 구르는" 소울라이크식 전투가 성립합니다.
      if (v.telegraph && v.telegraphMat) {
        const winding = Actor.state[e] === ActorState.Attack && Actor.phase[e] === AttackPhase.Windup
        const striking = Actor.state[e] === ActorState.Attack && Actor.phase[e] === AttackPhase.Active
        if (winding) {
          const p = 1 - Actor.timer[e] / GRUNT.windup // 0 -> 1
          v.telegraph.visible = true
          v.telegraphMat.opacity = 0.12 + p * 0.42
          v.telegraphMat.color.setHex(0xff5a3c)
        } else if (striking) {
          v.telegraph.visible = true
          v.telegraphMat.opacity = 0.75
          v.telegraphMat.color.setHex(0xfff0d0)
        } else if (v.telegraph.visible) {
          v.telegraph.visible = false
          v.telegraphMat.opacity = 0
        }
      }

      if (v.hpBar && v.hpFill) {
        const ratio = Math.max(0, Health.hp[e]) / Health.max[e]
        v.hpBar.visible = ratio < 0.999
        v.hpFill.scale.x = 1.1 * ratio
        // 빌보드 — 카메라를 향해 항상 정면
        v.hpBar.quaternion.copy(this.camera.quaternion)
      }
    }
  }

  dispose(): void {
    for (const e of [...this.items.keys()]) this.detach(e)
    this.playerGeo.dispose()
    this.gruntGeo.dispose()
    this.bladeGeo.dispose()
    this.telegraphGeo.dispose()
    this.hpBarGeo.dispose()
  }
}

export { KIND_GRUNT, KIND_PLAYER }
