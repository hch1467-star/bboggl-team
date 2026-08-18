/**
 * 적 종류 검증 — `npm run enemies`
 *
 * 새 적을 넣을 때 가장 무서운 실패는 **조용한 실패**입니다.
 * `isBoss ? BOSS : GRUNT` 같은 불리언이 한 군데라도 남아 있으면,
 * 얽는 자가 잡몹의 체력·속도·공격을 그대로 쓰면서도 화면에는 멀쩡히
 * 나타납니다. 오류도 안 나고 그럴듯해 보여서 눈으로는 절대 못 잡습니다.
 *
 * 그래서 종류마다 **실제 수치를 꺼내 서로 다른지** 확인합니다.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5186
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail) {
  if (ok) {
    pass++
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const server = await createServer({ root: '.', server: { port: PORT }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: execPath,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })

  await page.evaluate(() => {
    window.__t = {
      runFor: async (seconds) => {
        const target = window.__game.state().elapsed + seconds
        const deadline = Date.now() + 90000
        while (window.__game.state().elapsed < target && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 8))
        }
      },
      until: async (fn, limit) => {
        const target = window.__game.state().elapsed + limit
        const deadline = Date.now() + 120000
        while (Date.now() < deadline && window.__game.state().elapsed < target) {
          if (fn()) return true
          await new Promise((r) => setTimeout(r, 8))
        }
        return fn()
      },
    }
  })

  console.log('\n👹 적 종류 검증\n')

  // ---- 1. 종류 표가 실제로 갈라지는가 ----
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  console.log('  [적 명단]')
  for (const r of roster) {
    console.log(
      `    ${r.name.padEnd(6)} hp ${String(r.maxHp).padStart(3)} · 키 ${r.height.toFixed(2)}m · ` +
        `속도 ${r.moveSpeed} · 사거리 ${r.attackRange} · 유지 ${r.keepDistance ?? '-'} · ` +
        `패턴 ${r.attacks.map((a) => `${a.color}${a.id}`).join(',')}`,
    )
  }
  const byId = Object.fromEntries(roster.map((r) => [r.id, r]))
  /**
   * **존에 배치된 종류가 전부 종류표에 있는가.**
   *
   * 예전엔 `roster.length === 4` 였습니다. 그런데 그 4는 게임이 아니라
   * `enemyRoster()` 안에 **손으로 적힌 목록**의 길이였고, 나중에 들어온
   * 달려드는 자·쏘는 자가 통째로 빠져 있었습니다. 그래서 아래 실루엣
   * 검사도 그 둘을 한 번도 못 봤고, 규칙(키 0.30m 간격)을 어긴 값이
   * 두 번 들어왔습니다.
   *
   * 숫자를 4에서 6으로 고치면 **같은 버그를 한 번 더 심는 것**입니다.
   * 세는 대신 두 목록을 맞춰 봅니다 — 존에 세운 종류는 반드시 표에
   * 있어야 합니다. 새 적을 넣으면 이 검사가 저절로 따라옵니다.
   */
  const inLevel = await page.evaluate(() => window.__game.levelRoster())
  const missing = Object.keys(inLevel).filter((id) => !byId[id])
  check(
    missing.length === 0,
    '존에 배치된 적 종류가 전부 종류표에 있다 (새 적이 검사에서 새지 않게)',
    `배치 ${Object.keys(inLevel).length}종 · 표 ${roster.length}종` +
      (missing.length ? ` · 빠진 것 ${missing.join(', ')}` : ` — ${roster.map((r) => r.name).join(' · ')}`),
  )
  // 불리언 잔재가 남아 있으면 이 검사가 무너집니다 — 새 적이 잡몹 수치를 씁니다.
  check(
    byId.binder && byId.binder.maxHp !== byId.grunt.maxHp,
    '얽는 자가 잡몹 수치를 베끼지 않음',
    `체력 ${byId.binder?.maxHp} vs 잡몹 ${byId.grunt?.maxHp}`,
  )
  check(
    byId.dragger && byId.dragger.maxHp !== byId.grunt.maxHp,
    '끄는 자가 잡몹 수치를 베끼지 않음',
    `체력 ${byId.dragger?.maxHp} vs 잡몹 ${byId.grunt?.maxHp}`,
  )

  // ---- 2. 4색이 잡몹 단계에서 전부 나오는가 ----
  //
  // 이게 이번 작업의 존재 이유입니다. 지금까지 🔵🟣는 보스만 썼고,
  // 플레이어는 **실수 대가가 가장 큰 싸움에서 처음** 그 색을 만났습니다.
  console.log('')
  const colors = new Set()
  for (const r of roster) {
    if (r.id === 'boss') continue
    for (const a of r.attacks) colors.add(a.intent)
  }
  check(colors.has(0), '🔴 직격을 잡몹 단계에서 배움')
  check(colors.has(1), '🟡 광역을 잡몹 단계에서 배움')
  check(colors.has(2), '🔵 속박을 잡몹 단계에서 배움 (이번에 추가)')
  check(colors.has(3), '🟣 끌어당김을 잡몹 단계에서 배움 (이번에 추가)')
  /**
   * ── 🎨 **한 적은 한 질문만 — 그런데 검사가 다른 것을 세고 있었습니다** ──
   *
   * 규칙의 근거는 *"실루엣만 보고 대응이 정해져야 한다"* 입니다. 그건
   * **색 하나**를 뜻하지 패턴 하나를 뜻하지 않습니다 — 같은 색의 두 박자는
   * 답이 여전히 하나입니다.
   *
   * 그런데 이 검사는 `attacks.length === 1`, 즉 **패턴 수**를 셌습니다.
   * 규칙이 아니라 **지금의 구현**을 지키고 있었던 것입니다. 그래서 이 적들에게
   * 박자를 하나 더 주려는 순간(NRFTW 의 적이 매력적인 이유가 그것입니다 —
   * 한 적이 빠른 박자와 느린 박자를 같이 갖습니다) 검사가 막습니다.
   * 색이 늘어나는 것은 여전히 막아야 하지만, 박자가 느는 것은 막을 이유가
   * 없습니다.
   *
   * 그래서 **색의 가짓수**를 셉니다. 규칙은 그대로이고, 검사가 규칙을
   * 보게 된 것입니다.
   */
  const intentsOf = (r) => new Set(r.attacks.map((a) => a.intent))
  check(
    intentsOf(byId.binder).size === 1 && intentsOf(byId.dragger).size === 1,
    '특수 적은 **색이 하나뿐** (한 적 = 한 질문 — 박자는 여럿이어도 됩니다)',
    `얽는 자 색 ${intentsOf(byId.binder).size}개(패턴 ${byId.binder.attacks.length})` +
      ` · 끄는 자 색 ${intentsOf(byId.dragger).size}개(패턴 ${byId.dragger.attacks.length})`,
  )

  // ---- 3. 실루엣이 실제로 다른가 ----
  //
  // 색만 다르면 색약인 사람에게는 전부 같은 적입니다. 키가 확실히 갈려야 합니다.
  /**
   * ── ⚠️ **"모든 쌍"이 아니라 "답이 다른 쌍"입니다** ────────────────
   *
   * 이 검사는 원래 키를 정렬해 **이웃한 두 값**의 차이를 봤습니다. 실제로
   * 이 게임의 키는 1.4 · 1.7 · 2.0 · 2.3 · 2.6 · 2.9 로 **0.3 사다리**가
   * 꽉 차 있고, 그래서 정예(2.15)를 넣는 순간 빨개졌습니다.
   *
   * 그런데 이 규칙이 지키려는 것은 바로 위에 적혀 있습니다 —
   * *"실루엣만 보고 **대응**이 정해져야 한다."* 정예는 잡몹과 **공격
   * 목록이 글자 그대로 같습니다**(enemyAttacks.ts 에서 같은 배열을
   * 가리킵니다). 즉 둘을 헷갈려도 **내야 할 답은 하나도 안 바뀝니다.**
   * 사다리에 자리가 없다고 정예를 보스보다 크게 만들면, 규칙이 아니라
   * **지금의 구현**에 게임을 맞추는 것입니다.
   *
   * 바로 위 「색이 하나뿐」 검사가 이미 같은 교정을 한 번 겪었습니다 —
   * 패턴 수를 세다가 **색의 가짓수**를 세도록 바꾼 그 자리입니다.
   *
   * 그래서 **답이 같은 적끼리는 사다리에서 면제**하되, 면제받은 쌍은
   * 아래에서 *"그래도 눈에 띄게 다른가"* 를 따로 확인합니다. 면제가
   * 공짜가 되면 안 됩니다.
   */
  const answerOf = (r) => r.attacks.map((a) => a.id).join(',')
  let minGap = Infinity
  let closest = ''
  const exempt = []
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const gap = Math.abs(roster[i].height - roster[j].height)
      if (answerOf(roster[i]) === answerOf(roster[j])) {
        exempt.push([roster[i], roster[j]])
        continue
      }
      if (gap < minGap) {
        minGap = gap
        closest = `${roster[i].id}(${roster[i].height})↔${roster[j].id}(${roster[j].height})`
      }
    }
  }
  check(
    Number.isFinite(minGap) && minGap >= 0.29,
    '키 차이가 최소 0.3m 이상 (색약 대비 실루엣 구분) — **답이 다른 적끼리**',
    `가장 가까운 두 종류 ${minGap.toFixed(2)}m — ${closest}`,
  )
  /**
   * 🛡️ 면제받은 쌍(= 같은 답을 요구하는 적들)도 **그냥 같아서는** 안 됩니다.
   *
   * 답이 같아도 *"이놈은 두 배 단단하다"* 는 알아야 물러설지 붙을지를
   * 정할 수 있습니다. 색을 같은 계열로 두었으니(같은 공격이라서) 남는
   * 신호는 **덩치**뿐이고, 그게 실제로 크게 다른지를 봅니다.
   */
  if (exempt.length > 0) {
    /**
     * ⚠️ **큰 쪽을 키로 고르지 않습니다.**
     *
     * 처음엔 *"키가 큰 쪽이 big"* 으로 잡았는데, 정예는 잡몹과 **키가
     * 같습니다.** 그래서 순서가 뒤집혀 `굵기 0.64배` 라는 값이 나왔고,
     * 검사가 *"덩치가 안 갈린다"* 고 말했습니다 — 실제로는 1.56배
     * 두꺼운데도요. 축마다 **큰 쪽 ÷ 작은 쪽**으로 재는 것이 맞습니다.
     */
    const ratio = (x, y) => (Math.min(x, y) > 0 ? Math.max(x, y) / Math.min(x, y) : 0)
    const ratios = exempt.map(([a, b]) => ({
      label: `${a.id}↔${b.id}`,
      h: ratio(a.height, b.height),
      r: ratio(a.radius, b.radius),
    }))
    console.log(
      `  [사다리 면제] 답이 같은 쌍 — ${ratios.map((x) => `${x.label} 키 ${x.h.toFixed(2)}배 · 굵기 ${x.r.toFixed(2)}배`).join(' · ')}`,
    )
    check(
      ratios.every((x) => x.h >= 1.2 || x.r >= 1.2),
      '🛡️ 사다리를 면제받은 쌍도 **덩치로는 확실히 갈린다** (면제가 공짜가 아니게)',
      ratios.map((x) => `${x.label} ${Math.max(x.h, x.r).toFixed(2)}배`).join(' · '),
    )
  }

  // ---- 4. 거리 유지 AI가 작동하는가 ----
  //
  // 없으면 원거리 적이 그냥 걸어 들어와 **약한 잡몹**이 됩니다.
  // 그러면 "파랑을 가르친다"는 이 적의 존재 이유가 사라집니다.
  console.log('')
  const kite = await page.evaluate(async () => {
    const measure = async (kindId) => {
      window.__game.reset()
      await window.__t.runFor(0.4)
      window.__game.clearEnemies()
      const p = window.__game.state().player
      // 일부러 **코앞에** 붙여 놓습니다. 물러나야 정상입니다.
      /**
       * 관측 창을 넉넉히 잡습니다(9초).
       * 끄는 자는 물러나는 도중에도 갈고리를 겁니다(예고 1.15 + 후딜 1.1 = 2.4초).
       * 3초만 재면 그 한 번의 공격에 창을 다 써서 "안 물러난다"로 잘못 나옵니다.
       */
      const e = window.__game.spawnEnemyKind(kindId, p.x + 1.5, p.z)
      await window.__t.runFor(kindId === 'grunt' ? 3.0 : 9.0)
      const info = window.__game.enemyInfo(e)
      const dist = info ? Math.hypot(info.x - p.x, info.z - p.z) : -1
      window.__game.clearEnemies()
      return dist
    }
    return {
      grunt: await measure('grunt'),
      binder: await measure('binder'),
      dragger: await measure('dragger'),
    }
  })
  check(
    kite.binder > 3.5,
    '얽는 자는 코앞에 붙여 놔도 물러남',
    `1.5m에서 시작 → 9초 뒤 ${kite.binder.toFixed(1)}m`,
  )
  check(
    kite.dragger > 6,
    '끄는 자는 더 멀리 물러남',
    `1.5m에서 시작 → 9초 뒤 ${kite.dragger.toFixed(1)}m`,
  )
  check(
    kite.grunt < 3,
    '잡몹은 물러나지 않고 붙음 (근접형은 그대로)',
    `${kite.grunt.toFixed(1)}m`,
  )

  // ---- 5. 실제로 자기 색 예고를 띄우는가 ----
  console.log('')
  const telegraphs = await page.evaluate(async () => {
    const observe = async (kindId, dist) => {
      window.__game.reset()
      await window.__t.runFor(0.4)
      window.__game.clearEnemies()
      const p = window.__game.state().player
      const e = window.__game.spawnEnemyKind(kindId, p.x + dist, p.z)
      const seen = new Set()
      await window.__t.until(() => {
        const info = window.__game.enemyInfo(e)
        if (info?.attacking) seen.add(info.attackId)
        return seen.size > 0
      }, 25)
      const ids = [...seen]
      window.__game.clearEnemies()
      return ids
    }
    return { binder: await observe('binder', 5.5), dragger: await observe('dragger', 10) }
  })
  check(
    telegraphs.binder.includes('binder_web'),
    '얽는 자가 실제로 🔵 거미줄을 씀',
    telegraphs.binder.join(',') || '(관측 없음)',
  )
  check(
    telegraphs.dragger.includes('dragger_hook'),
    '끄는 자가 실제로 🟣 갈고리를 씀',
    telegraphs.dragger.join(',') || '(관측 없음)',
  )

  // ---- 6. 번들 존에 실제로 배치됐는가 ----
  console.log('')
  const placed = await page.evaluate(async () => {
    // 앞 항목들이 clearEnemies() 로 끝나므로 **반드시 다시 불러와야** 합니다.
    // 이걸 빠뜨려서 "번들 존에 0마리"라는 가짜 실패가 났었습니다.
    window.__game.reset()
    await window.__t.runFor(0.5)
    return window.__game.levelRoster()
  })
  console.log(`  [번들 존 배치] ${Object.entries(placed).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  check((placed.binder ?? 0) > 0, '번들 존에 얽는 자가 배치됨', `${placed.binder ?? 0}마리`)
  check((placed.dragger ?? 0) > 0, '번들 존에 끄는 자가 배치됨', `${placed.dragger ?? 0}마리`)

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} catch (err) {
  /**
   * 💥 **도중에 죽으면 반드시 소리를 냅니다.**
   *
   * ── 왜 이게 없어서 한 라운드를 통째로 날렸는가 ────────────────────
   * 이 파일들은 전부 `try { ... } finally { 닫기 }` 뿐이고 **`catch` 가
   * 없었습니다.** 그래서 본문이 도중에 던지면:
   *   · 집계 줄(`N개 통과 / N개 실패`)에 **영영 도달하지 않고**
   *   · 그 아래 `process.exit(fail === 0 ? 0 : 1)` 도 **실행되지 않아**
   *   · 껍데기는 **성공(exit 0)** 처럼 보입니다.
   *
   * 실제로 무기 프로브가 측정 도중 죽었는데 오류 한 줄 없이 exit 0 이었고,
   * 출력이 중간에서 끊긴 것을 눈치채기 전까지 그 숫자를 믿을 뻔했습니다.
   * 이 저장소가 가장 비싸게 여기는 실패 — **아무 말도 안 하는 계측기** —
   * 를 계측기 **전부**가 갖고 있었던 셈입니다(49개 중 49개).
   *
   * 통과하는 검사보다 나쁜 것은 아무 말도 안 하는 검사이고,
   * 그보다 더 나쁜 것은 **죽으면서 성공했다고 말하는 검사**입니다.
   */
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
