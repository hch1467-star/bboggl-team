/**
 * 🔁 갚을 수 있는가 — `npm run punish`
 *
 * ── 이 프로브가 묻는 것 ───────────────────────────────────────────
 * 기둥 2는 *"색마다 다른 정답이 있고, 그 정답이 통한다"* 까지만 약속합니다.
 * **통한다 = 안 맞는다** 입니다. 그런데 안 맞기만 해서는 전투가 앞으로
 * 안 갑니다. 잘 읽은 사람은 **한 대 갚을 수 있어야** 합니다. 아니면 색을
 * 읽는 값이 0이고, 플레이어는 읽기를 그만둡니다.
 *
 * 이 세션에서 색맹 봇과 색 읽는 봇의 승부가 안 났을 때 이렇게 적었습니다:
 *
 *   > *"그렇다면 고칠 곳은 색이 아니라 **돌아오는 길**입니다."*
 *
 * 그 돌아오는 길을 잽니다.
 *
 * ── 두 절로 나눈 이유 ─────────────────────────────────────────────
 * ① **규칙** — 게임의 `punishTable()` 을 읽습니다. 판단은 게임이 합니다.
 * ② **실측** — 그 계산이 실제 게임과 맞는지 확인합니다.
 *
 * ②가 없으면 ①은 **자기 자신을 기준으로 삼는 검사**입니다. 상수로 만든
 * 표를 상수로 검사하면 언제나 초록입니다. 그래서 실제로 보스가 갈고리를
 * 헛치게 만들어 놓고, **후딜이 실제로 몇 초인지** 시뮬레이션 시간으로 잽니다.
 * 이 저장소가 이번 세션에 열 번 밟은 함정이 정확히 이것입니다 —
 * 계측기가 자기가 만든 답을 재고 있는 것.
 *
 * 실행: npm run punish
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 4213

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

const INTENT_MARK = ['🔴', '🟡', '🔵', '🟣', '🟢']

const server = await createServer({
  root: ROOT,
  server: { port: PORT, strictPort: true, host: '127.0.0.1' },
  logLevel: 'error',
})
await server.listen()
const browser = await chromium.launch({
  executablePath: ['/opt/pw-browsers/chromium'].find((p) => existsSync(p)),
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
})

try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 620 },
    deviceScaleFactor: 1,
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })
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
    }
  })

  // ---------------------------------------------------------------------
  console.log('\n🔁 갚을 수 있는가 — 정답대로 답한 사람의 돌아오는 길\n')

  const table = await page.evaluate(() => window.__game.punishTable())
  const sidestep = await page.evaluate(() => window.__game.sidestepTable())

  /**
   * 거리로 푸는 색만 봅니다. 무적 프레임·반격은 자리를 안 뜨므로
   * 되돌아올 길이 없습니다 — 판단은 게임의 `answer` 가 합니다.
   * (여기서 색 번호를 베껴 오면, 색을 하나 더 넣는 날 이 프로브가 조용히 틀립니다.)
   */
  const distanceRows = table.filter((r) => r.answer === 'distance')
  const byAttack = new Map()
  for (const r of distanceRows) {
    if (!byAttack.has(r.attackId)) byAttack.set(r.attackId, [])
    byAttack.get(r.attackId).push(r)
  }

  console.log('  [거리로 푸는 색 — 나갔다가 돌아와서 한 대]')
  for (const [id, rows] of byAttack) {
    const worst = rows.reduce((a, b) => (a.slack <= b.slack ? a : b))
    const mark = INTENT_MARK[worst.intent] ?? '·'
    const per = rows
      .map((r) => `${r.weapon} ${r.slack >= 0 ? '+' : ''}${r.slack.toFixed(2)}`)
      .join(' · ')
    console.log(
      `    ${mark} ${worst.enemy}/${id} — 나가 ${worst.safeDist}m · 창 ${worst.openingT}초 · ${per}`,
    )
  }

  check(
    distanceRows.length > 0,
    '거리로 푸는 색이 실제로 있다 (표가 비면 아래 검사가 공짜로 초록이 됩니다)',
    `${byAttack.size}개 공격 × ${distanceRows.length / Math.max(1, byAttack.size)}무기`,
  )

  const broken = distanceRows.filter((r) => !r.ok)
  check(
    broken.length === 0,
    '거리로 답하면 세 무기 모두 한 대 갚을 수 있다',
    broken.length === 0
      ? `가장 빠듯 ${Math.min(...distanceRows.map((r) => r.slack)).toFixed(2)}초`
      : broken.map((r) => `${r.attackId}/${r.weapon} ${r.slack.toFixed(2)}초`).join(' · '),
  )

  console.log('\n  [옆으로 비키기 — 예고 동안 부채꼴을 벗어날 수 있나]')
  for (const s of sidestep) {
    const need = Number.isFinite(s.needSec) ? `${s.needSec}초` : '영영 못 벗어남'
    console.log(
      `    ${s.ok ? '○' : '✗'} ${s.enemy}/${s.attackId} — ${s.atDist}m 에서 ${need} (예고 ${s.haveSec}초)`,
    )
  }
  /**
   * ⚠️ **처음에 세운 검사를 바꿨습니다.** 원래는 *"옆으로 못 비키는 공격은
   *    거리가 유일한 답이니 그 답이 갚아 줘야 한다"* 였습니다. 재 보니
   *    **11개 공격 전부** 옆으로 못 비켰습니다. 그러면 그 검사는 위의
   *    검사와 **같은 집합**을 보게 되어, 혼자서는 절대 빨개지지 않는
   *    장식이 됩니다. (이 저장소의 규칙: *혼자 초록인 검사는 대개 아무것도
   *    안 재고 있습니다.*)
   *
   *    그리고 이건 제가 틀렸던 자리이기도 합니다 — 재기 전에 저는
   *    *"🟣 만 멀어서 옆으로 못 비킨다"* 고 적었습니다. 실제로는 색과
   *    무관하게 전부 못 비킵니다. 🟣 를 특별하게 만드는 것은 옆이 아니라
   *    **돌아오는 거리** 하나뿐이었습니다.
   *
   * 그래서 **모델의 전제**를 지키는 검사로 바꿉니다. 위 표는 *"거리로 푸는
   * 색은 플레이어가 사거리 밖까지 나간다"* 를 전제로 계산합니다. 만약 어떤
   * 🟡/🟣 를 옆으로 비켜서 풀 수 있게 되면(부채꼴을 좁히는 날), 플레이어는
   * 사거리 밖까지 안 나가므로 위 계산이 **엉뚱한 거리를 재게** 됩니다.
   * 이 검사는 그날 빨개집니다.
   */
  const sidesteppable = sidestep.filter((s) => s.ok).map((s) => s.attackId)
  const modelBroken = distanceRows.filter((r) => sidesteppable.includes(r.attackId))
  check(
    modelBroken.length === 0,
    '거리로 푸는 색은 옆으로 비켜서 대신 풀 수 없다 (위 계산의 전제)',
    modelBroken.length === 0
      ? `옆으로 비킬 수 있는 공격: ${sidesteppable.join(', ') || '없음'}`
      : `${[...new Set(modelBroken.map((r) => r.attackId))].join(', ')} — 이제 옆이 답이면 위 표는 엉뚱한 거리를 잽니다`,
  )

  // ---------------------------------------------------------------------
  /**
   * ② 실측 — 위 표가 **실제 게임과 맞는지**.
   *
   * 보스에게 갈고리를 시키고, 플레이어를 사거리 밖에 세워 **헛치게** 만든 뒤
   * 후딜이 실제로 몇 초인지 잽니다. 그리고 같은 공격을 **맞혀서** 후딜이
   * 짧아지는지 봅니다. 둘이 같으면 "빗나갔을 때만 길다"가 거짓입니다.
   */
  console.log('\n  [실측 — 헛친 갈고리의 후딜을 시뮬레이션 시간으로]')

  const hook = table.find((r) => r.attackId === 'boss_hook')
  const measure = async (standDist) =>
    page.evaluate(
      async ({ idx, standDist }) => {
        const G = window.__game
        G.reset()
        await window.__t.runFor(0.4)
        G.clearEnemies()
        await window.__t.runFor(0.2)
        const p = G.state().player
        const b = G.spawnEnemyKind('boss', p.x, p.z + 6)
        await window.__t.runFor(0.3)
        G.wakeEnemy(b)
        const bs = G.enemyInfo(b)
        // 보스가 바라보는 정면에 세웁니다 — 부채꼴 안이어야 "맞았다/빗나갔다"가 거리로만 갈립니다.
        const rot = bs.rotY
        G.teleportPlayer(bs.x + Math.sin(rot) * standDist, bs.z + Math.cos(rot) * standDist)
        await window.__t.runFor(0.15)
        /**
         * ⚠️ 체력은 **공격을 시키기 전에** 찍습니다. 처음엔 후딜이 시작된
         *    뒤에 찍었는데, 그때는 이미 판정이 끝난 뒤라 맞았어도 피해가
         *    0으로 보였습니다 — "한 번은 맞았다"가 영영 거짓이 됩니다.
         */
        const hpBefore = G.state().player.hp
        const forcedId = G.forceAttack(b, idx)
        // 후딜이 시작될 때까지.
        const reached = await window.__t.until(() => G.enemyInfo(b)?.recovering === true, 6)
        const t0 = G.state().elapsed
        // 후딜이 끝날 때까지.
        await window.__t.until(() => G.enemyInfo(b)?.recovering !== true, 6)
        return {
          forcedId,
          reached,
          opening: Number((G.state().elapsed - t0).toFixed(2)),
          hurt: hpBefore - G.state().player.hp,
        }
      },
      { idx: hook.index, standDist },
    )

  // 사거리 밖 — 헛칩니다.
  const whiffed = await measure(hook.safeDist + 1.2)
  // 코앞 — 맞습니다.
  const landed = await measure(2.2)

  check(
    whiffed.forcedId === 'boss_hook' && landed.forcedId === 'boss_hook',
    '실측이 정말 🟣 갈고리를 쟀다',
    `${whiffed.forcedId} / ${landed.forcedId}`,
  )
  check(
    whiffed.hurt === 0 && landed.hurt > 0,
    '한 번은 빗나가고 한 번은 맞았다 (안 그러면 아래 비교가 무의미)',
    `헛침 피해 ${whiffed.hurt} · 맞음 피해 ${landed.hurt}`,
  )
  check(
    Math.abs(whiffed.opening - hook.openingT) <= 0.25,
    '헛쳤을 때의 후딜이 표와 맞는다',
    `실측 ${whiffed.opening}초 · 표 ${hook.openingT}초`,
  )
  check(
    whiffed.opening > landed.opening + 0.2,
    '빗나갔을 때만 빈틈이 커진다 (맞혔으면 이미 벌을 줬으므로)',
    `헛침 ${whiffed.opening}초 · 맞음 ${landed.opening}초`,
  )

  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} catch (e) {
  fail++
  console.error('\n💥', e)
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
