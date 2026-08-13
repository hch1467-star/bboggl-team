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
