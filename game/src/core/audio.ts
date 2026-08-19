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

import { audioRng } from './rng'

/** 예고 색(AttackIntent)과 1:1로 맞춘 소리 종류 */
export const enum SfxIntent {
  Strike = 0,
  Sweep = 1,
  Snare = 2,
  Pull = 3,
  /**
   * 🟢 반격.
   *
   * ⚠️ **빠져 있었습니다.** AttackIntent 에 Counter(4) 를 추가하면서 여기는
   * 안 늘렸고, 호출부가 `as unknown as SfxIntent` 로 캐스팅하고 있어서
   * 타입 검사가 아무 말도 못 했습니다. 결과적으로 **네 색은 소리가 나고
   * 초록만 조용했습니다.**
   *
   * 하필 초록입니다. 다른 넷은 "피하라"라서 못 들어도 반사로 구르면 되지만,
   * 초록은 **정반대**(앞으로 나가 스킬)를 요구합니다 — 반사로는 절대 안
   * 나오는 동작이라 신호가 가장 필요한 색인데 그 색만 신호가 없었습니다.
   */
  Counter = 4,
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
  /**
   * 「지금」 박자는 예고음보다 **짧게** 막습니다. 여러 적이 거의 동시에
   * 답을 요구하는 순간은 실제로 일어나고, 그때 하나만 들리면 나머지는
   * **없는 것과 같습니다.** 다만 완전히 열어 두면 다단히트처럼 뭉갭니다.
   */
  nowBeat: 0.04,
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

  // ────────────────────────────────────────────────────────────────
  // 보스 음악
  // ────────────────────────────────────────────────────────────────
  //
  // ── 왜 보스전에만 음악이 있는가 ─────────────────────────────────
  // 처음엔 탐험용 앰비언스도 넣으려 했는데, 참고 자료가 반대를 가리켰습니다.
  // 소울라이크에서 탐험 구간의 **침묵은 빈틈이 아니라 설계**입니다:
  //   1. 조용해야 보스 음악이 **대비**로 살아납니다. 계속 깔려 있으면
  //      보스가 시작돼도 "음악이 바뀌었네" 정도가 됩니다.
  //   2. 탐험 중에는 소리가 **정보**입니다. 4색 예고음·발소리를 들어야 하는데
  //      그 위에 음악을 깔면 우리가 애써 만든 단서를 우리가 덮게 됩니다.
  //
  // 그래서 음악은 **보스 영역에 들어선 순간에만** 시작됩니다.
  // 조우 자체가 하나의 신호가 되는 셈입니다.
  //
  // ── 예고음을 가리지 않기 위한 규칙 ──────────────────────────────
  // 예고음은 90~1980Hz에 걸쳐 있고 **짧은 전이음**입니다. 음악을
  //   · 낮게(드론 55~165Hz) 깔고
  //   · 지속음 위주로 두고
  //   · 음량을 효과음보다 확실히 낮게
  // 잡으면, 짧고 날카로운 예고음이 그 위로 뚫고 나옵니다.
  // 선율을 넣지 않은 것도 같은 이유입니다 — 중음에서 예고음과 다툽니다.

  private musicGain: GainNode | null = null
  private musicVoices: { osc: OscillatorNode; gain: GainNode }[] = []
  /** 0 = 꺼짐, 1~3 = 페이즈. 페이즈가 오르면 음악도 거세집니다. */
  private musicLevel = 0
  /** 다음 박까지 남은 시간(초). 게임 루프가 realDt로 굴립니다. */
  private beatT = 0

  /**
   * 보스 음악을 켭니다. 이미 켜져 있으면 세기만 바꿉니다.
   * @param level 1~3 (보스 페이즈 + 1)
   */
  startMusic(level: number): void {
    const want = Math.max(1, Math.min(3, level))
    if (this.musicLevel === want) return
    if (!this.ctx || !this.master || this.failed) return
    if (this.ctx.state !== 'running') return

    if (this.musicLevel === 0) {
      try {
        this.musicGain = this.ctx.createGain()
        this.musicGain.gain.value = 0.0001
        this.musicGain.connect(this.master)
        // 2초에 걸쳐 서서히 올라옵니다 — 갑자기 튀어나오면 놀람이지 긴장이 아닙니다.
        this.musicGain.gain.exponentialRampToValueAtTime(0.34, this.ctx.currentTime + 2)
        this.beatT = 0
      } catch {
        return
      }
    }
    this.musicLevel = want
    this.rebuildDrone()
  }

  stopMusic(): void {
    if (this.musicLevel === 0) return
    this.musicLevel = 0
    const g = this.musicGain
    const ctx = this.ctx
    this.musicGain = null
    const voices = this.musicVoices
    this.musicVoices = []
    if (!g || !ctx) return
    try {
      // 1.2초에 걸쳐 사라집니다. 뚝 끊기면 "버그"로 들립니다.
      g.gain.cancelScheduledValues(ctx.currentTime)
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2)
      for (const v of voices) v.osc.stop(ctx.currentTime + 1.3)
    } catch {
      /* 이미 멈춘 노드 — 무시 */
    }
  }

  /**
   * 드론(지속 저음)을 페이즈에 맞춰 다시 쌓습니다.
   *
   * 1단계 근음만 → 2단계 5도 추가 → 3단계 **단2도** 추가.
   * 단2도는 서양 음악에서 가장 불안한 음정입니다. 3단계가
   * "이제 사냥당한다"는 구간이므로 화음 자체를 어긋나게 둡니다.
   */
  private rebuildDrone(): void {
    if (!this.ctx || !this.musicGain) return
    for (const v of this.musicVoices) {
      try {
        v.osc.stop(this.ctx.currentTime + 0.4)
      } catch {
        /* 무시 */
      }
    }
    this.musicVoices = []

    const root = 55 // A1 — 예고음의 가장 낮은 대역(90Hz)보다도 아래
    const notes: { hz: number; gain: number; type: OscillatorType }[] = [
      { hz: root, gain: 0.5, type: 'sawtooth' },
      { hz: root * 2, gain: 0.22, type: 'triangle' },
    ]
    if (this.musicLevel >= 2) notes.push({ hz: root * 3, gain: 0.16, type: 'triangle' })
    if (this.musicLevel >= 3) notes.push({ hz: root * 2 * 1.06, gain: 0.13, type: 'sawtooth' })

    for (const n of notes) {
      try {
        const osc = this.ctx.createOscillator()
        osc.type = n.type
        osc.frequency.value = n.hz
        const g = this.ctx.createGain()
        g.gain.value = 0.0001
        g.gain.exponentialRampToValueAtTime(n.gain, this.ctx.currentTime + 1.2)
        // 저역만 남깁니다 — 중음에 남아 있으면 예고음과 다툽니다.
        const lp = this.ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 340
        osc.connect(lp)
        lp.connect(g)
        g.connect(this.musicGain)
        osc.start()
        this.musicVoices.push({ osc, gain: g })
      } catch {
        /* 노드 하나 실패해도 나머지는 살립니다 */
      }
    }
  }

  /**
   * 박자를 굴립니다. 게임 루프가 **realDt**로 매 프레임 부릅니다.
   *
   * WebAudio 자체 스케줄러 대신 게임 루프를 쓰는 이유: 히트스톱으로 게임이
   * 멈춰도 음악은 계속 흘러야 하는데, realDt 축이 정확히 그 축입니다
   * (VFX·카메라와 같은 규칙 — core/time.ts 설계 노트).
   */
  tickMusic(realDt: number): void {
    if (this.musicLevel === 0 || !this.musicGain || !this.ctx) return
    // 페이즈가 오를수록 빨라집니다 — 숫자를 안 봐도 단계가 귀에 들립니다.
    const bpm = [0, 78, 92, 108][this.musicLevel]
    const beat = 60 / bpm
    this.beatT -= realDt
    if (this.beatT > 0) return
    this.beatT += beat

    // 박마다 낮은 북. 4박에 한 번은 조금 높게 — 마디가 잡힙니다.
    const accent = audioRng.next() < 0.25
    try {
      const t0 = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(accent ? 132 : 88, t0)
      osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.22)
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(accent ? 0.42 : 0.3, t0 + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26)
      osc.connect(g)
      g.connect(this.musicGain)
      osc.start(t0)
      osc.stop(t0 + 0.3)
    } catch {
      /* 무시 */
    }
  }

  /**
   * ── ❤️ **심장 박동 — 저체력 경고를 귀에도 냅니다** ──────────────────
   *
   * ── 왜 필요했는가 (벤치가 사인을 말해 주기 시작하고 나서) ────────────
   * 죽음의 사인을 장부에 남기게 하자 세 번 다 이렇게 나왔습니다:
   *
   *     🟡 광역에 쓰러졌다 — 예고 1.3초를 **다 봤는데** 답을 내지 않았다
   *     🟣 끌어당김에 쓰러졌다 — 예고 1.1초를 **다 봤는데** …
   *     🔴 직격에 쓰러졌다 — 예고 0.6초를 **다 봤는데** …
   *
   * 예고는 보였습니다. 그런데도 죽습니다. 저체력 경고는 있었지만
   * **화면 가장자리 비네트 하나뿐**이었습니다 — 그리고 그 순간 플레이어의
   * 눈은 화면 가장자리가 아니라 **적**에게 가 있습니다.
   *
   * 참고 게임 셋이 전부 같은 자리에서 **귀**를 씁니다 — 세키로의 위험
   * 경고음, 엘든 링의 저체력 심장 박동, 몬스터 헌터의 체력 경보.
   * 공통 원리: **눈이 바쁠 때 쓰라고 있는 채널이 귀입니다.**
   * 이 저장소도 *"귀 채널 채우기"* 를 원칙으로 적어 뒀는데, 정작 가장
   * 급한 신호가 귀에 없었습니다.
   *
   * ── 왜 한 방이 아니라 박동인가 ──────────────────────────────────
   * 한 번 울리는 소리는 **사건**이고, 되풀이되는 소리는 **상태**입니다.
   * "위험하다"는 상태이므로 되풀이되어야 하고, 체력이 낮을수록 빨라져야
   * *"더 위험해졌다"* 가 숫자를 안 보고도 들립니다.
   *
   * ⚠️ 문턱은 balance.ts `lowHpWarn` 한 곳에서 옵니다 — 눈(hud `setLowHp`)과
   *    **같은 값**이어야 합니다. 두 채널이 다른 순간에 말하기 시작하면
   *    플레이어는 둘 중 하나를 못 믿게 됩니다.
   *
   * ⚠️ 실시간(realDt)으로 돕니다. 히트스톱 중에도 경고는 살아 있어야
   *    합니다 — 화면이 멈춘 그 순간이 정확히 "위험하다"를 말할 때입니다.
   */
  heartbeat(realDt: number, ratio: number, warn: number): void {
    if (ratio > 0 && ratio < warn) {
      // 0(문턱) → 1(죽기 직전). 이 값이 빠르기와 크기를 같이 끌어올립니다.
      const t = Math.min(1, Math.max(0, 1 - ratio / warn))
      this.beatVisible = t
      // 1.05초(문턱) → 0.42초(직전). 사람 맥박이 빨라지는 폭과 비슷하게.
      const period = 1.05 - 0.63 * t
      this.heartT -= realDt
      if (this.heartT > 0) return
      this.heartT = period
      this.heartbeats++
      /**
       * **두 번 칩니다** (쿵-쿵). 한 번이면 다른 타격음과 헷갈립니다 —
       * 이 게임에는 이미 낮은 북(음악)과 피격음이 저음대에 있습니다.
       * 심장은 *"둘씩 짝지어 온다"* 로 구분됩니다.
       */
      const gain = 0.16 + 0.2 * t
      this.toneVoice({ type: 'sine', duration: 0.16, startHz: 96, endHz: 44, gain })
      this.toneVoice({
        type: 'sine',
        duration: 0.14,
        startHz: 86,
        endHz: 40,
        gain: gain * 0.72,
        delay: 0.15,
      })
      return
    }
    // 문턱 위로 올라오면 즉시 조용해집니다 — 다음 하강에서 첫 박이 바로 오게.
    this.beatVisible = 0
    this.heartT = 0
  }

  private heartT = 0
  private heartbeats = 0
  private beatVisible = 0

  /** 자동 검증용 — 심장 박동이 실제로 뛰고 있는가. */
  debugHeartbeat(): { beats: number; intensity: number } {
    return { beats: this.heartbeats, intensity: Number(this.beatVisible.toFixed(3)) }
  }

  /** 자동 검증용 — 음악 상태 */
  debugMusic(): { level: number; voices: number } {
    return { level: this.musicLevel, voices: this.musicVoices.length }
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
  /**
   * ⏱ **「지금」** — 답해야 하는 순간의 박자.
   *
   * ── 왜 화면만으로는 모자란가 ──────────────────────────────────
   * 「지금」 신호를 예고 도형에 넣었는데(visuals.ts), 그건 **그 적을 보고
   * 있어야** 도움이 됩니다. 그런데 벤치가 말합니다 — *"둘 이상과 싸우는
   * 시간 **61%**, 최대 7마리"*. 다 볼 수 없습니다.
   *
   * 세키로가 이 신호를 **소리**로 준 이유가 정확히 이것입니다. 소리는
   * 방향을 안 봐도 도착합니다.
   *
   * ── 다섯 색이 **같은 소리**를 씁니다 ──────────────────────────
   * 예고음 넷은 색마다 다릅니다(*"무엇"*). 이 박자는 **하나**입니다
   * (*"언제"*). 색마다 다르게 만들면 귀가 다섯 번째 색을 배워야 하고,
   * 그러면 이 신호가 색 체계를 덮습니다.
   *
   * 아주 짧고 밝게 잡습니다 — 예고음(0.1~0.55초)과 길이로 갈립니다.
   * 귀는 음높이보다 **길이와 시작점**을 먼저 구분합니다.
   */
  nowBeat(x: number, z: number): void {
    if (!this.gate('nowBeat')) return
    this.toneVoice({ type: 'square', duration: 0.045, startHz: 2100, endHz: 2400, gain: 0.09, x, z })
  }

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
      case SfxIntent.Counter:
        /**
         * 🟢 반격 — 넷과 **다른 종류의 소리**여야 합니다.
         *
         * 나머지 넷은 전부 "위험이 온다"는 경보입니다. 초록은 경보가 아니라
         * **기회**를 알립니다. 같은 문법(부풀거나 미끄러지는 톤)으로 만들면
         * 귀에는 그냥 다섯 번째 위험으로 들리고, 몸은 또 구릅니다.
         *
         * 그래서 유일하게 **맑은 두 음(종소리)** 으로 잡았습니다. 위로 4도
         * 올라가는 두 음은 경보가 아니라 신호로 들립니다 — 로스트아크의
         * 카운터, 세키로의 튕기기 신호가 전부 이 계열입니다.
         *
         * 두 번 치는 이유는 **화면과 맞추기 위해서**입니다. 초록만 도형이
         * 깜빡이는데(visuals.ts), 소리도 두 번 울리면 눈과 귀가 같은 것을
         * 말합니다. 색이 안 보이는 사람에게는 이 박자가 색을 대신합니다.
         */
        this.toneVoice({ type: 'triangle', duration: 0.16, startHz: 990, endHz: 990, gain: 0.13, x, z })
        this.toneVoice({ type: 'triangle', duration: 0.26, startHz: 1320, endHz: 1320, gain: 0.12, delay: 0.13, x, z })
        break
      default: {
        /**
         * 색을 하나 더 만들면 **여기서 컴파일이 막힙니다.**
         * 이 파일이 조용해진 이유가 정확히 "막아 주는 것이 없어서"였습니다.
         */
        const missing: never = intent
        void missing
        break
      }
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
   * 👀 **들켰다** — 적이 나를 처음 알아챈 순간.
   *
   * ── 왜 소리가 필요한가 ────────────────────────────────────────────
   * 쿼터뷰에서는 **화면 가장자리의 적을 안 봅니다.** 시선은 대체로 내
   * 캐릭터와 진행 방향에 있어서, 옆이나 뒤에서 표시가 꺼지는 것은
   * 놓치기 쉽습니다. 세키로가 인지 순간에 소리를 같이 내는 이유가
   * 이것입니다 — **눈이 안 가 있는 곳의 사건**은 귀로 와야 합니다.
   *
   * 짧은 상승 2음: "지금 뭔가 바뀌었다"만 말하고 빠집니다. 길게 끌면
   * 예고음(telegraph)과 겹쳐서 정작 답해야 할 신호를 덮습니다.
   *
   * ⚠️ `gate` 를 넉넉히 겁니다. 고함으로 무리가 한꺼번에 깨어나면 이
   *    소리가 5~6개 겹쳐 **경보가 아니라 소음**이 됩니다. 한 번만 나면
   *    뜻은 그대로입니다 — *"들켰다"* 는 마릿수가 아니라 사건입니다.
   */
  spotted(x?: number, z?: number): void {
    if (!this.gate('spotted', 0.5)) return
    this.toneVoice({ type: 'triangle', duration: 0.07, startHz: 720, endHz: 900, gain: 0.13, x, z })
    this.toneVoice({
      type: 'triangle',
      duration: 0.12,
      startHz: 1180,
      endHz: 1180,
      gain: 0.1,
      delay: 0.06,
      x,
      z,
    })
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
    /**
     * ── 🎲 **여기만 `Math.random()` 을 씁니다 — 유일한 예외입니다** ────
     *
     * 이 저장소의 규칙은 *"난수는 씨앗에서"* 입니다(core/rng.ts). 그런데
     * 백색 잡음은 **선택이 아니라 잡음 그 자체**입니다 — 무엇을 고른
     * 결과가 아니라, 재현해도 알아들을 사람이 없는 0.5초짜리 파형입니다.
     * 씨앗을 걸어도 아무 검사가 좋아지지 않고, 4만 번 도는 루프만
     * 느려집니다.
     *
     * ⚠️ 예외를 **여기 한 줄로 못박아 둡니다.** `npm run guard` 가 이
     *    주석을 보고 통과시키므로, 다른 곳에 `Math.random()` 을 쓰면
     *    그때는 반드시 걸립니다.
     */
    // guard-allow: Math.random — 백색 잡음 파형 자체(위 주석)
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
      const offset = audioRng.next() * 0.3

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
