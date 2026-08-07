import { SKILL_KEYS } from '../config/arsenal'

/**
 * 스킬바 — 슬롯 4개의 이름과 쿨다운을 보여줍니다.
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
  private readonly lastPercent = [-1, -1, -1, -1]

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
