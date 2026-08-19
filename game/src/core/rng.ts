/**
 * 시드 기반 난수 생성기 (mulberry32).
 *
 * 설계 근거: Math.random()을 쓰면 절대 안 되는 이유가 두 가지 있습니다.
 *  1) 절차적 던전 생성 — 같은 시드로 항상 같은 맵이 나와야 "시드 공유"가 가능합니다.
 *  2) 버그 재현 — 랜덤 아이템/랜덤 스폰에서 버그가 나면 시드 없이는 재현이 불가능합니다.
 *
 * 용도별로 RNG 인스턴스를 분리하는 것도 중요합니다. 맵 생성 RNG와 전투 RNG가
 * 같은 스트림을 공유하면, 전투 중 주사위를 한 번 더 굴린 것만으로 맵이 바뀌어 버립니다.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    // 0 시드는 mulberry32에서 품질이 나빠서 항상 홀수 오프셋을 더합니다.
    this.state = (seed | 0) + 0x6d2b79f5
  }

  /** 0 이상 1 미만 */
  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** min 이상 max 미만 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** min 이상 max 이하 (정수) */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  /** 확률 p(0~1)로 true */
  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }

  /** 가중치 기반 선택 — 루트 테이블(아이템 등급 추첨)의 기본 연산입니다. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0
    for (const it of items) total += weightOf(it)
    let roll = this.next() * total
    for (const it of items) {
      roll -= weightOf(it)
      if (roll <= 0) return it
    }
    return items[items.length - 1]
  }
}

/** 전역 스트림 — 나중에 던전/전투/루트로 분리합니다. */
export const combatRng = new Rng(1337)

/**
 * ── 🎨 **연출 전용 스트림** — 불꽃 흩뿌림 · 숫자 흔들림 ─────────────
 *
 * ── 왜 장식에도 씨앗이 필요한가 ────────────────────────────────────
 * 위 두 가지 근거(맵 시드 공유 · 버그 재현)는 **판정**의 이야기라, 이
 * 저장소는 오랫동안 연출은 예외로 두고 `Math.random()` 을 그대로 썼습니다.
 * 그런데 이 저장소에는 세 번째 이유가 생겼습니다:
 *
 *   **3) 스크린샷 비교** — 이 저장소의 검사 상당수가 *"같은 시각이면
 *      같은 그림"* 위에 서 있습니다(`npm run depth` · `gear` 의 등급
 *      불티 · `verify` 의 사진들). 타격 한 번에 불꽃이 무작위로 흩어지면
 *      전투 장면은 **원리적으로 비교할 수 없습니다.**
 *
 * 실제로 이번 라운드에 등급 불티를 만들 때 *"무작위 방출기를 쓰지 않는다"*
 * 를 설계 원칙으로 적어야 했고(`render/gearAura.ts`), 깊이 검사에서는
 * 픽셀 비교를 세우느라 네 번을 되돌렸습니다. 연출이 재현되지 않으면
 * **계측기를 만들 수 없습니다.**
 *
 * ⚠️ **전투 스트림과 분리합니다.** 같이 쓰면 *"불꽃이 한 번 더 튀었다"*
 *    는 이유만으로 적의 주사위가 달라집니다 — 위 파일 머리말이 경고하는
 *    바로 그것입니다.
 */
export const vfxRng = new Rng(0x5eed)

/**
 * 🔊 **소리 전용 스트림** — 마디 강세 · 노이즈 재생 시작점.
 *
 * 같은 이유로 나눕니다: 북을 한 번 더 치는 것이 전투 주사위를 밀면 안
 * 됩니다. `npm run audio` 도 *"같은 입력이면 같은 소리"* 를 재는 쪽이
 * 훨씬 쉬워집니다.
 */
export const audioRng = new Rng(0xa0d10)
