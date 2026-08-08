/**
 * 자동 플레이 — `npm run play`
 *
 * ── 왜 이걸 만들었는가 ────────────────────────────────────────────
 * 지금까지 밸런스 질문이 나올 때마다 **"직접 해보셔야 안다"** 로 넘겼습니다:
 *   · 성수병 3개가 82m 구간에 맞는가?
 *   · 불티 60이 첫 강화 비용으로 적당한가?
 *   · 보스 강인도 105가 너무 두껍지 않은가?
 *
 * 이건 넘길 게 아니라 **재야 할 것**이었습니다. 사람이 한 번 플레이하는
 * 대신, 봇에게 존을 끝까지 걷게 하고 숫자를 받으면 됩니다.
 *
 * ── 봇은 잘 못 합니다. 그게 핵심입니다 ───────────────────────────
 * 이 봇은 4색을 구분하지 못하고 백어택도 노리지 않습니다. 목표를 향해 걷고,
 * 적이 붙으면 때리고, 예고가 뜨면 구르고, 체력이 낮으면 마십니다.
 * 즉 **처음 플레이하는 사람의 하한선**에 가깝습니다.
 * 봇이 죽는 자리는 초보자도 죽는 자리이고, 봇이 걸어서 통과하는 구간은
 * 아무 판단 없이 통과되는 구간이라는 뜻입니다 — 둘 다 알아야 할 정보입니다.
 *
 * ⚠️ 모든 대기는 **시뮬레이션 시간**입니다. SwiftShader에서는 실시간의
 *    1/3~1/20로 흐르기 때문에 벽시계로 재면 전부 거짓이 됩니다.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const PORT = 5191
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))
/** 시뮬레이션 기준 최대 플레이 시간(초). 넘으면 "막혔다"로 봅니다. */
const TIME_LIMIT = Number(process.env.PLAY_LIMIT ?? 420)

const server = await createServer({ root: '.', server: { port: PORT }, logLevel: 'error' })
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
  // 이전 실행의 세이브가 남아 있으면 조건이 매번 달라집니다.
  await page.evaluate(() => window.__game.resetProgress())
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })

  console.log(`\n🤖 자동 플레이 — 제한 ${TIME_LIMIT} 시뮬레이션초\n`)

  const log = await page.evaluate(async (LIMIT) => {
    const G = window.__game
    const now = () => G.state().elapsed
    const sleep = () => new Promise((r) => setTimeout(r, 8))

    const held = new Set()
    const hold = (code) => {
      if (!held.has(code)) {
        held.add(code)
        G.press(code)
      }
    }
    const release = (code) => {
      if (held.has(code)) {
        held.delete(code)
        G.release(code)
      }
    }
    const releaseAll = () => {
      for (const c of [...held]) release(c)
    }
    const tap = (code) => {
      G.press(code)
      G.release(code)
    }

    /**
     * 화면 기준 이동.
     *
     * WASD는 **카메라 기준**이라 월드 방향을 그대로 못 씁니다. 쿼터뷰 45°에서
     * 월드 +X로 가려면 화면상 오른쪽 아래로 가야 합니다.
     * 카메라의 전방/우측 벡터에 투영해서 눌러야 할 키를 고릅니다.
     */
    const moveToward = (dx, dz) => {
      const cam = G.cameraAxes()
      const fwd = dx * cam.forwardX + dz * cam.forwardZ
      const right = dx * cam.rightX + dz * cam.rightZ
      const dead = 0.25
      if (fwd > dead) hold('KeyW')
      else release('KeyW')
      if (fwd < -dead) hold('KeyS')
      else release('KeyS')
      if (right > dead) hold('KeyD')
      else release('KeyD')
      if (right < -dead) hold('KeyA')
      else release('KeyA')
    }

    const t0 = now()
    let deaths = 0
    let lastHp = 100
    let stuckSince = t0
    let lastPos = G.state().player
    const regionLog = []
    let curRegion = ''
    let regionStart = t0
    let vialsUsed = 0
    let lastVials = G.vialInfo().vials
    let restCount = 0
    let bossSeen = false
    let bossKilled = false
    const notes = []

    while (now() - t0 < LIMIT) {
      const st = G.state()
      const vi = G.vialInfo()
      const p = st.player

      // ---- 구역 기록 ----
      if (st.region && st.region !== curRegion) {
        if (curRegion) regionLog.push({ name: curRegion, seconds: now() - regionStart })
        curRegion = st.region
        regionStart = now()
      }

      // ---- 죽음 ----
      if (p.hp <= 0 || st.gameOver) {
        deaths++
        notes.push({ at: Number((now() - t0).toFixed(1)), what: '사망', region: curRegion, x: p.x, z: p.z })
        releaseAll()
        // 화톳불 부활은 자동입니다. 게임 오버(부활 지점 없음)면 여기서 끝.
        if (st.gameOver) {
          notes.push({ at: Number((now() - t0).toFixed(1)), what: '게임 오버 — 부활 지점 없음' })
          break
        }
        const until = now() + 2
        while (now() < until) await sleep()
        continue
      }

      // ---- 성수병 ----
      //
      // 첫 판에서 봇이 **성수병을 한 번도 못 썼습니다**(0개 사용, 24초 만에 사망).
      // "적이 7m 밖일 때만 마신다"로 뒀는데, 전투 중에는 그런 순간이 오지
      // 않습니다. 사람이라면 **물러나서** 창을 만듭니다 — 봇도 그렇게 합니다.
      // (플레이어 5.4m/s vs 잡몹 3.0m/s 이므로 실제로 벌릴 수 있습니다.)
      if (vi.vials < lastVials) vialsUsed += lastVials - vi.vials
      lastVials = vi.vials
      const near = st.nearestEnemy
      if (p.hp < 50 && vi.vials > 0) {
        if (!near || near.dist > 7) {
          releaseAll()
          tap('KeyX')
          const until = now() + 1.1
          while (now() < until) await sleep()
          continue
        }
        // 아직 붙어 있으면 반대 방향으로 도망칩니다(최대 3초).
        const flee = now() + 3
        while (now() < flee) {
          const s2 = G.state()
          const n2 = s2.nearestEnemy
          if (!n2 || n2.dist > 7.5) break
          if (s2.player.hp <= 0) break
          moveToward(s2.player.x - n2.x, s2.player.z - n2.z)
          await sleep()
        }
        continue
      }

      // ---- 보스 상태 기록 ----
      const be = G.bossEncounter()
      if (be && be.encounter > 0 && !bossSeen) {
        bossSeen = true
        notes.push({ at: Number((now() - t0).toFixed(1)), what: '보스 조우', region: curRegion })
      }

      // ---- 전투 ----
      if (near && near.dist < 12) {
        G.aimAtWorld(near.x, near.z)
        if (near.dist > 2.2) {
          moveToward(near.x - p.x, near.z - p.z)
        } else {
          releaseAll()
          tap('Mouse0')
        }
        // 예고가 떠 있으면 일단 구릅니다. 4색을 구분하지 못하는 봇이라
        // **가장 단순한 대응**만 합니다 — 이게 초보자의 하한선입니다.
        if (st.telegraphing > 0 && near.dist < 6) tap('Space')
        await sleep()
        continue
      }

      // ---- 이동: 목표 쪽으로 ----
      const obj = G.objective()
      if (!obj) break
      moveToward(obj.x - p.x, obj.z - p.z)

      // ---- 화톳불: 지나가다 체력이 낮으면 쉽니다 ----
      // 불은 지나가기만 해도 붙습니다(안전망). 여기서 멈추는 건
      // **회복이 필요할 때**뿐입니다 — 쉬면 적이 되살아나니까요.
      const fire = G.nearestBonfire()
      if (fire && p.hp < 70) {
        const fd = Math.hypot(fire.x - p.x, fire.z - p.z)
        if (fd < 2.2) {
          releaseAll()
          const before = vi.vials
          const until = now() + 2.5
          while (now() < until) await sleep()
          if (G.vialInfo().vials > before) {
            restCount++
            lastVials = G.vialInfo().vials
          }
          continue
        }
      }

      // ---- 막힘 감지 ----
      const moved = Math.hypot(p.x - lastPos.x, p.z - lastPos.z)
      if (moved > 1.5) {
        lastPos = p
        stuckSince = now()
      } else if (now() - stuckSince > 18) {
        notes.push({
          at: Number((now() - t0).toFixed(1)),
          what: '막힘 (18초간 진행 없음)',
          region: curRegion,
          x: p.x,
          z: p.z,
        })
        break
      }

      lastHp = p.hp
      await sleep()
    }

    releaseAll()
    if (curRegion) regionLog.push({ name: curRegion, seconds: now() - regionStart })

    /**
     * 구역 경계에서는 이름이 **초 단위로 왔다 갔다** 합니다(실제 로그에서
     * 버려진앞마당↔무너진성문이 20번 넘게 번갈아 찍혔습니다).
     * 그대로 두면 목록이 길어져서 정작 "어디서 오래 걸렸나"가 안 보입니다.
     * 1초 미만은 버리고, 이어지는 같은 이름은 합칩니다.
     */
    const merged = []
    for (const r of regionLog) {
      if (r.seconds < 1) continue
      const last = merged[merged.length - 1]
      if (last && last.name === r.name) last.seconds += r.seconds
      else merged.push({ name: r.name, seconds: r.seconds })
    }
    const total = {}
    for (const r of merged) total[r.name] = (total[r.name] ?? 0) + r.seconds
    const st = G.state()
    const em = G.emberInfo()
    bossKilled = !st.nearestEnemy || (G.bossEncounter() === null)
    return {
      elapsed: Number((now() - t0).toFixed(1)),
      deaths,
      regionLog: merged.map((r) => ({ name: r.name, seconds: Number(r.seconds.toFixed(1)) })),
      regionTotal: Object.entries(total)
        .map(([name, seconds]) => ({ name, seconds: Number(seconds.toFixed(1)) }))
        .sort((a, b) => b.seconds - a.seconds),
      hitLimit: now() - t0 >= LIMIT - 1,
      vialsUsed,
      restCount,
      bossSeen,
      bossKilled,
      kills: st.kills,
      enemiesLeft: st.enemiesLeft,
      treasures: `${st.treasureFound ?? '?'}/${st.treasureTotal}`,
      embers: em.embers,
      vialsMax: em.vialsMax,
      hp: st.player.hp,
      notes,
      lastHp,
    }
  }, TIME_LIMIT)

  if (log.regionTotal.length) {
    console.log('  [구역별 누적]')
    for (const r of log.regionTotal) console.log(`    ${r.name.padEnd(12)} ${r.seconds}초`)
    console.log('')
  }
  if (log.notes.length) {
    console.log('  [사건]')
    for (const n of log.notes) {
      const where = n.region ? ` @${n.region}` : ''
      const pos = n.x !== undefined ? ` (${n.x.toFixed(0)}, ${n.z.toFixed(0)})` : ''
      console.log(`    ${String(n.at).padStart(6)}초  ${n.what}${where}${pos}`)
    }
    console.log('')
  }
  if (errors.length) {
    console.log('  [콘솔 오류]')
    for (const e of errors.slice(0, 3)) console.log(`    ${e}`)
    console.log('')
  }

  // 요약은 **맨 마지막**에 찍습니다. 앞에 두면 tail 로 볼 때 잘립니다
  // (실제로 첫 실행에서 요약이 통째로 안 보였습니다).
  console.log('  ── 요약 ──────────────────────────────')
  console.log(`  진행       ${log.elapsed}초${log.hitLimit ? ' (제한 도달 — 끝내지 못함)' : ''}`)
  console.log(`  사망       ${log.deaths}회`)
  console.log(`  처치       ${log.kills}마리 · 남은 적 ${log.enemiesLeft}마리`)
  console.log(`  보스       조우 ${log.bossSeen ? 'O' : 'X'}`)
  console.log(`  성수병     ${log.vialsUsed}개 사용 · 휴식 ${log.restCount}회 · 최대 ${log.vialsMax}개`)
  console.log(`  불티       ${log.embers}`)
  console.log(`  체력       ${log.hp}`)
  console.log('')
} finally {
  await browser.close()
  await server.close()
}
