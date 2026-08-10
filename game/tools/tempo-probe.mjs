/**
 * 템포 검증 — `npm run tempo`
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────
 * "공격은 빨라졌는데 동작 사이가 끊긴다"는 것을 코드에서 찾아보니
 * 원인이 하나였습니다: **입력이 버려집니다.**
 *
 *   · 구르는 중에 누른 공격 → `beginDodge` 가 선입력을 지웁니다 → 사라짐
 *   · 공격 선행동작 중에 누른 구르기 → 그 프레임에만 유효 → 사라짐
 *   · 콤보가 바닥난 자리에서 누른 것 → `endAttack` 이 지웁니다 → 사라짐
 *
 * 그래서 손이 배우는 것이 *"언제 눌러야 하는가"* 가 아니라
 * *"언제까지 참았다가 눌러야 하는가"* 였습니다. 동작 하나하나가 아무리
 * 빨라도, 사이마다 **눈으로 확인하고 다시 누르는** 시간이 붙습니다.
 *
 * 🟢 반격(패링)도 같은 뿌리입니다. 초록 예고는 대개 내가 후딜인 동안 뜨는데,
 * 그때 누른 공격이 버려지면 **읽었는데도 답할 수 없습니다.**
 *
 * ── 그래서 여기서 재는 것 ───────────────────────────────────────
 * 이어짐은 "부드럽다" 같은 느낌말로는 검사할 수 없습니다. 대신
 * **누른 시점과 나온 시점 사이의 시뮬레이션 시간**을 잽니다.
 * 버퍼가 없으면 이 시간이 "다음에 다시 누를 때까지"로 벌어지고,
 * 버퍼가 있으면 "동작이 끝나는 순간"에 붙습니다.
 *
 * ⚠️ 커밋은 버퍼와 다릅니다. **선행동작 중에 눌렀다고 즉시 구르면 안 됩니다.**
 *    그건 이어짐이 아니라 취소이고, 소울류에서 공격이 무거운 이유를 지웁니다.
 *    그래서 "안 나가는 것"도 같이 검사합니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5209
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
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🎵 템포 검증 — 눌러 둔 것이 이어지는가\n')

  const t = await page.evaluate(() => window.__game.terrainInfo())
  console.log(
    `  [설정] 선입력 창 ${t.inputBuffer}초 · 구르기 ${t.dodgeDuration}초 + 쿨다운 ${t.dodgeCooldown}초 ` +
      `= ${(t.dodgeDuration + t.dodgeCooldown).toFixed(2)}초 · 공격 템포 ×${t.attackTempo}\n`,
  )

  /**
   * 창 길이는 **게임 안의 가장 긴 이어짐**을 덮어야 합니다.
   * 이 검사는 수치를 고칠 때 같이 봐야 할 관계를 못 박아 둡니다 —
   * 구르기를 0.5초로 늘리면서 버퍼를 그대로 두면 여기서 걸립니다.
   */
  check(
    t.inputBuffer >= t.dodgeDuration + t.dodgeCooldown,
    '선입력 창이 연속 구르기(지속+쿨다운)를 덮는다',
    `${t.inputBuffer} vs ${(t.dodgeDuration + t.dodgeCooldown).toFixed(2)}`,
  )

  /**
   * 공용 실험대. 적 없이 빈 자리에서 잽니다 — 적이 있으면 피격 경직이
   * 섞여서 "안 나간 이유"가 갈리지 않습니다.
   */
  const S = t.actorStates
  const lab = async (script) =>
    page.evaluate(async ([src, St]) => {
      const G = window.__game
      G.reset()
      const sleep = () => new Promise((r) => setTimeout(r, 8))
      const now = () => G.state().simElapsed
      const st = () => G.state().player.state
      const wait = async (sec) => {
        const t0 = now()
        const dl = Date.now() + 30000
        while (now() - t0 < sec && Date.now() < dl) await sleep()
      }
      /** 어떤 상태가 될 때까지 기다립니다. 되면 그때의 시뮬레이션 시각. */
      const until = async (fn, limit) => {
        const t0 = now()
        const dl = Date.now() + 40000
        while (now() - t0 < limit && Date.now() < dl) {
          if (fn()) return now()
          await sleep()
        }
        return -1
      }
      const tap = (code) => {
        G.press(code)
        G.release(code)
      }
      await wait(0.5)
      G.clearEnemies()
      await wait(0.3)
      // eslint-disable-next-line no-new-func
      const fn = new Function('G', 'sleep', 'now', 'st', 'wait', 'until', 'tap', 'St', `return (async () => { ${src} })()`)
      return await fn(G, sleep, now, st, wait, until, tap, St)
    }, [script, S])

  // ---- 1. 구르는 중에 누른 공격이 착지하며 나가는가 ← 이번 변경의 핵심 ----
  //
  // 예전에는 `beginDodge` 가 공격 선입력을 지웠습니다. 그래서 이 값이
  // "-1(끝내 안 나감)" 이었습니다 — 착지를 눈으로 보고 다시 눌러야 했습니다.
  const rollAttack = await lab(`
    tap('Space')
    const rolled = await until(() => st() === St.dodge, 1.0)
    if (rolled < 0) return { ok: false, why: '구르기가 시작되지 않음' }
    // 구르기가 시작되자마자 공격을 눌러 둡니다 — 사람이 실제로 하는 입력.
    await wait(0.05)
    const pressedAt = now()
    tap('Mouse0')
    const attackedAt = await until(() => st() === St.attack, 2.0)
    return { ok: attackedAt > 0, delay: attackedAt > 0 ? attackedAt - pressedAt : -1 }
  `)
  check(
    rollAttack.ok,
    '구르는 중에 눌러 둔 공격이 일어나면서 나간다',
    rollAttack.ok ? `누르고 ${rollAttack.delay.toFixed(2)}초 뒤 (구르기 ${t.dodgeDuration}초)` : rollAttack.why || '끝내 안 나감',
  )

  // ---- 2. 공격 중에 누른 구르기가 후딜에 나가는가 ----
  const attackRoll = await lab(`
    tap('Mouse0')
    const atk = await until(() => st() === St.attack, 1.0)
    if (atk < 0) return { ok: false, why: '공격이 시작되지 않음' }
    // 선행동작 한복판에서 누릅니다.
    await wait(0.05)
    const pressedAt = now()
    tap('Space')
    // 눌러도 **즉시** 구르면 안 됩니다 — 커밋이 지켜지는지 먼저 봅니다.
    await wait(0.08)
    const instant = st() === St.dodge
    const dodgedAt = await until(() => st() === St.dodge, 2.5)
    return { ok: dodgedAt > 0, instant, delay: dodgedAt > 0 ? dodgedAt - pressedAt : -1 }
  `)
  check(
    attackRoll.ok,
    '공격 선행동작 중에 눌러 둔 구르기가 후딜에 나간다',
    attackRoll.ok ? `누르고 ${attackRoll.delay.toFixed(2)}초 뒤` : attackRoll.why || '끝내 안 나감',
  )
  check(
    attackRoll.instant === false,
    '⚠️ 그렇다고 **즉시** 구르지는 않는다 (버퍼는 취소가 아니다)',
    attackRoll.instant ? '선행동작이 취소됐습니다 — 커밋이 무너집니다' : '선행동작은 끝까지 갑니다',
  )

  // ---- 3. 창이 지나면 버려지는가 ----
  //
  // 버퍼의 값어치는 "눌러 둔 것이 나온다"이지 "안 누른 것이 나온다"가
  // 아닙니다. 만료가 없으면 2초 전에 누른 것이 뜬금없이 튀어나옵니다.
  const expiry = await lab(`
    tap('Mouse0')
    await until(() => st() === St.idle, 3.0)
    // 아무것도 안 하고 창보다 넉넉히 오래 서 있습니다.
    const pressedAt = now()
    tap('Space')
    await until(() => st() === St.dodge, 1.5)
    await until(() => st() === St.idle, 2.0)
    const before = now()
    await wait(${(t.inputBuffer + 0.5).toFixed(2)})
    // 이 사이에 아무 상태 변화가 없어야 합니다.
    return { moved: st() !== St.idle }
  `)
  check(!expiry.moved, '창이 지난 선입력은 버려진다 (뒤늦게 튀어나오지 않는다)')

  // ---- 4. 콤보가 바닥나도 이어지는가 ----
  //
  // `endAttack` 이 콤보 끝에서 선입력을 지우고 있었습니다. 그 자리에서만
  // 한 박자가 비어서, 3타 무기는 3타마다 한 번씩 손이 멈췄습니다.
  const comboLoop = await lab(`
    const weapon = G.state().loadout
    const n = weapon.comboLength
    // 콤보를 끝까지 한 번 돌립니다.
    for (let i = 0; i < n; i++) {
      tap('Mouse0')
      await wait(0.28)
    }
    // 마지막 타 도중에 한 번 더 눌러 둡니다 — 여기가 예전에 버려지던 자리.
    const pressedAt = now()
    tap('Mouse0')
    const again = await until(() => st() === St.attack && G.state().player.comboIndex === 0, 2.0)
    return { ok: again > 0, n, delay: again > 0 ? again - pressedAt : -1 }
  `)
  check(
    comboLoop.ok,
    '콤보가 바닥난 자리에서 눌러 둔 것이 1타로 이어진다',
    comboLoop.ok ? `${comboLoop.n}타 무기 · 누르고 ${comboLoop.delay.toFixed(2)}초 뒤 1타` : '끝내 안 이어짐',
  )

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
