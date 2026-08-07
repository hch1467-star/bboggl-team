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
  private readonly waveText = el<HTMLElement>('waveText')
  private readonly enemyText = el<HTMLElement>('enemyText')
  private readonly killText = el<HTMLElement>('killText')
  private readonly perfText = el<HTMLElement>('perfText')
  private readonly banner = el<HTMLDivElement>('banner')
  private readonly bannerTitle = el<HTMLDivElement>('bannerTitle')
  private readonly bannerSub = el<HTMLDivElement>('bannerSub')
  readonly restartButton = el<HTMLButtonElement>('restart')

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
  setMode(mode: 'arena' | 'level'): void {
    this.arenaStats.style.display = mode === 'arena' ? '' : 'none'
    this.levelStats.style.display = mode === 'level' ? '' : 'none'
  }

  setLevelProgress(name: string, enemiesLeft: number, found: number, total: number): void {
    this.levelNameText.textContent = name
    this.levelEnemyText.textContent = String(enemiesLeft)
    this.treasureText.textContent = `${found} / ${total}`
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
