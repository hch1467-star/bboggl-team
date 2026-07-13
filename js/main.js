/* ============================================
   초기화 진입점 — 로그인 확인 → 내 데이터 로드 → 화면 초기화
   ============================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireSession();
  if (!session) return; // login.html로 이동 중

  const loadingEl = document.getElementById("loading-overlay");

  try {
    await Store.init(CurrentUser.id);
    await maybeImportLocalData();
  } catch (err) {
    alert("일정을 불러오지 못했어요: " + (err.message || err));
  }

  if (loadingEl) loadingEl.remove();

  CalendarView.init();
  SearchBox.init();
  ScheduleModal.init();
  wireLogoutButton();
});
