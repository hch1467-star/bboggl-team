/* ============================================
   카톡 텍스트 → 일정 파싱 로직

   빈 줄로 구분된 "블록" 여러 개 = 하나의 일행(파티).
   블록마다 자기만의 동행자·항공편을 가질 수 있음 (항공편이 서로 달라도 OK).

   예시 1 (단독 고객):
   SMITH/JOHN MR
   7/24 KE724 1235-1425 COK

   예시 2 (일행, 항공편 공유):
   BROWN/DAVID MR
   BROWN/EMILY MS
   7/18 OZ1035 2005-2225 YOK

   예시 3 (일행인데 블록별로 항공편이 전부 다름):
   CLARK/MICHAEL MR
   CLARK/SARAH MS
   7/19 KE722 0905-1055 CWT
   7/19 OZ115 0930-1135 C1OK, C1WT   ← 한 줄에 인원수만큼 상태가 갈리면 개별 배정

   WHITE/ROBERT MR
   7/19 KE722 0905-1055 COK

   GREEN/LISA MS
   7/19 KE788 1035-1200 YOK

   예시 4 (담당자 표시 + 카톡 인용줄):
   @담당자닉네임
   TAYLOR/JAMES MR
   MOORE/ANNA MS
   7/25 OZ117 0015-0215 COK

   > 당일치기이신거죠 ~?        ← "> "로 시작하는 인용/답장 줄은 무시
   ============================================ */

const TITLE_WORDS = ["MR", "MRS", "MS", "MISS", "CHD", "INF"];

// "1235" -> "12:35"
function formatTime(raw) {
  const padded = raw.padStart(4, "0");
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

function parseTravelerLine(line) {
  const tokens = line.split(/\s+/);
  const name = tokens[0];
  if (tokens.length > 1 && TITLE_WORDS.includes(tokens[1].toUpperCase())) {
    return { name, title: tokens[1].toUpperCase(), note: tokens.slice(2).join(" ") };
  }
  return { name, title: "", note: tokens.slice(1).join(" ") };
}

// 클래스+상태 한 토큰: C, C1, COK, C1OK ... / 여러 명이면 콤마로 나열: "C1OK, C1WT"
const STATUS_TOKEN_RE = /^([CY])(\d*)(OK|WT)$/i;
const STATUS_FIELD_PART = "[CY]\\d*(?:OK|WT)(?:\\s*,\\s*[CY]\\d*(?:OK|WT))*";
const FLIGHT_LINE_RE = new RegExp(
  `^(\\d{1,2})\\/(\\d{1,2})\\s+([A-Z0-9]{2}\\d{2,4})\\s+(\\d{3,4})-(\\d{3,4})\\s+(${STATUS_FIELD_PART})(?:\\s*\\(([^)]+)\\)|\\s+(.+))?\\s*$`,
  "i"
);
// 출발-도착 시간 없이 "월/일 편명 [C/Y][OK/WT]"만 쓴 줄 — js/flightSchedule.js의 저장된 시간표에서 시간을 찾아 채움
const FLIGHT_LINE_SHORT_RE = new RegExp(
  `^(\\d{1,2})\\/(\\d{1,2})\\s+([A-Z0-9]{2}\\d{2,4})\\s+(${STATUS_FIELD_PART})(?:\\s*\\(([^)]+)\\)|\\s+(.+))?\\s*$`,
  "i"
);

// 좌석등급/상태 토큰(들)과 동행자 배정까지 처리하는 공통 로직 — 출발-도착 시간(base)만 호출부에서 다르게 넘겨줌
function buildEntryFromBase(base, statusField, parenMemo, freeMemo, travelers) {
  const memo = (parenMemo || freeMemo || "").trim();

  const tokens = statusField.split(",").map((s) => s.trim());
  const parsedTokens = tokens.map((tok) => {
    const tm = tok.match(STATUS_TOKEN_RE);
    return tm ? { seatClass: tm[1].toUpperCase(), count: tm[2] ? parseInt(tm[2], 10) : 1, status: tm[3].toUpperCase() } : null;
  });

  if (parsedTokens.some((t) => !t)) return null; // 상태 토큰 파싱 실패 → 호출부에서 invalidLines 처리

  if (parsedTokens.length > 1) {
    const totalCount = parsedTokens.reduce((sum, t) => sum + t.count, 0);
    if (totalCount === travelers.length && travelers.length > 0) {
      // 인원수와 정확히 맞아떨어지면 순서대로 개별 배정
      const entries = [];
      let idx = 0;
      parsedTokens.forEach((t) => {
        const assigned = travelers.slice(idx, idx + t.count);
        idx += t.count;
        entries.push({ ...base, seatClass: t.seatClass, status: t.status, memo, travelers: assigned });
      });
      return entries;
    }
    // 맞아떨어지지 않으면 대표 상태만 쓰고 원문을 메모에 남겨 확인할 수 있게 함
    const first = parsedTokens[0];
    const combinedMemo = memo ? `${memo} (원문 상태: ${statusField})` : `원문 상태: ${statusField}`;
    return [{ ...base, seatClass: first.seatClass, status: first.status, memo: combinedMemo, travelers: [...travelers] }];
  }

  const only = parsedTokens[0];
  return [{ ...base, seatClass: only.seatClass, status: only.status, memo, travelers: [...travelers] }];
}

// 카톡 텍스트에는 연도가 없어서 기준 연도를 붙이는데, 12/28~1/1처럼 해를 넘기는 일정은
// 그대로 두면 12/28과 1/1이 같은 해가 되어 체류 기간이 1년짜리로 잡힌다(캘린더에 막대가 통째로 그려짐).
// 그래서 두 가지를 함께 본다.
//  1) 시작 월이 보고 있는 달보다 한참 뒤면(1월 달력에서 12/28 입력) 지난해 일정으로 본다.
//  2) 한 블록의 일정은 시간순으로 적히므로, 월이 크게 되돌아가면(12월 다음에 1월) 다음 해로 넘긴다.
// baseMonth는 1~12 (달력에서 보고 있는 달). 없으면 1번은 건너뛴다.
function createDateBuilder(baseYear, baseMonth) {
  let year = baseYear;
  let prevMonth = null;
  return (monthStr, dayStr) => {
    const month = parseInt(monthStr, 10);
    if (prevMonth === null) {
      if (baseMonth && month - baseMonth >= 6) year -= 1;
    } else if (prevMonth - month >= 6) {
      year += 1;
    }
    prevMonth = month;
    return `${year}-${monthStr.padStart(2, "0")}-${dayStr.padStart(2, "0")}`;
  };
}

function buildEntry(match, makeDate, travelers) {
  const [, month, day, flightNo, depRaw, arrRaw, statusField, parenMemo, freeMemo] = match;
  const date = makeDate(month, day);
  const base = {
    date,
    flightNo: flightNo.toUpperCase(),
    depTime: formatTime(depRaw),
    arrTime: formatTime(arrRaw),
  };
  return buildEntryFromBase(base, statusField, parenMemo, freeMemo, travelers);
}

// 편명만 있고 시간이 없는 줄 — 저장된 시간표(FLIGHT_TIME_MAP)에서 출발-도착 시간을 찾아 채움. 시간표에 없는 편명이면 null(호출부에서 invalidLines 처리)
function buildEntryFromFlightSchedule(match, makeDate, travelers) {
  const [, month, day, flightNo, statusField, parenMemo, freeMemo] = match;
  const timeRange = typeof timeRangeForFlight === "function" ? timeRangeForFlight(flightNo) : null;
  if (!timeRange) return null;
  const [depTime, arrTime] = timeRange.split("-");
  const date = makeDate(month, day);
  const base = { date, flightNo: flightNo.toUpperCase(), depTime, arrTime };
  return buildEntryFromBase(base, statusField, parenMemo, freeMemo, travelers);
}

// 항공편 없이 일정(체크인/체크아웃)만 등록하는 고객용 — "월/일 SELIN|SELOUT" 또는 "월/일 셀인|셀아웃"
const NO_FLIGHT_LINE_RE = new RegExp(
  `^(\\d{1,2})\\/(\\d{1,2})\\s+(SELIN|SELOUT|셀인|셀아웃)(?:\\s*\\(([^)]+)\\)|\\s+(.+))?\\s*$`,
  "i"
);

function buildNoFlightEntry(match, makeDate, travelers) {
  const [, month, day, keyword, parenMemo, freeMemo] = match;
  const date = makeDate(month, day);
  const memo = (parenMemo || freeMemo || "").trim();
  const direction = /^(SELIN|셀인)$/i.test(keyword) ? "입국" : "출국";
  return [{
    date,
    flightNo: "",
    depTime: "",
    arrTime: "",
    seatClass: "",
    status: "OK",
    memo,
    travelers: [...travelers],
    noFlight: true,
    direction,
  }];
}

// 빈 줄로 구분된 하나의 블록(동행자 N명 + 그들의 항공편) 파싱
function parseBlock(lines, year, baseMonth) {
  const travelers = [];
  const entries = [];
  const invalidLines = [];
  const assignees = [];
  let flightsStarted = false;
  // 해를 넘기는 일정(12/28~1/1)을 처리하려고 블록마다 따로 둔다 — 블록이 바뀌면 다시 기준 연도부터 시작
  const makeDate = createDateBuilder(year, baseMonth);

  lines.forEach((line) => {
    if (line.startsWith(">")) return; // 카톡 인용/답장 줄 — 일정 데이터가 아니므로 무시

    if (!flightsStarted && line.startsWith("@")) {
      const name = line.slice(1).trim();
      if (name) assignees.push(name);
      return;
    }

    const m = line.match(FLIGHT_LINE_RE);
    if (m) {
      flightsStarted = true;
      const built = buildEntry(m, makeDate, travelers);
      if (built) entries.push(...built);
      else invalidLines.push(line);
      return;
    }

    const shortMatch = line.match(FLIGHT_LINE_SHORT_RE);
    if (shortMatch) {
      flightsStarted = true;
      const built = buildEntryFromFlightSchedule(shortMatch, makeDate, travelers);
      if (built) entries.push(...built);
      else invalidLines.push(line);
      return;
    }

    const noFlightMatch = line.match(NO_FLIGHT_LINE_RE);
    if (noFlightMatch) {
      flightsStarted = true;
      entries.push(...buildNoFlightEntry(noFlightMatch, makeDate, travelers));
      return;
    }

    if (!flightsStarted) {
      travelers.push(parseTravelerLine(line));
    } else {
      invalidLines.push(line);
    }
  });

  return { travelers, entries, invalidLines, assignee: assignees.join(", ") };
}

/**
 * @param {string} rawText 카톡에서 붙여넣은 원문 (빈 줄로 여러 블록을 이어 붙이면 한 일행으로 묶임)
 * @param {number} [year] 연도가 텍스트에 없으므로 기준 연도(기본: 올해)
 * @param {number} [baseMonth] 달력에서 보고 있는 달(1~12) — 해를 넘기는 일정의 연도 판단에 사용
 * @returns {{ travelers:object[], entries:object[], invalidLines:string[], assignee:string }}
 */
function parseSchedule(rawText, year = new Date().getFullYear(), baseMonth = null) {
  const rawLines = rawText.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let current = [];
  rawLines.forEach((line) => {
    if (line.trim() === "") {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
    } else {
      current.push(line.trim());
    }
  });
  if (current.length > 0) blocks.push(current);

  const travelers = [];
  const entries = [];
  const invalidLines = [];
  const assigneeSet = new Set();
  blocks.forEach((blockLines) => {
    const result = parseBlock(blockLines, year, baseMonth);
    travelers.push(...result.travelers);
    entries.push(...result.entries);
    invalidLines.push(...result.invalidLines);
    if (result.assignee) assigneeSet.add(result.assignee);
  });

  return { travelers, entries, invalidLines, assignee: Array.from(assigneeSet).join(", ") };
}
