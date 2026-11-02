// 한국공항공사 스케줄 API 진단용 (임시) — 인증키는 로그에 남기지 않는다
const K = process.env.DATA_GO_KR_SERVICE_KEY;
const base = "https://apis.data.go.kr/B551178/flight-schedule/int";
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
(async () => {
  const qs = [
    "schDeptCityCode=GMP&schArrvCityCode=HND",
    "schDeptCityCode=HND&schArrvCityCode=GMP",
    `schDate=${today}&schDeptCityCode=GMP&schArrvCityCode=HND`,
    "schFlightNum=JL091",
    "schFlightNum=JL093",
    "schAirLine=JL",
  ];
  for (const q of qs) {
    try {
      const res = await fetch(`${base}?serviceKey=${K}&pageNo=1&numOfRows=100&type=json&${q}`, { signal: AbortSignal.timeout(30000) });
      const t = await res.text();
      let j = null;
      try { j = JSON.parse(t); } catch {}
      const b = j?.response?.body;
      if (!b) { console.log(`${q} -> ${t.slice(0, 200).replace(/\s+/g, " ")}`); continue; }
      let items = b.items?.item ?? [];
      if (!Array.isArray(items)) items = [items];
      console.log(`${q} -> total ${b.totalCount}`);
      items.slice(0, 40).forEach((it) =>
        console.log(`   ${it.internationalNum} ${it.internationalIoType} ${it.city}(${it.cityCode})-${it.airport}(${it.airportCode}) ${it.internationalTime} ${String(it.internationalStdate).slice(0,10)}~${String(it.internationalEddate).slice(0,10)} ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>it["international"+d]).join("")} ${it.flightPurpose||""}`)
      );
    } catch (e) {
      console.log(`${q} -> 실패 ${e.message}`);
    }
  }
})();
