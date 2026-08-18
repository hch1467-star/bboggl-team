/**
 * 🛡️ 정예 검증 — `npm run elite`
 *
 * ── 이 적이 존재하는 이유는 **빈칸을 메우는 것**입니다 ────────────────
 * 적의 체력이 잡몹 58 · 보스 620 이라 그 사이가 10.7배로 비어 있었고,
 * 그 빈칸 때문에 두 시스템이 **보스전에서 처음** 만나집니다:
 *
 *   · 🩸 출혈 — 채우는 데 6대가 필요한데 잡몹은 2.8대에 죽습니다
 *   · 🥋 집중 — 판마다 35.7점이 넘쳐서 버려집니다(강타 쓸 곳이 없어서)
 *
 * 그래서 이 프로브가 묻는 것은 *"정예가 있는가"* 가 아니라
 * **"그 빈칸이 실제로 메워졌는가"** 입니다:
 *
 *   ① 잡몹과 **같은 공격**을 쓰는가 (새로 외울 것이 안 늘었는가)
 *   ② **평타로는 안 무너지고 강타로는 무너지는가** (집중의 쓸 곳)
 *   ③ **죽기 전에 출혈이 차는가** (이 존에서 처음으로)
 *   ④ 화면에서 **잡몹과 구별되는가**
 *
 * ⚠️ ①~③ 은 전부 **게임을 실제로 때려서** 잽니다. 설정 표를 읽어
 *    비교하면 "표에는 그렇게 적혀 있다"만 확인하는 것이고, 이 저장소는
 *    그 함정을 여러 번 밟았습니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5252
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const server = await createServer({ root: ROOT, server: { port: PORT }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: execPath,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  await page.evaluate(() => {
    window.__t = {
      runFor: async (s) => {
        const G = window.__game
        const t = G.state().elapsed + s
        const d = Date.now() + 60000
        while (G.state().elapsed < t && Date.now() < d) await new Promise((r) => setTimeout(r, 8))
      },
    }
  })

  console.log('\n🛡️ 정예 검증 — 표가 아니라 **때려 보고** 묻습니다\n')

  /**
   * ---- 0. 게이트 — 존에 실제로 서 있는가 ----
   *
   * 표에만 있고 레벨에 없으면 아래 검사는 전부 실험실 이야기입니다.
   */
  const placed = await page.evaluate(() => {
    const G = window.__game
    const foes = G.levelFoes()
    return {
      elites: foes.filter((f) => f.kind === 'elite').map((f) => ({ x: f.x, z: f.z })),
      total: foes.length,
      roster: G.enemyRoster().map((r) => ({ id: r.id, hp: r.maxHp, poise: r.poiseMax, height: r.height })),
    }
  })
  const eliteDef = placed.roster.find((r) => r.id === 'elite')
  const gruntDef = placed.roster.find((r) => r.id === 'grunt')
  const bossDef = placed.roster.find((r) => r.id === 'boss')
  console.log(
    `  [표] 체력·강인도 — 잡몹 ${gruntDef?.hp}·${gruntDef?.poise}  →  ` +
      `정예 ${eliteDef?.hp}·${eliteDef?.poise}  →  보스 ${bossDef?.hp}·${bossDef?.poise}`,
  )
  check(
    placed.elites.length === 1,
    '🛡️ 존에 정예가 **정확히 하나** 서 있다 (둘이면 이정표가 아니라 새 난이도 구간입니다)',
    placed.elites.map((e) => `(${e.x.toFixed(0)},${e.z.toFixed(0)})`).join(' · ') || '없음',
  )
  check(
    !!eliteDef && !!gruntDef && !!bossDef && eliteDef.hp > gruntDef.hp * 2 && eliteDef.hp < bossDef.hp / 2,
    '🛡️ 체력이 **잡몹과 보스 사이**에 있다 (메우려던 빈칸이 이것입니다)',
    `${gruntDef?.hp} < ${eliteDef?.hp} < ${bossDef?.hp}`,
  )

  /**
   * ---- 1. **같은 공격 목록인가** ----
   *
   * 이 적의 계약이 *"새로 배우는 자리가 아니라 배운 것을 시험하는 자리"*
   * 입니다. 새 패턴을 주면 그 문장이 거짓이 됩니다.
   *
   * ⚠️ 설정 표를 읽지 않고 **게임에게 세워 보라고 시킵니다**(`forceAttack`).
   *    표에 같이 적혀 있어도 배선이 갈리면 화면에서 다른 것이 나옵니다.
   */
  const patterns = await page.evaluate(async () => {
    const G = window.__game
    G.reset()
    await window.__t.runFor(0.5)
    G.clearEnemies()
    await window.__t.runFor(0.2)
    const p = G.state().player
    const out = {}
    for (const id of ['grunt', 'elite']) {
      const e = G.spawnEnemyKind(id, p.x + 30, p.z + 30)
      const ids = []
      for (let i = 0; i < 6; i++) {
        const name = G.forceAttack(e, i)
        if (name && !ids.includes(name)) ids.push(name)
      }
      out[id] = ids
    }
    G.clearEnemies()
    return out
  })
  console.log(`  [패턴] 잡몹 ${patterns.grunt.join(' · ')}  |  정예 ${patterns.elite.join(' · ')}`)
  check(
    patterns.grunt.length > 0 && patterns.elite.length > 0,
    '🚧 두 적의 패턴을 실제로 세웠다 (비교의 게이트)',
    `${patterns.grunt.length}개 / ${patterns.elite.length}개`,
  )
  check(
    patterns.grunt.length > 0 &&
      patterns.grunt.length === patterns.elite.length &&
      patterns.grunt.every((id, i) => id === patterns.elite[i]),
    '🛡️ 정예는 **잡몹과 똑같은 공격**을 쓴다 (새로 외울 것이 안 늘었다)',
    patterns.elite.join(' · '),
  )

  /**
   * ---- 2. **몇 대를 몰아쳐야 무너지는가** ----
   *
   * ── ❌ 처음엔 *"평타로는 안 무너진다"* 를 재려 했고, 틀렸습니다 ────
   * 첫 실행이 이렇게 나왔습니다 — **잡몹도 정예도 평타 6대에 무너짐 O.**
   * 강인도를 55 로 올려도 여섯 대를 **끊기지 않고** 넣으면 무너집니다.
   * 당연합니다: 강인도는 *"한 번에 몰아치면 무너진다"* 는 규칙이고,
   * 얼어붙은 적에게 스태미나 무한으로 여섯 대를 넣는 것은 **몰아친 것**
   * 입니다. 제가 세운 문장(*"평타로는 못 무너뜨린다"*)이 이 게임의 규칙과
   * 애초에 어긋나 있었습니다.
   *
   * ── 그래서 묻는 것을 바꿉니다 ────────────────────────────────────
   * 진짜 차이는 **몇 대를 이어 붙여야 하는가**입니다. 실전에서 그 타수를
   * 못 채우면(정예가 반격하니까) 답이 **강타**가 되고, 그게 넘쳐서
   * 버려지던 집중의 쓸 곳입니다. 이건 *"되냐 안 되냐"* 가 아니라
   * **얼마나 비싼가**의 문제라, 숫자로 재야 합니다.
   */
  const poise = await page.evaluate(async () => {
    const G = window.__game
    const out = {}
    for (const id of ['grunt', 'elite']) {
      G.reset()
      await window.__t.runFor(0.4)
      G.clearEnemies()
      await window.__t.runFor(0.2)
      const p = G.state().player
      const e = G.spawnEnemyKind(id, p.x + 1.6, p.z)
      G.setHp(e, 100000) // 죽어서 끝나면 강인도를 못 잽니다
      G.freezeEnemies(true)
      G.aimAtWorld(p.x + 1.6, p.z)
      await window.__t.runFor(0.3)
      // ① 평타를 이어 붙여 **무너질 때까지** — 몇 대인가
      let basicHits = 0
      for (let i = 0; i < 30; i++) {
        G.setStamina(999)
        G.setFocus(0) // 집중 0 — 강타가 섞일 여지를 없앱니다
        G.press('Mouse0')
        G.release('Mouse0')
        await window.__t.runFor(0.25)
        basicHits++
        if (G.enemyInfo(e)?.broken) break
      }
      const brokeAt = G.enemyInfo(e)?.broken ? basicHits : -1
      // ② 강인도가 다 찰 때까지 쉬었다가, **강타 한 방**이 얼마나 깎는가
      await window.__t.runFor(4)
      const before = G.enemyInfo(e).poise
      G.setStamina(999)
      G.setFocus(3)
      G.press('Mouse2')
      G.release('Mouse2')
      await window.__t.runFor(1.2)
      const after = G.enemyInfo(e)
      out[id] = {
        poiseMax: after.poiseMax,
        brokeAt,
        heavyCut: Number(Math.max(0, before - after.poise).toFixed(1)),
        brokeOnHeavy: after.broken,
      }
      G.clearEnemies()
    }
    G.freezeEnemies(false)
    return out
  })
  console.log(
    `  [강인도] 잡몹 ${poise.grunt.poiseMax} — 평타 **${poise.grunt.brokeAt}대**에 무너짐 · 강타 한 방 -${poise.grunt.heavyCut}\n` +
      `           정예 ${poise.elite.poiseMax} — 평타 **${poise.elite.brokeAt}대**에 무너짐 · 강타 한 방 -${poise.elite.heavyCut}${poise.elite.brokeOnHeavy ? ' (무너짐)' : ''}`,
  )
  check(
    poise.grunt.brokeAt > 0 && poise.elite.brokeAt > 0,
    '🚧 두 적 모두 실제로 무너뜨렸다 (비교의 게이트)',
    `${poise.grunt.brokeAt}대 / ${poise.elite.brokeAt}대`,
  )
  /**
   * ⚠️ **두 배를 요구합니다 — 한 대 차이로는 안 됩니다.**
   *
   * 처음엔 `>` 하나였고 `잡몹 3대 → 정예 4대` 로 초록이 됐습니다.
   * 강인도를 30 → 55 로 올렸는데 **싸우는 법이 하나도 안 바뀌는** 상태를
   * 통과시킨 것입니다. 한 칸 차이의 초록은 기준선이 아니라 운입니다.
   */
  check(
    poise.elite.brokeAt >= poise.grunt.brokeAt * 2,
    '🥋 정예는 **두 배 넘게 몰아쳐야** 무너진다 (연타 한 번으로는 안 됩니다)',
    `잡몹 ${poise.grunt.brokeAt}대 → 정예 ${poise.elite.brokeAt}대`,
  )
  check(
    poise.elite.heavyCut > 0 && poise.elite.heavyCut >= poise.elite.poiseMax / poise.elite.brokeAt * 2,
    '🥋 **강타 한 방이 평타 여러 대 값이다** (넘쳐서 버려지던 집중의 쓸 곳)',
    `강타 -${poise.elite.heavyCut} vs 평타 한 대 ≈ -${(poise.elite.poiseMax / poise.elite.brokeAt).toFixed(1)}`,
  )

  /**
   * ---- 3. **죽기 전에 출혈이 차는가** ----
   *
   * `npm run bleed` 가 적어 둔 그 빈칸입니다 — 출혈은 6대를 버티는 적이
   * 필요한데 잡몹은 2.8대에 죽습니다. 정예가 그 자리를 메우는지를
   * **때려 보고** 확인합니다. 무기는 가장 잘 쌓는 것(쌍단검)으로.
   */
  const bleed = await page.evaluate(async () => {
    const G = window.__game
    const info = G.bleedInfo()
    const best = info.weapons.reduce((a, b) => (b.bleedScale > a.bleedScale ? b : a))
    const slot = info.weapons.findIndex((w) => w.id === best.id) + 1
    const out = {}
    for (const id of ['grunt', 'elite']) {
      G.reset()
      await window.__t.runFor(0.4)
      G.clearEnemies()
      await window.__t.runFor(0.2)
      G.press(`Digit${slot}`)
      G.release(`Digit${slot}`)
      await window.__t.runFor(0.4)
      const p = G.state().player
      const e = G.spawnEnemyKind(id, p.x + 1.5, p.z)
      G.freezeEnemies(true)
      G.aimAtWorld(p.x + 1.5, p.z)
      await window.__t.runFor(0.3)
      let peak = 0
      /**
       * ⚠️ **누른 횟수가 아니라 들어간 타격**을 셉니다.
       *
       * 처음엔 누른 횟수를 셌고 `정예 13대` 로 찍혔는데, 실제로 들어간
       * 것은 그보다 훨씬 적었습니다(콤보에는 선행동작·후딜이 있습니다).
       * 그 숫자로는 *"몇 대를 버티는 적인가"* 를 못 말합니다. 체력이
       * 줄어든 프레임만 셉니다 — **맞은 쪽이 셉니다.**
       */
      let hits = 0
      let popped = 0
      let lastHp = G.enemyInfo(e).hp
      // 죽을 때까지 붙어서 때립니다 — 실제 플레이에서 이 적이 사는 시간이
      // 곧 이 축이 쓸 수 있는 시간입니다.
      for (let i = 0; i < 200; i++) {
        const cur = G.enemyInfo(e)
        if (!cur || cur.hp <= 0) break
        G.setStamina(999)
        G.setFocus(0)
        G.press('Mouse0')
        G.release('Mouse0')
        await window.__t.runFor(0.1)
        const b = G.enemyInfo(e)
        if (!b || b.hp <= 0) break
        if (b.hp < lastHp - 0.01) hits++
        lastHp = b.hp
        // 🩸 **그려진 바**에서 읽습니다 — 규칙을 다시 계산하지 않고
        //    화면에 실제로 놓인 값을 묻는 이 저장소의 규약 그대로입니다.
        const bar = G.bleedBars().find((x) => x.entity === e)
        const val = bar?.bleed ?? 0
        // 터지면 0 으로 돌아갑니다 — 되돌아간 순간이 곧 **문턱에 닿은** 순간.
        if (val < peak - 1 && peak >= (bar?.max ?? 1e9) - 20) popped++
        peak = Math.max(peak, val)
      }
      out[id] = { peak: Number(peak.toFixed(1)), hits, popped, weapon: best.id }
      G.clearEnemies()
    }
    G.freezeEnemies(false)
    return { out, threshold: info.maxByKind }
  })
  const gruntMax = bleed.threshold.find((m) => m.id === 'grunt')?.max ?? 0
  const eliteMax = bleed.threshold.find((m) => m.id === 'elite')?.max ?? 0
  console.log(
    `  [출혈 · ${bleed.out.elite.weapon}] 잡몹 최고 ${bleed.out.grunt.peak}/${gruntMax} · 들어간 타격 ${bleed.out.grunt.hits}대 · 터짐 ${bleed.out.grunt.popped}회` +
      `  |  정예 최고 ${bleed.out.elite.peak}/${eliteMax} · ${bleed.out.elite.hits}대 · 터짐 ${bleed.out.elite.popped}회`,
  )
  check(
    bleed.out.grunt.hits > 0 && bleed.out.elite.hits > 0,
    '🚧 두 적 모두 실제로 때렸다 (비교의 게이트)',
    `${bleed.out.grunt.hits}대 / ${bleed.out.elite.hits}대`,
  )
  check(
    bleed.out.elite.hits > bleed.out.grunt.hits * 2,
    '🩸 정예는 잡몹보다 **두 배 넘게 버틴다** (쌓을 시간이 있다)',
    `${bleed.out.grunt.hits}대 → ${bleed.out.elite.hits}대`,
  )
  check(
    bleed.out.elite.popped > 0 && bleed.out.grunt.popped === 0,
    '🩸 **정예에게서는 출혈이 터지고, 잡몹에게서는 안 터진다** (보스 말고 처음으로 이 축이 완결되는 자리)',
    `잡몹 최고 ${bleed.out.grunt.peak}/${gruntMax}(터짐 ${bleed.out.grunt.popped}) · 정예 ${bleed.out.elite.peak}/${eliteMax}(터짐 ${bleed.out.elite.popped})`,
  )

  /**
   * ---- 4. **화면에서 구별되는가** ----
   *
   * 색은 일부러 같은 계열(잡몹의 붉은색을 가라앉힌 것)이고, **키도
   * 잡몹과 똑같습니다** — 색약 대비 키 사다리(0.3m 간격)에 빈칸이
   * 없었기 때문입니다(balance.ts `ELITE.height` 주석). 그래서 남은
   * 신호는 **굵기 하나뿐**이고, 그게 이 줌에서 실제로 읽히는지는
   * **화면 픽셀로** 재야 압니다.
   *
   * ⚠️ 화면 폭은 카메라의 **오른쪽 축**을 따라 잽니다. 월드 X 로 재면
   *    쿼터뷰 45° 때문에 실제로 화면에서 벌어지는 폭과 어긋납니다.
   */
  const sil = await page.evaluate(async () => {
    const G = window.__game
    G.reset()
    await window.__t.runFor(0.4)
    G.clearEnemies()
    await window.__t.runFor(0.2)
    const p = G.state().player
    const cam = G.cameraAxes()
    const out = {}
    for (const [id, dx] of [['grunt', 2], ['elite', -2]]) {
      const e = G.spawnEnemyKind(id, p.x + dx, p.z)
      await window.__t.runFor(0.3)
      const st = G.entityState(e)
      const def = G.enemyRoster().find((r) => r.id === id)
      /**
       * ⚠️ **발밑 높이를 0 으로 둡니다.**
       *
       * `entityState` 에는 y 가 **없습니다**(x·z 뿐). 처음엔 `st.y` 를 썼고,
       * `screenPos(x, undefined, z)` 가 조용히 null 을 돌려주어 두 값이
       * 나란히 -1 이 되었습니다. 그리고 -1 ≥ -1.2 라서 **검사가 초록으로
       * 통과했습니다.** 이 카메라는 직교 투영이라 같은 길이의 수직선은
       * 세계 어디에 있든 화면에서 같은 픽셀이므로 0 과 h 로 재도 정확합니다.
       */
      const foot = G.screenPos(st.x, 0, st.z)
      const head = G.screenPos(st.x, def.height, st.z)
      const left = G.screenPos(st.x - def.radius * cam.rightX, 0, st.z - def.radius * cam.rightZ)
      const right = G.screenPos(st.x + def.radius * cam.rightX, 0, st.z + def.radius * cam.rightZ)
      // 못 잰 것은 -1 로 둡니다 — **0 으로 세지 않습니다.**
      out[id] = {
        h: foot && head ? Number(Math.abs(foot.sy - head.sy).toFixed(1)) : -1,
        w: left && right ? Number(Math.abs(left.sx - right.sx).toFixed(1)) : -1,
      }
    }
    G.clearEnemies()
    return out
  })
  console.log(
    `  [실루엣] 화면 크기 — 잡몹 ${sil.grunt.w}×${sil.grunt.h}px · 정예 ${sil.elite.w}×${sil.elite.h}px`,
  )
  check(
    sil.grunt.w > 0 && sil.elite.w > 0 && sil.grunt.h > 0 && sil.elite.h > 0,
    '🚧 두 적의 화면 크기를 실제로 읽었다 (비교의 게이트)',
    `${sil.grunt.w}×${sil.grunt.h} / ${sil.elite.w}×${sil.elite.h}`,
  )
  check(
    sil.grunt.h > 0 && Math.abs(sil.elite.h - sil.grunt.h) < 1,
    '📏 키는 **잡몹과 같다** (색약 대비 키 사다리를 안 건드립니다 — 설계대로)',
    `${sil.grunt.h}px vs ${sil.elite.h}px`,
  )
  check(
    sil.grunt.w > 0 && sil.elite.w >= sil.grunt.w * 1.3,
    '📏 그런데 화면에서 **확실히 두껍다** (색도 키도 같으니 굵기가 유일한 신호입니다)',
    `${sil.grunt.w}px → ${sil.elite.w}px (${(sil.elite.w / sil.grunt.w).toFixed(2)}배)`,
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 — 아래 숫자는 완결된 것이 아닙니다.
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
