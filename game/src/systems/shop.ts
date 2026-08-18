/**
 * 🏪 **모루의 상점** — 재고를 만드는 곳.
 *
 * 설계 근거는 config/gear.ts `SHOP` 에 있습니다. 요약:
 *   · 상자는 **모르는 것**, 상점은 **아는 것을 값 주고 사는 것**
 *   · **재입고가 없습니다** — 있으면 「좋은 게 나올 때까지 쉬기」가 최적해
 *   · 값은 강화 곡선(`WEAPON_UPGRADE.costs`)을 그대로 씁니다
 *
 * ── ⚠️ 이 파일에 상태가 없습니다 ───────────────────────────────────
 * 재고는 **저장하지 않습니다.** 모루의 좌표만 있으면 언제든 같은 것이
 * 나오기 때문입니다(등급 시드도 같은 방식입니다 — gear.ts 주석).
 * 저장하는 것은 *"무엇을 이미 샀는가"* 뿐이고, 그건 세이브의 몫입니다.
 */
import { WEAPONS } from '../config/arsenal'
import { WEAPON_UPGRADE } from '../config/balance'
import { GearTier, SHOP, gearPrice, rollAffixes, rollTier, tierDef, type Affix } from '../config/gear'

export interface ShopItem {
  /** 이 물건이 붙는 무기(0~2) */
  weaponIndex: number
  weaponName: string
  tier: number
  tierName: string
  tierColor: number
  seed: number
  price: number
  affixes: Affix[]
}

/**
 * 이 모루가 내놓는 물건들.
 *
 * @param key   모루를 가리키는 문자열(좌표). **같은 모루 = 같은 재고**입니다.
 * @param luck  이 모루의 진행도(0~1). 뒤에 있는 상점일수록 좋은 물건이 옵니다.
 *
 * ⚠️ 무기 종류마다 하나씩 냅니다(`SHOP.perWeapon`). 무작위로 뽑으면
 *    *"안 쓰는 무기 것만 셋"* 이 나올 수 있고, 그 상점은 그 판에 없는
 *    것과 같아집니다.
 */
export function shopStock(key: string, luck: number): ShopItem[] {
  let base = 0
  for (let i = 0; i < key.length; i++) base = (Math.imul(base, 31) + key.charCodeAt(i)) | 0
  const out: ShopItem[] = []
  for (let w = 0; w < WEAPONS.length; w++) {
    for (let n = 0; n < SHOP.perWeapon; n++) {
      /**
       * 무기 번호를 시드에 섞습니다. 안 섞으면 세 물건이 **전부 같은
       * 등급·같은 옵션**으로 나옵니다 — 같은 시드에서 같은 값이 나오는 것이
       * 이 시스템의 약속이니까요.
       */
      const seed = (Math.imul(base ^ 0x51ed270b, 1 + w * 7 + n * 131) | 0) >>> 0
      /**
       * ⚠️ **일반은 안 내놓습니다.**
       *
       * 일반은 옵션이 0개라 값도 0입니다 — 진열대에 놓으면 그건 물건이
       * 아니라 **빈칸**이고, 셋 중 하나가 늘 빈칸이면 상점이 그만큼
       * 작아집니다. (첫 실행에서 실제로 「일반 대검 · 불티 0」이 떴습니다.)
       *
       * 상자에는 일반이 나옵니다 — 거기서는 *"이번엔 꽝"* 이 굴림의 일부
       * 이니까요. 상점은 **값을 치르고 확실한 것을 사는 자리**라 성격이
       * 다릅니다.
       */
      const tier = Math.max(GearTier.Rare, rollTier(seed, Math.min(1, luck + SHOP.luckBonus)))
      out.push({
        weaponIndex: w,
        weaponName: WEAPONS[w].name,
        tier,
        tierName: tierDef(tier).name,
        tierColor: tierDef(tier).color,
        seed,
        price: gearPrice(tier, WEAPON_UPGRADE.costs),
        affixes: rollAffixes(seed, tier),
      })
    }
  }
  return out
}

/** 이 물건을 가리키는 이름 — 세이브가 *"이미 샀다"* 를 기억하는 열쇠. */
export function shopItemKey(anvilKey: string, item: ShopItem): string {
  return `${anvilKey}#${item.weaponIndex}#${item.seed}`
}
