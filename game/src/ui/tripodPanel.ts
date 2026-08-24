import { SKILL_KEYS } from '../config/arsenal'
import { TRIPOD_TIERS } from '../config/tripods'
import { skillIdForSlot, SLOT_COUNT } from '../systems/loadout'
import {
  graftOn,
  graftPart,
  graftReason,
  sparePartIds,
  switchTripod,
  tripodPoints,
  tripodStatus,
  ungraftPart,
  unlockTripod,
} from '../systems/tripod'
import { findPart } from '../config/tripods'

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
    card.appendChild(this.renderGraft(skillId))
    return card
  }

  /**
   * ── 🧩 **이식 칸** — 다른 스킬에서 «고르지 않아 남은» 조각을 끼웁니다 ──
   *
   * 단계 셋과 **같은 모양**(tpTier/tpOpts/tpOpt)으로 그립니다. 새 스타일을
   * 만들면 화면이 따로 놀고, 플레이어는 *"이건 다른 종류의 무엇이지?"* 를
   * 한 번 더 배워야 합니다. 같은 자리에 같은 모양으로 두면 **배울 것이
   * 늘지 않습니다.**
   *
   * ⚠️ **못 끼우는 부품도 보여 주고, 이유를 적습니다.** 목록에서 빼 버리면
   *    플레이어는 그 부품이 존재하는지도 모릅니다. 회색으로만 막으면
   *    *"왜 안 되지"* 하고 다른 걸 눌러 봅니다. 이 게임의 원칙
   *    (*"스스로 잘한다고 느끼게"*)은 **막는 이유를 말해 주는 것**까지입니다 —
   *    이유를 알면 «다음엔 저 스킬에 써야지» 라는 계획이 생깁니다.
   */
  private renderGraft(skillId: string): HTMLElement {
    const row = document.createElement('div')
    row.className = 'tpTier'

    const installed = graftOn(skillId)
    const label = document.createElement('div')
    label.className = 'tpTierName'
    label.textContent = installed ? '이식 · 끼운 조각' : '이식 · 다른 스킬의 조각'
    row.appendChild(label)

    const opts = document.createElement('div')
    opts.className = 'tpOpts'

    if (installed) {
      const f = findPart(installed)
      const btn = document.createElement('button')
      /**
       * ⚠️ `tpOpt` 는 **모양** 때문에 그대로 씁니다(단계와 같은 자리·같은
       *    생김새). 다만 `tpGraftOpt` 를 같이 답니다 — 「단계 선택지가 몇
       *    개인가」를 세는 검사가 이식 버튼까지 세면 **두 가지가 한 칸에**
       *    담겨 정확히 거꾸로 읽힙니다. 실제로 그 검사가 24 → 36 으로
       *    빨개져서 이 표시를 달았습니다.
       */
      btn.className = 'tpOpt tpGraftOpt sel'
      btn.innerHTML = `<b>${f?.part.name ?? '?'}</b><span>${f?.part.desc ?? ''} — 누르면 빼냅니다</span>`
      btn.addEventListener('click', () => {
        if (ungraftPart(skillId)) this.refresh()
      })
      opts.appendChild(btn)
    }

    const spare = sparePartIds()
    for (const id of spare) {
      const f = findPart(id)
      if (!f) continue
      const why = graftReason(skillId, id)
      const btn = document.createElement('button')
      btn.className = 'tpOpt tpGraftOpt'
      btn.classList.toggle('locked', why !== 'none')
      btn.disabled = why !== 'none'
      // 왜 안 되는지를 **부품 설명 자리에** 씁니다 — 눈이 가는 곳에.
      const reason =
        why === 'ownSkill'
          ? '이 스킬에서 나온 조각입니다 — 다른 스킬에만'
          : why === 'noEffect'
            ? '이 스킬에서는 아무것도 안 바뀝니다'
            : f.part.desc
      btn.innerHTML = `<b>${f.part.name}</b><span>${reason}</span>`
      btn.addEventListener('click', () => {
        if (graftPart(skillId, id)) this.refresh()
      })
      opts.appendChild(btn)
    }

    if (!opts.childElementCount) {
      const empty = document.createElement('div')
      empty.className = 'tpEmpty'
      // 아직 아무 단계도 안 연 사람에게 **어디서 나오는지**를 알려 줍니다.
      empty.textContent = '남은 조각이 없습니다 — 단계를 열면 고르지 않은 쪽이 조각으로 남습니다.'
      opts.appendChild(empty)
    }
    row.appendChild(opts)
    return row
  }
}
