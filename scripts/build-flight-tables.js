/* ============================================
   월간 항공 스케줄표(이미지용 데이터) 만들기 — LCC 제외, 비즈니스석 있는 대형항공사 운항편만
   GitHub Actions(.github/workflows/build-flight-tables.yml)에서 매달 1일 실행됨.

   인천: 인천국제공항공사 여객편 운항현황 — 오늘부터 7일치 운항을 주므로 요일 표시까지 만든다.
         인천 쪽 시간만 주기 때문에 일본 쪽 시간은 편명별 비행시간(FLIGHT_DURATION_MIN)으로 계산.
   김포: 한국공항공사 국제선 스케줄 — 출발·도착 시간과 운항요일을 그대로 쓴다.

   사용법:
     node scripts/build-flight-tables.js                 # API 조회 → flight-tables/tables.json
     node scripts/build-flight-tables.js --save-raw r.json   # 받은 원본도 저장 (개발용)
     node scripts/build-flight-tables.js --from-raw r.json   # API 없이 저장해둔 원본으로 (개발용)
   ============================================ */

const fs = require("fs");
const path = require("path");

const SERVICE_KEY = process.env.DATA_GO_KR_SERVICE_KEY;
const OUT_DIR = path.join(__dirname, "..", "flight-tables");
const GIMPO_ODCLOUD_NAMESPACE = "15003087"; // 한국공항공사_국제선 항공기스케줄 (update-flight-schedule.js와 같은 데이터셋)

// 비즈니스석이 있는 대형항공사(운항사 기준). 여기 없는 항공사(LCC 등)는 표에서 뺀다.
const FULL_SERVICE = new Set(["KE", "OZ", "JL", "NH", "ET"]);
// 코드셰어 상대 편명으로 적어줄 항공사 (표에 "KE744/JL5217"처럼 하나만 붙임)
const PARTNER_PREFERENCE = ["JL", "NH", "KE", "OZ"];

const JAPAN = {
  NRT: { ja: "成田" },
  HND: { ja: "羽田" },
  NGO: { ja: "名古屋" },
  KIX: { ja: "大阪" },
  UKB: { ja: "神戸" },
  FUK: { ja: "福岡" },
};
const KOREA_JA = { ICN: "仁川", GMP: "金浦" };

// 노선 기본 비행시간(분) — 편명별 값이 없을 때만 씀
const ROUTE_DURATION_MIN = { NRT: 150, HND: 150, NGO: 120, KIX: 115, UKB: 110, FUK: 90 };

// 편명별 실제 비행시간(분). 여행사 스케줄표(2026-08-17 UPDATE)의 출발·도착 시간에서 계산.
// 같은 노선이라도 항공사·편마다 5~20분씩 달라서 노선 평균보다 이 값이 정확하다.
const FLIGHT_DURATION_MIN = {
  // 나고야
  KE744: 125, OZ121: 120, KE742: 120, OZ123: 115,
  OZ122: 105, KE741: 115, OZ124: 110, KE743: 120,
  // 후쿠오카
  KE788: 85, KE792: 100, OZ133: 100, KE796: 95, KE782: 90,
  KE787: 85, KE791: 85, OZ134: 90, KE795: 90, KE781: 85,
  // 나리타
  OZ107: 150, KE706: 145, OZ101: 155, KE704: 150, KE712: 160, OZ105: 150, ET673: 145, KE714: 150,
  OZ102: 145, KE703: 150, KE711: 155, OZ106: 160, ET672: 145, KE713: 150, OZ108: 150, KE705: 150,
  // 하네다(인천)
  OZ177: 160, KE752: 170, KE751: 140, OZ178: 140,
  // 오사카(인천)
  OZ117: 120, KE738: 120, KE722: 110, OZ115: 125, OZ111: 130, KE724: 110, KE726: 110, OZ113: 115,
  OZ112: 125, KE723: 105, KE725: 120, OZ114: 110, KE721: 120, OZ116: 120, OZ118: 110, KE737: 110,
  // 고베
  KE2172: 110, KE2174: 115, KE2171: 110, KE2173: 110,
};

// 표 이미지 3장 — 첨부받은 여행사 표와 같은 묶음
const PAGES = [
  { file: "table-1", blocks: [["ICN", "NGO"], ["ICN", "FUK"]] },
  { file: "table-2", blocks: [["ICN", "NRT"], ["ICN", "HND"], ["GMP", "HND"]] },
  { file: "table-3", blocks: [["ICN", "KIX"], ["GMP", "KIX"], ["ICN", "UKB"]] },
];

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"]; // Date.getDay() 순서
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 표기 순서: 월~일

const airlineOf = (code) => code.slice(0, 2);
const isRegularCode = (code) => /^[A-Z0-9]{2}\d+$/.test(code); // "JL95A" 같은 부정기편 제외
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (min) => {
  const v = ((min % 1440) + 1440) % 1440;
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; // 표처럼 "9:15" (앞자리 0 없음)
};
const normTime = (t) => fromMin(toMin(t));

function weekdayOf(yyyymmdd) {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)));
  return d.getUTCDay();
}

// 운항 요일 집합 -> "(月以外)" / "(火のみ)" / "(水/木/金/土)" / "" (매일)
function dayNote(days) {
  if (days.size >= 7) return "";
  const ordered = WEEK_ORDER.filter((d) => days.has(d));
  if (days.size === 6) return `(${WEEKDAY_JA[WEEK_ORDER.find((d) => !days.has(d))]}以外)`;
  if (days.size === 1) return `(${WEEKDAY_JA[ordered[0]]}のみ)`;
  return `(${ordered.map((d) => WEEKDAY_JA[d]).join("/")})`;
}

function pickPartner(code, partners) {
  const own = airlineOf(code);
  for (const al of PARTNER_PREFERENCE) {
    if (al === own) continue;
    const p = [...partners].filter((c) => airlineOf(c) === al).sort()[0];
    if (p) return p;
  }
  return null;
}

/* ---------------- 데이터 받기 ---------------- */

async function fetchJson(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function fetchIncheon(operation) {
  const url = `https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDSOdp/${operation}?serviceKey=${SERVICE_KEY}&type=json&numOfRows=9999&pageNo=1`;
  const data = await fetchJson(url);
  return data?.response?.body?.items || [];
}

// 데이터셋이 날짜별 파일로 올라오므로 가장 최근 파일을 고른다 (update-flight-schedule.js와 같은 방식)
async function fetchGimpo() {
  const spec = await fetchJson(`https://infuser.odcloud.kr/oas/docs?namespace=${GIMPO_ODCLOUD_NAMESPACE}/v1`);
  let latestPath = null;
  let latestDate = "";
  for (const [p, def] of Object.entries(spec.paths || {})) {
    const m = (def?.get?.summary || "").match(/_(\d{8})$/);
    if (m && m[1] > latestDate) {
      latestDate = m[1];
      latestPath = p;
    }
  }
  if (!latestPath) return [];
  const fullPath = `${spec.basePath || ""}${latestPath}`;
  const rows = [];
  for (let page = 1; page < 50; page++) {
    const data = await fetchJson(`https://api.odcloud.kr${fullPath}?page=${page}&perPage=5000&serviceKey=${SERVICE_KEY}`);
    rows.push(...(data.data || []));
    if (!data.data || data.data.length < 5000) break;
  }
  console.log(`김포 데이터셋 ${latestDate}자 — ${rows.length}건`);
  return rows;
}

/* ---------------- 인천: 7일치 운항현황 → 표 ---------------- */

function buildIncheon(arrivals, departures) {
  const all = [...arrivals, ...departures];
  // 앞뒤로 몇 건만 걸친 날짜(전날 늦은 도착 등)는 빼고, 하루치가 제대로 있는 날짜만 쓴다
  const perDay = {};
  all.forEach((it) => {
    const d = String(it.scheduleDateTime || "").slice(0, 8);
    perDay[d] = (perDay[d] || 0) + 1;
  });
  const fullDays = new Set(Object.keys(perDay).filter((d) => perDay[d] >= 300));
  console.log(`인천 사용 날짜: ${[...fullDays].sort().join(", ")}`);

  const result = {}; // "ICN-NGO" -> { in: rows, out: rows }
  const unknownDuration = new Set();

  for (const [items, dir] of [[arrivals, "in"], [departures, "out"]]) {
    const operating = new Map(); // code -> Map(time -> Set(weekday))
    const airportOf = new Map();
    const partners = new Map(); // master code -> Set(partner codes)
    for (const it of items) {
      const code = String(it.flightId || "").trim().toUpperCase();
      const apt = String(it.airportCode || "").trim().toUpperCase();
      const dt = String(it.scheduleDateTime || "");
      if (!code || !JAPAN[apt] || !fullDays.has(dt.slice(0, 8)) || !isRegularCode(code)) continue;
      const master = String(it.masterflightid || "").trim().toUpperCase();
      const isCodeshare = /^Y$/i.test(String(it.codeshare || "").trim()) || (!!master && master !== code);
      if (isCodeshare) {
        if (master) {
          if (!partners.has(master)) partners.set(master, new Set());
          partners.get(master).add(code);
        }
        continue;
      }
      if (!FULL_SERVICE.has(airlineOf(code))) continue;
      const time = `${dt.slice(8, 10)}:${dt.slice(10, 12)}`;
      if (!operating.has(code)) operating.set(code, new Map());
      const byTime = operating.get(code);
      if (!byTime.has(time)) byTime.set(time, new Set());
      byTime.get(time).add(weekdayOf(dt.slice(0, 8)));
      airportOf.set(code, apt);
    }

    for (const [code, byTime] of operating) {
      const apt = airportOf.get(code);
      const key = `ICN-${apt}`;
      if (!result[key]) result[key] = { in: [], out: [] };
      const partner = pickPartner(code, partners.get(code) || []);
      let dur = FLIGHT_DURATION_MIN[code];
      if (!dur) {
        dur = ROUTE_DURATION_MIN[apt];
        unknownDuration.add(code);
      }
      for (const [time, days] of byTime) {
        const icn = toMin(time);
        const [dep, arr] = dir === "in" ? [icn - dur, icn] : [icn, icn + dur];
        result[key][dir].push({
          label: `${code}${partner ? "/" + partner : ""}${dayNote(days)}`,
          dep: fromMin(dep),
          arr: fromMin(arr),
          sortKey: dir === "in" ? (dep + 1440) % 1440 : dep,
        });
      }
    }
  }
  if (unknownDuration.size) console.log(`비행시간 미등록(노선 평균 사용): ${[...unknownDuration].sort().join(", ")}`);
  return result;
}

/* ---------------- 김포: 스케줄 데이터셋 → 표 ---------------- */

// 운항요일 값을 요일 집합으로. 형식이 문서에 없어 흔한 형태를 모두 받는다.
function parseGimpoDays(raw) {
  const s = String(raw || "").trim();
  const days = new Set();
  const kor = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
  if (/[일월화수목금토]/.test(s)) {
    for (const ch of s) if (ch in kor) days.add(kor[ch]);
    return days;
  }
  if (/^[YN.\- ]{7}$/i.test(s)) {
    // 월~일 순서의 7칸 표시 (Y/N 또는 . -)
    [...s].forEach((ch, i) => { if (/[Y]/i.test(ch)) days.add(WEEK_ORDER[i]); });
    return days;
  }
  for (const ch of s) if (/[1-7]/.test(ch)) days.add(Number(ch) % 7); // 1=월 ... 7=일
  return days;
}

const ymd = (s) => String(s || "").replace(/\D/g, "").slice(0, 8);

function buildGimpo(rows, windowStart, windowEnd) {
  const sample = [...new Set(rows.slice(0, 2000).map((r) => String(r.운항요일)))].slice(0, 15);
  console.log(`김포 운항요일 값 예시: ${JSON.stringify(sample)}`);

  const groups = new Map(); // from|to|dep|arr -> { codes:Set, days:Set }
  for (const r of rows) {
    const from = String(r.출발공항 || "").trim().toUpperCase();
    const to = String(r.도착공항 || "").trim().toUpperCase();
    if (!((from === "GMP" && JAPAN[to]) || (to === "GMP" && JAPAN[from]))) continue;
    const code = String(r.운항편명 || "").trim().toUpperCase();
    if (!isRegularCode(code) || !r.출발시간 || !r.도착시간) continue;
    const start = ymd(r.시작일자);
    const end = ymd(r.종료일자);
    if ((start && start > windowEnd) || (end && end < windowStart)) continue; // 이번 달에 안 다니는 편
    const k = [from, to, normTime(String(r.출발시간)), normTime(String(r.도착시간))].join("|");
    if (!groups.has(k)) groups.set(k, { codes: new Set(), days: new Set() });
    const g = groups.get(k);
    g.codes.add(code);
    parseGimpoDays(r.운항요일).forEach((d) => g.days.add(d));
  }

  const CODESHARE_NUMBER = { KE: /^5\d{3}$/, OZ: /^9\d{3}$/, JL: /^5\d{3}$/, NH: /^[356]\d{3}$/ };
  const result = {};
  for (const [k, g] of groups) {
    const [from, to, dep, arr] = k.split("|");
    const codes = [...g.codes];
    const operatingCode =
      codes.find((c) => !(CODESHARE_NUMBER[airlineOf(c)] && CODESHARE_NUMBER[airlineOf(c)].test(c.slice(2)))) || codes[0];
    if (!FULL_SERVICE.has(airlineOf(operatingCode))) continue;
    const apt = from === "GMP" ? to : from;
    const dir = to === "GMP" ? "in" : "out";
    const key = `GMP-${apt}`;
    if (!result[key]) result[key] = { in: [], out: [] };
    const partner = pickPartner(operatingCode, codes.filter((c) => c !== operatingCode));
    result[key][dir].push({
      label: `${operatingCode}${partner ? "/" + partner : ""}${g.days.size ? dayNote(g.days) : ""}`,
      dep,
      arr,
      sortKey: toMin(dep),
    });
  }
  return result;
}

/* ---------------- 실행 ---------------- */

async function main() {
  const args = process.argv.slice(2);
  const fromRaw = args.includes("--from-raw") ? args[args.indexOf("--from-raw") + 1] : null;
  const saveRaw = args.includes("--save-raw") ? args[args.indexOf("--save-raw") + 1] : null;

  let raw;
  if (fromRaw) {
    raw = JSON.parse(fs.readFileSync(fromRaw, "utf8"));
  } else {
    if (!SERVICE_KEY) throw new Error("DATA_GO_KR_SERVICE_KEY 가 없어요");
    const [arrivals, departures, gimpo] = await Promise.all([
      fetchIncheon("getPassengerArrivalsDSOdp"),
      fetchIncheon("getPassengerDeparturesDSOdp"),
      fetchGimpo().catch((err) => {
        console.error("김포 조회 실패:", err.message || err);
        return [];
      }),
    ]);
    raw = { fetchedAt: new Date().toISOString(), arrivals, departures, gimpo };
    if (saveRaw) fs.writeFileSync(saveRaw, JSON.stringify(raw));
  }

  // 한국 시간 기준 오늘 ~ 6일 뒤 (인천 7일치와 같은 기간의 김포 스케줄을 고름)
  const now = new Date(new Date(raw.fetchedAt).getTime() + 9 * 3600 * 1000);
  const plus6 = new Date(now.getTime() + 6 * 86400 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

  const incheon = buildIncheon(raw.arrivals, raw.departures);
  const gimpo = buildGimpo(raw.gimpo, fmt(now), fmt(plus6));
  const routes = { ...incheon, ...gimpo };

  const pages = PAGES.map((p) => ({
    file: p.file,
    blocks: p.blocks
      .map(([korea, japan]) => {
        const r = routes[`${korea}-${japan}`] || { in: [], out: [] };
        const sort = (rows) => rows.sort((a, b) => a.sortKey - b.sortKey).map(({ label, dep, arr }) => ({ label, dep, arr }));
        return {
          inTitle: `${JAPAN[japan].ja} → ${KOREA_JA[korea]}`,
          outTitle: `${KOREA_JA[korea]} ⇒ ${JAPAN[japan].ja}`,
          inRows: sort(r.in),
          outRows: sort(r.out),
        };
      })
      .filter((b) => b.inRows.length || b.outRows.length),
  }));

  const updated = `${now.getUTCMonth() + 1}/${now.getUTCDate()}`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = { updated, generatedAt: raw.fetchedAt, pages };
  fs.writeFileSync(path.join(OUT_DIR, "tables.json"), JSON.stringify(out, null, 2));
  pages.forEach((p) =>
    p.blocks.forEach((b) => console.log(`${p.file} ${b.inTitle} ${b.inRows.length}편 / ${b.outTitle} ${b.outRows.length}편`))
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
