/**
 * 시간 관리 + 히트스톱(hit stop).
 *
 * 설계 근거 — 액션 게임 "손맛" 연구의 핵심 결론:
 *   타격이 꽂히는 순간 **게임플레이 시뮬레이션만** 아주 짧게 멈추고(0.05~0.12초),
 *   카메라 흔들림·파티클·이펙트는 **정상 속도로 계속** 돌려야 합니다.
 *   전부 멈추면 "렉 걸린 느낌"이 나고, 아무것도 안 멈추면 "물풍선 때리는 느낌"이 납니다.
 *
 * 그래서 시간을 두 종류로 나눕니다:
 *   time.dt     - 시뮬레이션용 (히트스톱 중 0). 이동/AI/쿨다운이 사용.
 *   time.realDt - 실제 시간. 카메라 흔들림/VFX/UI가 사용.
 */

export const time = {
  /** 시뮬레이션 델타(초). 히트스톱 중에는 0. */
  dt: 0,
  /** 실제 델타(초). 절대 멈추지 않음. */
  realDt: 0,
  /** 시작 후 실제 경과 시간(초). */
  elapsed: 0,
  /** 남은 히트스톱 시간(초). */
  hitstop: 0,
  /** 슬로우모션 등 전역 배속 (1 = 정상). */
  scale: 1,
  /** 누적 프레임 수. */
  frame: 0,
}

const MAX_FRAME_DT = 1 / 20 // 탭 전환 후 복귀 시 물리가 터지지 않도록 상한

/**
 * 히트스톱 요청. 여러 타격이 겹치면 가장 긴 값이 이깁니다(더하면 끊겨 보임).
 * @param seconds 0.04(약공격) ~ 0.14(강공격/처치) 권장
 */
export function requestHitstop(seconds: number): void {
  if (seconds > time.hitstop) time.hitstop = seconds
}

export function tick(rawDeltaSeconds: number): void {
  const realDt = Math.min(rawDeltaSeconds, MAX_FRAME_DT)
  time.realDt = realDt
  time.elapsed += realDt
  time.frame++

  if (time.hitstop > 0) {
    time.hitstop = Math.max(0, time.hitstop - realDt)
    time.dt = 0
  } else {
    time.dt = realDt * time.scale
  }
}

export function resetTime(): void {
  time.dt = 0
  time.realDt = 0
  time.elapsed = 0
  time.hitstop = 0
  time.scale = 1
  time.frame = 0
}
