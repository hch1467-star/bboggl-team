/**
 * 첫 번째 존 「무너진 성문」 생성기.
 *
 * ── 왜 스크립트로 만드는가 ────────────────────────────────────────
 * 에디터로 마우스 작업하는 것이 최종 목표이지만, **첫 존만은 코드로 만듭니다.**
 *  1) 레이아웃이 git diff 로 보입니다. "3번 방을 한 칸 넓혔다"가 기록에 남습니다.
 *  2) 수치(방 크기·높이 단차·적 배치)를 한 줄 고쳐 다시 뽑을 수 있습니다.
 * 결과물은 그냥 JSON이라, 에디터에서 `JSON 가져오기`로 열어 손으로 다듬을 수 있습니다.
 *
 * ── 레벨 설계 (DESIGN.md 기둥 4: 헤매지 않는 탐험) ──────────────────
 *
 *                      [북쪽 단상 h3]  ← 1단 위, 막다른 길 (보물)
 *                            ↑
 *  [시작 광장] → [성문 통로] → [중앙 폐허] → [계단 h2→h3] → [보스 성벽 h4]
 *                    ↓                ↓                          (보물)
 *              [숨은 벽감]      [남쪽 함몰지 h0]
 *               (보물)          2단 낙하 = 되돌아갈 수 없음 (보물)
 *                                     └→ 복귀 램프 → 계단에 합류(지름길)
 *
 * 설계 원칙:
 *  · **주 동선은 항상 +X 한 방향** — 어디로 가야 할지 헷갈리지 않습니다.
 *  · 곁길 셋은 전부 주 동선에서 **눈에 보입니다.** 숨긴 것은 "위치"가 아니라
 *    "갈지 말지의 선택"입니다. 오공이 "헤매는 것을 줄인다"고 한 게 이 뜻입니다.
 *  · 남쪽 함몰지는 내려가면 **못 올라옵니다**(2단 낙하). 들어갈지가 진짜 결정이 되고,
 *    대신 복귀 램프가 계단으로 이어져 지름길 역할을 합니다.
 *  · 적 배치가 **전투 동사를 순서대로 가르칩니다**:
 *    좁은 통로(기본 콤보) → 넓은 폐허(광역기) → 단상 1:1(백어택) → 함몰지(퇴로 없음) → 보스
 *
 * ── 방 크기를 정하는 기준 ──────────────────────────────────────────
 * 카메라가 세로로 담는 높이가 22m 입니다(CAMERA.viewSize). 방이 그보다 작으면
 * 화면 절반이 허공으로 찹니다. 실제로 첫 판에서 그렇게 나왔습니다.
 * 그래서 **모든 방을 최소 30m(15칸) 이상**으로 잡습니다.
 *
 * 실행: npm run zone
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = path.join(ROOT, 'src', 'levels')

const W = 88
const H = 72
const VOID = -1

const heights = new Array(W * H).fill(VOID)
const entities = []
const regions = []

/** 격자 좌표 -> 월드 좌표 (format.ts 의 cellToWorld 와 같은 식) */
function world(cx, cz) {
  return { x: (cx - W / 2 + 0.5) * 2, z: (cz - H / 2 + 0.5) * 2 }
}

function at(x, z) {
  if (x < 0 || z < 0 || x >= W || z >= H) return VOID
  return heights[z * W + x]
}

/** 사각 영역을 특정 높이로 채웁니다. (끝 좌표 포함) */
function rect(x0, x1, z0, z1, h) {
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || z < 0 || x >= W || z >= H) continue
      heights[z * W + x] = h
    }
  }
}

/** 이름 붙은 구역. 새 구역에 들어서면 이름이 화면에 뜹니다. */
function region(name, x0, x1, z0, z1, hint) {
  regions.push({ name, x0, x1, z0, z1, hint })
}

function put(kind, cx, cz) {
  const { x, z } = world(cx, cz)
  entities.push({ kind, x, z, rotY: 0 })
}

// ── 1. 시작 광장 (h2) — 34m x 42m ───────────────────────────────
// 적이 없습니다. 조작을 익히는 공간이 먼저 있어야 합니다.
rect(5, 22, 26, 46, 2)
put('spawn', 13, 36)
region('버려진 앞마당', 5, 22, 26, 46, '동쪽 성문으로 향하라')

// ── 2. 성문 통로 (h2) — 기본 콤보를 가르치는 곳 ────────────────────
// 폭 9칸(18m). 좌우가 성벽이라 도망갈 곳이 없어 1:1로 붙게 됩니다.
rect(23, 36, 32, 40, 2)
region('무너진 성문', 23, 36, 32, 40, '좁다. 물러설 곳이 없다')
put('grunt', 27, 36)
put('grunt', 33, 35)

// ── 3. 숨은 벽감 (h2) — 통로 남쪽으로 난 곁길 ──────────────────────
// 주 동선에서 **보이지만** 들어가야만 얻습니다.
rect(28, 33, 41, 48, 2)
region('성문 벽감', 28, 33, 41, 48, '길에서 벗어난 곳')
put('treasure', 30, 45)
put('grunt', 30, 46)

// ── 4. 중앙 폐허 (h2) — 40m x 74m. 광역기를 쓰게 되는 넓은 구간 ─────
rect(37, 56, 18, 54, 2)
region('중앙 폐허', 37, 56, 18, 54, '북쪽 단상과 남쪽 함몰지가 보인다')
put('grunt', 41, 25)
put('grunt', 46, 36)
put('grunt', 52, 46)

// ── 5. 북쪽 단상 (h3) — 1단 위. 걸어 올라가는 막다른 곁길 ──────────
// 1:1 구도라 백어택을 연습하기 좋은 자리입니다.
rect(41, 52, 7, 17, 3)
region('북쪽 단상', 41, 52, 7, 17, '막다른 길')
put('treasure', 46, 11)
put('grunt', 46, 15)

// ── 6. 남쪽 함몰지 (h0) — 2단 낙하. **내려가면 못 올라옵니다** ─────
rect(41, 58, 55, 67, 0)
region('남쪽 함몰지', 41, 58, 55, 67, '올라갈 수 없다. 동쪽 비탈로 나가야 한다')
put('treasure', 48, 61)
put('grunt', 45, 59)
put('grunt', 53, 63)

// 복귀 램프 (h0 → h1 → h2). 한 칸씩 올라가므로 걸어서 나갈 수 있습니다.
rect(59, 61, 57, 65, 1)
rect(62, 65, 50, 65, 2)

// ── 7. 계단 (h2 → h3) ───────────────────────────────────────────
rect(57, 66, 28, 50, 2)
rect(67, 70, 32, 46, 3)
region('오르는 계단', 57, 70, 28, 50, '성벽 위로')

// ── 8. 보스 성벽 (h4) — 26m x 70m ───────────────────────────────
rect(71, 83, 22, 56, 4)
region('성벽 위', 71, 83, 22, 56, '수문장이 기다린다')
put('boss', 77, 39)
put('grunt', 73, 27)
put('grunt', 73, 51)
put('treasure', 81, 39)

// ── 9. 성벽 두르기 ──────────────────────────────────────────────
/**
 * 바닥 가장자리 바깥을 자동으로 벽으로 채웁니다.
 *
 * 없으면 방 밖이 전부 허공이라 화면 절반이 검게 비고, 게임이 "떠 있는 판때기"처럼
 * 보입니다. 벽이 있어야 성 안에 들어와 있는 공간감이 생깁니다.
 * 높이는 이웃 바닥보다 3단 위 — 절대 못 올라가고, 시야도 확실히 막습니다.
 */
function buildWalls(thickness = 3, extra = 3) {
  const src = heights.slice()
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (src[z * W + x] !== VOID) continue
      let best = VOID
      for (let dz = -thickness; dz <= thickness; dz++) {
        for (let dx = -thickness; dx <= thickness; dx++) {
          const nx = x + dx
          const nz = z + dz
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
          const v = src[nz * W + nx]
          if (v > best) best = v
        }
      }
      if (best !== VOID) heights[z * W + x] = best + extra
    }
  }
}
buildWalls()

// ── 마무리 ──────────────────────────────────────────────────────
const level = { version: 1, name: '무너진 성문', w: W, h: H, heights, entities, regions }

mkdirSync(OUT_DIR, { recursive: true })
const file = path.join(OUT_DIR, 'broken-gate.json')
writeFileSync(file, JSON.stringify(level))

const spawn = entities.find((e) => e.kind === 'spawn')
const nearest = entities
  .filter((e) => e.kind === 'grunt' || e.kind === 'boss')
  .reduce((m, e) => Math.min(m, Math.hypot(e.x - spawn.x, e.z - spawn.z)), Infinity)
const floor = heights.filter((v) => v !== VOID).length
const counts = entities.reduce((acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc), {})

console.log(`생성: ${file}`)
console.log(`  이름        : ${level.name}`)
console.log(`  격자        : ${W} x ${H} (한 칸 2m → ${W * 2}m x ${H * 2}m)`)
console.log(`  바닥+벽     : ${floor}칸`)
console.log(`  배치        : ${JSON.stringify(counts)}`)
console.log(`  시작~첫 적  : ${nearest.toFixed(1)}m`)
console.log(`  시작 높이   : ${at(13, 36)}`)
console.log(`  구역        : ${regions.length}곳 — ${regions.map((r) => r.name).join(' · ')}`)
