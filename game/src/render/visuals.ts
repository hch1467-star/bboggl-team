import * as THREE from 'three'
import {
  FINISH_COMBO,
  HEAVY_COMBO,
  WEAPONS,
  finisherStep,
  heavyStep,
  longestPlayerReach,
} from '../config/arsenal'
import {
  AttackIntent,
  INTENT_COLOR,
  attackAt,
  attacksFor,
  telegraphRadius,
} from '../config/enemyAttacks'
import {
  AWARE,
  BLEED,
  BOSS,
  COMBAT,
  FOCUS,
  GRUNT,
  GUARD,
  PLAYER,
  TREASURE,
  hearDistance,
} from '../config/balance'
import { BOSS_PHASES } from '../config/bossPhases'
import { isTimingAnswer } from '../config/punish'
import { ENEMY_DEFS, enemyDef } from '../config/enemies'
import {
  Actor,
  ActorState,
  AttackPhase,
  Enemy,
  EnemyKind,
  Health,
  Player,
  Stamina,
  Status,
  Loadout,
  Pickup,
  Renderable,
  Transform,
  Velocity,
} from '../core/components'
import { defineQuery, hasComponent } from '../core/ecs'
/**
 * 강인도 피해 식을 **빌려 옵니다**(다시 쓰지 않습니다). 화면이 판정과
 * 다른 식을 쓰면, 어긋난 날 게임은 안 무너뜨리는데 바만 "지금이다"라고
 * 말합니다 — 틀린 예고는 없는 예고보다 나쁩니다.
 */
import { poiseDamage } from '../systems/combat'
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
export const KIND_TREASURE = 2

/**
 * 적의 렌더 종류는 **EnemyKind 에 상수를 더한 값**입니다.
 *
 * ── 왜 switch 를 지웠는가 ──────────────────────────────────────────
 * 예전에는 종류마다 `case` 를 적고 *"새 적을 추가할 때 여기 한 줄만
 * 빠뜨리지 않으면 됩니다"* 라고 주석까지 달아 두었습니다.
 * 그리고 **빠뜨렸습니다** — 🟢 달려드는 자가 `default` 로 떨어져 잡몹
 * 캡슐을 쓰고 있었고, 몸·예고·등 뒤 표시 도형은 아예 안 만들어졌습니다.
 * `new THREE.Mesh(undefined, mat)` 는 오류 없이 **빈 도형**이 되므로
 * 아무도 몰랐습니다.
 *
 * 주석은 사람에게 부탁하는 것이고, 부탁은 언젠가 잊힙니다.
 * **빠뜨릴 자리를 없애는 편이 낫습니다.**
 */
const ENEMY_RENDER_BASE = 100
export function renderKindForEnemy(kind: EnemyKind): number {
  return ENEMY_RENDER_BASE + kind
}

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
  /** 강인도 게이지 (적 전용) */
  poiseFill?: THREE.Mesh
  /** 🩸 출혈 게이지 — 강인도 바 아래의 가는 선 */
  bleedFill?: THREE.Mesh
  bleedBg?: THREE.Mesh
  /** 🥋 "여기까지 깎으면 강타 한 방" 눈금 — 무기를 바꾸면 자리가 움직입니다. */
  poiseMark?: THREE.Mesh
  /** 등 뒤(백어택) 구역 표시 */
  backZone?: THREE.Mesh
  backZoneMat?: THREE.MeshBasicMaterial
  /** 👀 아직 나를 못 본 적의 발밑 표시 (적 전용) */
  unawareMark?: THREE.Mesh
  unawareMat?: THREE.MeshBasicMaterial
  /** 🔵 속박 표시 (플레이어 전용) */
  snareRing?: THREE.Mesh
  snareMat?: THREE.MeshBasicMaterial
  /** 🔊 발소리가 닿는 거리 (플레이어 전용) */
  noiseRing?: THREE.Mesh
  noiseMat?: THREE.MeshBasicMaterial
  /** 기본 공격 사거리 예고 (플레이어 전용) */
  rangeArc?: THREE.Mesh
  rangeMat?: THREE.MeshBasicMaterial
  /** 보물 등 둥둥 뜨는 오브젝트 */
  floats: boolean
  /** 멀리서도 보이는 빛기둥 (보물 전용) */
  pillar?: THREE.Mesh
  pillarMat?: THREE.MeshBasicMaterial
}

/** 부채꼴 예고 지오메트리. 부채꼴 중심이 로컬 +Z를 향하도록 미리 눕혀 둡니다. */
/**
 * 📏 **등 뒤 표시의 바깥 반지름**(m).
 *
 * 값 자체는 예전 그대로입니다. 함수로 뺀 이유는 **재는 쪽이 물어볼 수
 * 있어야** 하기 때문입니다 — 그린 것과 판정이 어긋나는지 검사하려면
 * *"화면이 어디까지 그렸나"* 가 숫자로 나와야 합니다.
 * (예고 부채꼴에서 정확히 같은 이유로 `telegraphRadius` 를 만들었습니다.)
 *
 * ── ⚠️ **여기에 아직 안 닫은 어긋남이 있습니다** ─────────────────────
 * 예고 부채꼴의 거짓말(그린 선 밖 0.45m 에서 맞음)을 고치고 나서, 같은
 * 부류가 또 있는지 찾다가 이 자리를 봤습니다. 게임이 준 숫자로만 봐도
 * 두 값이 다릅니다:
 *
 *     그리는 쪽 — `backZoneOuter(grunt)` = **1.6m** 짜리 고리
 *     판정 쪽   — `isBehindPoint` … **각도만** 봅니다. **거리 제한 없음**
 *     실제로 닿는 끝 — 1타 사거리 2.3m + 대상 굵기 0.45m = **2.75m**
 *
 * 즉 **1.6m ~ 2.75m 구간(1.15m)** 에서는 등 뒤로 판정되고 타격도 닿는데
 * **표시는 "여기 아님"이라고 말합니다.** 앞서 고친 예고의 거짓말(0.45m)
 * 보다 넓습니다. 백어택은 단검의 정체성인데 자동 플레이에서 20% 밖에
 * 안 나오는 것과 무관하지 않을 수 있습니다 — 표시가 필요 이상으로
 * **붙으라고** 말하고 있으니까요.
 *
 * ⚠️ **아직 고치지 않았습니다.** 살아 있는 타격으로 확인하려고
 *    `flank` 프로브에 검사를 붙였는데, 그 검사가 수렴하지 않았습니다
 *    (등 뒤로 순간이동한 뒤 몸이 도는 0.2초, 앞 측정의 후딜, NaN 필드 —
 *    같은 라운드에 네 번 헛짚었습니다). **이해 못 한 채로 빨간 검사를
 *    남기지 않는다**는 규칙에 따라 그 검사는 되돌렸습니다.
 *
 *    다음 사람이 이어받을 조건: 등 뒤 좌표로 옮긴 뒤 **몸이 다 돌 때까지**
 *    기다리고(회전 900°/s → 최대 0.2초), 앞 측정이 **손을 비울 때까지**
 *    기다린 다음, 고리 밖 여러 거리를 훑어서 *"닿는데 백어택인가"* 를
 *    받아 적을 것. 값이 확인되면 고칠 쪽은 판정이 아니라 **그림**입니다 —
 *    예고에서와 같은 이유로, 관대함 자체는 옳기 때문입니다.
 */
export function backZoneOuter(kind: EnemyKind): number {
  /**
   * ── ✅ **고쳤습니다 — 1.15m 를 사거리로 바꿉니다** ─────────────────
   *
   * 위 ⚠️ 에 적어 둔 어긋남을 살아 있는 타격으로 확인했습니다
   * (`npm run flank`, 정면을 대조군으로 두고 같은 거리를 훑음):
   *
   *     [정면] 0.9 ~ 2.9m — 전부 `앞`   (대조군 정상)
   *     [등 뒤] 0.9 ~ 2.9m — **전부 `백`**
   *     그린 고리 1.6m 밖에서 맞은 6곳 중 **백어택 6곳**
   *
   * 판정에는 거리 제한이 없으므로 **표시가 거짓말이었습니다.**
   *
   * ── 왜 "사거리"인가 ────────────────────────────────────────────
   * 이 고리가 답하는 질문은 *"내가 등 뒤인가"* 이지 *"닿는가"* 가
   * 아닙니다 — 사거리는 플레이어 자신의 공격 표시가 이미 말합니다.
   * 그러니 **등 뒤가 의미를 갖는 범위 전체**를 덮어야 하고, 그건 낼 수
   * 있는 가장 먼 기본 타까지입니다. 무기를 하나 더 넣는 날 표시가
   * 저절로 따라오도록 표에서 계산합니다(arsenal `longestPlayerReach`).
   *
   * 보스가 조금 더 넓던 것(1.5 vs 1.15)은 몸이 커서였는데, 이제 몸
   * 반지름이 이미 더해지므로 그 보정은 필요 없어졌습니다.
   */
  return enemyDef(kind).radius + longestPlayerReach()
}

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

/** 적 종류 표에서 몸통 캡슐을 만듭니다 — 키·굵기가 곧 실루엣입니다. */
function capsuleFor(kind: EnemyKind): THREE.CapsuleGeometry {
  const cfg = enemyDef(kind)
  return new THREE.CapsuleGeometry(cfg.radius, cfg.height - cfg.radius * 2, 6, 12)
}

/**
 * ── 종류마다 다른 **실루엣 표식** ─────────────────────────────────
 *
 * 이 파일에는 오래 이렇게 적혀 있었습니다:
 *
 *   > 적은 전부 붉은 계열, 종류는 명도·채도와 **실루엣**으로 가릅니다.
 *
 * 그런데 실제로 만들던 것은 **크기만 다른 같은 캡슐 여섯 개**였습니다.
 * 실루엣이라 부를 것이 없었고, 검사도 `키 차이 0.3m` 하나뿐이라
 * "같은 모양을 조금 늘린 것"을 통과시키고 있었습니다. 쿼터뷰에서 적은
 * 화면의 몇십 픽셀이라, 0.3m 차이는 **모양이 아니라 크기**입니다.
 *
 * 읽히는 실루엣의 규칙은 오버워치·디아블로가 같은 말로 정리해 뒀습니다:
 * **윤곽만 보고 무엇인지 알 수 있어야 합니다.** 색이 아니라 윤곽인 이유는,
 * 색은 배경·조명·색각에 따라 흔들리지만 윤곽은 안 흔들리기 때문입니다.
 *
 * ⚠️ **손으로 적은 목록을 만들지 않습니다.** 이 파일이 이미 그 실수를 한 번
 *    했고(🟢 달려드는 자를 세 곳에서 빠뜨려 몸도 예고도 안 보였습니다),
 *    같은 자리에 또 심을 이유가 없습니다. 표식은 **그 적이 하는 일**에서
 *    유도합니다 — 묶는 적은 집게, 끄는 적은 갈고리, 달려드는 적은 뿔,
 *    멀리서 쏘는 적은 활. 적을 새로 넣어도 표식은 저절로 붙습니다.
 */
function silhouetteFor(kind: EnemyKind, mat: THREE.Material): THREE.Mesh[] {
  const cfg = enemyDef(kind)
  const atks = attacksFor(kind)
  const has = (i: AttackIntent) => atks.some((a) => a.intent === i)
  const reach = atks.reduce((m, a) => Math.max(m, a.reach), 0)
  const out: THREE.Mesh[] = []
  const r = cfg.radius
  const h = cfg.height

  if (kind === EnemyKind.Boss) {
    /**
     * 보스 — 벌어진 뿔 **한 쌍 + 넓은 어깨판.**
     *
     * 뿔만 달았더니 쏘는 자(머리 위의 활)와 IoU 0.74 로, 기준 0.75 에
     * 0.01 차이였습니다. 통과는 했지만 **그건 여유가 아닙니다** — 조명이나
     * 카메라를 조금만 건드려도 뒤집힙니다. 그리고 하필 보스는 이 존에서
     * 한눈에 읽혀야 할 **첫 번째** 상대입니다.
     *
     * 그래서 위로만 뻗던 것을 **옆으로도** 벌립니다. 크기를 지운 뒤에도
     * 남는 것이 "위가 넓은 사다리꼴"이라, 위로 가늘게 솟는 활과 구조가
     * 다릅니다. 큰 것이 아니라 **다른 것**으로 읽히게 하는 게 목적입니다.
     */
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.22, h * 0.5, 5), mat)
      horn.position.set(side * r * 0.72, h * 0.92, 0)
      horn.rotation.z = side * -0.45
      out.push(horn)
      const pauldron = new THREE.Mesh(new THREE.BoxGeometry(r * 0.85, r * 0.4, r * 0.9), mat)
      pauldron.position.set(side * r * 1.05, h * 0.72, 0)
      pauldron.rotation.z = side * -0.25
      out.push(pauldron)
    }
  } else if (has(AttackIntent.Snare)) {
    // 🔵 묶는 적 — 좌우로 길게 뻗은 집게 팔. 폭이 넓어져 윤곽이 T자가 됩니다.
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(r * 2.1, r * 0.3, r * 0.3), mat)
      arm.position.set(side * r * 1.25, h * 0.68, 0)
      arm.rotation.z = side * 0.22
      out.push(arm)
    }
  } else if (has(AttackIntent.Pull)) {
    // 🟣 끄는 적 — 등에 솟은 갈고리 장대. 세로로 튀어나와 키가 커 보입니다.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, h * 0.85, 5), mat)
    pole.position.set(-r * 0.75, h * 0.95, -r * 0.35)
    pole.rotation.z = 0.3
    out.push(pole)
    const hook = new THREE.Mesh(new THREE.TorusGeometry(r * 0.42, r * 0.11, 4, 8, Math.PI * 1.3), mat)
    hook.position.set(-r * 1.15, h * 1.3, -r * 0.35)
    hook.rotation.set(Math.PI / 2, 0, 0.3)
    out.push(hook)
  } else if (has(AttackIntent.Counter)) {
    /**
     * 🟢 달려드는 적 — **가슴 높이에서 앞으로 뻗은 넓은 뿔.**
     *
     * 처음엔 머리 위에 세웠는데 쏘는 자의 활과 겹쳐 IoU 0.80 이 나왔습니다
     * (기준 0.75). 둘 다 "머리 위에 뭐가 있는 놈"이라 윤곽이 닮았던 것입니다.
     * 이 적의 정체는 **앞으로 돌진**이므로 무게를 앞·아래로 내렸습니다 —
     * 낮고 넓은 쐐기 대 높고 가는 활, 이제 위아래로 갈립니다.
     */
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3, h * 0.62, 5), mat)
      // 앞이 아니라 **앞·옆·아래**로 뻗습니다. 정면으로만 뻗으면 이 카메라에서
      // 짧아 보여(원근 단축) 윤곽이 거의 안 바뀝니다.
      horn.position.set(side * r * 1.15, h * 0.46, r * 0.7)
      horn.rotation.x = 1.25
      horn.rotation.z = side * 0.85
      out.push(horn)
    }
  } else if (reach >= 10) {
    /**
     * 🔴 멀리서 쏘는 적 — **머리 위로 솟은 큰 활.**
     * 이 적의 정체는 거리이고, 거리에서 읽히려면 **위로** 튀어야 합니다.
     */
    const bow = new THREE.Mesh(new THREE.TorusGeometry(h * 0.42, r * 0.11, 4, 14, Math.PI * 1.15), mat)
    bow.position.set(r * 0.15, h * 1.02, -r * 0.5)
    bow.rotation.set(0, Math.PI / 2, Math.PI * 0.5)
    out.push(bow)
  }
  for (const m of out) {
    m.castShadow = true
    m.receiveShadow = true
  }
  return out
}

/** 무기를 든 팔이 쉬는 자세(라디안). 몸 오른쪽에 비스듬히 내려둔 상태. */
const REST_SWING = 0.75
const REST_TILT = 0.25

export class Visuals {
  private readonly items = new Map<number, Visual>()
  private readonly query = defineQuery(Transform, Renderable)

  private readonly geos: Record<number, THREE.BufferGeometry>
  /** 적 공격 패턴 id -> 예고 부채꼴 */
  private readonly telegraphGeos = new Map<string, THREE.BufferGeometry>()
  /** "무기id:콤보단계" -> 기본 공격 사거리 부채꼴. 쓸 때 만들어 캐시합니다. */
  private readonly rangeGeos = new Map<string, THREE.BufferGeometry>()
  private readonly backZoneGeos: Record<number, THREE.BufferGeometry>
  private readonly hpBarGeo: THREE.PlaneGeometry
  private readonly pillarGeo: THREE.BufferGeometry
  private readonly bonfireFlames: THREE.Mesh[] = []
  private readonly ladderGroups: THREE.Group[] = []
  private readonly dropRings: THREE.Mesh[] = []

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    this.geos = {
      [KIND_PLAYER]: new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2, 6, 14),
      [KIND_TREASURE]: new THREE.OctahedronGeometry(0.42),
    }
    this.backZoneGeos = {}
    /**
     * ── 손으로 적던 목록을 **적 표에서 유도**하도록 바꿨습니다 ──────────
     *
     * 예전에는 몸·예고·등 뒤 표시를 종류마다 손으로 적어 두었습니다.
     * 그리고 정확히 예상된 일이 일어났습니다 — **🟢 달려드는 자를 넣을 때
     * 세 곳 다 빠뜨렸습니다.**
     *
     * 결과가 조용했습니다. `new THREE.Mesh(undefined, mat)` 는 오류를 내지
     * 않고 **빈 도형**을 만듭니다. 그래서 달려드는 자는 몸도, 예고도, 등 뒤
     * 표시도 안 보이는 채로 존에 서 있었습니다. 하필 🟢 은 *"예고를 읽고
     * 앞으로 나가라"* 는 색이라, **읽을 것이 안 보이는데 읽으라고** 하고
     * 있었던 셈입니다. 반격이 판마다 1~4회뿐이던 데는 이 몫도 있습니다.
     *
     * 이런 종류의 빠뜨림은 주석으로 못 막습니다("여기 한 줄만 빠뜨리지
     * 않으면 됩니다"라고 적혀 있었는데도 빠뜨렸습니다). **적 표를 돌면
     * 빠뜨릴 자리가 없어집니다.**
     */
    for (const kind of Object.keys(ENEMY_DEFS).map(Number) as EnemyKind[]) {
      const rk = renderKindForEnemy(kind)
      if (!this.geos[rk]) this.geos[rk] = capsuleFor(kind)
      // 보스는 몸이 커서 등 뒤 구역도 조금 더 넓게 잡습니다(원래 값 유지).
      if (!this.backZoneGeos[rk]) {
        const cfg = enemyDef(kind)
        this.backZoneGeos[rk] = makeSectorGeometry(
          cfg.radius + 0.1,
          backZoneOuter(kind),
          COMBAT.backArcDeg,
        )
      }
      // 예고 도형은 **패턴마다** 다릅니다. 색만 바꾸고 모양이 같으면
      // "노랑은 넓다"가 거짓말이 됩니다 — 색이 아니라 크기가 먼저 읽히기 때문입니다.
      for (const def of attacksFor(kind)) {
        /**
         * 📏 **실제로 맞는 자리까지 그립니다** — `reach` 가 아니라
         * `telegraphRadius(def)`(= reach + 내 몸 굵기). 근거는
         * enemyAttacks.ts 의 그 함수 주석에 한 번만 적어 뒀습니다.
         * 요약: 판정은 몸이 겹치면 맞는데, 그림은 선까지만 그리고
         * 있었습니다 — 선 밖 0.45m 에서 맞는 것을 재서 확인했습니다.
         */
        this.telegraphGeos.set(def.id, makeSectorGeometry(0.35, telegraphRadius(def), def.arcDeg))
      }
    }
    this.hpBarGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0)
    this.pillarGeo = makePillarGeometry()
  }

  /** 기본 공격 사거리 도형을 캐시에서 꺼내거나 만듭니다. */
  private rangeGeoFor(weaponId: string, comboIndex: number): THREE.BufferGeometry {
    const key = `${weaponId}:${comboIndex}`
    let geo = this.rangeGeos.get(key)
    if (!geo) {
      const w = WEAPONS.find((x) => x.id === weaponId) ?? WEAPONS[0]
      // 🥋 강타는 콤보 마무리보다 넓고 깁니다. 사거리 예고도 같은 데이터에서
      // 나와야 "예고는 좁은데 실제로는 넓다" 같은 거짓말이 생기지 않습니다.
      // (집중 소모량은 사거리에 영향이 없으므로 0으로 뽑습니다.)
      const step =
        comboIndex === HEAVY_COMBO
          ? heavyStep(w, 0)
          : comboIndex === FINISH_COMBO
            ? finisherStep(w)
            : w.combo[Math.min(comboIndex, w.combo.length - 1)]
      // **테두리만** 그립니다. 적 예고는 꽉 찬 부채꼴이라, 내 것도 채우면
      // 파랑 예고(속박)와 헷갈립니다 — 플레이어 캡슐도 파란색이라 더 그렇습니다.
      // 채우기 vs 선은 색보다 강한 구분이고, "내 사거리가 여기서 끝난다"는
      // 정보 자체도 면적이 아니라 **가장자리**에 있습니다.
      geo = makeSectorGeometry(Math.max(0.3, step.range - 0.22), step.range, step.arcDeg)
      this.rangeGeos.set(key, geo)
    }
    return geo
  }

  attach(entity: number, kind: number): void {
    if (this.items.has(entity)) return
    const group = new THREE.Group()

    if (kind === KIND_TREASURE) {
      this.attachTreasure(entity, group)
      return
    }

    const isPlayer = kind === KIND_PLAYER
    // 이 엔티티가 어떤 적인지. 색·크기·예고 도형이 전부 여기서 나옵니다.
    const enemyKind: EnemyKind = hasComponent(Enemy, entity) ? Enemy.kind[entity] : EnemyKind.Grunt
    const isBoss = !isPlayer && hasComponent(Enemy, entity) && enemyKind === EnemyKind.Boss
    const cfg = isPlayer ? PLAYER : enemyDef(enemyKind)
    // 색 배정 규칙은 config/enemies.ts 의 ENEMY_DEFS 주석에 정리돼 있습니다.
    // 요약: 적은 전부 붉은 계열, 종류는 명도·채도와 **실루엣**으로 가릅니다.
    const baseColor = new THREE.Color(isPlayer ? 0x5fa8ff : enemyDef(enemyKind).color)
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

    // 종류를 윤곽으로 가르는 표식(위 silhouetteFor 설계 노트).
    if (!isPlayer) for (const part of silhouetteFor(enemyKind, material)) group.add(part)

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

      // 🔵 속박 표시 — 발밑의 파란 족쇄.
      //
      // 이게 없으면 플레이어는 "왜 갑자기 느려졌지?"라고만 느낍니다.
      // 파랑 예고 → 파란 족쇄로 **색을 이어 붙여야** "아, 저 파란 공격에 맞으면
      // 이렇게 되는구나"를 한 번에 배웁니다. 색 구분의 목적은 학습이지 장식이 아닙니다.
      const snareMat = new THREE.MeshBasicMaterial({
        color: INTENT_COLOR[AttackIntent.Snare],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
      const snareRing = new THREE.Mesh(
        new THREE.RingGeometry(PLAYER.radius + 0.12, PLAYER.radius + 0.42, 28).rotateX(-Math.PI / 2),
        snareMat,
      )
      snareRing.position.y = 0.05
      snareRing.renderOrder = 3
      snareRing.visible = false
      group.add(snareRing)
      visual.snareRing = snareRing
      visual.snareMat = snareMat

      /**
       * 🔊 **발소리가 닿는 거리** — 반지름이 곧 규칙입니다.
       *
       * 메탈기어의 소리 원, 쓰시마의 감지 링이 하는 일입니다. 이 게임의
       * 새 선택(걷기 ↔ 질주)은 **눈에 보이지 않으면 존재하지 않습니다.**
       * 아무도 *"뛰면 더 멀리 들린다"* 를 스스로 알아내지 못합니다.
       *
       * ⚠️ 반지름을 여기서 **계산하지 않습니다.** `balance.ts hearDistance()`
       *    가 낸 값을 그대로 받아 그립니다. 여기서 한 번 더 계산하면
       *    화면과 규칙이 언젠가 갈라지고, 그때 플레이어는 **보이는 대로
       *    했는데 들키는** 경험을 하게 됩니다. 그건 버그보다 나쁩니다.
       *
       * 지오메트리는 반지름 1로 만들고 `scale` 로 키웁니다 — 매 프레임
       * 도형을 새로 만들면 이 게임이 8~20fps 인 환경에서 값이 비쌉니다.
       */
      const noiseMat = new THREE.MeshBasicMaterial({
        color: 0xcfe0f5,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const noiseRing = new THREE.Mesh(
        new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2),
        noiseMat,
      )
      noiseRing.position.y = 0.03
      noiseRing.renderOrder = 1
      noiseRing.visible = false
      group.add(noiseRing)
      visual.noiseRing = noiseRing
      visual.noiseMat = noiseMat

      // 기본 공격 사거리 예고. 도형은 콤보 단계마다 갈아 끼웁니다(syncPlayerRange).
      const rangeMat = new THREE.MeshBasicMaterial({
        color: 0xeaf4ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
      const rangeArc = new THREE.Mesh(this.rangeGeoFor(WEAPONS[0].id, 0), rangeMat)
      rangeArc.position.y = 0.035
      rangeArc.renderOrder = 2
      rangeArc.visible = false
      group.add(rangeArc)
      visual.rangeArc = rangeArc
      visual.rangeMat = rangeMat
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
      const telegraph = new THREE.Mesh(this.telegraphGeos.get(attacksFor(enemyKind)[0].id)!, telegraphMat)
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

      /**
       * 👀 **아직 나를 못 본 적** — 발밑에 얇은 무채색 링.
       *
       * ── 왜 이 모양인가 ────────────────────────────────────────────
       * ① **색이 아니라 무채색.** 이 게임에서 색은 *"어떻게 답하라"* 는
       *    뜻입니다(4색 표). 다섯 번째 색을 만들면 그 표가 무너집니다.
       *    "아직 못 봤다"는 답을 요구하는 정보가 아니라 **기회**의 정보라,
       *    색 체계 **밖**에 있어야 맞습니다.
       * ② **깜빡이지 않습니다.** 이 저장소에서 맥동은 전부 *"시간이 간다"*
       *    는 뜻입니다(예고, 속박). 자고 있는 것은 재촉이 아니므로 조용히
       *    켜 둡니다.
       * ③ **발밑입니다.** 쿼터뷰에서 머리 위 아이콘은 적이 겹치면 서로
       *    가립니다. 이 게임은 이미 모든 정보를 바닥에 그리고 있으므로
       *    같은 자리를 씁니다 — 새 어휘를 안 늘리는 것이 읽기 비용을
       *    안 늘리는 길입니다.
       */
      const unawareMat = new THREE.MeshBasicMaterial({
        color: 0xdfe6f0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        /**
         * ⚠️ **가산 혼합**입니다. 처음엔 보통 혼합에 얇은 띠로 그렸다가
         *    픽셀 검사에 걸렸습니다 — ΔE 1.3. 그건 *"나란히 놓고 봐야
         *    구분되는"* 차이라 정보라고 부를 수 없습니다.
         *
         *    이 저장소가 예고 부채꼴에서 이미 배운 것과 같은 답입니다:
         *    **바닥이 어두우면 색조를 만지는 것보다 밝기를 얹는 쪽이 이깁니다.**
         *    가산은 어두운 바닥 위에서 그대로 더해지므로 같은 진하기로도
         *    훨씬 잘 읽힙니다.
         */
        blending: THREE.AdditiveBlending,
      })
      const unawareMark = new THREE.Mesh(
        // 띠를 넓힙니다 — 5m 밖에서는 0.14m 띠가 한두 픽셀밖에 안 됩니다.
        new THREE.RingGeometry(cfg.radius + 0.12, cfg.radius + 0.42, 32).rotateX(-Math.PI / 2),
        unawareMat,
      )
      unawareMark.position.y = 0.045
      unawareMark.renderOrder = 2
      unawareMark.visible = false
      group.add(unawareMark)
      visual.unawareMark = unawareMark
      visual.unawareMat = unawareMat

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
      /**
       * 강인도 게이지 — 체력바 **아래에 얇게** 붙입니다.
       *
       * 보이지 않으면 "언제 몰아쳐야 무너지는가"를 판단할 수 없고, 그러면
       * 무너짐은 우연히 일어나는 일이 됩니다. 판단이 되려면 보여야 합니다.
       *
       * 체력바보다 얇고 흰 계열인 이유: 체력이 **주 정보**이기 때문입니다.
       * 같은 굵기·같은 채도로 두면 둘 중 뭘 봐야 하는지 헷갈립니다.
       */
      const poiseBg = new THREE.Mesh(
        this.hpBarGeo,
        new THREE.MeshBasicMaterial({ color: 0x11151c, depthTest: false, transparent: true, opacity: 0.75 }),
      )
      poiseBg.scale.set(barW, isBoss ? 0.1 : 0.07, 1)
      poiseBg.position.set(-barW / 2, isBoss ? -0.17 : -0.12, 0)
      poiseBg.renderOrder = 10
      const poiseFill = new THREE.Mesh(
        this.hpBarGeo,
        new THREE.MeshBasicMaterial({ color: 0xdfe7f2, depthTest: false }),
      )
      poiseFill.scale.set(barW, isBoss ? 0.075 : 0.05, 1)
      poiseFill.position.set(-barW / 2, isBoss ? -0.17 : -0.12, 0.001)
      poiseFill.renderOrder = 11
      /**
       * 🥋 **강타 눈금** — *"여기까지 깎으면 한 방에 무너진다"*.
       *
       * ── 왜 이게 필요한가 (재고 나서 넣었습니다) ────────────────────
       * 실전 리듬으로 재 보니 평타만으로 잡몹(강인도 30)을 무너뜨리려면
       * 대검 11주기 · 롱소드 26 · 쌍단검 72 였습니다. 반면 강타 한 방은
       * 54.6 × 무기 배수라 잡몹은 **현재 강인도와 무관하게 즉시** 무너집니다.
       * 즉 잡몹에게는 이 바가 눈금 없이도 아무 판단을 안 만듭니다.
       *
       * 판단이 생기는 곳은 큰 적입니다 — 강인도 45 짜리를 쌍단검 강타는
       * 27.3 밖에 못 깎아서 **미리 깎아 둬야만** 무너집니다. 보스는 셋 다
       * 두 번 이상 필요합니다. 그런데 지금 플레이어에게는 *"이번 강타로
       * 무너지는가"* 를 알 방법이 **하나도 없습니다.** 그러면 집중을 태우는
       * 결정이 판단이 아니라 도박이 됩니다.
       *
       * ── 참고한 게임들 ─────────────────────────────────────────────
       *   · 세키로 — 체간이 꽉 차기 직전에 게이지가 번쩍입니다
       *   · P의 거짓 — 스태거 가능해지면 체력바가 하얗게 깜빡입니다
       *   · 로스트아크 — 무력화 게이지를 **따로** 그려서 "지금 몰아쳐"를 알립니다
       *   · 몬스터 헌터 — 부위 파괴가 임박했음을 반응으로 알려 줍니다
       * 공통점은 **임계를 미리 보여 준다**는 것입니다. 사후에만 알려 주면
       * 그건 결과 통보이지 판단 재료가 아닙니다.
       *
       * 눈금이 오른쪽 끝에 붙어 있으면 = 가득 찼어도 한 방(잡몹).
       * 왼쪽에 있으면 = 그만큼 깎아 놔야 한다(큰 적·보스).
       * **무기를 바꾸면 눈금이 움직입니다** — 무기 정체성이 처음으로 눈에 보입니다.
       */
      const poiseMark = new THREE.Mesh(
        this.hpBarGeo,
        new THREE.MeshBasicMaterial({ color: 0xffd479, depthTest: false, transparent: true }),
      )
      poiseMark.scale.set(0.045, isBoss ? 0.16 : 0.11, 1)
      poiseMark.position.set(-barW / 2, isBoss ? -0.17 : -0.12, 0.002)
      poiseMark.renderOrder = 12
      /**
       * 🩸 **출혈 게이지** — 강인도 바 **아래**의 가는 선.
       *
       * ── 왜 필요한가 ────────────────────────────────────────────────
       * 축을 넣고 터질 때만 스파크를 튀겼습니다. 그러면 플레이어가 겪는
       * 것은 규칙이 아니라 *"가끔 피가 크게 깎인다"* 입니다. 원인이 안
       * 보이면 배울 것이 없고, 배울 것이 없으면 무기를 고르는 이유도
       * 안 생깁니다 — 이 저장소가 인지 규칙에서 이미 배운 그대로입니다.
       * 소울류가 축적 게이지를 띄우는 이유도 같습니다.
       *
       * ── 왜 이렇게 생겼나 ───────────────────────────────────────────
       * · **더 얇게**(강인도의 절반) — 셋째 정보이므로 셋째로 눈에 들어와야
       *   합니다. 체력 > 강인도 > 출혈 순서를 굵기가 말해 줍니다.
       * · **0일 때 배경도 숨깁니다** — 대검처럼 이 축을 안 쓰는 무기로
       *   싸울 때 빈 칸이 늘 떠 있으면, 있지도 않은 축을 보고 있게 됩니다.
       * · 붉은 계열 — 4색 예고(빨강 직격)와 헷갈릴 위험이 있지만, 예고는
       *   **바닥 도형**이고 이것은 **머리 위 바**라 자리가 다릅니다.
       */
      const bleedBg = new THREE.Mesh(
        this.hpBarGeo,
        new THREE.MeshBasicMaterial({ color: 0x180d0d, depthTest: false, transparent: true, opacity: 0.7 }),
      )
      bleedBg.scale.set(barW, isBoss ? 0.055 : 0.04, 1)
      bleedBg.position.set(-barW / 2, isBoss ? -0.245 : -0.175, 0)
      bleedBg.renderOrder = 10
      const bleedFill = new THREE.Mesh(
        this.hpBarGeo,
        new THREE.MeshBasicMaterial({ color: 0xd9455a, depthTest: false, transparent: true }),
      )
      bleedFill.scale.set(0, isBoss ? 0.04 : 0.028, 1)
      bleedFill.position.set(-barW / 2, isBoss ? -0.245 : -0.175, 0.001)
      bleedFill.renderOrder = 11
      hpBar.add(bleedBg, bleedFill)
      hpBar.add(poiseBg, poiseFill, poiseMark)
      visual.poiseFill = poiseFill
      visual.poiseMark = poiseMark
      visual.bleedFill = bleedFill
      visual.bleedBg = bleedBg

      hpBar.add(bg, fill)

      /**
       * 보스 체력바에 **페이즈 눈금**을 새깁니다.
       *
       * 페이즈가 결정적(체력 비율)이라는 설계는, 플레이어가 그 경계를 볼 수
       * 있을 때에만 값어치가 있습니다. 눈금이 없으면 "언젠가 갑자기 바뀐다"가
       * 되어 결국 무작위와 구분되지 않습니다. 눈금이 있으면
       * **"저기 닿기 전에 물약을 쓸까"** 같은 판단이 생깁니다.
       */
      if (isBoss) {
        for (let i = 1; i < BOSS_PHASES.length; i++) {
          const tick = new THREE.Mesh(
            this.hpBarGeo,
            new THREE.MeshBasicMaterial({ color: 0xffe08a, depthTest: false }),
          )
          tick.scale.set(0.05, 0.3, 1)
          tick.position.set(-barW / 2 + barW * BOSS_PHASES[i].enterBelow, 0, 0.002)
          tick.renderOrder = 12
          hpBar.add(tick)
        }
      }

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
  sync(playerX: number, playerZ: number, player: number): void {
    /**
     * 🎯 **가장 가까운 적** — 등 뒤 표시를 하나에게만 주기 위해 먼저 고릅니다.
     * (자세한 이유는 아래 `backZone` 자리의 설계 노트에.)
     */
    let nearestFoe = -1
    {
      let best = Infinity
      for (const [e, v] of this.items.entries()) {
        if (!v.backZone || Actor.state[e] === ActorState.Dead) continue
        const d = Math.hypot(Transform.x[e] - playerX, Transform.z[e] - playerZ)
        if (d < best) {
          best = d
          nearestFoe = e
        }
      }
    }
    this.syncBonfires()
    /**
     * 🥋 이번 강타가 깎을 강인도를 **한 번만** 구합니다.
     *
     * `poiseScale` 만 넘기고 실제 곱은 `poiseDamage()` 에게 맡깁니다 —
     * 판정과 표시가 같은 함수를 써야 눈금이 거짓말을 안 합니다.
     * 집중 점수는 **피해만** 키우고 강인도는 안 키우므로(arsenal heavyStep),
     * 눈금 위치는 무기와 적으로만 정해지는 안정된 값입니다.
     */
    const heavyScale = WEAPONS[Loadout.weapon[player]]?.poiseScale ?? 1
    const heavyTrauma = FOCUS.heavy.trauma
    /**
     * **낼 수 없으면 "지금이다"라고 말하지 않습니다.**
     * 집중이 없거나 스태미나가 모자라면 강타가 안 나가는데(playerControl
     * 의 거절음 자리와 같은 조건), 그때 바가 반짝이면 예고가 아니라
     * 거짓말입니다. 눈금은 늘 두되 **맥동은 낼 수 있을 때만** 합니다.
     */
    const heavyReady =
      Player.focus[player] >= 1 && Stamina.value[player] >= FOCUS.heavy.staminaCost
    this.syncDrops()
    const ids = this.query.run()
    /**
     * 🔊 발소리 링을 **켤 이유가 있는가** — 근처에 아직 못 본 적이 있는가.
     *
     * 싸움이 붙은 뒤에도 계속 깔려 있으면 그건 정보가 아니라 방해입니다.
     * 이 게임은 바닥을 예고 부채꼴에 쓰고 있어서 특히 그렇습니다.
     * 한 번만 세어서 아래 루프가 같은 답을 씁니다.
     */
    let unawareNear = false
    for (let i = 0; i < this.query.count && !unawareNear; i++) {
      const e = ids[i]
      if (!hasComponent(Enemy, e) || Enemy.aggro[e] !== 0) continue
      if (Actor.state[e] === ActorState.Dead) continue
      if (Math.hypot(Transform.x[e] - playerX, Transform.z[e] - playerZ) < AWARE.noiseRingRange)
        unawareNear = true
    }
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
      /**
       * 페이즈 전환 중에는 **금빛으로 타오릅니다.**
       * 무적이라 피격 플래시가 아예 안 뜨는데, 아무 반응이 없으면 플레이어는
       * "왜 안 맞지?"를 버그로 읽습니다. 색으로 "지금은 못 때린다"를 말해 줍니다.
       * 맥동시키는 이유: 정지된 빛은 상태가 아니라 재질처럼 보입니다.
       */
      const transition = hasComponent(Enemy, e) ? Enemy.transitionT[e] : 0
      if (transition > 0) {
        const pulse = 0.55 + 0.45 * Math.sin(time.elapsed * 26)
        v.material.emissive.setRGB(pulse, pulse * 0.72, pulse * 0.2)
      } else if (flash > 0) {
        const k = Math.min(1, flash)
        v.material.emissive.setRGB(k, k * 0.85, k * 0.7)
      } else if (v.material.emissive.r !== 0) {
        v.material.emissive.setRGB(0, 0, 0)
      }

      this.syncSnare(e, v)
      this.syncNoise(e, v, unawareNear)
      this.syncPlayerRange(e, v)

      // ---- 4색 예고 (DESIGN.md 기둥 2) ----
      // 모양(사거리·각도)과 색(요구되는 대응)이 **같은 데이터**에서 나옵니다.
      // 그래서 "노랑은 넓다"가 연출이 아니라 사실입니다.
      if (v.telegraph && v.telegraphMat) {
        const attacking = Actor.state[e] === ActorState.Attack
        const winding = attacking && Actor.phase[e] === AttackPhase.Windup
        const striking = attacking && Actor.phase[e] === AttackPhase.Active
        if (winding || striking) {
          const def = attackAt(Enemy.kind[e], Enemy.attackIndex[e])
          const geo = this.telegraphGeos.get(def.id)
          if (geo && v.telegraph.geometry !== geo) v.telegraph.geometry = geo
          v.telegraph.visible = true
          if (winding) {
            /**
             * ── ⏳ **차오름은 「실제로 건 예고」로 잽니다** ─────────────
             *
             * 예전에는 `def.windup`(설정값)으로 나눴습니다. 그 값은
             * **페이즈 배율도 지연도 모릅니다.** 두 가지가 조용히 깨져
             * 있었습니다:
             *
             *   · 보스 3단계(×0.9) — 실제 예고가 더 짧은데 분모는 그대로라
             *     **다 차기 전에 칼이 나옵니다.** 차오름이 "이제 온다"를
             *     말해 주지 못합니다.
             *   · 지연 공격(`hold`) — 분자가 분모보다 커서 `p` 가 **음수**로
             *     시작합니다. 투명도가 0 아래로 눌리므로 뜸 들인 공격은
             *     처음 0.35초 동안 **아예 안 보입니다.** 지연을 넣으면서
             *     제가 만든 버그이고, 예고가 늦게 뜨는 것은 난이도가 아니라
             *     그냥 거짓말입니다.
             *
             * `Enemy.windupLen` 은 `commitAttack` 이 실제로 건 값입니다.
             * **게임이 판단하고 화면은 읽습니다** — 이 저장소가 프로브에
             * 적용해 온 규약을 렌더에도 그대로 씁니다.
             *
             * 이렇게 두면 지연이 **공정해집니다**: 뜸 들인 공격은 부채꼴이
             * 그만큼 **천천히** 차오릅니다. 박자를 세던 사람은 걸리고,
             * 화면을 본 사람은 그대로 답할 수 있습니다. 쿼터뷰에서 몸동작을
             * 읽기 어려운 것을 지면 표시로 푸는 것은 로스트아크가 쓰는
             * 방법이기도 합니다.
             */
            /**
             * ⚠️ 분모가 0이면 **설정값으로 물러섭니다.** `windupLen` 은
             *    상태를 세우는 모든 자리가 채워야 하는 값인데, 하나라도
             *    빠뜨리면 투명도가 0 으로 눌려 **예고가 아예 안 보입니다.**
             *    실제로 `debugForceAttack` 이 빠뜨려서 contrast 프로브가
             *    6개 빨개졌습니다. 안전망은 두되, 고칠 곳은 세우는 쪽입니다.
             */
            const len = Enemy.windupLen[e] > 0 ? Enemy.windupLen[e] : def.windup
            const p = 1 - Actor.timer[e] / Math.max(0.001, len) // 0 -> 1
            /**
             * ── 최고 투명도 0.54 → 0.68 ────────────────────────────────
             *
             * `npm run contrast` 로 **화면에 실제로 그려진 색**을 재 보니
             * 네 색이 전부 좁은 띠 안에 눌려 있었습니다 (ΔE 22~37).
             * 색을 아무리 밝게 잡아도 화면에 닿는 양이 절반뿐이면
             * **바탕이 이깁니다** — 파랑을 rgb(53,167,255) 에서
             * (110,231,255) 로 크게 밀어 올렸는데 ΔE 는 22.0 → 25.3,
             * 기준선을 겨우 0.3 넘겼습니다. 색이 문제가 아니라 **천장**이
             * 문제라는 뜻입니다.
             *
             * 그래서 색이 아니라 여기를 올립니다. 시작값(0.12)은 그대로라
             * "뜨자마자 눈에 확 튀는" 일은 없고, **차오르는 문법**도
             * 그대로입니다. 끝에서만 더 또렷해집니다 — 답해야 하는 순간에
             * 가장 잘 보이는 쪽이 맞습니다.
             */
            /**
             * ── 0.12 + p×0.56 → 0.16 + p×0.72 ────────────────────────
             *
             * 색을 아무리 잘 골라도 다섯 색이 서로 안 갈리길래, **색이
             * 아니라 투명도가 병목**이라는 것을 재서 확인했습니다.
             *
             * 예고는 지면 위에 얹히므로 화면에 찍히는 색은
             * `투명도×색 + (1−투명도)×바닥` 입니다. 즉 **색끼리의 거리도
             * 투명도만큼 눌립니다** — 0.54 에서는 원색 거리의 약 0.45배만
             * 남았습니다. 그래서 색상만 옮기는 것으로는 한계가 있었습니다:
             *
             *     🟡 vs 🟢  색만 옮겨서  13.5 → 23.3 (기준 25 미달)
             *     여기서 투명도를 올려          → **27.7** (통과)
             *
             * 바탕 대비도 같이 올라갑니다(🔴 34.7→44.5 · 🟢 44.9→53.0).
             * ⚠️ 대신 예고가 깔린 동안 지면 무늬가 그만큼 덜 보입니다.
             *    더 올리면 바닥이 안 읽히므로 여기가 타협점입니다.
             */
            v.telegraphMat.opacity = 0.16 + p * 0.72
            /**
             * 🟢 반격만 **깜빡입니다.**
             *
             * 다른 넷은 차오르기만 합니다("점점 위험해진다"). 반격은 요구하는
             * 동작이 정반대(피하지 말고 앞으로)라, 같은 문법으로 표시하면
             * 색이 안 보이는 사람에게는 그냥 또 하나의 위험 장판입니다.
             * **움직임이 다르면 색이 안 보여도 다른 것**임이 읽힙니다.
             */
            if (def.intent === AttackIntent.Counter) {
              v.telegraphMat.opacity *= 0.55 + 0.45 * Math.abs(Math.sin(time.elapsed * 11))
            }
            v.telegraphMat.color.setHex(INTENT_COLOR[def.intent])
            /**
             * ── ⏱ **「지금」 — 타이밍으로 푸는 색에만** ────────────────
             *
             * ── 왜 필요했나 (잰 숫자) ─────────────────────────────────
             * 저스트 가드를 넣고 자동 플레이로 재 보니, 붙잡은 🔴 **26회 중
             * 성공 4회**였습니다. 창이 0.18초인데 화면이 알려 주는 것은
             * **차오르는 그라데이션**뿐입니다. 그라데이션은 *"점점 위험해진다"*
             * 는 말하지만 ***"지금"*** 은 말하지 않습니다.
             *
             * 기둥 2의 합격 기준은 *"죽었을 때 **내가 못 피했네** 라고 말해야
             * 한다"* 입니다. 0.18초짜리 답에 시각 신호가 없으면 플레이어는
             * **"언제 눌러야 하는지 몰랐네"** 라고 말하게 되고, 그건 이 문서가
             * 금지한 쪽입니다.
             *
             * ── 참고한 게임들 ────────────────────────────────────────
             * · **세키로** — 적의 공격에 붙은 짧은 소리. 색이 아니라 **박자**를
             *   알려 주고, 그래서 모든 공격에 같은 소리를 씁니다.
             * · **Lies of P · Wo Long** — 임박 순간의 번쩍임.
             * · **Hi-Fi Rush** — 박자를 아예 게임의 문법으로 만듭니다.
             *
             * 공통점: **"무엇"은 색이, "언제"는 박자가** 말합니다. 둘을 한
             * 신호에 섞으면 색을 안 읽어도 되는 게임이 됩니다.
             *
             * ⚠️ **타이밍으로 푸는 색에만 켭니다**(`isTimingAnswer`).
             *    🟡 광역은 걸어 나가야 하고 🟣 강제이동은 사거리 밖에 있어야
             *    합니다 — 그 둘에 마지막 순간 신호를 주면 **이미 늦은 때
             *    알려 주는 것**이라 도움이 아니라 거짓말입니다.
             *    🟢 반격은 예고 내내 깜빡이는 자기 문법이 이미 있습니다.
             *
             * 창의 크기는 **게임이 정한 값**을 씁니다(`GUARD.window`). 여기에
             * 0.18 을 적어 두면 값을 바꾸는 날 신호만 옛 자리에 남습니다.
             */
            if (isTimingAnswer(def.intent) && Actor.timer[e] <= GUARD.window) {
              // 색은 그대로 두고 **밝기만** 밀어 올립니다 — 색이 바뀌면
              // "무엇"이 흔들려서, 언제만 알려 주려던 신호가 색을 덮습니다.
              v.telegraphMat.opacity = 1
            }
          } else {
            // 터지는 순간만 흰색으로 날립니다 — "지금이 판정"이 색과 무관하게 읽혀야 합니다.
            v.telegraphMat.opacity = 0.8
            v.telegraphMat.color.setHex(0xfff0d0)
          }
        } else if (v.telegraph.visible) {
          v.telegraph.visible = false
          v.telegraphMat.opacity = 0
        }
      }

      /**
       * 👀 못 본 적 표시 — `aggro === 0` 인 동안만, 가까울 때만.
       *
       * 깨어나는 순간 **바로 꺼집니다.** 이 껐다/켰다가 규칙 자체를
       * 가르칩니다: 표시가 있는 동안은 기습이 되고, 사라지면 안 됩니다.
       * 조건을 여기서 새로 판단하지 않고 게임이 세운 `aggro` 를 그대로
       * 읽는 것이 요점입니다 — 화면이 자기만의 기준을 갖는 순간
       * "보이는 것과 실제가 다른" 버그가 시작됩니다.
       */
      if (v.unawareMark && v.unawareMat && hasComponent(Enemy, e)) {
        const d = Math.hypot(Transform.x[e] - playerX, Transform.z[e] - playerZ)
        const show =
          Enemy.aggro[e] === 0 && Actor.state[e] !== ActorState.Dead && d < AWARE.markRange
        v.unawareMark.visible = show
        // 멀수록 옅게 — 가까운 기회가 먼저 눈에 들어와야 합니다.
        if (show) v.unawareMat.opacity = 0.85 * (1 - (d / AWARE.markRange) * 0.45)
      }

      /**
       * ── 등 뒤 구역: **가장 가까운 하나에게만** 그립니다 ────────────────
       *
       * 예전엔 표시 사거리(5.5m) 안의 **모든 적**에게 그렸습니다. 고리가
       * 좁을 때(1.6m)는 티가 안 났는데, 판정과 맞추느라 3.95m 로 넓히자
       * 면적이 2.4배가 되어 **바닥이 고리로 덮이기 시작했습니다.**
       * `npm run contrast` 에 대조군(적 있을 때 / 없을 때 같은 자리)을
       * 붙여서 재 보니 지면이 **ΔE 26.2** 만큼 바뀌었습니다 — 예고가
       * 바탕과 구분되는 문턱(25)을 넘는 값입니다. 즉 위험을 알리는 색을
       * **내가 만든 힌트가 덮기 시작한** 것입니다.
       *
       * 흐리게 만드는 것은 문턱 언저리를 만지는 미봉책입니다. 이 표시가
       * 답하는 질문은 *"내가 지금 누구의 등 뒤를 잡을 수 있나"* 이고,
       * 그 답은 **하나면 충분합니다.** 여럿에게 동시에 그리는 것은
       * 안내가 아니라 소음입니다 — 이 저장소가 곁길 알림에서 이미 배운 것.
       */
      if (v.backZone && v.backZoneMat) {
        const d = Math.hypot(Transform.x[e] - playerX, Transform.z[e] - playerZ)
        const near =
          e === nearestFoe && d < COMBAT.backIndicatorRange && Actor.state[e] !== ActorState.Dead
        v.backZone.visible = near
        if (near) v.backZoneMat.opacity = 0.42 * (1 - d / COMBAT.backIndicatorRange)
      }

      if (v.bleedFill && v.bleedBg && hasComponent(Enemy, e)) {
        const t = BLEED.max > 0 ? Math.min(1, Enemy.bleed[e] / BLEED.max) : 0
        const barW = v.group.userData.barWidth as number
        // 0이면 통째로 숨깁니다 — 안 쓰는 축의 빈 칸은 정보가 아니라 소음입니다.
        const on = t > 0.001 && Actor.state[e] !== ActorState.Dead
        v.bleedBg.visible = on
        v.bleedFill.visible = on
        if (on) {
          v.bleedFill.scale.x = barW * t
          v.bleedFill.position.x = -barW / 2
          const bm = v.bleedFill.material as THREE.MeshBasicMaterial
          /**
           * 가득에 가까워질수록 **밝아집니다.** 색만으로는 "얼마나 남았나"가
           * 안 읽히고, 이 축의 값은 **터지기 직전**에 몰려 있습니다.
           */
          bm.opacity = 0.55 + 0.45 * t
          bm.color.setHex(t > 0.8 ? 0xff6b7d : 0xd9455a)
        }
      }

      if (v.poiseFill && hasComponent(Enemy, e)) {
        const cfg = enemyDef(Enemy.kind[e])
        const t = cfg.poiseMax > 0 ? Math.max(0, Enemy.poise[e]) / cfg.poiseMax : 1
        const barW = v.group.userData.barWidth as number
        v.poiseFill.scale.x = barW * t
        /**
         * 강타 한 방이 닿는 지점. **판정과 같은 함수**로 구합니다 —
         * 보스의 페이즈별 저항까지 여기서 자동으로 반영됩니다.
         */
        const heavyHit = poiseDamage(
          heavyTrauma,
          heavyScale,
          FOCUS.poiseMult,
          Enemy.kind[e],
          Enemy.phase[e],
        )
        const markT = cfg.poiseMax > 0 ? Math.min(1, heavyHit / cfg.poiseMax) : 1
        // 이 선까지 내려왔는가 = 다음 강타가 무너뜨리는가.
        const atThreshold = Enemy.brokenT[e] <= 0 && Enemy.poise[e] <= heavyHit
        if (v.poiseMark) {
          v.poiseMark.visible = Enemy.brokenT[e] <= 0
          v.poiseMark.position.x = -barW / 2 + barW * markT
          const mm = v.poiseMark.material as THREE.MeshBasicMaterial
          mm.opacity = atThreshold && heavyReady ? 1 : 0.5
        }
        const mat = v.poiseFill.material as THREE.MeshBasicMaterial
        if (Enemy.brokenT[e] > 0) {
          // 무너진 동안에는 금빛으로 — "지금이 그 창이다"를 놓치면 안 됩니다.
          mat.color.setHex(0xffc966)
        } else if (atThreshold && heavyReady) {
          /**
           * **맥동**으로 알립니다. 색만 바꾸면 전투 화면에서 묻힙니다 —
           * 움직임은 주변시로도 잡히기 때문에 4색 예고와 겹쳐도 보입니다.
           * (색은 붕괴 금빛과 **다르게** 둡니다. 같으면 "이미 무너졌다"와
           *  "지금 무너뜨릴 수 있다"가 구분되지 않습니다.)
           */
          const k = 0.5 + 0.5 * Math.sin(time.elapsed * 11)
          mat.color.setRGB(0.87 + 0.13 * k, 0.9, 0.95 - 0.35 * k)
        } else {
          mat.color.setHex(0xdfe7f2)
        }
      }

      if (v.hpBar && v.hpFill) {
        const ratio = Math.max(0, Health.hp[e]) / Health.max[e]
        v.hpBar.visible = ratio < 0.999
        v.hpFill.scale.x = (v.group.userData.barWidth as number) * ratio
        v.hpBar.quaternion.copy(this.camera.quaternion)
      }
    }
  }

  /**
   * 실험대 전용 — **화면이 지금 무엇을 말하고 있는가.**
   *
   * ⚠️ 프로브가 `Enemy.aggro` 를 읽어서 *"표시가 떠 있겠지"* 라고 믿으면
   *    아무것도 검사하지 못합니다. 이 저장소가 가장 비싸게 배운 것이
   *    그것입니다 — **계기는 결론이 아니라 화면을 읽어야 합니다.**
   *    그래서 실제 메시의 `visible` 과 `scale` 을 그대로 돌려줍니다.
   */
  /**
   * 실험대 전용 — **강타 눈금이 지금 화면에서 어디에 있는가.**
   *
   * ⚠️ `poiseDamage()` 를 프로브가 다시 계산해서 견주면 아무것도 검사하지
   *    못합니다. 그건 화면이 아니라 제 산수를 검사하는 것이고, 눈금 메시를
   *    통째로 안 그려도 통과합니다. 그래서 **메시의 실제 위치·투명도**를
   *    그대로 돌려줍니다.
   */
  /**
   * ⏱ **예고 도형이 지금 화면에 어떻게 그려져 있는가.**
   *
   * 「지금」 신호는 **느낌**이라 봇으로는 못 잽니다. 하지만 *"그 신호가
   * 실제로 그려졌는가 · 제때 켜졌는가 · 켜져야 할 색에만 켜졌는가"* 는
   * 잴 수 있습니다. 색 대비를 `npm run contrast` 가 **실제로 그려진 픽셀**로
   * 재는 것과 같은 자리입니다.
   *
   * ⚠️ 판단(`timing`)은 게임이 합니다 — 프로브가 색 번호를 베껴 두면
   *    색을 하나 더 넣는 날 조용히 틀립니다.
   */
  /**
   * 🩸 **출혈 게이지가 지금 화면에 어떻게 그려져 있는가.**
   *
   * 값이 아니라 **그려진 것**을 냅니다. 게임 안의 숫자가 맞아도 화면에
   * 안 뜨면 없는 것이고, 이 저장소는 그 실패를 여러 번 겪었습니다
   * (인지 규칙 · 처형 안내 · 초록 예고).
   */
  debugBleedBars(): { entity: number; visible: boolean; fill: number; bleed: number }[] {
    const out: { entity: number; visible: boolean; fill: number; bleed: number }[] = []
    for (const [e, v] of this.items.entries()) {
      if (!v.bleedFill) continue
      const barW = (v.group.userData.barWidth as number) || 1
      out.push({
        entity: e,
        visible: v.bleedFill.visible === true,
        // 0~1 로 정규화 — 프로브가 바 너비를 알 필요가 없게.
        fill: Number((v.bleedFill.scale.x / barW).toFixed(3)),
        bleed: Number((Enemy.bleed[e] ?? 0).toFixed(1)),
      })
    }
    return out
  }

  debugTelegraphs(): {
    entity: number
    attackId: string
    intent: number
    /** 이 색의 정답이 타이밍인가 (config/punish.ts `isTimingAnswer`) */
    timing: boolean
    /** 남은 예고 시간(초) */
    left: number
    /** ⏳ 이번 공격에 실제로 건 예고 길이 — 차오름의 분모입니다 */
    windup: number
    /** ⏳ 그중 뜸 들인 몫 */
    held: number
    /** 지금 그려진 투명도 — 「지금」 신호가 켜지면 1이 됩니다 */
    opacity: number
  }[] {
    const out: {
      entity: number
      attackId: string
      intent: number
      timing: boolean
      left: number
      windup: number
      held: number
      opacity: number
    }[] = []
    for (const [e, v] of this.items.entries()) {
      if (!v.telegraph?.visible || !v.telegraphMat) continue
      if (!hasComponent(Enemy, e)) continue
      if (Actor.state[e] !== ActorState.Attack || Actor.phase[e] !== AttackPhase.Windup) continue
      const def = attackAt(Enemy.kind[e], Enemy.attackIndex[e])
      out.push({
        entity: e,
        attackId: def.id,
        intent: def.intent,
        timing: isTimingAnswer(def.intent),
        left: Number(Actor.timer[e].toFixed(3)),
        /** ⏳ 이번 공격에 실제로 건 예고 길이 — 차오름의 분모입니다 */
        windup: Number(Enemy.windupLen[e].toFixed(3)),
        /** ⏳ 그중 뜸 들인 몫 */
        held: Number(Enemy.heldT[e].toFixed(3)),
        opacity: Number(v.telegraphMat.opacity.toFixed(3)),
      })
    }
    return out
  }

  debugPoiseBars(): {
    entity: number
    /** 눈금이 바의 몇 % 지점에 있는가(0=왼쪽 끝, 1=오른쪽 끝) */
    markRatio: number
    markVisible: boolean
    /** 밝게 켜졌는가 = "지금 강타를 쓰면 무너진다" */
    markBright: boolean
    /** 강인도 채움의 현재 색 — 붕괴 금빛과 임계 맥동을 구분하려고 그대로 냅니다. */
    fill: [number, number, number]
  }[] {
    const out: {
      entity: number
      markRatio: number
      markVisible: boolean
      markBright: boolean
      fill: [number, number, number]
    }[] = []
    for (const [entity, v] of this.items.entries()) {
      if (!v.poiseMark || !v.poiseFill) continue
      const barW = (v.group.userData.barWidth as number) || 1
      const mm = v.poiseMark.material as THREE.MeshBasicMaterial
      const fm = v.poiseFill.material as THREE.MeshBasicMaterial
      out.push({
        entity,
        markRatio: Number(((v.poiseMark.position.x + barW / 2) / barW).toFixed(3)),
        markVisible: v.poiseMark.visible,
        markBright: mm.opacity > 0.9,
        fill: [
          Number(fm.color.r.toFixed(3)),
          Number(fm.color.g.toFixed(3)),
          Number(fm.color.b.toFixed(3)),
        ],
      })
    }
    return out
  }

  debugAwareMarks(): { marks: number; noiseVisible: boolean; noiseRadius: number } {
    let marks = 0
    let noiseVisible = false
    let noiseRadius = 0
    for (const v of this.items.values()) {
      if (v.unawareMark?.visible) marks++
      if (v.noiseRing) {
        if (v.noiseRing.visible) {
          noiseVisible = true
          noiseRadius = v.noiseRing.scale.x
        }
      }
    }
    return { marks, noiseVisible, noiseRadius: Number(noiseRadius.toFixed(2)) }
  }

  /**
   * 🔊 발소리 링 — 반지름이 **지금 내 발소리가 닿는 거리**입니다.
   *
   * 규칙은 `balance.ts hearDistance()` 한 곳에만 있습니다. 여기서는
   * 그 값을 받아 **그리기만** 합니다 — 화면이 자기 식을 갖는 순간
   * "보이는 대로 했는데 들키는" 경험이 시작되고, 그건 버그보다 나쁩니다.
   */
  private syncNoise(e: number, v: Visual, unawareNear: boolean): void {
    if (!v.noiseRing || !v.noiseMat) return
    if (!unawareNear) {
      if (v.noiseRing.visible) v.noiseRing.visible = false
      return
    }
    const speed = Math.hypot(Velocity.x[e], Velocity.z[e])
    const r = hearDistance(speed)
    v.noiseRing.visible = true
    v.noiseRing.scale.set(r, 1, r)
    /**
     * 조용할수록 흐리게, 시끄러울수록 진하게.
     *
     * 크기만으로도 말은 되지만, 서 있을 때의 작은 원이 또렷하면 **가만히
     * 있는 것도 시끄러워 보입니다.** 크기와 진하기가 같은 방향으로 움직여야
     * "지금 조용하다"가 한눈에 읽힙니다.
     */
    const loud = Math.min(1, Math.max(0, (r - AWARE.hearQuiet) / (AWARE.hearLoud - AWARE.hearQuiet)))
    v.noiseMat.opacity = 0.12 + 0.3 * loud
  }

  /** 🔵 속박 링 — 남은 시간에 따라 맥동합니다. */
  private syncSnare(e: number, v: Visual): void {
    if (!v.snareRing || !v.snareMat) return
    const t = hasComponent(Status, e) ? Status.snareT[e] : 0
    if (t <= 0) {
      if (v.snareRing.visible) v.snareRing.visible = false
      return
    }
    v.snareRing.visible = true
    // 풀릴 때가 가까울수록 빠르게 깜빡입니다 — 언제 풀리는지 눈으로 세게 만듭니다.
    const pulse = 0.55 + 0.45 * Math.sin(time.elapsed * 14)
    v.snareMat.opacity = (0.3 + 0.4 * pulse) * Math.min(1, t / 0.35)
  }

  /**
   * 플레이어 기본 공격의 **사거리 예고** (DESIGN.md 기둥 2).
   *
   * 적의 공격만 바닥에 그리고 내 공격은 안 그리면, 플레이어는 "내가 어디까지
   * 닿는지"를 **맞아보고 배울** 수밖에 없습니다. 무기를 셋이나 두고 사거리를
   * 1.9m~3.5m로 벌려 놓았으니, 그 차이를 몸으로 배우게 하는 것은 설계 낭비입니다.
   *
   * 적 예고와 **다른 언어**로 그립니다:
   *  · 색  — 청백색. 4색(빨/노/파/보) 어디에도 안 걸치는 색이어야
   *          "이건 내 것"이 즉시 구분됩니다.
   *  · 시점 — 선행동작 동안만. 판정이 터지면 초승달(vfx)이 대신 말합니다.
   * 스킬은 이미 자체 예고가 있으므로(playerControl의 onCast) 기본 콤보만 담당합니다.
   */
  private syncPlayerRange(e: number, v: Visual): void {
    if (!v.rangeArc || !v.rangeMat) return
    const winding =
      Actor.state[e] === ActorState.Attack && Actor.phase[e] === AttackPhase.Windup
    if (!winding) {
      if (v.rangeArc.visible) v.rangeArc.visible = false
      return
    }
    const weapon = WEAPONS[Math.min(Loadout.weapon[e], WEAPONS.length - 1)]
    const step = weapon.combo[Math.min(Actor.comboIndex[e], weapon.combo.length - 1)]
    const geo = this.rangeGeoFor(weapon.id, Actor.comboIndex[e])
    if (v.rangeArc.geometry !== geo) v.rangeArc.geometry = geo
    v.rangeArc.visible = true
    // 선행동작이 끝나갈수록 진해집니다 = "지금 터진다"가 읽힙니다.
    const p = 1 - Math.max(0, Actor.timer[e]) / Math.max(step.windup, 0.001)
    v.rangeMat.opacity = 0.1 + p * 0.3
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
    return (enemyDef(Enemy.kind[e]).attackArcDeg * Math.PI) / 180
  }

  private phaseDurationOf(e: number, phase: AttackPhase): number {
    if (hasComponent(Loadout, e)) {
      const weapon = WEAPONS[Math.min(Loadout.weapon[e], WEAPONS.length - 1)]
      const step = weapon.combo[Math.min(Actor.comboIndex[e], weapon.combo.length - 1)]
      return phase === AttackPhase.Windup ? step.windup : phase === AttackPhase.Active ? step.active : step.recovery
    }
    const cfg = enemyDef(Enemy.kind[e])
    return phase === AttackPhase.Windup ? cfg.windup : phase === AttackPhase.Active ? cfg.active : cfg.recovery
  }

  /**
   * 화톳불 — 엔티티가 아니라 **장식 오브젝트**로 만듭니다.
   *
   * ECS 엔티티로 두면 물리·전투 질의가 매 프레임 훑고 지나가는데, 화톳불은
   * 부딪히지도 맞지도 않으므로 전부 낭비입니다. 위치 목록만 있으면 되는
   * 것을 엔티티로 만들면 시스템마다 "이건 화톳불이니 건너뛰기"가 늘어납니다.
   */
  addBonfire(x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    // 장작 — 낮고 어두운 받침
    const logs = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.7, 0.34, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.9 }),
    )
    logs.position.y = 0.17
    logs.castShadow = true
    // 불꽃 — 가산 합성이라 어두운 배경에서 확실히 튑니다.
    // 보물 빛기둥과 달리 **짧게(1.5m)** 둡니다. 길면 화면을 가로막는데,
    // 화톳불은 안전지대라 오히려 주변이 잘 보여야 합니다.
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 1.5, 7),
      new THREE.MeshBasicMaterial({
        color: 0xffa93c,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    flame.position.y = 1.0
    flame.renderOrder = 2
    g.add(logs, flame)
    this.bonfireFlames.push(flame)
    this.scene.add(g)
    return g
  }

  /**
   * 모루 — **불티와 정련석을 쓰는 곳.** 회복도, 부활도 아닙니다.
   *
   * ── 생김새가 먼저 말해야 합니다 ────────────────────────────────
   * 이 물건의 가장 큰 위험은 "화톳불 하나 더"로 읽히는 것입니다. 그러면
   * 플레이어는 여기서 성수병이 찰 줄 알고 보스에 들어갔다가, 안 찬 걸
   * 보스 앞에서 알게 됩니다. **그건 우리가 만든 함정**이지 난이도가 아닙니다.
   *
   * 그래서 화톳불과 공유하는 신호를 전부 뺐습니다:
   *   · **불꽃이 없습니다** — 불은 이 게임에서 "쉴 수 있다"는 뜻입니다.
   *   · **따뜻한 색이 아닙니다** — 차가운 강철색(0x8fa4b8).
   *   · 실루엣이 다릅니다 — 원뿔이 아니라 **각진 쇳덩이와 받침**.
   * 대신 은은한 불씨 자국만 남겨, 사람이 쓰던 물건임은 읽히게 둡니다.
   */
  addAnvil(x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.5, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x2f2a26, roughness: 0.95 }),
    )
    base.position.y = 0.25
    // 모루 몸통 — 위가 넓고 아래가 좁은 각기둥. 실루엣만으로 구분됩니다.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.28, 0.42, 4),
      new THREE.MeshStandardMaterial({ color: 0x8fa4b8, roughness: 0.45, metalness: 0.7 }),
    )
    body.position.y = 0.72
    body.rotation.y = Math.PI * 0.25
    base.castShadow = true
    body.castShadow = true
    g.add(base, body)
    this.scene.add(g)
    return g
  }

  /** 불꽃이 흔들립니다 — 정지한 불은 불로 안 보입니다. */
  private syncBonfires(): void {
    for (let i = 0; i < this.bonfireFlames.length; i++) {
      const f = this.bonfireFlames[i]
      // 위상을 인덱스로 어긋내야 여러 화톳불이 한 몸처럼 뛰지 않습니다.
      const t = time.elapsed * 7 + i * 1.7
      f.scale.set(1 + Math.sin(t) * 0.09, 1 + Math.sin(t * 1.4) * 0.16, 1 + Math.cos(t) * 0.09)
      ;(f.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.18 * (0.5 + 0.5 * Math.sin(t * 0.9))
    }
  }

  /**
   * 죽은 자리에 떨어진 불티 표식.
   *
   * **화톳불과 색이 같습니다(주황).** 헷갈릴 것 같지만 오히려 반대입니다 —
   * 둘 다 "저기로 가야 한다"는 같은 뜻이고, 형태(원뿔 불꽃 vs 낮게 깔린 고리)와
   * 크기가 확실히 달라서 가까이 가면 바로 구분됩니다.
   * 색을 하나 더 늘리면 4색 예고 체계와 충돌할 위험만 커집니다.
   */
  addEmberDrop(x: number, y: number, z: number): THREE.Object3D {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.95, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xffb24a,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    ring.position.y = 0.05
    ring.renderOrder = 2
    // 멀리서도 보이는 낮은 기둥. 보물(8.5m)보다 훨씬 짧게 둡니다 —
    // 되찾는 자리는 이미 "내가 죽은 곳"이라 대충 어딘지 알고 있습니다.
    const beam = new THREE.Mesh(
      this.pillarGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffb24a,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
        side: THREE.BackSide,
      }),
    )
    beam.scale.set(0.8, 0.55, 0.8)
    beam.position.y = (PILLAR_HEIGHT * 0.55) / 2
    beam.renderOrder = 2
    g.add(ring, beam)
    this.scene.add(g)
    this.dropRings.push(ring)
    return g
  }

  removeObject(obj: THREE.Object3D): void {
    this.scene.remove(obj)
    this.dropRings.length = 0
  }

  private syncDrops(): void {
    for (const r of this.dropRings) {
      const t = time.elapsed * 3.2
      const k = 1 + Math.sin(t) * 0.14
      r.scale.set(k, k, k)
      ;(r.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.2 * (0.5 + 0.5 * Math.sin(t))
    }
  }

  clearBonfires(): void {
    for (const f of this.bonfireFlames) {
      const parent = f.parent
      if (parent) this.scene.remove(parent)
    }
    this.bonfireFlames.length = 0
  }

  /**
   * 사다리 — 걷힌 모습과 내려진 모습이 **멀리서 실루엣만 봐도** 달라야 합니다.
   *
   * 쿼터뷰에서 1m는 화면 31px입니다. 색만 바꾸면 색약인 사람에게도, 화면이
   * 어두운 사람에게도 안 보입니다. 그래서 **형태**를 바꿉니다:
   *   · 걷힌 상태 = 절벽 **위 가장자리에 눕혀 놓은 짧은 묶음** (가로 실루엣)
   *   · 내려진 상태 = 절벽면을 따라 아래까지 내려온 **긴 세로 실루엣**
   * 아래에서 올려다보면 걷힌 사다리가 난간 너머로 삐죽 보입니다 — 이게
   * "저 위에 아직 못 가본 길이 있다"는 안내입니다.
   */
  addLadder(s: {
    x: number
    z: number
    loY: number
    hiY: number
    dirX: number
    dirZ: number
    open: boolean
  }): { setOpen: (open: boolean) => void } {
    const g = new THREE.Group()
    g.position.set(s.x, 0, s.z)
    // 아래에서 위로 향하는 방향을 바라보게 회전 — 사다리 면이 절벽에 붙습니다.
    g.rotation.y = Math.atan2(s.dirX, s.dirZ)

    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a3f, roughness: 0.88 })
    const rise = Math.max(0.9, s.hiY - s.loY)

    // ---- 내려진 사다리 ----
    const deployed = new THREE.Group()
    const railGeo = new THREE.BoxGeometry(0.12, rise + 0.6, 0.12)
    for (const off of [-0.32, 0.32]) {
      const rail = new THREE.Mesh(railGeo, wood)
      rail.position.set(off, s.loY + (rise + 0.6) / 2, 0)
      rail.castShadow = true
      deployed.add(rail)
    }
    const rungGeo = new THREE.BoxGeometry(0.76, 0.08, 0.08)
    const rungs = Math.max(2, Math.round(rise / 0.42))
    for (let i = 0; i <= rungs; i++) {
      const rung = new THREE.Mesh(rungGeo, wood)
      rung.position.set(0, s.loY + 0.3 + (i / rungs) * rise, 0)
      deployed.add(rung)
    }

    // ---- 걷힌 사다리 ---- 위 가장자리에 눕혀 둔 묶음
    const folded = new THREE.Group()
    const bundle = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.26, 0.44), wood)
    bundle.position.set(0, s.hiY + 0.13, 0.35)
    bundle.castShadow = true
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.1, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 }),
    )
    strap.position.set(0, s.hiY + 0.28, 0.35)
    folded.add(bundle, strap)

    g.add(deployed, folded)
    this.scene.add(g)
    this.ladderGroups.push(g)

    const setOpen = (open: boolean) => {
      deployed.visible = open
      folded.visible = !open
    }
    setOpen(s.open)
    return { setOpen }
  }

  clearLadders(): void {
    for (const g of this.ladderGroups) this.scene.remove(g)
    this.ladderGroups.length = 0
  }

  dispose(): void {
    for (const e of [...this.items.keys()]) this.detach(e)
    for (const geo of Object.values(this.geos)) geo.dispose()
    for (const geo of this.telegraphGeos.values()) geo.dispose()
    for (const geo of this.rangeGeos.values()) geo.dispose()
    for (const geo of Object.values(this.backZoneGeos)) geo.dispose()
    this.hpBarGeo.dispose()
    this.pillarGeo.dispose()
  }
}
