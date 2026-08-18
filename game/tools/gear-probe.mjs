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
import { decodePng, deltaE } from './png.mjs'

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


  /**
   * ---- ✨ **등급이 걸어다닐 때도 보이는가** ----
   *
   * ── 이 검사가 왜 픽셀까지 내려가는가 ──────────────────────────────
   * 등급을 눈에 보이게 하려고 두 번 실패했습니다. 두 번 다 **코드는
   * 옳았고 화면에 없었습니다**:
   *   1. 무기 모델의 발광 — 이 줌에서 칼은 몇 픽셀이라 안 보였습니다
   *   2. 휘두른 자국 물들임 — 보이지만 **휘두를 때만** 보입니다
   *
   * 그래서 세 번째(알갱이)는 *"몇 개 만들었는가"* 로 끝내지 않고
   * **화면이 실제로 밝아졌는가**까지 봅니다.
   *
   * ── 🚧 게이트가 먼저입니다 ────────────────────────────────────────
   * 두 장의 차이를 세는 계측기는 **장면이 가만히 있을 때만** 뜻이 있습니다.
   * 실제로 처음 만든 판이 그래서 틀렸습니다 — 첫 장이 그림자·셰이더가
   * 덜 올라온 어두운 장이라, **일반과 일반을 비교해도 5,300 픽셀**이
   * 밝아진 것으로 나왔습니다. 그 눈금으로는 무엇을 재도 초록입니다.
   *
   * 그래서 순서가 이렇습니다:
   *   ① 예열 한 장을 버리고
   *   ② **일반을 두 번 찍어 그 차이가 0인지** 먼저 확인하고 (게이트)
   *   ③ 그 다음에야 등급별 차이를 셉니다
   *
   * ── 한 장으로 안 세는 이유 ────────────────────────────────────────
   * 알갱이는 오르내리므로 **순간마다 밝은 개수가 다릅니다.** 한 장만
   * 보면 전설(10개)이 유니크(5개)보다 어두운 장이 나옵니다 — 실제로
   * 첫 측정에서 97 대 104 로 뒤집혔습니다. 한 바퀴를 세 조각으로 나눠
   * 찍어 더합니다. **한 칸 차이의 초록은 기준선이 아니라 운입니다.**
   */
  console.log('\n  ── ✨ 등급 불티 — 만든 개수가 아니라 **밝아진 화면**을 셉니다')
  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
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
  /**
   * ---- 🗡️ **무기마다 불티의 성격이 다른가** ----
   *
   * 사용자가 요청한 것은 *"무기마다 다른 이펙트"* 였습니다. 그런데 이
   * 차이를 **새 설정값으로 적지 않았습니다** — 무기가 이미 가진
   * `moveSpeedScale`("가벼움")에서 유도합니다. 새 표를 만들면 무기를
   * 무겁게 고쳤을 때 불티만 여전히 빠른 그림이 남습니다.
   *
   * 그래서 여기서 확인할 것은 *"두 무기가 다른가"* 가 아니라
   * **"무거운 쪽이 크고 느린가"** 입니다 — 방향이 맞아야 유도가 맞습니다.
   */
  const byWeapon = await page.evaluate(async () => {
    const G = window.__game
    const out = []
    for (let w = 0; w < 3; w++) {
      // 무기 교체는 **사람과 같은 길**로 합니다(숫자키). 전용 통로를 만들면
      // 창에만 있는 조건을 안 지나가고, 그건 이 저장소가 여러 번 데인 함정입니다.
      G.press(`Digit${w + 1}`)
      G.release(`Digit${w + 1}`)
      G.setGear(w, 4, 4242)
      await window.__t.runFor(0.6)
      const a1 = G.auraInfo()
      const y1 = a1.motes.map((m) => m.y)
      await window.__t.runFor(0.2)
      const a2 = G.auraInfo()
      // 같은 번호의 알갱이가 0.2초 동안 얼마나 올랐는가 = 오르는 속도.
      // (꼭대기에서 되돌아온 알갱이는 음수가 되므로 버립니다.)
      const ups = a2.motes.map((m, i) => m.y - (y1[i] ?? m.y)).filter((d) => d > 0)
      out.push({
        weapon: G.gearInfo().weapons[w].name,
        // ⚠️ **그림이 실제로 쓴 무기 번호**를 같이 적습니다. 이게 없으면
        //    무기가 안 바뀌어도 세 줄이 얌전히 찍히고, 값이 셋 다 같은
        //    이유를 못 찾습니다(첫 실행에서 정확히 그랬습니다).
        drawn: a1.weapon,
        hp: G.state().player.hp,
        size: a1.motes.length ? a1.motes.reduce((s, m) => s + m.size, 0) / a1.motes.length : 0,
        rise: ups.length ? ups.reduce((s, d) => s + d, 0) / ups.length / 0.2 : 0,
      })
    }
    return out
  })
  for (const w of byWeapon) {
    console.log(
      `    ${w.weapon.padEnd(5)} (그린 무기 ${w.drawn} · 체력 ${w.hp}) 알갱이 크기 ${w.size.toFixed(3)}m · 오르는 속도 ${w.rise.toFixed(2)}m/s`,
    )
  }
  check(
    byWeapon.length === 3 && byWeapon.every((w, i) => w.drawn === i),
    '🚧 **무기가 실제로 바뀌었다** (안 바뀌면 아래 두 줄은 같은 무기를 세 번 잰 것입니다)',
    byWeapon.map((w) => `${w.weapon}→${w.drawn}`).join(' · '),
  )
  const heavy = byWeapon.find((w) => w.weapon === '대검') ?? byWeapon[1]
  const quick = byWeapon[2]
  check(
    byWeapon.length === 3 && byWeapon.every((w) => w.size > 0 && w.rise > 0),
    '🗡️ 세 무기 모두 불티가 실제로 오른다 (검사의 게이트)',
    byWeapon.map((w) => `${w.weapon} ${w.rise.toFixed(2)}m/s`).join(' · '),
  )
  check(
    !!heavy && !!quick && heavy.size > quick.size && heavy.rise < quick.rise,
    '🗡️ **무거운 무기의 불티가 더 크고 더 느리다** (무기의 무게에서 유도했다는 증거)',
    `${heavy?.weapon} ${heavy?.size.toFixed(2)}m/${heavy?.rise.toFixed(2)}m/s vs ${quick?.weapon} ${quick?.size.toFixed(2)}m/${quick?.rise.toFixed(2)}m/s`,
  )

  /**
   * 🔥 **오래 예열합니다.**
   *
   * 처음엔 7초만 기다렸고, 아래 게이트가 바로 잡았습니다 —
   * `일반 다시 재기 → 밝아진 픽셀 6,549`. 즉 첫 장이 아직 어두웠고,
   * 그 뒤 장들은 전부 *"등급 때문에 밝아진 것"* 으로 세어지고 있었습니다.
   * (그 눈금으로는 신화와 일반이 6,960 대 6,549 로 **거의 같습니다.**)
   * 게이트가 없었으면 이 초록을 그대로 믿었을 것입니다.
   */
  /**
   * ── 🧟 **적을 먼저 치웁니다 — 안 그러면 시체를 재게 됩니다** ────────
   *
   * 이 구역은 정적인 장면이 필요합니다(아래 픽셀 비교). 그런데 훈련장의
   * 허수아비들은 가만히 서 있는 플레이어를 **실제로 죽입니다.** 처음엔
   * 그대로 뒀고, 결과가 조용히 이상했습니다:
   *
   *   · 픽셀 게이트는 **통과했습니다** — 이미 죽어서 장면이 안 움직였으니까
   *   · 그런데 그 아래 무기 검사가 세 무기 다 `그린 무기 0` 으로 나왔습니다
   *
   * 원인은 `playerControl` 의 첫 줄입니다 — **죽은 자는 무기를 못 바꿉니다.**
   * 즉 이 프로브는 40초 동안 시체 옆에서 등급 효과를 재고 있었습니다.
   * 두 번째 게이트(무기가 실제로 바뀌었는가)가 없었으면 못 봤을 것입니다.
   */
  await page.evaluate(async () => {
    const G = window.__game
    G.clearEnemies()
    /**
     * ⚠️ **첫 무기로 되돌립니다.** 바로 위 검사가 쌍단검(신화)으로 끝내
     * 놓기 때문입니다. 안 되돌리면 `setGear(0, ...)` 이 **안 든 무기**의
     * 등급만 바꾸고, 화면에는 계속 신화 16개가 떠 있습니다 —
     * 실제로 그렇게 나와서 아래 다섯 줄이 전부 빨갛게 찍혔습니다.
     */
    G.press('Digit1')
    G.release('Digit1')
    G.setGear(0, 0, 4242)
    await window.__t.runFor(8)
  })
  /** 알갱이가 도는 반경(≈0.85m)이 화면에서 55px 안쪽입니다. 그 밖은 볼 이유가 없습니다. */
  const AURA_R = 55
  const auraRows = []
  let auraBase = null
  for (const [tier, label] of [[0, '예열'], [0, '일반'], [2, '유니크'], [3, '전설'], [4, '신화'], [0, '일반(다시)']]) {
    let lit = 0
    const addSum = [0, 0, 0]
    let count = 0
    let motes = 0
    let color = 0
    let drawnWeapon = -1
    for (let k = 0; k < 3; k++) {
      const info = await page.evaluate(async ([t, first]) => {
        const G = window.__game
        // 첫 조각에서 등급을 끼우고 **배너가 사라질 때까지** 기다립니다.
        // 배너 글자가 크롭 안에 들어오면 그 글자를 등급 효과로 셉니다.
        if (first) {
          G.setGear(0, t, 4242)
          await window.__t.runFor(7)
        } else {
          await window.__t.runFor(0.45)
        }
        const p = G.state().player
        return { aura: G.auraInfo(), sp: G.screenPos(p.x, p.y + 0.9, p.z) }
      }, [tier, k === 0])
      motes = info.aura.count
      color = info.aura.color
      drawnWeapon = info.aura.weapon
      const cx = Math.round(info.sp.sx)
      const cy = Math.round(info.sp.sy)
      const img = decodePng(
        await page.screenshot({ clip: { x: cx - 70, y: cy - 70, width: 140, height: 140 } }),
      )
      if (label === '예열') break
      if (!auraBase) {
        auraBase = img
        break
      }
      for (let i = 0; i < img.data.length; i += 4) {
        const px = (i / 4) % img.width
        const py = Math.floor(i / 4 / img.width)
        if (Math.hypot(px - 70, py - 70) > AURA_R) continue
        const d = [
          img.data[i] - auraBase.data[i],
          img.data[i + 1] - auraBase.data[i + 1],
          img.data[i + 2] - auraBase.data[i + 2],
        ]
        // 알갱이는 **더하기 합성**이라 어둡게 만들 수 없습니다. 밝아진 것만 셉니다.
        if (d[0] + d[1] + d[2] > 24) {
          lit++
          /**
           * ── 🎨 **색은 포화되지 않은 픽셀에서만 읽습니다** ──────────
           *
           * 더하기 합성은 255 에서 잘립니다. 알갱이의 한가운데는 세 채널이
           * 다 255 에 붙어서 **무슨 색을 더했든 흰색**이 됩니다. 그 픽셀까지
           * 평균에 넣으면 색이 늘 흰 쪽으로 끌려가고, 실제로 그래서 이
           * 검사가 ΔE 32~45 로 흔들렸습니다 — **색 배선이 아니라 클리핑을
           * 재고 있었습니다.**
           *
           * 개수(밝아진 픽셀)는 그대로 다 셉니다. 잘린 픽셀도 "밝아진 것"은
           * 맞으니까요. 나뉘는 것은 *"얼마나"* 와 *"무슨 색"* 입니다.
           */
          if (img.data[i] < 250 && img.data[i + 1] < 250 && img.data[i + 2] < 250) {
            addSum[0] += d[0]
            addSum[1] += d[1]
            addSum[2] += d[2]
            count++
          }
        }
      }
    }
    if (label === '예열') continue
    const mean = count ? addSum.map((v) => v / count) : [0, 0, 0]
    const mx = Math.max(1, ...mean)
    // 밝기는 합성 결과라 제각각입니다 — **색조**만 견주려고 정규화합니다.
    const norm = mean.map((v) => Math.round((v * 255) / mx))
    const tgt = [(color >> 16) & 255, (color >> 8) & 255, color & 255]
    auraRows.push({ label, motes, lit, norm, weapon: drawnWeapon, dE: count ? deltaE(norm, tgt) : Infinity })
    console.log(
      `    ${label.padEnd(9)} 알갱이 ${String(motes).padStart(2)}개 · 밝아진 픽셀 ${String(lit).padStart(4)}` +
        (count ? ` · 더해진 빛 ${JSON.stringify(norm)} (등급색과 ΔE ${deltaE(norm, tgt).toFixed(1)})` : ''),
    )
  }
  const auraOf = (l) => auraRows.find((r) => r.label === l)
  check(
    auraRows.length > 0 && auraRows.every((r) => r.weapon === 0),
    '🚧 **이 구역 내내 같은 무기를 들고 있었다** (무기가 섞이면 등급 차이가 아니라 무기 차이를 잽니다)',
    auraRows.map((r) => `${r.label}:${r.weapon}`).join(' · '),
  )
  const again = auraOf('일반(다시)')
  check(
    !!again && again.lit === 0,
    '🚧 **같은 등급을 두 번 찍으면 차이가 0이다** (이게 아니면 아래 숫자는 조명을 잰 것입니다)',
    again ? `일반 다시 재기 → 밝아진 픽셀 ${again.lit}` : '못 쟀습니다',
  )
  const tiered = ['유니크', '전설', '신화'].map(auraOf).filter(Boolean)
  check(
    !!auraOf('일반') && auraOf('일반').motes === 0,
    '✨ **일반에는 아무것도 안 붙는다** (장식이 기본값이면 특별함이 사라집니다)',
    `일반 알갱이 ${auraOf('일반')?.motes}개`,
  )
  check(
    tiered.length === 3 && tiered.every((r, i) => i === 0 || r.motes > tiered[i - 1].motes),
    '✨ 등급이 오를수록 **알갱이가 는다**',
    tiered.map((r) => `${r.label} ${r.motes}`).join(' → '),
  )
  check(
    again !== undefined && tiered.length === 3 && tiered.every((r, i) => r.lit > (i === 0 ? again.lit : tiered[i - 1].lit)),
    '✨ **화면이 실제로 그만큼 밝아진다** (설정이 아니라 그려진 픽셀로)',
    `${again?.lit ?? '?'} → ${tiered.map((r) => r.lit).join(' → ')}`,
  )
  /**
   * 🎨 **문턱 40 의 근거 — 두 무리 사이입니다.**
   *
   * 이 값은 눈대중이 아니라 **양쪽을 다 본 뒤**에 골랐습니다:
   *   · 배선이 맞을 때  ΔE **6 ~ 22** (여러 판에서 실제로 나온 범위)
   *   · 배선이 틀렸을 때 ΔE **63 ~ 102** (계측기가 흰빛을 읽던 판들)
   * 두 무리가 멀리 떨어져 있어 그 사이 어디를 잡아도 됩니다. 40 은
   * 양쪽에 다 여유를 둔 자리입니다.
   *
   * ⚠️ 판마다 6~22 로 흔들리는 이유는 **찍는 순간마다 밝은 알갱이가
   *    다르기 때문**입니다. 그래서 22 에 딱 붙여 잡지 않습니다 —
   *    한 칸 차이의 초록은 기준선이 아니라 운입니다.
   */
  check(
    tiered.length === 3 && tiered.every((r) => r.dE < 40),
    '🎨 더해진 빛이 **그 등급의 색**이다 (색을 배선했는데 흰빛이 도는 일이 없게)',
    tiered.map((r) => `${r.label} ΔE ${r.dE.toFixed(1)}`).join(' · '),
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
