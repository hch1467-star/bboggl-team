import * as THREE from 'three'
import {
  CELL_SIZE,
  HEIGHT_STEP,
  MAX_CLIMB,
  VOID,
  type LevelData,
  worldToCell,
} from './format'

/**
 * 높이맵 지형 — 충돌 질의 + 메시 생성.
 *
 * 메시를 **높이 단계별로 따로** 만듭니다. 이유는 쿼터뷰의 고질병인 '가림' 때문입니다.
 * 고정 각도라서 플레이어보다 높은 지형이 캐릭터를 통째로 가려버립니다.
 * 층을 나눠 두면 "플레이어보다 2단계 이상 높은 층"만 반투명으로 낮출 수 있습니다.
 * (디아블로2가 캐릭터와 겹치는 벽 전체를 페이드시킨 것과 같은 접근입니다.)
 */
export class Terrain {
  readonly maxLevel: number
  private readonly layers: THREE.Mesh[] = []
  private readonly layerMaterials: THREE.MeshStandardMaterial[] = []
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
   * 플레이어보다 훨씬 높은 층을 반투명으로 만듭니다.
   * @param playerLevel 플레이어가 서 있는 높이 단계
   */
  applyOcclusionFade(playerLevel: number): void {
    for (let lvl = 0; lvl < this.layerMaterials.length; lvl++) {
      const mat = this.layerMaterials[lvl]
      if (!mat) continue
      // 2단계 이상 높은 층만 낮춥니다. 1단계 차이는 눈높이 정도라 가리지 않습니다.
      const occluding = lvl >= playerLevel + 2
      const target = occluding ? 0.26 : 1
      if (mat.opacity !== target) {
        mat.opacity = target
        mat.transparent = target < 1
        mat.depthWrite = target >= 1
        mat.needsUpdate = true
      }
    }
  }

  dispose(): void {
    // 비어 있는 높이 단계는 자리만 채워 둔 빈 칸(undefined)입니다.
    // 인덱스를 높이 단계와 1:1로 맞추기 위한 것이라, 정리할 때 반드시 걸러야 합니다.
    // (이걸 빼먹어서 에디터에서 지형을 고칠 때마다 크래시가 났습니다.)
    for (const mesh of this.layers) {
      if (!mesh) continue
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.layers.length = 0
    this.layerMaterials.length = 0
    this.group.clear()
  }

  private build(): void {
    const { w, h } = this.level

    // 높이 단계별로 정점을 모읍니다.
    const buckets: { pos: number[]; norm: number[]; col: number[]; idx: number[] }[] = []
    for (let i = 0; i <= this.maxLevel; i++) {
      buckets.push({ pos: [], norm: [], col: [], idx: [] })
    }

    const half = CELL_SIZE / 2
    const originX = (-w / 2) * CELL_SIZE
    const originZ = (-h / 2) * CELL_SIZE

    for (let cz = 0; cz < h; cz++) {
      for (let cx = 0; cx < w; cx++) {
        const lvl = this.levelAtCell(cx, cz)
        if (lvl === VOID) continue

        const b = buckets[lvl]
        const y = lvl * HEIGHT_STEP
        const x0 = originX + cx * CELL_SIZE
        const x1 = x0 + CELL_SIZE
        const z0 = originZ + cz * CELL_SIZE
        const z1 = z0 + CELL_SIZE

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

    void half

    for (let lvl = 0; lvl < buckets.length; lvl++) {
      const b = buckets[lvl]
      if (b.pos.length === 0) {
        this.layers.push(undefined as unknown as THREE.Mesh)
        this.layerMaterials.push(undefined as unknown as THREE.MeshStandardMaterial)
        continue
      }
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
      this.layers.push(mesh)
      this.layerMaterials.push(mat)
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

type Bucket = { pos: number[]; norm: number[]; col: number[]; idx: number[] }

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
