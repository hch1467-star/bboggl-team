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

// 담당자별 사번/전화번호 — 데이터가 준비되는 대로 이름을 key로 추가해주세요.
// 예: "박희채": { employeeId: "12345", phone: "010-0000-0000" },
const STAFF_DIRECTORY = {};

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

function buildRoomReservationText(parsed) {
  const primary = parsed.travelers[0];
  const nameLabel = `${primary.name}${primary.title ? " " + primary.title : ""}`;
  const directionMap = classifyDirections(parsed.entries);
  const sorted = [...parsed.entries].sort((a, b) => a.date.localeCompare(b.date));
  const arrivalEntry = sorted.find((e) => directionMap.get(e)?.direction === "입국") || sorted[0];
  const departureEntry =
    [...sorted].reverse().find((e) => directionMap.get(e)?.direction === "출국") || sorted[sorted.length - 1];

  const assignee = parsed.assignee || "";
  const staff = STAFF_DIRECTORY[assignee];
  const billingTail = !assignee
    ? "(담당자 미지정)"
    : staff
    ? `${assignee}/${staff.employeeId}`
    : `${assignee}(사번 미등록)`;
  const hostTail = !assignee ? "(담당자 미지정)" : staff ? `${assignee} ${staff.phone}` : `${assignee}(전화번호 미등록)`;

  return [
    `MMID : `,
    `NAME : ${nameLabel}`,
    `CASINO TIER : ${ROOM_FIXED_DEFAULTS.casinoTier}`,
    `CI DATE : ${formatMD(arrivalEntry.date)}`,
    `CO DATE : ${formatMD(departureEntry.date)}`,
    `HOTEL TOWER : ${ROOM_FIXED_DEFAULTS.hotelTower}`,
    `ROOM TYPE : ${ROOM_FIXED_DEFAULTS.roomType}`,
    `BILLING : RM-CASINO BD(${billingTail})`,
    `ROOM POST : ${ROOM_FIXED_DEFAULTS.roomPost}`,
    `WAIVE DEPOSIT : ${ROOM_FIXED_DEFAULTS.waiveDeposit}`,
    `HOST : ${hostTail}`,
  ].join("\n");
}

function buildLimoReservationText(parsed) {
  const primary = parsed.travelers[0];
  const nameLabel = `${primary.name}${primary.title ? " " + primary.title : ""}`;
  const directionMap = classifyDirections(parsed.entries);
  const sorted = [...parsed.entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.depTime.localeCompare(b.depTime)
  );

  const lines = [nameLabel];
  sorted.forEach((entry) => {
    const direction = directionMap.get(entry)?.direction;
    const airport = FLIGHT_AIRPORT_MAP[entry.flightNo.toUpperCase()] || null;
    // 김포는 터미널 구분이 없어서 공항명만, 인천은 터미널(T1/T2) 확인이 필요해서 표시만 남겨둠
    const location = airport === "김포" ? "김포공항" : airport === "인천" ? "(터미널확인)" : "(공항/터미널확인)";
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
