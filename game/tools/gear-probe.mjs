/**
 * 🏆 장비 등급·옵션 검증 — `npm run gear`
 *
 * ── 무엇을 묻는가 ──────────────────────────────────────────────────
 * 등급 시스템의 함정은 늘 같습니다 — **표에는 있는데 수치는 안 바뀝니다.**
 * 배너에 「신화 롱소드」가 뜨고 글자에 붉은 금색이 칠해져도, 실제 피해가
 * 그대로면 그건 장비가 아니라 **장식**입니다.
 *
 * 그래서 이 프로브는 **표를 안 봅니다.** 등급을 끼우고 나서
 *   · 피해 배율이 올랐는가
 *   · 동작이 빨라졌는가
 *   · 쿨다운이 짧아졌는가
 *   · 고정 피해가 붙었는가
 * 를 **게임이 실제로 쓰는 값**으로 확인합니다.
 *
 * ── ⚠️ 규칙값은 전부 게임에서 읽습니다 ──────────────────────────────
 * 등급 이름·옵션 개수·배율을 여기 적으면, 표를 손보는 날 **검사만 옛
 * 규칙**을 지킵니다. `gearInfo().tiers` 가 게임이 쓰는 표 그대로입니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5243
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
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🏆 장비 등급·옵션 검증 — 표가 아니라 **수치**를 봅니다\n')

  const rule = await page.evaluate(() => window.__game.gearInfo())
  console.log(
    '  [규칙] ' +
      rule.tiers.map((t) => `${t.name}(옵션 ${t.affixes} ×${t.scale})`).join(' · ') +
      '\n',
  )

  /**
   * ---- 1. 등급이 올라가면 **옵션 수**가 표대로 붙는가 ----
   *
   * 개수는 등급의 절반입니다(나머지 절반은 크기). 여기가 어긋나면
   * 아래 수치 검사가 무엇을 재는지 알 수 없게 됩니다.
   */
  const counts = await page.evaluate(async ([tiers]) => {
    const G = window.__game
    const out = []
    for (const t of tiers) {
      G.setGear(0, t.id, 12345)
      const w = G.gearInfo().weapons[0]
      out.push({ id: t.id, name: t.name, want: t.affixes, got: w.affixes.length, list: w.affixes })
    }
    return out
  }, [rule.tiers])
  for (const c of counts) {
    console.log(
      `    ${c.name.padEnd(4)} 옵션 ${c.got}개 — ` +
        (c.list.map((a) => `${a.name} +${a.value}${a.unit === '%' ? '%' : ''}`).join(' · ') || '없음'),
    )
  }
  check(
    counts.length === rule.tiers.length,
    '🏆 등급을 **하나도 빠짐없이** 끼워 봤다 (검사의 게이트)',
    `${counts.length}/${rule.tiers.length}등급`,
  )
  check(
    counts.length === rule.tiers.length && counts.every((c) => c.got === c.want),
    '🏆 등급마다 붙는 **옵션 수가 표와 같다**',
    counts.map((c) => `${c.name} ${c.got}/${c.want}`).join(' · '),
  )
  check(
    counts.length > 0 && counts.every((c) => new Set(c.list.map((a) => a.kind)).size === c.list.length),
    '🏆 **같은 옵션이 두 번 안 붙는다** (「공격력 +8%, 공격력 +9%」는 한 줄이어야 합니다)',
  )

  /**
   * ---- 2. 같은 시드는 **같은 결과**인가 ----
   *
   * 저장하는 것은 등급과 시드 둘뿐이고 옵션은 매번 다시 계산합니다.
   * 그 계산이 흔들리면 세이브를 불러올 때마다 무기가 달라집니다.
   */
  const stable = await page.evaluate(async () => {
    const G = window.__game
    G.setGear(0, 4, 987654)
    const a = JSON.stringify(G.gearInfo().weapons[0].affixes)
    G.setGear(0, 0, 1)
    G.setGear(0, 4, 987654)
    const b = JSON.stringify(G.gearInfo().weapons[0].affixes)
    G.setGear(0, 4, 987655)
    const c = JSON.stringify(G.gearInfo().weapons[0].affixes)
    return { same: a === b, differentSeed: a !== c, a }
  })
  check(stable.same, '🎲 **같은 시드 = 같은 옵션** (세이브가 무기를 바꾸지 않는다)')
  check(stable.differentSeed, '🎲 시드가 다르면 결과도 다르다 (굴림이 실제로 굴러간다)')

  /**
   * ---- 3. 옵션이 **실제 수치를 바꾸는가** ----
   *
   * 이 프로브의 전부입니다. 옵션 하나만 확실히 붙는 상태를 만들 수 없으므로
   * (굴림은 무작위 종류를 뽑습니다), **시드를 여러 개 굴려** 각 옵션이
   * 붙은 경우를 찾아내고 그때의 값을 봅니다.
   */
  const effects = await page.evaluate(async () => {
    const G = window.__game
    G.setGear(0, 0, 1)
    const base = G.gearInfo().live
    const found = { damage: null, speed: null, cooldown: null, magic: null }
    for (let seed = 1; seed <= 400; seed++) {
      G.setGear(0, 1, seed) // 레어 = 옵션 하나 → 어느 옵션인지 확실합니다
      const w = G.gearInfo()
      const a = w.weapons[0].affixes[0]
      if (!a) continue
      const key = ['damage', 'speed', 'cooldown', 'magic'][a.kind]
      if (found[key]) continue
      found[key] = { value: a.value, live: w.live }
      if (Object.values(found).every(Boolean)) break
    }
    return { base, found }
  })
  const f = effects.found
  console.log(
    `\n  [기준] 일반 — 피해 ×${effects.base.damageMult} · 속도 ×${effects.base.speedScale}` +
      ` · 쿨 ×${effects.base.cooldownScale} · 마법 +${effects.base.magicFlat}\n`,
  )
  check(
    !!f.damage && !!f.speed && !!f.cooldown && !!f.magic,
    '🔎 옵션 **네 종류를 다 만들어 봤다** (못 만든 것을 조용히 건너뛰지 않게)',
    Object.entries(f).map(([k, v]) => `${k}${v ? '✓' : '✗'}`).join(' '),
  )
  if (f.damage) {
    check(
      f.damage.live.damageMult > effects.base.damageMult,
      '⚔️ 공격력 옵션이 **피해 배율을 올린다**',
      `+${f.damage.value}% → ×${effects.base.damageMult} → ×${f.damage.live.damageMult}`,
    )
  }
  if (f.speed) {
    check(
      f.speed.live.speedScale < effects.base.speedScale,
      '⚡ 공속 옵션이 **동작을 짧게 만든다**',
      `+${f.speed.value}% → ×${effects.base.speedScale} → ×${f.speed.live.speedScale}`,
    )
  }
  if (f.cooldown) {
    check(
      f.cooldown.live.cooldownScale < effects.base.cooldownScale,
      '⏱ 쿨타임 옵션이 **쿨다운을 짧게 만든다**',
      `+${f.cooldown.value}% → ×${effects.base.cooldownScale} → ×${f.cooldown.live.cooldownScale}`,
    )
  }
  if (f.magic) {
    check(
      f.magic.live.magicFlat > 0 && effects.base.magicFlat === 0,
      '✨ 마법 옵션이 **고정 피해를 얹는다**',
      `+${f.magic.value} → +${effects.base.magicFlat} → +${f.magic.live.magicFlat}`,
    )
  }

  /**
   * ---- 4. 손에 든 칼이 **실제로 세게 때리는가** ----
   *
   * 위 3번은 배율이라는 **중간값**을 봤습니다. 중간값이 맞아도 배선이
   * 끊겨 있으면 피해는 그대로일 수 있습니다 — 이 저장소가 여러 번 데인
   * 모양입니다(*"규칙은 맞는데 배선이 끊김"*). 그래서 **적을 세워 놓고
   * 실제로 때려서** 체력이 얼마나 깎이는지 봅니다.
   */
  const swing = await page.evaluate(async () => {
    const G = window.__game
    window.__t = {
      runFor: async (s) => {
        const t = G.state().elapsed + s
        const d = Date.now() + 60000
        while (G.state().elapsed < t && Date.now() < d) await new Promise((r) => setTimeout(r, 8))
      },
    }
    const hitOnce = async () => {
      G.clearEnemies()
      const foe = G.spawnEnemyKind('grunt', 2.0, 0, true)
      G.teleportPlayer(0, 0)
      G.aimAtWorld(2.0, 0)
      await window.__t.runFor(0.3)
      const before = G.enemyInfo(foe).hp
      G.press('Mouse0')
      await window.__t.runFor(0.05)
      G.release('Mouse0')
      await window.__t.runFor(0.9)
      const after = G.enemyInfo(foe).hp
      return Number((before - after).toFixed(1))
    }
    G.setGear(0, 0, 1)
    const common = await hitOnce()
    // 옵션 넷이 다 붙는 등급으로 — 어떤 조합이 나와도 **약해질 수는 없습니다.**
    G.setGear(0, 4, 987654)
    const mythic = await hitOnce()
    return { common, mythic, affixes: G.gearInfo().weapons[0].affixes }
  })
  console.log(
    `\n  [실제 타격] 일반 ${swing.common} → 신화 ${swing.mythic}` +
      ` (${swing.affixes.map((a) => `${a.name}+${a.value}`).join(' · ')})\n`,
  )
  check(swing.common > 0, '🗡 두 등급 모두 **실제로 때렸다** (비교의 게이트)', `일반 ${swing.common}`)
  check(
    swing.mythic > swing.common,
    '🗡 **신화가 일반보다 실제로 세게 때린다** (배율이 아니라 깎인 체력으로)',
    `${swing.common} → ${swing.mythic} (+${(swing.mythic - swing.common).toFixed(1)})`,
  )

  /**
   * ---- 4.5. **화려함이 화면에 실제로 나오는가** ----
   *
   * 이걸 스크린샷으로 확인하려다 배웠습니다 — 두 장의 **애니메이션 시점이
   * 달라서** 픽셀 비교가 색이 아니라 타이밍을 재고 있었습니다. 그래서
   * **그린 값**을 직접 묻습니다(`swingColor`).
   *
   * ⚠️ 손에 든 무기의 빛은 **안 잽니다.** 이 카메라에서 캐릭터는 40px
   *    남짓이라 칼의 광택은 화면에서 몇 픽셀도 안 됩니다 — 그래서 등급을
   *    **휘두른 자국**에 얹었습니다(vfx.ts `spawnSwing` 주석). 여기서
   *    재는 것은 *"플레이어가 실제로 보게 되는 것"* 입니다.
   */
  const trail = await page.evaluate(async () => {
    const G = window.__game
    const swingOf = async (tier) => {
      G.clearEnemies()
      G.setGear(0, tier, 987654)
      G.teleportPlayer(0, 0)
      G.spawnEnemyKind('grunt', 2.2, 0, true)
      G.aimAtWorld(2.2, 0)
      await window.__t.runFor(0.35)
      G.press('Mouse0')
      await window.__t.runFor(0.05)
      G.release('Mouse0')
      // 자국이 뜨는 프레임을 **게임에게 물어서** 잡습니다(0.19초라 폴링으로는 놓칩니다).
      for (let i = 0; i < 200; i++) {
        const c = G.swingColor()
        if (c >= 0) return c
        await new Promise((r) => setTimeout(r, 6))
      }
      return -1
    }
    return { common: await swingOf(0), mythic: await swingOf(4) }
  })
  const hex = (n) => (n < 0 ? '없음' : `#${n.toString(16).padStart(6, '0')}`)
  check(
    trail.common >= 0 && trail.mythic >= 0,
    '✨ 두 등급 모두 **검격 자국을 실제로 잡았다** (비교의 게이트)',
    `${hex(trail.common)} / ${hex(trail.mythic)}`,
  )
  check(
    trail.common !== trail.mythic,
    '✨ **등급이 검격 자국의 색을 바꾼다** (화려함이 화면에 나온다)',
    `일반 ${hex(trail.common)} → 신화 ${hex(trail.mythic)}`,
  )

  /**
   * ---- 5. 존에서 **상자마다 다른 것이 나오는가** ----
   *
   * 이 시스템을 만든 이유가 이 한 줄입니다: *"다섯 번째 상자를 여는 이유가
   * 첫 번째와 달라야 한다."* 등급이 다 같으면 시스템은 있으나 마나입니다.
   *
   * ⚠️ 열어 보지 않고 **자리에서** 계산합니다. 봇을 돌려 다섯 상자를
   *    실제로 여는 것은 이 검사가 아니라 자동 플레이의 몫이고, 여기서는
   *    *"규칙이 다양한 결과를 내는가"* 만 봅니다.
   */
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })
  const chests = await page.evaluate(() => {
    const G = window.__game
    const info = G.gearInfo()
    const out = G.treasureRolls()
    return { out, tiers: info.tiers }
  })
  for (const c of chests.out) {
    console.log(
      `    상자(${c.x},${c.z}) 진행도 ${(c.luck * 100).toFixed(0)}% → **${c.tierName}**` +
        (c.affixes.length ? ` — ${c.affixes.map((a) => `${a.name}+${a.value}`).join(' · ')}` : ''),
    )
  }
  check(chests.out.length > 0, '🎁 존의 상자를 실제로 읽었다 (검사의 게이트)', `${chests.out.length}개`)
  check(
    new Set(chests.out.map((c) => c.tier)).size > 1,
    '🎁 **상자마다 나오는 등급이 다르다** (다섯 번째를 여는 이유가 첫 번째와 다르다)',
    chests.out.map((c) => c.tierName).join(' · '),
  )
  check(
    chests.out.length > 0 && chests.out.every((c, i) => i === 0 || c.luck >= chests.out[i - 1].luck - 0.001),
    '🎁 뒤에 있는 상자일수록 **진행도가 높다** (등급을 미는 값이 실제로 커진다)',
    chests.out.map((c) => `${(c.luck * 100).toFixed(0)}%`).join(' → '),
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 (notice-probe.mjs 의 같은 주석 참고).
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
