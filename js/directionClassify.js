/* ============================================
   항공편 목록 → 입국편/출국편 추정 로직
   calendar.js와 mypage.js 양쪽에서 공용으로 씀 (mypage는 캘린더 렌더링 없이 이 로직만 필요해서 분리)
   ============================================ */

// "KE724" -> 724
function extractFlightNumDigits(flightNo) {
  const m = flightNo.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

// 항공편 번호 짝/홀수 패턴 (대한항공·아시아나 등에서 흔한 규칙): 짝수=입국, 홀수=출국
function patternDirection(entry) {
  const num = extractFlightNumDigits(entry.flightNo);
  if (num === null) return null;
  return num % 2 === 0 ? "입국" : "출국";
}

function travelersKey(travelers) {
  return (travelers || []).map((t) => t.name).sort().join("|");
}

/**
 * 항공편 목록을 같은 동행자 조합끼리 묶어서 입국편/출국편을 추정.
 * 1) 같은 조합 안에서 날짜순 첫 편=입국, 마지막 편=출국 (편이 1건뿐이면 순서로는 판단 안 함)
 * 2) 항공편 번호 짝/홀수 패턴으로 교차 검증
 * 두 기준이 다르면 conflict=true로 표시해서 사용자가 직접 확인하게 함.
 * @param {object[]} entries
 * @returns {Map} entry(객체 참조) -> { direction: "입국"|"출국"|null, conflict: boolean }
 */
function classifyDirections(entries) {
  const result = new Map();
  const buckets = new Map();
  entries.forEach((entry) => {
    const key = travelersKey(entry.travelers);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  });

  buckets.forEach((bucketEntries) => {
    const sorted = [...bucketEntries].sort(
      (a, b) => a.date.localeCompare(b.date) || a.depTime.localeCompare(b.depTime)
    );
    sorted.forEach((entry, idx) => {
      // 항공편 없이 셀인/셀아웃만 등록한 일정 — 사용자가 직접 지정한 방향을 그대로 사용 (추론 불필요)
      if (entry.noFlight) {
        result.set(entry, { direction: entry.direction, conflict: false });
        return;
      }

      // 1순위: 실제 노선표 기반 매핑 (flightDirections.js) — 있으면 그대로 확정, 순서/패턴 추론 안 씀
      const known = FLIGHT_DIRECTION_MAP[entry.flightNo];
      if (known) {
        result.set(entry, { direction: known, conflict: false });
        return;
      }

      const pattern = patternDirection(entry);
      let order = null;
      if (sorted.length >= 2) {
        if (idx === 0) order = "입국";
        else if (idx === sorted.length - 1) order = "출국";
      }
      const conflict = !!(order && pattern && order !== pattern);
      result.set(entry, { direction: order || pattern, conflict });
    });
  });

  return result;
}
