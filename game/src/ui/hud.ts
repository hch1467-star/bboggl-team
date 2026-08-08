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
  private readonly emberText = el<HTMLElement>('emberText')
  private readonly bossBar = el<HTMLDivElement>('bossBar')
  private readonly bossName = el<HTMLElement>('bossName')
  private readonly bossFill = el<HTMLDivElement>('bossFill')
  private readonly bossTicks = el<HTMLElement>('bossTicks')
  private readonly upgradeHint = el<HTMLElement>('upgradeHint')
  private readonly shortcutHint = el<HTMLElement>('shortcutHint')
  private readonly focusPips = el<HTMLElement>('focusPips')
  private readonly weaponUpgradeHint = el<HTMLElement>('weaponUpgradeHint')
  private readonly stoneText = el<HTMLElement>('stoneText')
  private saveTimer: number | null = null
  /** 지금 표시 중인 보스 이름. 눈금을 다시 그릴지 판단합니다. */
  private bossShown = ''

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
  /**
   * 보스 전용 체력바. `name` 이 null 이면 감춥니다.
   * @param thresholds 페이즈 경계 비율(0~1). 머리 위 바와 **같은 값**을 받습니다.
   */
  setBoss(name: string | null, ratio: number, thresholds: number[]): void {
    if (!name) {
      this.bossBar.style.display = 'none'
      this.bossShown = ''
      return
    }
    this.bossBar.style.display = 'block'
    if (this.bossShown !== name) {
      this.bossShown = name
      this.bossName.textContent = name
      // 눈금은 이름이 바뀔 때만 다시 그립니다 — 매 프레임 DOM을 만들면
      // 소프트웨어 렌더링에서 그 자체로 프레임을 잡아먹습니다.
      this.bossTicks.innerHTML = thresholds
        .map((t) => `<i style="left:${(t * 100).toFixed(2)}%"></i>`)
        .join('')
    }
    this.bossFill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`
  }

  setEmbers(n: number): void {
    this.emberText.textContent = String(n)
  }

  /**
   * 화톳불 앞에서만 강화 안내를 띄웁니다.
   * @param cost -1 이면 더 올릴 수 없는 상태입니다.
   */
  setUpgrade(atFire: boolean, cost: number, embers: number): void {
    if (!atFire) {
      this.upgradeHint.textContent = ''
      return
    }
    if (cost < 0) {
      this.upgradeHint.textContent = '성수병 강화 완료'
      return
    }
    const ok = embers >= cost
    this.upgradeHint.innerHTML = ok
      ? `<b>V</b> 성수병 강화 — 불티 <b>${cost}</b>`
      : `성수병 강화 — 불티 ${embers} / <b>${cost}</b>`
  }

  /**
   * 무기 강화 안내 — 성수병 강화 **바로 아래**에 나란히 둡니다.
   *
   * 둘을 한 화면에 같이 보여주는 것이 요점입니다. 화톳불 앞에서의 결정은
   * "강화할까 말까"가 아니라 **"둘 중 무엇에 쓸까"** 이기 때문입니다.
   * 하나씩 번갈아 보여주면 비교가 불가능해집니다.
   */
  setWeaponUpgrade(
    atFire: boolean,
    cost: number,
    embers: number,
    level: number,
    stoneCost: number,
    stones: number,
  ): void {
    if (!atFire) {
      this.weaponUpgradeHint.textContent = ''
      return
    }
    if (cost < 0) {
      this.weaponUpgradeHint.textContent = `무기 강화 완료 (+${level})`
      return
    }
    const okE = embers >= cost
    const okS = stones >= stoneCost
    // 모자란 쪽만 붉게 — "무엇이 부족한가"가 한눈에 보여야 다음 행동이 정해집니다.
    const emberPart = okE ? `불티 <b>${cost}</b>` : `<u>불티 ${embers}/${cost}</u>`
    const stonePart = okS ? `정련석 <b>${stoneCost}</b>` : `<u>정련석 ${stones}/${stoneCost}</u>`
    const key = okE && okS ? '<b>B</b> ' : ''
    this.weaponUpgradeHint.innerHTML = `${key}무기 강화 +${level} → +${level + 1} — ${emberPart} · ${stonePart}`
  }

  /** 가진 정련석 — 불티 옆에 나란히. 둘이 다른 자원임이 보여야 합니다. */
  setStones(n: number): void {
    this.stoneText.textContent = String(n)
  }

  /**
   * 사다리 안내.
   *
   * `locked`(아래에서 올려다봄)일 때 안내를 **끄지 않는** 것이 핵심입니다.
   * 여기서 침묵하면 걷힌 사다리는 그냥 지형 장식이 되고, 조사에서 가장
   * 많이 인용된 문장 — *"닿지 않는 사다리는 위쪽을 아직 못 봤다는 뜻"* — 이
   * 플레이어에게 전달되지 않습니다. 안 되는 이유를 말해 주는 것이 안내입니다.
   */
  setShortcut(state: 'ready' | 'locked' | 'open' | null): void {
    if (state === null || state === 'open') {
      this.shortcutHint.style.display = 'none'
      return
    }
    this.shortcutHint.style.display = 'block'
    if (state === 'ready') {
      this.shortcutHint.innerHTML = '<b>V</b> 사다리를 내린다 — 지름길이 열립니다'
      this.shortcutHint.style.color = '#c9f0a8'
    } else {
      this.shortcutHint.textContent = '사다리가 걷혀 있다 — 위에서만 내릴 수 있다'
      this.shortcutHint.style.color = '#9aa7b8'
    }
  }

  /**
   * 🥋 집중 구슬.
   *
   * 숫자가 아니라 **구슬**로 보여줍니다. 전투 중에 읽을 것은 "몇 개인가"이지
   * "2.34인가"가 아닙니다. 차오르는 중인 한 칸은 흐리게 — 다음 한 대면
   * 채워진다는 것이 곁눈으로 보여야 "한 대 더 넣고 태우자"가 성립합니다.
   */
  setFocus(value: number, max: number): void {
    const full = Math.floor(value)
    const partial = value - full
    let html = ''
    for (let i = 0; i < max; i++) {
      const on = i < full
      const half = !on && i === full && partial > 0.05
      html += `<i class="${on ? 'on' : half ? 'half' : ''}" style="${half ? `opacity:${(0.25 + partial * 0.5).toFixed(2)}` : ''}"></i>`
    }
    if (this.focusPips.innerHTML !== html) this.focusPips.innerHTML = html
  }

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
