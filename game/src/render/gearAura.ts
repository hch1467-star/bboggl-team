import * as THREE from 'three'
import { WEAPONS } from '../config/arsenal'
import { GEAR_TIERS, tierDef } from '../config/gear'
import { time } from '../core/time'

/**
 * ✨ **등급의 불티** — 좋은 무기를 든 캐릭터에서 피어오르는 알갱이들.
 *
 * ── 왜 또 만드는가 (두 번 실패한 자리입니다) ───────────────────────
 * 등급을 눈에 보이게 하려고 지금까지 두 번 시도했습니다:
 *
 *   1. **무기 모델을 빛나게** (`syncGearGlow`) — 찍어 보니 **안 보였습니다.**
 *      이 카메라에서 캐릭터는 40px 남짓이고 칼은 그 안의 몇 픽셀입니다.
 *   2. **휘두른 자국에 물들이기** (`spawnSwing`) — 보입니다. 다만 **휘두를
 *      때만** 보입니다. 걸어다니는 동안 내 무기가 신화인지 일반인지는
 *      화면 어디에도 없습니다.
 *
 * 디아블로·PoE·로스트아크가 전부 같은 답을 씁니다 — **알갱이**입니다.
 * 알갱이가 이 줌에서 통하는 이유는 크기가 아니라 **개수와 움직임**이라서
 * 입니다. 5px 짜리 점 하나는 안 보이지만, 열 개가 서로 다른 높이에서
 * 계속 올라오면 눈이 먼저 그쪽으로 갑니다(주변 시야는 **움직임**에
 * 반응합니다 — 이 저장소가 반격 신호에서 이미 쓴 근거입니다).
 *
 * ── ⏱️ **시간의 순수한 함수입니다** ────────────────────────────────
 * 알갱이 위치는 `time.elapsed` 와 번호만으로 정해집니다. 무작위 방출기가
 * 아닙니다. 이유는 두 가지입니다:
 *   · 이 게임의 무작위는 전부 씨앗 난수라 `Math.random()` 을 못 씁니다
 *   · **같은 시각이면 같은 그림**이라야 스크린샷 비교가 성립합니다
 *     (등급 물들임을 찍다가 *"두 장의 애니메이션 시점이 달라서 픽셀
 *     비교가 색이 아니라 타이밍을 재고 있었다"* 로 한 번 데였습니다)
 *
 * ── 🗡️ **무기마다 성격이 다릅니다 — 그런데 새 숫자를 안 만듭니다** ───
 * 대검의 불티는 **크고 느리게**, 쌍단검은 **작고 빠르게** 오릅니다.
 * 이 차이를 새 설정값으로 적지 않고 `moveSpeedScale`(무기가 이미 가진
 * "가벼움") 에서 **유도합니다.** 따로 적으면 언젠가 갈라집니다 —
 * 무기를 무겁게 고쳤는데 불티만 여전히 빠른 그림이 남습니다.
 */

/** 풀 크기는 **가장 화려한 등급**이 요구하는 만큼. 그보다 적으면 신화가 잘립니다. */
const MAX_MOTES = GEAR_TIERS.reduce((m, t) => Math.max(m, t.sparkle), 0)

/** 알갱이가 도는 반지름(m). 캐릭터 몸통(0.4m)보다 확실히 밖이라야 실루엣에 안 묻힙니다. */
const ORBIT_R = 0.85
/** 바닥에서 시작해 이만큼 오릅니다. 키(1.8m)를 넘기면 머리 위 UI 와 겹칩니다. */
const RISE = 1.55
/** 한 알갱이가 바닥에서 꼭대기까지 가는 데 걸리는 시간(초, 기준 무기). */
const RISE_TIME = 1.35
/**
 * 기준 크기(m).
 *
 * ⚠️ **0.24 로 넣었다가 찍어 보고 0.40 으로 올렸습니다.** 이 카메라는
 * 1m 가 22px 남짓이라 0.24m 면 5px 이고, 가장자리가 부드러운 광점은
 * 그중 실제로 밝은 부분이 2px 뿐입니다. 전설(주황 6개) 스크린샷에서
 * 알갱이가 **두 개쯤 겨우 보였습니다** — 사용자가 말한 "화려한 전설의 검"
 * 근처가 아니었습니다. 이 저장소가 등급 빛으로 이미 한 번 배운 것과
 * 같은 실수입니다: **화면에서 재기 전에는 크기를 모릅니다.**
 */
const MOTE_SIZE = 0.4

/** 부드러운 원형 광점 텍스처. 사각형 그대로 쓰면 이 크기에서 **네모**로 보입니다. */
function makeMoteTexture(): THREE.Texture {
  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  /**
   * ⚠️ **가운데를 넓고 단단하게 잡습니다.**
   *
   * 처음엔 0.35 지점에서 이미 0.75 로 떨어지는 완만한 그라디언트였습니다.
   * 5px 짜리 점에서 그건 *"밝은 픽셀 2개 + 흐린 테두리"* 이고, 화면에서는
   * 흐린 테두리가 안개·톤매핑에 먹혀 사실상 2px 만 남습니다. 중심부를
   * 넓게 두면 같은 크기로도 **알갱이로 읽힙니다.**
   */
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,255,255,1)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

export interface AuraMote {
  x: number
  y: number
  z: number
  /** 화면에 놓인 크기(m) — 무기의 무게가 여기로 나옵니다. */
  size: number
  opacity: number
}

export class GearAura {
  private readonly texture = makeMoteTexture()
  private readonly sprites: THREE.Sprite[] = []
  private readonly materials: THREE.SpriteMaterial[] = []
  private live = 0
  private color = 0
  /** 이번 프레임에 실제로 쓴 무기 번호 — 프로브가 *"정말 바뀌었나"* 를 묻습니다. */
  private weapon = -1

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < MAX_MOTES; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        // 더하기 합성 — 어두운 폐허 위에서 **빛나는 것**으로 읽히게 합니다.
        // 보통 합성이면 밝은 회색 점이 되고, 이 게임의 톤매핑이 그걸 접습니다
        // (구역 색을 밝기로 가르려다 실패한 그 성질입니다).
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const sp = new THREE.Sprite(mat)
      sp.visible = false
      // 캐릭터 뒤로 가도 살짝 비쳐야 "감싸고 있다"로 읽힙니다.
      sp.renderOrder = 3
      scene.add(sp)
      this.sprites.push(sp)
      this.materials.push(mat)
    }
  }

  /**
   * 이 프레임의 알갱이를 놓습니다.
   *
   * @param x,y,z      캐릭터 발밑
   * @param tier       장비 등급
   * @param weaponIndex 든 무기 — 성격(빠르기·크기)이 여기서 나옵니다
   */
  update(x: number, y: number, z: number, tier: number, weaponIndex: number): void {
    const td = tierDef(tier)
    const n = td.sparkle
    this.live = n
    this.color = td.color
    this.weapon = weaponIndex
    if (n <= 0) {
      for (const sp of this.sprites) sp.visible = false
      return
    }
    /**
     * 🗡️ 무기의 "가벼움"을 그대로 씁니다. 가벼운 무기(1.1)는 빠르고 작게,
     *    무거운 무기(0.86)는 느리고 크게. 새 숫자가 아니라 **유도**입니다.
     */
    const light = WEAPONS[Math.min(weaponIndex, WEAPONS.length - 1)]?.moveSpeedScale ?? 1
    const rise = RISE_TIME / light
    const size = MOTE_SIZE / light
    const col = new THREE.Color(td.color)

    for (let i = 0; i < this.sprites.length; i++) {
      const sp = this.sprites[i]
      if (i >= n) {
        sp.visible = false
        continue
      }
      /**
       * 오르는 진행도. 알갱이마다 `i/n` 만큼 어긋나게 두면 **끊이지 않고**
       * 올라옵니다. 다 같이 오르면 한 번에 떴다 한 번에 사라져서, 알갱이가
       * 아니라 **깜빡임**으로 보입니다.
       */
      const raw = time.elapsed / rise + i / n
      const climb = raw - Math.floor(raw)
      // 나선 — 오르면서 돕니다. 제자리에서만 오르면 두 줄로 겹쳐 보입니다.
      const ang = climb * Math.PI * 1.6 + (i / n) * Math.PI * 2
      const r = ORBIT_R * (1 - climb * 0.35) // 위로 갈수록 모입니다(모닥불 연기처럼)
      sp.position.set(x + Math.cos(ang) * r, y + 0.15 + climb * RISE, z + Math.sin(ang) * r)
      /**
       * 아래에서 **차오르고** 위에서 **사그라듭니다**(sin 곡선). 양 끝에서
       * 0 이라야 튀어나오고 툭 꺼지는 것이 안 보입니다 — 이 게임의 다른
       * 이펙트(`fade`)가 전부 지키는 규칙입니다.
       */
      const fade = Math.sin(Math.PI * climb)
      const s = size * (0.55 + 0.45 * fade)
      sp.scale.set(s, s, s)
      this.materials[i].color.copy(col)
      this.materials[i].opacity = 0.45 + 0.55 * fade
      sp.visible = true
    }
  }

  /**
   * 🔬 **지금 화면에 실제로 놓인 알갱이들.** 프로브가 규칙을 다시 계산하지
   * 않고 **그려진 것**을 묻습니다 — 배선이 끊겨도 설정만 보면 통과하는
   * 함정을 이 저장소가 여러 번 밟았습니다(`debugSwingPose` 와 같은 이유).
   */
  debugMotes(): { count: number; color: number; weapon: number; motes: AuraMote[] } {
    const motes: AuraMote[] = []
    for (let i = 0; i < this.live; i++) {
      const sp = this.sprites[i]
      if (!sp.visible) continue
      motes.push({
        x: sp.position.x,
        y: sp.position.y,
        z: sp.position.z,
        // ⚠️ **놓인 값**을 그대로 줍니다. 여기서 규칙을 다시 계산하면
        //    배선이 끊겨도 프로브가 통과합니다 — 이 저장소의 단골 함정입니다.
        size: sp.scale.x,
        opacity: this.materials[i].opacity,
      })
    }
    return { count: motes.length, color: this.color, weapon: this.weapon, motes }
  }

  dispose(): void {
    for (const sp of this.sprites) this.scene.remove(sp)
    for (const mat of this.materials) mat.dispose()
    this.texture.dispose()
  }
}
