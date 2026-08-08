import { PLAYER, VIAL, WORLD } from '../config/balance'
import { NO_CHAIN } from '../config/bossPhases'
import { enemyDef, kindFromId } from '../config/enemies'
import type { Bonfire } from './bonfire'
import {
  Actor,
  ActorState,
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
  Velocity,
} from '../core/components'
import { addComponent, createEntity } from '../core/ecs'
import { Rng } from '../core/rng'
import type { LevelData } from '../level/format'
import type { Terrain } from '../level/terrain'
import { KIND_PLAYER, KIND_TREASURE, renderKindForEnemy } from '../render/visuals'

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
  Actor.state[e] = ActorState.Idle
  Actor.phase[e] = 0
  Actor.timer[e] = 0
  Actor.comboIndex[e] = 0
  Actor.comboWindowT[e] = 0
  Actor.bufferedAttack[e] = 0
  Actor.bufferedSkill[e] = 0
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
  Player.castX[e] = 0
  Player.castZ[e] = 0
  Player.vials[e] = VIAL.charges
  Player.vialsMax[e] = VIAL.charges
  Player.restT[e] = 0
  Player.respawnX[e] = x
  Player.respawnZ[e] = z
  Player.hasRespawn[e] = 0
  Player.embers[e] = 0
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
  Renderable.kind[e] = KIND_PLAYER
  return e
}

/** 잡몹과 보스는 같은 상태 기계를 공유합니다 — 수치와 외형만 다릅니다. */
export function spawnEnemy(kind: EnemyKind, x: number, z: number): number {
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
  // 스폰 즉시 원점(대체로 플레이어 쪽)을 바라보게 — 등 돌린 채 나타나면 어색합니다.
  Transform.rotY[e] = Math.atan2(-x, -z)
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
  Enemy.reactT[e] = 0
  Enemy.attackIndex[e] = 0
  Enemy.phase[e] = 0
  Enemy.transitionT[e] = 0
  Enemy.chainNext[e] = NO_CHAIN
  Enemy.chained[e] = 0
  Enemy.poise[e] = cfg.poiseMax
  Enemy.poiseIdleT[e] = 0
  Enemy.brokenT[e] = 0
  Enemy.homeX[e] = x
  Enemy.homeZ[e] = z
  Enemy.encounter[e] = 0
  Enemy.introT[e] = 0
  Enemy.leashT[e] = 0
  Status.snareT[e] = 0
  Renderable.kind[e] = renderKindForEnemy(kind)
  return e
}

export function spawnGrunt(x: number, z: number): number {
  return spawnEnemy(EnemyKind.Grunt, x, z)
}

export function spawnTreasure(x: number, z: number): number {
  const e = createEntity()
  addComponent(Transform, e)
  addComponent(Pickup, e)
  addComponent(Renderable, e)
  Transform.x[e] = x
  Transform.y[e] = 0
  Transform.z[e] = z
  Transform.rotY[e] = 0
  Pickup.taken[e] = 0
  // 위상차를 줘서 여러 보물이 동시에 똑같이 출렁이지 않게 합니다.
  Pickup.phase[e] = spawnRng.range(0, Math.PI * 2)
  Renderable.kind[e] = KIND_TREASURE
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
    const e = spawnEnemy(kind, item.x, item.z)
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
    let e = -1
    // 적 종류는 표에서 찾습니다. if 사슬로 두면 새 적을 넣을 때마다
    // 여기를 고쳐야 하고, 빠뜨리면 **레벨에 배치했는데 안 나오는** 버그가 됩니다.
    const enemyKind = kindFromId(item.kind)
    if (enemyKind !== null) e = spawnEnemy(enemyKind, item.x, item.z)
    else if (item.kind === 'treasure') {
      e = spawnTreasure(item.x, item.z)
      treasureTotal++
    }
    if (e < 0) continue
    Transform.y[e] = terrain.groundYAt(item.x, item.z)
    entities.push(e)
  }
  return { player, entities, treasureTotal, bonfires }
}
