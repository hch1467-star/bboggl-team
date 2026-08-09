/**
 * 적 종류 표 — 종류 하나당 한 줄.
 *
 * ── 왜 이 파일이 생겼는가 ───────────────────────────────────────────
 * 지금까지 코드 곳곳에 `isBoss ? BOSS : GRUNT` 가 흩어져 있었습니다.
 * 불리언은 **종류가 정확히 둘일 때만** 성립합니다. 셋째가 생기는 순간
 * 그 조건문들은 전부 조용히 **"보스가 아니면 잡몹"** 이라고 잘못 답합니다.
 * 오류도 안 나고 화면도 그럴듯해서, 얽는 자가 잡몹의 체력·속도·공격을
 * 그대로 쓰고 있어도 알아채기 어렵습니다.
 *
 * 그래서 새 적을 추가하기 **전에** 불리언을 표로 바꿨습니다.
 * 새 적을 하나 더 넣을 때 손대야 하는 곳이 이 파일 한 줄이 되도록.
 *
 * (Unity 이식 노트: 이 표의 한 항목이 EnemyDefinition.asset 하나가 됩니다.)
 */
import { ARCHER, BINDER, BOSS, CHARGER, DRAGGER, GRUNT } from './balance'
import { EnemyKind } from '../core/components'

/**
 * 모든 종류가 공통으로 갖는 수치.
 *
 * `keepDistance` 만 선택 항목입니다 — 근접 적에게는 의미가 없고,
 * 0으로 두면 "거리 0을 유지한다"는 뜻이 되어 헷갈립니다.
 */
export interface EnemyDef {
  /** 저장·표시용 식별자 */
  id: string
  name: string
  maxHp: number
  radius: number
  height: number
  moveSpeed: number
  turnSpeedDeg: number
  backReactionDelay: number
  aggroRange: number
  attackRange: number
  attackCooldown: number
  windup: number
  active: number
  recovery: number
  damage: number
  attackArcDeg: number
  attackReach: number
  knockback: number
  hurtStagger: number
  /** 몸 색. 예고 4색과 겹치면 안 됩니다(아래 주석 참고). */
  color: number
  /**
   * 이 거리보다 가까우면 **물러납니다.** 없으면 근접형입니다.
   * 원거리 적에게 이게 없으면 그냥 걸어 들어와 약한 잡몹이 됩니다.
   */
  keepDistance?: number
  /**
   * 처치했을 때 주는 불티.
   *
   * **위험 대비**로 매깁니다. 얽는 자·끄는 자는 체력이 낮아 죽이기는 쉽지만,
   * 살려두면 전투 전체가 어려워집니다. 그래서 잡몹보다 많이 줍니다 —
   * "먼저 뭘 죽일까"라는 판단에 **보상까지 얹어** 방향을 분명히 합니다.
   */
  /**
   * 강인도. 이만큼 깎이면 무너집니다.
   *
   * 기준: 롱소드 기본 콤보 3타의 강인도 피해 합이 약 30입니다.
   *   잡몹 30    — 한 콤보를 온전히 넣으면 무너짐
   *   특수 20    — 더 쉽게 끊김(원거리 적을 끊는 건 쉬워야 함)
   *   보스 105   — 세 콤보 이상. 예고 중에 끊으면 훨씬 빨라집니다.
   */
  poiseMax: number
  ember: number
  /** 타격했을 때의 손맛 배율 — 큰 적일수록 크게 */
  hitstop: number
  trauma: number
  heavy: boolean
}

/**
 * 몸 색 배정 규칙: **예고 4색(빨/노/파/보)과 겹치면 안 됩니다.**
 *
 * 보스가 보라색이던 첫 판에서, 보라 예고(끌어당김)가 깔리자 보스 몸과 바닥이
 * 같은 색으로 뭉쳐 어디가 보스이고 어디가 장판인지 구분이 안 됐습니다.
 * 그래서 적은 전부 **붉은 계열**로 묶고, 종류는 **명도와 채도**로 가릅니다.
 *
 * 색만으로 구분하게 두지도 않았습니다 — 키와 굵기(radius/height)를 함께
 * 벌려서, 색이 안 보여도 **실루엣으로** 읽히게 했습니다.
 *   잡몹   1.70m 보통 굵기 · 밝은 적색
 *   얽는 자 2.05m 가늘고 큼 · 흐린 적색   ← 제일 키가 큼
 *   끄는 자 1.55m 낮고 넓음 · 어두운 장미  ← 제일 납작함
 *   보스   2.90m 아주 큼   · 어두운 진홍
 */
export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  [EnemyKind.Grunt]: {
    id: 'grunt',
    name: '잡몹',
    ...GRUNT,
    poiseMax: 30,
    ember: 8,
    color: 0xc0453f,
    hitstop: 0.05,
    trauma: 0.34,
    heavy: false,
  },
  [EnemyKind.Boss]: {
    id: 'boss',
    name: '보스',
    ...BOSS,
    poiseMax: 105,
    ember: 220,
    color: 0x7a2733,
    hitstop: 0.1,
    trauma: 0.62,
    heavy: true,
  },
  [EnemyKind.Binder]: {
    id: 'binder',
    name: '얽는 자',
    ...BINDER,
    poiseMax: 20,
    ember: 14,
    color: 0x9c5f57,
    hitstop: 0.05,
    trauma: 0.3,
    heavy: false,
  },
  [EnemyKind.Dragger]: {
    id: 'dragger',
    name: '끄는 자',
    ...DRAGGER,
    poiseMax: 20,
    ember: 14,
    color: 0x7d3340,
    hitstop: 0.05,
    trauma: 0.3,
    heavy: false,
  },
  [EnemyKind.Archer]: {
    id: 'archer',
    name: '쏘는 자',
    ...ARCHER,
    /**
     * 강인도 14 — 가장 낮습니다. **붙기만 하면 금방 무너집니다.**
     *
     * 이 적의 정답은 "붙어라"인데, 붙고 나서도 오래 버티면 정답을 지킨
     * 대가가 없습니다. 낮은 강인도가 그 보상입니다 — 붙으면 무너지고,
     * 무너지면 처형이 나갑니다.
     */
    poiseMax: 14,
    ember: 12,
    // 다른 적보다 밝고 차갑게 — 멀리 있는 실루엣이 배경에 묻히면
    // "저기서 쏘고 있다"를 못 읽습니다.
    color: 0x8fb3c9,
    hitstop: 0.05,
    trauma: 0.28,
    heavy: false,
  },
  [EnemyKind.Charger]: {
    id: 'charger',
    name: '달려드는 자',
    ...CHARGER,
    // 강인도를 높게(45) 둔 이유: 반격 말고 **연타로도 예고를 끊을 수 있으면**
    // 초록이 "그냥 세게 때리면 되는 색"이 되어 새 동사가 안 배워집니다.
    poiseMax: 45,
    ember: 18,
    color: 0x3f7a52,
    hitstop: 0.06,
    trauma: 0.36,
    heavy: false,
  },
}

export function enemyDef(kind: number): EnemyDef {
  return ENEMY_DEFS[kind as EnemyKind] ?? ENEMY_DEFS[EnemyKind.Grunt]
}

/** 레벨 파일에 적힌 문자열 → EnemyKind. 없으면 null(적이 아님). */
/**
 * 레벨 파일의 문자열 id → EnemyKind.
 *
 * ⚠️ **표를 돌립니다.** 예전에는 종류를 손으로 나열했는데, 그런 목록은
 * 새 적을 넣을 때 조용히 빠집니다 — 실제로 렌더 쪽에서 같은 일이
 * 일어났습니다(visuals.ts renderKindForEnemy 설계 노트). 여기서 빠지면
 * **레벨에 배치했는데 안 나오는** 적이 됩니다.
 */
export function kindFromId(id: string): EnemyKind | null {
  for (const k of Object.keys(ENEMY_DEFS).map(Number) as EnemyKind[]) {
    if (ENEMY_DEFS[k].id === id) return k
  }
  return null
}
