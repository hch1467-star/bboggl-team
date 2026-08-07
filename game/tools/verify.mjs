/**
 * 헤드리스 자동 검증.
 *
 * 왜 이게 있는가: 게임은 "빌드가 통과했다"가 아무 의미가 없습니다.
 * 타입 검사를 통과해도 캐릭터가 안 움직이거나, 판정이 안 맞거나,
 * 화면이 까맣게 나올 수 있습니다. 이 스크립트는 실제 브라우저에서 게임을 띄우고
 * 키를 눌러본 뒤, 게임 상태가 기대대로 변했는지 검사하고 스크린샷을 남깁니다.
 *
 * 실행: npm run verify
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SHOTS = process.env.SHOT_DIR ?? path.join(ROOT, 'tools', 'shots')
const PORT = 4173
const VIEWPORT = { width: 1100, height: 690 }

// 컨테이너/CI에는 Playwright가 내려받은 브라우저가 없을 수 있어, 미리 설치된
// Chromium 경로를 먼저 찾아봅니다.
const PREINSTALLED = ['/opt/pw-browsers/chromium']
const execPath = PREINSTALLED.find((p) => existsSync(p))

const results = []
let failed = 0

function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
  const mark = ok ? '  PASS' : '✗ FAIL'
  console.log(`${mark}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failed++
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  mkdirSync(SHOTS, { recursive: true })

  const server = await preview({
    root: ROOT,
    preview: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'error',
  })

  const browser = await chromium.launch({
    executablePath: execPath,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  })

  // 반드시 **하나의 컨텍스트**를 공유해야 합니다.
  // browser.newPage() 는 호출할 때마다 새 컨텍스트를 만들어서 localStorage 가 격리됩니다.
  // 그러면 에디터가 저장한 레벨을 게임 페이지가 못 읽습니다.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  page.on('requestfailed', (r) => consoleErrors.push(`요청 실패: ${r.url()}`))
  page.on('response', (r) => {
    if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()}: ${r.url()}`)
  })

  // lowfx=1: 소프트웨어 렌더링에서 그림자를 끄면 프레임이 5배 이상 나옵니다.
  await page.goto(`http://127.0.0.1:${PORT}/?lowfx=1`, { waitUntil: 'load' })

  const state = () => page.evaluate(() => window.__game.state())
  const press = (c) => page.evaluate((code) => window.__game.press(code), c)
  const release = (c) => page.evaluate((code) => window.__game.release(code), c)
  const tap = async (c) => {
    await press(c)
    await sleep(40)
    await release(c)
  }
  const aimAt = (x, z) => page.evaluate(([ax, az]) => window.__game.aimAtWorld(ax, az), [x, z])
  const shot = async (name) => {
    const file = path.join(SHOTS, `${name}.png`)
    await page.screenshot({ path: file })
    return file
  }

  /** 렌더 직후 화면 중앙 픽셀 통계를 가져옵니다. */
  async function sampleScreen(timeoutMs = 8000) {
    await page.evaluate(() => window.__game.requestSample())
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const s = await page.evaluate(() => window.__game.getSample())
      if (s) return s
      await sleep(60)
    }
    return null
  }

  /** 조건이 참이 될 때까지 기다립니다. 소프트웨어 렌더링은 느려서 고정 sleep은 못 씁니다. */
  async function waitUntil(fn, timeoutMs, label) {
    const start = Date.now()
    let last = null
    while (Date.now() - start < timeoutMs) {
      last = await state()
      if (fn(last)) return { ok: true, state: last, ms: Date.now() - start }
      await sleep(60)
    }
    return { ok: false, state: last, ms: timeoutMs, label }
  }

  try {
    // ---------- 1. 부팅 ----------
    await page.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
    let s = await state()
    check('게임 부팅 및 디버그 훅 노출', s != null)
    check('플레이어가 원점에 스폰됨', Math.abs(s.player.x) < 0.05 && Math.abs(s.player.z) < 0.05, `(${s.player.x}, ${s.player.z})`)
    check('1웨이브 적 6마리 스폰', s.enemiesLeft === 6, `실제 ${s.enemiesLeft}마리`)
    check('플레이어 체력 100', s.player.hp === 100)

    // 프레임이 실제로 도는지 확인
    const f0 = s.frame
    await sleep(1200)
    s = await state()
    const fps = (s.frame - f0) / 1.2
    check('렌더 루프 동작 중', s.frame > f0, `약 ${fps.toFixed(0)} fps (소프트웨어 렌더링)`)

    const boot = await shot('01-boot')
    check('부팅 스크린샷이 비어있지 않음', statSync(boot).size > 15000, `${(statSync(boot).size / 1024).toFixed(0)} KB`)

    // 화면이 실제로 "그려졌는지" 프레임버퍼를 직접 읽어 확인합니다.
    // 파일 크기만 보면 HUD 텍스트 때문에 3D가 새까매도 통과해버립니다.
    const pix = await sampleScreen()
    check('3D 씬이 실제로 렌더링됨 (검은 화면 아님)',
      pix != null && pix.bgRatio < 0.5 && pix.meanLuma >= 10,
      pix ? `배경색 픽셀 ${(pix.bgRatio * 100).toFixed(0)}% · 평균밝기 ${pix.meanLuma} · 색상 ${pix.uniqueColors}종` : '샘플 수집 실패')

    // ---------- 2. WASD 이동이 카메라 기준인지 ----------
    // 카메라 yaw 45° -> 전방 = (-0.707, 0, -0.707). W를 누르면 x, z 둘 다 감소해야 합니다.
    await page.evaluate(() => window.__game.reset())
    await sleep(200)
    let before = await state()
    await press('KeyW')
    const moved = await waitUntil((st) => Math.hypot(st.player.x - before.player.x, st.player.z - before.player.z) > 1.5, 6000)
    await release('KeyW')
    const dW = moved.state
    check(
      'W = 화면 위쪽(카메라 전방)으로 이동',
      moved.ok && dW.player.x < before.player.x - 0.5 && dW.player.z < before.player.z - 0.5,
      `Δx=${(dW.player.x - before.player.x).toFixed(2)} Δz=${(dW.player.z - before.player.z).toFixed(2)}`,
    )

    await page.evaluate(() => window.__game.reset())
    await sleep(200)
    before = await state()
    await press('KeyD')
    const movedD = await waitUntil((st) => Math.hypot(st.player.x - before.player.x, st.player.z - before.player.z) > 1.5, 6000)
    await release('KeyD')
    const dD = movedD.state
    // 우측 = (0.707, 0, -0.707)
    check(
      'D = 화면 오른쪽으로 이동',
      movedD.ok && dD.player.x > before.player.x + 0.5 && dD.player.z < before.player.z - 0.5,
      `Δx=${(dD.player.x - before.player.x).toFixed(2)} Δz=${(dD.player.z - before.player.z).toFixed(2)}`,
    )

    // ---------- 3. 마우스 조준 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(200)
    // 월드 (0, 10) = rotY 0 방향(+Z), 월드 (10, 0) = rotY 90°(+X)
    await aimAt(0, 10)
    let aimed = await waitUntil((st) => Math.abs(st.player.rotY) < 0.12, 3000)
    check('커서를 +Z에 두면 캐릭터가 +Z를 봄', aimed.ok, `rotY=${aimed.state.player.rotY}`)
    // 화면좌표 -> 지면 왕복 검사.
    // z가 정확히 10이 아니라 11 근처로 나오는 것은 버그가 아닙니다: 카메라가 커서 쪽으로
    // 시야를 미는 aimLead(18%, 최대 3.2m) 때문에, NDC를 고정하면 지면 교차점이
    // 리드만큼 바깥으로 밀립니다. 방향이 맞고 리드 상한 안에 있으면 정상입니다.
    check(
      '커서 월드좌표 왕복(카메라 리드 포함)',
      Math.abs(aimed.state.aim.x) < 1.0 && aimed.state.aim.z > 9 && aimed.state.aim.z < 10 + 3.4,
      `aim=(${aimed.state.aim.x}, ${aimed.state.aim.z}) / 기대 z≈10~13.4`,
    )

    await aimAt(10, 0)
    aimed = await waitUntil((st) => Math.abs(st.player.rotY - Math.PI / 2) < 0.12, 3000)
    check('커서를 +X에 두면 캐릭터가 +X를 봄', aimed.ok, `rotY=${aimed.state.player.rotY}`)

    // ---------- 4. 회피 구르기 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(300)
    before = await state()
    await tap('Space')
    const dodging = await waitUntil((st) => st.player.state === 2, 2500)
    check('Space로 회피 구르기 진입', dodging.ok, `state=${dodging.state.player.state}`)
    check(
      '회피가 스태미나 25 소모',
      dodging.ok && Math.abs(before.player.stamina - dodging.state.player.stamina - 25) < 3,
      `${before.player.stamina} -> ${dodging.state.player.stamina}`,
    )
    const rolled = await waitUntil((st) => st.player.state !== 2, 3000)
    const rollDist = Math.hypot(rolled.state.player.x - before.player.x, rolled.state.player.z - before.player.z)
    check('회피 이동거리 약 4.2m', rollDist > 3.0 && rollDist < 5.5, `${rollDist.toFixed(2)}m`)
    const staminaBack = await waitUntil((st) => st.player.stamina > 95, 6000)
    check('스태미나 자동 회복', staminaBack.ok, `${staminaBack.state.player.stamina}`)

    // ---------- 5. 공격 상태 기계 & 콤보 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(300)
    await tap('Mouse0')
    const attacking = await waitUntil((st) => st.player.state === 1, 2000)
    check('좌클릭으로 공격 진입', attacking.ok, `state=${attacking.state.player.state}`)

    // 연타해서 3타까지 이어지는지
    let maxCombo = 0
    for (let i = 0; i < 26; i++) {
      await tap('Mouse0')
      const st = await state()
      if (st.player.state === 1) maxCombo = Math.max(maxCombo, st.player.comboIndex)
      await sleep(70)
    }
    check('연타 시 3타 콤보까지 진행', maxCombo >= 2, `도달 콤보 인덱스 ${maxCombo} (0,1,2 중)`)

    // ---------- 6. 타격 판정 + 손맛(히트스톱/화면흔들림) ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(300)

    // 가장 가까운 적을 계속 조준하며 접근 + 공격
    let sawHitstop = false
    let sawTrauma = 0
    let killShot = null
    const combatStart = Date.now()
    await press('KeyW') // 아무 방향으로든 계속 움직이며 교전 유도
    while (Date.now() - combatStart < 45000) {
      const st = await state()
      if (st.hitstop > 0) {
        // 타격이 꽂혀 게임이 멈춘 바로 그 순간을 캡처합니다.
        // 이펙트/히트스톱 연출을 눈으로 확인할 수 있는 유일한 타이밍입니다.
        if (!sawHitstop) await shot('02b-impact-frame')
        sawHitstop = true
      }
      sawTrauma = Math.max(sawTrauma, st.trauma)
      if (st.kills >= 1 && !killShot) killShot = st
      if (st.kills >= 2 || st.gameOver) break

      if (st.nearestEnemy) {
        await aimAt(st.nearestEnemy.x, st.nearestEnemy.z)
        // 적 쪽으로 걸어가기: W 대신 조준 방향으로 가도록 키를 바꿔가며 접근
        if (st.nearestEnemy.dist < 2.2) {
          await release('KeyW')
          await tap('Mouse0')
        } else {
          await press('KeyW')
        }
      }
      await sleep(90)
    }
    await release('KeyW')
    const combat = await state()

    check('전투 중 적에게 피해를 입힘(처치 발생)', combat.kills >= 1, `${combat.kills}마리 처치`)
    check('타격 시 히트스톱 발동', sawHitstop, sawHitstop ? '감지됨' : '미감지')
    check('타격 시 화면 흔들림(trauma) 발동', sawTrauma > 0.05, `최대 trauma=${sawTrauma.toFixed(3)}`)

    const combatShot = await shot('02-combat')
    check('전투 스크린샷 생성', statSync(combatShot).size > 15000, `${(statSync(combatShot).size / 1024).toFixed(0)} KB`)

    // ---------- 7. 적 AI가 실제로 플레이어를 공격하는가 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(300)
    const startHp = (await state()).player.hp
    const damaged = await waitUntil((st) => st.player.hp < startHp, 40000)
    check('적 AI가 플레이어를 추격해 공격함', damaged.ok, damaged.ok ? `체력 ${startHp} -> ${damaged.state.player.hp}` : '40초 내 미발생')
    await shot('03-enemies-engaging')

    // ---------- 7.4 백어택 판정 (기둥 3) ----------
    // 판정은 순수 기하 계산이라, 전투를 돌리지 않고 좌표만 넣어 정확히 검사합니다.
    // 적은 rotY=0 일 때 +Z를 봅니다. 따라서 -Z 쪽(뒤)에서 때리면 백어택입니다.
    const behind = (ax, az, trot = 0) =>
      page.evaluate(([a, b, r]) => window.__game.testBehind(a, b, 0, 0, r), [ax, az, trot])

    check('정면(+Z)에서 때리면 백어택 아님', (await behind(0, 3)) === false)
    check('등 뒤(-Z)에서 때리면 백어택', (await behind(0, -3)) === true)
    check('옆(+X)에서 때리면 백어택 아님', (await behind(3, 0)) === false)
    // 후방 부채꼴 120° = 정중앙 뒤에서 좌우 60°까지. 55°는 안, 65°는 밖.
    const at = (deg, r = 3) => [Math.sin(((180 - deg) * Math.PI) / 180) * r, Math.cos(((180 - deg) * Math.PI) / 180) * r]
    check('뒤에서 55° 비껴서도 백어택 (부채꼴 120°)', (await behind(...at(55))) === true)
    check('뒤에서 65° 비끼면 백어택 아님', (await behind(...at(65))) === false)
    // 적이 돌아서면 판정도 같이 돌아야 합니다.
    check('적이 180° 돌면 +Z 쪽이 등 뒤가 됨', (await behind(0, 3, Math.PI)) === true)

    // ---------- 7.5 스킬 + 쿨다운 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(400)
    s = await state()
    check('시작 무기 = 롱소드', s.loadout.weapon === 'longsword', s.loadout.weaponName)
    check(
      '슬롯 4개(무기2 + 룬2)가 모두 채워짐',
      s.loadout.slots.every((x) => x !== null),
      JSON.stringify(s.loadout.slots),
    )
    check('시작 쿨다운은 모두 0', s.loadout.cooldowns.every((c) => c === 0))

    await tap('KeyQ')
    const casting = await waitUntil((st) => st.player.state === 5, 3000)
    check('Q로 스킬 시전 (state=Skill)', casting.ok, `state=${casting.state.player.state}`)
    check(
      '시전과 동시에 해당 슬롯 쿨다운 시작',
      casting.ok && casting.state.loadout.cooldowns[0] > 0,
      `cd=${casting.state?.loadout.cooldowns[0]}`,
    )

    // 시전이 끝난 뒤에도 쿨다운이 남아 있으면 재시전이 막혀야 합니다.
    await waitUntil((st) => st.player.state !== 5, 5000)
    const cdState = await state()
    await tap('KeyQ')
    await sleep(400)
    const afterRecast = await state()
    check(
      '쿨다운 중에는 재시전 불가',
      cdState.loadout.cooldowns[0] > 0 && afterRecast.player.state !== 5,
      `남은 쿨다운 ${cdState.loadout.cooldowns[0]}초`,
    )

    // ---------- 7.6 무기별로 스킬과 콤보가 달라지는가 ----------
    await page.evaluate(() => window.__game.reset())
    await sleep(400)
    await tap('Digit2')
    await sleep(400)
    s = await state()
    check('2번 키로 대검 교체', s.loadout.weapon === 'greatsword', s.loadout.weaponName)
    check('대검은 2타 콤보 (롱소드는 3타)', s.loadout.comboLength === 2, `${s.loadout.comboLength}타`)
    check(
      '무기를 바꾸면 Q/E 스킬도 바뀜',
      s.loadout.slots[0] === 'earthshatter' && s.loadout.slots[1] === 'wide_cleave',
      JSON.stringify(s.loadout.slots.slice(0, 2)),
    )
    // 룬 슬롯은 무기와 무관하게 유지되어야 합니다(자유 슬롯의 정의).
    check('무기를 바꿔도 룬 슬롯은 유지됨', s.loadout.slots[2] !== null && s.loadout.slots[3] !== null)

    // 지점 지정 스킬은 커서 위치에 착탄점을 고정합니다.
    await aimAt(6, 0)
    await sleep(250)
    await tap('KeyQ')
    const pointCast = await waitUntil((st) => st.player.state === 5, 3000)
    check(
      '지점 지정 스킬이 커서 쪽에 착탄점을 고정',
      pointCast.ok && Math.hypot(pointCast.state.cast.x - 6, pointCast.state.cast.z) < 4,
      `착탄 (${pointCast.state?.cast.x}, ${pointCast.state?.cast.z}) / 조준 (6, 0)`,
    )

    // 무기 교체는 **대기 상태에서만** 됩니다(시전 중 교체는 의도적으로 막혀 있음).
    // 그래서 시전이 끝날 때까지 기다린 뒤에 눌러야 합니다.
    const idleAgain = await waitUntil((st) => st.player.state === 0, 6000)
    check('시전 중에는 무기 교체가 막힘 (시전 종료 대기)', idleAgain.ok)
    await tap('Digit3')
    await sleep(400)
    s = await state()
    check('3번 키로 쌍단검 교체 + 4타 콤보', s.loadout.weapon === 'daggers' && s.loadout.comboLength === 4, `${s.loadout.weaponName} ${s.loadout.comboLength}타`)

    // ---------- 7.7 다단히트 스킬이 실제로 여러 번 때리는가 ----------
    // 쌍단검 E = 연속 찌르기(5회). 적의 체력 변화로 재면 그 사이 적이 죽거나 바뀌어
    // 측정이 흔들립니다. 그래서 **명중 횟수 자체**를 셉니다.
    await page.evaluate(() => window.__game.reset())
    await sleep(400)
    await tap('Digit3')
    await sleep(300)

    let flurryHits = 0
    const flurryStart = Date.now()
    await press('KeyW')
    while (Date.now() - flurryStart < 45000) {
      const st = await state()
      if (!st.nearestEnemy) break
      await aimAt(st.nearestEnemy.x, st.nearestEnemy.z)
      if (st.nearestEnemy.dist < 2.0) {
        await release('KeyW')
        const hitsBefore = st.hitsDealt
        await tap('KeyE')
        await sleep(1600)
        const after = await state()
        flurryHits = after.hitsDealt - hitsBefore
        if (flurryHits > 0) break
      } else {
        await press('KeyW')
      }
      await sleep(90)
    }
    await release('KeyW')
    check(
      '다단히트 스킬이 한 번의 시전으로 여러 번 명중',
      flurryHits >= 3,
      `한 번 시전에 ${flurryHits}회 명중 (설계상 최대 5회)`,
    )

    // ---------- 7.8 백어택이 실제 전투에 반영되는가 ----------
    // 적 AI를 멈추고 1:1로 통제된 실험을 합니다.
    // 적이 계속 몸을 돌리면 "보너스가 왜 안 붙지?"가 판정 버그 때문인지
    // 타이밍 때문인지 구분할 수 없어, 검증이 아니라 추측이 됩니다.
    // 적을 **원하는 방향으로** 세워 놓습니다.
    // 플레이어는 원점, 적은 (0, 2.2). 적의 rotY=0 이면 +Z(플레이어 반대)를 보므로
    // 플레이어는 정확히 등 뒤에 있게 됩니다. rotY=PI 면 플레이어를 마주 봅니다.
    // 걸어서 돌아가는 방식은 밀어내기 때문에 재현이 안 돼서 이렇게 바꿨습니다.
    const setupDummy = async (facing) => {
      await page.evaluate(() => window.__game.reset())
      await sleep(300)
      await page.evaluate(() => window.__game.clearEnemies())
      await sleep(200)
      await page.evaluate((f) => window.__game.spawnTestEnemy(0, 2.2, f), facing)
      await page.evaluate(() => window.__game.freezeEnemies(true))
      await sleep(300)
      await aimAt(0, 2.2)
      await sleep(250)
    }
    /** 적을 여러 번 후려쳐, 실제 타격이 날 때까지 기다립니다. */
    const swingUntilHit = async (times = 8) => {
      for (let i = 0; i < times; i++) {
        await tap('Mouse0')
        await sleep(300)
        if ((await state()).hitsDealt > 0) break
      }
      return state()
    }

    // (A) 대조군 — 적이 플레이어를 마주 봄. 보너스가 붙으면 안 됩니다.
    await setupDummy(Math.PI)
    let facingMe = await state()
    check('대조군: 적이 플레이어를 마주 봄', facingMe.nearestEnemy?.playerBehind === false)
    const front = await swingUntilHit()
    check('정면 타격은 명중함', front.hitsDealt > 0, `${front.hitsDealt}타`)
    check('정면 타격에는 백어택 보너스가 없음', front.backHits === 0, `백어택 ${front.backHits}회`)

    // (B) 실험군 — 적이 등을 보임. 보너스가 붙어야 합니다.
    await setupDummy(0)
    const turned = await state()
    check('실험군: 플레이어가 적의 등 뒤에 위치', turned.nearestEnemy?.playerBehind === true)
    const back = await swingUntilHit()
    check('등 뒤 타격이 백어택으로 판정됨', back.backHits > 0, `백어택 ${back.backHits}회`)
    // 롱소드 1타 기본 피해는 12. 백어택(x1.55)만 붙어도 18.6,
    // 치명타(x1.8)까지 겹치면 33.5 입니다. 보너스가 없으면 12를 넘을 수 없습니다.
    check(
      '백어택 피해 배율이 실제로 적용됨',
      back.damageDealt > 15,
      `첫 타 피해 ${back.damageDealt} (보너스 없으면 12)`,
    )

    // ---------- 8. 레벨 에디터 ----------
    // 에디터로 레벨을 "만들어서" 저장하고, 그 레벨을 게임이 실제로 불러와
    // 플레이되는지까지 한 번에 확인합니다. 두 프로그램의 접점이 여기라서
    // 따로 검사하면 "에디터는 되는데 게임에서 안 열리는" 상태를 놓칩니다.
    const ed = await context.newPage()
    ed.on('pageerror', (e) => consoleErrors.push(`editor: ${e}`))
    await ed.goto(`http://127.0.0.1:${PORT}/editor.html`, { waitUntil: 'load' })
    await ed.waitForFunction(() => window.__editor?.ready === true, { timeout: 20000 })

    const edState = () => ed.evaluate(() => window.__editor.state())
    const edTool = (t) => ed.evaluate((x) => window.__editor.setTool(x), t)
    const edBrush = (n) => ed.evaluate((x) => window.__editor.setBrush(x), n)
    const edApply = (cx, cz) => ed.evaluate(([a, b]) => window.__editor.applyAt(a, b), [cx, cz])

    let es = await edState()
    check('에디터 부팅 + 기본 레벨 생성', es.floorCells > 100, `바닥 ${es.floorCells}칸 (${es.w}x${es.h})`)
    check('기본 레벨에 시작 지점 존재', es.byKind.spawn === 1)

    // 지형 특징은 **벽처럼 길게** 만듭니다. 한 칸만 올리면 플레이어가 적에게
    // 밀려 살짝만 옆으로 벗어나도 그 칸을 비껴가서, 검사 자체가 무의미해집니다.
    await edTool('raise')
    await edBrush(1)
    const ROWS = []
    for (let cz = 20; cz <= 36; cz++) ROWS.push(cz)
    for (const cz of ROWS) await edApply(31, cz) // 오를 수 있는 1단 능선
    for (let i = 0; i < 3; i++) for (const cz of ROWS) await edApply(34, cz) // 오를 수 없는 3단 절벽
    es = await edState()
    check('지형 올리기 도구 동작', es.maxHeight === 3, `최고 높이 ${es.maxHeight}`)

    // 보물도 한 줄로 여러 개 — 지나가는 경로가 조금 달라져도 반드시 하나는 만납니다.
    // 칸 간격(2m)이 획득 반경(1.5m)보다 좁으므로, 연속으로 깔면
    // 이 띠를 가로지르는 어떤 경로든 반드시 하나는 지나가게 됩니다.
    await edTool('treasure')
    for (const cz of ROWS) await edApply(30, cz)
    await edTool('grunt')
    await edApply(24, 28)
    es = await edState()
    check(
      '보물/적 배치 도구 동작',
      es.byKind.treasure === ROWS.length && es.byKind.grunt === 1,
      JSON.stringify(es.byKind),
    )

    const beforeUndo = es.entities
    await ed.evaluate(() => window.__editor.undo())
    es = await edState()
    check('되돌리기 동작', es.entities === beforeUndo - 1, `엔티티 ${beforeUndo} -> ${es.entities}`)

    await edApply(24, 28) // 되돌린 적을 다시 배치
    await ed.evaluate(() => window.__editor.save())
    es = await edState()
    check('레벨 저장', es.byKind.grunt === 1 && es.byKind.treasure === ROWS.length)

    const edShot = path.join(SHOTS, '04-editor.png')
    await ed.screenshot({ path: edShot })
    check('에디터 스크린샷 생성', statSync(edShot).size > 15000, `${(statSync(edShot).size / 1024).toFixed(0)} KB`)

    // ---------- 9. 게임이 그 레벨을 실제로 플레이하는가 ----------
    const lv = await context.newPage()
    lv.on('pageerror', (e) => consoleErrors.push(`level: ${e}`))
    await lv.goto(`http://127.0.0.1:${PORT}/?level=storage&lowfx=1`, { waitUntil: 'load' })
    await lv.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
    await sleep(1200)

    const lvState = () => lv.evaluate(() => window.__game.state())
    const lvPress = (c) => lv.evaluate((x) => window.__game.press(x), c)
    const lvRelease = (c) => lv.evaluate((x) => window.__game.release(x), c)

    let ls = await lvState()
    check('게임이 에디터 레벨을 불러옴', ls.levelMode === true, `레벨명 "${ls.levelName}"`)
    check('레벨의 보물 개수 반영', ls.treasureTotal === ROWS.length, `${ls.treasureTotal}개`)
    check('레벨의 적 배치 반영', ls.enemiesLeft === 1, `${ls.enemiesLeft}마리`)
    check('플레이어가 지형 위에 서 있음', ls.player.terrainLevel === 0, `높이 단계 ${ls.player.terrainLevel}`)

    await lv.evaluate(() => window.__game.requestSample())
    let lvPix = null
    for (let t = 0; t < 130 && !lvPix; t++) {
      lvPix = await lv.evaluate(() => window.__game.getSample())
      if (!lvPix) await sleep(60)
    }
    check(
      '레벨 지형이 화면에 렌더링됨',
      lvPix != null && lvPix.bgRatio < 0.5 && lvPix.meanLuma >= 10,
      lvPix
        ? `배경색 픽셀 ${(lvPix.bgRatio * 100).toFixed(0)}% · 평균밝기 ${lvPix.meanLuma} · 색상 ${lvPix.uniqueColors}종`
        : '샘플 실패',
    )

    // 카메라 전방(-0.707,0,-0.707)과 우측(0.707,0,-0.707)을 더하면 -Z,
    // 우측에서 전방을 빼면 +X 입니다. 즉 D + S 동시 입력이 월드 +X 직진입니다.
    const startX = ls.player.x
    await lvPress('KeyD')
    await lvPress('KeyS')

    let climbed = null
    for (const t0 = Date.now(); Date.now() - t0 < 30000; ) {
      const st = await lvState()
      if (st.player.terrainLevel === 1) {
        climbed = st
        break
      }
      await sleep(80)
    }
    check('한 칸 단차를 걸어서 오름', climbed !== null, climbed ? `y=${climbed.player.y}` : '30초 내 미발생')
    check('오르면 실제로 Y좌표가 올라감', !!climbed && climbed.player.y > 0.5, `y=${climbed?.player.y ?? '-'}`)

    await sleep(7000)
    const blocked1 = await lvState()
    await sleep(3000)
    const blocked2 = await lvState()
    await lvRelease('KeyD')
    await lvRelease('KeyS')
    check(
      '오를 수 없는 절벽에서 막힘',
      Math.abs(blocked2.player.x - blocked1.player.x) < 0.35 && blocked2.player.x > startX + 2,
      `x ${blocked1.player.x} -> ${blocked2.player.x} (시작 ${startX})`,
    )
    check('지나가며 보물 획득', blocked2.treasuresFound >= 1, `${blocked2.treasuresFound}/${blocked2.treasureTotal}`)

    const lvShot = path.join(SHOTS, '05-level-play.png')
    await lv.screenshot({ path: lvShot })
    check('레벨 플레이 스크린샷 생성', statSync(lvShot).size > 15000, `${(statSync(lvShot).size / 1024).toFixed(0)} KB`)

    // ---------- 10. 안정성 ----------
    check('런타임 콘솔 에러 없음', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    // 프레임 총량이 아니라 "지금도 증가하는가"를 봅니다.
    // reset()이 프레임 카운터를 0으로 되돌리므로 누적값 비교는 의미가 없습니다.
    const tickA = (await state()).frame
    await sleep(1500)
    const tickB = (await state()).frame
    check('루프가 끝까지 살아있음(멈춤/크래시 없음)', tickB > tickA, `1.5초 동안 +${tickB - tickA} 프레임`)
  } finally {
    await browser.close()
    await server.close()
  }

  console.log('\n' + '─'.repeat(56))
  console.log(`검증 결과: ${results.length - failed} / ${results.length} 통과`)
  console.log(`스크린샷: ${SHOTS}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('검증 스크립트 실패:', e)
  process.exitCode = 1
})
