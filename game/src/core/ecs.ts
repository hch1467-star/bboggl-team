/**
 * Minimal data-oriented ECS (Entity Component System).
 *
 * WHY THIS EXISTS (설계 근거):
 *  - 쿼터뷰 ARPG는 화면에 적이 수백 마리 나옵니다. 적 하나당 객체(class) 하나를 만드는
 *    전통적인 방식은 JS 힙이 파편화되고 GC가 튀어서 프레임이 무너집니다.
 *  - ECS는 데이터를 "타입 배열(TypedArray)"에 연속으로 저장합니다. CPU 캐시 적중률이
 *    올라가서 같은 로직이 수십 배 빨라집니다. (bitECS 등 라이브러리와 같은 원리)
 *  - 외부 라이브러리 대신 직접 쓴 이유: 150줄이면 전부 이해할 수 있고, 라이브러리
 *    버전이 바뀌어도 깨지지 않으며, Unity DOTS로 옮길 때 개념이 1:1로 대응됩니다.
 *
 * UNITY 이식 노트: Component = IComponentData(struct), Query = EntityQuery,
 * System 함수 = ISystem.OnUpdate 로 거의 그대로 옮겨집니다.
 */

export const MAX_ENTITIES = 4096
const MASK_WORDS = 2 // 32bit * 2 = 최대 64종류의 컴포넌트

const $meta = Symbol('ecs.meta')

type FieldMap = {
  f32: Float32Array
  i32: Int32Array
  u8: Uint8Array
  u16: Uint16Array
  u32: Uint32Array
}
type FieldType = keyof FieldMap
type Schema = Record<string, FieldType>

interface Meta {
  word: number
  bit: number
}

export type Component<S extends Schema = Schema> = { [K in keyof S]: FieldMap[S[K]] } & {
  readonly [$meta]: Meta
}

const masks = new Uint32Array(MAX_ENTITIES * MASK_WORDS)
const alive = new Uint8Array(MAX_ENTITIES)
const freeList: number[] = []
let highWater = 0
let nextComponentBit = 0

/** 살아있는 엔티티 수 (디버그/HUD용) */
export function liveEntityCount(): number {
  let n = 0
  for (let e = 0; e < highWater; e++) if (alive[e]) n++
  return n
}

export function createEntity(): number {
  const e = freeList.length > 0 ? freeList.pop()! : highWater++
  if (e >= MAX_ENTITIES) throw new Error('ECS: MAX_ENTITIES exceeded')
  alive[e] = 1
  masks[e * MASK_WORDS] = 0
  masks[e * MASK_WORDS + 1] = 0
  return e
}

export function destroyEntity(e: number): void {
  if (!alive[e]) return
  alive[e] = 0
  masks[e * MASK_WORDS] = 0
  masks[e * MASK_WORDS + 1] = 0
  freeList.push(e)
}

export function isAlive(e: number): boolean {
  return alive[e] === 1
}

const ALLOC: { [K in FieldType]: (n: number) => FieldMap[K] } = {
  f32: (n) => new Float32Array(n),
  i32: (n) => new Int32Array(n),
  u8: (n) => new Uint8Array(n),
  u16: (n) => new Uint16Array(n),
  u32: (n) => new Uint32Array(n),
}

export function defineComponent<S extends Schema>(schema: S): Component<S> {
  const id = nextComponentBit++
  if (id >= MASK_WORDS * 32) throw new Error('ECS: too many component types')

  const store = {} as Record<string, unknown>
  for (const key of Object.keys(schema)) {
    store[key] = ALLOC[schema[key]](MAX_ENTITIES)
  }
  Object.defineProperty(store, $meta, {
    value: { word: (id / 32) | 0, bit: 1 << id % 32 } satisfies Meta,
    enumerable: false,
  })
  return store as Component<S>
}

export function addComponent(c: Component, e: number): void {
  const m = c[$meta]
  masks[e * MASK_WORDS + m.word] |= m.bit
}

export function removeComponent(c: Component, e: number): void {
  const m = c[$meta]
  masks[e * MASK_WORDS + m.word] &= ~m.bit
}

export function hasComponent(c: Component, e: number): boolean {
  const m = c[$meta]
  return (masks[e * MASK_WORDS + m.word] & m.bit) !== 0
}

/**
 * 쿼리는 자기 전용 버퍼를 들고 있어서 매 프레임 배열을 새로 만들지 않습니다(GC 방지).
 *
 * 사용법:
 *   const enemies = defineQuery(Transform, Enemy)
 *   const ids = enemies.run()
 *   for (let i = 0; i < enemies.count; i++) { const e = ids[i]; ... }
 */
export class Query {
  private readonly buf = new Int32Array(MAX_ENTITIES)
  private readonly w0: number
  private readonly w1: number
  count = 0

  constructor(components: Component[]) {
    let w0 = 0
    let w1 = 0
    for (const c of components) {
      const m = c[$meta]
      if (m.word === 0) w0 |= m.bit
      else w1 |= m.bit
    }
    this.w0 = w0
    this.w1 = w1
  }

  run(): Int32Array {
    const { buf, w0, w1 } = this
    let n = 0
    for (let e = 0; e < highWater; e++) {
      if (!alive[e]) continue
      const base = e * MASK_WORDS
      if ((masks[base] & w0) !== w0) continue
      if ((masks[base + 1] & w1) !== w1) continue
      buf[n++] = e
    }
    this.count = n
    return buf
  }
}

export function defineQuery(...components: Component[]): Query {
  return new Query(components)
}

/** 테스트/재시작용 — 모든 엔티티를 비웁니다 (컴포넌트 정의는 유지). */
export function resetWorld(): void {
  alive.fill(0)
  masks.fill(0)
  freeList.length = 0
  highWater = 0
}
