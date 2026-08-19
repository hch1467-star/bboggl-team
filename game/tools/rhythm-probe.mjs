/**
 * 🥁 보스는 **몇 초에 한 번 휘두르는가** — `npm run rhythm`
 *
 * ── 왜 이 실험대가 생겼는가 ────────────────────────────────────────
 * 보스의 박자를 고치려고 세 번 손을 댔는데, 판정을 자동 플레이 **한 판**으로
 * 하고 있었습니다. 그 한 판이 이렇게 흔들립니다:
 *
 *     5.3초에 한 번 · 7.5초에 한 번 · 10.2초에 한 번
 *     받은 피해 22 · 0 · 0        (같은 코드, 다른 판)
 *
 * 존을 걸어온 상태가 통째로 섞이기 때문입니다 — 장비 등급, 강화, 성수병,
 * 오다가 죽었는지, 어느 길로 왔는지. **소음에 자를 대고 있었습니다.**
 * 이 저장소가 `npm run pace` 를 만들 때 이미 적어 둔 그대로입니다.
 *
 * ── 무엇을 재는가 — **보스만 남기고 잽니다** ──────────────────────
 * 아레나에 보스 하나만 세우고, 플레이어는 **정해진 자리에 서 있기만**
 * 합니다. 그러면 남는 변수는 보스의 박자 하나뿐입니다.
 *
 *   ① 가만히 서 있을 때  — 보스가 **설계대로** 낼 수 있는 박자
 *   ② 계속 때릴 때        — 플레이어가 **지워 버리는** 만큼
 *
 * ①이 느리면 고칠 곳은 후딜·쿨다운·연계입니다. ①은 빠른데 ②가 느리면
 * 고칠 곳은 강인도 쪽입니다. **둘을 갈라 놓지 않으면 어느 쪽인지 모릅니다** —
 * 지금까지 제가 그걸 모른 채 양쪽을 번갈아 만졌습니다.
 *
 * ⏱ 시간은 벽시계가 아니라 **걸음 수**로 줍니다(`__game.step`) — 같은
 *    실험이 판마다 같은 길이가 되게(`npm run repro` 가 세워 준 바닥).
 * 🩹 플레이어는 **죽지 않게 붙들어 둡니다.** 죽으면 적 AI 가 멈춰서
 *    "안 휘두른다"가 됩니다(`npm run track` 이 그 함정에 한 번 빠졌습니다).
 * 📒 휘두름은 **판정 자리의 장부**로 셉니다(`systems/combat.ts`
 *    `swingRecords` — 한 번의 휘두름에 한 줄). 화면을 훑어 세면 프레임
 *    사이에 일어난 일을 놓칩니다.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5258
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))

const STEP_DT = 1 / 60
/** 한 모드당 재는 시뮬레이션 시간(초). 짧으면 한두 번의 우연이 결과가 됩니다. */
const SECONDS = 26

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
  const page = await browser.newPage({ viewport: { width: 480, height: 320 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?mode=arena&lowfx=1`)
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60000 })

  console.log('\n🥁 보스 박자 실험대 — **보스만 남기고** 잽니다\n')

  await page.evaluate(() => {
    window.__rhythm = ({ attacking, seconds, dt }) => {
      const G = window.__game
      G.setPaused(true)
      G.clearEnemies()
      const e = G.spawnBoss(0, 0)
      // 보스의 근접 사거리 안쪽에 섭니다 — 자리는 게임에게 묻습니다.
      const def = G.enemyRoster().find((r) => r.id === 'boss')
      /**
       * ⚠️ **내 무기 사거리 안에도 있어야** ②가 실제로 때리는 판이 됩니다.
       *    첫 판에서 ②의 보스 체력이 100% 로 나왔습니다 — 눌렀지만 닿지
       *    않았던 것이고, 그러면 ①과 ②는 같은 실험을 두 번 한 것입니다.
       */
      const wt = G.weaponTable()[0]
      const stand = Math.min((def?.attackRange ?? 3.4) * 0.8, (wt?.reach ?? 2.2) * 0.8)
      const hold = () => {
        // 넉백에 밀려나면 "사거리 밖이라 안 휘두른다"를 재게 됩니다.
        G.teleportPlayer(0, stand)
        // 보스를 겨눕니다 — 안 겨누면 엉뚱한 방향으로 휘두릅니다.
        G.aimAtWorld(0, 0)
        G.setHp(G.playerEntity(), 100)
      }
      hold()
      /**
       * ⚠️ **보스를 깨워 둡니다.**
       *
       * 첫 판에서 ①(가만히)이 *"12.7초에 한 번"*, ②(때릴 때)가 *"3.1초에
       * 한 번"* 으로 나왔습니다. 때릴수록 보스가 **네 배 자주** 휘두른다는
       * 뜻인데, 그럴 리가 없습니다.
       *
       * 원인은 박자가 아니라 **인지**였습니다 — 적은 보거나 **들어야**
       * 깨어납니다(enemyAI 의 `hearDistance(playerSpeed)`). 가만히 선
       * 플레이어는 소리를 안 내니, ①은 박자가 아니라 *"보스가 나를
       * 알아채는 데 걸린 시간"* 을 재고 있었습니다.
       *
       * 강제 공격을 한 번 걸어 깨웁니다(`forceAttack` 이 aggro 를 세웁니다).
       * 그 한 번은 예열분이라 아래에서 장부째 버립니다.
       */
      G.forceAttack(e, 0)
      G.step(120, dt, true)
      G.swings() // 예열분은 버립니다
      const frames = Math.round(seconds / dt)
      const t0 = G.state().simElapsed
      for (let i = 0; i < frames; i++) {
        hold()
        if (attacking) {
          G.press('Mouse0')
          G.release('Mouse0')
        }
        G.step(1, dt)
      }
      const elapsed = G.state().simElapsed - t0
      const rows = G.swings().filter((r) => String(r.attackId).startsWith('boss_'))
      const info = G.enemyInfo(e)
      G.clearEnemies()
      return {
        swings: rows.length,
        hits: rows.filter((r) => r.hit).length,
        elapsed: Number(elapsed.toFixed(2)),
        hpLeft: info ? Math.round((info.hp / info.max) * 100) : 0,
      }
    }
  })

  const still = await page.evaluate(
    async ([s, dt]) => window.__rhythm({ attacking: false, seconds: s, dt }),
    [SECONDS, STEP_DT],
  )
  const busy = await page.evaluate(
    async ([s, dt]) => window.__rhythm({ attacking: true, seconds: s, dt }),
    [SECONDS, STEP_DT],
  )
  const per = (r) => (r.swings > 0 ? r.elapsed / r.swings : Infinity)
  const say = (r) =>
    `${r.swings}회 / ${r.elapsed}초 = **${per(r) === Infinity ? '∞' : per(r).toFixed(1)}초에 한 번** · 적중 ${r.hits}회 · 보스 체력 ${r.hpLeft}%`
  console.log(`  ① 가만히 서 있을 때 — ${say(still)}`)
  console.log(`  ② 계속 때릴 때     — ${say(busy)}\n`)

  /**
   * 🚧 게이트 — 가만히 있을 때 **실제로 휘둘렀어야** 아래 비교가 뜻을 가집니다.
   *    0회를 "박자가 느리다"로 읽으면 고칠 곳을 영영 못 찾습니다.
   */
  check(still.swings >= 3, '🚧 가만히 서 있어도 보스가 휘둘렀다 (아래 비교의 게이트)', `${still.swings}회`)
  /**
   * 🥁 **설계대로 낼 수 있는 박자.**
   *
   * 4.0초를 문턱으로 둔 근거: 이 보스의 한 주기는 예고 0.78 + 판정 0.16 +
   * 후딜 1.05 + 쿨다운 1.05 ≈ **3.0초**입니다(balance.ts BOSS). 거기에
   * 자리를 잡는 시간까지 얹어 4.0초 — 그보다 느리면 설정값이 아니라
   * **다른 무엇**이 보스를 붙들고 있다는 뜻입니다.
   * (소울류 지역 보스의 체감 간격도 대체로 2~4초입니다.)
   */
  /**
   * ⚠️ 이 줄은 **지금 빨갛고, 그게 이번 라운드의 결론입니다.**
   *
   * 실측 5.1초 vs 설정값 3.0초 — 방해가 없는데도 한 주기마다 **2초가
   * 어디론가 갑니다.** 두 가설을 세웠고 둘 다 재서 버렸습니다:
   *
   *   ❌ 강인도 붕괴 때문 → ②(계속 때릴 때)가 6.2초로 ①과 큰 차이가
   *      없습니다. 때리지 않아도 느립니다.
   *   ❌ 전역 커밋 간격(`ATTACK_COMMIT_GAP` 0.4초) 때문 → 1:1 에서 안
   *      걸리게 고쳐 봤더니 결과가 **비트 단위로 같았습니다**(고정 걸음이라
   *      같으면 정말 같은 것입니다). 애초에 안 걸리고 있었습니다. 되돌렸습니다.
   *
   * 남은 후보는 토큰 발급 주기 · `Enemy.waitT` · `pickAttack` 이 사거리
   * 밴드 밖이라 null 을 돌려주는 경우입니다. **짐작으로 고치지 않습니다** —
   * 이 검사가 그 자리를 지키고 있고, `npm run rhythm` 이 그대로 재현합니다.
   */
  check(
    per(still) <= 4.0,
    '🥁 **방해가 없으면 4초에 한 번은 휘두른다** (한 주기 설정값이 3.0초입니다)',
    `${per(still) === Infinity ? '한 번도 안 휘두름' : `${per(still).toFixed(1)}초에 한 번`}`,
  )
  /**
   * 🥁 **때린다고 보스의 차례가 사라지면 안 됩니다.**
   *
   * 이 저장소는 같은 병을 두 번 앓았습니다 — *"맞으면 무조건 경직"* 시절에
   * 14초 동안 0회, 그리고 최근에 15.4초 동안 한 번. 강인도 붕괴는 **보상**
   * 이어야지 **봉쇄**여서는 안 됩니다.
   *
   * 2.5배: 계속 때리면 확실히 느려지되(그게 붕괴의 값어치입니다), 박자가
   * 통째로 사라지지는 않는 선입니다.
   */
  check(
    per(busy) <= per(still) * 2.5,
    '🥁 **계속 때려도 박자가 통째로 사라지지 않는다** (붕괴는 보상이지 봉쇄가 아닙니다)',
    `가만히 ${per(still).toFixed(1)}초 → 때릴 때 ${per(busy) === Infinity ? '∞' : per(busy).toFixed(1)}초 (${
      per(still) > 0 && per(busy) !== Infinity ? (per(busy) / per(still)).toFixed(2) : '∞'
    }배)`,
  )
  /**
   * 🚧 **때리는 쪽이 실제로 때렸어야** 위 비교가 성립합니다. 보스 체력이
   *    안 줄었으면 ②는 ①과 같은 실험을 두 번 한 것입니다.
   */
  check(busy.hpLeft < still.hpLeft - 5, '🚧 때리는 판에서 실제로 피해를 줬다 (두 판이 다른 실험이라는 근거)', `가만히 ${still.hpLeft}% · 때릴 때 ${busy.hpLeft}%`)
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | ') || '없음')
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 — 위 숫자는 완결된 것이 아닙니다.
  console.error(`\n💥 프로브가 도중에 죽었습니다 — 위 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`)
  fail++
} finally {
  await browser.close()
  await server.close()
}
process.exit(fail === 0 ? 0 : 1)
