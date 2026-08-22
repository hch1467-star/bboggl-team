/**
 * 세이브 — 무엇을 남기고 무엇을 날리는가.
 *
 * ── 이 파일에서 가장 중요한 것은 저장 기술이 아니라 **경계선**입니다 ──────
 *
 * "다 저장하면 되지 않나"가 첫 충동이지만, 그러면 게임이 망가집니다.
 * 적 체력과 위치까지 저장하면 죽기 직전 상태로 되살아나서 **죽음이 무의미**해지고,
 * 반대로 아무것도 저장 안 하면 지금처럼 **탐험이 무의미**해집니다.
 * 그래서 둘을 명시적으로 갈랐습니다:
 *
 * | 남깁니다 (성장·획득) | 날립니다 (전투 상태) |
 * |---|---|
 * | 각인석 · 트라이포드 선택 | 내 체력 · 스태미나 · 위치 |
 * | 획득한 룬 | 적의 체력 · 위치 · 생사 |
 * | 들고 있던 무기 | 쿨다운 · 웨이브 |
 * | 먹은 보물 | |
 *
 * 근거는 소울라이크의 관례이자 **우리 기둥에서 직접 나옵니다**:
 *
 *  · 기둥 4(탐험) — 숨긴 보물을 찾은 것은 반드시 남아야 합니다. 죽었다고
 *    다시 찾아야 하면 탐험은 작업이 되고, "손으로 숨긴 비밀"의 가치가 사라집니다.
 *  · 성장 설계 — 트라이포드는 "새로운 걸 할 수 있게 된 것"입니다. 이걸 잃게 하면
 *    플레이어는 실험을 멈추고 안전한 선택만 합니다. 우리가 원하는 건 반대입니다.
 *  · 반복 플레이 — 적은 **반드시 되살아나야** 합니다. 안 그러면 죽을 때마다
 *    남은 적이 줄어들어 "죽으면서 갈아 넣는 것"이 최적 전략이 됩니다.
 *
 * 한 줄로: **얻은 것은 남고, 싸움은 처음부터.**
 *
 * ── 아레나(전투 시험장)는 저장하지 않습니다 ────────────────────────────
 * 시험장에는 진행이라는 개념이 없습니다. 매번 같은 조건에서 손맛을 보는 곳이라
 * 저장이 오히려 방해가 됩니다.
 */

import { EMBER, VIAL, WEAPON_UPGRADE } from '../config/balance'
import { Loadout, Player } from '../core/components'
import { readLearnedActions, restoreLearnedActions } from './playerControl'
import { exportTripods, importTripods, type TripodSaveData } from './tripod'

/**
 * 스키마 버전.
 *
 * 게임이 계속 바뀌므로 옛 세이브가 새 코드에 들어오는 일이 반드시 생깁니다.
 * 그때 조용히 깨진 상태로 도는 것이 최악입니다 — 버그를 세이브 탓으로
 * 의심하지 못하게 되니까요. 버전이 다르면 **버리고 새로 시작**합니다.
 * (정식 출시 전까지는 마이그레이션보다 폐기가 정직합니다.)
 */
const SAVE_VERSION = 8

const KEY_PREFIX = 'qvarpg.save.'

export interface SaveData {
  version: number
  /** 어느 레벨의 진행인가 */
  levelId: string
  /** 마지막 저장 시각(표시용) */
  savedAt: number
  weapon: number
  rune0: number
  rune1: number
  runesOwned: number
  /** 이미 먹은 보물의 위치 키 */
  treasures: string[]
  tripods: TripodSaveData
  /**
   * 가진 불티와 성수병 강화 단계.
   *
   * **경계선의 어느 쪽인가**: 둘 다 "얻은 것"입니다.
   *  · 성수병 강화는 트라이포드와 같은 성장이라 당연히 남습니다.
   *  · 불티는 고민스러웠지만 남기기로 했습니다. 안 남기면 "게임을 끄기 전에
   *    반드시 다 써야 한다"가 되어, 아껴 두는 선택 자체가 불가능해집니다.
   *
   * 떨어뜨린 표식은 **남기지 않습니다.** 그건 전투 상태에 가깝고,
   * 다시 켰을 때 적이 전부 부활한 자리로 되찾으러 가는 건 불합리합니다.
   */
  embers: number
  vialsMax: number
  /**
   * 이미 잡은 보스의 위치 키.
   *
   * 경계선의 "남기는 쪽"입니다. 보스 처치는 **진행 그 자체**라서,
   * 다시 켤 때마다 되살아나면 앞으로 나아갔다는 사실이 사라집니다.
   * (일반 적은 반대로 반드시 되살아나야 합니다 — 위 표 참고.)
   */
  bosses: string[]
  /**
   * 내려둔 사다리의 위치 키.
   *
   * 경계선의 "남기는 쪽"입니다. 지름길은 **알아낸 것**이라 보물과 같은 편에 섭니다.
   * 다시 켤 때마다 걷혀 있으면, 세계의 생김새를 파악한 성과를 매번 빼앗는 셈입니다.
   * (반대로 사다리를 타고 지나간 적들은 당연히 되살아납니다 — 그건 싸움입니다.)
   */
  /**
   * 열려 있는 **지름길 열쇠**들(좌표 문자열).
   *
   * ⚠️ **이름이 「사다리」지만 사다리만 있는 게 아닙니다.** 금 간 벽도
   *    같은 목록에 들어옵니다 — 둘 다 `Shortcut` 이고, 「한 번 연 것은
   *    다시 닫히지 않는다」가 둘에 똑같이 적용되기 때문입니다
   *    (terrain.ts `Shortcut.kind`).
   *
   *    이름을 안 바꾸는 이유: 이 칸은 **이미 저장된 파일 안에** 있습니다.
   *    바꾸면 예전 세이브의 내려둔 사다리가 통째로 사라집니다 —
   *    「알아낸 것을 빼앗지 않는다」가 이 칸의 존재 이유인데 그걸 깨는 셈입니다.
   */
  ladders: string[]
  /**
   * 무기별 강화 단계 [무기0, 무기1, 무기2].
   *
   * 경계선의 "남기는 쪽"입니다. 불티를 태워서 얻은 것이고, 각인석과 같은
   * 성장이기 때문입니다. 여기서 날리면 죽을 때마다 무기가 도로 +0이 되어
   * **불티를 쓰는 것 자체가 손해**가 됩니다.
   */
  weaponLevels: number[]
  /**
   * 🏆 무기별 **등급**과 **옵션 시드**.
   *
   * ⚠️ 옵션 값 자체는 저장하지 않습니다 — 등급과 시드만 있으면
   *    `rollAffixes` 가 언제든 같은 것을 냅니다. 값을 박아 두면 옵션 표를
   *    손보는 날 **세이브만 옛 규칙**을 들고 있게 됩니다(gear.ts 주석).
   */
  /**
   * 🏪 **이미 산 상점 물건들.**
   *
   * 재고는 저장하지 않습니다 — 모루의 좌표에서 언제든 같은 것이 나옵니다.
   * 저장해야 하는 것은 *"무엇이 이미 팔렸는가"* 뿐이고, 그게 없으면
   * 다시 켤 때마다 같은 물건을 또 살 수 있습니다.
   */
  boughtItems: string[]
  weaponTiers: number[]
  weaponSeeds: number[]
  /**
   * 가진 정련석.
   *
   * 불티와 달리 **죽어도 잃지 않으므로** 여기 남기는 것에 망설임이 없습니다.
   * 파밍으로 못 얻는 것을 잃게 하면 되찾을 방법이 없어 막다른 길이 됩니다.
   */
  stones: number
  /**
   * 이미 **해낸** 조작들. 화면 아래 안내가 다시 안 뜨게 하려고 남깁니다.
   *
   * 진행(불티·강화)과 달리 이건 **손에 익은 것**이라 죽어도 안 잃습니다 —
   * 죽었다고 키를 잊지는 않으니까요.
   */
  learned: string[]
}

/**
 * 레벨 식별자. 이름만 쓰면 에디터에서 만든 "새 레벨"들이 전부 같은 칸을
 * 공유해 진행이 섞입니다. 크기까지 붙여 최소한의 구분을 만듭니다.
 */
export function levelIdOf(name: string, w: number, h: number): string {
  return `${name}|${w}x${h}`
}

/**
 * 보물 하나를 가리키는 키.
 *
 * 배열 인덱스를 쓰지 않는 이유: 에디터에서 보물을 하나 추가하거나 지우면
 * 뒤의 인덱스가 전부 밀려서, **먹지도 않은 보물이 먹은 것으로** 바뀝니다.
 * 위치는 그 보물을 옮기지 않는 한 변하지 않습니다.
 * 0.1m 단위로 반올림해 부동소수점 오차를 흡수합니다.
 */
export function treasureKey(x: number, z: number): string {
  return `${Math.round(x * 10)}:${Math.round(z * 10)}`
}

function storageKey(levelId: string): string {
  return KEY_PREFIX + levelId
}

function canStore(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

export function loadSave(levelId: string): SaveData | null {
  if (!canStore()) return null
  let raw: string | null = null
  try {
    raw = localStorage.getItem(storageKey(levelId))
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const d = JSON.parse(raw) as Partial<SaveData>
    // 버전이 다르면 조용히 무시합니다. 깨진 채로 도는 것보다 처음부터가 낫습니다.
    if (d.version !== SAVE_VERSION) return null
    if (d.levelId !== levelId) return null
    return {
      version: SAVE_VERSION,
      levelId,
      savedAt: Number(d.savedAt) || 0,
      weapon: Number(d.weapon) || 0,
      rune0: Number.isFinite(d.rune0) ? Number(d.rune0) : -1,
      rune1: Number.isFinite(d.rune1) ? Number(d.rune1) : -1,
      runesOwned: Number(d.runesOwned) || 0,
      treasures: Array.isArray(d.treasures) ? d.treasures.filter((t) => typeof t === 'string') : [],
      tripods: (d.tripods ?? { points: 0, unlocked: [], selections: {} }) as TripodSaveData,
      bosses: Array.isArray(d.bosses) ? d.bosses.filter((t) => typeof t === 'string') : [],
      ladders: Array.isArray(d.ladders) ? d.ladders.filter((t) => typeof t === 'string') : [],
      stones: Number(d.stones) || 0,
      learned: Array.isArray(d.learned) ? d.learned.filter((v) => typeof v === 'string') : [],
      boughtItems: Array.isArray(d.boughtItems) ? d.boughtItems.map(String) : [],
      weaponTiers: Array.isArray(d.weaponTiers)
        ? d.weaponTiers.slice(0, 3).map((v) => Number(v) || 0)
        : [0, 0, 0],
      weaponSeeds: Array.isArray(d.weaponSeeds)
        ? d.weaponSeeds.slice(0, 3).map((v) => Number(v) >>> 0)
        : [0, 0, 0],
      weaponLevels: Array.isArray(d.weaponLevels)
        ? d.weaponLevels.slice(0, 3).map((v) => Number(v) || 0)
        : [0, 0, 0],
      embers: Number(d.embers) || 0,
      vialsMax: Number(d.vialsMax) || 0,
    }
  } catch {
    return null
  }
}

export function writeSave(data: SaveData): boolean {
  if (!canStore()) return false
  try {
    localStorage.setItem(storageKey(data.levelId), JSON.stringify(data))
    return true
  } catch {
    // 용량 초과나 사생활 보호 모드. 게임은 계속 돌아야 하므로 삼킵니다.
    return false
  }
}

export function clearSave(levelId: string): void {
  if (!canStore()) return
  try {
    localStorage.removeItem(storageKey(levelId))
  } catch {
    /* 무시 */
  }
}

/** 지금 진행 상황을 그대로 모아 세이브 데이터로 만듭니다. */
export function captureSave(
  levelId: string,
  player: number,
  treasures: Set<string>,
  now: number,
  bosses: ReadonlySet<string> = new Set(),
  ladders: readonly string[] = [],
  bought: ReadonlySet<string> = new Set(),
): SaveData {
  return {
    version: SAVE_VERSION,
    levelId,
    savedAt: now,
    weapon: Loadout.weapon[player],
    rune0: Loadout.rune0[player],
    rune1: Loadout.rune1[player],
    runesOwned: Loadout.runesOwned[player],
    treasures: [...treasures],
    boughtItems: [...bought],
    weaponLevels: [Loadout.wLv0[player], Loadout.wLv1[player], Loadout.wLv2[player]],
    weaponTiers: [Loadout.wTier0[player], Loadout.wTier1[player], Loadout.wTier2[player]],
    weaponSeeds: [Loadout.wSeed0[player], Loadout.wSeed1[player], Loadout.wSeed2[player]],
    stones: Player.stones[player],
    learned: readLearnedActions(),
    bosses: [...bosses],
    ladders: [...ladders],
    tripods: exportTripods(),
    embers: Player.embers[player],
    vialsMax: Player.vialsMax[player],
  }
}

/** 세이브를 지금 막 만들어진 플레이어에게 적용합니다. */
export function applySave(save: SaveData, player: number): void {
  Loadout.weapon[player] = save.weapon
  Loadout.rune0[player] = save.rune0
  Loadout.rune1[player] = save.rune1
  Loadout.runesOwned[player] = save.runesOwned
  const lv = save.weaponLevels ?? []
  Loadout.wLv0[player] = Math.min(WEAPON_UPGRADE.maxLevel, lv[0] ?? 0)
  Loadout.wLv1[player] = Math.min(WEAPON_UPGRADE.maxLevel, lv[1] ?? 0)
  Loadout.wLv2[player] = Math.min(WEAPON_UPGRADE.maxLevel, lv[2] ?? 0)
  const tiers = save.weaponTiers ?? []
  const seeds = save.weaponSeeds ?? []
  Loadout.wTier0[player] = tiers[0] ?? 0
  Loadout.wTier1[player] = tiers[1] ?? 0
  Loadout.wTier2[player] = tiers[2] ?? 0
  Loadout.wSeed0[player] = (seeds[0] ?? 0) >>> 0
  Loadout.wSeed1[player] = (seeds[1] ?? 0) >>> 0
  Loadout.wSeed2[player] = (seeds[2] ?? 0) >>> 0
  Player.embers[player] = save.embers
  Player.stones[player] = save.stones ?? 0
  restoreLearnedActions(save.learned ?? [])
  // 0이면 예전 세이브 — 기본값을 그대로 둡니다(강화한 적이 없다는 뜻).
  if (save.vialsMax > 0) {
    Player.vialsMax[player] = Math.min(EMBER.vialMax, Math.max(VIAL.charges, save.vialsMax))
    Player.vials[player] = Player.vialsMax[player]
  }
  importTripods(save.tripods)
}
