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
    let lastHp = 100
    let stuckSince = t0
    let lastPos = G.state().player
    let lastKills = 0
    const regionLog = []
    let curRegion = ''
    let regionStart = t0
    let vialsUsed = 0
    let lastVials = G.vialInfo().vials
    // 강화 횟수는 **게임 상태의 차이**로 셉니다. 누른 직후에 읽으면 아직
    // 반영 전이라 0으로 나옵니다 — 실제로 불티 424를 쓰고도 "강화 0회"로
    // 보고했습니다. 또 계측기가 거짓말을 한 경우입니다.
    const startVialMax = G.vialInfo().max
    const startWeaponLevels = G.weaponUpgradeInfo().levels.slice()
    /** 화톳불로 되돌아가는 것을 잠시 멈추는 시각 — 오가며 막히는 것을 막습니다. */
    let fireCooldownUntil = 0
    /** 화톳불로 향하기 시작한 뒤의 제한 시각. 왕복이 길어지면 포기합니다. */
    let fireTripUntil = 0
    /** 지름길을 열러 가는 것을 잠시 멈추는 시각 / 그 왕복의 제한 시각. */
    let shortcutCooldownUntil = 0
    let shortcutTripUntil = 0
    /**
     * ── 왜 안 죽는지를 재기 위한 값들 ──────────────────────────
     * 봇이 체력 100에 성수병 1개로 존을 끝냅니다. "쉽다"는 것만으로는
     * 무엇을 고쳐야 할지 알 수 없습니다. **받은 피해가 없는 것인지,
     * 받고도 회복이 넉넉한 것인지**를 갈라야 방향이 정해집니다.
     */
    let minHp = 100
    let damageTaken = 0
    let maxAggro = 0
    /** 동시에 쫓기는 적 수의 시간 가중 합 — 평균을 내기 위해 */
    let aggroSum = 0
    let aggroSamples = 0
    /** 그중 둘 이상과 붙어 있던 표본 수 */
    let multiSamples = 0
    /** 가까운 적이 있는 표본 수와, 그중 거리가 벌어지던 표본 수 */
    let engageSamples = 0
    let retreatSamples = 0
    let lastNearDist = 0
    let lastHpSample = G.state().player.hp
    let bossSeen = false
    /** ── 보스전 계측 — 존의 절정 60초를 처음으로 재 봅니다 ── */
    let bossStart = 0
    let bossFightTime = 0
    let bossPhaseSeen = 0
    let bossDamageTaken = 0
    let bossDamageDealt = 0
    let bossMinHp = 100
    let bossSamples = 0
    let lastBossHp = 0
    let bossMaxHp = 0
    let bossKilledAt = 0
    let bossKilled = false
    let clearedAt = 0
    const notes = []
    /** 교전과 교전 사이의 빈 시간(초) 목록 */
    const gaps = []
    let wasInCombat = false
    let lastCombatEnd = 0
    /** 스태미나 압박 */
    let minStamina = 100
    let staminaSamples = 0
    let lowStaminaSamples = 0
    const dodgeCost = G.runStats().dodgeStamina
    /** 무방비(강인도 붕괴)인 적이 곁에 있던 표본과, 그중 실제로 때린 표본 */
    let brokenSamples = 0
    let brokenUsedSamples = 0
    /** 처형 안내가 떠 있던 표본 / 그중 곧바로 누를 수 있던(대기 상태) 표본 */
    let finisherReadySamples = 0
    let finisherReadyIdleSamples = 0

    /**
     * ── 봇이 "무엇을 하고 있었는지" 를 남깁니다 ────────────────────────
     *
     * 지난 실행이 275초에 (54,18)에서 **18초간 진행 없음**으로 끝났습니다.
     * 그런데 기록에 남은 건 좌표뿐이라, 원인을 놓고 세 가지 가설을 세워
     * 코드를 읽으며 추측했습니다 — 길찾기가 벽을 가리켰나, 못 잡는 적에
     * 붙었나, 화톳불과 목표 사이를 오갔나.
     *
     * 이 프로젝트에서 이미 여러 번 겪은 실패입니다: **계측기가 결과만
     * 말하고 과정을 안 말하면, 남는 건 추측뿐입니다.** 그래서 매 프레임
     * 어떤 가지를 탔는지 한 단어로 남기고, 막혔을 때 그 분포와 그 순간의
     * 상태(목표·경로·가까운 적)를 통째로 적습니다.
     *
     * 이건 게임을 고치는 변경이 아니라 **다음 진단을 추측이 아니게 만드는**
     * 변경입니다.
     */
    let act = '시작'
    /** 최근 90 프레임의 가지 — 막혔을 때 되감아 봅니다. */
    const recentActs = []
    const actTotals = new Map()
    const markAct = (name) => {
      act = name
      actTotals.set(name, (actTotals.get(name) ?? 0) + 1)
      recentActs.push(name)
      if (recentActs.length > 90) recentActs.shift()
    }

    while (now() - t0 < LIMIT) {
      const st = G.state()
      const vi = G.vialInfo()
      const p = st.player

      /**
       * ── 막힘 감지 — **모든 가지에서** 봅니다 ────────────────────────
       *
       * 예전에는 이 검사가 "목표 쪽으로 걷는" 가지 안에만 있었습니다.
       * 그래서 봇이 **싸우다 갇히면** 아무 기록도 남지 않았습니다 —
       * 실제로 두 판 연속 408초를 중앙 폐허에서 보내고 7마리만 잡았는데
       * `[사건]` 이 통째로 비어 있었습니다. 계측기가 침묵한 것입니다.
       *
       * 판정도 바꿉니다. 제자리 전투는 정상이므로 위치만 보면 오탐이 납니다.
       * **"움직이지도, 아무것도 죽이지도 못한 시간"** 을 봅니다.
       */
      {
        const moved = Math.hypot(p.x - lastPos.x, p.z - lastPos.z)
        const kills = G.runStats().kills
        if (moved > 1.5 || kills > lastKills) {
          lastPos = p
          lastKills = kills
          stuckSince = now()
        } else if (now() - stuckSince > 25) {
          const recent = new Map()
          for (const a of recentActs) recent.set(a, (recent.get(a) ?? 0) + 1)
          const near2 = st.nearestEnemy
          const obj2 = G.objective()
          const foe = near2 ? G.threats(9)[0] : null
          notes.push({
            at: Number((now() - t0).toFixed(1)),
            what: '막힘 (25초간 이동도 처치도 없음)',
            region: curRegion,
            x: p.x,
            z: p.z,
            detail:
              `직전 ${recentActs.length}프레임 [${[...recent.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k}×${v}`)
                .join(' ')}]` +
              (obj2
                ? ` · 목표 ${obj2.label} 걷는거리 ${obj2.walkDist.toFixed(0)}m`
                : ' · 목표 없음') +
              (near2
                ? ` · 가까운적 ${near2.dist.toFixed(1)}m 체력 ${near2.hp.toFixed(0)} 경로 ${(G.pathStep(near2.x, near2.z)?.dist ?? -1).toFixed(0)}m`
                : ' · 가까운 적 없음') +
              (foe
                ? ` · 그 적의 상태 ${JSON.stringify(G.enemyInfo(foe.entity))}`
                : '') +
              ` · 내 상태 ${st.player.state} 체력 ${p.hp.toFixed(0)} 스태미나 ${p.stamina.toFixed(0)} 성수병 ${vi.vials}`,
          })
          break
        }
      }

      // ---- 위험 계측 ----
      /**
       * ⚠️ 이 프레임에 받은 피해를 **변수로 남깁니다.**
       *
       * 보스전 피해를 여기 아래에서 다시 `lastHpSample - p.hp` 로 재려다
       * **항상 0** 이 나왔습니다 — 이 줄에서 이미 `lastHpSample` 을 갱신해
       * 버리기 때문입니다. 그대로 뒀으면 "보스가 68초 동안 한 대도 못
       * 때렸다"는 **거짓 결론**을 그럴듯하게 보고할 뻔했습니다.
       */
      const frameDamage = Math.max(0, lastHpSample - p.hp)
      damageTaken += frameDamage
      lastHpSample = p.hp
      if (p.hp < minHp) minHp = p.hp
      /**
       * **교전 중일 때만** 셉니다.
       *
       * 처음엔 전 구간 평균을 냈는데, 방 단위 어그로를 넣자 걷는 동안 0이
       * 되어 평균이 오히려 **내려갔습니다**(1.22 → 1.09). 조합은 프로브에서
       * 분명히 함께 깨어나는데도요. 재려던 것은 "얼마나 자주 여럿과 싸우나"인데
       * 걷는 시간까지 섞으면 **어그로를 좁힐수록 좋아 보이는** 거꾸로 된 지표가 됩니다.
       */
      /**
       * ── 후퇴로 넘기고 있는가 ──────────────────────────────────
       *
       * 조합을 설계해도 **물러나면 다 풀린다면** 아무 의미가 없습니다.
       * 플레이어 5.4m/s vs 잡몹 3.0m/s 이므로 후퇴는 늘 성공합니다.
       * 그래서 "가까운 적과의 거리가 늘어나는 시간"의 비율을 잽니다.
       */
      {
        const n0 = st.nearestEnemy
        if (n0 && n0.dist < 8) {
          engageSamples++
          if (lastNearDist > 0 && n0.dist > lastNearDist + 0.02) retreatSamples++
          lastNearDist = n0.dist
        } else {
          lastNearDist = 0
        }
      }

      {
        const chasing = G.threats(12).filter((t) => t.aggro).length
        if (chasing > maxAggro) maxAggro = chasing
        if (chasing > 0) {
          aggroSum += chasing
          aggroSamples++
          if (chasing >= 2) multiSamples++
        }

        /**
         * ── 1. 전투 사이의 **빈 시간** ─────────────────────────────
         *
         * 가지 분포가 이렇게 나왔습니다: 목표이동 42% · 접근 27% · 공격 13%.
         * **69%가 걷기**입니다. 그런데 "걷기가 많다"만으로는 고칠 곳을 모릅니다 —
         * 소울류도 걷습니다. 다른 것은 **걷는 동안 위협이 있느냐**입니다.
         * 방 단위 어그로(14m)를 넣은 뒤로 이 존의 걷기는 자는 적 옆을
         * 지나가는 것이 되었을 수 있습니다. 그래서 "교전과 교전 사이가
         * 몇 초나 비는가"를 직접 잽니다. 8초가 넘는 구간이 몇 개인지가
         * 지도 밀도의 답이 됩니다.
         */
        const inCombat = chasing > 0
        if (inCombat && !wasInCombat) {
          if (lastCombatEnd > 0) gaps.push(now() - lastCombatEnd)
          wasInCombat = true
        } else if (!inCombat && wasInCombat) {
          wasInCombat = false
          lastCombatEnd = now()
        }

        /**
         * ── 2. 스태미나가 **제약이 되는가** ────────────────────────
         *
         * 스태미나는 이미 구현돼 있습니다(회피 25, 회복 34/초). 그런데
         * 봇은 예고만 보면 무조건 구르는데도 한 번도 안 죽습니다.
         * 값이 커서 안 걸리는 것인지, 실제로 걸리는데도 버티는 것인지를
         * 갈라야 방향이 정해집니다. 그래서 **"구르고 싶었는데 못 구른"**
         * 횟수를 셉니다 — 이게 0이면 스태미나는 이 게임에 없는 것과 같습니다.
         * 회피 비용은 게임에서 읽습니다(runStats().dodgeStamina).
         */
        if (p.stamina < minStamina) minStamina = p.stamina
        if (inCombat) {
          staminaSamples++
          if (p.stamina < dodgeCost) lowStaminaSamples++
        }

        /**
         * ── 3. 강인도 붕괴의 **틈을 쓰고 있는가** ──────────────────
         *
         * 붕괴는 이 게임에서 가장 큰 보상(긴 무방비)인데 별도 피해 배수가
         * 없습니다. 그 판단이 옳으려면 **틈 동안 실제로 때리고 있어야** 합니다.
         * 무방비인 적이 있는 프레임 중 봇이 때리는 프레임의 비율을 봅니다.
         */
        /**
         * **처형 안내가 실제로 떠 있는 시간**을 셉니다.
         *
         * 붕괴 43회에 처형 1회였습니다. 원인이 둘 중 무엇인지 갈라야 합니다:
         * 안내가 안 뜨는 것인가(창이 사거리 밖에서 소모됨), 떠 있는데 봇이
         * 못 누르는 것인가(후딜·경직). 세어 보면 바로 갈립니다.
         */
        const fi = G.finisherInfo()
        if (fi.ready) {
          finisherReadySamples++
          if (st.player.state === 0) finisherReadyIdleSamples++
        }
        const brokenNear = G.threats(6).find((t) => t.entity !== undefined && G.enemyInfo(t.entity)?.broken)
        if (brokenNear) {
          brokenSamples++
          // '처형' 도 창을 쓰는 행동입니다. 새 가지를 만들고 여기 안 넣으면
          // 활용률이 **구조적으로 0%** 가 됩니다(실제로 그렇게 찍혔습니다).
          if (act === '공격' || act === '반격' || act === '처형') brokenUsedSamples++
        }
      }

      // ---- 구역 기록 ----
      if (st.region && st.region !== curRegion) {
        if (curRegion) regionLog.push({ name: curRegion, seconds: now() - regionStart })
        curRegion = st.region
        regionStart = now()
      }

      // ---- 죽음 ----
      //
      // 죽은 횟수는 **게임이 셉니다**(runStats). 예전에는 "체력이 0인 프레임"을
      // 봇이 직접 셌는데, 화톳불 부활이 같은 프레임에 끝나서 그런 프레임이
      // 아예 없었습니다. 그래서 사망 0회로 보고하면서 불티는 280 → 32 로
      // 줄어 있었습니다 — 계측기가 조용히 거짓말을 하고 있었던 것입니다.
      /**
       * `gameOver` 는 **전멸에서도 클리어에서도** 켜집니다.
       * 처음엔 그걸 모르고 전부 "사망"으로 적었습니다. 봇이 처음으로 존을
       * 끝낸 판에서 체력 67에 적 0마리인데 **사망·게임오버**로 기록됐습니다 —
       * 계측기가 승리를 패배로 보고한 것입니다.
       */
      const cleared = st.gameOver && p.hp > 0 && st.enemiesLeft === 0
      if (cleared) {
        notes.push({ at: Number((now() - t0).toFixed(1)), what: '★ 존 클리어', region: curRegion })
        clearedAt = now() - t0
        releaseAll()
        break
      }
      if (p.hp <= 0 || st.gameOver) {
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
          markAct('성수병')
          releaseAll()
          tap('KeyX')
          const until = now() + 1.1
          while (now() < until) await sleep()
          continue
        }
        // 아직 붙어 있으면 반대 방향으로 도망칩니다(최대 3초).
        // 물러날 곳이 없으면(벽·절벽) 계속 뒷걸음질 쳐 봐야 시간만 버립니다.
        markAct('후퇴(성수병)')
        const flee = now() + 3
        const fleeStart = { x: p.x, z: p.z }
        while (now() < flee) {
          const s2 = G.state()
          const n2 = s2.nearestEnemy
          if (!n2 || n2.dist > 7.5) break
          if (s2.player.hp <= 0) break
          moveToward(s2.player.x - n2.x, s2.player.z - n2.z)
          await sleep()
        }
        const moved = Math.hypot(G.state().player.x - fleeStart.x, G.state().player.z - fleeStart.z)
        if (moved < 1) {
          // 벽에 몰렸습니다. 마시는 것을 포기하고 그냥 싸웁니다.
          notes.push({ at: Number((now() - t0).toFixed(1)), what: '벽에 몰려 후퇴 실패', region: curRegion })
        }
        continue
      }

      // ---- 보스 상태 기록 ----
      const be = G.bossEncounter()
      if (be && be.encounter > 0 && !bossSeen) {
        bossSeen = true
        bossStart = now()
        notes.push({ at: Number((now() - t0).toFixed(1)), what: '보스 조우', region: curRegion })
      }
      /**
       * ── 보스전을 **재는** 구간 ───────────────────────────────────
       *
       * 지금까지 보스에 대해 기록한 것은 "조우 O" 하나뿐이었습니다.
       * 존의 절정 60초를 한 번도 재 본 적이 없다는 뜻입니다 —
       * 3페이즈를 다 보는지, 몇 초 만에 끝나는지, 위험하기는 한지.
       */
      if (bossSeen && be && be.hp > 0) {
        bossFightTime = now() - bossStart
        if (be.phase + 1 > bossPhaseSeen) bossPhaseSeen = be.phase + 1
        bossSamples++
        const dmg = Math.max(0, lastBossHp - be.hp)
        if (lastBossHp > 0) bossDamageDealt += dmg
        lastBossHp = be.hp
        bossMaxHp = be.maxHp
        bossDamageTaken += frameDamage
        if (p.hp < bossMinHp) bossMinHp = p.hp
      } else if (bossSeen && !be && bossKilledAt === 0) {
        // 보스가 사라졌습니다 = 처치. 시간은 **그 순간**으로 고정합니다.
        bossKilledAt = now()
        bossKilled = true
        notes.push({
          at: Number((now() - t0).toFixed(1)),
          what: `수문장 처치 (교전 ${(now() - bossStart).toFixed(0)}초 · 본 페이즈 ${bossPhaseSeen})`,
          region: curRegion,
        })
      }

      /**
       * 🗡️ **처형은 거리 검사보다 먼저 봅니다.**
       *
       * 처음엔 "가까운 적이 2.2m 안일 때"의 공격 가지 안에 넣었습니다.
       * 그랬더니 한 판에 붕괴가 28번 일어나는데 처형은 **1회**였습니다.
       * 이유는 단순했습니다 — 무너진 적은 **넉백으로 밀려나** 2.2m 밖에 있고,
       * 그 1.0초 동안 봇은 "접근" 가지에서 걷고만 있었습니다.
       *
       * 안내가 떠 있다는 것 자체가 이미 **사거리(2.6m) 안**이라는 뜻입니다.
       * 게임이 "지금 이걸 할 수 있다"고 말해 주는데 봇이 거리를 다시
       * 계산해서 안 하는 것은, 계측기가 사람보다 못하게 구는 것입니다.
       */
      /**
       * ⚠️ **대기 상태를 요구하지 않습니다.**
       *
       * 처음엔 `state === 0` 을 걸었습니다(후딜 중에 눌러도 씹혀서 봇이 그
       * 가지에 갇혔던 적이 있어서). 그런데 세어 보니 안내가 떠 있던 5355
       * 프레임 중 대기 상태는 **31 프레임(0.6%)** 이었습니다 — 조건이 아니라
       * 사실상 금지였습니다.
       * 지금은 게임이 선입력을 받아 콤보 다음 타를 처형으로 바꿔 주므로,
       * 사람처럼 **그냥 누릅니다.**
       */
      if (G.finisherInfo().ready) {
        markAct('처형')
        const t = G.finisherInfo().target
        const ts = t >= 0 ? G.entityState(t) : null
        if (ts) G.aimAtWorld(ts.x, ts.z)
        tap('Mouse0')
        await sleep()
        continue
      }

      /**
       * ---- 전투 ----
       *
       * ── 봇이 스킬을 쓰게 된 이유 ──────────────────────────────
       * 이전까지 봇은 좌클릭과 구르기만 썼습니다. **슬롯 다섯 개를 통째로
       * 놀리고** 있었으니, 봇이 존을 못 끝내는 것을 지도 탓으로 돌릴 수
       * 없었습니다. 게다가 반격이 스킬 전용이 되면서, 스킬을 안 쓰는 봇은
       * 초록을 영영 못 배웁니다.
       *
       * 여전히 봇은 잘 못합니다 — 백어택을 노리지 않고, 어떤 스킬이 어떤
       * 상황에 좋은지도 모릅니다. **쿨이 돌면 아무거나 씁니다.**
       * 그게 이 봇의 역할입니다: 잘하는 플레이가 아니라 **하한선**.
       */
      /**
       * **닿을 수 있는 적만 상대합니다.**
       *
       * `nearestEnemy` 는 **수평 거리만** 봅니다. 수직 지도에서는 이게
       * 치명적입니다 — 함몰지 아래에 있는데 위쪽 가장자리에 선 적이
       * "5m 근처"로 잡히고, 봇은 오를 수 없는 절벽에 붙어 영원히 밀어댑니다.
       * 실제로 봇이 420초 중 310초를 함몰지에서 보낸 원인이 이것이었습니다
       * (체력 100, 성수병 3개 — 죽는 게 아니라 못 나오고 있었습니다).
       *
       * 걸어서 가는 거리와 직선 거리를 비교해 **크게 돌아가야 하면 무시**합니다.
       * 사람은 화면을 보고 "저긴 못 올라가"를 압니다. 봇에게는 길찾기가 그 눈입니다.
       */
      let reachable = null
      if (near) {
        const step = G.pathStep(near.x, near.z)
        reachable = step && step.dist <= near.dist * 1.8 + 6 ? step : null
      }
      if (near && reachable && near.dist < 12) {
        G.aimAtWorld(near.x, near.z)

        const threats = G.threats(9)
        const ready = G.slotCooldowns().filter((s) => !s.empty && s.cd <= 0)

        /**
         * 🟢 반격 — **구르기보다 먼저 봅니다.**
         *
         * 순서가 중요합니다. 예고가 뜨면 무조건 구르게 두면 초록도 굴러
         * 넘기게 되고, 새 동사를 배울 기회가 사라집니다.
         */
        const green = threats.find((t) => t.winding && t.intent === 4 && t.inFront && t.dist < 5.5)
        if (green && ready.length > 0) {
          markAct('반격')
          G.aimAtWorld(green.x, green.z)
          tap(ready[0].key)
          await sleep()
          continue
        }

        // 그 밖의 예고는 구릅니다. 4색을 구분하지 못하는 봇이라
        // **가장 단순한 대응**만 합니다 — 이게 초보자의 하한선입니다.
        const danger = threats.some((t) => t.winding && t.intent !== 4 && t.dist < 6)
        if (danger) {
          markAct('구르기')
          tap('Space')
          await sleep()
          continue
        }

        if (near.dist > 2.2) {
          markAct('접근')
          // 다가갈 때도 길을 따라갑니다 — 직선으로 가면 다시 절벽에 붙습니다.
          moveToward(reachable.x - p.x, reachable.z - p.z)
        } else {
          releaseAll()
          /**
           * 🗡️ **처형 안내가 떠 있으면 그것부터 누릅니다.**
           *
           * 처형을 넣고 첫 실행에서 **처형 0회**가 나왔습니다 — 붕괴는 41번
           * 일어났는데도요. 원인은 봇이 쿨이 도는 스킬을 **항상 먼저** 쓰는
           * 것이었습니다. 무방비 창(잡몹 1.0초)에 좌클릭을 누를 일이 없었습니다.
           *
           * 봇은 화면을 못 보지만, 이 봇의 원칙은 *"게임이 화면에 띄워 주는
           * 것은 읽는다"* 입니다(초록 예고·사다리 안내도 같은 방식입니다).
           * 처형 안내는 화면 한가운데 크게 뜨므로 사람이라면 반드시 봅니다.
           * 판단은 게임이 한 값(finisherInfo().ready)을 그대로 씁니다 —
           * 봇이 "무방비 + 2.6m"를 다시 계산하면 조건을 바꿀 때 조용히 어긋납니다.
           */
          /**
           * ⚠️ **대기 상태일 때만** 누릅니다.
           *
           * 처음엔 안내가 떠 있으면 무조건 좌클릭하고 `continue` 했습니다.
           * 그랬더니 공격 후딜·경직 중에도 이 가지로 빠져서, 봇이 그 전투
           * 내내 **아무 공격도 안 하는** 상태가 됐습니다 — 처치가 45마리에서
           * 7마리로 무너지고 존을 못 끝냈습니다. 처형이 아니라 **봇이 처형
           * 가지에 갇힌 것**이었습니다.
           * 지금 누를 수 없으면 조용히 평소 공격 규칙으로 내려갑니다.
           */
          markAct('공격')
          /**
           * 🥋 집중이 가득이면 강타로 태웁니다.
           *
           * 봇은 "지금 태울까 더 모을까"를 판단하지 못합니다. **가득 찼을 때만**
           * 태우는 가장 단순한 규칙을 씁니다 — 이게 초보자의 하한선이고,
           * 그래서 이 봇이 재는 것도 "가장 서투르게 써도 이 정도는 된다"입니다.
           */
          if (G.focusInfo().focus >= G.focusInfo().max) tap('Mouse2')
          else if (ready.length > 0) tap(ready[0].key)
          else tap('Mouse0')
        }
        await sleep()
        continue
      }

      // ---- 사다리: 위에 서 있으면 내립니다 ----
      // 사람이라면 안내가 뜬 김에 누릅니다. 봇이 안 누르면 지름길이 열리는지
      // 아닌지를 이 실행으로는 알 수 없습니다.
      if (G.shortcutHint() === 'ready') {
        markAct('사다리')
        releaseAll()
        tap('KeyV')
        await sleep()
        continue
      }

      /**
       * ---- 지름길: **싸면 들러서 엽니다** ----
       *
       * 네 판 내리 사다리 0/1 이었습니다. 봇은 위에 서면 반드시 누르게 짜여
       * 있었으니, 문제는 **한 번도 위에 서지 않은 것**이었습니다. 재 보니
       * 사다리 위 칸이 주 동선에서 100m 가까이 벗어나 있었습니다 — 지도를
       * 고쳤고(9.5절), 이제 32m 곁길입니다.
       *
       * 그런데 봇은 여전히 목표만 봅니다. 사람은 안 그렇습니다. **한 번 더 올
       * 것 같으면 지금 열어 둡니다.** 그 판단을 가장 단순한 규칙으로 옮깁니다:
       *   "위 칸이 걸어서 40m 안이고, 여는 값보다 아끼는 값이 크면 들른다."
       * 아끼는 값은 **게임이 지형에서 잰 값**(shortcutInfo().saving)입니다 —
       * 봇에 미터를 베껴 적으면 지도를 바꾼 순간 거짓이 됩니다.
       */
      const closedShortcut = G.shortcutInfo().find((s) => !s.open && (s.saving ?? 0) > 20)
      if (closedShortcut && now() >= shortcutCooldownUntil) {
        const toTop = G.pathStep(closedShortcut.hiWorldX, closedShortcut.hiWorldZ)
        if (toTop && toTop.dist <= 40) {
          // 왕복에 제한을 겁니다 — 화톳불에서 배운 것과 같은 이유입니다.
          // 도착 판정이 어긋나면 목표와 사다리 사이를 무한히 오갑니다.
          if (shortcutTripUntil === 0) shortcutTripUntil = now() + 30
          if (now() > shortcutTripUntil) {
            shortcutCooldownUntil = now() + 90
            shortcutTripUntil = 0
          } else {
            markAct('지름길이동')
            const straight = Math.hypot(
              closedShortcut.hiWorldX - p.x,
              closedShortcut.hiWorldZ - p.z,
            )
            // 마지막 몇 미터는 직선 — 격자 길찾기는 목표에 붙으면 진동합니다.
            const tx = straight < 6 ? closedShortcut.hiWorldX : toTop.x
            const tz = straight < 6 ? closedShortcut.hiWorldZ : toTop.z
            moveToward(tx - p.x, tz - p.z)
            await sleep()
            continue
          }
        }
      }

      /**
       * ---- 화톳불 ----
       *
       * **이전 판에서 봇은 휴식 0회였습니다.** 성수병 8개를 썼는데 보급받은
       * 유일한 경로가 죽음이었습니다(죽으면 3개로 리필). 자원 없이 계속
       * 싸우는 봇의 시간을 지도 탓으로 돌릴 뻔했습니다.
       *
       * 원인은 조건이 **"지나가다 마침 가까우면"** 이었기 때문입니다. 사람은
       * 그렇게 놀지 않습니다 — 성수병이 떨어지면 **일부러 화톳불로 되돌아갑니다.**
       * 그래서 자원이 바닥나면 목표를 잠시 화톳불로 바꿉니다.
       */
      const fire = G.nearestBonfire()
      const em = G.emberInfo()
      // 강화할 수 있으면 체력과 무관하게 멈춥니다. **불티는 쓰라고 있는 것**이고,
      // 안 쓰면 불티 경제가 도는지 아닌지를 이 봇이 영영 못 잽니다.
      const wu = G.weaponUpgradeInfo()
      // 정련석까지 있어야 강화가 됩니다. 불티만 보고 화톳불로 가면
      // 도착해서 아무것도 못 하고 그 자리를 맴돕니다.
      const canUpgradeWeapon =
        wu.nextCost > 0 && em.embers >= wu.nextCost && wu.stones >= wu.nextStoneCost
      const canUpgrade = (em.upgradeCost > 0 && em.embers >= em.upgradeCost) || canUpgradeWeapon
      const needsSupply = vi.vials === 0 || p.hp < 45
      if (fire && needsSupply) {
        const fd = Math.hypot(fire.x - p.x, fire.z - p.z)
        if (fd > 2.2) {
          // **길찾기로** 되돌아갑니다. 직선으로 걸어가게 뒀더니 벽에 걸려
          // 성문 앞에서 133초를 헤맸고, 그 시간이 "지도가 어렵다"로 잘못
          // 기록될 뻔했습니다. 길찾기를 쓰는 쪽과 안 쓰는 쪽이 섞여 있으면
          // 계측이 거짓말을 합니다.
          markAct('보급이동')
          const step = G.pathStep(fire.x, fire.z)
          if (step) moveToward(step.x - p.x, step.z - p.z)
          else moveToward(fire.x - p.x, fire.z - p.z)
          await sleep()
          continue
        }
        // 도착했으면 **쉴 때까지** 서 있습니다. 지나가며 잠깐 멈추는 것으로는
        // restTime 을 못 채웁니다.
        markAct('휴식')
        releaseAll()
        const restedBy = now() + 6
        while (now() < restedBy) {
          if (G.vialInfo().vials > 0 && G.state().player.hp > 70) break
          await sleep()
        }
        lastVials = G.vialInfo().vials
        continue
      }
      /**
       * **강화할 수 있으면 화톳불로 일부러 갑니다.**
       *
       * 예전엔 "지나가다 2.2m 안에 들어오면"이었습니다. 그래서 봇은 불티
       * 424를 들고도 강화 0회로 존을 끝냈고, 불티 경제가 도는지 **잴 수가
       * 없었습니다.** 사람이라면 400을 들고 있으면 쓰러 갑니다.
       * 다만 너무 멀면 안 갑니다 — 강화하러 존을 되돌아가는 것은 사람도 안 합니다.
       */
      if (fire && canUpgrade && now() >= fireCooldownUntil) {
        const straight = Math.hypot(fire.x - p.x, fire.z - p.z)
        const step = G.pathStep(fire.x, fire.z)
        /**
         * **왕복 자체에 제한 시간을 겁니다.**
         *
         * 처음엔 "도착해서 강화한 뒤"에만 쿨다운을 걸었습니다. 그런데 도착
         * 판정이 어긋나거나(적이 가까워 못 쉬는 등) 강화가 실패하면 쿨다운이
         * 영영 안 걸려서, 봇이 화톳불과 목표 사이를 무한히 오갑니다 —
         * 실제로 계단에서 336초를 맴돌았습니다.
         * 결과와 무관하게 **한 번 시도했으면 한동안 안 갑니다.**
         */
        if (fireTripUntil === 0) fireTripUntil = now() + 25
        if (now() > fireTripUntil) {
          fireCooldownUntil = now() + 60
          fireTripUntil = 0
        } else if (step && step.dist < 45 && straight > 1.6) {
          /**
           * **마지막 몇 미터는 직선으로 갑니다.**
           *
           * 길찾기는 격자(2m) 단위라 목표에 붙으면 두 칸 사이를 진동합니다.
           * 실제로 화톳불 3.5m 앞에서 제자리걸음을 하다 66초에 "막힘"으로
           * 끝났습니다. 길찾기는 **벽을 돌아가는 용도**지 마지막 두 걸음용이
           * 아닙니다.
           */
          markAct('강화이동')
          const useStraight = straight < 6
          const tx = useStraight ? fire.x : step.x
          const tz = useStraight ? fire.z : step.z
          moveToward(tx - p.x, tz - p.z)
          await sleep()
          continue
        }
        else {
          // 붙었는데도 못 쓰는 상황이면(적이 가까워 막힘 등) 한동안 포기합니다.
          fireCooldownUntil = now() + 60
          fireTripUntil = 0
        }
      }
      if (fire && (p.hp < 70 || canUpgrade)) {
        const fd = Math.hypot(fire.x - p.x, fire.z - p.z)
        if (fd < 2.6) {
          releaseAll()
          /**
           * 봇은 **성수병 먼저, 남으면 무기**로 씁니다.
           *
           * 사람이라면 "지금 죽지 않는 것이 급한가, 다음 구간을 빨리 넘기고
           * 싶은가"를 저울질하지만 봇은 그런 판단을 못 합니다. 가장 단순한
           * 우선순위 하나만 씁니다 — 그리고 그게 초보자의 기본값이기도 합니다.
           */
          if (em.upgradeCost > 0 && em.embers >= em.upgradeCost) {
            tap('KeyV')
            await sleep()
          }
          const w2 = G.weaponUpgradeInfo()
          if (w2.nextCost > 0 && G.emberInfo().embers >= w2.nextCost && w2.stones >= w2.nextStoneCost) {
            tap('KeyB')
            await sleep()
          }
          // 한 번 들렀으면 한동안 다시 오지 않습니다. 안 그러면 아직 살 수 있는
          // 강화가 남아 있는 한 화톳불과 목표 사이를 영원히 오갑니다
          // (실제로 그렇게 막혀서 139초에 실행이 끝났습니다).
          fireCooldownUntil = now() + 60
          fireTripUntil = 0
          const until = now() + 2.5
          while (now() < until) await sleep()
          lastVials = G.vialInfo().vials
          continue
        }
      }

      /**
       * ---- 이동: 목표 쪽으로 (**마지막 수단**) ----
       *
       * **직선이 아니라 경로의 다음 한 걸음**을 따라갑니다. 지도가 원이 되면서
       * 목표까지 직선으로 가면 성벽마루에 처박히기 때문입니다. 게임의 화살표도
       * 같은 값을 씁니다 — 봇과 사람이 같은 안내를 보게 두는 것이 요점입니다.
       *
       * ⚠️ **이 가지는 반드시 맨 마지막이어야 합니다.**
       * 예전에는 화톳불보다 **위에** 있었고, `continue` 도 하지 않았습니다.
       * 그래서 한 프레임에 `moveToward` 가 **두 번** 불렸습니다 — 먼저 목표
       * 쪽으로, 그다음 화톳불 쪽으로. 두 방향이 반대면 서로를 지웁니다.
       *
       * 중간 화톳불을 폐허(주 동선 위)로 옮기자 이 둘이 늘 반대 방향이 되어
       * 봇이 화톳불 1m 앞에서 **제자리걸음**을 했습니다: 두 판 연속 408초 동안
       * 7마리만 잡고 존을 못 끝냈습니다. 막힘 기록의 "직전 90프레임
       * [목표이동×50 강화이동×40]" 이 그 절반씩을 그대로 보여 줬습니다.
       *
       * 한 프레임에는 **목적지가 하나**여야 합니다.
       */
      const obj = G.objective()
      if (!obj) break
      markAct('목표이동')
      moveToward(obj.stepX - p.x, obj.stepZ - p.z)

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
    if (!bossKilled) bossKilled = bossSeen && G.bossEncounter() === null
    return {
      elapsed: Number((now() - t0).toFixed(1)),
      deaths: G.runStats().deaths,
      regionLog: merged.map((r) => ({ name: r.name, seconds: Number(r.seconds.toFixed(1)) })),
      regionTotal: Object.entries(total)
        .map(([name, seconds]) => ({ name, seconds: Number(seconds.toFixed(1)) }))
        .sort((a, b) => b.seconds - a.seconds),
      hitLimit: now() - t0 >= LIMIT - 1,
      boss: {
        fought: bossSeen,
        // 보스가 죽은 시각이 있으면 그때까지, 없으면 마지막으로 본 시각까지.
        seconds: Number((bossKilledAt > 0 ? bossKilledAt - bossStart : bossFightTime).toFixed(1)),
        phasesSeen: bossPhaseSeen,
        damageTaken: Math.round(bossDamageTaken),
        damageDealt: Math.round(bossDamageDealt),
        maxHp: Math.round(bossMaxHp),
        minHp: Math.round(bossMinHp),
        killed: bossKilled,
        samples: bossSamples,
      },
      /** 전투 사이 빈 시간 — 지도 밀도의 답 */
      gapAvg: gaps.length ? Number((gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)) : 0,
      gapMax: gaps.length ? Number(Math.max(...gaps).toFixed(1)) : 0,
      gapLong: gaps.filter((g) => g >= 8).length,
      gapCount: gaps.length,
      /** 스태미나가 실제로 제약이 되는가 */
      minStamina: Number(minStamina.toFixed(0)),
      dodgeCost,
      lowStaminaRatio: staminaSamples ? Math.round((lowStaminaSamples / staminaSamples) * 100) : 0,
      /** 강인도 붕괴와 그 틈의 활용 */
      poiseBreaks: G.runStats().poiseBreaks,
      finisherReady: finisherReadySamples,
      finisherReadyIdle: finisherReadyIdleSamples,
      finishers: G.runStats().finishers,
      brokenUseRatio: brokenSamples ? Math.round((brokenUsedSamples / brokenSamples) * 100) : 0,
      /**
       * **시간이 어디로 갔는가** — 구역별 누적보다 이쪽이 원인에 가깝습니다.
       * 구역은 "어디에 있었나"만 말하지만, 가지는 "무엇을 하고 있었나"를 말합니다.
       * 걷는 데 대부분을 쓰고 있으면 지도 문제, 접근에 쓰고 있으면 길찾기 문제,
       * 공격에 쓰고 있으면 밸런스 문제입니다.
       */
      actTotal: [...actTotals.entries()]
        .map(([name, frames]) => ({ name, pct: Math.round((frames / Math.max(1, [...actTotals.values()].reduce((a, v) => a + v, 0))) * 100) }))
        .sort((a, b) => b.pct - a.pct),
      vialsUsed,
      // 봇의 추측이 아니라 **게임이 센 값**입니다. 예전엔 "성수병이 늘었으면
      // 쉰 것"으로 추론했는데, 성수병이 이미 가득이면 못 세서 0으로 나왔습니다.
      restCount: G.vialInfo().restCount,
      upgrades: G.vialInfo().max - startVialMax,
      weaponUps: G.weaponUpgradeInfo().levels.reduce((a, v, i) => a + (v - startWeaponLevels[i]), 0),
      weaponLevels: G.weaponUpgradeInfo().levels,
      stones: G.weaponUpgradeInfo().stones,
      stonesEarned: G.weaponUpgradeInfo().earnedStones,
      minHp: Number(minHp.toFixed(1)),
      damageTaken: Number(damageTaken.toFixed(0)),
      maxAggro,
      avgAggro: Number((aggroSum / Math.max(1, aggroSamples)).toFixed(2)),
      multiRatio: Number(((multiSamples / Math.max(1, aggroSamples)) * 100).toFixed(0)),
      retreatRatio: Number(((retreatSamples / Math.max(1, engageSamples)) * 100).toFixed(0)),
      enemySwings: G.runStats().enemySwings,
      enemyHits: G.runStats().enemyHits,
      counters: G.counterCount(),
      focusLeft: Number(G.focusInfo().focus.toFixed(2)),
      clearedAt: Number(clearedAt.toFixed(1)),
      ladderOpen: (G.shortcutInfo() ?? []).filter((l) => l.open).length,
      ladderTotal: (G.shortcutInfo() ?? []).length,
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
    console.log('  [무엇을 하고 있었나]')
    console.log(`    ${log.actTotal.map((a) => `${a.name} ${a.pct}%`).join(' · ')}`)
    console.log('')
  }
  if (log.notes.length) {
    console.log('  [사건]')
    for (const n of log.notes) {
      const where = n.region ? ` @${n.region}` : ''
      const pos = n.x !== undefined ? ` (${n.x.toFixed(0)}, ${n.z.toFixed(0)})` : ''
      console.log(`    ${String(n.at).padStart(6)}초  ${n.what}${where}${pos}`)
      if (n.detail) console.log(`            ${n.detail}`)
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
  console.log(
    log.clearedAt > 0
      ? `  진행       ★ ${log.clearedAt}초에 존 클리어`
      : `  진행       ${log.elapsed}초${log.hitLimit ? ' (제한 도달 — 끝내지 못함)' : ''}`,
  )
  console.log(`  사망       ${log.deaths}회`)
  console.log(`  처치       ${log.kills}마리 · 남은 적 ${log.enemiesLeft}마리`)
  console.log(`  보스       조우 ${log.bossSeen ? 'O' : 'X'}`)
  console.log(`  성수병     ${log.vialsUsed}개 사용 · 휴식 ${log.restCount}회 · 최대 ${log.vialsMax}개`)
  console.log(
    `  불티       ${log.embers} · 정련석 ${log.stones}(누적 ${log.stonesEarned}) · 성수병 강화 ${log.upgrades}회 · 무기 강화 ${log.weaponUps}회 [${log.weaponLevels.join('/')}]`,
  )
  console.log(`  지름길     사다리 ${log.ladderOpen} / ${log.ladderTotal}개 내림`)
  console.log(`  반격       ${log.counters}회 성공 · 남은 집중 ${log.focusLeft}`)
  console.log(`  체력       ${log.hp} (최저 ${log.minHp} · 총 피해 ${log.damageTaken})`)
  console.log(
    `  동시 교전   교전 중 평균 ${log.avgAggro}마리 · 둘 이상인 시간 ${log.multiRatio}% · 최대 ${log.maxAggro}마리`,
  )
  console.log(`  후퇴       근접(8m) 중 거리를 벌리던 시간 ${log.retreatRatio}%`)
  console.log(
    `  적의 공격   ${log.enemySwings}회 휘두름 · ${log.enemyHits}회 적중 (적중률 ${Math.round((log.enemyHits / Math.max(1, log.enemySwings)) * 100)}%)`,
  )
  console.log(
    `  빈 시간     교전 사이 평균 ${log.gapAvg}초 · 최장 ${log.gapMax}초 · 8초 이상 ${log.gapLong}회 / ${log.gapCount}구간`,
  )
  console.log(
    `  스태미나    최저 ${log.minStamina} · 교전 중 회피(${log.dodgeCost})를 못 낼 만큼 낮았던 시간 ${log.lowStaminaRatio}%`,
  )
  if (log.boss.fought) {
    console.log(
      `  보스전      ${log.boss.seconds}초 · 본 페이즈 ${log.boss.phasesSeen}/3 · ${log.boss.killed ? '처치' : '미처치'}\n` +
        `              받은 피해 ${log.boss.damageTaken} (그 사이 최저 체력 ${log.boss.minHp}) · 준 피해 ${log.boss.damageDealt}/${log.boss.maxHp}`,
    )
  } else {
    console.log('  보스전      조우하지 못함')
  }
  console.log(
    `  강인도      붕괴 ${log.poiseBreaks}회 · 처형 ${log.finishers}회 · 무방비인 적 곁에서 실제로 때린 시간 ${log.brokenUseRatio}%\n` +
      `              처형 안내가 떠 있던 프레임 ${log.finisherReady} (그중 곧바로 누를 수 있던 프레임 ${log.finisherReadyIdle})`,
  )
  console.log('')
} finally {
  await browser.close()
  await server.close()
}
