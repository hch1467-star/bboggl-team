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
  /**
   * ── ⚠️ **이 검사는 «앞에 선다»고 해 놓고 «한가운데에 서» 있었습니다** ──
   *
   * 빨간불이 이렇게 떴습니다:
   *
   *     ❌ 4/6개 무리 · 깨어난 수 [3, 0, 2, 2, 0, 2]
   *
   * 0 이 둘인데 어느 무리인지도, 왜인지도 안 나왔습니다. 그래서 먼저
   * **이유를 같이 받게** 고쳤더니(아래 `seen`) 답이 바로 나왔습니다:
   *
   *     3(grunt+charger+grunt)@(29,-7) 0마리
   *        [grunt 직선2m/**걸어서2m** · charger 직선2m/**걸어서70m** · grunt 4m]
   *     2(grunt+charger)@(40,26) 0마리
   *        [grunt 직선1.4m/**걸어서2m** · charger 직선1.4m/걸어서10m]
   *
   * **게임이 맞고 검사가 틀렸습니다.** 이 게임의 인지 규칙(balance.ts
   * `AWARE`)은 이렇습니다 — 앞쪽 150° 부채꼴이면 **본다**(존 14m),
   * 등 뒤면 **내가 낸 소리만큼만 듣는다**(가만히 서 있으면 1.8m).
   * 그리고 그 거리는 **걸어야 하는 거리**입니다.
   *
   * 이 검사는 무리의 **무게중심으로 순간이동해 가만히 서** 있었습니다.
   * 무게중심은 무리의 «앞»이 아니라 대개 **등 뒤이거나 사이**입니다.
   * 걸어서 2m 는 1.8m 밖이므로 아무도 못 듣습니다 — 이건 이 게임이
   * 일부러 만든 **기습**(메탈기어·쓰시마·세키로의 규칙)이지 배치 실패가
   * 아닙니다. 나머지 넷이 초록이었던 것도 실력이 아니라 **그 무리가
   * 마침 이쪽을 보고 있었기 때문**입니다 — 방향 운입니다.
   *
   * 「한 칸 차이의 초록은 운이다」의 사촌입니다: **방향 운의 초록**.
   *
   * ── 그래서 이름대로 잽니다 ───────────────────────────────────────
   * 무게중심에서 안 깨면, 그 무리를 **여덟 방향에서 5m 앞에 서서** 다시
   * 봅니다. 한 방향이라도 둘이 함께 깨면 *"앞에 서면 함께 깨어난다"* 는
   * 참입니다. 어느 방향에서도 안 되면 그때는 **정말** 배치 실패입니다.
   *
   * ⚠️ 실패한 무리만 여덟 번을 돕니다 — 초록인 무리까지 돌면 판이
   *    여덟 배로 길어지는데, 얻는 것은 이미 아는 사실뿐입니다.
   */
  const RING = 5
  const woken = []
  for (const g of multi) {
    const r = await page.evaluate(
      async ([x, z]) => {
        const G = window.__game
        G.resetProgress?.()
        G.teleportPlayer(x, z)
        await window.__t.runFor(1.2)
        // 무리 반경 10m 안에서 깨어난 수 — 옆 무리를 세지 않도록 좁게 봅니다.
        const near = G.threats(10)
        return {
          n: near.filter((t) => t.aggro).length,
          /**
           * ⚠️ **0 마리일 때 이유를 같이 받습니다.**
           *
           * 예전에는 `[3, 0, 2, 2, 0, 2]` 만 찍혔습니다. 0 이 둘인데
           * **어느 무리인지도, 왜인지도** 안 나옵니다. 그러면 남는 건
           * 추측뿐이고, 이 저장소에서 추측으로 판 자리는 늘 헛짚었습니다.
           *
           * 깨는 판정은 **걸어야 하는 거리**로 합니다(enemyAI). 그래서
           * 무리 한가운데에 서 있어도 그 사이가 낭떠러지면 아무도 안
           * 깨어납니다 — 그건 **배치 실패가 아니라 지형 이야기**이고,
           * 처방이 정반대입니다(적을 모으는 게 아니라 자리를 옮깁니다).
           * 게임이 판정에 쓴 값(`threats().walk`)을 그대로 받아 적습니다.
           */
          seen: near.map((t) => ({
            kind: t.kind,
            d: Number(t.dist.toFixed(1)),
            w: t.walk === null || t.walk === undefined ? null : Number(t.walk.toFixed(1)),
            up: t.aggro,
          })),
        }
      },
      [g.x, g.z],
    )
    if (r.n >= 2) {
      woken.push({ g, ...r, from: '한가운데' })
      continue
    }
    // 무게중심에서 안 깼으면 **여덟 방향의 «앞»**을 차례로 서 봅니다.
    let best = { ...r, from: '한가운데' }
    for (let k = 0; k < 8 && best.n < 2; k++) {
      const ang = (k * Math.PI) / 4
      const rx = g.x + Math.cos(ang) * RING
      const rz = g.z + Math.sin(ang) * RING
      const rr = await page.evaluate(
        async ([x, z]) => {
          const G = window.__game
          G.resetProgress?.()
          G.teleportPlayer(x, z)
          await window.__t.runFor(1.2)
          // 무리까지의 거리가 5m 늘었으니 반경도 같이 늘립니다(같은 무리를 봐야 합니다).
          const near = G.threats(15)
          return {
            n: near.filter((t) => t.aggro).length,
            seen: near.map((t) => ({
              kind: t.kind,
              d: Number(t.dist.toFixed(1)),
              w: t.walk === null || t.walk === undefined ? null : Number(t.walk.toFixed(1)),
              up: t.aggro,
            })),
          }
        },
        [rx, rz],
      )
      if (rr.n > best.n) best = { ...rr, from: `${Math.round((ang * 180) / Math.PI)}°에서 ${RING}m` }
    }
    woken.push({ g, ...best })
  }
  const groupsThatWake = woken.filter((r) => r.n >= 2).length
  check(
    groupsThatWake >= multi.length - 1,
    '무리 앞에 서면 둘 이상이 함께 깨어난다',
    `${groupsThatWake}/${multi.length}개 무리 · ` +
      woken
        .map(
          (r) =>
            `${r.g.size}(${r.g.kinds.join('+')})@(${r.g.x.toFixed(0)},${r.g.z.toFixed(0)}) **${r.n}마리**` +
            // 어디에 서서 얻은 값인지 — 「한가운데」가 아니면 방향을 적습니다.
            (r.from === '한가운데' ? '' : `(${r.from})`) +
            // 안 깬 무리만 이유를 폅니다 — 초록인 줄까지 길어지면 안 읽힙니다.
            (r.n >= 2
              ? ''
              : ` [${r.seen.length ? r.seen.map((s) => `${s.kind} 직선${s.d}m/걸어서${s.w ?? '길없음'}m${s.up ? '·깸' : ''}`).join(' · ') : '10m 안에 아무도 없음'}]`),
        )
        .join(' · '),
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
  /**
   * ── 📏 **붙는 거리에서 색이 나오는가** ──────────────────────────
   *
   * 3판 벤치의 적 쪽 줄:
   *
   *   grunt    공격 43% · **사거리 안 대기 8%**  · 예고 43회
   *   dragger  공격 30% · **사거리 안 대기 35%** · 예고 6회
   *   archer   공격  7% · **사거리 안 대기 39%** · 예고 2회 · 적중 **0%**
   *
   * 처음엔 공격 토큰(`grantAttackTokens` 가 **가장 가까운 적**에게만 준다)을
   * 의심했습니다. 같은 거리에 넷을 세워 재 봤더니 3.0m 에서는 잡몹 29 : 0,
   * 4.0m 에서는 가르치는 둘이 80% — **반지름이 승자를 정했습니다.**
   * 즉 그 실험은 토큰을 잰 적이 없습니다. 패턴마다 **띠가 다르기** 때문입니다:
   *
   *     grunt_jab    0~2.4      grunt_sweep   0~4.2
   *     binder_web   0~6.0      charger_rush  0~7.5
   *     dragger_hook **3**~12   archer_shot   **3**~12
   *
   * 여기서 진짜 그림이 보입니다. 끄는 자와 쏘는 자는 **최소 사거리 3m** 가
   * 있고, 플레이어는 무기 사거리(2.3m)로 싸우니 **늘 그 안쪽**입니다.
   * 그러면 둘은 영영 못 쏩니다 — 벤치의 `사거리 안 대기 35%·39%` 와
   * `적중 0%` 가 그것입니다.
   *
   * ── 다른 게임은 이 자리를 어떻게 두는가 ─────────────────────────
   * · **몬스터헌터** — 몬스터는 자기 패턴을 쓸 수 있는 자리로 **다시
   *   잡습니다**. 품에 파고들면 뒷걸음질이나 도약으로 거리를 만듭니다.
   * · **소울류** — 궁수는 붙으면 **근접 수단**(발차기·단검)으로 바꾸거나
   *   물러섭니다. 가만히 서서 활을 든 채 맞고만 있지 않습니다.
   * · **로스트아크** — 원거리 몹은 **카이팅**합니다.
   * · **검은 신화: 오공** — 장병기 적은 **한 발 물러나** 휘두릅니다.
   *
   * 공통점: **자기 띠 밖에 있으면 띠로 돌아갑니다.** 우리 적은 서 있습니다.
   *
   * 그래서 이 절은 토큰이 아니라 **띠**를 잽니다 — 여러 반지름에 세워 놓고
   * 누가 휘두르는지 표로 찍습니다. 문턱은 마지막 줄에 있습니다.
   *
   * ⚠️ **붙들지 않습니다.** 처음엔 매 프레임 순간이동으로 거리를 고정했는데,
   *    그러자 같은 코드가 세 번 다른 답을 냈습니다(잡몹 29 : 0 → 3 → **0**).
   *    붙드는 것이 AI 의 접근·조준을 방해하고 있었습니다. **계측기가 재려는
   *    것을 바꿔 버리면 그 숫자는 게임의 것이 아닙니다.** 그래서 세워만 두고,
   *    적이 **스스로 고른 거리**를 함께 적습니다 — 물러나는지 서 있는지가
   *    바로 이 절이 묻는 것이기도 합니다.
   */
  console.log('')
  const RADII = [2.0, 3.0, 4.5, 7.0]
  const PLAN = ['grunt', 'binder', 'dragger', 'archer']
  const band = []
  for (const R of RADII) {
    const r = await page.evaluate(
      async ({ R, PLAN }) => {
        const G = window.__game
        const sleep = () => new Promise((res) => setTimeout(res, 8))
        G.reset()
        await window.__t.runFor(0.6)
        G.clearEnemies()
        await window.__t.runFor(0.6)
        const p = G.state().player
        const ids = []
        PLAN.forEach((kind, i) => {
          const a = (i / PLAN.length) * Math.PI * 2
          const e = G.spawnEnemyKind(kind, p.x + Math.sin(a) * R, p.z + Math.cos(a) * R)
          G.wakeEnemy(e)
          ids.push({ e, kind, a })
        })
        const swings = {}
        /** 붙들지 **않은** 채로도 재려고, 마지막 거리를 같이 남깁니다. */
        const lastDist = {}
        const was = new Map()
        const t0 = G.state().simElapsed
        while (G.state().simElapsed - t0 < 24) {
          const pp = G.state().player
          for (const { e, kind, a } of ids) {
            const i = G.enemyInfo(e)
            if (!i) continue
            // 올라가는 순간에만 셉니다 — 프레임마다 세면 예고가 긴 쪽이 커집니다.
            const now = !!i.winding
            if (now && !was.get(e)) swings[kind] = (swings[kind] ?? 0) + 1
            was.set(e, now)
            lastDist[kind] = Number(Math.hypot(i.x - pp.x, i.z - pp.z).toFixed(1))
            void a
          }
          if (G.state().player.hp < 50) G.setHp(G.playerEntity(), 100)
          for (const { e } of ids) if (G.enemyInfo(e)) G.setHp(e, 999)
          await sleep()
        }
        return { swings, lastDist }
      },
      { R, PLAN },
    )
    band.push({ R, ...r })
    console.log(
      `  [띠] 반지름 ${R.toFixed(1)}m · 24초 — ` +
        PLAN.map((k) => `${k} ${r.swings[k] ?? 0}회`).join(' · '),
    )
  }

  /**
   * ⚠️ **표본이 있는지 먼저 묻습니다.** 아무도 안 휘두르면 어떤 부등호든
   *    통과합니다 — 이 저장소가 빈 배열로 세 번 데인 자리입니다.
   */
  const total = band.reduce(
    (a, b) => a + PLAN.reduce((x, k) => x + (b.swings[k] ?? 0), 0),
    0,
  )
  check(total >= 12, '📏 측정이 성립했다 — 표를 채울 만큼 휘둘렀다', `전체 ${total}회`)

  /**
   * **붙는 거리(2m)** 에서 네 종류가 모두 무언가를 하는가.
   *
   * 2m 를 고른 근거: 플레이어 무기 사거리가 2.3m 이고, 벤치가 잰 보스전
   * 거리 분포도 *"2.5m 미만 55%"* 입니다. 즉 **사람이 실제로 서 있는
   * 자리**입니다. 그 자리에서 못 쓰는 패턴은 존에서 없는 패턴입니다.
   */
  /**
   * ⚠️ **진단이 두 번 바뀌었습니다 — 자리한 거리를 같이 찍어서 갈렸습니다.**
   *
   * 처음엔 *"최소 사거리(3m) 안쪽이라 못 쏜다"* 고 적었습니다. 그런데 표가
   * 말하는 것은 반대입니다 — 끄는 자는 **8.1m**, 쏘는 자는 **8.6m** 에
   * 자리를 잡습니다. 둘 다 자기 띠(3~12m) **한가운데**입니다. 그런데도
   * 24초 동안 **0회**입니다. 네 반지름 어디서 시작해도 같습니다.
   *
   * 그러면 남는 것은 **차례**입니다. `grantAttackTokens` 는 거리로 줄을
   * 세우고 앞에서부터 토큰을 줍니다. 잡몹(2.1m)과 얽는 자(5.8m)가 늘 앞
   * 둘이고, 멀리서 싸우는 것이 **정체성인** 둘은 영영 셋째·넷째입니다.
   *
   * 즉 이 게임에서 원거리 적은 배치의 문제가 아니라 **규칙상 못 쏩니다.**
   */
  const close = band.find((b) => b.R === 2.0)
  const mute = PLAN.filter((k) => band.every((b) => (b.swings[k] ?? 0) === 0))
  check(
    mute.length === 0,
    '📏 **모든 종류가 어느 거리에선가는 휘두른다** (멀리서 싸우는 적이 규칙상 침묵하지 않게)',
    mute.length
      ? `${mute.join(', ')} 가 네 반지름 **전부에서 0회** — 자리한 거리 ` +
        `${mute.map((k) => `${k} ${close?.lastDist[k] ?? '?'}m`).join(' · ')}` +
        ` (자기 띠 안인데도 못 씁니다 → 거리가 아니라 **차례** 문제)`
      : '넷 다 휘두름',
  )

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
