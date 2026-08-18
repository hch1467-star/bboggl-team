import { RUNE_ORDER, weaponAt, type SkillDef, type WeaponDef } from '../config/arsenal'
import { resolveSkill } from './tripod'
import { Loadout } from '../core/components'
import { WEAPON_UPGRADE } from '../config/balance'
import { AffixKind, affixValue, rollAffixes, type Affix } from '../config/gear'
import { time } from '../core/time'

/**
 * 장비 슬롯 조회 헬퍼.
 *
 * 슬롯 규약 (arsenal.ts 설계 노트):
 *   0 = 무기 스킬 1 (Q)   1 = 무기 스킬 2 (E)   2 = 무기 스킬 3 (R)
 *   3 = 무기 기예   (C)   4 = 룬 슬롯 1  (F)   5 = 룬 슬롯 2  (G)
 *
 * ⚠️ **룬 슬롯 번호가 바뀌었습니다**(3·4 → 4·5). 그래서 이 규약을 숫자로
 *    베껴 쓴 곳이 있으면 조용히 어긋납니다. 아래 `FIRST_RUNE_SLOT` 하나만
 *    보게 되어 있는지가 이 파일의 존재 이유입니다.
 *
 * 무기 슬롯은 무기를 바꿔야 바뀌고, 룬 슬롯은 탐험으로 얻은 것을 자유롭게 끼웁니다.
 * 이 파일이 그 규칙을 한 곳에 모아 두는 유일한 지점입니다.
 */

export const SLOT_COUNT = 6
/** 이 번호부터가 룬 슬롯입니다. 무기 스킬 개수와 항상 같아야 합니다. */
export const FIRST_RUNE_SLOT = 4

/**
 * 지금 든 무기의 강화 단계.
 *
 * 슬롯이 아니라 **무기 인덱스**로 찾습니다. 무기를 바꾸면 강화도 같이
 * 바뀌어야 "무엇에 투자했는가"가 선택으로 남습니다.
 */
export function weaponLevel(e: number, weaponIndex = Loadout.weapon[e]): number {
  if (weaponIndex === 1) return Loadout.wLv1[e]
  if (weaponIndex === 2) return Loadout.wLv2[e]
  return Loadout.wLv0[e]
}

export function setWeaponLevel(e: number, weaponIndex: number, level: number): void {
  const v = Math.max(0, Math.min(WEAPON_UPGRADE.maxLevel, level))
  if (weaponIndex === 1) Loadout.wLv1[e] = v
  else if (weaponIndex === 2) Loadout.wLv2[e] = v
  else Loadout.wLv0[e] = v
}

/**
 * ── 🏆 **이 무기의 등급과 시드** ───────────────────────────────────
 *
 * 강화 단계(`weaponLevel`)와 **같은 모양**으로 둡니다 — 무기 인덱스로
 * 찾고, 무기를 바꾸면 같이 바뀝니다. 두 성장이 다른 방식으로 저장되면
 * "이 무기에 무엇을 했는가"를 두 군데서 물어야 합니다.
 */
export function weaponTier(e: number, weaponIndex = Loadout.weapon[e]): number {
  if (weaponIndex === 1) return Loadout.wTier1[e]
  if (weaponIndex === 2) return Loadout.wTier2[e]
  return Loadout.wTier0[e]
}

export function weaponSeed(e: number, weaponIndex = Loadout.weapon[e]): number {
  if (weaponIndex === 1) return Loadout.wSeed1[e]
  if (weaponIndex === 2) return Loadout.wSeed2[e]
  return Loadout.wSeed0[e]
}

/**
 * 무기에 새 등급·시드를 끼웁니다.
 *
 * ⚠️ **등급이 같거나 낮으면 안 바꿉니다.** 주운 것이 더 나쁘면 지금 것을
 *    잃는 셈인데, 그러면 상자를 여는 것이 **위험**이 됩니다. 탐험의
 *    보상은 위험이면 안 됩니다 — 이 게임이 위험을 파는 자리는 전투와
 *    낙차이지 상자가 아닙니다. (디아블로류가 인벤토리로 푸는 문제를,
 *    무기가 셋뿐인 이 게임에서는 **더 좋을 때만 갈아 끼우는** 것으로
 *    풉니다. 고르는 재미 대신 **잃지 않는 안심**을 택한 것이고,
 *    인벤토리를 넣는 날 다시 볼 자리입니다.)
 */
export function equipGear(e: number, weaponIndex: number, tier: number, seed: number): boolean {
  if (tier <= weaponTier(e, weaponIndex)) return false
  if (weaponIndex === 1) {
    Loadout.wTier1[e] = tier
    Loadout.wSeed1[e] = seed >>> 0
  } else if (weaponIndex === 2) {
    Loadout.wTier2[e] = tier
    Loadout.wSeed2[e] = seed >>> 0
  } else {
    Loadout.wTier0[e] = tier
    Loadout.wSeed0[e] = seed >>> 0
  }
  return true
}

/** 지금 든 무기에 붙은 옵션들. 저장된 값이 아니라 **규칙에서 다시** 냅니다. */
export function weaponAffixes(e: number, weaponIndex = Loadout.weapon[e]): Affix[] {
  return rollAffixes(weaponSeed(e, weaponIndex), weaponTier(e, weaponIndex))
}

/**
 * 강화가 곱해 주는 피해 배율.
 *
 * 기본 공격과 **그 무기의 스킬 세 개**에만 적용합니다. 룬 스킬(F·G)은
 * 무기가 아니라 각인이라 영향을 받지 않습니다 — 이 구분이 있어야
 * "무기를 키운다"와 "룬을 얻는다"가 서로 다른 성장으로 남습니다.
 *
 * 🏆 **등급 옵션의 ⚔️공격력도 여기서 같이 곱합니다.** 강화와 옵션이
 * 서로 다른 곳에서 곱해지면, "지금 내 피해가 왜 이 값인가"를 두 군데를
 * 뒤져야 알게 됩니다. 성장의 결과는 **한 함수**로 나와야 합니다.
 */
export function weaponDamageMult(e: number): number {
  const level = 1 + weaponLevel(e) * WEAPON_UPGRADE.damagePerLevel
  const gear = 1 + affixValue(weaponAffixes(e), AffixKind.Damage) / 100
  return level * gear
}

/**
 * ⚡ **동작이 빨라지는 배율**(1보다 작을수록 빠릅니다).
 *
 * 공속 옵션은 피해가 아니라 **시간**을 삽니다. 곱해지는 곳은
 * **선행동작과 후딜**이고 **판정(active)에는 안 곱합니다** — 이 게임의
 * 기존 템포 배율(`PLAYER.tempo.attackScale`)이 이미 그렇게 되어 있고,
 * 근거는 playerControl.ts `tempoOf` 에 적어 두었습니다.
 * 요약: 공속이 사는 것은 **기다리는 시간**이지 맞는 순간이 아닙니다.
 *
 * ⚠️ 하한 0.6 을 둡니다. 옵션 크기(최대 12 × 1.5 = 18%)로는 못 닿는
 *    값이지만, 옵션 표를 손보는 날 조용히 무너지지 않게 벽을 세워 둡니다.
 */
export function weaponSpeedScale(e: number): number {
  const pct = affixValue(weaponAffixes(e), AffixKind.Speed)
  return Math.max(0.6, 1 - pct / 100)
}

/** ⏱ 스킬 쿨다운에 곱하는 배율(1보다 작을수록 빨리 찹니다). 하한 0.5. */
export function weaponCooldownScale(e: number): number {
  const pct = affixValue(weaponAffixes(e), AffixKind.Cooldown)
  return Math.max(0.5, 1 - pct / 100)
}

/**
 * ✨ **타격마다 더해지는 고정 피해.**
 *
 * 비율이 아니라 고정값인 근거는 gear.ts `AFFIX_DEFS` 주석에 있습니다.
 * 요약: 비율은 센 무기를 더 세게 만들 뿐이라 네 옵션이 결국 하나가
 * 됩니다. 고정 피해만이 **타수가 많은 무기**에 다르게 붙습니다.
 */
export function weaponMagicFlat(e: number): number {
  return affixValue(weaponAffixes(e), AffixKind.Magic)
}

/**
 * 🗡 **이 무기로 이 기본 피해를 때리면 실제로 얼마인가.**
 *
 * 성장 셋(강화 · ⚔️공격력 · ✨마법)이 **한 식**에서 만납니다.
 *
 * ⚠️ 곱셈 하나만 있던 자리에 덧셈이 끼어들면, 부르는 쪽이 순서를 틀릴
 *    자리가 생깁니다(`base * mult + flat` 인가 `(base + flat) * mult` 인가).
 *    둘은 다른 게임이고, 그 판단이 네 군데로 흩어지면 언젠가 갈라집니다.
 *    **여기 한 곳**에서만 정합니다: 고정 피해는 배율을 안 받습니다 —
 *    ✨마법은 *"무기와 무관하게 얹히는 것"* 이라는 뜻이고, 그래야
 *    강화가 높은 무기에서 두 번 세지지 않습니다.
 */
export function weaponHit(e: number, base: number, weaponScaled = true): number {
  if (!weaponScaled) return base
  return base * weaponDamageMult(e) + weaponMagicFlat(e)
}

export function weaponOf(e: number): WeaponDef {
  return weaponAt(Loadout.weapon[e])
}

export function skillIdForSlot(e: number, slot: number): string | null {
  if (slot < FIRST_RUNE_SLOT) return weaponOf(e).skills[slot] ?? null
  const runeIndex = slot === FIRST_RUNE_SLOT ? Loadout.rune0[e] : Loadout.rune1[e]
  if (runeIndex < 0 || runeIndex >= RUNE_ORDER.length) return null
  return RUNE_ORDER[runeIndex]
}

/**
 * 이 슬롯의 **실효 스킬**. 트라이포드로 고른 변형이 이미 적용된 상태입니다.
 *
 * 전투 코드는 전부 이 함수 하나만 부릅니다. 덕분에 트라이포드가 있든 없든
 * 판정/조작 로직은 SkillDef 하나만 알면 됩니다(systems/tripod.ts 설계 노트).
 */
export function skillForSlot(e: number, slot: number): SkillDef | null {
  const id = skillIdForSlot(e, slot)
  return id ? resolveSkill(id) : null
}

export function cooldownOf(e: number, slot: number): number {
  switch (slot) {
    case 0:
      return Loadout.cd0[e]
    case 1:
      return Loadout.cd1[e]
    case 2:
      return Loadout.cd2[e]
    case 3:
      return Loadout.cd3[e]
    case 4:
      return Loadout.cd4[e]
    default:
      return Loadout.cd5[e]
  }
}

export function setCooldown(e: number, slot: number, value: number): void {
  switch (slot) {
    case 0:
      Loadout.cd0[e] = value
      break
    case 1:
      Loadout.cd1[e] = value
      break
    case 2:
      Loadout.cd2[e] = value
      break
    case 3:
      Loadout.cd3[e] = value
      break
    case 4:
      Loadout.cd4[e] = value
      break
    default:
      Loadout.cd4[e] = value
      break
  }
}

/**
 * 쿨다운을 흘립니다.
 *
 * time.dt(시뮬레이션 시간)를 쓰는 이유: 히트스톱 중에 쿨다운이 돌면
 * 세게 때릴수록(정지가 길수록) 쿨다운이 빨리 도는 이상한 일이 생깁니다.
 */
export function tickCooldowns(e: number): void {
  const dt = time.dt
  if (dt <= 0) return
  if (Loadout.cd0[e] > 0) Loadout.cd0[e] = Math.max(0, Loadout.cd0[e] - dt)
  if (Loadout.cd1[e] > 0) Loadout.cd1[e] = Math.max(0, Loadout.cd1[e] - dt)
  if (Loadout.cd2[e] > 0) Loadout.cd2[e] = Math.max(0, Loadout.cd2[e] - dt)
  if (Loadout.cd3[e] > 0) Loadout.cd3[e] = Math.max(0, Loadout.cd3[e] - dt)
  if (Loadout.cd4[e] > 0) Loadout.cd4[e] = Math.max(0, Loadout.cd4[e] - dt)
  if (Loadout.cd5[e] > 0) Loadout.cd5[e] = Math.max(0, Loadout.cd5[e] - dt)
}

/** 획득한 룬을 슬롯에 채웁니다. 빈 슬롯 우선, 둘 다 차 있으면 두 번째를 교체합니다. */
export function grantRune(e: number, runeIndex: number): void {
  if (Loadout.rune0[e] < 0) Loadout.rune0[e] = runeIndex
  else if (Loadout.rune1[e] < 0) Loadout.rune1[e] = runeIndex
  else Loadout.rune1[e] = runeIndex
  Loadout.runesOwned[e] = Math.max(Loadout.runesOwned[e], runeIndex + 1)
}

/** 보유한 룬들 사이에서 슬롯의 룬을 다음 것으로 돌립니다(프로토타입용 교체 수단). */
export function cycleRune(e: number, slot: 3 | 4): void {
  const owned = Loadout.runesOwned[e]
  if (owned <= 0) return
  const current = slot === FIRST_RUNE_SLOT ? Loadout.rune0[e] : Loadout.rune1[e]
  const other = slot === FIRST_RUNE_SLOT ? Loadout.rune1[e] : Loadout.rune0[e]
  // 같은 룬을 두 슬롯에 끼우면 슬롯 하나가 낭비되므로 건너뜁니다.
  let next = current
  for (let i = 0; i < owned; i++) {
    next = (next + 1) % owned
    if (next !== other) break
  }
  if (slot === FIRST_RUNE_SLOT) Loadout.rune0[e] = next
  else Loadout.rune1[e] = next
}
