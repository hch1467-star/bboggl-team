/**
 * HUD — 체력/스태미나/웨이브/성능 표시.
 *
 * 캔버스가 아니라 DOM으로 만든 이유: 브라우저의 텍스트 렌더링과 레이아웃이
 * 훨씬 선명하고, 캔버스에 UI를 그리면 드로우콜과 폰트 처리로 프레임을 잡아먹습니다.
 * (Unity 이식 시에는 이 파일이 그대로 UI Toolkit / uGUI 로 대체됩니다.)
 */

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`HUD element not found: #${id}`)
  return node as T
}

export class Hud {
  private readonly hpFill = el<HTMLDivElement>('hpFill')
  private readonly hpGhost = el<HTMLDivElement>('hpGhost')
  private readonly hpText = el<HTMLSpanElement>('hpText')
  private readonly stamFill = el<HTMLDivElement>('stamFill')
  private readonly stamText = el<HTMLSpanElement>('stamText')
  private readonly arenaStats = el<HTMLElement>('arenaStats')
  private readonly levelStats = el<HTMLElement>('levelStats')
  private readonly levelNameText = el<HTMLElement>('levelNameText')
  private readonly levelEnemyText = el<HTMLElement>('levelEnemyText')
  private readonly treasureText = el<HTMLElement>('treasureText')
  private readonly regionText = el<HTMLElement>('regionText')
  private readonly objectiveText = el<HTMLElement>('objectiveText')
  private readonly waveText = el<HTMLElement>('waveText')
  private readonly enemyText = el<HTMLElement>('enemyText')
  private readonly killText = el<HTMLElement>('killText')
  private readonly perfText = el<HTMLElement>('perfText')
  private readonly banner = el<HTMLDivElement>('banner')
  private readonly bannerTitle = el<HTMLDivElement>('bannerTitle')
  private readonly bannerSub = el<HTMLDivElement>('bannerSub')
  readonly restartButton = el<HTMLButtonElement>('restart')
  private readonly saveText = el<HTMLElement>('saveText')
  private readonly vialText = el<HTMLElement>('vialText')
  private readonly restHint = el<HTMLDivElement>('restHint')
  private readonly restLabel = el<HTMLElement>('restLabel')
  private readonly restFill = el<HTMLDivElement>('restFill')
  private readonly lowHp = el<HTMLDivElement>('lowHp')
  private saveTimer: number | null = null

  private fpsAccum = 0
  private fpsFrames = 0
  private bannerTimer = 0
  private lastHp = -1
  private lastStam = -1

  setVitals(hp: number, maxHp: number, stamina: number, maxStamina: number): void {
    const hpRatio = Math.max(0, hp) / maxHp
    if (hpRatio !== this.lastHp) {
      this.hpFill.style.transform = `scaleX(${hpRatio})`
      this.hpGhost.style.transform = `scaleX(${hpRatio})`
      this.hpText.textContent = `${Math.ceil(Math.max(0, hp))} / ${maxHp}`
      this.lastHp = hpRatio
    }
    const stamRatio = Math.max(0, stamina) / maxStamina
    // 스태미나는 매 프레임 변해서, 1% 단위로만 DOM을 건드립니다(레이아웃 비용 절감).
    const quantised = Math.round(stamRatio * 100)
    if (quantised !== this.lastStam) {
      this.stamFill.style.transform = `scaleX(${stamRatio})`
      this.stamText.textContent = String(Math.ceil(Math.max(0, stamina)))
      this.lastStam = quantised
    }
  }

  /** 아레나 모드와 레벨 모드는 보여줄 정보가 다릅니다. */
  setVials(left: number, max: number): void {
    this.vialText.textContent = `${left} / ${max}`
    // 다 떨어졌으면 붉게 — 숫자를 읽지 않아도 "없다"가 보여야 합니다.
    this.vialText.style.color = left === 0 ? '#ff6b5e' : '#ffd479'
  }

  /**
   * 저체력 경고.
   *
   * 40% 아래에서 시작해 0에 가까울수록 진해집니다. 문턱을 두는 이유:
   * 항상 조금씩 보이면 배경이 되어 **경고로 작동하지 않습니다.**
   * 맥동은 CSS가 아니라 여기서 값으로 넣습니다 — 애니메이션은 실시간으로
   * 도는데 게임은 히트스톱 중 멈추므로, 둘이 어긋나면 화면이 따로 놉니다.
   */
  setLowHp(ratio: number, pulse: number): void {
    const t = ratio >= 0.4 ? 0 : 1 - ratio / 0.4
    this.lowHp.style.opacity = t <= 0 ? '0' : String(0.25 + t * (0.5 + 0.25 * pulse))
  }

  setRest(near: boolean, progress: number, blocked: boolean): void {
    this.restHint.style.display = near ? 'block' : 'none'
    if (!near) return
    this.restLabel.textContent = blocked ? '적이 가까워 쉴 수 없다' : '화톳불 — 가만히 서 있으면 쉰다'
    this.restLabel.style.color = blocked ? '#ff8a7a' : '#ffd9a0'
    this.restFill.style.width = `${Math.round(progress * 100)}%`
  }

  setMode(mode: 'arena' | 'level'): void {
    this.arenaStats.style.display = mode === 'arena' ? '' : 'none'
    this.levelStats.style.display = mode === 'level' ? '' : 'none'
  }

  setLevelProgress(name: string, enemiesLeft: number, found: number, total: number): void {
    this.levelNameText.textContent = name
    this.levelEnemyText.textContent = String(enemiesLeft)
    this.treasureText.textContent = `${found} / ${total}`
  }

  /**
   * 지금 있는 곳과 다음 목표.
   *
   * 플레이 테스트 피드백: "어디로 가야 하고 어디에 뭐가 있는지 목표가 없으니
   * 그냥 눈앞의 적만 잡게 된다." 미니맵 대신 **한 줄 목표**로 답합니다.
   */
  setNavigation(region: string, objective: string): void {
    if (this.regionText.textContent !== region) this.regionText.textContent = region
    if (this.objectiveText.textContent !== objective) this.objectiveText.textContent = objective
  }

  /**
   * "저장됨"을 잠깐 띄웁니다.
   *
   * 세이브가 조용히 돌면 플레이어는 **저장되고 있는지 알 수 없습니다.**
   * 그러면 브라우저를 닫을 때마다 불안해지고, 실제로 저장이 실패해도
   * (사생활 보호 모드·용량 초과) 눈치채지 못한 채 진행을 통째로 잃습니다.
   * 성공과 실패를 **다르게** 보여주는 것이 핵심입니다.
   */
  flashSaved(ok: boolean): void {
    this.saveText.textContent = ok ? '저장됨' : '저장 실패 — 브라우저 설정 확인'
    this.saveText.style.color = ok ? '#8fe3b0' : '#ff9d8a'
    this.saveText.classList.add('show')
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => this.saveText.classList.remove('show'), ok ? 1600 : 4000)
  }

  setProgress(wave: number, enemiesLeft: number, kills: number): void {
    this.waveText.textContent = String(wave)
    this.enemyText.textContent = String(enemiesLeft)
    this.killText.textContent = String(kills)
  }

  /** 프레임 시간을 모아 0.5초마다 fps를 갱신합니다(매 프레임 갱신하면 숫자가 튀어 못 읽습니다). */
  tickPerf(realDt: number): void {
    this.fpsAccum += realDt
    this.fpsFrames++
    if (this.fpsAccum >= 0.5) {
      const fps = this.fpsFrames / this.fpsAccum
      this.perfText.textContent = `${fps.toFixed(0)} fps`
      this.fpsAccum = 0
      this.fpsFrames = 0
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= realDt
      if (this.bannerTimer <= 0) this.banner.classList.remove('show')
    }
  }

  showBanner(title: string, sub: string, seconds: number): void {
    this.bannerTitle.textContent = title
    this.bannerSub.textContent = sub
    this.banner.classList.add('show')
    this.restartButton.style.display = 'none'
    this.bannerTimer = seconds
  }

  showGameOver(kills: number, wave: number): void {
    this.bannerTitle.textContent = '패배'
    this.bannerSub.textContent = `웨이브 ${wave} · ${kills}마리 처치`
    this.banner.classList.add('show')
    this.restartButton.style.display = 'inline-block'
    this.bannerTimer = 0
  }

  hideBanner(): void {
    this.banner.classList.remove('show')
    this.restartButton.style.display = 'none'
    this.bannerTimer = 0
  }
}
