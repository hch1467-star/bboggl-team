/**
 * 레벨 데이터 포맷.
 *
 * 설계 근거 — 왜 "높이맵(heightmap) 격자"인가:
 *  - 우리 목표는 오공식 **와이드 리니어**(주 동선이 명확한 반오픈) 레벨입니다.
 *    이런 레벨은 "길을 벽으로 막는" 것보다 **"높이 차로 나누는"** 쪽이 훨씬 잘 만들어집니다.
 *    올라갈 수 없는 절벽이 곧 벽이 되고, 낮은 단차는 지름길이 됩니다.
 *  - NRFTW가 내세우는 **수직성**이 공짜로 따라옵니다.
 *  - 자유 배치 3D보다 **초보가 마우스로 만들기 압도적으로 쉽습니다.** 이게 결정적입니다.
 *    (레벨을 만드는 사람이 코딩을 하지 않아도 되어야 합니다.)
 *
 * 포맷은 순수 JSON입니다. Unity 이식 시 그대로 읽어 ScriptableObject나
 * Tilemap으로 변환하면 됩니다 — 레벨 데이터는 버릴 필요가 없습니다.
 */

export const LEVEL_VERSION = 1

/** 격자 한 칸의 크기(m). 캐릭터 반지름 0.45의 약 2배 — 한 칸이 "한 걸음 반" 느낌. */
export const CELL_SIZE = 2

/** 높이 한 단계(m). 캐릭터 키(1.75)의 절반보다 조금 낮게 — 단차가 눈에 확실히 보입니다. */
export const HEIGHT_STEP = 0.9

/** 걸어서 오를 수 있는 최대 단차(단계). 1이면 한 칸 차이는 오르고, 2칸부터는 절벽. */
export const MAX_CLIMB = 1

/** 바닥이 없는 칸 (낭떠러지). 지나갈 수 없습니다. */
export const VOID = -1

/** 높이 최댓값 — 에디터에서 실수로 무한히 올리는 것을 막습니다. */
export const MAX_HEIGHT = 12

export type EntityKind = 'spawn' | 'grunt' | 'treasure' | 'boss'

export const ENTITY_KINDS: EntityKind[] = ['spawn', 'grunt', 'treasure', 'boss']

export const ENTITY_LABEL: Record<EntityKind, string> = {
  spawn: '시작 지점',
  grunt: '잡몹',
  treasure: '보물',
  boss: '보스',
}

export const ENTITY_COLOR: Record<EntityKind, number> = {
  spawn: 0x5fa8ff,
  grunt: 0xc0453f,
  treasure: 0xffd479,
  boss: 0xb45cff,
}

export interface LevelEntity {
  kind: EntityKind
  /** 월드 좌표(m) */
  x: number
  z: number
  rotY: number
}

export interface LevelData {
  version: number
  name: string
  /** 격자 크기(칸) */
  w: number
  h: number
  /** heights[z * w + x]. VOID(-1) 이거나 0 이상의 높이 단계. */
  heights: number[]
  entities: LevelEntity[]
}

/** 격자 좌표 -> 월드 좌표 (칸의 중심). 격자 중앙이 월드 원점이 되도록 맞춥니다. */
export function cellToWorld(cx: number, cz: number, w: number, h: number): { x: number; z: number } {
  return {
    x: (cx - w / 2 + 0.5) * CELL_SIZE,
    z: (cz - h / 2 + 0.5) * CELL_SIZE,
  }
}

/** 월드 좌표 -> 격자 좌표 (내림). 범위를 벗어날 수 있으니 쓰는 쪽에서 검사해야 합니다. */
export function worldToCell(x: number, z: number, w: number, h: number): { cx: number; cz: number } {
  return {
    cx: Math.floor(x / CELL_SIZE + w / 2),
    cz: Math.floor(z / CELL_SIZE + h / 2),
  }
}

/**
 * 빈 레벨 생성.
 *
 * 전부 VOID로 시작하지 않고 가운데에 둥근 바닥을 깔아 두는 이유:
 * 완전히 빈 화면에서 시작하면 초보가 "여기서 뭘 해야 하지" 상태가 됩니다.
 * 바로 위에 지형을 얹어볼 수 있는 캔버스를 주는 편이 낫습니다.
 */
export function createEmptyLevel(w = 56, h = 56, name = '새 레벨'): LevelData {
  const heights = new Array<number>(w * h).fill(VOID)
  const cx = w / 2
  const cz = h / 2
  const radius = Math.min(w, h) * 0.36
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz)
      if (d <= radius) heights[z * w + x] = 0
    }
  }
  const start = cellToWorld(Math.floor(cx), Math.floor(cz), w, h)
  return {
    version: LEVEL_VERSION,
    name,
    w,
    h,
    heights,
    entities: [{ kind: 'spawn', x: start.x, z: start.z, rotY: 0 }],
  }
}

/** 직렬화 — 저장/다운로드용. heights는 길어서 한 줄로 눌러 씁니다. */
export function serializeLevel(level: LevelData): string {
  return JSON.stringify(level)
}

/**
 * 역직렬화 + 검증.
 *
 * 사용자가 만든 JSON 파일을 직접 불러오는 기능이 있으므로,
 * 깨진 데이터가 들어와도 게임이 죽지 않고 이유를 알려줘야 합니다.
 */
export function parseLevel(text: string): { level: LevelData } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: 'JSON 형식이 아닙니다.' }
  }
  if (typeof raw !== 'object' || raw === null) return { error: '레벨 데이터가 비어 있습니다.' }

  const d = raw as Partial<LevelData>
  if (typeof d.w !== 'number' || typeof d.h !== 'number' || d.w <= 0 || d.h <= 0) {
    return { error: '격자 크기(w, h)가 올바르지 않습니다.' }
  }
  if (!Array.isArray(d.heights) || d.heights.length !== d.w * d.h) {
    return { error: `높이 데이터 길이가 맞지 않습니다 (기대 ${d.w * d.h}, 실제 ${d.heights?.length ?? 0}).` }
  }
  const heights = d.heights.map((v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return VOID
    return n < 0 ? VOID : Math.min(MAX_HEIGHT, Math.round(n))
  })

  const entities: LevelEntity[] = Array.isArray(d.entities)
    ? d.entities
        .filter((e): e is LevelEntity => !!e && ENTITY_KINDS.includes((e as LevelEntity).kind))
        .map((e) => ({
          kind: e.kind,
          x: Number(e.x) || 0,
          z: Number(e.z) || 0,
          rotY: Number(e.rotY) || 0,
        }))
    : []

  return {
    level: {
      version: LEVEL_VERSION,
      name: typeof d.name === 'string' && d.name ? d.name : '이름 없는 레벨',
      w: d.w,
      h: d.h,
      heights,
      entities,
    },
  }
}

/** 브라우저 저장소 키 — 에디터와 게임이 이 키로 레벨을 주고받습니다. */
export const LEVEL_STORAGE_KEY = 'qvarpg.level.current'

export function saveLevelToStorage(level: LevelData): void {
  localStorage.setItem(LEVEL_STORAGE_KEY, serializeLevel(level))
}

export function loadLevelFromStorage(): LevelData | null {
  const text = localStorage.getItem(LEVEL_STORAGE_KEY)
  if (!text) return null
  const result = parseLevel(text)
  return 'level' in result ? result.level : null
}
