import { RUNE_ORDER, weaponAt, type SkillDef, type WeaponDef } from '../config/arsenal'
import { resolveSkill } from './tripod'
import { Loadout } from '../core/components'
import { WEAPON_UPGRADE } from '../config/balance'
import { time } from '../core/time'

/**
 * 장비 슬롯 조회 헬퍼.
 *
 * 슬롯 규약 (arsenal.ts 설계 노트):
 *   0 = 무기 스킬 1 (Q)   1 = 무기 스킬 2 (E)   2 = 무기 스킬 3 (R)
 *   3 = 룬 슬롯 1  (F)   4 = 룬 슬롯 2  (G)
 *
 * 무기 슬롯은 무기를 바꿔야 바뀌고, 룬 슬롯은 탐험으로 얻은 것을 자유롭게 끼웁니다.
 * 이 파일이 그 규칙을 한 곳에 모아 두는 유일한 지점입니다.
 */

export const SLOT_COUNT = 5
/** 이 번호부터가 룬 슬롯입니다. 무기 스킬 개수와 항상 같아야 합니다. */
export const FIRST_RUNE_SLOT = 3

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
 * 강화가 곱해 주는 피해 배율.
 *
 * 기본 공격과 **그 무기의 스킬 세 개**에만 적용합니다. 룬 스킬(F·G)은
 * 무기가 아니라 각인이라 영향을 받지 않습니다 — 이 구분이 있어야
 * "무기를 키운다"와 "룬을 얻는다"가 서로 다른 성장으로 남습니다.
 */
export function weaponDamageMult(e: number): number {
  return 1 + weaponLevel(e) * WEAPON_UPGRADE.damagePerLevel
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
    default:
      return Loadout.cd4[e]
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
