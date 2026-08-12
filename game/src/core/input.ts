/**
 * 입력 처리 — 키보드/마우스.
 *
 * "이번 프레임에 막 눌렸는가(justPressed)"를 따로 관리합니다.
 * 회피 구르기나 공격처럼 **누르고 있는 동안 반복되면 안 되는** 입력에 필수입니다.
 * (그냥 down 으로 처리하면 스페이스를 꾹 누를 때 구르기가 무한 발동합니다.)
 *
 * 마우스 좌표는 NDC(-1~1)로 저장합니다. Three.js Raycaster가 이 형식을 받습니다.
 */

const down = new Set<string>()
const pressedThisFrame = new Set<string>()

export const mouse = {
  /** 정규화 장치 좌표 (-1 ~ 1) */
  ndcX: 0,
  ndcY: 0,
  /** 월드 지면(y=0)상의 커서 위치 — pointer 시스템이 매 프레임 채웁니다. */
  worldX: 0,
  worldZ: 0,
}

/** 마우스 버튼도 키와 같은 테이블에 넣습니다: 'Mouse0'(좌), 'Mouse2'(우) */
function mouseKey(button: number): string {
  return `Mouse${button}`
}

export function isDown(code: string): boolean {
  return down.has(code)
}

export function wasPressed(code: string): boolean {
  return pressedThisFrame.has(code)
}

/** 입력을 소비합니다 — 같은 프레임에 두 시스템이 중복 반응하지 않도록. */
export function consumePress(code: string): boolean {
  if (!pressedThisFrame.has(code)) return false
  pressedThisFrame.delete(code)
  return true
}

/** 매 프레임 끝에서 호출. justPressed 상태를 비웁니다. */
export function endFrame(): void {
  pressedThisFrame.clear()
}

export function initInput(canvas: HTMLElement): void {
  const press = (code: string) => {
    if (!down.has(code)) pressedThisFrame.add(code)
    down.add(code)
  }
  const release = (code: string) => {
    down.delete(code)
  }

  window.addEventListener('keydown', (e) => {
    // 브라우저 기본 동작(스페이스 스크롤 등) 차단
    // Tab(포커스 이동)·Space(스크롤)·방향키(스크롤)는 게임 조작으로 씁니다.
    // F1 은 브라우저 도움말을 엽니다 — 게임이 쓰는 키는 브라우저에서 뺏어옵니다.
    if (e.code === 'Space' || e.code === 'Tab' || e.code === 'F1' || e.code.startsWith('Arrow'))
      e.preventDefault()
    if (e.repeat) return
    press(e.code)
  })
  window.addEventListener('keyup', (e) => release(e.code))
  // 탭을 벗어나면 키가 눌린 채로 남는 문제 방지
  window.addEventListener('blur', () => {
    down.clear()
    pressedThisFrame.clear()
  })

  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('pointerdown', (e) => press(mouseKey(e.button)))
  window.addEventListener('pointerup', (e) => release(mouseKey(e.button)))
  window.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect()
    mouse.ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    mouse.ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1
  })
}

/**
 * 헤드리스 테스트/자동 검증용 — 실제 이벤트 없이 입력을 주입합니다.
 * verify 스크립트가 이 함수로 플레이어를 조작해 스크린샷을 찍습니다.
 */
export const debugInput = {
  press(code: string) {
    if (!down.has(code)) pressedThisFrame.add(code)
    down.add(code)
  },
  release(code: string) {
    down.delete(code)
  },
  setMouseNdc(x: number, y: number) {
    mouse.ndcX = x
    mouse.ndcY = y
  },
}
