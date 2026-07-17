/* ============================================
   인천 노선 항공편 시간표(js/flightSchedule.js) 자동 갱신 스크립트
   GitHub Actions(.github/workflows/update-flight-schedule.yml)에서 매달 1일 자동 실행됨.
   수동 실행: DATA_GO_KR_SERVICE_KEY=... node scripts/update-flight-schedule.js
   ============================================ */

const fs = require("fs");
const path = require("path");

const SERVICE_KEY = process.env.DATA_GO_KR_SERVICE_KEY;
if (!SERVICE_KEY) {
  console.error("DATA_GO_KR_SERVICE_KEY 환경변수가 없어요. GitHub 저장소 시크릿 설정을 확인해주세요.");
  process.exit(1);
}

const OUT_PATH = path.join(__dirname, "..", "js", "flightSchedule.js");

// 인천 노선 — { route, durationMin(왕복 평균 비행시간, 반대편 공항 시간 계산용), inbound(일본→인천 편명 그룹), outbound(인천→일본 편명 그룹) }
// 편명 그룹/노선 목록은 js/flightDirections.js·js/flightAirports.js의 인천 관련 항목과 같은 원본 노선표에서 가져옴.
const INCHEON_ROUTES = [
  {
    route: "오사카",
    durationMin: 110,
    inbound: [
      "OZ117", "KE738/JL5269", "RF315", "7C1396", "KE722/JL5211", "OZ115/NH6955",
      "RS712", "7C1302", "OZ111/NH6951", "7C1392", "LJ242", "TW302",
      "RS714(木以外)", "7C1304", "ZE612", "7C1306", "JL234", "LJ237(火/水以外)",
      "WE304", "KE724/JL5213", "LJ238(火/水以外)", "ZE614", "KE726/JL5215", "OZ113",
    ],
    outbound: [
      "RF316", "OZ112/NH6952", "7C1301", "RS711", "LJ231/KE5071", "7C1391",
      "TW301", "LJ241", "7C1303", "ZE611", "KE723/JL5210", "BX172/OZ9568",
      "7C1305", "TW303", "WE511", "BX174/OZ9570", "RS713(木以外)", "7C1393",
      "KE725/JL5212", "ZE613", "RS715", "LJ239", "OZ114", "KE721/JL5214",
      "OZ116/NH6956", "OZ118",
    ],
  },
  {
    route: "고베",
    durationMin: 110,
    inbound: ["KE2172", "7C1622(6/11-)", "KE2174"],
    outbound: ["KE2171", "7C1621(6/11-)", "KE2173"],
  },
  {
    route: "나고야",
    durationMin: 120,
    inbound: ["KE744/JL5217", "OZ121/NH6963", "KE742/JL5219", "OZ123/NH6965"],
    outbound: ["OZ122/NH6964", "KE741/JL5216", "OZ124/NH6966", "KE743/JL5218"],
  },
  {
    route: "후쿠오카",
    durationMin: 85,
    inbound: ["OZ131", "KE788/JL5221", "KE792/JL5273", "OZ133/NH6959", "KE796", "LJ272/KE5096", "KE782/JL5225"],
    outbound: ["OZ132", "KE787/JL5220", "KE791/JL5272", "OZ134/NH6960", "KE795", "LJ271/KE5095", "KE781/JL5224"],
  },
  {
    route: "나리타",
    durationMin: 150,
    inbound: [
      "OZ107/NH6977", "KE706/JL5201", "LJ204(월금토/6·8-)", "YP732(화이외)",
      "OZ101/NH6971", "YP734(화만)", "KE704/JL5205", "OZ103/NH6973",
      "KE712/JL5251", "YP736(목금토)", "LJ210/KE5094", "KE708", "LJ212(월금토)",
      "OZ105/NH6975", "ET673(수금토)", "KE714/JL5253",
    ],
    outbound: [
      "LJ203(월/금/토/일)", "OZ102/NH6972", "YP731(화이외)", "YP733(화만)", "WE501",
      "KE703/JL5202", "OZ104/NH6974", "KE711/JL5250", "YP735(목금토)",
      "LJ209/KE5093", "KE707", "OZ106/NH6976", "ET672(수금토)", "KE713/JL5252",
      "OZ108/NH6978", "KE705/JL5206",
    ],
  },
  {
    route: "하네다",
    durationMin: 150,
    inbound: ["OZ177/NH6895", "KE752/JL5257"],
    outbound: ["KE751/JL5256", "OZ178/NH6896"],
  },
];

// 김포 노선 — 한국공항공사_국제선 항공기스케줄(공공데이터활용지원센터, api.odcloud.kr) 자동 조회 대상 편명 그룹
// 이 데이터셋은 인천 API와 달리 출발/도착 시간을 한 번에 다 주기 때문에 반대편 시간을 따로 계산할 필요 없음.
const GIMPO_ROUTE_ENTRIES = [
  "OZ1135/NH6957", "KE2118/JL5247", "7C1328", "OZ1155/NH6979", "KE2120/JL5151",
  "OZ1145/NH6958", "KE2117/JL5246", "7C1327", "KE2119/JL5150", "OZ1165/NH6980",
  "JL091/KE5708", "NH861/OZ9101", "OZ1055/NH6983", "KE2106/JL5245",
  "JL093/KE5710", "NH865/OZ9103", "JL095/KE5712", "KE2104/JL5237",
  "NH867/OZ9127", "OZ1035/NH6969",
  "NH862/OZ9128", "JL090/KE5711", "OZ1085/NH6968", "KE2101/JL5234",
  "JL092/KE5707", "NH864/OZ9102", "JL094/KE5709", "KE2103/JL5236",
  "OZ1065/NH6984", "KE2105/JL5244", "NH868/OZ9104",
];
const GIMPO_ODCLOUD_NAMESPACE = "15003087"; // 한국공항공사_국제선 항공기스케줄

// odcloud는 파일을 새로 올릴 때마다 새 경로(uddi)가 생기는 방식이라, Swagger 문서에서 날짜가 가장 최신인 경로를 매번 찾아야 함
async function fetchOdcloudLatestPath(namespaceId) {
  const res = await fetch(`https://infuser.odcloud.kr/oas/docs?namespace=${namespaceId}/v1`);
  const spec = await res.json();
  let latestPath = null;
  let latestDate = "";
  for (const [p, def] of Object.entries(spec.paths || {})) {
    const summary = def?.get?.summary || "";
    const m = summary.match(/_(\d{8})$/);
    if (m && m[1] > latestDate) {
      latestDate = m[1];
      latestPath = p;
    }
  }
  return latestPath;
}

async function fetchOdcloudAllRecords(fullPath, serviceKey) {
  const perPage = 5000;
  let page = 1;
  let all = [];
  while (true) {
    const url = `https://api.odcloud.kr${fullPath}?page=${page}&perPage=${perPage}&serviceKey=${serviceKey}`;
    const res = await fetch(url);
    const json = await res.json();
    const data = json.data || [];
    all = all.concat(data);
    if (data.length < perPage) break;
    page++;
  }
  return all;
}

async function fetchGimpoTimeLookup(serviceKey) {
  const latestPath = await fetchOdcloudLatestPath(GIMPO_ODCLOUD_NAMESPACE);
  if (!latestPath) return {};
  const records = await fetchOdcloudAllRecords(latestPath, serviceKey);
  const map = {};
  for (const rec of records) {
    if (rec.출발공항 !== "GMP" && rec.도착공항 !== "GMP") continue;
    if (!map[rec.운항편명]) {
      map[rec.운항편명] = `${rec.출발시간}-${rec.도착시간}`;
    }
  }
  return map;
}

function getCodes(entry) {
  const stripped = entry.replace(/\([^)]*\)/g, "");
  return stripped.split("/").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function addMinutesToTime(hhmm, deltaMin) {
  const [h, m] = hhmm.split(":").map(Number);
  let total = ((h * 60 + m + deltaMin) % 1440 + 1440) % 1440;
  const outH = Math.floor(total / 60);
  const outM = total % 60;
  return `${String(outH).padStart(2, "0")}:${String(outM).padStart(2, "0")}`;
}

// 기존 파일에서 편명 -> 시간 매핑을 읽어와 이번 회차에 API 매칭이 안 된 편명의 대체값(fallback)으로 씀
function readExistingMap() {
  if (!fs.existsSync(OUT_PATH)) return {};
  const content = fs.readFileSync(OUT_PATH, "utf8");
  const map = {};
  const re = /"([A-Z0-9]+)":\s*"(\d{1,2}:\d{2}-\d{1,2}:\d{2})"/g;
  let match;
  while ((match = re.exec(content))) {
    map[match[1]] = match[2];
  }
  return map;
}

async function fetchFlights(operation) {
  const url = `http://apis.data.go.kr/B551177/StatusOfPassengerFlightsDSOdp/${operation}?serviceKey=${SERVICE_KEY}&type=json&numOfRows=9999&pageNo=1`;
  const res = await fetch(url);
  const data = await res.json();
  const items = data?.response?.body?.items || [];
  const byFlight = {};
  for (const item of items) {
    if (!byFlight[item.flightId]) {
      const t = item.scheduleDateTime.slice(8, 12);
      byFlight[item.flightId] = `${t.slice(0, 2)}:${t.slice(2)}`;
    }
  }
  return byFlight;
}

function resolveGroupTime(codes, lookup) {
  for (const code of codes) {
    if (lookup[code]) return lookup[code];
  }
  return null;
}

async function main() {
  const existingMap = readExistingMap();
  const [arrByFlight, depByFlight, gimpoTimeMap] = await Promise.all([
    fetchFlights("getPassengerArrivalsDSOdp"),
    fetchFlights("getPassengerDeparturesDSOdp"),
    fetchGimpoTimeLookup(SERVICE_KEY).catch((err) => {
      console.error("김포 노선 API 조회 실패, 기존 값 유지:", err.message || err);
      return {};
    }),
  ]);

  const finalMap = {};
  const warnings = [];

  for (const routeInfo of INCHEON_ROUTES) {
    const dur = routeInfo.durationMin;

    for (const entry of routeInfo.inbound) {
      const codes = getCodes(entry);
      const label = codes.join("/");
      const arrTime = resolveGroupTime(codes, arrByFlight);
      if (arrTime) {
        const depTime = addMinutesToTime(arrTime, -dur);
        const range = `${depTime}-${arrTime}`;
        codes.forEach((c) => { finalMap[c] = range; });
      } else {
        const fallback = codes.map((c) => existingMap[c]).find(Boolean);
        if (fallback) {
          codes.forEach((c) => { finalMap[c] = fallback; });
          warnings.push(`${label} (입국): API 매칭 안됨 — 기존 값 유지`);
        } else {
          warnings.push(`${label} (입국): API 매칭 안됨, 기존 값도 없음 — 수동 확인 필요`);
        }
      }
    }

    for (const entry of routeInfo.outbound) {
      const codes = getCodes(entry);
      const label = codes.join("/");
      const depTime = resolveGroupTime(codes, depByFlight);
      if (depTime) {
        const arrTime = addMinutesToTime(depTime, dur);
        const range = `${depTime}-${arrTime}`;
        codes.forEach((c) => { finalMap[c] = range; });
      } else {
        const fallback = codes.map((c) => existingMap[c]).find(Boolean);
        if (fallback) {
          codes.forEach((c) => { finalMap[c] = fallback; });
          warnings.push(`${label} (출국): API 매칭 안됨 — 기존 값 유지`);
        } else {
          warnings.push(`${label} (출국): API 매칭 안됨, 기존 값도 없음 — 수동 확인 필요`);
        }
      }
    }
  }

  for (const entry of GIMPO_ROUTE_ENTRIES) {
    const codes = getCodes(entry);
    const label = codes.join("/");
    const range = resolveGroupTime(codes, gimpoTimeMap);
    if (range) {
      codes.forEach((c) => { finalMap[c] = range; });
    } else {
      const fallback = codes.map((c) => existingMap[c]).find(Boolean);
      if (fallback) {
        codes.forEach((c) => { finalMap[c] = fallback; });
        warnings.push(`${label} (김포): API 매칭 안됨 — 기존 값 유지`);
      } else {
        warnings.push(`${label} (김포): API 매칭 안됨, 기존 값도 없음 — 수동 확인 필요`);
      }
    }
  }

  if (warnings.length > 0) {
    console.log("=== 경고 ===");
    warnings.forEach((w) => console.log(w));
  }
  console.log(`총 ${Object.keys(finalMap).length}개 편명 코드 매핑 완료`);

  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "/* ============================================",
    "   항공편 번호 -> 출발-도착 시간 (자동 생성 파일 — 직접 수정하지 마세요)",
    "   인천 노선: 인천국제공항공사 공공데이터(여객편 운항현황)에서 인천 쪽 실제 시간을 매달 자동으로 가져오고,",
    "   반대편(일본 공항) 시간은 노선별 평균 비행시간으로 계산해서 채움.",
    "   김포 노선: 한국공항공사_국제선 항공기스케줄(공공데이터활용지원센터)에서 출발-도착 시간을 그대로 가져옴.",
    "   둘 다 scripts/update-flight-schedule.js에서 GitHub Actions로 매달 1일 자동 실행.",
    `   마지막 갱신: ${today}`,
    "   ============================================ */",
    "",
    "const FLIGHT_TIME_MAP = {",
    ...Object.keys(finalMap).map((key) => `  "${key}": "${finalMap[key]}",`),
    "};",
    "",
    "function timeRangeForFlight(flightNo) {",
    '  return FLIGHT_TIME_MAP[(flightNo || "").toUpperCase()] || null;',
    "}",
    "",
  ];

  fs.writeFileSync(OUT_PATH, lines.join("\n"), "utf8");
  console.log(`Saved: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
