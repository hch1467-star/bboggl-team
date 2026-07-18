/* ============================================
   관리자 화면 — 체크한 직원들의 일정을 한 캘린더에서 조회 (조회 전용)
   ============================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireSession();
  if (!session) return; // login.html로 이동 중

  const loadingEl = document.getElementById("loading-overlay");

  const isAdmin = await checkIsAdmin(CurrentUser.id);
  if (!isAdmin) {
    window.location.href = "index.html";
    return;
  }

  Store.readOnly = true;

  let profiles = [];
  try {
    const { data, error } = await supabaseClient.from("profiles").select("id, email").order("email");
    if (error) throw error;
    profiles = data;
  } catch (err) {
    alert("직원 목록을 불러오지 못했어요: " + (err.message || err));
  }

  try {
    await Store.loadEvents();
  } catch (err) {
    console.warn("이벤트를 불러오지 못했어요:", err);
  }

  try {
    await Store.loadEventNotes();
  } catch (err) {
    console.warn("이벤트 개인 메모를 불러오지 못했어요:", err);
  }

  if (loadingEl) loadingEl.remove();
  wireLogoutButton();
  EventModal.init();

  const emailById = new Map(profiles.map((p) => [p.id, p.email]));
  const listEl = document.getElementById("employee-checkbox-list");

  if (profiles.length === 0) {
    listEl.innerHTML = `<div class="detail-empty">가입된 직원이 없어요.</div>`;
  } else {
    listEl.innerHTML = profiles
      .map(
        (p) => `
      <label class="employee-checkbox-item">
        <input type="checkbox" class="employee-checkbox" value="${p.id}">
        <span>${escapeHtml(p.email)}</span>
      </label>`
      )
      .join("");
  }

  CalendarView.init();

  async function reloadSelectedEmployees() {
    const checkedIds = Array.from(listEl.querySelectorAll(".employee-checkbox:checked")).map((el) => el.value);
    try {
      Store.groups = await loadGroupsForUsers(checkedIds, emailById);
    } catch (err) {
      alert("일정을 불러오지 못했어요: " + (err.message || err));
      Store.groups = [];
    }
    CalendarView.render();
  }

  listEl.addEventListener("change", (e) => {
    if (e.target.classList.contains("employee-checkbox")) reloadSelectedEmployees();
  });
});
