import * as THREE from 'three'
import { vfxRng } from '../core/rng'
import { time } from '../core/time'

/**
 * 타격 이펙트 — 데미지 숫자, 히트 스파크, 검격 궤적.
 *
 * 전부 time.realDt 로 움직입니다. 히트스톱으로 게임이 멈춘 순간에도
 * 이펙트는 계속 흘러야 "정지"가 아니라 "충격"으로 읽힙니다.
 * (이펙트까지 같이 멈추면 그냥 프레임 드랍처럼 보입니다.)
 *
 * 모든 오브젝트는 풀(pool)로 미리 만들어 둡니다. 타격마다 new 를 하면
 * GC가 튀면서 정확히 가장 바쁜 순간에 프레임이 끊깁니다.
 */

const DAMAGE_POOL = 40
const SPARK_POOL = 24
const SWING_POOL = 8
const GROUND_POOL = 20

const DAMAGE_LIFE = 0.75
/**
 * 🔢 숫자가 떠오르는 속도(m/초). **일정 속도**입니다 — 여기가 핵심입니다.
 *
 * 예전에는 `vy = 3.1` 로 튀어 올랐다가 중력 7.5 로 떨어지는 **포물선**이었습니다.
 * 보기에는 그쪽이 활기찬데, 포물선은 **나이마다 속도가 다릅니다.** 갓 뜬 숫자는
 * 3.1m/s 로 올라가고 0.5초 된 숫자는 0.65m/s 로 떨어지는 중이라, 뒤에 뜬 숫자가
 * 앞의 숫자를 **따라잡아 관통합니다.** 실제로 롱소드 콤보 간격(0.25초)에서
 * 계산하면 0.55초쯤에 둘의 높이 차가 0.19m 까지 좁혀집니다 — 글자 높이(0.4)의
 * 절반이라 그대로 겹칩니다.
 *
 * 속도가 모두 같으면 **뜰 때 벌려 놓은 간격이 수명 내내 그대로 유지됩니다.**
 * 그래서 아래 `stackY` 를 스폰 때 딱 한 번만 풀면 됩니다 — 매 프레임 다시
 * 밀어내면 숫자가 덜덜 떨립니다.
 *
 * 사라진 "팡" 하는 맛은 **크기**로 옮겼습니다(`DAMAGE_POP`). 크기는 위치를
 * 건드리지 않으므로 겹침 계산을 깨지 않습니다.
 */
const DAMAGE_RISE = 1
/**
 * ⚠️ **떠오르는 방향도, 쌓는 방향도 월드의 위(+y)가 아니라 카메라의 위입니다.**
 *
 * 이 함정에 한 번 걸렸고, 계측기가 없었으면 못 찾았을 종류입니다. 쌓기를
 * 월드 +y 로 0.5m 씩 올렸더니 `npm run hud` 은 두 숫자가 **월드에서 1.00m**
 * 떨어져 있다고 찍는데 **화면에서는 9px** 밖에 안 벌어져 있었습니다.
 * 글자 높이가 12~19px 이니 그대로 겹칩니다.
 *
 * 쿼터뷰 카메라는 아래를 내려다봅니다. 그래서 월드에서 1m 를 올려도 화면에서는
 * cos(내려다보는 각) 만큼만, 즉 **절반쯤만** 올라갑니다. 그런데 겹침을 재는
 * 자(글자 크기)는 스프라이트 크기 — **카메라 평면 위의 길이**입니다.
 * 서로 다른 자를 같은 자로 알고 비교하고 있었습니다.
 *
 * 그래서 흩뿌림·쌓기·떠오름을 전부 **카메라의 오른쪽·위 축** 위에서 합니다.
 * 그러면 길이 단위가 글자 크기와 같아지고, 화면에서 벌어지는 양이 계산한
 * 그대로 나옵니다.
 */
/**
 * 🔢 옆으로 흩뿌리는 폭(m). **속도가 아니라 뜰 때 한 번 주는 치우침**입니다.
 *
 * ── 왜 속도를 버렸는가 (재 보고 알았습니다) ──────────────────────────
 * 처음엔 예전 그대로 1.1m/s 로 옆으로 밀었습니다. 그런데 `npm run hud` 이
 * 여전히 **53% 겹침**을 찍었고, 상자 좌표를 보니 두 숫자의 화면 세로 차이가
 * 겨우 5px 이었습니다 — 아래 `stackY` 가 월드에서 0.5m 씩 올려 놨는데도요.
 *
 * 쿼터뷰라서 그렇습니다. **월드의 위(+y)도, 카메라 쪽으로 다가오는 것(깊이)도
 * 화면에서는 둘 다 세로로 움직입니다.** 그래서 옆으로 흩뿌린 속도가 깊이 성분을
 * 갖는 순간, 그게 쌓아 올린 높이를 **도로 깎아 먹습니다.** 겹침을 막는 장치가
 * 둘이었고 서로를 무효로 만들고 있었습니다 — 이 저장소가 계속 적어 온 그대로:
 * **규칙은 한 곳에만.**
 *
 * 그래서 흩뿌리기는 ① 속도가 아니라 **뜰 때 한 번**만 주고, ② 방향도 아무
 * 쪽이 아니라 **카메라의 오른쪽 축**으로만 줍니다. 그러면 뜰 때 벌려 둔
 * 간격이 수명 내내 정확히 유지됩니다.
 */
const DAMAGE_SPREAD = 0.45
/** 뜨는 순간 이만큼 커졌다가 제 크기로 줄어듭니다 — 타격의 "팡". */
const DAMAGE_POP = 1.3
/** 그 줄어듦이 끝나는 시간(초). 수명 0.75초의 1/5 — 읽는 동안은 크기가 고정입니다. */
const DAMAGE_POP_T = 0.15
/**
 * 겹칠 때 한 칸 올리는 높이(m). 글자 잉크 높이가 보통 0.40, 가장 큰
 * 「백어택 치명타!」가 0.75 입니다. 0.5 는 보통 숫자를 한 칸에 확실히
 * 떼어 놓고, 큰 숫자는 두 칸 만에 떨어집니다(아래 반복문이 다시 재 봅니다).
 */
const STACK_STEP = 0.5
/**
 * 최대 몇 칸까지 올릴 것인가. 4칸 = 2m — 적 키(1.7~2.9m)만큼이라 아직
 * *"저 적의 숫자"* 로 보입니다. 더 올리면 겹침은 풀리지만 **누구를 때린
 * 숫자인지**를 잃습니다. 그때는 차라리 겹치게 두는 편이 낫습니다.
 */
const STACK_MAX = 4
/**
 * 황금비의 소수부(≈0.618). 여기에 1, 2, 3… 을 곱해 소수부만 취하면
 * **연속한 값끼리 서로 가장 멀리 떨어지는** 수열이 나옵니다(해바라기 씨앗과
 * 같은 원리의 1차원 판). 매번 독립 난수로 뽑으면 연달아 뜬 둘이 같은 자리에
 * 걸리는 일이 드물지 않은데, 이 수열은 그런 일이 없습니다.
 */
const GOLDEN_FRAC = 0.6180339887
const SPARK_LIFE = 0.22
/**
 * 궤적은 짧아야 잔상처럼 보입니다. 길면 지면에 눌어붙은 장판처럼 보입니다.
 *
 * ⚔️ **무게에 따라 늘어납니다.** 콤보 마무리는 첫 타보다 오래 남아야
 * *"방금 큰 게 들어갔다"* 가 눈에 남습니다 — 손끝(히트스톱)이 이미 그렇게
 * 말하고 있는데 화면만 같은 말을 반복하고 있었습니다.
 * 최대치도 0.30초에 묶어 둡니다. 더 길면 잔상이 아니라 장판이 됩니다.
 */
const SWING_LIFE = 0.19
const SWING_LIFE_HEAVY = 0.3
/** 가벼운 것은 서늘한 흰빛, 무거운 것은 달아오른 호박빛. */
const SWING_COLOR_LIGHT = 0xeaf6ff
const SWING_COLOR_HEAVY = 0xffc46b


interface DamageItem {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  life: number
  /**
   * 화면 가로/세로 좌표 — 정확히는 위치를 **카메라의 오른쪽·위 축에 투영한 값**.
   * 겹침은 이 두 값으로 잽니다(위 DAMAGE_RISE 아래 주석: 월드 축으로 재면
   * 자가 서로 달라서 계산이 통째로 어긋납니다).
   */
  lateral: number
  vert: number
  /** 팡 하는 크기 연출이 곱해지기 **전**의 제 크기. 매 프레임 여기서 다시 계산합니다. */
  baseW: number
  baseH: number
  /**
   * 🔢 **글자가 실제로 차지하는 비율**(스프라이트 크기에 대한 0~1).
   *
   * 스프라이트는 220×112 캔버스 전체이고, 두 자리 숫자는 그 안에서
   * 가로 1/3 · 세로 절반쯤만 씁니다. 나머지는 투명입니다. 겹침을
   * 스프라이트 크기로 재면 **안 겹치는 것도 겹쳤다고** 세게 됩니다 —
   * 그러면 아래 쌓기가 필요 없는 자리에서도 숫자를 밀어 올립니다.
   *
   * 크기가 아니라 **비율**로 들고 있는 이유: 숫자는 뜰 때 DAMAGE_POP 배로
   * 부풀었다가 줄어듭니다. 크기를 굳혀 두면 *"지금 화면에 얼마만 한가"* 를
   * 물었을 때 **한 순간의 값을 수명 내내 되풀이하게** 됩니다.
   */
  inkRatioW: number
  inkRatioH: number
}

interface SparkItem {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  life: number
  scale: number
}

/**
 * 지면 도형 — 스킬의 예고(telegraph)와 발동 범위 표시.
 *
 * DESIGN.md 기둥 2("바닥을 읽는 전투")의 핵심 장치입니다.
 * 로스트아크가 바닥 색으로 대응을 구분하듯, 우리도 스킬마다 색을 다르게 주고
 * **예고 → 채워짐 → 발동** 3단계로 보여줍니다. 이게 있어야 적도 플레이어도
 * "보고 피할" 수 있고, 죽었을 때 "못 봤다"가 아니라 "못 피했다"가 됩니다.
 *
 *   outline — 범위 테두리 (예고 내내 고정)
 *   fill    — 안쪽이 차오름 (남은 시간 = 위험 시점을 알려줌)
 *   fade    — 발동 순간 번쩍이며 사라짐
 */
type GroundMode = 'outline' | 'fill' | 'fade'

interface GroundItem {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  life: number
  maxLife: number
  mode: GroundMode
  radius: number
}

interface SwingItem {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  life: number
  /** 이 궤적이 **처음 받은** 수명. 무게마다 다르므로 사그라드는 비율을
   *  고정값으로 나누면 무거운 것이 갑자기 사라집니다. */
  maxLife: number
  baseScale: number
}

/**
 * 방사형 글로우 텍스처.
 *
 * 없으면 안 되는 이유: 가산 블렌딩(Additive)을 건 판(Plane)에 텍스처가 없으면
 * 화면에 **밝은 정사각형**이 그대로 찍힙니다. 실제로 첫 검증 스크린샷에서
 * 타격할 때마다 흰 네모가 튀어나왔습니다. 알파가 가장자리로 갈수록 0이 되는
 * 그라디언트를 씌워야 "빛 번짐"으로 읽힙니다.
 */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,245,214,0.92)')
  g.addColorStop(0.42, 'rgba(255,196,110,0.34)')
  g.addColorStop(0.72, 'rgba(255,140,60,0.08)')
  g.addColorStop(1, 'rgba(255,120,40,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeDamageCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 220
  c.height = 112
  return c
}

/** 데미지 숫자의 종류. 색·크기·머리말이 달라집니다. */
export interface DamageStyle {
  heavy?: boolean
  /** 등 뒤에서 꽂았는가 */
  back?: boolean
  crit?: boolean
  heal?: boolean
}

/**
 * 숫자 위에 머리말을 붙여 **왜 이 숫자가 큰지** 알려줍니다.
 *
 * 색만 바꾸면 "어? 이번엔 왜 세게 들어갔지?"에 답이 안 됩니다.
 * "백어택"이라고 써 줘야 플레이어가 **다음에도 그렇게 하려고** 움직입니다.
 * 기둥 3(포지셔닝 보상)이 학습되는 지점이 정확히 여기입니다.
 */
function styleOf(style: DamageStyle): { color: string; label: string; scale: number } {
  if (style.heal) return { color: '#7ef2a5', label: '회복', scale: 1.1 }
  if (style.back && style.crit) return { color: '#ff8a3c', label: '백어택 치명타!', scale: 1.9 }
  if (style.back) return { color: '#ffb648', label: '백어택', scale: 1.5 }
  if (style.crit) return { color: '#ffe07a', label: '치명타', scale: 1.45 }
  if (style.heavy) return { color: '#ffd257', label: '', scale: 1.3 }
  return { color: '#ffffff', label: '', scale: 1 }
}

/**
 * @returns 글자가 실제로 차지한 상자 — 캔버스 크기에 대한 **비율** 0~1.
 *          이걸 그리는 자리에서 돌려주는 이유는, 폰트나 자릿수가 바뀌면
 *          상자도 같이 바뀌어야 하기 때문입니다. 어딘가에 0.33 이라고
 *          적어 두면 다음에 폰트를 키우는 날 조용히 거짓말이 됩니다
 *          (이 저장소가 계속 적어 온 그대로: 사건은 사건이 일어난 자리에서).
 */
function drawDamage(
  canvas: HTMLCanvasElement,
  text: string,
  color: string,
  label: string,
): { w: number; h: number } {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const numY = label ? canvas.height * 0.62 : canvas.height / 2
  ctx.font = 'bold 58px system-ui, -apple-system, "Segoe UI", sans-serif'
  const m = ctx.measureText(text)
  // 검은 테두리 — 밝은 바닥 위에서도 숫자가 읽히게 합니다.
  ctx.lineWidth = 9
  ctx.strokeStyle = 'rgba(0,0,0,0.88)'
  ctx.strokeText(text, canvas.width / 2, numY)
  ctx.fillStyle = color
  ctx.fillText(text, canvas.width / 2, numY)

  if (label) {
    ctx.font = 'bold 26px system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(0,0,0,0.88)'
    ctx.strokeText(label, canvas.width / 2, canvas.height * 0.2)
    ctx.fillStyle = color
    ctx.fillText(label, canvas.width / 2, canvas.height * 0.2)
  }

  // 테두리(lineWidth 9)는 양옆으로 절반씩 삐져나오므로 폭·높이에 9 를 더합니다.
  // 세로는 폰트 실측이 없는 브라우저를 대비해 글자 크기의 0.72(대문자 높이)로 뒷받침합니다.
  const ascent = m.actualBoundingBoxAscent || 58 * 0.72
  const descent = m.actualBoundingBoxDescent || 0
  return {
    w: (m.width + 9) / canvas.width,
    h: (ascent + descent + 9) / canvas.height,
  }
}

export class Vfx {
  private readonly damages: DamageItem[] = []
  private readonly sparks: SparkItem[] = []
  private readonly swings: SwingItem[] = []
  private damageCursor = 0
  private sparkCursor = 0
  private swingCursor = 0
  private readonly glowTexture: THREE.CanvasTexture
  private readonly grounds: GroundItem[] = []
  private groundCursor = 0
  /** 부채꼴 지오메트리는 각도마다 달라서 캐시합니다(스킬 종류가 적어 금방 포화). */
  private readonly sectorCache = new Map<number, THREE.BufferGeometry>()
  private readonly crescentCache = new Map<number, THREE.BufferGeometry>()

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < DAMAGE_POOL; i++) {
      const canvas = makeDamageCanvas()
      const texture = new THREE.CanvasTexture(canvas)
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
      )
      sprite.scale.set(1.5, 0.75, 1)
      sprite.visible = false
      sprite.renderOrder = 20
      scene.add(sprite)
      this.damages.push({
        sprite,
        canvas,
        texture,
        life: 0,
        lateral: 0,
        vert: 0,
        baseW: 1.5,
        baseH: 0.75,
        inkRatioW: 0,
        inkRatioH: 0,
      })
    }

    const sparkGeo = new THREE.PlaneGeometry(1, 1)
    this.glowTexture = makeGlowTexture()
    for (let i = 0; i < SPARK_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color: 0xfff0c0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(sparkGeo, material)
      mesh.visible = false
      mesh.renderOrder = 15
      scene.add(mesh)
      this.sparks.push({ mesh, material, life: 0, scale: 1 })
    }

    for (let i = 0; i < SWING_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xeaf6ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.crescentGeo(120), material)
      mesh.visible = false
      mesh.renderOrder = 14
      scene.add(mesh)
      this.swings.push({ mesh, material, life: 0, maxLife: SWING_LIFE, baseScale: 1 })
    }

    for (let i = 0; i < GROUND_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.sectorGeo(360), material)
      mesh.visible = false
      mesh.renderOrder = 12
      scene.add(mesh)
      this.grounds.push({ mesh, material, life: 0, maxLife: 1, mode: 'fade', radius: 1 })
    }
  }

  /**
   * 반지름 1짜리 단위 **초승달**. 검격 궤적용.
   *
   * 각도마다 지오메트리를 따로 만드는 것이 핵심입니다.
   * 예전에는 고정 각도(137°) 하나를 만들어 크기만 늘렸다 줄였다 했는데,
   * 그러면 175°로 훑는 대검과 95°로 찌르는 단검이 **화면에서 완전히 똑같이** 보입니다.
   * "무기 차이가 안 느껴진다"는 플레이 테스트 피드백의 직접적인 원인이었습니다.
   */
  private crescentGeo(arcDeg: number): THREE.BufferGeometry {
    const key = Math.round(arcDeg)
    const cached = this.crescentCache.get(key)
    if (cached) return cached
    const arc = (key * Math.PI) / 180
    /**
     * 안쪽 반지름 0.66 -> 0.46.
     *
     * 히트박스는 **0부터 사거리까지 전부**인데 초승달은 바깥 1/3만 그려서,
     * 사거리 안쪽에 바짝 붙은 적이 맞아도 화면에는 그 적 **너머로** 궤적이
     * 지나갔습니다. "이펙트랑 히트박스가 어긋난다"는 지적의 절반이 이것입니다.
     *
     * 완전히 채우면(0부터) 예전처럼 회색 덩어리가 되어 궤적으로 안 읽힙니다.
     * 0.46은 "휘두른 자국"으로 읽히면서도 실제 도달 범위를 훨씬 정직하게 덮는 선입니다.
     */
    const geo = new THREE.RingGeometry(0.46, 1, 48, 1, -arc / 2, arc)
    geo.rotateX(-Math.PI / 2)
    geo.rotateY(-Math.PI / 2)
    this.crescentCache.set(key, geo)
    return geo
  }

  /** 반지름 1짜리 단위 부채꼴. 실제 크기는 스케일로 맞춥니다. */
  private sectorGeo(arcDeg: number): THREE.BufferGeometry {
    const key = Math.round(arcDeg)
    const cached = this.sectorCache.get(key)
    if (cached) return cached
    const arc = key >= 359 ? Math.PI * 2 : (key * Math.PI) / 180
    const geo = new THREE.RingGeometry(0.03, 1, 56, 1, -arc / 2, arc)
    geo.rotateX(-Math.PI / 2) // 지면에 눕히기
    geo.rotateY(-Math.PI / 2) // theta=0 을 정면(+Z)으로
    this.sectorCache.set(key, geo)
    return geo
  }

  spawnGroundShape(
    x: number,
    y: number,
    z: number,
    rotY: number,
    radius: number,
    arcDeg: number,
    color: number,
    life: number,
    mode: GroundMode,
  ): void {
    const item = this.grounds[this.groundCursor]
    this.groundCursor = (this.groundCursor + 1) % GROUND_POOL
    item.mesh.geometry = this.sectorGeo(arcDeg)
    item.mesh.position.set(x, y + 0.05, z)
    item.mesh.rotation.y = rotY
    item.mesh.scale.set(radius, 1, radius)
    item.mesh.visible = true
    item.material.color.setHex(color)
    item.material.opacity = mode === 'fade' ? 0.85 : mode === 'fill' ? 0.5 : 0.42
    item.material.blending = mode === 'fade' ? THREE.AdditiveBlending : THREE.NormalBlending
    item.material.needsUpdate = true
    item.life = Math.max(life, 0.05)
    item.maxLife = item.life
    item.mode = mode
    item.radius = radius
  }

  spawnDamage(x: number, y: number, z: number, amount: number, style: DamageStyle = {}): void {
    const item = this.damages[this.damageCursor]
    this.damageCursor = (this.damageCursor + 1) % DAMAGE_POOL

    const look = styleOf(style)
    const text = (style.heal ? '+' : '') + String(Math.round(amount))
    const ink = drawDamage(item.canvas, text, look.color, look.label)
    item.texture.needsUpdate = true
    item.baseW = 1.7 * look.scale
    item.baseH = 0.87 * look.scale
    item.inkRatioW = ink.w
    item.inkRatioH = ink.h
    item.sprite.scale.set(item.baseW * DAMAGE_POP, item.baseH * DAMAGE_POP, 1)

    // 옆으로 살짝 흩뿌립니다 — **카메라 오른쪽 축으로만**(DAMAGE_SPREAD 주석).
    // 🎲 씨앗 난수입니다 — 장식이어도 그렇습니다(core/rng.ts `vfxRng` 주석).
    //    난수는 무늬가 판마다 달라 보이라고 얹는 흔들림이고, 실제로 벌리는
    //    일은 황금비 수열이 합니다. (뽑는 횟수는 예전과 같은 1회입니다 —
    //    난수 흐름이 달라지면 `npm run repro` 가 재현하는 화면이 통째로 바뀝니다.)
    this.damageSpin = (this.damageSpin + GOLDEN_FRAC) % 1
    const spread = (this.damageSpin * 2 - 1) * DAMAGE_SPREAD + (vfxRng.next() - 0.5) * 0.12
    const r = this.camRight
    const u = this.camUp
    item.lateral = x * r.x + y * r.y + z * r.z + spread
    item.vert = this.stackVert(item, x * u.x + y * u.y + z * u.z, x, z)
    // 화면 가로·세로를 정한 뒤 월드 좌표로 되돌립니다. 두 축은 서로 수직이라
    // 각각의 이동량을 그냥 더하면 됩니다.
    const lift = item.vert - (x * u.x + y * u.y + z * u.z)
    item.sprite.position.set(
      x + r.x * spread + u.x * lift,
      y + r.y * spread + u.y * lift,
      z + r.z * spread + u.z * lift,
    )
    item.sprite.visible = true
    item.sprite.material.opacity = 1
    item.life = DAMAGE_LIFE
  }

  /**
   * 🔢 **숫자를 위로 쌓습니다** — 이미 떠 있는 숫자와 겹치면 한 칸 올립니다.
   *
   * ── 스크린샷이 잡은 것 ────────────────────────────────────────────
   * 보스 처형 장면에서 「12」와 「27」이 **완전히 포개져** 있었습니다.
   * 원래 코드는 흩뿌리기를 **속도로만** 줬습니다(위 driftX/driftZ).
   * 그런데 속도는 0초에 아무것도 벌려 주지 않습니다 — 같은 프레임에 뜬
   * 두 숫자는 **시작점이 글자 그대로 같은 점**입니다.
   *
   * 그리고 이건 드문 경우가 아닙니다. 롱소드 콤보는 1타 0.15초 · 2타 0.40초 ·
   * 3타 0.67초에 꽂히고(`npm run weapons` 시간표), 숫자 수명은 0.75초입니다.
   * 즉 **콤보를 넣을 때마다 세 숫자가 한 적 위에 동시에** 떠 있습니다.
   * 가장 잘 되는 순간의 피드백이 가장 안 읽히고 있었습니다.
   *
   * ── 왜 옆이 아니라 "위"인가 ───────────────────────────────────────
   * 옆으로 크게 밀면 *"이 숫자는 이 적의 것"* 이라는 연결이 끊깁니다.
   * 숫자 잉크는 가로로 넓고 세로로 납작해서(대략 1.4 : 0.4), 겹침을 푸는 데
   * **세로가 3배 이상 싸게** 먹힙니다. 디아블로·로스트아크가 연타 숫자를
   * 세로로 쌓아 올리는 이유가 이것입니다.
   *
   * ── 왜 **뜰 때 딱 한 번**만 풀어도 되는가 ────────────────────────
   * 숫자는 뜬 뒤에 오직 위로, 그것도 **전부 같은 속도**로만 움직입니다
   * (`DAMAGE_RISE`). 옆으로 치우침도 속도가 아니라 뜰 때 한 번 주는
   * 고정값입니다(`DAMAGE_SPREAD`). 그래서 서로의 상대 위치가 **수명 내내
   * 얼어붙습니다** — 한 번 벌려 놓으면 다시 붙을 길이 없습니다.
   * 매 프레임 다시 밀어내는 방식이었다면 숫자가 덜덜 떨렸을 겁니다.
   *
   * 가로·세로 모두 **카메라 축 위의 좌표**로 잽니다(`lateral` · `vert`).
   * 월드 좌표로 재면 겹침을 재는 자(글자 크기)와 단위가 달라집니다 —
   * 위 DAMAGE_RISE 아래 주석의 그 함정입니다.
   */
  private stackVert(self: DamageItem, vert: number, wx: number, wz: number): number {
    // ⚠️ 자리를 잡을 때는 **가장 부풀었을 때(DAMAGE_POP)** 의 크기로 잽니다.
    //    제 크기로 재서 딱 붙여 놓으면, 뜨는 순간의 "팡" 에서 다시 겹칩니다.
    const sw = self.inkRatioW * self.baseW * DAMAGE_POP
    const sh = self.inkRatioH * self.baseH * DAMAGE_POP
    let out = vert
    for (let step = 0; step < STACK_MAX; step++) {
      let clash = false
      for (const d of this.damages) {
        if (d === self || d.life <= 0) continue
        // 저 멀리 다른 적 위에 뜬 숫자까지 피해 다니면 안 됩니다 — 화면에서
        // 스칠 뿐인데 하늘로 올라갑니다. 가까운 것들끼리만 풉니다.
        const p = d.sprite.position
        if (Math.hypot(p.x - wx, p.z - wz) >= 6) continue
        // 잉크 상자 두 개가 겹치려면 가로·세로가 **둘 다** 붙어야 합니다.
        if (Math.abs(d.lateral - self.lateral) >= (d.inkRatioW * d.baseW * DAMAGE_POP + sw) / 2)
          continue
        if (Math.abs(d.vert - out) >= (d.inkRatioH * d.baseH * DAMAGE_POP + sh) / 2) continue
        clash = true
        break
      }
      if (!clash) break
      out += STACK_STEP
    }
    return out
  }
  /** 황금비 수열의 현재 위치(0~1). 흩뿌릴 자리를 정합니다. */
  private damageSpin = 0
  /** 카메라의 오른쪽·위 축. `update` 가 매 프레임 갱신합니다. */
  private readonly camRight = new THREE.Vector3(1, 0, 0)
  private readonly camUp = new THREE.Vector3(0, 1, 0)

  /**
   * 🔢 지금 떠 있는 숫자들의 **잉크 상자** — `npm run hud` 이 겹침을 재는 자입니다.
   *
   * 두 가지를 일부러 지킵니다.
   *   ① 스프라이트가 아니라 **글자** 크기 (위 `inkRatioW` 주석).
   *   ② 굳혀 둔 값이 아니라 **지금 화면에 그려진** 크기 — 팡 하며 줄어드는
   *      중이면 줄어든 크기가 나옵니다. 계측기가 실제보다 큰 상자를 돌려주면
   *      *"겹쳤다"* 가 부풀어 나오고, 그 값을 보고 게임을 고치면 엉뚱한 데를
   *      만지게 됩니다.
   */
  debugDamages(): {
    x: number
    y: number
    z: number
    w: number
    h: number
    lateral: number
    age: number
  }[] {
    const out = []
    for (const d of this.damages) {
      if (d.life <= 0) continue
      const p = d.sprite.position
      out.push({
        x: p.x,
        y: p.y,
        z: p.z,
        w: d.inkRatioW * d.sprite.scale.x,
        h: d.inkRatioH * d.sprite.scale.y,
        // 겹쳤을 때 **쌓기가 몇 칸 걸렸는지**를 되짚으려면 이 둘이 필요합니다.
        // 화면 좌표만 보면 "안 올라갔다"와 "올라갔는데 모자랐다"가 같아 보입니다.
        lateral: d.lateral,
        age: DAMAGE_LIFE - d.life,
      })
    }
    return out
  }

  spawnHitSpark(x: number, y: number, z: number, scale = 1): void {
    const item = this.sparks[this.sparkCursor]
    this.sparkCursor = (this.sparkCursor + 1) % SPARK_POOL
    item.mesh.position.set(x, y, z)
    item.mesh.visible = true
    item.material.opacity = 1
    item.life = SPARK_LIFE
    item.scale = scale
  }

  /**
   * 검격 궤적. **실제 판정과 같은 사거리·같은 각도**로 그립니다.
   * 이 도형이 곧 "내 공격이 닿는 범위"의 설명이므로, 조금이라도 어긋나면
   * 플레이어가 사거리를 잘못 배우게 됩니다.
   */
  /**
   * @param power 이 한 방의 **무게** 0~1 (arsenal `swingPower`).
   *              색·두께·머무는 시간이 이 값 하나로 갈립니다.
   */
  spawnSwing(
    x: number,
    z: number,
    rotY: number,
    range: number,
    arcDeg: number,
    power = 0,
    /**
     * 🏆 **등급 물들임** — 등급 색과 그 세기(0=안 물들임, 1=완전히 그 색).
     *
     * ── 왜 여기인가 (스크린샷을 보고 옮겼습니다) ─────────────────────
     * 처음엔 손에 든 무기 모델을 빛나게 했습니다. 찍어 보니 **안 보였습니다** —
     * 이 카메라에서 캐릭터는 40px 남짓이고 칼은 그 안의 몇 픽셀입니다.
     * "화려한 전설의 검"이 화면에서 **한 픽셀도 화려하지 않았습니다.**
     *
     * 이 줌에서 크게 보이는 것은 **휘두른 자국**입니다. 그리고 그게
     * 나오는 순간은 정확히 *"내 무기가 특별하다"* 를 말하고 싶은
     * 순간입니다. 손맛이 나는 자리에 등급을 얹습니다.
     *
     * ⚠️ **무게 색을 덮지 않고 섞습니다.** 무게(가벼움↔무거움)는 이미
     *    이 자국의 색으로 말하고 있고, 그건 손맛의 정보입니다. 등급이
     *    그걸 지우면 정보 하나를 장식으로 바꾸는 셈입니다.
     */
    tierColor = 0,
    tierMix = 0,
  ): void {
    const item = this.swings[this.swingCursor]
    this.swingCursor = (this.swingCursor + 1) % SWING_POOL
    item.mesh.geometry = this.crescentGeo(arcDeg)
    item.mesh.position.set(x, 0.06, z)
    item.mesh.rotation.y = rotY
    // 단위 초승달(반지름 1)을 사거리만큼 균등 확대. X/Z를 다르게 주면
    // 타원으로 찌그러져 표시 범위와 판정 범위가 어긋납니다.
    item.baseScale = range
    item.mesh.scale.set(range, 1, range)
    item.mesh.visible = true
    item.material.opacity = 1
    /**
     * ⚔️ 무게가 세 가지를 한꺼번에 움직입니다 — 색·크기·머무는 시간.
     *
     * 하나만 바꾸면 (예: 색만) 눈에 잘 안 들어옵니다. 주변 시야로 보는
     * 화면에서 읽히는 것은 **여러 신호가 같은 방향으로 함께 움직일 때**
     * 입니다 — 이 저장소가 반격 신호를 만들 때 이미 쓴 규칙입니다
     * (테두리만 바꾸지 않고 맥박을 같이 준 것).
     */
    const w = Math.max(0, Math.min(1, power))
    item.material.color.setHex(SWING_COLOR_LIGHT).lerp(new THREE.Color(SWING_COLOR_HEAVY), w)
    // 🏆 등급이 있으면 그쪽으로 **섞습니다**(덮지 않습니다 — 위 주석).
    if (tierMix > 0) {
      item.material.color.lerp(new THREE.Color(tierColor), Math.min(0.75, tierMix))
    }
    item.mesh.scale.y = 1 + w * 0.6
    item.life = SWING_LIFE + (SWING_LIFE_HEAVY - SWING_LIFE) * w
    item.maxLife = item.life
  }

  /**
   * 지금 화면에 검격 궤적이 떠 있는가.
   *
   * 검증 도구가 **궤적이 실제로 보이는 프레임**을 집어내는 데 씁니다.
   * 궤적은 0.19초만 살아 있어서, 브라우저 바깥에서 폴링하면 왕복 지연 때문에
   * 매번 놓칩니다(실제로 롱소드 사진에 궤적이 통째로 빠졌습니다).
   */
  hasActiveSwing(): boolean {
    for (const s of this.swings) if (s.life > 0) return true
    return false
  }

  /**
   * 🏆 **지금 떠 있는 검격 자국의 색**(0xRRGGBB). 없으면 -1.
   *
   * 스크린샷으로 등급 물들임을 확인하려다 배웠습니다 — 두 장의 **애니메이션
   * 시점이 달라서** 픽셀 비교가 색이 아니라 타이밍을 재고 있었습니다.
   * (밝은 자리가 다른 장에서는 어두운 바닥이었습니다.)
   *
   * 그래서 **그린 값**을 직접 묻습니다. 이 저장소가 콤보 궤적을 잴 때
   * 쓴 방법 그대로입니다(`debugSwingPose`) — 규칙을 다시 계산하지 않고
   * 화면에 실제로 놓인 값을 봅니다.
   */
  debugSwingColor(): number {
    for (const s of this.swings) if (s.life > 0) return s.material.color.getHex()
    return -1
  }

  update(camera: THREE.Camera): void {
    const dt = time.realDt

    // 카메라의 오른쪽·위 축 — 데미지 숫자를 **화면 가로/세로로** 흩뿌리고
    // 쌓기 위한 것(DAMAGE_RISE 아래 주석: 월드 축으로 하면 단위가 어긋납니다).
    this.camRight.setFromMatrixColumn(camera.matrixWorld, 0)
    this.camUp.setFromMatrixColumn(camera.matrixWorld, 1)

    for (const d of this.damages) {
      if (d.life <= 0) continue
      d.life -= dt
      if (d.life <= 0) {
        d.sprite.visible = false
        continue
      }
      const t = 1 - d.life / DAMAGE_LIFE
      // 화면 위로만, 그것도 **전부 같은 속도**로 — 뜰 때 벌려 둔 간격이
      // 그대로 유지됩니다(DAMAGE_RISE 주석: 포물선이면 뒤에 뜬 숫자가 앞을
      // 관통하고, 월드 축으로 올리면 화면에서 절반밖에 안 올라갑니다).
      const rise = DAMAGE_RISE * dt
      d.sprite.position.addScaledVector(this.camUp, rise)
      d.vert += rise
      // 위치 대신 **크기**로 튑니다. 크기는 이웃과의 간격을 건드리지 않습니다.
      const age = DAMAGE_LIFE - d.life
      const pop =
        age < DAMAGE_POP_T ? 1 + (DAMAGE_POP - 1) * (1 - age / DAMAGE_POP_T) ** 2 : 1
      d.sprite.scale.set(d.baseW * pop, d.baseH * pop, 1)
      // 마지막 35%에서만 사라지게 — 너무 일찍 흐려지면 숫자를 못 읽습니다.
      d.sprite.material.opacity = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35
    }

    for (const s of this.sparks) {
      if (s.life <= 0) continue
      s.life -= dt
      if (s.life <= 0) {
        s.mesh.visible = false
        continue
      }
      const t = 1 - s.life / SPARK_LIFE
      const size = s.scale * (0.6 + t * 2.4)
      s.mesh.scale.set(size, size, 1)
      s.material.opacity = 1 - t
      s.mesh.quaternion.copy(camera.quaternion)
    }

    for (const g of this.grounds) {
      if (g.life <= 0) continue
      g.life -= dt
      if (g.life <= 0) {
        g.mesh.visible = false
        continue
      }
      const t = 1 - g.life / g.maxLife
      if (g.mode === 'fill') {
        // 안쪽이 차오르는 속도 = 남은 예고 시간. 다 차면 터집니다.
        const s2 = g.radius * (0.06 + t * 0.94)
        g.mesh.scale.set(s2, 1, s2)
        g.material.opacity = 0.5
      } else if (g.mode === 'fade') {
        const s2 = g.radius * (1 + t * 0.14)
        g.mesh.scale.set(s2, 1, s2)
        g.material.opacity = 0.8 * (1 - t)
      } else {
        // outline — 예고 내내 같은 자리에 같은 세기로 남아 범위를 알려줍니다.
        g.material.opacity = 0.42
      }
    }

    for (const w of this.swings) {
      if (w.life <= 0) continue
      w.life -= dt
      if (w.life <= 0) {
        w.mesh.visible = false
        continue
      }
      const t = 1 - w.life / (w.maxLife || SWING_LIFE)
      // 살짝 커지면서 사라집니다 — 칼이 지나간 뒤 잔상이 퍼지는 느낌.
      const grow = 1 + t * 0.12
      w.mesh.scale.x = w.baseScale * grow
      w.mesh.scale.z = w.baseScale * grow
      // 뒤쪽 60%에서만 급격히 사라지게 해서, 초반에는 확실히 보이게 합니다.
      w.material.opacity = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6
    }
  }

  dispose(): void {
    for (const d of this.damages) {
      this.scene.remove(d.sprite)
      d.texture.dispose()
      d.sprite.material.dispose()
    }
    for (const s of this.sparks) {
      this.scene.remove(s.mesh)
      s.material.dispose()
    }
    for (const w of this.swings) {
      this.scene.remove(w.mesh)
      w.material.dispose()
    }
    for (const g of this.grounds) {
      this.scene.remove(g.mesh)
      g.material.dispose()
    }
    for (const geo of this.sectorCache.values()) geo.dispose()
    this.sectorCache.clear()
    for (const geo of this.crescentCache.values()) geo.dispose()
    this.crescentCache.clear()
    this.glowTexture.dispose()
  }
}
