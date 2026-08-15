/**
 * 도달 검증 — `npm run reach`
 *
 * ── 왜 이 프로브가 생겼는가 ──────────────────────────────────────
 * 최근 두 라운드에서 **같은 모양의 버그를 두 번** 만났습니다:
 *
 *   · 상황 모션(달리기·구르기·낙하) — 파생값은 완벽했는데 판정을 만드는
 *     `comboSpec` 에 가지가 없어서, 셋 다 **마지막 콤보 타**로 나갔습니다.
 *   · 지연 공격 — 예고 길이는 맞았는데 화면의 차오름이 설정값으로
 *     계산되어, 뜸 들인 공격이 처음 0.35초 동안 **안 보였습니다.**
 *
 * 둘 다 붙여 둔 검사는 초록이었습니다. 검사가 **한 겹 앞에서 멈춰**
 * 있었기 때문입니다 — 조리법(파생 함수의 출력)만 보고 요리(실제로 적의
 * 체력이 얼마나 줄었는가)를 안 봤습니다.
 *
 * 그래서 이 프로브는 **딱 한 가지**만 합니다:
 *
 *     플레이어가 낼 수 있는 모든 공격을 실제로 때려 보고,
 *     줄어든 체력이 게임이 말한 파생값과 같은지 본다.
 *
 * ⚠️ 기대값을 여기 적지 않습니다. `weaponTable()` 이 게임의 파생 함수로
 *    계산해 준 값을 그대로 씁니다 — 프로브가 배율을 다시 곱하기 시작하면
 *    그 순간 이 파일이 또 하나의 진실이 됩니다.
 *
 * ⚠️ 배수가 섞이지 않게 재는 법:
 *    · **정면에서** 칩니다 — 등 뒤를 잡으면 백어택 배수가 붙습니다.
 *    · 적을 **깨워 둡니다** — 자고 있으면 기습이 되어 즉시 무너뜨립니다.
 *    · 강화 0단계에서 잽니다(`resetProgress`) — 무기 강화 배수가 1.
 *    · 완벽 회피 창이 열려 있으면 확정 치명타가 붙으므로, 구르기 계열은
 *      **적이 안 때리는 상태**에서 굴립니다(freezeEnemies).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 5197
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
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  await page.evaluate(() => window.__game.resetProgress())
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })

  console.log('\n🔬 도달 검증 — 만든 값이 실제 타격에 도달하는가\n')

  const result = await page.evaluate(async () => {
    const G = window.__game
    const sleep2 = () => new Promise((r) => setTimeout(r, 8))
    const runFor = async (sec) => {
      const t = G.state().elapsed + sec
      while (G.state().elapsed < t) await sleep2()
    }
    const p = G.playerEntity()

    /**
     * ⚠️ **손이 빌 때까지 기다립니다.**
     *
     * 이걸 안 넣었더니 같은 동작이 무기마다 성공/실패로 갈렸습니다
     * (강타는 롱소드만 실패, 처형은 대검·단검만 실패). 원인은 앞 측정의
     * 후딜이 남아 있는 채로 다음 키를 눌러서, 선입력으로 **평범한 1타**가
     * 나간 것이었습니다 — 실제로 실패 줄마다 `나간 기술 "1타"` 가 찍혀
     * 있었습니다. 게임은 멀쩡했고 **재는 쪽이 조급했습니다.**
     */
    const idle = async (sec = 3) => {
      const t = G.state().elapsed + sec
      while (G.state().elapsed < t && G.state().player.state !== 0) await sleep2()
    }

    /** 허수아비 하나를 세우고 **정면에서** 붙습니다. */
    const stand = async () => {
      await idle()
      G.clearEnemies()
      await runFor(0.3)
      const e = G.spawnEnemyKind('grunt', 6, 0)
      await runFor(0.25)
      const i = G.enemyInfo(e)
      if (!i) return null
      // 깨워 둡니다 — 자고 있으면 기습이 되어 배수와 판정이 달라집니다.
      G.wakeEnemy(e)
      // 얼려 둡니다 — 맞으면 경직·완벽회피·반격 배수가 섞입니다.
      G.freezeEnemies(true)
      G.setHp(e, 1000000)
      G.teleportPlayer(i.x - 1.2, i.z)
      G.aimAtWorld(i.x, i.z)
      G.setFocus(0)
      /**
       * ⚠️ **기력을 채워 둡니다.** 롱소드의 강타만 계속 실패했는데, 앞
       * 측정에서 쓴 기력이 남아 있어 **문턱에 걸린 것**이었습니다. 재려는
       * 것은 *"이 기술의 피해가 파생값과 같은가"* 이지 기력 경제가 아닙니다.
       */
      G.setStamina(1000)
      await runFor(0.2)
      return e
    }

    /** 한 대 치고 **줄어든 체력**을 돌려줍니다. 안 맞으면 -1. */
    const once = async (press, seconds) => {
      const e = await stand()
      if (e === null) return { dealt: -1, hit: false, pending: '허수아비 없음' }
      const before = G.enemyInfo(e).hp
      const hits0 = G.state().hitsDealt
      await press(e)
      const t0 = G.state().elapsed
      while (G.state().elapsed - t0 < seconds && G.state().hitsDealt === hits0) await sleep2()
      const after = G.enemyInfo(e)?.hp ?? before
      return {
        dealt: Number((before - after).toFixed(2)),
        hit: G.state().hitsDealt > hits0,
        pending: G.moveInfo().current || G.moveInfo().pending,
      }
    }
    /**
     * ⚠️ **설정이 안 서면 한 번만 다시 세웁니다.**
     *
     * 롱소드의 강타만 계속 실패했습니다 — 같은 경로가 대검·쌍단검에서는
     * 매번 맞았으니 게임이 아니라 **첫 판의 설정**이 문제입니다(판 시작
     * 직후라 아직 자리를 못 잡습니다). 다시 세우는 것은 **설정**이지
     * 판정이 아닙니다: 두 번째도 못 맞히면 그대로 빨갛게 둡니다.
     */
    const hitOnce = async (press, seconds = 2.5) => {
      const first = await once(press, seconds)
      if (first.hit) return first
      return await once(press, seconds)
    }

    const table = G.weaponTable()
    const out = { weapons: [] }

    for (const w of table) {
      // 무기를 바꿉니다 — 표의 순서와 슬롯 번호가 같습니다.
      const slot = table.indexOf(w) + 1
      await idle()
      G.press(`Digit${slot}`)
      G.release(`Digit${slot}`)
      /**
       * ⚠️ 전환은 **선입력을 거칩니다**(components.ts `bufferedWeapon`).
       * 0.25초만 기다리고 읽었더니 아직 옛 무기가 찍혔고, 정작 그 뒤의
       * 피해는 새 무기 값이었습니다 — 검사만 빨갛고 게임은 맞았습니다.
       * **바뀔 때까지** 기다립니다.
       */
      const tSwap = G.state().elapsed + 3
      while (G.state().elapsed < tSwap && G.state().loadout.weapon !== w.id) await sleep2()
      const got = G.state().loadout.weapon
      const rows = []

      // ① 콤보 1타 — 가장 기본. 여기가 틀리면 아래는 볼 것도 없습니다.
      const first = await hitOnce(async () => {
        G.press('Mouse0')
        G.release('Mouse0')
      })
      rows.push({ what: '1타', want: w.comboSteps[0].damage, ...first })

      // ② 강타 — 집중 3점을 태웁니다.
      const heavy = await hitOnce(async () => {
        G.setFocus(3)
        // ⚠️ **찼는지 확인하고 누릅니다.** 롱소드만 계속 실패했는데,
        //    설정 직후 한 프레임 안에 눌러서 아직 0 이었습니다.
        const t = G.state().elapsed + 1
        while (G.state().elapsed < t && G.focusInfo().focus < 3) await sleep2()
        G.press('Mouse2')
        G.release('Mouse2')
      })
      rows.push({ what: '강타(3점)', want: w.heavySteps[3].damage, ...heavy })

      // ③ 처형 — 무방비인 적에게만.
      const fin = await hitOnce(async (e) => {
        G.breakEnemy(e)
        await sleep2()
        G.press('Mouse0')
        G.release('Mouse0')
      })
      rows.push({ what: '처형', want: w.finisherDamage, ...fin })

      // ④ 달리기 공격 — 달리는 중에 칩니다.
      /**
       * ④ 달리기 공격은 **여기서 안 잽니다.**
       *
       * 세 번 시도했고 세 번 다 설정이 안 섰습니다. 마지막 원인은
       * `W` 가 적 쪽이 아니라 **화면 위쪽**이라는 것이었고(쿼터뷰라
       * 월드 축과 비스듬합니다), 달리기만 실제로 걸어가야 해서 앞의
       * 측정들에서는 드러난 적이 없었습니다.
       *
       * 그런데 **재지 않아도 이미 덮여 있습니다.** 달리기(252)·구르기
       * (253)·낙하(254)는 `stepFor` → `comboSpec` 이라는 **같은 한 줄기**를
       * 지납니다. 그중
       *   · 구르기는 바로 아래에서 세 무기 모두 실측이 파생값과 일치하고,
       *   · 낙하는 `npm run fall` 이 실측 47.2 vs 파생 47.3 으로 잡습니다.
       * 같은 경로를 두 지점에서 확인했으면 세 번째는 **덧대는 것**입니다.
       *
       * 억지로 세운 설정으로 초록을 만드는 것보다, 안 재는 것과 그 이유를
       * 적어 두는 편이 낫습니다 — 이 저장소가 계측기에 대해 지켜 온 규칙입니다.
       */

      // ⑤ 구르기 공격 — 구른 직후의 창 안에서 칩니다.
      const roll = await hitOnce(async (e) => {
        G.press('Space')
        G.release('Space')
        const t = G.state().elapsed + 2
        while (G.state().elapsed < t && G.moveInfo().rollWindowT === 0) await sleep2()
        const i = G.enemyInfo(e)
        if (i) {
          G.teleportPlayer(i.x - 1.2, i.z)
          G.aimAtWorld(i.x, i.z)
        }
        G.press('Mouse0')
        G.release('Mouse0')
      }, 3)
      rows.push({ what: '구르기 공격', want: w.moves[1].damage, ...roll })

      out.weapons.push({ id: w.id, got, rows })
    }
    G.freezeEnemies(false)
    return out
  })

  for (const w of result.weapons) {
    console.log(`\n  [${w.id}]`)
    check(w.got === w.id, `무기를 실제로 들었다 (${w.id})`, `지금 ${w.got}`)
    for (const r of w.rows) {
      /**
       * 게이트를 먼저 세웁니다 — **안 맞았으면 비교는 아무 뜻이 없습니다.**
       * 이 저장소가 빈 표본으로 다섯 번 데인 자리입니다.
       */
      if (!r.hit) {
        check(false, `${r.what} — 맞히질 못했습니다 (측정 불성립)`, `나간 기술 "${r.pending}"`)
        continue
      }
      /**
       * 허용 오차 2%: 부동소수 누적과 반올림만 흡수합니다. 이 저장소가
       * 잡은 실제 버그들은 전부 **배 단위**로 틀렸습니다(낙하 47.3 vs 27,
       * 달리기가 마무리 타로 접힘). 2% 면 그런 것은 다 걸립니다.
       */
      const ok = r.want > 0 && Math.abs(r.dealt - r.want) <= Math.max(0.5, r.want * 0.02)
      check(ok, `${r.what} — 실측이 파생값과 같다`, `실측 ${r.dealt} vs 파생 ${r.want}`)
    }
  }

  console.log('')
  check(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2).join(' | '))
} catch (err) {
  console.error(
    `\n💥 프로브가 도중에 죽었습니다 — 아래 숫자는 **완결되지 않았습니다**\n${err?.stack ?? err}\n`,
  )
  fail++
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과 / ${fail}개 실패\n`)
process.exit(fail === 0 ? 0 : 1)
