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

/**
 * ── ⌨️ **한 키에 두 뜻이 붙지 않는다** ───────────────────────────────
 *
 * ── 왜 만들었나 (실제로 일어난 일) ─────────────────────────────────
 * 🛡 저스트 가드를 `V` 에 붙였습니다. 그런데 `V` 는 이 게임에서
 * *"이 자리에서 할 수 있는 일"* 하나로 묶인 **맥락 키**였습니다 —
 * 사다리 내리기와 화톳불에서 성수병 강화. main.ts 주석에 그 설계가
 * 분명히 적혀 있었고, 저는 그걸 읽고도 같은 키를 골랐습니다.
 *
 * 결과:
 *   · 봇이 사다리를 내리려고 V 를 누름 → **가드가 그 입력을 먼저 소비**
 *   · 사다리는 안 내려감 → 다시 누름 → **90프레임 무한 반복**
 *   · 누를 때마다 창이 열렸다 헛침 → **기력 18씩 → 0**
 *
 * 세 판 연속 같은 자리에서 같은 모양으로 갇혔고, 그동안 클리어 시간과
 * 기력 통계가 조용히 오염됐습니다.
 *
 * ── 왜 주석으로는 안 되는가 ────────────────────────────────────────
 * 이 파일 맨 위에 이미 적혀 있습니다:
 *
 *   > 주석은 읽는 사람에게만 말합니다.
 *   > 다시 안 틀리려면 **틀릴 자리를 없애야** 합니다.
 *
 * ── 맥락 키는 예외입니다 ───────────────────────────────────────────
 * `V` 가 사다리와 화톳불에 **둘 다** 붙어 있는 것은 의도된 설계입니다 —
 * 그 둘은 물리적으로 같은 자리에 못 있습니다. 그래서 "겹치면 무조건
 * 빨강"이 아니라, **맥락 키(main.ts)와 상시 키(playerControl.ts)가
 * 겹치면** 빨강입니다. 상시 키는 "그 자리에서만"이라는 전제를 깹니다.
 */
{
  const readKeys = (file) => {
    const src = readFileSync(path.join(HERE, '..', file), 'utf8')
    const noC = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    return new Set([...noC.matchAll(/consumePress\(\s*'([A-Za-z0-9]+)'\s*\)/g)].map((m) => m[1]))
  }
  /** 상시 키 — 언제나 그 뜻입니다(전투 동사). */
  const always = readKeys('src/systems/playerControl.ts')
  /** 맥락 키 — "이 자리에서 할 수 있는 일". 서로 겹쳐도 되지만 상시 키와는 안 됩니다. */
  const contextual = readKeys('src/main.ts')
  const clash = [...always].filter((k) => contextual.has(k))
  check(
    clash.length === 0,
    '상시 키(전투)와 맥락 키(그 자리에서)가 같은 키를 쓰지 않는다',
    clash.length === 0
      ? `상시 ${always.size}개 · 맥락 ${contextual.size}개`
      : `${clash.join(', ')} — 한쪽이 먼저 소비해서 다른 쪽이 조용히 안 먹습니다`,
  )
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
