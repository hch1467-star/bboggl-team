/**
 * 보스 조우 검증 — `npm run arena`
 *
 * ── 무엇을 확인하는가 ──────────────────────────────────────────────
 * 보스 어그로가 55m라 존을 가로지르면 **잡몹 전투 도중에 보스가 걸어
 * 들어왔습니다.** 3페이즈짜리 보스전을 잡몹 넷과 섞으면 페이즈도 연계도
 * 읽을 수가 없습니다. 그리고 걷다 보면 어느새 시작돼 있어서 준비할 순간이
 * 없었습니다.
 *
 * 그래서 세 가지를 봅니다:
 *   1. 영역 **밖**에서는 보스가 잠들어 있는가 (전투 격리)
 *   2. 영역에 들어서면 **준비 구간**이 생기는가 (그동안 공격 안 함)
 *   3. 도망치면 **초기화**되는가 (때리고 도망 반복이 최적이 되면 안 됩니다)
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5190
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
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // 음악 검사를 하려면 자동재생 정책을 꺼야 합니다(audio-probe.mjs 와 같은 이유).
    '--autoplay-policy=no-user-gesture-required',
  ],
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
        const deadline = Date.now() + 120000
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
      /** 보스를 홀로 세우고, 플레이어를 지정한 거리에 놓습니다. */
      setup: async (dist) => {
        window.__game.reset()
        await window.__t.runFor(0.5)
        window.__game.clearEnemies()
        await window.__t.runFor(0.2)
        const p = window.__game.state().player
        const b = window.__game.spawnBoss(p.x + 40, p.z)
        await window.__t.runFor(0.2)
        // 보스의 자리를 기준으로 플레이어를 옮깁니다.
        window.__game.teleportPlayer(p.x + 40 - dist, p.z)
        await window.__t.runFor(0.3)
        return b
      },
    }
  })

  console.log('\n🚪 보스 조우 검증\n')

  const cfg = await page.evaluate(async () => {
    await window.__t.setup(40)
    return window.__game.bossEncounter()
  })
  console.log(`  [영역] 진입 ${cfg.arenaRadius}m · 이탈 ${cfg.leashRadius}m`)

  // ---- 1. 영역 밖에서는 잠들어 있는가 ----
  const outside = await page.evaluate(async () => {
    await window.__t.setup(30)
    await window.__t.runFor(6)
    return window.__game.bossEncounter()
  })
  check(
    outside.encounter === 0 && outside.aggro === 0,
    '영역 밖(30m)에서는 보스가 반응하지 않음',
    `상태 ${outside.encounter} · 어그로 ${outside.aggro} · 거리 ${outside.homeDist}m`,
  )

  // ---- 2. 들어서면 조우 + 준비 구간 ----
  console.log('')
  const enter = await page.evaluate(async () => {
    await window.__t.setup(10)
    // 조우가 잡힐 때까지
    await window.__t.until(() => (window.__game.bossEncounter()?.encounter ?? 0) > 0, 4)
    const started = window.__game.bossEncounter()
    // 준비 구간(연출) 동안 공격을 하지 않아야 합니다.
    let attackedDuringIntro = false
    while ((window.__game.bossEncounter()?.encounter ?? 0) === 1) {
      const info = window.__game.enemyInfo(started.entity)
      if (info?.attacking) attackedDuringIntro = true
      await new Promise((r) => setTimeout(r, 8))
    }
    const after = window.__game.bossEncounter()
    return { started, attackedDuringIntro, after }
  })
  check(enter.started.encounter === 1, '영역에 들어서면 조우가 시작됨', `상태 ${enter.started.encounter}`)
  check(!enter.attackedDuringIntro, '준비 구간 동안 보스가 공격하지 않음')
  check(enter.after.encounter === 2, '준비가 끝나면 교전으로 넘어감', `상태 ${enter.after.encounter}`)

  // ---- 3. 도망치면 초기화되는가 ----
  //
  // 이게 없으면 "때리고 도망, 회복하고 다시"가 최적 전략이 되어 보스전이
  // 소모전이 됩니다. 도망은 가능하되 **아무것도 얻지 못해야** 합니다.
  console.log('')
  const flee = await page.evaluate(async () => {
    await window.__t.setup(8)
    await window.__t.until(() => (window.__game.bossEncounter()?.encounter ?? 0) === 2, 6)
    const b = window.__game.bossEncounter().entity
    // 체력을 깎고 페이즈를 올린 상태로 도망칩니다.
    /**
     * ⚠️ **1단계 학습 잠금을 끄고 잽니다.**
     *
     * 이 검사 셋이 **아주 오래 빨간 채**로 있었습니다. 원인은 게임이 아니라
     * 이 프로브였습니다 — 보스는 1단계에서 색 셋을 다 보여줄 때까지 체력이
     * `최대치 × 0.75 + 0.5` 아래로 **안 내려갑니다**(enemyAI 학습 잠금).
     * 그래서 체력을 절반 깎아도 620 → **465.5** 로 되돌아오고, 페이즈가
     * 영영 안 올라갑니다. 넣은 피해 310 중 154.5 만 남은 것처럼 보였습니다.
     *
     * `npm run boss` 는 이 함정을 이미 알고 있었습니다(그 파일 주석:
     * *"학습 잠금이 켜져 있으면 상관없는 검사 열 개가 같이 빨개집니다 —
     * 실제로 그렇게 만들어 놓고 한 번 당했습니다"*). 이 프로브만 그 처리를
     * 못 받은 채 남아 있었습니다.
     *
     * 여기서 재는 것은 **도망과 귀환**이지 학습이 아니므로, 재는 자리를
     * 나눕니다 — 잠금 자체는 `npm run boss` 가 켠 채로 잽니다.
     */
    window.__game.setPhaseTeaching(false)
    const before = window.__game.bossEncounter()
    window.__game.damageEntity(b, before.maxHp * 0.5)

    await window.__t.until(() => (window.__game.bossEncounter()?.phase ?? 0) > 0, 6)
    const hurt = window.__game.bossEncounter()

    /**
     * **먼저 보스를 자기 자리에서 끌어냅니다.**
     *
     * 안 끌어내고 바로 도망치면 보스가 이미 제자리에 서 있어서 귀환이
     * **같은 프레임에 끝나버립니다**(상태 3을 한 번도 못 봄).
     * 실제로 이 프로브가 그렇게 실패했었습니다 — 게임은 정상이고
     * 관측이 순간을 놓친 것이었습니다.
     */
    const start = window.__game.state().player
    window.__game.teleportPlayer(start.x - 12, start.z)
    await window.__t.until(() => (window.__game.bossEncounter()?.selfHomeDist ?? 0) > 5, 20)
    const lured = window.__game.bossEncounter()

    /**
     * **먼저 "잠깐 나갔다 오기"를 확인합니다.**
     *
     * 소울라이크에서 물러나 회복하고 복귀하는 것은 정상적인 플레이입니다.
     * 거리만으로는 이 정상 후퇴와 도망을 구분할 수 없어서 **시간**을 씁니다.
     * 유예 시간의 절반만 밖에 있다가 돌아오면 교전이 유지되어야 합니다.
     */
    const home = window.__game.state().player
    const outX = home.x - hurt.leashRadius - 12
    window.__game.teleportPlayer(outX, home.z)
    await window.__t.runFor(hurt.leashGrace * 0.5)
    const brief = window.__game.bossEncounter()
    window.__game.teleportPlayer(home.x, home.z) // 복귀
    await window.__t.runFor(0.4)
    const returned = window.__game.bossEncounter()

    // 이제 진짜 도망 — 유예 시간을 넘겨 밖에 머뭅니다.
    window.__game.teleportPlayer(outX, home.z)
    await window.__t.until(() => (window.__game.bossEncounter()?.encounter ?? 0) === 3, 10)
    const leashed = window.__game.bossEncounter()
    // 자리로 돌아가 초기화될 때까지.
    await window.__t.until(() => (window.__game.bossEncounter()?.encounter ?? 9) === 0, 30)
    // 끝나면 원래대로 — 다음 절이 잠금 켜진 게임을 재도록.
    window.__game.setPhaseTeaching(true)
    return { hurt, lured, brief, returned, leashed, reset: window.__game.bossEncounter() }
  })
  check(
    flee.hurt.hp < flee.hurt.maxHp && flee.hurt.phase > 0,
    '교전 중 체력이 깎이고 페이즈가 올라감',
    `체력 ${flee.hurt.hp}/${flee.hurt.maxHp} · ${flee.hurt.phase + 1}단계` +
      // 안 올라갔다면 **왜인지**를 게임에게 물어서 같이 냅니다(설계 노트: phaseTeachHold).
      (flee.hurt.phase === 0 && flee.hurt.teachHold?.holding
        ? ` — ⚠️ 학습 잠금이 붙잡는 중(색 ${flee.hurt.teachHold.seen}/${flee.hurt.teachHold.need})`
        : ''),
  )
  check(
    flee.lured.selfHomeDist > 5,
    '보스가 자리에서 끌려나옴 (귀환을 관측하기 위한 준비)',
    `자리에서 ${flee.lured.selfHomeDist}m`,
  )
  check(
    flee.brief.encounter === 2 && flee.brief.leashT > 0,
    '잠깐 나가는 것만으로는 포기하지 않음 (회복하러 물러날 여지)',
    `유예 ${flee.hurt.leashGrace}초 중 ${flee.brief.leashT}초 경과 · 상태 ${flee.brief.encounter}`,
  )
  check(
    flee.returned.leashT === 0,
    '돌아오면 이탈 시간이 0으로 리셋됨',
    `${flee.brief.leashT}초 → ${flee.returned.leashT}초`,
  )
  check(flee.leashed.encounter === 3, '유예를 넘겨 머물면 귀환 상태로', `상태 ${flee.leashed.encounter}`)
  check(
    flee.reset.encounter === 0 && flee.reset.hp === flee.reset.maxHp,
    '자리로 돌아가면 체력이 완전히 회복됨',
    `${flee.hurt.hp} → ${flee.reset.hp}`,
  )
  check(flee.reset.phase === 0, '페이즈도 1단계로 되돌아감', `${flee.reset.phase + 1}단계`)

  // ---- 4. 보스 음악 ----
  //
  // 탐험 구간은 **의도적으로 조용합니다**(core/audio.ts 설계 노트).
  // 그래서 "음악이 있다"보다 **"보스전에만 있다"**가 확인할 것입니다.
  console.log('')
  const music = await page.evaluate(async () => {
    window.__game.audio.unlock()
    await new Promise((r) => setTimeout(r, 300))
    const ready = window.__game.audio.state().state === 'running'
    if (!ready) return { ready: false }

    await window.__t.setup(40) // 영역 밖 — 탐험 상태
    await window.__t.runFor(1)
    const exploring = window.__game.audio.music()

    await window.__t.setup(10) // 영역 안 — 조우
    await window.__t.until(() => window.__game.audio.music().level > 0, 6)
    const fighting = window.__game.audio.music()

    // 페이즈를 올리면 음악도 세져야 합니다.
    const b = window.__game.bossEncounter().entity
    /**
     * ⚠️ 여기도 **학습 잠금을 끕니다.** 위 도망 절과 같은 이유입니다 —
     *    잠금이 켜져 있으면 체력을 아무리 깎아도 1단계에 붙잡혀 있어서
     *    *"페이즈가 오르면 음악도 거세짐"* 이 영영 성립하지 않습니다.
     *    이 절이 재는 것은 **음악이 페이즈를 따라가는가**이지 학습이 아닙니다.
     */
    window.__game.setPhaseTeaching(false)
    window.__game.damageEntity(b, window.__game.bossEncounter().maxHp * 0.4)
    await window.__t.until(() => window.__game.audio.music().level > 1, 8)
    const phase2 = window.__game.audio.music()

    // 보스를 죽이면 멎어야 합니다.
    window.__game.damageEntity(b, 99999)
    await window.__t.until(() => window.__game.audio.music().level === 0, 6)
    return { ready: true, exploring, fighting, phase2, after: window.__game.audio.music() }
  })
  if (!music.ready) {
    console.log('  ⚠️  오디오가 running 이 아니라 음악 검사를 건너뜁니다.')
  } else {
    check(music.exploring.level === 0, '탐험 중에는 음악이 없음 (침묵이 설계)', `단계 ${music.exploring.level}`)
    check(music.fighting.level >= 1, '보스 조우에서 음악이 시작됨', `단계 ${music.fighting.level} · 드론 ${music.fighting.voices}개`)
    check(
      music.phase2.level > music.fighting.level && music.phase2.voices > music.fighting.voices,
      '페이즈가 오르면 음악도 거세짐 (드론이 쌓임)',
      `${music.fighting.level}단계 드론 ${music.fighting.voices}개 → ${music.phase2.level}단계 드론 ${music.phase2.voices}개`,
    )
    check(music.after.level === 0, '보스를 잡으면 음악이 멎음', `단계 ${music.after.level}`)
  }

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
