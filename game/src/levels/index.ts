import { parseLevel, type LevelData } from '../level/format'
import brokenGate from './broken-gate.json'

/**
 * 게임에 함께 배포되는 레벨들.
 *
 * 에디터로 만든 레벨은 브라우저 저장소(localStorage)에 있어서 그 사람 브라우저에만
 * 남습니다. 링크를 열면 누구나 같은 콘텐츠를 플레이하려면 **번들에 넣어야** 합니다.
 *
 * 원본은 tools/make-zone.mjs 가 생성한 순수 JSON입니다.
 * 에디터에서 `JSON 가져오기`로 열어 손으로 다듬은 뒤 다시 내보내면 그대로 교체됩니다.
 */
const BUNDLED: Record<string, unknown> = {
  'broken-gate': brokenGate,
}

export const DEFAULT_LEVEL_ID = 'broken-gate'

export function loadBundledLevel(id: string): LevelData | null {
  const raw = BUNDLED[id]
  if (!raw) return null
  const result = parseLevel(JSON.stringify(raw))
  if ('error' in result) {
    console.error(`번들 레벨 "${id}" 을(를) 읽지 못했습니다: ${result.error}`)
    return null
  }
  return result.level
}

export function bundledLevelIds(): string[] {
  return Object.keys(BUNDLED)
}
