import * as THREE from 'three'
import {
  CELL_SIZE,
  HEIGHT_STEP,
  MAX_CLIMB,
  VOID,
  type LevelData,
  worldToCell,
} from './format'

/** 청크 한 변의 칸 수. 24m 단위 — 너무 크면 페이드가 뭉툭하고, 너무 작으면 드로우콜이 폭증합니다. */
const CHUNK = 12

/** 이 거리 안의 높은 덩어리만 반투명 대상이 됩니다(m). */
const OCCLUSION_RANGE = 26

interface Chunk {
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  level: number
  /** 청크 중심의 월드 좌표 */
  cx: number
  cz: number
}

/**
 * 높이맵 지형 — 충돌 질의 + 메시 생성.
 *
 * 메시를 **(높이 단계 × 청크)** 로 쪼개 만듭니다. 쿼터뷰의 고질병인 '가림' 때문입니다.
 * 고정 각도라서 플레이어보다 높은 지형이 캐릭터를 통째로 가려버립니다.
 *
 * 처음에는 높이 단계별로만 나눠서 "플레이어보다 2단 이상 높은 층"을 통째로
 * 반투명하게 만들었는데, 그러면 **저 멀리 있는 성벽까지 전부 흐려져서**
 * 세계가 경계 없는 판때기처럼 보였습니다(실제 스크린샷에서 확인).
 *
 * 청크로 쪼개면 "플레이어 근처에 있고, 카메라와 플레이어 **사이**에 있고,
 * 플레이어보다 높은" 덩어리만 골라 낮출 수 있습니다. 이게 실제로 가리는 것들입니다.
 * (디아블로2가 캐릭터와 겹치는 벽만 페이드시킨 것과 같은 접근입니다.)
 */
export class Terrain {
  readonly maxLevel: number
  private readonly chunks: Chunk[] = []
  readonly group = new THREE.Group()

  constructor(readonly level: LevelData) {
    let max = 0
    for (const v of level.heights) if (v > max) max = v
    this.maxLevel = max
    this.build()
  }

  // ---- 질의 -------------------------------------------------------------

  /** 격자 좌표의 높이 단계. 범위 밖은 VOID. */
  levelAtCell(cx: number, cz: number): number {
    const { w, h, heights } = this.level
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return VOID
    return heights[cz * w + cx]
  }

  /** 월드 좌표의 높이 단계. */
  levelAtWorld(x: number, z: number): number {
    const { cx, cz } = worldToCell(x, z, this.level.w, this.level.h)
    return this.levelAtCell(cx, cz)
  }

  /** 월드 좌표의 지면 높이(m). 바닥이 없으면 0을 돌려주되, 보행 판정은 따로 하세요. */
  groundYAt(x: number, z: number): number {
    const lvl = this.levelAtWorld(x, z)
    return lvl === VOID ? 0 : lvl * HEIGHT_STEP
  }

  isWalkable(x: number, z: number): boolean {
    return this.levelAtWorld(x, z) !== VOID
  }

  /**
   * from 위치에서 to 위치로 걸어갈 수 있는가.
   *
   * 두 가지를 막습니다:
   *  1) 바닥 없는 칸(낭떠러지)으로 걸어 들어가기
   *  2) MAX_CLIMB 를 넘는 단차 **올라가기**
   *
   * 내려가는 건 항상 허용합니다 — 절벽에서 뛰어내리는 건 되지만 기어오르는 건
   * 안 되는 것이, 와이드 리니어 레벨에서 **일방통행 지름길**을 만드는 핵심 장치입니다.
   * (오공/소울라이크가 되돌아가는 길을 여는 방식이 바로 이것입니다.)
   */
  canWalk(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const to = this.levelAtWorld(toX, toZ)
    if (to === VOID) return false
    const from = this.levelAtWorld(fromX, fromZ)
    if (from === VOID) return true // 이미 이상한 곳에 있다면 탈출은 허용
    return to - from <= MAX_CLIMB
  }

  /**
   * 이동 벡터를 지형에 맞춰 잘라냅니다.
   * 대각선으로 벽에 부딪혔을 때 X와 Z를 따로 시도해, 벽을 따라 미끄러지게 합니다.
   * (이게 없으면 벽에 비스듬히 닿는 순간 완전히 멈춰서 조작이 답답해집니다.)
   */
  resolveMove(fromX: number, fromZ: number, toX: number, toZ: number): { x: number; z: number } {
    if (this.canWalk(fromX, fromZ, toX, toZ)) return { x: toX, z: toZ }
    if (this.canWalk(fromX, fromZ, toX, fromZ)) return { x: toX, z: fromZ }
    if (this.canWalk(fromX, fromZ, fromX, toZ)) return { x: fromX, z: toZ }
    return { x: fromX, z: fromZ }
  }

  // ---- 메시 -------------------------------------------------------------

  /**
   * 실제로 플레이어를 가리는 덩어리만 반투명으로 낮춥니다.
   *
   * 세 조건을 **모두** 만족해야 합니다:
   *   1) 플레이어보다 2단 이상 높다      (1단 차이는 눈높이라 가리지 않음)
   *   2) 플레이어에게서 가깝다           (먼 성벽까지 흐려지면 세계가 사라짐)
   *   3) 카메라와 플레이어 사이에 있다   (뒤쪽 벽은 가릴 수가 없음)
   *
   * @param camDirX,camDirZ 플레이어 -> 카메라 방향(XZ, 정규화)
   */
  applyOcclusionFade(
    playerLevel: number,
    playerX: number,
    playerZ: number,
    camDirX: number,
    camDirZ: number,
  ): void {
    for (const chunk of this.chunks) {
      const dx = chunk.cx - playerX
      const dz = chunk.cz - playerZ
      const towardCamera = dx * camDirX + dz * camDirZ
      const occluding =
        chunk.level >= playerLevel + 2 &&
        Math.hypot(dx, dz) < OCCLUSION_RANGE &&
        towardCamera > -CHUNK // 청크가 크므로 살짝 뒤쪽까지는 포함합니다

      const target = occluding ? 0.22 : 1
      const mat = chunk.material
      if (mat.opacity !== target) {
        mat.opacity = target
        mat.transparent = target < 1
        mat.depthWrite = target >= 1
        mat.needsUpdate = true
      }
    }
  }

  dispose(): void {
    for (const chunk of this.chunks) {
      chunk.mesh.geometry.dispose()
      chunk.material.dispose()
    }
    this.chunks.length = 0
    this.group.clear()
  }

  private build(): void {
    const { w, h } = this.level

    // (높이 단계, 청크) 조합별로 정점을 모읍니다. 대부분의 조합은 비어 있으므로
    // Map으로 성긴 저장을 합니다.
    const buckets = new Map<string, Bucket>()
    const bucketOf = (lvl: number, cx: number, cz: number): Bucket => {
      const key = `${lvl}|${(cx / CHUNK) | 0}|${(cz / CHUNK) | 0}`
      let b = buckets.get(key)
      if (!b) {
        b = { pos: [], norm: [], col: [], idx: [], level: lvl, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
        buckets.set(key, b)
      }
      return b
    }
    const originX = (-w / 2) * CELL_SIZE
    const originZ = (-h / 2) * CELL_SIZE

    for (let cz = 0; cz < h; cz++) {
      for (let cx = 0; cx < w; cx++) {
        const lvl = this.levelAtCell(cx, cz)
        if (lvl === VOID) continue

        const b = bucketOf(lvl, cx, cz)
        const y = lvl * HEIGHT_STEP
        const x0 = originX + cx * CELL_SIZE
        const x1 = x0 + CELL_SIZE
        const z0 = originZ + cz * CELL_SIZE
        const z1 = z0 + CELL_SIZE
        if (x0 < b.minX) b.minX = x0
        if (x1 > b.maxX) b.maxX = x1
        if (z0 < b.minZ) b.minZ = z0
        if (z1 > b.maxZ) b.maxZ = z1

        // 윗면 — 격자 체크무늬를 살짝 넣습니다. 단색이면 직교 투영에서
        // 거리감이 전혀 안 잡혀서 "얼마나 걸었는지"를 알 수 없습니다.
        const checker = (cx + cz) % 2 === 0 ? 1.07 : 0.93
        const top = this.topColor(lvl, checker)
        quad(
          b,
          [x0, y, z0],
          [x0, y, z1],
          [x1, y, z1],
          [x1, y, z0],
          [0, 1, 0],
          top,
        )

        // 옆면 — 이웃이 더 낮거나 없을 때만 그립니다(안 보이는 면을 안 만들기 위해).
        const side = this.sideColor(lvl)
        const neighbours: [number, number, 'nx' | 'px' | 'nz' | 'pz'][] = [
          [cx - 1, cz, 'nx'],
          [cx + 1, cz, 'px'],
          [cx, cz - 1, 'nz'],
          [cx, cz + 1, 'pz'],
        ]
        for (const [nx, nz, dir] of neighbours) {
          const nLvl = this.levelAtCell(nx, nz)
          if (nLvl !== VOID && nLvl >= lvl) continue
          // 이웃이 낭떠러지면 아래로 길게 내려 절벽처럼 보이게 합니다.
          const baseY = nLvl === VOID ? y - 5 : nLvl * HEIGHT_STEP
          if (baseY >= y) continue

          if (dir === 'nx') {
            quad(b, [x0, baseY, z0], [x0, baseY, z1], [x0, y, z1], [x0, y, z0], [-1, 0, 0], side)
          } else if (dir === 'px') {
            quad(b, [x1, baseY, z1], [x1, baseY, z0], [x1, y, z0], [x1, y, z1], [1, 0, 0], side)
          } else if (dir === 'nz') {
            quad(b, [x1, baseY, z0], [x0, baseY, z0], [x0, y, z0], [x1, y, z0], [0, 0, -1], side)
          } else {
            quad(b, [x0, baseY, z1], [x1, baseY, z1], [x1, y, z1], [x0, y, z1], [0, 0, 1], side)
          }
        }
      }
    }

    for (const b of buckets.values()) {
      if (b.pos.length === 0) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3))
      geo.setIndex(b.idx)
      geo.computeBoundingSphere()

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.94,
        metalness: 0,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.chunks.push({
        mesh,
        material: mat,
        level: b.level,
        cx: (b.minX + b.maxX) / 2,
        cz: (b.minZ + b.maxZ) / 2,
      })
      this.group.add(mesh)
    }
  }

  /**
   * 높이가 올라갈수록 밝아집니다 — 직교 투영에서 높이를 읽는 유일한 단서입니다.
   *
   * 값이 낮은 이유: 씬에 태양광(2.1) + 환경광(1.15) + ACES 톤매핑이 걸려 있어서,
   * 알베도를 0.4쯤 주면 화면에서는 거의 흰색으로 날아갑니다.
   * (첫 스크린샷에서 지형이 통째로 밝은 회색으로 떠서 게임의 어두운 톤과 따로 놀았습니다.)
   */
  private topColor(lvl: number, checker: number): [number, number, number] {
    const t = this.maxLevel > 0 ? lvl / this.maxLevel : 0
    const r = (0.105 + t * 0.13) * checker
    const g = (0.125 + t * 0.135) * checker
    const b = (0.165 + t * 0.13) * checker
    return [r, g, b]
  }

  private sideColor(lvl: number): [number, number, number] {
    const [r, g, b] = this.topColor(lvl, 1)
    // 옆면을 어둡게 = 값싼 앰비언트 오클루전. 단차가 훨씬 뚜렷해집니다.
    // 완전히 0으로 죽이지는 않습니다 — 새까맣게 되면 절벽의 형태 자체가 안 보입니다.
    return [r * 0.42 + 0.012, g * 0.42 + 0.014, b * 0.48 + 0.02]
  }
}

type Bucket = {
  pos: number[]
  norm: number[]
  col: number[]
  idx: number[]
  level: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** 사각형 하나를 삼각형 두 개로 밀어 넣습니다. 정점 순서가 곧 앞면 방향입니다. */
function quad(
  b: Bucket,
  a: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
  e: [number, number, number],
  normal: [number, number, number],
  color: [number, number, number],
): void {
  const base = b.pos.length / 3
  for (const v of [a, c, d, e]) {
    b.pos.push(v[0], v[1], v[2])
    b.norm.push(normal[0], normal[1], normal[2])
    b.col.push(color[0], color[1], color[2])
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
}
