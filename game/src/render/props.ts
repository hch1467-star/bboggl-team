import * as THREE from 'three'
import { propRng } from '../core/rng'
import { CELL_SIZE, HEIGHT_STEP, MAX_CLIMB, VOID, cellToWorld, worldToCell } from '../level/format'
import type { Terrain } from '../level/terrain'

/**
 * 🏛 **폐허 잔해** — 「무너진 회랑」이 실제로 무너져 보이게.
 *
 * ── 왜 만들었나 (구역 사진 열두 장을 나란히 놓고) ──────────────────
 * 「무너진 회랑」도 「폐허 안뜰」도 화면에는 **아무것도 없는 색면 한 장**
 * 이었습니다. 이름은 무너졌다는데 무너진 것이 하나도 없습니다. 세계가
 * 아니라 **테스트 레벨**처럼 보입니다.
 *
 * 참고한 세 게임이 전부 이걸 지물로 풉니다:
 *   · 로스트아크  — 구역마다 다른 배치물. 스샷 한 장으로 어디인지 압니다
 *   · 검은 신화: 오공 — 기둥·석등이 길의 **마디**를 만듭니다
 *   · 노 레스트 포 더 위키드 — 잔해가 곧 레벨 디자인의 언어입니다
 *
 * ── ❌ 첫 규칙은 **세어 보고 버렸습니다** ──────────────────────────
 * 처음엔 *"플레이어가 갈 수 없는 칸에만 놓자"* 로 정했습니다. 밸런스에
 * 손을 안 대는 가장 안전한 규칙이니까요. 그래서 시작 지점에서 게임과
 * 같은 통행 규칙으로 물을 흘려 보고 **세어 봤습니다**:
 *
 *     바닥 3,808칸 중 **못 가는 칸 6칸** · 그중 길에서 보이는 곳 6칸
 *
 * 놓을 자리가 없었습니다. 그리고 이 숫자 자체가 이 레벨의 진짜 문제를
 * 가리킵니다 — **이 맵은 바닥이 통째로 하나로 이어져 있습니다.** 참고한
 * 세 게임은 화면의 상당 부분이 *들어갈 수 없는 배경*이고, 걸을 수 있는
 * 부분은 그 배경이 남겨 준 모양입니다. 여기엔 그 배경이 없습니다.
 * (지도 자체를 그렇게 고치는 것은 이 라운드의 몫이 아니라 적어만 둡니다.)
 *
 * ── ✅ 그래서 **허공의 가장자리**에 세웁니다 ───────────────────────
 * 이 맵의 40%(2,528칸)는 바닥이 없는 허공입니다. 그중 **바닥과 이웃한
 * 332칸**은 길에서 빤히 보이면서 엔진 규칙상 절대 밟을 수 없는 자리입니다.
 * 거기서 부러진 기둥이 솟아오르면:
 *
 *   · 길의 **가장자리가 보입니다** — 지금은 바닥이 그냥 끝납니다
 *   · 폐허의 **실루엣**이 생깁니다 — 쿼터뷰에서 높이는 실루엣으로만 읽힙니다
 *   · 이동·화살·적 AI·자동 플레이에 **한 줄도 영향이 없습니다**
 *
 * 바닥 쪽에는 **낮은 잔해**만 흩뿌립니다(0.4m 이하). 밟고 지나갈 수 있는
 * 높이라야 "통과했다"가 눈에 안 걸립니다.
 *
 * ⚠️ 지물은 **어떤 시스템에도 등록하지 않습니다.** 충돌체도, 엔티티도
 *    아닙니다. 그래서 지금 초록인 검사 예순 몇 개의 뜻이 흐려지지 않습니다.
 *
 * ── 🎲 자리는 씨앗으로, 그것도 **좌표에서 직접** 뽑습니다 ──────────
 * `Math.random()` 을 쓰면 새로 고칠 때마다 폐허가 바뀌어 이 저장소의
 * 스크린샷 검사가 전부 흔들립니다(`npm run repro`). 그리고 스트림을
 * 순서대로 굴리지도 않습니다 — 그러면 지도를 한 칸 넓히는 것만으로 뒤가
 * 전부 밀립니다. `propRng.at(좌표)` 로 **칸마다 독립된 주사위**를 씁니다.
 */

/** 허공 가장자리 칸에 기둥이 설 확률. 촘촘하면 폐허가 아니라 울타리가 됩니다. */
const PILLAR_DENSITY = 0.34

/** 바닥 칸에 잔해가 놓일 확률. 여기는 걸어 다니는 곳이라 훨씬 성기게. */
const RUBBLE_DENSITY = 0.055

/** 바닥 잔해의 최대 높이(m). 이보다 높으면 "밟고 지나간다"가 눈에 걸립니다. */
const RUBBLE_MAX_H = 0.4

/**
 * 지물 총량의 상한. GPU 없는 환경에서도 돌아가야 해서(20fps 언저리) 먼저
 * 세고 나중에 자릅니다. 잘린 개수는 `debugProps()` 가 그대로 내보내므로
 * 조용히 사라지지 않습니다 — 안 그러면 *"이 구역엔 원래 없구나"* 로 읽힙니다.
 */
const MAX_PILLARS = 140
const MAX_RUBBLE = 170

/** 중요한 물건 곁은 비웁니다(칸). 화톳불·모루·보물이 잔해에 묻히면 안 됩니다. */
const KEEP_CLEAR = 2

export interface PropsInfo {
  pillars: number
  rubble: number
  /** 세울 수 있었던 칸 수 — 상한에 걸려 잘렸는지 이걸로만 압니다. */
  pillarSpots: number
  rubbleSpots: number
  /** 갈 수 없는 바닥 칸 수. 위 ❌ 문단의 근거를 **게임이 직접** 셉니다. */
  unreachable: number
  /** 구역 이름 → 그 구역에 선 지물 수. */
  byRegion: Record<string, number>
}

type Spot = { cx: number; cz: number; lvl: number; region: string; busy?: boolean }

/**
 * 지형에서 자리를 찾아 폐허를 세웁니다.
 *
 * 돌려주는 그룹은 씬에 그대로 붙이면 되고, **지형 그룹과 따로** 둡니다 —
 * 지형은 청크마다 가림 페이드(반투명)를 받는데 지물까지 거기 섞으면
 * 캐릭터가 기둥 뒤로 갈 때의 규칙이 두 벌이 됩니다.
 */
export function buildProps(terrain: Terrain): { group: THREE.Group; info: PropsInfo } {
  const group = new THREE.Group()
  group.name = 'props'
  const { w, h } = terrain.level
  const lvlAt = (cx: number, cz: number) => terrain.levelAtCell(cx, cz)

  /**
   * ── ① 갈 수 없는 바닥 칸을 **셉니다** ─────────────────────────────
   *
   * 이 숫자를 쓰지는 않습니다. 위 ❌ 문단의 근거가 **주석이 아니라 게임
   * 안에서** 나오게 하려고 셉니다 — 지도를 크게 손보는 날 이 수가 늘면,
   * 그때는 기둥을 바닥 위에도 세울 수 있다는 뜻입니다.
   */
  const reach = new Uint8Array(w * h)
  const spawn = terrain.level.entities.find((e) => e.kind === 'spawn')
  const start = spawn ? worldToCell(spawn.x, spawn.z, w, h) : { cx: 0, cz: 0 }
  const links = new Map<number, number[]>()
  for (const s of terrain.shortcuts) {
    const lo = s.loZ * w + s.loX
    const hi = s.hiZ * w + s.hiX
    links.set(lo, [...(links.get(lo) ?? []), hi])
    links.set(hi, [...(links.get(hi) ?? []), lo])
  }
  const stack: number[] = []
  const push = (cx: number, cz: number) => {
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return
    const i = cz * w + cx
    if (reach[i] || lvlAt(cx, cz) === VOID) return
    reach[i] = 1
    stack.push(i)
  }
  push(start.cx, start.cz)
  while (stack.length > 0) {
    const i = stack.pop() as number
    const cx = i % w
    const cz = (i - cx) / w
    const from = lvlAt(cx, cz)
    // 게임의 `canStep` 과 같은 판단입니다 — 내려가는 것은 막지 않습니다.
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const to = lvlAt(cx + dx, cz + dz)
      if (to === VOID || to - from > 1) continue
      push(cx + dx, cz + dz)
    }
    // 사다리는 잠겨 있어도 이어진 것으로 칩니다 — 나중에 열리니까요.
    for (const j of links.get(i) ?? []) push(j % w, (j - (j % w)) / w)
  }
  let unreachable = 0
  for (let i = 0; i < reach.length; i++) {
    if (!reach[i] && terrain.level.heights[i] !== VOID) unreachable++
  }

  /** 중요한 물건 곁은 비웁니다. */
  const busy = new Uint8Array(w * h)
  for (const e of terrain.level.entities) {
    const { cx, cz } = worldToCell(e.x, e.z, w, h)
    for (let dz = -KEEP_CLEAR; dz <= KEEP_CLEAR; dz++) {
      for (let dx = -KEEP_CLEAR; dx <= KEEP_CLEAR; dx++) {
        const nx = cx + dx
        const nz = cz + dz
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue
        busy[nz * w + nx] = 1
      }
    }
  }

  /**
   * 이 칸이 **떨어지는 가장자리**인가 — 지형이 밝게 칠해 경고하는 자리입니다
   * (level/terrain.ts 의 `cornerShade` 와 **같은 판단**을 씁니다).
   */
  const atEdge = (cx: number, cz: number): boolean => {
    const lvl = lvlAt(cx, cz)
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue
        const n = lvlAt(cx + dx, cz + dz)
        if (n === VOID || lvl - n > MAX_CLIMB) return true
      }
    }
    return false
  }

  /** 칸 → 구역 이름. 어디에 얼마나 섰는지 장부에 적으려고 씁니다. */
  const regionOf = (cx: number, cz: number): string => {
    for (const r of terrain.level.regions ?? []) {
      if (cx >= r.x0 && cx <= r.x1 && cz >= r.z0 && cz <= r.z1) return r.name
    }
    return '(구역 밖)'
  }

  /**
   * ── ② 자리 고르기 ─────────────────────────────────────────────────
   *   기둥 = 허공인데 바닥과 이웃한 칸 (밟을 수 없고, 길에서 보입니다)
   *   잔해 = 바닥 칸 (낮게 눕히므로 밟고 지나갑니다)
   */
  const pillarSpots: Spot[] = []
  const rubbleSpots: Spot[] = []
  for (let cz = 0; cz < h; cz++) {
    for (let cx = 0; cx < w; cx++) {
      const lvl = lvlAt(cx, cz)
      if (lvl === VOID) {
        // 이웃 바닥 중 **가장 낮은 것**을 기준으로 삼습니다. 가장 높은 것을
        // 쓰면 기둥이 벼랑 위로 솟아 길을 가립니다.
        let base = Infinity
        let near = '(구역 밖)'
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue
            const n = lvlAt(cx + dx, cz + dz)
            if (n === VOID || n >= base) continue
            base = n
            /**
             * ⚠️ 기둥이 선 칸은 **허공**이라, 그 좌표로 구역을 물으면 구역
             * 바깥으로 나오기 쉽습니다. 그러면 벼랑 옆 좁은 구역이 장부에서
             * 통째로 "지물 0개"가 됩니다 — 실제로는 바로 곁에 서 있는데도요.
             * 그래서 **기대고 있는 바닥 칸**의 구역으로 셉니다.
             */
            near = regionOf(cx + dx, cz + dz)
          }
        }
        if (base === Infinity) continue
        pillarSpots.push({ cx, cz, lvl: base, region: near })
      } else if (atEdge(cx, cz)) {
        /**
         * ⚠️ **가장자리에는 잔해를 놓지 않습니다.**
         *
         * 지형은 *"내려가면 못 올라오는 가장자리"* 를 **밝게** 칠해 알려
         * 줍니다(level/terrain.ts `EDGE_RIM`). 그 위에 어두운 돌을 흩뿌리자
         * `npm run depth` 의 테두리 신호가 **16% → 7%** 로 떨어졌습니다.
         * 잡음(±7%)과 구별이 안 되는 값입니다.
         *
         * 고칠 곳은 검사도 밝기도 아니고 **여기**입니다 — 장식이 안내를
         * 가리면 안 됩니다. 어차피 벼랑 끝에 걸친 돌은 그림으로도 위태롭게
         * 보이고, 바로 곁의 허공에는 기둥이 이미 서 있습니다.
         */
        continue
      } else {
        // 중요한 물건 곁도 **목록에는 남깁니다.** 평소 추첨에서는 빼지만,
        // 아래 "구역마다 최소 하나"의 마지막 수단으로는 써야 합니다 —
        // 「함몰지 가장자리」는 20칸이 전부 물건 곁이라 통째로 비었습니다.
        rubbleSpots.push({ cx, cz, lvl, region: regionOf(cx, cz), busy: busy[cz * w + cx] === 1 })
      }
    }
  }

  /**
   * ⚠️ **상한에 걸릴 때 앞에서부터 자르면 안 됩니다.**
   *
   * 처음엔 `out.slice(0, cap)` 이었는데, 재 보니 바닥 잔해 170개가 **전부
   * 「구역 밖」**이었습니다. 훑는 순서가 위쪽 줄부터라, 상한을 채우는 동안
   * 지도의 북쪽만 채우고 끝난 것입니다. 그러면 정작 보여 주려던 「무너진
   * 회랑」에는 잔해가 **한 개도** 안 생기는데, 장부에는 "170개 놓았음"으로
   * 적힙니다 — 조용한 거짓말입니다.
   *
   * 그래서 주사위 값이 **작은 순서**로 남깁니다. 이건 밀도를 지도 전체에
   * 고르게 낮추는 것과 같아서, 어느 구역도 순서 때문에 손해 보지 않습니다.
   */
  const pick = (spots: Spot[], density: number, salt: number, cap: number) => {
    const scored: { s: Spot; k: number }[] = []
    for (const s of spots) {
      // 칸 좌표에서 직접 뽑습니다 — 훑는 순서에 안 흔들립니다(파일 머리말).
      if (s.busy) continue
      const k = propRng.at(((s.cx * 73856093) ^ (s.cz * 19349663) ^ salt) | 0)
      if (k < density) scored.push({ s, k })
    }
    if (scored.length > cap) scored.sort((a, b) => a.k - b.k)
    return scored.slice(0, cap).map((e) => e.s)
  }
  const pillars = pick(pillarSpots, PILLAR_DENSITY, 0, MAX_PILLARS)
  const rubble = pick(rubbleSpots, RUBBLE_DENSITY, 0x51ed, MAX_RUBBLE)

  /**
   * ── ②-b **구역마다 최소 하나**는 보장합니다 ───────────────────────
   *
   * 확률로만 뿌리면 **좁은 구역이 통째로 빈 채로** 남습니다. 실제로 첫 판에서
   * 「함몰지 가장자리」와 「성벽 좁은 길」이 0개였습니다 — 둘 다 벼랑에 붙은
   * 가느다란 구역이라 칸 수가 적어서, 밀도 0.34 를 곱하면 그냥 0 이 됩니다.
   *
   * 밀도를 올려서 풀면 넓은 구역이 잡초밭이 됩니다. 고쳐야 할 것은 밀도가
   * 아니라 **"구역마다 하나는 있어야 한다"** 는 규칙이 없다는 것입니다.
   * 이 규칙은 이 저장소가 계속 지켜 온 것과 같습니다 — 확률에 맡긴 자리에는
   * 반드시 바닥을 깔아 둡니다.
   */
  const named = new Set<string>()
  for (const s of [...pillars, ...rubble]) named.add(s.region)
  for (const r of terrain.level.regions ?? []) {
    if (named.has(r.name)) continue
    // 그 구역의 자리 중 주사위 값이 가장 작은 것 하나. 기둥을 먼저 봅니다 —
    // 좁은 구역은 대개 벼랑에 붙어 있어서 기둥이 훨씬 잘 보입니다.
    const key = (s: Spot) => propRng.at(((s.cx * 73856093) ^ (s.cz * 19349663)) | 0)
    const inP = pillarSpots.filter((s) => s.region === r.name)
    const free = rubbleSpots.filter((s) => s.region === r.name && !s.busy)
    // 마지막 수단 — 물건 곁이라도 놓습니다. 아예 없는 것보다 낫습니다.
    const inR = free.length > 0 ? free : rubbleSpots.filter((s) => s.region === r.name)
    const from = inP.length > 0 ? inP : inR
    if (from.length === 0) continue
    let best = from[0]
    for (const s of from) if (key(s) < key(best)) best = s
    ;(from === inP ? pillars : rubble).push(best)
  }

  /**
   * ── ③ 세웁니다 ────────────────────────────────────────────────────
   *
   * 종류는 둘뿐입니다. 늘리는 것보다 이 둘이 만드는 **높이 차이**가
   * 화면에서 훨씬 크게 읽힙니다. 그리고 둘 다 인스턴싱 한 벌씩이라
   * 드로우콜은 두 개로 끝납니다 — GPU 없는 환경을 생각한 선택입니다.
   */
  const mkMesh = (geo: THREE.BufferGeometry, n: number) => {
    /**
     * ⚠️ `vertexColors: true` 로 두면 **새까맣게 나옵니다.**
     *
     * 첫 스크린샷이 통째로 검은 조각이었습니다. 인스턴스 색(`setColorAt`)은
     * three.js 가 `instanceColor` 로 따로 넣어 주는데, `vertexColors` 를
     * 켜면 셰이더가 **정점 색 속성**을 같이 찾습니다. 상자·원기둥 지오메트리에는
     * 그 속성이 없으니 색이 0 이 되고, 곱해진 결과가 검정입니다.
     */
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 })
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n))
    mesh.count = n
    mesh.frustumCulled = false
    /**
     * 그림자는 **받기만 하고 드리우지는 않습니다.**
     *
     * 지형과 같은 조명을 받아야 그늘진 골목의 잔해만 혼자 밝지 않습니다.
     * 하지만 `castShadow` 는 껐습니다 — GPU 없는 환경에서 그림자 맵에 288개를
     * 더 그리는 값이 큽니다(이 라운드에 프레임이 눈에 띄게 떨어졌습니다).
     * 0.3m 짜리 돌의 그림자는 이 시점 거리에서 보이지도 않고, 기둥은 허공 위에
     * 서 있어서 드리울 바닥이 없습니다. **안 보이는 것에 값을 치르지 않습니다.**
     */
    mesh.castShadow = false
    mesh.receiveShadow = true
    return mesh
  }
  // 위가 좁습니다 — 부러진 단면이 아니라 **깎여 나간 돌**로 읽힙니다.
  const pillarGeo = new THREE.CylinderGeometry(0.36, 0.5, 1, 6, 1)
  pillarGeo.translate(0, 0.5, 0) // 밑면을 y=0 으로 — 칸 높이를 그대로 쓰려고
  const rubbleGeo = new THREE.BoxGeometry(1, 1, 1)
  rubbleGeo.translate(0, 0.5, 0)
  const pillarMesh = mkMesh(pillarGeo, pillars.length)
  const rubbleMesh = mkMesh(rubbleGeo, rubble.length)

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const eul = new THREE.Euler()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const col = new THREE.Color()
  const info: PropsInfo = {
    pillars: pillars.length,
    rubble: rubble.length,
    pillarSpots: pillarSpots.length,
    rubbleSpots: rubbleSpots.length,
    unreachable,
    byRegion: {},
  }

  const place = (mesh: THREE.InstancedMesh, list: Spot[], tall: boolean) => {
    list.forEach((s, i) => {
      const wpt = cellToWorld(s.cx, s.cz, w, h)
      const die = (salt: number) => propRng.at(((s.cx * 2654435761) ^ (s.cz * 40503) ^ salt) | 0)
      // 칸 안에서 살짝 흔듭니다 — 정확히 격자에 맞으면 폐허가 아니라 바둑판입니다.
      const jx = (die(1) - 0.5) * CELL_SIZE * 0.55
      const jz = (die(2) - 0.5) * CELL_SIZE * 0.55
      const spin = die(3) * Math.PI * 2
      const size = die(4)
      if (tall) {
        /**
         * 기둥은 **이웃 바닥보다 낮은 데서** 솟습니다. 그래야 "허공에서
         * 올라온 잔해"로 보입니다 — 바닥 높이에 맞춰 세우면 공중에 뜬
         * 원기둥이 됩니다(직교 투영이라 부양이 특히 잘 보입니다).
         */
        const base = (s.lvl - 1.6) * HEIGHT_STEP
        const top = 0.7 + size * 2.4
        pos.set(wpt.x + jx, base, wpt.z + jz)
        // 기울입니다. 똑바로 선 기둥이 늘어서면 폐허가 아니라 신전입니다.
        const lean = (die(5) - 0.5) * 0.3
        eul.set(lean, spin, lean * 0.7)
        scl.set(0.8 + size * 0.45, (1.6 * HEIGHT_STEP + top) / 1, 0.8 + size * 0.45)
      } else {
        pos.set(wpt.x + jx, s.lvl * HEIGHT_STEP, wpt.z + jz)
        eul.set(0, spin, 0)
        // 넓고 납작하면 잔해가 아니라 **포석**으로 보입니다 — 첫 판의 실수.
        scl.set(0.5 + size * 0.5, 0.26 + size * (RUBBLE_MAX_H - 0.26), 0.44 + size * 0.44)
      }
      q.setFromEuler(eul)
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
      const [r, g, b] = terrain.propColor(s.lvl, s.cx, s.cz, tall)
      col.setRGB(r, g, b)
      mesh.setColorAt(i, col)
      // 기둥은 허공에 서므로 **기대고 있는 바닥의 구역**으로 셉니다(위 참고).
      info.byRegion[s.region] = (info.byRegion[s.region] ?? 0) + 1
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    if (list.length > 0) group.add(mesh)
  }
  place(pillarMesh, pillars, true)
  place(rubbleMesh, rubble, false)
  return { group, info }
}
