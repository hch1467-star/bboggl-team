import * as THREE from 'three'
import { CAMERA } from '../config/balance'

const DEG = Math.PI / 180

/**
 * 에디터 전용 카메라 — 게임 카메라와 달리 자유롭게 돌리고 옮기고 확대합니다.
 *
 * 왜 **회전**이 반드시 필요한가:
 * 쿼터뷰는 각도가 고정이라 지형 뒤쪽이 항상 가려집니다. 게임에서는 그게 연출이지만,
 * 레벨을 만들 때는 가려진 곳을 편집할 수가 없어 치명적입니다.
 * 그래서 에디터에서만 90°씩 돌려볼 수 있게 합니다.
 * (게임 쪽 카메라는 고정 유지 — 각도가 바뀌면 조작 방향이 흔들려 멀미가 납니다.)
 */
export class EditorCamera {
  readonly camera: THREE.OrthographicCamera
  readonly target = new THREE.Vector3()
  readonly forward = new THREE.Vector3()
  readonly right = new THREE.Vector3()

  // balance.ts 가 `as const` 라서 리터럴 타입(45)이 잡힙니다. 회전시켜야 하므로 number로 넓힙니다.
  private yawDeg: number = CAMERA.yawDeg
  private readonly pitchDeg: number = CAMERA.pitchDeg
  private viewSize = 46
  private aspect = 1
  private readonly offsetDir = new THREE.Vector3()
  private readonly raycaster = new THREE.Raycaster()
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly ndc = new THREE.Vector2()
  private readonly tmp = new THREE.Vector3()

  constructor(aspect: number) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800)
    this.aspect = aspect
    this.recomputeBasis()
    this.resize(aspect)
    this.update()
  }

  private recomputeBasis(): void {
    const yaw = this.yawDeg * DEG
    const pitch = this.pitchDeg * DEG
    this.offsetDir.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    )
    this.forward.set(-this.offsetDir.x, 0, -this.offsetDir.z).normalize()
    this.right.set(-this.forward.z, 0, this.forward.x)
  }

  resize(aspect: number): void {
    this.aspect = aspect
    const halfH = this.viewSize / 2
    const halfW = halfH * aspect
    this.camera.left = -halfW
    this.camera.right = halfW
    this.camera.top = halfH
    this.camera.bottom = -halfH
    this.camera.updateProjectionMatrix()
  }

  update(): void {
    this.camera.position.copy(this.target).addScaledVector(this.offsetDir, 200)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.target)
    this.camera.updateMatrixWorld()
  }

  rotate(stepDeg: number): void {
    this.yawDeg = (this.yawDeg + stepDeg + 360) % 360
    this.recomputeBasis()
    this.update()
  }

  get yaw(): number {
    return this.yawDeg
  }

  zoomBy(factor: number): void {
    this.viewSize = THREE.MathUtils.clamp(this.viewSize * factor, 8, 200)
    this.resize(this.aspect)
    this.update()
  }

  get zoomLevel(): number {
    return this.viewSize
  }

  /**
   * 화면 픽셀 이동량만큼 시점을 옮깁니다.
   * 세로 이동은 pitch로 나눠줘야 합니다 — 카메라가 기울어져 있어서 화면상 1px이
   * 지면에서는 더 긴 거리에 해당하기 때문입니다. 안 나누면 위아래로 끌 때
   * 커서보다 지형이 느리게 따라와 손에 안 붙는 느낌이 납니다.
   */
  panByPixels(dxPx: number, dyPx: number, canvasHeightPx: number): void {
    const worldPerPixel = this.viewSize / canvasHeightPx
    const sinPitch = Math.sin(this.pitchDeg * DEG)
    this.target.addScaledVector(this.right, -dxPx * worldPerPixel)
    this.target.addScaledVector(this.forward, (dyPx * worldPerPixel) / sinPitch)
    this.update()
  }

  focusOn(x: number, z: number): void {
    this.target.set(x, 0, z)
    this.update()
  }

  /** 화면(NDC) -> 지면(y = planeY) 교차점. 편집 중인 높이 평면에 맞춰 쏩니다. */
  screenToPlane(ndcX: number, ndcY: number, planeY: number, out: { x: number; z: number }): boolean {
    this.ndc.set(ndcX, ndcY)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    this.groundPlane.constant = -planeY
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmp)
    if (!hit) return false
    out.x = hit.x
    out.z = hit.z
    return true
  }
}
