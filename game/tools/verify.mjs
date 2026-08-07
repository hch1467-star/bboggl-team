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

  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })

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
    check('플레이어가 원점에 스폰됨', Math.abs(s.player.x) < 0.01 && Math.abs(s.player.z) < 0.01)
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
      pix != null && pix.uniqueColors >= 12 && pix.meanLuma >= 10 && pix.darkRatio <= 0.7,
      pix ? `색상 ${pix.uniqueColors}종 · 평균밝기 ${pix.meanLuma} · 어두운픽셀 ${(pix.darkRatio * 100).toFixed(0)}%` : '샘플 수집 실패')

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

    // ---------- 8. 안정성 ----------
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
