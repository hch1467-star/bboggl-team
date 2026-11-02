// 한국공항공사 스케줄 API 진단용 (임시) — 인증키는 로그에 남기지 않는다
const K = process.env.DATA_GO_KR_SERVICE_KEY;
const base = "https://apis.data.go.kr/B551178/flight-schedule/int";
(async () => {
  for (const [label, key] of [["원래 키", K], ["인코딩 키", encodeURIComponent(K)]]) {
    for (const q of ["pageNo=1&numOfRows=10&type=xml", "pageNo=1&numOfRows=10", "pageNo=1&numOfRows=10&type=json"]) {
      try {
        const res = await fetch(`${base}?serviceKey=${key}&${q}`, { signal: AbortSignal.timeout(30000) });
        const t = (await res.text()).replace(K, "***").replace(encodeURIComponent(K), "***");
        console.log(`[${label}] ${q} -> HTTP ${res.status}: ${t.slice(0, 400).replace(/\s+/g, " ")}`);
      } catch (e) {
        console.log(`[${label}] ${q} -> 실패 ${e.message}`);
      }
    }
  }
  console.log("키 길이", K.length, "특수문자 포함:", /[+/=%]/.test(K));
})();
