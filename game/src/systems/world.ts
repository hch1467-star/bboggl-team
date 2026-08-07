import { BOSS, GRUNT, PLAYER, WORLD } from '../config/balance'
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
  Transform,
  Velocity,
} from '../core/components'
import { addComponent, createEntity } from '../core/ecs'
import { Rng } from '../core/rng'
import type { LevelData } from '../level/format'
import type { Terrain } from '../level/terrain'
import { KIND_BOSS, KIND_GRUNT, KIND_PLAYER, KIND_TREASURE } from '../render/visuals'

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
  Actor.state[e] = ActorState.Idle
  Actor.phase[e] = 0
  Actor.timer[e] = 0
  Actor.comboIndex[e] = 0
  Actor.comboWindowT[e] = 0
  Actor.bufferedAttack[e] = 0
  Actor.cooldownT[e] = 0
  Actor.hitsLeft[e] = 0
  Actor.nextHitT[e] = 0
  Actor.skillSlot[e] = 0
  Actor.moveScale[e] = 1
  Player.dodgeDirX[e] = 0
  Player.dodgeDirZ[e] = 1
  Player.dodgeElapsed[e] = 0
  Player.dodgeCooldownT[e] = 0
  Player.castX[e] = 0
  Player.castZ[e] = 0
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
  Renderable.kind[e] = KIND_PLAYER
  return e
}

/** 잡몹과 보스는 같은 상태 기계를 공유합니다 — 수치와 외형만 다릅니다. */
export function spawnEnemy(kind: EnemyKind, x: number, z: number): number {
  const cfg = kind === EnemyKind.Boss ? BOSS : GRUNT
  const e = createEntity()
  addComponent(Transform, e)
  addComponent(Velocity, e)
  addComponent(Body, e)
  addComponent(Health, e)
  addComponent(Actor, e)
  addComponent(Enemy, e)
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
  Renderable.kind[e] = kind === EnemyKind.Boss ? KIND_BOSS : KIND_GRUNT
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
export function spawnWave(count: number): number[] {
  const spawned: number[] = []
  const ringRadius = WORLD.arenaRadius * 0.82
  const baseAngle = spawnRng.next() * Math.PI * 2
  for (let i = 0; i < count; i++) {
    // 균등 분할 + 흔들림. 순수 랜덤만 쓰면 한쪽에 뭉쳐 스폰됩니다.
    const angle = baseAngle + (i / count) * Math.PI * 2 + spawnRng.range(-0.25, 0.25)
    const r = ringRadius * spawnRng.range(0.85, 1)
    spawned.push(spawnGrunt(Math.cos(angle) * r, Math.sin(angle) * r))
  }
  return spawned
}

export function enemyCountForWave(wave: number): number {
  return Math.min(
    WORLD.maxEnemiesPerWave,
    WORLD.initialEnemies + (wave - 1) * WORLD.enemiesPerWaveGrowth,
  )
}

export interface SpawnedLevel {
  player: number
  entities: number[]
  treasureTotal: number
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
  let treasureTotal = 0
  for (const item of level.entities) {
    let e = -1
    if (item.kind === 'grunt') e = spawnEnemy(EnemyKind.Grunt, item.x, item.z)
    else if (item.kind === 'boss') e = spawnEnemy(EnemyKind.Boss, item.x, item.z)
    else if (item.kind === 'treasure') {
      e = spawnTreasure(item.x, item.z)
      treasureTotal++
    }
    if (e < 0) continue
    Transform.y[e] = terrain.groundYAt(item.x, item.z)
    entities.push(e)
  }
  return { player, entities, treasureTotal }
}
