import { GRUNT, PLAYER, WORLD } from '../config/balance'
import {
  Actor,
  ActorState,
  Body,
  Enemy,
  Health,
  Player,
  Renderable,
  Stamina,
  Transform,
  Velocity,
} from '../core/components'
import { addComponent, createEntity } from '../core/ecs'
import { Rng } from '../core/rng'
import { KIND_GRUNT, KIND_PLAYER } from '../render/visuals'

/** 스폰 전용 RNG. 전투 RNG와 분리해야 재현성이 깨지지 않습니다. */
const spawnRng = new Rng(20260807)

export function spawnPlayer(): number {
  const e = createEntity()
  addComponent(Transform, e)
  addComponent(Velocity, e)
  addComponent(Body, e)
  addComponent(Health, e)
  addComponent(Stamina, e)
  addComponent(Actor, e)
  addComponent(Player, e)
  addComponent(Renderable, e)

  Transform.x[e] = 0
  Transform.y[e] = 0
  Transform.z[e] = 0
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
  Actor.hasHit[e] = 0
  Actor.moveScale[e] = 1
  Player.dodgeDirX[e] = 0
  Player.dodgeDirZ[e] = 1
  Player.dodgeElapsed[e] = 0
  Player.dodgeCooldownT[e] = 0
  Renderable.kind[e] = KIND_PLAYER
  return e
}

export function spawnGrunt(x: number, z: number): number {
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
  // 스폰 즉시 중앙(플레이어)을 바라보게 — 등 돌린 채 나타나면 어색합니다.
  Transform.rotY[e] = Math.atan2(-x, -z)
  Velocity.x[e] = 0
  Velocity.z[e] = 0
  Velocity.kx[e] = 0
  Velocity.kz[e] = 0
  Body.radius[e] = GRUNT.radius
  Body.height[e] = GRUNT.height
  Health.hp[e] = GRUNT.maxHp
  Health.max[e] = GRUNT.maxHp
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
  Actor.hasHit[e] = 0
  Actor.moveScale[e] = 1
  Enemy.kind[e] = 0
  Enemy.aggro[e] = 0
  Renderable.kind[e] = KIND_GRUNT
  return e
}

/**
 * 아레나 가장자리 링 위에 적을 흩뿌립니다.
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
