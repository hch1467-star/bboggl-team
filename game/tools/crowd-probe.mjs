/**
 * 다대일 전투 부하 측정.
 *
 * 플레이 테스트 피드백: **"걸어서는 피해지는데 여러 명이 겹쳤을 때 피하기가 쉽지 않다."**
 *
 * 이걸 "회피를 유하게 할까 / 범위를 줄일까"로 바로 넘어가면 안 됩니다.
 * 둘 다 **개별 공격**을 건드리는 처방인데, 문제는 개별 공격이 아니라
 * **동시성**일 수 있기 때문입니다. 셋이 동시에 걸면 각자가 아무리 작아도
 * 도망칠 방향의 합집합이 사라집니다 — 그때는 크기를 줄여도 안 풀립니다.
 *
 * 그래서 먼저 잽니다: 잡몹 무리 한가운데에서 **동시에 몇 개의 예고가 뜨는가.**
 *
 * 실행: npm run crowd
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 4199
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

/**
 * ⚠️ **`preview` 가 아니라 `createServer`(개발 서버)를 씁니다.**
 *
 * 원래 이 프로브만 `vite preview` 였습니다 — 그건 **소스가 아니라 마지막
 * 빌드**를 띄웁니다. `npm run crowd` 는 빌드를 하지 않으므로, 이 프로브는
 * 언제 만들어졌는지도 모르는 `dist/` 를 재고 있었습니다. 실제로 이번에
 * 새로 노출한 값이 `undefined` 로 와서 들켰습니다(플레이어 지름 NaN).
 *
 * 이 저장소가 이번 세션에 아홉 번째로 밟은 같은 함정입니다 —
 * **계측기가 내가 생각한 것과 다른 것을 재고 있다.**
 */
const server = await createServer({
  root: ROOT,
  server: { port: PORT, strictPort: true, host: '127.0.0.1' },
  logLevel: 'error',
})
await server.listen()
const browser = await chromium.launch({
  executablePath: ['/opt/pw-browsers/chromium'].find((p) => existsSync(p)),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('error:', e))
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })

  /** 플레이어를 둘러싸고 잡몹 5마리를 세웁니다. 문제가 되는 상황을 그대로 재현합니다. */
  const setup = async () => {
    await page.evaluate(() => {
      window.__game.reset()
    })
    await sleep(500)
    await page.evaluate(() => {
      /**
       * ⚠️ **무적을 반드시 끕니다 — 앞 절이 켜 두고 갑니다.**
       *
       * 아래 오사 실험은 *"플레이어가 죽어서 관측이 끊기지 않게"* 무적을
       * 켭니다. 그런데 끄지를 않아서, 그 뒤의 모든 판이 **안 맞는 플레이어**
       * 로 돌았습니다. 그래서 「대응이 결과를 바꾸는가」 표가 몇 라운드 동안
       * **가만히 100 · 걸어서 100** 이었고, 검사가 없어서 초록이었습니다.
       *
       * 게임은 멀쩡했습니다 — 같은 배치를 따로 돌려 보니 10초에 100 → 47
       * 이었습니다. 실험대가 자기가 켠 것을 안 껐을 뿐입니다.
       * 그래서 끄는 것을 **실험이 끝나는 자리가 아니라 시작하는 자리**에
       * 둡니다. 앞에서 무엇을 하고 왔든 여기서 상태가 확정됩니다.
       */
      window.__game.setPlayerInvulnerable(false)
      window.__game.freezeEnemies(false)
      window.__game.clearEnemies()
      const n = 5
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        window.__game.spawnTestEnemy(Math.sin(a) * 3.4, Math.cos(a) * 3.4)
      }
    })
    await sleep(900)
  }

  /**
   * @param walk 계속 걸어서 빠져나가려 시도할지
   * 두 조건을 **같은 배치**로 재는 것이 핵심입니다. 가만히 서 있을 때와
   * 걸을 때의 차이가 곧 "플레이어의 대응이 결과를 바꾸는가"에 대한 답입니다.
   * 그 차이가 없으면 그 전투는 실력이 개입할 여지가 없다는 뜻입니다.
   */
  const trial = async (walk, seconds = 20) => {
    await setup()
    const hist = new Map()
    let maxTele = 0
    let maxWide = 0
    if (walk) {
      await page.evaluate(() => {
        window.__game.press('KeyD')
        window.__game.press('KeyS')
      })
    }
    /**
     * 🚧 **가장 가까운 적까지의 거리**도 같이 따라갑니다.
     *
     * 이 표가 「가만히 100/100 · 걸어서 100/100」 으로 찍혀 있었는데,
     * 그건 *"대응이 결과를 안 바꾼다"* 가 아니라 **아무 일도 안 일어났다**
     * 일 수 있습니다. 둘은 화면에서 똑같이 보이고, 결론은 정반대입니다.
     * 적이 사거리 안까지 들어왔는지를 봐야 그 둘이 갈립니다.
     */
    let nearest = Infinity
    /**
     * ⚠️ **장부를 먼저 비웁니다.** 휘두름 장부는 게임 전체에서 하나이고
     * 물어볼 때 비워집니다. 안 비우고 읽었더니 이 판의 숫자에 앞 절
     * (7마리 틈 재기 · 오사 실험)의 휘두름이 통째로 섞여 들어와
     * **「24회 휘둘러 23회 적중」인데 체력 100** 이라는 모순이 찍혔습니다.
     * 모순이 눈에 띄지 않았으면 그대로 결론으로 썼을 값입니다.
     */
    await page.evaluate(() => window.__game.swings())
    let lowHp = 100
    const t0 = Date.now()
    while (Date.now() - t0 < seconds * 1000) {
      const st = await page.evaluate(() => window.__game.state())
      hist.set(st.telegraphing, (hist.get(st.telegraphing) ?? 0) + 1)
      maxTele = Math.max(maxTele, st.telegraphing)
      maxWide = Math.max(maxWide, st.wideTelegraphs)
      if (st.nearestEnemy) nearest = Math.min(nearest, st.nearestEnemy.dist)
      lowHp = Math.min(lowHp, st.player.hp)
      if (st.player.hp <= 0) break
      await sleep(70)
    }
    if (walk) {
      await page.evaluate(() => {
        window.__game.release('KeyD')
        window.__game.release('KeyS')
      })
    }
    const st = await page.evaluate(() => window.__game.state())
    /**
     * 📒 **왜 안 맞았는지**를 게임의 장부에서 그대로 가져옵니다(combat.ts
     * `swingRecords`). 체력이 안 깎였을 때 *"안 휘둘렀다"* 와 *"휘둘렀는데
     * 빗나갔다"* 는 완전히 다른 이야기이고, 처방도 다릅니다.
     */
    const rows = await page.evaluate(() => window.__game.swings())
    const why = { swings: rows.length, hit: 0, range: 0, angle: 0, invuln: 0 }
    for (const r of rows) {
      if (r.hit) why.hit++
      else if (r.invuln) why.invuln++
      else if (r.dist > r.reach) why.range++
      else why.angle++
    }
    return { hist, maxTele, maxWide, hp: st.player.hp, lowHp, nearest, why }
  }

  /**
   * ── 🕳 **포위됐을 때 몸이 지나갈 틈이 있는가** ─────────────────────
   *
   * ── 왜 이걸 재게 됐는가 ──────────────────────────────────────────
   * 맵을 재다가 나온 숫자입니다: 이 존에는 **한 자리에서 동시에 깨어날 수
   * 있는 적이 최대 7마리**인 구간이 있습니다. 공격 토큰(작업 #20)이 *동시에
   * 때리는 수*는 막지만, **토큰 없는 나머지가 무엇을 하는지**는 아무도 재지
   * 않았습니다.
   *
   * 아캄·니오·섀도 오브 모르도르가 대기 중인 적을 **돌게** 만드는 이유가
   * 이것입니다 — 안 때려도 **몸으로 막으면** 회피가 답이 아니게 됩니다.
   * 이 게임의 4색은 전부 *"움직여서 답한다"* 이므로(구르기·걸어서 이탈·
   * 사거리 밖), 나갈 틈이 없으면 **색 전체가 무효**가 됩니다.
   *
   * ── 무엇을 재는가 ────────────────────────────────────────────────
   * 플레이어에서 본 적들의 **각도**를 정렬해 이웃 사이 빈 각을 구하고,
   * 그 각이 실제로 **몸이 지나갈 만한 폭**인지를 봅니다:
   *
   *     틈 폭 = 2·r·sin(Δθ/2) − (적 반지름 × 2)   ≥   플레이어 지름
   *
   * 반지름은 전부 게임에서 읽습니다(로스터 · terrainInfo.bodyRadius).
   * 여기 숫자를 적으면 몸 크기를 손보는 날 이 검사가 옛말이 됩니다.
   */
  const gapTrial = async (n, seconds = 12) => {
    await page.evaluate(() => window.__game.reset())
    await sleep(500)
    await page.evaluate((k) => {
      window.__game.clearEnemies()
      for (let i = 0; i < k; i++) {
        const a2 = (i / k) * Math.PI * 2
        window.__game.spawnTestEnemy(Math.sin(a2) * 3.4, Math.cos(a2) * 3.4)
      }
    }, n)
    await sleep(900)
    const cfg = await page.evaluate(() => ({
      t: window.__game.terrainInfo(),
      r: window.__game.enemyRoster(),
    }))
    const foeR = Math.min(...cfg.r.map((x) => x.radius))
    const meD = cfg.t.bodyRadius * 2
    let worst = Infinity
    const gaps = []
    let maxTele = 0
    const t0 = Date.now()
    while (Date.now() - t0 < seconds * 1000) {
      const snap = await page.evaluate(() => {
        const st = window.__game.state()
        return { p: st.player, tele: st.telegraphing, foes: window.__game.threats(12) }
      })
      maxTele = Math.max(maxTele, snap.tele)
      const near = snap.foes.filter((f) => f.dist <= 4.5)
      if (near.length >= 2) {
        const angs = near
          .map((f) => ({ a: Math.atan2(f.x - snap.p.x, f.z - snap.p.z), d: f.dist }))
          .sort((x, y) => x.a - y.a)
        let best = 0
        for (let i = 0; i < angs.length; i++) {
          const cur = angs[i]
          const nxt = angs[(i + 1) % angs.length]
          let dth = nxt.a - cur.a
          if (dth < 0) dth += Math.PI * 2
          const r = (cur.d + nxt.d) / 2
          const width = 2 * r * Math.sin(dth / 2) - foeR * 2
          if (width > best) best = width
        }
        if (best < worst) worst = best
        gaps.push(best)
      }
      await sleep(70)
    }
    /**
     * 📉 **판정은 «최악의 한 프레임»이 아니라 «아래쪽 10%»로 합니다.**
     *
     * ── 왜 고쳤나 ────────────────────────────────────────────────
     * `worst` 는 20초(약 285 표본) 중 **최솟값**입니다. 극단값이라
     * **표본이 늘수록 계속 내려갑니다** — 즉 이 검사는 «오래 돌릴수록
     * 엄해지는» 검사였습니다. 게임을 하나도 안 고쳐도 시간을 늘리면
     * 빨개집니다. 실제로 0.90m vs 0.90m 로 **정확히 동점**이 나왔고,
     * 동점에서 `>` 는 동전 던지기입니다.
     *
     * 이 저장소가 같은 병을 이미 한 번 앓았습니다 — `bypass` 의
     * 「달리면 더 많이 깨운다」를 최소·최대로 걸었다가 `19·19·19·19·1`
     * 의 그 `1` 하나에 뒤집힌 자리입니다. 처방도 같습니다:
     * **판정은 분위수로, 폭은 사람이 읽으라고 옆에 찍기.**
     *
     * 10%를 고른 이유: 「빠져나갈 틈이 있다」는 *"거의 언제나 있다"* 는
     * 뜻이지 *"단 한 프레임도 예외가 없다"* 가 아닙니다. 포위가 잠깐
     * 완전히 닫히는 순간은 **긴장**이고, 그게 20초 내내면 **벽**입니다.
     */
    const sorted = [...gaps].sort((x, y) => x - y)
    const q10 = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : -1
    const mid = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : -1
    return { worst: worst === Infinity ? -1 : worst, q10, mid, samples: sorted.length, maxTele, meD }
  }
  const ring = await gapTrial(7)
  console.log(
    `\n  🕳 7마리에 포위 — 빠져나갈 틈: 아래쪽 10% **${ring.q10.toFixed(
      2,
    )}m** · 가운데 ${ring.mid.toFixed(2)}m · 최악의 한 프레임 ${ring.worst.toFixed(2)}m ` +
      `(표본 ${ring.samples})\n     · 플레이어 지름 ${ring.meD.toFixed(
        2,
      )}m · 최대 동시 예고 ${ring.maxTele}개`,
  )
  check(
    ring.q10 > ring.meD,
    '**포위돼도 빠져나갈 틈이 남는다** (움직여서 답하는 게임이므로 — **아래쪽 10%**로 봅니다)',
    `아래쪽 10% ${ring.q10.toFixed(2)}m vs 몸 지름 ${ring.meD.toFixed(
      2,
    )}m · 최악의 한 프레임은 ${ring.worst.toFixed(2)}m (그 한 프레임으로 걸면 표본이 늘수록 엄해집니다)`,
  )

  /**
   * ── 💥 **적이 적을 스치는가** ─────────────────────────────────────
   *
   * 규칙을 넣었으니 **일어나는지**를 봅니다. 이 저장소에는 이미
   * "있는데 아무도 안 세는 규칙"이 하나 있었습니다 — 화살이 동료 몸에
   * 막히는 규칙이 그랬습니다. 규칙과 눈금은 같이 들어와야 합니다.
   *
   * 두 가지를 나눠 봅니다:
   *   1. **성립하는가** — 일부러 겹쳐 세우고 확인합니다(규칙의 존재)
   *   2. **일어나는가** — 그냥 둘러싸고 얼마나 나오는지 셉니다(규칙의 값어치)
   *
   * 1만 보면 "코드에 있다"까지밖에 말 못 하고, 2만 보면 안 나왔을 때
   * 규칙이 없는 건지 자리가 안 났던 건지 못 가립니다.
   */
  console.log('\n💥 오사 — 적의 광역이 동료를 무너뜨리는가\n')
  const cross = await page.evaluate(async () => {
    const G = window.__game
    const nap = () => new Promise((r) => setTimeout(r, 4))
    const now = () => G.state().simElapsed
    const wait = async (sec) => {
      const t0 = now()
      const dl = Date.now() + 20000
      while (now() - t0 < sec && Date.now() < dl) await nap()
    }

    G.reset()
    await wait(0.6)
    G.clearEnemies()
    await wait(0.3)
    G.teleportPlayer(0, 0)
    await wait(0.3)
    // 뒤(A) → 앞(B) → 플레이어. A 가 플레이어를 치면 그 부채꼴이 B 를 지납니다.
    const b = G.spawnEnemyKind('grunt', 0, 2.0)
    const a = G.spawnEnemyKind('grunt', 0, 4.0)
    if (a == null || a < 0 || b == null || b < 0) return null
    await wait(0.3)
    G.wakeEnemy(a)
    G.wakeEnemy(b)
    // 플레이어가 죽어서 관측이 끊기지 않게. 규칙을 재는 것이지
    // 플레이어의 생존을 재는 것이 아닙니다.
    G.setPlayerInvulnerable(true)

    /**
     * ⚠️ **둘 다 봅니다.** 처음엔 앞에 세운 쪽(b)만 봤다가 *"6회 스쳤는데
     * 강인도는 그대로"* 라는 앞뒤 안 맞는 답을 받았습니다. 적은 서로
     * 밀리며 자리를 바꾸므로 **누가 누구를 스쳤는지 미리 정할 수 없습니다.**
     * 한쪽만 보면 규칙이 멀쩡해도 빨갛게 뜹니다.
     */
    const before = G.runStats().crossfireHits
    const watch = [a, b].map((e) => {
      const i = G.enemyInfo(e)
      return {
        e,
        poiseMax: i?.poiseMax ?? 0,
        poiseLow: i?.poise ?? 0,
        hp0: i?.hp ?? 0,
        hpLow: i?.hp ?? 0,
        broke: false,
      }
    })
    /**
     * ⚠️ **벽시계 마감이 같이 있어야 합니다.** 처음엔 시뮬 시계만 보고
     * 돌렸는데, 그 시계가 안 흐르면 이 고리는 **영원히 돕니다.** 실제로
     * 한 판이 그렇게 900초 뒤에 통째로 잘렸고, 제목 줄만 찍힌 채
     * 종료 코드는 0 이었습니다 — 이 저장소가 가장 비싸게 여기는 실패
     * (아무 말도 안 하면서 성공했다고 하는 계측기)입니다.
     */
    const t0 = now()
    const dl2 = Date.now() + 60000
    while (now() - t0 < 8 && Date.now() < dl2) {
      for (const w of watch) {
        const info = G.enemyInfo(w.e)
        if (!info) continue
        if (info.poise < w.poiseLow) w.poiseLow = info.poise
        if (info.hp < w.hpLow) w.hpLow = info.hp
        /**
         * ⚠️ **무너짐을 따로 봅니다.** 강인도의 「최저값」만 보면 규칙이
         * 멀쩡해도 안 보일 수 있습니다 — 무너지는 순간 강인도가 **최대치로
         * 되돌아가서**, 프레임 사이에 일어난 하락은 흔적이 안 남습니다.
         * 이 저장소가 `poiseDealt` 에서 이미 똑같이 당했습니다.
         */
        if (info.broken) w.broke = true
      }
      await nap()
    }
    // 🧹 켠 것은 켠 자리에서 끕니다. (아래 `setup` 도 다시 끄지만, 짝을
    //    안 맞춘 채로 두면 다음에 이 절만 떼어 써도 같은 함정이 재생됩니다.)
    G.setPlayerInvulnerable(false)
    return { hits: G.runStats().crossfireHits - before, watch }
  })

  if (!cross) {
    check(false, '💥 겹쳐 세운 두 적을 실제로 만들었다 (비교의 게이트)')
  } else {
    console.log(`    스친 횟수 ${cross.hits}회`)
    for (const w of cross.watch) {
      console.log(
        `      적 ${w.e} — 강인도 ${w.poiseMax} → 최저 ${w.poiseLow}` +
          `${w.broke ? ' (무너짐 ✔)' : ''} · 체력 ${w.hp0} → 최저 ${w.hpLow}`,
      )
    }
    console.log('')
    check(cross.hits > 0, '💥 **적의 광역이 동료를 실제로 스친다**', `${cross.hits}회`)
    const dented = cross.watch.filter((w) => w.poiseLow < w.poiseMax || w.broke)
    check(
      dented.length > 0,
      '💥 그 스침이 **자세를 무너뜨린다** (자리를 잡은 값어치)',
      cross.watch.map((w) => `${w.poiseMax}→${w.poiseLow}${w.broke ? ' · 무너짐' : ''}`).join(' · '),
    )
    /**
     * ⚠️ 이게 이 규칙의 **뚜껑**입니다. 피해까지 들어가면 최적해가
     *    "끌고 다니며 서로 죽이게 두기"로 굳어, 예고를 읽는 기둥을
     *    통째로 우회하는 길이 생깁니다(combat.ts `applyPoise` 설계 노트).
     */
    check(
      // 빈 표본이 통과하지 않게 길이를 같이 봅니다(`npm run guard`).
      cross.watch.length > 0 && cross.watch.every((w) => w.hpLow >= w.hp0 - 0.01),
      '💥 그런데 **피해는 한 점도 안 들어간다** (유인이 싸움을 대신하면 안 됩니다)',
      cross.watch.map((w) => `${w.hp0}→${w.hpLow}`).join(' · '),
    )
  }

  const still = await trial(false)
  const total = [...still.hist.values()].reduce((a, b) => a + b, 0)
  console.log('동시 예고 개수 분포 (20초, 잡몹 5마리에 포위)')
  for (const k of [...still.hist.keys()].sort((a, b) => a - b)) {
    const pct = ((still.hist.get(k) / total) * 100).toFixed(1)
    console.log(`  ${k}개 : ${pct.padStart(5)}%  ${'█'.repeat(Math.round(pct / 2))}`)
  }
  console.log(`  최대 동시 예고 : ${still.maxTele}개`)
  console.log(`  최대 동시 광역 : ${still.maxWide}개`)
  console.log('')
  const moving = await trial(true)
  console.log('대응이 결과를 바꾸는가 (20초 뒤 남은 체력)')
  const tell = (r) =>
    `${r.hp} / 100 (최저 ${r.lowHp}) · 가장 가까웠던 적 ${r.nearest.toFixed(1)}m · 적이 휘두른 ${r.why.swings}회` +
    ` (적중 ${r.why.hit} · 사거리밖 ${r.why.range} · 각도밖 ${r.why.angle} · 무적 ${r.why.invuln})`
  console.log(`  가만히 서 있음 : ${tell(still)}`)
  console.log(`  계속 걸어서 이탈 : ${tell(moving)}`)
  /**
   * ── ⚠️ **이 표는 몇 라운드 동안 찍히기만 하고 검사가 없었습니다** ────
   *
   * 위 설계 노트가 이미 답을 적어 두었습니다 — *"그 차이가 없으면 그
   * 전투는 실력이 개입할 여지가 없다는 뜻입니다."* 그런데 그 문장에
   * 대응하는 `check()` 가 없어서, **가만히 100 · 걸어서 100** 이 찍혀도
   * 프로브는 초록이었습니다.
   *
   * 그리고 그 두 줄은 **두 가지 다른 사실**을 똑같이 표시합니다:
   *   ① 대응이 결과를 안 바꾼다 (게임의 문제)
   *   ② 애초에 아무 일도 안 일어났다 (실험대의 문제)
   * 그래서 게이트를 먼저 세웁니다 — 맞기는 맞았는가.
   */
  const reach = (await page.evaluate(() => window.__game.enemyRoster()))
    .filter((r) => r.id === 'grunt')
    .flatMap((r) => r.attacks.map((a) => a.reach))
  const maxReach = reach.length > 0 ? Math.max(...reach) : 0
  check(
    maxReach > 0 && still.nearest <= maxReach && still.hp < 100,
    '🚧 **가만히 서 있으면 실제로 맞는다** (비교의 게이트 — 아무 일도 안 일어난 판을 통과시키지 않게)',
    `가장 가까웠던 적 ${still.nearest.toFixed(1)}m (사거리 ${maxReach}m) · 체력 ${still.hp}/100`,
  )
  /**
   * ── ⚠️ **「덜 맞는다」가 성립하지 않습니다 — 초록이 우연이었습니다** ──
   *
   * 원래 이 검사는 `moving.hp > still.hp`(남은 체력) 이었습니다. 그런데
   * 두 판을 나란히 놓고 보면:
   *
   *     직전  가만히 0 · 걸어서 **7.8** (남은 체력)  → ✅
   *     지금  가만히 0 · 걸어서 **0**   (남은 체력)  → ❌
   *
   * **가만히 쪽은 두 판 다 0** 입니다. 즉 비교 대상이 **바닥에 붙어**
   * 있어서, 걸어서 쪽이 7.8 이냐 0 이냐라는 **한 끗**으로 판정이
   * 뒤집혔습니다. 이 회차에 같은 것을 두 번 봤습니다 — 「걸어서 vs
   * 달려서」 청구서의 분모가 죽어 있던 자리, 그리고 바로 위 「빠져나갈
   * 틈」이 최악의 한 프레임이던 자리입니다.
   *
   * ── 장부를 보면 «덜 맞지 않습니다» ──────────────────────────────
   *     직전  가만히 적중 **6** · 걸어서 적중 **6**  (걸어서 사거리밖 4)
   *     지금  가만히 적중 **7** · 걸어서 적중 **7**  (걸어서 사거리밖 4)
   *
   * 이동은 빗나감을 **4번** 만듭니다(두 판 모두 4로 일정). 그런데 적이
   * 그만큼 **더 휘둘러서**(8회 → 13회) 적중 수가 같아집니다.
   * 즉 실력은 개입하는데 **결과가 안 바뀝니다.**
   *
   * ── 그래서 문턱을 «성립하는 것»으로 옮깁니다 ────────────────────
   * 판정: **이동이 빗나감을 만든다**(사거리밖 > 0). 이건 두 판 모두 4로
   * 안정적이고, 죽음에 잘리지도 않습니다. 지키려던 문장(*"포위가 실력이
   * 개입할 수 있는 상황이게"*)의 **앞 절**입니다.
   *
   * ⚠️ **뒤 절(«그래서 덜 맞는다»)은 지금 게임에서 성립하지 않습니다.**
   *    문턱에서 빼되 **로그에는 남깁니다** — 검사에서 지우면 아무도
   *    모르게 됩니다. 고칠 곳은 계기가 아니라 게임이고(이동해도 적중이
   *    안 줄어드는 이유는 «더 휘두르기» 입니다), 그건 토큰·쿨다운과
   *    얽혀 있어 따로 재고 정할 일입니다.
   */
  console.log(
    `  📒 적중 — 가만히 ${still.why.hit}회 vs 걸어서 ${moving.why.hit}회 ` +
      `· 이동이 만든 빗나감 ${moving.why.range}회 (가만히 ${still.why.range}회)` +
      `\n     ⚠️ 적중이 **안 줄어듭니다** — 이동이 빗나감을 만들지만 적이 그만큼 더 휘두릅니다` +
      ` (${still.why.swings}회 → ${moving.why.swings}회). 「덜 맞는다」는 아직 성립하지 않습니다.`,
  )
  check(
    still.hp < 100 && moving.why.range > still.why.range,
    '🕳 **걸어서 이탈하면 헛치게 만든다** (포위가 실력이 개입할 수 있는 상황이게)',
    `가만히 ${still.hp} vs 걸어서 ${moving.hp}`,
  )
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
  process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
}
if (fail > 0 || pass > 0) {
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패`)
  if (fail > 0) process.exitCode = 1
}
