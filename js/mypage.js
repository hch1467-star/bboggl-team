/* ============================================
   마이페이지 — 로그인한 사용자의 실제 통계·활동 내역
   ============================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireSession();
  if (!session) return; // login.html로 이동 중

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

  const allPairs = Store.flatEntries();
  const wtPairs = allPairs.filter((p) => p.entry.status === "WT");
  document.getElementById("stat-wt").textContent = wtPairs.length;

  const listEl = document.getElementById("activity-list");
  const recent = [...allPairs].sort((a, b) => b.entry.createdAt.localeCompare(a.entry.createdAt)).slice(0, 8);

  if (recent.length === 0) {
    listEl.innerHTML = `<div class="detail-empty">아직 활동 내역이 없어요.</div>`;
  } else {
    listEl.innerHTML = recent.map((pair) => renderMypageRowHtml(pair)).join("");
  }
  wireExpandableRows(listEl);

  const wtListEl = document.getElementById("wt-list");
  // 날짜가 가까운 것부터 — 확인·컨펌이 급한 순서
  const sortedWt = [...wtPairs].sort(
    (a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.depTime.localeCompare(b.entry.depTime)
  );

  if (sortedWt.length === 0) {
    wtListEl.innerHTML = `<div class="detail-empty">확인이 필요한 대기 일정이 없어요.</div>`;
  } else {
    wtListEl.innerHTML = sortedWt.map((pair) => renderMypageRowHtml(pair)).join("");
  }
  wireExpandableRows(wtListEl);
});

// 목록 안에서 버튼(.activity-row)을 누르면 바로 아래 상세(.activity-detail)를 펼치고/접음
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
