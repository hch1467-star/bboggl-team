/* ============================================
   항공편 번호 → 입국/출국 매핑 (수동 관리)
   *6/10 UPDATE 기준, 사용자가 정리한 일본↔한국 노선표를 그대로 반영.
   코드셰어 번호(JL/NH/OZ9xxx 등)도 같은 방향으로 매핑해둠.
   여기 없는 편명은 calendar.js의 순서+짝홀 추론으로 자동 판단됨.
   ============================================ */

const FLIGHT_DIRECTION_RAW = {
  입국: [
    // 大阪(오사카) → 仁川(인천)
    "OZ117", "KE738/JL5269", "RF315", "7C1396", "KE722/JL5211", "OZ115/NH6955",
    "RS712", "7C1302", "OZ111/NH6951", "7C1392", "LJ242", "TW302",
    "RS714(木以外)", "7C1304", "ZE612", "7C1306", "JL234", "LJ237(火/水以外)",
    "WE304", "KE724/JL5213", "LJ238(火/水以外)", "ZE614", "KE726/JL5215", "OZ113",

    // 大阪 → 金浦(김포)
    "OZ1135/NH6957", "KE2118/JL5247", "7C1328", "OZ1155/NH6979", "KE2120/JL5151",

    // 神戸(고베) → 仁川
    "KE2172", "7C1622(6/11-)", "KE2174",

    // 名古屋(나고야) → 仁川
    "KE744/JL5217", "OZ121/NH6963", "KE742/JL5219", "OZ123/NH6965",

    // 福岡(후쿠오카) → 仁川
    "OZ131", "KE788/JL5221", "KE792/JL5273", "OZ133/NH6959", "KE796",
    "LJ272/KE5096", "KE782/JL5225",

    // 成田(나리타) → 仁川
    "OZ107/NH6977", "KE706/JL5201", "LJ204(월금토/6·8-)", "YP732(화이외)",
    "OZ101/NH6971", "YP734(화만)", "KE704/JL5205", "OZ103/NH6973",
    "KE712/JL5251", "YP736(목금토)", "LJ210/KE5094", "KE708", "LJ212(월금토)",
    "OZ105/NH6975", "ET673(수금토)", "KE714/JL5253",

    // 羽田(하네다) → 仁川
    "OZ177/NH6895", "KE752/JL5257",

    // 羽田 → 金浦
    "JL091/KE5708", "NH861/OZ9101", "OZ1055/NH6983", "KE2106/JL5245",
    "JL093/KE5710", "NH865/OZ9103", "JL095/KE5712", "KE2104/JL5237",
    "NH867/OZ9127", "OZ1035/NH6969",
  ],
  출국: [
    // 仁川 → 大阪
    "RF316", "OZ112/NH6952", "7C1301", "RS711", "LJ231/KE5071", "7C1391",
    "TW301", "LJ241", "7C1303", "ZE611", "KE723/JL5210", "BX172/OZ9568",
    "7C1305", "TW303", "WE511", "BX174/OZ9570", "RS713(木以外)", "7C1393",
    "KE725/JL5212", "ZE613", "RS715", "LJ239", "OZ114", "KE721/JL5214",
    "OZ116/NH6956", "OZ118",

    // 金浦 → 大阪
    "OZ1145/NH6958", "KE2117/JL5246", "7C1327", "OZ1165/NH6980", "KE2119/JL5150",

    // 仁川 → 神戸
    "KE2171", "7C1621(6/11-)", "KE2173",

    // 仁川 → 名古屋
    "OZ122/NH6964", "KE741/JL5216", "OZ124/NH6966", "KE743/JL5218",

    // 仁川 → 福岡
    "OZ132", "KE787/JL5220", "KE791/JL5272", "OZ134/NH6960", "KE795",
    "LJ271/KE5095", "KE781/JL5224",

    // 仁川 → 成田
    "LJ203(월/금/토/일)", "OZ102/NH6972", "YP731(화이외)", "YP733(화만)", "WE501",
    "KE703/JL5202", "OZ104/NH6974", "KE711/JL5250", "YP735(목금토)",
    "LJ209/KE5093", "KE707", "OZ106/NH6976", "ET672(수금토)", "KE713/JL5252",
    "OZ108/NH6978", "KE705/JL5206",

    // 仁川 → 羽田
    "KE751/JL5256", "OZ178/NH6896",

    // 金浦 → 羽田
    "NH862/OZ9128", "JL090/KE5711", "OZ1085/NH6968", "KE2101/JL5234",
    "JL092/KE5707", "NH864/OZ9102", "JL094/KE5709", "KE2103/JL5236",
    "KE2105/JL5244", "OZ1065/NH6984", "NH868/OZ9104",
  ],
};

const FLIGHT_DIRECTION_MAP = {};
Object.entries(FLIGHT_DIRECTION_RAW).forEach(([direction, list]) => {
  list.forEach((entry) => {
    entry.split("/").forEach((code) => {
      const clean = code.replace(/\([^)]*\)/g, "").trim().toUpperCase();
      if (clean) FLIGHT_DIRECTION_MAP[clean] = direction;
    });
  });
});

// 위 수동 표에 없는 편명은 자동 생성 파일(flightSchedule.js)의 FLIGHT_ROUTE_INFO에서 찾는다.
// 여기서도 못 찾으면 null을 돌려주고, 호출부가 기존처럼 순서·짝홀로 추론한다.
function knownDirectionForFlight(flightNo) {
  const code = (flightNo || "").toUpperCase();
  if (FLIGHT_DIRECTION_MAP[code]) return FLIGHT_DIRECTION_MAP[code];
  if (typeof FLIGHT_ROUTE_INFO !== "undefined" && FLIGHT_ROUTE_INFO[code]) {
    return FLIGHT_ROUTE_INFO[code].direction;
  }
  return null;
}
