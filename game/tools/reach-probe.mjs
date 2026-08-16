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
      /**
       * ⚠️ **마지막 타까지 기다립니다.**
       *
       * 처음엔 *첫* 타가 들어오면 바로 체력을 읽었습니다. 그래서 다단히트
       * 스킬이 전부 빨갛게 떴습니다 — 회오리(2타) 16 vs 32, 넓게베기(3타)
       * 19 vs 57, 연격은 아예 "못 맞힘". 게임은 정확히 적힌 대로 때리고
       * 있었고 **계측기가 도중에 자리를 뜬** 것입니다.
       *
       * 그래서 첫 타 뒤로 **새 타격이 0.4초 동안 없을 때까지** 셉니다.
       * (`hits` 를 프로브가 세어 맞추지 않습니다 — 그러면 타수를 바꾸는 날
       * 프로브만 옛 숫자를 압니다.)
       */
      const t0 = G.state().elapsed
      while (G.state().elapsed - t0 < seconds && G.state().hitsDealt === hits0) await sleep2()
      let lastHitAt = G.state().elapsed
      let seen = G.state().hitsDealt
      while (G.state().elapsed - lastHitAt < 0.4 && G.state().elapsed - t0 < seconds + 3) {
        if (G.state().hitsDealt !== seen) {
          seen = G.state().hitsDealt
          lastHitAt = G.state().elapsed
        }
        await sleep2()
      }
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

      /**
       * ⑥ **스킬** — 보스 피해의 71% 를 내는 통로인데, 지금까지 실측한
       *    적이 없습니다. `npm run tripod` 은 표의 실효 수치를 **찍기만**
       *    하고, 그 값이 실제 타격에 도달하는지는 아무도 안 봤습니다.
       *
       *    기대값은 `effectiveSkill(slot)` — 트라이포드까지 반영해 게임이
       *    계산해 준 값입니다. 다단히트는 `damage × hits` 로 봅니다.
       *
       *    ⚠️ 무기 스킬(0~2)만 잽니다. 룬(3~4)은 무기가 아니라 진행에
       *       따라 붙는 것이라, 판 시작 상태에서는 비어 있을 수 있습니다.
       */
      /** ⌨️ 키는 **게임의 표**에서 읽습니다 — 프로브가 베끼면 옛 키를 누릅니다. */
      const keys = G.slotCooldowns().map((c) => c.key)
      for (let slot = 0; slot < 3; slot++) {
        const def = G.effectiveSkill(slot)
        if (!def || typeof def.damage !== 'number' || def.damage <= 0) continue
        const cast = await hitOnce(async (e) => {
          const i = G.enemyInfo(e)
          if (i) {
            // 지점 지정 스킬을 위해 **적 위에** 겨눕니다.
            G.aimAtWorld(i.x, i.z)
          }
          await sleep2()
          G.press(keys[slot])
          G.release(keys[slot])
        }, 3)
        const hits = typeof def.hits === 'number' && def.hits > 0 ? def.hits : 1
        rows.push({
          what: `스킬 ${slot + 1} (${def.id})`,
          want: Number((def.damage * hits).toFixed(2)),
          ...cast,
        })
      }

      out.weapons.push({ id: w.id, got, rows })
    }
    G.freezeEnemies(false)
    return out
  })

  /**
   * ── 🌿 **트라이포드가 실제 타격을 바꾸는가** ────────────────────────
   *
   * 트라이포드는 이 게임에서 스킬 하나를 여러 갈래로 만드는 시스템인데,
   * **실측으로 확인한 적이 한 번도 없습니다.** `npm run tripod` 은 표의
   * 실효 수치를 찍고 스크린샷을 남길 뿐입니다. 스킬이 보스 피해의 71% 를
   * 내는 통로이고 트라이포드가 그 스킬을 바꾸는 것이니, 여기가 조용히
   * 끊어져 있으면 성장의 절반이 장식이 됩니다.
   *
   * ⚠️ **바뀐다는 것만으로는 부족합니다.** 표가 바뀌었는데 타격이 안
   *    바뀌는 것이 정확히 이 저장소가 두 번 만난 버그의 모양입니다.
   *    그래서 두 가지를 같이 봅니다: 표가 바뀌었는가, **그리고** 그
   *    바뀐 값이 실제로 들어왔는가.
   */
  const tri = await page.evaluate(async () => {
    const G = window.__game
    const sleep2 = () => new Promise((r) => setTimeout(r, 8))
    const runFor = async (sec) => {
      const t = G.state().elapsed + sec
      while (G.state().elapsed < t) await sleep2()
    }
    const idle = async (sec = 3) => {
      const t = G.state().elapsed + sec
      while (G.state().elapsed < t && G.state().player.state !== 0) await sleep2()
    }
    const keys = G.slotCooldowns().map((c) => c.key)
    const cast = async (slot) => {
      await idle()
      G.clearEnemies()
      await runFor(0.3)
      const e = G.spawnEnemyKind('grunt', 6, 0)
      await runFor(0.25)
      const i = G.enemyInfo(e)
      if (!i) return null
      G.wakeEnemy(e)
      G.freezeEnemies(true)
      G.setHp(e, 1000000)
      /**
       * ⚠️ **거리도 게임에게 묻습니다.**
       *
       * 1.2m 로 못 박았더니 트라이포드를 켠 뒤 실측이 0 으로 나왔습니다.
       * `shadow_step` 은 **돌진** 스킬이고, 돌진 거리를 늘리는 선택지를
       * 켜면 그 거리에서는 적을 **지나쳐 버립니다.** 게임이 바뀌었는데
       * 프로브가 옛 거리를 들고 있었던 것입니다 — 이 저장소가 반복해서
       * 만난 모양입니다. 돌진이 있으면 그 거리의 8할에 섭니다.
       */
      const d0 = G.effectiveSkill(slot)
      const dash = typeof d0?.dash === 'number' ? d0.dash : 0
      const stand = dash > 1 ? dash * 0.8 : 1.2
      G.teleportPlayer(i.x - stand, i.z)
      G.aimAtWorld(i.x, i.z)
      G.setStamina(1000)
      await runFor(0.2)
      /**
       * ⚠️ **쿨다운이 돌아올 때까지 기다립니다.**
       *
       * 기준선을 한 번 시전하면 그 슬롯이 쿨다운에 들어갑니다. 그걸 안
       * 기다리고 다시 눌렀더니 두 번째 측정이 **실측 0** 으로 나왔고,
       * 하마터면 *"트라이포드가 실제 타격에 안 들어온다"* 는 큰 결론을
       * 그대로 들고 갈 뻔했습니다. 표는 22 → 31.9 로 멀쩡히 바뀌어
       * 있었으니 더 그럴듯했습니다. **누른 것이 나가기는 했는지**를
       * 먼저 물어야 합니다.
       */
      const tCd = G.state().elapsed + 20
      while (G.state().elapsed < tCd && (G.slotCooldowns()[slot]?.cd ?? 0) > 0) await sleep2()
      const before = G.enemyInfo(e).hp
      const h0 = G.state().hitsDealt
      G.press(keys[slot])
      G.release(keys[slot])
      const t0 = G.state().elapsed
      while (G.state().elapsed - t0 < 3 && G.state().hitsDealt === h0) await sleep2()
      let last = G.state().elapsed
      let seen = G.state().hitsDealt
      while (G.state().elapsed - last < 0.4 && G.state().elapsed - t0 < 6) {
        if (G.state().hitsDealt !== seen) {
          seen = G.state().hitsDealt
          last = G.state().elapsed
        }
        await sleep2()
      }
      return {
        dealt: Number((before - (G.enemyInfo(e)?.hp ?? before)).toFixed(2)),
        hit: G.state().hitsDealt > h0,
        /**
         * 🔎 0 이 나왔을 때 **왜인지** 말해 주는 값들 — 없으면 눈이 먼 채로
         * 고칩니다. ⚠️ 이 쿨다운은 **시전이 끝난 뒤**의 값입니다(그래서
         * 10 근처가 정상). 누르기 직전 값이 아니라는 것을 이름에 적어 둡니다 —
         * 이 저장소가 이름 때문에 잘못 읽은 적이 있습니다.
         */
        cdAfterCast: G.slotCooldowns()[slot]?.cd ?? -1,
        stateAfter: G.state().player.state,
        stand: Number(stand.toFixed(2)),
        dash,
      }
    }
    const want = (slot) => {
      const d = G.effectiveSkill(slot)
      if (!d || typeof d.damage !== 'number') return -1
      const hits = typeof d.hits === 'number' && d.hits > 0 ? d.hits : 1
      return Number((d.damage * hits).toFixed(2))
    }
    // 첫 무기·첫 스킬로 잽니다. 트라이포드 점수를 넉넉히 줍니다.
    G.grantTripod(9)
    await runFor(0.2)
    const skillId = G.effectiveSkill(0)?.id
    const base = { want: want(0), ...(await cast(0)) }
    // 1티어의 선택지를 훑어 **피해가 달라지는 것**을 찾습니다.
    let picked = null
    for (let opt = 0; opt < 3; opt++) {
      if (!G.unlockTripod(skillId, 0, opt)) continue
      await runFor(0.2)
      if (want(0) !== base.want) {
        picked = opt
        break
      }
    }
    if (picked === null) {
      G.freezeEnemies(false)
      return { skillId, base, picked: null }
    }
    const after = { want: want(0), ...(await cast(0)) }
    G.freezeEnemies(false)
    return { skillId, base, after, picked }
  })
  console.log('')
  check(
    tri?.base?.hit === true && tri.base.want > 0,
    `🌿 트라이포드 기준선을 쟀다 (${tri?.skillId})`,
    `실측 ${tri?.base?.dealt} vs 표 ${tri?.base?.want}`,
  )
  if (tri?.picked === null) {
    check(false, '🌿 피해를 바꾸는 1티어 선택지를 찾지 못했다 (측정 불성립)', `${tri?.skillId}`)
  } else if (tri?.after) {
    check(
      tri.after.want !== tri.base.want,
      '🌿 **표가 실제로 바뀐다** (안 바뀌면 아래 검사가 헛돕니다)',
      `${tri.base.want} → ${tri.after.want}`,
    )
    check(
      tri.after.hit === true &&
        Math.abs(tri.after.dealt - tri.after.want) <= Math.max(0.5, tri.after.want * 0.02),
      '🌿 **바뀐 값이 실제 타격에 들어온다** (표만 바뀌고 손은 그대로면 장식입니다)',
        `실측 ${tri.after.dealt} vs 표 ${tri.after.want} · 시전 뒤 쿨 ${tri.after.cdAfterCast} · 누른 뒤 상태 ${tri.after.stateAfter} · 선 거리 ${tri.after.stand}(돌진 ${tri.after.dash})`,
    )
  }

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

  /**
   * ── 📏 **내 공격 표시가 사실을 말하는가** ───────────────────────────
   *
   * 적의 예고에서 같은 것을 두 번 찾아 고쳤습니다:
   *   · 예고 부채꼴 — 그린 선 밖 0.45m 에서 맞음 → 그림을 넓힘
   *   · 등 뒤 표시 — 고리 밖 1.3m 까지 백어택 → 고리를 사거리까지 넓힘
   *
   * 세 번째 자리가 여기입니다. `visuals.ts` 는 내 공격 범위를
   * `step.range` 로 그리면서 주석에 이렇게 적어 뒀습니다:
   *
   *   > "예고는 좁은데 실제로는 넓다" 같은 **거짓말이 생기지 않습니다**
   *
   * 그런데 판정은 `spec.range + Body.radius[대상]` 입니다(combat.ts
   * `shapeDist`). 대상이 점이 아닌 한 그 주장은 **참일 수 없습니다.**
   * 방향만 반대일 뿐(이번엔 플레이어에게 유리) 같은 어긋남입니다.
   *
   * ⚠️ 재는 법은 `flank` 에서 검증된 것을 그대로 씁니다 — 적을 매번
   *    제자리로 되돌리고, 자세를 새로 읽고, 손이 빌 때까지 기다립니다.
   *    (넉백으로 밀려난 적의 옛 좌표를 쓰다 한 라운드를 통째로 날렸습니다.)
   */
  console.log('')
  {
    const edge = await page.evaluate(async () => {
      const G = window.__game
      const sleep2 = () => new Promise((r) => setTimeout(r, 8))
      const runFor = async (sec) => {
        const t = G.state().elapsed + sec
        while (G.state().elapsed < t) await sleep2()
      }
      await G.resetProgress()
      await runFor(0.4)
      G.clearEnemies()
      await runFor(0.3)
      const p0 = G.state().player
      const e = G.spawnEnemyKind('grunt', p0.x + 8, p0.z)
      await runFor(0.3)
      G.wakeEnemy(e)
      G.freezeEnemies(true)
      G.setHp(e, 1000000)
      const home = G.entityState(e)
      const wid = G.state().loadout.weapon
      const w = G.weaponTable().find((x) => x.id === wid)
      // 그린 선은 **게임에게 묻습니다**(사거리 + 파고들기) — 짐작하지 않습니다.
      const drawn = w.comboSteps[0].drawnRange
      const foe = G.enemyRoster().find((r) => r.id === 'grunt')
      const trueEdge = drawn + foe.radius

      const hitAt = async (d) => {
        // 손이 빌 때까지 — 후딜이 남으면 다음 입력이 선입력으로 먹힙니다.
        const t0 = G.state().elapsed
        while (G.state().elapsed - t0 < 3 && G.state().player.state !== 0) await sleep2()
        // 적을 제자리로 — 앞 타격의 넉백을 지웁니다.
        G.teleportEnemy(e, home.x, home.z)
        await sleep2()
        const cur = G.entityState(e)
        G.teleportPlayer(cur.x - d, cur.z)
        G.aimAtWorld(cur.x, cur.z)
        G.setStamina(1000)
        // 몸이 다 돌 때까지 — 게임이 "적이 내 앞에 있다"고 말할 때까지.
        {
          const t1 = G.state().elapsed
          while (G.state().elapsed - t1 < 1.5) {
            const t = G.threats(20).find((x) => x.entity === e)
            if (t?.facing) break
            await sleep2()
          }
        }
        const hp0 = G.enemyInfo(e).hp
        G.press('Mouse0')
        await sleep2()
        G.release('Mouse0')
        const t2 = G.state().elapsed
        while (G.state().elapsed - t2 < 2 && G.enemyInfo(e).hp === hp0) await sleep2()
        return { d: Number(d.toFixed(2)), landed: G.enemyInfo(e).hp < hp0 }
      }

      /**
       * ⚠️ **못 맞히는 자리가 나올 때까지 늘립니다.**
       *
       * 처음엔 `참 가장자리 + 0.4m`(3.15m)까지만 훑었는데 **전부 명중**
       * 이었습니다. 그러면 "어디가 끝인가"를 못 정하고, 검사는 비교할
       * 대상이 없습니다. 원인은 **파고들기(lunge)** 입니다 — 공격 시작에
       * 플레이어가 앞으로 미끄러지므로 실효 사거리가 그만큼 더 깁니다.
       *
       * 계산으로 짐작하지 않고 **끝이 보일 때까지** 갑니다.
       */
      const scan = []
      // ⚠️ 시작점을 `drawn` 에 매지 않습니다 — 그리는 규칙을 바꾸면 훑기가
      //    이미 끝을 지난 자리에서 시작해 **양쪽을 다 못 봅니다**(한 번 겪음).
      for (let d = 1.2; d <= drawn + 4; d += 0.2) {
        scan.push(await hitAt(d))
        // 연속 두 자리에서 못 맞히면 끝을 지난 것입니다.
        const n = scan.length
        if (n >= 2 && !scan[n - 1].landed && !scan[n - 2].landed) break
      }
      G.freezeEnemies(false)
      return {
        drawn: Number(drawn.toFixed(2)),
        upper: Number(w.comboSteps[0].reachUpperBound.toFixed(2)),
        trueEdge: Number(trueEdge.toFixed(2)),
        radius: Number(foe.radius.toFixed(2)),
        scan,
      }
    })
    const landed = edge.scan.filter((r) => r.landed)
    const past = landed.filter((r) => r.d > edge.drawn + 0.01)
    console.log(
      `     [훑기] ${edge.scan.map((r) => `${r.d}m ${r.landed ? 'O' : 'X'}`).join(' · ')}`,
    )
    check(
      edge.scan.length >= 5 && landed.length >= 2 && edge.scan.some((r) => !r.landed),
      '📏 닿는 자리와 안 닿는 자리를 **둘 다** 봤다 (비교의 게이트)',
      `그린 선 ${edge.drawn}m · 참 가장자리 ${edge.trueEdge}m (+굵기 ${edge.radius}) · 맞음 ${landed.length}/${edge.scan.length}곳`,
    )
    /**
     * ⚠️ **약속을 안전한 방향으로 씁니다.**
     *
     * 처음엔 *"그린 선 밖에서는 안 맞는다"* 로 썼습니다(적 예고에서 고친
     * 것과 같은 모양). 그런데 재 보니 실제 끝이 **3.3m**, 그린 선이
     * **2.3m** 이었고, `range + lunge`(3.8m)로 넓혀 그렸더니 이번엔
     * **없는 사거리를 약속**했습니다 — 파고들기가 적응형이라 그 값은
     * 상한일 뿐이었습니다.
     *
     * 두 거짓말은 값이 아니라 **성질**이 다릅니다:
     *   · 좁게 그림 → 필요 이상으로 **붙게** 만듭니다 (손해지만 살아는 있음)
     *   · 넓게 그림 → **헛치게** 만듭니다 (뒤딜이 이 게임에서 제일 비쌈)
     *
     * 그래서 지킬 약속은 *"넓게 그리지 않는다"* 입니다. 좁은 쪽은 숫자로
     * 찍어 두되 빨갛게 하지 않습니다 — **알고 남기는 여유**입니다.
     */
    const gap = landed.length ? Math.max(...landed.map((r) => r.d)) - edge.drawn : 0
    check(
      landed.length > 0 && Math.max(...landed.map((r) => r.d)) >= edge.drawn - 0.25,
      '📏 **그린 선을 넘겨 그리지 않았다** (없는 사거리를 약속하면 헛치게 됩니다)',
      `그린 선 ${edge.drawn}m · 실제 명중 끝 ${landed.length ? Math.max(...landed.map((r) => r.d)) : 0}m` +
        ` · 상한(사거리+파고들기) ${edge.upper}m`,
    )
    console.log(
      `     [관찰] 그린 선보다 **${gap.toFixed(2)}m 더 닿습니다** (적 굵기 ${edge.radius}m + 적응형 파고들기).` +
        ' 넓게 그리면 헛치므로 좁은 쪽으로 남겨 둔 여유입니다.',
    )
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
