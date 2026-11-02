/* ============================================
   김포↔일본 국제선 스케줄 — 한국공항공사_항공기 운항 스케줄 정보_GW (국제선 /int)
   월간 스케줄표(build-flight-tables.js)와 주간 시간표 갱신(update-flight-schedule.js)이 같이 쓴다.

   이 API는 김포 쪽 시간(출발편은 김포 출발, 도착편은 김포 도착)·운항요일·운항기간을 지금 시즌 것까지 준다.
   일본 쪽 시간은 없어서, 한국공항공사 연간 스케줄 데이터셋(양쪽 시간이 다 있음)에서 편명별 비행시간을 구해 계산한다.
   과거 몇 년치 줄이 섞여 오므로 기간으로 거른다.
   ============================================ */

const JAPAN_CODES = ["NRT", "HND", "NGO", "KIX", "UKB", "FUK"];
const DAY_FIELDS = ["internationalSun", "internationalMon", "internationalTue", "internationalWed", "internationalThu", "internationalFri", "internationalSat"]; // Date.getDay() 순서
// 연간 데이터셋에 없는 편을 위한 노선 기본 비행시간(분) — 김포 기준
const GIMPO_ROUTE_DURATION_MIN = { HND: 135, NRT: 150, KIX: 110, UKB: 110, NGO: 120, FUK: 85 };
// 같은 비행기에 붙은 판매용(코드셰어) 번호대
const CODESHARE_NUMBER = { KE: /^5\d{3}$/, OZ: /^9\d{3}$/, JL: /^5\d{3}$/, NH: /^[356]\d{3}$/ };

const toMin = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(-2);
const fromMin = (min) => {
  const v = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};
const ymd = (s) => String(s || "").replace(/\D/g, "").slice(0, 8);
const daysBetween = (a, b) =>
  (Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8)) - Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8))) / 86400000;
const isRegularCode = (code) => /^[A-Z0-9]{2}\d+$/.test(code);
const isCodeshareNumber = (code) => {
  const p = CODESHARE_NUMBER[code.slice(0, 2)];
  return !!(p && p.test(code.slice(2)));
};

async function fetchJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const json = JSON.parse(await res.text());
      if (json?.response?.body) return json.response.body;
    } catch {
      /* 다시 시도 */
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return null;
}

// 김포↔일본 노선(방향별)을 전부 받아온다. 하나도 못 받으면 null
async function fetchKacGimpoJapan(serviceKey) {
  const items = [];
  let ok = 0;
  for (const apt of JAPAN_CODES) {
    for (const [dep, arr] of [["GMP", apt], [apt, "GMP"]]) {
      for (let page = 1; page <= 30; page++) {
        // 한 번에 100줄까지만 받아준다 (1000줄로 요청하면 오류)
        const body = await fetchJson(
          "https://apis.data.go.kr/B551178/flight-schedule/int" +
            `?serviceKey=${serviceKey}&pageNo=${page}&numOfRows=100&type=json&schDeptCityCode=${dep}&schArrvCityCode=${arr}`
        );
        if (!body) break;
        if (page === 1) ok++;
        let list = body.items?.item ?? [];
        if (!Array.isArray(list)) list = list ? [list] : [];
        list.forEach((it) => items.push({ ...it, _apt: apt, _dir: dep === "GMP" ? "out" : "in" }));
        if (list.length < 100) break;
      }
    }
  }
  console.log(`한국공항공사 김포↔일본 스케줄 ${items.length}줄 (노선·방향 ${ok}/${JAPAN_CODES.length * 2})`);
  return ok ? items : null;
}

// 연간 데이터셋(출발·도착 시간 둘 다 있음)에서 편명별 비행시간(분) — 가장 최근 시즌 값
function durationsFromDataset(rows) {
  const best = {};
  for (const r of rows || []) {
    const code = String(r.운항편명 || "").trim().toUpperCase();
    if (!code || !r.출발시간 || !r.도착시간) continue;
    const end = ymd(r.종료일자);
    let d = toMin(String(r.도착시간)) - toMin(String(r.출발시간));
    if (d < 0) d += 1440;
    if (d < 40 || d > 300) continue;
    if (!best[code] || end > best[code].end) best[code] = { end, d };
  }
  return Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.d]));
}

/**
 * 기간(windowStart~windowEnd, YYYYMMDD)에 운항하는 김포↔일본 정기편 목록.
 * 같은 비행기(같은 노선·방향·시간)에 붙은 편명들은 하나로 묶어 운항편 + 코드셰어 편명으로 돌려준다.
 * @returns [{ code, partners, apt, dir:"in"|"out", dep:"HH:MM", arr:"HH:MM", days:Set(0~6) }]
 */
function buildGimpoFlights(items, { windowStart, windowEnd, durations = {}, minPeriodDays = 14, exclude = new Set() }) {
  const groups = new Map();
  for (const it of items) {
    const code = String(it.internationalNum || "").trim().toUpperCase();
    const time = String(it.internationalTime || "").trim();
    const st = ymd(it.internationalStdate);
    const ed = ymd(it.internationalEddate);
    if (!isRegularCode(code) || exclude.has(code) || !/^\d{4}$/.test(time) || !st || !ed) continue;
    if (st > windowEnd || ed < windowStart) continue; // 이 기간에 안 다니는 줄 (과거 시즌 등)
    if (daysBetween(st, ed) < minPeriodDays) continue; // 며칠짜리 줄은 전세기·임시편
    if (it.flightPurpose && !/여객/.test(it.flightPurpose)) continue;
    const key = `${it._apt}|${it._dir}|${time}`;
    if (!groups.has(key)) groups.set(key, { codes: new Set(), days: new Set() });
    const g = groups.get(key);
    g.codes.add(code);
    DAY_FIELDS.forEach((f, i) => {
      if (/^Y$/i.test(String(it[f] || ""))) g.days.add(i);
    });
  }

  const flights = [];
  for (const [key, g] of groups) {
    const [apt, dir, time] = key.split("|");
    const codes = [...g.codes];
    const code = codes.find((c) => !isCodeshareNumber(c)) || codes[0];
    const dur = durations[code] || GIMPO_ROUTE_DURATION_MIN[apt];
    const gmp = toMin(time);
    const [dep, arr] = dir === "out" ? [gmp, gmp + dur] : [gmp - dur, gmp];
    flights.push({
      code,
      partners: codes.filter((c) => c !== code),
      apt,
      dir,
      dep: fromMin(dep),
      arr: fromMin(arr),
      days: g.days,
    });
  }
  return flights;
}

module.exports = { fetchKacGimpoJapan, durationsFromDataset, buildGimpoFlights, JAPAN_CODES };
