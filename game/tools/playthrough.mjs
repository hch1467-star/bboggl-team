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
 * 이 봇은 4색을 구분하지 못합니다. 목표를 향해 걷고,
 * 적이 붙으면 때리고, 예고가 뜨면 구르고, 체력이 낮으면 마십니다.
 * 즉 **처음 플레이하는 사람의 하한선**에 가깝습니다.
 * 봇이 죽는 자리는 초보자도 죽는 자리이고, 봇이 걸어서 통과하는 구간은
 * 아무 판단 없이 통과되는 구간이라는 뜻입니다 — 둘 다 알아야 할 정보입니다.
 *
 * ⚠️ 모든 대기는 **시뮬레이션 시간**입니다. SwiftShader에서는 실시간의
 *    1/3~1/20로 흐르기 때문에 벽시계로 재면 전부 거짓이 됩니다.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
/**
 * ⚠️ **이 값은 반드시 `page.evaluate` 의 인자로 넘겨야 합니다.**
 *
 * 봇의 판단 고리는 **브라우저 안에서** 돕니다. Node 쪽 import 는 거기서
 * 안 보입니다. 두 회차 전에 `OLD_FLANK` 로 똑같이 데여서 **경고까지 적어
 * 뒀는데**, 이번에 `DETOUR_BUDGET` 으로 그대로 반복했습니다 — 벤치 4판이
 * 3~9초 만에 전부 죽었습니다.
 *
 * 주석은 읽는 사람에게만 말합니다. 그래서 `npm run guard` 가 이 실수를
 * 기계적으로 막습니다(evaluate 안에서 모듈 상수를 참조하면 실패).
 */
import { DETOUR_BUDGET, SPEND_BUDGET } from './policy.mjs'

const PORT = 5191
const execPath = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p))
/** 시뮬레이션 기준 최대 플레이 시간(초). 넘으면 "막혔다"로 봅니다. */
/**
 * 돌기를 **후딜에만** 하도록 좁히는 스위치 — `PLAY_RECOVERY_ONLY=1`.
 *
 * ── 기본값이 "아무 때나"인 이유 (재서 정했습니다) ──────────────────
 * 실험대(`npm run flank`)는 분명히 말했습니다: **판정 중에 적 둘레를 돌면
 * 잡몹 기준 매번 −14, 후딜부터 돌면 −0.** 그래서 후딜로 좁히는 것이
 * 옳아 보였습니다. 그런데 존에서 네 판을 견주니 정반대였습니다:
 *
 *   짝1  백어택 25% → 16% · 받은피해 425 → 463 · 클리어 → 실패
 *   짝2  백어택 31% → 15% · 받은피해 128 → 547 · 사망 0 → 1
 *
 * **세 지표 모두, 두 짝 모두** 좁힌 쪽이 나빴습니다. 이유는 짐작이 갑니다 —
 * 후딜은 짧고, 여럿이 달려드는 존에서는 그 창을 잡을 기회 자체가 드뭅니다.
 * 창을 기다리다 **아무것도 안 하는 시간**이, 가끔 칼에 스치는 값보다 비쌌습니다.
 *
 * > 실험대가 옳았던 것은 **국소적인 사실**(그 순간 덜 맞는다)이고,
 * > 존이 답한 것은 **정책**(그렇게 놀면 손해다)입니다. 둘 다 참입니다.
 *
 * 그래서 기본은 넓게 두고, 좁힌 쪽은 스위치로 남겨 다음에 다시 잽니다.
 *
 * ⚠️ 봇의 판단 고리는 **브라우저 안에서** 돕니다(`page.evaluate`). 그래서
 *    이 상수를 그냥 참조하면 `ReferenceError` 로 죽습니다 — 실제로 그렇게
 *    네 판을 통째로 날렸습니다. 값은 **인자로 넘겨야** 합니다.
 */
const RECOVERY_ONLY = process.env.PLAY_RECOVERY_ONLY === '1'

/**
 * 💥 **폭발통을 쓸 것인가** — A/B 를 위한 정책 스위치(`PLAY_NO_BARREL=1` 이면 끔).
 *
 * 통을 넣고 나서 벤치는 판당 **0회**를 찍었습니다. 그 0 은 *"안 쓸 만하다"*
 * 가 아니라 **"봇이 그 동사를 모른다"** 입니다 — 이 저장소가 취소 회피에서
 * 여덟 판을 태우고 배운 자리입니다(*"넣어 두고 안 쓰이면 «효과가 없다»와
 * «쓰이질 않았다»를 못 가립니다"*).
 *
 * 스위치로 남기는 이유: 가르친 뒤의 숫자는 **가르치기 전과 나란히 놓아야**
 * 뜻이 생깁니다. 끄고 켠 같은 판을 비교할 수 있어야 *"통이 무엇을
 * 바꿨는가"* 를 물을 수 있습니다.
 */
const USE_BARREL = process.env.PLAY_NO_BARREL !== '1'

const TIME_LIMIT = Number(process.env.PLAY_LIMIT ?? 420)
/**
 * ── 벽시계 안전줄(초) ──────────────────────────────────────────────
 *
 * 위 제한은 **시뮬레이션 시간**입니다. 그게 옳습니다 — 프레임률이 흔들려도
 * 같은 양의 게임을 재려면 시뮬레이션 시계를 봐야 합니다.
 *
 * 그런데 그 때문에 **벽시계로는 얼마나 걸릴지 알 수 없습니다.** 이 컨테이너는
 * GPU 가 없어 ~10fps 로 도는데, 그 값이 판마다 흔들립니다. 실제로 이렇게
 * 나왔습니다 (같은 420 시뮬레이션초):
 *
 *     452초 · 593초 · 692초 · 550초 · 900초↑ · 900초↑
 *
 * bench.mjs 는 자식 프로세스를 900초 벽시계로 죽입니다. 죽으면 JSON 을
 * 못 쓰고 **그 판의 모든 것이 사라집니다.** 실제로 3판 중 2판이 그렇게
 * 통째로 날아갔고, 그 벤치는 아무 결론도 못 냈습니다.
 *
 * 그래서 스스로 먼저 멈춥니다. 잘린 판은 `wallStopped` 로 표시해서
 * 벤치가 **집계에서 빼되 몇 판이 잘렸는지는 말하게** 합니다. 조용히
 * 섞이면 "짧게 끝난 판"으로 오해되어 모든 수치를 아래로 끌어내립니다.
 *
 * ⚠️ **그런데 빼는 것으로는 부족했습니다.** 존을 깨면 판이 그 자리에서
 *    끝나고, 못 깨면 창 끝까지 다 돕니다. 그러니 벽시계에 걸리는 쪽은
 *    거의 언제나 **못 깬 판**입니다 — 자르는 잣대가 재려는 것과 붙어
 *    있었습니다. 그래서 `존 클리어 1/1판` 이라고 적힌 벤치가 실제로는
 *    3판 중 1판만 깬 벤치였습니다. 자세한 사고 기록은 아래 `simPerWall`.
 *
 *    이제 이 줄은 **마지막 안전줄**일 뿐입니다. 창의 길이는 bench.mjs 가
 *    이 기계의 속도를 먼저 재서 **끝까지 돌 수 있는 값으로** 정합니다.
 */
const WALL_LIMIT = Number(process.env.PLAY_WALL ?? 720)

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
  /**
   * `PLAY_TWEAK` 이 있으면 그 설정을 덮어쓰고 켭니다(config/tweak.ts).
   * A/B 를 **한 프로세스 안에서 번갈아** 돌리려고 만든 통로입니다 —
   * 실험대를 커밋 단위로 가르면 기계가 느려지는 드리프트가 나중 쪽에
   * 통째로 얹힙니다.
   */
  const tweak = process.env.PLAY_TWEAK
  await page.goto(
    `http://localhost:${PORT}/?lowfx=1` + (tweak ? `&tweak=${encodeURIComponent(tweak)}` : ''),
  )
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })
  // 이전 실행의 세이브가 남아 있으면 조건이 매번 달라집니다.
  await page.evaluate(() => window.__game.resetProgress())
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 })

  console.log(`\n🤖 자동 플레이 — 제한 ${TIME_LIMIT} 시뮬레이션초\n`)

  const log = await page.evaluate(async ([LIMIT, WEAPON_SLOT, WALL, RECOVERY_ONLY, DETOUR, SPEND, BARREL_ON]) => {
    const G = window.__game
    /**
     * ⚠️ **시뮬레이션 시계**를 씁니다(`simElapsed`).
     *
     * 이 파일 맨 위에 *"모든 대기는 시뮬레이션 시간입니다"* 라고 적어 두고,
     * 정작 `elapsed` 를 쓰고 있었습니다 — 그건 **실제 시간**이라 히트스톱
     * 동안에도 흐릅니다. 무기 프로브에서 재 보니 전투 중 **11~13%** 가
     * 히트스톱이었습니다. 즉 "420 시뮬레이션초"는 실제로는 370초쯤이었고,
     * 교전 사이 빈 시간도 그만큼 부풀려져 있었습니다.
     * (많이 때릴수록 더 부풀려지므로, 밸런스를 바꾸면 오차도 같이 변합니다.)
     */
    const now = () => G.state().simElapsed
    /**
     * 🕐 **봇이 몇 번 판단했는가** — 판을 견줄 수 있는지 가르는 값.
     *
     * 이 루프는 **벽시계**에 묶여 있습니다(8ms). GPU 가 없는 이 컨테이너는
     * 판마다 프레임률이 흔들리고, 느린 판에서는 같은 시뮬레이션 1초 동안
     * 봇이 **더 적게** 판단합니다 — 즉 늦게 반응하고 더 맞습니다.
     *
     * 실제로 3판 벤치 셋의 판당 벽시계가 240~316초 → 339~413초 →
     * 481~723초 로 **73% 느려졌고**, 그 위에서 "받은 피해 162 → 280" 을
     * 밸런스 변화로 읽을 뻔했습니다. 기계 속도를 안 적으면 그 착각을
     * 막을 방법이 없습니다.
     */
    let botTicks = 0
    /**
     * ── ⏱ **한 프레임에 한 번만 판단합니다** ──────────────────────────
     *
     * ── 왜 바꿨는가 (벤치가 세 번 연속 "판정 불가"를 띄웠습니다) ────────
     * 예전 줄은 `setTimeout(8)` 이었습니다. **벽시계**입니다. 그런데
     * 세계가 바뀌는 것은 프레임 단위입니다. 이 컨테이너는 10fps 안팎이고
     * `time.ts` 의 `MAX_FRAME_DT = 1/20` 때문에 **모든 프레임이 정확히
     * 0.05 시뮬초**로 잘립니다 — 즉 시뮬레이션은 이미 고정 스텝인데,
     * 봇만 한 프레임 안에서 **열몇 번** 같은 세계를 다시 보고 있었습니다.
     * 그 횟수는 기계 부하에 따라 달라집니다. 벤치가 찍은 그대로입니다:
     *
     *     봇 판단 158.9 ~ 180.9 회/시뮬초   (같은 코드, 같은 판)
     *
     * 결과가 어떻게 되냐면, **판정 경계가 판마다 다른 자리에 떨어집니다.**
     * 예고가 0.05초짜리 프레임 어디에서 끝나든 봇의 반응은 프레임 단위로
     * 같아야 하는데, 폴링 횟수가 다르면 어떤 판은 한 프레임 일찍 굴고
     * 어떤 판은 늦게 굽니다. 최근 세 벤치가 전부
     * `📉 이 숫자로 값을 정하지 마십시오` 를 띄운 이유입니다
     * (받은 피해 6.1배 · 처치 2.9배 · 2.8배).
     *
     * 같은 세계를 두 번 보는 것은 **판단이 아니라 잡음**입니다. 그래서
     * 프레임이 넘어갈 때까지 기다립니다. 한 프레임에 한 번, 정확히.
     *
     * ⚠️ 기계가 20fps 를 넘으면 프레임 델타가 더 이상 0.05 로 안 잘리고,
     *    그때는 이 고정이 깨집니다. 그 조건은 벤치의 `기계 속도` 줄에
     *    이미 찍히고 있습니다 — 지금 이 컨테이너는 한참 아래입니다.
     */
    /**
     * ⚠️ **처음엔 프레임당 한 번으로 했다가 되돌렸습니다.**
     *
     * 편차는 완벽하게 사라졌지만(`22.2 (22.1~22.3)회/시뮬초`) **존 클리어가
     * 3/3 → 1/3** 이 됐습니다. 175 → 22 회/시뮬초는 8배 성긴 것이고,
     * 길찾기처럼 판단마다 방향을 고치는 가지들이 모퉁이를 지나쳐 버립니다.
     *
     * 재려는 것은 *"봇이 느려도 되는가"* 가 아니라 **"판마다 같은가"** 입니다.
     * 그래서 성기게 만드는 대신 **프레임당 횟수를 세어 고정**합니다.
     * 한 프레임 안에서는 세계가 안 바뀌므로 이 추가 판단들은 새 정보를
     * 보는 것이 아니라 **여러 단계 입력(누르고 → 떼고)을 낼 예산**입니다.
     * 예산을 상수로 두면 기계가 빨라도 느려도 판이 같아집니다.
     */
    const POLLS_PER_FRAME = 8
    let frameAt = -1
    let inFrame = 0
    const sleep = async () => {
      botTicks++
      const f = G.state().frame
      if (f !== frameAt) {
        frameAt = f
        inFrame = 0
      }
      inFrame++
      // 예산이 남았으면 같은 프레임에서 계속합니다 — 다만 이벤트 루프는 넘깁니다.
      if (inFrame < POLLS_PER_FRAME) {
        await new Promise((r) => setTimeout(r, 0))
        return
      }
      // 예산을 다 썼으면 다음 프레임까지 기다립니다(정지·탭 전환 대비 상한).
      for (let i = 0; i < 400; i++) {
        if (G.state().frame !== frameAt) return
        await new Promise((r) => setTimeout(r, 2))
      }
    }

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
    /**
     * ── 🧭 **끼인 것과 왔다 갔다 한 것은 다릅니다** ─────────────────────
     *
     * 막힘 판정은 `moved > 1.5`, 즉 **순 이동**만 봅니다. 그래서 두 가지가
     * 같은 기록으로 남습니다:
     *
     *   · 지형에 **끼여** 한 발도 못 뗀 것        → 지도·충돌의 이야기
     *   · 두 목표 사이를 **왕복**한 것(제자리걸음) → 봇 정책의 이야기
     *
     * 처방이 정반대인데 로그가 같으면 고를 수가 없습니다. 실제로 무너진
     * 회랑에서 25초 막힘이 **여섯 판**이나 났는데, `[보물이동×76 강화이동×14]`
     * 라는 기록만으로는 "길이 없다"인지 "목표가 진동한다"인지 몰랐습니다.
     *
     * 그래서 **걸은 거리**를 따로 더합니다. 순 이동과 나란히 놓으면 갈립니다:
     * 걸은 거리도 0에 가까우면 끼인 것이고, 걸은 거리만 크면 왕복입니다.
     */
    let walkedSince = 0
    let prevPos = G.state().player
    const regionLog = []
    /** 구역별 받은 피해와 머문 시간 — 난이도 곡선을 보기 위해 */
    const regionDanger = {}
    let lastRegionSample = t0
    let lastSwings = 0
    let lastRegionKills = 0
    let curRegion = ''
    let regionStart = t0
    let vialsUsed = 0
    let lastVials = G.vialInfo().vials
    // 강화 횟수는 **게임 상태의 차이**로 셉니다. 누른 직후에 읽으면 아직
    // 반영 전이라 0으로 나옵니다 — 실제로 불티 424를 쓰고도 "강화 0회"로
    // 보고했습니다. 또 계측기가 거짓말을 한 경우입니다.
    const startVialMax = G.vialInfo().max
    /**
     * ── 시작 무기를 고정할 수 있게 합니다 (`PLAY_WEAPON=1|2|3`) ─────────
     *
     * 봇은 지금까지 **한 무기만** 썼습니다. 그래서 판마다 강화가
     * `[1/0/0]` 으로 찍혔고, 나머지 둘은 존을 한 번도 안 지나갔습니다.
     *
     * 그런데 이 게임이 **직업제 대신 무기제를 택한 이유**가 DESIGN.md
     * 맨 앞에 적혀 있습니다 — *"보물 = 새로운 걸 할 수 있게 되는 것"* 이
     * 무기제에서만 성립하기 때문입니다. 무기가 셋인데 존이 하나의 무기로만
     * 검증되었다면, 그 주장은 **벤치(허수아비)에서만** 참입니다.
     *
     * 허수아비는 "무엇이 가능한가"를 재고, 존은 "무엇이 실제로 일어나는가"를
     * 잽니다. 세 무기로 존을 각각 돌려 봐야 *"무기를 바꾸면 플레이가
     * 달라지는가"* 에 답할 수 있습니다.
     */
    const forced = Number(WEAPON_SLOT)
    if (forced >= 1 && forced <= 3) {
      G.press(`Digit${forced}`)
      G.release(`Digit${forced}`)
      await new Promise((r) => setTimeout(r, 60))
    }
    const startWeaponLevels = G.weaponUpgradeInfo().levels.slice()
    /** 화톳불로 되돌아가는 것을 잠시 멈추는 시각 — 오가며 막히는 것을 막습니다. */
    // 곁길 예산 — 근거는 tools/policy.mjs. **인자로 받습니다**(아래 ⚠️).
    const TREASURE_DETOUR = DETOUR
    /**
     * 🧭 **"지나가다 들르는 것"의 값 — 거리가 아니라 돌아가는 비용으로.**
     *
     * ── 세 번의 측정이 각각 무엇을 가르쳤는가 ──────────────────────
     * ① 관문을 **날 거리 12m** 로 뒀을 때: 봇이 소비처에 18~42m 까지밖에
     *    못 가서 관문이 한 번도 안 열렸고, 무기 강화는 **판당 0회**였습니다
     *    (정련석 6 · 불티 402 를 손에 쥔 채로).
     * ② 관문을 **날 거리 40m**(보물 예산)로 넓혔더니 강화는 돌기 시작했지만
     *    (0회 → 중앙값 1회 · 남은 불티 416 → 138) **존 클리어가 3/3 → 1/3**
     *    로 무너졌습니다. 40m 짜리 왕복이 시간 예산을 다 먹었습니다.
     * ③ 그래서 문턱이 아니라 **재는 대상**을 바꿉니다. 12 라는 숫자가
     *    틀렸던 게 아니라, *"지나가다 들르는"* 을 **날 거리**로 재고 있던
     *    것이 틀렸습니다. 실제로 묻고 싶은 것은 하나입니다 —
     *    **"들르면 몇 m 를 더 걷는가."** 동선 위의 모루는 40m 앞에 있어도
     *    더 걷는 거리가 0 이고, 뒤에 있는 화톳불은 10m 여도 20m 를 더
     *    걷게 만듭니다.
     *
     * 이 저장소가 검사에서 이미 배운 것과 같은 자리입니다 — *"빨갈 때
     * 고칠 수 있는 것은 셋: 게임 · 문턱 · **재는 대상**"*.
     */
    const PASSING_DETOUR = 12
    let treasureCooldownUntil = 0
    let treasureTripUntil = 0
    /** 지금 나가 있는 곁길 왕복(있으면). 주우면 닫고 detours 에 넣습니다. */
    let detour = null
    /** 끝난 곁길 왕복들 — 곁길이 **값어치가 있었는지**를 재는 유일한 자료입니다. */
    const detours = []
    /** 등 뒤로 돌기를 포기할 시각(0이면 안 돌고 있음). */
    let circleUntil = 0
    let lastTreasureCount = 0
    /**
     * 보물마다 **가장 가까이 갔던 거리**(걸어야 하는 거리).
     *
     * 판마다 보물이 2/5 입니다. 그런데 "못 간 것"과 "안 간 것"은 다릅니다:
     *   · 한 번도 40m 안에 안 들어왔다 → **예산**이 막은 것(또는 지도가 멀다)
     *   · 들어왔는데도 안 갔다        → 다른 가지가 먼저 잡아챈 것
     * 끝나고 안 주운 보물의 최소 거리를 보면 갈립니다.
     */
    const treasureBest = {}
    /**
     * 🧭 **가장 가까이 갔던 그 순간, 무엇이 막고 있었는가.**
     *
     * 3판 모두 못 주운 보물 중 하나는 **10m** 까지 갔습니다. 40m 예산
     * 안이고, 걸어서 2~3초 거리입니다. 그런데 안 주웠습니다. "멀어서"가
     * 아니라는 뜻이고, 거리만 적어 두면 그 다음 질문에 답할 수가 없습니다.
     *
     * 불티 경제에서 `막힌 곳`(못삼·지갑안늘어·쿨다운·열림)을 나눠 적자마자
     * 처방이 정해졌던 것과 같은 방식입니다. 여기서도 **이유별로** 적습니다:
     *   · 싸우는중 — 12m 안에 적이 있어 곁길 가지에 아예 안 들어감
     *   · 왕복쿨다운 — 직전 왕복이 실패해 45초 잠김
     *   · 예산초과 — 걸어야 하는 거리가 예산보다 멂
     *   · 더가까운게있음 — 이 보물이 `best` 로 안 뽑힘(다른 보물을 향하는 중)
     *   · 가는중 — 이 보물을 향해 실제로 걷고 있었음
     */
    const treasureBlock = {}
    const noteTreasureBlock = (key, dist, why) => {
      const cur = treasureBlock[key]
      if (!cur || dist < cur.dist) treasureBlock[key] = { dist, why }
    }
    /**
     * 화톳불에 **닿은 순간의 지갑**을 그대로 남깁니다.
     *
     * 판마다 "무기 강화 0회 [0/0/0]" 이 찍히는데 불티는 316이 남습니다.
     * 못 산 이유가 셋 중 무엇인지 — 불티가 모자랐나, 정련석이 없었나,
     * 애초에 화톳불에 안 갔나 — 지금은 **알 방법이 없습니다.**
     * 셋은 각각 다른 처방을 부릅니다(경제 / 재료 배치 / 봇의 판단).
     */
    /**
     * ── 재료는 언제 도착하고, 소비처는 언제까지 닿는가 ────────────────
     *
     * 3판 벤치에서 **무기 강화 중앙값 0회**, 남은 불티 360 이 나왔습니다.
     * 불티는 남는데 못 삽니다 — 막는 것은 **정련석**입니다.
     *
     * 그런데 "정련석이 부족하다"와 "정련석이 **늦게** 온다"는 다른 문제이고
     * 처방도 다릅니다(드롭을 늘린다 / 배치를 앞으로 당긴다). 두 시각을
     * 재면 갈립니다:
     *   · 처음으로 **살 수 있게 된** 순간
     *   · 소비처(화톳불·모루)에 **마지막으로 닿을 수 있었던** 순간
     * 앞의 것이 뒤의 것보다 늦으면, 돈이 모자란 게 아니라 **너무 늦게**
     * 모인 것입니다.
     */
    let affordableAt = -1
    let lastSpendChanceAt = -1
    const fireVisits = []
    /** 화톳불에 가려다 **접은** 기록 — 접은 이유(걸어야 하는 거리)와 함께. */
    const fireSkips = []
    /**
     * 슬롯별로 봇이 **몇 번 눌렀는지** — 아래 회전 선택에 씁니다.
     *
     * 왜 회전인가: 예전엔 준비된 것 중 **맨 앞**(`ready[0]`)을 눌렀습니다.
     * 그래서 보고서의 슬롯 분포가 `[17/13/10/9/5]` 처럼 **단조 감소**로
     * 나왔는데, 그건 설계 신호가 아니라 **봇의 자리 편향**이었습니다.
     * 슬롯 5가 적게 쓰인 것이 "쓸모없어서"인지 "봇이 안 골라서"인지
     * 그 숫자로는 갈리지 않습니다 — 그럴듯해 보이는데 답을 못 하는 눈금.
     *
     * 가장 적게 쓴 것부터 고르면 편향이 사라집니다. **무작위가 아니라
     * 결정적**이라 판마다 재현됩니다(이 프로젝트는 같은 조건에서 같은
     * 결과가 나와야 밸런스를 비교할 수 있습니다).
     * 이제 남는 차이는 진짜 원인만 반영합니다 — 쿨다운이 길어 **덜 준비되는**
     * 슬롯인가, 아니면 사거리·상황이 안 맞아 **못 쓰는** 슬롯인가.
     */
    const slotUses = [0, 0, 0, 0, 0]
    const pickSkill = (ready) => {
      let best = ready[0]
      for (const r of ready) {
        if ((slotUses[r.slot] ?? 0) < (slotUses[best.slot] ?? 0)) best = r
      }
      slotUses[best.slot] = (slotUses[best.slot] ?? 0) + 1
      return best
    }
    /** 소비처로 가는 여행이 **어느 조건에서** 막혔는가(프레임 단위). */
    const tripBlock = { noFire: 0, cantBuy: 0, noGrowth: 0, cooling: 0, open: 0 }
    /** 🧾 12m 안으로 지나친 소비처 — 그때의 지갑까지(위 설계 노트). */
    const passBy = new Map()
    /**
     * 🧾 **소비처마다 실제로 얼마나 가까이 갔는가** — 보물과 같은 방식.
     *
     * ── 왜 필요해졌는가 ──────────────────────────────────────────
     * 두 계측기가 서로 다른 말을 합니다:
     *   · `npm run map` — 모루가 **주 동선에서 0m** (밟고 지나갑니다)
     *   · 봇 장부      — 판 전체에서 12m 안으로 지나친 소비처 **1곳**
     *                    (그것도 0초의 시작 화톳불, 지갑 0)
     *
     * 둘 다 참일 수는 없습니다. 그런데 `passBy` 는 **봇이 고른 `fire`**
     * 에 대해서만 적힙니다 — 봇이 엉뚱한 곳을 고르고 있으면, 다른
     * 소비처를 밟고 지나가도 장부에 한 줄도 안 남습니다. 즉 지금 장부는
     * *"소비처를 안 지나간다"* 와 *"고르는 규칙이 틀렸다"* 를 **못 가릅니다.**
     *
     * 그래서 고르는 규칙과 **무관하게** 모든 소비처의 최소 접근 거리를
     * 적습니다. 보물에서 바로 이 방식이 10m 짜리 범인을 찾아냈습니다.
     */
    const spendBest = {}
    let lastSpendScan = -99
    /**
     * 마지막으로 화톳불에 닿았을 때의 지갑. **늘어났을 때만** 다시 갑니다.
     *
     * 예전에는 한 번 들르면 60초 동안 안 갔습니다. 그래서 판마다 화톳불
     * 방문이 **딱 한 번**이었고, 그 한 번이 40.8초 — 불티 70을 들고 있을
     * 때였습니다. 성수병(60)을 사면 10이 남고, 무기(80)는 못 삽니다.
     * 그리고 존이 끝날 때까지 다시 안 갑니다: **불티 342 · 정련석 4를
     * 그대로 들고** 끝냈습니다. 한 판 수입의 절반 이상이 안 쓰였습니다.
     *
     * 시간으로 막으면 "살 수 있게 됐는데 못 간다"와 "살 것도 없는데
     * 오간다"를 못 가릅니다. **지갑으로 막으면** 둘 다 해결됩니다 —
     * 불티나 정련석이 늘지 않았으면 갈 이유가 없고, 늘었으면 갈 이유가
     * 생긴 것입니다. 사고 나면 다음 단계는 더 비싸니 저절로 멈춥니다.
     */
    let lastFireWallet = { embers: -1, stones: -1 }
    let fireCooldownUntil = 0
    /**
     * ── 💰 **무기 몫** — 규칙을 **한 곳에만** 둡니다 ────────────────────
     *
     * 정련석이 다음 단계에 충분하면, 그 단계의 불티는 성수병에 안 씁니다
     * (근거는 아래 구매 블록의 「정련석을 쥐고 있으면」 주석).
     *
     * ⚠️ 이 함수가 생긴 이유가 곧 사고 기록입니다. 예전에는 이 규칙이
     *    **구매 블록에만** 있었고, *"갈 이유가 있는가"* 를 정하는 위쪽
     *    관문은 그 규칙을 몰랐습니다. 그래서:
     *
     *      관문 : 불티 68 ≥ 성수병 60 → **갈 이유 있음**
     *      구매 : 68 − 무기몫 80 = −12 → **아무것도 못 삼**
     *
     *    봇은 모루에 도착해서 아무것도 못 사고, 관문은 여전히 참이라
     *    2.5초마다 다시 도착했습니다 — 한 판에서 **25초**를 그 자리에
     *    서 있었고(막힘 감지가 그제서야 잡았습니다), 그 25초는 그 판의 8%
     *    입니다. 벤치의 판별력을 통째로 갉아먹던 자리입니다.
     *
     *    이 저장소가 몇 번이나 적어 둔 그 모양입니다 — **같은 판단을 두 곳에
     *    적으면 언젠가 갈라집니다.** 갈라지면 사이에서 봇이 진동합니다.
     */
    const emberReserveOf = (w) => (w.nextCost > 0 && w.stones >= w.nextStoneCost ? w.nextCost : 0)
    /** 직전에 접은 소비처 — 같은 것을 연달아 접는 것은 한 사건입니다. */
    let lastSkipKey = ''
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
    let bossWeaponLevel = -1
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
    let bossRangeSamples = 0
    let bossInRangeSamples = 0
    let bossWindingSamples = 0
    const bossDist = { near: 0, mid: 0, far: 0, away: 0 }
    const bossPhaseTime = [0, 0, 0]
    let bossIntroTime = 0
    /**
     * ── 페이즈별 **실효 화력** ───────────────────────────────────────
     *
     * 지난 라운드에 3단계가 4.4~13초로 끝나는 것을 확인하고, 원인을
     * *"플레이어 화력이 전투 중에 올라가기 때문"* 이라고 적었습니다.
     * 그건 **가설이었지 관측이 아니었습니다.** 체력을 두 번 올리고
     * 경계를 한 번 옮기고도 안 고쳐졌으니, 이번엔 재고 나서 만집니다.
     *
     * 같은 체력 구간이라도 뒤로 갈수록 빨리 녹는다면 페이즈별 **초당
     * 피해**가 올라갑니다. 그리고 그 상승분이 어디서 오는지도 갈라야
     * 처방이 정해집니다 — 처형인가, 무방비 창인가, 그냥 익숙해진 것인가.
     */
    const bossPhaseDamage = [0, 0, 0]
    const bossPhaseFinishers = [0, 0, 0]
    const bossPhaseBreaks = [0, 0, 0]
    let lastBossFin = 0
    let lastBossPhase = -1
    /** 보스전 동안 보스가 각 상태에 머문 **초**. 합계 ≒ 보스전 시간. */
    const bossBudget = {
      windup: 0,
      active: 0,
      recovery: 0,
      cooldown: 0,
      broken: 0,
      transition: 0,
      idle: 0,
    }
    let bossBreaks = 0
    let bossWasStaggered = false
    /**
     * 보스가 **귀환(리셋)** 한 횟수와, 그 동안 흘러간 시간.
     *
     * ── 왜 이게 없으면 안 되는가 ──────────────────────────────────
     * 쿨다운·추격을 손보고 잰 판이 "보스전 106.5초"로 찍혔습니다. 그런데
     * 시간 예산을 다 더하면 44.4초밖에 안 됐고, 준 피해는 **689/620** 이었습니다.
     * 최대 체력보다 많이 넣었다는 건 **중간에 보스가 체력을 되찾았다**는 뜻입니다.
     *
     * 즉 그 106.5초는 "긴 보스전"이 아니라 "죽고 다시 걸어온 시간"이었습니다.
     * 이걸 안 세면 나는 방금 한 변경이 성공했다고 **오독할 뻔했습니다.**
     * 계기가 틀리면 없는 문제를 만들거나 있는 문제를 가립니다 — 또 한 번.
     */
    let bossResets = 0
    let bossDisengaged = 0
    let bossEngaged = 0
    let bossWasEngaged = false
    let lastBossSample = 0
    const bossAttackRange = G.enemyRoster().find((r) => r.id === 'boss')?.attackRange ?? 3.4
    let bossKilled = false
    let clearedAt = 0
    const notes = []
    /** 교전과 교전 사이의 빈 시간(초) 목록 */
    const gaps = []
    /** 그중 8초 이상인 것들의 **정황** — 어디서, 무엇을 하다, 죽었는지 */
    const longGaps = []
    const gapActs = new Map()
    let gapFrames = 0
    let gapDeaths = 0
    let gapStartRegion = ''
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
    let finisherNoStaminaSamples = 0
    /**
     * ── 기둥 1 을 재는 표본 ──────────────────────────────────────────
     * *"두 자원, 두 리듬"* 이 실제로 번갈아 오는지 봅니다. **교전 중에만**
     * 셉니다 — 걸어 다니는 동안은 쿨이 다 도니 당연히 "다 준비됨"이 되어
     * 숫자가 거짓말을 합니다.
     */
    /** 무기 id → 콤보 한 벌의 스태미나. 판 시작에 한 번만 읽습니다. */
    const weaponCost = Object.fromEntries(
      G.weaponTable().map((w) => [w.id, w.comboStamina]),
    )
    /**
     * ── 🟢 초록이 뜬 순간, 답할 수단이 있었는가 ──────────────────────
     *
     * 반격은 **스킬로만** 성립합니다(combat.ts 설계 노트 — 로스트아크가
     * 카운터를 카운터 스킬로 제한한 이유와 같습니다). 그런데 지난 라운드에
     * 쿨다운을 1.5배로 늘렸습니다. 그러면 초록이 떴는데 **누를 게 없는**
     * 경우가 늘어납니다.
     *
     * 그건 기둥 2의 공정함에 걸립니다. "내가 못 봤네"가 나오면 안 된다고
     * 적어 두었는데, **"봤는데 답할 수단이 없었다"** 도 같은 종류입니다.
     * 색을 보여 주고 답을 못 내게 하면 예고는 정보가 아니라 약 올리기가 됩니다.
     *
     * 다만 설계는 "놓쳐도 구르기라는 답이 남는다"고도 적어 두었습니다.
     * 그러니 **얼마나 자주인가**가 전부입니다. 드물면 판단이고, 대부분이면
     * 막다른 길입니다. 세면 갈립니다.
     */
    const greenSeen = new Set()
    /** 🛡 저스트 가드를 **시도한** 횟수. 성공 수는 게임이 셉니다(guardInfo().count). */
    let fieldsChecked = false
    /** 🛡 이미 센 🔴 예고 — 예고 하나를 한 번만 세기 위한 집합. */
    const guardSeen = new Set()
    /** 🛡 그 예고에서 창(남은 예고 ≤ 가드 창)을 **실제로 본** 적들. */
    const guardWindowSeen = new Set()
    let guardSawWindow = 0
    let guardOpens = 0
    let guardWhiffs = 0
    /** 🛡 읽기는 맞았는데 예고가 끊겨 **벌을 면제받은** 창의 수. */
    let guardSpared = 0
    let guardSparedOn = false
    /** 🛡 빈 창이 닫힌 이유별 횟수 — 처방이 갈리므로 합쳐 세지 않습니다. */
    const guardWhy = {}
    const guardWhyLog = []
    /** 🛡 누를 때 내가 읽고 있던 적 — 창이 닫힐 때 그 적의 상태를 봅니다. */
    let guardTarget = null
    /** 🛡 게임이 센 성공 횟수의 직전 값 — 성공한 창을 이유 표에서 빼는 데 씁니다. */
    let guardCountSeen = 0
    let guardWindowOpen = false
    let guardLockOn = false
    let guardBlockedByState = 0
    let guardTries = 0
    let greenEvents = 0
    let greenAnswerable = 0
    /** 예고 순간 **정면**에 있었던 횟수 / 정면 + 스킬까지 갖췄던 횟수. */
    /** 때릴 거리 안에 적이 있던 표본 / 그중 등 뒤를 잡고 있던 표본. */
    let behindSamples = 0
    let behindOk = 0
    let greenInFront = 0
    let greenReady = 0
    let rhythmSamples = 0
    /** 쓸 수 있는 스킬이 하나도 없던 표본 = **쿨다운 리듬이 압박이 된 시간** */
    let noSkillSamples = 0
    /** 스킬이 셋 이상 준비된 표본 = 쿨다운이 **제약이 아니었던** 시간 */
    let manySkillSamples = 0
    /** 스태미나가 기본 공격도 못 낼 만큼 낮던 표본 = **스태미나 리듬의 압박** */
    let noStaminaSamples = 0

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
    /** 💥 통마다: 가장 가까이 간 거리 · 사거리 안이었던 프레임 · 조건까지 맞은 프레임. */
    const barrelChance = {}
    /** 최근 90 프레임의 가지 — 막혔을 때 되감아 봅니다. */
    const recentActs = []
    const actTotals = new Map()
    const markAct = (name) => {
      act = name
      actTotals.set(name, (actTotals.get(name) ?? 0) + 1)
      recentActs.push(name)
      if (recentActs.length > 90) recentActs.shift()
    }

    /**
     * ── 이 기계가 **시뮬레이션 1초를 벽시계 몇 초에** 도는가 ──────────
     *
     * 이 값을 안 재고 있었기 때문에 벤치가 자기도 모르게 거짓말을 했습니다.
     * (아래 `simPerWall` 주석에 그 사고 기록이 있습니다.) 루프에 들어간
     * 순간부터 재야 합니다 — 브라우저를 띄우고 지도를 만드는 시간은
     * 판마다 거의 같고, 그건 "기계가 게임을 얼마나 빨리 도는가"가 아닙니다.
     */
    const botWallT0 = Date.now()
    /**
     * 그리고 **처음 몇 초는 빼고** 다시 잽니다.
     *
     * 루프에 막 들어간 브라우저는 아직 덜 데워져 있습니다(JIT·셰이더·텍스처).
     * 그 비용은 판 길이와 상관없이 거의 고정인데, 짧은 예비 판에서는 그게
     * 40초 전부에 퍼져 **기계가 실제보다 느려 보입니다.** 실제로 40초 예비
     * 판은 0.38, 190초를 끝까지 돈 판은 0.42가 나왔습니다.
     *
     * 예비 판으로 창 길이를 정할 참이니 이 차이가 그대로 창 길이의 오차가
     * 됩니다. 데워진 뒤부터 따로 재서, 창 계산이 **한 가지만** 보게 합니다.
     */
    const WARM_AFTER = 10
    let warmWallT0 = -1
    let warmSimT0 = -1
    const wallDeadline = botWallT0 + WALL * 1000
    let wallStopped = false
    while (now() - t0 < LIMIT) {
      if (warmWallT0 < 0 && now() - t0 >= WARM_AFTER) {
        warmWallT0 = Date.now()
        warmSimT0 = now()
      }
      // 벽시계 안전줄 — 기계가 느린 판을 통째로 잃지 않기 위한 것(위 설계 노트).
      if (Date.now() > wallDeadline) {
        wallStopped = true
        break
      }
      const st = G.state()
      const vi = G.vialInfo()
      const p = st.player

      /**
       * ── 💥 **안 쓴 통의 사연을 남깁니다** ──────────────────────────
       *
       * 판이 끝나고 *"통 2개 남음"* 만 보면 처방이 안 나옵니다. 남은 이유가
       * 둘이나 되기 때문입니다:
       *   · **곁에 간 적이 없다** → 배치가 동선에서 멀다 (지도 문제)
       *   · **곁에 갔는데 조건이 안 맞았다** → 둘 이상이 안 담겼다 (조건 문제)
       * 둘은 고치는 곳이 다릅니다. 그러니 **가장 가까이 간 거리**와
       * *"사거리 안에 있었던 프레임 수 / 그중 둘 이상 담긴 프레임 수"* 를
       * 통마다 따로 셉니다.
       *
       * ⚠️ 통이 터지면 목록에서 사라지므로, **키는 좌표**로 잡습니다.
       */
      if (BARREL_ON) {
        const bi0 = G.barrelInfo()
        const chanceReach = G.moveInfo().hitReach
        for (const b of bi0.barrels) {
          const key = `${b.x},${b.z}`
          const rec = (barrelChance[key] ??= { near: Infinity, inReach: 0, ready: 0 })
          const d = Math.hypot(b.x - p.x, b.z - p.z)
          if (d < rec.near) rec.near = d
          if (d <= chanceReach && b.fuseT <= 0) {
            rec.inReach++
            const caught = G.threats(bi0.blast + 2).filter(
              (t) => Math.hypot(t.x - b.x, t.z - b.z) <= bi0.blast,
            ).length
            if (caught >= 2) rec.ready++
          }
        }
      }

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
        walkedSince += Math.hypot(p.x - prevPos.x, p.z - prevPos.z)
        prevPos = p
        const moved = Math.hypot(p.x - lastPos.x, p.z - lastPos.z)
        const kills = G.runStats().kills
        if (moved > 1.5 || kills > lastKills) {
          lastPos = p
          lastKills = kills
          stuckSince = now()
          walkedSince = 0
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
              `순 이동 ${moved.toFixed(1)}m 인데 **걸은 거리 ${walkedSince.toFixed(1)}m**` +
              ` (걸은 거리도 0에 가까우면 **끼임**, 크면 **왕복**) · ` +
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
      /**
       * **보물을 실제로 주운 순간** 곁길 왕복을 닫습니다.
       *
       * 줍기는 키 입력이 아니라 **밟으면 됩니다**(TREASURE.pickupRadius).
       * 그래서 "도착했다"를 좌표로 판정하면 어긋납니다 — 게임이 세는
       * 숫자가 오르는 것을 그대로 신호로 씁니다.
       */
      {
        const found = G.state().treasureFound ?? 0
        if (detour) detour.damage += frameDamage
        if (found > lastTreasureCount) {
          if (detour) {
            detours.push({
              ...detour,
              took: Number((now() - detour.at).toFixed(1)),
              got: true,
            })
            detour = null
            treasureTripUntil = 0
          }
          lastTreasureCount = found
        }
      }
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
          if (lastCombatEnd > 0) {
            const secs = now() - lastCombatEnd
            gaps.push(secs)
            /**
             * **긴 빈 시간이 "어디서, 무엇을 하다" 생겼는지**도 남깁니다.
             *
             * 지난 라운드에 지도의 빈 구간 58m를 조합 둘로 잘라 평균을
             * 9.2초 → 6.0초로 줄였는데, **최장은 19초 그대로**였습니다.
             * 그때 "죽은 뒤 되돌아가는 길이거나 곁길일 것"이라고 적고
             * **추측이라고 표시**해 뒀습니다. 이번엔 셉니다.
             *
             * 정적 계측(map 프로브)은 주 동선만 봅니다. 봇은 화톳불로
             * 되돌아가고, 지름길을 열러 가고, 죽으면 부활 지점에서 다시
             * 걷습니다 — 그 시간은 지도에 안 보입니다.
             */
            if (secs >= 8) {
              const top = [...gapActs.entries()].sort((a, b) => b[1] - a[1])
              /**
               * ── 빈 시간을 **두 종류로 가릅니다** ────────────────────
               *
               * 지금까지 "교전 사이 빈 시간" 하나로 뭉쳐 재고 있었는데,
               * 그 안에 성질이 다른 둘이 섞여 있었습니다:
               *
               *   · **길 걷기**(목표이동·지름길이동) — 지도가 준 시간입니다.
               *     길면 그건 **설계 문제**입니다. 예전에 `npm run map` 이
               *     주 동선 188m 중 58m가 비었다고 잡아 준 그 종류입니다.
               *   · **심부름**(보물이동·강화이동·보급이동) — 플레이어가
               *     **스스로 고른** 시간입니다. 길다고 문제가 아닙니다.
               *     오히려 곁길과 강화가 살아 있다는 뜻입니다.
               *
               * 섞어 두면 둘 중 무엇이 늘었는지 알 수 없고, 실제로 이번에
               * 그럴 뻔했습니다 — 보물을 주 동선으로 옮기자 최장 빈 시간이
               * 10.4 → 15.8초로 늘어서 "흐름이 나빠졌다"로 읽힐 뻔했는데,
               * 늘어난 것은 전부 **계단에서의 심부름**이었습니다.
               */
              const errandFrames = [...gapActs.entries()]
                .filter(([k]) => k === '보물이동' || k === '강화이동' || k === '보급이동')
                .reduce((a, [, v]) => a + v, 0)
              longGaps.push({
                at: Number((now() - t0).toFixed(0)),
                secs: Number(secs.toFixed(1)),
                /** 이 빈 시간의 절반 이상을 심부름에 썼는가 */
                errand: errandFrames > gapFrames / 2,
                where: `${gapStartRegion} → ${curRegion}`,
                did: top
                  .slice(0, 3)
                  .map(([k, v]) => `${k} ${Math.round((v / Math.max(1, gapFrames)) * 100)}%`)
                  .join(' '),
                died: gapDeaths,
              })
            }
          }
          wasInCombat = true
        } else if (!inCombat && wasInCombat) {
          wasInCombat = false
          lastCombatEnd = now()
          gapActs.clear()
          gapFrames = 0
          gapDeaths = 0
          gapStartRegion = curRegion
        }
        if (!inCombat && lastCombatEnd > 0) {
          gapFrames++
          gapActs.set(act, (gapActs.get(act) ?? 0) + 1)
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
        /**
         * 두 리듬의 압박을 **같은 자리에서** 셉니다. 따로 재면 "둘 다
         * 압박이었던 순간"과 "둘 다 여유였던 순간"이 안 보입니다.
         */
        rhythmSamples++
        /**
         * **등 뒤를 잡고 있던 시간**을 셉니다 — DESIGN.md 가 남겨 둔 질문의 답입니다.
         *
         * 백어택이 총 타격의 5~7% 인데, 원인 후보가 둘이고 처방이 정반대입니다:
         *   · **기회가 없다**(적이 계속 돌아본다)  → 적 회전 속도·반응 지연
         *   · **잡고도 안 친다**(붙어만 있다)      → 봇 행동 / 스킬 도형
         *
         * 갈리는 방법은 반격에서 쓴 것과 같습니다 — **시간과 결과를 같이**
         * 봅니다. 등 뒤에 있던 시간이 5% 면 기회가 없는 것이고, 30% 인데
         * 타격의 5% 만 등 뒤면 잡고도 안 치는 것입니다.
         *
         * ⚠️ 앞뒤 판정은 게임의 `inFront` 를 그대로 씁니다(각도 규칙을 봇이
         * 다시 계산하면 한쪽만 낡습니다). 그리고 **때릴 수 있는 거리**(3m)
         * 안에 있을 때만 셉니다 — 멀리서 등 뒤에 서 있는 시간은 기회가
         * 아닙니다.
         */
        {
          const close = G.threats(3).filter((t) => t.aggro)
          if (close.length) {
            behindSamples++
            if (close.some((t) => !t.inFront)) behindOk++
          }
        }
        const slots = G.slotCooldowns().filter((sl) => !sl.empty)
        const readyNow = slots.filter((sl) => sl.cd <= 0).length
        /**
         * 🟢 예고는 **올라가는 순간에만** 셉니다. 프레임마다 세면 예고가
         * 긴 패턴일수록 커져서, 횟수가 아니라 시간을 재게 됩니다.
         */
        for (const t of G.threats(12)) {
          if (!t.winding || t.intent !== 4) {
            greenSeen.delete(t.entity)
            continue
          }
          if (greenSeen.has(t.entity)) continue
          greenSeen.add(t.entity)
          greenEvents++
          if (readyNow > 0) greenAnswerable++
          /**
           * **예고가 뜬 그 순간 내가 정면에 있었는가.**
           *
           * 반격 조건 셋 중 2번이 "정면"입니다(combat.ts). 그런데 봇에는
           * 백어택을 노려 **등 뒤로 도는** 루틴이 있습니다 — 두 보상이
           * 정반대 위치를 요구합니다.
           *
           * 지금 깔때기가 이렇습니다:
           *   초록 예고 6~9회 → 답할 스킬 있음 3~6회 → **실제 반격 0~1회**
           * 스킬은 병목이 아니고(67~75%), 마지막 칸에서 대부분이 샙니다.
           * 그 손실이 **위치** 때문인지 타이밍 때문인지는 처방이 다릅니다
           * (전자는 설계·안내, 후자는 예고 길이·사거리).
           *
           * ⚠️ 정면 여부는 **게임이 판단한 값**(`inFront`)을 그대로 씁니다.
           * 봇이 각도를 다시 계산하면 규칙을 바꿨을 때 한쪽만 낡습니다 —
           * 이번 세션에서 그 실수를 이미 여러 번 고쳤습니다.
           */
          if (t.inFront) greenInFront++
          if (t.inFront && readyNow > 0) greenReady++
        }
        if (readyNow === 0) noSkillSamples++
        if (readyNow >= 3) manySkillSamples++
        /**
         * ⚠️ `state().weapon` 은 **문자열 id** 입니다(숫자 인덱스가 아님).
         * 표를 그걸로 색인하면 undefined → NaN → 비교가 늘 거짓이 되어
         * 이 눈금이 조용히 **항상 0** 이 됩니다. 열세 번째 계기 버그가 될
         * 뻔한 자리라, id 로 찾습니다. 표는 판 시작에 한 번만 읽습니다.
         */
        const wcost = weaponCost[st.loadout?.weapon] ?? 0
        if (wcost > 0 && st.player.stamina < wcost / 3) noStaminaSamples++
        const fi = G.finisherInfo()
        if (fi.ready) {
          finisherReadySamples++
          /**
           * ⚠️ 예전엔 여기서 `state === 0`(가만히 서 있음)을 세고 "곧바로
           * 누를 수 있던 프레임"이라고 불렀습니다. 판마다 **0** 이 찍혔는데,
           * 같은 판에 처형은 7회 들어갔습니다 — 앞뒤가 안 맞습니다.
           * 게임은 콤보 끝과 스킬 후딜에서도 처형을 **버퍼로 받아** 줍니다.
           * 그러니 "서 있어야 누를 수 있다"는 전제 자체가 틀렸습니다.
           *
           * 대신 **진짜 막는 것**을 셉니다: 스태미나입니다.
           */
          if (st.player.stamina < fi.staminaCost) finisherNoStaminaSamples++
        }
        const brokenNear = G.threats(6).find((t) => t.entity !== undefined && G.enemyInfo(t.entity)?.broken)
        if (brokenNear) {
          brokenSamples++
          // '처형' 도 창을 쓰는 행동입니다. 새 가지를 만들고 여기 안 넣으면
          // 활용률이 **구조적으로 0%** 가 됩니다(실제로 그렇게 찍혔습니다).
          if (act === '공격' || act === '반격' || act === '처형') brokenUsedSamples++
        }
      }

      /**
       * ── 구역별 **위험도** ────────────────────────────────────────
       *
       * 지금까지 구역별로 잰 것은 "얼마나 오래 있었나"뿐이었습니다.
       * 그건 지도가 넓은지를 말할 뿐, **난이도 곡선**은 말하지 않습니다.
       *
       * 소울류 레벨은 올라갑니다 — 첫 구간은 조작을 익히는 곳이고, 보스
       * 직전이 가장 위험합니다. 우리 존도 그렇게 적어 뒀지만(생성기 주석의
       * "전투 동사를 순서대로 가르친다"), **한 번도 확인한 적이 없습니다.**
       * 곡선이 평평하거나 거꾸로면 조합을 옮겨야 합니다.
       *
       * 시간으로 나눕니다 — 넓어서 오래 걸린 구역과 위험해서 오래 걸린
       * 구역을 가르지 못하면 "넓은 곳이 위험한 곳"이 되어 버립니다.
       */
      if (curRegion) {
        const r = (regionDanger[curRegion] ??= {
          damage: 0,
          seconds: 0,
          combat: 0,
          swings: 0,
          kills: 0,
        })
        const dt = Math.max(0, now() - lastRegionSample)
        r.damage += frameDamage
        r.seconds += dt
        /**
         * ⚠️ **"피해 0"이 "위협 없음"을 뜻하지는 않습니다.**
         *
         * 첫 측정에서 함몰지 가장자리가 분당 0으로 나왔습니다. 그런데 거기엔
         * 지난 라운드에 넣은 조합 7이 있고, 봇은 12.7초를 머물렀습니다.
         * 싸움이 아예 없었던 것인지, 싸웠는데 잘 막아낸 것인지 —
         * 피해 하나로는 갈리지 않습니다. 그래서 **교전 시간과 적의 휘두름**을
         * 같이 셉니다. 셋을 함께 봐야 "안전한 구간"과 "쉬운 구간"이 갈립니다.
         */
        if (G.threats(12).some((t) => t.aggro)) r.combat += dt
        const sw = G.runStats().enemySwings
        if (sw > lastSwings) r.swings += sw - lastSwings
        lastSwings = sw
        const kl = G.runStats().kills
        if (kl > lastRegionKills) r.kills += kl - lastRegionKills
        lastRegionKills = kl
      }
      lastRegionSample = now()

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
      /**
       * ⚠️ **클리어 판정은 게임에게 맡깁니다.**
       *
       * 예전엔 `enemiesLeft === 0` 을 같이 봤습니다. 그런데 존의 끝이
       * "보스 처치"로 바뀌면서 그 조건은 **영원히 참이 되지 않습니다**
       * (보스를 잡아도 잡몹은 남아 있으니까요). 봇이 클리어를 놓치고
       * 제한 시간까지 헤매게 됩니다 — 게임의 규칙을 봇이 따로 적어 두면
       * 규칙을 바꿀 때마다 이런 일이 생깁니다.
       */
      const cleared = st.gameOver && p.hp > 0
      if (cleared) {
        notes.push({ at: Number((now() - t0).toFixed(1)), what: '★ 존 클리어', region: curRegion })
        clearedAt = now() - t0
        releaseAll()
        break
      }
      if (p.hp <= 0 || st.gameOver) {
        gapDeaths++
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
      /**
       * 🧭 **곁길끼리는 가까운 쪽이 이깁니다.**
       *
       * ── 무엇이 잘못돼 있었는가 ────────────────────────────────────
       * 봇에는 곁길이 셋(보물·지름길·모루) 있고, 셋이 **고정된 if 순서**로
       * 놓여 있었습니다. 위에 있는 것이 무조건 이깁니다. 그래서 이런 판이
       * 나왔습니다:
       *
       *     (27, -43)  가장 가까이 **10m** · 그때 막던 것: **가는중**
       *
       * 보물을 향해 걷고 있었는데, 32m 밖 사다리가 위 가지에 있다는
       * 이유만으로 봇이 방향을 틀었습니다. **10m 앞의 상자를 두고
       * 32m 를 걸어간 것**입니다. 사람은 그러지 않습니다.
       *
       * 이건 밸런스가 아니라 **계측기의 정직함** 문제입니다. 기둥 4가 묻는
       * 것은 *"곁길에 갈지 말지의 선택이 좋은 선택인가"* 인데, 봇이 자기
       * if 순서를 재고 있으면 그 질문에 답할 수가 없습니다.
       *
       * 그래서 프레임마다 한 번 **가장 가까운 미획득 보물**을 구해 두고,
       * 다른 곁길 가지들이 그보다 멀면 물러나게 합니다. 규칙은 하나뿐이고
       * 사람의 규칙과 같습니다 — **눈앞의 것부터.**
       */
      let nearTreasure = null
      for (const t of G.treasurePositions()) {
        if (t.taken) continue
        const ts = G.pathStep(t.x, t.z)
        if (!ts) continue
        if (nearTreasure === null || ts.dist < nearTreasure.dist) {
          nearTreasure = { goal: t, step: ts, dist: ts.dist, key: `${Math.round(t.x)},${Math.round(t.z)}` }
        }
      }
      /** 예산 안에 있는 보물만 다른 곁길을 밀어낼 자격이 있습니다. */
      const treasureClaims = (otherDist) =>
        nearTreasure !== null && nearTreasure.dist <= TREASURE_DETOUR && nearTreasure.dist < otherDist
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
        /**
         * **보스 앞에 설 때의 무기 강화 단계.**
         *
         * 실험대(`npm run pace`)가 강화 단계 하나만 바꿔 재 보니 3단계가
         * 이렇게 갈렸습니다: +0 처치 0/2 · +2 처치 1/2 · +5 처치 2/2.
         * 그러니 "실제 플레이에서 보스 앞에 설 때 몇 단계인가"가 곧
         * **3단계가 벽인지 관문인지**를 정합니다.
         *
         * 지금까지 벤치는 `무기 강화 N회` 만 냈습니다. 그건 **누른 횟수**이지
         * 도달한 단계가 아닙니다 — 무기를 바꿔 가며 올렸다면 한 무기의
         * 단계는 그보다 낮습니다. 결론을 가르는 값이므로 직접 읽습니다.
         */
        bossWeaponLevel = G.state().loadout.weaponLevel
        // ⚠️ 여기서 **처음 맞춰 둡니다.** 0으로 두면 첫 프레임에
        // "지금까지 흐른 시간 전부"가 1단계에 더해집니다 —
        // 실제로 1단계가 113초로 찍혔습니다(보스전은 25초인데).
        lastBossSample = now()
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
        /**
         * **페이즈마다 몇 초를 보냈는가.**
         *
         * 연계(🔵→🔴, 🟣→🔴, 🔵→🟡)는 2·3페이즈에만 걸려 있습니다.
         * 그 페이즈가 몇 초 안 되면 연계는 나올 수가 없습니다 —
         * "연계가 0회"의 답이 밸런스인지 시간인지가 여기서 갈립니다.
         */
        // ⚠️ **조우 중일 때만** 셉니다. 처음엔 보스가 레벨에 존재하기만 하면
        // 세어서, 1단계가 103초로 찍혔습니다 — 그 대부분은 플레이어가 존
        // 반대편을 걷던 시간이었습니다.
        const dtB = Math.max(0, now() - lastBossSample)
        // ⚠️ encounter 3 = **귀환 중**입니다. 이것도 "> 0" 이라, 예전 코드는
        // 보스가 자리로 걸어 돌아가는 시간까지 페이즈 시간에 더하고 있었습니다.
        const engaged = be.encounter > 0 && be.encounter < 3
        if (engaged) {
          /**
           * ⚠️ **인트로(encounter 1)를 1단계에 더하고 있었습니다.**
           *
           * 조우 연출 동안 보스는 노려보기만 합니다 — 싸움이 아닙니다.
           * 그걸 1단계에 얹으면 1단계가 실제보다 길어 보이고, 실제로 저는
           * 그 숫자를 보고 *"1단계가 보스전의 절반을 먹는다"* 를 두 번
           * 적었다가 두 번 물렸습니다(DESIGN.md 「두 번 적었다가…」).
           * `npm run boss` 가 같은 자리에서 인트로를 따로 세도록 고치고 나서야
           * 여기도 같은 고장인 것을 알았습니다 — **한 번 고친 고장은 다른
           * 계기에도 있는지 찾아봐야 합니다.**
           */
          if (be.encounter === 1) bossIntroTime += dtB
          else bossPhaseTime[Math.min(2, be.phase)] += dtB
          bossEngaged += dtB
        } else if (bossSeen) bossDisengaged += dtB
        if (!engaged && bossWasEngaged) {
          bossResets++
          /**
           * 초기화되면 **누적을 버리고 다시 셉니다.**
           * 안 그러면 "준 피해 689/620" 처럼 최대 체력보다 큰 값이 나와서,
           * 숫자를 보는 사람이 무엇을 믿어야 할지 알 수 없게 됩니다.
           * 보고하는 것은 언제나 **마지막(성공한) 시도** 기준입니다.
           */
          bossDamageDealt = 0
          bossDamageTaken = 0
          bossPhaseTime[0] = 0
          bossPhaseTime[1] = 0
          bossPhaseTime[2] = 0
          bossIntroTime = 0
          bossEngaged = 0
          bossBreaks = 0
          bossPhaseDamage[0] = 0
          bossPhaseDamage[1] = 0
          bossPhaseDamage[2] = 0
          bossPhaseFinishers[0] = 0
          bossPhaseFinishers[1] = 0
          bossPhaseFinishers[2] = 0
          bossPhaseBreaks[0] = 0
          bossPhaseBreaks[1] = 0
          bossPhaseBreaks[2] = 0
          lastBossPhase = -1
          for (const k of Object.keys(bossBudget)) bossBudget[k] = 0
        }
        bossWasEngaged = engaged
        /**
         * ── 보스의 **시간 예산** ─────────────────────────────────────
         *
         * 왜 이걸 재는가: 보스전 32초에 보스가 **6번** 휘둘렀습니다.
         * 5.4초에 한 번입니다. 참고한 게임들(엘든 링·세키로·오공)의 보스는
         * 1.5~2.5초에 한 번 움직입니다. 3페이즈·5패턴·연계까지 얹은 설계는
         * **2분짜리 싸움의 분량**인데, 실제로는 32초 만에 끝납니다.
         *
         * "왜 안 휘두르나"의 답은 하나가 아닙니다 — 무너져 있었을 수도,
         * 페이즈 전환 중이었을 수도, 쿨다운이었을 수도, 사거리 밖이었을
         * 수도 있습니다. **네 개는 각각 다른 처방**을 부릅니다:
         *   · 무너짐이 크다   → 강인도가 너무 쉽게 깨진다
         *   · 전환이 크다     → 전환 시간이 길거나 페이즈가 잦다
         *   · 쿨다운이 크다   → attackCooldown / cooldownScale
         *   · 대기·이동이 크다 → 보스가 못 따라온다(이동속도·길찾기)
         *
         * 그래서 나눠 담습니다. 합계는 보스전 시간과 같아야 합니다.
         */
        const bi = G.enemyInfo(be.entity)
        if (engaged && bi) {
          if (bi.transitionT > 0) bossBudget.transition += dtB
          else if (bi.staggered) bossBudget.broken += dtB
          else if (bi.attacking) {
            bossBudget[bi.attackPhase === 0 ? 'windup' : bi.attackPhase === 1 ? 'active' : 'recovery'] += dtB
          } else if (bi.cooldownT > 0) bossBudget.cooldown += dtB
          else bossBudget.idle += dtB
          // 무너진 **횟수**는 올라가는 순간에만 셉니다(프레임마다 세면 시간이 됩니다).
          if (bi.staggered && !bossWasStaggered) {
            bossBreaks++
            bossPhaseBreaks[Math.min(2, be.phase)]++
          }
          bossWasStaggered = bi.staggered
        }
        bossSamples++
        const dmg = Math.max(0, lastBossHp - be.hp)
        if (lastBossHp > 0) bossDamageDealt += dmg
        /**
         * ⚠️ **직전 프레임의 페이즈**에 얹습니다.
         *
         * `dmg` 는 (지난 프레임 체력 − 지금 체력)이므로 **지난 프레임에**
         * 일어난 일입니다. 지금 페이즈에 얹으면 전환을 일으킨 그 타격이
         * 새 페이즈의 화력으로 잡힙니다.
         *
         * ⚠️ 그리고 여기서 열세 번째 계기 버그를 잡았습니다. 처음엔
         * `be.transitionT <= 0` 으로 전환 중을 걸렀는데, `bossEncounter()`
         * 는 **transitionT 를 주지 않습니다.** `undefined <= 0` 이 늘 거짓이라
         * 조건이 통째로 막혀서 **세 페이즈 전부 피해 0** 이 찍혔습니다.
         * 총 피해는 613인데 합이 0 — 숫자끼리 안 맞아서 바로 걸렸습니다.
         * (전환 중에는 보스가 무적이라 애초에 걸러 낼 피해가 없습니다.)
         */
        const ph = Math.min(2, lastBossPhase < 0 ? be.phase : lastBossPhase)
        if (engaged && lastBossHp > 0) bossPhaseDamage[ph] += dmg
        lastBossPhase = be.phase
        const finNow = G.runStats().bossFinishers
        if (finNow > lastBossFin) {
          bossPhaseFinishers[ph] += finNow - lastBossFin
          lastBossFin = finNow
        }
        lastBossHp = be.hp
        bossMaxHp = be.maxHp
        bossDamageTaken += frameDamage
        if (p.hp < bossMinHp) bossMinHp = p.hp
        /**
         * **보스가 때릴 수 있는 자리에 있던 시간**을 셉니다.
         *
         * 보스가 41초에 4번밖에 안 휘둘렀습니다. 원인이 "예고가 길어 다 피한다"가
         * 아니라 **애초에 공격을 못 한다**일 수 있습니다 — 보스는 2.4m/s 인데
         * 플레이어는 5.4m/s 이고, 회전도 100°/s 로 느립니다. 사거리 안에 있던
         * 시간이 짧으면 그건 AI 문제이지 밸런스 문제가 아닙니다.
         */
        lastBossSample = now()
        bossRangeSamples++
        const bt = G.threats(40).find((t) => t.entity === be.entity)
        if (bt && bt.dist <= bossAttackRange) bossInRangeSamples++
        if (bt && bt.winding) bossWindingSamples++
        /**
         * **보스와의 거리 분포** — 어떤 색이 나올 수 있었는지를 결정합니다.
         *
         * 보스의 패턴은 거리로 걸러집니다: 직격 0~4m · 광역 0~6.5m ·
         * **속박 2.5~9m** · 갈고리 5~11m · 돌진 3~10m.
         * 그리고 2·3페이즈의 연계는 전부 **속박과 갈고리**에 걸려 있습니다.
         * 즉 플레이어가 계속 코앞에 붙어 있으면 연계는 **구조적으로**
         * 한 번도 나올 수 없습니다. 그게 사실인지 거리로 확인합니다.
         */
        if (bt) {
          if (bt.dist < 2.5) bossDist.near++
          else if (bt.dist < 5) bossDist.mid++
          else if (bt.dist < 9) bossDist.far++
          else bossDist.away++
        }
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
      /**
       * ── 💥 **불붙은 통 안에 있으면 나갑니다 — 무엇보다 먼저** ──────────
       *
       * 통이 만드는 것은 🟡 이고, 🟡 의 답은 *"걸어서 이탈"* 입니다. 이
       * 봇의 원칙(*"게임이 화면에 띄워 주는 것은 읽는다"*)대로 하면 여기서
       * 다른 선택지는 없습니다 — 노란 원이 차오르는 것은 화면 한가운데
       * 크게 뜨고, 사람이라면 반드시 봅니다.
       *
       * **처형보다도 먼저** 둡니다. 처형은 0.5초짜리 확정 보상이지만,
       * 그 0.5초를 쓰다 휘말리면 스태미나 두 번 분을 잃고 **그 뒤로 아무
       * 답도 못 합니다.** 이 게임에서 스태미나는 다음 몇 초의 선택지
       * 그 자체입니다.
       *
       * ⚠️ 반경도 통의 자리도 **게임에게 묻습니다**(`barrelInfo`). 봇이
       *    4m 를 들고 있으면 값을 바꾸는 날 봇만 옛 규칙으로 도망칩니다.
       * ⚠️ 여유 1m: 경계에 정확히 서면 몸 굵기 때문에 걸립니다
       *    (폭발 판정이 `반경 + 대상 굵기` 라 — combat.ts `explodeBarrel`).
       */
      if (BARREL_ON) {
        const bi = G.barrelInfo()
        let flee = null
        for (const b of bi.barrels) {
          if (b.fuseT <= 0) continue
          const d = Math.hypot(b.x - p.x, b.z - p.z)
          if (d > bi.blast + 1) continue
          if (!flee || d < flee.d) flee = { b, d }
        }
        if (flee) {
          markAct('통대피')
          release('ShiftLeft')
          // 통의 반대쪽으로 **곧장** 걷습니다. 길찾기를 태우지 않는 이유:
          // 도화선은 1초뿐이고, 그 안에 통하는 것은 직선뿐입니다.
          moveToward(p.x - flee.b.x, p.z - flee.b.z)
          await sleep()
          continue
        }
      }

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

        /**
         * ⚠️ **9 는 제가 봇에 적어 둔 숫자였습니다.**
         *
         * 끄는 자의 갈고리와 궁수의 화살은 **12m** 입니다. 9m 로 물으면
         * 그 예고는 목록에 **들어오지도 않습니다.** 그래서 앞 회차에 넣은
         * `willReach`("이 한 대가 나에게 닿는가")도 소용이 없었습니다 —
         * 없는 적에게는 물어볼 수가 없으니까요. 벤치가 그 결과를 이렇게
         * 찍었습니다:
         *
         *     6대  안누름  🟣끌어당김  정답: 거리 두기  **발: 다가감**
         *
         * *"거리를 두라"* 는 예고가 떠 있는데 **오히려 다가가고** 있었습니다.
         * 답을 몰라서가 아니라 **예고가 있는 줄도 몰랐던** 것입니다.
         *
         * 이제 게임에게 묻습니다(`threatRange()` = 가장 먼 사거리 + 내 몸
         * 굵기). 사거리 큰 적을 새로 넣는 날 봇이 저절로 따라옵니다.
         * 같은 모양으로 네 번 데인 뒤에 배운 것: **문턱은 규칙이지
         * 리터럴이 아닙니다.**
         */
        const threats = G.threats(G.threatRange())
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
          tap(pickSkill(ready).key)
          await sleep()
          continue
        }

        /**
         * 🛡 **저스트 가드 — 🔴 직격에만, 그리고 구르기보다 먼저.**
         *
         * ── 왜 봇에게 가르치는가 ────────────────────────────────────
         * 이 저장소가 기둥 3 에서 한 번 크게 데었습니다: 봇에 **돌아가는
         * 가지가 없어서** 백어택이 6~7%에 머물렀고, 여러 라운드 동안
         * *"기둥 3 이 왜 안 돌지"* 를 게임 쪽에서 찾았습니다. 없는 행동은
         * 아무리 보상을 붙여도 안 일어나고, 그러면 그 기둥은 **영영
         * 측정되지 않습니다.**
         *
         * 저스트 가드도 똑같은 자리에 있었습니다 — 프로브(`npm run parry`)는
         * 되는 것을 확인했지만, 봇이 모르면 **앞으로의 모든 밸런스 숫자가
         * 플레이어의 답 하나를 빼놓고** 나옵니다.
         *
         * ── 커밋이 필요합니다 ──────────────────────────────────────
         * 창은 0.18초인데 예고는 0.55초입니다. 예고를 보자마자 구르면
         * 창이 오기 전에 이미 굴러 있습니다 — 그래서 가드는 **영영 안
         * 나옵니다.** 사람도 같습니다: 막기로 마음먹으면 그때까지 **기다려야**
         * 합니다. 그 기다림이 곧 위험이고, 그게 이 기술의 값입니다.
         *
         * 다만 **아무 때나 커밋하지는 않습니다.** 남은 예고가 창의 2.5배
         * 안으로 들어왔을 때만 붙잡습니다. 그보다 이르면 평소대로 구릅니다 —
         * 초보자가 "빨간 게 보이자마자 막기 자세"를 잡지는 않습니다.
         */
        /**
         * ⚠️ **봇이 읽는 칸이 실제로 있는지 한 번 확인합니다.**
         *
         * 저스트 가드 가지가 `t.timer` 를 읽는데 `threats()` 에 그 칸이
         * 없었습니다. `undefined <= 0.45` 는 언제나 거짓이라 가지가 통째로
         * 죽었고, **한 판을 다 돌고 나서야** 시도 0회로 들켰습니다.
         * 기둥 3 이 `near.entity` 가 없어서 여러 라운드 죽어 있던 것과
         * 같은 모양입니다 — JS 는 없는 칸을 조용히 `undefined` 로 줍니다.
         *
         * 그래서 **첫 위협을 만나는 순간 큰 소리로 죽습니다.** 8분을 돌고
         * 0을 보는 것보다, 3초 만에 이름을 대며 멈추는 쪽이 낫습니다.
         */
        if (!fieldsChecked && threats.length > 0) {
          fieldsChecked = true
          for (const k of ['entity', 'x', 'z', 'dist', 'intent', 'winding', 'inFront', 'timer', 'willReach', 'facing']) {
            if (!(k in threats[0])) throw new Error(`threats() 에 '${k}' 칸이 없습니다`)
          }
        }
        const gi = G.guardInfo()
        // 🛡 무적 창(0.06~0.3초)을 **게임에게 묻습니다** — 아래 구르기 가지가 씁니다.
        const di = G.dodgeInfo()
        /**
         * 🛡 **연 횟수와 헛친 횟수를 직접 셉니다.**
         *
         * "못 낸 자리"가 9 → 12로 **늘어난 것**이 이 눈금을 만든 이유입니다.
         * 넓혔는데 나빠졌다면 기제가 하나 있습니다: 창을 열면 그동안(0.18초)과
         * 잠긴 동안(0.35초)은 `canGuard` 가 거짓이라, **헛친 가드가 다음
         * 기회를 스스로 지웁니다.** 그러면 눌러 볼수록 못 내게 됩니다.
         *
         * 그게 사실이면 고칠 곳은 게임(창·값)이 아니라 **봇이 언제 누르는가**
         * 입니다. 연 횟수 ≫ 성공이면 스팸이고, 연 횟수 ≈ 성공이면 아닙니다.
         */
        /**
         * 🛡 **면제받은 창을 따로 셉니다.**
         *
         * *"창을 연 것 19회 · 헛친 것 19회"* 였을 때, 그 19가 **내가 늦게
         * 눌러서**인지 **읽은 예고가 끊겨서**인지 가를 자료가 없었습니다.
         * 처방이 정반대인데(봇을 고칠 것인가 · 게임을 고칠 것인가) 합쳐
         * 두면 영영 모릅니다. 이제 게임이 표시를 붙여 주므로 그 표시가
         * 올라가는 순간을 셉니다.
         */
        if (gi.spared && !guardSparedOn) guardSpared++
        guardSparedOn = gi.spared
        /**
         * ── 🛡 **빈 창이 왜 비었는지를 그 자리에서 적습니다** ─────────
         *
         * 한 판이 이렇게 나왔습니다 — `창을 연 것 15회 · 헛친 것 15회 ·
         * **끊겨서 면제 0회** · 성공 0회`. 즉 *"내가 무너뜨려 예고가
         * 끊겼다"* 는 가설은 **틀렸습니다**(면제가 0이니까). 그런데
         * `npm run parry` 의 ⑥ 은 봇의 **같은 규칙**으로 1:1 에서 2/3 을
         * 막습니다. 창도 규칙도 멀쩡한데 실전에서만 0 입니다.
         *
         * 남은 후보가 여럿이고 처방이 다 다릅니다 — 적이 죽었다 · 아직
         * 예고 중인데 일찍 눌렀다 · 이미 판정이 지나갔다 · 멀어졌다.
         * **합쳐 두면 영영 모릅니다.** 그래서 창이 닫히는 순간에 내가
         * 읽고 있던 그 적의 상태를 그대로 찍습니다.
         */
        if (guardWindowOpen && gi.windowT === 0 && guardTarget) {
          const t = guardTarget
          /**
           * ⚠️ **성공한 창은 빼고 셉니다.**
           *
           * 막으면 combat.ts 가 `guardT` 를 0 으로 **지웁니다**. 즉 성공도
           * 창이 닫히는 사건이라, 처음엔 성공까지 *"빈 창이 닫힌 이유"* 로
           * 세고 있었습니다 — `헛친 것 2회` 옆에 이유가 **10회**로 찍혀서
           * 들켰습니다. 눈금이 자기가 세는 것을 잘못 알고 있었던 것이고,
           * 이 저장소가 계속 잡아 온 그 모양입니다.
           *
           * 성공 여부는 **게임의 카운터**로 가릅니다 — 봇이 따로 판단하면
           * 판정과 눈금이 갈라집니다.
           */
          const won = gi.count > guardCountSeen
          guardCountSeen = gi.count
          const cur = won ? null : G.enemyInfo(t.entity)
          if (!won) {
            const p2 = G.state().player
            let why
            if (!cur || cur.hp <= 0) why = '적이죽음'
            else if (cur.winding) why = '아직예고중'
            else if (cur.attacking) why = '판정지나감'
            else why = '예고가사라짐'
            const d = cur ? Math.hypot(cur.x - p2.x, cur.z - p2.z) : -1
            guardWhy[why] = (guardWhy[why] ?? 0) + 1
            if (guardWhyLog.length < 8) {
              guardWhyLog.push(
                `${why} (누를때 남은예고 ${t.left}초 · 거리 ${t.dist}→${d < 0 ? '?' : d.toFixed(1)}m)`,
              )
            }
          }
          guardTarget = null
        }
        if (gi.windowT > 0 && !guardWindowOpen) guardOpens++
        guardWindowOpen = gi.windowT > 0
        if (gi.lockT > 0 && !guardLockOn) guardWhiffs++
        guardLockOn = gi.lockT > 0
        /**
         * ⚠️ **닿는 공격만 붙잡습니다.**
         *
         * 처음엔 `dist < 4.5` 로 붙잡았는데, 잡몹 찌르기는 사거리가 2.5m
         * 입니다. 닿지도 않을 공격을 막으려고 창을 열고 기력을 냈고,
         * 그래서 **연 것이 전부 헛쳤습니다**(5회 열어 5회 헛침, 성공 0).
         *
         * 거리를 봇이 판단하면 밸런스를 바꾸는 날 봇만 옛 값을 씁니다 —
         * `willReach` 는 게임이 판정과 같은 식으로 계산해 줍니다.
         */
        const strike = threats.find(
          (t) => t.winding && t.intent === 0 && t.willReach && t.timer <= gi.window * 2.5,
        )
        /**
         * ⚠️ **예고 하나를 한 번만 셉니다.**
         *
         * 처음엔 이 가지에 들어올 때마다 셌습니다. 봇은 8ms마다 도는데
         * 게임은 10fps 라, 한 예고에서 수십 번 들어옵니다 — 한 판에
         * **2530회**가 찍혔고 그건 시도가 아니라 **프레임 수**였습니다.
         * (성공 1회와 나란히 놓으면 0% 인데, 그 0% 는 아무 뜻이 없습니다.)
         *
         * 초록 예고를 세는 쪽이 이미 같은 규칙을 씁니다 — *"올라가는 순간에만
         * 셉니다. 프레임마다 세면 예고가 긴 패턴일수록 커져서, 횟수가 아니라
         * 시간을 재게 됩니다."* 그 규칙을 여기에도 씁니다.
         */
        if (strike && !guardSeen.has(strike.entity)) {
          guardSeen.add(strike.entity)
          guardTries++
        }
        for (const id of [...guardSeen]) {
          if (!threats.some((t) => t.entity === id && t.winding)) guardSeen.delete(id)
        }
        /**
         * **낼 수 있는지는 게임에게 묻습니다**(`canGuard`). 봇이 조건을
         * 베끼면 여는 자리를 바꾸는 날 봇만 옛 규칙을 씁니다.
         *
         * 못 낼 때는 **붙잡지 않고 흘려보냅니다** — 아래 구르기로 갑니다.
         * 처음엔 못 내는 동안에도 계속 붙잡고 서 있었는데, 그러면 답이
         * 하나도 없는 채로 맞기만 합니다(사망 0 → 2회).
         */
        /**
         * ⚠️ **왜 못 냈는지를 갈라 셉니다.** 24회 붙잡아 0회 성공이 나왔을 때
         *    가능한 이야기가 둘인데 처방이 정반대입니다:
         *      · 창을 **못 봤다**       → 폴링/타이밍 문제(봇을 고침)
         *      · 봤는데 **못 냈다**     → 여는 자리가 좁은 것(게임을 고침)
         *    합쳐 두면 어느 쪽인지 영영 모릅니다.
         */
        if (strike && strike.timer <= gi.window) {
          if (!guardWindowSeen.has(strike.entity)) {
            guardWindowSeen.add(strike.entity)
            guardSawWindow++
            if (!gi.canGuard) guardBlockedByState++
          }
        }
        for (const id of [...guardWindowSeen]) {
          if (!threats.some((t) => t.entity === id && t.winding)) guardWindowSeen.delete(id)
        }
        /**
         * ⚠️ **누르기 전에 먼저 봅니다.**
         *
         * 12번 열어 11번 헛쳤을 때, 남은 원인을 산수로 좁히니 하나였습니다:
         *
         *     플레이어 회전 900°/s → 180° 도는 데 **0.200초**
         *     가드 창 **0.18초**
         *
         * 누르는 순간에 조준을 돌리면 **물리적으로 못 돌립니다.** 그래서
         * 붙잡은 순간부터 계속 조준을 맞추고, `facing`(게임 판단)이 참일
         * 때만 누릅니다. 조준은 공짜이므로 `canGuard` 와 무관하게 합니다 —
         * 못 낼 때 안 돌려 놓으면 낼 수 있게 된 순간에 또 늦습니다.
         */
        if (strike) G.aimAtWorld(strike.x, strike.z)
        if (strike && strike.timer <= gi.window && strike.facing && gi.canGuard) {
          markAct('가드')
          // 🛡 **누른 순간의 사실**을 적어 둡니다 — 창이 닫힐 때 견줍니다.
          guardTarget = {
            entity: strike.entity,
            left: Number(strike.timer.toFixed(3)),
            dist: Number(strike.dist.toFixed(1)),
          }
          // 키도 **게임에게 묻습니다** — 옮겨도 봇이 따라옵니다(balance.ts `GUARD.key`).
          tap(gi.key)
          await sleep()
          continue
        }
        /**
         * ── 🛡 **연 창은 지킵니다 — 굴러 나가지 않습니다** ────────────
         *
         * ── 계측기가 찾아 준 구멍 ──────────────────────────────────
         * 창이 닫힌 이유를 찍어 보니 **판정지나감 11회**였고, 옆에 붙은
         * 거리가 전부 이랬습니다:
         *
         *     1.7 → **3.8m** · 1.8 → **3.4m** · 1.2 → **3.4m**
         *
         * 0.18초 동안 2m 씩 멀어집니다. 걷기(5.4m/s)로는 안 나오는 값이고,
         * 구르기(4.2m)면 정확히 이만큼입니다. 즉 봇은 **가드를 열어 놓고
         * 곧바로 굴러 나가** 자기 창을 스스로 비우고 있었습니다.
         *
         * 원인은 바로 위 가지의 조건입니다: 창이 열려 있는 동안
         * `gi.canGuard` 는 **거짓**입니다(이미 내고 있으니까). 그래서 위
         * 두 가지가 다 안 걸리고 아래 **구르기**로 떨어집니다. 조건이
         * *"낼 수 있는가"* 만 보고 *"이미 냈는가"* 를 안 본 탓입니다.
         *
         * 사람은 이렇게 안 합니다 — 막기로 마음먹고 눌렀으면 **그 자리에
         * 서서 결과를 봅니다.** 그 서 있는 0.18초가 이 기술의 값입니다.
         */
        if (gi.windowT > 0) {
          markAct('가드유지')
          // 이동 키를 놓습니다. 안 놓으면 걸어서라도 사거리 밖으로 나갑니다.
          releaseAll()
          await sleep()
          continue
        }
        if (strike && gi.canGuard) {
          // 창이 올 때까지 **기다립니다.** 이 기다림이 이 기술의 값입니다.
          markAct('가드대기')
          await sleep()
          continue
        }

        /**
         * ── 그 밖의 예고는 **구릅니다 — 창이 올 때까지 기다렸다가** ──────
         *
         * ⚠️ **여기가 예전에 재는 쪽을 창 밖에 세워 두고 있었습니다.**
         *
         * 예전 줄은 `t.winding` 이면 **즉시** Space 였습니다. 그래서 장부에
         * 이렇게 찍혔습니다(맞은 이유를 셋으로 가른 첫 벤치):
         *
         *     못 피함 51 — **일찍 34** · 안누름 13 · 못막는공격 3 · 늦게 1
         *     grunt_sweep 예고 1.55초 · 자유 0.683초 · **구른 뒤 0.633초**
         *
         * 무적은 구르기 시작 뒤 0.06~0.3초뿐인데 0.633초 전에 굴렀으니,
         * 무적이 **이미 끝난 뒤에** 맞은 것입니다. 즉 저 34대는 게임이
         * 좁아서가 아니라 **봇이 일찍 눌러서** 생긴 숫자였습니다.
         * 처음엔 이걸 "봇이 욕심을 부린다"로 읽었는데 정반대였습니다.
         *
         * 바로 위 가드 가지는 이미 이 교훈을 갖고 있습니다 —
         * *"창이 올 때까지 기다립니다. 이 기다림이 이 기술의 값입니다."*
         * 구르기 가지만 그 교훈을 못 받았습니다. **한 번 고친 고장은
         * 다른 계기에도 있는지 찾아본다** 를 또 놓친 자리입니다.
         *
         * ⚠️ 창 값을 여기 적지 않습니다 — `dodgeInfo()` 가 무적 구간을
         *    내보내므로 그대로 씁니다. 베껴 적으면 값을 옮기는 날
         *    봇만 옛 창을 들고 헛굴게 됩니다.
         */
        /**
         * ⚠️ **`dist < 6` 이 아니라 "나에게 닿는가"로 고릅니다.**
         *
         * 적의 사거리는 2.5 ~ **12m** 까지 있습니다(enemyAttacks.ts):
         * 끄는 자의 갈고리 12m · 궁수 12m · 돌진 11m · 광역 7.5m.
         * 그런데 봇은 6m 안만 위협으로 봤습니다. 그래서 7m 밖에서 오는
         * 한 대는 **예고를 끝까지 보고도 아무것도 안 했고**, 장부에는
         * 얌전히 `fair:안누름` 으로 적혔습니다 — 갈라 보니 그 칸이 39대로
         * 가장 컸습니다(전체 못 피함의 57%).
         *
         * 6 은 제가 봇에 적어 둔 숫자이고, **게임은 이미 정답을 알고
         * 있었습니다** — `threats()` 의 `willReach` 는 판정과 같은 식으로
         * *"이 한 대가 나에게 닿는가"* 를 계산합니다(combat.ts `shapeDist`).
         * 문턱을 재는 쪽이 들고 있으면, 사거리를 바꾸는 날 봇만 옛 세계에
         * 삽니다. 이 저장소가 오늘만 세 번 겪은 모양입니다.
         */
        const soon = threats.filter((t) => t.winding && t.intent !== 4 && t.willReach)
        if (soon.length) {
          // 가장 먼저 떨어지는 한 대에 맞춥니다 — 여럿이면 그게 답할 대상입니다.
          const first = soon.reduce((a, b) => (a.timer <= b.timer ? a : b))
          /**
           * ── 🎨 **색마다 답이 다르다 — 그런데 걸어서는 못 빠져나갔습니다** ──
           *
           * 색별로 갈라 보니 `🟡 광역` 이 29대로 가장 컸고, 그 색의 정답은
           * 구르기가 아니라 **걸어서 이탈**입니다. 그래서 봇에게 답을 세 개로
           * 가르쳐 봤습니다 — 🟡 은 옆으로(접선), 🟣 은 뒤로, 나머지는 구르기.
           *
           * **더 나빠져서 되돌렸습니다:**
           *
           *                    구르기만   색별 답
           *     받은 피해        298   →   **327**
           *     맞은 이유         88대  →   **99대**
           *     🟡 안누름          9   →   **45**
           *     🟣 안누름         12   →   **23**
           *
           * `일찍` 이 16 → 1 로 떨어졌으니 봇은 실제로 구르기를 그만두고
           * 걸었습니다. 그런데 **더 맞았습니다.** 무적은 잃고 이탈은 못 한
           * 것입니다.
           *
           * 왜 못 빠져나갔는지에 대한 지금의 짐작: 🟡 을 **접선 방향**으로
           * 뺐는데, 부채꼴 판정에서 접선으로 움직이면 **거리가 그대로**라
           * 여전히 그 안입니다. 원형 장판을 상정하고 고른 방향이 이 게임의
           * 판정 모양과 안 맞았습니다.
           *
           * ⚠️ 그 짐작을 근거로 방향만 바꿔 다시 넣지는 않습니다. 지금
           *    `안누름` 은 *"구르지 않았다"* 만 뜻해서, **걸었는데 못
           *    벗어난 것**과 **아무것도 안 한 것**을 구분하지 못합니다.
           *    구분 못 하는 눈금 위에서 방향을 바꾸면 또 짐작으로 고치는
           *    것입니다. 그래서 이번엔 **눈금을 먼저** 만들었습니다
           *    (장부의 `moved` — 예고 동안 적과의 거리가 얼마나 벌어졌나).
           *
           * ── ✅ **다시 넣습니다 — 이번엔 근거가 있습니다** ──────────
           *
           * `npm run sweep` 에 *"순간이동 말고 진짜 걸어서"* 검사를 붙여
           * 재봤습니다(그 전까지 이 프로브는 13m 순간이동으로 *"밖에 있으면
           * 안 맞는다"* 만 증명하고 있었고, 주석에는 *"걸어서 이탈과 같은
           * 결과"* 라고 **검사된 적 없는 등호**가 적혀 있었습니다):
           *
           *     🚶 예고가 뜬 순간부터 걸으면 벗어난다
           *        예고 1.9초 · 판정 순간 **12.9m** · 안 맞음  (반경 7.5m)
           *
           * **5.4m 여유입니다.** 즉 이 색의 정답은 실제로 성립하고, 앞의
           * 실패는 게임이 아니라 **제가 고른 방향** 때문이었습니다 —
           * 접선으로 빼면 거리가 그대로라 부채꼴 안에 남습니다.
           *
           * ── ❌ **그런데 반경 방향으로도 실패했습니다 (두 번째)** ────
           *
           *     맞은 이유   43대 → **109대**
           *     못 피함     27대 → **92대**
           *     🟡 광역     17대 → **51대** (걸었지만 30 · 제자리 13 · 다가감 8)
           *     받은 피해   222 → **425**
           *
           * 방향은 문제가 아니었습니다. 프로브(적 하나, 빈 땅)에서는 12.9m
           * 로 여유롭게 벗어나는데 **실제 존에서는 안 됩니다.** 차이는
           * 하나뿐입니다 — **다대일**. 한 적의 장판에서 걸어 나가면 다른
           * 적의 한 대 안으로 걸어 들어갑니다(`다른적 8대`). 그리고 걷는
           * 동안 무적이 없습니다.
           *
           * ⚠️ **`걷기`로 `구르기`를 대체하지 않습니다.** 두 번 해 보고
           *    두 번 더 나빠졌습니다.
           *
           * ── 대신 남은 단서 ────────────────────────────────────────
           * 이 파일 위쪽 sweep 프로브 주석에 답이 적혀 있었습니다:
           * *"코앞(1.6m)에서 뒤로 4.2m 구르면 5.8m 로 반경 밖"* — 즉
           * **잡몹 광역은 구르기로도 벗어납니다, 뒤로 구르면.**
           *
           * 그런데 봇은 `tap('Space')` 만 하고 **방향을 안 정합니다.**
           * 붙어서 때리던 이동 키가 눌린 채면 구르기가 **적 쪽으로**
           * 나갑니다. 그래서 아래에서 구르기 **직전에 방향부터** 잡습니다.
           * 대체가 아니라 **한 줄 보탬**입니다.
           */
          /**
           * ⚠️ **창의 끝이 아니라 가운데를 겨눕니다.**
           *
           * 처음엔 `timer <= iFrameEnd` 로 눌렀습니다. 그러면 구르기가
           * 시작되는 순간이 곧 **창의 끝**이라, 한 프레임만 늦어도 밖입니다.
           * 벤치가 그 장면을 그대로 찍었습니다:
           *
           *     grunt_sweep fair:일찍 · 구른 뒤 **0.333초** (무적은 0.3초까지)
           *
           * 0.033초 차이입니다. 게임이 좁은 게 아니라 **겨눈 자리가 끝**이었던
           * 것입니다. 가운데(0.06~0.3 → 0.18)를 겨누면 양쪽으로 여유가
           * 생깁니다. 사람도 창을 잴 때 끝을 노리지 않습니다.
           */
          const aim = (di.iFrameStart + di.iFrameEnd) / 2
          if (first.timer <= aim) {
            markAct('구르기')
            /**
             * ⚠️ **구르기는 눌린 이동 키 쪽으로 나갑니다.**
             * 붙어서 때리던 중이면 그 키가 적 쪽을 향해 있어, 무적으로
             * 넘긴 뒤 **판정 한가운데에 착지**합니다. 반경이 구르기 거리
             * (4.2m)보다 큰 🟡 광역에서 특히 치명적입니다.
             * 방향을 먼저 적 반대쪽으로 잡고 나서 누릅니다.
             */
            moveToward(p.x - first.x, p.z - first.z)
            tap('Space')
            await sleep()
            continue
          }
          // 아직 이릅니다. 기다리는 것도 **판단**이라 따로 적어 둡니다.
          markAct('구르기대기')
          await sleep()
          continue
        }

        /**
         * ── 💥 **곁에 통이 있고 둘 이상이 담기면 칩니다** ────────────────
         *
         * 조건을 셋으로 좁혔습니다.
         *
         *   · **사거리 안에 있을 때만** — 통을 쓰러 일부러 걸어가지
         *     않습니다. 그건 "가는 길에 있으면 쓴다"가 아니라 **곁길**이고,
         *     곁길은 봇에게 따로 예산이 걸린 별개의 판단입니다. v1 은
         *     *"눈앞에 있으면 쓴다"* 라는 **초보자의 하한선**만 잽니다.
         *     이 조건으로 한 번도 안 쓰이면, 그건 봇이 아니라 **배치가
         *     동선에서 멀다**는 뜻이고 그것도 하나의 답입니다.
         *   · **둘 이상 담길 때만** — 통은 존에 셋뿐입니다. 한 마리는
         *     그냥 때리는 편이 싸고, 그래야 이 자원이 자원으로 남습니다.
         *   · **아직 안 붙었을 때만** — 붙은 통을 또 치면 그건 낭비된
         *     한 대이고, 위 대피 가지가 곧바로 나를 밀어냅니다.
         *
         * ── ⚠️ **가지 순서를 올렸습니다 — 재고 나서** ────────────────
         * 처음엔 이 가지를 「등 뒤로 돌기」와 「접근」 사이에 뒀습니다.
         * 첫 판에서 통 셋 전부 *"조건까지 맞았다"* 인데(사거리 안 459·16·117
         * 프레임) 실제 터뜨림은 **1회**였습니다. 기회가 없던 것이 아니라
         * **앞의 가지들이 매 프레임 `continue` 로 가로채고** 있었습니다.
         * (없는 행동은 보상을 붙여도 안 일어난다 — 이 저장소가 백어택에서
         *  배운 것과 같은 모양입니다.)
         *
         * 그래서 「등 뒤로 돌기」보다 **위**로 올렸습니다. 등 뒤를 잡는 것은
         * 한 마리에게 배수를 얹는 일이고, 통은 **둘 이상을 한꺼번에
         * 무너뜨리는** 일입니다. 다만 피해를 피하는 답들(🔴 구르기 · 🛡 가드 ·
         * 🟢 반격)보다는 **아래**에 둡니다 — 예고가 떠 있는데 통을 치는 것은
         * 사람이 하는 판단이 아닙니다.
         *
         * ⚠️ 반경은 게임에서 읽습니다. 적의 자리도 `threats` 에서 읽습니다 —
         *    봇이 자기 계산으로 "담긴다"를 정하면, 폭발 판정을 손보는 날
         *    봇만 옛 규칙으로 통을 칩니다.
         */
        if (BARREL_ON) {
          const bi = G.barrelInfo()
          // 🗡 문턱은 **게임이 답합니다**(평타 사거리 + 파고들기).
          const reach = G.moveInfo().hitReach
          let best = null
          for (const b of bi.barrels) {
            if (b.fuseT > 0) continue
            const d = Math.hypot(b.x - p.x, b.z - p.z)
            if (d > reach) continue
            const caught = threats.filter(
              (t) => Math.hypot(t.x - b.x, t.z - b.z) <= bi.blast,
            ).length
            if (caught < 2) continue
            if (!best || caught > best.caught) best = { b, caught }
          }
          if (best) {
            markAct('통점화')
            release('ShiftLeft')
            releaseAll()
            G.aimAtWorld(best.b.x, best.b.z)
            tap('Mouse0')
            await sleep()
            continue
          }
        }

        /**
         * ---- 등 뒤로 돌기 (기둥 3) ----
         *
         * ── 왜 이 가지가 생겼는가 ──────────────────────────────────
         * 존에서 백어택 비율이 **6~7%** 였습니다. 무기와 무관하게요.
         * 그래서 기둥 3(포지셔닝이 보상받는다)이 실제로는 거의 안
         * 돌아갑니다. 보상을 키워도(등 뒤 강인도 ×1.6) 숫자가 안
         * 움직였는데, 당연합니다 — **봇에 돌아가는 가지가 없었습니다.**
         * 보물이 0개였을 때와 정확히 같은 모양입니다: 없는 행동은
         * 아무리 보상을 붙여도 안 일어나고, 그러면 그 기둥은 영영
         * 측정되지 않습니다.
         *
         * ── 사람처럼 굴게 하는 조건 ────────────────────────────────
         *   1. **예고가 떠 있으면 안 돕니다** — 그건 피하거나 반격할 때입니다.
         *   2. **이미 등 뒤면 안 돕니다** — 때릴 때입니다.
         *   3. **오래 못 돕니다**(1.2초). 못 잡으면 그냥 정면에서 칩니다.
         *      산수로는 0.78초면 들어가야 하고(창은 1.23초), 못 들어가면
         *      그건 이 적한테는 안 되는 것입니다. 영원히 돌면 봇이
         *      "춤추다 끝나는" 판이 됩니다 — 이 프로젝트에서 이미 두 번
         *      데인 무한 왕복 버그와 같은 함정입니다.
         */
        /**
         * ⚠️ **여기가 여러 라운드 동안 죽어 있었습니다.**
         *
         * `near` 에는 `entity` 가 없었습니다. 그래서 `entityState(undefined)`
         * 가 null 을 돌려주고, 아래 조건이 **매 프레임 조용히 거짓**이
         * 되었습니다. 자동 플레이 여덟 판의 가지 분포에서 「돌기」는 0% —
         * 목록에 아예 없었습니다. 그 상태로 "백어택이 왜 6~7%인가"를
         * 논하고, 도는 **타이밍**을 두 번이나 고쳤습니다. 없는 가지의
         * 타이밍을요.
         *
         * 그래서 이제 **막히면 소리를 냅니다** — 가지가 조용히 사라지는 것이
         * 이 저장소에서 가장 비싼 고장입니다.
         */
        const es = near.entity === undefined ? null : G.entityState(near.entity)
        if (!es) markAct('돌기막힘')
        /**
         * ⚠️ **등 뒤 판정을 봇이 다시 계산하지 않습니다.**
         *
         * 여기 원래 `< -0.34` 가 박혀 있었습니다. 그건 `backArcDeg = 140°`
         * 의 코사인인데, **게임이 그 각도를 바꾸면 봇만 옛 규칙으로 돌게**
         * 됩니다. 이 저장소가 스스로 적어 둔 규칙 그대로입니다:
         *
         *   > 규칙은 한 곳에만. 게임이 판단하고 봇·프로브는 **읽습니다.**
         */
        /**
         * 등 뒤인지도 **게임이 이미 계산해서 줍니다**(`playerBehind`).
         * 봇이 `-0.34` 를 박아 두고 다시 계산하던 자리입니다 — 규칙을
         * 베낀 것도 문제였지만, 애초에 **받아 놓고 안 쓰고 있었습니다.**
         */
        const behindMe = near.playerBehind

        /**
         * ── **언제** 도는가 — 이번 라운드에 바뀐 것 ──────────────────
         *
         * 예전에는 "가깝고, 예고가 안 떠 있고, 등 뒤가 아니면" 돌았습니다.
         * 그런데 `npm run flank` 로 재 보니 **돌 수 있는 때가 정해져 있습니다:**
         *
         *   적이 공격을 커밋한 동안(판정+후딜)에만 이깁니다.
         *   잡몹 0.55초 / 보스 1.13초면 등 뒤에 닿고, 창은 2.32 / 1.95초.
         *
         * 커밋 밖에서는 적이 150°/초로 따라 돕니다. 그동안은 **때리지도
         * 피하지도 않는 시간**만 쌓입니다. 실제로 예전 봇의 백어택은 6~7%
         * 에 머물렀습니다 — 돌긴 도는데 **이길 수 없는 때에** 돌았습니다.
         *
         * 소울류에서 사람이 하는 것도 같습니다: 휘두르는 걸 보고 나서 돕니다.
         *
         * ⚠️ `PLAY_NOFLANK=1` 이면 옛 조건으로 돕니다. 봇 정책을 바꾸면
         *    벤치의 모든 기준선이 움직이므로, **같은 빌드에서** 옛것과 새것을
         *    번갈아 돌려 비교할 수 있어야 합니다(ab.mjs 가 기계 드리프트
         *    때문에 배운 것).
         */
        const einfo = es ? G.enemyInfo(near.entity) : null
        /**
         * ⚠️ **판정이 아니라 후딜입니다.**
         *
         * 처음엔 `attacking && !winding` — 즉 **판정 + 후딜**을 한 덩어리로
         * 봤습니다. 네 판 비교에서 부호가 갈렸고 한 판은 받은 피해가 192
         * 늘었습니다. 기계 탓을 하기 전에 기제를 의심했고, `npm run flank`
         * 로 두 시작 시점을 갈라 재니 답이 명확했습니다:
         *
         *   판정부터 돌기 → 잡몹 기준 **매번 −14** (3/3)
         *   후딜부터 돌기 → **매번 −0**   (3/3)
         *
         * 휘두르는 칼 안으로 걸어 들어가는 것이니 당연합니다. 🟡 광역은
         * 판정이 머무르기까지 합니다. 사람이 하는 것도 후자입니다 —
         * 맞을 것을 넘기고 **나서** 돕니다.
         *
         * 구간 판정은 게임의 `recovering` 을 읽습니다(봇이 시간을 세지 않게).
         */
        const canWin = RECOVERY_ONLY ? !!einfo && einfo.recovering : true
        if (circleUntil === 0 && es && !behindMe && canWin && near.dist < 4) circleUntil = now() + 1.2
        if (es && !behindMe && canWin && now() < circleUntil && near.dist < 4) {
          markAct('돌기')
          // 적의 **등 뒤 지점**으로 걸어갑니다. 접선으로 도는 것보다
          // 단순하고, 적이 돌면 목표점도 같이 돌아서 저절로 추적이 됩니다.
          const bx = es.x - Math.sin(es.rotY) * 1.6
          const bz = es.z - Math.cos(es.rotY) * 1.6
          moveToward(bx - p.x, bz - p.z)
          await sleep()
          continue
        }
        if (behindMe || now() >= circleUntil) circleUntil = 0

        /**
         * 🤸 **굴러 넘겼으면 갚습니다.**
         *
         * 게임에 구르기 공격이 생겼는데(창 0.35초) 봇에는 그 가지가
         * 없었습니다. 넣어 두고 안 쓰면 다음 벤치가 *"효과가 없다"* 와
         * *"쓰이질 않았다"* 를 못 가립니다 — 취소 회피를 여덟 판 돌리고
         * 나서야 배운 그 자리입니다.
         *
         * 소울류에서 구르기 공격이 도는 이유는 **굴러 넘긴 직후가 적의
         * 후딜**이기 때문입니다. 그래서 조건은 하나뿐입니다: 창이 열려
         * 있고 적이 닿는 거리면 **바로 친다.** 창(0.35초)이 알아서
         * "직후"를 보장하므로 봇이 타이밍을 따로 세지 않습니다.
         *
         * ⚠️ 창 길이도 사거리도 **게임에게 묻습니다**(`moveInfo`·`near.dist`).
         *    봇이 0.35 를 들고 있으면 값을 바꾸는 날 봇만 옛 규칙을 씁니다.
         */
        const mv = G.moveInfo()
        /**
         * 🪂 **떨어졌으면 그 값을 회수합니다 — 구르기보다 먼저.**
         *
         * 순서가 규칙입니다. 두 창이 겹칠 수 있고(절벽에서 굴러 떨어지면
         * 둘 다 열립니다), 그때 무엇이 나가는지는 **게임이** 정합니다
         * (`contextComboIndex` 가 낙하를 먼저 봅니다). 봇이 반대 순서로
         * 물으면 봇만 다른 기술을 노리게 됩니다 — 같은 규칙을 두 곳에
         * 적는 순간 둘은 갈라집니다.
         *
         * 낙하 공격은 파고들기가 **줄어든** 기술이라(제자리에서 내리찍기)
         * 구르기 공격보다 짧은 거리에서만 닿습니다. 그래서 거리 문턱을
         * 따로 두지 않고 **더 짧은 쪽**을 씁니다.
         */
        if (mv.plungeWindowT > 0 && near.dist <= 2.2) {
          markAct('낙하공격')
          G.aimAtWorld(near.x, near.z)
          tap('Mouse0')
          await sleep()
          continue
        }
        // 🎲 창의 열림은 **게임이 답합니다** — 반올림한 `rollWindowT` 로
        // 되물으면 부동소수 찌꺼기에서 어긋납니다(guard 가 봅니다).
        if (mv.rollWindowOpen && near.dist <= 2.6) {
          markAct('구르기공격')
          G.aimAtWorld(near.x, near.z)
          tap('Mouse0')
          await sleep()
          continue
        }

        /**
         * 🏃 **도착하기 전에 칩니다.**
         *
         * 첫 판에 **달리기 공격 0회**가 나왔습니다. 봇은 Shift 를 잡고 달렸는데,
         * 2.2m 안에 들어와 **Shift 를 놓은 뒤에** 쳤습니다 — 그때는 이미 달리는
         * 중이 아니라 평범한 1타입니다. 소울류의 달리기 공격은 **붙기 전에**
         * 내는 기술이고, 파고들기(1타의 2.6배)가 남은 거리를 대신 좁혀 줍니다.
         *
         * 닿는 거리는 **게임에게 묻습니다**(`moveInfo().runReach` = 사거리 +
         * 파고들기). 봇이 배율을 곱하면 값을 바꾸는 날 봇만 옛 규칙을 씁니다.
         */
        if (mv.sprinting && near.dist > 2.2 && near.dist <= mv.runReach) {
          markAct('달리기공격')
          G.aimAtWorld(near.x, near.z)
          tap('Mouse0')
          await sleep()
          continue
        }

        if (near.dist > 2.2) {
          markAct('접근')
          /**
           * 🏃 **멀면 달려서 붙습니다 — 그리고 그 속도로 칩니다.**
           *
           * 달리기 공격은 파고들기가 1타의 2.6배라 *"접근"* 시간을 공격으로
           * 바꿉니다. 봇은 지금까지 Shift 를 **한 번도** 누른 적이 없어서
           * (`npm run sprint` 가 그걸 잡았습니다) 이 기술이 존에서 영영
           * 안 나올 참이었습니다.
           *
           * 문턱 4.5m: 달리기가 최고 속도에 붙는 데 0.3초 걸리고, 그 사이
           * 5.4~8.4m/s 로 2m 남짓을 갑니다. 그보다 가까우면 달릴 새도 없이
           * 도착하므로 누르는 값만 치릅니다.
           */
          // ⚠️ `hold`/`release` 를 씁니다 — `G.press` 를 직접 부르면 `held` 에
          //    안 잡혀서 `releaseAll` 이 못 놓고, Shift 가 영영 눌린 채 남습니다.
          if (near.dist > 4.5) hold('ShiftLeft')
          else release('ShiftLeft')
          // 다가갈 때도 길을 따라갑니다 — 직선으로 가면 다시 절벽에 붙습니다.
          moveToward(reachable.x - p.x, reachable.z - p.z)
        } else {
          // 붙었으면 달리기를 놓습니다 — 안 놓으면 제자리 달리기가 됩니다.
          release('ShiftLeft')
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
          else if (ready.length > 0) tap(pickSkill(ready).key)
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
        // 🧭 눈앞의 보물이 더 가까우면 사다리는 다음에 — 위 `treasureClaims` 주석.
        if (toTop && toTop.dist <= 40 && !treasureClaims(toTop.dist)) {
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
      /**
       * **소비처는 걸어야 하는 거리로 고릅니다.**
       *
       * 직선으로 고르면 계단 위에서 폐허의 화톳불(직선 20m · 실제 98m)을
       * 골라 놓고 "너무 멀다"며 접습니다. 바로 옆(30m)의 모루를 두고요.
       * 실제로 그래서 **재료가 40초 일찍 모였는데도 무기 강화가 0/3판**
       * 이었습니다.
       *
       * 직선거리로 고른 실수는 이 프로젝트에서 세 번째입니다(적 어그로 ·
       * 화톳불 막힘 판정 · 여기). 그래서 게임 쪽은 **목록만** 주고,
       * 고르는 코드는 길찾기를 가진 이 한 곳에만 둡니다.
       */
      /**
       * ⚠️ **가까운 곳이 아니라 "가는 길에 있는 곳"을 고릅니다.**
       *
       * 구역별로 재 보니 곁길 넷이 전부 소비처 예산(45m) 밖이었습니다:
       *   성벽마루 95% · 북쪽 단상 92% · 성문 벽감 69% · 남쪽 함몰지 58%
       * 그리고 **보물 5개 중 4개가 그 넷에 있습니다** — 정련석이 나오는
       * 유일한 곳입니다. 즉 정련석을 줍는 순간이 곧 소비처에서 가장 먼
       * 순간입니다.
       *
       * 그 상태에서 **가장 가까운** 소비처를 고르면 답은 늘 **뒤쪽**이고,
       * 46m 라 예산에 걸려 접습니다(실제 기록: `모루 46m · 그때 전부
       * 불156m 불82m 모루70m 모루46m`). 그리고 30초 쿨다운까지 먹습니다.
       *
       * 사람은 그렇게 안 합니다. 되돌아가지 않고 **가는 길에 있는 다음
       * 소비처**에서 씁니다. 이 존은 한 방향(+X)이라 더 그렇습니다.
       * 그래서 기준을 거리에서 **돌아가는 비용**으로 바꿉니다:
       *
       *     비용 = (나→소비처) + (소비처→목표) − (나→목표)
       *
       * 가는 길에 있으면 0 에 가깝고, 뒤에 있으면 왕복만큼 커집니다.
       * 소울류에서 "다음 화톳불에서 쓰지" 하는 그 판단을 그대로 옮긴 것입니다.
       */
      let fire = null
      /** 이 판의 소비처 목록 — 아래 "밟고 선 곳" 판정에서도 씁니다. */
      let spendPts = []
      /**
       * 🧭 **돌아가는 비용** — 고른 소비처에 들르면 몇 m 를 더 걷는가.
       *   비용 = (나→소비처) + (소비처→목표) − (나→목표)
       * 동선 위에 있으면 0 에 가깝고, 되돌아가야 하면 크게 뜁니다.
       */
      let fireDetour = Infinity
      {
        const pts = G.spendPoints?.() ?? []
        spendPts = pts
        const obj = G.objective()
        /**
         * **목표까지 남은 거리**로 앞뒤를 가릅니다. 흐름장 한 번이면
         * 플레이어와 모든 소비처를 같은 자로 잴 수 있습니다.
         *   · `남은 거리(소비처) < 남은 거리(나)`  → 내 **앞**에 있습니다
         *   · 그중 남은 거리가 **가장 큰** 것       → 가장 먼저 지나갈 곳
         * 뒤에 있는 것이 아무리 가까워도 고르지 않습니다 — 되돌아가는
         * 것은 사람도 안 하고, 실제로 그 46m 때문에 판마다 한 번밖에
         * 못 들렀습니다.
         */
        const d = obj ? G.distancesToward?.(obj.x, obj.z, pts) : null
        if (d && pts.length) {
          let bestLeft = -Infinity
          let bestIdx = -1
          for (let i = 0; i < pts.length; i++) {
            const left = d.points[i]
            if (!Number.isFinite(left) || left >= d.player) continue // 뒤에 있거나 못 감
            if (left > bestLeft) {
              bestLeft = left
              bestIdx = i
              fire = pts[i]
            }
          }
          if (bestIdx >= 0) {
            const toSpot = G.pathStep(pts[bestIdx].x, pts[bestIdx].z)
            if (toSpot) fireDetour = toSpot.dist + bestLeft - d.player
          }
        }
        // 앞에 아무것도 없으면(보스 직전) 예전처럼 **가장 가까운** 곳으로.
        if (!fire) {
          let bestD = Infinity
          for (const sp of pts) {
            const step = G.pathStep(sp.x, sp.z)
            const dd = step ? step.dist : Math.hypot(sp.x - p.x, sp.z - p.z)
            if (dd < bestD) {
              bestD = dd
              fire = sp
            }
          }
        }
        if (!fire) fire = G.nearestBonfire()
      }
      const em = G.emberInfo()
      // 강화할 수 있으면 체력과 무관하게 멈춥니다. **불티는 쓰라고 있는 것**이고,
      // 안 쓰면 불티 경제가 도는지 아닌지를 이 봇이 영영 못 잽니다.
      const wu = G.weaponUpgradeInfo()
      // 정련석까지 있어야 강화가 됩니다. 불티만 보고 화톳불로 가면
      // 도착해서 아무것도 못 하고 그 자리를 맴돕니다.
      const canUpgradeWeapon =
        wu.nextCost > 0 && em.embers >= wu.nextCost && wu.stones >= wu.nextStoneCost
      // ⚠️ 성수병도 **구매와 같은 규칙**으로 봅니다(무기 몫을 빼고 남는 것으로).
      //    안 그러면 "갈 이유"와 "살 수 있음"이 갈라져 봇이 소비처 위에서 진동합니다.
      const canUpgradeVial =
        em.upgradeCost > 0 && em.embers - emberReserveOf(wu) >= em.upgradeCost
      const canUpgrade = canUpgradeVial || canUpgradeWeapon
      const needsSupply = vi.vials === 0 || p.hp < 45
      // ⚠️ **보급은 화톳불에서만** 됩니다. 모루로 걸어가서 성수병을 기다리면
      // 영원히 안 찹니다 — 물건이 나뉘었으니 목적지도 나뉘어야 합니다.
      const restFire = G.nearestBonfire()
      if (restFire && needsSupply) {
        const fire = restFire
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
      /**
       * 소비처까지 **걸어야 하는 거리**로 봅니다. 직선으로 재면 벽 너머
       * 화톳불이 "가깝다"로 잡혀서, 갈 수 없는 기회를 있었다고 세게 됩니다.
       */
      if (fire) {
        const sp = G.pathStep(fire.x, fire.z)
        if (sp && sp.dist <= SPEND) lastSpendChanceAt = Number(now().toFixed(1))
      }
      if (affordableAt < 0 && canUpgradeWeapon) affordableAt = Number(now().toFixed(1))
      const walletGrew =
        em.embers > lastFireWallet.embers || wu.stones > lastFireWallet.stones
      /**
       * **여행 조건이 어디서 막히는지 셉니다.**
       *
       * 소비처가 넷인데 판당 **한 번**만 들릅니다(불티 348 · 정련석 3~5 가
       * 남은 채로 끝납니다). 조건이 넷이라 밖에서 보면 어느 것이 막는지
       * 알 수 없습니다 — 강화가 안 되던 이유를 세 번 헛짚은 뒤에 배운 대로,
       * **갈림길마다 이름을 붙여** 셉니다.
       *
       * 처방이 전부 다릅니다:
       *   · 소비처없음 → 배치        · 못삼   → 경제(비용·수입)
       *   · 지갑안늘어 → 수입/기준선  · 쿨다운 → 봇 규칙
       */
      /**
       * ── 🔨 **지나가다 들르는 것에는 관문이 필요 없습니다** ────────────
       *
       * `npm run map` 이 모순을 드러냈습니다:
       *
       *   [소비처] 모루(68,44) — 가는 길 **4m** · 나오는 길 4m
       *   [소비처] 모루(56,50) — 가는 길 **0m** · 나오는 길 0m
       *   벤치      닿음 **0.0회** · 접은 거리 46~82m
       *
       * 모루는 주 동선 **바로 위**에 있습니다. 그런데 봇은 판당 0회 들릅니다.
       * 막고 있던 것은 지도가 아니라 **관문**이었습니다 — `walletGrew`
       * (지난 방문 뒤로 지갑이 늘었나)와 30초 쿨다운. 그 둘은 *"존을
       * 되돌아가는 긴 왕복"* 을 막으려고 넣은 것인데, **밟고 지나가는
       * 소비처까지 같이 막고** 있었습니다. 갈림길 장부가 그대로 말합니다:
       * `지갑안늘어 27% · 쿨다운 38% · 열림 21%`.
       *
       * 어느 게임도 이런 관문을 두지 않습니다 — 소울류는 **밟고 있는**
       * 화톳불에서 쉬고, 세키로는 조각상이 촘촘해서 지나가며 씁니다.
       * *"지난번보다 벌었는가"* 를 묻는 상점은 없습니다. 그 질문은 **먼
       * 왕복**에만 뜻이 있습니다.
       *
       * 그래서 **가까우면 관문을 건너뜁니다.** 12m 로 잡은 근거: 곁길
       * 예산(40m)의 1/3 이하 — *"가는 일"* 이 아니라 *"지나가다 들르는 일"*
       * 이 되는 거리입니다. 쿨다운은 그대로 지킵니다(왕복이 실패했을 때
       * 무한히 오가던 336초짜리 사고가 있었습니다).
       */
      const passingStep = fire ? G.pathStep(fire.x, fire.z) : null
      /**
       * 🧭 **"지나가다 들르는 것"의 기준을 12m 에서 곁길 예산으로 바꿉니다.**
       *
       * ── 12m 이 왜 틀렸는가 (재고 나서 압니다) ──────────────────────
       * 12m 는 *"곁길 예산의 1/3"* 이라는 어림으로 정한 값이었습니다. 그런데
       * 소비처마다 **실제로 얼마나 가까이 갔는지**를 재 보니 이랬습니다:
       *
       *     화톳불(17,1)  18m · 51초 · 불티 74 · 정련석 1 · 살 수 있었음
       *     모루 (49,17)  36m · 93초 · 불티 140 · 정련석 4 · 살 수 있었음
       *
       * **한 번도 12m 안에 들어간 적이 없습니다**(시작 화톳불 제외). 그래서
       * 관문(`walletGrew`)은 늘 닫혀 있었고, 판당 무기 강화는 0회였습니다 —
       * 정련석 4개와 불티 140을 손에 쥔 채로요.
       *
       * ── 왜 예산과 같은 값이어야 하는가 ────────────────────────────
       * 이 봇은 **보물**은 40m 까지 아무 관문 없이 주우러 갑니다. 그런데
       * 소비처는 12m 밖이면 관문을 통과해야 했습니다. 소비처는 그 보물의
       * 값어치가 **실현되는 곳**인데, 가는 값이 보물보다 비쌌던 셈입니다.
       * 같은 질문("얼마나 벗어나면 곁길인가")에 두 개의 답을 두면 언젠가
       * 갈라지고, 여기서는 이미 갈라져 있었습니다.
       *
       * ⚠️ 무한 왕복(336초짜리 사고)을 막던 성질은 그대로입니다 —
       *    아래에서 **가장 가까운 곁길일 때만** 관문을 건너뛰게 하고,
       *    실패 쿨다운도 그대로 둡니다. "가장 가까운 것으로 간다"는
       *    규칙에는 왔다 갔다 할 여지가 없습니다.
       */
      /**
       * ⚠️ **여기에 `treasureClaims` 를 넣었던 것이 잘못이었습니다.**
       *
       * 직전 커밋에서 *"가까운 보물이 있으면 소비처는 물러난다"* 를 이
       * 자리에 같이 걸었습니다. 그런데 이 값(`passingBy`)이 하는 일은
       * **가는 것을 정하는 것**이 아니라 *"밟고 지나가는 것이니 관문을
       * 면제한다"* 입니다. 둘을 한 값에 묶으니, 돌아가는 비용이 **0m** 인
       * 화톳불조차 근처에 보물만 있으면 면제를 잃고 30초 쿨다운에
       * 걸렸습니다. 벤치가 그대로 말했습니다 — `쿨다운 55%`.
       *
       * 밟고 지나가는 데는 왔다 갔다 할 여지가 없습니다(더 걷는 거리가
       * 0 이니까요). 쿨다운이 막으려던 336초짜리 무한 왕복은 **먼 곳**의
       * 이야기입니다. 그래서 면제는 거리 하나로만 정하고, 보물과의
       * 우선순위는 **실제로 발길을 돌릴 때**만 봅니다(아래 이동 가지).
       */
      /**
       * ⚠️ **거리도 같이 봅니다** — 안 그러면 쿨다운이 무력해집니다.
       *
       * 원래는 돌아가는 비용 하나로 정했습니다. 그런데 이 값은 아래에서
       * **쿨다운을 면제**하는 데 쓰이고, 실제로 발길을 돌릴지는 총 거리로
       * 정합니다. 소비처가 길목에 있는데 90m 밖이면 — 면제는 받고 이동은
       * 막혀서 **매 프레임 포기 가지로 떨어집니다.** 포기할 때마다
       * `lastFireWallet` 이 지금 값으로 덮이니 `walletGrew` 는 영영 참이
       * 못 되고, 먼 소비처로 가는 왕복이 통째로 성립하지 않습니다.
       * (벤치의 `가려다 접음 113회 · 접은 거리 46~56m` 가 그 모양입니다.)
       *
       * *"지나가다 들른다"* 가 성립하려면 **가깝고 또 싸야** 합니다.
       * 둘 중 하나만 보면 면제와 이동이 서로 다른 것을 보게 됩니다.
       */
      const passingBy =
        !!passingStep && fireDetour <= PASSING_DETOUR && passingStep.dist < SPEND
      /**
       * ── 🧾 **지나친 소비처를 그 순간의 지갑과 함께 적습니다** ──────────
       *
       * 세 번 고치고 세 번 중앙값에 부정당했습니다. 매번 한 판은 좋아졌고
       * 3판은 `무기 강화 0.0` 이었습니다. 남은 가설이 둘인데 **처방이
       * 정반대**입니다:
       *
       *   · 소비처를 **안 지나간다**        → 지도/동선 문제
       *   · 지나가는데 **그때 돈이 없다**   → 경제(수입 시점) 문제
       *
       * `못삼 40% (19~91%)` 와 `남은 불티 390` 은 **둘 다와 어울립니다** —
       * 그래서 이 둘을 가르는 자료가 지금 없습니다. 네 번째로 추측하는 대신
       * **지나간 순간**을 적습니다: 어느 소비처를, 몇 m 로, 그때 지갑이
       * 얼마였는지. 이 저장소가 매번 배운 것 그대로입니다 — 재기 전의
       * 설명은 결론이 아닙니다.
       */
      /**
       * 🧾 **고른 곳이 아니라 모든 소비처를** 잽니다 — 위 `spendBest` 주석.
       * 2초마다 한 번이면 충분합니다(매 프레임 길찾기 5회는 비쌉니다).
       */
      if (now() - lastSpendScan > 2) {
        lastSpendScan = now()
        for (const sp of spendPts) {
          const st2 = G.pathStep(sp.x, sp.z)
          if (!st2) continue
          const key = `${Math.round(sp.x)},${Math.round(sp.z)}`
          const cur = spendBest[key]
          if (!cur || st2.dist < cur.dist) {
            spendBest[key] = {
              dist: Number(st2.dist.toFixed(1)),
              // 🧭 그때 고른 소비처의 **돌아가는 비용** — 관문이 왜 안 열렸는지 보려면 필요합니다.
              detour: Number.isFinite(fireDetour) ? Number(fireDetour.toFixed(1)) : -1,
              chosen: fire ? `${Math.round(fire.x)},${Math.round(fire.z)}` : '-',
              at: Number(now().toFixed(1)),
              anvil: sp.anvil === true,
              embers: em.embers,
              stones: wu.stones,
              canBuy: !!canUpgrade,
            }
          }
        }
      }
      if (passingBy && fire) {
        const key = `${Math.round(fire.x)},${Math.round(fire.z)}`
        const prev = passBy.get(key)
        // 한 번 지나갈 때 한 번만 적습니다 — 프레임마다 적으면 "머문 시간"이 됩니다.
        if (!prev || now() - prev.at > 8) {
          passBy.set(key, {
            at: Number(now().toFixed(1)),
            dist: Math.round(passingStep.dist),
            embers: em.embers,
            stones: wu.stones,
            canBuy: !!canUpgrade,
            anvil: fire.anvil === true,
            n: (prev?.n ?? 0) + 1,
          })
        }
      }

      if (!fire) tripBlock.noFire++
      else if (!canUpgrade) tripBlock.cantBuy++
      // ⚠️ 위 분기와 **같은 조건**이어야 합니다. 장부가 옛 규칙을 세면
      //    "지갑안늘어 27%" 같은 숫자가 거짓말이 됩니다.
      else if (!walletGrew && !passingBy) tripBlock.noGrowth++
      // ⚠️ 위 분기와 **같은 조건**이어야 합니다 — 장부만 옛 규칙을 세면 거짓말이 됩니다.
      else if (!passingBy && now() < fireCooldownUntil) tripBlock.cooling++
      else tripBlock.open++
      /**
       * ⚠️ **쿨다운은 왕복에만 겁니다.**
       *
       * 벤치가 `쿨다운 32% (0~58%)` 를 찍었고, 같은 판에서 무기 강화는
       * 중앙값 0회였습니다. 이 쿨다운(30초)은 *"왕복이 실패했을 때 무한히
       * 오가던 336초짜리 사고"* 를 막으려고 넣은 것입니다. 그런데 **12m
       * 안을 지나가는 것**까지 같이 막고 있었습니다 — 12m 를 걷는 데는
       * 2초가 걸리고, 그것으로는 336초를 오갈 수가 없습니다.
       *
       * 소울류에서 화톳불을 밟고 지나가는데 *"아까 다른 데 가려다 실패해서
       * 30초는 못 쉰다"* 는 규칙은 없습니다. 쿨다운이 지키려던 것은
       * **거리**이지 소비처 자체가 아닙니다.
       */
      if (fire && canUpgrade && (walletGrew || passingBy) && (passingBy || now() >= fireCooldownUntil)) {
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
        // 98m 는 걷기만 해도 20초, 도중에 싸우면 더 걸립니다. 25초로는
        // 도착 직전에 포기하게 됩니다 — 예산과 제한 시간은 같이 움직여야 합니다.
        if (fireTripUntil === 0) fireTripUntil = now() + 25
        if (now() > fireTripUntil) {
          // 25초 안에 못 닿았으면 포기하고, **지갑도 그때 값으로 적어 둡니다.**
          // 안 그러면 다음 프레임에 "지갑이 늘었다"가 계속 참이라 영원히 재시도합니다.
          fireCooldownUntil = now() + 30
          fireTripUntil = 0
          lastFireWallet = { embers: em.embers, stones: wu.stones }
        /**
         * 왕복 예산 — 무기 강화는 **멀어도 갑니다.**
         *
         * 45m 로 잘랐더니 판마다 화톳불 방문이 1회(40초 지점)뿐이었고,
         * 그 뒤로는 걸어야 하는 거리가 **98m** 로 찍혔습니다. 즉 이 존의
         * 후반부에는 불티를 **쓸 곳이 없습니다.** 수입의 대부분(처치·보물·
         * 보스)이 후반에 들어오는데 말입니다.
         *
         * 그게 문제인지 아닌지는 **왕복 비용을 실제로 치러 봐야** 압니다.
         * 사람이라면 "정련석 4개와 불티 400을 들고 있는데 98m 되돌아갈까"를
         * 저울질합니다 — 적은 쉬기 전까지 안 살아나니 길은 안전하고, 대신
         * 시간이 듭니다. 그 시간이 얼마인지가 지금 없는 숫자입니다.
         *
         * 그래서 무기 강화가 걸린 왕복만 예산을 110m 로 열어 **비용을 쟀습니다.**
         * 결과: 무기 강화 1회를 얻는 대신 한 판의 8%가 되돌아 걷는 시간이
         * 되었고, 클리어가 157~204초에서 225초로 늘었습니다.
         *
         * 그 숫자를 근거로 **지도를 고쳤습니다** — 계단 위에 모루를 놓아
         * 소비처를 수입이 들어오는 쪽으로 옮겼습니다(make-zone.mjs 참고).
         * 이제 되돌아 걸을 이유가 없으므로 예산을 45m 하나로 되돌립니다.
         * 같은 강화를 **75초 싸게** 얻습니다(225 → 150초).
         *
         * ⚠️ 이 값을 다시 늘리고 싶어지면, 그건 소비처가 또 엉뚱한 곳에
         * 있다는 신호입니다. 봇의 예산이 아니라 **지도**를 보십시오.
         */
          // 🧭 발길을 **돌리는** 경우에만 보물과 견줍니다. 밟고 지나가는
          //    것(`passingBy`)은 더 걷는 거리가 0 이라 견줄 것이 없습니다.
        } else if (
          step &&
          /**
           * ── 🧭 **밟고 지나가는 것에는 총 거리를 묻지 않습니다** ────────
           *
           * 여기 원래 `step.dist < 45` 하나였습니다. 그런데 `passingBy` 는
           * **돌아가는 비용**(≤12m)으로 정해지고, 이 줄은 **총 거리**로
           * 막았습니다. 같은 질문에 두 개의 자를 댄 것입니다.
           *
           * 그래서 이런 자리가 생겼습니다: 소비처가 목표 가는 길목에 있어
           * 더 걷는 값이 5m 인데, 거기까지가 50m 라 이 줄이 막습니다.
           * 막히면 아래 `else`(포기)로 떨어져 30초 쿨다운이 걸리는데,
           * 다음 프레임에 `passingBy` 가 그 쿨다운을 다시 면제합니다.
           * **매 프레임 포기했다가 다시 시도합니다.**
           *
           * 벤치가 그대로 찍었습니다 — `가려다 접음 113회 · 접은 거리
           * 46~56m`. 한 상황이 수백 번으로 세어진 것이고, 더 나쁜 것은
           * 포기할 때마다 `lastFireWallet` 이 지금 값으로 덮여서
           * **`walletGrew` 가 영영 참이 못 된다**는 것입니다. 먼 소비처로
           * 가는 진짜 왕복이 한 번도 성립하지 않습니다.
           * (`닿음 2회 · 무기 강화 1회 · 남은 불티 289` 가 그 결과입니다.)
           *
           * ── ❌ **그래서 관문을 풀었다가 3판에 되돌렸습니다** ──────────
           *
           * *"지나가다 들르는 데 총 거리는 뜻이 없다 — 어차피 그 길로 걷고
           * 있으니까"* 라고 적고 `passingBy` 면 거리를 안 보게 했습니다.
           * 3판이 **세 예측을 전부 반대로** 답했습니다:
           *
           *     닿음        2.0회 → **0.0회**
           *     남은 불티   289   → **314**
           *     무기 강화   1.0회 → **0.0회**
           *
           * 왜 틀렸는지는 같은 표에 있습니다 — `접은 거리 46~56m` 이
           * **28~90m** 로 벌어졌습니다. 봇이 90m 짜리 왕복을 실제로 시작했고,
           * 25초짜리 왕복 제한에 걸려 도중에 버렸습니다. 아무것도 못 얻고
           * 시간만 씁니다.
           *
           * 제 논증의 구멍은 여기였습니다: *"어차피 그 길로 걷는다"* 는
           * 목표까지의 **경로**에 대해서는 맞지만, 봇은 그 경로를 한 번에
           * 걷지 않습니다 — 싸우고, 보물로 새고, 목표가 바뀝니다. 돌아가는
           * 비용이 5m 라도 **거기까지 90m** 면 그 사이에 판이 달라집니다.
           * 돌아가는 비용은 거리를 대신하지 못합니다. 둘 다 봐야 합니다.
           */
          step.dist < SPEND &&
          straight > 1.6 &&
          (passingBy || !treasureClaims(step.dist))
        ) {
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
        else if (straight <= 1.6) {
          /**
           * **이미 도착했습니다 — 포기가 아닙니다.**
           *
           * 예전엔 이 경우가 아래 `else`(포기)로 떨어졌습니다. 그래서
           * 소비처 **위에 서 있는데** "가려다 접음"으로 기록되고, 30초
           * 쿨다운까지 걸리고, 지갑 기준선도 그때 값으로 덮였습니다.
           * 벤치에 `접은 거리 0~56m` 의 **0m** 가 그것이었습니다 —
           * 0m 를 "너무 멀어서 접었다"로 세고 있었던 셈입니다.
           *
           * 실제 강화는 아래 도착 블록(`fd < 2.6`)이 하고 있었으므로
           * 기능은 돌았지만, **눈금이 거짓말을 했습니다.** 이번 라운드
           * 내내 잡아 온 그 모양입니다. 여기서는 아무것도 하지 않고
           * 도착 블록으로 흘려보냅니다.
           */
        }
        else {
          // 붙었는데도 못 쓰는 상황이면(적이 가까워 막힘 등) 한동안 포기합니다.
          //
          // **왜 포기했는지 남깁니다.** 지갑 조건을 고친 뒤에도 화톳불 방문이
          // 판마다 1회로 그대로였습니다. "안 가는 것"과 "못 가는 것"은 다르고,
          // 후자면 그건 봇이 아니라 **지도** 문제입니다.
          /**
           * **어느 소비처를 접었는지, 그때 다른 곳은 얼마였는지** 같이 남깁니다.
           *
           * 봇은 `fire` 를 **가장 가까운** 소비처로 고릅니다. 그런데 이 존은
           * 한 방향(+X)이라, 70% 지점에서 가장 가까운 것이 **뒤에 있는**
           * 모루일 수 있습니다 — 앞의 것을 두고요. 그러면 "예산 밖"이라
           * 접고, 쿨다운이 끝날 즈음엔 이미 보스 앞입니다.
           *
           * 이게 사실인지는 **고르기 전의 목록**을 봐야 압니다. 두 번
           * 가설을 세우고 두 번 틀렸으니(모루 추가 · 성수병 사다리),
           * 이번에는 고치기 전에 적습니다.
           */
          /**
           * ── 🔢 **한 번 접은 것을 한 번으로 셉니다** ────────────────────
           *
           * 이 줄이 매 프레임 돌 수 있다는 것을 위 가지에서 확인했습니다
           * (쿨다운이 `passingBy` 로 면제되면 그렇게 됩니다). 그때 벤치는
           * `가려다 접음 113회` 를 찍었고, 저는 그걸 **113번 발길을 돌린
           * 것**으로 읽을 뻔했습니다. 실제로는 한 상황이었습니다.
           *
           * 위 가지를 고쳤으니 지금은 안 그럴 것입니다. 그래도 여기서
           * 전이만 세는 이유는, **다음에 또 그런 자리가 생겨도 눈금은
           * 거짓말을 하면 안 되기** 때문입니다. 이 저장소가 연계 장부와
           * 구르기 시도에서 이미 배운 규칙입니다 — *상태의 전이를 세야지
           * 값을 세면 안 된다.*
           */
          const skipKey = `${fire.x.toFixed(0)},${fire.z.toFixed(0)}`
          if (skipKey === lastSkipKey) {
            // 같은 소비처를 계속 접고 있는 중입니다 — 새 사건이 아닙니다.
          } else {
          lastSkipKey = skipKey
          fireSkips.push({
            at: Number(now().toFixed(1)),
            dist: step ? Number(step.dist.toFixed(0)) : -1,
            straight: Number(straight.toFixed(0)),
            target: `${fire.anvil ? '모루' : '화톳불'}(${fire.x.toFixed(0)},${fire.z.toFixed(0)})`,
            all: (G.spendPoints?.() ?? []).map((sp) => {
              const st = G.pathStep(sp.x, sp.z)
              return `${sp.anvil ? '모루' : '불'}${st ? Math.round(st.dist) : -1}m`
            }),
          })
          }
          fireCooldownUntil = now() + 30
          fireTripUntil = 0
          lastFireWallet = { embers: em.embers, stones: wu.stones }
        }
      }
      /**
       * ⚠️ `p.hp < 70` 은 **화톳불에만** 걸립니다.
       *
       * 안 나누었더니 봇이 체력 66으로 모루에 붙어 2.5초마다 다시 서기를
       * 반복하며 존을 못 끝냈습니다(174.9초 · 보스 조우 X). 모루는 회복을
       * 안 하니 조건이 영원히 참입니다.
       *
       * 이건 봇 버그가 아니라 **사람도 똑같이 하는 실수**를 미리 본 것입니다.
       * 그래서 HUD 문구를 "모루 — 강화만 할 수 있다 (회복·부활 없음)" 로
       * 두고, 불꽃도 따뜻한 색도 빼 두었습니다. 생김새가 먼저 말해야 합니다.
       */
      /**
       * 🔥 **밟고 서 있는 소비처는 고른 것과 무관하게 씁니다.**
       *
       * 단일 판이 이렇게 찍었습니다:
       *
       *   열림 **38%** · 정련석 3 · 불티 526 · 무기 강화 **0회**
       *   강화 시도 — **B 눌림 0회**
       *
       * 문은 열려 있었고 재료도 돈도 있었는데 **한 번도 안 눌렀습니다.**
       * 원인은 위에서 고른 `fire` **하나만** 도착 판정을 받는다는 것이었습니다.
       * 봇은 *"다음 소비처에서 쓰자"* 고 정해 두고, 그러다 **다른 소비처를
       * 밟고 지나가도** 그냥 지나쳤습니다.
       *
       * 사람은 그렇게 안 합니다. 소울류는 **밟고 있는** 화톳불에서 쉬고,
       * 세키로는 조각상이 촘촘해서 지나가며 씁니다. 지난 라운드에 이
       * 규칙을 **관문(walletGrew)에는 넣고 도착 판정에는 안 넣었습니다** —
       * 반쪽만 고친 셈이고, 그래서 `닿음 0.0회` 가 그대로였습니다.
       *
       * ⚠️ 고른 것을 **덮어씁니다.** 아래 로그(“가려다 접음”)도 같은 변수를
       *    보므로, 덮어쓰지 않고 따로 두면 장부가 또 둘이 됩니다.
       */
      const underfoot = spendPts.find(
        (sp) => Math.hypot(sp.x - p.x, sp.z - p.z) < 2.6,
      )
      if (underfoot) fire = underfoot
      if (fire && ((p.hp < 70 && fire.anvil !== true) || canUpgrade)) {
        const fd = Math.hypot(fire.x - p.x, fire.z - p.z)
        if (fd < 2.6) {
          releaseAll()
          /**
           * ⚠️ **순서를 뒤집었습니다 — 정련석이 있으면 무기가 먼저입니다.**
           *
           * 원래는 "성수병 먼저, 남으면 무기"였고 근거는 *"그게 초보자의
           * 기본값"* 이었습니다. 그런데 그건 **잰 것이 아니라 제가 정한
           * 가정**이었고, 그 가정 하나가 무기 축을 통째로 못 재게 만들고
           * 있었습니다:
           *
           *   `39.2초 모루 — 불티 90 · 성수병 강화 · 무기 불티 부족(30/80)`
           *   `끝: 불티 414 · 정련석 5 누적 · 무기 0강`
           *
           * 성수병(60)을 안 샀으면 90 ≥ 80 으로 무기가 올랐습니다. 화폐가
           * 하나뿐이라 **싼 쪽이 늘 먼저 팔리고**, 비싼 쪽은 영영 순서를
           * 못 받습니다. 그 결과 정련석 5개가 끝까지 안 쓰인 채 남습니다 —
           * 무기 전용 자원이 **죽은 자원**이 된 것입니다.
           *
           * 뒤집는 근거는 희소성입니다. 불티는 잡으면 계속 나오지만(끝에
           * 414 남음) 정련석은 **보물과 보스에서만** 나옵니다. 손에 쥔
           * 희소하고 용도가 하나뿐인 것을 먼저 쓰는 편이 사람의 행동에
           * 가깝고, `npm run upgrade` 의 주석이 내린 결론과도 같습니다 —
           * *"불티가 아니라 정련석의 총량이 존을 제한합니다."*
           *
           * 남는 설계 질문은 그대로 적어 둡니다: **화폐 하나로 두 축을
           * 사면 싼 쪽이 비싼 쪽을 굶깁니다.** 소울이 뼛조각과 티타나이트를
           * 나눈 이유입니다. 봇의 순서를 바꾼 것은 그 질문을 **잴 수 있게**
           * 만든 것이지 답한 것이 아닙니다.
           */
          const visit = {
            at: Number(now().toFixed(1)),
            embers: G.emberInfo().embers,
            vialCost: em.upgradeCost,
            stones: wu.stones,
            stoneNeed: wu.nextStoneCost,
            emberNeed: wu.nextCost,
            vial: false,
            weapon: false,
            atStation: false,
            atAfter: false,
            anvil: fire.anvil === true,
          }
          /**
           * ⚠️ **누른 것이 아니라 바뀐 것을 적습니다.**
           *
           * 예전엔 `tap('KeyB')` 바로 뒤에 `visit.weapon = true` 였습니다.
           * 그래서 벤치가 *"닿았을 때 무기 강화함 4회"* 라고 찍는 동안
           * 진짜 강화 횟수(게임 상태의 차이)는 **0** 이었습니다 —
           * 두 눈금이 같은 것을 두고 정반대를 말했습니다.
           *
           * 원인은 **봇이 자기 기준으로 "닿았다"를 판단한 것**이었습니다.
           * 직선 2.6m 면 눌렀는데 게임의 반경은 2.4m 이고, 화톳불은
           * 적이 14m 안에 있으면 아예 막힙니다. 못 쓰는 자리에서 누르고
           * "썼다"고 적고 있었던 것입니다.
           *
           * 이 프로젝트에서 계속 나온 규칙 그대로입니다 — **의도가 아니라
           * 결과를 세고, 판단은 게임에서 읽습니다.**
           */
          const beforeVial = G.vialInfo().max
          const beforeLevel = G.weaponUpgradeInfo().level
          // 게임이 "여기서 된다"고 할 때까지 잠깐 기다립니다(반경 차이 흡수).
          const settleBy = now() + 1.5
          while (now() < settleBy && !G.weaponUpgradeInfo().atStation) await sleep()
          visit.atStation = G.weaponUpgradeInfo().atStation === true
          /**
           * ⚠️ **한 번 누르면 게임이 처리할 때까지 기다립니다.**
           *
           * 게임이 갈림길마다 세게 했더니 답이 나왔습니다:
           *   `B 눌림 1 · 자리아님 0 · 소비됨 1 · 정련석X 0 · **불티X 1** · 성공 0`
           * 게임 자신의 `embers < cost` 에서 걸렸는데, 봇은 누르기 직전에
           * 불티를 다시 읽고 "충분하다"고 판단했습니다.
           *
           * `await sleep()` 은 8ms 이고 한 프레임은 **100ms** 입니다.
           * 성수병 결제(60)가 아직 반영되지 않은 지갑을 보고 무기(80)를
           * 또 사려 한 것입니다 — **같은 돈을 두 번 셌습니다.**
           * (`성수병 못함` 이라고 적혔는데 게임은 `성수병 강화 1회` 였던
           *  앞 판의 모순도 같은 원인입니다.)
           *
           * 이번 라운드 내내 나온 그 규칙입니다 — **일어나기 전에 재지
           * 않습니다.** 눌렀으면 반영될 때까지 기다린 뒤 다음을 정합니다.
           */
          const applied = async (read, before, limit = 2.0) => {
            const until = now() + limit
            while (now() < until && read() === before) await sleep()
            return read() !== before
          }
          const w2 = G.weaponUpgradeInfo()
          if (w2.nextCost > 0 && G.emberInfo().embers >= w2.nextCost && w2.stones >= w2.nextStoneCost) {
            tap('KeyB')
            visit.weapon = await applied(() => G.weaponUpgradeInfo().level, beforeLevel)
            /**
             * **누른 직후의 자리 상태**도 남깁니다.
             *
             * 한 판에서 이런 줄이 나왔습니다:
             *   `화톳불 — 불티 106 · 정련석 1 · 무기 불티 부족(106/80)`
             * 106 ≥ 80 이고 정련석도 1/1 인데 강화가 안 됐습니다. 즉
             * `불티 부족` 은 **아무 조건에도 안 걸렸을 때 떨어지는 맨 끝
             * 분류**였고, 라벨 자체가 거짓이었습니다.
             *
             * 후보는 이것입니다 — 화톳불의 강화는 `!rest.blocked` 에 걸려
             * 있고, `blocked` 는 **적이 14m 안에 있으면** 참입니다. 모루에는
             * 그 조건이 없습니다. 읽을 때는 자리였는데 누를 때 아니었으면
             * 여기 `atAfter` 가 false 로 남습니다.
             */
            visit.atAfter = G.weaponUpgradeInfo().atStation === true
            /**
             * ⚠️ **왜 자리가 아닌지도 받아 적습니다.** `자리 X→X` 만으로는
             *    "가까이 안 갔다"와 "갔는데 적이 막았다"가 구분이 안 되고,
             *    처방이 정반대입니다(봇의 이동 vs 정리부터 하라는 설계).
             *    판단은 게임이 합니다(main.ts `spendBlock`).
             */
            visit.blockedBy = G.weaponUpgradeInfo().blockedBy ?? ''
          }
          /**
           * ── 💰 **정련석을 쥐고 있으면 무기 몫을 남겨 둡니다** ──────────
           *
           * 새로 붙인 장부가 이 한 줄로 갈랐습니다:
           *
           *   `37.3초 화톳불 — 불티 72 · 정련석 1 · 성수병 강화 · 무기 불티 부족(12/80)`
           *   끝: 불티 280 · 정련석 누적 6 · **무기 강화 0회**
           *
           * 무기(80)에 8이 모자란 상태에서 성수병(60)이 나갔고, 남은 것은
           * **12** 였습니다. 그 뒤로 이 판은 `못삼 96%` 로 끝났습니다.
           * 정련석 6개가 끝까지 안 쓰인 채 남습니다.
           *
           * 순서는 이미 무기 먼저로 뒤집어 뒀는데(위 설계 노트), **순서만으로는
           * 부족했습니다** — 무기를 지금 못 사면 순서가 무의미하고, 싼 쪽이
           * 그대로 돈을 가져갑니다.
           *
           * ⚠️ 이것을 **게임 문제로 오해할 뻔했습니다.** 이 저장소가 적어 둔
           *    *"화폐 하나로 두 축을 사면 싼 쪽이 비싼 쪽을 굶깁니다"* 가
           *    떠올라서 밸런스를 가르려 했는데, 게임은 **선택을 주고
           *    있습니다.** 먼저 써 버리는 것은 봇입니다. 사람은 정련석을
           *    쥐고 있으면 60짜리를 사서 80짜리를 못 사게 만들지 않습니다.
           *    소울류에서 다음 강화를 눈앞에 두고 소모품에 소울을 태우는
           *    사람은 없습니다.
           *
           * 규칙: **정련석이 다음 단계에 충분하면**, 그 단계의 불티 몫을
           * 남기고 남는 것으로만 성수병을 봅니다. 정련석이 모자라면 무기는
           * 어차피 못 사므로 아낄 이유가 없습니다.
           */
          const em2 = G.emberInfo()
          const w3 = G.weaponUpgradeInfo()
          // 규칙은 위 `emberReserveOf` 한 곳에만 — 여기서 다시 쓰면 갈라집니다.
          const reserve = emberReserveOf(w3)
          if (reserve > 0) visit.reserved = reserve
          if (
            em2.upgradeCost > 0 &&
            em2.embers - reserve >= em2.upgradeCost
          ) {
            tap('KeyV')
            visit.vial = await applied(() => G.vialInfo().max, beforeVial)
          }
          fireVisits.push(visit)
          lastFireWallet = { embers: G.emberInfo().embers, stones: G.weaponUpgradeInfo().stones }
          // 한 번 들렀으면 한동안 다시 오지 않습니다. 안 그러면 아직 살 수 있는
          // 강화가 남아 있는 한 화톳불과 목표 사이를 영원히 오갑니다
          // (실제로 그렇게 막혀서 139초에 실행이 끝났습니다).
          fireCooldownUntil = now() + 15
          fireTripUntil = 0
          const until = now() + 2.5
          while (now() < until) await sleep()
          lastVials = G.vialInfo().vials
          continue
        }
      }

      /**
       * ---- 곁길: 보물을 주우러 간다 ----
       *
       * ── 왜 이 가지가 생겼는가 ────────────────────────────────────
       * 마흔 판을 돌리는 동안 봇은 보물을 **한 개도** 줍지 않았습니다.
       * 그런 가지가 아예 없었기 때문입니다. 결과가 조용히 이상했습니다:
       * "정련석 누적 2" — 정확히 **보스가 주는 2개**입니다. 즉 존이 끝날
       * 때까지 정련석이 하나도 없어서, 무기 강화는 판마다 0회로 찍혔습니다.
       * 불티는 318이 남아 있었는데도요. 강화가 안 도는 게 아니라
       * **재료가 도착한 적이 없었습니다.**
       *
       * 더 큰 문제는 이겁니다: 기둥 4(탐험)의 핵심 질문이
       * *"곁길에 갈지 말지의 선택이 좋은 선택인가"* 인데, 곁길에 **가 본
       * 적이 없으니** 그 질문에 답할 데이터가 0이었습니다.
       * 존의 절반(남은 적 10마리)도 그래서 안 밟혔습니다.
       *
       * ── 사람처럼 굴게 하는 세 가지 조건 ───────────────────────────
       *   1. **싸우는 중에는 안 갑니다.** 사람은 전투가 끝나고 줍습니다.
       *   2. **너무 멀면 안 갑니다.** 존을 되돌아가서 상자 하나를 여는
       *      플레이는 없습니다. 걸어야 하는 거리(직선 아님)로 자릅니다.
       *   3. **한 번 나선 왕복에는 제한 시간이 있습니다.** 화톳불 왕복에서
       *      두 번 데인 그 버그입니다 — 도착 판정이 어긋나면 목표와 곁길
       *      사이를 영원히 오갑니다.
       */
      const fighting = near && reachable && near.dist < 12
      /**
       * 🧭 곁길 가지에 **못 들어간 경우도** 거리와 이유를 남깁니다.
       *
       * 이게 없으면 `treasureBest` 는 *"곁길을 볼 수 있었던 프레임"* 에서만
       * 갱신됩니다. 즉 싸우는 동안 보물 옆을 스쳐 지나가면 그 근접은
       * 장부에 아예 안 남고, 나중에 *"40m 까지밖에 못 갔다"* 는 잘못된
       * 그림이 그려집니다. 재는 것은 **실제 거리**여야 합니다.
       */
      if (fighting || now() < treasureCooldownUntil) {
        const why = fighting ? '싸우는중' : '왕복쿨다운'
        for (const t of G.treasurePositions()) {
          if (t.taken) continue
          const step = G.pathStep(t.x, t.z)
          if (!step) continue
          const key = `${Math.round(t.x)},${Math.round(t.z)}`
          if (!(key in treasureBest) || step.dist < treasureBest[key]) treasureBest[key] = step.dist
          noteTreasureBlock(key, step.dist, why)
        }
      }
      if (!fighting && now() >= treasureCooldownUntil) {
        /**
         * ⚠️ **위에서 이미 구한 것을 다시 구하지 않습니다.**
         *
         * 예전엔 여기서 `pathStep` 을 보물마다 한 번 더 돌렸습니다. 값이
         * 같으리라는 보장이 없고(같은 프레임이어도 코드가 갈리면 언젠가
         * 갈라집니다), 무엇보다 *"가장 가까운 보물"* 이라는 **같은 규칙이
         * 두 곳**에 있게 됩니다. 이 저장소가 그것으로 이미 여러 번 데였고,
         * 바로 이번 라운드에도 상황 모션이 그래서 접혔습니다.
         */
        const best = nearTreasure
        const seen = []
        for (const t of G.treasurePositions()) {
          if (t.taken) continue
          const step = G.pathStep(t.x, t.z)
          if (!step) continue
          const key = `${Math.round(t.x)},${Math.round(t.z)}`
          if (!(key in treasureBest) || step.dist < treasureBest[key]) treasureBest[key] = step.dist
          seen.push({ key, dist: step.dist })
        }
        for (const sObj of seen) {
          if (best && sObj.key === best.key) {
            noteTreasureBlock(sObj.key, sObj.dist, best.dist <= TREASURE_DETOUR ? '가는중' : '예산초과')
          } else {
            noteTreasureBlock(sObj.key, sObj.dist, '더가까운게있음')
          }
        }
        if (best && best.dist <= TREASURE_DETOUR) {
          if (treasureTripUntil === 0) {
            treasureTripUntil = now() + 30
            detour = { at: now(), hp: p.hp, dist: Number(best.dist.toFixed(1)), damage: 0 }
          }
          if (now() > treasureTripUntil) {
            // 30초를 썼는데 못 주웠으면 포기합니다. 기록에는 남깁니다 —
            // "못 가는 보물"은 지도 문제이지 봇 문제일 수도 있습니다.
            treasureCooldownUntil = now() + 45
            treasureTripUntil = 0
            if (detour) detours.push({ ...detour, took: Number((now() - detour.at).toFixed(1)), got: false })
            detour = null
          } else {
            markAct('보물이동')
            // 마지막 몇 미터는 직선 — 격자 길찾기는 목적지에 붙으면 진동합니다
            // (화톳불에서 이미 한 번 데인 자리입니다).
            const straight = Math.hypot(best.goal.x - p.x, best.goal.z - p.z)
            const tx = straight < 5 ? best.goal.x : best.step.x
            const tz = straight < 5 ? best.goal.z : best.step.z
            moveToward(tx - p.x, tz - p.z)
            await sleep()
            continue
          }
        } else if (treasureTripUntil > 0) {
          treasureTripUntil = 0
          detour = null
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
      // 이어짐 눈금 — 봇이 세는 게 아니라 **게임이 센 것**을 그대로 받습니다.
      inputUsed: G.runStats().inputUsed,
      /**
       * 공격을 끊고 구른 횟수. **A/B 를 8판 돌리고 나서야 이게 없다는 걸
       * 알았습니다.** 취소 회피를 켜고 끄고 비교했는데, 정작 봇이 그 기능을
       * 몇 번 썼는지 모르는 채였습니다 — 차이가 없어도 "효과가 없다"인지
       * "쓰이질 않았다"인지 가릴 수가 없습니다.
       */
      inputCancels: G.runStats().inputCancels ?? 0,
      /**
       * ⚔️ 상황 모션이 **실제로 나간** 횟수. 봇이 "눌렀다"를 세면 안 됩니다 —
       * 누른 것과 나간 것은 다르고(기력·상태가 막습니다), 이 프로젝트에서
       * 잡은 계기 버그 열둘이 전부 그 틈에서 나왔습니다.
       */
      barrelsBlown: G.runStats().barrelsBlown ?? 0,
      barrelsCaught: G.runStats().barrelsCaught ?? 0,
      barrelsLitCaught: G.runStats().barrelsLitCaught ?? 0,
      /**
       * 💥 **통을 겨눠 누른 프레임 수** — 「터뜨린 횟수」가 아닙니다.
       *
       * 처음엔 이걸 *"일부러 터뜨린 횟수"* 로 적었다가 145 vs 3 이 나와서
       * 라벨이 틀렸다는 걸 알았습니다. 누른다고 다 나가지 않습니다
       * (후딜·선입력·조준 보정). 세는 것을 **세는 그대로** 부릅니다.
       */
      barrelLitByBot: actTotals.get('통점화') ?? 0,
      barrelLeft: G.barrelInfo().barrels.length,
      barrelChance: Object.entries(barrelChance).map(([k, v]) => ({ at: k, ...v })),
      runAttacks: G.runStats().runAttacks ?? 0,
      rollAttacks: G.runStats().rollAttacks ?? 0,
      plungeAttacks: G.runStats().plungeAttacks ?? 0,
      /** 시뮬레이션 1초당 봇이 판단한 횟수 — 판끼리 견줄 수 있는지 가릅니다. */
      botTicksPerSec: Number((botTicks / Math.max(1, now())).toFixed(1)),
      /** 이번 판에 덮어쓴 설정 — 나중에 "무엇을 바꿔 돌린 판인가"를 알 수 있게. */
      tweaks: G.tweaks ? G.tweaks() : [],
      bleedDecayedAll: G.runStats().bleedDecayedAll,
      bleedDiedWith: G.runStats().bleedDiedWith,
      bleedDiedWithAvg: G.runStats().bleedDiedWithAvg,
      bleedDiedWithMax: G.runStats().bleedDiedWithMax,
      bleedDiedBuiltAvg: G.runStats().bleedDiedBuiltAvg,
      bleedDiedHitsAvg: G.runStats().bleedDiedHitsAvg,
      bossTime: G.runStats().bossTime,
      inputExpired: G.runStats().inputExpired,
      // 버려진 것을 **종류별로** 나눠 적습니다 — 셋의 처방이 서로 다릅니다
      // (근거: playerControl.ts `inputFlow`).
      inputExpiredAttack: G.runStats().inputExpiredAttack,
      inputExpiredDodge: G.runStats().inputExpiredDodge,
      inputExpiredSkill: G.runStats().inputExpiredSkill,
      inputDropped: G.runStats().inputDropped,
      inputWaitAvg: G.runStats().inputWaitAvg,
      bossWeaponLevel,
      /**
       * 🛡 시도와 성공을 **나눠** 적습니다. 하나로 합치면 "안 나온다"가
       * 시도를 안 한 것인지 못 맞춘 것인지 구분이 안 되고, 처방이 정반대입니다
       * (전자는 봇/안내, 후자는 창 길이).
       */
      guardTries,
      guardSawWindow,
      guardBlockedByState,
      guardOpens,
      guardWhiffs,
      guardSpared,
      guardWhy,
      guardWhyLog,
      guards: G.guardInfo().count,
      greenSwung: G.runStats().greenSwung,
      greenDied: G.runStats().greenDied,
      greenCountered: G.runStats().greenCountered,
      greenBroken: G.runStats().greenBroken,
      regionLog: merged.map((r) => ({ name: r.name, seconds: Number(r.seconds.toFixed(1)) })),
      regionDanger: Object.entries(regionDanger)
        .filter(([, v]) => v.seconds >= 3)
        .map(([name, v]) => ({
          name,
          seconds: Number(v.seconds.toFixed(1)),
          damage: Math.round(v.damage),
          combat: Number(v.combat.toFixed(1)),
          swings: v.swings,
          kills: v.kills,
          /** 위험도는 **교전 시간**으로 나눕니다 — 넓어서 오래 걸린 구역과 구분하려고. */
          perMin: Number(((v.damage / Math.max(1, v.combat)) * 60).toFixed(1)),
        }))
        .sort((a, b) => b.perMin - a.perMin),
      regionTotal: Object.entries(total)
        .map(([name, seconds]) => ({ name, seconds: Number(seconds.toFixed(1)) }))
        .sort((a, b) => b.seconds - a.seconds),
      hitLimit: now() - t0 >= LIMIT - 1,
      /** 벽시계 안전줄에 걸려 **중간에 잘렸는가.** 집계에서 빼야 합니다. */
      wallStopped,
      /** 이 판이 실제로 돈 **시뮬레이션 시간**. 창이 같은지 확인하는 근거. */
      simSecs: Number((now() - t0).toFixed(1)),
      /** 이 판에 주어졌던 창(시뮬레이션초). 판마다 다르면 견줄 수 없습니다. */
      limit: LIMIT,
      /**
       * ── 이 기계의 속도 — **시뮬레이션초 ÷ 벽시계초** ─────────────────
       *
       * 왜 이걸 기록하는가. 벤치가 `⏱️ 벽시계로 잘림 — 집계에서 뺍니다` 로
       * 판을 버리는데, **버려지는 판이 무작위가 아니었습니다.**
       *
       *   · 존을 클리어하면 그 순간 판이 **끝납니다**(190 시뮬레이션초).
       *   · 클리어를 못 하면 창 끝(420초)까지 **다 돕니다.**
       *   → 그러니 벽시계에 먼저 걸리는 쪽은 언제나 **못 깬 판**입니다.
       *
       * 실제로 그렇게 나온 벤치가 있습니다: 3판 중 2판이 잘리고 남은 1판이
       * 클리어한 판이어서 `존 클리어 1/1판` 이라고 적혔습니다. **3판 중
       * 1판만 깼는데 100% 라고 보고한 것입니다.** 자르는 잣대(벽시계)가
       * 재려는 것(클리어했는가)과 붙어 있으면, 남은 표본은 표본이 아닙니다.
       *
       * 그래서 창을 이 기계가 **끝까지 돌 수 있는 길이로** 정해야 하고,
       * 그러려면 속도를 알아야 합니다. 이 값이 그 근거입니다.
       */
      botWallSecs: Number(((Date.now() - botWallT0) / 1000).toFixed(1)),
      simPerWall: Number((((now() - t0) * 1000) / Math.max(1, Date.now() - botWallT0)).toFixed(3)),
      /**
       * 데워진 뒤부터만 잰 속도. 창 길이는 **이쪽으로** 정합니다.
       * 판이 그만큼 안 돌았으면(예: 8초 만에 끝) 잴 게 없으니 `null` —
       * 0 을 내면 "아주 느린 기계"로 읽혀 창이 최소값까지 쪼그라듭니다.
       */
      simPerWallWarm:
        warmWallT0 > 0 && now() - warmSimT0 >= 5
          ? Number((((now() - warmSimT0) * 1000) / Math.max(1, Date.now() - warmWallT0)).toFixed(3))
          : null,
      bossSwings: Object.entries(G.bossSwingLog()).map(([id, v]) => ({ id, ...v })),
      /**
       * 보스가 **가질 수 있는** 패턴 전부. 벤치가 *"한 번도 안 나온 것"* 을
       * 물으려면 기준 목록이 있어야 하는데, 나온 것에서 추론하면 안 나온
       * 것은 정의상 안 보입니다 — 그건 검사가 아니라 동어반복입니다.
       * 목록은 게임이 줍니다(프로브가 패턴 이름을 외우지 않게).
       */
      bossPatterns: (G.enemyRoster().find((r) => r.id === 'boss')?.attacks ?? []).map((a) => a.id),
      /** 적 종류별 휘두름/적중 — "이 적이 존에서 제 일을 하는가" */
      foeSwings: Object.entries(G.foeSwingLog?.() ?? {}).map(([id, v]) => ({ id, ...v })),
      // 절벽 낙하 — 「밀어서 떨어뜨리기」가 실제로 일어나는지.
      falls: G.fallLog?.() ?? null,
      tripBlock,
      // 무기 강화가 **어느 갈림길에서 멈췄는지** — 게임이 직접 센 값.
      upgradeTries: G.upgradeTries?.() ?? null,
      passBy: [...passBy.entries()].map(([k, v]) => ({ where: k, ...v })),
      spendBest: Object.entries(spendBest).map(([k, v]) => ({ where: k, ...v })),
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
        inRangePct: bossRangeSamples
          ? Math.round((bossInRangeSamples / bossRangeSamples) * 100)
          : 0,
        windingPct: bossRangeSamples
          ? Math.round((bossWindingSamples / bossRangeSamples) * 100)
          : 0,
        attackRange: bossAttackRange,
        dist: bossDist,
        phaseTime: bossPhaseTime.map((v) => Number(v.toFixed(1))),
        introTime: Number(bossIntroTime.toFixed(1)),
        budget: Object.fromEntries(
          Object.entries(bossBudget).map(([k, v]) => [k, Number(v.toFixed(1))]),
        ),
        breaks: bossBreaks,
        phaseDamage: bossPhaseDamage.map((v) => Math.round(v)),
        /**
         * ── 페이즈 **구간 체력** — 프레임 표본을 안 씁니다 ────────────
         *
         * 프레임마다 (지난 체력 − 지금 체력)을 더해 페이즈에 얹어 봤더니
         * 166 / 394 / 58 이 나왔습니다. 그런데 실제 구간은 155 / 217 / 248
         * 입니다 — 3단계 몫의 대부분이 2단계에 얹혔습니다.
         *
         * 원인은 **10fps**입니다. 한 프레임에 콤보와 처형이 같이 들어가면
         * 100 넘는 피해가 한 덩어리로 잡히고, 그 프레임에 경계를 넘으면
         * 전부 앞 페이즈로 갑니다.
         *
         * 그런데 구간 체력은 **애초에 알고 있는 값**입니다(경계 × 최대 체력).
         * 표본이 필요 없습니다. 시간만 재고 나누면 정확합니다 —
         * 계기를 고치는 가장 좋은 방법은 **안 재도 되는 것을 안 재는** 것입니다.
         * (⚠️ 경계는 bossTuning() 에서 읽습니다. 여기 베껴 적지 않습니다.)
         */
        phaseBands: (() => {
          const t = G.bossTuning()
          const maxHp = G.enemyRoster().find((r) => r.id === 'boss')?.maxHp ?? 0
          return t.map((ph, i) => {
            const upper = ph.enterBelow
            const lower = i + 1 < t.length ? t[i + 1].enterBelow : 0
            return maxHp * (upper - lower)
          })
        })(),
        phaseFinishers: bossPhaseFinishers,
        phaseBreaks: bossPhaseBreaks,
        engaged: Number(bossEngaged.toFixed(1)),
        disengaged: Number(bossDisengaged.toFixed(1)),
        resets: bossResets,
        finishers: G.runStats().bossFinishers,
        chainsArmed: G.runStats().chainsArmed,
        // 예약과 **같은 자리**에서 센 발동 — 나란히 뺄 수 있는 유일한 짝입니다.
        chainsFired: G.runStats().chainsFired,
        chainsLost: G.runStats().chainsLost,
        chainsDropped: G.runStats().chainsDropped,
        chainsPending: G.runStats().chainsPending,
      },
      /** 전투 사이 빈 시간 — 지도 밀도의 답 */
      gapAvg: gaps.length ? Number((gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)) : 0,
      gapMax: gaps.length ? Number(Math.max(...gaps).toFixed(1)) : 0,
      gapLong: gaps.filter((g) => g >= 8).length,
      gapCount: gaps.length,
      longGaps: longGaps.sort((a, b) => b.secs - a.secs).slice(0, 4),
      /** 스태미나가 실제로 제약이 되는가 */
      minStamina: Number(minStamina.toFixed(0)),
      dodgeCost,
      lowStaminaRatio: staminaSamples ? Math.round((lowStaminaSamples / staminaSamples) * 100) : 0,
      /** 강인도 붕괴와 그 틈의 활용 */
      poiseBreaks: G.runStats().poiseBreaks,
      /**
       * 🩸 출혈이 터진 횟수. **붕괴와 나란히** 놓아야 두 축이 실제로
       * 갈리는지 보입니다 — 대검은 무너뜨리고 단검은 터뜨린다는 주장이
       * 판에서 성립하는지가 이 두 숫자의 비율입니다.
       */
      bleedPops: G.runStats().bleedPops ?? 0,
      bleedPeak: G.runStats().bleedPeak ?? 0,
      bossBleedPeak: G.runStats().bossBleedPeak ?? 0,
      bossBleedApplied: G.runStats().bossBleedApplied ?? 0,
      bossBleedDecayed: G.runStats().bossBleedDecayed ?? 0,
      bossBleedGapAvg: G.runStats().bossBleedGapAvg ?? 0,
      bossBleedGapMax: G.runStats().bossBleedGapMax ?? 0,
      bossBleedGapInsideRate: G.runStats().bossBleedGapInsideRate ?? 0,
      bossDamageBySource: G.runStats().bossDamageBySource ?? {},
      mobDamageBySource: G.runStats().mobDamageBySource ?? {},
      focusFlow: G.runStats().focusFlow ?? {},
      bossBleedPops: G.runStats().bossBleedPops ?? 0,
      breakHpAvg: G.runStats().breakHpAvg,
      brokenDeaths: G.runStats().brokenDeaths,
      finisherReady: finisherReadySamples,
      finisherNoStamina: finisherNoStaminaSamples,
      skillCasts: G.runStats().skillCasts,
      lightSwings: G.runStats().lightSwings,
      noSkillPct: rhythmSamples ? Math.round((noSkillSamples / rhythmSamples) * 100) : 0,
      manySkillPct: rhythmSamples ? Math.round((manySkillSamples / rhythmSamples) * 100) : 0,
      noStaminaPct: rhythmSamples ? Math.round((noStaminaSamples / rhythmSamples) * 100) : 0,
      greenEvents,
      greenAnswerable,
      behindSamples,
      behindOk,
      greenInFront,
      greenReady,
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
      weaponId: G.state().loadout.weapon,
      /**
       * 🩸 **손익분기 간격** — 이보다 느리게 때리면 출혈은 영영 안 찹니다.
       * 식을 프로브가 들고 있지 않습니다(main.ts `bleedInfo().breakEvenGap`).
       */
      bleedBreakEven: (G.bleedInfo().weapons ?? []).map((w) => ({
        id: w.id,
        gap: w.breakEvenGap,
      })),
      /**
       * ── 존에서 **등 뒤를 실제로 잡는가** ────────────────────────────
       *
       * 무기 벤치(허수아비)는 쌍단검이 **등 뒤에서 2.33배**라고 말합니다.
       * 그런데 존을 세 무기로 돌려 보니 단검이 가장 나쁩니다 — 클리어
       * 263초(롱소드 167초), 받은 피해 404(롱소드 183).
       *
       * 두 가지가 가능합니다:
       *   · 숫자가 약하다            → 밸런스 문제
       *   · 정체성(백어택)을 못 쓴다 → 기회/조작 문제
       * **완전히 다른 처방**입니다. 존에서의 백어택 비율을 세면 갈립니다.
       * 벤치가 "무엇이 가능한가"를 재는 동안, 이 숫자는 "실제로 쓰이는가"를
       * 잽니다 — 이 프로젝트에서 그 둘을 안 나눠 여러 번 헤맸습니다.
       */
      backHits: G.state().backHits,
      hitsDealt: G.state().hitsDealt,
      weaponLevels: G.weaponUpgradeInfo().levels,
      stones: G.weaponUpgradeInfo().stones,
      stonesEarned: G.weaponUpgradeInfo().earnedStones,
      minHp: Number(minHp.toFixed(1)),
      damageTaken: Number(damageTaken.toFixed(0)),
      /**
       * 🩸 **맞은 한 대마다 공정했는가.** 판정은 게임이 예고 중에 내려 두었고
       * (main.ts `noteHurt`), 여기서는 세기만 합니다. 아레나에서 잡몹으로만
       * 확인한 것이라, 화면 밖에서 오는 한 대(🏹 궁수 12m · 🟣 끄는 자 12m)가
       * 실제로 있는지는 **존을 다 돈 이 판**에서만 보입니다.
       */
      /**
       * 🎨 **못 피한 한 대를 색별로도 셉니다.**
       *
       * 4색은 답이 서로 다릅니다. 🟡 광역을 *"안 굴렀다"* 고 세는 것은
       * 애초에 틀린 질문입니다 — 그 색의 정답은 **걸어서 이탈**입니다.
       * 색을 안 보면 `안누름 30` 을 보고 구르기를 손보게 되는데, 정작
       * 고칠 곳이 *"어디로 빠져나가야 하는지가 안 보인다"* 일 수 있습니다.
       */
      /** 💀 이 판에서 죽은 순간마다의 사인 — 판정은 게임이 내렸습니다. */
      deathLog: G.deathLog(),
      /**
       * 🫁 **기력에 묶여 맞은 한 대는 "누가 그 기력을 썼나"까지 셉니다.**
       *
       * `손이 묶임 — stamina` 는 벤치마다 `locked` 1위인데(24 · 16 · 11 · 8)
       * 한 칸이라 처방을 못 정했습니다. 공격이 썼으면 구르기 유보분이
       * 뚫린 것(버그)이고, 구르기가 썼으면 연달아 구른 것(가르칠 일),
       * 헛친 가드면 🟢 를 잘못 읽은 것입니다.
       */
      lockSpenders: (() => {
        const t = {}
        for (const r of G.hurtLedger()) {
          if (r.verdict !== 'locked:stamina') continue
          const k = r.spender || '기록없음'
          t[k] = (t[k] ?? 0) + 1
        }
        return t
      })(),
      hurtByColor: (() => {
        const t = {}
        for (const r of G.hurtLedger()) {
          if (!String(r.verdict).startsWith('fair')) continue
          /**
           * 🚶 **걸어서 벗어나려 했는가**를 칸에 붙입니다.
           *
           * `안누름` 은 *"구르지 않았다"* 만 뜻합니다. 🟡 광역처럼 정답이
           * **걸어서 이탈**인 색에서는 그게 오히려 정답이고, 그런데도 맞았다면
           * 물어야 할 것은 *"굴렀나"* 가 아니라 *"벌어졌나"* 입니다.
           * 0.5m 는 한 걸음도 아닌 값이라, 그 아래는 **제자리**로 봅니다.
           */
          /**
           * 🚶 **두 값을 나란히 놓아야 뜻이 생깁니다.**
           *
           * 예전엔 `moved`(적과의 거리 변화) 하나로 `걸었지만 / 제자리 /
           * 다가감` 을 붙였습니다. 그런데 **적도 움직입니다.** 내가 걸어
           * 나가도 적이 따라오면 거리가 그대로라 `제자리` 로 찍히고,
           * 그러면 *"안 걸었다 → 예고가 안 읽힌다"* 라는 **정반대 처방**이
           * 나옵니다. 🟡 광역을 두 라운드 동안 그 위에서 판단했습니다.
           *
           * 이제 게임이 `walked`(내가 실제로 움직인 거리 — 기준점이 안
           * 움직이는 값)도 함께 적습니다. 0.5m 는 한 걸음도 안 되는 값이라
           * 그 아래를 **안 걸음**으로 봅니다.
           *
           * ⚠️ **이 칸을 "정답을 냈다"로 읽으면 안 됩니다.**
           *
           * 재는 것은 *"예고 동안 발이 움직였는가"* 일 뿐, *"그 색의 답으로
           * 걸었는가"* 가 아닙니다. 봇은 🟡 에도 **구르기로 답합니다**
           * (걷기로 바꿔 봤다가 두 번 다 더 나빠져 되돌렸습니다). 그러니
           * `걸어서멀어짐` 은 대개 **길찾기·추격 때문에 우연히 난 이동**입니다.
           *
           * 실제로 이걸 확인했습니다. 게임 쪽은 멀쩡합니다 —
           * `npm run sweep` 이 예고가 뜬 **순간부터** 걸으면 두 광역 모두
           * 벗어난다고 말합니다:
           *
           *     보스 광역 예고 1.9초  · 판정 순간 12.0m (반경 7.5m) · 안 맞음
           *     잡몹 광역 예고 1.25초 · 판정 순간  8.8m (반경 4.6m) · 안 맞음
           *
           * 즉 벤치의 *"걸어서 멀어졌는데 맞음"* 은 **장판이 넓어서가 아니라
           * 늦게 움직여서**입니다. 라벨이 의도를 함의하면 그 다음 사람은
           * 게임을 고치러 갑니다 — 여기 못 박아 둡니다.
           */
          const walk =
            r.walked <= 0.5
              ? '발멈춤'
              : r.moved > 0.5
                ? '발움직임·멀어짐'
                : r.moved < -0.5
                  ? '발움직임·따라옴'
                  : '발움직임·제자리'
          const k = `${r.verdict.slice(5) || '갈라지기전'}|${r.color}|${r.answer}|${walk}`
          t[k] = (t[k] ?? 0) + 1
        }
        return t
      })(),
      hurt: (() => {
        // 씨앗을 실제 판정 이름과 **같게** 둡니다. `unseen` 하나로 두었더니
        // 판정이 둘로 갈린 뒤에도 늘 0 을 찍어, 없는 것처럼 보였습니다.
        const t = { fair: 0, 'unseen:아무것도': 0, 'unseen:몸만': 0, tooFast: 0, unknown: 0 }
        // 'locked:stamina' 처럼 **이유가 붙어** 옵니다. 앞머리로 뭉치지 않고
        // 그대로 셉니다 — 뭉치면 어디를 고칠지 다시 알 수 없어집니다.
        for (const r of G.hurtLedger()) t[r.verdict] = (t[r.verdict] ?? 0) + 1
        return t
      })(),
      /** 억울한 한 대의 **정체** — 무엇이, 얼마나 보였는지. 처방이 갈리는 곳입니다. */
      /**
       * ⚠️ `fair:안누름` 은 **일부러 뺍니다.** 위 집계 줄이 이미 개수를
       *    말해 주고, 여기 여섯 줄을 채우면 정작 손볼 거리가 있는
       *    `일찍`·`늦게`·`locked:` 가 밀려납니다. 뺀 것은 세어져 있습니다.
       */
      unfairHits: G.hurtLedger()
        .filter((r) => r.verdict !== 'fair' && r.verdict !== 'fair:안누름')
        .slice(0, 6)
        .map((r) => ({
          id: r.attackId,
          why: r.verdict,
          tel: r.telegraph,
          seen: r.seen,
          free: r.free,
          since: r.sinceTry ?? -1,
        })),
      maxAggro,
      avgAggro: Number((aggroSum / Math.max(1, aggroSamples)).toFixed(2)),
      multiRatio: Number(((multiSamples / Math.max(1, aggroSamples)) * 100).toFixed(0)),
      retreatRatio: Number(((retreatSamples / Math.max(1, engageSamples)) * 100).toFixed(0)),
      /**
       * 📒 **빗나간 이유** — 게임이 판정을 내린 그 자리에서 적은 장부입니다
       * (`systems/combat.ts` `swingRecords`). 여기서 각도를 다시 재지
       * 않는 것이 요점입니다 — 재면 판정의 사본이 생깁니다.
       *
       * ⚠️ 장부는 상한 400줄이라 **마지막 400번**만 남습니다. 존 전체를
       *    도는 이 판에서는 잘릴 수 있으니, 아래 표는 "전부"가 아니라
       *    **"끝에서 400번"** 입니다. 세는 대상이 잘렸다는 사실은 숫자
       *    옆에 그대로 적습니다 — 조용히 자르지 않습니다.
       */
      swings: G.swings?.() ?? [],
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
      detours: detours.map((d) => ({ ...d, damage: Math.round(d.damage) })),
      fireVisits,
      fireSkips,
      /** 끝까지 안 주운 보물과, 그동안 **가장 가까이 갔던 거리** */
      detourBudget: TREASURE_DETOUR,
      untakenTreasures: G.treasurePositions()
        .filter((t) => !t.taken)
        .map((t) => ({
          x: Math.round(t.x),
          z: Math.round(t.z),
          best: treasureBest[`${Math.round(t.x)},${Math.round(t.z)}`] ?? -1,
          block: treasureBlock[`${Math.round(t.x)},${Math.round(t.z)}`]?.why ?? '?',
        })),
      affordableAt,
      lastSpendChanceAt,
      embers: em.embers,
      vialsMax: em.vialsMax,
      hp: st.player.hp,
      notes,
      lastHp,
    }
  }, [TIME_LIMIT, process.env.PLAY_WEAPON ?? '', WALL_LIMIT, RECOVERY_ONLY, DETOUR_BUDGET, SPEND_BUDGET, USE_BARREL])

  /**
   * ── 판 하나의 기록을 **파일로도** 남깁니다 ────────────────────────
   *
   * `PLAY_JSON=<경로>` 가 있으면 이 판의 log 를 그대로 씁니다.
   * `npm run bench` 가 여러 판을 돌려 **중앙값과 범위**를 내는 데 씁니다.
   *
   * 왜 필요한가: 지금까지 손잡이를 한두 판 보고 돌렸습니다. 그런데 같은
   * 설정에서도 보스전이 **17초와 50초**로 나옵니다(무기 강화·집중·운).
   * 한 판으로 값을 정하면 그건 측정이 아니라 도박입니다.
   *
   * 화면 출력을 파싱하지 않고 JSON 을 쓰는 이유: 사람이 읽는 글은 바뀝니다.
   * 문구 하나 고칠 때마다 집계기가 조용히 망가지면, 또 계기 버그입니다.
   */
  if (process.env.PLAY_JSON) {
    writeFileSync(process.env.PLAY_JSON, JSON.stringify(log))
  }

  if (log.regionTotal.length) {
    console.log('  [구역별 누적]')
    for (const r of log.regionTotal) console.log(`    ${r.name.padEnd(12)} ${r.seconds}초`)
    console.log('')
    console.log('  [구역별 위험도 — 교전 1분당 받은 피해]')
    for (const r of log.regionDanger) {
      console.log(
        `    ${r.name.padEnd(12)} ${String(r.perMin).padStart(6)} /교전분   ` +
          `(머문 ${r.seconds}초 중 교전 ${r.combat}초 · 피해 ${r.damage} · 적의 휘두름 ${r.swings} · 처치 ${r.kills})`,
      )
    }
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
  /**
   * ── 곁길이 값어치가 있었는가 ────────────────────────────────────
   *
   * 기둥 4의 질문은 "숨겼는가"가 아니라 **"갈지 말지가 좋은 선택인가"**
   * 입니다. 그러려면 **든 비용**(시간·피해)과 **얻은 것**(정련석·룬)을
   * 같은 자리에 놓고 봐야 합니다. 지금까지는 비용도 보상도 안 재고 있었고,
   * 실은 봇이 곁길에 **가 본 적조차 없었습니다.**
   */
  for (const v of log.fireVisits ?? []) {
    /** 화톳불에 **닿았는데 못 산** 이유를 그 자리의 숫자로 적습니다. */
    const why = v.weapon
      ? '무기 강화함'
      : v.emberNeed <= 0
        ? '최대 단계'
        : v.stones < v.stoneNeed
          ? `정련석 ${v.stones}/${v.stoneNeed} 부족`
            : v.embers - (v.vial ? v.vialCost : 0) < v.emberNeed
              ? `불티 부족(${v.embers - (v.vial ? v.vialCost : 0)}/${v.emberNeed})`
              : `**눌렀는데 안 됨** (자리 ${v.atStation ? 'O' : 'X'}→${v.atAfter ? 'O' : 'X'}` +
                `${v.blockedBy ? ` · ${v.blockedBy === 'foe' ? '적이 막음' : '안 닿음'}` : ''})`
    console.log(
      `             ${String(v.at).padStart(6)}초 ${v.anvil ? '모루  ' : '화톳불'} — 불티 ${v.embers} · 정련석 ${v.stones}` +
        ` · 성수병 ${v.vial ? '강화' : '못함'} · 무기 ${why}`,
    )
  }
  if (log.tripBlock) {
    const t = log.tripBlock
    const total = Object.values(t).reduce((a, b) => a + b, 0) || 1
    const pc = (n) => `${Math.round((n / total) * 100)}%`
    console.log(
      `             소비처 여행이 막힌 곳 — 소비처없음 ${pc(t.noFire)} · 못삼 ${pc(t.cantBuy)}` +
        ` · 지갑안늘어 ${pc(t.noGrowth)} · 쿨다운 ${pc(t.cooling)} · **열림 ${pc(t.open)}**`,
    )
  }
  if (log.passBy?.length) {
    console.log('             🧾 12m 안으로 지나친 소비처 — 그때의 지갑')
    for (const b of log.passBy.slice(0, 6)) {
      console.log(
        `                ${String(b.at).padStart(6)}초 ${b.anvil ? '모루' : '화톳불'}(${b.where}) ${String(b.dist).padStart(2)}m` +
          ` · ${b.n}회 · 불티 ${b.embers} · 정련석 ${b.stones} · ${b.canBuy ? '살 수 있었음' : '**못 삼**'}`,
      )
    }
  } else {
    console.log('             🧾 12m 안으로 지나친 소비처가 **한 곳도 없습니다** (동선 문제)')
  }
  if (log.spendBest?.length) {
    console.log('             🧭 소비처마다 가장 가까이 간 거리 (고르는 규칙과 무관하게)')
    for (const b of [...log.spendBest].sort((a, b2) => a.dist - b2.dist)) {
      console.log(
        `                ${(b.anvil ? '모루' : '화톳불').padEnd(4)}(${b.where})  ${b.dist}m · ${b.at}초 · 불티 ${b.embers} · 정련석 ${b.stones} · ${b.canBuy ? '살 수 있었음' : '못 삼'} · 그때 고른 곳 ${b.chosen} 돌아가는비용 ${b.detour}m`,
      )
    }
  }
  if (log.upgradeTries) {
    const u = log.upgradeTries
    console.log(
      `             강화 시도 — B 눌림 ${u.seen}회 · 자리아님 ${u.notStation}회` +
        ` · 소비됨 ${u.consumed}회 · 정련석X ${u.noStone}회 · 불티X ${u.noEmber}회 · 성공 ${u.done}회`,
    )
  }
  if ((log.fireSkips ?? []).length) {
    const ds = log.fireSkips.map((f) => f.dist)
    console.log(
      `             소비처에 가려다 ${log.fireSkips.length}번 접음 — 걸어야 하는 거리 ${Math.min(...ds)}~${Math.max(...ds)}m (예산 ${SPEND_BUDGET}m)\n` +
        log.fireSkips
          .map((f) => `                ${String(f.at).padStart(6)}초 ${f.target} ${f.dist}m · 그때 전부: ${(f.all ?? []).join(' ')}`)
          .join('\n'),
    )
  }
  const got = (log.detours ?? []).filter((d) => d.got)
  const gave = (log.detours ?? []).filter((d) => !d.got)
  console.log(
    `  보물       ${log.treasures} · 곁길 왕복 ${got.length}회 성공` +
      (gave.length ? ` · ${gave.length}회 포기` : '') +
      (got.length
        ? `\n             왕복 1회 평균 — 걸린 시간 ${(got.reduce((a, d) => a + d.took, 0) / got.length).toFixed(1)}초 · 받은 피해 ${Math.round(got.reduce((a, d) => a + d.damage, 0) / got.length)} · 나선 지점에서 ${(got.reduce((a, d) => a + d.dist, 0) / got.length).toFixed(0)}m`
        : ''),
  )
  /**
   * 🧭 못 주운 보물 — **거리와 그때 막고 있던 것**을 한 판에서도 봅니다.
   *
   * 지금까지 이 줄은 벤치에만 있었습니다. 그래서 보물 쪽을 고칠 때마다
   * 3판(30분)을 돌려야 했고, 한 번 고쳐 보고 확인하는 데 그만큼이
   * 들었습니다. 한 판으로 볼 수 있으면 시도 횟수가 세 배가 됩니다.
   */
  const untaken = log.untakenTreasures ?? []
  if (untaken.length) {
    console.log(`  🧭 못 주운 보물 ${untaken.length}개 (예산 ${log.detourBudget ?? 40}m)`)
    for (const t of untaken) {
      console.log(
        `              (${t.x}, ${t.z})  가장 가까이 ${t.best >= 0 ? `${Math.round(t.best)}m` : '경로 못 찾음'} · 그때 막던 것: ${t.block ?? '?'}`,
      )
    }
  }
  console.log(`  반격       ${log.counters}회 성공 · 남은 집중 ${log.focusLeft}`)
  /**
   * 🥋 **집중이 어디서 왔는가.**
   *
   * 설계는 "가벼운 공격이 집중을 번다"고 적어 뒀습니다(오공의 이유를
   * 그대로 인용해서). 그런데 벤치에서 평타가 보스 피해 중앙값 0이었으니,
   * 그 문장이 실제로 도는지 봐야 합니다. `버림`은 가득 찬 채로 흘린 몫 —
   * "못 벌었다"와 "벌었는데 흘렸다"는 처방이 정반대입니다.
   */
  const ff = log.focusFlow ?? {}
  const earned = (ff['평타'] ?? 0) + (ff['완벽회피'] ?? 0)
  console.log(
    `  🥋 집중     번 것 ${earned.toFixed(1)}점 — 평타 ${(ff['평타'] ?? 0).toFixed(1)} (${Math.round(((ff['평타'] ?? 0) / Math.max(0.01, earned)) * 100)}%) · ` +
      `완벽회피 ${(ff['완벽회피'] ?? 0).toFixed(1)} (${Math.round(((ff['완벽회피'] ?? 0) / Math.max(0.01, earned)) * 100)}%)`,
  )
  console.log(
    `              태운 것 ${(ff['태움'] ?? 0).toFixed(1)}점 · 가득 차서 흘린 것 ${(ff['버림'] ?? 0).toFixed(1)}점`,
  )
  console.log(`  체력       ${log.hp} (최저 ${log.minHp} · 총 피해 ${log.damageTaken})`)
  {
    /**
     * 🩸 기둥 2의 합격 기준을 **숫자로** 답합니다 — *"내가 못 봤네"가 아니라
     * "내가 못 피했네"*. fair 가 아닌 한 대는 플레이어 잘못이 아닙니다.
     */
    const h = log.hurt ?? {}
    const total = Object.values(h).reduce((a, b) => a + b, 0)
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0)
    const locks = Object.entries(h)
      .filter(([k, v]) => k.startsWith('locked:') && v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k.slice(7)} ${v}`)
      .join(' · ')
    /**
     * 🎯 **"못 피함" 안을 들여다봅니다.**
     *
     * 예전에는 이 40대가 한 칸이었습니다. 그래서 *"봇이 욕심을 부린다"* 고
     * 믿고 있었는데 **근거는 없었습니다** — 숫자가 한 칸뿐이었으니까요.
     * 이제 게임이 세 가지로 갈라 줍니다(main.ts `noteHurt`):
     *
     *   안 눌렀다 → 위험을 못 읽음 (예고의 *의미* · 욕심의 값)
     *   일찍     → 무적이 끝난 뒤 맞음 (무적 창)
     *   늦게     → 무적이 켜지기 전에 맞음 (반응 예산 · 선입력)
     *
     * 고칠 곳이 각각 다릅니다. 뭉쳐 두면 창을 넓혀야 할 때 보상을 만집니다.
     */
    const fairs = Object.entries(h)
      .filter(([k, v]) => k.startsWith('fair:') && v > 0)
      .sort((a, b) => b[1] - a[1])
    const fairTotal = fairs.reduce((a, [, v]) => a + v, 0) + (h.fair ?? 0)
    console.log(
      `  맞은 이유   ${total}대 · 못 피함 ${fairTotal}(${pct(fairTotal)}%)` +
        ` · 아무것도 못 봄 ${h['unseen:아무것도'] ?? 0} · 몸만 못 봄 ${h['unseen:몸만'] ?? 0} · 예고가 짧음 ${h.tooFast ?? 0} · 출처불명 ${h.unknown ?? 0}`,
    )
    console.log(
      `              그중 — ${fairs.length ? fairs.map(([k, v]) => `${k.slice(5)} ${v}`).join(' · ') : '갈라진 기록 없음'}`,
    )
    console.log(`              손이 묶임 — ${locks || '없음'}`)
    for (const u of log.unfairHits ?? []) {
      console.log(
        `              ${u.id.padEnd(14)} ${u.why.padEnd(12)} 예고 ${u.tel}초 · 보인 ${u.seen}초 · 자유 ${u.free}초` +
          // 구른 지 얼마 만에 맞았는지 — 얼마나 빗나갔는지가 여기서 보입니다.
          (u.since >= 0 ? ` · 구른 뒤 ${u.since}초` : ''),
      )
    }
  }
  console.log(
    `  동시 교전   교전 중 평균 ${log.avgAggro}마리 · 둘 이상인 시간 ${log.multiRatio}% · 최대 ${log.maxAggro}마리`,
  )
  console.log(`  후퇴       근접(8m) 중 거리를 벌리던 시간 ${log.retreatRatio}%`)
  console.log(
    `  적의 공격   ${log.enemySwings}회 휘두름 · ${log.enemyHits}회 적중 (적중률 ${Math.round((log.enemyHits / Math.max(1, log.enemySwings)) * 100)}%)`,
    /**
     * ── 📒 **빗나갔다면 왜인가** ────────────────────────────────────
     *
     * 적중률 33% 만 봐서는 고칠 곳을 못 찾습니다. 후보가 셋이고 답이
     * 셋 다 다릅니다:
     *
     *   · 사거리 밖 → 적이 너무 멀리서 휘두른다 (접근·커밋 판단)
     *   · 각도 밖   → 적이 못 따라 돈다 (선회 속도 · 예고 중 추적 30%)
     *   · 무적      → 플레이어가 제대로 굴렀다 (**고칠 것이 없습니다**)
     *
     * 셋째가 크면 이건 고장이 아니라 **설계대로**입니다. 그걸 모르고
     * 적을 세게 만들면 잘 피한 사람을 벌주게 됩니다.
     */
    (() => {
      const rows = log.swings ?? []
      if (rows.length === 0) return '  📒 휘두름 장부  비어 있습니다 — 아래 결론을 세우지 마십시오'
      // ⚠️ 이 표는 **근접 부채꼴만** 담습니다(combat.ts `swingRecords`).
      //    왼쪽의 "휘두름 N회"와 줄 수가 다른 것은 그래서입니다 — 🟡 광역·🏹
      //    화살은 각도로 빗나갈 수가 없어서 애초에 대상이 아닙니다.
      const cut = rows.length >= 400 ? ' ⚠️ 장부 상한(400)에 걸려 **끝에서 400번만** 셌습니다' : ''
      const by = new Map()
      for (const r of rows) {
        const k = r.attackId || '(이름없음)'
        const e = by.get(k) ?? { n: 0, hit: 0, far: 0, wide: 0, invuln: 0, ang: 0, arc: 0 }
        e.n++
        if (r.hit) e.hit++
        else if (r.invuln) e.invuln++
        else if (r.dist > r.reach) e.far++
        else e.wide++
        e.ang += r.angleDeg
        e.arc += r.halfArcDeg
        by.set(k, e)
      }
      const lines = [...by.entries()]
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 8)
        .map(
          ([id, e]) =>
            `               ${id.padEnd(13)}${String(e.n).padStart(3)}회 · 적중 ${String(e.hit).padStart(3)}(${Math.round(
              (e.hit / e.n) * 100,
            )}%) · 사거리 ${String(e.far).padStart(3)} · 각도 ${String(e.wide).padStart(3)} · 무적 ${String(
              e.invuln,
            ).padStart(3)} · 평균 ${(e.ang / e.n).toFixed(0)}°/허용 ${(e.arc / e.n).toFixed(0)}°`,
        )
      const tot = rows.length
      const hit = rows.filter((r) => r.hit).length
      const inv = rows.filter((r) => !r.hit && r.invuln).length
      const far = rows.filter((r) => !r.hit && !r.invuln && r.dist > r.reach).length
      const wide = tot - hit - inv - far
      return (
        `  📒 빗나간 이유 ${tot}회 (근접 부채꼴만 — 광역·화살 제외)${cut}\n` +
        `               합계 — 적중 ${hit}(${Math.round((hit / tot) * 100)}%) · 사거리 ${far}(${Math.round(
          (far / tot) * 100,
        )}%) · 각도 ${wide}(${Math.round((wide / tot) * 100)}%) · 무적 ${inv}(${Math.round((inv / tot) * 100)}%)\n` +
        lines.join('\n')
      )
    })(),
  )
  console.log(
    `  빈 시간     교전 사이 평균 ${log.gapAvg}초 · 최장 ${log.gapMax}초 · 8초 이상 ${log.gapLong}회 / ${log.gapCount}구간`,
  )
  for (const g of log.longGaps) {
    console.log(
      `              ${String(g.at).padStart(4)}초 · ${String(g.secs).padStart(5)}초 · ${g.where} · ${g.did}${g.died ? ` · 사망 ${g.died}회` : ''}`,
    )
  }
  console.log(
    `  스태미나    최저 ${log.minStamina} · 교전 중 회피(${log.dodgeCost})를 못 낼 만큼 낮았던 시간 ${log.lowStaminaRatio}%`,
  )
  /**
   * ── 기둥 1 — 두 자원, 두 리듬 ──────────────────────────────────
   *
   * 이 게임의 **핵심 차별점**이라고 적어 둔 것을 처음으로 잽니다.
   * 주장: 기본 공격은 스태미나로, 스킬 다섯은 쿨다운으로 굴러가고
   * **둘이 번갈아 오면서** 리듬이 생긴다.
   *
   * 읽는 법:
   *   · `쿨다운뿐인 시간` 이 0에 가까우면 → 쿨다운은 **장식**입니다.
   *     늘 쓸 스킬이 있으니 기본 공격으로 내려올 이유가 없습니다.
   *   · `셋 이상 준비` 가 대부분이면 → 슬롯을 늘린 값어치가 없습니다.
   *   · 슬롯별 시전이 한쪽에만 몰리면 → 나머지는 **안 쓰이는 버튼**입니다.
   */
  const casts = log.skillCasts ?? []
  const castTotal = casts.reduce((a, b) => a + b, 0)
  console.log(
    `  두 리듬     스킬 ${castTotal}회 [${casts.join('/')}] · 기본 공격 ${log.lightSwings}회` +
      ` (스킬 비중 ${Math.round((castTotal / Math.max(1, castTotal + log.lightSwings)) * 100)}%)
` +
      `             교전 중 — 쓸 스킬이 하나도 없던 시간 ${log.noSkillPct}%` +
      ` · 셋 이상 준비된 시간 ${log.manySkillPct}%` +
      ` · 스태미나가 콤보의 1/3 미만이던 시간 ${log.noStaminaPct}%\n` +
      `             🟢 초록 예고 ${log.greenEvents}회 — 정면 ${log.greenInFront ?? 0}회 · 정면+스킬 ${log.greenReady ?? 0}회` +
      ` · 답할 스킬이 있던 때 ${log.greenAnswerable}회` +
      ` (${Math.round((log.greenAnswerable / Math.max(1, log.greenEvents)) * 100)}%) · 실제 반격 ${log.counters}회\n` +
      `             예고가 끝난 방식 — 휘두름까지 ${log.greenSwung ?? 0}회 · 적이 죽음 ${log.greenDied ?? 0}회` +
      ` · **반격으로 끊김 ${log.greenCountered ?? 0}회** · 그 밖의 끊김 ${log.greenBroken ?? 0}회\n` +
      `             🛡 저스트 가드 — 붙잡은 🔴 ${log.guardTries ?? 0}회 · 창을 본 것 ${log.guardSawWindow ?? 0}회` +
      ` · 그중 **못 낸 자리** ${log.guardBlockedByState ?? 0}회\n` +
      `                          창을 연 것 ${log.guardOpens ?? 0}회 · 헛친 것 ${log.guardWhiffs ?? 0}회` +
      ` · **끊겨서 면제 ${log.guardSpared ?? 0}회**` +
      (Object.keys(log.guardWhy ?? {}).length
        ? `\n                          빈 창이 닫힌 이유 — ${Object.entries(log.guardWhy)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${v}회`)
            .join(' · ')}` +
          (log.guardWhyLog?.length ? `\n                            ${log.guardWhyLog.slice(0, 4).join('\n                            ')}` : '')
        : '') +
      ` · **성공 ${log.guards ?? 0}회**`,
  )
  /**
   * ── 이어짐 — 눌러 둔 것이 실제로 일했는가 ────────────────────────
   *
   * 선입력(버퍼)을 넣고도 **그것이 일하는지 재는 것이 없었습니다.**
   * 셋을 갈라 두는 이유는 처방이 다르기 때문입니다:
   *   · `버려짐(만료)` 이 많다 → 창이 짧거나, 빠져나올 자리가 너무 늦게 옵니다
   *   · `누른 순간 못 냄` 이 많다 → 버퍼가 아니라 **스태미나** 이야기입니다
   *
   * ⚠️ 셋의 합은 누른 횟수와 **같지 않습니다.** 못 낸 입력을 버리지 않고
   * 창이 남은 동안 살려 두므로, 누른 순간 못 냈다가 잠시 뒤 나가면 두 칸에
   * 모두 세어집니다. 분모는 결말이 난 것(이어짐+만료)입니다.
   * 뭉쳐 놓으면 어느 쪽인지 영영 못 가립니다.
   *
   * `평균 대기` 는 누른 순간부터 나온 순간까지입니다. 0에 가까우면 버퍼가
   * 없어도 될 때만 눌렀다는 뜻이고, 창 길이에 가까우면 매번 아슬아슬하게
   * 걸리고 있다는 뜻입니다.
   */
  const settled = (log.inputUsed ?? 0) + (log.inputExpired ?? 0)
  /**
   * ⚠️ **만나지 않은 조우를 단언하지 않습니다.**
   *
   * 이 줄은 원래 `bossWeaponLevel` 을 그대로 찍었습니다. 그 값의 초기값은
   * -1(=아직 안 만남)이라, 보스를 못 만난 판에서 이렇게 나왔습니다:
   *
   *     보스전      조우하지 못함
   *     보스 앞 장비  무기 강화 **+-1 단계에서 보스와 만났습니다**
   *
   * 같은 보고서 안에서 두 줄이 서로를 부정합니다. `+-1` 은 눈에 띄니
   * 그나마 낫지만, 하필 강화를 한 번 해서 +1 이었다면 **그럴듯한 거짓말**이
   * 됩니다 — 이 저장소에서 가장 비쌌던 것이 늘 그런 눈금이었습니다.
   */
  console.log(
    log.bossSeen
      ? `  보스 앞 장비  무기 강화 +${log.bossWeaponLevel} 단계에서 보스와 만났습니다` +
          ` (실험대: +0 못 끝냄 · +2 절반 · +5 처치)`
      : `  보스 앞 장비  — 보스를 만나지 못해 잴 수 없습니다`,
  )
  console.log(
    `  이어짐      결말 ${settled}회 — 이어짐 ${log.inputUsed ?? 0}회` +
      ` (${Math.round(((log.inputUsed ?? 0) / Math.max(1, settled)) * 100)}%)` +
      ` · 버려짐(만료) ${log.inputExpired ?? 0}회` +
      ` [공격 ${log.inputExpiredAttack ?? 0} · 구르기 ${log.inputExpiredDodge ?? 0} · 스킬 ${log.inputExpiredSkill ?? 0}]\n` +
      `             그중 누른 순간엔 못 냈던 것 ${log.inputDropped ?? 0}회 (겹침)` +
      ` · 평균 대기 ${(log.inputWaitAvg ?? 0).toFixed(2)}초`,
  )
  // ⚔️ 넣어 두고 안 쓰이면 "효과가 없다"와 "쓰이질 않았다"를 못 가립니다.
  console.log(
    `             ⚔️ 상황 모션 — 달리기 ${log.runAttacks ?? 0}회 · 구르기 ${log.rollAttacks ?? 0}회 · 낙하 ${log.plungeAttacks ?? 0}회`,
  )
  /**
   * 💥 **터진 통 · 휘말린 몸 · 남은 통** 셋을 같이 찍습니다.
   *
   * 터진 수만 보면 *"켰는데 아무도 안 담겼다"* 를 놓칩니다. 남은 수까지
   * 봐야 *"쓸 기회가 아예 없었다"* 와 *"쓰고도 헛돌았다"* 가 갈립니다.
   */
  console.log(
    `             💥 폭발통 — 터뜨림 ${log.barrelsBlown ?? 0}회` +
      ` (통을 겨눠 누른 프레임 ${log.barrelLitByBot ?? 0})` +
      ` · 안 쓰고 남긴 통 ${log.barrelLeft ?? 0}개\n` +
      `                불붙일 때 담긴 적 ${log.barrelsLitCaught ?? 0} → 터질 때 휘말린 몸 ${log.barrelsCaught ?? 0}` +
      ` (걸어 나간 수 ${Math.max(0, (log.barrelsLitCaught ?? 0) - (log.barrelsCaught ?? 0))})`,
  )
  for (const c of log.barrelChance ?? []) {
    const why =
      c.ready > 0
        ? '조건까지 맞았다'
        : c.inReach > 0
          ? '곁엔 갔지만 **둘 이상이 안 담겼다**'
          : '**곁에 간 적이 없다**'
    console.log(
      `                통(${c.at}) — 가장 가까이 ${Number.isFinite(c.near) ? c.near.toFixed(1) : '?'}m` +
        ` · 사거리 안 ${c.inReach}프레임(그중 조건 ${c.ready}) — ${why}`,
    )
  }
  const distTotal =
    log.boss.fought && log.boss.dist
      ? log.boss.dist.near + log.boss.dist.mid + log.boss.dist.far + log.boss.dist.away
      : 0
  const pct = (n) => Math.round((n / Math.max(1, distTotal)) * 100)
  const bud = log.boss.budget ?? {}
  /** 보스가 **실제로 공격 동작에 쓴** 시간의 비율 — 나머지는 전부 "못 하고 있던" 시간입니다. */
  const actPct = Math.round(
    (((bud.windup ?? 0) + (bud.active ?? 0) + (bud.recovery ?? 0)) /
      Math.max(0.1, log.boss.engaged ?? log.boss.seconds)) *
      100,
  )
  const totalSwings = (log.bossSwings ?? []).reduce((a, b) => a + b.swings, 0)
  const swingRate = ((log.boss.engaged ?? log.boss.seconds) / Math.max(1, totalSwings)).toFixed(1)
  if (log.boss.fought) {
    console.log(
      `  보스전      실제 교전 ${log.boss.engaged}초 · 본 페이즈 ${log.boss.phasesSeen}/3 · ${log.boss.killed ? '처치' : '미처치'}\n` +
        (log.boss.resets > 0
          ? `              ⚠️ 보스가 ${log.boss.resets}번 초기화됨 — 그 사이 ${log.boss.disengaged}초는 교전이 아닙니다(체력도 되돌아갑니다)\n`
          : '') +
        `              받은 피해 ${log.boss.damageTaken} (그 사이 최저 체력 ${log.boss.minHp}) · 준 피해 ${log.boss.damageDealt}/${log.boss.maxHp}\n` +
        `              보스가 사거리(${log.boss.attackRange}m) 안에 있던 시간 ${log.boss.inRangePct}% · 예고를 띄우고 있던 시간 ${log.boss.windingPct}%\n` +
        `              거리 분포 — 2.5m 미만 ${pct(log.boss.dist.near)}% · 2.5~5m ${pct(log.boss.dist.mid)}% · 5~9m ${pct(log.boss.dist.far)}% · 9m 이상 ${pct(log.boss.dist.away)}%\n` +
        `              페이즈별 시간 — 인트로 ${log.boss.introTime ?? 0}초 · 1단계 ${log.boss.phaseTime[0]}초 · 2단계 ${log.boss.phaseTime[1]}초 · 3단계 ${log.boss.phaseTime[2]}초\n` +
        `              페이즈별 실효 화력 — ${(log.boss.phaseBands ?? [])
          .map(
            (b, i) =>
              /**
               * ⚠️ **0초짜리 구간에 화력을 계산하면 안 됩니다.**
               *
               * `2단계 0초 · 실효 화력 2170.0/초` 가 찍혔습니다. 217 을
               * 하한 0.1 로 나눈 값입니다. 그 구간은 **재지 못한 것**이지
               * 화력이 2170인 것이 아닙니다(보스전 중 사망으로 누적이
               * 초기화되면 이렇게 됩니다). 못 잰 것을 그럴듯한 숫자로
               * 내놓는 계기가 이 저장소에서 제일 비쌌습니다 —
               * 못 쟀으면 **못 쟀다고** 적습니다.
               */
              `${i + 1}단계 ${log.boss.phaseTime[i] < 0.5 ? '못 쟀음' : `${(b / log.boss.phaseTime[i]).toFixed(1)}/초`}` +
              ` (구간 체력 ${Math.round(b)} ÷ ${log.boss.phaseTime[i]}초 · 처형 ${log.boss.phaseFinishers?.[i] ?? 0} · 붕괴 ${log.boss.phaseBreaks?.[i] ?? 0})`,
          )
          .join('\n                             ')}\n` +
        `              보스의 시간 — 예고 ${bud.windup}초 · 휘두름 ${bud.active}초 · 후딜 ${bud.recovery}초 · 쿨다운 ${bud.cooldown}초\n` +
        `                          · 무너짐 ${bud.broken}초(${log.boss.breaks}회) · 페이즈전환 ${bud.transition}초 · 대기·이동 ${bud.idle}초\n` +
        `                          → 실제로 공격에 쓴 시간 ${actPct}% · ${swingRate}초에 한 번 휘두름\n` +
        `              보스에게 들어간 처형 ${log.boss.finishers}회 · 연계 예약 ${log.boss.chainsArmed}회 · 발동 ${log.boss.chainsFired ?? 0}회` +
          ` · 무너져서 끊긴 연계 ${(log.boss.chainsLost ?? []).slice(0, 3).reduce((a, b) => a + b, 0)}회` +
          ` [예고 ${log.boss.chainsLost?.[0] ?? 0} · 휘두름 ${log.boss.chainsLost?.[1] ?? 0} · 후딜 ${log.boss.chainsLost?.[2] ?? 0}]` +
          // 💢 무거운 적은 무너져도 예약을 들고 일어납니다 — **잃은 것이 아닙니다**.
          ` · 일어나며 이어 냄 ${log.boss.chainsLost?.[3] ?? 0}회`,
    )
    for (const a of log.bossSwings) {
      console.log(
        `              ${a.id.padEnd(12)} ${a.swings}회 휘두름 · ${a.hits}회 적중 (${Math.round((a.hits / Math.max(1, a.swings)) * 100)}%) · 연계 ${a.chained}회 · 페이즈별 [${(a.byPhase ?? []).join('/')}]`,
      )
    }
  } else {
    console.log('  보스전      조우하지 못함')
  }
  console.log(
    `  백어택      ${log.backHits}/${log.hitsDealt}회 (${Math.round((log.backHits / Math.max(1, log.hitsDealt)) * 100)}%)` +
      ` — 때릴 거리에서 등 뒤를 잡고 있던 시간 ${Math.round((log.behindOk / Math.max(1, log.behindSamples)) * 100)}%\n` +
    /**
     * ── 📊 **무엇이 잡몹을 죽이는가** ───────────────────────────────
     *
     * 출혈이 잡몹에게 안 터지는 이유를 두고 이 저장소가 스스로에게 남긴
     * 질문이 있습니다 — *"문턱이 높은 게 아니라 쌓이는 타수가 적다.
     * **왜 두 대뿐인가**를 먼저 재라"*(enemies.ts `bleedMaxOf`).
     *
     * 총 피해와 **마지막 한 방**을 나눠 적습니다. 둘은 다른 사실입니다:
     * 평타가 총량의 절반을 넣고도 처형이 늘 마무리하면, 출혈이 찰 시간은
     * 없습니다. 한 칸에 담으면 그 구분이 사라집니다.
     */
    (() => {
      const rows = Object.entries(log.mobDamageBySource ?? {}).filter(([, v]) => v.dmg > 0)
      if (rows.length === 0) return '  📊 잡몹 장부  비어 있습니다 — 아래 결론을 세우지 마십시오'
      const total = rows.reduce((a, [, v]) => a + v.dmg, 0)
      const kills = rows.reduce((a, [, v]) => a + v.kills, 0)
      rows.sort((a, b) => b[1].dmg - a[1].dmg)
      return (
        `  📊 잡몹을 죽인 것 — 피해 ${Math.round(total)} · 마지막 한 방 ${kills}회\n` +
        rows
          .map(
            ([k, v]) =>
              `               ${k.padEnd(4)} 피해 ${String(Math.round(v.dmg)).padStart(4)}(${Math.round(
                (v.dmg / total) * 100,
              )}%) · 마무리 ${String(v.kills).padStart(2)}회(${
                kills > 0 ? Math.round((v.kills / kills) * 100) : 0
              }%)`,
          )
          .join('\n')
      )
    })(),
    `  두 축       붕괴 ${log.poiseBreaks}회 · 처형 ${log.finishers}회 · 🩸 출혈 터짐 ${log.bleedPops ?? 0}회 (한 적 최고 ${log.bleedPeak ?? 0})\n` +
    /**
     * 🩸 **못 터진 것들.** 「죽어서」인가 「식어서」인가 — 처방이 정반대입니다.
     *
     * ⚠️ `/100` 을 지웠습니다. 문턱은 이제 **적마다 다릅니다**
     *    (enemies.ts `bleedMaxOf` — 잡몹 30 · 보스 105). 없어진 분모를
     *    계속 찍으면 읽는 사람이 *"38.4/100 이면 한참 남았네"* 로 잘못
     *    읽습니다. 실제로 그 38.4 는 잡몹 문턱을 **넘긴** 값입니다.
     */
    `              못 터진 것들 — 게이지를 남긴 채 죽은 적 ${log.bleedDiedWith ?? 0}마리` +
    ` (평균 ${log.bleedDiedWithAvg ?? 0} · 최고 ${log.bleedDiedWithMax ?? 0}) · 식어서 날아간 총량 ${log.bleedDecayedAll ?? 0}\n` +
    // 🩸 **쌓은 총량과 남은 게이지를 나란히** 둡니다. 둘이 비슷하면
    // "차기 전에 죽었다"(문턱 이야기)이고, 쌓은 쪽이 훨씬 크면
    // "쌓아 놓고 딴 데 갔다 왔다"(식는 속도 이야기)입니다.
    `              그 적들에게 쌓았던 총량 평균 ${log.bleedDiedBuiltAvg ?? 0}` +
    ` → 죽을 때 남은 ${log.bleedDiedWithAvg ?? 0} (식어서 잃은 ${Math.round(((log.bleedDiedBuiltAvg ?? 0) - (log.bleedDiedWithAvg ?? 0)) * 10) / 10})\n` +
    /**
     * 🩸 **분모.** 「쌓은 총량이 적다」의 뜻이 둘이라 나눠 봐야 합니다 —
     * 몇 대 안 맞은 것인가, 맞긴 했는데 안 쌓는 타격이었나.
     *
     * ⚠️ **「한 대당 쌓인」이 설정값보다 3할쯤 작게 나오는 것은 정상입니다.**
     *    `applyBleed` 는 **죽이지 않은 타격**에서만 돌기 때문입니다 —
     *    마지막 한 대는 분모에는 들어가고 분자에는 안 들어갑니다. 잡몹이
     *    3~4대에 죽으니 그 한 대가 25~30%를 차지합니다.
     *    (롱소드 12 → 8.5 · 쌍단검 19.2 → 13.4 — 둘 다 0.7배로 같습니다.)
     *    이걸 안 적어 두면 다음에 보는 사람이 "출혈이 새고 있다"고 읽습니다.
     */
    `              죽기까지 맞은 횟수 평균 ${log.bleedDiedHitsAvg ?? 0}대` +
    ` → 한 대당 쌓인 ${(((log.bleedDiedBuiltAvg ?? 0) / Math.max(0.001, log.bleedDiedHitsAvg ?? 0)) || 0).toFixed(1)}\n` +
    `              그중 **보스에게** — 터짐 ${log.bossBleedPops ?? 0}회 · 최고 ${log.bossBleedPeak ?? 0}/100\n` +
    `                 쌓은 총량 ${log.bossBleedApplied ?? 0} · 식어서 날아간 것 ${log.bossBleedDecayed ?? 0}\n` +
    `                 타격 간격 평균 ${log.bossBleedGapAvg ?? 0}초 · 최대 ${log.bossBleedGapMax ?? 0}초 · 유예 안에 이어진 비율 ${Math.round((log.bossBleedGapInsideRate ?? 0) * 100)}%\n` +
    /**
     * 🩸 **이 한 줄이 「왜 96까지 갔다가 되돌아오는가」의 답입니다.**
     *
     * 출혈은 쌓기만 하는 눈금이 아니라 **간격과의 싸움**입니다. 손익분기보다
     * 느리게 때리면 한 대 쌓는 동안 그보다 더 잃어서, 아무리 오래 싸워도
     * 안 찹니다. 평균 간격을 손익분기 **옆에 두지 않으면** 이 사실이
     * 숫자 두 개 사이에 숨습니다.
     */
    `                 손익분기 간격 — ${(log.bleedBreakEven ?? [])
      .map((w) => `${w.id} ${w.gap}초`)
      .join(' · ')}  ← 평균 간격이 이보다 크면 **영원히 안 찹니다**\n` +
    /**
     * ── ⚔️ **보스전에서 내 시간이 어디로 갔는가** ──────────────────────
     *
     * 적 쪽 분해(`적이 실제로 한 일`)는 오래전부터 있었는데 **내 쪽이
     * 없었습니다.** 그래서 "보스 타격 간격이 판마다 1.0초와 3.20초를
     * 오간다"까지만 알고 이유를 못 물었습니다.
     *
     * 읽는 법 — 큰 칸이 곧 처방입니다:
     *   · 구르기·가드가 크면 → **창 설계**(예고가 잦거나 창이 짧다)
     *   · 닿는데 대기가 크면 → 그중 **기력** 몫을 보십시오(경제 이야기)
     *   · 접근이 크면       → 보스가 자꾸 멀어지거나 내 이동이 느립니다
     *   · 마심이 크면       → 회복 규칙이 전투를 끊고 있습니다
     */
    `              ⚔️ 그동안 나는 — ${(() => {
      const bt = log.bossTime ?? {}
      const T = bt.total ?? 0
      if (T <= 0) return '보스전 없음'
      const pct = (v) => `${Math.round(((v ?? 0) / T) * 100)}%`
      return (
        `깨어 ${T.toFixed(1)}초 중 공격 ${pct(bt.attack)} · 구르기 ${pct(bt.dodge)}` +
        ` · 가드 ${pct(bt.guard)} · 경직 ${pct(bt.stagger)} · 마심 ${pct(bt.drink)}` +
        ` · 접근 ${pct(bt.chase)} · 닿는데 대기 ${pct(bt.ready)}(그중 기력 ${pct(bt.readyNoStamina)})`
      )
    })()}\n` +
    `              📊 보스를 녹인 것 (1/2/3단계) — ${Object.entries(log.bossDamageBySource ?? {})
      .filter(([, v]) => v.reduce((a, b) => a + b, 0) > 0)
      .sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0))
      .map(([k, v]) => `${k} ${Math.round(v.reduce((a, b) => a + b, 0))} [${v.map((n) => Math.round(n)).join('/')}]`)
      .join(' · ') || '없음'}\n` +
    `  강인도      무방비인 적 곁에서 실제로 때린 시간 ${log.brokenUseRatio}%\n` +
      `              무너진 순간의 평균 체력 ${Math.round(log.breakHpAvg * 100)}% · 무방비인 채로 죽은 적 ${log.brokenDeaths}마리\n` +
      `              처형 안내가 떠 있던 프레임 ${log.finisherReady} (그중 스태미나가 모자랐던 프레임 ${log.finisherNoStamina})`,
  )
  console.log('')
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
