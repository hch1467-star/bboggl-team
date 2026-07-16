/* ============================================
   마이페이지 — 로그인한 사용자의 실제 통계·활동 내역
   ============================================ */

let mypageActiveTab = "upcoming"; // "upcoming" | "OK" | "WT" — 확약/대기 탭 토글 상태

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireSession();
  if (!session) return; // login.html로 이동 중

  if (await checkIsAdmin(CurrentUser.id)) {
    window.location.href = "admin.html";
    return;
  }

  const loadingEl = document.getElementById("loading-overlay");

  try {
    await Store.init(CurrentUser.id);
  } catch (err) {
    alert("일정을 불러오지 못했어요: " + (err.message || err));
  }

  if (loadingEl) loadingEl.remove();
  wireLogoutButton();

  document.getElementById("profile-email").textContent = CurrentUser.email;

  document.getElementById("stat-customers").textContent = Store.totalTravelers();
  document.getElementById("stat-events").textContent = Store.totalEntries();
  document.getElementById("stat-ok").textContent = Store.totalOkEntries();
  document.getElementById("stat-wt").textContent = Store.flatEntries().filter((p) => p.entry.status === "WT").length;

  renderActivitySection();
  wireExpandableRows(document.getElementById("activity-list"));
  wireMonthGroups(document.getElementById("activity-list"));

  document.getElementById("stat-ok-btn").addEventListener("click", () => {
    mypageActiveTab = mypageActiveTab === "OK" ? "upcoming" : "OK";
    renderActivitySection();
  });
  document.getElementById("stat-wt-btn").addEventListener("click", () => {
    mypageActiveTab = mypageActiveTab === "WT" ? "upcoming" : "WT";
    renderActivitySection();
  });
});

// 상단 확약/대기 탭 상태에 따라 활동 목록 섹션의 제목·내용을 다시 그림
function renderActivitySection() {
  document.getElementById("stat-ok-btn").classList.toggle("active", mypageActiveTab === "OK");
  document.getElementById("stat-wt-btn").classList.toggle("active", mypageActiveTab === "WT");

  const titleEl = document.getElementById("activity-list-title");
  const listEl = document.getElementById("activity-list");
  const allPairs = Store.flatEntries();

  let pairs;
  let emptyMessage;
  if (mypageActiveTab === "OK") {
    titleEl.textContent = "확약(OK) 일정";
    pairs = allPairs
      .filter((p) => p.entry.status === "OK")
      .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.depTime.localeCompare(b.entry.depTime));
    emptyMessage = "확약된 일정이 없어요.";
  } else if (mypageActiveTab === "WT") {
    titleEl.textContent = "확인 필요한 대기(WT) 일정";
    // 날짜가 가까운 것부터 — 확인·컨펌이 급한 순서
    pairs = allPairs
      .filter((p) => p.entry.status === "WT")
      .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.depTime.localeCompare(b.entry.depTime));
    emptyMessage = "확인이 필요한 대기 일정이 없어요.";

    listEl.innerHTML =
      pairs.length === 0 ? `<div class="detail-empty">${emptyMessage}</div>` : renderMonthGroupedHtml(pairs);
    return;
  } else {
    titleEl.textContent = "다가오는 일정";
    // 오늘 이후 일정을 날짜 가까운 순으로 — 실제로 누가 오는지, 무슨 액션이 필요한지 한눈에
    const today = todayDateStr();
    pairs = allPairs
      .filter((p) => p.entry.date >= today)
      .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.depTime.localeCompare(b.entry.depTime));
    emptyMessage = "다가오는 일정이 없어요.";

    listEl.innerHTML =
      pairs.length === 0 ? `<div class="detail-empty">${emptyMessage}</div>` : renderMonthGroupedHtml(pairs);
    return;
  }

  listEl.innerHTML =
    pairs.length === 0
      ? `<div class="detail-empty">${emptyMessage}</div>`
      : pairs.map((pair) => renderMypageRowHtml(pair)).join("");
}

// 목록 안에서 버튼(.activity-row)을 누르면 바로 아래 상세(.activity-detail)를 펼치고/접음
// (목록 컨테이너는 재렌더링돼도 그대로 유지되므로 리스너는 한 번만 등록)
function wireExpandableRows(containerEl) {
  containerEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".activity-row");
    if (!btn) return;
    const detail = btn.nextElementSibling;
    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!expanded));
    detail.hidden = expanded;
  });
}

// 대기(WT) 목록을 월별로 묶어서 아코디언으로 표시 — 모바일에서 스크롤을 줄이려고
// 가장 가까운 달(첫 그룹)만 기본으로 펼침, 나머지는 접어서 필요할 때만 탭해서 열어봄
function groupPairsByMonth(pairs) {
  const groups = new Map();
  pairs.forEach((pair) => {
    const monthKey = pair.entry.date.slice(0, 7); // "YYYY-MM"
    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey).push(pair);
  });
  return Array.from(groups.entries()).map(([monthKey, groupPairs]) => ({ monthKey, pairs: groupPairs }));
}

function monthGroupLabel(monthKey) {
  const [, m] = monthKey.split("-");
  return `${parseInt(m, 10)}월`;
}

function renderMonthGroupedHtml(pairsSortedByDate) {
  const groups = groupPairsByMonth(pairsSortedByDate);
  return groups
    .map((g, idx) => {
      const expanded = idx === 0;
      return `
        <div class="month-group">
          <button type="button" class="month-group-header" aria-expanded="${expanded}">
            <span>${monthGroupLabel(g.monthKey)} <span class="month-group-count">${g.pairs.length}건</span></span>
            <span class="month-group-chevron">${Icons.chevronRight}</span>
          </button>
          <div class="month-group-body"${expanded ? "" : " hidden"}>
            ${g.pairs.map((pair) => renderMypageRowHtml(pair)).join("")}
          </div>
        </div>`;
    })
    .join("");
}

// 월 그룹 헤더를 누르면 그 달의 목록을 펼치고/접음 (역시 리스너는 한 번만 등록)
function wireMonthGroups(containerEl) {
  containerEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".month-group-header");
    if (!btn) return;
    const body = btn.nextElementSibling;
    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!expanded));
    body.hidden = expanded;
  });
}

function renderMypageRowHtml({ group, entry }) {
  const primary = group.travelers[0];
  const nameLabel =
    group.travelers.length > 1 ? `${primary.name} 외 ${group.travelers.length - 1}명` : primary.name;
  const [, m, d] = entry.date.split("-");
  const classLabel = entry.seatClass === "C" ? "비즈니스" : "이코노미";
  const statusLabel = entry.status === "OK" ? "확약 OK" : "대기 WT";
  const statusClass = entry.status === "OK" ? "badge-ok" : "badge-wt";

  const companionsHtml =
    group.travelers.length > 1
      ? `<div class="activity-detail-companions">일행: ${group.travelers.map((t) => escapeHtml(t.name)).join(", ")}</div>`
      : "";
  const assigneeHtml = group.assignee
    ? `<span class="badge-assignee">담당 ${escapeHtml(group.assignee)}</span>`
    : "";
  const memoHtml = group.memo
    ? `<div class="activity-detail-memo">메모: ${escapeHtml(group.memo)}</div>`
    : "";

  return `
    <div class="activity-item">
      <button type="button" class="activity-row" aria-expanded="false">
        <span class="activity-name">${escapeHtml(nameLabel)}</span>
        <span class="activity-row-meta">
          <span class="activity-meta">${m}/${d} · ${escapeHtml(entry.flightNo)} · ${entry.status === "OK" ? "확약" : "대기"}</span>
          <span class="activity-chevron">${Icons.chevronRight}</span>
        </span>
      </button>
      <div class="activity-detail" hidden>
        <div class="activity-detail-row">
          ${Icons.plane}
          <span>${escapeHtml(entry.flightNo)}</span>
          <span>${entry.depTime} - ${entry.arrTime}</span>
          <span class="badge-class">${classLabel}</span>
          <span class="badge ${statusClass}">${statusLabel}</span>
          ${assigneeHtml}
        </div>
        ${companionsHtml}
        ${memoHtml}
      </div>
    </div>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
