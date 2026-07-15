/* ============================================
   캘린더 렌더링 + 날짜 선택 + 우측/하단 상세 패널
   ============================================ */

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

// 예약(그룹)마다 고유한 색을 배정 — 같은 그룹은 항상 같은 색 (id를 해시해서 팔레트에서 선택)
// 파스텔톤 — 배경으로 쓰이므로 글자는 어두운 색(var(--text))으로 표시
const STAY_COLOR_PALETTE = [
  "#A8D8FF", // 파스텔 블루
  "#D4B3FF", // 파스텔 퍼플
  "#FFB3D9", // 파스텔 핑크
  "#FFD1A3", // 파스텔 오렌지
  "#A3E4D7", // 파스텔 민트
  "#B8E6B8", // 파스텔 그린
  "#C3C9F5", // 파스텔 인디고
  "#E8D5C4", // 파스텔 브라운
];

function colorForGroup(groupId) {
  const str = String(groupId);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return STAY_COLOR_PALETTE[hash % STAY_COLOR_PALETTE.length];
}

const CalendarView = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  selectedDate: formatDateStr(new Date()),
  searchFilterFn: null, // search.js에서 주입하는 {group,entry} 필터 함수
  directionFilter: null, // "입국" | "출국" | null(전체)

  init() {
    document.getElementById("prev-month-btn").addEventListener("click", () => this.changeMonth(-1));
    document.getElementById("next-month-btn").addEventListener("click", () => this.changeMonth(1));
    document.querySelectorAll(".legend-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.directionFilter = btn.dataset.direction || null;
        document.querySelectorAll(".legend-btn").forEach((b) => b.classList.toggle("active", b === btn));
        this.render();
      });
    });
    this.render();
  },

  changeMonth(delta) {
    this.viewMonth += delta;
    if (this.viewMonth < 0) {
      this.viewMonth = 11;
      this.viewYear--;
    } else if (this.viewMonth > 11) {
      this.viewMonth = 0;
      this.viewYear++;
    }
    this.render();
  },

  selectDate(dateStr) {
    this.selectedDate = dateStr;
    this.render();
  },

  goToDate(dateStr) {
    const [y, m] = dateStr.split("-").map(Number);
    this.viewYear = y;
    this.viewMonth = m - 1;
    this.selectedDate = dateStr;
    this.render();
  },

  getVisiblePairs() {
    let pairs = Store.flatEntries();
    if (this.searchFilterFn) pairs = this.searchFilterFn(pairs);

    if (this.directionFilter) {
      const cache = new Map(); // group.id -> classifyDirections 결과 (그룹당 한 번만 계산)
      pairs = pairs.filter(({ group, entry }) => {
        if (!cache.has(group.id)) cache.set(group.id, classifyDirections(group.entries));
        return cache.get(group.id).get(entry)?.direction === this.directionFilter;
      });
    }

    return pairs;
  },

  render() {
    this.renderToolbar();
    this.renderGrid();
    this.renderDetailPanel();
  },

  renderToolbar() {
    document.getElementById("month-label").textContent = `${this.viewYear}년 ${this.viewMonth + 1}월`;
  },

  renderGrid() {
    const grid = document.getElementById("calendar-grid");
    grid.innerHTML = "";

    WEEKDAY_LABELS.forEach((label) => {
      const el = document.createElement("div");
      el.className = "weekday-label";
      el.textContent = label;
      grid.appendChild(el);
    });

    const firstOfMonth = new Date(this.viewYear, this.viewMonth, 1);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    const todayStr = formatDateStr(new Date());
    const visiblePairs = this.getVisiblePairs();
    // 입국/출국 필터가 켜져 있으면 "체류 기간 막대"가 아니라 그 날짜 하루짜리 점(알약)으로 표시
    // (필터는 특정 날짜의 항공편만 골라내는 거라, 기간 막대를 그대로 쓰면 화면이 안 맞음)
    const items = this.directionFilter
      ? filteredDayItems(visiblePairs)
      : groupStayItems(uniqueGroupsFromPairs(visiblePairs));
    const laneAssignment = assignLanesForItems(items);
    const MAX_VISIBLE_LANES = 3;

    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startOffset + 1;
      const cellDate = new Date(this.viewYear, this.viewMonth, dayNum);
      const dateStr = formatDateStr(cellDate);
      const inMonth = dayNum >= 1 && dayNum <= daysInMonth;

      const cell = document.createElement("div");
      cell.className = "day-cell";
      if (!inMonth) cell.classList.add("other-month");
      if (dateStr === todayStr) cell.classList.add("today");
      if (dateStr === this.selectedDate) cell.classList.add("selected");

      const dayOfWeek = cellDate.getDay(); // 0=일 ... 6=토
      const holidayName = getJapanHolidays(cellDate.getFullYear()).get(dateStr);

      const numberEl = document.createElement("div");
      numberEl.className = "day-number";
      if (dayOfWeek === 0 || holidayName) numberEl.classList.add("text-sunday");
      else if (dayOfWeek === 6) numberEl.classList.add("text-saturday");
      numberEl.textContent = cellDate.getDate();
      cell.appendChild(numberEl);

      if (holidayName) {
        const holidayEl = document.createElement("div");
        holidayEl.className = "day-holiday-label";
        holidayEl.textContent = holidayName;
        holidayEl.title = `일본 공휴일: ${holidayName}`;
        cell.appendChild(holidayEl);
      }

      // 체류 기간(입국~출국)을 이어지는 막대로 표시, 겹치면 레인으로 쌓임 (모바일은 얇은 선으로 축소 표시)
      const lanesWrap = document.createElement("div");
      lanesWrap.className = "day-lanes";

      const activeToday = [];
      laneAssignment.forEach((info) => {
        if (dateStr >= info.start && dateStr <= info.end) {
          activeToday.push(info);
        }
      });
      activeToday.sort((a, b) => a.lane - b.lane);

      const maxLane = activeToday.length ? Math.max(...activeToday.map((a) => a.lane)) : -1;
      for (let laneIdx = 0; laneIdx <= Math.min(maxLane, MAX_VISIBLE_LANES - 1); laneIdx++) {
        const active = activeToday.find((a) => a.lane === laneIdx);
        const laneRow = document.createElement("div");
        laneRow.className = "day-lane-row";
        if (active) {
          const group = active.group;
          const isStart = dateStr === active.start;
          const isEnd = dateStr === active.end;
          const bar = document.createElement("div");
          bar.className = "stay-bar";
          bar.style.background = colorForGroup(group.id);
          if (isStart || dayOfWeek === 0) bar.classList.add("bar-round-left");
          if (isEnd || dayOfWeek === 6) bar.classList.add("bar-round-right");
          if (isStart || dayOfWeek === 0) bar.textContent = groupLabel(group);
          bar.title = `${groupLabel(group)} (${active.start} ~ ${active.end})`;
          laneRow.appendChild(bar);
        }
        lanesWrap.appendChild(laneRow);
      }
      const laneOverflow = activeToday.length - MAX_VISIBLE_LANES;
      if (laneOverflow > 0) {
        const more = document.createElement("div");
        more.className = "day-lane-more";
        more.textContent = `+${laneOverflow}`;
        lanesWrap.appendChild(more);
      }
      cell.appendChild(lanesWrap);

      cell.addEventListener("click", () => this.selectDate(dateStr));
      grid.appendChild(cell);
    }
  },

  renderDetailPanel() {
    const panel = document.getElementById("detail-panel-body");
    const titleEl = document.getElementById("detail-panel-title");
    const [y, m, d] = this.selectedDate.split("-").map(Number);
    titleEl.textContent = `${m}월 ${d}일 방문 일정`;

    const dayPairs = this.getVisiblePairs().filter((p) => p.entry.date === this.selectedDate);
    panel.innerHTML = "";

    if (dayPairs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "detail-empty";
      empty.textContent = "이 날짜에 예정된 일정이 없어요.";
      panel.appendChild(empty);
      return;
    }

    // 그룹(일행)별로 묶어서 카드 1개 = 파티 1개로 표시
    const byGroup = new Map();
    dayPairs.forEach(({ group, entry }) => {
      if (!byGroup.has(group.id)) byGroup.set(group.id, { group, entries: [] });
      byGroup.get(group.id).entries.push(entry);
    });

    byGroup.forEach(({ group, entries }) => {
      entries.sort((a, b) => a.depTime.localeCompare(b.depTime));

      const item = document.createElement("div");
      item.className = "detail-item";
      item.style.borderLeft = `4px solid ${colorForGroup(group.id)}`;

      const primary = group.travelers[0];
      const showTravelerLabel = group.travelers.length > 1;
      // 입국/출국 판단은 이 그룹의 전체 항공편(다른 날짜 포함)을 기준으로 해야 정확함
      const directionMap = classifyDirections(group.entries);
      const readOnly = !!Store.readOnly; // 관리자 화면(admin.html)에서는 조회만 가능, 수정/삭제 UI 자체를 숨김

      const ownerBadge = group.ownerEmail
        ? `<span class="badge-assignee">담당자 ${escapeHtml(group.ownerEmail)}</span>`
        : "";
      const memoSectionHtml = readOnly
        ? group.memo
          ? `<div class="group-memo-section"><div class="detail-memo">메모: ${escapeHtml(group.memo)}</div></div>`
          : ""
        : `<div class="group-memo-section">
             <textarea class="group-memo-input" placeholder="메모 추가 (예: 공항 픽업 필요)">${escapeHtml(group.memo || "")}</textarea>
           </div>`;

      item.innerHTML = `
        <div class="detail-item-header">
          <span>
            <span class="detail-customer-name">${escapeHtml(primary.name)}</span>
            <span class="detail-customer-title">${escapeHtml(primary.title || "")}</span>
          </span>
          <span class="header-badges">
            ${ownerBadge}
            ${group.assignee ? `<span class="badge-assignee">담당 ${escapeHtml(group.assignee)}</span>` : ""}
            ${group.travelers.length > 1 ? `<span class="badge-class">일행 ${group.travelers.length}명</span>` : ""}
            ${readOnly ? "" : `<button class="delete-group-btn" type="button" aria-label="일정 삭제" title="일정 삭제">${Icons.trash}</button>`}
          </span>
        </div>
        <div class="entry-list">
          ${entries.map((entry) => renderEntryRowHtml(entry, showTravelerLabel, directionMap.get(entry))).join("")}
        </div>
        ${renderRosterHtml(group.travelers)}
        ${memoSectionHtml}
      `;

      if (!readOnly) {
        const deleteBtn = item.querySelector(".delete-group-btn");
        deleteBtn.addEventListener("click", async () => {
          const label = groupLabel(group);
          const ok = confirm(`${label} 일정을 삭제할까요?\n이 일행의 모든 항공편 일정이 삭제되고, 되돌릴 수 없어요.`);
          if (!ok) return;
          try {
            await Store.removeGroup(group.id);
            this.render();
          } catch (err) {
            alert("삭제하지 못했어요: " + (err.message || err));
          }
        });

        const memoInput = item.querySelector(".group-memo-input");
        memoInput.addEventListener("blur", async () => {
          const newMemo = memoInput.value;
          if (newMemo === (group.memo || "")) return;
          try {
            await Store.updateGroupMemo(group.id, newMemo);
          } catch (err) {
            alert("메모를 저장하지 못했어요: " + (err.message || err));
          }
        });
      }

      panel.appendChild(item);
    });
  },
};

// 필터링된 {group,entry} 쌍 전체에서 그룹당 1개씩 중복 없이 반환 (날짜 무관)
function uniqueGroupsFromPairs(pairs) {
  const seen = new Map();
  pairs.forEach(({ group }) => {
    if (!seen.has(group.id)) seen.set(group.id, group);
  });
  return Array.from(seen.values());
}

// 그룹의 체류 기간(가장 이른 항공편 ~ 가장 늦은 항공편). 항공편이 없으면 null.
function groupStayRange(group) {
  if (!group.entries.length) return null;
  const dates = group.entries.map((e) => e.date).sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

// 전체 보기: 그룹별로 체류 시작~끝 전체 기간을 하나의 아이템으로
function groupStayItems(groups) {
  return groups
    .map((group) => {
      const range = groupStayRange(group);
      return range ? { key: String(group.id), group, start: range.start, end: range.end } : null;
    })
    .filter(Boolean);
}

// 입국/출국 필터 보기: 필터링된 항공편이 실제로 있는 날짜만 하루짜리 아이템으로
// (체류 기간 막대를 그대로 쓰면 필터와 안 맞아 화면이 깨지므로 점으로 표시)
function filteredDayItems(visiblePairs) {
  const map = new Map();
  visiblePairs.forEach(({ group, entry }) => {
    const key = `${group.id}__${entry.date}`;
    if (!map.has(key)) map.set(key, { key, group, start: entry.date, end: entry.date });
  });
  return Array.from(map.values());
}

/**
 * 겹치는 기간끼리 레인(줄)을 나눠 배정. 겹치지 않으면 같은 레인 재사용.
 * @param {object[]} items - { key, group, start, end }
 * @returns {Map} item.key -> { group, lane, start, end }
 */
function assignLanesForItems(items) {
  const sorted = [...items].sort(
    (a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end)
  );

  const laneEnds = []; // laneEnds[i] = 그 레인에서 마지막으로 점유된 날짜
  const assignment = new Map();

  sorted.forEach((item) => {
    let laneIdx = laneEnds.findIndex((end) => end < item.start);
    if (laneIdx === -1) {
      laneIdx = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[laneIdx] = item.end;
    }
    assignment.set(item.key, { group: item.group, lane: laneIdx, start: item.start, end: item.end });
  });

  return assignment;
}

function groupLabel(group) {
  const primary = group.travelers[0];
  return group.travelers.length > 1 ? `${primary.name} 외 ${group.travelers.length - 1}명` : primary.name;
}

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

// 항공편 한 건 렌더링 — showTravelerLabel이 true면 이 항공편에 누가 타는지 표시
function renderEntryRowHtml(entry, showTravelerLabel, directionInfo) {
  const classLabel = entry.seatClass === "C" ? "비즈니스" : "이코노미";
  const statusBadge =
    entry.status === "OK"
      ? `<span class="badge badge-ok">확약 OK</span>`
      : `<span class="badge badge-wt">대기 WT</span>`;
  const [, m, d] = entry.date.split("-");
  const travelerLabel =
    showTravelerLabel && entry.travelers && entry.travelers.length > 0
      ? `<div class="entry-travelers">${entry.travelers.map((t) => escapeHtml(t.name)).join(", ")}</div>`
      : "";

  let directionBadge = "";
  if (directionInfo && directionInfo.direction) {
    const dirClass = directionInfo.direction === "입국" ? "badge-arrival" : "badge-departure";
    const conflictClass = directionInfo.conflict ? " badge-direction-conflict" : "";
    const titleAttr = directionInfo.conflict
      ? ` title="탑승 순서와 항공편 번호 패턴이 달라요 — 확인해주세요"`
      : "";
    directionBadge = `<span class="badge-direction ${dirClass}${conflictClass}"${titleAttr}>${directionInfo.direction}편${
      directionInfo.conflict ? " ⚠" : ""
    }</span>`;
  }

  return `
    <div class="entry-row">
      ${travelerLabel}
      <div class="detail-item-header">
        <span class="header-badges">
          ${directionBadge}
          <span class="detail-flight-time">${m}/${d}</span>
        </span>
        ${statusBadge}
      </div>
      <div class="detail-flight-row">
        ${Icons.plane}
        <span class="detail-flight-no">${escapeHtml(entry.flightNo)}</span>
        <span class="detail-flight-time">${entry.depTime} - ${entry.arrTime}</span>
        <span class="badge-class">${classLabel}</span>
      </div>
      ${entry.memo ? `<div class="detail-memo">메모: ${escapeHtml(entry.memo)}</div>` : ""}
    </div>`;
}

// 일행이 2명 이상일 때만 전체 명단을 하단에 표시
function renderRosterHtml(travelers) {
  if (travelers.length <= 1) return "";
  return `<div class="detail-companions">
    ${travelers
      .map(
        (t) => `
      <div class="companion-row">
        <span class="detail-customer-name">${escapeHtml(t.name)}</span>
        <span class="detail-customer-title">${escapeHtml(t.title || "")}</span>
        ${t.note ? `<span class="companion-note">${escapeHtml(t.note)}</span>` : ""}
      </div>`
      )
      .join("")}
  </div>`;
}

function formatDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
