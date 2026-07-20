/* ============================================
   항공편 검색용 — 한국 공항 ⇄ 일본 공항 노선별 편명 그룹
   js/flightSchedule.js의 FLIGHT_TIME_MAP과 같은 원본 노선표에서 가져온 편명 목록.
   삿포로는 아직 시간표 데이터가 없어서 나중에 추가 예정.
   ============================================ */

const KOREA_AIRPORTS = ["인천", "김포"];
const JAPAN_AIRPORTS = ["나리타", "하네다", "나고야", "오사카", "고베", "후쿠오카"]; // 삿포로는 데이터 없어서 아직 제외

// 비즈니스석을 운영하는 항공사. 대형항공사(KE/OZ/NH/JL) 외에
// 제주항공(7C, "비즈니스 라이트"), 진에어(LJ, 보유 기종 전체),
// 티웨이(TW, A330 기종 취항 노선 — 인천-오사카 포함, 2026.1 기준)도 비즈니스석을 운영해서 포함.
// 그 외(에어부산/에어서울/에어프레미아/이스타/에어로케이/파라타 등)는 확인 결과 비즈니스석이 없거나
// 확인이 안 돼서 이코노미 전용으로 취급 (실제 기종/시기별로 달라질 수 있어 참고용입니다).
const BUSINESS_CLASS_AIRLINES = new Set(["KE", "OZ", "NH", "JL", "7C", "LJ", "TW"]);

function airlineCodeOfFlight(flightNo) {
  return (flightNo || "").toUpperCase().slice(0, 2);
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
  const route = FLIGHT_ROUTES.find((r) => r.korea === korea && r.japan === japan);
  if (!route) return [];

  const groups = isFromKorea ? route.outbound : route.inbound;
  return groups
    .map((entry) => {
      const primary = entry.split("/")[0];
      const range = typeof timeRangeForFlight === "function" ? timeRangeForFlight(primary) : null;
      const classLabel = hasBusinessClass(entry) ? "CY" : "Y";
      return { label: entry, range, classLabel };
    })
    .filter((r) => r.range)
    .sort((a, b) => a.range.localeCompare(b.range));
}
