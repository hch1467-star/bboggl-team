/* ============================================
   일본 공휴일 계산 (国民の祝日)
   고정일 + Happy Monday제(n번째 월요일) + 춘분/추분(근사식) + 대체휴일 + 국민의 휴일.
   1980~2099년 범위에서 정확 (춘분/추분 근사식 유효 범위).
   ============================================ */

function formatYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// n번째 요일이 있는 날짜 (weekday: 0=일 ... 6=토)
function nthWeekdayOfMonth(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1);
  const offset = (7 + weekday - first.getDay()) % 7;
  return 1 + offset + (n - 1) * 7;
}

function vernalEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function computeJapanHolidays(year) {
  const holidays = new Map(); // "YYYY-MM-DD" -> 공휴일명

  function add(month, day, name) {
    holidays.set(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, name);
  }

  add(1, 1, "새해(元日)");
  add(1, nthWeekdayOfMonth(year, 1, 1, 2), "성인의 날");
  add(2, 11, "건국기념일");
  add(2, 23, "천황탄생일");
  add(3, vernalEquinoxDay(year), "춘분의 날");
  add(4, 29, "쇼와의 날");
  add(5, 3, "헌법기념일");
  add(5, 4, "녹색의 날");
  add(5, 5, "어린이날");
  add(7, nthWeekdayOfMonth(year, 7, 1, 3), "바다의 날");
  add(8, 11, "산의 날");
  add(9, nthWeekdayOfMonth(year, 9, 1, 3), "경로의 날");
  add(9, autumnalEquinoxDay(year), "추분의 날");
  add(10, nthWeekdayOfMonth(year, 10, 1, 2), "스포츠의 날");
  add(11, 3, "문화의 날");
  add(11, 23, "근로감사의 날");

  // 국민의 휴일: 공휴일과 공휴일 사이에 낀 평일(일요일 제외)은 공휴일이 됨
  const dateSet = new Set(holidays.keys());
  Array.from(holidays.keys())
    .sort()
    .forEach((dStr) => {
      const d = new Date(`${dStr}T00:00:00`);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const nextNext = new Date(d);
      nextNext.setDate(d.getDate() + 2);
      const nextStr = formatYMD(next);
      if (next.getDay() !== 0 && !dateSet.has(nextStr) && dateSet.has(formatYMD(nextNext))) {
        holidays.set(nextStr, "국민의 휴일");
        dateSet.add(nextStr);
      }
    });

  // 대체휴일(振替休日): 공휴일이 일요일이면, 그 다음 공휴일이 아닌 첫 평일이 대체휴일
  Array.from(dateSet)
    .sort()
    .forEach((dStr) => {
      const d = new Date(`${dStr}T00:00:00`);
      if (d.getDay() !== 0) return;
      const sub = new Date(d);
      do {
        sub.setDate(sub.getDate() + 1);
      } while (dateSet.has(formatYMD(sub)));
      holidays.set(formatYMD(sub), "대체휴일");
      dateSet.add(formatYMD(sub));
    });

  return holidays;
}

const _japanHolidayCache = {};
function getJapanHolidays(year) {
  if (!_japanHolidayCache[year]) {
    _japanHolidayCache[year] = computeJapanHolidays(year);
  }
  return _japanHolidayCache[year];
}
