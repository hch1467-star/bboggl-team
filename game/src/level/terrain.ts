import * as THREE from 'three'
import {
  CELL_SIZE,
  HEIGHT_STEP,
  MAX_CLIMB,
  VOID,
  cellToWorld,
  type LevelData,
  worldToCell,
} from './format'

/** 청크 한 변의 칸 수. 24m 단위 — 너무 크면 페이드가 뭉툭하고, 너무 작으면 드로우콜이 폭증합니다. */
const CHUNK = 12

/** 이 거리 안의 높은 덩어리만 반투명 대상이 됩니다(m). */
const OCCLUSION_RANGE = 26

/**
 * 사다리 — **일방통행 낙차를 양방향 지름길로 바꾸는 장치.**
 *
 * NRFTW의 지도가 재밌는 이유를 조사해 보면 거의 다 이 하나로 모입니다:
 * *"위에서 걷어차 내린 사다리가 아까 지나온 곳으로 이어진다."*
 * 다크소울1이 만든 **루프백 지름길**을 사다리 하나로 압축한 것입니다.
 *
 * 왜 이게 재미인가 — 지름길은 **시간을 줄여주는 편의**가 아니라 **지식의 보상**입니다.
 * 길이 짧아진 게 아니라, 내가 이 세계의 생김새를 알아냈다는 증거가 지형에 남습니다.
 * 그래서 자동으로 열리면 안 되고, **위에서만** 내릴 수 있어야 합니다:
 *   · 아래에서 올려다본 걷힌 사다리 = "저 위로 가는 길이 아직 있다"는 **말 없는 안내**
 *   · 위에서 내리는 순간 = "내가 저기서 여기까지 왔구나"라는 **연결의 확인**
 * 조사 중 가장 많이 인용된 문장이 이것이었습니다 —
 * *"닿지 않는 사다리가 보이면, 그 위쪽을 아직 다 못 본 것이다."*
 */
export interface Shortcut {
  /** 아래쪽 칸(격자) */
  loX: number
  loZ: number
  /** 위쪽 칸(격자) */
  hiX: number
  hiZ: number
  /** 두 칸의 경계 월드 좌표 — 연출과 상호작용 판정에 씁니다. */
  x: number
  z: number
  /** 아래 칸의 지면 높이(m) */
  loY: number
  /** 위 칸의 지면 높이(m) */
  hiY: number
  /** 아래에서 위로 향하는 방향(정규화 XZ) */
  dirX: number
  dirZ: number
  /** 내려져 있는가. 내려지면 양방향으로 통행 가능. */
  open: boolean
  /** 걷힌 채로 돌아갔을 때 걸어야 하는 거리(m) — `shortcutSaving` 이 채웁니다. */
  saving?: number | null
  /** 위 값이 어떤 사다리 개폐 상태에서 계산된 것인지 (캐시 무효화용) */
  savingSig?: string
  /**
   * 세이브 키 — 좌표 기반입니다.
   *
   * 배열 인덱스로 저장하면 레벨에 사다리를 하나 추가하는 순간 예전 세이브의
   * "열린 사다리"가 **다른 사다리로 조용히 옮겨갑니다.** 보스 격파 기록을
   * 좌표로 저장한 것과 같은 이유입니다.
   */
  key: string
}

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
/**
 * 옆면 밝기 배율 — 윗면 색에 곱합니다. 근거는 `sideColor` 주석.
 * 넘을 수 있는 턱은 **바닥이 이어지는 것처럼**, 벽은 **확실히 어둡게**.
 *
 * 0.85 는 "윗면 쪽에 훨씬 가깝게"라는 뜻입니다. 턱은 작은 벽이 아니라
 * **위로 이어지는 바닥**이고, 그렇게 보여야 넘어갈 수 있다고 읽힙니다.
 *
 * ⚠️ 처음엔 0.68 로 뒀는데 `npm run climb` 이 잡았습니다 — 화면에서 ΔE 9.0,
 *    기준 10 에 못 미쳤습니다. **기준을 9로 낮추지 않았습니다.** 기준은
 *    재기 전에 근거를 적어 정한 값이고, 결과를 보고 옮기면 그 순간 검사가
 *    아니라 장식이 됩니다(파랑 예고에서 한 번 저지른 실수입니다).
 */
const STEP_FACE_MIX = 0.85
const WALL_FACE_MIX = 0.22

export class Terrain {
  readonly maxLevel: number
  private readonly chunks: Chunk[] = []
  readonly group = new THREE.Group()
  /** 이 레벨의 사다리들. 레벨 데이터의 'ladder' 엔티티에서 만들어집니다. */
  readonly shortcuts: Shortcut[] = []

  /**
   * 칸마다의 구역 색조. 매 칸 구역 목록을 훑으면 88×72×10 번을 돌게 되고,
   * 지형은 레벨을 열 때 한 번 만들면 끝이라 **미리 펴 두는 쪽**이 맞습니다.
   */
  private readonly tintAt: Float32Array

  constructor(readonly level: LevelData) {
    let max = 0
    for (const v of level.heights) if (v > max) max = v
    this.maxLevel = max
    this.tintAt = new Float32Array(level.w * level.h * 3).fill(1)
    for (const r of level.regions ?? []) {
      if (!r.tint) continue
      /**
       * ── 색조에서 **밝기를 빼고** 씁니다 ────────────────────────────
       *
       * 처음엔 색조를 곱하기 그대로 썼는데, 재 보니 붙어 있는 구역이 ΔE 2~6
       * 밖에 안 벌어졌습니다. 원인은 **높이 램프와 채널이 겹치는 것**이었습니다:
       * 윗면 색은 이미 높이에 따라 밝아지는데(직교 투영에서 높이를 읽는 단서),
       * 구역 색조도 밝기를 건드리니 둘이 서로를 지웠습니다. 실측에서
       * *색조 1.00 인 낮은 구역*과 *색조 0.72 인 높은 구역*의 빨강이
       * 52 와 54 로 거의 같아졌습니다 — 정확히 상쇄된 것입니다.
       *
       * 그래서 **채널을 나눕니다: 밝기는 높이가, 색온도는 구역이 말합니다.**
       * 색조의 밝기 성분을 1로 정규화하면 구역은 밝기를 못 건드리고,
       * 남는 것은 **색의 기울기**뿐이라 높이와 섞이지 않습니다.
       *
       * ⚠️ 그래서 "보스 앞은 어둡게" 같은 것은 색조로 하면 안 됩니다. 그건
       *    조명이나 안개가 할 일입니다 — 여기서 하면 다시 높이를 지웁니다.
       */
      const lum = 0.2126 * r.tint[0] + 0.7152 * r.tint[1] + 0.0722 * r.tint[2]
      const tint: [number, number, number] =
        lum > 0.0001 ? [r.tint[0] / lum, r.tint[1] / lum, r.tint[2] / lum] : [1, 1, 1]
      for (let cz = r.z0; cz <= r.z1; cz++) {
        for (let cx = r.x0; cx <= r.x1; cx++) {
          if (cx < 0 || cz < 0 || cx >= level.w || cz >= level.h) continue
          const o = (cz * level.w + cx) * 3
          this.tintAt[o] = tint[0]
          this.tintAt[o + 1] = tint[1]
          this.tintAt[o + 2] = tint[2]
        }
      }
    }
    this.build()
    this.buildShortcuts()
  }

  // ---- 사다리 -----------------------------------------------------------

  /**
   * 'ladder' 엔티티를 통행 링크로 바꿉니다.
   *
   * 레벨에는 **아래쪽 칸에** 사다리를 놓습니다. 위쪽 칸은 이웃 넷 중 **가장 높은
   * 칸**으로 자동 결정합니다.
   *
   * 왜 방향을 데이터로 받지 않는가: 에디터에서 각도를 맞춰 놓는 일은 초보가
   * 틀리기 쉽고, 틀려도 화면에서 안 보입니다(사다리가 허공을 향해 서 있어도
   * 그럴듯해 보입니다). 지형에서 유도하면 **틀릴 수가 없습니다.**
   */
  private buildShortcuts(): void {
    const { w, h } = this.level
    for (const e of this.level.entities) {
      if (e.kind !== 'ladder') continue
      const { cx, cz } = worldToCell(e.x, e.z, w, h)
      const lo = this.levelAtCell(cx, cz)
      if (lo === VOID) {
        console.warn(`사다리가 바닥 없는 칸(${cx},${cz})에 있습니다 — 무시합니다.`)
        continue
      }
      let best = lo
      let bx = cx
      let bz = cz
      for (const [nx, nz] of [
        [cx - 1, cz],
        [cx + 1, cz],
        [cx, cz - 1],
        [cx, cz + 1],
      ]) {
        const v = this.levelAtCell(nx, nz)
        if (v !== VOID && v > best) {
          best = v
          bx = nx
          bz = nz
        }
      }
      if (best - lo <= MAX_CLIMB) {
        // 걸어서 오를 수 있는 단차에 사다리를 놓으면 아무 일도 안 합니다.
        // 조용히 두면 "왜 지름길이 안 열리지"로 몇 시간을 잃게 됩니다.
        console.warn(`사다리(${cx},${cz})가 걸어서 오를 수 있는 단차에 있습니다 — 지름길이 되지 않습니다.`)
        continue
      }
      const loW = cellToWorld(cx, cz, w, h)
      const hiW = cellToWorld(bx, bz, w, h)
      const dx = hiW.x - loW.x
      const dz = hiW.z - loW.z
      const len = Math.hypot(dx, dz) || 1
      this.shortcuts.push({
        loX: cx,
        loZ: cz,
        hiX: bx,
        hiZ: bz,
        x: (loW.x + hiW.x) / 2,
        z: (loW.z + hiW.z) / 2,
        loY: lo * HEIGHT_STEP,
        hiY: best * HEIGHT_STEP,
        dirX: dx / len,
        dirZ: dz / len,
        open: false,
        key: `${cx},${cz}`,
      })
    }
  }

  /** 세이브에서 읽은 열린 사다리 목록을 반영합니다. */
  applyOpenShortcuts(keys: readonly string[]): void {
    const set = new Set(keys)
    for (const s of this.shortcuts) s.open = set.has(s.key)
  }

  // ---- 길찾기 -----------------------------------------------------------

  /**
   * 목표까지의 **거리장(distance field)**.
   *
   * ── 왜 필요해졌는가 ────────────────────────────────────────────
   * 화면의 목표 화살표는 원래 목표를 **직선으로** 가리켰습니다. 지도가 서→동
   * 한 줄일 때는 그래도 맞았습니다. 그런데 지도를 원으로 만들면서 성벽마루가
   * 길을 막자, 화살표가 **벽을 뚫고 가라고 가리키게** 되었습니다.
   * 길을 돌아가게 만들었으면 안내도 돌아가야 합니다. 안 그러면 "돌아가는 길"이
   * 설계가 아니라 그냥 버그로 읽힙니다.
   *
   * ── 왜 A*가 아니라 거리장인가 ──────────────────────────────────
   * 목표는 하나(보스)인데 물어보는 쪽은 매 프레임입니다. 목표에서 한 번
   * 물을 흘려 놓으면(BFS) 그 뒤로는 **이웃 넷 중 제일 낮은 칸**을 고르는
   * 것으로 끝납니다 — 매 프레임 O(1). 격자가 88×72=6336칸이라 다시 만드는
   * 비용도 무시할 수준이고, 목표 칸이나 사다리 상태가 바뀔 때만 다시 만듭니다.
   *
   * 방향이 중요합니다: 오르막은 한쪽으로만 통하므로(내려가기는 자유, 오르기는
   * 제한) **목표에서 거꾸로** 퍼뜨리되 판정은 "이웃 → 지금 칸"으로 겁니다.
   */
  private field: Int32Array | null = null
  private fieldKey = ''

  private canStepCell(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const to = this.levelAtCell(toX, toZ)
    if (to === VOID) return false
    const from = this.levelAtCell(fromX, fromZ)
    if (from === VOID) return false
    if (to - from <= MAX_CLIMB) return true
    const s = this.shortcutBetween(fromX, fromZ, toX, toZ)
    return s !== null && s.open
  }

  /**
   * ── 플레이어까지의 거리장 — **"저 적이 나에게 올 수 있는가"** ──────────
   *
   * 목표용 거리장(this.field)과 **따로** 둡니다. 목표는 보스, 이쪽은 플레이어라
   * 매 프레임 번갈아 쓰면 캐시 키가 계속 바뀌어 BFS를 두 번씩 돌게 됩니다.
   *
   * ── 왜 필요해졌는가 ────────────────────────────────────────────
   * 자동 플레이가 화톳불 앞에서 굳었습니다. 기록은 이랬습니다:
   *
   *     가까운적 12.4m 체력 46 **경로 98m**
   *
   * 성벽마루 **건너편**의 적이었습니다. 직선으로는 12m, 걸어서는 98m —
   * 영원히 서로 닿을 수 없습니다. 그런데 어그로도, 화톳불의 "적이 가까워
   * 쉴 수 없다"(14m)도 **직선거리**로 재고 있었습니다. 그래서 그 적은
   * 깨어나 영원히 벽을 향해 걸었고, 화톳불은 영원히 잠겼습니다.
   *
   * 사람에게는 이렇게 보입니다: **화면에 적이 하나도 없는데 쉴 수가 없고,
   * 왜 그런지 알 방법도 없습니다.** 수직 지도를 만든 순간 생긴 문제인데,
   * 지도가 한 줄일 때는 직선거리와 걷는 거리가 거의 같아서 안 보였습니다.
   *
   * 거리장을 하나 더 두면 적 하나당 O(1)로 "진짜 거리"를 물어볼 수 있습니다.
   * BFS는 플레이어가 **칸을 옮길 때만** 다시 돕니다(격자 2m).
   */
  private playerField: Int32Array | null = null
  private playerFieldKey = ''

  buildPlayerField(x: number, z: number): void {
    const { w, h } = this.level
    const t = worldToCell(x, z, w, h)
    const key = `${t.cx},${t.cz}|${this.shortcuts.map((s) => (s.open ? 1 : 0)).join('')}`
    if (key === this.playerFieldKey && this.playerField) return
    this.playerFieldKey = key
    this.playerField = this.floodFrom(t.cx, t.cz)
  }

  /**
   * 그 자리에서 플레이어까지 **걸어야 하는 거리(m)**. 길이 없으면 null.
   * `buildPlayerField` 를 먼저 부른 프레임에서만 유효합니다.
   */
  distanceToPlayer(x: number, z: number): number | null {
    if (!this.playerField) return null
    const { w, h } = this.level
    const { cx, cz } = worldToCell(x, z, w, h)
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return null
    const d = this.playerField[cz * w + cx]
    return d < 0 ? null : d * CELL_SIZE
  }

  /** 한 칸에서 퍼져 나가는 BFS. 거리장 두 개가 같은 규칙을 쓰도록 함수로 뺐습니다. */
  private floodFrom(tx: number, tz: number): Int32Array {
    const { w, h } = this.level
    const field = new Int32Array(w * h).fill(-1)
    if (this.levelAtCell(tx, tz) === VOID) return field
    field[tz * w + tx] = 0
    let frontier: [number, number][] = [[tx, tz]]
    while (frontier.length) {
      const next: [number, number][] = []
      for (const [cx, cz] of frontier) {
        const d = field[cz * w + cx]
        for (const [nx, nz] of [
          [cx - 1, cz],
          [cx + 1, cz],
          [cx, cz - 1],
          [cx, cz + 1],
        ] as [number, number][]) {
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue
          if (field[nz * w + nx] !== -1) continue
          // **이웃에서 지금 칸으로** 올 수 있어야 합니다(오르막 방향 주의).
          if (!this.canStepCell(nx, nz, cx, cz)) continue
          field[nz * w + nx] = d + 1
          next.push([nx, nz])
        }
      }
      frontier = next
    }
    return field
  }

  /** 목표 지점으로 향하는 거리장을 준비합니다. 같은 조건이면 다시 만들지 않습니다. */
  buildFlowField(targetX: number, targetZ: number): void {
    const { w, h } = this.level
    const t = worldToCell(targetX, targetZ, w, h)
    const key = `${t.cx},${t.cz}|${this.shortcuts.map((s) => (s.open ? 1 : 0)).join('')}`
    if (key === this.fieldKey && this.field) return
    this.fieldKey = key

    const field = new Int32Array(w * h).fill(-1)
    if (this.levelAtCell(t.cx, t.cz) === VOID) {
      this.field = field
      return
    }
    field[t.cz * w + t.cx] = 0
    let frontier = [[t.cx, t.cz] as [number, number]]
    while (frontier.length) {
      const next: [number, number][] = []
      for (const [cx, cz] of frontier) {
        const d = field[cz * w + cx]
        for (const [nx, nz] of [
          [cx - 1, cz],
          [cx + 1, cz],
          [cx, cz - 1],
          [cx, cz + 1],
        ] as [number, number][]) {
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue
          if (field[nz * w + nx] !== -1) continue
          // **이웃에서 지금 칸으로** 올 수 있어야 합니다(오르막 방향 주의).
          if (!this.canStepCell(nx, nz, cx, cz)) continue
          field[nz * w + nx] = d + 1
          next.push([nx, nz])
        }
      }
      frontier = next
    }
    this.field = field
  }

  /**
   * 지금 자리에서 목표로 향하는 **다음 한 걸음**의 월드 좌표.
   * 길이 없으면 null — 그때는 부르는 쪽이 직선으로 되돌아가면 됩니다.
   */
  nextStepToward(x: number, z: number): { x: number; z: number } | null {
    if (!this.field) return null
    const { w, h } = this.level
    const { cx, cz } = worldToCell(x, z, w, h)
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return null
    const here = this.field[cz * w + cx]
    if (here < 0) return null
    if (here === 0) return null
    let best = here
    let bx = cx
    let bz = cz
    for (const [nx, nz] of [
      [cx - 1, cz],
      [cx + 1, cz],
      [cx, cz - 1],
      [cx, cz + 1],
    ] as [number, number][]) {
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue
      const d = this.field[nz * w + nx]
      if (d < 0 || d >= best) continue
      if (!this.canStepCell(cx, cz, nx, nz)) continue
      best = d
      bx = nx
      bz = nz
    }
    if (bx === cx && bz === cz) return null
    return cellToWorld(bx, bz, w, h)
  }

  /** 목표까지 실제로 걸어야 하는 거리(m). 길이 없으면 null. */
  pathDistance(x: number, z: number): number | null {
    if (!this.field) return null
    const { w, h } = this.level
    const { cx, cz } = worldToCell(x, z, w, h)
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return null
    const d = this.field[cz * w + cx]
    return d < 0 ? null : d * CELL_SIZE
  }

  openShortcutKeys(): string[] {
    return this.shortcuts.filter((s) => s.open).map((s) => s.key)
  }

  /**
   * 이 지름길이 **아끼는 거리(m)** — 걷힌 상태에서 아래 칸에서 위 칸까지
   * 걸어야 하는 거리. 내리고 나면 그게 한 칸(2m)이 됩니다.
   *
   * ── 왜 이 값을 화면에 띄우는가 ──────────────────────────────────
   * 자동 플레이 네 판 내리 **사다리 0/1** 이었습니다. 열 수 있는데 아무도
   * 안 열었습니다. 이유의 절반은 배치였고(고쳤습니다), 나머지 절반은
   * **여는 값을 아무도 모른다**는 것이었습니다. 화면에는 "지름길이 열립니다"
   * 라고만 떴는데, 그건 무엇을 얻는지가 아니라 무슨 일이 일어나는지입니다.
   *
   * 다크소울1이 지름길을 기억에 남기는 방식은 "여기 문이 있다"가 아니라
   * **"아, 여기가 거기랑 이어져 있었구나"** 입니다. 그 깨달음을 숫자로
   * 대신할 수는 없지만, 적어도 **되돌아온 거리를 눈앞에 보여줄 수는** 있습니다.
   * 98m를 걸어 올라온 사람에게 "98m → 2m"는 설명이 필요 없는 문장입니다.
   *
   * ⚠️ 거리장(this.field)을 건드리지 않고 **따로** 계산합니다. 목표용 거리장과
   *    번갈아 쓰면 캐시 키가 매 프레임 바뀌어 BFS를 두 번씩 돌게 됩니다.
   *    값은 다른 사다리가 열릴 때만 변하므로 그때만 다시 잽니다.
   */
  shortcutSaving(s: Shortcut): number | null {
    const sig = this.shortcuts.map((x) => (x.open ? 1 : 0)).join('')
    if (s.savingSig === sig) return s.saving ?? null
    const { w, h } = this.level
    const dist = new Int32Array(w * h).fill(-1)
    dist[s.hiZ * w + s.hiX] = 0
    let frontier: [number, number][] = [[s.hiX, s.hiZ]]
    let found: number | null = null
    while (frontier.length && found === null) {
      const next: [number, number][] = []
      for (const [cx, cz] of frontier) {
        const d = dist[cz * w + cx]
        for (const [nx, nz] of [
          [cx - 1, cz],
          [cx + 1, cz],
          [cx, cz - 1],
          [cx, cz + 1],
        ] as [number, number][]) {
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue
          if (dist[nz * w + nx] !== -1) continue
          // "이웃 → 지금 칸" 방향으로 판정합니다(거리장과 같은 이유).
          // 단 **이 사다리는 없는 셈** 칩니다 — 아니면 자기 자신을 통해
          // 2m 라는 동어반복이 나옵니다.
          if (!this.canStepCellIgnoring(nx, nz, cx, cz, s)) continue
          dist[nz * w + nx] = d + 1
          if (nx === s.loX && nz === s.loZ) found = d + 1
          next.push([nx, nz])
        }
      }
      frontier = next
    }
    s.savingSig = sig
    s.saving = found === null ? null : found * CELL_SIZE
    return s.saving
  }

  private canStepCellIgnoring(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    skip: Shortcut,
  ): boolean {
    const to = this.levelAtCell(toX, toZ)
    if (to === VOID) return false
    const from = this.levelAtCell(fromX, fromZ)
    if (from === VOID) return false
    if (to - from <= MAX_CLIMB) return true
    const s = this.shortcutBetween(fromX, fromZ, toX, toZ)
    return s !== null && s !== skip && s.open
  }

  /** 두 칸을 잇는 사다리가 있으면 돌려줍니다(방향 무관). */
  private shortcutBetween(aX: number, aZ: number, bX: number, bZ: number): Shortcut | null {
    for (const s of this.shortcuts) {
      if (s.loX === aX && s.loZ === aZ && s.hiX === bX && s.hiZ === bZ) return s
      if (s.loX === bX && s.loZ === bZ && s.hiX === aX && s.hiZ === aZ) return s
    }
    return null
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
    if (to - from <= MAX_CLIMB) return true
    // 못 오를 단차라도 **내려진 사다리**가 그 두 칸을 이어 주면 오를 수 있습니다.
    // 사다리가 없거나 아직 걷혀 있으면 여기서 막힙니다.
    if (this.shortcuts.length === 0) return false
    const { w, h } = this.level
    const a = worldToCell(fromX, fromZ, w, h)
    const b = worldToCell(toX, toZ, w, h)
    const s = this.shortcutBetween(a.cx, a.cz, b.cx, b.cz)
    return s !== null && s.open
  }

  /**
   * 플레이어가 지금 내릴 수 있는 사다리.
   *
   * **위쪽 칸에 서 있어야만** 내릴 수 있습니다 — 이게 이 장치의 전부입니다.
   * 아래에서도 올릴 수 있게 하면 걷힌 사다리가 주는 "저 위에 길이 있다"는
   * 정보가 사라지고, 그냥 상호작용 버튼 하나가 됩니다.
   */
  shortcutNear(x: number, z: number, reach: number): { s: Shortcut; fromTop: boolean } | null {
    const { w, h } = this.level
    const cell = worldToCell(x, z, w, h)
    let best: { s: Shortcut; fromTop: boolean } | null = null
    let bestD = reach
    for (const s of this.shortcuts) {
      const d = Math.hypot(s.x - x, s.z - z)
      if (d > bestD) continue
      // 칸으로도 판정합니다. 거리만 보면 낙차 위아래가 XZ상 가까워서
      // 어느 쪽에 서 있는지 구분이 안 됩니다.
      const onTop = cell.cx === s.hiX && cell.cz === s.hiZ
      const onBottom = cell.cx === s.loX && cell.cz === s.loZ
      if (!onTop && !onBottom) continue
      bestD = d
      best = { s, fromTop: onTop }
    }
    return best
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
        const ti = (cz * w + cx) * 3
        const tint: [number, number, number] = [
          this.tintAt[ti],
          this.tintAt[ti + 1],
          this.tintAt[ti + 2],
        ]
        const top = this.topColor(lvl, checker, tint)
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
          /**
           * 이 면이 **넘어갈 수 있는 턱인지 벽인지**로 색을 나눕니다.
           * 낭떠러지(VOID)는 내려갈 수는 있어도 올라올 수는 없으므로 벽 쪽입니다.
           */
          const side = this.sideColor(lvl, nLvl === VOID ? 99 : lvl - nLvl, tint)

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
  private topColor(
    lvl: number,
    checker: number,
    tint: [number, number, number] = [1, 1, 1],
  ): [number, number, number] {
    const t = this.maxLevel > 0 ? lvl / this.maxLevel : 0
    const r = (0.105 + t * 0.13) * checker * tint[0]
    const g = (0.125 + t * 0.135) * checker * tint[1]
    const b = (0.165 + t * 0.13) * checker * tint[2]
    return [r, g, b]
  }

  /**
   * ── 옆면 색 — **레벨 문법을 눈으로 읽게 만드는 자리** ──────────────
   *
   * README 는 이 게임의 레벨 문법을 네 줄로 못박아 두었습니다:
   *
   *   > 1단 = 통로 · 2단 이상 = 막힘 · 위에서 아래로 = 지름길
   *   > **이 네 줄이 곧 레벨 디자인의 문법입니다.**
   *
   * 그런데 렌더러는 **그 문법을 한 글자도 그리지 않고 있었습니다.** 옆면 색이
   * `lvl`(윗칸의 높이)에만 달려 있어서, **올라갈 수 있는 1단 턱과 못 올라가는
   * 3단 벽이 완전히 같은 색**이었습니다. 화면에서 둘을 가르는 단서는 면의
   * 세로 길이뿐인데, 직교 쿼터뷰에서 0.9m 와 2.7m 는 잘 안 잡힙니다.
   *
   * 그러면 플레이어는 벽에 부딪혀 보고서야 압니다. 길찾기가 **탐색이 아니라
   * 시행착오**가 되고, "위에서 아래로 = 지름길"이라는 설계의 재미도 안 보입니다.
   *
   * ── 왜 밝기로 가르는가 (색상이 아니라) ─────────────────────────
   * 색상(hue)으로 가르면 색맹인 사람에게는 문법이 사라집니다. 4색 예고를
   * *"색이 안 보여도 크기로 읽힌다"* 로 설계한 것과 같은 이유로, 여기서도
   * 가장 튼튼한 채널인 **밝기**를 씁니다. 넘을 수 있는 턱은 바닥이 이어지는
   * 것처럼 밝고, 벽은 확실히 어둡습니다.
   *
   * ⚠️ 벽도 완전히 죽이지는 않습니다 — 새까맣게 되면 절벽의 **형태 자체**가
   *    안 보입니다(원래 주석에 있던 경고 그대로 지킵니다).
   */
  private sideColor(
    lvl: number,
    dropSteps: number,
    tint: [number, number, number] = [1, 1, 1],
  ): [number, number, number] {
    // 옆면도 **같은 색조**를 받습니다. 윗면만 물들이면 구역 경계에서 벽만
    // 회색으로 남아, 지형이 두 겹으로 칠해진 것처럼 보입니다.
    const [r, g, b] = this.topColor(lvl, 1, tint)
    // 옆면을 어둡게 = 값싼 앰비언트 오클루전. 단차가 훨씬 뚜렷해집니다.
    const k = dropSteps <= MAX_CLIMB ? STEP_FACE_MIX : WALL_FACE_MIX
    return [r * k + 0.012, g * k + 0.014, b * (k + 0.06) + 0.02]
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
