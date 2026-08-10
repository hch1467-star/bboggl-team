import * as THREE from 'three'
import { CAMERA } from '../config/balance'
import { time } from '../core/time'

const DEG = Math.PI / 180

/**
 * 쿼터뷰 카메라 리그.
 *
 * 설계 근거 — 왜 원근(Perspective)이 아니라 직교(Orthographic) 카메라인가:
 *  - 쿼터뷰의 정체는 "고정된 각도의 직교 투영"입니다. 원근을 쓰면 화면 가장자리의
 *    캐릭터가 기울어져 보이고, 같은 크기의 적이 위치에 따라 다르게 보여서
 *    거리 판단(= 회피 타이밍)이 어긋납니다.
 *  - 직교 투영은 화면 어디서든 1m가 항상 같은 픽셀 수라, 공격 사거리를 눈으로
 *    가늠할 수 있습니다. 소울라이크식 전투에서 이건 필수입니다.
 */
export class QuarterViewCamera {
  readonly camera: THREE.OrthographicCamera

  /** 카메라가 향하는 지점 (플레이어 위치 + 조준 리드) */
  private readonly focus = new THREE.Vector3()
  /** 부드럽게 따라오는 실제 지점 */
  private readonly smoothed = new THREE.Vector3()

  /** target -> camera 방향 단위 벡터 */
  private readonly offsetDir = new THREE.Vector3()
  /** XZ 평면 기준 카메라 전방/우측 (WASD 변환용) */
  readonly forward = new THREE.Vector3()
  readonly right = new THREE.Vector3()

  /** 화면 흔들림 — trauma 방식(제곱 감쇠)이 선형보다 훨씬 자연스럽습니다. */
  private trauma = 0
  /** 달리기 시야 확대 — 0이면 걷기, 1이면 최대. */
  private sprintTarget = 0
  private sprintMix = 0
  private readonly shakeBias = new THREE.Vector2()

  private readonly raycaster = new THREE.Raycaster()
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly ndc = new THREE.Vector2()
  private readonly tmp = new THREE.Vector3()
  private initialised = false

  constructor(aspect: number) {
    const yaw = CAMERA.yawDeg * DEG
    const pitch = CAMERA.pitchDeg * DEG

    this.offsetDir.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    )

    // 카메라 전방 = 오프셋의 반대 방향을 지면에 투영한 것
    this.forward.set(-this.offsetDir.x, 0, -this.offsetDir.z).normalize()
    // right = forward × up  (Three.js 오른손 좌표계, Y가 위)
    this.right.set(-this.forward.z, 0, this.forward.x)

    const halfH = CAMERA.viewSize / 2
    const halfW = halfH * aspect
    // near를 음수로 두면 카메라 뒤쪽 지오메트리도 잘리지 않습니다(직교 카메라의 관용적 기법).
    this.camera = new THREE.OrthographicCamera(
      -halfW,
      halfW,
      halfH,
      -halfH,
      -CAMERA.distance * 2,
      CAMERA.distance * 4,
    )
  }

  resize(aspect: number): void {
    const halfH = CAMERA.viewSize / 2
    const halfW = halfH * aspect
    this.camera.left = -halfW
    this.camera.right = halfW
    this.camera.top = halfH
    this.camera.bottom = -halfH
    this.camera.updateProjectionMatrix()
  }

  /**
   * 충격을 더합니다.
   * @param amount 0~1 (약공격 0.2, 마무리 0.5, 처치 0.45 정도)
   * @param dirX,dirZ 월드 기준 충격 방향. 주면 그 방향으로 카메라가 밀립니다.
   *        (연구 결과: 방향성 있는 흔들림이 무작위 흔들림보다 타격감이 크게 좋습니다)
   */
  /**
   * ── 달리는 동안 시야를 조금 넓힙니다 ──────────────────────────────
   *
   * 연출이 아니라 **반응 시간** 때문입니다. 화면이 세로로 22m 를 담으므로
   * 화면 끝에 나타난 적까지 걷기(5.4m/s)로 2.0초, 달리기(8.4m/s)로는
   * **1.3초** 입니다. 속도를 올린 만큼 읽을 시간이 줄어듭니다.
   *
   * ⚠️ 속도만큼(1.55배) 넓히지는 **않습니다.** 그러면 캐릭터가 작아져서
   * 쿼터뷰에서 4색 예고와 등 뒤 표시를 읽을 수가 없습니다 — 이 게임이
   * 읽히는 이유를 시야를 넓히려다 깨는 셈입니다. 1.18배(22m → 26m)면
   * 잃은 시간의 40%쯤을 되돌리면서 화면의 밀도는 유지됩니다.
   *
   * 되돌아오는 것은 **빠르게**(0.18초), 넓어지는 것은 천천히(0.45초).
   * 멈추는 순간 시야가 늦게 좁혀지면 전투가 시작됐는데 화면이 아직
   * "이동 중"인 상태가 됩니다.
   */
  /** 지금 줌 — 프로브가 "시야가 실제로 넓어졌는가"를 재려면 필요합니다. */
  currentZoom(): number {
    return this.camera.zoom
  }

  setSprint(mix: number): void {
    this.sprintTarget = Math.max(0, Math.min(1, mix))
  }

  addTrauma(amount: number, dirX = 0, dirZ = 0): void {
    this.trauma = Math.min(1, this.trauma + amount)
    if (dirX !== 0 || dirZ !== 0) {
      // 월드 방향을 화면 방향(가로=right, 세로=forward)으로 투영
      const sx = dirX * this.right.x + dirZ * this.right.z
      const sy = dirX * this.forward.x + dirZ * this.forward.z
      const len = Math.hypot(sx, sy) || 1
      this.shakeBias.set(sx / len, sy / len)
    } else {
      this.shakeBias.set(0, 0)
    }
  }

  /**
   * @param focusX,focusY,focusZ 따라갈 대상(플레이어) 위치
   * @param aimX,aimZ 커서의 지면 위치 — 시야를 그쪽으로 살짝 밀어줍니다
   *
   * Y를 따라가는 이유: 높이 지형에서 계단을 오르면 캐릭터가 화면 위로 밀려납니다.
   * 카메라가 높이를 안 따라가면 언덕을 오를수록 캐릭터가 화면 밖으로 나갑니다.
   */
  update(focusX: number, focusY: number, focusZ: number, aimX: number, aimZ: number): void {
    // 커서 방향으로 리드. 조준 지점이 화면 안에 들어와 조준감이 좋아집니다.
    let leadX = (aimX - focusX) * CAMERA.aimLeadFactor
    let leadZ = (aimZ - focusZ) * CAMERA.aimLeadFactor
    const leadLen = Math.hypot(leadX, leadZ)
    if (leadLen > CAMERA.aimLeadMax) {
      const s = CAMERA.aimLeadMax / leadLen
      leadX *= s
      leadZ *= s
    }
    this.focus.set(focusX + leadX, focusY, focusZ + leadZ)

    if (!this.initialised) {
      this.smoothed.copy(this.focus)
      this.initialised = true
    } else {
      // 프레임레이트에 무관한 지수 감쇠 보간. lerp(t*dt)를 쓰면 60fps와 144fps에서
      // 따라오는 속도가 달라집니다 — 이 공식은 그 문제가 없습니다.
      const k = 1 - Math.exp(-CAMERA.followLerp * time.realDt)
      this.smoothed.lerp(this.focus, k)
    }

    // 기본 배치
    this.camera.position.copy(this.smoothed).addScaledVector(this.offsetDir, CAMERA.distance)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.smoothed)

    // 흔들림은 realDt로 감쇠 — 히트스톱 중에도 카메라는 계속 흔들려야 합니다.
    /**
     * 시야는 **실시간(realDt)** 으로 움직입니다. 히트스톱 중에 시야가 같이
     * 멈추면 타격 순간 화면이 굳어 보입니다 — 흔들림·연출과 같은 축입니다.
     */
    {
      const up = this.sprintTarget > this.sprintMix
      const rate = up ? 1 / 0.45 : 1 / 0.18
      const step = rate * time.realDt
      this.sprintMix += Math.max(-step, Math.min(step, this.sprintTarget - this.sprintMix))
      const zoom = 1 / (1 + (CAMERA.sprintViewScale - 1) * this.sprintMix)
      if (Math.abs(this.camera.zoom - zoom) > 0.0005) {
        this.camera.zoom = zoom
        this.camera.updateProjectionMatrix()
      }
    }

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - CAMERA.shake.decay * time.realDt)
      const shake = this.trauma * this.trauma // 제곱: 약할 땐 거의 안 보이고 강할 때 확 튐
      const t = time.elapsed * CAMERA.shake.frequency
      // 값싼 유사 노이즈. 주기가 서로 안 맞는 사인 두 개를 곱하면 반복감이 사라집니다.
      const nx = Math.sin(t) * Math.sin(t * 2.37 + 1.1)
      const ny = Math.sin(t * 1.63 + 1.7) * Math.sin(t * 3.11)

      const ox = (nx * 0.6 + this.shakeBias.x * 0.9) * shake * CAMERA.shake.maxOffset
      const oy = (ny * 0.6 + this.shakeBias.y * 0.9) * shake * CAMERA.shake.maxOffset

      this.camera.translateX(ox)
      this.camera.translateY(oy)
      this.camera.rotateZ(nx * shake * CAMERA.shake.maxRollDeg * DEG)
    }

    this.camera.updateMatrixWorld()
  }

  /** 카메라를 목표 지점에 즉시 붙입니다(레벨 시작 시 화면이 미끄러지지 않게). */
  snapTo(x: number, z: number): void {
    this.focus.set(x, 0, z)
    this.smoothed.copy(this.focus)
    this.initialised = true
  }

  /**
   * 화면 좌표(NDC) -> 지면 월드 좌표.
   * 마우스 조준의 핵심. 실패하면(카메라가 지면과 평행) false.
   *
   * @param planeY 조준 평면의 높이. 플레이어가 서 있는 높이를 넘겨야
   *   언덕 위에서 커서와 실제 조준 방향이 어긋나지 않습니다.
   */
  screenToGround(
    ndcX: number,
    ndcY: number,
    planeY: number,
    out: { x: number; z: number },
  ): boolean {
    this.ndc.set(ndcX, ndcY)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    // Plane(normal=(0,1,0), constant=c) 는 y = -c 평면입니다.
    this.groundPlane.constant = -planeY
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmp)
    if (!hit) return false
    out.x = hit.x
    out.z = hit.z
    return true
  }

  /** 디버그/검증용 */
  get currentTrauma(): number {
    return this.trauma
  }
}
