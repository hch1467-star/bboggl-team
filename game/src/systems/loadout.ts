import { RUNE_ORDER, SKILLS, weaponAt, type SkillDef, type WeaponDef } from '../config/arsenal'
import { Loadout } from '../core/components'
import { time } from '../core/time'

/**
 * 장비 슬롯 조회 헬퍼.
 *
 * 슬롯 규약 (arsenal.ts 설계 노트):
 *   0 = 무기 스킬 1 (Q)   1 = 무기 스킬 2 (E)
 *   2 = 룬 슬롯 1  (R)   3 = 룬 슬롯 2  (F)
 *
 * 무기 슬롯은 무기를 바꿔야 바뀌고, 룬 슬롯은 탐험으로 얻은 것을 자유롭게 끼웁니다.
 * 이 파일이 그 규칙을 한 곳에 모아 두는 유일한 지점입니다.
 */

export const SLOT_COUNT = 4

export function weaponOf(e: number): WeaponDef {
  return weaponAt(Loadout.weapon[e])
}

export function skillIdForSlot(e: number, slot: number): string | null {
  if (slot === 0 || slot === 1) return weaponOf(e).skills[slot]
  const runeIndex = slot === 2 ? Loadout.rune0[e] : Loadout.rune1[e]
  if (runeIndex < 0 || runeIndex >= RUNE_ORDER.length) return null
  return RUNE_ORDER[runeIndex]
}

export function skillForSlot(e: number, slot: number): SkillDef | null {
  const id = skillIdForSlot(e, slot)
  return id ? (SKILLS[id] ?? null) : null
}

export function cooldownOf(e: number, slot: number): number {
  switch (slot) {
    case 0:
      return Loadout.cd0[e]
    case 1:
      return Loadout.cd1[e]
    case 2:
      return Loadout.cd2[e]
    default:
      return Loadout.cd3[e]
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
    default:
      Loadout.cd3[e] = value
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
}

/** 획득한 룬을 슬롯에 채웁니다. 빈 슬롯 우선, 둘 다 차 있으면 두 번째를 교체합니다. */
export function grantRune(e: number, runeIndex: number): void {
  if (Loadout.rune0[e] < 0) Loadout.rune0[e] = runeIndex
  else if (Loadout.rune1[e] < 0) Loadout.rune1[e] = runeIndex
  else Loadout.rune1[e] = runeIndex
  Loadout.runesOwned[e] = Math.max(Loadout.runesOwned[e], runeIndex + 1)
}

/** 보유한 룬들 사이에서 슬롯의 룬을 다음 것으로 돌립니다(프로토타입용 교체 수단). */
export function cycleRune(e: number, slot: 2 | 3): void {
  const owned = Loadout.runesOwned[e]
  if (owned <= 0) return
  const current = slot === 2 ? Loadout.rune0[e] : Loadout.rune1[e]
  const other = slot === 2 ? Loadout.rune1[e] : Loadout.rune0[e]
  // 같은 룬을 두 슬롯에 끼우면 슬롯 하나가 낭비되므로 건너뜁니다.
  let next = current
  for (let i = 0; i < owned; i++) {
    next = (next + 1) % owned
    if (next !== other) break
  }
  if (slot === 2) Loadout.rune0[e] = next
  else Loadout.rune1[e] = next
}
