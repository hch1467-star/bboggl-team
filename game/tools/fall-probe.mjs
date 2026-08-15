/**
 * 낙하 검증 — `npm run fall`
 *
 * ── 무엇을 재는가 ────────────────────────────────────────────────
 * 낙하 피해는 **잘못 만들면 즉시 짜증이 되는** 종류의 기능입니다. 조사에서
 * NRFTW 플레이어들이 실제로 불평하는 항목이기도 했습니다. 그래서 "작동한다"가
 * 아니라 **"설계한 곳에서만 아프다"** 를 재야 합니다.
 *
 *   1) 주 동선이 강제하는 낙하(중앙 폐허 → 남쪽 함몰지, 2단)는 **공짜**인가
 *   2) 선택으로 뛰어내리는 낙하(성벽마루 → 폐허, 3단)는 계산대로 아픈가
 *   3) 밀어 떨어뜨린 적이 **무방비로 착지**하는가 — 이게 이 시스템의 보상입니다
 *   4) 봇이 사다리를 못 찾는다고 해서 길이 막히지는 않는가
 *
 * ⚠️ 수치를 여기 베껴 적지 않습니다. FALL 설정을 게임에서 읽어 **계산해서**
 *    비교합니다. 값을 바꾸면 검증이 따라와야 합니다.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5195
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))
const level = JSON.parse(readFileSync(path.join(ROOT, 'src', 'levels', 'broken-gate.json'), 'utf8'))
const VOID = -1

let pass = 0
let fail = 0
function check(ok, label, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const at = (cx, cz) =>
  cx < 0 || cz < 0 || cx >= level.w || cz >= level.h ? VOID : level.heights[cz * level.w + cx]
const world = (cx, cz) => ({ x: (cx - level.w / 2 + 0.5) * 2, z: (cz - level.h / 2 + 0.5) * 2 })

/**
 * **걸어서 닿을 수 있는 칸**의 집합.
 *
 * 이게 없으면 프로브가 성벽 꼭대기를 낙하 지점으로 골라 버립니다 —
 * 실제로 처음에 "이웃이 1단 아래면 닿는 곳"이라는 어림짐작으로 짰다가
 * 높이 8짜리 성벽 위에서 떨어뜨리고 있었습니다. 성벽은 주변보다 3단 높게
 * 자동 생성되는 덩어리라 서로 이웃이 같은 높이입니다 — 어림짐작이 통과합니다.
 * 짐작하지 말고 **시작 지점에서 실제로 퍼뜨려** 봐야 합니다.
 */
function walkableFromSpawn(maxClimb) {
  const spawn = level.entities.find((e) => e.kind === 'spawn')
  const start = {
    cx: Math.floor(spawn.x / 2 + level.w / 2),
    cz: Math.floor(spawn.z / 2 + level.h / 2),
  }
  const seen = new Set([start.cz * level.w + start.cx])
  let frontier = [start]
  while (frontier.length) {
    const next = []
    for (const c of frontier) {
      const h = at(c.cx, c.cz)
      for (const [nx, nz] of [
        [c.cx - 1, c.cz],
        [c.cx + 1, c.cz],
        [c.cx, c.cz - 1],
        [c.cx, c.cz + 1],
      ]) {
        const n = at(nx, nz)
        if (n === VOID || n - h > maxClimb) continue
        const k = nz * level.w + nx
        if (seen.has(k)) continue
        seen.add(k)
        next.push({ cx: nx, cz: nz })
      }
    }
    frontier = next
  }
  return seen
}

let reachable = null

/** 낙차가 정확히 `steps` 인 칸 쌍을 찾습니다 — 좌표를 손으로 적지 않기 위해. */
function findDrop(steps, maxClimb) {
  if (!reachable) reachable = walkableFromSpawn(maxClimb)
  for (let cz = 0; cz < level.h; cz++) {
    for (let cx = 0; cx < level.w; cx++) {
      const h = at(cx, cz)
      if (h === VOID) continue
      if (!reachable.has(cz * level.w + cx)) continue
      for (const [nx, nz] of [
        [cx - 1, cz],
        [cx + 1, cz],
        [cx, cz - 1],
        [cx, cz + 1],
      ]) {
        const n = at(nx, nz)
        if (n === VOID || h - n !== steps) continue
        return { top: { cx, cz, h }, bottom: { cx: nx, cz: nz, h: n } }
      }
    }
  }
  return null
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

  console.log('\n🪂 낙하 검증\n')

  const cfg = await page.evaluate(() => window.__game.terrainInfo())
  console.log(
    `  [설정] 공짜 ${cfg.fallFreeSteps}단까지 · 그 위 한 단마다 최대 체력의 ${Math.round(cfg.fallDamagePerStep * 100)}%\n`,
  )

  /**
   * 플레이어를 위 칸에 세우고 **밀어서** 떨어뜨립니다.
   * 순간이동으로 옮기면 물리를 거치지 않아 낙하로 잡히지 않습니다 —
   * 실제로 그렇게 짜서 한 번 헛돌았습니다.
   */
  const fallPlayer = async (steps) => {
    const drop = findDrop(steps, cfg.maxClimb)
    if (!drop) return null
    const top = world(drop.top.cx, drop.top.cz)
    const bottom = world(drop.bottom.cx, drop.bottom.cz)
    return await page.evaluate(
      async ([top, bottom, steps]) => {
        const G = window.__game
        G.setHp(G.playerEntity(), 100)
        G.teleportPlayer(top.x, top.z)
        await window.__t.runFor(0.2)
        const before = G.entityState(G.playerEntity())
        // 낭떠러지 쪽으로 강하게 밀어 넘깁니다.
        const dx = bottom.x - top.x
        const dz = bottom.z - top.z
        const len = Math.hypot(dx, dz) || 1
        G.pushEntity(G.playerEntity(), (dx / len) * 26, (dz / len) * 26)
        await window.__t.runFor(0.9)
        const after = G.entityState(G.playerEntity())
        return { before, after, steps }
      },
      [top, bottom, steps],
    )
  }

  // ---- 1. 주 동선이 강제하는 2단 낙하는 공짜여야 합니다 ----
  const free = await fallPlayer(cfg.fallFreeSteps)
  check(free !== null, `${cfg.fallFreeSteps}단 낙하 지점이 지도에 있다`)
  if (free) {
    check(
      free.before.level - free.after.level === cfg.fallFreeSteps,
      `${cfg.fallFreeSteps}단을 실제로 떨어졌다`,
      `높이 ${free.before.level} → ${free.after.level}`,
    )
    check(
      free.after.hp === free.before.hp,
      '주 동선이 강제하는 낙하는 공짜다 (설계된 길이 벌이 되지 않게)',
      `체력 ${free.before.hp} → ${free.after.hp}`,
    )
  }

  // ---- 2. 선택으로 뛰어내리는 낙하는 계산대로 아파야 합니다 ----
  const hurt = await fallPlayer(cfg.fallFreeSteps + 1)
  check(hurt !== null, `${cfg.fallFreeSteps + 1}단 낙하 지점이 지도에 있다`)
  if (hurt) {
    const expected = hurt.before.maxHp * (hurt.steps - cfg.fallFreeSteps) * cfg.fallDamagePerStep
    const actual = hurt.before.hp - hurt.after.hp
    check(
      Math.abs(actual - expected) < 0.5,
      '낙하 피해가 설정대로 들어간다',
      `${hurt.steps}단 → ${actual.toFixed(1)} 피해 (계산값 ${expected.toFixed(1)})`,
    )
    check(actual > 0 && actual < hurt.before.maxHp, '한 번의 낙하로 죽지는 않는다', `${actual.toFixed(1)} / ${hurt.before.maxHp}`)
  }

  /**
   * ---- 2.5 🪂 **떨어진 값을 무기로 바꿀 수 있는가** ----------------
   *
   * 여기까지는 낙하가 **벌**이기만 했습니다. 소울류·세키로·오공에서
   * 낙하 공격이 사랑받는 이유는 정반대입니다 — *"먼저 값을 치르고
   * 높이를 위력으로 바꾼다"*. 우리는 체공 상태가 없지만(physics.ts 의
   * 설계 노트: 쿼터뷰에서 체공은 조작감만 해칩니다) **값은 이미 치렀고**
   * (바로 위 검사가 그 피해를 확인했습니다), 그 직후 짧은 창을 엽니다.
   *
   * ⚠️ **한 번의 evaluate 안에서 열림과 닫힘을 둘 다 잽니다.** 창은
   *    0.28초이고, 브라우저 왕복은 그보다 길 수 있습니다. 구르기 창을
   *    잴 때 정확히 이걸로 한 번 속았습니다 — 게임은 멀쩡한데 계측기가
   *    창보다 느려서 빨개졌습니다. **재는 쪽이 창 안에 있어야 합니다.**
   */
  const drop25 = findDrop(cfg.fallFreeSteps + 1, cfg.maxClimb)
  const plunge = drop25
    ? await page.evaluate(
        async ([top, bottom]) => {
          const G = window.__game
          const p = G.playerEntity()
          G.setHp(p, 100)
          G.teleportPlayer(top.x, top.z)
          await window.__t.runFor(0.2)
          const beforeFall = G.moveInfo()
          const dx = bottom.x - top.x
          const dz = bottom.z - top.z
          const len = Math.hypot(dx, dz) || 1
          G.pushEntity(p, (dx / len) * 26, (dz / len) * 26)

          const step = () => new Promise((r) => setTimeout(r, 8))
          // ① 창이 열리는 순간을 잡습니다.
          let opened = null
          const t0 = G.state().elapsed
          while (G.state().elapsed - t0 < 3) {
            const m = G.moveInfo()
            if (m.plungeWindowT > 0) {
              opened = m
              break
            }
            await step()
          }
          /**
           * ② 그리고 **닫히는지**. 이게 없으면 "낙하 공격이 상시 기술이
           *    되어 버렸다"는 최악의 실패를 못 잡습니다. 창은 착지 경직
           *    동안에는 안 흐르므로(playerControl 규칙) 경직 + 창만큼은
           *    걸립니다 — 넉넉히 3초를 줍니다.
           */
          let closed = null
          const t1 = G.state().elapsed
          while (G.state().elapsed - t1 < 3) {
            const m = G.moveInfo()
            if (m.plungeWindowT === 0) {
              closed = m
              break
            }
            await step()
          }
          return { beforeFall, opened, closed, window: G.moveInfo().plungeWindow }
        },
        [world(drop25.top.cx, drop25.top.cz), world(drop25.bottom.cx, drop25.bottom.cz)],
      )
    : null

  check(plunge !== null, '낙하 공격을 시험할 낙차가 지도에 있다')
  if (plunge) {
    // 짝이 되는 음성 검사 — 떨어지기 **전에는** 평범한 1타여야 합니다.
    check(
      plunge.beforeFall.pending === '1타' && plunge.beforeFall.plungeWindowT === 0,
      '떨어지기 전에는 평범한 1타다 (창이 처음부터 열려 있지 않다)',
      `"${plunge.beforeFall.pending}" · 창 ${plunge.beforeFall.plungeWindowT}초`,
    )
    check(
      plunge.opened?.pending === '낙하 공격' && plunge.opened?.plungeWindowT > 0,
      '떨어진 직후엔 **낙하 공격**이 열린다',
      `"${plunge.opened?.pending}" · 창 ${plunge.opened?.plungeWindowT}/${plunge.window}초`,
    )
    check(
      plunge.opened?.plungeSteps === cfg.fallFreeSteps + 1,
      '**몇 단 떨어졌는지**가 기술에 남는다 (높이가 위력이 되려면 필요합니다)',
      `${plunge.opened?.plungeSteps}단 (실제 ${cfg.fallFreeSteps + 1}단)`,
    )
    check(
      plunge.closed?.pending === '1타',
      '창이 지나면 도로 1타다 (상시 기술이 아니다)',
      `"${plunge.closed?.pending}"`,
    )
  }

  /**
   * ---- 2.6 낙하 공격이 **값어치를 하는가** ------------------------
   *
   * 위 검사는 *"열리고 닫힌다"* 까지입니다. 열려도 세지 않으면 아무도
   * 안 씁니다 — 게다가 이 기술은 **체력 36%를 먼저 낸 사람**이 쓰는
   * 것이라, 평타보다 조금 센 정도로는 손해입니다.
   *
   * ⚠️ 배율을 프로브가 다시 곱하지 않습니다. `weaponTable().plungeMoves`
   *    는 게임이 `plungeStep()` 으로 **계산해 준 결과**입니다. 프로브가
   *    식을 베끼면 배율을 바꾸는 날 프로브만 옛 값을 씁니다.
   */
  const wtbl = await page.evaluate(() => window.__game.weaponTable())
  check(wtbl.length >= 3, '무기표를 읽었다 (아래 비교가 헛돌지 않게)', `${wtbl.length}종`)
  if (wtbl.length >= 3) {
    const weakPlunge = wtbl.filter((w) => !(w.plungeMoves[0].damage > w.lastStepDamage))
    check(
      weakPlunge.length === 0,
      '낙하 공격은 세 무기 모두 **마무리 타보다 세다** (값을 먼저 냈으니까)',
      wtbl.map((w) => `${w.id} ${w.plungeMoves[0].damage}>${w.lastStepDamage}`).join(' · '),
    )
    const flat = wtbl.filter((w) => !(w.plungeMoves[1].damage > w.plungeMoves[0].damage))
    check(
      flat.length === 0,
      '**높이가 곧 위력**이다 (5단이 3단보다 세다 — 안 그러면 높이는 벌일 뿐)',
      wtbl.map((w) => `${w.id} 5단 ${w.plungeMoves[1].damage} > 3단 ${w.plungeMoves[0].damage}`).join(' · '),
    )
    const softPlunge = wtbl.filter((w) => !(w.plungeMoves[0].trauma > w.comboTrauma / w.comboLength))
    check(
      softPlunge.length === 0,
      '낙하 공격은 **무너뜨린다** (위에서 내리찍는 것이 평타와 같으면 안 됩니다)',
      wtbl
        .map((w) => `${w.id} ${w.plungeMoves[0].trauma}>${(w.comboTrauma / w.comboLength).toFixed(2)}`)
        .join(' · '),
    )
    /**
     * 공짜가 되지 않게 — 파고들기는 **줄어야** 합니다. 낙하 공격이 평타처럼
     * 달려들면 "절벽에서 뛰어내려 돌진"이 최적해가 되어, 낙하 피해를
     * 감수할 이유가 아니라 **거리를 좁히는 싼 수단**이 됩니다.
     */
    const dashy = wtbl.filter((w) => !(w.plungeMoves[0].lunge < w.firstLunge))
    check(
      dashy.length === 0,
      '낙하 공격으로 **거리를 벌지는 못한다** (제자리에서 내리찍는 기술)',
      wtbl.map((w) => `${w.id} ${w.plungeMoves[0].lunge}<${w.firstLunge}`).join(' · '),
    )
  }

  // ---- 3. 밀어 떨어뜨린 적은 무방비로 착지해야 합니다 ----
  //
  // 이것이 이 시스템의 **본체**입니다. 피해 12%보다 무방비 착지가 큽니다.
  const drop3 = findDrop(cfg.fallFreeSteps + 1, cfg.maxClimb)
  const pushed = drop3
    ? await page.evaluate(
        async ([top, bottom]) => {
          const G = window.__game
          const e = G.spawnEnemyKind('grunt', top.x, top.z)
          await window.__t.runFor(0.3)
          G.teleportEntity(e, top.x, top.z)
          await window.__t.runFor(0.2)
          const before = G.entityState(e)
          const dx = bottom.x - top.x
          const dz = bottom.z - top.z
          const len = Math.hypot(dx, dz) || 1
          G.pushEntity(e, (dx / len) * 26, (dz / len) * 26)
          await window.__t.runFor(0.35)
          const after = G.entityState(e)
          return { before, after }
        },
        [world(drop3.top.cx, drop3.top.cz), world(drop3.bottom.cx, drop3.bottom.cz)],
      )
    : null
  if (pushed) {
    check(
      pushed.before.level - pushed.after.level >= cfg.fallFreeSteps + 1,
      '넉백으로 적을 절벽 아래로 밀어낼 수 있다',
      `높이 ${pushed.before.level} → ${pushed.after.level}`,
    )
    check(
      pushed.after.hp < pushed.before.hp,
      '떨어진 적이 피해를 입는다',
      `체력 ${pushed.before.hp} → ${pushed.after.hp}`,
    )
    check(
      pushed.after.brokenT > 0,
      '떨어진 적은 무방비로 착지한다 (이게 진짜 보상)',
      `무방비 ${pushed.after.brokenT}초`,
    )
  } else {
    check(false, '넉백 낙하 시험 지점을 찾지 못함')
  }

  // ---- 4. 절벽 옆 전투가 실제로 배치되어 있는가 ----
  //
  // 시스템만 있고 그렇게 싸울 자리가 없으면, 낙하는 "가끔 실수로 아픈 것"이
  // 될 뿐 전투의 재료가 되지 못합니다.
  const cellOf = (e) => ({
    cx: Math.floor(e.x / 2 + level.w / 2),
    cz: Math.floor(e.z / 2 + level.h / 2),
  })
  const ledgeFoes = level.entities.filter((e) => {
    if (e.kind !== 'grunt' && e.kind !== 'binder' && e.kind !== 'dragger') return false
    const { cx, cz } = cellOf(e)
    const h = at(cx, cz)
    return [
      [cx - 1, cz],
      [cx + 1, cz],
      [cx, cz - 1],
      [cx, cz + 1],
    ].some(([nx, nz]) => {
      const n = at(nx, nz)
      return n !== VOID && h - n > cfg.fallFreeSteps
    })
  })
  check(
    ledgeFoes.length >= 2,
    '낭떠러지를 끼고 싸우게 되는 자리가 지도에 있다',
    `${ledgeFoes.length}마리가 낙차 옆에 서 있음`,
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
