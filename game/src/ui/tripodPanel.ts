import { SKILL_KEYS } from '../config/arsenal'
import { TRIPOD_TIERS } from '../config/tripods'
import { skillIdForSlot, SLOT_COUNT } from '../systems/loadout'
import { switchTripod, tripodPoints, tripodStatus, unlockTripod } from '../systems/tripod'

/**
 * 트라이포드 선택 창 (T 키).
 *
 * ── 왜 게임을 멈추지 않는가 ────────────────────────────────────────
 * 로스트아크는 별도 화면에서 세팅하지만, 우리는 **전투 중에도 열립니다.**
 * 이유는 학습입니다. "이 스킬이 왜 이렇게 작동하지?"라는 의문이 생기는 순간은
 * 전투 중인데, 그때 창을 못 열면 궁금증이 식은 뒤에야 확인하게 됩니다.
 * 대신 창을 열면 화면 절반만 덮어서, 뒤에서 무슨 일이 벌어지는지 보입니다.
 *
 * ── 왜 잠긴 것도 전부 보여주는가 ───────────────────────────────────
 * 못 고르는 선택지를 숨기면 "고를 게 없네"로 끝나지만, 회색으로 보여주면
 * **"저걸 열려면 보물을 찾아야겠다"** 가 됩니다. 탐험의 동기가 UI에서 나옵니다.
 * 기둥 4(헤매지 않는 탐험)의 목적이 "왜 가야 하는가"에 답하는 것이므로,
 * 그 답을 여기서 미리 보여주는 셈입니다.
 */

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`요소를 찾을 수 없습니다: #${id}`)
  return node as T
}

export class TripodPanel {
  private readonly root = el<HTMLElement>('tripod')
  private readonly body = el<HTMLElement>('tripodBody')
  private readonly pointsText = el<HTMLElement>('tripodPoints')
  private open = false
  /** 지금 화면에 뿌릴 스킬들 — 게임이 매번 알려줍니다. */
  private playerEntity = -1

  constructor() {
    el<HTMLElement>('tripodClose').addEventListener('click', () => this.setOpen(false))
  }

  setPlayer(entity: number): void {
    this.playerEntity = entity
    if (this.open) this.refresh()
  }

  isOpen(): boolean {
    return this.open
  }

  toggle(): void {
    this.setOpen(!this.open)
  }

  setOpen(open: boolean): void {
    this.open = open
    this.root.classList.toggle('show', open)
    if (open) this.refresh()
  }

  refresh(): void {
    this.pointsText.textContent = String(tripodPoints())
    if (!this.open || this.playerEntity < 0) return

    this.body.replaceChildren()
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const skillId = skillIdForSlot(this.playerEntity, slot)
      if (!skillId) continue
      const status = tripodStatus(skillId)
      if (!status) continue
      this.body.appendChild(this.renderSkill(skillId, slot, status))
    }
    if (!this.body.childElementCount) {
      const empty = document.createElement('div')
      empty.className = 'tpEmpty'
      empty.textContent = '변형할 수 있는 스킬이 없습니다.'
      this.body.appendChild(empty)
    }
  }

  private renderSkill(
    skillId: string,
    slot: number,
    status: NonNullable<ReturnType<typeof tripodStatus>>,
  ): HTMLElement {
    const card = document.createElement('div')
    card.className = 'tpSkill'

    const head = document.createElement('div')
    head.className = 'tpHead'
    head.innerHTML = `<span class="tpKey">${SKILL_KEYS[slot]}</span><span>${status.skillName}</span>`
    card.appendChild(head)

    for (let t = 0; t < TRIPOD_TIERS; t++) {
      const tier = status.tiers[t]
      const row = document.createElement('div')
      row.className = 'tpTier'

      const label = document.createElement('div')
      label.className = 'tpTierName'
      label.textContent = tier.title
      if (!tier.unlocked) {
        label.textContent += tier.affordable ? '  · 각인석 1 필요' : '  · 잠김'
      }
      row.appendChild(label)

      const opts = document.createElement('div')
      opts.className = 'tpOpts'
      for (let o = 0; o < tier.options.length; o++) {
        const opt = tier.options[o]
        const btn = document.createElement('button')
        btn.className = 'tpOpt'
        btn.classList.toggle('sel', tier.unlocked && tier.selected === o)
        btn.classList.toggle('locked', !tier.unlocked)
        btn.disabled = !tier.unlocked && !tier.affordable
        btn.innerHTML = `<b>${opt.name}</b><span>${opt.desc}</span>`
        btn.addEventListener('click', () => {
          // 잠겨 있으면 해금(포인트 소모), 열려 있으면 그냥 교체(무료)입니다.
          const ok = tier.unlocked
            ? switchTripod(skillId, t, o)
            : unlockTripod(skillId, t, o)
          if (ok) this.refresh()
        })
        opts.appendChild(btn)
      }
      row.appendChild(opts)
      card.appendChild(row)
    }
    return card
  }
}
