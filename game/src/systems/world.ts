import { BARREL, CRACKED_WALL, PLAYER, URN, VIAL, WORLD } from '../config/balance'
import { NO_CHAIN } from '../config/bossPhases'
import { enemyDef, kindFromId } from '../config/enemies'
import type { Bonfire } from './bonfire'
import {
  Actor,
  ActorState,
  Barrel,
  Body,
  Enemy,
  EnemyKind,
  Health,
  Loadout,
  Pickup,
  Player,
  Renderable,
  Stamina,
  Status,
  Transform,
  Urn,
  CrackedWall,
  Velocity,
} from '../core/components'
import { addComponent, createEntity } from '../core/ecs'
import { Rng } from '../core/rng'
import { cellToWorld, type LevelData } from '../level/format'
import type { Terrain } from '../level/terrain'
import {
  KIND_BARREL,
  KIND_CRACKED_WALL,
  KIND_THICK_WALL,
  KIND_PLAYER,
  KIND_TREASURE,
  KIND_URN,
  renderKindForEnemy,
} from '../render/visuals'

/** 스폰 전용 RNG. 전투 RNG와 분리해야 재현성이 깨지지 않습니다. */
const spawnRng = new Rng(20260807)

export function spawnPlayer(x = 0, z = 0): number {
  const e = createEntity()
  addComponent(Transform, e)
  addComponent(Velocity, e)
  addComponent(Body, e)
  addComponent(Health, e)
  addComponent(Stamina, e)
  addComponent(Actor, e)
  addComponent(Player, e)
  addComponent(Status, e)
  addComponent(Loadout, e)
  addComponent(Renderable, e)

  Transform.x[e] = x
  Transform.y[e] = 0
  Transform.z[e] = z
  Transform.rotY[e] = 0
  Velocity.x[e] = 0
  Velocity.z[e] = 0
  Velocity.kx[e] = 0
  Velocity.kz[e] = 0
  Body.radius[e] = PLAYER.radius
  Body.height[e] = PLAYER.height
  Health.hp[e] = PLAYER.maxHp
  Health.max[e] = PLAYER.maxHp
  Health.invulnT[e] = 0
  Health.flashT[e] = 0
  Stamina.value[e] = PLAYER.maxStamina
  Stamina.max[e] = PLAYER.maxStamina
  Stamina.regenDelayT[e] = 0
  Status.snareT[e] = 0
  // 💥 오사 재장전도 같이 비웁니다 — 엔티티 번호는 재활용되므로,
  // 안 비우면 새로 태어난 적이 **남의 쿨다운을 물려받습니다.**
  Status.crossfireT[e] = 0
  Actor.state[e] = ActorState.Idle
  Actor.phase[e] = 0
  Actor.timer[e] = 0
  Actor.comboIndex[e] = 0
  Actor.comboWindowT[e] = 0
  Actor.bufferedAttack[e] = 0
  Actor.bufferedSkill[e] = 0
  Actor.bufferedWeapon[e] = 0
  Actor.bufferedWeaponT[e] = 0
  Actor.bufferedSkillT[e] = 0
  Actor.cooldownT[e] = 0
  Actor.hitsLeft[e] = 0
  Actor.nextHitT[e] = 0
  Actor.skillSlot[e] = 0
  Actor.moveScale[e] = 1
  Player.dodgeDirX[e] = 0
  Player.dodgeDirZ[e] = 1
  Player.dodgeElapsed[e] = 0
  Player.dashSpeed[e] = 0
  Player.faceRot[e] = 0
  Player.dodgeCooldownT[e] = 0
  /**
   * 🛡 가드의 세 칸을 **여기서 지웁니다.**
   *
   * ⚠️ 앞의 둘(`guardT`·`guardLockT`)은 원래 여기 없었습니다. 이 저장소는
   *    엔티티 번호를 **재사용**하고 컴포넌트 배열은 남아 있어서, 초기화를
   *    빠뜨린 칸은 *"앞사람이 두고 간 값"* 으로 태어납니다. 폭발통이
   *    정확히 그 버그를 낸 적이 있습니다(`Barrel.lit` 을 안 지워서 태어나자마자
   *    불이 붙은 통). 새 칸을 넣는 김에 셋 다 지웁니다.
   */
  Player.guardT[e] = 0
  Player.guardLockT[e] = 0
  Player.guardSpared[e] = 0
  Player.castX[e] = 0
  Player.castZ[e] = 0
  Player.vials[e] = VIAL.charges
  Player.vialsMax[e] = VIAL.charges
  Player.restT[e] = 0
  Player.respawnX[e] = x
  Player.respawnZ[e] = z
  Player.hasRespawn[e] = 0
  Player.embers[e] = 0
  // ⚡ 적중 캔슬은 꺼진 채로 시작합니다. 개체 번호는 재활용되므로
  //    (이 저장소가 `Enemy.breaks` 에서 이미 데인 자리) 여기서 지워야
  //    새 판의 첫 휘두름이 지난 판의 적중을 물려받지 않습니다.
  Player.hitConfirm[e] = 0
  // 시작 장비: 롱소드, 룬 없음. 룬은 탐험(보물)으로 얻습니다 — 기둥 4의
  // "성장 = 새로운 걸 할 수 있게 되는 것"을 시스템으로 강제하는 지점입니다.
  Loadout.weapon[e] = 0
  Loadout.rune0[e] = -1
  Loadout.rune1[e] = -1
  Loadout.runesOwned[e] = 0
  Loadout.cd0[e] = 0
  Loadout.cd1[e] = 0
  Loadout.cd2[e] = 0
  Loadout.cd3[e] = 0
  Loadout.cd4[e] = 0
  Loadout.cd5[e] = 0
  Renderable.kind[e] = KIND_PLAYER
  return e
}

/** 잡몹과 보스는 같은 상태 기계를 공유합니다 — 수치와 외형만 다릅니다. */
export function spawnEnemy(kind: EnemyKind, x: number, z: number, rotY?: number): number {
  const cfg = enemyDef(kind)
  const e = createEntity()
  addComponent(Transform, e)
  addComponent(Velocity, e)
  addComponent(Body, e)
  addComponent(Health, e)
  addComponent(Actor, e)
  addComponent(Enemy, e)
  addComponent(Status, e)
  addComponent(Renderable, e)

  Transform.x[e] = x
  Transform.y[e] = 0
  Transform.z[e] = z
  /**
   * 🧭 **바라보는 쪽** — 지도가 정했으면 그것을 씁니다.
   *
   * ── 왜 고쳤는가 (프로브가 잡았습니다) ────────────────────────────
   * 원래는 무조건 `Math.atan2(-x, -z)` — **세계 원점 쪽**이었습니다.
   * 실험대에서는 맞는 말입니다(적이 원점 둘레에 서고 플레이어가
   * 가운데 있으니 «대체로 플레이어 쪽»). 그런데 **레벨에서는 원점이
   * 아무 뜻도 없는 방향**입니다. 즉 이 존의 모든 적이 「지도가 정한
   * 쪽」이 아니라 **「세계 원점 쪽」**을 보고 서 있었습니다.
   *
   * 이게 조용한 문제가 아닙니다. 깨는 규칙이 바라보는 쪽을 봅니다:
   *     effectiveDist <= (inFront ? range : hearDistance(playerSpeed))
   * 적이 나를 보고 있으면 14m, **등을 돌리고 있으면** 걸어서 6.4m ·
   * 달려서 9m. 즉 **소리 규칙은 등 돌린 적에게만 뜻이 있는데**,
   * 등을 돌릴지가 지도가 아니라 원점과의 각도로 정해지고 있었습니다.
   *
   * `npm run bypass` 가 그 결과를 이렇게 찍었습니다 — 절반 지점에서
   * **걸어서 9마리 vs 달려서 9마리**(9판씩, 폭도 9~9). 발소리가 속도를
   * 탄다는 약속이 **한 마리도** 만들어 내지 못하고 있었습니다.
   *
   * ⚠️ 기본값은 그대로 둡니다(`rotY` 를 안 주면 원점 쪽). 실험대가 그
   *    성질에 기대고 있고, 그건 그 자리에서 옳습니다. 바꾼 것은
   *    **지도가 말할 수 있게 한 것**뿐입니다.
   */
  Transform.rotY[e] = rotY === undefined ? Math.atan2(-x, -z) : rotY
  Velocity.x[e] = 0
  Velocity.z[e] = 0
  Velocity.kx[e] = 0
  Velocity.kz[e] = 0
  Body.radius[e] = cfg.radius
  Body.height[e] = cfg.height
  Health.hp[e] = cfg.maxHp
  Health.max[e] = cfg.maxHp
  Health.invulnT[e] = 0
  Health.flashT[e] = 0
  Actor.state[e] = ActorState.Idle
  Actor.phase[e] = 0
  Actor.timer[e] = 0
  Actor.comboIndex[e] = 0
  Actor.comboWindowT[e] = 0
  Actor.bufferedAttack[e] = 0
  // 스폰 직후 바로 때리지 못하게 짧은 유예를 줍니다.
  Actor.cooldownT[e] = 0.6
  Actor.hitsLeft[e] = 0
  Actor.nextHitT[e] = 0
  Actor.skillSlot[e] = 0
  Actor.moveScale[e] = 1
  Enemy.kind[e] = kind
  Enemy.aggro[e] = 0
  /**
   * **등 뒤 반응 유예를 처음부터 채워 둡니다.**
   *
   * 0으로 두면 이런 일이 벌어집니다: 이 유예는 "정면에 있을 때마다 다시
   * 채워지는" 값이라, **한 번도 플레이어를 정면으로 본 적이 없는 적**은
   * 유예가 0인 채로 시작합니다. 즉 아직 눈치채지 못한 적일수록 등 뒤를
   * 잡았을 때 **더 빨리** 돌아섭니다 — 정확히 거꾸로입니다.
   *
   * 계측이 잡아냈습니다. 등 뒤 유예를 시뮬레이션 시간으로 재도록 고치자
   * 1.7초여야 할 값이 **0.47초**로 나왔습니다(180°를 150°/s로 돌기 시작한
   * 시각 그대로). 벽시계로 재던 동안에는 0.59초로 부풀려져 기준(0.6초)을
   * 아슬아슬하게 넘나들며 "가끔 실패하는 검사"로 보였습니다.
   *
   * 소울류에서 눈치 못 챈 적의 등을 잡는 것은 가장 기본적인 보상입니다.
   * 그 상황이 가장 불리하면 안 됩니다.
   */
  Enemy.reactT[e] = cfg.backReactionDelay
  /**
   * **기습 유예는 0으로 시작합니다** — 위 `reactT` 와 정반대인 이유가 있습니다.
   *
   * ⚠️ 이 줄이 없어서 실제로 물렸습니다. ECS 는 죽은 적의 번호를 **재사용**
   *    하기 때문에, 지우지 않으면 새로 낳은 적이 **앞선 적이 남긴 유예를
   *    물려받습니다.** 그래서 이미 나를 보고 있는 적을 쳤는데 첫 대가
   *    기습으로 판정되어 강인도가 통째로 부서졌습니다 —
   *    `npm run rules` 의 "콤보 한 바퀴 = 집중 1점"이 그걸로 깨졌습니다
   *    (롱소드 3타인데 2타에서 처형으로 넘어가 0.67점).
   *
   * 방향도 이쪽이 맞습니다: 유예는 *"조금 전까지 못 봤다"* 는 **기록**이고,
   * 방금 태어난 적에게는 그런 기록이 없습니다. 못 봤다는 사실은 아래
   * `enemyAI` 가 실제로 못 본 프레임마다 채워 줍니다.
   */
  Enemy.unawareT[e] = 0
  Enemy.attackIndex[e] = 0
  Enemy.phase[e] = 0
  Enemy.transitionT[e] = 0
  Enemy.chainNext[e] = NO_CHAIN
  // 🎬 오프너 예약도 비웁니다 — 엔티티 번호는 재활용됩니다(위 주석들과 같은 이유).
  Enemy.openerNext[e] = NO_CHAIN
  Enemy.chained[e] = 0
  Enemy.poise[e] = cfg.poiseMax
  // 🩸 bitECS 는 엔티티를 재사용합니다 — 안 비우면 앞 판의 출혈을 물려받습니다.
  Enemy.bleed[e] = 0
  Enemy.bleedIdleT[e] = 0
  // 엔티티 번호는 재활용됩니다 — 안 비우면 새 적이 **남의 누적**을 물려받습니다.
  Enemy.bleedBuilt[e] = 0
  Enemy.hitsTaken[e] = 0
  Enemy.poiseIdleT[e] = 0
  // ⏳ 차례표도 새로 시작합니다. bitECS 는 엔티티를 재사용하므로, 안 비우면
  //    죽은 적이 쌓아 둔 대기 시간을 새로 태어난 적이 물려받습니다.
  Enemy.waitT[e] = 0
  Enemy.brokenT[e] = 0
  // 💢 재활용된 번호가 앞 판의 저항을 물려받지 않게(components.ts `breaks`).
  Enemy.breaks[e] = 0
  Enemy.homeX[e] = x
  Enemy.homeZ[e] = z
  Enemy.encounter[e] = 0
  Enemy.introT[e] = 0
  Enemy.leashT[e] = 0
  Status.snareT[e] = 0
  // 💥 오사 재장전도 같이 비웁니다 — 엔티티 번호는 재활용되므로,
  // 안 비우면 새로 태어난 적이 **남의 쿨다운을 물려받습니다.**
  Status.crossfireT[e] = 0
  Renderable.kind[e] = renderKindForEnemy(kind)
  return e
}

export function spawnGrunt(x: number, z: number): number {
  return spawnEnemy(EnemyKind.Grunt, x, z)
}

export function spawnTreasure(x: number, z: number, secret = false): number {
  const e = createEntity()
  addComponent(Transform, e)
  addComponent(Pickup, e)
  addComponent(Renderable, e)
  Transform.x[e] = x
  Transform.y[e] = 0
  Transform.z[e] = z
  Transform.rotY[e] = 0
  Pickup.taken[e] = 0
  // 🕯 안내가 이 보물을 말하지 않습니다(components.ts `secret` 설계 노트).
  Pickup.secret[e] = secret ? 1 : 0
  // 📍 **신분증**은 처음 자리입니다 — 폭발에 밀려나도 안 바뀝니다(components.ts).
  Pickup.homeX[e] = x
  Pickup.homeZ[e] = z
  // 위상차를 줘서 여러 보물이 동시에 똑같이 출렁이지 않게 합니다.
  Pickup.phase[e] = spawnRng.range(0, Math.PI * 2)
  Renderable.kind[e] = KIND_TREASURE
  return e
}

/**
 * 🏺 **항아리** — 부술 수 있는 잡동사니. 설계 근거는 balance.ts `URN`.
 *
 * 통과 **같은 부품**을 씁니다(Transform·Body·Health). 그래야 아무
 * 무기·스킬로나 칠 수 있습니다 — 이유는 아래 `spawnBarrel` 주석과 같습니다.
 *
 * 체력 1: **한 대면 부서집니다.** 항아리에 체력을 주면 이 물건이 묻는
 * 질문("깨면 소리가 나는데 그래도 깰까")이 "몇 대 남았지"로 바뀝니다.
 */
export function spawnUrn(x: number, z: number, holds = false): number {
  const e = createEntity()
  addComponent(Transform, e)
  addComponent(Body, e)
  addComponent(Health, e)
  addComponent(Urn, e)
  addComponent(Renderable, e)
  Transform.x[e] = x
  Transform.y[e] = 0
  Transform.z[e] = z
  Transform.rotY[e] = 0
  Body.radius[e] = URN.radius
  Body.height[e] = URN.height
  Health.hp[e] = 1
  Health.max[e] = 1
  Health.invulnT[e] = 0
  Health.flashT[e] = 0
  Urn.holds[e] = holds ? 1 : 0
  /**
   * ⚠️ **`broken` 을 반드시 0으로 지웁니다.** 통이 정확히 이 자리를
   *    빠뜨려 **두 번째부터 안 터졌습니다**(아래 `Barrel.lit` 주석).
   *    같은 규칙: **spawn 함수는 자기가 쓰는 칸을 하나도 빼지 않고
   *    초기화합니다.**
   */
  Urn.broken[e] = 0
  Renderable.kind[e] = KIND_URN
  return e
}

/**
 * 🧱 **금 간 벽** — 치면 무너지고, 무너진 자리가 길이 됩니다.
 *
 * 항아리·통과 **같은 부품**(Transform·Body·Health)을 씁니다. 이유도
 * 같습니다: 대상 질의가 그 셋을 보므로, 갖춰 두면 **아무 무기·스킬로나**
 * 칠 수 있습니다. 벽 전용 판정을 따로 만들면 새 스킬이 생기는 날
 * "이것만 벽을 못 깬다"가 조용히 생깁니다.
 *
 * ⚠️ **몸통은 칸 경계 한가운데**에 섭니다(칸의 중심이 아닙니다). 벽은
 *    칸이 아니라 **칸과 칸 사이**를 막는 물건이라, 칸 중심에 세우면
 *    메시와 실제로 막히는 자리가 1m 어긋납니다.
 *
 * @param cx,cz 벽이 속한 **칸** 좌표 — 지형의 `Shortcut.key` 와 짝입니다.
 */
export function spawnCrackedWall(x: number, z: number, cx: number, cz: number, tough = false): number {
  const e = createEntity()
  addComponent(Transform, e)
  addComponent(Body, e)
  addComponent(Health, e)
  addComponent(CrackedWall, e)
  addComponent(Renderable, e)
  Transform.x[e] = x
  Transform.y[e] = 0
  Transform.z[e] = z
  Transform.rotY[e] = 0
  /**
   * 몸 굵기는 **얇게** 둡니다. 통행을 막는 것은 이 원이 아니라 **지형**
   * 이라(terrain.ts `sealedBetween`), 여기 큰 원을 두면 벽 앞에서 밀려
   * 나기만 하고 **막는 일은 두 벌**이 됩니다. 이 원이 하는 일은
   * *"칼이 닿는가"* 하나뿐입니다.
   */
  Body.radius[e] = CRACKED_WALL.thickness
  Body.height[e] = CRACKED_WALL.height
  Health.hp[e] = 1
  Health.max[e] = 1
  Health.invulnT[e] = 0
  Health.flashT[e] = 0
  CrackedWall.cx[e] = cx
  CrackedWall.cz[e] = cz
  // ⚠️ 항아리 `broken` 과 같은 이유로 **반드시** 지웁니다.
  CrackedWall.broken[e] = 0
  CrackedWall.tough[e] = tough ? 1 : 0
  Renderable.kind[e] = tough ? KIND_THICK_WALL : KIND_CRACKED_WALL
  return e
}

/**
 * 💥 **폭발통** — 때리면 도화선이 붙는 통.
 *
 * `Health` 를 주는 이유는 체력 싸움을 시키려는 게 아니라, `combat.ts` 의
 * 대상 질의가 `Transform + Body + Health` 이기 때문입니다. 그 셋을 갖추면
 * **아무 무기·스킬로나** 칠 수 있습니다 — 통 전용 판정을 따로 만들면
 * 새 스킬을 넣는 날 "이것만 통을 못 친다"가 조용히 생깁니다.
 *
 * 체력은 1입니다. **한 대면 불이 붙습니다** — 통을 여러 번 때리게 하면
 * 이 물건이 묻는 질문("칠까 말까, 치면 어디로 빠질까")이 "몇 대 남았지"로
 * 바뀝니다.
 */
export function spawnBarrel(x: number, z: number): number {
  const e = createEntity()
  addComponent(Transform, e)
  addComponent(Body, e)
  addComponent(Health, e)
  addComponent(Barrel, e)
  addComponent(Renderable, e)
  Transform.x[e] = x
  Transform.y[e] = 0
  Transform.z[e] = z
  Transform.rotY[e] = 0
  Body.radius[e] = BARREL.radius
  Body.height[e] = BARREL.height
  Health.hp[e] = 1
  Health.max[e] = 1
  Health.invulnT[e] = 0
  Health.flashT[e] = 0
  Barrel.fuseT[e] = 0
  Barrel.fuseTotal[e] = 0
  /**
   * ⚠️ **`lit` 을 반드시 0으로 지웁니다.**
   *
   * 이 저장소가 처음 겪은 종류의 버그입니다. ECS 는 **엔티티 id 를
   * 재사용**하고, 컴포넌트 값은 배열에 그대로 남습니다. 그래서 앞서 터진
   * 통의 id 를 물려받은 새 통이 *"이미 불붙었던 것"* 으로 태어나
   * **영원히 안 터졌습니다.** (점화 조건이 `체력 ≤ 0 && lit === 0` 이라
   * 스태미나도 안 깎이고 적도 안 무너지는데, 통은 조용히 사라지기만 해서
   * 겉으로는 "가끔 안 터진다"로 보입니다.)
   *
   * `npm run barrel` 이 잡았습니다 — 검사를 순서대로 여러 번 돌린 덕분에
   * **두 번째 통부터** 안 터지는 것이 드러났습니다. 한 번만 재는 검사였으면
   * 통과했을 버그입니다.
   *
   * 규칙: **spawn 함수는 자기가 쓰는 칸을 하나도 빼지 않고 초기화합니다.**
   */
  Barrel.lit[e] = 0
  Barrel.litCaught[e] = 0
  Renderable.kind[e] = KIND_BARREL
  return e
}

/**
 * 아레나 가장자리 링 위에 적을 흩뿌립니다. (레벨이 없을 때의 기본 모드)
 * 플레이어 바로 옆에 튀어나오면 "불공정하다"고 느껴지므로,
 * 항상 시야 안쪽 가장자리에서 걸어 들어오게 합니다.
 */
export function spawnWave(count: number, wave = 1): number[] {
  const spawned: number[] = []
  const ringRadius = WORLD.arenaRadius * 0.82
  const baseAngle = spawnRng.next() * Math.PI * 2

  /**
   * ── 웨이브 구성 ────────────────────────────────────────────────
   *
   * 웨이브마다 색을 **하나씩** 늘립니다. 처음부터 네 종류를 다 쏟으면
   * 플레이어는 무엇 때문에 죽었는지 구분하지 못하고, 그러면 배우지도 못합니다.
   *
   *   웨이브 1~2 : 잡몹만            🔴🟡  "구를까 걸을까"
   *   웨이브 3~  : + 얽는 자          🔵     "묶이면 다음을 못 피한다"
   *   웨이브 5~  : + 끄는 자          🟣     "거리는 안전지대가 아니다"
   *
   * 특수 적은 **한 종류당 최대 1마리**입니다. 얽는 자 셋이 번갈아 묶으면
   * 그건 배우는 게 아니라 조작권을 잃는 것입니다.
   */
  const specials: EnemyKind[] = []
  if (wave >= 3) specials.push(EnemyKind.Binder)
  if (wave >= 5) specials.push(EnemyKind.Dragger)

  for (let i = 0; i < count; i++) {
    // 균등 분할 + 흔들림. 순수 랜덤만 쓰면 한쪽에 뭉쳐 스폰됩니다.
    const angle = baseAngle + (i / count) * Math.PI * 2 + spawnRng.range(-0.25, 0.25)
    const r = ringRadius * spawnRng.range(0.85, 1)
    const kind = i < specials.length ? specials[i] : EnemyKind.Grunt
    spawned.push(spawnEnemy(kind, Math.cos(angle) * r, Math.sin(angle) * r))
  }
  return spawned
}

export function enemyCountForWave(wave: number): number {
  return Math.min(
    WORLD.maxEnemiesPerWave,
    WORLD.initialEnemies + (wave - 1) * WORLD.enemiesPerWaveGrowth,
  )
}

/**
 * 보스 하나를 가리키는 키. 보물과 같은 이유로 **위치 기반**입니다 —
 * 배열 인덱스를 쓰면 레벨을 편집할 때 다른 보스가 잡힌 것으로 바뀝니다.
 */
export function bossKey(x: number, z: number): string {
  return `${Math.round(x * 10)}:${Math.round(z * 10)}`
}

export interface SpawnedLevel {
  player: number
  entities: number[]
  treasureTotal: number
  /** 레벨에 놓인 화톳불 좌표들 */
  bonfires: Bonfire[]
  /**
   * 레벨에 놓인 **모루** 좌표들.
   *
   * ── 왜 화톳불과 따로 두는가 ──────────────────────────────────────
   * 모루는 **불티와 정련석을 쓰는 곳**일 뿐입니다. 부활 지점이 되지 않고,
   * 성수병을 채우지 않고, 적을 되살리지 않습니다.
   *
   * 자동 플레이가 잰 것: 한 판 수입(불티 ~400 · 정련석 4)의 절반 이상이
   * **쓰이지 않고** 끝났습니다. 화톳불 방문이 판마다 딱 한 번, 40초
   * 지점이었기 때문입니다. 계단을 오른 뒤로는 가장 가까운 화톳불이 **98m
   * 뒤**입니다. 수입은 존의 뒤쪽(처치·보물·보스)에서 들어오는데 소비는
   * 앞쪽에서만 되는 구조였습니다.
   *
   * 보스 앞에 화톳불을 하나 더 두는 쉬운 답은 쓸 수 없습니다 — 지름길
   * 너머에 화톳불을 두면 사다리가 장식이 됩니다(언데드 버그 규칙,
   * make-zone.mjs 9번 주석). **소비처와 부활 지점을 분리**하면 둘 다 지킵니다.
   *
   * 참고: NRFTW 는 필드의 휴식처와 마을의 대장간이 다른 장소이고,
   * 로스트아크도 강화(도시)와 부활(체크포인트)이 분리되어 있습니다.
   */
  anvils: { x: number; y: number; z: number }[]
}

/**
 * 레벨의 적만 다시 만듭니다 — **화톳불에서 쉬었을 때** 씁니다.
 *
 * 보물은 되살리지 않습니다. 보물이 다시 나오면 각인석을 무한정 캘 수 있어서
 * 성장이 "탐험의 보상"이 아니라 "왕복 횟수"가 됩니다.
 */
export function respawnLevelEnemies(
  level: LevelData,
  terrain: Terrain,
  /**
   * 이미 잡은 보스의 위치 키(`treasureKey` 와 같은 형식).
   *
   * **보스는 부활하지 않습니다.** 소울라이크에서 보스가 안 살아나는 건 인심이
   * 아니라 **진행의 표지**이기 때문입니다. 되살아나면 화톳불에서 쉴 때마다
   * 존이 처음으로 되돌아가서, 앞으로 나아갔다는 사실 자체가 사라집니다.
   * (실제로 그랬습니다 — 보스를 잡고 쉬면 보스가 다시 서 있었습니다.)
   */
  defeatedBosses?: ReadonlySet<string>,
): number[] {
  const out: number[] = []
  for (const item of level.entities) {
    const kind = kindFromId(item.kind)
    if (kind === null) continue
    if (kind === EnemyKind.Boss && defeatedBosses?.has(bossKey(item.x, item.z))) continue
    // 🧭 지도가 적어 둔 **바라보는 쪽**을 그대로 넘깁니다(spawnEnemy 주석).
    //    안 넘기면 이 적은 세계 원점을 보고 서고, 소리 규칙이 죽습니다.
    const e = spawnEnemy(kind, item.x, item.z, item.rotY)
    Transform.y[e] = terrain.groundYAt(item.x, item.z)
    out.push(e)
  }
  return out
}

/**
 * 레벨 데이터에 적힌 대로 엔티티를 배치합니다.
 * 지형이 주어지면 각 엔티티를 그 지점의 지면 높이에 올려 둡니다.
 */
export function spawnFromLevel(level: LevelData, terrain: Terrain): SpawnedLevel {
  const spawnPoint = level.entities.find((e) => e.kind === 'spawn')
  const player = spawnPlayer(spawnPoint?.x ?? 0, spawnPoint?.z ?? 0)
  Transform.y[player] = terrain.groundYAt(Transform.x[player], Transform.z[player])

  const entities: number[] = []
  const bonfires: Bonfire[] = []
  const anvils: { x: number; y: number; z: number }[] = []
  let treasureTotal = 0
  for (const item of level.entities) {
    if (item.kind === 'bonfire') {
      bonfires.push({
        x: item.x,
        y: terrain.groundYAt(item.x, item.z),
        z: item.z,
        lit: false,
      })
      continue
    }
    if (item.kind === 'anvil') {
      anvils.push({ x: item.x, y: terrain.groundYAt(item.x, item.z), z: item.z })
      continue
    }
    let e = -1
    // 적 종류는 표에서 찾습니다. if 사슬로 두면 새 적을 넣을 때마다
    // 여기를 고쳐야 하고, 빠뜨리면 **레벨에 배치했는데 안 나오는** 버그가 됩니다.
    const enemyKind = kindFromId(item.kind)
    // 🧭 바라보는 쪽 — 위 `spawnLevelEnemies` 와 같은 이유로 그대로 넘깁니다.
    if (enemyKind !== null) e = spawnEnemy(enemyKind, item.x, item.z, item.rotY)
    else if (item.kind === 'treasure') {
      e = spawnTreasure(item.x, item.z, item.secret === true)
      treasureTotal++
    } else if (item.kind === 'barrel') e = spawnBarrel(item.x, item.z)
    // 🏺 겉모습은 같고 **안에 든 것만** 다릅니다(format.ts 참고).
    else if (item.kind === 'urn') e = spawnUrn(item.x, item.z, false)
    else if (item.kind === 'urnFull') {
      e = spawnUrn(item.x, item.z, true)
      /**
       * 🎁 **항아리 속 보물도 총 개수에 셉니다.**
       *
       * 안 세면 *"보물 3/5 를 먹었다"* 의 분모가 틀리고, 그러면 진행도
       * 표시와 `npm run play` 의 수거율이 **다른 것을 세게** 됩니다.
       * 숨겼다는 것은 찾기 어렵다는 뜻이지 없다는 뜻이 아닙니다.
       */
      treasureTotal++
    }
    if (e < 0) continue
    Transform.y[e] = terrain.groundYAt(item.x, item.z)
    entities.push(e)
  }

  /**
   * 🧱 **금 간 벽은 레벨 목록이 아니라 지형에서 꺼냅니다.**
   *
   * 레벨에는 `crackedWall` 이 **칸 한가운데**에 적혀 있는데, 실제로
   * 막히는 자리는 **칸과 칸 사이**입니다. 그 경계를 계산하는 곳은 이미
   * 지형입니다(`buildWalls`). 여기서 한 번 더 계산하면 두 벌이 되고,
   * 두 벌이 갈라지는 날 **보이는 벽과 막히는 자리가 어긋납니다** —
   * 화면만 봐서는 절대 못 찾는 종류의 어긋남입니다.
   *
   * 덤으로 하나가 저절로 맞습니다: 지형이 **세우기를 거부한 벽**
   * (열린 방향이 둘 이상이라 경고만 찍힌 벽)은 여기에도 안 나옵니다.
   * 즉 **안 막히는 벽이 그려지는 일이 없습니다.**
   */
  for (const s of terrain.shortcuts) {
    if (s.kind !== 'wall') continue
    /**
     * 🧱💥 **여는 방법은 레벨이 정합니다.** 지형은 *"막혀 있다"* 까지만
     *    알므로(terrain.ts `buildWalls`), 칼이냐 폭발이냐는 그 칸에 적힌
     *    엔티티 종류에서 읽습니다. 지형에 그 구분을 넣지 않은 값이
     *    여기 한 줄입니다.
     */
    const at = cellToWorld(s.loX, s.loZ, terrain.level.w, terrain.level.h)
    const tough = level.entities.some(
      (it) => it.kind === 'thickWall' && Math.hypot(it.x - at.x, it.z - at.z) < 0.01,
    )
    const e = spawnCrackedWall(s.x, s.z, s.loX, s.loZ, tough)
    Transform.y[e] = terrain.groundYAt(s.x, s.z)
    entities.push(e)
  }
  return { player, entities, treasureTotal, bonfires, anvils }
}
