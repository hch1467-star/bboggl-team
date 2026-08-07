import * as THREE from 'three'
import { CAMERA, WORLD } from '../config/balance'

export interface SceneBundle {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  cursorRing: THREE.Mesh
  sunTarget: THREE.Object3D
  /** 기본 아레나(원형 바닥·격자·경계). 레벨을 불러오면 통째로 끕니다. */
  arena: THREE.Group
}

/**
 * 월드 셋업.
 *
 * 지금은 전부 도형(Primitive)입니다. 의도된 것입니다 — 전투 손맛이 검증되기 전에
 * 아트를 넣으면, 재미없는 게임을 예쁘게 포장한 상태가 되어 문제를 못 보게 됩니다.
 * 나중에 Synty POLYGON 같은 glTF 에셋으로 교체할 때 이 파일과 visuals.ts만 바뀝니다.
 */
/**
 * ?lowfx=1 로 접속하면 그림자와 안티에일리어싱을 끕니다.
 * - 헤드리스 자동 검증(소프트웨어 렌더링)에서 프레임을 확보하기 위해 필요하고,
 * - 저사양 PC / 모바일 사용자에게도 그대로 쓸 수 있는 옵션입니다.
 */
export const LOW_FX =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('lowfx') === '1'

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !LOW_FX,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(LOW_FX ? 1 : Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = !LOW_FX
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d1017)
  // 가장자리를 어둡게 깔아 시선을 중앙(플레이어)에 모읍니다.
  //
  // 안개 거리는 **카메라 기준**입니다. 쿼터뷰 카메라는 대상에서 CAMERA.distance 만큼
  // 떨어져 있으므로, 그 거리를 더해주지 않으면 씬 전체가 안개 far 밖으로 나가
  // 화면이 통째로 배경색(검정)이 됩니다.
  scene.fog = new THREE.Fog(
    0x0d1017,
    CAMERA.distance + WORLD.arenaRadius * 0.25,
    CAMERA.distance + WORLD.arenaRadius * 1.7,
  )

  // ---- 조명 -------------------------------------------------------------
  // 하늘/땅 두 색을 섞는 환경광. 단색 AmbientLight보다 입체감이 훨씬 좋습니다.
  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x2a2118, 1.15))

  const sun = new THREE.DirectionalLight(0xffe7c4, 2.1)
  sun.position.set(14, 22, 9)
  sun.castShadow = !LOW_FX
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -WORLD.arenaRadius
  sun.shadow.camera.right = WORLD.arenaRadius
  sun.shadow.camera.top = WORLD.arenaRadius
  sun.shadow.camera.bottom = -WORLD.arenaRadius
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 80
  sun.shadow.bias = -0.0012
  sun.shadow.normalBias = 0.02
  scene.add(sun)

  // 그림자 카메라가 플레이어를 따라다니도록 타깃을 분리해 둡니다.
  const sunTarget = new THREE.Object3D()
  scene.add(sunTarget)
  sun.target = sunTarget

  // 반대편에서 살짝 채워주는 보조광 — 캐릭터 실루엣이 어둠에 묻히지 않게.
  const rim = new THREE.DirectionalLight(0x5f7dc7, 0.7)
  rim.position.set(-12, 9, -14)
  scene.add(rim)

  // ---- 지면 -------------------------------------------------------------
  const arena = new THREE.Group()
  scene.add(arena)

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD.arenaRadius, 96),
    new THREE.MeshStandardMaterial({ color: 0x2f3542, roughness: 0.96, metalness: 0.0 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  arena.add(ground)

  // 격자 — 쿼터뷰에서 거리감을 읽는 데 결정적입니다. 이게 없으면 내가 얼마나
  // 움직였는지, 적이 몇 미터 앞인지 눈으로 가늠할 수가 없습니다.
  const grid = new THREE.GridHelper(
    WORLD.arenaRadius * 2,
    (WORLD.arenaRadius * 2) / WORLD.gridSize,
    0x4a5568,
    0x39414f,
  )
  const gridMat = grid.material as THREE.Material
  gridMat.transparent = true
  gridMat.opacity = 0.5
  grid.position.y = 0.01
  arena.add(grid)

  // 아레나 경계 링
  const boundary = new THREE.Mesh(
    new THREE.RingGeometry(WORLD.arenaRadius - 0.35, WORLD.arenaRadius, 96),
    new THREE.MeshBasicMaterial({ color: 0x6f8bc4, transparent: true, opacity: 0.55 }),
  )
  boundary.rotation.x = -Math.PI / 2
  boundary.position.y = 0.02
  arena.add(boundary)

  // ---- 커서 링 ----------------------------------------------------------
  // 마우스 조준 위치를 지면에 표시합니다. 쿼터뷰에서 "어디를 겨누는지"를
  // 보여주지 않으면 플레이어는 자기 캐릭터가 어디를 보는지 알 수 없습니다.
  const cursorRing = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.46, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffd479,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  )
  cursorRing.rotation.x = -Math.PI / 2
  cursorRing.position.y = 0.03
  cursorRing.renderOrder = 2
  scene.add(cursorRing)

  return { renderer, scene, cursorRing, sunTarget, arena }
}
