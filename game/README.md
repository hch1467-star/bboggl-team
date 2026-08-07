# Quarterview ARPG — 프로토타입

로스트아크(파밍·성장)와 No Rest for the Wicked(소울라이크 전투·생존)를 **혼합**한
쿼터뷰 액션 RPG. 지금은 **웹 프로토타입**이고, 최종 목표는 **Unity 6 이식 후 Steam 출시**입니다.

---

## 지금 되는 것 (M1 + M2 완료)

| 기둥 | 상태 |
|---|---|
| 쿼터뷰 직교 카메라 (yaw 45° / pitch 52°) | ✅ |
| WASD 이동 (카메라 기준) + 마우스 조준 | ✅ |
| 3타 콤보 (선행동작 → 판정 → 후딜) | ✅ |
| 선입력 버퍼 / 후딜 회피 캔슬 | ✅ |
| 회피 구르기 (스태미나 + 무적 프레임) | ✅ |
| **히트스톱** — 타격 순간 시뮬레이션만 정지 | ✅ |
| **방향성 화면 흔들림** (trauma 제곱 감쇠) | ✅ |
| 데미지 숫자 · 히트 스파크 · 검격 궤적 | ✅ |
| 예고 동작을 하는 근접 적 AI | ✅ |
| 넉백 · 경직 · 밀어내기 | ✅ |
| 웨이브 진행 · HUD · 게임오버 | ✅ |

## 아직 안 된 것 (다음 단계)

- **M3** 적 100마리+ (플로우 필드 길찾기 · 공간 해시 · InstancedMesh)
- **M4** 아이템 · 랜덤 옵션(어픽스) · 장비 · 스탯 성장
- **M5** 절차적 던전 생성 · 보스 패턴
- **M6** 세이브 · 사운드 · 메뉴 · 아트 에셋(Synty POLYGON) 교체

---

## 실행

```bash
cd game
npm install
npm run dev        # 개발 서버 (http://localhost:5173)
```

| 명령 | 하는 일 |
|---|---|
| `npm run build` | 타입 검사 + 프로덕션 빌드 |
| `npm run verify` | **헤드리스 브라우저로 게임을 실제 조작하며 25개 항목 자동 검증** |
| `npm run vfx` | 이펙트를 하나씩 격리해 스크린샷 (VFX 디버깅용) |

`?lowfx=1` 을 URL에 붙이면 그림자·안티에일리어싱을 꺼서 저사양 PC에서도 돌아갑니다.

### 조작

| 키 | 동작 |
|---|---|
| `W` `A` `S` `D` | 이동 (화면 기준) |
| 마우스 | 조준 |
| 좌클릭 | 공격 (연타 시 3타 콤보) |
| `Space` / `Shift` | 회피 구르기 (무적 프레임) |

---

## 아키텍처

```
src/
├── core/           ← 엔진 비의존. Unity로 그대로 넘어가는 부분
│   ├── ecs.ts          데이터 지향 ECS (150줄, 전부 읽을 수 있음)
│   ├── components.ts   순수 데이터. 로직 없음
│   ├── time.ts         히트스톱을 위한 이중 시간축 (dt / realDt)
│   ├── input.ts        키/마우스 + justPressed 엣지 검출
│   └── rng.ts          시드 기반 난수 (재현 가능한 던전/루트)
├── config/
│   └── balance.ts  ← 모든 튜닝 수치. Unity ScriptableObject 1:1 대응
├── systems/        ← 게임 로직. Three.js를 import하지 않음
│   ├── playerControl.ts  상태 기계: Idle/Attack/Dodge/Stagger
│   ├── enemyAI.ts        추격 → 예고 → 공격 → 후딜
│   ├── combat.ts         부채꼴 판정 (플레이어/적 공용)
│   ├── physics.ts        적분 · 밀어내기 · 경계
│   ├── health.ts         타이머 · 사망
│   └── world.ts          스폰 · 웨이브
├── render/         ← Three.js 전용. Unity 이식 시 **이 폴더만 버립니다**
└── ui/hud.ts       DOM 기반 HUD
```

### 핵심 설계 결정과 근거

**1. 왜 ECS인가**
적이 수백 마리 나오는 장르입니다. 객체 하나당 클래스 인스턴스를 만들면 GC가
가장 바쁜 순간에 프레임을 끊습니다. ECS는 데이터를 타입 배열에 연속 저장해
캐시 적중률을 올립니다. Unity DOTS와 개념이 1:1 대응됩니다.

**2. 왜 시간축이 두 개인가 (`dt` / `realDt`)**
타격 순간 **게임플레이만** 멈추고 카메라 흔들림·파티클은 계속 돌아야 합니다.
전부 멈추면 "렉"으로 보이고, 아무것도 안 멈추면 "물풍선 때리는 느낌"이 납니다.

**3. 왜 systems/ 는 Three.js를 모르는가**
Unity로 옮길 때 `render/` 폴더만 버리고 나머지를 C#으로 번역하면 됩니다.
지금 렌더러와 로직을 섞어두면 이식이 "재작성"이 됩니다.

**4. 왜 넉백을 이동 속도와 분리했는가**
합치면 플레이어 이동 제어가 넉백을 0.07초 만에 지워버려서 밀려나는 게 안 보입니다.

**5. 왜 자동 검증(`npm run verify`)이 있는가**
이 프로젝트에서 실제로 겪은 일: 타입 검사 통과 + 로직 테스트 24개 전부 통과인데
**화면이 통째로 검게** 나왔습니다(안개 거리 설정 실수). 그래서 검증 스크립트가
프레임버퍼 픽셀을 직접 읽어 "검은 화면"까지 잡습니다.

---

## Unity 6 이식 계획

| 웹 (지금) | Unity 6 (나중) |
|---|---|
| `core/ecs.ts` | Unity DOTS (Entities) 또는 일반 MonoBehaviour |
| `core/components.ts` | `IComponentData` struct |
| `config/balance.ts` | `ScriptableObject` (.asset) |
| `systems/*.ts` | `ISystem.OnUpdate` / 일반 C# 클래스 |
| `render/*` | **폐기** — Unity 렌더러/셰이더로 대체 |
| `ui/hud.ts` | UI Toolkit 또는 uGUI |

숫자(밸런스)와 상태 기계 구조가 이미 검증된 상태로 넘어가는 것이 이 순서의 목적입니다.
