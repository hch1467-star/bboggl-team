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

// 인천 노선 중 아래 목록에 없는 편도 놓치지 않도록, 상대 공항 코드별 평균 비행시간을 따로 둔다.
// (인천 API는 인천 쪽 시간만 주기 때문에 반대편 시간을 계산하려면 비행시간이 필요함)
const ICN_AIRPORT_DURATION_MIN = {
  KIX: 110, // 오사카
  UKB: 110, // 고베
  NGO: 120, // 나고야
  FUK: 85,  // 후쿠오카
  NRT: 150, // 나리타
  HND: 150, // 하네다
  CTS: 170, // 삿포로
};

// 인천 API 응답에서 상대 공항 코드가 담기는 필드명이 문서마다 조금씩 달라서 후보를 순서대로 확인
const ICN_AIRPORT_FIELDS = ["airportCode", "airport", "airportcode", "arrivedKor", "boardingKor"];

// 공항 코드 -> 앱에서 쓰는 한글 이름 (js/flightRoutes.js의 JAPAN_AIRPORTS와 같은 표기)
const AIRPORT_NAME = {
  ICN: "인천",
  GMP: "김포",
  NRT: "나리타",
  HND: "하네다",
  KIX: "오사카",
  UKB: "고베",
  NGO: "나고야",
  FUK: "후쿠오카",
  CTS: "삿포로",
};

// 김포 노선 — 한국공항공사_국제선 항공기스케줄(공공데이터활용지원센터, api.odcloud.kr)
// 이 데이터셋은 인천 API와 달리 출발/도착 시간을 한 번에 다 주기 때문에 반대편 시간을 따로 계산할 필요 없음.
// API가 주는 김포 국제선은 전부 담고, 아래 목록은 "이건 반드시 있어야 한다"는 확인용으로만 쓴다.
const GIMPO_EXPECTED_ENTRIES = [
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

// odcloud는 파일을 새로 올릴 때마다 새 경로(uddi)가 생기는 방식이라, Swagger 문서에서 날짜가 가장 최신인 경로를 매번 찾아야 함.
// 주의: Swagger의 paths에는 basePath("/api")가 빠져 있어서 그대로 쓰면 404가 난다. 반드시 basePath를 앞에 붙여야 함.
async function fetchOdcloudLatestPath(namespaceId) {
  const res = await fetch(`https://infuser.odcloud.kr/oas/docs?namespace=${namespaceId}/v1`);
  if (!res.ok) throw new Error(`Swagger 조회 실패 (HTTP ${res.status})`);
  const spec = await res.json();
  const basePath = spec.basePath || "";
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
  if (!latestPath) return null;
  console.log(`김포 데이터셋: ${latestDate}자 파일 사용`);
  return `${basePath}${latestPath}`;
}

async function fetchOdcloudAllRecords(fullPath, serviceKey) {
  const perPage = 5000;
  let page = 1;
  let all = [];
  while (true) {
    const url = `https://api.odcloud.kr${fullPath}?page=${page}&perPage=${perPage}&serviceKey=${serviceKey}`;
    const res = await fetch(url);
    // 예전엔 404/401이 나도 그냥 빈 배열로 넘어가서, 김포가 통째로 안 채워지는 걸 몇 달간 못 알아챘음.
    // 이제는 실패하면 확실히 멈추고 로그에 남긴다.
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`김포 데이터 조회 실패 (HTTP ${res.status}) ${url.replace(serviceKey, "***")} ${body.slice(0, 200)}`);
    }
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
  console.log(`김포 API 응답 ${records.length}건`);
  const map = {};
  for (const rec of records) {
    const from = String(rec.출발공항 || "").trim().toUpperCase();
    const to = String(rec.도착공항 || "").trim().toUpperCase();
    if (from !== "GMP" && to !== "GMP") continue;
    const code = String(rec.운항편명 || "").trim().toUpperCase();
    if (!code || !rec.출발시간 || !rec.도착시간) continue;
    if (map[code]) continue;
    // 김포 도착이면 입국, 김포 출발이면 출국. 상대편 공항이 곧 일본(또는 해외) 공항.
    const inbound = to === "GMP";
    map[code] = {
      range: `${rec.출발시간}-${rec.도착시간}`,
      korea: "김포",
      japan: AIRPORT_NAME[inbound ? from : to] || null,
      direction: inbound ? "입국" : "출국",
    };
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

// 이전 실행에서 저장해둔 공항/방향 정보 — API가 이번에 못 준 편의 값을 잃지 않도록 읽어둔다
function readExistingRouteMap() {
  if (!fs.existsSync(OUT_PATH)) return {};
  const content = fs.readFileSync(OUT_PATH, "utf8");
  const section = content.split("const FLIGHT_ROUTE_INFO = {")[1];
  if (!section) return {};
  const map = {};
  const re = /"([A-Z0-9]+)":\s*\{\s*korea:\s*"([^"]*)",\s*japan:\s*(null|"[^"]*"),\s*direction:\s*"([^"]*)"\s*\}/g;
  let match;
  while ((match = re.exec(section))) {
    map[match[1]] = {
      korea: match[2],
      japan: match[3] === "null" ? null : match[3].slice(1, -1),
      direction: match[4],
    };
  }
  return map;
}

// 응답에서 상대 공항 코드(IATA 3글자)를 찾아본다. 못 찾으면 null (그 편은 자동 추가 대상에서 빠짐)
function pickAirportCode(item) {
  for (const field of ICN_AIRPORT_FIELDS) {
    const raw = item[field];
    if (typeof raw !== "string") continue;
    const code = raw.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) return code;
  }
  return null;
}

async function fetchFlights(operation) {
  const url = `http://apis.data.go.kr/B551177/StatusOfPassengerFlightsDSOdp/${operation}?serviceKey=${SERVICE_KEY}&type=json&numOfRows=9999&pageNo=1`;
  const res = await fetch(url);
  const data = await res.json();
  const items = data?.response?.body?.items || [];
  const byFlight = {};
  for (const item of items) {
    const code = String(item.flightId || "").trim().toUpperCase();
    if (!code || !item.scheduleDateTime) continue;
    if (!byFlight[code]) {
      const t = String(item.scheduleDateTime).slice(8, 12);
      byFlight[code] = { time: `${t.slice(0, 2)}:${t.slice(2)}`, airport: pickAirportCode(item) };
    }
  }
  return byFlight;
}

function resolveGroupTime(codes, lookup) {
  for (const code of codes) {
    if (lookup[code]) return lookup[code].time;
  }
  return null;
}

async function main() {
  const existingMap = readExistingMap();
  const existingRouteMap = readExistingRouteMap();
  const [arrByFlight, depByFlight, gimpoTimeMap] = await Promise.all([
    fetchFlights("getPassengerArrivalsDSOdp"),
    fetchFlights("getPassengerDeparturesDSOdp"),
    fetchGimpoTimeLookup(SERVICE_KEY).catch((err) => {
      console.error("김포 노선 API 조회 실패, 기존 값 유지:", err.message || err);
      return {};
    }),
  ]);

  const finalMap = {};
  // 편명 -> { korea, japan, direction } — 리무진 텍스트(공항)·캘린더(입출국)·항공검색에서 같이 씀
  const routeMap = {};
  const warnings = [];
  const setRoute = (code, korea, japan, direction) => {
    routeMap[code] = { korea, japan: japan || null, direction };
  };

  for (const routeInfo of INCHEON_ROUTES) {
    const dur = routeInfo.durationMin;

    for (const entry of routeInfo.inbound) {
      const codes = getCodes(entry);
      const label = codes.join("/");
      const arrTime = resolveGroupTime(codes, arrByFlight);
      if (arrTime) {
        const depTime = addMinutesToTime(arrTime, -dur);
        const range = `${depTime}-${arrTime}`;
        codes.forEach((c) => { finalMap[c] = range; setRoute(c, "인천", routeInfo.route, "입국"); });
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
        codes.forEach((c) => { finalMap[c] = range; setRoute(c, "인천", routeInfo.route, "출국"); });
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

  // 인천 — 위 노선표에 없는 편이라도 상대 공항 비행시간을 아는 곳이면 자동으로 채운다.
  // (예전에는 노선표에 적힌 편명만 넣어서, 신규 취항·증편된 편이 통째로 빠졌음)
  let icnAutoAdded = 0;
  for (const [source, sign] of [[arrByFlight, -1], [depByFlight, 1]]) {
    for (const [code, info] of Object.entries(source)) {
      if (finalMap[code] || !info.airport) continue;
      const dur = ICN_AIRPORT_DURATION_MIN[info.airport];
      if (!dur) continue;
      const other = addMinutesToTime(info.time, sign * dur);
      finalMap[code] = sign < 0 ? `${other}-${info.time}` : `${info.time}-${other}`;
      setRoute(code, "인천", AIRPORT_NAME[info.airport], sign < 0 ? "입국" : "출국");
      icnAutoAdded++;
    }
  }

  // 김포 — API가 주는 김포 국제선을 전부 담는다 (출발/도착 시간을 둘 다 주기 때문에 그대로 쓰면 됨)
  let gimpoAdded = 0;
  for (const [code, info] of Object.entries(gimpoTimeMap)) {
    if (!finalMap[code]) gimpoAdded++;
    finalMap[code] = info.range;
    setRoute(code, info.korea, info.japan, info.direction);
  }

  // 예전부터 쓰던 김포 편명이 통째로 사라지지 않았는지 확인만 한다
  for (const entry of GIMPO_EXPECTED_ENTRIES) {
    const codes = getCodes(entry);
    if (codes.some((c) => finalMap[c])) continue;
    const fallback = codes.map((c) => existingMap[c]).find(Boolean);
    if (fallback) {
      codes.forEach((c) => { finalMap[c] = fallback; });
      warnings.push(`${codes.join("/")} (김포): API 매칭 안됨 — 기존 값 유지`);
    } else {
      warnings.push(`${codes.join("/")} (김포): API 매칭 안됨, 기존 값도 없음 — 수동 확인 필요`);
    }
  }

  // API가 이번에 못 준 편이라도 기존 시간표에 있던 값은 남겨둔다 (조회 실패로 데이터가 줄어드는 걸 방지)
  let keptFromExisting = 0;
  for (const [code, range] of Object.entries(existingMap)) {
    if (!finalMap[code]) {
      finalMap[code] = range;
      keptFromExisting++;
    }
  }
  for (const [code, info] of Object.entries(existingRouteMap)) {
    if (!routeMap[code]) routeMap[code] = info;
  }

  console.log(
    `인천 자동 추가 ${icnAutoAdded}편 / 김포 신규 ${gimpoAdded}편 / 기존 값 유지 ${keptFromExisting}편 / 전체 ${Object.keys(finalMap).length}편`
  );

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
    "// 편명 -> 어느 한국 공항인지 / 상대 일본 공항 / 입국·출국. API 응답에서 같이 받아온 값.",
    "// 수동 관리 파일(flightAirports.js·flightDirections.js·flightRoutes.js)에 없는 편을 보완하는 용도.",
    "const FLIGHT_ROUTE_INFO = {",
    ...Object.keys(routeMap)
      .sort()
      .map((key) => {
        const r = routeMap[key];
        const japan = r.japan ? `"${r.japan}"` : "null";
        return `  "${key}": { korea: "${r.korea}", japan: ${japan}, direction: "${r.direction}" },`;
      }),
    "};",
    "",
    "function routeInfoForFlight(flightNo) {",
    '  return FLIGHT_ROUTE_INFO[(flightNo || "").toUpperCase()] || null;',
    "}",
    "",
  ];

  fs.writeFileSync(OUT_PATH, lines.join("\n"), "utf8");
  console.log(`Saved: ${OUT_PATH}`);

  // 시간표가 실제로 바뀌었으면 HTML의 ?v=숫자도 올려준다.
  // 이걸 안 올리면 브라우저가 예전에 받아둔 시간표를 계속 써서, 새로 채운 편이 앱에 안 보인다.
  const sameRoute = (a, b) => a && b && a.korea === b.korea && a.japan === b.japan && a.direction === b.direction;
  const changed =
    Object.keys(finalMap).length !== Object.keys(existingMap).length ||
    Object.keys(finalMap).some((code) => finalMap[code] !== existingMap[code]) ||
    Object.keys(routeMap).length !== Object.keys(existingRouteMap).length ||
    Object.keys(routeMap).some((code) => !sameRoute(routeMap[code], existingRouteMap[code]));
  if (changed) bumpAssetVersion();
  else console.log("시간표 내용 그대로 — 캐시 버전은 올리지 않음");
}

// index.html 등에 박혀 있는 ?v=숫자를 전부 찾아 가장 큰 값 +1로 맞춘다
function bumpAssetVersion() {
  const root = path.join(__dirname, "..");
  const htmlFiles = fs.readdirSync(root).filter((f) => f.endsWith(".html"));
  let current = 0;
  const contents = {};
  for (const file of htmlFiles) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    contents[file] = text;
    for (const m of text.matchAll(/\?v=(\d+)/g)) {
      current = Math.max(current, Number(m[1]));
    }
  }
  if (!current) return;

  const next = current + 1;
  for (const [file, text] of Object.entries(contents)) {
    const updated = text.replace(/\?v=\d+/g, `?v=${next}`);
    if (updated !== text) fs.writeFileSync(path.join(root, file), updated, "utf8");
  }
  console.log(`캐시 버전 v=${current} -> v=${next} (HTML ${htmlFiles.length}개)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
