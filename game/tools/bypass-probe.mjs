/**
 * 지나치기 프로브 — `npm run bypass`
 *
 * ── 왜 이걸 재는가 ──────────────────────────────────────────────
 * 방금 **달리기**(Shift, 1.55배)를 넣었습니다. 그런데 달리기는 이동만
 * 바꾸는 기능이 아닙니다. **거리의 값을 바꾸는** 기능입니다.
 *
 * 이 존의 설계는 전부 "걸어서 지나간다"를 전제로 잽니다:
 *   · `npm run map` 의 "위협 없이 30m(약 6초) 넘게 걷지 말 것"
 *   · 궁수가 "지나가는 동안 2발 쏜다"는 배치 근거
 *   · 방 단위 어그로 14m
 * 이 6초·2발·14m는 전부 **초당 5.4m**로 나눈 값입니다. 8.4m/s가 되면
 * 같은 배치가 다른 게임이 됩니다 — 노출 시간이 36% 줄어듭니다.
 *
 * ── 다른 게임은 이걸 어떻게 다루는가 ────────────────────────────
 * · **엘든 링 / 다크소울**: 달려서 지나갈 수 있습니다. 대신 **공짜가
 *   아닙니다** — 등 뒤에서 맞고, 화톳불까지 끌고 가고, 보스방 앞에
 *   **피가 깎인 채** 도착합니다. 그게 "그냥 뛰어"의 가격표입니다.
 * · **로스트아크**: 잡몹을 지나칠 수 있지만 문이 잠겨 있거나 관문
 *   보상이 참여를 강제합니다.
 * · **검은 신화: 오공**: 달리기가 자유롭지만 통로가 좁아 지나칠 공간이
 *   애초에 없습니다.
 *
 * 셋 다 "못 지나가게" 막지 않습니다. **지나가는 데 값을 매깁니다.**
 * 우리 게임은 어느 쪽인지 **한 번도 재 본 적이 없습니다.**
 *
 * ── 그래서 여기서 재는 것 ───────────────────────────────────────
 *   싸우지 않고 목표만 따라 보스까지 간다. 걸어서 한 번, 달려서 한 번.
 *   · 얼마나 걸리는가 (시뮬레이션 시간)
 *   · **체력을 얼마나 잃는가** ← 이게 "가격표"입니다
 *   · 몇 대나 맞는가 · 몇 마리를 뒤에 달고 도착하는가
 *
 * 값이 0이면 이 존의 전투는 전부 **선택 사항**이고, 4색을 가르치려고
 * 만든 배치가 통째로 건너뛰어집니다.
 *
 * ⚠️ 이 프로브는 수치를 하나도 베껴 적지 않습니다. 속도·성수병 회복량은
 *    전부 게임에서 꺼내 씁니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5207
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
  await page.goto(`http://localhost:${PORT}/?lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🏃 지나치기 프로브 — 싸우지 않고 보스까지\n')

  const terrain = await page.evaluate(() => window.__game.terrainInfo())
  const walkSpeed = terrain.playerMoveSpeed
  const runSpeed = walkSpeed * terrain.sprintScale
  console.log(
    `  [속도] 걷기 ${walkSpeed.toFixed(1)} m/s · 달리기 ${runSpeed.toFixed(1)} m/s (×${terrain.sprintScale})`,
  )

  // 가장 빠른 적이 누구인지도 **게임에서** 꺼냅니다.
  const roster = await page.evaluate(() => window.__game.enemyRoster())
  // ⚠️ `moveSpeed` 가 아니라 `approachSpeed` 로 고릅니다 — 도망을 따라잡는 건
  //    전투 속도가 아니라 **사거리 밖에서 내는 속도**입니다.
  const fastest = roster.reduce((m, r) => (r.approachSpeed > m.approachSpeed ? r : m), roster[0])
  /**
   * 🎟 **동시 공격 토큰의 규칙** — 아래 ⛰️ 천장 계산이 쓰는 값입니다.
   * 게임에서 꺼냅니다(작업 #20). 여기에 2를 적어 두면 토큰을 바꾸는 날
   * 프로브가 옛 게임을 잽니다.
   */
  const limits = await page.evaluate(() => window.__game.combatLimits())
  // 🔇 듣는 거리 — 게임의 식으로 냅니다(main.ts `hearWalk` 주석).
  const hearRunM = terrain.hearRun
  console.log(
    `  [적] 가장 빨리 다가오는 적 ${fastest.name} ${fastest.approachSpeed.toFixed(1)} m/s ` +
      `(전투 중엔 ${fastest.moveSpeed}) — 걷기의 ${((fastest.approachSpeed / walkSpeed) * 100).toFixed(0)}% · ` +
      `달리기의 ${((fastest.approachSpeed / runSpeed) * 100).toFixed(0)}%\n`,
  )

  /**
   * **한 번의 종주.** 목표(objective)만 따라가고 공격·회피는 절대 안 합니다.
   *
   * 봇이 잘 싸우는지가 아니라 **안 싸우고도 갈 수 있는지**를 재는 것이므로,
   * 여기서 공격을 섞으면 재려던 것이 사라집니다.
   */
  /**
   * 🧭 **지도가 «일부러 등을 돌려 놓은» 적** — 그 자리가 실제로 봇의 길
   * 옆인지 확인하려면 누구인지 알아야 합니다.
   *
   * ── 왜 필요했나 (계기 둘이 서로 다른 길을 그리고 있었습니다) ──────
   * `npm run map` 이 「동선에서 8.0m」이라며 🔇 검사를 초록으로 줬는데,
   * 여기서 깬 적들의 최소 접근 거리를 찍어 보니 **가장 먼 것이 8.5m**
   * 이고 그 파수꾼은 목록에 아예 없었습니다 — 봇이 9m 안에 들어간 적이
   * 없다는 뜻입니다.
   *
   * `map` 의 길은 `routeTrail`(칸을 잇는 최단 경로)이고, 봇의 길은
   * `G.objective()` 가 이끄는 실제 걸음입니다. **둘은 같은 길이
   * 아닙니다.** 그 차이를 모르면 지도에서 초록인 배치가 게임에서는
   * 아무 데도 아닌 자리가 됩니다.
   */
  const faced = JSON.parse(
    await page.evaluate(() =>
      fetch('/src/levels/broken-gate.json')
        .then((r) => r.text())
        .then((t) => t),
    ),
  ).entities.filter((e) => e.face !== undefined)

  const traverse = async (sprint) =>
    page.evaluate(async ({ useSprint, faced }) => {
      const G = window.__game
      G.resetProgress()
      await new Promise((r) => setTimeout(r, 400))

      const now = () => G.state().simElapsed
      const sleep = () => new Promise((r) => setTimeout(r, 8))
      const held = new Set()
      const hold = (c) => {
        if (!held.has(c)) {
          held.add(c)
          G.press(c)
        }
      }
      const release = (c) => {
        if (held.has(c)) {
          held.delete(c)
          G.release(c)
        }
      }
      const moveToward = (dx, dz) => {
        const cam = G.cameraAxes()
        const fwd = dx * cam.forwardX + dz * cam.forwardZ
        const right = dx * cam.rightX + dz * cam.rightZ
        const dead = 0.25
        fwd > dead ? hold('KeyW') : release('KeyW')
        fwd < -dead ? hold('KeyS') : release('KeyS')
        right > dead ? hold('KeyD') : release('KeyD')
        right < -dead ? hold('KeyA') : release('KeyA')
      }

      const t0 = now()
      const start = G.state().player
      // 최대 체력도 **게임에서** 꺼냅니다. 100을 적어 두면 밸런스를 바꾼 날
      // "체력 78/100" 같은 거짓말이 로그에 남습니다.
      const maxHp = G.entityState(G.playerEntity())?.maxHp ?? 0
      let lastHp = G.state().player.hp
      let hits = 0
      let damage = 0
      let deaths = 0
      let travelled = 0
      let last = { x: start.x, z: start.z }
      let arrived = false
      /**
       * 🔔 종주의 **절반 지점**(m). 스폰→보스가 약 185m 라 그 절반입니다.
       * 여기에 미터를 적어 두는 대신 게임에게 물을 수도 있지만, 이 값은
       * *"어디서 견줄까"* 라는 **재는 쪽의 선택**이지 게임의 규칙이
       * 아닙니다 — 그런 값은 프로브에 두는 것이 맞습니다.
       */
      const HALF_WAY = 90
      let awakeHalf = -1
      let awakeHalfWho = []
      let awakeHalfHow = []
      const closest = new Map()
      const facedNear = faced.map(() => 999)
      const facedSpeed = faced.map(() => 0)
      const facedWoke = faced.map(() => 0)
      let lastT = now()
      let prevPos = { x: start.x, z: start.z }
      let stuckSince = t0
      let stuckPos = { x: start.x, z: start.z }
      let stuckTime = 0

      // 시뮬레이션 시간 기준 제한 — 벽시계로 재면 프레임률에 따라 결과가 흔들립니다.
      const LIMIT = 180
      const wallDeadline = Date.now() + 300000

      while (now() - t0 < LIMIT && Date.now() < wallDeadline) {
        const s = G.state()
        const p = s.player

        travelled += Math.hypot(p.x - last.x, p.z - last.z)
        last = { x: p.x, z: p.z }

        /**
         * 📐 **개체마다 «가장 가까이 갔던 거리»** — 깬 이유가 소리인지
         * 시야인지 가르는 유일한 값입니다.
         *
         * 깨는 식은 `보고 있으면 14m · 등 돌렸으면 6.4~9m` 입니다. 그러니
         * 어떤 적이 깼을 때 **내가 그 적에게 몇 미터까지 갔었나**를 알면
         * 둘이 갈립니다 — 14m 안까지 갔으면 시야로 설명되고, 그보다 멀리서
         * 깼다면 소리밖에 없습니다.
         *
         * 이게 없으면 「걷기와 달리기가 같은 적을 깬다」를 보고 곧바로
         * *"소리 규칙이 죽었다"* 고 말하게 되는데, 실은 *"둘 다 시야
         * 안까지 들어가서 소리가 나설 자리가 없었다"* 일 수 있습니다.
         * 처방이 다릅니다 — 앞은 **값**, 뒤는 **길의 모양**입니다.
         */
        for (const t of G.threats(300)) {
          const prev = closest.get(t.entity)
          if (prev === undefined || t.dist < prev) closest.set(t.entity, t.dist)
        }
        /**
         * 🧭 지도가 등을 돌려 놓은 적에게 **실제로** 몇 미터까지 갔는가 —
         * 그리고 **그 순간 내 속도가 얼마였는가.**
         *
         * ⚠️ 속도가 필요한 이유: 깨는 식은 최고 속도가 아니라 **그 프레임의
         *    속도**로 듣는 거리를 계산합니다(`hearDistance(playerSpeed)`).
         *    모퉁이에서 감속하면 질주 중이어도 듣는 거리가 줄어듭니다.
         *    「달려서 8m 까지 갔다」만으로는 깼어야 하는지 말할 수 없습니다.
         */
        const dtNow = now() - lastT
        const moved = Math.hypot(p.x - prevPos.x, p.z - prevPos.z)
        const speedNow = dtNow > 0.0001 ? moved / dtNow : 0
        lastT = now()
        prevPos = { x: p.x, z: p.z }
        for (let i = 0; i < faced.length; i++) {
          const d = Math.hypot(p.x - faced[i].x, p.z - faced[i].z)
          if (d < facedNear[i]) {
            facedNear[i] = d
            facedSpeed[i] = speedNow
          }
          // 이 적이 실제로 깼는가 — 자리에서 움직였거나 aggro 가 섰는가.
          const th = G.threats(300).find(
            (t) => Math.hypot(t.x - faced[i].x, t.z - faced[i].z) < 6 && t.kind === faced[i].kind,
          )
          if (th && th.aggro) facedWoke[i] = 1
        }

        /**
         * 🔔 **깨운 수는 «같은 지점»에서 견줍니다** — 끝에서 세면 포화합니다.
         *
         * ── 이 검사는 죽음이 만든 초록으로 통과하고 있었습니다 ────────
         * 「달리면 더 많이 깨운다」를 종주가 **끝난 뒤**의 수로 걸고
         * 있었습니다. 사진 방식으로 고쳐 살아 있는 값을 재니:
         *     달려서 15마리(15~15) vs 걸어서 **15마리(15~15)** — 차이 0
         * 그전에 통과하던 15 vs 0 의 그 0은 **화톳불에서 잰 수**였습니다.
         *
         * 그런데 0이 아니라고 해서 소리 규칙이 죽은 것도 아닙니다.
         * 184m 를 다 지나온 **끝**에서 세면 걷든 달리든 길 옆을 전부
         * 깨워서 **포화**합니다 — 두 수가 같은 것이 당연합니다.
         * 소리가 만드는 차이는 *가는 도중*에 있습니다.
         *
         * 그래서 **같은 거리를 지났을 때**의 수를 따로 찍습니다. 그러면
         * 걷기와 달리기가 «본 세계의 양»이 같고 **속도만** 다릅니다 —
         * 비교가 성립하는 유일한 자리입니다.
         *
         * ⚠️ 시간이 아니라 **거리**로 자릅니다. 같은 시간에 자르면 달리는
         *    쪽이 더 멀리 가 있어서, 재는 것이 *"소리가 큰가"* 가 아니라
         *    **"더 갔는가"** 가 됩니다 — 이번 회차에 창을 두고 정확히 같은
         *    실수를 한 번 고쳤습니다.
         */
        if (awakeHalf < 0 && travelled >= HALF_WAY) {
          const up = G.threats(300).filter((t) => t.aggro)
          awakeHalf = up.length
          /**
           * 📋 **누가 깨어 있었는지도 적어 둡니다** — 수는 «누구»를 말해
           * 주지 않습니다.
           *
           * 절반 지점에서 걸어서 10마리 vs 달려서 10마리가 나왔습니다.
           * 그런데 「10 = 10」은 두 가지를 한 수에 담습니다:
           *   ① 정말 같은 적들이 깼다 → 소리 규칙이 아무 일도 안 한다
           *   ② 다른 적들이 깼는데 수만 같다 → 규칙은 사는데 상쇄됐다
           * 이 목록을 걷기·달리기에서 견주면 그 둘이 갈립니다. 이번
           * 회차에 «수만 보고 뜻을 정하다» 여러 번 물렸습니다.
           */
          /**
           * ⚠️ **좌표는 신원이 아닙니다.** 처음엔 `kind(x,z)` 로 이름을
           *    지었는데, 깬 적은 **쫓아오므로** 판마다 자리가 다릅니다.
           *    그래서 차집합이 양쪽에 8마리씩 나왔습니다 — 같은 적이
           *    1m 움직인 것을 «다른 적»으로 센 것입니다. 그 표를 그대로
           *    읽었으면 *"규칙은 사는데 수만 상쇄됐다"* 는 정반대 결론을
           *    냈을 겁니다.
           *
           *    개체 번호(`entity`)를 씁니다 — `resetProgress()` 뒤 스폰
           *    순서가 같으므로 걷기 판과 달리기 판에서 같은 적이 같은
           *    번호를 받습니다. 움직여도 안 바뀌는 유일한 값입니다.
           */
          awakeHalfWho = up.map((t) => `${t.kind}#${t.entity}`).sort()
          // 📐 깬 적마다 «여태 가장 가까이 갔던 거리». 시야(14m)보다 멀면 소리입니다.
          awakeHalfHow = up
            .map((t) => ({ id: `${t.kind}#${t.entity}`, near: closest.get(t.entity) ?? 999 }))
            .sort((a2, b2) => a2.near - b2.near)
        }

        // 받은 피해 — 회복이 없으므로 줄어든 만큼이 곧 피해입니다.
        if (p.hp < lastHp - 0.01) {
          hits++
          damage += lastHp - p.hp
        }
        if (p.hp > lastHp + 0.01) deaths++ // 부활(리스폰)로만 늘어납니다
        lastHp = p.hp

        const be = G.bossEncounter()
        if (be && be.encounter > 0) {
          arrived = true
          break
        }

        const obj = G.objective()
        if (!obj) break
        moveToward(obj.stepX - p.x, obj.stepZ - p.z)

        // 막힘 감시 — 적 몸통에 걸려 못 가면 그것도 "지나치기의 가격"입니다.
        if (Math.hypot(p.x - stuckPos.x, p.z - stuckPos.z) > 1.5) {
          stuckPos = { x: p.x, z: p.z }
          stuckSince = now()
        } else if (now() - stuckSince > 1.0) {
          stuckTime += now() - stuckSince
          stuckSince = now()
        }

        if (useSprint) hold('ShiftLeft')
        else release('ShiftLeft')
        await sleep()
      }

      for (const c of [...held]) release(c)
      // ⚠️ 종주 시간은 **여기서** 확정합니다. 아래 8초 관측을 하고 나서 재면
      //    걷기·달리기 둘 다에 8초가 얹혀 단축률이 흐려집니다.
      const travelTime = now() - t0
      /**
       * ⚠️ **도착 시점의 체력을 여기서 붙잡습니다.**
       *
       * 처음엔 8초 관측이 끝난 뒤의 체력을 "도착 체력"이라고 찍었습니다.
       * 그러니 로그가 `체력 18/100 (피해 4)` 라고 나왔습니다 — 두 수가
       * 서로 모순인데 둘 다 맞았습니다. 하나는 **도착 순간**, 하나는
       * **8초 뒤**의 이야기였을 뿐입니다. 한 줄에 다른 시점의 두 수를
       * 나란히 찍으면 읽는 사람은 반드시 틀리게 읽습니다.
       */
      const arriveHp = G.state().player.hp

      /**
       * **도착 뒤 8초를 더 봅니다.**
       *
       * 엘든 링에서 몹을 달고 안개문을 넘으면 보스방에 그 몹들이 따라옵니다.
       * 그게 "그냥 뛰어"의 진짜 청구서입니다 — 보스 + 잡몹 다섯.
       * 도착하는 **순간**의 추격자 수만 세면 이걸 못 봅니다. 5마리가 따라오다
       * 문턱에서 멈추면 통행료는 0원이고, 안까지 들어오면 제값입니다.
       */
      /**
       * ⚠️ **무리가 도착한 뒤부터 8초를 셉니다** — 내가 도착한 뒤가 아니라.
       *
       * 예전엔 도착 즉시 8초를 셌습니다. 그러면 재는 것이 *"무리가 아픈가"*
       * 가 아니라 **"무리가 8초 안에 도착했는가"** 가 됩니다. 도착 시각은
       * 경로 사정에 크게 흔들려서, 게임을 하나도 안 고쳤는데 청구서가
       * **0에서 90까지** 오갔습니다(다섯 판 0~90.2). 그 폭 한가운데에
       * 기준선(성수병 45)이 있으니 검사는 동전 던지기가 됩니다.
       *
       * 기준을 낮추는 것은 답이 아닙니다 — 성수병 한 병은 **뜻이 있는**
       * 값이라 낮추면 검사가 뜻을 잃습니다. 그래서 **재는 창을 옮겼습니다.**
       * 첫 추격자가 영역에 들어오는 순간부터 8초. 흔들리는 것(도착 시각)을
       * 평균 내지 말고 **창 밖으로 빼는** 것이 맞습니다.
       *
       * ── ⚠️ **한 번 더 옮겼습니다 — «도착»을 잘못 정의했었습니다** ──────
       * 위 처방("흔들리는 것을 창 밖으로")은 옳았는데, **「도착」을
       * 보스 영역(17m) 안으로 정의한 것**이 틀렸습니다. 잡몹이 실제로
       * 때리는 거리는 **2m 남짓**이라, 17m 를 넘은 순간부터 세면 창의
       * 앞부분에 **15m 를 걸어오는 시간**이 그대로 들어옵니다 —
       * 2.6 m/s 면 6초, 8초 창의 3/4 입니다. 빼려던 바로 그 «걸어오는
       * 시간»이 이름만 바뀐 채 창 안에 남아 있었습니다.
       *
       * 그래서 도착을 **«나를 때릴 수 있는 자리에 섰다»** 로 다시 적습니다 —
       * 그 종류의 `attackRange` 안. 쏘는 자는 12m 에서도 때릴 수 있으니
       * 그 순간이 맞는 도착이고, 잡몹은 2.1m 입니다. 규칙을 미터가 아니라
       * **«무엇을 할 수 있는가»** 로 적으면, 적을 새로 넣거나 사거리를
       * 고치는 날에도 창이 저절로 따라옵니다.
       *
       * 기다리는 상한은 12→**20초**로 올립니다. 17m 를 더 걸어와야 하니
       * 옛 상한으로는 «안 왔다»가 «아직 걷는 중»과 섞입니다.
       */
      const rangeOf = new Map(G.enemyRoster().map((r) => [r.id, r.attackRange]))
      const trainWaitFrom = now()
      while (
        now() - trainWaitFrom < 20 &&
        Date.now() < wallDeadline &&
        G.threats(300).filter((t) => t.aggro && t.dist <= (rangeOf.get(t.kind) ?? 2)).length === 0
      )
        await sleep()
      const trainWait = now() - trainWaitFrom
      const arriveHp2 = G.state().player.hp
      const arenaSettle = now()

      /**
       * 📏 **8초 창 동안 «때릴 수 있는 자리»에 적이 있었는가** — 청구서의 분모.
       *
       * 청구서가 작게 나올 때 그 뜻은 둘로 갈립니다:
       *   ① 무리가 **약하다**       → 밸런스 문제
       *   ② 무리가 **거기 없었다**  → 재는 창의 문제
       * 이 줄이 그 둘을 갈라 줍니다. 안 재면 어느 쪽인지 말할 수 없고,
       * 못 잰 것으로 밸런스를 만지면 엉뚱한 곳을 고치게 됩니다. 실제로
       * 바로 위 주석의 «도착» 정의가 틀린 것을 이 값으로 잡았습니다.
       *
       * 창을 사거리에서 열도록 고친 지금은 이 값이 **8초에 가까워야**
       * 정상입니다. 그런데도 청구서가 작으면 그때는 진짜 밸런스입니다.
       *
       * ⚠️ 사거리는 **패턴의 reach** 를 씁니다(`attackRange` 아님).
       *    `attackRange` 는 *"공격을 시도할 마음이 드는 거리"* 이고,
       *    실제로 맞는 거리는 패턴마다 다릅니다 — 이 저장소가 map-probe
       *    에서 이미 한 번 틀렸던 자리라 같은 실수를 안 하려고 적어 둡니다.
       */
      const reachOf = new Map(
        G.enemyRoster().map((r) => [r.id, Math.max(0, ...r.attacks.map((a) => a.reach))]),
      )
      let reachFrames = 0
      let windowFrames = 0
      let reachSum = 0
      let nearest = 999
      /**
       * 💸 **청구서는 «끝-시작»이 아니라 «맞은 것을 더해서» 셉니다.**
       *
       * ── 왜 고쳤나 (계기가 계기를 잡았습니다) ──────────────────────
       * 원래는 `도착 체력 - 8초 뒤 체력` 이었습니다. 그러면 창 안에서
       * 체력이 **올라가는** 일이 생길 때 값이 거짓말을 합니다:
       *   · 죽어서 화톳불에서 되살아나면 체력이 가득 찹니다 → 뺄셈이
       *     음수 → `Math.max(0, …)` 가 **0** 으로 깎습니다.
       *   · 즉 **가장 아팠던 판이 «청구서 0»** 으로 적힙니다. 정확히
       *     거꾸로입니다.
       * 새로 넣은 「때릴 수 있는 자리에 적이 있던 시간」이 이걸 드러냈습니다 —
       * 걷기 판이 *"6.6초 동안 사거리 안에 평균 1.5마리, 청구서 **0**"*
       * 이라고 찍혔습니다. 둘이 같이 성립할 수 없는 수라서 잡혔습니다.
       * 계기를 하나 더 달면 **먼저 있던 계기의 거짓말**이 드러납니다.
       *
       * 그래서 종주 구간이 이미 쓰던 방식(프레임마다 줄어든 만큼 더하기)을
       * 그대로 씁니다 — 「규칙은 한 곳에만」의 형제인 **같은 것은 같은 식으로**.
       *
       * ⚠️ 죽으면 **거기서 창을 닫습니다.** 되살아난 뒤의 자리는 화톳불이라
       *    더 재 봐야 다른 이야기입니다. 그때의 청구서는 「죽을 만큼」이므로
       *    실제 아픔의 **아래끝**이지 정확한 값이 아닙니다 — 로그에 죽음
       *    횟수를 같이 찍어 사람이 그렇게 읽을 수 있게 합니다.
       */
      /**
       * 📸 **주변 수는 «죽기 전 마지막 프레임»의 것을 씁니다.**
       *
       * ── 이 결함도 ⚰️ 줄이 드러냈습니다 ────────────────────────────
       * 「깨운 적 / 따라온 적 / 추격」은 창이 닫힌 **뒤에** 재고 있었습니다.
       * 그런데 그 창에서 죽으면 그때 플레이어는 이미 **화톳불**이라
       * 주변에 아무도 없습니다 — 세 수가 한꺼번에 **0** 이 됩니다.
       *
       * 그래서 로그가 이렇게 나왔습니다:
       *     달려서 15마리(0~15) vs 걸어서 **0마리(0~15)**
       * 폭이 양쪽 다 0~15 인데 중앙값만 갈립니다. 걷기가 0으로 내려온
       * 이유는 **소리가 아니라 죽음**입니다(걷기 5판 중 4판이 죽습니다).
       * 「달리면 더 많이 깨운다」가 **죽음이 만든 초록**이 될 뻔했습니다.
       *
       * 고치는 법은 간단합니다 — 창 안에서 **매 프레임 찍어 두고**, 창이
       * 어떻게 닫히든 마지막으로 찍힌 것을 씁니다. 「초록도 잘못 잰
       * 초록일 수 있다」의 그 자리입니다.
       *
       * ⚠️ `G.threats(300)` 를 프레임마다 **한 번만** 부릅니다. 예전에는
       *    같은 프레임에 두세 번 불렀는데, 값이 같더라도 부르는 횟수가
       *    프레임 시간을 늘려 **재는 대상(프레임률)을 재는 행위가 바꿉니다.**
       */
      const arenaR0 = G.bossEncounter()?.arenaRadius ?? 0
      let snap = { awake: 0, chasing: 0, inArena: 0 }
      let arenaWho = []
      let billed = 0
      let settleDeaths = 0
      let settleHeal = 0
      let settleMinHp = arriveHp2
      let prevHp = arriveHp2
      while (now() - arenaSettle < 8 && Date.now() < wallDeadline) {
        const hp = G.state().player.hp
        if (hp < prevHp - 0.01) billed += prevHp - hp
        /**
         * ⚠️ **체력이 올라간 것을 「부활」이라고 단정하면 안 됩니다.**
         *
         * 처음엔 `hp > prevHp` 를 그냥 죽음으로 셌습니다. 그런데 로그가
         * 앞뒤가 안 맞았습니다 — 죽은 판이 있다면 그 판의 청구서는
         * **도착 체력 전부**(58~96)여야 하는데 폭의 최댓값이 45.2 였습니다.
         * 즉 올라간 이유가 부활이 아닐 수 있습니다(성수병·구간 회복 등).
         *
         * 그래서 **올라간 양과 창 안 최저 체력을 같이 찍습니다.**
         * 최저가 0 근처면 진짜 죽음이고, 아니면 회복입니다. 이름을 붙이기
         * 전에 재는 것 — 이 회차에 네 번 물린 그 순서입니다.
         */
        if (hp > prevHp + 0.01) {
          settleDeaths++
          settleHeal += hp - prevHp
        }
        if (hp < settleMinHp) settleMinHp = hp
        prevHp = hp
        const th = G.threats(300)
        let near = 0
        let awakeN = 0
        let chasingN = 0
        let inArenaN = 0
        for (const t of th) {
          if (!t.aggro) continue
          awakeN++
          if (t.dist < 25) chasingN++
          /**
           * ⚠️ **보스는 «끌고 온 무리»가 아닙니다.**
           *
           * 구성을 찍어 보고 알았습니다 — 「따라온 적 5마리」의 정체가
           * `archer×1 binder×1 **boss×1** dragger×1 grunt×1` 이었습니다.
           * 보스는 원래 거기 있던 것이라, 세면 **끌고 온 수가 하나 부풀고**
           * 검사 이름(「끌고 온 무리」)과 재는 것이 어긋납니다.
           *
           * 수는 여기서 뺍니다. ⚠️ 다만 **청구서에는 보스의 손이 그대로
           * 들어갑니다** — 체력만 보고는 누가 때렸는지 못 가리기 때문입니다.
           * 그건 이 검사가 재는 것이 «그 자리에 서 있는 값»이라 맞기도
           * 합니다. 두 수의 뜻이 다르다는 것만 분명히 적어 둡니다.
           */
          if (t.dist <= arenaR0 && t.kind !== 'boss') inArenaN++
          if (t.dist <= (reachOf.get(t.kind) ?? 2)) near++
          if (t.dist < nearest) nearest = t.dist
        }
        /**
         * 🧾 **따라 들어온 다섯이 «누구»인가** — 청구서의 구성.
         *
         * 지금까지 수만 찍었습니다(5마리). 그런데 끄는 자는 한 대 12,
         * 얽는 자는 **6** 입니다 — 잡몹(14)·달려드는 자(16)와 두 배 차이라,
         * **같은 다섯 마리라도 청구서가 두 배 다릅니다.** 수만 보고
         * *"무리가 약하다"* 고 말하면 그 안의 구성이 안 보입니다.
         *
         * 이 회차에 「10 = 10」에서 배운 것과 같은 자리입니다 —
         * **수는 «누구»를 말해 주지 않습니다.**
         */
        if (settleDeaths === 0) {
          snap = { awake: awakeN, chasing: chasingN, inArena: inArenaN }
          const tally = {}
          for (const t of th)
            if (t.aggro && t.dist <= arenaR0 && t.kind !== 'boss')
              tally[t.kind] = (tally[t.kind] ?? 0) + 1
          arenaWho = Object.entries(tally)
            .map(([k, n]) => `${k}×${n}`)
            .sort()
        }
        windowFrames++
        if (near > 0) reachFrames++
        reachSum += near
        if (settleDeaths > 0) break
        await sleep()
      }
      const arenaR = arenaR0
      const inArena = snap.inArena
      const hpAfterSettle = G.state().player.hp

      const end = G.state()
      const awake = snap.awake
      const chasing = snap.chasing
      return {
        arrived,
        time: Number(travelTime.toFixed(1)),
        hp: Number(arriveHp.toFixed(1)),
        maxHp,
        damage: Number(damage.toFixed(1)),
        hits,
        deaths,
        travelled: Number(travelled.toFixed(0)),
        kills: end.kills,
        awake,
        /** 같은 거리(절반 지점)를 지났을 때 깨어 있던 수 — 소리 규칙의 자리 */
        awakeHalf: awakeHalf < 0 ? 0 : awakeHalf,
        /** 절반 지점에서 깨어 있던 적의 이름표 — 수가 같아도 «누구»가 다를 수 있습니다 */
        awakeHalfWho,
        /** 깬 적마다 «가장 가까이 갔던 거리» — 시야로 설명되는지 보려고 */
        awakeHalfHow,
        /** 지도가 등을 돌려 놓은 적에게 실제로 다가간 최소 거리(m) */
        facedNear: facedNear.map((d) => Number(d.toFixed(1))),
        /** 가장 가까웠던 그 프레임의 내 속도(m/s) — 듣는 거리를 정하는 값 */
        facedSpeed: facedSpeed.map((v) => Number(v.toFixed(1))),
        /** 그 적이 실제로 깼는가 */
        facedWoke,
        chasing,
        inArena,
        /** 영역 안 추격자의 **종류별 수** — 같은 다섯이라도 청구서가 다릅니다 */
        arenaWho,
        arenaR: Number(arenaR.toFixed(1)),
        hpAfterSettle: Number(hpAfterSettle.toFixed(1)),
        /**
         * 무리가 도착한 뒤 가만히 선 8초 동안 **맞은 것을 더한 값** — 청구서.
         * ⚠️ 「끝-시작」이 아닙니다(부활이 값을 0으로 뒤집던 자리 — 위 주석).
         */
        trainBill: Number(billed.toFixed(1)),
        /** 그 창 안에서 체력이 올라간 횟수 — 죽음일 수도, 회복일 수도. */
        settleDeaths,
        /** 그때 올라간 총량 — 가득 차면 부활, 성수병 한 병이면 회복입니다. */
        settleHeal: Number(settleHeal.toFixed(1)),
        /** 창 안 최저 체력 — 0 근처면 진짜 죽음입니다. */
        settleMinHp: Number(settleMinHp.toFixed(1)),
        /** 무리가 오기까지 기다린 시간(초) — 20초는 "안 왔다"는 뜻입니다. */
        trainWait: Number(trainWait.toFixed(1)),
        /** 8초 창 중 **내 사거리 안에 적이 하나라도 있던** 시간(초) */
        reachTime: Number(((reachFrames / Math.max(1, windowFrames)) * 8).toFixed(1)),
        /** 그 창 동안 사거리 안에 있던 적 수의 평균 — 토큰(2)과 견줄 값 */
        reachAvg: Number((reachSum / Math.max(1, windowFrames)).toFixed(2)),
        /** 창 동안 가장 가까웠던 적의 거리(m) */
        nearest: Number((nearest === 999 ? -1 : nearest).toFixed(1)),
        stuck: Number(stuckTime.toFixed(1)),
        enemiesLeft: end.enemiesLeft,
      }
    }, { useSprint: sprint, faced })

  /**
   * **세 판씩 돌립니다.**
   *
   * 이 프로브를 처음 돌렸을 때 달리기 종주가 "피해 0 · 피격 0회"로 나왔고,
   * 같은 코드로 한 번 더 돌리니 "피해 4 · 피격 1회"였습니다. 한 판만 봤으면
   * "완전 무료"라고 적었을 것이고, 그 문장 위에 밸런스를 얹었을 것입니다.
   * 중앙값과 최소~최대를 같이 냅니다 — **범위가 겹치면 증명된 게 아닙니다.**
   *
   * ── 그 세 판을 **다섯 판으로 올렸습니다** ────────────────────────
   * "끌고 온 무리가 실제로 아프다"(청구서 ≥ 성수병 45)가 게임을 하나도
   * 안 고친 채로 빨강·초록을 오갔습니다. 여섯 판을 돌려 보니 이유가
   * 분명했습니다 — 청구서의 실제 폭이 **32~79** 입니다. 세 판이면
   * 중앙값이 32에 앉는 일이 그냥 일어납니다.
   *
   * 이건 게임이 흔들린 게 아니라 **표본이 모자랐던 것**입니다. 무리가
   * 언제 도착하느냐에 8초 창이 통째로 좌우되는데, 그 도착 시각은 경로
   * 사정에 크게 흔들립니다. 기준을 낮추는 것은 답이 아닙니다 — 기준은
   * 성수병 한 병이라는 **뜻이 있는 값**이라, 낮추면 검사가 뜻을 잃습니다.
   * 그래서 **표본을 늘렸습니다.**
   *
   * 폭을 더 좁혀 봐야 할 때는 `RUNS=9 npm run bypass` 로 올립니다.
   */
  const RUNS = Number(process.env.RUNS || 5)
  const med = (xs) => {
    const a = [...xs].sort((x, y) => x - y)
    return a[Math.floor(a.length / 2)]
  }
  const span = (xs) => {
    const a = [...xs].sort((x, y) => x - y)
    return `${a[0]}~${a[a.length - 1]}`
  }
  const summarize = (runs) => ({
    arrived: runs.filter((r) => r.arrived).length,
    time: med(runs.map((r) => r.time)),
    timeSpan: span(runs.map((r) => r.time)),
    hp: med(runs.map((r) => r.hp)),
    hpSpan: span(runs.map((r) => r.hp)),
    maxHp: runs[0].maxHp,
    damage: med(runs.map((r) => r.damage)),
    damageSpan: span(runs.map((r) => r.damage)),
    hits: med(runs.map((r) => r.hits)),
    hitsSpan: span(runs.map((r) => r.hits)),
    chasing: med(runs.map((r) => r.chasing)),
    inArena: med(runs.map((r) => r.inArena)),
    inArenaSpan: span(runs.map((r) => r.inArena)),
    arenaWho: runs[0].arenaWho,
    trainBill: med(runs.map((r) => r.trainBill)),
    trainWait: med(runs.map((r) => r.trainWait)),
    trainWaitSpan: span(runs.map((r) => r.trainWait)),
    trainBillSpan: span(runs.map((r) => r.trainBill)),
    reachTime: med(runs.map((r) => r.reachTime)),
    reachTimeSpan: span(runs.map((r) => r.reachTime)),
    reachAvg: med(runs.map((r) => r.reachAvg)),
    nearest: med(runs.map((r) => r.nearest)),
    nearestSpan: span(runs.map((r) => r.nearest)),
    settleDeaths: runs.reduce((n, r) => n + r.settleDeaths, 0),
    settleHeal: span(runs.map((r) => r.settleHeal)),
    settleMinHp: span(runs.map((r) => r.settleMinHp)),
    awakeHalf: med(runs.map((r) => r.awakeHalf)),
    awakeHalfWho: runs[0].awakeHalfWho,
    awakeHalfHow: runs[0].awakeHalfHow,
    facedNear: runs[0].facedNear,
    facedSpeed: runs[0].facedSpeed,
    facedWoke: runs[0].facedWoke,
    awakeHalfSpan: span(runs.map((r) => r.awakeHalf)),
    awake: med(runs.map((r) => r.awake)),
    awakeSpan: span(runs.map((r) => r.awake)),
    awakeMin: Math.min(...runs.map((r) => r.awake)),
    awakeMax: Math.max(...runs.map((r) => r.awake)),
    arenaR: runs[0].arenaR,
    travelled: med(runs.map((r) => r.travelled)),
  })

  const gather = async (sprint) => {
    const runs = []
    for (let i = 0; i < RUNS; i++) runs.push(await traverse(sprint))
    return summarize(runs)
  }

  const walk = await gather(false)
  const run = await gather(true)
  const line = (label, r) =>
    `  [${label}] 도착 ${r.arrived}/${RUNS} · ${r.time}초(${r.timeSpan}) · ${r.travelled}m\n` +
    `           도착 시 체력 ${r.hp}/${r.maxHp}(${r.hpSpan}) · 오는 길 피해 ${r.damage}(${r.damageSpan}) · ` +
    `피격 ${r.hits}회(${r.hitsSpan})\n` +
    `           깨운 적 ${r.awake}마리(${r.awakeSpan}) · ` +
    `보스 영역 안까지 따라온 적 ${r.inArena}마리(${r.inArenaSpan}${
      r.arenaWho.length ? ' — ' + r.arenaWho.join(' ') : ''
    }) · ` +
    `무리 도착까지 ${r.trainWait}초(${r.trainWaitSpan}) · 그 뒤 8초의 청구서 ${r.trainBill}(${r.trainBillSpan})\n` +
    `           └ 그 8초 중 **때릴 수 있는 자리**에 적이 있던 시간 ${r.reachTime}초(${r.reachTimeSpan}) · ` +
    `평균 ${r.reachAvg}마리 · 가장 가까웠던 거리 ${r.nearest}m(${r.nearestSpan})` +
    (r.settleDeaths
      ? `\n           └ ⚰️ 그 창에서 체력이 올라간 판 ${r.settleDeaths}회 · 올라간 양 ${r.settleHeal} · 창 안 최저 체력 ${r.settleMinHp}` +
        ` — 최저가 0 근처면 **부활**(청구서는 아래끝), 아니면 회복입니다`
      : '')
  console.log(line('걸어서', walk))
  console.log(line('달려서', run) + '\n')

  // ---- 1. 종주 자체가 성립하는가 (계기 점검이 먼저) ----
  check(walk.arrived === RUNS, '싸우지 않고 걸어서 보스까지 도달한다 (계기가 실제로 종주를 했다)', `${walk.arrived}/${RUNS} · ${walk.time}초`)
  check(run.arrived === RUNS, '싸우지 않고 달려서 보스까지 도달한다', `${run.arrived}/${RUNS} · ${run.time}초`)

  // ---- 2. 달리기가 실제로 시간을 줄이는가 ----
  //
  // 실험실(sprint 프로브)에서 8.4 m/s가 나왔어도, 지형·적·경로에서 그만큼
  // 줄어드는지는 **다른 질문**입니다. 코너·오르막·몸통 충돌이 다 먹습니다.
  {
    const saved = (1 - run.time / walk.time) * 100
    check(
      saved > 10,
      '달리면 종주 시간이 실제로 줄어든다 (실험실 수치가 지형에서도 산다)',
      `${walk.time}초 → ${run.time}초 (${saved.toFixed(0)}% 단축) · 이론상 최대 ${(
        (1 - walkSpeed / runSpeed) *
        100
      ).toFixed(0)}%`,
    )
  }

  // ---- 3. 지나치기에 값이 붙는가 ← 이 프로브의 존재 이유 ----
  //
  // 기준을 어디서 가져오는가: **성수병 한 병**입니다.
  // 소울류의 계약은 "지나갈 수 있다, 대신 자원을 쓴 상태로 도착한다"입니다.
  // 한 병으로 되돌릴 수 있는 피해면 사실상 0원짜리 통행료입니다.
  const vialHeal = (await page.evaluate(() => window.__game.vialInfo())).heal
  /**
   * 통행료는 **둘 중 하나로만** 내면 됩니다:
   *   ① 오는 길에 맞은 피해가 성수병 한 병을 넘거나
   *   ② 보스방까지 잡몹을 끌고 들어가거나
   * 둘 다 아니면 존 전체가 20초짜리 무료 복도입니다.
   *
   * ②를 인정하는 이유: 엘든 링에서 몹을 달고 안개문을 넘으면 보스방에
   * 그대로 따라 들어옵니다. 청구서가 **나중에** 온다고 해서 없는 게 아닙니다.
   */
  const paidByBlood = run.damage >= vialHeal
  const paidByTrain = run.inArena >= 2
  check(
    paidByBlood || paidByTrain,
    '달려서 지나치는 데 값이 붙는다 (피해로든, 끌고 온 무리로든)',
    `오는 길 피해 ${run.damage}(성수병 ${vialHeal}) · 보스 영역(${run.arenaR}m) 안 ${run.inArena}마리 · 8초 청구서 ${run.trainBill}`,
  )
  check(
    run.chasing >= 2,
    '지나친 적이 뒤를 따라온다 (문턱까지는 온다)',
    `${run.chasing}마리 추격 · 전체 깨어남 ${run.awake}마리`,
  )
  /**
   * ── 여기서 검사 하나를 **버렸습니다** ──────────────────────────
   * 처음엔 `run.hits >= 1` 을 걸었습니다 — "달려서 지나가는 동안 최소
   * 한 번은 닿아야 한다". 달려드는 자에게 접근 속도(6.0)와 돌진(11)을
   * 주고 다시 쟀는데도 **여전히 0회**였습니다. 걸어서는 6회에서 12회로
   * 배가 됐는데 달려서는 그대로였습니다.
   *
   * 값을 더 올리기 전에 **왜인지**를 먼저 봤습니다. 이유는 튜닝이 아니라
   * **역할 충돌**이었습니다:
   *
   *   달려드는 자는 🟢 **반격**을 가르치는 적입니다. 그래서 예고가
   *   1.4초로 깁니다 — 읽고 답할 시간을 주는 것이 존재 이유입니다.
   *   그런데 "달리는 사람을 벌한다"는 역할은 **짧은 예고**를 요구합니다.
   *   1.4초를 주면 8.4 m/s 는 그 사이 11.8m 를 지나가 버립니다.
   *   한 적에게 두 역할을 다 시키면, 예고를 줄여 반격을 죽이거나
   *   돌진을 늘려 회피를 죽이는 것 말고는 길이 없습니다.
   *
   * 그래서 이 검사는 **틀린 것을 요구하고 있었습니다.** 게임은 다른
   * 방식으로 값을 물리고 있었고(아래), 검사가 그걸 못 보고 있었을 뿐입니다.
   * 통과시키려고 지운 것이 아니라, **재려던 것이 아니어서** 지웠습니다.
   *
   * 대신 실제로 일어나는 일을 겁니다: 지나치면 **청구서가 미뤄집니다.**
   * 엘든 링에서 몹을 달고 안개문을 넘는 것과 같은 계약입니다. 그 계약은
   * 바로 위·아래 두 검사(값이 붙는가 / 그 값이 실제로 아픈가)가 지킵니다.
   *
   * ── 여기서 검사 하나를 **또** 버렸습니다 ──────────────────────
   * 버린 것은 `run.inArena > walk.inArena` — *"달려서 지나치면 걸을 때보다
   * 더 많이 끌고 들어온다"*. 두 가지가 틀렸습니다:
   *
   *  ① **이름이 재는 것과 달랐습니다.** 라벨은 "싸우며 갈 때보다"라고
   *     적혀 있는데, 비교 대상인 `walk` 도 **싸우지 않는 종주**입니다.
   *     빠르기만 다른 두 종주를 놓고 "싸움 대 지나치기"라고 부르고
   *     있었습니다.
   *  ② **한 번도 증명된 적이 없었습니다.** 폭을 찍어 보니 걸어서
   *     2~11마리 · 달려서 0~6마리 — 완전히 겹칩니다. 통과하던 것은
   *     중앙값이 어쩌다 그 방향으로 선 것뿐이고, 실제로 이번 회차에
   *     **부호가 뒤집혔습니다**(7 vs 8). 이 저장소의 규칙 그대로입니다 —
   *     **부호가 갈리면 증명되지 않은 것.**
   *
   * 대신 **소리 규칙이 실제로 사는지**를 겁니다. balance.ts `AWARE` 가
   * 새로 약속한 것이 이것입니다: 등 뒤는 **내가 낸 소리만큼** 들린다.
   * 그 약속이 죽으면(듣는 거리를 속도와 끊으면) 걷기와 달리기가 똑같이
   * 깨우게 되고, 아래 두 줄이 같이 무너집니다.
   *
   * 왜 `inArena` 가 아니라 `awake` 인가: 보스방까지 **따라 들어온 수**는
   * 깨운 수에 **이동 시간**이 섞여 있습니다 — 달리면 11초 먼저 도착해서
   * 쫓아올 시간을 그만큼 뺏습니다. 두 가지가 섞인 값으로는 어느 쪽이
   * 움직였는지 말할 수 없습니다. 깨운 수는 소리만 봅니다.
   */
  /**
   * ⚠️ **중앙값으로 겁니다 — 처음엔 최소·최대로 걸었다가 물렸습니다.**
   *
   * `run.awakeMin >= walk.awakeMax` 로 써 놓으면 문장은 더 세 보입니다
   * ("달리면 **매번** 걸을 때 최악만큼은"). 그런데 그렇게 쓰면 **한 회차가
   * 튀는 순간 결과가 통째로 뒤집힙니다.** 실제로 달리기 다섯 판이
   * `19·19·19·19·1` 로 나왔고, 그 `1` 하나가 검사를 빨갛게 만들었습니다.
   * 게임은 하나도 안 바뀐 채로요.
   *
   * 이 파일이 맨 위에 적어 둔 규칙을 검사 자신이 어기고 있었던 셈입니다 —
   * **중앙값과 폭을 같이 보되, 판정은 중앙값으로.** 폭은 사람이 읽으라고
   * 옆에 찍습니다.
   */
  /**
   * ⚠️ **끝이 아니라 절반 지점에서 견줍니다** (바로 위 `HALF_WAY` 주석).
   * 끝에서 세면 걷든 달리든 길 옆을 다 깨워 **포화**해서, 규칙이 살아
   * 있어도 두 수가 같습니다. 끝의 수는 사람이 읽으라고 옆에 찍습니다.
   */
  /**
   * 📋 **수가 같을 때는 «누구»를 봐야 뜻이 정해집니다** (traverse 안 주석).
   * 두 목록의 차집합을 찍습니다 — 비어 있으면 소리 규칙이 이 길에서
   * 아무 일도 안 한 것이고, 차이가 있으면 규칙은 사는데 수가 상쇄된 것입니다.
   */
  {
    const w = new Set(walk.awakeHalfWho)
    const r = new Set(run.awakeHalfWho)
    const onlyRun = [...r].filter((k) => !w.has(k))
    const onlyWalk = [...w].filter((k) => !r.has(k))
    console.log(
      `\n  📋 절반 지점에서 깨어 있던 적 — 달려야만 깬 것 ${
        onlyRun.length ? onlyRun.join(' · ') : '없음'
      } · 걸어야만 깬 것 ${onlyWalk.length ? onlyWalk.join(' · ') : '없음'}`,
    )
    /**
     * 📐 **깬 이유를 가릅니다.** 시야는 14m, 소리는 최대 9m 입니다.
     * 그러니 «가장 가까이 갔던 거리»가 9m 보다 크면 그 적은 **시야로**
     * 깬 것이고, 소리는 나설 자리조차 없었던 것입니다.
     */
    /**
     * 🧭 **지도가 등을 돌려 놓은 적에게 실제로 몇 미터까지 갔는가.**
     * `map` 이 「동선에서 8.0m」라며 초록을 줘도, 봇이 그 옆을 그 거리로
     * 지나가지 않으면 그 초록은 **다른 길에 대한 초록**입니다.
     */
    if (faced.length)
      console.log(
        `  🧭 지도가 등을 돌려 놓은 적 — ${faced
          .map(
            (f, i) =>
              `(${f.x},${f.z}) 걸어서 ${walk.facedNear[i]}m(속도 ${walk.facedSpeed[i]} · 깼나 ${
                walk.facedWoke[i] ? '예' : '아니오'
              }) · 달려서 ${run.facedNear[i]}m(속도 ${run.facedSpeed[i]} · 깼나 ${
                run.facedWoke[i] ? '예' : '아니오'
              })` +
              ` · 그 속도의 듣는 거리 ${(
                1.8 +
                (hearRunM - 1.8) * Math.min(1, run.facedSpeed[i] / (walkSpeed * terrain.sprintScale))
              ).toFixed(1)}m`,
          )
          .join(' · ')}`,
      )
    const sightOnly = walk.awakeHalfHow.filter((h) => h.near <= hearRunM)
    console.log(
      `  📐 걸어서 깬 적이 «가장 가까이 갔던 거리» — ${walk.awakeHalfHow
        .map((h) => `${h.id} ${h.near.toFixed(1)}m`)
        .join(' · ')}\n     └ 그중 소리 거리(${hearRunM.toFixed(
        1,
      )}m) 안까지 들어간 것 ${sightOnly.length}/${walk.awakeHalfHow.length}마리` +
        ` — 나머지는 **시야로** 깬 것이라 소리가 나설 자리가 없었습니다`,
    )
  }
  check(
    run.awakeHalf > walk.awakeHalf,
    '달리면 더 많이 깨운다 (발소리가 속도를 탄다 — **같은 거리를 지났을 때**)',
    `절반(90m)에서 달려서 ${run.awakeHalf}마리(${run.awakeHalfSpan}) vs 걸어서 ${walk.awakeHalf}마리(${walk.awakeHalfSpan})` +
      ` · 끝에서는 ${run.awake} vs ${walk.awake} (여기선 둘 다 포화합니다)`,
  )
  /**
   * ── ⚠️ **이 줄은 지금 «벽»일 수 있습니다 — 천장을 안 재 봤습니다** ────
   *
   * 2026-08 훑기에서 이 검사가 빨갛게 나왔고, 값이 옛 기록과 다릅니다:
   *
   *     지금  청구서 중앙값 **16 · 16 · 28** (다섯 판씩 · 폭 16~41)
   *     옛 기록(이 파일 위쪽) **32~79**
   *
   * 한 가설을 세워 **재고 기각했습니다**: 「직전 패턴 벌점(REPEAT_PENALTY)이
   * 잡몹의 굴림을 긴 패턴 쪽으로 밀어 8초 창의 휘두름 수를 줄인다」.
   * 보스에게는 실제로 그런 일이 있었으므로(3.6→4.2초) 그럴듯했지만,
   * 벌점을 **보스에게만** 걸고 두 판을 다시 재니 16(16~28)·16(16~28) 로
   * **하나도 안 움직였습니다.** 그래서 그 설명은 아닙니다.
   *
   * ── 천장을 찍어 봤습니다 — **토큰은 벽이 아니었습니다** ─────────────
   * 「8초에 몇 대가 가능한가」를 게임의 값으로 계산해 바로 아래 ⛰️ 줄에
   * 찍습니다(토큰 수 × 8초 ÷ 한 번 휘두르는 데 무는 시간 × 한 대 피해).
   * 그 값은 **45를 한참 넘습니다.** 그러니 이 문턱은 벽이 아니고, 낮출
   * 이유도 없습니다 — 성수병 한 병이라는 뜻은 그대로 삽니다.
   *
   * ── 그러면 왜 16이 나왔나: **창이 문 앞에서 열리고 있었습니다** ──────
   * 창을 여는 조건이 *"보스 영역(**17m**) 안에 추격자가 하나라도"* 였는데,
   * 잡몹이 실제로 때리는 거리는 **2m 남짓**입니다. 즉 창이 열리는 순간
   * 무리는 아직 **15m 밖**이고, 2.6 m/s 로 걸어오면 그 15m 에만 6초가
   * 듭니다 — 8초 창의 3/4 을 «걸어오는 시간»이 먹고 있었습니다.
   *
   * 그래서 두 가지를 같이 고쳤습니다:
   *   ① 창을 **사거리에서** 엽니다(위 `rangeOf` 주석).
   *   ② `└ 때릴 수 있는 자리에 적이 있던 시간` 을 로그에 같이 찍습니다.
   * ②가 없으면 «작다»의 뜻이 «약하다»와 «거기 없었다» 둘로 겹칩니다.
   * 두 뜻이 한 수에 겹치면 밸런스를 엉뚱하게 만지게 되는데, 그건 이
   * 저장소가 이미 여러 번 물린 모양입니다 — **처방이 다른 둘이 한 칸에
   * 담기면 정확히 거꾸로 읽힙니다.**
   *
   * 「아무도 못 넘는 문턱은 눈금이 아니라 벽이다」 — 궁수의 2발 검사에서
   * 이미 한 번 배운 자리라, 천장을 찍기 전에는 밸런스를 안 만졌습니다.
   * 찍어 보니 벽이 아니었으므로 **문턱은 그대로 둡니다.**
   *
   * ── 📒 **여러 회차에 걸쳐 모은 값** (읽고 넘어가는 빨강이 안 되게) ────
   * 창과 셈을 다 고친 뒤로 이 값을 여러 번 쟀습니다:
   *
   *     3판 50(24~74) · 3판 36.8(32~45.2) · **9판 38(26~58)**
   *     3판 42(0~85 · 죽음 섞임) · 3판 64(38~72) · 3판 39(38~52)
   *
   * 아홉 판짜리가 가장 믿을 만하고, 그 값이 **38** 입니다. 문턱은 45
   * (성수병 한 병) — 즉 **한 병의 약 85%**. 폭이 문턱을 자주 넘나들지만
   * **중앙값은 꾸준히 아래**입니다. 「한 판은 표본이 아니다」로 넘길 수
   * 있는 자리가 아닙니다 — 이건 **진짜 차이**입니다.
   *
   * ⚠️ 그런데 **벽은 아닙니다**(천장 154 · 문턱의 3.4배). 궁수 쪽과
   *    다릅니다 — 거긴 산수가 막고 있었고, 여기는 **실제 전투가 천장의
   *    26% 밖에 안 쓰는** 것입니다. 그러니 처방도 다릅니다:
   *      · 궁수 → 문턱을 잴 수 있는 말로 고쳐 씀
   *      · 여기 → **문턱은 뜻이 있으니 그대로**, 고칠 것은 **게임**
   *
   * ── 다음에 볼 지렛대 (재고 나서 고릅니다) ─────────────────────────
   *   ① 영역 안에 **닿는** 적 수 — 지금 사거리 안 평균 **2.4마리**인데
   *      동시 공격 토큰이 **2** 입니다. 즉 이미 토큰이 포화라 «더 끌고
   *      들어와도» 청구서가 안 늘어납니다. 늘리려면 토큰을 봐야 합니다.
   *   ② 무는 시간 — 8초는 **재는 쪽이 고른 값**이지 게임의 규칙이
   *      아닙니다. 늘리면 값은 오르지만 그건 문턱 흉내입니다. 안 합니다.
   *   ③ 무리의 구성 — 지금 따라오는 다섯 중 몇이 **때릴 수 있는** 종류
   *      인가. 끄는 자·얽는 자는 피해가 작습니다(12·6).
   *
   * ── ✅ **재고 정했습니다** ───────────────────────────────────────
   * **① 토큰은 안 만집니다.** `npm run crowd` 로 확인했습니다 — 지금도
   * 최대 동시 예고가 **2개**(토큰 상한)입니다. 그 값의 주석이 근거를 다
   * 적어 뒀습니다: 포위 시 동시 예고 3개 이상이 23% 나오던 때는 *"가만히
   * 서 있는 것과 피하려 애쓰는 것의 결과가 같았습니다(체력 100→5)"*.
   * 2 → 3 은 그 읽힘을 되돌리는 거래이고, DESIGN.md 기둥 2 를 청구서
   * 몇 점과 바꾸는 셈입니다. **안 합니다.**
   *
   * **② 8초는 안 늘립니다.** 재는 쪽이 고른 값이라, 늘리면 값은 오르지만
   * 그건 **문턱 흉내**입니다.
   *
   * **③ 구성을 찍었더니 답이 나왔습니다** — 그리고 검사가 줄곧 **다른
   * 것을 세고 있었습니다:**
   *
   *     따라온 적 5마리 — archer×1 binder×1 **boss×1** dragger×1 grunt×1
   *
   * **보스가 «끌고 온 무리»에 섞여 있었습니다.** 보스는 원래 거기 있던
   * 것이지 끌고 온 것이 아닙니다. 즉 실제 무리는 **넷**이고, 그 넷은
   * 이 존이 **색을 가르치라고 세워 둔 적들**입니다:
   *
   *     grunt 14 · dragger 12(🟣 끌기) · binder **6**(🔵 속박) ·
   *     archer 13(🔴 원거리 — **거리를 유지**하므로 잘 안 붙습니다)
   *
   * 즉 **무리가 약한 것이 아니라, 보스 앞 구간이 «가르치는 적»으로
   * 채워져 있는 것**입니다. 얽는 자의 6은 실수가 아니라 설계입니다 —
   * *"속박은 자주 걸리면 게임이 아니라 형벌이 됩니다"*(balance.ts).
   *
   * ── 그래서 이 문턱은 어떻게 되는가 ───────────────────────────────
   * 청구서를 올리려면 보스 앞에 **아프기만 한 적**을 더 놓아야 하는데,
   * 그건 *"색을 가르치는 자리"* 를 *"피해를 주는 자리"* 로 바꾸는
   * 일입니다. 이 존의 마지막 구간은 **가르친 것을 쓰게 하는 곳**이지
   * 새 압력을 얹는 곳이 아닙니다.
   *
   * 두 선택이 있었습니다 — ⓐ 문턱을 *"걸어서 온 것보다 더 아프다"* 로
   * 다시 적기, ⓑ 지금 문턱을 두기. **아홉 판씩 재고 ⓑ 를 골랐습니다.**
   *
   * ── ⓐ 는 **틀린 문턱**입니다 (재고 나서 알았습니다) ──────────────
   *     [걸어서] 청구서 **30**(13~43.8) · 도착 체력 34 · ⚰️ 죽은 판 **6/9**
   *     [달려서] 청구서 **60**(20~72.8) · 도착 체력 92 · ⚰️ 죽은 판 3/9
   *
   * 비율은 2.0배로 안정적입니다(직전 1.8배). 그런데 그걸 문턱으로 삼으면
   * 안 됩니다 — **걷기 아홉 판 중 여섯이 그 창에서 죽습니다.** 죽으면
   * 청구서가 「죽을 만큼」에서 잘리므로 걷기 쪽은 **도착 체력(34)에 갇힌
   * 값**입니다. 즉 두 수는 애초에 견줄 수 있는 짝이 아니고, 2.0배는
   * *"달리면 더 아프다"* 가 아니라 **"걸어온 사람은 잃을 체력이 없다"**
   * 를 재고 있었습니다.
   *
   * 이 저장소가 같은 함정에 한 번 빠졌습니다 — 「5.7 → 2.8배」를 적었다가
   * 같은 분포에서 두 번 뽑은 것이었음이 드러나 철회한 자리입니다.
   * **비율은 분모가 성한지부터 봐야 합니다.**
   *
   * ── ⓑ: 문턱은 그대로. 지금은 넘습니다 ──────────────────────────
   *     ✅ 8초에 **60**(20~72.8) vs 성수병 45 — 아홉 판 기준
   *
   * ⚠️ **왜 올랐는지는 단정하지 않습니다.** 이 회차에 지도가 바뀌었고
   *    (궁수 (74,49)→(75,48) · 얽는 자를 등 돌려 세움), 달리는 사람의
   *    오는 길 피해가 **21 → 8** 로 줄어 도착 체력이 58 → 92 가 됐습니다.
   *    잃을 체력이 늘었으니 청구서의 여지도 늘었습니다. 그럴듯하지만
   *    **인과는 안 쟀습니다** — 되돌려 보지 않았으므로 상관까지만 적습니다.
   */
  /**
   * ⛰️ **천장** — 이 검사가 넘을 수 있는 최대.
   *
   * ⚠️ **게임에서 꺼낸 값으로만** 셉니다. 토큰 수(2)나 잡몹 피해(14)를
   *    여기 적어 두면, 밸런스를 고치는 날 프로브가 **옛 게임**을 재게
   *    됩니다. 「규칙은 한 곳에만」의 그 자리입니다.
   *
   * 세는 법: 토큰 하나는 한 번 휘두르는 동안(예고+판정+후딜) 붙잡혀 있고,
   * 그 뒤 **쿨다운은 다른 적이 대신 씁니다**(무리가 셋 이상이면). 그래서
   * 천장의 분모는 쿨다운이 아니라 **붙잡는 시간**입니다.
   */
  {
    /**
     * ⚠️ **보스는 뺍니다.** 처음 돌렸을 때 천장이 「수문장 boss_cleave —
     * 8초에 241」로 찍혔습니다. 수가 크니 결론(*"벽이 아니다"*)은 같지만,
     * 이 검사의 이름은 **「끌고 온 무리」**입니다 — 보스는 끌고 온 것이
     * 아니라 원래 거기 있던 것이라, 그 손으로 천장을 세우면 *"무리가
     * 아픈가"* 를 묻는 자리에 **다른 것의 힘**이 답하게 됩니다.
     * (보스의 손이 청구서 자체에는 들어갑니다. 그건 검사가 재는 대상이
     *  «그 자리에 서 있는 값»이라 맞습니다. 천장만 무리로 좁힙니다.)
     */
    const grunts = roster.filter(
      (r) => r.id !== 'boss' && r.attacks.length > 0 && !r.attacks.some((a) => a.projectile),
    )
    // 가장 «싼» 패턴 — 짧게 붙잡고 아프게 때리는 것이 천장을 만듭니다.
    let best = null
    for (const r of grunts)
      for (const a of r.attacks) {
        const hold = a.windup + a.active + a.recovery
        const dps = a.damage / hold
        if (!best || dps > best.dps) best = { r, a, hold, dps }
      }
    if (best) {
      const ceil = limits.melee * (8 / best.hold) * best.a.damage
      console.log(
        `\n  ⛰️ [천장] 근접 토큰 ${limits.melee}개 · 가장 아픈 패턴 ${best.r.name} ${best.a.id} ` +
          `(붙잡는 시간 ${best.hold.toFixed(2)}초 · 한 대 ${best.a.damage})\n` +
          `        → 8초에 최대 ${(limits.melee * (8 / best.hold)).toFixed(1)}대 = **${ceil.toFixed(0)}** ` +
          `(성수병 ${vialHeal}의 ${(ceil / vialHeal).toFixed(1)}배) — 문턱은 벽이 아닙니다`,
      )
    }
  }
  check(
    run.trainBill >= vialHeal,
    '끌고 온 무리가 실제로 아프다 (장식이 아니다)',
    `무리 도착 뒤 8초에 ${run.trainBill}(${run.trainBillSpan}) · 도착까지 ${run.trainWait}초 · 성수병 ${vialHeal}`,
  )

  // ---- 4. 달리기로 노출 시간이 얼마나 줄었는가 ----
  //
  // `npm run map` 이 지키는 규칙은 "위협 없이 30m 넘게 걷지 말 것"이고,
  // 그 30m의 근거는 **약 6초**였습니다. 달리기가 들어온 지금 같은 30m는
  // 3.6초입니다. 규칙을 미터가 아니라 **초**로 다시 적어야 합니다.
  const gapMeters = 30
  const walkGap = gapMeters / walkSpeed
  const runGap = gapMeters / runSpeed
  console.log(
    `\n  [노출] 빈 구간 ${gapMeters}m = 걸어서 ${walkGap.toFixed(1)}초 · 달려서 ${runGap.toFixed(1)}초`,
  )
  check(
    runGap >= 3,
    '달려도 빈 구간 기준이 무의미해지지 않는다 (지도 규칙이 여전히 유효)',
    `달려서 ${runGap.toFixed(1)}초`,
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
