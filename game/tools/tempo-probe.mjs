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
 * ⚠️ **취소 회피가 들어오면서 이 파일의 규칙 하나가 뒤집혔습니다.**
 *
 *    예전에는 "선행동작 중에 눌러도 즉시 구르면 안 된다"를 검사했습니다.
 *    커밋을 지키자는 뜻이었고, 그 뜻 자체는 지금도 옳습니다. 다만 커밋을
 *    지키는 방법을 **막는 것**에서 **값을 매기는 것**으로 바꿨습니다:
 *    나갈 수는 있되 기력 25+20=45 를 냅니다(최대의 거의 절반).
 *
 *    그래서 검사도 바꿨습니다 — "안 나간다"가 아니라 **"기력이 있으면
 *    나가고, 없으면 안 나간다"** 입니다. 뒤집힌 검사를 조용히 지우지
 *    않고 여기 남겨 둡니다: 어느 날 취소가 너무 강하다고 판단하면
 *    되돌릴 자리가 어디인지 이 문단이 알려 줍니다.
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

  // ---- 2. 공격 중에 누른 구르기가 **즉시** 나가는가 (취소 회피) ----
  //
  // 기력을 가득 채워 두고 잽니다. 모자란 경우는 바로 다음 검사입니다 —
  // 한 실험에 변수를 둘 넣으면 실패했을 때 어느 쪽 때문인지 못 가립니다.
  /**
   * ⚠️ **"굴렀다"로는 취소인지 아닌지 못 가립니다.**
   *
   * 처음엔 "누르고 0.15초 안에 구르기 상태가 되면 취소"로 셌습니다.
   * 그런데 기본 공격의 선행동작은 0.1초대라, 그 사이에 후딜까지 가서
   * **원래부터 있던 후딜 탈출**이 나가도 똑같이 보입니다. 실제로 기력을
   * 40 으로 낮춘 검사가 그 이유로 잘못 통과했습니다(취소된 게 아니라
   * 후딜에서 나간 것이었습니다).
   *
   * 그래서 시각으로 추측하지 않고 **게임이 센 횟수**(`inputCancels`)를
   * 읽습니다. 취소인지 아닌지는 그 분기를 실제로 탄 코드만 알고,
   * 이 프로젝트의 규칙은 "게임이 판정하고 실험대는 읽는다" 입니다.
   */
  const cancelCost = t.dodgeStaminaCost + t.dodgeCancelExtraCost
  const attackRoll = await lab(`
    G.setStamina(100)
    tap('Mouse0')
    const atk = await until(() => st() === St.attack, 1.0)
    if (atk < 0) return { ok: false, why: '공격이 시작되지 않음' }
    const before = G.state().player.stamina
    const cancelsBefore = G.runStats().inputCancels
    const pressedAt = now()
    tap('Space')
    const dodgedAt = await until(() => st() === St.dodge, 2.5)
    // 굴러 나간 **직후** 기력을 읽습니다 — 회복이 붙기 전이어야 합니다.
    const after = G.state().player.stamina
    return {
      ok: dodgedAt > 0,
      delay: dodgedAt > 0 ? dodgedAt - pressedAt : -1,
      spent: before - after,
      cancels: G.runStats().inputCancels - cancelsBefore,
    }
  `)
  check(
    attackRoll.ok && attackRoll.cancels === 1,
    '공격 중에 누른 구르기가 공격을 **끊고** 나간다 (취소 회피)',
    attackRoll.ok
      ? `취소 ${attackRoll.cancels}회 · 누르고 ${attackRoll.delay.toFixed(2)}초 뒤`
      : attackRoll.why || '끝내 안 나감',
  )
  check(
    attackRoll.cancels === 1 && Math.abs(attackRoll.spent - cancelCost) < 3,
    `취소에는 추가 기력이 붙는다 (기본 ${t.dodgeStaminaCost} + 추가 ${t.dodgeCancelExtraCost})`,
    attackRoll.ok ? `실제로 ${attackRoll.spent.toFixed(1)} 소모` : '측정 못 함',
  )

  // ---- 2b. 기력이 모자라면 취소되지 않는가 ----
  //
  // 값을 매겨 막는다는 설계가 실제로 막고 있는지 봅니다. 여기가 통과하지
  // 않으면 "값을 매겼다"는 말은 장식이고 취소는 사실상 공짜입니다.
  const poorCancel = await lab(`
    tap('Mouse0')
    const atk = await until(() => st() === St.attack, 1.0)
    if (atk < 0) return { ok: false, why: '공격이 시작되지 않음' }
    // 취소에는 모자라고 **일반 구르기에는 충분한** 값으로 맞춥니다.
    // 이래야 "구르기 자체가 안 되는 것"과 "취소만 안 되는 것"이 갈립니다.
    G.setStamina(${(cancelCost - 5).toFixed(0)})
    const cancelsBefore = G.runStats().inputCancels
    const pressedAt = now()
    tap('Space')
    const dodgedAt = await until(() => st() === St.dodge, 2.5)
    return {
      ok: true,
      cancels: G.runStats().inputCancels - cancelsBefore,
      delay: dodgedAt > 0 ? dodgedAt - pressedAt : -1,
    }
  `)
  check(
    poorCancel.cancels === 0,
    '⚠️ 기력이 모자라면 취소되지 않는다 (값이 실제로 막는다)',
    poorCancel.cancels > 0 ? '기력이 없는데도 끊고 나갔습니다' : '공격은 끝까지 갑니다',
  )
  check(
    poorCancel.cancels === 0 && poorCancel.delay > 0,
    '…대신 눌러 둔 것은 살아남아 후딜에서 나간다 (버려지지 않는다)',
    poorCancel.delay > 0 ? `누르고 ${poorCancel.delay.toFixed(2)}초 뒤` : '끝내 안 나감',
  )

  // ---- 2.5 **무기 전환도 입력입니다** ----
  /**
   * ── 왜 이걸 재게 됐는가 ────────────────────────────────────────────
   * 이 저장소는 같은 버그를 이미 두 번 고쳤습니다 — 스킬 선입력이 없어서
   * *"스킬이 한 번씩밖에 사용이 안 되네"* 였고, 구르는 중에 누른 공격이
   * 통째로 사라졌습니다. 그때 내린 결론이 이것입니다:
   *
   * > **상태마다 다른 데서 입력을 기억하면 반드시 구멍이 생깁니다.**
   *
   * 그런데 무기 전환은 그 규칙 밖에 남아 있었습니다. `playerControl` 이
   * 프레임 첫머리에서 `consumePress('Digit1')` 로 **키를 소비해 놓고**,
   * 아래에서 `if (idle && ...)` 로 거릅니다. 즉 동작 중에 누른 전환은
   * 소비만 되고 **그대로 증발합니다.**
   *
   * 이건 밸런스가 아니라 조작 문제입니다. 무기 셋을 준 게임에서 전환이
   * *"완전히 멈출 때까지 기다렸다가 정확히 누르는 것"* 이면, 그건
   * 그들 스스로 적어 둔 문장 그대로 **조작이 아니라 눈치싸움**입니다.
   *
   * ⚠️ 여기서 요구하는 것은 **취소가 아닙니다.** 후딜을 끊어 주면 휘두른
   *    대가가 사라져서 템포 설계가 통째로 무너집니다(판정·후딜은 규칙).
   *    요구하는 것은 *"눌러 둔 것이 살아남아 **끝난 뒤에** 적용된다"* —
   *    공격·구르기·스킬 셋이 이미 그렇게 하고 있는 그것뿐입니다.
   */
  const swap = await lab(`
    const before = G.state().loadout.weapon
    tap('Mouse0')
    await until(() => st() === St.attack, 1.0)
    // **휘두르는 도중에** 다른 무기를 누릅니다.
    tap('Digit2')
    const pressedAt = now()
    await until(() => st() === St.idle, 3.0)
    await wait(0.3)
    return { before, after: G.state().loadout.weapon, waited: now() - pressedAt }
  `)
  check(
    swap.after !== swap.before,
    '동작 중에 누른 **무기 전환이 살아남는다** (입력이 사라지지 않는다)',
    `${swap.before} → ${swap.after}` + (swap.after !== swap.before ? ` · ${swap.waited.toFixed(2)}초 뒤` : ' (증발)'),
  )

  /**
   * ⚠️ **그리고 끊지는 않아야 합니다.**
   *
   * 위 검사만 있으면 "전환이 후딜을 취소한다"로 고쳐 놓아도 통과합니다.
   * 그런데 그건 훨씬 나쁜 변경입니다 — 후딜은 휘두른 **대가**이고, 그
   * 대가가 무기 키 한 번으로 사라지면 대검을 공짜로 쓰게 됩니다. 이
   * 저장소가 템포를 손볼 때 정한 규칙 그대로입니다: *"판정(active)을
   * 건드리면 맞던 것이 안 맞습니다."* 후딜도 같은 급의 규칙입니다.
   *
   * 그래서 **한 동작이 끝나는 데 걸리는 시간**을 두 번 잽니다 — 전환을
   * 눌렀을 때와 안 눌렀을 때. 같아야 합니다.
   */
  const swapCancel = await lab(`
    const one = async (press) => {
      await until(() => st() === St.idle, 3.0)
      await wait(0.2)
      tap('Mouse0')
      const began = await until(() => st() === St.attack, 1.0)
      if (press) tap('Digit2')
      const ended = await until(() => st() === St.idle, 3.0)
      return ended - began
    }
    const plain = await one(false)
    // 무기를 되돌려 놓고 같은 조건에서 다시 잽니다.
    tap('Digit1')
    await until(() => st() === St.idle, 2.0)
    await wait(0.4)
    const swapped = await one(true)
    return { plain, swapped }
  `)
  check(
    swapCancel.plain > 0 &&
      swapCancel.swapped > 0 &&
      Math.abs(swapCancel.swapped - swapCancel.plain) < 0.08,
    '…그래도 **후딜을 끊지는 않는다** (휘두른 대가는 그대로 낸다)',
    `안 누름 ${swapCancel.plain.toFixed(2)}초 vs 누름 ${swapCancel.swapped.toFixed(2)}초`,
  )

  /**
   * ⚠️ **그리고 기다리는 동안 화면이 말을 해야 합니다.**
   *
   * 이게 없으면 플레이어가 보는 것은 고치기 전과 **똑같습니다** —
   * *"눌렀는데 안 바뀌네."* 지난 라운드에 인지 규칙을 셋 만들어 놓고
   * 화면에 한 글자도 안 올려서 플레이어에게는 없는 기능이었던 것과
   * 같은 실수입니다. 같은 실수를 두 번 하지 않기 위해 이 줄이 있습니다.
   *
   * 규칙이 아니라 **DOM 이 실제로 무엇을 쓰고 있는지**를 읽습니다.
   */
  const swapUi = await lab(`
    const label = () => document.getElementById('weaponName')?.textContent ?? ''
    await until(() => st() === St.idle, 3.0)
    tap('Digit1')
    await wait(0.4)
    const before = label()
    tap('Mouse0')
    await until(() => st() === St.attack, 1.0)
    tap('Digit3')
    await wait(0.06)
    const during = label()
    await until(() => st() === St.idle, 3.0)
    await wait(0.35)
    return { before, during, after: label() }
  `)
  check(
    swapUi.during !== swapUi.before && swapUi.during.includes('→'),
    '기다리는 동안 **화면이 예약을 말한다** (눌린 줄 모르는 채로 안 둔다)',
    `"${swapUi.before}" → 대기 중 "${swapUi.during}" → "${swapUi.after}"`,
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

  // ---- 3.5 연속 구르기 — 창 0.55초를 그렇게 잡은 **이유** ----
  //
  // 창 길이를 `구르기 0.42 + 쿨다운 0.12 = 0.54` 에서 뽑아 놓고, 정작 그
  // 0.12초를 넘기는지는 검사하지 않았습니다. 그래서 실제로는 막혀 있었는데도
  // 6개 검사가 전부 통과했습니다 — **근거로 삼은 수치에 해당하는 검사가
  // 없으면, 그 수치는 지켜지지 않습니다.**
  const chainRoll = await lab(`
    tap('Space')
    const first = await until(() => st() === St.dodge, 1.0)
    if (first < 0) return { ok: false, why: '첫 구르기가 안 나감' }
    // 구르는 **도중에** 다음 구르기를 눌러 둡니다 — 사람이 실제로 하는 입력.
    await wait(0.05)
    const pressedAt = now()
    tap('Space')
    // 첫 구르기가 끝나기를 기다린 뒤, 두 번째가 나오는지 봅니다.
    await until(() => st() !== St.dodge, 1.5)
    const second = await until(() => st() === St.dodge, 1.5)
    return { ok: second > 0, delay: second > 0 ? second - pressedAt : -1 }
  `)
  check(
    chainRoll.ok,
    '구르는 중에 눌러 둔 **다음 구르기**가 쿨다운을 넘겨 나간다',
    chainRoll.ok
      ? `누르고 ${chainRoll.delay.toFixed(2)}초 뒤 (구르기 ${t.dodgeDuration} + 쿨다운 ${t.dodgeCooldown} = ${(t.dodgeDuration + t.dodgeCooldown).toFixed(2)})`
      : chainRoll.why || '끝내 안 나감 — 쿨다운 중에 버려졌습니다',
  )

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
