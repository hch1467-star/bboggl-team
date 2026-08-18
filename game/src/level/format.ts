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

/**
 * 레벨에 놓을 수 있는 것들.
 *
 * 적 종류의 문자열은 `config/enemies.ts` 의 `EnemyDef.id` 와 **정확히 같아야**
 * 합니다. 레벨에는 문자열로 저장하고 게임은 `kindFromId()` 로 되찾습니다.
 * (숫자로 저장하지 않는 이유: 나중에 EnemyKind 순서를 바꾸면 예전 레벨의
 *  적이 전부 다른 적으로 바뀝니다. 문자열은 그렇게 조용히 틀리지 않습니다.)
 */
export type EntityKind =
  | 'spawn'
  | 'grunt'
  | 'treasure'
  | 'boss'
  | 'binder'
  | 'dragger'
  | 'bonfire'
  | 'ladder'
  | 'charger'
  | 'archer'
  | 'anvil'
  | 'barrel'
  /** 🛡️ 정예 — 잡몹과 **같은 공격**을 쓰는 큰 개체. 근거는 balance.ts `ELITE`. */
  | 'elite'

export const ENTITY_KINDS: EntityKind[] = [
  'spawn',
  'grunt',
  'treasure',
  'boss',
  'binder',
  'dragger',
  'bonfire',
  'ladder',
  'charger',
  'archer',
  'anvil',
  'barrel',
  'elite',
]

export const ENTITY_LABEL: Record<EntityKind, string> = {
  spawn: '시작 지점',
  grunt: '잡몹',
  treasure: '보물',
  boss: '보스',
  binder: '얽는 자 🔵',
  dragger: '끄는 자 🟣',
  bonfire: '화톳불',
  ladder: '사다리(지름길)',
  charger: '달려드는 자 🟢',
  archer: '쏘는 자 🔴(원거리)',
  anvil: '모루(강화만)',
  barrel: '폭발통 💥',
  elite: '정예 🛡️(잡몹과 같은 색)',
}

/**
 * 에디터 마커 색.
 *
 * 게임 안의 몸 색과 달리 여기서는 **예고 색을 그대로 씁니다.**
 * 에디터에는 예고 장판이 안 깔리므로 색이 뭉칠 일이 없고,
 * 배치할 때는 "이 적이 무슨 색을 던지는가"가 가장 중요한 정보이기 때문입니다.
 */
export const ENTITY_COLOR: Record<EntityKind, number> = {
  spawn: 0x5fa8ff,
  grunt: 0xc0453f,
  treasure: 0xffd479,
  boss: 0xb45cff,
  binder: 0x35a7ff,
  dragger: 0xc061ff,
  bonfire: 0xffa93c,
  ladder: 0x9ee37d,
  charger: 0x4dffa1,
  archer: 0x8fb3c9,
  anvil: 0x8fa4b8,
  // 예고 🟡 과 같은 색입니다 — 통이 만드는 것이 노랑이라, 에디터에서도
  // 그 사실이 먼저 보여야 합니다.
  barrel: 0xffd23f,
  // 잡몹과 **같은 예고 색**입니다 — 같은 공격을 쓰니까요. 에디터에서
  // 둘을 가르는 것은 색이 아니라 라벨이라야 그 사실이 안 흐려집니다.
  elite: 0xc0453f,
}

export interface LevelEntity {
  kind: EntityKind
  /** 월드 좌표(m) */
  x: number
  z: number
  rotY: number
}

/**
 * 이름 붙은 구역.
 *
 * 미니맵을 쓰지 않기로 했으므로(DESIGN.md 기둥 4), **장소에 이름을 주는 것**이
 * 길을 알려주는 주된 수단입니다. 새 구역에 들어서면 이름이 뜨고,
 * "성문 통로를 지났다 → 이제 폐허다"라는 진행 감각이 생깁니다.
 * 소울라이크와 오공이 지역명을 띄우는 이유가 정확히 이것입니다.
 */
export interface LevelRegion {
  name: string
  /** 격자 좌표 범위 (양 끝 포함) */
  x0: number
  x1: number
  z0: number
  z1: number
  /** 처음 들어왔을 때 한 줄 안내 (선택) */
  hint?: string
  /**
   * 이 구역의 **지면 색조** — 윗면·옆면 색에 채널별로 곱합니다. 없으면 1배.
   *
   * ── 왜 필요한가 ────────────────────────────────────────────────
   * 이 존에는 이름 붙은 구역이 열 곳 있고 저마다 한 줄 설명까지 달려
   * 있는데, **화면에서는 전부 같은 회색**이었습니다. 구역이 바뀐 것을
   * 알려 주는 것은 HUD 글자뿐이라, 지도를 읽는 일이 **글을 읽는 일**이
   * 되어 있었습니다. 쿼터뷰에서 지역을 구분하는 것은 원래 눈의 일입니다
   * (할로우 나이트·하데스·디아블로가 전부 그렇게 합니다).
   *
   * ⚠️ **채도를 낮게 씁니다.** 예고 4색(빨강·노랑·파랑·보라)이 바탕과
   *    ΔE 25 이상 떨어져야 한다는 약속이 이미 있고, 지면을 어느 한 색
   *    쪽으로 진하게 물들이면 그 색 예고가 그 구역에서만 묻힙니다.
   *    그래서 색상보다 **온도와 밝기**로 가릅니다. `npm run zones` 가
   *    네 예고 색 전부에 대해 그 여유를 검사합니다.
   */
  tint?: [number, number, number]
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
  regions?: LevelRegion[]
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

  const regions: LevelRegion[] = Array.isArray(d.regions)
    ? d.regions
        .filter((r): r is LevelRegion => !!r && typeof (r as LevelRegion).name === 'string')
        .map((r) => ({
          name: r.name,
          x0: Number(r.x0) || 0,
          x1: Number(r.x1) || 0,
          z0: Number(r.z0) || 0,
          z1: Number(r.z1) || 0,
          hint: typeof r.hint === 'string' ? r.hint : undefined,
          // 색조는 **셋 다 숫자일 때만** 받습니다. 반쪽만 온 값을 통과시키면
          // 구역 하나가 조용히 새까매지고, 원인을 데이터에서 찾게 됩니다.
          tint:
            Array.isArray(r.tint) && r.tint.length === 3 && r.tint.every((v) => Number.isFinite(v))
              ? [Number(r.tint[0]), Number(r.tint[1]), Number(r.tint[2])]
              : undefined,
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
      regions,
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
