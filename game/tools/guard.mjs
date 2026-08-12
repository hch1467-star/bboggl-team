/**
 * 브라우저 안으로 안 넘어가는 값 잡기 — `npm run guard`
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * 이 저장소의 도구들은 판단 고리를 **브라우저 안에서** 돌립니다
 * (`page.evaluate`). 그 안에서는 Node 쪽 `import` 나 모듈 상수가 **안
 * 보입니다.** 참조하면 `ReferenceError` 로 그 자리에서 죽습니다.
 *
 * 저는 이 실수를 **두 번** 했습니다:
 *
 *   1. `OLD_FLANK` — 봇 정책 스위치. 네 판(약 40분)이 통째로 날아갔습니다.
 *      고치고 **경고 주석까지 적어 뒀습니다.**
 *   2. `DETOUR_BUDGET` — 곁길 예산. 그 주석을 적어 둔 바로 그 파일에서
 *      **똑같이** 반복했고, 벤치 4판이 3~9초 만에 전부 죽었습니다.
 *
 * 이 저장소가 스스로 적어 둔 문장 그대로입니다:
 *
 *   > 주석은 읽는 사람에게만 말합니다.
 *   > 다시 안 틀리려면 **틀릴 자리를 없애야** 합니다.
 *
 * 그래서 기계가 봅니다. 게임을 켜지 않으므로 **1초 안에** 끝납니다 —
 * 40분짜리 측정을 걸기 전에 돌릴 수 있어야 의미가 있습니다.
 *
 * ── 어떻게 보는가 ──────────────────────────────────────────────
 * 모듈 맨 바깥에 선언된 이름들을 모으고, `page.evaluate(...)` 블록 안에서
 * 그 이름이 **인자로 안 넘어왔는데** 쓰이면 잡습니다.
 *
 * ⚠️ 파서가 아니라 괄호 세기입니다. 놓치는 경우가 있을 수 있지만,
 *    **실제로 두 번 일어난 그 모양**은 확실히 잡습니다. 완벽한 검사보다
 *    "이미 두 번 데인 자리를 막는 검사"가 먼저입니다.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** `page.evaluate(` 부터 괄호가 닫히는 데까지를 통째로 떠냅니다. */
function evaluateBlocks(src) {
  const out = []
  let i = 0
  for (;;) {
    const at = src.indexOf('page.evaluate(', i)
    if (at < 0) break
    let depth = 0
    let j = at + 'page.evaluate'.length
    for (; j < src.length; j++) {
      const c = src[j]
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) break
      }
    }
    out.push({ start: at, text: src.slice(at, j + 1) })
    i = j + 1
  }
  return out
}

/**
 * 모듈 맨 바깥에 있는 이름들 — 선언과 **import 둘 다**.
 *
 * ⚠️ 처음엔 `const|let|var` 만 모았습니다. 그래서 진짜 버그를 되살려 놓고
 *    돌렸는데 **아무 말도 안 했습니다** — 실제로 데인 두 번 중 하나가
 *    `import { DETOUR_BUDGET }` 였고, import 는 선언이 아니라서 목록에
 *    없었습니다. 막으려고 만든 검사가 정작 그 사건을 못 잡은 것입니다.
 *    **되살려 보지 않았으면 통과를 믿었을 것입니다.**
 */
function moduleScopeNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1])
  }
  for (const m of src.matchAll(/^import\s+([^'"]+?)\s+from\s+/gm)) {
    for (const part of m[1].replace(/[{}]/g, ' ').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return names
}

/** 화살표 함수의 구조분해 인자 이름들 — 이건 브라우저 안에서 보입니다. */
function paramNames(block) {
  const m = block.match(/\(\s*(?:async\s*)?\(?\s*\[([^\]]*)\]/)
  if (!m) return new Set()
  return new Set(
    m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

console.log('\n🛡  브라우저 안으로 안 넘어가는 값 잡기\n')

const files = readdirSync(HERE).filter((f) => f.endsWith('.mjs') && f !== 'guard.mjs')
const hits = []
for (const f of files) {
  const src = readFileSync(path.join(HERE, f), 'utf8')
  const scope = moduleScopeNames(src)
  if (scope.size === 0) continue
  for (const b of evaluateBlocks(src)) {
    const params = paramNames(b.text)
    /**
     * 화살표 **몸통만** 봅니다.
     *
     * ⚠️ 처음엔 `=>` 뒤 전부를 몸통으로 봤다가 다섯 건을 헛짚었습니다.
     *    `page.evaluate(fn, [A, B])` 의 **꼬리 인자 배열**은 Node 쪽 코드인데
     *    그것까지 몸통에 넣고 "브라우저에서 A 를 참조한다"고 읽은 것입니다.
     *    (계측기가 또 엉뚱한 것을 재고 있었습니다.) 꼬리를 잘라냅니다.
     */
    const bodyAt = b.text.indexOf('=>')
    let body = bodyAt < 0 ? b.text : b.text.slice(bodyAt)
    body = body.replace(/,\s*\[[\s\S]*\]\s*,?\s*\)\s*$/, '')  // 꼬리 쉼표까지
    /** 블록 **안에서** 선언된 같은 이름은 남의 이름이 아닙니다. */
    const localNames = new Set(
      [...body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    )
    for (const name of scope) {
      if (params.has(name) || localNames.has(name)) continue
      // 함수 선언은 브라우저로 통째로 직렬화되지 않으므로 상수만 봅니다.
      const re = new RegExp(`(^|[^\\w$.])${name}([^\\w$]|$)`)
      if (!re.test(body)) continue
      const line = src.slice(0, b.start).split('\n').length
      hits.push(`${f}:${line} 안에서 \`${name}\` — 인자로 안 넘어갑니다`)
    }
  }
}

check(
  hits.length === 0,
  '`page.evaluate` 안에서 모듈 상수를 참조하지 않는다 (브라우저에는 안 보입니다)',
  hits.length === 0 ? `${files.length}개 파일 확인` : hits.join(' · '),
)

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
