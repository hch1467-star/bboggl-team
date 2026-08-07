/**
 * 절차적 사운드 — 파일 없이 코드로 소리를 만듭니다.
 *
 * ── 왜 지금 소리인가 ────────────────────────────────────────────────
 * 액션 게임의 손맛은 **눈 · 귀 · 손** 세 채널이 동시에 도착할 때 완성됩니다.
 * 지금까지 이 프로토타입은
 *   · 눈  = 이펙트 · 피격 플래시 · 화면 흔들림   ✅
 *   · 손  = 히트스톱 · 넉백                      ✅
 *   · 귀  = 없음                                 ❌
 * 였습니다. 세 채널 중 하나가 통째로 0이면 나머지를 아무리 다듬어도
 * "뭔가 밋밋하다"가 사라지지 않습니다. 그래서 여기를 먼저 채웁니다.
 *
 * ── 왜 오디오 파일이 아니라 합성인가 ────────────────────────────────
 *   1. 에셋이 0개입니다. 라이선스·용량·로딩 실패가 전부 사라집니다.
 *   2. **매개변수화**됩니다. 무기 무게로 음높이를, 거리로 음량을,
 *      예고 색으로 음색을 바꿀 수 있습니다. 샘플이면 그만큼 파일을
 *      따로 만들어야 합니다.
 *   3. 프로토타입 단계에서 필요한 건 "진짜 같은 소리"가 아니라
 *      **구분되는 소리**입니다. 합성이 이 목적에 더 정확합니다.
 * (Unity 이식 노트: 이 파일은 그대로 옮기지 않습니다. Unity에서는
 *  FMOD/Wwise 또는 AudioClip 으로 바꾸되, 아래 `cue` 목록과 매개변수
 *  이름을 그대로 이벤트 이름으로 쓰면 코드 호출부는 손대지 않아도 됩니다.)
 *
 * ── 절대 게임을 죽이지 않습니다 ─────────────────────────────────────
 * 헤드리스 검증 환경에는 오디오 장치가 없고, 브라우저는 사용자 조작 전에는
 * 소리를 막습니다. 그래서 이 모듈의 모든 함수는 **실패해도 조용히 무시**
 * 합니다. 소리가 안 나는 것과 게임이 멈추는 것은 전혀 다른 문제입니다.
 */

/** 예고 색(AttackIntent)과 1:1로 맞춘 소리 종류 */
export const enum SfxIntent {
  Strike = 0,
  Sweep = 1,
  Snare = 2,
  Pull = 3,
}

/**
 * 동시에 울릴 수 있는 소리 개수.
 *
 * 적이 6마리 몰리면 예고음도 6개가 겹칩니다. 상한이 없으면 소리가
 * 뭉개져서 **정보가 아니라 소음**이 됩니다. 상한을 두면 오래된 소리가
 * 자연히 밀려나고 새 정보가 항상 들립니다.
 */
const MAX_VOICES = 20

/** 소리가 들리는 최대 거리(m). 화면 밖 적의 예고까지는 들려야 합니다. */
const MAX_AUDIBLE = 26

/** 같은 종류의 소리가 이 간격 안에 다시 오면 무시합니다(초) — 다단히트 방어 */
const RETRIGGER_GUARD: Record<string, number> = {
  impact: 0.035,
  swing: 0.05,
  hurt: 0.12,
  telegraph: 0.06,
}

interface Listener {
  x: number
  z: number
  rightX: number
  rightZ: number
}

const STORAGE_KEY = 'qv.audio.muted'

class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  /**
   * 검증용 계측기.
   *
   * 헤드리스 환경에서는 소리를 **들을 수 없습니다.** 그래서 "코드가 예외 없이
   * 돌았다"까지만 확인하면 무음 버그(게인 0, 노드 미연결, 봉투 오류)를 전부
   * 놓칩니다. 마스터 뒤에 분석기를 달아 실제 파형의 진폭을 재면
   * **"소리가 났다"를 숫자로 증명**할 수 있습니다.
   */
  private analyser: AnalyserNode | null = null
  private meterBuf: Float32Array<ArrayBuffer> | null = null
  private voices = 0
  private muted = false
  private failed = false
  private readonly listener: Listener = { x: 0, z: 0, rightX: 1, rightZ: 0 }
  private readonly lastAt = new Map<string, number>()

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      /* 저장소가 막힌 환경 — 기본값(소리 켜짐)으로 갑니다 */
    }
  }

  /**
   * 브라우저 자동재생 정책 때문에 **사용자 조작 한 번**이 있어야 소리가 납니다.
   * main.ts 가 첫 키 입력/클릭에서 이걸 부릅니다. 여러 번 불러도 안전합니다.
   */
  unlock(): void {
    if (this.failed) return
    if (!this.ctx) {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) {
        this.failed = true
        return
      }
      try {
        this.ctx = new Ctor()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : 0.5
        this.analyser = this.ctx.createAnalyser()
        this.analyser.fftSize = 2048
        this.meterBuf = new Float32Array(this.analyser.fftSize)
        this.master.connect(this.analyser)
        this.analyser.connect(this.ctx.destination)
        this.noise = this.makeNoise(this.ctx)
      } catch {
        this.failed = true
        return
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
  }

  /**
   * 지금 이 순간 마스터에 흐르는 신호의 진폭(0~1)을 돌려줍니다.
   * 자동 검증 전용 — 게임 로직은 절대 이 값을 읽지 않습니다.
   */
  debugLevel(): number {
    if (!this.analyser || !this.meterBuf) return 0
    this.analyser.getFloatTimeDomainData(this.meterBuf)
    let peak = 0
    for (let i = 0; i < this.meterBuf.length; i++) {
      const v = Math.abs(this.meterBuf[i])
      if (v > peak) peak = v
    }
    return peak
  }

  /** 자동 검증 전용 — 지금 소리의 기준점(플레이어 위치). */
  debugListener(): { x: number; z: number } {
    return { x: this.listener.x, z: this.listener.z }
  }

  /** 자동 검증 전용 — 오디오가 실제로 열렸는지 상태를 봅니다. */
  debugState(): { ready: boolean; state: string; voices: number; muted: boolean } {
    return {
      ready: this.ctx !== null && !this.failed,
      state: this.ctx?.state ?? 'none',
      voices: this.voices,
      muted: this.muted,
    }
  }

  /** 화면 기준 좌우 패닝을 계산하려면 플레이어 위치와 카메라 우측 벡터가 필요합니다. */
  setListener(x: number, z: number, rightX: number, rightZ: number): void {
    this.listener.x = x
    this.listener.z = z
    this.listener.rightX = rightX
    this.listener.rightZ = rightZ
  }

  get isMuted(): boolean {
    return this.muted
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02)
    }
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0')
    } catch {
      /* 저장 실패는 무시 — 이번 세션에만 적용됩니다 */
    }
    return this.muted
  }

  // ────────────────────────────────────────────────────────────────
  // 큐(cue) — 게임 코드가 부르는 건 아래뿐입니다
  // ────────────────────────────────────────────────────────────────

  /**
   * 휘두르는 바람소리.
   * @param weight 0(가벼움)~1(무거움). 무기 무게가 그대로 음높이가 됩니다 —
   *        대검은 낮게 "부웅", 단검은 높게 "쉭". 무기 차이가 귀로도 구분됩니다.
   */
  swing(weight: number, x?: number, z?: number): void {
    if (!this.gate('swing')) return
    const w = clamp01(weight)
    // 필터를 쓸어내리는 화이트노이즈 = 공기를 가르는 소리의 최소 재료입니다.
    this.noiseVoice({
      duration: 0.16 + w * 0.12,
      startHz: 2600 - w * 1500,
      endHz: 420 - w * 220,
      q: 1.1,
      gain: 0.16 + w * 0.1,
      x,
      z,
    })
  }

  /**
   * 타격.
   * @param heavy 강공격/마무리 — 저음을 더 깊게
   * @param crit  치명타·백어택 — 위에 밝은 금속음을 한 겹 얹습니다.
   *              데미지 숫자를 못 봐도 "잘 맞았다"가 귀로 먼저 옵니다.
   */
  impact(heavy: boolean, crit: boolean, x?: number, z?: number): void {
    if (!this.gate('impact')) return
    // 1) 몸통 — 빠르게 떨어지는 저음 사인. "쿵"의 무게를 담당합니다.
    this.toneVoice({
      type: 'sine',
      duration: heavy ? 0.2 : 0.13,
      startHz: heavy ? 150 : 210,
      endHz: heavy ? 44 : 70,
      gain: heavy ? 0.5 : 0.34,
      x,
      z,
    })
    // 2) 알갱이 — 짧은 노이즈. 저음만 있으면 "퍽"이 아니라 "웅"이 됩니다.
    this.noiseVoice({
      duration: 0.06,
      startHz: 3400,
      endHz: 900,
      q: 0.8,
      gain: heavy ? 0.2 : 0.14,
      x,
      z,
    })
    // 3) 치명타 층 — 있을 때만. 항상 울리면 특별함이 사라집니다.
    if (crit) {
      this.toneVoice({
        type: 'triangle',
        duration: 0.26,
        startHz: 1180,
        endHz: 1760,
        gain: 0.16,
        delay: 0.02,
        x,
        z,
      })
    }
  }

  /**
   * 적 공격 예고 — **4색이 곧 4개의 음**입니다.
   *
   * 이게 이번 작업의 핵심입니다. 로스트아크류 보스전이 무너지는 대표적인
   * 이유가 "예고 표시가 안 보인다"인데, 쿼터뷰에서는 적이 겹치거나
   * 이펙트가 서로를 덮으면 실제로 안 보입니다. 소리는 **겹쳐도 안 가려집니다.**
   *
   * 음의 **방향**이 곧 대응법이 되도록 설계했습니다:
   *   🔴 Strike — 짧고 위로 튀는 음  → "지금 짧게 굴러"
   *   🟡 Sweep  — 낮게 부풀어오르는 음 → "크게 물러나"
   *   🔵 Snare  — 금속성 링           → "옆으로 비켜"
   *   🟣 Pull   — 아래로 미끄러지는 음 → "끌려온다, 파고들어"
   * 올라가는 음 = 즉발, 내려가는 음 = 끌림. 배우지 않아도 방향이 읽힙니다.
   */
  telegraph(intent: SfxIntent, x: number, z: number): void {
    if (!this.gate('telegraph')) return
    switch (intent) {
      case SfxIntent.Strike:
        this.toneVoice({ type: 'square', duration: 0.1, startHz: 520, endHz: 880, gain: 0.1, x, z })
        break
      case SfxIntent.Sweep:
        /**
         * 유일하게 길게 부풀어 오릅니다 — 준비 시간이 긴 패턴이라는 정보 그 자체입니다.
         *
         * **네 예고음 중 일부러 가장 크게 잡았습니다.** 노랑은 구르기로 못 피하는
         * (거리 4.6m > 구르기 4.2m) 유일한 패턴이라, 넷 중 반응 실패의 대가가
         * 가장 큽니다. 가장 위험한 신호가 가장 잘 들려야 합니다.
         *
         * **중음(300~430Hz) 층이 따로 있는 이유**는 등청감곡선입니다.
         * 100Hz 대는 같은 진폭이라도 사람 귀에 훨씬 작게 들리고, 노트북
         * 스피커는 그 대역을 아예 재생하지 못합니다. 저음만 두면 "측정상으로는
         * 크지만 실제로는 안 들리는" 소리가 됩니다. 저음은 무게를 담당하고,
         * **들리는 일은 중음이 합니다.**
         */
        this.toneVoice({ type: 'sawtooth', duration: 0.55, startHz: 90, endHz: 165, gain: 0.26, swell: true, x, z })
        this.toneVoice({ type: 'square', duration: 0.5, startHz: 300, endHz: 430, gain: 0.09, swell: true, delay: 0.04, x, z })
        break
      case SfxIntent.Snare:
        this.toneVoice({ type: 'triangle', duration: 0.34, startHz: 1320, endHz: 1250, gain: 0.11, x, z })
        this.toneVoice({ type: 'triangle', duration: 0.3, startHz: 1980, endHz: 1900, gain: 0.05, delay: 0.01, x, z })
        break
      case SfxIntent.Pull:
        this.toneVoice({ type: 'sawtooth', duration: 0.42, startHz: 700, endHz: 190, gain: 0.11, x, z })
        break
    }
  }

  /** 회피 — 짧고 바람 빠지는 소리. 무적 프레임이 "발동됐다"는 확인입니다. */
  dodge(): void {
    this.noiseVoice({ duration: 0.22, startHz: 1500, endHz: 3200, q: 2.2, gain: 0.11 })
  }

  /** 플레이어 피격 — 저음 + 둔탁한 노이즈. 화면 밖에서 맞아도 즉시 압니다. */
  hurt(): void {
    if (!this.gate('hurt')) return
    this.toneVoice({ type: 'sine', duration: 0.34, startHz: 260, endHz: 62, gain: 0.5 })
    this.noiseVoice({ duration: 0.2, startHz: 700, endHz: 180, q: 0.7, gain: 0.24 })
  }

  /**
   * 보스 페이즈 전환 — 게임에서 가장 크고 가장 긴 소리입니다.
   *
   * 일부러 다른 어떤 큐와도 안 닮게 만들었습니다. 전환은 **놓치면 안 되는
   * 단 한 순간**이라, "무슨 소리였지?"가 생기면 안 됩니다.
   * 낮게 깔리는 포효 + 위로 솟는 층을 겹쳐서, 다른 소리들 위로 뚫고 나옵니다.
   */
  bossPhase(): void {
    this.toneVoice({ type: 'sawtooth', duration: 1.5, startHz: 150, endHz: 46, gain: 0.55 })
    this.toneVoice({ type: 'square', duration: 1.2, startHz: 220, endHz: 330, gain: 0.16, swell: true })
    this.toneVoice({ type: 'triangle', duration: 0.9, startHz: 440, endHz: 1320, gain: 0.14, delay: 0.1 })
    this.noiseVoice({ duration: 1.0, startHz: 260, endHz: 2600, q: 0.7, gain: 0.24 })
  }

  /** 적 처치 — 아래로 꺼지는 소리. 보스는 더 낮고 길게. */
  death(boss: boolean, x?: number, z?: number): void {
    this.toneVoice({
      type: 'sawtooth',
      duration: boss ? 1.1 : 0.34,
      startHz: boss ? 300 : 420,
      endHz: boss ? 40 : 90,
      gain: boss ? 0.4 : 0.2,
      x,
      z,
    })
    this.noiseVoice({ duration: boss ? 0.7 : 0.24, startHz: 1800, endHz: 240, q: 0.6, gain: 0.16, x, z })
  }

  /** 스킬 시전 — 무기마다 다른 음정. 어떤 무기로 쐈는지 귀로 구분됩니다. */
  cast(weaponIndex: number): void {
    const base = [330, 262, 392][weaponIndex % 3]
    this.toneVoice({ type: 'triangle', duration: 0.3, startHz: base, endHz: base * 2, gain: 0.15 })
    this.toneVoice({ type: 'sine', duration: 0.36, startHz: base * 1.5, endHz: base * 3, gain: 0.07, delay: 0.04 })
  }

  /** 보물/룬 획득 — 위로 올라가는 2음. 게임에서 유일하게 밝은 소리입니다. */
  pickup(): void {
    this.toneVoice({ type: 'triangle', duration: 0.14, startHz: 660, endHz: 660, gain: 0.16 })
    this.toneVoice({ type: 'triangle', duration: 0.3, startHz: 990, endHz: 990, gain: 0.14, delay: 0.09 })
  }

  /**
   * 실패 — 스태미나 부족 / 쿨다운.
   *
   * 지금까지 이 경우는 **아무 일도 안 일어났습니다.** 초보자 입장에서는
   * "키가 안 먹었나?"와 구분이 안 됩니다. 짧은 저음 하나면
   * "눌린 건 맞는데 지금은 안 된다"로 바뀝니다.
   */
  deny(): void {
    if (!this.gate('deny', 0.18)) return
    this.toneVoice({ type: 'square', duration: 0.09, startHz: 170, endHz: 120, gain: 0.09 })
  }

  // ────────────────────────────────────────────────────────────────
  // 내부
  // ────────────────────────────────────────────────────────────────

  /** 같은 소리가 너무 촘촘히 겹치는 걸 막습니다(다단히트, 적 무리). */
  private gate(key: string, override?: number): boolean {
    if (!this.ctx) return true // 아직 unlock 전 — 뒤에서 어차피 무시됩니다
    const gap = override ?? RETRIGGER_GUARD[key] ?? 0
    if (gap <= 0) return true
    const now = this.ctx.currentTime
    const last = this.lastAt.get(key) ?? -1
    if (now - last < gap) return false
    this.lastAt.set(key, now)
    return true
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.5)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return buf
  }

  /**
   * 거리 감쇠 + 좌우 패닝을 계산합니다.
   * @returns null 이면 너무 멀어서 소리를 만들지 않습니다(보이스 절약).
   */
  private spatial(x?: number, z?: number): { volume: number; pan: number } | null {
    if (x === undefined || z === undefined) return { volume: 1, pan: 0 }
    const dx = x - this.listener.x
    const dz = z - this.listener.z
    const dist = Math.hypot(dx, dz)
    /**
     * **NaN 방어.** WebAudio 의 AudioParam 은 유한하지 않은 값을 넣으면
     * 예외를 던집니다. 그 예외는 sfx 를 부른 시스템(적 AI 등)까지 거슬러
     * 올라가서 **그 프레임의 시스템을 통째로 중단시킵니다.**
     * 자동 검증에서 실제로 잡았습니다 — 좌표가 NaN인 적 하나 때문에
     * 적 AI가 멈추고 예고가 전혀 뜨지 않았습니다.
     * 소리가 안 나는 것은 사소한 문제지만, 소리 때문에 게임이 멈추는 것은
     * 심각한 문제입니다. 여기서 끊습니다.
     */
    if (!Number.isFinite(dist) || dist > MAX_AUDIBLE) return null
    // 선형이 아니라 제곱으로 줄입니다 — 가까운 소리가 확실히 앞에 서야
    // "내가 맞는 것"과 "저 멀리서 누가 맞는 것"이 구분됩니다.
    const t = 1 - dist / MAX_AUDIBLE
    const volume = t * t
    // 월드 방향을 화면 가로축에 투영 = 카메라 우측 벡터와의 내적.
    // (카메라와 같은 계산을 써야 보이는 위치와 들리는 위치가 어긋나지 않습니다)
    const screenX = dx * this.listener.rightX + dz * this.listener.rightZ
    const pan = Math.max(-1, Math.min(1, screenX / 12)) * 0.8
    return { volume, pan }
  }

  /** 보이스 하나를 열고, 끝나면 자동으로 반납합니다. */
  private open(): { ctx: AudioContext; out: AudioNode } | null {
    if (!this.ctx || !this.master || this.muted || this.failed) return null
    if (this.ctx.state !== 'running') return null
    if (this.voices >= MAX_VOICES) return null
    this.voices++
    return { ctx: this.ctx, out: this.master }
  }

  /**
   * 보이스 반납. **정확히 한 번만** 줄어들도록 플래그로 잠급니다.
   *
   * 두 경로에서 반납됩니다: 정상 종료(onended)와 예외(catch).
   * 잠그지 않으면 예외가 난 소리가 두 번 반납돼서 카운터가 실제보다 작아지고,
   * 상한(20)이 무력화됩니다 — 적이 몰릴 때 소리가 뭉개지는 원인이 됩니다.
   */
  private releaser(): () => void {
    let done = false
    return () => {
      if (done) return
      done = true
      this.voices = Math.max(0, this.voices - 1)
    }
  }

  private chain(ctx: AudioContext, out: AudioNode, panRaw: number): GainNode {
    const pan = Number.isFinite(panRaw) ? panRaw : 0
    const gain = ctx.createGain()
    if (typeof ctx.createStereoPanner === 'function' && pan !== 0) {
      const panner = ctx.createStereoPanner()
      panner.pan.value = pan
      gain.connect(panner)
      panner.connect(out)
    } else {
      gain.connect(out)
    }
    return gain
  }

  private toneVoice(o: {
    type: OscillatorType
    duration: number
    startHz: number
    endHz: number
    gain: number
    delay?: number
    /** true면 서서히 커졌다가 꺼집니다(예고음처럼 "다가온다"는 느낌) */
    swell?: boolean
    x?: number
    z?: number
  }): void {
    const sp = this.spatial(o.x, o.z)
    if (!sp) return
    const v = this.open()
    if (!v) return
    const { ctx, out } = v
    const release = this.releaser()
    try {
      const t0 = ctx.currentTime + (o.delay ?? 0)
      const t1 = t0 + o.duration
      const peak = Math.max(0.0001, o.gain * sp.volume)

      const osc = ctx.createOscillator()
      osc.type = o.type
      osc.frequency.setValueAtTime(o.startHz, t0)
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.endHz), t1)

      const gain = this.chain(ctx, out, sp.pan)
      gain.gain.setValueAtTime(0.0001, t0)
      if (o.swell) {
        gain.gain.exponentialRampToValueAtTime(peak, t0 + o.duration * 0.75)
      } else {
        // 2ms 어택. 0으로 두면 "딱" 하는 클릭 노이즈가 섞입니다.
        gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.002)
      }
      gain.gain.exponentialRampToValueAtTime(0.0001, t1)

      osc.connect(gain)
      osc.onended = release
      osc.start(t0)
      osc.stop(t1 + 0.01)
    } catch {
      // 소리 하나가 실패해도 게임은 계속됩니다. 호출한 시스템까지
      // 예외가 올라가면 그 프레임의 로직이 통째로 중단됩니다.
      release()
    }
  }

  private noiseVoice(o: {
    duration: number
    startHz: number
    endHz: number
    q: number
    gain: number
    delay?: number
    x?: number
    z?: number
  }): void {
    if (!this.noise) return
    const sp = this.spatial(o.x, o.z)
    if (!sp) return
    const v = this.open()
    if (!v) return
    const { ctx, out } = v
    const release = this.releaser()
    try {
      const t0 = ctx.currentTime + (o.delay ?? 0)
      const t1 = t0 + o.duration
      const peak = Math.max(0.0001, o.gain * sp.volume)

      const src = ctx.createBufferSource()
      src.buffer = this.noise
      // 같은 버퍼를 매번 같은 지점부터 읽으면 반복이 귀에 걸립니다.
      const offset = Math.random() * 0.3

      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.Q.value = o.q
      filter.frequency.setValueAtTime(o.startHz, t0)
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.endHz), t1)

      const gain = this.chain(ctx, out, sp.pan)
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, t1)

      src.connect(filter)
      filter.connect(gain)
      src.onended = release
      src.start(t0, offset, o.duration + 0.02)
      src.stop(t1 + 0.01)
    } catch {
      release()
    }
  }
}

export const sfx = new Sfx()

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
