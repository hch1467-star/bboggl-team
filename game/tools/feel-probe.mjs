/**
 * 컨트롤의 쫀득함 — `npm run feel`
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────
 * *"이 게임의 재미가 손맛인지 컨트롤인지 스피드인지 화려함인지"* 를 정해야
 * 하는데, 정하려면 **지금 값이 얼마인지** 알아야 합니다. 그리고 컨트롤
 * 게임에서 가장 중요한 한 값을 이 프로젝트는 **한 번도 안 쟀습니다** —
 * 누른 뒤 게임이 그걸 **접수하기까지** 걸리는 시간입니다.
 *
 * 이 값이 나쁘면 다른 것을 아무리 잘 만들어도 "씹힌다"가 됩니다. 4색을
 * 아무리 잘 읽어도, 읽고 누른 것이 안 나가면 읽은 보람이 없습니다.
 *
 * ── 셋을 갈라서 잽니다 ─────────────────────────────────────────
 * 한 덩어리로 재면 처방이 안 나옵니다. "느리다"의 뜻이 셋이나 되기 때문입니다:
 *
 *   1. **접수 지연** — 누른 순간 → 상태가 바뀌는 순간.
 *      이건 **버그의 영역**입니다. 다음 프레임에 안 바뀌면 입력을 흘린 것이고,
 *      플레이어는 "씹혔다"고 느낍니다. 목표는 **1프레임**.
 *   2. **판정 지연** — 누른 순간 → 실제로 때리는 순간.
 *      이건 **설계의 영역**입니다. 대검이 느린 것은 고장이 아니라 성격입니다.
 *      여기서는 값을 **찍기만** 하고 판정하지 않습니다.
 *   3. **되찾는 시간** — 누른 순간 → 다시 아무거나 할 수 있는 순간.
 *      이게 길면 "무겁다", 짧으면 "가볍다"입니다. 역시 성격입니다.
 *
 * ⚠️ **벽시계로 재지 않습니다.** 이 컨테이너는 GPU가 없어 10~20fps 로 돕니다.
 *    벽시계로 재면 게임이 아니라 **컨테이너를 재게** 됩니다. 시뮬레이션
 *    시계(`simElapsed`)와 **프레임 수**로 잽니다 — 둘 다 게임의 것입니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5225
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

  console.log('\n🎮 컨트롤의 쫀득함 — 누른 것이 언제 접수되는가\n')
  console.log('  [기준] 접수는 **1프레임**. 2프레임 이상이면 플레이어는 "씹혔다"고 느낍니다.')
  console.log('         판정·되찾기는 무기의 성격이라 찍기만 합니다.\n')

  const t = await page.evaluate(() => window.__game.terrainInfo())

  const measure = await page.evaluate(
    async ([states]) => {
      const G = window.__game
      const sleep = () => new Promise((r) => setTimeout(r, 4))
      const frame = () => G.state().frame
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t0 = now()
        const dl = Date.now() + 20000
        while (now() - t0 < sec && Date.now() < dl) await sleep()
      }
      const untilIdle = async () => {
        const dl = Date.now() + 20000
        while (G.state().player.state !== states.idle && Date.now() < dl) await sleep()
      }

      /**
       * 한 동작을 재는 한 판.
       *
       * ⚠️ 누르기 **직전의 프레임 번호**를 잡아 둡니다. 눌러 놓고 나중에
       *    "몇 프레임 지났나"를 세면, 누르는 사이에 흘러간 프레임까지
       *    지연으로 세어 **게임을 억울하게 만듭니다.**
       */
      const one = async (key, weaponSlot) => {
        G.reset()
        await wait(0.5)
        G.clearEnemies()
        await wait(0.3)
        if (weaponSlot != null) {
          G.press(`Digit${weaponSlot + 1}`)
          G.release(`Digit${weaponSlot + 1}`)
          await wait(0.5)
        }
        G.setStamina(100)
        G.setFocus(3)
        await untilIdle()
        await sleep()

        const f0 = frame()
        const t0 = now()
        G.press(key)
        G.release(key)

        let ackFrames = -1
        let ackT = -1
        let hitT = -1
        let backT = -1
        const dl = Date.now() + 20000
        while (Date.now() < dl) {
          const p = G.state().player
          if (ackFrames < 0 && p.state !== states.idle) {
            ackFrames = frame() - f0
            ackT = now() - t0
          }
          if (ackFrames >= 0 && hitT < 0 && p.phase === 1 && p.state !== states.idle) {
            hitT = now() - t0
          }
          if (ackFrames >= 0 && p.state === states.idle) {
            backT = now() - t0
            break
          }
          if (now() - t0 > 4) break
          await sleep()
        }
        return { ackFrames, ackT, hitT, backT }
      }

      /**
       * ⚠️ **여러 번 재서 중앙값을 씁니다.**
       *
       * 한 번만 재면 이 검사가 게임과 무관하게 빨강·초록을 오갑니다 —
       * 이번 세션에만 세 번 그랬습니다(`2프레임`). 원인은 게임이 아니라
       * **계측의 경주**입니다: `f0 = frame()` 을 읽은 뒤 `G.press` 가
       * 실제로 접수되기까지 사이에 프레임이 한 번 넘어가면 그대로 +1 이
       * 됩니다. 헤드리스 8~20fps 에서는 자주 있는 일입니다.
       *
       * 그래서 반복해서 재고 **중앙값**으로 판정합니다. (최솟값이 아닙니다 —
       * 이 저장소는 `min` 이 프레임 빗나감을 골라내는 바람에 "평타
       * 0.005초"라는 거짓말을 이미 한 번 냈습니다.) 폭은 옆에 찍어서
       * 사람이 읽습니다 — **폭이 곧 이 계측기의 정직함**입니다.
       */
      const REPS = 5
      const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
      const many = async (key, w) => {
        const runs = []
        for (let i = 0; i < REPS; i++) runs.push(await one(key, w))
        /**
         * ⚠️ **네 값을 전부 각자 중앙값으로 냅니다.**
         *
         * 처음엔 프레임만 중앙값으로 내고 시간(`ackT`)은 "첫 성공한 판"의
         * 것을 그대로 썼습니다. 그러면 한 줄 안에서 **서로 다른 판의
         * 숫자가 섞입니다** — 중앙값 1프레임 옆에 2프레임짜리 판의 0.100초가
         * 붙는 식으로요. 이 저장소가 몇 번이나 물린 그 실수입니다:
         * *"수명이 다른 숫자를 나란히 놓지 마라."*
         */
        const pick = (f) => {
          const xs = runs.map(f).filter((v) => v >= 0)
          return xs.length ? med(xs) : -1
        }
        const acks = runs.map((r) => r.ackFrames).filter((v) => v >= 0)
        return {
          ackFrames: pick((r) => r.ackFrames),
          ackT: pick((r) => r.ackT),
          hitT: pick((r) => r.hitT),
          backT: pick((r) => r.backT),
          ackSpan: acks.length ? `${Math.min(...acks)}~${Math.max(...acks)}` : '—',
        }
      }

      const out = []
      const weapons = G.weaponTable()
      for (let w = 0; w < weapons.length; w++) {
        out.push({ name: `${weapons[w].name} 기본공격`, ...(await many('Mouse0', w)) })
      }
      out.push({ name: '구르기', ...(await many('Space', 0)) })
      out.push({ name: '강타', ...(await many('Mouse2', 0)) })
      out.push({ name: '스킬 Q', ...(await many('KeyQ', 0)) })
      return out
    },
    [t.actorStates],
  )

  console.log('  [동작]            접수      판정      되찾기')
  for (const m of measure) {
    console.log(
      `    ${m.name.padEnd(16)} ${m.ackFrames < 0 ? '  안 나감' : `${m.ackFrames}프레임(${m.ackSpan})`}` +
        `  ${m.hitT < 0 ? '   —' : `${m.hitT.toFixed(2)}초`}` +
        `  ${m.backT < 0 ? '   —' : `${m.backT.toFixed(2)}초`}`,
    )
  }
  console.log('')

  const acked = measure.filter((m) => m.ackFrames >= 0)
  check(
    acked.length === measure.length,
    '모든 동작이 실제로 나갔다 (안 나간 것을 0프레임으로 세지 않게)',
    `${acked.length}/${measure.length}`,
  )
  const worst = acked.reduce((a, b) => (b.ackFrames > a.ackFrames ? b : a), acked[0])
  check(
    acked.length > 0 && worst.ackFrames <= 1,
    '누른 것이 **다음 프레임에** 접수된다 (가장 느린 동작 기준)',
    worst ? `${worst.name} ${worst.ackFrames}프레임 (${worst.ackT.toFixed(3)}초)` : '',
  )

  /**
   * ---- 무기 성격이 실제로 갈리는가 ----
   *
   * 이건 "쫀득함"이 아니라 **선택의 값어치**입니다. 세 무기의 판정 지연이
   * 같으면 무기를 고르는 일이 겉치레가 됩니다. 판정하지 않고 **차이만**
   * 봅니다 — 얼마가 맞는지는 이 프로브가 정할 일이 아닙니다.
   */
  const basics = measure.filter((m) => m.name.includes('기본공격') && m.hitT > 0)
  if (basics.length >= 2) {
    const lo = Math.min(...basics.map((m) => m.hitT))
    const hi = Math.max(...basics.map((m) => m.hitT))
    check(
      hi - lo >= 0.05,
      '무기마다 판정 지연이 다르다 (무기를 고르는 것이 겉치레가 아니다)',
      `${lo.toFixed(2)}~${hi.toFixed(2)}초 · ` + basics.map((m) => `${m.name.split(' ')[0]} ${m.hitT.toFixed(2)}`).join(' · '),
    )
  }

  /**
   * ══ 두 번째 질문: **잘 읽으면 손끝이 달라지는가** ═══════════════════
   *
   * 위까지가 "누른 것이 씹히지 않는가"였다면, 여기서부터는 *"잘 읽고
   * 누른 것이 **다르게 돌아오는가**"* 입니다. 컨트롤이 재미인 게임에서
   * 이건 장식이 아니라 **성적표**입니다 — 읽어 낸 한 대와 얻어걸린 한 대가
   * 똑같이 느껴지면, 읽을 이유가 손에 남지 않습니다.
   *
   * ── 무엇으로 재는가 ────────────────────────────────────────────
   * **화면이 실제로 멎은 시간**(`state().hitstop`)과 **흔들린 양**을 잽니다.
   * 상수를 읽어 비교하지 않습니다 — 상수는 맞는데 배선이 끊겨 있을 수
   * 있고, 이 저장소는 이미 그런 것에 여러 번 당했습니다.
   *
   * ⚠️ 기대값을 프로브에 **베껴 넣지 않았습니다.** 세 값이 얼마여야
   *    하는지는 검사하지 않고, **순서와 간격**만 봅니다. 순서는 실제로
   *    무너져 있었습니다 — 완벽 회피 뒤의 확정타가 평타와 **똑같은**
   *    정지 시간으로 왔습니다.
   */
  console.log('\n🥋 읽기의 등급 — 잘 읽으면 손끝이 달라지는가\n')

  const ladder = await page.evaluate(
    async ([states]) => {
      const G = window.__game
      const sleep = () => new Promise((r) => setTimeout(r, 4))
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t0 = now()
        const dl = Date.now() + 20000
        while (now() - t0 < sec && Date.now() < dl) await sleep()
      }

      G.reset()
      await wait(0.6)
      // 적이 돌지도 반격하지도 않게 세워 둡니다. 재려는 것은 **내 한 대**이지
      // 적의 대응이 아닙니다.
      G.freezeEnemies(true)

      const PX = 0
      const PZ = 0
      // 롱소드 1타 사거리(2.3m) 안쪽. 무기 상수를 베끼지 않으려고, 어떤
      // 무기든 닿는 아주 가까운 거리를 씁니다.
      const R = 1.5
      const SPOTS = [
        [PX, PZ + R],
        [PX, PZ - R],
        [PX + R, PZ],
        [PX - R, PZ],
      ]

      /**
       * 한 대를 때리고 **화면이 멎은 최대 시간**을 돌려줍니다.
       *
       * @param wantBehind 등 뒤에서 때릴 것인가. 자리는 게임의 판정
       *   (`nearestEnemy().playerBehind`)으로 고릅니다 — 각도를 프로브가
       *   다시 계산하면 게임과 어긋난 것을 못 잡습니다.
       * @param perfect 완벽 회피 직후 상태로 때릴 것인가.
       */
      const swing = async (wantBehind, perfect) => {
        G.clearEnemies()
        await wait(0.2)
        G.teleportPlayer(PX, PZ)
        await wait(0.2)
        const e = G.spawnEnemyKind('grunt', SPOTS[0][0], SPOTS[0][1])
        if (e == null || e < 0) return null
        await wait(0.2)

        let placed = false
        for (const [ex, ez] of SPOTS) {
          G.teleportEnemy(e, ex, ez)
          await wait(0.15)
          const n = G.state().nearestEnemy
          if (n && n.playerBehind === wantBehind) {
            placed = true
            break
          }
        }
        if (!placed) return null

        const n = G.state().nearestEnemy
        G.aimAtWorld(n.x, n.z)
        G.setStamina(100)
        // 플레이어가 적 쪽으로 도는 데 시간이 걸립니다. 덜 돈 채로 치면
        // 빗나가고, 빗나간 것을 "정지 0초"로 세면 게임이 억울해집니다.
        await wait(0.6)

        const before = G.state()
        if (before.player.state !== states.idle) return null
        if (perfect) G.grantPerfectDodge()

        G.press('Mouse0')
        G.release('Mouse0')

        let peakStop = 0
        let peakShake = 0
        let hpBefore = G.state().nearestEnemy?.hp ?? 0
        let hit = false
        const t0 = now()
        const dl = Date.now() + 20000
        while (Date.now() < dl && now() - t0 < 1.6) {
          const s = G.state()
          if (s.hitstop > peakStop) peakStop = s.hitstop
          if (s.trauma > peakShake) peakShake = s.trauma
          const hp = s.nearestEnemy?.hp
          if (hp != null && hp < hpBefore - 0.01) hit = true
          await sleep()
        }
        // 죽으면 처치 연출이 따로 화면을 멈춥니다 — 등급의 값이 아닙니다.
        const died = G.state().nearestEnemy == null
        return hit && !died ? { stop: peakStop, shake: peakShake } : null
      }

      /**
       * 한 등급을 **여러 번** 재고 **가운데 값**을 씁니다.
       *
       * ── 처음엔 가장 작은 값을 썼다가 틀렸습니다 ────────────────
       * 평타에는 기본 치명타 확률이 섞여 들어옵니다. 그래서 "운이 안
       * 따랐을 때의 순수한 평타"를 얻으려고 최소값을 썼는데, 나온 값이
       * **0.005초** 였습니다. 설계값은 0.055초입니다.
       *
       * 게임이 아니라 **자를 잘못 든 것**이었습니다. 화면 정지는 프레임
       * 하나가 지나면 그만큼 깎여 나갑니다(core/time.ts). 이 컨테이너는
       * GPU가 없어 한 프레임이 최대 0.05초까지 늘어나는데, 아주 가끔
       * 폴링이 그 프레임을 놓치면 이미 깎인 값 `0.055 − 0.05 = 0.005`
       * 을 집습니다. **최소값은 그 한 번의 실수를 정답으로 뽑습니다.**
       *
       * 가운데 값은 위쪽 오염(치명타)과 아래쪽 오염(놓친 프레임)을
       * **둘 다** 밀어냅니다. 대신 흩어진 정도를 같이 찍어서, 자가
       * 흔들리고 있으면 눈에 보이게 둡니다.
       */
      const mid = (xs) => {
        const s = [...xs].sort((a, b) => a - b)
        const h = s.length >> 1
        return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
      }
      const rung = async (wantBehind, perfect, tries) => {
        const got = []
        for (let i = 0; i < tries; i++) {
          const r = await swing(wantBehind, perfect)
          if (r) got.push(r)
        }
        if (got.length === 0) return null
        const stops = got.map((g) => g.stop)
        return {
          stop: mid(stops),
          lo: Math.min(...stops),
          hi: Math.max(...stops),
          shake: mid(got.map((g) => g.shake)),
          n: got.length,
        }
      }

      const flat = await rung(false, false, 7)
      const back = await rung(true, false, 5)
      const perf = await rung(false, true, 5)
      G.freezeEnemies(false)
      return { flat, back, perf }
    },
    [t.actorStates],
  )

  const rungs = [
    ['평타', ladder.flat],
    ['백어택', ladder.back],
    ['완벽 회피 뒤', ladder.perf],
  ]
  console.log('  [등급]          화면 정지(가운데값)   흩어짐        흔들림   표본')
  for (const [name, r] of rungs) {
    console.log(
      `    ${name.padEnd(14)} ${r ? `${r.stop.toFixed(3)}초` : '        못 잼'}` +
        `            ${r ? `${r.lo.toFixed(3)}~${r.hi.toFixed(3)}` : '     —'}` +
        `   ${r ? r.shake.toFixed(2) : '  —'}` +
        `     ${r ? `${r.n}회` : '—'}`,
    )
  }
  console.log('')

  const measured = rungs.filter(([, r]) => r)
  check(
    measured.length === rungs.length,
    '세 등급을 모두 실제로 때려서 쟀다 (못 잰 것을 조용히 건너뛰지 않게)',
    `${measured.length}/${rungs.length}`,
  )

  if (measured.length === rungs.length) {
    /**
     * 눈금은 **1프레임**입니다 — 60fps 기준 0.0167초.
     *
     * 이 숫자를 고른 이유는 게임 상수와 아무 상관이 없습니다. 화면이
     * 멎은 시간의 차이가 한 프레임보다 작으면 **화면에 한 장도 다르게
     * 나오지 않습니다.** 그러면 "다르게 만들었다"는 말이 거짓이 됩니다.
     * 게임 안의 값(feelStep)을 눈금으로 쓰면 자기가 자기를 재는 셈이라
     * 무조건 통과합니다 — 그런 검사는 아무것도 증명하지 않습니다.
     */
    const FRAME = 1 / 60
    for (let i = 1; i < rungs.length; i++) {
      const [lo, a] = rungs[i - 1]
      const [hi, b] = rungs[i]
      check(
        b.stop - a.stop >= FRAME,
        `${lo} → ${hi} 이 손끝으로 구분된다 (한 프레임 이상 더 멎는다)`,
        // 부호를 직접 붙이지 않습니다. 실패했을 때 `+-35ms` 라고 찍혀서
        // 뒤집힌 것인지 모자란 것인지 한눈에 안 보였습니다.
        `${(b.stop - a.stop) * 1000 >= 0 ? '+' : ''}${((b.stop - a.stop) * 1000).toFixed(0)}ms` +
          ` (한 프레임 = ${(FRAME * 1000).toFixed(0)}ms)`,
      )
      check(b.shake > a.shake, `${lo} → ${hi} 이 더 크게 흔들린다`, `${a.shake.toFixed(2)} → ${b.shake.toFixed(2)}`)
    }

    /**
     * ── 위로도 뚜껑이 필요합니다 ────────────────────────────────
     *
     * 실제로 이 뚜껑에 걸려서 설계를 되돌렸습니다. 처음엔 처형과 반격에도
     * 등급을 얹었는데, 처형은 전용 상수(0.16초)를 이미 받고 있어서 합이
     * 0.23초가 됐습니다. core/time.ts 가 스스로 적어 둔 권장 대역은
     * 0.05~0.14초입니다. **영수증이 게임을 멈추면 그건 보상이 아니라
     * 방해입니다.** 그래서 등급이 만드는 정지는 0.14초를 넘지 않습니다.
     */
    const CEIL = 0.14
    const top = rungs[rungs.length - 1]
    check(
      top[1].stop <= CEIL + 1e-6,
      `가장 높은 등급도 화면을 ${CEIL}초 넘게 멈추지 않는다 (time.ts 권장 대역)`,
      `${top[0]} ${top[1].stop.toFixed(3)}초`,
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
