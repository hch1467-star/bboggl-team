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
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
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
    /**
     * ⚠️ **꼬리 앞의 주석까지 건너뜁니다.**
     *
     * 처음 정규식은 `,` 바로 뒤에 `[` 가 오는 것만 잘랐습니다. 그런데
     * 인자 배열 앞에 **설명 주석**을 단 파일이 생기자 꼬리를 못 잘랐고,
     * 배열 안에 적힌 상수 이름을 *"브라우저에서 참조한다"* 고 읽었습니다 —
     * 위 ⚠️ 가 적어 둔 그 헛짚음이 **주석 하나로 되살아난** 것입니다.
     * 규칙은 맞았는데 **읽는 법이 무른** 자리였습니다.
     */
    body = body.replace(/,\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*\[[\s\S]*\]\s*,?\s*\)\s*$/, '')
    /**
     * ⚠️ **주석을 지우고 봅니다 — 주석 속 이름은 참조가 아닙니다.**
     *
     * 봇의 문턱을 상수로 빼면서 *"이 값이 `SHORTCUT_WORTH` 입니다"* 라고
     * **브라우저 쪽 주석에** 적었더니 이 검사가 빨개졌습니다. 인자로는
     * 제대로 넘기고 있었는데도요 — 즉 **고쳐진 코드를 안 고쳐졌다고**
     * 말한 것입니다. 주석은 실행되지 않으므로 지우고 보는 것이 맞습니다.
     *
     * ⚠️ 문자열 안의 `//`(URL 등)까지 지워질 수 있습니다. 그건 **못 잡는
     *    쪽**(거짓 음성)으로만 틀리므로, 잘못 잡는 것보다 낫습니다 —
     *    이 검사의 값어치는 *"빨간불이 뜨면 진짜다"* 에 있습니다.
     */
    body = body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
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
  /**
   * ⚠️ **리터럴만 보면 검사가 조용히 약해집니다.**
   *
   * 가드 키를 `GUARD.key` 상수로 빼자마자 이 검사가 세는 상시 키가
   * **10개 → 9개**로 줄었습니다. 코드는 멀쩡한데 **검사만 눈이 멀었습니다.**
   * 이 파일이 막으려는 실패 모드가 정확히 그것입니다.
   *
   * 그래서 두 가지를 합니다:
   *   ① `config/balance.ts` 에 선언된 `key: 'KeyX'` 도 상시 키로 셉니다.
   *   ② 리터럴도 상수도 아닌 `consumePress(...)` 가 있으면 **못 읽었다고
   *      빨갛게 말합니다.** 조용히 빠뜨리는 것보다 낫습니다.
   */
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  /** config 에 선언된 키들 — `key: 'KeyZ'` 와 `NAME = ['KeyQ', ...]` 둘 다 읽습니다. */
  const configText = ['src/config/balance.ts', 'src/config/arsenal.ts']
    .map((f) => strip(readFileSync(path.join(HERE, '..', f), 'utf8')))
    .join('\n')
  const configKeys = new Set(
    [...configText.matchAll(/\bkey:\s*'([A-Za-z0-9]+)'/g)].map((m) => m[1]),
  )
  /** 배열 선언 — 스킬 키(QERFG)가 여기 있습니다. 이름별로 담아 둡니다. */
  /**
   * 홑 상수 — `export const TRAVEL_KEY = 'KeyZ'` 처럼 **키 하나를 담은
   * 이름**. 맥락 키를 config 로 빼면 이 모양이 되는데, 예전 규칙은
   * `X.key` 와 배열만 읽어서 이걸 *"못 읽었다"* 로 빨갛게 냈습니다.
   *
   * 이름을 `TRAVEL.key` 로 억지로 바꿔 규칙에 맞추는 것이 아니라 **읽는
   * 쪽을 넓힙니다** — 검사가 코드의 모양을 강제하기 시작하면, 다음 사람은
   * 검사를 피하려고 이상한 이름을 짓게 됩니다.
   */
  const singleKeys = new Map()
  for (const m of configText.matchAll(/\b([A-Z][A-Z0-9_]*)\s*=\s*'((?:Key|Digit|Mouse|Arrow|Shift|Space|Tab|F\d)[A-Za-z0-9]*)'/g)) {
    singleKeys.set(m[1], m[2])
  }
  const keyArrays = new Map()
  for (const m of configText.matchAll(/\b([A-Z_]+)\s*=\s*\[([^\]]*)\]/g)) {
    const items = [...m[2].matchAll(/'([A-Za-z0-9]+)'/g)].map((x) => x[1])
    if (
      items.length > 0 &&
      items.every((k) => /^(Key|Digit|Mouse|Arrow|Shift|Space|Tab|F\d)/.test(k))
    ) {
      keyArrays.set(m[1], items)
    }
  }
  const unresolved = []
  const readKeys = (file, allowConst) => {
    const noC = strip(readFileSync(path.join(HERE, '..', file), 'utf8'))
    const out = new Set()
    for (const m of noC.matchAll(/consumePress\(\s*([^)]*?)\s*\)/g)) {
      const arg = m[1].trim()
      const lit = /^'([A-Za-z0-9]+)'$/.exec(arg)
      if (lit) {
        out.add(lit[1])
      } else if (allowConst && /^[A-Z_]+(?:\.[A-Za-z]+)*\.key$/.test(arg)) {
        // `GUARD.key` · `PLAYER.dodge.key` 같은 선언 — config 에서 읽은 키들을 전부 상시로 봅니다.
        for (const k of configKeys) out.add(k)
      } else if (singleKeys.has(arg)) {
        // `TRAVEL_KEY` 같은 홑 상수 — 그 키 **하나만** 더합니다.
        // (`X.key` 와 달리 무엇인지 정확히 아니까 뭉뚱그리지 않습니다.)
        out.add(singleKeys.get(arg))
      } else if (allowConst && keyArrays.has(arg.replace(/\[.*$/, ''))) {
        // `SKILL_KEY_CODES[i]` 같은 배열 접근 — 그 배열의 키 전부가 상시 키입니다.
        for (const k of keyArrays.get(arg.replace(/\[.*$/, ''))) out.add(k)
      } else {
        unresolved.push(`${file}: consumePress(${arg})`)
      }
    }
    return out
  }
  /** 상시 키 — 언제나 그 뜻입니다(전투 동사). */
  const always = readKeys('src/systems/playerControl.ts', true)
  /** 맥락 키 — "이 자리에서 할 수 있는 일". 서로 겹쳐도 되지만 상시 키와는 안 됩니다. */
  const contextual = readKeys('src/main.ts', false)
  check(
    unresolved.length === 0,
    '모든 `consumePress` 인자를 읽어냈다 (못 읽으면 아래 검사가 조용히 약해집니다)',
    unresolved.join(' · ') || `상수 선언 ${configKeys.size}개 포함`,
  )
  const clash = [...always].filter((k) => contextual.has(k))
  check(
    clash.length === 0,
    '상시 키(전투)와 맥락 키(그 자리에서)가 같은 키를 쓰지 않는다',
    clash.length === 0
      ? `상시 ${always.size}개 · 맥락 ${contextual.size}개`
      : `${clash.join(', ')} — 한쪽이 먼저 소비해서 다른 쪽이 조용히 안 먹습니다`,
  )
}

/**
 * ── 🗺 **생성기와 지도가 갈라져 있지 않은가** ────────────────────────
 *
 * ── 무엇을 발견했는가 ───────────────────────────────────────────
 * `tools/make-zone.mjs` 를 그대로 돌려 보고 게임이 읽는
 * `src/levels/broken-gate.json` 과 견줘 봤더니 **크게 달랐습니다**:
 *
 *     사라짐: 사다리 1개 · 보물 2개 자리 · 적 4마리 자리
 *     지형과 구역도 다름
 *
 * **사다리가 사라지는 것**이 특히 위험합니다 — 지름길은 이 존을 원으로
 * 만드는 장치이고 `climb`·`retry`·`secret` 프로브가 전부 그걸 봅니다.
 * 즉 누군가 `npm run zone` 을 한 번 돌리는 것만으로 내용이 조용히
 * 없어집니다.
 *
 * 더 나쁜 것은 **주석이 거짓말을 하고 있다**는 점입니다. 생성기에는
 * *"실측으로 옮긴 자리"* 라는 긴 근거들이 달려 있는데, 그 자리들이
 * 게임에 들어가 있지 않습니다. 읽는 사람은 지도가 그렇게 생겼다고
 * 믿게 됩니다.
 *
 * 생성기 파일 자신이 이미 같은 위험을 반대 방향으로 적어 뒀습니다 —
 * *"손으로 고친 것이 코드에 없으면 다음 생성이 그걸 지웁니다."*
 * 이제 그 일이 실제로 벌어져 있고, **아무도 소리를 안 내고 있었습니다.**
 *
 * 여기서는 고치지 않습니다(어느 쪽이 옳은지는 설계 판단입니다).
 * 대신 **갈라졌다는 사실 자체를 빨간 불로** 만듭니다.
 */
{
  const shipped = JSON.parse(
    readFileSync(path.join(HERE, '..', 'src/levels/broken-gate.json'), 'utf8'),
  )
  const tmp = mkdtempSync(path.join(tmpdir(), 'zonecheck-'))
  const r = spawnSync('node', ['tools/make-zone.mjs'], {
    cwd: path.join(HERE, '..'),
    env: { ...process.env, ZONE_OUT_DIR: tmp },
    stdio: 'ignore',
  })
  /**
   * ⚠️ 생성기가 **출력 경로를 안 받으면** 진짜 지도를 덮어씁니다.
   *    그래서 덮어썼는지부터 확인하고, 덮어썼으면 되돌립니다.
   *    (검사가 검사 대상을 바꾸면 그 숫자는 게임의 것이 아닙니다.)
   */
  const after = readFileSync(path.join(HERE, '..', 'src/levels/broken-gate.json'), 'utf8')
  const shippedText = JSON.stringify(shipped)
  if (after !== shippedText) {
    writeFileSync(path.join(HERE, '..', 'src/levels/broken-gate.json'), shippedText)
  }
  const genPath = existsSync(path.join(tmp, 'broken-gate.json'))
    ? path.join(tmp, 'broken-gate.json')
    : null
  const gen = genPath ? JSON.parse(readFileSync(genPath, 'utf8')) : JSON.parse(after)
  rmSync(tmp, { recursive: true, force: true })

  const key = (e) => `${e.kind}@${e.x},${e.z}`
  const A = new Set(shipped.entities.map(key))
  const B = new Set(gen.entities.map(key))
  const lost = [...A].filter((k) => !B.has(k))
  const added = [...B].filter((k) => !A.has(k))
  /**
   * 얼마나 갈라졌는지까지 셉니다 — *"다르다"* 만으로는 다음 사람이
   * 무엇부터 손대야 할지 못 정합니다. 실제로 재 보니 아주 작았습니다:
   * 지형은 6336칸 중 **12칸**뿐이고, 나머지는 구역 하나가 둘로 쪼개진
   * 것과 사다리 하나입니다. 즉 **되살릴 수 있는 크기**입니다.
   */
  let cells = 0
  const ha = shipped.heights ?? []
  const hb = gen.heights ?? []
  for (let i = 0; i < Math.max(ha.length, hb.length); i++) if (ha[i] !== hb[i]) cells++
  const rA = (shipped.regions ?? []).map((x) => x.name)
  const rB = (gen.regions ?? []).map((x) => x.name)
  const rLost = rA.filter((n) => !rB.includes(n))
  const ok = r.status === 0 && lost.length === 0 && added.length === 0 && cells === 0 && rLost.length === 0
  check(
    ok,
    '`npm run zone` 을 돌려도 지도가 그대로다 (생성기와 실제 지도가 안 갈라졌다)',
    ok
      ? `배치 ${A.size}개 · 지형 · 구역 모두 일치`
      : `지형 ${cells}/${ha.length}칸 다름 · 잃는 배치 ${lost.length}개 [${lost.slice(0, 3).join(' ')}] · 잃는 구역 [${rLost.join(', ') || '없음'}]`,
  )
}

/**
 * ── 🕳 **표본이 비면 저절로 초록이 되는 검사** ────────────────────────
 *
 * `[].every(...)` 는 **참**입니다. 그래서
 *
 *     check(rows.every((r) => r.ok), '전부 통과했다')
 *
 * 는 `rows` 가 비어 있으면 **아무것도 안 재고 초록**입니다. 측정이 실패한
 * 판(적이 안 나왔다 · 예고를 못 봤다 · 훅이 빈 배열을 줬다)이 정확히
 * *"완벽하게 통과"* 로 보입니다.
 *
 * 이 저장소가 이미 세 번 데인 모양입니다 — 그때마다 *"빈 장부로 통과하지
 * 않게"* 라는 짝 검사를 손으로 붙여서 막았습니다. 손으로 붙이는 것은
 * 붙이는 것을 잊는 날 뚫립니다. **기계가 봅니다.**
 *
 * 규칙: 프로브의 `.every(` 는 같은 판정 안에서 **표본이 비지 않았음**을
 * 함께 확인해야 합니다(`xs.length > 0 && xs.every(...)` 또는 바로 앞
 * 줄에서 길이를 검사). 완벽한 파서가 아니라 **이미 데인 모양**을 막습니다.
 *
 * ⚠️ 게임 코드(`src/`)는 보지 않습니다. 거기서 `.every` 는 판정이 아니라
 *    보통 로직이고, *"비면 참"* 이 옳은 경우가 많습니다. 이 규칙이 말하는
 *    것은 **검사는 증거 없이 통과하면 안 된다**는 것뿐입니다.
 */
{
  const probes = readdirSync(HERE).filter((f) => f.endsWith('.mjs') && f !== 'guard.mjs')
  const holes = []
  for (const f of probes) {
    const src = readFileSync(path.join(HERE, f), 'utf8')
    const lines = src.split('\n')
    /**
     * ⚠️ **`check(` 안에 있는 것만 봅니다.**
     *
     * 처음엔 파일의 모든 `.every(` 를 봤더니 `PLAN.filter((k) => band.every(...))`
     * 같은 **평범한 로직**까지 잡혔습니다. 거기서는 *"비면 참"* 이 옳습니다.
     * 이 규칙이 말하는 것은 하나뿐입니다 — **검사는 증거 없이 통과하면 안 된다.**
     * 그러니 판정문 안에 있는 것만 봅니다.
     */
    lines.forEach((line, i) => {
      if (!/\.every\(/.test(line)) return
      // 배열 **리터럴**은 빌 수가 없습니다 — `[A, B, C].every(...)` 는 규칙 밖입니다.
      if (/\]\s*\.every\(/.test(line)) return
      // 이 줄이 어떤 `check(` 의 인자인가 — 위로 최대 6줄까지 거슬러 봅니다.
      let inCheck = false
      for (let k = i; k >= Math.max(0, i - 6); k--) {
        if (/^\s*check\(/.test(lines[k])) {
          inCheck = true
          break
        }
        // 다른 문장이 시작됐으면 그 위는 이 판정과 무관합니다.
        if (k < i && /^\s*(const|let|for|if|return|\})/.test(lines[k])) break
      }
      if (!inCheck) return
      // 판정 안에서 표본의 크기를 함께 확인했는가 (같은 줄 · 앞 세 줄).
      const around = [lines[i - 3] ?? '', lines[i - 2] ?? '', lines[i - 1] ?? '', line].join(' ')
      if (!/\.length\s*(>|>=|===|!==)/.test(around)) {
        holes.push(`${f}:${i + 1} ${line.trim().slice(0, 68)}`)
      }
    })
  }
  check(
    holes.length === 0,
    '🕳 프로브의 `.every(` 가 **빈 표본으로 통과하지 않는다** (증거 없는 초록 금지)',
    holes.length ? `${holes.length}곳 — ${holes.slice(0, 4).join(' | ')}` : `${probes.length}개 파일 확인`,
  )

  /**
   * ── 🧪 **켠 실험 스위치는 끄고 나간다** ──────────────────────────────
   *
   * ── 왜 생겼는가 (한 프로브가 몇 라운드 동안 거짓말을 했습니다) ──────
   * `npm run crowd` 의 오사 실험이 *"플레이어가 죽어서 관측이 끊기지 않게"*
   * `setPlayerInvulnerable(true)` 를 켰습니다. 그리고 **안 껐습니다.**
   * 그 뒤의 모든 판이 **안 맞는 플레이어**로 돌았고, 「대응이 결과를
   * 바꾸는가」 표는 이렇게 찍혔습니다:
   *
   *     가만히 서 있음 : 100 / 100
   *     계속 걸어서 이탈 : 100 / 100
   *
   * 두 줄을 보고 *"다대일 전투가 위협이 아니다"* 라고 읽을 뻔했습니다.
   * 같은 배치를 따로 돌려 보니 **10초에 100 → 47** 이었습니다 —
   * 게임은 멀쩡했고 스위치 하나가 켜진 채였을 뿐입니다.
   *
   * 이 종류는 **한 번 새면 그 뒤 전부를 조용히 오염시킵니다.** 그래서
   * 개별 프로브의 주의력이 아니라 규칙으로 막습니다: 켠 파일은 끄는 줄도
   * 가지고 있어야 합니다. (끄는 줄이 없는데 켠 줄만 있으면 빨강입니다.)
   *
   * ── ⚠️ **처음엔 `freezeEnemies` 까지 넣었다가 뺐습니다** ──────────────
   * 넣고 돌리니 네 곳이 빨개졌는데(aim · intent-preview · landmark ·
   * place-treasures) 전부 **파일 맨 앞에서 한 번 얼리고 끝까지 그대로**
   * 였습니다. 그건 새는 것이 아니라 그 프로브의 **모드**입니다.
   * 규칙이 옳은 것을 빨갛게 만들면 사람이 규칙을 끄게 됩니다.
   *
   * 남긴 둘은 성격이 다릅니다 — 이름부터 *"이 한 번만"* 이라는 뜻이고,
   * 켜진 채로 다음 측정에 넘어가면 그 측정이 **거짓이 되는데도 초록**
   * 입니다(무적이면 체력이, 붙들린 기력이면 소모가 안 움직입니다).
   */
  const SWITCHES = ['setPlayerInvulnerable', 'pinStamina']
  const leaks = []
  for (const f of probes) {
    const src = readFileSync(path.join(HERE, f), 'utf8')
    for (const sw of SWITCHES) {
      const on = new RegExp(`${sw}\\(\\s*(true|[0-9])`).test(src)
      const off = new RegExp(`${sw}\\(\\s*(false|null)`).test(src)
      if (on && !off) leaks.push(`${f} — ${sw} 를 켜기만 합니다`)
    }
  }
  check(
    leaks.length === 0,
    '🧪 프로브가 **켠 실험 스위치를 끄고 나간다** (다음 판을 조용히 오염시키지 않게)',
    leaks.length ? `${leaks.length}곳 — ${leaks.slice(0, 4).join(' | ')}` : `${probes.length}개 파일 · 스위치 ${SWITCHES.length}종 확인`,
  )
}

/**
 * ── 🧭 **곁길 예산이 두 곳에 있습니다 — 갈라지면 빨개져야 합니다** ────
 *
 * 게임의 `NAV.sideHintRange`(사람에게 *"저쪽에 보물"* 이라고 말하는 거리)와
 * 봇의 `DETOUR_BUDGET`(실제로 발을 돌리는 거리)은 **같은 하나의 규칙**
 * 입니다: *"이 정도 벗어나는 것이 이 존의 곁길 크기다."*
 *
 * 그런데 하나는 TypeScript 에, 하나는 mjs 에 있습니다. 프로브가 게임을
 * 못 import 하고(브라우저 없이는 안 돌아갑니다), 게임이 도구를 import
 * 하면 안 되니(빌드에 도구가 딸려 들어갑니다) **한 곳에 둘 수가 없습니다.**
 *
 * 그래서 실제로 갈라졌습니다 — 45 대 40 이었고, 주석에는 *"같은 값"*
 * 이라고 적혀 있었습니다. 그 5m 폭 안의 보물은 **사람에게는 권하고
 * 계측기는 안 가는** 자리가 됩니다. 아무도 알려 주지 않았습니다.
 *
 * 한 곳에 못 두면, 남는 수단은 **갈라지는 순간 빨개지게** 만드는 것입니다.
 * 이 저장소가 지도와 생성기를 묶어 둔 방법과 같습니다.
 */
{
  const bal = readFileSync(path.join(HERE, '..', 'src/config/balance.ts'), 'utf8')
  const pol = readFileSync(path.join(HERE, 'policy.mjs'), 'utf8')
  const hint = bal.match(/sideHintRange:\s*(\d+(?:\.\d+)?)/)
  const budget = pol.match(/export const DETOUR_BUDGET\s*=\s*(\d+(?:\.\d+)?)/)
  /**
   * ⚠️ **못 찾은 것을 통과로 치지 않습니다.** 이름이 바뀌면 정규식이
   *    조용히 아무것도 못 잡고, 그러면 이 검사는 영원히 초록입니다 —
   *    이 저장소가 빈 표본으로 다섯 번 데인 것과 정확히 같은 모양입니다.
   */
  check(
    hint !== null && budget !== null && Number(hint[1]) === Number(budget[1]),
    '🧭 곁길 예산이 게임과 봇에서 **같다** (사람에게 권하는 거리 = 발이 도는 거리)',
    hint === null || budget === null
      ? `값을 못 찾았습니다 — NAV.sideHintRange ${hint?.[1] ?? '?'} · DETOUR_BUDGET ${budget?.[1] ?? '?'}`
      : `양쪽 다 ${hint[1]}m`,
  )
}

/**
 * ── 🔗 **인용한 `npm run …` 이 실재하는가** ─────────────────────────
 *
 * 이 저장소는 주석으로 서로를 가리킵니다 — *"판정은 `npm run boss` 에
 * 있습니다"* 같은 문장이 코드와 주석에 **204곳** 있습니다. 그게 이 코드를
 * 읽는 사람이 길을 찾는 방법입니다.
 *
 * 그런데 프로브 이름을 하나 바꾸는 날, 그중 몇 곳이 **조용히 허공을**
 * 가리키게 됩니다. 지도와 생성기가 갈라졌을 때도, 곁길 예산이 45 대 40 으로
 * 갈라졌을 때도 같은 모양이었습니다 — 갈라진 것을 알려 주는 것이 아무것도
 * 없었습니다.
 *
 * ⚠️ 이 검사가 **못 잡는 것**도 적어 둡니다: 이름이 살아 있어도 그 스크립트가
 *    더 이상 그 판정을 안 할 수 있습니다. 실제로 그런 일이 있었습니다 —
 *    벤치가 보스 구간 판정을 흔들림 게이트로 막으면서, `pace` 의
 *    *"판정은 npm run bench"* 가 **판정 안 하는 곳**을 가리키게 됐습니다.
 *    기계가 잡을 수 있는 것은 **이름뿐**이고, 뜻은 사람이 봐야 합니다.
 */
{
  const scripts = new Set(Object.keys(JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).scripts))
  const files = []
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (f.name === 'node_modules' || f.name.startsWith('.')) continue
      const full = path.join(dir, f.name)
      if (f.isDirectory()) walk(full)
      else if (/\.(mjs|ts)$/.test(f.name)) files.push(full)
    }
  }
  walk(path.join(HERE, '..', 'src'))
  walk(HERE)
  const dead = []
  let seen = 0
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/npm run ([a-z][a-z-]*)/g)) {
      seen++
      if (!scripts.has(m[1])) dead.push(`${path.basename(f)}: npm run ${m[1]}`)
    }
  }
  /** ⚠️ 표본이 비면 통과가 아닙니다 — 한 곳도 못 읽었으면 그건 고장입니다. */
  check(
    seen > 0 && dead.length === 0,
    '🔗 주석이 인용한 `npm run …` 이 **전부 실재하는 스크립트다** (길잡이가 허공을 안 가리키게)',
    seen === 0
      ? '인용을 한 곳도 못 읽었습니다'
      : dead.length
        ? `${dead.length}곳 — ${[...new Set(dead)].slice(0, 4).join(' | ')}`
        : `${seen}곳 확인`,
  )
}

/**
 * ── 🤕 **피격 번쩍임을 손으로 적지 않는가** ────────────────────────────
 *
 * ── 여기서 실제로 갈라져 있었습니다 ─────────────────────────────────
 * 피격 번쩍임의 길이 `0.12` 가 **세 파일에 각자** 적혀 있었습니다:
 *
 *   combat.ts   `Health.flashT[t] = 0.12`        ← 때렸을 때 넣고
 *   main.ts     `Health.flashT[f.entity] = 0.12` ← 떨어졌을 때 또 넣고
 *   visuals.ts  `Health.flashT[e] / 0.12`        ← 그 값으로 밝기를 만들고
 *
 * 셋 중 하나만 고치면 나머지 둘은 **아무 말 없이** 어긋납니다. 이 저장소가
 * 지도와 생성기에서, 곁길 예산 45 대 40 에서 이미 두 번 겪은 모양입니다.
 * 이제 규칙은 `balance.ts hurtFlash()` **한 곳**에 있습니다.
 *
 * 그런데 주석으로 "여기 적지 마세요"라고 써 두는 것만으로는 부족합니다 —
 * 이 저장소가 스스로 적어 둔 문장 그대로, **한 곳에 못 두면 갈라지는
 * 순간 빨개지게** 만들어야 합니다. 그래서 기계가 봅니다.
 *
 * 규칙: `flashT[...] = ` 의 오른쪽은 `hurtFlash(` 로 시작하거나 `0`
 * (초기화/리셋)이어야 합니다. 숫자를 직접 쓰면 잡힙니다.
 *
 * ⚠️ 이 검사가 **못 잡는 것**: 다른 이름의 상태를 새로 만들어 같은 뜻을
 *    두 번 적는 것. 기계가 볼 수 있는 것은 **이 이름의 대입**뿐입니다.
 */
{
  const files = []
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (f.name === 'node_modules' || f.name.startsWith('.')) continue
      const full = path.join(dir, f.name)
      if (f.isDirectory()) walk(full)
      else if (/\.ts$/.test(f.name)) files.push(full)
    }
  }
  walk(path.join(HERE, '..', 'src'))
  const bad = []
  let seen = 0
  for (const f of files) {
    // 컴포넌트 선언(`flashT: 'f32'`)은 대입이 아니므로 안 걸립니다.
    for (const m of readFileSync(f, 'utf8').matchAll(/flashT\[[^\]]*\]\s*=\s*([^\n]+)/g)) {
      seen++
      const rhs = m[1].trim()
      // 자기 자신을 줄이는 감쇠(health.ts)는 **새 출처가 아닙니다** — 통과시킵니다.
      /**
       * ⚠️ 여기 처음 쓴 것이 `/^0\b/` 였고, **잡아야 할 것을 통과시켰습니다.**
       * `\b` 는 `0` 과 `.` 사이에서도 성립하므로 `0.12` 가 "0" 으로 읽혔습니다.
       * 일부러 위반을 넣어 돌려 보지 않았으면 **영원히 초록인 검사**를
       * 하나 더 만들 뻔했습니다. 이제 **딱 0** 만 통과시킵니다.
       */
      const ok = rhs.startsWith('hurtFlash(') || /^0(?![.\d])/.test(rhs) || rhs.includes('flashT[')
      if (!ok) bad.push(`${path.basename(f)}: ${rhs.slice(0, 40)}`)
    }
    // 나누는 쪽도 같습니다 — 밝기를 만들려고 숫자를 다시 적으면 갈라집니다.
    for (const m of readFileSync(f, 'utf8').matchAll(/flashT\[[^\]]*\][^\n]*\/\s*([0-9.]+)/g)) {
      bad.push(`${path.basename(f)}: flashT 를 숫자 ${m[1]} 로 나눔`)
    }
  }
  /** ⚠️ 표본이 비면 통과가 아닙니다 — 대입을 한 곳도 못 읽었으면 정규식이 죽은 것입니다. */
  check(
    seen > 0 && bad.length === 0,
    '🤕 피격 번쩍임의 길이가 **규칙 한 곳에서만** 나온다 (balance.ts `hurtFlash`)',
    seen === 0
      ? '대입을 한 곳도 못 읽었습니다'
      : bad.length
        ? `${bad.length}곳 — ${[...new Set(bad)].slice(0, 4).join(' | ')}`
        : `대입 ${seen}곳 확인`,
  )
}

/**
 * ── 🎲 **반올림한 값으로 규칙을 되묻지 않는가** ────────────────────────
 *
 * ── 여기서 검사 하나가 몇 판씩 거짓말을 했습니다 ──────────────────────
 * `moveInfo().rollWindowT` 는 보기 좋으라고 `toFixed(3)` 으로 깎여 나옵니다.
 * `verify` 는 그 값이 `=== 0` 이면 창이 닫혔다고 읽었습니다. 그런데 같은
 * 호출의 `pending` 은 **깎지 않은 원본**을 봅니다. 둘이 어긋나는 자리가
 * 실제로 있었습니다:
 *
 *     창 0.35초를 dt 0.05 로 일곱 번 빼면 부동소수 찌꺼기 3e-17 이 남습니다.
 *     `Math.max(0, …)` 는 그 찌꺼기를 **그대로 둡니다.**
 *     → `toFixed(3)` 은 "0.000" · `> 0` 은 **참**.
 *
 * 이 컨테이너는 프레임 dt 가 정확히 0.05 로 잘려서 이 일이 **자주** 납니다.
 * 그래서 *"창이 지나면 도로 1타"* 가 판마다 오갔습니다(129 → 128 → …).
 * 게임은 멀쩡했고, 프로브가 **게임이 반올림해 준 숫자로 게임에게 되물은**
 * 것이 원인이었습니다.
 *
 * 고친 방법은 이 저장소의 규칙 그대로입니다 — 판단을 게임에게 맡깁니다
 * (`rollWindowOpen`). 그리고 다시 그러지 않도록 기계가 봅니다.
 *
 * ⚠️ 못 잡는 것: 다른 이름의 반올림 값에 같은 짓을 하는 것. 기계가 볼 수
 *    있는 것은 **데인 자리**뿐이고, 완벽한 검사보다 그게 먼저입니다.
 */
{
  const files = []
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (f.name === 'node_modules' || f.name.startsWith('.')) continue
      const full = path.join(dir, f.name)
      if (f.isDirectory()) walk(full)
      else if (/\.mjs$/.test(f.name)) files.push(full)
    }
  }
  walk(HERE)
  const bad = []
  let seen = 0
  for (const f of files) {
    /**
     * ⚠️ **주석은 뺍니다.** 안 빼면 *"이렇게 쓰지 마세요"* 라고 적어 둔
     *    설명글까지 위반으로 셉니다 — 실제로 그렇게 한 번 빨개졌습니다.
     *    검사가 자기를 설명하는 글을 잡으면, 다음 사람은 설명을 지웁니다.
     */
    const src = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    for (const m of src.matchAll(/rollWindowT\s*(===|==|!==|!=|>|<)\s*0/g)) {
      seen++
      bad.push(`${path.basename(f)}: rollWindowT ${m[1]} 0`)
    }
  }
  check(
    bad.length === 0,
    '🎲 반올림해 낸 값(`rollWindowT`)으로 **창의 열림을 판단하지 않는다** (게임에게 물어보십시오 — `rollWindowOpen`)',
    bad.length ? `${bad.length}곳 — ${[...new Set(bad)].slice(0, 3).join(' | ')}` : `프로브 ${files.length}개 확인`,
  )
}

/**
 * ── 🎲 **`Math.random()` 은 금지 — 그런데 아무도 안 지키고 있었습니다** ──
 *
 * 이 규칙은 `core/rng.ts` 머리말에 있고, `config/gear.ts` 와
 * `systems/enemyAI.ts` 와 `render/gearAura.ts` 가 각자 *"금지입니다"* 라고
 * 다시 적어 두었습니다. **네 파일이 같은 규칙을 설명하는데 지키게 하는
 * 것은 하나도 없었습니다.** 그래서 게임 코드 안에 살아 있는 위반이
 * 세 곳 있었습니다(연출 불꽃 · 데미지 숫자 흔들림 · 보스 페이즈 파편).
 *
 * ── 장식이라서 괜찮은 것 아닌가 ────────────────────────────────────
 * 원래 근거 둘(맵 시드 · 버그 재현)은 판정의 이야기라 그렇게 보였습니다.
 * 그런데 이 저장소에는 세 번째가 생겼습니다 — **스크린샷 비교**입니다.
 * `depth` · `gear` · `verify` 가 *"같은 시각이면 같은 그림"* 위에 서
 * 있는데, 타격마다 불꽃이 무작위면 전투 장면은 원리적으로 못 잽니다.
 *
 * ── 예외는 **한 줄로 못박아** 둡니다 ───────────────────────────────
 * `guard-allow: Math.random` 주석이 붙은 줄만 봐줍니다. 지금은 백색 잡음
 * 파형 하나뿐입니다(잡음은 선택이 아니라 잡음 그 자체라 씨앗이 아무
 * 검사도 좋게 만들지 않습니다). 목록을 이 파일에 적지 않고 **쓰는 자리**에
 * 두는 이유: 예외의 근거는 그 코드 옆에 있어야 다음 사람이 읽습니다.
 */
{
  const SRC = path.join(HERE, '..', 'src')
  const files = []
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name)
      if (f.isDirectory()) walk(full)
      else if (/\.ts$/.test(f.name)) files.push(full)
    }
  }
  walk(SRC)
  const bad = []
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    let inBlock = false
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      // 블록 주석을 건너뜁니다 — 규칙을 설명하는 글이 위반으로 잡히면
      // 다음 사람은 설명을 지웁니다(위 `rollWindowT` 검사와 같은 이유).
      if (inBlock) {
        if (raw.includes('*/')) inBlock = false
        continue
      }
      if (/^\s*\/\*/.test(raw) && !raw.includes('*/')) {
        inBlock = true
        continue
      }
      const code = raw.replace(/\/\/.*$/, '')
      if (!/Math\s*\.\s*random\s*\(/.test(code)) continue
      // 바로 윗줄 또는 같은 줄의 면제 표시
      const near = `${lines[i - 1] ?? ''}\n${raw}`
      if (near.includes('guard-allow: Math.random')) continue
      bad.push(`${path.relative(SRC, f)}:${i + 1}`)
    }
  }
  check(
    bad.length === 0,
    '🎲 게임 코드에 **`Math.random()` 이 없다** (씨앗 난수만 — core/rng.ts · 면제는 `guard-allow` 주석으로)',
    bad.length ? `${bad.length}곳 — ${bad.slice(0, 3).join(' | ')}` : `소스 ${files.length}개 확인`,
  )
}

/**
 * ── 🚶 **깨는 거리를 «직선»으로 재지 않는다** ─────────────────────────
 *
 * ── 왜 이 검사가 생겼나 (같은 실수를 두 번 했습니다) ──────────────────
 * 게임의 깨는 식은 직선거리가 아닙니다(`enemyAI`):
 *
 *     const effectiveDist = reachDistance(적의 x, z) ?? Infinity
 *     if (effectiveDist <= (inFront ? range : hearDistance(speed)))
 *
 * **그 적이 나에게 오려면 걸어야 하는 거리**입니다. 직선은 그 값을
 * **과소평가**하므로, 직선으로 재면 **실제로는 안 깨는 적을 «깬다»고**
 * 셉니다 — 검사가 실제보다 후해집니다.
 *
 * 이 저장소는 이걸 궁수 검사에서 한 번 배웠는데, 그 뒤에 만든 🔇 검사가
 * **같은 실수를 그대로 되풀이했습니다.** 실측: 직선 16마리 · 걸어서
 * 15마리 · 최대 어긋남 **+46.0m**(직선 10m 인 달려드는 자가 실제로는
 * 36m 를 걸어와야 하고, 깨는 거리는 14m 이라 영원히 안 깹니다).
 *
 * 배운 것을 **주석에만** 적어 두면 다음 검사가 또 틀립니다 — 이번 회차에
 * 「주석이 약속한 것을 코드가 안 지킨다」를 세 번 겪었습니다. 그래서
 * 규칙을 **검사로** 굳힙니다.
 *
 * ── 무엇을 잡는가 ────────────────────────────────────────────────
 * 프로브에서 `Math.hypot(...)` 의 결과를 **깨는 거리**(`wakeOf` ·
 * `wakeRange` · `aggro…` · `hearWalk/hearRun`)와 비교하는 줄.
 *
 * ⚠️ **직선이 맞는 자리도 있습니다:**
 *   · **고함**(`alertRadius`) — 들리는 것이지 걸어오는 것이 아닙니다.
 *   · **천장**(ceiling) — 직선은 걸음보다 작거나 같으므로, 직선으로 센
 *     값은 여전히 **상한**입니다. 후한 자는 천장에는 맞고 **판정에는**
 *     틀립니다.
 *   그런 줄에는 `guard-allow: 직선` 을 같은 줄이나 윗줄에 답니다.
 *   면제에는 **이유를 같이** 적으십시오 — 이유 없는 면제는 다음 사람이
 *   복사해 씁니다.
 */
{
  const bad = []
  for (const f of files) {
    const src = readFileSync(path.join(HERE, f), 'utf8')
    const lines = src.split('\n')
    let inBlock = false
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      /**
       * ⚠️ **주석 안의 인용문을 코드로 세면 안 됩니다.** 이 검사를 처음
       *    돌렸을 때, 바로 이 규칙을 **설명하는 주석**이 `Math.hypot(...)`
       *    를 인용했다는 이유로 빨갛게 잡혔습니다. 규칙을 적어 둔 글이
       *    규칙 위반으로 잡히는 자리라, 웃기기 전에 **검사가 무엇을
       *    읽는지**를 말해 줍니다 — 위 `Math.random` 검사가 같은 처리를
       *    이미 하고 있었는데 여기에 안 옮겨 적었습니다.
       */
      if (inBlock) {
        if (raw.includes('*/')) inBlock = false
        continue
      }
      if (/^\s*\/\*/.test(raw) && !raw.includes('*/')) {
        inBlock = true
        continue
      }
      const code = raw.replace(/\/\/.*$/, '')
      if (!/Math\s*\.\s*hypot\s*\(/.test(code)) continue
      // 깨는 거리와 견주는 줄만 — 다른 거리 계산은 상관없습니다.
      /**
       * ⚠️ **다음 줄까지 봅니다.** 처음엔 같은 줄만 봤는데, 실제 코드는
       *    이렇게 나뉘어 있는 자리가 있었습니다:
       *        const d = Math.hypot(...)
       *        const slack = d - wakeOf(f.kind)
       *    그래서 「보스 앞 복도」 검사가 직선으로 재는 것을 **놓쳤고**,
       *    그 검사가 실제보다 좁은 복도를 내고 있었습니다.
       */
      const scope = `${code}\n${(lines[i + 1] ?? '').replace(/\/\/.*$/, '')}`
      if (!/wakeOf|wakeRange|aggroM|levelAggroRange|hearWalk|hearRun|hear\.walk|hear\.run/.test(scope))
        continue
      /**
       * 면제 표시는 **위 여덟 줄까지** 봅니다. 이유를 적으려면 한 줄로는
       * 모자라서 대개 여러 줄 주석이 되는데, 바로 윗줄만 보면 그 주석이
       * 안 보입니다(실제로 처음에 그렇게 만들어 놓고 네 곳을 놓쳤습니다).
       */
      const near = lines.slice(Math.max(0, i - 8), i + 1).join('\n')
      if (near.includes('guard-allow: 직선')) continue
      bad.push(`${f}:${i + 1}`)
    }
  }
  check(
    bad.length === 0,
    '🚶 프로브가 **깨는 거리를 직선으로 재지 않는다** (게임은 걸음 거리를 씁니다 · 면제는 `guard-allow: 직선`)',
    bad.length ? `${bad.length}곳 — ${bad.slice(0, 4).join(' | ')}` : `프로브 ${files.length}개 확인`,
  )
}

/**
 * ── 🟢 **«고르는 거리»가 «닿는 거리»보다 넓으면 돌진이 있어야 합니다** ──
 *
 * ── 이 검사가 없어서 무엇을 놓쳤나 ──────────────────────────────────
 * 달려드는 자가 **한 번도 달려들지 않고 있었습니다.** `lungeSpeed` 가
 * 타입에만 선언돼 있고 **어느 공격에도 값이 없었습니다** — 설계 주석
 * 스무 줄과 `enemyAI` 의 돌진 분기가 다 있는데 숫자만 비어서, 그 분기가
 * 한 번도 안 돌았습니다.
 *
 * 드러난 유일한 흔적은 **데이터의 모순**이었습니다:
 *
 *     charger_rush  reach 5.5 · maxRange 7.5  (+2.0m)
 *     charger_ram   reach 4.0 · maxRange 5.5  (+1.5m)
 *     boss_charge   reach 6.5 · maxRange 10   (+3.5m)
 *     나머지 전부   maxRange <= reach
 *
 * `maxRange`(고를 수 있는 거리)가 `reach`(닿는 거리)보다 넓다는 것은
 * **예고 중에 거리를 좁힌다**는 뜻입니다. 좁히지 않으면 그 차이만큼은
 * **닿지 않는 데서 휘두르는 것**이고, 실제로 `npm run charge` 가
 * *"거리 4.50 / 사거리 4.45 — 빗나감"* 을 세 판 내내 찍었습니다.
 * 가만히 선 표적을 **5cm 차이로 매번** 빗나갑니다.
 *
 * ── 그래서 두 데이터가 서로를 전제합니다 ────────────────────────────
 * 「maxRange > reach」와 「lungeSpeed 있음」은 **짝**입니다. 한쪽만
 * 있으면 반드시 버그입니다:
 *   · 넓은데 안 좁히면 → **못 닿는 공격**(이번에 겪은 것)
 *   · 좁히는데 안 넓으면 → 돌진할 일이 없어 그 코드가 죽습니다
 *
 * 사람이 볼 때 안 보이는 이유: `lungeSpeed?: number` 는 **문법적으로
 * 완전**하고 주석까지 붙어 있어 «있는 기능»처럼 읽힙니다. 값이 비어
 * 있다는 것은 **정의를 전부 세어 봐야** 알 수 있습니다. 그래서 검사가
 * 셉니다.
 */
{
  // ⚠️ `SRC` 는 위쪽 블록 안에서만 사는 이름입니다 — 여기서 따로 잡습니다.
  const src = readFileSync(path.join(HERE, '..', 'src', 'config', 'enemyAttacks.ts'), 'utf8')
  /**
   * 공격 정의 하나하나를 `id:` 로 잘라 봅니다. 파서를 쓰지 않는 이유는
   * 이 저장소의 다른 정적 검사와 같습니다 — 이 파일의 모양이 아주
   * 규칙적이라 `id:` 로 자르는 것으로 충분하고, 파서를 들이면 검사보다
   * 검사의 도구가 더 복잡해집니다.
   */
  const chunks = src.split(/\n\s*\{\s*\n(?=\s*(?:\/\*\*[\s\S]*?\*\/\s*\n)?\s*id:)/)
  const bad = []
  let seen = 0
  for (const c of chunks) {
    const id = c.match(/\n\s*id:\s*'([a-z_]+)'/)
    if (!id) continue
    const num = (k) => {
      const m = c.match(new RegExp('\\n\\s*' + k + ':\\s*([0-9.]+)'))
      return m ? Number(m[1]) : null
    }
    const reach = num('reach')
    const maxRange = num('maxRange')
    if (reach === null || maxRange === null) continue
    seen++
    if (maxRange > reach && num('lungeSpeed') === null)
      bad.push(`${id[1]} reach ${reach} < maxRange ${maxRange}`)
  }
  check(
    seen > 0,
    '🟢 사거리를 읽을 공격 정의를 실제로 찾았다 (비교의 게이트)',
    `${seen}개`,
  )
  check(
    bad.length === 0,
    '🟢 **«고르는 거리»가 «닿는 거리»보다 넓은 공격에는 돌진이 있다** (닿지 않는 데서 휘두르지 않게)',
    bad.length ? `${bad.length}개 — ${bad.join(' | ')}` : `공격 ${seen}개 확인`,
  )
}

/**
 * ── 🕳 **선언만 있고 아무도 값을 안 준 「선택 칸」** ─────────────────
 *
 * 이 검사가 생긴 이유는 실제로 있었던 고장 하나입니다.
 *
 * `enemyAttacks.ts` 에 `lungeSpeed?: number` 가 있었습니다. 타입에
 * 선언돼 있었고, 긴 한국어 주석으로 *왜* 필요한지까지 적혀 있었고,
 * `enemyAI.ts` 가 그 값으로 **분기까지** 하고 있었습니다. 그런데
 * **어느 공격에도 값이 안 적혀 있었습니다.** 그래서:
 *
 *   · 달려드는 자는 한 번도 달려들지 않았고
 *   · 보스의 가장 큰 공격은 4.50m 에서 휘둘러 4.45m 사거리를 **빗나갔고**
 *   · 그 분기는 만든 이래 **한 번도 참이 된 적이 없었습니다**
 *
 * 아무 검사도 못 잡았습니다. 타입은 «선택»이니 통과하고, 코드는 읽기만
 * 하니 통과하고, 프로브는 «돌진이 없는 것이 정상»인 줄 알았습니다.
 * **`undefined` 는 조용합니다 — 없는 값은 아무 소리도 내지 않습니다.**
 *
 * 그래서 모양 자체를 잡습니다: **읽히는데 아무 데서도 안 채워지는 칸.**
 *   · 읽히지도 않으면 그냥 미래를 위한 자리입니다 — 안 잡습니다.
 *   · 읽히는데 값이 없으면 그 분기는 **죽은 코드**입니다.
 *
 * 면제는 선언 위 8줄 안에 `guard-allow: 빈칸` 주석으로.
 */
{
  const CFG = path.join(HERE, '..', 'src', 'config')
  /** 값을 «어디서든» 찾습니다 — 레벨 JSON 과 생성기(tools)까지 봅니다. */
  const hay = []
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name)
      if (f.isDirectory()) walk(full)
      else if (/\.(ts|mjs|json)$/.test(f.name)) hay.push([full, readFileSync(full, 'utf8')])
    }
  }
  walk(path.join(HERE, '..', 'src'))
  walk(HERE)

  const dead = []
  let seen = 0
  for (const f of readdirSync(CFG).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(path.join(CFG, f), 'utf8')
    const lines = src.split('\n')
    /** 주석 안의 예시 코드를 선언으로 오해하지 않게 블록 주석을 지웁니다. */
    const bareLines = src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .split('\n')
    for (let i = 0; i < bareLines.length; i++) {
      const m = bareLines[i].match(/^\s{2,}(\w+)\?:\s*\S/)
      if (!m) continue
      const name = m[1]
      /**
       * 면제 표시는 **바로 위에 붙은 주석 덩어리 안**에서만 찾습니다.
       *
       * 처음엔 "위 8줄"로 했는데, 사정을 제대로 적은 주석은 8줄을 쉽게
       * 넘깁니다 — 실제로 첫 면제가 11줄짜리라 안 먹혔습니다. 그렇다고
       * 숫자만 늘리면 **옆 칸의 면제가 흘러들어옵니다.** 줄 수가 아니라
       * *"이 선언에 붙은 주석인가"* 로 봅니다.
       */
      let allow = false
      for (let j = i - 1; j >= 0; j--) {
        const t = lines[j].trim()
        if (t === '') continue
        if (!(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//'))) break
        if (t.includes('guard-allow: 빈칸')) allow = true
      }
      if (allow) continue
      seen++
      /** 읽히는가 — `.name` 이나 `['name']` 으로 꺼내 쓰는 자리가 있는가. */
      const readRe = new RegExp('\\.' + name + '\\b|\\[[\'"]' + name + '[\'"]\\]')
      if (!hay.some(([, t]) => readRe.test(t))) continue
      /**
       * 채워지는가 — `name: <값>` 이 **선언이 아닌 자리**에 있는가.
       * `name?:` 는 선언이므로 제외합니다(그게 지금 보고 있는 줄입니다).
       */
      const setRe = new RegExp('(^|[{,\\s])[\'"]?' + name + '[\'"]?:\\s*\\S')
      const filled = hay.some(([, t]) =>
        t.split('\n').some((l) => setRe.test(l) && !/\?\s*:/.test(l)),
      )
      if (!filled) dead.push(`${f} → ${name}`)
    }
  }
  check(seen > 0, '🕳 설정에서 「선택 칸」 선언을 실제로 찾았다 (비교의 게이트)', `${seen}개`)
  check(
    dead.length === 0,
    '🕳 **읽히는데 아무 데서도 안 채워지는 「선택 칸」이 없다** (`undefined` 는 조용합니다 · 면제는 `guard-allow: 빈칸`)',
    dead.length ? `${dead.length}개 — ${dead.join(' | ')}` : `선택 칸 ${seen}개 확인`,
  )
}

/**
 * ── 🧩 **부품이 «건드리는 칸»과 «뜻이 있는지 보는 칸»이 같은가** ────────
 *
 * 「나만의 스킬」은 부품을 **아무 스킬에나** 끼우게 하는 설계입니다. 그래서
 * `tripod.ts` 에 표가 둘 있습니다:
 *
 *   · `applyMods`  — 부품이 **무엇을 바꾸는가**
 *   · `MOD_NEEDS`  — 그 칸이 **이 스킬에서 뜻이 있는가**
 *
 * 한쪽에만 칸이 늘면 조용히 고장 납니다:
 *   · `applyMods` 에만 있으면 → `partFitsSkill` 이 «모르는 칸»으로 막습니다.
 *     안전한 쪽이지만 **새 부품이 아무 데도 안 끼워집니다.**
 *   · `MOD_NEEDS` 에만 있으면 → 끼워지는데 **아무 일도 안 일어납니다.**
 *     이게 `lungeSpeed` 와 같은 모양입니다 — 선언은 있는데 효과가 없는 값.
 *
 * 그래서 두 목록을 **대조**합니다. 규칙을 주석으로 부탁하지 않고 기계가 봅니다.
 */
{
  const src = readFileSync(path.join(HERE, '..', 'src', 'systems', 'tripod.ts'), 'utf8')
  const cut = (from, to) => {
    const a = src.indexOf(from)
    if (a < 0) return ''
    const b = to ? src.indexOf(to, a) : -1
    return src.slice(a, b < 0 ? src.length : b)
  }
  const needsBlock = cut('const MOD_NEEDS', 'export function partFitsSkill')
  const applyBlock = cut('function applyMods(', '\n}\n')
  /** `mods.foo` 로 읽는 칸 전부 — 이게 «바꾸는 칸»의 목록입니다. */
  const applied = [...new Set([...applyBlock.matchAll(/mods\.([A-Za-z]+)/g)].map((m) => m[1]))]
  /** `foo: (s) => …` 로 적힌 칸 전부 — 이게 «뜻을 보는 칸»의 목록입니다. */
  const known = [...new Set([...needsBlock.matchAll(/^\s{2}([A-Za-z]+):\s*\(/gm)].map((m) => m[1]))]
  check(
    applied.length > 0 && known.length > 0,
    '🧩 부품 표 둘을 실제로 찾았다 (비교의 게이트)',
    `바꾸는 칸 ${applied.length}개 · 뜻 보는 칸 ${known.length}개`,
  )
  const missing = applied.filter((k) => !known.includes(k))
  const extra = known.filter((k) => !applied.includes(k))
  /**
   * ── ⚖️ **«교환인가» 를 보는 칸도 같이 대조합니다** ────────────────
   *
   * `partIsTradeoff` 는 *"이 부품이 대가를 요구하는가"* 를 계산합니다.
   * 새 mod 칸이 생겼는데 여기 안 넣으면, **그 칸으로만 나빠지는 부품이
   * «순수 이득»으로 읽힙니다** — 봇은 그걸 집고, 성장할수록 약해지고,
   * 아무도 이유를 모릅니다.
   *
   * ⚠️ 다만 **모든 칸이 방향을 갖는 것은 아닙니다.** `shape`(도형 교체)와
   *    `iFrames`(무적 구간)와 `snareAdd`·`dashAdd`(없던 것이 생김)는
   *    «나빠지는 쪽»이 없습니다. 그래서 «전부 일치»가 아니라 **«방향이
   *    있는 칸이 빠지지 않았는가»** 를 봅니다 — 문턱을 세게 잡으면
   *    아무도 못 넘는 벽이 됩니다.
   */
  const tradeBlock = cut('export function partIsTradeoff', '\nexport function partFitsSkill')
  const graded = [...new Set([...tradeBlock.matchAll(/mods\.([A-Za-z]+)/g)].map((m) => m[1]))]
  /** 방향이 있는 칸 = 배수(Mult)와 더하기(Add) — 크고 작음이 뜻을 갖습니다. */
  const directional = applied.filter((k) => /Mult$|Add$/.test(k))
  /**
   * «생각하고 뺀» 칸은 인정합니다 — 주석에 이름과 이유가 적혀 있어야
   * 합니다(`⚖️ \`이름\` 는 일부러 안 봅니다`). 조용히 빠진 것과
   * 판단해서 뺀 것은 다릅니다.
   */
  const waived = [...tradeBlock.matchAll(/⚖️ \*\*`([A-Za-z]+)` 는 일부러 안 봅니다/g)].map((m) => m[1])
  const ungraded = directional.filter((k) => !graded.includes(k) && !waived.includes(k))
  check(
    ungraded.length === 0,
    '⚖️ **방향이 있는 칸은 전부 «교환인가» 판정에 들어간다** (나빠지는 부품이 «순수 이득»으로 읽히지 않게)',
    ungraded.length
      ? `빠진 칸: ${ungraded.join(' · ')}`
      : `방향 있는 칸 ${directional.length}개 확인` +
        (waived.length ? ` (판단해서 뺀 것: ${waived.join(' · ')})` : ''),
  )
  check(
    missing.length === 0 && extra.length === 0,
    '🧩 **부품이 바꾸는 칸과 «뜻이 있는지» 보는 칸이 정확히 같다** (끼웠는데 아무 일도 안 하는 조합이 없게)',
    missing.length || extra.length
      ? `${missing.length ? `MOD_NEEDS 에 없음: ${missing.join(' · ')}` : ''}` +
        `${missing.length && extra.length ? ' | ' : ''}` +
        `${extra.length ? `applyMods 에 없음: ${extra.join(' · ')}` : ''}`
      : `칸 ${applied.length}개 일치`,
  )
}

/**
 * ── 🌐 **`page.evaluate` 안에서 Node 것을 만지지 않는다** ────────────────
 *
 * 맨 위 검사가 「evaluate 안에서 **모듈 상수**를 참조하지 않는다」를 보는데,
 * `process.env` 는 상수가 아니라 **Node 전역**이라 그 그물을 빠져나갔습니다.
 * 실제로 `GROWTH=8` 을 evaluate 안에서 읽었다가 판이 통째로 죽었습니다:
 *
 *     page.evaluate: ReferenceError: process is not defined
 *     💥 프로브가 도중에 죽었습니다
 *
 * 같은 고장(브라우저에 없는 것을 브라우저에서 씀)인데 검사만 둘로 갈려
 * 있었습니다. 브라우저에 **없는 전역**을 한 줄에 모아 같이 봅니다.
 */
{
  const NODE_ONLY = ['process', 'require', '__dirname', '__filename', 'Buffer']
  const bad = []
  let scanned = 0
  for (const f of files) {
    const src = readFileSync(path.join(HERE, f), 'utf8')
    for (const block of evaluateBlocks(src)) {
      scanned++
      /**
       * ⚠️ **인자 배열은 빼고 봅니다.** `page.evaluate(fn, args)` 의 `args` 는
       *    **Node 쪽에서** 평가되어 넘어가므로 `process.env` 를 써도 맞습니다.
       *    처음엔 블록 전체를 훑어서 그 인자 배열이 빨갛게 떴습니다 —
       *    **옳은 코드를 틀렸다고 부르는** 검사였습니다.
       *    그래서 화살표 함수의 **몸통만** 떠냅니다.
       *
       * ⚠️ `evaluateBlocks` 는 문자열이 아니라 `{ start, text }` 를 줍니다.
       */
      const t = block.text
      const arrow = t.indexOf('=> {')
      let body = t
      if (arrow >= 0) {
        let depth = 0
        for (let i = arrow + 3; i < t.length; i++) {
          if (t[i] === '{') depth++
          else if (t[i] === '}') {
            depth--
            if (depth === 0) {
              body = t.slice(arrow, i + 1)
              break
            }
          }
        }
      }
      // 주석 안의 예시는 빼고 봅니다(설명에 `process.env` 를 적을 수 있습니다).
      // `m` 플래그가 있어야 **줄마다** `//` 를 지웁니다 — 없으면 첫 줄만 지워집니다.
      const bare = body
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/gm, '$1 ')
      for (const g of NODE_ONLY) {
        const re = new RegExp(`(^|[^\\w.])${g}\\s*[.[(]`)
        if (re.test(bare)) bad.push(`${f}: ${g}`)
      }
    }
  }
  check(scanned > 0, '🌐 `page.evaluate` 블록을 실제로 찾았다 (비교의 게이트)', `${scanned}개`)
  check(
    bad.length === 0,
    '🌐 **`page.evaluate` 안에서 Node 전역을 쓰지 않는다** (브라우저에는 `process` 가 없습니다)',
    bad.length ? [...new Set(bad)].join(' | ') : `블록 ${scanned}개 확인`,
  )
}

/**
 * ── 🔧 **「배수를 고른 가지」와 「이름을 붙인 가지」가 같은가** ────────────
 *
 * `applyPoise` 안에 삼항 사슬이 **둘** 있습니다:
 *
 *   · `multiplier` — 이 타격이 강인도를 **얼마나** 깎는가 (게임의 규칙)
 *   · `lever`      — 그 깎임을 **무엇의 공으로** 적는가 (장부의 이름)
 *
 * 둘의 조건과 **순서**가 한 글자라도 달라지면, «×2.5 를 받은 타격»과
 * «예고중으로 기록된 타격»이 조용히 다른 집합이 됩니다. 그러면 장부는
 * 여전히 초록인 채로 **거짓을 말합니다** — 아무도 안 알려 줍니다.
 *
 * 이 저장소가 정확히 그 모양으로 데였습니다: 예고중 배수(×2.5)는 6개월
 * 넘게 돌고 있었는데 장부에는 한 번도 안 나타났고, 그 위에서 「설계가
 * 몰아준 셋 중 반격만 일한다」는 결론까지 냈습니다.
 *
 * 그래서 **두 사슬의 조건 목록을 뽑아 그대로 견줍니다.** 배수를 하나
 * 더하면서 이름을 안 더하면 여기서 빨강이 납니다.
 */
{
  const src = readFileSync(path.join(HERE, '..', 'src/systems/combat.ts'), 'utf8')
  /** 삼항 사슬 하나를 통째로 집어 **조건들만** 순서대로 뽑습니다. */
  /**
   * ⚠️ **처음엔 «`?` 로 끝나는 줄»을 찾았습니다 — 0개가 나왔습니다.**
   *    포매터가 삼항을 이렇게 씁니다:
   *
   *        const multiplier = crossfire
   *          ? POISE.backMultiplier
   *          : spec.heavyBlow
   *          ? ...
   *
   *    조건은 줄 **끝**이 아니라, **다음 줄이 `?` 로 시작하는** 줄입니다.
   *    (게이트를 같이 넣어 뒀기 때문에 0개가 초록이 아니라 빨강이 됐습니다 —
   *     「빈 표본으로 통과하지 않게」가 자기 자신을 잡은 자리입니다.)
   */
  const chainConds = (declName) => {
    const at = src.indexOf(`const ${declName}`)
    if (at < 0) return null
    const lines = src.slice(at).split('\n').map((l) => l.trim())
    // 첫 줄 다음부터는 `?` 또는 `:` 로 시작하는 동안이 사슬입니다.
    const body = [lines[0]]
    for (let i = 1; i < lines.length && i < 40; i++) {
      if (!/^[?:]/.test(lines[i])) break
      body.push(lines[i])
    }
    const out = []
    for (let i = 0; i < body.length - 1; i++) {
      if (!/^\?/.test(body[i + 1])) continue
      out.push(
        body[i]
          .replace(/^:\s*/, '')
          .replace(/^const\s+\w+(\s*:\s*[\w.<>[\]| ]+)?\s*=\s*/, '')
          .trim(),
      )
    }
    return out
  }
  const mul = chainConds('multiplier')
  const lev = chainConds('lever')
  check(
    mul !== null && lev !== null && mul.length > 0,
    '🔧 `applyPoise` 의 배수 사슬과 이름 사슬을 둘 다 찾았다 (비교의 게이트)',
    mul === null || lev === null ? '못 찾음' : `조건 ${mul.length}개 vs ${lev.length}개`,
  )
  if (mul !== null && lev !== null && mul.length > 0) {
    /**
     * `lever` 사슬의 마지막 가지는 조건이 없는 기본값(`'평타'`)이라
     * 조건 수가 `multiplier` 와 같아야 합니다 — 둘 다 같은 모양입니다.
     */
    const same = mul.length === lev.length && mul.every((c, i) => c === lev[i])
    check(
      same,
      '🔧 **배수를 고른 조건과 이름을 붙인 조건이 글자까지 같다**',
      same
        ? `${mul.length}개 일치 — ${mul.join(' → ')}`
        : `어긋남\n        배수: ${mul.join(' → ')}\n        이름: ${lev.join(' → ')}`,
    )
  }
}

/**
 * ── 🏅 **붕괴에 이름을 안 달고 부르는 자리가 없는가** ────────────────────
 *
 * `breakPoise(t)` 처럼 이름 없이 부르면 예전엔 «평타»로 기록됐습니다.
 * 지금은 타입이 막지만(`by: BreakCause` — 기본값 없음), 누군가 다시
 * 기본값을 붙이면 **컴파일은 통과하면서 장부만 조용히 거짓**이 됩니다.
 * 기본값이 되살아나는 것 자체를 막습니다.
 */
{
  const src = readFileSync(path.join(HERE, '..', 'src/systems/combat.ts'), 'utf8')
  const sig = /export function breakPoise\(([^)]*)\)/.exec(src)
  check(sig !== null, '🏅 `breakPoise` 선언을 찾았다 (검사의 게이트)', sig ? sig[1] : '못 찾음')
  if (sig)
    check(
      !sig[1].includes('='),
      '🏅 **`breakPoise` 의 원인 인자에 기본값이 없다** (기본값이 세 자리를 «평타»로 만들었습니다)',
      sig[1].trim(),
    )
}

/**
 * ── ⏱ **«초당»을 재는 프로브는 히트스톱을 빼야 합니다** ──────────────────
 *
 * `state().elapsed` 는 **실제 시간**이라 **히트스톱 동안에도 흐릅니다.**
 * 그 시계로 «초당 몇 번»을 재면, **큰 한 방을 낼수록 느려 보입니다** —
 * 잘한 손을 벌주는 자가 됩니다.
 *
 * 실제로 겪었습니다. 간파에 연출(히트스톱 ×1.2 · 흔들림)을 넣은 바로
 * 다음 판에서 「간파노림」의 초당 붕괴가 **0.250 → 0.203** 으로 떨어졌고,
 * 저는 하마터면 그걸 «규칙이 약해졌다»로 읽을 뻔했습니다. 게임은 아무것도
 * 안 느려졌고 **계기가 축하를 손해로 적은 것**이었습니다.
 *
 * `playthrough.mjs` 가 이미 같은 자리에서 데였습니다 —
 * *"전투 중 11~13%가 히트스톱이었습니다."* 주석에만 있던 그 교훈을
 * 여기서 **검사로** 굳힙니다.
 *
 * 규칙: 출력에 «초당» 이 있는 프로브는 `simElapsed` 를 써야 합니다.
 * (「초당」을 안 찍는 프로브는 상관없습니다 — 재는 것이 속도가 아니니까요.)
 */
{
  const files = readdirSync(HERE)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => ({ f, src: readFileSync(path.join(HERE, f), 'utf8') }))
  /**
   * ⚠️ **«초당을 찍는다»만으로는 안 됩니다 — «직접 잰다»까지 봐야 합니다.**
   *
   * 첫 판에서 이 검사가 다섯을 잡았는데, 그중 `bench.mjs` 는 시간을 **안
   * 잽니다** — `playthrough` 가 잰 값을 모아서 찍을 뿐입니다(그리고
   * playthrough 는 이미 `simElapsed` 를 씁니다). 그런 파일을 빨갛게
   * 만들면, 고칠 것이 없는데 고치라는 빨강이 되고 **다음 사람은 검사를
   * 끕니다.**
   *
   * 그래서 조건을 둘로 둡니다 — «초당을 찍는다» **그리고** «시계를 직접
   * 읽는다»(`state().elapsed`). 둘 다여야 잘못 잰 것입니다.
   */
  /**
   * ⚠️ **주석을 걷어내고 봅니다.** 첫 판이 셋을 더 잡았는데 전부 **주석**
   *    이었습니다 — *"실측으로 초당 3.53 불티"* 같은 설계 기록이요.
   *    고칠 것이 없는데 뜨는 빨강은 **다음 사람이 검사를 끄게** 만듭니다.
   *    이 저장소가 검사에 늘 요구하는 것과 같습니다: 재는 것이 무엇인지
   *    정확히 좁힐 것.
   */
  const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const rateProbes = files.filter(
    (o) => bare(o.src).includes('초당') && bare(o.src).includes('state().elapsed'),
  )
  const bad = rateProbes.filter((o) => !o.src.includes('simElapsed'))
  check(
    rateProbes.length > 0,
    '⏱ «초당»을 찍는 프로브를 실제로 찾았다 (검사의 게이트)',
    `${rateProbes.length}개`,
  )
  check(
    bad.length === 0,
    '⏱ **«초당»을 재는 프로브는 `simElapsed` 를 쓴다** (히트스톱이 잘한 손을 벌주지 않게)',
    bad.length ? bad.map((o) => o.f).join(' · ') : `프로브 ${rateProbes.length}개 확인`,
  )
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
