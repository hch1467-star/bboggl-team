/**
 * 최소 PNG 디코더 — 프로브가 **화면에 실제로 그려진 색**을 읽기 위한 것.
 *
 * ── 왜 직접 쓰나 ────────────────────────────────────────────────
 * 색 대비를 재려면 픽셀이 필요한데, 이 저장소에는 PNG 디코더가 없습니다.
 * 방법이 셋 있었습니다:
 *
 *   1. 의존성 추가(pngjs 등) — 오프라인 컨테이너에서 설치가 실패할 수 있고,
 *      "재려고 프로젝트를 바꾸는" 일이 됩니다.
 *   2. 렌더러에 `preserveDrawingBuffer` 를 켜서 페이지 안에서 픽셀 읽기 —
 *      **게임 쪽을 바꿔야 합니다.** 재려고 재는 대상을 건드리는 것이라,
 *      이 프로젝트에서 가장 피하고 싶은 종류의 변경입니다.
 *   3. 여기: Playwright 스크린샷(PNG)을 그대로 받아 Node 내장 `zlib` 로 풉니다.
 *      게임도 안 바꾸고 의존성도 안 늘립니다.
 *
 * ── 무엇만 지원하나 ────────────────────────────────────────────
 * Playwright 스크린샷은 **8비트 RGBA, 비인터레이스**로 고정입니다.
 * 그 한 가지만 다루고, 다른 형식이 들어오면 조용히 틀린 값을 내는 대신
 * **던집니다.** 계측기가 조용히 틀리는 것이 이 프로젝트에서 가장 비쌉니다.
 */
import zlib from 'node:zlib'

/** PNG 버퍼 → { width, height, data: Uint8Array(RGBA) } */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 서명이 아닙니다')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]
      colorType = body[9]
      if (body[12] !== 0) throw new Error('인터레이스 PNG 는 지원하지 않습니다')
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`8비트만 지원합니다 (받은 값 ${bitDepth})`)
  // 2 = RGB, 6 = RGBA. Playwright 는 6 을 줍니다.
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error(`RGB/RGBA 만 지원합니다 (colorType ${colorType})`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      const x = line[i]
      let v
      switch (filter) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: {
          // Paeth — 세 이웃 중 예측에 가장 가까운 것을 고릅니다.
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new Error(`알 수 없는 필터 ${filter}`)
      }
      cur[i] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4 + 0] = cur[x * channels + 0]
      out[(y * width + x) * 4 + 1] = cur[x * channels + 1]
      out[(y * width + x) * 4 + 2] = cur[x * channels + 2]
      out[(y * width + x) * 4 + 3] = channels === 4 ? cur[x * channels + 3] : 255
    }
    prev = cur
  }
  return { width, height, data: out }
}

/**
 * sRGB(0~255) → CIELAB.
 *
 * 왜 RGB 로 바로 안 빼는가: RGB 거리는 **사람 눈의 거리와 다릅니다.**
 * 초록 계열은 RGB 로 멀어도 눈에는 비슷하고, 어두운 색끼리는 RGB 로 가까워도
 * 눈에는 확 다릅니다. "구분되는가"를 물으려면 사람 눈에 맞춘 공간이라야 합니다.
 */
export function toLab(r, g, b) {
  const lin = (u) => {
    const c = u / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  // sRGB → XYZ (D65)
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(X)
  const fy = f(Y)
  const fz = f(Z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** 두 색의 지각 거리(CIE76 ΔE). */
export function deltaE(c1, c2) {
  const a = toLab(c1[0], c1[1], c1[2])
  const b = toLab(c2[0], c2[1], c2[2])
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * 색각 이상 시뮬레이션 — sRGB 색 하나를 "그 사람 눈에 보이는 색"으로 바꿉니다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * enemyAttacks.ts 는 예고 색을 정하며 이렇게 적어 두었습니다:
 *
 *   > 색맹(적록)을 고려해 **밝기와 채도도 함께** 벌려 두었습니다. 색만으로
 *   > 구분하게 만들면 남성 약 8%가 빨강/노랑을 구분하지 못합니다.
 *
 * 옳은 판단이지만 **한 번도 확인한 적이 없습니다.** `npm run contrast` 는
 * 정상 시야에서만 ΔE 를 재고, 그건 이 문장을 검사하지 않습니다.
 *
 * ── 계수의 출처 ────────────────────────────────────────────────────
 * Machado·Oliveira·Fernandes (2009) 의 **선형 RGB 변환 행렬**(중증도 1.0)을
 * 씁니다. 색각 이상 시뮬레이션에서 가장 널리 쓰이는 표이고, 우리가 지어낸
 * 값이 아닙니다. ⚠️ **선형 RGB 에서** 곱해야 합니다 — sRGB 값에 그대로
 * 곱하면 감마 때문에 어두운 쪽이 통째로 틀립니다.
 */
const CVD_MATRIX = {
  /** 적색맹 — 남성 약 1% */
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  /** 녹색맹 — 남성 약 6%. 적록 혼동의 대부분이 여기입니다. */
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  /** 청색맹 — 드물지만(0.01%) 파랑/초록을 쓰는 우리에겐 확인할 값입니다. */
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

export const CVD_KINDS = Object.keys(CVD_MATRIX)

export function simulateCvd([r, g, b], kind) {
  const m = CVD_MATRIX[kind]
  if (!m) throw new Error(`모르는 색각 유형: ${kind}`)
  const lin = (u) => {
    const c = u / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const enc = (c) => {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, Math.round(v * 255)))
  }
  const v = [lin(r), lin(g), lin(b)]
  return m.map((row) => enc(Math.max(0, Math.min(1, row[0] * v[0] + row[1] * v[1] + row[2] * v[2]))))
}

/**
 * **색을 통째로 지웠을 때의 밝기** (0~255).
 *
 * 색각 이상은 색을 *섞어* 보지만, 이 값은 더 가혹한 질문입니다 —
 * *"색이 아예 없어도 갈리는가."* 화면이 어둡거나, 햇빛 아래거나,
 * 저가 모니터에서 채도가 죽으면 실제로 이쪽에 가까워집니다.
 */
export function luminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
