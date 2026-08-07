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

import { Loadout } from '../core/components'
import { exportTripods, importTripods, type TripodSaveData } from './tripod'

/**
 * 스키마 버전.
 *
 * 게임이 계속 바뀌므로 옛 세이브가 새 코드에 들어오는 일이 반드시 생깁니다.
 * 그때 조용히 깨진 상태로 도는 것이 최악입니다 — 버그를 세이브 탓으로
 * 의심하지 못하게 되니까요. 버전이 다르면 **버리고 새로 시작**합니다.
 * (정식 출시 전까지는 마이그레이션보다 폐기가 정직합니다.)
 */
const SAVE_VERSION = 1

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
    tripods: exportTripods(),
  }
}

/** 세이브를 지금 막 만들어진 플레이어에게 적용합니다. */
export function applySave(save: SaveData, player: number): void {
  Loadout.weapon[player] = save.weapon
  Loadout.rune0[player] = save.rune0
  Loadout.rune1[player] = save.rune1
  Loadout.runesOwned[player] = save.runesOwned
  importTripods(save.tripods)
}
