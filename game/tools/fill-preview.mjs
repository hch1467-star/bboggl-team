/**
 * ⏳ **차오르는 예고**를 눈으로 확인합니다 — `npm run fill`
 *
 * ── 왜 캡처가 따로 필요한가 ──────────────────────────────────────
 * `npm run parry` 가 이미 숫자로 확인합니다 — 차오른 몫이 판정 즈음
 * 0.99 에 닿고, 그 전에는 0.85쯤이라는 것. 그런데 그건 **값이 맞다**는
 * 확인이지 **보인다**는 확인이 아닙니다.
 *
 * 이 신호가 하려는 일은 *"밝은 끝이 바깥 선에 닿는 순간이 판정"* 을
 * 사람 눈에 가르치는 것입니다. 그러려면 **자라는 것이 눈에 띄어야**
 * 하고, 그건 픽셀을 봐야 압니다. 실제로 이 저장소는 색 대비를 계산으로
 * 33.6 이라고 믿었다가 화면에서 23.3 인 것을 `npm run contrast` 로
 * 알아낸 적이 있습니다 — **계산과 화면은 다른 것**입니다.
 *
 * 한 공격의 예고를 **여러 지점에서** 찍어 나란히 둡니다. 한 장만 찍으면
 * "차오른다"는 그림으로 확인할 수가 없습니다 — 비교 대상이 없으니까요.
 *
 * ⚠️ 이건 **판정 프로브가 아닙니다.** 통과/실패를 내지 않습니다. 사람이
 *    볼 그림을 만들 뿐이고, 옳은지는 `npm run parry` 가 숫자로 봅니다.
 *    둘을 한 파일에 섞으면 "그림이 예쁘다"가 초록이 되어 버립니다.
 */
import { preview } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ensureFreshBuild } from './fresh-build.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'tools', 'shots')
const PORT = 4197
const VIEWPORT = { width: 900, height: 760 }
const CLIP = { x: 190, y: 150, width: 520, height: 460 }
const PREINSTALLED = ['/opt/pw-browsers/chromium']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

// 🏗 **찍기 전에 짓습니다.** 이 도구는 소스가 아니라 `dist/` 를 찍습니다 —
//    안 지으면 옛 게임의 그림을 지금 것으로 믿게 됩니다(fresh-build.mjs).
await ensureFreshBuild(ROOT)
const server = await preview({
  root: ROOT,
  preview: { port: PORT, strictPort: true, host: '127.0.0.1' },
  logLevel: 'error',
})
const browser = await chromium.launch({
  executablePath: PREINSTALLED.find((p) => existsSync(p)),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('error:', e))
  await page.goto(`http://127.0.0.1:${PORT}/?mode=arena&lowfx=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__game?.ready === true, { timeout: 20000 })
  await page.evaluate(() => window.__game.clearEnemies())
  await page.evaluate(() => window.__game.freezeEnemies(true))
  await sleep(800)

  console.log('\n⏳ 차오르는 예고 — 한 공격을 여러 지점에서 찍습니다\n')

  const boss = await page.evaluate(() => window.__game.spawnBoss(0, 5))
  await sleep(400)

  /**
   * 🔴 직격을 씁니다 — 타이밍으로 푸는 색이라 저스트 회피의 대상이고,
   * 부채꼴이 좁아 **자란 길이가 한눈에 보입니다**. 🟡 광역(360°)은
   * 화면을 다 덮어서 "얼마나 찼는가"가 오히려 안 읽힙니다.
   */
  const SHOTS = [
    ['a-start', 0.15],
    ['b-half', 0.55],
    ['c-almost', 0.9],
  ]
  /**
   * ── ⏱ **가장 예고가 긴 패턴을 고릅니다 — 이 기계의 프레임 때문에** ──
   *
   * 원래 0번 패턴(`boss_cleave` · 예고 **0.78초**)을 찍었습니다. 그런데
   * 세 장이 전부 **차오름 0.78** 로 나왔습니다 — 목표가 0.15·0.55·0.9 인데
   * 말입니다. 원인은 게임이 아니라 **재는 기계**였습니다:
   *
   *     차오름 = 0.12 + p × 0.88   (p = 1 − 남은 시간/예고 길이)
   *     이 컨테이너는 소프트웨어 렌더라 **한 프레임 ≈ 0.16초**
   *     예고 0.78초 ÷ 0.16 ≈ **다섯 조각** → 관측되는 p 의 최댓값 ≈ 0.75
   *     → 차오름 0.12 + 0.75 × 0.88 = **0.78**   ← 찍힌 값과 정확히 일치
   *
   * 즉 **도구가 자기 해상도보다 짧은 것을 찍으려** 하고 있었습니다.
   * 사람의 60fps 화면에서는 1.0 까지 자랍니다 — 게임은 멀쩡합니다.
   *
   * 그래서 **예고가 가장 긴 패턴**을 씁니다. 번호를 적어 두지 않고
   * 게임에게 묻는 이유는 늘 같습니다 — 패턴 순서를 바꾸는 날 이 도구만
   * 옛 자리를 찍게 됩니다.
   */
  /**
   * ⚠️ **얼린 것을 여기서 풉니다 — 켜 두고 갔었습니다.**
   *
   * 위 준비 구간이 `freezeEnemies(true)` 를 켭니다(스폰이 흔들리지 않게).
   * 그런데 **끄지를 않아서**, 공격을 걸어도 **시간이 안 흘렀습니다.**
   * 그 결과 세 장이 전부 `차오름 0.78` 이었고, 600프레임을 봐도
   * **0.78 이 그대로**였습니다 — 자라다 만 것이 아니라 **얼어 있던**
   * 것입니다.
   *
   * 이 저장소가 같은 사고를 한 번 적어 뒀습니다 — `crowd-probe` 의
   * *"무적을 반드시 끕니다 — 앞 절이 켜 두고 갑니다… 끄는 것을 실험이
   * 끝나는 자리가 아니라 **시작하는 자리**에 둡니다."*
   * 그 처방을 그대로 따릅니다: **찍기 시작하는 자리에서 상태를 확정**합니다.
   *
   * ⚠️ 그 전에 제 설명이 두 번 빗나갔습니다 — «프레임이 성겨서», «예고가
   *    짧아서». 둘 다 그럴듯했고 둘 다 틀렸습니다. 답을 준 것은 **본 값을
   *    그대로 찍은 것**입니다(같은 값이 600번 = 안 움직인다).
   */
  await page.evaluate(() => window.__game.freezeEnemies(false))
  const pick = await page.evaluate(() => {
    const list = window.__game.enemyRoster().find((r) => r.id === 'boss')?.attacks ?? []
    let best = 0
    for (let i = 1; i < list.length; i++) if (list[i].windup > list[best].windup) best = i
    return { index: best, id: list[best]?.id ?? '?', windup: list[best]?.windup ?? 0 }
  })
  console.log(
    `  [고른 패턴] ${pick.id} — 예고 ${pick.windup}초 (가장 긴 것 · 이 기계의 프레임으로 나누려면 길어야 합니다)`,
  )
  // 🎬 공격은 **찍을 때마다** 새로 겁니다(아래 루프 안). 여기서 한 번만
  //    걸면 두 번째·세 번째 캡처는 **이미 자란 예고**를 만나 즉시 반환합니다.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )

  const grew = []
  for (const [name, want] of SHOTS) {
    /**
     * 원하는 지점까지 **게임에게 물어보며** 굴립니다. 벽시계로 기다리면
     * 이 컨테이너에서는 프레임이 튀어 매번 다른 자리를 찍습니다 —
     * 같은 파일 이름에 다른 그림이 들어가는 것이 가장 나쁩니다.
     */
    const got = await page.evaluate(
      async ([target, bossE, atkI, wantId]) => {
        const G = window.__game
        /**
         * 🎬 **매번 새 예고를 겁니다.**
         *
         * 앞의 두 장이 목표 0.15·0.55 인데 둘 다 **0.78** 이 찍혔습니다 —
         * 관측을 시작할 때 예고가 **이미 0.78 까지 자라 있어서** 조건을
         * 즉시 만족했기 때문입니다. 「차오르는 것을 보여 준다」는 도구가
         * **자란 뒤에 도착**하고 있었습니다.
         *
         * 그래서 캡처마다 공격을 새로 걸고, 예고가 **처음(0.12 언저리)**
         * 에서 출발하는 것을 확인한 뒤 목표까지 기다립니다.
         */
        /**
         * ⚠️ **보스가 이미 무언가를 걸고 있으면 강제 지정이 덮입니다.**
         *
         * 이름을 같이 찍게 하자 드러났습니다 — 세 장이 `boss_bind` ·
         * `boss_quake` · `boss_cleave` 로 **셋 다 다른 공격**이었습니다.
         * 도구 이름은 *"한 공격을 여러 지점에서"* 인데 말입니다. 그림만
         * 보면 «차오른다»로 읽히지만 실은 **다른 것 셋**을 늘어놓은
         * 것이었습니다.
         *
         * 그래서 **비어 있을 때 걸고, 건 것이 맞는지 확인**합니다.
         * 아니면 다시 겁니다(최대 여덟 번). 이 저장소가 여러 번 쓴
         * 모양입니다 — 원하는 상태가 될 때까지 **기다렸다가** 재기.
         */
        /**
         * 🎬 **«처음부터 자라는» 예고를 잡을 때까지 기다립니다.**
         *
         * ── 두 번 고쳐서 여기까지 왔습니다 ────────────────────────────
         * ① 처음엔 그냥 지켜봤습니다 → 이미 자란 예고를 만나 **즉시 반환**
         *    (세 장 다 0.78).
         * ② 「비기를 기다렸다가 걸기」로 고쳤습니다 → 이번엔 셋 다
         *    **grow 1** 이 나왔습니다. 예고는 판정이 끝난 뒤에도 잠시
         *    화면에 남아서, 「비었다」가 좀처럼 오지 않습니다.
         *
         * 그래서 조건을 **원하는 상태 그 자체**로 적습니다 —
         * *"고른 그 공격이고, 아직 처음(0.25 미만)인 예고"*. 비어 있을
         * 때만 새로 걸고, 그 밖에는 그냥 기다립니다. 「무엇을 기다리는가」를
         * 에두르지 않고 그대로 쓰는 것이 이 저장소에서 늘 통했습니다.
         */
        // 🔎 본 값을 그대로 들고 나옵니다 — 가설을 세우기 전에 관측부터.
        const seen = []
        for (let i = 0; i < 500; i++) {
          const t0 = G.telegraphs()[0]
          if (t0 && t0.attackId === wantId && t0.grow < 0.25) break
          if (!t0) G.forceAttack(bossE, atkI)
          await new Promise((r) => requestAnimationFrame(r))
        }
        for (let i = 0; i < 600; i++) {
          const t = G.telegraphs()[0]
          if (!t) {
            seen.push('없음')
            break
          }
          if (seen.length < 40) seen.push(t.grow)
          // 남은 시간이 아니라 **화면에 그려진 크기**로 기다립니다 —
          // 이 캡처가 확인하려는 것이 바로 그 값이니까요.
          if (t.grow >= target)
            return { grow: t.grow, seen, frames: i, id: t.attackId, intent: t.intent }
          await new Promise((r) => requestAnimationFrame(r))
        }
        /**
         * ⚠️ **목표에 못 닿았을 때 «얼마까지 갔는지»를 같이 냅니다.**
         *
         * 세 목표(0.15 · 0.55 · 0.9)에 대해 세 장 다 **0.78** 이 찍혔습니다.
         * 그 모양이 뜻하는 것은 하나입니다 — 앞의 둘은 **이미 0.78 이라
         * 즉시 통과**했고, 0.9 는 **600프레임을 기다려도 못 닿아** 마지막
         * 값을 낸 것입니다. 즉 `grow` 가 0.78 언저리에서 **멈춥니다.**
         *
         * 이 도구는 *"세 장을 나란히 보면 부채꼴이 자라는 것이 보여야
         * 한다"* 고 스스로 적어 뒀는데, 같은 순간을 세 번 찍고 있었습니다.
         * 값이 하나뿐이면 «자란다»를 못 보여 줍니다.
         */
        const last = G.telegraphs()[0]
        return {
          grow: last?.grow ?? -1,
          seen,
          frames: 600,
          id: last?.attackId ?? '?',
          intent: last?.intent ?? -1,
        }
      },
      [want, boss, pick.index, pick.id],
    )
    await page.evaluate(() => window.__game.setPaused(true))
    const file = `18-fill-${name}.png`
    await page.screenshot({ path: path.join(OUT, file), clip: CLIP })
    await page.evaluate(() => window.__game.setPaused(false))
    console.log(
      /**
       * 🏷 **어떤 공격을 찍었는지 같이 냅니다.**
       *
       * 그림 셋을 열어 보니 a-start 는 「광역」, c-almost 는 「속박」 —
       * **서로 다른 공격**이었습니다. 도구 이름이 *"한 공격을 여러
       * 지점에서"* 인데 보스가 강제 지정을 덮고 자기 패턴을 골랐습니다.
       * 그림만 보면 «차오른다»로 읽히지만 실은 **다른 것 셋**입니다.
       *
       * 이름을 숫자로 같이 내면 그림과 수가 서로를 검증합니다 —
       * 이 회차에 「보인다」를 좌표로만 재다 틀린 적이 여러 번 있었습니다.
       */
      `  차오름 ${String(got.grow).padStart(5)} (목표 ${want} · ${got.frames}프레임 · **${
        got.id
      }**) → ${file}` +
        (got.grow < want ? `  ⚠️ **목표에 못 닿았습니다**` : '') +
        `\n     본 값: ${got.seen.slice(0, 14).join(' ')}${got.seen.length > 14 ? ' …' : ''}` +
        (got.id !== pick.id ? `  ⚠️ **고른 것(${pick.id})과 다릅니다**` : ''),
    )
    grew.push(got.grow)
  }
  {
    const spread = Math.max(...grew) - Math.min(...grew)
    if (spread < 0.2)
      console.log(
        `\n  ⚠️ **세 장이 안 갈립니다** (차오름 ${grew.join(' · ')} · 폭 ${spread.toFixed(
          2,
        )}) — 「자란다」를 보여 주지 못합니다. 위 «남은 한계» 주석을 보십시오.`,
      )
  }

  /**
   * ⚠️ **세 장이 실제로 다른지 여기서 확인합니다.**
   *
   * 이 도구는 오래 **조용히 거짓말**을 하고 있었습니다 — 세 장이 전부
   * 같은 순간(차오름 0.78)이었는데 파일 이름만 start·half·almost 였고,
   * 로그는 그 사실을 안 말했습니다. 사람이 그림 셋을 열어 보기 전에는
   * 알 수 없었습니다.
   *
   * 이제 **찍은 값과 공격 이름**을 같이 내고, 세 장이 안 갈리면 경고합니다.
   * 그림 도구도 검사와 같은 규칙을 따라야 합니다 — **못 잰 것은 통과가
   * 아니다.**
   *
   * ⚠️ **남은 한계(고치다 멈춘 자리):** 이 컨테이너는 소프트웨어 렌더라
   *    프레임이 아주 성깁니다. 「예고가 처음부터 자라는 순간」을 잡으려고
   *    기다리면, 한 프레임 사이에 차오름이 0.25 → 0.85 로 건너뛰기도
   *    합니다. 확실히 하려면 **애니메이션을 쫓는 대신 시뮬레이션을 세워
   *    놓고 원하는 시점으로 옮기는** 방법이 필요합니다(일시정지 + 한 걸음).
   *    지금은 그 손잡이가 없어서, **거짓말을 안 하게** 만드는 데까지만
   *    했습니다. 사람의 60fps 화면에서는 이 문제가 없습니다.
   */
  console.log('\n  세 장을 나란히 보면 밝은 부채꼴이 자라는 것이 보여야 합니다.')
  console.log('  ⚠️ 옳은지는 여기서 안 봅니다 — `npm run parry` 가 숫자로 봅니다.\n')
} catch (err) {
  // 💥 도중에 죽으면 반드시 소리를 냅니다 — 조용히 exit 0 하는 계측기는
  //    통과하는 검사보다 나쁩니다(intent-preview.mjs 의 같은 자리 참고).
  console.error('\n💥 캡처가 도중에 죽었습니다 — 그림을 믿지 마십시오\n' + (err?.stack ?? err))
  process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
}
