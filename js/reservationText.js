/* ============================================
   카톡 파싱 결과 → 객실 예약 / 리무진 예약 텍스트 자동 생성
   ============================================ */

// 예약마다 거의 항상 같은 항목 — 다르면 복사 전에 미리보기에서 직접 수정
const ROOM_FIXED_DEFAULTS = {
  casinoTier: "ROYAL",
  hotelTower: "SUN OR OCEAN",
  roomType: "DELUXE",
  roomPost: "OPEN POST",
  waiveDeposit: "Y",
};

// 담당자 사번/전화번호는 개인정보라 이 저장소(공개 GitHub)에는 저장하지 않고
// Supabase의 staff_directory 테이블에서 불러와 Store.staffDirectory에 담아 씀 (js/data.js의 loadStaffDirectory 참고)

// 담당자 표기(assignee)가 어떤 형태로 적혀도(이름만/닉네임만/붙여쓰기 등) 최대한 찾아봄
// "이름(닉네임)" / 닉네임 단독 표기는 항상 고유하게 매칭, 이름만 적었을 땐 동명이인이 없을 때만 매칭
function findStaff(assigneeRaw) {
  const directory = (typeof Store !== "undefined" && Store.staffDirectory) || [];
  const trimmed = (assigneeRaw || "").trim();
  if (!trimmed || directory.length === 0) return { record: null, ambiguous: false };

  const byKey = {};
  const byName = {};
  const nameCounts = {};
  directory.forEach((s) => {
    nameCounts[s.name] = (nameCounts[s.name] || 0) + 1;
  });
  directory.forEach((s) => {
    byKey[`${s.name}(${s.nickname})`] = s;
    byKey[s.nickname.toUpperCase()] = s;
    if (nameCounts[s.name] === 1) byName[s.name] = s;
  });

  if (byKey[trimmed]) return { record: byKey[trimmed], ambiguous: false };
  if (byKey[trimmed.toUpperCase()]) return { record: byKey[trimmed.toUpperCase()], ambiguous: false };
  if (byName[trimmed]) return { record: byName[trimmed], ambiguous: false };

  // "김훈huny"처럼 이름+닉네임이 붙어서 적힌 경우, 포함 관계로 찾기
  const upper = trimmed.toUpperCase();
  const matches = directory.filter((s) => trimmed.includes(s.name) || upper.includes(s.nickname.toUpperCase()));
  if (matches.length === 1) return { record: matches[0], ambiguous: false };
  if (matches.length > 1) return { record: null, ambiguous: true };
  return { record: null, ambiguous: false };
}

// 고객명은 개인정보라 이 저장소(공개 GitHub)에는 저장하지 않고
// Supabase의 customer_mmid 테이블에서 불러와 Store.customerMmid에 담아 씀 (js/data.js의 loadCustomerMmid 참고)

// "NAKATANI/KAZUHIRO" -> "NAKATANI KAZUHIRO" (엑셀 쪽 "성 이름" 표기와 비교하기 위해 통일)
function normalizeCustomerName(name) {
  return (name || "")
    .replace(/[/\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// 동명 고객이 있으면(같은 이름, 다른 MMID) 잘못 채우지 않고 "동명 고객" 표시로 남김
function findCustomerMmid(rawName) {
  const directory = (typeof Store !== "undefined" && Store.customerMmid) || [];
  const target = normalizeCustomerName(rawName);
  if (!target || directory.length === 0) return { mmid: null, ambiguous: false };

  const matches = directory.filter((c) => normalizeCustomerName(c.name) === target);
  if (matches.length === 1) return { mmid: matches[0].mmid, ambiguous: false };
  if (matches.length > 1) return { mmid: null, ambiguous: true };
  return { mmid: null, ambiguous: false };
}

function formatMD(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

// "20:40" - 2시간 -> "18:40" (자정 넘어가도 시각만 계산, 날짜는 안 바꿈)
function subtractHours(timeStr, hours) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = (((h * 60 + m - hours * 60) % 1440) + 1440) % 1440;
  const newH = Math.floor(total / 60);
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

// 객실 배정 규칙 — MR은 각자 방을 쓰고, MS/MRS/MISS/CHD/INF·호칭 없는 동행자는 바로 앞 MR과 합방.
// 맨 앞이 MR이 아닌 일행(예: MS 단독 고객)은 첫 사람이 그대로 방 주인이 됨.
function groupTravelersIntoRooms(travelers) {
  const rooms = [];
  travelers.forEach((t) => {
    const isRoomHolder = (t.title || "").toUpperCase() === "MR";
    if (isRoomHolder || rooms.length === 0) rooms.push({ members: [t] });
    else rooms[rooms.length - 1].members.push(t);
  });
  return rooms;
}

// 그 방에 묵는 사람이 실제로 타는 항공편만 추림 (일행끼리 편명이 갈리면 방마다 체크인/아웃 날짜가 달라짐).
// 배정 정보가 없거나 매칭이 하나도 안 되면 안전하게 전체 일정을 그대로 사용.
function entriesForRoom(room, allEntries) {
  const names = new Set(room.members.map((m) => m.name));
  const matched = allEntries.filter(
    (e) => !e.travelers || e.travelers.length === 0 || e.travelers.some((t) => names.has(t.name))
  );
  return matched.length ? matched : allEntries;
}

function travelerLabel(t) {
  return `${t.name}${t.title ? " " + t.title : ""}`;
}

// 방 하나당 기존 예약 포맷 한 덩어리 (여러 방이면 이 덩어리를 방 개수만큼 반복해서 이어붙임)
function renderRoomBlock(info, billingTail, hostTail) {
  const lines = [
    `MMID : ${info.mmidValue}`,
    `NAME : ${info.nameLabel}`,
    `CASINO TIER : ${ROOM_FIXED_DEFAULTS.casinoTier}`,
    `CI DATE : ${info.ci}`,
    `CO DATE : ${info.co}`,
    `HOTEL TOWER : ${ROOM_FIXED_DEFAULTS.hotelTower}`,
    `ROOM TYPE : ${ROOM_FIXED_DEFAULTS.roomType}`,
    `BILLING : RM-CASINO BD(${billingTail})`,
    `ROOM POST : ${ROOM_FIXED_DEFAULTS.roomPost}`,
    `WAIVE DEPOSIT : ${ROOM_FIXED_DEFAULTS.waiveDeposit}`,
    `HOST : ${hostTail}`,
  ];

  if (info.hasEarlyArrival) lines.push("ECI 12시로 예약부탁드립니다");
  if (info.hasLateDeparture) lines.push("LCO 16시로 예약 부탁드립니다.");

  return lines.join("\n");
}

function buildRoomReservationText(parsed) {
  const directionMap = classifyDirections(parsed.entries);
  const rooms = groupTravelersIntoRooms(parsed.travelers);

  const assignee = parsed.assignee || "";
  const { record: staff, ambiguous } = findStaff(assignee);
  const billingTail = !assignee
    ? "(담당자 미지정)"
    : ambiguous
    ? `${assignee}(동명이인 있음-확인필요)`
    : staff
    ? `${staff.name}(${staff.nickname})/${staff.employeeId}`
    : `${assignee}(사번 미등록)`;
  const hostTail = !assignee
    ? "(담당자 미지정)"
    : ambiguous
    ? `${assignee}(동명이인 있음-확인필요)`
    : staff
    ? `${staff.name}(${staff.nickname}) ${staff.phone}`
    : `${assignee}(전화번호 미등록)`;

  const roomInfos = rooms.map((room) => {
    const roomEntries = entriesForRoom(room, parsed.entries);
    const sorted = [...roomEntries].sort((a, b) => a.date.localeCompare(b.date));
    const arrivalEntry = sorted.find((e) => directionMap.get(e)?.direction === "입국") || sorted[0];
    const departureEntry =
      [...sorted].reverse().find((e) => directionMap.get(e)?.direction === "출국") || sorted[sorted.length - 1];

    // MMID는 방 주인(첫 사람) 기준으로 조회 — 방마다 투숙객이 달라 각각 다른 값이 나올 수 있음
    const holder = room.members[0];
    const { mmid, ambiguous: mmidAmbiguous } = findCustomerMmid(holder.name);

    // 리무진 픽업/샌딩 시간 기준 얼리체크인(ECI)/레이트체크아웃(LCO) 자동 안내
    // 입국편 도착이 13시 이전이면 ECI, 출국편 리무진 출발(항공편 출발 2시간 전)이 12시 이후면 LCO
    return {
      // 합방하는 동행자(MS 등)는 적지 않고 방 주인 이름만
      nameLabel: travelerLabel(room.members[0]),
      mmidValue: mmid || (mmidAmbiguous ? "(동명 고객 있음-확인필요)" : ""),
      ci: formatMD(arrivalEntry.date),
      co: formatMD(departureEntry.date),
      hasEarlyArrival: roomEntries.some(
        (e) => !e.noFlight && directionMap.get(e)?.direction === "입국" && e.arrTime < "13:00"
      ),
      hasLateDeparture: roomEntries.some(
        (e) => !e.noFlight && directionMap.get(e)?.direction === "출국" && subtractHours(e.depTime, 2) >= "12:00"
      ),
    };
  });

  // 방마다 기존 포맷 한 덩어리씩, 빈 줄로 구분해서 이어붙임
  return roomInfos.map((r) => renderRoomBlock(r, billingTail, hostTail)).join("\n\n");
}

// 리무진은 같은 편명이면 대표(리더) 고객 이름 하나로 묶어서 예약
function buildLimoReservationText(parsed) {
  const nameLabel = travelerLabel(parsed.travelers[0]);
  const directionMap = classifyDirections(parsed.entries);
  // 셀인/셀아웃(항공편 없음) 일정은 리무진 대상이 아니므로 제외
  const flightEntries = parsed.entries.filter((e) => !e.noFlight);
  const sorted = [...flightEntries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.depTime.localeCompare(b.depTime)
  );

  const lines = [nameLabel];
  const seen = new Set();
  sorted.forEach((entry) => {
    // 일행이 같은 편에 개별 배정되면 항목이 사람 수만큼 생기는데, 리무진은 편당 한 대라 같은 날짜+편명은 한 줄만
    const key = `${entry.date}|${entry.flightNo.toUpperCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    const direction = directionMap.get(entry)?.direction;
    const airport = airportForFlight(entry.flightNo);
    // 김포는 터미널 구분이 없어서 공항명만, 인천은 항공사별 터미널(T1/T2)을 자동 매핑
    const terminal = airport === "인천" ? terminalForFlight(entry.flightNo) : null;
    const location =
      airport === "김포" ? "김포공항" : terminal ? terminal : airport === "인천" ? "(터미널확인)" : "(공항/터미널확인)";
    const md = formatMD(entry.date);
    if (direction === "출국") {
      const pickupTime = subtractHours(entry.depTime, 2);
      lines.push(`${md} ${entry.flightNo} ${pickupTime} VIP->${location}`);
    } else {
      lines.push(`${md} ${entry.flightNo} ${entry.arrTime} ${location}->VIP`);
    }
  });

  return lines.join("\n");
}

// 객실 예약 텍스트 아래에 리무진 예약 텍스트를 이어붙이고 마무리 멘트를 고정으로 붙임
// (같은 곳에 같이 요청하는 거라 두 텍스트를 하나로 합쳐서 복사)
// 셀인/셀아웃만 있는(항공편이 아예 없는) 고객은 리무진이 필요 없으니 객실 예약만 생성
function buildCombinedReservationText(parsed) {
  const room = buildRoomReservationText(parsed);
  const hasFlight = parsed.entries.some((e) => !e.noFlight);
  if (!hasFlight) return room;
  const limo = buildLimoReservationText(parsed);
  return `${room}\n\n\n${limo}\n\n객실 예약 및 리모 예약 같이 부탁드립니다.`;
}
