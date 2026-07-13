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
  `^(\\d{1,2})\\/(\\d{1,2})\\s+([A-Z]{1,2}\\d{2,4})\\s+(\\d{3,4})-(\\d{3,4})\\s+(${STATUS_FIELD_PART})(?:\\s*\\(([^)]+)\\)|\\s+(.+))?\\s*$`,
  "i"
);

function buildEntry(match, year, travelers) {
  const [, month, day, flightNo, depRaw, arrRaw, statusField, parenMemo, freeMemo] = match;
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const memo = (parenMemo || freeMemo || "").trim();
  const base = {
    date,
    flightNo: flightNo.toUpperCase(),
    depTime: formatTime(depRaw),
    arrTime: formatTime(arrRaw),
  };

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

// 빈 줄로 구분된 하나의 블록(동행자 N명 + 그들의 항공편) 파싱
function parseBlock(lines, year) {
  const travelers = [];
  const entries = [];
  const invalidLines = [];
  const assignees = [];
  let flightsStarted = false;

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
      const built = buildEntry(m, year, travelers);
      if (built) entries.push(...built);
      else invalidLines.push(line);
    } else if (!flightsStarted) {
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
 * @returns {{ travelers:object[], entries:object[], invalidLines:string[], assignee:string }}
 */
function parseSchedule(rawText, year = new Date().getFullYear()) {
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
    const result = parseBlock(blockLines, year);
    travelers.push(...result.travelers);
    entries.push(...result.entries);
    invalidLines.push(...result.invalidLines);
    if (result.assignee) assigneeSet.add(result.assignee);
  });

  return { travelers, entries, invalidLines, assignee: Array.from(assigneeSet).join(", ") };
}
