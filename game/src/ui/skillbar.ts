import { SKILL_KEYS } from '../config/arsenal'

/**
 * 스킬바 — 슬롯 5개(무기 3 + 룬 2)의 이름과 쿨다운을 보여줍니다.
 *
 * 쿨다운을 **아래에서 위로 차오르는 어두운 판**으로 표현합니다.
 * 숫자만 띄우면 전투 중에 읽을 수가 없습니다. 판이 줄어드는 속도가
 * "곧 터뜨릴 수 있다"를 주변 시야로 알려주고, 그게 우리 전투의 리듬
 * (버티다가 → 터뜨린다)을 몸으로 느끼게 하는 장치입니다.
 */

interface SlotView {
  root: HTMLElement
  cd: HTMLElement
  cdText: HTMLElement
  name: HTMLElement
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`스킬바 요소를 찾을 수 없습니다: #${id}`)
  return node as T
}

export interface SlotState {
  name: string
  empty: boolean
}

export class SkillBar {
  private readonly weaponName = el<HTMLElement>('weaponName')
  private readonly slots: SlotView[] = []
  private readonly lastPercent = SKILL_KEYS.map(() => -1)
  /** 지금 실제로 들고 있는 무기 이름 — 예약 표시를 껐다 켤 때 되돌릴 자리. */
  private current = ''

  constructor() {
    for (let i = 0; i < SKILL_KEYS.length; i++) {
      const root = el<HTMLElement>(`slot${i}`)
      this.slots.push({
        root,
        cd: root.querySelector<HTMLElement>('.cd')!,
        cdText: root.querySelector<HTMLElement>('.cdText')!,
        name: root.querySelector<HTMLElement>('.nm')!,
      })
    }
  }

  setLoadout(weapon: string, slots: SlotState[]): void {
    this.current = weapon
    this.weaponName.textContent = weapon
    for (let i = 0; i < this.slots.length; i++) {
      const view = this.slots[i]
      const state = slots[i]
      view.name.textContent = state.empty ? '빈 슬롯' : state.name
      view.root.classList.toggle('empty', state.empty)
      // 강제로 다시 그리도록 캐시를 무효화합니다.
      this.lastPercent[i] = -1
    }
  }

  /**
   * 🗡 **예약된 무기 전환을 보여 줍니다.**
   *
   * ── 왜 이게 필요한가 ────────────────────────────────────────────
   * 휘두르는 도중에 누른 전환은 이제 **사라지지 않고 기다립니다**
   * (`Actor.bufferedWeapon`). 그런데 기다리는 동안 화면이 아무 말도
   * 안 하면, 플레이어가 보는 것은 *"눌렀는데 안 바뀌네"* 로 똑같습니다 —
   * 고치기 전과 **구분이 안 됩니다.**
   *
   * 바로 앞 라운드에서 같은 실수를 했습니다: 인지 규칙을 셋 만들어 놓고
   * 화면에 한 글자도 안 올려서, 플레이어에게는 없는 기능이었습니다.
   * 같은 실수를 두 번 하지 않기 위해 이 줄이 있습니다.
   *
   * @param pending 예약된 무기 이름. 없으면 빈 문자열.
   */
  setPendingWeapon(pending: string): void {
    const on = pending.length > 0
    this.weaponName.classList.toggle('pending', on)
    // 화살표로 **어디로 가는 중인지**까지 말합니다 — "대기 중"만으로는
    // 어느 무기를 눌렀는지 모릅니다(무기가 셋이라 헷갈립니다).
    this.weaponName.textContent = on ? `${this.current} → ${pending}` : this.current
  }

  /** @param cooldowns 남은 시간(초) @param maxes 각 스킬의 전체 쿨다운(초) */
  update(cooldowns: number[], maxes: number[]): void {
    for (let i = 0; i < this.slots.length; i++) {
      const view = this.slots[i]
      const remaining = cooldowns[i] ?? 0
      const max = maxes[i] || 1
      const percent = Math.round(Math.min(1, remaining / max) * 100)
      if (percent === this.lastPercent[i]) continue
      this.lastPercent[i] = percent

      view.cd.style.height = `${percent}%`
      const ready = remaining <= 0
      view.root.classList.toggle('ready', ready && !view.root.classList.contains('empty'))
      if (ready) {
        view.cdText.style.opacity = '0'
      } else {
        view.cdText.style.opacity = '1'
        // 1초 미만은 소수 첫째 자리까지 — 마지막 순간의 긴장감이 살아납니다.
        view.cdText.textContent = remaining >= 1 ? String(Math.ceil(remaining)) : remaining.toFixed(1)
      }
    }
  }
}
