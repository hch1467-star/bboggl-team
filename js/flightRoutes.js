/* ============================================
   항공편 검색용 — 한국 공항 ⇄ 일본 공항 노선별 편명 그룹
   js/flightSchedule.js의 FLIGHT_TIME_MAP과 같은 원본 노선표에서 가져온 편명 목록.
   삿포로는 아직 시간표 데이터가 없어서 나중에 추가 예정.
   ============================================ */

const KOREA_AIRPORTS = ["인천", "김포"];
const JAPAN_AIRPORTS = ["나리타", "하네다", "나고야", "오사카", "고베", "후쿠오카"]; // 삿포로는 데이터 없어서 아직 제외

// 비즈니스석을 운영하는 항공사. 대형항공사(KE/OZ/NH/JL) 외에
// 제주항공(7C, "비즈니스 라이트"), 진에어(LJ, 보유 기종 전체),
// 티웨이(TW, A330 기종 취항 노선 — 인천-오사카 포함, 2026.1 기준),
// 에티오피아항공(ET, 인천 경유 나리타행 A350/B787편에 비즈니스석 있음, 2026.7 확인)도 포함.
// 파라타항공(WE)은 인천-나리타 노선(A330-200 "비즈니스 스마트" 좌석)엔 비즈니스석이 있지만,
// 인천-오사카 노선은 소형기(A320) 투입이라 비즈니스석이 없는 것으로 보임(2026.7 확인).
// 이 파일은 노선별이 아니라 항공사 코드 단위로만 CY/Y를 판정하는 구조라, 노선마다 결과가
// 갈리는 WE는 오사카 노선에서 실제로 없는 비즈니스석을 있다고 잘못 안내하지 않도록
// 일단 미포함(이코노미 전용) 처리 — 노선별 판정이 가능해지면 재검토 필요.
// 그 외(에어부산/에어서울/에어프레미아/이스타/에어로케이 등)는 확인 결과 비즈니스석이 없어서
// 이코노미 전용으로 취급 (실제 기종/시기별로 달라질 수 있어 참고용입니다).
const BUSINESS_CLASS_AIRLINES = new Set(["KE", "OZ", "NH", "JL", "7C", "LJ", "TW", "ET"]);

function airlineCodeOfFlight(flightNo) {
  return (flightNo || "").toUpperCase().slice(0, 2);
}

// 저비용항공사(LCC) — 자동으로 새로 발견된 편은 목록에 넣지 않는다.
// 위 FLIGHT_ROUTES에 손으로 적어둔 LCC 편명은 그대로 표시된다(실제 취급하는 노선이라 넣어둔 것).
const LCC_AIRLINES = new Set([
  "7C", "TW", "ZE", "RS", "BX", "LJ", "YP", "RF", "WE", // 국내 LCC
  "MM", "IT", "ZG", "GK", "JW", "TR", "JD", "9C", "AK", "D7", "VJ", // 해외 LCC
]);

// "JL090"과 "JL90"은 같은 편 — 편명 숫자의 앞자리 0을 떼서 비교용 키를 만든다
function flightKey(flightNo) {
  const code = (flightNo || "").replace(/\([^)]*\)/g, "").trim().toUpperCase();
  return code.replace(/^([A-Z0-9]{2})0+(\d)/, "$1$2");
}

// 코드셰어 그룹(예: "KE738/JL5269") 중 하나라도 대형항공사면 비즈니스 좌석 있음으로 판단
function hasBusinessClass(entryLabel) {
  return entryLabel.split("/").some((code) => BUSINESS_CLASS_AIRLINES.has(airlineCodeOfFlight(code)));
}

const FLIGHT_ROUTES = [
  {
    korea: "인천",
    japan: "오사카",
    inbound: [
      "OZ117", "KE738/JL5269", "RF315", "7C1396", "KE722/JL5211", "OZ115/NH6955",
      "RS712", "7C1302", "OZ111/NH6951", "7C1392", "LJ242", "TW302",
      "RS714", "7C1304", "ZE612", "7C1306", "JL234", "LJ237",
      "WE304", "KE724/JL5213", "LJ238", "ZE614", "KE726/JL5215", "OZ113",
    ],
    outbound: [
      "RF316", "OZ112/NH6952", "7C1301", "RS711", "LJ231/KE5071", "7C1391",
      "TW301", "LJ241", "7C1303", "ZE611", "KE723/JL5210", "BX172/OZ9568",
      "7C1305", "TW303", "WE511", "BX174/OZ9570", "RS713", "7C1393",
      "KE725/JL5212", "ZE613", "RS715", "LJ239", "OZ114", "KE721/JL5214",
      "OZ116/NH6956", "OZ118",
    ],
  },
  {
    korea: "인천",
    japan: "고베",
    inbound: ["KE2172", "7C1622", "KE2174"],
    outbound: ["KE2171", "7C1621", "KE2173"],
  },
  {
    korea: "인천",
    japan: "나고야",
    inbound: ["KE744/JL5217", "OZ121/NH6963", "KE742/JL5219", "OZ123/NH6965"],
    outbound: ["OZ122/NH6964", "KE741/JL5216", "OZ124/NH6966", "KE743/JL5218"],
  },
  {
    korea: "인천",
    japan: "후쿠오카",
    inbound: ["OZ131", "KE788/JL5221", "KE792/JL5273", "OZ133/NH6959", "KE796", "LJ272/KE5096", "KE782/JL5225"],
    outbound: ["OZ132", "KE787/JL5220", "KE791/JL5272", "OZ134/NH6960", "KE795", "LJ271/KE5095", "KE781/JL5224"],
  },
  {
    korea: "인천",
    japan: "나리타",
    inbound: [
      "OZ107/NH6977", "KE706/JL5201", "LJ204", "YP732",
      "OZ101/NH6971", "YP734", "KE704/JL5205", "OZ103/NH6973",
      "KE712/JL5251", "YP736", "LJ210/KE5094", "KE708", "LJ212",
      "OZ105/NH6975", "ET673", "KE714/JL5253",
    ],
    outbound: [
      "LJ203", "OZ102/NH6972", "YP731", "YP733", "WE501",
      "KE703/JL5202", "OZ104/NH6974", "KE711/JL5250", "YP735",
      "LJ209/KE5093", "KE707", "OZ106/NH6976", "ET672", "KE713/JL5252",
      "OZ108/NH6978", "KE705/JL5206",
    ],
  },
  {
    korea: "인천",
    japan: "하네다",
    inbound: ["OZ177/NH6895", "KE752/JL5257"],
    outbound: ["KE751/JL5256", "OZ178/NH6896"],
  },
  {
    korea: "김포",
    japan: "오사카",
    inbound: ["OZ1135/NH6957", "KE2118/JL5247", "7C1328", "OZ1155/NH6979", "KE2120/JL5151"],
    outbound: ["OZ1145/NH6958", "KE2117/JL5246", "7C1327", "KE2119/JL5150", "OZ1165/NH6980"],
  },
  {
    korea: "김포",
    japan: "하네다",
    inbound: [
      "JL091/KE5708", "NH861/OZ9101", "OZ1055/NH6983", "KE2106/JL5245",
      "JL093/KE5710", "NH865/OZ9103", "JL095/KE5712", "KE2104/JL5237",
      "NH867/OZ9127", "OZ1035/NH6969",
    ],
    outbound: [
      "NH862/OZ9128", "JL090/KE5711", "OZ1085/NH6968", "KE2101/JL5234",
      "JL092/KE5707", "NH864/OZ9102", "JL094/KE5709", "KE2103/JL5236",
      "OZ1065/NH6984", "KE2105/JL5244", "NH868/OZ9104",
    ],
  },
];

/**
 * @param {string} fromAirport 출발공항
 * @param {string} toAirport 도착공항
 * @returns {Array|null} 편명 목록(시간순), 한국↔일본 조합이 아니면 null, 지원 안 하는 노선이면 빈 배열
 */
function findFlightsForRoute(fromAirport, toAirport) {
  const isFromKorea = KOREA_AIRPORTS.includes(fromAirport);
  const isToKorea = KOREA_AIRPORTS.includes(toAirport);
  if (isFromKorea === isToKorea) return null; // 한국↔한국, 일본↔일본은 지원 안 함

  const korea = isFromKorea ? fromAirport : toAirport;
  const japan = isFromKorea ? toAirport : fromAirport;
  const direction = isFromKorea ? "출국" : "입국";
  const route = FLIGHT_ROUTES.find((r) => r.korea === korea && r.japan === japan);
  // 위 노선표에 없는 조합(예: 김포-나리타)은 실제로 취급하는 정기 노선이 아니다.
  // API에는 전세기가 한두 편 잡히기도 하는데, 그것만으로 노선을 새로 만들지는 않는다.
  if (!route) return [];

  const groups = isFromKorea ? route.outbound : route.inbound;

  const rangeOf = (entry) =>
    typeof timeRangeForFlight === "function" ? timeRangeForFlight(entry.split("/")[0]) : null;

  // 손으로 적어둔 목록에 이미 들어있는 편명과 시간대를 기억해둔다
  const covered = new Set();
  const coveredRanges = new Set();
  groups.forEach((entry) => {
    entry.split("/").forEach((c) => covered.add(flightKey(c)));
    const r = rangeOf(entry);
    if (r) coveredRanges.add(r);
  });

  // 자동 갱신되는 FLIGHT_ROUTE_INFO에서 목록에 없는 편을 찾아 보완한다.
  // 다만 그대로 넣으면 같은 비행기의 코드셰어 편명이 우수수 딸려와 목록이 지저분해지므로,
  // 출발-도착 시간이 같은 것끼리 한 줄로 묶고 아래 경우는 아예 뺀다.
  const bySlot = new Map();
  if (typeof FLIGHT_ROUTE_INFO !== "undefined") {
    for (const [code, info] of Object.entries(FLIGHT_ROUTE_INFO)) {
      if (info.korea !== korea || info.japan !== japan || info.direction !== direction) continue;
      if (covered.has(flightKey(code))) continue; // 이미 목록에 있는 편 (JL090/JL90 같은 표기 차이 포함)
      // "JL95A"처럼 편명 뒤에 문자가 붙은 건 전세기·페리 같은 부정기편이라 예약에 쓰이지 않음
      if (!/^[A-Z0-9]{2}\d+$/.test(code)) continue;
      if (KOREA_AIRPORTS.includes(info.japan)) continue; // 김포↔인천 같은 국내 이동편 제외
      const r = timeRangeForFlight(code);
      if (!r || coveredRanges.has(r)) continue; // 기존 편과 같은 시간대 = 같은 비행기의 코드셰어
      if (!bySlot.has(r)) bySlot.set(r, []);
      bySlot.get(r).push(code);
    }
  }

  const extras = [];
  for (const codes of bySlot.values()) {
    // 그 시간대에 LCC가 하나라도 끼어 있으면 LCC가 운항하는 편 — 새로 추가하지 않는다
    if (codes.some((c) => LCC_AIRLINES.has(airlineCodeOfFlight(c)))) continue;
    extras.push(codes.sort().join("/")); // 같은 비행기의 코드셰어들은 한 줄로
  }

  return [...groups, ...extras]
    .map((entry) => {
      const primary = entry.split("/")[0];
      const range = typeof timeRangeForFlight === "function" ? timeRangeForFlight(primary) : null;
      const classLabel = hasBusinessClass(entry) ? "CY" : "Y";
      return { label: entry, range, classLabel };
    })
    .filter((r) => r.range)
    .sort((a, b) => a.range.localeCompare(b.range));
}
