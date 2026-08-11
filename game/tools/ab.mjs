/**
 * 짝지어 비교 — `npm run ab -- <tweak> [짝수]`
 *
 *   npm run ab -- PLAYER.dodge.cancelExtraCost=9999 4
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * A/B 를 여러 번 돌렸는데 **한 번도 결론을 못 냈습니다.** 매번 범위가
 * 겹쳤고, 원인은 게임이 아니라 재는 방식이었습니다.
 *
 * 예전 방식은 설정마다 실험대(git worktree)를 따로 만들어 **A 를 몰아
 * 돌리고 B 를 몰아 돌리는** 것이었습니다. 그런데 이 기계는 판이 갈수록
 * 느려집니다 — 한 벤치 안에서 452 → 593 → 692초로 흘렀습니다.
 * 즉 **나중에 돈 쪽이 불리합니다.** A/B 의 차이에 기계의 드리프트가
 * 통째로 얹히고, 그 드리프트가 우리가 만든 차이보다 큽니다.
 *
 * ── 그래서 짝을 짓습니다 ────────────────────────────────────────
 * A → B → A → B 로 **번갈아** 돌립니다. 붙어 있는 A 와 B 는 기계 상태가
 * 거의 같으므로, 그 **짝 안에서 뺀 값**에는 드리프트가 상쇄됩니다.
 *
 * 그리고 중앙값 대신 **부호를 셉니다.** 짝 4개에서 B 가 4번 다 나쁘면,
 * 값이 얼마나 나쁜지와 무관하게 "우연히 그럴 확률 1/16" 입니다.
 * 편차가 큰 계측기에서 크기를 다투는 것보다 방향을 세는 쪽이 정직합니다.
 *
 * ⚠️ 그래도 **증명은 아닙니다.** 짝 4개면 한쪽으로 몰릴 확률이 12.5%
 *    (양쪽 합쳐서)입니다. 우연이라기엔 좁지만 논문에 쓸 값은 아닙니다.
 *    이 도구는 "겹쳐서 아무 말도 못 하던 것"을 "방향은 이쪽 같다"로
 *    바꿔 줄 뿐입니다. 그 이상으로 읽지 마세요.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const TWEAK = process.argv[2]
const PAIRS = Math.max(2, Math.min(8, Number(process.argv[3]) || 3))

if (!TWEAK || !TWEAK.includes('=')) {
  console.log('\n사용법: npm run ab -- <경로=값>[,<경로=값>…] [짝수]')
  console.log('예:     npm run ab -- PLAYER.dodge.cancelExtraCost=9999 4\n')
  process.exit(1)
}

/** 짝 안에서 비교할 값들. 낮을수록 쉬움/좋음인지 방향도 같이 적습니다. */
const METRICS = [
  { key: 'damageTaken', name: '받은 피해', lowerIsEasier: true },
  { key: 'deaths', name: '사망', lowerIsEasier: true },
  { key: 'clearedAt', name: '클리어 시간', lowerIsEasier: true, onlyIfCleared: true },
  { key: 'kills', name: '처치', lowerIsEasier: false },
]

const dir = mkdtempSync(path.join(os.tmpdir(), 'ab-'))
const runs = []

console.log(`\n⚖️  짝지어 비교 — ${PAIRS}쌍 (A=현재 · B=${TWEAK})\n`)

function once(label, tweak) {
  const out = path.join(dir, `${label}-${runs.length}.json`)
  const t0 = Date.now()
  const env = { ...process.env, PLAY_JSON: out }
  if (tweak) env.PLAY_TWEAK = tweak
  else delete env.PLAY_TWEAK
  const r = spawnSync('node', ['tools/playthrough.mjs'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
    timeout: 15 * 60 * 1000,
  })
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  if (r.status !== 0 || !existsSync(out)) return { ok: false, secs }
  const log = JSON.parse(readFileSync(out, 'utf8'))
  return { ok: true, secs, log, wallCut: !!log.wallStopped }
}

for (let i = 0; i < PAIRS; i++) {
  process.stdout.write(`  ${i + 1}/${PAIRS}쌍  A… `)
  const a = once('A', null)
  process.stdout.write(`${a.ok ? `${a.secs}초` : '실패'} · B… `)
  const b = once('B', TWEAK)
  console.log(b.ok ? `${b.secs}초` : '실패')
  /**
   * 한쪽이라도 못 끝난 짝은 **통째로 버립니다.** 반쪽만 쓰면 짝을 지은
   * 의미가 사라집니다 — 드리프트를 상쇄하려고 짝을 짓는 것이니까요.
   */
  if (!a.ok || !b.ok || a.wallCut || b.wallCut) {
    console.log('     ⏱️ 한쪽이 못 끝났습니다 — 이 짝은 버립니다 (반쪽은 짝이 아닙니다)')
    continue
  }
  runs.push({ a: a.log, b: b.log })
}
rmSync(dir, { recursive: true, force: true })

if (runs.length < 2) {
  console.log(`\n❌ 쓸 수 있는 짝이 ${runs.length}개뿐이라 비교할 수 없습니다\n`)
  process.exit(1)
}

console.log(`\n  쓸 수 있는 짝 ${runs.length}개\n`)
const tweaked = runs[0].b.tweaks ?? []
if (tweaked.length) {
  for (const t of tweaked) console.log(`  [B] ${t.path}  ${t.from} → ${t.to}`)
} else {
  console.log('  ⚠️ B 판에 덮어쓴 설정이 기록되지 않았습니다 — 정말 바뀌었는지 확인하세요')
}
console.log('')

for (const m of METRICS) {
  const usable = runs.filter(
    (p) => !m.onlyIfCleared || (p.a.clearedAt > 0 && p.b.clearedAt > 0),
  )
  if (usable.length < 2) {
    console.log(`  ${m.name.padEnd(10)} 짝이 모자라 건너뜁니다 (${usable.length}개)`)
    continue
  }
  const diffs = usable.map((p) => (p.b[m.key] ?? 0) - (p.a[m.key] ?? 0))
  const up = diffs.filter((d) => d > 0).length
  const down = diffs.filter((d) => d < 0).length
  const same = diffs.filter((d) => d === 0).length
  /**
   * **부호가 갈리면 방향도 없는 것**입니다. 한쪽으로 다 몰렸을 때만
   * 이야기가 됩니다 — 그리고 그때도 "증명"이 아니라 "방향"입니다.
   */
  const lean = up === diffs.length ? 'B가 큼' : down === diffs.length ? 'B가 작음' : '갈림'
  const chance = up === diffs.length || down === diffs.length ? ` (한쪽으로 다 몰릴 확률 ${(2 / 2 ** diffs.length * 100).toFixed(1)}%)` : ''
  console.log(
    `  ${m.name.padEnd(10)} 짝별 차이(B−A) ${diffs.map((d) => (d > 0 ? `+${d}` : `${d}`)).join(', ')}` +
      `  →  ${lean}${chance}` +
      (same ? ` · 같음 ${same}개` : ''),
  )
}

console.log(
  '\n  ⚠️ 이 도구는 **증명이 아니라 방향**을 줍니다. 짝이 적으면 우연히' +
    ' 몰릴 수 있습니다.\n',
)
