/**
 * 보스 페이스 실험대 — `npm run pace`
 *
 * ── 왜 벤치로는 안 되는가 ───────────────────────────────────────
 * 설계 문서는 *"마지막 구간이 가장 길어야 한다"* 고 적어 두었는데 벤치는
 * 계속 반대로 나옵니다. 그래서 구간 배분을 화력에서 거꾸로 풀어 고쳤다가
 * **되돌렸습니다** — 근거로 쓴 화력의 폭이 너무 넓었기 때문입니다.
 *
 * 같은 코드로 5판 벤치를 두 번 돌린 결과가 이렇습니다:
 *
 *     ① 1단계 13.1초 (12.7~13.9) · 화력 11.8 (11.2~12.2)
 *     ② 1단계 19.9초 (7.0~28.6)  · 화력  7.8 (5.4~22.1)
 *
 * ①의 좁음은 **우연이었습니다.** 자동 플레이의 보스전에는 존을 걸어온
 * 상태가 통째로 섞입니다 — 성수병을 몇 개 썼는지, 무기를 강화했는지,
 * 스킬이 얼마나 차 있는지, 오다가 죽었는지. 그 위에서 구간 시간을 재는 것은
 * **소음에 자를 대는 것**입니다.
 *
 * ── 그래서 여기서 하는 것 ───────────────────────────────────────
 * 존을 걸어오지 않습니다. 보스 앞으로 **순간이동**하고, 시작 상태를
 * 못 박고(체력·스태미나·무기 강화·불티), **똑같은 정책**으로 싸웁니다.
 * 판마다 다른 것은 보스의 패턴 선택뿐입니다.
 *
 * 그러면 두 가지 중 하나가 나옵니다. 둘 다 알아야 할 답입니다:
 *   · 범위가 좁아진다 → 벤치의 폭은 **여정** 때문이었습니다. 이 수치로
 *     구간 배분을 풀 수 있습니다.
 *   · 여전히 넓다     → 폭의 원인이 보스 자신(패턴 선택)입니다. 그러면
 *     배분을 아무리 맞춰도 판마다 다르게 느껴집니다 — 고칠 곳이 배분이
 *     아니라 **패턴 가중치**라는 뜻입니다.
 *
 * ⚠️ 봇처럼 잘 싸우는 것이 목적이 아닙니다. **같은 방식으로** 싸우는 것이
 *    목적입니다. 정책이 단순할수록 재려는 것(구간 길이)이 또렷해집니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5211
const RUNS = Math.max(2, Math.min(9, Number(process.argv[2]) || 5))
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const span = (xs) => {
  const a = [...xs].sort((x, y) => x - y)
  return `${a[0].toFixed(1)}~${a[a.length - 1].toFixed(1)}`
}
const fmt = (xs) => `${med(xs).toFixed(1)} (${span(xs)})`

const server = await createServer({ root: ROOT, server: { port: PORT }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: execPath,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log(`\n🥁 보스 페이스 실험대 — ${RUNS}판, 같은 시작 · 같은 정책\n`)

  const runs = []
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`  ${i + 1}/${RUNS}판… `)
    const r = await page.evaluate(async () => {
      const G = window.__game
      const sleep = () => new Promise((r) => setTimeout(r, 8))
      const now = () => G.state().simElapsed
      const wait = async (sec) => {
        const t0 = now()
        const dl = Date.now() + 30000
        while (now() - t0 < sec && Date.now() < dl) await sleep()
      }
      const tap = (c) => {
        G.press(c)
        G.release(c)
      }

      G.resetProgress()
      await new Promise((r) => setTimeout(r, 400))
      await wait(0.5)

      /**
       * **시작 상태를 못 박습니다.** 벤치에서 폭을 만들던 것들입니다 —
       * 무기 강화 단계와 지갑이 판마다 달랐습니다. 강화 0단계로 고정하면
       * "화력이 오르는 것"이 장비 때문인지 전투 중 자원(집중·처형) 때문인지
       * 갈립니다.
       */
      G.setWeaponLevel(0, 0)
      G.setEmbers(0)

      const be0 = G.bossEncounter()
      if (!be0) return null
      const bi = G.enemyInfo(be0.entity)
      if (!bi) return null
      // 보스 코앞이 아니라 **조우가 걸릴 만큼만** 다가갑니다.
      G.teleportPlayer(bi.x - 6, bi.z)
      await wait(0.5)

      const phaseTime = [0, 0, 0]
      const phaseDmg = [0, 0, 0]
      let lastHp = -1
      let lastSample = now()
      const t0 = now()
      let killed = false
      let slot = 0
      let wasWinding = false
      const dl = Date.now() + 150000

      /**
       * 판당 상한 90초. 처음엔 180초로 뒀다가 **전체가 시간 제한에 걸려**
       * 결과를 하나도 못 봤습니다(5판 × 180초 > 900초). 실험대는 벤치와
       * 달리 여러 판을 빨리 돌려 폭을 보는 것이 목적이므로, 한 판이 길면
       * 목적 자체가 무너집니다. 90초를 넘기면 그 판은 "시간초과"로 남기고
       * 넘어갑니다 — 안 끝나는 것도 정보입니다.
       */
      while (now() - t0 < 90 && Date.now() < dl) {
        const be = G.bossEncounter()
        if (!be || be.hp <= 0) {
          killed = true
          break
        }
        const info = G.enemyInfo(be.entity)
        const p = G.state().player
        if (!info) break

        const dt = Math.max(0, now() - lastSample)
        lastSample = now()
        const ph = Math.min(2, be.phase)
        // 조우 중일 때만 셉니다(귀환·연출 제외).
        if (be.encounter > 0 && be.encounter < 3) {
          phaseTime[ph] += dt
          if (lastHp >= 0 && lastHp > be.hp) phaseDmg[ph] += lastHp - be.hp
        }
        lastHp = be.hp

        /**
         * ── 정책: 언제나 같은 순서 ────────────────────────────────
         * 1) 예고가 뜨면 구른다 (색을 안 가립니다 — 가리기 시작하면
         *    "봇이 얼마나 똑똑한가"가 결과에 섞입니다)
         * 2) 아니면 스킬을 슬롯 순서대로 돌린다
         * 3) 아니면 기본 공격
         * 붙는 것은 순간이동으로 유지합니다 — 이동 실력이 섞이지 않게.
         */
        const dist = Math.hypot(info.x - p.x, info.z - p.z)
        if (dist > 3.2) G.teleportPlayer(info.x - 2.6, info.z)
        G.aimAtWorld(info.x, info.z)

        /**
         * ⚠️ 처음엔 `예고 중이면 구른다`로 두었다가 결과가 뒤집혔습니다:
         *
         *     1단계 화력 34.1/초 → 3단계 **2.9/초** · 처치 0/3판
         *
         * 벤치는 화력이 **오른다**고 하는데 실험대는 12배 떨어진다고 했습니다.
         * 원인은 보스가 아니라 정책이었습니다. 3단계는 쿨다운이 0.55배라
         * 예고가 거의 끊이지 않는데, `예고 중이면 구른다`는 매 프레임 구르기만
         * 시도합니다. 스태미나가 마르면 **아무것도 안 하고 서 있습니다** —
         * 공격은 `else` 가지에 있으니 영영 안 옵니다.
         *
         * 그래서 예고 **한 번에 한 번만** 구르고, 스태미나가 모자라면
         * 그냥 때립니다. 사람이 하는 것도 그것입니다 — 못 구르면 맞더라도
         * 넣습니다. 여전히 결정적이고(같은 규칙), 굶지 않습니다.
         */
        const stam = G.state().player.stamina
        const newTelegraph = info.winding && !wasWinding
        wasWinding = info.winding
        if (newTelegraph && stam >= 25) {
          tap('Space')
        } else if (info.winding && stam < 25) {
          tap('Mouse0')
        } else if (info.winding) {
          // 이미 이 예고에 대응했습니다 — 겹쳐 구르지 않습니다.
        } else {
          const ready = G.slotCooldowns().filter((s) => !s.empty && s.cd <= 0)
          if (ready.length > 0) {
            tap(ready[slot % ready.length].key)
            slot++
          } else {
            tap('Mouse0')
          }
        }
        await sleep()
      }

      return {
        killed,
        total: Number((phaseTime[0] + phaseTime[1] + phaseTime[2]).toFixed(1)),
        phaseTime: phaseTime.map((v) => Number(v.toFixed(1))),
        phaseDmg: phaseDmg.map((v) => Math.round(v)),
      }
    })
    if (!r) {
      console.log('보스를 못 찾음')
      continue
    }
    console.log(`${r.killed ? '처치' : '시간초과'} ${r.total}초 · ${r.phaseTime.join(' / ')}`)
    runs.push(r)
  }

  if (runs.length < 2) {
    check(false, '실험대가 보스전을 재현했다', `${runs.length}판만 성공`)
  } else {
    console.log('')
    const dps = (i) => runs.map((r) => r.phaseDmg[i] / Math.max(0.1, r.phaseTime[i]))
    for (let i = 0; i < 3; i++) {
      console.log(
        `  ${i + 1}단계         ${fmt(runs.map((r) => r.phaseTime[i]))}초 · ` +
          `화력 ${fmt(dps(i))}/초`,
      )
    }
    console.log(`  전체           ${fmt(runs.map((r) => r.total))}초\n`)

    /**
     * **이 실험대의 존재 이유가 이 검사입니다.**
     *
     * 여정을 걷어냈는데도 폭이 2배를 넘으면, 폭의 원인은 여정이 아니라
     * **보스 자신**입니다(패턴 선택). 그러면 구간 배분을 아무리 정교하게
     * 맞춰도 판마다 다르게 느껴지므로, 고칠 곳은 배분이 아니라 가중치입니다.
     * 그 판단을 사람이 눈대중으로 하지 않도록 여기서 못 박습니다.
     */
    const spread = (i) => {
      const a = [...runs.map((r) => r.phaseTime[i])].sort((x, y) => x - y)
      return a[a.length - 1] / Math.max(0.1, a[0])
    }
    const worst = Math.max(spread(0), spread(1), spread(2))
    check(
      worst <= 2,
      '구간 시간이 판마다 2배 넘게 흔들리지 않는다 (이 수치로 배분을 풀 수 있다)',
      `가장 넓은 구간이 ${worst.toFixed(1)}배` +
        (worst > 2 ? ' — 폭의 원인이 여정이 아니라 보스입니다(패턴 선택)' : ''),
    )
    check(
      runs.filter((r) => r.killed).length === runs.length,
      '모든 판에서 보스를 처치했다 (정책이 성립한다)',
      `${runs.filter((r) => r.killed).length}/${runs.length}판`,
    )
    /** 설계가 적어 둔 약속 — 마지막 구간이 가장 길어야 합니다. */
    const t3 = med(runs.map((r) => r.phaseTime[2]))
    const t1 = med(runs.map((r) => r.phaseTime[0]))
    check(
      t3 >= t1,
      '3단계가 1단계보다 짧지 않다 (bossPhases.ts "마지막 구간이 가장 길어야")',
      `1단계 ${t1.toFixed(1)}초 · 3단계 ${t3.toFixed(1)}초`,
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
