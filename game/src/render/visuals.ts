import * as THREE from 'three'
import { WEAPONS } from '../config/arsenal'
import { BOSS, COMBAT, GRUNT, PLAYER, TREASURE } from '../config/balance'
import {
  Actor,
  ActorState,
  AttackPhase,
  Health,
  Loadout,
  Pickup,
  Renderable,
  Transform,
} from '../core/components'
import { defineQuery, hasComponent } from '../core/ecs'
import { time } from '../core/time'

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
 */

export const KIND_PLAYER = 0
export const KIND_GRUNT = 1
export const KIND_TREASURE = 2
export const KIND_BOSS = 3

interface Visual {
  group: THREE.Group
  material: THREE.MeshStandardMaterial
  /**
   * 무기를 휘두르는 축.
   *
   * 무기를 이 노드의 자식으로 달고 노드를 돌리면, 캐릭터를 중심으로 무기가
   * 호를 그립니다. 플레이 테스트 피드백("무기 차이가 안 느껴진다")의 핵심 원인이
   * 이것이 없었던 것입니다 — 막대가 몸에 붙어 있기만 하고 **움직이지 않으니**
   * 대검이든 단검이든 화면상 완전히 같아 보였습니다.
   */
  swingPivot?: THREE.Group
  /** 무기별 모델. 플레이어는 3개를 만들어 두고 보이기/숨기기로 교체합니다. */
  weaponModels?: THREE.Group[]
  /** 적이 공격을 준비할 때 지면에 뜨는 예고 부채꼴 */
  telegraph?: THREE.Mesh
  telegraphMat?: THREE.MeshBasicMaterial
  telegraphWindup: number
  /** 머리 위 체력바 (적 전용) */
  hpBar?: THREE.Group
  hpFill?: THREE.Mesh
  /** 등 뒤(백어택) 구역 표시 */
  backZone?: THREE.Mesh
  backZoneMat?: THREE.MeshBasicMaterial
  /** 보물 등 둥둥 뜨는 오브젝트 */
  floats: boolean
  /** 멀리서도 보이는 빛기둥 (보물 전용) */
  pillar?: THREE.Mesh
  pillarMat?: THREE.MeshBasicMaterial
}

/** 부채꼴 예고 지오메트리. 부채꼴 중심이 로컬 +Z를 향하도록 미리 눕혀 둡니다. */
function makeSectorGeometry(inner: number, outer: number, arcDeg: number): THREE.BufferGeometry {
  const arc = (arcDeg * Math.PI) / 180
  const geo = new THREE.RingGeometry(inner, outer, 44, 1, -arc / 2, arc)
  geo.rotateX(-Math.PI / 2) // XY평면 -> XZ평면(지면). theta=0 은 아직 +X.
  geo.rotateY(-Math.PI / 2) // theta=0 을 +Z(정면)으로 회전
  return geo
}

/** 빛기둥의 높이(m). 카메라가 세로로 22m를 담으므로, 이보다 크면 화면을 가로막습니다. */
const PILLAR_HEIGHT = 8.5

/** 이 거리를 넘어가면 안개에 묻혀 어차피 안 보입니다. 그리지 않습니다. */
const PILLAR_MAX_DIST = 68

/**
 * 보물 빛기둥 지오메트리.
 *
 * 첫 판은 26m짜리 양면(DoubleSide) 원통이었는데, 두 가지가 한꺼번에 망가졌습니다.
 *  1) **화면을 가로막습니다.** 화면 세로가 22m인데 기둥이 26m라 전봇대처럼 서서
 *     그 뒤의 지형과 적을 못 보게 됩니다. 단서여야 할 것이 장애물이 됐습니다.
 *  2) **소프트웨어 렌더링이 무릎 꿇습니다.** 반투명은 조기 깊이 판정(early-z)이
 *     안 먹어서 덮은 픽셀을 전부 칠합니다. 양면이라 두 번씩. 보물 17개짜리
 *     레벨에서 9fps까지 떨어졌습니다.
 *
 * 그래서: 짧게(8.5m) · 얇게 · **뒷면만**(BackSide — 원통 안쪽 벽이 보여
 * 가장자리가 밝고 가운데가 은은한 자연스러운 광채가 됩니다) 그립니다.
 * 위로 갈수록 사라지는 것은 **정점 색**으로 처리합니다. 가산 합성에서는
 * 검정이 곧 투명이라 셰이더를 따로 쓰지 않고도 부드럽게 흩어집니다.
 */
function makePillarGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.16, 0.3, PILLAR_HEIGHT, 8, 6, true)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    // y는 -H/2 ~ +H/2. 아래를 1, 위를 0으로. 제곱해서 밑동에 빛을 모읍니다.
    const t = 1 - (pos.getY(i) / PILLAR_HEIGHT + 0.5)
    const v = t * t
    colors[i * 3] = v
    colors[i * 3 + 1] = v
    colors[i * 3 + 2] = v
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

/**
 * 무기 모델. 도형이지만 **길이·두께·개수가 확실히 달라야** 합니다.
 * 손에 든 것이 눈에 달라 보이지 않으면 무기를 바꾼 의미가 없습니다.
 *
 * ── 왜 실제 칼보다 두꺼운가 ────────────────────────────────────────
 * 카메라가 세로 22m를 690px에 담으므로 **1m ≈ 31px** 입니다. 진짜 단검 두께인
 * 0.07m는 화면에서 2px — 사실상 안 보입니다. 첫 판이 정확히 그랬습니다.
 * 쌍단검을 들어도 맨몸 캡슐과 구분이 안 됐습니다.
 * 쿼터뷰에서는 **읽히는 것이 사실적인 것보다 먼저**입니다. 캐릭터를 캡슐로
 * 두는 것과 같은 이유입니다.
 *
 * ── 왜 metalness를 낮췄는가 ───────────────────────────────────────
 * 금속의 밝기는 **주변을 반사해서** 나옵니다. 환경맵(envMap)이 없는 씬에서
 * metalness를 올리면 반사할 것이 없어 오히려 **검게** 가라앉습니다.
 * 에셋을 붙이기 전까지는 금속기를 낮추고 확산광으로 밝기를 버는 편이 맞습니다.
 */
function makeWeaponModel(weaponId: string): THREE.Group {
  const g = new THREE.Group()
  const steel = new THREE.MeshStandardMaterial({ color: 0xeaf1fb, roughness: 0.42, metalness: 0.25 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x4b5568, roughness: 0.6, metalness: 0.2 })

  if (weaponId === 'greatsword') {
    // 대검 — 길고 두껍고 무겁게. 십자 가드까지 붙여 실루엣을 확실히 다르게.
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.11, 2.1), steel)
    blade.position.z = 1.05
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.13, 0.15), dark)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.5), dark)
    grip.position.z = -0.26
    g.add(blade, guard, grip)
  } else if (weaponId === 'daggers') {
    // 쌍단검 — 짧은 날 두 자루.
    // "두 개"와 **벌어진 폭**이 가장 강한 시각 신호입니다. 길이로는 롱소드를
    // 절대 못 이기므로, 대신 좌우로 넓게 벌려 실루엣을 다르게 만듭니다.
    for (const side of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.72), steel)
      blade.position.set(side * 0.34, 0, 0.38)
      blade.rotation.y = side * -0.16 // 바깥으로 살짝 벌어진 자세
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.26), dark)
      grip.position.set(side * 0.34, 0, -0.06)
      g.add(blade, grip)
    }
  } else {
    // 롱소드 — 기준이 되는 중간 크기
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 1.25), steel)
    blade.position.z = 0.65
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.12), dark)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.32), dark)
    grip.position.z = -0.18
    g.add(blade, guard, grip)
  }

  for (const child of g.children) child.castShadow = true
  return g
}

/** 무기를 든 팔이 쉬는 자세(라디안). 몸 오른쪽에 비스듬히 내려둔 상태. */
const REST_SWING = 0.75
const REST_TILT = 0.25

export class Visuals {
  private readonly items = new Map<number, Visual>()
  private readonly query = defineQuery(Transform, Renderable)

  private readonly geos: Record<number, THREE.BufferGeometry>
  private readonly telegraphGeos: Record<number, THREE.BufferGeometry>
  private readonly backZoneGeos: Record<number, THREE.BufferGeometry>
  private readonly hpBarGeo: THREE.PlaneGeometry
  private readonly pillarGeo: THREE.BufferGeometry

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    this.geos = {
      [KIND_PLAYER]: new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2, 6, 14),
      [KIND_GRUNT]: new THREE.CapsuleGeometry(GRUNT.radius, GRUNT.height - GRUNT.radius * 2, 6, 12),
      [KIND_BOSS]: new THREE.CapsuleGeometry(BOSS.radius, BOSS.height - BOSS.radius * 2, 8, 16),
      [KIND_TREASURE]: new THREE.OctahedronGeometry(0.42),
    }
    this.telegraphGeos = {
      [KIND_GRUNT]: makeSectorGeometry(0.35, GRUNT.attackReach, GRUNT.attackArcDeg),
      [KIND_BOSS]: makeSectorGeometry(0.35, BOSS.attackReach, BOSS.attackArcDeg),
    }
    this.backZoneGeos = {
      [KIND_GRUNT]: makeSectorGeometry(GRUNT.radius + 0.1, GRUNT.radius + 1.15, COMBAT.backArcDeg),
      [KIND_BOSS]: makeSectorGeometry(BOSS.radius + 0.1, BOSS.radius + 1.5, COMBAT.backArcDeg),
    }
    this.hpBarGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0)
    this.pillarGeo = makePillarGeometry()
  }

  attach(entity: number, kind: number): void {
    if (this.items.has(entity)) return
    const group = new THREE.Group()

    if (kind === KIND_TREASURE) {
      this.attachTreasure(entity, group)
      return
    }

    const isPlayer = kind === KIND_PLAYER
    const isBoss = kind === KIND_BOSS
    const cfg = isPlayer ? PLAYER : isBoss ? BOSS : GRUNT
    const baseColor = new THREE.Color(isPlayer ? 0x5fa8ff : isBoss ? 0x9b4ad6 : 0xc0453f)
    const material = new THREE.MeshStandardMaterial({
      color: baseColor.clone(),
      roughness: 0.55,
      metalness: 0.08,
      emissive: new THREE.Color(0x000000),
    })

    const body = new THREE.Mesh(this.geos[kind], material)
    body.position.y = cfg.height / 2
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    // 무기를 휘두르는 축 — 어깨 높이에 둡니다.
    const swingPivot = new THREE.Group()
    swingPivot.position.y = cfg.height * 0.62
    group.add(swingPivot)

    const visual: Visual = { group, material, floats: false, telegraphWindup: 0, swingPivot }

    if (isPlayer) {
      // 무기 3종을 미리 만들어 두고 보이기/숨기기로 교체합니다(교체가 즉각적입니다).
      visual.weaponModels = WEAPONS.map((w) => {
        const model = makeWeaponModel(w.id)
        model.visible = false
        swingPivot.add(model)
        return model
      })
    } else {
      const scale = isBoss ? 1.8 : 1
      const club = new THREE.Mesh(
        new THREE.BoxGeometry(0.16 * scale, 0.16 * scale, 1.1 * scale),
        new THREE.MeshStandardMaterial({ color: 0x2a1d1c, roughness: 0.75, metalness: 0.2 }),
      )
      club.position.z = 0.55 * scale
      club.castShadow = true
      swingPivot.add(club)

      const telegraphMat = new THREE.MeshBasicMaterial({
        color: 0xff5a3c,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const telegraph = new THREE.Mesh(this.telegraphGeos[kind], telegraphMat)
      telegraph.position.y = 0.04
      telegraph.renderOrder = 1
      telegraph.visible = false
      group.add(telegraph)
      visual.telegraph = telegraph
      visual.telegraphMat = telegraphMat
      visual.telegraphWindup = isBoss ? BOSS.windup : GRUNT.windup

      // 등 뒤 구역 — 그룹의 로컬 +Z가 정면이므로 180° 돌려 후방을 향하게 합니다.
      const backZoneMat = new THREE.MeshBasicMaterial({
        color: 0xffc14a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const backZone = new THREE.Mesh(this.backZoneGeos[kind], backZoneMat)
      backZone.rotation.y = Math.PI
      backZone.position.y = 0.05
      backZone.renderOrder = 3
      backZone.visible = false
      group.add(backZone)
      visual.backZone = backZone
      visual.backZoneMat = backZoneMat

      const hpBar = new THREE.Group()
      hpBar.position.y = cfg.height + 0.42
      const barW = isBoss ? 2.2 : 1.1
      const bg = new THREE.Mesh(
        this.hpBarGeo,
        new THREE.MeshBasicMaterial({ color: 0x14181f, depthTest: false, transparent: true, opacity: 0.8 }),
      )
      bg.scale.set(barW, isBoss ? 0.2 : 0.13, 1)
      bg.position.x = -barW / 2
      bg.renderOrder = 10
      const fill = new THREE.Mesh(
        this.hpBarGeo,
        new THREE.MeshBasicMaterial({ color: isBoss ? 0xd23ce8 : 0xe8503c, depthTest: false }),
      )
      fill.scale.set(barW, isBoss ? 0.16 : 0.1, 1)
      fill.position.set(-barW / 2, 0, 0.001)
      fill.renderOrder = 11
      hpBar.add(bg, fill)
      group.add(hpBar)
      visual.hpBar = hpBar
      visual.hpFill = fill
      visual.group.userData.barWidth = barW
    }

    this.scene.add(group)
    this.items.set(entity, visual)
  }

  private attachTreasure(entity: number, group: THREE.Group): void {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffd479,
      emissive: new THREE.Color(0xffa93c),
      emissiveIntensity: 0.85,
      roughness: 0.25,
      metalness: 0.65,
    })
    const mesh = new THREE.Mesh(this.geos[KIND_TREASURE], material)
    mesh.castShadow = true
    group.add(mesh)

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.72, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffd479,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    halo.rotation.x = -Math.PI / 2
    halo.position.y = -0.85
    group.add(halo)

    /**
     * 빛기둥 — **멀리서도 보이는 유일한 단서**입니다.
     *
     * 플레이 테스트 피드백: "어디에 뭐가 있는지 목표가 없으니 눈앞의 적만 잡게 된다."
     * 미니맵은 쓰지 않기로 했으므로(DESIGN.md 기둥 4), 대신 **월드 안에서** 알려줍니다.
     * 오공이 미니맵 없이 조명과 랜드마크로 길을 안내한 것과 같은 방식입니다.
     */
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0xffc14a,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      vertexColors: true,
    })
    const pillar = new THREE.Mesh(this.pillarGeo, pillarMat)
    pillar.position.y = PILLAR_HEIGHT / 2 - 0.6
    pillar.renderOrder = 5
    group.add(pillar)

    this.scene.add(group)
    this.items.set(entity, {
      group,
      material,
      floats: true,
      telegraphWindup: 0,
      pillar,
      pillarMat,
    })
  }

  detach(entity: number): void {
    const v = this.items.get(entity)
    if (!v) return
    this.scene.remove(v.group)
    v.material.dispose()
    v.telegraphMat?.dispose()
    v.backZoneMat?.dispose()
    v.pillarMat?.dispose()
    this.items.delete(entity)
  }

  /**
   * 매 프레임 호출. ECS의 숫자를 읽어 화면에 반영합니다.
   * @param playerX,playerZ 등 뒤 표시·빛기둥 감쇠 판단에 쓰는 플레이어 위치
   */
  sync(playerX: number, playerZ: number): void {
    const ids = this.query.run()
    for (let i = 0; i < this.query.count; i++) {
      const e = ids[i]
      const v = this.items.get(e)
      if (!v) continue

      if (v.floats) {
        this.syncTreasure(e, v, playerX, playerZ)
        continue
      }

      v.group.position.set(Transform.x[e], Transform.y[e], Transform.z[e])
      v.group.rotation.y = Transform.rotY[e]

      this.syncSwing(e, v)

      // 피격 플래시 — 흰색 발광을 순간적으로 올렸다가 감쇠시킵니다.
      const flash = Math.max(0, Health.flashT[e]) / 0.12
      if (flash > 0) {
        const k = Math.min(1, flash)
        v.material.emissive.setRGB(k, k * 0.85, k * 0.7)
      } else if (v.material.emissive.r !== 0) {
        v.material.emissive.setRGB(0, 0, 0)
      }

      if (v.telegraph && v.telegraphMat) {
        const winding = Actor.state[e] === ActorState.Attack && Actor.phase[e] === AttackPhase.Windup
        const striking = Actor.state[e] === ActorState.Attack && Actor.phase[e] === AttackPhase.Active
        if (winding) {
          const p = 1 - Actor.timer[e] / v.telegraphWindup // 0 -> 1
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

      // 등 뒤 구역: 가까이 갈수록 진해집니다. 멀면 아예 안 보입니다.
      if (v.backZone && v.backZoneMat) {
        const d = Math.hypot(Transform.x[e] - playerX, Transform.z[e] - playerZ)
        const near = d < COMBAT.backIndicatorRange && Actor.state[e] !== ActorState.Dead
        v.backZone.visible = near
        if (near) v.backZoneMat.opacity = 0.42 * (1 - d / COMBAT.backIndicatorRange)
      }

      if (v.hpBar && v.hpFill) {
        const ratio = Math.max(0, Health.hp[e]) / Health.max[e]
        v.hpBar.visible = ratio < 0.999
        v.hpFill.scale.x = (v.group.userData.barWidth as number) * ratio
        v.hpBar.quaternion.copy(this.camera.quaternion)
      }
    }
  }

  private syncTreasure(e: number, v: Visual, playerX: number, playerZ: number): void {
    const phase = hasComponent(Pickup, e) ? Pickup.phase[e] : 0
    const bob = Math.sin(time.elapsed * TREASURE.bobSpeed + phase) * TREASURE.bobHeight
    v.group.position.set(Transform.x[e], Transform.y[e] + 1.05 + bob, Transform.z[e])
    v.group.rotation.y = time.elapsed * TREASURE.spinSpeed + phase

    // 빛기둥은 멀 때 진하고 가까우면 옅어집니다. 바로 앞에서까지 기둥이 서 있으면
    // 정작 보물 자체가 안 보입니다.
    //
    // 그룹이 위아래로 둥둥 뜨므로, 기둥은 그만큼 반대로 내려 **땅에 박아 둡니다.**
    // 기둥까지 같이 떠다니면 밑동이 공중에 떠서 단서가 아니라 UFO처럼 보입니다.
    if (v.pillar && v.pillarMat) {
      const d = Math.hypot(Transform.x[e] - playerX, Transform.z[e] - playerZ)
      // 안개 far 밖의 기둥은 어차피 안 보입니다. 그리지 않으면 그만큼 공짜입니다.
      const visible = d > 4 && d < PILLAR_MAX_DIST
      v.pillar.visible = visible
      if (visible) {
        const far = Math.min(1, Math.max(0, (d - 6) / 14))
        v.pillarMat.opacity = 0.12 + far * 0.34
        v.pillar.position.y = PILLAR_HEIGHT / 2 - (v.group.position.y - Transform.y[e])
      }
    }
  }

  /**
   * 무기를 휘두르는 동작.
   *
   * 3단계(선행동작 → 판정 → 후딜)를 그대로 몸짓으로 옮깁니다:
   *   windup   — 뒤로 크게 젖히며 들어올림 (느린 무기일수록 크게 젖혀짐)
   *   active   — 부채꼴 각도만큼 단숨에 훑음  ← 실제 판정 각도와 **같은 각도**
   *   recovery — 휘두른 자세에서 천천히 원위치
   *
   * "판정 각도와 같은 각도로 휘두른다"가 핵심입니다. 대검이 175°를 훑고
   * 단검이 95°만 찌르는 것이 눈에 보여야 무기가 다르다고 느껴집니다.
   */
  private syncSwing(e: number, v: Visual): void {
    const pivot = v.swingPivot
    if (!pivot) return

    // 플레이어는 장착 무기 모델을 갈아 끼웁니다.
    if (v.weaponModels && hasComponent(Loadout, e)) {
      const idx = Math.min(Loadout.weapon[e], v.weaponModels.length - 1)
      for (let i = 0; i < v.weaponModels.length; i++) v.weaponModels[i].visible = i === idx
    }

    const state = Actor.state[e] as ActorState
    const attacking = state === ActorState.Attack || state === ActorState.Skill
    if (!attacking) {
      // 쉬는 자세로 부드럽게 복귀
      const k = 1 - Math.exp(-11 * time.realDt)
      pivot.rotation.y += (REST_SWING - pivot.rotation.y) * k
      pivot.rotation.x += (REST_TILT - pivot.rotation.x) * k
      return
    }

    const arc = this.swingArcOf(e)
    const half = arc / 2
    const phase = Actor.phase[e] as AttackPhase
    const total = this.phaseDurationOf(e, phase)
    // 남은 시간 -> 진행도 0..1
    const t = total > 0 ? Math.min(1, Math.max(0, 1 - Actor.timer[e] / total)) : 1

    if (phase === AttackPhase.Windup) {
      // 뒤로 젖히기. 부채꼴이 넓은 무기일수록 더 크게 젖힙니다.
      const from = pivot.rotation.y
      const to = -half - 0.35
      pivot.rotation.y = from + (to - from) * Math.min(1, t * 1.8)
      pivot.rotation.x = -0.55 * t + REST_TILT * (1 - t)
    } else if (phase === AttackPhase.Active) {
      // 단숨에 훑기 — 실제 판정 부채꼴과 같은 각도를 지나갑니다.
      const eased = t * t * (3 - 2 * t) // smoothstep: 시작과 끝이 부드럽게
      pivot.rotation.y = -half - 0.35 + (arc + 0.35) * eased
      pivot.rotation.x = -0.55 + 0.75 * eased
    } else {
      // 후딜 — 휘두른 자세에서 천천히 원위치
      const k = 1 - Math.exp(-7 * time.realDt)
      pivot.rotation.y += (REST_SWING - pivot.rotation.y) * k
      pivot.rotation.x += (REST_TILT - pivot.rotation.x) * k
    }
  }

  /** 지금 휘두르는 공격의 부채꼴 각도(라디안). */
  private swingArcOf(e: number): number {
    if (hasComponent(Loadout, e)) {
      const weapon = WEAPONS[Math.min(Loadout.weapon[e], WEAPONS.length - 1)]
      const step = weapon.combo[Math.min(Actor.comboIndex[e], weapon.combo.length - 1)]
      return (step.arcDeg * Math.PI) / 180
    }
    const deg = Renderable.kind[e] === KIND_BOSS ? BOSS.attackArcDeg : GRUNT.attackArcDeg
    return (deg * Math.PI) / 180
  }

  private phaseDurationOf(e: number, phase: AttackPhase): number {
    if (hasComponent(Loadout, e)) {
      const weapon = WEAPONS[Math.min(Loadout.weapon[e], WEAPONS.length - 1)]
      const step = weapon.combo[Math.min(Actor.comboIndex[e], weapon.combo.length - 1)]
      return phase === AttackPhase.Windup ? step.windup : phase === AttackPhase.Active ? step.active : step.recovery
    }
    const cfg = Renderable.kind[e] === KIND_BOSS ? BOSS : GRUNT
    return phase === AttackPhase.Windup ? cfg.windup : phase === AttackPhase.Active ? cfg.active : cfg.recovery
  }

  dispose(): void {
    for (const e of [...this.items.keys()]) this.detach(e)
    for (const geo of Object.values(this.geos)) geo.dispose()
    for (const geo of Object.values(this.telegraphGeos)) geo.dispose()
    for (const geo of Object.values(this.backZoneGeos)) geo.dispose()
    this.hpBarGeo.dispose()
    this.pillarGeo.dispose()
  }
}
