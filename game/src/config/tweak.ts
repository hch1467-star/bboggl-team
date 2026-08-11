/**
 * ── 설정 덮어쓰기 (실험 전용) ──────────────────────────────────────
 *
 * `?tweak=PLAYER.dodge.cancelExtraCost=9999` 처럼 붙이면 그 값 하나만
 * 바꿔서 켭니다. 여러 개는 콤마로 잇습니다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────
 * A/B 를 여러 번 돌렸는데 **한 번도 결론을 못 냈습니다.** 매번 범위가
 * 겹쳤고, 원인은 게임이 아니라 재는 방식이었습니다:
 *
 *   · 설정을 바꾸려면 **다른 커밋의 실험대**가 필요했습니다(git worktree).
 *     그래서 A 를 4판 몰아 돌리고 B 를 4판 몰아 돌렸습니다.
 *   · 그런데 이 기계는 **판이 갈수록 느려집니다.** 한 벤치 안에서
 *     452 → 593 → 692초로 흘렀습니다. 즉 **나중에 돈 쪽이 불리합니다.**
 *     A/B 의 차이에 기계의 드리프트가 통째로 얹힙니다.
 *
 * 한 프로세스 안에서 설정을 바꿀 수 있으면 **번갈아** 돌릴 수 있고,
 * 그러면 드리프트가 양쪽에 똑같이 걸립니다. 짝을 지어 빼면 드리프트가
 * 상쇄됩니다. 그게 이 파일의 존재 이유입니다.
 *
 * ── 조용히 실패하지 않습니다 ───────────────────────────────────
 * 이 프로젝트에서 가장 비싼 고장은 **아무 말도 안 하는 계측기**였습니다.
 * 오타 난 경로를 조용히 무시하면 "A/B 를 돌렸는데 두 판이 사실 같았다"가
 * 되고, 그건 틀린 답보다 나쁩니다. 그래서 못 찾은 경로는 **던집니다.**
 */

/** 파싱된 덮어쓰기 목록. 경로 → 값. */
const requested = new Map<string, number>()

if (typeof location !== 'undefined') {
  const raw = new URLSearchParams(location.search).get('tweak')
  if (raw) {
    for (const part of raw.split(',')) {
      const [path, value] = part.split('=')
      if (!path || value === undefined) throw new Error(`tweak 형식이 잘못됐습니다: "${part}"`)
      const n = Number(value)
      if (!Number.isFinite(n)) throw new Error(`tweak 값이 숫자가 아닙니다: "${part}"`)
      requested.set(path.trim(), n)
    }
  }
}

/** 이번 판에 실제로 덮어쓴 것 — 보고서가 "무엇을 바꿔 돌렸나"를 적을 수 있게. */
const applied: { path: string; from: number; to: number }[] = []

export function appliedTweaks(): { path: string; from: number; to: number }[] {
  return applied.map((a) => ({ ...a }))
}

/**
 * 설정 뿌리들을 받아 요청된 경로를 덮어씁니다.
 *
 * 설정 파일 **맨 아래**에서 부릅니다. 그래야 그 파일을 가져다 쓰는 쪽이
 * 모듈 초기화 때 값을 붙잡아 두더라도(예: `const TEMPO = PLAYER.tempo.x`)
 * 이미 바뀐 값을 잡습니다. import 순서에 기대면 포매터가 줄을 옮기는
 * 날 조용히 깨집니다.
 */
export function applyTweaks(roots: Record<string, unknown>): void {
  for (const [path, value] of requested) {
    const parts = path.split('.')
    const rootName = parts[0]
    if (!(rootName in roots)) continue // 다른 설정 파일 담당일 수 있습니다.
    let obj = roots[rootName] as Record<string, unknown>
    for (let i = 1; i < parts.length - 1; i++) {
      const next = obj?.[parts[i]]
      if (typeof next !== 'object' || next === null) {
        throw new Error(`tweak 경로를 못 찾았습니다: ${path} (${parts[i]} 에서 막힘)`)
      }
      obj = next as Record<string, unknown>
    }
    const leaf = parts[parts.length - 1]
    const before = obj?.[leaf]
    if (typeof before !== 'number') {
      throw new Error(`tweak 대상이 숫자가 아닙니다: ${path}`)
    }
    obj[leaf] = value
    applied.push({ path, from: before, to: value })
    requested.delete(path)
  }
}

/**
 * 아무도 안 가져간 경로가 남아 있으면 **던집니다.**
 *
 * 설정 파일들이 각자 `applyTweaks` 를 부르고 난 뒤 마지막에 한 번 부릅니다.
 * 오타(`PLAYER.dodge.cancelExtracost`)를 조용히 넘기면 A 와 B 가 사실
 * 같은 설정으로 돌아가고, 그 벤치는 "차이 없음"을 **정확하게 틀리게**
 * 보고합니다.
 */
export function assertAllTweaksApplied(): void {
  if (requested.size === 0) return
  throw new Error(`tweak 경로를 아무도 못 알아들었습니다: ${[...requested.keys()].join(', ')}`)
}
