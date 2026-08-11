/**
 * 사운드 검증 — `npm run audio`
 *
 * ── 왜 별도의 도구가 필요한가 ───────────────────────────────────────
 * 헤드리스 브라우저에는 스피커가 없습니다. 그래서 "예외 없이 실행됐다"까지만
 * 확인하면 **무음 버그를 전부 놓칩니다**: 게인이 0인 채로 연결됐거나, 노드를
 * destination 에 안 이었거나, 봉투(envelope) 시간이 뒤집혀서 소리가 나기 전에
 * 꺼지거나 — 전부 예외 없이 조용히 실패합니다.
 *
 * 그래서 마스터 뒤에 AnalyserNode 를 달아 **실제 파형의 진폭**을 잽니다.
 * 진폭 > 0 이면 그 소리는 정말로 destination 까지 흘러갔다는 뜻입니다.
 *
 * 헤드리스에서도 WebAudio 그래프는 정상적으로 렌더링됩니다(장치 없이 null sink
 * 로 돌아감). `--autoplay-policy=no-user-gesture-required` 로 사용자 조작
 * 요구만 꺼 주면 됩니다.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5183
// 컨테이너에는 Playwright가 내려받은 브라우저가 없어, 미리 설치된 경로를 씁니다.
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

/** 큐 하나를 울리고 진폭이 올라오는지 확인합니다. */
const CUES = [
  { name: 'swing', args: [0.2, 0], label: '휘두르기(가벼움)' },
  { name: 'swing', args: [1.0, 0], label: '휘두르기(무거움)' },
  { name: 'impact', args: [0, 0], label: '타격(일반)' },
  { name: 'impact', args: [1, 1], label: '타격(강+치명)' },
  /**
   * ⚠️ 예고음은 **여기에 손으로 적지 않습니다.** 게임에서 읽어 옵니다.
   *
   * 예전에는 네 줄이 손으로 적혀 있었습니다(🔴🟡🔵🟣). 그러다 🟢 반격이
   * 색으로 추가됐는데 이 목록은 안 늘었고, 그래서 **초록만 소리가 없는
   * 상태를 이 프로브가 통과시켰습니다.** 목록을 베껴 적는 순간 프로브는
   * "있는 것"이 아니라 "적어 둔 것"을 검사하게 됩니다.
   *
   * 지금은 아래에서 `enemyRoster()` 가 실제로 쓰는 의도를 모아 만듭니다.
   */
  { name: 'dodge', args: [0, 0], label: '회피' },
  { name: 'hurt', args: [0, 0], label: '피격' },
  { name: 'death', args: [0, 0], label: '처치(잡몹)' },
  { name: 'death', args: [1, 0], label: '처치(보스)' },
  { name: 'cast', args: [0, 0], label: '시전(롱소드)' },
  { name: 'cast', args: [1, 0], label: '시전(대검)' },
  { name: 'pickup', args: [0, 0], label: '획득' },
  { name: 'deny', args: [0, 0], label: '거절(스태미나 부족)' },
]

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
    // 이 두 줄이 핵심입니다. 자동재생 정책을 끄지 않으면 AudioContext 가
    // 영원히 suspended 로 남아서 파형이 0으로만 나옵니다(= 가짜 실패).
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=AudioServiceOutOfProcess',
  ],
})

try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })

  console.log('\n🔊 사운드 검증\n')

  // ---- 1. 오디오가 열리는가 ----
  const state = await page.evaluate(async () => {
    window.__game.audio.unlock()
    await new Promise((r) => setTimeout(r, 300))
    return window.__game.audio.state()
  })
  check(state.ready, '오디오 컨텍스트 생성', `state=${state.state}`)
  check(state.state === 'running', '오디오 실행 중', state.state)
  check(!state.muted, '기본값은 소리 켜짐')

  if (state.state !== 'running') {
    console.log('\n⚠️  오디오가 running 이 아니라 파형 측정을 건너뜁니다.')
  } else {
    /**
     * 게임이 **실제로 쓰는** 예고 색을 모아 큐 목록을 만듭니다.
     * 색을 하나 더 만들면 이 프로브가 저절로 그 색까지 검사합니다.
     */
    const roster = await page.evaluate(() => window.__game.enemyRoster())
    const intents = new Map()
    for (const r of roster) {
      for (const a of r.attacks) if (!intents.has(a.intent)) intents.set(a.intent, a.color)
    }
    const telegraphCues = [...intents.entries()]
      .sort((a, b) => a[0] - b[0])
      // 예고음은 위치가 있는 소리 — 두 번째 인자는 플레이어로부터의 거리(m).
      .map(([intent, emoji]) => ({ name: 'telegraph', args: [intent, 3], label: `예고 ${emoji}` }))
    console.log(`\n  (게임이 쓰는 예고 색 ${telegraphCues.length}가지를 읽어 왔습니다)`)

    // ---- 2. 큐마다 실제 파형이 나오는가 ----
    console.log('\n  [파형 진폭 — 0이면 소리가 안 난 것]')
    for (const cue of [...CUES, ...telegraphCues]) {
      const peak = await page.evaluate(
        async ({ name, args }) => {
          // 이전 소리가 남아 있으면 다른 큐의 진폭을 빌려옵니다. 충분히 재웁니다.
          await new Promise((r) => setTimeout(r, 700))
          const before = window.__game.audio.level()
          window.__game.audio.cue(name, args[0], args[1])
          /**
           * 소리가 시작되고 봉투가 정점을 지나는 동안 여러 번 샘플링합니다.
           *
           * **창 길이가 가장 긴 소리보다 길어야 합니다.** 288ms 로 재던 때
           * 🟡 Sweep(0.41초에 정점) 만 4배 작게 나와서, 있지도 않은 밸런스
           * 문제를 고칠 뻔했습니다. 측정 도구가 틀리면 튜닝도 같이 틀립니다.
           */
          let peak = 0
          for (let i = 0; i < 60; i++) {
            await new Promise((r) => setTimeout(r, 12))
            const v = window.__game.audio.level()
            if (v > peak) peak = v
          }
          return { peak, before }
        },
        { name: cue.name, args: cue.args },
      )
      check(
        peak.peak > 0.005,
        cue.label,
        `진폭 ${peak.peak.toFixed(4)} (직전 잔향 ${peak.before.toFixed(4)})`,
      )
    }

    // ---- 3. 음소거가 실제로 소리를 끄는가 ----
    const muted = await page.evaluate(async () => {
      // press 는 "누른 채로" 두는 것이라 반드시 release 해야 다음 press 가 먹습니다.
      const tap = async (code) => {
        window.__game.press(code)
        await new Promise((r) => setTimeout(r, 120))
        window.__game.release(code)
        await new Promise((r) => setTimeout(r, 120))
      }
      await tap('KeyM')
      await new Promise((r) => setTimeout(r, 200))
      const st = window.__game.audio.state()
      let peak = 0
      window.__game.audio.cue('impact', 1, 1)
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 12))
        const v = window.__game.audio.level()
        if (v > peak) peak = v
      }
      await tap('KeyM')
      await new Promise((r) => setTimeout(r, 200))
      return { muted: st.muted, peak, after: window.__game.audio.state().muted }
    })
    console.log('')
    check(muted.muted, 'M 키로 음소거됨')
    check(muted.peak < 0.005, '음소거 중에는 파형이 0', `진폭 ${muted.peak.toFixed(4)}`)
    check(!muted.after, 'M 키를 다시 누르면 복귀')

    // ---- 4. 보이스 누수가 없는가 ----
    // 소리마다 노드를 새로 만들기 때문에, 반납이 안 되면 상한(20)에 걸려서
    // 전투가 길어질수록 소리가 조금씩 사라집니다. 조용히 나빠지는 종류의 버그라
    // 반드시 자동으로 잡아야 합니다.
    const leak = await page.evaluate(async () => {
      for (let i = 0; i < 60; i++) {
        window.__game.audio.cue('impact', i % 2, i % 3)
        await new Promise((r) => setTimeout(r, 45))
      }
      await new Promise((r) => setTimeout(r, 1500))
      return window.__game.audio.state().voices
    })
    console.log('')
    check(leak === 0, '보이스 누수 없음 (60회 재생 후)', `남은 보이스 ${leak}`)

    // ---- 5. 거리 감쇠 ----
    // 멀리 있는 적의 소리가 코앞의 소리와 같은 크기면 정보로서 쓸모가 없습니다.
    const dist = await page.evaluate(async () => {
      const measure = async (metres) => {
        await new Promise((r) => setTimeout(r, 700))
        window.__game.audio.cue('telegraph', 1, metres)
        let peak = 0
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => setTimeout(r, 12))
          const v = window.__game.audio.level()
          if (v > peak) peak = v
        }
        return peak
      }
      return { near: await measure(2), far: await measure(18), out: await measure(40) }
    })
    check(dist.near > 0.005, '가까운 예고음(2m)이 들림', `진폭 ${dist.near.toFixed(4)}`)
    check(
      dist.far > 0 && dist.far < dist.near * 0.6,
      '먼 예고음(18m)은 확실히 작음',
      `2m ${dist.near.toFixed(4)} → 18m ${dist.far.toFixed(4)}`,
    )
    check(dist.out < 0.005, '가청거리(26m) 밖은 아예 안 남', `40m 진폭 ${dist.out.toFixed(4)}`)

    // ---- 6. 게임 안에서 실제로 울리는가 (통합) ----
    //
    // 위까지는 "소리를 직접 부르면 난다"만 증명합니다. 정작 중요한 건
    // **전투 코드가 그 함수를 부르느냐**입니다. 훅을 하나 빠뜨려도 위 검사는
    // 전부 통과합니다 — 그래서 이 항목이 따로 있어야 합니다.
    console.log('')
    const inGame = await page.evaluate(async () => {
      const sample = async (ms) => {
        let peak = 0
        const until = Date.now() + ms
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, 10))
          const v = window.__game.audio.level()
          if (v > peak) peak = v
        }
        return peak
      }
      window.__game.clearEnemies()
      await new Promise((r) => setTimeout(r, 400))
      const idle = await sample(400)

      // 눈앞에 적을 세우고 조준한 뒤 때립니다 → 휘두르기 + 타격이 나야 합니다.
      const st = window.__game.state().player
      window.__game.spawnTestEnemy(st.x + 1.6, st.z)
      window.__game.aimAtWorld(st.x + 1.6, st.z)
      await new Promise((r) => setTimeout(r, 120))
      window.__game.press('Mouse0')
      await new Promise((r) => setTimeout(r, 40))
      window.__game.release('Mouse0')
      const attack = await sample(900)

      /**
       * 적 예고 — 적이 다가와 공격을 시작할 때까지 기다립니다.
       *
       * **벽시계로 기다리면 안 됩니다.** SwiftShader 소프트웨어 렌더링에서는
       * 시뮬레이션이 실시간의 1/3~1/20 속도로 흐릅니다. 2.5초를 기다려도
       * 게임 안에서는 0.3초밖에 안 지나서, 잡몹의 선행동작(0.55초)조차
       * 시작되지 않습니다. 그래서 **상태를 보고** 기다립니다.
       */
      window.__game.clearEnemies()
      await new Promise((r) => setTimeout(r, 600))
      const e = window.__game.spawnTestEnemy(st.x + 3, st.z)
      window.__game.freezeEnemies(false)
      let telegraph = 0
      const deadline = Date.now() + 30000
      while (Date.now() < deadline && telegraph < 0.005) {
        const v = window.__game.audio.level()
        if (v > telegraph) telegraph = v
        await new Promise((r) => setTimeout(r, 8))
      }
      const simElapsed = window.__game.state().elapsed
      window.__game.clearEnemies()
      return { idle, attack, telegraph, entity: e, simElapsed }
    })
    check(inGame.idle < 0.005, '아무것도 안 할 때는 무음', `진폭 ${inGame.idle.toFixed(4)}`)
    check(
      inGame.attack > 0.01,
      '게임 안에서 공격하면 소리가 남',
      `진폭 ${inGame.attack.toFixed(4)}`,
    )
    check(
      inGame.telegraph > 0.005,
      '적이 다가와 예고하면 소리가 남',
      `진폭 ${inGame.telegraph.toFixed(4)} · 시뮬레이션 ${inGame.simElapsed.toFixed(1)}초`,
    )
  }

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
