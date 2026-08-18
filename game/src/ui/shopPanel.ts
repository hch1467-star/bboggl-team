import type { ShopItem } from '../systems/shop'

/**
 * 🏪 **모루의 상점 창** (N 키, 모루 앞에서만).
 *
 * ── 왜 물건을 **먼저 보여 주는가** ─────────────────────────────────
 * 이 게임에는 이미 *"모르는 것을 여는"* 자리가 있습니다 — 상자입니다.
 * 상점이 같은 일을 하면 둘 중 하나는 없어도 됩니다. 그래서 여기서는
 * **등급도 옵션도 값도 다 보여 주고**, 고민을 하나만 남깁니다:
 * *"이 불티로 이걸 살까, 강화를 할까."*
 *
 * ── 못 사는 것도 **지우지 않습니다** ───────────────────────────────
 * 트라이포드 창이 잠긴 선택지를 회색으로 보여 주는 것과 같은 이유입니다.
 * 숨기면 *"살 게 없네"* 로 끝나지만, 값과 함께 회색으로 보이면
 * **"저걸 사려면 불티를 더 모아야겠다"** 가 됩니다.
 *
 * ⚠️ 버튼에 **왜 못 사는지**를 적습니다. 회색이기만 하면 이유가 없어서,
 *    플레이어는 규칙(불티가 모자라다 / 지금 것이 더 좋다 / 이미 샀다)을
 *    끝내 못 배웁니다.
 */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`요소를 찾을 수 없습니다: #${id}`)
  return node as T
}

export interface ShopRow {
  item: ShopItem
  /** 이미 산 물건인가 */
  sold: boolean
  /** 지금 그 무기가 가진 등급 — 이보다 높아야 살 이유가 있습니다. */
  haveTier: number
  /** 지금 가진 불티 */
  embers: number
}

export class ShopPanel {
  private readonly root = el<HTMLElement>('shop')
  private readonly body = el<HTMLElement>('shopBody')
  private readonly embersText = el<HTMLElement>('shopEmbers')
  private open = false
  private rows: ShopRow[] = []
  private onBuy: (item: ShopItem) => void = () => {}

  constructor() {
    el<HTMLElement>('shopClose').addEventListener('click', () => this.setOpen(false))
  }

  isOpen(): boolean {
    return this.open
  }

  setOpen(open: boolean): void {
    this.open = open
    this.root.classList.toggle('show', open)
  }

  toggle(): void {
    this.setOpen(!this.open)
  }

  setBuyHandler(fn: (item: ShopItem) => void): void {
    this.onBuy = fn
  }

  /** 재고와 지갑을 다시 그립니다. 게임이 상태를 넘겨주고, 창은 그리기만 합니다. */
  render(rows: ShopRow[], embers: number): void {
    this.rows = rows
    this.embersText.textContent = String(embers)
    this.body.replaceChildren()
    for (const row of rows) {
      const { item } = row
      const card = document.createElement('div')
      card.className = 'shopRow'
      const hex = `#${item.tierColor.toString(16).padStart(6, '0')}`

      const nm = document.createElement('div')
      nm.className = 'nm'
      nm.style.color = hex
      nm.textContent = `${item.tierName} ${item.weaponName}`
      card.appendChild(nm)

      const af = document.createElement('div')
      af.className = 'af'
      af.style.color = hex
      af.textContent =
        item.affixes.map((a) => `${a.name} +${a.value}${a.unit === '%' ? '%' : ''}`).join(' · ') ||
        '옵션 없음'
      card.appendChild(af)

      const bt = document.createElement('button')
      bt.className = 'bt'
      /**
       * 살 수 없는 이유는 **셋 중 하나**이고, 셋의 처방이 서로 다릅니다:
       *   · 이미 샀다      → 다른 것을 보세요
       *   · 지금 것이 낫다 → 이건 살 이유가 없습니다
       *   · 불티가 모자라다 → 더 모으면 됩니다 (숫자를 같이 보여 줍니다)
       * 그래서 한 덩어리로 "못 삼"이라고 쓰지 않습니다.
       */
      if (row.sold) {
        bt.textContent = '이미 샀습니다'
        bt.disabled = true
      } else if (item.tier <= row.haveTier) {
        bt.textContent = '지금 든 것이 더 좋다'
        bt.disabled = true
      } else if (row.embers < item.price) {
        bt.textContent = `불티 ${row.embers}/${item.price}`
        bt.disabled = true
      } else {
        bt.textContent = `사기 — 불티 ${item.price}`
        bt.addEventListener('click', () => this.onBuy(item))
      }
      card.appendChild(bt)
      this.body.appendChild(card)
    }
    if (rows.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'af'
      empty.textContent = '내놓은 물건이 없습니다'
      this.body.appendChild(empty)
    }
  }

  /** 지금 그려져 있는 줄들 — 프로브가 화면을 읽을 때 씁니다. */
  debugRows(): ShopRow[] {
    return this.rows
  }
}
