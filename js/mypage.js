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
});

function renderMypageRowHtml({ group, entry }) {
  const primary = group.travelers[0];
  const nameLabel =
    group.travelers.length > 1 ? `${primary.name} 외 ${group.travelers.length - 1}명` : primary.name;
  const [, m, d] = entry.date.split("-");
  return `
    <div class="activity-row">
      <span class="activity-name">${nameLabel}</span>
      <span class="activity-meta">${m}/${d} · ${entry.flightNo} · ${entry.status === "OK" ? "확약" : "대기"}</span>
    </div>`;
}
