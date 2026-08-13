/**
 * 조합 검증 — `npm run encounter`
 *
 * ── 왜 이 프로브가 필요한가 ──────────────────────────────────────
 * 자동 플레이로 위험을 재보니 **동시 교전이 평균 1.22마리**였습니다.
 * 이 존은 사실상 연속된 1:1이었습니다. 그런데 적의 어그로 범위는 55m —
 * 다 깨어나 있어야 하는데 앞뒤가 안 맞았습니다.
 *
 * 둘 다 사실이었습니다. 55m면 존의 거의 모든 적이 동시에 깨어나
 * 저마다 다른 거리·속도로 걸어오므로 **한 줄로 늘어서 도착합니다.**
 * 조합이 아니라 줄서기입니다.
 *
 * ── 그래서 여기서 재는 것 ────────────────────────────────────────
 *   1) 방 단위 어그로가 실제로 좁혀졌는가 — 멀리 있는 적이 안 깨어나는가
 *   2) 무리 앞에 서면 **둘 이상이 함께** 깨어나는가
 *   3) 무리를 깨워도 **옆 무리는 자는가** (한 줄로 밀려오지 않는가)
 *
 * ⚠️ 좌표를 손으로 적지 않습니다. 레벨 JSON에서 무리를 찾아냅니다.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5202
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))
const level = JSON.parse(readFileSync(path.join(ROOT, 'src', 'levels', 'broken-gate.json'), 'utf8'))

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const FOE_KINDS = new Set(['grunt', 'binder', 'dragger', 'charger'])

/**
 * 레벨 데이터에서 **무리**를 찾아냅니다 — 서로 `link` m 안에 있는 적들의 덩어리.
 * 좌표를 프로브에 베껴 적으면 배치를 바꿀 때마다 검증이 거짓이 됩니다.
 */
function findGroups(link = 7) {
  const foes = level.entities.filter((e) => FOE_KINDS.has(e.kind))
  const seen = new Set()
  const groups = []
  for (let i = 0; i < foes.length; i++) {
    if (seen.has(i)) continue
    const stack = [i]
    const group = []
    seen.add(i)
    while (stack.length) {
      const k = stack.pop()
      group.push(foes[k])
      for (let j = 0; j < foes.length; j++) {
        if (seen.has(j)) continue
        if (Math.hypot(foes[j].x - foes[k].x, foes[j].z - foes[k].z) <= link) {
          seen.add(j)
          stack.push(j)
        }
      }
    }
    const cx = group.reduce((a, e) => a + e.x, 0) / group.length
    const cz = group.reduce((a, e) => a + e.z, 0) / group.length
    groups.push({ size: group.length, x: cx, z: cz, kinds: group.map((e) => e.kind) })
  }
  return groups.sort((a, b) => b.size - a.size)
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
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  await page.evaluate(() => window.__game.resetProgress())
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
    }
  })

  console.log('\n👥 조합 검증\n')

  const groups = findGroups()
  const multi = groups.filter((g) => g.size >= 2)
  console.log(
    `  [배치] 무리 ${groups.length}개 · 둘 이상 ${multi.length}개 — ` +
      multi.map((g) => `${g.size}(${g.kinds.join('+')})`).join(' · ') +
      '\n',
  )
  check(multi.length >= 4, '둘 이상으로 묶인 무리가 충분히 있다', `${multi.length}개`)

  // ---- 1. 방 단위 어그로 ----
  //
  // 시작 지점에 가만히 서 있으면, 존 전체가 깨어나면 안 됩니다.
  const atSpawn = await page.evaluate(async () => {
    const G = window.__game
    await window.__t.runFor(2)
    return { awake: G.threats(200).filter((t) => t.aggro).length, total: G.state().enemiesLeft }
  })
  check(
    atSpawn.awake === 0,
    '시작 지점에 서 있으면 아무도 안 깨어난다 (존 전체가 한 줄로 오지 않게)',
    `깨어난 적 ${atSpawn.awake} / 전체 ${atSpawn.total}`,
  )

  // ---- 2. 무리 앞에 서면 둘 이상이 함께 깨어난다 ----
  const woken = []
  for (const g of multi) {
    const r = await page.evaluate(
      async ([x, z]) => {
        const G = window.__game
        G.resetProgress?.()
        G.teleportPlayer(x, z)
        await window.__t.runFor(1.2)
        // 무리 반경 10m 안에서 깨어난 수 — 옆 무리를 세지 않도록 좁게 봅니다.
        return G.threats(10).filter((t) => t.aggro).length
      },
      [g.x, g.z],
    )
    woken.push(r)
  }
  const groupsThatWake = woken.filter((n) => n >= 2).length
  check(
    groupsThatWake >= multi.length - 1,
    '무리 앞에 서면 둘 이상이 함께 깨어난다',
    `${groupsThatWake}/${multi.length}개 무리 · 깨어난 수 [${woken.join(', ')}]`,
  )

  // ---- 3. 옆 무리는 자고 있다 ----
  //
  // 이게 방 단위 어그로의 존재 이유입니다. 하나를 건드렸을 때 존 전체가
  // 밀려오면, 조합을 아무리 설계해도 결국 줄서기로 돌아갑니다.
  /**
   * ⚠️ **반드시 먼저 초기화합니다.**
   *
   * 원래는 바로 순간이동만 했습니다. 그런데 적의 어그로는 한 번 붙으면
   * **스스로 풀리지 않습니다**(enemyAI.ts — 깨우는 줄은 있어도 재우는 줄은
   * 플레이어 사망·보스 귀환뿐). 바로 위 2번 검사가 무리를 하나씩 돌면서
   * 깨워 놓았으므로, 여기서 세는 "존 전체 깨어난 수"에는 **직전 검사가
   * 남긴 것**이 섞입니다.
   *
   * 그래서 이 검사는 배치가 아니라 **앞 검사의 길이**에 반응했습니다.
   * 무리를 6개에서 7개로 늘렸더니 5마리→7마리가 되어, 배치는 멀쩡한데
   * 실패가 떴습니다. 재려던 것(한 무리를 깨우면 옆이 자는가)과 재고 있던
   * 것(지금까지 깨운 것이 몇인가)이 달랐습니다.
   */
  const spill = await page.evaluate(
    async ([x, z]) => {
      const G = window.__game
      G.resetProgress?.()
      await new Promise((r) => setTimeout(r, 300))
      await window.__t.runFor(0.5)
      G.teleportPlayer(x, z)
      await window.__t.runFor(1.5)
      const near = G.threats(12).filter((t) => t.aggro).length
      const all = G.threats(300).filter((t) => t.aggro).length
      return { near, all }
    },
    [multi[0].x, multi[0].z],
  )
  check(
    spill.all - spill.near <= 2,
    '한 무리를 깨워도 존 전체가 따라오지 않는다',
    `가까이 ${spill.near}마리 · 존 전체 깨어남 ${spill.all}마리`,
  )

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
