/**
 * 트라이포드 적용 — 기본 스킬 + 선택한 변형 = **실효 스킬**.
 *
 * ── 왜 별도 시스템인가 ─────────────────────────────────────────────
 * 전투 코드(combat.ts, playerControl.ts)는 지금까지 `SkillDef` 하나만 알면 됐습니다.
 * 트라이포드가 붙었다고 그 코드들이 "선택지가 뭐지?"를 따지기 시작하면,
 * 전투 로직 곳곳에 조건문이 퍼져서 손댈 수 없게 됩니다.
 *
 * 그래서 **경계를 하나로 좁힙니다.** `skillForSlot()` 이 이미 합성된 스킬을
 * 돌려주고, 전투 코드는 전과 똑같이 SkillDef 하나만 봅니다.
 * 트라이포드를 나중에 통째로 들어내도 전투 코드는 한 줄도 안 바뀝니다.
 *
 * ── 선택은 전역에 저장합니다 ───────────────────────────────────────
 * ECS 컴포넌트에 넣지 않은 이유: 선택은 **플레이어의 진행 상황**이지
 * 엔티티의 프레임 단위 상태가 아닙니다. 죽어서 리셋돼도 남아야 하고,
 * 나중에 세이브 파일로 나갈 값입니다. 성격이 다른 데이터는 다른 곳에 둡니다.
 */

import { SKILLS, type SkillDef } from '../config/arsenal'
import { TRIPOD_TIERS, tripodsFor, type TripodMods } from '../config/tripods'

/** skillId -> 단계별 선택 (-1 = 아직 안 고름) */
const selections = new Map<string, number[]>()

/** 쓸 수 있는 트라이포드 포인트. 보물 하나당 1점. */
let points = 0

/** 이미 해금한 (스킬, 단계) — 포인트를 한 번만 쓰게 합니다. */
const unlocked = new Set<string>()

/** 합성 결과 캐시. 매 프레임 판정마다 새 객체를 만들면 GC가 돕니다. */
const resolvedCache = new Map<string, SkillDef>()

function key(skillId: string, tier: number): string {
  return `${skillId}#${tier}`
}

export function resetTripods(): void {
  selections.clear()
  unlocked.clear()
  resolvedCache.clear()
  points = 0
}

export function tripodPoints(): number {
  return points
}

export function grantTripodPoint(n = 1): void {
  points += n
}

export function selectionsFor(skillId: string): number[] {
  let sel = selections.get(skillId)
  if (!sel) {
    sel = new Array<number>(TRIPOD_TIERS).fill(-1)
    selections.set(skillId, sel)
  }
  return sel
}

export function isTierUnlocked(skillId: string, tier: number): boolean {
  return unlocked.has(key(skillId, tier))
}

/**
 * 단계를 해금하고 선택지를 고릅니다.
 *
 * **아래 단계부터 순서대로** 열어야 합니다. 3단계(변형)를 첫 보물로 바로 열 수
 * 있으면, 플레이어는 항상 3단계만 열게 되고 1·2단계는 존재 이유가 사라집니다.
 * 순서를 강제해야 "무엇을 먼저 키울까"라는 선택이 유지됩니다.
 *
 * @returns 성공 여부 (포인트 부족 / 순서 위반 / 이미 해금이면 false)
 */
export function unlockTripod(skillId: string, tier: number, option: number): boolean {
  const tiers = tripodsFor(skillId)
  if (!tiers) return false
  if (tier < 0 || tier >= TRIPOD_TIERS) return false
  if (option < 0 || option >= tiers[tier].options.length) return false
  if (isTierUnlocked(skillId, tier)) return false
  if (tier > 0 && !isTierUnlocked(skillId, tier - 1)) return false
  if (points <= 0) return false

  points--
  unlocked.add(key(skillId, tier))
  selectionsFor(skillId)[tier] = option
  resolvedCache.delete(skillId)
  return true
}

/**
 * 이미 연 단계 안에서 선택지를 바꿉니다. **포인트를 쓰지 않습니다.**
 *
 * 재배치를 유료로 만들면 플레이어는 실험을 안 하고 공략을 찾아봅니다.
 * 우리가 원하는 건 "이것도 해볼까"라서, 바꾸는 것은 공짜로 둡니다.
 * (얻는 것은 비싸게, 바꾸는 것은 싸게)
 */
export function switchTripod(skillId: string, tier: number, option: number): boolean {
  const tiers = tripodsFor(skillId)
  if (!tiers || !isTierUnlocked(skillId, tier)) return false
  if (option < 0 || option >= tiers[tier].options.length) return false
  selectionsFor(skillId)[tier] = option
  resolvedCache.delete(skillId)
  return true
}

/**
 * ── 🧩 **부품이 이 스킬에서 «뜻이 있는가»** ────────────────────────────
 *
 * 「나만의 스킬」(DESIGN.md 의 제안 절)로 가려면 부품이 스킬에 **붙박이가
 * 아니어야** 합니다. 같은 부품이 다른 스킬에 들어가야 사람마다 다른 빌드가
 * 나옵니다. 그런데 아무 데나 끼우게 두면 **아무 일도 안 일어나는 조합**이
 * 생깁니다 — 「긴 도약(돌진 +2.5m)」을 돌진이 없는 스킬에 끼우는 식으로요.
 *
 * 그러면 플레이어는 **자기가 뭘 했는지 모릅니다.** 이 게임의 원칙
 * (*"게이머가 스스로 잘한다고 느끼게"*)과 정면으로 부딪힙니다 — 고른 것이
 * 화면에서 아무것도 안 바꾸면 «내가 만든 스킬»이 아니라 «안 되는 걸 고른»
 * 경험이 됩니다.
 *
 * ── 태그를 손으로 안 답니다 ────────────────────────────────────────
 * 부품마다 *"이건 돌진 스킬 전용"* 이라고 적어 두면 **규칙이 두 곳에**
 * 생깁니다(부품 표 · 스킬 표). 대신 **계산합니다**: 부품이 건드리는 값을
 * 그 스킬이 실제로 갖고 있는지 보면 됩니다.
 *
 * ⚠️ 이 표는 바로 아래 `applyMods` 와 **같은 칸을 다뤄야** 합니다. 한쪽에만
 *    칸이 늘면, 새 부품이 **아무 데나 끼워지면서 아무 일도 안 하게** 됩니다 —
 *    `lungeSpeed`(선언·주석·분기는 있는데 값이 없어 조용히 아무 일도 안 하던
 *    자리)와 같은 모양입니다. 그래서 `npm run guard` 가 둘을 대조합니다.
 */
const MOD_NEEDS: Record<keyof TripodMods, (s: SkillDef) => boolean> = {
  // 값이 있어야 배수가 뜻을 갖습니다 — 0에 곱하면 0입니다.
  damageMult: (s) => s.damage > 0,
  cooldownMult: (s) => s.cooldown > 0,
  knockbackMult: (s) => s.knockback > 0,
  traumaMult: (s) => s.trauma > 0,
  windupMult: (s) => s.windup > 0,
  recoveryMult: (s) => s.recovery > 0,
  // 더하기는 0에서 시작해도 뜻이 있습니다 — 없던 것이 생깁니다.
  rangeAdd: () => true,
  hitsAdd: () => true,
  moveScaleAdd: () => true,
  iFrames: () => true,
  shape: () => true,
  // 🔑 **여기가 이 표의 존재 이유입니다.** 없던 돌진·속박을 «더해» 봐야
  //    그 스킬에는 돌진 구간도 속박 판정도 없어서 화면에서 아무 일도
  //    안 일어납니다. 원래 있는 스킬에만 붙습니다.
  dashAdd: (s) => s.dash > 0,
  snareAdd: (s) => s.snare > 0,
  // 부채꼴을 넓히는 것은 **부채꼴일 때만** 뜻이 있습니다.
  arcAdd: (s) => s.shape === 'cone',
}

/**
 * 이 부품을 이 스킬에 끼울 수 있는가 — **건드리는 칸이 전부 뜻이 있어야**
 * 합니다. 하나라도 헛돌면 «아무것도 안 바뀌는 조합»이 되므로 막습니다.
 */
export function partFitsSkill(mods: TripodMods, skill: SkillDef): boolean {
  for (const key of Object.keys(mods) as (keyof TripodMods)[]) {
    if (mods[key] === undefined) continue
    const needs = MOD_NEEDS[key]
    // 표에 없는 칸이면 **막습니다.** 모르면 끼우게 두는 쪽이 위험합니다 —
    // 조용히 아무 일도 안 하는 조합이 생기니까요. (가드가 이 경우를 미리 잡습니다.)
    if (!needs || !needs(skill)) return false
  }
  return true
}

function applyMods(base: SkillDef, mods: TripodMods): SkillDef {
  const out: SkillDef = { ...base }
  if (mods.shape) out.shape = mods.shape
  if (mods.damageMult !== undefined) out.damage *= mods.damageMult
  if (mods.cooldownMult !== undefined) out.cooldown *= mods.cooldownMult
  if (mods.rangeAdd !== undefined) out.range = Math.max(0.3, out.range + mods.rangeAdd)
  if (mods.arcAdd !== undefined) out.arcDeg = Math.min(360, Math.max(10, out.arcDeg + mods.arcAdd))
  if (mods.hitsAdd !== undefined) out.hits = Math.max(1, out.hits + mods.hitsAdd)
  if (mods.knockbackMult !== undefined) out.knockback *= mods.knockbackMult
  // 🔨 강인도 피해 — combat.ts applyPoise 가 이 값으로 강인도를 깎습니다.
  if (mods.traumaMult !== undefined) out.trauma *= mods.traumaMult
  if (mods.windupMult !== undefined) out.windup = Math.max(0.02, out.windup * mods.windupMult)
  if (mods.recoveryMult !== undefined) out.recovery = Math.max(0.05, out.recovery * mods.recoveryMult)
  if (mods.moveScaleAdd !== undefined) {
    out.moveScale = Math.min(1, Math.max(0, out.moveScale + mods.moveScaleAdd))
  }
  if (mods.dashAdd !== undefined) out.dash = Math.max(0, out.dash + mods.dashAdd)
  if (mods.snareAdd !== undefined) out.snare = Math.max(0, out.snare + mods.snareAdd)
  if (mods.iFrames) out.iFrames = mods.iFrames
  return out
}

/**
 * 기본 스킬에 선택한 변형을 전부 얹은 **실효 스킬**을 돌려줍니다.
 * 아무것도 안 골랐으면 원본을 그대로 돌려줍니다(객체 복사조차 하지 않습니다).
 */
export function resolveSkill(skillId: string): SkillDef | null {
  const base = SKILLS[skillId]
  if (!base) return null

  const cached = resolvedCache.get(skillId)
  if (cached) return cached

  const tiers = tripodsFor(skillId)
  const sel = selections.get(skillId)
  if (!tiers || !sel) return base

  let out: SkillDef | null = null
  for (let t = 0; t < TRIPOD_TIERS; t++) {
    const pick = sel[t]
    if (pick < 0 || !isTierUnlocked(skillId, t)) continue
    out = applyMods(out ?? base, tiers[t].options[pick].mods)
  }
  if (!out) return base
  resolvedCache.set(skillId, out)
  return out
}

/**
 * 세이브에 실리는 형태.
 *
 * 내부 자료구조(Map/Set)를 그대로 JSON으로 못 내보내므로 평평하게 폅니다.
 * 그리고 **내부 구조가 바뀌어도 이 모양은 유지**해야 옛 세이브가 살아남습니다 —
 * 그래서 저장 형식을 내부 표현과 분리해 둡니다.
 */
export interface TripodSaveData {
  points: number
  /** "스킬id#단계" 목록 */
  unlocked: string[]
  /** 스킬id -> 단계별 선택 */
  selections: Record<string, number[]>
}

export function exportTripods(): TripodSaveData {
  const out: Record<string, number[]> = {}
  for (const [skillId, sel] of selections) {
    // 아무것도 안 고른 스킬은 저장하지 않습니다 — 세이브가 쓸데없이 커집니다.
    if (sel.some((v) => v >= 0)) out[skillId] = [...sel]
  }
  return { points, unlocked: [...unlocked], selections: out }
}

export function importTripods(data: TripodSaveData | null | undefined): void {
  resetTripods()
  if (!data) return
  points = Math.max(0, Number(data.points) || 0)
  for (const k of data.unlocked ?? []) {
    if (typeof k === 'string') unlocked.add(k)
  }
  for (const [skillId, sel] of Object.entries(data.selections ?? {})) {
    if (!Array.isArray(sel)) continue
    const target = selectionsFor(skillId)
    for (let i = 0; i < Math.min(TRIPOD_TIERS, sel.length); i++) {
      const v = Number(sel[i])
      target[i] = Number.isFinite(v) ? v : -1
    }
  }
  resolvedCache.clear()
}

/** UI가 읽는 요약. 어느 단계가 열렸고 무엇을 골랐는지. */
export interface TripodStatus {
  skillId: string
  skillName: string
  tiers: {
    title: string
    unlocked: boolean
    /** 이 단계를 지금 열 수 있는가 (포인트 있음 + 앞 단계 열림) */
    affordable: boolean
    selected: number
    options: { id: string; name: string; desc: string }[]
  }[]
}

export function tripodStatus(skillId: string): TripodStatus | null {
  const tiers = tripodsFor(skillId)
  const base = SKILLS[skillId]
  if (!tiers || !base) return null
  const sel = selectionsFor(skillId)
  return {
    skillId,
    skillName: base.name,
    tiers: tiers.map((tier, t) => ({
      title: tier.title,
      unlocked: isTierUnlocked(skillId, t),
      affordable: points > 0 && (t === 0 || isTierUnlocked(skillId, t - 1)) && !isTierUnlocked(skillId, t),
      selected: sel[t],
      options: tier.options.map((o) => ({ id: o.id, name: o.name, desc: o.desc })),
    })),
  }
}
