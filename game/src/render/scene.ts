import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { CAMERA, WORLD } from '../config/balance'

export interface SceneBundle {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  cursorRing: THREE.Mesh
  sunTarget: THREE.Object3D
  /** 기본 아레나(원형 바닥·격자·경계). 레벨을 불러오면 통째로 끕니다. */
  arena: THREE.Group
  /** 목표 방향을 가리키는 지면 화살표 */
  guide: THREE.Group
  guideMaterials: THREE.MeshBasicMaterial[]
}

/**
 * ── ✨ **«보는 맛» 실험 스위치 (`?look=1`)** ────────────────────────────
 *
 * 왜 기본값이 아닌가: 이건 **눈으로 골라야 하는 값**입니다. 이 저장소의
 * 다른 값들은 계기가 판정하지만, «예쁜가»는 어느 프로브도 못 잽니다
 * (`npm run dressing` 이 스스로 적어 둔 문장입니다). 그래서 기본 게임은
 * 건드리지 않고, **전/후를 같은 자리에서 찍어 비교**할 수 있게만 둡니다.
 *
 * 고른 것 셋과 근거:
 *   ① **블룸** — 불티·타격·예고가 «빛나기» 시작합니다. 지금 색이 전부
 *      단색이라 밝은 것과 어두운 것의 차이가 납작한데, 그걸 가장 싸게
 *      메웁니다.
 *   ② **채도·대비 + 비네트** — 가장자리를 눌러 시선을 가운데로 모읍니다.
 *      씬에 이미 안개로 같은 일을 하고 있어서 방향이 맞습니다.
 *   ③ **평면 셰이딩** — 면마다 색이 딱 갈립니다. 원시 도형이 «임시»가
 *      아니라 **로우폴리 스타일**로 읽히게 만드는 가장 큰 한 수입니다.
 *
 * ⚠️ 아트 에셋(모델·텍스처)은 여기서 못 만듭니다. 이건 **같은 도형으로
 *    어디까지 가는가**의 상한을 보여 주는 것입니다.
 */
export const LOOK =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('look') === '1'

/** ✨ 채도·대비·비네트를 한 번에 거는 아주 작은 셰이더. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1.22 },
    contrast: { value: 1.1 },
    vignette: { value: 0.9 },
    lift: { value: new THREE.Color(0x0a0d14) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation; uniform float contrast; uniform float vignette;
    uniform vec3 lift;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // 채도 — 회색 기준으로 색을 밀어냅니다.
      float g = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(g), c.rgb, saturation);
      // 대비 — 중간값(0.5) 기준으로 벌립니다.
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      // 그림자를 완전한 검정 대신 살짝 푸르게 (필름 느낌 · 안개색과 이어집니다)
      c.rgb = max(c.rgb, lift * (1.0 - g));
      // 비네트 — 가장자리를 눌러 시선을 가운데로.
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * dot(d, d);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }
  `,
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
  // ✨ 룩 모드에서는 조금 더 밝게 — 블룸이 먹을 여지를 줍니다.
  renderer.toneMappingExposure = LOOK ? 1.25 : 1.05

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

  // ---- 목표 방향 화살표 -------------------------------------------------
  // 미니맵을 쓰지 않기로 했으므로(DESIGN.md 기둥 4), 길 안내는 **월드 안에서** 합니다.
  // 발밑에서 목표 쪽으로 흘러가는 화살표 세 개. 오공이 미니맵 없이 조명과
  // 지형으로 길을 안내한 것과 같은 접근이되, 도형 프로토타입이라 더 직접적으로 씁니다.
  const guide = new THREE.Group()
  const chevron = new THREE.Shape()
  chevron.moveTo(-0.78, -0.44)
  chevron.lineTo(0, 0.44)
  chevron.lineTo(0.78, -0.44)
  chevron.lineTo(0, 0.03)
  const chevronGeo = new THREE.ShapeGeometry(chevron)
  chevronGeo.rotateX(Math.PI / 2) // 셰이프의 +Y 가 월드 +Z(정면)가 되도록 눕힘
  const guideMaterials: THREE.MeshBasicMaterial[] = []
  for (let i = 0; i < 3; i++) {
    // 가산 합성(Additive)입니다. 알파로만 섞으면 어두운 바닥색과 평균이 나서
    // 금색이 **탁한 갈색**으로 주저앉습니다 — 첫 판이 실제로 그랬습니다.
    // 가산은 바닥 위에 빛을 얹으므로 어두울수록 오히려 또렷해집니다.
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd479,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(chevronGeo, mat)
    mesh.position.set(0, 0, 2.3 + i * 1.3)
    mesh.renderOrder = 4
    guide.add(mesh)
    guideMaterials.push(mat)
  }
  guide.visible = false
  scene.add(guide)

  return { renderer, scene, cursorRing, sunTarget, arena, guide, guideMaterials }
}

/**
 * ── ✨ **후처리 사슬을 만듭니다 (`?look=1` 일 때만)** ────────────────
 *
 * 카메라가 필요해서 `createScene` 안이 아니라 **밖**에 둡니다 — 카메라는
 * main.ts 가 들고 있습니다. 씬 만들 때 임시 카메라를 넣고 나중에 바꾸는
 * 길도 있지만, 그러면 «지금 어느 카메라로 그리는가»가 두 곳이 됩니다.
 *
 * 순서가 중요합니다: 씬 → 블룸 → 색보정 → 출력.
 * 색보정을 블룸 **뒤에** 두는 이유: 앞에 두면 비네트로 눌러 둔 가장자리를
 * 블룸이 다시 밝혀서 눌러 둔 뜻이 사라집니다.
 *
 * `OutputPass` 는 톤매핑·색공간 변환을 **마지막에 한 번** 합니다. 이걸
 * 빼면 켠 순간 화면이 통째로 밝고 뿌옇게 됩니다 — 렌더러가 하던 일을
 * 사슬이 대신 안 해 주기 때문입니다.
 */
export function createLookComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): EffectComposer | null {
  if (!LOOK) return null
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  /**
   * 세기 0.55 · 문턱 0.72 — **문턱이 핵심**입니다. 낮추면 바닥·벽까지
   * 번져서 «안개 낀 화면»이 되고, 이 게임이 지키려는 «예고가 눈에 띈다»가
   * 오히려 나빠집니다. 밝은 것(불티·타격·예고)만 뽑습니다.
   */
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.7, 0.72))
  composer.addPass(new ShaderPass(GradeShader))
  composer.addPass(new OutputPass())
  return composer
}
