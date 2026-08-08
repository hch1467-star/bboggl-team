import * as THREE from 'three'
import {
  CELL_SIZE,
  ENTITY_COLOR,
  HEIGHT_STEP,
  MAX_HEIGHT,
  VOID,
  cellToWorld,
  createEmptyLevel,
  loadLevelFromStorage,
  parseLevel,
  saveLevelToStorage,
  serializeLevel,
  worldToCell,
  type EntityKind,
  type LevelData,
} from '../level/format'
import { Terrain } from '../level/terrain'
import { EditorCamera } from './editorCamera'

/**
 * 레벨 에디터.
 *
 * 존재 이유: 우리 게임의 4번 기둥("헤매지 않는 탐험")은 **손으로 만든 레벨**을
 * 전제로 합니다. 절차적 생성으로는 "숨긴 보물"이 성립하지 않기 때문입니다.
 * 그런데 손으로 만드는 레벨은 비쌉니다 — 그 비용을 낮추는 유일한 방법이
 * "레벨 디자인을 코딩이 아니라 마우스 작업으로 바꾸는 것"입니다.
 *
 * 그래서 이 에디터의 설계 목표는 하나입니다:
 *   **코드를 한 줄도 몰라도 지형과 배치를 직접 만들 수 있을 것.**
 */

type TerrainTool = 'raise' | 'lower' | 'flatten' | 'fill' | 'erase'
type PlaceTool = EntityKind | 'delete'
type Tool = TerrainTool | PlaceTool

const TERRAIN_TOOLS: Tool[] = ['raise', 'lower', 'flatten', 'fill', 'erase']
const SHORTCUTS: Record<string, Tool> = {
  Digit1: 'raise',
  Digit2: 'lower',
  Digit3: 'flatten',
  Digit4: 'fill',
  Digit5: 'erase',
  Digit6: 'spawn',
  Digit7: 'grunt',
  Digit8: 'treasure',
  Digit9: 'boss',
  KeyB: 'binder',
  KeyN: 'dragger',
  Digit0: 'delete',
}

const UNDO_LIMIT = 50

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`요소를 찾을 수 없습니다: #${id}`)
  return node as T
}

class Editor {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly cam: EditorCamera
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()
  private readonly tmpPoint = { x: 0, z: 0 }

  private level: LevelData
  private terrain: Terrain | null = null
  private readonly entityGroup = new THREE.Group()
  private readonly highlight: THREE.Mesh
  private readonly gridHelper: THREE.GridHelper

  private tool: Tool = 'raise'
  private brushSize = 1
  private terrainDirty = false
  private entitiesDirty = false

  private painting = false
  private panning = false
  private lastPointer = { x: 0, y: 0 }
  private strokeReferenceHeight = 0
  private hovered: { cx: number; cz: number } | null = null

  private readonly undoStack: string[] = []

  // 재사용 지오메트리 (엔티티 마커)
  private readonly markerGeos: Record<EntityKind, THREE.BufferGeometry>

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // 게임과 같은 톤매핑을 씁니다. 색 보정이 다르면 에디터에서 예쁘게 만든 지형이
    // 게임에서는 전혀 다르게 보여서, 레벨 디자인 판단이 통째로 어긋납니다.
    // 노출만 조금 올려 편집이 잘 보이게 합니다.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.35
    this.scene.background = new THREE.Color(0x11151d)

    this.cam = new EditorCamera(window.innerWidth / window.innerHeight)

    // 조명 — 에디터에서는 그림자를 끕니다. 단차는 정점 색(윗면 밝게/옆면 어둡게)만으로
    // 충분히 읽히고, 그림자가 있으면 오히려 어느 칸이 낮은지 헷갈립니다.
    this.scene.add(new THREE.HemisphereLight(0xbcd0f0, 0x2a2a33, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(12, 20, 8)
    this.scene.add(key)

    this.scene.add(this.entityGroup)

    // 격자 바닥 — 레벨 경계 밖까지 깔아서 "여기가 편집 가능한 영역"을 보여줍니다.
    this.gridHelper = new THREE.GridHelper(200, 100, 0x2f3947, 0x232a35)
    this.gridHelper.position.y = -0.02
    this.scene.add(this.gridHelper)

    this.highlight = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffd479,
        transparent: true,
        opacity: 0.34,
        depthTest: false,
      }),
    )
    this.highlight.renderOrder = 50
    this.highlight.visible = false
    this.scene.add(this.highlight)

    this.markerGeos = {
      spawn: new THREE.ConeGeometry(0.5, 1.6, 5),
      grunt: new THREE.CapsuleGeometry(0.42, 0.9, 4, 8),
      treasure: new THREE.OctahedronGeometry(0.55),
      boss: new THREE.CapsuleGeometry(0.7, 1.5, 4, 10),
      // 게임 안과 같은 실루엣 규칙 — 얽는 자는 가늘고 크게, 끄는 자는 낮고 넓게.
      binder: new THREE.CapsuleGeometry(0.34, 1.3, 4, 8),
      dragger: new THREE.CapsuleGeometry(0.55, 0.5, 4, 10),
    }

    this.level = loadLevelFromStorage() ?? createEmptyLevel()
    el<HTMLInputElement>('levelName').value = this.level.name
    this.terrainDirty = true
    this.entitiesDirty = true

    this.bindUi()
    this.bindPointer()
    window.addEventListener('resize', () => this.resize())
    this.resize()
    this.cam.focusOn(0, 0)
    this.loop()
  }

  // ---- 셋업 -------------------------------------------------------------

  private resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.cam.resize(w / h)
  }

  private bindUi(): void {
    for (const node of document.querySelectorAll<HTMLElement>('[data-tool]')) {
      node.addEventListener('click', () => this.setTool(node.dataset.tool as Tool))
    }
    for (const node of document.querySelectorAll<HTMLElement>('[data-size]')) {
      node.addEventListener('click', () => this.setBrush(Number(node.dataset.size)))
    }

    el('btnNew').addEventListener('click', () => {
      if (!confirm('현재 레벨을 버리고 새로 시작할까요?')) return
      this.pushUndo()
      this.level = createEmptyLevel()
      el<HTMLInputElement>('levelName').value = this.level.name
      this.terrainDirty = true
      this.entitiesDirty = true
      this.toast('새 레벨을 만들었습니다')
    })

    el('btnSave').addEventListener('click', () => {
      this.level.name = el<HTMLInputElement>('levelName').value || '이름 없는 레벨'
      saveLevelToStorage(this.level)
      this.toast('저장했습니다 (브라우저 저장소)')
    })

    el('btnLoad').addEventListener('click', () => {
      const loaded = loadLevelFromStorage()
      if (!loaded) return this.toast('저장된 레벨이 없습니다', true)
      this.pushUndo()
      this.level = loaded
      el<HTMLInputElement>('levelName').value = this.level.name
      this.terrainDirty = true
      this.entitiesDirty = true
      this.toast('불러왔습니다')
    })

    el('btnExport').addEventListener('click', () => {
      this.level.name = el<HTMLInputElement>('levelName').value || '이름 없는 레벨'
      const blob = new Blob([serializeLevel(this.level)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${this.level.name.replace(/[^\w가-힣-]+/g, '_')}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      this.toast('JSON 파일로 내보냈습니다')
    })

    const fileInput = el<HTMLInputElement>('fileInput')
    el('btnImport').addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0]
      if (!file) return
      const result = parseLevel(await file.text())
      fileInput.value = ''
      if ('error' in result) return this.toast(`불러오기 실패: ${result.error}`, true)
      this.pushUndo()
      this.level = result.level
      el<HTMLInputElement>('levelName').value = this.level.name
      this.terrainDirty = true
      this.entitiesDirty = true
      this.toast('JSON을 불러왔습니다')
    })

    el('btnUndo').addEventListener('click', () => this.undo())

    el('btnPlay').addEventListener('click', () => {
      this.level.name = el<HTMLInputElement>('levelName').value || '이름 없는 레벨'
      if (!this.level.entities.some((e) => e.kind === 'spawn')) {
        return this.toast('시작 지점을 먼저 배치해주세요', true)
      }
      saveLevelToStorage(this.level)
      // 상대 경로 — 로컬 개발과 GitHub Pages 하위 경로 양쪽에서 동작합니다.
      location.href = './?level=storage'
    })

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault()
        this.undo()
        return
      }
      const t = SHORTCUTS[e.code]
      if (t) {
        this.setTool(t)
        return
      }
      if (e.code === 'KeyQ') this.cam.rotate(-90)
      if (e.code === 'KeyE') this.cam.rotate(90)
    })
  }

  private bindPointer(): void {
    const canvas = this.canvas
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId)
      this.lastPointer = { x: e.clientX, y: e.clientY }
      if (e.button === 0) {
        this.updateHover(e)
        if (!this.hovered) return
        this.pushUndo()
        this.painting = true
        // 평탄화/채우기의 기준 높이는 **획을 시작한 칸**의 높이입니다.
        // 매 칸마다 다시 읽으면 브러시가 지나가며 계단이 뭉개집니다.
        const h = this.heightAt(this.hovered.cx, this.hovered.cz)
        this.strokeReferenceHeight = h === VOID ? 0 : h
        this.applyToolAt(this.hovered.cx, this.hovered.cz, true)
      } else {
        this.panning = true
      }
    })

    canvas.addEventListener('pointermove', (e) => {
      if (this.panning) {
        this.cam.panByPixels(
          e.clientX - this.lastPointer.x,
          e.clientY - this.lastPointer.y,
          canvas.clientHeight,
        )
        this.lastPointer = { x: e.clientX, y: e.clientY }
        return
      }
      this.updateHover(e)
      // 엔티티 배치는 드래그로 연속 배치하지 않습니다 — 한 번 클릭에 하나만.
      if (this.painting && this.hovered && this.isTerrainTool()) {
        this.applyToolAt(this.hovered.cx, this.hovered.cz, false)
      }
    })

    const stop = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      this.painting = false
      this.panning = false
    }
    canvas.addEventListener('pointerup', stop)
    canvas.addEventListener('pointercancel', stop)

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.cam.zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12)
      },
      { passive: false },
    )
  }

  // ---- 도구 -------------------------------------------------------------

  private isTerrainTool(): boolean {
    return TERRAIN_TOOLS.includes(this.tool)
  }

  private setTool(tool: Tool): void {
    this.tool = tool
    for (const node of document.querySelectorAll<HTMLElement>('[data-tool]')) {
      node.classList.toggle('active', node.dataset.tool === tool)
    }
  }

  private setBrush(size: number): void {
    this.brushSize = size
    for (const node of document.querySelectorAll<HTMLElement>('[data-size]')) {
      node.classList.toggle('active', Number(node.dataset.size) === size)
    }
  }

  private heightAt(cx: number, cz: number): number {
    const { w, h, heights } = this.level
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return VOID
    return heights[cz * w + cx]
  }

  private setHeight(cx: number, cz: number, value: number): void {
    const { w, h, heights } = this.level
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return
    heights[cz * w + cx] = value
  }

  /** 브러시 반경 안의 칸들을 원형으로 순회합니다. 사각 브러시는 지형이 각져 보입니다. */
  private forEachBrushCell(cx: number, cz: number, fn: (x: number, z: number) => void): void {
    const r = this.brushSize - 1
    if (r <= 0) return fn(cx, cz)
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(dx, dz) > r + 0.35) continue
        fn(cx + dx, cz + dz)
      }
    }
  }

  private applyToolAt(cx: number, cz: number, isClick: boolean): void {
    if (this.isTerrainTool()) {
      this.forEachBrushCell(cx, cz, (x, z) => {
        const cur = this.heightAt(x, z)
        switch (this.tool as TerrainTool) {
          case 'raise':
            this.setHeight(x, z, cur === VOID ? 0 : Math.min(MAX_HEIGHT, cur + 1))
            break
          case 'lower':
            this.setHeight(x, z, cur === VOID ? VOID : Math.max(0, cur - 1))
            break
          case 'flatten':
            if (cur !== VOID) this.setHeight(x, z, this.strokeReferenceHeight)
            break
          case 'fill':
            this.setHeight(x, z, this.strokeReferenceHeight)
            break
          case 'erase':
            this.setHeight(x, z, VOID)
            break
        }
      })
      this.terrainDirty = true
      return
    }

    if (!isClick) return
    const { x, z } = cellToWorld(cx, cz, this.level.w, this.level.h)

    if (this.tool === 'delete') {
      let bestIdx = -1
      let bestDist = CELL_SIZE * 1.2
      this.level.entities.forEach((e, i) => {
        const d = Math.hypot(e.x - x, e.z - z)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      })
      if (bestIdx >= 0) {
        this.level.entities.splice(bestIdx, 1)
        this.entitiesDirty = true
      }
      return
    }

    if (this.heightAt(cx, cz) === VOID) {
      this.toast('바닥이 없는 곳에는 배치할 수 없습니다', true)
      return
    }

    const kind = this.tool as EntityKind
    // 시작 지점은 하나뿐입니다. 두 개가 되면 어디서 시작할지 알 수 없습니다.
    if (kind === 'spawn') {
      this.level.entities = this.level.entities.filter((e) => e.kind !== 'spawn')
    }
    this.level.entities.push({ kind, x, z, rotY: 0 })
    this.entitiesDirty = true
  }

  // ---- 되돌리기 ---------------------------------------------------------

  private pushUndo(): void {
    this.undoStack.push(serializeLevel(this.level))
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
  }

  private undo(): void {
    const prev = this.undoStack.pop()
    if (!prev) return this.toast('되돌릴 작업이 없습니다', true)
    const result = parseLevel(prev)
    if ('error' in result) return
    this.level = result.level
    el<HTMLInputElement>('levelName').value = this.level.name
    this.terrainDirty = true
    this.entitiesDirty = true
  }

  // ---- 화면 -------------------------------------------------------------

  private updateHover(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect()
    this.ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )

    let px = 0
    let pz = 0
    let found = false

    // 광선을 먼저 만든 뒤에 교차 검사를 해야 합니다.
    this.raycaster.setFromCamera(this.ndc, this.cam.camera)

    // 먼저 지형 메시에 직접 쏩니다. 평면에만 쏘면 높은 지형 위를 클릭할 때
    // 실제로는 뒤쪽의 낮은 칸이 선택되어 버립니다.
    if (this.terrain) {
      const hits = this.raycaster.intersectObjects(this.terrain.group.children, false)
      if (hits.length > 0) {
        const hit = hits[0]
        px = hit.point.x
        pz = hit.point.z
        // 옆면(수직면)을 맞혔다면 그 면을 소유한 **높은 쪽** 칸을 고르도록 살짝 파고듭니다.
        const n = hit.face?.normal
        if (n && Math.abs(n.y) < 0.5) {
          px -= n.x * 0.08
          pz -= n.z * 0.08
        }
        found = true
      }
    }
    if (!found) {
      // 지형이 없는 허공 — 바닥 평면으로 대신 잡아 새 지형을 만들 수 있게 합니다.
      if (!this.cam.screenToPlane(this.ndc.x, this.ndc.y, 0, this.tmpPoint)) {
        this.hovered = null
        this.highlight.visible = false
        return
      }
      px = this.tmpPoint.x
      pz = this.tmpPoint.z
    }

    const { cx, cz } = worldToCell(px, pz, this.level.w, this.level.h)
    if (cx < 0 || cz < 0 || cx >= this.level.w || cz >= this.level.h) {
      this.hovered = null
      this.highlight.visible = false
      return
    }
    this.hovered = { cx, cz }

    const h = this.heightAt(cx, cz)
    const world = cellToWorld(cx, cz, this.level.w, this.level.h)
    const span = (this.brushSize - 1) * 2 + 1
    this.highlight.visible = true
    this.highlight.scale.set(CELL_SIZE * span, 0.24, CELL_SIZE * span)
    this.highlight.position.set(world.x, (h === VOID ? 0 : h * HEIGHT_STEP) + 0.12, world.z)

    el('stCell').textContent = `${cx}, ${cz}`
    el('stHeight').textContent = h === VOID ? '없음(절벽)' : String(h)
  }

  private rebuild(): void {
    if (this.terrainDirty) {
      this.terrainDirty = false
      if (this.terrain) {
        this.scene.remove(this.terrain.group)
        this.terrain.dispose()
      }
      this.terrain = new Terrain(this.level)
      this.scene.add(this.terrain.group)
    }

    if (this.entitiesDirty) {
      this.entitiesDirty = false
      for (const child of [...this.entityGroup.children]) {
        this.entityGroup.remove(child)
        if (child instanceof THREE.Mesh) (child.material as THREE.Material).dispose()
      }
      let grunt = 0
      let treasure = 0
      let boss = 0
      for (const e of this.level.entities) {
        const mesh = new THREE.Mesh(
          this.markerGeos[e.kind],
          new THREE.MeshStandardMaterial({
            color: ENTITY_COLOR[e.kind],
            emissive: new THREE.Color(ENTITY_COLOR[e.kind]).multiplyScalar(0.25),
            roughness: 0.4,
          }),
        )
        const cell = worldToCell(e.x, e.z, this.level.w, this.level.h)
        const h = this.heightAt(cell.cx, cell.cz)
        const baseY = h === VOID ? 0 : h * HEIGHT_STEP
        mesh.position.set(e.x, baseY + 0.9, e.z)
        this.entityGroup.add(mesh)
        if (e.kind === 'grunt') grunt++
        else if (e.kind === 'treasure') treasure++
        else if (e.kind === 'boss') boss++
      }
      el('stGrunt').textContent = String(grunt)
      el('stTreasure').textContent = String(treasure)
      el('stBoss').textContent = String(boss)
    }
  }

  private toastTimer = 0
  private toast(message: string, isError = false): void {
    const node = el('toast')
    node.textContent = message
    node.classList.toggle('error', isError)
    node.classList.add('show')
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => node.classList.remove('show'), 2200)
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop)
    this.rebuild()
    el('stZoom').textContent = `확대 ${this.cam.zoomLevel.toFixed(0)} · 방위 ${this.cam.yaw.toFixed(0)}°`
    this.renderer.render(this.scene, this.cam.camera)
  }

  /** 자동 검증용 훅 */
  debugState() {
    let floor = 0
    let maxH = 0
    for (const v of this.level.heights) {
      if (v !== VOID) {
        floor++
        if (v > maxH) maxH = v
      }
    }
    return {
      name: this.level.name,
      w: this.level.w,
      h: this.level.h,
      floorCells: floor,
      maxHeight: maxH,
      entities: this.level.entities.length,
      byKind: this.level.entities.reduce<Record<string, number>>((acc, e) => {
        acc[e.kind] = (acc[e.kind] ?? 0) + 1
        return acc
      }, {}),
      tool: this.tool,
      brushSize: this.brushSize,
      undoDepth: this.undoStack.length,
      hovered: this.hovered,
    }
  }

  debugSetTool(tool: Tool): void {
    this.setTool(tool)
  }

  debugSetBrush(size: number): void {
    this.setBrush(size)
  }

  /** 격자 좌표에 직접 도구를 적용합니다 (마우스 없이 검증하기 위한 통로). */
  debugApplyAt(cx: number, cz: number): void {
    const h = this.heightAt(cx, cz)
    this.strokeReferenceHeight = h === VOID ? 0 : h
    this.pushUndo()
    this.applyToolAt(cx, cz, true)
  }

  debugUndo(): void {
    this.undo()
  }

  debugSave(): void {
    this.level.name = el<HTMLInputElement>('levelName').value || '이름 없는 레벨'
    saveLevelToStorage(this.level)
  }
}

const editor = new Editor(document.getElementById('view') as HTMLCanvasElement)

declare global {
  interface Window {
    __editor: {
      ready: boolean
      state: () => ReturnType<Editor['debugState']>
      setTool: (t: Tool) => void
      setBrush: (n: number) => void
      applyAt: (cx: number, cz: number) => void
      undo: () => void
      save: () => void
    }
  }
}
window.__editor = {
  ready: true,
  state: () => editor.debugState(),
  setTool: (t) => editor.debugSetTool(t),
  setBrush: (n) => editor.debugSetBrush(n),
  applyAt: (cx, cz) => editor.debugApplyAt(cx, cz),
  undo: () => editor.debugUndo(),
  save: () => editor.debugSave(),
}
